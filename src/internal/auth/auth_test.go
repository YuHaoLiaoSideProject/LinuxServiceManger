package auth

import (
	"testing"
)

// ============================================================
//  TEST: HasDefaultSecret (F11, F12)
// ============================================================

func TestHasDefaultSecret(t *testing.T) {
	tests := []struct {
		name       string
		sessionKey string
		adminPass  string
		want       bool // true = using defaults
	}{
		// F11: 正確設定所有安全性環境變數
		{"both set", "my-secret-key-32bytes!!", "strong-password", false},
		// F11: 未設定 SESSION_KEY
		{"missing session key", "", "strong-password", true},
		// F11: 未設定 ADMIN_PASS
		{"missing admin pass", "my-secret-key", "", true},
		// F11: 兩者都未設定
		{"both missing", "", "", true},
		// F12: 環境變數設為空白字串視為未設定 — SESSION_KEY 空白
		{"blank session key", "", "strong-password", true},
		// F12: 環境變數設為空白字串視為未設定 — ADMIN_PASS 空白
		{"blank admin pass", "my-key", "", true},
		// F12: 兩者皆為空白字串
		{"both blank", "", "", true},
		// Extra: only one set, other explicitly set to non-empty
		{"only session key set", "my-key", "", true},
		{"only admin pass set", "", "my-pass", true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Setenv("SESSION_KEY", tt.sessionKey)
			t.Setenv("ADMIN_PASS", tt.adminPass)

			got := HasDefaultSecret()
			if got != tt.want {
				t.Errorf("HasDefaultSecret() = %v, want %v (SESSION_KEY=%q, ADMIN_PASS=%q)",
					got, tt.want, tt.sessionKey, tt.adminPass)
			}
		})
	}
}

// ============================================================
//  TEST: Login (F41)
// ============================================================

func TestLogin(t *testing.T) {
	// Save original credentials and restore after test
	origUser, origPass := AdminUser, AdminPass
	AdminUser, AdminPass = "testadmin", "testpass"
	defer func() { AdminUser, AdminPass = origUser, origPass }()

	tests := []struct {
		name     string
		username string
		password string
		want     bool
	}{
		// F41: 使用正確帳號密碼登入 (BDD #1)
		{"correct credentials", "testadmin", "testpass", true},
		// F41: 使用錯誤密碼 (BDD #3)
		{"wrong password", "testadmin", "wrongpassword", false},
		// F41: 使用不存在的帳號 (BDD #4)
		{"wrong username", "nonexistent", "testpass", false},
		// F41: 空白帳號
		{"empty username", "", "testpass", false},
		// F41: 空白密碼
		{"empty password", "testadmin", "", false},
		// F41: 兩者皆空白
		{"both empty", "", "", false},
		// Extra: case sensitivity
		{"case different username", "TestAdmin", "testpass", false},
		{"case different password", "testadmin", "TestPass", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := Login(tt.username, tt.password)
			if got != tt.want {
				t.Errorf("Login(%q, %q) = %v, want %v", tt.username, tt.password, got, tt.want)
			}
		})
	}
}
