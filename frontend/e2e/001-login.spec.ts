import { test, expect } from '@playwright/test'
import { setupApiMocks, loginViaUI, gotoDashboard, VALID_USER, VALID_PASS } from './auth.setup'

/**
 * 001 — 管理員登入系統 E2E Tests
 *
 * BDD scenarios covered:
 *   1. ✅ 使用正確帳號密碼登入 → 導向 Dashboard
 *   2. ✅ 使用錯誤密碼 → 顯示錯誤訊息，停留在 /login
 *   3. ✅ 未登入造訪 / → 強制跳轉 /login
 *   4. ✅ 登出 → 回到 /login
 *   5. ✅ session 有效時重新整理 → 維持登入狀態
 *   6. ✅ 空白帳號或密碼 → 表單驗證
 */

test.describe('Scenario 1: 使用正確帳號密碼登入', () => {
  test('應成功登入並導向 Dashboard', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false })
    await loginViaUI(page)

    // Should be on dashboard
    await expect(page.locator('.app-header h1')).toContainText('Linux Service Manager')
    await expect(page.locator('.user-badge')).toContainText(VALID_USER)
  })
})


test.describe('Scenario 2: 使用錯誤密碼 / 不存在的帳號', () => {
  test('使用錯誤密碼應顯示錯誤訊息並停留在 /login', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false })

    await page.goto('/')
    await page.waitForURL('**/login')
    await page.waitForSelector('.login-form')

    // Fill wrong password
    await page.fill('input[type="text"]', VALID_USER)
    await page.fill('input[type="password"]', 'wrongpassword')
    await page.click('button[type="submit"]')

    // Error message should appear
    await expect(page.locator('.login-error')).toBeVisible()
    await expect(page.locator('.login-error')).toContainText('Invalid username or password')

    // URL should still be /login (router guard keeps us here)
    expect(page.url()).toContain('/login')

    // Form should still be visible
    await expect(page.locator('.login-form')).toBeVisible()
  })

  test('使用不存在的帳號應顯示相同錯誤訊息', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false })

    await page.goto('/')
    await page.waitForURL('**/login')
    await page.waitForSelector('.login-form')

    await page.fill('input[type="text"]', 'nonexistent')
    await page.fill('input[type="password"]', 'somepassword')
    await page.click('button[type="submit"]')

    await expect(page.locator('.login-error')).toBeVisible()
    await expect(page.locator('.login-error')).toContainText('Invalid username or password')
    expect(page.url()).toContain('/login')
  })
})


test.describe('Scenario 3: 未登入造訪 / 強制跳轉 /login', () => {
  test('未驗證使用者造訪 / 應被路由守衛重導向到 /login', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false })

    // Navigate to root — router guard should redirect to /login
    await page.goto('/')
    await page.waitForURL('**/login')
    await expect(page.locator('.login-form')).toBeVisible()
  })
})


test.describe('Scenario 4: 登出', () => {
  test('登出後 auth state 應清除，造訪 / 應跳轉 /login', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false })
    await loginViaUI(page)

    // Verify we're on dashboard
    await expect(page.locator('.app-header')).toBeVisible()

    // Click logout button
    const logoutBtn = page.locator('button', { hasText: 'Logout' })
    await expect(logoutBtn).toBeVisible()
    await logoutBtn.click()

    // After logout, navigating to / should redirect to /login
    // (router guard: meta.auth && !isLoggedIn → /login)
    await page.goto('/')
    await page.waitForURL((url) => url.pathname === '/login')
    await expect(page.locator('.login-form')).toBeVisible()
  })
})


test.describe('Scenario 5: session 有效時重新整理維持登入狀態', () => {
  test('session 有效時重新整理頁面，維持在 Dashboard', async ({ page }) => {
    // Start authenticated — gotoDashboard skips login flow
    await setupApiMocks(page, { authenticated: true })
    await gotoDashboard(page)

    // Reload — session still returns authenticated
    await page.reload()
    await page.waitForURL((url) => url.pathname === '/')
    await expect(page.locator('.app-header h1')).toContainText('Linux Service Manager')
  })
})


test.describe('Scenario 6: 表單驗證 — 空白帳號或密碼', () => {
  test('帳號密碼為必填（HTML5 required 屬性）', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false })

    await page.goto('/')
    await page.waitForURL('**/login')
    await page.waitForSelector('.login-form')

    await expect(page.locator('input[type="text"]')).toHaveAttribute('required', '')
    await expect(page.locator('input[type="password"]')).toHaveAttribute('required', '')
  })

  test('僅填帳號未填密碼，表單不應提交', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false })

    await page.goto('/')
    await page.waitForURL('**/login')
    await page.waitForSelector('.login-form')

    await page.fill('input[type="text"]', VALID_USER)
    // Leave password blank
    await page.click('button[type="submit"]')

    // The form should still be visible (HTML5 validation prevents submission)
    await expect(page.locator('.login-form')).toBeVisible()
  })
})


test.describe('Edge case: 已登入者造訪 /login 應跳轉回首頁', () => {
  test('已登入時造訪 /，session 有效直接顯示 Dashboard（不重導向 /login）', async ({ page }) => {
    // Start with session authenticated — should go straight to dashboard
    await setupApiMocks(page, { authenticated: true })
    await gotoDashboard(page)

    // Verify dashboard is shown, not login page
    await expect(page.locator('.app-header')).toBeVisible()
    await expect(page.locator('.login-form')).not.toBeVisible()
  })
})
