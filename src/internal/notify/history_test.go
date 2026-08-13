package notify

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func newTestHistory(t *testing.T) (*History, string) {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "notify-history.jsonl")
	h := NewHistory(Config{HistoryPath: path, RetentionDays: 30})
	return h, path
}

func writeHistoryFile(t *testing.T, path string, entries []HistoryEntry) {
	t.Helper()
	var sb strings.Builder
	for _, e := range entries {
		b, err := json.Marshal(e)
		if err != nil {
			t.Fatal(err)
		}
		sb.Write(b)
		sb.WriteByte('\n')
	}
	if err := os.WriteFile(path, []byte(sb.String()), 0o644); err != nil {
		t.Fatal(err)
	}
}

func sampleEntry(ts string, status string) HistoryEntry {
	return HistoryEntry{
		Timestamp:   ts,
		ChannelID:   "id-1",
		ChannelName: "團隊 Slack",
		ChannelType: "slack",
		Event:       "failed",
		Service:     "nginx.service",
		Status:      status,
	}
}

// SYS-55: Write 以 JSONL 追加寫入
func TestHistoryWriteJSONL(t *testing.T) {
	h, path := newTestHistory(t)
	defer h.Shutdown()

	h.Write(sampleEntry(time.Now().UTC().Format(time.RFC3339), "success"))
	h.Shutdown()

	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	lines := strings.Split(strings.TrimSpace(string(data)), "\n")
	if len(lines) != 1 {
		t.Fatalf("expected 1 line, got %d", len(lines))
	}
	var e HistoryEntry
	if err := json.Unmarshal([]byte(lines[0]), &e); err != nil {
		t.Fatalf("line is not valid JSON: %v", err)
	}
	if e.Status != "success" {
		t.Errorf("unexpected status: %s", e.Status)
	}
}

// SYS-57: Query 分頁回傳 total + 時間倒序
func TestHistoryQueryPagination(t *testing.T) {
	_, path := newTestHistory(t)
	var entries []HistoryEntry
	for i := 0; i < 45; i++ {
		ts := time.Now().Add(time.Duration(-i) * time.Minute).UTC().Format(time.RFC3339)
		entries = append(entries, sampleEntry(ts, "success"))
	}
	writeHistoryFile(t, path, entries)

	h := NewHistory(Config{HistoryPath: path, RetentionDays: 30})
	defer h.Shutdown()

	res, err := h.Query(HistoryQuery{Page: 2, Limit: 30})
	if err != nil {
		t.Fatal(err)
	}
	if res.Total != 45 {
		t.Errorf("expected total 45, got %d", res.Total)
	}
	if len(res.Entries) != 15 {
		t.Errorf("expected 15 entries on page 2, got %d", len(res.Entries))
	}
	// 倒序：第一筆時間最晚
	if res.Entries[0].Timestamp < res.Entries[len(res.Entries)-1].Timestamp {
		t.Error("expected time-descending order")
	}
}

// SYS-58/59: Query 篩選
func TestHistoryQueryFilters(t *testing.T) {
	_, path := newTestHistory(t)
	e1 := sampleEntry(time.Now().Add(-time.Minute).UTC().Format(time.RFC3339), "success")
	e2 := sampleEntry(time.Now().Add(-2*time.Minute).UTC().Format(time.RFC3339), "failure")
	e2.ChannelID = "id-2"
	writeHistoryFile(t, path, []HistoryEntry{e1, e2})

	h := NewHistory(Config{HistoryPath: path, RetentionDays: 30})
	defer h.Shutdown()

	// channel 篩選
	res, _ := h.Query(HistoryQuery{Page: 1, Limit: 30, ChannelID: "id-2"})
	if res.Total != 1 || res.Entries[0].ChannelID != "id-2" {
		t.Errorf("channel filter failed: %+v", res)
	}
	// status=failure
	res, _ = h.Query(HistoryQuery{Page: 1, Limit: 30, Status: "failure"})
	if res.Total != 1 || res.Entries[0].Status != "failure" {
		t.Errorf("status filter failed: %+v", res)
	}
	// status=success
	res, _ = h.Query(HistoryQuery{Page: 1, Limit: 30, Status: "success"})
	if res.Total != 1 || res.Entries[0].Status != "success" {
		t.Errorf("status filter failed: %+v", res)
	}
	// all
	res, _ = h.Query(HistoryQuery{Page: 1, Limit: 30, Status: "all"})
	if res.Total != 2 {
		t.Errorf("expected 2 entries for all, got %d", res.Total)
	}
}

// SYS-60: 30 天 TTL 清理
func TestHistoryCleanupTTL(t *testing.T) {
	_, path := newTestHistory(t)
	old := time.Now().AddDate(0, 0, -31).UTC().Format(time.RFC3339)
	recent := time.Now().AddDate(0, 0, -10).UTC().Format(time.RFC3339)
	writeHistoryFile(t, path, []HistoryEntry{
		sampleEntry(old, "success"),
		sampleEntry(recent, "success"),
	})

	h := NewHistory(Config{HistoryPath: path, RetentionDays: 30})
	defer h.Shutdown()
	h.CleanupNow()

	data, _ := os.ReadFile(path)
	if strings.Contains(string(data), old) {
		t.Error("expected old entry removed")
	}
	if !strings.Contains(string(data), recent) {
		t.Error("expected recent entry kept")
	}
}

// SYS-62: 刪除 channel 後紀錄仍可查詢（channel_name 快照）
func TestHistorySnapshotSurvivesDelete(t *testing.T) {
	_, path := newTestHistory(t)
	writeHistoryFile(t, path, []HistoryEntry{sampleEntry(time.Now().UTC().Format(time.RFC3339), "success")})

	h := NewHistory(Config{HistoryPath: path, RetentionDays: 30})
	defer h.Shutdown()
	res, _ := h.Query(HistoryQuery{Page: 1, Limit: 30})
	if res.Total != 1 || res.Entries[0].ChannelName != "團隊 Slack" {
		t.Errorf("expected snapshot channel name, got %+v", res)
	}
}

// SYS-64: Shutdown 可重複呼叫且不 panic
func TestHistoryShutdownIdempotent(t *testing.T) {
	h, _ := newTestHistory(t)
	h.Shutdown()
	h.Shutdown() // 第二次不 panic
}
