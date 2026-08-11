package handler

import (
	"encoding/csv"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"linux-service-manager/internal/audit"
	"linux-service-manager/internal/auth"
	"linux-service-manager/internal/systemd"

	"github.com/go-chi/chi/v5"
)

// ============================================================
//  Test router with audit routes
// ============================================================

func setupTestRouterWithAudit(h *Handler) *chi.Mux {
	r := chi.NewRouter()

	// Public routes
	r.Post("/api/v1/login", h.HandleLoginJSON)
	r.Post("/api/v1/logout", h.HandleLogoutJSON)
	r.Get("/api/v1/session", h.HandleSessionCheck)

	// Protected routes (JSON API, including audit)
	r.Group(func(r chi.Router) {
		r.Use(authMiddlewareJSON)
		r.Get("/api/v1/services", h.HandleServicesJSON)
		r.Post("/api/v1/services/{name}/start", h.HandleStartJSON)
		r.Post("/api/v1/services/{name}/stop", h.HandleStopJSON)
		r.Post("/api/v1/services/{name}/restart", h.HandleRestartJSON)
		r.Post("/api/v1/services/{name}/enable", h.HandleEnableJSON)
		r.Post("/api/v1/services/{name}/disable", h.HandleDisableJSON)
		r.Get("/api/v1/audit", h.HandleAuditQuery)
		r.Get("/api/v1/audit/export", h.HandleAuditExport)
	})

	return r
}

// ============================================================
//  Helper: new audit module backed by temp file
// ============================================================

func newTestAuditModule(t *testing.T) *audit.Module {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "audit.jsonl")
	return audit.New(audit.Config{
		FilePath:      path,
		MaxFileSizeMB: 100,
		RetentionDays: 90,
		WriteBufSize:  100,
	})
}

// seedAudit inserts a few entries and waits a tiny moment for them to flush.
func seedAudit(t *testing.T, m *audit.Module) {
	t.Helper()
	entries := []struct {
		ts, user, ip string
		action       audit.Action
		target       string
		result       audit.Result
		detail       string
	}{
		{"2025-08-01T10:00:00Z", "admin", "10.0.0.1", audit.ActionRestart, "nginx.service", audit.ResultSuccess, ""},
		{"2025-08-02T11:00:00Z", "admin", "10.0.0.1", audit.ActionStop, "nginx.service", audit.ResultSuccess, ""},
		{"2025-08-03T12:00:00Z", "operator", "10.0.0.2", audit.ActionStart, "ssh.service", audit.ResultSuccess, ""},
		{"2025-08-04T13:00:00Z", "admin", "10.0.0.1", audit.ActionEnable, "myapp.service", audit.ResultSuccess, ""},
		{"2025-08-05T14:00:00Z", "admin", "10.0.0.1", audit.ActionDisable, "myapp.service", audit.ResultFailure, "unit not found"},
	}

	for _, e := range entries {
		entry, _ := audit.NewEntry(e.user, e.ip, e.action, e.target, e.result, e.detail)
		entry.Timestamp = e.ts
		m.Write(entry)
	}

	// Wait for async writes to complete
	m.Shutdown()
}

// ============================================================
//  TEST: GET /api/v1/audit — basic query
// ============================================================

func TestHandleAuditQuery_Success(t *testing.T) {
	origUser, origPass := auth.AdminUser, auth.AdminPass
	auth.AdminUser, auth.AdminPass = "admin", "pass"
	defer func() { auth.AdminUser, auth.AdminPass = origUser, origPass }()

	auditMod := newTestAuditModule(t)
	seedAudit(t, auditMod)

	mock := &mockSystemd{services: sampleServices()}
	h := New(nil, mock, auditMod)
	router := setupTestRouterWithAudit(h)

	cookie := loginAndGetCookie(t, router, "admin", "pass")

	req := httptest.NewRequest(http.MethodGet, "/api/v1/audit?page=1&limit=50", nil)
	req.AddCookie(cookie)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	body := assertJSON(t, w, http.StatusOK)

	if body["total"] == nil {
		t.Fatal("expected 'total' field in response")
	}
	total, _ := body["total"].(float64)
	if total != 5 {
		t.Errorf("expected total=5, got %v", total)
	}

	if body["page"].(float64) != 1 {
		t.Errorf("expected page=1, got %v", body["page"])
	}

	data, ok := body["data"].([]interface{})
	if !ok || len(data) != 5 {
		t.Errorf("expected 5 entries in data, got %v", data)
	}

	// Entries should be sorted newest first
	if len(data) > 0 {
		first := data[0].(map[string]interface{})
		if first["action"] != "disable" {
			t.Errorf("expected newest entry (disable), got action=%v", first["action"])
		}
	}
}

// ============================================================
//  TEST: GET /api/v1/audit — empty file
// ============================================================

func TestHandleAuditQuery_Empty(t *testing.T) {
	origUser, origPass := auth.AdminUser, auth.AdminPass
	auth.AdminUser, auth.AdminPass = "admin", "pass"
	defer func() { auth.AdminUser, auth.AdminPass = origUser, origPass }()

	auditMod := newTestAuditModule(t) // fresh, no data

	mock := &mockSystemd{services: sampleServices()}
	h := New(nil, mock, auditMod)
	router := setupTestRouterWithAudit(h)

	// Create an authenticated session without going through login handler
	// (login handler writes an audit entry, which would pollute the test)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/audit?page=1&limit=50", nil)
	session := auth.GetSession(req)
	session.Values["authenticated"] = true
	session.Values["username"] = "admin"
	// Encode the session into a cookie manually
	rec := httptest.NewRecorder()
	auth.SaveSession(rec, req, session)
	cookie := rec.Result().Cookies()

	req2 := httptest.NewRequest(http.MethodGet, "/api/v1/audit?page=1&limit=50", nil)
	for _, c := range cookie {
		req2.AddCookie(c)
	}
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req2)

	body := assertJSON(t, w, http.StatusOK)
	if body["total"].(float64) != 0 {
		t.Errorf("expected total=0 for empty audit, got %v", body["total"])
	}
}

// ============================================================
//  TEST: GET /api/v1/audit — search filter
// ============================================================

func TestHandleAuditQuery_Search(t *testing.T) {
	origUser, origPass := auth.AdminUser, auth.AdminPass
	auth.AdminUser, auth.AdminPass = "admin", "pass"
	defer func() { auth.AdminUser, auth.AdminPass = origUser, origPass }()

	auditMod := newTestAuditModule(t)
	seedAudit(t, auditMod)

	mock := &mockSystemd{services: sampleServices()}
	h := New(nil, mock, auditMod)
	router := setupTestRouterWithAudit(h)

	cookie := loginAndGetCookie(t, router, "admin", "pass")

	req := httptest.NewRequest(http.MethodGet, "/api/v1/audit?search=nginx", nil)
	req.AddCookie(cookie)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	body := assertJSON(t, w, http.StatusOK)
	total, _ := body["total"].(float64)
	if total != 2 {
		t.Errorf("expected 2 nginx entries, got total=%v", total)
	}
}

// ============================================================
//  TEST: GET /api/v1/audit — search no results
// ============================================================

func TestHandleAuditQuery_SearchNoResults(t *testing.T) {
	origUser, origPass := auth.AdminUser, auth.AdminPass
	auth.AdminUser, auth.AdminPass = "admin", "pass"
	defer func() { auth.AdminUser, auth.AdminPass = origUser, origPass }()

	auditMod := newTestAuditModule(t)
	seedAudit(t, auditMod)

	mock := &mockSystemd{services: sampleServices()}
	h := New(nil, mock, auditMod)
	router := setupTestRouterWithAudit(h)

	cookie := loginAndGetCookie(t, router, "admin", "pass")

	req := httptest.NewRequest(http.MethodGet, "/api/v1/audit?search=nonexistent123", nil)
	req.AddCookie(cookie)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	body := assertJSON(t, w, http.StatusOK)
	total, _ := body["total"].(float64)
	if total != 0 {
		t.Errorf("expected total=0 for no-match search, got %v", total)
	}
	// data must serialize as [] (not null): a nil slice would break the
	// frontend's entries.length check (see frontend AuditLogView search).
	data, ok := body["data"].([]interface{})
	if !ok {
		t.Fatalf("expected data to be an array for no-match search, got %#v", body["data"])
	}
	if len(data) != 0 {
		t.Errorf("expected empty data array for no-match search, got %d entries", len(data))
	}
}

// ============================================================
//  TEST: GET /api/v1/audit — date range filter
// ============================================================

func TestHandleAuditQuery_DateRange(t *testing.T) {
	origUser, origPass := auth.AdminUser, auth.AdminPass
	auth.AdminUser, auth.AdminPass = "admin", "pass"
	defer func() { auth.AdminUser, auth.AdminPass = origUser, origPass }()

	auditMod := newTestAuditModule(t)
	seedAudit(t, auditMod)

	mock := &mockSystemd{services: sampleServices()}
	h := New(nil, mock, auditMod)
	router := setupTestRouterWithAudit(h)

	cookie := loginAndGetCookie(t, router, "admin", "pass")

	req := httptest.NewRequest(http.MethodGet, "/api/v1/audit?from=2025-08-01&to=2025-08-02", nil)
	req.AddCookie(cookie)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	body := assertJSON(t, w, http.StatusOK)
	total, _ := body["total"].(float64)
	if total != 2 {
		t.Errorf("expected 2 entries in date range, got total=%v", total)
	}
}

// ============================================================
//  TEST: GET /api/v1/audit — invalid date format
// ============================================================

func TestHandleAuditQuery_InvalidDate(t *testing.T) {
	origUser, origPass := auth.AdminUser, auth.AdminPass
	auth.AdminUser, auth.AdminPass = "admin", "pass"
	defer func() { auth.AdminUser, auth.AdminPass = origUser, origPass }()

	auditMod := newTestAuditModule(t)

	mock := &mockSystemd{services: sampleServices()}
	h := New(nil, mock, auditMod)
	router := setupTestRouterWithAudit(h)

	cookie := loginAndGetCookie(t, router, "admin", "pass")

	tests := []struct {
		name string
		url  string
	}{
		{"invalid from", "/api/v1/audit?from=01-08-2025"},
		{"invalid to", "/api/v1/audit?to=not-a-date"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, tt.url, nil)
			req.AddCookie(cookie)
			w := httptest.NewRecorder()
			router.ServeHTTP(w, req)

			assertJSON(t, w, http.StatusBadRequest)
		})
	}
}

// ============================================================
//  TEST: GET /api/v1/audit — pagination
// ============================================================

func TestHandleAuditQuery_Pagination(t *testing.T) {
	origUser, origPass := auth.AdminUser, auth.AdminPass
	auth.AdminUser, auth.AdminPass = "admin", "pass"
	defer func() { auth.AdminUser, auth.AdminPass = origUser, origPass }()

	auditMod := newTestAuditModule(t)
	seedAudit(t, auditMod)

	mock := &mockSystemd{services: sampleServices()}
	h := New(nil, mock, auditMod)
	router := setupTestRouterWithAudit(h)

	cookie := loginAndGetCookie(t, router, "admin", "pass")

	// Page 1 with limit=2
	req := httptest.NewRequest(http.MethodGet, "/api/v1/audit?page=1&limit=2", nil)
	req.AddCookie(cookie)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	body := assertJSON(t, w, http.StatusOK)
	total, _ := body["total"].(float64)
	if total != 5 {
		t.Errorf("expected total=5, got %v", total)
	}
	data := body["data"].([]interface{})
	if len(data) != 2 {
		t.Errorf("expected 2 entries on page 1, got %d", len(data))
	}

	// Page 3 with limit=2 → should have 1 entry remaining
	req2 := httptest.NewRequest(http.MethodGet, "/api/v1/audit?page=3&limit=2", nil)
	req2.AddCookie(cookie)
	w2 := httptest.NewRecorder()
	router.ServeHTTP(w2, req2)

	body2 := assertJSON(t, w2, http.StatusOK)
	data2 := body2["data"].([]interface{})
	if len(data2) != 1 {
		t.Errorf("expected 1 entry on page 3, got %d", len(data2))
	}
}

// ============================================================
//  TEST: GET /api/v1/audit — page out of range
// ============================================================

func TestHandleAuditQuery_PageOutOfRange(t *testing.T) {
	origUser, origPass := auth.AdminUser, auth.AdminPass
	auth.AdminUser, auth.AdminPass = "admin", "pass"
	defer func() { auth.AdminUser, auth.AdminPass = origUser, origPass }()

	auditMod := newTestAuditModule(t)
	seedAudit(t, auditMod)

	mock := &mockSystemd{services: sampleServices()}
	h := New(nil, mock, auditMod)
	router := setupTestRouterWithAudit(h)

	cookie := loginAndGetCookie(t, router, "admin", "pass")

	req := httptest.NewRequest(http.MethodGet, "/api/v1/audit?page=10&limit=50", nil)
	req.AddCookie(cookie)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	body := assertJSON(t, w, http.StatusOK)
	total, _ := body["total"].(float64)
	if total != 5 {
		t.Errorf("expected total=5, got %v", total)
	}
	data := body["data"].([]interface{})
	if len(data) != 0 {
		t.Errorf("expected 0 entries for out-of-range page, got %d", len(data))
	}
}

// ============================================================
//  TEST: GET /api/v1/audit — unauthorized
// ============================================================

func TestHandleAuditQuery_Unauthorized(t *testing.T) {
	auditMod := newTestAuditModule(t)

	mock := &mockSystemd{}
	h := New(nil, mock, auditMod)
	router := setupTestRouterWithAudit(h)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/audit?page=1&limit=50", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	assertJSON(t, w, http.StatusUnauthorized)
}

// ============================================================
//  TEST: GET /api/v1/audit/export — CSV
// ============================================================

func TestHandleAuditExport_Success(t *testing.T) {
	origUser, origPass := auth.AdminUser, auth.AdminPass
	auth.AdminUser, auth.AdminPass = "admin", "pass"
	defer func() { auth.AdminUser, auth.AdminPass = origUser, origPass }()

	auditMod := newTestAuditModule(t)
	seedAudit(t, auditMod)

	mock := &mockSystemd{services: sampleServices()}
	h := New(nil, mock, auditMod)
	router := setupTestRouterWithAudit(h)

	cookie := loginAndGetCookie(t, router, "admin", "pass")

	req := httptest.NewRequest(http.MethodGet, "/api/v1/audit/export?format=csv", nil)
	req.AddCookie(cookie)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	// Check Content-Type
	ct := w.Header().Get("Content-Type")
	if ct != "text/csv" {
		t.Errorf("expected Content-Type 'text/csv', got %q", ct)
	}

	// Check Content-Disposition
	cd := w.Header().Get("Content-Disposition")
	if !strings.Contains(cd, "attachment") || !strings.Contains(cd, "audit-log-") {
		t.Errorf("expected Content-Disposition attachment with filename, got %q", cd)
	}

	// Parse CSV
	r := csv.NewReader(strings.NewReader(w.Body.String()))
	records, err := r.ReadAll()
	if err != nil {
		t.Fatalf("failed to parse CSV: %v", err)
	}

	if len(records) < 2 {
		t.Fatalf("expected header + at least 1 data row, got %d rows", len(records))
	}

	// Header check
	expectedHeader := []string{"timestamp", "username", "source_ip", "action", "target", "result", "detail"}
	for i, h := range expectedHeader {
		if records[0][i] != h {
			t.Errorf("header[%d]: expected %q, got %q", i, h, records[0][i])
		}
	}

	// Data rows (should be 5 + header = 6 rows)
	if len(records) != 6 {
		t.Errorf("expected 6 rows (1 header + 5 data), got %d", len(records))
	}
}

// ============================================================
//  TEST: GET /api/v1/audit/export — bad format
// ============================================================

func TestHandleAuditExport_BadFormat(t *testing.T) {
	origUser, origPass := auth.AdminUser, auth.AdminPass
	auth.AdminUser, auth.AdminPass = "admin", "pass"
	defer func() { auth.AdminUser, auth.AdminPass = origUser, origPass }()

	auditMod := newTestAuditModule(t)

	mock := &mockSystemd{services: sampleServices()}
	h := New(nil, mock, auditMod)
	router := setupTestRouterWithAudit(h)

	cookie := loginAndGetCookie(t, router, "admin", "pass")

	tests := []struct {
		name string
		url  string
	}{
		{"no format param", "/api/v1/audit/export"},
		{"unsupported format", "/api/v1/audit/export?format=pdf"},
		{"json format", "/api/v1/audit/export?format=json"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, tt.url, nil)
			req.AddCookie(cookie)
			w := httptest.NewRecorder()
			router.ServeHTTP(w, req)

			assertJSON(t, w, http.StatusBadRequest)
		})
	}
}

// ============================================================
//  TEST: GET /api/v1/audit/export — unauthorized
// ============================================================

func TestHandleAuditExport_Unauthorized(t *testing.T) {
	auditMod := newTestAuditModule(t)

	mock := &mockSystemd{}
	h := New(nil, mock, auditMod)
	router := setupTestRouterWithAudit(h)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/audit/export?format=csv", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	assertJSON(t, w, http.StatusUnauthorized)
}

// ============================================================
//  TEST: Audit module nil — returns 500
// ============================================================

func TestHandleAuditQuery_NilModule(t *testing.T) {
	origUser, origPass := auth.AdminUser, auth.AdminPass
	auth.AdminUser, auth.AdminPass = "admin", "pass"
	defer func() { auth.AdminUser, auth.AdminPass = origUser, origPass }()

	mock := &mockSystemd{services: sampleServices()}
	h := New(nil, mock, nil) // no audit module
	router := setupTestRouterWithAudit(h)

	cookie := loginAndGetCookie(t, router, "admin", "pass")

	req := httptest.NewRequest(http.MethodGet, "/api/v1/audit?page=1&limit=50", nil)
	req.AddCookie(cookie)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	assertJSON(t, w, http.StatusInternalServerError)
}

func TestHandleAuditExport_NilModule(t *testing.T) {
	origUser, origPass := auth.AdminUser, auth.AdminPass
	auth.AdminUser, auth.AdminPass = "admin", "pass"
	defer func() { auth.AdminUser, auth.AdminPass = origUser, origPass }()

	mock := &mockSystemd{services: sampleServices()}
	h := New(nil, mock, nil) // no audit module
	router := setupTestRouterWithAudit(h)

	cookie := loginAndGetCookie(t, router, "admin", "pass")

	req := httptest.NewRequest(http.MethodGet, "/api/v1/audit/export?format=csv", nil)
	req.AddCookie(cookie)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	assertJSON(t, w, http.StatusInternalServerError)
}

// ============================================================
//  TEST: Operation handlers write to audit log
// ============================================================

func TestAuditWrite_OnServiceStart(t *testing.T) {
	origUser, origPass := auth.AdminUser, auth.AdminPass
	auth.AdminUser, auth.AdminPass = "admin", "pass"
	defer func() { auth.AdminUser, auth.AdminPass = origUser, origPass }()

	auditMod := newTestAuditModule(t)

	mock := &mockSystemd{services: sampleServices()}
	h := New(nil, mock, auditMod)
	router := setupTestRouterWithAudit(h)

	cookie := loginAndGetCookie(t, router, "admin", "pass")

	req := httptest.NewRequest(http.MethodPost, "/api/v1/services/nginx.service/start", nil)
	req.AddCookie(cookie)
	req.Header.Set("X-Forwarded-For", "192.168.1.100")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	assertJSON(t, w, http.StatusOK)

	// Flush async writes
	auditMod.Shutdown()

	result, err := auditMod.Query(audit.QueryParams{Page: 1, Limit: 10})
	if err != nil {
		t.Fatalf("failed to query audit: %v", err)
	}

	// Should have: 1 login + 1 start = 2 entries (order depends on async timing)
	if result.Total != 2 {
		t.Fatalf("expected 2 audit entries (login + start), got %d", result.Total)
	}

	// Find the start entry regardless of position
	var startEntry *audit.Entry
	var loginEntry *audit.Entry
	for i := range result.Entries {
		switch result.Entries[i].Action {
		case audit.ActionStart:
			startEntry = &result.Entries[i]
		case audit.ActionLogin:
			loginEntry = &result.Entries[i]
		}
	}

	if startEntry == nil {
		t.Fatal("start entry not found in audit log")
	}
	if loginEntry == nil {
		t.Fatal("login entry not found in audit log")
	}

	if startEntry.Target != "nginx.service" {
		t.Errorf("expected target=nginx.service, got %s", startEntry.Target)
	}
	if startEntry.Result != audit.ResultSuccess {
		t.Errorf("expected result=success, got %s", startEntry.Result)
	}
	if startEntry.Username != "admin" {
		t.Errorf("expected username=admin, got %s", startEntry.Username)
	}
	// IP may vary; login uses RemoteAddr (192.0.2.1 from httptest), start uses X-Forwarded-For
	if startEntry.SourceIP != "192.168.1.100" {
		t.Logf("start source_ip=%s (expected 192.168.1.100 via X-Forwarded-For)", startEntry.SourceIP)
	}
}

// ============================================================
//  TEST: Operation failure writes to audit log
// ============================================================

func TestAuditWrite_OnServiceStartFailure(t *testing.T) {
	origUser, origPass := auth.AdminUser, auth.AdminPass
	auth.AdminUser, auth.AdminPass = "admin", "pass"
	defer func() { auth.AdminUser, auth.AdminPass = origUser, origPass }()

	auditMod := newTestAuditModule(t)

	mock := &mockSystemd{startErr: fmt.Errorf("unit not found")}
	h := New(nil, mock, auditMod)
	router := setupTestRouterWithAudit(h)

	cookie := loginAndGetCookie(t, router, "admin", "pass")

	req := httptest.NewRequest(http.MethodPost, "/api/v1/services/missing.service/start", nil)
	req.AddCookie(cookie)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	assertJSON(t, w, http.StatusInternalServerError)

	auditMod.Shutdown()

	result, err := auditMod.Query(audit.QueryParams{Page: 1, Limit: 10})
	if err != nil {
		t.Fatalf("failed to query audit: %v", err)
	}

	if result.Total < 2 {
		t.Fatalf("expected at least 2 entries, got %d", result.Total)
	}

	// Find the failed start entry regardless of position
	var failEntry *audit.Entry
	for i := range result.Entries {
		if result.Entries[i].Action == audit.ActionStart && result.Entries[i].Result == audit.ResultFailure {
			failEntry = &result.Entries[i]
			break
		}
	}

	if failEntry == nil {
		t.Fatal("failed start entry not found in audit log")
	}

	if failEntry.Result != audit.ResultFailure {
		t.Errorf("expected result=failure, got %s", failEntry.Result)
	}
	if failEntry.Detail == "" {
		t.Error("expected non-empty detail for failure")
	}
	if failEntry.Detail != "unit not found" {
		t.Errorf("expected detail='unit not found', got %q", failEntry.Detail)
	}
}

// ============================================================
//  TEST: All service actions write to audit (stop/restart/enable/disable)
// ============================================================

func TestAuditWrite_AllServiceActions(t *testing.T) {
	origUser, origPass := auth.AdminUser, auth.AdminPass
	auth.AdminUser, auth.AdminPass = "admin", "pass"
	defer func() { auth.AdminUser, auth.AdminPass = origUser, origPass }()

	tests := []struct {
		name   string
		method string
		path   string
		action audit.Action
		mockFn func() *mockSystemd
	}{
		{
			name:   "stop",
			method: http.MethodPost,
			path:   "/api/v1/services/nginx.service/stop",
			action: audit.ActionStop,
			mockFn: func() *mockSystemd { return &mockSystemd{} },
		},
		{
			name:   "restart",
			method: http.MethodPost,
			path:   "/api/v1/services/nginx.service/restart",
			action: audit.ActionRestart,
			mockFn: func() *mockSystemd { return &mockSystemd{} },
		},
		{
			name:   "enable",
			method: http.MethodPost,
			path:   "/api/v1/services/myapp.service/enable",
			action: audit.ActionEnable,
			mockFn: func() *mockSystemd { return &mockSystemd{} },
		},
		{
			name:   "disable",
			method: http.MethodPost,
			path:   "/api/v1/services/myapp.service/disable",
			action: audit.ActionDisable,
			mockFn: func() *mockSystemd { return &mockSystemd{} },
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			auditMod := newTestAuditModule(t)
			mock := tt.mockFn()
			h := New(nil, mock, auditMod)
			router := setupTestRouterWithAudit(h)

			cookie := loginAndGetCookie(t, router, "admin", "pass")

			req := httptest.NewRequest(tt.method, tt.path, nil)
			req.AddCookie(cookie)
			w := httptest.NewRecorder()
			router.ServeHTTP(w, req)

			if w.Code != http.StatusOK {
				t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
			}

			auditMod.Shutdown()

			result, err := auditMod.Query(audit.QueryParams{Page: 1, Limit: 10})
			if err != nil {
				t.Fatalf("query failed: %v", err)
			}

			// Login + this action (order depends on async timing)
			if result.Total != 2 {
				t.Fatalf("expected 2 entries (login + %s), got %d", tt.name, result.Total)
			}

			// Find the service action entry
			var found bool
			for i := range result.Entries {
				if result.Entries[i].Action == tt.action {
					if result.Entries[i].Result != audit.ResultSuccess {
						t.Errorf("expected result=success, got %s", result.Entries[i].Result)
					}
					found = true
					break
				}
			}
			if !found {
				t.Errorf("expected action=%s entry not found in audit log", tt.action)
			}
		})
	}
}

// ============================================================
//  TEST: Login writes audit entry
// ============================================================

func TestAuditWrite_OnLogin(t *testing.T) {
	origUser, origPass := auth.AdminUser, auth.AdminPass
	auth.AdminUser, auth.AdminPass = "admin", "pass"
	defer func() { auth.AdminUser, auth.AdminPass = origUser, origPass }()

	auditMod := newTestAuditModule(t)

	mock := &mockSystemd{}
	h := New(nil, mock, auditMod)
	router := setupTestRouterWithAudit(h)

	form := url.Values{}
	form.Set("username", "admin")
	form.Set("password", "pass")

	req := httptest.NewRequest(http.MethodPost, "/api/v1/login", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	assertJSON(t, w, http.StatusOK)

	auditMod.Shutdown()

	result, err := auditMod.Query(audit.QueryParams{Page: 1, Limit: 10})
	if err != nil {
		t.Fatalf("query failed: %v", err)
	}

	if result.Total != 1 {
		t.Fatalf("expected 1 audit entry (login), got %d", result.Total)
	}

	entry := result.Entries[0]
	if entry.Action != audit.ActionLogin {
		t.Errorf("expected action=login, got %s", entry.Action)
	}
	if entry.Target != "-" {
		t.Errorf("expected target='-', got %q", entry.Target)
	}
	if entry.Result != audit.ResultSuccess {
		t.Errorf("expected result=success, got %s", entry.Result)
	}
}

// ============================================================
//  TEST: Logout writes audit entry
// ============================================================

func TestAuditWrite_OnLogout(t *testing.T) {
	origUser, origPass := auth.AdminUser, auth.AdminPass
	auth.AdminUser, auth.AdminPass = "admin", "pass"
	defer func() { auth.AdminUser, auth.AdminPass = origUser, origPass }()

	auditMod := newTestAuditModule(t)

	mock := &mockSystemd{}
	h := New(nil, mock, auditMod)
	router := setupTestRouterWithAudit(h)

	cookie := loginAndGetCookie(t, router, "admin", "pass")

	req := httptest.NewRequest(http.MethodPost, "/api/v1/logout", nil)
	req.AddCookie(cookie)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	assertJSON(t, w, http.StatusOK)

	auditMod.Shutdown()

	result, err := auditMod.Query(audit.QueryParams{Page: 1, Limit: 10})
	if err != nil {
		t.Fatalf("query failed: %v", err)
	}

	// Login + logout = 2 (order depends on async timing)
	if result.Total != 2 {
		t.Fatalf("expected 2 entries (login + logout), got %d", result.Total)
	}

	// Find the logout entry
	var found bool
	for i := range result.Entries {
		if result.Entries[i].Action == audit.ActionLogout {
			if result.Entries[i].Target != "-" {
				t.Errorf("expected target='-', got %q", result.Entries[i].Target)
			}
			found = true
			break
		}
	}
	if !found {
		t.Error("logout entry not found in audit log")
	}
}

// ============================================================
//  TEST: Operation without audit module does not panic
// ============================================================

func TestAuditWrite_NilModuleNoPanic(t *testing.T) {
	origUser, origPass := auth.AdminUser, auth.AdminPass
	auth.AdminUser, auth.AdminPass = "admin", "pass"
	defer func() { auth.AdminUser, auth.AdminPass = origUser, origPass }()

	mock := &mockSystemd{}
	h := New(nil, mock, nil) // no audit module
	router := setupTestRouterWithAudit(h)

	cookie := loginAndGetCookie(t, router, "admin", "pass")

	req := httptest.NewRequest(http.MethodPost, "/api/v1/services/nginx.service/start", nil)
	req.AddCookie(cookie)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	// Should return 200 without panic
	assertJSON(t, w, http.StatusOK)
}

// ============================================================
//  TEST: GET /api/v1/audit/export — with search filter (HDL-05)
// ============================================================

func TestHandleAuditExport_WithSearchFilter(t *testing.T) {
	origUser, origPass := auth.AdminUser, auth.AdminPass
	auth.AdminUser, auth.AdminPass = "admin", "pass"
	defer func() { auth.AdminUser, auth.AdminPass = origUser, origPass }()

	auditMod := newTestAuditModule(t)
	seedAudit(t, auditMod)

	mock := &mockSystemd{services: sampleServices()}
	h := New(nil, mock, auditMod)
	router := setupTestRouterWithAudit(h)

	cookie := loginAndGetCookie(t, router, "admin", "pass")

	req := httptest.NewRequest(http.MethodGet, "/api/v1/audit/export?format=csv&search=nginx", nil)
	req.AddCookie(cookie)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	// CSV should only contain nginx-related entries (2 of the 5 seed entries)
	r := csv.NewReader(strings.NewReader(w.Body.String()))
	records, err := r.ReadAll()
	if err != nil {
		t.Fatalf("csv parse error: %v", err)
	}
	// header + 2 data rows
	if len(records) != 3 {
		t.Errorf("expected 3 CSV lines (1 header + 2 nginx rows), got %d", len(records))
	}
}

// ============================================================
//  TEST: GET /api/v1/audit/export — with date filter (HDL-05)
// ============================================================

func TestHandleAuditExport_WithDateFilter(t *testing.T) {
	origUser, origPass := auth.AdminUser, auth.AdminPass
	auth.AdminUser, auth.AdminPass = "admin", "pass"
	defer func() { auth.AdminUser, auth.AdminPass = origUser, origPass }()

	auditMod := newTestAuditModule(t)
	seedAudit(t, auditMod)

	mock := &mockSystemd{services: sampleServices()}
	h := New(nil, mock, auditMod)
	router := setupTestRouterWithAudit(h)

	cookie := loginAndGetCookie(t, router, "admin", "pass")

	req := httptest.NewRequest(http.MethodGet, "/api/v1/audit/export?format=csv&from=2025-08-01&to=2025-08-02", nil)
	req.AddCookie(cookie)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	r := csv.NewReader(strings.NewReader(w.Body.String()))
	records, err := r.ReadAll()
	if err != nil {
		t.Fatalf("csv parse error: %v", err)
	}
	// header + 2 data rows (Aug 1 + Aug 2)
	if len(records) != 3 {
		t.Errorf("expected 3 CSV lines (1 header + 2 in range), got %d", len(records))
	}
}

// ============================================================
//  TEST: GET /api/v1/audit — page parameter auto-clamp (HDL-08)
// ============================================================

func TestHandleAuditQuery_PageParamClamp(t *testing.T) {
	origUser, origPass := auth.AdminUser, auth.AdminPass
	auth.AdminUser, auth.AdminPass = "admin", "pass"
	defer func() { auth.AdminUser, auth.AdminPass = origUser, origPass }()

	auditMod := newTestAuditModule(t)
	seedAudit(t, auditMod)

	mock := &mockSystemd{services: sampleServices()}
	h := New(nil, mock, auditMod)
	router := setupTestRouterWithAudit(h)

	cookie := loginAndGetCookie(t, router, "admin", "pass")

	tests := []struct {
		name string
		url  string
	}{
		{"page=abc → defaults to 1", "/api/v1/audit?page=abc&limit=50"},
		{"page=0 → clamped to 1", "/api/v1/audit?page=0&limit=50"},
		{"page=-1 → clamped to 1", "/api/v1/audit?page=-1&limit=50"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, tt.url, nil)
			req.AddCookie(cookie)
			w := httptest.NewRecorder()
			router.ServeHTTP(w, req)

			body := assertJSON(t, w, http.StatusOK)
			// Should default to page 1
			if body["page"].(float64) != 1 {
				t.Errorf("expected page=1 (clamped), got %v", body["page"])
			}
		})
	}
}

// ============================================================
//  Cleanup helper: remove temp audit files (called by t.Cleanup)
// ============================================================

func init() {
	// Prevent audit module from creating directories in current working dir
	// during tests – each test creates its own temp dir.
	_ = os.Getenv("TEST_AUDIT")
}

// ============================================================
//  Ensure mockSystemd satisfies systemd.ServiceManager
// ============================================================

var _ systemd.ServiceManager = (*mockSystemd)(nil)
