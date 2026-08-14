# 多機管理 Agent 模式 — 測試計畫

> **對應 BDD**：`docs/bdds/014-multi-node-agent-management.feature`（69 個 Scenario）
> **操作流程**：`docs/interaction-flows/014-multi-node-agent-management.md`
> **技術決策**：`docs/tech-decisions/014-multi-node-agent-management.md`（9 項決策）
> **對應 Roadmap**：Phase 4 — `docs/development/002-expansion-roadmap.md` 項目 #12（多機管理 Agent 模式）
> **測試日期**：2026-08-13

---

## 0. 測試計畫決策備註（依 Tech Decision 裁決）

BDD / Interaction Flow 與 Tech Decision 存在下列技術細節差異，本測試計畫**以 Tech Decision 9 項決策為準**，測試案例對應關係依此調整：

| # | 差異點 | BDD / Interaction Flow 描述 | Tech Decision 裁決（本計畫採用） |
|---|--------|------------------------------|----------------------------------|
| D-1 | **通訊協定與「註冊」語意** | BDD「Agent 啟動後連接 Manager WebSocket/gRPC 並發送註冊請求」（IF 3.3 Agent 啟動流程） | **決策 1/2**：Manager ↔ Agent 為 **HTTPS REST** 短連線 + 10s 心跳 POST（`POST /api/v1/agent/heartbeat`）；**無獨立 register 端點** — 「註冊」= Manager 啟動時 `GET /health` 健康檢查 + Agent 第一次心跳 POST（含 node_name/agent_version/hostname/os）由 registry 比對；Agent 只接受 HTTPS（HTTP 連線回 **426**） |
| D-2 | **Aggregate 路由位置** | BDD「路由導航至 /dashboard（Aggregate 模式）」、「URL 變更為 /dashboard?node={nodeId}」 | **決策 8**：登入預設 `/` = AggregateDashboardView；`/dashboard?node={id}` = 既有 DashboardView 改造為 node-aware（單節點視圖）；BDD 的「/dashboard 為 Aggregate」為早期草案，測試以 **`/` 為 Aggregate、`/dashboard?node=` 為單節點視圖** |
| D-3 | **狀態機四態 + 版本警告** | BDD「心跳稍有延遲但未逾時 🟡」、「離線 30 秒 🔴」、「300 秒 ⚫」 | **決策 3**：`deriveStatus` 邊界 — `age<10s → online`、`≥10s<30s → degraded(🟡)`、`≥30s<300s → offline(🔴)`、`≥300s → long_offline(⚫)`；`last_heartbeat` 為空 → offline；**版本 < AgentMinVersion → warning(🟡) 優先判定**（不阻斷心跳與操作）；5s ticker 批次掃描、狀態變更才推播（防通知風暴） |
| D-4 | **認證強制性** | BDD「TLS 憑證指紋（選填）、API Token（選填）」 | **決策 5**：TLS 強制 + Token 強制；註冊時 **token 與 tls_fingerprint 至少填其一**（皆空 → 400）；指紋 pinning 為第一公民（自簽憑證不信任系統 CA）；完整 mTLS 為每節點**可選**強化（啟用時可省略 token）；心跳 middleware 比對 node_name + Bearer token，不符 → 401 |
| D-5 | **逾時分級** | BDD「操作逾時 15 秒（含來回）」 | **決策 6**：per-route context timeout — 操作（services/ops/logs）**15s**、info **10s**、跨節點搜尋總 **10s**、test-connection **5s**；錯誤映射：離線/連線失敗 → **502 `{"error":"node offline"}`**、逾時 → **504**、Agent 4xx/5xx → 原樣轉寫（body 為 Agent 的 `{"error":...}`）；回應 4MB 上限 |
| D-6 | **搜尋部分失敗語意** | BDD「結果僅顯示可達節點、離線節點旁標示『無法查詢』」 | **決策 9**：回應結構 `{results:[{node_id,node_name,service,active,sub}], failed_nodes:[{node_id,node_name,reason}]}`；goroutine fan-out + **semaphore 上限 10** + 總 context 10s；**僅查線上節點**；節點內匹配由 Agent 端 `GET /api/v1/services?q=` substring 過濾（Manager 不拉回全部服務清單） |
| D-7 | **summary 資料來源** | BDD「系統發送 GET /api/v1/nodes/summary」 | **決策 3/9**：`GET /api/v1/nodes/summary` **不代理、不 fan-out** — 聚合各節點最後一次心跳附帶的 `ServiceStats{total,active,failed}`（O(50) 記憶體掃描，零網路請求）；摘要數據以心跳統計為準，**Manager 不做服務狀態本地快取**（決策對應 BDD「服務狀態以 Agent 即時回報為準」） |
| D-8 | **401 驗證範圍** | BDD 401 Outline 列 9 個 endpoint | **決策 5/6/3.4**：`POST /api/v1/agent/heartbeat` 在 AuthMiddlewareComposite **群組外**（以節點 token 自證，不需 session）；本計畫 401 測試以 BDD 9 個為準，另依決策 6 route 表**補充** `GET /nodes/{id}/info`、`GET/POST /nodes/{id}/services...`、`GET /agents/download` 等代理端點 |
| D-9 | **同節點同服務並行限制** | BDD「系統拒絕第二個並行操作」 | **決策 6**：Manager **不強制**（維持無狀態 proxy）；由前端 per-node per-service **in-flight 標記**實作（操作進行中按鈕 disabled）；不同節點操作天然並行 |
| D-10 | **心跳 jitter / 重啟寬限期** | BDD 未提及 jitter；「Manager 重啟後 30 秒內不觸發離線通知」 | **決策 2/3**：Agent 心跳 ticker **±2s jitter** 避免 50 節點對齊拍擊 Manager；Manager 啟動寬限期 = `bootTime + 30s` 內狀態照算但**不推播 node_offline**；啟動時健康檢查**非阻塞並行**（semaphore 10） |

---

## 1. 測試範圍總覽

| 層級 | 範圍 | 工具 | 負責 |
|------|------|------|------|
| 單元測試 | Go `internal/nodes/registry.go`（nodes.json atomic save / CRUD / 名稱唯一性 / 50 上限 / VerifyToken） | `go test` | 後端 |
| 單元測試 | Go `internal/nodes/heartbeat.go`（心跳接收 / token 驗證 / stats 更新） | `go test` + `httptest` | 後端 |
| 單元測試 | Go `internal/nodes/supervisor.go`（`deriveStatus` 狀態機 10s/30s/300s / 啟動寬限期 / 版本檢查 / 推播） | `go test` | 後端 |
| 單元測試 | Go `internal/nodes/client.go`（AgentClient 代理 / 指紋 pin / mTLS / 逾時 / 502/504 / 4MB 上限） | `go test` + `httptest.NewTLSServer` | 後端 |
| 單元測試 | Go `internal/agent/`（config.go / server.go / heartbeat.go：/health、token middleware、services API、心跳 client） | `go test` + `httptest` | 後端 |
| 單元測試 | Go `internal/handler/node_handler.go`（節點 CRUD / test-connection / summary / download） | `go test` + `httptest` | 後端 |
| 單元測試 | Go `internal/handler/node_proxy_handler.go`（4 類代理 handler / 錯誤映射 / audit 記錄） | `go test` + mock AgentClient | 後端 |
| 單元測試 | Go `internal/handler/search_handler.go`（fan-out + semaphore + failed_nodes + 10s 總逾時） | `go test` + mock AgentClient | 後端 |
| 單元測試 | Go `internal/audit` 小改（Entry + node_id/node_name、節點操作 Action） | `go test` | 後端 |
| 單元測試 | Vue `stores/nodes.ts`（nodes / activeNodeId / summary / WS 事件應用） | Vitest 4.1.10 + happy-dom | 前端 |
| 單元測試 | Vue `AggregateDashboardView.vue` / `NodeCard.vue`（統計列 / Cards 網格 / 4 色狀態燈 / 搜尋 / 空狀態） | Vitest 4.1.10 + @vue/test-utils 2.4.11 | 前端 |
| 單元測試 | Vue `NodeSwitcher.vue` / `NodeFormModal.vue` / `NodeManagementView.vue` / `NodeDetailPanel.vue`（切換 / 驗證 / 測試連線 / 移除確認） | Vitest 4.1.10 + @vue/test-utils 2.4.11 | 前端 |
| 單元測試 | Vue `DashboardView.vue` node-aware（?node 前綴 / 離線禁用 + Banner / in-flight / ?service 展開） | Vitest 4.1.10 + @vue/test-utils 2.4.11 | 前端 |
| 單元測試 | Vue `api/client.ts` 節點 API + `useWebSocket` 4 事件（含斷線重連） | Vitest 4.1.10 | 前端 |
| 整合測試 | Manager ↔ Agent 通訊全鏈路（Agent TLS server ↔ AgentClient ↔ proxy handler ↔ audit） | `go test`（integration） | 後端 |
| 整合測試 | 心跳→registry→supervisor→hub 推播狀態機全流程（時間壓縮） | `go test`（integration） | 後端 |
| 端對端測試 | 完整使用者流程（登入 Aggregate → 切換節點 → 操作服務 → 搜尋 → 新增/移除節點 → 離線/恢復） | Playwright 1.62.1 | 前端 |
| 手動驗證 | 真實環境（多台 Linux 機器、真實 TLS/mTLS 憑證、真實網路中斷、50 節點壓力） | 手動 | QA |

---

## 2. 後端單元測試

> 新增測試檔：`src/internal/nodes/registry_test.go`、`heartbeat_test.go`、`supervisor_test.go`、`client_test.go`、`src/internal/agent/config_test.go`、`server_test.go`、`heartbeat_test.go`、`src/internal/handler/node_handler_test.go`、`node_proxy_handler_test.go`、`search_handler_test.go`
> 沿用既有 pattern：table-driven test + `httptest.NewRecorder` / `httptest.NewTLSServer`（mock Agent）+ mock `systemd.ServiceManager` 注入（複製 handler_test pattern）

### 2.1 registry.go — nodes.json 持久化 / CRUD / 唯一性 / 上限（決策 4）

> 對應 BDD：`@business-rules @data`「Node registry 持久化於磁碟且重啟後保留」+ `@node-mgmt @duplicate`「節點名稱重複」+ `@edge-case @node-limit`「50 個上限」

| # | 測試名稱 | Given | When | Then |
|---|---------|-------|------|------|
| SYS-01 | Load 載入既有 nodes.json | 檔內含 2 筆節點（含 online/offline 狀態） | `Load()` | 正確載入；狀態、last_heartbeat、service_stats 完整保留 |
| SYS-02 | Load 檔案不存在回傳空 registry | nodes.json 不存在 | `Load()` | 回傳空清單（不 crash）；後續 Create 可正常運作 |
| SYS-03 | Save 為 atomic write | registry 有變更 | `Save()` | temp 檔寫入 + `os.Rename`；無 `.tmp` 殘留；同刻讀取看不到部分內容 |
| SYS-04 | Create 新增節點 | 名稱 web-server-01、位址 10.0.0.5:8443 | `Create(n)` | 回傳含 UUID（crypto/rand）節點；Token 產生 `lsm_node_` 前綴長隨機值；created_at/updated_at 為 RFC3339 UTC |
| SYS-05 | Create 名稱重複拒絕 | 已存在「web-server-01」 | `Create` 同名節點 | 回傳重複錯誤（handler 層 409）；registry 不新增 |
| SYS-06 | Update 更新節點設定 | 既有節點；body 含新 address/notes、token 留空 | `Update(id, ...)` | address/notes 更新、updated_at 刷新；**token 留空表示不變更**（決策 5 風險緩解） |
| SYS-07 | Delete 移除節點 | 既有節點含歷史 Audit | `Delete(id)` | 節點自清單移除；**Audit Log 紀錄保留**（audit 模組獨立，不隨節點刪除） |
| SYS-08 | Get by ID 存在 / 不存在 | id 存在與不存在 | 依序 `Get` | 存在 → 回傳節點；不存在 → nil + not found 錯誤 |
| SYS-09 | SetHeartbeat 更新心跳資訊 | Agent 上傳心跳（version/hostname/os/stats） | `SetHeartbeat(nodeName, hb)` | last_heartbeat=now（RFC3339 UTC）、service_stats 更新、agent_version/hostname/os 更新；**Status 不在此處修改**（由 supervisor 下輪判定，決策 3） |
| SYS-10 | VerifyToken 比對 | registry token=`lsm_node_abc` | `VerifyToken(name, token)` | 正確 → true；錯誤 / 節點不存在 → false |
| SYS-11 | 50 節點上限拒絕第 51 個 | 已註冊 50 個節點 | `Create` 第 51 個 | 拒絕並回「已達節點數量上限」錯誤 |
| SYS-12 | 未達上限允許註冊 | 已註冊 49 個節點 | `Create` 第 50 個 | 建立成功 |
| SYS-13 | 並發操作無 data race | 多 goroutine 同時 Create / SetHeartbeat / Update | `go test -race` | 無 race（RWMutex 保護）；最終資料一致 |
| SYS-14 | 檔案權限 0600 | 首次 Save | 檢查檔案 mode | mode = 0600（token 含於檔內，決策 5 風險緩解） |

### 2.2 heartbeat.go — 心跳接收端（決策 3）

> 對應 BDD：`@heartbeat @p0 @smoke`「Agent 定期發送心跳且 Manager 更新 last_heartbeat」+ `@agent`「註冊比對」

| # | 測試名稱 | Given | When | Then |
|---|---------|-------|------|------|
| SYS-15 | 心跳 token 正確接受並更新 | 節點 web-server-01 已註冊、Bearer token 正確、body 含 node_name 等 | POST `/api/v1/agent/heartbeat` | 200 `{"ok":true,"accepted":true}`；registry last_heartbeat 更新 |
| SYS-16 | 心跳 token 不符拒絕 | Bearer token 錯誤 | POST heartbeat | **401**（決策 5：Agent 記錄錯誤並重試） |
| SYS-17 | 心跳 node_name 不存在拒絕 | registry 無此 node_name | POST heartbeat | **401**（比對 node_name + token 失敗） |
| SYS-18 | 心跳附帶服務統計更新 | body `services:{total,active,failed}` | POST heartbeat | registry service_stats 更新為 {total,active,failed}（Aggregate 摘要資料來源，決策 3/7） |
| SYS-19 | 心跳 body 非法 JSON | 畸形 body | POST heartbeat | 400；last_heartbeat 不更新 |

### 2.3 supervisor.go — 心跳狀態機（決策 3，10s/30s/300s）

> 對應 BDD：`@offline` 4 Scenario + `@edge-case @heartbeat` Outline ×3 + `@error-handling @restart`「Manager 重啟寬限期」+ `@version`「版本不相容」+「寬限期內心跳恢復」
> **核心測試點**：`deriveStatus(prev, lastHB, now, boot, version)` 為純函式，直接以時間邊界驗證

| # | 測試名稱 | Given | When | Then |
|---|---------|-------|------|------|
| SYS-20 | 心跳 age <10s → online | last_heartbeat 距今 5s | `deriveStatus` | `online`（🟢） |
| SYS-21 | 心跳 age ≥10s 且 <30s → degraded | last_heartbeat 距今 15s | `deriveStatus` | `degraded`（🟡，BDD「心跳稍有延遲但未逾時」） |
| SYS-22 | 心跳 age ≥30s 且 <300s → offline | last_heartbeat 距今 60s（連續 3 次漏拍） | `deriveStatus` | `offline`（🔴） |
| SYS-23 | 心跳 age ≥300s → long_offline | last_heartbeat 距今 310s | `deriveStatus` | `long_offline`（⚫） |
| SYS-24 | last_heartbeat 為空 → offline | 節點從未收到心跳 | `deriveStatus` | `offline` |
| SYS-25 | 版本不相容優先 → warning | 心跳帶 version=v1.0 < AgentMinVersion=1.2.0、心跳正常 | `deriveStatus` | `warning`（🟡 優先於 online；不阻斷心跳與操作，決策 3） |
| SYS-26 | 版本相符不影響正常判定 | version=v1.2.0、心跳正常 | `deriveStatus` | `online` |
| SYS-27 | 寬限期內恢復心跳 → online | 節點 offline 60s（<300s 寬限期）後收到新心跳 | tick 掃描 | 狀態自動變更為 online（決策 3「恢復心跳 → 🟢」） |
| SYS-28 | 啟動寬限期內不推播離線 | 節點剛註冊即離線；now < bootTime+30s | tick 掃描 | 狀態照算為 offline，但 **不廣播 node_offline**（決策 3/10，避免重啟風暴） |
| SYS-29 | 超過啟動寬限期正常推播 | now ≥ bootTime+30s 且節點離線 | tick 掃描 | 推播 `node_offline`（含 node_id/status/last_heartbeat） |
| SYS-30 | 狀態未變不廣播 | 節點維持 online | tick 掃描 | 無任何推播（防通知風暴，決策 3） |
| SYS-31 | 5s ticker 批次掃描所有節點 | 3 個節點狀態各異 | 運行 1 個 tick | 每節點 O(1) 判定；僅狀態變更的節點被處理 |
| SYS-32 | 推播 message type 正確 | 節點上線/離線/狀態變更/移除 | 依序觸發 | `node_online` / `node_offline` / `node_status` / `node_removed`（沿用 hub.BroadcastMessage） |
| SYS-33 | OnNodeStateChange 回呼存在 | supervisor 初始化 | 檢查介面 | 回呼欄位存在但**本階段不接入**（P2 webhook 擴充點，決策 3） |

### 2.4 client.go — AgentClient（決策 5/6，TLS / 指紋 pin / 逾時 / 錯誤映射）

> 對應 BDD：`@error-handling @tls`「TLS 憑證過期」+ `@edge-case @tls` Outline ×2（TLS/mTLS）+ `@error-handling @timeout`「操作逾時 15 秒」+ `@integration @tls` Outline ×2
> 測試方式：`httptest.NewTLSServer` + 自簽憑證（指紋 pin 情境不信任系統 CA）

| # | 測試名稱 | Given | When | Then |
|---|---------|-------|------|------|
| SYS-34 | 代理請求組裝正確 | 節點 address=10.0.0.5:8443、token=`lsm_node_x` | `Do(ctx, n, "GET", "/api/v1/services", nil)` | mock Agent 收到 `https://10.0.0.5:8443/api/v1/services`；`Authorization: Bearer lsm_node_x`；回傳 status/body |
| SYS-35 | 網路錯誤分類 NodeOfflineError | Agent 不可達（connection refused） | `Do` | 回傳 `NodeOfflineError`（handler 層映射 502「node offline」，決策 6） |
| SYS-36 | 逾時分類 NodeTimeoutError | Agent 延遲 > context deadline | `Do`（ctx 15s 或 10s） | 回傳 `NodeTimeoutError`（handler 層映射 504，決策 6） |
| SYS-37 | 回應 4MB 上限 | Agent 回傳 >4MB body | `Do` | `io.LimitReader` 4MB 截斷/錯誤處理；不掛起 goroutine |
| SYS-38 | 指紋 pin 相符連線成功 | 節點 tls_fingerprint=自簽憑證 SHA-256、握手驗證 | `Do` | 連線成功（不信任系統 CA、直接 pin，決策 5） |
| SYS-39 | 指紋不符連線失敗 | tls_fingerprint 與實際憑證不符 | `Do` | TLS 驗證錯誤（BDD「TLS 憑證過期導致已註冊節點離線」）→ NodeOfflineError |
| SYS-40 | mTLS 雙向驗證 | 節點啟用 mTLS、Manager 端送 client cert | `Do` | mock Agent 以 `RequireAndVerifyClientCert` + `ClientCAs` 驗證 Manager 憑證成功（決策 5 B 完整版） |
| SYS-41 | 自簽憑證不信任系統 CA | 未設指紋 pin、Agent 用自簽憑證 | `Do` | 預設 RootCAs 不含自簽 CA → 連線失敗（驗證「pin 為必要路徑」） |
| SYS-42 | Agent 5xx 原樣轉寫 | Agent 回 500 `{"error":"permission denied"}` | `Do` | 回傳 500 + 原 body（不吞錯誤，決策 6） |
| SYS-43 | Agent 4xx 原樣轉寫 | Agent 回 404 `{"error":"service not found"}` | `Do` | 回傳 404 + 原 body |

### 2.5 agent 模組 — config / server / heartbeat client（決策 1/2/5/7）

> 對應 BDD：`@agent @download`「下載 Agent binary」+「Agent 啟動後註冊」+「Agent 離線時本地操作」+「Agent 支援 Token 驗證」+ `@error-handling @multi-manager`「第二個 Manager 被拒絕」
> 測試方式：mock `systemd.ServiceManager` 注入（複製 handler_test pattern）

| # | 測試名稱 | Given | When | Then |
|---|---------|-------|------|------|
| SYS-44 | agent.yaml 載入成功 | yaml 含 manager_addr/auth_token/node_name/listen_addr/tls_cert/tls_key | `LoadConfig` | 欄位正確載入（yaml.v2 direct dependency，零新 module，決策 7） |
| SYS-45 | agent.yaml 缺必填欄位報錯 | 缺 node_name / 缺 auth_token / 缺 manager_addr | `LoadConfig` | 回傳明確錯誤（啟動即失敗） |
| SYS-46 | GET /health 不需 token | 無 Authorization header | GET `/health` | 200 `{version, hostname, os, uptime}`（test-connection 用，決策 7） |
| SYS-47 | token middleware 驗證 /api/v1/* | 無 token / token 錯誤 / token 正確 | 依序 GET `/api/v1/services` | 前兩者 401；正確者 200（BDD「Agent 支援 Token 驗證來自 Manager 的請求」） |
| SYS-48 | GET /api/v1/services 回服務列表 | mock systemd 注入 3 筆服務 | GET services | 200，回傳原樣 schema（與單機 Manager JSON API 相同，決策 7） |
| SYS-49 | 操作 start/stop/restart/enable/disable | mock systemd（5 種操作依序） | 依序 POST 對應端點 | 對應 ServiceManager 方法被呼叫；成功回傳更新後狀態 |
| SYS-50 | 操作失敗（權限不足） | mock restartErr = errors.New("permission denied") | POST restart | 錯誤回應含原因；mock 記錄 restartCalled |
| SYS-51 | GET /api/v1/services?q= substring 過濾 | mock 回 5 筆服務 | GET `/api/v1/services?q=nginx` | 僅回傳名稱含「nginx」的服務（決策 9：節點內匹配由 Agent 端做） |
| SYS-52 | GET /api/v1/services/{name}/logs?lines= | mock getLogsFn 回日誌 | GET logs?lines=100 | 回傳純文字日誌；lines 參數正確傳遞 |
| SYS-53 | GET /api/v1/system/info | mock 系統資訊 | GET info | 回 OS/kernel/uptime/資源概覽（proxy 的 info 目標端點，決策 6） |
| SYS-54 | HTTP 非 TLS 連線回 426 | 以 `http://` 連 Agent | 發送請求 | **426 Upgrade Required**（決策 1：強制 TLS） |
| SYS-55 | mTLS 啟用時驗證 Manager 憑證 | 設定 client_cert + RequireAndVerifyClientCert | 無 client cert 連線 | 連線被拒（handshake 失敗）；帶正確 client cert 成功 |
| SYS-56 | 心跳 client 10s ticker + jitter | mock Manager heartbeat 端點 | 運行 ticker | 每 ~10s（±2s jitter）POST 一次 `https://{manager_addr}/api/v1/agent/heartbeat`，body 含 node_name/agent_version/hostname/os/uptime/services（決策 2/10） |
| SYS-57 | 心跳失敗 exponential backoff 重試 | mock Manager 回 500/網路錯誤 | 運行心跳 | 下次心跳依 backoff 延遲後重試；不 panic |
| SYS-58 | 心跳被拒 401 記錄並重試 | mock Manager 回 401 | 運行心跳 | 記錄錯誤（token 不符）；持續重試（決策 5；對應 BDD「第二個 Manager 連線被拒」— Agent 僅接受設定檔內 token） |

### 2.6 audit 擴充 — node_id / node_name（決策 4 整合）

> 對應 BDD：`@business-rules @audit`「跨節點操作記錄包含 node_id 與 node_name」+「移除節點時保留其歷史資料與 Audit Log」

| # | 測試名稱 | Given | When | Then |
|---|---------|-------|------|------|
| SYS-59 | Entry 含 NodeID/NodeName 且 omitempty | 既有單機 Entry（無節點欄位） | 序列化/讀取 | 新欄位 `node_id`/`node_name` omitempty — 既有紀錄無此欄位，讀取/匯出**向後相容**（決策風險緩解） |
| SYS-60 | 節點操作 Action 常數與顯示 | 節點 CRUD / test-connection 操作 | 檢查 audit 常數 | 存在 `ActionNodeCreate/Update/Delete/TestConnection` 與對應 display labels |

### 2.7 Handler — node_handler.go（節點 CRUD / test-connection / summary / download，決策 4/5/6）

> 對應 BDD：`@node-mgmt` 全部 Scenario + `@agent @download` Outline ×2 + `@edge-case @node-limit` + `@business-rules @data`「registry 持久化」
> 測試方式：`httptest` + temp dir 佈建 nodes.json + mock AgentClient

| # | 測試名稱 | Given | When | Then |
|---|---------|-------|------|------|
| HDL-01 | GET /nodes 回傳所有節點 | registry 2 筆（online/offline 各一） | GET `/api/v1/nodes` | 200 `{data:[...]}` 含 name/address/status/last_heartbeat/service_stats；**Token 回 masked `lsm_node_****xxxx`**（決策 5 風險緩解） |
| HDL-02 | POST /nodes 建立成功 | body `{name, address, token}` 完整合法 | POST `/api/v1/nodes` | 200/201 `{data: Node}` 含新 UUID；token 產生 |
| HDL-03 | POST 名稱重複回 409 | registry 已有「web-server-01」 | POST 同名 | 409（對應 BDD @duplicate「後端拒絕註冊」） |
| HDL-04 | POST 必填欄位驗證 | name 空 / address 空 / 兩者皆空 | POST | 400 明確錯誤訊息 |
| HDL-05 | POST token 與指紋皆空回 400 | body 無 token 且無 tls_fingerprint | POST | 400（決策 5：至少填其一） |
| HDL-06 | POST address 格式非法 | address=`not-a-host`（非 host:port） | POST | 400 |
| HDL-07 | POST 第 51 個節點回上限錯誤 | 已存在 50 節點 | POST | 400/409「已達節點數量上限」 |
| HDL-08 | GET /nodes/{id} 回 200 / 404 | id 存在 / 不存在 | 依序 GET | 200 `{data}`；404 `{"error":"node not found"}` |
| HDL-09 | PUT 更新節點 | 既有節點；body 改 address、token 留空 | PUT `/api/v1/nodes/{id}` | 200 `{data}` address 更新；**token 不變**（留空表示不變更） |
| HDL-10 | DELETE 移除節點 | 既有節點 | DELETE | 200 `{message}`；registry 移除；**Audit 保留**（BDD「移除節點時保留其歷史資料與 Audit Log」） |
| HDL-11 | POST test-connection 成功 | address 指向 mock Agent（/health 回 version/hostname/os） | POST `/api/v1/nodes/test-connection` | 200 `{version, hostname, os, uptime}`（決策 6：GET /health 5s） |
| HDL-12 | test-connection connection refused | address 不可達 | POST | 502 含「connection refused」（BDD Outline row 1 failure_msg） |
| HDL-13 | test-connection TLS 憑證驗證失敗 | mock Agent 憑證過期/指紋不符 | POST | 502「TLS 憑證驗證失敗：certificate expired」（BDD Outline row 2 failure_msg） |
| HDL-14 | test-connection 逾時 5s | mock Agent 延遲 >5s | POST | 504（決策 6：health 5s） |
| HDL-15 | GET /nodes/summary 聚合統計 | 節點心跳附帶 stats（總數 3、線上 2、離線 1、服務 total 30/active 25/failed 2） | GET `/api/v1/nodes/summary` | 200 `{"data":{total_nodes:3, online:2, degraded:0, offline:1, long_offline:0, warning:0, total_services:30, active_services:25, failed_services:2}}`（**零網路請求**，聚合心跳統計，決策 7；online 嚴格計 status==online，degraded/warning 為獨立欄位，與 1.9.1 HandleNodesSummary / 3.2 #8 一致） |
| HDL-16 | GET /agents/download?arch=amd64 | binary 已 embed | GET download?arch=amd64 | 200 `application/octet-stream` 串流；Content-Disposition 含 amd64 檔名 |
| HDL-17 | GET /agents/download?arch=arm64 | 同上 | GET download?arch=arm64 | 200 arm64 binary |
| HDL-18 | GET /agents/download?arch=unknown | 不支援架構 | GET | 400/404 |

### 2.8 Handler — node_proxy_handler.go（代理 + 錯誤映射 + audit，決策 6）

> 對應 BDD：`@service` 4 Scenario（Outline ×5 操作 + 日誌 + 失敗）+ `@error-handling @timeout`「操作逾時 15 秒」+ `@node-detail`「info」
> 測試方式：Handler 注入 mock AgentClient（回傳 status/body/error 分類）

| # | 測試名稱 | Given | When | Then |
|---|---------|-------|------|------|
| HDL-19 | GET /nodes/{id}/services 代理成功 | 節點線上、mock AgentClient 回 200 服務列表 | GET `/api/v1/nodes/{id}/services` | 200 轉寫 Agent 原樣 schema（與單機 Dashboard 相同佈局） |
| HDL-20 | 節點離線代理回 502 | 節點狀態 offline / AgentClient 回 NodeOfflineError | GET services | **502 `{"error":"node offline"}`**（決策 6 錯誤映射） |
| HDL-21 | 節點不存在回 404 | id 不存在於 registry | GET services | 404 |
| HDL-22 | 操作代理 + audit 記錄 | 節點線上；依序 start/stop/restart/enable/disable（Outline ×5） | POST `/api/v1/nodes/{id}/services/{name}/{action}` | AgentClient 收到對應 method/path；audit 寫入 action + **node_id + node_name**（BDD @audit） |
| HDL-23 | 操作逾時 15s 回 504 | AgentClient 回 NodeTimeoutError | POST restart | **504**（決策 6：操作 15s） |
| HDL-24 | 操作失敗轉寫 + audit 失敗紀錄 | AgentClient 回 500 `{"error":"permission denied"}` | POST restart | 500 + 原 body 轉寫；audit 記錄失敗操作（BDD「服務操作失敗…寫入 Audit Log」） |
| HDL-25 | GET logs 純文字轉寫 | AgentClient 回 200 日誌文字 | GET `/api/v1/nodes/{id}/services/{name}/logs?lines=100` | 200 text/plain；lines 傳遞 |
| HDL-26 | GET /nodes/{id}/info | AgentClient 回 200 system info | GET info | 200 轉寫（**10s** 逾時，決策 6） |
| HDL-27 | 代理回應 >4MB 上限 | AgentClient 回大 body 錯誤 | GET services | 依 AgentClient 4MB 限制處理（截斷/錯誤），不掛起 |

### 2.9 Handler — search_handler.go（fan-out + semaphore + failed_nodes，決策 9）

> 對應 BDD：`@search` 4 Scenario（含 `@partial-failure`「部分節點離線僅回傳可達節點」）+ `@edge-case @timeout` Outline「跨節點搜尋總逾時 10 秒」

| # | 測試名稱 | Given | When | Then |
|---|---------|-------|------|------|
| HDL-28 | 搜尋 fan-out 成功彙總 | 3 個線上節點皆回匹配服務 | GET `/api/v1/nodes/services/search?q=nginx` | 200 `{results:[{node_id,node_name,service,active,sub}], failed_nodes:[]}`；所有線上節點被查詢（並行） |
| HDL-29 | 僅查線上節點 | 節點 A 線上、B 離線 | 搜尋 | B **不被查詢**並列入 failed_nodes（reason: offline）（BDD @partial-failure） |
| HDL-30 | 部分節點失敗不阻塞 | A 回結果、B 逾時 | 搜尋 | A 的結果正常回傳；B 在 failed_nodes（reason: timeout）；**不阻塞其他節點** |
| HDL-31 | 總逾時 10s 部分結果先回 | 多節點慢速回應 | 搜尋（總 context 10s） | 逾時後回傳**已收集的部分結果** + failed_nodes（BDD Outline「逾時後回傳已可達節點的部分結果」） |
| HDL-32 | semaphore 上限 10 | 50 個線上節點同時查詢 | 搜尋 | 同時進行查詢 ≤10；全部完成無死鎖 |
| HDL-33 | q 空白參數驗證 | `?q=` 或無 q | 搜尋 | 400（缺少查詢字串） |

### 2.10 Handler — 401 安全驗證（決策 5/6/3.4）

> 對應 BDD：`@api @security` 401 Outline（9 endpoints）

| # | 測試名稱 | Given | When | Then |
|---|---------|-------|------|------|
| HDL-34 | 未登入 9 個節點 API 回 401（Outline ×9） | 無 session / 無 Bearer | 依序發送 GET/POST `/api/v1/nodes`、GET/PUT/DELETE `/api/v1/nodes/1`、POST `/api/v1/nodes/test-connection`、GET `/api/v1/nodes/summary`、GET `/api/v1/nodes/1/services`、GET `/api/v1/nodes/services/search?q=nginx` | 全部 **401 Unauthorized**（AuthMiddlewareComposite 攔截，決策 8） |
| HDL-35 | 未登入補充代理端點回 401 | 無 session | 依序 GET `/api/v1/nodes/1/info`、GET `/api/v1/nodes/1/services/nginx.service/logs`、POST `/api/v1/nodes/1/services/nginx.service/restart`、GET `/api/v1/agents/download?arch=amd64` | 全部 401（決策 6 route 表補充，D-8） |
| HDL-36 | 心跳路由不需 session | 已登出但帶節點 Bearer token | POST `/api/v1/agent/heartbeat` | 以 token 自證成功（群組外路由，決策 8）；無 token → 401 |

---

## 3. 前端單元測試

> 新增：`frontend/src/stores/__tests__/nodes.test.ts`、`frontend/src/views/__tests__/AggregateDashboardView.test.ts`、`NodeManagementView.test.ts`、`DashboardView.test.ts`、`frontend/src/components/__tests__/NodeCard.test.ts`、`NodeSwitcher.test.ts`、`NodeFormModal.test.ts`、`NodeDetailPanel.test.ts`、擴充 `api/client.test.ts` + `useWebSocket.test.ts`
> 沿用既有 pattern（@vue/test-utils + happy-dom + vi.mock api client / router）

### 3.1 stores/nodes.ts — 節點狀態 / summary / WS 事件（決策 8）

> 對應 BDD：`@aggregate` 統計 + `@heartbeat @websocket`「節點狀態變更即時推送」+「無需手動重整頁面」

| # | 測試名稱 | Given | When | Then |
|---|---------|-------|------|------|
| F-NS-01 | fetchNodes 載入節點列表 | mock listNodes 回 2 筆 | `fetchNodes()` | nodes state = 2 筆；失敗時 error state 且不覆蓋既有資料 |
| F-NS-02 | fetchSummary 載入統計 | mock getNodesSummary 回統計 | `fetchSummary()` | summary state = {total, online, degraded, offline, long_offline, warning, total_services, active_services, failed_services}（9 欄位與後端合約 3.2 #8 一致） |
| F-NS-03 | setActiveNode | node id | `setActiveNode(id)` | activeNodeId = id；null 表示 Aggregate |
| F-NS-04 | getter onlineNodes / byId | 混合狀態節點 | 存取 getter | onlineNodes 僅線上節點；byId(id) 正確 |
| F-NS-05 | applyNodeEvent node_status | WS 收到 `node_status`（含 node_id/status/last_heartbeat/version） | `applyNodeEvent(msg)` | 對應節點狀態/時間/版本更新 |
| F-NS-06 | node_online 事件 + Toast | WS 收到 `node_online` | 套用 | 節點狀態 → online；showToast「已恢復連線」 |
| F-NS-07 | node_offline 事件 + Toast | WS 收到 `node_offline` | 套用 | 節點狀態 → offline；showToast「{name} 已離線」 |
| F-NS-08 | node_removed 事件 | WS 收到 `node_removed` | 套用 | 節點從 nodes 移除（無需重整頁面） |
| F-NS-09 | 統計計算分類正確 | 節點狀態 = online×2 / degraded×1 / offline×1 / long_offline×1 / warning×1 | 重新計算 summary | online=2（線上台數**嚴格計** status==online）、degraded=1、warning=1（獨立欄位）、offline=1、long_offline=1（離線台數 = offline+long_offline = 2）；total=6（與 1.9.1 HandleNodesSummary 語意一致） |

### 3.2 AggregateDashboardView.vue — 統計列 / Cards / 搜尋 / 空狀態（決策 8/9）

> 對應 BDD：`@entry` + `@aggregate` 3 Scenario + `@search` 4 Scenario + `@node-detail`

| # | 測試名稱 | Given | When | Then |
|---|---------|-------|------|------|
| F-AD-01 | 載入顯示 spinner | GET nodes + summary 未回應 | mount | 顯示 loading spinner；**並行**發送兩個請求（BDD「系統並行發送 GET /api/v1/nodes 與 /api/v1/nodes/summary」） |
| F-AD-02 | 載入完成顯示統計列與 Cards | 回應回傳 | await | 頂部統計列（總節點數/線上/離線 + 總服務數/執行中/失敗）；Node Cards 網格 |
| F-AD-03 | 每張 Card 資訊完整 | 節點含 hostname/stats/last_heartbeat | 檢查 Card | 名稱、Hostname、狀態指示燈、服務統計（M/N 執行中）、最後心跳時間 |
| F-AD-04 | 無節點空狀態與引導 | GET 回空陣列 | await | 「尚無已註冊節點，請先新增節點」+ 導引至 Node Management 入口（BDD @aggregate） |
| F-AD-05 | 載入失敗錯誤 + 重試 | GET 回 500 | await 失敗 | 錯誤訊息 + 重試按鈕（智能補充：依賴失敗） |
| F-AD-06 | 搜尋 debounce 300ms | 輸入「nginx」 | 打字 | 停止輸入 **300ms** 後才發送 GET search?q=nginx（快速連續輸入只發一次） |
| F-AD-07 | 搜尋結果列表 | search 回 2 筆 | await | 顯示節點名稱、服務名稱、狀態 |
| F-AD-08 | 搜尋無結果空提示 | search 回空 | await | 「沒有找到匹配的服務」；可關閉返回 Card 視圖 |
| F-AD-09 | 部分節點失敗標示 | search 回 results + failed_nodes | await | 結果顯示可達節點；尾部「N 個節點無法查詢（離線/逾時）」（決策 9，BDD @partial-failure） |
| F-AD-10 | 點擊搜尋結果跳轉 + 展開 | 結果 web-server-01 / nginx.service | 點擊 | router → `/dashboard?node={id}&service=nginx.service`（決策 8：?service 初始展開） |
| F-AD-11 | 點擊線上節點 Card 切換視圖 | 線上節點 web-server-01 | 點擊 Card | router → `/dashboard?node={id}`（BDD @switch） |
| F-AD-12 | 點擊離線節點 Card 顯示離線面板 | 節點 offline | 點擊 Card | 顯示離線資訊面板（**非**切換視圖；BDD @node-detail 離線面板） |
| F-AD-13 | 長期離線 Card 移至底部/摺疊 | 含 long_offline 節點 | 檢查排序 | ⚫ 節點 Card 位於列表底部或摺疊（BDD @offline 長期離線） |
| F-AD-14 | 狀態燈顏色映射 | 4 種狀態節點 | 檢查 | online 🟢 / degraded 🟡 / offline 🔴 / long_offline ⚫ |
| F-AD-15 | 最後心跳相對時間 | last_heartbeat = 5s 前 | 檢查 Card | 顯示「最後心跳：5 秒前」 |
| F-AD-16 | 點「詳情」開啟資訊面板 | 點擊詳情按鈕 | 觸發 | 發送 GET `/api/v1/nodes/{id}/info`；側面板顯示（名稱/Hostname/Agent 版本/OS/上線時長/最後心跳 + 重新連線/編輯/移除按鈕） |
| F-AD-17 | 關閉搜尋返回 Card 視圖 | 搜尋結果開啟中 | 點關閉 | 返回 Card 網格視圖 |

### 3.3 NodeCard.vue — 狀態燈 / 服務統計 / 可點擊（決策 8）

> 對應 BDD：`@aggregate`「節點 Card 狀態指示燈依心跳狀態顯示不同顏色」

| # | 測試名稱 | Given | When | Then |
|---|---------|-------|------|------|
| F-NC-01 | Card 顯示完整資訊 | Node 完整資料 | mount | 名稱/Hostname/狀態燈/服務統計 M/N/最後心跳 |
| F-NC-02 | 狀態燈 4 色（Outline ×4） | 狀態 online/degraded/offline/long_offline | 依序 mount | 🟢🟡🔴⚫（BDD 節點 A/B/C/D） |
| F-NC-03 | 離線服務統計灰顯 | 節點 offline | mount | 服務統計區灰顯/半透明 |
| F-NC-04 | 線上節點可點擊 | 節點 online | click | emit click / 觸發切換邏輯 |
| F-NC-05 | 離線節點點擊行為 | 節點 offline | click | emit 顯示離線面板事件（非切換） |
| F-NC-06 | 「詳情」按鈕 | mount | click 詳情 | emit detail 事件 |

### 3.4 NodeSwitcher.vue — Header 節點切換（決策 8）

> 對應 BDD：`@switch`「從 Header 節點下拉選單切換」「所有節點返回」「選單列出所有節點及其狀態指示燈」

| # | 測試名稱 | Given | When | Then |
|---|---------|-------|------|------|
| F-SW-01 | 顯示目前節點名稱 | activeNodeId=web-server-01 | mount | Header 顯示「web-server-01」；無 active → 「所有節點」 |
| F-SW-02 | 下拉列出所有節點 + 狀態燈 | 4 種狀態節點 | 展開選單 | 每選項含名稱 + 🟢🟡🔴⚫ |
| F-SW-03 | 目前節點反白 | 位於 web-server-01 視圖 | 展開選單 | web-server-01 選項反白 |
| F-SW-04 | 選取節點切換視圖 | 選取 db-server-01 | 點擊選項 | setActiveNode(db-server-01)；router → `/dashboard?node={db id}`；服務列表重新載入 |
| F-SW-05 | 「所有節點」返回 Aggregate | 位於單節點視圖 | 點擊 | setActiveNode(null)；router → `/`；重新載入 Aggregate（BDD @switch） |

### 3.5 NodeFormModal.vue — 新增 / 編輯節點表單（決策 5/8）

> 對應 BDD：`@node-mgmt` Modal 3 Scenario + `@validation` + 測試連線 3 Scenario + 重複名稱 + 位址不可達 + 取消

| # | 測試名稱 | Given | When | Then |
|---|---------|-------|------|------|
| F-NF-01 | Modal 欄位完整 | 開啟新增 | 檢查表單 | 節點名稱（必填）、Agent 位址 host:port（必填）、TLS 憑證指紋（選填）、API Token（選填）、備註（選填）；底部「測試連線 / 註冊 / 取消」 |
| F-NF-02 | 必填欄位缺失攔截 | 名稱與位址空白 | 點「註冊」 | **不發送 POST /api/v1/nodes**；必填欄位紅色標示（BDD @validation） |
| F-NF-03 | 測試連線 loading | 點「測試連線」 | 檢查按鈕 | 按鈕 loading + disabled；POST test-connection 發送 |
| F-NF-04 | 測試連線成功提示 | test-connection 回 version/hostname/os | await | 綠色提示「連線成功 — Agent v1.2.3 @ web-server-01 (Ubuntu 22.04)」；Modal 保持開啟 |
| F-NF-05 | 測試連線失敗可重試（Outline ×2） | 回 connection refused / TLS certificate expired | await | 紅色提示「無法連線：{failure_msg}」；表單內容保留可修改重試 |
| F-NF-06 | 註冊成功關閉 + Toast | POST /nodes 200 | await | Modal 關閉；Toast「節點 web-server-01 已註冊並上線」；列表新增線上節點（BDD @happy-path） |
| F-NF-07 | 名稱重複拒絕保留表單 | POST 回 409 | await | Toast「節點名稱重複，請使用不同名稱」；**Modal 保持開啟**供修改 |
| F-NF-08 | 位址不可達仍註冊標離線 | POST 200 但節點離線（或註冊時連線失敗） | await | Toast「節點 db-server-01 已註冊但無法連線」；列表新增 🔴 離線節點 |
| F-NF-09 | 取消關閉無變更 | 已填部分資料 | 點「取消」 | Modal 關閉；節點列表不變、無新增 |
| F-NF-10 | 編輯模式預填 | 既有節點 | 開啟編輯 | 欄位預填目前設定（名稱/位址/備註）；Token 留空顯示「留空表示不變更」 |
| F-NF-11 | 註冊按鈕 loading | 驗證通過請求送出 | 檢查 | 註冊按鈕 loading + disabled（防重複送出） |

### 3.6 NodeManagementView.vue — 節點列表 / 移除 / 下載（決策 8）

> 對應 BDD：`@entry @node-mgmt` 列表 + 編輯 + 移除 3 Scenario + 下載 Agent

| # | 測試名稱 | Given | When | Then |
|---|---------|-------|------|------|
| F-NM-01 | 列表欄位完整 | GET nodes 回 2 筆 | mount | 表格欄位：名稱、位址、狀態、最後心跳、版本、操作；「新增節點」與「下載 Agent」按鈕 |
| F-NM-02 | 空列表狀態 | GET 回空 | mount | 顯示空狀態提示 |
| F-NM-03 | 新增節點開啟 Modal | 點「新增節點」 | click | 開啟 NodeFormModal |
| F-NM-04 | 編輯儲存更新列表 | 編輯 modal 送出 PUT 200 | await | 列表顯示更新後位址；Toast「節點設定已更新」 |
| F-NM-05 | 移除確認對話框 | 點「移除」 | click | ConfirmModal「確定要移除此節點？所有歷史資料將保留。」+ 確認/取消 |
| F-NM-06 | 確認移除節點消失 | DELETE 200 | 確認 | 節點從列表移除；Toast「節點已移除」（同時反映至 Aggregate） |
| F-NM-07 | 取消移除無變更 | 點「取消」 | click | 對話框關閉；節點保留 |
| F-NM-08 | 下載 Agent 選架構 | 點「下載 Agent」→ 選 amd64 | click | 觸發 GET `/api/v1/agents/download?arch=amd64` 下載（arm64 同，Outline ×2） |

### 3.7 DashboardView.vue — node-aware 改造（決策 8）

> 對應 BDD：`@switch`「點擊線上節點 Card 切換至單節點視圖」+ `@service` 操作/日誌/失敗 + `@offline`「操作按鈕禁用 + Banner」+ `@error-handling @timeout` + `@edge-case @concurrency` ×2 + `@search`「點擊結果展開」

| # | 測試名稱 | Given | When | Then |
|---|---------|-------|------|------|
| F-DV-01 | 讀取 ?node 設定 active 節點 | route.query.node = {id} | mount | nodesStore.setActiveNode({id})；服務 API 走 `/api/v1/nodes/{id}/...` 前綴 |
| F-DV-02 | 服務列表以代理 API 載入 | activeNodeId 存在 | mount | 呼叫 getNodeServices(nodeId)（非本機 /api/v1/services） |
| F-DV-03 | 操作按鈕發送節點前綴請求 | activeNodeId=web-server-01 | 點 restart | POST `/api/v1/nodes/{id}/services/nginx.service/restart`；按鈕 loading |
| F-DV-04 | 操作成功 Toast + 更新 | 200 | await | Toast「web-server-01 nginx.service 已重啟」；該列狀態更新；audit 由後端記錄 |
| F-DV-05 | 操作失敗 Toast 錯誤 + 狀態不變 | 500 「permission denied」 | await | Toast「web-server-01 nginx.service 重啟失敗：權限不足」；列表狀態維持不變（BDD @service @error-handling） |
| F-DV-06 | 操作逾時 Toast + 按鈕恢復 | 請求逾時（15s） | await 失敗 | Toast「web-server-01 操作逾時：nginx.service restart」；按鈕恢復可點擊（BDD @timeout） |
| F-DV-07 | 節點離線禁用操作 + Banner | 節點狀態 offline | mount / WS 事件 | 所有操作按鈕（start/stop/restart/enable/disable）disabled；頂部黃色 Banner「節點已離線，操作不可用」（BDD @offline） |
| F-DV-08 | 同節點同服務 in-flight 禁用 | restart 進行中 | 再點 stop | stop 按鈕 disabled；系統拒絕第二個並行操作（BDD @concurrency；決策 9 前端 in-flight） |
| F-DV-09 | 不同節點可並行 | web-server-01 restart 中 + db-server-01 restart | 同時操作 | 兩者皆可操作互不影響（BDD @concurrency；in-flight 鍵為 node+service） |
| F-DV-10 | 檢視日誌走節點端點 | activeNodeId 存在 | 點「查看日誌」 | GET `/api/v1/nodes/{id}/services/nginx.service/logs`；日誌檢視器顯示 |
| F-DV-11 | ?service= 初始展開 | route.query.service=nginx.service | mount | 服務列表自動展開 nginx.service（BDD @search 點擊結果跳轉展開） |
| F-DV-12 | 無節點時向後相容 | 無 ?node 且無註冊節點 | mount | 維持原單機 Dashboard 行為（本機 /api/v1/services） |

### 3.8 NodeDetailPanel.vue — 節點詳細 / 離線診斷（決策 8）

> 對應 BDD：`@node-detail` 2 Scenario + `@error-handling @version`「版本不相容警告」

| # | 測試名稱 | Given | When | Then |
|---|---------|-------|------|------|
| F-ND-01 | 線上節點資訊面板 | GET info 回 OS/uptime 等 | 開啟 | 顯示名稱/Hostname/Agent 版本/OS 資訊/上線時長/最後心跳；底部「重新連線 / 編輯設定 / 移除節點」 |
| F-ND-02 | 離線診斷面板 | 節點 offline | 點離線 Card | 顯示最後上線時間、最後心跳時間、離線持續時間、Agent 版本、Hostname、操作建議（檢查 Agent 是否執行）、「重新連線 / 移除節點」按鈕 |
| F-ND-03 | 版本不相容警告 Tooltip | 節點 status=warning、agent_version=v1.0 | 檢查 | 🟡 警告 + Tooltip「Agent 版本過舊 (v1.0)，建議升級至 v1.2+」（BDD @version） |

### 3.9 api/client.ts + useWebSocket 擴充

> 對應 BDD：全部節點 API 契約 + `@heartbeat @websocket`「狀態變更即時推送」+ `@integration @websocket`「WS 斷線自動重連」

| # | 測試名稱 | Given | When | Then |
|---|---------|-------|------|------|
| F-AP-01 | listNodes | — | call | axios GET `/api/v1/nodes` |
| F-AP-02 | createNode | 表單資料 | call | axios POST `/api/v1/nodes`，body 含 name/address/tls_fingerprint/token/notes |
| F-AP-03 | updateNode | id + 設定 | call | axios PUT `/api/v1/nodes/{id}` |
| F-AP-04 | deleteNode | id | call | axios DELETE `/api/v1/nodes/{id}` |
| F-AP-05 | testConnection | address + TLS 設定 | call | axios POST `/api/v1/nodes/test-connection`；502 可解析 error 供 Toast |
| F-AP-06 | getNodeServices | nodeId | call | axios GET `/api/v1/nodes/{id}/services` |
| F-AP-07 | nodeServiceAction | nodeId + name + action | call | axios POST `/api/v1/nodes/{id}/services/{name}/{action}` |
| F-AP-08 | getNodeLogs | nodeId + name + lines | call | axios GET `/api/v1/nodes/{id}/services/{name}/logs?lines=` |
| F-AP-09 | searchServices | q | call | axios GET `/api/v1/nodes/services/search?q=` |
| F-AP-10 | getNodeInfo | nodeId | call | axios GET `/api/v1/nodes/{id}/info` |
| F-AP-11 | getNodesSummary | — | call | axios GET `/api/v1/nodes/summary` |
| F-AP-12 | downloadAgent | arch | call | axios GET `/api/v1/agents/download?arch=`（responseType blob 或 window 下載） |
| F-AP-13 | WS handlers 註冊/移除 | useWebSocket | mount / unmount | `node_status` / `node_online` / `node_offline` / `node_removed` 4 個 handler 註冊（更新 store + Toast）；unmount 移除 |
| F-AP-14 | WS 斷線自動重連 | WebSocket 連線中斷 | 偵測斷線 | useWebSocket 自動重連；重連後恢復節點狀態即時更新（BDD @integration @websocket） |

---

## 4. 整合測試

> 對應 BDD：`@integration` 全部 7 個 Scenario（Outline ×5 + ×2）+ `@business-rules @data` + 全鏈路驗證
> 方式：`go test`（integration；temp dir 佈建 nodes.json + 真實 mock Agent TLS server + mock systemd）+ curl 腳本

| # | 測試名稱 | 整合範圍 | 操作步驟 | 預期結果 |
|---|---------|---------|---------|---------|
| INT-01 | Manager ↔ Agent 完整代理通訊 | Agent server + AgentClient + proxy handler | 1. 以 httptest.NewTLSServer 起 mock Agent（自簽憑證 + token middleware + mock systemd）<br>2. Manager registry 註冊該節點（含指紋 pin）<br>3. GET `/api/v1/nodes/{id}/services` | Manager 透過 HTTPS + Bearer token 代理成功；回傳 Agent 服務列表；無系統 CA 依賴（指紋 pin 生效） |
| INT-02 | 心跳→狀態機→推播全鏈路 | Heartbeat handler + Registry + Supervisor + Hub | 1. Agent 心跳 client 啟動（10s ticker）→ POST heartbeat<br>2. supervisor tick 掃描<br>3. 停止心跳 30s → 再恢復 | last_heartbeat 持續更新；停止後 30s 節點轉 offline 並推播 `node_offline`；恢復心跳後轉 online 推播 `node_online`（時間可壓縮/注入 clock） |
| INT-03 | 註冊→上線→離線→恢復完整流程 | Registry + Heartbeat + Supervisor + 前端 store | 1. 建立節點（nodes.json 寫入）<br>2. mock Agent 心跳<br>3. 中斷 → 恢復 | 註冊後 🟢；30s 無心跳 🔴（含 header 統計 -1/+1）；寬限期內恢復 🟢；全程 WS 事件推送（對應 BDD @integration @offline「Agent 離線 → Dashboard 更新 → Agent 恢復」） |
| INT-04 | 操作代理端到端 + audit | Proxy handler + AgentClient + Agent server + mock systemd + audit | 1. 對節點 nginx.service 依序 start/stop/restart/enable/disable（Outline ×5）<br>2. 檢查 audit JSONL | mock systemd 依序收到對應操作；audit 每筆含 action + **node_id + node_name**；日誌查詢亦驗證（BDD @integration Outline + 日誌流程） |
| INT-05 | 跨節點搜尋多 Agent 部分失敗 | Search handler + 多 mock Agent | 1. 3 個 mock Agent（2 線上 1 離線/慢速）<br>2. GET search?q=nginx | results 僅含 2 個可達節點；failed_nodes 含離線節點（reason）；（對應 BDD @integration「跨節點搜尋在部分節點離線時仍回傳可達節點的結果」） |
| INT-06 | TLS / mTLS 端到端 | AgentClient + Agent server TLS 設定 | 1. 自簽憑證 + 指紋 pin 連線（有效）<br>2. 憑證過期/指紋不符連線（無效）<br>3. 啟用 mTLS 雙向驗證 | 有效憑證連線成功並正常收發心跳與操作；無效 → 連線拒絕 + TLS 驗證錯誤（BDD @integration @tls Outline ×2） |
| INT-07 | Manager 重啟重連 + 寬限期 | Registry 持久化 + Supervisor bootTime + Heartbeat | 1. 註冊節點 → 寫入 nodes.json<br>2. 模擬重啟（重新 Load + RunSupervisor）<br>3. 健康檢查/心跳回流 | 節點設定保留；啟動 30s 寬限期內離線**不推播** node_offline；心跳回流後自動 🟢（BDD @restart「Manager 重啟後所有 Agent 自動重連」） |
| INT-08 | 節點 CRUD 端到端 + 檔案持久化 | Handler + Registry + 檔案系統 | 1. POST 建立節點<br>2. 讀 nodes.json<br>3. GET → PUT → DELETE<br>4. 檢查 audit | nodes.json 為合法 JSON（atomic 無 .tmp）；CRUD 各自生效；DELETE 後 Audit 紀錄仍保留（BDD @data「移除節點時保留其歷史資料與 Audit Log」） |
| INT-09 | WebSocket 即時更新端到端 | Hub + Supervisor + 前端 store | 1. 兩個 WebSocket 客戶端連線<br>2. 觸發節點狀態變更<br>3. 中斷一條連線再重連 | 兩個客戶端皆收到 `node_status` 事件；斷線客戶端重連後恢復接收（BDD @heartbeat @websocket「兩個管理員瀏覽器皆即時更新」） |

---

## 5. 端對端測試（Playwright）

> 對應 BDD：`@smoke` `@happy-path` `@p0` `@p1` `@error-handling` `@edge-case` `@business-rules` `@security` `@integration` + 全部 Scenario Outline
> 測試檔建議：`frontend/e2e/014-multi-node-agent-management.spec.ts`（Playwright + 後端測試服務或 mock Agent）

### 5.1 Aggregate Dashboard（`@entry` `@aggregate`）

| # | 測試名稱 | 操作步驟 | 預期結果 |
|---|---------|---------|---------|
| E2E-01 | 登入後預設進入 Aggregate Dashboard | 1. 登入管理員<br>2. 等待載入 | 路由為 `/`；GET `/api/v1/nodes` 與 `/api/v1/nodes/summary` 被並行呼叫；顯示頂部統計列與 Node Cards 網格（BDD @entry @smoke） |
| E2E-02 | 頂部統計列數值正確 | 1. 預置 3 節點（2 線上 1 離線）<br>2. 進入 Aggregate | 統計列：總節點數 3、線上台數 2、離線台數 1；總服務數/執行中/失敗與心跳統計一致（BDD @aggregate） |
| E2E-03 | Node Cards 網格資訊完整 | 1. 預置 2 節點含 hostname/stats | 每 Card 顯示名稱、Hostname、狀態燈、服務統計（M/N）、最後心跳（BDD @aggregate） |
| E2E-04 | 無節點空狀態 | 1. 無任何註冊節點<br>2. 進入 Aggregate | 「尚無已註冊節點，請先新增節點」+ 導引至 Node Management 的入口（BDD @aggregate） |
| E2E-05 | 4 種狀態燈顯示 | 1. 預置 4 節點（online/degraded/offline/long_offline） | 依序 🟢🟡🔴⚫（BDD @aggregate 狀態指示燈；Outline 4 態） |

### 5.2 節點切換（`@switch`）

| # | 測試名稱 | 操作步驟 | 預期結果 |
|---|---------|---------|---------|
| E2E-06 | 點擊線上節點 Card 切換單節點視圖 | 1. Aggregate 顯示線上節點 web-server-01<br>2. 點擊該 Card | URL → `/dashboard?node={id}`；GET `/api/v1/nodes/{id}/services` 發送；Header 顯示節點名稱 + 下拉；服務列表載入（BDD @switch @p0 @smoke） |
| E2E-07 | Header 下拉切換節點 | 1. 位於 web-server-01 視圖<br>2. 下拉選 db-server-01 | 視圖切換至 db-server-01；Header 名稱更新；服務列表重新載入 |
| E2E-08 | 「所有節點」返回 Aggregate | 1. 位於單節點視圖<br>2. 點「所有節點」 | 路由回 `/`；重新載入 Aggregate 與匯總統計 |
| E2E-09 | 下拉列出所有節點 + 狀態燈 + 反白 | 1. 位於單節點視圖 | 選單列出所有節點（含 🟢🟡🔴⚫）；目前節點反白 |

### 5.3 單節點服務操作（`@service`，Outline ×5）

| # | 測試名稱 | 操作步驟 | 預期結果 |
|---|---------|---------|---------|
| E2E-10 | 啟動服務 | 1. 單節點視圖（web-server-01）<br>2. 點 nginx.service「啟動」 | 按鈕 loading；POST `/api/v1/nodes/{id}/services/nginx.service/start`；Toast「web-server-01 nginx.service 已啟動」；該列狀態更新（Outline row 1） |
| E2E-11 | 停止服務 | 同上，點「停止」 | Toast「…已停止」（Outline row 2） |
| E2E-12 | 重啟服務 | 同上，點「重啟」 | Toast「…已重啟」（Outline row 3） |
| E2E-13 | 啟用服務 | 同上，點「啟用」 | Toast「…已啟用」（Outline row 4） |
| E2E-14 | 停用服務 | 同上，點「停用」 | Toast「…已停用」（Outline row 5） |
| E2E-15 | 檢視服務日誌 | 1. 單節點視圖<br>2. 點「查看日誌」 | GET `/api/v1/nodes/{id}/services/nginx.service/logs`；日誌檢視器顯示該節點 journal 內容（BDD @service 日誌） |
| E2E-16 | 操作失敗顯示錯誤 | 1. 攔截操作 API 回 500 permission denied | Toast「web-server-01 nginx.service 重啟失敗：權限不足」；服務列表狀態不變（BDD @service @error-handling） |

### 5.4 跨節點搜尋（`@search`）

| # | 測試名稱 | 操作步驟 | 預期結果 |
|---|---------|---------|---------|
| E2E-17 | 跨節點搜尋服務 | 1. Aggregate 搜尋框輸入「nginx」<br>2. 等待 debounce | 停止輸入 300ms 後發送 GET `/api/v1/nodes/services/search?q=nginx`；結果列表顯示節點名稱、服務名稱、狀態（BDD @search @p0 @smoke） |
| E2E-18 | 點擊結果跳轉並展開 | 1. 搜尋結果含「web-server-01 / nginx.service」<br>2. 點擊該結果 | 切換至 `/dashboard?node={id}&service=nginx.service`；服務列表自動展開 nginx.service |
| E2E-19 | 搜尋無匹配空提示 | 1. 輸入「mysql」（無匹配） | 「沒有找到匹配的服務」；可關閉返回 Card 視圖 |
| E2E-20 | 部分節點離線部分結果 | 1. db-server-01 離線、web-server-01 線上（皆有 nginx）<br>2. 搜尋「nginx」 | 僅顯示 web-server-01 結果；「N 個節點無法查詢（離線/逾時）」（BDD @partial-failure） |

### 5.5 節點詳細資訊（`@node-detail`）

| # | 測試名稱 | 操作步驟 | 預期結果 |
|---|---------|---------|---------|
| E2E-21 | 查看節點詳情面板 | 1. Aggregate 點 Card「詳情」 | GET `/api/v1/nodes/{id}/info`；側面板顯示名稱/Hostname/Agent 版本/OS/上線時長/最後心跳 + 重新連線/編輯/移除按鈕（BDD @node-detail） |
| E2E-22 | 離線節點離線資訊面板 | 1. 節點 🔴 離線<br>2. 點擊離線 Card | 顯示最後上線時間、最後心跳、離線持續時間、Agent 版本、Hostname、操作建議 + 重新連線/移除按鈕（BDD @node-detail 離線面板） |

### 5.6 Node Management（`@node-mgmt` `@agent @download`）

| # | 測試名稱 | 操作步驟 | 預期結果 |
|---|---------|---------|---------|
| E2E-23 | 進入 Node Management 列表 | 1. 點 Header「Node Management」 | 路由 `/nodes`；表格欄位：名稱、位址、狀態、最後心跳、版本、操作；「新增節點」+「下載 Agent」按鈕（BDD @entry @node-mgmt） |
| E2E-24 | 新增節點 Modal 欄位 | 1. 點「新增節點」 | Modal 含名稱（必填）、位址（必填）、TLS 指紋（選填）、Token（選填）、備註（選填）；底部「測試連線 / 註冊 / 取消」 |
| E2E-25 | 必填缺失攔截 | 1. 名稱與位址空白<br>2. 點「註冊」 | 前端攔截不發送 POST；必填欄位紅色標示（BDD @validation） |
| E2E-26 | 測試連線成功 | 1. 填入位址 10.0.0.5:8443<br>2. 點「測試連線」 | POST test-connection；綠色提示「連線成功 — Agent v1.2.3 @ web-server-01 (Ubuntu 22.04)」；Modal 保持開啟（BDD @smoke） |
| E2E-27 | 測試連線失敗（connection refused） | 1. 填入 10.0.0.9:8443（不可達）<br>2. 測試連線 | 紅色提示「無法連線：connection refused」；可修正重試（Outline row 1） |
| E2E-28 | 測試連線失敗（TLS 過期） | 1. 填入憑證過期的位址 | 紅色提示「無法連線：TLS 憑證驗證失敗：certificate expired」（Outline row 2） |
| E2E-29 | 註冊成功立即上線 | 1. 名稱 web-server-01、可達位址<br>2. 點「註冊」 | POST /nodes 儲存；建立連線收心跳；Modal 關閉；列表新增 🟢；Toast「節點 web-server-01 已註冊並上線」（BDD @smoke） |
| E2E-30 | 名稱重複拒絕 | 1. 已存在 web-server-01<br>2. 同名註冊 | 後端拒絕；Toast「節點名稱重複，請使用不同名稱」；Modal 保持開啟（BDD @duplicate） |
| E2E-31 | 位址不可達仍儲存離線 | 1. 名稱 db-server-01、不可達位址 | 節點仍儲存；列表新增 🔴；Toast「節點 db-server-01 已註冊但無法連線」（BDD @error-handling） |
| E2E-32 | 取消新增無變更 | 1. 開啟表單填部分<br>2. 點「取消」 | Modal 關閉；列表不變 |
| E2E-33 | 編輯節點更新 | 1. 點節點「編輯」改位址<br>2. 儲存 | PUT /nodes/{id}；列表顯示新位址；Toast「節點設定已更新」 |
| E2E-34 | 移除確認對話框 | 1. 點節點「移除」 | 確認框「確定要移除此節點？所有歷史資料將保留。」+ 確認/取消 |
| E2E-35 | 確認移除節點消失 | 1. 確認移除 | DELETE /nodes/{id}；節點從列表與 Aggregate 消失；Toast「節點已移除」（BDD @happy-path） |
| E2E-36 | 取消移除無變更 | 1. 點「取消」 | 對話框關閉；節點保留 |
| E2E-37 | 下載 Agent（amd64） | 1. 點「下載 Agent」選 amd64 | 瀏覽器下載 agent-linux-amd64 binary（Outline row 1） |
| E2E-38 | 下載 Agent（arm64） | 1. 同上選 arm64 | 下載 agent-linux-arm64 binary（Outline row 2） |

### 5.7 心跳與離線（`@heartbeat` `@offline` `@websocket`）

| # | 測試名稱 | 操作步驟 | 預期結果 |
|---|---------|---------|---------|
| E2E-39 | 30 秒無心跳標離線 | 1. Agent 上線<br>2. 停止心跳 30s | 節點 Card 變 🔴；服務統計灰顯；「最後心跳：X 秒前」；Header 統計（線上 -1、離線 +1）；Toast「web-server-01 已離線」（BDD @offline @p0 @smoke） |
| E2E-40 | 離線視圖禁用 + Banner | 1. 位於 web-server-01 單節點視圖<br>2. 節點轉離線 | 所有操作按鈕禁用；頂部黃色 Banner「節點已離線，操作不可用」（BDD @offline @p1） |
| E2E-41 | 寬限期內恢復上線 | 1. 節點離線 60s（<300s）<br>2. Agent 重連恢復心跳 | 自動回 🟢；Toast「web-server-01 已恢復連線」；服務狀態重新載入（BDD @offline @p0 @smoke） |
| E2E-42 | 超過 300s 長期離線 | 1. 節點離線超過 300s | 狀態 ⚫ 長期離線；Card 移至底部/摺疊（BDD @offline @p1） |
| E2E-43 | WS 即時推送雙瀏覽器 | 1. 兩個瀏覽器開啟 Aggregate<br>2. 觸發節點狀態變更 | 兩個瀏覽器皆即時更新（無需重整）（BDD @heartbeat @websocket） |

### 5.8 異常與邊界（`@error-handling` `@edge-case` `@business-rules` `@integration`）

| # | 測試名稱 | 操作步驟 | 預期結果 |
|---|---------|---------|---------|
| E2E-44 | Agent 掛掉重啟自動恢復 | 1. 停止 Agent 程序（心跳中斷）<br>2. 節點 🔴<br>3. 重啟 Agent | Agent 重新發送註冊/心跳；節點自動 🟢；Toast「已恢復連線」（BDD @agent-crash） |
| E2E-45 | 操作逾時 15 秒 | 1. 攔截操作 API 延遲 >15s | Toast「web-server-01 操作逾時：nginx.service restart」；按鈕恢復可點擊；可重試（BDD @timeout） |
| E2E-46 | 同節點同服務不並行 | 1. 對 nginx.service 執行重啟（進行中）<br>2. 嘗試再執行停止 | stop 按鈕 disabled；系統拒絕第二個並行操作（BDD @concurrency @p0） |
| E2E-47 | 不同節點可並行 | 1. web-server-01 restart 中<br>2. db-server-01 同時 restart | 兩操作並行互不影響（BDD @concurrency @p1） |
| E2E-48 | TLS 憑證過期 → 離線 → 更新恢復 | 1. Agent 端憑證過期 → Manager 連線失敗 → 🔴<br>2. 更新憑證並同步指紋 | 節點恢復上線（BDD @error-handling @tls） |
| E2E-49 | 版本不相容警告 | 1. Agent 心跳帶 v1.0（Manager min 1.2.0） | 節點 🟡 警告；Tooltip「Agent 版本過舊 (v1.0)，建議升級至 v1.2+」（BDD @version） |
| E2E-50 | 50 節點上限 | 1. API 層預置 50 節點<br>2. 嘗試註冊第 51 個 | 後端拒絕；Toast 說明節點數量已達上限（BDD @node-limit） |
| E2E-51 | 心跳機制三規則（Outline ×3） | 1. Agent 正常 10s 心跳 → last_heartbeat 更新<br>2. 停止 30s → 🔴<br>3. 超過 300s → ⚫ | 三種 threshold 各自符合規則（Outline rows 1-3） |
| E2E-52 | 逾時規則兩類型（Outline ×2） | 1. 單一服務操作逾時 15s → 失敗提示<br>2. 跨節點搜尋逾時 10s → 部分結果先回 | 依操作類型套用不同 timeout_rule（Outline rows 1-2） |
| E2E-53 | Manager 重啟自動重連 | 1. Manager + 多 Agent 運作中<br>2. 重啟 Manager | 各 Agent 依設定自動重連；連線成功節點 🟢；**啟動後 30 秒內不觸發離線通知**（BDD @restart） |
| E2E-54 | 未登入 401（Outline ×9） | 無驗證資訊 | 依序發送 9 個節點 API 請求 | 全部 401 Unauthorized（BDD @security Outline ×9） |
| E2E-55 | registry 持久化重啟保留 | 1. 註冊節點<br>2. 重啟 Manager | 節點設定保留；依 registry 自動重連（BDD @data 持久化） |
| E2E-56 | 移除節點歷史保留 | 1. 節點有歷史 Audit<br>2. 移除節點<br>3. 檢視 Audit Log | 節點註冊移除；歷史資料與 Audit Log 紀錄仍保留（BDD @data） |

---

## 6. 手動驗證（真實環境）

> 對應 BDD：`@edge-case` `@integration` `@agent` `@error-handling` — 真實多機 / TLS 憑證 / 真實網路 / 壓力情境才可驗證的場景

| # | 情境 | 驗證步驟 | 預期 |
|---|------|---------|------|
| MAN-01 | 真實多 Agent 環境（3+ 台機器） | 1. 3 台 Linux 機器部署 Agent（含不同 OS 版本）<br>2. Manager 註冊全部節點<br>3. 開啟 Aggregate Dashboard | Dashboard 正確顯示 3 張 Cards、統計列（3/3/0）；各節點服務統計與最後心跳正確（BDD @integration Manager + 3 Agents） |
| MAN-02 | Agent 完整部署流程 | 1. 從 Manager 下載 agent binary<br>2. scp + chmod +x<br>3. 建立 /etc/linux-service-manager/agent.yaml<br>4. systemctl start linux-service-agent | Agent 啟動 → Manager 節點變 🟢（node_name 比對既有離線節點可恢復）；重啟 Agent 服務後自動恢復連線（BDD @agent @agent-crash） |
| MAN-03 | 真實 TLS / mTLS 憑證 | 1. 以正式 CA 簽發憑證部署（TLS 單向）<br>2. 再以 mTLS 雙向啟用（Agent 驗證 Manager 憑證） | 兩種模式通訊正常（心跳 + 操作）；HTTP 明文連線回 426（BDD @tls Outline ×2） |
| MAN-04 | Manager 重啟 50 節點重連壓力 | 1. 註冊 50 個節點（mock 或真實）<br>2. 重啟 Manager | 健康檢查非阻塞並行完成；30s 寬限期內無離線通知風暴；心跳回流後全部 🟢（BDD @restart） |
| MAN-05 | 真實網路中斷 | 1. 拔除節點網路線/防火牆阻擋 60s<br>2. 恢復網路 | 離線 30s 後 🔴 + Toast；寬限期內恢復 → 無縫回 🟢 無需手動介入（BDD @network） |
| MAN-06 | 跨節點搜尋部分失敗（真實） | 1. 一節點真實離線、一節點正常<br>2. 搜尋 | 僅可達節點結果；「無法查詢」標示；不阻塞（BDD @partial-failure） |
| MAN-07 | 真實 Agent 版本不相容 | 1. 部署舊版 Agent binary（< min version） | 節點 🟡 警告 + Tooltip；心跳與操作不被阻斷；下載新版後恢復（BDD @version） |
| MAN-08 | 多 Manager 連線同一 Agent | 1. Agent 設定檔 manager_addr 指向 Manager A<br>2. 用 Manager B 註冊並連線 | Agent 拒絕第二個 Manager（token 不符 401）；Manager B 該節點顯示 🔴；檢查 agent.yaml 修正（BDD @multi-manager） |
| MAN-09 | 節點上限 50 壓力測試 | 1. 註冊至 50 節點<br>2. 嘗試第 51 個 | 第 51 個被拒絕；50 節點下 Aggregate 載入/搜尋效能可接受（BDD @node-limit） |
| MAN-10 | 心跳風暴（多節點同時離線/恢復） | 1. 同時中斷多個 Agent 心跳<br>2. 同時恢復 | supervisor 5s 批次掃描 + 狀態變更才推播；Toast 以節點為單位不重複廣播；jitter 避免節點對齊（決策 3/10） |
| MAN-11 | nodes.json 權限與 token 遮蔽 | 1. 註冊節點<br>2. `ls -la /var/lib/linux-service-manager/nodes.json`<br>3. 檢視 API 回應 | 檔案權限 0600；API 回應 token masked `lsm_node_****xxxx`；檔案含完整 token（僅本機可讀）（決策 5 風險緩解） |
| MAN-12 | Agent 離線時本地直接操作 | 1. 節點與 Manager 斷連<br>2. 直接瀏覽器存取該節點 Agent（https://agent:8443） | Agent 仍提供完整 JSON API（services/操作/日誌，僅無前端）；本機操作可執行（BDD @agent @business-rules；驗證 Agent 不依賴 Manager） |
| MAN-13 | TLS 憑證過期真實情境 | 1. 讓 Agent 憑證到期（或改系統時間）<br>2. 觀察節點<br>3. 更新憑證 + Manager 同步指紋 | 連線失敗 → 🔴；更新後恢復 🟢；錯誤訊息可辨識（BDD @tls） |
| MAN-14 | 大規模並行操作 | 1. 對不同節點同時執行多個服務操作（如 5 節點 × 各 3 服務） | 操作並行執行互不影響；audit 每筆含正確 node_id/node_name；無資源耗盡（BDD @concurrency 不同節點可並行） |

---

## 7. 測試環境

| 項目 | 需求 |
|------|------|
| Go 版本 | 1.24.4（module `linux-service-manager`，`src/go.mod`；Agent 為同 module 第二個 entry point `src/cmd/agent`，`go build ./cmd/agent`） |
| 後端依賴 | chi/v5 v5.3.1、gorilla/websocket v1.5.3、gorilla/sessions、godbus/dbus/v5；`gopkg.in/yaml.v2` indirect → direct（Agent agent.yaml，**零新增 module**） |
| Node.js 版本 | 22+（對應專案 `.nvmrc`） |
| 前端框架 | Vue 3.5.40 + Pinia 4.0.2 + Vue Router 4.6.4 + axios |
| 前端測試 | Vitest 4.1.10 + @vue/test-utils 2.4.11 + happy-dom 20.11.1 |
| E2E 測試 | Playwright 1.62.1（Chromium 內建；雙瀏覽器情境可開 2 個 page） |
| 後端測試 | `go test` + `net/http/httptest` / `httptest.NewTLSServer`（mock Agent，自簽憑證）/ 注入 mock `systemd.ServiceManager`（`cd src && go test ./...`） |
| 測試瀏覽器 | Chromium（Playwright）、Chrome、Firefox、Edge（手動） |
| 測試 OS | Linux（Ubuntu 22.04+ / Debian 12+），具 systemd 1.x 與 D-Bus |
| 多機環境（手動） | ≥3 台 Linux 機器（不同 OS 版本）、真實或自簽 TLS 憑證、可拔線的網路環境（MAN-01~05、MAN-13） |
| 資料檔（測試） | `/var/lib/linux-service-manager/nodes.json`（測試環境可置 temp dir）、`agent.yaml`（`/etc/linux-service-manager/`） |
| mock Agent 工具 | `httptest.NewTLSServer` + token middleware + mock systemd（整合/E2E 用）；本地 mock Manager heartbeat 接收器 |
| CI 整合 | `cd src && go test ./... && go build ./cmd/agent && cd frontend && npm test && npx playwright test`（agent binary 平行建置 amd64/arm64） |

---

## 8. 缺陷追蹤模板

| 欄位 | 說明 |
|------|------|
| ID | BUG-NODE-XXX |
| 測試案例 | 對應以上測試編號（如 SYS-22 / HDL-20 / F-DV-07 / E2E-39） |
| 來源 BDD Scenario | 對應 BDD Scenario 名稱 |
| 嚴重程度 | P0(阻擋) / P1(主要) / P2(次要) |
| 重啟步驟 | 逐步操作 |
| 預期 vs 實際 | 對照 |
| 環境 | Go 版本 / Node 版本 / OS / systemd 版本 / 瀏覽器 / Manager 與 Agent 版本 / TLS 模式 |

---

## 9. BDD Scenario 覆蓋矩陣

以下矩陣確保 69 個 BDD Scenario 全數對應至少一個測試案例（含 Scenario Outline 全部 Examples 展開）。

| # | BDD Scenario | 單元測試 | 整合測試 | E2E 測試 | 手動驗證 |
|---|-------------|:---:|:---:|:---:|:---:|
| 1 | 登入後預設進入 Aggregate Dashboard 並載入節點匯總資料（@entry @p0 @smoke） | F-AD-01~02 | — | E2E-01 | — |
| 2 | Aggregate Dashboard 顯示頂部統計列與節點狀態摘要（@aggregate @p0 @smoke） | F-AD-02~03, F-NS-09, HDL-15 | INT-05 | E2E-02, E2E-03 | MAN-01 |
| 3 | 節點 Card 狀態指示燈依心跳狀態顯示不同顏色（@aggregate @p0 @smoke） | F-NC-02, F-AD-14, SYS-20~25 | — | E2E-05 | — |
| 4 | 無註冊節點時顯示空狀態與引導（@aggregate @p1） | F-AD-04 | — | E2E-04 | — |
| 5 | 點擊線上節點 Card 切換至單節點視圖（@switch @p0 @smoke） | F-AD-11, F-DV-01, F-AP-06 | — | E2E-06 | — |
| 6 | 從 Header 節點下拉選單切換至其他節點（@switch @p1） | F-SW-02~04 | — | E2E-07 | — |
| 7 | 點擊「所有節點」返回 Aggregate Dashboard（@switch @p1） | F-SW-05 | — | E2E-08 | — |
| 8 | 節點下拉選單列出所有節點及其狀態指示燈（@switch @p1） | F-SW-02~03 | — | E2E-09 | — |
| 9 | 在選定節點上執行「<action>」操作成功（Outline ×5：start/stop/restart/enable/disable，@service @p0 @smoke） | F-DV-03~04, HDL-22 | INT-04 | E2E-10~14 | — |
| 10 | 在單節點視圖檢視服務日誌（@service @p1） | F-DV-10, HDL-25, SYS-52 | INT-04 | E2E-15 | — |
| 11 | 服務操作失敗時顯示錯誤原因並寫入 Audit Log（@service @error-handling @p0） | F-DV-05, HDL-24 | INT-04（失敗路徑） | E2E-16 | — |
| 12 | 在 Aggregate Dashboard 跨節點搜尋服務（@search @p0 @smoke） | F-AD-06~07, HDL-28 | INT-05 | E2E-17 | — |
| 13 | 點擊搜尋結果跳轉至對應節點並展開服務（@search @p1） | F-AD-10, F-DV-11 | — | E2E-18 | — |
| 14 | 搜尋無匹配結果時顯示空提示（@search @p1） | F-AD-08, HDL-33 | — | E2E-19 | — |
| 15 | 部分節點離線時搜尋僅回傳可達節點的結果（@search @error-handling @p1 @partial-failure） | F-AD-09, HDL-29~30 | INT-05 | E2E-20 | MAN-06 |
| 16 | 查看節點詳細資訊面板（@node-detail @p0） | F-AD-16, F-ND-01, HDL-26 | — | E2E-21 | — |
| 17 | 離線節點 Card 點擊顯示離線資訊面板（@node-detail @p1） | F-NC-05, F-ND-02 | — | E2E-22 | — |
| 18 | 進入 Node Management 頁面顯示已註冊節點列表（@entry @node-mgmt @p0 @smoke） | F-NM-01~02 | — | E2E-23 | — |
| 19 | 點擊「新增節點」彈出表單 Modal（@node-mgmt @p0） | F-NF-01 | — | E2E-24 | — |
| 20 | 必填欄位缺失時標示紅色提示且不發送請求（@node-mgmt @p0 @validation） | F-NF-02 | — | E2E-25 | — |
| 21 | 測試連線成功顯示 Agent 資訊（@node-mgmt @p0 @smoke） | F-NF-03~04, HDL-11 | INT-01 | E2E-26 | — |
| 22 | 測試連線失敗顯示「<failure_msg>」且可修正重試（Outline ×2：connection refused / certificate expired，@error-handling @p0） | F-NF-05, HDL-12~14 | INT-01（失敗路徑） | E2E-27, E2E-28 | — |
| 23 | 註冊成功且連線成功時節點立即上線（@node-mgmt @p0 @smoke） | F-NF-06, HDL-02, SYS-04 | INT-03, INT-08 | E2E-29 | MAN-02 |
| 24 | 節點名稱重複時註冊被拒絕並返回表單（@error-handling @p0 @duplicate） | F-NF-07, HDL-03, SYS-05 | — | E2E-30 | — |
| 25 | 註冊時位址不可達則節點仍儲存但標示離線（@error-handling @p0） | F-NF-08 | INT-03 | E2E-31 | — |
| 26 | 取消新增節點關閉 Modal 不產生任何變更（@node-mgmt @p1） | F-NF-09 | — | E2E-32 | — |
| 27 | 編輯節點設定後儲存更新（@node-mgmt @p1） | F-NM-04, F-NF-10, HDL-09, SYS-06 | INT-08 | E2E-33 | — |
| 28 | 移除節點前彈出確認對話框（@node-mgmt @p0） | F-NM-05 | — | E2E-34 | — |
| 29 | 確認移除後節點從 Dashboard 消失（@node-mgmt @p1） | F-NM-06, HDL-10, SYS-07 | INT-08 | E2E-35 | — |
| 30 | 取消移除不產生任何變更（@node-mgmt @p1） | F-NM-07 | — | E2E-36 | — |
| 31 | 從 Manager 下載 <arch> 架構的 Agent binary（Outline ×2：amd64/arm64，@agent @p1 @download） | HDL-16~18, F-AP-12 | — | E2E-37, E2E-38 | — |
| 32 | Agent 啟動後向 Manager 註冊並更新為線上（@agent @p0 @smoke） | SYS-44~46, SYS-56 | INT-02 | E2E-29 | MAN-02 |
| 33 | Agent 註冊的 node_name 與既有離線節點比對一致時恢復該節點（@agent @p1） | SYS-15~17（比對路徑） | INT-02 | E2E-41 | MAN-02 |
| 34 | Agent 定期發送心跳且 Manager 更新 last_heartbeat（@heartbeat @p0 @smoke） | SYS-15, SYS-18, SYS-56 | INT-02 | E2E-51（row 1） | — |
| 35 | 節點狀態變更即時推送至所有已連線的 Web UI（@heartbeat @p0 @websocket） | F-NS-05~08, F-AP-13 | INT-09 | E2E-43 | — |
| 36 | 連續 30 秒未收到心跳時節點標示離線（@offline @p0 @smoke） | SYS-22, F-NS-07 | INT-02, INT-03 | E2E-39 | MAN-05 |
| 37 | 離線時單節點視圖的操作按鈕全部禁用並顯示 Banner（@offline @p1） | F-DV-07 | — | E2E-40 | — |
| 38 | 寬限期內心跳恢復自動回到線上（@offline @p0 @smoke） | SYS-27 | INT-03 | E2E-41 | MAN-05 |
| 39 | 超過 300 秒寬限期標示為長期離線（@offline @p1） | SYS-23, F-AD-13 | — | E2E-42 | — |
| 40 | 長期離線節點可從列表移除且歷史資料保留（@offline @p1） | F-NM-06, HDL-10 | INT-08 | E2E-35, E2E-56 | — |
| 41 | Agent 服務掛掉後重啟自動恢復連線（@error-handling @p0 @agent-crash） | SYS-27, SYS-57 | INT-03 | E2E-44 | MAN-02 |
| 42 | Manager 與 Agent 網路中斷恢復後於寬限期內無縫回復（@error-handling @p1 @network） | SYS-27, SYS-58 | INT-03 | E2E-41, E2E-44 | MAN-05 |
| 43 | 服務操作逾時 15 秒顯示逾時錯誤（@error-handling @p0 @timeout） | F-DV-06, HDL-23, SYS-36 | — | E2E-45 | — |
| 44 | TLS 憑證過期導致已註冊節點離線（@error-handling @p1 @tls） | SYS-39, HDL-13 | INT-06 | E2E-48 | MAN-13 |
| 45 | Manager 重啟後於啟動寬限期內重連所有 Agent（@error-handling @p0 @restart） | SYS-28~29 | INT-07 | E2E-53 | MAN-04 |
| 46 | 同一個 Agent 被第二個 Manager 連線時被拒絕（@error-handling @p1 @multi-manager） | SYS-47, SYS-58 | INT-01（token 拒絕） | — | MAN-08 |
| 47 | Agent 版本不相容時節點顯示警告狀態（@error-handling @p1 @version） | SYS-25~26, F-ND-03 | — | E2E-49 | MAN-07 |
| 48 | 節點數量達到 50 個上限時拒絕新增（@edge-case @p0 @node-limit） | SYS-11~12, HDL-07 | — | E2E-50 | MAN-09 |
| 49 | 心跳機制依 <threshold> 規則判定（Outline ×3：心跳間隔/離線閾值/寬限期，@edge-case @p1 @heartbeat） | SYS-20~24 | INT-02 | E2E-51 | — |
| 50 | 操作逾時依操作類型套用 <timeout_rule>（Outline ×2：15s 操作 / 10s 搜尋，@edge-case @p1 @timeout） | SYS-36, HDL-23, HDL-31 | — | E2E-52 | — |
| 51 | 同一節點同一服務不允許並行操作（@edge-case @p0 @concurrency） | F-DV-08 | — | E2E-46 | — |
| 52 | 不同節點可並行操作（@edge-case @p1 @concurrency） | F-DV-09 | INT-04（多節點） | E2E-47 | MAN-14 |
| 53 | Manager ↔ Agent 通訊使用 <tls_mode> 模式（Outline ×2：TLS 單向 / mTLS 雙向，@edge-case @p0 @tls） | SYS-38~41, SYS-55 | INT-06 | — | MAN-03 |
| 54 | Agent 信任 Manager 的代理授權不直接驗證管理員（@edge-case @p1 @auth） | SYS-34, SYS-47 | INT-01 | E2E-16 | MAN-12 |
| 55 | 服務狀態以 Agent 即時回報為準不做本地快取（@edge-case @p1 @consistency） | SYS-34, SYS-42~43, F-DV-01~02 | INT-01 | E2E-06, E2E-17 | — |
| 56 | 不支援跨節點的服務相依操作（@edge-case @p1 @orchestration） | F-DV-03（操作僅作用單節點） | — | E2E-10~14（無跨節點 UI） | MAN-12 |
| 57 | 節點相關 API 未登入時回傳 401（Outline ×9，@api @security @p0） | HDL-34~36 | — | E2E-54 | — |
| 58 | Node registry 持久化於磁碟且重啟後保留（@business-rules @p1 @data） | SYS-01~03 | INT-07, INT-08 | E2E-55 | — |
| 59 | 移除節點時保留其歷史資料與 Audit Log（@business-rules @p1 @data） | SYS-07, SYS-59 | INT-08 | E2E-56 | — |
| 60 | 跨節點操作記錄包含 node_id 與 node_name（@business-rules @p1 @audit） | SYS-59~60, HDL-22 | INT-04 | E2E-10~14（audit 對照） | — |
| 61 | Agent 離線時本地服務操作仍可透過直接存取 Agent 執行（@agent @business-rules @p1） | SYS-48~50（獨立運作） | INT-01 | — | MAN-12 |
| 62 | Agent 支援 Token 驗證來自 Manager 的請求（@agent @business-rules @p1 @security） | SYS-47, SYS-34 | INT-01 | E2E-26（測試連線） | MAN-08 |
| 63 | Manager + 1 Agent 完成「<action>」服務管理流程（Outline ×5：start/stop/restart/enable/disable，@integration @p0 @smoke） | HDL-22, SYS-49 | INT-04 | E2E-10~14 | — |
| 64 | Manager + 1 Agent 完成日誌查詢流程（@integration @p0 @smoke） | HDL-25, SYS-52 | INT-04 | E2E-15 | — |
| 65 | Manager + 3 Agents 時 Aggregate Dashboard 正確顯示所有節點（@integration @p1） | F-AD-02~03 | INT-05 | E2E-02, E2E-03 | MAN-01 |
| 66 | Agent 離線 → Dashboard 更新 → Agent 恢復 → Dashboard 恢復（@integration @p1 @offline） | SYS-22, SYS-27 | INT-03 | E2E-39, E2E-41 | MAN-05 |
| 67 | Manager 重啟後所有 Agent 自動重連（@integration @p1 @restart） | SYS-28~29 | INT-07 | E2E-53 | MAN-04 |
| 68 | TLS 憑證 <cert_status> 時通訊<outcome>（Outline ×2：有效 / 無效過期，@integration @p1 @tls） | SYS-38~39 | INT-06 | E2E-48 | MAN-03, MAN-13 |
| 69 | WebSocket 斷線後自動重連並恢復即時更新（@integration @p1 @websocket） | F-AP-14 | INT-09 | E2E-43（重連補充） | — |

> **覆蓋率**：69/69 BDD Scenario 全覆蓋（含 9 組 Scenario Outline 之 Examples 全部展開：服務操作 ×5、測試連線失敗 ×2、Agent 架構 ×2、心跳機制 ×3、逾時規則 ×2、TLS 模式 ×2、401 ×9、整合操作 ×5、TLS 憑證 ×2，共 32 列）。
> **總計**：SYS 60 + HDL 36 + F 85 + INT 9 + E2E 56 + MAN 14 = **260 個測試案例**。
> **技術依據**：9 項 Tech Decision（HTTPS REST + 短連線心跳 / registry JSON 持久化 / supervisor 狀態機 10s/30s/300s + 寬限期 / Token+指紋+mTLS 認證 / 逐 route 代理 + per-route 逾時 / 同 module 第二 entry point / 前端三視圖 + nodes store / fan-out 搜尋 + failed_nodes）已全數納入測試案例；D-1~D-10 差異裁決已於第 0 節記錄並於案例中落實。

---

*由 Test Plan Generator 自動產生，對應 BDD `docs/bdds/014-multi-node-agent-management.feature`（69 個 Scenario；技術裁決依 `docs/tech-decisions/014-multi-node-agent-management.md` 9 項決策；`docs/development/014-multi-node-agent-management.md` 由 development-spec-generator 產生後可補入第 0 節與測試環境引用）*
