// Package agent implements the lightweight Agent binary (no embedded frontend):
// a JSON API server for systemd operations plus a heartbeat client to the Manager.
package agent

import (
	"fmt"
	"os"

	"gopkg.in/yaml.v2"
)

// Config 對應 /etc/linux-service-manager/agent.yaml（決策 7 設定檔）。
type Config struct {
	ManagerAddr       string `yaml:"manager_addr"`       // manager.example.com:8443（心跳目標；必填）
	AuthToken         string `yaml:"auth_token"`         // lsm_node_…（與 Manager registry 同步；必填）
	NodeName          string `yaml:"node_name"`          // 唯一識別名（與 Manager 比對；必填）
	HeartbeatInterval string `yaml:"heartbeat_interval"` // 預設 "10s"
	ListenAddr        string `yaml:"listen_addr"`        // ":8443"（Agent 自身 HTTPS server）
	TLSCert           string `yaml:"tls_cert"`           // /etc/linux-service-manager/agent.crt
	TLSKey            string `yaml:"tls_key"`            // /etc/linux-service-manager/agent.key
	ClientCert        string `yaml:"client_cert"`        // 選填：mTLS 時 Manager 驗證用
}

// LoadConfig 讀取 yaml 檔並驗證必填欄位（manager_addr / auth_token / node_name 缺一 → 明確錯誤，啟動即失敗）。
func LoadConfig(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("failed to read agent config %s: %w", path, err)
	}

	var cfg Config
	if err := yaml.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("failed to parse agent config %s: %w", path, err)
	}

	if cfg.ManagerAddr == "" {
		return nil, fmt.Errorf("agent config: missing required field manager_addr")
	}
	if cfg.AuthToken == "" {
		return nil, fmt.Errorf("agent config: missing required field auth_token")
	}
	if cfg.NodeName == "" {
		return nil, fmt.Errorf("agent config: missing required field node_name")
	}
	return &cfg, nil
}
