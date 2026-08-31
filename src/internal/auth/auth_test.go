package auth

import (
	"testing"
)

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
