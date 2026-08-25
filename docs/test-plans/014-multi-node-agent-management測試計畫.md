# 多機管理 Agent 模式 — 測試計畫

> **對應 BDD**：`docs/bdds/014-multi-node-agent-management.feature`（48 Scenario + 3 Scenario Outline，展開後 57 個案例）
> **操作流程**：`docs/interaction-flows/014-multi-node-agent-management.md`
> **技術決策**：`docs/tech-decisions/014-multi-node-agent-management.md`（gorilla/websocket 長連線、心跳狀態機、TLS 指紋 pinning、cmd/agent 獨立 binary、nodes.json 持久化、WS RPC proxy）
> **測試日期**：2025-08-25
>
> **📋 修訂（2025-08-25）**：跨節點服務搜尋已移出功能範圍（純切換模式決策，見 `docs/uiux/014-multi-node-view-redesign.md`）。所有搜尋相關測試案例（SYS-SRCH-*、HDL-SRCH-01、F-SE-*、INT-SRCH-01、E2E-22~25/29，及覆蓋矩陣 S24–S27/S33）降為 **@deferred**，不納入首版實作與測試。

---

## 0. BDD 情境統計與覆蓋原則

| 類別 | 數量 | 說明 |
|------|:---:|------|
| Scenario 總數 | 48 | 含異常處理（R1–R9）與業務規則（B1–B10） |
| Scenario Outline | 3 | ①Node Card 切換（Examples ×2）②單節點服務操作（Examples ×5：start/stop/restart/enable/disable）③下載 Agent binary（Examples ×2：amd64/arm64） |
| 展開後案例總數 | **57** | 48 + (2+5+2) − 3 |
| `@edge-case` | 17 | 手動驗證 + 整合測試為主 |
| `@business-rules` | 16 | 後端單元測試 + 前端單元測試為主 |
| `@smoke` | 6 | 全部映射至 E2E |
| `@p0` | 6 | 全部映射至 E2E + 單元測試雙保險 |

**覆蓋原則**：每個 BDD Scenario 至少對應 1 個測試案例，完整覆蓋矩陣見第 9 節。

---

## 1. 測試範圍總覽

| 層級 | 範圍 | 工具 | 負責 |
|------|------|------|------|
| 單元測試 | Go：`internal/nodemonitor`（心跳狀態機 30s/300s、寬限期）、`internal/noderegistry`（CRUD、唯一性、50 台上限、nodes.json 持久化）、`internal/nodeproxy`（WS RPC、15s/10s 逾時、singleflight）、`internal/agentclient`（撥號、exponential backoff、register/heartbeat）、TLS 指紋 pinning | `go test`（Go 1.24.4）+ fake clock | 後端 |
> **📋 修訂（2025-08-25）**：跨節點服務搜尋已移出功能範圍（純切換模式決策，見 `docs/uiux/014-multi-node-view-redesign.md`）。所有搜尋相關測試案例（SYS-SRCH-*、HDL-SRCH-01、F-SE-*、INT-SRCH-01、E2E-22~25/29、覆蓋矩陣 S24–S27/S33）降為 **@deferred**，不納入首版實作與測試。

| 測試類型 | 範圍 | 工具 | 層級 |
|------|------|------|:---:|
| 單元測試 | Go Handler：`/api/v1/nodes/*`（registry CRUD、test-connection、proxy、summary、info、binary 下載；~~search~~ ⛔deferred） | `go test` + `net/http/httptest` | 後端 |
| 單元測試 | Vue：`stores/node.ts`、`NodeCard.vue`、`NodeSwitcher.vue`、`NodeFormModal.vue`、`NodeManagementView.vue`、DashboardView 視圖分流、useWebSocket `node.*` 事件處理、跨節點搜尋 | Vitest 4 + happy-dom + @vue/test-utils | 前端 |
| 整合測試 | 多進程拓撲：本機起 1 Manager + N Agent（真實 gorilla/websocket over TLS），驗證註冊、心跳、離線偵測、RPC proxy、搜尋、Manager 重啟重連 | Go integration test（`testing.Short()` 隔離）+ 本地多進程 harness | 後端 |
| 端對端測試 | 完整使用者操作流程（Aggregate Dashboard、節點切換、服務操作、新增/移除節點、跨節點搜尋、即時推送） | Playwright 1.62 | 前端 |
| 手動驗證 | 真實 Linux 多機環境：systemd 實際操作、TLS/mTLS 真實憑證、真實網路中斷、Agent binary 實機部署（amd64/arm64） | 手動 | QA |

### 多機 E2E／整合測試的本地模擬策略

由於本功能為多機拓撲，E2E 與整合測試需在**單台 CI 機器上以本地 process 模擬多個 Agent**：

1. **Binary 建置**：CI 前置步驟執行 `go build -o /tmp/e2e/bin/manager ./cmd/manager` 與 `go build -o /tmp/e2e/bin/agent-linux-amd64 ./cmd/agent`。
2. **TLS 自簽簽憑證**：測試 helper（Go：`testutil/gencert.go`；Playwright：`globalSetup` 呼叫小工具或預生成 fixture）以 `crypto/x509` 產出自簽憑證，指紋寫入節點設定，模擬 pinning 流程。憑證過期場景使用 `NotBefore/NotAfter` 可回填的 helper 產生已過期憑證。
3. **Agent instance 啟動**：每個模擬節點以不同 flag 啟動一個 agent process：

   ```bash
   /tmp/e2e/bin/agent-linux-amd64 \
     --config /tmp/e2e/agent-web01.yaml   # manager_addr: 127.0.0.1:18443, node_name: web-server-01, heartbeat_interval 可調
   ```

   N 個節點 = N 個 process（整合測試最多 4 個；50 台上限測試以 in-process registry 單元測試覆蓋，不真的開 50 個 process）。
4. **Playwright globalSetup/globalTeardown**：`webServer.array()` 起 Vite dev server；`globalSetup` 以 child_process 啟動 manager + 2~3 個 agent，process handle 存入 fixture，`teardown` 時 `SIGTERM` 清理。
5. **模擬離線**：
   - *心跳中斷*：`agent.kill('SIGSTOP')`（process 存活但停止心跳）或直接 `SIGKILL`；
   - *恢復上線*：SIGSTOP 情境送 `SIGCONT`；SIGKILL 情境重新 spawn 同 `node_name` 的 agent；
   - *網路分割*：本機無法用防火牆，改以「停掉 agent 的 manager_addr 指向的中繼」或在整合測試層級直接關閉 Manager 端 WS 連線（Manager 測試 hook `POST /__test/disconnect-agent?node=`）。
6. **可觀察斷言點**：整合測試透過 Manager 測試用 API（僅 build tag `test` 編譯）：`GET /api/v1/nodes/{id}` 讀取 runtime 狀態，避免 sleep-based flaky 斷言，改用 polling + deadline（`require.Eventually` 風格）。

---

## 2. 後端單元測試

### 2.1 Node Monitor — 心跳狀態機（規則 B2、流程 3.4）

> ⚡ **加速測試要求**：所有閾值（心跳間隔 10s、離線 30s、長期離線 300s、掃描 tick 5s、啟動寬限期 30s）必須可注入。單元測試一律使用 fake clock（`Monitor` 接受 `now func() time.Time` 與可設定閾值參數），不依賴真實等待。整合測試以環境變數縮短間隔（詳見第 6.1 節）。

| # | 測試名稱 | Given | When | Then |
|---|---------|-------|------|------|
| SYS-MON-01 | 收到心跳更新 last_heartbeat | 節點狀態 online，lastHeartbeat=T₀ | 送入 heartbeat 訊息（T₀+10s） | lastHeartbeat 更新為 T₀+10s，狀態維持 online |
| SYS-MON-02 | 超過 30 秒無心跳標示離線（S18/S42） | 節點 online，最後心跳 T₀ | fake clock 前進至 T₀+31s 觸發掃描 | 狀態變為 offline，觸發 `node.status_changed` 事件 |
| SYS-MON-03 | 29 秒時仍為線上（邊界） | 節點 online，最後心跳 T₀ | fake clock 前進至 T₀+29s 掃描 | 狀態維持 online |
| SYS-MON-04 | 恰好 30 秒判定（邊界） | 節點 online，最後心跳 T₀ | fake clock 前進至恰 T₀+30s | 依實作定義（≥30s 即離線），斷言結果與規則一致且穩定 |
| SYS-MON-05 | 離線超過 300 秒標示長期離線（S21/S42） | 節點 offline，offlineSince=T₁ | fake clock 前進至 T₁+301s | 狀態變為 long_offline |
| SYS-MON-06 | 離線 299 秒仍為一般離線（邊界） | 節點 offline | fake clock 前進至 T₁+299s | 狀態維持 offline |
| SYS-MON-07 | 寬限期內心跳恢復回線上（S20） | 節點 offline（未滿 300s） | 送入 register 或 heartbeat | 狀態回 online，記錄恢復時間，發布 `node.status_changed` |
| SYS-MON-08 | long_offline 後心跳恢復亦回線上 | 節點 long_offline | 送入 register/heartbeat | 狀態回 online |
| SYS-MON-09 | 狀態變更只發布一次事件 | 節點 online→offline | 掃描連續兩輪皆逾時 | 僅第一輪發布 status_changed，第二輪不重複發布 |
| SYS-MON-10 | Manager 啟動寬限期 30 秒內不觸發離線（S36/R6） | Manager 剛啟動，registry 有節點但尚無心跳 | 啟動後 fake clock 前進 20s | 不發布任何 offline 事件 |
| SYS-MON-11 | 寬限期過後仍無心跳才標示離線（S36） | Manager 啟動後 31s，某節點無心跳 | 觸發掃描 | 該節點標示 offline 並發布事件 |

### 2.2 Node Registry — CRUD、唯一性、上限、持久化

| # | 測試名稱 | Given | When | Then |
|---|---------|-------|------|------|
| SYS-REG-01 | 新增節點成功 | 空 registry | `Add(name:"app-01", addr:"10.0.0.13:8443", ...)` | 回傳新節點 ID，`ListNodes()` 含該筆，狀態初始值正確 |
| SYS-REG-02 | 名稱唯一性檢查（S38/R8） | registry 已存在 "web-server-01" | `Add(name:"web-server-01", ...)` | 回傳 duplicate 錯誤，不新增記錄 |
| SYS-REG-03 | 達到 50 台上限拒絕第 51 台（S41/B1） | registry 已有 50 筆 | `Add(...)` 第 51 筆 | 回傳 max-nodes 錯誤，registry 仍為 50 筆 |
| SYS-REG-04 | 第 50 台可正常加入（邊界） | registry 已有 49 筆 | `Add(...)` 第 50 筆 | 成功加入 |
| SYS-REG-05 | 移除節點（S23） | registry 存在 "db-server-01" | `Remove(id)` | ListNodes 不再包含，nodes.json 同步更新 |
| SYS-REG-06 | 更新節點設定 | 已存在節點含 TLS 指紋 | `Update(id, {tls_fingerprint: 新值})` | 欄位更新，其餘欄位不變 |
| SYS-REG-07 | nodes.json 持久化寫入（S48） | 已註冊 2 節點 | 呼叫 Add/Update/Remove 後讀取 nodes.json | 檔案內容與記憶體一致；檔案權限 0600 |
| SYS-REG-08 | atomic write（temp+rename） | 任意設定變更 | 檢查寫入過程 | 寫入先寫 temp file 再 rename，無半寫狀態（中斷模擬：rename 前 crash 不損毀舊檔） |
| SYS-REG-09 | 重啟後載入保留全部設定（S48） | nodes.json 預先放入 2 節點資料 | `LoadRegistry(path)` | 名稱、位址、TLS 設定、Token 全部還原；runtime state（last_heartbeat）為初始值 |
| SYS-REG-10 | last_heartbeat 不落盤 | 節點心跳頻繁更新 | 觀察 nodes.json mtime/內容 | 心跳更新不觸發檔案寫入（只有設定 CRUD 落盤） |
| SYS-REG-11 | 損毀的 nodes.json 優雅處理 | nodes.json 內容為非法 JSON | `LoadRegistry(path)` | 回傳明確錯誤，Manager 不 panic（行為依開發規格：報錯退出或備份重建，擇一並固定） |

### 2.3 Node Proxy — WS RPC 轉發、逾時、singleflight（決策 6）

| # | 測試名稱 | Given | When | Then |
|---|---------|-------|------|------|
| SYS-PF-01 | 正常 RPC 轉發與回應配對 | 節點 online，mock Agent 回傳 rpc_response | `Proxy(nodeID, "services.list", params)` | request_id 正確配對，payload 正確回傳 |
| SYS-PF-02 | 服務操作逾時 15 秒（S32/R3/B3） | mock Agent 不回應 | `Proxy(nodeID, "services.restart", ..., 15s)`（單元測試注入短 timeout） | 回傳 timeout error；pending map 清理乾淨 |
| SYS-PF-03 | 查詢類逾時 10 秒 | mock Agent 不回應查詢 | `Proxy(nodeID, "services.list", ..., 10s)` | 回傳 timeout error |
| SYS-PF-04 | 節點離線立即回 503 語意錯誤 | 節點狀態 offline | `Proxy(nodeID, ...)` | 不送出 WS 訊息，立即回 `node_offline` 錯誤 |
| SYS-PF-05 | singleflight：同節點同服務並行被拒（S9/B4） | 同一 (nodeID, service) 的前一請求未完成 | 再次呼叫 `Proxy(nodeID, "services.restart", same service)` | 第二次回傳 409 語意的 in-progress 錯誤 |
| SYS-PF-06 | 不同節點可並行（S9/B4） | node A 操作進行中 | 對 node B 發起操作 | 正常轉發不被阻塞 |
| SYS-PF-07 | 同節點不同服務可並行 | node A 的 svcX 操作進行中 | 對 node A 的 svcY 發起操作 | 正常轉發不被阻塞 |
| SYS-PF-08 | 不快取服務狀態（S45/B8） | 節點回傳服務列表 v1，隨後 Agent 端狀態改變 | 再次查詢同一列表 | 第二次回傳 Agent 即時回應（v2），非第一次結果 |
| SYS-PF-09 | pending response 斷線清理 | 有 3 個 in-flight RPC | Agent WS 連線斷開 | 3 個 pending 全部收到錯誤，map 清空 |

### 2.4 跨節點搜尋（流程 3.1 SearchSvc、異常 R4）

| # | 測試名稱 | Given | When | Then |
|---|---------|-------|------|------|
| SYS-SRCH-01 | 向所有線上節點並行查詢並彙總（S24） | 3 節點 online，各含匹配服務 | `SearchServices("nginx")` | 3 節點結果彙總，每筆含 node_id/node_name/service/status |
| SYS-SRCH-02 | 部分節點離線不阻塞（S33/R4/B3） | nodeA online、nodeB offline | 搜尋 "nginx" | 回傳 nodeA 結果 + nodeB 標記 `"unreachable": true`；總耗時不受 nodeB 影響 |
| SYS-SRCH-03 | 總逾時 10 秒先回部分結果（S33/B3） | 某線上節點回應緩慢 >10s（mock） | 搜尋 "nginx" | 10s 到即回傳已收齊節點的結果，慢節點標記 unreachable |
| SYS-SRCH-04 | 無任何匹配回傳空陣列（S26） | 各節點均無匹配服務 | 搜尋 "nonexistent-svc" | 回傳空 results（HTTP 200），非錯誤 |
| SYS-SRCH-05 | errgroup context 取消傳播 | 總逾時觸發 | 觀察各節點查詢 goroutine | 全部收到 context cancel，無洩漏 goroutine |

### 2.5 TLS / 指紋 Pinning / mTLS（規則 B5、異常 R5、決策 3）

| # | 測試名稱 | Given | When | Then |
|---|---------|-------|------|------|
| SYS-TLS-01 | 指紋相符允許連線 | Agent 提供自簽憑證 C，registry 記錄 SHA-256(C) | TLS handshake + VerifyPeerCertificate | 連線建立成功 |
| SYS-TLS-02 | 指紋不符拒絕連線 | registry 指紋 ≠ 憑證指紋 | handshake | 連線被拒，錯誤含 "certificate fingerprint mismatch" |
| SYS-TLS-03 | 指紋留空 = 僅加密不驗證 | registry 未填指紋 | handshake | 連線建立（加密但仍防 MITM 能力降級——依決策 3 規格） |
| SYS-TLS-04 | 過期憑證偵測（S34/R5） | Agent 憑證 NotAfter < now | test-connection / 撥號 | 錯誤分類為 "certificate expired" |
| SYS-TLS-05 | 無有效 TLS 的連線被拒（S43/B5） | Agent 以明文 ws:// 撥號 | Manager 端點檢查 | 升級連線被拒絕 |
| SYS-TLS-06 | mTLS 啟用時雙向驗證（S43/B5） | Manager 與 Agent 均設定 client cert | handshake | 雙方互驗成功；任一方缺 client cert 即拒絕 |

### 2.6 Agent Client（cmd/agent 側）— 撥號、重連、register/heartbeat

| # | 測試名稱 | Given | When | Then |
|---|---------|-------|------|------|
| SYS-AC-01 | 啟動即發送 register（S17） | Agent 讀完設定檔 | 連上 mock Manager | 第一則訊息為 register（node_name、hostname、version） |
| SYS-AC-02 | register_ack 後開始定期心跳（S17/S42） | 收到 register_ack(ok=true) | 觀察訊息流 | 以設定的 interval（預設 10s，可設定）持續發送 heartbeat，payload 含服務統計 |
| SYS-AC-03 | 指數退避重連（S44） | Manager 位址不可達 | 觀察撥號嘗試 | 重試間隔呈 exponential backoff（如 1s/2s/4s/…至上限）；Manager 恢復後自動連上 |
| SYS-AC-04 | 半開連線由 read deadline 兜底（決策 2） | 連線建立後對端無聲掛斷（不送 FIN） | 35s read deadline 到期（測試注入短值） | Agent 判定斷線並進入重連流程 |
| SYS-AC-05 | 版本低於 min_version 收到警告（S39/R9） | Agent v1.0，register_ack payload `{"min_version":"1.2","compatible":false}` | 處理 ack | Agent 標記相容性警告並回報給 Manager 顯示 🟡 |
| SYS-AC-06 | Token 驗證 Manager 身分（S37/R7、S49/B7） | Agent 設定 auth_token | 第二個不同 token 的 Manager 嘗試連線 | 連線被拒（401 upgrade reject） |

### 2.7 Handler 層 — `/api/v1/nodes/*`

#### 2.7.1 Registry CRUD

| # | 測試名稱 | Given | When | Then |
|---|---------|-------|------|------|
| HDL-NODE-01 | POST /api/v1/nodes 成功（S13） | 已登入 session，body 合法 | POST | 201，回傳節點物件含 id |
| HDL-NODE-02 | POST 名稱重複 → 409（S38/R8） | 已存在同名節點 | POST | 409，`{"error":"node name already exists"}` |
| HDL-NODE-03 | POST 缺必填欄位（S40） | body 缺 name 或 address | POST | 400，`{"error":"name and address are required"}` |
| HDL-NODE-04 | GET /api/v1/nodes 列表（Background） | registry 有 2 節點 | GET | 200，含名稱/位址/狀態/最後心跳 |
| HDL-NODE-05 | GET /api/v1/nodes/{id} 詳情 | 節點存在 | GET | 200 含詳細欄位；不存在 → 404 |
| HDL-NODE-06 | PUT /api/v1/nodes/{id} 更新 | 節點存在 | PUT | 200，設定更新 |
| HDL-NODE-07 | DELETE /api/v1/nodes/{id}（S23） | 節點存在 | DELETE | 200，列表減 1，WS 廣播 `node.registry_changed` |
| HDL-NODE-08 | 未驗證存取 → 401 | 無 session cookie | 任意 /api/v1/nodes/* | 401 Unauthorized |
| HDL-NODE-09 | 第 51 台 → 400（S41/B1） | registry 已滿 50 | POST | 400，`{"error":"maximum of 50 nodes"}` |

#### 2.7.2 Test Connection

| # | 測試名稱 | Given | When | Then |
|---|---------|-------|------|------|
| HDL-TC-01 | 連線成功（S11） | httptest 起 mock Agent `/health` 回 200 + 版本資訊 | POST /api/v1/nodes/test-connection | 200，`{ok:true, version, hostname, os}` |
| HDL-TC-02 | connection refused（S12） | 位址指向未監聽 port | POST test-connection | 200（HTTP 層成功），`{ok:false, error:"connection refused"}` |
| HDL-TC-03 | TLS 憑證過期（S34/R5） | mock Agent 用過期憑證 | POST test-connection | `{ok:false, error:"certificate expired"}` |
| HDL-TC-04 | 指紋不符（R5） | mock Agent 憑證與表單指紋不符 | POST test-connection | `{ok:false, error:"fingerprint mismatch"}` |
| HDL-TC-05 | 位址格式非法 | address="not-a-host-port" | POST test-connection | 400 validation error |

#### 2.7.3 Proxy / Search / Summary / Info / Binary 下載

| # | 測試名稱 | Given | When | Then |
|---|---------|-------|------|------|
| HDL-NP-01 | GET /api/v1/nodes/{id}/services 代理（步驟 2） | mock Agent 回服務列表 | GET | 200，內容即 Agent 回應（S45：不夾帶快取） |
| HDL-NP-02 | POST .../services/{name}/start（S6-start） | mock Agent 回 ok | POST | 200，Audit Log 新增紀錄含 node_id |
| HDL-NP-03 | POST .../stop（S6-stop） | 同上 | POST | 200 |
| HDL-NP-04 | POST .../restart（S6-restart） | 同上 | POST | 200 |
| HDL-NP-05 | POST .../enable（S6-enable） | 同上 | POST | 200 |
| HDL-NP-06 | POST .../disable（S6-disable） | 同上 | POST | 200 |
| HDL-NP-07 | Agent 回報操作失敗透傳（S8） | mock Agent 回 `{ok:false,error:"permission denied"}` | POST restart | 非 2xx 或 body 含原始錯誤，前端可顯示原因 |
| HDL-NP-08 | GET .../logs 代理日誌（S7） | mock Agent 回 journalctl 片段 | GET logs | 200，內容透傳 |
| HDL-NP-09 | 節點離線 → 503（SYS-PF-04 的 handler 面） | 節點 offline | 任一 proxy endpoint | 503，`{"error":"node_offline"}` |
| HDL-NP-10 | 並行操作 → 409（S9/B4） | 同服務操作進行中 | 再送同一操作 | 409 |
| HDL-SRCH-01 | GET /api/v1/nodes/services/search?q=（S24） | 2 線上節點皆有 nginx.service | GET q=nginx | 200，results 含兩筆（node_name + service + status） |
| HDL-SUM-01 | GET /api/v1/nodes/summary 匯總（S1） | 2 節點心跳附帶服務統計 | GET | 200，`{total_nodes:2, online:2, offline:0, services_total, running, failed}` |
| HDL-INF-01 | GET /api/v1/nodes/{id}/info（S28） | mock Agent 回系統資訊 | GET | 200，含 OS/版本/uptime/資源概覽 |
| HDL-DL-01 | 下載 Agent binary amd64（S16-a） | binary 檔案就緒 | GET /api/v1/nodes/agent-binary?arch=amd64 | 200，Content-Disposition 附檔名 agent-linux-amd64，Content-Length 正確 |
| HDL-DL-02 | 下載 Agent binary arm64（S16-b） | 同上 | ?arch=arm64 | 200，agent-linux-arm64 |
| HDL-DL-03 | 不支援的架構 | — | ?arch=mips | 400，列出支援架構 |
| HDL-DL-04 | 未登入不可下載 | 無 session | GET binary | 401 |

---

## 3. 前端單元測試（Vitest 4 + happy-dom + @vue/test-utils）

### 3.1 stores/node.ts（Pinia store）

| # | 測試名稱 | Given | When | Then |
|---|---------|-------|------|------|
| F-ST-01 | fetchNodes 載入節點列表 | mock API 回 2 節點 | 呼叫 `fetchNodes()` | `nodes.length===2`，欄位正確 |
| F-ST-02 | summary 計算（S1） | 2 節點皆 online | 套用 summary payload | `totalNodes=2, online=2, offline=0` |
| F-ST-03 | status_changed 事件更新狀態（S18/S50） | store 已載入 | dispatch `node.status_changed {id, status:"offline"}` | 該節點 status 更新，computed online/offline 計數同步 -1/+1 |
| F-ST-04 | registry_changed 增刪節點（S13/S23/S51） | store 已載入 | dispatch 新增/移除事件 | nodes 列表即時增刪，不需重新 fetch |
| F-ST-05 | currentNode 由 route query 驅動（S3） | query `?node=1` | getter `currentNode` | 回傳 id=1 節點物件；無 query → null（Aggregate 模式） |

### 3.2 NodeCard.vue

| # | 測試名稱 | Given | When | Then |
|---|---------|-------|------|------|
| F-NC-01 | 線上節點渲染 🟢 與摘要（S1） | props：online 節點含服務統計/心跳/CPU | mount | 顯示節點名、Hostname、🟢、"M/N 執行中"、最後心跳相對時間 |
| F-NC-02 | 離線樣式：指示燈變紅、統計灰顯（S18） | props status="offline" | mount | class 含 offline 樣式，指示燈 🔴 |
| F-NC-03 | 長期離線 ⚫（S21） | props status="long_offline" | mount | ⚫ 樣式與摺疊 class |
| F-NC-04 | 相對時間顯示「X 秒前」（S18） | lastHeartbeat = 45s 前 | mount | 文字含「45 秒前」 |
| F-NC-05 | 點擊 emit 切換事件（S3） | 線上節點 Card | click Card | emit `select`（nodeId） |
| F-NC-06 | 版本警告 🟡 與 Tooltip（S39） | props status="warning"、versionMessage | mount + hover | 顯示 🟡 與提示文字「Agent 版本過舊 (v1.0)，建議升級至 v1.2+」 |

### 3.3 DashboardView 視圖分流與 NodeSwitcher

| # | 測試名稱 | Given | When | Then |
|---|---------|-------|------|------|
| F-DB-01 | 無 query 顯示 Aggregate 模式（S1） | route `/dashboard` | mount | 顯示 NodeSummaryBar + Node Cards 網格 |
| F-DB-02 | 空狀態引導（S2） | store.nodes 為空 | mount | 顯示 EmptyState「尚無已註冊節點，請先新增節點」+ 前往 /nodes 引導連結 |
| F-NS-01 | 點擊 Card → URL `?node={id}`（S3，參數化 ×2） | Aggregate 模式 | click Card nodeId=1 / nodeId=2 | router.push `/dashboard?node=1` / `?node=2` |
| F-NS-02 | 單節點模式 Header 顯示下拉與目前節點（S3/S4） | query node=1 | mount | Header 顯示「目前節點：web-server-01」，下拉列出所有節點含狀態燈 |
| F-NS-03 | 下拉選取其他節點切換（S4） | 單節點視圖 node=1 | select "db-server-01" | URL 變 `?node=2`，Header 名稱更新，service store 以 nodeId=2 重新載入 |
| F-NS-04 | 「所有節點」按鈕返回（S5） | 單節點視圖 | click 返回鈕 | URL 回 `/dashboard`，重新渲染 Aggregate 網格 |
| F-DB-03 | 生命週期：unmount 時清除 WS 訂閱（智能補充） | 元件掛載並訂閱 node.* 事件 | unmount | hub unsubscribe 被呼叫，無洩漏監聽 |

### 3.4 單節點服務操作與離線禁用

| # | 測試名稱 | Given | When | Then |
|---|---------|-------|------|------|
| F-SV-01 | 操作按鈕 loading spinner（S6） | 服務列 idle | click start，API pending | 該列按鈕顯示 spinner；resolve 後復原並 Toast「[web-server-01] nginx.service 已啟動」 |
| F-SV-02 | 失敗 Toast 顯示原因（S8） | API 回 500 + error | click restart | Toast「[web-server-01] nginx.service 重啟失敗：權限不足」，列狀態不變 |
| F-SV-03 | 進行中按鈕 disabled（S9/B4） | 某服務操作 pending | 檢視該列按鈕 | 全部 disabled；其他服務列與其他節點不受影響 |
| F-SV-04 | 操作逾時 Toast（S32/R3） | API 15s 逾時（fake timers） | click restart | Toast「[web-server-01] 操作逾時：nginx.service restart」，按鈕復原可重試 |
| F-OFF-01 | 離線時操作全禁用 + Banner（S19） | 節點 status=offline | mount 服務列表 | start/stop/restart/enable/disable 全 disabled；頂部黃色 Banner「節點已離線，操作不可用」 |
| F-OFF-02 | 恢復線上自動解禁（S20） | 先離線後收到 status_changed online | 事件派發 | Banner 消失、按鈕恢復可用、重新載入服務列表 |
| F-LOG-01 | 日誌檢視帶 nodeId（S7） | 單節點視圖 node=1 | open log viewer | log API 呼叫帶 `/nodes/1/services/nginx.service/logs` |

### 3.5 NodeFormModal.vue（新增節點）

| # | 測試名稱 | Given | When | Then |
|---|---------|-------|------|------|
| F-FM-01 | 表單欄位與按鈕齊備（S10） | 開啟 Modal | mount | 必填：節點名稱、Agent 位址；選填：TLS 指紋、API Token、備註；按鈕：測試連線/註冊/取消 |
| F-FM-02 | 測試連線成功顯示綠色提示（S11） | mock API ok:true | click 測試連線 | loading → 綠色「連線成功」+ Agent 版本/主機名稱文字；Modal 不關閉 |
| F-FM-03 | 測試連線失敗可修正重試（S12） | mock API ok:false | click 測試連線 → 改位址 → 再點 | 紅色「無法連線：connection refused」；第二次呼叫以新位址發送 |
| F-FM-04 | 必填缺失攔截（S40） | name/address 留空 | click 註冊 | 欄位紅色提示、不發送 POST |
| F-FM-05 | 註冊成功關閉 Modal 並刷新列表（S13） | mock POST 201 | click 註冊 | Modal close、emit refreshed、Toast「節點 app-server-01 已註冊並上線」 |
| F-FM-06 | 註冊但離線 Toast（S14） | mock POST 201 + status offline | click 註冊 | Toast「節點 backup-server-01 已註冊但無法連線」 |
| F-FM-07 | 名稱重複 409 顯示 Toast 且表單保留（S38/R8） | mock POST 409 | click 註冊 | Toast「節點名稱重複，請使用不同名稱」，Modal 開啟可修改 |
| F-FM-08 | 取消不建立記錄（S15） | 已填部分欄位 | click 取消 | Modal 關閉、無 POST 發出 |

### 3.6 NodeManagementView.vue

| # | 測試名稱 | Given | When | Then |
|---|---------|-------|------|------|
| F-NM-01 | 節點列表表格欄位（S10 前置） | mock 2 節點 | mount | 顯示名稱/位址/狀態/最後心跳/操作欄 |
| F-NM-02 | 移除需確認對話框（S23） | 列表有 db-server-01 | click 移除 → 出現確認框文案 → confirm | confirm 後呼叫 DELETE，Toast「節點已移除」，列表刷新 |
| F-NM-03 | 取消移除不刪除（S23 反路徑） | 確認框開啟 | click 取消 | 無 DELETE 呼叫 |
| F-NM-04 | 下載 Agent 按鈕帶架構（S16） | mount | click 下載 → select amd64 / arm64 | 觸發對應 arch 的下載請求（window.location 或 a[download]） |

### 3.7 跨節點搜尋（前端）

| # | 測試名稱 | Given | When | Then |
|---|---------|-------|------|------|
| F-SE-01 | debounce 300ms 才發請求（S24） | Aggregate 模式 | 輸入 "ng" 後 100ms 內再輸入 "nginx" | 僅一次 API 呼叫（fake timers 快轉 300ms 後） |
| F-SE-02 | 結果列表顯示節點+服務+狀態（S24） | mock 搜尋回 2 筆 | 搜尋完成 | 顯示 "web-server-01 / nginx.service"、"db-server-01 / nginx.service" 及狀態 |
| F-SE-03 | 點擊結果跳轉並展開（S25） | 結果列表顯示中 | click "web-server-01 / nginx.service" | push `/dashboard?node=1&expand=nginx.service` |
| F-SE-04 | 空結果顯示空狀態（S26） | mock 回 results=[] | 搜尋 "nonexistent-svc" | 顯示「沒有找到匹配的服務」 |
| F-SE-05 | 關閉搜尋返回 Card 視圖（S27） | 搜尋結果顯示中 | click 關閉 | 恢復 Node Cards 網格 |
| F-SE-06 | unreachable 節點標示（S33/R4） | mock 結果含 `{unreachable:true}` | 渲染 | db-server-01 旁顯示「無法查詢」，online 節點結果正常列出 |

### 3.8 useWebSocket 擴充（node.* 事件）

| # | 測試名稱 | Given | When | Then |
|---|---------|-------|------|------|
| F-WS-01 | node.status_changed 更新 UI（S18/S50） | 已連線 WS | server push `node.status_changed` | store 狀態更新、Card 與統計列反應，不需重整 |
| F-WS-02 | node.registry_changed 更新列表（S51） | 已連線 WS | push 新增/移除事件 | 節點列表即時增刪 |
| F-WS-03 | WS 斷線自動重連（S51） | 連線建立後模擬 close | 等待重連（fake timers） | 依 backoff 重連成功後重新訂閱 |
| F-WS-04 | Toast 通知離線/恢復（S18/S20） | 已連線 WS | push offline / online 事件 | 分別顯示「web-server-01 已離線」「web-server-01 已恢復連線」 |

---

## 4. 整合測試（多進程本地拓撲）

> Harness：Go test 啟動 manager binary（隨機 port、臨時 nodes.json、測試用自簽 TLS）+ N 個 agent binary（各佔一組 port 與設定檔）。心跳相關閾值以環境變數加速（見 6.1）。斷言以 polling+deadline 為準。

| # | 測試名稱 | Given | When | Then |
|---|---------|-------|------|------|
| INT-REG-01 | 註冊可達節點即上線（S13） | manager + agent(app-01) 就緒 | API POST /nodes（address 可達） | 節點出現且 ≤ 加速心跳週期內轉 online，nodes.json 已落盤 |
| INT-REG-02 | 註冊不可達節點存為離線（S14） | address 指向未監聽 port | POST /nodes | 201，節點狀態 offline |
| INT-BOOT-01 | Agent 啟動註冊 + 心跳循環（S17） | agent 設定檔就緒 | 啟動 agent process | manager 端節點轉 online；log/狀態顯示週期性心跳到達 |
| INT-HB-01 | 心跳停止 → 離線（S18，加速閾值） | 節點 online | `kill -STOP` agent | ≤ 加速離線閾值內狀態變 offline，WS 事件廣播 |
| INT-HB-02 | SIGCONT 恢復 → 回線上（S20） | 節點 offline（寬限期內） | `kill -CONT` agent | 狀態回 online |
| INT-HB-03 | 持續停止 → 長期離線（S21，加速閾值） | 節點 offline | 保持 STOP 超過加速長期離線閾值 | 狀態變 long_offline |
| INT-NET-01 | 連線中斷於寬限期內恢復（S30/R2） | 節點 online | 中斷 WS（測試 hook）→ 短延遲後讓 agent 重連 | offline 後自動回 online，無人工介入 |
| INT-NET-02 | 中斷超過寬限期（S31/R2） | 節點 offline | 超過加速寬限期後重連 | 期間曾標 long_offline；重連後回 online |
| INT-PROXY-01 | Manager + 1 Agent 完整服務管理鏈 | 拓撲就緒 | 經 manager API 對 agent 執行 list/start/stop/restart/enable/disable/logs | 全部透傳成功，audit.jsonl 各含 node_id/node_name（S47） |
| INT-PROXY-02 | Manager + 3 Agents Aggregate 摘要 | 3 agent online | GET /nodes/summary | total=3、online=3、服務統計為三者之和 |
| INT-SRCH-01 | 跨節點搜尋（S24） | 2 agent 各有 nginx.service | GET search?q=nginx | 兩筆結果分屬兩節點 |
| INT-RESTART-01 | Manager 重啟：registry 保留 + 自動重連 + 啟動寬限期（S36/S48/R6） | 2 agent online | 重啟 manager process | nodes.json 設定保留；agents 於寬限期內重連回 online；期間無離線通知事件 |
| INT-TLS-01 | TLS pinning 生效（S43/R5） | agent 憑證指紋登錄於 registry | 正確指紋連線 / 篡改指紋後連線 | 前者成功；後者被拒且節點轉 offline |
| INT-AUTH-01 | 第二個 Manager 連線被 Agent 拒絕（S37/R7） | agent 已連 manager A | 以相同 node_name 另撥一條連線（模擬 manager B，token 不同） | 第二條被拒；修復方式文件所述（唯一 manager_addr）成立 |
| INT-VER-01 | 版本不相容顯示 🟡（S39/R9） | agent 回報舊版 version | 註冊 | manager 端節點帶 warning 狀態與提示訊息 |
| INT-BACKOFF-01 | Manager 暫時不可達時 Agent 退避重連（S44） | agent 運行中 | 停止 manager 數秒後重啟 | agent 以 backoff 重試並在最終自動連上 |

---

## 5. 端對端測試（Playwright）

> 前置：`globalSetup` 啟動 manager（加速心跳閾值環境變數）+ 2 個 agent process（web-server-01、db-server-01），並預置 registry。心跳類案例使用專屬 project/worker 以隔離長等待。

| # | 測試名稱（來源 Scenario） | 操作步驟 | 預期結果 |
|---|--------------------------|---------|---------|
| E2E-01 | 登入後預設 Aggregate Dashboard（S1 @smoke @p0） | 登入 → 導航 /dashboard | 統計列「總節點數 2／線上 2／離線 0」＋匯總服務統計；2 張 Node Card 各顯示名稱、Hostname、🟢、服務摘要 M/N、最後心跳、CPU/Memory |
| E2E-02 | 無節點空狀態引導（S2 @edge-case） | 以空 registry 環境登入 | 「尚無已註冊節點，請先新增節點」＋前往 Node Management 入口 |
| E2E-03a | 點擊 web-server-01 Card 切換（S3 row1） | 點 Card(web-server-01) | URL=/dashboard?node=1；Header 顯示目前節點＋下拉＋「所有節點」；列表僅該節點服務 |
| E2E-03b | 點擊 db-server-01 Card 切換（S3 row2） | 點 Card(db-server-01) | URL=/dashboard?node=2；同上驗證 |
| E2E-04 | Header 下拉切換節點（S4） | 在 node=1 視圖下拉選 db-server-01 | 切至 node=2 視圖、Header 名稱更新、服務列表更換 |
| E2E-05 | 「所有節點」返回（S5） | 單節點視圖點返回 | Aggregate 網格與匯總統列重現 |
| E2E-06a | 單節點 start 操作（S6 row1） | node=1 對 nginx.service 按 start | loading spinner → Toast「[web-server-01] nginx.service 已啟動」→ 列狀態更新 → audit 新增（node_id=1） |
| E2E-06b | stop（S6 row2） | 同上按 stop | Toast「…已停止」 |
| E2E-06c | restart（S6 row3） | 同上按 restart | Toast「…已重啟」 |
| E2E-06d | enable（S6 row4） | 同上按 enable | Toast「…已設定開機啟動」 |
| E2E-06e | disable（S6 row5） | 同上按 disable | Toast「…已取消開機啟動」 |
| E2E-07 | 查看節點服務日誌（S7） | node=1 開啟 nginx.service 日誌 | 顯示該節點該服務的 journalctl 內容 |
| E2E-08 | 操作失敗顯示原因（S8） | 對預先注入會失敗的情境按 restart | Toast「[web-server-01] nginx.service 重啟失敗：權限不足」；狀態不變 |
| E2E-09 | 開啟新增節點表單（S10） | /nodes → 新增節點 | Modal 含必填/選填欄位與三顆按鈕 |
| E2E-10 | 測試連線成功（S11） | 填入真實運行中 agent 位址 → 測試連線 | 綠色「連線成功」＋版本/主機資訊；Modal 不關閉 |
| E2E-11 | 測試連線失敗重試（S12 @edge-case） | 填入 127.0.0.1:1 → 測試 → 修正為正確位址 → 再測 | 紅色「無法連線：…」→ 修改後變綠色成功 |
| E2E-12 | 註冊成功並上線（S13） | 填 app-server-01 + 可達位址 → 註冊 | Modal 關、列表 +1、🟢、Toast「已註冊並上線」、Aggregate 節點數 +1 |
| E2E-13 | 註冊不可達節點存為離線（S14 @edge-case） | 填 backup-server-01 + 不可達位址 → 註冊 | 列表 +1、🔴、Toast「已註冊但無法連線」 |
| E2E-14 | 取消新增（S15） | 填部分欄位 → 取消 | Modal 關、無新節點 |
| E2E-15a | 下載 Agent amd64（S16 row1） | /nodes → 下載 Agent → amd64 | 下載 agent-linux-amd64 |
| E2E-15b | 下載 Agent arm64（S16 row2） | 下載 Agent → arm64 | 下載 agent-linux-arm64 |
| E2E-16 | 心跳中斷 30 秒離線偵測（S18 @smoke @p0 @business-rules，⚡加速閾值執行） | SIGSTOP web-server-01 agent → 等待加速離線閾值 | Card 🔴、統計灰顯、「最後心跳：X 秒前」、線上 −1／離線 +1、Toast「web-server-01 已離線」 |
| E2E-17 | 離線時單節點操作禁用（S19 @p0） | 進入 node=1 視圖後令其離線 | 全部操作按鈕 disabled＋黃色 Banner「節點已離線，操作不可用」 |
| E2E-18 | 寬限期內恢復回線上（S20 @business-rules，⚡加速） | 離線後 SIGCONT agent | 🟢、Toast「已恢復連線」、服務狀態重新載入 |
| E2E-19 | 超過寬限期長期離線（S21 @business-rules，⚡加速） | 保持 STOP 超過加速寬限期 | ⚫ 長期離線、卡片移至底部或摺疊 |
| E2E-20 | 離線節點資訊面板（S22） | 點擊離線節點 Card | 面板顯示最後上線/心跳、離線持續時間、版本、Hostname、操作建議、「重新連線」「移除節點」按鈕 |
| E2E-21 | 確認後移除節點（S23 @smoke） | /nodes → 移除 db-server-01 → 確認 | 確認框文案正確；移除後列表/Dashboard 消失、Toast「節點已移除」、節點數 −1 |
| E2E-22 | 跨節點搜尋彙總（S24 @smoke） | Aggregate 搜尋框輸入 nginx | ≥300ms debounce 後顯示 web-server-01 與 db-server-01 兩筆結果（節點名+服務+狀態） |
| E2E-23 | 點擊搜尋結果跳轉展開（S25） | 點 "web-server-01 / nginx.service" | 跳轉 node=1 視圖且 nginx.service 自動展開 |
| E2E-24 | 搜尋無結果空狀態（S26 @edge-case） | 搜尋 nonexistent-svc | 「沒有找到匹配的服務」 |
| E2E-25 | 關閉搜尋返回卡片視圖（S27 @edge-case） | 顯示結果中點關閉 | 返回 Node Cards 網格 |
| E2E-26 | 節點詳情面板（S28） | 點 web-server-01「詳情」 | 側面板顯示名稱/Hostname/版本/OS/上線時長/最後心跳/資源概覽＋三顆操作按鈕 |
| E2E-27 | Agent 掛掉 → 離線 → 重啟恢復（S29/R1 @edge-case，⚡加速） | SIGKILL agent → 觀察 → 重啟 agent | 離線全套 UI 反應（紅燈/Banner/Toast）→ 恢復後自動回線上＋Toast「已恢復連線」 |
| E2E-28 | 操作逾時 15 秒可重試（S32/R3，⚡加速 timeout 注入） | 對延遲 mock 的服務按 restart | spinner 超時後 Toast「[web-server-01] 操作逾時：nginx.service restart」，可再次點擊 |
| E2E-29 | 搜尋部分節點失敗不阻塞（S33/R4，⚡加速搜尋逾時） | db-server-01 離線後搜尋 nginx | 僅 web-server-01 結果先顯示；db-server-01 標「無法查詢」 |
| E2E-30 | 名稱重複註冊被拒（S38/R8 @edge-case） | 新增表單填已存在名稱 → 註冊 | Toast「節點名稱重複，請使用不同名稱」；表單保留可改名重送 |
| E2E-31 | 版本不相容 🟡 警告（S39/R9） | 以舊版 version 字串的 mock agent 註冊 | 節點 🟡＋Tooltip「Agent 版本過舊 (v1.0)，建議升級至 v1.2+」；可下載新版 binary |
| E2E-32 | 必填欄位缺失攔截（S40） | 留空必填 → 註冊 | 紅色欄位提示、無請求發出 |
| E2E-33 | 節點狀態變更即時推送（S50） | 開著 Dashboard，另一 worker 令某 agent 離線 | 頁面不重整即更新 Card 與統計列 |
| E2E-34 | 節點增刪即時更新＋WS 重連（S51） | 另一 session 新增/移除節點；中途斷開前端 WS | 列表即時增刪；WS 重連後事件續收 |

---

## 6. 心跳／逾時類測試加速策略（⭐ 本功能關鍵）

### 6.1 可設定化建議（開發配合項）

所有時間參數必須可由環境變數／設定檔覆寫，程式碼中的預設值僅供生產使用：

| 參數 | 生產預設 | 測試建議值 | 環境變數（建議） |
|------|---------|-----------|----------------|
| Agent 心跳間隔 | 10s | **200ms** | `AGENT_HEARTBEAT_INTERVAL` |
| 離線閾值（3×心跳） | 30s | **600ms** | `MANAGER_OFFLINE_THRESHOLD` |
| 長期離線閾值 | 300s | **3s** | `MANAGER_LONG_OFFLINE_THRESHOLD` |
| Monitor 掃描 tick | 5s | **200ms** | `MANAGER_MONITOR_TICK` |
| 啟動寬限期 | 30s | **2s** | `MANAGER_STARTUP_GRACE` |
| 服務操作逾時 | 15s | **800ms** | `MANAGER_RPC_TIMEOUT_ACTION` |
| 查詢/搜尋總逾時 | 10s | **1s** | `MANAGER_RPC_TIMEOUT_QUERY` |
| WS read deadline | 35s | **700ms** | `MANAGER_WS_READ_DEADLINE` |

**原則**：
1. **單元測試不用 sleep**：`nodemonitor` 接受注入的 clock func 與閾值參數，直接推進 fake time。
2. **整合/E2E 用加速環境變數**：整體測試套件的心跳場景耗時可從「30s+300s ≈ 6 分鐘」壓到「< 10 秒」。
3. **斷言用 Eventually polling**（deadline = 閾值 × 5），避免固定 sleep 造成 flaky。
4. **至少一組「接近生產值」的手動驗證**保留真實 10s/30s/300s 行為（見第 7 節 MAN-02），防止加速值掩蓋真實尺度下的問題（例如 timer 精度、goroutine 洩漏只在長時間運行浮現）。
5. BDD 中「連續 30 秒（3 次）」的語意以「閾值 = 3 × 心跳間隔」實作，加速時兩者同時縮放，保持倍率關係被測到（SYS-MON-02/04 明確驗證倍率而非絕對秒數）。

### 6.2 Playwright 配置建議

```ts
// playwright.config.ts（節選）
{
  timeout: 30_000,
  expect: { timeout: 10_000 },   // 加速閾值下，離線轉換 <2s，10s 足夠
}
```

---

## 7. 手動驗證（真實環境）

| # | 情境 | 驗證步驟 | 預期 |
|---|------|---------|------|
| MAN-01 | Agent 實機部署與上線（S17） | 在真實 Linux 機器（amd64 與 arm64 各一）部署 binary、撰寫 agent.yaml、systemd 啟動 | Agent 註冊上線、心跳穩定每 10 秒一次、Aggregate Dashboard 即時顯示 |
| MAN-02 | 生產尺度心跳行為（S18/S20/S21，真實 10s/30s/300s） | 真實環境停止 agent，肉眼計時觀察 | 約 30 秒轉 🔴；300 秒轉 ⚫；恢復 agent 後自動回 🟢 |
| MAN-03 | 真實 systemd 操作（S6） | 經 UI 對真實 nginx.service 執行五種操作 | systemctl 實際生效（`systemctl status` 驗證），audit log 正確 |
| MAN-04 | 真實網路斷線（S30/S31/R2） | 拔網路線／關 WiFi 中斷 manager↔agent | 寬限期內恢復→無縫回 🟢；超過寬限期→⚫ 需確認 |
| MAN-05 | 真實 TLS/mTLS 憑證輪替（S34/S35/R5） | 使用將過期的真實自簽憑證；輪替憑證並更新指紋 | 過期前後行為符合規格；更新指紋後恢復連線 |
| MAN-06 | 跨機防火牆/NAT 拓撲（決策 1 outbound-only） | Agent 端位於 NAT 後（不開 inbound port） | 連線與操作一切正常（outbound WS 特性驗證） |
| MAN-07 | 不提供跨節點編排（S46/B9） | 檢視 UI 全部功能面 | 無任何跨節點相依批次編排入口；管理員手動依序操作可行 |
| MAN-08 | nodes.json 檔案權限（S48/風險表） | `ls -l /var/lib/linux-service-manager/nodes.json` | 權限 0600；含 token 不致外洩 |
| MAN-09 | 50 節點規模煙霧測試（S41/B1，選做） | 腳本起 50 個 agent container/process | Manager 穩定、summary 正確、第 51 台被拒 |

---

## 8. 測試環境

| 項目 | 需求 |
|------|------|
| Go | 1.24.4（src/go.mod） |
| Node.js / 套件管理 | 依 frontend/package.json（Vite 8 生態）；Vitest ^4.1.10、happy-dom ^20.11.1、@vue/test-utils ^2.4.11 |
| Playwright | ^1.62.1（frontend/e2e/，Chromium 為主，回歸加跑 Firefox/WebKit） |
| 單元測試 OS | Linux（CI）；開發機 macOS 可跑（systemd 相關以 mock 隔離） |
| 整合/E2E OS | Linux（需能 spawn 多 process 與 kill -STOP/-CONT） |
| TLS 測試材料 | 測試 helper 動態產生自簽憑證（含已過期、指紋篡改等變體） |
| systemd | 手動驗證需真實 systemd 主機（Ubuntu 22.04+/Debian）；自動化測試以 fake/mock systemd 隔離 |
| 心跳加速 | 上述環境變數於 CI 一律設定加速值 |

---

## 9. 覆蓋矩陣（BDD Scenario → 測試案例）

> 每列一個 BDD Scenario（Outline 已展開）。✅ 表示主要歸屬，括號為次要覆蓋。

| BDD # | Scenario（標籤） | 主要測試層級 | 對應測試案例 ID |
|:---:|---|---|---|
| S01 | 登入後預設 Aggregate Dashboard（@smoke @p0） | E2E | E2E-01（F-ST-02、F-NC-01、HDL-SUM-01） |
| S02 | 無節點空狀態引導（@edge-case） | E2E | E2E-02（F-DB-02） |
| S03a | Card 切換 web-server-01（Outline row1，@smoke @p0） | E2E | E2E-03a（F-NS-01、F-ST-05） |
| S03b | Card 切換 db-server-01（Outline row2） | E2E | E2E-03b（F-NS-01） |
| S04 | Header 下拉切換節點（@p1） | E2E | E2E-04（F-NS-02/F-NS-03） |
| S05 | 「所有節點」返回（@p1） | E2E | E2E-05（F-NS-04） |
| S06a | 單節點 start（Outline row1，@smoke @p0） | E2E | E2E-06a（HDL-NP-02、F-SV-01） |
| S06b | stop（row2） | E2E | E2E-06b（HDL-NP-03） |
| S06c | restart（row3） | E2E | E2E-06c（HDL-NP-04） |
| S06d | enable（row4） | E2E | E2E-06d（HDL-NP-05） |
| S06e | disable（row5） | E2E | E2E-06e（HDL-NP-06） |
| S07 | 查看節點服務日誌（@p1） | E2E | E2E-07（HDL-NP-08、F-LOG-01） |
| S08 | 操作失敗顯示原因（@p1） | E2E | E2E-08（HDL-NP-07、F-SV-02） |
| S09 | 並行操作限制 B4（@business-rules @p2） | 後端單元 | SYS-PF-05/06/07（HDL-NP-10、F-SV-03、E2E 交互涵蓋） |
| S10 | 開啟新增節點表單（@p1） | E2E | E2E-09（F-FM-01、F-NM-01） |
| S11 | 測試連線成功（@p1） | E2E | E2E-10（HDL-TC-01、F-FM-02） |
| S12 | 測試連線失敗重試（@edge-case @p1） | E2E | E2E-11（HDL-TC-02、F-FM-03） |
| S13 | 註冊成功且可達（@p1） | E2E | E2E-12（INT-REG-01、HDL-NODE-01、F-FM-05） |
| S14 | 註冊不可達仍儲存離線（@edge-case @p1） | E2E | E2E-13（INT-REG-02、F-FM-06） |
| S15 | 取消關閉表單（@p2） | E2E | E2E-14（F-FM-08） |
| S16a | 下載 Agent amd64（Outline row1，@p1） | E2E | E2E-15a（HDL-DL-01、F-NM-04） |
| S16b | 下載 Agent arm64（row2） | E2E | E2E-15b（HDL-DL-02） |
| S17 | Agent 部署後註冊並心跳（@p0） | 整合 | INT-BOOT-01（SYS-AC-01/02、MAN-01） |
| S18 | 心跳中斷 30 秒離線偵測（@smoke @p0 @business-rules） | E2E | E2E-16（SYS-MON-02/04、INT-HB-01、F-WS-04、F-NC-02/04） |
| S19 | 離線時操作全禁用（@p0） | E2E | E2E-17（F-OFF-01、HDL-NP-09） |
| S20 | 寬限期內恢復回線上（@business-rules @p1） | E2E | E2E-18（SYS-MON-07、INT-HB-02、F-OFF-02） |
| S21 | 超過 300 秒長期離線（@business-rules @p1） | E2E | E2E-19（SYS-MON-05/06、INT-HB-03、F-NC-03） |
| S22 | 離線節點資訊面板（@p1） | E2E | E2E-20（F-OFF 系列、HDL-NODE-05） |
| S23 | 確認對話框移除節點（@smoke @p1） | E2E | E2E-21（HDL-NODE-07、F-NM-02/03、SYS-REG-05） |
| S24 | 跨節點搜尋彙總（@smoke @p1） | E2E | E2E-22（SYS-SRCH-01、HDL-SRCH-01、F-SE-01/02、INT-SRCH-01） |
| S25 | 點擊搜尋結果跳轉展開（@p1） | E2E | E2E-23（F-SE-03） |
| S26 | 搜尋無結果空狀態（@edge-case @p2） | E2E | E2E-24（F-SE-04、SYS-SRCH-04） |
| S27 | 關閉搜尋返回 Card（@edge-case @p2） | E2E | E2E-25（F-SE-05） |
| S28 | 節點詳細資訊面板（@p2） | E2E | E2E-26（HDL-INF-01） |
| S29 | Agent 掛掉心跳中斷 R1（@regression @edge-case @p1） | E2E | E2E-27（INT-HB-01/02、MAN-02） |
| S30 | 網路中斷寬限期內恢復 R2（@regression @edge-case @business-rules @p1） | 整合 | INT-NET-01（SYS-MON-07、MAN-04） |
| S31 | 網路中斷超過寬限期 R2（同上） | 整合 | INT-NET-02（SYS-MON-05、MAN-04） |
| S32 | 操作逾時 15 秒可重試 R3/B3（@regression @edge-case @business-rules @p1） | E2E | E2E-28（SYS-PF-02、F-SV-04） |
| S33 | 搜尋部分失敗不阻塞 R4/B3（@regression @edge-case @business-rules @p1） | E2E | E2E-29（SYS-SRCH-02/03/05、F-SE-06） |
| S34 | TLS 憑證過期測試連線失敗 R5（@regression @edge-case @p1） | 後端單元 | SYS-TLS-04（HDL-TC-03/04、MAN-05） |
| S35 | 已註冊節點憑證過期轉離線 R5（@regression @edge-case @p1） | 整合 | INT-TLS-01（MAN-05） |
| S36 | Manager 重啟啟動寬限期重連 R6（@regression @edge-case @business-rules @p2） | 整合 | INT-RESTART-01（SYS-MON-10/11） |
| S37 | 第二個 Manager 被拒 R7（@regression @edge-case @p2） | 整合 | INT-AUTH-01（SYS-AC-06） |
| S38 | 名稱重複註冊被拒 R8（@regression @edge-case @p1） | E2E | E2E-30（HDL-NODE-02、SYS-REG-02、F-FM-07） |
| S39 | 版本不相容 🟡 警告 R9（@regression @edge-case @p2） | E2E | E2E-31（SYS-AC-05、INT-VER-01、F-NC-06） |
| S40 | 必填欄位缺失驗證（@regression @edge-case @p1） | E2E | E2E-32（HDL-NODE-03、F-FM-04） |
| S41 | 節點數上限 50 台 B1（@business-rules @p2） | 後端單元 | SYS-REG-03/04（HDL-NODE-09、MAN-09） |
| S42 | 心跳間隔與離線判定閾值 B2（@business-rules @p1） | 後端單元 | SYS-MON-01～06（SYS-AC-02、INT-HB 系列、§6.1 加速策略） |
| S43 | 強制 TLS 可選 mTLS B5（@business-rules @p1） | 後端單元 | SYS-TLS-01/05/06（INT-TLS-01、MAN-05） |
| S44 | 指數退避自動重試（@p1） | 後端單元 | SYS-AC-03/04（INT-BACKOFF-01） |
| S45 | 即時代理查詢不做快取 B8（@business-rules @p2） | 後端單元 | SYS-PF-08（HDL-NP-01、INT-PROXY-01） |
| S46 | 不支援跨節點編排 B9（@business-rules @p2） | 手動 | MAN-07（否定性 UI 檢查） |
| S47 | Audit Log 含節點資訊 B10（@business-rules @p1） | 後端單元 | INT-PROXY-01 audit 斷言（HDL-NP-02～06、既有 audit 測試延伸） |
| S48 | Registry 持久化重啟保留（@business-rules @p2） | 後端單元 | SYS-REG-07/08/09/10/11（INT-RESTART-01、MAN-08） |
| S49 | Manager 代理授權模型 B7（@business-rules @p2） | 後端單元 | SYS-AC-06（INT-AUTH-01、SYS-TLS-06） |
| S50 | 節點狀態變更即時推送（@p1） | E2E | E2E-33（F-WS-01、SYS-MON 事件發布、INT-HB-01） |
| S51 | 節點增刪即時更新＋WS 重連（@p2） | E2E | E2E-34（F-WS-02/03、F-ST-04） |

### 覆蓋率自我檢查

| 檢查項 | 結果 |
|--------|------|
| BDD 情境區塊 51 個（48 Scenario + 3 Outline）全數列入矩陣 | ✅ S01–S51（Outline 已展開為 S03a/b、S06a–e、S16a/b） |
| 每個情境至少 1 個測試案例 | ✅ |
| Outline Examples 每列獨立案例 | ✅ 2+5+2 = 9 列 |
| ID 唯一性 | ✅ SYS-* / HDL-* / F-* / INT-* / E2E-* / MAN-* 各前綴內無重複 |
| 心跳逾時類加速建議 | ✅ §6.1 環境變數表 + fake clock + Eventually polling + MAN-02 真實尺度保留 |

**案例統計**：後端單元 66（SYS-MON 11 + SYS-REG 11 + SYS-PF 9 + SYS-SRCH 5 + SYS-TLS 6 + SYS-AC 6 + HDL-NODE 9 + HDL-TC 5 + HDL-NP/SRCH/SUM/DL 14，含子項合計）｜前端單元 37｜整合 16｜E2E 46（含 Outline 展開）｜手動 9 → **合計約 174 個測試案例**

---

## 10. 缺陷追蹤模板

| 欄位 | 說明 |
|------|------|
| ID | BUG-MN-XXX（MN = multi-node） |
| 測試案例 | 對應上述 SYS-/HDL-/F-/INT-/E2E-/MAN- 編號 |
| 嚴重程度 | P0(阻擋) / P1(主要) / P2(次要) |
| 重啟步驟 | 逐步操作（含拓撲：幾個 agent、何種加速環境變數） |
| 預期 vs 實際 | 對照 |
| 環境 | OS / Browser / Go 版本 / 心跳加速參數組合 |

---

## 11. 執行順序建議

1. **後端單元**（最快回饋）：SYS-MON → SYS-REG → SYS-PF → SYS-TLS → HDL-*
2. **前端單元**：store → 元件 → composable/useWebSocket
3. **整合測試**（多進程 harness）：INT-REG/BOOT → INT-HB（加速）→ INT-PROXY → INT-RESTART/TLS/AUTH
4. **E2E**：@p0 冒煙（E2E-01/03/06/16/17）→ 主流程 → 異常與 edge-case（加速參數）
5. **手動驗證**：MAN-01～08（含 MAN-02 生產尺度心跳、MAN-09 規模測試）

---

*最後更新：2025-08-25*
