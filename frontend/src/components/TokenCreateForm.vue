<script setup lang="ts">
import type { ExpiryOption } from '../composables/useTokenManager'

defineProps<{
  name: string
  expiry: number
  scope: 'read' | 'full'
  customDate: string
  isSubmitting: boolean
  createError: string | null
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
  <div class="token-create-form" data-testid="token-create-form">
    <h4>建立新 API Token</h4>

    <!-- 名稱 -->
    <div class="form-field">
      <label for="token-name">名稱</label>
      <input
        id="token-name"
        type="text"
        :value="name"
        placeholder="例如：Jenkins CI"
        data-testid="token-name-input"
        @input="emit('update:name', ($event.target as HTMLInputElement).value)"
      />
    </div>

    <!-- 過期時間 -->
    <div class="form-field">
      <label for="token-expiry">過期時間</label>
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

    <!-- 自訂日期（僅過期=0時顯示） -->
    <div v-if="expiry === 0" class="form-field">
      <label for="token-custom-date">自訂日期</label>
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
    <div class="form-field">
      <label>權限範圍</label>
      <div class="scope-group" role="radiogroup" aria-label="權限範圍">
        <button
          type="button"
          class="scope-btn"
          :class="{ active: scope === 'read' }"
          role="radio"
          :aria-checked="scope === 'read'"
          data-testid="scope-read"
          @click="emit('update:scope', 'read')"
        >👁 唯讀</button>
        <button
          type="button"
          class="scope-btn"
          :class="{ active: scope === 'full' }"
          role="radio"
          :aria-checked="scope === 'full'"
          data-testid="scope-full"
          @click="emit('update:scope', 'full')"
        >🔒 完整操作</button>
      </div>
    </div>

    <!-- 錯誤訊息 -->
    <div v-if="createError" class="form-error" data-testid="create-error">
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
</template>

<style scoped>
.token-create-form {
  background: var(--lms-bg-secondary, #f8f9fa);
  border: 1px solid var(--lms-border, #dee2e6);
  border-radius: var(--lms-radius, 8px);
  padding: 1.2rem;
  margin-bottom: 1.5rem;
}

.token-create-form h4 {
  margin: 0 0 1rem 0;
  font-size: 1.05rem;
}

.form-field {
  margin-bottom: 1rem;
}

.form-field label {
  display: block;
  margin-bottom: 0.3rem;
  font-weight: 600;
  font-size: 0.9rem;
}

.form-field input,
.form-field select {
  width: 100%;
  padding: 0.5rem 0.7rem;
  border: 1px solid var(--lms-border, #ccc);
  border-radius: 4px;
  font-size: 0.95rem;
  background: var(--lms-bg, #fff);
  color: var(--lms-text, #212529);
  max-width: 400px;
}

.scope-group {
  display: flex;
  gap: 0.5rem;
}

.scope-btn {
  padding: 0.4rem 1rem;
  border: 1px solid var(--lms-border, #ccc);
  border-radius: 4px;
  background: var(--lms-bg, #fff);
  color: var(--lms-text, #212529);
  cursor: pointer;
  font-size: 0.9rem;
  min-height: 36px;
}

.scope-btn.active {
  background: var(--lms-accent, #2563eb);
  color: #fff;
  border-color: var(--lms-accent, #2563eb);
}

.form-error {
  background: #fff0f0;
  border: 1px solid #e00;
  color: #c62828;
  padding: 0.6rem 1rem;
  border-radius: 4px;
  margin-bottom: 1rem;
  font-size: 0.9rem;
}

.form-actions {
  display: flex;
  gap: 0.75rem;
  align-items: center;
}

.btn-primary,
.btn-cancel {
  padding: 0.5rem 1.2rem;
  border-radius: 4px;
  font-size: 0.95rem;
  cursor: pointer;
  min-height: 36px;
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
}

.btn-primary {
  background: var(--lms-accent, #2563eb);
  color: #fff;
  border: none;
}

.btn-primary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-cancel {
  background: transparent;
  border: 1px solid var(--lms-border, #ccc);
  color: var(--lms-text, #212529);
}

.spinner {
  display: inline-block;
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255,255,255,0.3);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
