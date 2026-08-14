package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"linux-service-manager/internal/audit"
	"linux-service-manager/internal/nodes"

	"github.com/go-chi/chi/v5"
)

// ============================================================
//  Mock Agent（proxy 測試用）
// ============================================================

const proxyServicesBody = `[{"name":"nginx.service","load":"loaded","active":"active","sub":"running","unitFileState":"enabled","fragmentPath":"/etc/systemd/system/nginx.service","locked":false}]`

// proxyRecorder 記錄 mock Agent 收到的請求（method/path/query）。
type proxyRecorder struct {
	mu     sync.Mutex
	reqs   []string // "METHOD path?query"
	status int
	body   string
}

func (r *proxyRecorder) add(method, path, query string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	q := ""
	if query != "" {
		q = "?" + query
	}
	r.reqs = append(r.reqs, method+" "+path+q)
}

func (r *proxyRecorder) requests() []string {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]string(nil), r.reqs...)
}

// newProxyMockAgent 建立 mock Agent：services/ops/logs/info 全端點。
func newProxyMockAgent(t *testing.T, rec *proxyRecorder) *httptest.Server {
	t.Helper()
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if rec != nil {
			rec.add(r.Method, r.URL.Path, r.URL.RawQuery)
		}
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/api/v1/services":
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(proxyServicesBody))
		case r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/start"):
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(`{"message":"nginx.service started","name":"nginx.service","active":"active","sub":"running"}`))
		case r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/stop"):
			w.Write([]byte(`{"message":"nginx.service stopped","name":"nginx.service","active":"inactive","sub":"dead"}`))
		case r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/restart"):
			w.Write([]byte(`{"message":"nginx.service restarted","name":"nginx.service","active":"active","sub":"running"}`))
		case r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/enable"):
			w.Write([]byte(`{"message":"nginx.service enabled","name":"nginx.service","active":"active","sub":"running"}`))
		case r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/disable"):
			w.Write([]byte(`{"message":"nginx.service disabled","name":"nginx.service","active":"active","sub":"running"}`))
		case r.Method == http.MethodGet && strings.HasSuffix(r.URL.Path, "/logs"):
			w.Header().Set("Content-Type", "text/plain")
			w.Write([]byte("journal line 1\njournal line 2\n"))
		case r.Method == http.MethodGet && r.URL.Path == "/api/v1/system/info":
			w.Write([]byte(`{"os":"Ubuntu 22.04","kernel":"5.15.0","uptime":12345,"cpu":"4 cores","mem":"8GB","disk":"100GB"}`))
		default:
			w.WriteHeader(http.StatusNotFound)
			w.Write([]byte(`{"error":"not found"}`))
		}
	}))
	t.Cleanup(srv.Close)
	return srv
}

// setupProxyHandler 佈建 Handler：註冊節點 + 注入 mock Agent。
func setupProxyHandler(t *testing.T, nodeStatus nodes.Status) (*Handler, *chi.Mux, *nodes.Node, *httptest.Server) {
	t.Helper()
	withAdminAuth(t)
	m := newNodesManager(t)
	agent := newProxyMockAgent(t, nil)
	node := registerNode(t, m, "web-server-01", strings.TrimPrefix(agent.URL, "https://"), serverFingerprint(t, agent))
	if nodeStatus != nodes.StatusOnline {
		m.Registry.SetStatus(node.ID, nodeStatus)
	}
	h := newNodeHandler(t, m, nil)
	return h, setupNodeRouter(h), node, agent
}

// ============================================================
//  HDL-19: GET /nodes/{id}/services 代理成功（轉寫 Agent 原樣 schema）
// ============================================================

func TestProxyServices_Success(t *testing.T) {
	_, router, node, _ := setupProxyHandler(t, nodes.StatusOnline)
	cookie := adminCookie(t, router)

	w := postJSON(t, router, cookie, http.MethodGet, "/api/v1/nodes/"+node.ID+"/services", "")
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var services []map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &services); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}
	if len(services) != 1 || services[0]["name"] != "nginx.service" {
		t.Errorf("proxy result mismatch: %v", services)
	}
	if services[0]["active"] != "active" || services[0]["sub"] != "running" {
		t.Errorf("agent schema not preserved: %v", services[0])
	}
}

// ============================================================
//  HDL-20: 節點離線代理回 502 {"error":"node offline"}
// ============================================================

func TestProxyServices_NodeOffline(t *testing.T) {
	_, router, node, _ := setupProxyHandler(t, nodes.StatusOffline)
	cookie := adminCookie(t, router)

	w := postJSON(t, router, cookie, http.MethodGet, "/api/v1/nodes/"+node.ID+"/services", "")
	if w.Code != http.StatusBadGateway {
		t.Fatalf("expected 502, got %d: %s", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), "node offline") {
		t.Errorf("expected {\"error\":\"node offline\"}, got %s", w.Body.String())
	}
}

// ============================================================
//  HDL-21: 節點不存在回 404
// ============================================================

func TestProxyServices_NodeNotFound(t *testing.T) {
	_, router, _, _ := setupProxyHandler(t, nodes.StatusOnline)
	cookie := adminCookie(t, router)

	w := postJSON(t, router, cookie, http.MethodGet, "/api/v1/nodes/ghost/services", "")
	if w.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d: %s", w.Code, w.Body.String())
	}
}

// ============================================================
//  HDL-22: 操作代理 + audit 記錄（action + node_id + node_name）
// ============================================================

func TestProxyServiceOps_Audit(t *testing.T) {
	withAdminAuth(t)
	auditMod := newTestAuditModule(t)
	m := newNodesManager(t)
	agent := newProxyMockAgent(t, nil)
	node := registerNode(t, m, "web-server-01", strings.TrimPrefix(agent.URL, "https://"), serverFingerprint(t, agent))

	h := newNodeHandler(t, m, auditMod)
	router := setupNodeRouter(h)
	cookie := adminCookie(t, router)

	ops := []struct {
		action string
		want   audit.Action
	}{
		{"start", audit.ActionStart},
		{"stop", audit.ActionStop},
		{"restart", audit.ActionRestart},
		{"enable", audit.ActionEnable},
		{"disable", audit.ActionDisable},
	}
	for _, op := range ops {
		t.Run(op.action, func(t *testing.T) {
			w := postJSON(t, router, cookie, http.MethodPost,
				"/api/v1/nodes/"+node.ID+"/services/nginx.service/"+op.action, "")
			if w.Code != http.StatusOK {
				t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
			}
		})
	}

	// audit：每筆含 action + node_id + node_name（BDD @audit）
	auditMod.Shutdown()
	res, err := auditMod.Query(audit.QueryParams{Page: 1, Limit: 50})
	if err != nil {
		t.Fatalf("audit query: %v", err)
	}
	if res.Total < 5 {
		t.Fatalf("expected >=5 audit entries, got %d", res.Total)
	}
	for _, op := range ops {
		found := false
		for _, e := range res.Entries {
			if e.Action == op.want && e.NodeID == node.ID && e.NodeName == "web-server-01" {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("missing audit entry for %s with node_id/node_name", op.action)
		}
	}
}

// ============================================================
//  HDL-23: 操作逾時 15s 回 504（NodeTimeoutError 映射）
// ============================================================

func TestProxyServiceOp_Timeout(t *testing.T) {
	_, router, node, _ := setupProxyHandler(t, nodes.StatusOnline)
	cookie := adminCookie(t, router)

	// 以已逾期的 request context 觸發 per-route 15s timeout 的 deadline 分類（快又確定）
	expiredCtx, cancel := context.WithDeadline(context.Background(), time.Now().Add(-time.Second))
	defer cancel()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/nodes/"+node.ID+"/services/nginx.service/restart", nil)
	req = req.WithContext(expiredCtx)
	req.AddCookie(cookie)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusGatewayTimeout {
		t.Fatalf("expected 504, got %d: %s", w.Code, w.Body.String())
	}
}

// ============================================================
//  HDL-24: 操作失敗轉寫 + audit 失敗紀錄
// ============================================================

func TestProxyServiceOp_FailurePassthrough(t *testing.T) {
	withAdminAuth(t)
	auditMod := newTestAuditModule(t)

	agent := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte(`{"error":"permission denied"}`))
	}))
	defer agent.Close()

	m := newNodesManager(t)
	node := registerNode(t, m, "web-server-01", strings.TrimPrefix(agent.URL, "https://"), serverFingerprint(t, agent))

	h := newNodeHandler(t, m, auditMod)
	router := setupNodeRouter(h)
	cookie := adminCookie(t, router)

	w := postJSON(t, router, cookie, http.MethodPost,
		"/api/v1/nodes/"+node.ID+"/services/nginx.service/restart", "")
	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500 passthrough, got %d: %s", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), "permission denied") {
		t.Errorf("agent error body should be passed through, got %s", w.Body.String())
	}

	auditMod.Shutdown()
	res, err := auditMod.Query(audit.QueryParams{Page: 1, Limit: 10})
	if err != nil {
		t.Fatalf("audit query: %v", err)
	}
	if res.Total < 1 || res.Entries[0].Action != audit.ActionRestart || res.Entries[0].Result != audit.ResultFailure {
		t.Errorf("expected failed restart audit entry, got %+v", res.Entries)
	}
	if res.Entries[0].NodeID != node.ID || res.Entries[0].NodeName != "web-server-01" {
		t.Errorf("audit entry missing node fields: %+v", res.Entries[0])
	}
}

// ============================================================
//  HDL-25: GET logs 純文字轉寫（lines 傳遞）
// ============================================================

func TestProxyServiceLogs(t *testing.T) {
	withAdminAuth(t)
	rec := &proxyRecorder{}
	m := newNodesManager(t)
	agent := newProxyMockAgent(t, rec)
	node := registerNode(t, m, "web-server-01", strings.TrimPrefix(agent.URL, "https://"), serverFingerprint(t, agent))

	h := newNodeHandler(t, m, nil)
	router := setupNodeRouter(h)
	cookie := adminCookie(t, router)

	w := postJSON(t, router, cookie, http.MethodGet,
		"/api/v1/nodes/"+node.ID+"/services/nginx.service/logs?lines=100", "")
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	if ct := w.Header().Get("Content-Type"); !strings.Contains(ct, "text/plain") {
		t.Errorf("expected text/plain, got %q", ct)
	}
	if !strings.Contains(w.Body.String(), "journal line 1") {
		t.Errorf("logs body mismatch: %s", w.Body.String())
	}
	// lines 參數傳遞至 Agent
	found := false
	for _, r := range rec.requests() {
		if strings.Contains(r, "/logs?") && strings.Contains(r, "lines=100") {
			found = true
		}
	}
	if !found {
		t.Errorf("lines=100 not forwarded to agent: %v", rec.requests())
	}
}

// ============================================================
//  HDL-26: GET /nodes/{id}/info 轉寫（10s 逾時）
// ============================================================

func TestProxyNodeInfo(t *testing.T) {
	withAdminAuth(t)
	rec := &proxyRecorder{}
	m := newNodesManager(t)
	agent := newProxyMockAgent(t, rec)
	node := registerNode(t, m, "web-server-01", strings.TrimPrefix(agent.URL, "https://"), serverFingerprint(t, agent))

	h := newNodeHandler(t, m, nil)
	router := setupNodeRouter(h)
	cookie := adminCookie(t, router)

	w := postJSON(t, router, cookie, http.MethodGet, "/api/v1/nodes/"+node.ID+"/info", "")
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}
	for _, k := range []string{"os", "kernel", "uptime", "cpu", "mem", "disk"} {
		if _, ok := body[k]; !ok {
			t.Errorf("missing field %q in node info", k)
		}
	}
	// Agent 收到的是 /api/v1/system/info（info 目標端點，決策 6）
	found := false
	for _, r := range rec.requests() {
		if strings.Contains(r, "GET /api/v1/system/info") {
			found = true
		}
	}
	if !found {
		t.Errorf("expected proxy target /api/v1/system/info, got %v", rec.requests())
	}
}

// ============================================================
//  HDL-27: 代理回應 >4MB 上限（依 AgentClient 4MB 限制，不掛起）
// ============================================================

func TestProxyServices_ResponseLimit(t *testing.T) {
	withAdminAuth(t)
	big := strings.Repeat("x", 4<<20+4096)
	agent := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(big))
	}))
	defer agent.Close()

	m := newNodesManager(t)
	node := registerNode(t, m, "web-server-01", strings.TrimPrefix(agent.URL, "https://"), serverFingerprint(t, agent))

	h := newNodeHandler(t, m, nil)
	router := setupNodeRouter(h)
	cookie := adminCookie(t, router)

	done := make(chan struct{})
	var w *httptest.ResponseRecorder
	go func() {
		w = postJSON(t, router, cookie, http.MethodGet, "/api/v1/nodes/"+node.ID+"/services", "")
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(10 * time.Second):
		t.Fatal("proxy request hung on oversized response")
	}
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	if w.Body.Len() > 4<<20 {
		t.Errorf("response body exceeds 4MB limit: %d bytes", w.Body.Len())
	}
}
