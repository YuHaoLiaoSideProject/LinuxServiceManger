import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRouter, createMemoryHistory } from 'vue-router'
import { createPinia, setActivePinia } from 'pinia'
import { useAuthStore } from '../stores/auth'

// Mock the API client used by auth store
vi.mock('../api/client', () => ({
  checkSession: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
}))

// Simple stub components for routing
const LoginStub = { template: '<div class="login-page">Login Page</div>' }
const DashboardStub = { template: '<div class="dashboard-page">Dashboard</div>' }
const AuditStub = { template: '<div class="audit-page">Audit Log</div>' }

function createTestRouter() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/login', name: 'login', component: LoginStub, meta: { guest: true } },
      { path: '/', name: 'dashboard', component: DashboardStub, meta: { auth: true } },
      { path: '/audit', name: 'audit', component: AuditStub, meta: { auth: true } },
    ],
  })

  // Replicate the actual beforeEach guard from router/index.ts
  router.beforeEach((to, _from, next) => {
    const auth = useAuthStore()

    if (auth.loading) {
      const unwatch = setInterval(() => {
        if (!auth.loading) {
          clearInterval(unwatch)
          proceed()
        }
      }, 50)
      return
    }
    proceed()

    function proceed() {
      if (to.meta.auth && !auth.isLoggedIn) {
        next('/login')
      } else if (to.meta.guest && auth.isLoggedIn) {
        next('/')
      } else {
        next()
      }
    }
  })

  return router
}

describe('Router 路由守衛', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('未登入造訪 / → 跳轉 /login', async () => {
    const router = createTestRouter()
    const auth = useAuthStore()

    // Simulate: init already done, not authenticated
    auth.loading = false
    auth.authenticated = false

    await router.push('/')
    await router.isReady()

    expect(router.currentRoute.value.path).toBe('/login')
  })

  it('已登入造訪 /login → 跳轉 /', async () => {
    const router = createTestRouter()
    const auth = useAuthStore()

    // Simulate: init already done, authenticated
    auth.loading = false
    auth.authenticated = true
    auth.username = 'admin'

    await router.push('/login')
    await router.isReady()

    expect(router.currentRoute.value.path).toBe('/')
  })

  it('已登入造訪 / → 正常顯示', async () => {
    const router = createTestRouter()
    const auth = useAuthStore()

    auth.loading = false
    auth.authenticated = true
    auth.username = 'admin'

    await router.push('/')
    await router.isReady()

    expect(router.currentRoute.value.path).toBe('/')
  })

  it('未登入造訪 /login → 正常顯示', async () => {
    const router = createTestRouter()
    const auth = useAuthStore()

    auth.loading = false
    auth.authenticated = false

    await router.push('/login')
    await router.isReady()

    expect(router.currentRoute.value.path).toBe('/login')
  })

  it('auth.loading 時等待初始化，完成後再判斷', async () => {
    // This test verifies the loading guard pattern
    const router = createTestRouter()
    const auth = useAuthStore()

    // Start with loading=true
    auth.loading = true
    auth.authenticated = false

    // Try to navigate while loading
    const navPromise = router.push('/')

    // Still loading, route shouldn't have changed yet
    await new Promise(r => setTimeout(r, 10))
    expect(auth.loading).toBe(true)

    // Complete loading - user is authenticated, should go to /
    auth.authenticated = true
    auth.username = 'admin'
    auth.loading = false

    await navPromise
    await router.isReady()

    expect(router.currentRoute.value.path).toBe('/')
  })

  // -- Audit route guard (009) ----------------------------------------

  it('F-RT-01: 未登入造訪 /audit → 跳轉 /login', async () => {
    const router = createTestRouter()
    const auth = useAuthStore()

    auth.loading = false
    auth.authenticated = false

    await router.push('/audit')
    await router.isReady()

    expect(router.currentRoute.value.path).toBe('/login')
  })

  it('F-RT-02: 已登入造訪 /audit → 正常顯示', async () => {
    const router = createTestRouter()
    const auth = useAuthStore()

    auth.loading = false
    auth.authenticated = true
    auth.username = 'admin'

    await router.push('/audit')
    await router.isReady()

    expect(router.currentRoute.value.path).toBe('/audit')
  })
})
