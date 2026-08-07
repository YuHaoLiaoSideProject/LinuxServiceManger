package middleware

import (
	"encoding/json"
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

// AuthMiddlewareJSON checks for an authenticated session.
// Unauthenticated requests receive 401 JSON instead of a redirect.
func AuthMiddlewareJSON(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		session := auth.GetSession(r)
		if authenticated, ok := session.Values["authenticated"].(bool); !ok || !authenticated {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusUnauthorized)
			json.NewEncoder(w).Encode(map[string]string{"error": "unauthorized"})
			return
		}
		next.ServeHTTP(w, r)
	})
}
