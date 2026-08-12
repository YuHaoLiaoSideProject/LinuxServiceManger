import { ref, computed } from 'vue'
import type { Ref, ComputedRef } from 'vue'
import { listTokens, createToken, revokeToken } from '../api/client'
import type { TokenResponse, CreateTokenRequest, CreateTokenResponse, TokenStatus } from '../types/service'
import { useToast } from './useToast'

export interface ExpiryOption {
  value: number
  label: string
}

export function useTokenManager() {
  const { showToast } = useToast()

  // ── State ──
  const tokens: Ref<TokenResponse[]> = ref([])
  const isLoading: Ref<boolean> = ref(false)
  const error: Ref<string | null> = ref(null)

  // ── Create form state ──
  const showCreateForm: Ref<boolean> = ref(false)
  const createFormName: Ref<string> = ref('')
  const createFormExpiry: Ref<number> = ref(90)      // default 90 天
  const createFormScope: Ref<'read' | 'full'> = ref('full')
  const createFormCustomDate: Ref<string> = ref('')  // 僅 expires_in_days=0 時
  const isSubmitting: Ref<boolean> = ref(false)
  const createError: Ref<string | null> = ref(null)

  // ── Reveal modal state ──
  const revealToken: Ref<CreateTokenResponse | null> = ref(null)
  const showRevealModal: Ref<boolean> = ref(false)

  // ── Revoke confirm state ──
  const revokingToken: Ref<TokenResponse | null> = ref(null)
  const isRevoking: Ref<boolean> = ref(false)

  // ── Computed ──
  const sortedTokens: ComputedRef<TokenResponse[]> = computed(() =>
    [...tokens.value].sort((a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    )
  )

  // ── Methods ──
  async function fetchTokens(): Promise<void> {
    isLoading.value = true
    error.value = null
    try {
      const res = await listTokens()
      tokens.value = res.data || []
    } catch (err: any) {
      error.value = err.response?.data?.error || '載入失敗，請稍後重試'
    } finally {
      isLoading.value = false
    }
  }

  function resetCreateForm(): void {
    createFormName.value = ''
    createFormExpiry.value = 90
    createFormScope.value = 'full'
    createFormCustomDate.value = ''
    createError.value = null
  }

  function validateCreateForm(): string | null {
    if (!createFormName.value.trim()) {
      return '名稱為必填'
    }
    if (createFormExpiry.value === 0 && !createFormCustomDate.value) {
      return '請選擇過期日期'
    }
    const minDate = new Date()
    minDate.setDate(minDate.getDate() + 1)
    minDate.setHours(0, 0, 0, 0)
    if (createFormExpiry.value === 0 && new Date(createFormCustomDate.value) < minDate) {
      return '過期日期不可為過去'
    }
    return null
  }

  async function submitCreate(): Promise<void> {
    const validationError = validateCreateForm()
    if (validationError) {
      createError.value = validationError
      return
    }

    isSubmitting.value = true
    createError.value = null
    try {
      const req: CreateTokenRequest = {
        name: createFormName.value.trim(),
        expires_in_days: createFormExpiry.value,
        scope: createFormScope.value,
      }
      if (createFormExpiry.value === 0) {
        req.custom_expiry = new Date(createFormCustomDate.value).toISOString()
      }

      const res = await createToken(req)
      revealToken.value = res
      showRevealModal.value = true
      showCreateForm.value = false
      resetCreateForm()
    } catch (err: any) {
      const msg = err.response?.data?.error
      if (msg) {
        createError.value = msg
      } else {
        createError.value = '建立失敗，請稍後重試'
      }
    } finally {
      isSubmitting.value = false
    }
  }

  function closeRevealModal(): void {
    revealToken.value = null
    showRevealModal.value = false
    fetchTokens()
    showToast('Token 已建立')
  }

  async function copyTokenToClipboard(): Promise<void> {
    if (!revealToken.value) return
    try {
      await navigator.clipboard.writeText(revealToken.value.token)
      showToast('Token 已複製')
    } catch {
      // Fallback for older browsers
      const textarea = document.createElement('textarea')
      textarea.value = revealToken.value.token
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
      showToast('Token 已複製')
    }
  }

  async function confirmRevoke(id: string): Promise<void> {
    isRevoking.value = true
    try {
      await revokeToken(id)
      // Update local state
      const idx = tokens.value.findIndex(t => t.id === id)
      if (idx >= 0) {
        tokens.value[idx] = { ...tokens.value[idx], status: 'revoked' as TokenStatus }
      }
      showToast('Token 已撤銷')
      revokingToken.value = null
    } catch (err: any) {
      const msg = err.response?.data?.error || '撤銷失敗，請重試'
      showToast(msg)
    } finally {
      isRevoking.value = false
    }
  }

  // ── Expiry options ──
  const expiryOptions: ExpiryOption[] = [
    { value: 30, label: '30 天' },
    { value: 60, label: '60 天' },
    { value: 90, label: '90 天' },
    { value: 180, label: '180 天' },
    { value: 365, label: '365 天' },
    { value: -1, label: '永不過期' },
    { value: 0, label: '自訂日期' },
  ]

  // ── Status helpers ──
  function statusLabel(status: TokenStatus): string {
    switch (status) {
      case 'active': return '🟢 使用中'
      case 'expiring_soon': return '🟡 即將過期'
      case 'expired': return '🔴 已過期'
      case 'revoked': return '⚫ 已撤銷'
      default: return status
    }
  }

  function scopeLabel(scope: 'read' | 'full'): string {
    return scope === 'full' ? '完整操作' : '唯讀'
  }

  function formatDate(iso: string | null): string {
    if (!iso) return '從未使用'
    return new Date(iso).toLocaleString()
  }

  function formatExpiry(iso: string | null): string {
    if (!iso) return '永不過期'
    return new Date(iso).toLocaleDateString()
  }

  return {
    // State
    tokens, isLoading, error, sortedTokens,
    showCreateForm, createFormName, createFormExpiry, createFormScope,
    createFormCustomDate, isSubmitting, createError,
    revealToken, showRevealModal,
    revokingToken, isRevoking,
    expiryOptions,
    // Methods
    fetchTokens, resetCreateForm, submitCreate,
    closeRevealModal, copyTokenToClipboard, confirmRevoke,
    // Helpers
    statusLabel, scopeLabel, formatDate, formatExpiry,
  }
}
