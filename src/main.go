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

	"linux-service-manager/internal/audit"
	"linux-service-manager/internal/auth"
	"linux-service-manager/internal/handler"
	"linux-service-manager/internal/middleware"
	"linux-service-manager/internal/monitor"
	"linux-service-manager/internal/nodes"
	"linux-service-manager/internal/notify"
	"linux-service-manager/internal/systemd"
	"linux-service-manager/internal/token"
	"linux-service-manager/internal/websocket"

	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"
	httpSwagger "github.com/swaggo/http-swagger/v2"
	_ "linux-service-manager/docs"
)

//go:embed templates
var templatesFS embed.FS

//go:embed static
var staticFS embed.FS

//go:embed agents/agent-linux-amd64 agents/agent-linux-arm64
var agentBinariesFS embed.FS

// @title Linux Service Manager API
// @version 1.0.0
// @description
// Linux Service Manager 的 REST API。
//
// **認證方式**（除登入/登出/session 外皆需要）：
// 1. **API Token**：`Authorization: Bearer lsm_...`（於「API Tokens」頁面建立）。
//   - `read` scope：僅允許 GET/HEAD/OPTIONS，寫入操作回傳 403。
//   - `full` scope：允許所有操作。
//
// 2. **Session Cookie**：瀏覽器登入後自動帶上（`session` cookie）。
//
// **錯誤格式**：非 2xx 回應一律為 `{"error": "說明"}`。
//
// **WebSocket**：`/api/v1/ws`（服務狀態推送）與 `/api/v1/services/{name}/logs/ws`（即時日誌）
// 皆需認證 — 支援自訂 header 的 WebSocket 客戶端可帶 `Authorization: Bearer` header；
// 瀏覽器原生 WebSocket 無法自訂 header，需使用 session cookie。
//
// **互動式文件**：登入後於 SPA 導覽列「API 文件」頁（或直接存取 `/api/v1/docs/`）。
// @BasePath /api/v1
// @securityDefinitions.apikey BearerAuth
// @in header
// @name Authorization
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

	// Initialize token store
	tokenStore := token.NewStore("/var/lib/linux-service-manager/tokens.json")
	if err := tokenStore.Load(); err != nil {
		log.Fatalf("failed to load token store: %v", err)
	}
	go tokenStore.RunLastUsedUpdater()
	defer tokenStore.Shutdown()

	h := handler.New(templates, &systemd.DefaultManager{}, auditMod, tokenStore)

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

	// Initialize notify module (webhook notification) — before hub.Run registration
	notifyMod := notify.New(notify.Config{
		ChannelsPath:  "/var/lib/linux-service-manager/notify.json",
		HistoryPath:   "/var/lib/linux-service-manager/notify-history.jsonl",
		RetentionDays: 30,
		Hub:           hub,
	})
	if err := notifyMod.Load(); err != nil {
		log.Fatalf("failed to load notify store: %v", err)
	}
	hub.OnStatusChange = notifyMod.HandleStatusChange
	go notifyMod.Run()
	defer notifyMod.Shutdown()
	h.Notify = notifyMod

	go hub.Run()

	// 多機節點管理（014）：registry 載入 + supervisor 狀態機 + AgentClient
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	nodeMod, err := nodes.New(nodes.Config{
		RegistryPath:    "/var/lib/linux-service-manager/nodes.json",
		Hub:             hub,
		AgentMinVersion: "1.2.0",
	})
	if err != nil {
		log.Fatalf("failed to load node registry: %v", err)
	}
	go nodeMod.Supervisor.Run(ctx) // 5s ticker 狀態機（狀態變更才推播）
	h.Nodes = nodeMod

	// Agent binary（決策 7：CI 建置後嵌入 Manager binary）
	if agentSub, subErr := fs.Sub(agentBinariesFS, "agents"); subErr == nil {
		handler.SetAgentBinaries(agentSub)
	} else {
		log.Printf("WARNING: failed to open agents FS: %v", subErr)
	}

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

	// 心跳接收（Auth 群組外 — Agent 以節點 Bearer token 自證，D-8）
	r.Post("/api/v1/agent/heartbeat", h.HandleAgentHeartbeat)

	// Token management routes (session-only — managing tokens requires session auth)
	r.Group(func(r chi.Router) {
		r.Use(middleware.AuthMiddlewareJSON)
		r.Get("/api/v1/tokens", h.HandleListTokens)
		r.Post("/api/v1/tokens", h.HandleCreateToken)
		r.Post("/api/v1/tokens/{id}/revoke", h.HandleRevokeToken)
	})

	// JSON API (Vue SPA backend) — protected
	r.Group(func(r chi.Router) {
		r.Use(middleware.AuthMiddlewareComposite(tokenStore))
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
		// Service config editor (012)
		r.Get("/api/v1/services/{name}/config", h.HandleGetServiceConfig)
		r.Put("/api/v1/services/{name}/config", h.HandleSaveServiceConfig)
		r.Post("/api/v1/services/{name}/config/validate", h.HandleValidateServiceConfig)
		// Interactive API documentation (swagger-ui)
		r.Get("/api/v1/docs/*", httpSwagger.Handler(httpSwagger.URL("/api/v1/docs/doc.json")))
		// Webhook notification (013)
		r.Get("/api/v1/notify/channels", h.HandleListChannels)
		r.Post("/api/v1/notify/channels", h.HandleCreateChannel)
		r.Put("/api/v1/notify/channels/{id}", h.HandleUpdateChannel)
		r.Delete("/api/v1/notify/channels/{id}", h.HandleDeleteChannel)
		r.Patch("/api/v1/notify/channels/{id}", h.HandlePatchChannelEnabled)
		r.Post("/api/v1/notify/channels/{id}/test", h.HandleTestChannel)
		r.Get("/api/v1/notify/history", h.HandleNotifyHistory)
		// 多機節點管理（014）— ⚠️ chi 路由註冊順序：靜態段（summary/search/test-connection）先於 {id} 參數段
		r.Get("/api/v1/nodes", h.HandleListNodes)
		r.Post("/api/v1/nodes", h.HandleCreateNode)
		r.Get("/api/v1/nodes/summary", h.HandleNodesSummary)
		r.Get("/api/v1/nodes/services/search", h.HandleSearchServices)
		r.Post("/api/v1/nodes/test-connection", h.HandleTestConnection)
		r.Get("/api/v1/nodes/{id}", h.HandleGetNode)
		r.Put("/api/v1/nodes/{id}", h.HandleUpdateNode)
		r.Delete("/api/v1/nodes/{id}", h.HandleDeleteNode)
		r.Get("/api/v1/nodes/{id}/services", h.HandleNodeServices)
		r.Post("/api/v1/nodes/{id}/services/{name}/start", h.HandleNodeServiceStart)
		r.Post("/api/v1/nodes/{id}/services/{name}/stop", h.HandleNodeServiceStop)
		r.Post("/api/v1/nodes/{id}/services/{name}/restart", h.HandleNodeServiceRestart)
		r.Post("/api/v1/nodes/{id}/services/{name}/enable", h.HandleNodeServiceEnable)
		r.Post("/api/v1/nodes/{id}/services/{name}/disable", h.HandleNodeServiceDisable)
		r.Get("/api/v1/nodes/{id}/services/{name}/logs", h.HandleNodeServiceLogs)
		r.Get("/api/v1/nodes/{id}/info", h.HandleNodeInfo)
		r.Get("/api/v1/agents/download", h.HandleAgentDownload)
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
