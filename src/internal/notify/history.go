package notify

import (
	"bufio"
	"encoding/json"
	"log"
	"os"
	"sort"
	"sync"
	"time"
)

// HistoryEntry 是一筆通知發送紀錄（決策 8 資料模型）。
// channel_name 為快照 — channel 刪除後紀錄仍可顯示。
type HistoryEntry struct {
	Timestamp   string `json:"timestamp"`               // RFC3339 UTC
	ChannelID   string `json:"channel_id"`
	ChannelName string `json:"channel_name"`
	ChannelType string `json:"channel_type"`
	Event       string `json:"event"`                   // started/stopped/failed/restarted/test
	Service     string `json:"service"`                 // nginx.service
	Status      string `json:"status"`                  // success/failure
	Error       string `json:"error,omitempty"`         // 失敗原因
	DurationMs  int64  `json:"duration_ms"`             // 含 retry 的總耗時
}

// HistoryQuery 是發送紀錄查詢參數。
type HistoryQuery struct {
	Page      int    // ≥1
	Limit     int    // 1..100，預設 30
	ChannelID string // 選填；空 = 全部
	Status    string // all/success/failure；all（或空）不過濾
}

// HistoryResult 是分頁查詢結果（對齊 audit.QueryResult 慣例）。
type HistoryResult struct {
	Entries []HistoryEntry `json:"data"`
	Total   int            `json:"total"`
	Page    int            `json:"page"`
	Limit   int            `json:"limit"`
}

// History 管理 notify-history.jsonl 的異步寫入與查詢。
type History struct {
	cfg        Config
	ch         chan HistoryEntry
	done       chan struct{}
	wg         sync.WaitGroup
	mu         sync.Mutex
	writeCnt   int64
	shutdown   bool
	shutdownMu sync.RWMutex
}

// NewHistory 建立 History 並啟動 writer goroutine（仿 audit.New）。
func NewHistory(cfg Config) *History {
	cfg.defaults()

	if dir := dirOfPath(cfg.HistoryPath); dir != "" {
		if err := os.MkdirAll(dir, 0755); err != nil {
			log.Printf("NOTIFY WARNING: failed to create directory %s: %v", dir, err)
		}
	}

	h := &History{
		cfg:  cfg,
		ch:   make(chan HistoryEntry, cfg.WriteBufSize),
		done: make(chan struct{}),
	}
	h.wg.Add(1)
	go h.writerLoop()
	return h
}

// Write 非阻塞送交 writer goroutine；channel 滿則 drop + log warning（仿 audit.Write）。
func (h *History) Write(entry HistoryEntry) {
	select {
	case h.ch <- entry:
	default:
		log.Printf("NOTIFY WARNING: history buffer full, dropping entry: %+v", entry)
	}
}

// writerLoop 消費 channel 並以 JSONL 追加寫入。
func (h *History) writerLoop() {
	defer h.wg.Done()
	for {
		select {
		case entry := <-h.ch:
			h.appendEntry(entry)
			h.mu.Lock()
			h.writeCnt++
			cnt := h.writeCnt
			h.mu.Unlock()
			if cnt%10 == 0 {
				h.maybeCleanup()
			}
		case <-h.done:
			for {
				select {
				case entry := <-h.ch:
					h.appendEntry(entry)
				default:
					return
				}
			}
		}
	}
}

// appendEntry 將單筆 entry 序列化為一行 JSON 追加寫入。
func (h *History) appendEntry(entry HistoryEntry) {
	if entry.Timestamp == "" {
		entry.Timestamp = time.Now().UTC().Format(time.RFC3339)
	}

	f, err := os.OpenFile(h.cfg.HistoryPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		log.Printf("NOTIFY ERROR: failed to open history file: %v", err)
		return
	}
	defer f.Close()

	data, err := json.Marshal(entry)
	if err != nil {
		log.Printf("NOTIFY ERROR: failed to marshal history entry: %v", err)
		return
	}
	data = append(data, '\n')

	if _, err := f.Write(data); err != nil {
		log.Printf("NOTIFY ERROR: failed to write history entry: %v", err)
	}
}

// Shutdown 停止 writer goroutine 並 flush buffer（可重複呼叫）。
func (h *History) Shutdown() {
	h.shutdownMu.Lock()
	if h.shutdown {
		h.shutdownMu.Unlock()
		return
	}
	h.shutdown = true
	h.shutdownMu.Unlock()
	close(h.done)
	h.wg.Wait()
}

// Query 全檔掃描 → 過濾 → 時間倒序 → 分頁。
func (h *History) Query(params HistoryQuery) (HistoryResult, error) {
	if params.Page < 1 {
		params.Page = 1
	}
	if params.Limit < 1 {
		params.Limit = 30
	}
	if params.Limit > 100 {
		params.Limit = 100
	}

	entries, err := h.scanAndFilter(params)
	if err != nil {
		return HistoryResult{}, err
	}

	total := len(entries)

	start := (params.Page - 1) * params.Limit
	if start > len(entries) {
		start = len(entries)
	}
	end := start + params.Limit
	if end > len(entries) {
		end = len(entries)
	}

	pageEntries := entries[start:end]
	if pageEntries == nil {
		pageEntries = []HistoryEntry{}
	}

	return HistoryResult{
		Entries: pageEntries,
		Total:   total,
		Page:    params.Page,
		Limit:   params.Limit,
	}, nil
}

// maxHistoryScanRows is a safety limit to prevent unbounded memory growth
// when scanning large history JSONL files.
const maxHistoryScanRows = 10000

// scanAndFilter streams the JSONL file line-by-line, applying filters as it
// goes and only keeping entries that match. A hard cap of maxHistoryScanRows
// prevents unbounded memory growth on very large files.
func (h *History) scanAndFilter(params HistoryQuery) ([]HistoryEntry, error) {
	f, err := os.Open(h.cfg.HistoryPath)
	if err != nil {
		if os.IsNotExist(err) {
			return []HistoryEntry{}, nil
		}
		return nil, err
	}
	defer f.Close()

	entries := make([]HistoryEntry, 0, 256)
	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)

	for scanner.Scan() {
		if len(entries) >= maxHistoryScanRows {
			break
		}
		line := scanner.Text()
		if line == "" {
			continue
		}

		var e HistoryEntry
		if err := json.Unmarshal([]byte(line), &e); err != nil {
			continue
		}

		if params.ChannelID != "" && e.ChannelID != params.ChannelID {
			continue
		}
		if params.Status != "" && params.Status != "all" && e.Status != params.Status {
			continue
		}

		entries = append(entries, e)
	}

	if err := scanner.Err(); err != nil {
		return nil, err
	}

	// Sort time-descending (newest first)
	sort.Slice(entries, func(i, j int) bool {
		return entries[i].Timestamp > entries[j].Timestamp
	})

	return entries, nil
}

// CleanupNow 立即執行一次 TTL 清理（啟動時 / 測試用）。
func (h *History) CleanupNow() {
	h.cleanup()
}

// maybeCleanup 檢查檔案大小是否超限並觸發清理（防呆）。
func (h *History) maybeCleanup() {
	info, err := os.Stat(h.cfg.HistoryPath)
	if err != nil {
		return
	}
	if info.Size() > h.cfg.MaxFileSizeMB*1024*1024 {
		h.cleanup()
	}
}

// cleanup 刪除超過 RetentionDays 的紀錄（決策 6）：掃描 → 寫 .tmp → os.Rename 原子替換。
func (h *History) cleanup() {
	cutoff := time.Now().AddDate(0, 0, -h.cfg.RetentionDays)
	tmpPath := h.cfg.HistoryPath + ".tmp"

	f, err := os.Open(h.cfg.HistoryPath)
	if err != nil {
		if !os.IsNotExist(err) {
			log.Printf("NOTIFY ERROR: cleanup open: %v", err)
		}
		return
	}
	defer f.Close()

	tmp, err := os.Create(tmpPath)
	if err != nil {
		log.Printf("NOTIFY ERROR: cleanup create tmp: %v", err)
		return
	}
	tmpName := tmp.Name()

	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)

	for scanner.Scan() {
		line := scanner.Text()
		if line == "" {
			continue
		}

		var e HistoryEntry
		if err := json.Unmarshal([]byte(line), &e); err != nil {
			tmp.Write([]byte(line + "\n"))
			continue
		}

		t, err := time.Parse(time.RFC3339, e.Timestamp)
		if err != nil {
			tmp.Write([]byte(line + "\n"))
			continue
		}

		if t.Before(cutoff) {
			continue
		}
		tmp.Write([]byte(line + "\n"))
	}

	tmp.Close()
	f.Close()

	if err := scanner.Err(); err != nil {
		log.Printf("NOTIFY ERROR: cleanup scan: %v", err)
		os.Remove(tmpName)
		return
	}

	if err := os.Rename(tmpName, h.cfg.HistoryPath); err != nil {
		log.Printf("NOTIFY ERROR: cleanup rename: %v", err)
		os.Remove(tmpName)
		return
	}
}
