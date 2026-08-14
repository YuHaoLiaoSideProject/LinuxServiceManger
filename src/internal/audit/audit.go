package audit

import (
	"bufio"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
)

// ============================================================
//  Action / Result types
// ============================================================

// Action represents the type of audited operation.
type Action string

const (
	ActionLogin       Action = "login"
	ActionLogout      Action = "logout"
	ActionStart       Action = "start"
	ActionStop        Action = "stop"
	ActionRestart     Action = "restart"
	ActionEnable      Action = "enable"
	ActionDisable     Action = "disable"
	ActionTokenCreate Action = "token_create"
	ActionTokenRevoke Action = "token_revoke"
	ActionConfigView  Action = "config_view" // GET config 成功時（含鎖定服務唯讀檢視）
	ActionConfigSave  Action = "config_save" // PUT config 成功（含 reload 失敗已寫入之半成功）
	ActionNotifyCreate Action = "notify_create"
	ActionNotifyUpdate Action = "notify_update"
	ActionNotifyDelete Action = "notify_delete"
	ActionNotifyToggle Action = "notify_toggle"
	ActionNotifyTest   Action = "notify_test"
)

var validActions = map[Action]bool{
	ActionLogin:       true,
	ActionLogout:      true,
	ActionStart:       true,
	ActionStop:        true,
	ActionRestart:     true,
	ActionEnable:      true,
	ActionDisable:     true,
	ActionTokenCreate: true,
	ActionTokenRevoke: true,
	ActionConfigView:  true,
	ActionConfigSave:  true,
	ActionNotifyCreate: true,
	ActionNotifyUpdate: true,
	ActionNotifyDelete: true,
	ActionNotifyToggle: true,
	ActionNotifyTest:   true,
}

// actionDisplayLabels maps each audit action to its localized display label
// (matching the frontend's zh-TW translations in useI18n.ts). The UI renders
// these labels in the Action column, so search must match against them as well
// as the raw action value — otherwise searching for the text users actually
// see (e.g. "登入") returns no records.
var actionDisplayLabels = map[Action]string{
	ActionLogin:       "登入",
	ActionLogout:      "登出",
	ActionStart:       "啟動",
	ActionStop:        "停止",
	ActionRestart:     "重啟",
	ActionEnable:      "啟用",
	ActionDisable:     "停用",
	ActionTokenCreate: "建立 Token",
	ActionTokenRevoke: "撤銷 Token",
	ActionConfigView:  "檢視設定檔",
	ActionConfigSave:  "儲存設定檔",
	ActionNotifyCreate: "建立通知 Channel",
	ActionNotifyUpdate: "更新通知 Channel",
	ActionNotifyDelete: "刪除通知 Channel",
	ActionNotifyToggle: "切換通知 Channel",
	ActionNotifyTest:   "測試通知 Channel",
}

// Result represents the outcome of an audited operation.
type Result string

const (
	ResultSuccess Result = "success"
	ResultFailure Result = "failure"
)

// ============================================================
//  Entry struct
// ============================================================

// Entry is a single audit log record.
type Entry struct {
	Timestamp string `json:"timestamp"`
	Username  string `json:"username"`
	SourceIP  string `json:"source_ip"`
	Action    Action `json:"action"`
	Target    string `json:"target"`
	Result    Result `json:"result"`
	Detail    string `json:"detail"`
}

// ============================================================
//  Query types
// ============================================================

// QueryParams describes a query for audit log entries.
type QueryParams struct {
	Page   int
	Limit  int
	Search string
	From   string // YYYY-MM-DD
	To     string // YYYY-MM-DD
}

// QueryResult is the paginated result of an audit query.
type QueryResult struct {
	Entries []Entry `json:"data"`
	Total   int     `json:"total"`
	Page    int     `json:"page"`
	Limit   int     `json:"limit"`
}

// ============================================================
//  Config
// ============================================================

// Config holds configuration for the audit Module.
type Config struct {
	FilePath      string
	MaxFileSizeMB int64
	RetentionDays int
	WriteBufSize  int
}

// defaults fills in zero-value config fields with sensible defaults.
func (c *Config) defaults() {
	if c.FilePath == "" {
		c.FilePath = "/var/lib/linux-service-manager/audit.jsonl"
	}
	if c.MaxFileSizeMB <= 0 {
		c.MaxFileSizeMB = 100
	}
	if c.RetentionDays <= 0 {
		c.RetentionDays = 90
	}
	if c.WriteBufSize <= 0 {
		c.WriteBufSize = 100
	}
}

// ============================================================
//  Module (background writer)
// ============================================================

// Module manages audit log writing and querying.
type Module struct {
	cfg        Config
	ch         chan Entry
	done       chan struct{}
	wg         sync.WaitGroup
	writeCnt   int64
	mu         sync.Mutex
	shutdown   bool
	shutdownMu sync.RWMutex
}

// New creates a new audit Module and starts the background writer goroutine.
func New(cfg Config) *Module {
	cfg.defaults()

	// Ensure parent directory exists
	if dir := dirOf(cfg.FilePath); dir != "" {
		if err := os.MkdirAll(dir, 0755); err != nil {
			log.Printf("AUDIT WARNING: failed to create directory %s: %v", dir, err)
		}
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

// Write sends an entry to the audit log in a non-blocking fashion.
// If the channel is full the entry is dropped and a warning is logged.
func (m *Module) Write(entry Entry) {
	select {
	case m.ch <- entry:
	default:
		log.Printf("AUDIT WARNING: write buffer full, dropping entry: %+v", entry)
	}
}

// writerLoop is the background goroutine that consumes the channel and
// appends entries to the JSONL file.
func (m *Module) writerLoop() {
	defer m.wg.Done()
	for {
		select {
		case entry := <-m.ch:
			m.appendEntry(entry)
			m.mu.Lock()
			m.writeCnt++
			cnt := m.writeCnt
			m.mu.Unlock()
			if cnt%10 == 0 {
				m.maybeCleanup()
			}
		case <-m.done:
			// Drain remaining entries before exiting
			for {
				select {
				case entry := <-m.ch:
					m.appendEntry(entry)
				default:
					return
				}
			}
		}
	}
}

// appendEntry serializes a single Entry as one JSON line and appends it.
func (m *Module) appendEntry(entry Entry) {
	if entry.Timestamp == "" {
		entry.Timestamp = time.Now().UTC().Format(time.RFC3339)
	}

	f, err := os.OpenFile(m.cfg.FilePath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		log.Printf("AUDIT ERROR: failed to open audit file: %v", err)
		return
	}
	defer f.Close()

	data, err := json.Marshal(entry)
	if err != nil {
		log.Printf("AUDIT ERROR: failed to marshal entry: %v", err)
		return
	}
	data = append(data, '\n')

	if _, err := f.Write(data); err != nil {
		log.Printf("AUDIT ERROR: failed to write entry: %v", err)
	}
}

// Shutdown gracefully stops the writer goroutine and drains buffered entries.
// Safe to call multiple times.
func (m *Module) Shutdown() {
	m.shutdownMu.Lock()
	if m.shutdown {
		m.shutdownMu.Unlock()
		return
	}
	m.shutdown = true
	m.shutdownMu.Unlock()
	close(m.done)
	m.wg.Wait()
}

// ============================================================
//  Query
// ============================================================

// Query reads the audit log, filters, sorts (time desc), and paginates.
func (m *Module) Query(params QueryParams) (QueryResult, error) {
	// Validate / clamp
	if params.Page < 1 {
		params.Page = 1
	}
	if params.Limit < 1 {
		params.Limit = 50
	}
	if params.Limit > 100 {
		params.Limit = 100
	}

	entries, err := m.scanAndFilter(params)
	if err != nil {
		return QueryResult{}, err
	}

	total := len(entries)

	// Paginate: entries are already sorted time-desc
	start := (params.Page - 1) * params.Limit
	if start > len(entries) {
		start = len(entries)
	}
	end := start + params.Limit
	if end > len(entries) {
		end = len(entries)
	}

	// Never return a nil slice: encoding/json marshals nil as `null`,
	// which the frontend treats as an API error (see frontend AuditLogView).
	pageEntries := entries[start:end]
	if pageEntries == nil {
		pageEntries = []Entry{}
	}

	return QueryResult{
		Entries: pageEntries,
		Total:   total,
		Page:    params.Page,
		Limit:   params.Limit,
	}, nil
}

// scanAndFilter reads the entire JSONL file and returns entries matching the
// query filters, sorted newest-first.
func (m *Module) scanAndFilter(params QueryParams) ([]Entry, error) {
	f, err := os.Open(m.cfg.FilePath)
	if err != nil {
		if os.IsNotExist(err) {
			return []Entry{}, nil
		}
		return nil, err
	}
	defer f.Close()

	entries := []Entry{}
	scanner := bufio.NewScanner(f)
	// Allow large lines (up to 1 MB)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)

	for scanner.Scan() {
		line := scanner.Text()
		if line == "" {
			continue
		}

		var e Entry
		if err := json.Unmarshal([]byte(line), &e); err != nil {
			// Skip corrupted lines
			continue
		}

		// Apply search filter (case-insensitive on username/action/target).
		// The action is also matched against its localized display label so
		// users can search for the text they see in the UI (e.g. "登入").
		if params.Search != "" {
			search := strings.ToLower(params.Search)
			haystack := strings.ToLower(e.Username) + " " +
				strings.ToLower(string(e.Action)) + " " +
				strings.ToLower(e.Target)
			if label, ok := actionDisplayLabels[e.Action]; ok {
				haystack += " " + strings.ToLower(label)
			}
			if !strings.Contains(haystack, search) {
				continue
			}
		}

		// Apply date range filter
		if params.From != "" {
			if e.Timestamp < params.From+"T00:00:00Z" {
				continue
			}
		}
		if params.To != "" {
			if e.Timestamp > params.To+"T23:59:59Z" {
				continue
			}
		}

		entries = append(entries, e)
	}

	if err := scanner.Err(); err != nil {
		return nil, err
	}

	// Sort time-descending (newest first)
	for i := 0; i < len(entries); i++ {
		for j := i + 1; j < len(entries); j++ {
			if entries[i].Timestamp < entries[j].Timestamp {
				entries[i], entries[j] = entries[j], entries[i]
			}
		}
	}

	return entries, nil
}

// ============================================================
//  Export CSV
// ============================================================

const maxExportRows = 10000

// ExportCSV writes matching entries as CSV to w and returns the row count
// (excluding header). Capped at maxExportRows.
func (m *Module) ExportCSV(w io.Writer, params QueryParams) (int, error) {
	params.Page = 1
	params.Limit = maxExportRows

	entries, err := m.scanAndFilter(params)
	if err != nil {
		return 0, err
	}

	cw := csv.NewWriter(w)

	// Header
	if err := cw.Write([]string{"timestamp", "username", "source_ip", "action", "target", "result", "detail"}); err != nil {
		return 0, err
	}

	for i, e := range entries {
		if i >= maxExportRows {
			break
		}
		row := []string{e.Timestamp, e.Username, e.SourceIP, string(e.Action), e.Target, string(e.Result), e.Detail}
		if err := cw.Write(row); err != nil {
			return 0, err
		}
	}

	cw.Flush()
	if err := cw.Error(); err != nil {
		return 0, err
	}

	written := len(entries)
	if written > maxExportRows {
		written = maxExportRows
	}
	return written, nil
}

// ============================================================
//  Cleanup
// ============================================================

// maybeCleanup checks if the file exceeds the size limit and triggers cleanup.
func (m *Module) maybeCleanup() {
	info, err := os.Stat(m.cfg.FilePath)
	if err != nil {
		return
	}
	if info.Size() > m.cfg.MaxFileSizeMB*1024*1024 {
		m.cleanupRetention()
	}
}

// cleanupRetention removes entries older than RetentionDays from the log file.
// It uses an atomic write-via-tempfile strategy.
func (m *Module) cleanupRetention() {
	cutoff := time.Now().AddDate(0, 0, -m.cfg.RetentionDays)
	tmpPath := m.cfg.FilePath + ".tmp"

	f, err := os.Open(m.cfg.FilePath)
	if err != nil {
		if !os.IsNotExist(err) {
			log.Printf("AUDIT ERROR: cleanup open: %v", err)
		}
		return
	}
	defer f.Close()

	tmp, err := os.Create(tmpPath)
	if err != nil {
		log.Printf("AUDIT ERROR: cleanup create tmp: %v", err)
		f.Close()
		return
	}
	tmpName := tmp.Name()

	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	kept := 0
	removed := 0

	for scanner.Scan() {
		line := scanner.Text()
		if line == "" {
			continue
		}

		var e Entry
		if err := json.Unmarshal([]byte(line), &e); err != nil {
			// Keep unparseable lines
			tmp.Write([]byte(line + "\n"))
			kept++
			continue
		}

		t, err := time.Parse(time.RFC3339, e.Timestamp)
		if err != nil {
			// Keep entries with unparseable timestamps
			tmp.Write([]byte(line + "\n"))
			kept++
			continue
		}

		if t.Before(cutoff) {
			removed++
			continue
		}

		tmp.Write([]byte(line + "\n"))
		kept++
	}

	tmp.Close()
	f.Close()

	if err := scanner.Err(); err != nil {
		log.Printf("AUDIT ERROR: cleanup scan: %v", err)
		os.Remove(tmpName)
		return
	}

	if err := os.Rename(tmpName, m.cfg.FilePath); err != nil {
		log.Printf("AUDIT ERROR: cleanup rename: %v", err)
		os.Remove(tmpName)
		return
	}

	log.Printf("AUDIT: cleanup complete — kept %d, removed %d entries older than %d days",
		kept, removed, m.cfg.RetentionDays)
}

// ============================================================
//  Convenience constructors
// ============================================================

// NewEntry creates a validated Entry. Returns an error if action is invalid.
func NewEntry(username, sourceIP string, action Action, target string, result Result, detail string) (Entry, error) {
	if !validActions[action] {
		return Entry{}, fmt.Errorf("invalid audit action: %s", action)
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

// ============================================================
//  Trusted proxy handling
// ============================================================

var (
	trustedProxyOnce sync.Once
	trustedProxySet  map[string]struct{}
)

// trustedProxies returns the set of proxy IPs whose forwarded headers
// (X-Forwarded-For / X-Real-IP) are trusted. Loopback addresses are trusted
// by default; extend via the TRUSTED_PROXY_IPS environment variable
// (comma-separated, e.g. "TRUSTED_PROXY_IPS=10.0.0.1,10.0.0.2").
func trustedProxies() map[string]struct{} {
	trustedProxyOnce.Do(func() {
		// Only build the default set when no test override is installed.
		if trustedProxySet != nil {
			return
		}
		trustedProxySet = map[string]struct{}{
			"127.0.0.1": {},
			"::1":       {},
		}
		if raw := os.Getenv("TRUSTED_PROXY_IPS"); raw != "" {
			for _, part := range strings.Split(raw, ",") {
				if ip := net.ParseIP(strings.TrimSpace(part)); ip != nil {
					trustedProxySet[ip.String()] = struct{}{}
				}
			}
		}
	})
	return trustedProxySet
}

// setTrustedProxiesForTest replaces the trusted proxy set (testing only).
// With no arguments the override is cleared and the next access re-reads the
// TRUSTED_PROXY_IPS environment variable.
func setTrustedProxiesForTest(ips ...string) {
	trustedProxyOnce = sync.Once{}
	if len(ips) == 0 {
		trustedProxySet = nil
		return
	}
	set := map[string]struct{}{}
	for _, ip := range ips {
		set[ip] = struct{}{}
	}
	trustedProxySet = set
}

// ExtractClientIP extracts the client IP from a request.
//
// Forwarded headers (X-Forwarded-For / X-Real-IP) are only trusted when the
// immediate TCP peer (RemoteAddr) is a trusted proxy — loopback by default,
// extendable via TRUSTED_PROXY_IPS. Otherwise the peer address itself is
// returned, so a client that connects directly cannot forge its source IP in
// the audit log by sending a fake X-Forwarded-For header.
//
// When the peer is a trusted proxy, the rightmost X-Forwarded-For entry that
// is not itself a trusted proxy is used: that is the client as observed by
// the outermost trusted proxy, so forged entries appended by the client (e.g.
// via nginx's $proxy_add_x_forwarded_for) are ignored. X-Real-IP is used as a
// fallback (nginx sets it from $remote_addr), then the peer address.
func ExtractClientIP(r *http.Request) string {
	peer := peerIP(r.RemoteAddr)

	trusted := trustedProxies()
	if _, ok := trusted[peer]; !ok {
		// Direct connection or untrusted intermediary: never trust
		// client-supplied forwarded headers.
		return peer
	}

	// Peer is a trusted proxy: walk X-Forwarded-For right-to-left and return
	// the first entry that is not itself a trusted proxy.
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		parts := strings.Split(xff, ",")
		for i := len(parts) - 1; i >= 0; i-- {
			ip := net.ParseIP(strings.TrimSpace(parts[i]))
			if ip == nil {
				continue
			}
			if _, isProxy := trusted[ip.String()]; !isProxy {
				return ip.String()
			}
		}
	}

	// Fall back to X-Real-IP (only read because the peer is already confirmed
	// to be a trusted proxy).
	if xri := r.Header.Get("X-Real-IP"); xri != "" {
		if ip := net.ParseIP(strings.TrimSpace(xri)); ip != nil {
			return ip.String()
		}
	}

	return peer
}

// peerIP extracts the IP portion of a RemoteAddr ("host:port"), returning
// the input unchanged when it has no port.
func peerIP(remoteAddr string) string {
	host, _, err := net.SplitHostPort(remoteAddr)
	if err != nil {
		return remoteAddr
	}
	if ip := net.ParseIP(host); ip != nil {
		return ip.String()
	}
	return host
}

// ============================================================
//  Helpers
// ============================================================

func dirOf(path string) string {
	if idx := lastSlash(path); idx > 0 {
		return path[:idx]
	}
	return ""
}

func lastSlash(s string) int {
	for i := len(s) - 1; i >= 0; i-- {
		if s[i] == '/' {
			return i
		}
	}
	return -1
}
