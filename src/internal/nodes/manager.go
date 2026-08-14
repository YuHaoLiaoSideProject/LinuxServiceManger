package nodes

import (
	"linux-service-manager/internal/websocket"
)

// Config 是 nodes 模組初始化參數（main.go 組裝，見開發規格 1.11）。
type Config struct {
	RegistryPath    string         // /var/lib/linux-service-manager/nodes.json
	Hub             *websocket.Hub // supervisor 推播用（決策 3）
	AgentMinVersion string         // 最低相容 Agent 版本（如 "1.2.0"）
}

// Manager 是 nodes 模組對外門面：registry / supervisor / AgentClient 組合。
type Manager struct {
	Registry   *Registry
	Supervisor *Supervisor
	Client     *AgentClient
}

// New 建立 Manager（Load registry → 建立 supervisor/agent client）。
func New(cfg Config) (*Manager, error) {
	reg := NewRegistry(cfg.RegistryPath)
	if err := reg.Load(); err != nil {
		return nil, err
	}

	sup := NewSupervisor(reg, cfg.Hub)
	if cfg.AgentMinVersion != "" {
		sup.minVersion = cfg.AgentMinVersion
	}

	return &Manager{
		Registry:   reg,
		Supervisor: sup,
		Client:     NewAgentClient(),
	}, nil
}
