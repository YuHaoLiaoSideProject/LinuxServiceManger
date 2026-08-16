package handler

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"linux-service-manager/internal/audit"
	"linux-service-manager/internal/auth"
	"linux-service-manager/internal/nodes"
	"linux-service-manager/internal/websocket"

	"github.com/go-chi/chi/v5"
)

// ============================================================
//  Node handler 測試共用 helpers（HDL-01~18；proxy/search 亦沿用）
// ============================================================

// newNodesManager 建立節點模組（temp dir registry + hub）。
func newNodesManager(t *testing.T) *nodes.Manager {
	t.Helper()
	m, err := nodes.New(nodes.Config{
		RegistryPath:    t.TempDir() + "/nodes.json",
		Hub:             websocket.NewHub(),
		AgentMinVersion: "1.2.0",
	})
	if err != nil {
		t.Fatalf("nodes.New: %v", err)
	}
	return m
}

// newNodeHandler 建立 Handler 並注入 nodes 模組（沿用 Notify 注入先例）。
func newNodeHandler(t *testing.T, m *nodes.Manager, auditMod *audit.Module) *Handler {
	t.Helper()
	h := New(nil, &mockSystemd{}, auditMod, nil)
	h.Nodes = m
	return h
}

// setupNodeRouter 建立節點路由（心跳在 Auth 群組外；靜態段先於 {id} 參數段）。
func setupNodeRouter(h *Handler) *chi.Mux {
	r := chi.NewRouter()

	r.Post("/api/v1/login", h.HandleLoginJSON)
	r.Post("/api/v1/logout", h.HandleLogoutJSON)
	r.Get("/api/v1/session", h.HandleSessionCheck)
	r.Post("/api/v1/agent/heartbeat", h.HandleAgentHeartbeat) // 群組外，token 自證

	r.Group(func(r chi.Router) {
		r.Use(authMiddlewareJSON)
		r.Get("/api/v1/nodes", h.HandleListNodes)
		r.Post("/api/v1/nodes", h.HandleCreateNode)
		r.Get("/api/v1/nodes/summary", h.HandleNodesSummary)
		r.Get("/api/v1/nodes/services/search", h.HandleSearchServices)
		r.Post("/api/v1/nodes/test-connection", h.HandleTestConnection)
		r.Get("/api/v1/nodes/{id}", h.HandleGetNode)
		r.Put("/api/v1/nodes/{id}", h.HandleUpdateNode)
		r.Delete("/api/v1/nodes/{id}", h.HandleDeleteNode)
		r.Post("/api/v1/nodes/{id}/reconnect", h.HandleNodeReconnect)
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
	return r
}

// withAdminAuth 設定管理員帳密並註冊復原（沿用既有 pattern）。
func withAdminAuth(t *testing.T) {
	t.Helper()
	origUser, origPass := auth.AdminUser, auth.AdminPass
	auth.AdminUser, auth.AdminPass = "admin", "pass"
	t.Cleanup(func() { auth.AdminUser, auth.AdminPass = origUser, origPass })
}

// adminCookie 登入並取得 session cookie。
func adminCookie(t *testing.T, router http.Handler) *http.Cookie {
	t.Helper()
	return loginAndGetCookie(t, router, "admin", "pass")
}

// serverFingerprint 計算 httptest TLS server 憑證 SHA-256 指紋（hex）。
func serverFingerprint(t *testing.T, srv *httptest.Server) string {
	t.Helper()
	cert := srv.Certificate()
	if cert == nil {
		t.Fatal("test server has no certificate")
	}
	sum := sha256.Sum256(cert.Raw)
	return hex.EncodeToString(sum[:])
}

// registerNode 註冊節點並設為 online（proxy/search 測試用）。
func registerNode(t *testing.T, m *nodes.Manager, name, addr, fp string) *nodes.Node {
	t.Helper()
	n, err := m.Registry.Create(&nodes.Node{Name: name, Address: addr, TLSFingerprint: fp})
	if err != nil {
		t.Fatalf("register node %s: %v", name, err)
	}
	m.Registry.SetStatus(n.ID, nodes.StatusOnline)
	return n
}

// postJSON 發送帶 session cookie 的 JSON 請求。
func postJSON(t *testing.T, router http.Handler, cookie *http.Cookie, method, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if cookie != nil {
		req.AddCookie(cookie)
	}
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	return w
}

// ============================================================
//  HDL-01: GET /nodes 回傳所有節點（Token 回 masked）
// ============================================================

func TestHandleListNodes_MaskedToken(t *testing.T) {
	withAdminAuth(t)
	m := newNodesManager(t)
	n1, err := m.Registry.Create(&nodes.Node{Name: "web-server-01", Address: "10.0.0.5:8443"})
	if err != nil {
		t.Fatalf("create n1: %v", err)
	}
	n2, err := m.Registry.Create(&nodes.Node{Name: "db-server-01", Address: "10.0.0.6:8443"})
	if err != nil {
		t.Fatalf("create n2: %v", err)
	}
	m.Registry.SetStatus(n1.ID, nodes.StatusOnline)
	m.Registry.SetStatus(n2.ID, nodes.StatusOffline)
	m.Registry.SetHeartbeat("web-server-01", nodes.Heartbeat{
		NodeName:     "web-server-01",
		AgentVersion: "1.2.0",
		Hostname:     "web-01",
		OS:           "Ubuntu 22.04",
		Services:     nodes.ServiceStats{Total: 10, Active: 8, Failed: 1},
	})

	router := setupNodeRouter(newNodeHandler(t, m, nil))
	cookie := adminCookie(t, router)

	w := postJSON(t, router, cookie, http.MethodGet, "/api/v1/nodes", "")
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var body struct {
		Data []map[string]any `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}
	if len(body.Data) != 2 {
		t.Fatalf("expected 2 nodes, got %d", len(body.Data))
	}

	var web map[string]any
	for _, n := range body.Data {
		if n["name"] == "web-server-01" {
			web = n
		}
		// Token 一律 masked（決策 5 風險緩解）
		tok, _ := n["token"].(string)
		if !strings.HasPrefix(tok, "lsm_node_") || !strings.Contains(tok, "****") {
			t.Errorf("token not masked: %q", tok)
		}
	}
	if web == nil {
		t.Fatal("web-server-01 missing from list")
	}
	if web["status"] != "online" {
		t.Errorf("status: got %v", web["status"])
	}
	if web["last_heartbeat"] == "" {
		t.Error("last_heartbeat should be present")
	}
	svc, ok := web["service_stats"].(map[string]any)
	if !ok || svc["total"] != float64(10) || svc["active"] != float64(8) {
		t.Errorf("service_stats missing/mismatch: %v", web["service_stats"])
	}

	// 原始 token 不得出現在回應中
	if strings.Contains(w.Body.String(), n1.Token) || strings.Contains(w.Body.String(), n2.Token) {
		t.Error("raw token leaked in API response")
	}
}

// ============================================================
//  HDL-02: POST /nodes 建立成功（含健康檢查 → online）
// ============================================================

func TestHandleCreateNode_Success(t *testing.T) {
	withAdminAuth(t)
	auditMod := newTestAuditModule(t)

	agent := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/health" {
			w.Write([]byte(`{"version":"1.2.0","hostname":"web-01","os":"Ubuntu 22.04","uptime":123}`))
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	defer agent.Close()

	m := newNodesManager(t)
	router := setupNodeRouter(newNodeHandler(t, m, auditMod))
	cookie := adminCookie(t, router)

	payload := `{"name":"web-server-01","address":"` + strings.TrimPrefix(agent.URL, "https://") +
		`","tls_fingerprint":"` + serverFingerprint(t, agent) + `","token":"lsm_node_manual"}`
	w := postJSON(t, router, cookie, http.MethodPost, "/api/v1/nodes", payload)
	if w.Code != http.StatusOK && w.Code != http.StatusCreated {
		t.Fatalf("expected 200/201, got %d: %s", w.Code, w.Body.String())
	}

	var body struct {
		Data map[string]any `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}
	if id, _ := body.Data["id"].(string); id == "" {
		t.Error("expected generated node UUID")
	}
	if body.Data["name"] != "web-server-01" {
		t.Errorf("name: got %v", body.Data["name"])
	}
	// 健康檢查可達 → 初始 online
	if body.Data["status"] != "online" {
		t.Errorf("expected online after reachable health check, got %v", body.Data["status"])
	}
	tok, _ := body.Data["token"].(string)
	if !strings.Contains(tok, "****") {
		t.Errorf("token should be masked in response, got %q", tok)
	}

	// audit ActionNodeCreate
	auditMod.Shutdown()
	res, err := auditMod.Query(audit.QueryParams{Page: 1, Limit: 10})
	if err != nil {
		t.Fatalf("audit query: %v", err)
	}
	if res.Total < 1 || res.Entries[0].Action != audit.ActionNodeCreate {
		t.Errorf("expected ActionNodeCreate audit entry, got %+v", res.Entries)
	}
}

// ============================================================
//  HDL-03: POST 名稱重複回 409
// ============================================================

func TestHandleCreateNode_DuplicateName(t *testing.T) {
	withAdminAuth(t)
	m := newNodesManager(t)
	if _, err := m.Registry.Create(&nodes.Node{Name: "web-server-01", Address: "10.0.0.5:8443"}); err != nil {
		t.Fatalf("seed: %v", err)
	}

	router := setupNodeRouter(newNodeHandler(t, m, nil))
	cookie := adminCookie(t, router)

	w := postJSON(t, router, cookie, http.MethodPost, "/api/v1/nodes",
		`{"name":"web-server-01","address":"10.0.0.9:8443","token":"lsm_node_x"}`)
	if w.Code != http.StatusConflict {
		t.Errorf("expected 409, got %d: %s", w.Code, w.Body.String())
	}
}

// ============================================================
//  HDL-04: POST 必填欄位驗證 → 400
// ============================================================

func TestHandleCreateNode_RequiredFields(t *testing.T) {
	withAdminAuth(t)
	m := newNodesManager(t)
	router := setupNodeRouter(newNodeHandler(t, m, nil))
	cookie := adminCookie(t, router)

	cases := []struct {
		name string
		body string
	}{
		{"name empty", `{"name":"","address":"10.0.0.5:8443","token":"x"}`},
		{"address empty", `{"name":"web-server-01","address":"","token":"x"}`},
		{"both empty", `{"name":"","address":"","token":"x"}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			w := postJSON(t, router, cookie, http.MethodPost, "/api/v1/nodes", tc.body)
			if w.Code != http.StatusBadRequest {
				t.Errorf("expected 400, got %d: %s", w.Code, w.Body.String())
			}
			if w.Body.String() == "" {
				t.Error("expected explicit error message")
			}
		})
	}
}

// ============================================================
//  HDL-05: POST token 與指紋皆空 → 400（決策 5：至少填其一）
// ============================================================

func TestHandleCreateNode_NoTokenNoFingerprint(t *testing.T) {
	withAdminAuth(t)
	m := newNodesManager(t)
	router := setupNodeRouter(newNodeHandler(t, m, nil))
	cookie := adminCookie(t, router)

	w := postJSON(t, router, cookie, http.MethodPost, "/api/v1/nodes",
		`{"name":"web-server-01","address":"10.0.0.5:8443"}`)
	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d: %s", w.Code, w.Body.String())
	}
}

// ============================================================
//  HDL-06: POST address 格式非法（非 host:port）→ 400
// ============================================================

func TestHandleCreateNode_InvalidAddress(t *testing.T) {
	withAdminAuth(t)
	m := newNodesManager(t)
	router := setupNodeRouter(newNodeHandler(t, m, nil))
	cookie := adminCookie(t, router)

	for _, addr := range []string{"not-a-host", "http://10.0.0.5:8443", "10.0.0.5"} {
		t.Run(addr, func(t *testing.T) {
			w := postJSON(t, router, cookie, http.MethodPost, "/api/v1/nodes",
				`{"name":"web-server-01","address":"`+addr+`","token":"x"}`)
			if w.Code != http.StatusBadRequest {
				t.Errorf("expected 400 for address %q, got %d: %s", addr, w.Code, w.Body.String())
			}
		})
	}
}

// ============================================================
//  HDL-07: POST 第 51 個節點回上限錯誤
// ============================================================

func TestHandleCreateNode_NodeLimit(t *testing.T) {
	withAdminAuth(t)
	m := newNodesManager(t)
	for i := 0; i < 50; i++ {
		if _, err := m.Registry.Create(&nodes.Node{
			Name:    fmt.Sprintf("node-%02d", i),
			Address: "10.0.0.1:8443",
		}); err != nil {
			t.Fatalf("seed %d: %v", i, err)
		}
	}

	router := setupNodeRouter(newNodeHandler(t, m, nil))
	cookie := adminCookie(t, router)

	w := postJSON(t, router, cookie, http.MethodPost, "/api/v1/nodes",
		`{"name":"overflow","address":"10.0.0.9:8443","token":"x"}`)
	if w.Code != http.StatusBadRequest && w.Code != http.StatusConflict {
		t.Errorf("expected 400/409 for node limit, got %d: %s", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), "上限") && !strings.Contains(w.Body.String(), "limit") {
		t.Errorf("expected node-limit message, got %s", w.Body.String())
	}
}

// ============================================================
//  HDL-08: GET /nodes/{id} 回 200 / 404
// ============================================================

func TestHandleGetNode(t *testing.T) {
	withAdminAuth(t)
	m := newNodesManager(t)
	n, err := m.Registry.Create(&nodes.Node{Name: "web-server-01", Address: "10.0.0.5:8443"})
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	router := setupNodeRouter(newNodeHandler(t, m, nil))
	cookie := adminCookie(t, router)

	t.Run("existing id → 200", func(t *testing.T) {
		w := postJSON(t, router, cookie, http.MethodGet, "/api/v1/nodes/"+n.ID, "")
		if w.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
		}
		var body struct {
			Data map[string]any `json:"data"`
		}
		json.Unmarshal(w.Body.Bytes(), &body)
		if body.Data["name"] != "web-server-01" {
			t.Errorf("name: got %v", body.Data["name"])
		}
	})
	t.Run("nonexistent id → 404 node not found", func(t *testing.T) {
		w := postJSON(t, router, cookie, http.MethodGet, "/api/v1/nodes/ghost", "")
		if w.Code != http.StatusNotFound {
			t.Fatalf("expected 404, got %d: %s", w.Code, w.Body.String())
		}
		if !strings.Contains(w.Body.String(), "node not found") {
			t.Errorf("expected error node not found, got %s", w.Body.String())
		}
	})
}

// ============================================================
//  HDL-09: PUT 更新節點（token 留空 → 不變更）
// ============================================================

func TestHandleUpdateNode_TokenUnchanged(t *testing.T) {
	withAdminAuth(t)
	m := newNodesManager(t)
	n, err := m.Registry.Create(&nodes.Node{Name: "web-server-01", Address: "10.0.0.5:8443"})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	origToken := n.Token

	router := setupNodeRouter(newNodeHandler(t, m, nil))
	cookie := adminCookie(t, router)

	w := postJSON(t, router, cookie, http.MethodPut, "/api/v1/nodes/"+n.ID,
		`{"name":"web-server-01","address":"10.0.0.6:8443","notes":"prod"}`)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var body struct {
		Data map[string]any `json:"data"`
	}
	json.Unmarshal(w.Body.Bytes(), &body)
	if body.Data["address"] != "10.0.0.6:8443" {
		t.Errorf("address not updated: %v", body.Data["address"])
	}

	// registry 內 token 不變
	if got := m.Registry.Get(n.ID).Token; got != origToken {
		t.Errorf("token changed on update: got %q want %q", got, origToken)
	}
}

// ============================================================
//  HDL-10: DELETE 移除節點（audit 保留）
// ============================================================

func TestHandleDeleteNode_AuditKept(t *testing.T) {
	withAdminAuth(t)
	auditMod := newTestAuditModule(t)

	m := newNodesManager(t)
	n, err := m.Registry.Create(&nodes.Node{Name: "web-server-01", Address: "10.0.0.5:8443"})
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	router := setupNodeRouter(newNodeHandler(t, m, auditMod))
	cookie := adminCookie(t, router)

	w := postJSON(t, router, cookie, http.MethodDelete, "/api/v1/nodes/"+n.ID, "")
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), "節點已移除") {
		t.Errorf("expected removal message, got %s", w.Body.String())
	}
	if m.Registry.Get(n.ID) != nil {
		t.Error("node still in registry after delete")
	}

	// audit ActionNodeDelete 寫入（audit 模組獨立，不隨節點刪除）
	auditMod.Shutdown()
	res, err := auditMod.Query(audit.QueryParams{Page: 1, Limit: 10})
	if err != nil {
		t.Fatalf("audit query: %v", err)
	}
	if res.Total < 1 || res.Entries[0].Action != audit.ActionNodeDelete {
		t.Errorf("expected ActionNodeDelete audit entry, got %+v", res.Entries)
	}
}

// ============================================================
//  HDL-10b: POST /nodes/{id}/reconnect 重新連線
// ============================================================

func TestHandleNodeReconnect_NotFound(t *testing.T) {
	withAdminAuth(t)
	m := newNodesManager(t)
	router := setupNodeRouter(newNodeHandler(t, m, nil))
	cookie := adminCookie(t, router)

	w := postJSON(t, router, cookie, http.MethodPost, "/api/v1/nodes/ghost/reconnect", "")
	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d: %s", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), "node not found") {
		t.Errorf("expected error node not found, got %s", w.Body.String())
	}
}

func TestHandleNodeReconnect_Success(t *testing.T) {
	withAdminAuth(t)
	agent := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/health" {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		w.Write([]byte(`{"version":"1.2.3","hostname":"web-server-01","os":"Ubuntu 22.04"}`))
	}))
	defer agent.Close()

	auditMod := newTestAuditModule(t)
	m := newNodesManager(t)
	// 節點已離線、但保有最後心跳附帶的 service_stats
	n, err := m.Registry.Create(&nodes.Node{
		Name:          "web-server-01",
		Address:       strings.TrimPrefix(agent.URL, "https://"),
		TLSFingerprint: serverFingerprint(t, agent),
		ServiceStats:  nodes.ServiceStats{Total: 3, Active: 2, Failed: 1},
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	m.Registry.SetStatus(n.ID, nodes.StatusOffline)

	router := setupNodeRouter(newNodeHandler(t, m, auditMod))
	cookie := adminCookie(t, router)

	w := postJSON(t, router, cookie, http.MethodPost, "/api/v1/nodes/"+n.ID+"/reconnect", "")
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var body struct {
		Data map[string]any `json:"data"`
	}
	json.Unmarshal(w.Body.Bytes(), &body)
	if body.Data["agent_version"] != "1.2.3" || body.Data["hostname"] != "web-server-01" || body.Data["os"] != "Ubuntu 22.04" {
		t.Errorf("health snapshot fields not updated: %v", body.Data)
	}
	if body.Data["status"] != "online" {
		t.Errorf("status after reconnect: got %v, want online", body.Data["status"])
	}
	hb, _ := body.Data["last_heartbeat"].(string)
	if _, err := time.Parse(time.RFC3339, hb); err != nil {
		t.Errorf("last_heartbeat not RFC3339 UTC after reconnect: %q", hb)
	}

	// service_stats 不得被健康檢查覆寫（決策 3）
	nn := m.Registry.Get(n.ID)
	if nn.ServiceStats != (nodes.ServiceStats{Total: 3, Active: 2, Failed: 1}) {
		t.Errorf("service_stats overwritten by reconnect: %+v", nn.ServiceStats)
	}

	// audit ActionNodeReconnect 成功紀錄
	auditMod.Shutdown()
	res, err := auditMod.Query(audit.QueryParams{Page: 1, Limit: 10})
	if err != nil {
		t.Fatalf("audit query: %v", err)
	}
	if res.Total < 1 || res.Entries[0].Action != audit.ActionNodeReconnect || res.Entries[0].Result != audit.ResultSuccess {
		t.Errorf("expected ActionNodeReconnect success entry, got %+v", res.Entries)
	}
	if res.Entries[0].NodeID != n.ID {
		t.Errorf("audit node_id mismatch: got %q want %q", res.Entries[0].NodeID, n.ID)
	}
}

func TestHandleNodeReconnect_NodeOffline(t *testing.T) {
	withAdminAuth(t)
	// 取得一個已關閉的 port（connection refused）
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	addr := l.Addr().String()
	l.Close()

	auditMod := newTestAuditModule(t)
	m := newNodesManager(t)
	n, err := m.Registry.Create(&nodes.Node{Name: "web-server-01", Address: addr, Token: "x"})
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	router := setupNodeRouter(newNodeHandler(t, m, auditMod))
	cookie := adminCookie(t, router)

	w := postJSON(t, router, cookie, http.MethodPost, "/api/v1/nodes/"+n.ID+"/reconnect", "")
	if w.Code != http.StatusBadGateway {
		t.Fatalf("expected 502, got %d: %s", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), "node offline") {
		t.Errorf("expected error node offline, got %s", w.Body.String())
	}

	// 失敗亦記錄 audit（failure）
	auditMod.Shutdown()
	res, err := auditMod.Query(audit.QueryParams{Page: 1, Limit: 10})
	if err != nil {
		t.Fatalf("audit query: %v", err)
	}
	if res.Total < 1 || res.Entries[0].Action != audit.ActionNodeReconnect || res.Entries[0].Result != audit.ResultFailure {
		t.Errorf("expected ActionNodeReconnect failure entry, got %+v", res.Entries)
	}
}

// ============================================================
//  HDL-11: POST test-connection 成功
// ============================================================

func TestHandleTestConnection_Success(t *testing.T) {
	withAdminAuth(t)
	agent := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/health" {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		w.Write([]byte(`{"version":"1.2.3","hostname":"web-server-01","os":"Ubuntu 22.04","uptime":3600}`))
	}))
	defer agent.Close()

	m := newNodesManager(t)
	router := setupNodeRouter(newNodeHandler(t, m, nil))
	cookie := adminCookie(t, router)

	w := postJSON(t, router, cookie, http.MethodPost, "/api/v1/nodes/test-connection",
		`{"address":"`+strings.TrimPrefix(agent.URL, "https://")+`","tls_fingerprint":"`+serverFingerprint(t, agent)+`"}`)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}
	if body["version"] != "1.2.3" || body["hostname"] != "web-server-01" || body["os"] != "Ubuntu 22.04" {
		t.Errorf("test-connection result mismatch: %v", body)
	}
	if _, ok := body["uptime"]; !ok {
		t.Error("uptime missing from test-connection result")
	}
}

// ============================================================
//  HDL-12: test-connection connection refused → 502
// ============================================================

func TestHandleTestConnection_ConnectionRefused(t *testing.T) {
	withAdminAuth(t)
	// 取得一個已關閉的 port
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	addr := l.Addr().String()
	l.Close()

	m := newNodesManager(t)
	router := setupNodeRouter(newNodeHandler(t, m, nil))
	cookie := adminCookie(t, router)

	w := postJSON(t, router, cookie, http.MethodPost, "/api/v1/nodes/test-connection",
		`{"address":"`+addr+`","token":"x"}`)
	if w.Code != http.StatusBadGateway {
		t.Fatalf("expected 502, got %d: %s", w.Code, w.Body.String())
	}
	if !strings.Contains(strings.ToLower(w.Body.String()), "refused") {
		t.Errorf("expected connection refused detail in body, got %s", w.Body.String())
	}
}

// ============================================================
//  HDL-13: test-connection TLS 憑證驗證失敗（指紋不符）→ 502
// ============================================================

func TestHandleTestConnection_TLSFailure(t *testing.T) {
	withAdminAuth(t)
	agent := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"version":"1.2.0"}`))
	}))
	defer agent.Close()

	m := newNodesManager(t)
	router := setupNodeRouter(newNodeHandler(t, m, nil))
	cookie := adminCookie(t, router)

	w := postJSON(t, router, cookie, http.MethodPost, "/api/v1/nodes/test-connection",
		`{"address":"`+strings.TrimPrefix(agent.URL, "https://")+`","tls_fingerprint":"`+strings.Repeat("0", 64)+`"}`)
	if w.Code != http.StatusBadGateway {
		t.Fatalf("expected 502, got %d: %s", w.Code, w.Body.String())
	}
	if !strings.Contains(strings.ToLower(w.Body.String()), "tls") &&
		!strings.Contains(strings.ToLower(w.Body.String()), "fingerprint") &&
		!strings.Contains(strings.ToLower(w.Body.String()), "certificate") {
		t.Errorf("expected TLS failure detail in body, got %s", w.Body.String())
	}
}

// ============================================================
//  HDL-14: test-connection 逾時 5s → 504
// ============================================================

func TestHandleTestConnection_Timeout(t *testing.T) {
	withAdminAuth(t)
	agent := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(6 * time.Second) // 超過 test-connection 5s 逾時
	}))
	defer agent.Close()

	m := newNodesManager(t)
	router := setupNodeRouter(newNodeHandler(t, m, nil))
	cookie := adminCookie(t, router)

	w := postJSON(t, router, cookie, http.MethodPost, "/api/v1/nodes/test-connection",
		`{"address":"`+strings.TrimPrefix(agent.URL, "https://")+`","tls_fingerprint":"`+serverFingerprint(t, agent)+`"}`)
	if w.Code != http.StatusGatewayTimeout {
		t.Fatalf("expected 504, got %d: %s", w.Code, w.Body.String())
	}
}

// ============================================================
//  HDL-15: GET /nodes/summary 聚合心跳統計（零網路請求）
// ============================================================

func TestHandleNodesSummary(t *testing.T) {
	withAdminAuth(t)
	m := newNodesManager(t)

	// 節點 1：online、stats {10,8,1}
	n1, _ := m.Registry.Create(&nodes.Node{Name: "web-server-01", Address: "10.0.0.5:8443"})
	m.Registry.SetStatus(n1.ID, nodes.StatusOnline)
	m.Registry.SetHeartbeat("web-server-01", nodes.Heartbeat{NodeName: "web-server-01", Services: nodes.ServiceStats{Total: 10, Active: 8, Failed: 1}})

	// 節點 2：online、stats {20,17,1}
	n2, _ := m.Registry.Create(&nodes.Node{Name: "db-server-01", Address: "10.0.0.6:8443"})
	m.Registry.SetStatus(n2.ID, nodes.StatusOnline)
	m.Registry.SetHeartbeat("db-server-01", nodes.Heartbeat{NodeName: "db-server-01", Services: nodes.ServiceStats{Total: 20, Active: 17, Failed: 1}})

	// 節點 3：offline、無統計
	n3, _ := m.Registry.Create(&nodes.Node{Name: "cache-server-01", Address: "10.0.0.7:8443"})
	m.Registry.SetStatus(n3.ID, nodes.StatusOffline)

	router := setupNodeRouter(newNodeHandler(t, m, nil))
	cookie := adminCookie(t, router)

	w := postJSON(t, router, cookie, http.MethodGet, "/api/v1/nodes/summary", "")
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var body struct {
		Data map[string]any `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}
	want := map[string]float64{
		"total_nodes":     3,
		"online":          2,
		"degraded":        0,
		"offline":         1,
		"long_offline":    0,
		"warning":         0,
		"total_services":  30,
		"active_services": 25,
		"failed_services": 2,
	}
	for k, v := range want {
		if got, ok := body.Data[k].(float64); !ok || got != v {
			t.Errorf("summary.%s: got %v, want %v", k, body.Data[k], v)
		}
	}
}

// ============================================================
//  HDL-16~18: GET /agents/download?arch=
// ============================================================

func TestHandleAgentDownload(t *testing.T) {
	withAdminAuth(t)
	m := newNodesManager(t)
	router := setupNodeRouter(newNodeHandler(t, m, nil))
	cookie := adminCookie(t, router)

	t.Run("amd64 → 200 octet-stream", func(t *testing.T) {
		w := postJSON(t, router, cookie, http.MethodGet, "/api/v1/agents/download?arch=amd64", "")
		if w.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
		}
		if ct := w.Header().Get("Content-Type"); !strings.Contains(ct, "application/octet-stream") {
			t.Errorf("expected application/octet-stream, got %q", ct)
		}
		if cd := w.Header().Get("Content-Disposition"); !strings.Contains(cd, "agent-linux-amd64") {
			t.Errorf("expected amd64 filename in Content-Disposition, got %q", cd)
		}
	})
	t.Run("arm64 → 200", func(t *testing.T) {
		w := postJSON(t, router, cookie, http.MethodGet, "/api/v1/agents/download?arch=arm64", "")
		if w.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
		}
		if cd := w.Header().Get("Content-Disposition"); !strings.Contains(cd, "agent-linux-arm64") {
			t.Errorf("expected arm64 filename in Content-Disposition, got %q", cd)
		}
	})
	t.Run("unknown arch → 400/404", func(t *testing.T) {
		w := postJSON(t, router, cookie, http.MethodGet, "/api/v1/agents/download?arch=mips", "")
		if w.Code != http.StatusBadRequest && w.Code != http.StatusNotFound {
			t.Errorf("expected 400/404 for unsupported arch, got %d", w.Code)
		}
	})
}
