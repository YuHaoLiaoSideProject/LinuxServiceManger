<script setup lang="ts">
import type { AuditEntry } from '../composables/useAuditLog'
import EmptyState from './EmptyState.vue'

defineProps<{
  entries: AuditEntry[]
}>()

const ACTION_LABELS: Record<string, string> = {
  login: '登入',
  logout: '登出',
  start: '啟動',
  stop: '停止',
  restart: '重啟',
  enable: '啟用',
  disable: '停用',
}

function formatTime(iso: string): string {
  if (!iso) return '-'
  return iso.replace('T', ' ').replace(/\.\d+Z$/, '').replace('Z', '')
}

function actionLabel(action: string): string {
  return ACTION_LABELS[action] || action
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
    <EmptyState />
  </div>
  <div v-else class="table-wrapper">
    <table>
      <thead>
        <tr>
          <th>時間</th>
          <th>使用者</th>
          <th>來源 IP</th>
          <th>動作</th>
          <th>目標服務</th>
          <th>結果</th>
          <th>詳細資訊</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="(entry, i) in entries"
          :key="i"
          :class="entry.result === 'success' ? 'row-success' : 'row-failure'"
        >
          <td>{{ formatTime(entry.timestamp) }}</td>
          <td>{{ entry.username }}</td>
          <td>{{ entry.source_ip }}</td>
          <td>{{ actionLabel(entry.action) }}</td>
          <td>{{ displayTarget(entry.target) }}</td>
          <td>
            <span
              class="badge"
              :class="entry.result === 'success' ? 'badge-success' : 'badge-failure'"
            >
              {{ entry.result === 'success' ? '成功' : '失敗' }}
            </span>
          </td>
          <td>{{ displayDetail(entry.detail) }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
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
  background: #188038;
  color: #fff;
}

.badge-failure {
  background: #c5221f;
  color: #fff;
}
</style>
