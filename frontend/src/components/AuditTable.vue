<script setup lang="ts">
import type { AuditEntry } from '../composables/useAuditLog'
import { useI18n } from '../composables/useI18n'
import EmptyState from './EmptyState.vue'

defineProps<{
  entries: AuditEntry[]
}>()

const { t } = useI18n()

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

// 固定格式 YYYY-MM-DD HH:mm:ss（將 UTC 時間戳轉換為使用者系統本地時區）
function formatTime(iso: string): string {
  if (!iso) return '-'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
}

function actionLabel(action: string): string {
  const key = `audit.action.${action}`
  const translated = t(key)
  return translated !== key ? translated : action
}

function displayTarget(target: string): string {
  return target || '-'
}

function displayDetail(detail: string): string {
  return detail || '-'
}
</script>

<template>
  <div v-if="entries.length === 0">
    <EmptyState :message="t('audit.noRecords')" :showButton="false" />
  </div>
  <div v-else class="table-wrapper">
    <table aria-label="稽核操作紀錄">
      <caption class="sr-only">{{ t('audit.title') }}</caption>
      <thead>
        <tr>
          <th>{{ t('audit.col.time') }}</th>
          <th>{{ t('audit.col.user') }}</th>
          <th>{{ t('audit.col.sourceIp') }}</th>
          <th>{{ t('audit.col.action') }}</th>
          <th>{{ t('audit.col.target') }}</th>
          <th>{{ t('audit.col.result') }}</th>
          <th>{{ t('audit.col.detail') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="(entry, i) in entries"
          :key="i"
          :class="entry.result === 'success' ? 'row-success' : 'row-failure'"
        >
          <td :data-label="t('audit.col.time')">{{ formatTime(entry.timestamp) }}</td>
          <td :data-label="t('audit.col.user')">{{ entry.username }}</td>
          <td :data-label="t('audit.col.sourceIp')">{{ entry.source_ip }}</td>
          <td :data-label="t('audit.col.action')">{{ actionLabel(entry.action) }}</td>
          <td :data-label="t('audit.col.target')">{{ displayTarget(entry.target) }}</td>
          <td :data-label="t('audit.col.result')">
            <span
              class="badge"
              :class="entry.result === 'success' ? 'badge-success' : 'badge-failure'"
              role="status"
              :aria-label="entry.result === 'success' ? t('audit.result.success') : t('audit.result.failure')"
            >
              {{ entry.result === 'success' ? t('audit.result.success') : t('audit.result.failure') }}
            </span>
          </td>
          <td :data-label="t('audit.col.detail')">{{ displayDetail(entry.detail) }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
/* ── Fixed column widths (audit table) ──
   NOTE: main.css 的全域欄寬規則已 scope 到 .service-table，
   這裡為 Audit Table 定義自己的欄寬，避免 table-layout: fixed 下欄位錯位。 */
.table-wrapper table th:nth-child(1) { width: 18%; min-width: 12.5rem; }  /* Time */
.table-wrapper table th:nth-child(2) { width: 11%; }  /* User */
.table-wrapper table th:nth-child(3) { width: 14%; }  /* Source IP */
.table-wrapper table th:nth-child(4) { width: 10%; }  /* Action */
.table-wrapper table th:nth-child(5) { width: 15%; }  /* Target */
.table-wrapper table th:nth-child(6) { width: 9%; }   /* Result */
.table-wrapper table th:nth-child(7) { width: 23%; }  /* Detail */

/* Time: 完整時間戳不換行 */
.table-wrapper table td:nth-child(1) {
  white-space: nowrap;
}

/* Detail: 長訊息允許換行 */
.table-wrapper table td:nth-child(7) {
  overflow-wrap: break-word;
  word-break: break-word;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.row-success {
  background: rgba(0, 200, 0, 0.05);
}

.row-failure {
  background: rgba(255, 0, 0, 0.05);
}

.badge {
  display: inline-block;
  padding: 2px 10px;
  border-radius: 12px;
  font-size: 0.8rem;
  font-weight: 600;
  white-space: nowrap;
}

.badge-success {
  background: var(--lms-success);
  color: #fff;
}

.badge-failure {
  background: var(--lms-danger);
  color: #fff;
}
</style>
