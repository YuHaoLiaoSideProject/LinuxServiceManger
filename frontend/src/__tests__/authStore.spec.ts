import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

// vi.mock factory is hoisted - use vi.hoisted to create mock functions
const { mockCheckSession, mockApiLogin, mockApiLogout } = vi.hoisted(() => ({
  mockCheckSession: vi.fn(),
  mockApiLogin: vi.fn(),
  mockApiLogout: vi.fn(),
}))

vi.mock('../api/client', () => ({
  checkSession: mockCheckSession,
  login: mockApiLogin,
  logout: mockApiLogout,
}))

import { useAuthStore } from '../stores/auth'

describe('Pinia Auth Store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    mockCheckSession.mockReset()
    mockApiLogin.mockReset()
    mockApiLogout.mockReset()
  })

  it('init() 呼叫 /api/v1/session，成功時 authenticated=true', async () => {
    mockCheckSession.mockResolvedValue({ authenticated: true, username: 'admin' })

    const auth = useAuthStore()
    expect(auth.loading).toBe(true)
    expect(auth.authenticated).toBe(false)

    await auth.init()

    expect(mockCheckSession).toHaveBeenCalledTimes(1)
    expect(auth.authenticated).toBe(true)
    expect(auth.username).toBe('admin')
    expect(auth.loading).toBe(false)
  })

  it('init() 失敗時 authenticated=false, username=""', async () => {
    mockCheckSession.mockRejectedValue(new Error('Network error'))

    const auth = useAuthStore()
    await auth.init()

    expect(auth.authenticated).toBe(false)
    expect(auth.username).toBe('')
    expect(auth.loading).toBe(false)
  })

  it('login() 成功回傳 null，authenticated=true', async () => {
    mockApiLogin.mockResolvedValue({ username: 'admin', message: 'ok' })

    const auth = useAuthStore()
    const result = await auth.login('admin', 'correct-password')

    expect(result).toBeNull()
    expect(auth.authenticated).toBe(true)
    expect(auth.username).toBe('admin')
    expect(mockApiLogin).toHaveBeenCalledWith('admin', 'correct-password')
  })

  it('login() 失敗回傳 error message', async () => {
    const errorObj = { response: { data: { error: '帳號或密碼錯誤' } } }
    mockApiLogin.mockRejectedValue(errorObj)

    const auth = useAuthStore()
    const result = await auth.login('admin', 'wrong-password')

    expect(result).toBe('帳號或密碼錯誤')
    expect(auth.authenticated).toBe(false)
    expect(auth.username).toBe('')
  })

  it('login() 失敗且無 error response 時回傳預設訊息', async () => {
    mockApiLogin.mockRejectedValue(new Error('Network Error'))

    const auth = useAuthStore()
    const result = await auth.login('admin', 'pass')

    expect(result).toBe('Login failed')
    expect(auth.authenticated).toBe(false)
  })

  it('logout() 清除 username 與 authenticated', async () => {
    mockApiLogout.mockResolvedValue({ message: 'ok' })
    mockApiLogin.mockResolvedValue({ username: 'admin', message: 'ok' })

    const auth = useAuthStore()
    await auth.login('admin', 'pass')
    expect(auth.authenticated).toBe(true)
    expect(auth.username).toBe('admin')

    await auth.logout()

    expect(mockApiLogout).toHaveBeenCalledTimes(1)
    expect(auth.authenticated).toBe(false)
    expect(auth.username).toBe('')
  })

  it('logout() API 失敗仍清除本地狀態', async () => {
    mockApiLogout.mockRejectedValue(new Error('Network error'))
    mockApiLogin.mockResolvedValue({ username: 'admin', message: 'ok' })

    const auth = useAuthStore()
    await auth.login('admin', 'pass')
    expect(auth.authenticated).toBe(true)

    // store.logout() doesn't catch the api rejection, so we need to catch it
    await expect(auth.logout()).rejects.toThrow('Network error')

    // Even if API fails, local state should be cleared (finally block)
    expect(auth.authenticated).toBe(false)
    expect(auth.username).toBe('')
  })

  it('loading 初始為 true，init 完成後為 false', async () => {
    mockCheckSession.mockResolvedValue({ authenticated: true, username: 'admin' })

    const auth = useAuthStore()
    expect(auth.loading).toBe(true)

    await auth.init()

    expect(auth.loading).toBe(false)
  })

  it('isLoggedIn computed 反映 authenticated 狀態', async () => {
    mockCheckSession.mockResolvedValue({ authenticated: true, username: 'admin' })

    const auth = useAuthStore()
    expect(auth.isLoggedIn).toBe(false)

    await auth.init()
    expect(auth.isLoggedIn).toBe(true)
  })
})
