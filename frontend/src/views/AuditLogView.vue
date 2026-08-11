<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAuditLog } from '../composables/useAuditLog'
import { useToast } from '../composables/useToast'
import { useI18n } from '../composables/useI18n'
import { useAuthStore } from '../stores/auth'
import AppHeader from '../components/AppHeader.vue'
import AuditTable from '../components/AuditTable.vue'
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

function handleSearchInput(e: Event): void {
  const value = (e.target as HTMLInputElement).value
  onSearchInput(value)
}

function handleDateChange(): void {
  // Pre-validate: don't call composable with invalid range
  if (dateFrom.value && dateTo.value && dateFrom.value > dateTo.value) {
    return
  }
  onDateRangeChange(dateFrom.value, dateTo.value)
}

async function handleExport(): Promise<void> {
  if (exporting.value) return
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

    <!-- Toolbar -->
    <div class="audit-toolbar">
      <div class="search-box">
        <input
          type="text"
          name="audit-search"
          :placeholder="t('audit.searchPlaceholder')"
          :value="search"
          :aria-label="t('audit.searchPlaceholder')"
          @input="handleSearchInput"
        />
      </div>

      <span v-if="search" class="search-result-count">{{ t('audit.searchResultCount', { count: String(total) }) }}</span>

      <div class="date-range">
        <input
          type="date"
          name="audit-date-from"
          v-model="dateFrom"
          :aria-label="t('audit.dateFrom')"
          @change="handleDateChange"
        />
        <span class="date-separator">–</span>
        <input
          type="date"
          name="audit-date-to"
          v-model="dateTo"
          :aria-label="t('audit.dateTo')"
          @change="handleDateChange"
        />
      </div>

      <button
        class="btn-export"
        :disabled="exporting"
        :aria-label="t('audit.exportCsv')"
        @click="handleExport"
      >
        <span v-if="exporting" class="spinner-sm"></span>
        {{ exporting ? '...' : t('audit.exportCsv') }}
      </button>

      <button
        class="btn-refresh secondary"
        data-testid="btn-refresh"
        :disabled="loading"
        :aria-label="t('header.refresh.aria')"
        @click="handleRefresh"
      >{{ t('header.refresh') }}</button>
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
  display: inline-flex;
  align-items: center;
  gap: 6px;
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

.btn-export:hover:not(:disabled) {
  background: var(--lms-accent-hover);
}

.btn-export:disabled {
  opacity: 0.6;
  cursor: not-allowed;
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
