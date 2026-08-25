package nodeproxy

import (
	"context"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"strings"
	"time"
)

// FingerprintOf computes the SHA-256 SPKI fingerprint of a DER-encoded
// certificate and returns it as a lowercase hex string.
func FingerprintOf(certDER []byte) string {
	h := sha256.Sum256(certDER)
	return hex.EncodeToString(h[:])
}

// DialTLS returns an *http.Client configured with TLS fingerprint pinning.
//
// When fingerprint is non-empty the TLS handshake verifies that the server's
// leaf certificate matches the expected SPKI SHA-256 fingerprint and is not
// expired. An empty fingerprint disables verification ("encrypt-only" mode,
// SYS-TLS-03).
func DialTLS(ctx context.Context, addr, fingerprint string) (*http.Client, error) {
	// Extract hostname for ServerName
	host := addr
	if h, _, err := net.SplitHostPort(addr); err == nil {
		host = h
	}

	tlsCfg := &tls.Config{
		InsecureSkipVerify: true, // We verify via callback, not system roots
		VerifyPeerCertificate: func(rawCerts [][]byte, _ [][]*x509.Certificate) error {
			if fingerprint == "" {
				return nil // no pinning
			}
			if len(rawCerts) == 0 {
				return fmt.Errorf("no certificate presented")
			}
			cert, err := x509.ParseCertificate(rawCerts[0])
			if err != nil {
				return fmt.Errorf("parse certificate: %w", err)
			}
			// Check expiry
			if cert.NotAfter.Before(time.Now()) {
				return fmt.Errorf("certificate expired")
			}
			// Check fingerprint
			got := FingerprintOf(rawCerts[0])
			expected := strings.ToLower(strings.ReplaceAll(fingerprint, ":", ""))
			if got != expected {
				return fmt.Errorf("certificate fingerprint mismatch: got %s, expected %s", got, expected)
			}
			return nil
		},
		ServerName: host,
	}

	transport := &http.Transport{
		TLSClientConfig: tlsCfg,
	}

	return &http.Client{
		Transport: transport,
		Timeout:   10 * time.Second,
	}, nil
}

// TestConnection performs a GET to https://{addr}/health and returns the result.
func TestConnection(ctx context.Context, addr, fingerprint, token string) (ok bool, version, hostname, osName, errMsg string) {
	client, err := DialTLS(ctx, addr, fingerprint)
	if err != nil {
		return false, "", "", "", err.Error()
	}
	url := fmt.Sprintf("https://%s/health", addr)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return false, "", "", "", err.Error()
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := client.Do(req)
	if err != nil {
		return false, "", "", "", err.Error()
	}
	defer resp.Body.Close()

	var health struct {
		Version  string `json:"version"`
		Hostname string `json:"hostname"`
		OS       string `json:"os"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&health); err != nil {
		return false, "", "", "", fmt.Errorf("decode response: %w", err).Error()
	}
	return true, health.Version, health.Hostname, health.OS, ""
}
