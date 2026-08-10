/**
 * RED phase — BatchToolbar.vue 元件測試
 *
 * 測試批次操作工具列的 props、emits、顯示邏輯。
 * 元件尚未建立，因此 import 會失敗 → 整個 test file 為 RED。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import BatchToolbar from '../BatchToolbar.vue'

// Mock i18n — 使用與現有測試一致的模式
vi.mock('../../composables/useI18n', () => ({
  useI18n: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'action.start': 'Start',
        'action.stop': 'Stop',
        'action.restart': 'Restart',
      }
      return map[key] || key
    },
    lang: { value: 'zh-TW' },
    setLang: vi.fn(),
    toggleLang: vi.fn(),
  }),
}))

describe('BatchToolbar — 批次操作工具列', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  // ── Props 測試 ──

  it('當 selectedCount > 0 時顯示「已選取 N 個服務」', () => {
    const wrapper = mount(BatchToolbar, {
      props: { selectedCount: 3, executing: false, progress: null },
    })
    expect(wrapper.text()).toContain('已選取')
    expect(wrapper.text()).toContain('3')
    expect(wrapper.find('.batch-count').exists()).toBe(true)
  })

  it('應有 Start / Stop / Restart 三個操作按鈕', () => {
    const wrapper = mount(BatchToolbar, {
      props: { selectedCount: 2, executing: false, progress: null },
    })
    const buttons = wrapper.findAll('button:not(.btn-clear-link)')
    const buttonTexts = buttons.map(b => b.text())
    expect(buttonTexts.some(t => t.includes('Start'))).toBe(true)
    expect(buttonTexts.some(t => t.includes('Stop'))).toBe(true)
    expect(buttonTexts.some(t => t.includes('Restart'))).toBe(true)
  })

  it('executing=true 時不應顯示操作按鈕', () => {
    const wrapper = mount(BatchToolbar, {
      props: {
        selectedCount: 2,
        executing: true,
        progress: { done: 3, total: 5 },
      },
    })
    // 執行中不應顯示操作按鈕
    const actionButtons = wrapper.findAll('.btn-start, .btn-stop, .btn-restart')
    expect(actionButtons.length).toBe(0)
  })

  it('executing=true 且有 progress 時顯示「正在執行... 3/5」', () => {
    const wrapper = mount(BatchToolbar, {
      props: {
        selectedCount: 5,
        executing: true,
        progress: { done: 3, total: 5 },
      },
    })
    expect(wrapper.find('.batch-progress').exists()).toBe(true)
    expect(wrapper.find('.batch-progress').text()).toContain('3/5')
  })

  // ── Emits 測試 ──

  it('點擊 Start 按鈕應 emit batch-action "start"', async () => {
    const wrapper = mount(BatchToolbar, {
      props: { selectedCount: 2, executing: false, progress: null },
    })
    const startBtn = wrapper.find('.btn-start')
    expect(startBtn.exists()).toBe(true)
    await startBtn.trigger('click')
    expect(wrapper.emitted('batch-action')).toBeTruthy()
    expect(wrapper.emitted('batch-action')![0]).toEqual(['start'])
  })

  it('點擊 Stop 按鈕應 emit batch-action "stop"', async () => {
    const wrapper = mount(BatchToolbar, {
      props: { selectedCount: 2, executing: false, progress: null },
    })
    const stopBtn = wrapper.find('.btn-stop')
    expect(stopBtn.exists()).toBe(true)
    await stopBtn.trigger('click')
    expect(wrapper.emitted('batch-action')![0]).toEqual(['stop'])
  })

  it('點擊 Restart 按鈕應 emit batch-action "restart"', async () => {
    const wrapper = mount(BatchToolbar, {
      props: { selectedCount: 2, executing: false, progress: null },
    })
    const restartBtn = wrapper.find('.btn-restart')
    expect(restartBtn.exists()).toBe(true)
    await restartBtn.trigger('click')
    expect(wrapper.emitted('batch-action')![0]).toEqual(['restart'])
  })

  it('點擊「取消選取」連結應 emit clear-selection', async () => {
    const wrapper = mount(BatchToolbar, {
      props: { selectedCount: 2, executing: false, progress: null },
    })
    const clearLink = wrapper.find('.btn-clear-link')
    expect(clearLink.exists()).toBe(true)
    await clearLink.trigger('click')
    expect(wrapper.emitted('clear-selection')).toBeTruthy()
    expect(wrapper.emitted('clear-selection')!.length).toBe(1)
  })

  // ── Props 邊界測試 ──

  it('selectedCount=1 應顯示「已選取 1 個服務」', () => {
    const wrapper = mount(BatchToolbar, {
      props: { selectedCount: 1, executing: false, progress: null },
    })
    expect(wrapper.text()).toContain('已選取')
    expect(wrapper.text()).toContain('1')
  })

  it('executing=false 時不應有 .batch-executing class', () => {
    const wrapper = mount(BatchToolbar, {
      props: { selectedCount: 2, executing: false, progress: null },
    })
    expect(wrapper.classes()).not.toContain('batch-executing')
  })

  it('executing=true 時應有 .batch-executing class', () => {
    const wrapper = mount(BatchToolbar, {
      props: { selectedCount: 2, executing: true, progress: null },
    })
    expect(wrapper.classes()).toContain('batch-executing')
  })
})
