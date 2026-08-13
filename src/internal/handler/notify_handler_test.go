package handler

// HDL-01 ~ HDL-28 notify handler 測試（docs/test-plans/013-webhook-notification測試計畫.md §2.7）
// 7 個 endpoint：channels CRUD + PATCH enabled + POST test + GET history + 401。
// 先寫測試（RED），再實作 notify_handler.go 使其轉綠。

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"linux-service-manager/internal/notify"

	"github.com/go-chi/chi/v5"
)

const validBotToken = "123456789:AA0BB1CC2DD3EE4FF5GG6HH7II8JJ9KK" // 格式 \d+:[A-Za-z0-9_-]{30,}

// ── helpers ──

func setupNotifyRouter(h *Handler) *chi.Mux {
	r := chi.NewRouter()
	r.Post("/api/v1/login", h.HandleLoginJSON)
	r.Group(func(r chi.Router) {
		r.Use(authMiddlewareJSON)
		r.Get("/api/v1/notify/channels", h.HandleListChannels)
		r.Post("/api/v1/notify/channels", h.HandleCreateChannel)
		r.Put("/api/v1/notify/channels/{id}", h.HandleUpdateChannel)
		r.Delete("/api/v1/notify/channels/{id}", h.HandleDeleteChannel)
		r.Patch("/api/v1/notify/channels/{id}", h.HandlePatchChannelEnabled)
		r.Post("/api/v1/notify/channels/{id}/test", h.HandleTestChannel)
		r.Get("/api/v1/notify/history", h.HandleNotifyHistory)
	})
	return r
}

func writeNotifyJSON(t *testing.T, path string, channels map[string]notify.Channel) {
	t.Helper()
	data, err := json.MarshalIndent(channels, "", "  ")
	if err != nil {
		t.Fatalf("marshal channels: %v", err)
	}
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatalf("write notify.json: %v", err)
	}
}

func writeNotifyHistoryJSONL(t *testing.T, path string, entries []notify.HistoryEntry) {
	t.Helper()
	var sb strings.Builder
	for _, e := range entries {
		b, err := json.Marshal(e)
		if err != nil {
			t.Fatalf("marshal history entry: %v", err)
		}
		sb.Write(b)
		sb.WriteByte('\n')
	}
	if err := os.WriteFile(path, []byte(sb.String()), 0o644); err != nil {
		t.Fatalf("write notify-history.jsonl: %v", err)
	}
}

// newNotifyHandlerSeeded 佈建 notify.json / notify-history.jsonl 後建立 Handler。
func newNotifyHandlerSeeded(t *testing.T, seedChannels map[string]notify.Channel, seedHistory []notify.HistoryEntry) (*Handler, *chi.Mux) {
	t.Helper()
	dir := t.TempDir()
	channelsPath := filepath.Join(dir, "notify.json")
	historyPath := filepath.Join(dir, "notify-history.jsonl")
	if seedChannels != nil {
		writeNotifyJSON(t, channelsPath, seedChannels)
	}
	if seedHistory != nil {
		writeNotifyHistoryJSONL(t, historyPath, seedHistory)
	}

	n := notify.New(notify.Config{
		ChannelsPath:  channelsPath,
		HistoryPath:   historyPath,
		RetentionDays: 30,
	})
	if err := n.Load(); err != nil {
		t.Fatalf("notify load: %v", err)
	}

	auditMod := newTestAuditModule(t)
	h := New(nil, &mockSystemd{}, auditMod, nil)
	h.Notify = n
	return h, setupNotifyRouter(h)
}

func listChannels(t *testing.T, router http.Handler, cookie *http.Cookie) []map[string]interface{} {
	t.Helper()
	w := doConfigReq(t, router, http.MethodGet, "/api/v1/notify/channels", "", cookie)
	body := assertJSON(t, w, http.StatusOK)
	data, ok := body["data"].([]interface{})
	if !ok {
		t.Fatalf("expected data array in response, got %#v", body)
	}
	out := make([]map[string]interface{}, 0, len(data))
	for _, item := range data {
		out = append(out, item.(map[string]interface{}))
	}
	return out
}

func historyTotal(t *testing.T, router http.Handler, cookie *http.Cookie) int {
	t.Helper()
	w := doConfigReq(t, router, http.MethodGet, "/api/v1/notify/history?page=1&limit=100", "", cookie)
	body := assertJSON(t, w, http.StatusOK)
	total, _ := body["total"].(float64)
	return int(total)
}

func waitNotifyHistoryTotal(t *testing.T, router http.Handler, cookie *http.Cookie, want int) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if historyTotal(t, router, cookie) >= want {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("history total never reached %d (last=%d)", want, historyTotal(t, router, cookie))
}

func channelEnabled(t *testing.T, router http.Handler, cookie *http.Cookie, id string) bool {
	t.Helper()
	for _, ch := range listChannels(t, router, cookie) {
		if ch["id"] == id {
			enabled, _ := ch["enabled"].(bool)
			return enabled
		}
	}
	t.Fatalf("channel %s not found", id)
	return false
}

// ── HDL-01: GET channels 回傳所有 channel（masked token、無 failures、含 enabled/reason）──

func TestNotifyListChannels(t *testing.T) {
	h, router := newNotifyHandlerSeeded(t, map[string]notify.Channel{
		"c-tg": {
			ID: "c-tg", Type: notify.ChannelTypeTelegram, Name: "TG",
			Token: validBotToken, ChatID: "123456789",
			Events: []string{"failed"}, AllServices: true, Enabled: true,
		},
		"c-sl": {
			ID: "c-sl", Type: notify.ChannelTypeSlack, Name: "SL",
			URL: "https://hooks.slack.com/services/x", Events: []string{"failed"},
			AllServices: true, Enabled: false, AutoDisabledReason: "連續失敗 10 次自動停用",
		},
	}, nil)
	_ = h
	cookie := loginCookie(t, router)

	channels := listChannels(t, router, cookie)
	if len(channels) != 2 {
		t.Fatalf("expected 2 channels, got %d", len(channels))
	}
	for _, ch := range channels {
		// 不輸出 failures 欄位
		if _, has := ch["failures"]; has {
			t.Errorf("channel %v should not expose failures", ch["id"])
		}
		// 停用 channel 含 auto_disabled_reason
		if ch["id"] == "c-sl" {
			if ch["enabled"] != false {
				t.Errorf("expected c-sl disabled, got %v", ch["enabled"])
			}
			if ch["auto_disabled_reason"] != "連續失敗 10 次自動停用" {
				t.Errorf("expected auto_disabled_reason, got %v", ch["auto_disabled_reason"])
			}
		}
		// Telegram token masked
		if ch["id"] == "c-tg" {
			if ch["token"] != "****J9KK" {
				t.Errorf("expected masked token ****J9KK, got %v", ch["token"])
			}
		}
	}
}

// ── HDL-02: POST 建立 channel 成功 ──

func TestNotifyCreateChannel(t *testing.T) {
	_, router := newNotifyHandlerSeeded(t, nil, nil)
	cookie := loginCookie(t, router)

	body := `{"type":"slack","name":"團隊 Slack","url":"https://hooks.slack.com/services/xxx","events":["failed"],"all_services":true}`
	w := doConfigReq(t, router, http.MethodPost, "/api/v1/notify/channels", body, cookie)
	if w.Code != http.StatusOK && w.Code != http.StatusCreated {
		t.Fatalf("expected 200/201, got %d: %s", w.Code, w.Body.String())
	}
	resp := assertJSON(t, w, w.Code)
	data, ok := resp["data"].(map[string]interface{})
	if !ok {
		t.Fatalf("expected data object, got %#v", resp)
	}
	if data["id"] == "" || data["id"] == nil {
		t.Error("expected generated UUID id")
	}
	if data["enabled"] != true {
		t.Errorf("expected new channel enabled=true, got %v", data["enabled"])
	}
}

// ── HDL-03 ~ HDL-10: POST 驗證 400 ──

func TestNotifyCreateValidation(t *testing.T) {
	longName := strings.Repeat("a", 65)
	cases := []struct {
		name string
		body string
	}{
		{"name 空", `{"type":"slack","name":"","url":"https://hooks.slack.com/services/x","events":["failed"],"all_services":true}`},
		{"缺 type", `{"name":"x","url":"https://hooks.slack.com/services/x","events":["failed"],"all_services":true}`},
		{"Slack 缺 url", `{"type":"slack","name":"x","events":["failed"],"all_services":true}`},
		{"name 超過 64", `{"type":"slack","name":"` + longName + `","url":"https://hooks.slack.com/services/x","events":["failed"],"all_services":true}`},
		{"type 非法", `{"type":"sms","name":"x","url":"https://hooks.slack.com/services/x","events":["failed"],"all_services":true}`},
		{"url 非 https", `{"type":"slack","name":"x","url":"http://example.com/hook","events":["failed"],"all_services":true}`},
		{"events 空", `{"type":"slack","name":"x","url":"https://hooks.slack.com/services/x","events":[],"all_services":true}`},
		{"events 含 reloaded", `{"type":"slack","name":"x","url":"https://hooks.slack.com/services/x","events":["reloaded"],"all_services":true}`},
		{"services 非法 unit name", `{"type":"slack","name":"x","url":"https://hooks.slack.com/services/x","events":["failed"],"all_services":false,"services":["nginx"]}`},
		{"custom headers 11 組", `{"type":"custom","name":"x","url":"https://example.com/hook","events":["failed"],"all_services":true,"headers":{"h1":"v","h2":"v","h3":"v","h4":"v","h5":"v","h6":"v","h7":"v","h8":"v","h9":"v","h10":"v","h11":"v"}}`},
		{"custom headers 黑名單 Host", `{"type":"custom","name":"x","url":"https://example.com/hook","events":["failed"],"all_services":true,"headers":{"Host":"evil"}}`},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			_, router := newNotifyHandlerSeeded(t, nil, nil)
			cookie := loginCookie(t, router)
			w := doConfigReq(t, router, http.MethodPost, "/api/v1/notify/channels", c.body, cookie)
			body := assertJSON(t, w, http.StatusBadRequest)
			if body["error"] == nil || body["error"] == "" {
				t.Errorf("expected error message, got %#v", body)
			}
		})
	}
}

// ── HDL-06: Telegram 型不需 url、需 bot token + chat_id ──

func TestNotifyCreateTelegram(t *testing.T) {
	_, router := newNotifyHandlerSeeded(t, nil, nil)
	cookie := loginCookie(t, router)

	body := fmt.Sprintf(`{"type":"telegram","name":"個人群組","token":%q,"chat_id":"123456789","events":["failed"],"all_services":true}`, validBotToken)
	w := doConfigReq(t, router, http.MethodPost, "/api/v1/notify/channels", body, cookie)
	if w.Code != http.StatusOK && w.Code != http.StatusCreated {
		t.Fatalf("expected telegram create success, got %d: %s", w.Code, w.Body.String())
	}
	resp := assertJSON(t, w, w.Code)
	if resp["data"] == nil {
		t.Fatalf("expected data, got %#v", resp)
	}
}

// ── HDL-11: 超過 20 個上限 ──

func TestNotifyCreateChannelLimit(t *testing.T) {
	seed := map[string]notify.Channel{}
	for i := 0; i < notify.MaxChannels; i++ {
		id := fmt.Sprintf("c-%02d", i)
		seed[id] = notify.Channel{
			ID: id, Type: notify.ChannelTypeSlack, Name: fmt.Sprintf("ch%d", i),
			URL: "https://hooks.slack.com/services/x", Events: []string{"failed"},
			AllServices: true, Enabled: true,
		}
	}
	_, router := newNotifyHandlerSeeded(t, seed, nil)
	cookie := loginCookie(t, router)

	body := `{"type":"slack","name":"第21個","url":"https://hooks.slack.com/services/x","events":["failed"],"all_services":true}`
	w := doConfigReq(t, router, http.MethodPost, "/api/v1/notify/channels", body, cookie)
	if w.Code != http.StatusBadRequest && w.Code != http.StatusConflict {
		t.Fatalf("expected 400/409 limit, got %d: %s", w.Code, w.Body.String())
	}
}

// ── HDL-12/14: PUT 更新成功 / 驗證失敗 ──

func TestNotifyUpdateChannel(t *testing.T) {
	_, router := newNotifyHandlerSeeded(t, map[string]notify.Channel{
		"c1": {ID: "c1", Type: notify.ChannelTypeSlack, Name: "舊名", URL: "https://hooks.slack.com/services/x", Events: []string{"failed"}, AllServices: true, Enabled: true},
	}, nil)
	cookie := loginCookie(t, router)

	body := `{"type":"slack","name":"新名","url":"https://hooks.slack.com/services/y","events":["started","failed"],"all_services":true}`
	w := doConfigReq(t, router, http.MethodPut, "/api/v1/notify/channels/c1", body, cookie)
	resp := assertJSON(t, w, http.StatusOK)
	data := resp["data"].(map[string]interface{})
	if data["name"] != "新名" {
		t.Errorf("expected updated name, got %v", data["name"])
	}

	// 驗證失敗
	w = doConfigReq(t, router, http.MethodPut, "/api/v1/notify/channels/c1", `{"type":"slack","name":"","url":"https://hooks.slack.com/services/y","events":["failed"],"all_services":true}`, cookie)
	assertJSON(t, w, http.StatusBadRequest)
}

// ── HDL-13: PUT 不存在回 404 ──

func TestNotifyUpdateNotFound(t *testing.T) {
	_, router := newNotifyHandlerSeeded(t, nil, nil)
	cookie := loginCookie(t, router)
	body := `{"type":"slack","name":"x","url":"https://hooks.slack.com/services/y","events":["failed"],"all_services":true}`
	w := doConfigReq(t, router, http.MethodPut, "/api/v1/notify/channels/nope", body, cookie)
	assertJSON(t, w, http.StatusNotFound)
}

// ── HDL-15/16: DELETE 成功（紀錄保留）/ 404 ──

func TestNotifyDeleteChannel(t *testing.T) {
	seedHistory := []notify.HistoryEntry{
		{Timestamp: time.Now().UTC().Format(time.RFC3339), ChannelID: "c1", ChannelName: "團隊 Slack", ChannelType: "slack", Event: "failed", Service: "nginx.service", Status: "failure", Error: "HTTP 500"},
	}
	_, router := newNotifyHandlerSeeded(t, map[string]notify.Channel{
		"c1": {ID: "c1", Type: notify.ChannelTypeSlack, Name: "團隊 Slack", URL: "https://hooks.slack.com/services/x", Events: []string{"failed"}, AllServices: true, Enabled: true},
	}, seedHistory)
	cookie := loginCookie(t, router)

	w := doConfigReq(t, router, http.MethodDelete, "/api/v1/notify/channels/c1", "", cookie)
	resp := assertJSON(t, w, http.StatusOK)
	if resp["message"] == nil || resp["message"] == "" {
		t.Errorf("expected delete message, got %#v", resp)
	}
	// channel 移除
	if len(listChannels(t, router, cookie)) != 0 {
		t.Error("expected channel removed")
	}
	// 紀錄保留
	if got := historyTotal(t, router, cookie); got != 1 {
		t.Errorf("expected 1 history entry preserved, got %d", got)
	}

	// 404
	w = doConfigReq(t, router, http.MethodDelete, "/api/v1/notify/channels/nope", "", cookie)
	assertJSON(t, w, http.StatusNotFound)
}

// ── HDL-17/18/19: PATCH enabled / body 格式 / 404 ──

func TestNotifyPatchEnabled(t *testing.T) {
	_, router := newNotifyHandlerSeeded(t, map[string]notify.Channel{
		"c1": {ID: "c1", Type: notify.ChannelTypeSlack, Name: "S", URL: "https://hooks.slack.com/services/x", Events: []string{"failed"}, AllServices: true, Enabled: true},
	}, nil)
	cookie := loginCookie(t, router)

	w := doConfigReq(t, router, http.MethodPatch, "/api/v1/notify/channels/c1", `{"enabled":false}`, cookie)
	resp := assertJSON(t, w, http.StatusOK)
	data := resp["data"].(map[string]interface{})
	if data["enabled"] != false {
		t.Errorf("expected disabled, got %v", data["enabled"])
	}

	// body 格式錯誤
	w = doConfigReq(t, router, http.MethodPatch, "/api/v1/notify/channels/c1", `{"foo":"bar"}`, cookie)
	assertJSON(t, w, http.StatusBadRequest)

	// 404
	w = doConfigReq(t, router, http.MethodPatch, "/api/v1/notify/channels/nope", `{"enabled":true}`, cookie)
	assertJSON(t, w, http.StatusNotFound)
}

// ── HDL-20: PATCH enabled=true 重置 auto_disabled_reason ──

func TestNotifyPatchReenableResetsReason(t *testing.T) {
	_, router := newNotifyHandlerSeeded(t, map[string]notify.Channel{
		"c1": {ID: "c1", Type: notify.ChannelTypeSlack, Name: "S", URL: "https://hooks.slack.com/services/x", Events: []string{"failed"}, AllServices: true, Enabled: false, AutoDisabledReason: "連續失敗 10 次自動停用"},
	}, nil)
	cookie := loginCookie(t, router)

	w := doConfigReq(t, router, http.MethodPatch, "/api/v1/notify/channels/c1", `{"enabled":true}`, cookie)
	resp := assertJSON(t, w, http.StatusOK)
	data := resp["data"].(map[string]interface{})
	if data["enabled"] != true {
		t.Errorf("expected enabled, got %v", data["enabled"])
	}
	if data["auto_disabled_reason"] != nil && data["auto_disabled_reason"] != "" {
		t.Errorf("expected reason cleared, got %v", data["auto_disabled_reason"])
	}
}

// ── HDL-21/22/23: POST test 成功（不污染 history）/ 失敗 502 / 404 ──

func TestNotifyTestChannelSuccess(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	_, router := newNotifyHandlerSeeded(t, map[string]notify.Channel{
		"c1": {ID: "c1", Type: notify.ChannelTypeSlack, Name: "S", URL: srv.URL, Events: []string{"failed"}, AllServices: true, Enabled: true},
	}, nil)
	cookie := loginCookie(t, router)

	w := doConfigReq(t, router, http.MethodPost, "/api/v1/notify/channels/c1/test", "", cookie)
	resp := assertJSON(t, w, http.StatusOK)
	if resp["success"] != true {
		t.Errorf("expected success:true, got %#v", resp)
	}
	// 不污染 history
	if got := historyTotal(t, router, cookie); got != 0 {
		t.Errorf("test should not write history, got %d entries", got)
	}
	// channel 仍啟用（不影響 failure counter → 不誤停用）
	if !channelEnabled(t, router, cookie, "c1") {
		t.Error("test should not affect channel enabled state")
	}
}

func TestNotifyTestChannelFailure(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusForbidden)
	}))
	defer srv.Close()

	_, router := newNotifyHandlerSeeded(t, map[string]notify.Channel{
		"c1": {ID: "c1", Type: notify.ChannelTypeSlack, Name: "S", URL: srv.URL, Events: []string{"failed"}, AllServices: true, Enabled: true},
	}, nil)
	cookie := loginCookie(t, router)

	w := doConfigReq(t, router, http.MethodPost, "/api/v1/notify/channels/c1/test", "", cookie)
	resp := assertJSON(t, w, http.StatusBadGateway)
	if resp["success"] != false {
		t.Errorf("expected success:false, got %#v", resp)
	}
	if !strings.Contains(fmt.Sprint(resp["error"]), "403") {
		t.Errorf("expected error detail containing 403, got %#v", resp)
	}
}

func TestNotifyTestChannelNotFound(t *testing.T) {
	_, router := newNotifyHandlerSeeded(t, nil, nil)
	cookie := loginCookie(t, router)
	w := doConfigReq(t, router, http.MethodPost, "/api/v1/notify/channels/nope/test", "", cookie)
	assertJSON(t, w, http.StatusNotFound)
}

// ── HDL-24: POST test 成功歸零 failures ──

func TestNotifyTestChannelResetsFailures(t *testing.T) {
	var mode int32 // 0=fail, 1=success
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if atomic.LoadInt32(&mode) == 1 {
			w.WriteHeader(http.StatusOK)
			return
		}
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	h, router := newNotifyHandlerSeeded(t, map[string]notify.Channel{
		"c1": {ID: "c1", Type: notify.ChannelTypeSlack, Name: "S", URL: srv.URL, Events: []string{"failed"}, AllServices: true, Enabled: true},
	}, nil)
	cookie := loginCookie(t, router)

	// 9 次背景失敗 → failures=9（未達停用閾值）
	for i := 0; i < 9; i++ {
		h.Notify.HandleStatusChange(fmt.Sprintf("app%d.service", i), "failed", "failed")
	}
	waitNotifyHistoryTotal(t, router, cookie, 9)
	if !channelEnabled(t, router, cookie, "c1") {
		t.Fatal("expected channel still enabled after 9 failures")
	}

	// 測試成功 → 歸零 failures
	atomic.StoreInt32(&mode, 1)
	w := doConfigReq(t, router, http.MethodPost, "/api/v1/notify/channels/c1/test", "", cookie)
	assertJSON(t, w, http.StatusOK)

	// 再 1 次背景失敗：若 test 未歸零則會達 10 次自動停用；歸零後僅 1 次仍啟用
	atomic.StoreInt32(&mode, 0)
	h.Notify.HandleStatusChange("extra.service", "failed", "failed")
	waitNotifyHistoryTotal(t, router, cookie, 10)
	if !channelEnabled(t, router, cookie, "c1") {
		t.Error("expected channel still enabled (failures was reset by test), got auto-disabled")
	}
}

// ── HDL-25: GET history 分頁 + 時間倒序 ──

func TestNotifyHistoryPagination(t *testing.T) {
	var entries []notify.HistoryEntry
	for i := 0; i < 45; i++ {
		entries = append(entries, notify.HistoryEntry{
			Timestamp:   time.Now().Add(time.Duration(-i) * time.Minute).UTC().Format(time.RFC3339),
			ChannelID:   "c1",
			ChannelName: "團隊 Slack",
			ChannelType: "slack",
			Event:       "failed",
			Service:     "nginx.service",
			Status:      "success",
		})
	}
	_, router := newNotifyHandlerSeeded(t, nil, entries)
	cookie := loginCookie(t, router)

	w := doConfigReq(t, router, http.MethodGet, "/api/v1/notify/history?page=2&limit=30", "", cookie)
	body := assertJSON(t, w, http.StatusOK)
	if body["total"] != float64(45) {
		t.Errorf("expected total 45, got %v", body["total"])
	}
	if body["page"] != float64(2) || body["limit"] != float64(30) {
		t.Errorf("expected page=2 limit=30, got page=%v limit=%v", body["page"], body["limit"])
	}
	data := body["data"].([]interface{})
	if len(data) != 15 {
		t.Errorf("expected 15 entries on page 2, got %d", len(data))
	}
	// 時間倒序
	first := data[0].(map[string]interface{})["timestamp"].(string)
	last := data[len(data)-1].(map[string]interface{})["timestamp"].(string)
	if first < last {
		t.Errorf("expected time-descending order, got first=%s last=%s", first, last)
	}
}

// ── HDL-26: GET history 篩選 ──

func TestNotifyHistoryFilter(t *testing.T) {
	now := time.Now().UTC()
	entries := []notify.HistoryEntry{
		{Timestamp: now.Format(time.RFC3339), ChannelID: "c1", ChannelName: "S", ChannelType: "slack", Event: "failed", Service: "nginx.service", Status: "success"},
		{Timestamp: now.Add(-time.Minute).Format(time.RFC3339), ChannelID: "c2", ChannelName: "D", ChannelType: "discord", Event: "failed", Service: "nginx.service", Status: "failure", Error: "HTTP 500"},
	}
	_, router := newNotifyHandlerSeeded(t, nil, entries)
	cookie := loginCookie(t, router)

	w := doConfigReq(t, router, http.MethodGet, "/api/v1/notify/history?channel_id=c2&status=failure", "", cookie)
	body := assertJSON(t, w, http.StatusOK)
	if body["total"] != float64(1) {
		t.Errorf("expected 1 filtered entry, got %v", body["total"])
	}
	data := body["data"].([]interface{})
	if data[0].(map[string]interface{})["channel_id"] != "c2" {
		t.Errorf("expected c2, got %v", data[0].(map[string]interface{})["channel_id"])
	}
}

// ── HDL-27: GET history 參數驗證 ──

func TestNotifyHistoryParamValidation(t *testing.T) {
	_, router := newNotifyHandlerSeeded(t, nil, nil)
	cookie := loginCookie(t, router)

	for _, q := range []string{"page=0", "limit=1000", "status=unknown"} {
		w := doConfigReq(t, router, http.MethodGet, "/api/v1/notify/history?"+q, "", cookie)
		assertJSON(t, w, http.StatusBadRequest)
	}
}

// ── HDL-28: 未登入 7 個 endpoint 全部 401 ──

func TestNotifyEndpointsRequireAuth(t *testing.T) {
	_, router := newNotifyHandlerSeeded(t, nil, nil)
	cases := []struct {
		method string
		path   string
		body   string
	}{
		{http.MethodGet, "/api/v1/notify/channels", ""},
		{http.MethodPost, "/api/v1/notify/channels", `{}`},
		{http.MethodPut, "/api/v1/notify/channels/1", `{}`},
		{http.MethodPatch, "/api/v1/notify/channels/1", `{"enabled":true}`},
		{http.MethodDelete, "/api/v1/notify/channels/1", ""},
		{http.MethodPost, "/api/v1/notify/channels/1/test", ""},
		{http.MethodGet, "/api/v1/notify/history", ""},
	}
	for _, c := range cases {
		w := doConfigReq(t, router, c.method, c.path, c.body, nil)
		if w.Code != http.StatusUnauthorized {
			t.Errorf("%s %s: expected 401, got %d", c.method, c.path, w.Code)
		}
	}
}
