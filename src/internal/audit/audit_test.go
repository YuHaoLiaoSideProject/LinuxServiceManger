package audit

import (
	"bytes"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

// tempFilePath returns a path inside the test's temporary directory.
func tempFilePath(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	return filepath.Join(dir, "audit.jsonl")
}

// ============================================================
//  TestNewEntry
// ============================================================

func TestNewEntry_Valid(t *testing.T) {
	e, err := NewEntry("admin", "127.0.0.1", ActionLogin, "-", ResultSuccess, "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if e.Username != "admin" {
		t.Errorf("expected username 'admin', got %q", e.Username)
	}
	if e.Action != ActionLogin {
		t.Errorf("expected action login, got %q", e.Action)
	}
	if e.Timestamp == "" {
		t.Error("timestamp should not be empty")
	}
}

func TestNewEntry_InvalidAction(t *testing.T) {
	_, err := NewEntry("admin", "127.0.0.1", Action("delete"), "-", ResultSuccess, "")
	if err == nil {
		t.Error("expected error for invalid action")
	}
	if err != nil && !strings.Contains(err.Error(), "invalid audit action") {
		t.Errorf("expected 'invalid audit action' error, got: %v", err)
	}
}

// ============================================================
//  TestWriteAndQuery
// ============================================================

func TestWriteAndQuery(t *testing.T) {
	path := tempFilePath(t)
	m := New(Config{FilePath: path, WriteBufSize: 10})
	defer m.Shutdown()

	// Write several entries
	now := time.Now().UTC()
	for i := 0; i < 5; i++ {
		ts := now.Add(-time.Duration(i) * time.Hour).Format(time.RFC3339)
		e := Entry{
			Timestamp: ts,
			Username:  "admin",
			SourceIP:  "10.0.0.1",
			Action:    ActionStart,
			Target:    "nginx.service",
			Result:    ResultSuccess,
		}
		m.Write(e)
	}

	// Shutdown to ensure all entries are flushed
	m.Shutdown()

	// Query
	result, err := m.Query(QueryParams{Page: 1, Limit: 10})
	if err != nil {
		t.Fatalf("query error: %v", err)
	}
	if result.Total != 5 {
		t.Errorf("expected 5 entries, got %d", result.Total)
	}
	if len(result.Entries) != 5 {
		t.Errorf("expected 5 entries in page, got %d", len(result.Entries))
	}

	// Verify time-descending order
	for i := 0; i < len(result.Entries)-1; i++ {
		if result.Entries[i].Timestamp < result.Entries[i+1].Timestamp {
			t.Error("entries not sorted time-descending")
		}
	}
}

// ============================================================
//  TestQueryPagination
// ============================================================

func TestQueryPagination(t *testing.T) {
	path := tempFilePath(t)
	m := New(Config{FilePath: path, WriteBufSize: 100})
	defer m.Shutdown()

	now := time.Now().UTC()
	for i := 0; i < 15; i++ {
		ts := now.Add(-time.Duration(i) * time.Hour).Format(time.RFC3339)
		m.Write(Entry{Timestamp: ts, Username: "admin", SourceIP: "10.0.0.1", Action: ActionStart, Target: "nginx.service", Result: ResultSuccess})
	}
	m.Shutdown()

	// Page 1, limit 5
	res, err := m.Query(QueryParams{Page: 1, Limit: 5})
	if err != nil {
		t.Fatalf("query error: %v", err)
	}
	if len(res.Entries) != 5 || res.Total != 15 || res.Page != 1 || res.Limit != 5 {
		t.Errorf("page1: entries=%d total=%d page=%d limit=%d", len(res.Entries), res.Total, res.Page, res.Limit)
	}

	// Page 2
	res, err = m.Query(QueryParams{Page: 2, Limit: 5})
	if err != nil {
		t.Fatalf("query error: %v", err)
	}
	if len(res.Entries) != 5 || res.Total != 15 {
		t.Errorf("page2: entries=%d total=%d", len(res.Entries), res.Total)
	}

	// Page 3
	res, err = m.Query(QueryParams{Page: 3, Limit: 5})
	if err != nil {
		t.Fatalf("query error: %v", err)
	}
	if len(res.Entries) != 5 || res.Total != 15 {
		t.Errorf("page3: entries=%d total=%d", len(res.Entries), res.Total)
	}
}

// ============================================================
//  TestQuerySearch
// ============================================================

func TestQuerySearch(t *testing.T) {
	path := tempFilePath(t)
	m := New(Config{FilePath: path, WriteBufSize: 10})
	defer m.Shutdown()

	m.Write(Entry{Timestamp: time.Now().UTC().Format(time.RFC3339), Username: "admin", SourceIP: "10.0.0.1", Action: ActionStart, Target: "nginx.service", Result: ResultSuccess})
	m.Write(Entry{Timestamp: time.Now().UTC().Format(time.RFC3339), Username: "operator", SourceIP: "10.0.0.2", Action: ActionStop, Target: "ssh.service", Result: ResultFailure, Detail: "permission denied"})
	m.Shutdown()

	// Search by username
	res, err := m.Query(QueryParams{Page: 1, Limit: 10, Search: "admin"})
	if err != nil {
		t.Fatalf("query error: %v", err)
	}
	if res.Total != 1 {
		t.Errorf("search admin: expected 1, got %d", res.Total)
	}

	// Search by action (case-insensitive)
	res, err = m.Query(QueryParams{Page: 1, Limit: 10, Search: "STOP"})
	if err != nil {
		t.Fatalf("query error: %v", err)
	}
	if res.Total != 1 {
		t.Errorf("search STOP: expected 1, got %d", res.Total)
	}

	// Search by target
	res, err = m.Query(QueryParams{Page: 1, Limit: 10, Search: "ssh"})
	if err != nil {
		t.Fatalf("query error: %v", err)
	}
	if res.Total != 1 {
		t.Errorf("search ssh: expected 1, got %d", res.Total)
	}

	// Search with no match
	res, err = m.Query(QueryParams{Page: 1, Limit: 10, Search: "nonexistent"})
	if err != nil {
		t.Fatalf("query error: %v", err)
	}
	if res.Total != 0 {
		t.Errorf("search nonexistent: expected 0, got %d", res.Total)
	}
}

// ============================================================
//  TestQuerySearchLocalizedLabels
// ============================================================

// Search must also match the localized display labels shown in the UI
// (e.g. "登入" for login) — regression test for the bug where searching
// the visible action text returned no records.
func TestQuerySearchLocalizedLabels(t *testing.T) {
	path := tempFilePath(t)
	m := New(Config{FilePath: path, WriteBufSize: 10})
	defer m.Shutdown()

	now := time.Now().UTC()
	m.Write(Entry{Timestamp: now.Format(time.RFC3339), Username: "admin", SourceIP: "10.0.0.1", Action: ActionLogin, Target: "-", Result: ResultSuccess})
	m.Write(Entry{Timestamp: now.Format(time.RFC3339), Username: "admin", SourceIP: "10.0.0.1", Action: ActionLogout, Target: "-", Result: ResultSuccess})
	m.Write(Entry{Timestamp: now.Format(time.RFC3339), Username: "operator", SourceIP: "10.0.0.2", Action: ActionStart, Target: "nginx.service", Result: ResultSuccess})
	m.Shutdown()

	cases := []struct {
		search string
		want   int
	}{
		{"登入", 1},
		{"登出", 1},
		{"登", 2},
		{"啟動", 1},
		{"login", 1}, // raw action value still matches
		{"STOP", 0},
	}
	for _, c := range cases {
		res, err := m.Query(QueryParams{Page: 1, Limit: 10, Search: c.search})
		if err != nil {
			t.Fatalf("query error for %q: %v", c.search, err)
		}
		if res.Total != c.want {
			t.Errorf("search %q: expected %d, got %d", c.search, c.want, res.Total)
		}
	}
}

// ============================================================
//  TestQueryDateRange
// ============================================================

func TestQueryDateRange(t *testing.T) {
	path := tempFilePath(t)
	m := New(Config{FilePath: path, WriteBufSize: 10})
	defer m.Shutdown()

	// Entries on Jan 1, Jan 2, Jan 3
	m.Write(Entry{Timestamp: "2025-01-01T12:00:00Z", Username: "admin", SourceIP: "10.0.0.1", Action: ActionStart, Target: "a.service", Result: ResultSuccess})
	m.Write(Entry{Timestamp: "2025-01-02T12:00:00Z", Username: "admin", SourceIP: "10.0.0.1", Action: ActionStart, Target: "b.service", Result: ResultSuccess})
	m.Write(Entry{Timestamp: "2025-01-03T12:00:00Z", Username: "admin", SourceIP: "10.0.0.1", Action: ActionStart, Target: "c.service", Result: ResultSuccess})
	m.Shutdown()

	// Filter from 2025-01-02
	res, err := m.Query(QueryParams{Page: 1, Limit: 10, From: "2025-01-02"})
	if err != nil {
		t.Fatalf("query error: %v", err)
	}
	if res.Total != 2 {
		t.Errorf("from 2025-01-02: expected 2, got %d", res.Total)
	}

	// Filter to 2025-01-02
	res, err = m.Query(QueryParams{Page: 1, Limit: 10, To: "2025-01-02"})
	if err != nil {
		t.Fatalf("query error: %v", err)
	}
	if res.Total != 2 {
		t.Errorf("to 2025-01-02: expected 2 (jan 1 + jan 2), got %d", res.Total)
	}

	// Range
	res, err = m.Query(QueryParams{Page: 1, Limit: 10, From: "2025-01-02", To: "2025-01-03"})
	if err != nil {
		t.Fatalf("query error: %v", err)
	}
	if res.Total != 2 {
		t.Errorf("range jan 2-3: expected 2, got %d", res.Total)
	}
}

// ============================================================
//  TestQueryEmptyFile
// ============================================================

func TestQueryEmptyFile(t *testing.T) {
	path := tempFilePath(t)
	// Don't create the file at all
	m := New(Config{FilePath: path})
	defer m.Shutdown()

	res, err := m.Query(QueryParams{Page: 1, Limit: 10})
	if err != nil {
		t.Fatalf("query on empty file should not error: %v", err)
	}
	if res.Total != 0 || len(res.Entries) != 0 {
		t.Errorf("expected empty result, got %d entries", len(res.Entries))
	}
}

// ============================================================
//  TestExportCSV
// ============================================================

func TestExportCSV(t *testing.T) {
	path := tempFilePath(t)
	m := New(Config{FilePath: path, WriteBufSize: 10})
	defer m.Shutdown()

	m.Write(Entry{Timestamp: "2025-01-01T12:00:00Z", Username: "admin", SourceIP: "10.0.0.1", Action: ActionStart, Target: "nginx.service", Result: ResultSuccess})
	m.Write(Entry{Timestamp: "2025-01-01T13:00:00Z", Username: "operator", SourceIP: "10.0.0.2", Action: ActionStop, Target: "ssh.service", Result: ResultFailure, Detail: "error"})
	m.Shutdown()

	var buf bytes.Buffer
	count, err := m.ExportCSV(&buf, QueryParams{})
	if err != nil {
		t.Fatalf("export error: %v", err)
	}
	if count != 2 {
		t.Errorf("expected 2 rows, got %d", count)
	}

	// Parse CSV
	r := csv.NewReader(&buf)
	records, err := r.ReadAll()
	if err != nil {
		t.Fatalf("csv parse error: %v", err)
	}

	if len(records) != 3 { // header + 2 rows
		t.Errorf("expected 3 CSV lines (header + 2), got %d", len(records))
	}

	header := records[0]
	expectedHeader := []string{"timestamp", "username", "source_ip", "action", "target", "result", "detail"}
	for i, h := range expectedHeader {
		if header[i] != h {
			t.Errorf("header[%d]: expected %q, got %q", i, h, header[i])
		}
	}
}

// ============================================================
//  TestCleanupRetention
// ============================================================

func TestCleanupRetention(t *testing.T) {
	path := tempFilePath(t)
	m := New(Config{FilePath: path, RetentionDays: 30})
	defer m.Shutdown()

	// Write an entry from 60 days ago
	old := time.Now().UTC().AddDate(0, 0, -60).Format(time.RFC3339)
	m.Write(Entry{Timestamp: old, Username: "admin", SourceIP: "10.0.0.1", Action: ActionLogin, Target: "-", Result: ResultSuccess})

	// Write a recent entry
	recent := time.Now().UTC().Format(time.RFC3339)
	m.Write(Entry{Timestamp: recent, Username: "operator", SourceIP: "10.0.0.2", Action: ActionLogin, Target: "-", Result: ResultSuccess})
	m.Shutdown()

	// Trigger cleanup explicitly
	m.cleanupRetention()

	// Query should only return the recent entry
	res, err := m.Query(QueryParams{Page: 1, Limit: 10})
	if err != nil {
		t.Fatalf("query error: %v", err)
	}
	if res.Total != 1 {
		t.Errorf("expected 1 entry after cleanup, got %d", res.Total)
	}
	if res.Total > 0 && res.Entries[0].Username != "operator" {
		t.Errorf("expected recent entry to remain, got username=%q", res.Entries[0].Username)
	}
}

// ============================================================
//  TestExtractClientIP
// ============================================================

func TestExtractClientIP(t *testing.T) {
	// Isolate from any TRUSTED_PROXY_IPS on the host machine.
	setTrustedProxiesForTest("127.0.0.1", "::1")

	tests := []struct {
		name          string
		xForwardedFor string
		xRealIP       string
		remoteAddr    string
		expected      string
	}{
		{
			name:          "through trusted proxy, single XFF",
			xForwardedFor: "192.168.1.100",
			remoteAddr:    "127.0.0.1:54321",
			expected:      "192.168.1.100",
		},
		{
			name:          "through trusted proxy, spoofed XFF ignored",
			xForwardedFor: "8.8.8.8, 192.168.1.100",
			remoteAddr:    "127.0.0.1:54321",
			expected:      "192.168.1.100",
		},
		{
			name:          "through trusted proxy, spoofed multi-hop XFF ignored",
			xForwardedFor: "1.1.1.1, 2.2.2.2, 192.168.1.100",
			remoteAddr:    "127.0.0.1:54321",
			expected:      "192.168.1.100",
		},
		{
			name:       "through trusted proxy, X-Real-IP fallback",
			xRealIP:    "192.168.1.100",
			remoteAddr: "127.0.0.1:54321",
			expected:   "192.168.1.100",
		},
		{
			name:       "through trusted proxy, no headers, use peer",
			remoteAddr: "127.0.0.1:54321",
			expected:   "127.0.0.1",
		},
		{
			name:          "direct connection, spoofed XFF ignored",
			xForwardedFor: "8.8.8.8",
			remoteAddr:    "10.0.0.5:12345",
			expected:      "10.0.0.5",
		},
		{
			name:       "direct connection, spoofed X-Real-IP ignored",
			xRealIP:    "8.8.8.8",
			remoteAddr: "10.0.0.5:12345",
			expected:   "10.0.0.5",
		},
		{
			name:       "no X-Forwarded-For, use RemoteAddr",
			remoteAddr: "10.0.0.5:12345",
			expected:   "10.0.0.5",
		},
		{
			name:       "IPv6 loopback peer (trusted)",
			remoteAddr: "[::1]:12345",
			expected:   "::1",
		},
		{
			name:          "IPv4-mapped IPv6 normalized",
			xForwardedFor: "192.168.1.100",
			remoteAddr:    "[::ffff:127.0.0.1]:12345",
			expected:      "192.168.1.100",
		},
		{
			name:       "RemoteAddr without port",
			remoteAddr: "10.0.0.5",
			expected:   "10.0.0.5",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/", nil)
			if tt.xForwardedFor != "" {
				req.Header.Set("X-Forwarded-For", tt.xForwardedFor)
			}
			if tt.xRealIP != "" {
				req.Header.Set("X-Real-IP", tt.xRealIP)
			}
			req.RemoteAddr = tt.remoteAddr

			ip := ExtractClientIP(req)
			if ip != tt.expected {
				t.Errorf("expected %q, got %q", tt.expected, ip)
			}
		})
	}
}

func TestExtractClientIP_TrustedProxyChain(t *testing.T) {
	// client(192.168.1.100) → proxyA(10.0.0.1) → proxyB(10.0.0.2) → app
	setTrustedProxiesForTest("127.0.0.1", "::1", "10.0.0.1", "10.0.0.2")
	defer setTrustedProxiesForTest("127.0.0.1", "::1")

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.RemoteAddr = "10.0.0.2:12345"
	req.Header.Set("X-Forwarded-For", "192.168.1.100, 10.0.0.1")

	if ip := ExtractClientIP(req); ip != "192.168.1.100" {
		t.Errorf("expected %q, got %q", "192.168.1.100", ip)
	}
}

func TestExtractClientIP_TrustedProxyEnv(t *testing.T) {
	// Clear the override so the next trustedProxies() call re-reads the env.
	setTrustedProxiesForTest()
	defer setTrustedProxiesForTest("127.0.0.1", "::1")
	t.Setenv("TRUSTED_PROXY_IPS", "10.0.0.1")

	// Peer listed in TRUSTED_PROXY_IPS: forwarded header is trusted.
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.RemoteAddr = "10.0.0.1:9999"
	req.Header.Set("X-Forwarded-For", "192.168.1.100")
	if ip := ExtractClientIP(req); ip != "192.168.1.100" {
		t.Errorf("expected %q, got %q", "192.168.1.100", ip)
	}

	// Peer not in the list: spoofed header ignored.
	req2 := httptest.NewRequest(http.MethodGet, "/", nil)
	req2.RemoteAddr = "10.0.0.2:9999"
	req2.Header.Set("X-Forwarded-For", "8.8.8.8")
	if ip := ExtractClientIP(req2); ip != "10.0.0.2" {
		t.Errorf("expected %q, got %q", "10.0.0.2", ip)
	}
}

// ============================================================
//  TestNonBlockingWrite
// ============================================================

func TestNonBlockingWrite(t *testing.T) {
	path := tempFilePath(t)
	// Use a very small buffer to test non-blocking behavior
	m := New(Config{FilePath: path, WriteBufSize: 1})

	// Fill the buffer quickly by blocking the writer (don't consume from ch)
	// First write fills the buffer
	e := Entry{Timestamp: time.Now().UTC().Format(time.RFC3339), Username: "admin", SourceIP: "10.0.0.1", Action: ActionLogin, Target: "-", Result: ResultSuccess}
	m.Write(e) // should go to channel
	// Second write should drop (channel full, writer hasn't consumed yet)
	m.Write(e) // may or may not drop depending on timing

	// After shutdown, at least 1 entry should be written
	m.Shutdown()

	// Verify we didn't crash
	res, err := m.Query(QueryParams{Page: 1, Limit: 10})
	if err != nil {
		t.Fatalf("query error: %v", err)
	}
	// At least 1 entry made it through
	if res.Total < 1 {
		t.Error("expected at least 1 entry after writes")
	}
}

// ============================================================
//  TestCorruptedLines
// ============================================================

func TestCorruptedLines(t *testing.T) {
	path := tempFilePath(t)
	m := New(Config{FilePath: path, WriteBufSize: 10})
	defer m.Shutdown()

	m.Write(Entry{Timestamp: time.Now().UTC().Format(time.RFC3339), Username: "admin", SourceIP: "10.0.0.1", Action: ActionLogin, Target: "-", Result: ResultSuccess})
	m.Shutdown()

	// Append a corrupted line to the file
	f, err := os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0644)
	if err != nil {
		t.Fatalf("open error: %v", err)
	}
	f.WriteString("this is not valid json\n")
	f.Close()

	res, err := m.Query(QueryParams{Page: 1, Limit: 10})
	if err != nil {
		t.Fatalf("query error: %v", err)
	}
	// Should still get the one valid entry
	if res.Total != 1 {
		t.Errorf("expected 1 valid entry, got %d", res.Total)
	}
}

// ============================================================
//  TestDefaultConfig
// ============================================================

func TestDefaultConfig(t *testing.T) {
	cfg := Config{}
	cfg.defaults()
	if cfg.FilePath != "/var/lib/linux-service-manager/audit.jsonl" {
		t.Errorf("default FilePath: got %q", cfg.FilePath)
	}
	if cfg.MaxFileSizeMB != 100 {
		t.Errorf("default MaxFileSizeMB: got %d", cfg.MaxFileSizeMB)
	}
	if cfg.RetentionDays != 90 {
		t.Errorf("default RetentionDays: got %d", cfg.RetentionDays)
	}
	if cfg.WriteBufSize != 100 {
		t.Errorf("default WriteBufSize: got %d", cfg.WriteBufSize)
	}
}

// ============================================================
//  TestLimitClamp
// ============================================================

func TestLimitClamp(t *testing.T) {
	path := tempFilePath(t)
	m := New(Config{FilePath: path})
	defer m.Shutdown()

	// QueryParams with limit=0 should default to 50
	res, err := m.Query(QueryParams{Page: 1, Limit: 0})
	if err != nil {
		t.Fatalf("query error: %v", err)
	}
	if res.Limit != 50 {
		t.Errorf("expected limit 50 (clamped from 0), got %d", res.Limit)
	}

	// QueryParams with limit=200 should clamp to 100
	res, err = m.Query(QueryParams{Page: 1, Limit: 200})
	if err != nil {
		t.Fatalf("query error: %v", err)
	}
	if res.Limit != 100 {
		t.Errorf("expected limit 100 (clamped from 200), got %d", res.Limit)
	}
}

// ============================================================
//  TestAllValidActions
// ============================================================

func TestAllValidActions(t *testing.T) {
	actions := []Action{ActionLogin, ActionLogout, ActionStart, ActionStop, ActionRestart, ActionEnable, ActionDisable}
	for _, a := range actions {
		e, err := NewEntry("admin", "127.0.0.1", a, "test.service", ResultSuccess, "")
		if err != nil {
			t.Errorf("unexpected error for action %q: %v", a, err)
		}
		if e.Action != a {
			t.Errorf("expected action %q, got %q", a, e.Action)
		}
	}
}

// ============================================================
//  TestModuleWriteJSONSerialization
// ============================================================

func TestModuleWriteJSONSerialization(t *testing.T) {
	path := tempFilePath(t)
	m := New(Config{FilePath: path, WriteBufSize: 10})
	defer m.Shutdown()

	entry, err := NewEntry("admin", "127.0.0.1", ActionStart, "nginx.service", ResultSuccess, "test detail")
	if err != nil {
		t.Fatalf("NewEntry error: %v", err)
	}
	m.Write(entry)
	m.Shutdown()

	// Read the file and verify JSON
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read file error: %v", err)
	}
	lines := strings.Split(strings.TrimSpace(string(data)), "\n")
	if len(lines) != 1 {
		t.Fatalf("expected 1 line, got %d", len(lines))
	}

	var parsed Entry
	if err := json.Unmarshal([]byte(lines[0]), &parsed); err != nil {
		t.Fatalf("json parse error: %v", err)
	}
	if parsed.Username != "admin" {
		t.Errorf("username: got %q", parsed.Username)
	}
	if parsed.Action != ActionStart {
		t.Errorf("action: got %q", parsed.Action)
	}
	if parsed.Target != "nginx.service" {
		t.Errorf("target: got %q", parsed.Target)
	}
	if parsed.Result != ResultSuccess {
		t.Errorf("result: got %q", parsed.Result)
	}
	if parsed.Detail != "test detail" {
		t.Errorf("detail: got %q", parsed.Detail)
	}
}

// ============================================================
//  TestNoSensitiveData — SYS-06
// ============================================================

func TestNoSensitiveData(t *testing.T) {
	// Verify that Entry struct serialization does not contain
	// fields for password, token, or session data.
	entry, err := NewEntry("admin", "127.0.0.1", ActionLogin, "-", ResultSuccess, "")
	if err != nil {
		t.Fatalf("NewEntry error: %v", err)
	}

	data, err := json.Marshal(entry)
	if err != nil {
		t.Fatalf("marshal error: %v", err)
	}

	jsonStr := strings.ToLower(string(data))

	// Must NOT contain sensitive fields
	for _, sensitive := range []string{"password", "token", "secret", "session", "cookie", "jwt", "api_key", "apikey"} {
		if strings.Contains(jsonStr, sensitive) {
			t.Errorf("audit entry contains sensitive field %q: %s", sensitive, jsonStr)
		}
	}

	// Verify only known safe fields are present
	var parsed map[string]interface{}
	if err := json.Unmarshal(data, &parsed); err != nil {
		t.Fatalf("json unmarshal: %v", err)
	}
	allowedFields := map[string]bool{
		"timestamp": true,
		"username":  true,
		"source_ip": true,
		"action":    true,
		"target":    true,
		"result":    true,
		"detail":    true,
	}
	for key := range parsed {
		if !allowedFields[key] {
			t.Errorf("unexpected field in audit entry: %q", key)
		}
	}
}

// ============================================================
//  TestExportCSVMaxRows — SYS-18
// ============================================================

func TestExportCSVMaxRows(t *testing.T) {
	path := tempFilePath(t)
	m := New(Config{FilePath: path, WriteBufSize: 200})
	defer m.Shutdown()

	// Write more than maxExportRows (10000) entries
	// We'll use a modest number to keep the test fast, but verify the
	// cap logic by passing limit explicitly.
	now := time.Now().UTC()
	for i := 0; i < 50; i++ {
		ts := now.Add(-time.Duration(i) * time.Minute).Format(time.RFC3339)
		m.Write(Entry{Timestamp: ts, Username: "admin", SourceIP: "10.0.0.1", Action: ActionStart, Target: "nginx.service", Result: ResultSuccess})
	}
	m.Shutdown()

	// ExportCSV internally caps limit at maxExportRows (10000)
	var buf bytes.Buffer
	count, err := m.ExportCSV(&buf, QueryParams{})
	if err != nil {
		t.Fatalf("export error: %v", err)
	}

	if count != 50 {
		t.Errorf("expected 50 rows exported, got %d", count)
	}

	// Count CSV rows (header + data)
	r := csv.NewReader(&buf)
	records, err := r.ReadAll()
	if err != nil {
		t.Fatalf("csv parse error: %v", err)
	}
	// header + 50 data rows
	if len(records) != 51 {
		t.Errorf("expected 51 CSV lines (1 header + 50 data), got %d", len(records))
	}
}

// ============================================================
//  TestExportCSVWithFilters — SYS-19
// ============================================================

func TestExportCSVWithFilters(t *testing.T) {
	path := tempFilePath(t)
	m := New(Config{FilePath: path, WriteBufSize: 10})
	defer m.Shutdown()

	m.Write(Entry{Timestamp: "2025-08-01T12:00:00Z", Username: "admin", SourceIP: "10.0.0.1", Action: ActionStart, Target: "nginx.service", Result: ResultSuccess})
	m.Write(Entry{Timestamp: "2025-08-02T12:00:00Z", Username: "operator", SourceIP: "10.0.0.2", Action: ActionStop, Target: "ssh.service", Result: ResultFailure, Detail: "permission denied"})
	m.Write(Entry{Timestamp: "2025-08-03T12:00:00Z", Username: "admin", SourceIP: "10.0.0.1", Action: ActionRestart, Target: "nginx.service", Result: ResultSuccess})
	m.Shutdown()

	// Export with search filter
	var buf bytes.Buffer
	count, err := m.ExportCSV(&buf, QueryParams{Search: "nginx"})
	if err != nil {
		t.Fatalf("export error: %v", err)
	}
	if count != 2 {
		t.Errorf("search 'nginx': expected 2, got %d", count)
	}

	// Export with date range filter
	var buf2 bytes.Buffer
	count, err = m.ExportCSV(&buf2, QueryParams{From: "2025-08-02", To: "2025-08-03"})
	if err != nil {
		t.Fatalf("export error: %v", err)
	}
	if count != 2 {
		t.Errorf("date range 08-02~03: expected 2, got %d", count)
	}

	// Export with both filters
	var buf3 bytes.Buffer
	count, err = m.ExportCSV(&buf3, QueryParams{Search: "ssh", From: "2025-08-01", To: "2025-08-02"})
	if err != nil {
		t.Fatalf("export error: %v", err)
	}
	if count != 1 {
		t.Errorf("search 'ssh' + date: expected 1, got %d", count)
	}

	// Verify CSV content parses correctly
	r := csv.NewReader(&buf3)
	records, err := r.ReadAll()
	if err != nil {
		t.Fatalf("csv parse error: %v", err)
	}
	if len(records) != 2 { // header + 1 row
		t.Errorf("expected 2 CSV lines, got %d", len(records))
	}
}

// ============================================================
//  TestCleanupAllWithinRetention — SYS-21
// ============================================================

func TestCleanupAllWithinRetention(t *testing.T) {
	path := tempFilePath(t)
	m := New(Config{FilePath: path, RetentionDays: 90})
	defer m.Shutdown()

	// Write only recent entries (within 90 days)
	now := time.Now().UTC()
	for i := 0; i < 5; i++ {
		ts := now.AddDate(0, 0, -i*10).Format(time.RFC3339) // 0, 10, 20... 40 days ago
		m.Write(Entry{Timestamp: ts, Username: "admin", SourceIP: "10.0.0.1", Action: ActionLogin, Target: "-", Result: ResultSuccess})
	}
	m.Shutdown()

	// Trigger cleanup
	m.cleanupRetention()

	// All 5 entries should remain
	res, err := m.Query(QueryParams{Page: 1, Limit: 10})
	if err != nil {
		t.Fatalf("query error: %v", err)
	}
	if res.Total != 5 {
		t.Errorf("expected all 5 entries to remain (all within retention), got %d", res.Total)
	}
}

// ============================================================
//  TestFileSizeWarning — SYS-22
// ============================================================

func TestFileSizeWarning(t *testing.T) {
	path := tempFilePath(t)
	m := New(Config{FilePath: path, WriteBufSize: 20})
	defer m.Shutdown()

	// Force a very small file-size threshold to trigger cleanup check.
	// After New(), override the config so maybeCleanup fires on any
	// non-empty file (file.Size() > 0).
	m.cfg.MaxFileSizeMB = 0

	now := time.Now().UTC()
	for i := 0; i < 15; i++ {
		ts := now.Add(-time.Duration(i) * time.Hour).Format(time.RFC3339)
		m.Write(Entry{Timestamp: ts, Username: "admin", SourceIP: "10.0.0.1", Action: ActionLogin, Target: "-", Result: ResultSuccess})
	}
	// maybeCleanup is called every 10 writes → at least 1 invocation
	m.Shutdown()

	// All entries are recent — none should be removed after cleanup
	res, err := m.Query(QueryParams{Page: 1, Limit: 20})
	if err != nil {
		t.Fatalf("query error: %v", err)
	}
	if res.Total != 15 {
		t.Errorf("expected 15 entries after cleanup (all recent), got %d", res.Total)
	}
}

// ============================================================
//  TestExportCSVTenThousandCap — MAN-01
// ============================================================

func TestExportCSVTenThousandCap(t *testing.T) {
	path := tempFilePath(t)
	// Use buffer large enough for 11k writes
	m := New(Config{FilePath: path, WriteBufSize: 12000})

	now := time.Now().UTC()
	for i := 0; i < 11000; i++ {
		ts := now.Add(-time.Duration(i) * time.Second).Format(time.RFC3339)
		m.Write(Entry{Timestamp: ts, Username: "admin", SourceIP: "10.0.0.1", Action: ActionLogin, Target: "-", Result: ResultSuccess})
	}
	m.Shutdown()

	// Export — should be capped at 10000
	var buf bytes.Buffer
	count, err := m.ExportCSV(&buf, QueryParams{})
	if err != nil {
		t.Fatalf("export error: %v", err)
	}

	if count > 10000 {
		t.Errorf("expected max 10000 rows exported, got %d", count)
	}
	if count < 10000 {
		t.Errorf("expected exactly 10000 rows (cap), got %d", count)
	}

	// Verify CSV row count
	r := csv.NewReader(&buf)
	records, err := r.ReadAll()
	if err != nil {
		t.Fatalf("csv parse error: %v", err)
	}
	// header + capped data rows
	if len(records) != 10001 {
		t.Errorf("expected 10001 CSV lines (1 header + 10000 data), got %d", len(records))
	}
}

// ============================================================
//  TestConcurrentWrites — MAN-06
// ============================================================

func TestConcurrentWrites(t *testing.T) {
	path := tempFilePath(t)
	m := New(Config{FilePath: path, WriteBufSize: 2000})

	var wg sync.WaitGroup
	writers := 10
	entriesPerWriter := 100

	now := time.Now().UTC()
	for w := 0; w < writers; w++ {
		wg.Add(1)
		go func(workerID int) {
			defer wg.Done()
			for i := 0; i < entriesPerWriter; i++ {
				ts := now.Add(-time.Duration(workerID*entriesPerWriter+i) * time.Second).Format(time.RFC3339)
				m.Write(Entry{
					Timestamp: ts,
					Username:  fmt.Sprintf("user-%d", workerID),
					SourceIP:  fmt.Sprintf("10.0.%d.%d", workerID, i%255+1),
					Action:    ActionStart,
					Target:    fmt.Sprintf("svc-%d.service", workerID),
					Result:    ResultSuccess,
				})
			}
		}(w)
	}
	wg.Wait()
	m.Shutdown()

	// All entries should be recorded (none lost due to race)
	res, err := m.Query(QueryParams{Page: 1, Limit: 2000})
	if err != nil {
		t.Fatalf("query error: %v", err)
	}
	if res.Total != writers*entriesPerWriter {
		t.Errorf("expected %d entries, got %d", writers*entriesPerWriter, res.Total)
	}

	// Verify entries are sorted time-descending
	for i := 0; i < len(res.Entries)-1; i++ {
		if res.Entries[i].Timestamp < res.Entries[i+1].Timestamp {
			t.Errorf("concurrent entries not sorted time-descending at index %d", i)
			break
		}
	}
}

// ============================================================
//  TestWriteAuditDiskFull — SYS-03
// ============================================================

func TestWriteAuditDiskFull(t *testing.T) {
	// Create a read-only directory to simulate disk-full behavior
	dir := t.TempDir()
	readOnlyDir := filepath.Join(dir, "readonly")
	if err := os.MkdirAll(readOnlyDir, 0444); err != nil {
		t.Fatalf("failed to create readonly dir: %v", err)
	}
	// Remove write permission after creation
	if err := os.Chmod(readOnlyDir, 0444); err != nil {
		t.Fatalf("chmod: %v", err)
	}

	path := filepath.Join(readOnlyDir, "audit.jsonl")
	m := New(Config{FilePath: path, WriteBufSize: 1})

	// Write should not panic even though the file can't be created
	e := Entry{Timestamp: time.Now().UTC().Format(time.RFC3339), Username: "admin", SourceIP: "10.0.0.1", Action: ActionLogin, Target: "-", Result: ResultSuccess}
	m.Write(e)   // should not panic
	m.Shutdown() // should not panic

	// Operation completed without crash — the audit failure is silent
	// (logged but not propagated)
}

// ============================================================
//  SYS-59: Entry 含 NodeID/NodeName 且 omitempty（向後相容）
// ============================================================

func TestEntryNodeFields_Serialization(t *testing.T) {
	// 既有單機紀錄（無節點欄位）→ 序列化不含 node_id/node_name（向後相容）
	legacy := Entry{
		Timestamp: "2025-08-13T10:00:00Z",
		Username:  "admin",
		SourceIP:  "127.0.0.1",
		Action:    ActionStart,
		Target:    "nginx.service",
		Result:    ResultSuccess,
	}
	data, err := json.Marshal(legacy)
	if err != nil {
		t.Fatalf("marshal legacy entry: %v", err)
	}
	if strings.Contains(string(data), "node_id") || strings.Contains(string(data), "node_name") {
		t.Errorf("legacy entry must not contain node fields (omitempty): %s", data)
	}

	// 跨節點操作（含節點欄位）→ 序列化含 node_id/node_name
	withNode := Entry{
		Timestamp: "2025-08-13T10:00:00Z",
		Username:  "admin",
		SourceIP:  "127.0.0.1",
		Action:    ActionRestart,
		Target:    "nginx.service",
		Result:    ResultSuccess,
		NodeID:    "node-123",
		NodeName:  "web-server-01",
	}
	data2, err := json.Marshal(withNode)
	if err != nil {
		t.Fatalf("marshal entry with node fields: %v", err)
	}
	var parsed map[string]any
	if err := json.Unmarshal(data2, &parsed); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if parsed["node_id"] != "node-123" {
		t.Errorf("node_id: got %v", parsed["node_id"])
	}
	if parsed["node_name"] != "web-server-01" {
		t.Errorf("node_name: got %v", parsed["node_name"])
	}

	// JSONL 回讀還原節點欄位（query / export 路徑）
	var roundTrip Entry
	if err := json.Unmarshal(data2, &roundTrip); err != nil {
		t.Fatalf("round-trip unmarshal: %v", err)
	}
	if roundTrip.NodeID != "node-123" || roundTrip.NodeName != "web-server-01" {
		t.Errorf("node fields lost in round-trip: %+v", roundTrip)
	}
}

// ============================================================
//  SYS-60: 節點操作 Action 常數與 display labels
// ============================================================

func TestNodeActionConstants(t *testing.T) {
	actions := []struct {
		action Action
		want   string
		label  string
	}{
		{ActionNodeCreate, "node_create", "新增節點"},
		{ActionNodeUpdate, "node_update", "更新節點"},
		{ActionNodeDelete, "node_delete", "移除節點"},
		{ActionNodeTestConnection, "node_test_connection", "測試節點連線"},
		{ActionNodeReconnect, "node_reconnect", "重新連線節點"},
	}
	for _, tc := range actions {
		t.Run(tc.want, func(t *testing.T) {
			if string(tc.action) != tc.want {
				t.Errorf("action value: got %q, want %q", tc.action, tc.want)
			}
			if label := actionDisplayLabels[tc.action]; label != tc.label {
				t.Errorf("display label for %q: got %q, want %q", tc.action, label, tc.label)
			}
			// validActions 需含新 Action → NewEntry 通過
			if _, err := NewEntry("admin", "127.0.0.1", tc.action, "web-server-01", ResultSuccess, ""); err != nil {
				t.Errorf("NewEntry failed for %q: %v", tc.action, err)
			}
		})
	}
}
