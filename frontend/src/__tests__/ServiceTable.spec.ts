import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ServiceTable from '../components/ServiceTable.vue'
import type { Service } from '../types/service'

// Mock i18n — returns what the USER actually sees
const tMap: Record<string, string> = {
  'caption.title': '系統服務列表',
  'caption.sub': '— 點擊操作按鈕管理服務',
  'empty.state': '找不到任何服務，或無法連線至 systemd。',
  'search.empty': '沒有符合「{term}」的服務',
  'action.start': 'Start',
  'action.stop': 'Stop',
  'action.restart': 'Restart',
  'action.start.aria': '啟動 {name}',
  'action.stop.aria': '停止 {name}',
  'action.restart.aria': '重啟 {name}',
  'locked.badge': '🔒 已鎖定',
  'locked.tooltip': '此服務受保護，無法直接操作。',
  'modal.title': '⚠️ 確認操作',
  'modal.cancel': '取消',
  'modal.confirm': '確認',
  'modal.stop': '確定要停止 {name} 嗎？',
  'modal.restart': '確定要重啟 {name} 嗎？',
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

function makeServices(): Service[] {
  return [
    { name: 'nginx.service', load: 'loaded', active: 'active', sub: 'running', locked: false },
    { name: 'myapp.service', load: 'loaded', active: 'inactive', sub: 'dead', locked: false },
    { name: 'sshd.service', load: 'loaded', active: 'active', sub: 'running', locked: true },
    { name: 'crash.service', load: 'loaded', active: 'failed', sub: 'failed', locked: false },
  ]
}

describe('服務列表 — 使用者瀏覽與操作', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('使用者在「我的服務」tab，只看到未鎖定的服務', () => {
    const wrapper = mount(ServiceTable, {
      props: { services: makeServices(), tab: 'my', search: '', loading: false },
    })

    const names = wrapper.findAll('td[data-label="Name"]')
    // sshd is locked, should not appear in "my" tab
    expect(names.length).toBe(3)
    expect(wrapper.text()).toContain('nginx.service')
    expect(wrapper.text()).toContain('myapp.service')
    expect(wrapper.text()).toContain('crash.service')
    expect(wrapper.text()).not.toContain('sshd.service')
  })

  it('使用者在「系統服務」tab，只看到鎖定的服務', () => {
    const wrapper = mount(ServiceTable, {
      props: { services: makeServices(), tab: 'system', search: '', loading: false },
    })

    const names = wrapper.findAll('td[data-label="Name"]')
    expect(names.length).toBe(1)
    expect(names[0].text()).toBe('sshd.service')
  })

  it('沒有服務時，使用者看到「找不到任何服務」', () => {
    const wrapper = mount(ServiceTable, {
      props: { services: [], tab: 'my', search: '', loading: false },
    })

    expect(wrapper.text()).toContain('找不到任何服務')
    expect(wrapper.findAll('td[data-label="Name"]').length).toBe(0)
  })

  it('loading 時，使用者看到 spinner', () => {
    const wrapper = mount(ServiceTable, {
      props: { services: [], tab: 'my', search: '', loading: true },
    })

    expect(wrapper.find('.spinner-sm').exists()).toBe(true)
  })

  it('使用者搜尋 "nginx"，只看到 nginx', () => {
    const wrapper = mount(ServiceTable, {
      props: { services: makeServices(), tab: 'my', search: 'nginx', loading: false },
    })

    const names = wrapper.findAll('td[data-label="Name"]')
    expect(names.length).toBe(1)
    expect(names[0].text()).toBe('nginx.service')
  })

  it('使用者搜尋不存在的服務，看到「沒有符合」提示', () => {
    const wrapper = mount(ServiceTable, {
      props: { services: makeServices(), tab: 'my', search: 'zzznotexist', loading: false },
    })

    expect(wrapper.text()).toContain('沒有符合')
  })

  it('已停止的服務，使用者應看到 Start 按鈕，不應看到 Stop', () => {
    const wrapper = mount(ServiceTable, {
      props: { services: makeServices(), tab: 'my', search: 'myapp', loading: false },
    })

    const actions = wrapper.find('.actions')
    expect(actions.text()).toContain('Start')
    expect(actions.text()).not.toContain('Stop')
  })

  it('執行中的服務，使用者應看到 Stop 和 Restart 按鈕，不應看到 Start', () => {
    const wrapper = mount(ServiceTable, {
      props: { services: makeServices(), tab: 'my', search: 'nginx', loading: false },
    })

    const actions = wrapper.find('.actions')
    expect(actions.text()).toContain('Stop')
    expect(actions.text()).toContain('Restart')
    expect(actions.text()).not.toContain('Start')
  })

  it('鎖定的服務，使用者看到「已鎖定」而非操作按鈕', () => {
    const wrapper = mount(ServiceTable, {
      props: { services: makeServices(), tab: 'system', search: '', loading: false },
    })

    const actions = wrapper.find('.actions')
    expect(actions.text()).toContain('已鎖定')
    expect(actions.find('button').exists()).toBe(false)
  })

  it('點擊服務名稱的排序表頭，可以排序', async () => {
    const wrapper = mount(ServiceTable, {
      props: { services: makeServices(), tab: 'my', search: '', loading: false },
    })

    const nameHeader = wrapper.findAll('th.sortable')[0]
    await nameHeader.trigger('click')

    // After sorting, the order should change
    const names = wrapper.findAll('td[data-label="Name"]')
    // Should be sorted (crash < myapp < nginx alphabetically)
    expect(names[0].text()).toBe('crash.service')
    expect(names[1].text()).toBe('myapp.service')
    expect(names[2].text()).toBe('nginx.service')
  })
})
