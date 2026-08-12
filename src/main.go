package main

import (
	"embed"
	"io/fs"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"linux-service-manager/internal/audit"
	"linux-service-manager/internal/auth"
	"linux-service-manager/internal/handler"
	"linux-service-manager/internal/middleware"
	"linux-service-manager/internal/monitor"
	"linux-service-manager/internal/systemd"
	"linux-service-manager/internal/websocket"

	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"
)

//go:embed templates
var templatesFS embed.FS

//go:embed static
var staticFS embed.FS

func main() {
	// Extract the templates directory as a sub-filesystem
	templates, err := fs.Sub(templatesFS, "templates")
	if err != nil {
		log.Fatalf("failed to open templates: %v", err)
	}

	auditMod := audit.New(audit.Config{
		FilePath:      "/var/lib/linux-service-manager/audit.jsonl",
		MaxFileSizeMB: 100,
		RetentionDays: 90,
	})
	defer auditMod.Shutdown()

	h := handler.New(templates, &systemd.DefaultManager{}, auditMod)

	// Initialize WebSocket Hub for real-time status push
	hub := websocket.NewHub()
	if ttlStr := os.Getenv("SESSION_TTL"); ttlStr != "" {
		if ttl, err := time.ParseDuration(ttlStr); err == nil && ttl > 0 {
			hub.SessionTTL = ttl
			log.Printf("WebSocket session TTL set to %v (from SESSION_TTL env)", ttl)
		} else {
			log.Printf("WARNING: invalid SESSION_TTL=%q, using default %v", ttlStr, hub.SessionTTL)
		}
	}
	hub.OnSnapshot = func() []websocket.ServiceSnapshot {
		services, err := (&systemd.DefaultManager{}).ListServices()
		if err != nil {
			return nil
		}
		snapshots := make([]websocket.ServiceSnapshot, len(services))
		for i, s := range services {
			snapshots[i] = websocket.ServiceSnapshot{
				Name:          s.Name,
				Active:        s.Active,
				Sub:           s.Sub,
				UnitFileState: s.UnitFileState,
			}
		}
		return snapshots
	}
	go hub.Run()

	// Start service status monitor (D-Bus or polling fallback)
	go monitor.StartMonitor(hub, &systemd.DefaultManager{})

	// Attach hub to handler
	h.Hub = hub

	r := chi.NewRouter()
	r.Use(chimw.Logger)
	r.Use(chimw.Recoverer)

	// JSON API (Vue SPA backend) — public
	r.Group(func(r chi.Router) {
		r.Use(middleware.RateLimit(5, time.Minute)) // 5 attempts per minute per IP
		r.Post("/api/v1/login", h.HandleLoginJSON)
	})
	r.Post("/api/v1/logout", h.HandleLogoutJSON)
	r.Get("/api/v1/session", h.HandleSessionCheck)

	// JSON API (Vue SPA backend) — protected
	r.Group(func(r chi.Router) {
		r.Use(middleware.AuthMiddlewareJSON)
		r.Get("/api/v1/services", h.HandleServicesJSON)
		r.Post("/api/v1/services/{name}/start", h.HandleStartJSON)
		r.Post("/api/v1/services/{name}/stop", h.HandleStopJSON)
		r.Post("/api/v1/services/{name}/restart", h.HandleRestartJSON)
		r.Post("/api/v1/services/{name}/enable", h.HandleEnableJSON)
		r.Post("/api/v1/services/{name}/disable", h.HandleDisableJSON)
		r.Post("/api/v1/services/batch", h.HandleBatchServices)
		r.Get("/api/v1/services/{name}/logs/ws", h.HandleServiceLogsWS)
		r.Get("/api/v1/ws", h.HandleStatusWS)
		r.Get("/api/v1/audit", h.HandleAuditQuery)
		r.Get("/api/v1/audit/export", h.HandleAuditExport)
	})

	// HTML routes (legacy htmx) — protected
	r.Group(func(r chi.Router) {
		r.Use(middleware.AuthMiddleware)
		r.Get("/htmx", h.HandleIndex)
		r.Get("/services", h.HandleServices)
		r.Post("/api/services/{name}/start", h.HandleStart)
		r.Post("/api/services/{name}/stop", h.HandleStop)
		r.Post("/api/services/{name}/restart", h.HandleRestart)
	})

	// Serve Vue SPA static files
	staticSub, err := fs.Sub(staticFS, "static")
	if err != nil {
		log.Fatalf("failed to open static: %v", err)
	}
	staticHandler := http.FileServer(http.FS(staticSub))

	r.Get("/assets/*", func(w http.ResponseWriter, r *http.Request) {
		staticHandler.ServeHTTP(w, r)
	})
	r.Get("/favicon.svg", func(w http.ResponseWriter, r *http.Request) {
		staticHandler.ServeHTTP(w, r)
	})

	// SPA fallback: try static file first, then serve index.html
	r.Get("/*", func(w http.ResponseWriter, r *http.Request) {
		// Skip API routes (already handled above)
		if strings.HasPrefix(r.URL.Path, "/api/") {
			http.NotFound(w, r)
			return
		}
		// Try to serve as static file first (for PWA sw.js, manifest.json, etc.)
		path := strings.TrimPrefix(r.URL.Path, "/")
		if path == "" {
			path = "index.html"
		}
		f, err := staticSub.Open(path)
		if err == nil {
			f.Close()
			staticHandler.ServeHTTP(w, r)
			return
		}
		// Fall back to SPA index.html
		indexContent, err := staticFS.ReadFile("static/index.html")
		if err != nil {
			http.Error(w, "SPA not built — run: cd frontend && npm run build", http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write(indexContent)
	})

	// Reject startup if security-critical environment variables are not set.
	if auth.HasDefaultSecret() {
		log.Fatal("SESSION_KEY and ADMIN_PASS environment variables are required. Set them before starting.")
	}

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	log.Printf("🚀 Linux Service Manager starting on http://localhost:%s", port)
	if err := http.ListenAndServe(":"+port, r); err != nil {
		log.Fatalf("server error: %v", err)
	}
}
