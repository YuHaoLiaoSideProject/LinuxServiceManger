package nodes

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

// ============================================================
//  Helpers（仿 token_test.go newTestStore pattern）
// ============================================================

func newTestRegistry(t *testing.T) *Registry {
	t.Helper()
	dir := t.TempDir()
	r := NewRegistry(filepath.Join(dir, "nodes.json"))
	if err := r.Load(); err != nil {
		t.Fatalf("failed to load registry: %v", err)
	}
	return r
}

// ============================================================
//  SYS-01: Load 載入既有 nodes.json
// ============================================================

func TestRegistryLoad_WithData(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "nodes.json")
	payload := `{
  "n1": {
    "id": "n1", "name": "web-server-01", "address": "10.0.0.5:8443",
    "token": "lsm_node_abc", "status": "online",
    "last_heartbeat": "2025-08-13T10:00:00Z", "agent_version": "1.2.0",
    "hostname": "web-01", "os": "Ubuntu 22.04",
    "service_stats": {"total": 10, "active": 8, "failed": 1},
    "created_at": "2025-08-13T09:00:00Z", "updated_at": "2025-08-13T09:00:00Z"
  },
  "n2": {
    "id": "n2", "name": "db-server-01", "address": "10.0.0.6:8443",
    "token": "lsm_node_def", "status": "offline",
    "notes": "database",
    "service_stats": {"total": 5, "active": 3, "failed": 2},
    "created_at": "2025-08-13T09:00:00Z", "updated_at": "2025-08-13T09:00:00Z"
  }
}`
	if err := os.WriteFile(path, []byte(payload), 0600); err != nil {
		t.Fatalf("write nodes.json: %v", err)
	}

	r := NewRegistry(path)
	if err := r.Load(); err != nil {
		t.Fatalf("load: %v", err)
	}

	if got := r.Count(); got != 2 {
		t.Fatalf("expected 2 nodes, got %d", got)
	}

	n := r.Get("n1")
	if n == nil {
		t.Fatal("n1 not found")
	}
	if n.Name != "web-server-01" || n.Address != "10.0.0.5:8443" {
		t.Errorf("name/address mismatch: %+v", n)
	}
	if n.Status != StatusOnline {
		t.Errorf("expected status online, got %q", n.Status)
	}
	if n.LastHeartbeat != "2025-08-13T10:00:00Z" {
		t.Errorf("last_heartbeat mismatch: %q", n.LastHeartbeat)
	}
	if n.AgentVersion != "1.2.0" || n.Hostname != "web-01" || n.OS != "Ubuntu 22.04" {
		t.Errorf("heartbeat fields mismatch: %+v", n)
	}
	if n.ServiceStats != (ServiceStats{Total: 10, Active: 8, Failed: 1}) {
		t.Errorf("service_stats mismatch: %+v", n.ServiceStats)
	}

	// byName 必須在 Load 後重建 — 心跳比對（VerifyToken/SetHeartbeat）依賴 GetByName
	byName := r.GetByName("web-server-01")
	if byName == nil || byName.ID != "n1" {
		t.Errorf("GetByName after Load: got %+v, want node n1", byName)
	}
}

// ============================================================
//  SYS-02: Load 檔案不存在回傳空 registry（不 crash）
// ============================================================

func TestRegistryLoad_FileNotExist(t *testing.T) {
	dir := t.TempDir()
	r := NewRegistry(filepath.Join(dir, "missing", "nodes.json"))
	if err := r.Load(); err != nil {
		t.Fatalf("expected nil error for missing file, got: %v", err)
	}
	if r.Count() != 0 {
		t.Errorf("expected empty registry, got %d", r.Count())
	}
	// 後續 Create 可正常運作
	if _, err := r.Create(&Node{Name: "web-server-01", Address: "10.0.0.5:8443"}); err != nil {
		t.Fatalf("create after empty load failed: %v", err)
	}
}

// ============================================================
//  SYS-03: Save 為 atomic write（temp + rename，無 .tmp 殘留）
// ============================================================

func TestRegistrySave_Atomic(t *testing.T) {
	r := newTestRegistry(t)
	created, err := r.Create(&Node{Name: "web-server-01", Address: "10.0.0.5:8443"})
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	// 無 .tmp 殘留
	if _, err := os.Stat(r.filePath + ".tmp"); !os.IsNotExist(err) {
		t.Errorf("expected no .tmp residue, got err: %v", err)
	}

	// 檔案為合法 JSON（同刻讀取不會看到部分內容）
	data, err := os.ReadFile(r.filePath)
	if err != nil {
		t.Fatalf("read nodes.json: %v", err)
	}
	var m map[string]*Node
	if err := json.Unmarshal(data, &m); err != nil {
		t.Fatalf("nodes.json is not valid JSON: %v", err)
	}
	if len(m) != 1 {
		t.Errorf("expected 1 node persisted, got %d", len(m))
	}

	// 重新載入（新 registry）資料完整
	r2 := NewRegistry(r.filePath)
	if err := r2.Load(); err != nil {
		t.Fatalf("reload: %v", err)
	}
	if r2.Get(created.ID) == nil || r2.Get(created.ID).Name != "web-server-01" {
		t.Error("node not preserved after reload")
	}
}

// ============================================================
//  SYS-04: Create 新增節點（UUID / token / RFC3339 UTC 時間戳）
// ============================================================

func TestRegistryCreate_Success(t *testing.T) {
	r := newTestRegistry(t)
	created, err := r.Create(&Node{Name: "web-server-01", Address: "10.0.0.5:8443", TLSFingerprint: "aabb"})
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	if created.ID == "" {
		t.Error("expected generated UUID (crypto/rand)")
	}
	if !strings.HasPrefix(created.Token, "lsm_node_") {
		t.Errorf("expected token prefix lsm_node_, got %q", created.Token)
	}
	if len(created.Token) <= len("lsm_node_") {
		t.Errorf("expected long random token, got %q", created.Token)
	}
	for _, ts := range []string{created.CreatedAt, created.UpdatedAt} {
		tm, err := time.Parse(time.RFC3339, ts)
		if err != nil {
			t.Fatalf("timestamp %q is not RFC3339: %v", ts, err)
		}
		if tm.Location() != time.UTC {
			t.Errorf("timestamp %q should be UTC", ts)
		}
	}
	if created.Name != "web-server-01" || created.Address != "10.0.0.5:8443" || created.TLSFingerprint != "aabb" {
		t.Errorf("input fields not preserved: %+v", created)
	}

	// 已入 registry
	if r.Get(created.ID) == nil {
		t.Error("created node not in registry")
	}
}

// ============================================================
//  SYS-05: Create 名稱重複拒絕（handler 層 409）
// ============================================================

func TestRegistryCreate_DuplicateName(t *testing.T) {
	r := newTestRegistry(t)
	if _, err := r.Create(&Node{Name: "web-server-01", Address: "10.0.0.5:8443"}); err != nil {
		t.Fatalf("first create: %v", err)
	}

	_, err := r.Create(&Node{Name: "web-server-01", Address: "10.0.0.7:8443"})
	if !errors.Is(err, ErrDuplicateName) {
		t.Errorf("expected ErrDuplicateName, got %v", err)
	}
	if r.Count() != 1 {
		t.Errorf("registry should be unchanged, got %d nodes", r.Count())
	}
}

// ============================================================
//  SYS-06: Update 更新節點設定（token 留空表示不變更）
// ============================================================

func TestRegistryUpdate_TokenEmptyKeepsToken(t *testing.T) {
	r := newTestRegistry(t)
	created, err := r.Create(&Node{Name: "web-server-01", Address: "10.0.0.5:8443"})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	origToken := created.Token

	time.Sleep(5 * time.Millisecond) // 確保 updated_at 刷新可辨識
	updated, err := r.Update(created.ID, &Node{Address: "10.0.0.6:8443", Notes: "prod"})
	if err != nil {
		t.Fatalf("update: %v", err)
	}
	if updated.Address != "10.0.0.6:8443" || updated.Notes != "prod" {
		t.Errorf("address/notes not updated: %+v", updated)
	}
	if updated.Token != origToken {
		t.Errorf("token must be kept when patch token is empty (got %q, want %q)", updated.Token, origToken)
	}
	if updated.UpdatedAt == created.UpdatedAt {
		t.Error("updated_at should be refreshed")
	}

	// 持久化
	r2 := NewRegistry(r.filePath)
	if err := r2.Load(); err != nil {
		t.Fatalf("reload: %v", err)
	}
	got := r2.Get(created.ID)
	if got.Address != "10.0.0.6:8443" {
		t.Errorf("address not persisted: %q", got.Address)
	}
}

// ============================================================
//  SYS-07: Delete 移除節點（關聯 Audit 由 audit 模組獨立保留）
// ============================================================

func TestRegistryDelete(t *testing.T) {
	r := newTestRegistry(t)
	c1, err := r.Create(&Node{Name: "web-server-01", Address: "10.0.0.5:8443"})
	if err != nil {
		t.Fatalf("create 1: %v", err)
	}
	if _, err := r.Create(&Node{Name: "db-server-01", Address: "10.0.0.6:8443"}); err != nil {
		t.Fatalf("create 2: %v", err)
	}

	if err := r.Delete(c1.ID); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if r.Get(c1.ID) != nil {
		t.Error("node still present after delete")
	}
	if r.Count() != 1 {
		t.Errorf("expected 1 node remaining, got %d", r.Count())
	}
	// 名稱應可重用（byName 同步清理）
	if _, err := r.Create(&Node{Name: "web-server-01", Address: "10.0.0.9:8443"}); err != nil {
		t.Errorf("name should be reusable after delete: %v", err)
	}
}

// ============================================================
//  SYS-08: Get by ID 存在 / 不存在
// ============================================================

func TestRegistryGet(t *testing.T) {
	r := newTestRegistry(t)
	created, err := r.Create(&Node{Name: "web-server-01", Address: "10.0.0.5:8443"})
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	if got := r.Get(created.ID); got == nil || got.Name != "web-server-01" {
		t.Errorf("Get existing: got %+v", got)
	}
	if got := r.Get("nonexistent-id"); got != nil {
		t.Errorf("Get nonexistent: expected nil, got %+v", got)
	}
	if got := r.GetByName("nonexistent-name"); got != nil {
		t.Errorf("GetByName nonexistent: expected nil, got %+v", got)
	}
}

// ============================================================
//  SYS-09: SetHeartbeat 更新心跳資訊（Status 不在此處修改）
// ============================================================

func TestRegistrySetHeartbeat(t *testing.T) {
	r := newTestRegistry(t)
	created, err := r.Create(&Node{Name: "web-server-01", Address: "10.0.0.5:8443"})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	r.SetStatus(created.ID, StatusOffline) // 模擬已知狀態

	hb := Heartbeat{
		NodeName:      "web-server-01",
		AgentVersion:  "1.2.0",
		Hostname:      "web-01",
		OS:            "Ubuntu 22.04",
		UptimeSeconds: 3600,
		Services:      ServiceStats{Total: 10, Active: 8, Failed: 2},
		Timestamp:     time.Now().UTC().Format(time.RFC3339),
	}
	r.SetHeartbeat("web-server-01", hb)

	n := r.Get(created.ID)
	if n.LastHeartbeat == "" {
		t.Error("last_heartbeat not set")
	} else if _, err := time.Parse(time.RFC3339, n.LastHeartbeat); err != nil {
		t.Errorf("last_heartbeat not RFC3339 UTC: %v", err)
	}
	if n.ServiceStats != hb.Services {
		t.Errorf("service_stats mismatch: got %+v want %+v", n.ServiceStats, hb.Services)
	}
	if n.AgentVersion != "1.2.0" || n.Hostname != "web-01" || n.OS != "Ubuntu 22.04" {
		t.Errorf("heartbeat fields not updated: %+v", n)
	}
	if n.Status != StatusOffline {
		t.Errorf("SetHeartbeat must NOT modify status, got %q", n.Status)
	}
}

// ============================================================
//  SYS-10: VerifyToken 比對 node_name + Bearer token
// ============================================================

func TestRegistryVerifyToken(t *testing.T) {
	r := newTestRegistry(t)
	created, err := r.Create(&Node{Name: "web-server-01", Address: "10.0.0.5:8443"})
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	if !r.VerifyToken("web-server-01", created.Token) {
		t.Error("correct token should verify")
	}
	if r.VerifyToken("web-server-01", "wrong-token") {
		t.Error("wrong token should not verify")
	}
	if r.VerifyToken("ghost-node", created.Token) {
		t.Error("unknown node should not verify")
	}
	if r.VerifyToken("", created.Token) {
		t.Error("empty node name should not verify")
	}
}

// ============================================================
//  SYS-11/12: 50 節點上限（第 51 個拒絕 / 未達上限允許）
// ============================================================

func TestRegistryLimit_Exceeded(t *testing.T) {
	r := newTestRegistry(t)
	// 直接以記憶體插入 50 筆（避免 50 次檔案寫入）
	r.mu.Lock()
	for i := 0; i < MaxNodes; i++ {
		id := fmt.Sprintf("node-%02d", i)
		name := fmt.Sprintf("node-%02d", i)
		r.nodes[id] = &Node{ID: id, Name: name, Address: "10.0.0.1:8443"}
		r.byName[name] = id
	}
	r.mu.Unlock()

	_, err := r.Create(&Node{Name: "overflow", Address: "10.0.0.2:8443"})
	if !errors.Is(err, ErrNodeLimit) {
		t.Errorf("expected ErrNodeLimit, got %v", err)
	}
	if r.Count() != MaxNodes {
		t.Errorf("registry must not grow past %d, got %d", MaxNodes, r.Count())
	}
}

func TestRegistryLimit_UnderLimit(t *testing.T) {
	r := newTestRegistry(t)
	r.mu.Lock()
	for i := 0; i < MaxNodes-1; i++ {
		id := fmt.Sprintf("node-%02d", i)
		name := fmt.Sprintf("node-%02d", i)
		r.nodes[id] = &Node{ID: id, Name: name, Address: "10.0.0.1:8443"}
		r.byName[name] = id
	}
	r.mu.Unlock()

	created, err := r.Create(&Node{Name: "last-node", Address: "10.0.0.2:8443"})
	if err != nil {
		t.Fatalf("50th node should be allowed: %v", err)
	}
	if created == nil || r.Count() != MaxNodes {
		t.Errorf("expected %d nodes after create, got %d", MaxNodes, r.Count())
	}
}

// ============================================================
//  SYS-13: 並發操作無 data race（go test -race 驗證）
// ============================================================

func TestRegistryConcurrent(t *testing.T) {
	r := newTestRegistry(t)

	var wg sync.WaitGroup
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			name := fmt.Sprintf("node-%02d", i)
			created, err := r.Create(&Node{Name: name, Address: "10.0.0.1:8443"})
			if err != nil {
				t.Errorf("create %s: %v", name, err)
				return
			}
			r.SetHeartbeat(name, Heartbeat{
				NodeName:     name,
				AgentVersion: "1.2.0",
				Services:     ServiceStats{Total: 1, Active: 1},
			})
			if _, err := r.Update(created.ID, &Node{Notes: "updated"}); err != nil {
				t.Errorf("update %s: %v", name, err)
			}
			_ = r.List()
			_ = r.Get(created.ID)
			_ = r.GetByName(name)
			_ = r.VerifyToken(name, created.Token)
		}(i)
	}
	wg.Wait()

	if r.Count() != 10 {
		t.Errorf("expected 10 nodes, got %d", r.Count())
	}
	for _, n := range r.List() {
		if n.LastHeartbeat == "" {
			t.Errorf("node %s missing heartbeat after concurrent ops", n.Name)
		}
	}
}

// ============================================================
//  SYS-14: 檔案權限 0600（token 含於檔內）
// ============================================================

func TestRegistryFileMode0600(t *testing.T) {
	r := newTestRegistry(t)
	if _, err := r.Create(&Node{Name: "web-server-01", Address: "10.0.0.5:8443"}); err != nil {
		t.Fatalf("create: %v", err)
	}

	info, err := os.Stat(r.filePath)
	if err != nil {
		t.Fatalf("stat nodes.json: %v", err)
	}
	if perm := info.Mode().Perm(); perm != 0600 {
		t.Errorf("expected file mode 0600, got %o", perm)
	}
}

// ============================================================
//  MaskToken 遮罩格式（API 回應用，決策 5）
// ============================================================

func TestMaskToken(t *testing.T) {
	masked := MaskToken("lsm_node_abcdefgh1234567890")
	if !strings.HasPrefix(masked, "lsm_node_") {
		t.Errorf("masked token should keep prefix, got %q", masked)
	}
	if !strings.Contains(masked, "****") {
		t.Errorf("masked token should contain ****, got %q", masked)
	}
	if masked == "lsm_node_abcdefgh1234567890" {
		t.Error("masked token must not equal raw token")
	}
}
