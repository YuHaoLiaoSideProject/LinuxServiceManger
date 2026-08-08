# journalctl 日誌檢視器 — 測試計畫

> **對應 BDD**：`docs/bdds/005-journalctl-log-viewer.feature`
> **操作流程**：`docs/interaction-flows/005-journalctl-log-viewer.md`
> **開發規格**：`docs/development/005-journalctl-log-viewer.md`
> **測試日期**：2025-08-08

---

## 1. 測試範圍總覽

| 層級 | 範圍 | 工具 | 負責 |
|------|------|------|------|
| 單元測試 | Go `GetServiceLogs` + handler | `go test` | 後端 |
| 單元測試 | Vue LogDrawer 元件邏輯 | Vitest + @vue/test-utils | 前端 |
| 整合測試 | API endpoint → journalctl | 手動 / 腳本 | 後端 |
| 端對端測試 | 完整使用者操作流程 | Playwright | 前端 |
| 手動驗證 | 真實 Linux 環境 + 權限情境 | 手動 | QA |

---

## 2. 後端單元測試

### 2.1 systemd 模組

| # | 測試名稱 | Given | When | Then |
|---|---------|-------|------|------|
| SYS-01 | 正常取得日誌 | 有效的服務名稱 `nginx.service`、lines=100 | 呼叫 `GetServiceLogs("nginx.service", 100)` | 回傳 `journalctl -u nginx.service -n 100 --no-pager -o short-iso` 的 stdout |
| SYS-02 | 服務名稱無效 | 無效名稱 `../../../etc/passwd` | 呼叫 `GetServiceLogs("../../../etc/passwd", 100)` | 回傳 error：`invalid service name` |
| SYS-03 | 服務名稱空字串 | name="" | 呼叫 `GetServiceLogs("", 100)` | 回傳 error |
| SYS-04 | lines 為 0 | lines=0 | 呼叫 `GetServiceLogs("nginx.service", 0)` | 回傳 error：`lines must be between 1 and 1000` |
| SYS-05 | lines 超出上限 | lines=1001 | 呼叫 `GetServiceLogs("nginx.service", 1001)` | 回傳 error |
| SYS-06 | lines 為負數 | lines=-1 | 呼叫 `GetServiceLogs("nginx.service", -1)` | 回傳 error（參數驗證） |
| SYS-07 | lines 等於上限 | lines=1000 | 呼叫 `GetServiceLogs("nginx.service", 1000)` | 正常執行 journalctl |
| SYS-08 | journalctl 不存在 | `exec.LookPath("journalctl")` 失敗 | 呼叫 `GetServiceLogs` | 回傳 error：`journalctl not found` |
| SYS-09 | journalctl 權限不足 | journalctl 回傳 permission denied | 呼叫 `GetServiceLogs` | 回傳 error：`permission denied` |
| SYS-10 | journalctl 逾時 | journalctl 執行超過 5 秒 | 呼叫 `GetServiceLogs` | context timeout → error：`timeout reading logs` |
| SYS-11 | 服務無日誌輸出 | journalctl 回傳空字串 | 呼叫 `GetServiceLogs` | 回傳空字串 `""`，無 error |

### 2.2 Handler 層

| # | 測試名稱 | Given | When | Then |
|---|---------|-------|------|------|
| HDL-01 | API 正常回應 | mock `GetServiceLogs` 回傳 "line1\nline2\n" | `GET /api/v1/services/nginx.service/logs?lines=100` | 200 OK, `{"content":"line1\nline2\n","lines":2}` |
| HDL-02 | 預設 lines | 未提供 lines 參數 | `GET /api/v1/services/nginx.service/logs` | 使用預設 lines=100 |
| HDL-03 | lines 參數格式錯誤 | lines=abc | `GET /api/v1/services/nginx.service/logs?lines=abc` | 400, `{"error":"lines must be between 1 and 1000"}` |
| HDL-04 | lines 超限 | lines=2000 | `GET /api/v1/services/nginx.service/logs?lines=2000` | 400 |
| HDL-05 | 服務名稱無效 | name=invalid | `GET /api/v1/services/invalid/logs` | 400 |
| HDL-06 | 權限不足 | mock 回傳 permission error | `GET /api/v1/services/nginx.service/logs` | 403, error 包含權限說明 |
| HDL-07 | journalctl 不存在 | mock 回傳 not found error | `GET /api/v1/services/nginx.service/logs` | 500（或自訂狀態碼） |
| HDL-08 | 逾時 | mock 回傳 timeout error | `GET /api/v1/services/nginx.service/logs` | 504 |
| HDL-09 | 無日誌 | mock 回傳空字串 | `GET /api/v1/services/empty.service/logs` | 200, `{"content":"","lines":0}` |
| HDL-10 | 未驗證請求 | 無 session cookie | `GET /api/v1/services/nginx.service/logs` | 401 Unauthorized |
| HDL-11 | Content-Type | 正常回應 | 檢查 response header | `application/json` |

---

## 3. 前端單元測試（Vitest）

### 3.1 LogDrawer 元件

| # | 測試名稱 | Given | When | Then |
|---|---------|-------|------|------|
| F-LD-01 | visible=false 時不渲染 | `visible=false` | mount LogDrawer | DOM 中無 drawer 元素 |
| F-LD-02 | visible=true 時渲染 | `visible=true`, `serviceName="nginx"` | mount LogDrawer | Drawer 存在，標題含 "nginx" |
| F-LD-03 | 載入中顯示 spinner | `visible=true`, API 未 mock（pending） | mount LogDrawer | 顯示 loading spinner |
| F-LD-04 | API 成功後顯示日誌 | mock API 回傳內容 | mount + await fetchLogs | `<pre>` 區塊顯示日誌文字 |
| F-LD-05 | API 失敗顯示錯誤 | mock API reject | mount + await fetchLogs | 顯示錯誤訊息 + 重試按鈕 |
| F-LD-06 | 無日誌顯示空狀態 | mock API 回傳空 content | mount + await fetchLogs | 顯示「此服務尚無日誌記錄」 |
| F-LD-07 | 行數選擇器切換 50 | 初始 lineCount=100 | 選擇 50 | lineCount→50，觸發 API 呼叫 lines=50 |
| F-LD-08 | 行數選擇器切換 500 | 初始 lineCount=100 | 選擇 500 | lineCount→500，觸發 API 呼叫 lines=500 |
| F-LD-09 | 自動刷新 ON | autoRefresh=false | toggle ON | setInterval 被建立（可用 vi.useFakeTimers） |
| F-LD-10 | 自動刷新 OFF | autoRefresh=true | toggle OFF | clearInterval 被呼叫 |
| F-LD-11 | 自動刷新觸發 API | autoRefresh=true, vi.advanceTimersByTime(3000) | 等待 3 秒 | API 被再次呼叫 |
| F-LD-12 | 搜尋 highlight | logContent="error\ninfo\nerror2", searchQuery="error" | 輸入搜尋 | 兩行有 `highlight` class，一行 `dim` |
| F-LD-13 | 搜尋計數顯示 | searchQuery="error", 匹配 2 行 | 檢查 UI | 顯示「2 / 3 行」 |
| F-LD-14 | 清空搜尋恢復顯示 | searchQuery="error"→清空 | 清空搜尋框 | 全部行正常顯示，無 highlight/dim |
| F-LD-15 | 點擊 ✕ 關閉 | Drawer 開啟 | click ✕ 按鈕 | emit `close` 事件 |
| F-LD-16 | 點擊遮罩關閉 | Drawer 開啟 | click overlay | emit `close` 事件 |
| F-LD-17 | Esc 鍵關閉 | Drawer 開啟 | keyboard `Escape` | emit `close` 事件 |
| F-LD-18 | 關閉時停止自動刷新 | autoRefresh=true | emit close / Esc | clearInterval 被呼叫 |
| F-LD-19 | 連續失敗 5 次關閉刷新 | autoRefresh=true, API 連續 fail×5 | 5 次輪詢後 | autoRefresh→false，顯示警告 |
| F-LD-20 | 自動刷新失敗顯示警告 | autoRefresh=true, API fail×1 | 第一次失敗 | 控制列顯示「自動刷新失敗，10 秒後重試」 |
| F-LD-21 | serviceName 變更重新載入 | visible=true, serviceName 從 A 變 B | watch 觸發 | 重新呼叫 API 取得 B 的日誌 |
| F-LD-22 | 載入時 Logs 按鈕 disabled | Drawer 正在 loading | 檢查按鈕狀態 | 對應服務的 Logs 按鈕 disabled |
| F-LD-23 | 點擊錯誤重試按鈕 | error 狀態顯示 | click 重試 | 重新呼叫 fetchLogs |

### 3.2 ServiceRow 元件（修改部分）

| # | 測試名稱 | Given | When | Then |
|---|---------|-------|------|------|
| F-SR-01 | 所有服務皆有 Logs 按鈕 | 服務 locked=false | render ServiceRow | 「📋 Logs」按鈕存在 |
| F-SR-02 | 鎖定服務仍有 Logs 按鈕 | 服務 locked=true | render ServiceRow | 「📋 Logs」按鈕存在 |
| F-SR-03 | 點擊 Logs emit open-logs | service.name="nginx" | click Logs | emit "open-logs" with "nginx" |

---

## 4. 端對端測試（Playwright）

| # | 測試名稱 | 操作步驟 | 預期結果 |
|---|---------|---------|---------|
| E2E-01 | 完整 Happy Path | 1. 登入 Dashboard<br>2. 點擊服務的 📋 Logs<br>3. Drawer 滑入<br>4. 日誌內容顯示<br>5. 切換行數至 200<br>6. 輸入搜尋關鍵字<br>7. 清除搜尋<br>8. 點 ✕ 關閉 | 每步皆符合預期，Drawer 關閉後 Dashboard 恢復 |
| E2E-02 | 遮罩點擊關閉 | 1. 開啟 Drawer<br>2. 點擊遮罩區域 | Drawer 關閉 |
| E2E-03 | Esc 鍵關閉 | 1. 開啟 Drawer<br>2. 按下 Escape | Drawer 關閉 |
| E2E-04 | 切換服務 | 1. 開啟服務 A 的 Drawer<br>2. 點擊服務 B 的 Logs 按鈕 | Drawer 內容更新為服務 B 日誌，標題也更新 |
| E2E-05 | 自動刷新 | 1. 開啟 Drawer<br>2. 開啟自動刷新<br>3. 等待 > 3 秒<br>4. 檢查日誌有無更新 | 若後端有新日誌，前端自動顯示新行 |
| E2E-06 | 行動裝置全螢幕 | 1. 設定 viewport 375×812<br>2. 開啟 Drawer | Drawer 寬度 100vw |
| E2E-07 | 深色模式 | 1. 切換深色模式<br>2. 開啟 Drawer | Drawer 樣式與深色主題一致 |
| E2E-08 | 鍵盤焦點困於 Drawer | 1. 開啟 Drawer<br>2. Tab 到最後一個可聚焦元素<br>3. 再 Tab | 焦點回到 Drawer 第一個可聚焦元素 |
| E2E-09 | Drawer 開啟中無法與背景互動 | 1. 開啟 Drawer<br>2. 嘗試點擊 Dashboard 按鈕 | 遮罩阻擋，無法點擊背景 |

---

## 5. 手動驗證（真實 Linux 環境）

| # | 情境 | 驗證步驟 | 預期 |
|---|------|---------|------|
| MAN-01 | 查看真實服務日誌 | 在已部屬環境開啟 nginx/ssh 等服務的 Logs | 正常顯示日誌內容 |
| MAN-02 | 無日誌的服務 | 建立一個從未啟動的 test.service | 顯示「此服務尚無日誌記錄」 |
| MAN-03 | 權限不足 | 用非 systemd-journal 群組的使用者執行 | 顯示權限不足錯誤 |
| MAN-04 | 日誌內容很多 | 查看日誌量極大（> 10000 行）的服務 | 僅載入指定行數，5 秒內完成 |
| MAN-05 | 快速切換服務 | 連續點擊多個不同服務的 Logs | 無閃爍、無記憶體洩漏、無殘留內容 |
| MAN-06 | 長時間自動刷新 | 開啟自動刷新，保持 10 分鐘 | 無記憶體持續成長、頁面不卡頓 |

---

## 6. 測試環境

| 項目 | 需求 |
|------|------|
| Go 版本 | 1.24+ |
| Node.js | 22.x |
| 測試 Linux | Ubuntu 22.04+ / Debian 12+（具備 systemd + journalctl） |
| 瀏覽器 | Chromium（Playwright）、Firefox、Safari（手動） |

---

## 7. 缺陷追蹤模板

| 欄位 | 說明 |
|------|------|
| ID | BUG-LOG-XXX |
| 測試案例 | 對應以上測試編號 |
| 嚴重程度 | P0(阻擋) / P1(主要) / P2(次要) |
| 重現步驟 | 逐步操作 |
| 預期 vs 實際 | 對照 |
| 環境 | OS / Browser / 服務名稱 |

---

*最後更新：2025-08-08*
