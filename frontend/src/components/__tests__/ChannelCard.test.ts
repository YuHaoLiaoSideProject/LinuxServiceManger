/**
 * RED phase — ChannelCard.vue 元件測試（F-TG / F-DL / F-TS）
 * 對應 docs/test-plans/013-webhook-notification測試計畫.md §3.3。
 * ChannelCard.vue 尚未建立 → import 失敗即為 RED。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

const { mockToggle, mockTest, mockRemove } = vi.hoisted(() => ({
  mockToggle: vi.fn(),
  mockTest: vi.fn(),
  mockRemove: vi.fn(),
}))

vi.mock('../../composables/useNotifyChannels', () => ({
  useNotifyChannels: () => ({
    toggleEnabled: mockToggle,
    testChannel: mockTest,
    removeChannel: mockRemove,
  }),
}))

vi.mock('../../composables/useI18n', () => ({
  useI18n: () => ({
    t: (key: string) => key,
    lang: { value: 'zh-TW' },
    setLang: vi.fn(),
    toggleLang: vi.fn(),
  }),
}))

import ChannelCard from '../ChannelCard.vue'
import type { Channel } from '../../types/notify'

function makeChannel(overrides: Partial<Channel> = {}): Channel {
  return {
    id: 'c1',
    type: 'slack',
    name: '團隊 Slack',
    url: 'https://hooks.slack.com/services/x',
    events: ['failed'],
    all_services: true,
    enabled: true,
    created_at: 'x',
    updated_at: 'x',
    ...overrides,
  }
}

function mountCard(channel: Channel) {
  return mount(ChannelCard, { props: { channel } })
}

describe('ChannelCard — toggle（F-TG）', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => { document.body.innerHTML = '' })

  it('F-TG-01: 點擊 toggle 呼叫 toggleEnabled（樂觀更新由 composable 負責）', async () => {
    mockToggle.mockResolvedValue(undefined)
    const wrapper = mountCard(makeChannel({ enabled: true }))

    await wrapper.find('[data-testid="channel-toggle"]').setValue(false)

    expect(mockToggle).toHaveBeenCalled()
  })

  it('F-TG-04: 停用卡片套用灰顯樣式', () => {
    const wrapper = mountCard(makeChannel({ enabled: false }))
    expect(wrapper.find('.channel-card').classes()).toContain('channel-disabled')
  })

  it('F-TG-04: 啟用卡片無灰顯樣式', () => {
    const wrapper = mountCard(makeChannel({ enabled: true }))
    expect(wrapper.find('.channel-card').classes()).not.toContain('channel-disabled')
  })
})

describe('ChannelCard — 刪除確認（F-DL）', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => { document.body.innerHTML = '' })

  it('F-DL-01: 點擊刪除彈出確認框（含 channel 名稱）', async () => {
    const wrapper = mountCard(makeChannel({ name: '團隊 Slack' }))
    await wrapper.find('button.btn-danger').trigger('click')

    const modal = document.body.querySelector('.lms-modal')
    expect(modal).toBeTruthy()
    expect(modal!.textContent).toContain('確定刪除 Channel「團隊 Slack」')
    expect(modal!.textContent).toContain('確認刪除')
  })

  it('F-DL-02: 確認刪除 emit delete 事件', async () => {
    const wrapper = mountCard(makeChannel())
    await wrapper.find('button.btn-danger').trigger('click')

    const confirmBtn = document.body.querySelector('.btn-danger') as HTMLButtonElement
    confirmBtn.click()
    await flushPromises()

    const emitted = wrapper.emitted('delete')
    expect(emitted).toBeTruthy()
    expect(emitted![0][0]).toBe('c1')
  })

  it('F-DL-03: 取消刪除不 emit delete', async () => {
    const wrapper = mountCard(makeChannel())
    await wrapper.find('button.btn-danger').trigger('click')

    const cancelBtn = document.body.querySelector('.lms-modal button:not(.btn-danger)') as HTMLButtonElement
    cancelBtn.click()

    expect(wrapper.emitted('delete')).toBeFalsy()
  })
})

describe('ChannelCard — 測試按鈕（F-TS）', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => { document.body.innerHTML = '' })

  it('F-TS-01: 點擊測試呼叫 testChannel 並顯示 loading', async () => {
    let resolve!: (v: unknown) => void
    mockTest.mockReturnValue(new Promise(r => { resolve = r }))

    const wrapper = mountCard(makeChannel())
    await wrapper.find('[data-testid="channel-test"]').trigger('click')

    expect(mockTest).toHaveBeenCalled()
    const btn = wrapper.find('[data-testid="channel-test"]')
    expect((btn.element as HTMLButtonElement).disabled).toBe(true)

    resolve({ success: true })
    await flushPromises()
    expect((btn.element as HTMLButtonElement).disabled).toBe(false)
  })

  it('F-TS-01: 測試完成恢復可點擊', async () => {
    mockTest.mockResolvedValue({ success: true })
    const wrapper = mountCard(makeChannel())
    await wrapper.find('[data-testid="channel-test"]').trigger('click')
    await flushPromises()

    const btn = wrapper.find('[data-testid="channel-test"]')
    expect((btn.element as HTMLButtonElement).disabled).toBe(false)
  })
})
