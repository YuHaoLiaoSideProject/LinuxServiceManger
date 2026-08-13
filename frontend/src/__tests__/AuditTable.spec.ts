import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref } from 'vue'
import AuditTable from '../components/AuditTable.vue'
import type { AuditEntry } from '../composables/useAuditLog'

// 固定時區為 UTC+8，使「UTC → 本地時區」轉換測試具確定性（不依賴 CI 機器時區）
process.env.TZ = 'Asia/Taipei'

// ---------------------------------------------------------------------------
// Mock i18n — return Chinese translations (match existing test expectations)
// ---------------------------------------------------------------------------

const { mockT } = vi.hoisted(() => ({
  mockT: vi.fn((key: string) => {
    const map: Record<string, string> = {
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
      'audit.noRecords': '尚無操作紀錄',
    }
    return map[key] || key
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
// Fixtures
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

describe('AuditTable — 稽核紀錄表格', () => {

  // -- Empty State --------------------------------------------------------

  it('F-AT-01: entries 為空 → 顯示 EmptyState', () => {
    const wrapper = mount(AuditTable, {
      props: { entries: [] },
    })

    expect(wrapper.findComponent({ name: 'EmptyState' }).exists()).toBe(true)
    expect(wrapper.find('table').exists()).toBe(false)
  })

  // -- Table Rendering ----------------------------------------------------

  it('F-AT-02: 有 entries → 渲染 table + 7 個欄位標頭', () => {
    const wrapper = mount(AuditTable, {
      props: { entries: [makeEntry()] },
    })

    expect(wrapper.find('table').exists()).toBe(true)
    const headers = wrapper.findAll('th')
    expect(headers).toHaveLength(7)
    expect(headers[0].text()).toBe('時間')
    expect(headers[1].text()).toBe('使用者')
    expect(headers[2].text()).toBe('來源 IP')
    expect(headers[3].text()).toBe('動作')
    expect(headers[4].text()).toBe('目標服務')
    expect(headers[5].text()).toBe('結果')
    expect(headers[6].text()).toBe('詳細資訊')
  })

  it('F-AT-03: 多筆 entries → 渲染對應數量的 tr', () => {
    const wrapper = mount(AuditTable, {
      props: { entries: [makeEntry(), makeEntry(), makeEntry()] },
    })

    // 3 data rows + 1 header row = 4 rows (our template doesn't include header in tbody)
    const rows = wrapper.findAll('tbody tr')
    expect(rows).toHaveLength(3)
  })

  // -- Row Classes (Success / Failure) -----------------------------------

  it('F-AT-04: result=success → row-success class', () => {
    const wrapper = mount(AuditTable, {
      props: { entries: [makeEntry({ result: 'success' })] },
    })

    const row = wrapper.find('tbody tr')
    expect(row.classes()).toContain('row-success')
    expect(row.classes()).not.toContain('row-failure')
  })

  it('F-AT-05: result=failure → row-failure class', () => {
    const wrapper = mount(AuditTable, {
      props: { entries: [makeEntry({ result: 'failure' })] },
    })

    const row = wrapper.find('tbody tr')
    expect(row.classes()).toContain('row-failure')
    expect(row.classes()).not.toContain('row-success')
  })

  // -- Badge (Result indicator) ---------------------------------------

  it('F-AT-06: result=success → badge-success + 文字「成功」', () => {
    const wrapper = mount(AuditTable, {
      props: { entries: [makeEntry({ result: 'success' })] },
    })

    const badge = wrapper.find('.badge')
    expect(badge.exists()).toBe(true)
    expect(badge.classes()).toContain('badge-success')
    expect(badge.classes()).not.toContain('badge-failure')
    expect(badge.text()).toBe('成功')
  })

  it('F-AT-07: result=failure → badge-failure + 文字「失敗」', () => {
    const wrapper = mount(AuditTable, {
      props: { entries: [makeEntry({ result: 'failure' })] },
    })

    const badge = wrapper.find('.badge')
    expect(badge.exists()).toBe(true)
    expect(badge.classes()).toContain('badge-failure')
    expect(badge.classes()).not.toContain('badge-success')
    expect(badge.text()).toBe('失敗')
  })

  // -- Time Formatting ----------------------------------------------------

  it('F-AT-08: timestamp 依本地時區格式化為 YYYY-MM-DD HH:mm:ss', () => {
    const wrapper = mount(AuditTable, {
      props: { entries: [makeEntry({ timestamp: '2025-08-09T14:30:00Z' })] },
    })

    const td = wrapper.find('tbody tr td')
    // 14:30 UTC → 22:30 Asia/Taipei（UTC+8）
    expect(td.text()).toBe('2025-08-09 22:30:00')
  })

  it('F-AT-09: timestamp 含毫秒 → 去除毫秒並轉換時區', () => {
    const wrapper = mount(AuditTable, {
      props: { entries: [makeEntry({ timestamp: '2025-08-09T14:30:00.123Z' })] },
    })

    const td = wrapper.find('tbody tr td')
    expect(td.text()).toBe('2025-08-09 22:30:00')
  })

  it('F-AT-10: timestamp 為空 → 顯示 "-"', () => {
    const wrapper = mount(AuditTable, {
      props: { entries: [makeEntry({ timestamp: '' })] },
    })

    const td = wrapper.find('tbody tr td')
    expect(td.text()).toBe('-')
  })

  // -- Action Labels (Chinese mapping) -----------------------------------

  it.each([
    ['login', '登入'],
    ['logout', '登出'],
    ['start', '啟動'],
    ['stop', '停止'],
    ['restart', '重啟'],
    ['enable', '啟用'],
    ['disable', '停用'],
  ])('F-AT-ACT: action=%s → 顯示「%s」', (action, expected) => {
    const wrapper = mount(AuditTable, {
      props: { entries: [makeEntry({ action })] },
    })

    const tds = wrapper.findAll('tbody tr td')
    expect(tds[3].text()).toBe(expected) // 4th column = 動作
  })

  it('F-AT-ACT-UNK: 未知 action → 直接顯示原始值', () => {
    const wrapper = mount(AuditTable, {
      props: { entries: [makeEntry({ action: 'unknown_action' } as any)] },
    })

    const tds = wrapper.findAll('tbody tr td')
    expect(tds[3].text()).toBe('unknown_action')
  })

  // -- Target Display -----------------------------------------------------

  it('F-AT-TGT-01: target 有值 → 顯示原始值', () => {
    const wrapper = mount(AuditTable, {
      props: { entries: [makeEntry({ target: 'nginx.service' })] },
    })

    const tds = wrapper.findAll('tbody tr td')
    expect(tds[4].text()).toBe('nginx.service')
  })

  it('F-AT-TGT-02: target 為空字串 → 顯示 "-"', () => {
    const wrapper = mount(AuditTable, {
      props: { entries: [makeEntry({ target: '' })] },
    })

    const tds = wrapper.findAll('tbody tr td')
    expect(tds[4].text()).toBe('-')
  })

  it('F-AT-TGT-03: target 為 "-" → 顯示 "-"', () => {
    const wrapper = mount(AuditTable, {
      props: { entries: [makeEntry({ target: '-' })] },
    })

    const tds = wrapper.findAll('tbody tr td')
    expect(tds[4].text()).toBe('-')
  })

  // -- Detail Display -----------------------------------------------------

  it('F-AT-DTL-01: detail 有值 → 顯示 detail 內容', () => {
    const wrapper = mount(AuditTable, {
      props: { entries: [makeEntry({ detail: 'unit not found' })] },
    })

    const tds = wrapper.findAll('tbody tr td')
    expect(tds[6].text()).toBe('unit not found')
  })

  it('F-AT-DTL-02: detail 為空 → 顯示 "-"', () => {
    const wrapper = mount(AuditTable, {
      props: { entries: [makeEntry({ detail: '' })] },
    })

    const tds = wrapper.findAll('tbody tr td')
    expect(tds[6].text()).toBe('-')
  })

  // -- Data Rendering -----------------------------------------------------

  it('F-AT-DATA-01: 所有欄位正確渲染', () => {
    const wrapper = mount(AuditTable, {
      props: {
        entries: [
          makeEntry({
            timestamp: '2025-08-09T14:30:00Z',
            username: 'operator',
            source_ip: '10.0.0.1',
            action: 'restart',
            target: 'ssh.service',
            result: 'failure',
            detail: 'permission denied',
          }),
        ],
      },
    })

    const tds = wrapper.findAll('tbody tr td')
    expect(tds[0].text()).toBe('2025-08-09 22:30:00')
    expect(tds[1].text()).toBe('operator')
    expect(tds[2].text()).toBe('10.0.0.1')
    expect(tds[3].text()).toBe('重啟')
    expect(tds[4].text()).toBe('ssh.service')
    expect(tds[5].text()).toBe('失敗')
    expect(tds[6].text()).toBe('permission denied')
  })

  // -- RWD: Mobile data-label attributes ----------------------------------

  it('F-AT-RWD-01: 每個 <td> 必須有 data-label 屬性（行動版卡片佈局）', () => {
    const wrapper = mount(AuditTable, {
      props: { entries: [makeEntry()] },
    })

    const tds = wrapper.findAll('tbody td')
    expect(tds.length).toBeGreaterThan(0)

    tds.forEach((td, i) => {
      const label = td.attributes('data-label')
      expect(label, `td[${i}] 缺少 data-label 屬性`).toBeDefined()
      expect(label?.trim(), `td[${i}] data-label 為空字串`).not.toBe('')
    })
  })

  // -- Empty State: Context-appropriate text ------------------------------

  it('F-AT-EMPTY-02: entries 為空時不應顯示「服務」相關文字', () => {
    const wrapper = mount(AuditTable, {
      props: { entries: [] },
    })

    // EmptyState 組件目前寫死「沒有符合條件的服務」，對稽核頁面不適用
    expect(wrapper.text()).not.toContain('服務')
  })

  // -- i18n: Column headers should not be hardcoded ----------------------

  it('F-AT-I18N-01: 欄位標頭應使用 useI18n 的 t() 而非硬編碼中文', () => {
    mockT.mockClear()
    mount(AuditTable, {
      props: { entries: [makeEntry()] },
    })

    // t() should have been called for each column header (7 calls minimum)
    expect(mockT).toHaveBeenCalled()
    const headerKeys = [
      'audit.col.time',
      'audit.col.user',
      'audit.col.sourceIp',
      'audit.col.action',
      'audit.col.target',
      'audit.col.result',
      'audit.col.detail',
    ]
    headerKeys.forEach(key => {
      expect(mockT).toHaveBeenCalledWith(key)
    })
  })

  // -- Accessibility: Table semantics ------------------------------------

  it('F-AT-A11Y-01: 表格應有 caption 或 aria-label 輔助描述', () => {
    const wrapper = mount(AuditTable, {
      props: { entries: [makeEntry()] },
    })

    const table = wrapper.find('table')
    const hasCaption = table.find('caption').exists()
    const hasAriaLabel = table.attributes('aria-label') !== undefined

    expect(hasCaption || hasAriaLabel).toBe(true)
  })

  it('F-AT-A11Y-02: 結果 badge 應有 aria 標記供螢幕閱讀器辨識', () => {
    const wrapper = mount(AuditTable, {
      props: { entries: [makeEntry({ result: 'success' }), makeEntry({ result: 'failure' })] },
    })

    const badges = wrapper.findAll('.badge')
    expect(badges).toHaveLength(2)

    badges.forEach((badge) => {
      // badge 應有 role="status" 或 aria-label
      const role = badge.attributes('role')
      const ariaLabel = badge.attributes('aria-label')
      expect(role || ariaLabel, 'badge 缺少 role 或 aria-label').toBeTruthy()
    })
  })
})
