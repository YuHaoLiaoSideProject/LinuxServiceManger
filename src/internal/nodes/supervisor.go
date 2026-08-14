package nodes

import (
	"context"
	"strconv"
	"strings"
	"sync"
	"time"

	"linux-service-manager/internal/websocket"
)

// AgentMinVersion 是 Manager 支援的最低 Agent 版本（編譯期常數，決策 3）。
const AgentMinVersion = "1.2.0"

// supervisorTickInterval 是狀態機掃描間隔（決策 3）。
const supervisorTickInterval = 5 * time.Second

// startupGracePeriod 是 Manager 啟動寬限期：此期間內不推播 node_offline（決策 3/10）。
const startupGracePeriod = 30 * time.Second

// Supervisor 是心跳狀態機的掃描 goroutine 管理員。
type Supervisor struct {
	registry   *Registry
	hub        *websocket.Hub
	minVersion string // 最低相容版本（Config.AgentMinVersion；預設 AgentMinVersion 常數）
	bootTime   time.Time
	done       chan struct{}
	wg         sync.WaitGroup
	// OnNodeStateChange 為 P2 擴充點（013 notify 模組整合）；本階段保持 nil。
	OnNodeStateChange func(nodeID string, state Status)
}

// NewSupervisor 建立 Supervisor。
func NewSupervisor(reg *Registry, hub *websocket.Hub) *Supervisor {
	return &Supervisor{
		registry:   reg,
		hub:        hub,
		minVersion: AgentMinVersion,
		bootTime:   time.Now(),
		done:       make(chan struct{}),
	}
}

// Run 以 5s ticker 啟動掃描；ctx 取消或 Shutdown 時停止（併入 main 的 graceful shutdown）。
func (s *Supervisor) Run(ctx context.Context) {
	s.wg.Add(1)
	defer s.wg.Done()

	ticker := time.NewTicker(supervisorTickInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-s.done:
			return
		case <-ticker.C:
			s.tick()
		}
	}
}

// Shutdown 停止 supervisor（可重複呼叫）。
func (s *Supervisor) Shutdown() {
	select {
	case <-s.done:
	default:
		close(s.done)
	}
}

// tick 掃描所有節點：deriveStatus → 變更則 SetStatus + 推播。
// 離線推播受啟動寬限期保護：now < bootTime+30s 時狀態照算但不廣播 node_offline（決策 3/10）。
func (s *Supervisor) tick() {
	now := time.Now()
	for _, n := range s.registry.List() {
		next := s.statusFor(n, now)
		if next != n.Status {
			s.registry.SetStatus(n.ID, next)
			s.broadcast(n, next, now)
		}
	}
}

// statusFor 依節點目前狀態與心跳時間判定下一狀態（tick 用；minVersion 來自 Config）。
func (s *Supervisor) statusFor(n *Node, now time.Time) Status {
	if n.AgentVersion != "" && semverLess(n.AgentVersion, s.minVersion) {
		return StatusWarning
	}
	return deriveStatus(string(n.Status), n.LastHeartbeat, now, s.bootTime, n.AgentVersion)
}

// deriveStatus 是純函式狀態判定（決策 3 狀態機；核心單元測試點，SYS-20~26）：
//
//	if version != "" && semverLess(version, AgentMinVersion) { return warning }  // 🟡 版本警告優先（不阻斷心跳與操作）
//	if lastHB == "" { return offline }                                           // 從未收到心跳
//	age := now.Sub(parse(lastHB))
//	switch {
//	case age < 10*time.Second:  return online        // 🟢
//	case age < 30*time.Second:  return degraded      // 🟡 心跳稍有延遲但未逾時
//	case age < 300*time.Second: return offline       // 🔴 連續 3 次漏拍
//	default:                    return long_offline  // ⚫ 超過寬限期（Card 移至底部/摺疊）
//	}
//
// 額外語意（決策 3 狀態機遞進）：由可達狀態（online/degraded/warning）不得直接跳入
// long_offline — 需先經 offline 一步（prev 非可達狀態時才依時間直接判定 long_offline）。
func deriveStatus(prev, lastHB string, now, boot time.Time, version string) Status {
	if version != "" && semverLess(version, AgentMinVersion) {
		return StatusWarning
	}
	if lastHB == "" {
		return StatusOffline
	}
	age := now.Sub(parseTime(lastHB))
	switch {
	case age < 10*time.Second:
		return StatusOnline
	case age < 30*time.Second:
		return StatusDegraded
	case age < 300*time.Second:
		return StatusOffline
	default:
		if prev == string(StatusOnline) || prev == string(StatusDegraded) || prev == string(StatusWarning) {
			return StatusOffline
		}
		return StatusLongOffline
	}
}

// semverLess 以語意化版本字串比較（"1.0.0" < "1.2.0"；"1.10.0" > "1.2.0"）。
func semverLess(a, b string) bool {
	pa, okA := parseSemver(a)
	pb, okB := parseSemver(b)
	if !okA || !okB {
		return false // 無法解析 → 不判定為較舊
	}
	for i := 0; i < 3; i++ {
		if pa[i] != pb[i] {
			return pa[i] < pb[i]
		}
	}
	return false
}

// parseSemver 解析 "major.minor.patch"（可選 "v" 前綴）；回傳三元素數字版本。
func parseSemver(v string) ([3]int, bool) {
	v = strings.TrimPrefix(v, "v")
	parts := strings.SplitN(v, ".", 3)
	if len(parts) < 2 {
		return [3]int{}, false
	}
	var out [3]int
	for i := 0; i < 3; i++ {
		if i >= len(parts) {
			break
		}
		// 忽略 pre-release 後綴（如 "1.2.0-beta" → 1.2.0）
		num := parts[i]
		if idx := strings.IndexAny(num, "-+"); idx >= 0 {
			num = num[:idx]
		}
		n, err := strconv.Atoi(num)
		if err != nil {
			return [3]int{}, false
		}
		out[i] = n
	}
	return out, true
}

// parseTime 解析 RFC3339 時間字串（含小數秒）；解析失敗回零值。
func parseTime(s string) time.Time {
	t, err := time.Parse(time.RFC3339Nano, s)
	if err == nil {
		return t
	}
	t, err = time.Parse(time.RFC3339, s)
	if err == nil {
		return t
	}
	return time.Time{}
}

// broadcast 依狀態變更方向選擇訊息 type（決策 3 / SYS-32）：
//
//	轉入 offline/long_offline → node_offline（寬限期內抑制）
//	恢復回 online            → node_online（前端 Toast「已恢復連線」）
//	其餘狀態變更             → node_status（含 last_heartbeat/agent_version）
func (s *Supervisor) broadcast(n *Node, next Status, now time.Time) {
	if s.OnNodeStateChange != nil {
		s.OnNodeStateChange(n.ID, next)
	}
	if s.hub == nil {
		return
	}

	msg := websocket.Message{
		ID:            n.ID,
		Name:          n.Name,
		Active:        string(next),
		Timestamp:     now.UTC().Format(time.RFC3339),
		LastHeartbeat: n.LastHeartbeat,
		AgentVersion:  n.AgentVersion,
	}

	switch next {
	case StatusOffline, StatusLongOffline:
		// 啟動寬限期內不推播離線通知（狀態照算，決策 3/10）
		if now.Before(s.bootTime.Add(startupGracePeriod)) {
			return
		}
		msg.Type = "node_offline"
	case StatusOnline:
		msg.Type = "node_online"
	default: // degraded / warning
		msg.Type = "node_status"
	}

	s.hub.BroadcastMessage(msg)
}
