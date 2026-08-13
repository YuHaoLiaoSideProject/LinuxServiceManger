package notify

// SYS-11 ~ SYS-29 notifier 單元測試（docs/test-plans/013-webhook-notification測試計畫.md §2.2/2.3）
// 狀態機測試採白盒方式：直接設 stateMachine.prevActive / leftActiveAt 並注入時鐘 sm.now。

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func newSM(t *testing.T) (*stateMachine, *time.Time) {
	t.Helper()
	now := time.Date(2025, 8, 9, 12, 0, 0, 0, time.UTC)
	sm := newStateMachine()
	sm.now = func() time.Time { return now }
	return sm, &now
}

// ── 狀態機轉換（SYS-11 ~ SYS-19）──

// setRunningState 設定服務的語意 running 狀態（含 raw prevActive）。
func setRunningState(sm *stateMachine, name string, running bool) {
	sm.running[name] = running
	if running {
		sm.prevActive[name] = "active"
	} else {
		sm.prevActive[name] = "inactive"
	}
}

// SYS-11: active → failed 觸發 failed
func TestStateMachineFailed(t *testing.T) {
	sm, _ := newSM(t)
	setRunningState(sm, "nginx.service", true)

	ev, pending := sm.Transition("nginx.service", "failed")
	if ev == nil || ev.Kind != EventFailed {
		t.Fatalf("expected failed event, got %v", ev)
	}
	if pending {
		t.Error("failed should not be a pending stop")
	}
}

// SYS-12: active → inactive 應觸發「延遲 stopped」（pendingStop=true，無立即事件）
func TestStateMachineInactiveStops(t *testing.T) {
	sm, _ := newSM(t)
	setRunningState(sm, "nginx.service", true)

	ev, pending := sm.Transition("nginx.service", "inactive")
	if ev != nil {
		t.Fatalf("expected no immediate event (stopped is deferred), got %v", ev)
	}
	if !pending {
		t.Fatal("expected pending stop")
	}
}

// SYS-13: active → dead 應觸發「延遲 stopped」
func TestStateMachineDeadStops(t *testing.T) {
	sm, _ := newSM(t)
	setRunningState(sm, "nginx.service", true)

	ev, pending := sm.Transition("nginx.service", "dead")
	if ev != nil {
		t.Fatalf("expected no immediate event (stopped is deferred), got %v", ev)
	}
	if !pending {
		t.Fatal("expected pending stop")
	}
}

// SYS-14: inactive → active（>5s）觸發 started
func TestStateMachineStartedAfter5s(t *testing.T) {
	sm, now := newSM(t)
	setRunningState(sm, "nginx.service", false)
	sm.leftActiveAt["nginx.service"] = now.Add(-6 * time.Second)

	ev, _ := sm.Transition("nginx.service", "active")
	if ev == nil || ev.Kind != EventStarted {
		t.Fatalf("expected started event, got %v", ev)
	}
}

// SYS-15: 5 秒內回到 active 觸發 restarted（僅一筆，不重複 stopped+started）
func TestStateMachineRestartedWithin5s(t *testing.T) {
	sm, now := newSM(t)
	setRunningState(sm, "nginx.service", true)

	// active → deactivating（記錄 leftActiveAt，無事件）
	if ev, _ := sm.Transition("nginx.service", "deactivating"); ev != nil {
		t.Fatalf("deactivating should not trigger event, got %v", ev)
	}
	if sm.leftActiveAt["nginx.service"].IsZero() {
		t.Fatal("expected leftActiveAt recorded on deactivating")
	}

	// deactivating → inactive（pending stop，無立即事件）
	ev, pending := sm.Transition("nginx.service", "inactive")
	if ev != nil {
		t.Fatalf("deactivating→inactive should not trigger immediate event, got %v", ev)
	}
	if !pending {
		t.Fatal("expected pending stop at inactive")
	}

	// inactive → active（2 秒內）→ restarted
	*now = now.Add(2 * time.Second)
	ev, _ = sm.Transition("nginx.service", "active")
	if ev == nil || ev.Kind != EventRestarted {
		t.Fatalf("expected restarted event, got %v", ev)
	}
}

// SYS-16: 超過 5 秒的 stop→start 產生 started（stopped 為延遲事件，另於 Notifier 層驗證）
func TestStateMachineStopStartOver5s(t *testing.T) {
	sm, now := newSM(t)
	setRunningState(sm, "nginx.service", true)

	ev1, pending := sm.Transition("nginx.service", "inactive")
	if ev1 != nil {
		t.Fatalf("expected no immediate event, got %v", ev1)
	}
	if !pending {
		t.Fatal("expected pending stop")
	}

	*now = now.Add(8 * time.Second)
	ev2, _ := sm.Transition("nginx.service", "active")
	if ev2 == nil || ev2.Kind != EventStarted {
		t.Fatalf("expected started event after 8s, got %v", ev2)
	}
}

// SYS-17: deactivating 記錄離開時間、不觸發事件
func TestStateMachineDeactivatingRecordsTime(t *testing.T) {
	sm, now := newSM(t)
	setRunningState(sm, "nginx.service", true)

	ev, pending := sm.Transition("nginx.service", "deactivating")
	if ev != nil || pending {
		t.Fatalf("deactivating should not trigger event, got ev=%v pending=%v", ev, pending)
	}
	if sm.leftActiveAt["nginx.service"] != *now {
		t.Errorf("expected leftActiveAt=%v, got %v", *now, sm.leftActiveAt["nginx.service"])
	}
}

// SYS-18: sub 單獨變更（active 不變）不觸發
func TestStateMachineSubChangeNoEvent(t *testing.T) {
	sm, _ := newSM(t)
	setRunningState(sm, "nginx.service", true)

	if ev, _ := sm.Transition("nginx.service", "active"); ev != nil {
		t.Fatalf("same active should skip, got %v", ev)
	}
}

// SYS-19: reloaded（未知/無變化狀態）不觸發
func TestStateMachineReloadedNoEvent(t *testing.T) {
	sm, _ := newSM(t)
	setRunningState(sm, "nginx.service", true)

	if ev, _ := sm.Transition("nginx.service", "reloading"); ev != nil {
		t.Fatalf("reloading should not trigger event, got %v", ev)
	}
}

// reload 完成（reloading → active）不應誤發 started
func TestStateMachineReloadNoSpuriousStarted(t *testing.T) {
	sm, _ := newSM(t)
	setRunningState(sm, "nginx.service", true)

	sm.Transition("nginx.service", "reloading")
	ev, _ := sm.Transition("nginx.service", "active")
	if ev != nil {
		t.Fatalf("reload completion should not fire started, got %v", ev)
	}
}

// 真實 restart 序列（active → deactivating → inactive → activating → active）判定為 restarted
func TestStateMachineRestartedThroughActivating(t *testing.T) {
	sm, now := newSM(t)
	setRunningState(sm, "nginx.service", true)

	sm.Transition("nginx.service", "deactivating")
	sm.Transition("nginx.service", "inactive")
	*now = now.Add(1 * time.Second)
	sm.Transition("nginx.service", "activating")
	*now = now.Add(1 * time.Second)
	ev, _ := sm.Transition("nginx.service", "active")
	if ev == nil || ev.Kind != EventRestarted {
		t.Fatalf("expected restarted event, got %v", ev)
	}
}

// ── 匹配邏輯（SYS-21 ~ SYS-29）──

// SYS-23: containsEvent 判斷
func TestContainsEvent(t *testing.T) {
	cases := []struct {
		events []string
		kind   string
		want   bool
	}{
		{[]string{"failed"}, "failed", true},
		{[]string{"failed"}, "stopped", false},
		{[]string{"started", "stopped", "failed", "restarted"}, "restarted", true},
		{[]string{}, "failed", false},
		{nil, "failed", false},
	}
	for _, c := range cases {
		if got := containsEvent(c.events, c.kind); got != c.want {
			t.Errorf("containsEvent(%v, %q) = %v, want %v", c.events, c.kind, got, c.want)
		}
	}
}

// SYS-24/25/26/27/28: matchesService 精確匹配（不支援 regex/glob）
func TestMatchesService(t *testing.T) {
	cases := []struct {
		name    string
		ch      *Channel
		service string
		want    bool
	}{
		{"全部服務", &Channel{AllServices: true}, "nginx.service", true},
		{"指定服務精確匹配", &Channel{AllServices: false, Services: []string{"postgresql.service"}}, "postgresql.service", true},
		{"事件匹配但範圍不匹配", &Channel{AllServices: false, Services: []string{"postgresql.service"}}, "nginx.service", false},
		{"無後綴不匹配", &Channel{AllServices: false, Services: []string{"nginx.service"}}, "nginx", false},
		{"相似名稱不匹配", &Channel{AllServices: false, Services: []string{"nginx.service"}}, "nginx-ssl.service", false},
		{"其他服務不匹配", &Channel{AllServices: false, Services: []string{"nginx.service"}}, "web.service", false},
	}
	for _, c := range cases {
		if got := matchesService(c.ch, c.service); got != c.want {
			t.Errorf("%s: matchesService(%v, %q) = %v, want %v", c.name, c.ch.Services, c.service, got, c.want)
		}
	}
}

// 建構一個以 temp dir 為底、mock server 為目標的 Notifier。
func newTestNotifier(t *testing.T) (*Notifier, *ChannelStore, string) {
	t.Helper()
	dir := t.TempDir()
	n := New(Config{
		ChannelsPath:  filepath.Join(dir, "notify.json"),
		HistoryPath:   filepath.Join(dir, "notify-history.jsonl"),
		RetentionDays: 30,
	})
	if err := n.Load(); err != nil {
		t.Fatalf("notify load: %v", err)
	}
	return n, n.store, filepath.Join(dir, "notify-history.jsonl")
}

// SYS-21: enabled + 事件包含 + 全部服務 → 匹配並發送
func TestNotifierMatchAllServices(t *testing.T) {
	var requests int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&requests, 1)
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	n, store, path := newTestNotifier(t)
	_, err := store.Create(&Channel{
		Type:        ChannelTypeSlack,
		Name:        "團隊 Slack",
		URL:         srv.URL,
		Events:      []string{string(EventFailed)},
		AllServices: true,
		Enabled:     true,
	})
	if err != nil {
		t.Fatal(err)
	}

	n.HandleStatusChange("nginx.service", "failed", "failed")
	n.Shutdown() // 等待 in-flight SendBatch 完成 + flush history

	if atomic.LoadInt32(&requests) != 1 {
		t.Errorf("expected 1 request, got %d", atomic.LoadInt32(&requests))
	}
	data, _ := os.ReadFile(path)
	if !strings.Contains(string(data), `"service":"nginx.service"`) {
		t.Errorf("expected history entry for nginx.service, got: %s", string(data))
	}
}

// SYS-22: 停用 channel 一律跳過
func TestNotifierDisabledChannelSkipped(t *testing.T) {
	var requests int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&requests, 1)
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	n, store, path := newTestNotifier(t)
	_, err := store.Create(&Channel{
		Type:        ChannelTypeSlack,
		Name:        "維護通知",
		URL:         srv.URL,
		Events:      []string{string(EventFailed)},
		AllServices: true,
		Enabled:     false,
	})
	if err != nil {
		t.Fatal(err)
	}

	n.HandleStatusChange("nginx.service", "failed", "failed")
	n.Shutdown()

	if atomic.LoadInt32(&requests) != 0 {
		t.Errorf("disabled channel should not send, got %d requests", atomic.LoadInt32(&requests))
	}
	if data, err := os.ReadFile(path); err == nil && len(strings.TrimSpace(string(data))) != 0 {
		t.Errorf("expected no history entry, got: %s", string(data))
	}
}

// SYS-23/26/29: 事件或範圍不匹配 → 不發送、無紀錄
func TestNotifierNoMatchNoSend(t *testing.T) {
	var requests int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&requests, 1)
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	n, store, path := newTestNotifier(t)
	// events 不含 started；範圍僅 postgresql.service
	_, err := store.Create(&Channel{
		Type:        ChannelTypeSlack,
		Name:        "DB 通知",
		URL:         srv.URL,
		Events:      []string{string(EventFailed)},
		AllServices: false,
		Services:    []string{"postgresql.service"},
		Enabled:     true,
	})
	if err != nil {
		t.Fatal(err)
	}

	// nginx.service failed：事件匹配（failed）但範圍不匹配 → 不發送
	n.HandleStatusChange("nginx.service", "failed", "failed")
	// postgresql.service started：範圍匹配但事件不匹配（events 僅 failed）→ 不發送
	n.HandleStatusChange("postgresql.service", "active", "running")
	n.Shutdown()

	if atomic.LoadInt32(&requests) != 0 {
		t.Errorf("no matching channel should send, got %d requests", atomic.LoadInt32(&requests))
	}
	if data, err := os.ReadFile(path); err == nil && len(strings.TrimSpace(string(data))) != 0 {
		t.Errorf("expected no history entry, got: %s", string(data))
	}
}

// 真實 stop 序列（active → deactivating → inactive）應於延遲後觸發 stopped
func TestNotifierStoppedDeferred(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	n, store, path := newTestNotifier(t)
	n.stoppedDelay = 20 * time.Millisecond
	_, err := store.Create(&Channel{
		Type:        ChannelTypeSlack,
		Name:        "S",
		URL:         srv.URL,
		Events:      []string{string(EventStopped)},
		AllServices: true,
		Enabled:     true,
	})
	if err != nil {
		t.Fatal(err)
	}

	// 模擬 systemctl stop：active → deactivating → inactive
	n.sm.running["nginx.service"] = true
	n.sm.prevActive["nginx.service"] = "active"
	n.HandleStatusChange("nginx.service", "deactivating", "stop-sigterm")
	n.HandleStatusChange("nginx.service", "inactive", "dead")

	time.Sleep(100 * time.Millisecond) // 等 deferred stopped 觸發
	n.Shutdown()                        // flush history

	data, _ := os.ReadFile(path)
	if !strings.Contains(string(data), `"event":"stopped"`) {
		t.Errorf("expected stopped event in history, got: %s", string(data))
	}
}

// restart 序列（active → deactivating → inactive → activating → active）只發 restarted，不發 stopped
func TestNotifierRestartNoStopped(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	n, store, path := newTestNotifier(t)
	n.stoppedDelay = 30 * time.Millisecond
	_, err := store.Create(&Channel{
		Type:        ChannelTypeSlack,
		Name:        "S",
		URL:         srv.URL,
		Events:      []string{string(EventRestarted), string(EventStopped)},
		AllServices: true,
		Enabled:     true,
	})
	if err != nil {
		t.Fatal(err)
	}

	n.sm.running["nginx.service"] = true
	n.sm.prevActive["nginx.service"] = "active"
	n.HandleStatusChange("nginx.service", "deactivating", "stop-sigterm")
	n.HandleStatusChange("nginx.service", "inactive", "dead")
	n.HandleStatusChange("nginx.service", "activating", "start")
	n.HandleStatusChange("nginx.service", "active", "running")

	time.Sleep(100 * time.Millisecond)
	n.Shutdown()

	data, _ := os.ReadFile(path)
	if !strings.Contains(string(data), `"event":"restarted"`) {
		t.Errorf("expected restarted event, got: %s", string(data))
	}
	if strings.Contains(string(data), `"event":"stopped"`) {
		t.Errorf("restart should not fire stopped, got: %s", string(data))
	}
}
