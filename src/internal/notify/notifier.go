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
	store   *ChannelStore
	history *History
	sender  *Sender
	hub     *websocket.Hub
	sm      *stateMachine
	cfg     Config
	done    chan struct{}
	wg      sync.WaitGroup

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
		store:   store,
		history: history,
		sender:  sender,
		hub:     cfg.Hub,
		sm:      newStateMachine(),
		cfg:     cfg,
		done:    make(chan struct{}),
	}
	sender.onAutoDisable = n.notifyChannelDisabled
	return n
}

// Load 載入 channel store（必須在 hub.OnStatusChange 註冊前完成；決策 7）。
func (n *Notifier) Load() error { return n.store.Load() }

// HandleStatusChange 是 hub.OnStatusChange 的回呼實作（同步快速路徑）。
func (n *Notifier) HandleStatusChange(name, active, sub string) {
	ev := n.sm.Transition(name, active)
	if ev == nil {
		return
	}

	var matched []*Channel
	for _, ch := range n.store.List() {
		if !ch.Enabled {
			continue
		}
		if !containsEvent(ch.Events, string(ev.Kind)) {
			continue
		}
		if !matchesService(ch, name) {
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
		n.sender.SendBatch(*ev, matched)
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

// stateMachine 將 raw ActiveState 轉換為 4 種觸發事件（決策 1 狀態機）。
type stateMachine struct {
	mu           sync.Mutex
	prevActive   map[string]string
	leftActiveAt map[string]time.Time // 記錄離開 active 的時間（restarted 判定用）
	now          func() time.Time
}

func newStateMachine() *stateMachine {
	return &stateMachine{
		prevActive:   make(map[string]string),
		leftActiveAt: make(map[string]time.Time),
		now:          time.Now,
	}
}

// Transition 依「狀態機轉換規則」判定事件；無觸發事件回 nil。
func (sm *stateMachine) Transition(name, active string) *Event {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	prev := sm.prevActive[name]
	if active == prev {
		return nil
	}

	now := sm.now()
	var ev *Event

	switch active {
	case "failed":
		ev = &Event{Kind: EventFailed, Service: name, Status: active, Timestamp: now}
	case "active":
		leftAt := sm.leftActiveAt[name]
		if (prev == "deactivating" || prev == "inactive" || prev == "dead") &&
			!leftAt.IsZero() && now.Sub(leftAt) <= 5*time.Second {
			ev = &Event{Kind: EventRestarted, Service: name, Status: active, Timestamp: now}
		} else {
			ev = &Event{Kind: EventStarted, Service: name, Status: active, Timestamp: now}
		}
	case "inactive", "dead":
		if prev == "active" {
			ev = &Event{Kind: EventStopped, Service: name, Status: active, Timestamp: now}
		}
	case "deactivating":
		sm.leftActiveAt[name] = now
	}

	sm.prevActive[name] = active
	return ev
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
