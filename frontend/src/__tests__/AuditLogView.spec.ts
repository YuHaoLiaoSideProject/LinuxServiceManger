import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ref, computed, nextTick } from 'vue'
import type { AuditEntry } from '../composables/useAuditLog'

// ---------------------------------------------------------------------------
// Mock auth store (Pinia)
// ---------------------------------------------------------------------------

const mockAuthLogout = vi.fn()

vi.mock('../stores/auth', () => ({
  useAuthStore: () => ({
    username: 'admin',
    isLoggedIn: true,
    loading: false,
    logout: mockAuthLogout,
    init: vi.fn(),
  }),
}))

// ---------------------------------------------------------------------------
// Mock vue-router
// ---------------------------------------------------------------------------

const mockRouterReplace = vi.fn()

vi.mock('vue-router', () => ({
  useRouter: () => ({
    replace: mockRouterReplace,
  }),
  useRoute: () => ({ path: '/audit' }),
  createRouter: vi.fn(),
  createWebHistory: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Mock i18n
// ---------------------------------------------------------------------------

const { mockT } = vi.hoisted(() => ({
  mockT: vi.fn((key: string, params?: Record<string, string>) => {
    const map: Record<string, string> = {
      'audit.title': '稽核紀錄',
      'audit.searchPlaceholder': '搜尋操作者、動作、目標服務...',
      'audit.exportCsv': '匯出 CSV',
      'audit.exportSuccess': '稽核紀錄已匯出',
      'audit.exportFailed': '匯出失敗',
      'audit.pagination.prev': '上一頁',
      'audit.pagination.next': '下一頁',
      'audit.pagination.info': '第 {page} / {total} 頁，共 {count} 筆',
      'audit.matched.prefix': '符合',
      'audit.matched.suffix': '筆記錄',
      'audit.noRecords': '尚無操作紀錄',
      'audit.noMatch': '沒有符合條件的紀錄',
      'audit.clearFilters': '清除條件',
      'audit.retry': '重試',
      'audit.dateFrom': '開始日期',
      'audit.dateTo': '結束日期',
      'audit.dateError': '開始日期不能晚於結束日期',
      'audit.col.time': '時間',
      'audit.col.user': '使用者',
      'audit.col.sourceIp': '來源 IP',
      'audit.col.action': '動作',
      'audit.col.target': '目標服務',
      'audit.col.result': '結果',
      'audit.col.detail': '詳細資訊',
      'audit.action.login': '登入',
      'audit.action.logout': '登出',
      'audit.action.start': '啟動',
      'audit.action.stop': '停止',
      'audit.action.restart': '重啟',
      'audit.action.enable': '啟用',
      'audit.action.disable': '停用',
      'audit.result.success': '成功',
      'audit.result.failure': '失敗',
    }
    let text = map[key] || key
    if (params) {
      text = text.replace(/\{(\w+)\}/g, (_, k) => params[k] || '')
    }
    return text
  }),
}))

vi.mock('../composables/useI18n', () => ({
  useI18n: () => ({
    t: mockT,
    toggleLang: vi.fn(),
    locale: ref('zh-TW'),
  }),
}))

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

  it('F-AV-02: loading=true 且無既有資料 → 顯示 spinner', () => {
    loading.value = true
    const wrapper = mount(AuditLogView)
    expect(wrapper.find('.spinner-sm').exists()).toBe(true)
  })

  it('F-AV-03: loading=true 但有既有資料（搜尋/重新整理）→ 表格保持顯示（不閃爍）', () => {
    loading.value = true
    total.value = 5
    entries.value = [makeEntry()]
    const wrapper = mount(AuditLogView)
    // Bug 回歸：呼叫 API 刷新時不得把表格換成 spinner（畫面閃爍）
    expect(wrapper.find('table').exists()).toBe(true)
    expect(wrapper.find('.spinner-sm').exists()).toBe(false)
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
    expect(wrapper.find('.clear-link').text()).toBe('清除條件')
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

  it('F-AV-11: search 有值 → 條件回饋列顯示「符合 N 筆記錄」', () => {
    search.value = 'nginx'
    total.value = 15
    const wrapper = mount(AuditLogView)
    expect(wrapper.find('.cond-row').exists()).toBe(true)
    expect(wrapper.find('.cond-row').text()).toContain('15')
  })

  it('F-AV-12: 無任何過濾條件 → 不顯示條件回饋列', () => {
    search.value = ''
    const wrapper = mount(AuditLogView)
    expect(wrapper.find('.cond-row').exists()).toBe(false)
  })

  // -- Date Range --------------------------------------------------------

  it('F-AV-13: dateFrom 變更 → v-model 綁定 + input 觸發 onDateRangeChange', async () => {
    const wrapper = mount(AuditLogView)
    const dateInputs = wrapper.findAll('.daterange input')
    expect(dateInputs).toHaveLength(2)
    await dateInputs[0].setValue('2025-08-01')
    expect(mockOnDateRangeChange).toHaveBeenCalled()
  })

  it('F-AV-13b: 清除日期範圍 → onDateRangeChange 收到空字串', async () => {
    dateFrom.value = '2025-08-01'
    dateTo.value = '2025-08-09'
    const wrapper = mount(AuditLogView)
    mockOnDateRangeChange.mockClear()
    const dateInputs = wrapper.findAll('.daterange input')
    // Clear the first date input
    await dateInputs[0].setValue('')
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

  // -- i18n: User-facing strings should not be hardcoded -----------------

  it('F-AV-I18N-02: 匯出按鈕應使用 i18n 而非硬編碼', () => {
    mockT.mockClear()
    total.value = 1
    entries.value = [makeEntry()]
    mount(AuditLogView)
    expect(mockT).toHaveBeenCalledWith('audit.exportCsv')
  })

  it('F-AV-I18N-03: 搜尋 placeholder 應使用 i18n 而非硬編碼', () => {
    mockT.mockClear()
    mount(AuditLogView)
    expect(mockT).toHaveBeenCalledWith('audit.searchPlaceholder')
  })

  it('F-AV-I18N-04: 分頁按鈕應使用 i18n 而非硬編碼', () => {
    mockT.mockClear()
    total.value = 120
    entries.value = [makeEntry()]
    mount(AuditLogView)
    expect(mockT).toHaveBeenCalledWith('audit.pagination.prev')
    expect(mockT).toHaveBeenCalledWith('audit.pagination.next')
  })

  // -- Date Validation: Reject invalid ranges ----------------------------

  it('F-AV-DATE-01: dateFrom > dateTo 時不應觸發查詢', async () => {
    const wrapper = mount(AuditLogView)
    mockOnDateRangeChange.mockClear()

    // 先設定正常的開始日期（會觸發一次呼叫，合法）
    const dateInputs = wrapper.findAll('.daterange input')
    await dateInputs[0].setValue('2025-08-01')
    // Clear: 這步驟會因 dateTo 仍為空而觸發一次呼叫，這是預期行為
    mockOnDateRangeChange.mockClear()

    // 再設定結束日早於開始日
    await dateInputs[1].setValue('2025-07-01')
    await dateInputs[1].trigger('change')

    // 此時 dateFrom > dateTo，不應觸發 onDateRangeChange
    expect(mockOnDateRangeChange).not.toHaveBeenCalled()
  })

  // -- Export Loading State -----------------------------------------------

  it('F-AV-EXPORT-01: 匯出進行中時按鈕應顯示 disabled/loading 狀態', async () => {
    let resolveExport!: (v: unknown) => void
    mockExportCSV.mockReturnValueOnce(new Promise(r => { resolveExport = r }))

    const wrapper = mount(AuditLogView)
    await wrapper.find('.btn-export').trigger('click')
    await nextTick()

    const btn = wrapper.find('.btn-export')
    // 匯出中應 disabled 或顯示 loading 文字
    const isDisabled = btn.attributes('disabled') !== undefined
    const textChanged = btn.text().trim() !== '匯出 CSV'
    expect(isDisabled || textChanged).toBe(true)

    // 清理
    resolveExport!(undefined)
    await nextTick()
  })

  // -- Accessibility: Interactive elements --------------------------------

  it('F-AV-A11Y-01: 搜尋框應有 aria-label', () => {
    const wrapper = mount(AuditLogView)
    const input = wrapper.find('.search-box input')
    expect(input.attributes('aria-label')).toBeTruthy()
  })

  it('F-AV-A11Y-02: 日期輸入框應有 aria-label（非僅 title）', () => {
    const wrapper = mount(AuditLogView)
    const dateInputs = wrapper.findAll('.daterange input')
    dateInputs.forEach((input) => {
      expect(input.attributes('aria-label')).toBeTruthy()
    })
  })

  it('F-AV-24: 分頁資訊顯示「第 N / M 頁，共 T 筆」', () => {
    total.value = 120
    page.value = 2
    entries.value = [makeEntry()]
    const wrapper = mount(AuditLogView)

    expect(wrapper.find('.page-info').text()).toContain('第 2 / 3 頁，共 120 筆')
  })
})
