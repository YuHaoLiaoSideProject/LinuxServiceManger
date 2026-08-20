package nodes

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/hex"
	"encoding/pem"
	"errors"
	"math/big"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// ============================================================
//  Helpers
// ============================================================

// serverFingerprint 計算 httptest TLS server 憑證的 SHA-256 指紋（hex）。
func serverFingerprint(t *testing.T, srv *httptest.Server) string {
	t.Helper()
	cert := srv.Certificate()
	if cert == nil {
		t.Fatal("test server has no certificate")
	}
	sum := sha256.Sum256(cert.Raw)
	return hex.EncodeToString(sum[:])
}

func testNode(addr, fp, token string) *Node {
	return &Node{Name: "web-server-01", Address: addr, TLSFingerprint: fp, Token: token}
}

// pinFingerprint 產生與 tlsConfigFor 相同語意的 leaf cert SHA-256 指紋比對閉包。
func pinFingerprint(fp string) func(rawCerts [][]byte, verifiedChains [][]*x509.Certificate) error {
	return func(rawCerts [][]byte, _ [][]*x509.Certificate) error {
		if len(rawCerts) == 0 {
			return errors.New("no peer certificate")
		}
		sum := sha256.Sum256(rawCerts[0])
		if hex.EncodeToString(sum[:]) != fp {
			return errors.New("certificate fingerprint mismatch")
		}
		return nil
	}
}

// newTestClientCert 產生一組 Manager 端 client certificate（mTLS 測試用）。
func newTestClientCert(t *testing.T) (tls.Certificate, *x509.Certificate) {
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

// writeTestClientCertPEM 將 test client cert 寫為 PEM 檔案（Node.ClientCert/ClientKey 路徑用）。
func writeTestClientCertPEM(t *testing.T, tc tls.Certificate) (certPath, keyPath string) {
	t.Helper()
	dir := t.TempDir()
	certPath = filepath.Join(dir, "client.crt")
	keyPath = filepath.Join(dir, "client.key")

	der := tc.Certificate[0]
	if err := os.WriteFile(certPath, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}), 0600); err != nil {
		t.Fatalf("write client cert pem: %v", err)
	}
	priv, ok := tc.PrivateKey.(*rsa.PrivateKey)
	if !ok {
		t.Fatalf("unexpected private key type %T", tc.PrivateKey)
	}
	keyPEM := pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(priv)})
	if err := os.WriteFile(keyPath, keyPEM, 0600); err != nil {
		t.Fatalf("write client key pem: %v", err)
	}
	return certPath, keyPath
}

// closedAddr 回傳一個無 listener 的位址（connection refused）。
func closedAddr(t *testing.T) string {
	t.Helper()
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	addr := l.Addr().String()
	l.Close()
	return addr
}

// ============================================================
//  SYS-34: 代理請求組裝正確（method/path/Bearer token）
// ============================================================

func TestAgentClient_RequestAssembly(t *testing.T) {
	var gotMethod, gotPath, gotAuth string
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotMethod = r.Method
		gotPath = r.URL.Path
		gotAuth = r.Header.Get("Authorization")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"ok":true}`))
	}))
	defer srv.Close()

	node := testNode(strings.TrimPrefix(srv.URL, "https://"), serverFingerprint(t, srv), "lsm_node_x")
	ac := NewAgentClient()

	code, body, err := ac.Do(context.Background(), node, http.MethodGet, "/api/v1/services", nil)
	if err != nil {
		t.Fatalf("do: %v", err)
	}
	if code != http.StatusOK {
		t.Errorf("expected 200, got %d", code)
	}
	if string(body) != `{"ok":true}` {
		t.Errorf("body mismatch: %q", string(body))
	}
	if gotMethod != http.MethodGet || gotPath != "/api/v1/services" {
		t.Errorf("mock agent received %s %s, want GET /api/v1/services", gotMethod, gotPath)
	}
	if gotAuth != "Bearer lsm_node_x" {
		t.Errorf("expected Authorization Bearer lsm_node_x, got %q", gotAuth)
	}
}

// ============================================================
//  SYS-35: 網路錯誤分類 → NodeOfflineError（handler 映射 502）
// ============================================================

func TestAgentClient_NodeOffline(t *testing.T) {
	node := testNode(closedAddr(t), "", "lsm_node_x")
	ac := NewAgentClient()

	_, _, err := ac.Do(context.Background(), node, http.MethodGet, "/api/v1/services", nil)
	var offErr *NodeOfflineError
	if !errors.As(err, &offErr) {
		t.Fatalf("expected NodeOfflineError, got %v", err)
	}
	if offErr.Node != "web-server-01" {
		t.Errorf("Node field mismatch: %q", offErr.Node)
	}
	if offErr.Err == nil {
		t.Error("expected wrapped underlying error")
	}
	if !errors.Is(offErr, offErr.Err) {
		t.Error("Unwrap should expose underlying error")
	}
	if offErr.Error() == "" {
		t.Error("expected non-empty error message")
	}
}

// ============================================================
//  SYS-36: 逾時分類 → NodeTimeoutError（handler 映射 504）
// ============================================================

func TestAgentClient_Timeout(t *testing.T) {
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(2 * time.Second) // 超過 context deadline
	}))
	defer srv.Close()

	node := testNode(strings.TrimPrefix(srv.URL, "https://"), serverFingerprint(t, srv), "lsm_node_x")
	ac := NewAgentClient()

	ctx, cancel := context.WithTimeout(context.Background(), 150*time.Millisecond)
	defer cancel()

	_, _, err := ac.Do(ctx, node, http.MethodGet, "/api/v1/services", nil)
	var tErr *NodeTimeoutError
	if !errors.As(err, &tErr) {
		t.Fatalf("expected NodeTimeoutError, got %v", err)
	}
	if tErr.Node != "web-server-01" {
		t.Errorf("Node field mismatch: %q", tErr.Node)
	}
	if tErr.Path != "/api/v1/services" {
		t.Errorf("Path field mismatch: %q", tErr.Path)
	}
	if tErr.Error() == "" {
		t.Error("expected non-empty error message")
	}
}

// ============================================================
//  SYS-37: 回應 4MB 上限（io.LimitReader 截斷，不掛起）
// ============================================================

func TestAgentClient_ResponseLimit(t *testing.T) {
	big := strings.Repeat("x", 4<<20+1024)
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(big))
	}))
	defer srv.Close()

	node := testNode(strings.TrimPrefix(srv.URL, "https://"), serverFingerprint(t, srv), "lsm_node_x")
	ac := NewAgentClient()

	code, body, err := ac.Do(context.Background(), node, http.MethodGet, "/api/v1/services", nil)
	if err != nil {
		t.Fatalf("do: %v", err)
	}
	if code != http.StatusOK {
		t.Errorf("expected 200, got %d", code)
	}
	if len(body) > 4<<20 {
		t.Errorf("body exceeds 4MB limit: %d bytes", len(body))
	}
}

// ============================================================
//  SYS-38: 指紋 pin 相符連線成功（不信任系統 CA、直接 pin）
// ============================================================

func TestAgentClient_FingerprintMatch(t *testing.T) {
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"ok":true}`))
	}))
	defer srv.Close()

	node := testNode(strings.TrimPrefix(srv.URL, "https://"), serverFingerprint(t, srv), "lsm_node_x")
	ac := NewAgentClient()

	code, _, err := ac.Do(context.Background(), node, http.MethodGet, "/api/v1/services", nil)
	if err != nil {
		t.Fatalf("fingerprint pin should allow self-signed connection: %v", err)
	}
	if code != http.StatusOK {
		t.Errorf("expected 200, got %d", code)
	}
}

// ============================================================
//  SYS-39: 指紋不符連線失敗（TLS 驗證錯誤）→ NodeOfflineError
// ============================================================

func TestAgentClient_FingerprintMismatch(t *testing.T) {
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	// 與實際憑證不符的指紋
	wrongFP := strings.Repeat("0", 64)
	node := testNode(strings.TrimPrefix(srv.URL, "https://"), wrongFP, "lsm_node_x")
	ac := NewAgentClient()

	_, _, err := ac.Do(context.Background(), node, http.MethodGet, "/api/v1/services", nil)
	var offErr *NodeOfflineError
	if !errors.As(err, &offErr) {
		t.Fatalf("expected NodeOfflineError for fingerprint mismatch, got %v", err)
	}
}

// ============================================================
//  SYS-40: mTLS 雙向驗證（mock Agent RequireAndVerifyClientCert 驗證 Manager 憑證）
// ============================================================

func TestAgentClient_MTLS(t *testing.T) {
	// Agent 端：RequireAndVerifyClientCert + ClientCAs
	clientCert, clientLeaf := newTestClientCert(t)
	pool := x509.NewCertPool()
	pool.AddCert(clientLeaf)

	srv := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"ok":true}`))
	}))
	srv.TLS = &tls.Config{ClientAuth: tls.RequireAndVerifyClientCert, ClientCAs: pool}
	srv.StartTLS()
	defer srv.Close()

	node := testNode(strings.TrimPrefix(srv.URL, "https://"), serverFingerprint(t, srv), "lsm_node_x")
	ac := NewAgentClient()

	// Manager 端送 client cert（mTLS 完整版；指紋 pin 保留在握手驗證中）。
	// 註：Node 資料模型未含 client cert 欄位，Phase 2 需決定 AgentClient 取得
	// Manager client cert 的方式（每節點欄位或 AgentClient 層級設定）；此測試經
	// 內部 transport 注入，驗證「AgentClient 必須支援 mTLS 連線」的合約。
	if tr, ok := ac.client.Transport.(*http.Transport); ok {
		tr.TLSClientConfig = &tls.Config{
			Certificates:          []tls.Certificate{clientCert},
			InsecureSkipVerify:    true,
			VerifyPeerCertificate: pinFingerprint(node.TLSFingerprint),
		}
	} else {
		t.Fatalf("unexpected transport type %T", ac.client.Transport)
	}

	code, body, err := ac.Do(context.Background(), node, http.MethodGet, "/api/v1/services", nil)
	if err != nil {
		t.Fatalf("mTLS handshake with client cert should succeed: %v", err)
	}
	if code != http.StatusOK || string(body) != `{"ok":true}` {
		t.Errorf("unexpected response: code=%d body=%q", code, string(body))
	}
}

// ============================================================
//  SYS-41: 自簽憑證不信任系統 CA（未 pin 指紋 → 連線失敗）
// ============================================================

func TestAgentClient_SelfSignedWithoutPin(t *testing.T) {
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	// 未設指紋 pin：預設 RootCAs 不信任自簽 CA → 連線失敗（pin 為必要路徑）
	node := testNode(strings.TrimPrefix(srv.URL, "https://"), "", "lsm_node_x")
	ac := NewAgentClient()

	_, _, err := ac.Do(context.Background(), node, http.MethodGet, "/api/v1/services", nil)
	var offErr *NodeOfflineError
	if !errors.As(err, &offErr) {
		t.Fatalf("expected NodeOfflineError (system CA must not trust self-signed cert), got %v", err)
	}
}

// ============================================================
//  SYS-42/43: Agent 5xx / 4xx 原樣轉寫（不吞錯誤）
// ============================================================

func TestAgentClient_ServerErrorPassthrough(t *testing.T) {
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte(`{"error":"permission denied"}`))
	}))
	defer srv.Close()

	node := testNode(strings.TrimPrefix(srv.URL, "https://"), serverFingerprint(t, srv), "lsm_node_x")
	ac := NewAgentClient()

	code, body, err := ac.Do(context.Background(), node, http.MethodPost, "/api/v1/services/nginx.service/start", nil)
	if err != nil {
		t.Fatalf("do: %v", err)
	}
	if code != http.StatusInternalServerError {
		t.Errorf("expected 500 passthrough, got %d", code)
	}
	if string(body) != `{"error":"permission denied"}` {
		t.Errorf("body not passed through verbatim: %q", string(body))
	}
}

func TestAgentClient_NotFoundPassthrough(t *testing.T) {
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
		w.Write([]byte(`{"error":"service not found"}`))
	}))
	defer srv.Close()

	node := testNode(strings.TrimPrefix(srv.URL, "https://"), serverFingerprint(t, srv), "lsm_node_x")
	ac := NewAgentClient()

	code, body, err := ac.Do(context.Background(), node, http.MethodGet, "/api/v1/services/missing.service/logs", nil)
	if err != nil {
		t.Fatalf("do: %v", err)
	}
	if code != http.StatusNotFound {
		t.Errorf("expected 404 passthrough, got %d", code)
	}
	if string(body) != `{"error":"service not found"}` {
		t.Errorf("body not passed through verbatim: %q", string(body))
	}
}

// ============================================================
//  缺口 #5：Manager 端 mTLS client cert（決策 5 方案 B — 真雙向 mTLS）
//  Node.ClientCert/ClientKey → tls.LoadX509KeyPair → 握手送出 client cert
// ============================================================

func TestAgentClient_MTLSNodeClientCert(t *testing.T) {
	// Agent 端：RequireAndVerifyClientCert + ClientCAs（mirror cmd/agent/main.go）
	clientCert, clientLeaf := newTestClientCert(t)
	certPath, keyPath := writeTestClientCertPEM(t, clientCert)
	pool := x509.NewCertPool()
	pool.AddCert(clientLeaf)

	srv := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"ok":true}`))
	}))
	srv.TLS = &tls.Config{ClientAuth: tls.RequireAndVerifyClientCert, ClientCAs: pool}
	srv.StartTLS()
	defer srv.Close()

	node := testNode(strings.TrimPrefix(srv.URL, "https://"), serverFingerprint(t, srv), "lsm_node_x")
	node.ClientCert = certPath
	node.ClientKey = keyPath
	ac := NewAgentClient()

	code, body, err := ac.Do(context.Background(), node, http.MethodGet, "/api/v1/services", nil)
	if err != nil {
		t.Fatalf("mTLS with node-level client cert should succeed: %v", err)
	}
	if code != http.StatusOK || string(body) != `{"ok":true}` {
		t.Errorf("unexpected response: code=%d body=%q", code, string(body))
	}
}

func TestAgentClient_MTLSNodeWithoutCertFails(t *testing.T) {
	// Agent 端信任某 cert，但 Node 未設定 client cert → 握手被拒
	_, clientLeaf := newTestClientCert(t)
	pool := x509.NewCertPool()
	pool.AddCert(clientLeaf)

	srv := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	srv.TLS = &tls.Config{ClientAuth: tls.RequireAndVerifyClientCert, ClientCAs: pool}
	srv.StartTLS()
	defer srv.Close()

	node := testNode(strings.TrimPrefix(srv.URL, "https://"), serverFingerprint(t, srv), "lsm_node_x")
	ac := NewAgentClient()

	_, _, err := ac.Do(context.Background(), node, http.MethodGet, "/api/v1/services", nil)
	var offErr *NodeOfflineError
	if !errors.As(err, &offErr) {
		t.Fatalf("expected NodeOfflineError for missing client cert, got %v", err)
	}
}

func TestAgentClient_MTLSNodeBadCertPath(t *testing.T) {
	// 載入失敗 → 產生不含 cert 的 config → 連線自然失敗（NodeOfflineError），不 crash
	_, clientLeaf := newTestClientCert(t)
	pool := x509.NewCertPool()
	pool.AddCert(clientLeaf)

	srv := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	srv.TLS = &tls.Config{ClientAuth: tls.RequireAndVerifyClientCert, ClientCAs: pool}
	srv.StartTLS()
	defer srv.Close()

	node := testNode(strings.TrimPrefix(srv.URL, "https://"), serverFingerprint(t, srv), "lsm_node_x")
	node.ClientCert = filepath.Join(t.TempDir(), "missing.crt")
	node.ClientKey = filepath.Join(t.TempDir(), "missing.key")
	ac := NewAgentClient()

	_, _, err := ac.Do(context.Background(), node, http.MethodGet, "/api/v1/services", nil)
	var offErr *NodeOfflineError
	if !errors.As(err, &offErr) {
		t.Fatalf("expected NodeOfflineError for bad cert path, got %v", err)
	}
}

// tlsConfigFor 從 Node.ClientCert/ClientKey 載入 client cert（決策 5 方案 B）。
func TestTLSConfigFor_ClientCert(t *testing.T) {
	clientCert, _ := newTestClientCert(t)
	certPath, keyPath := writeTestClientCertPEM(t, clientCert)
	fp := strings.Repeat("ab", 32)

	cfg := tlsConfigFor(&Node{Name: "web-server-01", TLSFingerprint: fp, ClientCert: certPath, ClientKey: keyPath})
	if cfg == nil {
		t.Fatal("expected non-nil tls.Config")
	}
	if len(cfg.Certificates) != 1 {
		t.Errorf("expected 1 client certificate loaded, got %d", len(cfg.Certificates))
	}
	if !cfg.InsecureSkipVerify || cfg.VerifyPeerCertificate == nil {
		t.Error("fingerprint pin must be preserved alongside client cert")
	}

	// 載入失敗 → 不含 cert 的 config（連線自然失敗為 NodeOfflineError）
	badCfg := tlsConfigFor(&Node{Name: "web-server-01", TLSFingerprint: fp, ClientCert: "/nonexistent/cert.pem", ClientKey: "/nonexistent/key.pem"})
	if badCfg == nil {
		t.Fatal("expected non-nil config even when cert load fails")
	}
	if len(badCfg.Certificates) != 0 {
		t.Errorf("failed cert load must not inject certificates, got %d", len(badCfg.Certificates))
	}
}

// ============================================================
//  補充：tlsConfigFor 產生指紋 pin 設定（決策 5）
// ============================================================

func TestTLSConfigFor_FingerprintPin(t *testing.T) {
	cfg := tlsConfigFor(&Node{Name: "web-server-01", TLSFingerprint: strings.Repeat("ab", 32)})
	if cfg == nil {
		t.Fatal("expected non-nil tls.Config")
	}
	if !cfg.InsecureSkipVerify {
		t.Error("fingerprint pin requires InsecureSkipVerify (do not trust system CA)")
	}
	if cfg.VerifyPeerCertificate == nil {
		t.Error("expected VerifyPeerCertificate pin hook")
	}

	// 相符指紋通過：以真實憑證驗證 pin 邏輯
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	defer srv.Close()
	cert := srv.Certificate()
	fp := serverFingerprint(t, srv)

	okCfg := tlsConfigFor(&Node{Name: "web-server-01", TLSFingerprint: fp})
	if err := okCfg.VerifyPeerCertificate([][]byte{cert.Raw}, nil); err != nil {
		t.Errorf("matching fingerprint rejected: %v", err)
	}
	wrongCfg := tlsConfigFor(&Node{Name: "web-server-01", TLSFingerprint: strings.Repeat("0", 64)})
	if err := wrongCfg.VerifyPeerCertificate([][]byte{cert.Raw}, nil); err == nil {
		t.Error("mismatched fingerprint accepted")
	}
}
