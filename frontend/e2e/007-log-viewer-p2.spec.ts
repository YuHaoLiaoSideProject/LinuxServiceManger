import { test, expect } from '@playwright/test'
import { setupApiMocks, loginViaUI, getServiceRow } from './auth.setup'

/**
 * 007 — Log Viewer P2 (RWD + Focus Trap + Background Interaction) E2E Tests
 *
 * BDD scenarios covered:
 *   E2E-07: viewport 375×812 → Drawer 全螢幕 (width: 100vw)
 *   E2E-08: Tab 到最後 → 焦點回到第一個 (focus trap)
 *   E2E-09: Drawer 開啟中無法與背景互動
 */

// ── Helpers ───────────────────────────────────────────────────────

/**
 * Open the log drawer for a given service by clicking the 📋 Logs button.
 */
async function openLogDrawer(page: any, serviceName: string) {
  const row = getServiceRow(page, serviceName)
  const logsBtn = row.locator('button').filter({ hasText: '📋' })
  await logsBtn.click()
  await expect(page.locator('.log-drawer')).toBeVisible()
}

// ═══════════════════════════════════════════════════════════════════
// E2E-07: 行動裝置全螢幕 Drawer
// ═══════════════════════════════════════════════════════════════════

test.describe('E2E-07: 行動裝置全螢幕 Drawer', () => {
  test.use({ viewport: { width: 375, height: 812 } })

  test('Drawer 應為全螢幕（100vw）', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    // Open log drawer for nginx
    await openLogDrawer(page, 'nginx.service')

    const drawer = page.locator('.log-drawer')
    const box = await drawer.boundingBox()

    // Drawer width should equal viewport width (375px)
    expect(box).not.toBeNull()
    // Allow small rounding tolerance
    expect(box!.width).toBeGreaterThanOrEqual(370)
    expect(box!.width).toBeLessThanOrEqual(380)
  })

  test('全螢幕 Drawer 關閉後恢復正常', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    await openLogDrawer(page, 'nginx.service')

    // Close via ✕ button
    await page.locator('.log-drawer .close-btn').click()

    // Drawer should disappear
    await expect(page.locator('.log-drawer')).not.toBeVisible()

    // Table should be visible again
    await expect(page.locator('#service-table-body')).toBeVisible()
  })
})

// ═══════════════════════════════════════════════════════════════════
// E2E-08: Focus Trap
// ═══════════════════════════════════════════════════════════════════

test.describe('E2E-08: Focus Trap', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('Tab 到最後一個可聚焦元素 → 焦點回到第一個', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    await openLogDrawer(page, 'nginx.service')

    // Wait a moment and close any WebSocket mock that might interfere
    await page.waitForTimeout(500)

    // Get all focusable elements in the drawer
    const focusableCount = await page.locator(
      '.log-drawer button, .log-drawer select, .log-drawer input'
    ).count()
    expect(focusableCount).toBeGreaterThanOrEqual(2)

    // Focus the last focusable element (close button)
    const closeBtn = page.locator('.log-drawer .close-btn')
    await closeBtn.focus()
    await expect(closeBtn).toBeFocused()

    // Press Tab — should move focus to the first focusable element (select)
    await page.keyboard.press('Tab')

    // Focus should now be on the line-count select (first focusable)
    const select = page.locator('.log-drawer .line-count-select')
    await expect(select).toBeFocused()
  })

  test('Shift+Tab 在第一個 → 焦點跳到最後一個', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    await openLogDrawer(page, 'nginx.service')
    await page.waitForTimeout(500)

    // Focus the first focusable element (select)
    const select = page.locator('.log-drawer .line-count-select')
    await select.focus()
    await expect(select).toBeFocused()

    // Press Shift+Tab — should move focus to the last focusable element (close button)
    await page.keyboard.press('Shift+Tab')

    // Focus should now be on the close button
    const closeBtn = page.locator('.log-drawer .close-btn')
    await expect(closeBtn).toBeFocused()
  })

  test('Escape 仍可正常關閉 Drawer', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    await openLogDrawer(page, 'nginx.service')

    // Press Escape
    await page.keyboard.press('Escape')

    // Drawer should close
    await expect(page.locator('.log-drawer')).not.toBeVisible()
  })
})

// ═══════════════════════════════════════════════════════════════════
// E2E-09: Drawer 開啟中無法與背景互動
// ═══════════════════════════════════════════════════════════════════

test.describe('E2E-09: Drawer 開啟中背景互動阻擋', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('Drawer 開啟時點擊背景 → Drawer 關閉而非觸發背景操作', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    await openLogDrawer(page, 'nginx.service')

    // Click the overlay (background outside the drawer)
    const overlay = page.locator('.drawer-overlay')
    await overlay.click({ position: { x: 10, y: 10 } })

    // Drawer should close
    await expect(page.locator('.log-drawer')).not.toBeVisible()

    // Verify no background action was triggered (table still intact)
    await expect(page.locator('#service-table-body')).toBeVisible()
  })

  test('Drawer 開啟時 Tab 不會跳轉到背景元素', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    await openLogDrawer(page, 'nginx.service')
    await page.waitForTimeout(500)

    // Focus close button (last focusable)
    const closeBtn = page.locator('.log-drawer .close-btn')
    await closeBtn.focus()

    // Press Tab multiple times — focus should cycle within drawer, not escape to background
    await page.keyboard.press('Tab')
    // After Tab from close-btn, should be on line-count-select
    const select = page.locator('.log-drawer .line-count-select')
    await expect(select).toBeFocused()

    // Press Tab again — should go back to close-btn (cycling within drawer)
    await page.keyboard.press('Tab')
    await expect(closeBtn).toBeFocused()
  })

  test('Drawer 關閉後背景恢復可互動', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    await openLogDrawer(page, 'nginx.service')

    // Close via overlay click
    await page.locator('.drawer-overlay').click({ position: { x: 10, y: 10 } })
    await expect(page.locator('.log-drawer')).not.toBeVisible()

    // Now background should be interactive — refresh button should work
    const refreshBtn = page.locator('[data-testid="btn-refresh"]')
    if (await refreshBtn.isVisible()) {
      await refreshBtn.click()
    }

    // Table should still be functional
    await expect(page.locator('#service-table-body')).toBeVisible()
  })
})
