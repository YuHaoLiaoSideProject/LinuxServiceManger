package noderegistry

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestLoadRegistry_FileNotExists(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "nodes.json")

	r, err := LoadRegistry(path)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if r == nil {
		t.Fatal("expected non-nil registry")
	}
	if r.Count() != 0 {
		t.Errorf("expected empty registry, got %d nodes", r.Count())
	}
}

func TestLoadRegistry_ValidJSON(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "nodes.json")

	nodes := []*Node{
		{ID: "node-1", Name: "test-node-1", Address: "192.168.1.1:5000", Token: "token1"},
		{ID: "node-2", Name: "test-node-2", Address: "192.168.1.2:5000", Token: "token2"},
	}
	data, _ := json.MarshalIndent(nodes, "", "  ")
	os.WriteFile(path, data, 0600)

	r, err := LoadRegistry(path)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if r.Count() != 2 {
		t.Errorf("expected 2 nodes, got %d", r.Count())
	}

	n, ok := r.Get("node-1")
	if !ok || n == nil {
		t.Fatal("expected to find node-1")
	}
	if n.Name != "test-node-1" {
		t.Errorf("expected name 'test-node-1', got '%s'", n.Name)
	}
}

func TestLoadRegistry_InvalidJSON(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "nodes.json")

	os.WriteFile(path, []byte("not valid json {{{"), 0600)

	_, err := LoadRegistry(path)
	if err != ErrInvalidJSON {
		t.Errorf("expected ErrInvalidJSON, got %v", err)
	}
}

func TestAdd_Success(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "nodes.json")

	r, _ := LoadRegistry(path)

	node, err := r.Add(AddRequest{
		Name:    "web-server-1",
		Address: "10.0.0.1:5000",
		Token:   "abc123",
		Note:    "Production web server",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if node.ID == "" {
		t.Error("expected non-empty ID")
	}
	if node.Name != "web-server-1" {
		t.Errorf("expected name 'web-server-1', got '%s'", node.Name)
	}
	if r.Count() != 1 {
		t.Errorf("expected 1 node, got %d", r.Count())
	}

	// Verify persisted
	r2, _ := LoadRegistry(path)
	if r2.Count() != 1 {
		t.Errorf("expected 1 node after reload, got %d", r2.Count())
	}
}

func TestAdd_DuplicateName(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "nodes.json")

	r, _ := LoadRegistry(path)

	r.Add(AddRequest{Name: "unique-name", Address: "10.0.0.1:5000", Token: "token1"})

	_, err := r.Add(AddRequest{Name: "unique-name", Address: "10.0.0.2:5000", Token: "token2"})
	if err != ErrDuplicateName {
		t.Errorf("expected ErrDuplicateName, got %v", err)
	}
}

func TestAdd_MaxNodes(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "nodes.json")

	r, _ := LoadRegistry(path)

	for i := 0; i < MaxNodes; i++ {
		_, err := r.Add(AddRequest{
			Name:    fmt.Sprintf("node-%d", i),
			Address: "10.0.0.1:5000",
			Token:   "token",
		})
		if err != nil {
			t.Fatalf("failed to add node %d: %v", i, err)
		}
	}

	_, err := r.Add(AddRequest{Name: "overflow", Address: "10.0.0.2:5000", Token: "token"})
	if err != ErrMaxNodes {
		t.Errorf("expected ErrMaxNodes, got %v", err)
	}
}

func TestUpdate_Success(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "nodes.json")

	r, _ := LoadRegistry(path)

	node, _ := r.Add(AddRequest{Name: "original", Address: "10.0.0.1:5000", Token: "token1"})

	newName := "updated"
	newAddr := "10.0.0.99:5000"
	updated, err := r.Update(node.ID, UpdateRequest{
		Name:    &newName,
		Address: &newAddr,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if updated.Name != "updated" {
		t.Errorf("expected name 'updated', got '%s'", updated.Name)
	}
	if updated.Address != "10.0.0.99:5000" {
		t.Errorf("expected address '10.0.0.99:5000', got '%s'", updated.Address)
	}
	if updated.Token != "token1" {
		t.Error("expected token to remain unchanged")
	}

	// Verify persisted
	r2, _ := LoadRegistry(path)
	n, ok := r2.Get(node.ID)
	if !ok {
		t.Fatal("node not found after reload")
	}
	if n.Name != "updated" {
		t.Errorf("expected persisted name 'updated', got '%s'", n.Name)
	}
}

func TestUpdate_NotFound(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "nodes.json")

	r, _ := LoadRegistry(path)

	newName := "test"
	_, err := r.Update("nonexistent-id", UpdateRequest{Name: &newName})
	if err != ErrNotFound {
		t.Errorf("expected ErrNotFound, got %v", err)
	}
}

func TestRemove_Success(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "nodes.json")

	r, _ := LoadRegistry(path)

	node, _ := r.Add(AddRequest{Name: "to-delete", Address: "10.0.0.1:5000", Token: "token"})

	err := r.Remove(node.ID)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if r.Count() != 0 {
		t.Errorf("expected 0 nodes, got %d", r.Count())
	}

	// Verify persisted
	r2, _ := LoadRegistry(path)
	if r2.Count() != 0 {
		t.Errorf("expected 0 nodes after reload, got %d", r2.Count())
	}
}

func TestRemove_NotFound(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "nodes.json")

	r, _ := LoadRegistry(path)

	err := r.Remove("nonexistent-id")
	if err != ErrNotFound {
		t.Errorf("expected ErrNotFound, got %v", err)
	}
}

func TestRuntimeStatus_NotPersisted(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "nodes.json")

	r, _ := LoadRegistry(path)

	node, _ := r.Add(AddRequest{Name: "runtime-test", Address: "10.0.0.1:5000", Token: "token"})

	r.SetRuntimeStatus(node.ID, "online")

	// Reload registry
	r2, _ := LoadRegistry(path)
	n, ok := r2.Get(node.ID)
	if !ok {
		t.Fatal("node not found after reload")
	}
	if n.Status != "" {
		t.Errorf("expected empty status after reload, got '%s'", n.Status)
	}
}

func TestApplyHeartbeat(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "nodes.json")

	r, _ := LoadRegistry(path)

	node, _ := r.Add(AddRequest{Name: "heartbeat-test", Address: "10.0.0.1:5000", Token: "token"})

	at := time.Now()
	stats := HeartbeatStats{
		Total:   100,
		Running: 90,
		Failed:  10,
		CPU:     45.5,
		Memory:  67.2,
	}

	r.ApplyHeartbeat(node.ID, stats, at)

	n, ok := r.Get(node.ID)
	if !ok {
		t.Fatal("node not found")
	}

	if n.Status != "online" {
		t.Errorf("expected status 'online', got '%s'", n.Status)
	}
	if n.LastHeartbeat != at {
		t.Errorf("expected LastHeartbeat to be %v, got %v", at, n.LastHeartbeat)
	}
	if n.OnlineSince != at {
		t.Errorf("expected OnlineSince to be %v, got %v", at, n.OnlineSince)
	}
	if n.HeartbeatStats.Total != 100 {
		t.Errorf("expected Total 100, got %d", n.HeartbeatStats.Total)
	}
	if n.HeartbeatStats.Running != 90 {
		t.Errorf("expected Running 90, got %d", n.HeartbeatStats.Running)
	}
	if n.HeartbeatStats.Failed != 10 {
		t.Errorf("expected Failed 10, got %d", n.HeartbeatStats.Failed)
	}
	if n.HeartbeatStats.CPU != 45.5 {
		t.Errorf("expected CPU 45.5, got %f", n.HeartbeatStats.CPU)
	}
	if n.HeartbeatStats.Memory != 67.2 {
		t.Errorf("expected Memory 67.2, got %f", n.HeartbeatStats.Memory)
	}

	// Apply heartbeat again with status already "online" - OnlineSince should not change
	time.Sleep(time.Millisecond)
	newAt := time.Now()
	r.ApplyHeartbeat(node.ID, stats, newAt)

	n2, _ := r.Get(node.ID)
	if n2.OnlineSince != at {
		t.Errorf("expected OnlineSince to remain %v, got %v", at, n2.OnlineSince)
	}
}

func TestAtomicWrite(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "nodes.json")

	r, _ := LoadRegistry(path)

	// Add a node and verify temp file is cleaned up
	r.Add(AddRequest{Name: "atomic-test", Address: "10.0.0.1:5000", Token: "token"})

	tmpPath := path + ".tmp"
	if _, err := os.Stat(tmpPath); !os.IsNotExist(err) {
		t.Error("temp file should not exist after persist")
	}

	// Verify main file exists
	if _, err := os.Stat(path); os.IsNotExist(err) {
		t.Error("main file should exist after persist")
	}
}
