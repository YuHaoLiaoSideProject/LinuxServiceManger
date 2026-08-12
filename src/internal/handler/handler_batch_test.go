package handler

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"

	"linux-service-manager/internal/auth"
	"linux-service-manager/internal/systemd"
)

// ============================================================
//  Batch test fixtures
// ============================================================

// sampleServicesForBatch returns 3 non-locked services for batch success tests.
func sampleServicesForBatch() []systemd.Service {
	return []systemd.Service{
		{Name: "nginx.service", Load: "loaded", Active: "active", Sub: "running", Locked: false, UnitFileState: "enabled", FragmentPath: "/etc/systemd/system/nginx.service"},
		{Name: "myapp.service", Load: "loaded", Active: "inactive", Sub: "dead", Locked: false, UnitFileState: "disabled", FragmentPath: "/etc/systemd/system/myapp.service"},
		{Name: "docker.service", Load: "loaded", Active: "failed", Sub: "failed", Locked: false, UnitFileState: "static", FragmentPath: "/usr/lib/systemd/system/docker.service"},
	}
}

// setupTestRouterWithBatch creates a chi router with all JSON routes
// including the batch endpoint for testing.
func setupTestRouterWithBatch(h *Handler) *chi.Mux {
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
		r.Post("/api/v1/services/batch", h.HandleBatchServices)
	})

	return r
}

// ============================================================
//  Helper: send batch request
// ============================================================

func sendBatchRequest(t *testing.T, router http.Handler, cookie *http.Cookie, body interface{}) *httptest.ResponseRecorder {
	t.Helper()

	var bodyReader *bytes.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			t.Fatalf("failed to marshal request body: %v", err)
		}
		bodyReader = bytes.NewReader(b)
	} else {
		bodyReader = bytes.NewReader([]byte{})
	}

	req := httptest.NewRequest(http.MethodPost, "/api/v1/services/batch", bodyReader)
	req.Header.Set("Content-Type", "application/json")
	if cookie != nil {
		req.AddCookie(cookie)
	}
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	return w
}

func sendBatchRawBody(t *testing.T, router http.Handler, cookie *http.Cookie, rawBody string) *httptest.ResponseRecorder {
	t.Helper()

	req := httptest.NewRequest(http.MethodPost, "/api/v1/services/batch", strings.NewReader(rawBody))
	req.Header.Set("Content-Type", "application/json")
	if cookie != nil {
		req.AddCookie(cookie)
	}
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	return w
}

// ============================================================
//  TEST: TestBatchServices_Success
// ============================================================

func TestBatchServices_Success(t *testing.T) {
	origUser, origPass := auth.AdminUser, auth.AdminPass
	auth.AdminUser, auth.AdminPass = "admin", "pass"
	defer func() { auth.AdminUser, auth.AdminPass = origUser, origPass }()

	mock := &mockSystemd{services: sampleServicesForBatch()}
	h := New(nil, mock, nil, nil)
	router := setupTestRouterWithBatch(h)

	cookie := loginAndGetCookie(t, router, "admin", "pass")

	reqBody := map[string]interface{}{
		"names":  []string{"nginx.service", "myapp.service", "docker.service"},
		"action": "start",
	}
	w := sendBatchRequest(t, router, cookie, reqBody)

	body := assertJSON(t, w, http.StatusOK)

	// Verify summary
	summary, ok := body["summary"].(map[string]interface{})
	if !ok {
		t.Fatal("missing or invalid 'summary' in response")
	}
	if v, _ := summary["total"].(float64); int(v) != 3 {
		t.Errorf("expected summary.total=3, got %v", v)
	}
	if v, _ := summary["success"].(float64); int(v) != 3 {
		t.Errorf("expected summary.success=3, got %v", v)
	}
	if v, _ := summary["failed"].(float64); int(v) != 0 {
		t.Errorf("expected summary.failed=0, got %v", v)
	}

	// Verify results array
	results, ok := body["results"].([]interface{})
	if !ok {
		t.Fatal("missing or invalid 'results' in response")
	}
	if len(results) != 3 {
		t.Fatalf("expected 3 results, got %d", len(results))
	}

	// Verify startCalled has all 3 names
	if len(mock.startCalled) != 3 {
		t.Errorf("expected 3 calls to StartService, got %d: %v", len(mock.startCalled), mock.startCalled)
	}

	expectedNames := map[string]bool{
		"nginx.service":  false,
		"myapp.service":  false,
		"docker.service": false,
	}
	for _, name := range mock.startCalled {
		if _, exists := expectedNames[name]; exists {
			expectedNames[name] = true
		}
	}
	for name, found := range expectedNames {
		if !found {
			t.Errorf("StartService was not called for %s", name)
		}
	}
}

// ============================================================
//  TEST: TestBatchServices_PartialFailure
// ============================================================

func TestBatchServices_PartialFailure(t *testing.T) {
	origUser, origPass := auth.AdminUser, auth.AdminPass
	auth.AdminUser, auth.AdminPass = "admin", "pass"
	defer func() { auth.AdminUser, auth.AdminPass = origUser, origPass }()

	mock := &mockSystemd{
		services:    sampleServicesForBatch(),
		startErrFor: map[string]error{"myapp.service": fmt.Errorf("service start failed")},
	}
	h := New(nil, mock, nil, nil)
	router := setupTestRouterWithBatch(h)

	cookie := loginAndGetCookie(t, router, "admin", "pass")

	reqBody := map[string]interface{}{
		"names":  []string{"nginx.service", "myapp.service", "docker.service"},
		"action": "start",
	}
	w := sendBatchRequest(t, router, cookie, reqBody)

	body := assertJSON(t, w, http.StatusOK)

	// Verify summary
	summary, ok := body["summary"].(map[string]interface{})
	if !ok {
		t.Fatal("missing or invalid 'summary' in response")
	}
	if v, _ := summary["total"].(float64); int(v) != 3 {
		t.Errorf("expected summary.total=3, got %v", v)
	}
	if v, _ := summary["success"].(float64); int(v) != 2 {
		t.Errorf("expected summary.success=2, got %v", v)
	}
	if v, _ := summary["failed"].(float64); int(v) != 1 {
		t.Errorf("expected summary.failed=1, got %v", v)
	}

	// Verify results contain 1 failure
	results, ok := body["results"].([]interface{})
	if !ok {
		t.Fatal("missing or invalid 'results' in response")
	}

	failureCount := 0
	for _, r := range results {
		rmap := r.(map[string]interface{})
		if rmap["result"] == "failure" {
			failureCount++
			if rmap["error"] == nil || rmap["error"] == "" {
				t.Error("failure result should have non-empty 'error' field")
			}
		}
	}
	if failureCount != 1 {
		t.Errorf("expected 1 failure result, got %d", failureCount)
	}
}

// ============================================================
//  TEST: TestBatchServices_AllFailure
// ============================================================

func TestBatchServices_AllFailure(t *testing.T) {
	origUser, origPass := auth.AdminUser, auth.AdminPass
	auth.AdminUser, auth.AdminPass = "admin", "pass"
	defer func() { auth.AdminUser, auth.AdminPass = origUser, origPass }()

	mock := &mockSystemd{
		services: sampleServicesForBatch(),
		startErr: fmt.Errorf("dbus error"),
	}
	h := New(nil, mock, nil, nil)
	router := setupTestRouterWithBatch(h)

	cookie := loginAndGetCookie(t, router, "admin", "pass")

	reqBody := map[string]interface{}{
		"names":  []string{"nginx.service", "myapp.service", "docker.service"},
		"action": "start",
	}
	w := sendBatchRequest(t, router, cookie, reqBody)

	body := assertJSON(t, w, http.StatusOK)

	// Verify summary
	summary, ok := body["summary"].(map[string]interface{})
	if !ok {
		t.Fatal("missing or invalid 'summary' in response")
	}
	if v, _ := summary["total"].(float64); int(v) != 3 {
		t.Errorf("expected summary.total=3, got %v", v)
	}
	if v, _ := summary["success"].(float64); int(v) != 0 {
		t.Errorf("expected summary.success=0, got %v", v)
	}
	if v, _ := summary["failed"].(float64); int(v) != 3 {
		t.Errorf("expected summary.failed=3, got %v", v)
	}

	// All results should be "failure"
	results, ok := body["results"].([]interface{})
	if !ok {
		t.Fatal("missing or invalid 'results' in response")
	}
	for _, r := range results {
		rmap := r.(map[string]interface{})
		if rmap["result"] != "failure" {
			t.Errorf("expected all results to be 'failure', got %v", rmap["result"])
		}
	}
}

// ============================================================
//  TEST: TestBatchServices_EmptyNames
// ============================================================

func TestBatchServices_EmptyNames(t *testing.T) {
	origUser, origPass := auth.AdminUser, auth.AdminPass
	auth.AdminUser, auth.AdminPass = "admin", "pass"
	defer func() { auth.AdminUser, auth.AdminPass = origUser, origPass }()

	mock := &mockSystemd{services: sampleServices()}
	h := New(nil, mock, nil, nil)
	router := setupTestRouterWithBatch(h)

	cookie := loginAndGetCookie(t, router, "admin", "pass")

	reqBody := map[string]interface{}{
		"names":  []string{},
		"action": "start",
	}
	w := sendBatchRequest(t, router, cookie, reqBody)

	body := assertJSON(t, w, http.StatusBadRequest)
	if body["error"] != "names must not be empty" {
		t.Errorf("expected error 'names must not be empty', got %v", body["error"])
	}
}

// ============================================================
//  TEST: TestBatchServices_ExceedsMaxBatchSize
// ============================================================

func TestBatchServices_ExceedsMaxBatchSize(t *testing.T) {
	origUser, origPass := auth.AdminUser, auth.AdminPass
	auth.AdminUser, auth.AdminPass = "admin", "pass"
	defer func() { auth.AdminUser, auth.AdminPass = origUser, origPass }()

	mock := &mockSystemd{services: sampleServices()}
	h := New(nil, mock, nil, nil)
	router := setupTestRouterWithBatch(h)

	cookie := loginAndGetCookie(t, router, "admin", "pass")

	// Build 51 service names
	names := make([]string, 51)
	for i := 0; i < 51; i++ {
		names[i] = fmt.Sprintf("svc%d.service", i)
	}

	reqBody := map[string]interface{}{
		"names":  names,
		"action": "start",
	}
	w := sendBatchRequest(t, router, cookie, reqBody)

	body := assertJSON(t, w, http.StatusBadRequest)
	if body["error"] != "batch size exceeds maximum of 50" {
		t.Errorf("expected error 'batch size exceeds maximum of 50', got %v", body["error"])
	}
}

// ============================================================
//  TEST: TestBatchServices_InvalidAction
// ============================================================

func TestBatchServices_InvalidAction(t *testing.T) {
	origUser, origPass := auth.AdminUser, auth.AdminPass
	auth.AdminUser, auth.AdminPass = "admin", "pass"
	defer func() { auth.AdminUser, auth.AdminPass = origUser, origPass }()

	mock := &mockSystemd{services: sampleServices()}
	h := New(nil, mock, nil, nil)
	router := setupTestRouterWithBatch(h)

	cookie := loginAndGetCookie(t, router, "admin", "pass")

	reqBody := map[string]interface{}{
		"names":  []string{"nginx.service"},
		"action": "delete",
	}
	w := sendBatchRequest(t, router, cookie, reqBody)

	body := assertJSON(t, w, http.StatusBadRequest)
	if body["error"] != "invalid action, must be start, stop, or restart" {
		t.Errorf("expected error 'invalid action, must be start, stop, or restart', got %v", body["error"])
	}
}

// ============================================================
//  TEST: TestBatchServices_LockedService
// ============================================================

func TestBatchServices_LockedService(t *testing.T) {
	origUser, origPass := auth.AdminUser, auth.AdminPass
	auth.AdminUser, auth.AdminPass = "admin", "pass"
	defer func() { auth.AdminUser, auth.AdminPass = origUser, origPass }()

	// sampleServices includes ssh.service with Locked=true
	mock := &mockSystemd{services: sampleServices()}
	h := New(nil, mock, nil, nil)
	router := setupTestRouterWithBatch(h)

	cookie := loginAndGetCookie(t, router, "admin", "pass")

	reqBody := map[string]interface{}{
		"names":  []string{"nginx.service", "ssh.service", "myapp.service"},
		"action": "start",
	}
	w := sendBatchRequest(t, router, cookie, reqBody)

	body := assertJSON(t, w, http.StatusBadRequest)
	errMsg, _ := body["error"].(string)
	if !strings.Contains(errMsg, "locked service cannot be batch-operated") {
		t.Errorf("expected error about locked service, got %v", body["error"])
	}
	if !strings.Contains(errMsg, "ssh.service") {
		t.Errorf("expected error to mention ssh.service, got %v", body["error"])
	}
}

// ============================================================
//  TEST: TestBatchServices_InvalidJSON
// ============================================================

func TestBatchServices_InvalidJSON(t *testing.T) {
	origUser, origPass := auth.AdminUser, auth.AdminPass
	auth.AdminUser, auth.AdminPass = "admin", "pass"
	defer func() { auth.AdminUser, auth.AdminPass = origUser, origPass }()

	mock := &mockSystemd{services: sampleServices()}
	h := New(nil, mock, nil, nil)
	router := setupTestRouterWithBatch(h)

	cookie := loginAndGetCookie(t, router, "admin", "pass")

	w := sendBatchRawBody(t, router, cookie, `{"names": ["nginx.service"], "action": "start",}`)

	body := assertJSON(t, w, http.StatusBadRequest)
	if body["error"] != "invalid request body" {
		t.Errorf("expected error 'invalid request body', got %v", body["error"])
	}
}

// ============================================================
//  TEST: TestBatchServices_Unauthorized
// ============================================================

func TestBatchServices_Unauthorized(t *testing.T) {
	mock := &mockSystemd{services: sampleServices()}
	h := New(nil, mock, nil, nil)
	router := setupTestRouterWithBatch(h)

	reqBody := map[string]interface{}{
		"names":  []string{"nginx.service"},
		"action": "start",
	}
	w := sendBatchRequest(t, router, nil, reqBody)

	assertJSON(t, w, http.StatusUnauthorized)
}

// ============================================================
//  TEST: TestBatchServices_StopAction
// ============================================================

func TestBatchServices_StopAction(t *testing.T) {
	origUser, origPass := auth.AdminUser, auth.AdminPass
	auth.AdminUser, auth.AdminPass = "admin", "pass"
	defer func() { auth.AdminUser, auth.AdminPass = origUser, origPass }()

	mock := &mockSystemd{services: sampleServicesForBatch()}
	h := New(nil, mock, nil, nil)
	router := setupTestRouterWithBatch(h)

	cookie := loginAndGetCookie(t, router, "admin", "pass")

	reqBody := map[string]interface{}{
		"names":  []string{"nginx.service", "myapp.service"},
		"action": "stop",
	}
	w := sendBatchRequest(t, router, cookie, reqBody)

	body := assertJSON(t, w, http.StatusOK)

	// Verify summary
	summary, ok := body["summary"].(map[string]interface{})
	if !ok {
		t.Fatal("missing or invalid 'summary' in response")
	}
	if v, _ := summary["success"].(float64); int(v) != 2 {
		t.Errorf("expected summary.success=2, got %v", v)
	}

	// Verify stopCalled
	if len(mock.stopCalled) != 2 {
		t.Errorf("expected 2 calls to StopService, got %d: %v", len(mock.stopCalled), mock.stopCalled)
	}
	if mock.stopCalled[0] != "nginx.service" || mock.stopCalled[1] != "myapp.service" {
		t.Errorf("expected StopService calls in order [nginx.service, myapp.service], got %v", mock.stopCalled)
	}
}

// ============================================================
//  TEST: TestBatchServices_RestartAction
// ============================================================

func TestBatchServices_RestartAction(t *testing.T) {
	origUser, origPass := auth.AdminUser, auth.AdminPass
	auth.AdminUser, auth.AdminPass = "admin", "pass"
	defer func() { auth.AdminUser, auth.AdminPass = origUser, origPass }()

	mock := &mockSystemd{services: sampleServicesForBatch()}
	h := New(nil, mock, nil, nil)
	router := setupTestRouterWithBatch(h)

	cookie := loginAndGetCookie(t, router, "admin", "pass")

	reqBody := map[string]interface{}{
		"names":  []string{"docker.service"},
		"action": "restart",
	}
	w := sendBatchRequest(t, router, cookie, reqBody)

	body := assertJSON(t, w, http.StatusOK)

	summary, ok := body["summary"].(map[string]interface{})
	if !ok {
		t.Fatal("missing or invalid 'summary' in response")
	}
	if v, _ := summary["success"].(float64); int(v) != 1 {
		t.Errorf("expected summary.success=1, got %v", v)
	}

	if len(mock.restartCalled) != 1 || mock.restartCalled[0] != "docker.service" {
		t.Errorf("expected RestartService('docker.service') to be called, got %v", mock.restartCalled)
	}
}

// ============================================================
//  TEST: TestBatchServices_SystemdListError
// ============================================================

func TestBatchServices_SystemdListError(t *testing.T) {
	origUser, origPass := auth.AdminUser, auth.AdminPass
	auth.AdminUser, auth.AdminPass = "admin", "pass"
	defer func() { auth.AdminUser, auth.AdminPass = origUser, origPass }()

	mock := &mockSystemd{
		services: nil,
		listErr:  fmt.Errorf("dbus connection failed"),
	}
	h := New(nil, mock, nil, nil)
	router := setupTestRouterWithBatch(h)

	cookie := loginAndGetCookie(t, router, "admin", "pass")

	reqBody := map[string]interface{}{
		"names":  []string{"nginx.service"},
		"action": "start",
	}
	w := sendBatchRequest(t, router, cookie, reqBody)

	body := assertJSON(t, w, http.StatusInternalServerError)
	if body["error"] != "failed to list services" {
		t.Errorf("expected error 'failed to list services', got %v", body["error"])
	}
}

// ============================================================
//  TEST: TestBatchServices_ResponseIntegrity
// ============================================================

func TestBatchServices_ResponseIntegrity(t *testing.T) {
	origUser, origPass := auth.AdminUser, auth.AdminPass
	auth.AdminUser, auth.AdminPass = "admin", "pass"
	defer func() { auth.AdminUser, auth.AdminPass = origUser, origPass }()

	mock := &mockSystemd{
		services:    sampleServicesForBatch(),
		startErrFor: map[string]error{"myapp.service": fmt.Errorf("start failed for myapp")},
	}
	h := New(nil, mock, nil, nil)
	router := setupTestRouterWithBatch(h)

	cookie := loginAndGetCookie(t, router, "admin", "pass")

	reqBody := map[string]interface{}{
		"names":  []string{"nginx.service", "myapp.service", "docker.service"},
		"action": "start",
	}
	w := sendBatchRequest(t, router, cookie, reqBody)

	body := assertJSON(t, w, http.StatusOK)

	// Verify summary fields exist
	summary, ok := body["summary"].(map[string]interface{})
	if !ok {
		t.Fatal("missing 'summary' in response")
	}
	for _, field := range []string{"total", "success", "failed"} {
		if _, exists := summary[field]; !exists {
			t.Errorf("summary missing field: %s", field)
		}
	}

	// Verify results array
	results, ok := body["results"].([]interface{})
	if !ok {
		t.Fatal("missing 'results' array in response")
	}
	if len(results) != 3 {
		t.Fatalf("expected 3 results, got %d", len(results))
	}

	// Verify each result has required fields
	requiredFields := []string{"name", "action", "result"}
	for i, r := range results {
		rmap, ok := r.(map[string]interface{})
		if !ok {
			t.Fatalf("result[%d] is not an object", i)
		}
		for _, field := range requiredFields {
			if _, exists := rmap[field]; !exists {
				t.Errorf("result[%d] missing field: %s", i, field)
			}
		}

		// Success: should NOT have error field (or it should be empty/omitted)
		// Failure: should have non-empty error field
		if rmap["result"] == "success" {
			if errVal, exists := rmap["error"]; exists && errVal != nil && errVal != "" {
				t.Errorf("result[%d] success should not have error field, got: %v", i, errVal)
			}
		} else if rmap["result"] == "failure" {
			errVal, exists := rmap["error"]
			if !exists || errVal == nil || errVal == "" {
				t.Errorf("result[%d] failure should have non-empty error field", i)
			}
		}
	}
}
