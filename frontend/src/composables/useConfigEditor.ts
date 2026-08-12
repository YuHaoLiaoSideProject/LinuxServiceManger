import { ref, computed } from 'vue'
import { getServiceConfig, saveServiceConfig, validateServiceConfig } from '../api/client'
import type { ValidateResponse } from '../types/service'

// useConfigEditor — 編輯器頁面單一狀態來源（dirty / baseChecksum / load / verify / save / beforeunload）
// （docs/development/012-service-config-editor.md §2.4）

export type EditorStatus = 'loading' | 'ready' | 'error' | 'not-found'
export type ValidateKind = 'success' | 'failure' | 'unavailable' | 'error' | null

export interface SaveOutcome {
  kind: 'success' | 'conflict' | 'reload-failed' | 'error'
  backupPath?: string
  currentChecksum?: string
  error?: string
}

export function useConfigEditor(serviceName: string) {
  const initialContent = ref('') // GET 回傳之原始內容（dirty 比對基準）
  const content = ref('') // 目前編輯內容（v-model 到 UnitFileEditor）
  const baseChecksum = ref('') // GET 回傳 checksum；409 重新載入後更新
  const fragmentPath = ref('')
  const size = ref(0)
  const status = ref<EditorStatus>('loading')
  const errorMessage = ref<string | null>(null)
  const validation = ref<ValidateResponse | null>(null)
  const validationKind = ref<ValidateKind>(null)
  const validationError = ref<string | null>(null) // 驗證請求錯誤訊息（400/422 → 「請求格式錯誤」）
  const isVerifying = ref(false)
  const isSaving = ref(false)

  // dirty = 目前內容 ≠ 初始內容（內容比對，非 flag 累計）
  const isDirty = computed(() => content.value !== initialContent.value)
  // 檔案超過 500KB 效能提示
  const isLargeFile = computed(() => size.value > 500 * 1024)

  async function load(): Promise<void> {
    status.value = 'loading'
    errorMessage.value = null
    validation.value = null
    validationKind.value = null
    try {
      const res = await getServiceConfig(serviceName)
      initialContent.value = res.config
      content.value = res.config
      baseChecksum.value = res.checksum
      fragmentPath.value = res.fragmentPath
      size.value = res.size
      status.value = 'ready'
    } catch (e: any) {
      if (e?.response?.status === 404) {
        // 設定檔不存在 → 空編輯器 + 黃色提示，仍可輸入內容儲存（重建）
        initialContent.value = ''
        content.value = ''
        baseChecksum.value = ''
        fragmentPath.value = e?.response?.data?.error?.includes(':')
          ? e.response.data.error.split(': ')[1] ?? ''
          : ''
        status.value = 'not-found'
      } else {
        status.value = 'error'
        errorMessage.value = e?.response?.data?.error || '載入設定檔失敗'
      }
    }
  }

  function setContent(v: string) {
    content.value = v
    // 內容變更 → 自動清除先前驗證結果（BDD：舊驗證失效）
    if (isDirty.value) clearValidation()
  }

  function clearValidation() {
    validation.value = null
    validationKind.value = null
  }

  async function verify(): Promise<boolean> {
    if (content.value.trim() === '') {
      // 空內容前端攔截，不發請求（F-VL-02 / F-AP-06）
      return false
    }
    isVerifying.value = true
    try {
      const res = await validateServiceConfig(serviceName, content.value)
      validation.value = res
      validationKind.value = res.available ? (res.valid ? 'success' : 'failure') : 'unavailable'
      return res.valid
    } catch (e: any) {
      const status = e?.response?.status
      validationKind.value = 'error' // 500/網路錯誤 → 黃色警告
      validationError.value = status === 400 || status === 422
        ? '請求格式錯誤'
        : (e?.response?.data?.error || '')
      return false
    } finally {
      isVerifying.value = false
    }
  }

  async function save(): Promise<SaveOutcome> {
    isSaving.value = true
    try {
      const res = await saveServiceConfig(serviceName, {
        config: content.value,
        baseChecksum: baseChecksum.value,
      })
      initialContent.value = content.value // 成功 → 轉 clean
      return { kind: 'success', backupPath: res.backupPath }
    } catch (e: any) {
      const statusCode = e?.response?.status
      if (statusCode === 409) {
        return { kind: 'conflict', currentChecksum: e?.response?.data?.currentChecksum }
      }
      if (e?.response?.data?.backupPath) {
        return {
          kind: 'reload-failed',
          backupPath: e.response.data.backupPath,
          error: e.response.data.error,
        }
      }
      return {
        kind: 'error',
        error: e?.response?.data?.error || (e?.request ? '網路連線異常，請稍後重試' : '儲存失敗'),
      }
    } finally {
      isSaving.value = false
    }
  }

  // 409 重新載入：重新 GET 並更新 baseChecksum
  async function reloadAfterConflict(): Promise<void> {
    await load()
  }

  // discard：放棄未儲存變更（內容還原回初始 → clean，讓 route guard 放行）
  function discard() {
    content.value = initialContent.value
    clearValidation()
  }

  // beforeunload 第三層防護：dirty 時觸發瀏覽器原生確認
  function onBeforeUnload(e: BeforeUnloadEvent) {
    if (isDirty.value) {
      e.preventDefault()
      e.returnValue = ''
    }
  }

  return {
    content,
    initialContent,
    isDirty,
    isLargeFile,
    status,
    errorMessage,
    fragmentPath,
    size,
    validation,
    validationKind,
    validationError,
    isVerifying,
    isSaving,
    baseChecksum,
    load,
    setContent,
    verify,
    save,
    reloadAfterConflict,
    discard,
    onBeforeUnload,
  }
}
