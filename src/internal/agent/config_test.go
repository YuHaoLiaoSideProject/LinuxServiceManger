package agent

import (
	"os"
	"path/filepath"
	"testing"
)

// ============================================================
//  Helpers
// ============================================================

func writeAgentYAML(t *testing.T, content string) string {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "agent.yaml")
	if err := os.WriteFile(path, []byte(content), 0600); err != nil {
		t.Fatalf("write agent.yaml: %v", err)
	}
	return path
}

// ============================================================
//  SYS-44: agent.yaml 載入成功（yaml.v2 direct dependency）
// ============================================================

func TestLoadConfig_Success(t *testing.T) {
	path := writeAgentYAML(t, `
manager_addr: manager.example.com:8443
auth_token: lsm_node_abc123
node_name: web-server-01
heartbeat_interval: 10s
listen_addr: :8443
tls_cert: /etc/linux-service-manager/agent.crt
tls_key: /etc/linux-service-manager/agent.key
client_cert: /etc/linux-service-manager/manager.crt
`)

	cfg, err := LoadConfig(path)
	if err != nil {
		t.Fatalf("LoadConfig: %v", err)
	}
	if cfg.ManagerAddr != "manager.example.com:8443" {
		t.Errorf("manager_addr: got %q", cfg.ManagerAddr)
	}
	if cfg.AuthToken != "lsm_node_abc123" {
		t.Errorf("auth_token: got %q", cfg.AuthToken)
	}
	if cfg.NodeName != "web-server-01" {
		t.Errorf("node_name: got %q", cfg.NodeName)
	}
	if cfg.HeartbeatInterval != "10s" {
		t.Errorf("heartbeat_interval: got %q", cfg.HeartbeatInterval)
	}
	if cfg.ListenAddr != ":8443" {
		t.Errorf("listen_addr: got %q", cfg.ListenAddr)
	}
	if cfg.TLSCert != "/etc/linux-service-manager/agent.crt" {
		t.Errorf("tls_cert: got %q", cfg.TLSCert)
	}
	if cfg.TLSKey != "/etc/linux-service-manager/agent.key" {
		t.Errorf("tls_key: got %q", cfg.TLSKey)
	}
	if cfg.ClientCert != "/etc/linux-service-manager/manager.crt" {
		t.Errorf("client_cert: got %q", cfg.ClientCert)
	}
}

// ============================================================
//  SYS-45: agent.yaml 缺必填欄位報錯（啟動即失敗）
// ============================================================

func TestLoadConfig_MissingRequired(t *testing.T) {
	cases := []struct {
		name string
		yaml string
	}{
		{"missing manager_addr", "auth_token: lsm_node_x\nnode_name: web-server-01\n"},
		{"missing auth_token", "manager_addr: manager.example.com:8443\nnode_name: web-server-01\n"},
		{"missing node_name", "manager_addr: manager.example.com:8443\nauth_token: lsm_node_x\n"},
		{"all required missing", "listen_addr: :8443\n"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			path := writeAgentYAML(t, tc.yaml)
			_, err := LoadConfig(path)
			if err == nil {
				t.Error("expected explicit error for missing required field")
			}
		})
	}
}

func TestLoadConfig_FileNotFound(t *testing.T) {
	_, err := LoadConfig(filepath.Join(t.TempDir(), "does-not-exist.yaml"))
	if err == nil {
		t.Error("expected error for missing file")
	}
}

func TestLoadConfig_InvalidYAML(t *testing.T) {
	path := writeAgentYAML(t, "manager_addr: [unclosed")
	_, err := LoadConfig(path)
	if err == nil {
		t.Error("expected error for invalid yaml")
	}
}
