package agent

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// ============================================================
//  Helpers
// ============================================================

// heartbeatRecorder 記錄 mock Manager 收到的心跳請求。
type heartbeatRecorder struct {
	mu     sync.Mutex
	bodies []map[string]any
	auth   []string
}

func (r *heartbeatRecorder) add(body map[string]any, auth string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.bodies = append(r.bodies, body)
	r.auth = append(r.auth, auth)
}

func (r *heartbeatRecorder) count() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.bodies)
}

func (r *heartbeatRecorder) first() map[string]any {
	r.mu.Lock()
	defer r.mu.Unlock()
	if len(r.bodies) == 0 {
		return nil
	}
	return r.bodies[0]
}

// newHeartbeatClient 建立指向 mock Manager 的心跳 client（信任測試憑證）。
func newHeartbeatClient(t *testing.T, interval string) (*HeartbeatClient, *heartbeatRecorder) {
	t.Helper()
	rec := &heartbeatRecorder{}
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var b map[string]any
		json.NewDecoder(r.Body).Decode(&b)
		rec.add(b, r.Header.Get("Authorization"))
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"ok":true,"accepted":true}`))
	}))
	t.Cleanup(srv.Close)

	cfg := &Config{
		ManagerAddr:       strings.TrimPrefix(srv.URL, "https://"),
		AuthToken:         "lsm_node_secret",
		NodeName:          "web-server-01",
		HeartbeatInterval: interval,
	}
	c := NewHeartbeatClient(cfg, "1.2.0")
	c.client = srv.Client() // 信任 mock Manager 的自簽憑證
	return c, rec
}

func waitFor(t *testing.T, what string, timeout time.Duration, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for %s", what)
}

// ============================================================
//  SYS-56: 心跳 client 週期 POST + payload 完整（含 jitter 設計）
// ============================================================

func TestHeartbeatClient_SendsPayload(t *testing.T) {
	c, rec := newHeartbeatClient(t, "100ms")

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go c.Run(ctx)

	waitFor(t, "first heartbeat", 5*time.Second, func() bool { return rec.count() >= 1 })

	b := rec.first()
	if b["node_name"] != "web-server-01" {
		t.Errorf("node_name: got %v", b["node_name"])
	}
	if b["agent_version"] != "1.2.0" {
		t.Errorf("agent_version: got %v", b["agent_version"])
	}
	if b["hostname"] == "" {
		t.Error("hostname should be populated")
	}
	if b["os"] == "" {
		t.Error("os should be populated")
	}
	if _, ok := b["uptime_seconds"]; !ok {
		t.Error("uptime_seconds missing")
	}
	svc, ok := b["services"].(map[string]any)
	if !ok {
		t.Fatal("services payload missing")
	}
	for _, k := range []string{"total", "active", "failed"} {
		if _, ok := svc[k]; !ok {
			t.Errorf("services.%s missing", k)
		}
	}

	// Bearer token 注入
	rec.mu.Lock()
	auth := rec.auth[0]
	rec.mu.Unlock()
	if auth != "Bearer lsm_node_secret" {
		t.Errorf("expected Bearer lsm_node_secret, got %q", auth)
	}

	// ticker 持續發送（10s 週期 ±2s jitter；測試用 100ms 週期加速驗證「持續」語意）
	waitFor(t, "second heartbeat (ticker keeps sending)", 5*time.Second, func() bool { return rec.count() >= 2 })
}

func TestHeartbeatClient_IntervalParsing(t *testing.T) {
	// 有效字串 → 解析
	c1 := NewHeartbeatClient(&Config{HeartbeatInterval: "10s"}, "1.2.0")
	if c1.interval != 10*time.Second {
		t.Errorf("expected 10s interval, got %v", c1.interval)
	}
	// 非法字串 → 預設 10s
	c2 := NewHeartbeatClient(&Config{HeartbeatInterval: "bogus"}, "1.2.0")
	if c2.interval != 10*time.Second {
		t.Errorf("expected default 10s interval for invalid value, got %v", c2.interval)
	}
}

// ============================================================
//  SYS-57: 心跳失敗 exponential backoff 重試（不 panic）
// ============================================================

func TestHeartbeatClient_BackoffRetry(t *testing.T) {
	var count atomic.Int32
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		io.Copy(io.Discard, r.Body)
		if count.Add(1) <= 2 {
			w.WriteHeader(http.StatusInternalServerError)
			w.Write([]byte(`{"error":"boom"}`))
			return
		}
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"ok":true,"accepted":true}`))
	}))
	t.Cleanup(srv.Close)

	cfg := &Config{
		ManagerAddr:       strings.TrimPrefix(srv.URL, "https://"),
		AuthToken:         "lsm_node_secret",
		NodeName:          "web-server-01",
		HeartbeatInterval: "50ms",
	}
	c := NewHeartbeatClient(cfg, "1.2.0")
	c.client = srv.Client()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go c.Run(ctx)

	// 前兩次 500 → backoff 重試 → 第 3 次起成功；不 panic
	waitFor(t, "retries after 500 (backoff)", 10*time.Second, func() bool { return count.Load() >= 3 })
}

// ============================================================
//  SYS-58: 心跳被拒 401 → 記錄錯誤並持續重試（決策 5 / 第二 Manager）
// ============================================================

func TestHeartbeatClient_UnauthorizedRetries(t *testing.T) {
	var count atomic.Int32
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		io.Copy(io.Discard, r.Body)
		count.Add(1)
		w.WriteHeader(http.StatusUnauthorized)
		w.Write([]byte(`{"error":"unauthorized"}`))
	}))
	t.Cleanup(srv.Close)

	cfg := &Config{
		ManagerAddr:       strings.TrimPrefix(srv.URL, "https://"),
		AuthToken:         "lsm_node_wrong", // token 不符（被第二個 Manager 環境誤配）
		NodeName:          "web-server-01",
		HeartbeatInterval: "50ms",
	}
	c := NewHeartbeatClient(cfg, "1.2.0")
	c.client = srv.Client()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go c.Run(ctx)

	// 401 被拒絕後持續重試（不 panic、不停止）
	waitFor(t, "retries after 401", 10*time.Second, func() bool { return count.Load() >= 3 })
}
