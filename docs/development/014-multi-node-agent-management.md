# 多機管理 Agent 模式 — 開發規格

> **對應 Roadmap**：Phase 4 — `docs/development/002-expansion-roadmap.md` 項目 #12
> **技術棧**：Go 1.24.4 · Vue 3.5 · Vite 8 · Pinia 4 · vue-router 4.6 · gorilla/websocket v1.5.3 · chi v5
> **Tech Decision**：`docs/tech-decisions/014-multi-node-agent-management.md`
> **操作流程**：`docs/interaction-flows/014-multi-node-agent-management.md`
> **BDD**：`docs/bdds/014-multi-node-agent-management.feature`（48 Scenario + 3 Outline，展開後 51 案例 S01–S51）
> **測試計畫**：`docs/test-plans/014-multi-node-agent-management測試計畫.md`
> **UI/UX 設計**：
>   - `docs/uiux/014-multi-node-view-redesign.md` — 節點切換模式（總覽頁 + 單機視圖）✅ 已定案
>   - `docs/uiux/014-node-management-design.md` — Node Management 頁面（列表 + CRUD Modal）
> **狀態**：設計完成，待開發
>
> **📋 修訂（2025-08-25）**：UIUX 決策採「純節點切換」模式（`docs/uiux/014-multi-node-view-redesign.md`），**跨節點服務搜尋已移出本功能範圍**，移入未來 backlog。本文中所有搜尋相關內容（`search.go`、§1.6.3、`HandleSearch`、`NodeSearchResults.vue`、node store 的 `search/clearSearch`、API 合約 search 列、資料流③、邊界條件搜尋列、開發順序相關步驟）皆標記 ⛔ REMOVED，不納入實作範圍；BDD 對應 Scenario 已降為 `@deferred`。

---

## 概述

讓一台主控面板（Manager）透過 WebSocket 長連線管理多台 Linux 機器上的輕量 Agent，實現 Aggregate Dashboard、單節點切換操作、跨節點搜尋與心跳離線偵測。核心包含：

1. **noderegistry**：節點註冊表 CRUD、唯一性/50 台上限檢查、`nodes.json` atomic write 持久化（runtime state 不落盤）
2. **nodemonitor**：心跳狀態機（online → offline → long_offline）、30s/300s 閾值、啟動寬限期、可注入 fake clock
3. **nodeproxy**：WS RPC 轉發（request-id ↔ pending map）、逾時策略（操作 15s／查詢 10s）、singleflight 並行限制、跨節點搜尋 errgroup 彙總
4. **agentclient + cmd/agent**：Agent 側 WS outbound 撥號、指數退避重連、register/heartbeat 循環、精簡 JSON API
5. **handler/nodes routes**：`/api/v1/nodes/*` REST 端點 + `/api/v1/agent/ws` Agent 升級端點
6. **前端 node store 與元件**：`stores/node.ts`、NodeCard、NodeSwitcher、NodeFormModal、NodeManagementView；DashboardView 以 `?node={id}` query 分流 Aggregate / 單節點兩種視圖

---

## 1. 後端實作規格

### 1.1 依賴新增

```bash
# 無新依賴：gorilla/websocket、chi、godbus/dbus 均已在 go.mod
# Agent 設定檔解析使用標準庫 encoding/json（agent.json）或 gopkg.in/yaml.v3（擇一，建議 json 免新依賴）
```

### 1.2 檔案改動總覽

```
src/
├── main.go                              ← 刪除：遷移至 cmd/manager/main.go
├── cmd/
│   ├── manager/
│   │   └── main.go                      ← 新增：Manager 入口（原 main.go 遷移 + nodes routes 掛載 + 啟動時重連所有節點）
│   └── agent/
│       └── main.go                      ← 新增：Agent 入口（讀設定檔、起 agentclient + agentapi）
├── internal/
│   ├── noderegistry/
│   │   ├── registry.go                  ← 新增：節點 CRUD + nodes.json atomic write
│   │   └── registry_test.go             ← 新增：唯一性/上限/持久化測試（SYS-REG-*）
│   ├── nodemonitor/
│   │   ├── monitor.go                   ← 新增：心跳狀態機 + 掃描 goroutine + 寬限期
│   │   └── monitor_test.go              ← 新增：fake clock 狀態機測試（SYS-MON-*）
│   ├── nodeproxy/
│   │   ├── hub.go                       ← 新增：Agent WS 連線 hub（/api/v1/agent/ws 接入端）
│   │   ├── rpc.go                       ← 新增：WS RPC pending map / 逾時 / singleflight
│   │   ├── search.go                    ← 新增：跨節點搜尋 errgroup 彙總
│   │   ├── tls.go                       ← 新增：TLS 指紋 pinning（VerifyPeerCertificate）
│   │   └── rpc_test.go                  ← 新增：SYS-PF-* / SYS-SRCH-* 測試
│   ├── agentproto/
│   │   └── proto.go                     ← 新增：Manager↔Agent 共用 wire protocol 型別
│   ├── agentclient/
│   │   ├── client.go                    ← 新增：Agent 側撥號/退避重連/register/heartbeat/rpc dispatch
│   │   └── client_test.go               ← 新增：SYS-AC-* 測試
│   ├── agentapi/
│   │   └── api.go                       ← 新增：Agent 本機精簡 JSON API（/health + /api/v1/services*）
│   └── handler/
│       ├── nodes_handler.go             ← 新增：/api/v1/nodes/* 全部 endpoint
│       └── nodes_handler_test.go        ← 新增：HDL-NODE-* / HDL-NP-* 測試
├── internal/systemd/                    ← 重用：Agent 直接 import
├── internal/audit/                      ← 修改：AuditEntry 增加 node_id / node_name 欄位
└── internal/websocket/hub.go            ← 修改：廣播 node.* 事件給前端

deploy/
├── linux-service-agent.service          ← 新增：Agent systemd unit
└── agent.example.json                   ← 新增：Agent 設定檔範例

Makefile                                 ← 修改：build-manager / build-agent（linux/amd64 + arm64）targets
```

### 1.3 internal/agentproto — Wire Protocol

Manager 與 Agent 共用的 WS 訊息封包（對應 Tech Decision 決策 1）：

```go
// Package agentproto 定義 Manager ↔ Agent WebSocket 長連線上的訊息合約。
package agentproto

// MessageType 為 WS 訊息類型。
type MessageType string

const (
	TypeRegister      MessageType = "register"       // Agent → Manager
	TypeRegisterAck   MessageType = "register_ack"   // Manager → Agent
	TypeHeartbeat     MessageType = "heartbeat"      // Agent → Manager
	TypeRPCRequest    MessageType = "rpc_request"    // Manager → Agent
	TypeRPCResponse   MessageType = "rpc_response"   // Agent → Manager
)

// Envelope 為所有訊息的統一外框。
type Envelope struct {
	Type      MessageType `json:"type"`
	RequestID string      `json:"request_id,omitempty"` // RPC 配對用；register/heartbeat 亦帶以利追蹤
	Method    string      `json:"method,omitempty"`     // 僅 rpc_request："services.list"、"services.start"…
	OK        bool        `json:"ok,omitempty"`         // register_ack / rpc_response
	Payload   json.RawMessage `json:"payload,omitempty"`
}

// RegisterPayload — Agent 註冊資訊。
type RegisterPayload struct {
	NodeName string `json:"node_name"`
	Hostname string `json:"hostname"`
	Version  string `json:"version"` // semver，Manager 比對 min_version
	OS       string `json:"os"`      // e.g. "Ubuntu 22.04"
}

// RegisterAckPayload — 註冊回應。
type RegisterAckPayload struct {
	MinVersion string `json:"min_version"` // e.g. "1.2"
	Compatible bool   `json:"compatible"`  // false → Manager 顯示 🟡 警告
}

// HeartbeatPayload — 心跳附帶服務統計摘要（Aggregate Dashboard 資料來源，規則 B8）。
type HeartbeatPayload struct {
	ServicesTotal   int `json:"services_total"`
	ServicesRunning int `json:"services_running"`
	ServicesFailed  int `json:"services_failed"`
	CPUPercent      float64 `json:"cpu_percent,omitempty"`     // P2：銜接 #13
	MemoryPercent   float64 `json:"memory_percent,omitempty"`  // P2
}

// RPC 方法常數（params/response 對應既有 /api/v1/services* 合約）。
const (
	MethodListServices = "services.list"
	MethodStart        = "services.start"
	MethodStop         = "services.stop"
	MethodRestart      = "services.restart"
	MethodEnable       = "services.enable"
	MethodDisable      = "services.disable"
	MethodLogs         = "services.logs"
	MethodSystemInfo   = "system.info"
)
```

### 1.4 internal/noderegistry — 節點註冊表

職責：節點設定的 CRUD、名稱唯一性、50 台上限、`nodes.json` 持久化（atomic write via temp+rename，權限 0600）。並發模型：單一 `sync.RWMutex` 保護 map；寫入 debounce 不需要（CRUD 頻率低），但 **runtime state 一律不落盤**（規則 B8/SYS-REG-10）。

```go
// Package noderegistry 管理 Agent 節點的設定與持久化。
package noderegistry

import (
	"errors"
	"sync"
	"time"
)

// 錯誤語意對應 HTTP 狀態碼（見第 3 節 API 合約）。
var (
	ErrDuplicateName = errors.New("node name already exists") // → 409
	ErrMaxNodes      = errors.New("maximum of 50 nodes")      // → 400（規則 B1）
	ErrNotFound      = errors.New("node not found")           // → 404
	ErrInvalidJSON   = errors.New("corrupted nodes.json")     // LoadRegistry 回傳，Manager 報錯退出
)

// MaxNodes 為單一 Manager 實例支援的最大節點數（規則 B1）。
const MaxNodes = 50

// Node 為節點完整狀態 = 持久化設定 + runtime 即時狀態。
type Node struct {
	// ── 持久化欄位（落盤至 nodes.json）──
	ID             string `json:"id"`                        // uuid 或自增字串
	Name           string `json:"name"`                      // 唯一
	Address        string `json:"address"`                   // host:port，test-connection 直連 GET /health 用
	TLSFingerprint string `json:"tls_fingerprint,omitempty"` // SHA-256 hex；空 = 僅加密不驗證（決策 3）
	Token          string `json:"token"`                     // Agent 端驗證 Manager 身分用（檔案 0600）
	Note           string `json:"note,omitempty"`

	// ── runtime state（不落盤，重啟後由 Agent 重連刷新）──
	Status          string        `json:"-"` // "online"|"warning"|"offline"|"long_offline"，初始 ""
	Hostname        string        `json:"-"`
	AgentVersion    string        `json:"-"`
	VersionCompat   bool          `json:"-"` // false → 🟡
	VersionMessage  string        `json:"-"`
	LastHeartbeat   time.Time     `json:"-"`
	LastOnlineAt    time.Time     `json:"-"`
	OfflineSince    time.Time     `json:"-"`
	OnlineSince     time.Time     `json:"-"`
	HeartbeatStats  HeartbeatStats `json:"-"` // 最後一次心跳附帶的服務統計
}

// HeartbeatStats 為心跳附帶的服務統計摘要。
type HeartbeatStats struct {
	Total   int     `json:"total"`
	Running int     `json:"running"`
	Failed  int     `json:"failed"`
	CPU     float64 `json:"cpu,omitempty"`
	Memory  float64 `json:"mem,omitempty"`
}

// AddRequest / UpdateRequest 為 handler 層傳入的受控欄位子集。
type AddRequest struct {
	Name, Address, TLSFingerprint, Token, Note string
}
type UpdateRequest struct {
	Name, Address, TLSFingerprint, Token, Note *string // nil = 不變更
}

// Registry 為並發安全的節點註冊表。
type Registry struct {
	mu    sync.RWMutex
	path  string        // /var/lib/linux-service-manager/nodes.json
	nodes map[string]*Node
	now   func() time.Time // 可注入 clock（SYS-REG 測試）
}

// LoadRegistry 自 path 載入 nodes.json；檔案不存在視為空 registry；
// 內容為非法 JSON 時回傳 ErrInvalidJSON（呼叫端報錯退出，不靜默重建）。
func LoadRegistry(path string) (*Registry, error)

// Add 新增節點；檢查名稱唯一性（ErrDuplicateName）與上限（ErrMaxNodes）；成功後觸發 persist()。
func (r *Registry) Add(req AddRequest) (*Node, error)

// Update 更新節點設定（僅持久化欄位）；成功後觸發 persist()。
func (r *Registry) Update(id string, req UpdateRequest) (*Node, error)

// Remove 移除節點並 persist()。
func (r *Registry) Remove(id string) error

// Get / List 讀取節點（含 runtime state 快照）。
func (r *Registry) Get(id string) (*Node, bool)
func (r *Registry) List() []Node

// Count 回傳目前節點數（50 台上限檢查用）。
func (r *Registry) Count() int

// SetRuntimeXXX 由 nodemonitor / nodeproxy 呼叫更新 runtime 欄位，不觸發落盤。
func (r *Registry) SetRuntimeStatus(id, status string)
func (r *Registry) ApplyHeartbeat(id string, stats HeartbeatStats, at time.Time)

// persist 以 atomic write 寫入 nodes.json：先寫 path+".tmp"（0600）再 os.Rename。
func (r *Registry) persist() error // TODO: handle write/rename error（log + 保留舊檔）
```

### 1.5 internal/nodemonitor — 心跳狀態機

職責：維護節點 `online → offline → long_offline` 狀態轉換、5s ticker 掃描、Manager 啟動寬限期、狀態變更事件發布（推送前端）。**所有閾值可注入**（測試計畫 §6.1 加速環境變數），clock 以 func 注入支援 fake clock 單元測試。

```go
// Package nodemonitor 實作節點心跳監控狀態機（規則 B2、異常 R6）。
package nodemonitor

import (
	"context"
	"time"

	"linux-service-manager/internal/noderegistry"
)

// 節點狀態常數（registry.Node.Status 使用）。
const (
	StatusOnline      = "online"       // 🟢
	StatusWarning     = "warning"      // 🟡 版本不相容（連線正常）
	StatusOffline     = "offline"      // 🔴 WS 斷線或 30s 無心跳
	StatusLongOffline = "long_offline" // ⚫ 300s 無心跳
)

// StatusEvent 為發布給前端 hub 的事件（→ node.status_changed）。
type StatusEvent struct {
	NodeID   string `json:"id"`
	NodeName string `json:"name"`
	Status   string `json:"status"`
	Message  string `json:"message,omitempty"` // 版本警告文案等
}

// Config 所有時間參數皆可注入（生產預設值如下；測試以環境變數覆寫）。
type Config struct {
	OfflineThreshold    time.Duration // 30s  (= 3 × 心跳間隔 10s)
	LongOfflineThreshold time.Duration // 300s
	ScanTick            time.Duration // 5s
	StartupGrace        time.Duration // 30s：Manager 啟動後此期間不觸發離線事件（R6）
	Now                 func() time.Time // 預設 time.Now；測試注入 fake clock
}

// Monitor 為心跳狀態機。publish 由 main 注入（內部呼叫 websocket.Hub 廣播）。
type Monitor struct {
	reg     *noderegistry.Registry
	publish func(StatusEvent)
	cfg     Config
	started time.Time // 啟動寬限期基準點
}

// New 建立 Monitor；Run 必須以 goroutine 啟動。
func New(reg *noderegistry.Registry, publish func(StatusEvent), cfg Config) *Monitor

// Run 每 cfg.ScanTick 掃描一次：
//   - 啟動寬限期內直接 return（SYS-MON-10/11）
//   - lastHeartbeat 距今 ≥ OfflineThreshold 且狀態為 online → offline，發布一次事件
//   - OfflineSince 距今 ≥ LongOfflineThreshold 且狀態為 offline → long_offline，發布一次事件
//   - 狀態未變化的掃描不重複發布（SYS-MON-09）
func (m *Monitor) Run(ctx context.Context)

// OnHeartbeat 由 nodeproxy hub 收到 heartbeat 訊息時呼叫：
// 更新 lastHeartbeat 與服務統計；若原狀態非 online → 回 online 併發布恢復事件。
func (m *Monitor) OnHeartbeat(nodeID string, stats noderegistry.HeartbeatStats)

// OnConnect 由 nodeproxy hub 收到 register 時呼叫：
// 記錄 hostname/version、比對 min_version 標記 warning、狀態 → online（任意非 online 皆恢復，SYS-MON-07/08）。
func (m *Monitor) OnConnect(nodeID string, p agentproto.RegisterPayload, minVersion string)

// OnDisconnect 由 nodeproxy hub 於 WS 關閉時呼叫：立即標示 offline（決策 2 雙軌制）。
func (m *Monitor) OnDisconnect(nodeID string)
```

### 1.6 internal/nodeproxy — WS Hub、RPC 轉發、TLS Pinning、搜尋

職責：(1) 維護 nodeID → Agent WS 連線的 hub；(2) 提供 `Call()` 以 request-id ↔ pending map 做 WS RPC；(3) 逾時策略：操作 15s／查詢 10s；(4) per (node, service, action) singleflight → 409；(5) 跨節點搜尋 errgroup 總逾時 10s partial results；(6) TLS 指紋 pinning。

#### 1.6.1 Agent 連線 Hub（`hub.go`）

```go
// Package nodeproxy 管理 Manager ↔ Agent 的 WS 連線與 RPC 轉發（決策 6）。
package nodeproxy

import (
	"context"
	"encoding/json"
	"net/http"
	"sync"
	"time"

	"linux-service-manager/internal/agentproto"
)

// ErrNodeOffline / ErrInProgress / ErrTimeout 分別對應 503 / 409 / 504 語意。
var (
	ErrNodeOffline = errors.New("node_offline")
	ErrInProgress  = errors.New("operation_in_progress")
	ErrTimeout     = errors.New("rpc_timeout")
)

// Timeout presets（可由環境變數覆寫，測試計畫 §6.1）。
const (
	DefaultActionTimeout = 15 * time.Second // MANAGER_RPC_TIMEOUT_ACTION
	DefaultQueryTimeout  = 10 * time.Second // MANAGER_RPC_TIMEOUT_QUERY
	DefaultReadDeadline  = 35 * time.Second // MANAGER_WS_READ_DEADLINE（半開連線兜底）
)

// Hub 持有所有已連線 Agent。
type Hub struct {
	mu    sync.RWMutex
	conns map[string]*agentConn // key: nodeID

	pendingMu sync.Mutex
	pending   map[string]chan agentproto.Envelope // request_id → response chan

	inflightMu sync.Mutex
	inflight   map[inflightKey]struct{} // singleflight（規則 B4）

	// 回呼，由 main 注入
	OnRegister   func(nodeID string, p agentproto.RegisterPayload)
	OnHeartbeat  func(nodeID string, stats noderegistry.HeartbeatStats)
	OnDisconnect func(nodeID string)

	upgrader websocket.Upgrader
	tlsCfg   *tls.Config
}

type inflightKey struct{ NodeID, Service, Action string }

// ServeWS 為 GET /api/v1/agent/ws handler：
//  1. 強制 TLS（明文 ws:// 拒絕升級，SYS-TLS-05）
//  2. 驗證 query `?token=`（反向認證：Agent 以設定檔 token 驗證 Manager，S37/R7）
//  3. Upgrade 後第一則訊息必為 register；比對 node_name 對應 registry 節點
//  4. 同一 node_name 已有連線 → 拒絕第二條（模擬「第二個 Manager」被 Agent 端拒絕的鏡像保護）
//  5. 進入 read loop：dispatch heartbeat → OnHeartbeat、rpc_response → pending chan；
//     SetReadDeadline(DefaultReadDeadline) + PongHandler 兜底半開連線
//  6. 連線關閉 → 清空該節點所有 pending（SYS-PF-09）→ OnDisconnect
func (h *Hub) ServeWS(w http.ResponseWriter, r *http.Request)

// Send 向指定節點送出 envelope；離線回 ErrNodeOffline。
func (h *Hub) Send(nodeID string, env agentproto.Envelope) error
```

#### 1.6.2 RPC 轉發與 Singleflight（`rpc.go`）

```go
// Call 執行一次 WS RPC：產生 uuid request_id → 註冊 pending chan → 送出 rpc_request
// → 等待 rpc_response 或 ctx/timeout 到期。
//   - 節點離線：不送訊息立即回 ErrNodeOffline（SYS-PF-04）
//   - 同 (node, service, action) 已有 in-flight 操作：回 ErrInProgress（→ 409，SYS-PF-05）
//   - 不同節點、同節點不同服務：不受影響（SYS-PF-06/07）
//   - timeout 到期：清理 pending map，回 ErrTimeout（SYS-PF-02/03）
func (h *Hub) Call(ctx context.Context, nodeID, method string, params, out any, timeout time.Duration) error

// 便利方法：逾時 preset 包裝
func (h *Hub) CallAction(ctx context.Context, nodeID, method, service string) error // 15s
func (h *Hub) CallQuery(ctx context.Context, nodeID, method string, params, out any) error // 10s
```

#### 1.6.3 跨節點搜尋（`search.go`）

> ⛔ REMOVED（2025-08-25）：隨跨節點搜尋移出功能範圍，本節不實作；保留骨架供日後重新啟用參考。

```go
// SearchResultHit 為單筆搜尋結果（S24）。
type SearchResultHit struct {
	NodeID   string `json:"node_id"`
	NodeName string `json:"node_name"`
	Service  string `json:"service"`
	Status   string `json:"status"`
}

// UnreachableNode 為無法查詢的節點（S33/R4：不阻塞其他結果）。
type UnreachableNode struct {
	NodeID      string `json:"node_id"`
	NodeName    string `json:"node_name"`
	Unreachable bool   `json:"unreachable"` // true
	Reason      string `json:"reason"`      // "offline" | "timeout"
}

// SearchResponse 為 GET /api/v1/nodes/services/search 的回應本體。
type SearchResponse struct {
	Results    []SearchResultHit `json:"results"`
	Unreachable []UnreachableNode `json:"unreachable"`
}

// SearchServices 向所有線上節點並行查詢：
// errgroup + ctx 總逾時 DefaultQueryTimeout(10s)；
// 各 goroutine 收齊即回（先到的結果先進 results）；
// 離線節點直接列入 Unreachable，慢節點逾時列入 Unreachable(reason=timeout)；
// context cancel 傳播至所有 goroutine，無洩漏（SYS-SRCH-05）。
func (h *Hub) SearchServices(ctx context.Context, q string) SearchResponse
```

#### 1.6.4 TLS 指紋 Pinning（`tls.go`）

```go
// DialTLS 建立 Agent 位址的 TLS 連線（test-connection 直連 /health 用，決策 3）：
//   - tls.Config{InsecureSkipVerify: true} + VerifyPeerCertificate 自行比對
//     SHA-256(SPKI/Cert.Raw) 與 fingerprint 參數
//   - fingerprint 為空 → 僅加密不驗證（SYS-TLS-03）
//   - 不符 → 錯誤含 "certificate fingerprint mismatch"（SYS-TLS-02）
//   - NotAfter < now → 錯誤分類 "certificate expired"（SYS-TLS-04）
func DialTLS(ctx context.Context, addr, fingerprint string) (*http.Client, error)

// FingerprintOf 計算憑證 SHA-256 指紋（hex，冒號分隔顯示格式由前端處理）。
func FingerprintOf(certDER []byte) string
```

### 1.7 internal/agentclient — Agent 側 WS 客戶端

職貝：outbound-only 撥號至 Manager `/api/v1/agent/ws`、exponential backoff 重連、register → register_ack → heartbeat ticker → rpc_request dispatch（呼叫共用 `internal/systemd` 模組執行）。

```go
// Package agentclient 實作 Agent 對 Manager 的 WS 長連線客戶端（決策 1/4）。
package agentclient

// Config 由 cmd/agent 自設定檔載入。
type Config struct {
	ManagerAddr       string        // manager.example.com:8443
	Token             string        // auth_token：放於 WS upgrade URL query，Manager 驗證
	NodeName          string        // node_name
	HeartbeatInterval time.Duration // 預設 10s；AGENT_HEARTBEAT_INTERVAL 可覆寫
	TLSFingerprint    string        // Agent 端驗證 Manager 憑證指紋（可選）
	ReadDeadline      time.Duration // 預設 35s（SYS-AC-04 半開連線兜底）
}

// ServiceController 抽象 systemd 操作（由 internal/systemd 實作，方便 mock）。
type ServiceController interface {
	List() ([]Service, error)
	Start(name string) error // Stop / Restart / Enable / Disable 同形
	Logs(name string, opts LogQuery) (string, error)
	SystemInfo() (SystemInfo, error)
}

// Client 為 Agent 主循環。
type Client struct {
	cfg Config
	svc ServiceController
}

// New 建立 Client。
func New(cfg Config, svc ServiceController) *Client

// Run 為阻塞主循環：
//  1. dial wss://{ManagerAddr}/api/v1/agent/ws?token={Token}（TLS + 可選指紋 pinning）
//  2. 連上後立即發送 register（node_name/hostname/version/os，SYS-AC-01）
//  3. 等 register_ack；compatible=false → log 警告並持續運行（🟡 由 Manager 顯示，SYS-AC-05）
//  4. heartbeat ticker（cfg.HeartbeatInterval）發送服務統計（SYS-AC-02）
//  5. read loop dispatch rpc_request → ServiceController 對應方法 → 回 rpc_response
//     （心跳訊息走獨立高優先 send queue，避免被大量日誌塞住——風險緩解）
//  6. 斷線 → exponential backoff 重撥（1s 起 ×2，上限 60s；Manager 恢復後自動連上，SYS-AC-03/04）
func (c *Client) Run(ctx context.Context) error
```

### 1.8 internal/agentapi — Agent 精簡 JSON API

職責：提供與 Manager `/api/v1/services*` 相同合約的本機 JSON API（**無前端、無 audit UI**），滿足「Agent 離線時本地操作仍可直接存取 Agent」（驗收清單—Agent 端）。Token header 驗證來自直連請求。

```go
// Package agentapi 組裝 Agent 本機 HTTP API。
package agentapi

// NewRouter 組裝 chi router：
//
//	r.Get("/health", handleHealth)              // 回 {version, hostname, os}（test-connection 目標）
//	r.Route("/api/v1", func(r chi.Router) {
//	    r.Use(TokenAuth(cfg.Token))             // Bearer token 驗證
//	    r.Get("/services", ...)
//	    r.Post("/services/{name}/start|stop|restart|enable|disable", ...)  // 與 Manager 同合約
//	    r.Get("/services/{name}/logs", ...)
//	    r.Get("/info", ...)
//	})
//
// 不 import templates/embed —— binary 保持 < 8MB（決策 4）。
func NewRouter(svc agentclient.ServiceController, version string) http.Handler
```

### 1.9 handler/nodes_handler.go — REST Routes

```go
// Package handler — nodes_handler.go
// NodesHandler 處理 /api/v1/nodes/* 全部端點（Interaction Flow 第 7 節驗收清單）。
type NodesHandler struct {
	reg       *noderegistry.Registry
	agentHub  *nodeproxy.Hub   // Agent WS hub（RPC 轉發）
	mon       *nodemonitor.Monitor
	pushHub   *websocket.Hub   // 前端推播 hub（既有）
	audit     *audit.Logger
	binaryDir string           // Agent binary 存放目錄
}

// HandleCreateNode   POST   /api/v1/nodes                          （201/400/409，S13/S38/S40/S41）
// HandleListNodes    GET    /api/v1/nodes                          （Background/S01）
// HandleGetNode      GET    /api/v1/nodes/{id}                     （詳情面板 S22/S28）
// HandleUpdateNode   PUT    /api/v1/nodes/{id}                     （編輯設定）
// HandleDeleteNode   DELETE /api/v1/nodes/{id}                     （S23；成功後廣播 node.registry_changed）
// HandleReconnect    POST   /api/v1/nodes/{id}/reconnect           （「重新連線」按鈕，S22）
// HandleTestConnection POST /api/v1/nodes/test-connection          （S11/S12/S34；DialTLS 直連 GET https://{addr}/health）
// HandleSearch       GET    /api/v1/nodes/services/search?q=       （S24–S27/S33；hub.SearchServices）
// HandleSummary      GET    /api/v1/nodes/summary                  （S01 匯總統計列；來源＝各節點最後心跳統計）
// HandleNodeServices GET    /api/v1/nodes/{id}/services            （代理 services.list，S03/S45）
// HandleNodeAction   POST   /api/v1/nodes/{id}/services/{name}/{action}
//                           action ∈ start|stop|restart|enable|disable
//                           （S06；15s 逾時；409 in-progress；audit 記錄 node_id/node_name，B10）
// HandleNodeLogs     GET    /api/v1/nodes/{id}/services/{name}/logs （S07；代理查詢）
// HandleNodeInfo     GET    /api/v1/nodes/{id}/info                （S28；代理 system.info）
// HandleAgentBinary  GET    /api/v1/nodes/agent-binary?arch=amd64|arm64 （S16；Content-Disposition 附檔名）

// HandleAgentWS GET /api/v1/agent/ws — 委派 nodeproxy.Hub.ServeWS（見 1.6.1）。
```

全部 route 掛在既有 session auth middleware 之後（HDL-NODE-08 未登入 → 401）。`cmd/manager/main.go` 註冊：

```go
nh := &handler.NodesHandler{Reg: reg, AgentHub: agentHub, Mon: mon, PushHub: wsHub, Audit: auditLog, BinaryDir: binDir}
r.Route("/api/v1/nodes", func(r chi.Router) {
	r.Use(authMiddleware)
	r.Post("/", nh.HandleCreateNode)
	r.Post("/test-connection", nh.HandleTestConnection)
	r.Get("/summary", nh.HandleSummary) // ⛔ 不實作 /services/search（2025-08-25 REMOVED）
	r.Get("/agent-binary", nh.HandleAgentBinary)
	r.Get("/{id}", nh.HandleGetNode)
	r.Put("/{id}", nh.HandleUpdateNode)
	r.Delete("/{id}", nh.HandleDeleteNode)
	r.Post("/{id}/reconnect", nh.HandleReconnect)
	r.Get("/{id}/services", nh.HandleNodeServices)
	r.Post("/{id}/services/{name}/{action}", nh.HandleNodeAction)
	r.Get("/{id}/services/{name}/logs", nh.HandleNodeLogs)
	r.Get("/{id}/info", nh.HandleNodeInfo)
})
r.Get("/api/v1/agent/ws", agentHub.ServeWS) // 不走 session auth（Agent 以 token 驗證）
```

Manager 啟動流程（cmd/manager/main.go）：LoadRegistry → 若 nodes.json 損毀報錯退出（SYS-REG-11）→ 起 Monitor.Run → **逐一對 registry 節點嘗試重連/等待 inbound**（outbound 模式下由 Agent 重連；啟動寬限期 30s 內 Monitor 不發離線事件，S36/R6）。

### 1.10 audit / websocket hub 擴充

```go
// internal/audit/audit.go — AuditEntry 新增欄位（規則 B10）：
type AuditEntry struct {
	// …既有欄位…
	NodeID   string `json:"node_id,omitempty"`   // 本機操作留空
	NodeName string `json:"node_name,omitempty"` // e.g. "web-server-01"
}

// internal/websocket/hub.go — 廣播訊息新增兩種 type（既有 Message.Type 欄位擴充）：
//   node.status_changed  : { id, name, status, message }        （S18/S20/S39/S50）
//   node.registry_changed: { action: "added"|"removed", node }  （S13/S23/S51）
// 廣播時機：Monitor.publish 與 NodesHandler CRUD 成功後呼叫 hub.Broadcast。
```

---

## 2. 前端實作規格

### 2.1 檔案改動總覽

```
frontend/src/
├── api/
│   └── client.ts                        ← 修改：新增 nodes API 函式群
├── composables/
│   └── useWebSocket.ts                  ← 修改：新增 node.* 訊息型別與處理
├── stores/
│   └── node.ts                          ← 新增：節點 store（列表/摘要/當前節點/搜尋）
├── types/
│   └── node.ts                          ← 新增：ManagedNode / NodeStatus 型別
├── components/
│   ├── NodeCard.vue                     ← 新增：節點卡片（狀態燈/摘要/相對時間/版本警告 Tooltip）
│   ├── NodeSummaryBar.vue               ← 新增：頂部匯總統計列（複用 StatsBar 樣式模式）
│   ├── NodeSwitcher.vue                 ← 新增：Header 節點下拉選單 + 「所有節點」返回鈕
│   ├── NodeFormModal.vue                ← 新增：新增/編輯節點 Modal（含測試連線）
│   ├── NodeDetailPanel.vue              ← 新增：節點詳情側面板（含離線資訊面板模式）
│   └── NodeSearchResults.vue            ← 新增：跨節點搜尋結果列表
├── views/
│   ├── DashboardView.vue                ← 修改：依 ?node= query 分流 Aggregate / 單節點視圖
│   └── NodeManagementView.vue           ← 新增：/nodes 管理頁面
└── router/index.ts                      ← 修改：新增 /nodes 路由
```

### 2.2 types/node.ts

```typescript
export type NodeStatus = 'online' | 'warning' | 'offline' | 'long_offline'

export interface ManagedNode {
  id: string
  name: string
  hostname: string
  address: string
  status: NodeStatus
  version: string
  versionCompatible: boolean
  versionMessage: string
  lastHeartbeat: string | null      // ISO timestamp
  lastOnlineAt: string | null
  onlineSince: string | null
  servicesTotal: number
  servicesRunning: number
  servicesFailed: number
  cpuPercent?: number
  memoryPercent?: number
  note?: string
}

export interface NodeSummary {
  totalNodes: number; online: number; offline: number
  servicesTotal: number; running: number; failed: number
}

export interface NodeSearchResult {
  node_id: string; node_name: string; service: string; status: string
}
export interface NodeSearchResponse {
  results: NodeSearchResult[]
  unreachable: Array<{ node_id: string; node_name: string; unreachable: boolean; reason: string }>
}
```

### 2.3 api/client.ts 新增函式

```typescript
// 節點 API（對應第 3 節合約）
export const fetchNodes = () => http.get<ManagedNode[]>('/api/v1/nodes')
export const fetchNode = (id: string) => http.get<ManagedNode>(`/api/v1/nodes/${id}`)
export const fetchNodeSummary = () => http.get<NodeSummary>('/api/v1/nodes/summary')
export const createNode = (body: NodeFormInput) => http.post('/api/v1/nodes', body)
export const updateNode = (id: string, body: Partial<NodeFormInput>) => http.put(`/api/v1/nodes/${id}`, body)
export const deleteNode = (id: string) => http.delete(`/api/v1/nodes/${id}`)
export const reconnectNode = (id: string) => http.post(`/api/v1/nodes/${id}/reconnect`)
export const testConnection = (body: TestConnectionInput) =>
  http.post<TestConnectionResult>('/api/v1/nodes/test-connection', body)
export const searchNodeServices = (q: string) =>
  http.get<NodeSearchResponse>('/api/v1/nodes/services/search', { params: { q } })
// 單節點服務操作：改寫既有 service API 函式，接受可選 nodeId → 改打 /nodes/{id}/services/*
export const nodeServiceUrl = (nodeId: string, path: string) => `/api/v1/nodes/${nodeId}/services/${path}`
export const agentBinaryUrl = (arch: 'amd64' | 'arm64') => `/api/v1/nodes/agent-binary?arch=${arch}`
```

### 2.4 stores/node.ts（Pinia setup store）

```typescript
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { ManagedNode, NodeSummary, NodeSearchResponse } from '../types/node'

export const useNodeStore = defineStore('node', () => {
  // ── state ──
  const nodes = ref<ManagedNode[]>([])
  const summary = ref<NodeSummary | null>(null)
  const loading = ref(false)
  const searchResults = ref<NodeSearchResponse | null>(null)
  const searching = ref(false)

  // ── getters ──
  // currentNode 由 route query ?node= 驅動（URL 即狀態，決策 7；F-ST-05）
  const currentNodeId = computed(() => {
    const r = useRouterProxy()
    return r.query.node ? String(r.query.node) : null
  })
  const currentNode = computed(() =>
    currentNodeId.value ? nodes.value.find(n => n.id === currentNodeId.value) ?? null : null)
  const totalNodes = computed(() => nodes.value.length)
  const onlineCount = computed(() => nodes.value.filter(n => n.status === 'online').length)
  const offlineCount = computed(() =>
    nodes.value.filter(n => n.status === 'offline' || n.status === 'long_offline').length)

  // ── actions ──
  async function fetchNodes() { /* GET /api/v1/nodes → nodes */ }
  async function fetchSummary() { /* GET /api/v1/nodes/summary → summary */ }

  // WS 事件套用（不需重整頁面；F-ST-03/04）
  function applyStatusChanged(p: { id: string; name: string; status: NodeStatus; message?: string }) {
    const n = nodes.value.find(x => x.id === p.id)
    if (!n) return
    n.status = p.status
    if (p.message) n.versionMessage = p.message
    recomputeSummaryFromNodes() // 統計列同步 -1/+1（S18）
  }
  function applyRegistryChanged(p: { action: 'added' | 'removed'; node: ManagedNode }) {
    if (p.action === 'added' && !nodes.value.some(n => n.id === p.node.id)) nodes.value.push(p.node)
    if (p.action === 'removed') nodes.value = nodes.value.filter(n => n.id !== p.node.id)
  }

  // 跨節點搜尋（debounce 由元件層處理 300ms）
  async function search(q: string) { /* searchNodeServices(q) → searchResults；空 results → 空狀態 */ }
  function clearSearch() { searchResults.value = null }

  // CRUD（成功後 Toast 由元件層顯示）
  async function addNode(body: NodeFormInput) { /* 409 → throw DuplicateNameError */ }
  async function removeNode(id: string) { /* DELETE；成功後 applyRegistryChanged 由 WS 事件補齊 */ }
  async function reconnect(id: string) { /* POST reconnect */ }

  return { nodes, summary, loading, searchResults, searching,
           currentNodeId, currentNode, totalNodes, onlineCount, offlineCount,
           fetchNodes, fetchSummary, applyStatusChanged, applyRegistryChanged,
           search, clearSearch, addNode, removeNode, reconnect }
})
```

### 2.5 useWebSocket.ts 擴充

```typescript
// 新增訊息型別
export interface NodeStatusChangedMessage {
  type: 'node_status_changed'; id: string; name: string; status: NodeStatus; message?: string
}
export interface NodeRegistryChangedMessage {
  type: 'node_registry_changed'; action: 'added' | 'removed'; node: ManagedNode
}

// 在既有 onmessage switch 增加 case：
//   node_status_changed  → nodeStore.applyStatusChanged(msg)
//                          Toast：「{name} 已離線」/「{name} 已恢復連線」（僅 offline⇄online 轉換時，S18/S20）
//   node_registry_changed → nodeStore.applyRegistryChanged(msg)
// 既有斷線自動重連邏輯重用（S51 F-WS-03）
```

### 2.6 NodeCard.vue

```vue
<script setup lang="ts">
import { computed } from 'vue'
import type { ManagedNode } from '../types/node'

const props = defineProps<{ node: ManagedNode }>()
const emit = defineEmits<{
  select: [nodeId: string]      // 點擊 Card → /dashboard?node={id}（S03）
  detail: [nodeId: string]      // 「詳情」按鈕 → NodeDetailPanel（S28）
}>()

// 狀態指示燈：🟢 online / 🟡 warning / 🔴 offline / ⚫ long_offline（F-NC-01~03/06）
const dotClass = computed(() => `node-dot--${props.node.status}`)
// 「最後心跳：X 秒前」相對時間（F-NC-04）；離線時服務統計加灰顯 class
const relTime = computed(() => formatRelativeTime(props.node.lastHeartbeat))
</script>

<template>
  <div class="node-card" :class="[dotClass, { 'node-card--collapsed': node.status === 'long_offline' }]"
       data-testid="node-card" @click="node.status === 'online' || node.status === 'warning'
         ? emit('select', node.id) : emit('detail', node.id)">
    <!-- 離線/長期離線 Card 點擊 → 離線資訊面板（S22） -->
    <span class="node-dot" aria-hidden="true"></span>
    <h3 class="node-card__name">{{ node.name }}</h3>
    <span class="node-card__hostname">{{ node.hostname }}</span>
    <span v-if="!node.versionCompatible" class="node-card__warn" :title="node.versionMessage">🟡</span>
    <dl class="node-card__stats" :class="{ 'is-muted': isOffline }">
      <dt>服務</dt><dd>{{ node.servicesRunning }}/{{ node.servicesTotal }} 執行中</dd>
      <dt>最後心跳</dt><dd>{{ relTime }}</dd>
      <!-- P2：CPU/Memory 簡要指標 -->
    </dl>
    <button class="btn btn--ghost" @click.stop="emit('detail', node.id)">詳情</button>
  </div>
</template>
```

### 2.7 NodeSwitcher.vue 與 NodeSummaryBar.vue

```vue
<!-- NodeSwitcher.vue：Header 內節點下拉（S03–S05） -->
<script setup lang="ts">
import { useNodeStore } from '../stores/node'
import { useRouter } from 'vue-router'
const store = useNodeStore(); const router = useRouter()
function selectNode(id: string | null) {
  // null = 「所有節點」→ /dashboard；否則 /dashboard?node={id}（F-NS-03/04）
  router.push(id ? { path: '/dashboard', query: { node: id } } : '/dashboard')
}
function onChange(e: Event) { selectNode((e.target as HTMLSelectElement).value || null) }
</script>
<template>
  <div class="node-switcher">
    <template v-if="store.currentNode">
      <span class="node-switcher__label">目前節點：{{ store.currentNode.name }}</span>
      <select class="node-switcher__select" :value="store.currentNodeId" @change="onChange">
        <option v-for="n in store.nodes" :key="n.id" :value="n.id">
          {{ dotFor(n.status) }} {{ n.name }}
        </option>
      </select>
      <button class="btn btn--ghost" @click="selectNode(null)">所有節點</button>
    </template>
  </div>
</template>

<!-- NodeSummaryBar.vue：總節點數/線上/離線 + 總服務數/執行中/失敗（S01），
     props: summary: NodeSummary；結構複用 StatsBar.vue 樣式 -->
```

### 2.8 NodeFormModal.vue（新增/編輯節點）

> **UI/UX 規格**：`docs/uiux/014-node-management-design.md` §4.1–4.3
> **互動 Mockup**：`docs/uiux/014-node-management-design.html`

```vue
<script setup lang="ts">
import { reactive, ref } from 'vue'
import { testConnection, createNode } from '../api/client'
import { useToast } from '../composables/useToast'

const props = defineProps<{
  mode: 'create' | 'edit'
  initialData?: ManagedNode  // edit 模式時的預填值
}>()
const emit = defineEmits<{ close: []; created: [node: ManagedNode]; updated: [node: ManagedNode] }>()
const toast = useToast()

// 表單欄位（對應 UI/UX §4.1 欄位定義）
const form = reactive({
  name: '',           // 必填
  address: '',        // 必填，host:port 格式
  tlsFingerprint: '', // 選填，mTLS 時使用
  token: '',          // 選填，驗證用
  note: ''            // 選填
})
const errors = reactive<Record<string, string>>({})   // 必填缺失紅色提示（S40）
const testing = ref(false)
const testResult = ref<null | { ok: boolean; message: string; version?: string; hostname?: string; os?: string }>(null)

// edit 模式：預填表單（唯讀欄位：Node ID）
if (props.mode === 'edit' && props.initialData) {
  Object.assign(form, {
    name: props.initialData.name,
    address: props.initialData.address,
    tlsFingerprint: props.initialData.tlsFingerprint || '',
    token: '',  // Token 不回顯，需重新輸入
    note: props.initialData.note || ''
  })
}

async function onTestConnection() {
  testing.value = true
  testResult.value = null
  try {
    const { data } = await testConnection({
      address: form.address,
      tls_fingerprint: form.tlsFingerprint || undefined,
      token: form.token || undefined
    })
    testResult.value = data.ok
      ? { ok: true, message: `連線成功 — Agent ${data.version} @ ${data.hostname} (${data.os})`,
          version: data.version, hostname: data.hostname, os: data.os }
      : { ok: false, message: `無法連線：${data.error}` }
  } catch (e: any) {
    testResult.value = { ok: false, message: `連線失敗：${e.message}` }
  } finally {
    testing.value = false
  }
}

async function onSubmit() {
  // 欄位驗證（S40）
  errors.name = form.name ? '' : '必填'
  errors.address = form.address ? '' : '必填'
  if (errors.name || errors.address) return

  try {
    if (props.mode === 'create') {
      const { data } = await createNode(form)
      toast.show(data.status === 'online'
        ? `節點 ${data.name} 已註冊並上線`
        : `節點 ${data.name} 已註冊但無法連線`)
      emit('created', data)
    } else {
      const { data } = await updateNode(props.initialData!.id, form)
      toast.show(`節點 ${data.name} 已更新`)
      emit('updated', data)
    }
    emit('close')
  } catch (e: any) {
    if (e.response?.status === 409) {
      toast.show('節點名稱重複，請使用不同名稱') // 表單保留（S38）
    } else {
      toast.show(e.response?.data?.error ?? '操作失敗')
    }
  }
}

function onCancel() { emit('close') } // 取消不建立任何記錄（S15）
</script>
<template>
  <!-- Modal 標題：新增節點 / 編輯節點 -->
  <!-- Node ID（edit 模式唯讀顯示） -->
  <!-- 欄位：節點名稱* / Agent 位址(host:port)* / TLS 憑證指紋 / API Token / 備註 -->
  <!-- 測試連線結果區塊（class：node-form__result--ok / --error） -->
  <!-- 按鈕：測試連線 / 註冊(或更新) / 取消 -->
</template>
```

### 2.9 NodeManagementView.vue（路由 /nodes）

> **UI/UX 規格**：`docs/uiux/014-node-management-design.md` §2–3
> **互動 Mockup**：`docs/uiux/014-node-management-design.html`

```vue
<script setup lang="ts">
import { onMounted, ref, computed } from 'vue'
import { useNodeStore } from '../stores/node'
import NodeFormModal from '../components/NodeFormModal.vue'
import ConfirmModal from '../components/ConfirmModal.vue' // 既有元件重用（S23）
import { useToast } from '../composables/useToast'

const store = useNodeStore()
const toast = useToast()

// Modal 狀態
const showCreateModal = ref(false)
const editTarget = ref<ManagedNode | null>(null)
const removeTarget = ref<ManagedNode | null>(null)
const showRemoveConfirm = ref(false)

// 搜尋篩選（debounce 300ms）
const searchQuery = ref('')
const filteredNodes = computed(() => {
  if (!searchQuery.value) return store.nodes
  const q = searchQuery.value.toLowerCase()
  return store.nodes.filter(n =>
    n.name.toLowerCase().includes(q) ||
    n.address.toLowerCase().includes(q)
  )
})

// 下載 Agent
const showDownloadMenu = ref(false)
function downloadAgent(arch: 'amd64' | 'arm64') {
  window.location.href = agentBinaryUrl(arch)
  showDownloadMenu.value = false
}

onMounted(() => store.fetchNodes())

// 操作處理
function handleEdit(node: ManagedNode) {
  editTarget.value = node
}
function handleRemove(node: ManagedNode) {
  removeTarget.value = node
  showRemoveConfirm.value = true
}
async function confirmRemove() {
  try {
    await store.removeNode(removeTarget.value!.id)
    toast.show('節點已移除')
    showRemoveConfirm.value = false
    removeTarget.value = null
  } catch (e: any) {
    toast.show('移除失敗：' + (e.message || '未知錯誤'))
  }
}
function handleNodeCreated(node: ManagedNode) {
  showCreateModal.value = false
  // WS 事件會自動更新列表（node_registry_changed）
}
function handleNodeUpdated(node: ManagedNode) {
  editTarget.value = null
  // WS 事件會自動更新列表
}
</script>
<template>
  <div class="node-management">
    <!-- 工具列 -->
    <div class="toolbar">
      <button class="btn btn--primary" @click="showCreateModal = true">
        <svg aria-hidden="true"><use href="#icon-plus" /></svg>
        新增節點
      </button>
      
      <!-- 下載 Agent 下拉選單 -->
      <div class="dropdown">
        <button class="btn btn--outline" @click="showDownloadMenu = !showDownloadMenu">
          <svg aria-hidden="true"><use href="#icon-download" /></svg>
          下載 Agent
        </button>
        <div v-if="showDownloadMenu" class="dropdown__menu">
          <button @click="downloadAgent('amd64')">Linux amd64</button>
          <button @click="downloadAgent('arm64')">Linux arm64</button>
        </div>
      </div>

      <!-- 搜尋框 -->
      <input
        v-model="searchQuery"
        type="search"
        placeholder="搜尋節點..."
        class="search-input"
        aria-label="搜尋節點"
      />
    </div>

    <!-- 節點列表表格 -->
    <div class="node-table-wrapper">
      <table class="node-table" role="grid">
        <thead>
          <tr>
            <th scope="col">名稱</th>
            <th scope="col">位址</th>
            <th scope="col">狀態</th>
            <th scope="col">最後心跳</th>
            <th scope="col">版本</th>
            <th scope="col">備註</th>
            <th scope="col">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="node in filteredNodes" :key="node.id" class="node-row">
            <td>
              <span class="node-dot" :class="`node-dot--${node.status}`" aria-hidden="true"></span>
              <router-link
                v-if="node.status === 'online' || node.status === 'warning'"
                :to="{ path: '/dashboard', query: { node: node.id } }"
                class="node-name-link"
              >{{ node.name }}</router-link>
              <span v-else class="node-name">{{ node.name }}</span>
            </td>
            <td><code class="mono">{{ node.address }}</code></td>
            <td>
              <span class="badge" :class="`badge--${node.status}`">
                {{ { online: '線上', warning: '延遲', offline: '離線', long_offline: '長期離線' }[node.status] }}
              </span>
            </td>
            <td>{{ formatRelativeTime(node.lastHeartbeat) }}</td>
            <td>{{ node.version || '—' }}</td>
            <td class="note-cell" :title="node.note">{{ truncate(node.note, 30) }}</td>
            <td class="actions-cell">
              <button class="btn btn--ghost btn--sm" @click="handleEdit(node)">編輯</button>
              <button class="btn btn--ghost btn--sm btn--danger" @click="handleRemove(node)">移除</button>
            </td>
          </tr>
        </tbody>
      </table>

      <!-- 空狀態 -->
      <EmptyState v-if="filteredNodes.length === 0 && !store.loading">
        <template #icon>
          <svg aria-hidden="true"><use href="#icon-server" /></svg>
        </template>
        <template #title>尚無已註冊節點</template>
        <template #description>
          請先在目標機器部署 Agent，然後點擊「新增節點」進行註冊。
        </template>
        <template #actions>
          <button class="btn btn--outline" @click="downloadAgent('amd64')">下載 Agent</button>
          <button class="btn btn--primary" @click="showCreateModal = true">新增節點</button>
        </template>
      </EmptyState>
    </div>

    <!-- 新增節點 Modal -->
    <NodeFormModal
      v-if="showCreateModal"
      mode="create"
      @close="showCreateModal = false"
      @created="handleNodeCreated"
    />

    <!-- 編輯節點 Modal -->
    <NodeFormModal
      v-if="editTarget"
      mode="edit"
      :initial-data="editTarget"
      @close="editTarget = null"
      @updated="handleNodeUpdated"
    />

    <!-- 移除確認對話框 -->
    <ConfirmModal
      v-if="showRemoveConfirm"
      title="移除節點"
      :message="`確定要移除「${removeTarget?.name}」？所有歷史資料將保留。`"
      confirm-text="確認移除"
      confirm-class="btn--danger"
      @confirm="confirmRemove"
      @cancel="showRemoveConfirm = false"
    />
  </div>
</template>
```

### 2.10 DashboardView.vue 視圖分流與單節點整合

```vue
<script setup lang="ts">
// Aggregate / 單節點分流（決策 7 方案 A）：query ?node= 有值 → 單節點模式
const route = useRoute(); const router = useRouter()
const nodeStore = useNodeStore(); const serviceStore = useServiceStore()

const nodeId = computed(() => (route.query.node as string) ?? null)
const expandService = computed(() => (route.query.expand as string) ?? null) // 搜尋跳轉展開（S25）

watch(nodeId, async (id) => {
  if (!id) return
  await loadNodeServices(id) // GET /api/v1/nodes/{id}/services → serviceStore.setServices
}, { immediate: true })

// 生命週期：unmount 時清除 WS 訂閱（F-DB-03）
// 單節點模式：
//  - Header 插入 <NodeSwitcher />
//  - 當前節點 offline → 黃色 Banner「節點已離線，操作不可用」+ 操作按鈕全 disabled（S19/F-OFF-01）
//  - 收到 status_changed online → Banner 消失、重新載入服務列表（S20/F-OFF-02）
//  - 服務操作走 nodeServiceUrl(nodeId, ...)；loading spinner；15s 逾時 Toast（S06/S32）
//  - 日誌檢視帶 nodeId（S07/F-LOG-01）
// Aggregate 模式：
//  - <NodeSummaryBar /> + Node Cards 網格（長期離線排序置底，S21）
//  - 空狀態：<EmptyState>「尚無已註冊節點，請先新增節點」+ 前往 /nodes 引導（S02）
//  - 搜尋框 debounce 300ms → nodeStore.search → <NodeSearchResults>（S24–S27/S33）
</script>
```

### 2.11 NodeSearchResults.vue

```vue
<script setup lang="ts">
const props = defineProps<{ result: NodeSearchResponse }>()
const emit = defineEmits<{ jump: [nodeId: string, service: string]; close: [] }>()
// 每列：{node_name} / {service} / {status}；unreachable 節點旁顯示「無法查詢」（S33/F-SE-06）
// click 列 → router.push(`/dashboard?node=${node_id}&expand=${service}`)（S25）
// results 為空 → 「沒有找到匹配的服務」（S26）；close → 返回 Card 視圖（S27）
</script>
```

---

## 3. API 合約

### 3.1 REST Endpoints（涵蓋 Interaction Flow 第 7 節驗收清單全部項目）

| 方法 | 路徑 | Request | Response | 錯誤碼 | 對應 BDD |
|------|------|---------|----------|--------|---------|
| POST | /api/v1/nodes | `{name*, address*, tls_fingerprint?, token?, note?}` | 201 `{id, name, address, status}` | 400 缺必填/達上限；409 名稱重複 | S13/S14/S38/S40/S41 |
| GET | /api/v1/nodes | — | 200 `[{id,name,hostname,address,status,last_heartbeat,services_*,version,...}]` | 401 | S01 |
| GET | /api/v1/nodes/{id} | — | 200 節點詳細欄位（含 last_online_at/offline_since/version_message） | 404 | S22/S28 |
| PUT | /api/v1/nodes/{id} | `{name?, address?, tls_fingerprint?, token?, note?}` | 200 更新後節點 | 400/404 | 編輯設定 |
| DELETE | /api/v1/nodes/{id} | — | 200 `{ok:true}`；廣播 `node.registry_changed` | 404 | S23 |
| POST | /api/v1/nodes/{id}/reconnect | — | 200 `{ok:true}`（觸發重連程序） | 404 | S22「重新連線」 |
| POST | /api/v1/nodes/test-connection | `{address*, tls_fingerprint?, token?}` | 200 `{ok:true, version, hostname, os}` **或** `{ok:false, error:"connection refused"\|"certificate expired"\|"fingerprint mismatch"}` | 400 位址格式非法 | S11/S12/S34 |
| GET | /api/v1/nodes/summary | — | 200 `{total_nodes, online, offline, services_total, running, failed}`（來源＝各節點最後心跳統計） | 401 | S01 |
| ⛔ REMOVED | ~~GET /api/v1/nodes/services/search?q=~~ | — | — | — | S24–S27/S33 @deferred |
| GET | /api/v1/nodes/{id}/services | — | 200 Agent 服務列表（即時代理，不快取） | 503 `{"error":"node_offline"}` | S03/S45 |
| POST | /api/v1/nodes/{id}/services/{name}/start\|stop\|restart\|enable\|disable | — | 200 `{ok:true}` | 503 node_offline；409 in_progress；504 timeout；Agent 失敗透傳原始 error | S06/S08/S09/S32 |
| GET | /api/v1/nodes/{id}/services/{name}/logs | query 同單機 logs | 200 journalctl 內容透傳 | 503 | S07 |
| GET | /api/v1/nodes/{id}/info | — | 200 `{os, kernel, uptime, version, hostname, cpu, memory, disk}` | 503 | S28 |
| GET | /api/v1/nodes/agent-binary?arch=amd64\|arm64 | query `arch` | 200 binary stream，`Content-Disposition: attachment; filename="agent-linux-{arch}"` | 400 不支援架構；401 | S16a/b |

通用：全部端點位於 session auth middleware 後（未登入 401，HDL-NODE-08/HDL-DL-04）；Audit Log：所有代理操作寫入 audit.jsonl 含 `node_id`/`node_name`（規則 B10）。

### 3.2 Manager ↔ Agent WS 訊息合約（`GET /api/v1/agent/ws?token=`）

| 訊息類型 | 方向 | 欄位 | 說明 |
|---------|------|------|------|
| register | Agent → Manager | `request_id`, payload `{node_name, hostname, version, os}` | 連線後首則訊息（S17） |
| register_ack | Manager → Agent | `request_id`, `ok`, payload `{min_version, compatible}` | compatible=false → 🟡（S39） |
| heartbeat | Agent → Manager | `request_id`, payload `{services_total, services_running, services_failed, cpu?, mem?}` | 每 10s（可設定）；附帶統計為 summary 資料來源 |
| rpc_request | Manager → Agent | `request_id`, `method`, payload(params) | method 見 agentproto 常數；逾時操作 15s／查詢 10s |
| rpc_response | Agent → Manager | `request_id`, `ok`, payload(result\|error) | Manager 以 request_id 配對 pending |

連線層約定：強制 TLS；Agent 以 URL query `token` 反向驗證 Manager（S37/R7）；`SetReadDeadline(35s)` + PongHandler 兜底半開連線；同一 node_name 第二條連線被拒（R7 鏡像保護）。

### 3.3 Manager → 前端瀏覽器 WS 事件（既有 `/api/v1/ws` hub 擴充）

| 訊息類型 | 方向 | 欄位 | 說明 |
|---------|------|------|------|
| node_status_changed | Server → Browser | `{id, name, status, message?}` | 上線/離線/長期離線/警告即時推送（S18/S20/S39/S50） |
| node_registry_changed | Server → Browser | `{action:"added"\|"removed", node}` | 節點增刪免重整（S13/S23/S51） |

---

## 4. 資料流

**① 代理操作（同步，步驟 3 / S06）**

```
Browser ──POST /api/v1/nodes/{id}/services/nginx.service/restart──▶ Manager handler
  → audit.log(action=restart, node_id) 先行記錄
  → nodeproxy.Call(method="services.restart", timeout=15s) ──rpc_request──▶ Agent WS
  → Agent 呼叫 internal/systemd.Restart ──rpc_response(ok/error)──▶ Manager
  → Handler 映射回應（200 / 503 / 409 / 504 / 透傳錯誤）──▶ Browser（Toast + 列狀態更新）
```

**② 心跳與匯總（非同步持續，S17/S18）**

```
Agent (每 10s) ──heartbeat{服務統計}──▶ nodeproxy.Hub ──▶ nodemonitor.OnHeartbeat
  → registry.ApplyHeartbeat（記憶體，不落盤）
  → 狀態變化時 publish(status_event) ──▶ 前端 hub 廣播 node_status_changed
Browser Aggregate 模式 GET /nodes/summary → 由各節點最後心跳統計組成（不做本地服務快取）
```

**③ 跨節點搜尋（平行聚合，步驟 7 / S24/S33）**

```
Browser(debounce 300ms) ──GET /nodes/services/search?q=nginx──▶ Manager
  → errgroup 對所有 online 節點並行 CallQuery("services.search", 10s 總逾時)
  → 可達節點結果彙入 results；離線/逾時節點列入 unreachable（不阻塞）
  → 10s 到期或全部完成即回應 ──▶ Browser（NodeSearchResults 渲染）
```

**④ 註冊與上線（步驟 4–6 / 流程 3.3）**

```
管理員 ──POST /nodes（或 test-connection 先行驗證）──▶ registry.Add（唯一性/上限/persist）
  → Agent（已部署）outbound 撥號 ──register──▶ Hub 比對 node_name
  → monitor.OnConnect → 狀態 online → node_status_changed 廣播 → UI 🟢
  → 不可達：節點仍儲存、狀態 offline，Agent 日後撥上自動轉 online
```

**⑤ 持久化**

```
registry CRUD ──atomic write(temp+rename, 0600)──▶ /var/lib/linux-service-manager/nodes.json
last_heartbeat / status 等 runtime state ──▶ 僅記憶體（重啟後由 Agent 重連刷新）
```

---

## 5. 生命週期（Agent 連線與心跳狀態機）

### 5.1 Agent 連線生命週期

| 階段 | 觸發 | 動作 | 退出條件 |
|------|------|------|---------|
| 部署啟動 | systemctl start linux-service-agent | 讀設定檔（manager_addr/auth_token/node_name）→ 建 Client.Run | process 結束 |
| 撥號 | Client.Run / 重連迴圈 | `wss://…/api/v1/agent/ws?token=` TLS handshake + 指紋 pinning | 連上或 backoff 重試 |
| 重試退避 | 撥號失敗 | exponential backoff 1s×2 至上限 60s；Manager 恢復後自動連上 | 連線建立 |
| 註冊 | WS 連上 | 發送 register → 等 register_ack；compatible=false 記錄警告續跑 | ack 到期 → 斷線重來 |
| 運行 | ack ok | heartbeat ticker（10s）+ rpc dispatch + 高優先 send queue | WS 斷線 / ctx cancel |
| 斷線偵測 | 對端斷開或 35s read deadline 到期 | 通知 Manager 端 OnDisconnect；Agent 進入重連迴圈 | — |

### 5.2 Manager 端節點心跳狀態機

```
                 register / heartbeat（任意狀態）
   ┌──────────────────────────────────────────────┐
   ▼                                              │
online ──WS斷線 或 ≥30s無心跳──▶ offline ──≥300s無心跳──▶ long_offline
（🟢）                            （🔴）                  （⚫）
   ▲                              │                      │
   └────── 寬限期內/外，收到心跳皆恢復 ◀────────────────────┘
            （恢復時發布 node_status_changed + Toast）
```

| 狀態 | 進入條件 | 附帶行為 | 退出條件 |
|------|---------|---------|---------|
| online 🟢 | register/heartbeat 收到 | 正常操作可用 | WS 斷線（立即）或 ≥30s 無心跳 |
| warning 🟡 | register_ack 相容性檢查失敗 | 操作仍可用；Tooltip 提示升級 | Agent 升級後重新註冊 |
| offline 🔴 | WS 斷線或 ≥30s（3×心跳）無心跳 | 廣播事件、UI 禁用操作+Banner | 收到心跳 → online |
| long_offline ⚫ | offline 持續 ≥300s | 卡片摺疊/置底；離線面板可開 | 收到心跳 → online |
| 啟動寬限期 | Manager 剛啟動 30s 內 | Monitor 掃描跳過，不觸發任何離線事件（R6） | 30s 期滿恢復正常掃描 |

逾時兜底：WS 層 `SetReadDeadline(35s)` + PongHandler 處理半開連線；RPC 層操作 15s／查詢 10s 逾時確保前端不會永久 loading。

---

## 6. 邊界條件處理

| 情境 | 來源 | 處理方式 |
|------|------|---------|
| 尚無任何註冊節點 | BDD S02 @edge-case | Aggregate Dashboard 顯示 EmptyState「尚無已註冊節點，請先新增節點」+ 前往 /nodes 引導連結 |
| 測試連線失敗（connection refused） | S12 @edge-case | test-connection 回 `{ok:false,error}`；Modal 保持開啟可修改重試 |
| 測試連線 TLS 憑證過期 / 指紋不符 | S34 @edge-case | DialTLS 錯誤分類 "certificate expired" / "fingerprint mismatch" 透傳至表單紅色提示 |
| 註冊時 Agent 不可達 | S14 @edge-case | 節點照常儲存（201），status=offline，Toast「已註冊但無法連線」；Agent 撥上後自動轉 online |
| 必填欄位缺失 | S40 @edge-case | 前端攔截紅色提示不發請求；後端 400 `{"error":"name and address are required"}` 雙保險 |
| 節點名稱重複 | S38 @edge-case | 後端 409 ErrDuplicateName；前端 Toast「節點名稱重複，請使用不同名稱」，表單保留 |
| 節點數達上限 50 台 | S41 / 規則 B1 | registry.Add 回 ErrMaxNodes → 400 `{"error":"maximum of 50 nodes"}` |
| 同節點同服務並行操作 | S09 / 規則 B4 | nodeproxy singleflight：in-flight 期間同 key 回 409；不同節點/不同服務不受影響 |
| 服務操作逾時 15s | S32 / 異常 R3 | rpc timeout → 504；前端 Toast「[Node] 操作逾時：{svc} {action}」，按鈕復原可重試 |
| 跨節點搜尋部分節點失敗 | S33 / 異常 R4 | 離線/逾時節點列入 `unreachable` 標示「無法查詢」，其餘結果先回不阻塞（errgroup 10s 總逾時） |
| 搜尋無匹配結果 | S26 @edge-case | 回 200 空 results；UI「沒有找到匹配的服務」 |
| 關閉搜尋結果 | S27 @edge-case | 清除 searchResults 返回 Node Cards 網格 |
| Agent 服務掛掉（心跳中斷） | S29 / 異常 R1 | WS 斷線立即 offline；UI 全套禁用反應；Agent 重啟重連後自動恢復 + Toast |
| 網路中斷於寬限期內/外恢復 | S30/S31 / R2 | 寬限期內恢復 → 無縫回 online；超過 300s → 曾標 long_offline，重連後回 online 需管理員確認 |
| Manager 重啟（所有 Agent 斷線） | S36 / 異常 R6 | nodes.json 設定保留；啟動寬限期 30s 內不觸發離線通知；Agent backoff 重連自動恢復 |
| 同一 Agent 被第二個 Manager 連線 | S37 / 異常 R7 | Agent 端以 auth_token 驗證 Manager 身分，token 不符 → 401 拒絕升級；Manager 端同 node_name 第二條連線亦拒絕 |
| Agent 版本不相容 | S39 / 異常 R9 | register 時比對 min_version；compatible=false → 節點 🟡 + Tooltip「Agent 版本過舊 (vX)，建議升級」；可下載新版 binary |
| 已註冊節點憑證過期 | S35 / 異常 R5 | 連線失敗 → 節點 offline；更新憑證 + Manager 端 PUT 指紋後 reconnect 恢復 |
| nodes.json 損毀 | SYS-REG-11（測試計畫） | LoadRegistry 回 ErrInvalidJSON，Manager 報錯退出（不靜默重建，避免吞掉 50 台設定） |
| WS 半開連線誤判線上 | Tech Decision 風險表 | read deadline 35s + PongHandler；RPC 15s 逾時兜底 |
| nodes.json 含 token 明碼 | Tech Decision 風險表 | 檔案權限 0600；部署文件標註；未來可改 secret ref |
| 單一 WS 承載心跳+RPC 塞住 | Tech Decision 風險表 | 心跳走高優先 send queue；logs 大 payload 不走 rpc（日誌經代理 REST 查詢） |

---

## 7. CSS 關鍵樣式

| class | 樣式重點 |
|-------|---------|
| `.node-card` | 卡片網格項目：圓角、邊框、hover 提亮；`display:flex; flex-direction:column; gap` |
| `.node-dot` / `.node-dot--online` | 8px 圓點 🟢 `background:#34c759` |
| `.node-dot--warning` | 🟡 `background:#f0a030`；搭配 `.node-card__warn` Tooltip（`:hover::after` 顯示 versionMessage） |
| `.node-dot--offline` | 🔴 `background:#e02020` |
| `.node-dot--long_offline` | ⚫ `background:#666` |
| `.node-card--collapsed` | 長期離線摺疊：`opacity:.55`；網格排序置底（JS 排序，非 CSS order hack） |
| `.node-card__stats.is-muted` | 離線時服務統計灰顯 `color: var(--text-muted)` |
| `.node-banner--offline` | 單節點離線黃色 Banner：`background:#fff3cd; border-left:4px solid #f0a030`，置於服務列表上方 |
| `.node-switcher__select` | Header 下拉：含狀態指示燈 emoji 前前綴；寬度自適應節點名 |
| `.node-form__field.has-error` | 必填缺失紅框 + `.node-form__error` 紅字提示 |
| `.node-form__result--ok` | 測試連線成功綠色提示 `color:#2e7d32; background:#e8f5e9` |
| `.node-form__result--error` | 測試連線失敗紅色提示 `color:#c62828; background:#fff0f0` |
| `.node-summary-bar` | 頂部統計列：橫向 flex，數字大字級 + 標籤小字級（複用 StatsBar 模式） |
| `.node-search-results` | 搜尋結果列表：列 hover 提亮、unreachable 列 `.is-unreachable` 加灰色斜體「無法查詢」標籤 |

---

## 8. 開發順序

| 步驟 | 內容 | 依賴 |
|------|------|------|
| 1 | `internal/agentproto`：wire protocol 型別 + 常數 + 單元測試 | - |
| 2 | `main.go` 遷移至 `cmd/manager/main.go`（行為不變，CI/E2E 路徑同步調整） | - |
| 3 | `internal/noderegistry`：Node/Registry CRUD、唯一性、50 台上限、nodes.json atomic write + SYS-REG-* 測試 | #1（部分型別） |
| 4 | `internal/nodeproxy/tls.go`：DialTLS 指紋 pinning + SYS-TLS-* 測試 | #1 |
| 5 | `internal/nodemonitor`：狀態機 + fake clock + SYS-MON-* 測試 | #3 |
| 6 | `internal/nodeproxy/hub.go + rpc.go + search.go`：Agent hub、WS RPC、singleflight、errgroup 搜尋 + SYS-PF-/SRCH-* 測試 | #1, #3, #4, #5 |
| 7 | `internal/agentclient`：撥號/backoff/register/heartbeat/dispatch + SYS-AC-* 測試 | #1, #4 |
| 8 | `internal/agentapi` + `cmd/agent/main.go`：Agent 本機 API 與入口 | #7 |
| 9 | `internal/handler/nodes_handler.go` + route 掛載 + audit 欄位擴充 + HDL-* 測試 | #3, #5, #6 |
| 10 | `internal/websocket/hub.go` 擴充 node.* 事件廣播 | #5, #9 |
| 11 | 整合測試 harness（多進程 + 加速環境變數 §6.1 + TLS 測試 helper）：INT-* 系列 | #8, #9, #10 |
| 12 | 前端 `types/node.ts` + `api/client.ts` 函式群 | #9（合約凍結後即可平行開始） |
| 13 | 前端 `stores/node.ts` + `useWebSocket` node.* 處理 + Vitest | #12 |
| 14 | 前端元件：NodeSummaryBar、NodeCard、NodeSwitcher + Vitest | #13 |
| 15 | 前端 NodeFormModal、NodeManagementView、NodeDetailPanel + router /nodes + Vitest（参照 `docs/uiux/014-node-management-design.md`） | #14 |
| 16 | DashboardView 視圖分流 + 單節點服務操作/離線禁用整合 + Vitest | #14, #15 |
| 17 | Playwright E2E（globalSetup 多進程拓撲）：E2E-01～E2E-34 | #11, #16 |
| 18 | Makefile build-agent targets、deploy/（agent systemd unit + 設定範例）、手動驗證 MAN-01～09 | #8, #17 |

依賴為 DAG（#12 起前端與 #11 整合測試可平行）。關鍵路徑：1→3→5→6→9→11→17。

---

## 9. 基礎架構設定

**Nginx（Manager 反向代理，WebSocket upgrade）**

```nginx
location /api/v1/agent/ws {
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header X-Real-IP $remote_addr;
    proxy_read_timeout 120s;   # 需 > WS read deadline 35s，避免 idle 斷線抖動
    proxy_send_timeout 120s;
}
# 其餘 /api/v1/ 比照既有設定；前端 SPA fallback 不變
```

**systemd**

- `linux-service-manager.service`（既有 Manager）：確保 `StateDirectory=linux-service-manager`（自動建立 `/var/lib/linux-service-manager`，nodes.json 由 app 以 0600 寫入）
- `linux-service-agent.service`（新增，部署於各被控端）：

```ini
[Unit]
Description=Linux Service Manager Agent
After=network-online.target
[Service]
ExecStart=/usr/local/bin/linux-service-agent --config /etc/linux-service-manager/agent.json
Restart=always
RestartSec=2
DynamicUser=no
[Install]
WantedBy=multi-user.target
```

**Agent 設定檔（`/etc/linux-service-manager/agent.json`）**

```json
{
  "manager_addr": "manager.example.com:8443",
  "auth_token": "<token>",
  "node_name": "web-server-01",
  "heartbeat_interval_seconds": 10,
  "listen_addr": "127.0.0.1:8443",
  "tls_cert": "/etc/linux-service-manager/agent.crt",
  "tls_key": "/etc/linux-service-manager/agent.key"
}
```

**環境變數（生產預設／測試加速，測試計畫 §6.1）**

| 變數 | 生產預設 | 測試建議 |
|------|---------|---------|
| AGENT_HEARTBEAT_INTERVAL | 10s | 200ms |
| MANAGER_OFFLINE_THRESHOLD | 30s | 600ms |
| MANAGER_LONG_OFFLINE_THRESHOLD | 300s | 3s |
| MANAGER_MONITOR_TICK | 5s | 200ms |
| MANAGER_STARTUP_GRACE | 30s | 2s |
| MANAGER_RPC_TIMEOUT_ACTION | 15s | 800ms |
| MANAGER_RPC_TIMEOUT_QUERY | 10s | 1s |
| MANAGER_WS_READ_DEADLINE | 35s | 700ms |
| NODES_FILE_PATH | /var/lib/linux-service-manager/nodes.json | 臨時路徑（測試） |
| AGENT_BINARY_DIR | /var/lib/linux-service-manager/agents | — |

**建置（Makefile）**

```makefile
build-manager:
	go build -o bin/linux-service-manager ./cmd/manager
build-agent: ## linux/amd64 + linux/arm64
	GOOS=linux GOARCH=amd64 go build -o bin/agent-linux-amd64 ./cmd/agent
	GOOS=linux GOARCH=arm64 go build -o bin/agent-linux-arm64 ./cmd/agent
```

---

## 附錄：BDD Scenario 對應追溯（S01–S51）

| BDD | 對應章節 |
|-----|---------|
| S01–S02 | §2.10 Aggregate 模式、§3.1 summary、§7 `.node-summary-bar` |
| S03–S05 | §2.10 視圖分流、§2.7 NodeSwitcher、§3.1 `GET /nodes/{id}/services` |
| S06–S09 | §3.1 proxy endpoints、§1.6.2 singleflight、§2.10 單節點操作 |
| S10–S16 | §2.8 NodeFormModal、§2.9 NodeManagementView、§3.1 test-connection / agent-binary |
| S17 | §1.7 agentclient、§5.1 生命週期、§3.2 register/heartbeat |
| S18–S23 | §5.2 狀態機、§2.6 NodeCard、§2.10 離線禁用/Banner、§3.1 DELETE、§2.11 |
| S24–S27 | §1.6.3 SearchServices、§2.11 NodeSearchResults |
| S28 | §3.1 `GET /nodes/{id}/info`、§2.6 detail emit |
| S29–S37 | §6 邊界條件（R1–R7 各列） |
| S38–S41 | §6（重複名稱/版本/必填/上限）、§1.4 ErrDuplicateName/ErrMaxNodes |
| S42–S45 | §1.5 Config 閾值、§1.6.4 TLS、§1.7 backoff、§1.6.2 不快取即時代理 |
| S46–S49 | §6（否定性：無跨節點編排入口）、§1.10 audit node_id、§1.4 persist、§1.6.1 token 反向認證 |
| S50–S51 | §3.3 前端 WS 事件、§2.5 useWebSocket、§2.4 applyRegistryChanged |

---

*最後更新：2025-08-25*

**📋 修訂（2025-08-25）**：新增 Node Management 頁面 UI/UX 設計（`docs/uiux/014-node-management-design.md`），§2.8–2.9 前端元件規格已更新，包含完整的 Modal 狀態管理、搜尋篩選、下載 Agent 下拉選單、空狀態處理。
