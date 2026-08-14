package agent

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"

	"linux-service-manager/internal/systemd"
)

// agentDefaultVersion 是 Agent 內建版本（與 Manager 的 AgentMinVersion 同步，決策 3）。
// 可由 -ldflags 覆寫；server_test 直接指派 s.version。
const agentDefaultVersion = "1.2.0"

// serviceJSON 是 Agent 服務列表 schema（與單機 Manager JSON API 同構）。
type serviceJSON struct {
	Name          string `json:"name"`
	Load          string `json:"load"`
	Active        string `json:"active"`
	Sub           string `json:"sub"`
	UnitFileState string `json:"unitFileState"`
	FragmentPath  string `json:"fragmentPath"`
	Locked        bool   `json:"locked"`
}

// Server 組裝 Agent 的 chi router（決策 7 Agent 端點）。
type Server struct {
	cfg      *Config
	systemd  systemd.ServiceManager // 既有 interface，零改動（可注入 mock）
	version  string                 // 編譯期注入（-ldflags 或 const）
	hostname string
}

// NewServer 建立 Agent server。
func NewServer(cfg *Config, sm systemd.ServiceManager) *Server {
	hostname, _ := os.Hostname()
	if hostname == "" {
		hostname = "unknown"
	}
	return &Server{
		cfg:      cfg,
		systemd:  sm,
		version:  agentDefaultVersion,
		hostname: hostname,
	}
}

// Routes 回傳 chi Router：
//
//	GET  /health                      → 200 {version, hostname, os, uptime}；不驗證 token（test-connection 用，決策 7）
//	r.Group(tokenMiddleware)：        → 全部驗證 Authorization: Bearer == cfg.AuthToken；不符 → 401（決策 5）
//	  GET  /api/v1/services           → 服務列表（與單機 Manager JSON API 同構 schema）；?q= substring 過濾（決策 9）
//	  POST /api/v1/services/{name}/start|stop|restart|enable|disable → 操作 + 回傳更新後狀態
//	  GET  /api/v1/services/{name}/logs?lines= → 純文字 journal
//	  GET  /api/v1/system/info        → {os, kernel, uptime, cpu, mem, disk}（proxy 的 info 目標，決策 6）
func (s *Server) Routes() chi.Router {
	r := chi.NewRouter()

	r.Get("/health", s.handleHealth)

	r.Group(func(r chi.Router) {
		r.Use(s.tokenMiddleware)
		r.Get("/api/v1/services", s.handleListServices)
		r.Post("/api/v1/services/{name}/start", s.handleOp("start"))
		r.Post("/api/v1/services/{name}/stop", s.handleOp("stop"))
		r.Post("/api/v1/services/{name}/restart", s.handleOp("restart"))
		r.Post("/api/v1/services/{name}/enable", s.handleOp("enable"))
		r.Post("/api/v1/services/{name}/disable", s.handleOp("disable"))
		r.Get("/api/v1/services/{name}/logs", s.handleLogs)
		r.Get("/api/v1/system/info", s.handleSystemInfo)
	})

	return r
}

// tokenMiddleware 驗證 Authorization: Bearer == cfg.AuthToken；不符 → 401。
// mTLS 啟用時（cfg.ClientCert + RequireAndVerifyClientCert）於 TLS 層驗證 Manager 憑證（決策 5 方案 B）。
func (s *Server) tokenMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		const prefix = "Bearer "
		auth := r.Header.Get("Authorization")
		token := ""
		if strings.HasPrefix(auth, prefix) {
			token = strings.TrimPrefix(auth, prefix)
		}
		if token == "" || token != s.cfg.AuthToken {
			writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
			return
		}
		next.ServeHTTP(w, r)
	})
}

// RequireTLS 強制 HTTPS：明文 HTTP 連線回 426 Upgrade Required（決策 1）。
func RequireTLS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.TLS == nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusUpgradeRequired)
			_, _ = w.Write([]byte(`{"error":"TLS required"}`))
			return
		}
		next.ServeHTTP(w, r)
	})
}

// handleHealth 回傳 {version, hostname, os, uptime}（不驗證 token；test-connection 用）。
func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"version":  s.version,
		"hostname": s.hostname,
		"os":       osName(),
		"uptime":   uptimeSeconds(),
	})
}

// handleListServices 回傳服務列表（?q= substring 過濾，決策 9）。
func (s *Server) handleListServices(w http.ResponseWriter, r *http.Request) {
	services, err := s.systemd.ListServices()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "failed to list services"})
		return
	}

	q := strings.ToLower(r.URL.Query().Get("q"))
	result := make([]serviceJSON, 0, len(services))
	for _, svc := range services {
		if q != "" && !strings.Contains(strings.ToLower(svc.Name), q) {
			continue
		}
		result = append(result, serviceJSON{
			Name:          svc.Name,
			Load:          svc.Load,
			Active:        svc.Active,
			Sub:           svc.Sub,
			UnitFileState: svc.UnitFileState,
			FragmentPath:  svc.FragmentPath,
			Locked:        svc.Locked,
		})
	}
	writeJSON(w, http.StatusOK, result)
}

// handleOp 組裝 start/stop/restart/enable/disable 操作 handler。
func (s *Server) handleOp(action string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		name := chi.URLParam(r, "name")

		var err error
		switch action {
		case "start":
			err = s.systemd.StartService(name)
		case "stop":
			err = s.systemd.StopService(name)
		case "restart":
			err = s.systemd.RestartService(name)
		case "enable":
			err = s.systemd.EnableService(name)
		case "disable":
			err = s.systemd.DisableService(name)
		}

		if err != nil {
			// 操作失敗：錯誤回應含具體原因（Agent 端不隱藏錯誤細節）
			writeJSON(w, http.StatusInternalServerError, map[string]any{
				"error": fmt.Sprintf("failed to %s %s: %v", action, name, err),
			})
			return
		}

		writeJSON(w, http.StatusOK, map[string]any{
			"message": name + " " + actionVerb(action),
			"name":    name,
		})
	}
}

// handleLogs 回傳純文字 journal 日誌（?lines= 行數）。
func (s *Server) handleLogs(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")

	lines := 100
	if raw := r.URL.Query().Get("lines"); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n > 0 && n <= 1000 {
			lines = n
		}
	}

	logs, err := s.systemd.GetServiceLogs(name, lines)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{
			"error": fmt.Sprintf("failed to get logs for %s: %v", name, err),
		})
		return
	}

	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(logs))
}

// handleSystemInfo 回傳 {os, kernel, uptime, cpu, mem, disk}（proxy 的 info 目標，決策 6）。
func (s *Server) handleSystemInfo(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"os":     osName(),
		"kernel": kernelVersion(),
		"uptime": uptimeSeconds(),
		"cpu":    cpuInfo(),
		"mem":    memInfo(),
		"disk":   diskInfo(),
	})
}

// actionVerb 回傳操作動詞過去式（message 用）。
func actionVerb(action string) string {
	switch action {
	case "enable":
		return "enabled"
	case "disable":
		return "disabled"
	default:
		return action + "ed"
	}
}

// writeJSON 是 Agent 套件內的 JSON 回應 helper（與 Manager handler 同構）。
func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
