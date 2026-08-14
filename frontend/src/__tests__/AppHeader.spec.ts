import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, RouterLinkStub } from '@vue/test-utils'
import { nextTick, ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import AppHeader from '../components/AppHeader.vue'

// Mock i18n + theme handlers (hoisted so tests can assert calls)
const mocks = vi.hoisted(() => ({
  toggleLang: vi.fn(),
  toggleTheme: vi.fn(),
  mockRoutePath: { value: '/' },
}))

vi.mock('../composables/useI18n', () => ({
  useI18n: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'nav.dashboard': '儀表板',
        'nav.audit': '稽核紀錄',
        'account.signedIn': '已登入',
        'account.toggle.title': '帳號選單',
        'menu.sectionLinks': '功能',
        'menu.notifications': '🔔 通知',
        'menu.docs': '📖 API 文件',
        'menu.sectionSettings': '設定',
        'menu.apiTokens': 'API Tokens',
        'menu.toggleTheme': '☀️ 切換主題',
        'menu.toggleLang': '🌐 切換語言',
        'menu.logout': '🚪 登出',
        'menu.logout.aria': '登出',
      }
      return map[key] || key
    },
    lang: { value: 'zh-TW' },
    setLang: vi.fn(),
    toggleLang: mocks.toggleLang,
  }),
}))

// Mock useTheme — use a proper Vue ref so template auto-unwrapping works
vi.mock('../composables/useTheme', () => ({
  useTheme: () => ({
    theme: ref('light'),
    toggleTheme: mocks.toggleTheme,
    setTheme: vi.fn(),
  }),
}))

vi.mock('vue-router', () => ({
  useRoute: () => ({ path: mocks.mockRoutePath.value }),
}))

function mountHeader(props: Record<string, unknown> = {}) {
  return mount(AppHeader, {
    props: { username: 'admin', ...props },
    attachTo: document.body,
    global: { stubs: { RouterLink: RouterLinkStub } },
  })
}

function navLinks(wrapper: ReturnType<typeof mountHeader>) {
  return wrapper.findAllComponents(RouterLinkStub)
}

describe('AppHeader — 頂部導航列（品牌 / 主導航 / 帳號選單）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    mocks.toggleLang.mockClear()
    mocks.toggleTheme.mockClear()
    mocks.mockRoutePath.value = '/'
  })

  it('顯示標題與使用者名稱（帳號按鈕內）', () => {
    const wrapper = mountHeader()

    expect(wrapper.text()).toContain('Linux Service Manager')
    const accountBtn = wrapper.find('[data-testid="account-btn"]')
    expect(accountBtn.text()).toContain('admin')
    expect(accountBtn.find('.avatar').text()).toBe('A')
  })

  it('F-NAV-01: 顯示「儀表板」與「稽核紀錄」導覽連結（通知/API 文件已移入帳號選單）', () => {
    const wrapper = mountHeader()
    const links = navLinks(wrapper)
    const dash = links.find(l => l.props('to') === '/' && l.attributes('data-testid') === 'nav-dashboard')
    const audit = links.find(l => l.props('to') === '/audit')

    expect(dash?.text()).toContain('儀表板')
    expect(audit?.text()).toContain('稽核紀錄')
    expect(audit?.attributes('data-testid')).toBe('nav-audit')
    // 通知 / API 文件 不再位於主導航
    expect(wrapper.find('[data-testid="nav-notifications"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="nav-docs"]').exists()).toBe(false)
  })

  it('F-NAV-02: 未登入（無 username）→ 不顯示導覽與帳號選單', () => {
    const wrapper = mountHeader({ username: undefined })

    expect(wrapper.find('.nav-group').exists()).toBe(false)
    expect(wrapper.find('[data-testid="account-btn"]').exists()).toBe(false)
  })

  it('active 狀態跟隨目前路由（/audit → 稽核紀錄 active）', () => {
    mocks.mockRoutePath.value = '/audit'
    const wrapper = mountHeader()

    expect(wrapper.find('[data-testid="nav-audit"]').classes()).toContain('active')
    expect(wrapper.find('[data-testid="nav-dashboard"]').classes()).not.toContain('active')
  })

  it('帳號選單預設關閉，aria-expanded=false', () => {
    const wrapper = mountHeader()

    expect(wrapper.find('[data-testid="account-menu"]').classes()).not.toContain('open')
    expect(wrapper.find('[data-testid="account-btn"]').attributes('aria-expanded')).toBe('false')
  })

  it('點擊帳號按鈕開關選單', async () => {
    const wrapper = mountHeader()

    await wrapper.find('[data-testid="account-btn"]').trigger('click')
    expect(wrapper.find('[data-testid="account-menu"]').classes()).toContain('open')
    expect(wrapper.find('[data-testid="account-btn"]').attributes('aria-expanded')).toBe('true')

    await wrapper.find('[data-testid="account-btn"]').trigger('click')
    expect(wrapper.find('[data-testid="account-menu"]').classes()).not.toContain('open')
  })

  it('Escape 關閉選單', async () => {
    const wrapper = mountHeader()
    await wrapper.find('[data-testid="account-btn"]').trigger('click')
    expect(wrapper.find('[data-testid="account-menu"]').classes()).toContain('open')

    // Dispatch keydown on the header, bubbles up to document listener
    wrapper.find('.app-header').element.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    )
    await nextTick()
    expect(wrapper.find('[data-testid="account-menu"]').classes()).not.toContain('open')
  })

  it('點擊選單外部關閉選單', async () => {
    const wrapper = mountHeader()
    await wrapper.find('[data-testid="account-btn"]').trigger('click')
    expect(wrapper.find('[data-testid="account-menu"]').classes()).toContain('open')

    // Click outside the .account container (bubbles to document listener)
    wrapper.find('.app-header').element.dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    )
    await nextTick()
    expect(wrapper.find('[data-testid="account-menu"]').classes()).not.toContain('open')
  })

  it('選單包含 功能（通知/API 文件）與 設定（主題/語言/登出）項目', async () => {
    const wrapper = mountHeader()
    await wrapper.find('[data-testid="account-btn"]').trigger('click')

    expect(wrapper.find('[data-testid="menu-notifications"]').text()).toBe('🔔 通知')
    expect(wrapper.find('[data-testid="menu-docs"]').text()).toBe('📖 API 文件')
    expect(wrapper.find('[data-testid="menu-tokens"]').text()).toBe('API Tokens')
    expect(wrapper.find('[data-testid="menu-theme"]').text()).toBe('☀️ 切換主題')
    expect(wrapper.find('[data-testid="menu-lang"]').text()).toBe('🌐 切換語言')
    expect(wrapper.find('[data-testid="menu-logout"]').text()).toBe('🚪 登出')
  })

  it('選單「通知 / API 文件」連結到正確路由並關閉選單', async () => {
    const wrapper = mountHeader()
    await wrapper.find('[data-testid="account-btn"]').trigger('click')

    const menuLinks = () => wrapper.findAllComponents(RouterLinkStub)
    const notifyLink = menuLinks().find(l => l.attributes('data-testid') === 'menu-notifications')
    expect(notifyLink?.props('to')).toBe('/notifications')
    await notifyLink!.trigger('click')
    expect(wrapper.find('[data-testid="account-menu"]').classes()).not.toContain('open')

    await wrapper.find('[data-testid="account-btn"]').trigger('click')
    const docsLink = menuLinks().find(l => l.attributes('data-testid') === 'menu-docs')
    expect(docsLink?.props('to')).toBe('/docs')
    await docsLink!.trigger('click')
    expect(wrapper.find('[data-testid="account-menu"]').classes()).not.toContain('open')
  })

  it('選單 active 狀態跟隨目前路由（/docs → API 文件 active）', () => {
    mocks.mockRoutePath.value = '/docs'
    const wrapper = mountHeader()

    expect(wrapper.find('[data-testid="menu-docs"]').classes()).toContain('active')
    expect(wrapper.find('[data-testid="menu-notifications"]').classes()).not.toContain('active')
  })

  it('點擊選單「登出」emit logout 並帶正確 aria-label', async () => {
    const wrapper = mountHeader()
    await wrapper.find('[data-testid="account-btn"]').trigger('click')

    const logoutItem = wrapper.find('[data-testid="menu-logout"]')
    expect(logoutItem.attributes('aria-label')).toBe('登出')

    await logoutItem.trigger('click')
    expect(wrapper.emitted('logout')).toBeTruthy()
    expect(wrapper.emitted('logout')?.length).toBe(1)
  })

  it('點擊選單「切換語言」呼叫 toggleLang 並關閉選單', async () => {
    const wrapper = mountHeader()
    await wrapper.find('[data-testid="account-btn"]').trigger('click')
    await wrapper.find('[data-testid="menu-lang"]').trigger('click')

    expect(mocks.toggleLang).toHaveBeenCalledTimes(1)
    expect(wrapper.find('[data-testid="account-menu"]').classes()).not.toContain('open')
  })

  it('點擊選單「切換主題」呼叫 toggleTheme 並關閉選單', async () => {
    const wrapper = mountHeader()
    await wrapper.find('[data-testid="account-btn"]').trigger('click')
    await wrapper.find('[data-testid="menu-theme"]').trigger('click')

    expect(mocks.toggleTheme).toHaveBeenCalledTimes(1)
    expect(wrapper.find('[data-testid="account-menu"]').classes()).not.toContain('open')
  })

  it('WebSocket 連線狀態指示', () => {
    const wrapper = mountHeader({ wsStatus: 'connected' })
    expect(wrapper.text()).toContain('已連線')

    const offline = mountHeader({ username: 'admin', wsStatus: 'offline' })
    expect(offline.text()).toContain('離線')
  })
})
