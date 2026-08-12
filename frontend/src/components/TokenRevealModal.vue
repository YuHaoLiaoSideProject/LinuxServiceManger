<script setup lang="ts">
import type { CreateTokenResponse } from '../types/service'

defineProps<{
  show: boolean
  token: CreateTokenResponse | null
}>()

const emit = defineEmits<{
  copy: []
  close: []
}>()
</script>

<template>
  <Teleport to="body">
    <div
      v-if="show && token"
      class="lms-modal-overlay no-backdrop-close"
      data-testid="token-reveal-modal"
      role="alertdialog"
      aria-modal="true"
      aria-label="Token 一次性揭露"
    >
      <div class="lms-modal token-reveal-modal">
        <h3>🔑 你的新 API Token</h3>

        <div class="token-reveal-warning">
          ⚠️ 請立即複製此 Token，關閉此視窗後將無法再次查看。
        </div>

        <textarea
          class="token-reveal-value"
          :value="token.token"
          readonly
          rows="2"
          data-testid="reveal-token-value"
          aria-label="Token 值"
        ></textarea>

        <div class="token-reveal-actions">
          <button
            class="btn-primary"
            data-testid="copy-token-btn"
            @click="emit('copy')"
          >📋 複製到剪貼簿</button>
          <button
            class="btn-secondary"
            data-testid="close-reveal-btn"
            @click="emit('close')"
          >我已複製，關閉</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.no-backdrop-close {
  pointer-events: all;
}

.token-reveal-modal {
  max-width: 520px;
  width: 90%;
}

.token-reveal-modal h3 {
  margin: 0 0 1rem 0;
}

.token-reveal-warning {
  background: #fff3e0;
  border: 1px solid #ff9800;
  border-radius: 6px;
  padding: 12px 16px;
  margin-bottom: 16px;
  color: #e65100;
  font-weight: 500;
  font-size: 0.95rem;
}

.token-reveal-value {
  width: 100%;
  padding: 12px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 1rem;
  background: var(--lms-bg-secondary, #f5f5f5);
  border: 1px solid var(--lms-border, #ccc);
  border-radius: 6px;
  resize: none;
  user-select: all;
  word-break: break-all;
  box-sizing: border-box;
}

.token-reveal-actions {
  display: flex;
  gap: 0.75rem;
  margin-top: 1rem;
  justify-content: flex-end;
}

.btn-primary,
.btn-secondary {
  padding: 0.5rem 1.2rem;
  border-radius: 4px;
  font-size: 0.95rem;
  cursor: pointer;
  min-height: 36px;
}

.btn-primary {
  background: var(--lms-accent, #2563eb);
  color: #fff;
  border: none;
}

.btn-secondary {
  background: transparent;
  border: 1px solid var(--lms-border, #ccc);
  color: var(--lms-text, #212529);
}
</style>
