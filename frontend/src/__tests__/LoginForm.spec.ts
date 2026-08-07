import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import LoginForm from '../components/LoginForm.vue'

// Mock i18n
vi.mock('../composables/useI18n', () => ({
  useI18n: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'login.title': 'Linux Service Manager',
        'login.subtitle': '請登入以管理系統服務',
        'login.username': '帳號',
        'login.password': '密碼',
        'login.submit': '登入',
        'login.error': '帳號或密碼錯誤',
      }
      return map[key] || key
    },
    lang: { value: 'zh-TW' },
    setLang: vi.fn(),
    toggleLang: vi.fn(),
  }),
}))

// Create a controllable mockLogin function
const mockLogin = vi.fn()

vi.mock('../stores/auth', () => ({
  useAuthStore: () => ({
    login: mockLogin,
    username: '',
    authenticated: false,
    loading: false,
    isLoggedIn: false,
    init: vi.fn(),
    logout: vi.fn(),
  }),
}))

describe('LoginForm — 登入表單', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    mockLogin.mockReset()
  })

  it('渲染帳號、密碼、登入按鈕', () => {
    const wrapper = mount(LoginForm)

    expect(wrapper.find('h2').text()).toBe('Linux Service Manager')
    expect(wrapper.find('input[type="text"]').exists()).toBe(true)
    expect(wrapper.find('input[type="password"]').exists()).toBe(true)
    expect(wrapper.find('button[type="submit"]').exists()).toBe(true)
    expect(wrapper.find('button[type="submit"]').text()).toBe('登入')
  })

  it('帳密為 required', () => {
    const wrapper = mount(LoginForm)

    const usernameInput = wrapper.find('input[type="text"]')
    const passwordInput = wrapper.find('input[type="password"]')

    expect((usernameInput.element as HTMLInputElement).required).toBe(true)
    expect((passwordInput.element as HTMLInputElement).required).toBe(true)
  })

  it('輸入後點擊提交，呼叫 auth.login', async () => {
    mockLogin.mockResolvedValue(null)
    const wrapper = mount(LoginForm)

    await wrapper.find('input[type="text"]').setValue('admin')
    await wrapper.find('input[type="password"]').setValue('secret')
    await wrapper.find('form').trigger('submit.prevent')

    expect(mockLogin).toHaveBeenCalledWith('admin', 'secret')
  })

  it('登入失敗時顯示錯誤訊息', async () => {
    mockLogin.mockResolvedValue('帳號或密碼錯誤')
    const wrapper = mount(LoginForm)

    await wrapper.find('input[type="text"]').setValue('wrong')
    await wrapper.find('input[type="password"]').setValue('wrong')
    await wrapper.find('form').trigger('submit.prevent')

    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.login-error').exists()).toBe(true)
    expect(wrapper.find('.login-error').text()).toBe('帳號或密碼錯誤')
  })

  it('loading 時按鈕顯示 ... 且 disabled', async () => {
    // Never resolves to keep loading state
    mockLogin.mockReturnValue(new Promise(() => {}))
    const wrapper = mount(LoginForm)

    await wrapper.find('input[type="text"]').setValue('admin')
    await wrapper.find('input[type="password"]').setValue('pass')
    await wrapper.find('form').trigger('submit.prevent')

    await wrapper.vm.$nextTick()

    expect(wrapper.find('button[type="submit"]').text()).toBe('...')
    expect((wrapper.find('button[type="submit"]').element as HTMLButtonElement).disabled).toBe(true)
  })
})
