package handler

// node_proxy_handler.go — 4 類代理 handler（services/ops/logs/info，共用 AgentClient + audit）
// docs/development/014 §1.9.2

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"linux-service-manager/internal/audit"
	"linux-service-manager/internal/nodes"
)

// 代理 per-route 逾時（決策 6）：操作/logs 15s、info 10s。
const (
	proxyOpTimeout   = 15 * time.Second
	proxyInfoTimeout = 10 * time.Second
)

// isReachable 判斷節點狀態可否代理操作（online/degraded/warning 可達；offline/long_offline 禁）。
func isReachable(st nodes.Status) bool {
	return st == nodes.StatusOnline || st == nodes.StatusDegraded || st == nodes.StatusWarning
}

// proxyNode 共用流程：registry lookup（404）→ 離線檢查（502）→ 組 Agent URL → AgentClient.Do(ctx, …)
// → 錯誤映射（NodeOfflineError→502 {"error":"node offline"} / NodeTimeoutError→504）→ 回應轉寫
// （status/body 原樣，Agent 4xx/5xx 不吞錯，決策 6）→ audit（含 node_id/node_name）。
func (h *Handler) proxyNode(w http.ResponseWriter, r *http.Request, agentPath string, timeout time.Duration, auditAction audit.Action) {
	if h.Nodes == nil {
		writeJSON(w, http.StatusInternalServerError, messageJSON{Error: "nodes module not initialized"})
		return
	}

	id := chi.URLParam(r, "id")
	node := h.Nodes.Registry.Get(id)
	if node == nil {
		writeJSON(w, http.StatusNotFound, messageJSON{Error: "node not found"})
		return
	}
	if !isReachable(node.Status) {
		writeJSON(w, http.StatusBadGateway, messageJSON{Error: "node offline"})
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), timeout)
	defer cancel()

	code, body, err := h.Nodes.Client.Do(ctx, node, r.Method, agentPath, nil)
	if err != nil {
		var tErr *nodes.NodeTimeoutError
		if errors.As(err, &tErr) {
			h.writeNodeAudit(r, auditAction, node.ID, node.Name, r.URL.Path, audit.ResultFailure, "timeout")
			writeJSON(w, http.StatusGatewayTimeout, messageJSON{Error: "request timed out"})
			return
		}
		h.writeNodeAudit(r, auditAction, node.ID, node.Name, r.URL.Path, audit.ResultFailure, err.Error())
		writeJSON(w, http.StatusBadGateway, messageJSON{Error: "node offline"})
		return
	}

	// Agent 4xx/5xx 原樣轉寫（不吞錯誤，決策 6）；audit 依結果記錄
	result := audit.ResultSuccess
	if code >= 400 {
		result = audit.ResultFailure
	}
	h.writeNodeAudit(r, auditAction, node.ID, node.Name, r.URL.Path, result, "")

	if strings.Contains(r.URL.Path, "/logs") {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	} else {
		w.Header().Set("Content-Type", "application/json")
	}
	w.WriteHeader(code)
	_, _ = w.Write(body)
}

// HandleNodeServices — GET /api/v1/nodes/{id}/services → 代理 GET /api/v1/services（15s）
// 轉寫 Agent 原樣 schema（與單機 Dashboard 相同佈局，前端零適配）。
func (h *Handler) HandleNodeServices(w http.ResponseWriter, r *http.Request) {
	h.proxyNode(w, r, "/api/v1/services", proxyOpTimeout, "")
}

// serviceOpPath 組出 Agent 操作路徑（保留原 query，如 logs 的 lines=）。
func serviceOpPath(serviceName, action string) string {
	return "/api/v1/services/" + url.PathEscape(serviceName) + "/" + action
}

// HandleNodeServiceStart — POST /api/v1/nodes/{id}/services/{name}/start
func (h *Handler) HandleNodeServiceStart(w http.ResponseWriter, r *http.Request) {
	h.proxyNode(w, r, serviceOpPath(chi.URLParam(r, "name"), "start"), proxyOpTimeout, audit.ActionStart)
}

// HandleNodeServiceStop — POST /api/v1/nodes/{id}/services/{name}/stop
func (h *Handler) HandleNodeServiceStop(w http.ResponseWriter, r *http.Request) {
	h.proxyNode(w, r, serviceOpPath(chi.URLParam(r, "name"), "stop"), proxyOpTimeout, audit.ActionStop)
}

// HandleNodeServiceRestart — POST /api/v1/nodes/{id}/services/{name}/restart
func (h *Handler) HandleNodeServiceRestart(w http.ResponseWriter, r *http.Request) {
	h.proxyNode(w, r, serviceOpPath(chi.URLParam(r, "name"), "restart"), proxyOpTimeout, audit.ActionRestart)
}

// HandleNodeServiceEnable — POST /api/v1/nodes/{id}/services/{name}/enable
func (h *Handler) HandleNodeServiceEnable(w http.ResponseWriter, r *http.Request) {
	h.proxyNode(w, r, serviceOpPath(chi.URLParam(r, "name"), "enable"), proxyOpTimeout, audit.ActionEnable)
}

// HandleNodeServiceDisable — POST /api/v1/nodes/{id}/services/{name}/disable
func (h *Handler) HandleNodeServiceDisable(w http.ResponseWriter, r *http.Request) {
	h.proxyNode(w, r, serviceOpPath(chi.URLParam(r, "name"), "disable"), proxyOpTimeout, audit.ActionDisable)
}

// HandleNodeServiceLogs — GET /api/v1/nodes/{id}/services/{name}/logs?lines= → 代理同 path（15s）
// 純文字轉寫（text/plain）；lines query 原樣傳遞。
func (h *Handler) HandleNodeServiceLogs(w http.ResponseWriter, r *http.Request) {
	path := "/api/v1/services/" + url.PathEscape(chi.URLParam(r, "name")) + "/logs"
	if q := r.URL.RawQuery; q != "" {
		path += "?" + q
	}
	h.proxyNode(w, r, path, proxyOpTimeout, "")
}

// HandleNodeInfo — GET /api/v1/nodes/{id}/info → 代理 GET /api/v1/system/info（10s）
// 200 轉寫 {os, kernel, uptime, cpu, mem, disk}。
func (h *Handler) HandleNodeInfo(w http.ResponseWriter, r *http.Request) {
	h.proxyNode(w, r, "/api/v1/system/info", proxyInfoTimeout, "")
}
