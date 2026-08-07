package handler

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"linux-service-manager/internal/auth"
	"linux-service-manager/internal/systemd"

	"github.com/go-chi/chi/v5"
)

// ============================================================
//  Mock systemd manager
// ============================================================

type mockSystemd struct {
	services    []systemd.Service
	listErr     error
	startErr    error
	stopErr     error
	restartErr  error
	startCalled []string
	stopCalled  []string
	restartCalled []string
}

func (m *mockSystemd) ListServices() ([]systemd.Service, error) {
	if m.listErr != nil {
		return nil, m.listErr
	}
	return m.services, nil
}

func (m *mockSystemd) StartService(name string) error {
	m.startCalled = append(m.startCalled, name)
	return m.startErr
}

func (m *mockSystemd) StopService(name string) error {
	m.stopCalled = append(m.stopCalled, name)
	return m.stopErr
}

func (m *mockSystemd) RestartService(name string) error {
	m.restartCalled = append(m.restartCalled, name)
	return m.restartErr
}

// ============================================================
//  Test fixtures
// ============================================================

func sampleServices() []systemd.Service {
	return []systemd.Service{
		{Name: "nginx.service", Load: "loaded", Active: "active", Sub: "running", Locked: false},
		{Name: "ssh.service", Load: "loaded", Active: "active", Sub: "running", Locked: true},
		{Name: "myapp.service", Load: "loaded", Active: "inactive", Sub: "dead", Locked: false},
		{Name: "docker.service", Load: "loaded", Active: "failed", Sub: "failed", Locked: true},
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
	for _, c := range cookies {
		if c.Name == "linux-service-manager" {
			return c
		}
	}
	t.Fatal("no session cookie returned from login")
	return nil
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
	h := New(nil, mock)
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
	h := New(nil, mock)
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
	h := New(nil, mock)
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
	h := New(nil, mock)
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
	h := New(nil, mock)
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
	h := New(nil, mock)
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
	h := New(nil, mock)
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
	h := New(nil, mock)
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
	h := New(nil, mock)
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
	h := New(nil, mock)
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
	h := New(nil, mock)
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
	h := New(nil, mock)
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
	h := New(nil, mock)
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
	h := New(nil, mock)
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
	h := New(nil, mock)
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
	h := New(nil, mock)
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
//  TEST: Edge cases - special characters in service name
// ============================================================

func TestServiceAction_SpecialCharacters(t *testing.T) {
	origUser, origPass := auth.AdminUser, auth.AdminPass
	auth.AdminUser, auth.AdminPass = "admin", "pass"
	defer func() { auth.AdminUser, auth.AdminPass = origUser, origPass }()

	mock := &mockSystemd{services: sampleServices()}
	h := New(nil, mock)
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
	h := New(nil, mock)
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
		h := New(nil, mock)
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
		h := New(nil, mock)
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
		h := New(nil, mock)
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
	h := New(nil, mock)
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
