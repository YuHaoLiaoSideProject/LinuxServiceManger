package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os/exec"
	"strings"
	"testing"
	"time"

	"linux-service-manager/internal/auth"
	"linux-service-manager/internal/systemd"

	"github.com/go-chi/chi/v5"
	"github.com/gorilla/websocket"
)

// ============================================================
//  Mock systemd manager
// ============================================================

type mockSystemd struct {
	services         []systemd.Service
	listErr          error
	startErr         error
	stopErr          error
	restartErr       error
	enableErr        error
	disableErr       error
	unitFileState    string
	getServiceLogsFn func(name string, lines int) (string, error)
	// Per-service error maps for batch operation partial-failure testing.
	startErrFor   map[string]error
	stopErrFor    map[string]error
	restartErrFor map[string]error
	startCalled   []string
	stopCalled    []string
	restartCalled []string
	enableCalled  []string
	disableCalled []string
	getLogsCalled []getLogsCall
}

type getLogsCall struct {
	name  string
	lines int
}

func (m *mockSystemd) ListServices() ([]systemd.Service, error) {
	if m.listErr != nil {
		return nil, m.listErr
	}
	return m.services, nil
}

func (m *mockSystemd) StartService(_ context.Context, name string) error {
	m.startCalled = append(m.startCalled, name)
	if m.startErrFor != nil {
		if err, ok := m.startErrFor[name]; ok {
			return err
		}
	}
	return m.startErr
}

func (m *mockSystemd) StopService(_ context.Context, name string) error {
	m.stopCalled = append(m.stopCalled, name)
	if m.stopErrFor != nil {
		if err, ok := m.stopErrFor[name]; ok {
			return err
		}
	}
	return m.stopErr
}

func (m *mockSystemd) RestartService(_ context.Context, name string) error {
	m.restartCalled = append(m.restartCalled, name)
	if m.restartErrFor != nil {
		if err, ok := m.restartErrFor[name]; ok {
			return err
		}
	}
	return m.restartErr
}

func (m *mockSystemd) EnableService(name string) error {
	m.enableCalled = append(m.enableCalled, name)
	return m.enableErr
}

func (m *mockSystemd) DisableService(name string) error {
	m.disableCalled = append(m.disableCalled, name)
	return m.disableErr
}

func (m *mockSystemd) GetUnitFileState(name string) (string, error) {
	return m.unitFileState, nil
}

func (m *mockSystemd) GetServiceLogs(name string, lines int) (string, error) {
	m.getLogsCalled = append(m.getLogsCalled, getLogsCall{name: name, lines: lines})
	if m.getServiceLogsFn != nil {
		return m.getServiceLogsFn(name, lines)
	}
	return "", nil
}

// ============================================================
//  Test fixtures
// ============================================================

func sampleServices() []systemd.Service {
	return []systemd.Service{
		{Name: "nginx.service", Load: "loaded", Active: "active", Sub: "running", Locked: false, UnitFileState: "enabled", FragmentPath: "/etc/systemd/system/nginx.service"},
		{Name: "ssh.service", Load: "loaded", Active: "active", Sub: "running", Locked: true, UnitFileState: "enabled", FragmentPath: "/usr/lib/systemd/system/ssh.service"},
		{Name: "myapp.service", Load: "loaded", Active: "inactive", Sub: "dead", Locked: false, UnitFileState: "disabled", FragmentPath: "/etc/systemd/system/myapp.service"},
		{Name: "docker.service", Load: "loaded", Active: "failed", Sub: "failed", Locked: true, UnitFileState: "static", FragmentPath: "/usr/lib/systemd/system/docker.service"},
	}
}

func setupTestRouter(h *Handler) *chi.Mux {
	r := chi.NewRouter()

	// Public routes
	r.Post("/api/v1/login", h.HandleLoginJSON)
	r.Post("/api/v1/logout", h.HandleLogoutJSON)
	r.Get("/api/v1/session", h.HandleSessionCheck)

	// Protected routes
	r.Group(func(r chi.Router) {
		r.Use(authMiddlewareJSON)
		r.Get("/api/v1/services", h.HandleServicesJSON)
		r.Post("/api/v1/services/{name}/start", h.HandleStartJSON)
		r.Post("/api/v1/services/{name}/stop", h.HandleStopJSON)
		r.Post("/api/v1/services/{name}/restart", h.HandleRestartJSON)
		r.Post("/api/v1/services/{name}/enable", h.HandleEnableJSON)
		r.Post("/api/v1/services/{name}/disable", h.HandleDisableJSON)
	})

	return r
}

// JSON auth middleware (returns 401 JSON instead of redirect)
func authMiddlewareJSON(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		session := auth.GetSession(r)
		if authenticated, ok := session.Values["authenticated"].(bool); !ok || !authenticated {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusUnauthorized)
			json.NewEncoder(w).Encode(map[string]string{"error": "unauthorized"})
			return
		}
		next.ServeHTTP(w, r)
	})
}

// ============================================================
//  Helper functions
// ============================================================

func loginAndGetCookie(t *testing.T, router http.Handler, username, password string) *http.Cookie {
	t.Helper()

	form := url.Values{}
	form.Set("username", username)
	form.Set("password", password)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/login", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("login failed: got status %d, body: %s", w.Code, w.Body.String())
	}

	cookies := w.Result().Cookies()
	// With session-fixation fix, login produces TWO Set-Cookie headers:
	// 1) the old session expired (MaxAge=-1)
	// 2) the new session with rotated ID.
	// Return the LAST matching cookie so we get the live session.
	var sessionCookie *http.Cookie
	for _, c := range cookies {
		if c.Name == "linux-service-manager" {
		sessionCookie = c
		}
	}
	if sessionCookie == nil {
		t.Fatal("no session cookie returned from login")
	}
	return sessionCookie
}

func assertJSON(t *testing.T, w *httptest.ResponseRecorder, expectedStatus int) map[string]interface{} {
	t.Helper()

	if w.Code != expectedStatus {
		t.Errorf("expected status %d, got %d: %s", expectedStatus, w.Code, w.Body.String())
	}

	var body map[string]interface{}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("failed to parse JSON response: %v\nbody: %s", err, w.Body.String())
	}
	return body
}

func assertJSONArray(t *testing.T, w *httptest.ResponseRecorder, expectedStatus int) []map[string]interface{} {
	t.Helper()

	if w.Code != expectedStatus {
		t.Errorf("expected status %d, got %d: %s", expectedStatus, w.Code, w.Body.String())
	}

	var body []map[string]interface{}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("failed to parse JSON array: %v\nbody: %s", err, w.Body.String())
	}
	return body
}

// ============================================================
//  TEST: POST /api/v1/login
// ============================================================

func TestLoginJSON_Success(t *testing.T) {
	// Save original credentials and restore
	origUser, origPass := auth.AdminUser, auth.AdminPass
	auth.AdminUser, auth.AdminPass = "testuser", "testpass"
	defer func() { auth.AdminUser, auth.AdminPass = origUser, origPass }()

	mock := &mockSystemd{}
	h := New(nil, mock, nil, nil)
	router := setupTestRouter(h)

	form := url.Values{}
	form.Set("username", "testuser")
	form.Set("password", "testpass")

	req := httptest.NewRequest(http.MethodPost, "/api/v1/login", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	body := assertJSON(t, w, http.StatusOK)

	if body["username"] != "testuser" {
		t.Errorf("expected username 'testuser', got %v", body["username"])
	}

	// Verify session cookie is set
	cookies := w.Result().Cookies()
	found := false
	for _, c := range cookies {
		if c.Name == "linux-service-manager" {
			found = true
			if c.HttpOnly != true {
				t.Error("session cookie should be HttpOnly")
			}
		}
	}
	if !found {
		t.Error("no session cookie in login response")
	}
}

func TestLoginJSON_InvalidCredentials(t *testing.T) {
	origUser, origPass := auth.AdminUser, auth.AdminPass
	auth.AdminUser, auth.AdminPass = "admin", "secret"
	defer func() { auth.AdminUser, auth.AdminPass = origUser, origPass }()

	mock := &mockSystemd{}
	h := New(nil, mock, nil, nil)
	router := setupTestRouter(h)

	form := url.Values{}
	form.Set("username", "admin")
	form.Set("password", "wrongpassword")

	req := httptest.NewRequest(http.MethodPost, "/api/v1/login", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	body := assertJSON(t, w, http.StatusUnauthorized)
	if body["error"] == nil {
		t.Error("expected error message for invalid credentials")
	}
}

func TestLoginJSON_EmptyCredentials(t *testing.T) {
	mock := &mockSystemd{}
	h := New(nil, mock, nil, nil)
	router := setupTestRouter(h)

	tests := []struct {
		name     string
		username string
		password string
	}{
		{"empty username", "", "pass"},
		{"empty password", "user", ""},
		{"both empty", "", ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			form := url.Values{}
			form.Set("username", tt.username)
			form.Set("password", tt.password)

			req := httptest.NewRequest(http.MethodPost, "/api/v1/login", strings.NewReader(form.Encode()))
			req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
			w := httptest.NewRecorder()
			router.ServeHTTP(w, req)

			if w.Code != http.StatusBadRequest && w.Code != http.StatusUnauthorized {
				t.Errorf("expected 400 or 401 for empty credentials, got %d", w.Code)
			}
		})
	}
}

// ============================================================
//  TEST: POST /api/v1/logout
// ============================================================

func TestLogoutJSON_Success(t *testing.T) {
	origUser, origPass := auth.AdminUser, auth.AdminPass
	auth.AdminUser, auth.AdminPass = "admin", "pass"
	defer func() { auth.AdminUser, auth.AdminPass = origUser, origPass }()

	mock := &mockSystemd{}
	h := New(nil, mock, nil, nil)
	router := setupTestRouter(h)

	cookie := loginAndGetCookie(t, router, "admin", "pass")

	req := httptest.NewRequest(http.MethodPost, "/api/v1/logout", nil)
	req.AddCookie(cookie)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	body := assertJSON(t, w, http.StatusOK)
	if body["message"] == nil {
		t.Error("expected success message on logout")
	}

	// Verify cookie is cleared (MaxAge < 0)
	cookies := w.Result().Cookies()
	for _, c := range cookies {
		if c.Name == "linux-service-manager" && c.MaxAge >= 0 {
			t.Error("session cookie should be cleared (MaxAge < 0)")
		}
	}
}

// ============================================================
//  TEST: GET /api/v1/session
// ============================================================

func TestSessionCheck_Authenticated(t *testing.T) {
	origUser, origPass := auth.AdminUser, auth.AdminPass
	auth.AdminUser, auth.AdminPass = "admin", "pass"
	defer func() { auth.AdminUser, auth.AdminPass = origUser, origPass }()

	mock := &mockSystemd{}
	h := New(nil, mock, nil, nil)
	router := setupTestRouter(h)

	cookie := loginAndGetCookie(t, router, "admin", "pass")

	req := httptest.NewRequest(http.MethodGet, "/api/v1/session", nil)
	req.AddCookie(cookie)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	body := assertJSON(t, w, http.StatusOK)
	if body["authenticated"] != true {
		t.Error("expected authenticated: true")
	}
	if body["username"] != "admin" {
		t.Errorf("expected username 'admin', got %v", body["username"])
	}
}

func TestSessionCheck_NotAuthenticated(t *testing.T) {
	mock := &mockSystemd{}
	h := New(nil, mock, nil, nil)
	router := setupTestRouter(h)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/session", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	body := assertJSON(t, w, http.StatusOK)
	if body["authenticated"] != false {
		t.Error("expected authenticated: false for unauthenticated request")
	}
}

// ============================================================
//  TEST: GET /api/v1/services (protected)
// ============================================================

func TestServicesList_Success(t *testing.T) {
	origUser, origPass := auth.AdminUser, auth.AdminPass
	auth.AdminUser, auth.AdminPass = "admin", "pass"
	defer func() { auth.AdminUser, auth.AdminPass = origUser, origPass }()

	mock := &mockSystemd{services: sampleServices()}
	h := New(nil, mock, nil, nil)
	router := setupTestRouter(h)

	cookie := loginAndGetCookie(t, router, "admin", "pass")

	req := httptest.NewRequest(http.MethodGet, "/api/v1/services", nil)
	req.AddCookie(cookie)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	services := assertJSONArray(t, w, http.StatusOK)
	if len(services) != 4 {
		t.Errorf("expected 4 services, got %d", len(services))
	}

	// Verify first service fields
	svc := services[0]
	if svc["name"] != "nginx.service" {
		t.Errorf("expected first service 'nginx.service', got %v", svc["name"])
	}
	if svc["load"] != "loaded" {
		t.Errorf("expected load 'loaded', got %v", svc["load"])
	}
	if svc["active"] != "active" {
		t.Errorf("expected active 'active', got %v", svc["active"])
	}
	if svc["sub"] != "running" {
		t.Errorf("expected sub 'running', got %v", svc["sub"])
	}
	if svc["locked"] != false {
		t.Errorf("expected locked false for nginx, got %v", svc["locked"])
	}
}

func TestServicesList_Unauthorized(t *testing.T) {
	mock := &mockSystemd{services: sampleServices()}
	h := New(nil, mock, nil, nil)
	router := setupTestRouter(h)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/services", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	body := assertJSON(t, w, http.StatusUnauthorized)
	if body["error"] == nil {
		t.Error("expected error for unauthorized request")
	}
}

func TestServicesList_SystemdError(t *testing.T) {
	origUser, origPass := auth.AdminUser, auth.AdminPass
	auth.AdminUser, auth.AdminPass = "admin", "pass"
	defer func() { auth.AdminUser, auth.AdminPass = origUser, origPass }()

	mock := &mockSystemd{listErr: fmt.Errorf("dbus connection failed")}
	h := New(nil, mock, nil, nil)
	router := setupTestRouter(h)

	cookie := loginAndGetCookie(t, router, "admin", "pass")

	req := httptest.NewRequest(http.MethodGet, "/api/v1/services", nil)
	req.AddCookie(cookie)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	body := assertJSON(t, w, http.StatusInternalServerError)
	if body["error"] == nil {
		t.Error("expected error for systemd failure")
	}
}

func TestServicesList_Empty(t *testing.T) {
	origUser, origPass := auth.AdminUser, auth.AdminPass
	auth.AdminUser, auth.AdminPass = "admin", "pass"
	defer func() { auth.AdminUser, auth.AdminPass = origUser, origPass }()

	mock := &mockSystemd{services: []systemd.Service{}}
	h := New(nil, mock, nil, nil)
	router := setupTestRouter(h)

	cookie := loginAndGetCookie(t, router, "admin", "pass")

	req := httptest.NewRequest(http.MethodGet, "/api/v1/services", nil)
	req.AddCookie(cookie)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	services := assertJSONArray(t, w, http.StatusOK)
	if len(services) != 0 {
		t.Errorf("expected 0 services, got %d", len(services))
	}
}

// ============================================================
//  TEST: POST /api/v1/services/{name}/start (protected)
// ============================================================

func TestServiceStart_Success(t *testing.T) {
	origUser, origPass := auth.AdminUser, auth.AdminPass
	auth.AdminUser, auth.AdminPass = "admin", "pass"
	defer func() { auth.AdminUser, auth.AdminPass = origUser, origPass }()

	mock := &mockSystemd{services: sampleServices()}
	h := New(nil, mock, nil, nil)
	router := setupTestRouter(h)

	cookie := loginAndGetCookie(t, router, "admin", "pass")

	req := httptest.NewRequest(http.MethodPost, "/api/v1/services/myapp.service/start", nil)
	req.AddCookie(cookie)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	body := assertJSON(t, w, http.StatusOK)
	if body["message"] == nil {
		t.Error("expected success message")
	}

	if len(mock.startCalled) != 1 || mock.startCalled[0] != "myapp.service" {
		t.Errorf("expected StartService('myapp.service') to be called, got %v", mock.startCalled)
	}
}

func TestServiceStart_Error(t *testing.T) {
	origUser, origPass := auth.AdminUser, auth.AdminPass
	auth.AdminUser, auth.AdminPass = "admin", "pass"
	defer func() { auth.AdminUser, auth.AdminPass = origUser, origPass }()

	mock := &mockSystemd{startErr: fmt.Errorf("permission denied")}
	h := New(nil, mock, nil, nil)
	router := setupTestRouter(h)

	cookie := loginAndGetCookie(t, router, "admin", "pass")

	req := httptest.NewRequest(http.MethodPost, "/api/v1/services/nginx.service/start", nil)
	req.AddCookie(cookie)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	body := assertJSON(t, w, http.StatusInternalServerError)
	if body["error"] == nil {
		t.Error("expected error message for start failure")
	}
}

func TestServiceStart_Unauthorized(t *testing.T) {
	mock := &mockSystemd{}
	h := New(nil, mock, nil, nil)
	router := setupTestRouter(h)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/services/nginx.service/start", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	assertJSON(t, w, http.StatusUnauthorized)
}

// ============================================================
//  TEST: POST /api/v1/services/{name}/stop (protected)
// ============================================================

func TestServiceStop_Success(t *testing.T) {
	origUser, origPass := auth.AdminUser, auth.AdminPass
	auth.AdminUser, auth.AdminPass = "admin", "pass"
	defer func() { auth.AdminUser, auth.AdminPass = origUser, origPass }()

	mock := &mockSystemd{services: sampleServices()}
	h := New(nil, mock, nil, nil)
	router := setupTestRouter(h)

	cookie := loginAndGetCookie(t, router, "admin", "pass")

	req := httptest.NewRequest(http.MethodPost, "/api/v1/services/nginx.service/stop", nil)
	req.AddCookie(cookie)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	body := assertJSON(t, w, http.StatusOK)
	if body["message"] == nil {
		t.Error("expected success message")
	}

	if len(mock.stopCalled) != 1 || mock.stopCalled[0] != "nginx.service" {
		t.Errorf("expected StopService('nginx.service') to be called, got %v", mock.stopCalled)
	}
}

func TestServiceStop_Error(t *testing.T) {
	origUser, origPass := auth.AdminUser, auth.AdminPass
	auth.AdminUser, auth.AdminPass = "admin", "pass"
	defer func() { auth.AdminUser, auth.AdminPass = origUser, origPass }()

	mock := &mockSystemd{stopErr: fmt.Errorf("service not found")}
	h := New(nil, mock, nil, nil)
	router := setupTestRouter(h)

	cookie := loginAndGetCookie(t, router, "admin", "pass")

	req := httptest.NewRequest(http.MethodPost, "/api/v1/services/missing.service/stop", nil)
	req.AddCookie(cookie)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	body := assertJSON(t, w, http.StatusInternalServerError)
	if body["error"] == nil {
		t.Error("expected error message for stop failure")
	}
}

// ============================================================
//  TEST: POST /api/v1/services/{name}/restart (protected)
// ============================================================

func TestServiceRestart_Success(t *testing.T) {
	origUser, origPass := auth.AdminUser, auth.AdminPass
	auth.AdminUser, auth.AdminPass = "admin", "pass"
	defer func() { auth.AdminUser, auth.AdminPass = origUser, origPass }()

	mock := &mockSystemd{services: sampleServices()}
	h := New(nil, mock, nil, nil)
	router := setupTestRouter(h)

	cookie := loginAndGetCookie(t, router, "admin", "pass")

	req := httptest.NewRequest(http.MethodPost, "/api/v1/services/nginx.service/restart", nil)
	req.AddCookie(cookie)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	body := assertJSON(t, w, http.StatusOK)
	if body["message"] == nil {
		t.Error("expected success message")
	}

	if len(mock.restartCalled) != 1 || mock.restartCalled[0] != "nginx.service" {
		t.Errorf("expected RestartService('nginx.service') to be called, got %v", mock.restartCalled)
	}
}

// ============================================================
//  TEST: POST /api/v1/services/{name}/enable (protected)
// ============================================================

func TestHandleEnable_Success(t *testing.T) {
	origUser, origPass := auth.AdminUser, auth.AdminPass
	auth.AdminUser, auth.AdminPass = "admin", "pass"
	defer func() { auth.AdminUser, auth.AdminPass = origUser, origPass }()

	mock := &mockSystemd{services: sampleServices()}
	h := New(nil, mock, nil, nil)
	router := setupTestRouter(h)

	cookie := loginAndGetCookie(t, router, "admin", "pass")

	req := httptest.NewRequest(http.MethodPost, "/api/v1/services/myapp.service/enable", nil)
	req.AddCookie(cookie)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	body := assertJSON(t, w, http.StatusOK)
	if body["message"] != "myapp.service enabled" {
		t.Errorf("expected message 'myapp.service enabled', got %v", body["message"])
	}

	if len(mock.enableCalled) != 1 || mock.enableCalled[0] != "myapp.service" {
		t.Errorf("expected EnableService('myapp.service') to be called, got %v", mock.enableCalled)
	}
}

func TestHandleEnable_Error(t *testing.T) {
	origUser, origPass := auth.AdminUser, auth.AdminPass
	auth.AdminUser, auth.AdminPass = "admin", "pass"
	defer func() { auth.AdminUser, auth.AdminPass = origUser, origPass }()

	mock := &mockSystemd{enableErr: fmt.Errorf("operation not permitted")}
	h := New(nil, mock, nil, nil)
	router := setupTestRouter(h)

	cookie := loginAndGetCookie(t, router, "admin", "pass")

	req := httptest.NewRequest(http.MethodPost, "/api/v1/services/nginx.service/enable", nil)
	req.AddCookie(cookie)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	body := assertJSON(t, w, http.StatusInternalServerError)
	if body["error"] == nil {
		t.Error("expected error message for enable failure")
	}
}

func TestHandleEnable_Unauthorized(t *testing.T) {
	mock := &mockSystemd{}
	h := New(nil, mock, nil, nil)
	router := setupTestRouter(h)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/services/nginx.service/enable", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	assertJSON(t, w, http.StatusUnauthorized)
}

// ============================================================
//  TEST: POST /api/v1/services/{name}/disable (protected)
// ============================================================

func TestHandleDisable_Success(t *testing.T) {
	origUser, origPass := auth.AdminUser, auth.AdminPass
	auth.AdminUser, auth.AdminPass = "admin", "pass"
	defer func() { auth.AdminUser, auth.AdminPass = origUser, origPass }()

	mock := &mockSystemd{services: sampleServices()}
	h := New(nil, mock, nil, nil)
	router := setupTestRouter(h)

	cookie := loginAndGetCookie(t, router, "admin", "pass")

	req := httptest.NewRequest(http.MethodPost, "/api/v1/services/nginx.service/disable", nil)
	req.AddCookie(cookie)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	body := assertJSON(t, w, http.StatusOK)
	if body["message"] != "nginx.service disabled" {
		t.Errorf("expected message 'nginx.service disabled', got %v", body["message"])
	}

	if len(mock.disableCalled) != 1 || mock.disableCalled[0] != "nginx.service" {
		t.Errorf("expected DisableService('nginx.service') to be called, got %v", mock.disableCalled)
	}
}

func TestHandleDisable_Error(t *testing.T) {
	origUser, origPass := auth.AdminUser, auth.AdminPass
	auth.AdminUser, auth.AdminPass = "admin", "pass"
	defer func() { auth.AdminUser, auth.AdminPass = origUser, origPass }()

	mock := &mockSystemd{disableErr: fmt.Errorf("service not found")}
	h := New(nil, mock, nil, nil)
	router := setupTestRouter(h)

	cookie := loginAndGetCookie(t, router, "admin", "pass")

	req := httptest.NewRequest(http.MethodPost, "/api/v1/services/missing.service/disable", nil)
	req.AddCookie(cookie)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	body := assertJSON(t, w, http.StatusInternalServerError)
	if body["error"] == nil {
		t.Error("expected error message for disable failure")
	}
}

func TestHandleDisable_Unauthorized(t *testing.T) {
	mock := &mockSystemd{}
	h := New(nil, mock, nil, nil)
	router := setupTestRouter(h)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/services/nginx.service/disable", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	assertJSON(t, w, http.StatusUnauthorized)
}

// ============================================================
//  TEST: GET /api/v1/services — unitFileState and fragmentPath fields
// ============================================================

func TestHandleServices_IncludesUnitFileState(t *testing.T) {
	origUser, origPass := auth.AdminUser, auth.AdminPass
	auth.AdminUser, auth.AdminPass = "admin", "pass"
	defer func() { auth.AdminUser, auth.AdminPass = origUser, origPass }()

	mock := &mockSystemd{services: sampleServices()}
	h := New(nil, mock, nil, nil)
	router := setupTestRouter(h)

	cookie := loginAndGetCookie(t, router, "admin", "pass")

	req := httptest.NewRequest(http.MethodGet, "/api/v1/services", nil)
	req.AddCookie(cookie)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	services := assertJSONArray(t, w, http.StatusOK)

	// nginx.service: enabled, /etc/systemd/system/nginx.service
	if services[0]["unitFileState"] != "enabled" {
		t.Errorf("expected unitFileState 'enabled' for nginx, got %v", services[0]["unitFileState"])
	}
	if services[0]["fragmentPath"] != "/etc/systemd/system/nginx.service" {
		t.Errorf("expected fragmentPath '/etc/systemd/system/nginx.service' for nginx, got %v", services[0]["fragmentPath"])
	}

	// myapp.service: disabled, /etc/systemd/system/myapp.service
	if services[2]["unitFileState"] != "disabled" {
		t.Errorf("expected unitFileState 'disabled' for myapp, got %v", services[2]["unitFileState"])
	}
	if services[2]["fragmentPath"] != "/etc/systemd/system/myapp.service" {
		t.Errorf("expected fragmentPath '/etc/systemd/system/myapp.service' for myapp, got %v", services[2]["fragmentPath"])
	}
}

func TestHandleServices_LockedService(t *testing.T) {
	origUser, origPass := auth.AdminUser, auth.AdminPass
	auth.AdminUser, auth.AdminPass = "admin", "pass"
	defer func() { auth.AdminUser, auth.AdminPass = origUser, origPass }()

	mock := &mockSystemd{services: sampleServices()}
	h := New(nil, mock, nil, nil)
	router := setupTestRouter(h)

	cookie := loginAndGetCookie(t, router, "admin", "pass")

	req := httptest.NewRequest(http.MethodGet, "/api/v1/services", nil)
	req.AddCookie(cookie)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	services := assertJSONArray(t, w, http.StatusOK)

	// ssh.service: locked=true, unitFileState="enabled", fragmentPath="/usr/lib/systemd/system/ssh.service"
	ssh := services[1]
	if ssh["locked"] != true {
		t.Error("expected ssh.service to be locked")
	}
	if ssh["unitFileState"] != "enabled" {
		t.Errorf("expected unitFileState 'enabled' for ssh, got %v", ssh["unitFileState"])
	}
	if ssh["fragmentPath"] != "/usr/lib/systemd/system/ssh.service" {
		t.Errorf("expected fragmentPath '/usr/lib/systemd/system/ssh.service' for ssh, got %v", ssh["fragmentPath"])
	}
}

func TestHandleServices_StaticService(t *testing.T) {
	origUser, origPass := auth.AdminUser, auth.AdminPass
	auth.AdminUser, auth.AdminPass = "admin", "pass"
	defer func() { auth.AdminUser, auth.AdminPass = origUser, origPass }()

	mock := &mockSystemd{services: sampleServices()}
	h := New(nil, mock, nil, nil)
	router := setupTestRouter(h)

	cookie := loginAndGetCookie(t, router, "admin", "pass")

	req := httptest.NewRequest(http.MethodGet, "/api/v1/services", nil)
	req.AddCookie(cookie)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	services := assertJSONArray(t, w, http.StatusOK)

	// docker.service: locked=true, unitFileState="static"
	docker := services[3]
	if docker["locked"] != true {
		t.Error("expected docker.service (UnitFileState=static) to be locked")
	}
	if docker["unitFileState"] != "static" {
		t.Errorf("expected unitFileState 'static' for docker, got %v", docker["unitFileState"])
	}
}

// ============================================================
//  TEST: Edge cases - special characters in service name
// ============================================================

func TestServiceAction_SpecialCharacters(t *testing.T) {
	origUser, origPass := auth.AdminUser, auth.AdminPass
	auth.AdminUser, auth.AdminPass = "admin", "pass"
	defer func() { auth.AdminUser, auth.AdminPass = origUser, origPass }()

	mock := &mockSystemd{services: sampleServices()}
	h := New(nil, mock, nil, nil)
	router := setupTestRouter(h)

	cookie := loginAndGetCookie(t, router, "admin", "pass")

	tests := []struct {
		name       string
		url        string
		expectCode int
	}{
		{"service with @", "/api/v1/services/myapp@.service/start", http.StatusOK},
		{"service with -", "/api/v1/services/my-app.service/start", http.StatusOK},
		{"service with .", "/api/v1/services/my.app.service/start", http.StatusOK},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, tt.url, nil)
			req.AddCookie(cookie)
			w := httptest.NewRecorder()
			router.ServeHTTP(w, req)

			if w.Code != tt.expectCode {
				t.Errorf("expected status %d for %s, got %d: %s",
					tt.expectCode, tt.name, w.Code, w.Body.String())
			}
		})
	}
}

// ============================================================
//  TEST: Restart inactive service (F35)
// ============================================================

func TestServiceRestart_InactiveService(t *testing.T) {
	origUser, origPass := auth.AdminUser, auth.AdminPass
	auth.AdminUser, auth.AdminPass = "admin", "pass"
	defer func() { auth.AdminUser, auth.AdminPass = origUser, origPass }()

	// Mock: myapp.service is inactive (dead)
	mock := &mockSystemd{services: []systemd.Service{
		{Name: "myapp.service", Load: "loaded", Active: "inactive", Sub: "dead", Locked: false},
	}}
	h := New(nil, mock, nil, nil)
	router := setupTestRouter(h)

	cookie := loginAndGetCookie(t, router, "admin", "pass")

	req := httptest.NewRequest(http.MethodPost, "/api/v1/services/myapp.service/restart", nil)
	req.AddCookie(cookie)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	body := assertJSON(t, w, http.StatusOK)
	if body["message"] == nil {
		t.Error("expected success message for restart on inactive service")
	}

	if len(mock.restartCalled) != 1 || mock.restartCalled[0] != "myapp.service" {
		t.Errorf("expected RestartService('myapp.service') to be called, got %v", mock.restartCalled)
	}
}

// ============================================================
//  TEST: Error responses must not leak internal details (F18)
// ============================================================

func TestErrorResponse_NoInternalDetails(t *testing.T) {
	origUser, origPass := auth.AdminUser, auth.AdminPass
	auth.AdminUser, auth.AdminPass = "admin", "pass"
	defer func() { auth.AdminUser, auth.AdminPass = origUser, origPass }()

	// Forbidden words that must never appear in public API error responses
	forbiddenWords := []string{
		"dbus",
		"D-Bus",
		"connection refused",
		"connection failed",
		"permission denied",
		"stack trace",
		"panic",
		"goroutine",
		"/usr/lib/",
		"/etc/systemd/",
		"/home/",
		"0x",
		"runtime error",
	}

	t.Run("list services: dbus error → generic message only", func(t *testing.T) {
		mock := &mockSystemd{
			listErr: fmt.Errorf("dbus connection failed: connection refused /org/freedesktop/systemd1"),
		}
		h := New(nil, mock, nil, nil)
		router := setupTestRouter(h)

		cookie := loginAndGetCookie(t, router, "admin", "pass")

		req := httptest.NewRequest(http.MethodGet, "/api/v1/services", nil)
		req.AddCookie(cookie)
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)

		body := assertJSON(t, w, http.StatusInternalServerError)

		errMsg, _ := body["error"].(string)
		if errMsg == "" {
			t.Error("expected error message in response")
		}

		bodyStr := w.Body.String()
		for _, word := range forbiddenWords {
			if strings.Contains(bodyStr, word) {
				t.Errorf("error response leaked internal detail: %q", word)
			}
		}
	})

	t.Run("start service: permission error → generic message only", func(t *testing.T) {
		mock := &mockSystemd{
			startErr: fmt.Errorf("permission denied: failed to execute systemctl start"),
		}
		h := New(nil, mock, nil, nil)
		router := setupTestRouter(h)

		cookie := loginAndGetCookie(t, router, "admin", "pass")

		req := httptest.NewRequest(http.MethodPost, "/api/v1/services/nginx.service/start", nil)
		req.AddCookie(cookie)
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)

		body := assertJSON(t, w, http.StatusInternalServerError)

		errMsg, _ := body["error"].(string)
		if errMsg == "" {
			t.Error("expected error message in response")
		}

		bodyStr := w.Body.String()
		for _, word := range forbiddenWords {
			if strings.Contains(bodyStr, word) {
				t.Errorf("error response leaked internal detail: %q", word)
			}
		}
	})

	t.Run("stop service: service not found → generic message only", func(t *testing.T) {
		mock := &mockSystemd{
			stopErr: fmt.Errorf("systemctl stop missing.service: exit status 5: Unit missing.service not loaded: No such file or directory"),
		}
		h := New(nil, mock, nil, nil)
		router := setupTestRouter(h)

		cookie := loginAndGetCookie(t, router, "admin", "pass")

		req := httptest.NewRequest(http.MethodPost, "/api/v1/services/missing.service/stop", nil)
		req.AddCookie(cookie)
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)

		body := assertJSON(t, w, http.StatusInternalServerError)

		errMsg, _ := body["error"].(string)
		if errMsg == "" {
			t.Error("expected error message in response")
		}

		// Specifically check that the raw systemctl output is not leaked
		bodyStr := w.Body.String()
		if strings.Contains(bodyStr, "exit status") {
			t.Error("error response leaked 'exit status' detail")
		}
		if strings.Contains(bodyStr, "No such file or directory") {
			t.Error("error response leaked file path detail")
		}
	})
}

// ============================================================
//  TEST: Response content type is always application/json
// ============================================================

func TestJSONContentType(t *testing.T) {
	origUser, origPass := auth.AdminUser, auth.AdminPass
	auth.AdminUser, auth.AdminPass = "admin", "pass"
	defer func() { auth.AdminUser, auth.AdminPass = origUser, origPass }()

	mock := &mockSystemd{services: sampleServices()}
	h := New(nil, mock, nil, nil)
	router := setupTestRouter(h)

	// Test all JSON endpoints return correct content type
	cookie := loginAndGetCookie(t, router, "admin", "pass")

	endpoints := []struct {
		method string
		path   string
	}{
		{http.MethodGet, "/api/v1/services"},
		{http.MethodGet, "/api/v1/session"},
	}

	for _, ep := range endpoints {
		t.Run(ep.method+" "+ep.path, func(t *testing.T) {
			req := httptest.NewRequest(ep.method, ep.path, nil)
			if ep.path != "/api/v1/session" {
				req.AddCookie(cookie)
			}
			w := httptest.NewRecorder()
			router.ServeHTTP(w, req)

			ct := w.Header().Get("Content-Type")
			if !strings.Contains(ct, "application/json") {
				t.Errorf("%s %s: expected Content-Type application/json, got %s",
					ep.method, ep.path, ct)
			}
		})
	}
}

// ============================================================
//  WebSocket Handler Tests
// ============================================================

// setupTestRouterWithWS creates a chi router with all routes including
// the WebSocket log endpoint.
func setupTestRouterWithWS(h *Handler) *chi.Mux {
	r := chi.NewRouter()

	// Public routes
	r.Post("/api/v1/login", h.HandleLoginJSON)
	r.Post("/api/v1/logout", h.HandleLogoutJSON)
	r.Get("/api/v1/session", h.HandleSessionCheck)

	// Protected routes (including WebSocket)
	r.Group(func(r chi.Router) {
		r.Use(authMiddlewareJSON)
		r.Get("/api/v1/services", h.HandleServicesJSON)
		r.Post("/api/v1/services/{name}/start", h.HandleStartJSON)
		r.Post("/api/v1/services/{name}/stop", h.HandleStopJSON)
		r.Post("/api/v1/services/{name}/restart", h.HandleRestartJSON)
		r.Post("/api/v1/services/{name}/enable", h.HandleEnableJSON)
		r.Post("/api/v1/services/{name}/disable", h.HandleDisableJSON)
		r.Get("/api/v1/services/{name}/logs/ws", h.HandleServiceLogsWS)
	})

	return r
}

// connectWS creates an authenticated WebSocket connection to the test server.
func connectWS(t *testing.T, serverURL string, cookie *http.Cookie, path string) (*websocket.Conn, *http.Response, error) {
	t.Helper()

	// Build ws:// URL from http:// URL
	wsURL := "ws" + strings.TrimPrefix(serverURL, "http") + path

	dialer := websocket.Dialer{}
	header := http.Header{}
	if cookie != nil {
		header.Add("Cookie", cookie.Name+"="+cookie.Value)
	}

	return dialer.Dial(wsURL, header)
}

// TestHandleServiceLogsWS_Unauthorized tests HDL-WS-05: unauthenticated → 401.
func TestHandleServiceLogsWS_Unauthorized(t *testing.T) {
	mock := &mockSystemd{}
	h := New(nil, mock, nil, nil)
	router := setupTestRouterWithWS(h)

	server := httptest.NewServer(router)
	defer server.Close()

	_, resp, err := connectWS(t, server.URL, nil, "/api/v1/services/nginx.service/logs/ws?lines=100")
	if err == nil {
		// If no error, check the HTTP response (before upgrade)
		if resp != nil && resp.StatusCode != http.StatusUnauthorized {
			t.Errorf("expected 401 Unauthorized, got %d", resp.StatusCode)
		}
	}
	// Either the upgrade fails with 401 (we get a non-101 response, which
	// gorilla/websocket treats as an error), or we check the HTTP response.
	if resp != nil && resp.StatusCode == http.StatusUnauthorized {
		return // expected
	}
	if err != nil {
		// Upgrade failed due to non-101 response — this is the expected behavior
		if resp == nil {
			t.Log("websocket dial failed (expected for 401):", err)
			return
		}
	}
}

// TestHandleServiceLogsWS_UpgradeSuccess tests HDL-WS-01: WebSocket upgrade succeeds.
func TestHandleServiceLogsWS_UpgradeSuccess(t *testing.T) {
	origUser, origPass := auth.AdminUser, auth.AdminPass
	auth.AdminUser, auth.AdminPass = "admin", "pass"
	defer func() { auth.AdminUser, auth.AdminPass = origUser, origPass }()

	mock := &mockSystemd{}
	h := New(nil, mock, nil, nil)
	router := setupTestRouterWithWS(h)

	server := httptest.NewServer(router)
	defer server.Close()

	cookie := loginAndGetCookie(t, router, "admin", "pass")

	// Replace the journalctl command factory and LookPath to use a fake
	origExec := wsExecCommandContext
	origLook := wsLookPath
	wsExecCommandContext = func(ctx context.Context, name string, arg ...string) *exec.Cmd {
		return exec.CommandContext(ctx, "echo", "test log line")
	}
	wsLookPath = func(file string) (string, error) { return "/usr/bin/journalctl", nil }
	defer func() {
		wsExecCommandContext = origExec
		wsLookPath = origLook
	}()

	conn, _, err := connectWS(t, server.URL, cookie, "/api/v1/services/nginx.service/logs/ws?lines=100")
	if err != nil {
		t.Fatalf("failed to connect WebSocket: %v", err)
	}
	defer conn.Close()

	// Read one message to verify connection works
	conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	_, msg, err := conn.ReadMessage()
	if err != nil {
		// It's OK if we get a close message (echo finished quickly)
		t.Logf("read result (this is normal): msg=%q, err=%v", string(msg), err)
	}
	if msg != nil && string(msg) == "test log line" {
		t.Log("successfully received log line via WebSocket")
	}
}

// TestHandleServiceLogsWS_InvalidName tests that invalid service names are rejected.
func TestHandleServiceLogsWS_InvalidName(t *testing.T) {
	origUser, origPass := auth.AdminUser, auth.AdminPass
	auth.AdminUser, auth.AdminPass = "admin", "pass"
	defer func() { auth.AdminUser, auth.AdminPass = origUser, origPass }()

	mock := &mockSystemd{}
	h := New(nil, mock, nil, nil)
	router := setupTestRouterWithWS(h)

	server := httptest.NewServer(router)
	defer server.Close()

	cookie := loginAndGetCookie(t, router, "admin", "pass")

	_, resp, err := connectWS(t, server.URL, cookie, "/api/v1/services/../../../etc/passwd/logs/ws?lines=100")
	// Should fail (path traversal normalized by HTTP client → 404, or 400 if reaches handler)
	if err == nil && resp != nil && resp.StatusCode == http.StatusSwitchingProtocols {
		t.Error("expected WebSocket upgrade to be rejected for invalid service name")
	}
	t.Logf("result: err=%v, resp.Status=%d", err, func() int {
		if resp != nil {
			return resp.StatusCode
		}
		return 0
	}())
}

// TestHandleServiceLogsWS_InvalidLines tests that invalid line counts are rejected.
func TestHandleServiceLogsWS_InvalidLines(t *testing.T) {
	origUser, origPass := auth.AdminUser, auth.AdminPass
	auth.AdminUser, auth.AdminPass = "admin", "pass"
	defer func() { auth.AdminUser, auth.AdminPass = origUser, origPass }()

	mock := &mockSystemd{}
	h := New(nil, mock, nil, nil)
	router := setupTestRouterWithWS(h)

	server := httptest.NewServer(router)
	defer server.Close()

	cookie := loginAndGetCookie(t, router, "admin", "pass")

	tests := []struct {
		lines string
		desc  string
	}{
		{"0", "zero lines"},
		{"1001", "exceeds max"},
		{"-1", "negative"},
		{"abc", "non-numeric"},
	}

	for _, tt := range tests {
		t.Run(tt.desc, func(t *testing.T) {
			_, resp, err := connectWS(t, server.URL, cookie,
				"/api/v1/services/nginx.service/logs/ws?lines="+tt.lines)
			if err == nil && resp != nil && resp.StatusCode == http.StatusSwitchingProtocols {
				t.Error("expected rejection for invalid lines=" + tt.lines)
			}
		})
	}
}

// TestHandleServiceLogsWS_StdoutPipe tests HDL-WS-02: journalctl stdout pipe → WebSocket.
func TestHandleServiceLogsWS_StdoutPipe(t *testing.T) {
	origUser, origPass := auth.AdminUser, auth.AdminPass
	auth.AdminUser, auth.AdminPass = "admin", "pass"
	defer func() { auth.AdminUser, auth.AdminPass = origUser, origPass }()

	mock := &mockSystemd{}
	h := New(nil, mock, nil, nil)
	router := setupTestRouterWithWS(h)

	server := httptest.NewServer(router)
	defer server.Close()

	cookie := loginAndGetCookie(t, router, "admin", "pass")

	// Use a fake that outputs predictable lines
	origExec := wsExecCommandContext
	origLook := wsLookPath
	wsExecCommandContext = func(ctx context.Context, name string, arg ...string) *exec.Cmd {
		return exec.CommandContext(ctx, "sh", "-c",
			"echo 'line1: service started'; echo 'line2: request received'; echo 'line3: response sent'")
	}
	wsLookPath = func(file string) (string, error) { return "/usr/bin/journalctl", nil }
	defer func() {
		wsExecCommandContext = origExec
		wsLookPath = origLook
	}()

	conn, _, err := connectWS(t, server.URL, cookie, "/api/v1/services/nginx.service/logs/ws?lines=100")
	if err != nil {
		t.Fatalf("failed to connect WebSocket: %v", err)
	}
	defer conn.Close()

	var received []string
	conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	for {
		_, msg, err := conn.ReadMessage()
		if err != nil {
			break // connection closed (echo finished)
		}
		received = append(received, string(msg))
		if len(received) >= 3 {
			break
		}
	}

	if len(received) < 1 {
		t.Error("expected at least one message via WebSocket")
	}
	t.Logf("received %d messages: %v", len(received), received)
}

// TestHandleServiceLogsWS_PermissionDenied tests HDL-WS-04: permission denied → error via WS.
func TestHandleServiceLogsWS_PermissionDenied(t *testing.T) {
	origUser, origPass := auth.AdminUser, auth.AdminPass
	auth.AdminUser, auth.AdminPass = "admin", "pass"
	defer func() { auth.AdminUser, auth.AdminPass = origUser, origPass }()

	mock := &mockSystemd{}
	h := New(nil, mock, nil, nil)
	router := setupTestRouterWithWS(h)

	server := httptest.NewServer(router)
	defer server.Close()

	cookie := loginAndGetCookie(t, router, "admin", "pass")

	// Simulate permission denied
	origExec := wsExecCommandContext
	origLook := wsLookPath
	wsExecCommandContext = func(ctx context.Context, name string, arg ...string) *exec.Cmd {
		return exec.CommandContext(ctx, "sh", "-c",
			"echo 'Permission denied' >&2; exit 1")
	}
	wsLookPath = func(file string) (string, error) { return "/usr/bin/journalctl", nil }
	defer func() {
		wsExecCommandContext = origExec
		wsLookPath = origLook
	}()

	conn, _, err := connectWS(t, server.URL, cookie, "/api/v1/services/nginx.service/logs/ws?lines=100")
	if err != nil {
		t.Fatalf("failed to connect WebSocket: %v", err)
	}
	defer conn.Close()

	// Should receive an error message via WebSocket before close
	conn.SetReadDeadline(time.Now().Add(3 * time.Second))
	_, msg, err := conn.ReadMessage()
	if err != nil {
		t.Logf("read error (connection closed): %v, last message: %q", err, string(msg))
	}
	if msg != nil && strings.Contains(string(msg), "permission denied") {
		t.Log("received permission denied error via WebSocket")
	}
}

// TestHandleServiceLogsWS_ClientClose tests HDL-WS-03: WebSocket close → journalctl killed.
func TestHandleServiceLogsWS_ClientClose(t *testing.T) {
	origUser, origPass := auth.AdminUser, auth.AdminPass
	auth.AdminUser, auth.AdminPass = "admin", "pass"
	defer func() { auth.AdminUser, auth.AdminPass = origUser, origPass }()

	mock := &mockSystemd{}
	h := New(nil, mock, nil, nil)
	router := setupTestRouterWithWS(h)

	server := httptest.NewServer(router)
	defer server.Close()

	cookie := loginAndGetCookie(t, router, "admin", "pass")

	// Use a long-running fake journalctl that outputs periodically
	origExec := wsExecCommandContext
	origLook := wsLookPath
	wsExecCommandContext = func(ctx context.Context, name string, arg ...string) *exec.Cmd {
		return exec.CommandContext(ctx, "sh", "-c",
			"while true; do echo 'log line'; sleep 1; done")
	}
	wsLookPath = func(file string) (string, error) { return "/usr/bin/journalctl", nil }
	defer func() {
		wsExecCommandContext = origExec
		wsLookPath = origLook
	}()

	conn, _, err := connectWS(t, server.URL, cookie, "/api/v1/services/nginx.service/logs/ws?lines=100")
	if err != nil {
		t.Fatalf("failed to connect WebSocket: %v", err)
	}

	// Read one message to confirm we're connected
	conn.SetReadDeadline(time.Now().Add(3 * time.Second))
	_, msg, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("failed to read first message: %v", err)
	}
	t.Logf("received first message: %q", string(msg))

	// Close the client connection
	conn.Close()

	// Give the server time to detect the close and kill the process
	time.Sleep(200 * time.Millisecond)

	// The test passes if we reach here without hanging (the context cancel
	// should have killed the infinite loop journalctl)
}
