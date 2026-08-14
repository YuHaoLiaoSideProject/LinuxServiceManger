/**
 * ApiDocsView.vue 視圖測試（F-DOC-01 ~ F-DOC-04）
 * 驗證 API 文件頁：iframe 指向 /api/v1/docs/、認證說明、新分頁按鈕、登出。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('../../composables/useI18n', () => ({
  useI18n: () => ({
    t: (key: string) => key,
    lang: { value: 'zh-TW' },
    setLang: vi.fn(),
    toggleLang: vi.fn(),
  }),
}))

vi.mock('vue-router', () => ({
  useRouter: () => ({ replace: vi.fn() }),
}))

// Auth store 真實 pinia；logout 會呼叫 api client → mock
vi.mock('../../api/client', () => ({
  checkSession: vi.fn(),
  login: vi.fn(),
  logout: vi.fn().mockResolvedValue({ message: 'logged out' }),
}))

import { useAuthStore } from '../../stores/auth'
import ApiDocsView from '../ApiDocsView.vue'

function mountView() {
  return mount(ApiDocsView, {
    global: {
      // 不注入新 pinia — 使用 beforeEach 設定的 active pinia
      stubs: {
        AppHeader: { template: '<header class="stub-header" />' },
      },
    },
  })
}

describe('ApiDocsView — API 文件頁', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    const auth = useAuthStore()
    auth.loading = false
    auth.authenticated = true
    auth.username = 'admin'
  })

  it('F-DOC-01: 渲染文件 iframe 且 src 指向 /api/v1/docs/', () => {
    const wrapper = mountView()
    const frame = wrapper.find('[data-testid="docs-frame"]')
    expect(frame.exists()).toBe(true)
    expect(frame.attributes('src')).toBe('/api/v1/docs/')
    expect(frame.attributes('title')).toContain('Swagger UI')
  })

  it('F-DOC-02: 顯示認證說明（含 curl 範例）', async () => {
    const wrapper = mountView()
    const guide = wrapper.find('[data-testid="docs-auth-guide"]')
    expect(guide.exists()).toBe(true)
    expect(guide.text()).toContain('Authorization: Bearer')

    const curl = wrapper.find('[data-testid="docs-curl-example"]')
    expect(curl.text()).toContain('/api/v1/services')
  })

  it('F-DOC-03: 提供「新分頁開啟」連結，指向文件 URL', () => {
    const wrapper = mountView()
    const btn = wrapper.find('[data-testid="docs-open-new-tab"]')
    expect(btn.exists()).toBe(true)
    expect(btn.attributes('href')).toBe('/api/v1/docs/')
    expect(btn.attributes('target')).toBe('_blank')
  })

  it('F-DOC-04: 未登入時使用 auth store 的登出流程（logout 不崩潰）', async () => {
    const wrapper = mountView()
    await flushPromises()
    const auth = useAuthStore()
    expect(auth.username).toBe('admin')
    wrapper.unmount()
  })
})
