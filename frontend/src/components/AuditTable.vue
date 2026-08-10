<script setup lang="ts">
import type { AuditEntry } from '../composables/useAuditLog'
import { useI18n } from '../composables/useI18n'
import EmptyState from './EmptyState.vue'

defineProps<{
  entries: AuditEntry[]
}>()

const { t } = useI18n()

function formatTime(iso: string): string {
  if (!iso) return '-'
  return iso.replace('T', ' ').replace(/\.\d+Z$/, '').replace('Z', '')
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
