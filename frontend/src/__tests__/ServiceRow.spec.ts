import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ServiceRow from '../components/ServiceRow.vue'
import type { Service } from '../types/service'

// Mock i18n
const tMap: Record<string, string> = {
  'action.start': 'Start',
  'action.stop': 'Stop',
  'action.restart': 'Restart',
  'locked.badge': '🔒 已鎖定',
  'locked.tooltip': '此服務受保護，無法直接操作。',
  'action.start.aria': '啟動 {name}',
  'action.stop.aria': '停止 {name}',
  'action.restart.aria': '重啟 {name}',
}

vi.mock('../composables/useI18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string>) => {
      let text = tMap[key] || key
      if (params) {
        Object.entries(params).forEach(([k, v]) => {
          text = text.replace(`{${k}}`, v)
        })
      }
      return text
    },
    lang: { value: 'zh-TW' },
    setLang: vi.fn(),
    toggleLang: vi.fn(),
  }),
}))

function makeService(overrides: Partial<Service> = {}): Service {
  return {
    name: 'nginx.service',
    load: 'loaded',
    active: 'active',
    sub: 'running',
    locked: false,
    ...overrides,
  }
}

describe('ServiceRow — 服務列表列', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  // --- 按鈕可見性 ---

  it('inactive → 顯示 Start + Restart，不顯示 Stop', () => {
    const service = makeService({ active: 'inactive', sub: 'dead' })
    const wrapper = mount(ServiceRow, { props: { service } })

    const actions = wrapper.find('.actions')
    expect(actions.text()).toContain('Start')
    expect(actions.text()).toContain('Restart')
    expect(actions.text()).not.toContain('Stop')
  })

  it('active → 顯示 Stop + Restart，不顯示 Start', () => {
    const service = makeService({ active: 'active', sub: 'running' })
    const wrapper = mount(ServiceRow, { props: { service } })

    const actions = wrapper.find('.actions')
    expect(actions.text()).toContain('Stop')
    expect(actions.text()).toContain('Restart')
    expect(actions.text()).not.toContain('Start')
  })

  it('failed → 顯示 Start + Restart，不顯示 Stop', () => {
    const service = makeService({ active: 'failed', sub: 'failed' })
    const wrapper = mount(ServiceRow, { props: { service } })

    const actions = wrapper.find('.actions')
    expect(actions.text()).toContain('Start')
    expect(actions.text()).toContain('Restart')
    expect(actions.text()).not.toContain('Stop')
  })

  it('locked=true → 顯示 🔒 鎖定圖示，無按鈕', () => {
    const service = makeService({ locked: true })
    const wrapper = mount(ServiceRow, { props: { service } })

    const actions = wrapper.find('.actions')
    expect(actions.text()).toContain('🔒 已鎖定')
    expect(actions.find('button').exists()).toBe(false)
  })

  // --- 確認對話框行為 ---

  it('點擊 Start 直接 emit action (start)', async () => {
    const service = makeService({ active: 'inactive', sub: 'dead' })
    const wrapper = mount(ServiceRow, { props: { service } })

    // Find the Start button
    const startBtn = wrapper.find('button')
    expect(startBtn.text()).toContain('Start')

    await startBtn.trigger('click')

    const emitted = wrapper.emitted('action')
    expect(emitted).toBeTruthy()
    expect(emitted![0]).toEqual(['start', 'nginx.service'])
  })

  it('點擊 Stop emit action (stop)', async () => {
    const service = makeService({ active: 'active', sub: 'running' })
    const wrapper = mount(ServiceRow, { props: { service } })

    // Find the Stop button - it's the first button in active state
    const buttons = wrapper.findAll('button')
    const stopBtn = buttons.find(b => b.text().includes('Stop'))
    expect(stopBtn).toBeDefined()

    await stopBtn!.trigger('click')

    const emitted = wrapper.emitted('action')
    expect(emitted).toBeTruthy()
    expect(emitted![0]).toEqual(['stop', 'nginx.service'])
  })

  it('點擊 Restart emit action (restart)', async () => {
    const service = makeService({ active: 'active', sub: 'running' })
    const wrapper = mount(ServiceRow, { props: { service } })

    const buttons = wrapper.findAll('button')
    const restartBtn = buttons.find(b => b.text().includes('Restart'))
    expect(restartBtn).toBeDefined()

    await restartBtn!.trigger('click')

    const emitted = wrapper.emitted('action')
    expect(emitted).toBeTruthy()
    expect(emitted![0]).toEqual(['restart', 'nginx.service'])
  })

  // --- 特殊字元服務名稱 ---

  it('特殊字元服務名稱正確顯示 @', () => {
    const service = makeService({ name: 'myapp@.service' })
    const wrapper = mount(ServiceRow, { props: { service } })

    expect(wrapper.find('td[data-label="Name"]').text()).toBe('myapp@.service')
  })

  it('特殊字元服務名稱正確顯示 -', () => {
    const service = makeService({ name: 'my-app.service' })
    const wrapper = mount(ServiceRow, { props: { service } })

    expect(wrapper.find('td[data-label="Name"]').text()).toBe('my-app.service')
  })

  // --- 狀態 class ---

  it('active 狀態使用 status-active class', () => {
    const service = makeService({ active: 'active' })
    const wrapper = mount(ServiceRow, { props: { service } })

    expect(wrapper.find('.status-active').exists()).toBe(true)
    expect(wrapper.find('.dot-active').exists()).toBe(true)
  })

  it('inactive 狀態使用 status-inactive class', () => {
    const service = makeService({ active: 'inactive' })
    const wrapper = mount(ServiceRow, { props: { service } })

    expect(wrapper.find('.status-inactive').exists()).toBe(true)
    expect(wrapper.find('.dot-inactive').exists()).toBe(true)
  })

  it('failed 狀態使用 status-failed class', () => {
    const service = makeService({ active: 'failed' })
    const wrapper = mount(ServiceRow, { props: { service } })

    expect(wrapper.find('.status-failed').exists()).toBe(true)
    expect(wrapper.find('.dot-failed').exists()).toBe(true)
  })
})
