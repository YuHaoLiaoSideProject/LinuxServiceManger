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

// action key 對齊後端 snake_case（決策 1：config_view／token_*／notify_* 全數翻譯）
function actionLabel(action: string): string {
  const key = `audit.action.${action}`
  const translated = t(key)
  return translated !== key ? translated : action
}

// 依動作類型回傳語意化 inline SVG path（決策 4：6 類圖示，aria-hidden）
function actionIconPath(action: string): string {
  switch (action) {
    case 'login':
    case 'logout':
      // 登入／登出：進入／離開箭頭
      return 'M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3'
    case 'start':
      // 播放
      return 'M5 3l14 9-14 9V3z'
    case 'stop':
      // 停止方塊
      return 'M4 4h16v16H4z'
    case 'restart':
      // 重啟循環箭頭
      return 'M21 12a9 9 0 1 1-2.6-6.3M21 3v6h-6'
    case 'enable':
    case 'disable':
      // 電源開關
      return 'M18.4 4a10 10 0 1 1-12.8 0M12 2v10'
    case 'config_view':
    case 'config_save':
      // 文件
      return 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6'
    case 'token_create':
    case 'token_revoke':
      // 金鑰
      return 'M21 2l-2 2m-7.6 7.6a5.5 5.5 0 1 1-7.8 7.8 5.5 5.5 0 0 1 7.8-7.8zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4'
    case 'notify_create':
    case 'notify_update':
    case 'notify_delete':
    case 'notify_toggle':
    case 'notify_test':
      // 鈴鐺
      return 'M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0'
    default:
      return ''
  }
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
    <table class="audit-table" :aria-label="t('audit.title')">
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
          :key="`${entry.timestamp}-${i}`"
          :class="entry.result === 'success' ? 'row-success' : 'row-failure'"
        >
          <td :data-label="t('audit.col.time')" class="td-time">{{ formatTime(entry.timestamp) }}</td>
          <td :data-label="t('audit.col.user')" class="td-user">{{ entry.username }}</td>
          <td :data-label="t('audit.col.sourceIp')" class="td-ip">{{ entry.source_ip }}</td>
          <td :data-label="t('audit.col.action')" class="td-action">
            <svg
              v-if="actionIconPath(entry.action)"
              class="act-icon"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path :d="actionIconPath(entry.action)"></path>
            </svg>
            <span class="act-text">{{ actionLabel(entry.action) }}</span>
          </td>
          <td
            :data-label="t('audit.col.target')"
            class="td-target"
            :class="{ 'row-empty': displayTarget(entry.target) === '-' }"
          >{{ displayTarget(entry.target) }}</td>
          <td :data-label="t('audit.col.result')" class="td-result">
            <span
              class="badge"
              :class="entry.result === 'success' ? 'badge-success' : 'badge-failure'"
              :aria-label="entry.result === 'success' ? t('audit.result.success') : t('audit.result.failure')"
            >
              {{ entry.result === 'success' ? t('audit.result.success') : t('audit.result.failure') }}
            </span>
          </td>
          <td
            :data-label="t('audit.col.detail')"
            class="td-detail"
            :class="{ 'row-empty': !entry.detail }"
            :title="entry.detail || undefined"
          >{{ displayDetail(entry.detail) }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
/* ── Fixed column widths (audit table) ──
   NOTE: main.css 的全域欄寬規則已 scope 到 .service-table，
   這裡為 Audit Table 定義自己的欄寬，避免 table-layout: fixed 下欄位錯位。
   決策 8：Time 欄改用「絕對寬」而非 min-width —
   table-layout:fixed 下 cell 的 min-width 不具約束力（實測 iPad Air
   直向 138px < 內容 185px → 時間/使用者重疊），絕對 width 才會被遵守。 */
.table-wrapper table.audit-table th:nth-child(1) { width: 12.5rem; }  /* Time（絕對寬，防溢位重疊） */
.table-wrapper table.audit-table th:nth-child(2) { width: 11%; }  /* User */
.table-wrapper table.audit-table th:nth-child(3) { width: 14%; }  /* Source IP */
.table-wrapper table.audit-table th:nth-child(4) { width: 13%; }  /* Action */
.table-wrapper table.audit-table th:nth-child(5) { width: 13%; }  /* Target */
.table-wrapper table.audit-table th:nth-child(6) { width: 9%; }   /* Result */
.table-wrapper table.audit-table th:nth-child(7) { width: 22%; }  /* Detail */

/* Time: 完整時間戳不換行 */
.table-wrapper table.audit-table td:nth-child(1) {
  white-space: nowrap;
}

/* Detail: 長訊息 clamp 2 行（決策 3），title 顯示全文 */
.table-wrapper table.audit-table td:nth-child(7) {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
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

/* 決策 2：整列淡色 → 左側 3px 邊條（主題感知 token） */
.row-success {
  box-shadow: inset 3px 0 0 var(--lms-success-border);
}

.row-failure {
  box-shadow: inset 3px 0 0 var(--lms-danger-border);
}

/* 決策 2：Badge token 化 — 淡底深字，兩主題皆可讀 */
.badge {
  display: inline-block;
  padding: 2px 10px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
}

.badge-success {
  background: var(--lms-success-light);
  color: #137333;
}

.badge-failure {
  background: var(--lms-danger-light);
  color: #c62828;
}

[data-theme="dark"] .badge-success {
  background: rgba(24, 128, 56, 0.22);
  color: #8bdb9f;
}

[data-theme="dark"] .badge-failure {
  background: rgba(197, 34, 31, 0.22);
  color: #f2a19d;
}

/* 決策 4：Action 圖示 */
.act-icon {
  display: inline-block;
  flex-shrink: 0;
  vertical-align: -2px;
  margin-right: 4px;
  color: var(--lms-muted);
}

.act-text {
  white-space: nowrap;
}
</style>
