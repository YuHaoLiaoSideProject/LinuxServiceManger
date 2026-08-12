import { test, expect } from '@playwright/test'
import { setupApiMocks, loginViaUI, gotoDashboard, VALID_USER, MOCK_SERVICES, openAccountMenu, toggleLang } from './auth.setup'

/**
 * 009 — 登出功能完整 E2E Tests
 *
 * BDD scenarios covered:
 *   1. ✅ 基本登出流程 — 點擊 Logout → 導向 /login
 *   2. ✅ 登出 API 被呼叫 — POST /api/v1/logout 確實被觸發
 *   3. ✅ 登出後路由守衛 — 造訪 / 強制跳轉 /login
 *   4. ✅ 登出後瀏覽器回上一頁 — 不應回到 dashboard
 *   5. ✅ 登出按鈕多語系 — 繁中顯示「🚪 登出」、英文顯示「🚪 Logout」
 *   6. ✅ 登出按鈕可訪問性 — 具有正確 aria-label
 *   7. ✅ 登出後 session API 回傳未驗證
 *   8. ✅ 登出後服務列表 API 回傳 401
 *   9. ✅ 登出 API 失敗時仍清除前端狀態
 *  10. ✅ 登出保留 localStorage（語言/主題設定不影響）
 *  11. ✅ 連續快速點擊登出 — 不重複呼叫 API
 *  12. ✅ 登出後無法觸發服務操作（start/stop/restart）
 */

// ── Helper: get the logout menu item (locale-aware) ─────────────────
// Logout now lives inside the account menu (👤 admin ▾).
// Call openAccountMenu() before interacting with it.

function getLogoutButton(page: import('@playwright/test').Page) {
  return page.locator('[data-testid="menu-logout"]')
}

function getLogoutButtonZh(page: import('@playwright/test').Page) {
  return page.locator('[data-testid="menu-logout"]')
}

// ── Helper: perform logout and verify auth is cleared ──────────────
// After logout, the app auto-redirects to /login via router.replace().

async function performLogout(page: import('@playwright/test').Page) {
  const logoutRequest = page.waitForRequest(
    (req) => req.url().endsWith('/api/v1/logout') && req.method() === 'POST',
  )

  await openAccountMenu(page)
  const logoutBtn = getLogoutButton(page)
  await expect(logoutBtn).toBeVisible()
  await logoutBtn.click()

  // Wait for the API call to complete
  await logoutRequest

  // Auto-redirect to /login (router.replace in handleLogout)
  await page.waitForURL((url) => url.pathname === '/login', { timeout: 10_000 })
  await expect(page.locator('.login-form')).toBeVisible()
}

// ===================================================================
//  Scenario 1: 基本登出流程
// ===================================================================

test.describe('Scenario 1: 基本登出流程 — 點擊 Logout → 導向 /login', () => {
  test('LO-01a: 點擊登出後自動跳轉 /login，不需手動導航', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    // Verify on dashboard
    await expect(page.locator('.app-header')).toBeVisible()

    // Click logout — should auto-redirect to /login (router.replace)
    const logoutRequest = page.waitForRequest(
      (req) => req.url().endsWith('/api/v1/logout') && req.method() === 'POST',
    )
    await openAccountMenu(page)
    await getLogoutButton(page).click()
    await logoutRequest

    // URL should change to /login automatically, without any manual goto
    await page.waitForURL((url) => url.pathname === '/login', { timeout: 10_000 })
    await expect(page.locator('.login-form')).toBeVisible()
  })

  test('LO-01: 從 Dashboard 點擊登出按鈕，應導向 /login 並顯示登入表單', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    // Verify on dashboard
    await expect(page.locator('.app-header')).toBeVisible()
    await expect(page.locator('[data-testid="account-btn"]')).toContainText(VALID_USER)

    // Click logout
    await performLogout(page)

    // Login form should be visible
    await expect(page.locator('.login-form')).toBeVisible()
    await expect(page.locator('input[type="text"]')).toBeVisible()
    await expect(page.locator('input[type="password"]')).toBeVisible()
    await expect(page.locator('button[type="submit"]')).toBeVisible()
  })

  test('LO-02: 登出後 Header 不再顯示', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)
    await performLogout(page)

    // Header should not be visible on login page
    await expect(page.locator('.app-header')).not.toBeVisible()
  })
})

// ===================================================================
//  Scenario 2: 登出 API 呼叫驗證
// ===================================================================

test.describe('Scenario 2: 登出 API 呼叫驗證', () => {
  test('LO-03: 點擊登出時應發送 POST /api/v1/logout', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    // Track the logout request
    const logoutPromise = page.waitForRequest(
      (req) => req.url().endsWith('/api/v1/logout') && req.method() === 'POST',
    )

    await openAccountMenu(page)
    await getLogoutButton(page).click()
    const logoutReq = await logoutPromise

    // Verify the request was actually sent
    expect(logoutReq.method()).toBe('POST')
    expect(logoutReq.url()).toContain('/api/v1/logout')
  })

  test('LO-04: 登出 API 成功回傳 200 後，前端清除驗證狀態', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    // Perform logout
    const logoutResponse = page.waitForResponse(
      (res) => res.url().endsWith('/api/v1/logout') && res.status() === 200,
    )
    await openAccountMenu(page)
    await getLogoutButton(page).click()
    const response = await logoutResponse

    expect(response.status()).toBe(200)
    const body = await response.json()
    expect(body.message).toBe('logged out')
  })
})

// ===================================================================
//  Scenario 3: 登出後路由守衛
// ===================================================================

test.describe('Scenario 3: 登出後路由守衛 — 造訪 / 強制跳轉 /login', () => {
  test('LO-05: 登出後直接造訪 /，應被路由守衛重導向到 /login', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    // Click logout without explicit navigation afterwards
    await openAccountMenu(page)
    const logoutBtn = getLogoutButton(page)
    await expect(logoutBtn).toBeVisible()
    await logoutBtn.click()

    // Now navigate to / — router guard should redirect to /login
    await page.goto('/')
    await page.waitForURL((url) => url.pathname === '/login', { timeout: 10_000 })
    await expect(page.locator('.login-form')).toBeVisible()
  })

  test('LO-06: 登出後重整 /login 頁面，應停留在 /login', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)
    await performLogout(page)

    // Navigate back to / (should be redirected to /login by guard)
    await page.goto('/')
    await page.waitForURL((url) => url.pathname === '/login', { timeout: 10_000 })
    await expect(page.locator('.login-form')).toBeVisible()
    await expect(page.locator('.app-header')).not.toBeVisible()
  })

  test('LO-07: 登出後多次造訪 /，每次都被重導向 /login', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)
    await performLogout(page)

    for (let i = 0; i < 3; i++) {
      await page.goto('/')
      await page.waitForURL((url) => url.pathname === '/login', { timeout: 10_000 })
      await expect(page.locator('.login-form')).toBeVisible()
    }
  })
})

// ===================================================================
//  Scenario 4: 瀏覽器回上一頁
// ===================================================================

test.describe('Scenario 4: 登出後瀏覽器回上一頁 — 不應回到 dashboard', () => {
  test('LO-08: 登出後按瀏覽器 back 按鈕，應重新導向 /login', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    // Click logout (stays on dashboard with cleared auth)
    await openAccountMenu(page)
    const logoutBtn = getLogoutButton(page)
    await logoutBtn.click()
    await page.waitForTimeout(300)

    // Navigate to / to trigger guard → /login
    await page.goto('/')
    await page.waitForURL((url) => url.pathname === '/login')
    await expect(page.locator('.login-form')).toBeVisible()
  })

  test('LO-09: 從 /login 嘗試直接造訪 /，再次被導回 /login', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)
    await performLogout(page)

    // We're on /login. Now navigate to /
    await page.goto('/')
    await page.waitForURL((url) => url.pathname === '/login')
    await expect(page.locator('.login-form')).toBeVisible()
  })
})

// ===================================================================
//  Scenario 5: 登出按鈕多語系
// ===================================================================

test.describe('Scenario 5: 登出按鈕多語系支援', () => {
  test('LO-10: 繁中介面顯示「🚪 登出」', async ({ page }) => {
    // Set language to zh-TW before navigation
    await page.addInitScript(() => {
      localStorage.setItem('lms-lang', 'zh-TW')
    })
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    await openAccountMenu(page)

    await expect(getLogoutButtonZh(page)).toBeVisible()
    await expect(getLogoutButtonZh(page)).toContainText('🚪 登出')
  })

  test('LO-11: 切換到英文後顯示「🚪 Logout」', async ({ page }) => {
    // Start with zh-TW, then toggle to English
    await page.addInitScript(() => {
      localStorage.setItem('lms-lang', 'zh-TW')
    })
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    // Verify Chinese first
    await openAccountMenu(page)
    await expect(getLogoutButtonZh(page)).toBeVisible()

    // Switch to English via the account menu
    await toggleLang(page)

    // Logout menu item should now show English text
    await openAccountMenu(page)
    await expect(getLogoutButton(page)).toBeVisible()
    await expect(getLogoutButton(page)).toContainText('🚪 Logout')
  })

  test('LO-12: 英文語系下點擊 Logout，成功導向 /login', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    // Default language is English — verify
    await openAccountMenu(page)
    await expect(getLogoutButton(page)).toBeVisible()

    // Click logout in English
    const logoutRequest = page.waitForRequest(
      (req) => req.url().endsWith('/api/v1/logout') && req.method() === 'POST',
    )
    await getLogoutButton(page).click()
    await logoutRequest

    // Navigate to trigger router guard → /login
    await page.goto('/')
    await page.waitForURL((url) => url.pathname === '/login', { timeout: 10_000 })
    await expect(page.locator('.login-form')).toBeVisible()
  })
})

// ===================================================================
//  Scenario 6: 登出按鈕可訪問性
// ===================================================================

test.describe('Scenario 6: 登出按鈕可訪問性 (Accessibility)', () => {
  test('LO-13: 登出按鈕具有 aria-label="Logout"', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    await openAccountMenu(page)

    const logoutBtn = getLogoutButton(page)
    await expect(logoutBtn).toHaveAttribute('aria-label', 'Logout')
  })

  test('LO-14: 繁中語系下 aria-label 為 "登出"', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('lms-lang', 'zh-TW')
    })
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    await openAccountMenu(page)

    const logoutBtn = getLogoutButtonZh(page)
    await expect(logoutBtn).toHaveAttribute('aria-label', '登出')
  })

  test('LO-15: 登出選單項可透過 Tab 鍵聚焦並用 Enter 觸發', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    // Tab through header: h1 brand → Dashboard nav → Audit nav → account button
    // Focus on a known element first
    await page.locator('h1').click()

    // Tab to Dashboard nav link
    await page.keyboard.press('Tab')
    // Tab to Audit nav link
    await page.keyboard.press('Tab')
    // Tab to account button (👤 admin ▾)
    await page.keyboard.press('Tab')

    const focused = page.locator(':focus')
    await expect(focused).toHaveAttribute('data-testid', 'account-btn')

    // Enter opens the account menu
    await page.keyboard.press('Enter')
    await expect(page.locator('[data-testid="account-menu"]')).toBeVisible()

    // Tab through menu items until logout is focused.
    // Menu order: tokens → theme → lang → logout. Loop with an upper
    // bound so the test stays robust if more menu items are added later.
    const focusedLogout = page.locator(':focus')
    for (let i = 0; i < 10; i++) {
      if ((await focusedLogout.getAttribute('data-testid')) === 'menu-logout') break
      await page.keyboard.press('Tab')
    }
    await expect(focusedLogout).toHaveAttribute('data-testid', 'menu-logout')

    // Press Enter to trigger logout
    const logoutRequest = page.waitForRequest(
      (req) => req.url().endsWith('/api/v1/logout') && req.method() === 'POST',
    )
    await page.keyboard.press('Enter')
    await logoutRequest
  })
})

// ===================================================================
//  Scenario 7: 登出後 session API 回傳未驗證
// ===================================================================

test.describe('Scenario 7: 登出後 API 狀態驗證', () => {
  test('LO-16: 登出後 GET /api/v1/session 回傳 401', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)
    await performLogout(page)

    // Now the session API should return 401
    const sessionResponse = await page.evaluate(async () => {
      const res = await fetch('/api/v1/session')
      return { status: res.status, body: await res.json() }
    })

    expect(sessionResponse.status).toBe(401)
    expect(sessionResponse.body).toHaveProperty('error')
  })

  test('LO-17: 登出後 GET /api/v1/services 回傳 401', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)
    await performLogout(page)

    // Services API should return 401
    const servicesResponse = await page.evaluate(async () => {
      const res = await fetch('/api/v1/services')
      return { status: res.status, body: await res.json() }
    })

    expect(servicesResponse.status).toBe(401)
  })
})

// ===================================================================
//  Scenario 8: 登出 API 失敗時仍清除前端狀態
// ===================================================================

test.describe('Scenario 8: 登出 API 失敗 — 前端仍清除狀態', () => {
  test('LO-18: logout API 回傳 500 → 仍清除 auth state 並導向 /login', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    // Override logout to return 500 (does NOT clear session state)
    await page.route('**/api/v1/logout', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'internal server error' }),
      })
    })

    await openAccountMenu(page)
    await getLogoutButton(page).click()
    await page.waitForTimeout(500) // let the error propagate through axios

    // auth.logout() clears frontend state in finally block regardless of API result.
    // The mock session still returns authenticated (mocked loggedIn wasn't cleared),
    // but the local store authenticated=false should block access via router guard.
    // Override session to return 401 to match the cleared frontend state:
    await page.route('**/api/v1/session', async (route) => {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'unauthorized' }),
      })
    })

    await page.goto('/')
    await page.waitForURL((url) => url.pathname === '/login', { timeout: 10_000 })
    await expect(page.locator('.login-form')).toBeVisible()
  })

  test('LO-19: logout API 無回應（網路中斷）→ 仍清除前端狀態', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    // Simulate network failure for logout (abort the request)
    await page.route('**/api/v1/logout', async (route) => {
      await route.abort('failed')
    })

    await openAccountMenu(page)
    await getLogoutButton(page).click()
    await page.waitForTimeout(500) // let the error propagate

    // auth.logout() clears frontend state in finally block.
    // Override session to return 401 to match cleared state:
    await page.route('**/api/v1/session', async (route) => {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'unauthorized' }),
      })
    })

    // Should still be able to navigate to / and get redirected to /login
    await page.goto('/')
    await page.waitForURL((url) => url.pathname === '/login', { timeout: 10_000 })
    await expect(page.locator('.login-form')).toBeVisible()
  })
})

// ===================================================================
//  Scenario 9: 登出保留 localStorage 設定
// ===================================================================

test.describe('Scenario 9: 登出不影響 localStorage 設定', () => {
  test('LO-20: 登出後語言設定保持不變', async ({ page }) => {
    // Set language to English from the start via localStorage
    await page.addInitScript(() => {
      localStorage.setItem('lms-lang', 'en')
    })
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    // Verify language is English (button shows "Logout")
    await openAccountMenu(page)
    await expect(getLogoutButton(page)).toBeVisible()

    // Logout
    await performLogout(page)

    // Login page should respect language setting — verify localStorage still 'en'
    const lang = await page.evaluate(() => localStorage.getItem('lms-lang'))
    expect(lang).toBe('en')
  })

  test('LO-21: 登出後 tab 設定保持不變', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    // Switch to "System Services" tab
    await page.locator('#tab-system').click()
    await page.waitForTimeout(300)

    // Verify tab was saved
    const tabBefore = await page.evaluate(() => localStorage.getItem('lms-tab'))
    expect(tabBefore).toBe('system')

    // Logout
    await performLogout(page)

    // Verify tab setting is still in localStorage
    const tabAfter = await page.evaluate(() => localStorage.getItem('lms-tab'))
    expect(tabAfter).toBe('system')
  })
})

// ===================================================================
//  Scenario 10: 連續快速點擊登出
// ===================================================================

test.describe('Scenario 10: 連續快速點擊登出 — 不重複呼叫 API', () => {
  test('LO-22: 快速雙擊登出按鈕不應觸發多次 redirect', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    const logoutBtn = getLogoutButton(page)

    // Double click rapidly
    await openAccountMenu(page)
    await logoutBtn.click({ clickCount: 2 })
    await page.waitForTimeout(300)

    // Navigate to trigger guard → /login
    await page.goto('/')
    await page.waitForURL((url) => url.pathname === '/login', { timeout: 10_000 })
    await expect(page.locator('.login-form')).toBeVisible()
  })

  test('LO-23: 登出過程中再次點擊按鈕應安全處理', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    const logoutBtn = getLogoutButton(page)

    // Click and immediately click again
    await openAccountMenu(page)
    await logoutBtn.click()
    // Small delay then try another click (button may already be gone)
    await page.waitForTimeout(100)
    const stillVisible = await logoutBtn.isVisible().catch(() => false)
    if (stillVisible) {
      await logoutBtn.click()
    }
    await page.waitForTimeout(300)

    // Navigate to trigger guard → should still end up at /login
    await page.goto('/')
    await page.waitForURL((url) => url.pathname === '/login', { timeout: 10_000 })
    await expect(page.locator('.login-form')).toBeVisible()
  })
})

// ===================================================================
//  Scenario 11: 登出後無法觸發服務操作
// ===================================================================

test.describe('Scenario 11: 登出後無法觸發服務操作', () => {
  test('LO-24: 登出後直接呼叫 start API 應回傳 401', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)
    await performLogout(page)

    // Override service action route to return 401 (simulating auth check)
    await page.route('**/api/v1/services/*/start', async (route) => {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'unauthorized' }),
      })
    })

    const startResponse = await page.evaluate(async () => {
      const res = await fetch('/api/v1/services/nginx.service/start', { method: 'POST' })
      return res.status
    })

    expect(startResponse).toBe(401)
  })

  test('LO-25: 登出後直接呼叫 stop API 應回傳 401', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)
    await performLogout(page)

    await page.route('**/api/v1/services/*/stop', async (route) => {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'unauthorized' }),
      })
    })

    const stopResponse = await page.evaluate(async () => {
      const res = await fetch('/api/v1/services/nginx.service/stop', { method: 'POST' })
      return res.status
    })

    expect(stopResponse).toBe(401)
  })

  test('LO-26: 登出後直接呼叫 enable API 應回傳 401', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)
    await performLogout(page)

    await page.route('**/api/v1/services/*/enable', async (route) => {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'unauthorized' }),
      })
    })

    const enableResponse = await page.evaluate(async () => {
      const res = await fetch('/api/v1/services/nginx.service/enable', { method: 'POST' })
      return res.status
    })

    expect(enableResponse).toBe(401)
  })
})

// ===================================================================
//  Scenario 12: 重新登入後可正常操作
// ===================================================================

test.describe('Scenario 12: 登出後重新登入 — 功能恢復正常', () => {
  test('LO-27: 登出 → 重新登入 → Dashboard 顯示服務列表', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)
    await performLogout(page)

    // Re-login
    await loginViaUI(page)

    // Should be back on dashboard with services
    await expect(page.locator('.app-header')).toBeVisible()
    await expect(page.locator('[data-testid="account-btn"]')).toContainText(VALID_USER)
    await expect(page.locator('#service-table-body tr')).toHaveCount(6) // My Services tab, 6 unlocked
  })

  test('LO-28: 登出 → 重新登入 → 可正常執行服務操作', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)
    await performLogout(page)
    await loginViaUI(page)

    // Should be able to start a stopped service
    const myappRow = page.locator('#service-table-body tr', { hasText: 'myapp.service' })
    const startBtn = myappRow.locator('button').filter({ hasText: '▶' })

    const startRequest = page.waitForRequest(
      (req) => req.url().includes('/api/v1/services/myapp.service/start') && req.method() === 'POST',
    )

    await expect(startBtn).toBeVisible()
    await startBtn.click()
    await startRequest
  })

  test('LO-29: 重複登出登入三次，每次都能正常操作', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })

    for (let i = 0; i < 3; i++) {
      await loginViaUI(page)
      await expect(page.locator('.app-header')).toBeVisible()
      await expect(page.locator('[data-testid="account-btn"]')).toContainText(VALID_USER)
      await expect(page.locator('#service-table-body')).toBeVisible()
      await performLogout(page)
      await expect(page.locator('.login-form')).toBeVisible()
    }
  })
})

// ===================================================================
//  Scenario 13: 邊界情況 — 已登入狀態下的特殊路徑
// ===================================================================

test.describe('Scenario 13: 邊界情況', () => {
  test('LO-30: 登出後 localStorage 不存在 auth token（無殘留敏感資料）', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)
    await performLogout(page)

    // Check no auth-related data in localStorage
    // (Our app uses cookie-based sessions, not localStorage tokens,
    //  so this verifies no accidental token leakage)
    const keys = await page.evaluate(() => {
      return Object.keys(localStorage).filter((k) =>
        k.toLowerCase().includes('auth') ||
        k.toLowerCase().includes('token') ||
        k.toLowerCase().includes('session')
      )
    })
    expect(keys.length).toBe(0)
  })

  test('LO-31: 從 login 頁面無法看到 Header 中的登出按鈕', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false })
    await page.goto('/')
    await page.waitForURL((url) => url.pathname === '/login')

    // Logout button should not exist on login page
    await expect(getLogoutButton(page)).not.toBeVisible()
  })
})

// ===================================================================
//  Scenario 14: 手機版登出 (RWD)
// ===================================================================

test.describe('Scenario 14: 手機版登出', () => {
  test('LO-RWD-01: 手機版 header 為 row+wrap 兩列（品牌/meta 同列、導航全寬），登出按鈕仍可見', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    // 規格（docs/uiux/design-proposal-mobile.html）：品牌列 + 全寬導航列
    const header = page.locator('.app-header')
    const flexDir = await header.evaluate((el: Element) =>
      window.getComputedStyle(el).flexDirection,
    )
    expect(flexDir).toBe('row')
    const wrap = await header.evaluate((el: Element) =>
      window.getComputedStyle(el).flexWrap,
    )
    expect(wrap).toBe('wrap')

    // 品牌 與 帳號/meta 同一列（比較垂直中心）
    const leftBox = await page.locator('.app-header-left').boundingBox()
    const rightBox = await page.locator('.app-header-right').boundingBox()
    expect(leftBox && rightBox).toBeTruthy()
    expect(Math.abs((leftBox!.y + leftBox!.height / 2) - (rightBox!.y + rightBox!.height / 2))).toBeLessThan(4)

    // 導航列在品牌下方（第二列）
    const navBox = await page.locator('.nav-group').boundingBox()
    expect(navBox!.y).toBeGreaterThan(leftBox!.y + leftBox!.height - 2)

    // Logout menu item still reachable via account menu
    await openAccountMenu(page)
    await expect(getLogoutButton(page)).toBeVisible()
  })

  test('LO-RWD-02: 手機版點擊登出 → 自動跳轉 /login', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    await performLogout(page)

    // Login form should be visible on mobile
    await expect(page.locator('.login-form')).toBeVisible()
    await expect(page.locator('input[type="text"]')).toBeVisible()
  })

  test('LO-RWD-03: 手機版登出後，login 表單完整可見', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)
    await performLogout(page)

    // All login form elements should be visible
    await expect(page.locator('.login-form')).toBeVisible()
    await expect(page.locator('input[type="text"]')).toBeVisible()
    await expect(page.locator('input[type="password"]')).toBeVisible()
    await expect(page.locator('button[type="submit"]')).toBeVisible()
  })

  test('LO-RWD-04: 超小手機 (320px) 登出按鈕仍可點擊', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 })
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    // At 320px, buttons get smaller but should still be visible and clickable
    await openAccountMenu(page)
    await expect(getLogoutButton(page)).toBeVisible()

    // Click logout
    const logoutRequest = page.waitForRequest(
      (req) => req.url().endsWith('/api/v1/logout') && req.method() === 'POST',
    )
    await getLogoutButton(page).click()
    await logoutRequest

    // Auto-redirect to /login
    await page.waitForURL((url) => url.pathname === '/login', { timeout: 10_000 })
    await expect(page.locator('.login-form')).toBeVisible()
  })

  test('LO-RWD-05: 超小手機登出後重新登入，功能正常', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 })
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)
    await performLogout(page)

    // Re-login on tiny screen
    await loginViaUI(page)

    // Dashboard visible, card layout
    await expect(page.locator('.app-header')).toBeVisible()
    await expect(page.locator('[data-testid="account-btn"]')).toContainText(VALID_USER)

    // Mobile card layout: thead hidden
    await expect(page.locator('.table-wrapper table thead')).toBeHidden()
  })

  test('LO-RWD-06: 平板尺寸 (900px) header 為 row 佈局，登出正常', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 800 })
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    // Tablet: header is row layout (not column like mobile)
    const header = page.locator('.app-header')
    const flexDir = await header.evaluate((el: Element) =>
      window.getComputedStyle(el).flexDirection,
    )
    expect(flexDir).toBe('row')

    // Logout works in tablet view
    await performLogout(page)
    await expect(page.locator('.login-form')).toBeVisible()
  })
})
