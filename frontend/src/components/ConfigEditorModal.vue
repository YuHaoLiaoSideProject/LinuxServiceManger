<script setup lang="ts">
// ConfigEditorModal.vue — 桌面 Config Editor Modal shell（012 UIUX v2）
// Teleport to body + backdrop + 居中 dialog；focus trap、Esc 關閉、backdrop 點擊關閉、
// 背景捲動鎖定、150ms 淡入淡出+滑入（prefers-reduced-motion 由 main.css 全域停用）。
// dirty 時關閉 → 先經 ConfigEditorContent.confirmLeave() 跳出「有未儲存的變更」ConfirmModal。
import { ref, watch, nextTick, onBeforeUnmount } from 'vue'
import ConfigEditorContent from './ConfigEditorContent.vue'
import { useConfigEditorModal } from '../composables/useConfigEditorModal'

const { open, serviceName, readOnly, closeModal } = useConfigEditorModal()

const dialogRef = ref<HTMLElement | null>(null)
const contentRef = ref<InstanceType<typeof ConfigEditorContent> | null>(null)

const TITLE_ID = 'config-editor-modal-title'
const FOCUSABLE = 'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'

let previouslyFocused: HTMLElement | null = null

onBeforeUnmount(() => {
  document.body.style.overflow = ''
})

watch(open, async (val) => {
  if (val) {
    previouslyFocused = (document.activeElement as HTMLElement) || null
    document.body.style.overflow = 'hidden'
    await nextTick()
    focusFirst()
  } else {
    document.body.style.overflow = ''
    previouslyFocused?.focus?.()
    previouslyFocused = null
  }
})

function focusableElements(): HTMLElement[] {
  return Array.from(dialogRef.value?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])
}

function focusFirst() {
  const list = focusableElements()
  const target = list.length ? list[0] : dialogRef.value
  target?.focus?.()
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault()
    void requestCloseFromShell()
    return
  }
  if (e.key !== 'Tab') return

  const list = focusableElements()
  if (list.length === 0) return
  const first = list[0]
  const last = list[list.length - 1]
  const active = document.activeElement

  if (e.shiftKey) {
    if (active === first || !dialogRef.value?.contains(active as Node)) {
      e.preventDefault()
      last.focus()
    }
  } else {
    if (active === last || !dialogRef.value?.contains(active as Node)) {
      e.preventDefault()
      first.focus()
    }
  }
}

// Esc / backdrop 關閉：dirty 時先問 ConfigEditorContent.confirmLeave()
async function requestCloseFromShell() {
  const ok = contentRef.value ? await contentRef.value.confirmLeave() : true
  if (ok) closeModal()
}

// 內容 Cancel/Close 已自行完成 confirmLeave → 直接關閉
function onContentClose() {
  closeModal()
}

function onBackdropClick() {
  void requestCloseFromShell()
}
</script>

<template>
  <Teleport to="body">
    <Transition name="config-modal">
      <div
        v-if="open"
        class="config-modal-overlay"
        @click.self="onBackdropClick"
        @keydown="onKeydown"
      >
        <div
          ref="dialogRef"
          class="config-modal-dialog"
          role="dialog"
          aria-modal="true"
          :aria-labelledby="TITLE_ID"
          tabindex="-1"
        >
          <ConfigEditorContent
            ref="contentRef"
            :service-name="serviceName"
            :read-only="readOnly"
            :title-id="TITLE_ID"
            variant="modal"
            @close="onContentClose"
          />
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.config-modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  /* 必須低於全域 ConfirmModal（.lms-modal-overlay z-index:10000），
     否則編輯器內的 Save/Discard/Reload 確認框會被 Modal 遮住無法點擊。 */
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
}
.config-modal-dialog {
  background: var(--lms-surface, #fff);
  border: 1px solid var(--lms-border);
  border-radius: var(--lms-radius-lg, 14px);
  box-shadow: var(--lms-shadow-lg);
  max-width: min(96vw, 960px);
  width: 100%;
  max-height: 92vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 0 1rem;
}
.config-modal-dialog:focus {
  outline: none;
}

/* 150ms 淡入淡出 + 滑入（prefers-reduced-motion 由 main.css 全域停用） */
.config-modal-enter-active,
.config-modal-leave-active {
  transition: opacity 0.15s ease;
}
.config-modal-enter-active .config-modal-dialog,
.config-modal-leave-active .config-modal-dialog {
  transition: transform 0.15s ease, opacity 0.15s ease;
}
.config-modal-enter-from,
.config-modal-leave-to {
  opacity: 0;
}
.config-modal-enter-from .config-modal-dialog {
  transform: translateY(14px);
}
.config-modal-leave-to .config-modal-dialog {
  transform: translateY(14px);
}
</style>
