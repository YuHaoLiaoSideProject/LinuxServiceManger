import { describe, it, expect, beforeEach } from 'vitest'
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
      { name: 'a.service', load: 'loaded', active: 'active', sub: 'running', locked: false },
      { name: 'b.service', load: 'loaded', active: 'inactive', sub: 'dead', locked: false },
      { name: 'c.service', load: 'loaded', active: 'active', sub: 'running', locked: false },
      { name: 'd.service', load: 'loaded', active: 'active', sub: 'running', locked: true },
      { name: 'e.service', load: 'loaded', active: 'failed', sub: 'failed', locked: true },
    ]

    const wrapper = mount(TabsBar, { props: { services } })

    const counts = wrapper.findAll('.tab-count')
    expect(counts[0].text()).toBe('3')  // 我的服務
    expect(counts[1].text()).toBe('2')  // 系統服務
  })

  it('點擊「系統服務」tab，emit setTab("system")', async () => {
    const services: Service[] = [
      { name: 'a.service', load: 'loaded', active: 'active', sub: 'running', locked: false },
    ]

    const wrapper = mount(TabsBar, { props: { services } })

    await wrapper.find('#tab-system').trigger('click')
    expect(wrapper.emitted('setTab')?.[0]).toEqual(['system'])
  })
})
