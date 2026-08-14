package handler

// search_handler.go — 跨節點搜尋 fan-out（決策 9）
// docs/development/014 §1.9.3

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"linux-service-manager/internal/nodes"
)

// maxSearchConcurrency 是 fan-out 並行上限（semaphore，決策 9）。
const maxSearchConcurrency = 10

// searchTimeout 是跨節點搜尋總預算（context，BDD @edge-case @timeout）。
const searchTimeout = 10 * time.Second

// SearchResultItem 是單一匹配結果。
type SearchResultItem struct {
	NodeID   string `json:"node_id"`
	NodeName string `json:"node_name"`
	Service  string `json:"service"`
	Active   string `json:"active"`
	Sub      string `json:"sub"`
}

// FailedNode 是查詢失敗的節點（部分失敗語意，決策 9）。
type FailedNode struct {
	NodeID   string `json:"node_id"`
	NodeName string `json:"node_name"`
	Reason   string `json:"reason"` // offline / timeout / error
}

// searchServiceEntry 是 Agent 回傳的服務項目（僅取搜尋結果需要的欄位）。
type searchServiceEntry struct {
	Name   string `json:"name"`
	Active string `json:"active"`
	Sub    string `json:"sub"`
}

// HandleSearchServices — GET /api/v1/nodes/services/search?q=
// 流程（決策 9）：
//  1. q 空白 → 400（缺少查詢字串）
//  2. 僅取 status ∈ {online, degraded, warning} 的節點（離線節點不查詢、直接列 failed_nodes reason=offline）
//  3. goroutine fan-out：每節點一 goroutine、semaphore 上限 10、總 context 10s
//     — 節點內匹配由 Agent 端做（GET /api/v1/services?q= substring 過濾），Manager 只彙總
//  4. 結果經 channel 收集；單節點失敗（offline/timeout）不阻塞其他節點（部分結果先回）
//  5. 200 {results:[...], failed_nodes:[...]}
func (h *Handler) HandleSearchServices(w http.ResponseWriter, r *http.Request) {
	if h.Nodes == nil {
		writeJSON(w, http.StatusInternalServerError, messageJSON{Error: "nodes module not initialized"})
		return
	}

	q := r.URL.Query().Get("q")
	if strings.TrimSpace(q) == "" {
		writeJSON(w, http.StatusBadRequest, messageJSON{Error: "query parameter q is required"})
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), searchTimeout)
	defer cancel()

	// 分類：可達節點查詢 / 離線節點直接列 failed（不阻塞）
	var queryNodes []*nodes.Node
	var failed []FailedNode
	for _, n := range h.Nodes.Registry.List() {
		if isReachable(n.Status) {
			queryNodes = append(queryNodes, n)
		} else {
			failed = append(failed, FailedNode{NodeID: n.ID, NodeName: n.Name, Reason: "offline"})
		}
	}

	var (
		wg      sync.WaitGroup
		mu      sync.Mutex
		results []SearchResultItem
	)
	sem := make(chan struct{}, maxSearchConcurrency)
	agentPath := "/api/v1/services?q=" + url.QueryEscape(q)

	for _, n := range queryNodes {
		wg.Add(1)
		go func(n *nodes.Node) {
			defer wg.Done()

			select {
			case sem <- struct{}{}:
				defer func() { <-sem }()
			case <-ctx.Done():
				// 總預算耗盡 → 標記 timeout（部分結果語意）
				mu.Lock()
				failed = append(failed, FailedNode{NodeID: n.ID, NodeName: n.Name, Reason: "timeout"})
				mu.Unlock()
				return
			}

			code, body, err := h.Nodes.Client.Do(ctx, n, http.MethodGet, agentPath, nil)
			if err != nil {
				mu.Lock()
				failed = append(failed, FailedNode{NodeID: n.ID, NodeName: n.Name, Reason: searchFailureReason(err)})
				mu.Unlock()
				return
			}
			if code != http.StatusOK {
				mu.Lock()
				failed = append(failed, FailedNode{NodeID: n.ID, NodeName: n.Name, Reason: "error"})
				mu.Unlock()
				return
			}

			var services []searchServiceEntry
			if err := json.Unmarshal(body, &services); err != nil {
				mu.Lock()
				failed = append(failed, FailedNode{NodeID: n.ID, NodeName: n.Name, Reason: "error"})
				mu.Unlock()
				return
			}

			mu.Lock()
			for _, s := range services {
				results = append(results, SearchResultItem{
					NodeID:   n.ID,
					NodeName: n.Name,
					Service:  s.Name,
					Active:   s.Active,
					Sub:      s.Sub,
				})
			}
			mu.Unlock()
		}(n)
	}

	wg.Wait()

	if results == nil {
		results = []SearchResultItem{}
	}
	if failed == nil {
		failed = []FailedNode{}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"results":      results,
		"failed_nodes": failed,
	})
}

// searchFailureReason 將 AgentClient 錯誤分類為 failed_nodes 的 reason。
func searchFailureReason(err error) string {
	var tErr *nodes.NodeTimeoutError
	if errors.As(err, &tErr) {
		return "timeout"
	}
	var offErr *nodes.NodeOfflineError
	if errors.As(err, &offErr) {
		return "offline"
	}
	return "error"
}
