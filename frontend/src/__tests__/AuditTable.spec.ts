import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import AuditTable from '../components/AuditTable.vue'
import type { AuditEntry } from '../composables/useAuditLog'

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

  it('F-AT-08: timestamp 格式化為 YYYY-MM-DD HH:mm:ss', () => {
    const wrapper = mount(AuditTable, {
      props: { entries: [makeEntry({ timestamp: '2025-08-09T14:30:00Z' })] },
    })

    const td = wrapper.find('tbody tr td')
    expect(td.text()).toBe('2025-08-09 14:30:00')
  })

  it('F-AT-09: timestamp 含毫秒 → 去除毫秒部分', () => {
    const wrapper = mount(AuditTable, {
      props: { entries: [makeEntry({ timestamp: '2025-08-09T14:30:00.123Z' })] },
    })

    const td = wrapper.find('tbody tr td')
    expect(td.text()).toBe('2025-08-09 14:30:00')
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
    expect(tds[0].text()).toBe('2025-08-09 14:30:00')
    expect(tds[1].text()).toBe('operator')
    expect(tds[2].text()).toBe('10.0.0.1')
    expect(tds[3].text()).toBe('重啟')
    expect(tds[4].text()).toBe('ssh.service')
    expect(tds[5].text()).toBe('失敗')
    expect(tds[6].text()).toBe('permission denied')
  })
})
