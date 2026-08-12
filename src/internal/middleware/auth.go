package middleware

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"

	"linux-service-manager/internal/auth"
	"linux-service-manager/internal/token"
)

// ============================================================
//  Context keys for auth info
// ============================================================

type contextKey string

const (
	CtxKeyAuthMethod contextKey = "auth_method"
	CtxKeyTokenName  contextKey = "token_name"
	CtxKeyTokenScope contextKey = "token_scope"
)

// ============================================================
//  AuthMiddleware (HTML routes — redirect to /login)
// ============================================================

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

// ============================================================
//  AuthMiddlewareJSON (JSON API — session only)
// ============================================================

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

// ============================================================
//  AuthMiddlewareComposite (Bearer token first, session fallback)
// ============================================================

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

// ============================================================
//  Helpers
// ============================================================

// isReadOnlyMethod returns true for safe HTTP methods.
func isReadOnlyMethod(method string) bool {
	return method == http.MethodGet || method == http.MethodHead || method == http.MethodOptions
}

// writeJSON writes a JSON response with the given status code.
func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}
