package nodeproxy

import (
	"context"
	"errors"
	"path/filepath"
	"testing"
	"time"

	"linux-service-manager/internal/agentproto"
	"linux-service-manager/internal/noderegistry"
)

// isTimeoutError returns true if err is ErrTimeout or context deadline exceeded.
func isTimeoutError(err error) bool {
	return errors.Is(err, ErrTimeout) || errors.Is(err, context.DeadlineExceeded)
}

// setupTestRegistry creates a temp registry with a test node.
func setupTestRegistry(t *testing.T) (*noderegistry.Registry, *noderegistry.Node) {
	t.Helper()
	tmpDir := t.TempDir()
	regPath := filepath.Join(tmpDir, "nodes.json")
	reg, err := noderegistry.LoadRegistry(regPath)
	if err != nil {
		t.Fatalf("load registry: %v", err)
	}
	node, err := reg.Add(noderegistry.AddRequest{
		Name:    "test-node",
		Address: "127.0.0.1:9999",
		Token:   "test-token-123",
	})
	if err != nil {
		t.Fatalf("add node: %v", err)
	}
	return reg, node
}

// registerFakeConn adds a fake agentConn to the hub for testing.
// The conn field is nil — these tests only exercise the hub's map logic,
// not real WebSocket I/O.
func registerFakeConn(h *Hub, nodeID string) *agentConn {
	ctx, cancel := context.WithCancel(context.Background())
	ac := &agentConn{
		nodeID: nodeID,
		conn:   nil,
		send:   make(chan []byte, 256),
		cancel: cancel,
	}

	h.mu.Lock()
	h.conns[nodeID] = ac
	h.mu.Unlock()

	// Clean up context on test end
	go func() {
		<-ctx.Done()
	}()
	_ = ctx // suppress unused warning

	return ac
}

func TestHub_SendOffline(t *testing.T) {
	hub := NewHub()

	err := hub.Send("nonexistent-node", agentproto.Envelope{
		Type:   agentproto.TypeHeartbeat,
		Method: "test",
	})
	if err != ErrNodeOffline {
		t.Errorf("expected ErrNodeOffline, got %v", err)
	}
}

func TestHub_CleanupOnDisconnect(t *testing.T) {
	reg, node := setupTestRegistry(t)
	hub := NewHub()
	hub.Registry = reg

	disconnected := make(chan string, 1)
	hub.OnDisconnect = func(nodeID string) {
		disconnected <- nodeID
	}

	// Register a fake connection
	registerFakeConn(hub, node.ID)

	// Create a pending request
	pendingCh := make(chan agentproto.Envelope, 1)
	hub.pendingMu.Lock()
	hub.pending["test-request-1"] = pendingCh
	hub.pendingMu.Unlock()

	// Verify pending exists
	hub.pendingMu.Lock()
	if _, ok := hub.pending["test-request-1"]; !ok {
		hub.pendingMu.Unlock()
		t.Fatal("pending request should exist before cleanup")
	}
	hub.pendingMu.Unlock()

	// Trigger cleanup
	hub.cleanup(node.ID)

	// Verify pending channel was closed
	select {
	case _, ok := <-pendingCh:
		if ok {
			t.Error("expected pending channel to be closed")
		}
	case <-time.After(100 * time.Millisecond):
		t.Error("timed out waiting for channel close")
	}

	// Verify node is no longer in conns
	hub.mu.RLock()
	_, exists := hub.conns[node.ID]
	hub.mu.RUnlock()
	if exists {
		t.Error("node should be removed from conns after cleanup")
	}

	// Verify OnDisconnect was called
	select {
	case nodeID := <-disconnected:
		if nodeID != node.ID {
			t.Errorf("expected disconnect for %s, got %s", node.ID, nodeID)
		}
	case <-time.After(100 * time.Millisecond):
		t.Error("timed out waiting for OnDisconnect callback")
	}
}

func TestHub_CallTimeout(t *testing.T) {
	reg, node := setupTestRegistry(t)
	hub := NewHub()
	hub.Registry = reg

	// Register a fake connection that won't respond
	registerFakeConn(hub, node.ID)

	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()

	err := hub.Call(ctx, node.ID, agentproto.MethodListServices, nil, nil, 20*time.Millisecond)
	if err != ErrTimeout {
		t.Errorf("expected ErrTimeout, got %v", err)
	}
}

func TestHub_Singleflight(t *testing.T) {
	reg, node := setupTestRegistry(t)
	hub := NewHub()
	hub.Registry = reg

	// Register a fake connection that won't respond
	registerFakeConn(hub, node.ID)

	// Start a long-running call
	ctx1, cancel1 := context.WithCancel(context.Background())
	defer cancel1()

	errCh := make(chan error, 1)
	go func() {
		errCh <- hub.Call(ctx1, node.ID, agentproto.MethodListServices, nil, nil, 5*time.Second)
	}()

	// Wait for the inflight key to be registered
	time.Sleep(10 * time.Millisecond)

	// Second call with same params should return ErrInProgress
	ctx2, cancel2 := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel2()

	err := hub.Call(ctx2, node.ID, agentproto.MethodListServices, nil, nil, 100*time.Millisecond)
	if err != ErrInProgress {
		t.Errorf("expected ErrInProgress, got %v", err)
	}

	// Cancel the first call
	cancel1()
	<-errCh
}

func TestHub_CallAction_Convenience(t *testing.T) {
	reg, node := setupTestRegistry(t)
	hub := NewHub()
	hub.Registry = reg

	// Register a fake connection
	registerFakeConn(hub, node.ID)

	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()

	// CallAction should return timeout since no agent responds
	err := hub.CallAction(ctx, node.ID, agentproto.MethodStart, "nginx")
	if !isTimeoutError(err) {
		t.Errorf("expected timeout error, got %v", err)
	}
}

func TestHub_CallQuery_Convenience(t *testing.T) {
	reg, node := setupTestRegistry(t)
	hub := NewHub()
	hub.Registry = reg

	// Register a fake connection
	registerFakeConn(hub, node.ID)

	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()

	// CallQuery should return timeout since no agent responds
	var out map[string]any
	err := hub.CallQuery(ctx, node.ID, agentproto.MethodListServices, nil, &out)
	if !isTimeoutError(err) {
		t.Errorf("expected timeout error, got %v", err)
	}
}

func TestHub_NewHub_InitializesMaps(t *testing.T) {
	hub := NewHub()

	if hub.conns == nil {
		t.Error("conns map should be initialized")
	}
	if hub.pending == nil {
		t.Error("pending map should be initialized")
	}
	if hub.inflight == nil {
		t.Error("inflight map should be initialized")
	}
	if hub.upgrader.CheckOrigin == nil {
		t.Error("upgrader CheckOrigin should be set")
	}
	// CheckOrigin should return true for agent connections
	if !hub.upgrader.CheckOrigin(nil) {
		t.Error("CheckOrigin should return true")
	}
}

func TestHub_Connected(t *testing.T) {
	hub := NewHub()
	reg, node := setupTestRegistry(t)
	hub.Registry = reg

	// No connections initially
	connected := hub.Connected()
	if len(connected) != 0 {
		t.Errorf("expected 0 connected, got %d", len(connected))
	}

	// Add a fake connection
	registerFakeConn(hub, node.ID)

	connected = hub.Connected()
	if len(connected) != 1 {
		t.Errorf("expected 1 connected, got %d", len(connected))
	}
	if connected[0] != node.ID {
		t.Errorf("expected node ID %s, got %s", node.ID, connected[0])
	}
}
