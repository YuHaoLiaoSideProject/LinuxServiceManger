import { test, expect } from '@playwright/test'
import { setupApiMocks, loginViaUI, gotoDashboard, getServiceRow } from './auth.setup'

/**
 * 007 — 服務搜尋強化 E2E Tests
 *
 * BDD: docs/bdds/007-service-search-enhancement.feature
 *
 * Custom mock data uses 'running' instead of systemd's 'active' so the
 * useServiceFilter composable (statusFilter === s.active) works correctly.
 */

// ── Custom mock for 007 — active values match status filter keys ──
const MOCK_007 = [
  { name: 'nginx.service',       load: 'loaded', active: 'running',  sub: 'running',  locked: false, unitFileState: 'enabled',  fragmentPath: '/etc/systemd/system/nginx.service' },
  { name: 'apache2.service',     load: 'loaded', active: 'running',  sub: 'running',  locked: false, unitFileState: 'enabled',  fragmentPath: '/etc/systemd/system/apache2.service' },
  { name: 'php-fpm.service',     load: 'loaded', active: 'running',  sub: 'running',  locked: false, unitFileState: 'enabled',  fragmentPath: '/etc/systemd/system/php-fpm.service' },
  { name: 'myapp.service',       load: 'loaded', active: 'inactive', sub: 'dead',     locked: false, unitFileState: 'disabled', fragmentPath: '/etc/systemd/system/myapp.service' },
  { name: 'oldapp.service',      load: 'loaded', active: 'inactive', sub: 'dead',     locked: false, unitFileState: 'disabled', fragmentPath: '/etc/systemd/system/oldapp.service' },
  { name: 'crash.service',       load: 'loaded', active: 'failed',   sub: 'failed',   locked: false, unitFileState: 'disabled', fragmentPath: '/etc/systemd/system/crash.service' },
  { name: 'sshd.service',        load: 'loaded', active: 'running',  sub: 'running',  locked: true,  unitFileState: 'enabled',  fragmentPath: '/usr/lib/systemd/system/sshd.service' },
  { name: 'systemd-logind.service', load: 'loaded', active: 'running', sub: 'running', locked: true, unitFileState: 'static', fragmentPath: '/usr/lib/systemd/system/systemd-logind.service' },
]

// ── Helpers ───────────────────────────────────────────────────────

function statusBtn(label: string) {
  return (page: any) => page.locator('.stats-bar .stat-card', { hasText: label })
}
function searchInput(page: any) { return page.locator('.search-wrap input[type="search"]') }
function regexToggle(page: any) { return page.locator('.btn-regex') }
function searchClear(page: any) { return page.locator('.search-clear') }
function regexErrorEl(page: any) { return page.locator('.regex-error') }
function filteredCountEl(page: any) { return page.locator('.filtered-count') }
function emptyStateEl(page: any) { return page.locator('.empty-state') }
function serviceRows(page: any) { return page.locator('#service-table-body tr') }

async function assertStatusActive(page: any, label: string) {
  await expect(statusBtn(label)(page)).toHaveAttribute('aria-pressed', 'true')
}
async function assertStatusInactive(page: any, label: string) {
  await expect(statusBtn(label)(page)).toHaveAttribute('aria-pressed', 'false')
}

// ===================================================================
// 1. 狀態過濾 Happy Path
// ===================================================================

test.describe('狀態過濾 — 一鍵過濾 Running 服務', () => {
  test('點擊 Running → 列表僅顯示 running 服務', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true, services: MOCK_007 })
    await loginViaUI(page)

    await statusBtn('Running')(page).click()
    await assertStatusActive(page, 'Running')
    await assertStatusInactive(page, 'All')
    await assertStatusInactive(page, 'Failed')
    await assertStatusInactive(page, 'Inactive')

    // Should show only running unlocked services (my tab: nginx, apache2, php-fpm)
    const rows = serviceRows(page)
    await expect(rows).toHaveCount(3)
    await expect(page.locator('#service-table-body')).toContainText('nginx.service')
    await expect(page.locator('#service-table-body')).toContainText('apache2.service')
    await expect(page.locator('#service-table-body')).not.toContainText('myapp.service')
    await expect(page.locator('#service-table-body')).not.toContainText('crash.service')
  })
})

test.describe('狀態過濾 — 一鍵過濾 Failed 服務', () => {
  test('點擊 Failed → 列表僅顯示 failed 服務', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true, services: MOCK_007 })
    await loginViaUI(page)

    await statusBtn('Failed')(page).click()
    await assertStatusActive(page, 'Failed')

    await expect(page.locator('#service-table-body')).toContainText('crash.service')
    await expect(page.locator('#service-table-body')).not.toContainText('nginx.service')
    await expect(page.locator('#service-table-body')).not.toContainText('myapp.service')
  })
})

test.describe('狀態過濾 — 一鍵過濾 Inactive 服務', () => {
  test('點擊 Inactive → 列表僅顯示 inactive 服務', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true, services: MOCK_007 })
    await loginViaUI(page)

    await statusBtn('Inactive')(page).click()
    await assertStatusActive(page, 'Inactive')

    await expect(page.locator('#service-table-body')).toContainText('myapp.service')
    await expect(page.locator('#service-table-body')).toContainText('oldapp.service')
    await expect(page.locator('#service-table-body')).not.toContainText('nginx.service')
  })
})

test.describe('狀態過濾 — 取消過濾', () => {
  test('再次點擊 active 按鈕 → 取消過濾回到 All', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true, services: MOCK_007 })
    await loginViaUI(page)

    // Click Running
    await statusBtn('Running')(page).click()
    await assertStatusActive(page, 'Running')

    // Click Running again → cancel
    await statusBtn('Running')(page).click()
    await assertStatusActive(page, 'All')
    await assertStatusInactive(page, 'Running')

    // Should show all services again
    await expect(page.locator('#service-table-body')).toContainText('myapp.service')
    await expect(page.locator('#service-table-body')).toContainText('crash.service')
  })
})

test.describe('狀態過濾 — 切換不同狀態', () => {
  test('Running → Failed 切換，前一個取消後一個 active', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true, services: MOCK_007 })
    await loginViaUI(page)

    await statusBtn('Running')(page).click()
    await assertStatusActive(page, 'Running')

    await statusBtn('Failed')(page).click()
    await assertStatusInactive(page, 'Running')
    await assertStatusActive(page, 'Failed')

    await expect(page.locator('#service-table-body')).toContainText('crash.service')
    await expect(page.locator('#service-table-body')).not.toContainText('nginx.service')
  })
})

// ===================================================================
// 2. 文字搜尋 Happy Path
// ===================================================================

test.describe('文字搜尋 — 關鍵字即時篩選', () => {
  test('輸入 "nginx" → 僅顯示名稱含 nginx 的服務', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true, services: MOCK_007 })
    await loginViaUI(page)

    const input = searchInput(page)
    await input.fill('nginx')

    // Debounce 150ms — wait a bit
    await page.waitForTimeout(300)

    await expect(page.locator('#service-table-body')).toContainText('nginx.service')
    await expect(page.locator('#service-table-body')).not.toContainText('apache2.service')
    await expect(page.locator('#service-table-body')).not.toContainText('myapp.service')

    // Clear button should appear
    await expect(searchClear(page)).toBeVisible()
  })

  test('清除搜尋 → 恢復完整列表', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true, services: MOCK_007 })
    await loginViaUI(page)

    const input = searchInput(page)
    await input.fill('nginx')
    await page.waitForTimeout(300)

    await searchClear(page).click()

    // Input should be cleared
    await expect(input).toHaveValue('')
    // Full list restored
    await expect(page.locator('#service-table-body')).toContainText('myapp.service')
    await expect(page.locator('#service-table-body')).toContainText('crash.service')
  })
})

// ===================================================================
// 3. 正則搜尋 Happy Path
// ===================================================================

test.describe('正則搜尋 — 開關切換', () => {
  test('點擊正則開關 → ON，placeholder 變更', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true, services: MOCK_007 })
    await loginViaUI(page)

    await regexToggle(page).click()

    await expect(regexToggle(page)).toHaveClass(/active/)
    await expect(searchInput(page)).toHaveAttribute('placeholder', /正則搜尋/)
  })

  test('輸入合法正則 → 篩選匹配服務', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true, services: MOCK_007 })
    await loginViaUI(page)

    await regexToggle(page).click()
    await searchInput(page).fill('nginx.*')
    await page.waitForTimeout(300)

    await expect(page.locator('#service-table-body')).toContainText('nginx.service')
    await expect(page.locator('#service-table-body')).not.toContainText('apache2.service')
  })

  test('關閉正則模式 → 恢復普通搜尋', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true, services: MOCK_007 })
    await loginViaUI(page)

    await regexToggle(page).click()  // ON
    await expect(regexToggle(page)).toHaveClass(/active/)

    await regexToggle(page).click()  // OFF
    await expect(regexToggle(page)).not.toHaveClass(/active/)
    await expect(searchInput(page)).toHaveAttribute('placeholder', /搜尋服務名稱|Search services/)
  })

  test('已有文字時開啟正則 → 立即以正則重新評估', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true, services: MOCK_007 })
    await loginViaUI(page)

    // Type text first in normal mode
    await searchInput(page).fill('nginx')
    await page.waitForTimeout(300)

    // Then enable regex
    await regexToggle(page).click()
    await page.waitForTimeout(300)

    // "nginx" as regex should still match nginx.service
    await expect(page.locator('#service-table-body')).toContainText('nginx.service')
  })
})

// ===================================================================
// 4. 複合過濾
// ===================================================================

test.describe('複合過濾 — 狀態 + 文字交集', () => {
  test('狀態 Running + 文字 "nginx" → 取交集', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true, services: MOCK_007 })
    await loginViaUI(page)

    await statusBtn('Running')(page).click()
    await searchInput(page).fill('nginx')
    await page.waitForTimeout(300)

    // Only nginx.service (running + matches "nginx"), not apache2 (running but no match)
    await expect(page.locator('#service-table-body')).toContainText('nginx.service')
    await expect(page.locator('#service-table-body')).not.toContainText('apache2.service')
    await expect(page.locator('#service-table-body')).not.toContainText('myapp.service')
  })

  test('變更過濾條件 → 立即重新計算交集', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true, services: MOCK_007 })
    await loginViaUI(page)

    // Set initial: Running + nginx
    await statusBtn('Running')(page).click()
    await searchInput(page).fill('php')
    await page.waitForTimeout(300)

    // Should show php-fpm (running + matches "php")
    await expect(page.locator('#service-table-body')).toContainText('php-fpm')

    // Change to Failed — no failed service matches "php"
    await statusBtn('Failed')(page).click()
    await page.waitForTimeout(100)

    // Empty result
    await expect(emptyStateEl(page)).toBeVisible()
    await expect(page.locator('#service-table-body')).toContainText('沒有符合條件的服務')
  })

  test('點擊 All → 清除狀態過濾但保留文字搜尋', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true, services: MOCK_007 })
    await loginViaUI(page)

    await statusBtn('Running')(page).click()
    await searchInput(page).fill('nginx')
    await page.waitForTimeout(300)

    // Only nginx (running + matches)
    await expect(page.locator('#service-table-body')).toContainText('nginx.service')

    // Click All → clear status filter
    await statusBtn('All')(page).click()

    // Now all services matching "nginx" (any status)
    // sshd is locked → only shows in system tab, not my tab
    await expect(page.locator('#service-table-body')).toContainText('nginx.service')
    // myapp.service should NOT appear (doesn't match "nginx")
    await expect(page.locator('#service-table-body')).not.toContainText('myapp.service')
  })
})

// ===================================================================
// 5. 正則錯誤處理
// ===================================================================

test.describe('正則錯誤 — 語法錯誤', () => {
  test('輸入不合法正則 → 紅框 + 錯誤提示 + 列表不更新', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true, services: MOCK_007 })
    await loginViaUI(page)

    await regexToggle(page).click()
    await searchInput(page).fill('[invalid(regex')
    await page.waitForTimeout(300)

    // Error message visible
    await expect(regexErrorEl(page)).toBeVisible()

    // List should still show all services (not updated with bad regex)
    await expect(page.locator('#service-table-body')).toContainText('nginx.service')
    await expect(page.locator('#service-table-body')).toContainText('myapp.service')
  })

  test('修正正則 → 錯誤消失，列表恢復篩選', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true, services: MOCK_007 })
    await loginViaUI(page)

    await regexToggle(page).click()

    // Invalid first
    await searchInput(page).fill('[invalid')
    await page.waitForTimeout(300)
    await expect(regexErrorEl(page)).toBeVisible()

    // Fix it
    await searchInput(page).fill('nginx-.*')
    await page.waitForTimeout(300)

    await expect(regexErrorEl(page)).not.toBeVisible()
    // No service matches "nginx-.*" in our mock, so empty state
    await expect(emptyStateEl(page)).toBeVisible()
  })

  test('關閉正則模式 → 清除正則錯誤', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true, services: MOCK_007 })
    await loginViaUI(page)

    await regexToggle(page).click()
    await searchInput(page).fill('[invalid')
    await page.waitForTimeout(300)
    await expect(regexErrorEl(page)).toBeVisible()

    // Turn regex off
    await regexToggle(page).click()

    // Error cleared, "invalid" becomes plain text search (no matches → empty)
    await expect(regexErrorEl(page)).not.toBeVisible()
  })
})

// ===================================================================
// 6. 空狀態
// ===================================================================

test.describe('空狀態 — 過濾結果為空', () => {
  test('無匹配結果 → 顯示空狀態頁面', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true, services: MOCK_007 })
    await loginViaUI(page)

    await searchInput(page).fill('xyz_not_exist_123')
    await page.waitForTimeout(300)

    await expect(emptyStateEl(page)).toBeVisible()
    await expect(page.locator('#service-table-body')).toContainText('沒有符合條件的服務')
    await expect(page.locator('.empty-state .btn')).toBeVisible()
  })

  test('點擊「清除過濾」→ 恢復完整列表', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true, services: MOCK_007 })
    await loginViaUI(page)

    await statusBtn('Failed')(page).click()
    await searchInput(page).fill('zzz')
    await page.waitForTimeout(300)

    await expect(emptyStateEl(page)).toBeVisible()

    // Click clear button in empty state
    await page.locator('.empty-state .btn').click()

    // All filters reset, full list shown
    await assertStatusActive(page, 'All')
    await expect(searchInput(page)).toHaveValue('')
    await expect(page.locator('#service-table-body')).toContainText('nginx.service')
    await expect(page.locator('#service-table-body')).toContainText('myapp.service')
  })
})

// ===================================================================
// 7. 載入狀態
// ===================================================================

test.describe('載入狀態 — 過濾按鈕 disabled', () => {
  test('載入中時狀態按鈕 disabled，搜尋框可輸入', async ({ page }) => {
    // Delay the API response so we can observe loading state
    await page.route('**/api/v1/services', async (route) => {
      await new Promise(r => setTimeout(r, 2000))
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_007),
      })
    })
    await page.route('**/api/v1/session', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ authenticated: true, username: 'admin' }),
      })
    })
    await page.route('**/api/v1/login', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ username: 'admin', message: 'Login successful' }),
      })
    })

    await gotoDashboard(page)

    // Loading spinner visible
    await expect(page.locator('.spinner-sm')).toBeVisible()

    // Status buttons should be disabled
    await expect(statusBtn('Running')(page)).toBeDisabled()
    await expect(statusBtn('Failed')(page)).toBeDisabled()
    await expect(statusBtn('Inactive')(page)).toBeDisabled()

    // Search input should still accept input
    await searchInput(page).fill('test')
    await expect(searchInput(page)).toHaveValue('test')
  })
})

// ===================================================================
// 8. Tab 切換時過濾保留
// ===================================================================

test.describe('Tab 切換 — 過濾條件保留', () => {
  test('狀態過濾跨 Tab 保留', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true, services: MOCK_007 })
    await loginViaUI(page)

    // Filter in My Services tab
    await statusBtn('Running')(page).click()
    await expect(page.locator('#service-table-body')).toContainText('nginx.service')

    // Switch to System Services tab
    await page.locator('#tab-system').click()

    // Status filter should still be Running
    await assertStatusActive(page, 'Running')

    // System tab running services: sshd.service, systemd-logind.service (both locked)
    await expect(page.locator('#service-table-body')).toContainText('sshd.service')
    await expect(page.locator('#service-table-body')).toContainText('systemd-logind.service')
    // Should NOT show nginx (not locked, not in system tab)
    await expect(page.locator('#service-table-body')).not.toContainText('nginx.service')
  })

  test('文字搜尋跨 Tab 保留', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true, services: MOCK_007 })
    await loginViaUI(page)

    await searchInput(page).fill('php')
    await page.waitForTimeout(300)

    // My tab: php-fpm
    await expect(page.locator('#service-table-body')).toContainText('php-fpm.service')

    // Switch to System Services
    await page.locator('#tab-system').click()

    // Search text still there
    await expect(searchInput(page)).toHaveValue('php')
    // No locked service matches "php" → empty
    await expect(emptyStateEl(page)).toBeVisible()
  })
})

// ===================================================================
// 9. URL 同步
// ===================================================================

test.describe('URL 同步 — query string', () => {
  test('過濾狀態同步到 URL', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true, services: MOCK_007 })
    await loginViaUI(page)

    await statusBtn('Running')(page).click()
    await searchInput(page).fill('nginx')
    await page.waitForTimeout(300)
    await regexToggle(page).click()

    // URL should contain query params
    await page.waitForTimeout(300)
    const url = new URL(page.url())
    expect(url.searchParams.get('status')).toBe('running')
    expect(url.searchParams.get('search')).toBe('nginx')
    expect(url.searchParams.get('regex')).toBe('true')
  })

  test('從 URL 進入時自動恢復過濾條件', async ({ page }) => {
    await setupApiMocks(page, { authenticated: true, services: MOCK_007 })

    await page.goto('/?status=failed&search=crash&regex=false')
    await page.waitForSelector('.app-header', { timeout: 10_000 })

    // Status should be Failed active
    await assertStatusActive(page, 'Failed')
    // Search text restored
    await expect(searchInput(page)).toHaveValue('crash')
    // Regex should be off
    await expect(regexToggle(page)).not.toHaveClass(/active/)
    // Only crash.service should match
    await expect(page.locator('#service-table-body')).toContainText('crash.service')
  })

  test('清除過濾後 URL 參數消失', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true, services: MOCK_007 })
    await loginViaUI(page)

    await statusBtn('Running')(page).click()
    await searchInput(page).fill('nginx')
    await page.waitForTimeout(600)

    const urlBefore = new URL(page.url())
    expect(urlBefore.searchParams.get('status')).toBe('running')

    // Clear search
    await searchClear(page).click()
    // Click Running again to cancel status filter
    await statusBtn('Running')(page).click()
    await page.waitForTimeout(300)

    const urlAfter = new URL(page.url())
    expect(urlAfter.searchParams.has('status')).toBe(false)
    expect(urlAfter.searchParams.has('search')).toBe(false)
  })
})

// ===================================================================
// 10. 商業規則
// ===================================================================

test.describe('商業規則 — 過濾範圍', () => {
  test('狀態過濾僅作用於當前 Tab', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true, services: MOCK_007 })
    await loginViaUI(page)

    // My tab: filter Running
    await statusBtn('Running')(page).click()

    // Should see nginx, apache2, php-fpm (all running + unlocked)
    // Should NOT see sshd (running but locked)
    await expect(page.locator('#service-table-body')).toContainText('nginx.service')
    await expect(page.locator('#service-table-body')).toContainText('apache2.service')
    await expect(page.locator('#service-table-body')).not.toContainText('sshd.service')
  })

  test('StatsBar 全域統計不受過濾影響', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true, services: MOCK_007 })
    await loginViaUI(page)

    // Get total count before filtering
    const totalCard = page.locator('.stat-total .stat-value')
    const totalBefore = await totalCard.textContent()

    // Apply filter
    await statusBtn('Failed')(page).click()

    // Stats should still show global total (not just filtered count)
    const totalAfter = await totalCard.textContent()
    expect(totalBefore).toBe(totalAfter)
  })

  test('所有過濾操作不發送 API 請求（前端過濾）', async ({ page }) => {
    let apiCallCount = 0

    // Setup base mocks first, then override services with counting route
    await setupApiMocks(page, { authenticated: true, includeActions: true })

    // Override services route with counting (last registered wins in Playwright)
    await page.route('**/api/v1/services', async (route) => {
      apiCallCount++
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_007),
      })
    })

    await gotoDashboard(page)

    // Initial load calls services API once
    const callsAfterLoad = apiCallCount
    expect(callsAfterLoad).toBeGreaterThanOrEqual(1)

    // Do filtering operations
    await statusBtn('Running')(page).click()
    await searchInput(page).fill('test')
    await page.waitForTimeout(300)
    await statusBtn('Failed')(page).click()
    await searchInput(page).fill('')
    await page.waitForTimeout(300)

    // No additional API calls beyond initial load
    expect(apiCallCount).toBe(callsAfterLoad)
  })
})

// ===================================================================
// 11. RWD 行動裝置
// ===================================================================

test.describe('RWD — 行動裝置佈局 (≤768px)', () => {
  test.use({ viewport: { width: 375, height: 812 } })

  test('手機佈局下過濾按鈕不擠壓搜尋框', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true, services: MOCK_007 })
    await loginViaUI(page)

    // All status buttons should be visible
    await expect(statusBtn('All')(page)).toBeVisible()
    await expect(statusBtn('Running')(page)).toBeVisible()
    await expect(statusBtn('Failed')(page)).toBeVisible()
    await expect(statusBtn('Inactive')(page)).toBeVisible()

    // Search input should be visible
    await expect(searchInput(page)).toBeVisible()

    // Status buttons should be clickable even on mobile
    await statusBtn('Failed')(page).click()
    await assertStatusActive(page, 'Failed')
    await expect(page.locator('#service-table-body')).toContainText('crash.service')
  })
})

// ===================================================================
// 12. 過濾後計數
// ===================================================================

test.describe('過濾計數顯示', () => {
  test('過濾後搜尋框下方顯示匹配數量', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true, services: MOCK_007 })
    await loginViaUI(page)

    // Default（我的服務 tab）：顯示 6 / 共 6（表格視圖 = tab-filtered）
    await expect(filteredCountEl(page)).toContainText('6')

    // Filter running：我的 tab 下 3 個 unlocked running（nginx, apache2, php-fpm）
    await statusBtn('Running')(page).click()
    await expect(filteredCountEl(page)).toContainText('3')

    // Add text search "php"
    await searchInput(page).fill('php')
    await page.waitForTimeout(300)
    await expect(filteredCountEl(page)).toContainText('1') // only php-fpm
  })
})
