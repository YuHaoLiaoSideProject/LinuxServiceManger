import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import TabsBar from '../components/TabsBar.vue'
import type { Service } from '../types/service'

vi.mock('../composables/useI18n', () => ({
  useI18n: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'tab.my': '我的服務',
        'tab.system': '系統服務',
      }
      return map[key] || key
    },
    lang: { value: 'zh-TW' },
    setLang: vi.fn(),
    toggleLang: vi.fn(),
  }),
}))

describe('分頁切換 — 使用者點擊 tab', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('3 個自訂服務 + 2 個系統服務，tab 上的數字應正確', () => {
    const services: Service[] = [
      { name: 'a.service', load: 'loaded', active: 'active', sub: 'running', locked: false, unitFileState: 'enabled', fragmentPath: '/etc/systemd/system/a.service' },
      { name: 'b.service', load: 'loaded', active: 'inactive', sub: 'dead', locked: false, unitFileState: 'disabled', fragmentPath: '/etc/systemd/system/b.service' },
      { name: 'c.service', load: 'loaded', active: 'active', sub: 'running', locked: false, unitFileState: 'enabled', fragmentPath: '/etc/systemd/system/c.service' },
      { name: 'd.service', load: 'loaded', active: 'active', sub: 'running', locked: true, unitFileState: 'static', fragmentPath: '/lib/systemd/system/d.service' },
      { name: 'e.service', load: 'loaded', active: 'failed', sub: 'failed', locked: true, unitFileState: 'masked', fragmentPath: '/lib/systemd/system/e.service' },
    ]

    const wrapper = mount(TabsBar, { props: { services, tab: 'my' } })

    const counts = wrapper.findAll('.tab-count')
    expect(counts[0].text()).toBe('3')  // 我的服務
    expect(counts[1].text()).toBe('2')  // 系統服務
  })

  it('預設 tab="my" 時 #tab-my 有 active class，#tab-system 無', () => {
    const services: Service[] = [
      { name: 'a.service', load: 'loaded', active: 'active', sub: 'running', locked: false, unitFileState: 'enabled', fragmentPath: '/etc/systemd/system/a.service' },
    ]

    const wrapper = mount(TabsBar, { props: { services, tab: 'my' } })

    expect(wrapper.find('#tab-my').classes()).toContain('active')
    expect(wrapper.find('#tab-system').classes()).not.toContain('active')
  })

  it('tab="system" 時 #tab-system 有 active class，#tab-my 無', () => {
    const services: Service[] = [
      { name: 'a.service', load: 'loaded', active: 'active', sub: 'running', locked: false, unitFileState: 'enabled', fragmentPath: '/etc/systemd/system/a.service' },
    ]

    const wrapper = mount(TabsBar, { props: { services, tab: 'system' } })

    expect(wrapper.find('#tab-system').classes()).toContain('active')
    expect(wrapper.find('#tab-my').classes()).not.toContain('active')
  })

  it('點擊「系統服務」tab，emit setTab("system")', async () => {
    const services: Service[] = [
      { name: 'a.service', load: 'loaded', active: 'active', sub: 'running', locked: false, unitFileState: 'enabled', fragmentPath: '/etc/systemd/system/a.service' },
    ]

    const wrapper = mount(TabsBar, { props: { services, tab: 'my' } })

    await wrapper.find('#tab-system').trigger('click')
    expect(wrapper.emitted('setTab')?.[0]).toEqual(['system'])
  })
})
