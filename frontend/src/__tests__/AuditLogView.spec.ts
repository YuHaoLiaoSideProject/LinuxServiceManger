import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ref, computed } from 'vue'
import type { AuditEntry } from '../composables/useAuditLog'

// ---------------------------------------------------------------------------
// Shared reactive state — mutated by tests, referenced by composable mock
// ---------------------------------------------------------------------------

const entries = ref<AuditEntry[]>([])
const total = ref(0)
const page = ref(1)
const loading = ref(false)
const error = ref<string | null>(null)
const search = ref('')
const dateFrom = ref('')
const dateTo = ref('')
const totalPages = computed(() => {
  if (total.value === 0) return 0
  return Math.ceil(total.value / 50)
})

const mockFetchAuditLog = vi.fn()
const mockGoToPage = vi.fn()
const mockClearFilters = vi.fn()
const mockExportCSV = vi.fn()
const mockOnSearchInput = vi.fn()
const mockOnDateRangeChange = vi.fn()

vi.mock('../composables/useAuditLog', () => ({
  useAuditLog: () => ({
    entries,
    total,
    page,
    loading,
    error,
    search,
    dateFrom,
    dateTo,
    totalPages,
    fetchAuditLog: mockFetchAuditLog,
    goToPage: mockGoToPage,
    clearFilters: mockClearFilters,
    exportCSV: mockExportCSV,
    onSearchInput: mockOnSearchInput,
    onDateRangeChange: mockOnDateRangeChange,
  }),
}))

const mockShowToast = vi.fn()
vi.mock('../composables/useToast', () => ({
  useToast: () => ({ showToast: mockShowToast }),
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEntry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    timestamp: '2025-08-09T14:30:00Z',
    username: 'admin',
    source_ip: '192.168.1.100',
    action: 'start',
    target: 'nginx.service',
    result: 'success',
    detail: '',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

import AuditLogView from '../views/AuditLogView.vue'

describe('AuditLogView — 稽核紀錄頁面', () => {

  beforeEach(() => {
    // Reset all reactive state to defaults
    entries.value = []
    total.value = 0
    page.value = 1
    loading.value = false
    error.value = null
    search.value = ''
    dateFrom.value = ''
    dateTo.value = ''

    vi.clearAllMocks()
  })

  // -- Mount Lifecycle ---------------------------------------------------

  it('F-AV-01: onMounted → 自動呼叫 fetchAuditLog(1)', () => {
    mount(AuditLogView)
    expect(mockFetchAuditLog).toHaveBeenCalledWith(1)
  })

  // -- Loading State -----------------------------------------------------

  it('F-AV-02: loading=true → 顯示 spinner', () => {
    loading.value = true
    const wrapper = mount(AuditLogView)
    expect(wrapper.find('.spinner-sm').exists()).toBe(true)
  })

  it('F-AV-03: loading=true 時不顯示表格', () => {
    loading.value = true
    total.value = 5
    entries.value = [makeEntry()]
    const wrapper = mount(AuditLogView)
    expect(wrapper.find('table').exists()).toBe(false)
  })

  // -- Error State -------------------------------------------------------

  it('F-AV-04: error 存在 → 顯示錯誤訊息 + 重試按鈕', () => {
    error.value = '載入失敗'
    const wrapper = mount(AuditLogView)
    expect(wrapper.text()).toContain('載入失敗')
    const retryBtn = wrapper.find('.empty-state button')
    expect(retryBtn.exists()).toBe(true)
    expect(retryBtn.text()).toBe('重試')
  })

  it('F-AV-05: 點擊重試 → 呼叫 fetchAuditLog(currentPage)', async () => {
    error.value = '載入失敗'
    page.value = 3
    const wrapper = mount(AuditLogView)
    // onMounted triggers fetchAuditLog(1), clear it and test retry separately
    mockFetchAuditLog.mockClear()
    await wrapper.find('.empty-state button').trigger('click')
    expect(mockFetchAuditLog).toHaveBeenCalledWith(3)
  })

  // -- Empty State (no records at all) -----------------------------------

  it('F-AV-06: total=0, 無過濾條件 → 顯示「尚無操作紀錄」', () => {
    total.value = 0
    search.value = ''
    dateFrom.value = ''
    dateTo.value = ''
    const wrapper = mount(AuditLogView)
    expect(wrapper.text()).toContain('尚無操作紀錄')
  })

  // -- Empty with Active Filters -----------------------------------------

  it('F-AV-07: entries=0, search 有值 → 顯示「沒有符合條件的紀錄」+ 清除過濾連結', () => {
    total.value = 10
    entries.value = []
    search.value = 'xyz'
    const wrapper = mount(AuditLogView)
    expect(wrapper.text()).toContain('沒有符合條件的紀錄')
    expect(wrapper.find('.clear-link').exists()).toBe(true)
    expect(wrapper.find('.clear-link').text()).toBe('清除過濾')
  })

  it('F-AV-08: 點擊清除過濾 → 呼叫 clearFilters()', async () => {
    total.value = 10
    entries.value = []
    search.value = 'xyz'
    const wrapper = mount(AuditLogView)
    await wrapper.find('.clear-link').trigger('click')
    expect(mockClearFilters).toHaveBeenCalled()
  })

  // -- Table with Data ---------------------------------------------------

  it('F-AV-09: 有 entries → 顯示 AuditTable 元件', () => {
    total.value = 1
    entries.value = [makeEntry()]
    const wrapper = mount(AuditLogView)
    // AuditTable renders a table element
    expect(wrapper.find('table').exists()).toBe(true)
  })

  // -- Search ------------------------------------------------------------

  it('F-AV-10: 搜尋框 input → 呼叫 onSearchInput', async () => {
    const wrapper = mount(AuditLogView)
    const input = wrapper.find('.search-box input')
    await input.setValue('nginx')
    expect(mockOnSearchInput).toHaveBeenCalledWith('nginx')
  })

  it('F-AV-11: search 有值 → 顯示「找到 N 筆紀錄」', () => {
    search.value = 'nginx'
    total.value = 15
    const wrapper = mount(AuditLogView)
    expect(wrapper.find('.search-result-count').exists()).toBe(true)
    expect(wrapper.find('.search-result-count').text()).toContain('15')
  })

  it('F-AV-12: search 為空 → 不顯示搜尋計數', () => {
    search.value = ''
    const wrapper = mount(AuditLogView)
    expect(wrapper.find('.search-result-count').exists()).toBe(false)
  })

  // -- Date Range --------------------------------------------------------

  it('F-AV-13: dateFrom 變更 → v-model 綁定 + @change 呼叫 onDateRangeChange', async () => {
    const wrapper = mount(AuditLogView)
    const dateInputs = wrapper.findAll('input[type="date"]')
    expect(dateInputs).toHaveLength(2)
    await dateInputs[0].setValue('2025-08-01')
    expect(mockOnDateRangeChange).toHaveBeenCalled()
  })

  it('F-AV-13b: 清除日期範圍 → onDateRangeChange 收到空字串', async () => {
    dateFrom.value = '2025-08-01'
    dateTo.value = '2025-08-09'
    const wrapper = mount(AuditLogView)
    mockOnDateRangeChange.mockClear()
    const dateInputs = wrapper.findAll('input[type="date"]')
    // Clear the first date input
    await dateInputs[0].setValue('')
    // handleDateChange is called, which reads current dateFrom/dateTo values
    expect(mockOnDateRangeChange).toHaveBeenCalled()
  })

  // -- CSV Export --------------------------------------------------------

  it('F-AV-14: 點擊匯出 CSV → 呼叫 exportCSV + showToast 成功', async () => {
    mockExportCSV.mockResolvedValueOnce(undefined)
    const wrapper = mount(AuditLogView)
    await wrapper.find('.btn-export').trigger('click')
    await flushPromises()
    expect(mockExportCSV).toHaveBeenCalled()
    expect(mockShowToast).toHaveBeenCalledWith('稽核紀錄已匯出')
  })

  it('F-AV-15: exportCSV 失敗 → showToast error', async () => {
    mockExportCSV.mockRejectedValueOnce(new Error('匯出失敗'))
    const wrapper = mount(AuditLogView)
    await wrapper.find('.btn-export').trigger('click')
    await flushPromises()
    expect(mockShowToast).toHaveBeenCalledWith('匯出失敗', 'error')
  })

  // -- Pagination --------------------------------------------------------

  it('F-AV-16: totalPages > 1 → 顯示分頁控制', () => {
    total.value = 120
    entries.value = [makeEntry()]
    const wrapper = mount(AuditLogView)
    expect(wrapper.find('.pagination').exists()).toBe(true)
  })

  it('F-AV-17: totalPages = 0 → 不顯示分頁控制', () => {
    total.value = 0
    entries.value = []
    const wrapper = mount(AuditLogView)
    expect(wrapper.find('.pagination').exists()).toBe(false)
  })

  it('F-AV-18: 點擊下一頁 → 呼叫 goToPage(page+1)', async () => {
    total.value = 120
    page.value = 1
    entries.value = [makeEntry()]
    const wrapper = mount(AuditLogView)

    const allBtns = wrapper.findAll('button.page-btn')
    const nextBtn = allBtns[allBtns.length - 1]
    await nextBtn.trigger('click')
    expect(mockGoToPage).toHaveBeenCalledWith(2)
  })

  it('F-AV-19: 點擊上一頁 → 呼叫 goToPage(page-1)', async () => {
    total.value = 120
    page.value = 2
    entries.value = [makeEntry()]
    const wrapper = mount(AuditLogView)

    const prevBtn = wrapper.find('button.page-btn')
    await prevBtn.trigger('click')
    expect(mockGoToPage).toHaveBeenCalledWith(1)
  })

  it('F-AV-20: page=1 → 上一頁 disabled', () => {
    total.value = 120
    page.value = 1
    entries.value = [makeEntry()]
    const wrapper = mount(AuditLogView)

    const prevBtn = wrapper.find('button.page-btn')
    expect(prevBtn.attributes('disabled')).toBeDefined()
  })

  it('F-AV-21: page=最後一頁 → 下一頁 disabled', () => {
    total.value = 120
    page.value = 3
    entries.value = [makeEntry()]
    const wrapper = mount(AuditLogView)

    const allBtns = wrapper.findAll('button.page-btn')
    const nextBtn = allBtns[allBtns.length - 1]
    expect(nextBtn.attributes('disabled')).toBeDefined()
  })

  it('F-AV-22: 點擊頁碼按鈕 → 呼叫 goToPage(p)', async () => {
    total.value = 250
    page.value = 1
    entries.value = [makeEntry()]
    const wrapper = mount(AuditLogView)

    const pageButtons = wrapper.findAll('button.page-btn')
    const page3Btn = pageButtons.find(b => b.text().trim() === '3')
    expect(page3Btn).toBeDefined()
    await page3Btn!.trigger('click')
    expect(mockGoToPage).toHaveBeenCalledWith(3)
  })

  it('F-AV-23: active page 有 .active class', () => {
    total.value = 250
    page.value = 2
    entries.value = [makeEntry()]
    const wrapper = mount(AuditLogView)

    const pageButtons = wrapper.findAll('button.page-btn')
    const activeBtn = pageButtons.find(b => b.classes().includes('active'))
    expect(activeBtn).toBeDefined()
    expect(activeBtn!.text().trim()).toBe('2')
  })

  it('F-AV-24: 分頁資訊顯示「第 N / M 頁，共 T 筆」', () => {
    total.value = 120
    page.value = 2
    entries.value = [makeEntry()]
    const wrapper = mount(AuditLogView)

    expect(wrapper.find('.page-info').text()).toContain('第 2 / 3 頁，共 120 筆')
  })
})
