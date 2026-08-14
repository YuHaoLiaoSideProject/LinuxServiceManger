package nodes

import (
	"encoding/json"
	"testing"
	"time"

	"linux-service-manager/internal/websocket"
)

// ============================================================
//  Helpers
// ============================================================

func newSupervisor(t *testing.T, reg *Registry) (*Supervisor, *websocket.Hub) {
	t.Helper()
	hub := websocket.NewHub()
	return NewSupervisor(reg, hub), hub
}

// drainHub 讀取一條待送出的廣播訊息；無訊息回 nil。
func drainHub(t *testing.T, hub *websocket.Hub) *websocket.Message {
	t.Helper()
	select {
	case data := <-hub.Broadcast:
		var m websocket.Message
		if err := json.Unmarshal(data, &m); err != nil {
			t.Fatalf("unmarshal broadcast: %v", err)
		}
		return &m
	default:
		return nil
	}
}

// staleNode 將節點的最後心跳設定為距今 dur（模擬漏拍）。
func staleNode(t *testing.T, reg *Registry, id string, dur time.Duration) {
	t.Helper()
	reg.mu.Lock()
	defer reg.mu.Unlock()
	if n, ok := reg.nodes[id]; ok {
		n.LastHeartbeat = time.Now().Add(-dur).Format(time.RFC3339)
	}
}

// ============================================================
//  SYS-20~24: deriveStatus 純函式時間邊界（10s/30s/300s）
// ============================================================

func TestDeriveStatus_TimeBoundaries(t *testing.T) {
	now := time.Now().UTC()

	cases := []struct {
		name string
		age  time.Duration // 0 = 無心跳
		want Status
	}{
		{"fresh heartbeat 5s → online", 5 * time.Second, StatusOnline},
		{"boundary exactly 10s → degraded", 10 * time.Second, StatusDegraded},
		{"heartbeat 15s → degraded", 15 * time.Second, StatusDegraded},
		{"boundary exactly 30s → offline", 30 * time.Second, StatusOffline},
		{"heartbeat 60s → offline", 60 * time.Second, StatusOffline},
		{"boundary exactly 300s → long_offline", 300 * time.Second, StatusLongOffline},
		{"heartbeat 310s → long_offline", 310 * time.Second, StatusLongOffline},
		{"no heartbeat → offline", 0, StatusOffline},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			lastHB := ""
			if tc.age > 0 {
				lastHB = now.Add(-tc.age).Format(time.RFC3339)
			}
			got := deriveStatus("", lastHB, now, now, "")
			if got != tc.want {
				t.Errorf("deriveStatus: got %q, want %q", got, tc.want)
			}
		})
	}
}

// ============================================================
//  SYS-25: 版本不相容優先 → warning（🟡 優先於 online，不阻斷）
// ============================================================

func TestDeriveStatus_VersionWarning(t *testing.T) {
	now := time.Now().UTC()

	// 心跳正常 + 舊版本 → warning
	fresh := now.Add(-5 * time.Second).Format(time.RFC3339)
	if got := deriveStatus("", fresh, now, now, "1.0.0"); got != StatusWarning {
		t.Errorf("old version + fresh heartbeat: got %q, want warning", got)
	}

	// 版本警告優先：即使心跳已逾時亦回 warning（不阻斷心跳與操作）
	stale := now.Add(-10 * time.Minute).Format(time.RFC3339)
	if got := deriveStatus("", stale, now, now, "0.9.0"); got != StatusWarning {
		t.Errorf("old version + stale heartbeat: got %q, want warning (priority)", got)
	}

	// AgentMinVersion 本身不相容
	if got := deriveStatus("", fresh, now, now, AgentMinVersion); got == StatusWarning {
		t.Errorf("version equal to AgentMinVersion must NOT be warning, got %q", got)
	}
}

// ============================================================
//  SYS-26: 版本相符不影響正常判定
// ============================================================

func TestDeriveStatus_VersionCompatible(t *testing.T) {
	now := time.Now().UTC()
	lastHB := now.Add(-5 * time.Second).Format(time.RFC3339)

	if got := deriveStatus("", lastHB, now, now, "1.2.0"); got != StatusOnline {
		t.Errorf("version 1.2.0: got %q, want online", got)
	}
	// 語意化版本數字比較（非字串比較）：1.10.0 > 1.2.0
	if got := deriveStatus("", lastHB, now, now, "1.10.0"); got != StatusOnline {
		t.Errorf("version 1.10.0 should be compatible: got %q, want online", got)
	}
}

// ============================================================
//  SYS-27: 寬限期內恢復心跳 → online（自動恢復，推播 node_online）
// ============================================================

func TestSupervisorRecoverToOnline(t *testing.T) {
	reg := newTestRegistry(t)
	c, err := reg.Create(&Node{Name: "web-server-01", Address: "10.0.0.5:8443"})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	reg.SetStatus(c.ID, StatusOffline)
	s, hub := newSupervisor(t, reg)
	s.bootTime = time.Now().Add(-time.Minute) // 寬限期已過

	// 離線 60s（<300s 寬限期）後收到新心跳
	staleNode(t, reg, c.ID, 60*time.Second)
	reg.SetHeartbeat("web-server-01", Heartbeat{NodeName: "web-server-01", Services: ServiceStats{Total: 3, Active: 3}})

	s.tick()

	if got := reg.Get(c.ID).Status; got != StatusOnline {
		t.Errorf("expected online after heartbeat recovery, got %q", got)
	}
	msg := drainHub(t, hub)
	if msg == nil {
		t.Fatal("expected node_online broadcast on recovery")
	}
	if msg.Type != "node_online" {
		t.Errorf("expected type node_online, got %q", msg.Type)
	}
	if msg.ID != c.ID || msg.Name != "web-server-01" {
		t.Errorf("broadcast identity mismatch: %+v", msg)
	}
}

// ============================================================
//  SYS-28: 啟動寬限期內不推播離線（狀態照算，不廣播 node_offline）
// ============================================================

func TestSupervisorGracePeriod_NoOfflineBroadcast(t *testing.T) {
	reg := newTestRegistry(t)
	c, err := reg.Create(&Node{Name: "web-server-01", Address: "10.0.0.5:8443"})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	reg.SetStatus(c.ID, StatusOnline)
	s, hub := newSupervisor(t, reg)
	s.bootTime = time.Now() // 寬限期啟動：now < bootTime+30s

	staleNode(t, reg, c.ID, 10*time.Minute)
	s.tick()

	if got := reg.Get(c.ID).Status; got != StatusOffline {
		t.Errorf("status should still be computed as offline, got %q", got)
	}
	if msg := drainHub(t, hub); msg != nil {
		t.Errorf("expected NO broadcast during startup grace period, got %+v", msg)
	}
}

// ============================================================
//  SYS-29: 超過啟動寬限期正常推播 node_offline（含節點資訊）
// ============================================================

func TestSupervisorAfterGracePeriod_BroadcastOffline(t *testing.T) {
	reg := newTestRegistry(t)
	c, err := reg.Create(&Node{Name: "web-server-01", Address: "10.0.0.5:8443"})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	reg.SetStatus(c.ID, StatusOnline)
	s, hub := newSupervisor(t, reg)
	s.bootTime = time.Now().Add(-31 * time.Second) // 寬限期已過

	staleNode(t, reg, c.ID, 10*time.Minute)
	s.tick()

	msg := drainHub(t, hub)
	if msg == nil {
		t.Fatal("expected node_offline broadcast")
	}
	if msg.Type != "node_offline" {
		t.Errorf("expected type node_offline, got %q", msg.Type)
	}
	if msg.ID != c.ID || msg.Name != "web-server-01" {
		t.Errorf("broadcast identity mismatch: %+v", msg)
	}
	if msg.Active != string(StatusOffline) {
		t.Errorf("expected active offline, got %q", msg.Active)
	}
	if msg.LastHeartbeat == "" {
		t.Error("node_offline should carry last_heartbeat")
	}
}

// ============================================================
//  SYS-30: 狀態未變不廣播（防通知風暴）
// ============================================================

func TestSupervisorNoChange_NoBroadcast(t *testing.T) {
	reg := newTestRegistry(t)
	c, err := reg.Create(&Node{Name: "web-server-01", Address: "10.0.0.5:8443"})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	reg.SetStatus(c.ID, StatusOnline)
	s, hub := newSupervisor(t, reg)
	s.bootTime = time.Now().Add(-time.Minute)

	reg.SetHeartbeat("web-server-01", Heartbeat{NodeName: "web-server-01"}) // 新鮮心跳
	s.tick()

	if got := reg.Get(c.ID).Status; got != StatusOnline {
		t.Errorf("expected online, got %q", got)
	}
	if msg := drainHub(t, hub); msg != nil {
		t.Errorf("expected no broadcast when status unchanged, got %+v", msg)
	}
}

// ============================================================
//  SYS-31: tick 批次掃描所有節點，僅狀態變更的節點被處理
// ============================================================

func TestSupervisorTickBatch(t *testing.T) {
	reg := newTestRegistry(t)
	a, err := reg.Create(&Node{Name: "node-a", Address: "10.0.0.1:8443"})
	if err != nil {
		t.Fatalf("create a: %v", err)
	}
	b, err := reg.Create(&Node{Name: "node-b", Address: "10.0.0.2:8443"})
	if err != nil {
		t.Fatalf("create b: %v", err)
	}
	c, err := reg.Create(&Node{Name: "node-c", Address: "10.0.0.3:8443"})
	if err != nil {
		t.Fatalf("create c: %v", err)
	}
	reg.SetStatus(a.ID, StatusOnline)
	reg.SetStatus(b.ID, StatusOnline)
	reg.SetStatus(c.ID, StatusOffline)
	s, hub := newSupervisor(t, reg)
	s.bootTime = time.Now().Add(-time.Minute)

	// a：新鮮心跳 → 維持 online（無變更）
	reg.SetHeartbeat("node-a", Heartbeat{NodeName: "node-a"})
	// b：漏拍 → offline（變更，推播）
	staleNode(t, reg, b.ID, 10*time.Minute)
	// c：無心跳但已是 offline → 無變更

	s.tick()

	if got := reg.Get(a.ID).Status; got != StatusOnline {
		t.Errorf("node-a: expected online, got %q", got)
	}
	if got := reg.Get(b.ID).Status; got != StatusOffline {
		t.Errorf("node-b: expected offline, got %q", got)
	}
	if got := reg.Get(c.ID).Status; got != StatusOffline {
		t.Errorf("node-c: expected offline, got %q", got)
	}

	// 僅 b 的變更被推播
	msg := drainHub(t, hub)
	if msg == nil || msg.ID != b.ID || msg.Type != "node_offline" {
		t.Errorf("expected single node_offline broadcast for node-b, got %+v", msg)
	}
	if extra := drainHub(t, hub); extra != nil {
		t.Errorf("expected no further broadcasts, got %+v", extra)
	}
}

// ============================================================
//  SYS-32: 推播 message type 正確（node_online / node_offline / node_status / node_removed）
// ============================================================

func TestSupervisorBroadcastTypes(t *testing.T) {
	reg := newTestRegistry(t)
	s, hub := newSupervisor(t, reg)
	s.bootTime = time.Now().Add(-time.Minute)
	now := time.Now()

	t.Run("online → offline 推播 node_offline", func(t *testing.T) {
		n := &Node{ID: "n1", Name: "web-01", Status: StatusOnline, LastHeartbeat: now.Add(-60 * time.Second).Format(time.RFC3339)}
		s.broadcast(n, StatusOffline, now)
		msg := drainHub(t, hub)
		if msg == nil || msg.Type != "node_offline" {
			t.Errorf("expected node_offline, got %+v", msg)
		}
	})

	t.Run("offline → online 推播 node_online", func(t *testing.T) {
		n := &Node{ID: "n1", Name: "web-01", Status: StatusOffline, LastHeartbeat: now.Format(time.RFC3339)}
		s.broadcast(n, StatusOnline, now)
		msg := drainHub(t, hub)
		if msg == nil || msg.Type != "node_online" {
			t.Errorf("expected node_online, got %+v", msg)
		}
	})

	t.Run("狀態變更（版本警告）推播 node_status", func(t *testing.T) {
		n := &Node{ID: "n1", Name: "web-01", Status: StatusOnline, LastHeartbeat: now.Format(time.RFC3339)}
		s.broadcast(n, StatusWarning, now)
		msg := drainHub(t, hub)
		if msg == nil || msg.Type != "node_status" {
			t.Errorf("expected node_status, got %+v", msg)
		}
		if msg.AgentVersion == "" && msg.LastHeartbeat == "" {
			t.Log("note: node_status should carry heartbeat info (last_heartbeat/agent_version)")
		}
	})

	t.Run("節點移除 message 形狀 node_removed", func(t *testing.T) {
		// node_removed 由移除流程（delete handler）經 hub 廣播；此處驗證訊息形狀可送達
		hub.BroadcastMessage(websocket.Message{Type: "node_removed", ID: "n1", Name: "web-01"})
		msg := drainHub(t, hub)
		if msg == nil || msg.Type != "node_removed" {
			t.Errorf("expected node_removed, got %+v", msg)
		}
		if msg.ID != "n1" || msg.Name != "web-01" {
			t.Errorf("node_removed identity mismatch: %+v", msg)
		}
	})
}

// ============================================================
//  SYS-33: OnNodeStateChange 回呼欄位存在（P2 webhook 擴充點，本階段 nil）
// ============================================================

func TestSupervisorOnNodeStateChange(t *testing.T) {
	reg := newTestRegistry(t)
	s, _ := newSupervisor(t, reg)

	if s.OnNodeStateChange != nil {
		t.Error("OnNodeStateChange must be nil by default (P2 extension point, not wired this phase)")
	}

	// 欄位型別可指派（編譯期合約：func(nodeID string, state Status)）
	called := false
	s.OnNodeStateChange = func(nodeID string, state Status) {
		called = true
		if nodeID != "n1" || state != StatusOffline {
			t.Errorf("unexpected callback args: %s %q", nodeID, state)
		}
	}
	s.OnNodeStateChange("n1", StatusOffline)
	if !called {
		t.Error("assigned callback was not invoked")
	}
}
