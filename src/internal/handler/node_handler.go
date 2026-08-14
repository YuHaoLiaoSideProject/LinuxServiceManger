package handler

// node_handler.go — 9 個節點層 handler + 心跳接收橋接（docs/development/014 §1.9.1）

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"net"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"linux-service-manager/internal/audit"
	"linux-service-manager/internal/auth"
	"linux-service-manager/internal/nodes"
	"linux-service-manager/internal/websocket"
)

// agentBinaryFS 是 Agent binary 來源（production 由 main.go 以 go:embed 注入；測試可注入假 binary）。
var agentBinaryFS fs.FS

// SetAgentBinaries 設定 Agent binary 來源（go:embed 的 sub FS）。
func SetAgentBinaries(f fs.FS) { agentBinaryFS = f }

// NodePayload 是節點建立/更新的 request body（決策 4/5；與前端 types/node.ts 同構）。
// 驗證：name/address 必填、address 為 host:port；token 與 tls_fingerprint 至少填其一（皆空 → 400）；
// PUT 時 token 留空表示不變更（決策 5 風險緩解）。
type NodePayload struct {
	Name           string `json:"name"`
	Address        string `json:"address"`
	TLSFingerprint string `json:"tls_fingerprint"`
	Token          string `json:"token"`
	Notes          string `json:"notes"`
}

// validateNodePayload 驗證 NodePayload。
// requireCredential=true（POST 建立）：token 或 fingerprint 至少填其一（決策 5）；
// requireCredential=false（PUT 更新）：既有節點已有憑證，不重複要求。
// 回傳空字串表示通過；否則回傳錯誤訊息。
func validateNodePayload(p *NodePayload, requireCredential bool) string {
	if p.Name == "" {
		return "name is required"
	}
	if p.Address == "" {
		return "address is required"
	}
	if !validHostPort(p.Address) {
		return "address must be in host:port format"
	}
	if requireCredential && p.Token == "" && p.TLSFingerprint == "" {
		return "token or tls_fingerprint is required"
	}
	return ""
}

// validHostPort 驗證 address 為 host:port（host 非空）。
func validHostPort(addr string) bool {
	host, port, err := net.SplitHostPort(addr)
	if err != nil {
		return false
	}
	if host == "" || port == "" {
		return false
	}
	return true
}

// writeNodeAudit 寫入節點操作 audit 紀錄（含 node_id/node_name；h.Audit 為 nil 時略過）。
func (h *Handler) writeNodeAudit(r *http.Request, action audit.Action, nodeID, nodeName, target string, result audit.Result, detail string) {
	if h.Audit == nil {
		return
	}
	username, _ := auth.GetSession(r).Values["username"].(string)
	entry, err := audit.NewEntry(username, audit.ExtractClientIP(r), action, target, result, detail)
	if err != nil {
		return
	}
	entry.NodeID = nodeID
	entry.NodeName = nodeName
	h.Audit.Write(entry)
}

// HandleAgentHeartbeat — POST /api/v1/agent/heartbeat（Auth 群組外，D-8）
// 橋接 internal/nodes 心跳接收邏輯（1.4）：解析 payload → VerifyToken → SetHeartbeat →
// 200 {"ok":true,"accepted":true}；token 不符 401、非法 JSON 400。
func (h *Handler) HandleAgentHeartbeat(w http.ResponseWriter, r *http.Request) {
	if h.Nodes == nil {
		writeJSON(w, http.StatusInternalServerError, messageJSON{Error: "nodes module not initialized"})
		return
	}
	nodes.NewHeartbeatHandler(h.Nodes.Registry).Handle(w, r)
}

// HandleListNodes — GET /api/v1/nodes
// 200 {data: [Node]}：Token 回 masked（MaskToken）；Status/LastHeartbeat/ServiceStats 完整。
func (h *Handler) HandleListNodes(w http.ResponseWriter, r *http.Request) {
	if h.Nodes == nil {
		writeJSON(w, http.StatusInternalServerError, messageJSON{Error: "nodes module not initialized"})
		return
	}
	list := h.Nodes.Registry.List()
	out := make([]*nodes.Node, 0, len(list))
	for _, n := range list {
		cp := *n
		cp.Token = nodes.MaskToken(n.Token)
		out = append(out, &cp)
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": out})
}

// HandleGetNode — GET /api/v1/nodes/{id}
// 200 {data: Node}；不存在 → 404 {"error":"node not found"}。
func (h *Handler) HandleGetNode(w http.ResponseWriter, r *http.Request) {
	if h.Nodes == nil {
		writeJSON(w, http.StatusInternalServerError, messageJSON{Error: "nodes module not initialized"})
		return
	}
	id := chi.URLParam(r, "id")
	n := h.Nodes.Registry.Get(id)
	if n == nil {
		writeJSON(w, http.StatusNotFound, messageJSON{Error: "node not found"})
		return
	}
	cp := *n
	cp.Token = nodes.MaskToken(n.Token)
	writeJSON(w, http.StatusOK, map[string]any{"data": cp})
}

// HandleCreateNode — POST /api/v1/nodes
// 驗證（validateNodePayload）：name/address 必填、address 格式 host:port、token 與 tls_fingerprint 至少填其一
// （皆空 → 400，決策 5）；名稱重複 → 409（BDD @duplicate）；Count()≥50 → 400/409（BDD @node-limit）。
// 註冊後對位址發一次健康檢查（GET /health，5s）：可達 → Status=online（初始）+ 第一筆 last_heartbeat=now；
// 不可達 → 節點仍儲存、Status=offline。201 {data: Node} + audit ActionNodeCreate。
func (h *Handler) HandleCreateNode(w http.ResponseWriter, r *http.Request) {
	if h.Nodes == nil {
		writeJSON(w, http.StatusInternalServerError, messageJSON{Error: "nodes module not initialized"})
		return
	}
	var p NodePayload
	if err := json.NewDecoder(r.Body).Decode(&p); err != nil {
		writeJSON(w, http.StatusBadRequest, messageJSON{Error: "invalid request body"})
		return
	}
	if msg := validateNodePayload(&p, true); msg != "" {
		writeJSON(w, http.StatusBadRequest, messageJSON{Error: msg})
		return
	}
	if h.Nodes.Registry.Count() >= nodes.MaxNodes {
		writeJSON(w, http.StatusBadRequest, messageJSON{Error: "節點數量已達上限 50（node limit reached）"})
		return
	}

	node, err := h.Nodes.Registry.Create(&nodes.Node{
		Name:           p.Name,
		Address:        p.Address,
		TLSFingerprint: p.TLSFingerprint,
		Token:          p.Token,
		Notes:          p.Notes,
	})
	if err != nil {
		if errors.Is(err, nodes.ErrDuplicateName) {
			writeJSON(w, http.StatusConflict, messageJSON{Error: "node name already exists"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, messageJSON{Error: "failed to create node"})
		return
	}

	// 健康檢查（非阻斷：失敗仍儲存節點，標示 offline）
	h.checkNodeHealth(node, r.Context())

	node = h.Nodes.Registry.Get(node.ID)
	h.writeNodeAudit(r, audit.ActionNodeCreate, node.ID, node.Name, node.Name, audit.ResultSuccess, "")

	cp := *node
	cp.Token = nodes.MaskToken(node.Token)
	writeJSON(w, http.StatusCreated, map[string]any{"data": cp})
}

// checkNodeHealth 對節點位址發 GET /health（5s 逾時）：可達 → online + 第一筆 last_heartbeat；
// 不可達 → offline（節點已儲存，不 rollback）。
func (h *Handler) checkNodeHealth(n *nodes.Node, parent context.Context) {
	ctx, cancel := context.WithTimeout(parent, 5*time.Second)
	defer cancel()

	code, body, err := h.Nodes.Client.Do(ctx, n, http.MethodGet, "/health", nil)
	if err != nil || code != http.StatusOK {
		// 位址不可達仍儲存但標示離線（BDD）
		h.Nodes.Registry.SetStatus(n.ID, nodes.StatusOffline)
		return
	}

	var health struct {
		Version  string `json:"version"`
		Hostname string `json:"hostname"`
		OS       string `json:"os"`
	}
	_ = json.Unmarshal(body, &health)

	h.Nodes.Registry.SetStatus(n.ID, nodes.StatusOnline)
	h.Nodes.Registry.SetHeartbeat(n.Name, nodes.Heartbeat{
		NodeName:     n.Name,
		AgentVersion: health.Version,
		Hostname:     health.Hostname,
		OS:           health.OS,
	})
}

// HandleUpdateNode — PUT /api/v1/nodes/{id}
// 驗證 name/address/格式；token 留空 → 保留原值（編輯不回傳 token，決策 5）；404 不存在；
// 200 {data: Node} + audit ActionNodeUpdate。
func (h *Handler) HandleUpdateNode(w http.ResponseWriter, r *http.Request) {
	if h.Nodes == nil {
		writeJSON(w, http.StatusInternalServerError, messageJSON{Error: "nodes module not initialized"})
		return
	}
	id := chi.URLParam(r, "id")

	var p NodePayload
	if err := json.NewDecoder(r.Body).Decode(&p); err != nil {
		writeJSON(w, http.StatusBadRequest, messageJSON{Error: "invalid request body"})
		return
	}
	if msg := validateNodePayload(&p, false); msg != "" {
		writeJSON(w, http.StatusBadRequest, messageJSON{Error: msg})
		return
	}

	node, err := h.Nodes.Registry.Update(id, &nodes.Node{
		Name:           p.Name,
		Address:        p.Address,
		TLSFingerprint: p.TLSFingerprint,
		Token:          p.Token,
		Notes:          p.Notes,
	})
	if err != nil {
		if errors.Is(err, nodes.ErrNodeNotFound) {
			writeJSON(w, http.StatusNotFound, messageJSON{Error: "node not found"})
			return
		}
		if errors.Is(err, nodes.ErrDuplicateName) {
			writeJSON(w, http.StatusConflict, messageJSON{Error: "node name already exists"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, messageJSON{Error: "failed to update node"})
		return
	}

	h.writeNodeAudit(r, audit.ActionNodeUpdate, node.ID, node.Name, node.Name, audit.ResultSuccess, "")

	cp := *node
	cp.Token = nodes.MaskToken(node.Token)
	writeJSON(w, http.StatusOK, map[string]any{"data": cp})
}

// HandleDeleteNode — DELETE /api/v1/nodes/{id}
// 200 {message:"節點已移除"}；404；關聯 Audit Log 保留（BDD @data）+ audit ActionNodeDelete +
// hub 廣播 node_removed（前端 store 移除該節點）。
func (h *Handler) HandleDeleteNode(w http.ResponseWriter, r *http.Request) {
	if h.Nodes == nil {
		writeJSON(w, http.StatusInternalServerError, messageJSON{Error: "nodes module not initialized"})
		return
	}
	id := chi.URLParam(r, "id")
	n := h.Nodes.Registry.Get(id)
	if n == nil {
		writeJSON(w, http.StatusNotFound, messageJSON{Error: "node not found"})
		return
	}

	if err := h.Nodes.Registry.Delete(id); err != nil {
		writeJSON(w, http.StatusInternalServerError, messageJSON{Error: "failed to delete node"})
		return
	}

	if h.Hub != nil {
		h.Hub.BroadcastMessage(websocket.Message{Type: "node_removed", ID: id, Name: n.Name})
	}
	h.writeNodeAudit(r, audit.ActionNodeDelete, id, n.Name, n.Name, audit.ResultSuccess, "")

	writeJSON(w, http.StatusOK, messageJSON{Message: "節點已移除"})
}

// HandleTestConnection — POST /api/v1/nodes/test-connection
// body {address, tls_fingerprint, token}（決策 6：Agent GET /health，5s 逾時，帶入表單位址/憑證即時驗證）。
// 成功 → 200 {version, hostname, os, uptime}；connection refused / TLS 驗證失敗 → 502（body 含具體原因）；
// 逾時 → 504。+ audit ActionNodeTestConnection。
func (h *Handler) HandleTestConnection(w http.ResponseWriter, r *http.Request) {
	if h.Nodes == nil {
		writeJSON(w, http.StatusInternalServerError, messageJSON{Error: "nodes module not initialized"})
		return
	}
	var p struct {
		Address        string `json:"address"`
		TLSFingerprint string `json:"tls_fingerprint"`
		Token          string `json:"token"`
	}
	if err := json.NewDecoder(r.Body).Decode(&p); err != nil {
		writeJSON(w, http.StatusBadRequest, messageJSON{Error: "invalid request body"})
		return
	}
	if !validHostPort(p.Address) {
		writeJSON(w, http.StatusBadRequest, messageJSON{Error: "address must be in host:port format"})
		return
	}

	node := &nodes.Node{
		Name:           "test-connection",
		Address:        p.Address,
		TLSFingerprint: p.TLSFingerprint,
		Token:          p.Token,
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	code, body, err := h.Nodes.Client.Do(ctx, node, http.MethodGet, "/health", nil)
	if err != nil {
		var tErr *nodes.NodeTimeoutError
		if errors.As(err, &tErr) {
			h.writeNodeAudit(r, audit.ActionNodeTestConnection, "", p.Address, p.Address, audit.ResultFailure, "timeout")
			writeJSON(w, http.StatusGatewayTimeout, messageJSON{Error: "connection timed out"})
			return
		}
		// 連線拒絕 / TLS 驗證失敗 → 502（body 含具體原因，供前端顯示）
		h.writeNodeAudit(r, audit.ActionNodeTestConnection, "", p.Address, p.Address, audit.ResultFailure, err.Error())
		writeJSON(w, http.StatusBadGateway, messageJSON{Error: err.Error()})
		return
	}

	if code != http.StatusOK {
		h.writeNodeAudit(r, audit.ActionNodeTestConnection, "", p.Address, p.Address, audit.ResultFailure, fmt.Sprintf("status %d", code))
		writeJSON(w, http.StatusBadGateway, messageJSON{Error: fmt.Sprintf("agent health check failed: status %d", code)})
		return
	}

	h.writeNodeAudit(r, audit.ActionNodeTestConnection, "", p.Address, p.Address, audit.ResultSuccess, "")
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(body)
}

// HandleNodesSummary — GET /api/v1/nodes/summary
// 零網路請求（決策 3/9）：O(50) 記憶體掃描聚合各節點最後心跳的 ServiceStats。
// 200 {"data": {total_nodes, online, degraded, offline, long_offline, warning, total_services, active_services, failed_services}}。
func (h *Handler) HandleNodesSummary(w http.ResponseWriter, r *http.Request) {
	if h.Nodes == nil {
		writeJSON(w, http.StatusInternalServerError, messageJSON{Error: "nodes module not initialized"})
		return
	}

	var total, online, degraded, offline, longOffline, warning int
	var totalSvc, activeSvc, failedSvc int

	for _, n := range h.Nodes.Registry.List() {
		total++
		switch n.Status {
		case nodes.StatusOnline:
			online++
		case nodes.StatusDegraded:
			degraded++
		case nodes.StatusOffline:
			offline++
		case nodes.StatusLongOffline:
			longOffline++
		case nodes.StatusWarning:
			warning++
		}
		totalSvc += n.ServiceStats.Total
		activeSvc += n.ServiceStats.Active
		failedSvc += n.ServiceStats.Failed
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"data": map[string]any{
			"total_nodes":     total,
			"online":          online,
			"degraded":        degraded,
			"offline":         offline,
			"long_offline":    longOffline,
			"warning":         warning,
			"total_services":  totalSvc,
			"active_services": activeSvc,
			"failed_services": failedSvc,
		},
	})
}

// HandleAgentDownload — GET /api/v1/agents/download?arch=amd64|arm64
// 串流回傳 go:embed 的 Agent binary（application/octet-stream + Content-Disposition agent-linux-<arch>）；
// arch 不支援 → 400。
func (h *Handler) HandleAgentDownload(w http.ResponseWriter, r *http.Request) {
	arch := r.URL.Query().Get("arch")
	if arch != "amd64" && arch != "arm64" {
		writeJSON(w, http.StatusBadRequest, messageJSON{Error: "unsupported arch, must be amd64 or arm64"})
		return
	}

	filename := "agent-linux-" + arch
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, filename))
	w.WriteHeader(http.StatusOK)

	if agentBinaryFS == nil {
		// 測試縫：未注入 binary 來源時回傳空 body（CI/production 由 main.go 注入 go:embed FS）
		return
	}
	data, err := fs.ReadFile(agentBinaryFS, filename)
	if err != nil {
		return
	}
	_, _ = w.Write(data)
}
