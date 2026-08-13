package notify

import (
	"encoding/json"
	"fmt"
	"strconv"
	"time"
)

// TestNotificationMessage 是 test endpoint 發送的測試訊息內容。
const TestNotificationMessage = "🧪 這是一筆來自 Linux Service Manager 的測試通知"

// Event 是通知觸發事件的標準化資料（由 notifier 狀態機產出或 test handler 建構）。
type Event struct {
	Kind      EventKind // started/stopped/failed/restarted/test
	Service   string    // nginx.service
	Status    string    // 目前 ActiveState（failed/inactive/active...）
	Timestamp time.Time // UTC
}

// payloadColors 是 Slack color / Discord 十進位 color 對照（決策 4）。
var payloadColors = map[EventKind]struct{ slack, discord string }{
	EventStarted:   {slack: "good", discord: "65280"},
	EventStopped:   {slack: "warning", discord: "16753920"},
	EventFailed:    {slack: "danger", discord: "16711680"},
	EventRestarted: {slack: "warning", discord: "16753920"},
}

// BuildPayload 依 channel 類型建構 HTTP body；另回傳 contentType。
func BuildPayload(ch *Channel, ev Event) (body []byte, contentType string, err error) {
	switch ch.Type {
	case ChannelTypeSlack:
		return buildSlackPayload(ev)
	case ChannelTypeDiscord:
		return buildDiscordPayload(ev)
	case ChannelTypeTelegram:
		return buildTelegramPayload(ch, ev)
	case ChannelTypeCustom:
		return buildCustomPayload(ev)
	}
	return nil, "", fmt.Errorf("unsupported channel type: %s", ch.Type)
}

// statusEmoji 依事件回傳狀態 emoji。
func statusEmoji(kind EventKind) string {
	switch kind {
	case EventStarted:
		return "🟢"
	case EventStopped:
		return "🟠"
	case EventFailed:
		return "🔴"
	case EventRestarted:
		return "🔁"
	default:
		return "🧪"
	}
}

// summaryText 回傳「<emoji> <kind> ⏱ <timestamp>」摘要；test 事件回傳測試訊息。
func summaryText(ev Event) string {
	if ev.Kind == EventTest {
		return TestNotificationMessage
	}
	return fmt.Sprintf("%s %s ⏱ %s", statusEmoji(ev.Kind), ev.Kind, ev.Timestamp.Format(time.RFC3339))
}

// eventTitle 回傳「<service> <kind>」標題；service 為空時僅回傳 kind。
func eventTitle(ev Event) string {
	if ev.Service == "" {
		return string(ev.Kind)
	}
	return ev.Service + " " + string(ev.Kind)
}

// buildSlackPayload：{"text":"🔔 Linux Service Manager","attachments":[{"color":...,"title":"...","text":"..."}]}
func buildSlackPayload(ev Event) ([]byte, string, error) {
	color := payloadColors[ev.Kind].slack
	if color == "" {
		color = "good"
	}
	payload := map[string]interface{}{
		"text": "🔔 Linux Service Manager",
		"attachments": []map[string]interface{}{
			{
				"color": color,
				"title": eventTitle(ev),
				"text":  summaryText(ev),
			},
		},
	}
	data, err := json.Marshal(payload)
	return data, "application/json", err
}

// buildDiscordPayload：color 為十進位整數（非 hex 字串）。
func buildDiscordPayload(ev Event) ([]byte, string, error) {
	color := payloadColors[ev.Kind].discord
	if color == "" {
		color = "65280"
	}
	n, err := strconv.Atoi(color)
	if err != nil {
		return nil, "", fmt.Errorf("invalid discord color: %w", err)
	}
	payload := map[string]interface{}{
		"username": "Linux Service Manager",
		"embeds": []map[string]interface{}{
			{
				"title":       eventTitle(ev),
				"description": summaryText(ev),
				"color":       n,
				"timestamp":   ev.Timestamp.Format(time.RFC3339),
			},
		},
	}
	data, err := json.Marshal(payload)
	return data, "application/json", err
}

// buildTelegramPayload：JSON body {"chat_id":"<ChatID>","text":"..."}。
// 當 SubChatID（forum topic 的 message_thread_id）非空時，附上 "message_thread_id"（整數）。
func buildTelegramPayload(ch *Channel, ev Event) ([]byte, string, error) {
	text := fmt.Sprintf("🔔 %s（%s）", eventTitle(ev), summaryText(ev))
	payload := map[string]interface{}{
		"chat_id": ch.ChatID,
		"text":    text,
	}
	if ch.SubChatID != "" {
		tid, err := strconv.ParseInt(ch.SubChatID, 10, 64)
		if err != nil {
			return nil, "", fmt.Errorf("invalid sub_chat_id: %w", err)
		}
		payload["message_thread_id"] = tid
	}
	data, err := json.Marshal(payload)
	return data, "application/json", err
}

// buildCustomPayload：JSON {"event","service","status","timestamp"}。
func buildCustomPayload(ev Event) ([]byte, string, error) {
	payload := map[string]interface{}{
		"event":     string(ev.Kind),
		"service":   ev.Service,
		"status":    ev.Status,
		"timestamp": ev.Timestamp.Format(time.RFC3339),
	}
	data, err := json.Marshal(payload)
	return data, "application/json", err
}
