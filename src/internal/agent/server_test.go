package agent

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"math/big"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"linux-service-manager/internal/systemd"

	"github.com/go-chi/chi/v5"
)

// ============================================================
//  Mock systemd.ServiceManager（複製 handler_test pattern）
// ============================================================

type mockSystemd struct {
	services      []systemd.Service
	listErr       error
	restartErr    error
	startCalled   []string
	stopCalled    []string
	restartCalled []string
	enableCalled  []string
	disableCalled []string
	logs          string
	logsLines     int
}

func (m *mockSystemd) ListServices() ([]systemd.Service, error) { return m.services, m.listErr }
func (m *mockSystemd) StartService(_ context.Context, name string) error {
	m.startCalled = append(m.startCalled, name)
	return nil
}
func (m *mockSystemd) StopService(_ context.Context, name string) error {
	m.stopCalled = append(m.stopCalled, name)
	return nil
}
func (m *mockSystemd) RestartService(_ context.Context, name string) error {
	m.restartCalled = append(m.restartCalled, name)
	return m.restartErr
}
func (m *mockSystemd) EnableService(name string) error {
	m.enableCalled = append(m.enableCalled, name)
	return nil
}
func (m *mockSystemd) DisableService(name string) error {
	m.disableCalled = append(m.disableCalled, name)
	return nil
}
func (m *mockSystemd) GetUnitFileState(name string) (string, error) { return "enabled", nil }
func (m *mockSystemd) GetServiceLogs(name string, lines int) (string, error) {
	m.logsLines = lines
	return m.logs, nil
}

// ============================================================
//  Helpers
// ============================================================

const testAgentToken = "lsm_node_secret"

func newTestAgentServer(t *testing.T, sm systemd.ServiceManager) (*Server, chi.Router) {
	t.Helper()
	cfg := &Config{
		ManagerAddr: "manager.example.com:8443",
		AuthToken:   testAgentToken,
		NodeName:    "web-server-01",
		ListenAddr:  ":8443",
	}
	s := NewServer(cfg, sm)
	s.version = "1.2.0" // 內部欄位：編譯期注入（-ldflags 或 const）
	return s, s.Routes()
}

func doReq(t *testing.T, router http.Handler, method, path, token string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, path, nil)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	return w
}

func sampleAgentServices() []systemd.Service {
	return []systemd.Service{
		{Name: "nginx.service", Load: "loaded", Active: "active", Sub: "running", UnitFileState: "enabled", FragmentPath: "/etc/systemd/system/nginx.service"},
		{Name: "ssh.service", Load: "loaded", Active: "active", Sub: "running", UnitFileState: "enabled", FragmentPath: "/usr/lib/systemd/system/ssh.service"},
		{Name: "myapp.service", Load: "loaded", Active: "inactive", Sub: "dead", UnitFileState: "disabled", FragmentPath: "/etc/systemd/system/myapp.service"},
	}
}

// ============================================================
//  SYS-46: GET /health 不需 token（test-connection 用）
// ============================================================

func TestAgentHealth_NoToken(t *testing.T) {
	_, router := newTestAgentServer(t, &mockSystemd{})

	w := doReq(t, router, http.MethodGet, "/health", "")
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var body map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}
	if body["version"] != "1.2.0" {
		t.Errorf("version: got %v", body["version"])
	}
	for _, k := range []string{"hostname", "os", "uptime"} {
		if _, ok := body[k]; !ok {
			t.Errorf("missing field %q in /health response", k)
		}
	}
}

// ============================================================
//  SYS-47: token middleware 驗證 /api/v1/*（無/錯/對）
// ============================================================

func TestAgentTokenMiddleware(t *testing.T) {
	_, router := newTestAgentServer(t, &mockSystemd{services: sampleAgentServices()})

	t.Run("no token → 401", func(t *testing.T) {
		w := doReq(t, router, http.MethodGet, "/api/v1/services", "")
		if w.Code != http.StatusUnauthorized {
			t.Errorf("expected 401, got %d", w.Code)
		}
	})
	t.Run("wrong token → 401", func(t *testing.T) {
		w := doReq(t, router, http.MethodGet, "/api/v1/services", "wrong-token")
		if w.Code != http.StatusUnauthorized {
			t.Errorf("expected 401, got %d", w.Code)
		}
	})
	t.Run("correct token → 200", func(t *testing.T) {
		w := doReq(t, router, http.MethodGet, "/api/v1/services", testAgentToken)
		if w.Code != http.StatusOK {
			t.Errorf("expected 200, got %d: %s", w.Code, w.Body.String())
		}
	})
}

// ============================================================
//  SYS-48: GET /api/v1/services 回服務列表（與單機 Manager 同構 schema）
// ============================================================

func TestAgentServicesList(t *testing.T) {
	_, router := newTestAgentServer(t, &mockSystemd{services: sampleAgentServices()})

	w := doReq(t, router, http.MethodGet, "/api/v1/services", testAgentToken)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var services []map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &services); err != nil {
		t.Fatalf("invalid JSON array: %v", err)
	}
	if len(services) != 3 {
		t.Fatalf("expected 3 services, got %d", len(services))
	}
	first := services[0]
	if first["name"] != "nginx.service" {
		t.Errorf("name: got %v", first["name"])
	}
	for _, k := range []string{"load", "active", "sub", "unitFileState", "fragmentPath", "locked"} {
		if _, ok := first[k]; !ok {
			t.Errorf("missing schema field %q (single-machine Manager JSON API 同構)", k)
		}
	}
}

// ============================================================
//  SYS-49: 操作 start/stop/restart/enable/disable
// ============================================================

func TestAgentServiceOps(t *testing.T) {
	mock := &mockSystemd{services: sampleAgentServices()}
	_, router := newTestAgentServer(t, mock)

	ops := []struct {
		action string
		called *[]string
	}{
		{"start", &mock.startCalled},
		{"stop", &mock.stopCalled},
		{"restart", &mock.restartCalled},
		{"enable", &mock.enableCalled},
		{"disable", &mock.disableCalled},
	}

	for _, op := range ops {
		t.Run(op.action, func(t *testing.T) {
			w := doReq(t, router, http.MethodPost, "/api/v1/services/nginx.service/"+op.action, testAgentToken)
			if w.Code != http.StatusOK {
				t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
			}
			if len(*op.called) != 1 || (*op.called)[0] != "nginx.service" {
				t.Errorf("expected %s(nginx.service) called, got %v", op.action, *op.called)
			}
			// 操作成功回傳更新後狀態（含服務名稱）
			if !strings.Contains(w.Body.String(), "nginx.service") {
				t.Errorf("response should include updated service state, got %s", w.Body.String())
			}
		})
	}
}

// ============================================================
//  SYS-50: 操作失敗（權限不足）→ 錯誤回應含原因
// ============================================================

func TestAgentServiceOp_Failure(t *testing.T) {
	mock := &mockSystemd{restartErr: errorPermDenied()}
	_, router := newTestAgentServer(t, mock)

	w := doReq(t, router, http.MethodPost, "/api/v1/services/nginx.service/restart", testAgentToken)
	if w.Code < 400 {
		t.Fatalf("expected error status, got %d: %s", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), "permission denied") {
		t.Errorf("error response should contain the reason, got %s", w.Body.String())
	}
	if len(mock.restartCalled) != 1 {
		t.Errorf("restart should have been attempted, got %v", mock.restartCalled)
	}
}

func errorPermDenied() error {
	return &opError{"permission denied"}
}

type opError struct{ msg string }

func (e *opError) Error() string { return e.msg }

// ============================================================
//  SYS-51: GET /api/v1/services?q= substring 過濾（決策 9）
// ============================================================

func TestAgentServicesQueryFilter(t *testing.T) {
	mock := &mockSystemd{services: []systemd.Service{
		{Name: "nginx.service", Active: "active", Sub: "running"},
		{Name: "nginx-auth.service", Active: "active", Sub: "running"},
		{Name: "ssh.service", Active: "active", Sub: "running"},
		{Name: "docker.service", Active: "active", Sub: "running"},
		{Name: "myapp.service", Active: "inactive", Sub: "dead"},
	}}
	_, router := newTestAgentServer(t, mock)

	w := doReq(t, router, http.MethodGet, "/api/v1/services?q=nginx", testAgentToken)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var services []map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &services); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}
	if len(services) != 2 {
		t.Fatalf("expected 2 nginx services, got %d", len(services))
	}
	for _, s := range services {
		if name, _ := s["name"].(string); !strings.Contains(name, "nginx") {
			t.Errorf("non-matching service returned: %q", name)
		}
	}
}

// ============================================================
//  SYS-52: GET /api/v1/services/{name}/logs?lines= 純文字日誌
// ============================================================

func TestAgentServiceLogs(t *testing.T) {
	mock := &mockSystemd{logs: "line1: started\nline2: request\n"}
	_, router := newTestAgentServer(t, mock)

	w := doReq(t, router, http.MethodGet, "/api/v1/services/nginx.service/logs?lines=100", testAgentToken)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	if mock.logsLines != 100 {
		t.Errorf("lines param not forwarded to GetServiceLogs: got %d", mock.logsLines)
	}
	if !strings.Contains(w.Body.String(), "line1: started") {
		t.Errorf("logs body mismatch: %s", w.Body.String())
	}
	ct := w.Header().Get("Content-Type")
	if !strings.Contains(ct, "text/plain") {
		t.Errorf("expected text/plain, got %q", ct)
	}
}

// ============================================================
//  SYS-53: GET /api/v1/system/info（proxy 的 info 目標端點）
// ============================================================

func TestAgentSystemInfo(t *testing.T) {
	_, router := newTestAgentServer(t, &mockSystemd{})

	w := doReq(t, router, http.MethodGet, "/api/v1/system/info", testAgentToken)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var body map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}
	for _, k := range []string{"os", "kernel", "uptime", "cpu", "mem", "disk"} {
		if _, ok := body[k]; !ok {
			t.Errorf("missing field %q in system info", k)
		}
	}
}

// ============================================================
//  SYS-54: HTTP 非 TLS 連線回 426 Upgrade Required（決策 1）
// ============================================================

func TestRequireTLS_PlainHTTPRejected(t *testing.T) {
	_, router := newTestAgentServer(t, &mockSystemd{})
	wrapped := RequireTLS(router)

	// httptest.NewRequest 的 r.TLS 為 nil → 視為明文連線
	for _, path := range []string{"/health", "/api/v1/services"} {
		w := doReq(t, wrapped, http.MethodGet, path, testAgentToken)
		if w.Code != http.StatusUpgradeRequired {
			t.Errorf("%s: expected 426, got %d", path, w.Code)
		}
	}

	// 端對端：以明文 httptest.NewServer 連線 → 426
	plain := httptest.NewServer(wrapped)
	defer plain.Close()
	resp, err := http.Get(plain.URL + "/health")
	if err != nil {
		t.Fatalf("plain GET: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusUpgradeRequired {
		t.Errorf("plain HTTP over the wire: expected 426, got %d", resp.StatusCode)
	}
}

// ============================================================
//  SYS-55: mTLS 啟用時驗證 Manager 憑證（無 cert 拒絕 / 有 cert 成功）
// ============================================================

func TestAgentServer_MTLS(t *testing.T) {
	_, router := newTestAgentServer(t, &mockSystemd{})

	clientCert, clientLeaf := newAgentClientCert(t)
	pool := x509.NewCertPool()
	pool.AddCert(clientLeaf)

	ts := httptest.NewUnstartedServer(RequireTLS(router))
	ts.TLS = &tls.Config{ClientAuth: tls.RequireAndVerifyClientCert, ClientCAs: pool}
	ts.StartTLS()
	defer ts.Close()

	t.Run("無 client cert 連線被拒（handshake 失敗）", func(t *testing.T) {
		noCert := &http.Client{Transport: &http.Transport{TLSClientConfig: &tls.Config{InsecureSkipVerify: true}}}
		resp, err := noCert.Get(ts.URL + "/health")
		if err == nil {
			resp.Body.Close()
			t.Error("expected handshake failure without client cert")
		}
	})

	t.Run("帶正確 client cert 成功", func(t *testing.T) {
		tr := ts.Client().Transport.(*http.Transport).Clone()
		tr.TLSClientConfig.Certificates = []tls.Certificate{clientCert}
		withCert := &http.Client{Transport: tr}

		// /health 不需 token
		resp, err := withCert.Get(ts.URL + "/health")
		if err != nil {
			t.Fatalf("mTLS request failed: %v", err)
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			t.Errorf("expected 200 from /health under mTLS, got %d", resp.StatusCode)
		}

		// /api/v1/* 仍需 Bearer token（mTLS 驗證 Manager 憑證之外，token 層仍生效）
		req, _ := http.NewRequest(http.MethodGet, ts.URL+"/api/v1/services", nil)
		resp2, err := withCert.Do(req)
		if err != nil {
			t.Fatalf("mTLS request failed: %v", err)
		}
		resp2.Body.Close()
		if resp2.StatusCode != http.StatusUnauthorized {
			t.Errorf("expected 401 without token (mTLS ok, token missing), got %d", resp2.StatusCode)
		}
	})
}

// newAgentClientCert 產生 Manager client certificate（agent 套件測試專用）。
func newAgentClientCert(t *testing.T) (tls.Certificate, *x509.Certificate) {
	t.Helper()
	priv, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	tmpl := &x509.Certificate{
		SerialNumber: big.NewInt(1),
		Subject:      pkix.Name{CommonName: "lsm-manager-test"},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().Add(time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth},
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, tmpl, &priv.PublicKey, priv)
	if err != nil {
		t.Fatalf("create certificate: %v", err)
	}
	cert := tls.Certificate{Certificate: [][]byte{der}, PrivateKey: priv}
	leaf, err := x509.ParseCertificate(der)
	if err != nil {
		t.Fatalf("parse certificate: %v", err)
	}
	return cert, leaf
}
