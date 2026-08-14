package nodes

import (
	"encoding/json"
	"net/http"
)

// Heartbeat 是 Agent → Manager 的心跳 payload（決策 3）。
type Heartbeat struct {
	NodeName      string       `json:"node_name"`
	AgentVersion  string       `json:"agent_version"`
	Hostname      string       `json:"hostname"`
	OS            string       `json:"os"`
	UptimeSeconds int64        `json:"uptime_seconds"`
	Services      ServiceStats `json:"services"`  // {total, active, failed} — Aggregate 摘要免代理查詢
	Timestamp     string       `json:"timestamp"` // RFC3339 UTC
}

// HeartbeatHandler 是心跳接收端（持有 registry 引用；由 handler 包的 HandleAgentHeartbeat 橋接委派）。
type HeartbeatHandler struct {
	registry *Registry
}

// NewHeartbeatHandler 建立心跳接收 handler。
func NewHeartbeatHandler(reg *Registry) *HeartbeatHandler {
	return &HeartbeatHandler{registry: reg}
}

// Handle 是 POST /api/v1/agent/heartbeat 的處理邏輯（在 Auth 群組外，token 自證）：
//
//  1. 解析 JSON body → 非法 → 400（不更新）
//  2. bearerToken(r) 與 hb.NodeName 交 Registry.VerifyToken 驗證 → 不符 → 401
//     （Agent 記錄錯誤並依 backoff 重試，決策 5；BDD @multi-manager 第二 Manager 被拒）
//  3. Registry.SetHeartbeat(hb.NodeName, hb) — last_heartbeat=now + stats + version（Status 由 supervisor 判定）
//  4. 回 200 {"ok":true,"accepted":true}
func (h *HeartbeatHandler) Handle(w http.ResponseWriter, r *http.Request) {
	var hb Heartbeat
	if err := json.NewDecoder(r.Body).Decode(&hb); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid heartbeat payload"})
		return
	}

	if !h.registry.VerifyToken(hb.NodeName, bearerToken(r)) {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}

	h.registry.SetHeartbeat(hb.NodeName, hb)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "accepted": true})
}

// bearerToken 自 Authorization: Bearer <token> 抽取。
func bearerToken(r *http.Request) string {
	const prefix = "Bearer "
	auth := r.Header.Get("Authorization")
	if len(auth) <= len(prefix) || auth[:len(prefix)] != prefix {
		return ""
	}
	return auth[len(prefix):]
}

// writeJSON 為 nodes 套件內的 JSON 回應 helper（與 handler 包同構）。
func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
