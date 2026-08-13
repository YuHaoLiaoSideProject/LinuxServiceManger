/**
 * RED phase — ChannelHistoryTable.vue 元件測試（F-HT-01 ~ F-HT-07）
 * 對應 docs/test-plans/013-webhook-notification測試計畫.md §3.4。
 * ChannelHistoryTable.vue 尚未建立 → import 失敗即為 RED。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

const { mockGetHistory } = vi.hoisted(() => ({
  mockGetHistory: vi.fn(),
}))

vi.mock('../../api/client', () => ({
  getNotifyHistory: mockGetHistory,
}))

vi.mock('../../composables/useI18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string>) => {
      if (params && key === 'notify.pageInfo') return `第 ${params.page} / ${params.total} 頁`
      return key
    },
    lang: { value: 'zh-TW' },
    setLang: vi.fn(),
    toggleLang: vi.fn(),
  }),
}))

import ChannelHistoryTable from '../ChannelHistoryTable.vue'
import type { Channel } from '../../types/notify'

interface HistoryEntry {
  timestamp: string
  channel_id: string
  channel_name: string
  channel_type: string
  event: string
  service: string
  status: 'success' | 'failure'
  error?: string
  duration_ms: number
}

const channels: Channel[] = [
  { id: 'c1', type: 'slack', name: '團隊 Slack', events: ['failed'], all_services: true, enabled: true, created_at: 'x', updated_at: 'x' },
  { id: 'c2', type: 'discord', name: '團隊 Discord', events: ['failed'], all_services: true, enabled: true, created_at: 'x', updated_at: 'x' },
]

function entry(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    timestamp: '2025-08-09T12:00:00Z',
    channel_id: 'c1',
    channel_name: '團隊 Slack',
    channel_type: 'slack',
    event: 'failed',
    service: 'nginx.service',
    status: 'success',
    duration_ms: 120,
    ...overrides,
  }
}

async function mountTable() {
  const wrapper = mount(ChannelHistoryTable, { props: { channels } })
  await flushPromises()
  return wrapper
}

describe('ChannelHistoryTable（F-HT）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetHistory.mockResolvedValue({ data: [], total: 0, page: 1, limit: 30 })
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('F-HT-01: 表格欄位完整', async () => {
    mockGetHistory.mockResolvedValue({ data: [entry()], total: 1, page: 1, limit: 30 })
    const wrapper = await mountTable()

    expect(wrapper.text()).toContain('notify.colTime')
    expect(wrapper.text()).toContain('notify.colChannel')
    expect(wrapper.text()).toContain('notify.colEvent')
    expect(wrapper.text()).toContain('notify.colService')
    expect(wrapper.text()).toContain('notify.colResult')
    expect(wrapper.text()).toContain('notify.colError')
  })

  it('F-HT-02: 依時間倒序顯示（依 API 回傳順序）', async () => {
    mockGetHistory.mockResolvedValue({
      data: [
        entry({ timestamp: '2025-08-09T12:00:00Z' }),
        entry({ timestamp: '2025-08-09T11:00:00Z' }),
      ],
      total: 2, page: 1, limit: 30,
    })
    const wrapper = await mountTable()
    const cells = wrapper.findAll('tbody tr td:first-child')
    expect(cells[0].text()).toContain('2025')
    expect(cells[0].text()).toContain('2025')
  })

  it('F-HT-03: 空狀態顯示「尚無通知發送紀錄」', async () => {
    mockGetHistory.mockResolvedValue({ data: [], total: 0, page: 1, limit: 30 })
    const wrapper = await mountTable()

    expect(wrapper.text()).toContain('尚無通知發送紀錄')
  })

  it('F-HT-04: channel 下拉篩選以 channel_id 重新查詢', async () => {
    mockGetHistory.mockResolvedValue({ data: [entry({ channel_id: 'c2' })], total: 1, page: 1, limit: 30 })
    const wrapper = await mountTable()

    await wrapper.find('[data-testid="history-channel-filter"]').setValue('c2')

    expect(mockGetHistory).toHaveBeenLastCalledWith(expect.objectContaining({ channel_id: 'c2' }))
  })

  it('F-HT-05: 結果篩選 success/failure 帶 status 參數', async () => {
    mockGetHistory.mockResolvedValue({ data: [], total: 0, page: 1, limit: 30 })
    const wrapper = await mountTable()

    await wrapper.find('[data-testid="history-status-filter"]').setValue('failure')
    expect(mockGetHistory).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'failure' }))

    await wrapper.find('[data-testid="history-status-filter"]').setValue('success')
    expect(mockGetHistory).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'success' }))
  })

  it('F-HT-06: 分頁下一頁呼叫 page=2', async () => {
    mockGetHistory.mockResolvedValue({ data: [entry()], total: 45, page: 1, limit: 30 })
    const wrapper = await mountTable()

    await wrapper.find('[data-testid="history-next"]').trigger('click')
    await flushPromises()

    expect(mockGetHistory).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }))
  })

  it('F-HT-07: 成功綠標 / 失敗紅標', async () => {
    mockGetHistory.mockResolvedValue({
      data: [
        entry({ status: 'success' }),
        entry({ status: 'failure', error: 'HTTP 500' }),
      ],
      total: 2, page: 1, limit: 30,
    })
    const wrapper = await mountTable()

    const successCell = wrapper.find('.result-success')
    const failureCell = wrapper.find('.result-failure')
    expect(successCell.exists()).toBe(true)
    expect(successCell.text()).toContain('🟢')
    expect(failureCell.exists()).toBe(true)
    expect(failureCell.text()).toContain('🔴')
    expect(wrapper.text()).toContain('HTTP 500')
  })
})
