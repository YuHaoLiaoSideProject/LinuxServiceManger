import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import AppHeader from '../components/AppHeader.vue'

// Mock i18n
vi.mock('../composables/useI18n', () => ({
  useI18n: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'header.refresh': '🔄 重新整理',
        'header.logout': '🚪 登出',
        'header.refresh.aria': '重新整理',
        'header.logout.aria': '登出',
        'lang.toggle.title': '切換語言',
        'lang.toggle': '切換語言',
        'theme.toggle.title': '切換主題',
        'theme.toggle': '切換主題',
      }
      return map[key] || key
    },
    lang: { value: 'zh-TW' },
    setLang: vi.fn(),
    toggleLang: vi.fn(),
  }),
}))

// Mock useTheme — use a proper Vue ref so template auto-unwrapping works
vi.mock('../composables/useTheme', () => ({
  useTheme: () => ({
    theme: ref('light'),
    toggleTheme: vi.fn(),
    setTheme: vi.fn(),
  }),
}))

describe('AppHeader — 頂部導航列', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('顯示標題與使用者名稱', () => {
    const wrapper = mount(AppHeader, {
      props: { username: 'admin' },
    })

    expect(wrapper.text()).toContain('Linux Service Manager')
    expect(wrapper.text()).toContain('admin')
    expect(wrapper.find('.user-badge').text()).toContain('admin')
  })

  it('顯示登出按鈕', () => {
    const wrapper = mount(AppHeader, {
      props: { username: 'admin' },
    })

    const logoutBtn = wrapper.findAll('button').find(b => b.text().includes('登出'))
    expect(logoutBtn).toBeDefined()
    expect(logoutBtn!.text()).toContain('🚪 登出')
  })

  it('點擊登出 emit logout', async () => {
    const wrapper = mount(AppHeader, {
      props: { username: 'admin' },
    })

    const logoutBtn = wrapper.findAll('button').find(b => b.text().includes('登出'))
    await logoutBtn!.trigger('click')

    expect(wrapper.emitted('logout')).toBeTruthy()
    expect(wrapper.emitted('logout')?.length).toBe(1)
  })

  it('顯示重整按鈕 emit refresh', async () => {
    const wrapper = mount(AppHeader, {
      props: { username: 'admin' },
    })

    const refreshBtn = wrapper.findAll('button').find(b => b.text().includes('重新整理'))
    expect(refreshBtn).toBeDefined()
    expect(refreshBtn!.text()).toContain('🔄 重新整理')

    await refreshBtn!.trigger('click')

    expect(wrapper.emitted('refresh')).toBeTruthy()
    expect(wrapper.emitted('refresh')?.length).toBe(1)
  })

  it('顯示語言切換按鈕', () => {
    const wrapper = mount(AppHeader, {
      props: { username: 'admin' },
    })

    const langBtn = wrapper.find('.lang-toggle')
    expect(langBtn.exists()).toBe(true)
    expect(langBtn.text()).toBe('🌐')
  })

  it('顯示主題切換按鈕（light theme → ☀️）', () => {
    const wrapper = mount(AppHeader, {
      props: { username: 'admin' },
    })

    const themeBtn = wrapper.find('.theme-toggle')
    expect(themeBtn.exists()).toBe(true)
    // light theme shows sun icon
    expect(themeBtn.text()).toBe('☀️')
  })

  // -- Audit Log link (009) -----------------------------------------

  it('F-HD-01: Header 顯示「Audit Log」導覽連結', () => {
    const wrapper = mount(AppHeader, {
      props: { username: 'admin' },
    })

    const auditLink = wrapper.find('router-link[to="/audit"]')
    expect(auditLink.exists()).toBe(true)
    expect(auditLink.text()).toBe('Audit Log')
  })

  it('F-HD-02: 點擊 Audit Log → 導航至 /audit', () => {
    const wrapper = mount(AppHeader, {
      props: { username: 'admin' },
    })

    const auditLink = wrapper.find('router-link[to="/audit"]')
    expect(auditLink.attributes('to')).toBe('/audit')
  })

  it('F-HD-03: 未登入（無 username）→ 不顯示 Audit Log 連結', () => {
    const wrapper = mount(AppHeader, {
      props: {},
    })

    const auditLink = wrapper.find('router-link[to="/audit"]')
    expect(auditLink.exists()).toBe(false)
  })
})
