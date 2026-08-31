package auth

import (
	"crypto/rand"
	"encoding/hex"
	"log"
	"net/http"
	"os"
	"sync"

	"github.com/gorilla/sessions"
)

var (
	store     *sessions.CookieStore
	AdminUser string
	AdminPass string

	setupOnce sync.Once
)

// Setup initializes the auth module by reading environment variables.
// It is safe to call multiple times; only the first call takes effect.
// This replaces the previous init() function to ensure deterministic
// initialization order and avoid depending on package init ordering.
func Setup() {
	setupOnce.Do(func() {
		key := os.Getenv("SESSION_KEY")
		if key == "" {
			log.Println("WARNING: SESSION_KEY not set, using randomly generated key (sessions will not survive restart)")
			b := make([]byte, 32)
			if _, err := rand.Read(b); err != nil {
				panic("failed to generate random session key: " + err.Error())
			}
			key = hex.EncodeToString(b)
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
	})
}

// MustValidate panics if ADMIN_PASS is not set. Call this early in main()
// to fail fast when the required secret is missing.
func MustValidate() {
	if os.Getenv("ADMIN_PASS") == "" {
		panic("ADMIN_PASS environment variable is required. Set it before starting.")
	}
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
