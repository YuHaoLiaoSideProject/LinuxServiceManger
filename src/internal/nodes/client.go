package nodes

import (
	"bytes"
	"context"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
)

// maxResponseBytes 是 Agent 回應 body 上限（4MB，決策 6 — 防慢速/巨量回應掛起）。
const maxResponseBytes = 4 << 20

// AgentClient 是 Manager 代理至 Agent 的 HTTP client（決策 6 共用抽象）。
type AgentClient struct {
	client *http.Client // Transport 連線池 keep-alive；TLS 設定依節點於 request 前覆寫；Timeout 由呼叫方 context 決定
}

// NewAgentClient 建立 AgentClient（無節點層 TLS 設定；每個 request 依節點設定覆寫）。
func NewAgentClient() *AgentClient {
	return &AgentClient{
		client: &http.Client{
			// 明確指派 *http.Transport（測試會直接操作 ac.client.Transport 注入 mTLS 設定）
			Transport: http.DefaultTransport.(*http.Transport).Clone(),
		},
	}
}

// Do 執行代理請求：組 https://{n.Address}{path} → 注入 Bearer token → 依 n 的 TLS 設定
// （TLSFingerprint pin / 注入的 ClientCert）建立 Transport → RoundTrip。
//
// 錯誤分類：連線/網路錯誤 → NodeOfflineError（handler 映射 502）；ctx deadline → NodeTimeoutError（handler 映射 504）。
// 回應 body 以 io.LimitReader 4MB 上限讀取（防慢速/巨量回應掛起，決策 6）。
func (c *AgentClient) Do(ctx context.Context, n *Node, method, path string, body any) (int, []byte, error) {
	u := "https://" + n.Address + path

	var reqBody io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			return 0, nil, err
		}
		reqBody = bytes.NewReader(data)
	}

	req, err := http.NewRequestWithContext(ctx, method, u, reqBody)
	if err != nil {
		return 0, nil, err
	}
	req.Header.Set("Authorization", "Bearer "+n.Token)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}

	transport := c.transportFor(n)

	// 已逾期的 context（如 per-route 15s deadline 已過）→ 直接分類為 timeout
	if err := ctx.Err(); err != nil {
		return 0, nil, &NodeTimeoutError{Node: n.Name, Path: path}
	}

	resp, err := transport.RoundTrip(req)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) || errors.Is(ctx.Err(), context.DeadlineExceeded) {
			return 0, nil, &NodeTimeoutError{Node: n.Name, Path: path}
		}
		return 0, nil, &NodeOfflineError{Node: n.Name, Err: err}
	}
	defer resp.Body.Close()

	data, err := io.ReadAll(io.LimitReader(resp.Body, maxResponseBytes))
	if err != nil {
		return resp.StatusCode, data, &NodeOfflineError{Node: n.Name, Err: err}
	}
	return resp.StatusCode, data, nil
}

// transportFor 回傳本次 request 使用的 Transport（Clone 一份，不污染共用連線池設定）:
//   - base transport 已有 TLSClientConfig（http2 NextProtos 或測試注入的 mTLS client cert）→ Clone 後保留
//     並疊加節點指紋 pin（決策 5：不覆寫既有 Certificates/NextProtos）
//   - 否則直接依節點 TLSFingerprint 設定 pin（無指紋 → nil → 系統 CA）
func (c *AgentClient) transportFor(n *Node) *http.Transport {
	base, ok := c.client.Transport.(*http.Transport)
	if !ok {
		base = http.DefaultTransport.(*http.Transport).Clone()
	}
	cloned := base.Clone()

	cfg := tlsConfigFor(n)
	if base.TLSClientConfig != nil {
		// 保留 base 既有 TLS 設定（http2 NextProtos / 測試注入的 mTLS client cert），
		// 僅疊加指紋 pin 欄位（InsecureSkipVerify + VerifyPeerCertificate）
		merged := base.TLSClientConfig.Clone()
		if cfg != nil {
			merged.InsecureSkipVerify = cfg.InsecureSkipVerify
			merged.VerifyPeerCertificate = cfg.VerifyPeerCertificate
		}
		cloned.TLSClientConfig = merged
	} else {
		cloned.TLSClientConfig = cfg
	}
	return cloned
}

// NodeOfflineError 表示 Agent 不可達（connection refused / TLS 失敗 / DNS...）。
type NodeOfflineError struct {
	Node string // node name
	Err  error
}

func (e *NodeOfflineError) Error() string { return fmt.Sprintf("node %s offline: %v", e.Node, e.Err) }
func (e *NodeOfflineError) Unwrap() error { return e.Err }

// NodeTimeoutError 表示代理請求逾時（操作 15s / info 10s / health 5s）。
type NodeTimeoutError struct {
	Node string
	Path string
}

func (e *NodeTimeoutError) Error() string {
	return fmt.Sprintf("node %s request timeout: %s", e.Node, e.Path)
}

// tlsConfigFor 依節點設定組 tls.Config：
//   - TLSFingerprint 非空 → InsecureSkipVerify + VerifyPeerCertificate 比對 SHA-256 指紋
//     （不信任系統 CA、直接 pin，決策 5；自簽憑證情境）
//   - 無指紋 → nil（使用系統 CA；自簽憑證將驗證失敗 — pin 為必要路徑）
func tlsConfigFor(n *Node) *tls.Config {
	if n == nil || n.TLSFingerprint == "" {
		return nil
	}
	fp := strings.ToLower(n.TLSFingerprint)
	return &tls.Config{
		InsecureSkipVerify: true,
		VerifyPeerCertificate: func(rawCerts [][]byte, _ [][]*x509.Certificate) error {
			if len(rawCerts) == 0 {
				return errors.New("no peer certificate")
			}
			sum := sha256.Sum256(rawCerts[0])
			if hex.EncodeToString(sum[:]) != fp {
				return errors.New("certificate fingerprint mismatch")
			}
			return nil
		},
	}
}

// sha256Fingerprint 計算憑證 SHA-256 指紋（hex）。
func sha256Fingerprint(cert *x509.Certificate) string {
	sum := sha256.Sum256(cert.Raw)
	return hex.EncodeToString(sum[:])
}
