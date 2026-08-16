package nodes

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// ============================================================
//  Helpers
// ============================================================

// newTestManager 建立含暫存 registry 的 Manager（不啟動 supervisor）。
func newTestManager(t *testing.T) *Manager {
	t.Helper()
	dir := t.TempDir()
	m, err := New(Config{RegistryPath: filepath.Join(dir, "nodes.json")})
	if err != nil {
		t.Fatalf("failed to create manager: %v", err)
	}
	return m
}

// tlsTestNode 以 Create 建立指向 TLS mock server 的節點（含指紋 pin，仿 client_test.go 模式）。
func tlsTestNode(t *testing.T, m *Manager, name string, srv *httptest.Server) *Node {
	t.Helper()
	n, err := m.Registry.Create(&Node{
		Name:           name,
		Address:        strings.TrimPrefix(srv.URL, "https://"),
		TLSFingerprint: serverFingerprint(t, srv),
		Token:          "lsm_node_test",
	})
	if err != nil {
		t.Fatalf("failed to create node %s: %v", name, err)
	}
	return n
}

// healthMock 產生回傳固定 /health payload 的 TLS mock server。
func healthMock(t *testing.T, body string) *httptest.Server {
	t.Helper()
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/health" || r.Method != http.MethodGet {
			t.Errorf("expected GET /health, got %s %s", r.Method, r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(body))
	}))
	return srv
}

// ============================================================
//  GAP-2-A: 啟動健康檢查成功 → 建立第一筆 last_heartbeat + 連線資訊
// ============================================================

func TestManager_StartupHealthCheck_Success(t *testing.T) {
	srv := healthMock(t, `{"version":"1.2.0","hostname":"web-01","os":"Ubuntu 22.04","uptime":42}`)
	defer srv.Close()

	m := newTestManager(t)
	tlsTestNode(t, m, "web-server-01", srv)

	res := m.StartupHealthCheck(context.Background())
	if res.Total != 1 || res.Success != 1 || res.Failed != 0 {
		t.Fatalf("unexpected result: total=%d success=%d failed=%d, want 1/1/0", res.Total, res.Success, res.Failed)
	}

	n := m.Registry.GetByName("web-server-01")
	if n.LastHeartbeat == "" {
		t.Fatal("expected last_heartbeat to be established by startup health check")
	}
	if _, err := time.Parse(time.RFC3339Nano, n.LastHeartbeat); err != nil {
		t.Errorf("last_heartbeat %q is not RFC3339 UTC: %v", n.LastHeartbeat, err)
	}
	if n.AgentVersion != "1.2.0" {
		t.Errorf("agent_version = %q, want 1.2.0", n.AgentVersion)
	}
	if n.Hostname != "web-01" {
		t.Errorf("hostname = %q, want web-01", n.Hostname)
	}
	if n.OS != "Ubuntu 22.04" {
		t.Errorf("os = %q, want Ubuntu 22.04", n.OS)
	}
}

// ============================================================
//  GAP-2-B: 失敗節點（offline / timeout）不更新且不 panic
// ============================================================

func TestManager_StartupHealthCheck_FailureSkips(t *testing.T) {
	// connection refused（NodeOfflineError）
	deadAddr := closedAddr(t)

	// timeout（NodeTimeoutError）：慢速 mock + 短外層 ctx
	slow := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(2 * time.Second)
	}))
	defer slow.Close()

	m := newTestManager(t)
	if _, err := m.Registry.Create(&Node{Name: "dead-node", Address: deadAddr, Token: "lsm_node_test"}); err != nil {
		t.Fatalf("failed to create dead-node: %v", err)
	}
	tlsTestNode(t, m, "slow-node", slow)

	ctx, cancel := context.WithTimeout(context.Background(), 150*time.Millisecond)
	defer cancel()
	res := m.StartupHealthCheck(ctx) // 不 panic 即為通過之一

	if res.Total != 2 || res.Success != 0 || res.Failed != 2 {
		t.Fatalf("unexpected result: total=%d success=%d failed=%d, want 2/0/2", res.Total, res.Success, res.Failed)
	}

	// 節點維持現狀：last_heartbeat 不被建立、status 維持 Create 的 offline
	for _, name := range []string{"dead-node", "slow-node"} {
		n := m.Registry.GetByName(name)
		if n.LastHeartbeat != "" {
			t.Errorf("%s: expected no last_heartbeat on failure, got %q", name, n.LastHeartbeat)
		}
		if n.Status != StatusOffline {
			t.Errorf("%s: status changed to %q on failed health check, want offline (維持現狀)", name, n.Status)
		}
	}
}

// ============================================================
//  GAP-2-C: service_stats 不被啟動健康檢查覆寫
// ============================================================

func TestManager_StartupHealthCheck_PreservesServiceStats(t *testing.T) {
	srv := healthMock(t, `{"version":"1.2.0","hostname":"web-01","os":"Ubuntu 22.04","uptime":42}`)
	defer srv.Close()

	m := newTestManager(t)
	tlsTestNode(t, m, "web-server-01", srv)

	// 先以心跳建立最後一次服務統計（總 12 / 啟用 9 / 失敗 2）
	m.Registry.SetHeartbeat("web-server-01", Heartbeat{
		NodeName:     "web-server-01",
		AgentVersion: "0.9.0", // 舊版本 — 健康檢查應更新為 /health 回報值
		Hostname:     "old-host",
		OS:           "old-os",
		Services:     ServiceStats{Total: 12, Active: 9, Failed: 2},
	})

	res := m.StartupHealthCheck(context.Background())
	if res.Success != 1 {
		t.Fatalf("expected 1 success, got total=%d success=%d failed=%d", res.Total, res.Success, res.Failed)
	}

	n := m.Registry.GetByName("web-server-01")
	if n.ServiceStats != (ServiceStats{Total: 12, Active: 9, Failed: 2}) {
		t.Errorf("service_stats overwritten by health check: %+v, want {12 9 2}", n.ServiceStats)
	}
	// 連線欄位應更新為 /health 資訊（最後心跳附帶的統計保留、連線資訊以 /health 為準）
	if n.AgentVersion != "1.2.0" || n.Hostname != "web-01" || n.OS != "Ubuntu 22.04" {
		t.Errorf("connection info not refreshed: version=%q hostname=%q os=%q", n.AgentVersion, n.Hostname, n.OS)
	}
	if n.LastHeartbeat == "" {
		t.Error("expected last_heartbeat after successful health check")
	}
}

// ============================================================
//  GAP-2-D: 並行上限 10（慢速 mock server + 即時 in-flight 計數）
// ============================================================

func TestManager_StartupHealthCheck_ConcurrencyLimit(t *testing.T) {
	var (
		mu          sync.Mutex
		inflight    int
		maxInflight int
		requests    atomic.Int32
	)
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		inflight++
		if inflight > maxInflight {
			maxInflight = inflight
		}
		mu.Unlock()
		requests.Add(1)

		time.Sleep(150 * time.Millisecond) // 慢速回應 — 放大並行視窗

		mu.Lock()
		inflight--
		mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"version":"1.2.0","hostname":"web-01","os":"Ubuntu 22.04"}`))
	}))
	defer srv.Close()

	const total = 25
	m := newTestManager(t)
	for i := 0; i < total; i++ {
		tlsTestNode(t, m, fmt.Sprintf("node-%02d", i), srv)
	}

	start := time.Now()
	res := m.StartupHealthCheck(context.Background())
	elapsed := time.Since(start)

	if requests.Load() != total {
		t.Errorf("server received %d requests, want %d", requests.Load(), total)
	}
	if res.Success != total || res.Failed != 0 {
		t.Errorf("unexpected result: total=%d success=%d failed=%d", res.Total, res.Success, res.Failed)
	}

	mu.Lock()
	gotMax := maxInflight
	mu.Unlock()
	if gotMax > 10 {
		t.Errorf("max concurrent health checks = %d, want <= 10 (semaphore)", gotMax)
	}
	if gotMax < 2 {
		t.Errorf("max concurrent = %d, want > 1 (fan-out broken — requests serialized?)", gotMax)
	}
	// 25 × 150ms / 10 並行 ≈ 450ms；若被序列化需 ≥ 3.75s。2.5s 為寬鬆上界（防 slow CI flaky）。
	if elapsed > 2500*time.Millisecond {
		t.Errorf("health check took %v, expected parallel fan-out (~0.5s), serialized execution?", elapsed)
	}
}

// ============================================================
//  GAP-2-E: 空 registry 不 crash
// ============================================================

func TestManager_StartupHealthCheck_EmptyRegistry(t *testing.T) {
	m := newTestManager(t)
	res := m.StartupHealthCheck(context.Background())
	if res.Total != 0 || res.Success != 0 || res.Failed != 0 {
		t.Errorf("empty registry should yield zero stats, got total=%d success=%d failed=%d", res.Total, res.Success, res.Failed)
	}

	// 已取消的 context 亦不 crash（關機路徑）
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_ = m.StartupHealthCheck(ctx)
}

// ============================================================
//  GAP-2-F: SetHealthSnapshot 直測 — 不覆寫 service_stats、只更新連線欄位
// ============================================================

func TestRegistry_SetHealthSnapshot_PreservesStats(t *testing.T) {
	r := newTestRegistry(t)
	n, err := r.Create(&Node{Name: "web-server-01", Address: "10.0.0.5:8443", Token: "lsm_node_test"})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	r.SetHeartbeat("web-server-01", Heartbeat{
		NodeName: "web-server-01", AgentVersion: "0.9.0",
		Services: ServiceStats{Total: 7, Active: 5, Failed: 1},
	})

	r.SetHealthSnapshot(n.ID, "1.2.0", "web-01", "Ubuntu 22.04")

	got := r.Get(n.ID)
	if got.LastHeartbeat == "" {
		t.Error("expected last_heartbeat set by SetHealthSnapshot")
	}
	if got.AgentVersion != "1.2.0" || got.Hostname != "web-01" || got.OS != "Ubuntu 22.04" {
		t.Errorf("connection info not updated: version=%q hostname=%q os=%q", got.AgentVersion, got.Hostname, got.OS)
	}
	if got.ServiceStats != (ServiceStats{Total: 7, Active: 5, Failed: 1}) {
		t.Errorf("service_stats overwritten: %+v, want {7 5 1}", got.ServiceStats)
	}

	// 不存在 id → 靜默 no-op（不 panic）
	r.SetHealthSnapshot("missing-id", "1.2.0", "h", "o")
}
