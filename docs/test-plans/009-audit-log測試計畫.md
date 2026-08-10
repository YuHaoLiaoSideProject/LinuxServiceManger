# Audit 操作紀錄 — 測試計畫

> **對應 BDD**：`docs/bdds/009-audit-log.feature`
> **操作流程**：`docs/interaction-flows/009-audit-log.md`
> **測試日期**：2025-08-09

---

## 1. 測試範圍總覽

| 層級 | 範圍 | 工具 | 負責 |
|------|------|------|------|
| 單元測試 | Go audit 模組（寫入 / 查詢 / 清理） | `go test` | 後端 |
| 單元測試 | Go audit API handler | `go test` + `net/http/httptest` | 後端 |
| 單元測試 | Vue AuditLogView 元件邏輯 | Vitest + @vue/test-utils | 前端 |
| 整合測試 | 操作觸發 → audit log 寫入 → API 查詢 | 手動 / 腳本 | 後端 |
| 端對端測試 | 完整使用者操作流程 | Playwright | 前端 |
| 手動驗證 | 真實 Linux 環境 + 磁碟滿 / 保留期限 | 手動 | QA |

---

## 2. 後端單元測試

### 2.1 Audit 模組（寫入 / 查詢 / 清理）

| # | 測試名稱 | Given | When | Then |
|---|---------|-------|------|------|
| SYS-01 | 正常寫入 audit log | 有效的 action=restart, target=nginx.service, result=success | 呼叫 `WriteAudit(username, ip, action, target, result, detail)` | audit.jsonl 新增一行 JSON，含 timestamp, username, source_ip, action, target, result, detail |
| SYS-02 | 操作失敗寫入 audit log | 有效的 action=start, target=nonexistent.service, result=failure, detail="unit not found" | 呼叫 `WriteAudit(...)` | audit.jsonl 新增一行，result=failure, detail="unit not found" |
| SYS-03 | 寫入時磁碟滿 | os 模擬 disk full（ENOSPC） | 呼叫 `WriteAudit(...)` | 回傳 error，不 panic；操作主流程不受影響 |
| SYS-04 | 寫入非同步不阻塞 | 正在寫入 audit log | 量測呼叫端 response time | WriteAudit 執行時間不影響 API 回應（使用 goroutine 或 channel） |
| SYS-05 | 記錄欄位完整性檢查 | 寫入一筆 audit log | 讀取 audit.jsonl 最新一行並解析 JSON | 所有欄位 timestamp, username, source_ip, action, target, result, detail 皆存在 |
| SYS-06 | 不記錄密碼或 token | username="admin", action=login | 檢查寫入內容 | detail 欄位不含 password、token、session 等敏感字串 |
| SYS-07 | 查詢稽核紀錄（預設分頁） | audit.jsonl 有 120 筆紀錄 | 呼叫 `QueryAudit(page=1, limit=50, search="", from="", to="")` | 回傳最近 50 筆（依時間倒序），total=120 |
| SYS-08 | 查詢第二頁 | audit.jsonl 有 120 筆紀錄 | 呼叫 `QueryAudit(page=2, limit=50, ...)` | 回傳第 51~100 筆，total=120 |
| SYS-09 | 查詢超出範圍的頁碼 | audit.jsonl 有 30 筆紀錄 | 呼叫 `QueryAudit(page=5, limit=50, ...)` | 回傳空陣列，total=30 |
| SYS-10 | 查詢 limit 上限 | audit.jsonl 有 200 筆紀錄 | 呼叫 `QueryAudit(page=1, limit=100, ...)` | 回傳 100 筆（不超過上限） |
| SYS-11 | limit 超過上限應限制 | limit=200 | 呼叫 `QueryAudit(...)` | 自動 clamp 為 100，或回傳 error |
| SYS-12 | limit 為 0 或負數 | limit=0 | 呼叫 `QueryAudit(...)` | 回傳 validation error |
| SYS-13 | 依關鍵字搜尋 | audit.jsonl 有 nginx、apache 相關紀錄 | 呼叫 `QueryAudit(page=1, limit=50, search="nginx", ...)` | 回傳僅 target 或 action 或 username 含 "nginx" 的紀錄 |
| SYS-14 | 搜尋無匹配結果 | audit.jsonl 無含 "xyz" 的紀錄 | 呼叫 `QueryAudit(..., search="xyz", ...)` | 回傳空陣列，total=0 |
| SYS-15 | 日期範圍篩選 | audit.jsonl 有 2025-08-01 ~ 2025-08-09 的紀錄 | 呼叫 `QueryAudit(from="2025-08-01", to="2025-08-05", ...)` | 回傳僅該日期範圍內的紀錄 |
| SYS-16 | 日期格式無效 | from="not-a-date" | 呼叫 `QueryAudit(...)` | 回傳 validation error |
| SYS-17 | CSV 匯出 | audit.jsonl 有 50 筆紀錄 | 呼叫 `ExportAuditCSV(search="", from="", to="")` | 回傳 CSV 內容，含 header row（timestamp,username,source_ip,action,target,result,detail） |
| SYS-18 | CSV 匯出超過 10,000 筆上限 | audit.jsonl 有 15,000 筆 | 呼叫 `ExportAuditCSV(...)` | 回傳最多 10,000 筆 CSV，並標示 truncated=true |
| SYS-19 | CSV 匯出保留過濾條件 | search="nginx", from="2025-08-01", to="2025-08-09" | 呼叫 `ExportAuditCSV(search="nginx", from="2025-08-01", to="2025-08-09")` | CSV 內容僅含符合搜尋和日期範圍的紀錄 |
| SYS-20 | 保留期限清理 — 超過 90 天 | audit.jsonl 有 95 天前的紀錄和 10 天前的紀錄 | 觸發 `CleanupAudit(retentionDays=90)` | 95 天前的紀錄被移除，10 天前的保留 |
| SYS-21 | 保留期限清理 — 全部在期限內 | audit.jsonl 全部紀錄都在 90 天內 | 觸發 `CleanupAudit(retentionDays=90)` | 無任何紀錄被移除 |
| SYS-22 | JSON Lines 檔案達 100MB 上限 | audit.jsonl 大小 = 100MB | 呼叫 `WriteAudit(...)` | 寫入成功（append），後端 log warning 提示檔案大小達上限 |
| SYS-23 | 空的 audit.jsonl 查詢 | audit.jsonl 為空檔或不存在 | 呼叫 `QueryAudit(...)` | 回傳空陣列，total=0，無 error |
| SYS-24 | action 枚舉驗證 | action="invalid_action" | 呼叫 `WriteAudit(...)` | 回傳 validation error，拒絕寫入 |
| SYS-25 | target 為空字串（登入/登出時無目標） | action=login, target="" | 呼叫 `WriteAudit(...)` | 寫入成功，target 欄位為 "-" 或空字串 |

### 2.2 Handler 層（Audit API）

| # | 測試名稱 | Given | When | Then |
|---|---------|-------|------|------|
| HDL-01 | GET /api/v1/audit 正常分頁 | mock audit 模組回傳 50 筆、total=120 | `GET /api/v1/audit?page=1&limit=50` | 200，回傳 `{"data": [...50 items], "total": 120, "page": 1, "limit": 50}` |
| HDL-02 | GET /api/v1/audit 含搜尋參數 | mock audit 回傳匹配紀錄 | `GET /api/v1/audit?search=nginx&page=1&limit=50` | 200，僅回傳匹配紀錄 |
| HDL-03 | GET /api/v1/audit 含日期範圍 | mock audit 回傳日期範圍內紀錄 | `GET /api/v1/audit?from=2025-08-01&to=2025-08-09&page=1&limit=50` | 200，僅回傳日期範圍內紀錄 |
| HDL-04 | GET /api/v1/audit/export CSV | mock audit ExportCSV 回傳 CSV 內容 | `GET /api/v1/audit/export?format=csv` | 200，Content-Type: text/csv，Content-Disposition: attachment; filename="audit-log-YYYY-MM-DD.csv" |
| HDL-05 | GET /api/v1/audit/export 含過濾 | mock audit ExportCSV 回傳過濾後 CSV | `GET /api/v1/audit/export?format=csv&search=nginx&from=2025-08-01&to=2025-08-09` | 200，CSV 內容僅含過濾後紀錄 |
| HDL-06 | 未驗證存取 audit API | 無 session cookie | `GET /api/v1/audit` | 401 Unauthorized |
| HDL-07 | 未驗證存取 export API | 無 session cookie | `GET /api/v1/audit/export?format=csv` | 401 Unauthorized |
| HDL-08 | page 參數格式錯誤 | page=abc | `GET /api/v1/audit?page=abc&limit=50` | 400，`{"error": "invalid page parameter"}` |
| HDL-09 | limit 參數超限 | limit=200 | `GET /api/v1/audit?page=1&limit=200` | 400 或自動 clamp 為 100 |
| HDL-10 | 日期格式無效 | from=01-08-2025（非 ISO 格式） | `GET /api/v1/audit?from=01-08-2025` | 400，`{"error": "invalid date format, expected YYYY-MM-DD"}` |
| HDL-11 | 無 format 參數的 export 請求 | 無 format | `GET /api/v1/audit/export` | 400，`{"error": "format parameter required"}` |
| HDL-12 | 不支援的 format | format=pdf | `GET /api/v1/audit/export?format=pdf` | 400，`{"error": "unsupported format, only csv is supported"}` |

---

## 3. 前端單元測試

### 3.1 AuditLogView 頁面元件

| # | 測試名稱 | Given | When | Then |
|---|---------|-------|------|------|
| F-AV-01 | 頁面載入時顯示 loading spinner | 尚未收到 API 回應 | mount AuditLogView | 顯示 loading spinner |
| F-AV-02 | 成功載入後顯示表格 | mock API 回傳 3 筆紀錄 | mount + await API response | 表格顯示 3 行資料，含時間、使用者、IP、動作、目標、結果 |
| F-AV-03 | 成功紀錄以綠色標示 | mock API 回傳 result=success 的紀錄 | mount + await API response | 該行有 `result-success` class（綠色背景） |
| F-AV-04 | 失敗紀錄以紅色標示 | mock API 回傳 result=failure 的紀錄 | mount + await API response | 該行有 `result-failure` class（紅色背景） |
| F-AV-05 | 無紀錄時顯示空狀態 | mock API 回傳 data=[]，total=0 | mount + await API response | 顯示「尚無操作紀錄」空狀態 |
| F-AV-06 | API 錯誤顯示錯誤訊息 + 重試按鈕 | mock API 回傳 500 | mount + await API response | 顯示錯誤訊息 +「重試」按鈕 |
| F-AV-07 | 點擊重試按鈕重新載入 | 處於錯誤狀態 | click「重試」按鈕 | 重新呼叫 GET /api/v1/audit，回到 loading 狀態 |
| F-AV-08 | 輸入搜尋 trigger debounce | 搜尋框已 render | 輸入 "nginx" | 300ms 後發送 API 請求（含 search=nginx），分頁重設為第 1 頁 |
| F-AV-09 | 快速連續輸入只發一次請求 | 搜尋框已 render | 快速輸入 "nginx"（每次鍵入間隔 < 300ms） | 只發送一次 API 請求（debounce） |
| F-AV-10 | 搜尋無結果顯示空狀態 | mock API 回傳 data=[]，total=0 | 輸入 "xyz123" 並等待 debounce | 顯示「沒有符合條件的紀錄」+「清除過濾」連結 |
| F-AV-11 | 點擊清除過濾連結 | 搜尋框有 "nginx"，表格為過濾狀態 | click「清除過濾」連結 | 搜尋框清空，重新載入全部紀錄，分頁重設 |
| F-AV-12 | 日期範圍篩選 | 日期選擇器已 render | 選擇 from=2025-08-01, to=2025-08-09 | 發送 API 請求（含 from/to 參數），分頁重設為第 1 頁 |
| F-AV-13 | 清除日期範圍 | 日期範圍已設定 | 清除日期選擇器 | 發送 API 請求（不含 from/to），分頁重設 |
| F-AV-14 | 翻頁 — 下一頁 | 總頁數=5，目前 page=1 | click「下一頁」 | 發送 GET /api/v1/audit?page=2，頁面捲回表格頂端 |
| F-AV-15 | 翻頁 — 上一頁 | 總頁數=5，目前 page=3 | click「上一頁」 | 發送 GET /api/v1/audit?page=2 |
| F-AV-16 | 翻頁 — 點擊頁碼 | 總頁數=5，目前 page=1 | click 頁碼「3」 | 發送 GET /api/v1/audit?page=3 |
| F-AV-17 | 第一頁時上一頁按鈕 disabled | 目前 page=1 | 檢查分頁控制 | 「上一頁」按鈕 disabled |
| F-AV-18 | 最後一頁時下一頁按鈕 disabled | 目前 page=5，總頁數=5 | 檢查分頁控制 | 「下一頁」按鈕 disabled |
| F-AV-19 | 分頁資訊顯示正確 | mock API 回傳 total=120, page=1, limit=50 | mount + await API response | 分頁控制顯示「第 1 頁 / 共 3 頁（120 筆）」 |
| F-AV-20 | 搜尋時保留日期範圍 | 已設定日期範圍 2025-08-01~2025-08-09 | 輸入搜尋 "nginx" | API 請求同時含 search 和 from/to 參數 |
| F-AV-21 | 匯出 CSV 按鈕點擊 | 頁面已載入 | click「匯出 CSV」按鈕 | 觸發瀏覽器下載（或呼叫 export API），Toast 顯示「稽核紀錄已匯出」 |
| F-AV-22 | 匯出 CSV 保留搜尋條件 | 搜尋框有 "nginx" | click「匯出 CSV」 | 下載的請求含 search=nginx 參數 |
| F-AV-23 | 匯出 CSV 保留日期條件 | 日期範圍已設定 | click「匯出 CSV」 | 下載的請求含 from/to 參數 |
| F-AV-24 | 匯出 CSV 失敗顯示錯誤 Toast | mock export API 回傳 500 | click「匯出 CSV」 | Toast 顯示「匯出失敗，請稍後再試」 |
| F-AV-25 | 時間欄位格式化 | mock 紀錄 timestamp="2025-08-09T14:30:00Z" | mount + await API response | 表格顯示「2025-08-09 14:30:00」 |
| F-AV-26 | target 為空時顯示 "-" | mock 紀錄 target=""（登入/登出） | mount + await API response | 目標欄位顯示「-」 |
| F-AV-27 | 搜尋結果計數顯示 | mock API 回傳 total=15（搜尋結果） | 輸入搜尋 "nginx" 並等待 | 顯示「找到 15 筆紀錄」 |

### 3.2 Header 導覽連結

| # | 測試名稱 | Given | When | Then |
|---|---------|-------|------|------|
| F-HD-01 | Header 顯示 Audit Log 連結 | 管理員已登入 | mount Header 元件 | 顯示「Audit Log」導覽連結 |
| F-HD-02 | 點擊 Audit Log 連結導航 | Header 已 render | click「Audit Log」連結 | router 導航至 /audit |
| F-HD-03 | 未登入時不顯示連結 | 使用者未登入 | mount Header 元件 | 不顯示「Audit Log」連結 |

---

## 4. 端對端測試（Playwright）

| # | 測試名稱 | 操作步驟 | 預期結果 |
|---|---------|---------|---------|
| E2E-01 | 進入 Audit Log 頁面 | 1. 登入系統<br>2. 點擊 Header「Audit Log」連結 | 1. 頁面導航至 /audit<br>2. 出現 loading spinner<br>3. 表格顯示最近 50 筆紀錄，依時間倒序 |
| E2E-02 | 無紀錄時顯示空狀態 | 1. 清空 audit.jsonl<br>2. 登入系統<br>3. 點擊「Audit Log」連結 | 表格顯示「尚無操作紀錄」空狀態 |
| E2E-03 | 瀏覽稽核紀錄表格 | 1. 登入系統<br>2. 進入 Audit Log 頁面 | 1. 表格顯示欄位：時間、使用者、IP、動作、目標、結果、詳細資訊<br>2. 成功紀錄綠色背景<br>3. 失敗紀錄紅色背景 |
| E2E-04 | 搜尋稽核紀錄 | 1. 進入 Audit Log 頁面<br>2. 在搜尋框輸入 "nginx"<br>3. 等待 300ms | 1. 表格更新為僅含 "nginx" 相關紀錄<br>2. 顯示「找到 N 筆紀錄」<br>3. 分頁重設為第 1 頁 |
| E2E-05 | 日期範圍篩選 | 1. 進入 Audit Log 頁面<br>2. 選擇日期範圍 2025-08-01 ~ 2025-08-09 | 1. 表格更新為該日期範圍內紀錄<br>2. 分頁重設為第 1 頁 |
| E2E-06 | 翻頁瀏覽 | 1. 進入 Audit Log 頁面（總頁數 > 1）<br>2. 點擊「下一頁」 | 1. 表格顯示第 2 頁紀錄<br>2. 分頁控制更新：頁碼 2、總頁數<br>3. 頁面捲回表格頂端 |
| E2E-07 | 匯出 CSV | 1. 進入 Audit Log 頁面<br>2. 點擊「匯出 CSV」 | 1. 瀏覽器下載 CSV 檔案<br>2. 檔名格式 audit-log-{date}.csv<br>3. Toast 顯示「稽核紀錄已匯出」 |
| E2E-08 | 匯出 CSV 保留過濾條件 | 1. 搜尋 "nginx"<br>2. 設定日期 2025-08-01 ~ 2025-08-09<br>3. 點擊「匯出 CSV」 | CSV 內容僅含符合搜尋和日期範圍的紀錄 |
| E2E-09 | 操作後 audit log 有記錄：重啟服務 | 1. 登入系統<br>2. 重啟 nginx 服務<br>3. 進入 Audit Log 頁面 | Audit Log 中出現一筆 action=restart, target=nginx.service, result=success 的紀錄 |
| E2E-10 | 操作後 audit log 有記錄：啟動服務 | 1. 登入系統<br>2. 啟動 apache2 服務<br>3. 進入 Audit Log 頁面 | Audit Log 中出現一筆 action=start, target=apache2.service, result=success 的紀錄 |
| E2E-11 | 操作後 audit log 有記錄：停止服務 | 1. 登入系統<br>2. 停止 nginx 服務<br>3. 進入 Audit Log 頁面 | Audit Log 中出現一筆 action=stop, target=nginx.service 的紀錄 |
| E2E-12 | 操作後 audit log 有記錄：enable 服務 | 1. 登入系統<br>2. enable apache2 服務<br>3. 進入 Audit Log 頁面 | Audit Log 中出現一筆 action=enable, target=apache2.service 的紀錄 |
| E2E-13 | 操作後 audit log 有記錄：disable 服務 | 1. 登入系統<br>2. disable apache2 服務<br>3. 進入 Audit Log 頁面 | Audit Log 中出現一筆 action=disable, target=apache2.service 的紀錄 |
| E2E-14 | 登入事件自動記錄 | 1. 登入系統<br>2. 進入 Audit Log 頁面 | Audit Log 中出現一筆 action=login, result=success 的紀錄 |
| E2E-15 | 登出事件自動記錄 | 1. 登入系統<br>2. 執行登出<br>3. 重新登入<br>4. 進入 Audit Log 頁面 | Audit Log 中出現一筆 action=logout, result=success 的紀錄 |
| E2E-16 | 操作失敗也記錄 | 1. 登入系統<br>2. 對不存在的服務執行 start<br>3. 進入 Audit Log 頁面 | Audit Log 中出現一筆 result=failure, detail 含錯誤訊息的紀錄 |
| E2E-17 | 搜尋無匹配結果 | 1. 進入 Audit Log 頁面<br>2. 搜尋 "xyz123nonexistent" | 1. 表格顯示「沒有符合條件的紀錄」<br>2. 顯示「清除過濾」連結<br>3. 點擊連結後恢復全部紀錄 |
| E2E-18 | API 錯誤顯示重試 | 1. 模擬 audit API 故障<br>2. 進入 Audit Log 頁面 | 1. 顯示錯誤訊息<br>2. 顯示「重試」按鈕<br>3. 點擊後重新嘗試載入 |
| E2E-19 | 搜尋 + 日期 + 翻頁組合 | 1. 搜尋 "nginx"<br>2. 設定日期範圍<br>3. 翻到第 2 頁 | 翻頁請求保留 search 和 from/to 參數 |

---

## 5. 手動驗證（真實環境）

| # | 情境 | 驗證步驟 | 預期 |
|---|------|---------|------|
| MAN-01 | CSV 匯出資料量超過 10,000 筆 | 1. 準備超過 10,000 筆 audit log<br>2. 進入 Audit Log 頁面<br>3. 點擊「匯出 CSV」 | 1. 檔案含最多 10,000 筆紀錄<br>2. Toast 顯示「已匯出最近 10,000 筆紀錄」 |
| MAN-02 | SSH 操作不記錄 | 1. 透過 Web UI 查看 nginx 狀態<br>2. SSH 進入伺服器，執行 systemctl stop nginx<br>3. 回到 Web UI 查看 Audit Log | 1. SSH 的 stop 操作不出現在 audit log<br>2. Web UI 的操作仍正常記錄 |
| MAN-03 | 超過 90 天紀錄自動清理 | 1. 手動在 audit.jsonl 中插入 timestamp 為 95 天前的紀錄<br>2. 觸發一次新操作（如 restart nginx）<br>3. 查看 audit.jsonl | 1. 95 天前的紀錄被移除<br>2. 新寫入的紀錄和 90 天內的紀錄保留 |
| MAN-04 | JSON Lines 檔案達 100MB | 1. 填充 audit.jsonl 至 100MB<br>2. 執行一次操作<br>3. 檢查後端 log | 1. 操作仍成功<br>2. audit log 仍寫入<br>3. 後端 log 出現 warning 提示檔案大小達上限 |
| MAN-05 | 磁碟滿時 audit log 寫入失敗 | 1. 模擬磁碟空間滿（或使用 tmpfs 設 quota）<br>2. 執行服務操作<br>3. 查看後端 log | 1. 服務操作仍成功（不因 audit log 失敗而中斷）<br>2. 後端 log 出現 audit 寫入 error |
| MAN-06 | 同時多個操作寫入 audit log | 1. 開啟兩個瀏覽器分頁<br>2. 分別對不同服務執行 restart<br>3. 進入 Audit Log 頁面 | 1. 兩筆操作都正確記錄在 audit.jsonl<br>2. 紀錄順序與實際操作時間一致<br>3. 無資料遺失或鎖定衝突 |
| MAN-07 | 真實 Linux 環境端到端 | 1. 在正式 Linux 伺服器部署<br>2. 執行完整操作流程（登入/多種服務操作/登出）<br>3. 驗證 Audit Log 頁面所有功能 | 1. 所有操作自動記錄<br>2. 搜尋/日期/分頁/匯出 全功能正常<br>3. 時間格式化正確、IP 正確擷取 |

---

## 6. 測試環境

| 項目 | 需求 |
|------|------|
| Go 版本 | 1.24.4+ |
| Node.js 版本 | 22+（前端開發） |
| 測試 OS | Linux（amd64），需有 systemd + journalctl |
| 瀏覽器（E2E） | Chromium（Playwright 預設） |
| 後端測試框架 | `go test`（標準庫 testing） |
| 前端單元測試框架 | Vitest 4.1 + @vue/test-utils 2.4 + happy-dom 20 |
| E2E 測試框架 | Playwright 1.62 |
| Audit 儲存路徑 | `/var/lib/linux-service-manager/audit.jsonl`（可於測試時覆蓋為 temp 路徑） |

---

## 7. 缺陷追蹤模板

| 欄位 | 說明 |
|------|------|
| ID | BUG-AUD-XXX |
| 測試案例 | 對應以上測試編號（SYS-XX / HDL-XX / F-XX / E2E-XX / MAN-XX） |
| 嚴重程度 | P0（阻擋發布）/ P1（主要功能異常）/ P2（次要問題） |
| 重啟步驟 | 逐步操作，含前置條件 |
| 預期 vs 實際 | 對照期望行為與實際行為 |
| 環境 | OS / Go 版本 / 瀏覽器 / 檔案系統狀態 |

---

## 8. 覆蓋率檢查

| BDD Scenario | 測試案例 ID | 層級 |
|---|---|---|
| 進入 Audit Log 頁面並載入紀錄 | E2E-01, F-AV-01, F-AV-02 | E2E + Frontend |
| 無任何操作紀錄時顯示空狀態 | E2E-02, F-AV-05 | E2E + Frontend |
| 瀏覽稽核紀錄表格 | E2E-03, F-AV-03, F-AV-04 | E2E + Frontend |
| 搜尋稽核紀錄 | E2E-04, F-AV-08~11 | E2E + Frontend |
| 日期範圍篩選 | E2E-05, F-AV-12, F-AV-13 | E2E + Frontend |
| 翻頁瀏覽稽核紀錄 | E2E-06, F-AV-14~19 | E2E + Frontend |
| 匯出 CSV | E2E-07, F-AV-21 | E2E + Frontend |
| 匯出 CSV 時保留過濾條件 | E2E-08, F-AV-22, F-AV-23 | E2E + Frontend |
| 服務操作成功後自動寫入 audit log | E2E-09, SYS-01 | E2E + Backend |
| 服務操作失敗後也寫入 audit log | E2E-16, SYS-02 | E2E + Backend |
| 登入成功時寫入 audit log | E2E-14 | E2E |
| 登出時寫入 audit log | E2E-15 | E2E |
| Scenario Outline: 各種服務操作皆自動記錄 | E2E-09~13 | E2E |
| 記錄欄位完整性 | SYS-05 | Backend |
| 不記錄敏感資訊 | SYS-06 | Backend |
| Audit log 儲存失敗不影響操作結果 | SYS-03, MAN-05 | Backend + Manual |
| 載入稽核頁面時 API 請求失敗 | F-AV-06, F-AV-07, E2E-18 | Frontend + E2E |
| 搜尋無匹配結果 | F-AV-10, F-AV-11, E2E-17 | Frontend + E2E |
| 未登入時存取稽核 API | HDL-06, HDL-07 | Backend |
| CSV 匯出資料量超過上限 | MAN-01, SYS-18 | Manual + Backend |
| 分頁請求超出範圍 | SYS-09 | Backend |
| 每頁筆數達上限 | SYS-10, SYS-11 | Backend |
| 僅記錄 Web UI / API 操作 | MAN-02 | Manual |
| 超過保留期限的紀錄自動清理 | MAN-03, SYS-20, SYS-21 | Manual + Backend |
| JSON Lines 檔案達 100MB 上限 | MAN-04, SYS-22 | Manual + Backend |

> **覆蓋率總結**：26 個 BDD Scenario 全部覆蓋，測試案例總數：Backend 37 個 + Frontend 30 個 + E2E 19 個 + Manual 7 個 = **93 個測試案例**。
