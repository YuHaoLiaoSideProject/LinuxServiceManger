<script setup lang="ts">
// ConfigEditorContent.vue — 服務設定檔編輯器共用內容（012）
// Modal（桌面）與全頁（手機）共用：標題列 / 驗證橫幅 / UnitFileEditor / footer，
// 內部持有 useConfigEditor 與 load/validate/save/dirty 邏輯。
// shell（ConfigEditorModal / ConfigEditorView）只負責「離開」行為差異，
// 透過 expose 的 confirmLeave() 與 emit('close') 溝通。
// UIUX：docs/uiux/012-service-config-editor-design.md
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
import UnitFileEditor from './UnitFileEditor.vue'
import ConfirmModal from './ConfirmModal.vue'
import { useConfigEditor } from '../composables/useConfigEditor'
import { useToast } from '../composables/useToast'
import { useI18n } from '../composables/useI18n'

const props = withDefaults(defineProps<{
  serviceName: string
  readOnly?: boolean
  /** 標題列 h2 的 id，供 Modal shell 以 aria-labelledby 指向 */
  titleId?: string
  /** page：全頁（手機）；modal：桌面 Modal（內部捲動 + sticky header/footer） */
  variant?: 'page' | 'modal'
}>(), {
  readOnly: false,
  titleId: '',
  variant: 'page',
})

const emit = defineEmits<{ close: [] }>()

const { t } = useI18n()
const { showToast } = useToast()
const editor = useConfigEditor(props.serviceName)

const editorRef = ref<InstanceType<typeof UnitFileEditor> | null>(null)
watch(editor.validationKind, (k) => {
  if (k === 'failure' && editor.validation.value) {
    editorRef.value?.clearMarks()
    editorRef.value?.setErrorMarks(editor.validation.value.errors.map(e => e.line))
  } else {
    editorRef.value?.clearMarks()
  }
})

// ── 載入 + beforeunload（第三層防護：分頁關閉，兩 shell 皆適用）──
onMounted(async () => {
  window.addEventListener('beforeunload', editor.onBeforeUnload)
  await editor.load()
})
onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', editor.onBeforeUnload)
})

// ── Validate ──
async function onValidate() {
  if (editor.content.value.trim() === '') {
    showToast(t('config.validateEmpty'), 'warning')
    return // 前端攔截，不發 API 請求
  }
  const ok = await editor.verify()
  if (!ok && editor.validationKind.value === 'unavailable') {
    showToast(t('config.validateUnavailable'), 'warning')
  }
  if (!ok && editor.validationKind.value === 'error') {
    showToast(
      editor.validationError.value === '請求格式錯誤'
        ? t('config.validateRequestError')
        : t('config.validateUnavailable'),
      'warning',
    )
  }
}

// ── Save ──
const showSaveModal = ref(false)
async function onSaveConfirm() {
  showSaveModal.value = false
  const r = await editor.save()
  if (r.kind === 'success') {
    showToast(t('config.saved', { name: props.serviceName }), 'success')
    // 1.5s 後由 shell 決定關閉行為（全頁→導航 / Modal→關閉）
    setTimeout(() => emit('close'), 1500)
  } else if (r.kind === 'conflict') {
    showToast(t('config.conflict'), 'error')
    showReloadModal.value = true // 提供重新載入動作 → reloadAfterConflict()
  } else if (r.kind === 'reload-failed') {
    showToast(t('config.reloadFailed', { error: r.error ?? '', backupPath: r.backupPath ?? '' }), 'error')
  } else {
    showToast(t('config.saveFailed', { error: r.error ?? '' }), 'error')
  }
}

// ── 409 衝突重新載入 Modal ──
const showReloadModal = ref(false)
async function onReloadAfterConflict() {
  showReloadModal.value = false
  await editor.reloadAfterConflict()
  showToast(t('config.conflictReloaded'), 'success')
}

// ── 離開確認（第二層：頁內 Cancel / Esc / backdrop / 返回鍵共用）──
const showDiscardModal = ref(false)
let leaveDecision: ((ok: boolean) => void) | null = null

// 供 shell 呼叫：返回 true 表示可離開（clean 或已 discard），false 表示使用者選擇 Stay。
function confirmLeave(): Promise<boolean> {
  if (!editor.isDirty.value || editor.isSaving.value) return Promise.resolve(true)
  showDiscardModal.value = true
  return new Promise<boolean>((resolve) => {
    leaveDecision = resolve
  })
}

function onStay() {
  showDiscardModal.value = false
  leaveDecision?.(false)
  leaveDecision = null
}

function onDiscard() {
  showDiscardModal.value = false
  editor.discard() // 清 dirty，讓 route guard / close 放行
  showToast(t('config.discarded'), 'warning')
  leaveDecision?.(true)
  leaveDecision = null
}

// 頁內 Cancel / Close 按鈕：先走 confirmLeave，通過後 emit close（shell 決定下一步）
function requestClose() {
  void confirmLeave().then((ok) => {
    if (ok) emit('close')
  })
}

defineExpose({ confirmLeave })
</script>

<template>
  <div
    class="config-editor-content"
    :class="{ 'config-editor-content--modal': variant === 'modal' }"
  >
    <!-- 載入中 -->
    <div v-if="editor.status.value === 'loading'" class="config-loading" role="status">
      <span class="spinner" aria-hidden="true"></span>{{ t('config.loading') }}
    </div>

    <!-- 載入失敗（非 404）→ 錯誤 + 返回/重試 -->
    <div v-else-if="editor.status.value === 'error'" class="config-error-state">
      <p class="config-error-message" role="alert">{{ editor.errorMessage.value }}</p>
      <div class="config-error-actions">
        <button class="outline secondary" @click="emit('close')">{{ t('config.back') }}</button>
        <button class="primary" @click="editor.load()">{{ t('config.retry') }}</button>
      </div>
    </div>

    <template v-else>
      <!-- 標題列：服務名稱 + dirty 指示 + FragmentPath + 關閉鍵 -->
      <header class="config-header">
        <div class="config-header-main">
          <h2 :id="titleId || undefined">
            {{ serviceName }}
            <span
              v-if="editor.isDirty.value"
              class="dirty-dot"
              title="未儲存變更"
              aria-label="未儲存變更"
            >●</span>
          </h2>
          <code class="config-path">{{ editor.fragmentPath.value }}</code>
        </div>
        <button
          class="config-close-btn"
          :aria-label="t('config.closeAria')"
          :title="t('config.closeAria')"
          @click="requestClose"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>
      </header>

      <!-- body：Modal 內部捲動區域；全頁自然流動 -->
      <div class="config-body">
        <!-- 黃色提示：設定檔不存在（404 後仍可輸入重建） -->
        <div v-if="editor.status.value === 'not-found'" class="config-notice warning" role="alert">
          ⚠️ {{ t('config.notFound', { path: editor.fragmentPath.value || '' }) }}
        </div>
        <!-- 黃色提示：大檔案效能 -->
        <div v-else-if="editor.isLargeFile.value" class="config-notice warning" role="alert">
          ⚠️ {{ t('config.largeFile', { size: String(editor.size.value) }) }}
        </div>

        <!-- 驗證狀態橫幅：綠（通過）/ 紅（失敗面板）/ 黃（不可用/錯誤） -->
        <div v-if="editor.validationKind.value === 'success'" class="validation-banner success" role="status">
          ✅ {{ t('config.validatePass') }}
        </div>
        <div v-else-if="editor.validationKind.value === 'failure'" class="validation-banner error" role="alert">
          <p v-for="(e, i) in editor.validation.value?.errors" :key="i" class="validation-error-item">
            Line {{ e.line }}: {{ e.message }}
          </p>
        </div>
        <div
          v-else-if="editor.validationKind.value === 'unavailable' || editor.validationKind.value === 'error'"
          class="validation-banner warning"
          role="alert"
        >
          ⚠️ {{ t('config.validateUnavailable') }}
        </div>

        <!-- 編輯器 -->
        <UnitFileEditor
          ref="editorRef"
          :model-value="editor.content.value"
          :read-only="readOnly || editor.isSaving.value"
          @update:model-value="editor.setContent"
        />
      </div>

      <!-- 底部按鈕列 -->
      <footer class="config-footer">
        <template v-if="!readOnly">
          <button
            class="outline secondary"
            :disabled="editor.isVerifying.value || editor.isSaving.value"
            @click="onValidate"
          >
            <span v-if="editor.isVerifying.value" class="spinner-sm" aria-hidden="true"></span>
            {{ editor.isVerifying.value ? 'Verifying...' : t('config.validate') }}
          </button>
          <button
            class="primary"
            :disabled="!editor.isDirty.value || editor.isSaving.value"
            @click="showSaveModal = true"
          >
            <span v-if="editor.isSaving.value" class="spinner-sm" aria-hidden="true"></span>
            {{ editor.isSaving.value ? 'Saving...' : t('config.save') }}
          </button>
          <button class="outline secondary" :disabled="editor.isSaving.value" @click="requestClose">
            {{ t('config.cancel') }}
          </button>
        </template>
        <button v-else class="outline secondary" @click="requestClose">{{ t('config.close') }}</button>
      </footer>
    </template>

    <!-- 儲存確認 Modal（空內容時額外警告） -->
    <ConfirmModal
      :show="showSaveModal"
      :message="''"
      :title="t('config.saveTitle')"
      :confirm-label="t('config.saveChanges')"
      :cancel-label="t('modal.cancel')"
      confirm-class="danger"
      :details="[
        t('config.saveConfirm', { path: editor.fragmentPath.value || serviceName }),
        t('config.saveReloadNotice'),
        t('config.saveRisk'),
        ...(editor.content.value.trim() === '' ? [t('config.saveEmptyWarning')] : []),
      ]"
      @cancel="showSaveModal = false"
      @confirm="onSaveConfirm"
    />
    <!-- 離開確認 Modal -->
    <ConfirmModal
      :show="showDiscardModal"
      :message="t('config.discardMessage')"
      :title="t('config.discardTitle')"
      :cancel-label="t('config.stay')"
      :confirm-label="t('config.discardChanges')"
      confirm-class="danger"
      @cancel="onStay"
      @confirm="onDiscard"
    />
    <!-- 409 衝突重新載入 Modal -->
    <ConfirmModal
      :show="showReloadModal"
      :message="t('config.conflict')"
      :title="t('config.conflictTitle')"
      :cancel-label="t('modal.cancel')"
      :confirm-label="t('config.reload')"
      confirm-class="primary"
      @cancel="showReloadModal = false"
      @confirm="onReloadAfterConflict"
    />
    <!-- ToastContainer 由 shell 統一提供（桌面 Modal → DashboardView；手機全頁 → ConfigEditorView），
         避免與 DashboardView 重複渲染造成 id="toast-container" 重複。 -->
  </div>
</template>

<style scoped>
.config-editor-content {
  width: 100%;
}
.config-editor-content--modal {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.config-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 0.5rem;
}
.config-header-main {
  display: flex;
  align-items: baseline;
  gap: 0.75rem;
  flex-wrap: wrap;
  min-width: 0;
}
.config-header h2 {
  font-size: 1.15rem;
  margin: 0;
  color: var(--lms-text);
}
.dirty-dot {
  color: var(--lms-warning, #f9a825);
  font-size: 1rem;
  vertical-align: middle;
  margin-left: 0.3rem;
}
.config-path {
  font-family: var(--lms-mono, Consolas, Menlo, monospace);
  font-size: 0.8rem;
  color: var(--lms-muted, #6b7280);
  word-break: break-all;
}
.config-close-btn {
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--lms-border);
  border-radius: var(--lms-radius-sm, 6px);
  background: var(--lms-surface);
  color: var(--lms-muted);
  cursor: pointer;
  transition: color var(--lms-transition), border-color var(--lms-transition);
}
.config-close-btn:hover {
  color: var(--lms-text);
  border-color: var(--lms-muted);
}
.config-close-btn:focus-visible {
  outline: 2px solid var(--lms-accent);
  outline-offset: 2px;
}
.config-loading {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 3rem 0;
  justify-content: center;
  color: var(--lms-muted);
}
.config-error-state {
  text-align: center;
  padding: 3rem 1rem;
}
.config-error-message {
  color: var(--lms-danger, #c62828);
  margin-bottom: 1rem;
}
.config-error-actions {
  display: flex;
  gap: 0.5rem;
  justify-content: center;
}
.config-notice.warning {
  padding: 0.6rem 0.9rem;
  border-radius: var(--lms-radius-sm, 6px);
  margin: 0.5rem 0;
  font-size: 0.9rem;
  background: var(--lms-warning-light, #fff8e1);
  color: #8a6d00;
  border: 1px solid var(--lms-warning-border, #ffe082);
}
.config-footer {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
  padding: 0.75rem 0;
}
.config-footer button {
  min-height: var(--lms-h, 36px);
}

/* Modal 內部捲動：header / footer 不捲，body 捲動 */
.config-editor-content--modal .config-header {
  flex: 0 0 auto;
  padding-top: 1rem;
}
.config-editor-content--modal .config-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
}
.config-editor-content--modal .config-footer {
  flex: 0 0 auto;
}

@media (max-width: 767px) {
  .config-footer button {
    flex: 1 1 auto;
    min-width: 0;
  }
  .config-header-main {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.3rem;
  }
}
</style>
