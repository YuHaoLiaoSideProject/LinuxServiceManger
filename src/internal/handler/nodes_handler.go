package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"linux-service-manager/internal/audit"
	"linux-service-manager/internal/nodemonitor"
	"linux-service-manager/internal/noderegistry"
	"linux-service-manager/internal/nodeproxy"
	"linux-service-manager/internal/websocket"
)

// NodesHandler handles all /api/v1/nodes endpoints.
type NodesHandler struct {
	Reg       *noderegistry.Registry
	AgentHub  *nodeproxy.Hub
	Mon       *nodemonitor.Monitor
	PushHub   *websocket.Hub
	Audit     *audit.Module
	BinaryDir string
}

// ---- request / response types ----

type createNodeRequest struct {
	Name           string `json:"name"`
	Address        string `json:"address"`
	TLSFingerprint string `json:"tls_fingerprint"`
	Token          string `json:"token"`
	Note           string `json:"note"`
}

type updateNodeRequest struct {
	Name           *string `json:"name"`
	Address        *string `json:"address"`
	TLSFingerprint *string `json:"tls_fingerprint"`
	Token          *string `json:"token"`
	Note           *string `json:"note"`
}

type testConnectionRequest struct {
	Address        string `json:"address"`
	TLSFingerprint string `json:"tls_fingerprint"`
	Token          string `json:"token"`
}

type nodeSummary struct {
	TotalNodes     int `json:"total_nodes"`
	OnlineCount    int `json:"online_count"`
	OfflineCount   int `json:"offline_count"`
	ServicesTotal  int `json:"services_total"`
	ServicesRunning int `json:"services_running"`
	ServicesFailed  int `json:"services_failed"`
}

// ---- 1. HandleCreateNode ----

func (h *NodesHandler) HandleCreateNode(w http.ResponseWriter, r *http.Request) {
	var req createNodeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSONError(w, http.StatusBadRequest, "invalid JSON")
		return
	}

	req.Name = strings.TrimSpace(req.Name)
	req.Address = strings.TrimSpace(req.Address)

	if req.Name == "" || req.Address == "" {
		writeJSONError(w, http.StatusBadRequest, "name and address are required")
		return
	}

	node, err := h.Reg.Add(noderegistry.AddRequest{
		Name:           req.Name,
		Address:        req.Address,
		TLSFingerprint: req.TLSFingerprint,
		Token:          req.Token,
		Note:           req.Note,
	})
	if err != nil {
		switch err {
		case noderegistry.ErrDuplicateName:
			writeJSONError(w, http.StatusConflict, "node name already exists")
		case noderegistry.ErrMaxNodes:
			writeJSONError(w, http.StatusConflict, "maximum of 50 nodes reached")
		default:
			log.Printf("ERROR creating node: %v", err)
			writeJSONError(w, http.StatusInternalServerError, "failed to create node")
		}
		return
	}

	// Broadcast registry change
	h.PushHub.BroadcastNodeRegistryChanged("add", node)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(node)
}

// ---- 2. HandleListNodes ----

func (h *NodesHandler) HandleListNodes(w http.ResponseWriter, r *http.Request) {
	nodes := h.Reg.List()
	w.Header().Set("Content-Type", "application/json")
	if nodes == nil {
		nodes = []noderegistry.Node{}
	}
	json.NewEncoder(w).Encode(nodes)
}

// ---- 3. HandleGetNode ----

func (h *NodesHandler) HandleGetNode(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	node, ok := h.Reg.Get(id)
	if !ok {
		writeJSONError(w, http.StatusNotFound, "node not found")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(node)
}

// ---- 4. HandleUpdateNode ----

func (h *NodesHandler) HandleUpdateNode(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	var req updateNodeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSONError(w, http.StatusBadRequest, "invalid JSON")
		return
	}

	node, err := h.Reg.Update(id, noderegistry.UpdateRequest{
		Name:           req.Name,
		Address:        req.Address,
		TLSFingerprint: req.TLSFingerprint,
		Token:          req.Token,
		Note:           req.Note,
	})
	if err != nil {
		switch err {
		case noderegistry.ErrNotFound:
			writeJSONError(w, http.StatusNotFound, "node not found")
		case noderegistry.ErrDuplicateName:
			writeJSONError(w, http.StatusConflict, "node name already exists")
		default:
			log.Printf("ERROR updating node %s: %v", id, err)
			writeJSONError(w, http.StatusInternalServerError, "failed to update node")
		}
		return
	}

	h.PushHub.BroadcastNodeRegistryChanged("update", node)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(node)
}

// ---- 5. HandleDeleteNode ----

func (h *NodesHandler) HandleDeleteNode(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	node, ok := h.Reg.Get(id)
	if !ok {
		writeJSONError(w, http.StatusNotFound, "node not found")
		return
	}

	if err := h.Reg.Remove(id); err != nil {
		log.Printf("ERROR deleting node %s: %v", id, err)
		writeJSONError(w, http.StatusInternalServerError, "failed to delete node")
		return
	}

	h.PushHub.BroadcastNodeRegistryChanged("remove", node)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"ok": "true"})
}

// ---- 6. HandleReconnect ----

func (h *NodesHandler) HandleReconnect(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	node, ok := h.Reg.Get(id)
	if !ok {
		writeJSONError(w, http.StatusNotFound, "node not found")
		return
	}

	log.Printf("NODES: reconnect requested for node %s (%s)", node.Name, id)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"ok": "true"})
}

// ---- 7. HandleTestConnection ----

func (h *NodesHandler) HandleTestConnection(w http.ResponseWriter, r *http.Request) {
	var req testConnectionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSONError(w, http.StatusBadRequest, "invalid JSON")
		return
	}

	req.Address = strings.TrimSpace(req.Address)
	if req.Address == "" {
		writeJSONError(w, http.StatusBadRequest, "address is required")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	ok, version, hostname, osName, errMsg := nodeproxy.TestConnection(ctx, req.Address, req.TLSFingerprint, req.Token)

	w.Header().Set("Content-Type", "application/json")
	if ok {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"ok":       true,
			"version":  version,
			"hostname": hostname,
			"os":       osName,
		})
	} else {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"ok":    false,
			"error": errMsg,
		})
	}
}

// ---- 8. HandleSummary ----

func (h *NodesHandler) HandleSummary(w http.ResponseWriter, r *http.Request) {
	nodes := h.Reg.List()
	summary := nodeSummary{
		TotalNodes: len(nodes),
	}
	for _, n := range nodes {
		if n.Status == "online" || n.Status == "warning" {
			summary.OnlineCount++
		} else {
			summary.OfflineCount++
		}
		summary.ServicesTotal += n.HeartbeatStats.Total
		summary.ServicesRunning += n.HeartbeatStats.Running
		summary.ServicesFailed += n.HeartbeatStats.Failed
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(summary)
}

// ---- 9. HandleNodeServices ----

func (h *NodesHandler) HandleNodeServices(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	node, ok := h.Reg.Get(id)
	if !ok {
		writeJSONError(w, http.StatusNotFound, "node not found")
		return
	}

	if node.Status != "online" && node.Status != "warning" {
		writeJSONError(w, http.StatusServiceUnavailable, "node is offline")
		return
	}

	var result interface{}
	if err := h.AgentHub.CallQuery(r.Context(), id, "services.list", nil, &result); err != nil {
		if err == nodeproxy.ErrNodeOffline {
			writeJSONError(w, http.StatusServiceUnavailable, "node is offline")
		} else {
			log.Printf("ERROR querying node %s services: %v", id, err)
			writeJSONError(w, http.StatusInternalServerError, "failed to query node services")
		}
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

// ---- 10. HandleNodeAction ----

func (h *NodesHandler) HandleNodeAction(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	name := chi.URLParam(r, "name")
	action := chi.URLParam(r, "action")

	// Validate action
	validActions := map[string]bool{
		"start": true, "stop": true, "restart": true,
		"enable": true, "disable": true,
	}
	if !validActions[action] {
		writeJSONError(w, http.StatusBadRequest, "invalid action: "+action)
		return
	}

	node, ok := h.Reg.Get(id)
	if !ok {
		writeJSONError(w, http.StatusNotFound, "node not found")
		return
	}

	method := "services." + action
	err := h.AgentHub.CallAction(r.Context(), id, method, name)

	// Audit entry
	username := extractUsername(r)
	result := audit.ResultSuccess
	detail := fmt.Sprintf("%s %s on %s", action, name, node.Name)
	if err != nil {
		result = audit.ResultFailure
		detail = fmt.Sprintf("%s %s on %s: %v", action, name, node.Name, err)
	}

	h.Audit.Write(audit.NewNodeEntry(
		username, audit.ExtractClientIP(r),
		audit.Action(action), name,
		result, detail, node.ID, node.Name,
	))

	if err != nil {
		if err == nodeproxy.ErrNodeOffline {
			writeJSONError(w, http.StatusServiceUnavailable, "node is offline")
		} else {
			log.Printf("ERROR performing action %s on %s/%s: %v", action, id, name, err)
			writeJSONError(w, http.StatusInternalServerError, "failed to perform action on node")
		}
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"ok": "true"})
}

// ---- 11. HandleNodeLogs ----

func (h *NodesHandler) HandleNodeLogs(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	name := chi.URLParam(r, "name")

	lines := 100
	if l := r.URL.Query().Get("lines"); l != "" {
		var parsed int
		if _, err := fmt.Sscanf(l, "%d", &parsed); err == nil && parsed > 0 {
			lines = parsed
		}
	}

	node, ok := h.Reg.Get(id)
	if !ok {
		writeJSONError(w, http.StatusNotFound, "node not found")
		return
	}

	if node.Status != "online" && node.Status != "warning" {
		writeJSONError(w, http.StatusServiceUnavailable, "node is offline")
		return
	}

	params := map[string]interface{}{
		"name":  name,
		"lines": lines,
	}

	var result interface{}
	if err := h.AgentHub.CallQuery(r.Context(), id, "services.logs", params, &result); err != nil {
		if err == nodeproxy.ErrNodeOffline {
			writeJSONError(w, http.StatusServiceUnavailable, "node is offline")
		} else {
			log.Printf("ERROR querying node %s logs: %v", id, err)
			writeJSONError(w, http.StatusInternalServerError, "failed to query node logs")
		}
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

// ---- 12. HandleNodeInfo ----

func (h *NodesHandler) HandleNodeInfo(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	node, ok := h.Reg.Get(id)
	if !ok {
		writeJSONError(w, http.StatusNotFound, "node not found")
		return
	}

	if node.Status != "online" && node.Status != "warning" {
		writeJSONError(w, http.StatusServiceUnavailable, "node is offline")
		return
	}

	var result interface{}
	if err := h.AgentHub.CallQuery(r.Context(), id, "system.info", nil, &result); err != nil {
		if err == nodeproxy.ErrNodeOffline {
			writeJSONError(w, http.StatusServiceUnavailable, "node is offline")
		} else {
			log.Printf("ERROR querying node %s info: %v", id, err)
			writeJSONError(w, http.StatusInternalServerError, "failed to query node info")
		}
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

// ---- 13. HandleAgentBinary ----

func (h *NodesHandler) HandleAgentBinary(w http.ResponseWriter, r *http.Request) {
	arch := r.URL.Query().Get("arch")
	if arch == "" {
		arch = "amd64"
	}
	if arch != "amd64" && arch != "arm64" {
		writeJSONError(w, http.StatusBadRequest, "arch must be amd64 or arm64")
		return
	}

	binaryName := fmt.Sprintf("linux-service-manager-agent-%s", arch)
	binaryPath := filepath.Join(h.BinaryDir, binaryName)

	data, err := os.ReadFile(binaryPath)
	if err != nil {
		if os.IsNotExist(err) {
			writeJSONError(w, http.StatusNotFound, "agent binary not found for arch: "+arch)
		} else {
			log.Printf("ERROR reading agent binary %s: %v", binaryPath, err)
			writeJSONError(w, http.StatusInternalServerError, "failed to read agent binary")
		}
		return
	}

	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, binaryName))
	w.Header().Set("Content-Length", fmt.Sprintf("%d", len(data)))
	w.Write(data)
}

// ---- helpers ----

func writeJSONError(w http.ResponseWriter, code int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}
