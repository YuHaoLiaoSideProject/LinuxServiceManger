<script setup lang="ts">
// ConfigEditorView.vue — 服務設定檔編輯器路由視圖（012）
// 載入 / 錯誤 / 404 三態、驗證面板（綠/紅/黃）、儲存 ConfirmModal、
// dirty 三層防護（onBeforeRouteLeave + 頁內 Cancel + beforeunload）
// UIUX：docs/uiux/012-service-config-editor-design.md
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useRoute, useRouter, onBeforeRouteLeave } from 'vue-router'
import UnitFileEditor from '../components/UnitFileEditor.vue'
import ConfirmModal from '../components/ConfirmModal.vue'
import ToastContainer from '../components/ToastContainer.vue'
import { useConfigEditor } from '../composables/useConfigEditor'
import { useToast } from '../composables/useToast'
import { useI18n } from '../composables/useI18n'
import { useServiceStore } from '../stores/service'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const { showToast } = useToast()
const store = useServiceStore()
const serviceName = route.params.name as string
const editor = useConfigEditor(serviceName)

// readOnly：View Config 進入（?readonly=1）或 store 中該服務 locked=true
const readOnly = computed(
  () => route.query.readonly === '1' || store.services.find(s => s.name === serviceName)?.locked === true,
)

const editorRef = ref<InstanceType<typeof UnitFileEditor> | null>(null)
watch(editor.validationKind, (k) => {
  if (k === 'failure' && editor.validation.value) {
    editorRef.value?.clearMarks()
    editorRef.value?.setErrorMarks(editor.validation.value.errors.map(e => e.line))
  } else {
    editorRef.value?.clearMarks()
  }
})

// ── 載入 ──
onMounted(async () => {
  await editor.load()
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
    showToast(t('config.saved', { name: serviceName }), 'success')
    setTimeout(() => router.push('/'), 1500) // 1.5s 後自動返回 Dashboard
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

// ── 離開確認 Modal（第二層：頁內 Cancel / 返回鍵共用）──
const showDiscardModal = ref(false)
let leaveDecision: ((ok: boolean) => void) | null = null

function requestLeave() {
  if (!editor.isDirty.value) {
    router.push('/')
    return
  }
  showDiscardModal.value = true
}

function onStay() {
  showDiscardModal.value = false
  leaveDecision?.(false)
  leaveDecision = null
}

function onDiscard() {
  showDiscardModal.value = false
  editor.discard() // 清 dirty，讓 route guard 放行
  showToast(t('config.discarded'), 'warning')
  if (leaveDecision) {
    leaveDecision(true)
    leaveDecision = null
  } else {
    router.push('/')
  }
}

// 第一層：route guard（含瀏覽器返回鍵/程式導航）— 非同步 promise 決策
onBeforeRouteLeave(() => {
  if (!editor.isDirty.value || editor.isSaving.value) return true
  return new Promise<boolean>((resolve) => {
    showDiscardModal.value = true
    leaveDecision = resolve
  })
})

// 第三層：beforeunload（分頁關閉原生確認）
onMounted(() => window.addEventListener('beforeunload', editor.onBeforeUnload))
onBeforeUnmount(() => window.removeEventListener('beforeunload', editor.onBeforeUnload))

// 唯讀模式僅 Close
function onClose() {
  if (editor.isDirty.value) requestLeave()
  else router.push('/')
}
</script>

<template>
  <div class="config-editor-page">
    <!-- 載入中 -->
    <div v-if="editor.status.value === 'loading'" class="config-loading" role="status">
      <span class="spinner" aria-hidden="true"></span>{{ t('config.loading') }}
    </div>

    <!-- 載入失敗（非 404）→ 錯誤 + 返回/重試 -->
    <div v-else-if="editor.status.value === 'error'" class="config-error-state">
      <p class="config-error-message" role="alert">{{ editor.errorMessage.value }}</p>
      <div class="config-error-actions">
        <button class="outline secondary" @click="router.push('/')">{{ t('config.back') }}</button>
        <button class="primary" @click="editor.load()">{{ t('config.retry') }}</button>
      </div>
    </div>

    <template v-else>
      <!-- 標題列：服務名稱 + dirty 指示 + FragmentPath -->
      <header class="config-header">
        <h2>
          {{ serviceName }}
          <span
            v-if="editor.isDirty.value"
            class="dirty-dot"
            title="未儲存變更"
            aria-label="未儲存變更"
          >●</span>
        </h2>
        <code class="config-path">{{ editor.fragmentPath.value }}</code>
      </header>

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
          <button class="outline secondary" :disabled="editor.isSaving.value" @click="requestLeave">
            {{ t('config.cancel') }}
          </button>
        </template>
        <button v-else class="outline secondary" @click="onClose">{{ t('config.close') }}</button>
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

    <ToastContainer />
  </div>
</template>

<style scoped>
.config-editor-page {
  max-width: 960px;
  margin: 0 auto;
  padding: 1rem 0 2rem;
}
.config-header {
  display: flex;
  align-items: baseline;
  gap: 0.75rem;
  flex-wrap: wrap;
  margin-bottom: 0.5rem;
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
@media (max-width: 767px) {
  .config-footer button {
    flex: 1 1 auto;
    min-width: 0;
  }
  .config-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.3rem;
  }
}
</style>
