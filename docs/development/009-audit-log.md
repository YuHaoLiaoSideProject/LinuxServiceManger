# Audit 操作紀錄 — 開發規格

> **對應 Roadmap**：Phase 2 — `docs/development/002-expansion-roadmap.md` 項目 #10
> **技術決策**：`docs/tech-decisions/009-audit-log.md`
> **操作流程**：`docs/interaction-flows/009-audit-log.md`
> **BDD**：`docs/bdds/009-audit-log.feature`
> **測試計畫**：`docs/test-plans/009-audit-log測試計畫.md`
> **狀態**：設計完成，待開發

---

## 概述

自動記錄所有透過 Web UI / API 執行的關鍵操作（登入/登出、服務 start/stop/restart/enable/disable）至 JSON Lines 檔案，並提供獨立稽核頁面供管理員查閱、搜尋、日期篩選、分頁瀏覽與 CSV 匯出。核心包含：

1. **Audit 模組（`internal/audit/`）**：非同步寫入 JSON Lines 檔案、全檔掃描查詢（支援分頁/搜尋/日期篩選）、CSV 匯出串流、保留期限清理
2. **Audit Handler**：`GET /api/v1/audit` 分頁查詢端點 + `GET /api/v1/audit/export` CSV 匯出端點，受 AuthMiddlewareJSON 保護
3. **Handler 修改**：現有 `json_handler.go` 中所有受保護操作 handler 尾端新增 `audit.Write()` 呼叫
4. **AuditLogView（前端）**：獨立 `/audit` 頁面，含搜尋框（debounce 300ms）、日期範圍選擇器、稽核紀錄表格（時間/使用者/IP/動作/目標/結果/詳細資訊）、分頁控制、CSV 匯出按鈕、空狀態與錯誤狀態
5. **Header 導覽**：`AppHeader.vue` 新增「Audit Log」連結

---

## 1. 後端實作規格

### 1.1 依賴新增

無外部依賴新增。僅使用 Go 標準函式庫（`encoding/json`、`os`、`bufio`、`sync`、`time`、`net/http`、`strconv`）。

### 1.2 檔案改動總覽

```
src/
├── main.go                              ← 修改：初始化 audit 模組，註冊 /api/v1/audit 路由
├── internal/
│   ├── audit/
│   │   ├── audit.go                     ← 新增：核心模組（Entry struct、Write、Query、ExportCSV、Cleanup）
│   │   └── audit_test.go                ← 新增：單元測試
│   ├── handler/
│   │   ├── handler.go                   ← 修改：Handler struct 新增 audit 欄位、New() 接受 audit 參數
│   │   ├── json_handler.go              ← 修改：現有 handler 尾端新增 audit.Write() 呼叫；新增 HandleAuditQuery、HandleAuditExport
│   │   └── handler_test.go              ← 修改：新增 audit API handler 測試
│   └── middleware/
│       └── auth.go                      ← 無變更：沿用 AuthMiddlewareJSON
```

### 1.3 Audit 核心模組（`internal/audit/audit.go`）

**職責**：管理 audit log 的生命週期 — 非同步寫入、全檔掃描查詢、CSV 匯出、定期清理。所有公開方法為 goroutine-safe。

```go
// Package audit provides an append-only JSON Lines audit log for recording
// administrative operations (login/logout, service start/stop/restart/enable/disable).
package audit

import (
	"bufio"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

// ─── Types ────────────────────────────────────────────────────

// Action enumerates the types of auditable operations.
type Action string

const (
	ActionLogin   Action = "login"
	ActionLogout  Action = "logout"
	ActionStart   Action = "start"
	ActionStop    Action = "stop"
	ActionRestart Action = "restart"
	ActionEnable  Action = "enable"
	ActionDisable Action = "disable"
)

// validActions is the set of allowed action values.
var validActions = map[Action]bool{
	ActionLogin: true, ActionLogout: true,
	ActionStart: true, ActionStop: true, ActionRestart: true,
	ActionEnable: true, ActionDisable: true,
}

// Result indicates whether an operation succeeded or failed.
type Result string

const (
	ResultSuccess Result = "success"
	ResultFailure Result = "failure"
)

// Entry is a single audit log record.
type Entry struct {
	Timestamp string `json:"timestamp"` // RFC3339
	Username  string `json:"username"`
	SourceIP  string `json:"source_ip"`
	Action    Action `json:"action"`
	Target    string `json:"target"`  // "nginx.service" or "" / "-" for login/logout
	Result    Result `json:"result"`
	Detail    string `json:"detail"`  // error message when result=failure, else ""
}

// QueryParams holds the filtering/pagination criteria for QueryAudit.
type QueryParams struct {
	Page   int    // 1-based
	Limit  int    // max 100, default 50
	Search string // case-insensitive substring match on username/action/target
	From   string // YYYY-MM-DD start (inclusive)
	To     string // YYYY-MM-DD end (inclusive)
}

// QueryResult is the paginated response from QueryAudit.
type QueryResult struct {
	Entries []Entry `json:"data"`
	Total   int     `json:"total"`
	Page    int     `json:"page"`
	Limit   int     `json:"limit"`
}

// Config holds the module configuration.
type Config struct {
	FilePath      string // default: /var/lib/linux-service-manager/audit.jsonl
	MaxFileSizeMB int    // default: 100
	RetentionDays int    // default: 90
	WriteBufSize  int    // buffered channel size, default: 100
}

// ─── Module ────────────────────────────────────────────────────

// Module is the audit log manager. It owns a background goroutine for
// asynchronous writes and periodic cleanup.
type Module struct {
	cfg      Config
	ch       chan Entry       // buffered; write path
	done     chan struct{}    // signals shutdown
	wg       sync.WaitGroup   // tracks writer goroutine
	writeCnt int64            // monotonic counter for cleanup gating
	mu       sync.Mutex       // protects file access
}

// New creates an Audit Module and starts its background writer goroutine.
// Call Shutdown() to gracefully stop the writer.
func New(cfg Config) *Module {
	if cfg.FilePath == "" {
		cfg.FilePath = "/var/lib/linux-service-manager/audit.jsonl"
	}
	if cfg.MaxFileSizeMB == 0 {
		cfg.MaxFileSizeMB = 100
	}
	if cfg.RetentionDays == 0 {
		cfg.RetentionDays = 90
	}
	if cfg.WriteBufSize == 0 {
		cfg.WriteBufSize = 100
	}
	// Ensure directory exists.
	dir := filepath.Dir(cfg.FilePath)
	if err := os.MkdirAll(dir, 0750); err != nil {
		log.Printf("audit: WARNING cannot create directory %s: %v", dir, err)
	}

	m := &Module{
		cfg:  cfg,
		ch:   make(chan Entry, cfg.WriteBufSize),
		done: make(chan struct{}),
	}
	m.wg.Add(1)
	go m.writerLoop()
	return m
}

// Shutdown gracefully stops the background writer goroutine.
func (m *Module) Shutdown() {
	close(m.done)
	m.wg.Wait()
}

// ─── Write path ────────────────────────────────────────────────

// Write enqueues an audit entry for asynchronous writing.
// Non-blocking: if the channel buffer is full the entry is dropped
// and a warning is logged. This guarantees audit I/O never blocks
// the API response path.
func (m *Module) Write(entry Entry) {
	select {
	case m.ch <- entry:
	default:
		log.Printf("audit: WARNING write buffer full, dropping entry for action=%s user=%s",
			entry.Action, entry.Username)
	}
}

// writerLoop is the background goroutine that consumes the channel,
// appends JSON Lines to disk, and triggers periodic cleanup.
func (m *Module) writerLoop() {
	defer m.wg.Done()
	for {
		select {
		case <-m.done:
			return
		case entry := <-m.ch:
			m.appendEntry(entry)
			m.writeCnt++
			// Trigger cleanup every 10 writes or if file exceeds size limit.
			if m.writeCnt%10 == 0 {
				m.maybeCleanup()
			}
		}
	}
}

// appendEntry serialises one entry and appends it to the JSON Lines file.
func (m *Module) appendEntry(entry Entry) {
	m.mu.Lock()
	defer m.mu.Unlock()

	f, err := os.OpenFile(m.cfg.FilePath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0640)
	if err != nil {
		log.Printf("audit: ERROR opening file: %v", err)
		return
	}
	defer f.Close()

	if err := json.NewEncoder(f).Encode(entry); err != nil {
		log.Printf("audit: ERROR writing entry: %v", err)
	}
}

// ─── Query path ────────────────────────────────────────────────

// Query reads the JSON Lines file, filters, sorts (newest first),
// and returns a paginated result.
func (m *Module) Query(params QueryParams) (QueryResult, error) {
	// Clamp limit.
	if params.Limit <= 0 {
		params.Limit = 50
	}
	if params.Limit > 100 {
		params.Limit = 100
	}
	if params.Page <= 0 {
		params.Page = 1
	}

	// Read all matching entries.
	all, err := m.scanAndFilter(params)
	if err != nil {
		return QueryResult{}, fmt.Errorf("audit query: %w", err)
	}

	// Sort newest first (descending by timestamp).
	sort.Slice(all, func(i, j int) bool {
		return all[i].Timestamp > all[j].Timestamp
	})

	total := len(all)

	// Paginate.
	start := (params.Page - 1) * params.Limit
	if start > total {
		start = total
	}
	end := start + params.Limit
	if end > total {
		end = total
	}

	return QueryResult{
		Entries: all[start:end],
		Total:   total,
		Page:    params.Page,
		Limit:   params.Limit,
	}, nil
}

// scanAndFilter reads every line from the JSON Lines file, parses it,
// and returns entries that match the filter criteria.
func (m *Module) scanAndFilter(params QueryParams) ([]Entry, error) {
	f, err := os.Open(m.cfg.FilePath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil // empty file → no entries, no error
		}
		return nil, err
	}
	defer f.Close()

	var entries []Entry
	scanner := bufio.NewScanner(f)
	// Increase buffer for lines up to ~1 MB.
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)

	searchLower := strings.ToLower(params.Search)

	for scanner.Scan() {
		line := scanner.Bytes()
		var e Entry
		if err := json.Unmarshal(line, &e); err != nil {
			// Skip malformed lines.
			continue
		}
		// Apply date filter.
		if params.From != "" && e.Timestamp[:10] < params.From {
			continue
		}
		if params.To != "" && e.Timestamp[:10] > params.To {
			continue
		}
		// Apply search filter.
		if searchLower != "" {
			if !strings.Contains(strings.ToLower(e.Username), searchLower) &&
				!strings.Contains(strings.ToLower(string(e.Action)), searchLower) &&
				!strings.Contains(strings.ToLower(e.Target), searchLower) {
				continue
			}
		}
		entries = append(entries, e)
	}
	return entries, scanner.Err()
}

// ─── CSV Export ────────────────────────────────────────────────

const maxExportRows = 10_000

// ExportCSV writes CSV output to w, respecting the same filter params as Query,
// up to maxExportRows.
func (m *Module) ExportCSV(w io.Writer, params QueryParams) (int, error) {
	all, err := m.scanAndFilter(params)
	if err != nil {
		return 0, err
	}

	// Sort newest first.
	sort.Slice(all, func(i, j int) bool {
		return all[i].Timestamp > all[j].Timestamp
	})

	if len(all) > maxExportRows {
		all = all[:maxExportRows]
	}

	cw := csv.NewWriter(w)
	// Header.
	cw.Write([]string{"timestamp", "username", "source_ip", "action", "target", "result", "detail"})
	for _, e := range all {
		target := e.Target
		if target == "" {
			target = "-"
		}
		cw.Write([]string{e.Timestamp, e.Username, e.SourceIP, string(e.Action), target, string(e.Result), e.Detail})
	}
	cw.Flush()
	return len(all), cw.Error()
}

// ─── Cleanup ────────────────────────────────────────────────────

// maybeCleanup checks file size and triggers retention cleanup if needed.
func (m *Module) maybeCleanup() {
	info, err := os.Stat(m.cfg.FilePath)
	if err != nil {
		return // file doesn't exist yet, nothing to clean
	}
	sizeMB := info.Size() / (1024 * 1024)
	if sizeMB >= int64(m.cfg.MaxFileSizeMB) {
		log.Printf("audit: WARNING file size %d MB >= limit %d MB, triggering cleanup",
			sizeMB, m.cfg.MaxFileSizeMB)
	}
	// Always run retention cleanup.
	m.cleanupRetention()
}

// cleanupRetention removes entries older than RetentionDays by rewriting the file.
func (m *Module) cleanupRetention() {
	m.mu.Lock()
	defer m.mu.Unlock()

	cutoff := time.Now().AddDate(0, 0, -m.cfg.RetentionDays)

	// Read all entries, keep only recent ones.
	f, err := os.Open(m.cfg.FilePath)
	if err != nil {
		return
	}

	var keep []Entry
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		var e Entry
		if err := json.Unmarshal(scanner.Bytes(), &e); err != nil {
			continue
		}
		t, err := time.Parse(time.RFC3339, e.Timestamp)
		if err != nil {
			keep = append(keep, e) // keep unparseable timestamps
			continue
		}
		if t.After(cutoff) {
			keep = append(keep, e)
		}
	}
	f.Close()

	if len(keep) == 0 {
		return
	}

	// Write to temp file, then atomically rename.
	tmpPath := m.cfg.FilePath + ".tmp"
	tmp, err := os.Create(tmpPath)
	if err != nil {
		log.Printf("audit: ERROR creating temp file for cleanup: %v", err)
		return
	}
	enc := json.NewEncoder(tmp)
	for _, e := range keep {
		if err := enc.Encode(e); err != nil {
			log.Printf("audit: ERROR writing during cleanup: %v", err)
			tmp.Close()
			os.Remove(tmpPath)
			return
		}
	}
	tmp.Close()
	if err := os.Rename(tmpPath, m.cfg.FilePath); err != nil {
		log.Printf("audit: ERROR renaming after cleanup: %v", err)
		os.Remove(tmpPath)
	}
}

// ─── Helpers ────────────────────────────────────────────────────

// NewEntry is a convenience constructor that sets Timestamp and validates action.
func NewEntry(username, sourceIP string, action Action, target string, result Result, detail string) (Entry, error) {
	if !validActions[action] {
		return Entry{}, fmt.Errorf("audit: invalid action %q", action)
	}
	return Entry{
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Username:  username,
		SourceIP:  sourceIP,
		Action:    action,
		Target:    target,
		Result:    result,
		Detail:    detail,
	}, nil
}

// ExtractClientIP extracts the client IP from an HTTP request,
// respecting X-Forwarded-For if behind a reverse proxy.
func ExtractClientIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		parts := strings.Split(xff, ",")
		return strings.TrimSpace(parts[0])
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}
```

### 1.4 Handler 層修改

#### 1.4.1 `handler.go` — Handler struct 擴充

```go
// Handler holds the parsed templates, systemd manager, and audit module.
type Handler struct {
	tmpl    *template.Template
	systemd systemd.ServiceManager
	Hub     *websocket.Hub
	Audit   *audit.Module   // ← 新增
}

// New creates a new Handler with the given template filesystem, systemd manager,
// and audit module.
func New(tplFS fs.FS, sm systemd.ServiceManager, auditMod *audit.Module) *Handler {
	var tmpl *template.Template
	if tplFS != nil {
		tmpl = template.Must(template.ParseFS(tplFS, "index.html", "login.html"))
	}
	return &Handler{tmpl: tmpl, systemd: sm, Audit: auditMod}
}
```

#### 1.4.2 `json_handler.go` — 操作 handler 附加 audit 寫入

以 `HandleStartJSON` 為例（其餘 stop/restart/enable/disable 模式相同）：

```go
func (h *Handler) HandleStartJSON(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	svcName := name + ".service"

	err := h.systemd.Start(svcName)

	// ── Audit log write (non-blocking) ──
	username, _ := auth.GetSession(r).Values["username"].(string)
	result := audit.ResultSuccess
	detail := ""
	if err != nil {
		result = audit.ResultFailure
		detail = err.Error()
	}
	entry, entryErr := audit.NewEntry(username, audit.ExtractClientIP(r),
		audit.ActionStart, svcName, result, detail)
	if entryErr == nil {
		h.Audit.Write(entry)
	}
	// ── End audit ──

	if err != nil {
		writeJSON(w, http.StatusInternalServerError, messageJSON{Error: err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, messageJSON{Message: "service started"})
}
```

**登入 audit**（`HandleLoginJSON` 尾端）：

```go
// 驗證密碼成功後，return 之前：
entry, _ := audit.NewEntry(username, audit.ExtractClientIP(r),
    audit.ActionLogin, "-", audit.ResultSuccess, "")
h.Audit.Write(entry)
```

**登出 audit**（`HandleLogoutJSON` 尾端）：

```go
// 清除 session 前取得 username：
username, _ := session.Values["username"].(string)
entry, _ := audit.NewEntry(username, audit.ExtractClientIP(r),
    audit.ActionLogout, "-", audit.ResultSuccess, "")
h.Audit.Write(entry)
```

#### 1.4.3 `json_handler.go` — 新增 Audit API handler

```go
// HandleAuditQuery handles GET /api/v1/audit
func (h *Handler) HandleAuditQuery(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	params := audit.QueryParams{
		Search: q.Get("search"),
		From:   q.Get("from"),
		To:     q.Get("to"),
	}
	// Parse page & limit, with validation.
	if p, err := strconv.Atoi(q.Get("page")); err == nil && p > 0 {
		params.Page = p
	} else {
		params.Page = 1
	}
	if l, err := strconv.Atoi(q.Get("limit")); err == nil && l > 0 {
		params.Limit = l
	} else {
		params.Limit = 50
	}
	// Validate date format.
	for _, field := range []struct{ val, name string }{{params.From, "from"}, {params.To, "to"}} {
		if field.val == "" {
			continue
		}
		if _, err := time.Parse("2006-01-02", field.val); err != nil {
			writeJSON(w, http.StatusBadRequest, messageJSON{
				Error: fmt.Sprintf("invalid %s date format, expected YYYY-MM-DD", field.name),
			})
			return
		}
	}

	result, err := h.Audit.Query(params)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, messageJSON{Error: err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, result)
}

// HandleAuditExport handles GET /api/v1/audit/export
func (h *Handler) HandleAuditExport(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	format := q.Get("format")
	if format == "" {
		writeJSON(w, http.StatusBadRequest, messageJSON{Error: "format parameter required"})
		return
	}
	if format != "csv" {
		writeJSON(w, http.StatusBadRequest, messageJSON{Error: "unsupported format, only csv is supported"})
		return
	}

	params := audit.QueryParams{
		Search: q.Get("search"),
		From:   q.Get("from"),
		To:     q.Get("to"),
	}

	filename := fmt.Sprintf("audit-log-%s.csv", time.Now().Format("2006-01-02"))
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, filename))

	count, err := h.Audit.ExportCSV(w, params)
	if err != nil {
		// If headers already sent, we cannot change status; log the error.
		log.Printf("audit export error: %v", err)
		return
	}
	_ = count // count available for logging if needed
}
```

#### 1.4.4 `main.go` — 路由註冊

在現有的 protected JSON API group 中新增：

```go
r.Group(func(r chi.Router) {
	r.Use(middleware.AuthMiddlewareJSON)
	// ... existing routes ...
	r.Get("/api/v1/audit", h.HandleAuditQuery)        // ← 新增
	r.Get("/api/v1/audit/export", h.HandleAuditExport) // ← 新增
})
```

初始化 audit 模組：

```go
auditMod := audit.New(audit.Config{
	FilePath:      "/var/lib/linux-service-manager/audit.jsonl",
	MaxFileSizeMB: 100,
	RetentionDays: 90,
})
defer auditMod.Shutdown()

h := handler.New(templates, &systemd.DefaultManager{}, auditMod)
```

---

## 2. 前端實作規格

### 2.1 檔案改動總覽

```
frontend/src/
├── composables/
│   └── useAuditLog.ts                ← 新增：稽核資料管理（fetch、搜尋、日期、分頁、匯出）
├── components/
│   ├── AuditTable.vue                ← 新增：稽核紀錄表格元件
│   ├── AppHeader.vue                 ← 修改：新增「Audit Log」導覽連結
│   └── EmptyState.vue                ← 無變更：沿用現有空狀態元件
├── views/
│   └── AuditLogView.vue              ← 新增：/audit 頁面主元件
├── router/
│   └── index.ts                      ← 修改：新增 /audit 路由
└── stores/
    └── (不需新增 store，使用 composable 管理頁面狀態)
```

### 2.2 Composable — `useAuditLog.ts`

**職責**：管理 Audit Log 頁面的所有狀態與副作用。暴露 reactive state 供元件使用。

```typescript
// composables/useAuditLog.ts
import { ref, reactive, watch } from 'vue'
import axios from 'axios'

export interface AuditEntry {
  timestamp: string
  username: string
  source_ip: string
  action: string
  target: string
  result: 'success' | 'failure'
  detail: string
}

export interface AuditQueryResult {
  data: AuditEntry[]
  total: number
  page: number
  limit: number
}

export function useAuditLog() {
  // ── State ──
  const entries = ref<AuditEntry[]>([])
  const total = ref(0)
  const page = ref(1)
  const limit = ref(50)
  const totalPages = ref(0)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const search = ref('')
  const dateFrom = ref('')
  const dateTo = ref('')

  // ── Computed-like helpers ──

  function buildParams(overridePage?: number): Record<string, string> {
    const params: Record<string, string> = {
      page: String(overridePage ?? page.value),
      limit: String(limit.value),
    }
    if (search.value) params.search = search.value
    if (dateFrom.value) params.from = dateFrom.value
    if (dateTo.value) params.to = dateTo.value
    return params
  }

  // ── Actions ──

  async function fetchAuditLog(pageOverride?: number) {
    loading.value = true
    error.value = null
    try {
      const { data } = await axios.get<AuditQueryResult>('/api/v1/audit', {
        params: buildParams(pageOverride),
      })
      entries.value = data.data
      total.value = data.total
      page.value = data.page
      totalPages.value = Math.ceil(data.total / limit.value) || 1
    } catch (e: any) {
      error.value = e?.response?.data?.error ?? e.message ?? '載入失敗'
    } finally {
      loading.value = false
    }
  }

  function goToPage(p: number) {
    if (p < 1 || p > totalPages.value) return
    fetchAuditLog(p)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function clearFilters() {
    search.value = ''
    dateFrom.value = ''
    dateTo.value = ''
    page.value = 1
    fetchAuditLog(1)
  }

  async function exportCSV() {
    try {
      const params = new URLSearchParams(buildParams())
      params.set('format', 'csv')
      const resp = await axios.get('/api/v1/audit/export', {
        params,
        responseType: 'blob',
      })
      // Trigger browser download.
      const url = window.URL.createObjectURL(new Blob([resp.data]))
      const a = document.createElement('a')
      a.href = url
      const today = new Date().toISOString().slice(0, 10)
      a.download = `audit-log-${today}.csv`
      a.click()
      window.URL.revokeObjectURL(url)
      return { success: true }
    } catch (e: any) {
      return { success: false, message: e?.response?.data?.error ?? '匯出失敗' }
    }
  }

  // ── Watchers ──

  let debounceTimer: ReturnType<typeof setTimeout> | null = null

  function onSearchInput(value: string) {
    search.value = value
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      page.value = 1
      fetchAuditLog(1)
    }, 300)
  }

  function onDateRangeChange(from: string, to: string) {
    dateFrom.value = from
    dateTo.value = to
    page.value = 1
    fetchAuditLog(1)
  }

  // ── Return ──
  return {
    // state
    entries, total, page, limit, totalPages, loading, error,
    search, dateFrom, dateTo,
    // actions
    fetchAuditLog, goToPage, clearFilters, exportCSV,
    onSearchInput, onDateRangeChange,
  }
}
```

### 2.3 Component — `AuditTable.vue`

**職責**：渲染稽核紀錄表格。接收 entries 作為 props，處理空狀態與行列樣式。

```vue
<script setup lang="ts">
import type { AuditEntry } from '../composables/useAuditLog'

defineProps<{
  entries: AuditEntry[]
}>()

function formatTime(ts: string): string {
  // "2025-08-09T14:30:00Z" → "2025-08-09 14:30:00"
  return ts.replace('T', ' ').replace(/\.\d+Z?/, '').slice(0, 19)
}

function actionLabel(action: string): string {
  const map: Record<string, string> = {
    login: '登入', logout: '登出',
    start: '啟動', stop: '停止', restart: '重啟',
    enable: '啟用', disable: '停用',
  }
  return map[action] ?? action
}

function resultLabel(result: string): string {
  return result === 'success' ? '成功' : '失敗'
}

function displayTarget(target: string): string {
  return target && target !== '-' ? target : '-'
}
</script>

<template>
  <table class="audit-table" v-if="entries.length > 0">
    <thead>
      <tr>
        <th>時間</th>
        <th>使用者</th>
        <th>來源 IP</th>
        <th>動作</th>
        <th>目標服務</th>
        <th>結果</th>
        <th>詳細資訊</th>
      </tr>
    </thead>
    <tbody>
      <tr
        v-for="(entry, idx) in entries"
        :key="idx"
        :class="entry.result === 'success' ? 'row-success' : 'row-failure'"
      >
        <td class="col-time">{{ formatTime(entry.timestamp) }}</td>
        <td>{{ entry.username }}</td>
        <td class="col-ip">{{ entry.source_ip }}</td>
        <td>{{ actionLabel(entry.action) }}</td>
        <td>{{ displayTarget(entry.target) }}</td>
        <td>
          <span :class="entry.result === 'success' ? 'badge-success' : 'badge-failure'">
            {{ resultLabel(entry.result) }}
          </span>
        </td>
        <td class="col-detail">{{ entry.detail || '-' }}</td>
      </tr>
    </tbody>
  </table>
</template>
```

### 2.4 View — `AuditLogView.vue`

**職責**：組合搜尋框、日期選擇器、AuditTable、分頁控制、匯出按鈕，管理頁面生命週期。

```vue
<script setup lang="ts">
import { onMounted } from 'vue'
import { useAuditLog } from '../composables/useAuditLog'
import { useToast } from '../composables/useToast'
import AuditTable from '../components/AuditTable.vue'
import EmptyState from '../components/EmptyState.vue'

const {
  entries, total, page, totalPages, loading, error,
  search, dateFrom, dateTo,
  fetchAuditLog, goToPage, clearFilters, exportCSV,
  onSearchInput, onDateRangeChange,
} = useAuditLog()

const toast = useToast()

onMounted(() => {
  fetchAuditLog(1)
})

async function handleExport() {
  const result = await exportCSV()
  if (result.success) {
    toast.show('稽核紀錄已匯出')
  } else {
    toast.show(result.message ?? '匯出失敗，請稍後再試', 'error')
  }
}

function handleRetry() {
  fetchAuditLog(page.value)
}
</script>

<template>
  <div class="audit-page">
    <h1>稽核操作紀錄</h1>

    <!-- Toolbar: search + date + export -->
    <div class="audit-toolbar">
      <div class="search-box">
        <input
          type="text"
          placeholder="搜尋使用者、動作、目標服務..."
          :value="search"
          @input="onSearchInput(($event.target as HTMLInputElement).value)"
        />
        <span v-if="search" class="search-count">找到 {{ total }} 筆紀錄</span>
      </div>
      <div class="date-range">
        <input type="date" v-model="dateFrom" @change="onDateRangeChange(dateFrom, dateTo)" />
        <span>~</span>
        <input type="date" v-model="dateTo" @change="onDateRangeChange(dateFrom, dateTo)" />
      </div>
      <button class="btn-export" @click="handleExport">匯出 CSV</button>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="loading-spinner">載入中...</div>

    <!-- Error -->
    <div v-else-if="error" class="error-state">
      <p>{{ error }}</p>
      <button @click="handleRetry">重試</button>
    </div>

    <!-- Empty (no data at all) -->
    <EmptyState v-else-if="total === 0 && !search && !dateFrom && !dateTo"
      message="尚無操作紀錄" />

    <!-- Empty (filtered to zero) -->
    <div v-else-if="entries.length === 0" class="empty-filtered">
      <p>沒有符合條件的紀錄</p>
      <a href="#" @click.prevent="clearFilters">清除過濾</a>
    </div>

    <!-- Table -->
    <AuditTable v-else :entries="entries" />

    <!-- Pagination -->
    <div v-if="totalPages > 1" class="pagination">
      <button :disabled="page <= 1" @click="goToPage(page - 1)">上一頁</button>
      <span v-for="p in totalPages" :key="p">
        <button
          :class="{ active: p === page }"
          @click="goToPage(p)"
        >{{ p }}</button>
      </span>
      <button :disabled="page >= totalPages" @click="goToPage(page + 1)">下一頁</button>
      <span class="page-info">第 {{ page }} 頁 / 共 {{ totalPages }} 頁（{{ total }} 筆）</span>
    </div>
  </div>
</template>
```

### 2.5 路由修改 — `router/index.ts`

```typescript
// 新增 lazy import:
const AuditLogView = () => import('../views/AuditLogView.vue')

// 在 routes 陣列中新增:
{ path: '/audit', name: 'audit', component: AuditLogView, meta: { auth: true } },
```

### 2.6 Header 修改 — `AppHeader.vue`

在現有導覽連結區域新增：

```vue
<router-link to="/audit" class="nav-link">Audit Log</router-link>
```

---

## 3. API / Message 合約

### 3.1 REST API

| 方法 | 路徑 | Request | Response | 說明 |
|------|------|---------|----------|------|
| GET | `/api/v1/audit` | Query: `page`(int, default=1), `limit`(int, max=100, default=50), `search`(string), `from`(YYYY-MM-DD), `to`(YYYY-MM-DD) | `200`: `{"data": [Entry...], "total": int, "page": int, "limit": int}` | 分頁查詢稽核紀錄，需登入 |
| GET | `/api/v1/audit/export` | Query: `format=csv`, `search`, `from`, `to` | `200`: CSV file (`Content-Type: text/csv`, `Content-Disposition: attachment; filename="audit-log-{date}.csv"`) | 匯出 CSV，上限 10,000 筆，需登入 |

### 3.2 Entry JSON Schema

```json
{
  "timestamp": "2025-08-09T14:30:00Z",
  "username": "admin",
  "source_ip": "192.168.1.100",
  "action": "restart",
  "target": "nginx.service",
  "result": "success",
  "detail": ""
}
```

### 3.3 Action 枚舉

| 值 | 語意 | 寫入時機 |
|------|------|---------|
| `login` | 登入 | `HandleLoginJSON` 密碼驗證成功後 |
| `logout` | 登出 | `HandleLogoutJSON` 清除 session 前 |
| `start` | 啟動服務 | `HandleStartJSON` systemctl start 完成後 |
| `stop` | 停止服務 | `HandleStopJSON` systemctl stop 完成後 |
| `restart` | 重啟服務 | `HandleRestartJSON` systemctl restart 完成後 |
| `enable` | 啟用服務 | `HandleEnableJSON` systemctl enable 完成後 |
| `disable` | 停用服務 | `HandleDisableJSON` systemctl disable 完成後 |

### 3.4 錯誤回應

| HTTP Status | 情境 | Response Body |
|-------------|------|---------------|
| 401 | 未登入存取 audit API | `{"error": "unauthorized"}` |
| 400 | `page` 參數非正整數 | `{"error": "invalid page parameter"}` |
| 400 | `from`/`to` 日期格式錯誤 | `{"error": "invalid from date format, expected YYYY-MM-DD"}` |
| 400 | `format` 參數缺失或非 `csv` | `{"error": "format parameter required"}` / `{"error": "unsupported format, only csv is supported"}` |
| 500 | 檔案讀取錯誤 | `{"error": "audit query: ..."}` |

---

## 4. 資料流

```
┌──────────┐   操作請求     ┌──────────────┐   systemctl    ┌──────────┐
│  Browser │───────────────→│  Handler      │──────────────→│ systemd  │
│          │←───────────────│  (json_handler)│←──────────────│          │
└──────────┘   API response └──────┬───────┘   result       └──────────┘
                                   │
                                   │ audit.Write(entry)  (non-blocking)
                                   ▼
                          ┌─────────────────┐
                          │  buffered chan   │
                          │  (cap=100)       │
                          └────────┬────────┘
                                   │ dequeue
                                   ▼
                          ┌─────────────────┐
                          │  writer goroutine│
                          │  append JSON line│
                          └────────┬────────┘
                                   │ os.File.Write
                                   ▼
                          ┌─────────────────────────┐
                          │  /var/lib/linux-service- │
                          │  manager/audit.jsonl     │
                          └─────────────────────────┘

┌──────────┐  GET /api/v1/audit  ┌──────────────┐  Query()    ┌──────────┐
│  Browser │────────────────────→│  Handler      │────────────→│ audit    │
│(AuditLog │←────────────────────│(HandleAudit   │←────────────│ Module   │
│  View)   │   JSON response     │  Query)       │  QueryResult│          │
└──────────┘                     └──────────────┘             └──────────┘
                                                                    │
                                                                    │ scan + filter
                                                                    ▼
                                                             audit.jsonl
```

**寫入路徑關鍵特性**：
1. handler 呼叫 `audit.Write(entry)` → 透過 select/default 非阻塞送入 buffered channel
2. writer goroutine 單一消費者，序列化所有檔案寫入（無需 file lock）
3. channel 滿時 drop entry + log warning，保證 API 回應不受影響
4. 每 10 次寫入觸發 `cleanupRetention()`，atomic rename 確保安全

---

## 5. 邊界條件處理

| 情境 | 處理方式 | 來源 |
|------|---------|------|
| **Audit log 儲存失敗（磁碟滿）** | channel drop + log error；主操作不受影響 | BDD `@error-handling` |
| **載入稽核頁面 API 失敗** | 顯示錯誤訊息 + 重試按鈕；可返回 Dashboard | BDD `@error-handling` |
| **搜尋無匹配結果** | 顯示「沒有符合條件的紀錄」+「清除過濾」連結 | BDD `@error-handling` |
| **未登入存取 audit API** | 回傳 401 Unauthorized（AuthMiddlewareJSON） | BDD `@error-handling` |
| **CSV 匯出超過 10,000 筆** | API 截斷至 10,000 筆；前端 Toast「已匯出最近 10,000 筆紀錄」 | BDD `@edge-case` |
| **分頁請求超出範圍** | 回傳空陣列，`total` 維持實際值 | BDD `@edge-case` |
| **limit > 100** | `Query()` 自動 clamp 為 100 | BDD `@edge-case` |
| **超過保留期限（>90 天）紀錄** | `cleanupRetention()` 移除，atomic rename | BDD `@business-rules` |
| **JSON Lines 檔案達 100MB** | 仍正常寫入，後端 log warning | BDD `@business-rules` |
| **SSH direct systemctl** | 不出現 audit log（僅記錄 Web UI / API 操作） | BDD `@business-rules` |
| **channel buffer 滿** | select default → drop + log warning | Tech Decision #2 |
| **Cleanup 過程中 crash** | temp file + `os.Rename` 原子替換；crash 後原檔完整 | 並發/競態考量 |
| **audit.jsonl 不存在** | `Query()` 回傳空結果不報錯；`Write()` 自動建立檔案 | 智能補充 |
| **單行 JSON 損毀** | `scanAndFilter` 跳過損毀行（`json.Unmarshal` 失敗 continue） | 智能補充 |
| **同時多個操作寫入** | writer goroutine 單一消費者序列化寫入，無競爭 | 智能補充 |

---

## 6. CSS 關鍵樣式

### 6.1 稽核表格列樣式

```css
/* AuditTable.vue scoped styles */
.audit-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.9rem;
}

.audit-table th {
  position: sticky;
  top: 0;
  background: var(--color-bg-secondary, #f5f5f5);
  padding: 10px 8px;
  text-align: left;
  border-bottom: 2px solid var(--color-border, #ddd);
}

.audit-table td {
  padding: 8px;
  border-bottom: 1px solid var(--color-border-light, #eee);
  vertical-align: top;
}

.row-success {
  background: rgba(0, 200, 0, 0.05);
}

.row-failure {
  background: rgba(255, 0, 0, 0.05);
}

.badge-success {
  background: #2e7d32;
  color: #fff;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 0.8rem;
}

.badge-failure {
  background: #c62828;
  color: #fff;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 0.8rem;
}

.col-time {
  white-space: nowrap;
  font-family: monospace;
}

.col-ip {
  font-family: monospace;
  font-size: 0.85rem;
}

.col-detail {
  max-width: 250px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

### 6.2 AuditLogView 佈局

```css
/* AuditLogView.vue scoped styles */
.audit-page {
  padding: 24px;
  max-width: 1400px;
  margin: 0 auto;
}

.audit-toolbar {
  display: flex;
  gap: 16px;
  align-items: center;
  margin-bottom: 16px;
  flex-wrap: wrap;
}

.search-box input {
  padding: 8px 12px;
  border: 1px solid var(--color-border, #ddd);
  border-radius: 4px;
  width: 300px;
}

.search-count {
  margin-left: 8px;
  font-size: 0.85rem;
  color: var(--color-text-secondary, #666);
}

.date-range {
  display: flex;
  gap: 8px;
  align-items: center;
}

.date-range input[type="date"] {
  padding: 6px 8px;
  border: 1px solid var(--color-border, #ddd);
  border-radius: 4px;
}

.btn-export {
  padding: 8px 16px;
  background: var(--color-primary, #1976d2);
  color: #fff;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

.pagination {
  display: flex;
  gap: 4px;
  align-items: center;
  margin-top: 16px;
  justify-content: center;
}

.pagination button {
  padding: 6px 12px;
  border: 1px solid var(--color-border, #ddd);
  background: #fff;
  cursor: pointer;
  border-radius: 4px;
}

.pagination button.active {
  background: var(--color-primary, #1976d2);
  color: #fff;
  border-color: var(--color-primary, #1976d2);
}

.pagination button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.page-info {
  margin-left: 12px;
  font-size: 0.85rem;
  color: var(--color-text-secondary, #666);
}
```

---

## 7. 開發順序

| 步驟 | 內容 | 依賴 | 預估 |
|------|------|------|------|
| 1 | 建立 `internal/audit/audit.go` 核心模組（Entry、Write、writerLoop、appendEntry、NewEntry、ExtractClientIP） | - | 2h |
| 2 | 撰寫 `internal/audit/audit_test.go` 單元測試（涵蓋 Write/Query/Cleanup/validation） | #1 | 3h |
| 3 | 實作 `Query()` 與 `scanAndFilter()`（分頁、搜尋、日期篩選） | #1 | 2h |
| 4 | 實作 `ExportCSV()` 與 `cleanupRetention()` | #1 | 1.5h |
| 5 | 修改 `handler.go` — Handler struct 新增 Audit 欄位、New() 簽名變更 | #1 | 0.5h |
| 6 | 修改 `json_handler.go` — 所有操作 handler 尾端新增 audit.Write() 呼叫（start/stop/restart/enable/disable + login/logout） | #5 | 1h |
| 7 | 新增 `HandleAuditQuery` 與 `HandleAuditExport` handler | #3, #4, #5 | 1.5h |
| 8 | 修改 `main.go` — 初始化 audit.Module、註冊 /api/v1/audit 路由、defer Shutdown | #5, #6, #7 | 0.5h |
| 9 | 撰寫 handler 層 audit API 測試（`handler_test.go` 新增 test cases） | #7 | 2h |
| 10 | 前端：建立 `composables/useAuditLog.ts` | - | 2h |
| 11 | 前端：建立 `components/AuditTable.vue` | #10 | 1.5h |
| 12 | 前端：建立 `views/AuditLogView.vue`（整合搜尋/日期/表格/分頁/匯出） | #10, #11 | 2h |
| 13 | 修改 `router/index.ts` — 新增 /audit 路由 | - | 0.5h |
| 14 | 修改 `AppHeader.vue` — 新增「Audit Log」導覽連結 | - | 0.5h |
| 15 | 前端單元測試（Vitest + @vue/test-utils） | #10, #11, #12 | 3h |
| 16 | 端對端測試（Playwright） | #8, #13, #14 | 3h |
| 17 | 手動整合測試（真實 Linux 環境驗證） | #8, #12 | 2h |

**依賴圖（DAG）**：

```
#1 ──→ #2
 │
 ├──→ #3 ──→ #7 ──→ #8 ──→ #16
 │                              │
 ├──→ #4 ──→ #7                │
 │                              │
 ├──→ #5 ──→ #6 ──→ #8         │
 │              │               │
 │              └──→ #7         │
 │                              │
 └──────────────────────────────┘

#10 ──→ #11 ──→ #12 ──→ #15
         │        │
         │        └──→ #17
         │
#13 ─────┼──→ #16
         │
#14 ─────┘
```

**關鍵路徑**：後端 #1→#5→#6/#7→#8 約 6h；前端 #10→#11→#12 約 5.5h。前後端可並行開發，總預估約 12–14 工作小時。

---

## 8. 基礎架構設定

### 8.1 目錄權限

```bash
# 建立 audit log 目錄
sudo mkdir -p /var/lib/linux-service-manager
sudo chown linux-service-manager:linux-service-manager /var/lib/linux-service-manager
sudo chmod 750 /var/lib/linux-service-manager
```

### 8.2 Nginx

本功能無需修改 Nginx 設定（純 REST API，無 WebSocket）。

### 8.3 環境變數

無新增環境變數。audit log 檔案路徑可在 `main.go` 中硬編碼，或透過可選環境變數 `AUDIT_LOG_PATH` 覆蓋（智能補充建議）。

---

*最後更新：2025-08-10*
