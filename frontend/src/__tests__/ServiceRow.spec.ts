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
  'status.load.loaded': '已載入',
  'status.load.not-found': '未找到',
  'status.load.error': '錯誤',
  'status.load.masked': '已遮蔽',
  'status.active.active': '啟用中',
  'status.active.inactive': '未啟用',
  'status.active.failed': '失敗',
  'status.active.activating': '啟用中',
  'status.sub.running': '執行中',
  'status.sub.dead': '已停止',
  'status.sub.exited': '已退出',
  'status.sub.failed': '失敗',
  'status.sub.auto-restart': '自動重啟',
  'autoStart.na': '不適用',
  'autoStart.on': 'ON',
  'autoStart.off': 'OFF',
  'autoStart.enableAria': '開啟 {name} 的自動啟動',
  'autoStart.disableAria': '關閉 {name} 的自動啟動',
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
    unitFileState: 'enabled',
    fragmentPath: '/etc/systemd/system/nginx.service',
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

    // Find the Start button within actions
    const startBtn = wrapper.find('.actions button')
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

    expect(wrapper.find('td[data-label="名稱"]').text()).toBe('myapp@.service')
  })

  it('特殊字元服務名稱正確顯示 -', () => {
    const service = makeService({ name: 'my-app.service' })
    const wrapper = mount(ServiceRow, { props: { service } })

    expect(wrapper.find('td[data-label="名稱"]').text()).toBe('my-app.service')
  })

  // --- 所有欄位 ---

  it('六個欄位皆存在', () => {
    const service = makeService()
    const wrapper = mount(ServiceRow, { props: { service } })

    expect(wrapper.find('td[data-label="名稱"]').exists()).toBe(true)
    expect(wrapper.find('td[data-label="載入狀態"]').exists()).toBe(true)
    expect(wrapper.find('td[data-label="啟用狀態"]').exists()).toBe(true)
    expect(wrapper.find('td[data-label="執行狀態"]').exists()).toBe(true)
    expect(wrapper.find('td[data-label="開機啟動"]').exists()).toBe(true)
    expect(wrapper.find('td[data-label="操作"]').exists()).toBe(true)
  })

  it('Load 欄位顯示正確值', () => {
    const service = makeService({ load: 'loaded' })
    const wrapper = mount(ServiceRow, { props: { service } })

    expect(wrapper.find('td[data-label="載入狀態"]').text()).toBe('已載入')
  })

  it('Load 欄位顯示 not-found', () => {
    const service = makeService({ load: 'not-found' })
    const wrapper = mount(ServiceRow, { props: { service } })

    expect(wrapper.find('td[data-label="載入狀態"]').text()).toBe('未找到')
  })

  it('Sub 欄位顯示正確值', () => {
    const service = makeService({ sub: 'running' })
    const wrapper = mount(ServiceRow, { props: { service } })

    expect(wrapper.find('td[data-label="執行狀態"]').text()).toBe('執行中')
  })

  it('Sub 欄位顯示 dead', () => {
    const service = makeService({ sub: 'dead' })
    const wrapper = mount(ServiceRow, { props: { service } })

    expect(wrapper.find('td[data-label="執行狀態"]').text()).toBe('已停止')
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

  // --- Auto-start 欄位 ---

  describe('Auto-start 欄位', () => {
    it('解鎖服務 → Auto-start 欄位存在，顯示 Toggle ON (UnitFileState=enabled)', () => {
      const service = makeService({ unitFileState: 'enabled', locked: false })
      const wrapper = mount(ServiceRow, { props: { service } })

      const td = wrapper.find('td[data-label="開機啟動"]')
      expect(td.exists()).toBe(true)
      expect(td.find('.toggle-switch').exists()).toBe(true)
      expect(td.find('.toggle-on').exists()).toBe(true)
      expect(td.text()).not.toContain('🔒')
      expect(td.text()).not.toContain('不適用')
    })

    it('UnitFileState=disabled → Toggle OFF', () => {
      const service = makeService({ unitFileState: 'disabled', active: 'inactive', sub: 'dead', locked: false })
      const wrapper = mount(ServiceRow, { props: { service } })

      expect(wrapper.find('.toggle-off').exists()).toBe(true)
      expect(wrapper.find('.toggle-on').exists()).toBe(false)
    })

    it('UnitFileState=enabled-runtime → Toggle ON', () => {
      const service = makeService({ unitFileState: 'enabled-runtime', locked: false })
      const wrapper = mount(ServiceRow, { props: { service } })

      expect(wrapper.find('.toggle-on').exists()).toBe(true)
    })

    it('UnitFileState=indirect → Toggle OFF', () => {
      const service = makeService({ unitFileState: 'indirect', locked: false })
      const wrapper = mount(ServiceRow, { props: { service } })

      expect(wrapper.find('.toggle-off').exists()).toBe(true)
    })

    it('鎖定服務 → Auto-start 欄位顯示 🔒 不可操作', () => {
      const service = makeService({ locked: true })
      const wrapper = mount(ServiceRow, { props: { service } })

      const td = wrapper.find('td[data-label="開機啟動"]')
      expect(td.text()).toContain('🔒')
      expect(td.find('.toggle-switch').exists()).toBe(false)
    })

    it('locked 但 fragmentPath 非 /etc/systemd/system/ 仍顯示 🔒', () => {
      const service = makeService({ locked: true, fragmentPath: '/lib/systemd/system/nginx.service' })
      const wrapper = mount(ServiceRow, { props: { service } })

      const td = wrapper.find('td[data-label="開機啟動"]')
      expect(td.text()).toContain('🔒')
      expect(td.find('.toggle-switch').exists()).toBe(false)
    })

    it('UnitFileState=static → 顯示「不適用」', () => {
      const service = makeService({ unitFileState: 'static', locked: false })
      const wrapper = mount(ServiceRow, { props: { service } })

      const td = wrapper.find('td[data-label="開機啟動"]')
      expect(td.text()).toContain('不適用')
      expect(td.find('.toggle-switch').exists()).toBe(false)
    })

    it('UnitFileState=masked → 顯示「不適用」', () => {
      const service = makeService({ unitFileState: 'masked', locked: false })
      const wrapper = mount(ServiceRow, { props: { service } })

      expect(wrapper.find('td[data-label="開機啟動"]').text()).toContain('不適用')
    })

    it('UnitFileState=alias → 顯示「不適用」', () => {
      const service = makeService({ unitFileState: 'alias', locked: false })
      const wrapper = mount(ServiceRow, { props: { service } })

      expect(wrapper.find('td[data-label="開機啟動"]').text()).toContain('不適用')
    })

    it('FragmentPath 非 /etc/systemd/system/ 時不顯示 Toggle', () => {
      const service = makeService({
        unitFileState: 'enabled',
        locked: false,
        fragmentPath: '/lib/systemd/system/nginx.service',
      })
      const wrapper = mount(ServiceRow, { props: { service } })

      const td = wrapper.find('td[data-label="開機啟動"]')
      expect(td.find('.toggle-switch').exists()).toBe(false)
      expect(td.text()).toContain('🔒')
    })

    it('點擊 Toggle OFF→ON 時 emit toggle enable event', async () => {
      const service = makeService({ unitFileState: 'disabled', active: 'inactive', sub: 'dead', locked: false })
      const wrapper = mount(ServiceRow, { props: { service } })

      await wrapper.find('.toggle-switch').trigger('click')

      expect(wrapper.emitted('toggle')).toBeTruthy()
      expect(wrapper.emitted('toggle')![0]).toEqual(['enable', 'nginx.service'])
    })

    it('點擊 Toggle ON→OFF 時 emit toggle disable event', async () => {
      const service = makeService({ unitFileState: 'enabled', locked: false })
      const wrapper = mount(ServiceRow, { props: { service } })

      await wrapper.find('.toggle-switch').trigger('click')

      expect(wrapper.emitted('toggle')![0]).toEqual(['disable', 'nginx.service'])
    })

    it('Toggle loading 狀態時不可點擊', async () => {
      const service = makeService({ unitFileState: 'disabled', active: 'inactive', sub: 'dead', locked: false })
      const wrapper = mount(ServiceRow, { props: { service, togglingService: 'nginx.service' } })

      const toggle = wrapper.find('.toggle-switch')
      // button should be disabled
      expect(toggle.attributes('disabled')).toBeDefined()

      await toggle.trigger('click')
      expect(wrapper.emitted('toggle')).toBeFalsy()
    })

    it('Toggle loading 狀態顯示 loading class', () => {
      const service = makeService({ unitFileState: 'enabled', locked: false })
      const wrapper = mount(ServiceRow, { props: { service, togglingService: 'nginx.service' } })

      expect(wrapper.find('.toggle-loading').exists()).toBe(true)
    })

    it('非該服務的 togglingService 不影響其他服務的 toggle', () => {
      const service = makeService({ unitFileState: 'enabled', locked: false })
      const wrapper = mount(ServiceRow, { props: { service, togglingService: 'other.service' } })

      expect(wrapper.find('.toggle-loading').exists()).toBe(false)
      expect(wrapper.find('.toggle-switch').attributes('disabled')).toBeUndefined()
    })
  })
})

describe('RWD 手機版 data-label 語系', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('繁體中文模式下 data-label 應為中文', () => {
    const service = makeService()
    const wrapper = mount(ServiceRow, { props: { service } })

    expect(wrapper.find('td[data-label="名稱"]').exists()).toBe(true)
    expect(wrapper.find('td[data-label="載入狀態"]').exists()).toBe(true)
    expect(wrapper.find('td[data-label="啟用狀態"]').exists()).toBe(true)
    expect(wrapper.find('td[data-label="執行狀態"]').exists()).toBe(true)
    expect(wrapper.find('td[data-label="開機啟動"]').exists()).toBe(true)
    expect(wrapper.find('td[data-label="操作"]').exists()).toBe(true)
  })

  it('data-label 不應出現英文', () => {
    const service = makeService()
    const wrapper = mount(ServiceRow, { props: { service } })

    expect(wrapper.find('td[data-label="Name"]').exists()).toBe(false)
    expect(wrapper.find('td[data-label="Load"]').exists()).toBe(false)
    expect(wrapper.find('td[data-label="Active"]').exists()).toBe(false)
    expect(wrapper.find('td[data-label="Sub"]').exists()).toBe(false)
    expect(wrapper.find('td[data-label="Auto-start"]').exists()).toBe(false)
    expect(wrapper.find('td[data-label="Actions"]').exists()).toBe(false)
  })
})
