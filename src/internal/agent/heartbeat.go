package agent

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math/rand"
	"net/http"
	"os"
	"time"

	"linux-service-manager/internal/systemd"
)

// defaultHeartbeatInterval 是心跳預設間隔（決策 2）。
const defaultHeartbeatInterval = 10 * time.Second

// heartbeatJitter 是每 tick 的隨機 jitter 範圍（±2s，決策 2/10 — 避免 50 節點對齊拍擊）。
const heartbeatJitter = 2 * time.Second

// heartbeatTimeout 是單次心跳 HTTP 逾時。
const heartbeatTimeout = 5 * time.Second

// maxBackoff 是心跳失敗的 exponential backoff 上限。
const maxBackoff = 30 * time.Second

// HeartbeatClient 是 Agent → Manager 的心跳發送器（決策 2/3）。
type HeartbeatClient struct {
	cfg      *Config
	interval time.Duration // 解析 cfg.HeartbeatInterval（預設 10s）
	client   *http.Client  // Timeout 5s；Transport 連線池 keep-alive
	version  string
	hostname string
	os       string
	systemd  systemd.ServiceManager // 服務統計來源（可注入 mock；預設 DefaultManager）
}

// NewHeartbeatClient 建立心跳 client（簽名固定：測試以 NewHeartbeatClient(cfg, version) 呼叫）。
func NewHeartbeatClient(cfg *Config, version string) *HeartbeatClient {
	interval := defaultHeartbeatInterval
	if cfg != nil && cfg.HeartbeatInterval != "" {
		if d, err := time.ParseDuration(cfg.HeartbeatInterval); err == nil && d > 0 {
			interval = d
		}
	}

	hostname, _ := os.Hostname()
	if hostname == "" {
		hostname = "unknown"
	}

	return &HeartbeatClient{
		cfg:      cfg,
		interval: interval,
		client:   &http.Client{Timeout: heartbeatTimeout},
		version:  version,
		hostname: hostname,
		os:       osName(),
		systemd:  &systemd.DefaultManager{},
	}
}

// SetSystemd 注入 ServiceManager（測試/DI 用；服務統計由本機 systemd.ListServices() 掃描取得，規格 1.7.3）。
func (c *HeartbeatClient) SetSystemd(sm systemd.ServiceManager) {
	if sm != nil {
		c.systemd = sm
	}
}

// Run 以 ticker 執行心跳循環（每 tick 前 sleep ±2s 隨機 jitter，避免 50 節點對齊拍擊 Manager，決策 2/10）：
//
//  1. 組 Heartbeat payload {node_name, agent_version, hostname, os, uptime_seconds, services{total,active,failed}}
//     — 服務統計由本機 systemd.ListServices() 掃描取得
//  2. POST https://{manager_addr}/api/v1/agent/heartbeat（Bearer cfg.AuthToken）
//  3. 失敗（網路/5xx）→ 依 exponential backoff（1s → 2s → 4s → … 上限 30s）延遲下一個 tick；不 panic
//  4. 401（token 不符，如被第二個 Manager 環境誤配）→ 記錄錯誤並持續重試（決策 5；BDD @multi-manager）
func (c *HeartbeatClient) Run(ctx context.Context) {
	backoff := time.Second

	for {
		// jitter ±2s + interval 作為本 tick 延遲（避免節點對齊）
		delay := c.interval + jitterDuration()
		select {
		case <-ctx.Done():
			return
		case <-time.After(delay):
		}

		if err := c.heartbeatOnce(ctx); err != nil {
			select {
			case <-ctx.Done():
				return
			case <-time.After(backoff):
			}
			backoff *= 2
			if backoff > maxBackoff {
				backoff = maxBackoff
			}
			continue
		}
		backoff = time.Second
	}
}

// jitterDuration 產生 [-2s, +2s] 的均勻隨機 jitter。
func jitterDuration() time.Duration {
	n := int64(heartbeatJitter)*2 + 1
	return time.Duration(rand.Int63n(n)) - heartbeatJitter
}

// heartbeatOnce 發送單次心跳；成功回 nil。
func (c *HeartbeatClient) heartbeatOnce(ctx context.Context) error {
	stats := collectServiceStats(c.systemd)

	payload := map[string]any{
		"node_name":      c.cfg.NodeName,
		"agent_version":  c.version,
		"hostname":       c.hostname,
		"os":             c.os,
		"uptime_seconds": uptimeSeconds(),
		"services": map[string]int{
			"total":  stats.total,
			"active": stats.active,
			"failed": stats.failed,
		},
		"timestamp": time.Now().UTC().Format(time.RFC3339),
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal heartbeat: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		"https://"+c.cfg.ManagerAddr+"/api/v1/agent/heartbeat", bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("build heartbeat request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.cfg.AuthToken)

	resp, err := c.client.Do(req)
	if err != nil {
		return fmt.Errorf("heartbeat request failed: %w", err)
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, resp.Body)

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("heartbeat rejected: status %d", resp.StatusCode)
	}
	return nil
}

// serviceStats 是心跳附帶的服務統計聚合。
type serviceStats struct {
	total  int
	active int
	failed int
}

// collectServiceStats 由本機 systemd.ListServices() 掃描取得服務統計（規格 1.7.3）。
// systemd 不可用時回傳零值（心跳仍正常發送）。
func collectServiceStats(sm systemd.ServiceManager) serviceStats {
	var out serviceStats
	if sm == nil {
		return out
	}
	services, err := sm.ListServices()
	if err != nil {
		return out
	}
	for _, s := range services {
		out.total++
		switch s.Active {
		case "active":
			out.active++
		case "failed":
			out.failed++
		}
	}
	return out
}
