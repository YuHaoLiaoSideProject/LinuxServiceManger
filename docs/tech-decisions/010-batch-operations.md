# 開發方案決策文件：批次操作

## 📌 決策摘要

| 項目 | 內容 |
|------|------|
| **最終方案** | 後端 POST /api/v1/services/batch 循序執行 + per-service 錯誤隔離 + 前端 DashboardView 內 selection ref + 擴充 ConfirmModal + batch result panel |
| **決策日期** | 2025-08-11 |
| **對應 Roadmap** | Phase 2 — `docs/development/002-expansion-roadmap.md` 項目 #8 |
| **輸入文件** | `docs/interaction-flows/010-batch-operations.md` |
| **共識程度** | ✅ 確認通過 |

---

## 1. 需求回顧

### 1.1 核心業務價值

讓管理員在服務列表中選取多個服務，一次性執行 start / stop / restart 操作，不需逐一操作。當需要批次重啟一組相關服務（如「所有 Web 服務」、「所有監控 agent」），或在維護窗口快速停止多個服務時，大幅減少重複點擊。

### 1.2 功能邊界

| 項目 | 範圍 |
|------|------|
| **Must Have (P0)** | 服務列表 checkbox 選取（含全選）、批次工具列（sticky）、確認對話框、POST /api/v1/services/batch 後端 API、循序執行 + per-service 錯誤回報、結果彙總（成功數/失敗數 + 各別錯誤）、鎖定服務排除、Tab 切換清除選取 |
| **Should Have (P1)** | 執行進度顯示（「正在執行... 3/5」）、全選僅勾選目前過濾結果、重啟對話框額外警告、失敗清單展開/收合、部分失敗後勾選保留以便重試 |
| **Nice to Have (P2)** | 選取數量變化動畫、工具列 slide-down 動畫、批次操作期間暫停 WebSocket 更新以避免衝突 |

### 1.3 既有基礎

- 後端已有 `json_handler.go` 中 start/stop/restart 的單一服務操作 handler（`HandleStartJSON` / `HandleStopJSON` / `HandleRestartJSON`），每個 handler 已整合 audit log 寫入
- 後端已有 `systemd.ServiceManager` interface（`StartService` / `StopService` / `RestartService`），支援 mock
- 前端已有 `DashboardView.vue` 管理服務列表、操作動作、confirm modal 與 toast
- 前端已有 `ConfirmModal.vue`（接受 `show` / `message` props，emit `confirm` / `cancel`）
- 前端已有 `useToast.ts` composable（支援 `success` / `error` type）
- 前端已有 `ServiceTable.vue` 和 `ServiceRow.vue`（表格渲染）
- 前端已有 `Toolbar.vue`（狀態過濾 + 搜尋，位於列表上方）
- 前端已有 `useWebSocket.ts` composable（即時狀態推送）
- 前端已有 `useServiceFilter.ts` composable（過濾 + 搜尋）
- 審計模組 (`internal/audit/`) 已實作，支援 `audit.NewEntry()` + `audit.Module.Write()`

---

## 2. 關鍵技術決策

### 決策 1：後端 API 設計

| 方案 | 描述 | 優點 | 缺點 |
|------|------|------|------|
| **A. 單一端點 POST /api/v1/services/batch（選定）** | Accept `{"names": [...], "action": "start\|stop\|restart"}`，循序執行後回傳每筆結果陣列 | RESTful 簡潔、前端單次請求、符合 Interaction Flow 定義 | 長時間執行需妥善設定 timeout |
| B. 多個並行單一操作請求 | 前端對每個服務各發一個 POST /api/v1/services/{name}/{action}，用 Promise.allSettled 收集結果 | 不需新增後端端點、可並行執行 | 違反 Interaction Flow「循序執行」需求、N 個 HTTP 請求開銷大、後端 systemctl lock 競爭 |
| C. 非同步任務模式 | POST /api/v1/services/batch 立即回傳 taskId，前端 polling GET /api/v1/tasks/{id} 追蹤進度 | 適合超大批次、不佔用 HTTP 連線 | 過度設計、50 個服務上限循序執行仍可在 60s 內完成、需引入 task 狀態管理 |

> **決策**：方案 A。Interaction Flow 明確定義 `POST /api/v1/services/batch` 為單一端點，且上限 50 個服務、整體逾時 60 秒，循序執行足以在 HTTP timeout 內完成。與現有 REST API 風格一致（`/api/v1/services/...`）。

**API 合約**：

```json
// Request
POST /api/v1/services/batch
Content-Type: application/json

{
  "names": ["nginx.service", "docker.service"],
  "action": "restart"
}

// Response — 200 OK（部分失敗仍回 200，由 result 欄位區分）
{
  "summary": {
    "total": 2,
    "success": 1,
    "failed": 1
  },
  "results": [
    {
      "name": "nginx.service",
      "action": "restart",
      "result": "success",
      "error": ""
    },
    {
      "name": "docker.service",
      "action": "restart",
      "result": "failure",
      "error": "exit code 1: failed to restart docker.service"
    }
  ]
}

// Error Response — 400 Bad Request（參數錯誤）
{
  "error": "invalid action: invalid-action"
}

// Error Response — 400 Bad Request（數量超限）
{
  "error": "batch limit exceeded: max 50, got 51"
}

// Error Response — 400 Bad Request（包含鎖定服務）
{
  "error": "locked service cannot be batch-operated: sshd.service"
}
```

---

### 決策 2：批次執行模式（後端循序 vs 並行）

| 方案 | 描述 | 優點 | 缺點 |
|------|------|------|------|
| **A. 循序執行 + per-service 錯誤隔離（選定）** | for loop 逐一呼叫 systemd manager，每個服務的錯誤被捕獲後繼續執行下一個，最終彙總所有結果 | 避免 systemctl lock 衝突、符合 Interaction Flow、錯誤隔離（一個失敗不影響其他） | 總耗時為各服務耗時之和（但 50 個服務仍在 60s 內） |
| B. goroutine 並行 + semaphore 限流 | 用 buffered chan 作為 semaphore（並行度 3~5），goroutine 各自執行 | 總耗時較短 | `systemctl` 內部有 lock（`/run/systemd/...`），並行反而可能造成 lock contention 而失敗；違反 Interaction Flow 循序要求 |
| C. 單一 systemctl 指令批次 | 使用 `systemctl start nginx docker ...` 一次傳多個服務 | 最快、最接近原生 systemd 行為 | 若其中一個失敗，systemctl 停止執行後續服務（all-or-nothing 傾向）；無法取得 per-service 結果；Interaction Flow 要求 per-service 回報 |

> **決策**：方案 A。Interaction Flow 明確要求「後端循序執行（避免 `systemctl` 鎖定衝突），前端顯示進度」。per-service try-catch 確保一個失敗不影響後續，每個服務結果獨立記錄。

**實作細節**：

```go
func (h *Handler) HandleBatchServices(w http.ResponseWriter, r *http.Request) {
    // 1. Parse request body
    // 2. Validate: names ≤ 50, action ∈ {start,stop,restart}
    // 3. Validate: no locked services in names
    // 4. Set overall context timeout 60s
    // 5. For each name:
    //    a. Call systemd manager method (capture error)
    //    b. Write audit log entry (per-service, independent)
    //    c. Append result to results slice
    // 6. Return summary + results
}
```

---

### 決策 3：前端選取狀態管理

| 方案 | 描述 | 優點 | 缺點 |
|------|------|------|------|
| **A. DashboardView 內 reactive Set\<string\>（選定）** | 在 `DashboardView.vue` 中使用 `reactive(new Set<string>())` 管理選取集合，透過 props 傳遞給 ServiceTable / BatchToolbar | 簡單、生命週期與 DashboardView 一致、不需新增 store | 選取狀態僅在 DashboardView 內有意義，不跨頁面 |
| B. Pinia useBatchStore | 新增 Pinia store 管理選取狀態與批次操作狀態 | 狀態集中管理、易於測試 | 選取狀態僅在 Dashboard 頁面有意義，不需要全域 store；增加一個 store 檔案 |
| C. composable useBatchSelection | 將選取邏輯封裝為 composable | 可複用、符合現有 composable pattern | 選取邏輯與 Dashboard 耦合度高，composable 的複用價值有限 |

> **決策**：方案 A。選取狀態僅在 DashboardView 生命週期內有效（切換 Tab 清除、重整後清除），不需要跨元件或全域共享。直接在 `DashboardView.vue` 中宣告 `const selectedNames = reactive(new Set<string>())` 並以 props 向下傳遞，符合 Vue 3 Composition API 的簡潔模式。避免為單一頁面功能新增 Pinia store 的過度設計。

**狀態生命週期**：

| 事件 | 行為 |
|------|------|
| 頁面載入（onMounted） | `selectedNames.clear()` |
| 切換 Tab（我的服務 ↔ 系統服務） | `selectedNames.clear()` |
| 搜尋/過濾變更 | 保持選取（全選僅作用於可見服務） |
| 全選 checkbox | 對 `filteredServices` 中非鎖定服務全部加入 Set |
| 取消全選 | `selectedNames.clear()` |
| 批次操作完成（全部成功） | `selectedNames.clear()` |
| 批次操作完成（部分失敗） | 僅保留失敗的服務在 Set 中 |
| 手動重整 | `selectedNames.clear()` |

---

### 決策 4：確認對話框整合

| 方案 | 描述 | 優點 | 缺點 |
|------|------|------|------|
| **A. 擴充現有 ConfirmModal（選定）** | 為 ConfirmModal 新增 optional `details` prop（顯示受影響服務清單），批次操作時傳入服務名稱列表 | 複用既有元件、UI 一致、維護成本低 | ConfirmModal 需微調以支援可選的詳細清單 |
| B. 獨立 BatchConfirmModal 元件 | 新建專用批次確認對話框 | 不影響既有 ConfirmModal、可自由設計 layout | 重複元件邏輯、維護兩份 modal 程式碼、違反 DRY |
| C. 不使用確認對話框（inline 確認） | 工具列點擊後直接執行，無確認步驟 | 最快 | 違反 Interaction Flow「Start / Stop / Restart 批次操作都需要確認對話框」 |

> **決策**：方案 A。現有 `ConfirmModal.vue` 接受 `show: boolean` 和 `message: string`，僅需新增 optional `details?: string` prop 即可支援批次確認。Restart 的額外警告可透過 `message` 內容傳遞（「確定要重啟 N 個服務？重啟會造成服務短暫中斷」）。最小改動、最大複用。

**ConfirmModal 擴充**：

```typescript
// 新增 props
defineProps<{
  show: boolean
  message: string
  details?: string  // 新增：受影響服務清單（如 "nginx.service, docker.service ...及其他 3 個"）
}>()
```

---

### 決策 5：批次工具列 UI 架構

| 方案 | 描述 | 優點 | 缺點 |
|------|------|------|------|
| **A. 獨立 BatchToolbar.vue 元件（選定）** | 新建 `BatchToolbar.vue`，位於 ServiceTable 上方（Toolbar 下方），sticky 定位 | 關注點分離、獨立動畫與狀態管理、不影響現有 Toolbar | 多一個元件檔案 |
| B. 整合進現有 Toolbar.vue | 在 Toolbar 下方或內部動態顯示批次操作區塊 | 不需要新元件 | Toolbar 職責膨脹（過濾 + 搜尋 + 批次操作混合）、sticky 行為衝突 |
| C. 浮動 fixed 按鈕（FAB） | 螢幕右下角浮動按鈕顯示選取數量與操作 | 不佔據上方空間 | 不符合 Interaction Flow「列表上方浮現」描述、與既有 UI 風格不一致 |

> **決策**：方案 A。`BatchToolbar.vue` 專注於批次選取計數、操作按鈕（Start/Stop/Restart）、進度顯示、取消選取。與現有 `Toolbar.vue`（過濾+搜尋）職責分離。sticky 定位確保表格捲動時工具列保持可見。

**BatchToolbar props/events**：

```typescript
// Props
{
  selectedCount: number
  executing: boolean
  progress: { done: number; total: number } | null
}

// Emits
{
  'batch-action': [action: 'start' | 'stop' | 'restart']
  'clear-selection': []
}
```

---

### 決策 6：結果回報機制

| 方案 | 描述 | 優點 | 缺點 |
|------|------|------|------|
| **A. Toast + Inline Result Panel（選定）** | 全部成功：綠色 Toast。部分/全部失敗：Toast + 工具列下方展開詳細結果面板（inline expandable list） | 符合 Interaction Flow 三種結果路徑、資訊密度適中、失敗可展開細節 | 需實作可折疊的結果面板 |
| B. Modal 顯示結果 | 操作完成後彈出 modal 顯示完整結果 | 強制使用者關注結果 | 中斷流程、Modal 疊 Modal 體驗差（確認 modal → 結果 modal） |
| C. 僅 Toast 通知 | 不論成功失敗都只用 Toast 顯示摘要 | 最簡 | 部分失敗時使用者無法查看各別錯誤原因，不符合 Interaction Flow |

> **決策**：方案 A。Toast 提供即時摘要回饋（成功/失敗/混合），inline result panel 提供詳細的 per-service 成功/失敗狀態，支援展開/收合。這與 Interaction Flow 步驟 4 的三種結果路徑完全一致。

**結果面板設計**：

```
┌─────────────────────────────────────────────────────┐
│  BatchToolbar (sticky)                               │
│  「已選取 5 個服務」 [▶ Start] [⏹ Stop] [🔄 Restart]  │
├─────────────────────────────────────────────────────┤
│  Result Panel (conditional, below toolbar)           │
│  ┌─────────────────────────────────────────────┐    │
│  │ ⚠️ 3 成功，2 失敗                    [收合] │    │
│  │                                             │    │
│  │ ✅ nginx.service     — 已成功重啟           │    │
│  │ ✅ docker.service    — 已成功重啟           │    │
│  │ ✅ postgres.service  — 已成功重啟           │    │
│  │ ❌ redis.service     — exit code 1: ...    │    │
│  │ ❌ myapp.service     — 操作逾時             │    │
│  └─────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────┘
```

---

### 決策 7：Checkbox UI 實作位置

| 方案 | 描述 | 優點 | 缺點 |
|------|------|------|------|
| **A. ServiceTable 表頭 + ServiceRow 左側（選定）** | 在 ServiceTable thead 新增 checkbox th，ServiceRow td 新增 checkbox（鎖定服務顯示 🔒） | 符合 Interaction Flow、checkbox 與表格自然整合、全選在表頭 | ServiceTable 和 ServiceRow 需修改模板，由 props 傳入選取狀態 |
| B. 獨立 SelectionColumn 元件 | 包裝 checkbox 邏輯為獨立元件，嵌入 ServiceRow | checkbox 邏輯集中 | 過度設計、只是 `<input type="checkbox">` |
| C. 在表格外側 | 使用獨立的選取面板（sidebar 或浮動清單） | 不修改表格結構 | 不符合 Interaction Flow「列表左側顯示 checkbox」的設計、增加認知負擔 |

> **決策**：方案 A。直接在既有表格結構上新增 checkbox 列，最符合 Interaction Flow 的 UI 描述。ServiceTable 接收 `selectedNames: Set<string>` prop，ServiceRow 接收 `selected: boolean` + `locked: boolean` prop。

**影響的元件變更**：

| 元件 | 變更 |
|------|------|
| `ServiceTable.vue` | thead 新增 `<th><input type="checkbox"></th>`（全選）；傳遞 selected/locked 給 ServiceRow |
| `ServiceRow.vue` | 新增 `<td><input type="checkbox" :disabled="locked"></td>`（最左側）；locked 時顯示 🔒 或 disabled |
| `DashboardView.vue` | 管理 selectedNames Set，處理全選/取消邏輯，傳遞給 ServiceTable |

---

### 決策 8：與 WebSocket（008）和 Audit Log（009）的整合

| 面向 | 策略 |
|------|------|
| **WebSocket 狀態推送** | 批次操作期間（`executing === true`），前端暫時忽略 WebSocket 的 `status_change` 訊息，避免與進度顯示衝突。操作完成後，若全部成功則直接 refresh 列表（`loadServices()`），WebSocket 推送自然恢復。若部分失敗則依賴 WebSocket 推送更新已成功服務的狀態 |
| **Audit Log 寫入** | 批次操作中每個服務的操作獨立寫入 audit log（一筆 start/stop/restart 一個 entry）。後端在循序執行每個服務時，呼叫 `h.Audit.Write(entry)`，與現有 `HandleStartJSON` 等 handler 中的 audit 寫入模式一致。這確保 audit log 中的每筆操作都有精確的時間戳和結果 |
| **Audit Log 查詢** | 不需變更。批次操作的多筆 audit entry 在查詢頁面自然顯示為多筆獨立紀錄，符合稽核需求 |

**WebSocket 抑制機制**：

```typescript
// DashboardView.vue
const batchExecuting = ref(false)

on('status_change', (msg: any) => {
  if (batchExecuting.value) return  // 批次執行中暫不處理
  // ... 現有邏輯
})

// 批次完成後
async function onBatchComplete() {
  batchExecuting.value = false
  await loadServices()  // 完整重整，確保狀態一致
}
```

---

### 決策 9：checkbox 與全選的過濾感知

| 方案 | 描述 | 優點 | 缺點 |
|------|------|------|------|
| **A. 全選僅作用於過濾後的可見非鎖定服務（選定）** | 全選 checkbox 只勾選 `filteredServices` 中 `locked === false` 的服務，搜尋/過濾變更時不清除選取 | 符合 Interaction Flow「全選僅勾選目前過濾/搜尋結果中的解鎖服務」、直覺 | 若使用者全選後切換過濾，部分已選取服務可能不在目前視圖中（但這是預期行為） |
| B. 全選作用於全部服務（忽略過濾） | 全選勾選所有非鎖定服務，不受過濾影響 | 簡單 | 違反 Interaction Flow 需求、使用者難以預測全選範圍 |
| C. 過濾變更時自動清除選取 | 每次搜尋/過濾變更時清除所有勾選 | 避免混淆 | 使用者可能在微調過濾時失去選取，體驗不佳 |

> **決策**：方案 A。全選範圍 = 目前 Tab 下，經過濾/搜尋後的非鎖定服務。過濾變更時不清除選取，但全選的範圍隨過濾結果動態更新。這提供最大彈性：使用者可以先搜尋特定服務群組（如 `nginx`），再全選後批次操作。

---

## 3. 架構概覽

```
┌──────────────────────────────────────────────────────────────┐
│  Browser (Dashboard)                                          │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  DashboardView.vue                                       │  │
│  │  ┌──────────────────────────────────────────────────┐  │  │
│  │  │ selectedNames: Set<string>                        │  │  │
│  │  │ batchExecuting: boolean                           │  │  │
│  │  │ batchProgress: { done, total }                    │  │  │
│  │  │ batchResults: BatchResult[]                       │  │  │
│  │  └──────────────────────────────────────────────────┘  │  │
│  │                                                          │  │
│  │  ┌──────────────────────┐                               │  │
│  │  │ Toolbar.vue          │  (搜尋 + 狀態過濾)              │  │
│  │  └──────────────────────┘                               │  │
│  │  ┌──────────────────────┐  (v-if="selectedCount > 0")   │  │
│  │  │ BatchToolbar.vue     │  sticky, slide-down 動畫      │  │
│  │  │ 「已選取 N 個」       │                               │  │
│  │  │ [Start][Stop]        │                               │  │
│  │  │ [Restart] [取消選取]  │                               │  │
│  │  └──────┬───────────────┘                               │  │
│  │         │ emit('batch-action', action)                   │  │
│  │         ▼                                                │  │
│  │  ┌──────────────────────┐                               │  │
│  │  │ ConfirmModal.vue     │  (擴充 details prop)          │  │
│  │  │ 「確定要重啟 5 個服務？」│                              │  │
│  │  │ nginx, docker ...+3  │                               │  │
│  │  └──────┬───────────────┘                               │  │
│  │         │ confirm → executeBatch()                       │  │
│  │         ▼                                                │  │
│  │  ┌──────────────────────┐                               │  │
│  │  │ BatchResultPanel     │  (v-if="batchResults")        │  │
│  │  │ 展開/收合 per-service │                               │  │
│  │  └──────────────────────┘                               │  │
│  │                                                          │  │
│  │  ┌──────────────────────────────────────────────────┐  │  │
│  │  │ ServiceTable.vue                                   │  │  │
│  │  │ ┌────┬────────┬──────┬──────┬────┬──────┬──────┐ │  │  │
│  │  │ │ ☑  │  Name  │ Load │Active│Sub │Auto  │Actions│ │  │  │
│  │  │ │    │        │      │      │    │Start │       │ │  │  │
│  │  │ ├────┼────────┼──────┼──────┼────┼──────┼──────┤ │  │  │
│  │  │ │ ☑  │nginx   │loaded │active│run │ ON   │▶⏹🔄 │ │  │  │
│  │  │ │ 🔒 │sshd    │loaded │active│run │ 🔒   │ 🔒  │ │  │  │
│  │  │ │ ☐  │docker  │loaded │inact│dead│ OFF  │▶🔄  │ │  │  │
│  │  │ └────┴────────┴──────┴──────┴────┴──────┴──────┘ │  │  │
│  │  └──────────────────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────────────────┘  │
│                          │ HTTP POST /api/v1/services/batch   │
└──────────────────────────┼───────────────────────────────────┘
                           │
┌──────────────────────────┼───────────────────────────────────┐
│  Go Backend                                                  │
│  ┌───────────────────────┴─────────────────────────────────┐ │
│  │  chi Router (AuthMiddlewareJSON)                         │ │
│  │  ┌──────────────────────────────────────────────────┐   │ │
│  │  │ POST /api/v1/services/batch                       │   │ │
│  │  │   → handler.HandleBatchServices()                 │   │ │
│  │  └──────────────────────────────────────────────────┘   │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                               │
│  HandleBatchServices() 流程:                                  │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ 1. json.Decode(body) → { names, action }               │ │
│  │ 2. Validate: len(names) ≤ 50                           │ │
│  │ 3. Validate: action ∈ {start,stop,restart}             │ │
│  │ 4. Validate: no locked services in names               │ │
│  │ 5. ctx, cancel := context.WithTimeout(60s)             │ │
│  │ 6. for _, name := range names:                         │ │
│  │      err := h.systemd.{Start,Stop,Restart}Service(name)│ │
│  │      result := { name, action, result, error? }       │ │
│  │      h.Audit.Write(audit.Entry{...})  // per-service  │ │
│  │      results = append(results, result)                │ │
│  │      // check ctx.Err() for timeout                   │ │
│  │ 7. Return { summary: {total, success, failed},        │ │
│  │             results: [...] }                          │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                               │
│  與既有模組的互動:                                             │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ systemd.ServiceManager  ──  呼叫 Start/Stop/Restart     │ │
│  │ audit.Module            ──  每筆操作寫入 audit.jsonl     │ │
│  │ websocket.Hub           ──  不直接介入（操作完成後由     │ │
│  │                              systemd monitor 推送變更）  │ │
│  └─────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘

Data Flow (Batch Execute):
  1. User selects services via checkboxes
  2. User clicks batch action button → ConfirmModal
  3. Confirm → POST /api/v1/services/batch { names, action }
  4. Backend iterates: for each name → systemd manager → audit.Write
  5. Backend returns summary + per-service results
  6. Frontend processes results:
     a. All success → green toast + clear selection + loadServices()
     b. Partial failure → yellow toast + show result panel + keep failed in selection
     c. All failure → red toast + show result panel + keep selection
```

---

## 4. 風險評估

| 風險 | 可能性 | 影響 | 緩解措施 |
|------|--------|------|---------|
| 批次操作中某服務 systemctl 卡住導致整體逾時 | 中 | 中 | 整體 context timeout 60s；剩餘未執行服務標記為 failure（"batch timeout"）；已執行服務結果保留 |
| 前端選取狀態與過濾結果不一致（選取後切換過濾，勾選了看不到的服務） | 中 | 低 | 全選僅作用於過濾後的可見服務；確認對話框顯示受影響服務清單（最多 5 個），使用者可察覺異常；切換 Tab 時強制清除選取 |
| 批次操作期間 WebSocket 推送的 status_change 與手動重整衝突 | 低 | 中 | 批次執行期間前端忽略 WebSocket status_change；操作完成後統一 `loadServices()` 重整，確保最終一致性 |
| 批次操作完成後服務列表重整與已選取服務的 WebSocket 推送競態 | 低 | 低 | 重整完成後 selectedNames 已清除（全部成功）或僅保留失敗服務；WebSocket 推送在重整後自然恢復 |
| 審計 log 在批次中大量寫入導致 channel buffer 滿 | 低 | 低 | audit.Module 的 buffered channel 為 100；50 個服務的批次操作為循序寫入，寫入速率遠低於 buffer 消耗速率；即使 drop 也不影響操作結果 |
| 全選 checkbox 與 Tab 切換的競態 | 低 | 低 | Tab 切換時 `selectedNames.clear()` 立即執行；全選 checkbox 的 `v-model` 響應式更新 |
| 前端 checkbox 在大列表（>500 服務）中的效能 | 低 | 中 | 50 個服務上限限制單次批次範圍；Vue 3 v-for 的 keyed 優化已足夠；checkbox 僅是簡單 `<input>` |

---

## 5. 相依與整合

| 項目 | 影響 |
|------|------|
| `json_handler.go` — 新增 `HandleBatchServices` | 新增 ~80 行 handler 函數，含請求驗證、循序執行、audit 寫入、結果彙總 |
| `handler.go` — Handler struct / router 註冊 | 無需修改 struct；`main.go` 中 chi router 新增 `POST /api/v1/services/batch` 路由 |
| `internal/systemd/` | 無變更，僅使用既有 `ServiceManager` interface |
| `internal/audit/` | 無變更，批次中每筆操作呼叫既有 `audit.NewEntry()` + `Audit.Write()` |
| `internal/websocket/` | 無變更（批次操作不直接推送 WebSocket，由 systemd monitor 自動推送狀態變更） |
| `DashboardView.vue` | 新增 selectedNames Set、批次執行狀態、handleBatchAction、executeBatch；整合 BatchToolbar、結果面板 |
| `BatchToolbar.vue`（新元件） | 獨立元件，接收選取數量與執行狀態 props，emit batch-action / clear-selection |
| `ServiceTable.vue` | thead 新增全選 checkbox th；傳遞 selected/locked props 給 ServiceRow |
| `ServiceRow.vue` | 新增 checkbox td（最左側，locked 時 disabled + 🔒） |
| `ConfirmModal.vue` | 新增 optional `details?: string` prop，顯示受影響服務清單 |
| `api/client.ts` | 新增 `batchServices(names: string[], action: string): Promise<BatchResponse>` |
| `types/service.ts` | 新增 `BatchRequest`、`BatchResponse`、`BatchResult`、`BatchSummary` 型別 |
| `useToast.ts` | 新增支援 `warning` type（黃色 Toast） |
| 反向代理 (nginx) | 無需變更（純 REST API，無 WebSocket） |
| Deploy 流程 | 無需變更 |

---

## 6. 不需變更的部分

- systemd 模組（`internal/systemd/systemd.go`）：批次操作直接呼叫既有的 `StartService` / `StopService` / `RestartService`
- WebSocket Hub / Status Monitor（008）：批次操作不直接介入，操作完成後由 D-Bus monitor 自動推送狀態變更
- 審計模組 core（`internal/audit/audit.go`）：無需變更，僅在 handler 中多次呼叫 `Write()`
- 審計查詢頁面（`AuditLogView.vue`、`useAuditLog.ts`）：無需變更
- 登入/登出流程：不受影響
- PWA / Service Worker：不受影響
- LogDrawer.vue：不受影響
- AppHeader.vue、StatsBar.vue、TabsBar.vue：不受影響
- useI18n.ts：僅新增批次相關 i18n key（如 `batch.selected`、`batch.confirm.start` 等），不變更邏輯

---

## 7. 檔案變更摘要

### 新增檔案

| 檔案 | 描述 |
|------|------|
| `frontend/src/components/BatchToolbar.vue` | 批次操作工具列元件 |
| `frontend/src/components/BatchResultPanel.vue` | 批次結果展開面板（可選，也可內嵌於 BatchToolbar） |
| `frontend/src/api/__tests__/batch.test.ts` | 前端 API 測試 |
| `src/internal/handler/handler_batch_test.go` | 後端 batch handler 測試 |

### 修改檔案

| 檔案 | 變更範圍 |
|------|---------|
| `src/internal/handler/json_handler.go` | 新增 `HandleBatchServices()` (~80 lines) |
| `main.go` | 新增 `POST /api/v1/services/batch` 路由註冊 |
| `frontend/src/api/client.ts` | 新增 `batchServices()` 函數 + BatchResponse 型別 |
| `frontend/src/types/service.ts` | 新增 `BatchRequest`、`BatchResponse`、`BatchResult`、`BatchSummary` |
| `frontend/src/views/DashboardView.vue` | 整合 selectedNames、batch 狀態、BatchToolbar、結果處理 |
| `frontend/src/components/ServiceTable.vue` | 新增 checkbox 列（表頭全選 + 傳遞 props） |
| `frontend/src/components/ServiceRow.vue` | 新增 checkbox `<td>` |
| `frontend/src/components/ConfirmModal.vue` | 新增 optional `details` prop |
| `frontend/src/composables/useToast.ts` | 新增 `warning` type 支援 |

---

## 8. 開發順序建議

| 階段 | 任務 | 預估工時 | 依賴 |
|------|------|---------|------|
| 1 | 後端 `HandleBatchServices` handler + 單元測試 | 2h | - |
| 2 | 前端 API client `batchServices()` + 型別定義 | 0.5h | 階段 1 |
| 3 | `BatchToolbar.vue` + `BatchResultPanel.vue` 元件 | 1.5h | - |
| 4 | `ConfirmModal.vue` 擴充 `details` prop | 0.5h | - |
| 5 | `ServiceTable.vue` + `ServiceRow.vue` checkbox 整合 | 1h | - |
| 6 | `DashboardView.vue` 整合全部 batch 邏輯 | 2h | 階段 3-5 |
| 7 | `useToast.ts` 擴充 warning type | 0.5h | - |
| 8 | 端到端整合測試 + 異常路徑測試 | 1.5h | 全部 |

---

*最後更新：2025-08-11*
