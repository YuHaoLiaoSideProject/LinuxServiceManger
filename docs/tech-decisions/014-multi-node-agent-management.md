# 開發方案決策文件：多機管理 Agent 模式（multi-node-agent-management）

## 📌 決策摘要

| 項目 | 內容 |
|------|------|
| **最終方案** | Manager ↔ Agent 以 **HTTPS REST** 通訊（**零新依賴**，沿用 chi + writeJSON 既有 pattern）；Agent 為**短連線 + 10 秒心跳 POST** 模型（應用層無狀態、傳輸層靠連線池 keep-alive）；Manager 端新增 `internal/nodes/` 模組（registry 存 `nodes.json` atomic write + 心跳接收 + supervisor 狀態機）；認證採 **Token 為主、mTLS 憑證指紋為可選強化**（每節點可獨立啟用）；API Proxy 採**逐 route 顯式代理**（內層共用 `AgentClient`，操作逾時 15s、跨節點查詢 10s、部分結果先回）；Agent 為**同 module 第二個 entry point**（`src/cmd/agent/`，共享 `internal/systemd`，不內嵌前端）；前端新增 Aggregate Dashboard（`/`）、Node Management（`/nodes`）、node-aware 單節點視圖（`/dashboard?node=`），新增 `stores/nodes.ts` + `NodeSwitcher.vue` |
| **決策日期** | 2026-08-13 |
| **對應 Roadmap** | Phase 4 — `docs/development/002-expansion-roadmap.md` 項目 #12（多機管理 Agent 模式） |
| **輸入文件** | `docs/interaction-flows/014-multi-node-agent-management.md`（BDD 尚未產生，以 interaction flow 為主） |
| **共識程度** | ✅ 確認通過（非互動模式推導） |

---

## 1. 需求回顧

### 1.1 核心業務價值

從「單機管理」擴充為「多機維運」：一台主控面板（Manager）透過統一 Dashboard 監控多台 Linux 機器（Agent）的 systemd 服務，包含節點健康狀態一覽、節點切換操作、跨節點服務搜尋。不需在每台機器分別開啟管理介面，同一操作介面即可掌握整個基礎設施的服務狀態，大幅降低分散環境的管理負擔。

### 1.2 功能邊界

| 項目 | 範圍 |
|------|------|
| **Must Have (P0)** | 節點 registry CRUD（含名稱唯一性、持久化）；Aggregate Dashboard（統計列 + Node Cards + 狀態燈 🟢🟡🔴⚫）；節點切換器（Header 下拉 + `?node={id}` URL）；單節點服務管理（start/stop/restart/enable/disable/logs，與單機佈局一致）；跨節點服務搜尋（debounce 300ms、部分失敗先回）；心跳與離線偵測（10s 心跳 / 30s 離線 / 300s 長期離線 / Manager 重啟 30s 寬限期）；測試連線；Agent binary 下載（amd64/arm64）；狀態變更 WebSocket 即時推送 |
| **Should Have (P1)** | 節點詳細資訊面板（OS/uptime/資源，`GET /api/v1/nodes/{id}/info`）；離線節點診斷面板（最後上線/心跳時間、離線持續時間、重新連線/移除）；Agent 版本相容性檢查（不符 → 🟡 警告）；Audit Log 含 node_id/node_name 欄位 |
| **Nice to Have (P2)** | 節點離線觸發 webhook 通知（013 notify 模組擴充點）；跨節點服務相依操作編排（本階段不做）；RBAC 限縮節點管理權限（Roadmap #14） |
| **硬性限制** | 單 Manager 最多 50 Agent；操作逾時 15s（含來回）；跨節點查詢總逾時 10s；同節點同服務不允許並行操作（不同節點可並行）；**Manager 不做服務狀態本地快取**（每次查詢代理至 Agent，摘要數據來自最後一次心跳附帶的服務統計）；不支援跨節點相依操作編排；Manager ↔ Agent 強制 TLS、可選 mTLS |

### 1.3 既有基礎

- `go.mod` 已有 chi/v5（router）、gorilla/websocket（UI 推送）；**無 gRPC / protobuf / SQLite** — 專案自 013 起確立「零新增依賴」pattern；`gopkg.in/yaml.v2` 已以 indirect 存在於 go.sum（swag 依賴），Agent 設定檔 `agent.yaml` 可免費啟用為 direct dependency，**無需新增任何 module**
- `internal/token.Store` 已示範 **JSON 設定檔 + RWMutex + atomic save（temp + rename）** pattern → node registry 直接沿用
- `internal/audit` 已示範 JSONL append-only + buffered channel writer + `Action*` 常數與 `actionDisplayLabels` 翻譯先例 → 節點操作稽核沿用，並小改支援 node_id/node_name 欄位
- `internal/systemd.ServiceManager` interface 是**純本機操作抽象**（ListServices/Start/Stop/...），Agent 端直接重用，**零改動**；handler 測試以 mock manager 注入的 pattern 可直接複製到 Agent
- `internal/handler` 已有 `writeJSON`、`AuthMiddlewareComposite`、`Handler` struct 注入欄位先例（`Hub` / `Audit` / `TokenStore` / `Config` / `Notify`）→ 新增 `Nodes` 欄位完全一致
- `internal/websocket.Hub` 已有 `BroadcastMessage` 泛用推播（013 用於 notify 停用事件）→ 節點狀態事件（`node_status` / `node_online` / `node_offline` / `node_removed`）直接重用，**hub 零改動**
- 前端已有路由級 lazy-load、Pinia store（auth/service）、`useWebSocket`（handlers Map 按 type 分發）、`useToast`、`useI18n`、`EmptyState.vue`、`ConfirmModal.vue`、`TabsBar.vue` → 多節點 UI 全部沿用；現有 `DashboardView.vue` 的服務列表佈局可改造為 node-aware 直接重用
- `main.go` 單一 entry point 於 `src/`，`//go:embed templates/static` 內嵌前端 → Agent 不需這些 embed，需獨立 entry point（決策 7）

---

## 2. 關鍵技術決策

### 決策 1：Manager ↔ Agent 通訊協定

| 方案 | 描述 | 優點 | 缺點 |
|------|------|------|------|
| **A. HTTPS REST（選定）** | Agent 本身就是一個完整 JSON API server（驗收清單明訂「Agent 提供完整 JSON API（與單機 Manager 相同，僅無前端）」）；心跳為每 10s 一次 `POST /api/v1/agent/heartbeat`；Manager 代理 = 薄 forwarder | **與驗收清單的 Agent 形狀完全吻合** — Agent 本來就要開 REST server，Manager 代理是純請求轉發，無需第二種協定；50 節點 × 10s 心跳 = 5 req/s + 操作請求，流量規模完全不需要 stream 化；操作 handler 的 request/response 語意與既有 chi route / `writeJSON` / audit 整合最自然；**零新依賴**（標準庫 `net/http` + chi 既有）；TLS/mTLS 於 HTTP 層是最成熟的實作（`http.Transport` + `tls.Config`） | 心跳有 ≤10s 的偵測延遲（可接受 — interaction flow 明訂 30s 離線閾值，餘裕 20s）；無推送通道（本功能不需要 Manager→Agent 即時推送） |
| B. WebSocket 持久 stream | gorilla/websocket 已在 go.mod；Agent 主動連 Manager 開 stream，操作請求也走 WS | 心跳與操作共用連線；連線建立即感知斷線 | **request/response 語意需自建**（correlation ID、超時、錯誤回傳協議層），既有 REST handler 完全無法重用；操作（start/stop）的 audit / 驗證邏輯要在 WS 層重寫一遍；心跳與操作混在同一通道需要額外的串流狀態機；WS 的「離線偵測」仍依賴心跳 timeout（TCP 層無應用存活），優勢名不副實 |
| C. gRPC | protobuf 定義 service + 雙向 stream | schema 明確、雙向串流原生支援、跨語言 | **需新增 grpc-go + protobuf compiler 工具鏈**，直接違反「零新增依賴」pattern（013 決策同理由）；Agent 需同時開 gRPC server（操作）+ gRPC client（心跳）雙通道；protobuf 版本相容是長期維運成本；團隊現有程式碼無任何 protobuf 慣例 |

> **決策**：方案 A。核心論據：interaction flow 的驗收清單已將 Agent 定義為「完整 JSON API server」，REST 是它的自然形狀；心跳 10 秒一拍的流量（50 節點 = 5 req/s）遠低於任何需要長連線的場景；REST 讓 Manager 的代理層、audit、逾時策略與既有 handler 慣例完全同構，並維持專案「零新增依賴」的鐵律。
>
> **規格**：
> 1. **Manager → Agent**（操作/查詢）：`GET/POST /api/v1/nodes/{id}/...` 由 Manager 代理至 `https://{address}/api/v1/...`（對應路由見決策 6）。
> 2. **Agent → Manager**（心跳/註冊）：`POST /api/v1/agent/heartbeat`，body 見決策 3。
> 3. 所有流量**強制 TLS**：Agent 只接受 HTTPS（HTTP 連線回 426）；Manager client 不信任系統 CA 亦可（自簽憑證靠指紋 pinning，見決策 5）。

### 決策 2：Agent 連線模型

| 方案 | 描述 | 優點 | 缺點 |
|------|------|------|------|
| **A. 短連線 + 週期心跳 POST（選定）** | 應用層無狀態：每次操作獨立 HTTP 請求；心跳每 10s 一個 POST；`http.Client` 連線池在傳輸層隱含 keep-alive（TCP 連線實際被重用） | **「短連線」是應用層語意、傳輸層仍持久** — 兼得無狀態簡單性與連線重用效能；離線偵測完全以 Manager 側 `last_heartbeat` 時間戳判定，**與連線模型正交**（決策 3 的狀態機不管連線）；無重連狀態機 — Agent 重啟後下一個心跳自然恢復；Manager 重啟後「主動重連」退化為「啟動時健康檢查 + 等心跳回流」；零額外程式碼 | 節點離線的「偵測」依賴心跳節奏（≤10s + 30s 閾值 = 最慢 40s 才顯示離線）— interaction flow 明訂此閾值，可接受 |
| B. 持久連線（WS/gRPC stream） | 常駐雙向 stream，含 keepalive ping | 連線建立瞬間可知斷線 | 需處理半開連線偵測、重連退避、連線生命週期管理 — **TCP keepalive 不保證應用層存活**，最終仍需應用層心跳來確認；為「連線狀態」付出整套機制，但 interaction flow 的離線 UX 是以心跳時間戳定義的，兩者結論一致 |
| C. 混合（心跳 REST + 操作 WS） | 兩者都用 | 各自用最合適的協定 | 同時維護兩套通道、兩套認證上下文、兩套錯誤處理 — over-engineering |

> **決策**：方案 A。Interaction flow 的「離線偵測（30 秒無心跳）」「寬限期（300 秒）」「Manager 重啟寬限期（30 秒）」全部以心跳時間戳為基準 — 這些規則**不依賴連線模型即可完整實作**。REST 短連線下：Agent 崩潰 → Manager 心跳 timeout → 🔴 離線；Agent 重啟 → 下一個心跳 → 🟢 自動恢復；與持久連線的 UX 完全一致，實作卻少一個數量級。
>
> **規格**：Manager 啟動時依 node registry 對每個節點發一次健康檢查（`GET /health`）嘗試建立第一筆 `last_heartbeat`；之後純靠心跳 POST 更新。Agent 端心跳 ticker 的 jitter（±2s 隨機偏移）避免 50 個 Agent 同時對齊拍擊 Manager。

### 決策 3：心跳與離線偵測機制

| 方案 | 描述 | 優點 | 缺點 |
|------|------|------|------|
| **A. Manager 集中心跳接收 + 單一 supervisor 掃描（選定）** | 心跳 POST 只做「驗 token → 更新 registry 的 last_heartbeat + 服務統計」；一個 `supervisor` goroutine 以 5s ticker 掃描所有節點，依時間差判定狀態；狀態變更 → hub 推播 + 前端 Toast | 判定邏輯集中在一個純函式（`deriveStatus(last, now)`），**極易單元測試**；與連線模型完全解耦（決策 2）；5s 掃描 × 50 節點 = 每輪 50 次 O(1) 檢查，成本可忽略；ticker 觸發的狀態變更批次推送，天然防通知風暴 | 需多一條 ticker goroutine 生命周期管理（併入 Shutdown）；狀態變更最多延遲 5s（遠小於閾值餘裕） |
| B. 每次心跳即時推播狀態 | 心跳 handler 內計算時間差並推播 | 無掃描 | 每個心跳都做推播判斷（5 req/s × 全節點廣播），廣播放大；「最後心跳時間」的顯示仍需前端定時 re-render — 問題沒簡化 |
| C. Agent 自報離線（Agent 偵測後通知 Manager） | 反向通知 | 互補偵測 | Agent 都掛了怎麼通知？離線偵測**只能在 Manager 側**（互動流異常表明確認） |

> **決策**：方案 A。狀態機與 interaction flow 邊界完全對齊：
>
> ```
> 心跳間隔 10s（Agent 端 ticker，±2s jitter）
> last_heartbeat 距今 ≥ 10s 且 < 30s  → 🟡 延遲（degraded，心跳稍有延遲但未逾時）
>                          ≥ 30s        → 🔴 離線（連續 3 次漏拍）
> 離線持續 ≥ 300s                        → ⚫ 長期離線（Card 移至底部/摺疊）
> 恢復心跳                              → 🟢 線上（推播 node_online + Toast）
> ```
>
> **規格**：
> 1. **心跳 payload**（Agent → Manager）：`{node_name, agent_version, hostname, os, uptime_seconds, services: {total, active, failed}, timestamp}` — 附帶服務統計，讓 Aggregate Dashboard 的摘要列與 Node Card 服務統計**免代理查詢**（interaction flow「摘要數據來自各節點最後一次心跳附帶的服務統計」）。
> 2. **Manager 啟動寬限期**：`supervisor` 記錄 `bootTime`，啟動後 30 秒內**不觸發離線通知**（互動流異常表「Manager 重啟後 30 秒內不觸發離線通知」）；狀態仍照算，但節點剛啟動時不廣播離線事件（避免重啟風暴）。
> 3. **版本相容檢查**：心跳帶 `agent_version`，Manager 比對 `AgentMinVersion`（編譯期常數，如 `1.2.0`）；不符 → 節點狀態 🟡 警告（`version_incompatible` 標記 + Tooltip「Agent 版本過舊，建議升級」），不阻斷心跳與操作。
> 4. **狀態變更推播**：沿用 `hub.BroadcastMessage`，message type：`node_status`（含 node_id/status/last_heartbeat/version）與 `node_online` / `node_offline` / `node_removed`；前端 `useWebSocket` handlers Map 註冊後更新 `stores/nodes.ts` + 全域 Toast。
> 5. **通知模組整合**（P2 擴充點）：`supervisor` 暴露 `OnNodeStateChange func(nodeID, state string)` 回呼，未來可掛 013 notifier 觸發 webhook — 本階段**不接入**（interaction flow 未要求節點離線 webhook 通知）。

### 決策 4：節點 Registry 持久化

| 方案 | 描述 | 優點 | 缺點 |
|------|------|------|------|
| **A. JSON 檔 `nodes.json`（選定）** | `/var/lib/linux-service-manager/nodes.json`，結構化 JSON，**啟動時全量載入記憶體 + RWMutex + atomic save（temp + rename）**，完全沿用 token store pattern | ≤50 節點，設定檔 < 100KB，全量記憶體操作每次事件零 IO 讀取；**零新依賴**；與 013 notify.json / token.json 的維運與備份慣例一致；欄位含 token/fingerprint，權限 0600 | 需實作一組 CRUD + 並發鎖（沿用既有 pattern，成本低）；未來節點數爆炸（>1000）才需資料庫 — 超出邊界 |
| B. SQLite / bbolt | 嵌入式資料庫 | 查詢/索引強、並發寫入安全 | **需新增依賴**（CGO 或 pure-Go driver），與 009/013 兩次「資料量極低不需資料庫」的決策矛盾；Roadmap #14（多用戶 RBAC）才可能引進資料庫，屆時統一再遷移；本功能資料量極低（≤50 筆），完全用不上 |
| C. YAML（與 agent.yaml 同格式） | 兩端設定檔格式一致 | 一致性好 | Manager 端既有慣例全 JSON（token.json/notify.json/audit.jsonl）；YAML 需另開 loader，反而打破一致性 |

> **決策**：方案 A。**沿用而非複製**：`internal/nodes/registry.go` 仿照 `token.Store`（`Load()` / `Save()` atomic / `List` / `Get` / `Create` / `Update` / `Delete` / `SetHeartbeat`，全以 RWMutex 保護）。
>
> **Node 資料模型**：
> ```go
> type Node struct {
>     ID             string            `json:"id"`               // UUID（crypto/rand，零新依賴，同 013 決策）
>     Name           string            `json:"name"`             // 唯一（註冊時檢查重複 → 409）
>     Address        string            `json:"address"`          // host:port
>     TLSFingerprint string            `json:"tls_fingerprint,omitempty"` // SHA-256 指紋（選填，mTLS/自簽 pin）
>     Token          string            `json:"token"`            // 共享 secret（API 回應不回傳，回 masked）
>     Notes          string            `json:"notes,omitempty"`
>     Status         string            `json:"status"`           // online/degraded/offline/long_offline/warning
>     LastHeartbeat  string            `json:"last_heartbeat,omitempty"` // RFC3339 UTC
>     AgentVersion   string            `json:"agent_version,omitempty"`
>     Hostname       string            `json:"hostname,omitempty"`
>     OS             string            `json:"os,omitempty"`
>     ServiceStats   ServiceStats      `json:"service_stats"`    // {total, active, failed}（心跳附帶）
>     CreatedAt      string            `json:"created_at"`
>     UpdatedAt      string            `json:"updated_at"`
> }
> ```

### 決策 5：認證模型

| 方案 | 描述 | 優點 | 缺點 |
|------|------|------|------|
| **A. Token 共享密鑰（選定為主方案）** | Manager 註冊節點時產生長隨機 token（`lsm_node_...`），寫入 registry 並由管理員填入 `agent.yaml` 的 `auth_token`；**雙向使用**：Agent 心跳帶 `Authorization: Bearer {token}`（Manager middleware 比對 registry），Manager 代理請求亦帶同 header（Agent middleware 驗證）；Agent 不驗證管理員身分，**信任 Manager 代理授權**（interaction flow 認證模型明訂） | 與既有 API Token pattern（Bearer `lsm_...`）同構；零新依賴；支援輪替（PUT 更新節點時重發 token）；實作 = 兩端各一個 middleware | 共享密鑰的洩漏面 = 兩端檔案（管理面：0600 檔權限 + API masked 回傳，同 013 token 處理） |
| B. mTLS 雙向憑證 | 雙方互相驗證憑證（CA 簽發） | 最強、不可竊取式認證 | 需要憑證簽發/分發/輪替基礎設施；interaction flow 定為「**可選**」且表單欄位「TLS 憑證指紋（選填）」 — 強制 mTLS 會大幅提高部署門檻（每台新機器都要簽憑證），與「快速加入新節點」的核心情境衝突 |
| C. 僅 TLS 無認證 | 加密但不驗證身分 | 最簡單 | 任何能連到 Agent 端口的機器都能發操作請求；違反 interaction flow「認證模型」邊界 |

> **決策**：**A 為主方案，B 為可選強化（依節點獨立啟用）**。實作層次：
> 1. **強制層（所有節點）**：TLS 加密 + Token 驗證。註冊 API 要求 `token` 與 `tls_fingerprint` **至少填其一**（都為空回 400）。
> 2. **指紋 pinning（B 的輕量版，自簽憑證情境）**：節點設定 `tls_fingerprint` 時，Manager 的 `AgentClient` 於握手時驗證 leaf cert 的 SHA-256 指紋 == registry 值（**不信任系統 CA、直接 pin**）— 解決「強制 TLS 但無 CA 基礎設施」的部署現實（互動流表單明列此欄位）。
> 3. **完整 mTLS（B 的完整版，選填）**：節點可另設 `client_cert` 選項 — Agent 端 `tls.Config.ClientAuth = RequireAndVerifyClientCert` + `ClientCAs`；Manager 端送 client cert。mTLS 啟用的節點可省略 token（fingerprint + client cert 已雙向驗證）。
> 4. **Agent 端認證**：`internal/agent` 的 middleware 對 `/api/v1/*`（除 `/health`）驗證 `Authorization: Bearer` == 設定檔 token；mTLS 啟用時 `ClientAuth` 驗證 Manager 憑證。
> 5. **Manager 端認證**：`POST /api/v1/agent/heartbeat` 的 middleware 比對 `node_name` + token；token 不符 → 401 拒絕（Agent 記錄錯誤並重試）。**節點名稱重複註冊**由 registry Create 檢查（409）。

### 決策 6：API Proxy 實作

| 方案 | 描述 | 優點 | 缺點 |
|------|------|------|------|
| **A. 逐 route 顯式代理 + 共用 AgentClient（選定）** | 每個 `/api/v1/nodes/{id}/...` route 一個 handler：registry lookup → 離線檢查 → 組 Agent URL → `AgentClient.Do(ctx, method, path, body)` → 回應轉寫（status/body/header）→ **audit 記錄（含 node_id/node_name）** → 錯誤映射 | 節點層 API 面是**固定且小**的（6 個端點，見下）；每個 handler 可精準套用**per-route 逾時**（操作 15s）與錯誤映射（404 節點不存在 / 502 節點離線 / 504 逾時）；audit 語意與單機操作一致（同 action + node 欄位）；handler_test pattern 可直接複製（注入 mock AgentClient）；回應格式沿用 `writeJSON` 與 Agent 原樣 schema，前端零適配 | 需為每個 route 寫一個 handler（但每個僅 ~30 行，共用 helper 後更少） |
| B. `httputil.ReverseProxy` 通用代理 | 一個 catch-all route + Rewrite 規則 | 轉發程式碼最少 | 失去 per-route audit / 逾時 / 錯誤映射 — 代理是黑箱，無法在請求層記錄「誰操作了哪個節點的哪個服務」；搜尋（聚合）與 summary（心跳統計）本來就不是純轉發，仍需自寫；URL 重寫規則對 chi param 的 path 組裝容易出錯 |
| C. 完全共用 Manager 既有 handler | `h.HandleStartJSON` 直接改寫支援 node 參數 | 單機/多機共用同一份 handler | **方向錯誤**：Manager 的 handler 綁定 `h.systemd`（本機）、hub、audit 上下文；把節點參數塞進單機 handler 會讓單機路徑背上節點查詢成本與錯誤語意，且 Agent 端 handler 仍要另寫 — 兩邊都髒 |

> **決策**：方案 A。**共用 AgentClient 是核心**（B/C 的優點收進 A 的內層抽象）：
>
> ```go
> // internal/nodes/client.go（示意）
> type AgentClient struct {
>     client *http.Client // Transport 含 tls.Config（RootCAs/指紋 pin/client cert）；Timeout 由呼叫方 context 決定
> }
> func (c *AgentClient) Do(ctx context.Context, n *Node, method, path string, body any) (int, []byte, error)
> // 自動注入 Authorization: Bearer {n.Token}；錯誤分類：network → NodeOfflineError、ctx deadline → NodeTimeoutError
> ```
>
> **Route 對照表**（對應驗收清單「API Proxy / Aggregate」全部項目）：
>
> | Manager route | 代理目標（Agent） | 逾時 | 備註 |
> |---|---|---|---|
> | `GET /api/v1/nodes/{id}/services` | `GET /api/v1/services` | 15s | 轉寫 Agent 原樣 schema |
> | `POST /api/v1/nodes/{id}/services/{name}/start\|stop\|restart\|enable\|disable` | 同 path | 15s | audit 記 action + node_id/node_name |
> | `GET /api/v1/nodes/{id}/services/{name}/logs?lines=` | 同 path | 15s | 轉寫純文字 |
> | `GET /api/v1/nodes/{id}/info` | `GET /api/v1/system/info` | 10s | Agent 新增端點（OS/kernel/uptime/資源概覽） |
> | `GET /api/v1/nodes/services/search?q=` | **不代理** — Manager fan-out（決策 9） | 總 10s | |
> | `GET /api/v1/nodes/summary` | **不代理** — 心跳統計聚合（決策 3） | - | |
> | `POST /api/v1/nodes/test-connection` | `GET /health` | 5s | 帶入表單位址/憑證做即時驗證 |
>
> **錯誤映射**：Agent 離線（network/連線拒絕）→ `502 {"error":"node offline"}`；逾時 → `504`；Agent 回 4xx/5xx → 原樣轉寫（body 為 Agent 的 `{"error":...}`）。**同節點同服務並行操作限制**：interaction flow 明訂為前端按鈕 disabled 行為（不同節點可並行），Manager 端不強制（維持無狀態）；前端以 per-node per-service in-flight 狀態實作。

### 決策 7：Agent Binary 建置策略

| 方案 | 描述 | 優點 | 缺點 |
|------|------|------|------|
| **A. 同 module、獨立 entry point（選定）** | `src/cmd/agent/main.go`（第二個 `package main`）；共享 `internal/systemd`（零改動）與新 `internal/agent`（heartbeat client + agent server 組裝）；Manager 維持 `go build .`，Agent 為 `go build ./cmd/agent`；CI 平行建置兩種 binary（agent-linux-amd64 / agent-linux-arm64） | **無 build tags 分叉**，main.go 保持乾淨；Agent binary 自然精簡（不 embed templates/static、不 import audit/notify/token/websocket）；Go 慣例（`cmd/` entry point + `internal/` 共享）；單元測試可完全複製 handler 的 mock 注入 pattern | 需維護兩個 main（成本極低 — Agent main 僅 ~100 行組裝） |
| B. 同一 main 條件式編譯（build tags） | `//go:build agent` tag 切換 embed 與模組組合 | 單一 entry point | 現有 `main.go` 組合了 audit/notify/token/hub/前端 embed — 條件式編譯會讓 main.go 滿佈 `//go:build` 分叉，**同一檔案兩份邏輯**，閱讀、測試、CI 都痛苦；「精簡 binary」的目標（不含前端 embed）根本無法用 tag 乾淨表達 |
| C. 獨立 repo / module | agent 自成 module | 發布獨立 | 版本同步、雙 repo CI、共享 internal/systemd 需 module replace — 為 1 個 binary 增加大量協調成本，over-engineering |

> **決策**：方案 A。**共享邊界刻意收窄**：Agent **只**共享 `internal/systemd`（本機操作，interface 零改動）與（可選）`internal/systemd.ConfigAPI`；**不重用** `internal/handler` — 它與 hub/audit/token/notify/templates 深度耦合，Agent 端在 `internal/agent` 內以 chi + `writeJSON` 風格自實作 ~7 個 handler（邏輯與 Manager 的 JSON handler 同構但更簡，僅 systemd 操作 + token middleware + health）。
>
> **Agent 端點**：
> - `GET /health` — 回 `{version, hostname, os, uptime}`（test-connection 用；**不驗證 token**）
> - `GET /api/v1/services`、`POST /api/v1/services/{name}/start|stop|restart|enable|disable`、`GET /api/v1/services/{name}/logs?lines=`、`GET /api/v1/system/info` — 全部走 token middleware
> - 心跳 client：10s ticker（±2s jitter）`POST https://{manager_addr}/api/v1/agent/heartbeat`
>
> **設定檔**：`/etc/linux-service-manager/agent.yaml`（`gopkg.in/yaml.v2` 啟用為 direct dependency — 已在 go.sum，零新 module）：
> ```yaml
> manager_addr: manager.example.com:8443
> auth_token: lsm_node_xxx
> node_name: web-server-01
> heartbeat_interval: 10s
> listen_addr: :8443        # Agent 自身 HTTPS server
> tls_cert: /etc/linux-service-manager/agent.crt
> tls_key: /etc/linux-service-manager/agent.key
> client_cert: ""           # 選填：mTLS 時 Manager 驗證用
> ```
>
> **下載與分發**：CI 建置 `agent-linux-amd64` / `agent-linux-arm64` 並以 `//go:embed` 嵌入 Manager binary（或放 `/var/lib/linux-service-manager/agents/`）；Manager 提供 `GET /api/v1/agents/download?arch=amd64` 串流下載（驗收清單「下載 Agent」項目）；部署流程（scp + systemctl）照 interaction flow 3.3。

### 決策 8：前端架構

| 方案 | 描述 | 優點 | 缺點 |
|------|------|------|------|
| **A. 三視圖 + 新 nodes store + node-aware DashboardView（選定）** | 路由：`/` = AggregateDashboardView（登入預設，統計列 + Node Cards + 跨節點搜尋）、`/nodes` = NodeManagementView（列表 + 新增/編輯/移除 + 測試連線 + 下載 Agent）、`/dashboard?node={id}` = 既有 DashboardView 改造為 **node-aware**（`activeNodeId` 存在時所有 API 呼叫走 `/api/v1/nodes/{id}/...` 前綴，佈局不變）；新增 `stores/nodes.ts`（nodes、activeNodeId、summaries、WS 即時更新）；新增 `NodeSwitcher.vue`（Header 下拉：狀態燈 + 「所有節點」選項） | **單節點視圖直接重用既有 DashboardView**（互動流明訂「單節點視圖佈局與現有 Dashboard 一致」）— 服務表格、操作按鈕、LogViewer、ConfigEditor 全部免重寫；`?node=` query 保留狀態（重整不跳走）；store 分離清楚（nodes.ts 管節點、service.ts 管目前視圖服務） | DashboardView 需小改（讀 `route.query.node` + 節點離線時禁用操作 + 黃色 Banner）；現有 `name:'dashboard'` 語意從「單機」升級為「aggregate」— 單機模式（無任何節點時）仍顯示既有畫面，向後相容 |
| B. 全新 NodeDetailView 複製 Dashboard 佈局 | 單節點視圖另寫一個 view | 邏輯隔離 | **重複整個服務管理 UI**（表格/操作/日誌/設定編輯），任何功能改動要改兩處 — 直接違反互動流「佈局與現有 Dashboard 一致」的意圖 |
| C. 不分頁面、單一 view 依狀態切換 | 一個大 view 內部 switch aggregate/single | 路由簡單 | 元件爆炸、路由/URL/返回鍵無法表達視圖層級；與「Node Management 獨立頁面」的互動流不符 |

> **決策**：方案 A。登入預設 `/`（Aggregate）符合互動流「觸發入口：登入後預設進入 Aggregate Dashboard」；Header 新增「Node Management」導覽連結（`nav.nodes` 翻譯入 useI18n）。
>
> **規格**：
> 1. **`stores/nodes.ts`**：`nodes: Node[]`、`activeNodeId: string | null`、`summary`（總/線上/離線/服務統計）；getter `onlineNodes` / `byId`；actions：`fetchNodes()`、`fetchSummary()`、`setActiveNode(id)`、`applyNodeEvent(msg)`（WS）；API 呼叫經 `api/client.ts` 新增 functions（`listNodes / createNode / updateNode / deleteNode / testConnection / getNodeServices / nodeServiceAction / searchServices / getNodeInfo / downloadAgent` — service functions 接受 optional `nodeId` 前綴）。
> 2. **DashboardView 改造**：`onMounted` 讀 `route.query.node` → `nodesStore.setActiveNode`；`activeNodeId` 存在時 services API 走節點前綴；節點狀態非 online → 操作按鈕禁用 + 頂部黃色 Banner「節點已離線，操作不可用」；無 `?node` 且無節點時維持原單機行為（向後相容）。
> 3. **WS 即時更新**：`useWebSocket` handlers 新增 `node_status` / `node_online` / `node_offline` / `node_removed` → 更新 nodes store + 全域 Toast（「Node-X 已離線」「已恢復連線」），符合互動流「無需重整頁面」。
> 4. **新元件**：`AggregateDashboardView.vue`（StatsBar + NodeCard 網格 + 搜尋框 debounce 300ms + 空狀態引導）、`NodeCard.vue`（狀態燈 🟢🟡🔴⚫ / 服務統計 / 最後心跳相對時間 / 詳情）、`NodeManagementView.vue`（列表表格 + NodeFormModal + ConfirmModal 移除 + 下載 Agent）、`NodeFormModal.vue`（名稱/位址/指紋/token/備註 + 測試連線按鈕 + 結果提示）、`NodeDetailPanel.vue`（離線診斷：最後上線/心跳、離線持續時間、重新連線/移除）、`NodeSwitcher.vue`。
> 5. 離線節點 Card 移至底部/摺疊（長期離線 ⚫）；搜尋結果點擊 → `/dashboard?node={id}` + 展開該服務（DashboardView 支援 `?service=` 初使展開）。

### 決策 9：跨節點搜尋與並行查詢

| 方案 | 描述 | 優點 | 缺點 |
|------|------|------|------|
| **A. goroutine fan-out + semaphore + per-node context（選定）** | `GET /api/v1/nodes/services/search?q=`：僅查**線上**節點；每節點一 goroutine（semaphore 上限 10）；總預算 context 10s（互動流邊界）；結果經 channel 收集；失敗節點不阻塞其他節點；回應含 `failed_nodes` 清單 | **完全符合互動流異常表**：「部分節點的搜尋結果顯示，離線節點旁標示無法查詢，不阻塞其他節點」；goroutine + WaitGroup + semaphore 與 013 的並行發送 pattern 同構（團隊已熟）；部分結果即時回傳（`failed_nodes` 讓前端能標示「無法查詢」） | 需處理 context 取消（父 context 取消時停止新 fan-out）；semaphore 上限需常數化（10） |
| B. 依序查詢 | 逐節點串行 | 最簡單 | 50 節點 × 平均 1s = 50s，**遠超 10s 總逾時邊界**；單一節點慢速拖住全部 |
| C. 全域服務索引（每心跳更新） | 心跳時把服務清單同步到 Manager 記憶體 | 查詢零延遲 | **直接違反互動流資料一致性邊界**：「服務狀態以 Agent 即時回報為準，Manager 不做本地快取」；心跳附帶的是**統計**（total/active/failed）而非完整清單（10s 心跳 × 50 節點 × 服務清單的 payload 與一致性成本都高）；搜尋結果會是過期資料 |

> **決策**：方案 A。**回應語意**：`{results: [{node_id, node_name, service, active, sub}], failed_nodes: [{node_id, node_name, reason}]}` — 成功節點即時回，失敗節點以 reason（offline / timeout）標示，前端在搜尋結果列表尾部顯示「N 個節點無法查詢（離線/逾時）」。節點內匹配邏輯由 Agent 端做（`GET /api/v1/services?q=` Agent 端支援 substring 過濾，Manager 只彙總）— 避免把全部服務清單拉回 Manager。
>
> **`GET /api/v1/nodes/summary` 不需 fan-out**：直接聚合各節點最後心跳的 `ServiceStats`（決策 3），O(50) 記憶體掃描，零網路請求 — 這正是心跳附帶統計的設計回報。
>
> **並行操作**（非搜尋）：不同節點的操作天然並行（各自 proxy request）；同節點同服務並行限制由前端 per-node per-service in-flight 標記實作（互動流明訂為按鈕 disabled 行為）。

---

## 3. 架構概覽

### 3.1 新增模組結構

```
src/internal/nodes/            # Manager 端：節點管理（新）
├── registry.go                # nodes.json Load/atomic save/CRUD/RWMutex（token store pattern）
├── registry_test.go
├── heartbeat.go               # POST /api/v1/agent/heartbeat 接收端（token 驗證 → 更新 last_heartbeat + stats）
├── supervisor.go              # 5s ticker：狀態機（延遲/離線/長期離線/恢復）+ hub 推播 + 啟動寬限期 + 版本檢查
├── supervisor_test.go         # deriveStatus 純函式測試（時間邊界 10s/30s/300s、寬限期）
├── client.go                  # AgentClient：TLS/指紋 pin/client cert、token header、Do(ctx, method, path, body)、錯誤分類
└── client_test.go             # httptest TLS server 驗證轉發/指紋/逾時/錯誤映射

src/internal/agent/            # Agent 端（新）
├── config.go                  # agent.yaml 載入（yaml.v2 直接依賴）
├── config_test.go
├── server.go                  # chi router：/health + /api/v1/services/* + /api/v1/system/info + token middleware
├── server_test.go             # mock systemd.ServiceManager 注入（複製 handler_test pattern）
├── heartbeat.go               # 10s ticker（±2s jitter）心跳 client（exponential backoff）
└── heartbeat_test.go

src/cmd/agent/main.go          # Agent binary entry point（~100 行組裝；go build ./cmd/agent）

src/internal/handler/
├── node_handler.go            # 9 個節點層 handler（CRUD/test-connection/download agent）
├── node_proxy_handler.go      # 4 個代理 handler（services/ops/logs/info，共用 AgentClient + audit）
├── search_handler.go          # 跨節點搜尋（fan-out + semaphore）
└── *_test.go

src/internal/audit/audit.go    # 小改：Entry 新增 node_id/node_name 欄位 + 節點操作 Action 常數

frontend/src/
├── views/AggregateDashboardView.vue   # /（StatsBar + NodeCard 網格 + 搜尋 + 空狀態）
├── views/NodeManagementView.vue       # /nodes（列表 + 新增 Modal + 移除確認 + 下載 Agent）
├── components/NodeCard.vue / NodeSwitcher.vue / NodeFormModal.vue / NodeDetailPanel.vue
├── stores/nodes.ts                     # nodes / activeNodeId / summary / WS 事件
├── composables/useWebSocket.ts         # +node_status/node_online/node_offline/node_removed handlers
├── api/client.ts                       # nodes API + service functions 支援 nodeId 前綴
├── types/node.ts                       # Node / NodeStatus / NodeSummary / ServiceStats 型別
└── router/index.ts                     # +/nodes、/dashboard?node= 路由；/ 改掛 Aggregate
```

### 3.2 系統架構圖（mermaid）

```mermaid
flowchart TB
    subgraph Browser["瀏覽器（Vue 3 SPA）"]
        AGG["AggregateDashboardView /（登入預設）<br/>StatsBar + NodeCards + 跨節點搜尋"]
        NODE["DashboardView /dashboard?node=<br/>（node-aware，佈局沿用）"]
        MGT["NodeManagementView /nodes"]
        SW["NodeSwitcher（Header 下拉）"]
        WS2["useWebSocket handlers"]
    end

    subgraph Manager["Manager 主機（Go binary）"]
        subgraph Nodes["internal/nodes（新）"]
            REG["registry<br/>nodes.json（atomic write）"]
            HB["heartbeat 接收<br/>POST /api/v1/agent/heartbeat"]
            SUP["supervisor 5s ticker<br/>狀態機 10s/30s/300s + 寬限期 + 版本檢查"]
            CLIENT["AgentClient<br/>TLS/指紋 pin/token + timeout"]
        end
        API["REST API /api/v1/nodes/*<br/>（node_handler + node_proxy_handler + search_handler）<br/>AuthMiddlewareComposite"]
        HUB["WebSocket Hub<br/>BroadcastMessage（既有，零改動）"]
        AUDIT["internal/audit<br/>+node_id/node_name"]
        STATIC["/api/v1/agents/download<br/>go:embed agent binaries"]
    end

    subgraph AgentN["Agent 主機 × N（cmd/agent binary）"]
        ASRV["internal/agent server<br/>/health + /api/v1/services/* + token mw"]
        AHB["heartbeat client<br/>10s ticker"]
        SYSD["internal/systemd<br/>ServiceManager（既有，零改動）"]
    end

    AGG -->|GET /api/v1/nodes + summary| API
    NODE -->|GET /api/v1/nodes/{id}/services| API
    MGT -->|CRUD / test-connection| API
    SW -->|切換 activeNodeId| NODE
    WS2 <-->|WebSocket 既有通道| HUB
    API --> REG
    API -->|fan-out 搜尋 / 代理操作| CLIENT
    HUB -->|node_status/node_online/node_offline/node_removed| WS2
    SUP --> REG
    SUP -->|狀態變更推播| HUB
    API --> AUDIT
    HB --> REG
    CLIENT -->|"HTTPS (Bearer token / mTLS)"| ASRV
    AHB -->|"POST heartbeat (10s)"| HB
    ASRV --> SYSD
```

### 3.3 心跳與狀態機流程（偽代碼）

```go
// internal/nodes/supervisor.go（示意）
func (s *Supervisor) tick() {
    now := time.Now()
    for _, n := range s.registry.List() {
        next := deriveStatus(n.Status, n.LastHeartbeat, now, s.bootTime, n.AgentVersion)
        if next != n.Status {
            s.registry.SetStatus(n.ID, next)
            s.hub.BroadcastMessage(ws.Message{Type: "node_status", ID: n.ID, Active: next, Timestamp: now.Format(time.RFC3339)})
            // 離線通知受啟動寬限期保護（bootTime + 30s 內不推播 node_offline）
        }
    }
}

func deriveStatus(prev, lastHB string, now, boot time.Time, version string) string {
    if version != "" && semverLess(version, AgentMinVersion) { return "warning" } // 版本不相容 → 🟡 警告優先
    if lastHB == "" { return "offline" }
    age := now.Sub(parse(lastHB))
    switch {
    case age < 10*time.Second:  return "online"
    case age < 30*time.Second:  return "degraded"   // 🟡 延遲
    case age < 300*time.Second: return "offline"    // 🔴 離線（≥3 次漏拍）
    default:                    return "long_offline" // ⚫ 長期離線
    }
}

// internal/nodes/heartbeat.go（示意）
func (h *HeartbeatHandler) Handle(w, r) {
    var hb Heartbeat          // {node_name, agent_version, hostname, os, services{...}}
    if !h.registry.VerifyToken(hb.NodeName, bearerToken(r)) { http.Error(w, "unauthorized", 401); return }
    h.registry.SetHeartbeat(hb.NodeName, hb) // last_heartbeat=now + stats + version（Status 由 supervisor 下輪判定；與決策 4 方法清單一致）
    writeJSON(w, 200, map[string]any{"ok": true, "accepted": true})
}

// internal/nodes/client.go（示意）
func (c *AgentClient) Do(ctx context.Context, n *Node, method, path string, body any) (int, []byte, error) {
    u := "https://" + n.Address + path
    req := ... // method/body; req.Header.Set("Authorization", "Bearer "+n.Token)
    resp, err := c.client.Do(req.WithContext(ctx))
    if err != nil { return 0, nil, &NodeOfflineError{Node: n.Name, Err: err} }
    defer resp.Body.Close()
    data, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<20)) // 4MB 上限
    return resp.StatusCode, data, nil
}
```

### 3.4 main.go 路由與初始化變更

```go
// 初始化（hub.Run 前）
nodeMod, err := nodes.New(nodes.Config{
    RegistryPath:  "/var/lib/linux-service-manager/nodes.json",
    Hub:           hub,
    AgentMinVersion: "1.2.0",
}) // New 內部完成 registry Load（決策 4；與開發規格 1.9/1.11 一致）
if err != nil { log.Fatalf("failed to load node registry: %v", err) }
go nodeMod.Supervisor.Run(ctx) // 5s ticker 狀態機
h.Nodes = nodeMod

// 路由（既有 AuthMiddlewareComposite 群組內；heartbeat 在群組外 — Agent 用 token header 自證）
r.Post("/api/v1/agent/heartbeat", h.HandleAgentHeartbeat) // token 由 nodes middleware 驗證，不走 session
r.Get("/api/v1/nodes", h.HandleListNodes)
r.Post("/api/v1/nodes", h.HandleCreateNode)
r.Get("/api/v1/nodes/{id}", h.HandleGetNode)
r.Put("/api/v1/nodes/{id}", h.HandleUpdateNode)
r.Delete("/api/v1/nodes/{id}", h.HandleDeleteNode)
r.Post("/api/v1/nodes/test-connection", h.HandleTestConnection)
r.Get("/api/v1/nodes/summary", h.HandleNodesSummary)
r.Get("/api/v1/nodes/services/search", h.HandleSearchServices)
r.Get("/api/v1/nodes/{id}/services", h.HandleNodeServices)
r.Post("/api/v1/nodes/{id}/services/{name}/start", h.HandleNodeServiceStart)   // …stop/restart/enable/disable
r.Get("/api/v1/nodes/{id}/services/{name}/logs", h.HandleNodeServiceLogs)
r.Get("/api/v1/nodes/{id}/info", h.HandleNodeInfo)
r.Get("/api/v1/agents/download", h.HandleAgentDownload)
```

---

## 4. 與現有模組的整合

| 模組 | 變更 | 說明 |
|------|------|------|
| `src/internal/nodes/` (new) | 新模組 | registry / heartbeat / supervisor / client（決策 3、4、5、6） |
| `src/internal/agent/` + `src/cmd/agent/main.go` (new) | 新模組 + 新 entry point | Agent server + heartbeat client（決策 7） |
| `src/internal/systemd` | **零改動** | Agent 端直接重用 `ServiceManager` interface（可注入 mock） |
| `src/internal/websocket/hub.go` | **零改動** | 節點狀態推播用既有 `BroadcastMessage`（013 已示範） |
| `src/internal/handler/handler.go` | `Handler` struct 新增 `Nodes *nodes.Manager` 欄位 | 沿用 013 `Notify` 注入先例 |
| `src/internal/handler/node_handler.go` / `node_proxy_handler.go` / `search_handler.go` (new) | 新 handler 檔 | 13 個節點層 + 代理 + 搜尋 handler |
| `src/internal/audit/audit.go` | **小改**：`Entry` 新增 `NodeID` / `NodeName` 欄位（omitempty，向後相容）+ 節點操作 Action 常數（`ActionNodeCreate/Update/Delete/TestConnection`）| 跨節點操作記錄節點來源（interaction flow 驗收） |
| `src/main.go` | 初始化 nodeMod、心跳路由（群組外）、13 條節點路由、Agent binary embed | 見 3.4 |
| `frontend/src/router/index.ts` | `/` 改掛 AggregateDashboardView；新增 `/nodes`、`/dashboard?node=` | lazy-load 沿用 |
| `frontend/src/stores/nodes.ts` (new) | 新 Pinia store | nodes/activeNodeId/summary/WS 事件 |
| `frontend/src/views/DashboardView.vue` | **小改**：node-aware（讀 `?node`、節點離線禁用操作 + 黃色 Banner、`?service=` 初使展開） | 佈局零變動 |
| `frontend/src/composables/useWebSocket.ts` | 新增 4 個 message type handlers | 沿用 handlers Map pattern |
| `frontend/src/api/client.ts` + `types/node.ts` | 節點 API + service functions 支援 nodeId 前綴 | |
| `frontend/src/components/AppHeader.vue` + `useI18n.ts` | 「Node Management」導覽 + `nav.nodes` 翻譯 | |

### 不需變更的部分

- `internal/monitor`、`internal/notify`、`internal/token`、`internal/auth`、`internal/middleware` — 節點功能完全不觸及（supervisor 的 OnNodeStateChange 回呼是 P2 擴充點，本階段不接）
- `internal/websocket` 的連線管理 / heartbeat / session TTL
- 反向代理 (nginx) — 無新協定（純 HTTPS REST 出站、無新入站端口）
- `systemd.ServiceManager` 實作 — Agent 共用，零改動
- 前端現有 DashboardView 佈局、LogViewer、ConfigEditor、ServiceRow 元件 — 全部在 node-aware 模式直接重用

---

## 5. 風險評估

| 風險 | 可能性 | 影響 | 緩解措施 |
|------|--------|------|---------|
| Agent token / 憑證私鑰洩漏（存於 nodes.json 與 agent.yaml） | 中 | 高 | 兩端檔案權限 0600（仿 token store）；API 回應回傳 masked token（`lsm_node_****xxxx`），編輯留空表示不變更；mTLS 節點可完全依賴憑證認證；token 支援輪替（PUT 更新） |
| 心跳風暴（多節點同時離線/恢復，如網路閃斷） | 中 | 中 | supervisor 5s 批次掃描 + 狀態變更才推播（天然去重）；心跳 jitter（±2s）避免節點對齊；Toast 通知以節點為單位，不重複廣播 |
| Manager 重啟後 50 節點同時重連/健康檢查 | 中 | 低 | 啟動時健康檢查**非阻塞並行**（semaphore 10）+ 30s 啟動寬限期不觸發離線通知；心跳回流後狀態自然恢復 |
| 自簽 TLS 憑證部署門檻（無 CA 基礎設施） | 高 | 中 | 決策 5 的指紋 pinning 為第一公民：握手直接比對 SHA-256 指紋，不需系統 CA；「測試連線」在註冊前即驗證憑證/指紋正確性 |
| Agent 回應慢拖住 Manager（proxy 請求） | 中 | 中 | per-route context timeout（操作 15s / 查詢 10s / health 5s）；AgentClient 4MB 回應上限；逾時回 504 不掛起 goroutine |
| 搜尋 fan-out 塞爆 Manager（50 節點同時慢速） | 低 | 中 | semaphore 上限 10 + 總 context 10s + 部分結果語意（failed_nodes 標示）；僅查「線上」節點 |
| nodes.json 寫入中斷（crash） | 低 | 中 | atomic write（temp + rename）沿用 token store；crash 後原檔完整 |
| audit 格式變更影響既有紀錄 | 低 | 中 | `node_id`/`node_name` 欄位 `omitempty` — 既有單機紀錄無此欄位，讀取/匯出向後相容 |
| 同節點同服務並行操作競態 | 低 | 中 | interaction flow 定義為前端按鈕 disabled 行為；前端 per-node per-service in-flight 標記；systemd 操作本身具冪等性 |
| Agent 版本不相容（行為漂移） | 低 | 中 | 心跳帶版本 + `AgentMinVersion` 編譯期常數 → 🟡 warning 狀態（不阻斷）；下載頁提示「建議升級至 v1.2+」 |
| 多 Manager 同時註冊同一 Agent | 低 | 低 | 互動流定義：Agent 僅接受第一個 Manager 的 token（config 單一 `manager_addr`）；第二個 Manager 連線被拒 → 其節點顯示離線，可由管理員檢查 agent.yaml |

---

## 6. 實作順序建議

| 優先級 | 任務 | 預估工時 | 依賴 |
|--------|------|---------|------|
| **P0** | `internal/nodes/registry.go` — nodes.json Load/atomic save/CRUD/唯一性檢查 | 3h | - |
| **P0** | `internal/agent/` server + `cmd/agent/main.go` — /health + /api/v1/services/* + token middleware + agent.yaml 載入 | 5h | - |
| **P0** | `internal/agent/heartbeat.go` — 10s ticker + jitter + backoff；Manager `heartbeat.go` 接收端 + token 驗證 | 3h | registry, agent server |
| **P0** | `internal/nodes/supervisor.go` — 狀態機（10s/30s/300s/寬限期/版本檢查）+ hub 推播（含 `deriveStatus` 純函式測試） | 3h | heartbeat, hub |
| **P0** | `internal/nodes/client.go` — AgentClient（TLS/指紋 pin/mTLS/token/錯誤分類）+ httptest 測試 | 3h | - |
| **P0** | `internal/handler/node_handler.go` — 節點層 9 個 handler（CRUD/test-connection/summary/download）+ audit Action 擴充 | 4h | registry, client |
| **P0** | `internal/handler/node_proxy_handler.go` — 4 個代理 handler + audit node 欄位 | 3.5h | client, audit 小改 |
| **P0** | `internal/handler/search_handler.go` — 跨節點搜尋（fan-out + semaphore + failed_nodes） | 2.5h | client |
| **P0** | `main.go` — 初始化、心跳路由、13 條路由、agent binary embed | 1.5h | 各 handler |
| **P0** | 前端 — types/node.ts + api/client.ts + stores/nodes.ts + AggregateDashboardView + NodeManagementView + NodeFormModal + NodeSwitcher + DashboardView node-aware 改造 + useWebSocket 4 事件 + AppHeader 連結 | 10h | 後端 API |
| **P1** | 後端單元測試補齊（registry race、deriveStatus 邊界、AgentClient 指紋/逾時、proxy 錯誤映射、search 部分失敗） | 4h | 各模組 |
| **P1** | 前端元件測試（NodeFormModal 驗證/測試連線、NodeCard 狀態燈、DashboardView 離線禁用、WS 事件 Toast） | 3h | view |
| **P1** | Playwright E2E（註冊→測試連線→aggregate→切換節點→操作→離線→恢復→跨節點搜尋） | 3.5h | 全部 |

**總預估工時**：約 49 小時（約 6 工作天）

---

## 7. 相依與影響

| 項目 | 影響 |
|------|------|
| `src/internal/nodes/` (new) | registry.go / heartbeat.go / supervisor.go / client.go + 測試 |
| `src/internal/agent/` (new) + `src/cmd/agent/main.go` (new) | config.go / server.go / heartbeat.go + 測試；**第二個 entry point**（CI 新增 agent binary job） |
| `src/internal/handler/handler.go` | Handler struct 新增 `Nodes` 欄位；`New()` 簽名擴充 |
| `src/internal/handler/node_handler.go` / `node_proxy_handler.go` / `search_handler.go` (new) | 13 個 handler method |
| `src/internal/audit/audit.go` | `Entry` + `node_id`/`node_name`（omitempty）；4 個節點操作 Action + display labels |
| `src/main.go` | 節點模組初始化、心跳路由（AuthMiddlewareComposite 群組外）、13 條節點路由 |
| `go.mod` | `gopkg.in/yaml.v2` indirect → direct（**無新增 module**） |
| `frontend/package.json` | **無新增依賴** |
| `frontend/src/views/AggregateDashboardView.vue` / `NodeManagementView.vue` (new) | 新路由視圖（lazy-load） |
| `frontend/src/views/DashboardView.vue` | node-aware 小改（讀 `?node`、離線禁用 + Banner） |
| `frontend/src/stores/nodes.ts` (new) + `api/client.ts` + `types/node.ts` | 節點 API 與狀態 |
| `frontend/src/composables/useWebSocket.ts` | 4 個 message type + handlers |
| `frontend/src/components/AppHeader.vue` / `useI18n.ts` | Node Management 導覽 + 翻譯 |
| 反向代理 (nginx) / 部署 (install.sh) | Manager 無新入站端口（agent 心跳走既有 HTTPS 端口）；**Agent 端**新增 systemd unit `linux-service-agent` + `/etc/linux-service-manager/agent.yaml` + TLS 憑證目錄 |

---

## 8. 下一步關聯

本文件為 **development-spec-generator** 的上游輸入：`docs/tech-decisions/014-multi-node-agent-management.md` 將被引用於 `docs/development/014-multi-node-agent-management.md` 開發規格書，轉化為後端實作規格（nodes 模組 API 合約、心跳 payload schema、狀態機測試矩陣、AgentClient TLS 行為）、前端實作規格（Aggregate Dashboard 元件樹、node-aware DashboardView 改造、WS 事件處理）與 API 合約（13 個 endpoint 的 request/response 範例）。BDD 檔案（`docs/bdds/014-multi-node-agent-management.feature`）由上游 skill 產生後，應補入本決策文件的輸入文件清單，並以本文件的 9 項決策作為測試覆蓋矩陣的技術依據（狀態機時間邊界 10s/30s/300s、token 驗證、指紋 pinning、代理逾時 15s、搜尋部分失敗、重啟寬限期為關鍵測試點）。

---

*最後更新：2026-08-13*
