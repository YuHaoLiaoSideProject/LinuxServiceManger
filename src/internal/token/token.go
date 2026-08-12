// Package token implements API token creation, storage, and validation.
// Tokens are stored as SHA-256 hashes; raw token values are only returned once at creation time.
package token

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"strings"
	"sync"
	"time"
)

// ============================================================
//  Errors
// ============================================================

// Predefined sentinel errors for middleware use.
var (
	ErrTokenInvalid  = &TokenError{msg: "Token 無效"}
	ErrTokenRevoked  = &TokenError{msg: "Token 已被撤銷"}
	ErrTokenExpired  = &TokenError{msg: "Token 已過期"}
	ErrNotFound      = &TokenError{msg: "Token 不存在"}
	ErrLimitExceeded = &TokenError{msg: "已達 Token 數量上限（20）"}
	ErrNameDuplicate = &TokenError{msg: "此名稱已存在，請使用其他名稱"}
	ErrNameRequired  = &TokenError{msg: "名稱為必填"}
	ErrInvalidScope  = &TokenError{msg: "無效的權限範圍"}
)

// TokenError is a user-facing error type.
type TokenError struct {
	msg string
}

func (e *TokenError) Error() string { return e.msg }

// IsTokenError checks if an error is a TokenError and returns its message.
func IsTokenError(err error) (string, bool) {
	if te, ok := err.(*TokenError); ok {
		return te.msg, true
	}
	return "", false
}

// ============================================================
//  Constants
// ============================================================

const (
	MaxActiveTokens  = 20
	TokenPrefix      = "lsm_"
	RandomBytes      = 32 // 32 bytes -> 43 chars Base64URL
	MinExpiryDays    = 1
	MaxExpiryDays    = 365
	ExpiringSoonDays = 7
)

// ============================================================
//  Types
// ============================================================

// Scope represents the permission level of a token.
type Scope string

const (
	ScopeRead Scope = "read" // 唯讀：僅 GET / HEAD / OPTIONS
	ScopeFull Scope = "full" // 完整操作：所有 HTTP method
)

// Status represents the runtime status of a stored token.
type Status string

const (
	StatusActive       Status = "active"
	StatusExpiringSoon Status = "expiring_soon"
	StatusExpired      Status = "expired"
	StatusRevoked      Status = "revoked"
)

// Token represents a stored API token (hash only, never the raw value).
type Token struct {
	ID         string     `json:"id"`          // UUID v4
	Name       string     `json:"name"`        // 使用者自訂名稱（不區分大小寫唯一）
	Hash       string     `json:"hash"`        // SHA-256 hex of raw token
	PrefixHint string     `json:"prefix_hint"` // 前綴 8 字元（"lsm_xxxx"），供 UI 遮罩辨識
	Scope      Scope      `json:"scope"`       // "read" | "full"
	CreatedAt  time.Time  `json:"created_at"`
	ExpiresAt  *time.Time `json:"expires_at"`  // nil = 永不過期
	LastUsedAt *time.Time `json:"last_used_at"` // nil = 從未使用
	Revoked    bool       `json:"revoked"`
}

// TokenResponse is returned to the UI for list queries (no raw value, no hash).
type TokenResponse struct {
	ID         string     `json:"id"`
	Name       string     `json:"name"`
	Prefix     string     `json:"prefix"`      // 前 4 字元 + "****" + 後 4 字元
	Scope      Scope      `json:"scope"`
	CreatedAt  time.Time  `json:"created_at"`
	ExpiresAt  *time.Time `json:"expires_at"`
	LastUsedAt *time.Time `json:"last_used_at"`
	Status     Status     `json:"status"`
}

// CreateTokenResponse is the one-time response after token creation.
type CreateTokenResponse struct {
	ID        string     `json:"id"`
	Token     string     `json:"token"` // RAW value — 僅此一次
	Name      string     `json:"name"`
	Scope     Scope      `json:"scope"`
	ExpiresAt *time.Time `json:"expires_at"`
}

// CreateTokenInput is the request body for creating a token.
type CreateTokenInput struct {
	Name          string     `json:"name"`
	ExpiresInDays int        `json:"expires_in_days"` // -1 = 永不過期, 1-365 = N 天, 0 = 自訂日期
	CustomExpiry  *time.Time `json:"custom_expiry"`   // 僅 expires_in_days=0 時使用
	Scope         Scope      `json:"scope"`
}

// RevokeResponse is returned after a token revocation.
type RevokeResponse struct {
	Message string `json:"message"`
	Status  string `json:"status"` // "revoked" | "already_revoked"
}

// ============================================================
//  CreateTokenInput.Validate
// ============================================================

// Validate checks the input and returns a user-facing error message or nil.
func (in *CreateTokenInput) Validate() error {
	// Name: non-empty, non-blank
	if strings.TrimSpace(in.Name) == "" {
		return ErrNameRequired
	}

	// Scope: must be valid
	if in.Scope != ScopeRead && in.Scope != ScopeFull {
		return ErrInvalidScope
	}

	// ExpiresInDays validation
	if in.ExpiresInDays == -1 {
		// 永不過期 — valid
		return nil
	}
	if in.ExpiresInDays == 0 {
		// 自訂日期
		if in.CustomExpiry == nil {
			return &TokenError{msg: "自訂日期不可為空"}
		}
		if in.CustomExpiry.Before(time.Now()) {
			return &TokenError{msg: "過期日期不可為過去"}
		}
		return nil
	}
	if in.ExpiresInDays < 1 || in.ExpiresInDays > 365 {
		return &TokenError{msg: fmt.Sprintf("過期天數須介於 %d 至 %d 之間", MinExpiryDays, MaxExpiryDays)}
	}

	return nil
}

// ============================================================
//  Store
// ============================================================

// Store manages token persistence (JSON file) with thread-safe access.
type Store struct {
	mu         sync.RWMutex
	filePath   string
	tokens     map[string]*Token // key = ID (UUID)
	updateCh   chan string       // token ID to update
	shutdownCh chan struct{}
}

// NewStore creates a Store backed by the given JSON file path.
func NewStore(filePath string) *Store {
	return &Store{
		filePath:   filePath,
		tokens:     make(map[string]*Token),
		updateCh:   make(chan string, 100),
		shutdownCh: make(chan struct{}),
	}
}

// ============================================================
//  Token creation helpers
// ============================================================

// generateRawToken creates a cryptographically random token string.
func generateRawToken() (string, error) {
	buf := make([]byte, RandomBytes)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("failed to generate random bytes: %w", err)
	}
	return TokenPrefix + base64.RawURLEncoding.EncodeToString(buf), nil
}

// hashToken computes the SHA-256 hash of a raw token and returns it as hex.
func hashToken(raw string) string {
	h := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(h[:])
}

// generateID creates a simple unique ID (timestamp-based for simplicity,
// avoids external UUID dependency).
func generateID() string {
	buf := make([]byte, 16)
	rand.Read(buf)
	return hex.EncodeToString(buf)
}

// maskPrefix returns the masked prefix for display (first 4 + "****" + last 4).
func maskPrefix(hint string) string {
	if len(hint) < 8 {
		return hint + "****"
	}
	return hint[:4] + "****" + hint[4:8]
}

// computeStatus determines the runtime status of a token.
func computeStatus(tok *Token) Status {
	if tok.Revoked {
		return StatusRevoked
	}
	if tok.ExpiresAt != nil {
		now := time.Now()
		if tok.ExpiresAt.Before(now) {
			return StatusExpired
		}
		if tok.ExpiresAt.Sub(now) < time.Duration(ExpiringSoonDays)*24*time.Hour {
			return StatusExpiringSoon
		}
	}
	return StatusActive
}

// ============================================================
//  Create
// ============================================================

// Create generates a token, stores its hash, and returns the raw value.
func (s *Store) Create(input CreateTokenInput) (*CreateTokenResponse, error) {
	// 1. Validate input
	if err := input.Validate(); err != nil {
		return nil, err
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	// 2. Check name uniqueness (case-insensitive)
	for _, tok := range s.tokens {
		if strings.EqualFold(tok.Name, input.Name) {
			return nil, ErrNameDuplicate
		}
	}

	// 3. Check active token count < MaxActiveTokens
	activeCount := 0
	for _, tok := range s.tokens {
		if !tok.Revoked && (tok.ExpiresAt == nil || !tok.ExpiresAt.Before(time.Now())) {
			activeCount++
		}
	}
	if activeCount >= MaxActiveTokens {
		return nil, ErrLimitExceeded
	}

	// 4. Generate raw token
	raw, err := generateRawToken()
	if err != nil {
		return nil, fmt.Errorf("failed to generate token: %w", err)
	}

	// 5. Compute hash
	hash := hashToken(raw)

	// 6. Build expires_at
	var expiresAt *time.Time
	switch {
	case input.ExpiresInDays == -1:
		// 永不過期 — leave as nil
	case input.ExpiresInDays == 0 && input.CustomExpiry != nil:
		// 自訂日期
		expiresAt = input.CustomExpiry
	default:
		// N days
		t := time.Now().Add(time.Duration(input.ExpiresInDays) * 24 * time.Hour)
		expiresAt = &t
	}

	// 7. Create token record
	id := generateID()
	now := time.Now()
	prefixHint := raw[:8] // "lsm_xxxx"

	tok := &Token{
		ID:         id,
		Name:       input.Name,
		Hash:       hash,
		PrefixHint: prefixHint,
		Scope:      input.Scope,
		CreatedAt:  now,
		ExpiresAt:  expiresAt,
		LastUsedAt: nil,
		Revoked:    false,
	}
	s.tokens[id] = tok

	// 8. Persist to file
	if err := s.save(); err != nil {
		delete(s.tokens, id)
		return nil, fmt.Errorf("failed to save token: %w", err)
	}

	return &CreateTokenResponse{
		ID:        id,
		Token:     raw,
		Name:      input.Name,
		Scope:     input.Scope,
		ExpiresAt: expiresAt,
	}, nil
}

// ============================================================
//  List
// ============================================================

// List returns all tokens ordered by created_at DESC.
func (s *Store) List() []TokenResponse {
	s.mu.RLock()
	defer s.mu.RUnlock()

	result := make([]TokenResponse, 0, len(s.tokens))
	for _, tok := range s.tokens {
		result = append(result, TokenResponse{
			ID:         tok.ID,
			Name:       tok.Name,
			Prefix:     maskPrefix(tok.PrefixHint),
			Scope:      tok.Scope,
			CreatedAt:  tok.CreatedAt,
			ExpiresAt:  tok.ExpiresAt,
			LastUsedAt: tok.LastUsedAt,
			Status:     computeStatus(tok),
		})
	}

	// Sort by created_at DESC
	for i := 0; i < len(result); i++ {
		for j := i + 1; j < len(result); j++ {
			if result[i].CreatedAt.Before(result[j].CreatedAt) {
				result[i], result[j] = result[j], result[i]
			}
		}
	}

	return result
}

// ============================================================
//  Revoke
// ============================================================

// Revoke marks a token as revoked (idempotent).
// Returns the revocation status: "revoked" or "already_revoked".
func (s *Store) Revoke(id string) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	tok, ok := s.tokens[id]
	if !ok {
		return "", ErrNotFound
	}

	// Already revoked — idempotent
	if tok.Revoked {
		return "already_revoked", nil
	}

	tok.Revoked = true

	if err := s.save(); err != nil {
		tok.Revoked = false
		return "", fmt.Errorf("failed to save: %w", err)
	}

	return "revoked", nil
}

// ============================================================
//  Validate (for middleware)
// ============================================================

// Validate checks a raw token against the store for middleware use.
// Returns the stored token if valid, or an error with a user-facing message.
func (s *Store) Validate(rawToken string) (*Token, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	hash := hashToken(rawToken)

	// Find token by hash
	for _, tok := range s.tokens {
		if tok.Hash == hash {
			// Check revoked
			if tok.Revoked {
				return nil, ErrTokenRevoked
			}
			// Check expired
			if tok.ExpiresAt != nil && tok.ExpiresAt.Before(time.Now()) {
				return nil, ErrTokenExpired
			}
			return tok, nil
		}
	}

	return nil, ErrTokenInvalid
}

// ============================================================
//  Async last_used_at
// ============================================================

// MarkUsed sends a token ID to the async update channel.
func (s *Store) MarkUsed(id string) {
	select {
	case s.updateCh <- id:
	default:
		// Channel full — drop (best-effort)
	}
}

// RunLastUsedUpdater starts a background goroutine for batch last_used_at updates.
func (s *Store) RunLastUsedUpdater() {
	go func() {
		pending := make(map[string]bool)
		ticker := time.NewTicker(5 * time.Second)
		defer ticker.Stop()

		for {
			select {
			case id := <-s.updateCh:
				pending[id] = true
				if len(pending) >= 10 {
					s.flushLastUsed(pending)
					pending = make(map[string]bool)
				}
			case <-ticker.C:
				if len(pending) > 0 {
					s.flushLastUsed(pending)
					pending = make(map[string]bool)
				}
			case <-s.shutdownCh:
				if len(pending) > 0 {
					s.flushLastUsed(pending)
				}
				return
			}
		}
	}()
}

func (s *Store) flushLastUsed(pending map[string]bool) {
	s.mu.Lock()
	defer s.mu.Unlock()

	now := time.Now()
	changed := false
	for id := range pending {
		if tok, ok := s.tokens[id]; ok {
			tok.LastUsedAt = &now
			changed = true
		}
	}
	if changed {
		s.save() // best-effort; errors are silently ignored
	}
}

// Shutdown stops the background updater goroutine.
func (s *Store) Shutdown() {
	select {
	case <-s.shutdownCh:
		// Already closed
	default:
		close(s.shutdownCh)
	}
}
