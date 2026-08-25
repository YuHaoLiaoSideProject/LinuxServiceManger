package agentclient

import (
	"context"
	"encoding/json"
	"fmt"
	"testing"
	"time"

	"linux-service-manager/internal/agentproto"
)

func TestNewDefaults(t *testing.T) {
	cfg := Config{
		ManagerAddr: "manager.example.com:443",
		AuthToken:   "test-token",
		NodeName:    "node1",
	}

	c := New(cfg, nil)

	if c.cfg.HeartbeatInterval != 10*time.Second {
		t.Errorf("expected default HeartbeatInterval 10s, got %v", c.cfg.HeartbeatInterval)
	}
	if c.cfg.ReadDeadline != 35*time.Second {
		t.Errorf("expected default ReadDeadline 35s, got %v", c.cfg.ReadDeadline)
	}
}

func TestNewCustomConfig(t *testing.T) {
	cfg := Config{
		ManagerAddr:       "manager.example.com:443",
		AuthToken:         "test-token",
		NodeName:          "node1",
		HeartbeatInterval: 5 * time.Second,
		ReadDeadline:      60 * time.Second,
	}

	c := New(cfg, nil)

	if c.cfg.HeartbeatInterval != 5*time.Second {
		t.Errorf("expected HeartbeatInterval 5s, got %v", c.cfg.HeartbeatInterval)
	}
	if c.cfg.ReadDeadline != 60*time.Second {
		t.Errorf("expected ReadDeadline 60s, got %v", c.cfg.ReadDeadline)
	}
}

func TestDispatchRPC_ListServices(t *testing.T) {
	expected := []Service{
		{Name: "nginx.service", Active: "active", Sub: "running", UnitFileState: "enabled"},
		{Name: "redis.service", Active: "inactive", Sub: "dead", UnitFileState: "disabled"},
	}

	svc := NewSystemdController(SystemdConfig{
		ListFn: func() ([]Service, error) {
			return expected, nil
		},
	})

	c := New(Config{}, svc)

	result, err := c.dispatchRPC(agentproto.MethodListServices, nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	services, ok := result.([]Service)
	if !ok {
		t.Fatalf("expected []Service, got %T", result)
	}

	if len(services) != 2 {
		t.Fatalf("expected 2 services, got %d", len(services))
	}
	if services[0].Name != "nginx.service" {
		t.Errorf("expected nginx.service, got %s", services[0].Name)
	}
}

func TestDispatchRPC_Start(t *testing.T) {
	var calledName string
	svc := NewSystemdController(SystemdConfig{
		StartFn: func(name string) error {
			calledName = name
			return nil
		},
	})

	c := New(Config{}, svc)

	payload, _ := json.Marshal(map[string]string{"name": "nginx.service"})
	result, err := c.dispatchRPC(agentproto.MethodStart, payload)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result != nil {
		t.Errorf("expected nil result, got %v", result)
	}
	if calledName != "nginx.service" {
		t.Errorf("expected Start called with nginx.service, got %s", calledName)
	}
}

func TestDispatchRPC_Stop(t *testing.T) {
	var calledName string
	svc := NewSystemdController(SystemdConfig{
		StopFn: func(name string) error {
			calledName = name
			return nil
		},
	})

	c := New(Config{}, svc)

	payload, _ := json.Marshal(map[string]string{"name": "redis.service"})
	_, err := c.dispatchRPC(agentproto.MethodStop, payload)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if calledName != "redis.service" {
		t.Errorf("expected Stop called with redis.service, got %s", calledName)
	}
}

func TestDispatchRPC_Restart(t *testing.T) {
	var calledName string
	svc := NewSystemdController(SystemdConfig{
		RestartFn: func(name string) error {
			calledName = name
			return nil
		},
	})

	c := New(Config{}, svc)

	payload, _ := json.Marshal(map[string]string{"name": "nginx.service"})
	_, err := c.dispatchRPC(agentproto.MethodRestart, payload)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if calledName != "nginx.service" {
		t.Errorf("expected Restart called with nginx.service, got %s", calledName)
	}
}

func TestDispatchRPC_Enable(t *testing.T) {
	var calledName string
	svc := NewSystemdController(SystemdConfig{
		EnableFn: func(name string) error {
			calledName = name
			return nil
		},
	})

	c := New(Config{}, svc)

	payload, _ := json.Marshal(map[string]string{"name": "nginx.service"})
	_, err := c.dispatchRPC(agentproto.MethodEnable, payload)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if calledName != "nginx.service" {
		t.Errorf("expected Enable called with nginx.service, got %s", calledName)
	}
}

func TestDispatchRPC_Disable(t *testing.T) {
	var calledName string
	svc := NewSystemdController(SystemdConfig{
		DisableFn: func(name string) error {
			calledName = name
			return nil
		},
	})

	c := New(Config{}, svc)

	payload, _ := json.Marshal(map[string]string{"name": "redis.service"})
	_, err := c.dispatchRPC(agentproto.MethodDisable, payload)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if calledName != "redis.service" {
		t.Errorf("expected Disable called with redis.service, got %s", calledName)
	}
}

func TestDispatchRPC_Logs(t *testing.T) {
	var calledName string
	var calledLines int
	svc := NewSystemdController(SystemdConfig{
		LogsFn: func(name string, lines int) (string, error) {
			calledName = name
			calledLines = lines
			return "log output", nil
		},
	})

	c := New(Config{}, svc)

	payload, _ := json.Marshal(map[string]interface{}{"name": "nginx.service", "lines": 50})
	result, err := c.dispatchRPC(agentproto.MethodLogs, payload)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result != "log output" {
		t.Errorf("expected 'log output', got %v", result)
	}
	if calledName != "nginx.service" {
		t.Errorf("expected Logs called with nginx.service, got %s", calledName)
	}
	if calledLines != 50 {
		t.Errorf("expected Logs lines=50, got %d", calledLines)
	}
}

func TestDispatchRPC_LogsDefaultLines(t *testing.T) {
	var calledLines int
	svc := NewSystemdController(SystemdConfig{
		LogsFn: func(name string, lines int) (string, error) {
			calledLines = lines
			return "", nil
		},
	})

	c := New(Config{}, svc)

	payload, _ := json.Marshal(map[string]interface{}{"name": "nginx.service"})
	_, err := c.dispatchRPC(agentproto.MethodLogs, payload)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if calledLines != 100 {
		t.Errorf("expected default lines=100, got %d", calledLines)
	}
}

func TestDispatchRPC_SystemInfo(t *testing.T) {
	expected := SystemInfo{
		OS:       "linux",
		Kernel:   "5.15.0",
		Hostname: "testhost",
		Uptime:   "10d",
		CPU:      "4",
		Memory:   "8GB",
	}

	svc := NewSystemdController(SystemdConfig{
		SysInfoFn: func() (SystemInfo, error) {
			return expected, nil
		},
	})

	c := New(Config{}, svc)

	result, err := c.dispatchRPC(agentproto.MethodSystemInfo, nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	info, ok := result.(SystemInfo)
	if !ok {
		t.Fatalf("expected SystemInfo, got %T", result)
	}
	if info.OS != "linux" {
		t.Errorf("expected OS=linux, got %s", info.OS)
	}
	if info.Hostname != "testhost" {
		t.Errorf("expected Hostname=testhost, got %s", info.Hostname)
	}
}

func TestDispatchRPC_UnknownMethod(t *testing.T) {
	svc := NewSystemdController(SystemdConfig{})
	c := New(Config{}, svc)

	_, err := c.dispatchRPC("unknown.method", nil)
	if err == nil {
		t.Fatal("expected error for unknown method")
	}
}

func TestDispatchRPC_ControllerError(t *testing.T) {
	svc := NewSystemdController(SystemdConfig{
		StartFn: func(name string) error {
			return fmt.Errorf("service not found")
		},
	})

	c := New(Config{}, svc)

	payload, _ := json.Marshal(map[string]string{"name": "nonexistent.service"})
	_, err := c.dispatchRPC(agentproto.MethodStart, payload)
	if err == nil {
		t.Fatal("expected error from controller")
	}
	if err.Error() != "service not found" {
		t.Errorf("expected 'service not found', got %v", err)
	}
}

func TestDispatchRPC_NoController(t *testing.T) {
	c := New(Config{}, nil)

	_, err := c.dispatchRPC(agentproto.MethodListServices, nil)
	if err == nil {
		t.Fatal("expected error when no controller configured")
	}
}

func TestDispatchRPC_InvalidPayload(t *testing.T) {
	svc := NewSystemdController(SystemdConfig{
		StartFn: func(name string) error { return nil },
	})

	c := New(Config{}, svc)

	_, err := c.dispatchRPC(agentproto.MethodStart, []byte("invalid json"))
	if err == nil {
		t.Fatal("expected error for invalid payload")
	}
}

func TestExponentialBackoff(t *testing.T) {
	// Simulate the backoff calculation logic
	backoff := 1 * time.Second
	const maxBackoff = 60 * time.Second

	expected := []time.Duration{
		1 * time.Second,
		2 * time.Second,
		4 * time.Second,
		8 * time.Second,
		16 * time.Second,
		32 * time.Second,
		60 * time.Second, // capped
		60 * time.Second, // capped
	}

	for i, want := range expected {
		if backoff != want {
			t.Errorf("iteration %d: expected backoff %v, got %v", i, want, backoff)
		}
		backoff *= 2
		if backoff > maxBackoff {
			backoff = maxBackoff
		}
	}
}

func TestRun_ContextCancellation(t *testing.T) {
	// Test that Run returns promptly when context is cancelled
	c := New(Config{
		ManagerAddr: "nonexistent:9999",
		AuthToken:   "test",
		NodeName:    "test",
	}, nil)

	ctx, cancel := context.WithCancel(context.Background())
	cancel() // Cancel immediately

	err := c.Run(ctx)
	if err != context.Canceled {
		t.Errorf("expected context.Canceled, got %v", err)
	}
}
