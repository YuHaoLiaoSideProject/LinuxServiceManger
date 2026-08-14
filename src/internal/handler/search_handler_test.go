package handler

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"linux-service-manager/internal/nodes"
)

// ============================================================
//  Mock Agent（搜尋 fan-out 測試用；實作 q= substring 過濾）
// ============================================================

// newSearchAgent 建立 mock Agent：GET /api/v1/services?q= 依 substring 過濾。
// 若 delay > 0 則每個請求先 sleep（模擬慢速節點）；maxConcurrent 非 nil 時記錄峰值。
func newSearchAgent(t *testing.T, delay time.Duration, maxConcurrent *int32) *httptest.Server {
	t.Helper()
	var active atomic.Int32
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		cur := active.Add(1)
		defer active.Add(-1)
		if maxConcurrent != nil {
			for {
				old := atomic.LoadInt32(maxConcurrent)
				if cur <= old || atomic.CompareAndSwapInt32(maxConcurrent, old, cur) {
					break
				}
			}
		}
		if delay > 0 {
			time.Sleep(delay)
		}
		w.Header().Set("Content-Type", "application/json")
		q := r.URL.Query().Get("q")
		if strings.Contains("nginx.service", q) {
			w.Write([]byte(`[{"name":"nginx.service","load":"loaded","active":"active","sub":"running","unitFileState":"enabled","fragmentPath":"/etc/systemd/system/nginx.service","locked":false}]`))
		} else {
			w.Write([]byte(`[]`))
		}
	}))
	t.Cleanup(srv.Close)
	return srv
}

// registerSearchNode 註冊一個指向 mock Agent 的線上節點。
func registerSearchNode(t *testing.T, m *nodes.Manager, name string, srv *httptest.Server) *nodes.Node {
	t.Helper()
	return registerNode(t, m, name, strings.TrimPrefix(srv.URL, "https://"), serverFingerprint(t, srv))
}

func doSearch(t *testing.T, router http.Handler, cookie *http.Cookie, q string) *httptest.ResponseRecorder {
	t.Helper()
	path := "/api/v1/nodes/services/search"
	if q != "" {
		path += "?q=" + q
	}
	return postJSON(t, router, cookie, http.MethodGet, path, "")
}

// parseSearchResponse 解析搜尋回應 {results, failed_nodes}。
func parseSearchResponse(t *testing.T, w *httptest.ResponseRecorder) ([]map[string]any, []map[string]any) {
	t.Helper()
	var body struct {
		Results     []map[string]any `json:"results"`
		FailedNodes []map[string]any `json:"failed_nodes"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("invalid search response: %v\n%s", err, w.Body.String())
	}
	return body.Results, body.FailedNodes
}

// ============================================================
//  HDL-28: 搜尋 fan-out 成功彙總（3 個線上節點皆回匹配）
// ============================================================

func TestSearchServices_FanOutSuccess(t *testing.T) {
	withAdminAuth(t)
	m := newNodesManager(t)
	agent := newSearchAgent(t, 0, nil)
	registerSearchNode(t, m, "web-server-01", agent)
	registerSearchNode(t, m, "db-server-01", agent)
	registerSearchNode(t, m, "cache-server-01", agent)

	router := setupNodeRouter(newNodeHandler(t, m, nil))
	cookie := adminCookie(t, router)

	w := doSearch(t, router, cookie, "nginx")
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	results, failed := parseSearchResponse(t, w)
	if len(failed) != 0 {
		t.Errorf("expected no failed nodes, got %v", failed)
	}
	if len(results) != 3 {
		t.Fatalf("expected 3 results, got %d: %v", len(results), results)
	}
	names := map[string]bool{}
	for _, r := range results {
		if r["service"] != "nginx.service" || r["active"] != "active" || r["sub"] != "running" {
			t.Errorf("result fields mismatch: %v", r)
		}
		if r["node_id"] == "" || r["node_name"] == "" {
			t.Errorf("result missing node identity: %v", r)
		}
		names[r["node_name"].(string)] = true
	}
	for _, want := range []string{"web-server-01", "db-server-01", "cache-server-01"} {
		if !names[want] {
			t.Errorf("missing result from node %s", want)
		}
	}
}

// ============================================================
//  HDL-29: 僅查線上節點（離線節點不查詢、列 failed_nodes reason=offline）
// ============================================================

func TestSearchServices_OfflineNodeSkipped(t *testing.T) {
	withAdminAuth(t)
	m := newNodesManager(t)
	agent := newSearchAgent(t, 0, nil)
	online := registerSearchNode(t, m, "web-server-01", agent)

	// 離線節點：不查詢、直接列 failed_nodes
	offline, err := m.Registry.Create(&nodes.Node{Name: "db-server-01", Address: "10.0.0.9:1", TLSFingerprint: strings.Repeat("0", 64)})
	if err != nil {
		t.Fatalf("create offline node: %v", err)
	}
	m.Registry.SetStatus(offline.ID, nodes.StatusOffline)

	router := setupNodeRouter(newNodeHandler(t, m, nil))
	cookie := adminCookie(t, router)

	w := doSearch(t, router, cookie, "nginx")
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	results, failed := parseSearchResponse(t, w)
	if len(results) != 1 || results[0]["node_name"] != "web-server-01" {
		t.Errorf("expected results only from online node, got %v", results)
	}
	if len(failed) != 1 {
		t.Fatalf("expected 1 failed node, got %v", failed)
	}
	if failed[0]["node_id"] != offline.ID || failed[0]["node_name"] != "db-server-01" {
		t.Errorf("failed node identity mismatch: %v", failed[0])
	}
	if failed[0]["reason"] != "offline" {
		t.Errorf("expected reason offline for offline node, got %v", failed[0]["reason"])
	}
	_ = online
}

// ============================================================
//  HDL-30: 部分節點失敗不阻塞（A 回結果、B 逾時）
// ============================================================

func TestSearchServices_PartialFailure(t *testing.T) {
	withAdminAuth(t)
	m := newNodesManager(t)

	fast := newSearchAgent(t, 0, nil)
	registerSearchNode(t, m, "web-server-01", fast)

	// B：接受連線但永不回應 → 總 context 10s 後被視為 timeout
	slow := newSearchAgent(t, 30*time.Second, nil)
	registerSearchNode(t, m, "db-server-01", slow)

	router := setupNodeRouter(newNodeHandler(t, m, nil))
	cookie := adminCookie(t, router)

	start := time.Now()
	w := doSearch(t, router, cookie, "nginx")
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	if elapsed := time.Since(start); elapsed > 13*time.Second {
		t.Errorf("search should respect 10s total budget, took %v", elapsed)
	}

	results, failed := parseSearchResponse(t, w)
	if len(results) != 1 || results[0]["node_name"] != "web-server-01" {
		t.Errorf("expected results from reachable node only, got %v", results)
	}
	if len(failed) != 1 || failed[0]["node_name"] != "db-server-01" {
		t.Fatalf("expected db-server-01 in failed_nodes, got %v", failed)
	}
	if failed[0]["reason"] != "timeout" {
		t.Errorf("expected reason timeout, got %v", failed[0]["reason"])
	}
}

// ============================================================
//  HDL-31: 總逾時 10s 部分結果先回
// ============================================================

func TestSearchServices_TotalTimeoutPartialResult(t *testing.T) {
	withAdminAuth(t)
	m := newNodesManager(t)

	fast := newSearchAgent(t, 0, nil)
	registerSearchNode(t, m, "web-server-01", fast)

	// 其餘節點全部掛起 → 逾時後僅回傳已收集的部分結果
	for i := 0; i < 2; i++ {
		hang := newSearchAgent(t, 60*time.Second, nil)
		registerSearchNode(t, m, fmt.Sprintf("slow-%d", i), hang)
	}

	router := setupNodeRouter(newNodeHandler(t, m, nil))
	cookie := adminCookie(t, router)

	start := time.Now()
	w := doSearch(t, router, cookie, "nginx")
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	if elapsed := time.Since(start); elapsed > 13*time.Second {
		t.Errorf("search exceeded 10s total budget, took %v", elapsed)
	}

	results, failed := parseSearchResponse(t, w)
	if len(results) != 1 || results[0]["node_name"] != "web-server-01" {
		t.Errorf("partial results should include reachable node, got %v", results)
	}
	if len(failed) != 2 {
		t.Errorf("expected 2 timed-out nodes in failed_nodes, got %v", failed)
	}
	for _, f := range failed {
		if f["reason"] != "timeout" {
			t.Errorf("expected timeout reason, got %v", f["reason"])
		}
	}
}

// ============================================================
//  HDL-32: semaphore 上限 10（50 節點同時查詢、無死鎖）
// ============================================================

func TestSearchServices_SemaphoreLimit(t *testing.T) {
	withAdminAuth(t)
	m := newNodesManager(t)

	var maxConcurrent int32
	agent := newSearchAgent(t, 200*time.Millisecond, &maxConcurrent)

	for i := 0; i < 12; i++ {
		registerSearchNode(t, m, fmt.Sprintf("node-%02d", i), agent)
	}

	router := setupNodeRouter(newNodeHandler(t, m, nil))
	cookie := adminCookie(t, router)

	w := doSearch(t, router, cookie, "nginx")
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	results, failed := parseSearchResponse(t, w)
	if len(failed) != 0 {
		t.Errorf("all nodes should succeed, got failed: %v", failed)
	}
	if len(results) != 12 {
		t.Errorf("expected 12 results, got %d", len(results))
	}
	if maxConcurrent > 10 {
		t.Errorf("semaphore should cap concurrency at 10, observed %d", maxConcurrent)
	}
}

// ============================================================
//  HDL-33: q 空白參數驗證 → 400
// ============================================================

func TestSearchServices_MissingQuery(t *testing.T) {
	withAdminAuth(t)
	m := newNodesManager(t)
	router := setupNodeRouter(newNodeHandler(t, m, nil))
	cookie := adminCookie(t, router)

	for _, path := range []string{"/api/v1/nodes/services/search", "/api/v1/nodes/services/search?q=", "/api/v1/nodes/services/search?q=%20"} {
		w := postJSON(t, router, cookie, http.MethodGet, path, "")
		if w.Code != http.StatusBadRequest {
			t.Errorf("%s: expected 400, got %d: %s", path, w.Code, w.Body.String())
		}
	}
}

// ============================================================
//  HDL-34: 未登入 9 個節點 API 回 401
// ============================================================

func TestNodeAPIs_Unauthorized(t *testing.T) {
	m := newNodesManager(t)
	router := setupNodeRouter(newNodeHandler(t, m, nil))

	endpoints := []struct{ method, path string }{
		{http.MethodGet, "/api/v1/nodes"},
		{http.MethodPost, "/api/v1/nodes"},
		{http.MethodGet, "/api/v1/nodes/1"},
		{http.MethodPut, "/api/v1/nodes/1"},
		{http.MethodDelete, "/api/v1/nodes/1"},
		{http.MethodPost, "/api/v1/nodes/test-connection"},
		{http.MethodGet, "/api/v1/nodes/summary"},
		{http.MethodGet, "/api/v1/nodes/1/services"},
		{http.MethodGet, "/api/v1/nodes/services/search?q=nginx"},
	}
	for _, ep := range endpoints {
		t.Run(ep.method+" "+ep.path, func(t *testing.T) {
			req := httptest.NewRequest(ep.method, ep.path, nil)
			w := httptest.NewRecorder()
			router.ServeHTTP(w, req)
			if w.Code != http.StatusUnauthorized {
				t.Errorf("expected 401, got %d: %s", w.Code, w.Body.String())
			}
		})
	}
}

// ============================================================
//  HDL-35: 未登入補充代理端點回 401
// ============================================================

func TestNodeProxyAPIs_Unauthorized(t *testing.T) {
	m := newNodesManager(t)
	router := setupNodeRouter(newNodeHandler(t, m, nil))

	endpoints := []struct{ method, path string }{
		{http.MethodGet, "/api/v1/nodes/1/info"},
		{http.MethodGet, "/api/v1/nodes/1/services/nginx.service/logs"},
		{http.MethodPost, "/api/v1/nodes/1/services/nginx.service/restart"},
		{http.MethodGet, "/api/v1/agents/download?arch=amd64"},
	}
	for _, ep := range endpoints {
		t.Run(ep.method+" "+ep.path, func(t *testing.T) {
			req := httptest.NewRequest(ep.method, ep.path, nil)
			w := httptest.NewRecorder()
			router.ServeHTTP(w, req)
			if w.Code != http.StatusUnauthorized {
				t.Errorf("expected 401, got %d: %s", w.Code, w.Body.String())
			}
		})
	}
}

// ============================================================
//  HDL-36: 心跳路由不需 session（節點 token 自證，群組外路由）
// ============================================================

func TestAgentHeartbeat_NoSession(t *testing.T) {
	m := newNodesManager(t)
	created, err := m.Registry.Create(&nodes.Node{Name: "web-server-01", Address: "10.0.0.5:8443"})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	router := setupNodeRouter(newNodeHandler(t, m, nil))

	// 無 session 但帶節點 Bearer token → token 自證成功
	body := `{"node_name":"web-server-01","agent_version":"1.2.0","hostname":"web-01","os":"Ubuntu 22.04","services":{"total":1,"active":1,"failed":0}}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/agent/heartbeat", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+created.Token)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 (token self-assertion outside auth group), got %d: %s", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), `"accepted":true`) {
		t.Errorf("expected accepted:true, got %s", w.Body.String())
	}

	// 無 token → 401
	req2 := httptest.NewRequest(http.MethodPost, "/api/v1/agent/heartbeat", strings.NewReader(body))
	req2.Header.Set("Content-Type", "application/json")
	w2 := httptest.NewRecorder()
	router.ServeHTTP(w2, req2)
	if w2.Code != http.StatusUnauthorized {
		t.Errorf("expected 401 without token, got %d", w2.Code)
	}
}
