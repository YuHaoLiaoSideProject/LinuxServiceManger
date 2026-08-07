package middleware

import (
	"net/http"

	"linux-service-manager/internal/auth"
)

// AuthMiddleware is a chi-compatible middleware that checks for an authenticated session.
// Unauthenticated requests are redirected to /login.
func AuthMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		session := auth.GetSession(r)
		if authenticated, ok := session.Values["authenticated"].(bool); !ok || !authenticated {
			http.Redirect(w, r, "/login", http.StatusFound)
			return
		}
		next.ServeHTTP(w, r)
	})
}
