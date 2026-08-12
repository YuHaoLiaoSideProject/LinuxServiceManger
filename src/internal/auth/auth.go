package auth

import (
	"net/http"
	"os"

	"github.com/gorilla/sessions"
)

var (
	store     *sessions.CookieStore
	AdminUser string
	AdminPass string
)

func init() {
	key := os.Getenv("SESSION_KEY")
	if key == "" {
		key = "linux-service-manager-secret-key-change-me"
	}
	store = sessions.NewCookieStore([]byte(key))
	store.Options = &sessions.Options{
		Path:     "/",
		MaxAge:   1800, // 30 minutes
		HttpOnly: true,
		Secure:   os.Getenv("SECURE_COOKIE") != "false",
		SameSite: http.SameSiteLaxMode,
	}

	AdminUser = os.Getenv("ADMIN_USER")
	if AdminUser == "" {
		AdminUser = "admin"
	}
	AdminPass = os.Getenv("ADMIN_PASS")
	if AdminPass == "" {
		AdminPass = "admin123"
	}
}

// HasDefaultSecret returns true if SESSION_KEY or ADMIN_PASS were not
// explicitly set via environment variables (i.e. the hardcoded fallbacks are in use).
func HasDefaultSecret() bool {
	return os.Getenv("SESSION_KEY") == "" || os.Getenv("ADMIN_PASS") == ""
}

// Login validates the username and password against configured credentials.
func Login(username, password string) bool {
	return username == AdminUser && password == AdminPass
}

// GetSession retrieves the current session from the request.
func GetSession(r *http.Request) *sessions.Session {
	session, _ := store.Get(r, "linux-service-manager")
	return session
}

// SaveSession persists the session to the response.
func SaveSession(w http.ResponseWriter, r *http.Request, session *sessions.Session) {
	session.Save(r, w)
}
