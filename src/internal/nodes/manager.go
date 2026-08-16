package nodes

import (
	"context"
	"encoding/json"
	"net/http"
	"sync"
	"time"

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

// startupHealthCheckConcurrency 是啟動健康檢查的並行上限（semaphore，決策 2）。
const startupHealthCheckConcurrency = 10

// startupHealthTimeout 是單節點 GET /health 的逾時（與 test-connection 同級，決策 5）。
const startupHealthTimeout = 5 * time.Second

// StartupHealthCheckResult 是啟動健康檢查的統計（供 main 啟動 log，可選）。
type StartupHealthCheckResult struct {
	Total   int // 本次檢查的節點總數
	Success int // GET /health 成功（200 + 可解析 body）並建立第一筆 last_heartbeat
	Failed  int // offline / timeout / 非 200 / body 無法解析 → 靜默跳過（節點維持現狀）
}

// healthResponse 是 Agent GET /health 的回應結構（決策 7；不驗證 token）。
type healthResponse struct {
	Version  string `json:"version"`
	Hostname string `json:"hostname"`
	OS       string `json:"os"`
}

// StartupHealthCheck 依 node registry 對每個節點**並行**發 GET /health（semaphore 上限 10），
// 嘗試建立第一筆 last_heartbeat（決策 2 / 開發規格 §5.2）：
//
//	成功 → Registry.SetHealthSnapshot：last_heartbeat=now + agent_version/hostname/os
//	      （取自 /health 回應）；不覆寫 service_stats（最後心跳附帶的統計保留）
//	失敗（offline/timeout/非 200/body 無法解析）→ 靜默跳過：節點維持現狀，supervisor 照常判定
//
// 非阻塞：main 以背景 goroutine 呼叫（不延遲 ListenAndServe）；ctx 取消（關機）時
// 不再發送新請求，已發送的等待完成。回傳統計供 log。
func (m *Manager) StartupHealthCheck(ctx context.Context) StartupHealthCheckResult {
	nodes := m.Registry.List()
	if len(nodes) == 0 {
		return StartupHealthCheckResult{}
	}

	var (
		wg     sync.WaitGroup
		mu     sync.Mutex
		result StartupHealthCheckResult
	)
	result.Total = len(nodes)
	sem := make(chan struct{}, startupHealthCheckConcurrency)

	for _, n := range nodes {
		wg.Add(1)
		go func(n *Node) {
			defer wg.Done()

			select {
			case sem <- struct{}{}:
				defer func() { <-sem }()
			case <-ctx.Done():
				// 關機中：不再發送新請求（不計入成功/失敗）
				return
			}

			hctx, cancel := context.WithTimeout(ctx, startupHealthTimeout)
			defer cancel()
			status, body, err := m.Client.Do(hctx, n, http.MethodGet, "/health", nil)
			if err != nil || status != http.StatusOK {
				mu.Lock()
				result.Failed++
				mu.Unlock()
				return
			}

			var h healthResponse
			if err := json.Unmarshal(body, &h); err != nil {
				mu.Lock()
				result.Failed++
				mu.Unlock()
				return
			}
			m.Registry.SetHealthSnapshot(n.ID, h.Version, h.Hostname, h.OS)

			mu.Lock()
			result.Success++
			mu.Unlock()
		}(n)
	}

	wg.Wait()
	return result
}
