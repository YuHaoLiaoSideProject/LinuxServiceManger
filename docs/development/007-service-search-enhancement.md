# 服務搜尋強化 — 開發規格

> **對應 Roadmap**：Phase 2 — `docs/development/002-expansion-roadmap.md` 項目 #4
> **技術決策**：`docs/tech-decisions/007-service-search-enhancement.md`
> **操作流程**：`docs/interaction-flows/007-service-search-enhancement.md`
> **BDD**：`docs/bdds/007-service-search-enhancement.feature`
> **測試計畫**：`docs/test-plans/007-service-search-enhancement測試計畫.md`
> **狀態**：設計完成，待開發

---

## 概述

在現有 Toolbar.vue 文字搜尋基礎上，加入：
1. **狀態過濾按鈕組**：All / 🟢 Running / 🔴 Failed / ⚪ Inactive（單選模式）
2. **正則模式開關**：切換文字搜尋為 RegExp 匹配
3. **複合過濾**：狀態過濾 ∩ 文字搜尋（取交集）
4. **URL 同步（P1）**：過濾狀態寫入 query string（`status`、`search`、`regex`）

所有過濾皆為純前端操作，不發送 API 請求。

---

## 1. 前端實作規格

### 1.1 檔案改動總覽

```
frontend/src/
├── composables/
│   └── useServiceFilter.ts        ← 新增：過濾邏輯 composable
├── components/
│   ├── Toolbar.vue                ← 修改：加入狀態過濾按鈕組 + 正則開關
│   ├── ServiceTable.vue           ← 修改：改用 useServiceFilter、空狀態
│   └── EmptyState.vue             ← 新增：空狀態元件
└── views/
    └── DashboardView.vue          ← 修改：初始化 URL sync
```

### 1.2 useServiceFilter composable（新增）

```typescript
// frontend/src/composables/useServiceFilter.ts
import { ref, computed, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useServiceStore } from '@/stores/service'
import type { Service } from '@/types/service'

export type StatusFilter = 'all' | 'running' | 'failed' | 'inactive'

export function useServiceFilter() {
  const store = useServiceStore()
  const route = useRoute()
  const router = useRouter()

  // ── 狀態 ──
  const statusFilter = ref<StatusFilter>('all')
  const searchText = ref('')
  const regexMode = ref(false)
  const regexError = ref<string | null>(null)

  // ── 從 URL 初始化 ──
  function initFromQuery() {
    const q = route.query
    if (q.status && ['running','failed','inactive'].includes(q.status as string)) {
      statusFilter.value = q.status as StatusFilter
    }
    if (q.search) searchText.value = q.search as string
    if (q.regex === 'true') regexMode.value = true
  }

  // ── 同步到 URL ──
  function syncToQuery() {
    const query: Record<string, string> = {}
    if (statusFilter.value !== 'all') query.status = statusFilter.value
    if (searchText.value) query.search = searchText.value
    if (regexMode.value) query.regex = 'true'
    router.replace({ query })
  }

  // ── 文字搜尋（debounce 150ms） ──
  let debounceTimer: ReturnType<typeof setTimeout>
  const debouncedSearch = ref('')
  watch(searchText, (val) => {
    clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      debouncedSearch.value = val
    }, 150)
  })

  // ── 正則驗證 ──
  function validateRegex(input: string): RegExp | null {
    try {
      return new RegExp(input)
    } catch (e: any) {
      regexError.value = `無效的正則表達式：${e.message}`
      return null
    }
  }

  // ── 核心過濾 ──
  const filteredServices = computed<Service[]>(() => {
    let list = store.services  // 當前 Tab 的服務集合

    // 1. 狀態過濾
    if (statusFilter.value !== 'all') {
      list = list.filter(s => s.activeState === statusFilter.value)
    }

    // 2. 文字 / 正則過濾
    if (debouncedSearch.value) {
      if (regexMode.value) {
        const regex = validateRegex(debouncedSearch.value)
        if (regex) {
          regexError.value = null
          list = list.filter(s => regex.test(s.name))
        }
        // regex 無效時不更新 list（維持上次結果）
      } else {
        regexError.value = null
        const lower = debouncedSearch.value.toLowerCase()
        list = list.filter(s => s.name.toLowerCase().includes(lower))
      }
    } else {
      regexError.value = null
    }

    return list
  })

  // ── 操作 ──
  function setStatusFilter(status: StatusFilter) {
    if (statusFilter.value === status) {
      statusFilter.value = 'all'  // 再次點擊取消
    } else {
      statusFilter.value = status
    }
  }

  function clearSearch() {
    searchText.value = ''
    debouncedSearch.value = ''
  }

  function toggleRegex() {
    regexMode.value = !regexMode.value
  }

  function clearAllFilters() {
    statusFilter.value = 'all'
    clearSearch()
    regexMode.value = false
  }

  // ── 監聽過濾條件變更 → 同步 URL ──
  watch([statusFilter, debouncedSearch, regexMode], () => {
    syncToQuery()
  })

  return {
    // state
    statusFilter,
    searchText,
    regexMode,
    regexError,
    // computed
    filteredServices,
    // actions
    setStatusFilter,
    clearSearch,
    toggleRegex,
    clearAllFilters,
    initFromQuery,
  }
}
```

### 1.3 Toolbar.vue 改動

```vue
<!-- 新增於搜尋框右側 -->
<template>
  <div class="toolbar">
    <!-- 既有：搜尋框 -->
    <div class="search-box" :class="{ 'has-error': regexError }">
      <input
        v-model="searchText"
        :placeholder="regexMode ? '正則搜尋，例如：nginx-.*' : '搜尋服務名稱...'"
        class="search-input"
      />
      <!-- 清除按鈕 -->
      <button v-if="searchText" class="search-clear" @click="clearSearch">✕</button>
      <!-- 正則開關 -->
      <button
        class="regex-toggle"
        :class="{ active: regexMode }"
        @click="toggleRegex"
        title="正則搜尋"
      >
        .*
      </button>
    </div>
    <!-- 正則錯誤提示 -->
    <p v-if="regexError" class="regex-error">{{ regexError }}</p>

    <!-- 新增：狀態過濾按鈕組 -->
    <div class="status-filters">
      <button
        v-for="opt in statusOptions"
        :key="opt.value"
        class="filter-btn"
        :class="{ active: statusFilter === opt.value }"
        :disabled="loading"
        @click="setStatusFilter(opt.value)"
      >
        {{ opt.icon }} {{ opt.label }}
      </button>
    </div>

    <!-- 既有：過濾後數量 -->
    <span class="filtered-count">{{ filteredServices.length }} 個服務</span>
  </div>
</template>

<script setup lang="ts">
import { useServiceFilter } from '@/composables/useServiceFilter'

const {
  statusFilter, searchText, regexMode, regexError,
  filteredServices,
  setStatusFilter, clearSearch, toggleRegex,
} = useServiceFilter()

const statusOptions = [
  { value: 'all', label: 'All', icon: '' },
  { value: 'running', label: 'Running', icon: '🟢' },
  { value: 'failed', label: 'Failed', icon: '🔴' },
  { value: 'inactive', label: 'Inactive', icon: '⚪' },
]

defineProps<{ loading: boolean }>()
</script>
```

### 1.4 EmptyState.vue（新增）

```vue
<template>
  <div class="empty-state">
    <img src="@/assets/empty-search.svg" alt="" class="empty-icon" />
    <p class="empty-text">沒有符合條件的服務</p>
    <button class="btn btn-secondary" @click="$emit('clear')">清除過濾</button>
  </div>
</template>

<script setup lang="ts">
defineEmits(['clear'])
</script>
```

### 1.5 ServiceTable.vue 改動

```vue
<template>
  <div class="service-table">
    <!-- 既有：表格 -->
    <table v-if="services.length > 0">
      <!-- ... -->
    </table>
    <!-- 新增：空狀態 -->
    <EmptyState v-else-if="!initialLoading" @clear="$emit('clear-filters')" />
  </div>
</template>

<script setup lang="ts">
import EmptyState from './EmptyState.vue'

defineProps<{
  services: Service[]
  initialLoading: boolean
}>()
defineEmits(['clear-filters'])
</script>
```

### 1.6 DashboardView.vue 改動

```vue
<script setup lang="ts">
import { onMounted } from 'vue'
import { useServiceFilter } from '@/composables/useServiceFilter'

const { filteredServices, initFromQuery, clearAllFilters } = useServiceFilter()

onMounted(() => {
  initFromQuery()
})
</script>

<template>
  <Toolbar :loading="loading" />
  <ServiceTable
    :services="filteredServices"
    :initial-loading="loading"
    @clear-filters="clearAllFilters"
  />
</template>
```

---

## 2. 型別定義

```typescript
// 新增於 frontend/src/types/service.ts 或 composables/useServiceFilter.ts
export type StatusFilter = 'all' | 'running' | 'failed' | 'inactive'

export interface FilterState {
  status: StatusFilter
  search: string
  regex: boolean
}
```

---

## 3. 資料流

```
                    ┌─────────────┐
                    │  URL query  │  (status, search, regex)
                    └──────┬──────┘
                           │ onMounted: initFromQuery()
                           ▼
┌──────────┐     ┌─────────────────────────┐
│  Pinia   │────▶│  useServiceFilter        │
│  store   │     │                         │
│ services │     │  statusFilter  ─────────▶│──┐
└──────────┘     │  searchText              │  │
                 │  regexMode               │  │
                 │  debouncedSearch (150ms) │  │
                 │                         │  │
                 │  filteredServices ◀─────│──┘
                 └──────────┬──────────────┘
                            │
                 ┌──────────▼──────────────┐
                 │  ServiceTable.vue        │
                 │  (renders filtered list) │
                 └──────────────────────────┘
```

- Pinia store `services` array 為原始資料，不直接修改
- `filteredServices` 為 computed，依賴 statusFilter + debouncedSearch + regexMode
- URL sync 為單向：過濾條件變更 → `router.replace({ query })`
- 初始化時從 `route.query` 恢復過濾條件
- Tab 切換時 Pinia store 更新 `services`（當前 Tab），computed 自動重新計算

---

## 4. 邊界條件處理

| 情境 | 處理方式 |
|------|---------|
| **載入中** | 狀態過濾按鈕 disabled；搜尋框可輸入但 filteredServices 暫不計算 |
| **載入完成** | 自動套用等待中的搜尋文字與過濾條件 |
| **正則語法錯誤** | regexError 設值、CSS class `has-error` 紅框、filteredServices 返回上次有效結果 |
| **修正正則** | 每次 debouncedSearch 變更時重試 new RegExp()，成功則清除 error |
| **關閉正則模式** | 清除 regexError，切回 substring 匹配 |
| **過濾結果為空** | ServiceTable 顯示 EmptyState 元件 |
| **清除過濾** | clearAllFilters() 重置所有條件為預設值 |
| **Tab 切換** | 過濾條件保留，filteredServices 自動對新 Tab 服務集合重新計算 |
| **瀏覽器上一頁** | `route.query` 變化觸發 watch → 重新套用過濾條件 |
| **URL 無參數** | 所有過濾條件為預設值 |

---

## 5. Debounce 實作細節

```
使用者輸入: n → g → i → n → x
                │         │
                │         └── 最後一次按鍵 +150ms → 以 "nginx" 執行篩選
                │
                └── 每次按鍵重置 timer，不觸發篩選
```

- 使用 `setTimeout` + `clearTimeout`，不引入額外依賴（VueUse 的 `useDebounceFn` 也可用）
- `debouncedSearch` 為獨立 ref，避免 `searchText`（v-model 綁定）直接觸發 computed

---

## 6. CSS 關鍵樣式

```css
/* 狀態過濾按鈕 */
.filter-btn {
  /* inactive: 透明背景、灰色邊框 */
}
.filter-btn.active {
  /* active: 依狀態著色 */
}
.filter-btn.active[data-status="running"] { background: #e8f5e9; color: #2e7d32; }
.filter-btn.active[data-status="failed"]  { background: #ffebee; color: #c62828; }
.filter-btn.active[data-status="inactive"] { background: #eceff1; color: #546e7a; }

/* 正則開關 */
.regex-toggle.active {
  /* highlight 樣式：背景變色、邊框加亮 */
}

/* 正則錯誤 */
.search-box.has-error .search-input {
  border-color: #e53935;
}
.regex-error {
  color: #e53935;
  font-size: 0.8rem;
}

/* RWD (≤768px) */
@media (max-width: 768px) {
  .status-filters {
    flex-wrap: wrap;
    gap: 4px;
  }
  .filter-btn {
    padding: 4px 8px;
    font-size: 0.8rem;
  }
}
```

---

## 7. 開發順序

| 步驟 | 內容 | 依賴 |
|------|------|------|
| 1 | 建立 `useServiceFilter.ts` composable | - |
| 2 | 改寫 `Toolbar.vue`：狀態過濾按鈕 + 正則開關 | #1 |
| 3 | 改寫 `ServiceTable.vue`：改用 filteredServices + 空狀態 | #1 |
| 4 | 建立 `EmptyState.vue` | - |
| 5 | 改寫 `DashboardView.vue`：整合 URL sync | #1, #3 |
| 6 | 加入 CSS 樣式（含 RWD、深色模式） | #2, #3 |
| 7 | 單元測試（Vitest）：useServiceFilter | #1 |
| 8 | E2E 測試（Playwright）：依 BDD scenarios | #2-6 |

---

*最後更新：2025-08-10*
