// Agent entry point — lightweight sidecar that reports local service
// status to the manager and accepts proxied commands.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"time"

	"linux-service-manager/internal/agentapi"
	"linux-service-manager/internal/agentclient"
)

var (
	flagConfig string
)

type agentConfig struct {
	ManagerAddr           string `json:"manager_addr"`
	AuthToken             string `json:"auth_token"`
	NodeName              string `json:"node_name"`
	HeartbeatInterval     int    `json:"heartbeat_interval"`
	ListenAddr            string `json:"listen_addr"`
	TLSCert               string `json:"tls_cert"`
	TLSKey                string `json:"tls_key"`
	TLSFingerprint        string `json:"tls_fingerprint,omitempty"`
	HeartbeatIntervalSecs int    `json:"heartbeat_interval_seconds,omitempty"`
}

func init() {
	flag.StringVar(&flagConfig, "config", "", "path to agent JSON config file (default: /etc/linux-service-manager/agent.json)")
}

func main() {
	flag.Parse()

	// Determine config path
	configPath := flagConfig
	if configPath == "" {
		configPath = "/etc/linux-service-manager/agent.json"
	}

	// Read and parse config
	data, err := os.ReadFile(configPath)
	if err != nil {
		log.Fatalf("failed to read config %s: %v", configPath, err)
	}

	var cfg agentConfig
	if err := json.Unmarshal(data, &cfg); err != nil {
		log.Fatalf("failed to parse config: %v", err)
	}

	// Apply defaults
	if cfg.ListenAddr == "" {
		cfg.ListenAddr = ":9090"
	}
	if cfg.HeartbeatInterval <= 0 {
		cfg.HeartbeatInterval = 30
	}
	if cfg.HeartbeatIntervalSecs > 0 {
		cfg.HeartbeatInterval = cfg.HeartbeatIntervalSecs
	}
	if cfg.NodeName == "" {
		hostname, _ := os.Hostname()
		cfg.NodeName = hostname
	}

	log.Printf("agent starting: node=%s manager=%s listen=%s", cfg.NodeName, cfg.ManagerAddr, cfg.ListenAddr)

	// Set up context with signal cancellation
	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()

	// Create service controller adapter for agent client
	clientSvc := newClientAdapter()

	// Start agent client (WebSocket connection to manager)
	clientCfg := agentclient.Config{
		ManagerAddr:       cfg.ManagerAddr,
		AuthToken:         cfg.AuthToken,
		NodeName:          cfg.NodeName,
		HeartbeatInterval: time.Duration(cfg.HeartbeatInterval) * time.Second,
		TLSFingerprint:    cfg.TLSFingerprint,
	}
	client := agentclient.New(clientCfg, clientSvc)
	go func() {
		if err := client.Run(ctx); err != nil && err != context.Canceled {
			log.Printf("agent client error: %v", err)
		}
	}()

	// Create service controller adapter for HTTP API
	apiSvc := newAPIAdapter()

	// Start HTTP API server
	router := agentapi.NewRouter(apiSvc, "1.0.0")
	server := &http.Server{
		Addr:    cfg.ListenAddr,
		Handler: router,
	}

	go func() {
		log.Printf("agent HTTP API listening on %s", cfg.ListenAddr)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("HTTP server error: %v", err)
		}
	}()

	// Wait for shutdown signal
	<-ctx.Done()
	log.Println("agent shutting down...")
	server.Close()
}

// --- Systemd operations ---

type systemdService struct {
	Name, Active, Sub, UnitFileState string
}

func systemctl(action, name string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, "systemctl", action, name)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("systemctl %s %s: %s: %w", action, name, strings.TrimSpace(string(out)), err)
	}
	return nil
}

func listSystemdServices() ([]systemdService, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, "systemctl", "list-units", "--type=service", "--all", "--no-pager", "--no-legend", "--plain")
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("systemctl: %w", err)
	}

	var services []systemdService
	lines := strings.Split(strings.TrimSpace(string(out)), "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 4 {
			continue
		}
		name := fields[0]
		if !strings.HasSuffix(name, ".service") {
			continue
		}
		s := systemdService{Name: name, Active: fields[2], Sub: fields[3]}
		// Get UnitFileState
		ctx2, cancel2 := context.WithTimeout(context.Background(), 5*time.Second)
		cmd2 := exec.CommandContext(ctx2, "systemctl", "show", "-p", "UnitFileState", "--value", name)
		if out2, err := cmd2.Output(); err == nil {
			s.UnitFileState = strings.TrimSpace(string(out2))
		}
		cancel2()
		services = append(services, s)
	}
	return services, nil
}

// --- Client adapter (agentclient.ServiceController) ---

type clientAdapter struct{}

func newClientAdapter() *clientAdapter { return &clientAdapter{} }

func (a *clientAdapter) List() ([]agentclient.Service, error) {
	services, err := listSystemdServices()
	if err != nil {
		return nil, err
	}
	result := make([]agentclient.Service, len(services))
	for i, s := range services {
		result[i] = agentclient.Service{
			Name:          s.Name,
			Active:        s.Active,
			Sub:           s.Sub,
			UnitFileState: s.UnitFileState,
		}
	}
	return result, nil
}

func (a *clientAdapter) Start(name string) error   { return systemctl("start", name) }
func (a *clientAdapter) Stop(name string) error     { return systemctl("stop", name) }
func (a *clientAdapter) Restart(name string) error  { return systemctl("restart", name) }
func (a *clientAdapter) Enable(name string) error   { return systemctl("enable", name) }
func (a *clientAdapter) Disable(name string) error  { return systemctl("disable", name) }

func (a *clientAdapter) Logs(name string, lines int) (string, error) {
	if lines <= 0 {
		lines = 100
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "journalctl", "-u", name, "-n", strconv.Itoa(lines), "--no-pager", "-o", "short-iso")
	out, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("journalctl: %s: %w", strings.TrimSpace(string(out)), err)
	}
	return string(out), nil
}

func (a *clientAdapter) SystemInfo() (agentclient.SystemInfo, error) {
	hostname, _ := os.Hostname()
	info := agentclient.SystemInfo{OS: runtime.GOOS, Kernel: runtime.GOARCH, Hostname: hostname}
	if out, err := exec.Command("uptime", "-p").Output(); err == nil {
		info.Uptime = strings.TrimSpace(string(out))
	}
	if out, err := exec.Command("nproc").Output(); err == nil {
		info.CPU = strings.TrimSpace(string(out)) + " cores"
	}
	if out, err := exec.Command("free", "-h").Output(); err == nil {
		lines := strings.Split(string(out), "\n")
		if len(lines) > 1 {
			fields := strings.Fields(lines[1])
			if len(fields) >= 2 {
				info.Memory = fields[1]
			}
		}
	}
	return info, nil
}

// --- API adapter (agentapi.ServiceController) ---

type apiAdapter struct{}

func newAPIAdapter() *apiAdapter { return &apiAdapter{} }

func (a *apiAdapter) List() ([]agentapi.ServiceInfo, error) {
	services, err := listSystemdServices()
	if err != nil {
		return nil, err
	}
	result := make([]agentapi.ServiceInfo, len(services))
	for i, s := range services {
		result[i] = agentapi.ServiceInfo{
			Name:          s.Name,
			Active:        s.Active,
			Sub:           s.Sub,
			UnitFileState: s.UnitFileState,
		}
	}
	return result, nil
}

func (a *apiAdapter) Start(name string) error   { return systemctl("start", name) }
func (a *apiAdapter) Stop(name string) error     { return systemctl("stop", name) }
func (a *apiAdapter) Restart(name string) error  { return systemctl("restart", name) }
func (a *apiAdapter) Enable(name string) error   { return systemctl("enable", name) }
func (a *apiAdapter) Disable(name string) error  { return systemctl("disable", name) }

func (a *apiAdapter) Logs(name string, lines int) (string, error) {
	if lines <= 0 {
		lines = 100
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "journalctl", "-u", name, "-n", strconv.Itoa(lines), "--no-pager", "-o", "short-iso")
	out, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("journalctl: %s: %w", strings.TrimSpace(string(out)), err)
	}
	return string(out), nil
}

func (a *apiAdapter) SystemInfo() (agentapi.SystemInfo, error) {
	hostname, _ := os.Hostname()
	info := agentapi.SystemInfo{OS: runtime.GOOS, Kernel: runtime.GOARCH, Hostname: hostname}
	if out, err := exec.Command("uptime", "-p").Output(); err == nil {
		info.Uptime = strings.TrimSpace(string(out))
	}
	if out, err := exec.Command("nproc").Output(); err == nil {
		info.CPU = strings.TrimSpace(string(out)) + " cores"
	}
	if out, err := exec.Command("free", "-h").Output(); err == nil {
		lines := strings.Split(string(out), "\n")
		if len(lines) > 1 {
			fields := strings.Fields(lines[1])
			if len(fields) >= 2 {
				info.Memory = fields[1]
			}
		}
	}
	return info, nil
}

// Compile-time interface checks
var _ agentclient.ServiceController = (*clientAdapter)(nil)
var _ agentapi.ServiceController = (*apiAdapter)(nil)
