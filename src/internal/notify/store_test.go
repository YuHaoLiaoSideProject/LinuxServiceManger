package notify

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"testing"
)

func newTestStore(t *testing.T) *ChannelStore {
	t.Helper()
	dir := t.TempDir()
	s := NewStore(filepath.Join(dir, "notify.json"))
	if err := s.Load(); err != nil {
		t.Fatalf("failed to load test store: %v", err)
	}
	return s
}

func sampleChannel() *Channel {
	return &Channel{
		Type:        ChannelTypeSlack,
		Name:        "團隊 Slack",
		URL:         "https://hooks.slack.com/services/xxx",
		Events:      []string{string(EventFailed)},
		AllServices: true,
		Enabled:     true,
	}
}

// SYS-42: Load 載入 notify.json；不存在 → 空清單
func TestStoreLoad(t *testing.T) {
	s := newTestStore(t)
	if s.Count() != 0 {
		t.Fatalf("expected empty store, got %d", s.Count())
	}
}

// SYS-44: Create 新增 channel（UUID + 時間戳）
func TestStoreCreate(t *testing.T) {
	s := newTestStore(t)
	ch, err := s.Create(sampleChannel())
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if ch.ID == "" {
		t.Error("expected non-empty ID")
	}
	if ch.CreatedAt == "" || ch.UpdatedAt == "" {
		t.Error("expected created_at/updated_at set")
	}
	if s.Count() != 1 {
		t.Errorf("expected count 1, got %d", s.Count())
	}
}

// SYS-43: Save atomic write
func TestStoreSaveAtomic(t *testing.T) {
	s := newTestStore(t)
	if _, err := s.Create(sampleChannel()); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(s.filePath)
	if err != nil {
		t.Fatalf("read file: %v", err)
	}
	var m map[string]*Channel
	if err := json.Unmarshal(data, &m); err != nil {
		t.Fatalf("notify.json is not valid JSON: %v", err)
	}
	if _, err := os.Stat(s.filePath + ".tmp"); !os.IsNotExist(err) {
		t.Error("expected no .tmp leftover")
	}
}

// SYS-54: 檔案權限 0600
func TestStoreFilePermission(t *testing.T) {
	s := newTestStore(t)
	if _, err := s.Create(sampleChannel()); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(s.filePath)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Errorf("expected 0600, got %o", info.Mode().Perm())
	}
}

// SYS-45: Update 更新並刷新 updated_at / 重置 failures
func TestStoreUpdate(t *testing.T) {
	s := newTestStore(t)
	ch, _ := s.Create(sampleChannel())
	s.IncrFailures(ch.ID)
	ch.Name = "新名稱"
	updated, err := s.Update(ch)
	if err != nil {
		t.Fatalf("Update: %v", err)
	}
	if updated.Name != "新名稱" {
		t.Errorf("expected updated name, got %q", updated.Name)
	}
	got := s.Get(ch.ID)
	if got.failures != 0 {
		t.Errorf("expected failures reset, got %d", got.failures)
	}
}

// SYS-46: Delete 移除 channel（紀錄保留由 history 測試負責）
func TestStoreDelete(t *testing.T) {
	s := newTestStore(t)
	ch, _ := s.Create(sampleChannel())
	if err := s.Delete(ch.ID); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	if s.Get(ch.ID) != nil {
		t.Error("expected channel removed")
	}
}

// SYS-47: SetEnabled 更新啟用狀態
func TestStoreSetEnabled(t *testing.T) {
	s := newTestStore(t)
	ch, _ := s.Create(sampleChannel())
	got, err := s.SetEnabled(ch.ID, false)
	if err != nil {
		t.Fatal(err)
	}
	if got.Enabled {
		t.Error("expected disabled")
	}
}

// SYS-48: 連續第 10 次失敗自動停用
func TestIncrFailuresAutoDisable(t *testing.T) {
	s := newTestStore(t)
	ch, _ := s.Create(sampleChannel())

	var auto bool
	var err error
	for i := 0; i < MaxConsecutiveFailures; i++ {
		ch, auto, err = s.IncrFailures(ch.ID)
		if err != nil {
			t.Fatalf("IncrFailures %d: %v", i+1, err)
		}
	}
	if !auto {
		t.Fatal("expected autoDisable on 10th failure")
	}
	if ch.Enabled {
		t.Error("expected channel disabled")
	}
	if ch.AutoDisabledReason == "" {
		t.Error("expected auto_disabled_reason")
	}
	// 已立即持久化
	data, _ := os.ReadFile(s.filePath)
	var m map[string]*Channel
	json.Unmarshal(data, &m)
	if m[ch.ID].Enabled {
		t.Error("expected persisted disabled state")
	}
}

// SYS-49: 停用狀態重啟後保持
func TestAutoDisablePersistsAcrossReload(t *testing.T) {
	s := newTestStore(t)
	ch, _ := s.Create(sampleChannel())
	for i := 0; i < MaxConsecutiveFailures; i++ {
		s.IncrFailures(ch.ID)
	}

	s2 := NewStore(s.filePath)
	if err := s2.Load(); err != nil {
		t.Fatal(err)
	}
	reloaded := s2.Get(ch.ID)
	if reloaded == nil || reloaded.Enabled {
		t.Error("expected disabled state after reload")
	}
}

// SYS-50: 手動 re-enable 重置
func TestManualReenableResets(t *testing.T) {
	s := newTestStore(t)
	ch, _ := s.Create(sampleChannel())
	for i := 0; i < MaxConsecutiveFailures; i++ {
		s.IncrFailures(ch.ID)
	}
	got, err := s.SetEnabled(ch.ID, true)
	if err != nil {
		t.Fatal(err)
	}
	if !got.Enabled {
		t.Error("expected enabled")
	}
	if got.AutoDisabledReason != "" {
		t.Error("expected reason cleared")
	}
	if s.Get(ch.ID).failures != 0 {
		t.Error("expected failures reset")
	}
}

// SYS-51/52: channel 上限 20
func TestChannelLimit(t *testing.T) {
	s := newTestStore(t)
	for i := 0; i < MaxChannels; i++ {
		if _, err := s.Create(sampleChannel()); err != nil {
			t.Fatalf("create %d: %v", i+1, err)
		}
	}
	if _, err := s.Create(sampleChannel()); err != ErrChannelLimit {
		t.Errorf("expected ErrChannelLimit, got %v", err)
	}
}

// SYS-53: 並發 store 操作安全（-race）
func TestStoreConcurrent(t *testing.T) {
	s := newTestStore(t)
	var wg sync.WaitGroup
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if ch, err := s.Create(sampleChannel()); err == nil {
				s.SetEnabled(ch.ID, false)
			}
		}()
	}
	wg.Wait()
	if s.Count() > MaxChannels {
		t.Errorf("count %d exceeds limit", s.Count())
	}
}
