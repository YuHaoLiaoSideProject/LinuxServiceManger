package notify

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func testEvent(kind EventKind, service string) Event {
	return Event{
		Kind:      kind,
		Service:   service,
		Status:    string(kind),
		Timestamp: time.Date(2025, 8, 9, 12, 0, 0, 0, time.UTC),
	}
}

func decodeBody(t *testing.T, body []byte) map[string]interface{} {
	t.Helper()
	var m map[string]interface{}
	if err := json.Unmarshal(body, &m); err != nil {
		t.Fatalf("body is not valid JSON: %v\n%s", err, string(body))
	}
	return m
}

// SYS-01: Slack payload 格式正確
func TestBuildSlackPayload(t *testing.T) {
	ch := &Channel{Type: ChannelTypeSlack, URL: "https://hooks.slack.com/services/x"}
	ev := testEvent(EventFailed, "nginx.service")

	body, ct, err := BuildPayload(ch, ev)
	if err != nil {
		t.Fatalf("BuildPayload error: %v", err)
	}
	if ct != "application/json" {
		t.Errorf("expected application/json, got %q", ct)
	}

	m := decodeBody(t, body)
	if m["text"] != "🔔 Linux Service Manager" {
		t.Errorf("unexpected text: %v", m["text"])
	}
	atts, ok := m["attachments"].([]interface{})
	if !ok || len(atts) != 1 {
		t.Fatalf("expected 1 attachment, got %#v", m["attachments"])
	}
	a := atts[0].(map[string]interface{})
	if a["color"] != "danger" {
		t.Errorf("expected color danger, got %v", a["color"])
	}
	if a["title"] != "nginx.service failed" {
		t.Errorf("unexpected title: %v", a["title"])
	}
	if !strings.Contains(a["text"].(string), "🔴 failed ⏱ 2025-08-09T12:00:00Z") {
		t.Errorf("unexpected text: %v", a["text"])
	}
}

// SYS-02: Slack color 對應 4 種事件
func TestSlackColors(t *testing.T) {
	cases := []struct {
		kind  EventKind
		color string
	}{
		{EventStarted, "good"},
		{EventStopped, "warning"},
		{EventFailed, "danger"},
		{EventRestarted, "warning"},
	}
	for _, c := range cases {
		ch := &Channel{Type: ChannelTypeSlack}
		body, _, err := BuildPayload(ch, testEvent(c.kind, "nginx.service"))
		if err != nil {
			t.Fatalf("BuildPayload(%s): %v", c.kind, err)
		}
		m := decodeBody(t, body)
		atts := m["attachments"].([]interface{})
		if atts[0].(map[string]interface{})["color"] != c.color {
			t.Errorf("event %s: expected color %s, got %v", c.kind, c.color, atts[0].(map[string]interface{})["color"])
		}
	}
}

// SYS-03: Discord embed 格式 + color 十進位
func TestBuildDiscordPayload(t *testing.T) {
	ch := &Channel{Type: ChannelTypeDiscord}
	ev := testEvent(EventFailed, "nginx.service")

	body, _, err := BuildPayload(ch, ev)
	if err != nil {
		t.Fatalf("BuildPayload: %v", err)
	}
	m := decodeBody(t, body)
	if m["username"] != "Linux Service Manager" {
		t.Errorf("unexpected username: %v", m["username"])
	}
	embeds := m["embeds"].([]interface{})
	e := embeds[0].(map[string]interface{})
	if e["title"] != "nginx.service failed" {
		t.Errorf("unexpected title: %v", e["title"])
	}
	if e["color"] != float64(16711680) {
		t.Errorf("expected color 16711680, got %v", e["color"])
	}
	if e["timestamp"] != "2025-08-09T12:00:00Z" {
		t.Errorf("unexpected timestamp: %v", e["timestamp"])
	}
}

// SYS-04: Discord color 3 種狀態值
func TestDiscordColors(t *testing.T) {
	cases := []struct {
		kind  EventKind
		color float64
	}{
		{EventStarted, 65280},
		{EventStopped, 16753920},
		{EventFailed, 16711680},
	}
	for _, c := range cases {
		ch := &Channel{Type: ChannelTypeDiscord}
		body, _, _ := BuildPayload(ch, testEvent(c.kind, "nginx.service"))
		m := decodeBody(t, body)
		embeds := m["embeds"].([]interface{})
		if embeds[0].(map[string]interface{})["color"] != c.color {
			t.Errorf("event %s: expected color %v, got %v", c.kind, c.color, embeds[0].(map[string]interface{})["color"])
		}
	}
}

// SYS-05: Telegram 授權與參數格式
func TestBuildTelegramPayload(t *testing.T) {
	ch := &Channel{Type: ChannelTypeTelegram, Token: "123456789:AA...", ChatID: "123456789"}
	ev := testEvent(EventFailed, "nginx.service")

	body, ct, err := BuildPayload(ch, ev)
	if err != nil {
		t.Fatalf("BuildPayload: %v", err)
	}
	if ct != "application/json" {
		t.Errorf("expected application/json, got %q", ct)
	}
	m := decodeBody(t, body)
	if m["chat_id"] != "123456789" {
		t.Errorf("unexpected chat_id: %v", m["chat_id"])
	}
	if !strings.Contains(m["text"].(string), "nginx.service failed") {
		t.Errorf("unexpected text: %v", m["text"])
	}
}

// SYS-06: 自訂 Webhook JSON payload
func TestBuildCustomPayload(t *testing.T) {
	ch := &Channel{Type: ChannelTypeCustom, Method: "POST"}
	ev := testEvent(EventFailed, "nginx.service")

	body, _, err := BuildPayload(ch, ev)
	if err != nil {
		t.Fatalf("BuildPayload: %v", err)
	}
	m := decodeBody(t, body)
	if m["event"] != "failed" {
		t.Errorf("unexpected event: %v", m["event"])
	}
	if m["service"] != "nginx.service" {
		t.Errorf("unexpected service: %v", m["service"])
	}
	if m["status"] != "failed" {
		t.Errorf("unexpected status: %v", m["status"])
	}
	if m["timestamp"] != "2025-08-09T12:00:00Z" {
		t.Errorf("unexpected timestamp: %v", m["timestamp"])
	}
}

// SYS-09/10: payload 僅含服務摘要不含完整 log
func TestPayloadContainsNoLog(t *testing.T) {
	ev := testEvent(EventFailed, "nginx.service")
	for _, ct := range []ChannelType{ChannelTypeSlack, ChannelTypeDiscord, ChannelTypeTelegram, ChannelTypeCustom} {
		ch := &Channel{Type: ct, Token: "123456789:AA...", ChatID: "1"}
		body, _, err := BuildPayload(ch, ev)
		if err != nil {
			t.Fatalf("BuildPayload(%s): %v", ct, err)
		}
		if strings.Contains(string(body), "journal") || strings.Contains(string(body), "log line") {
			t.Errorf("payload for %s should not contain log content", ct)
		}
	}
}

// 測試訊息
func TestBuildTestMessage(t *testing.T) {
	ch := &Channel{Type: ChannelTypeSlack}
	ev := testEvent(EventTest, "")
	body, _, err := BuildPayload(ch, ev)
	if err != nil {
		t.Fatalf("BuildPayload test: %v", err)
	}
	if !strings.Contains(string(body), TestNotificationMessage) {
		t.Errorf("expected test message in body, got %s", string(body))
	}
}
