import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ServiceTable from '../components/ServiceTable.vue'
import type { Service } from '../types/service'

// Mock i18n — 雙語系 tMap，依據 lang.value 動態切換
import { ref } from 'vue'

const mockLang = ref<'zh-TW' | 'en'>('zh-TW')

const tMapZH: Record<string, string> = {
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
  'col.name': '名稱',
  'col.load': '載入狀態',
  'col.active': '啟用狀態',
  'col.sub': '執行狀態',
  'col.autoStart': '開機啟動',
  'col.actions': '操作',
}

const tMapEN: Record<string, string> = {
  'caption.title': 'Service List',
  'caption.sub': '— Click action buttons to manage services',
  'empty.state': 'No services found or unable to connect to systemd.',
  'search.empty': 'No services matching "{term}"',
  'action.start': 'Start',
  'action.stop': 'Stop',
  'action.restart': 'Restart',
  'action.start.aria': 'Start {name}',
  'action.stop.aria': 'Stop {name}',
  'action.restart.aria': 'Restart {name}',
  'locked.badge': '🔒 Locked',
  'locked.tooltip': 'This service is protected. Set the UNLOCKED_SERVICES environment variable to unlock.',
  'modal.title': '⚠️ Confirm Action',
  'modal.cancel': 'Cancel',
  'modal.confirm': 'Confirm',
  'modal.stop': 'Are you sure you want to stop {name}?',
  'modal.restart': 'Are you sure you want to restart {name}?',
  'col.name': 'Name',
  'col.load': 'Load',
  'col.active': 'Active',
  'col.sub': 'Sub',
  'col.autoStart': 'Auto-start',
  'col.actions': 'Actions',
}

vi.mock('../composables/useI18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string>) => {
      const map = mockLang.value === 'zh-TW' ? tMapZH : tMapEN
      let text = map[key] || key
      if (params) {
        Object.entries(params).forEach(([k, v]) => {
          text = text.replace(`{${k}}`, v)
        })
      }
      return text
    },
    lang: mockLang,
    setLang: (l: 'zh-TW' | 'en') => { mockLang.value = l },
    toggleLang: vi.fn(),
  }),
}))

function makeServices(): Service[] {
  return [
    { name: 'nginx.service', load: 'loaded', active: 'active', sub: 'running', locked: false, unitFileState: 'enabled', fragmentPath: '/etc/systemd/system/nginx.service' },
    { name: 'myapp.service', load: 'loaded', active: 'inactive', sub: 'dead', locked: false, unitFileState: 'disabled', fragmentPath: '/etc/systemd/system/myapp.service' },
    { name: 'sshd.service', load: 'loaded', active: 'active', sub: 'running', locked: true, unitFileState: 'enabled', fragmentPath: '/lib/systemd/system/sshd.service' },
    { name: 'crash.service', load: 'loaded', active: 'failed', sub: 'failed', locked: false, unitFileState: 'enabled', fragmentPath: '/etc/systemd/system/crash.service' },
  ]
}

describe('服務列表 — 使用者瀏覽與操作', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    mockLang.value = 'zh-TW' // 每個測試前重置為繁體中文
  })

  it('表格欄位標頭應顯示六個欄位（繁體中文）', () => {
    const wrapper = mount(ServiceTable, {
      props: { services: makeServices(), tab: 'my', search: '', loading: false },
    })

    const headers = wrapper.findAll('th')
    expect(headers.length).toBe(6)
    expect(headers[0].text()).toContain('名稱')
    expect(headers[1].text()).toContain('載入狀態')
    expect(headers[2].text()).toContain('啟用狀態')
    expect(headers[3].text()).toContain('執行狀態')
    expect(headers[4].text()).toContain('開機啟動')
    expect(headers[5].text()).toContain('操作')
  })

  it('使用者在「我的服務」tab，只看到未鎖定的服務', () => {
    const wrapper = mount(ServiceTable, {
      props: { services: makeServices(), tab: 'my', search: '', loading: false },
    })

    const names = wrapper.findAll('td[data-label="名稱"]')
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

    const names = wrapper.findAll('td[data-label="名稱"]')
    expect(names.length).toBe(1)
    expect(names[0].text()).toBe('sshd.service')
  })

  it('沒有服務時，使用者看到「找不到任何服務」', () => {
    const wrapper = mount(ServiceTable, {
      props: { services: [], tab: 'my', search: '', loading: false },
    })

    expect(wrapper.text()).toContain('找不到任何服務')
    expect(wrapper.findAll('td[data-label="名稱"]').length).toBe(0)
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

    const names = wrapper.findAll('td[data-label="名稱"]')
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
    const names = wrapper.findAll('td[data-label="名稱"]')
    // Should be sorted (crash < myapp < nginx alphabetically)
    expect(names[0].text()).toBe('crash.service')
    expect(names[1].text()).toBe('myapp.service')
    expect(names[2].text()).toBe('nginx.service')
  })

  it('切換語系為英文後，欄位標頭應變成英文', () => {
    // 先掛載 zh-TW
    const wrapper = mount(ServiceTable, {
      props: { services: makeServices(), tab: 'my', search: '', loading: false },
    })

    let headers = wrapper.findAll('th')
    expect(headers[0].text()).toContain('名稱')
    expect(headers[4].text()).toContain('開機啟動')
    expect(headers[5].text()).toContain('操作')

    // 切到英文，需要重新掛載（因為 t() 是在 setup 裡呼叫的）
    mockLang.value = 'en'
    const wrapperEn = mount(ServiceTable, {
      props: { services: makeServices(), tab: 'my', search: '', loading: false },
    })

    headers = wrapperEn.findAll('th')
    expect(headers[0].text()).toContain('Name')
    expect(headers[1].text()).toContain('Load')
    expect(headers[2].text()).toContain('Active')
    expect(headers[3].text()).toContain('Sub')
    expect(headers[4].text()).toContain('Auto-start')
    expect(headers[5].text()).toContain('Actions')
  })

  it('從英文切回繁體中文，欄位標頭應恢復中文', () => {
    mockLang.value = 'en'
    const wrapperEn = mount(ServiceTable, {
      props: { services: makeServices(), tab: 'my', search: '', loading: false },
    })

    expect(wrapperEn.findAll('th')[0].text()).toContain('Name')

    mockLang.value = 'zh-TW'
    const wrapperZH = mount(ServiceTable, {
      props: { services: makeServices(), tab: 'my', search: '', loading: false },
    })

    const headers = wrapperZH.findAll('th')
    expect(headers[0].text()).toContain('名稱')
    expect(headers[4].text()).toContain('開機啟動')
    expect(headers[5].text()).toContain('操作')
  })

  it('RWD 手機版：切換語系後 data-label 也跟著變', () => {
    // zh-TW
    mockLang.value = 'zh-TW'
    const wrapperZH = mount(ServiceTable, {
      props: { services: makeServices(), tab: 'my', search: '', loading: false },
    })
    expect(wrapperZH.find('td[data-label="名稱"]').exists()).toBe(true)
    expect(wrapperZH.find('td[data-label="載入狀態"]').exists()).toBe(true)

    // en
    mockLang.value = 'en'
    const wrapperEN = mount(ServiceTable, {
      props: { services: makeServices(), tab: 'my', search: '', loading: false },
    })
    expect(wrapperEN.find('td[data-label="Name"]').exists()).toBe(true)
    expect(wrapperEN.find('td[data-label="Load"]').exists()).toBe(true)
    expect(wrapperEN.find('td[data-label="Active"]').exists()).toBe(true)
    expect(wrapperEN.find('td[data-label="Sub"]').exists()).toBe(true)
    expect(wrapperEN.find('td[data-label="Auto-start"]').exists()).toBe(true)
    expect(wrapperEN.find('td[data-label="Actions"]').exists()).toBe(true)
  })
})
