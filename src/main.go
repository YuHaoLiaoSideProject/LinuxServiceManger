package main

import (
	"context"
	"embed"
	"io/fs"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"linux-service-manager/internal/agentproto"
	"linux-service-manager/internal/audit"
	"linux-service-manager/internal/auth"
	"linux-service-manager/internal/handler"
	"linux-service-manager/internal/middleware"
	"linux-service-manager/internal/monitor"
	"linux-service-manager/internal/nodemonitor"
	"linux-service-manager/internal/noderegistry"
	"linux-service-manager/internal/nodeproxy"
	"linux-service-manager/internal/systemd"
	"linux-service-manager/internal/token"
	"linux-service-manager/internal/websocket"

	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"
)

//go:embed templates
var templatesFS embed.FS

//go:embed static
var staticFS embed.FS

func main() {
	// Initialize auth module (reads env vars, sets up session store).
	auth.Setup()

	// Ensure ADMIN_PASS is set before proceeding.
	auth.MustValidate()

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

	sm := &systemd.DefaultManager{}

	tokenStorePath := os.Getenv("TOKENS_FILE_PATH")
	if tokenStorePath == "" {
		tokenStorePath = "/var/lib/linux-service-manager/tokens.json"
	}
	tokenStore := token.NewStore(tokenStorePath)
	defer tokenStore.Shutdown()
	tokenStore.RunLastUsedUpdater()

	h := handler.New(templates, sm, auditMod, tokenStore)

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
		services, err := sm.ListServices()
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
	go monitor.StartMonitor(hub, sm)

	// Attach hub to handler
	h.Hub = hub

	// ── Multi-node Agent Management ──
	nodesPath := os.Getenv("NODES_FILE_PATH")
	if nodesPath == "" {
		nodesPath = "/var/lib/linux-service-manager/nodes.json"
	}
	reg, err := noderegistry.LoadRegistry(nodesPath)
	if err != nil {
		log.Fatalf("Failed to load nodes registry: %v", err)
	}

	binaryDir := os.Getenv("AGENT_BINARY_DIR")
	if binaryDir == "" {
		binaryDir = "/var/lib/linux-service-manager/agents"
	}

	agentHub := nodeproxy.NewHub()
	agentHub.Registry = reg

	mon := nodemonitor.New(reg, func(evt nodemonitor.StatusEvent) {
		hub.BroadcastMessage(websocket.Message{
			Type:     "node_status_changed",
			NodeID:   evt.NodeID,
			NodeName: evt.NodeName,
			Status:   evt.Status,
			Message:  evt.Message,
		})
	}, nodemonitor.Config{})
	go mon.Run(context.Background())

	agentHub.OnRegister = func(nodeID string, p agentproto.RegisterPayload) {
		mon.OnConnect(nodeID, p, "1.0")
	}
	agentHub.OnHeartbeat = func(nodeID string, stats noderegistry.HeartbeatStats) {
		mon.OnHeartbeat(nodeID, stats)
	}
	agentHub.OnDisconnect = func(nodeID string) {
		mon.OnDisconnect(nodeID)
	}

	nh := &handler.NodesHandler{
		Reg:       reg,
		AgentHub:  agentHub,
		Mon:       mon,
		PushHub:   hub,
		Audit:     auditMod,
		BinaryDir: binaryDir,
	}

	// ── Router ──
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

	// ── Nodes API (protected) ──
	r.Route("/api/v1/nodes", func(r chi.Router) {
		r.Use(middleware.AuthMiddlewareJSON)
		r.Post("/", nh.HandleCreateNode)
		r.Post("/test-connection", nh.HandleTestConnection)
		r.Get("/summary", nh.HandleSummary)
		r.Get("/agent-binary", nh.HandleAgentBinary)
		r.Get("/{id}", nh.HandleGetNode)
		r.Put("/{id}", nh.HandleUpdateNode)
		r.Delete("/{id}", nh.HandleDeleteNode)
		r.Post("/{id}/reconnect", nh.HandleReconnect)
		r.Get("/{id}/services", nh.HandleNodeServices)
		r.Post("/{id}/services/{name}/{action}", nh.HandleNodeAction)
		r.Get("/{id}/services/{name}/logs", nh.HandleNodeLogs)
		r.Get("/{id}/info", nh.HandleNodeInfo)
	})

	// Agent WebSocket endpoint — uses query token auth (not session-based auth).
	// Agents authenticate by passing ?token=<node-token> as a query parameter.
	// Router-level rate limit: blocks abusive IPs before upgrade/ReadMessage cost.
	r.Group(func(r chi.Router) {
		r.Use(middleware.RateLimit(5, time.Minute))
		r.Get("/api/v1/agent/ws", agentHub.ServeWS)
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

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	srv := &http.Server{
		Addr:              ":" + port,
		Handler:           r,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      60 * time.Second,
		IdleTimeout:       120 * time.Second,
		MaxHeaderBytes:    1 << 20, // 1MB
	}
	log.Printf("🚀 Linux Service Manager starting on http://localhost:%s", port)
	if err := srv.ListenAndServe(); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}
