# API Token 管理與驗證 — 開發規格

> **對應 Roadmap**：Phase 3 — `docs/development/002-expansion-roadmap.md` 項目 #11
> **技術決策**：`docs/tech-decisions/011-api-token-auth.md`
> **操作流程**：`docs/interaction-flows/011-api-token-auth.md`
> **BDD**：`docs/bdds/011-api-token-auth.feature`
> **測試計畫**：`docs/test-plans/011-api-token-auth測試計畫.md`
> **狀態**：設計完成，待開發

---

## 概述

讓管理員建立與管理 API Token（Bearer token），供 CI/CD 或自動化腳本透過 `Authorization: Bearer <token>` header 安全呼叫 API，不需在腳本中儲存帳號密碼。核心包含：

1. **Token 儲存模組（`internal/token/`）**：Token CRUD、SHA-256 hash 儲存、JSON file 持久化、非同步 `last_used_at` 更新
2. **Auth Composite Middleware**：Bearer Token 優先驗證 + Cookie Session fallback，共存不互相干擾
3. **Token 管理 Handler**：`/api/v1/tokens` CRUD 端點（session-only 保護）
4. **TokenManageView 前端頁面**：Token 列表、建立表單、一次性揭露 Modal、撤銷 ConfirmModal
5. **Audit Log 整合**：`token_create` / `token_revoke` 操作記錄

---

## 1. 後端實作規格

### 1.1 依賴新增

零外部依賴。Token 模組僅使用 Go 標準庫：

- `crypto/sha256` — hash 計算
- `crypto/rand` — Token 原始值隨機產生
- `encoding/base64` — Base64URL 編碼
- `encoding/json` — JSON file 序列化
- `sync` — RWMutex 保護並發讀寫
- `os` — atomic write（temp file + rename）

### 1.2 檔案改動總覽

```
src/
├── main.go                                  ← 修改：新增 token store 初始化、路由註冊、middleware 替換
├── internal/
│   ├── token/
│   │   ├── token.go                         ← 新增：Token 資料結構、產生、hash、驗證、CRUD 邏輯
│   │   ├── token_test.go                    ← 新增：Token 模組單元測試
│   │   ├── store.go                         ← 新增：JSON file 儲存層（RWMutex + atomic write）
│   │   └── store_test.go                    ← 新增：儲存層並發測試
│   ├── middleware/
│   │   └── auth.go                          ← 修改：新增 AuthMiddlewareComposite
│   ├── handler/
│   │   ├── handler.go                       ← 修改：新增 tokenStore 欄位
│   │   ├── json_handler.go                  ← 修改：新增 HandleListTokens / HandleCreateToken / HandleRevokeToken
│   │   ├── handler_token_test.go            ← 新增：Token handler 整合測試
│   │   └── handler_token_middleware_test.go  ← 新增：Token middleware 整合測試
│   └── audit/
│       └── audit.go                         ← 修改：新增 ActionTokenCreate / ActionTokenRevoke
```

### 1.3 Token 模組（`internal/token/token.go`）

**職責**：定義 Token 資料結構、Token 格式與產生、SHA-256 hash、驗證邏輯（過期/撤銷/權限）、CRUD 操作協調。

```go
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

const (
	MaxActiveTokens = 20
	TokenPrefix     = "lsm_"
	RandomBytes     = 32 // 32 bytes → 43 chars Base64URL
	MinExpiryDays   = 1
	MaxExpiryDays   = 365
	ExpiringSoonDays = 7
)

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
	ID         string     `json:"id"`          // UUID v4, 前端不產生
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
	Token     string     `json:"token"`     // RAW value — 僅此一次
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

// Validate checks the input and returns a user-facing error message or nil.
func (in *CreateTokenInput) Validate() error {
	// name: non-empty, non-blank
	// scope: must be ScopeRead or ScopeFull
	// expires_in_days: -1 (永久) | 1-365 | 0 (自訂，需 custom_expiry 非空且 > 現在)
	// ...
}

// Store manages token persistence (JSON file) with thread-safe access.
type Store struct {
	mu       sync.RWMutex
	filePath string
	tokens   map[string]*Token // key = ID (UUID)

	// Async last_used_at update infrastructure
	updateCh   chan string       // token ID to update
	shutdownCh chan struct{}
}

// NewStore creates a Store backed by the given JSON file path.
func NewStore(filePath string) *Store

// Load reads and parses the JSON file into memory.
func (s *Store) Load() error

// save atomically writes the token map to file (temp + rename).
func (s *Store) save() error

// Create generates a token, stores its hash, and returns the raw value.
func (s *Store) Create(input CreateTokenInput) (*CreateTokenResponse, error) {
	// 1. input.Validate()
	// 2. s.mu.Lock(); defer s.mu.Unlock()
	// 3. Check name uniqueness (case-insensitive)
	// 4. Check active token count < MaxActiveTokens
	// 5. Generate raw: lsm_ + Base64URL(random 32 bytes)
	// 6. hash := sha256.Sum256([]byte(raw))
	// 7. Store Token{Hash: hex(hash), PrefixHint: raw[:8], ...}
	// 8. s.save()
	// 9. Return CreateTokenResponse with raw
}

// List returns all tokens ordered by created_at DESC.
func (s *Store) List() []TokenResponse {
	// s.mu.RLock(); defer s.mu.RUnlock()
	// for each token: compute Status from expires_at / revoked
	// mask prefix: prefix_hint[:4] + "****" + prefix_hint[4:8]
	// sort by created_at DESC
}

// Revoke marks a token as revoked (idempotent).
func (s *Store) Revoke(id string) error {
	// s.mu.Lock(); defer s.mu.Unlock()
	// if token == nil → ErrNotFound
	// if token.Revoked → return nil (already revoked / idempotent)
	// token.Revoked = true; s.save()
}

// Validate checks a raw token against the store for middleware use.
// Returns the stored token if valid, or an error with a user-facing message.
func (s *Store) Validate(rawToken string) (*Token, error) {
	// s.mu.RLock(); defer s.mu.RUnlock()
	// hash := hex(sha256(rawToken))
	// Find token by hash
	// If not found → ErrTokenInvalid("Token 無效")
	// If revoked → ErrTokenRevoked("Token 已被撤銷")
	// If expired → ErrTokenExpired("Token 已過期")
	// return token, nil
}

// MarkUsed sends a token ID to the async update channel.
func (s *Store) MarkUsed(id string) {
	select { case s.updateCh <- id: default: }
}

// RunLastUsedUpdater starts a background goroutine for batch last_used_at updates.
func (s *Store) RunLastUsedUpdater()

// Shutdown stops the background updater goroutine.
func (s *Store) Shutdown()
```

### 1.4 Token 儲存層（`internal/token/store.go`）

**職責**：JSON file 持久化、RWMutex 保護並發、atomic write。

```go
// store.go — 完整儲存層實作

// Load reads tokens.json and unmarshals it.
func (s *Store) Load() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	data, err := os.ReadFile(s.filePath)
	if os.IsNotExist(err) {
		s.tokens = make(map[string]*Token)
		return nil
	}
	if err != nil {
		return fmt.Errorf("failed to read token store: %w", err)
	}
	return json.Unmarshal(data, &s.tokens)
}

// save writes tokens map atomically to s.filePath.
func (s *Store) save() error {
	data, err := json.MarshalIndent(s.tokens, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal tokens: %w", err)
	}
	// atomic write: temp file + rename
	tmpPath := s.filePath + ".tmp"
	if err := os.WriteFile(tmpPath, data, 0600); err != nil {
		return err
	}
	return os.Rename(tmpPath, s.filePath)
}

// RunLastUsedUpdater starts a goroutine that batches last_used_at updates.
// It writes every 5 seconds or when 10 updates accumulate, whichever first.
func (s *Store) RunLastUsedUpdater() {
	go func() {
		defer func() {
			if r := recover(); r != nil {
				log.Printf("token: last_used_at updater panic: %v", r)
			}
		}()
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
	for id := range pending {
		if tok, ok := s.tokens[id]; ok {
			tok.LastUsedAt = &now
		}
	}
	s.save()
}
```

### 1.5 Auth Composite Middleware（`internal/middleware/auth.go`）

**職責**：Bearer Token 優先驗證 + Cookie Session fallback。需在現有 `auth.go` 中新增，保留既有 `AuthMiddleware` 和 `AuthMiddlewareJSON` 不變。

```go
// 在 middleware/auth.go 中新增以下內容

import "linux-service-manager/internal/token"

// Context key types for auth info
type contextKey string

const (
	CtxKeyAuthMethod contextKey = "auth_method"
	CtxKeyTokenName  contextKey = "token_name"
	CtxKeyTokenScope contextKey = "token_scope"
)

// AuthMiddlewareComposite checks Bearer token first, falls back to session.
// All API routes (except login/logout/session) should use this.
func AuthMiddlewareComposite(tokenStore *token.Store) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// 1. Check Bearer token first
			authHeader := r.Header.Get("Authorization")
			if strings.HasPrefix(authHeader, "Bearer ") {
				rawToken := strings.TrimPrefix(authHeader, "Bearer ")
				if rawToken == "" {
					writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "未提供驗證資訊"})
					return
				}
				tok, err := tokenStore.Validate(rawToken)
				if err != nil {
					// err.Error() already contains user-facing message
					writeJSON(w, http.StatusUnauthorized, map[string]string{"error": err.Error()})
					return
				}
				// Check scope vs HTTP method
				if tok.Scope == token.ScopeRead && !isReadOnlyMethod(r.Method) {
					writeJSON(w, http.StatusForbidden, map[string]string{"error": "權限不足，此 Token 僅供唯讀"})
					return
				}
				// Set context
				ctx := context.WithValue(r.Context(), CtxKeyAuthMethod, "token")
				ctx = context.WithValue(ctx, CtxKeyTokenName, tok.Name)
				ctx = context.WithValue(ctx, CtxKeyTokenScope, string(tok.Scope))
				// Async update last_used_at
				tokenStore.MarkUsed(tok.ID)
				next.ServeHTTP(w, r.WithContext(ctx))
				return
			}

			// 2. Fallback to cookie session
			session := auth.GetSession(r)
			if authenticated, ok := session.Values["authenticated"].(bool); !ok || !authenticated {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusUnauthorized)
				json.NewEncoder(w).Encode(map[string]string{"error": "未提供驗證資訊"})
				return
			}
			// Set context for session auth
			ctx := context.WithValue(r.Context(), CtxKeyAuthMethod, "session")
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// isReadOnlyMethod returns true for safe HTTP methods.
func isReadOnlyMethod(method string) bool {
	return method == http.MethodGet || method == http.MethodHead || method == http.MethodOptions
}

// writeJSON helper (in middleware for standalone 401/403 responses)
func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}
```

### 1.6 Token Handler（新增於 `src/internal/handler/json_handler.go`）

```go
// ============================================================
//  GET /api/v1/tokens
// ============================================================

func (h *Handler) HandleListTokens(w http.ResponseWriter, r *http.Request) {
	// tokens := h.TokenStore.List()
	// writeJSON(w, 200, map[string]interface{}{"data": tokens})
}

// ============================================================
//  POST /api/v1/tokens
// ============================================================

func (h *Handler) HandleCreateToken(w http.ResponseWriter, r *http.Request) {
	// 1. Decode CreateTokenInput from JSON body
	// 2. Call h.TokenStore.Create(input)
	// 3. On success: write Audit Log (token_create), writeJSON 201
	// 4. On name conflict (409): {"error": "此名稱已存在，請使用其他名稱"}
	// 5. On limit exceeded (400): {"error": "已達 Token 數量上限（20）"}
	// 6. On validation error (400): {"error": "..."}
	// 7. On internal error (500): {"error": "建立失敗，請稍後重試"}
}

// ============================================================
//  POST /api/v1/tokens/{id}/revoke
// ============================================================

func (h *Handler) HandleRevokeToken(w http.ResponseWriter, r *http.Request) {
	// 1. id := chi.URLParam(r, "id")
	// 2. err := h.TokenStore.Revoke(id)
	// 3. On success (incl. already revoked): write Audit Log (token_revoke), writeJSON 200
	// 4. On not found (404): {"error": "Token 不存在"}
	// 5. On internal error (500): {"error": "撤銷失敗，請重試"}
}
```

### 1.7 Handler struct 修改（`internal/handler/handler.go`）

```go
// Handler struct 新增欄位：
type Handler struct {
	tmpl      *template.Template
	systemd   systemd.ServiceManager
	Hub       *websocket.Hub
	Audit     *audit.Module
	TokenStore *token.Store  // ← 新增
}

// New 函數新增 tokenStore 參數：
func New(tplFS fs.FS, sm systemd.ServiceManager, auditMod *audit.Module, tokenStore *token.Store) *Handler {
	// ...
}
```

### 1.8 Audit 模組修改（`internal/audit/audit.go`）

```go
// 新增兩個 Action 常數：
const (
	// ... existing actions ...
	ActionTokenCreate Action = "token_create"
	ActionTokenRevoke Action = "token_revoke"
)

// validActions map 擴充：
var validActions = map[Action]bool{
	// ... existing ...
	ActionTokenCreate: true,
	ActionTokenRevoke: true,
}

// actionDisplayLabels map 擴充：
var actionDisplayLabels = map[Action]string{
	// ... existing ...
	ActionTokenCreate: "建立 Token",
	ActionTokenRevoke: "撤銷 Token",
}
```

### 1.9 main.go 路由整合

```go
// main.go 變更摘要：
//
// 1. 新增 import："linux-service-manager/internal/token"
//
// 2. 初始化 token store：
//    tokenStore := token.NewStore("/var/lib/linux-service-manager/tokens.json")
//    if err := tokenStore.Load(); err != nil { log.Fatalf(...) }
//    go tokenStore.RunLastUsedUpdater()
//    defer tokenStore.Shutdown()
//
// 3. 修改 handler.New 呼叫，傳入 tokenStore
//
// 4. Token 管理路由（session-only 保護）：
//    r.Group(func(r chi.Router) {
//        r.Use(middleware.AuthMiddlewareJSON) // 僅 session，不能用 token 管理 token
//        r.Get("/api/v1/tokens", h.HandleListTokens)
//        r.Post("/api/v1/tokens", h.HandleCreateToken)
//        r.Post("/api/v1/tokens/{id}/revoke", h.HandleRevokeToken)
//    })
//
// 5. 既有 JSON API protected group：將 middleware.AuthMiddlewareJSON
//    替換為 middleware.AuthMiddlewareComposite(tokenStore)
//    注意：login / logout / session 路由不變（不使用 composite middleware）
```

---

## 2. 前端實作規格

### 2.1 檔案改動總覽

```
frontend/src/
├── types/
│   └── service.ts                        ← 修改：新增 Token 相關型別定義
├── api/
│   └── client.ts                         ← 修改：新增 listTokens / createToken / revokeToken
├── composables/
│   └── useTokenManager.ts                ← 新增：Token 管理狀態邏輯（列表/表單/揭露/撤銷）
├── components/
│   ├── AppHeader.vue                     ← 修改：新增「API Tokens」導覽連結
│   ├── TokenCreateForm.vue               ← 新增：建立 Token 表單（名稱/過期/權限）
│   ├── TokenRevealModal.vue              ← 新增：Token 一次性揭露 Modal
│   └── TokenRevokeConfirm.vue            ← 新增：撤銷確認 Modal（可重用現有 ConfirmModal.vue）
├── views/
│   └── TokenManageView.vue               ← 新增：Token 管理頁面主元件
├── router/
│   └── index.ts                          ← 修改：新增 /tokens 路由
└── __tests__/
    └── views/
        └── TokenManageView.spec.ts       ← 新增：TokenManageView 單元測試
```

### 2.2 TypeScript 型別定義（`types/service.ts` 擴充）

```typescript
// ── API Token Types ──

export interface TokenResponse {
  id: string
  name: string
  prefix: string       // "lsm_k3F8****a3eU9"
  scope: 'read' | 'full'
  created_at: string   // ISO 8601
  expires_at: string | null  // null = 永不過期
  last_used_at: string | null // null = 從未使用
  status: 'active' | 'expiring_soon' | 'expired' | 'revoked'
}

export interface TokenListResponse {
  data: TokenResponse[]
}

export interface CreateTokenRequest {
  name: string
  expires_in_days: number  // -1 = 永不過期, 1-365 = N 天, 0 = 自訂日期
  custom_expiry?: string   // ISO 8601, 僅 expires_in_days=0 時
  scope: 'read' | 'full'
}

export interface CreateTokenResponse {
  id: string
  token: string          // RAW value — 一次性揭露
  name: string
  scope: 'read' | 'full'
  expires_at: string | null
}

export interface RevokeTokenResponse {
  message: string
  status: 'revoked' | 'already_revoked'
}

// Token 狀態標籤對應
export type TokenStatusLabel = '使用中' | '即將過期' | '已過期' | '已撤銷'
export type TokenStatusColor = 'green' | 'yellow' | 'red' | 'gray'
```

### 2.3 API Client 擴充（`api/client.ts`）

```typescript
// ── Token API ──

export async function listTokens(): Promise<TokenListResponse> {
  const { data } = await api.get<TokenListResponse>('/tokens')
  return data
}

export async function createToken(req: CreateTokenRequest): Promise<CreateTokenResponse> {
  const { data } = await api.post<CreateTokenResponse>('/tokens', req, {
    headers: { 'Content-Type': 'application/json' },
  })
  return data
}

export async function revokeToken(id: string): Promise<RevokeTokenResponse> {
  const { data } = await api.post<RevokeTokenResponse>(`/tokens/${encodeURIComponent(id)}/revoke`)
  return data
}
```

### 2.4 Token 管理 Composable（`composables/useTokenManager.ts`）

```typescript
import { ref, computed } from 'vue'
import type { Ref, ComputedRef } from 'vue'
import { listTokens, createToken, revokeToken } from '../api/client'
import type { TokenResponse, CreateTokenRequest, CreateTokenResponse } from '../types/service'
import { useToast } from './useToast'

export function useTokenManager() {
  const { showToast } = useToast()

  // ── State ──
  const tokens: Ref<TokenResponse[]> = ref([])
  const isLoading: Ref<boolean> = ref(false)
  const error: Ref<string | null> = ref(null)

  // ── Create form state ──
  const showCreateForm: Ref<boolean> = ref(false)
  const createFormName: Ref<string> = ref('')
  const createFormExpiry: Ref<number> = ref(90)      // default 90 天
  const createFormScope: Ref<'read' | 'full'> = ref('full')
  const createFormCustomDate: Ref<string> = ref('')  // 僅 expires_in_days=0 時
  const isSubmitting: Ref<boolean> = ref(false)
  const createError: Ref<string | null> = ref(null)

  // ── Reveal modal state ──
  const revealToken: Ref<CreateTokenResponse | null> = ref(null)
  const showRevealModal: Ref<boolean> = ref(false)

  // ── Revoke confirm state ──
  const revokingToken: Ref<TokenResponse | null> = ref(null)
  const isRevoking: Ref<boolean> = ref(false)

  // ── Computed ──
  const sortedTokens: ComputedRef<TokenResponse[]> = computed(() =>
    [...tokens.value].sort((a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    )
  )

  const activeTokens: ComputedRef<TokenResponse[]> = computed(() =>
    sortedTokens.value.filter(t => t.status !== 'revoked' && t.status !== 'expired')
  )

  // ── Methods ──
  async function fetchTokens(): Promise<void> {
    isLoading.value = true
    error.value = null
    try {
      const res = await listTokens()
      tokens.value = res.data
    } catch (err: any) {
      error.value = err.response?.data?.error || '載入失敗，請稍後重試'
    } finally {
      isLoading.value = false
    }
  }

  async function submitCreate(): Promise<void> {
    // 1. Frontend validation: name blank check
    // 2. Build CreateTokenRequest
    // 3. isSubmitting = true; createError = null
    // 4. call createToken(req)
    // 5. On success: revealToken = res; showRevealModal = true; showCreateForm = false
    // 6. On 409/400: createError = err message
    // 7. On 500: createError = "建立失敗，請稍後重試"
    // 8. Finally: isSubmitting = false
  }

  function closeRevealModal(): void {
    // Reset reveal state
    // Refresh token list
    // Show toast "Token 已建立"
  }

  function copyTokenToClipboard(): void {
    // navigator.clipboard.writeText(revealToken.value.token)
    // showToast("Token 已複製")
  }

  async function confirmRevoke(id: string): Promise<void> {
    // isRevoking = true
    // call revokeToken(id)
    // On success: update local token status to 'revoked'
    // showToast("Token 已撤銷")
    // On failure: show error in modal
    // Finally: isRevoking = false
  }

  // ── Expiry options ──
  const expiryOptions = [
    { value: 30, label: '30 天' },
    { value: 60, label: '60 天' },
    { value: 90, label: '90 天' },
    { value: 180, label: '180 天' },
    { value: 365, label: '365 天' },
    { value: -1, label: '永不過期' },
    { value: 0, label: '自訂日期' },
  ]

  return {
    tokens, isLoading, error, sortedTokens, activeTokens,
    showCreateForm, createFormName, createFormExpiry, createFormScope,
    createFormCustomDate, isSubmitting, createError,
    revealToken, showRevealModal,
    revokingToken, isRevoking,
    expiryOptions,
    fetchTokens, submitCreate, closeRevealModal, copyTokenToClipboard,
    confirmRevoke,
  }
}
```

### 2.5 Token 建立表單元件（`components/TokenCreateForm.vue`）

```vue
<script setup lang="ts">
// Props: showCreateForm, name, expiry, scope, customDate, isSubmitting, createError, expiryOptions
// Emits: update:name, update:expiry, update:scope, update:customDate, submit, cancel
//
// 表單欄位：
// - 名稱：文字輸入框，placeholder "例如：Jenkins CI"
// - 過期時間：下拉選單，選項來自 expiryOptions。選擇「自訂日期」時顯示 <input type="date">
// - 權限範圍：radio group — "唯讀" | "完整操作"
//
// 前端驗證：名稱空白時攔截提交，顯示 "名稱為必填" 提示
// 提交時：emit('submit')，外部 (composable) 控制 isSubmitting / createError
</script>

<template>
  <!-- 表單區域，為可折疊的卡片樣式 -->
  <!-- 錯誤訊息以紅色顯示在表單下方 -->
  <!-- 提交按鈕：isSubmitting 時 disabled + spinner -->
  <!-- 取消按鈕：emit('cancel') -->
</template>
```

### 2.6 Token 揭露 Modal（`components/TokenRevealModal.vue`）

```vue
<script setup lang="ts">
// Props: showRevealModal, revealToken: CreateTokenResponse | null
// Emits: close, copy
//
// Modal 內容：
// - 黃色警告：⚠️ 請立即複製此 Token，關閉此視窗後將無法再次查看
// - Token 值：唯讀 textarea，等寬字體，可選取但不可編輯
// - 「複製到剪貼簿」按鈕 → emit('copy')
// - 「我已複製，關閉」按鈕 → emit('close')
//
// 邊界處理：
// - Modal 不可透過點擊背景關閉（防止誤關遺失 Token）
// - 點擊關閉（未複製）→ Token 永久遺失
</script>

<template>
  <Teleport to="body">
    <!-- Modal overlay style: pointer-events:none for background click -->
  </Teleport>
</template>
```

### 2.7 Token 管理頁面（`views/TokenManageView.vue`）

```vue
<script setup lang="ts">
import { onMounted } from 'vue'
import { useTokenManager } from '../composables/useTokenManager'
import TokenCreateForm from '../components/TokenCreateForm.vue'
import TokenRevealModal from '../components/TokenRevealModal.vue'
import ConfirmModal from '../components/ConfirmModal.vue' // 重用既有元件
import EmptyState from '../components/EmptyState.vue'       // 重用既有元件
import { useI18n } from '../composables/useI18n'

const { t } = useI18n()
const {
  sortedTokens, isLoading, error,
  showCreateForm, createFormName, createFormExpiry, createFormScope,
  createFormCustomDate, isSubmitting, createError,
  revealToken, showRevealModal,
  revokingToken, isRevoking, expiryOptions,
  fetchTokens, submitCreate, closeRevealModal, copyTokenToClipboard, confirmRevoke,
} = useTokenManager()

onMounted(() => fetchTokens())

// ── 狀態標籤對應 ──
function statusLabel(status: string): string {
  switch (status) {
    case 'active': return '🟢 使用中'
    case 'expiring_soon': return '🟡 即將過期'
    case 'expired': return '🔴 已過期'
    case 'revoked': return '⚫ 已撤銷'
    default: return status
  }
}

function formatDate(iso: string | null): string {
  if (!iso) return '從未使用'
  return new Date(iso).toLocaleString()
}

function formatExpiry(iso: string | null): string {
  if (!iso) return '永不過期'
  return new Date(iso).toLocaleDateString()
}
</script>

<template>
  <div class="token-manage-view">
    <div class="page-header">
      <h2>🔑 API Tokens</h2>
      <button v-if="!showCreateForm" class="btn-primary" @click="showCreateForm = true">
        建立 Token
      </button>
    </div>

    <!-- 建立表單（可折疊） -->
    <TokenCreateForm
      v-if="showCreateForm"
      :expiry-options="expiryOptions"
      :is-submitting="isSubmitting"
      :create-error="createError"
    />

    <!-- Loading -->
    <div v-if="isLoading" class="loading">載入中...</div>

    <!-- Error -->
    <div v-else-if="error" class="error-state">
      <p>{{ error }}</p>
      <button @click="fetchTokens">重試</button>
    </div>

    <!-- Empty state -->
    <EmptyState v-else-if="sortedTokens.length === 0" message="尚無 API Token" />

    <!-- Token 列表（表格） -->
    <table v-else class="token-table">
      <thead>
        <tr>
          <th>名稱</th>
          <th>Token</th>
          <th>建立日期</th>
          <th>過期時間</th>
          <th>最後使用</th>
          <th>權限範圍</th>
          <th>狀態</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="token in sortedTokens" :key="token.id"
            :class="{ 'row-revoked': token.status === 'revoked', 'row-expired': token.status === 'expired' }">
          <td>{{ token.name }}</td>
          <td class="token-masked">{{ token.prefix }}</td>
          <td>{{ formatDate(token.created_at) }}</td>
          <td>{{ formatExpiry(token.expires_at) }}</td>
          <td>{{ formatDate(token.last_used_at) }}</td>
          <td>{{ token.scope === 'full' ? '完整操作' : '唯讀' }}</td>
          <td><span :class="'status-tag status-' + token.status">{{ statusLabel(token.status) }}</span></td>
          <td>
            <button v-if="token.status === 'active' || token.status === 'expiring_soon'"
                    class="btn-danger-small"
                    @click="revokingToken = token">
              撤銷
            </button>
          </td>
        </tr>
      </tbody>
    </table>

    <!-- Token 揭露 Modal -->
    <TokenRevealModal
      :show="showRevealModal"
      :token="revealToken"
      @copy="copyTokenToClipboard"
      @close="closeRevealModal"
    />

    <!-- 撤銷確認 Modal (重用既有 ConfirmModal) -->
    <ConfirmModal
      :show="!!revokingToken"
      :message="`確定要撤銷 Token『${revokingToken?.name}』嗎？使用此 Token 的服務將立即失去存取權。此操作無法復原。`"
      @confirm="revokingToken && confirmRevoke(revokingToken.id)"
      @cancel="revokingToken = null"
    />
  </div>
</template>
```

### 2.8 Router 修改（`router/index.ts`）

```typescript
// 新增 lazy import：
const TokenManageView = () => import('../views/TokenManageView.vue')

// 新增 route：
{ path: '/tokens', name: 'tokens', component: TokenManageView, meta: { auth: true } }
```

### 2.9 AppHeader 修改（`components/AppHeader.vue`）

```vue
<!-- 在 nav 區塊新增 API Tokens 連結，放在 Dashboard 和 Audit 之間： -->
<nav v-if="username" class="nav-group" aria-label="主導航">
  <router-link to="/" class="nav-item" :class="{ active: isDashboard }" data-testid="nav-dashboard">
    🏠 {{ t('nav.dashboard') }}
  </router-link>
  <router-link
    to="/tokens"
    class="nav-item"
    :class="{ active: isTokens }"
    data-testid="nav-tokens"
  >🔑 {{ t('nav.tokens') }}</router-link>
  <router-link to="/audit" class="nav-item" :class="{ active: isAudit }" data-testid="nav-audit">
    📋 {{ t('nav.audit') }}
  </router-link>
</nav>
```

`<script setup>` 中新增：

```typescript
const isTokens = computed(() => route.path === '/tokens')
```

---

## 3. API 合約

### 3.1 REST API 總覽

| 方法 | 路徑 | Auth | Request | Response | HTTP Status |
|------|------|:---:|---------|----------|:-----------:|
| `GET` | `/api/v1/tokens` | Session | — | `TokenListResponse` | 200 |
| `POST` | `/api/v1/tokens` | Session | `CreateTokenRequest` (JSON) | `CreateTokenResponse` | 201 |
| `POST` | `/api/v1/tokens/{id}/revoke` | Session | — | `RevokeTokenResponse` | 200 |

### 3.2 回應格式詳述

#### GET /api/v1/tokens — 成功

```json
{
  "data": [
    {
      "id": "a1b2c3d4-...",
      "name": "Jenkins CI",
      "prefix": "lsm_****a3eU9",
      "scope": "full",
      "created_at": "2025-08-10T12:00:00Z",
      "expires_at": "2025-11-08T12:00:00Z",
      "last_used_at": "2025-08-10T14:30:00Z",
      "status": "active"
    }
  ]
}
```

#### GET /api/v1/tokens — 空列表

```json
{ "data": [] }
```

#### POST /api/v1/tokens — 建立成功

```json
{
  "id": "a1b2c3d4-...",
  "token": "lsm_k3F8aB2xQ9vR7mW1pL5nY6dC0jH4tG8sA3eU9",
  "name": "Jenkins CI",
  "scope": "full",
  "expires_at": "2025-11-08T12:00:00Z"
}
```

#### POST /api/v1/tokens — 錯誤

| 錯誤情境 | HTTP | Body |
|---------|:---:|------|
| 名稱空白 | 400 | `{"error": "名稱為必填"}` |
| 名稱重複 | 409 | `{"error": "此名稱已存在，請使用其他名稱"}` |
| 達數量上限 | 400 | `{"error": "已達 Token 數量上限（20）"}` |
| 權限範圍無效 | 400 | `{"error": "無效的權限範圍"}` |
| 內部錯誤 | 500 | `{"error": "建立失敗，請稍後重試"}` |
| 未驗證 | 401 | `{"error": "unauthorized"}` (from session middleware) |

#### POST /api/v1/tokens/{id}/revoke — 成功

```json
{ "message": "Token 已撤銷", "status": "revoked" }
```

#### POST /api/v1/tokens/{id}/revoke — 已撤銷（冪等）

```json
{ "message": "Token 已撤銷", "status": "already_revoked" }
```

#### POST /api/v1/tokens/{id}/revoke — 錯誤

| 錯誤情境 | HTTP | Body |
|---------|:---:|------|
| Token 不存在 | 404 | `{"error": "Token 不存在"}` |
| 內部錯誤 | 500 | `{"error": "撤銷失敗，請重試"}` |
| 未驗證 | 401 | `{"error": "unauthorized"}` |

### 3.3 Auth Middleware 回應（Bearer Token 驗證）

| 錯誤情境 | HTTP | Body |
|---------|:---:|------|
| 未提供驗證資訊 | 401 | `{"error": "未提供驗證資訊"}` |
| Token 不存在 | 401 | `{"error": "Token 無效"}` |
| Token 已被撤銷 | 401 | `{"error": "Token 已被撤銷"}` |
| Token 已過期 | 401 | `{"error": "Token 已過期"}` |
| 唯讀 Token 寫入操作 | 403 | `{"error": "權限不足，此 Token 僅供唯讀"}` |

### 3.4 Request Context 值（供 handler 內部使用）

| Context Key | 值 | auth_method="token" | auth_method="session" |
|-------------|-----|:---:|:---:|
| `auth_method` | `"token"` 或 `"session"` | ✅ | ✅ |
| `token_name` | Token 名稱（string） | ✅ | ❌ |
| `token_scope` | `"read"` 或 `"full"` | ✅ | ❌ |

---

## 4. 資料流

### 4.1 Token 建立流程

```
管理員 UI                    Go Backend                     File System
    │                           │                               │
    │  POST /api/v1/tokens      │                               │
    │  {name, expires, scope}   │                               │
    │ ─────────────────────────→│                               │
    │                           │  1. Validate input            │
    │                           │  2. Check name uniqueness     │
    │                           │  3. Check count < 20          │
    │                           │  4. crypto/rand 32 bytes      │
    │                           │  5. sha256("lsm_" + b64)      │
    │                           │  6. Store Token{Hash, ...}    │
    │                           │ ─────────────────────────────→│ tokens.json
    │                           │                     (atomic   │
    │                           │                      write)   │
    │                           │  7. Audit: token_create       │
    │                           │ ─────────────────────────────→│ audit.jsonl
    │  201 {id, token, ...}     │                               │
    │ ←─────────────────────────│                               │
    │                           │                               │
    │  (reveal modal)           │                               │
    │  原始 Token 僅在            │                               │
    │  此回應中傳遞，不儲存        │                               │
```

### 4.2 Bearer Token 驗證流程

```
External Client              AuthMiddleware              Token Store
    │                           │                           │
    │  GET /api/v1/services     │                           │
    │  Authorization: Bearer... │                           │
    │ ─────────────────────────→│                           │
    │                           │  1. HasPrefix "Bearer "   │
    │                           │  2. Extract rawToken      │
    │                           │  3. Validate(rawToken)    │
    │                           │ ─────────────────────────→│
    │                           │     hash = sha256(raw)    │
    │                           │     lookup by hash        │
    │                           │     check revoked/expired │
    │                           │ ←──── token, err ────────│
    │                           │  4. Check scope           │
    │                           │  5. Set context           │
    │                           │  6. MarkUsed(id) → async  │
    │                           │  7. next.ServeHTTP()      │
    │                           │         ↓                 │
    │                           │    Handler 執行操作        │
    │  200 OK + data            │                           │
    │ ←─────────────────────────│                           │
```

### 4.3 Session Fallback 流程

```
Browser (logged in)         AuthMiddleware
    │                           │
    │  GET /api/v1/services     │
    │  Cookie: session_id=xxx   │
    │  (no Authorization header)│
    │ ─────────────────────────→│
    │                           │  1. No Bearer header
    │                           │  2. Fallback: auth.GetSession(r)
    │                           │  3. Check authenticated=true
    │                           │  4. Set context: auth_method=session
    │                           │  5. next.ServeHTTP()
    │  200 OK + data            │
    │ ←─────────────────────────│
```

### 4.4 Bearer + Session 共存優先級

```
Client sends BOTH:
  Cookie: session_id=xxx
  Authorization: Bearer lsm_yyyy

AuthMiddleware:
  1. Detects Bearer header → enters token path
  2. Token validation passes
  3. auth_method = "token"   ← 優先
  4. Session is IGNORED for this request

→ Token 永遠優先於 Session
→ Session 在沒有 Token 時才使用
→ Login / Logout 路由不使用 Composite middleware（僅 session）
```

---

## 5. 生命週期

### 5.1 Token Store 生命週期

```
main() 啟動
  │
  ├─ tokenStore := token.NewStore(path)
  ├─ tokenStore.Load()          ← 從 tokens.json 載入
  ├─ go tokenStore.RunLastUsedUpdater()  ← 啟動背景 goroutine
  │     │
  │     ├─ select { updateCh / ticker / shutdownCh }
  │     │   每 5s 或累積 10 筆 → flushLastUsed
  │     │
  │     └─ (持續直到 Shutdown)
  │
  ├─ defer tokenStore.Shutdown()  ← 優雅關閉
  │     ├─ close(shutdownCh)
  │     └─ flush 殘留 pending updates
  │
  └─ process exits
```

### 5.2 Token 狀態轉換圖

```
                Create
                  │
                  ▼
            ┌─────────┐
            │ active   │ ← 初始狀態
            └────┬─────┘
                 │
        ┌────────┼────────┐
        │        │        │
     Revoke   Time passes  Time passes
        │    7 days left    beyond expiry
        ▼        │              │
   ┌─────────┐   ▼              ▼
   │ revoked │ expiring_soon  expired
   └─────────┘  (UI 標籤)    (UI 標籤)
                    │
                    ▼
                expired
              (時間持續前進)
```

- **active**：未過期、未撤銷 → 可正常使用
- **expiring_soon**：過期時間在 7 天內 → UI 顯示 🟡「即將過期」，Token 仍可使用
- **expired**：過期時間已過 → UI 顯示 🔴「已過期」，Middleware 回傳 401
- **revoked**：管理員手動撤銷 → UI 顯示 ⚫「已撤銷」灰色，Middleware 回傳 401

---

## 6. 邊界條件處理

| # | 邊界情境 | 來源 | 處理方式 |
|---|---------|------|---------|
| 1 | Token 數量達上限（20） | BDD @edge-case | `Create()` 中檢查 active count ≥ 20，回傳明確錯誤；前端顯示對應訊息 |
| 2 | 並發撤銷同一 Token（冪等性） | BDD @edge-case | `Revoke()` 檢查 `token.Revoked`，若已為 true 不報錯，回傳 `status: "already_revoked"` |
| 3 | 建立 Token 後未複製就關閉 Modal | BDD @edge-case | Modal 不阻擋關閉（尊重使用者選擇）；關閉後 clear `revealToken` state，Token 值從前端記憶體移除 |
| 4 | Token 即將過期（7 天內） | BDD @edge-case | `List()` 中計算狀態：`expires_at - now < 7d` → `expiring_soon`；前端顯示 🟡 標籤 |
| 5 | Token 已過期顯示 | BDD @edge-case | `List()` 中計算狀態：`expires_at < now` → `expired`；前端顯示 🔴 標籤，置於列表底部 |
| 6 | 永不過期 Token | BDD @edge-case | `ExpiresAt = nil` → 驗證時跳過過期檢查，UI 顯示「永不過期」 |
| 7 | Token 名稱不區分大小寫唯一 | BDD @business-rules | `Create()` 前 `strings.EqualFold` 比對所有現有 Token 名稱 |
| 8 | Bearer Token 優先於 Cookie Session | BDD @business-rules | Middleware 先檢查 `Authorization` header，存在且有效時不 fallback |
| 9 | Cookie session 驗證不受 Token 機制影響 | BDD @business-rules | Login/Logout 路由不使用 Composite middleware；Token 管理路由僅用 session |
| 10 | Token 原始值不儲存 | BDD @business-rules | `Create()` 中 `sha256(raw)` 後僅儲存 hex hash；回應中 raw 值僅在 return 時傳遞一次 |
| 11 | Token 格式：前綴 `lsm_` + 48 字元 | BDD @business-rules | `crypto/rand.Read` 32 bytes → `base64.RawURLEncoding.EncodeToString` → prefix `lsm_` |
| 12 | `last_used_at` 非同步更新 | BDD @business-rules | `MarkUsed()` 寫入 buffered channel；背景 goroutine 批次寫入，不阻塞主請求 |
| 13 | Token 儲存檔案損毀 | Tech Decision 風險 | `Load()` 中 `os.ReadFile` 失敗時 log error，回傳空 map；管理員重新建立 Token |
| 14 | 並發寫入 tokens.json | Tech Decision | 所有讀取用 `RLock`，寫入用 `Lock`；`save()` 用 temp + rename atomic write |
| 15 | Auth header 格式錯誤（非 Bearer） | 測試計畫 MID-12 | `HasPrefix("Bearer ")` 失敗 → 直接 fallback session，不報錯（非 token 格式 = 無 token） |
| 16 | Authorization: Bearer（無 token 值） | 測試計畫 MID-13 | `TrimPrefix` 後為空 → 回傳 401 `{"error": "未提供驗證資訊"}` |

---

## 7. CSS 關鍵樣式

### 7.1 Token 狀態標籤

```css
/* Token 狀態標籤基礎 */
.status-tag {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 0.85rem;
  font-weight: 500;
  white-space: nowrap;
}

.status-active     { background: #e8f5e9; color: #2e7d32; }  /* 🟢 */
.status-expiring_soon { background: #fff3e0; color: #e65100; } /* 🟡 */
.status-expired    { background: #fbe9e7; color: #c62828; }  /* 🔴 */
.status-revoked    { background: #f5f5f5; color: #9e9e9e; }  /* ⚫ */
```

### 7.2 Token 遮罩值

```css
.token-masked {
  font-family: 'Fira Code', 'Cascadia Code', 'JetBrains Mono', monospace;
  font-size: 0.9rem;
  letter-spacing: 0.05em;
  user-select: all;
}
```

### 7.3 已撤銷/已過期 Token 行

```css
.row-revoked td,
.row-expired td {
  opacity: 0.5;
}

.row-expired {
  /* 置底效果由 JS computed 控制排序，此處僅視覺 */
}
```

### 7.4 Token 揭露 Modal Token 文字框

```css
.token-reveal-value {
  width: 100%;
  padding: 12px;
  font-family: 'Fira Code', 'Cascadia Code', 'JetBrains Mono', monospace;
  font-size: 1rem;
  background: var(--lms-bg-secondary, #f5f5f5);
  border: 1px solid var(--lms-border, #ccc);
  border-radius: 6px;
  resize: none;
  user-select: all;
  word-break: break-all;
}
```

### 7.5 揭露 Modal 警告區塊

```css
.token-reveal-warning {
  background: #fff3e0;
  border: 1px solid #ff9800;
  border-radius: 6px;
  padding: 12px 16px;
  margin-bottom: 16px;
  color: #e65100;
  font-weight: 500;
  display: flex;
  align-items: flex-start;
  gap: 8px;
}
```

### 7.6 Lite-modal 防止背景點擊關閉

```css
.lms-modal-overlay.no-backdrop-close {
  pointer-events: all; /* 背景不能點擊穿透 */
}
```

---

## 8. 開發順序

| 步驟 | 內容 | 依賴 | 預估 |
|:---:|------|:---:|:---:|
| 1 | `internal/token/token.go` — 資料結構定義、Token 格式與產生、SHA-256 hash、Validate、Create/List/Revoke 邏輯 | — | 2h |
| 2 | `internal/token/store.go` — JSON file 儲存層（Load/Save atomic、RWMutex）、RunLastUsedUpdater goroutine、Shutdown | #1 | 3h |
| 3 | `internal/token/token_test.go` — Token 模組單元測試（SYS-01~34） | #1 | 2h |
| 4 | `internal/token/store_test.go` — Store 並發測試 | #2 | 2h |
| 5 | `internal/audit/audit.go` — 新增 ActionTokenCreate / ActionTokenRevoke 及對應 displayLabels | — | 15m |
| 6 | `internal/middleware/auth.go` — 新增 AuthMiddlewareComposite（Bearer 優先 + Session fallback） | #2 | 2h |
| 7 | `internal/middleware/auth_test.go` — Composite middleware 單元測試（MID-01~15） | #6 | 2h |
| 8 | `internal/handler/handler.go` — Handler struct 新增 tokenStore 欄位；New 函數修改 | #2 | 15m |
| 9 | `internal/handler/json_handler.go` — 新增 HandleListTokens / HandleCreateToken / HandleRevokeToken | #2, #5, #8 | 3h |
| 10 | `internal/handler/handler_token_test.go` — Token handler 整合測試（HDL-01~16） | #9 | 2h |
| 11 | `main.go` — 初始化 token store、啟動 updater、路由註冊、middleware 替換 | #6, #9 | 1h |
| 12 | `frontend/src/types/service.ts` — 新增 Token 相關型別定義 | — | 20m |
| 13 | `frontend/src/api/client.ts` — 新增 listTokens / createToken / revokeToken | #12 | 20m |
| 14 | `frontend/src/composables/useTokenManager.ts` — Token 管理 composable | #12, #13 | 2h |
| 15 | `frontend/src/components/TokenCreateForm.vue` — 建立 Token 表單 | #14 | 1.5h |
| 16 | `frontend/src/components/TokenRevealModal.vue` — Token 揭露 Modal | #14 | 1h |
| 17 | `frontend/src/views/TokenManageView.vue` — Token 管理頁面主元件 | #14, #15, #16 | 3h |
| 18 | `frontend/src/components/AppHeader.vue` — 新增「API Tokens」導覽連結 | — | 15m |
| 19 | `frontend/src/router/index.ts` — 新增 /tokens 路由 | #17 | 15m |
| 20 | `frontend/src/__tests__/views/TokenManageView.spec.ts` — 前端單元測試（F-TK-01~20, F-CR-01~13, F-RV-01~08, F-RK-01~07） | #17 | 3h |
| 21 | E2E 測試（Playwright）Token 管理 + Bearer 驗證（E2E-01~47） | #11, #19 | 4h |

**總預估工時**：約 33 小時（約 4–5 工作天）

### 開發順序 DAG

```
#1 ──→ #2 ──→ #4
 │       │
 │       ├──→ #6 ──→ #7
 │       │       │
 │       ├──→ #8 ──→ #9 ──→ #10
 │       │       │       │
 │       │       │       └──→ #11 (main.go)
 │       │       │
 │       ├──→ #3
 │       │
 │       └──→ #5 ──→ (與 #9 合流)
 │
 #12 ──→ #13 ──→ #14 ──→ #15 ──┐
                        │       │
                        ├──→ #16 ──→ #17 ──→ #19
                        │                   │
                        └──→ #20            │
                                            │
 #18 ──────────────────────────────────────┤
                                            │
                                     #11 ──→ #21 (E2E)
```

---

## 9. 基礎架構設定

本功能**無需變更基礎架構設定**：

- **Nginx**：無需變更（純 REST API，非 WebSocket）
- **systemd**：無需變更（無新執行檔或服務）
- **環境變數**：無需新增（`SESSION_KEY` 已存在，`SESSION_TTL` 已在 websocket 使用）
- **檔案路徑**：僅新增 `/var/lib/linux-service-manager/tokens.json`（與 audit.jsonl 同目錄，權限 0600）
- **防火牆**：無需變更

---

## 10. 測試覆蓋矩陣

完整測試計畫已定義於 `docs/test-plans/011-api-token-auth測試計畫.md`。
以下確保開發規格中每個後端/前端實作項目皆有對應的測試案例：

| 實作項目 | 對應測試案例 |
|---------|-------------|
| `token.Create()` | SYS-01~02, SYS-11~17, SYS-18~28 |
| `token.List()` | SYS-06~08, SYS-29~32 |
| `token.Revoke()` | SYS-09~10 |
| `token.Validate()` (middleware) | SYS-03~05, SYS-33~34 |
| `token.Store` (JSON file) | SYS 單元測試 + INT-01, INT-06 |
| `AuthMiddlewareComposite` (Bearer) | MID-01~08, MID-12~14 |
| `AuthMiddlewareComposite` (Session fallback) | MID-09, MID-11 |
| `AuthMiddlewareComposite` (共存) | MID-10, MID-15, INT-03 |
| `HandleListTokens` | HDL-01~03, HDL-13, HDL-16 |
| `HandleCreateToken` | HDL-04~08, HDL-14 |
| `HandleRevokeToken` | HDL-09~12, HDL-15 |
| `useTokenManager` composable | F-TK-01~20 |
| `TokenCreateForm.vue` | F-CR-01~13 |
| `TokenRevealModal.vue` | F-RV-01~08 |
| `TokenManageView.vue` | F-RK-01~07 + F-TK-07~19 |
| Audit Log 整合 | INT-02, E2E-46~47, MAN-07 |
| E2E 完整流程 | E2E-01~45 |

**所有 BDD Scenario 覆蓋**：33/33（含 3 組 Scenario Outline 全部 Examples）

---

*產出日期：2025-08-12*
