# 開發方案決策文件：journalctl 日誌檢視器

## 📌 決策摘要

| 項目 | 內容 |
|------|------|
| **最終方案** | Go `exec.Command("journalctl")` + HTTP Polling（3s）+ Vue 3 自訂 Drawer 元件 |
| **決策日期** | 2025-08-08 |
| **對應 Roadmap** | Phase 1 — `docs/development/002-expansion-roadmap.md` |
| **輸入文件** | `docs/interaction-flows/005-journalctl-log-viewer.md`、`docs/bdds/005-journalctl-log-viewer.feature` |
| **共識程度** | ✅ 基於現有架構一致性的最佳方案 |

---

## 1. 需求回顧

| 項目 | 內容 |
|------|------|
| **核心價值** | 管理員在 Web UI 直接查看 systemd 日誌，不需 SSH 進機器 |
| **角色** | 已登入的管理員 |
| **觸發入口** | Dashboard 服務列表 → 每列 Actions 區塊的「📋 Logs」按鈕 |
| **主要互動** | 右側 Drawer 顯示日誌、可調整行數（50/100/200/500）、自動刷新（每 3 秒）、客戶端文字搜尋 |
| **邊界限制** | 行數上限 1000、僅支援最近 N 行（無時間範圍篩選）、同一時間僅一個 Drawer |
| **異常情境** | 無日誌、無 journalctl、權限不足、API 逾時、自動刷新連續失敗 |

---

## 2. 候選方案

### 方案 A：exec + HTTP Polling + 自訂 Drawer（務實方案）

| 項目 | 內容 |
|------|------|
| **後端** | `exec.Command("journalctl", "-u", name, "-n", lines, "--no-pager", "-o", "short-iso")` |
| **自動刷新** | 前端 `setInterval` 每 3 秒 GET poll，僅取最新 N 行後與現有內容 diff |
| **前端 Drawer** | 自訂 Vue 3 元件（`<Teleport>` + CSS transition），無外部 UI 依賴 |
| **搜尋** | 前端 `Array.filter` + 正則 highlight，不觸發後端請求 |
| **開發工時** | 後端 0.5 天、前端 2 天、整合測試 0.5 天 — 共約 3 天 |

### 方案 B：exec + WebSocket + 自訂 Drawer（即時方案）

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

## 3. 權衡評估

| 維度 | 方案 A（Polling） | 方案 B（WebSocket） | 方案 C（D-Bus+UI Lib） |
|------|:---:|:---:|:---:|
| 🎯 需求符合度 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| ⚡ 開發速度 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ |
| 🔧 維護成本 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ |
| 📈 擴充性 | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| 👥 團隊熟悉度 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ |
| 💰 依賴成本 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ |
| 🔒 穩定性 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ |

### 關鍵取捨分析

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

## 4. 決策理由

### 🏆 選擇方案 A：exec + HTTP Polling + 自訂 Drawer

**三個關鍵原因**：

1. **與現有架構一致** — `exec.Command("systemctl", ...)` 模式已用於 start/stop/enable/disable，`journalctl` 遵循相同模式。不新增依賴。
2. **3 秒延遲可接受** — 人類操作者監看日誌不需要毫秒級即時性；Polling 實現簡單，不需管理 WebSocket 連線生命週期。
3. **最小依賴原則** — 自訂 Drawer 約 5KB，無需引入 UI library。專案已有 `ConfirmModal.vue` 的自訂 overlay 模式可參考。

### 為什麼放棄其他方案

- **方案 B（WebSocket）**：WebSocket 是 Phase 2 計畫的項目（#6 即時狀態推送）。日誌檢視器第一版不需綁定 WebSocket，後續可獨立升級。若屆時已有 WebSocket infra，再切換即可。
- **方案 C（D-Bus + UI Lib）**：D-Bus 無標準日誌讀取 API；引入 UI library 違反專案最小依賴原則，且現有 UI 風格需要大量覆寫。

---

## 5. 行動計畫

### 技術棧

| 層級 | 技術 | 用途 |
|------|------|------|
| 後端 API | Go 1.24 + chi v5 | `GET /api/v1/services/{name}/logs?lines=N` |
| 日誌讀取 | `exec.Command("journalctl", ...)` | 與現有 systemctl pattern 一致 |
| 前端框架 | Vue 3.5 + TypeScript | Composition API |
| 狀態管理 | Pinia | 無需新增 store（Drawer 狀態為元件 local state） |
| HTTP 客戶端 | Axios（已安裝） | API 呼叫與自動刷新輪詢 |
| 動畫 | CSS transition | Drawer 滑入/滑出（約 200ms） |

### 架構變更點

```
現有架構                          新增部分
┌──────────┐   ┌──────────┐     ┌─────────────────┐
│  Vue SPA │──▶│ Go chi   │     │  GET /api/v1/   │
│  (靜態)  │   │ API      │────▶│ services/{name} │
└──────────┘   └────┬─────┘     │ /logs?lines=100 │
                    │           └────────┬────────┘
              ┌─────▼─────┐             │
              │ systemctl │      exec.Command(
              │ (dbus)    │      "journalctl",
              └───────────┘      "-u", name, "-n",
                                  lines, "--no-pager")
```

### API 規格

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

### 檔案變更清單

| 檔案 | 操作 | 說明 |
|------|------|------|
| `src/internal/systemd/systemd.go` | 修改 | `ServiceManager` interface 新增 `GetServiceLogs(name, lines) (string, error)` |
| `src/internal/systemd/systemd.go` | 新增 | `GetServiceLogs()` 實作：exec `journalctl -u {name} -n {lines} --no-pager -o short-iso` |
| `src/internal/handler/json_handler.go` | 新增 | `HandleServiceLogsJSON` handler + `logResponseJSON` type |
| `src/main.go` | 修改 | 新增路由 `GET /api/v1/services/{name}/logs` |
| `frontend/src/components/LogDrawer.vue` | **新增** | Drawer 元件（Teleport + CSS transition + 所有互動邏輯） |
| `frontend/src/components/ServiceRow.vue` | 修改 | Actions 區塊新增「📋 Logs」按鈕，emit `open-logs` 事件 |
| `frontend/src/views/DashboardView.vue` | 修改 | 掛載 `<LogDrawer>`、管理開啟/關閉狀態、傳遞 serviceName |
| `frontend/src/types/service.ts` | 修改 | 新增 `LogDrawerState` interface |

### 初期任務

| 優先級 | 任務 | 檔案 | 預估工時 |
|--------|------|------|---------|
| P0 | `ServiceManager` interface 與 `GetServiceLogs` 實作 | `systemd.go` | 1h |
| P0 | `HandleServiceLogsJSON` handler + 路由 | `json_handler.go`、`main.go` | 1h |
| P0 | 後端單元測試 | `systemd_test.go`、`handler_test.go` | 1h |
| P0 | `LogDrawer.vue` 元件（基礎：開啟/關閉、loading、顯示） | 新增 | 4h |
| P1 | `LogDrawer.vue` 行數選擇器 | 同上 | 1h |
| P1 | `LogDrawer.vue` 自動刷新（setInterval + diff） | 同上 | 2h |
| P1 | `LogDrawer.vue` 客戶端搜尋 highlight | 同上 | 2h |
| P1 | `ServiceRow.vue` 新增 Logs 按鈕 | 修改 | 0.5h |
| P1 | `DashboardView.vue` 整合 LogDrawer | 修改 | 1h |
| P1 | 前端單元測試（LogDrawer + ServiceRow） | `__tests__/` | 2h |
| P2 | RWD 行動裝置全螢幕樣式 | `LogDrawer.vue` CSS | 1h |
| P2 | 深色模式樣式 | `LogDrawer.vue` CSS | 0.5h |
| P2 | 端對端測試（Playwright） | `e2e/` | 2h |

**總工時**：約 2.5–3 天

### 有待驗證的項目（Spike）

- **journalctl 效能**：對日誌量大的服務（如 nginx 輸出數萬行），`journalctl -n 1000` 的回應時間是否在 5 秒內？
- **Polling 記憶體**：長時間開啟 Drawer 並自動刷新（每 3 秒追加），前端日誌累積是否造成記憶體問題？需測試上限（如保留最近 5000 行）。

---

## 6. 風險登錄

| 風險 | 可能性 | 影響 | 緩解措施 |
|------|--------|------|---------|
| journalctl 回應過慢 | 中 | 中 | 設 5s timeout、行數上限 1000、提示使用者縮小範圍 |
| 自動刷新造成後端負載 | 低 | 低 | 3s 間隔、輕量 HTTP 請求、若多使用者同時開啟可調整 |
| 前端長期開啟後記憶體成長 | 低 | 中 | 限制前端保留行數上限（如 5000 行）、超出時 trim 舊行 |
| 權限不足（非 systemd-journal 群組） | 中 | 中 | 後端回傳明確錯誤 + 解決方案提示、文件說明 |

---

## 📝 決策後續

- 本文件已存至 `docs/tech-decision-journalctl-log-viewer-2025-08-08.md`
- 開發完成後建議進行效能測試（大量日誌的服務）
- 若後續 Phase 2 實作 WebSocket（#6），可考慮將自動刷新從 Polling 升級為 WebSocket push
- 測試計畫見 `docs/test-plans/005-journalctl-log-viewer測試計畫.md`
- 開發規格見 `docs/development/005-journalctl-log-viewer.md`

---

*決策日期：2025-08-08*
