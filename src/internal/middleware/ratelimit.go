package middleware

import (
	"encoding/json"
	"net/http"
	"sync"
	"time"

	"linux-service-manager/internal/audit"
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
			ip := audit.ExtractClientIP(r)

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
