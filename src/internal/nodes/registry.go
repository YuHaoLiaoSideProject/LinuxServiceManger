// Package nodes implements multi-node agent management (registry, heartbeat,
// supervisor state machine and the Agent HTTP client) for the Manager side.
package nodes

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// ServiceStats 是心跳附帶的服務統計（Aggregate 摘要資料來源，決策 3）。
type ServiceStats struct {
	Total  int `json:"total"`
	Active int `json:"active"`
	Failed int `json:"failed"`
}

// Status 是節點狀態字串（決策 3 狀態機輸出）。
type Status string

const (
	StatusOnline      Status = "online"       // 🟢 age < 10s
	StatusDegraded    Status = "degraded"     // 🟡 10s ≤ age < 30s
	StatusOffline     Status = "offline"      // 🔴 30s ≤ age < 300s
	StatusLongOffline Status = "long_offline" // ⚫ age ≥ 300s
	StatusWarning     Status = "warning"      // 🟡 版本不相容（優先判定，不阻斷）
)

// MaxNodes 是單 Manager 節點數上限（BDD @node-limit）。
const MaxNodes = 50

// 錯誤定義（handler 層映射 HTTP 狀態碼）。
var (
	// ErrDuplicateName 表示節點名稱已存在（handler 映射 409）。
	ErrDuplicateName = errors.New("node name already exists")
	// ErrNodeLimit 表示節點數已達上限（handler 映射 400/409）。
	ErrNodeLimit = errors.New("node limit reached")
	// ErrNodeNotFound 表示節點不存在（handler 映射 404）。
	ErrNodeNotFound = errors.New("node not found")
)

// Node 是一筆節點設定（決策 4 資料模型）。
type Node struct {
	ID             string       `json:"id"`                        // UUID（crypto/rand）
	Name           string       `json:"name"`                      // 唯一（註冊時檢查重複 → 409）
	Address        string       `json:"address"`                   // host:port
	TLSFingerprint string       `json:"tls_fingerprint,omitempty"` // SHA-256 指紋（選填，mTLS/自簽 pin）
	Token          string       `json:"token"`                     // 共享 secret lsm_node_…；API 回應回 masked
	Notes          string       `json:"notes,omitempty"`
	Status         Status       `json:"status"`                   // 由 supervisor 更新
	LastHeartbeat  string       `json:"last_heartbeat,omitempty"` // RFC3339 UTC
	AgentVersion   string       `json:"agent_version,omitempty"`
	Hostname       string       `json:"hostname,omitempty"`
	OS             string       `json:"os,omitempty"`
	ServiceStats   ServiceStats `json:"service_stats"` // 心跳附帶
	CreatedAt      string       `json:"created_at"`    // RFC3339 UTC
	UpdatedAt      string       `json:"updated_at"`
}

// Registry 管理 nodes.json 的載入/atomic save/CRUD，全以 RWMutex 保護（仿 token.Store）。
type Registry struct {
	mu       sync.RWMutex
	filePath string
	nodes    map[string]*Node  // key = ID
	byName   map[string]string // name → ID（唯一性查詢）
}

// NewRegistry 建立 Registry（不載入；呼叫端需先 Load）。
func NewRegistry(filePath string) *Registry {
	return &Registry{
		filePath: filePath,
		nodes:    make(map[string]*Node),
		byName:   make(map[string]string),
	}
}

// Load 讀取 nodes.json；檔案不存在 → 空 map（不 crash，仿 token.Store.Load）。
func (r *Registry) Load() error {
	r.mu.Lock()
	defer r.mu.Unlock()

	data, err := os.ReadFile(r.filePath)
	if os.IsNotExist(err) {
		r.nodes = make(map[string]*Node)
		r.byName = make(map[string]string)
		return nil
	}
	if err != nil {
		return fmt.Errorf("failed to read node registry: %w", err)
	}
	if len(data) == 0 {
		r.nodes = make(map[string]*Node)
		r.byName = make(map[string]string)
		return nil
	}

	nodes := make(map[string]*Node)
	if err := json.Unmarshal(data, &nodes); err != nil {
		// 仿 token.Store：解析失敗 → 空 map，不 crash（下次 save 覆寫）
		log.Printf("nodes: failed to parse registry, starting with empty map: %v", err)
		r.nodes = make(map[string]*Node)
		r.byName = make(map[string]string)
		return nil
	}

	// 重建 byName map（SYS-01：Load 後 GetByName 可用）
	byName := make(map[string]string, len(nodes))
	for id, n := range nodes {
		if n == nil {
			continue
		}
		if n.ID == "" {
			n.ID = id
		}
		if n.Name != "" {
			byName[n.Name] = id
		}
	}
	r.nodes = nodes
	r.byName = byName
	return nil
}

// save 以 temp + fsync + os.Rename atomic write 寫入（0600，仿 token.Store.save）。
func (r *Registry) save() error {
	data, err := json.MarshalIndent(r.nodes, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal node registry: %w", err)
	}

	// 確保父目錄存在
	if dir := filepath.Dir(r.filePath); dir != "" && dir != "." {
		if err := os.MkdirAll(dir, 0755); err != nil {
			return fmt.Errorf("failed to create directory %s: %w", dir, err)
		}
	}

	// Atomic write: temp file + rename（0600 — token 含於檔內）
	tmpPath := r.filePath + ".tmp"
	if err := os.WriteFile(tmpPath, data, 0600); err != nil {
		return err
	}
	return os.Rename(tmpPath, r.filePath)
}

// List 回傳所有節點（副本）。
func (r *Registry) List() []*Node {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make([]*Node, 0, len(r.nodes))
	for _, n := range r.nodes {
		if n == nil {
			continue
		}
		cp := *n
		out = append(out, &cp)
	}
	return out
}

// Get 依 ID 取得節點；不存在回 nil。
func (r *Registry) Get(id string) *Node {
	r.mu.RLock()
	defer r.mu.RUnlock()
	n, ok := r.nodes[id]
	if !ok || n == nil {
		return nil
	}
	cp := *n
	return &cp
}

// GetByName 依 Name 取得節點（心跳比對用）；不存在回 nil。
func (r *Registry) GetByName(name string) *Node {
	r.mu.RLock()
	defer r.mu.RUnlock()
	id, ok := r.byName[name]
	if !ok {
		return nil
	}
	n, ok := r.nodes[id]
	if !ok || n == nil {
		return nil
	}
	cp := *n
	return &cp
}

// Count 回傳節點總數（50 上限檢查用）。
func (r *Registry) Count() int {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return len(r.nodes)
}

// Create 建立節點：產生 UUID（crypto/rand）、token（lsm_node_ + 長隨機）、created_at/updated_at（RFC3339 UTC）。
// 名稱重複 → ErrDuplicateName；Count() ≥ MaxNodes → ErrNodeLimit。成功後 save()。
func (r *Registry) Create(n *Node) (*Node, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	if len(r.nodes) >= MaxNodes {
		return nil, ErrNodeLimit
	}
	if n == nil {
		return nil, fmt.Errorf("node is nil")
	}
	if _, dup := r.byName[n.Name]; dup {
		return nil, ErrDuplicateName
	}

	now := nowUTC()
	node := &Node{
		ID:             newUUID(),
		Name:           n.Name,
		Address:        n.Address,
		TLSFingerprint: n.TLSFingerprint,
		Token:          n.Token,
		Notes:          n.Notes,
		Status:         StatusOffline, // 初始離線；由啟動健康檢查/心跳/狀態機更新
		ServiceStats:   n.ServiceStats,
		CreatedAt:      now,
		UpdatedAt:      now,
	}
	if node.Token == "" {
		node.Token = newToken()
	}

	r.nodes[node.ID] = node
	r.byName[node.Name] = node.ID
	if err := r.save(); err != nil {
		return nil, err
	}
	cp := *node
	return &cp, nil
}

// Update 更新節點設定：token 留空表示不變更（決策 5 風險緩解）、updated_at 刷新。成功後 save()。
func (r *Registry) Update(id string, patch *Node) (*Node, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	n, ok := r.nodes[id]
	if !ok || n == nil {
		return nil, ErrNodeNotFound
	}
	if patch == nil {
		return nil, fmt.Errorf("patch is nil")
	}

	if patch.Name != "" && patch.Name != n.Name {
		if _, dup := r.byName[patch.Name]; dup {
			return nil, ErrDuplicateName
		}
		delete(r.byName, n.Name)
		n.Name = patch.Name
		r.byName[n.Name] = id
	}
	if patch.Address != "" {
		n.Address = patch.Address
	}
	if patch.TLSFingerprint != "" {
		n.TLSFingerprint = patch.TLSFingerprint
	}
	if patch.Token != "" { // 留空表示不變更（編輯表單不回傳 token）
		n.Token = patch.Token
	}
	if patch.Notes != "" {
		n.Notes = patch.Notes
	}
	n.UpdatedAt = nowUTC()

	if err := r.save(); err != nil {
		return nil, err
	}
	cp := *n
	return &cp, nil
}

// Delete 移除節點；關聯 Audit Log 保留（audit 模組獨立，不隨節點刪除）。
func (r *Registry) Delete(id string) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	n, ok := r.nodes[id]
	if !ok || n == nil {
		return ErrNodeNotFound
	}
	delete(r.nodes, id)
	delete(r.byName, n.Name)
	return r.save()
}

// SetHeartbeat 更新心跳資訊：last_heartbeat=now、service_stats、agent_version/hostname/os。
// Status 不在此處修改（由 supervisor 下輪判定，決策 3）；不觸發 save（熱路徑零 IO）。
func (r *Registry) SetHeartbeat(nodeName string, hb Heartbeat) {
	r.mu.Lock()
	defer r.mu.Unlock()

	id, ok := r.byName[nodeName]
	if !ok {
		return
	}
	n := r.nodes[id]
	if n == nil {
		return
	}
	n.LastHeartbeat = nowUTC()
	n.ServiceStats = hb.Services
	if hb.AgentVersion != "" {
		n.AgentVersion = hb.AgentVersion
	}
	if hb.Hostname != "" {
		n.Hostname = hb.Hostname
	}
	if hb.OS != "" {
		n.OS = hb.OS
	}
}

// SetStatus 更新狀態（supervisor 呼叫）；狀態變更才 save。
func (r *Registry) SetStatus(id string, st Status) {
	r.mu.Lock()
	defer r.mu.Unlock()

	n, ok := r.nodes[id]
	if !ok || n == nil {
		return
	}
	if n.Status == st {
		return
	}
	n.Status = st
	n.UpdatedAt = nowUTC()
	_ = r.save() // save 失敗僅記錄（狀態仍在記憶體生效）
}

// VerifyToken 比對 node_name + Bearer token（心跳 middleware 用）。
func (r *Registry) VerifyToken(nodeName, token string) bool {
	if nodeName == "" || token == "" {
		return false
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	id, ok := r.byName[nodeName]
	if !ok {
		return false
	}
	n, ok := r.nodes[id]
	if !ok || n == nil {
		return false
	}
	return n.Token == token
}

// MaskToken 將 token 遮罩為 "lsm_node_****xxxx"（API 回應用，決策 5 風險緩解）。
func MaskToken(token string) string {
	if token == "" {
		return ""
	}
	const prefix = "lsm_node_"
	if !strings.HasPrefix(token, prefix) {
		return "****"
	}
	tail := strings.TrimPrefix(token, prefix)
	if len(tail) > 4 {
		tail = tail[len(tail)-4:]
	}
	return prefix + "****" + tail
}

// nowUTC 回傳 RFC3339 UTC（含小數秒，確保同秒內 create/update 可辨識）。
func nowUTC() string {
	return time.Now().UTC().Format(time.RFC3339Nano)
}

// newUUID 產生 crypto/rand 型 v4 UUID。
func newUUID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		// crypto/rand 失敗極罕見；fallback 以時間戳保證非空
		return fmt.Sprintf("node-%d", time.Now().UnixNano())
	}
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

// newToken 產生 "lsm_node_" + 長隨機（48 hex chars）。
func newToken() string {
	b := make([]byte, 24)
	if _, err := rand.Read(b); err != nil {
		return "lsm_node_" + fmt.Sprintf("%d", time.Now().UnixNano())
	}
	return "lsm_node_" + hex.EncodeToString(b)
}
