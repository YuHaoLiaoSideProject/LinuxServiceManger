package websocket

import (
	"net/http"
	"os"
	"strings"
)

// CheckOrigin returns an Origin checker for WebSocket upgrades.
// It validates against the WS_ALLOWED_ORIGINS env var (comma-separated list).
// If the env var is empty, it allows all origins (dev-friendly default).
// Non-browser clients with no Origin header are always allowed.
func CheckOrigin() func(r *http.Request) bool {
	allowed := os.Getenv("WS_ALLOWED_ORIGINS")
	if allowed == "" {
		return func(r *http.Request) bool { return true }
	}

	origins := make(map[string]bool)
	for _, o := range strings.Split(allowed, ",") {
		origins[strings.TrimSpace(o)] = true
	}

	return func(r *http.Request) bool {
		origin := r.Header.Get("Origin")
		if origin == "" {
			return true // non-browser clients (curl, scripts, etc.)
		}
		return origins[origin]
	}
}
