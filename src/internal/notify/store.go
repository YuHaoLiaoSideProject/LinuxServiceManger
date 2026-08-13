// Package notify implements webhook notification channels and delivery.
package notify

import (
	"crypto/rand"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"sync"
	"time"
)

// ============================================================
//  Types & constants
// ============================================================

// ChannelType 是通知 Channel 的類型。
type ChannelType string

const (
	ChannelTypeSlack    ChannelType = "slack"
	ChannelTypeDiscord  ChannelType = "discord"
	ChannelTypeTelegram ChannelType = "telegram"
	ChannelTypeCustom   ChannelType = "custom"
)

const (
	// MaxChannels 是 channel 總數上限（決策 8）。
	MaxChannels = 20
	// MaxConsecutiveFailures 是自動停用閾值（決策 5）。
	MaxConsecutiveFailures = 10
	// MaxCustomHeaders 是自訂 Webhook headers 數量上限（決策 4）。
	MaxCustomHeaders = 10
	// AutoDisabledReason 是連續失敗自動停用時填入的原因。
	AutoDisabledReason = "連續失敗 10 次自動停用"
)

// headerBlacklist 是自訂 Webhook 不可覆寫的 hop-by-hop header（決策 4）。
var headerBlacklist = map[string]bool{
	"host":              true,
	"content-length":    true,
	"transfer-encoding": true,
	"connection":        true,
}

// IsBlacklistedHeader 判斷 header key 是否為黑名單（大小寫不敏感）。
func IsBlacklistedHeader(key string) bool {
	return headerBlacklist[strings.ToLower(key)]
}

// EventKind 是觸發事件的種類（對應 systemd 狀態變更語意）。
type EventKind string

const (
	EventStarted   EventKind = "started"
	EventStopped   EventKind = "stopped"
	EventFailed    EventKind = "failed"
	EventRestarted EventKind = "restarted"
	EventTest      EventKind = "test" // test endpoint 專用
)

// AllEventKinds 是合法觸發事件集合（驗證用；reloaded 不在內）。
var AllEventKinds = []EventKind{EventStarted, EventStopped, EventFailed, EventRestarted}

// Channel 是一筆通知 Channel 設定（決策 8 資料模型）。
// failures 為 in-memory counter，不序列化（`json:"-"`）。
type Channel struct {
	ID                 string            `json:"id"`                              // UUID（crypto/rand）
	Type               ChannelType       `json:"type"`
	Name               string            `json:"name"`                            // 顯示名稱（必填，1-64 字元）
	URL                string            `json:"url,omitempty"`                   // Slack/Discord/custom 的 webhook URL；telegram 為空
	Token              string            `json:"token,omitempty"`                 // Telegram bot token（僅 telegram；API 回應 masked）
	ChatID             string            `json:"chat_id,omitempty"`               // Telegram chat id（僅 telegram）
	Method             string            `json:"method,omitempty"`                // custom：POST/PUT，預設 POST
	Headers            map[string]string `json:"headers,omitempty"`               // custom：≤10 組 key-value
	Events             []string          `json:"events"`                          // ⊆ started/stopped/failed/restarted，≥1
	AllServices        bool              `json:"all_services"`                    // true=全部服務
	Services           []string          `json:"services,omitempty"`              // 指定服務（systemd unit name 精確匹配）
	Enabled            bool              `json:"enabled"`                         // toggle
	AutoDisabledReason string            `json:"auto_disabled_reason,omitempty"`  // 連續失敗 10 次停用的原因
	CreatedAt          string            `json:"created_at"`                      // RFC3339 UTC
	UpdatedAt          string            `json:"updated_at"`
	failures           int               `json:"-"`                               // in-memory 連續失敗計數
}

// Errors
var (
	ErrChannelNotFound = fmt.Errorf("channel not found")
	ErrChannelLimit    = fmt.Errorf("已達 Channel 數量上限（20）")
)

// ============================================================
//  ChannelStore
// ============================================================

// ChannelStore 管理 notify.json 的載入/atomic save/CRUD，全以 RWMutex 保護。
type ChannelStore struct {
	mu       sync.RWMutex
	filePath string
	channels map[string]*Channel // key = ID
}

// NewStore 建立 ChannelStore（不載入；呼叫端需先 Load）。
func NewStore(filePath string) *ChannelStore {
	return &ChannelStore{
		filePath: filePath,
		channels: make(map[string]*Channel),
	}
}

// Load 讀取 notify.json；檔案不存在 → 空 map（不 crash，仿 token.Store.Load）。
func (s *ChannelStore) Load() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	data, err := os.ReadFile(s.filePath)
	if os.IsNotExist(err) {
		s.channels = make(map[string]*Channel)
		return nil
	}
	if err != nil {
		return fmt.Errorf("failed to read channel store: %w", err)
	}

	if len(data) == 0 {
		s.channels = make(map[string]*Channel)
		return nil
	}

	channels := make(map[string]*Channel)
	if err := json.Unmarshal(data, &channels); err != nil {
		return fmt.Errorf("failed to parse channel store: %w", err)
	}
	s.channels = channels
	return nil
}

// save 以 temp + rename atomic write 寫入（0600，仿 token.Store.save）。
func (s *ChannelStore) save() error {
	data, err := json.MarshalIndent(s.channels, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal channels: %w", err)
	}

	if dir := dirOfPath(s.filePath); dir != "" {
		if err := os.MkdirAll(dir, 0755); err != nil {
			return fmt.Errorf("failed to create directory %s: %w", dir, err)
		}
	}

	tmpPath := s.filePath + ".tmp"
	if err := os.WriteFile(tmpPath, data, 0600); err != nil {
		return err
	}
	return os.Rename(tmpPath, s.filePath)
}

// List 回傳所有 channel 的深拷貝（避免外部改動內部狀態）。
func (s *ChannelStore) List() []*Channel {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]*Channel, 0, len(s.channels))
	for _, ch := range s.channels {
		out = append(out, cloneChannel(ch))
	}
	return out
}

// Get 依 ID 取得 channel；不存在回 nil。
func (s *ChannelStore) Get(id string) *Channel {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.channels[id]
}

// Count 回傳 channel 總數（上限檢查用）。
func (s *ChannelStore) Count() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return len(s.channels)
}

// Create 建立 channel：產生 UUID id、填入 created_at/updated_at（RFC3339 UTC）。
// 已達 MaxChannels 上限 → 回 ErrChannelLimit。成功後 save()。
func (s *ChannelStore) Create(ch *Channel) (*Channel, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if len(s.channels) >= MaxChannels {
		return nil, ErrChannelLimit
	}

	now := nowRFC3339()
	ch.ID = newUUID()
	ch.CreatedAt = now
	ch.UpdatedAt = now

	s.channels[ch.ID] = ch
	if err := s.save(); err != nil {
		delete(s.channels, ch.ID)
		return nil, fmt.Errorf("failed to save channel: %w", err)
	}
	return ch, nil
}

// Update 覆寫完整設定：updated_at 刷新、failures 歸零、auto_disabled_reason 清空（決策 8：更新即重置）。
func (s *ChannelStore) Update(ch *Channel) (*Channel, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if ch == nil || ch.ID == "" {
		return nil, ErrChannelNotFound
	}
	if _, ok := s.channels[ch.ID]; !ok {
		return nil, ErrChannelNotFound
	}

	ch.UpdatedAt = nowRFC3339()
	ch.failures = 0
	ch.AutoDisabledReason = ""

	s.channels[ch.ID] = ch
	if err := s.save(); err != nil {
		return nil, fmt.Errorf("failed to save channel: %w", err)
	}
	return ch, nil
}

// Delete 移除 channel；關聯發送紀錄保留（history 存 channel_name 快照）。
func (s *ChannelStore) Delete(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if _, ok := s.channels[id]; !ok {
		return ErrChannelNotFound
	}
	delete(s.channels, id)
	return s.save()
}

// SetEnabled 更新 enabled 狀態並 save()。設為 true 時 failures 歸零、
// auto_disabled_reason 清空（決策 5 手動 re-enable 恢復路徑）。
func (s *ChannelStore) SetEnabled(id string, enabled bool) (*Channel, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	ch, ok := s.channels[id]
	if !ok {
		return nil, ErrChannelNotFound
	}
	ch.Enabled = enabled
	ch.UpdatedAt = nowRFC3339()
	if enabled {
		ch.failures = 0
		ch.AutoDisabledReason = ""
	}
	if err := s.save(); err != nil {
		return nil, fmt.Errorf("failed to save channel: %w", err)
	}
	return ch, nil
}

// IncrFailures 累加連續失敗計數；達 MaxConsecutiveFailures 時自動停用：
// enabled=false、auto_disabled_reason 填入並立即 save() 持久化。
// 回傳 (channel, autoDisabled bool) — 供 notifier 觸發 WS 推送。
func (s *ChannelStore) IncrFailures(id string) (*Channel, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	ch, ok := s.channels[id]
	if !ok {
		return nil, false, ErrChannelNotFound
	}
	ch.failures++
	if ch.failures >= MaxConsecutiveFailures {
		ch.Enabled = false
		ch.AutoDisabledReason = AutoDisabledReason
		ch.UpdatedAt = nowRFC3339()
		if err := s.save(); err != nil {
			return ch, true, fmt.Errorf("failed to save channel: %w", err)
		}
		return ch, true, nil
	}
	return ch, false, nil
}

// ResetFailures 成功時歸零 counter（不寫檔 — 記憶體操作）。
func (s *ChannelStore) ResetFailures(id string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if ch, ok := s.channels[id]; ok {
		ch.failures = 0
	}
}

// ============================================================
//  Helpers
// ============================================================

func cloneChannel(ch *Channel) *Channel {
	if ch == nil {
		return nil
	}
	c := *ch
	if ch.Headers != nil {
		c.Headers = make(map[string]string, len(ch.Headers))
		for k, v := range ch.Headers {
			c.Headers[k] = v
		}
	}
	if ch.Events != nil {
		c.Events = append([]string(nil), ch.Events...)
	}
	if ch.Services != nil {
		c.Services = append([]string(nil), ch.Services...)
	}
	return &c
}

func nowRFC3339() string {
	return time.Now().UTC().Format(time.RFC3339)
}

// newUUID 以 crypto/rand 產生 UUID v4（零新依賴）。
func newUUID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		// crypto/rand 極少失敗；fallback 至時間戳以保證可用
		return fmt.Sprintf("%d", time.Now().UnixNano())
	}
	b[6] = (b[6] & 0x0f) | 0x40 // version 4
	b[8] = (b[8] & 0x3f) | 0x80 // variant 10
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

func dirOfPath(path string) string {
	for i := len(path) - 1; i >= 0; i-- {
		if path[i] == '/' {
			return path[:i]
		}
	}
	return ""
}
