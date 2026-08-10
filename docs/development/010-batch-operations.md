# 批次操作 — 開發規格

> **對應 Roadmap**：Phase 2 — `docs/development/002-expansion-roadmap.md` 項目 #8
> **技術決策**：`docs/tech-decisions/010-batch-operations.md`
> **操作流程**：`docs/interaction-flows/010-batch-operations.md`
> **BDD**：`docs/bdds/010-batch-operations.feature`
> **測試計畫**：`docs/test-plans/010-batch-operations測試計畫.md`
> **狀態**：設計完成，待開發

---

## 概述

讓管理員在 Dashboard 服務列表中選取多個服務，一次性執行 start / stop / restart 操作，後端循序執行並回報 per-service 結果。核心包含：

1. **後端 `HandleBatchServices` handler**：接收 `POST /api/v1/services/batch` 請求，驗證輸入，循序呼叫 systemd service manager，每個服務獨立寫入 audit log，回傳彙總結果
2. **前端選取狀態管理（DashboardView）**：在 `DashboardView.vue` 中以 `reactive(new Set<string>())` 管理服務選取集合，Tab 切換時清除，全部成功後清除，部分失敗後保留失敗項
3. **前端 `BatchToolbar.vue`**：選取 ≥1 個服務時 sticky 浮現，顯示選取計數 + Start/Stop/Restart 按鈕 + 進度文字 + 取消選取連結
4. **前端 `ConfirmModal.vue` 擴充**：新增 optional `details` prop，供批次確認對話框顯示受影響服務清單（最多 5 個 +「...及其他 M 個」）
5. **`ServiceTable.vue` / `ServiceRow.vue` checkbox 整合**：表頭全選 checkbox + 每列 checkbox（鎖定服務顯示 🔒）
6. **`useToast.ts` 擴充**：新增 `warning` type 支援黃色 Toast（部分失敗）
7. **`client.ts` API 層**：新增 `batchServices()` 函數與對應型別

---

## 1. 後端實作規格

### 1.1 依賴新增

無需新增外部依賴。使用既有的 `net/http`、`encoding/json`、`context`、`chi`。

### 1.2 檔案改動總覽

```
src/
├── main.go                                ← 修改：新增 POST /api/v1/services/batch 路由
├── internal/
│   ├── handler/
│   │   ├── json_handler.go               ← 修改：新增 HandleBatchServices()
│   │   └── handler_batch_test.go         ← 新增：批次 handler 單元測試
│   └── (systemd/audit/websocket 模組)    ← 無變更，僅使用既有介面
```

### 1.3 路由註冊（main.go 變更）

在 `main.go` 中既有的 JSON API protected group 內新增一行路由：

```go
// 在 r.Group(func(r chi.Router) { r.Use(middleware.AuthMiddlewareJSON) ... }) 區塊內新增：
r.Post("/api/v1/services/batch", h.HandleBatchServices)
```

位置：緊接在 `r.Post("/api/v1/services/{name}/disable", h.HandleDisableJSON)` 之後。

### 1.4 HandleBatchServices handler

**職責**：接收批次操作請求，驗證輸入（names ≤ 50、action 為 start/stop/restart、無鎖定服務），設定 60s context timeout，循序對每個服務呼叫 systemd manager，每個服務獨立寫入 audit log，彙總結果回傳。

**並發模型**：循序執行（for loop），不使用 goroutine。每個服務的錯誤被捕獲後不回傳中斷，繼續執行下一個。

```go
package handler

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"time"

	"linux-service-manager/internal/audit"
	"linux-service-manager/internal/auth"
)

// ── Request / Response types for batch operations ──

// batchRequest is the expected JSON body for POST /api/v1/services/batch.
type batchRequest struct {
	Names  []string `json:"names"`
	Action string   `json:"action"`
}

// batchResponse is the top-level JSON response for POST /api/v1/services/batch.
type batchResponse struct {
	Summary batchSummary   `json:"summary"`
	Results []batchResult  `json:"results"`
}

// batchSummary contains aggregated counts.
type batchSummary struct {
	Total   int `json:"total"`
	Success int `json:"success"`
	Failed  int `json:"failed"`
}

// batchResult describes the outcome for a single service.
type batchResult struct {
	Name   string `json:"name"`
	Action string `json:"action"`
	Result string `json:"result"`          // "success" | "failure"
	Error  string `json:"error,omitempty"` // populated only on failure
}

// ── Constants ──

const (
	maxBatchSize       = 50
	batchTimeout       = 60 * time.Second
)

var validBatchActions = map[string]bool{
	"start":   true,
	"stop":    true,
	"restart": true,
}

// ── Handler ──

// HandleBatchServices processes a batch service operation request.
// POST /api/v1/services/batch
func (h *Handler) HandleBatchServices(w http.ResponseWriter, r *http.Request) {
	// 1. Decode request body
	var req batchRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, messageJSON{Error: "invalid request body"})
		return
	}

	// 2. Validate: names must not be empty
	if len(req.Names) == 0 {
		writeJSON(w, http.StatusBadRequest, messageJSON{Error: "names must not be empty"})
		return
	}

	// 3. Validate: names count ≤ maxBatchSize
	if len(req.Names) > maxBatchSize {
		writeJSON(w, http.StatusBadRequest, messageJSON{
			Error: "batch size exceeds maximum of 50",
		})
		return
	}

	// 4. Validate: action must be one of {start, stop, restart}
	if !validBatchActions[req.Action] {
		writeJSON(w, http.StatusBadRequest, messageJSON{
			Error: "invalid action, must be start, stop, or restart",
		})
		return
	}

	// 5. Validate: no locked services in names
	services, err := h.systemd.ListServices()
	if err != nil {
		log.Printf("ERROR listing services for batch: %v", err)
		writeJSON(w, http.StatusInternalServerError, messageJSON{Error: "failed to list services"})
		return
	}
	lockedMap := make(map[string]bool, len(services))
	for _, svc := range services {
		if svc.Locked {
			lockedMap[svc.Name] = true
		}
	}
	for _, name := range req.Names {
		if lockedMap[name] {
			writeJSON(w, http.StatusBadRequest, messageJSON{
				Error: "locked service cannot be batch-operated: " + name,
			})
			return
		}
	}

	// 6. Set overall context timeout
	ctx, cancel := context.WithTimeout(r.Context(), batchTimeout)
	defer cancel()

	// 7. Get username for audit log
	username, _ := auth.GetSession(r).Values["username"].(string)
	clientIP := audit.ExtractClientIP(r)

	// 8. Sequential execution: iterate names, call systemd, write audit, collect results
	results := make([]batchResult, 0, len(req.Names))
	successCount := 0
	failedCount := 0

	for _, name := range req.Names {
		// Check context timeout before each operation
		if ctx.Err() != nil {
			results = append(results, batchResult{
				Name:   name,
				Action: req.Action,
				Result: "failure",
				Error:  "batch operation timed out",
			})
			failedCount++
			continue
		}

		// Call systemd manager based on action
		var svcErr error
		switch req.Action {
		case "start":
			svcErr = h.systemd.StartService(name)
		case "stop":
			svcErr = h.systemd.StopService(name)
		case "restart":
			svcErr = h.systemd.RestartService(name)
		}

		// Build result for this service
		if svcErr != nil {
			results = append(results, batchResult{
				Name:   name,
				Action: req.Action,
				Result: "failure",
				Error:  svcErr.Error(),
			})
			failedCount++
		} else {
			results = append(results, batchResult{
				Name:   name,
				Action: req.Action,
				Result: "success",
			})
			successCount++
		}

		// Write audit log (per service, independent)
		if h.Audit != nil {
			result := audit.ResultSuccess
			detail := ""
			if svcErr != nil {
				result = audit.ResultFailure
				detail = svcErr.Error()
			}
			// Map action string to audit.Action
			var auditAction audit.Action
			switch req.Action {
			case "start":
				auditAction = audit.ActionStart
			case "stop":
				auditAction = audit.ActionStop
			case "restart":
				auditAction = audit.ActionRestart
			}
			entry, entryErr := audit.NewEntry(username, clientIP,
				auditAction, name, result, detail)
			if entryErr == nil {
				h.Audit.Write(entry)
			}
		}
	}

	// 9. Return summary + results (always HTTP 200 — partial failure is still a valid response)
	resp := batchResponse{
		Summary: batchSummary{
			Total:   len(req.Names),
			Success: successCount,
			Failed:  failedCount,
		},
		Results: results,
	}
	writeJSON(w, http.StatusOK, resp)
}
```

### 1.5 後端單元測試覆蓋（handler_batch_test.go）

| 對應 BDD Scenario | 測試案例 |
|---|------|
| 後端接受批次操作請求 (API @p1) | `TestHandleBatchServices_Success` — 傳入 2 個 names + action=start，驗證回傳 200 + results 陣列 |
| 後端拒絕超過 50 個服務的批次請求 (API @p1) | `TestHandleBatchServices_ExceedsLimit` — 傳入 51 個 names，驗證 400 |
| 後端拒絕批次操作鎖定服務 (API @p1) | `TestHandleBatchServices_LockedService` — 傳入含 locked service 的 names，驗證 400 |
| 後端循序執行各服務操作 (API @p1) | `TestHandleBatchServices_SequentialOrder` — mock systemd 記錄呼叫順序，驗證依序呼叫 |
| 批次操作記錄寫入 Audit Log (API @p2) | `TestHandleBatchServices_AuditLogWritten` — 3 個服務全部成功，驗證 audit 寫入 3 筆 |
| 部分服務操作失敗 | `TestHandleBatchServices_PartialFailure` — mock systemd 對第 2 個回傳 error，驗證 results 含 1 success + 1 failure |
| 全部服務操作失敗 | `TestHandleBatchServices_AllFailure` — mock systemd 全部回傳 error，驗證 summary.failed=N |
| 逾時處理 | `TestHandleBatchServices_Timeout` — mock systemd block 超過 60s，驗證後續服務回傳 "batch operation timed out" |
| 請求 body 非 JSON | `TestHandleBatchServices_InvalidJSON` — 驗證 400 |
| names 為空陣列 | `TestHandleBatchServices_EmptyNames` — 驗證 400 |
| action 無效 | `TestHandleBatchServices_InvalidAction` — 驗證 400 |
| 未驗證 | `TestHandleBatchServices_Unauthenticated` — 無 session，驗證 401 |

---

## 2. 前端實作規格

### 2.1 檔案改動總覽

```
frontend/src/
├── types/
│   └── service.ts                      ← 修改：新增 BatchRequest / BatchResponse / BatchResult / BatchSummary
├── api/
│   └── client.ts                       ← 修改：新增 batchServices() 函數
├── composables/
│   └── useToast.ts                     ← 修改：新增 'warning' type
├── stores/
│   └── service.ts                      ← 無變更（選取狀態在 DashboardView 管理）
├── components/
│   ├── BatchToolbar.vue                ← 新增：批次操作工具列（sticky）
│   ├── BatchResultPanel.vue            ← 新增：批次結果展開面板
│   ├── ConfirmModal.vue                ← 修改：新增 optional details prop
│   ├── ServiceTable.vue                ← 修改：thead 新增全選 checkbox；傳遞 selected/locked props
│   └── ServiceRow.vue                  ← 修改：新增 checkbox <td>（最左側）
└── views/
    └── DashboardView.vue               ← 修改：整合 selectedNames、batch action、BatchToolbar、結果處理
```

### 2.2 TypeScript 型別擴充（types/service.ts）

```typescript
// ── Batch Operation Types ──

export interface BatchRequest {
  names: string[]
  action: ServiceAction  // 'start' | 'stop' | 'restart'
}

export interface BatchResult {
  name: string
  action: ServiceAction
  result: 'success' | 'failure'
  error?: string
}

export interface BatchSummary {
  total: number
  success: number
  failed: number
}

export interface BatchResponse {
  summary: BatchSummary
  results: BatchResult[]
}

// Toast type 擴充：新增 'warning'
// （useToast.ts 的 Toast interface 同步修改）
```

### 2.3 API client 擴充（api/client.ts）

```typescript
// 新增 import
import type { BatchRequest, BatchResponse } from '../types/service'

// 新增函數（放在既有的 disableService 之後）
export async function batchServices(req: BatchRequest): Promise<BatchResponse> {
  const { data } = await api.post<BatchResponse>('/services/batch', req, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 65_000, // 略大於後端 batchTimeout (60s)
  })
  return data
}
```

### 2.4 useToast 擴充（composables/useToast.ts）

```typescript
// interface Toast 中，type 擴充為：
type: 'success' | 'error' | 'warning'

// showToast 第二參數擴充型別：
type ToastType = 'success' | 'error' | 'warning'
```

### 2.5 DashboardView.vue — 選取狀態管理與批次整合

**新增的 local state**（寫在 `<script setup>` 頂部，現有 state 之後）：

```typescript
// ── Batch operation state ──
import { reactive, computed, ref, type Ref } from 'vue'
import type { BatchResponse, BatchResult } from '../types/service'
import { batchServices } from '../api/client'
import BatchToolbar from '../components/BatchToolbar.vue'
import BatchResultPanel from '../components/BatchResultPanel.vue'

const selectedNames = reactive<Set<string>>(new Set())
const batchExecuting = ref(false)
const batchProgress = ref<{ done: number; total: number } | null>(null)
const batchResults = ref<BatchResponse | null>(null)
const batchConfirmAction = ref<ServiceAction | null>(null)
const showBatchConfirm = ref(false)

// ── Computed ──
const selectedCount = computed(() => selectedNames.size)

const selectedServices = computed(() =>
  services.value.filter(s => selectedNames.has(s.name))
)

// Websocket suppression during batch
on('status_change', (msg: any) => {
  if (batchExecuting.value) return  // 批次執行中暫不處理
  // ... 現有邏輯保持不變
})

// ── Selection helpers ──
function toggleSelection(name: string) {
  if (selectedNames.has(name)) {
    selectedNames.delete(name)
  } else {
    selectedNames.add(name)
  }
}

function selectAllFiltered(filteredNames: string[]) {
  // 僅選取非鎖定且出現在 filteredNames 中的服務
  for (const svc of services.value) {
    if (!svc.locked && filteredNames.includes(svc.name)) {
      selectedNames.add(svc.name)
    }
  }
}

function clearSelection() {
  selectedNames.clear()
}

// Tab 變更時清除選取（在既有的 setTab 函數中新增 clearSelection()）
// 注意：tab.value 的 watch 已由 @set-tab 事件觸發 setTab 處理，
// 在 setTab() 尾端加入：
//   clearSelection()
```

**批次確認與執行**：

```typescript
// ── Batch confirm flow ──
function onBatchAction(action: ServiceAction) {
  batchConfirmAction.value = action
  showBatchConfirm.value = true
}

const batchConfirmMessage = computed(() => {
  if (!batchConfirmAction.value) return ''
  const count = selectedCount.value
  const labelMap: Record<string, string> = {
    start: `確定要啟動 ${count} 個服務？`,
    stop: `確定要停止 ${count} 個服務？`,
    restart: `確定要重啟 ${count} 個服務？`,
  }
  let msg = labelMap[batchConfirmAction.value] || ''
  if (batchConfirmAction.value === 'restart') {
    msg += '\n重啟會造成服務短暫中斷'
  }
  return msg
})

// 受影響服務清單 — 用於 details prop（最多 5 個 +「...及其他 M 個」）
const batchConfirmDetails = computed(() => {
  const names = Array.from(selectedNames)
  if (names.length <= 5) return names.join(', ')
  return names.slice(0, 5).join(', ') + ` ...及其他 ${names.length - 5} 個`
})

async function executeBatch() {
  const action = batchConfirmAction.value
  if (!action) return

  showBatchConfirm.value = false
  batchExecuting.value = true
  batchResults.value = null

  const names = Array.from(selectedNames)
  batchProgress.value = { done: 0, total: names.length }

  try {
    // 前端不會真的逐步更新進度（HTTP 為單次 request-response），
    // 而是在請求發出後顯示「正在執行...」
    const resp = await batchServices({ names, action })
    batchResults.value = resp

    // Process results
    if (resp.summary.failed === 0) {
      // All success → green toast + clear + reload
      showToast(`${resp.summary.success} 個服務已成功${actionLabel(action)}`, 'success')
      clearSelection()
      batchProgress.value = null
      await loadServices()
    } else if (resp.summary.success === 0) {
      // All failure → red toast + keep selection
      showToast('批次操作失敗', 'error')
    } else {
      // Partial failure → yellow toast + keep failed in selection
      showToast(`${resp.summary.success} 成功，${resp.summary.failed} 失敗`, 'warning')
      // Keep only failed services selected for retry
      const failedNames = new Set(
        resp.results.filter(r => r.result === 'failure').map(r => r.name)
      )
      for (const name of selectedNames) {
        if (!failedNames.has(name)) selectedNames.delete(name)
      }
      await loadServices()
    }
  } catch (err: any) {
    showToast(err.response?.data?.error || '批次操作失敗', 'error')
    batchResults.value = null
  } finally {
    batchExecuting.value = false
    batchProgress.value = null
    batchConfirmAction.value = null
  }
}

function actionLabel(action: ServiceAction): string {
  return { start: '啟動', stop: '停止', restart: '重啟' }[action]
}

function cancelBatch() {
  showBatchConfirm.value = false
  batchConfirmAction.value = null
}
```

**Template 整合**（新增於 `<Toolbar ... />` 之後、`<ServiceTable ... />` 之前）：

```html
<BatchToolbar
  v-if="selectedCount > 0"
  :selectedCount="selectedCount"
  :executing="batchExecuting"
  :progress="batchProgress"
  @batch-action="onBatchAction"
  @clear-selection="clearSelection"
/>

<BatchResultPanel
  v-if="batchResults && batchResults.summary.failed > 0"
  :results="batchResults.results"
  @retry="(name) => handleAction('restart', name)"
  @dismiss="batchResults = null"
/>
```

**ServiceTable props 擴充**：

```html
<ServiceTable
  :filteredServices="filteredServices"
  :tab="tab"
  :loading="loading"
  :togglingService="togglingService"
  :selectedNames="selectedNames"
  :batchExecuting="batchExecuting"
  @action="handleAction"
  @refresh="loadServices"
  @toggle="handleToggle"
  @open-logs="openLogDrawer"
  @clear-filters="clearAllFilters"
  @toggle-select="toggleSelection"
  @select-all="selectAllFiltered"
/>
```

**既有 ConfirmModal 擴充**（批次確認新增獨立的 ConfirmModal instance）：

```html
<ConfirmModal
  :show="showBatchConfirm"
  :message="batchConfirmMessage"
  :details="batchConfirmDetails"
  @confirm="executeBatch"
  @cancel="cancelBatch"
/>
```

**Tab 切換清除選取**（在既有的 `setTab` 函數尾端新增）：

```typescript
function setTab(t: string) {
  tab.value = t
  localStorage.setItem('lms-tab', t)
  clearSelection()  // ← 新增
}
```

### 2.6 BatchToolbar.vue（新元件）

**職責**：顯示選取計數、Start/Stop/Restart 按鈕、執行中進度、取消選取連結。sticky 定位於列表上方。選取數量 = 0 時由父層 `v-if` 隱藏。

```vue
<script setup lang="ts">
import type { ServiceAction } from '../types/service'
import { useI18n } from '../composables/useI18n'

const { t } = useI18n()

defineProps<{
  selectedCount: number
  executing: boolean
  progress: { done: number; total: number } | null
}>()

defineEmits<{
  'batch-action': [action: ServiceAction]
  'clear-selection': []
}>()
</script>

<template>
  <div class="batch-toolbar" :class="{ 'batch-executing': executing }">
    <span class="batch-count">
      已選取 <strong>{{ selectedCount }}</strong> 個服務
    </span>

    <template v-if="executing && progress">
      <span class="batch-progress">正在執行... {{ progress.done }}/{{ progress.total }}</span>
    </template>

    <template v-if="!executing">
      <button class="btn btn-start" @click="$emit('batch-action', 'start')">
        ▶ {{ t('action.start') }}
      </button>
      <button class="btn btn-stop" @click="$emit('batch-action', 'stop')">
        ⏹ {{ t('action.stop') }}
      </button>
      <button class="btn btn-restart" @click="$emit('batch-action', 'restart')">
        🔄 {{ t('action.restart') }}
      </button>
    </template>

    <button v-if="!executing" class="btn-clear-link" @click="$emit('clear-selection')">
      取消選取
    </button>
  </div>
</template>

<style scoped>
/* See §7 for key CSS definitions */
</style>
```

### 2.7 BatchResultPanel.vue（新元件）

**職責**：顯示批次操作結果的詳細面板，支援展開/收合。列出每個服務的成功/失敗狀態及錯誤原因。僅在部分失敗或全部失敗時顯示。

```vue
<script setup lang="ts">
import { ref } from 'vue'
import type { BatchResult } from '../types/service'

defineProps<{
  results: BatchResult[]
}>()

defineEmits<{
  retry: [name: string]
  dismiss: []
}>()

const collapsed = ref(false)
</script>

<template>
  <div class="batch-result-panel">
    <div class="result-header">
      <span class="result-summary">
        <!-- 由父層傳入時已做過摘要，此處顯示詳細列表 -->
        操作結果
      </span>
      <button class="btn-dismiss" @click="$emit('dismiss')">✕</button>
    </div>
    <div :class="{ collapsed }">
      <div v-for="r in results" :key="r.name" class="result-item">
        <span :class="r.result === 'success' ? 'result-ok' : 'result-fail'">
          {{ r.result === 'success' ? '✅' : '❌' }}
        </span>
        <span class="result-name">{{ r.name }}</span>
        <span v-if="r.result === 'success'" class="result-detail">已成功{{ r.action === 'start' ? '啟動' : r.action === 'stop' ? '停止' : '重啟' }}</span>
        <span v-else class="result-error">{{ r.error }}</span>
        <button v-if="r.result === 'failure'" class="btn-retry" @click="$emit('retry', r.name)">重試</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* See §7 for key CSS definitions */
</style>
```

### 2.8 ConfirmModal.vue 擴充

**變更**：新增 optional `details` prop。若 `details` 有值，在 `<p>{{ message }}</p>` 下方追加一行顯示服務清單。

```vue
<script setup lang="ts">
import { useI18n } from '../composables/useI18n'

const { t } = useI18n()
defineProps<{
  show: boolean
  message: string
  details?: string  // ← 新增：受影響服務清單
}>()
defineEmits<{ confirm: []; cancel: [] }>()
</script>

<template>
  <Teleport to="body">
    <div v-if="show" class="lms-modal-overlay" @click.self="$emit('cancel')">
      <div class="lms-modal" role="alertdialog" aria-modal="true">
        <h3>{{ t('modal.title') }}</h3>
        <p class="modal-message">{{ message }}</p>
        <!-- 新增：受影響服務清單（批次確認時顯示） -->
        <p v-if="details" class="modal-details">{{ details }}</p>
        <div class="lms-modal-actions">
          <button class="secondary" @click="$emit('cancel')">{{ t('modal.cancel') }}</button>
          <button class="btn-danger" @click="$emit('confirm')" autofocus>{{ t('modal.confirm') }}</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
```

### 2.9 ServiceTable.vue checkbox 整合

**變更**：
- 新增 props: `selectedNames: Set<string>`, `batchExecuting: boolean`
- thead 表頭新增 `<th>` 含全選 checkbox
- 傳遞 `selected` / `locked` / `batchExecuting` props 給 ServiceRow
- emit 新增 `toggle-select` / `select-all`

```typescript
// 新增 props
defineProps<{
  // ... existing props
  selectedNames: Set<string>
  batchExecuting: boolean
}>()

// 新增 emits
emit('toggle-select', [name: string])
emit('select-all', [filteredNames: string[]])

// 全選邏輯
const allSelected = computed(() => {
  const selectable = displayServices.value.filter(s => !s.locked)
  return selectable.length > 0 && selectable.every(s => selectedNames.has(s.name))
})

const selectableCount = computed(() =>
  displayServices.value.filter(s => !s.locked).length
)

function onSelectAll() {
  if (allSelected.value) {
    // Deselect all: parent handles via select-all with empty array
    emit('select-all', [])
  } else {
    emit('select-all', displayServices.value.filter(s => !s.locked).map(s => s.name))
  }
}
```

Template 表頭變更：

```html
<thead>
  <tr>
    <!-- 新增：全選 checkbox -->
    <th class="col-check">
      <input
        type="checkbox"
        :checked="allSelected"
        :disabled="selectableCount === 0 || batchExecuting"
        @change="onSelectAll"
      />
    </th>
    <th class="sortable" @click="toggleSort('name')">
      <!-- existing content -->
    </th>
    <!-- ... existing th columns ... -->
  </tr>
</thead>
```

ServiceRow 傳遞：

```html
<ServiceRow
  v-for="svc in displayServices"
  :key="svc.name"
  :service="svc"
  :togglingService="togglingService"
  :selected="selectedNames.has(svc.name)"
  :batchExecuting="batchExecuting"
  @action="onAction"
  @toggle="(action, name) => emit('toggle', action, name)"
  @open-logs="(name) => emit('open-logs', name)"
  @toggle-select="(name) => emit('toggle-select', name)"
/>
```

### 2.10 ServiceRow.vue checkbox 整合

**變更**：
- 新增 props: `selected: boolean`, `batchExecuting: boolean`
- 新增 emit: `toggle-select: [name: string]`
- 最左側新增 `<td>` 含 checkbox（鎖定服務顯示 🔒）

```typescript
// 新增 props
defineProps<{
  // ... existing props
  selected: boolean
  batchExecuting: boolean
}>()

// 新增 emits
emit('toggle-select', [name: string])
```

Template 變更（在 `<tr>` 內最前面新增 `<td>`）：

```html
<tr>
  <!-- 新增：勾選欄位 -->
  <td class="col-check" :data-label="'選取'">
    <span v-if="service.locked" class="locked-icon" title="服務已鎖定">🔒</span>
    <input
      v-else
      type="checkbox"
      :checked="selected"
      :disabled="batchExecuting"
      @change="$emit('toggle-select', service.name)"
    />
  </td>
  <td :data-label="t('col.name')">{{ service.name }}</td>
  <!-- ... existing td elements unchanged ... -->
</tr>
```

---

## 3. API 合約

### POST /api/v1/services/batch

| 項目 | 內容 |
|------|------|
| **Method** | POST |
| **Path** | `/api/v1/services/batch` |
| **Auth** | 需要 session（`AuthMiddlewareJSON`） |
| **Content-Type** | `application/json` |
| **Timeout** | 後端 60s / 前端 65s |

#### Request Body

```json
{
  "names": ["nginx.service", "docker.service"],
  "action": "start"
}
```

| 欄位 | 型別 | 必填 | 說明 |
|------|------|:---:|------|
| `names` | `string[]` | ✅ | 服務名稱陣列，上限 50 個 |
| `action` | `string` | ✅ | `start` / `stop` / `restart` |

#### Success Response — 200 OK

```json
{
  "summary": {
    "total": 2,
    "success": 1,
    "failed": 1
  },
  "results": [
    {
      "name": "nginx.service",
      "action": "start",
      "result": "success"
    },
    {
      "name": "docker.service",
      "action": "start",
      "result": "failure",
      "error": "exit code 1: failed to start docker.service"
    }
  ]
}
```

| 欄位 | 型別 | 說明 |
|------|------|------|
| `summary.total` | `int` | 請求的服務總數 |
| `summary.success` | `int` | 成功數 |
| `summary.failed` | `int` | 失敗數 |
| `results[].name` | `string` | 服務名稱 |
| `results[].action` | `string` | 執行的操作 |
| `results[].result` | `string` | `success` / `failure` |
| `results[].error` | `string` | 僅失敗時填充，錯誤原因 |

#### Error Responses

| HTTP Status | Body | 情境 |
|:---:|------|------|
| 400 | `{"error": "invalid request body"}` | 請求 body 非合法 JSON |
| 400 | `{"error": "names must not be empty"}` | names 為空陣列 |
| 400 | `{"error": "batch size exceeds maximum of 50"}` | names.length > 50 |
| 400 | `{"error": "invalid action, must be start, stop, or restart"}` | action 不是合法值 |
| 400 | `{"error": "locked service cannot be batch-operated: sshd.service"}` | 包含鎖定服務 |
| 401 | `{"error": "..."}` | 未登入（由 AuthMiddlewareJSON 攔截） |
| 500 | `{"error": "failed to list services"}` | systemd.ListServices 失敗 |

#### BDD Scenario 對應表

| BDD Scenario | API 合約對應 |
|------|------|
| 後端接受批次操作請求 (@api @p1) | 200 + results 陣列 |
| 後端拒絕批次操作鎖定服務 (@api @p1) | 400 "locked service cannot be batch-operated" |
| 後端拒絕超過 50 個服務的批次請求 (@api @p1) | 400 "batch size exceeds maximum of 50" |
| 後端循序執行各服務操作 (@api @p1) | 後端 for-loop 實作保證 |
| 批次操作記錄寫入 Audit Log (@api @p2) | 後端在 for loop 中每筆呼叫 `Audit.Write()` |

---

## 4. 資料流

```
使用者選取多個服務 → selectedNames Set 更新 → BatchToolbar 浮現
  │
  ├─ 點擊 Start/Stop/Restart 按鈕
  │     │
  │     ├─ ConfirmModal（顯示 details 服務清單）
  │     │     ├─ 取消 → 回到選取狀態
  │     │     └─ 確認 → executeBatch()
  │     │
  │     └─ executeBatch()
  │           ├─ batchExecuting = true → 抑制 WebSocket status_change
  │           ├─ POST /api/v1/services/batch  { names, action }
  │           │     │
  │           │     ├─ 後端: 驗證 → for loop { systemd.StartService(name); audit.Write() }
  │           │     └─ 回傳 { summary, results }
  │           │
  │           └─ 前端處理 results:
  │                 ├─ 全部成功 → green Toast + clearSelection() + loadServices()
  │                 ├─ 部分失敗 → yellow Toast + 保留失敗項 + BatchResultPanel 展開
  │                 └─ 全部失敗 → red Toast + 保留選取 + BatchResultPanel 展開
  │
  └─ 取消選取 → clearSelection() → BatchToolbar 隱藏

WebSocket 整合:
  - batchExecuting === true → status_change handler 直接 return（不更新列表）
  - 批次完成後 → loadServices() 完整重整，之後 WebSocket 恢復正常推送
```

---

## 5. 邊界條件處理

| 來源 | 邊界條件 | 處理方式 |
|------|---------|---------|
| BDD @edge-case + IF §6 | 鎖定服務排除 | 後端：請求含 locked service → 400 拒絕（不回傳 per-service error）。前端：ServiceRow locked=true 時顯示 🔒，不渲染 checkbox |
| BDD @edge-case + IF §6 | Tab 隔離（切換 Tab 清除選取） | `setTab()` 內呼叫 `clearSelection()`，selectedNames 清空 |
| BDD @edge-case + IF §6 | 全選僅作用於過濾結果 | `selectAllFiltered()` 接收 filteredNames，僅選取非鎖定且在過濾結果中的服務 |
| BDD @edge-case + IF §6 | 過濾結果為空時全選 disabled | `ServiceTable` 中 computed `selectableCount` 為 0 時，全選 checkbox `:disabled="true"` |
| BDD @edge-case + IF §6 | 批次上限 50 個 | 後端 `maxBatchSize = 50`，超限回傳 400。前端可選：全選時智能截斷至 50 個 + 顯示提示 |
| IF §6 | Restart 額外警告 | `batchConfirmMessage` computed 中，action=restart 時追加 "重啟會造成服務短暫中斷" |
| IF §5 | 選取中包含已不存在的服務 | systemctl 對不存在服務回傳 error → 後端標記該服務 failure → 前端結果面板顯示 "unit not found" → 下一輪 loadServices 重整排除 |
| IF §5 | 網路中斷（執行中） | axios timeout 設為 65s → 超時進入 catch block → Toast error "批次操作失敗" |
| IF §5 | 批次操作逾時（後端） | context.WithTimeout(60s) → 未執行的服務標記 "batch operation timed out" |
| BDD @p2 | 過濾後全選進行批次操作 | `selectAllFiltered` 僅作用於過濾後非鎖定服務 → POST 僅傳遞這些 names |
| Tech Decision #7 | WebSocket 抑制 | `batchExecuting = true` 時，WebSocket status_change handler 直接 return；操作完成後 loadServices() 重整 |

---

## 6. CSS 關鍵樣式

### 6.1 BatchToolbar（sticky + slide-down）

```css
.batch-toolbar {
  position: sticky;
  top: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
  background: var(--color-surface, #fff);
  border-bottom: 2px solid var(--color-primary, #1976d2);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
  animation: batch-slide-down 0.2s ease-out;
  flex-wrap: wrap;
}

.batch-toolbar.batch-executing {
  background: var(--color-surface-alt, #f3f5f7);
  border-bottom-color: var(--color-warning, #f9a825);
}

@keyframes batch-slide-down {
  from { opacity: 0; transform: translateY(-12px); }
  to   { opacity: 1; transform: translateY(0); }
}

.batch-count {
  font-size: 0.9rem;
  color: var(--color-text-secondary, #555);
}

.batch-count strong {
  color: var(--color-primary, #1976d2);
  font-size: 1.1rem;
}

.batch-progress {
  font-size: 0.9rem;
  color: var(--color-warning, #f9a825);
  font-weight: 600;
  animation: pulse 1.5s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.6; }
}

.batch-toolbar .btn {
  padding: 0.4rem 0.8rem;
  border-radius: 6px;
  border: 1px solid var(--color-border, #ccc);
  cursor: pointer;
  font-size: 0.85rem;
  transition: background 0.15s, opacity 0.15s;
}

.batch-toolbar .btn:hover { opacity: 0.85; }

.btn-start  { background: #e8f5e9; color: #2e7d32; border-color: #a5d6a7; }
.btn-stop   { background: #fff0f0; color: #c62828; border-color: #ef9a9a; }
.btn-restart { background: #e3f2fd; color: #1565c0; border-color: #90caf9; }

.btn-clear-link {
  background: none;
  border: none;
  color: var(--color-text-muted, #888);
  cursor: pointer;
  font-size: 0.85rem;
  text-decoration: underline;
  margin-left: auto;
}
```

### 6.2 BatchResultPanel

```css
.batch-result-panel {
  margin: 0 0 1rem 0;
  padding: 0.75rem 1rem;
  border: 1px solid var(--color-border, #ddd);
  border-radius: 8px;
  background: var(--color-surface, #fff);
}

.result-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.5rem;
}

.result-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.35rem 0;
  font-size: 0.9rem;
  border-bottom: 1px solid var(--color-border-light, #eee);
}

.result-name { font-family: monospace; min-width: 180px; }
.result-ok   { color: #2e7d32; }
.result-fail { color: #c62828; }
.result-error { color: #c62828; font-size: 0.85rem; flex: 1; }
.btn-retry { font-size: 0.8rem; padding: 0.2rem 0.5rem; cursor: pointer; }
.btn-dismiss { background: none; border: none; cursor: pointer; font-size: 1.1rem; }
```

### 6.3 Table checkbox column

```css
.col-check {
  width: 40px;
  text-align: center;
  padding: 0.5rem;
}

.col-check input[type="checkbox"] {
  width: 16px;
  height: 16px;
  cursor: pointer;
  accent-color: var(--color-primary, #1976d2);
}

.col-check input[type="checkbox"]:disabled {
  cursor: not-allowed;
  opacity: 0.4;
}

.locked-icon {
  font-size: 1rem;
  opacity: 0.6;
}
```

### 6.4 ConfirmModal details 文字

```css
.modal-details {
  font-family: monospace;
  font-size: 0.85rem;
  color: var(--color-text-muted, #666);
  background: var(--color-surface-alt, #f5f5f5);
  border-radius: 6px;
  padding: 0.5rem 0.75rem;
  margin-top: 0.25rem;
  white-space: pre-wrap;
  max-height: 120px;
  overflow-y: auto;
}

.modal-message {
  white-space: pre-line; /* 支援 \n 換行（Restart 警告訊息） */
}
```

### 6.5 Toast — warning type

```css
.toast-warning {
  background: #fff8e1;
  color: #e65100;
  border-left: 4px solid #f9a825;
}
```

### 6.6 RWD（手機 < 768px）

```css
@media (max-width: 767px) {
  .batch-toolbar {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.5rem;
    padding: 0.6rem;
  }
  .batch-toolbar .btn {
    width: 100%;
    text-align: center;
  }
  .col-check { width: 30px; }
}
```

---

## 7. 開發順序（DAG）

| 步驟 | 任務 | 依賴 | 產出 |
|:---:|------|------|------|
| **1** | `types/service.ts` — 新增 `BatchRequest`, `BatchResponse`, `BatchResult`, `BatchSummary` 型別 | - | 前端型別定義 |
| **2** | `composables/useToast.ts` — 擴充 `warning` type（Toast interface + showToast 參數） | - | Toast 支援 |
| **3** | `components/ConfirmModal.vue` — 新增 optional `details` prop + template 渲染 | - | 對話框擴充 |
| **4** | `components/BatchToolbar.vue` — 全新元件（props/emits/template/css） | - | 批次工具列 |
| **5** | `components/BatchResultPanel.vue` — 全新元件（props/emits/template/css） | - | 結果面板 |
| **6** | `components/ServiceRow.vue` — 新增 checkbox `<td>` | - | 列 checkbox |
| **7** | `components/ServiceTable.vue` — 新增全選 checkbox + 傳遞 props/emits | #6 | 表頭全選 |
| **8** | `api/client.ts` — 新增 `batchServices()` 函數 | #1 | API client |
| **9** | `internal/handler/json_handler.go` — 新增 `HandleBatchServices()` + request/response types | - | 後端 handler |
| **10** | `main.go` — 註冊 `POST /api/v1/services/batch` 路由 | #9 | 路由 |
| **11** | `internal/handler/handler_batch_test.go` — 批次 handler 單元測試 | #9 | 後端測試 |
| **12** | `views/DashboardView.vue` — 整合全部 batch 邏輯（state、computed、methods、template） | #1~#8 | 前端整合 |
| **13** | 前端整合測試 + 端對端測試（Playwright） | #12 | 驗收 |

**關鍵說明**：
- 步驟 1~8（前端基礎）可並行開發（彼此獨立，僅依賴 #1 的型別定義）
- 步驟 9~10（後端）與前端基礎可並行
- 步驟 12（DashboardView 整合）依賴所有前端基礎元件就緒
- 步驟 13（測試）在所有開發完成後執行

---

## 8. BDD Scenario 覆蓋矩陣

以下矩陣確保 BDD `.feature` 檔案中的每個 Scenario 在開發規格中都有對應的實作位置。

| # | BDD Scenario | 優先級 | 對應章節 | 實作位置 |
|---|------|:---:|------|------|
| 1 | 選取單一服務後顯示批次工具列 | P0 | §2.5, §2.6 | DashboardView `toggleSelection()` + BatchToolbar v-if |
| 2 | 取消所有勾選後隱藏批次工具列 | P0 | §2.5 | DashboardView `clearSelection()` → selectedCount=0 → v-if 隱藏 |
| 3 | 點擊表頭全選 checkbox 勾選所有可見解鎖服務 | P0 | §2.9, §2.5 | ServiceTable emit `select-all` → DashboardView `selectAllFiltered()` |
| 4 | 點擊表頭全選 checkbox 取消全選 | P0 | §2.9 | ServiceTable `onSelectAll()` 偵測 allSelected → emit select-all([]) |
| 5 | 透過工具列「取消選取」連結清除所有勾選 | P0 | §2.6 | BatchToolbar emit `clear-selection` → DashboardView `clearSelection()` |
| 6 | 鎖定服務不顯示 checkbox | P1 | §2.10 | ServiceRow `v-if="service.locked"` → 🔒 icon |
| 7 | 全選時排除鎖定服務 | P1 | §2.9, §2.5 | `selectAllFiltered()` 過濾 `!svc.locked` |
| 8 | 切換 Tab 時清除所有選取 | P1 | §2.5 | `setTab()` 尾端呼叫 `clearSelection()` |
| 9 | 全選僅勾選目前過濾結果中的解鎖服務 | P1 | §2.9, §2.5 | ServiceTable `select-all` emit filteredNames → `selectAllFiltered(filteredNames)` |
| 10 | 過濾結果為空時全選 checkbox 不可用 | P2 | §2.9 | ServiceTable `selectableCount === 0` → `:disabled="true"` |
| 11 | 批次選取上限為 50 個服務 | P1 | §1.4 | 後端 `maxBatchSize = 50` 驗證；前端可選截斷提示 |
| 12 | 批次工具列在表格捲動時固定可見 | P0 | §6.1 | CSS `position: sticky; top: 0;` |
| 13 | 選取數量變更時工具列即時更新 | P0 | §2.5, §2.6 | `selectedCount` computed → BatchToolbar prop reactive |
| 14 | 0 個選取時操作按鈕為 disabled | P1 | §2.6 | 父層 `v-if="selectedCount > 0"` 直接隱藏整個工具列 |
| 15 | 執行批次 Start 前顯示確認對話框 | P0 | §2.5 | `onBatchAction('start')` → showBatchConfirm=true |
| 16 | 執行批次 Stop 前顯示確認對話框 | P0 | §2.5 | `onBatchAction('stop')` → showBatchConfirm=true |
| 17 | 執行批次 Restart 前顯示確認對話框並附帶中斷提示 | P0 | §2.5 | `batchConfirmMessage` computed 中 action=restart 追加警告 |
| 18 | 確認對話框中服務清單超過 5 個時顯示摘要 | P0 | §2.5 | `batchConfirmDetails` computed 截斷 5 個 + "及其他 N 個" |
| 19 | 在確認對話框中點擊確認後執行操作 | P0 | §2.5 | `executeBatch()` |
| 20 | 在確認對話框中點擊取消後保留選取狀態 | P0 | §2.5 | `cancelBatch()` 僅關閉 modal，不清空 selectedNames |
| 21 | 批次操作全部成功 | P0 | §2.5 | `executeBatch()` → resp.summary.failed===0 → green toast + clear + reload |
| 22 | 批次操作期間顯示執行進度 | P0 | §2.5, §2.6 | BatchToolbar `executing=true` + progress prop |
| 23 | 批次操作部分失敗時顯示失敗清單 | P0 | §2.5, §2.7 | BatchResultPanel 展開，列出失敗服務 |
| 24 | 部分失敗後管理員可對失敗項目手動重試 | P1 | §2.7 | BatchResultPanel emit `retry` → DashboardView handleAction |
| 25 | 批次操作全部失敗時顯示所有錯誤 | P1 | §2.5, §2.7 | resp.summary.success===0 → red toast + BatchResultPanel |
| 26 | 批次執行期間網路中斷 | P1 | §5 | axios timeout (65s) → catch block |
| 27 | 批次操作整體逾時 | P1 | §1.4, §5 | 後端 `context.WithTimeout(60s)` → 未執行服務標記 "batch operation timed out" |
| 28 | 選取中包含已不存在的服務 | P2 | §1.4, §5 | 後端 systemctl error → per-service failure → 前端結果面板顯示 |
| 29 | 後端接受批次操作請求 | P1 | §1.4, §3 | HandleBatchServices + API 合約 |
| 30 | 後端拒絕批次操作鎖定服務 | P1 | §1.4, §3 | lockedMap 檢查 → 400 |
| 31 | 後端拒絕超過 50 個服務的批次請求 | P1 | §1.4, §3 | maxBatchSize 檢查 → 400 |
| 32 | 後端循序執行各服務操作 | P1 | §1.4 | for loop 循序呼叫 |
| 33 | 批次操作記錄寫入 Audit Log | P2 | §1.4 | for loop 中每筆 `h.Audit.Write()` |
| 34 | 使用搜尋過濾後全選進行批次操作 | P1 | §2.9, §2.5 | selectAllFiltered → POST 僅傳遞過濾結果 |
| 35 | 批次操作期間 WebSocket 推送不干擾進度顯示 | P2 | §2.5, §4 | `batchExecuting=true` → status_change return early |
| 36 | 不同佈景模式下 checkbox 與工具列樣式正常 | P2 | §6 | CSS 使用 `var(--color-...)` CSS variables |
| 37 | 手機 RWD 下 checkbox 與工具列佈局正常 | P2 | §6.6 | responsive CSS |
| 38 | 批次操作不同類型的基本流程 (Outline) | P0 | §2.5 | `batchServices()` action 參數驅動 |

---

*本文件由 develop-spec-generator 根據上下游設計文件自動產出。*