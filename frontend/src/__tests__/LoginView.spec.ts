import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import LoginView from '../views/LoginView.vue'
import { useAuthStore } from '../stores/auth'

// Mock router
vi.mock('vue-router', () => ({
  useRouter: () => ({ replace: vi.fn() }),
}))

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

describe('登入頁面 — 使用者行為', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('使用者打開頁面，看到登入表單', () => {
    const wrapper = mount(LoginView)

    expect(wrapper.find('form').exists()).toBe(true)
    expect(wrapper.find('input[type="text"]').exists()).toBe(true)
    expect(wrapper.find('input[type="password"]').exists()).toBe(true)
    expect(wrapper.find('button[type="submit"]').exists()).toBe(true)
  })

  it('表單欄位為必填，空白無法送出', () => {
    const wrapper = mount(LoginView)

    const usernameInput = wrapper.find('input[type="text"]')
    const passwordInput = wrapper.find('input[type="password"]')

    expect((usernameInput.element as HTMLInputElement).required).toBe(true)
    expect((passwordInput.element as HTMLInputElement).required).toBe(true)
  })

  it('使用者輸入錯誤帳密，看到錯誤訊息', async () => {
    const wrapper = mount(LoginView)
    const auth = useAuthStore()

    // Simulate failed login: mock store to return error
    auth.login = vi.fn().mockResolvedValue('帳號或密碼錯誤')

    await wrapper.find('input[type="text"]').setValue('wrong')
    await wrapper.find('input[type="password"]').setValue('wrong')
    await wrapper.find('form').trigger('submit.prevent')

    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()

    expect(wrapper.text()).toContain('帳號或密碼錯誤')
  })
})
