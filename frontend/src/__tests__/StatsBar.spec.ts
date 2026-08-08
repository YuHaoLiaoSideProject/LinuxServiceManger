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
        'stats.total': '總服務數',
        'stats.running': '執行中',
        'stats.failed': '失敗',
      }
      return map[key] || key
    },
    lang: { value: 'zh-TW' },
    setLang: vi.fn(),
    toggleLang: vi.fn(),
  }),
}))

describe('統計列 — 使用者看到的數字', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('沒有任何服務時，三個數字都是 0', () => {
    const wrapper = mount(StatsBar, {
      props: { services: [] as Service[] },
    })

    const values = wrapper.findAll('.stat-value')
    expect(values[0].text()).toBe('0')  // 總服務數
    expect(values[1].text()).toBe('0')  // 執行中
    expect(values[2].text()).toBe('0')  // 失敗
  })

  it('有 3 個執行中、1 個失敗、0 個停止的服務，數字應正確', () => {
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
    expect(values[1].text()).toBe('3')  // active + running + activating = 3
    expect(values[2].text()).toBe('1')  // 只有 c 是 failed
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
  })
})
