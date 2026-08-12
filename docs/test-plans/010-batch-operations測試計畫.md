# 批次操作 — 測試計畫

> **對應 Interaction Flow**：`docs/interaction-flows/010-batch-operations.md`
> **對應 BDD**：尚未產生（產出時 BDD 不存在，以 interaction-flow 為輸入）
> **測試日期**：2025-08-11

---

## 1. 測試範圍總覽

| 層級 | 範圍 | 工具 | 負責 |
|------|------|------|------|
| 單元測試 | Go batch handler（`POST /api/v1/services/batch`） | `go test` + `net/http/httptest` | 後端 |
| 單元測試 | Go batch 模組（循序執行 / 逾時 / 驗證） | `go test` | 後端 |
| 單元測試 | Vue `useBatchSelection` composable（選取邏輯） | Vitest + @vue/test-utils | 前端 |
| 單元測試 | Vue `BatchToolbar` 元件 | Vitest + @vue/test-utils | 前端 |
| 單元測試 | Vue `ConfirmModal` 元件（批次專屬） | Vitest + @vue/test-utils | 前端 |
| 整合測試 | API endpoint + 選取邏輯 + 批次執行流程 | 手動 / 腳本 | 後端 + 前端 |
| 端對端測試 | 完整使用者操作流程（含異常路徑） | Playwright | 前端 |
| 手動驗證 | 真實 systemd 環境、網路中斷、逾時 | 手動 | QA |

---

## 2. 後端單元測試

### 2.1 Batch 模組（驗證 / 循序執行 / 逾時控制）

| # | 測試名稱 | Given | When | Then |
|---|---------|-------|------|------|
| SYS-01 | 正常批次啟動 3 個服務 | names=["nginx.service","docker.service","sshd.service"], action="start"，所有服務存在且解鎖 | 呼叫 `BatchExecute(names, action, timeout)` | 三個服務依序啟動成功，回傳 `[{name:"nginx.service", result:"success"}, ...]` |
| SYS-02 | 正常批次停止 5 個服務 | names=[5 個解鎖服務], action="stop" | 呼叫 `BatchExecute(...)` | 五個服務依序停止成功，回傳 5 筆 success |
| SYS-03 | 正常批次重啟 2 個服務 | names=[2 個解鎖服務], action="restart" | 呼叫 `BatchExecute(...)` | 兩個服務依序重啟成功 |
| SYS-04 | 部分服務操作失敗（中間失敗） | names=["svcA","svcB","svcC"]，startErr 對 svcB 回傳 error | 呼叫 `BatchExecute(names, "start", 60s)` | svcA 成功、svcB 失敗（含 error）、svcC 成功，回傳 2 筆 success + 1 筆 failure |
| SYS-05 | 全部服務操作失敗 | names=["svcA","svcB"]，startErr 通通回傳 error | 呼叫 `BatchExecute(names, "start", 60s)` | 回傳 2 筆 failure，各含 error message |
| SYS-06 | 循序執行順序保證 | names=["svcA","svcB","svcC"], action="start" | 呼叫 `BatchExecute(...)` 並記錄執行順序 | svcA → svcB → svcC 依序被呼叫，非並行 |
| SYS-07 | 鎖定服務拒絕操作 | names=["locked.service","normal.service"], action="start"，locked.service 為鎖定狀態 | 呼叫 `BatchExecute(...)` | locked.service 回傳 error"service is locked"，normal.service 正常執行 |
| SYS-08 | 不存在的服務名稱 | names=["nonexistent.service"], action="start" | 呼叫 `BatchExecute(...)` | 回傳 failure，error 含 "unit not found" 或等效訊息 |
| SYS-09 | 單次批次超過上限 50 個 | 傳入 51 個服務名稱 | 呼叫 `BatchExecute(names, "start", 60s)` | 回傳 validation error"batch size exceeds maximum of 50"，不執行任何操作 |
| SYS-10 | 單次批次剛好 50 個（邊界） | 傳入 50 個服務名稱，全部解鎖且存在 | 呼叫 `BatchExecute(names, "start", 60s)` | 50 個依序執行，回傳 50 筆結果 |
| SYS-11 | 單次批次 1 個服務（邊界） | 傳入 1 個服務名稱 | 呼叫 `BatchExecute(names, "start", 60s)` | 正常執行，回傳 1 筆結果 |
| SYS-12 | names 為空陣列 | names=[], action="start" | 呼叫 `BatchExecute(...)` | 回傳 validation error"names must not be empty" |
| SYS-13 | action 參數無效 | names=["svcA"], action="invalid" | 呼叫 `BatchExecute(...)` | 回傳 validation error"invalid action, must be start/stop/restart" |
| SYS-14 | 整體逾時 60 秒觸發 | 某個服務的 StartService 阻塞超過 60 秒 | 呼叫 `BatchExecute(names, "start", 60s)` | 逾時後該服務標記 failure（"operation timeout"），已執行的服務保留結果，未執行的不執行 |
| SYS-15 | 逾時後已完成的服務結果保留 | svcA 成功（1s），svcB 阻塞 70s（逾時），svcC 尚未執行 | 呼叫 `BatchExecute([svcA,svcB,svcC], "start", 60s)` | 回傳 svcA=success, svcB=failure(timeout), svcC=failure(timeout) |
| SYS-16 | 各筆操作獨立寫入 Audit Log | names=["svcA","svcB"], action="start"，全部成功 | 呼叫 `BatchExecute(...)` | audit.jsonl 新增 2 行，各含 action=start, target=svcA / svcB, result=success |
| SYS-17 | 部分失敗時 Audit Log 正確標記 | svcA 成功、svcB 失敗 | 呼叫 `BatchExecute(...)` | audit.jsonl 新增 2 行：svcA=success, svcB=failure（含 error detail） |
| SYS-18 | 鎖定服務被拒絕時不寫 Audit Log | names=["locked.service"], action="start" | 呼叫 `BatchExecute(...)` | 無 audit log 寫入（鎖定服務拒絕為 validation 層級，不算操作） |

### 2.2 Handler 層（POST /api/v1/services/batch）

| # | 測試名稱 | Given | When | Then |
|---|---------|-------|------|------|
| HDL-01 | POST /api/v1/services/batch 正常請求 | 已驗證 session，body=`{"names":["nginx.service","docker.service"],"action":"start"}` | 發送 POST 請求 | 200，回傳 `{"results":[{"name":"nginx.service","result":"success"},{"name":"docker.service","result":"success"}],"summary":{"success":2,"failure":0}}` |
| HDL-02 | POST /api/v1/services/batch stop | 已驗證 session，body=`{"names":["nginx.service"],"action":"stop"}` | 發送 POST 請求 | 200，回傳 stop 結果 |
| HDL-03 | POST /api/v1/services/batch restart | 已驗證 session，body=`{"names":["nginx.service"],"action":"restart"}` | 發送 POST 請求 | 200，回傳 restart 結果 |
| HDL-04 | 未驗證存取 batch endpoint | 無 session cookie | `POST /api/v1/services/batch` | 401 Unauthorized |
| HDL-05 | 請求 body 非 JSON | Content-Type: text/plain，body="invalid" | `POST /api/v1/services/batch` | 400，`{"error":"invalid request body"}` |
| HDL-06 | names 欄位缺失 | body=`{"action":"start"}`（無 names） | `POST /api/v1/services/batch` | 400，`{"error":"names field is required"}` |
| HDL-07 | action 欄位缺失 | body=`{"names":["nginx"]}`（無 action） | `POST /api/v1/services/batch` | 400，`{"error":"action field is required"}` |
| HDL-08 | names 不是陣列 | body=`{"names":"nginx","action":"start"}` | `POST /api/v1/services/batch` | 400，`{"error":"names must be an array"}` |
| HDL-09 | names 陣列超過 50 個 | body 含 51 個 names | `POST /api/v1/services/batch` | 400，`{"error":"batch size exceeds maximum of 50"}` |
| HDL-10 | action 不是合法枚舉值 | body=`{"names":["nginx"],"action":"delete"}` | `POST /api/v1/services/batch` | 400，`{"error":"invalid action, must be start, stop, or restart"}` |
| HDL-11 | 部分失敗回傳結構 | mock systemd：svcA 成功，svcB 失敗 | `POST /api/v1/services/batch` | 200，`{"results":[{"name":"svcA","result":"success"},{"name":"svcB","result":"failure","error":"unit not found"}],"summary":{"success":1,"failure":1}}` |
| HDL-12 | 全部失敗回傳結構 | mock systemd：全部失敗 | `POST /api/v1/services/batch` | 200，`{"results":[...all failure...],"summary":{"success":0,"failure":2}}` |
| HDL-13 | 回應包含 summary 統計 | 正常 3 筆全部成功 | `POST /api/v1/services/batch` | response 含 `"summary":{"success":3,"failure":0}` |
| HDL-14 | Content-Type 為 application/json | 任何合法請求 | 檢查 response header | Content-Type: application/json |

---

## 3. 前端單元測試

### 3.1 useBatchSelection Composable（選取邏輯）

| # | 測試名稱 | Given | When | Then |
|---|---------|-------|------|------|
| F-BS-01 | 初始狀態無選取 | composable 初始化，services 有 5 個解鎖服務 | 讀取 `selectedCount` | 為 0，`selectedServices` 為空陣列 |
| F-BS-02 | 選取單一服務 | composable 初始化 | 呼叫 `toggleService("nginx.service")` | `isSelected("nginx.service")` 為 true，`selectedCount` 為 1 |
| F-BS-03 | 取消選取單一服務 | nginx.service 已選取 | 呼叫 `toggleService("nginx.service")` | `isSelected("nginx.service")` 為 false，`selectedCount` 為 0 |
| F-BS-04 | 選取多個服務 | composable 初始化 | 依序 `toggleService("A")`, `toggleService("B")`, `toggleService("C")` | `selectedCount` 為 3，`selectedServices` 含 A, B, C |
| F-BS-05 | 全選目前過濾結果 | services 有 10 個解鎖服務，filteredServices 過濾後剩 3 個 | 呼叫 `selectAll()` | `selectedCount` 為 3，僅過濾結果中的 3 個被選取 |
| F-BS-06 | 全選後取消全選 | 已全選 3 個服務 | 呼叫 `deselectAll()` | `selectedCount` 為 0 |
| F-BS-07 | 全選排除鎖定服務 | services 有 3 個解鎖 + 2 個鎖定，filteredServices 含全部 5 個 | 呼叫 `selectAll()` | `selectedCount` 為 3，2 個鎖定服務未被選取 |
| F-BS-08 | 過濾條件變更時清除選取 | 已選取 2 個服務 | 變更 statusFilter 從 "all" → "running" | 選取被清除（`selectedCount` 為 0） |
| F-BS-09 | Tab 切換時清除選取 | Tab="我的服務"，已選取 3 個 | 模擬切換 Tab → "系統服務" | 選取被清除 |
| F-BS-10 | 搜尋文字變更時清除選取 | 已選取 2 個 | 修改 searchText | 選取被清除（`selectedCount` 為 0） |
| F-BS-11 | 鎖定服務不可被 toggle | locked.service 為鎖定狀態 | 呼叫 `toggleService("locked.service")` | 回傳 false 或不變更選取狀態 |
| F-BS-12 | toggle 不存在的服務 | services 中無 "ghost.service" | 呼叫 `toggleService("ghost.service")` | 不影響選取狀態，不報錯 |
| F-BS-13 | selectedServices 回傳完整 Service 物件 | 已選取 nginx.service | 讀取 `selectedServices` | 陣列含 `{name:"nginx.service", active:"active", ...}` |
| F-BS-14 | 選取 0 個時 hasSelection 為 false | 無任何選取 | 讀取 `hasSelection` | 為 false |
| F-BS-15 | 選取 1 個時 hasSelection 為 true | 已選取 1 個 | 讀取 `hasSelection` | 為 true |

### 3.2 BatchToolbar 元件

| # | 測試名稱 | Given | When | Then |
|---|---------|-------|------|------|
| F-BT-01 | 無選取時工具列隱藏 | `hasSelection=false` | mount BatchToolbar | 工具列不可見（v-if 為 false 或 display:none） |
| F-BT-02 | 有選取時工具列顯示 | `hasSelection=true`, `selectedCount=3` | mount BatchToolbar | 工具列可見，顯示「已選取 3 個服務」 |
| F-BT-03 | 選取數量即時更新 | 先選取 2 個 → 再加選 1 個 | 更新 `selectedCount` prop | 工具列文字更新為「已選取 3 個服務」 |
| F-BT-04 | Start 按鈕存在且 enabled | hasSelection=true | mount BatchToolbar | Start 按鈕可見且未 disabled |
| F-BT-05 | Stop 按鈕存在且 enabled | hasSelection=true | mount BatchToolbar | Stop 按鈕可見且未 disabled |
| F-BT-06 | Restart 按鈕存在且 enabled | hasSelection=true | mount BatchToolbar | Restart 按鈕可見且未 disabled |
| F-BT-07 | 點擊 Start 觸發事件 | hasSelection=true | click Start 按鈕 | emit "batch-action" 事件，payload={action:"start"} |
| F-BT-08 | 點擊 Stop 觸發事件 | hasSelection=true | click Stop 按鈕 | emit "batch-action" 事件，payload={action:"stop"} |
| F-BT-09 | 點擊 Restart 觸發事件 | hasSelection=true | click Restart 按鈕 | emit "batch-action" 事件，payload={action:"restart"} |
| F-BT-10 | 執行中所有按鈕 disabled | `executing=true`, `progress="2/5"` | mount BatchToolbar | Start/Stop/Restart 按鈕皆 disabled |
| F-BT-11 | 執行中顯示進度文字 | executing=true, progress="3/5" | mount BatchToolbar | 工具列顯示「正在執行... 3/5」 |
| F-BT-12 | 「取消選取」連結存在 | hasSelection=true | mount BatchToolbar | 顯示「取消選取」連結 |
| F-BT-13 | 點擊「取消選取」觸發事件 | hasSelection=true | click「取消選取」連結 | emit "deselect-all" 事件 |
| F-BT-14 | 工具列 sticky 定位 | 元件已 mount，模擬頁面捲動 | 檢查 CSS class / style | 工具列有 `position: sticky` 或等效 fixed 定位 |
| F-BT-15 | 工具列顯示動畫 | hasSelection 從 false 變 true | mount 後變更 prop | 工具列以 slide-down 動畫出現 |

### 3.3 ConfirmModal（批次操作確認對話框）

| # | 測試名稱 | Given | When | Then |
|---|---------|-------|------|------|
| F-CM-01 | Start 確認對話框顯示 | props: action="start", count=5, services=[5 個服務名稱] | mount ConfirmModal | 顯示「確定要啟動 5 個服務？」 |
| F-CM-02 | Stop 確認對話框顯示 | props: action="stop", count=3, services=[3 個服務名稱] | mount ConfirmModal | 顯示「確定要停止 3 個服務？」 |
| F-CM-03 | Restart 確認對話框顯示 | props: action="restart", count=2, services=[2 個服務名稱] | mount ConfirmModal | 顯示「確定要重啟 2 個服務？」 |
| F-CM-04 | Restart 額外警告提示 | props: action="restart" | mount ConfirmModal | 對話框內含「重啟會造成服務短暫中斷」的提示文字 |
| F-CM-05 | Start 無中斷警告 | props: action="start" | mount ConfirmModal | 對話框不含「短暫中斷」相關文字 |
| F-CM-06 | 服務清單最多顯示 5 個 | count=8, services=[8 個名稱] | mount ConfirmModal | 顯示前 5 個服務名稱 +「...及其他 3 個」 |
| F-CM-07 | 服務清單 ≤5 個全部顯示 | count=3, services=[3 個名稱] | mount ConfirmModal | 顯示全部 3 個服務名稱，無「...及其他」 |
| F-CM-08 | 點擊確認按鈕 | ConfirmModal 已顯示 | click「確認」按鈕 | emit "confirm" 事件，modal 關閉 |
| F-CM-09 | 點擊取消按鈕 | ConfirmModal 已顯示 | click「取消」按鈕 | emit "cancel" 事件，modal 關閉 |
| F-CM-10 | 確認後勾選保持不變 | 已選取 3 個服務，確認取消 | click「取消」 | 選取狀態不變（selectedCount 仍為 3） |

### 3.4 結果通知（Toast + 詳細結果面板）

| # | 測試名稱 | Given | When | Then |
|---|---------|-------|------|------|
| F-RS-01 | 全部成功顯示綠色 Toast | batchResult: allSuccess, count=5, action="start" | 觸發結果顯示 | Toast 綠色背景，文字「5 個服務已成功啟動」 |
| F-RS-02 | 全部成功後選取清除 | batchResult: allSuccess | Toast 顯示後 | selectedCount 為 0，工具列隱藏 |
| F-RS-03 | 全部成功後重整服務列表 | batchResult: allSuccess | Toast 顯示後 | 觸發 services 重新載入（dispatch fetchServices） |
| F-RS-04 | 部分失敗顯示黃色 Toast | batchResult: partialFail, success=3, fail=2 | 觸發結果顯示 | Toast 黃色背景，文字「3 成功，2 失敗」 |
| F-RS-05 | 部分失敗展開詳細結果面板 | batchResult: partialFail, 2 個失敗項目 | Toast 顯示後 | 詳細結果面板列出失敗服務名稱 + 錯誤原因 |
| F-RS-06 | 部分失敗後勾選保留 | batchResult: partialFail | 結果處理後 | 失敗服務仍維持勾選（或全部保留），以便重試 |
| F-RS-07 | 全部失敗顯示紅色 Toast | batchResult: allFail, 3 個失敗項目 | 觸發結果顯示 | Toast 紅色背景，文字「批次操作失敗」 |
| F-RS-08 | 全部失敗顯示所有錯誤原因 | batchResult: allFail, 3 個失敗項目 | 觸發結果顯示 | 詳細結果面板列出全部 3 個失敗服務 + 錯誤原因 |
| F-RS-09 | 詳細結果面板可關閉 | 詳細結果面板已展開 | click 關閉按鈕 | 面板收起 |
| F-RS-10 | 失敗項目可個別手動重試 | 詳細結果面板顯示 svcA 失敗 | click svcA 旁的「重試」按鈕 | 對 svcA 單獨發送對應 API 請求 |

---

## 4. 端對端測試（Playwright）

### 4.1 Happy Path — 全部成功

| # | 測試名稱 | 操作步驟 | 預期結果 |
|---|---------|---------|---------|
| E2E-01 | 選取 3 個服務後批次啟動 | 1. 登入 Dashboard<br>2. 勾選 3 個解鎖服務的 checkbox<br>3. 點擊批次工具列的 Start 按鈕<br>4. 在確認對話框點擊「確認」 | 1. 工具列顯示「已選取 3 個服務」<br>2. 對話框出現「確定要啟動 3 個服務？」<br>3. 工具列顯示進度「正在執行...」<br>4. 綠色 Toast「3 個服務已成功啟動」<br>5. 選取清除、工具列隱藏、列表重整 |
| E2E-02 | 選取 2 個服務後批次停止 | 1. 登入 Dashboard<br>2. 勾選 2 個 running 服務<br>3. 點擊 Stop 按鈕<br>4. 確認對話框點擊「確認」 | 1. 確認對話框顯示「確定要停止 2 個服務？」<br>2. 綠色 Toast「2 個服務已成功停止」<br>3. 列表重整顯示服務已停止 |
| E2E-03 | 選取 2 個服務後批次重啟 | 1. 登入 Dashboard<br>2. 勾選 2 個服務<br>3. 點擊 Restart 按鈕<br>4. 確認對話框點擊「確認」 | 1. 對話框內有「重啟會造成服務短暫中斷」警告<br>2. 綠色 Toast「2 個服務已成功重啟」 |
| E2E-04 | 取消批次操作確認 | 1. 勾選 3 個服務<br>2. 點擊 Start 按鈕<br>3. 在確認對話框點擊「取消」 | 1. 對話框關閉<br>2. 勾選保持不變（3 個仍勾選）<br>3. 工具列仍顯示「已選取 3 個服務」 |

### 4.2 選取邏輯

| # | 測試名稱 | 操作步驟 | 預期結果 |
|---|---------|---------|---------|
| E2E-05 | 全選目前過濾結果 | 1. 使用搜尋框輸入 "nginx"<br>2. 過濾結果有 2 個服務<br>3. 點擊表頭全選 checkbox | 1. 僅 2 個過濾結果被勾選<br>2. 工具列顯示「已選取 2 個服務」 |
| E2E-06 | 全選後取消全選 | 1. 點擊表頭全選 checkbox（勾選所有可見）<br>2. 再次點擊表頭 checkbox | 1. 所有勾選被清除<br>2. 工具列隱藏 |
| E2E-07 | 鎖定服務無 checkbox | 1. 登入 Dashboard<br>2. 檢查鎖定服務所在列 | 鎖定服務列左側無 checkbox 或顯示 🔒 圖示 |
| E2E-08 | 鎖定服務不被全選 | 1. 列表含 3 個解鎖 + 1 個鎖定<br>2. 點擊表頭全選 checkbox | 僅 3 個解鎖服務被勾選，鎖定服務未勾選 |
| E2E-09 | Tab 切換清除選取 | 1. 在「我的服務」Tab 勾選 2 個<br>2. 切換到「系統服務」Tab | 1. 切換後選取被清除<br>2. 系統服務 Tab 下無任何勾選<br>3. 切回「我的服務」Tab 也無勾選 |
| E2E-10 | 過濾變更清除選取 | 1. 勾選 2 個服務<br>2. 將狀態過濾從「全部」改為「running」 | 選取被清除，工具列隱藏 |
| E2E-11 | 取消選取連結 | 1. 勾選 3 個服務<br>2. 點擊工具列「取消選取」連結 | 所有勾選清除，工具列隱藏 |

### 4.3 確認對話框

| # | 測試名稱 | 操作步驟 | 預期結果 |
|---|---------|---------|---------|
| E2E-12 | 確認對話框顯示受影響服務清單 | 1. 勾選 6 個服務<br>2. 點擊 Start 按鈕 | 對話框顯示前 5 個服務名稱 +「...及其他 1 個」 |
| E2E-13 | 確認對話框顯示全部服務（≤5） | 1. 勾選 3 個服務<br>2. 點擊 Stop 按鈕 | 對話框顯示全部 3 個服務名稱，無「...及其他」 |

### 4.4 異常情境 — 部分失敗

| # | 測試名稱 | 操作步驟 | 預期結果 |
|---|---------|---------|---------|
| E2E-14 | 部分服務失敗顯示黃色 Toast | 1. 勾選含一個不存在服務的組合<br>2. 執行批次操作 | 黃色 Toast「X 成功，Y 失敗」 |
| E2E-15 | 部分失敗展開詳細結果 | 1. 部分失敗 Toast 出現<br>2. 檢查詳細結果面板 | 面板列出失敗服務名稱 + 錯誤原因 |
| E2E-16 | 部分失敗後勾選保留 | 1. 部分失敗發生<br>2. 檢查勾選狀態 | 失敗的服務仍被勾選，可手動重試 |

### 4.5 異常情境 — 全部失敗

| # | 測試名稱 | 操作步驟 | 預期結果 |
|---|---------|---------|---------|
| E2E-17 | 全部失敗顯示紅色 Toast | 1. 勾選 2 個不存在或不可操作的服務<br>2. 執行批次操作 | 紅色 Toast「批次操作失敗」 |
| E2E-18 | 全部失敗顯示所有錯誤 | 1. 全部失敗 Toast 出現<br>2. 檢查詳細結果面板 | 面板列出所有失敗服務 + 各自錯誤原因 |

### 4.6 邊界條件

| # | 測試名稱 | 操作步驟 | 預期結果 |
|---|---------|---------|---------|
| E2E-19 | 過濾後結果為空時全選 disabled | 1. 搜尋 "zzzz_nonexistent"（無結果）<br>2. 檢查表頭 checkbox | 表頭全選 checkbox disabled 或隱藏 |
| E2E-20 | 執行期間按鈕 disabled | 1. 勾選多個服務<br>2. 點擊 Start 並確認<br>3. 在執行期間檢查工具列 | Start/Stop/Restart 按鈕皆 disabled，顯示進度 |
| E2E-21 | 執行進度即時更新 | 1. 勾選 5 個服務<br>2. 執行批次操作<br>3. 觀察工具列進度 | 進度文字從「正在執行... 0/5」逐步更新到「5/5」 |

---

## 5. 手動驗證（真實環境）

### 5.1 基本功能

| # | 情境 | 驗證步驟 | 預期 |
|---|------|---------|------|
| MAN-01 | 真實 systemd 批次啟動 5 個服務 | 1. 在 Dashboard 選取 5 個 inactive 服務<br>2. 點擊 Start → 確認 | 5 個服務依序啟動，`systemctl status` 確認實際已啟動 |
| MAN-02 | 真實 systemd 批次停止 5 個服務 | 1. 選取 5 個 active 服務<br>2. 點擊 Stop → 確認 | 5 個服務依序停止，`systemctl status` 確認實際已停止 |
| MAN-03 | 真實 systemd 批次重啟 3 個服務 | 1. 選取 3 個 active 服務<br>2. 點擊 Restart → 確認 | 3 個服務依序重啟，確認重啟期間服務短暫中斷後恢復 |
| MAN-04 | 鎖定服務不可操作 | 1. 嘗試選取 locked.service<br>2. 或透過 API 對 locked.service 發送批次請求 | 無 checkbox，或 API 回傳 locked error |
| MAN-05 | 不存在的服務 | 1. 透過 API 對 ["nonexistent.service"] 發送批次請求 | API 回傳 failure，error 含 "unit not found" |

### 5.2 邊界條件

| # | 情境 | 驗證步驟 | 預期 |
|---|------|---------|------|
| MAN-06 | 批次上限 50 個（邊界） | 1. 準備 50 個可操作服務<br>2. 透過 API 發送批次請求（50 個 names） | 50 個依序執行，全部回傳結果 |
| MAN-07 | 批次超過上限 50 個 | 透過 API 發送 51 個 names | API 回傳 400 error |
| MAN-08 | 空 names 陣列 | 透過 API 發送 `{"names":[],"action":"start"}` | API 回傳 400 validation error |
| MAN-09 | 無效 action | 透過 API 發送 `{"names":["svc"],"action":"reboot"}` | API 回傳 400 validation error |
| MAN-10 | 操作逾時處理 | 對一個需要很長時間的服務執行操作，設定逾時 | 逾時後該服務回報 failure + "operation timeout" |

### 5.3 異常情境

| # | 情境 | 驗證步驟 | 預期 |
|---|------|---------|------|
| MAN-11 | 網路中斷（執行中） | 1. 執行批次操作<br>2. 在執行期間斷開網路<br>3. 恢復網路 | 前端顯示「連線中斷，正在重試...」，恢復後繼續顯示結果或失敗 |
| MAN-12 | 後端重啟（執行中） | 1. 執行批次操作<br>2. 在執行期間重啟後端服務 | 前端顯示錯誤提示，可重新操作 |
| MAN-13 | 權限不足 | 以非 root 身分對需要 root 權限的 service 操作 | 回傳 failure，error 含權限相關訊息 |

### 5.4 整合驗證

| # | 情境 | 驗證步驟 | 預期 |
|---|------|---------|------|
| MAN-14 | Audit Log 寫入 | 1. 執行一次批次操作（3 個服務）<br>2. 檢查 Audit Log 頁面 | 3 筆獨立 audit log，各含正確 action / target / result |
| MAN-15 | 部分失敗 Audit Log | 1. 批次操作中含 1 個失敗的服務<br>2. 檢查 Audit Log | 成功服務 log result=success，失敗服務 log result=failure + detail |
| MAN-16 | WebSocket 整合 | 1. 監聽 WebSocket<br>2. 執行批次操作 | 操作期間 WebSocket 推送各服務狀態變更，操作完成後前端重整列表 |
| MAN-17 | 深色模式樣式 | 1. 切換到深色模式<br>2. 驗證 checkbox、工具列、確認對話框 | 所有 UI 在深色模式下樣式正常、可讀 |
| MAN-18 | 淺色模式樣式 | 1. 切換到淺色模式<br>2. 驗證 checkbox、工具列、確認對話框 | 所有 UI 在淺色模式下樣式正常、可讀 |
| MAN-19 | 手機 RWD 佈局 | 1. 以手機寬度（375px）開啟頁面<br>2. 勾選服務、操作工具列 | checkbox 與工具列佈局正常，可正確操作 |

---

## 6. 測試環境

| 項目 | 需求 |
|------|------|
| Go 版本 | 1.24+ |
| Node.js 版本 | 22+ |
| 前端框架 | Vue 3.5.40 + Pinia 4.0.2 + TypeScript 6.0 |
| 前端測試 | Vitest 4.1.10 + @vue/test-utils 2.4.11 + happy-dom 20.11.1 |
| E2E 測試 | Playwright 1.62.1 |
| 後端測試 | go test + net/http/httptest |
| 後端路由 | go-chi/chi v5 |
| OS（手動驗證） | Linux（含 systemd） |
| 瀏覽器（E2E） | Chromium、Firefox、WebKit |
| 瀏覽器（手動） | Chrome、Firefox、Safari、Mobile Safari |

---

## 7. 缺陷追蹤模板

| 欄位 | 說明 |
|------|------|
| ID | BUG-BAT-XXX |
| 測試案例 | 對應以上測試編號（SYS-xx / HDL-xx / F-xx / E2E-xx / MAN-xx） |
| 嚴重程度 | P0（阻擋） / P1（主要） / P2（次要） |
| 重啟步驟 | 逐步操作說明 |
| 預期 vs 實際 | 對照預期行為與實際行為 |
| 環境 | OS / Browser / Go 版本 / Node 版本 |

---

## 8. 覆蓋率摘要

### 來源場景對應（從 interaction-flow §7 驗收檢查清單推導）

| 驗收項目群組 | 覆蓋測試案例 |
|-------------|-------------|
| 前端 — 選取 UI（7 項） | F-BS-01 ~ F-BS-15, E2E-05 ~ E2E-11 |
| 前端 — 批次工具列（5 項） | F-BT-01 ~ F-BT-15 |
| 前端 — 確認對話框（5 項） | F-CM-01 ~ F-CM-10, E2E-12 ~ E2E-13 |
| 前端 — 進度與結果（7 項） | F-RS-01 ~ F-RS-10, E2E-20 ~ E2E-21 |
| 後端（8 項） | SYS-01 ~ SYS-18, HDL-01 ~ HDL-14 |
| 整合（5 項） | MAN-14 ~ MAN-19 |

### 異常情境覆蓋（從 interaction-flow §5 推導）

| 異常情境 | 覆蓋測試案例 |
|---------|-------------|
| 部分服務操作失敗 | SYS-04, SYS-17, HDL-11, E2E-14 ~ E2E-16, F-RS-04 ~ F-RS-06 |
| 網路中斷（執行中） | MAN-11 |
| 選取 0 個服務時點擊操作按鈕 | F-BT-01（按鈕不可見） |
| 選取中包含已不存在的服務 | SYS-08, MAN-05, E2E-17 ~ E2E-18 |
| 批次操作逾時 | SYS-14, SYS-15, MAN-10 |
| 全選時過濾結果為空 | E2E-19 |

### 邊界條件覆蓋（從 interaction-flow §6 推導）

| 邊界條件 | 覆蓋測試案例 |
|---------|-------------|
| 單次批次上限 50 個 | SYS-09, SYS-10, HDL-09, MAN-06, MAN-07 |
| 鎖定服務排除 | SYS-07, SYS-18, F-BS-07, F-BS-11, E2E-07, E2E-08 |
| Tab 隔離 | F-BS-09, E2E-09 |
| 過濾 + 全選 | F-BS-05, F-BS-08, F-BS-10, E2E-05, E2E-10 |
| 操作逾時 60 秒 | SYS-14, SYS-15, MAN-10 |
| 循序執行 | SYS-06 |
| 確認對話框 + Restart 特殊提示 | F-CM-03, F-CM-04, E2E-03 |
| WebSocket 整合 | MAN-16 |

---

*本測試計畫基於 `docs/interaction-flows/010-batch-operations.md`（2025-08-09）產出。待 `docs/bdds/010-batch-operations.feature` 產生後，應進行交叉比對補足。*
