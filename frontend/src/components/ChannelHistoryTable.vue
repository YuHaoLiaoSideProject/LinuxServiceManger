<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { getNotifyHistory } from '../api/client'
import type { Channel, NotifyHistoryResult } from '../types/notify'
import { useI18n } from '../composables/useI18n'

const props = defineProps<{ channels: Channel[] }>()
const { t } = useI18n()

const loading = ref(false)
const result = ref<NotifyHistoryResult>({ data: [], total: 0, page: 1, limit: 30 })
const channelId = ref('')
const status = ref<'all' | 'success' | 'failure'>('all')
const currentPage = ref(1)
const totalPages = ref(1)

async function load(page = 1): Promise<void> {
  loading.value = true
  try {
    result.value = await getNotifyHistory({
      page,
      limit: 30,
      channel_id: channelId.value || undefined,
      status: status.value,
    })
    currentPage.value = result.value.page
    totalPages.value = Math.max(1, Math.ceil(result.value.total / result.value.limit))
  } finally {
    loading.value = false
  }
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

// 固定格式 YYYY-MM-DD HH:mm:ss（本地時間）
function formatTime(iso: string): string {
  if (!iso) return '-'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
}

function onChannelFilter(): void { load(1) }
function onStatusFilter(): void { load(1) }
function nextPage(): void { load(currentPage.value + 1) }

onMounted(() => { load(1) })
</script>

<template>
  <div class="history-panel">
    <div class="history-filters">
      <select v-model="channelId" data-testid="history-channel-filter" aria-label="篩選 Channel" @change="onChannelFilter">
        <option value="">{{ t('notify.allChannels') }}</option>
        <option v-for="ch in props.channels" :key="ch.id" :value="ch.id">{{ ch.name }}</option>
      </select>
      <select v-model="status" data-testid="history-status-filter" aria-label="篩選結果" @change="onStatusFilter">
        <option value="all">{{ t('notify.resultAll') }}</option>
        <option value="success">{{ t('notify.resultSuccess') }}</option>
        <option value="failure">{{ t('notify.resultFailure') }}</option>
      </select>
    </div>

    <div v-if="loading" class="loading-spinner" aria-busy="true" />
    <div v-else-if="result.data.length === 0" class="empty-state">尚無通知發送紀錄</div>

    <div v-else class="history-table-wrap">
      <table class="history-table">
        <thead>
          <tr>
            <th>{{ t('notify.colTime') }}</th>
            <th>{{ t('notify.colChannel') }}</th>
            <th>{{ t('notify.colEvent') }}</th>
            <th>{{ t('notify.colService') }}</th>
            <th>{{ t('notify.colResult') }}</th>
            <th>{{ t('notify.colError') }}</th>
            <th>耗時</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="h in result.data" :key="h.timestamp + h.channel_id">
            <td>{{ formatTime(h.timestamp) }}</td>
            <td>{{ h.channel_name }}</td>
            <td>{{ h.event }}</td>
            <td>{{ h.service }}</td>
            <td :class="h.status === 'success' ? 'result-success' : 'result-failure'">
              <span class="result-badge">
                {{ h.status === 'success' ? '🟢 ' + t('notify.resultSuccess') : '🔴 ' + t('notify.resultFailure') }}
              </span>
            </td>
            <td class="error-cell">{{ h.error || '' }}</td>
            <td>{{ h.duration_ms }}ms</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="result.total > 0" class="history-pager" role="navigation" aria-label="發送紀錄分頁">
      <button class="pager-btn" :disabled="currentPage <= 1" aria-label="上一頁" @click="load(currentPage - 1)">‹</button>
      <span class="pager-info">{{ t('notify.pageInfo', { page: String(currentPage), total: String(totalPages) }) }}</span>
      <button class="pager-btn" :disabled="currentPage >= totalPages" data-testid="history-next" aria-label="下一頁" @click="nextPage">›</button>
    </div>
  </div>
</template>

<style scoped>
.history-panel {
  margin-top: 0.25rem;
}

/* ── 篩選列（§4.3，36px 控制元件）── */
.history-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
  align-items: center;
  margin-bottom: 1rem;
}
.history-filters select {
  height: var(--lms-h);
  min-width: 160px;
  border: 1px solid var(--lms-border);
  border-radius: var(--lms-radius-sm);
  background: var(--lms-surface);
  color: var(--lms-text);
  padding: 0 0.5rem;
  font-size: 0.85rem;
  transition: border-color var(--lms-transition), box-shadow var(--lms-transition);
}
.history-filters select:focus {
  border-color: var(--lms-accent);
  box-shadow: 0 0 0 3px var(--lms-accent-light);
  outline: none;
}

.loading-spinner {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px;
}
.loading-spinner::after {
  content: '';
  width: 32px;
  height: 32px;
  border: 3px solid var(--lms-border);
  border-top-color: var(--lms-accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}

.empty-state {
  text-align: center;
  padding: 3rem 1rem;
  color: var(--lms-muted);
}

/* ── 表格（含 overflow-x 包裝）── */
.history-table-wrap {
  overflow-x: auto;
  border: 1px solid var(--lms-border);
  border-radius: var(--lms-radius);
  background: var(--lms-surface);
  box-shadow: var(--lms-shadow);
}
.history-table {
  width: 100%;
  /* 覆寫 global `table { table-layout: fixed }`：讓各欄依內容自動分配寬度，
     避免固定均分欄寬造成「時間」過長 overflow 而與 Channel 欄位重疊 */
  table-layout: auto;
  border-collapse: collapse;
  font-size: 0.85rem;
  min-width: 720px;
}
.history-table th,
.history-table td {
  padding: 0.6rem 0.75rem;
  text-align: left;
  border-bottom: 1px solid var(--lms-border);
}
.history-table thead th {
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--lms-muted);
  background: var(--lms-surface-2);
  white-space: nowrap;
}
.history-table tbody tr:last-child td {
  border-bottom: none;
}
.history-table tbody tr:hover {
  background: var(--lms-surface-2);
}
.history-table td {
  white-space: nowrap;
}

/* ── 結果 badge：文字 + 色彩雙重傳達（WCAG 1.4.1）── */
.result-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.15rem 0.55rem;
  border-radius: 999px;
  font-size: 0.78rem;
  font-weight: 600;
}
.result-success .result-badge {
  background: var(--lms-success-light);
  color: var(--lms-success);
  border: 1px solid var(--lms-success-border);
}
.result-failure .result-badge {
  background: var(--lms-danger-light);
  color: var(--lms-danger);
  border: 1px solid var(--lms-danger-border);
}

/* 錯誤訊息 mono + 換行 */
.error-cell {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.75rem;
  white-space: normal;
  word-break: break-word;
  max-width: 260px;
  color: var(--lms-muted);
}

/* ── 分頁控件 ── */
.history-pager {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.75rem;
  margin-top: 1rem;
}
.pager-info {
  font-size: 0.82rem;
  color: var(--lms-muted);
}
.pager-btn {
  height: var(--lms-h);
  min-width: var(--lms-h);
  border: 1px solid var(--lms-border);
  background: var(--lms-surface);
  color: var(--lms-text);
  border-radius: var(--lms-radius-sm);
  cursor: pointer;
  font-size: 1rem;
  line-height: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: border-color var(--lms-transition), background var(--lms-transition);
}
.pager-btn:hover:not(:disabled) {
  background: var(--lms-surface-2);
  border-color: var(--lms-accent);
}
.pager-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.pager-btn:focus-visible {
  outline: 2px solid var(--lms-accent);
  outline-offset: 2px;
}

/* ── RWD ── */
@media (max-width: 767px) {
  .history-filters {
    flex-direction: column;
    align-items: stretch;
  }
  .history-filters select {
    width: 100%;
    height: var(--lms-h-mobile);
    font-size: 16px;
  }
  .history-pager {
    justify-content: center;
  }
  .pager-btn {
    height: var(--lms-h-mobile);
    min-width: var(--lms-h-mobile);
  }
}
</style>
