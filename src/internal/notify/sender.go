package notify

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
)

// Sender 執行通知 HTTP 發送（決策 3 方案 A）。
type Sender struct {
	client        *http.Client // &http.Client{Timeout: 10 * time.Second}
	store         *ChannelStore
	history       *History
	onAutoDisable func(ch *Channel) // 自動停用回呼（由 notifier 註冊，推送 WS）
}

// NewSender 建立 Sender。
func NewSender(store *ChannelStore, history *History) *Sender {
	return &Sender{
		client:  &http.Client{Timeout: 10 * time.Second},
		store:   store,
		history: history,
	}
}

// SendBatch 對每個匹配 channel 啟動 goroutine 並行發送，wg.Wait() 等待全部完成。
func (s *Sender) SendBatch(ev Event, channels []*Channel) {
	var wg sync.WaitGroup
	for _, ch := range channels {
		wg.Add(1)
		go func(ch *Channel) {
			defer wg.Done()
			start := time.Now()
			ok, detail := s.sendWithRetry(ch, ev)
			s.recordResult(ch, ev, ok, detail, time.Since(start))
			if !ok {
				if _, autoDisabled, err := s.store.IncrFailures(ch.ID); err == nil && autoDisabled {
					if s.onAutoDisable != nil {
						s.onAutoDisable(ch)
					}
				}
			} else {
				s.store.ResetFailures(ch.ID)
			}
		}(ch)
	}
	wg.Wait()
}

// sendWithRetry 執行「初發 + retry 1 次」。
func (s *Sender) sendWithRetry(ch *Channel, ev Event) (bool, string) {
	body, contentType, err := BuildPayload(ch, ev)
	if err != nil {
		return false, "payload 建構失敗: " + err.Error()
	}
	var lastDetail string
	for attempt := 0; attempt < 2; attempt++ {
		ok, detail := s.sendOnce(ch, body, contentType)
		if ok {
			return true, ""
		}
		lastDetail = detail
		if attempt == 0 {
			log.Printf("NOTIFY: %s attempt 1 failed (%s) — retrying once", ch.Name, detail)
		}
	}
	return false, lastDetail
}

// sendOnce 依 channel 類型組裝請求並發送。
func (s *Sender) sendOnce(ch *Channel, body []byte, contentType string) (bool, string) {
	url := ch.URL
	method := http.MethodPost
	switch ch.Type {
	case ChannelTypeTelegram:
		url = "https://api.telegram.org/bot" + ch.Token + "/sendMessage"
		method = http.MethodPost
	case ChannelTypeCustom:
		method = ch.Method
		if method == "" {
			method = http.MethodPost
		}
	}

	req, err := http.NewRequest(method, url, bytes.NewReader(body))
	if err != nil {
		return false, err.Error()
	}
	req.Header.Set("Content-Type", contentType)

	if ch.Type == ChannelTypeCustom {
		for k, v := range ch.Headers {
			if IsBlacklistedHeader(k) {
				continue
			}
			req.Header.Set(k, v)
		}
	}

	resp, err := s.client.Do(req)
	if err != nil {
		low := strings.ToLower(err.Error())
		if os.IsTimeout(err) || strings.Contains(low, "timeout") || strings.Contains(low, "deadline") || strings.Contains(low, "exceeded") {
			return false, "連線逾時：" + err.Error()
		}
		return false, err.Error()
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		detail := fmt.Sprintf("HTTP %d", resp.StatusCode)
		if resp.StatusCode == http.StatusTooManyRequests {
			detail += fmt.Sprintf("（Telegram 速率限制，retry_after: %s）", resp.Header.Get("Retry-After"))
		}
		return false, detail
	}

	if ch.Type == ChannelTypeTelegram {
		bodyBytes, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
		var tr struct {
			OK          bool   `json:"ok"`
			Description string `json:"description"`
		}
		if err := json.Unmarshal(bodyBytes, &tr); err == nil && !tr.OK {
			detail := tr.Description
			if detail == "" {
				detail = "Telegram 回覆 ok:false"
			}
			if resp.StatusCode == http.StatusTooManyRequests {
				detail += fmt.Sprintf("（retry_after: %s）", resp.Header.Get("Retry-After"))
			}
			return false, detail
		}
	}

	return true, ""
}

// recordResult 寫入 history（success/failure + error detail + duration_ms 含 retry）。
func (s *Sender) recordResult(ch *Channel, ev Event, ok bool, detail string, dur time.Duration) {
	ms := dur.Milliseconds()
	if ms <= 0 {
		ms = 1 // 確保 duration_ms > 0（極快請求亦記錄耗時）
	}
	entry := HistoryEntry{
		Timestamp:   time.Now().UTC().Format(time.RFC3339),
		ChannelID:   ch.ID,
		ChannelName: ch.Name,
		ChannelType: string(ch.Type),
		Event:       string(ev.Kind),
		Service:     ev.Service,
		Status:      "success",
		DurationMs:  ms,
	}
	if !ok {
		entry.Status = "failure"
		entry.Error = detail
	}
	s.history.Write(entry)
}
