package middleware

import (
	"encoding/json"
	"net/http"
	"sync"
	"time"
)

// RateLimit returns a middleware that limits requests per client IP.
// maxRequests: maximum number of requests allowed within the window.
// window: the sliding time window.
func RateLimit(maxRequests int, window time.Duration) func(http.Handler) http.Handler {
	type entry struct {
		count   int
		resetAt time.Time
	}

	var mu sync.Mutex
	clients := make(map[string]*entry)

	// Background cleanup of expired entries every 5 minutes
	go func() {
		for {
			time.Sleep(5 * time.Minute)
			mu.Lock()
			now := time.Now()
			for ip, e := range clients {
				if now.After(e.resetAt) {
					delete(clients, ip)
				}
			}
			mu.Unlock()
		}
	}()

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ip := extractIP(r)

			mu.Lock()
			now := time.Now()
			e, exists := clients[ip]
			if !exists || now.After(e.resetAt) {
				clients[ip] = &entry{count: 1, resetAt: now.Add(window)}
				mu.Unlock()
				next.ServeHTTP(w, r)
				return
			}

			e.count++
			if e.count > maxRequests {
				mu.Unlock()
				w.Header().Set("Content-Type", "application/json")
				w.Header().Set("Retry-After", "60")
				w.WriteHeader(http.StatusTooManyRequests)
				json.NewEncoder(w).Encode(map[string]string{
					"error": "too many login attempts, please try again later",
				})
				return
			}
			mu.Unlock()
			next.ServeHTTP(w, r)
		})
	}
}

// extractIP extracts the client IP, preferring X-Forwarded-For over RemoteAddr.
func extractIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		parts := splitComma(xff)
		if len(parts) > 0 {
			return parts[0]
		}
	}
	// Use RemoteAddr directly (it includes port, but that's fine for rate limiting)
	return r.RemoteAddr
}

func splitComma(s string) []string {
	var parts []string
	start := 0
	for i := 0; i < len(s); i++ {
		if s[i] == ',' {
			parts = append(parts, trimSpace(s[start:i]))
			start = i + 1
		}
	}
	parts = append(parts, trimSpace(s[start:]))
	return parts
}

func trimSpace(s string) string {
	for len(s) > 0 && s[0] == ' ' {
		s = s[1:]
	}
	for len(s) > 0 && s[len(s)-1] == ' ' {
		s = s[:len(s)-1]
	}
	return s
}
