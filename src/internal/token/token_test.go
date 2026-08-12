package token

import (
	"crypto/sha256"
	"encoding/hex"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// ============================================================
//  Helper: create a temporary store for tests
// ============================================================

func newTestStore(t *testing.T) *Store {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "tokens.json")
	s := NewStore(path)
	// Must load to initialize the empty map
	if err := s.Load(); err != nil {
		t.Fatalf("failed to load test store: %v", err)
	}
	return s
}

func createTestToken(t *testing.T, s *Store, name string, expiresInDays int, scope Scope) *CreateTokenResponse {
	t.Helper()
	resp, err := s.Create(CreateTokenInput{
		Name:          name,
		ExpiresInDays: expiresInDays,
		Scope:         scope,
	})
	if err != nil {
		t.Fatalf("failed to create test token: %v", err)
	}
	return resp
}

// ============================================================
//  SYS-01: 正常建立 Token
// ============================================================

func TestTokenCreate_Success(t *testing.T) {
	s := newTestStore(t)

	resp, err := s.Create(CreateTokenInput{
		Name:          "Jenkins CI",
		ExpiresInDays: 90,
		Scope:         ScopeFull,
	})

	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}
	if resp == nil {
		t.Fatal("expected non-nil response")
	}
	if resp.Token == "" {
		t.Error("expected non-empty token")
	}
	if resp.ID == "" {
		t.Error("expected non-empty ID")
	}
	if resp.Name != "Jenkins CI" {
		t.Errorf("expected name 'Jenkins CI', got %q", resp.Name)
	}
	if resp.Scope != ScopeFull {
		t.Errorf("expected scope 'full', got %q", resp.Scope)
	}

	// Validate the token exists in store and has hash
	list := s.List()
	if len(list) != 1 {
		t.Fatalf("expected 1 token in list, got %d", len(list))
	}
}

// ============================================================
//  SYS-02: Token 原始值格式檢查
// ============================================================

func TestTokenFormat(t *testing.T) {
	s := newTestStore(t)
	resp := createTestToken(t, s, "test", 90, ScopeFull)

	if !strings.HasPrefix(resp.Token, TokenPrefix) {
		t.Errorf("token should start with %q, got %q", TokenPrefix, resp.Token)
	}
	// Token should be roughly prefix (4) + 43 base64url chars = ~47 chars
	if len(resp.Token) < 40 || len(resp.Token) > 60 {
		t.Errorf("expected token length ~48, got %d: %q", len(resp.Token), resp.Token)
	}
	// Should not contain + / = (Base64URL)
	if strings.ContainsAny(resp.Token, "+/=") {
		t.Errorf("token should not contain +/=: %q", resp.Token)
	}
}

// ============================================================
//  SYS-03: Token 僅儲存 SHA-256 hash
// ============================================================

func TestTokenOnlyHashStored(t *testing.T) {
	s := newTestStore(t)
	resp := createTestToken(t, s, "test", 90, ScopeFull)

	s.mu.RLock()
	tok := s.tokens[resp.ID]
	s.mu.RUnlock()

	if tok == nil {
		t.Fatal("token not found in store")
	}
	if tok.Hash == "" {
		t.Error("expected non-empty hash")
	}
	if tok.Hash == resp.Token {
		t.Error("hash should not equal raw token")
	}

	// Verify it's a real SHA-256 hash
	expectedHash := hex.EncodeToString(sha256Hash([]byte(resp.Token)))
	if tok.Hash != expectedHash {
		t.Errorf("hash mismatch: store=%q computed=%q", tok.Hash, expectedHash)
	}
}

// ============================================================
//  SYS-04: 儲存 hash 一致性
// ============================================================

func TestTokenHashConsistency(t *testing.T) {
	s := newTestStore(t)
	resp := createTestToken(t, s, "test", 90, ScopeFull)

	computedHash := hex.EncodeToString(sha256Hash([]byte(resp.Token)))

	s.mu.RLock()
	storedHash := s.tokens[resp.ID].Hash
	s.mu.RUnlock()

	if storedHash != computedHash {
		t.Errorf("hash mismatch: stored=%q computed=%q", storedHash, computedHash)
	}
}

// ============================================================
//  SYS-05: 建立 Token 後原始值不可再查詢
// ============================================================

func TestTokenRawValueNotRecoverable(t *testing.T) {
	s := newTestStore(t)
	createTestToken(t, s, "test", 90, ScopeFull)

	list := s.List()
	if len(list) != 1 {
		t.Fatalf("expected 1 token, got %d", len(list))
	}

	// The list response should only show prefix (masked), not raw value
	if list[0].Prefix == "" {
		t.Error("expected non-empty prefix")
	}
	// Prefix should contain "****"
	if !strings.Contains(list[0].Prefix, "****") {
		t.Errorf("expected prefix to contain '****', got %q", list[0].Prefix)
	}
}

// ============================================================
//  SYS-06: 列出 Token 列表（有資料）
// ============================================================

func TestTokenList_WithData(t *testing.T) {
	s := newTestStore(t)
	createTestToken(t, s, "Token A", 90, ScopeFull)
	createTestToken(t, s, "Token B", 60, ScopeRead)
	createTestToken(t, s, "Token C", 30, ScopeFull)

	list := s.List()
	if len(list) != 3 {
		t.Fatalf("expected 3 tokens, got %d", len(list))
	}

	// Each entry should have required fields
	for _, tr := range list {
		if tr.ID == "" {
			t.Error("expected non-empty ID")
		}
		if tr.Name == "" {
			t.Error("expected non-empty Name")
		}
		if tr.Prefix == "" {
			t.Error("expected non-empty Prefix")
		}
		if tr.Status == "" {
			t.Error("expected non-empty Status")
		}
	}
}

// ============================================================
//  SYS-07: 列出 Token 列表（無資料）
// ============================================================

func TestTokenList_Empty(t *testing.T) {
	s := newTestStore(t)
	list := s.List()
	if len(list) != 0 {
		t.Errorf("expected empty list, got %d items", len(list))
	}
}

// ============================================================
//  SYS-08: Token 列表依建立日期倒序
// ============================================================

func TestTokenList_SortedByCreatedAtDesc(t *testing.T) {
	s := newTestStore(t)
	createTestToken(t, s, "Oldest", 90, ScopeFull)
	time.Sleep(10 * time.Millisecond)
	createTestToken(t, s, "Middle", 90, ScopeFull)
	time.Sleep(10 * time.Millisecond)
	createTestToken(t, s, "Newest", 90, ScopeFull)

	list := s.List()
	if len(list) != 3 {
		t.Fatalf("expected 3 tokens, got %d", len(list))
	}

	// First should be newest
	if list[0].Name != "Newest" {
		t.Errorf("expected first token to be 'Newest', got %q", list[0].Name)
	}
	if list[2].Name != "Oldest" {
		t.Errorf("expected last token to be 'Oldest', got %q", list[2].Name)
	}
}

// ============================================================
//  SYS-09: 撤銷 Token（正常）
// ============================================================

func TestTokenRevoke_Success(t *testing.T) {
	s := newTestStore(t)
	resp := createTestToken(t, s, "Test Token", 90, ScopeFull)

	_, err := s.Revoke(resp.ID)
	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}

	s.mu.RLock()
	tok := s.tokens[resp.ID]
	s.mu.RUnlock()

	if !tok.Revoked {
		t.Error("expected token to be revoked")
	}

	// Verify list shows revoked status
	list := s.List()
	found := false
	for _, tr := range list {
		if tr.ID == resp.ID {
			found = true
			if tr.Status != StatusRevoked {
				t.Errorf("expected status 'revoked', got %q", tr.Status)
			}
		}
	}
	if !found {
		t.Error("revoked token not in list")
	}
}

// ============================================================
//  SYS-10: 撤銷已撤銷的 Token（冪等性）
// ============================================================

func TestTokenRevoke_Idempotent(t *testing.T) {
	s := newTestStore(t)
	resp := createTestToken(t, s, "Test Token", 90, ScopeFull)

	// First revoke
	if _, err := s.Revoke(resp.ID); err != nil {
		t.Fatalf("first revoke failed: %v", err)
	}

	// Second revoke should not error
	_, err := s.Revoke(resp.ID)
	if err != nil {
		t.Errorf("second revoke should not error (idempotent), got: %v", err)
	}
}

// ============================================================
//  SYS-11: 名稱唯一性檢查（完全相同）
// ============================================================

func TestTokenNameUniqueness_Exact(t *testing.T) {
	s := newTestStore(t)
	createTestToken(t, s, "Jenkins CI", 90, ScopeFull)

	_, err := s.Create(CreateTokenInput{
		Name:          "Jenkins CI",
		ExpiresInDays: 90,
		Scope:         ScopeFull,
	})

	if err == nil {
		t.Error("expected name duplicate error")
	}
	msg, ok := IsTokenError(err)
	if !ok || msg != ErrNameDuplicate.Error() {
		t.Errorf("expected name duplicate error, got: %v", err)
	}
}

// ============================================================
//  SYS-12: 名稱唯一性不區分大小寫
// ============================================================

func TestTokenNameUniqueness_CaseInsensitive(t *testing.T) {
	s := newTestStore(t)
	createTestToken(t, s, "Jenkins CI", 90, ScopeFull)

	_, err := s.Create(CreateTokenInput{
		Name:          "jenkins ci",
		ExpiresInDays: 90,
		Scope:         ScopeFull,
	})

	if err == nil {
		t.Error("expected name duplicate error for case-insensitive match")
	}
}

// ============================================================
//  SYS-13: 名稱空白檢查
// ============================================================

func TestTokenNameBlank_Empty(t *testing.T) {
	s := newTestStore(t)
	_, err := s.Create(CreateTokenInput{
		Name:          "",
		ExpiresInDays: 90,
		Scope:         ScopeFull,
	})

	if err == nil {
		t.Error("expected validation error for empty name")
	}
}

// ============================================================
//  SYS-14: 名稱純空白檢查
// ============================================================

func TestTokenNameBlank_Whitespace(t *testing.T) {
	s := newTestStore(t)
	_, err := s.Create(CreateTokenInput{
		Name:          "   ",
		ExpiresInDays: 90,
		Scope:         ScopeFull,
	})

	if err == nil {
		t.Error("expected validation error for whitespace-only name")
	}
}

// ============================================================
//  SYS-15: Token 數量上限（已達 20 個有效 Token）
// ============================================================

func TestTokenCountLimit_Reached(t *testing.T) {
	s := newTestStore(t)

	// Create 20 tokens
	for i := 0; i < MaxActiveTokens; i++ {
		name := "token-" + string(rune('a'+i))
		_, err := s.Create(CreateTokenInput{
			Name:          name,
			ExpiresInDays: 90,
			Scope:         ScopeFull,
		})
		if err != nil {
			t.Fatalf("failed to create token %d: %v", i, err)
		}
	}

	// Attempt to create the 21st token
	_, err := s.Create(CreateTokenInput{
		Name:          "overflow",
		ExpiresInDays: 90,
		Scope:         ScopeFull,
	})

	if err == nil {
		t.Error("expected limit exceeded error")
	}
}

// ============================================================
//  SYS-16: Token 數量上限（含已撤銷不計）
// ============================================================

func TestTokenCountLimit_RevokedNotCounted(t *testing.T) {
	s := newTestStore(t)

	// Create 20 active tokens
	for i := 0; i < MaxActiveTokens; i++ {
		name := "token-" + string(rune('a'+i))
		_, err := s.Create(CreateTokenInput{
			Name:          name,
			ExpiresInDays: 90,
			Scope:         ScopeFull,
		})
		if err != nil {
			t.Fatalf("failed to create token %d: %v", i, err)
		}
	}

	// Now revoke one
	list := s.List()
	if _, err := s.Revoke(list[0].ID); err != nil {
		t.Fatalf("failed to revoke: %v", err)
	}

	// Should be able to create a new one now (19 active + 1 revoked)
	resp, err := s.Create(CreateTokenInput{
		Name:          "new-one",
		ExpiresInDays: 90,
		Scope:         ScopeFull,
	})
	if err != nil {
		t.Errorf("should be able to create after revoke, got: %v", err)
	}
	if resp == nil {
		t.Error("expected non-nil response")
	}
}

// ============================================================
//  SYS-17: Token 數量未達上限可正常建立
// ============================================================

func TestTokenCountLimit_NotReached(t *testing.T) {
	s := newTestStore(t)

	// Create 19 tokens (one less than max)
	for i := 0; i < MaxActiveTokens-1; i++ {
		name := "token-" + string(rune('a'+i))
		s.Create(CreateTokenInput{
			Name:          name,
			ExpiresInDays: 90,
			Scope:         ScopeFull,
		})
	}

	// Should be able to create one more
	_, err := s.Create(CreateTokenInput{
		Name:          "last-one",
		ExpiresInDays: 90,
		Scope:         ScopeFull,
	})
	if err != nil {
		t.Errorf("expected success, got: %v", err)
	}
}

// ============================================================
//  SYS-18~22: 過期時間設定
// ============================================================

func TestTokenExpiry_30Days(t *testing.T) {
	s := newTestStore(t)
	before := time.Now().Add(29*24*time.Hour + 23*time.Hour)
	resp := createTestToken(t, s, "test-30", 30, ScopeFull)

	s.mu.RLock()
	tok := s.tokens[resp.ID]
	s.mu.RUnlock()

	if tok.ExpiresAt == nil {
		t.Fatal("expires_at should not be nil")
	}
	if tok.ExpiresAt.Before(before) {
		t.Errorf("expires_at too early: %v (expected after %v)", tok.ExpiresAt, before)
	}
}

func TestTokenExpiry_90Days(t *testing.T) {
	s := newTestStore(t)
	resp := createTestToken(t, s, "test-90", 90, ScopeFull)

	s.mu.RLock()
	tok := s.tokens[resp.ID]
	s.mu.RUnlock()

	if tok.ExpiresAt == nil {
		t.Fatal("expires_at should not be nil")
	}
	// Verify roughly 90 days from now (within a few hours due to rounding)
	expected := time.Now().Add(90 * 24 * time.Hour)
	diff := tok.ExpiresAt.Sub(expected)
	if diff < -1*time.Hour || diff > 1*time.Hour {
		t.Errorf("expires_at too far from expected: %v vs %v", tok.ExpiresAt, expected)
	}
}

func TestTokenExpiry_365Days(t *testing.T) {
	s := newTestStore(t)
	resp := createTestToken(t, s, "test-365", 365, ScopeFull)

	s.mu.RLock()
	tok := s.tokens[resp.ID]
	s.mu.RUnlock()

	if tok.ExpiresAt == nil {
		t.Fatal("expires_at should not be nil")
	}
	expected := time.Now().Add(365 * 24 * time.Hour)
	diff := tok.ExpiresAt.Sub(expected)
	if diff < -2*time.Hour || diff > 2*time.Hour {
		t.Errorf("expires_at too far from expected: %v vs %v", tok.ExpiresAt, expected)
	}
}

// ============================================================
//  SYS-23: 過期時間設定 — 永不過期
// ============================================================

func TestTokenExpiry_Never(t *testing.T) {
	s := newTestStore(t)
	resp, err := s.Create(CreateTokenInput{
		Name:          "never-expires",
		ExpiresInDays: -1,
		Scope:         ScopeFull,
	})

	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}

	s.mu.RLock()
	tok := s.tokens[resp.ID]
	s.mu.RUnlock()

	if tok.ExpiresAt != nil {
		t.Errorf("expected nil ExpiresAt for never-expiring token, got %v", tok.ExpiresAt)
	}
}

// ============================================================
//  SYS-24: 過期時間設定 — 自訂日期
// ============================================================

func TestTokenExpiry_Custom(t *testing.T) {
	s := newTestStore(t)
	customDate := time.Now().Add(200 * 24 * time.Hour).Truncate(time.Second)

	resp, err := s.Create(CreateTokenInput{
		Name:          "custom-expiry",
		ExpiresInDays: 0,
		CustomExpiry:  &customDate,
		Scope:         ScopeFull,
	})

	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}

	s.mu.RLock()
	tok := s.tokens[resp.ID]
	s.mu.RUnlock()

	if tok.ExpiresAt == nil {
		t.Fatal("expires_at should not be nil")
	}
	if !tok.ExpiresAt.Equal(customDate) {
		t.Errorf("expected %v, got %v", customDate, tok.ExpiresAt)
	}
}

// ============================================================
//  SYS-25: 過期時間無效（負數，非永久）
// ============================================================

func TestTokenExpiry_InvalidNegative(t *testing.T) {
	s := newTestStore(t)
	_, err := s.Create(CreateTokenInput{
		Name:          "invalid-expiry",
		ExpiresInDays: -5,
		Scope:         ScopeFull,
	})

	if err == nil {
		t.Error("expected validation error for negative expiry")
	}
}

// ============================================================
//  SYS-26~27: 權限範圍
// ============================================================

func TestTokenScope_Read(t *testing.T) {
	s := newTestStore(t)
	resp := createTestToken(t, s, "readonly-token", 90, ScopeRead)

	s.mu.RLock()
	tok := s.tokens[resp.ID]
	s.mu.RUnlock()

	if tok.Scope != ScopeRead {
		t.Errorf("expected scope 'read', got %q", tok.Scope)
	}
}

func TestTokenScope_Full(t *testing.T) {
	s := newTestStore(t)
	resp := createTestToken(t, s, "full-token", 90, ScopeFull)

	s.mu.RLock()
	tok := s.tokens[resp.ID]
	s.mu.RUnlock()

	if tok.Scope != ScopeFull {
		t.Errorf("expected scope 'full', got %q", tok.Scope)
	}
}

// ============================================================
//  SYS-28: 權限範圍無效
// ============================================================

func TestTokenScope_Invalid(t *testing.T) {
	s := newTestStore(t)
	_, err := s.Create(CreateTokenInput{
		Name:          "invalid-scope",
		ExpiresInDays: 90,
		Scope:         Scope("admin"),
	})

	if err == nil {
		t.Error("expected validation error for invalid scope")
	}
}

// ============================================================
//  SYS-29~32: Token 狀態計算
// ============================================================

func TestTokenStatus_Active(t *testing.T) {
	s := newTestStore(t)
	resp := createTestToken(t, s, "active-token", 90, ScopeFull)

	list := s.List()
	for _, tr := range list {
		if tr.ID == resp.ID {
			if tr.Status != StatusActive {
				t.Errorf("expected status 'active', got %q", tr.Status)
			}
			return
		}
	}
	t.Error("token not found in list")
}

func TestTokenStatus_ExpiringSoon(t *testing.T) {
	s := newTestStore(t)
	// Create a token that expires in 3 days (within the 7-day threshold)
	resp := createTestToken(t, s, "expiring-soon", 3, ScopeFull)

	list := s.List()
	for _, tr := range list {
		if tr.ID == resp.ID {
			if tr.Status != StatusExpiringSoon {
				t.Errorf("expected status 'expiring_soon', got %q", tr.Status)
			}
			return
		}
	}
	t.Error("token not found in list")
}

func TestTokenStatus_Expired(t *testing.T) {
	s := newTestStore(t)

	// Manually insert an expired token by manipulating the store
	id := "test-expired-id"
	pastTime := time.Now().Add(-1 * time.Hour)
	s.mu.Lock()
	s.tokens[id] = &Token{
		ID:         id,
		Name:       "expired-token",
		Hash:       "abcdef",
		PrefixHint: "lsm_test",
		Scope:      ScopeFull,
		CreatedAt:  time.Now().Add(-2 * time.Hour),
		ExpiresAt:  &pastTime,
		Revoked:    false,
	}
	s.mu.Unlock()

	list := s.List()
	for _, tr := range list {
		if tr.ID == id {
			if tr.Status != StatusExpired {
				t.Errorf("expected status 'expired', got %q", tr.Status)
			}
			return
		}
	}
	t.Error("token not found in list")
}

func TestTokenStatus_Revoked(t *testing.T) {
	s := newTestStore(t)
	resp := createTestToken(t, s, "revoked-token", 90, ScopeFull)

	s.Revoke(resp.ID)

	list := s.List()
	for _, tr := range list {
		if tr.ID == resp.ID {
			if tr.Status != StatusRevoked {
				t.Errorf("expected status 'revoked', got %q", tr.Status)
			}
			return
		}
	}
	t.Error("token not found in list")
}

// ============================================================
//  SYS-33: 最後使用時間初始化
// ============================================================

func TestTokenLastUsedAt_Initial(t *testing.T) {
	s := newTestStore(t)
	resp := createTestToken(t, s, "test", 90, ScopeFull)

	s.mu.RLock()
	tok := s.tokens[resp.ID]
	s.mu.RUnlock()

	if tok.LastUsedAt != nil {
		t.Errorf("expected nil LastUsedAt for fresh token, got %v", tok.LastUsedAt)
	}
}

// ============================================================
//  SYS-34: 最後使用時間非同步更新（基本驗證）
// ============================================================

func TestTokenLastUsedAt_AsyncUpdate(t *testing.T) {
	s := newTestStore(t)
	go s.RunLastUsedUpdater()
	defer s.Shutdown()

	resp := createTestToken(t, s, "test", 90, ScopeFull)

	// Validate the token and trigger MarkUsed
	validatedTok, err := s.Validate(resp.Token)
	if err != nil {
		t.Fatalf("expected validation to pass, got: %v", err)
	}
	if validatedTok == nil {
		t.Fatal("expected non-nil token from validation")
	}
	s.MarkUsed(validatedTok.ID)

	// Wait for async update (ticker fires every 5s)
	time.Sleep(6 * time.Second)

	s.mu.RLock()
	tok := s.tokens[resp.ID]
	s.mu.RUnlock()

	if tok.LastUsedAt == nil {
		t.Error("expected LastUsedAt to be updated asynchronously")
	}
}

// ============================================================
//  Store persistence tests
// ============================================================

func TestStoreLoad_SaveAndReload(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "tokens.json")

	// Create and populate store
	s1 := NewStore(path)
	if err := s1.Load(); err != nil {
		t.Fatalf("load failed: %v", err)
	}
	resp, err := s1.Create(CreateTokenInput{
		Name:          "persist-test",
		ExpiresInDays: 90,
		Scope:         ScopeFull,
	})
	if err != nil {
		t.Fatalf("create failed: %v", err)
	}

	// Load from file in a new store
	s2 := NewStore(path)
	if err := s2.Load(); err != nil {
		t.Fatalf("reload failed: %v", err)
	}

	list := s2.List()
	if len(list) != 1 {
		t.Fatalf("expected 1 token after reload, got %d", len(list))
	}
	if list[0].Name != "persist-test" {
		t.Errorf("expected name 'persist-test', got %q", list[0].Name)
	}
	_ = resp
}

func TestStoreLoad_NonExistentFile(t *testing.T) {
	s := NewStore("/tmp/nonexistent-dir/tokens-test.json")
	err := s.Load()
	// Should not error — creates empty map
	if err != nil {
		t.Errorf("expected nil error for nonexistent file, got: %v", err)
	}
}

func TestStoreRevoke_NotFound(t *testing.T) {
	s := newTestStore(t)
	_, err := s.Revoke("nonexistent-id")
	if err == nil {
		t.Error("expected error for nonexistent ID")
	}
}

// ============================================================
//  Validate tests (middleware)
// ============================================================

func TestTokenValidate_Success(t *testing.T) {
	s := newTestStore(t)
	resp := createTestToken(t, s, "test", 90, ScopeFull)

	tok, err := s.Validate(resp.Token)
	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}
	if tok == nil {
		t.Fatal("expected non-nil token")
	}
	if tok.Name != "test" {
		t.Errorf("expected name 'test', got %q", tok.Name)
	}
}

func TestTokenValidate_NotFound(t *testing.T) {
	s := newTestStore(t)
	_, err := s.Validate("lsm_fake123")

	if err == nil {
		t.Error("expected error for non-existent token")
	}
	if err.Error() != ErrTokenInvalid.Error() {
		t.Errorf("expected 'Token 無效', got %q", err.Error())
	}
}

func TestTokenValidate_Revoked(t *testing.T) {
	s := newTestStore(t)
	resp := createTestToken(t, s, "test", 90, ScopeFull)
	s.Revoke(resp.ID)

	_, err := s.Validate(resp.Token)
	if err == nil {
		t.Error("expected error for revoked token")
	}
	if err.Error() != ErrTokenRevoked.Error() {
		t.Errorf("expected 'Token 已被撤銷', got %q", err.Error())
	}
}

func TestTokenValidate_Expired(t *testing.T) {
	s := newTestStore(t)
	resp := createTestToken(t, s, "test", 90, ScopeFull)

	// Manually set token as expired
	pastTime := time.Now().Add(-1 * time.Hour)
	s.mu.Lock()
	s.tokens[resp.ID].ExpiresAt = &pastTime
	s.mu.Unlock()

	_, err := s.Validate(resp.Token)
	if err == nil {
		t.Error("expected error for expired token")
	}
	if err.Error() != ErrTokenExpired.Error() {
		t.Errorf("expected 'Token 已過期', got %q", err.Error())
	}
}

func TestTokenValidate_NeverExpires(t *testing.T) {
	s := newTestStore(t)
	resp, err := s.Create(CreateTokenInput{
		Name:          "never-expires",
		ExpiresInDays: -1,
		Scope:         ScopeFull,
	})
	if err != nil {
		t.Fatalf("create failed: %v", err)
	}

	tok, err := s.Validate(resp.Token)
	if err != nil {
		t.Fatalf("expected no error for never-expiring token, got: %v", err)
	}
	if tok == nil {
		t.Fatal("expected non-nil token")
	}
}

// ============================================================
//  CreateTokenInput.Validate tests
// ============================================================

func TestInputValidate_NameRequired(t *testing.T) {
	in := &CreateTokenInput{Name: "", ExpiresInDays: 90, Scope: ScopeFull}
	err := in.Validate()
	if err == nil {
		t.Error("expected validation error for empty name")
	}
}

func TestInputValidate_InvalidScope(t *testing.T) {
	in := &CreateTokenInput{Name: "test", ExpiresInDays: 90, Scope: "admin"}
	err := in.Validate()
	if err == nil {
		t.Error("expected validation error for invalid scope")
	}
}

func TestInputValidate_CustomExpiry(t *testing.T) {
	pastTime := time.Now().Add(-1 * time.Hour)
	in := &CreateTokenInput{Name: "test", ExpiresInDays: 0, CustomExpiry: &pastTime, Scope: ScopeFull}
	err := in.Validate()
	if err == nil {
		t.Error("expected validation error for past custom expiry")
	}
}

// ============================================================
//  Prefix masking tests
// ============================================================

func TestPrefixMasking(t *testing.T) {
	s := newTestStore(t)
	resp := createTestToken(t, s, "test", 90, ScopeFull)

	list := s.List()
	if len(list) != 1 {
		t.Fatalf("expected 1 token, got %d", len(list))
	}

	prefix := list[0].Prefix
	// Prefix should be like "lsm_****a3eU" (first 4 + **** + last 4)
	if !strings.Contains(prefix, "****") {
		t.Errorf("expected prefix to contain '****', got %q", prefix)
	}
	_ = resp
}

// ============================================================
//  Concurrent tests
// ============================================================

func TestStoreConcurrent_Create(t *testing.T) {
	s := newTestStore(t)
	done := make(chan bool)

	for i := 0; i < 10; i++ {
		go func(idx int) {
			name := "concurrent-" + string(rune('a'+idx))
			s.Create(CreateTokenInput{
				Name:          name,
				ExpiresInDays: 90,
				Scope:         ScopeFull,
			})
			done <- true
		}(i)
	}

	for i := 0; i < 10; i++ {
		<-done
	}

	list := s.List()
	if len(list) != 10 {
		t.Errorf("expected 10 tokens, got %d", len(list))
	}
}

func TestStoreConcurrent_ReadWrite(t *testing.T) {
	s := newTestStore(t)
	createTestToken(t, s, "initial", 90, ScopeFull)
	done := make(chan bool)

	// Concurrent reads and writes
	for i := 0; i < 5; i++ {
		go func() {
			for j := 0; j < 10; j++ {
				s.List()
			}
			done <- true
		}()
	}
	for i := 0; i < 3; i++ {
		go func(idx int) {
			name := "rw-" + string(rune('a'+idx))
			s.Create(CreateTokenInput{Name: name, ExpiresInDays: 90, Scope: ScopeFull})
			done <- true
		}(i)
	}

	for i := 0; i < 8; i++ {
		<-done
	}
}

// ============================================================
//  Helpers
// ============================================================

func sha256Hash(data []byte) []byte {
	h := sha256.Sum256(data)
	return h[:]
}
