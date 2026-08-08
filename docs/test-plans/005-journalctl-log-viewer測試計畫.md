# journalctl 日誌檢視器 — 測試計畫

> **對應 BDD**：`docs/bdds/005-journalctl-log-viewer.feature`
> **操作流程**：`docs/interaction-flows/005-journalctl-log-viewer.md`
> **開發規格**：`docs/development/005-journalctl-log-viewer.md`
> **測試日期**：2026-08-08

---

## 1. 測試範圍總覽

| 層級 | 範圍 | 工具 | 負責 |
|------|------|------|------|
| 單元測試 | Go `GetServiceLogs` + handler | `go test` | 後端 |
| 單元測試 | Vue LogDrawer 元件邏輯 | Vitest + @vue/test-utils | 前端 |
| 整合測試 | WebSocket endpoint → journalctl -f | 手動 / 腳本 | 後端 |
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

### 2.2 Handler 層（WebSocket）

| # | 測試名稱 | Given | When | Then |
|---|---------|-------|------|------|
| HDL-WS-01 | WebSocket upgrade 成功 | 已驗證 client, 有效 service name, lines=100 | `GET /ws/v1/services/nginx.service/logs?lines=100` 含 Upgrade header | HTTP 101 Switching Protocols, WebSocket 連線建立 |
| HDL-WS-02 | WebSocket 收到 journalctl 輸出行 | WebSocket 連線已建立, mock journalctl stdout pipe 寫入 "line1\nline2\n" | 讀取 WS TextMessage | 收到 "line1", "line2" 兩條訊息 |
| HDL-WS-03 | WebSocket client 關閉 → journalctl process killed | WebSocket 連線已建立, journalctl 正在執行 | client 關閉 WebSocket | context cancel 觸發, journalctl process 收到 SIGTERM |
| HDL-WS-04 | 未驗證請求 | 無 session cookie | `GET /ws/v1/services/nginx.service/logs` 含 Upgrade header | 401 Unauthorized（在 WebSocket upgrade 前攔截） |
| HDL-WS-05 | journalctl 權限不足 | journalctl 回傳 permission denied | WebSocket 連線建立後, journalctl stderr 寫入 "permission denied" | WebSocket 收到錯誤訊息後關閉 |
| HDL-WS-06 | journalctl 不存在 | `exec.LookPath("journalctl")` 失敗 | WebSocket upgrade 請求 | WebSocket 收到錯誤訊息 "journalctl not found" 後關閉 |
| HDL-WS-07 | journalctl process crash | journalctl process 意外終止 (exit code ≠ 0) | WebSocket 連線進行中 | WebSocket 收到 "journalctl process exited with code 1" 後關閉 |
| HDL-WS-08 | lines 參數格式錯誤 | lines=abc | `GET /ws/v1/services/nginx.service/logs?lines=abc` | WebSocket upgrade 前即回傳 400, `{"error":"lines must be between 1 and 1000"}` |
| HDL-WS-09 | lines 超限 | lines=2000 | `GET /ws/v1/services/nginx.service/logs?lines=2000` | WebSocket upgrade 前即回傳 400 |
| HDL-WS-10 | 服務名稱無效 | name=invalid | `GET /ws/v1/services/invalid/logs` | WebSocket upgrade 前即回傳 400 |

---

## 3. 前端單元測試（Vitest）

### 3.1 LogDrawer 元件

| # | 測試名稱 | Given | When | Then |
|---|---------|-------|------|------|
| F-LD-01 | visible=false 時不渲染 | `visible=false` | mount LogDrawer | DOM 中無 drawer 元素 |
| F-LD-02 | visible=true 時渲染 | `visible=true`, `serviceName="nginx"` | mount LogDrawer | Drawer 存在，標題含 "nginx" |
| F-LD-03 | 載入中顯示 spinner | `visible=true`, WebSocket 連線中（pending） | mount LogDrawer | 顯示 loading spinner |
| F-LD-04 | WebSocket 連線成功後顯示日誌 | mock WebSocket, 傳送 TextMessage "line1\nline2" | mount + connectWebSocket | `<pre>` 區塊顯示日誌文字 |
| F-LD-05 | WebSocket 連線失敗顯示錯誤 | mock WebSocket onError | mount + connectWebSocket | 顯示錯誤訊息 + 重試按鈕 |
| F-LD-06 | 無日誌顯示空狀態 | mock WebSocket 傳送空內容後關閉 | mount + connectWebSocket | 顯示「此服務尚無日誌記錄」 |
| F-LD-07 | 行數選擇器切換 50 | 初始 lineCount=100 | 選擇 50 | lineCount→50，關閉舊 WS + 建立新 WS (lines=50) |
| F-LD-08 | 行數選擇器切換 500 | 初始 lineCount=100 | 選擇 500 | lineCount→500，關閉舊 WS + 建立新 WS (lines=500) |
| F-LD-09 | WebSocket onopen → 連線指示器 | WebSocket 連線成功 | onopen 觸發 | isConnected=true, 連線指示器顯示 "● LIVE" |
| F-LD-10 | WebSocket onMessage → 自動追加新行 | WebSocket 已連線, logContent 已有 3 行 | 收到 TextMessage "new log line" | logContent 自動 append 第 4 行 |
| F-LD-11 | WebSocket onClose (非主動關閉) → 自動重連 | WebSocket 非預期關閉 (非 client 主動 close) | onClose 觸發, code ≠ 1000 | 1 秒後自動呼叫 connectWebSocket 重連 |
| F-LD-12 | WebSocket onError → 顯示錯誤 + 手動重連 | WebSocket 發生錯誤 | onError 觸發 | 顯示錯誤訊息 + 手動重連按鈕 |
| F-LD-13 | 手動重連按鈕 → 重新連線 | WebSocket 斷線, 顯示重連按鈕 | click 重連按鈕 | 重新呼叫 connectWebSocket |
| F-LD-14 | 服務名稱變更 → 重建 WebSocket | visible=true, serviceName 從 A 變 B | watch 觸發 | 關閉舊 WebSocket + 建立新 WebSocket (service B) |
| F-LD-15 | 搜尋 highlight | logContent="error\ninfo\nerror2", searchQuery="error" | 輸入搜尋 | 兩行有 `highlight` class，一行 `dim` |
| F-LD-16 | 搜尋計數顯示 | searchQuery="error", 匹配 2 行 | 檢查 UI | 顯示「2 / 3 行」 |
| F-LD-17 | 清空搜尋恢復顯示 | searchQuery="error"→清空 | 清空搜尋框 | 全部行正常顯示，無 highlight/dim |
| F-LD-18 | 點擊 ✕ 關閉 | Drawer 開啟 | click ✕ 按鈕 | emit `close` 事件 |
| F-LD-19 | 點擊遮罩關閉 | Drawer 開啟 | click overlay | emit `close` 事件 |
| F-LD-20 | Esc 鍵關閉 | Drawer 開啟 | keyboard `Escape` | emit `close` 事件 |
| F-LD-21 | 關閉 Drawer 時 WebSocket 關閉 | WebSocket 已連線 | emit close / Esc / click ✕ | ws.close() 被呼叫 |
| F-LD-22 | unmount 時 WebSocket 關閉 | WebSocket 已連線 | component unmount (onUnmounted) | ws.close() 被呼叫, 清除 pending 重連 timer |
| F-LD-23 | 載入時 Logs 按鈕 disabled | Drawer 正在連線 WebSocket | 檢查按鈕狀態 | 對應服務的 Logs 按鈕 disabled |
| F-LD-24 | 點擊錯誤重試按鈕 | error 狀態顯示 | click 重試 | 重新呼叫 connectWebSocket |

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
| E2E-05 | 即時串流 (WebSocket streaming) | 1. 開啟 Drawer<br>2. 確認連線指示器顯示 "● LIVE"<br>3. 在伺服器端觸發新日誌 (如 `logger -t nginx test`)<br>4. 檢查前端日誌 | 前端即時自動顯示新行，無需手動刷新 |
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
| MAN-06 | 長時間即時串流 | WebSocket 保持連線，持續串流 10 分鐘 | 無記憶體持續成長、頁面不卡頓 |

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

*最後更新：2026-08-08*
