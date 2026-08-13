package notify

import (
	"sync"
	"time"

	"linux-service-manager/internal/websocket"
)

// ============================================================
//  Config
// ============================================================

// Config 是 Notifier 的建構參數。
type Config struct {
	ChannelsPath  string // /var/lib/linux-service-manager/notify.json
	HistoryPath   string // /var/lib/linux-service-manager/notify-history.jsonl
	RetentionDays int    // 30
	MaxFileSizeMB int64  // 100
	WriteBufSize  int    // 100
	Hub           *websocket.Hub
}

// defaults 填補零值欄位。
func (c *Config) defaults() {
	if c.ChannelsPath == "" {
		c.ChannelsPath = "/var/lib/linux-service-manager/notify.json"
	}
	if c.HistoryPath == "" {
		c.HistoryPath = "/var/lib/linux-service-manager/notify-history.jsonl"
	}
	if c.RetentionDays <= 0 {
		c.RetentionDays = 30
	}
	if c.MaxFileSizeMB <= 0 {
		c.MaxFileSizeMB = 100
	}
	if c.WriteBufSize <= 0 {
		c.WriteBufSize = 100
	}
}

// ============================================================
//  Notifier
// ============================================================

// Notifier 是通知模組的門面：事件處理、匹配、生命週期。
type Notifier struct {
	store        *ChannelStore
	history      *History
	sender       *Sender
	hub          *websocket.Hub
	sm           *stateMachine
	cfg          Config
	stoppedDelay time.Duration // 延遲判定 stopped 的窗口（與 restartWindow 對齊）
	done         chan struct{}
	wg           sync.WaitGroup

	shutdownMu sync.RWMutex
	shutdown   bool
}

// New 建立 Notifier（尚未載入 store；回呼尚未註冊 — 由 main.go 完成）。
func New(cfg Config) *Notifier {
	cfg.defaults()
	store := NewStore(cfg.ChannelsPath)
	history := NewHistory(cfg)
	sender := NewSender(store, history)
	n := &Notifier{
		store:        store,
		history:      history,
		sender:       sender,
		hub:          cfg.Hub,
		sm:           newStateMachine(),
		cfg:          cfg,
		stoppedDelay: 5 * time.Second,
		done:         make(chan struct{}),
	}
	sender.onAutoDisable = n.notifyChannelDisabled
	return n
}

// Load 載入 channel store（必須在 hub.OnStatusChange 註冊前完成；決策 7）。
func (n *Notifier) Load() error { return n.store.Load() }

// HandleStatusChange 是 hub.OnStatusChange 的回呼實作（同步快速路徑）。
func (n *Notifier) HandleStatusChange(name, active, sub string) {
	ev, pendingStop := n.sm.Transition(name, active)
	if ev != nil {
		n.dispatch(*ev)
	}
	if pendingStop {
		n.scheduleStopped(name)
	}
}

// dispatch 將事件匹配至啟用的 channel 並背景並行發送。
func (n *Notifier) dispatch(ev Event) {
	var matched []*Channel
	for _, ch := range n.store.List() {
		if !ch.Enabled {
			continue
		}
		if !containsEvent(ch.Events, string(ev.Kind)) {
			continue
		}
		if !matchesService(ch, ev.Service) {
			continue
		}
		matched = append(matched, ch)
	}
	if len(matched) == 0 {
		return
	}

	n.wg.Add(1)
	go func() {
		defer n.wg.Done()
		n.sender.SendBatch(ev, matched)
	}()
}

// scheduleStopped 延遲判定 stopped：等待 stoppedDelay 後，若服務仍未回到 active
// （即為真實 stop 而非 restart），才發送 stopped 事件。
func (n *Notifier) scheduleStopped(name string) {
	n.wg.Add(1)
	go func() {
		defer n.wg.Done()
		timer := time.NewTimer(n.stoppedDelay)
		defer timer.Stop()
		select {
		case <-timer.C:
		case <-n.done:
			return
		}

		running, status := n.sm.snapshot(name)
		if running || (status != "inactive" && status != "dead") {
			return // 已 restart / failed / 其他狀態 → 不發 stopped
		}
		n.dispatch(Event{Kind: EventStopped, Service: name, Status: status, Timestamp: time.Now().UTC()})
	}()
}

// Run 啟動每日清理 ticker（24h），並於啟動時清理一次（決策 6 雙保險）。
func (n *Notifier) Run() {
	n.history.CleanupNow()
	ticker := time.NewTicker(24 * time.Hour)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			n.history.cleanup()
		case <-n.done:
			return
		}
	}
}

// Shutdown 優雅關閉：停止 ticker、等待 in-flight SendBatch 完成、history.Shutdown。
func (n *Notifier) Shutdown() {
	n.shutdownMu.Lock()
	if n.shutdown {
		n.shutdownMu.Unlock()
		return
	}
	n.shutdown = true
	n.shutdownMu.Unlock()

	close(n.done)
	n.wg.Wait()
	n.history.Shutdown()
}

// notifyChannelDisabled 推送 WS 訊息 {type:"notify_channel_disabled", id, name, reason}。
func (n *Notifier) notifyChannelDisabled(ch *Channel) {
	if n.hub != nil {
		n.hub.BroadcastMessage(websocket.Message{
			Type:   "notify_channel_disabled",
			ID:     ch.ID,
			Name:   ch.Name,
			Reason: ch.AutoDisabledReason,
		})
	}
}

// ============================================================
//  供 handler 使用的存取方法（欄位未匯出以匹配 notifier_test 的 n.store）
// ============================================================

// ListChannels 回傳全部 channel 的深拷貝。
func (n *Notifier) ListChannels() []*Channel { return n.store.List() }

// GetChannel 依 ID 取得 channel；不存在回 nil。
func (n *Notifier) GetChannel(id string) *Channel { return n.store.Get(id) }

// CountChannels 回傳 channel 總數。
func (n *Notifier) CountChannels() int { return n.store.Count() }

// CreateChannel 建立 channel。
func (n *Notifier) CreateChannel(ch *Channel) (*Channel, error) { return n.store.Create(ch) }

// UpdateChannel 覆寫 channel 設定（failures 歸零 + reason 清空）。
func (n *Notifier) UpdateChannel(ch *Channel) (*Channel, error) { return n.store.Update(ch) }

// DeleteChannel 刪除 channel。
func (n *Notifier) DeleteChannel(id string) error { return n.store.Delete(id) }

// SetChannelEnabled 更新啟用狀態。
func (n *Notifier) SetChannelEnabled(id string, enabled bool) (*Channel, error) {
	return n.store.SetEnabled(id, enabled)
}

// QueryHistory 查詢發送紀錄。
func (n *Notifier) QueryHistory(q HistoryQuery) (HistoryResult, error) { return n.history.Query(q) }

// TestChannel 發送測試通知（不寫 history、不累計 failures；成功歸零 failures）。
func (n *Notifier) TestChannel(ch *Channel) (bool, string) {
	ev := Event{Kind: EventTest, Service: ch.Name, Status: "test", Timestamp: time.Now()}
	ok, detail := n.sender.sendWithRetry(ch, ev)
	if ok {
		n.store.ResetFailures(ch.ID)
	}
	return ok, detail
}

// ============================================================
//  stateMachine
// ============================================================

// stateMachine 將 raw ActiveState 轉換為觸發事件。
// 以「語意 running 狀態」追蹤（running map）而非只比對 raw prevActive，
// 才能正確處理真實 systemd 的過渡狀態（deactivating/activating/reloading）。
type stateMachine struct {
	mu           sync.Mutex
	prevActive   map[string]string    // raw 前次 ActiveState（偵測無變化）
	running      map[string]bool      // 語意狀態：服務是否在 running（active-like）
	leftActiveAt map[string]time.Time // 離開 active 的時間（restarted/stopped 判定用）
	now          func() time.Time
}

func newStateMachine() *stateMachine {
	return &stateMachine{
		prevActive:   make(map[string]string),
		running:      make(map[string]bool),
		leftActiveAt: make(map[string]time.Time),
		now:          time.Now,
	}
}

// restartWindow 是「離開 active 後多久內回到 active 判定為 restarted」的窗口。
const restartWindow = 5 * time.Second

// Transition 依狀態機規則判定「立即要發送」的事件。
// 第二回傳值 pendingStop：當服務離開 active 進入 inactive/dead 時為 true，
// 由 Notifier 在延遲窗口過後確認未回到 active 再發 stopped（避免 restart 誤報 stopped）。
func (sm *stateMachine) Transition(name, active string) (*Event, bool) {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	prev := sm.prevActive[name]
	if active == prev {
		return nil, false
	}

	now := sm.now()
	wasRunning := sm.running[name]
	var ev *Event
	pendingStop := false

	switch active {
	case "failed":
		ev = &Event{Kind: EventFailed, Service: name, Status: active, Timestamp: now}
		sm.running[name] = false
		delete(sm.leftActiveAt, name)
	case "active":
		if !wasRunning {
			leftAt := sm.leftActiveAt[name]
			if !leftAt.IsZero() && now.Sub(leftAt) <= restartWindow {
				ev = &Event{Kind: EventRestarted, Service: name, Status: active, Timestamp: now}
			} else {
				ev = &Event{Kind: EventStarted, Service: name, Status: active, Timestamp: now}
			}
		}
		sm.running[name] = true
		delete(sm.leftActiveAt, name)
	case "inactive", "dead":
		if wasRunning {
			if sm.leftActiveAt[name].IsZero() {
				sm.leftActiveAt[name] = now
			}
			pendingStop = true
		}
		sm.running[name] = false
	case "deactivating":
		if wasRunning {
			sm.leftActiveAt[name] = now
		}
		// running 維持 true（仍算 active 直到進入 inactive/dead）
	case "activating", "reloading":
		// 過渡狀態：running 不變
	}

	sm.prevActive[name] = active
	return ev, pendingStop
}

// snapshot 回傳服務目前的語意 running 狀態與 raw ActiveState（供延遲 stopped 判定）。
func (sm *stateMachine) snapshot(name string) (running bool, status string) {
	sm.mu.Lock()
	defer sm.mu.Unlock()
	return sm.running[name], sm.prevActive[name]
}

// containsEvent 判斷 events 清單是否包含指定事件。
func containsEvent(events []string, kind string) bool {
	for _, e := range events {
		if e == kind {
			return true
		}
	}
	return false
}

// matchesService 判斷服務範圍是否匹配：all_services=true 恆匹配；否則精確相等比對。
func matchesService(ch *Channel, service string) bool {
	if ch.AllServices {
		return true
	}
	for _, s := range ch.Services {
		if s == service {
			return true
		}
	}
	return false
}
