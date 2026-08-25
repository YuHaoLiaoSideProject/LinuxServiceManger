package agentapi

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
)

// mockServiceController implements ServiceController for testing.
type mockServiceController struct {
	services    []ServiceInfo
	startCalled string
	stopCalled  string
	restartCalled string
	enableCalled  string
	disableCalled string
	logsCalled    string
	logsLines     int
	logsOutput    string
	systemInfo    SystemInfo
	err           error
}

func (m *mockServiceController) List() ([]ServiceInfo, error) {
	return m.services, m.err
}

func (m *mockServiceController) Start(name string) error {
	m.startCalled = name
	return m.err
}

func (m *mockServiceController) Stop(name string) error {
	m.stopCalled = name
	return m.err
}

func (m *mockServiceController) Restart(name string) error {
	m.restartCalled = name
	return m.err
}

func (m *mockServiceController) Enable(name string) error {
	m.enableCalled = name
	return m.err
}

func (m *mockServiceController) Disable(name string) error {
	m.disableCalled = name
	return m.err
}

func (m *mockServiceController) Logs(name string, lines int) (string, error) {
	m.logsCalled = name
	m.logsLines = lines
	return m.logsOutput, m.err
}

func (m *mockServiceController) SystemInfo() (SystemInfo, error) {
	return m.systemInfo, m.err
}

func TestHealthEndpoint(t *testing.T) {
	mock := &mockServiceController{}
	router := NewRouter(mock, "1.0.0")

	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	var resp map[string]string
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if resp["version"] != "1.0.0" {
		t.Errorf("expected version 1.0.0, got %s", resp["version"])
	}

	if resp["hostname"] == "" {
		t.Error("expected non-empty hostname")
	}
}

func TestListServicesEndpoint(t *testing.T) {
	mock := &mockServiceController{
		services: []ServiceInfo{
			{Name: "nginx.service", Active: "active", Sub: "running", UnitFileState: "enabled"},
			{Name: "redis.service", Active: "inactive", Sub: "dead", UnitFileState: "disabled"},
		},
	}
	router := NewRouter(mock, "1.0.0")

	req := httptest.NewRequest(http.MethodGet, "/api/v1/services", nil)
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	var services []ServiceInfo
	if err := json.NewDecoder(w.Body).Decode(&services); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if len(services) != 2 {
		t.Fatalf("expected 2 services, got %d", len(services))
	}

	if services[0].Name != "nginx.service" {
		t.Errorf("expected nginx.service, got %s", services[0].Name)
	}
}

func TestServiceAction_Start(t *testing.T) {
	mock := &mockServiceController{}
	router := NewRouter(mock, "1.0.0")

	req := httptest.NewRequest(http.MethodPost, "/api/v1/services/nginx.service/start", nil)
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	if mock.startCalled != "nginx.service" {
		t.Errorf("expected Start called with nginx.service, got %s", mock.startCalled)
	}

	var resp map[string]interface{}
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if resp["ok"] != true {
		t.Errorf("expected ok=true, got %v", resp["ok"])
	}
}

func TestServiceAction_Stop(t *testing.T) {
	mock := &mockServiceController{}
	router := NewRouter(mock, "1.0.0")

	req := httptest.NewRequest(http.MethodPost, "/api/v1/services/redis.service/stop", nil)
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	if mock.stopCalled != "redis.service" {
		t.Errorf("expected Stop called with redis.service, got %s", mock.stopCalled)
	}
}

func TestServiceAction_Restart(t *testing.T) {
	mock := &mockServiceController{}
	router := NewRouter(mock, "1.0.0")

	req := httptest.NewRequest(http.MethodPost, "/api/v1/services/nginx.service/restart", nil)
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	if mock.restartCalled != "nginx.service" {
		t.Errorf("expected Restart called with nginx.service, got %s", mock.restartCalled)
	}
}

func TestServiceAction_Enable(t *testing.T) {
	mock := &mockServiceController{}
	router := NewRouter(mock, "1.0.0")

	req := httptest.NewRequest(http.MethodPost, "/api/v1/services/nginx.service/enable", nil)
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	if mock.enableCalled != "nginx.service" {
		t.Errorf("expected Enable called with nginx.service, got %s", mock.enableCalled)
	}
}

func TestServiceAction_Disable(t *testing.T) {
	mock := &mockServiceController{}
	router := NewRouter(mock, "1.0.0")

	req := httptest.NewRequest(http.MethodPost, "/api/v1/services/redis.service/disable", nil)
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	if mock.disableCalled != "redis.service" {
		t.Errorf("expected Disable called with redis.service, got %s", mock.disableCalled)
	}
}

func TestLogsEndpoint(t *testing.T) {
	mock := &mockServiceController{
		logsOutput: "2024-01-01 test log line\n",
	}
	router := NewRouter(mock, "1.0.0")

	req := httptest.NewRequest(http.MethodGet, "/api/v1/services/nginx.service/logs?lines=50", nil)
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	if mock.logsCalled != "nginx.service" {
		t.Errorf("expected Logs called with nginx.service, got %s", mock.logsCalled)
	}

	if mock.logsLines != 50 {
		t.Errorf("expected lines=50, got %d", mock.logsLines)
	}

	if w.Body.String() != "2024-01-01 test log line\n" {
		t.Errorf("unexpected logs output: %s", w.Body.String())
	}
}

func TestLogsEndpoint_DefaultLines(t *testing.T) {
	mock := &mockServiceController{
		logsOutput: "logs",
	}
	router := NewRouter(mock, "1.0.0")

	req := httptest.NewRequest(http.MethodGet, "/api/v1/services/nginx.service/logs", nil)
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	if mock.logsLines != 100 {
		t.Errorf("expected default lines=100, got %d", mock.logsLines)
	}
}

func TestSystemInfoEndpoint(t *testing.T) {
	mock := &mockServiceController{
		systemInfo: SystemInfo{
			OS:       "linux",
			Kernel:   "5.15.0",
			Hostname: "testhost",
			Uptime:   "10d",
			CPU:      "4",
			Memory:   "8GB",
		},
	}
	router := NewRouter(mock, "1.0.0")

	req := httptest.NewRequest(http.MethodGet, "/api/v1/info", nil)
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	var info SystemInfo
	if err := json.NewDecoder(w.Body).Decode(&info); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if info.OS != "linux" {
		t.Errorf("expected OS=linux, got %s", info.OS)
	}

	if info.Hostname != "testhost" {
		t.Errorf("expected Hostname=testhost, got %s", info.Hostname)
	}
}

func TestTokenAuth_AcceptsValidToken(t *testing.T) {
	os.Setenv("AGENT_AUTH_TOKEN", "valid-token")
	defer os.Unsetenv("AGENT_AUTH_TOKEN")

	mock := &mockServiceController{
		services: []ServiceInfo{{Name: "test.service"}},
	}
	router := NewRouter(mock, "1.0.0")

	req := httptest.NewRequest(http.MethodGet, "/api/v1/services", nil)
	req.Header.Set("Authorization", "Bearer valid-token")
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}
}

func TestTokenAuth_AcceptsRawToken(t *testing.T) {
	os.Setenv("AGENT_AUTH_TOKEN", "valid-token")
	defer os.Unsetenv("AGENT_AUTH_TOKEN")

	mock := &mockServiceController{
		services: []ServiceInfo{{Name: "test.service"}},
	}
	router := NewRouter(mock, "1.0.0")

	req := httptest.NewRequest(http.MethodGet, "/api/v1/services", nil)
	req.Header.Set("Authorization", "valid-token")
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}
}

func TestTokenAuth_RejectsInvalidToken(t *testing.T) {
	os.Setenv("AGENT_AUTH_TOKEN", "valid-token")
	defer os.Unsetenv("AGENT_AUTH_TOKEN")

	mock := &mockServiceController{}
	router := NewRouter(mock, "1.0.0")

	req := httptest.NewRequest(http.MethodGet, "/api/v1/services", nil)
	req.Header.Set("Authorization", "Bearer wrong-token")
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("expected status 401, got %d", w.Code)
	}
}

func TestTokenAuth_RejectsMissingToken(t *testing.T) {
	os.Setenv("AGENT_AUTH_TOKEN", "valid-token")
	defer os.Unsetenv("AGENT_AUTH_TOKEN")

	mock := &mockServiceController{}
	router := NewRouter(mock, "1.0.0")

	req := httptest.NewRequest(http.MethodGet, "/api/v1/services", nil)
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("expected status 401, got %d", w.Code)
	}
}

func TestTokenAuth_SkipsWhenNoTokenConfigured(t *testing.T) {
	os.Unsetenv("AGENT_AUTH_TOKEN")

	mock := &mockServiceController{
		services: []ServiceInfo{{Name: "test.service"}},
	}
	router := NewRouter(mock, "1.0.0")

	req := httptest.NewRequest(http.MethodGet, "/api/v1/services", nil)
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200 when no token configured, got %d", w.Code)
	}
}

func TestHealthEndpoint_NoAuthRequired(t *testing.T) {
	os.Setenv("AGENT_AUTH_TOKEN", "valid-token")
	defer os.Unsetenv("AGENT_AUTH_TOKEN")

	mock := &mockServiceController{}
	router := NewRouter(mock, "1.0.0")

	// Health endpoint should not require auth
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200 for health, got %d", w.Code)
	}
}

func TestServiceAction_Error(t *testing.T) {
	mock := &mockServiceController{
		err: fmt.Errorf("service not found"),
	}

	router := NewRouter(mock, "1.0.0")

	req := httptest.NewRequest(http.MethodPost, "/api/v1/services/nonexistent.service/start", nil)
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Errorf("expected status 500, got %d", w.Code)
	}
}

func TestNewRouter_ReturnsHandler(t *testing.T) {
	mock := &mockServiceController{}
	router := NewRouter(mock, "1.0.0")

	if router == nil {
		t.Fatal("expected non-nil router")
	}
}
