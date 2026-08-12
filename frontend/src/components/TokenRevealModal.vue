<script setup lang="ts">
import { ref } from 'vue'
import type { CreateTokenResponse } from '../types/service'

defineProps<{
  show: boolean
  token: CreateTokenResponse | null
}>()

const emit = defineEmits<{
  copy: []
  close: []
}>()

// 複製按鈕回饋：success 綠底 + 「✓ 已複製」，1.5s 後恢復
const copied = ref(false)
let copyTimer: ReturnType<typeof setTimeout> | undefined

function handleCopy(): void {
  // 實際 clipboard 寫入仍由 parent（useTokenManager.copyTokenToClipboard）處理
  emit('copy')
  copied.value = true
  if (copyTimer) clearTimeout(copyTimer)
  copyTimer = setTimeout(() => {
    copied.value = false
  }, 1500)
}
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
        <h3>
          <svg class="icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>
          你的新 API Token
        </h3>

        <div class="token-reveal-warning">
          <svg class="icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          請立即複製此 Token，關閉此視窗後將無法再次查看。
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
            class="btn-primary btn-copy"
            :class="{ 'btn-copied': copied }"
            data-testid="copy-token-btn"
            @click="handleCopy"
          >
            <svg v-if="!copied" class="icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            <svg v-else class="icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
            {{ copied ? '✓ 已複製' : '複製到剪貼簿' }}
          </button>
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
  display: flex;
  align-items: center;
  gap: 0.45rem;
}

.token-reveal-modal h3 .icon {
  color: var(--lms-accent);
}

.token-reveal-warning {
  background: var(--lms-warning-light);
  border: 1px solid #ff9800;
  border-radius: var(--lms-radius-sm);
  padding: 12px 16px;
  margin-bottom: 16px;
  color: #e65100;
  font-weight: 500;
  font-size: 0.95rem;
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  line-height: 1.5;
}

.token-reveal-warning .icon {
  flex-shrink: 0;
  margin-top: 2px;
}

[data-theme="dark"] .token-reveal-warning {
  background: rgba(227, 116, 0, 0.18);
  border-color: rgba(227, 116, 0, 0.4);
  color: #ffb74d;
}

.token-reveal-value {
  width: 100%;
  padding: 12px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 1rem;
  background: var(--lms-bg-secondary, #f5f5f5);
  border: 1px solid var(--lms-border, #ccc);
  border-radius: var(--lms-radius-sm);
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
  flex-wrap: wrap;
  align-items: center;
}

.btn-primary,
.btn-secondary {
  padding: 0.5rem 1.2rem;
  border-radius: var(--lms-radius-sm);
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

.btn-primary:hover {
  background: var(--lms-accent-hover);
}

/* 複製成功回饋：success 綠底（§5 4.2） */
.btn-copy.btn-copied {
  background: var(--lms-success);
  border-color: var(--lms-success);
  color: #fff;
}

.btn-secondary {
  background: transparent;
  border: 1px solid var(--lms-border, #ccc);
  color: var(--lms-text, #212529);
}

.btn-primary:focus-visible,
.btn-secondary:focus-visible {
  outline: 2px solid var(--lms-accent);
  outline-offset: 2px;
}
</style>
