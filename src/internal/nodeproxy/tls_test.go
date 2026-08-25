package nodeproxy

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"math/big"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// ---------- helpers ----------

// generateSelfSignedCert returns a TLS certificate (with private key) and its DER bytes.
func generateSelfSignedCert(t *testing.T, notBefore, notAfter time.Time) (tls.Certificate, []byte) {
	t.Helper()

	priv, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}

	serial, err := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 128))
	if err != nil {
		t.Fatalf("generate serial: %v", err)
	}

	tmpl := &x509.Certificate{
		SerialNumber: serial,
		Subject:      pkix.Name{CommonName: "test"},
		NotBefore:    notBefore,
		NotAfter:     notAfter,
		KeyUsage:     x509.KeyUsageDigitalSignature,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
	}

	der, err := x509.CreateCertificate(rand.Reader, tmpl, tmpl, &priv.PublicKey, priv)
	if err != nil {
		t.Fatalf("create certificate: %v", err)
	}

	cert := tls.Certificate{
		Certificate: [][]byte{der},
		PrivateKey:  priv,
	}

	return cert, der
}

// newTLSTestServer starts an httptest TLS server with the given cert.
func newTLSTestServer(t *testing.T, cert tls.Certificate) *httptest.Server {
	t.Helper()

	mux := http.NewServeMux()
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{
			"version":  "1.0.0",
			"hostname": "test-host",
			"os":       "linux",
		})
	})

	ts := httptest.NewUnstartedServer(mux)
	ts.TLS = &tls.Config{Certificates: []tls.Certificate{cert}}
	ts.StartTLS()

	t.Cleanup(ts.Close)
	return ts
}

// ---------- Tests ----------

func TestFingerprintOf_Deterministic(t *testing.T) {
	_, certDER := generateSelfSignedCert(t, time.Now(), time.Now().Add(time.Hour))

	fp1 := FingerprintOf(certDER)
	fp2 := FingerprintOf(certDER)

	if fp1 != fp2 {
		t.Errorf("deterministic check failed: %s != %s", fp1, fp2)
	}
	if len(fp1) != 64 {
		t.Errorf("expected 64-char hex string, got %d chars: %s", len(fp1), fp1)
	}
}

func TestFingerprintOf_Different(t *testing.T) {
	_, der1 := generateSelfSignedCert(t, time.Now(), time.Now().Add(time.Hour))
	_, der2 := generateSelfSignedCert(t, time.Now(), time.Now().Add(time.Hour))

	fp1 := FingerprintOf(der1)
	fp2 := FingerprintOf(der2)

	if fp1 == fp2 {
		t.Errorf("different certs produced same fingerprint: %s", fp1)
	}
}

func TestDialTLS_FingerprintMatch(t *testing.T) {
	cert, certDER := generateSelfSignedCert(t, time.Now(), time.Now().Add(time.Hour))

	ts := newTLSTestServer(t, cert)

	expectedFp := FingerprintOf(certDER)
	addr := ts.Listener.Addr().String()

	ctx := context.Background()
	client, err := DialTLS(ctx, addr, expectedFp)
	if err != nil {
		t.Fatalf("DialTLS: %v", err)
	}

	resp, err := client.Get(ts.URL + "/health")
	if err != nil {
		t.Fatalf("GET /health: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Errorf("expected 200, got %d", resp.StatusCode)
	}
}

func TestDialTLS_FingerprintMismatch(t *testing.T) {
	cert, _ := generateSelfSignedCert(t, time.Now(), time.Now().Add(time.Hour))

	ts := newTLSTestServer(t, cert)

	// Use a deliberately wrong fingerprint (32 zero bytes).
	wrongFp := "0000000000000000000000000000000000000000000000000000000000000000"
	addr := ts.Listener.Addr().String()

	ctx := context.Background()
	client, err := DialTLS(ctx, addr, wrongFp)
	if err != nil {
		t.Fatalf("DialTLS: %v", err)
	}

	_, err = client.Get(ts.URL + "/health")
	if err == nil {
		t.Fatal("expected error for fingerprint mismatch, got nil")
	}
	if !contains(err.Error(), "mismatch") {
		t.Errorf("expected 'mismatch' in error, got: %s", err.Error())
	}
}

func TestDialTLS_EmptyFingerprint(t *testing.T) {
	cert, _ := generateSelfSignedCert(t, time.Now(), time.Now().Add(time.Hour))

	ts := newTLSTestServer(t, cert)
	addr := ts.Listener.Addr().String()

	ctx := context.Background()
	client, err := DialTLS(ctx, addr, "")
	if err != nil {
		t.Fatalf("DialTLS: %v", err)
	}

	resp, err := client.Get(ts.URL + "/health")
	if err != nil {
		t.Fatalf("GET /health: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Errorf("expected 200, got %d", resp.StatusCode)
	}
}

func TestDialTLS_ExpiredCert(t *testing.T) {
	// Cert expired 2 hours ago.
	past := time.Now().Add(-2 * time.Hour)
	expiredCert, certDER := generateSelfSignedCert(t, past.Add(-time.Hour), past)

	ln, err := tls.Listen("tcp", "127.0.0.1:0", &tls.Config{
		Certificates: []tls.Certificate{expiredCert},
	})
	if err != nil {
		t.Fatalf("tls listen: %v", err)
	}
	defer ln.Close()

	go func() {
		srv := &http.Server{
			Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(http.StatusOK)
			}),
		}
		srv.Serve(ln)
	}()

	addr := ln.Addr().String()
	expectedFp := FingerprintOf(certDER)

	ctx := context.Background()
	client, err := DialTLS(ctx, addr, expectedFp)
	if err != nil {
		t.Fatalf("DialTLS: %v", err)
	}

	resp, err := client.Get("https://" + addr + "/")
	if err == nil {
		resp.Body.Close()
		t.Fatal("expected error for expired cert, got nil")
	}
	if !contains(err.Error(), "expired") {
		t.Errorf("expected 'expired' in error, got: %s", err.Error())
	}
}

func TestTestConnection_Success(t *testing.T) {
	cert, certDER := generateSelfSignedCert(t, time.Now(), time.Now().Add(time.Hour))
	ts := newTLSTestServer(t, cert)

	expectedFp := FingerprintOf(certDER)
	addr := ts.Listener.Addr().String()

	ctx := context.Background()
	ok, version, hostname, osName, errMsg := TestConnection(ctx, addr, expectedFp, "")
	if !ok {
		t.Fatalf("TestConnection failed: %s", errMsg)
	}
	if version != "1.0.0" {
		t.Errorf("version = %q, want %q", version, "1.0.0")
	}
	if hostname != "test-host" {
		t.Errorf("hostname = %q, want %q", hostname, "test-host")
	}
	if osName != "linux" {
		t.Errorf("os = %q, want %q", osName, "linux")
	}
}

func TestTestConnection_BadFingerprint(t *testing.T) {
	cert, _ := generateSelfSignedCert(t, time.Now(), time.Now().Add(time.Hour))
	ts := newTLSTestServer(t, cert)

	wrongFp := "0000000000000000000000000000000000000000000000000000000000000000"
	addr := ts.Listener.Addr().String()

	ctx := context.Background()
	ok, _, _, _, errMsg := TestConnection(ctx, addr, wrongFp, "")
	if ok {
		t.Fatal("expected ok=false for bad fingerprint")
	}
	if !contains(errMsg, "mismatch") {
		t.Errorf("expected 'mismatch' in error, got: %s", errMsg)
	}
}

// ---------- utils ----------

func contains(s, sub string) bool {
	for i := 0; i <= len(s)-len(sub); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}
