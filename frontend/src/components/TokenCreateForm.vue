<script setup lang="ts">
import type { ExpiryOption } from '../composables/useTokenManager'

defineProps<{
  name: string
  expiry: number
  scope: 'read' | 'full'
  customDate: string
  isSubmitting: boolean
  createError: string | null
  fieldError: 'name' | null
  expiryOptions: ExpiryOption[]
}>()

const emit = defineEmits<{
  'update:name': [value: string]
  'update:expiry': [value: number]
  'update:scope': [value: 'read' | 'full']
  'update:customDate': [value: string]
  submit: []
  cancel: []
}>()
</script>

<template>
  <div class="token-create-form create-card" data-testid="token-create-form">
    <div class="create-card-header">
      <h4>
        <svg class="icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>
        建立新 API Token
      </h4>
    </div>

    <div class="create-card-body">
      <!-- 名稱 + 過期時間：桌面並排 -->
      <div class="form-row">
        <div class="form-field name-field">
          <label for="token-name">名稱 <span class="req" aria-hidden="true">*</span></label>
          <input
            id="token-name"
            type="text"
            :value="name"
            placeholder="例如：Jenkins CI"
            :class="{ invalid: fieldError === 'name' }"
            :aria-invalid="fieldError === 'name' || undefined"
            data-testid="token-name-input"
            @input="emit('update:name', ($event.target as HTMLInputElement).value)"
          />
        </div>

        <div class="form-field expiry-field">
          <label for="token-expiry">過期時間 <span class="req" aria-hidden="true">*</span></label>
          <select
            id="token-expiry"
            :value="expiry"
            data-testid="token-expiry-select"
            @change="emit('update:expiry', Number(($event.target as HTMLSelectElement).value))"
          >
            <option
              v-for="opt in expiryOptions"
              :key="opt.value"
              :value="opt.value"
            >{{ opt.label }}</option>
          </select>
        </div>
      </div>

      <!-- 自訂日期（僅過期=0時顯示） -->
      <div v-if="expiry === 0" class="form-field custom-date-field">
        <label for="token-custom-date">自訂日期 <span class="req" aria-hidden="true">*</span></label>
        <input
          id="token-custom-date"
          type="date"
          :value="customDate"
          :min="new Date(Date.now() + 86400000).toISOString().split('T')[0]"
          data-testid="token-custom-date"
          @input="emit('update:customDate', ($event.target as HTMLInputElement).value)"
        />
      </div>

      <!-- 權限範圍 -->
      <div class="form-field scope-field">
        <label>權限範圍 <span class="req" aria-hidden="true">*</span></label>
        <div class="scope-group" role="radiogroup" aria-label="權限範圍">
          <button
            type="button"
            class="scope-btn"
            :class="{ active: scope === 'read' }"
            role="radio"
            :aria-checked="scope === 'read'"
            data-testid="scope-read"
            @click="emit('update:scope', 'read')"
          >
            <svg class="icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
            唯讀
          </button>
          <button
            type="button"
            class="scope-btn"
            :class="{ active: scope === 'full' }"
            role="radio"
            :aria-checked="scope === 'full'"
            data-testid="scope-full"
            @click="emit('update:scope', 'full')"
          >
            <svg class="icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
            完整操作
          </button>
        </div>
      </div>

      <!-- 錯誤訊息 -->
      <div v-if="createError" class="form-error" data-testid="create-error" role="alert">
        <svg class="icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        {{ createError }}
      </div>

      <!-- 按鈕 -->
      <div class="form-actions">
        <button
          class="btn-primary"
          data-testid="submit-create"
          :disabled="isSubmitting"
          @click="emit('submit')"
        >
          <span v-if="isSubmitting" class="spinner" aria-hidden="true"></span>
          {{ isSubmitting ? '產生中…' : '產生 Token' }}
        </button>
        <button
          class="btn-cancel"
          data-testid="cancel-create"
          :disabled="isSubmitting"
          @click="emit('cancel')"
        >取消</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 建立 Token 卡片（設計 §4 3.1 wireframe：accent 邊框 + 標頭） */
.create-card {
  background: var(--lms-surface);
  border: 1px solid var(--lms-accent);
  border-radius: var(--lms-radius);
  box-shadow: var(--lms-shadow);
  overflow: hidden;
  margin-bottom: 1.5rem;
}

.create-card-header {
  padding: 0.8rem 1rem;
  background: var(--lms-accent-light);
  border-bottom: 1px solid var(--lms-border);
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.create-card-header h4 {
  margin: 0;
  font-size: 0.95rem;
  color: var(--lms-accent);
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.create-card-body {
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

/* 桌面：名稱 + 過期時間並排（flex wrap） */
.form-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem 1rem;
  align-items: flex-start;
}

.form-field {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.form-field label {
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--lms-muted);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.form-field label .req {
  color: var(--lms-danger);
}

.form-field input,
.form-field select {
  height: var(--lms-h);
  padding: 0 0.6rem;
  border: 1px solid var(--lms-border);
  border-radius: var(--lms-radius-sm);
  background: var(--lms-surface);
  color: var(--lms-text);
  font-size: 0.875rem;
  transition: border-color var(--lms-transition), box-shadow var(--lms-transition);
  min-width: 0;
}

.form-field input:focus,
.form-field select:focus {
  border-color: var(--lms-accent);
  box-shadow: 0 0 0 3px var(--lms-accent-light);
  outline: none;
}

/* 表單驗證紅框（§5 4.1 Error（表單）/ §3.4 名稱為必填） */
.form-field input.invalid {
  border-color: var(--lms-danger);
  box-shadow: 0 0 0 3px rgba(197, 34, 31, 0.12);
}

.form-field input[type="date"] {
  width: 180px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.82rem;
}

.name-field {
  min-width: 240px;
  flex: 1 1 240px;
}

.name-field input {
  width: 100%;
}

.expiry-field {
  min-width: 180px;
  flex: 1 1 180px;
  max-width: 260px;
}

/* 權限 segmented control（設計 §3.4：radio group） */
.scope-group {
  display: inline-flex;
  gap: 0.3rem;
  background: var(--lms-surface-2);
  border: 1px solid var(--lms-border);
  border-radius: var(--lms-radius-sm);
  padding: 2px;
  flex-wrap: wrap;
}

.scope-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.82rem;
  padding: 0.35rem 0.75rem;
  border-radius: 4px;
  border: none;
  background: none;
  color: var(--lms-muted);
  cursor: pointer;
  transition: all var(--lms-transition);
  font-weight: 500;
  white-space: nowrap;
  min-height: 30px;
}

.scope-btn:hover {
  color: var(--lms-text);
}

.scope-btn:active {
  transform: scale(0.96);
}

.scope-btn.active {
  background: var(--lms-surface);
  color: var(--lms-accent);
  box-shadow: var(--lms-shadow);
}

.scope-btn:focus-visible {
  outline: 2px solid var(--lms-accent);
  outline-offset: 2px;
}

.form-error {
  font-size: 0.8rem;
  color: var(--lms-danger);
  padding: 0.5rem 0.75rem;
  background: var(--lms-danger-light);
  border: 1px solid var(--lms-danger-border);
  border-radius: var(--lms-radius-sm);
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.form-error .icon {
  flex-shrink: 0;
}

.form-actions {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  margin-top: 0.25rem;
  flex-wrap: wrap;
}

.btn-primary,
.btn-cancel {
  padding: 0.5rem 1.2rem;
  border-radius: var(--lms-radius-sm);
  font-size: 0.95rem;
  cursor: pointer;
  min-height: var(--lms-h);
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
}

.btn-primary {
  background: var(--lms-accent);
  color: #fff;
  border: none;
}

.btn-primary:hover:not(:disabled) {
  background: var(--lms-accent-hover);
}

.btn-primary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-cancel {
  background: transparent;
  border: 1px solid var(--lms-border);
  color: var(--lms-text);
}

.btn-cancel:hover:not(:disabled) {
  background: var(--lms-surface-2);
}

.btn-primary:focus-visible,
.btn-cancel:focus-visible {
  outline: 2px solid var(--lms-accent);
  outline-offset: 2px;
}

.spinner {
  display: inline-block;
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* ── RWD：mobile 欄位全寬堆疊（§6 5.1）── */
@media (max-width: 767px) {
  .create-card {
    margin-bottom: 1rem;
  }
  .form-row {
    flex-direction: column;
    gap: 0.85rem;
  }
  .name-field,
  .expiry-field {
    flex: none;
    max-width: none;
    min-width: 0;
    width: 100%;
  }
  .form-field input,
  .form-field select {
    height: var(--lms-h-mobile);
    font-size: 16px; /* ≥16px 避免 iOS focus 自動放大 */
  }
  .scope-group {
    width: 100%;
  }
  .scope-btn {
    flex: 1;
    justify-content: center;
    padding: 0.55rem 0.9rem;
    min-height: var(--lms-h-mobile);
    font-size: 0.9rem;
  }
  .form-field input[type="date"] {
    width: 100%;
  }
  .btn-primary,
  .btn-cancel {
    min-height: var(--lms-h-mobile);
    flex: 1;
    justify-content: center;
    font-size: 1rem;
  }
}
</style>
