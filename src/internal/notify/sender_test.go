package notify

// SYS-30 ~ SYS-41 sender 單元測試（docs/test-plans/013-webhook-notification測試計畫.md §2.4）
// 以 httptest.NewServer mock 目標平台；timeout 測試採白盒方式覆寫 Sender.client.Timeout。

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// roundTripFunc 讓 http.Client 的 Transport 可注入（Telegram URL 為後端固定，
// 無法指向 httptest，故以自訂 Transport 攔截請求並回傳假回應）。
type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func newTestSender(t *testing.T) (*Sender, *ChannelStore, *History, string) {
	t.Helper()
	dir := t.TempDir()
	store := NewStore(filepath.Join(dir, "notify.json"))
	if err := store.Load(); err != nil {
		t.Fatalf("store load: %v", err)
	}
	historyPath := filepath.Join(dir, "notify-history.jsonl")
	history := NewHistory(Config{HistoryPath: historyPath, RetentionDays: 30})
	return NewSender(store, history), store, history, historyPath
}

func newSenderChannel(t *testing.T, s *ChannelStore) *Channel {
	t.Helper()
	ch, err := s.Create(&Channel{
		Type:        ChannelTypeSlack,
		Name:        "測試 Channel",
		URL:         "https://hooks.slack.com/services/x",
		Events:      []string{string(EventFailed)},
		AllServices: true,
		Enabled:     true,
	})
	if err != nil {
		t.Fatalf("create channel: %v", err)
	}
	return ch
}

func readHistoryEntries(t *testing.T, path string) []HistoryEntry {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read history: %v", err)
	}
	var out []HistoryEntry
	for _, line := range strings.Split(strings.TrimSpace(string(data)), "\n") {
		if line == "" {
			continue
		}
		var e HistoryEntry
		if err := json.Unmarshal([]byte(line), &e); err != nil {
			t.Fatalf("history line is not valid JSON: %v\n%s", err, line)
		}
		out = append(out, e)
	}
	return out
}

// SYS-30: HTTP 2xx 判定成功，無重試
func TestSenderHTTP2xxSuccess(t *testing.T) {
	var count int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&count, 1)
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	sender, store, history, _ := newTestSender(t)
	defer history.Shutdown()
	ch := newSenderChannel(t, store)
	ch.URL = srv.URL

	ok, detail := sender.sendWithRetry(ch, testEvent(EventFailed, "nginx.service"))
	if !ok {
		t.Fatalf("expected success, got detail=%q", detail)
	}
	if atomic.LoadInt32(&count) != 1 {
		t.Errorf("expected 1 request (no retry on 2xx), got %d", atomic.LoadInt32(&count))
	}
}

// SYS-31: 非 2xx 判定失敗
func TestSenderNon2xxFailure(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	sender, store, history, _ := newTestSender(t)
	defer history.Shutdown()
	ch := newSenderChannel(t, store)
	ch.URL = srv.URL

	ok, detail := sender.sendWithRetry(ch, testEvent(EventFailed, "nginx.service"))
	if ok {
		t.Fatal("expected failure for non-2xx")
	}
	if !strings.Contains(detail, "500") {
		t.Errorf("expected detail to contain HTTP status 500, got %q", detail)
	}
}

// SYS-32: 逾時判定失敗（白盒覆寫 client.Timeout，避免跑滿 10 秒）
func TestSenderTimeout(t *testing.T) {
	var count int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&count, 1)
		time.Sleep(500 * time.Millisecond)
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	sender, store, history, _ := newTestSender(t)
	defer history.Shutdown()
	sender.client.Timeout = 100 * time.Millisecond // 白盒覆寫

	ch := newSenderChannel(t, store)
	ch.URL = srv.URL

	ok, detail := sender.sendWithRetry(ch, testEvent(EventFailed, "nginx.service"))
	if ok {
		t.Fatal("expected timeout failure")
	}
	low := strings.ToLower(detail)
	if !strings.Contains(low, "timeout") && !strings.Contains(low, "deadline") &&
		!strings.Contains(low, "exceeded") && !strings.Contains(detail, "逾時") {
		t.Errorf("expected timeout detail, got %q", detail)
	}
	// retry 也逾時 → 共 2 次請求（初發 + retry 1 次）
	if atomic.LoadInt32(&count) != 2 {
		t.Errorf("expected 2 requests (initial+retry both timeout), got %d", atomic.LoadInt32(&count))
	}
}

// SYS-33: 失敗後自動重試 1 次（第一次 500、第二次 200 → retry 成功）
func TestSenderRetryOnceThenSuccess(t *testing.T) {
	var count int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if atomic.AddInt32(&count, 1) == 1 {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	sender, store, history, _ := newTestSender(t)
	defer history.Shutdown()
	ch := newSenderChannel(t, store)
	ch.URL = srv.URL

	ok, _ := sender.sendWithRetry(ch, testEvent(EventFailed, "nginx.service"))
	if !ok {
		t.Fatal("expected retry to succeed")
	}
	if atomic.LoadInt32(&count) != 2 {
		t.Errorf("expected 2 requests, got %d", atomic.LoadInt32(&count))
	}
}

// SYS-34: 重試仍失敗 → 無第 3 次請求（共 2 次）
func TestSenderRetryThenFailNoThirdRequest(t *testing.T) {
	var count int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&count, 1)
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	sender, store, history, _ := newTestSender(t)
	defer history.Shutdown()
	ch := newSenderChannel(t, store)
	ch.URL = srv.URL

	ok, _ := sender.sendWithRetry(ch, testEvent(EventFailed, "nginx.service"))
	if ok {
		t.Fatal("expected failure after retry")
	}
	if atomic.LoadInt32(&count) != 2 {
		t.Errorf("expected exactly 2 requests (initial + 1 retry), got %d", atomic.LoadInt32(&count))
	}
}

// SYS-35: 多 channel 並行發送互不影響；各自獨立寫入紀錄
func TestSendBatchParallelIndependent(t *testing.T) {
	var aCount, bCount int32
	srvA := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&aCount, 1)
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srvA.Close()
	srvB := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&bCount, 1)
		w.WriteHeader(http.StatusOK)
	}))
	defer srvB.Close()

	sender, store, history, path := newTestSender(t)
	chA := newSenderChannel(t, store)
	chA.URL = srvA.URL
	chB := newSenderChannel(t, store)
	chB.URL = srvB.URL

	sender.SendBatch(testEvent(EventFailed, "nginx.service"), []*Channel{chA, chB})
	history.Shutdown()

	entries := readHistoryEntries(t, path)
	if len(entries) != 2 {
		t.Fatalf("expected 2 history entries, got %d", len(entries))
	}
	var success, failure int
	for _, e := range entries {
		switch e.Status {
		case "success":
			success++
		case "failure":
			failure++
			if e.Error == "" {
				t.Error("expected failure entry to carry error detail")
			}
		}
	}
	if success != 1 || failure != 1 {
		t.Errorf("expected 1 success + 1 failure, got %d/%d", success, failure)
	}
	// A 失敗重試 2 次、B 成功 1 次，互不影響
	if atomic.LoadInt32(&aCount) != 2 {
		t.Errorf("channel A expected 2 requests, got %d", atomic.LoadInt32(&aCount))
	}
	if atomic.LoadInt32(&bCount) != 1 {
		t.Errorf("channel B expected 1 request, got %d", atomic.LoadInt32(&bCount))
	}
}

// SYS-36: 20 個 channel 並行上限（無死鎖、全部完成）
func TestSendBatchTwentyChannels(t *testing.T) {
	var count int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&count, 1)
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	sender, store, history, path := newTestSender(t)
	var channels []*Channel
	for i := 0; i < MaxChannels; i++ {
		ch := newSenderChannel(t, store)
		ch.URL = srv.URL
		channels = append(channels, ch)
	}

	sender.SendBatch(testEvent(EventFailed, "nginx.service"), channels)
	history.Shutdown()

	if atomic.LoadInt32(&count) != MaxChannels {
		t.Errorf("expected %d requests, got %d", MaxChannels, atomic.LoadInt32(&count))
	}
	entries := readHistoryEntries(t, path)
	if len(entries) != MaxChannels {
		t.Errorf("expected %d history entries, got %d", MaxChannels, len(entries))
	}
}

// SYS-37: Telegram ok:false 視為失敗，description 帶入錯誤原因
func TestSenderTelegramOKFalse(t *testing.T) {
	var gotURL string
	sender, store, history, _ := newTestSender(t)
	defer history.Shutdown()
	sender.client.Transport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
		gotURL = r.URL.String()
		return &http.Response{
			StatusCode: http.StatusOK,
			Header:     http.Header{"Content-Type": []string{"application/json"}},
			Body:       io.NopCloser(strings.NewReader(`{"ok":false,"description":"Bad Request: chat not found"}`)),
		}, nil
	})

	ch := newSenderChannel(t, store)
	ch.Type = ChannelTypeTelegram
	ch.Token = "123456789:AA..."
	ch.ChatID = "123456789"

	ok, detail := sender.sendWithRetry(ch, testEvent(EventFailed, "nginx.service"))
	if ok {
		t.Fatal("expected failure for telegram ok:false")
	}
	if !strings.Contains(detail, "chat not found") {
		t.Errorf("expected description recorded in detail, got %q", detail)
	}
	if !strings.Contains(gotURL, "api.telegram.org/bot123456789:AA.../sendMessage") {
		t.Errorf("unexpected telegram URL: %s", gotURL)
	}
}

// SYS-38: Telegram ok:true 視為成功
func TestSenderTelegramOKTrue(t *testing.T) {
	sender, store, history, _ := newTestSender(t)
	defer history.Shutdown()
	sender.client.Transport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusOK,
			Header:     http.Header{"Content-Type": []string{"application/json"}},
			Body:       io.NopCloser(strings.NewReader(`{"ok":true}`)),
		}, nil
	})

	ch := newSenderChannel(t, store)
	ch.Type = ChannelTypeTelegram
	ch.Token = "123456789:AA..."
	ch.ChatID = "123456789"

	ok, _ := sender.sendWithRetry(ch, testEvent(EventFailed, "nginx.service"))
	if !ok {
		t.Fatal("expected success for telegram ok:true")
	}
}

// SYS-07/08: 自訂 Webhook method POST/PUT 與 headers 黑名單
func TestSenderCustomMethodAndHeaders(t *testing.T) {
	type captured struct {
		method string
		host   string
		header http.Header
	}

	for _, method := range []string{"POST", "PUT"} {
		c := make(chan captured, 1)
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			c <- captured{method: r.Method, host: r.Host, header: r.Header.Clone()}
			w.WriteHeader(http.StatusOK)
		}))

		sender, store, history, _ := newTestSender(t)
		ch := newSenderChannel(t, store)
		ch.Type = ChannelTypeCustom
		ch.Method = method
		ch.URL = srv.URL
		ch.Headers = map[string]string{
			"X-Custom":          "v1",
			"Authorization":     "Bearer xxx",
			"Host":              "evil.example.com",
			"Content-Length":    "999",
			"Transfer-Encoding": "chunked",
			"Connection":        "keep-alive-injected",
		}

		ok, _ := sender.sendWithRetry(ch, testEvent(EventFailed, "nginx.service"))
		cap := <-c
		if !ok {
			t.Fatalf("[%s] expected success", method)
		}
		if cap.method != method {
			t.Errorf("[%s] expected request method, got %s", method, cap.method)
		}
		// 白名單 header 帶入
		if cap.header.Get("X-Custom") != "v1" {
			t.Errorf("[%s] expected X-Custom header, got %q", method, cap.header.Get("X-Custom"))
		}
		if cap.header.Get("Authorization") != "Bearer xxx" {
			t.Errorf("[%s] expected Authorization header, got %q", method, cap.header.Get("Authorization"))
		}
		// 黑名單 header 不可覆寫
		if cap.host == "evil.example.com" {
			t.Errorf("[%s] Host header should not be overridden", method)
		}
		if cap.header.Get("Content-Length") == "999" {
			t.Errorf("[%s] Content-Length should be blacklisted", method)
		}
		if cap.header.Get("Transfer-Encoding") == "chunked" {
			t.Errorf("[%s] Transfer-Encoding should be blacklisted", method)
		}
		if cap.header.Get("Connection") == "keep-alive-injected" {
			t.Errorf("[%s] Connection should be blacklisted", method)
		}

		history.Shutdown()
		srv.Close()
	}
}

// SYS-39/40: 發送結果回寫 history（success/failure + error detail + duration_ms）
func TestSenderRecordsResult(t *testing.T) {
	srvOK := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer srvOK.Close()
	srvFail := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
	}))
	defer srvFail.Close()

	sender, store, history, path := newTestSender(t)
	chOK := newSenderChannel(t, store)
	chOK.URL = srvOK.URL
	chFail := newSenderChannel(t, store)
	chFail.URL = srvFail.URL

	sender.SendBatch(testEvent(EventFailed, "nginx.service"), []*Channel{chOK, chFail})
	history.Shutdown()

	entries := readHistoryEntries(t, path)
	byID := map[string]HistoryEntry{}
	for _, e := range entries {
		byID[e.ChannelID] = e
	}

	okEntry, exists := byID[chOK.ID]
	if !exists || okEntry.Status != "success" {
		t.Errorf("expected success entry for %s, got %+v", chOK.ID, okEntry)
	}
	if okEntry.DurationMs <= 0 {
		t.Errorf("expected duration_ms > 0 on success entry, got %d", okEntry.DurationMs)
	}

	failEntry, exists := byID[chFail.ID]
	if !exists || failEntry.Status != "failure" {
		t.Errorf("expected failure entry for %s, got %+v", chFail.ID, failEntry)
	}
	if !strings.Contains(failEntry.Error, "502") {
		t.Errorf("expected failure error to contain 502, got %q", failEntry.Error)
	}
}

// SYS-41: 背景失敗累計 counter、成功歸零
func TestSenderFailureCounterAccumulateAndReset(t *testing.T) {
	var count int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if atomic.AddInt32(&count, 1) <= 4 {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	sender, store, history, _ := newTestSender(t)
	defer history.Shutdown()
	ch := newSenderChannel(t, store)
	ch.URL = srv.URL
	ev := testEvent(EventFailed, "nginx.service")

	// 第 1 次失敗（含 retry 共 2 請求）→ failures=1
	sender.SendBatch(ev, []*Channel{ch})
	if got := store.Get(ch.ID).failures; got != 1 {
		t.Fatalf("after 1st failure expected failures=1, got %d", got)
	}
	// 第 2 次失敗 → failures=2
	sender.SendBatch(ev, []*Channel{ch})
	if got := store.Get(ch.ID).failures; got != 2 {
		t.Fatalf("after 2nd failure expected failures=2, got %d", got)
	}
	// 第 3 次成功 → failures=0
	sender.SendBatch(ev, []*Channel{ch})
	if got := store.Get(ch.ID).failures; got != 0 {
		t.Fatalf("after success expected failures=0, got %d", got)
	}
}
