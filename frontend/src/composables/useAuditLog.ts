import { ref, computed } from 'vue'
import axios from '../api/client'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AuditEntry {
  timestamp: string
  username: string
  source_ip: string
  action: string
  target: string
  result: 'success' | 'failure'
  detail: string
}

export interface AuditQueryResult {
  data: AuditEntry[]
  total: number
  page: number
  limit: number
}

// ---------------------------------------------------------------------------
// Composable
// ---------------------------------------------------------------------------

export function useAuditLog() {
  // -- reactive state -------------------------------------------------------

  const entries = ref<AuditEntry[]>([])
  const total = ref(0)
  const page = ref(1)
  const limit = ref(50)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const search = ref('')
  const dateFrom = ref('')
  const dateTo = ref('')

  // -- computed -------------------------------------------------------------

  const totalPages = computed(() => {
    if (total.value === 0) return 0
    return Math.ceil(total.value / limit.value)
  })

  // -- helpers --------------------------------------------------------------

  function buildParams(overridePage?: number): Record<string, string> {
    const params: Record<string, string> = {
      page: String(overridePage ?? page.value),
      limit: String(limit.value),
    }
    if (search.value) params.search = search.value
    if (dateFrom.value) params.from = dateFrom.value
    if (dateTo.value) params.to = dateTo.value
    return params
  }

  // -- actions --------------------------------------------------------------

  // 請求序號：搜尋框在請求進行中仍可輸入 → 可能同時有多個請求在飛。
  // 只套用「最新」請求的回應，避免較晚回應的舊請求覆蓋較新的搜尋結果。
  let requestSeq = 0

  async function fetchAuditLog(pageOverride?: number): Promise<void> {
    const seq = ++requestSeq
    loading.value = true
    error.value = null
    try {
      const { data } = await axios.get<AuditQueryResult>('/audit', {
        params: buildParams(pageOverride),
      })
      if (seq !== requestSeq) return // 已發出更新的請求 → 忽略這次回應
      entries.value = data.data
      total.value = data.total
      page.value = data.page
    } catch (err: unknown) {
      if (seq !== requestSeq) return // 舊請求失敗也不影響較新的請求
      let msg = '載入稽核紀錄時發生錯誤'
      if (err instanceof Error) {
        msg = (err as any).response?.data?.error || err.message
      }
      error.value = msg
      entries.value = []
      total.value = 0
    } finally {
      if (seq === requestSeq) loading.value = false
    }
  }

  function goToPage(p: number): void {
    if (p < 1 || p > totalPages.value || p === page.value) return
    page.value = p
    fetchAuditLog(p)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function clearFilters(): void {
    search.value = ''
    dateFrom.value = ''
    dateTo.value = ''
    page.value = 1
    fetchAuditLog(1)
  }

  async function exportCSV(): Promise<void> {
    try {
      const exportParams: Record<string, string> = { format: 'csv' }
      if (search.value) exportParams.search = search.value
      if (dateFrom.value) exportParams.from = dateFrom.value
      if (dateTo.value) exportParams.to = dateTo.value
      const response = await axios.get('/audit/export', {
        params: exportParams,
        responseType: 'blob',
      })
      const today = new Date().toISOString().slice(0, 10)
      const url = window.URL.createObjectURL(new Blob([response.data]))
      const link = document.createElement('a')
      link.href = url
      link.setAttribute('download', `audit-log-${today}.csv`)
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(url)
      return Promise.resolve()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '匯出失敗'
      return Promise.reject(new Error(msg))
    }
  }

  // -- event handlers (debounced) -------------------------------------------

  let debounceTimer: ReturnType<typeof setTimeout> | null = null

  function onSearchInput(value: string): void {
    search.value = value
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      page.value = 1
      fetchAuditLog(1)
    }, 300)
  }

  function onDateRangeChange(from: string, to: string): void {
    dateFrom.value = from
    dateTo.value = to
    // Validate: start date must not be after end date
    if (from && to && from > to) {
      error.value = '開始日期不能晚於結束日期'
      return
    }
    page.value = 1
    fetchAuditLog(1)
  }

  // -- public API -----------------------------------------------------------

  return {
    // reactive state
    entries,
    total,
    page,
    limit,
    loading,
    error,
    search,
    dateFrom,
    dateTo,

    // computed
    totalPages,

    // actions
    fetchAuditLog,
    goToPage,
    clearFilters,
    exportCSV,
    onSearchInput,
    onDateRangeChange,
    buildParams,
  }
}
