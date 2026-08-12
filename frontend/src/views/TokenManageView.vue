<script setup lang="ts">
import { onMounted } from 'vue'
import { useTokenManager } from '../composables/useTokenManager'
import TokenCreateForm from '../components/TokenCreateForm.vue'
import TokenRevealModal from '../components/TokenRevealModal.vue'
import ConfirmModal from '../components/ConfirmModal.vue'

const {
  sortedTokens, isLoading, error,
  showCreateForm, createFormName, createFormExpiry, createFormScope,
  createFormCustomDate, isSubmitting, createError,
  revealToken, showRevealModal,
  revokingToken, expiryOptions,
  fetchTokens, resetCreateForm, submitCreate,
  closeRevealModal, copyTokenToClipboard, confirmRevoke,
  statusLabel, scopeLabel, formatDate, formatExpiry,
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
</script>

<template>
  <div class="token-manage-view" data-testid="token-manage-view">
    <div class="page-header">
      <h2>🔑 API Tokens</h2>
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
      :expiry-options="expiryOptions"
      data-testid="create-form"
      @update:name="createFormName = $event"
      @update:expiry="createFormExpiry = $event"
      @update:scope="createFormScope = $event"
      @update:custom-date="createFormCustomDate = $event"
      @submit="submitCreate"
      @cancel="cancelCreate"
    />

    <!-- Loading -->
    <div v-if="isLoading" class="loading" data-testid="token-loading">載入中...</div>

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
      <div class="empty-icon">🔑</div>
      <p>尚無 API Token</p>
      <button class="btn-primary" @click="openCreateForm">建立 Token</button>
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
          <td class="token-masked">{{ token.prefix }}</td>
          <td>{{ formatDate(token.created_at) }}</td>
          <td>{{ formatExpiry(token.expires_at) }}</td>
          <td>{{ formatDate(token.last_used_at) }}</td>
          <td>{{ scopeLabel(token.scope) }}</td>
          <td>
            <span :class="`status-tag status-${token.status}`">
              {{ statusLabel(token.status) }}
            </span>
          </td>
          <td>
            <button
              v-if="token.status === 'active' || token.status === 'expiring_soon'"
              class="btn-danger-small"
              :data-testid="`revoke-btn-${token.id}`"
              @click="revokingToken = token"
            >撤銷</button>
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
      @confirm="revokingToken && confirmRevoke(revokingToken.id)"
      @cancel="revokingToken = null"
    />
  </div>
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
}

.page-header h2 {
  margin: 0;
}

.btn-primary {
  padding: 0.5rem 1.2rem;
  border-radius: 4px;
  font-size: 0.95rem;
  cursor: pointer;
  min-height: 36px;
  background: var(--lms-accent, #2563eb);
  color: #fff;
  border: none;
}

.loading {
  text-align: center;
  padding: 3rem;
  color: var(--lms-muted);
}

.error-state {
  text-align: center;
  padding: 2rem;
  color: #c62828;
}

.empty-state {
  text-align: center;
  padding: 3rem 1rem;
  color: var(--lms-muted, #666);
}

.empty-icon {
  font-size: 3rem;
  margin-bottom: 1rem;
}

/* Token table */
.token-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.9rem;
  background: var(--lms-bg, #fff);
  border-radius: var(--lms-radius, 8px);
  overflow: hidden;
  border: 1px solid var(--lms-border, #dee2e6);
}

.token-table th,
.token-table td {
  padding: 0.65rem 0.75rem;
  text-align: left;
  border-bottom: 1px solid var(--lms-border, #dee2e6);
}

.token-table th {
  background: var(--lms-bg-secondary, #f8f9fa);
  font-weight: 600;
  font-size: 0.85rem;
  white-space: nowrap;
}

.token-masked {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.9rem;
  user-select: all;
  letter-spacing: 0.05em;
}

/* Token status tags */
.status-tag {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 0.82rem;
  font-weight: 500;
  white-space: nowrap;
}

.status-active       { background: #e8f5e9; color: #2e7d32; }
.status-expiring_soon { background: #fff3e0; color: #e65100; }
.status-expired      { background: #fbe9e7; color: #c62828; }
.status-revoked      { background: #f5f5f5; color: #9e9e9e; }

/* Revoked / expired rows */
.row-revoked td,
.row-expired td {
  opacity: 0.5;
}

.btn-danger-small {
  padding: 0.3rem 0.8rem;
  border: 1px solid #c62828;
  border-radius: 4px;
  background: transparent;
  color: #c62828;
  cursor: pointer;
  font-size: 0.85rem;
  min-height: 32px;
}

.btn-danger-small:hover {
  background: #c62828;
  color: #fff;
}

.no-action {
  color: var(--lms-muted, #999);
}

/* Responsive */
@media (max-width: 767px) {
  .token-table {
    display: block;
  }
  .token-table thead {
    display: none;
  }
  .token-table tbody,
  .token-table tr,
  .token-table td {
    display: block;
  }
  .token-table tr {
    border: 1px solid var(--lms-border, #dee2e6);
    border-radius: var(--lms-radius, 8px);
    margin-bottom: 0.75rem;
    padding: 0.5rem;
  }
  .token-table td {
    padding: 0.3rem 0.5rem;
    border-bottom: none;
  }
  .token-table td::before {
    content: attr(data-label);
    font-weight: 600;
    display: inline-block;
    width: 6rem;
    font-size: 0.8rem;
  }
}
</style>
