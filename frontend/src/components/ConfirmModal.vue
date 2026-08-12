<script setup lang="ts">
import { useI18n } from '../composables/useI18n'

const { t } = useI18n()
// confirmLoading / confirmError 為選用 props（向後相容）：
// DashboardView / ServiceTable 既有用法不傳 → 行為不變
// 012 config editor：title / cancelLabel / confirmLabel / confirmClass 為選用擴充
withDefaults(defineProps<{
  show: boolean
  message: string
  details?: string[]
  confirmLoading?: boolean
  confirmError?: string | null
  title?: string
  cancelLabel?: string
  confirmLabel?: string
  confirmClass?: 'danger' | 'primary'
}>(), {
  details: () => [],
  confirmLoading: false,
  confirmError: '',
  title: '',
  cancelLabel: '',
  confirmLabel: '',
  confirmClass: 'danger',
})
defineEmits<{ confirm: []; cancel: [] }>()
</script>

<template>
  <Teleport to="body">
    <div v-if="show" class="lms-modal-overlay" @click.self="$emit('cancel')">
      <div class="lms-modal" role="alertdialog" aria-modal="true">
        <h3>{{ title || t('modal.title') }}</h3>
        <p v-if="message" class="modal-message">{{ message }}</p>
        <div v-if="details && details.length" class="modal-details">
          <p v-for="(name, i) in details" :key="i" class="modal-detail-item">{{ name }}</p>
        </div>
        <div v-if="confirmError" class="modal-error" role="alert">{{ confirmError }}</div>
        <div class="lms-modal-actions">
          <button class="secondary" :disabled="confirmLoading" @click="$emit('cancel')">{{ cancelLabel || t('modal.cancel') }}</button>
          <button
            :class="confirmClass === 'primary' ? 'btn-primary' : 'btn-danger'"
            :disabled="confirmLoading"
            @click="$emit('confirm')"
            autofocus
          ><span v-if="confirmLoading" class="spinner-sm" aria-hidden="true"></span>{{ confirmLoading ? '…' : (confirmLabel || t('modal.confirm')) }}</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.modal-error {
  color: var(--lms-danger);
  font-size: 0.85rem;
  background: var(--lms-danger-light);
  border: 1px solid var(--lms-danger-border);
  border-radius: var(--lms-radius-sm);
  padding: 0.5rem 0.75rem;
  margin: 0 0 1rem;
  display: flex;
  align-items: center;
  gap: 0.4rem;
}
.lms-modal-actions button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.lms-modal-actions .btn-danger,
.lms-modal-actions .btn-primary {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
}
.lms-modal-actions .btn-danger:focus-visible,
.lms-modal-actions .btn-primary:focus-visible {
  outline: 2px solid var(--lms-accent);
  outline-offset: 2px;
}
</style>
