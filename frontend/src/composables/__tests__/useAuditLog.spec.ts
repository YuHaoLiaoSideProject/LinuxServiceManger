import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { nextTick } from 'vue'

// ---------------------------------------------------------------------------
// Mock axios before importing the composable
// ---------------------------------------------------------------------------

const { mockGet } = vi.hoisted(() => ({
  mockGet: vi.fn(),
}))

vi.mock('../../api/client', () => ({
  default: { get: mockGet },
}))

import { useAuditLog } from '../useAuditLog'

// Fake timers for debounce tests
beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
  vi.resetAllMocks()
})

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeEntry(overrides: Record<string, unknown> = {}) {
  return {
    timestamp: '2025-08-09T14:30:00Z',
    username: 'admin',
    source_ip: '192.168.1.100',
    action: 'start',
    target: 'nginx.service',
    result: 'success' as const,
    detail: '',
    ...overrides,
  }
}

function makeQueryResult(overrides: Partial<{
  data: ReturnType<typeof makeEntry>[]
  total: number
  page: number
  limit: number
}> = {}) {
  return {
    data: overrides.data ?? [makeEntry()],
    total: overrides.total ?? 1,
    page: overrides.page ?? 1,
    limit: overrides.limit ?? 50,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useAuditLog', () => {

  // -- Initial State ------------------------------------------------------

  it('F-AV-INIT-01: 初始 values 為預設值', () => {
    const {
      entries, total, page, limit, loading, error,
      search, dateFrom, dateTo, totalPages,
    } = useAuditLog()

    expect(entries.value).toEqual([])
    expect(total.value).toBe(0)
    expect(page.value).toBe(1)
    expect(limit.value).toBe(50)
    expect(loading.value).toBe(false)
    expect(error.value).toBeNull()
    expect(search.value).toBe('')
    expect(dateFrom.value).toBe('')
    expect(dateTo.value).toBe('')
    expect(totalPages.value).toBe(0)
  })

  // -- fetchAuditLog ------------------------------------------------------

  it('F-AV-FETCH-01: fetchAuditLog 成功載入資料', async () => {
    mockGet.mockResolvedValueOnce({ data: makeQueryResult({ total: 3 }) })

    const { entries, total, page, loading, error, fetchAuditLog } = useAuditLog()

    const promise = fetchAuditLog(1)
    expect(loading.value).toBe(true)
    await promise

    expect(loading.value).toBe(false)
    expect(error.value).toBeNull()
    expect(entries.value).toHaveLength(1) // fixture returns 1
    expect(total.value).toBe(3)
    expect(page.value).toBe(1)
  })

  it('F-AV-FETCH-02: fetchAuditLog API 錯誤 → error 設定', async () => {
    mockGet.mockRejectedValueOnce(new Error('Network Error'))

    const { loading, error, fetchAuditLog } = useAuditLog()

    await fetchAuditLog(1)

    expect(loading.value).toBe(false)
    expect(error.value).not.toBeNull()
    expect(error.value).toContain('Network Error')
  })

  it('F-AV-FETCH-03: fetchAuditLog API 500 → error 設定', async () => {
    const apiErr = new Error('failed to query audit log')
    mockGet.mockRejectedValueOnce(apiErr)

    const { error, fetchAuditLog } = useAuditLog()
    await fetchAuditLog(1)

    expect(error.value).toContain('failed to query audit log')
  })

  it('F-AV-FETCH-04: 較晚回應的舊請求不得覆蓋較新結果（out-of-order 防護）', async () => {
    // 兩個 pending promise，由測試自行控制回應順序
    const resolvers: Array<(v: { data: unknown }) => void> = []
    mockGet.mockImplementation(() => new Promise((resolve) => { resolvers.push(resolve) }))

    const { search, entries, total, loading, fetchAuditLog } = useAuditLog()

    // 請求 1（舊）：search=ngi
    search.value = 'ngi'
    const p1 = fetchAuditLog(1)
    // 請求 2（新）：search=nginx（搜尋框在請求進行中仍可輸入）
    search.value = 'nginx'
    const p2 = fetchAuditLog(1)

    // 兩個請求都真的送出了
    expect(mockGet).toHaveBeenCalledTimes(2)
    expect(mockGet.mock.calls[0][1].params.search).toBe('ngi')
    expect(mockGet.mock.calls[1][1].params.search).toBe('nginx')

    // 新請求先回應（total=1）→ 套用
    resolvers[1]({ data: makeQueryResult({ data: [makeEntry({ target: 'nginx.service' })], total: 1 }) })
    await p2
    expect(total.value).toBe(1)
    expect(entries.value).toHaveLength(1)

    // 舊請求較晚回應（total=99）→ 必須被忽略，不得覆蓋新結果
    resolvers[0]({ data: makeQueryResult({ data: [makeEntry({ target: 'stale' })], total: 99 }) })
    await p1
    expect(total.value).toBe(1)
    expect(entries.value).toHaveLength(1)
    expect(entries.value[0].target).toBe('nginx.service')
    expect(loading.value).toBe(false)
  })

  it('F-AV-FETCH-05: 較舊請求失敗也不影響較新請求的結果', async () => {
    const resolvers: Array<(err: Error | null, data?: unknown) => void> = []
    mockGet.mockImplementation(() => new Promise((resolve, reject) => {
      resolvers.push((err, data) => (err ? reject(err) : resolve(data)))
    }))

    const { entries, total, error, loading, fetchAuditLog } = useAuditLog()

    const p1 = fetchAuditLog(1)
    const p2 = fetchAuditLog(1)

    // 新請求先成功
    resolvers[1](null, { data: makeQueryResult({ data: [makeEntry()], total: 2 }) })
    await p2
    expect(total.value).toBe(2)
    expect(error.value).toBeNull()

    // 舊請求後失敗 → 不得污染較新請求的狀態
    resolvers[0](new Error('Network Error'))
    await p1
    expect(total.value).toBe(2)
    expect(entries.value).toHaveLength(1)
    expect(error.value).toBeNull()
    expect(loading.value).toBe(false)
  })

  // -- Pagination ---------------------------------------------------------

  it('F-AV-PAGE-01: goToPage(2) → fetch 第二頁', async () => {
    mockGet.mockResolvedValueOnce({ data: makeQueryResult({ total: 120 }) })
    mockGet.mockResolvedValueOnce({ data: makeQueryResult({ page: 2, total: 120 }) })

    const { page, totalPages, goToPage, fetchAuditLog } = useAuditLog()
    await fetchAuditLog(1)

    expect(totalPages.value).toBe(3) // ceil(120/50)

    const scrollSpy = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    goToPage(2)
    await nextTick()
    await nextTick()

    expect(page.value).toBe(2)
    expect(mockGet).toHaveBeenCalledTimes(2)
    expect(scrollSpy).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' })
    scrollSpy.mockRestore()
  })

  it('F-AV-PAGE-02: goToPage 邊界：page < 1 無動作', () => {
    const { page, goToPage } = useAuditLog()
    goToPage(0)
    expect(page.value).toBe(1)
    goToPage(-5)
    expect(page.value).toBe(1)
  })

  it('F-AV-PAGE-03: goToPage 邊界：page > totalPages 無動作', async () => {
    mockGet.mockResolvedValueOnce({ data: makeQueryResult({ total: 50 }) })

    const { page, goToPage, totalPages, fetchAuditLog } = useAuditLog()
    await fetchAuditLog(1)
    expect(totalPages.value).toBe(1)

    goToPage(99)
    expect(page.value).toBe(1) // unchanged
  })

  it('F-AV-PAGE-04: goToPage 點擊目前頁碼 → 不重複 fetch', async () => {
    mockGet.mockResolvedValueOnce({ data: makeQueryResult({ total: 120 }) })

    const { page, goToPage, fetchAuditLog } = useAuditLog()
    await fetchAuditLog(1)
    const callCount = mockGet.mock.calls.length

    goToPage(1) // same page
    expect(page.value).toBe(1)
    expect(mockGet).toHaveBeenCalledTimes(callCount) // no extra call
  })

  // -- Search (debounce) --------------------------------------------------

  it('F-AV-SRCH-01: onSearchInput → 300ms debounce 後 fetch page=1', async () => {
    mockGet.mockResolvedValueOnce({ data: makeQueryResult({ total: 0 }) })

    const { search, page, onSearchInput } = useAuditLog()

    onSearchInput('nginx')
    expect(search.value).toBe('nginx')
    expect(page.value).toBe(1) // immediately set

    // Before 300ms, no API call
    vi.advanceTimersByTime(200)
    await nextTick()
    expect(mockGet).not.toHaveBeenCalled()

    // After 300ms, API called
    vi.advanceTimersByTime(100)
    await nextTick()

    expect(mockGet).toHaveBeenCalledTimes(1)
    // Verify search param in call
    const callArgs = mockGet.mock.calls[0]
    expect(callArgs[0]).toBe('/audit')
    expect(callArgs[1].params.search).toBe('nginx')
    expect(callArgs[1].params.page).toBe('1')
  })

  it('F-AV-SRCH-02: 快速連續輸入 → 只發送最後一次 request', async () => {
    mockGet.mockResolvedValue({ data: makeQueryResult({ total: 0 }) })

    const { onSearchInput } = useAuditLog()

    onSearchInput('n')
    vi.advanceTimersByTime(100)
    onSearchInput('ng')
    vi.advanceTimersByTime(100)
    onSearchInput('ngi')
    vi.advanceTimersByTime(100)
    onSearchInput('nginx')

    // Only 100ms from last change — no call yet
    vi.advanceTimersByTime(200)
    await nextTick()
    expect(mockGet).not.toHaveBeenCalled()

    // Complete debounce
    vi.advanceTimersByTime(100)
    await nextTick()

    expect(mockGet).toHaveBeenCalledTimes(1)
    expect(mockGet.mock.calls[0][1].params.search).toBe('nginx')
  })

  // -- Date Range ---------------------------------------------------------

  it('F-AV-DATE-01: onDateRangeChange → 立即 fetch page=1', async () => {
    mockGet.mockResolvedValueOnce({ data: makeQueryResult({ total: 0 }) })

    const { dateFrom, dateTo, page, onDateRangeChange } = useAuditLog()

    onDateRangeChange('2025-08-01', '2025-08-09')

    expect(dateFrom.value).toBe('2025-08-01')
    expect(dateTo.value).toBe('2025-08-09')
    expect(page.value).toBe(1)

    await nextTick()
    expect(mockGet).toHaveBeenCalledTimes(1)
    expect(mockGet.mock.calls[0][1].params.from).toBe('2025-08-01')
    expect(mockGet.mock.calls[0][1].params.to).toBe('2025-08-09')
  })

  it('F-AV-DATE-02: onDateRangeChange 應拒絕 from > to 的無效日期範圍', async () => {
    mockGet.mockResolvedValueOnce({ data: makeQueryResult({ total: 0 }) })

    const { onDateRangeChange, error } = useAuditLog()

    // 開始日大於結束日為無效範圍
    onDateRangeChange('2025-08-09', '2025-08-01')
    await nextTick()

    // 不應發送 API 請求
    expect(mockGet).not.toHaveBeenCalled()
    // 應設定驗證錯誤訊息
    expect(error.value).toBeTruthy()
  })

  it('F-AV-DATE-03: onDateRangeChange 允許 from === to 的同一天範圍', async () => {
    mockGet.mockResolvedValueOnce({ data: makeQueryResult({ total: 1 }) })

    const { dateFrom, dateTo, onDateRangeChange } = useAuditLog()

    onDateRangeChange('2025-08-09', '2025-08-09')
    await nextTick()

    expect(dateFrom.value).toBe('2025-08-09')
    expect(dateTo.value).toBe('2025-08-09')
    // 合法範圍應正常發送 API
    expect(mockGet).toHaveBeenCalledTimes(1)
  })

  // -- Clear Filters ------------------------------------------------------

  it('F-AV-CLR-01: clearFilters → 清空 search/dateFrom/dateTo 重設 page=1', async () => {
    mockGet.mockResolvedValueOnce({ data: makeQueryResult({ total: 5 }) }) // after login
    mockGet.mockResolvedValueOnce({ data: makeQueryResult({ total: 5 }) }) // after clear

    const { search, dateFrom, dateTo, page, onSearchInput, onDateRangeChange, clearFilters } = useAuditLog()

    // Apply filters
    onSearchInput('nginx')
    vi.advanceTimersByTime(300)
    await nextTick()
    onDateRangeChange('2025-08-01', '2025-08-09')
    await nextTick()

    expect(search.value).toBe('nginx')
    expect(dateFrom.value).toBe('2025-08-01')

    // Clear
    mockGet.mockClear()
    clearFilters()

    expect(search.value).toBe('')
    expect(dateFrom.value).toBe('')
    expect(dateTo.value).toBe('')
    expect(page.value).toBe(1)
    await nextTick()

    expect(mockGet).toHaveBeenCalledTimes(1)
    const params = mockGet.mock.calls[0][1].params
    expect(params.search).toBeUndefined()
    expect(params.from).toBeUndefined()
    expect(params.to).toBeUndefined()
  })

  // -- CSV Export ---------------------------------------------------------

  it('F-AV-CSV-01: exportCSV 成功 → 觸發瀏覽器下載', async () => {
    const blobData = new Blob(['csv content'], { type: 'text/csv' })
    mockGet.mockResolvedValueOnce({ data: blobData })

    // Mock URL and anchor
    const createObjectURLSpy = vi.spyOn(window.URL, 'createObjectURL').mockReturnValue('blob:test')
    const revokeObjectURLSpy = vi.spyOn(window.URL, 'revokeObjectURL').mockImplementation(() => {})
    const clickSpy = vi.fn()
    const appendChildSpy = vi.spyOn(document.body, 'appendChild').mockImplementation((node) => {
      // When anchor is appended, simulate click
      const el = node as HTMLElement
      if (el.tagName === 'A') {
        el.click = clickSpy
      }
      return node
    })
    const removeChildSpy = vi.spyOn(document.body, 'removeChild').mockImplementation(() => ({} as any))

    const { exportCSV } = useAuditLog()
    await exportCSV()

    expect(mockGet).toHaveBeenCalledWith('/audit/export', {
      params: expect.objectContaining({ format: 'csv' }),
      responseType: 'blob',
    })
    expect(createObjectURLSpy).toHaveBeenCalled()
    expect(clickSpy).toHaveBeenCalled()
    expect(revokeObjectURLSpy).toHaveBeenCalled()

    createObjectURLSpy.mockRestore()
    revokeObjectURLSpy.mockRestore()
    appendChildSpy.mockRestore()
    removeChildSpy.mockRestore()
  })

  it('F-AV-CSV-02: exportCSV 失敗 → reject error', async () => {
    mockGet.mockRejectedValueOnce(new Error('Export failed'))

    const { exportCSV } = useAuditLog()
    await expect(exportCSV()).rejects.toThrow('Export failed')
  })

  it('F-AV-CSV-03: exportCSV 保留搜尋條件 → 請求含 search 參數', async () => {
    const blobData = new Blob(['csv'], { type: 'text/csv' })
    mockGet.mockResolvedValueOnce({ data: blobData })

    const { search, exportCSV } = useAuditLog()
    search.value = 'nginx'

    vi.spyOn(window.URL, 'createObjectURL').mockReturnValue('blob:test')
    vi.spyOn(window.URL, 'revokeObjectURL').mockImplementation(() => {})
    vi.spyOn(document.body, 'appendChild').mockImplementation((node) => node)
    vi.spyOn(document.body, 'removeChild').mockImplementation(() => ({} as any))

    await exportCSV()

    expect(mockGet).toHaveBeenCalledWith('/audit/export', {
      params: expect.objectContaining({ format: 'csv', search: 'nginx' }),
      responseType: 'blob',
    })

    vi.restoreAllMocks()
  })

  it('F-AV-CSV-04: exportCSV 保留日期條件 → 請求含 from/to 參數', async () => {
    const blobData = new Blob(['csv'], { type: 'text/csv' })
    mockGet.mockResolvedValueOnce({ data: blobData })

    const { dateFrom, dateTo, exportCSV } = useAuditLog()
    dateFrom.value = '2025-08-01'
    dateTo.value = '2025-08-09'

    vi.spyOn(window.URL, 'createObjectURL').mockReturnValue('blob:test')
    vi.spyOn(window.URL, 'revokeObjectURL').mockImplementation(() => {})
    vi.spyOn(document.body, 'appendChild').mockImplementation((node) => node)
    vi.spyOn(document.body, 'removeChild').mockImplementation(() => ({} as any))

    await exportCSV()

    expect(mockGet).toHaveBeenCalledWith('/audit/export', {
      params: expect.objectContaining({ format: 'csv', from: '2025-08-01', to: '2025-08-09' }),
      responseType: 'blob',
    })

    vi.restoreAllMocks()
  })

  // -- buildParams --------------------------------------------------------

  it('F-AV-PARAMS-01: buildParams 合併搜尋和日期參數', async () => {
    mockGet.mockResolvedValueOnce({ data: makeQueryResult({ total: 2 }) })

    const { onSearchInput, onDateRangeChange } = useAuditLog()

    onSearchInput('nginx')
    vi.advanceTimersByTime(300)
    await nextTick()

    onDateRangeChange('2025-08-01', '2025-08-09')
    await nextTick()

    const params = mockGet.mock.calls[mockGet.mock.calls.length - 1][1].params
    expect(params.search).toBe('nginx')
    expect(params.from).toBe('2025-08-01')
    expect(params.to).toBe('2025-08-09')
  })

  // -- fetchAuditLog with all filters -------------------------------------

  it('F-AV-FETCH-04: fetchAuditLog 傳遞所有過濾參數', async () => {
    mockGet.mockResolvedValueOnce({ data: makeQueryResult({ total: 0 }) })

    const { search, dateFrom, dateTo, fetchAuditLog } = useAuditLog()

    search.value = 'admin'
    dateFrom.value = '2025-08-01'
    dateTo.value = '2025-08-09'

    await fetchAuditLog(2) // page override

    expect(mockGet).toHaveBeenCalledWith('/audit', {
      params: {
        page: '2',
        limit: '50',
        search: 'admin',
        from: '2025-08-01',
        to: '2025-08-09',
      },
    })
  })
})
