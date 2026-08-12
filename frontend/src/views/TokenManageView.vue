<script setup lang="ts">
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { useTokenManager } from '../composables/useTokenManager'
import AppHeader from '../components/AppHeader.vue'
import TokenCreateForm from '../components/TokenCreateForm.vue'
import TokenRevealModal from '../components/TokenRevealModal.vue'
import ConfirmModal from '../components/ConfirmModal.vue'

const auth = useAuthStore()
const router = useRouter()

async function handleLogout(): Promise<void> {
  await auth.logout()
  router.replace('/login')
}

const {
  sortedTokens, isLoading, error,
  showCreateForm, createFormName, createFormExpiry, createFormScope,
  createFormCustomDate, isSubmitting, createError, createFieldError,
  revealToken, showRevealModal,
  revokingToken, isRevoking, revokeError,
  expiryOptions,
  fetchTokens, resetCreateForm, submitCreate,
  closeRevealModal, copyTokenToClipboard, confirmRevoke,
  statusLabel, scopeLabel, formatDate, formatDateTime, formatExpiry,
} = useTokenManager()

onMounted(() => fetchTokens())

function openCreateForm(): void {
  resetCreateForm()
  showCreateForm.value = true
}

function cancelCreate(): void {
  showCreateForm.value = false
  resetCreateForm()
}

function openRevoke(token: typeof revokingToken.value): void {
  revokeError.value = null
  revokingToken.value = token
}
</script>

<template>
  <main class="app-container">
    <AppHeader
      :username="auth.username"
      @logout="handleLogout"
    />

  <div class="token-manage-view" data-testid="token-manage-view">
    <div class="page-header">
      <h2>
        <svg class="page-key-icon" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>
        API Tokens
      </h2>
      <button
        v-if="!showCreateForm"
        class="btn-primary"
        data-testid="open-create-form"
        @click="openCreateForm"
      >建立 Token</button>
    </div>

    <!-- 建立表單 -->
    <TokenCreateForm
      v-if="showCreateForm"
      :name="createFormName"
      :expiry="createFormExpiry"
      :scope="createFormScope"
      :custom-date="createFormCustomDate"
      :is-submitting="isSubmitting"
      :create-error="createError"
      :field-error="createFieldError"
      :expiry-options="expiryOptions"
      data-testid="create-form"
      @update:name="createFormName = $event"
      @update:expiry="createFormExpiry = $event"
      @update:scope="createFormScope = $event"
      @update:custom-date="createFormCustomDate = $event"
      @submit="submitCreate"
      @cancel="cancelCreate"
    />

    <!-- Loading：32px spinner（accent 頂邊色）+ 文字 -->
    <div v-if="isLoading" class="loading" data-testid="token-loading">
      <div class="spinner-lg" aria-hidden="true"></div>
      載入中...
    </div>

    <!-- Error -->
    <div v-else-if="error" class="error-state" data-testid="token-error">
      <p>{{ error }}</p>
      <button class="btn-primary" @click="fetchTokens">重試</button>
    </div>

    <!-- Empty state -->
    <div
      v-else-if="sortedTokens.length === 0"
      class="empty-state"
      data-testid="token-empty"
    >
      <div class="empty-icon">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>
      </div>
      <p>尚無 API Token</p>
    </div>

    <!-- Token 列表 -->
    <table v-else class="token-table" data-testid="token-table">
      <thead>
        <tr>
          <th>名稱</th>
          <th>Token</th>
          <th>建立日期</th>
          <th>過期時間</th>
          <th>最後使用</th>
          <th>權限範圍</th>
          <th>狀態</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="token in sortedTokens"
          :key="token.id"
          :class="{
            'row-revoked': token.status === 'revoked',
            'row-expired': token.status === 'expired'
          }"
          :data-testid="`token-row-${token.id}`"
        >
          <td :data-testid="`token-name-${token.id}`">{{ token.name }}</td>
          <td class="token-masked" data-label="Token">{{ token.prefix }}</td>
          <td data-label="建立">{{ formatDate(token.created_at) }}</td>
          <td data-label="過期">{{ formatExpiry(token.expires_at) }}</td>
          <td data-label="最後使用">{{ formatDateTime(token.last_used_at) }}</td>
          <td data-label="權限">{{ scopeLabel(token.scope) }}</td>
          <td>
            <span :class="`status-tag status-${token.status}`">
              <svg class="status-dot-svg" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><circle cx="5" cy="5" r="5" fill="currentColor"/></svg>
              {{ statusLabel(token.status) }}
            </span>
          </td>
          <td>
            <button
              v-if="token.status === 'active' || token.status === 'expiring_soon'"
              class="btn-danger-small"
              :data-testid="`revoke-btn-${token.id}`"
              @click="openRevoke(token)"
            >
              <svg class="icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
              撤銷
            </button>
            <span v-else class="no-action">—</span>
          </td>
        </tr>
      </tbody>
    </table>

    <!-- Token 揭露 Modal -->
    <TokenRevealModal
      :show="showRevealModal"
      :token="revealToken"
      @copy="copyTokenToClipboard"
      @close="closeRevealModal"
    />

    <!-- 撤銷確認 Modal -->
    <ConfirmModal
      :show="!!revokingToken"
      :message="`確定要撤銷 Token『${revokingToken?.name}』嗎？使用此 Token 的服務將立即失去存取權。此操作無法復原。`"
      :confirm-loading="isRevoking"
      :confirm-error="revokeError"
      @confirm="revokingToken && confirmRevoke(revokingToken.id)"
      @cancel="revokingToken = null; revokeError = null"
    />
  </div>
  </main>
</template>

<style scoped>
.token-manage-view {
  max-width: 1200px;
  margin: 0 auto;
  padding: 1rem;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1.5rem;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.page-header h2 {
  margin: 0;
  display: flex;
  align-items: center;
  gap: 0.45rem;
}

.page-header h2 .page-key-icon {
  color: var(--lms-accent);
  flex-shrink: 0;
}

.btn-primary {
  padding: 0.5rem 1.2rem;
  border-radius: var(--lms-radius-sm);
  font-size: 0.95rem;
  cursor: pointer;
  min-height: var(--lms-h);
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  background: var(--lms-accent);
  color: #fff;
  border: none;
}

.btn-primary:hover:not(:disabled) {
  background: var(--lms-accent-hover);
}

.btn-primary:focus-visible {
  outline: 2px solid var(--lms-accent);
  outline-offset: 2px;
}

/* ── Loading（§5 4.1：32px spinner，accent 頂邊色）── */
.loading {
  text-align: center;
  padding: 3rem 1rem;
  color: var(--lms-muted);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
}

.spinner-lg {
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

.error-state {
  text-align: center;
  padding: 2.5rem 1rem;
}

.error-state p {
  color: var(--lms-danger);
  font-size: 0.9rem;
  margin: 0 0 0.75rem;
}

.empty-state {
  text-align: center;
  padding: 3rem 1rem;
  color: var(--lms-muted);
}

.empty-icon {
  margin-bottom: 0.5rem;
  display: flex;
  justify-content: center;
  color: var(--lms-muted);
}

.empty-state p {
  font-size: 0.95rem;
  margin: 0 0 1rem;
}

/* ── Token table（桌面：完整 8 欄，§3.3 欄寬）── */
.token-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.9rem;
  background: var(--lms-surface);
  border-radius: var(--lms-radius);
  overflow: hidden;
  border: 1px solid var(--lms-border);
  box-shadow: var(--lms-shadow);
}

.token-table th,
.token-table td {
  padding: 0.65rem 0.75rem;
  text-align: left;
  border-bottom: 1px solid var(--lms-border);
}

.token-table th {
  background: var(--lms-surface);
  font-weight: 600;
  font-size: 0.78rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--lms-muted);
  white-space: nowrap;
}

.token-table th:nth-child(1) { width: 16%; }
.token-table th:nth-child(2) { width: 18%; }
.token-table th:nth-child(3) { width: 10%; }
.token-table th:nth-child(4) { width: 10%; }
.token-table th:nth-child(5) { width: 10%; }
.token-table th:nth-child(6) { width: 10%; }
.token-table th:nth-child(7) { width: 12%; }
.token-table th:nth-child(8) { width: 14%; }

.token-table tbody tr {
  transition: background var(--lms-transition);
}

.token-table tbody tr:hover {
  background: var(--lms-accent-light);
}

.token-table tbody tr:last-child td {
  border-bottom: none;
}

/* 名稱欄：font-weight 600（§3.3） */
.token-table td:first-child {
  font-weight: 600;
  word-break: break-all;
}

.token-masked {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.9rem;
  user-select: all;
  letter-spacing: 0.04em;
  word-break: break-all;
}

/* ── 狀態標籤（§3.2：SVG 圓點 + 文字，四色）── */
.status-tag {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 0.82rem;
  font-weight: 500;
  white-space: nowrap;
}

.status-tag .status-dot-svg {
  flex-shrink: 0;
}

.status-active       { background: #e8f5e9; color: #2e7d32; }
.status-expiring_soon { background: #fff3e0; color: #e65100; }
.status-expired      { background: #fbe9e7; color: #c62828; }
.status-revoked      { background: #f5f5f5; color: #9e9e9e; }

[data-theme="dark"] .status-active       { background: rgba(24, 128, 56, 0.22);   color: #81c784; }
[data-theme="dark"] .status-expiring_soon { background: rgba(227, 116, 0, 0.22);  color: #ffb74d; }
[data-theme="dark"] .status-expired      { background: rgba(197, 34, 31, 0.22);   color: #ef9a9a; }
[data-theme="dark"] .status-revoked      { background: rgba(158, 158, 158, 0.18); color: #bdbdbd; }

/* 已撤銷 / 已過期列淡化 */
.row-revoked td,
.row-expired td {
  opacity: 0.5;
}

.btn-danger-small {
  padding: 0.3rem 0.8rem;
  border: 1px solid var(--lms-danger);
  border-radius: var(--lms-radius-sm);
  background: transparent;
  color: var(--lms-danger);
  cursor: pointer;
  font-size: 0.85rem;
  min-height: var(--lms-h);
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  transition: background var(--lms-transition), color var(--lms-transition);
}

.btn-danger-small:hover {
  background: var(--lms-danger);
  color: #fff;
}

.btn-danger-small:focus-visible {
  outline: 2px solid var(--lms-accent);
  outline-offset: 2px;
}

.no-action {
  color: var(--lms-muted);
}

/* ── RWD：mobile（≤767px）卡片布局（§6 5.1）── */
@media (max-width: 767px) {
  .token-manage-view {
    padding: 0.75rem;
  }

  .page-header h2 {
    font-size: 1.15rem;
  }

  .btn-primary {
    min-height: var(--lms-h-mobile);
    font-size: 1rem;
    justify-content: center;
  }

  /* 表格 → 卡片 */
  .token-table thead {
    display: none;
  }

  .token-table,
  .token-table tbody {
    display: block;
    border: none;
    box-shadow: none;
    background: transparent;
    overflow: visible;
  }

  .token-table tbody {
    padding: 0;
  }

  .token-table tr {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    column-gap: 0.85rem;
    align-items: center;
    background: var(--lms-surface);
    border: 1px solid var(--lms-border);
    border-radius: var(--lms-radius-lg, 14px);
    margin-bottom: 0.85rem;
    padding: 0.9rem;
    box-shadow: var(--lms-shadow);
  }

  .token-table tr:hover {
    background: var(--lms-surface);
    border-color: var(--lms-accent);
  }

  .token-table td {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.6rem;
    border: none;
    padding: 0.3rem 0;
    font-size: 0.92rem;
    min-width: 0;
    text-align: right;
  }

  .token-table td::before {
    content: attr(data-label);
    font-size: 0.68rem;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: var(--lms-muted);
    flex-shrink: 0;
    font-weight: 600;
  }

  /* 卡片標頭：名稱（左）+ 狀態標籤（右），無 label */
  .token-table td:nth-child(1) {
    grid-area: 1 / 1;
    border-bottom: 1px solid var(--lms-border);
    padding-bottom: 0.55rem;
    margin-bottom: 0.25rem;
    font-weight: 700;
    font-size: 1rem;
    text-align: left;
  }
  .token-table td:nth-child(1)::before { display: none; }

  .token-table td:nth-child(7) {
    grid-area: 1 / 2;
    border-bottom: 1px solid var(--lms-border);
    padding-bottom: 0.55rem;
    margin-bottom: 0.25rem;
    justify-content: flex-end;
  }
  .token-table td:nth-child(7)::before { display: none; }

  /* Meta 2 欄 grid：Token / 權限、建立 / 過期 */
  .token-table td:nth-child(2) { grid-area: 2 / 1; } /* Token */
  .token-table td:nth-child(6) { grid-area: 2 / 2; } /* 權限 */
  .token-table td:nth-child(3) { grid-area: 3 / 1; } /* 建立 */
  .token-table td:nth-child(4) { grid-area: 3 / 2; } /* 過期 */

  /* 最後使用：mobile 卡片不顯示 */
  .token-table td:nth-child(5) { display: none; }

  /* 操作列：全寬 44px danger 按鈕 */
  .token-table td:nth-child(8) {
    grid-area: 4 / 1 / 5 / 3;
    display: block;
    border-top: 1px solid var(--lms-border);
    margin-top: 0.5rem;
    padding: 0.6rem 0 0;
  }
  .token-table td:nth-child(8)::before { display: none; }

  .token-table .btn-danger-small {
    width: 100%;
    height: var(--lms-h-mobile);
    min-height: var(--lms-h-mobile);
    justify-content: center;
    background: var(--lms-danger);
    color: #fff;
    border-color: var(--lms-danger);
    font-size: 0.95rem;
    font-weight: 600;
  }

  .token-table .btn-danger-small:hover {
    background: var(--lms-danger);
    opacity: 0.92;
  }

  .token-table .no-action { display: none; }
}
</style>
