import { test, expect } from '@playwright/test'
import { setupApiMocks, loginViaUI, toggleLang, toggleTheme } from './auth.setup'

/**
 * 003 — 主題與多語言 E2E Tests
 *
 * Scenarios:
 *   1. ✅ 切換語言 zh-TW ↔ en — 驗證 UI 文字改變
 *   2. ✅ 切換深色/淺色主題 — 驗證 data-theme 屬性
 *   3. ✅ 語言偏好持久化 — localStorage 儲存
 *   4. ✅ 主題偏好持久化 — localStorage 儲存
 *   5. ✅ 登入頁面多語言
 *   6. ✅ 分頁標籤偏好持久化
 */

test.describe('語言切換 zh-TW ↔ en', () => {
  test('預設語言為 en（瀏覽器 locale en-US），介面顯示英文', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    await expect(page.locator('.stats-bar')).toContainText('All')
    await expect(page.locator('.stats-bar')).toContainText('Running')

    const searchInput = page.locator('.search-wrap input[type="search"]')
    await expect(searchInput).toHaveAttribute('placeholder', 'Search services...')

    await expect(page.locator('#tab-my')).toContainText('My Services')
    await expect(page.locator('#tab-system')).toContainText('System Services')
  })

  test('切換到繁體中文後，UI 文字應改變', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    // Click language toggle (🌐 button)
    await toggleLang(page)

    await expect(page.locator('.stats-bar')).toContainText('全部')
    await expect(page.locator('.stats-bar')).toContainText('執行中')

    const searchInput = page.locator('.search-wrap input[type="search"]')
    await expect(searchInput).toHaveAttribute('placeholder', '搜尋服務名稱...')

    await expect(page.locator('#tab-my')).toContainText('我的服務')
    await expect(page.locator('#tab-system')).toContainText('系統服務')
  })

  test('可從英文切到中文再切回英文', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    // en → zh-TW
    await toggleLang(page)
    await expect(page.locator('.stats-bar')).toContainText('全部')

    // zh-TW → en
    await toggleLang(page)
    await expect(page.locator('.stats-bar')).toContainText('All')
  })

  test('登入頁支援預設英文，登入後切換中文可看到語言改變', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })

    // Login page shows in English (browser locale en-US)
    await page.goto('/')
    await page.waitForURL((url) => url.pathname === '/login')
    await page.waitForSelector('.login-form')

    await expect(page.locator('.login-form h2')).toHaveText('Linux Service Manager')
    await expect(page.locator('.login-form .login-subtitle')).toContainText('Sign in to manage')
    await expect(page.locator('button[type="submit"]')).toContainText('Sign In')

    // Login and verify dashboard loads
    await page.fill('input[type="text"]', 'admin')
    await page.fill('input[type="password"]', 'admin123')
    await page.click('button[type="submit"]')
    await page.waitForURL((url) => url.pathname === '/')
    // 014 決策 8：登入預設導向 /（Aggregate）；語言切換需在單機 Dashboard（/dashboard）操作
    await page.goto('/dashboard')
    await page.waitForSelector('.app-header')

    // Dashboard shows English
    await expect(page.locator('.stats-bar')).toContainText('All')

    // Switch to Chinese from dashboard
    await toggleLang(page)
    await expect(page.locator('.stats-bar')).toContainText('全部')
  })
})


test.describe('主題切換 深色/淺色', () => {
  test('預設主題為 light，data-theme 屬性為 light', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  })

  test('切換到深色主題，data-theme 變為 dark', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    await toggleTheme(page)

    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  })

  test('從深色切回淺色', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    await toggleTheme(page)
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')

    await toggleTheme(page)
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  })
})


test.describe('偏好持久化 (localStorage)', () => {
  test('語言偏好應儲存在 localStorage', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    // Switch to zh-TW — this writes to localStorage
    await toggleLang(page)

    const lang = await page.evaluate(() => localStorage.getItem('lms-lang'))
    expect(lang).toBe('zh-TW')

    // Switch back to en
    await toggleLang(page)
    const lang2 = await page.evaluate(() => localStorage.getItem('lms-lang'))
    expect(lang2).toBe('en')
  })

  test('主題偏好應儲存在 localStorage', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    let theme = await page.evaluate(() => localStorage.getItem('lms-theme'))
    expect(theme).toBe('light')

    await toggleTheme(page)

    theme = await page.evaluate(() => localStorage.getItem('lms-theme'))
    expect(theme).toBe('dark')
  })

  test('重新整理後語言偏好應維持', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    // Switch to zh-TW
    await toggleLang(page)
    await expect(page.locator('.stats-bar')).toContainText('全部')

    // Reload — session mock uses dynamic state, survives reload
    await page.reload()
    await page.waitForURL((url) => url.pathname === '/dashboard')
    await page.waitForSelector('.app-header')

    // Should still be in zh-TW (loaded from localStorage)
    await expect(page.locator('.stats-bar')).toContainText('全部')
  })

  test('重新整理後主題偏好應維持', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    // Switch to dark
    await toggleTheme(page)
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')

    // Reload — session mock survives, so dashboard loads directly
    await page.reload()
    await page.waitForURL((url) => url.pathname === '/dashboard')
    await page.waitForSelector('.app-header')

    // Should still be dark (loaded from localStorage)
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  })

  test('分頁選擇應儲存在 localStorage', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    // Click system tab — this writes to localStorage
    await page.locator('#tab-system').click()

    const tab = await page.evaluate(() => localStorage.getItem('lms-tab'))
    expect(tab).toBe('system')

    // Click my tab
    await page.locator('#tab-my').click()
    const tab2 = await page.evaluate(() => localStorage.getItem('lms-tab'))
    expect(tab2).toBe('my')
  })
})
