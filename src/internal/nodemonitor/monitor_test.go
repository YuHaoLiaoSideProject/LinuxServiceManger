package nodemonitor

import (
	"context"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"linux-service-manager/internal/agentproto"
	"linux-service-manager/internal/noderegistry"
)

// fakeClock provides a controllable time source for tests.
type fakeClock struct {
	mu  sync.Mutex
	now time.Time
}

func newFakeClock(t time.Time) *fakeClock {
	return &fakeClock{now: t}
}

func (c *fakeClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.now
}

func (c *fakeClock) Advance(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.now = c.now.Add(d)
}

// helper: create a test registry with a single node.
func setupTestRegistry(t *testing.T, nodeName string) (*noderegistry.Registry, *noderegistry.Node) {
	t.Helper()
	reg, err := noderegistry.LoadRegistry(filepath.Join(t.TempDir(), "nodes.json"))
	if err != nil {
		t.Fatalf("failed to create registry: %v", err)
	}
	node, err := reg.Add(noderegistry.AddRequest{
		Name:    nodeName,
		Address: "192.168.1.100:8443",
	})
	if err != nil {
		t.Fatalf("failed to add node: %v", err)
	}
	return reg, node
}

// helper: collect published events.
func eventCollector() (func(StatusEvent), *[]StatusEvent) {
	events := &[]StatusEvent{}
	mu := &sync.Mutex{}
	publish := func(e StatusEvent) {
		mu.Lock()
		defer mu.Unlock()
		*events = append(*events, e)
	}
	return publish, events
}

func TestRun_GracePeriod(t *testing.T) {
	reg, node := setupTestRegistry(t, "node-1")

	clk := newFakeClock(time.Now())
	publish, events := eventCollector()

	cfg := Config{
		OfflineThreshold:     10 * time.Second,
		StartupGrace:         60 * time.Second,
		ScanTick:             1 * time.Second,
		LongOfflineThreshold: 300 * time.Second,
		Now:                  clk.Now,
	}

	mon := New(reg, publish, cfg)

	// Put node in online state with an old heartbeat (before grace period starts)
	reg.SetRuntimeStatus(node.ID, StatusOnline)
	// Apply heartbeat 2 minutes ago (older than OfflineThreshold)
	reg.ApplyHeartbeat(node.ID, noderegistry.HeartbeatStats{Total: 5, Running: 3}, clk.Now().Add(-2*time.Minute))

	// Advance time past OfflineThreshold but still within grace period
	clk.Advance(20 * time.Second)

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	go mon.Run(ctx)
	<-ctx.Done()

	// During grace period, no events should be published even though heartbeat is old
	if len(*events) != 0 {
		t.Errorf("expected 0 events during grace period, got %d", len(*events))
	}
}

func TestRun_OfflineDetection(t *testing.T) {
	reg, node := setupTestRegistry(t, "node-1")

	clk := newFakeClock(time.Now())
	publish, events := eventCollector()

	cfg := Config{
		OfflineThreshold:     30 * time.Second,
		StartupGrace:         0, // New() defaults this to 30s
		ScanTick:             1 * time.Second,
		LongOfflineThreshold: 300 * time.Second,
		Now:                  clk.Now,
	}

	mon := New(reg, publish, cfg)

	// Node is online, heartbeat was 40s ago (stale)
	reg.SetRuntimeStatus(node.ID, StatusOnline)
	n, _ := reg.Get(node.ID)
	n.LastHeartbeat = clk.Now().Add(-40 * time.Second)

	// Advance past startup grace period (default 30s) and offline threshold
	clk.Advance(35 * time.Second)

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	go mon.Run(ctx)
	<-ctx.Done()

	// Should have exactly 1 offline event
	found := false
	for _, e := range *events {
		if e.Status == StatusOffline && e.NodeID == node.ID {
			found = true
		}
	}
	if !found {
		t.Errorf("expected offline event, got %d events: %+v", len(*events), *events)
	}
}

func TestRun_LongOfflineDetection(t *testing.T) {
	reg, node := setupTestRegistry(t, "node-1")

	clk := newFakeClock(time.Now())
	publish, events := eventCollector()

	cfg := Config{
		OfflineThreshold:     30 * time.Second,
		StartupGrace:         0, // New() defaults this to 30s
		ScanTick:             1 * time.Second,
		LongOfflineThreshold: 60 * time.Second,
		Now:                  clk.Now,
	}

	mon := New(reg, publish, cfg)

	// Node is offline, OfflineSince 70 seconds ago (past LongOfflineThreshold)
	reg.SetRuntimeStatus(node.ID, StatusOffline)
	n, ok := reg.Get(node.ID)
	if !ok {
		t.Fatal("node not found")
	}
	n.OfflineSince = clk.Now().Add(-70 * time.Second)

	// Advance past startup grace period (default 30s)
	clk.Advance(35 * time.Second)

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	go mon.Run(ctx)
	<-ctx.Done()

	found := false
	for _, e := range *events {
		if e.Status == StatusLongOffline && e.NodeID == node.ID {
			found = true
		}
	}
	if !found {
		t.Errorf("expected long_offline event, got %d events: %+v", len(*events), *events)
	}
}

func TestRun_NoDuplicateEvent(t *testing.T) {
	reg, node := setupTestRegistry(t, "node-1")

	clk := newFakeClock(time.Now())
	publish, events := eventCollector()

	cfg := Config{
		OfflineThreshold:     30 * time.Second,
		StartupGrace:         0, // New() defaults this to 30s
		ScanTick:             1 * time.Second,
		LongOfflineThreshold: 300 * time.Second,
		Now:                  clk.Now,
	}

	mon := New(reg, publish, cfg)

	// Node is online with a stale heartbeat
	reg.SetRuntimeStatus(node.ID, StatusOnline)
	n, _ := reg.Get(node.ID)
	n.LastHeartbeat = clk.Now().Add(-40 * time.Second)

	// Advance past startup grace period (default 30s) and offline threshold
	clk.Advance(35 * time.Second)

	// Run 2 tick cycles
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	go mon.Run(ctx)

	// Wait for enough time for 2+ ticks
	time.Sleep(3 * time.Second)
	cancel()

	// Should only have 1 offline event (no duplicate)
	offlineCount := 0
	for _, e := range *events {
		if e.Status == StatusOffline && e.NodeID == node.ID {
			offlineCount++
		}
	}
	if offlineCount != 1 {
		t.Errorf("expected exactly 1 offline event (no duplicate), got %d", offlineCount)
	}
}

func TestOnHeartbeat_Recovery(t *testing.T) {
	reg, node := setupTestRegistry(t, "node-1")

	clk := newFakeClock(time.Now())
	publish, events := eventCollector()

	cfg := Config{Now: clk.Now}
	mon := New(reg, publish, cfg)

	// Start in offline state
	reg.SetRuntimeStatus(node.ID, StatusOffline)

	// OnHeartbeat should recover to online and publish event
	mon.OnHeartbeat(node.ID, noderegistry.HeartbeatStats{Total: 5, Running: 3})

	found := false
	for _, e := range *events {
		if e.Status == StatusOnline && e.NodeID == node.ID {
			found = true
		}
	}
	if !found {
		t.Errorf("expected online recovery event, got %+v", *events)
	}
}

func TestOnHeartbeat_StatsUpdated(t *testing.T) {
	reg, node := setupTestRegistry(t, "node-1")

	clk := newFakeClock(time.Now())
	publish, _ := eventCollector()

	cfg := Config{Now: clk.Now}
	mon := New(reg, publish, cfg)

	stats := noderegistry.HeartbeatStats{Total: 10, Running: 8, Failed: 2, CPU: 45.5, Memory: 67.2}
	mon.OnHeartbeat(node.ID, stats)

	got, ok := reg.Get(node.ID)
	if !ok {
		t.Fatal("node not found")
	}

	if got.HeartbeatStats.Total != stats.Total {
		t.Errorf("Total: got %d, want %d", got.HeartbeatStats.Total, stats.Total)
	}
	if got.HeartbeatStats.Running != stats.Running {
		t.Errorf("Running: got %d, want %d", got.HeartbeatStats.Running, stats.Running)
	}
	if got.HeartbeatStats.Failed != stats.Failed {
		t.Errorf("Failed: got %d, want %d", got.HeartbeatStats.Failed, stats.Failed)
	}
	if got.HeartbeatStats.CPU != stats.CPU {
		t.Errorf("CPU: got %f, want %f", got.HeartbeatStats.CPU, stats.CPU)
	}
	if got.HeartbeatStats.Memory != stats.Memory {
		t.Errorf("Memory: got %f, want %f", got.HeartbeatStats.Memory, stats.Memory)
	}
}

func TestOnConnect_VersionWarning(t *testing.T) {
	reg, node := setupTestRegistry(t, "node-1")

	clk := newFakeClock(time.Now())
	publish, events := eventCollector()

	cfg := Config{Now: clk.Now}
	mon := New(reg, publish, cfg)

	payload := agentproto.RegisterPayload{
		NodeName: "test-node",
		Hostname: "host-1",
		Version:  "1.0.0",
		OS:       "linux",
	}

	// Connect with minVersion higher than agent version → warning
	mon.OnConnect(node.ID, payload, "2.0.0")

	got, ok := reg.Get(node.ID)
	if !ok {
		t.Fatal("node not found")
	}

	// Check version compat is false
	if got.VersionCompat {
		t.Error("expected VersionCompat to be false")
	}
	if got.VersionMessage != "Agent version outdated" {
		t.Errorf("expected VersionMessage 'Agent version outdated', got %q", got.VersionMessage)
	}
	if got.Hostname != "host-1" {
		t.Errorf("Hostname: got %q, want %q", got.Hostname, "host-1")
	}

	// Check event is warning
	found := false
	for _, e := range *events {
		if e.Status == StatusWarning && e.NodeID == node.ID {
			found = true
		}
	}
	if !found {
		t.Errorf("expected warning status event, got %+v", *events)
	}
}

func TestOnConnect_VersionCompatible(t *testing.T) {
	reg, node := setupTestRegistry(t, "node-1")

	clk := newFakeClock(time.Now())
	publish, events := eventCollector()

	cfg := Config{Now: clk.Now}
	mon := New(reg, publish, cfg)

	payload := agentproto.RegisterPayload{
		NodeName: "test-node",
		Hostname: "host-1",
		Version:  "2.0.0",
		OS:       "linux",
	}

	// Connect with compatible version
	mon.OnConnect(node.ID, payload, "1.0.0")

	got, ok := reg.Get(node.ID)
	if !ok {
		t.Fatal("node not found")
	}

	if !got.VersionCompat {
		t.Error("expected VersionCompat to be true")
	}
	if got.VersionMessage != "" {
		t.Errorf("expected empty VersionMessage, got %q", got.VersionMessage)
	}

	found := false
	for _, e := range *events {
		if e.Status == StatusOnline && e.NodeID == node.ID {
			found = true
		}
	}
	if !found {
		t.Errorf("expected online status event, got %+v", *events)
	}
}

func TestOnDisconnect_GoesOffline(t *testing.T) {
	reg, node := setupTestRegistry(t, "node-1")

	clk := newFakeClock(time.Now())
	publish, events := eventCollector()

	cfg := Config{Now: clk.Now}
	mon := New(reg, publish, cfg)

	// Start as online
	reg.SetRuntimeStatus(node.ID, StatusOnline)

	mon.OnDisconnect(node.ID)

	got, ok := reg.Get(node.ID)
	if !ok {
		t.Fatal("node not found")
	}

	if got.Status != StatusOffline {
		t.Errorf("expected status %q, got %q", StatusOffline, got.Status)
	}
	if got.OfflineSince.IsZero() {
		t.Error("expected OfflineSince to be set")
	}

	found := false
	for _, e := range *events {
		if e.Status == StatusOffline && e.NodeID == node.ID {
			found = true
		}
	}
	if !found {
		t.Errorf("expected offline event, got %+v", *events)
	}
}

func TestOnHeartbeat_AlreadyOnline_NoEvent(t *testing.T) {
	reg, node := setupTestRegistry(t, "node-1")

	clk := newFakeClock(time.Now())
	publish, events := eventCollector()

	cfg := Config{Now: clk.Now}
	mon := New(reg, publish, cfg)

	// Start as online
	reg.SetRuntimeStatus(node.ID, StatusOnline)
	reg.ApplyHeartbeat(node.ID, noderegistry.HeartbeatStats{Total: 5, Running: 3}, clk.Now())

	// Heartbeat on already-online node should NOT publish event
	mon.OnHeartbeat(node.ID, noderegistry.HeartbeatStats{Total: 5, Running: 4})

	if len(*events) != 0 {
		t.Errorf("expected no events for already-online node, got %d: %+v", len(*events), *events)
	}
}

func TestRun_StartupGraceNoEvents(t *testing.T) {
	reg, node := setupTestRegistry(t, "node-1")

	clk := newFakeClock(time.Now())
	publish, events := eventCollector()

	cfg := Config{
		OfflineThreshold:     10 * time.Second,
		StartupGrace:         30 * time.Second,
		ScanTick:             1 * time.Second,
		LongOfflineThreshold: 300 * time.Second,
		Now:                  clk.Now,
	}

	mon := New(reg, publish, cfg)

	// Node is online with heartbeat 20s ago (older than OfflineThreshold)
	reg.SetRuntimeStatus(node.ID, StatusOnline)
	n, _ := reg.Get(node.ID)
	n.LastHeartbeat = clk.Now().Add(-20 * time.Second)

	// Advance 15s — still within 30s default startup grace from started
	clk.Advance(15 * time.Second)

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	go mon.Run(ctx)
	<-ctx.Done()

	if len(*events) != 0 {
		t.Errorf("expected 0 events during grace, got %d: %+v", len(*events), *events)
	}
}
