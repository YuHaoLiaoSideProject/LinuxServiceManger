import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import StatsBar from '../components/StatsBar.vue'
import type { Service } from '../types/service'

// Mock i18n composable
vi.mock('../composables/useI18n', () => ({
  useI18n: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'filter.all': '全部',
        'stats.running': '執行中',
        'stats.failed': '失敗',
        'filter.inactive': '未啟用',
        'stats.groupAria': '狀態過濾',
      }
      return map[key] || key
    },
    lang: { value: 'zh-TW' },
    setLang: vi.fn(),
    toggleLang: vi.fn(),
  }),
}))

describe('統計列 — 使用者看到的數字（卡片即 filter，口徑與 useServiceFilter 一致）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('沒有任何服務時，四個數字都是 0', () => {
    const wrapper = mount(StatsBar, {
      props: { services: [] as Service[] },
    })

    const values = wrapper.findAll('.stat-value')
    expect(values[0].text()).toBe('0')  // 全部
    expect(values[1].text()).toBe('0')  // 執行中
    expect(values[2].text()).toBe('0')  // 失敗
    expect(values[3].text()).toBe('0')  // 未啟用
  })

  it('執行中 = sub==="running"（過渡態 activating 不算）、未啟用 = active==="inactive"', () => {
    const services: Service[] = [
      { name: 'a.service', load: 'loaded', active: 'active', sub: 'running', locked: false, unitFileState: 'enabled', fragmentPath: '/etc/systemd/system/a.service' },
      { name: 'b.service', load: 'loaded', active: 'running', sub: 'running', locked: false, unitFileState: 'enabled', fragmentPath: '/etc/systemd/system/b.service' },
      { name: 'c.service', load: 'loaded', active: 'activating', sub: 'auto-restart', locked: false, unitFileState: 'disabled', fragmentPath: '/etc/systemd/system/c.service' },
      { name: 'd.service', load: 'loaded', active: 'failed', sub: 'failed', locked: true, unitFileState: 'static', fragmentPath: '/lib/systemd/system/d.service' },
      { name: 'e.service', load: 'loaded', active: 'inactive', sub: 'dead', locked: false, unitFileState: 'disabled', fragmentPath: '/etc/systemd/system/e.service' },
    ]

    const wrapper = mount(StatsBar, { props: { services } })

    const values = wrapper.findAll('.stat-value')
    expect(values[0].text()).toBe('5')  // 總共 5 個
    expect(values[1].text()).toBe('2')  // 只有 a、b 的 sub 是 running（c 是 auto-restart 不算）
    expect(values[2].text()).toBe('1')  // d 是 failed
    expect(values[3].text()).toBe('1')  // e 是 inactive
  })

  it('全部服務都失敗時，執行中為 0，失敗等於總數', () => {
    const services: Service[] = [
      { name: 'x.service', load: 'loaded', active: 'failed', sub: 'failed', locked: false, unitFileState: 'enabled', fragmentPath: '/etc/systemd/system/x.service' },
      { name: 'y.service', load: 'loaded', active: 'failed', sub: 'failed', locked: false, unitFileState: 'enabled', fragmentPath: '/etc/systemd/system/y.service' },
    ]

    const wrapper = mount(StatsBar, { props: { services } })

    const values = wrapper.findAll('.stat-value')
    expect(values[0].text()).toBe('2')
    expect(values[1].text()).toBe('0')
    expect(values[2].text()).toBe('2')
    expect(values[3].text()).toBe('0')
  })
})

describe('統計列 — 卡片即 filter（互動）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  const services: Service[] = [
    { name: 'a.service', load: 'loaded', active: 'active', sub: 'running', locked: false, unitFileState: 'enabled', fragmentPath: '/etc/systemd/system/a.service' },
    { name: 'e.service', load: 'loaded', active: 'inactive', sub: 'dead', locked: false, unitFileState: 'disabled', fragmentPath: '/etc/systemd/system/e.service' },
  ]

  it('點擊「執行中」卡片 emit set-status-filter=running', async () => {
    const wrapper = mount(StatsBar, { props: { services } })

    await wrapper.find('.stat-active').trigger('click')

    const emitted = wrapper.emitted('set-status-filter')
    expect(emitted).toBeTruthy()
    expect(emitted![0]).toEqual(['running'])
  })

  it('statusFilter 對應的卡片有 .active class 且 aria-pressed=true', () => {
    const wrapper = mount(StatsBar, {
      props: { services, statusFilter: 'inactive' },
    })

    const inactive = wrapper.find('.stat-inactive')
    const running = wrapper.find('.stat-active')
    expect(inactive.classes()).toContain('active')
    expect(inactive.attributes('aria-pressed')).toBe('true')
    expect(running.classes()).not.toContain('active')
    expect(running.attributes('aria-pressed')).toBe('false')
  })

  it('loading 時所有卡片 disabled', () => {
    const wrapper = mount(StatsBar, {
      props: { services, loading: true },
    })

    const cards = wrapper.findAll('.stat-card')
    for (const card of cards) {
      expect((card.element as HTMLButtonElement).disabled).toBe(true)
    }
  })

  it('卡片是 button 且群組有 aria-label', () => {
    const wrapper = mount(StatsBar, { props: { services } })

    expect(wrapper.find('.stats-bar').attributes('role')).toBe('group')
    expect(wrapper.find('.stats-bar').attributes('aria-label')).toBe('狀態過濾')
    const cards = wrapper.findAll('.stat-card')
    expect(cards.length).toBe(4)
    for (const card of cards) {
      expect(card.element.tagName).toBe('BUTTON')
    }
  })
})
