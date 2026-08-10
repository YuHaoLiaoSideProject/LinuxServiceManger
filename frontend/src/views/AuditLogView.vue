<script setup lang="ts">
import { onMounted } from 'vue'
import { useAuditLog } from '../composables/useAuditLog'
import { useToast } from '../composables/useToast'
import AuditTable from '../components/AuditTable.vue'
import EmptyState from '../components/EmptyState.vue'

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

const { showToast } = useToast()

onMounted(() => {
  fetchAuditLog(1)
})

function handleSearchInput(e: Event): void {
  const value = (e.target as HTMLInputElement).value
  onSearchInput(value)
}

function handleDateChange(): void {
  onDateRangeChange(dateFrom.value, dateTo.value)
}

async function handleExport(): Promise<void> {
  try {
    await exportCSV()
    showToast('稽核紀錄已匯出')
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : '匯出失敗'
    showToast(msg, 'error')
  }
}

function handleRetry(): void {
  fetchAuditLog(page.value)
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
  <div class="audit-page">
    <h2>Audit Log</h2>

    <!-- Toolbar -->
    <div class="audit-toolbar">
      <div class="search-box">
        <input
          type="text"
          placeholder="搜尋使用者、動作、目標服務..."
          :value="search"
          @input="handleSearchInput"
        />
      </div>

      <span v-if="search" class="search-result-count">找到 {{ total }} 筆紀錄</span>

      <div class="date-range">
        <input
          type="date"
          v-model="dateFrom"
          @change="handleDateChange"
          title="開始日期"
        />
        <span class="date-separator">–</span>
        <input
          type="date"
          v-model="dateTo"
          @change="handleDateChange"
          title="結束日期"
        />
      </div>

      <button class="btn-export" @click="handleExport">匯出 CSV</button>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="empty-state">
      <div class="spinner-sm"></div>
    </div>

    <!-- Error -->
    <div v-else-if="error" class="empty-state">
      <div class="empty-icon">⚠️</div>
      <p>{{ error }}</p>
      <button class="btn btn-secondary" @click="handleRetry">重試</button>
    </div>

    <!-- Empty: no records at all -->
    <div v-else-if="total === 0 && !hasActiveFilters()">
      <EmptyState />
      <p class="empty-hint">尚無操作紀錄</p>
    </div>

    <!-- No match with active filters -->
    <div v-else-if="entries.length === 0 && hasActiveFilters()" class="empty-state">
      <div class="empty-icon">🔍</div>
      <p>沒有符合條件的紀錄</p>
      <a href="#" class="clear-link" @click.prevent="clearFilters">清除過濾</a>
    </div>

    <!-- Records -->
    <div v-else>
      <AuditTable :entries="entries" />

      <!-- Pagination -->
      <div v-if="totalPages > 1" class="pagination">
        <button
          class="page-btn"
          :disabled="page <= 1"
          @click="goToPage(page - 1)"
        >
          上一頁
        </button>

        <template v-for="p in pageNumbers()" :key="p">
          <span v-if="p < 0" class="page-ellipsis">…</span>
          <button
            v-else
            class="page-btn"
            :class="{ active: p === page }"
            @click="goToPage(p)"
          >
            {{ p }}
          </button>
        </template>

        <button
          class="page-btn"
          :disabled="page >= totalPages"
          @click="goToPage(page + 1)"
        >
          下一頁
        </button>

        <span class="page-info">
          第 {{ page }} / {{ totalPages }} 頁，共 {{ total }} 筆
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.audit-page {
  padding: 24px;
  max-width: 1400px;
  margin: 0 auto;
}

.audit-page h2 {
  margin: 0 0 16px;
  font-size: 1.35rem;
}

.audit-toolbar {
  display: flex;
  gap: 16px;
  align-items: center;
  margin-bottom: 16px;
  flex-wrap: wrap;
}

.search-box input {
  width: 300px;
  padding: 8px 12px;
  border: 1px solid var(--lms-border);
  border-radius: 6px;
  font-size: 0.9rem;
  background: var(--lms-surface);
  color: var(--lms-text);
  transition: border-color var(--lms-transition), box-shadow var(--lms-transition);
}

.search-box input:focus {
  border-color: var(--lms-accent);
  box-shadow: 0 0 0 3px var(--lms-accent-light);
  outline: none;
}

.search-result-count {
  font-size: 0.85rem;
  color: var(--lms-muted);
  white-space: nowrap;
}

.date-range {
  display: flex;
  align-items: center;
  gap: 6px;
}

.date-range input[type="date"] {
  padding: 6px 10px;
  border: 1px solid var(--lms-border);
  border-radius: 6px;
  font-size: 0.85rem;
  background: var(--lms-surface);
  color: var(--lms-text);
}

.date-separator {
  color: var(--lms-muted);
}

.btn-export {
  padding: 8px 16px;
  background: var(--lms-accent);
  color: #fff;
  border: none;
  border-radius: 6px;
  font-size: 0.85rem;
  cursor: pointer;
  transition: background var(--lms-transition);
  white-space: nowrap;
}

.btn-export:hover {
  background: var(--lms-accent-hover);
}

.empty-hint {
  text-align: center;
  color: var(--lms-muted);
  margin-top: -2rem;
}

.clear-link {
  color: var(--lms-accent);
  text-decoration: none;
  font-size: 0.9rem;
}

.clear-link:hover {
  text-decoration: underline;
}

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
