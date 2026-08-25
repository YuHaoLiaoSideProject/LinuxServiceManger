# 開發方案決策文件：多機管理 Agent 模式

## 📌 決策摘要

| 項目 | 內容 |
|------|------|
| **最終方案** | Manager ↔ Agent 以 WebSocket 長連線通訊（重用 gorilla/websocket）+ 心跳推播 + Node Registry JSONL 持久化 + 單一 binary 以 build tag / 子命令區分 agent 模式 + chi API Proxy + 前端 Aggregate Dashboard |
| **決策日期** | 2025-08-24（2025-08-25 修訂：移除跨節點搜尋） |
| **對應 Roadmap** | Phase 4 — `docs/development/002-expansion-roadmap.md` 項目 #12 |
| **輸入文件** | `docs/bdds/014-multi-node-agent-management.feature`、`docs/interaction-flows/014-multi-node-agent-management.md`、`docs/test-plans/014-multi-node-agent-management測試計畫.md` |
| **共識程度** | ✅ 確認通過 |

---

## 1. 需求回顧

### 1.1 核心業務價值

從單機管理擴展到多機維運：一台主控面板（Manager）管理多台 Linux 機器的 systemd 服務。每台被控端執行輕量 Agent binary，主控端透過統一 Dashboard 監控所有節點健康狀態（Aggregate Dashboard）、切換節點操作服務。

> **📋 修訂（2025-08-25）**：UIUX 決策採「純節點切換」模式（`docs/uiux/014-multi-node-view-redesign.md`），**跨節點服務搜尋移出本功能範圍**，移入未來 backlog。相關內容標註 ⛔ REMOVED。

### 1.2 功能邊界

| 項目 | 範圍 |
|------|------|
| **Must Have (P0)** | Node Registry CRUD + test-connection、Agent 心跳上報與離線偵測（30s 離線 / 300s 長期離線）、API Proxy（services 操作/logs/info）、Aggregate Dashboard、單節點視圖切換（URL `?node={id}`）、Node Management 頁面、TLS 通訊、Audit Log 記錄 node 資訊 |
| **Should Have (P1)** | mTLS 雙向驗證、Agent 版本相容性檢查（🟡 警告）、WebSocket 即時推送節點狀態變更、下載 Agent binary、啟動寬限期（Manager 重啟後 30s 不觸發離線通知）。~~跨節點服務搜尋~~ ⛔ REMOVED |
| **Nice to Have (P2)** | 節點資源指標（CPU/Memory，銜接 #13）、Agent binary 多架構自動偵測下載、長期離線節點卡片摺疊 |

### 1.3 既有基礎

- 後端已有 chi router + session auth middleware（`src/main.go`）
- 已有 gorilla/websocket 使用經驗（`internal/websocket/hub.go` 給前端推播、logs WS）
- systemd 操作模組（`internal/systemd`）可直接複用於 Agent
- audit 模組已用 JSONL 持久化（可沿用 registry 持久化模式）
- 前端已有 `stores/service.ts`、`composables/useWebSocket.ts`、`StatsBar.vue`、`EmptyState.vue`、`ConfirmModal.vue` 可複用

---

## 2. 關鍵技術決策

### 決策 1：Manager ↔ Agent 通訊方式

| 方案 | 描述 | 優點 | 缺點 |
|------|------|------|------|
| **A. WebSocket 長連線（選定）** | Agent 主動撥號連到 Manager 的 `/api/v1/agent/ws`，之後心跳與 RPC 訊息走同一條 WS | 專案已有 gorilla/websocket；Agent 在 NAT 後不需開 port（outbound-only）；連線即心跳（省額外 heartbeat channel）；雙向即時推送天然支援 | 需自設 RPC 協定（request id + method + payload） |
| B. gRPC stream | Agent ↔ Manager gRPC bidirectional streaming | 強型別 proto 合約、內建 reconnect/load-balance | 引入 protobuf/gRPC 大型依賴（CGO-free 但 binary 變大 ~10MB）、團隊無既有經驗、與現有 REST 技術棧斷裂 |
| C. Agent 開 HTTP server，Manager 輪詢 | Interaction Flow 表單中的「Agent 位址 host:port」模式，Manager 定期呼叫 `GET /health` | 實作直觀、test-connection 直接復用 | Agent 必須可被 Manager 直連（NAT/防火牆問題）；心跳需額外機制；每節點一個 port 管理負擔 |

> **決策**：方案 A。理由：(1) 重用 gorilla/websocket，零新依賴；(2) outbound-only 解決 NAT 環境部署痛點；(3) WS 連線本身可視為 liveness，心跳訊息同時攜帶服務統計摘要供 Aggregate Dashboard 使用。**但保留 C 的相容性**：node registry 仍記錄 `address` 欄位（host:port），作為 test-connection（直連 `GET /health`）與未來 fallback 用。

**WS 上自設輕量訊息協定**：

```json
// Agent → Manager
{"type": "register", "request_id": "...", "payload": {"node_name": "web-01", "hostname": "...", "version": "1.x", "os": "..."}}
{"type": "heartbeat", "request_id": "...", "payload": {"services_total": 42, "services_running": 40, "services_failed": 1}}
{"type": "rpc_response", "request_id": "<對應請求>", "ok": true, "payload": {...}}

// Manager → Agent
{"type": "register_ack", "request_id": "...", "ok": true, "payload": {"min_version": "1.2"}}
{"type": "rpc_request", "request_id": "...", "method": "services.list", "params": {...}}
{"type": "ping", ...}   // WS protocol-level ping 由 gorilla/websocket 處理
```

### 決策 2：心跳模型與離線偵測

| 方案 | 描述 | 優點 | 缺點 |
|------|------|------|------|
| **A. WS 連線狀態 + 心跳訊息雙軌（選定）** | WS 斷線 → 立即標示「離線」；連線中但 30 秒無 heartbeat 訊息 → 「離線」；300 秒無心跳 → 「長期離線」 | 反應快（斷線即知）；邏輯單純（單一 last_heartbeat 時間戳比較） | WS 異常半開連線需靠 read deadline 兜底 |
| B. 純時間戳輪詢掃描 | ticker 每 5s 掃描所有節點的 last_heartbeat | 實作最簡單 | 反應慢（最多延遲一個掃描週期） |

> **決策**：方案 A，並以 gorilla `SetReadDeadline(35s)` + `PongHandler` 兜底半開連線。實作要點：
> - `NodeMonitor` goroutine：ticker 5s 掃描 `lastHeartbeat`，超過 30s → `offline`，超過 300s → `long_offline`
> - Manager 啟動寬限期：啟動後 30s 內不觸發任何離線事件（Interaction Flow 異常處理 #6）
> - 狀態機：`online → offline → long_offline`，任意非 online 狀態收到 register/heartbeat → 回 `online` 併發 WebSocket 前端事件 `node.status_changed`
> - 心跳間隔 10s（Agent 端可設定），閾值 = 3 次未收到（30s）

### 決策 3：TLS / mTLS 憑證管理

| 方案 | 描述 | 優點 | 缺點 |
|------|------|------|------|
| **A. TLS + 憑證指紋 pinning（選定）** | 自簽憑證；registry 記錄 Agent 憑證 SHA-256 指紋，撥號時比對；mTLS 為可選（Manager 亦提供 client cert） | 不需 CA 基礎建設；pinning 防 MITM；UI 只需貼上一串指紋 | 憑證輪替需更新指紋 |
| B. 正式 CA 簽發憑證 | Let's Encrypt 或企業 CA | 標準驗證鏈 | 多機內網環境常無法 domain 驗證；運維負擔大 |

> **決策**：方案 A。實作：`tls.Config{InsecureSkipVerify: true}` + 自行在 `VerifyPeerCertificate` 比對指紋（空指紋欄位 = 跳過驗證，僅加密）。Token 放於 WS upgrade URL query（`?token=...`）或 header，Agent 端以設定檔 token 驗證 Manager 身分（反向認證）。mTLS 啟用時 Agent 另驗 Manager client cert。

### 決策 4：Agent Binary 形態

| 方案 | 描述 | 優點 | 缺點 |
|------|------|------|------|
| **A. 同一 module、獨立 main（選定）** | `src/cmd/agent/main.go` 獨立入口，共用 `internal/systemd`、新增 `internal/agentapi`（精簡 handler）與 `internal/agentclient`（WS 客戶端）；`src/main.go` 為 manager 入口。build tag 不需要 | Go 原生多 main 支援；import path 乾淨；agent build 不含 templates/embed 前端資源 | 目錄結構調整（main.go → cmd/manager/main.go） |
| B. 單一 binary + `-mode agent` 子命令 | 同一個 binary，flag 切換 | 發布只有一個檔案 | agent 版仍內嵌前端資源（除非 embed 加 build tag）；binary 變大 |
| C. 完全獨立 repo/module | agent 另開 repository | 最徹底解耦 | 共用 systemd 模組需 go replace 或 publish，維護成本高 |

> **決策**：方案 A。`go build ./cmd/manager` 與 `go build ./cmd/agent` 各產出一個 binary；agent 不 import templates/embed 套件，維持精簡（預估 < 8MB）。原 `src/main.go` 遷移至 `src/cmd/manager/main.go`，根目錄 Makefile 新增 `build-agent` target（linux/amd64 + linux/arm64）。**Agent 提供 JSON API**（與 Manager `/api/v1/services*` 相同合約，僅無前端與 audit UI），滿足「Agent 離線時本地操作仍可透過直接存取 Agent」的需求。

### 決策 5：Node Registry 持久化

| 方案 | 描述 | 優點 | 缺點 |
|------|------|------|------|
| **A. JSON Lines + 全量 rewrite 快照（選定）** | `nodes.jsonl` append 寫入，啟動時 replay；或直接維護 `nodes.json` 全量寫入（節點數 ≤ 50，寫入頻率低） | 與 audit 模組一致的模式；零依賴 | — |
| B. SQLite | 查詢快 | 引入新依賴，50 節點規模殺雞用牛刀 | |

> **決策**：方案 A（採單一 `nodes.json` 全量 JSON + atomic write via temp file + rename；registry 變更頻率遠低於 audit log，全量寫入最簡單且免 replay 邏輯）。路徑 `/var/lib/linux-service-manager/nodes.json`，權限 0600（內含 token）。mutex 保護 + 寫入 debounce（狀態變更不落盤，只有設定 CRUD 落盤——last_heartbeat 屬 runtime state，重啟後由 Agent 重連刷新）。

### 決策 6：API Proxy 與逾時策略

| 方案 | 描述 | 優點 | 缺點 |
|------|------|------|------|
| **A. Handler 層經 WS RPC 轉發（選定）** | `internal/nodeproxy` 提供 `Proxy(nodeID, method, params, timeout)`，透過 WS 送 rpc_request、等 rpc_response（per-request context timeout） | 與決策 1 一致；單一通道好管理 | 需 request-id ↔ pending map 管理 |
| B. net/http.ReverseProxy 直連 Agent address | 標準 reverse proxy | 幾乎零客製 | 依賴 Agent 開 port（與決策 1 outbound-only 矛盾） |

> **決策**：方案 A。逾時：服務操作 15s、查詢類 10s（~~跨節點搜尋總逾時 10s partial results~~ ⛔ REMOVED，隨搜尋功能移除）。並行限制：per node+service 的 singleflight（前一操作未完成時回 409，前端按鈕本就 disabled）。Agent 離線時 Proxy 立即回 `503 {"error":"node_offline"}`。

### 決策 7：前端 Aggregate Dashboard 整合方式

| 方案 | 描述 | 優點 | 缺點 |
|------|------|------|------|
| **A. 獨立 node store + 視圖路由分流（選定）** | 新增 `stores/node.ts`（節點列表/摘要/當前選取）；DashboardView 依 route query `?node={id}` 分流 Aggregate / Single-node 兩種呈現；service store 增加 `nodeId` scope | URL 即狀態（可分享/重新整理保留）；複用現有 ServiceTable/StatsBar | DashboardView 邏輯分支增加 |
| B. 獨立 AggregateDashboardView + 現有 DashboardView 並存 | 兩個 view | 各自單純 | 元件重複、切換時整頁重新載入 |

> **決策**：方案 A。`router` 保持 `/dashboard`，query `?node=` 有值 → 單節點模式（Header 顯示節點下拉 + 「所有節點」返回鈕）；無值 → Aggregate 模式（NodeCard 網格 + 總覽統計列）。新增元件：`NodeCard.vue`、`NodeSummaryBar.vue`、`NodeSwitcher.vue`、`NodeManagementView.vue`（路由 `/nodes`）、`NodeFormModal.vue`（含測試連線）。`useWebSocket.ts` 擴充處理 `node.status_changed` / `node.registry_changed` 事件。（~~跨節點搜尋~~ ⛔ REMOVED：不再實作 fan-out 查詢與結果列表。）

---

## 3. 架構總覽

```
┌─────────────────────────────── Manager (cmd/manager) ───────────────────────────────┐
│  Vue SPA ──HTTP──▶ chi router                                                       │
│                     ├─ /api/v1/auth/*            (既有 session auth)                 │
│                     ├─ /api/v1/services/*        (本機 systemd，既有)                │
│                     ├─ /api/v1/nodes/*           (★ 新增：registry + proxy)   │
│                     └─ /api/v1/agent/ws          (★ 新增：Agent WS endpoint)         │
│                                                                                     │
│  internal/noderegistry ── nodes.json 持久化                                          │
│  internal/nodemonitor ── 心跳掃描 / 狀態機 / 寬限期                                   │
│  internal/nodeproxy ── WS RPC 轉發 + 逾時 + singleflight                              │
│  internal/websocket/hub ── 前端推播 (擴充 node.* 事件)                                │
└───────────────▲──────────────────────────────▲──────────────────────────────────────┘
       WS (TLS, outbound)              WS (TLS, outbound)
       │  register/heartbeat/rpc       │
┌──────┴────────┐              ┌────────┴──────┐
│ Agent (cmd/agent)             │ Agent ...
│ ├ agentclient (WS 撥號+重連)   │
│ ├ agentapi (JSON API, 本機直連)│
│ └ systemd (共用模組)           │
└───────────────┘              └───────────────┘
```

---

## 4. 取捨風險登錄

| 風險 | 影響 | 緩解 |
|------|------|------|
| WS 半開連線誤判線上 | 節點顯示線上但操作失敗 | read deadline 35s + PongHandler；Proxy 逾時 15s 兜底 |
| nodes.json 含 token 明碼 | 洩漏風險 | 權限 0600；文件標註；未來可改 secret ref |
| 單一 WS 承載心跳+RPC | 大量日誌/查詢塞住心跳 | 心跳訊息走獨立 send queue 高優先級；日誌類查詢限制 payload 大小（logs 走既有 WS logs 模式由前端直連代理路徑） |
| 50 節點上限突破 | Manager 負載 | 文件明定上限 50；registry 寫入時拒絕第 51 台（回 400） |
| Agent 版本不相容 | RPC 行為不一致 | register 時比對 semver min_version，不符 → 🟡 狀態 + Tooltip |

---

## 5. 下游文件

- 開發規格書：`docs/development/014-multi-node-agent-management.md`
- 操作流程：`docs/interaction-flows/014-multi-node-agent-management.md`
- 測試計畫：`docs/test-plans/014-multi-node-agent-management測試計畫.md`

---

*最後更新：2025-08-24*
