<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAuditLog } from '../composables/useAuditLog'
import { useToast } from '../composables/useToast'
import { useI18n } from '../composables/useI18n'
import { useAuthStore } from '../stores/auth'
import AppHeader from '../components/AppHeader.vue'
import AuditTable from '../components/AuditTable.vue'
import DateRangeGroup from '../components/DateRangeGroup.vue'
import EmptyState from '../components/EmptyState.vue'

const { t } = useI18n()
const auth = useAuthStore()
const router = useRouter()
const { showToast } = useToast()

const {
  entries,
  total,
  page,
  loading,
  error,
  search,
  dateFrom,
  dateTo,
  totalPages,
  fetchAuditLog,
  goToPage,
  clearFilters,
  exportCSV,
  onSearchInput,
  onDateRangeChange,
} = useAuditLog()

const exporting = ref(false)

onMounted(() => {
  fetchAuditLog(1)
})

// ---------------------------------------------------------------------------
// 日期有效性（規格：docs/uiux/013 — 起 > 迄 → 紅框＋禁止查詢）
// ---------------------------------------------------------------------------

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

function isCompleteDate(v: string): boolean {
  return v === '' || DATE_RE.test(v)
}

function isValidDateValue(v: string): boolean {
  if (v === '') return true
  const m = DATE_RE.exec(v)
  if (!m) return false
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  const d = new Date(year, month - 1, day)
  return d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day
}

/** 起 > 迄（兩邊都填且格式完整）→ 整組紅框，禁止查詢/匯出 */
const dateInvalid = computed(() => {
  return isCompleteDate(dateFrom.value) && isCompleteDate(dateTo.value)
    && !!dateFrom.value && !!dateTo.value && dateFrom.value > dateTo.value
})

/** 過濾條件可送出：日期為空，或格式＋值皆合法 */
const filtersReady = computed(() => {
  return isValidDateValue(dateFrom.value) && isValidDateValue(dateTo.value) && !dateInvalid.value
})

function handleSearchInput(e: Event): void {
  const value = (e.target as HTMLInputElement).value
  onSearchInput(value)
}

function handleClearSearch(): void {
  onSearchInput('')
}

function handleDateChange(): void {
  // 起 > 迄：不送出查詢，修正後自動恢復（群組紅框由 dateInvalid 驅動）
  if (dateInvalid.value) return
  // 只送出「完整或空白」的日期，避免輸入中途發出無意義請求
  if (!isCompleteDate(dateFrom.value) || !isCompleteDate(dateTo.value)) return
  onDateRangeChange(dateFrom.value, dateTo.value)
}

async function handleExport(): Promise<void> {
  if (exporting.value || !filtersReady.value) return
  exporting.value = true
  try {
    await exportCSV()
    showToast(t('audit.exportSuccess'))
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : t('audit.exportFailed')
    showToast(msg, 'error')
  } finally {
    exporting.value = false
  }
}

function handleRetry(): void {
  fetchAuditLog(page.value)
}

function handleRefresh(): void {
  fetchAuditLog(page.value)
}

async function handleLogout(): Promise<void> {
  await auth.logout()
  router.replace('/login')
}

function hasActiveFilters(): boolean {
  return !!(search.value || dateFrom.value || dateTo.value)
}

// Generate page number array for pagination
function pageNumbers(): number[] {
  const max = totalPages.value
  if (max <= 7) {
    return Array.from({ length: max }, (_, i) => i + 1)
  }
  const current = page.value
  const pages: number[] = [1]

  let start = Math.max(2, current - 2)
  let end = Math.min(max - 1, current + 2)

  if (current <= 3) {
    end = Math.min(5, max - 1)
  }
  if (current >= max - 2) {
    start = Math.max(max - 4, 2)
  }

  if (start > 2) pages.push(-1)
  for (let i = start; i <= end; i++) pages.push(i)
  if (end < max - 1) pages.push(-2)
  pages.push(max)

  return pages
}
</script>

<template>
  <main class="app-container">
    <AppHeader
      :username="auth.username"
      @logout="handleLogout"
    />

    <h2>{{ t('audit.title') }}</h2>

    <!-- Toolbar（規格：docs/uiux/013-toolbar-audit-design.html） -->
    <div class="audit-toolbar">
      <div class="tb-row1">
        <!-- 搜尋框：icon + clear ✕ + focus ring（與 Dashboard 共用視覺語言） -->
        <div class="search-box" :class="{ 'has-value': search.length > 0 }">
          <svg class="search-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7"></circle>
            <path d="M21 21l-4.3-4.3"></path>
          </svg>
          <input
            type="search"
            name="audit-search"
            :value="search"
            :placeholder="t('audit.searchPlaceholder')"
            :aria-label="t('audit.searchPlaceholder')"
            :disabled="loading"
            autocomplete="off"
            @input="handleSearchInput"
          />
          <button
            v-show="search.length > 0"
            class="search-clear"
            type="button"
            :aria-label="t('search.clear.aria')"
            :title="t('search.clear.title')"
            @click="handleClearSearch"
          >✕</button>
        </div>

        <!-- 日期範圍群組：單一外框，起訖共用 border＋focus-within 光圈 -->
        <DateRangeGroup
          v-model:from="dateFrom"
          v-model:to="dateTo"
          :disabled="loading"
          :invalid="dateInvalid"
          :from-label="t('audit.dateFrom')"
          :to-label="t('audit.dateTo')"
          @change="handleDateChange"
        />

        <div class="actions-row">
          <!-- 匯出 CSV = Primary（accent 底，白 spinner） -->
          <button
            class="btn-export"
            :disabled="exporting || loading || !filtersReady"
            :class="{ loading: exporting }"
            :aria-label="t('audit.exportCsv')"
            @click="handleExport"
          >
            <span class="spin" aria-hidden="true"></span>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M12 3v12"></path>
              <path d="M7 10l5 5 5-5"></path>
              <path d="M4 21h16"></path>
            </svg>
            {{ t('audit.exportCsv') }}
          </button>

          <!-- 重新整理 = Secondary（surface-2 底，loading 時 spinner） -->
          <button
            class="btn-refresh"
            data-testid="btn-refresh"
            :disabled="loading || dateInvalid"
            :class="{ loading }"
            :aria-label="t('header.refresh.aria')"
            @click="handleRefresh"
          >
            <span class="spin" aria-hidden="true"></span>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M21 12a9 9 0 1 1-2.6-6.3"></path>
              <path d="M21 3v6h-6"></path>
            </svg>
            {{ t('header.refresh') }}
          </button>
        </div>
      </div>

      <!-- 條件回饋列：有過濾條件時顯示「符合 N 筆」＋「✕ 清除條件」 -->
      <div v-if="hasActiveFilters()" class="cond-row">
        <span class="cond-check" aria-hidden="true">✓</span>
        <span class="cond-text">
          {{ t('audit.matched.prefix') }} <b>{{ total }}</b> {{ t('audit.matched.suffix') }}
        </span>
        <button
          type="button"
          class="link-btn"
          :aria-label="t('audit.clearFilters')"
          @click="clearFilters"
        >✕ {{ t('audit.clearFilters') }}</button>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="empty-state">
      <div class="spinner-sm"></div>
    </div>

    <!-- Error -->
    <div v-else-if="error" class="empty-state">
      <div class="empty-icon">⚠️</div>
      <p>{{ error }}</p>
      <button class="btn btn-secondary" @click="handleRetry">{{ t('audit.retry') }}</button>
    </div>

    <!-- Empty: no records at all -->
    <div v-else-if="total === 0 && !hasActiveFilters()">
      <EmptyState :message="t('audit.noRecords')" :showButton="false" />
    </div>

    <!-- No match with active filters -->
    <div v-else-if="entries.length === 0 && hasActiveFilters()" class="empty-state">
      <div class="empty-icon">🔍</div>
      <p>{{ t('audit.noMatch') }}</p>
      <a href="#" class="clear-link" @click.prevent="clearFilters">{{ t('audit.clearFilters') }}</a>
    </div>

    <!-- Records -->
    <div v-else>
      <AuditTable :entries="entries" />

      <!-- Pagination -->
      <div v-if="totalPages > 1" class="pagination">
        <button
          class="page-btn"
          :disabled="page <= 1"
          :aria-label="t('audit.pagination.prev')"
          @click="goToPage(page - 1)"
        >
          {{ t('audit.pagination.prev') }}
        </button>

        <template v-for="p in pageNumbers()" :key="p">
          <span v-if="p < 0" class="page-ellipsis">…</span>
          <button
            v-else
            class="page-btn"
            :class="{ active: p === page }"
            :aria-label="`${t('audit.pagination.info', { page: String(p), total: String(totalPages), count: String(total) })}`"
            @click="goToPage(p)"
          >
            {{ p }}
          </button>
        </template>

        <button
          class="page-btn"
          :disabled="page >= totalPages"
          :aria-label="t('audit.pagination.next')"
          @click="goToPage(page + 1)"
        >
          {{ t('audit.pagination.next') }}
        </button>

        <span class="page-info">
          {{ t('audit.pagination.info', { page: String(page), total: String(totalPages), count: String(total) }) }}
        </span>
      </div>
    </div>
  </main>
</template>

<style scoped>
/* Toolbar 樣式已移至 main.css（與 Dashboard 共用 token，見 docs/uiux/013） */

/* ── 分頁（Audit 專用）── */
.pagination {
  display: flex;
  gap: 4px;
  justify-content: center;
  margin-top: 16px;
  align-items: center;
  flex-wrap: wrap;
}

.page-btn {
  padding: 6px 12px;
  border: 1px solid var(--lms-border);
  border-radius: 6px;
  background: var(--lms-surface);
  color: var(--lms-text);
  cursor: pointer;
  font-size: 0.85rem;
  transition: all var(--lms-transition);
}

.page-btn:hover:not(:disabled):not(.active) {
  border-color: var(--lms-accent);
  color: var(--lms-accent);
}

.page-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.page-btn.active {
  background: var(--lms-accent);
  color: #fff;
  border-color: var(--lms-accent);
}

.page-ellipsis {
  padding: 6px 4px;
  color: var(--lms-muted);
  font-size: 0.85rem;
}

.page-info {
  font-size: 0.8rem;
  color: var(--lms-muted);
  margin-left: 12px;
  white-space: nowrap;
}
</style>
