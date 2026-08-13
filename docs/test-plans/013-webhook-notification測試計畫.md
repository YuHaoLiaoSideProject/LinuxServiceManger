# Webhook 通知設定 — 測試計畫

> **對應 BDD**：`docs/bdds/013-webhook-notification.feature`
> **操作流程**：`docs/interaction-flows/013-webhook-notification.md`
> **技術決策**：`docs/tech-decisions/013-webhook-notification.md`
> **對應 Roadmap**：Phase 3 — `docs/development/002-expansion-roadmap.md` 項目 #18
> **開發規格**：`docs/development/013-webhook-notification.md`（由 development-spec-generator 產生；本計畫以 Tech Decision 8 項決策為技術依據，開發規格可輔助實作對照）
> **測試日期**：2026-08-13

---

## 0. 測試計畫決策備註（依 Tech Decision 裁決）

BDD 與 Tech Decision 存在下列技術細節，本測試計畫**以 Tech Decision 為準**，測試案例對應關係依此調整：

| # | 差異點 | BDD / Interaction Flow 描述 | Tech Decision 裁決（本計畫採用） |
|---|--------|------------------------------|----------------------------------|
| D-1 | **事件來源掛載點** | BDD「internal/notify 模組接收 D-Bus 狀態變更事件」 | **Hub 廣播漏斗 `OnStatusChange` 回呼**（決策 1）：`BroadcastStatusChange(name, active, sub)` 內加掛，D-Bus 與 polling fallback 兩路徑自動覆蓋；monitor 程式碼零改動；`BroadcastOnBootChange`（enable/disable）不觸發通知 |
| D-2 | **restarted 事件判定** | BDD 觸發事件含 restarted | **狀態機轉換**（決策 1）：離開 active 後 **5 秒內**回到 active 判定為 restarted（避免重複觸發 stopped + started）；超過 5 秒視為正常 stop → start，分別觸發兩筆 |
| D-3 | **資料儲存** | BDD「設定寫入 /var/lib/linux-service-manager/notify.json」 | 沿用而非複製既有 pattern：channel 設定存 JSON（atomic temp+rename + RWMutex，仿 token store）；發送紀錄存 JSONL（buffered channel + writer goroutine，仿 audit） |
| D-4 | **timeout/retry 語意** | BDD「逾時 10 秒視為失敗且最多重試 1 次（總計最多 20 秒）」 | `http.Client{Timeout: 10s}` + 手動 retry 1 次（同 channel 重試 1 次、新 request）；成功判定 = HTTP 2xx 且 Telegram body JSON `ok:true`（`ok:false` 時將 `description` 記錄於 history detail） |
| D-5 | **自動停用計數基準** | BDD「連續失敗 10 次後 Channel 自動停用」 | in-memory failure counter：**每次背景發送失敗 `failures++`、成功歸零**；達 10 次 → `enabled=false` + `auto_disabled_reason` **立即持久化** + WS 推送 `notify_channel_disabled`；**test endpoint 不影響 failure counter**（決策 5/8） |
| D-6 | **test endpoint 副作用** | BDD「測試通知發送成功顯示成功提示」 | POST test **不寫入 history、不影響 failure counter**；測試**成功**時順便歸零 failures（決策 8） |
| D-7 | **channel 上限** | BDD「20 個上限」 | 新增時檢查總數 ≤20，超過回 400/409（決策 8） |
| D-8 | **自訂 Webhook 驗證** | BDD「headers 最多 10 組」 | headers ≤10、key 黑名單 `Host` / `Content-Length` / `Transfer-Encoding` / `Connection` 不可覆寫；method ∈ POST/PUT（預設 POST）；Slack/Discord/custom URL 必須 `https://`；Telegram 為 token 非 URL（決策 4/8） |
| D-9 | **紀錄 TTL 清理** | BDD「保留 30 天，超過自動清理」 | 啟動時清理一次 + 每日 ticker（決策 6）；另設 100MB 檔案大小上限防呆；清理為掃描 → 寫暫存 → `os.Rename` 原子替換 |
| D-10 | **權限** | BDD「所有已登入管理員皆可管理」 | 目前所有已登入管理員可管理（RBAC 後續限縮）；API 回應不回傳 Telegram token（masked `****xxxx`）；notify.json 檔權限 0600 |

---

## 1. 測試範圍總覽

| 層級 | 範圍 | 工具 | 負責 |
|------|------|------|------|
| 單元測試 | Go `internal/notify/payload.go`（4 種 payload 建構） | `go test` | 後端 |
| 單元測試 | Go `internal/notify/notifier.go`（狀態機轉換 / 匹配邏輯） | `go test` | 後端 |
| 單元測試 | Go `internal/notify/sender.go`（並行發送 / timeout 10s / retry 1 次） | `go test` + `net/http/httptest` | 後端 |
| 單元測試 | Go `internal/notify/store.go`（notify.json atomic save / failures counter / auto-disable / 20 上限） | `go test` | 後端 |
| 單元測試 | Go `internal/notify/history.go`（JSONL writer / Query 分頁篩選 / 30 天 TTL cleanup） | `go test` | 後端 |
| 單元測試 | Go `internal/handler/notify_handler.go`（7 個 API endpoint + 401 + 參數驗證） | `go test` + `httptest` | 後端 |
| 單元測試 | Vue `NotificationsView.vue`（列表 / 空狀態 / 分頁 / 篩選 / WS 停用 Toast） | Vitest 4.1.10 + @vue/test-utils 2.4.11 + happy-dom | 前端 |
| 單元測試 | Vue `ChannelForm.vue`（4 類型動態欄位 / 驗證 / 服務多選） | Vitest 4.1.10 + @vue/test-utils 2.4.11 | 前端 |
| 單元測試 | Vue `ChannelCard.vue`（toggle 樂觀更新 / 測試按鈕 loading / 刪除） | Vitest 4.1.10 + @vue/test-utils 2.4.11 | 前端 |
| 單元測試 | Vue `ChannelHistoryTable.vue`（表格 / 篩選 / 分頁 / 顏色標示） | Vitest 4.1.10 + @vue/test-utils 2.4.11 | 前端 |
| 單元測試 | Vue `useNotifyChannels.ts` + `api/client.ts` 擴充 | Vitest 4.1.10 | 前端 |
| 整合測試 | Notifier ↔ Store ↔ Sender ↔ History ↔ WebSocket Hub（真實檔案 / mock server 全鏈路） | `go test`（integration） | 後端 |
| 端對端測試 | 完整使用者流程（進入頁面 → 新增 → 測試 → 開關 → 刪除 + 實際狀態變更觸發通知 + 自動停用） | Playwright 1.62.1 | 前端 |
| 手動驗證 | 真實環境（實際 Slack/Discord/Telegram 平台接收、D-Bus 中斷 fallback、Telegram rate limit、真實服務 crash） | 手動 | QA |

---

## 2. 後端單元測試

> 新增測試檔：`src/internal/notify/payload_test.go`、`src/internal/notify/notifier_test.go`、`src/internal/notify/sender_test.go`、`src/internal/notify/store_test.go`、`src/internal/notify/history_test.go`、`src/internal/handler/notify_handler_test.go`
> 沿用既有 pattern：table-driven test + `httptest.NewRecorder` / `httptest.NewServer`（mock 目標平台）

### 2.1 payload.go — 4 種 Channel 類型 payload 建構（純函式）

> 對應 BDD：`@business-rules @payload` Scenario Outline「依 Channel 類型建構對應格式的通知 payload」（4 Examples）+ `@edge-case @payload`「payload 僅含服務摘要」

| # | 測試名稱 | Given | When | Then |
|---|---------|-------|------|------|
| SYS-01 | Slack payload 格式正確 | channel type=slack、URL 為 Slack webhook、事件 failed、服務 nginx.service | `BuildPayload(ch, ev)` | JSON body 含 `{"text": "🔔 Linux Service Manager", "attachments": [{color, title: "nginx.service failed", text}]}`；text 含狀態符號與 UTC RFC3339 時間 |
| SYS-02 | Slack color 對應 4 種事件 | 事件依序為 started / stopped / failed / restarted | 分別建構 payload | color 依序為 `good` / `warning` / `danger` / `warning`（決策 D-1） |
| SYS-03 | Discord embed 格式 + color 十進位 | channel type=discord、事件 failed | `BuildPayload` | body 含 `{"username": "Linux Service Manager", "embeds": [{title, description, color, timestamp}]}`；color 為十進位 `16711680`（0xFF0000） |
| SYS-04 | Discord color 3 種狀態值 | 事件 started / stopped / failed | 分別建構 payload | color = `65280`(0x00FF00) / `16753920`(0xFFA500) / `16711680`(0xFF0000) |
| SYS-05 | Telegram 授權與參數格式 | channel type=telegram、bot_token=`123456789:AA...`、chat_id=123456789、事件 failed | `BuildPayload` | 回傳 JSON body `{"chat_id": "...", "text": "..."}`；發送時 `Content-Type: application/json`、URL 為 `https://api.telegram.org/bot{BOT_TOKEN}/sendMessage`（token 內嵌於 URL 路徑、無 Authorization header） |
| SYS-06 | 自訂 Webhook JSON payload | channel type=custom、method=POST、事件 failed | `BuildPayload` | body 為 JSON `{"event":"failed","service":"nginx.service","status":"failed","timestamp":"RFC3339"}` |
| SYS-07 | 自訂 Webhook 支援 POST/PUT | method 分別為 POST 與 PUT（Outline ×2） | 發送 | 以對應 method 發出請求；body 同 JSON 格式 |
| SYS-08 | 自訂 headers 帶入與黑名單 | headers 含 `X-Custom: v1`、`Authorization: Bearer xxx`、`Host: evil`、`Content-Length: 999` | `BuildPayload` / 發送 | `X-Custom` 與 `Authorization` 帶入請求；`Host` / `Content-Length` / `Transfer-Encoding` / `Connection` 被忽略（黑名單，決策 D-8） |
| SYS-09 | payload 僅含服務摘要不含完整 log | nginx.service 的 journal log 含大量內容 | `BuildPayload` | payload 僅含服務名稱、狀態、時間等摘要；**不包含任何 log 內容**（決策 4） |
| SYS-10 | Telegram payload 內容含服務摘要 | channel type=telegram、事件 started | `BuildPayload` | text 含服務名稱、狀態、時間摘要；無 log 內容 |

### 2.2 notifier.go — 狀態機轉換（決策 1 狀態機規則）

> 對應 BDD：`@trigger` Scenario Outline「服務狀態變更為 <event> 時觸發」（4 Examples）+ `@edge-case @trigger-events`「reloaded 不觸發」

| # | 測試名稱 | Given | When | Then |
|---|---------|-------|------|------|
| SYS-11 | 轉換為 failed 觸發 failed | 前次狀態 active、新 ActiveState=`failed` | `HandleStatusChange("nginx.service","failed","sub")` | 產生事件 `failed` |
| SYS-12 | active → inactive 觸發 stopped | 前次狀態 active、新狀態=`inactive` | `HandleStatusChange` | 產生事件 `stopped` |
| SYS-13 | active → dead 觸發 stopped | 前次狀態 active、新狀態=`dead` | `HandleStatusChange` | 產生事件 `stopped` |
| SYS-14 | inactive → active（>5s）觸發 started | 前次 inactive、離開 active 超過 5 秒後回到 active | `HandleStatusChange` | 產生事件 `started`（正常 stop 後再 start） |
| SYS-15 | 5 秒內回到 active 觸發 restarted | 序列 active→deactivating→inactive→active，間隔 ≤5s（systemctl restart 典型序列） | 依序呼叫 | 僅產生一筆事件 `restarted`（**不重複** stopped + started，決策 D-2） |
| SYS-16 | 超過 5 秒的 stop→start 產生兩筆 | 序列 active→inactive（t=0）→active（t=8s） | 依序呼叫 | 產生 `stopped` 與 `started` 兩筆獨立事件 |
| SYS-17 | deactivating 記錄離開時間 | 新狀態=`deactivating` | `HandleStatusChange` | 記錄 `leftActiveAt[name]`；不觸發任何事件 |
| SYS-18 | sub 單獨變更不觸發 | active 不變、僅 sub 變更 | `HandleStatusChange` | 無事件產生（skip） |
| SYS-19 | reloaded 不觸發通知 | 狀態變更為 reloaded（或 ActiveState 無變化） | `HandleStatusChange` | 不產生任何事件、不發送通知、紀錄無新增（決策 1/邊界） |
| SYS-20 | enable/disable（unit file state）不觸發 | `BroadcastOnBootChange` 呼叫 | 確認通知模組掛載點 | OnStatusChange 不接收該事件；不觸發通知 |

### 2.3 notifier.go — 匹配邏輯（事件 + 服務範圍）

> 對應 BDD：`@trigger @business-rules` Scenario Outline「觸發事件與服務範圍需同時匹配才發送通知」（3 Examples）+「已停用的 Channel 不會收到任何通知」

| # | 測試名稱 | Given | When | Then |
|---|---------|-------|------|------|
| SYS-21 | enabled + 事件包含 + 全部服務 → 匹配 | channel enabled、events=[failed]、all_services=true | nginx.service 變更為 failed | 列入發送清單（決策 3 匹配規則） |
| SYS-22 | 停用 channel 一律跳過 | channel enabled=false | 任何狀態變更 | 跳過；不發送、不新增發送紀錄（BDD @trigger @business-rules） |
| SYS-23 | 事件不匹配 → 跳過 | channel events=[failed]、服務變更為 stopped | nginx.service → stopped | 不發送（事件不匹配） |
| SYS-24 | 指定服務精確匹配 → 發送 | channel events=[failed]、services=[postgresql.service]、all_services=false | postgresql.service → failed | 發送（事件與範圍皆匹配） |
| SYS-25 | 事件匹配但範圍不匹配 → 不發送 | channel events=[failed]、services=[postgresql.service] | nginx.service → failed | 不發送（範圍不匹配；Outline row 1） |
| SYS-26 | 範圍匹配但事件不匹配 → 不發送 | channel events=[failed]、services=[postgresql.service] | postgresql.service → stopped | 不發送（事件不匹配；Outline row 2） |
| SYS-27 | 事件與範圍皆匹配 → 發送 | channel events=[failed]、services=[postgresql.service] | postgresql.service → failed | 發送（Outline row 3） |
| SYS-28 | 精確匹配 — 不支援 regex/glob | channel services=[nginx.service] | 服務 `nginx` / `nginx-ssl.service` / `web.service` 變更為 failed | 三者皆不發送（Outline ×3；決策 4 精確 unit name） |
| SYS-29 | 無匹配 channel 時不發送 | 所有 channel 皆不匹配 | 狀態變更 | 不發送任何請求、紀錄無新增 |

### 2.4 sender.go — 並行發送 / timeout / retry（`httptest.Server` 驗證）

> 對應 BDD：`@trigger @error-handling @parallel`「多個 Channel 並行發送」+ `@timeout`「逾時 10 秒視為失敗且最多重試 1 次」+ `@background-failure`「背景發送失敗寫入 failure」

| # | 測試名稱 | Given | When | Then |
|---|---------|-------|------|------|
| SYS-30 | HTTP 2xx 判定成功 | mock server 回 200 | `sendWithRetry` | 回傳 ok=true；無重試 |
| SYS-31 | 非 2xx 判定失敗 | mock server 回 HTTP 500 | `sendWithRetry` | 回傳 ok=false、error 含 HTTP 狀態碼 |
| SYS-32 | 逾時 10 秒判定失敗 | mock server 延遲 >10s（sleep 11s） | 發送 | 10 秒後判定 timeout，回傳 ok=false、error 含 timeout |
| SYS-33 | 失敗後自動重試 1 次 | mock server 第一次回 500、第二次回 200 | 發送 | 共收到 **2 次**請求；最終 ok=true（retry 成功） |
| SYS-34 | 重試仍失敗不再重試 | mock server 連續回 500 | 發送 | 共收到 **2 次**請求（初發 + retry 1 次）；最終 ok=false；**無第 3 次請求**（總計最多 20s，決策 3） |
| SYS-35 | 多 channel 並行發送互不影響 | 兩個 channel 皆匹配；channel A mock 回 500、channel B mock 回 200 | `SendBatch` | A、B 並行（goroutine + WaitGroup）發送；A 失敗不影響 B；各自獨立寫入紀錄（success/failure 各一筆） |
| SYS-36 | 20 個 channel 並行上限 | 單一事件匹配 20 個 channel | `SendBatch` | 20 個 goroutine 並行完成；無死鎖；總等待時間不累加 |
| SYS-37 | Telegram ok:false 視為失敗 | mock Telegram 回 HTTP 200 但 body `{"ok":false,"description":"...",...}` | 發送 | 解析 body `ok`，判定失敗並將 `description`（如 400/401/429 錯誤說明）帶入錯誤原因、記錄於 history detail（決策 3） |
| SYS-38 | Telegram ok:true 視為成功 | mock Telegram 回 HTTP 200 + body `{"ok":true}` | 發送 | ok=true（成功判定 = HTTP 2xx 且 body JSON ok:true） |
| SYS-39 | 發送失敗回寫 failure + error detail | mock server 回 500 | `SendBatch` 後檢查 | history 寫入 status=failure、error 含原因（決策 3） |
| SYS-40 | 發送成功回寫 success | mock server 回 200 | `SendBatch` 後檢查 | history 寫入 status=success、duration_ms 記錄（含 retry 總耗時） |
| SYS-41 | 背景失敗累計 counter、成功歸零 | channel 前兩次失敗、第三次成功 | 依序發送 3 次 | failures 依序 1 → 2 → 0（決策 D-5） |

### 2.5 store.go — notify.json / failures counter / auto-disable / 上限

> 對應 BDD：`@edge-case @channel-limit`「20 個上限」+ `@auto-disable`「連續失敗 10 次自動停用」+ `@business-rules @data`「設定儲存於 JSON 檔案」

| # | 測試名稱 | Given | When | Then |
|---|---------|-------|------|------|
| SYS-42 | Load 載入 notify.json | 檔內 2 筆 channel | `Load()` | 正確載入；不存在的檔案 → 空清單（不 crash） |
| SYS-43 | Save 為 atomic write | store 有變更 | `Save()` | temp 檔寫入 + fsync + `os.Rename`；無 `.tmp` 殘留；同時刻讀取不看到部分內容 |
| SYS-44 | Create 新增 channel（UUID） | 新 channel 資料 | `Create()` | 回傳含 UUID（`crypto/rand`）的 channel；`created_at`/`updated_at` 為 RFC3339 UTC |
| SYS-45 | Update 更新 channel | 既有 channel | `Update()` | 欄位更新；`updated_at` 刷新；更新成功 failures 歸零（決策 8） |
| SYS-46 | Delete 刪除 channel | 既有 channel 含關聯紀錄 | `Delete()` | channel 自清單移除；**history 紀錄保留**（channel_name 快照，決策 8） |
| SYS-47 | SetEnabled 更新啟用狀態 | channel enabled=true | `SetEnabled(id,false)` | enabled=false 持久化 |
| SYS-48 | 連續第 10 次失敗自動停用 | channel failures 已達 9（連續失敗 9 次） | `IncrFailures` 第 10 次失敗 | failures=10 → `enabled=false`、`auto_disabled_reason` 寫入（「連續失敗 10 次自動停用」）並**立即持久化**至 notify.json（決策 D-5） |
| SYS-49 | 停用狀態重啟後保持 | 已自動停用的 channel 已寫入檔案 | 重新 `Load()` | channel 仍為 enabled=false、auto_disabled_reason 保留（防止 crash-loop 通知風暴，決策 5） |
| SYS-50 | 手動 re-enable 重置 | channel 已自動停用（reason 存在） | `SetEnabled(id,true)` | failures 歸零、auto_disabled_reason 清空（決策 5 恢復路徑） |
| SYS-51 | channel 上限 20 | 已存在 20 個 channels | `Create` 第 21 個 | 拒絕建立並回錯誤（決策 D-7 / BDD @channel-limit） |
| SYS-52 | 未達上限允許新增 | 已存在 19 個 channels | `Create` 第 20 個 | 建立成功 |
| SYS-53 | 並發 store 操作安全 | 多 goroutine 同時 Create/SetEnabled | `go test -race` | 無 data race（RWMutex 保護） |
| SYS-54 | 檔案權限 0600 | 首次 Save | 檢查檔案 mode | mode = 0600（決策 10 / 風險緩解） |

### 2.6 history.go — JSONL writer / Query / 30 天 TTL cleanup

> 對應 BDD：`@business-rules @data`「JSON Lines 儲存」+ `@edge-case @retention`「保留最近 30 天」+ `@error-handling @history`「發送紀錄過多分頁與 30 天清理」+ `@telegram`「Telegram rate limit」

| # | 測試名稱 | Given | When | Then |
|---|---------|-------|------|------|
| SYS-55 | Write 以 JSONL 追加寫入 | 完成一次發送（含 channel_name / event / service / status） | `Write(entry)` | `notify-history.jsonl` 新增一行合法 JSON；含 timestamp(RFC3339)、channel_id、channel_name、channel_type、event、service、status、duration_ms |
| SYS-56 | buffered channel writer 不阻塞 | 快速連續寫入 100+ 筆 | 批量 `Write` | 寫入 goroutine 非同步消化；滿則 drop + log warning（仿 audit，決策 2） |
| SYS-57 | Query 分頁回傳 total | 檔內 45 筆紀錄 | `Query(page=2, limit=30)` | 回傳第 2 頁 15 筆、total=45；依時間倒序 |
| SYS-58 | Query channel_id 篩選 | 紀錄含多個 channel | `Query(channel_id=X)` | 僅回傳該 channel 的紀錄（決策 8） |
| SYS-59 | Query status 篩選（全部/成功/失敗） | 紀錄含成功與失敗 | 依序 `Query(status=all/success/failure)`（Outline ×3） | all 不過濾；success 僅成功；failure 僅失敗 |
| SYS-60 | 30 天 TTL 清理 | 檔內含 31 天前與 10 天前的紀錄 | `cleanup()`（啟動時或每日 ticker） | 31 天前的紀錄被刪除、10 天前保留（原子替換 temp + rename） |
| SYS-61 | 100MB 大小上限防呆 | 檔案 > 100MB | ticker 觸發 | 額外觸發清理（決策 D-9） |
| SYS-62 | 刪除 channel 後紀錄仍可查詢 | channel 已刪除、紀錄含其 channel_name 快照 | `Query` | 紀錄仍回傳且顯示 channel_name（快照不因刪除消失） |
| SYS-63 | Telegram 429 + retry_after 記錄 | Telegram 回應 HTTP 429（含 `retry_after`） | 發送並寫入 | 429 回應（含 `retry_after`）記錄於 history detail；**不強制阻擋**後續發送（決策 4 / BDD @telegram） |
| SYS-64 | Shutdown 停止 writer goroutine | history 運作中 | `Shutdown()` | writer goroutine 優雅停止、buffer 內未寫入之筆數 flush 或明確丟棄（不 panic） |

### 2.7 Handler 層 — 7 個 API endpoint（`internal/handler/notify_handler.go`）

> 對應 BDD：全部 `@api` `@validation` `@security` Scenario（401 Outline ×7、參數驗證、上限）
> 測試方式：`httptest` + temp dir 佈建 notify.json / notify-history.jsonl + mock Sender

#### 2.7.1 Channels CRUD

| # | 測試名稱 | Given | When | Then |
|---|---------|-------|------|------|
| HDL-01 | GET channels 回傳所有 channel | store 有 2 筆（含 enabled=false） | GET /api/v1/notify/channels | 200，`{data:[...]}` 含 enabled / auto_disabled_reason；**不輸出 failures 欄位**；Telegram token 回 masked `****xxxx`（決策 D-10） |
| HDL-02 | POST 建立 channel 成功 | body 完整合法（Slack 型） | POST /api/v1/notify/channels | 200/201，`{data: Channel}` 含新 UUID |
| HDL-03 | POST 必填欄位驗證 | name 空 / 缺 type / Slack 缺 url / name 超過 64 字元 | POST | 400，明確錯誤訊息（決策 8 驗證規則） |
| HDL-04 | POST type 非法 | type="sms"（不在 4 種內） | POST | 400 |
| HDL-05 | POST url 非 https | Slack url = `http://example.com/hook` | POST | 400（Slack/Discord/custom 必須 https://） |
| HDL-06 | POST Telegram 型不需 url、需 bot token + chat_id | type=telegram、url 空、bot_token 有值（`123456789:AA...` 格式）、chat_id 有值 | POST | 建立成功（Telegram 以 bot token 認證，URL 後端固定） |
| HDL-07 | POST events 為空或非法 | events=[] 或含 "reloaded" | POST | 400（events 非空且 ⊆ 4 種事件） |
| HDL-08 | POST services 名稱驗證 | services=["nginx"]（非 systemd unit name） | POST | 400（`systemd.ValidateServiceName` 套用） |
| HDL-09 | POST custom headers 超過 10 組 | headers 11 組 | POST | 400「headers 最多 10 組」；channel 未建立 |
| HDL-10 | POST custom headers 含黑名單 key | headers 含 `Host` | POST | 400（黑名單不可覆寫） |
| HDL-11 | POST 超過 20 個上限 | 已存在 20 個 | POST 第 21 個 | 400/409，錯誤說明已達上限（決策 D-7） |
| HDL-12 | PUT 更新成功 | 既有 channel、body 完整 | PUT /api/v1/notify/channels/:id | 200，`{data: Channel}` 更新後內容；failures 歸零 |
| HDL-13 | PUT 不存在回 404 | id 不存在 | PUT | 404 |
| HDL-14 | PUT 驗證失敗 | body 缺 name | PUT | 400 |
| HDL-15 | DELETE 刪除成功 | 既有 channel 含歷史紀錄 | DELETE /api/v1/notify/channels/:id | 200 `{message}`；channel 移除；**history 紀錄保留** |
| HDL-16 | DELETE 不存在回 404 | id 不存在 | DELETE | 404 |
| HDL-17 | PATCH enabled 更新成功 | 既有 channel、body `{"enabled":false}` | PATCH /api/v1/notify/channels/:id | 200，`{data: Channel}` enabled=false |
| HDL-18 | PATCH body 格式錯誤 | body 非法 JSON / 缺 enabled | PATCH | 400 |
| HDL-19 | PATCH 不存在回 404 | id 不存在 | PATCH | 404 |
| HDL-20 | PATCH true 重置 counter 與 reason | channel 已自動停用（reason 存在） | PATCH `{"enabled":true}` | failures 歸零、auto_disabled_reason 清空（決策 D-5） |

#### 2.7.2 Test 與 History

| # | 測試名稱 | Given | When | Then |
|---|---------|-------|------|------|
| HDL-21 | POST test 成功回 200 | channel 存在、mock 目標平台 200 | POST /api/v1/notify/channels/:id/test | 200 `{success:true, message}`；測試訊息「🧪 這是一筆來自 Linux Service Manager 的測試通知」；**不寫入 history、不影響 failure counter**（決策 D-6） |
| HDL-22 | POST test 失敗回 502 含具體原因 | mock 平台回 403 / 逾時 | POST test | 502 `{success:false, error, detail}` 含具體原因（403/連線逾時等） |
| HDL-23 | POST test 不存在回 404 | id 不存在 | POST test | 404 |
| HDL-24 | POST test 成功歸零 failures | channel failures=3 | POST test（成功） | failures 歸零（決策 D-6） |
| HDL-25 | GET history 分頁 | 45 筆紀錄 | GET /api/v1/notify/history?page=2&limit=30 | 200 `{data, total:45, page:2, limit:30}`；依時間倒序 |
| HDL-26 | GET history 篩選 | 多 channel、成功+失敗紀錄 | GET /api/v1/notify/history?channel_id=X&status=failure | 僅回傳符合篩選的紀錄（決策 8） |
| HDL-27 | GET history 參數驗證 | page=0 / limit=1000 / status=unknown | GET | 400（參數邊界驗證） |
| HDL-28 | 401 — 未登入 7 個 endpoint | 無 session / 無 Bearer Token | 依序發送 GET/POST channels、PUT/PATCH/DELETE channels/1、POST channels/1/test、GET history（Outline ×7） | 全部回 **401 Unauthorized**（AuthMiddlewareComposite 攔截，決策 8）；資料未被修改 |

---

## 3. 前端單元測試

> 新增：`frontend/src/views/__tests__/NotificationsView.test.ts`、`frontend/src/components/__tests__/ChannelForm.test.ts`、`ChannelCard.test.ts`、`ChannelHistoryTable.test.ts`、`frontend/src/composables/__tests__/useNotifyChannels.test.ts`、擴充 `client.test.ts`
> 沿用既有 pattern（@vue/test-utils + happy-dom + vi.mock api client）

### 3.1 NotificationsView.vue — 頁面載入 / 列表 / 空狀態 / 分頁 / 篩選

> 對應 BDD：`@entry` 4 Scenario + `@history` 分頁篩選 Scenario

| # | 測試名稱 | Given | When | Then |
|---|---------|-------|------|------|
| F-NV-01 | 載入顯示 spinner | GET channels 尚未回應 | mount NotificationsView | 顯示 loading spinner（決策對應 IF 步驟 1） |
| F-NV-02 | 載入完成顯示列表 | GET 回傳 2 筆 channel | await 回應 | 顯示 channel 卡片；每卡含類型圖示、名稱、觸發事件摘要、服務範圍摘要、toggle 開關 |
| F-NV-03 | 空狀態顯示 | GET 回傳空陣列 | await 回應 | 顯示「尚未設定任何通知 Channel」+「新增 Channel」按鈕（BDD @entry 空狀態） |
| F-NV-04 | 兩分頁結構 | 載入完成 | 檢查分頁 | 「Channel 設定」分頁（預設顯示）+「發送紀錄」分頁（TabsBar） |
| F-NV-05 | 載入失敗顯示錯誤 | GET 回 500/網路錯誤 | await 失敗 | 顯示錯誤訊息 + 重試機制（智能補充：依賴失敗測試） |
| F-NV-06 | 自動停用 Toast（補償通道） | GET 回傳 channel enabled=false 且 auto_disabled_reason 非空 | 載入完成 | 顯示 Toast「Channel「XXX」因連續失敗已自動停用」；sessionStorage 去重避免重複（決策 5 補償） |
| F-NV-07 | WS 即時停用 Toast | WS 收到 `notify_channel_disabled` message | handlers 分發 | 全域 Toast「Channel「XXX」因連續失敗已自動停用」（決策 5 即時通道） |

### 3.2 ChannelForm.vue — 4 類型動態欄位 / 驗證

> 對應 BDD：`@channel` 新增/編輯 + 驗證 Scenario（Outline ×4）

| # | 測試名稱 | Given | When | Then |
|---|---------|-------|------|------|
| F-CF-01 | Slack 動態欄位 | 類型選 Slack | 檢查表單 | 顯示 Webhook URL 輸入框 + 格式提示 `https://hooks.slack.com/services/...`；無 token/method/headers 欄位 |
| F-CF-02 | Discord 動態欄位 | 類型選 Discord | 檢查表單 | Webhook URL 輸入框 + 提示 `https://discord.com/api/webhooks/...` |
| F-CF-03 | Telegram 動態欄位 | 類型選 Telegram | 檢查表單 | Bot Token 輸入框（`123456789:AA...`，@BotFather 建立 bot 取得）+ Chat ID 輸入框（整數或 `@channelusername`，私人聊天可向 @userinfobot 查詢）；無 URL 欄位 |
| F-CF-04 | 自訂 Webhook 動態欄位 | 類型選自訂 Webhook | 檢查表單 | URL 輸入框 + HTTP Method 下拉（預設 POST，選項 POST/PUT）+ 自訂 Headers key-value 編輯器 |
| F-CF-05 | 類型切換即時切換欄位 | 已選 Slack 後切到 Telegram | 切換類型 | 表單欄位動態切換；無關欄位隱藏 |
| F-CF-06 | 必填欄位驗證標紅並攔截 | 未填必要欄位 | click 儲存 | 前端攔截，**無 API 呼叫**；必填欄位紅色標示；顯示「請填寫必要欄位」（BDD @validation） |
| F-CF-07 | 至少勾選一個觸發事件 | 名稱與專屬欄位已填、4 事件皆未勾 | click 儲存 | 前端攔截並提示需至少勾選一個觸發事件；channel 未建立（BDD @business-rules） |
| F-CF-08 | 指定服務範圍搜尋多選（分組 + 框選） | 選「指定服務」radio | 輸入關鍵字過濾並勾選 | 搜尋框過濾服務列表；「我的服務」預設展開、「系統服務」收合（輸入關鍵字自動展開）；勾選整列反白；下方顯示「已選 N 個服務」計數；可多選（BDD @happy-path） |
| F-CF-09 | 全部服務 radio 預設 | 開啟表單 | 檢查範圍區塊 | 「全部服務」radio 預設選中 |
| F-CF-10 | headers 11 組拒絕 | 自訂型已設 11 組 headers | click 儲存 | 前端驗證失敗提示 headers 最多 10 組；無 API 呼叫（BDD @edge-case） |
| F-CF-11 | 儲存成功關閉表單 + Toast | POST 200 | click 儲存 | Toast「Channel「XXX」已建立」；表單關閉；列表重整顯示新 channel；新 toggle 預設開啟 |
| F-CF-12 | 儲存失敗保留表單內容 | POST 回 500 | click 儲存 | Toast 錯誤訊息；**表單內容保留**供修正；可重新送出（BDD @channel-save） |
| F-CF-13 | 編輯模式預填 | 點擊 channel「編輯」 | 檢查表單 | 表單展開且欄位預填目前設定值（名稱/URL/事件/範圍） |
| F-CF-14 | 儲存按鈕 loading | 驗證通過、請求已送出 | 檢查按鈕 | 儲存按鈕變 loading spinner + disabled（防重複送出） |

### 3.3 ChannelCard.vue — toggle 樂觀更新 / 測試按鈕 loading / 刪除確認

> 對應 BDD：`@channel` toggle 2 Scenario + 刪除 4 Scenario + `@test` 4 Scenario

| # | 測試名稱 | Given | When | Then |
|---|---------|-------|------|------|
| F-TG-01 | toggle 樂觀切換 | channel 目前 enabled=true | 點擊 toggle | toggle 立即切換為停用（樂觀更新，不等 API）；發送 PATCH `/notify/channels/:id` body `{enabled:false}`（BDD @happy-path） |
| F-TG-02 | PATCH 成功保持新狀態 | PATCH 回 200 | 完成 | toggle 保持停用；卡片灰/半透明顯示停用狀態 |
| F-TG-03 | PATCH 失敗回復原狀態 | PATCH 回 500 | 完成 | toggle 回復為原狀態；Toast「無法更新 Channel 狀態：{原因}」（BDD @error-handling） |
| F-TG-04 | 停用卡片灰顯 | channel enabled=false | 檢查卡片 | 卡片套用灰/半透明樣式 |
| F-DL-01 | 刪除前彈出確認框 | 點擊「刪除」按鈕 | 檢查 Modal | ConfirmModal 顯示「確定刪除 Channel「團隊 Slack」？此操作無法復原。」+ 確認與取消按鈕（BDD @happy-path） |
| F-DL-02 | 確認刪除流程 | 點「確認刪除」 | DELETE 200 | 顯示 Toast「Channel 已刪除」；該 channel 從列表移除（淡出動畫）；列表 N → N-1（BDD @happy-path） |
| F-DL-03 | 取消刪除無變更 | 點「取消」 | 檢查 | Modal 關閉；channel 列表維持不變（BDD @happy-path） |
| F-DL-04 | 刪除被 API 拒絕卡片保留 | DELETE 回 500 | 完成 | Toast「無法刪除 Channel：{原因}」；該 channel 卡片仍保留在列表中（BDD @error-handling） |
| F-TS-01 | 測試按鈕 loading 狀態 | 點擊「測試」 | 檢查按鈕 | 按鈕變 loading spinner + disabled；Toast「正在發送測試通知...」；發送 POST `/notify/channels/:id/test`（BDD @test @smoke） |
| F-TS-02 | 測試成功提示 | POST test 回 200 | 完成 | Toast「測試通知已發送 ✅，請檢查目標平台」；按鈕恢復可點擊 |
| F-TS-03 | 測試失敗顯示原因 | POST test 回 502 + error | 完成 | Toast「測試失敗 ❌：{原因}」（如連線逾時/403）；按鈕恢復可點擊（BDD @error-handling） |
| F-TS-04 | 平台回覆異常警告 | POST test 回 200 但 detail 顯示平台拒絕 | 完成 | Toast「⚠️ 請求已送出但目標平台回覆異常，請檢查 URL/Token」；按鈕恢復可點擊（BDD @error-handling） |

### 3.4 ChannelHistoryTable.vue — 發送紀錄表格

> 對應 BDD：`@history` 6 Scenario（含結果篩選 Outline ×3）

| # | 測試名稱 | Given | When | Then |
|---|---------|-------|------|------|
| F-HT-01 | 表格欄位完整 | GET history 回傳紀錄 | 檢查表格 | 欄位含時間、Channel 名稱、觸發事件、目標服務、發送結果、錯誤訊息 |
| F-HT-02 | 依時間倒序 | 多筆不同時間紀錄 | 檢查排序 | 表格依時間倒序排列（最新在上） |
| F-HT-03 | 空狀態 | history 為空 | 切換至發送紀錄分頁 | 顯示「尚無通知發送紀錄」（BDD @history @happy-path） |
| F-HT-04 | channel 下拉篩選 | 多 channel 紀錄 | 選取「團隊 Slack」 | 以 channel_id 重新查詢；表格僅顯示該 channel 紀錄（BDD @history） |
| F-HT-05 | 結果篩選（全部/成功/失敗） | 成功+失敗紀錄 | 依序切換 3 種結果（Outline ×3） | 「全部」不帶 status 參數；「成功」帶 status=success；「失敗」帶 status=failure；表格僅顯示對應結果 |
| F-HT-06 | 分頁載入更多 | 超過 30 筆 | 捲動至底部/點下一頁 | 發送 GET `?page=2&limit=30`；表格追加顯示；頁面顯示目前頁碼與總頁數（BDD @history） |
| F-HT-07 | 成功/失敗顏色標示 | 含成功與失敗紀錄 | 查看表格 | 成功綠標（🟢）、失敗紅標（🔴）並顯示錯誤訊息（BDD @history @p2） |
| F-HT-08 | 發送紀錄分頁與設定分頁切換 | 位於 Channel 設定分頁 | 點「發送紀錄」分頁 | 切換至紀錄檢視並觸發 GET history；切回可返回 Channel 設定 |

### 3.5 useNotifyChannels.ts / api client 擴充

> 對應 BDD：7 個 API 請求契約 + WS 停用事件

| # | 測試名稱 | Given | When | Then |
|---|---------|-------|------|------|
| F-AP-01 | listChannels | — | call listChannels | axios GET `/notify/channels` |
| F-AP-02 | createChannel | channel 表單資料 | call createChannel | axios POST `/notify/channels`，body 含 type/name/url/bot_token/chat_id/events/services |
| F-AP-03 | updateChannel | id + 設定 | call updateChannel | axios PUT `/notify/channels/{id}` |
| F-AP-04 | deleteChannel | id | call deleteChannel | axios DELETE `/notify/channels/{id}` |
| F-AP-05 | patchChannelEnabled | id + enabled | call patchChannelEnabled | axios PATCH `/notify/channels/{id}`，body `{enabled}` |
| F-AP-06 | testChannel | id | call testChannel | axios POST `/notify/channels/{id}/test`；502 時可解析 error/detail 供 Toast |
| F-AP-07 | getNotifyHistory | page/limit/channelId/status | call getNotifyHistory | axios GET `/notify/history` 帶 query params；回傳型別含 total/page/limit |
| F-AP-08 | WS handler 註冊/移除 | useWebSocket handlers | mount / unmount | `notify_channel_disabled` handler 註冊（即時 Toast）；unmount 時移除（生命週期，智能補充） |

---

## 4. 整合測試

> 對應 BDD：`@business-rules @data` + `@integration` — 跨模組真實檔案系統 / 全鏈路驗證
> 方式：`go test`（temp dir 佈建 notify.json + notify-history.jsonl + mock 目標平台 server）+ curl 腳本

| # | 測試名稱 | 整合範圍 | 操作步驟 | 預期結果 |
|---|---------|---------|---------|---------|
| INT-01 | 建立 channel → notify.json 實際寫入 | Handler + Store | 1. POST 建立 Slack channel<br>2. 讀 notify.json | 200；notify.json 含該 channel（合法 JSON、原子寫入痕跡無 .tmp） |
| INT-02 | 狀態變更全鏈路觸發 | Hub + Notifier + Sender + History | 1. 建立啟用 channel（events=[failed]、全部服務）<br>2. mock 目標平台<br>3. 呼叫 `hub.BroadcastStatusChange("nginx.service","failed","")` | mock server 收到 payload 正確的請求；notify-history.jsonl 新增 status=success 紀錄（event=failed、service=nginx.service） |
| INT-03 | 刪除 channel → 紀錄保留 | Handler + Store + History | 1. 觸發數筆發送<br>2. DELETE channel<br>3. GET history | channel 已刪除；GET history 仍回傳其紀錄（channel_name 快照） |
| INT-04 | 30 天 TTL 清理實檔 | History + cleanup | 1. 寫入含 31 天前 timestamp 的紀錄<br>2. 執行 cleanup()<br>3. 讀檔案 | 31 天前紀錄被移除；30 天內保留；檔案為完整 JSONL |
| INT-05 | 自動停用持久化 + WS 推送 | Store + Sender + Hub + 前端 | 1. mock server 持續失敗<br>2. 連續觸發 10 次狀態變更<br>3. 檢查 notify.json + WS 訊息 | 第 10 次失敗後 channel enabled=false + auto_disabled_reason 寫入檔案；hub 廣播 `notify_channel_disabled`；重啟（重新 Load）後維持停用 |
| INT-06 | 測試通知不污染紀錄 | Handler + Sender + History | 1. POST test 成功<br>2. 讀 notify-history.jsonl | 無 test 相關紀錄寫入（決策 D-6）；failures counter 不受影響 |
| INT-07 | 並行發送多 channel 全鏈路 | Sender + History + 多 channel | 1. 兩個啟用 channel 皆匹配<br>2. mock A 500 / B 200<br>3. 觸發一次狀態變更 | A、B 皆收到請求；history 各一筆（failure / success）；B 不受 A 影響 |

---

## 5. 端對端測試（Playwright）

> 對應 BDD：`@smoke` `@happy-path` `@p0` `@error-handling` `@edge-case` `@business-rules` `@security` `@integration` + 全部 Scenario Outline
> 測試檔建議：`frontend/e2e/013-webhook-notification.spec.ts`（Playwright + 後端 mock 或真實測試服務 + 本地 webhook 接收 server）

### 5.1 頁面進入與列表（`@entry`）

| # | 測試名稱 | 操作步驟 | 預期結果 |
|---|---------|---------|---------|
| E2E-01 | 進入通知設定頁面主流程 | 1. 登入管理員<br>2. 於 Dashboard 點擊 Header「🔔 Notifications」<br>3. 等待載入 | URL 為 `/notifications`；先顯示 loading spinner；GET `/api/v1/notify/channels` 被呼叫；載入完成預設顯示「Channel 設定」分頁 |
| E2E-02 | 已有 Channel 顯示列表 | 1. 預置 2 筆 channel<br>2. 進入通知頁面 | 顯示 channel 卡片列表；每卡含類型圖示、名稱、觸發事件摘要、服務範圍摘要、toggle 開關 |
| E2E-03 | 無 Channel 顯示空狀態 | 1. 無任何 channel<br>2. 進入通知頁面 | 空狀態「尚未設定任何通知 Channel」+「新增 Channel」按鈕 |

### 5.2 新增 / 編輯 Channel（`@channel`，Scenario Outline ×4）

| # | 測試名稱 | 操作步驟 | 預期結果 |
|---|---------|---------|---------|
| E2E-04 | 新增 Slack Channel | 1. 點「新增 Channel」<br>2. 類型選 Slack<br>3. 填 URL `https://hooks.slack.com/services/...` + 名稱 + 勾選 failed + 範圍全部服務<br>4. 儲存 | 表單顯示 Slack 專屬欄位；POST 發送；Toast「Channel「團隊 Slack」已建立」；表單關閉；列表顯示新 channel；toggle 預設開啟（Outline row 1） |
| E2E-05 | 新增 Discord Channel | 同上，類型 Discord、URL `https://discord.com/api/webhooks/...` | Discord 專屬欄位；建立成功（Outline row 2） |
| E2E-06 | 新增 Telegram Channel | 同上，類型 Telegram、填 Bot Token（`123456789:AA...`）+ Chat ID | Bot Token 與 Chat ID 輸入框顯示；建立成功（Outline row 3） |
| E2E-07 | 新增自訂 Webhook Channel | 同上，類型自訂 Webhook、填 URL + Method POST + 自訂 Headers 1 組 | 顯示 URL/Method/Headers 編輯器；建立成功（Outline row 4） |
| E2E-08 | 必填欄位空白攔截 | 1. 開啟新增表單<br>2. 不填任何欄位直接儲存 | 前端攔截、**無 API 呼叫**；必填欄位紅色標示；顯示「請填寫必要欄位」 |
| E2E-09 | 未勾選觸發事件攔截 | 1. 填名稱與專屬欄位<br>2. 不勾任何事件<br>3. 儲存 | 前端攔截並提示需至少勾選一個觸發事件；無 POST 請求 |
| E2E-10 | 指定服務搜尋多選（分組 + 框選） | 1. 選「指定服務」<br>2. 搜尋框輸入關鍵字<br>3. 勾選 nginx、postgresql<br>4. 儲存 | 勾選的服務整列反白；下方顯示「已選 N 個服務」計數；儲存後僅這些服務變更觸發通知 |
| E2E-11 | 儲存失敗保留表單 | 1. 攔截 POST 回 500<br>2. 填妥表單儲存 | Toast 錯誤訊息；**表單內容保留**；修正後可重新送出 |
| E2E-12 | 編輯 Channel 預填更新 | 1. 點 channel「編輯」<br>2. 檢查預填值<br>3. 修改後儲存 | 表單預填目前設定；PUT 發送；Toast「Channel 已更新」；卡片顯示更新後內容 |
| E2E-13 | 編輯失敗 | 1. 攔截 PUT 回 500<br>2. 修改並儲存 | Toast 錯誤原因；channel 卡片維持原設定不變 |

### 5.3 開關 / 刪除 / 測試（`@channel` `@test`）

| # | 測試名稱 | 操作步驟 | 預期結果 |
|---|---------|---------|---------|
| E2E-14 | Toggle 樂觀更新 | 1. 點擊啟用中 channel 的 toggle | toggle 立即切換停用（樂觀）；PATCH `{enabled:false}`；成功後保持停用；卡片灰/半透明 |
| E2E-15 | Toggle 失敗回復 | 1. 攔截 PATCH 回 500<br>2. 點擊 toggle | toggle 回復原狀態；Toast「無法更新 Channel 狀態：{原因}」 |
| E2E-16 | 刪除確認對話框 | 1. 點 channel「刪除」 | ConfirmModal「確定刪除 Channel「團隊 Slack」？此操作無法復原。」+ 確認/取消按鈕 |
| E2E-17 | 確認刪除移除 | 1. 刪除確認框<br>2. 點「確認刪除」 | DELETE 發送；Toast「Channel 已刪除」；卡片淡出移除；列表 N → N-1 |
| E2E-18 | 取消刪除 | 1. 刪除確認框<br>2. 點「取消」 | 對話框關閉；列表維持不變 |
| E2E-19 | 刪除被 API 拒絕 | 1. 攔截 DELETE 回 500<br>2. 確認刪除 | Toast「無法刪除 Channel：{原因}」；卡片仍保留在列表中 |
| E2E-20 | 測試按鈕 loading | 1. 點啟用 channel 的「測試」 | 按鈕變 loading spinner；Toast「正在發送測試通知...」；POST `/notify/channels/:id/test` |
| E2E-21 | 測試成功 | 1. 攔截 POST test 回 200 | Toast「測試通知已發送 ✅，請檢查目標平台」；按鈕恢復可點擊 |
| E2E-22 | 測試失敗 | 1. 攔截 POST test 回 502 + error（403/逾時） | Toast「測試失敗 ❌：{原因}」；按鈕恢復可點擊 |
| E2E-23 | 平台回覆異常警告 | 1. 攔截 POST test 回 200 但 detail 顯示平台異常 | Toast「⚠️ 請求已送出但目標平台回覆異常，請檢查 URL/Token」；按鈕恢復 |

### 5.4 背景觸發通知（`@trigger`，Scenario Outline ×4 + ×3）

| # | 測試名稱 | 操作步驟 | 預期結果 |
|---|---------|---------|---------|
| E2E-24 | 服務 crash (failed) 觸發通知 | 1. 建立啟用 channel（events=[failed]、全部服務、URL 指向本地接收 server）<br>2. 讓 nginx.service 實際 crash 進入 failed（或 mock hub 事件） | 接收 server 收到 payload（title 含 nginx.service failed）；通知發送紀錄新增 status=success、事件=failed、目標服務=nginx.service（BDD @smoke 主流程） |
| E2E-25 | started 觸發通知 | 1. 同上前置、events=[started]<br>2. 啟動 nginx.service | 接收 server 收到事件 started 的通知；紀錄新增（Outline row 1） |
| E2E-26 | stopped 觸發通知 | 1. 同上前置、events=[stopped]<br>2. 停止 nginx.service | 收到事件 stopped 通知；紀錄新增（Outline row 2） |
| E2E-27 | restarted 觸發通知 | 1. 同上前置、events=[restarted]<br>2. `systemctl restart nginx.service` | 收到**一筆**事件 restarted 通知（非 stopped+started 兩筆）；紀錄新增（Outline row 3） |
| E2E-28 | failed 觸發通知 | 1. 同上前置、events=[failed]<br>2. nginx crash | 收到 failed 通知；紀錄新增（Outline row 4） |
| E2E-29 | 停用 channel 不通知 | 1. channel toggle OFF<br>2. 觸發狀態變更 | 接收 server 無請求；發送紀錄無新增 |
| E2E-30 | 事件與範圍同時匹配（3 組合） | 1. channel events=[failed]、範圍=postgresql.service<br>2. 依序：nginx failed → postgresql stopped → postgresql failed | 前兩者不發送；第三者發送（Outline ×3） |
| E2E-31 | 多 channel 並行互不影響 | 1. 兩個啟用 channel 皆匹配（接收 server A 回 500、B 回 200）<br>2. 觸發一次變更 | 兩 channel 皆收到請求；紀錄各一筆（A failure、B success）互不影響 |
| E2E-32 | D-Bus fallback 模式 | 1. 停用/中斷 D-Bus 監聽（進入 polling fallback）<br>2. 觸發服務狀態變更 | 通知模組從內部事件（polling 路徑）獲取變更；匹配 channel 仍正常收到通知 |
| E2E-33 | 背景失敗寫入 failure | 1. 接收 server 回 HTTP 500<br>2. 觸發狀態變更 | 發送紀錄寫入 status=failure + error detail；管理員可在發送紀錄查看失敗原因 |

### 5.5 發送紀錄（`@history`，結果篩選 Outline ×3）

| # | 測試名稱 | 操作步驟 | 預期結果 |
|---|---------|---------|---------|
| E2E-34 | 紀錄表格倒序與欄位 | 1. 預置多筆成功/失敗紀錄<br>2. 切換「發送紀錄」分頁 | GET `?page=1&limit=30`；表格欄位含時間、Channel 名稱、觸發事件、目標服務、發送結果、錯誤訊息；依時間倒序 |
| E2E-35 | 無紀錄空狀態 | 1. 無任何發送紀錄<br>2. 切換分頁 | 顯示「尚無通知發送紀錄」 |
| E2E-36 | Channel 下拉篩選 | 1. 多 channel 紀錄<br>2. 下拉選「團隊 Slack」 | 以 channel_id 重新查詢；僅顯示該 channel 紀錄 |
| E2E-37 | 結果篩選（3 例） | 1. 成功+失敗紀錄<br>2. 依序切換 全部/成功/失敗 | 全部不帶 status；成功僅 success；失敗僅 failure（Outline ×3） |
| E2E-38 | 分頁載入更多 | 1. 預置 45 筆紀錄<br>2. 捲動至底部/下一頁 | GET `?page=2&limit=30`；表格追加；顯示目前頁碼與總頁數 |
| E2E-39 | 成功/失敗顏色 | 1. 含成功與失敗紀錄<br>2. 查看表格 | 成功綠標（🟢）、失敗紅標（🔴）+ 錯誤訊息 |

### 5.6 異常與邊界（`@error-handling` `@edge-case`）

| # | 測試名稱 | 操作步驟 | 預期結果 |
|---|---------|---------|---------|
| E2E-40 | 無效 URL 測試顯示具體錯誤 | 1. 建立 Slack channel 用無效 URL（如 hooks.slack.com 不存在）<br>2. 點「測試」 | 測試失敗並顯示具體 HTTP 錯誤（404/403/連線逾時）；修正 URL 後可重新測試 |
| E2E-41 | 連續失敗自動停用 + Toast | 1. 接收 server 持續回 500<br>2. 觸發 10 次失敗發送<br>3. 開啟通知頁面 | 第 10 次失敗後 channel 自動停用（enabled=false + reason）；頁面顯示 Toast「Channel「XXX」因連續失敗已自動停用」；修正後可手動重新啟用 |
| E2E-42 | 逾時 10 秒 + 重試 1 次 | 1. 接收 server 延遲 11s 回應<br>2. 觸發一次發送<br>3. 觀察接收 server 請求數 | 10 秒判定逾時；自動重試 1 次（共 2 次請求）；重試仍失敗 → 紀錄 failure；無第 3 次請求 |
| E2E-43 | Channel 20 個上限 | 1. API 層預置 20 個 channels<br>2. 嘗試建立第 21 個 | 系統拒絕建立並回錯誤；頁面 Toast 說明已達上限 |
| E2E-44 | reloaded 不觸發 | 1. 啟用 channel（含 4 事件）<br>2. `systemctl reload nginx.service` | 不發送任何通知；發送紀錄無新增 |
| E2E-45 | 自訂 Webhook 以 POST 發送 | 1. 建立自訂 channel method=POST + 接收 server<br>2. 觸發狀態變更 | 接收 server 收到 **POST** 請求；body 為 JSON（含服務名稱、狀態、時間）<br>＋自訂 headers（Outline row 1） |
| E2E-46 | 自訂 Webhook 以 PUT 發送 | 同上 method=PUT | 收到 **PUT** 請求；body JSON 相同（Outline row 2） |
| E2E-47 | headers 超過 10 組拒絕 | 1. 自訂型設定 11 組 headers<br>2. 儲存 | 前端驗證失敗提示最多 10 組；channel 未建立 |
| E2E-48 | 精確匹配（3 例） | 1. channel 範圍僅 nginx.service<br>2. 依序讓 nginx / nginx-ssl.service / web.service 變更為 failed | 三者皆不發送（不支援 regex/glob）（Outline ×3） |
| E2E-49 | 4 種 payload 格式（本地接收驗證） | 1. 依序建立 Slack/Discord/Telegram/自訂 channel 指向本地接收 server<br>2. 觸發 nginx.service failed | Slack 含 attachments+color=danger；Discord 含 embeds+color=16711680；Telegram 含 JSON body {chat_id, text}（token 內嵌於 URL 路徑 `.../bot{TOKEN}/sendMessage`、無 Authorization header）；自訂含 JSON event/service/status/timestamp（Outline ×4） |
| E2E-50 | 未登入 401（API 層） | 無驗證資訊 | 依序發送 7 個請求：GET/POST channels、PUT/PATCH/DELETE channels/1、POST channels/1/test、GET history | 全部回 401 Unauthorized（Outline ×7） |

---

## 6. 手動驗證（真實環境）

> 對應 BDD：`@edge-case` `@integration` `@telegram` — 真實外部平台 / 真實 systemd 環境才可驗證的場景

| # | 情境 | 驗證步驟 | 預期 |
|---|------|---------|------|
| MAN-01 | 實際 Slack 平台接收 | 1. 建立真實 Slack Incoming Webhook channel<br>2. 停止/啟動 nginx.service<br>3. 檢查 Slack 頻道 | 每次狀態變更收到對應通知（含 color good/warning/danger 與服務摘要）；訊息內容正確 |
| MAN-02 | 實際 Discord 平台接收 | 1. 建立真實 Discord Webhook channel<br>2. 觸發狀態變更 | Discord 頻道收到 embed 通知（含 embed color 與服務摘要） |
| MAN-03 | 實際 Telegram 接收 | 1. 以 @BotFather 建立真實 bot、取得 bot token 與 chat_id（私人聊天可向 @userinfobot 查詢）建立 channel<br>2. 觸發狀態變更 | Telegram 收到 JSON {chat_id, text} 通知；內容含服務名稱與狀態 |
| MAN-04 | D-Bus 中斷 fallback（真實） | 1. 正常運作下觸發通知<br>2. 停止 systemd-dbus 或斷開 D-Bus 監聽（進入 polling fallback）<br>3. 再次觸發狀態變更 | D-Bus 中斷後通知仍於 ≤5s（polling 週期）內送達；無需重啟服務 |
| MAN-05 | Telegram 429 + retry_after | 1. 觸發 Telegram Bot API 429 回應（可用 rate limit 測試 bot 或 mock）<br>2. 持續發送並觀察回應 | 後端將 429 回應（含 `retry_after`）記錄於通知紀錄 detail；**不強制阻擋** channel 繼續發送 |
| MAN-06 | 真實服務 crash (failed) | 1. 讓一個服務因設定錯誤 crash（如 ExecStart 指向不存在檔案）<br>2. 確認 failed 事件觸發 | 匹配 channel 即時收到 failed 通知；發送紀錄顯示 success/failure 正確 |
| MAN-07 | 測試按鈕平台顯示測試訊息 | 1. 真實 Slack channel 設定正確<br>2. 點「測試」並收到成功 Toast | Slack 顯示「🧪 這是一筆來自 Linux Service Manager 的測試通知」 |
| MAN-08 | 未匹配 channel 不收到（真實） | 1. 「DB 通知」範圍 postgresql.service、「nginx 通知」範圍 nginx.service<br>2. nginx.service 變更為 failed | 「nginx 通知」收到、「DB 通知」不收到 |
| MAN-09 | 重啟後停用狀態保持 | 1. 讓 channel 連續失敗 10 次自動停用<br>2. 重啟 LMS daemon<br>3. 檢查 channel 狀態 | 重啟後 channel 仍為停用（enabled=false + reason 保留）；不會重新開始失敗通知風暴 |
| MAN-10 | notify.json 權限與 token 遮蔽 | 1. 建立 Telegram channel<br>2. `ls -la /var/lib/linux-service-manager/notify.json`<br>3. 檢視 API 回應 | 檔案權限 0600；API 回應 token 為 masked（`****xxxx`）；檔案內容含完整 token（僅本機可讀） |
| MAN-11 | 30 天紀錄實檔清理 | 1. 手動寫入 31 天前 timestamp 之紀錄<br>2. 等待每日 ticker 或重啟<br>3. 檢查 notify-history.jsonl | 超過 30 天紀錄被自動刪除；30 天內完整保留 |
| MAN-12 | 多瀏覽器並發操作 | 1. 瀏覽器 A、B 同時開啟通知頁面<br>2. A 建立/刪除 channel、B 同時建立 | 兩者皆成功或一方收到明確錯誤（20 上限）；無資料損毀（atomic write）；UI 經重新載入一致 |
| MAN-13 | 網路中斷時通知行為 | 1. 目標平台不可達（防火牆阻擋）<br>2. 觸發狀態變更 | 每次發送失敗寫入 failure + 原因；連續 10 次後自動停用；無 panic / daemon 不崩潰 |

---

## 7. 測試環境

| 項目 | 需求 |
|------|------|
| Go 版本 | 1.24.4（module `linux-service-manager`，`src/go.mod`） |
| 後端依賴 | chi/v5 v5.3.1、godbus/dbus/v5、gorilla/sessions、gorilla/websocket（通知發送零新依賴，標準庫 net/http） |
| Node.js 版本 | 22+（對應專案 `.nvmrc`） |
| 前端框架 | Vue 3.5.40 + Pinia 4.0.2 + Vue Router 4.6.4 + axios |
| 前端測試 | Vitest 4.1.10 + @vue/test-utils 2.4.11 + happy-dom 20.11.1 |
| E2E 測試 | Playwright 1.62.1（Chromium 內建） |
| 後端測試 | `go test` + `net/http/httptest` / `httptest.NewServer`（mock 目標平台，`cd src && go test ./...`） |
| 測試瀏覽器 | Chromium（Playwright）、Chrome、Firefox、Edge（手動） |
| 測試 OS | Linux（Ubuntu 22.04+ / Debian 12+），具 systemd 1.x 與 D-Bus（手動驗證必備） |
| 外部平台（手動） | 真實 Slack workspace、Discord server、Telegram bot（@BotFather 建立）+ chat_id（MAN-01~03、MAN-05、MAN-07） |
| 資料檔（測試） | `/var/lib/linux-service-manager/notify.json`、`notify-history.jsonl`（測試環境可置於 temp dir） |
| 本地接收 server | E2E/單元測試用 mock webhook 接收器（驗證 payload 格式、method、headers、retry 次數） |
| CI 整合 | `make test` / `cd src && go test ./... && cd frontend && npm test && npx playwright test` |

---

## 8. 缺陷追蹤模板

| 欄位 | 說明 |
|------|------|
| ID | BUG-NTF-XXX |
| 測試案例 | 對應以上測試編號（如 SYS-48 / HDL-21 / F-TG-03 / E2E-41） |
| 來源 BDD Scenario | 對應 BDD Scenario 名稱 |
| 嚴重程度 | P0(阻擋) / P1(主要) / P2(次要) |
| 重啟步驟 | 逐步操作 |
| 預期 vs 實際 | 對照 |
| 環境 | Go 版本 / Node 版本 / OS / systemd 版本 / 瀏覽器 / 目標平台 |

---

## 9. BDD Scenario 覆蓋矩陣

以下矩陣確保每個 BDD Scenario 至少對應一個測試案例（含 Scenario Outline 全部 Examples 展開）。

| # | BDD Scenario | 單元測試 | 整合測試 | E2E 測試 | 手動驗證 |
|---|-------------|:---:|:---:|:---:|:---:|
| 1 | 點擊 Header 的 Notifications 連結進入通知設定頁面（@entry @p0 @smoke） | F-NV-01 | — | E2E-01 | — |
| 2 | 已有 Channel 時顯示 Channel 列表（@entry @p0 @smoke） | F-NV-02 | — | E2E-02 | — |
| 3 | 無 Channel 時顯示空狀態與新增按鈕（@entry @p1） | F-NV-03 | — | E2E-03 | — |
| 4 | 通知頁面提供「Channel 設定」與「發送紀錄」兩個分頁（@entry @p1） | F-NV-04 | — | E2E-01 | — |
| 5 | 新增 Channel 類型並成功建立（Outline ×4：Slack/Discord/Telegram/自訂） | F-CF-01~05, F-CF-11 | INT-01 | E2E-04~07 | — |
| 6 | 必填欄位空白時儲存被攔截並標示錯誤（@validation） | F-CF-06 | — | E2E-08 | — |
| 7 | 至少需勾選一個觸發事件才能儲存（@business-rules） | F-CF-07 | — | E2E-09 | — |
| 8 | 指定服務範圍時可透過搜尋多選服務（分組 + 框選）（@happy-path） | F-CF-08~09 | — | E2E-10 | — |
| 9 | Channel 儲存失敗時顯示錯誤並保留表單內容（@channel-save） | F-CF-12, F-CF-14 | — | E2E-11 | — |
| 10 | 點擊編輯展開預填表單並成功更新（@happy-path） | F-CF-13 | — | E2E-12 | — |
| 11 | 編輯儲存失敗時顯示錯誤訊息（@error-handling） | F-CF-12（編輯路徑） | — | E2E-13 | — |
| 12 | 切換 Toggle 樂觀更新 Channel 啟用狀態（@p0） | F-TG-01~02 | — | E2E-14 | — |
| 13 | Toggle 更新失敗時回復原狀態（@error-handling） | F-TG-03 | — | E2E-15 | — |
| 14 | 刪除 Channel 前彈出確認對話框（@p0） | F-DL-01 | — | E2E-16 | — |
| 15 | 確認刪除後 Channel 從列表移除（@p0） | F-DL-02 | INT-03 | E2E-17 | — |
| 16 | 取消刪除不產生任何變更（@p1） | F-DL-03 | — | E2E-18 | — |
| 17 | 刪除操作被 API 拒絕時卡片保留（@channel-delete） | F-DL-04 | — | E2E-19 | — |
| 18 | 點擊測試按鈕顯示發送中狀態（@test @p0 @smoke） | F-TS-01 | — | E2E-20 | — |
| 19 | 測試通知發送成功顯示成功提示（@test @p0） | F-TS-02 | INT-06 | E2E-21 | MAN-07 |
| 20 | 測試通知失敗顯示具體錯誤原因（@test @p0） | F-TS-03 | — | E2E-22, E2E-40 | — |
| 21 | 請求已送出但目標平台回覆異常時顯示警告（@test @p1） | F-TS-04 | — | E2E-23 | — |
| 22 | 服務狀態變更時匹配的 Channel 自動收到通知並寫入紀錄（@trigger @p0 @smoke） | SYS-21, SYS-39~40 | INT-02 | E2E-24 | MAN-06 |
| 23 | 服務狀態變更為「<event>」時觸發（Outline ×4：started/stopped/failed/restarted） | SYS-11~17 | INT-02 | E2E-25~28 | MAN-01~03 |
| 24 | 已停用的 Channel 不會收到任何通知（@business-rules @p0） | SYS-22 | — | E2E-29 | — |
| 25 | 觸發事件與服務範圍需同時匹配才發送（Outline ×3） | SYS-23~27 | — | E2E-30 | MAN-08 |
| 26 | 多個 Channel 同時匹配時並行發送互不影響（@parallel） | SYS-35~36 | INT-07 | E2E-31 | — |
| 27 | D-Bus 監聽中斷時以 systemctl fallback 模式繼續觸發（@dbus-fallback） | SYS-20（掛載點） | INT-02（hub 漏斗） | E2E-32 | MAN-04 |
| 28 | 背景發送失敗時通知紀錄顯示 failure 與錯誤原因（@background-failure） | SYS-39 | — | E2E-33 | MAN-13 |
| 29 | 發送紀錄表格顯示完整欄位且依時間倒序（@history @p0） | F-HT-01~02 | — | E2E-34 | — |
| 30 | 無發送紀錄時顯示空狀態（@history @p1） | F-HT-03 | — | E2E-35 | — |
| 31 | 依 Channel 下拉篩選發送紀錄（@history @p1） | F-HT-04 | — | E2E-36 | — |
| 32 | 依發送結果切換篩選（Outline ×3：全部/成功/失敗） | F-HT-05, SYS-59 | — | E2E-37 | — |
| 33 | 發送紀錄分頁載入更多（@history @p1） | F-HT-06 | — | E2E-38 | — |
| 34 | 成功與失敗紀錄以不同顏色標示（@history @p2） | F-HT-07 | — | E2E-39 | — |
| 35 | Webhook URL 無效時儲存成功但測試顯示具體 HTTP 錯誤（@invalid-url） | HDL-21~22 | — | E2E-40 | — |
| 36 | 連續失敗 10 次後 Channel 自動停用並提示管理員（@auto-disable @p0） | SYS-48~50 | INT-05 | E2E-41 | MAN-09 |
| 37 | 通知發送逾時 10 秒視為失敗且最多重試 1 次（@timeout @p0） | SYS-32~34 | — | E2E-42 | — |
| 38 | 發送紀錄過多時以分頁與 30 天清理機制管理（@error-handling @p1） | SYS-57, SYS-60 | INT-04 | E2E-38 | MAN-11 |
| 39 | Channel 數量達到 20 個上限時拒絕新增（@channel-limit @p0） | SYS-51~52, HDL-11 | — | E2E-43 | — |
| 40 | 通知 payload 僅含服務摘要不包含完整 log（@payload @p1） | SYS-09~10 | — | E2E-49 | — |
| 41 | 服務執行 reloaded 時不觸發任何通知（@trigger-events @p1） | SYS-19 | — | E2E-44 | — |
| 42 | 通知發送紀錄保留最近 30 天，超過自動清理（@retention @p1） | SYS-60~61 | INT-04 | — | MAN-11 |
| 43 | Telegram Bot API 回傳 429（含 retry_after）時後端記錄但不強制阻擋（@telegram @p1） | SYS-63 | — | — | MAN-05 |
| 44 | 自訂 Webhook 以 <http_method> 方法發送 JSON payload（Outline ×2：POST/PUT） | SYS-06~07 | — | E2E-45, E2E-46 | — |
| 45 | 自訂 Webhook headers 超過 10 組時拒絕建立（@custom-webhook @p1） | F-CF-10, HDL-09 | — | E2E-47 | — |
| 46 | 服務名稱僅支援精確匹配（Outline ×3） | SYS-28 | — | E2E-48 | — |
| 47 | 依 Channel 類型建構對應格式的通知 payload（Outline ×4：Slack/Discord/Telegram/自訂） | SYS-01~08 | — | E2E-49 | MAN-01~03 |
| 48 | 通知相關 API 未登入時回傳 401（Outline ×7） | HDL-28 | — | E2E-50 | — |
| 49 | Channel 設定儲存於 JSON 檔案（@data @p1） | SYS-42~44, SYS-54 | INT-01 | — | MAN-10 |
| 50 | 發送紀錄以 JSON Lines 格式儲存（@data @p1） | SYS-55~56 | INT-02 | — | — |
| 51 | 刪除 Channel 時保留其關聯的發送紀錄（@data @p1） | SYS-46, SYS-62, HDL-15 | INT-03 | E2E-17 | — |
| 52 | 所有已登入管理員皆可管理通知設定（@security @p1） | HDL-01~28（登入情境） | — | E2E-01~19（登入後操作） | — |
| 53 | 實際<action>後匹配 Channel 於目標平台收到對應通知（Outline ×4：stop/start/crash/restart） | SYS-11~17 | INT-02 | E2E-25~28 | MAN-01~03, MAN-06 |
| 54 | 測試按鈕可在目標平台看到測試訊息（@integration @p1） | F-TS-01~02 | INT-06 | E2E-21 | MAN-07 |
| 55 | 未匹配的 Channel 不會收到通知（@integration @p1） | SYS-22~28 | INT-02（多 channel 差異） | E2E-29~30 | MAN-08 |
| 56 | 通知發送紀錄正確寫入且可查詢（@integration @p1） | SYS-57~59 | INT-02~03 | E2E-34~39 | MAN-11 |

> **覆蓋率**：56/56 BDD Scenario 全覆蓋（含 9 組 Scenario Outline 之 Examples 全部展開：channel 類型 ×4、觸發事件 ×4、事件+範圍 ×3、結果篩選 ×3、自訂 method ×2、精確匹配 ×3、payload 格式 ×4、401 ×7、實際 action ×4，共 34 列）。
> **總計**：SYS 64 + HDL 28 + F 約 33 + INT 7 + E2E 50 + MAN 13 ≈ 195 個測試案例。
> **技術依據**：8 項 Tech Decision（Hub OnStatusChange 回呼 / JSON+JSONL 儲存 / 並行+timeout+retry / 4 種 payload / auto-disable / 30 天 TTL / 整合模式 / 7 API 設計）已全數納入測試案例。

---

*由 Test Plan Generator 自動產生，對應 BDD `docs/bdds/013-webhook-notification.feature`（技術裁決依 `docs/tech-decisions/013-webhook-notification.md`；`docs/development/013-webhook-notification.md` 產生後應補入第 0 節與測試環境引用）*
