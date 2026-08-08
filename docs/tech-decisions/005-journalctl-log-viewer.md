# 開發方案決策文件：journalctl 日誌檢視器

## 📌 版本歷程

| 版本 | 日期 | 方案 | 狀態 |
|------|------|------|:---:|
| v1 | 2025-08-08 | 方案 A：HTTP Polling | ❌ 已廢棄 |
| **v2** | **2026-08-08** | **方案 B：WebSocket + journalctl -f** | ✅ **採用** |

> **修訂原因**：重新評估後認為 WebSocket 方案前端更簡潔、維護成本更低。詳見下方 v2 完整決策。

---

# v2：WebSocket + journalctl -f（最終採用）

## 📌 決策摘要

| 項目 | 內容 |
|------|------|
| **最終方案** | Go WebSocket + `journalctl -f` 串流 + Vue 3 自訂 Drawer 元件 |
| **決策日期** | 2026-08-08 |
| **對應 Roadmap** | Phase 1 — `docs/development/002-expansion-roadmap.md` |
| **輸入文件** | `docs/bdds/005-journalctl-log-viewer.feature`、`docs/interaction-flows/005-journalctl-log-viewer.md`、`docs/development/005-journalctl-log-viewer.md`、`docs/test-plans/005-journalctl-log-viewer測試計畫.md` |
| **開發方法** | TDD（測試驅動開發），按 Priority 拆分 |
| **共識程度** | ✅ 重新評估後一致通過 |

---

## 1. 需求回顧

| 項目 | 內容 |
|------|------|
| **核心價值** | 管理員在 Web UI 直接查看 systemd 日誌，不需 SSH 進機器 |
| **角色** | 已登入的管理員 |
| **觸發入口** | Dashboard 服務列表 → 每列 Actions 區塊的「📋 Logs」按鈕 |
| **主要互動** | 右側 Drawer 顯示日誌、可調整行數（50/100/200/500）、自動刷新（即時串流）、客戶端文字搜尋 |
| **邊界限制** | 行數上限 1000、僅支援最近 N 行（無時間範圍篩選）、同一時間僅一個 Drawer |
| **異常情境** | 無日誌、無 journalctl、權限不足、連線中斷重連、journalctl process crash |

---

## 2. 候選方案（重新評估）

### 方案 A：exec + HTTP Polling + 自訂 Drawer（v1，已廢棄）

| 項目 | 內容 |
|------|------|
| **後端** | `exec.Command("journalctl", "-u", name, "-n", lines, "--no-pager", "-o", "short-iso")` 每次 HTTP 請求執行一次 |
| **自動刷新** | 前端 `setInterval` 每 3 秒 GET poll + 新舊內容 diff |
| **前端複雜度** | 高：timer 管理、diff 邏輯、失敗計數器、連續失敗關閉邏輯 |
| **優點** | 無新依賴、stateless、HTTP handler 測試簡單 |
| **缺點** | 前端狀態多（timer id、失敗計數、新舊行比較）、最多 3s 延遲 |

### 🏆 方案 B：WebSocket + journalctl -f + 自訂 Drawer（v2，本次採用）

| 項目 | 內容 |
|------|------|
| **後端** | WebSocket endpoint + `exec.Command("journalctl", "-u", name, "-n", lines, "-f", "--no-pager", "-o", "short-iso")` 持續 pipe stdout |
| **自動刷新** | journalctl -f 原生串流，後端 pipe 到 WebSocket，前端 onMessage 直接 append |
| **前端複雜度** | 低：只需 WebSocket onMessage → append、onClose → 重連 |
| **優點** | 前端邏輯極簡（無 timer/diff/失敗計數）、近乎即時、journalctl -f 是 systemd 原生能力 |
| **缺點** | 需新增 `gorilla/websocket` 依賴、需管理 journalctl process 生命週期 |

### 方案 C：D-Bus + UI Library Drawer（重型方案）

與 v1 決策相同，不重複評估。D-Bus 無標準日誌讀取 API，且引入 UI library 違反最小依賴原則。

---

## 3. 權衡評估（方案 A vs B 最終比較）

| 維度 | 方案 A（Polling） | 🏆 方案 B（WebSocket） |
|------|:---:|:---:|
| 🎯 需求符合度 | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| ⚡ 開發速度 | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| 🔧 維護成本 | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| 📈 擴充性 | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| 👥 前端複雜度 | ⭐⭐ | ⭐⭐⭐⭐⭐ |
| 💰 依賴成本 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| 🔒 穩定性 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ |

### 關鍵取捨

**取捨 #1：前端複雜度 vs 後端複雜度**

| | 方案 A | 方案 B |
|------|------|------|
| 前端需要管理的狀態 | 5+ 個（timer、失敗計數、新舊內容、lineCount 觸發重取、diff 邏輯） | 2 個（WebSocket 實例、連線狀態） |
| 後端需要管理的狀態 | 0（stateless HTTP） | 1 個（journalctl process + WebSocket conn） |

→ **前端簡化 > 後端簡化**。本專案前後端是同一個 developer 維護，但前端狀態複雜度的降低對長期維護價值更高。WebSocket 連線管理是成熟的 pattern，gorilla/websocket 提供完整的連線生命週期 API。

**取捨 #2：即時性 vs 依賴**

| | 方案 A | 方案 B |
|------|------|------|
| 延遲 | 最多 3 秒 | < 100ms（journalctl -f 原生串流） |
| 新依賴 | 0 | 1（gorilla/websocket） |

→ **新增一個成熟依賴，換取前端大幅簡化 + 即時性提升，值得。** gorilla/websocket 是 Go 生態系中最成熟的 WebSocket library（18k+ stars），且專案已使用 gorilla/sessions 和 gorilla/securecookie，同一生態系。

**取捨 #3：journalctl -f 的可靠性**

→ `journalctl -f` 是 systemd 官方提供的 follow mode，設計用於類似 `tail -f` 的場景。穩定性由 systemd 團隊保證。唯一的風險是 process crash（journalctl 本身崩潰），可透過 WebSocket onClose 重連來處理。

---

## 4. 決策理由

### 🏆 選擇方案 B：WebSocket + journalctl -f + 自訂 Drawer

**三個關鍵原因**：

1. **前端程式碼量減少 ~40%** — 不需要 `setInterval`、`clearInterval`、失敗計數器、新舊內容 diff 邏輯、連續失敗關閉邏輯。只需 WebSocket onMessage append。
2. **即時性提升 30 倍** — 3 秒延遲 → < 100ms，對操作者監看日誌的體驗提升顯著。
3. **journalctl -f 是正確的抽象** — 與其自己實作 polling + diff（本質上是重新發明 journalctl -f），不如直接使用 systemd 原生能力。後端 maintenance 只需確保 journalctl process 與 WebSocket 連線生命週期一致。

### 為什麼放棄方案 A

- **方案 A（HTTP Polling）**：前端狀態管理過於複雜。timer 管理、diff 邏輯、失敗計數都是容易出 bug 的地方。而且「每次取全量再 diff」的效能比 journalctl -f 原生的增量輸出更差。

### 為什麼放棄方案 C

- 同 v1 決策：D-Bus 無標準日誌讀取 API；引入 UI library 違反最小依賴原則。

---

## 5. TDD 行動計畫

### 5.1 開發方法：Test-Driven Development（測試驅動開發）

```
RED  →  GREEN  →  REFACTOR
寫測試 → 最小實作 → 重構
```

### 5.2 技術棧

| 層級 | 技術 | 版本 | 用途 |
|------|------|------|------|
| 後端 API | Go 1.24 + chi v5 | 1.24.4 | REST API + WebSocket endpoint |
| WebSocket | gorilla/websocket | latest | WebSocket upgrade + message read/write |
| 日誌讀取 | `exec.Command("journalctl", "-f", ...)` | systemd | 與現有 systemctl pattern 一致 |
| 前端框架 | Vue 3.5 + TypeScript | 3.5.40 | Composition API |
| HTTP 客戶端 | Axios（已安裝） | 1.19.0 | GET 日誌 API（備用） |
| 動畫 | CSS transition | — | Drawer 滑入/滑出（約 200ms） |
| 後端測試 | `go test` + testify mock | — | 單元 + 整合測試 |
| 前端測試 | Vitest + @vue/test-utils | 4.1.10 | 元件單元測試 |
| E2E 測試 | Playwright | 1.62.1 | 完整使用者流程 |

### 5.3 架構變更點

```
現有架構                          方案 B 新增部分
┌──────────┐   ┌──────────┐     ┌─────────────────────────────┐
│  Vue SPA │──▶│ Go chi   │     │  WebSocket endpoint          │
│  (靜態)  │   │ API      │     │  /api/v1/services/{name}     │
└──────────┘   └────┬─────┘     │  /logs/ws?lines=100          │
                    │           └────────────┬────────────────┘
              ┌─────▼─────┐                  │
              │ systemctl │           gorilla/websocket
              │ (dbus)    │           Upgrader
              └───────────┘                  │
                                    ┌────────▼────────┐
                                    │ journalctl -f    │
                                    │ -u {name}        │
                                    │ -n {lines}       │
                                    │ -o short-iso     │
                                    │ --no-pager       │
                                    └────────┬────────┘
                                             │ stdout pipe
                                    ┌────────▼────────┐
                                    │ WebSocket        │
                                    │ TextMessage      │
                                    │ (逐行推送)        │
                                    └──────────────────┘
```

### 5.4 WebSocket 協定設計

```
Client → Server:  GET /api/v1/services/{name}/logs/ws?lines=100
                  Upgrade: websocket

Server → Client:  TextMessage (每行日誌)
                  "Aug 08 12:34:56 hostname nginx[1234]: 127.0.0.1 - GET /index.html 200"

關閉語意:
- Client 主動關閉 → Server kill journalctl process
- journalctl process crash → Server 發送 CloseMessage → Client 可重連
- idle timeout: 無（日誌可能長時間無輸出，不設 timeout）
```

### 5.5 TDD 實作順序：按 Priority 拆分

---

#### 🔴 P0：核心 Happy Path（目標：可開啟 Drawer 看到日誌）

**後端 TDD（先寫測試，確認失敗）→ 實作 → 重構**

| # | 測試（先寫） | 對應實作 |
|---|-------------|---------|
| SYS-01 | `GetServiceLogs` 正常回傳（不含 -f 的基礎版） | `systemd.go` 新增 `GetServiceLogs(name, lines)` |
| SYS-02 | 無效服務名稱 → error | `ValidateServiceName` 複用 |
| SYS-03 | lines 超出範圍 → error | 參數驗證 |
| SYS-04 | journalctl 不存在 → error | `exec.LookPath` 檢查 |
| SYS-05 | 權限不足 → error | stderr parsing |
| HDL-WS-01 | WebSocket upgrade 成功 | `json_handler.go` 新增 `HandleServiceLogsWS` |
| HDL-WS-02 | WebSocket 收到 journalctl 輸出行 | mock journalctl stdout pipe |
| HDL-WS-03 | WebSocket client 關閉 → journalctl process killed | process 生命週期測試 |
| HDL-WS-04 | 未驗證請求 → 401 | AuthMiddleware 複用 |

**前端 TDD（先寫測試，確認失敗）→ 實作 → 重構**

| # | 測試（先寫） | 對應實作 |
|---|-------------|---------|
| F-LD-01 | `visible=false` 不渲染 | `LogDrawer.vue` 基礎結構 |
| F-LD-02 | `visible=true` 渲染 Drawer + 標題 | Props 綁定 |
| F-LD-03 | 連線中顯示 loading | WebSocket CONNECTING 狀態 |
| F-LD-04 | WebSocket onMessage → 日誌顯示 | `<pre>` 區塊 + 等寬字體 |
| F-LD-05 | 日誌自動捲動到底部 | `scrollTop = scrollHeight` |
| F-LD-06 | 點擊 ✕ 關閉 → emit close + WebSocket 關閉 | 關閉邏輯 |
| F-LD-07 | 點擊遮罩關閉 | overlay click |
| F-LD-08 | Esc 鍵關閉 | keyboard event |
| F-LD-09 | 無日誌空狀態 | 無內容 display |
| F-LD-10 | 行數選擇器四檔可選（50/100/200/500） | `<select>` 綁定 |
| F-LD-11 | 行數切換 → 關閉舊 WS + 開啟新 WS | watch lineCount |
| F-SR-01 | 所有服務皆有 Logs 按鈕 | `ServiceRow.vue` 新增按鈕 |
| F-SR-02 | 鎖定服務仍有 Logs 按鈕 | locked 不影響 |
| F-SR-03 | 點擊 Logs → emit open-logs | emit 事件 |

**E2E（P0 完成後執行）**

| # | 測試 |
|---|------|
| E2E-01 | 登入 → 點 Logs → Drawer 滑入 → 看到日誌 → 切換行數 → ✕ 關閉 |
| E2E-02 | 遮罩點擊關閉 Drawer |
| E2E-03 | Esc 鍵關閉 Drawer |

**P0 交付物**：✅ 可開啟 Drawer、看到日誌、切換行數、三種關閉方式

---

#### 🟡 P1：自動刷新（即時串流）+ 搜尋 + 錯誤處理

**後端 TDD**

| # | 測試（先寫） | 對應實作 |
|---|-------------|---------|
| SYS-06 | journalctl -f 持續輸出 → WebSocket 持續推送 | follow mode 驗證 |
| SYS-07 | journalctl process crash → WebSocket close | stderr 處理 |
| HDL-WS-05 | WebSocket 斷線時 cleanup journalctl | defer cancel |

**前端 TDD**

| # | 測試（先寫） | 對應實作 |
|---|-------------|---------|
| F-LD-12 | WebSocket onMessage 自動追加新行 | append logic |
| F-LD-13 | WebSocket onClose → 自動重連 | reconnection |
| F-LD-14 | 連線失敗顯示錯誤 + 重試按鈕 | error state |
| F-LD-15 | 搜尋 highlight 匹配行 | computed filteredLines |
| F-LD-16 | 搜尋匹配計數 | matchCount display |
| F-LD-17 | 清空搜尋恢復顯示 | reset |
| F-LD-18 | journalctl 不存在錯誤 | error UI |
| F-LD-19 | 權限不足錯誤 | error UI |
| F-LD-20 | 點擊另一服務 Logs → 切換 | switch-service |

**E2E（P1 完成後執行）**

| # | 測試 |
|---|------|
| E2E-04 | 切換服務（Drawer 內容更新） |
| E2E-05 | 即時串流（後端有新日誌 → 前端自動顯示） |
| E2E-06 | 搜尋 highlight + 計數 |

**P1 交付物**：✅ 即時串流、搜尋、完整錯誤處理、服務切換

---

#### 🟢 P2：RWD + 邊界情況 + 無障礙

**前端 TDD**

| # | 測試（先寫） | 對應實作 |
|---|-------------|---------|
| F-LD-21 | 行動裝置 Drawer 全螢幕 | RWD CSS |
| F-LD-22 | 關閉時停止串流 | cleanup |
| F-LD-23 | focus trap（Tab 困在 Drawer 內） | keydown handler |

**E2E（P2 完成後執行）**

| # | 測試 |
|---|------|
| E2E-07 | 行動裝置全螢幕 |
| E2E-08 | focus trap |
| E2E-09 | Drawer 開啟中無法與背景互動 |

**P2 交付物**：✅ RWD、無障礙、最終交付

---

### 5.6 檔案變更清單

| 檔案 | 操作 | 說明 |
|------|------|------|
| `src/internal/systemd/systemd.go` | 修改 | `ServiceManager` interface 新增 `GetServiceLogs(name, lines) (string, error)` |
| `src/internal/systemd/systemd.go` | 新增 | `GetServiceLogs()` 實作：exec `journalctl -u {name} -n {lines} --no-pager -o short-iso` |
| `src/internal/handler/json_handler.go` | 新增 | `HandleServiceLogsWS` WebSocket handler + `logWSUpgrader` |
| `src/main.go` | 修改 | 新增 WebSocket 路由 `GET /api/v1/services/{name}/logs/ws` |
| `src/internal/handler/handler_test.go` | 新增 | WebSocket handler 測試（mock journalctl stdout pipe） |
| `src/internal/systemd/systemd_test.go` | 新增 | `GetServiceLogs` 單元測試 |
| `frontend/src/components/LogDrawer.vue` | **新增** | Drawer 元件（Teleport + CSS transition + WebSocket client + 搜尋 + RWD） |
| `frontend/src/components/ServiceRow.vue` | 修改 | Actions 區塊新增「📋 Logs」按鈕，emit `open-logs` 事件 |
| `frontend/src/views/DashboardView.vue` | 修改 | 掛載 `<LogDrawer>`、管理開啟/關閉狀態、傳遞 serviceName |
| `frontend/src/types/service.ts` | 修改 | 新增 `LogDrawerState` interface |
| `frontend/src/__tests__/LogDrawer.spec.ts` | **新增** | LogDrawer 23 個測試案例 |
| `frontend/src/__tests__/ServiceRow.spec.ts` | 修改 | 新增 Logs 按鈕相關測試 |
| `src/go.mod` | 修改 | 新增 `github.com/gorilla/websocket` dependency |
| `e2e/` | 新增 | Playwright E2E 測試（9 個案例） |

### 5.7 初期任務（按 Priority）

| 優先級 | 任務 | 檔案 | 預估工時 | TDD 循環 |
|--------|------|------|---------|---------|
| **P0** | 後端 TDD：`GetServiceLogs` 測試 + 實作 | `systemd.go`, `systemd_test.go` | 1.5h | RED→GREEN→REFACTOR |
| **P0** | 後端 TDD：WebSocket handler 測試 + 實作 | `json_handler.go`, `handler_test.go` | 2h | RED→GREEN→REFACTOR |
| **P0** | 後端：WebSocket 路由註冊 | `main.go` | 0.5h | — |
| **P0** | go mod tidy（新增 gorilla/websocket） | `go.mod` | 0.25h | — |
| **P0** | 前端 TDD：LogDrawer 基礎（open/close/loading/display） | `LogDrawer.vue`, `__tests__/LogDrawer.spec.ts` | 3h | RED→GREEN→REFACTOR |
| **P0** | 前端 TDD：行數選擇器 + Logs 按鈕 | 同上 + `ServiceRow.vue` | 1.5h | RED→GREEN→REFACTOR |
| **P0** | 前端：DashboardView 整合 | `DashboardView.vue` | 1h | — |
| **P0** | E2E：P0 Happy Path 測試 | `e2e/` | 1.5h | — |
| **P1** | 前端 TDD：WebSocket 串流 + 重連 + 錯誤處理 | `LogDrawer.vue`, tests | 3h | RED→GREEN→REFACTOR |
| **P1** | 前端 TDD：搜尋 highlight + 計數 | 同上 | 1.5h | RED→GREEN→REFACTOR |
| **P1** | 前端：服務切換邏輯 | `LogDrawer.vue` + `DashboardView.vue` | 1h | — |
| **P1** | E2E：P1 測試 | `e2e/` | 1h | — |
| **P2** | 前端 TDD：RWD + focus trap | `LogDrawer.vue`, tests | 1.5h | RED→GREEN→REFACTOR |
| **P2** | E2E：P2 補完 | `e2e/` | 0.5h | — |

**總工時**：約 3 天（P0: 1.5 天、P1: 1 天、P2: 0.5 天）

---

## 6. 風險登錄

| 風險 | 可能性 | 影響 | 緩解措施 |
|------|--------|------|---------|
| gorilla/websocket 新依賴 | 低 | 低 | 成熟 library（18k+ stars），專案已使用 gorilla/sessions |
| journalctl -f process crash | 低 | 中 | WebSocket onClose 自動重連，前端顯示重連狀態 |
| 長時間閒置無日誌輸出 | 中 | 低 | journalctl -f 本身會保持連線（blocking read），不需 heartbeat |
| WebSocket 連線數過多 | 低 | 低 | 同時只有一個 Drawer 開啟，最多一個 WebSocket 連線 |
| 權限不足（非 systemd-journal 群組） | 中 | 中 | 後端在 upgrade 前檢查，回傳明確錯誤 |
| 前端 WebSocket mock 測試複雜 | 中 | 中 | Vitest 使用 `vi.mock` + 自訂 MockWebSocket class |

---

## 7. 方案 A vs B：最終對照表

| 維度 | 方案 A（Polling）| 🏆 方案 B（WebSocket）|
|------|------|------|
| **前端程式碼** | ~150 行（含 timer/diff/失敗計數） | ~90 行（WebSocket onMessage + append） |
| **後端程式碼** | ~60 行（HTTP handler） | ~100 行（WS handler + process 管理） |
| **新依賴** | 0 | 1（gorilla/websocket） |
| **即時性** | 3s 延遲 | < 100ms |
| **前端狀態數量** | 5+ | 2 |
| **測試複雜度** | HTTP mock 簡單 | WebSocket mock 需自訂 |
| **journalctl 模式** | 每次 fork 一個新 process | 一個常駐 process（-f follow） |
| **維護性** | timer leak 風險、diff 邊界 bug | WebSocket 生命週期管理（成熟 pattern） |

---

## 📝 決策後續

- 本文件已存至 `docs/tech-decisions/005-journalctl-log-viewer.md`
- 若後續有大量 WebSocket 需求，可考慮統一 WebSocket 基礎設施

### 受影響文件同步狀態

| 文件 | 狀態 | 說明 |
|------|:----:|------|
| `docs/development/005-journalctl-log-viewer.md` | ✅ 已更新 | WebSocket 版開發規格 |
| `docs/bdds/005-journalctl-log-viewer.feature` | ✅ 已更新 | 移除 polling 語彙，改為 WebSocket 即時串流 |
| `docs/interaction-flows/005-journalctl-log-viewer.md` | ✅ 已更新 | 流程圖、互動說明、驗收清單改為 WebSocket 版 |
| `docs/test-plans/005-journalctl-log-viewer測試計畫.md` | ✅ 已更新 | Handler 改 WebSocket 測試、移除 polling 測試 |

---

*決策日期：2026-08-08*

---

# 附錄：v1 決策（2025-08-08，已廢棄）

> 以下為原始 v1 決策全文，保留供歷史參考。最終採用 v2（見上方）。

## 📌 決策摘要（v1）

| 項目 | 內容 |
|------|------|
| **最終方案** | Go `exec.Command("journalctl")` + HTTP Polling（3s）+ Vue 3 自訂 Drawer 元件 |
| **決策日期** | 2025-08-08 |
| **對應 Roadmap** | Phase 1 — `docs/development/002-expansion-roadmap.md` |
| **輸入文件** | `docs/interaction-flows/005-journalctl-log-viewer.md`、`docs/bdds/005-journalctl-log-viewer.feature` |
| **共識程度** | ✅ 基於現有架構一致性的最佳方案 |

---

## 1. 需求回顧（v1）

| 項目 | 內容 |
|------|------|
| **核心價值** | 管理員在 Web UI 直接查看 systemd 日誌，不需 SSH 進機器 |
| **角色** | 已登入的管理員 |
| **觸發入口** | Dashboard 服務列表 → 每列 Actions 區塊的「📋 Logs」按鈕 |
| **主要互動** | 右側 Drawer 顯示日誌、可調整行數（50/100/200/500）、自動刷新（每 3 秒）、客戶端文字搜尋 |
| **邊界限制** | 行數上限 1000、僅支援最近 N 行（無時間範圍篩選）、同一時間僅一個 Drawer |
| **異常情境** | 無日誌、無 journalctl、權限不足、API 逾時、自動刷新連續失敗 |

---

## 2. 候選方案（v1）

### 方案 A：exec + HTTP Polling + 自訂 Drawer（務實方案，v1 採用）

| 項目 | 內容 |
|------|------|
| **後端** | `exec.Command("journalctl", "-u", name, "-n", lines, "--no-pager", "-o", "short-iso")` |
| **自動刷新** | 前端 `setInterval` 每 3 秒 GET poll，僅取最新 N 行後與現有內容 diff |
| **前端 Drawer** | 自訂 Vue 3 元件（`<Teleport>` + CSS transition），無外部 UI 依賴 |
| **搜尋** | 前端 `Array.filter` + 正則 highlight，不觸發後端請求 |
| **開發工時** | 後端 0.5 天、前端 2 天、整合測試 0.5 天 — 共約 3 天 |

### 方案 B：exec + WebSocket + 自訂 Drawer（即時方案，v1 未採用）

| 項目 | 內容 |
|------|------|
| **後端** | 同上 exec + 新增 WebSocket endpoint（`gorilla/websocket`）推送新行 |
| **自動刷新** | WebSocket 連線，後端有新日誌時主動推送（或定時推送） |
| **前端 Drawer** | 同上自訂元件 |
| **搜尋** | 同上前端篩選 |
| **開發工時** | 後端 1 天、前端 2 天、整合測試 0.5 天 — 共約 3.5 天 |
| **風險** | 新增 `gorilla/websocket` 依賴、WebSocket 連線管理複雜度（重連、心跳） |

### 方案 C：D-Bus + HTTP Polling + UI Library Drawer（重型方案）

| 項目 | 內容 |
|------|------|
| **後端** | D-Bus `org.freedesktop.systemd1.Manager.GetUnitProcesses` 或直接讀取 `/var/log/journal/` |
| **自動刷新** | HTTP Polling（同方案 A） |
| **前端 Drawer** | 引入 UI library（如 PrimeVue Drawer / Naive UI Drawer） |
| **搜尋** | 後端 grep 或前端篩選 |
| **開發工時** | 後端 2 天、前端 1.5 天、整合測試 0.5 天 — 共約 4 天 |
| **風險** | D-Bus 無標準日誌讀取 API、新增大型 UI 依賴、維護成本上升 |

---

## 3. 權衡評估（v1）

| 維度 | 方案 A（Polling） | 方案 B（WebSocket） | 方案 C（D-Bus+UI Lib） |
|------|:---:|:---:|:---:|
| 🎯 需求符合度 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| ⚡ 開發速度 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ |
| 🔧 維護成本 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ |
| 📈 擴充性 | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| 👥 團隊熟悉度 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ |
| 💰 依賴成本 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ |
| 🔒 穩定性 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ |

### 關鍵取捨分析（v1）

**取捨 #1：Polling vs WebSocket 即時性**

| | HTTP Polling（3s） | WebSocket Push |
|------|------|------|
| 延遲 | 最多 3 秒 | 近乎即時 |
| 複雜度 | 極低 | 中等（連線管理、重連、心跳） |
| 資源消耗 | 每 3s 一次輕量 HTTP 請求 | 常駐連線，記憶體佔用 |
| 適合場景 | 人工監看日誌（3s 完全可接受） | 自動化告警、高頻率監控 |

→ **3 秒延遲對人類操作者而言完全可接受**。第一版不需 WebSocket 的即時性。

**取捨 #2：自訂 Drawer vs UI Library**

| | 自訂 Drawer | UI Library |
|------|------|------|
| Bundle size | ~5KB（純 CSS transition + Teleport） | 50-200KB（含整個 library） |
| 樣式控制 | 完全可控 | 需對抗 library 預設樣式 |
| 開發時間 | 約 4 小時（含動畫） | 約 2 小時（但需處理樣式衝突） |
| 互動細節 | 自訂鍵盤/焦點管理 | library 內建，但可能與現有衝突 |

→ 自訂 Drawer 更符合專案最小依賴原則。現有元件（ConfirmModal）已展示自訂 modal 模式，Drawer 可參考相同模式。

**取捨 #3：exec journalctl vs D-Bus**

| | exec | D-Bus |
|------|------|------|
| 一致性 | 與現有 start/stop/enable/disable 一致 | 與 ListServices 一致（D-Bus 優先） |
| 穩定性 | journalctl CLI 是主要介面，向後相容 | D-Bus 沒有標準的 log read API |
| 錯誤處理 | 直接讀取 stderr | 需要處理 D-Bus 錯誤碼 |

→ `journalctl` CLI 是讀取日誌的唯一穩定介面。D-Bus 主要用於服務狀態查詢，不適合日誌讀取。

---

## 4. 決策理由（v1）

### 🏆 選擇方案 A：exec + HTTP Polling + 自訂 Drawer

**三個關鍵原因**：

1. **與現有架構一致** — `exec.Command("systemctl", ...)` 模式已用於 start/stop/enable/disable，`journalctl` 遵循相同模式。不新增依賴。
2. **3 秒延遲可接受** — 人類操作者監看日誌不需要毫秒級即時性；Polling 實現簡單，不需管理 WebSocket 連線生命週期。
3. **最小依賴原則** — 自訂 Drawer 約 5KB，無需引入 UI library。專案已有 `ConfirmModal.vue` 的自訂 overlay 模式可參考。

### 為什麼放棄其他方案（v1）

- **方案 B（WebSocket）**：WebSocket 是 Phase 2 計畫的項目（#6 即時狀態推送）。日誌檢視器第一版不需綁定 WebSocket，後續可獨立升級。若屆時已有 WebSocket infra，再切換即可。
- **方案 C（D-Bus + UI Lib）**：D-Bus 無標準日誌讀取 API；引入 UI library 違反專案最小依賴原則，且現有 UI 風格需要大量覆寫。

---

## 5. 行動計畫（v1）

### 技術棧

| 層級 | 技術 | 用途 |
|------|------|------|
| 後端 API | Go 1.24 + chi v5 | `GET /api/v1/services/{name}/logs?lines=N` |
| 日誌讀取 | `exec.Command("journalctl", ...)` | 與現有 systemctl pattern 一致 |
| 前端框架 | Vue 3.5 + TypeScript | Composition API |
| 狀態管理 | Pinia | 無需新增 store（Drawer 狀態為元件 local state） |
| HTTP 客戶端 | Axios（已安裝） | API 呼叫與自動刷新輪詢 |
| 動畫 | CSS transition | Drawer 滑入/滑出（約 200ms） |

### API 規格（v1）

```
GET /api/v1/services/{name}/logs?lines=100

Response (200):
  Content-Type: text/plain; charset=utf-8
  Body: <journalctl 輸出>

Response (400): lines 超出上限
  {"error": "lines must be between 1 and 1000"}

Response (404): 服務名稱無效
  {"error": "invalid service name"}

Response (500): journalctl 不存在 / 權限不足
  {"error": "無法讀取日誌：..."}
```

---

## 6. 風險登錄（v1）

| 風險 | 可能性 | 影響 | 緩解措施 |
|------|--------|------|---------|
| journalctl 回應過慢 | 中 | 中 | 設 5s timeout、行數上限 1000、提示使用者縮小範圍 |
| 自動刷新造成後端負載 | 低 | 低 | 3s 間隔、輕量 HTTP 請求、若多使用者同時開啟可調整 |
| 前端長期開啟後記憶體成長 | 低 | 中 | 限制前端保留行數上限（如 5000 行）、超出時 trim 舊行 |
| 權限不足（非 systemd-journal 群組） | 中 | 中 | 後端回傳明確錯誤 + 解決方案提示、文件說明 |

---

*決策日期：2025-08-08（已於 2026-08-08 修訂為方案 B）*
