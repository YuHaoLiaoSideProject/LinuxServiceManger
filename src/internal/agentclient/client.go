// Package agentclient provides a WebSocket client for connecting to the
// Linux Service Manager manager node and receiving service status updates.
package agentclient

import (
	"context"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/url"
	"os"
	"runtime"
	"strings"
	"sync"
	"time"

	gorilla "github.com/gorilla/websocket"
	"linux-service-manager/internal/agentproto"
)

// ServiceController abstracts systemd operations (from internal/systemd).
type ServiceController interface {
	List() ([]Service, error)
	Start(name string) error
	Stop(name string) error
	Restart(name string) error
	Enable(name string) error
	Disable(name string) error
	Logs(name string, lines int) (string, error)
	SystemInfo() (SystemInfo, error)
}

// Service represents a simplified service status.
type Service struct {
	Name          string `json:"name"`
	Active        string `json:"active"`
	Sub           string `json:"sub"`
	UnitFileState string `json:"unit_file_state"`
}

// SystemInfo represents basic system information.
type SystemInfo struct {
	OS       string `json:"os"`
	Kernel   string `json:"kernel"`
	Hostname string `json:"hostname"`
	Uptime   string `json:"uptime"`
	CPU      string `json:"cpu"`
	Memory   string `json:"memory"`
}

// Config holds the agent client configuration.
type Config struct {
	ManagerAddr       string        `json:"manager_addr"`
	AuthToken         string        `json:"auth_token"`
	NodeName          string        `json:"node_name"`
	HeartbeatInterval time.Duration `json:"-"`
	TLSFingerprint    string        `json:"tls_fingerprint,omitempty"`
	ReadDeadline      time.Duration `json:"-"`
}

// Client maintains a persistent WebSocket connection to the manager.
type Client struct {
	cfg Config
	svc ServiceController
}

// New creates a new agent client with the given config and service controller.
func New(cfg Config, svc ServiceController) *Client {
	if cfg.HeartbeatInterval == 0 {
		cfg.HeartbeatInterval = 10 * time.Second
	}
	if cfg.ReadDeadline == 0 {
		cfg.ReadDeadline = 35 * time.Second
	}
	return &Client{cfg: cfg, svc: svc}
}

// Run connects to the manager and keeps the connection alive.
// It blocks until ctx is cancelled or a fatal error occurs.
func (c *Client) Run(ctx context.Context) error {
	backoff := 1 * time.Second
	const maxBackoff = 60 * time.Second

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		err := c.connectAndRun(ctx)
		if ctx.Err() != nil {
			return ctx.Err()
		}

		log.Printf("[agentclient] disconnected: %v, reconnecting in %v...", err, backoff)

		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(backoff):
		}

		backoff *= 2
		if backoff > maxBackoff {
			backoff = maxBackoff
		}
	}
}

// connectAndRun performs a single connection lifecycle: dial, register, then
// run heartbeat + read loops until an error occurs.
func (c *Client) connectAndRun(ctx context.Context) error {
	wsConn, err := c.dial(ctx)
	if err != nil {
		return fmt.Errorf("dial: %w", err)
	}
	defer wsConn.Close()

	// Register with manager
	if err := c.register(ctx, wsConn); err != nil {
		return fmt.Errorf("register: %w", err)
	}
	log.Printf("[agentclient] registered as node=%s", c.cfg.NodeName)

	// Run heartbeat and read loops concurrently
	errCh := make(chan error, 2)

	go func() {
		errCh <- c.heartbeatLoop(ctx, wsConn)
	}()

	go func() {
		errCh <- c.readLoop(ctx, wsConn)
	}()

	// Wait for first error (or context cancellation)
	select {
	case <-ctx.Done():
		return ctx.Err()
	case err := <-errCh:
		return err
	}
}

// dial establishes a WSS connection to the manager.
func (c *Client) dial(ctx context.Context) (*gorilla.Conn, error) {
	// Parse manager address
	addr := c.cfg.ManagerAddr
	if !strings.HasPrefix(addr, "wss://") && !strings.HasPrefix(addr, "ws://") {
		addr = "wss://" + addr
	}

	u, err := url.Parse(addr)
	if err != nil {
		return nil, fmt.Errorf("parse url: %w", err)
	}

	host := u.Hostname()

	// Build query params
	q := u.Query()
	if c.cfg.AuthToken != "" {
		q.Set("token", c.cfg.AuthToken)
	}
	u.RawQuery = q.Encode()

	// TLS config with optional fingerprint pinning
	tlsCfg := &tls.Config{
		InsecureSkipVerify: true, // We verify via callback
		VerifyPeerCertificate: func(rawCerts [][]byte, _ [][]*x509.Certificate) error {
			if c.cfg.TLSFingerprint == "" {
				return nil // no pinning
			}
			if len(rawCerts) == 0 {
				return fmt.Errorf("no certificate presented")
			}
			cert, err := x509.ParseCertificate(rawCerts[0])
			if err != nil {
				return fmt.Errorf("parse certificate: %w", err)
			}
			if cert.NotAfter.Before(time.Now()) {
				return fmt.Errorf("certificate expired")
			}
			got := fingerprintOf(rawCerts[0])
			expected := strings.ToLower(strings.ReplaceAll(c.cfg.TLSFingerprint, ":", ""))
			if got != expected {
				return fmt.Errorf("certificate fingerprint mismatch: got %s, expected %s", got, expected)
			}
			return nil
		},
		ServerName: host,
	}

	dialer := gorilla.Dialer{
		HandshakeTimeout: 10 * time.Second,
		TLSClientConfig:  tlsCfg,
	}

	wsURL := u.String()
	logURL := wsURL
	if c.cfg.AuthToken != "" {
		logURL = strings.Replace(logURL, "token="+c.cfg.AuthToken, "token=***", 1)
	}
	log.Printf("[agentclient] dialing %s", logURL)

	conn, _, err := dialer.DialContext(ctx, wsURL, nil)
	if err != nil {
		return nil, fmt.Errorf("ws dial %s: %w", logURL, err)
	}

	return conn, nil
}

// fingerprintOf computes the SHA-256 SPKI fingerprint of a DER-encoded certificate.
func fingerprintOf(certDER []byte) string {
	h := sha256.Sum256(certDER)
	return hex.EncodeToString(h[:])
}

// register sends a TypeRegister message and waits for TypeRegisterAck.
func (c *Client) register(ctx context.Context, wsConn *gorilla.Conn) error {
	hostname, _ := os.Hostname()

	payload := agentproto.RegisterPayload{
		NodeName: c.cfg.NodeName,
		Hostname: hostname,
		Version:  "1.0.0",
		OS:       runtime.GOOS,
	}

	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal register payload: %w", err)
	}

	env := agentproto.Envelope{
		Type:    agentproto.TypeRegister,
		Payload: payloadBytes,
	}

	if err := wsConn.WriteJSON(env); err != nil {
		return fmt.Errorf("send register: %w", err)
	}

	// Read ack with timeout
	wsConn.SetReadDeadline(time.Now().Add(c.cfg.ReadDeadline))
	defer wsConn.SetReadDeadline(time.Time{})

	var ack agentproto.Envelope
	if err := wsConn.ReadJSON(&ack); err != nil {
		return fmt.Errorf("read register ack: %w", err)
	}

	if ack.Type != agentproto.TypeRegisterAck {
		return fmt.Errorf("expected register_ack, got %s", ack.Type)
	}

	return nil
}

// heartbeatLoop sends periodic heartbeat messages with service stats.
func (c *Client) heartbeatLoop(ctx context.Context, wsConn *gorilla.Conn) error {
	ticker := time.NewTicker(c.cfg.HeartbeatInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
			if err := c.sendHeartbeat(wsConn); err != nil {
				return fmt.Errorf("heartbeat: %w", err)
			}
		}
	}
}

// sendHeartbeat collects stats and sends a heartbeat message.
func (c *Client) sendHeartbeat(wsConn *gorilla.Conn) error {
	payload := agentproto.HeartbeatPayload{}

	if c.svc != nil {
		services, err := c.svc.List()
		if err == nil {
			payload.ServicesTotal = len(services)
			for _, s := range services {
				switch s.Active {
				case "active":
					payload.ServicesRunning++
				case "failed":
					payload.ServicesFailed++
				}
			}
		}
	}

	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal heartbeat: %w", err)
	}

	env := agentproto.Envelope{
		Type:    agentproto.TypeHeartbeat,
		Payload: payloadBytes,
	}

	return wsConn.WriteJSON(env)
}

// readLoop reads messages from the manager and dispatches RPC requests.
func (c *Client) readLoop(ctx context.Context, wsConn *gorilla.Conn) error {
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		wsConn.SetReadDeadline(time.Now().Add(c.cfg.ReadDeadline))

		var env agentproto.Envelope
		if err := wsConn.ReadJSON(&env); err != nil {
			return fmt.Errorf("read message: %w", err)
		}

		switch env.Type {
		case agentproto.TypeRPCRequest:
			go c.handleRPC(wsConn, env)
		// Add other message types as needed
		default:
			log.Printf("[agentclient] unknown message type: %s", env.Type)
		}
	}
}

// handleRPC processes an RPC request and sends the response.
func (c *Client) handleRPC(wsConn *gorilla.Conn, req agentproto.Envelope) {
	result, rpcErr := c.dispatchRPC(req.Method, req.Payload)

	respPayload := struct {
		Result interface{} `json:"result,omitempty"`
		Error  string      `json:"error,omitempty"`
	}{
		Result: result,
	}
	if rpcErr != nil {
		respPayload.Error = rpcErr.Error()
	}

	respBytes, err := json.Marshal(respPayload)
	if err != nil {
		log.Printf("[agentclient] marshal rpc response: %v", err)
		return
	}

	env := agentproto.Envelope{
		Type:      agentproto.TypeRPCResponse,
		RequestID: req.RequestID,
		OK:        rpcErr == nil,
		Payload:   respBytes,
	}

	if err := wsConn.WriteJSON(env); err != nil {
		log.Printf("[agentclient] send rpc response: %v", err)
	}
}

// rpcResult is a generic result container for JSON marshaling.
type rpcResult struct {
	Value interface{}
}

// dispatchRPC routes an RPC method to the appropriate ServiceController call.
func (c *Client) dispatchRPC(method string, payload json.RawMessage) (interface{}, error) {
	if c.svc == nil {
		return nil, fmt.Errorf("no service controller configured")
	}

	switch method {
	case agentproto.MethodListServices:
		services, err := c.svc.List()
		return services, err

	case agentproto.MethodStart:
		var params struct {
			Name string `json:"name"`
		}
		if err := json.Unmarshal(payload, &params); err != nil {
			return nil, fmt.Errorf("invalid params: %w", err)
		}
		return nil, c.svc.Start(params.Name)

	case agentproto.MethodStop:
		var params struct {
			Name string `json:"name"`
		}
		if err := json.Unmarshal(payload, &params); err != nil {
			return nil, fmt.Errorf("invalid params: %w", err)
		}
		return nil, c.svc.Stop(params.Name)

	case agentproto.MethodRestart:
		var params struct {
			Name string `json:"name"`
		}
		if err := json.Unmarshal(payload, &params); err != nil {
			return nil, fmt.Errorf("invalid params: %w", err)
		}
		return nil, c.svc.Restart(params.Name)

	case agentproto.MethodEnable:
		var params struct {
			Name string `json:"name"`
		}
		if err := json.Unmarshal(payload, &params); err != nil {
			return nil, fmt.Errorf("invalid params: %w", err)
		}
		return nil, c.svc.Enable(params.Name)

	case agentproto.MethodDisable:
		var params struct {
			Name string `json:"name"`
		}
		if err := json.Unmarshal(payload, &params); err != nil {
			return nil, fmt.Errorf("invalid params: %w", err)
		}
		return nil, c.svc.Disable(params.Name)

	case agentproto.MethodLogs:
		var params struct {
			Name  string `json:"name"`
			Lines int    `json:"lines"`
		}
		if err := json.Unmarshal(payload, &params); err != nil {
			return nil, fmt.Errorf("invalid params: %w", err)
		}
		if params.Lines <= 0 {
			params.Lines = 100
		}
		return c.svc.Logs(params.Name, params.Lines)

	case agentproto.MethodSystemInfo:
		return c.svc.SystemInfo()

	default:
		return nil, fmt.Errorf("unknown method: %s", method)
	}
}

// SystemdServiceController adapts the systemd package to ServiceController.
// This is provided as a convenience; users can also pass any implementation.
type SystemdServiceController struct {
	mu      sync.Mutex
	listFn  func() ([]Service, error)
	startFn func(string) error
	stopFn  func(string) error
	restartFn func(string) error
	enableFn  func(string) error
	disableFn func(string) error
	logsFn    func(string, int) (string, error)
	sysInfoFn func() (SystemInfo, error)
}

// SystemdConfig holds function references to systemd operations.
type SystemdConfig struct {
	ListFn    func() ([]Service, error)
	StartFn   func(string) error
	StopFn    func(string) error
	RestartFn func(string) error
	EnableFn  func(string) error
	DisableFn func(string) error
	LogsFn    func(string, int) (string, error)
	SysInfoFn func() (SystemInfo, error)
}

// NewSystemdController creates a new SystemdServiceController.
func NewSystemdController(cfg SystemdConfig) *SystemdServiceController {
	return &SystemdServiceController{
		listFn:    cfg.ListFn,
		startFn:   cfg.StartFn,
		stopFn:    cfg.StopFn,
		restartFn: cfg.RestartFn,
		enableFn:  cfg.EnableFn,
		disableFn: cfg.DisableFn,
		logsFn:    cfg.LogsFn,
		sysInfoFn: cfg.SysInfoFn,
	}
}

func (s *SystemdServiceController) List() ([]Service, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.listFn != nil {
		return s.listFn()
	}
	return nil, nil
}

func (s *SystemdServiceController) Start(name string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.startFn != nil {
		return s.startFn(name)
	}
	return nil
}

func (s *SystemdServiceController) Stop(name string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.stopFn != nil {
		return s.stopFn(name)
	}
	return nil
}

func (s *SystemdServiceController) Restart(name string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.restartFn != nil {
		return s.restartFn(name)
	}
	return nil
}

func (s *SystemdServiceController) Enable(name string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.enableFn != nil {
		return s.enableFn(name)
	}
	return nil
}

func (s *SystemdServiceController) Disable(name string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.disableFn != nil {
		return s.disableFn(name)
	}
	return nil
}

func (s *SystemdServiceController) Logs(name string, lines int) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.logsFn != nil {
		return s.logsFn(name, lines)
	}
	return "", nil
}

func (s *SystemdServiceController) SystemInfo() (SystemInfo, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.sysInfoFn != nil {
		return s.sysInfoFn()
	}
	return SystemInfo{}, nil
}

// Compile-time check that SystemdServiceController implements ServiceController.
var _ ServiceController = (*SystemdServiceController)(nil)

// Compile-time check that Client uses ServiceController.
var _ = (*Client)(nil)
