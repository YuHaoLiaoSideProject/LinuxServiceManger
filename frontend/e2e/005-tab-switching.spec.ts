import { test, expect } from '@playwright/test'
import { setupApiMocks, loginViaUI, MOCK_SERVICES, getServiceRow } from './auth.setup'

/**
 * 005 — 我的服務 / 系統服務切換驗證 E2E Tests
 *
 * BDD scenarios covered:
 *   1. ✅ 初始狀態與視覺回饋 — 預設 tab active、點擊切換 active 狀態
 *   2. ✅ Tab 計數正確性 — 數字反映 locked/unlocked 筆數
 *   3. ✅ 資料過濾正確性 — 各 tab 僅顯示對應服務
 *   4. ✅ Tab 切換 + 搜尋組合 — 搜尋條件跨 tab 保留
 *   5. ✅ Tab 切換不影響 StatsBar — 統計永遠是全部服務
 *   6. ✅ Tab 切換 + 操作後重整 — tab 狀態維持
 *   7. ✅ Tab 持久化 (localStorage) — 重整後維持選擇
 *   8. ✅ 邊界狀況 — 空 tab、全鎖定、全解鎖
 *   9. ✅ 多語言支援 — 中/英文 tab 標籤
 *  10. ✅ 快速連續切換 — 不發生錯誤
 */

// ── Helpers ───────────────────────────────────────────────────────

function getMyTab(page: any) {
  return page.locator('#tab-my')
}

function getSystemTab(page: any) {
  return page.locator('#tab-system')
}

async function assertTabActive(page: any, tabLocator: any) {
  await expect(tabLocator).toHaveClass(/active/)
}

async function assertTabInactive(page: any, tabLocator: any) {
  await expect(tabLocator).not.toHaveClass(/active/)
}

// ── Scenario 1: 初始狀態與視覺回饋 ──────────────────────────────

test.describe('Scenario 1: 初始狀態與視覺回饋', () => {
  test('預設「我的服務」tab 應為 active', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    await assertTabActive(page, getMyTab(page))
    await assertTabInactive(page, getSystemTab(page))
  })

  test('點擊「系統服務」後，active 狀態切換至系統服務 tab', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    await getSystemTab(page).click()

    await assertTabActive(page, getSystemTab(page))
    await assertTabInactive(page, getMyTab(page))
  })

  test('從「系統服務」切回「我的服務」，active 狀態正確回復', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    // Switch to system
    await getSystemTab(page).click()
    await assertTabActive(page, getSystemTab(page))

    // Switch back to my
    await getMyTab(page).click()
    await assertTabActive(page, getMyTab(page))
    await assertTabInactive(page, getSystemTab(page))
  })

  test('兩個 tab 同時只有一個為 active', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    // Initial: only #tab-my is active
    const myActive = await getMyTab(page).evaluate((el: Element) => el.classList.contains('active'))
    const sysActive = await getSystemTab(page).evaluate((el: Element) => el.classList.contains('active'))
    expect(myActive !== sysActive).toBe(true)

    // After clicking system: only #tab-system is active
    await getSystemTab(page).click()
    const myActive2 = await getMyTab(page).evaluate((el: Element) => el.classList.contains('active'))
    const sysActive2 = await getSystemTab(page).evaluate((el: Element) => el.classList.contains('active'))
    expect(myActive2 !== sysActive2).toBe(true)
  })

  test('Tab 按鈕存在且可點擊', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    await expect(getMyTab(page)).toBeVisible()
    await expect(getMyTab(page)).toBeEnabled()

    await expect(getSystemTab(page)).toBeVisible()
    await expect(getSystemTab(page)).toBeEnabled()
  })
})


// ── Scenario 2: Tab 計數正確性 ──────────────────────────────────

test.describe('Scenario 2: Tab 計數正確性', () => {
  test('「我的服務」計數應等於 unlocked 服務數量', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    const unlockedCount = MOCK_SERVICES.filter(s => !s.locked).length // 6
    const myCount = getMyTab(page).locator('.tab-count')
    await expect(myCount).toHaveText(String(unlockedCount))
  })

  test('「系統服務」計數應等於 locked 服務數量', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    const lockedCount = MOCK_SERVICES.filter(s => s.locked).length // 1
    const sysCount = getSystemTab(page).locator('.tab-count')
    await expect(sysCount).toHaveText(String(lockedCount))
  })

  test('計數總和應等於全部服務數', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    const myCountText = await getMyTab(page).locator('.tab-count').textContent()
    const sysCountText = await getSystemTab(page).locator('.tab-count').textContent()
    const sum = Number(myCountText) + Number(sysCountText)
    expect(sum).toBe(MOCK_SERVICES.length) // 7
  })

  test('全部服務為 unlocked 時，系統服務計數為 0', async ({ page }) => {
    const allUnlocked = MOCK_SERVICES.map(s => ({ ...s, locked: false }))
    await setupApiMocks(page, { authenticated: false, includeActions: true, services: allUnlocked })
    await loginViaUI(page)

    await expect(getMyTab(page).locator('.tab-count')).toHaveText(String(allUnlocked.length))
    await expect(getSystemTab(page).locator('.tab-count')).toHaveText('0')
  })

  test('全部服務為 locked 時，我的服務計數為 0', async ({ page }) => {
    const allLocked = MOCK_SERVICES.map(s => ({ ...s, locked: true }))
    await setupApiMocks(page, { authenticated: false, includeActions: true, services: allLocked })
    await loginViaUI(page)

    await expect(getMyTab(page).locator('.tab-count')).toHaveText('0')
    await expect(getSystemTab(page).locator('.tab-count')).toHaveText(String(allLocked.length))
  })
})


// ── Scenario 3: 資料過濾正確性 ──────────────────────────────────

test.describe('Scenario 3: 資料過濾正確性', () => {
  test('「我的服務」僅顯示 locked=false 的服務', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    const unlockedNames = MOCK_SERVICES.filter(s => !s.locked).map(s => s.name)
    const lockedNames = MOCK_SERVICES.filter(s => s.locked).map(s => s.name)

    const tbody = page.locator('#service-table-body')

    // Should contain all unlocked services
    for (const name of unlockedNames) {
      await expect(tbody).toContainText(name)
    }

    // Should NOT contain locked services
    for (const name of lockedNames) {
      await expect(tbody).not.toContainText(name)
    }
  })

  test('「系統服務」僅顯示 locked=true 的服務', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    await getSystemTab(page).click()

    const unlockedNames = MOCK_SERVICES.filter(s => !s.locked).map(s => s.name)
    const lockedNames = MOCK_SERVICES.filter(s => s.locked).map(s => s.name)

    const tbody = page.locator('#service-table-body')

    // Should contain all locked services
    for (const name of lockedNames) {
      await expect(tbody).toContainText(name)
    }

    // Should NOT contain unlocked services
    for (const name of unlockedNames) {
      await expect(tbody).not.toContainText(name)
    }
  })

  test('切換 tab 後表格列數正確變化', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    const unlockedCount = MOCK_SERVICES.filter(s => !s.locked).length
    const lockedCount = MOCK_SERVICES.filter(s => s.locked).length

    // My Services: unlocked rows
    await expect(page.locator('#service-table-body tr')).toHaveCount(unlockedCount)

    // Switch to System Services
    await getSystemTab(page).click()
    await expect(page.locator('#service-table-body tr')).toHaveCount(lockedCount)

    // Switch back to My Services
    await getMyTab(page).click()
    await expect(page.locator('#service-table-body tr')).toHaveCount(unlockedCount)
  })

  test('在「系統服務」中鎖定服務應顯示 🔒 badge，無操作按鈕', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    await getSystemTab(page).click()

    const sshdRow = getServiceRow(page, 'sshd.service')
    await expect(sshdRow.locator('.locked-badge').first()).toBeVisible()
    await expect(sshdRow.locator('button')).toHaveCount(0)
  })
})


// ── Scenario 4: Tab 切換 + 搜尋組合 ────────────────────────────

test.describe('Scenario 4: Tab 切換 + 搜尋組合', () => {
  test('在「我的服務」搜尋後，切換 tab 搜尋條件保留', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    await page.locator('.search-wrap input[type="search"]').fill('nginx')

    // "My Services" has nginx (unlocked)
    await expect(page.locator('#service-table-body tr')).toHaveCount(1)
    await expect(page.locator('#service-table-body')).toContainText('nginx.service')

    // Switch to "System Services" — search term persists
    await getSystemTab(page).click()

    // nginx is not locked, so no results in system tab
    await expect(page.locator('.empty-state')).toBeVisible()
  })

  test('在「系統服務」搜尋後，切換回「我的服務」搜尋條件保留', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    await getSystemTab(page).click()
    await page.locator('.search-wrap input[type="search"]').fill('sshd')

    // "System Services" has sshd (locked)
    await expect(page.locator('#service-table-body tr')).toHaveCount(1)
    await expect(page.locator('#service-table-body')).toContainText('sshd.service')

    // Switch back to "My Services" — search term persists
    await getMyTab(page).click()

    // sshd is locked, not in my services
    await expect(page.locator('.empty-state')).toBeVisible()
  })

  test('搜尋後清除搜尋 → 回到該 tab 的完整列表', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    await page.locator('.search-wrap input[type="search"]').fill('nginx')
    await expect(page.locator('#service-table-body tr')).toHaveCount(1)

    // Clear search
    await page.locator('.search-clear').click()

    const unlockedCount = MOCK_SERVICES.filter(s => !s.locked).length
    await expect(page.locator('#service-table-body tr')).toHaveCount(unlockedCount)
  })

  test('搜尋跨 tab 都無匹配時應顯示空狀態', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    await page.locator('.search-wrap input[type="search"]').fill('zzz_not_exist')
    await expect(page.locator('.empty-state')).toBeVisible()

    // Switch tab — still empty
    await getSystemTab(page).click()
    await expect(page.locator('.empty-state')).toBeVisible()
  })
})


// ── Scenario 5: Tab 切換不影響 StatsBar ─────────────────────────

test.describe('Scenario 5: StatsBar 不受 Tab 切換影響', () => {
  test('Tab 切換後統計數字不變（永遠是全部服務統計）', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    // Record stats on My Services tab
    const totalMy = await page.locator('.stat-total .stat-value').textContent()
    const runningMy = await page.locator('.stat-active .stat-value').textContent()
    const failedMy = await page.locator('.stat-failed .stat-value').textContent()

    // Switch to System Services
    await getSystemTab(page).click()

    const totalSys = await page.locator('.stat-total .stat-value').textContent()
    const runningSys = await page.locator('.stat-active .stat-value').textContent()
    const failedSys = await page.locator('.stat-failed .stat-value').textContent()

    // Stats should be identical regardless of tab
    expect(totalMy).toBe(totalSys)
    expect(runningMy).toBe(runningSys)
    expect(failedMy).toBe(failedSys)
  })

  test('統計總數為 7，不受 tab 影響', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    await expect(page.locator('.stat-total .stat-value')).toHaveText('7')

    await getSystemTab(page).click()
    await expect(page.locator('.stat-total .stat-value')).toHaveText('7')
  })
})


// ── Scenario 6: Tab 切換 + 服務操作後重整 ──────────────────────

test.describe('Scenario 6: Tab 切換 + 操作後重整', () => {
  test('在「我的服務」執行 Start → 重整後仍在「我的服務」tab', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    const myappRow = getServiceRow(page, 'myapp.service')
    await myappRow.locator('button').filter({ hasText: '▶' }).click()

    // Wait for reload
    await page.waitForTimeout(500)

    // Should still be on My Services tab
    await assertTabActive(page, getMyTab(page))
    await expect(page.locator('#service-table-body')).toContainText('myapp.service')
    await expect(page.locator('#service-table-body')).not.toContainText('sshd.service')
  })

  test('在「我的服務」執行 Stop → 重整後仍在「我的服務」tab', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    const nginxRow = getServiceRow(page, 'nginx.service')
    await nginxRow.locator('button').filter({ hasText: '⏹' }).click()

    // Confirm modal
    await page.locator('.lms-modal-actions .btn-danger').click()

    // Wait for reload
    await page.waitForTimeout(500)

    await assertTabActive(page, getMyTab(page))
    await expect(page.locator('#service-table-body')).not.toContainText('sshd.service')
  })

  test('從「系統服務」切到「我的服務」後操作，tab 保持不變', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    // Switch to system first, then back to my
    await getSystemTab(page).click()
    await getMyTab(page).click()

    // Perform an action
    const myappRow = getServiceRow(page, 'myapp.service')
    await myappRow.locator('button').filter({ hasText: '▶' }).click()

    await page.waitForTimeout(500)

    // Tab should remain "my"
    await assertTabActive(page, getMyTab(page))
  })

  test('點擊 Refresh 按鈕重整 → tab 狀態維持', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    await getSystemTab(page).click()
    await assertTabActive(page, getSystemTab(page))

    // Click refresh
    const refreshRequest = page.waitForRequest(req =>
      req.url().endsWith('/api/v1/services') && req.method() === 'GET',
    )
    await page.locator('.btn-refresh').click()
    await refreshRequest

    // Should still be on System Services tab
    await assertTabActive(page, getSystemTab(page))
  })
})


// ── Scenario 7: Tab 持久化 (localStorage) ────────────────────────

test.describe('Scenario 7: Tab 持久化', () => {
  test('切換到「系統服務」後 localStorage 儲存 "system"', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    await getSystemTab(page).click()

    const tab = await page.evaluate(() => localStorage.getItem('lms-tab'))
    expect(tab).toBe('system')
  })

  test('切換回「我的服務」後 localStorage 儲存 "my"', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    // First switch away, then back
    await getSystemTab(page).click()
    await getMyTab(page).click()

    const tab = await page.evaluate(() => localStorage.getItem('lms-tab'))
    expect(tab).toBe('my')
  })

  test('重整頁面後 tab 選擇應維持', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    // Switch to system tab
    await getSystemTab(page).click()
    await assertTabActive(page, getSystemTab(page))

    // Reload the page
    await page.reload()
    await page.waitForURL((url) => url.pathname === '/')
    await page.waitForSelector('.app-header')

    // Should still be on system tab (loaded from localStorage)
    await assertTabActive(page, getSystemTab(page))
    await expect(page.locator('#service-table-body')).toContainText('sshd.service')
  })

  test('重整頁面後「我的服務」tab 維持', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    // Default is "my" tab
    await assertTabActive(page, getMyTab(page))

    await page.reload()
    await page.waitForURL((url) => url.pathname === '/')
    await page.waitForSelector('.app-header')

    await assertTabActive(page, getMyTab(page))
  })

  test('重整後 tab 資料正確（系統服務 tab 重整後仍顯示 locked 服務）', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    await getSystemTab(page).click()
    await assertTabActive(page, getSystemTab(page))

    await page.reload()
    await page.waitForURL((url) => url.pathname === '/')
    await page.waitForSelector('.app-header')

    await assertTabActive(page, getSystemTab(page))
    await expect(page.locator('#service-table-body')).toContainText('sshd.service')
    await expect(page.locator('#service-table-body')).not.toContainText('nginx.service')
  })
})


// ── Scenario 8: 邊界狀況 ─────────────────────────────────────────

test.describe('Scenario 8: 邊界狀況', () => {
  test('所有服務為 unlocked →「系統服務」tab 顯示空狀態', async ({ page }) => {
    const allUnlocked = MOCK_SERVICES.map(s => ({ ...s, locked: false }))
    await setupApiMocks(page, { authenticated: false, includeActions: true, services: allUnlocked })
    await loginViaUI(page)

    await getSystemTab(page).click()

    // Count should be 0
    await expect(getSystemTab(page).locator('.tab-count')).toHaveText('0')

    // Empty state should appear
    await expect(page.locator('.empty-state')).toBeVisible()
  })

  test('所有服務為 locked →「我的服務」tab 顯示空狀態', async ({ page }) => {
    const allLocked = MOCK_SERVICES.map(s => ({ ...s, locked: true }))
    await setupApiMocks(page, { authenticated: false, includeActions: true, services: allLocked })
    await loginViaUI(page)

    // Default tab is "my" with 0 unlocked services
    await expect(getMyTab(page).locator('.tab-count')).toHaveText('0')
    await expect(page.locator('.empty-state')).toBeVisible()

    // Switch to system tab — all services visible
    await getSystemTab(page).click()
    await expect(page.locator('#service-table-body tr')).toHaveCount(allLocked.length)
  })

  test('無服務時兩個 tab 計數皆為 0', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true, services: [] })
    await loginViaUI(page)

    await expect(getMyTab(page).locator('.tab-count')).toHaveText('0')
    await expect(getSystemTab(page).locator('.tab-count')).toHaveText('0')

    // Both tabs show empty state
    await expect(page.locator('.empty-state')).toBeVisible()
    await getSystemTab(page).click()
    await expect(page.locator('.empty-state')).toBeVisible()
  })

  test('只有一個 unlocked 服務時，tab 正確顯示', async ({ page }) => {
    const singleUnlocked = [MOCK_SERVICES[0]] // nginx.service
    await setupApiMocks(page, { authenticated: false, includeActions: true, services: singleUnlocked })
    await loginViaUI(page)

    await expect(getMyTab(page).locator('.tab-count')).toHaveText('1')
    await expect(page.locator('#service-table-body tr')).toHaveCount(1)
    await expect(page.locator('#service-table-body')).toContainText('nginx.service')
  })

  test('只有一個 locked 服務時，系統服務 tab 正確顯示', async ({ page }) => {
    const singleLocked = [{ ...MOCK_SERVICES[0], locked: true }] // nginx.service but locked
    await setupApiMocks(page, { authenticated: false, includeActions: true, services: singleLocked })
    await loginViaUI(page)

    // My tab: empty
    await expect(page.locator('.empty-state')).toBeVisible()

    await getSystemTab(page).click()
    await expect(getSystemTab(page).locator('.tab-count')).toHaveText('1')
    await expect(page.locator('#service-table-body tr')).toHaveCount(1)
  })
})


// ── Scenario 9: 多語言支援 ───────────────────────────────────────

test.describe('Scenario 9: 多語言支援', () => {
  test('英文模式下顯示 "My Services" / "System Services"', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    await expect(getMyTab(page)).toContainText('My Services')
    await expect(getSystemTab(page)).toContainText('System Services')
  })

  test('切換到繁體中文後顯示「我的服務」/「系統服務」', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    await page.locator('.lang-toggle').click()

    await expect(getMyTab(page)).toContainText('我的服務')
    await expect(getSystemTab(page)).toContainText('系統服務')
  })

  test('從中文切回英文後 tab 標籤恢復英文', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    // Switch to zh-TW
    await page.locator('.lang-toggle').click()
    await expect(getMyTab(page)).toContainText('我的服務')

    // Switch back to en
    await page.locator('.lang-toggle').click()
    await expect(getMyTab(page)).toContainText('My Services')
  })

  test('中文模式下 tab 切換功能正常', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    await page.locator('.lang-toggle').click()

    // Switch to system tab in Chinese
    await getSystemTab(page).click()
    await assertTabActive(page, getSystemTab(page))
    await expect(page.locator('#service-table-body')).toContainText('sshd.service')

    // Switch back to my tab
    await getMyTab(page).click()
    await assertTabActive(page, getMyTab(page))
    await expect(page.locator('#service-table-body')).not.toContainText('sshd.service')
  })
})


// ── Scenario 10: 快速連續切換 ────────────────────────────────────

test.describe('Scenario 10: 快速連續切換', () => {
  test('快速連續切換 tab 不發生錯誤，最終狀態正確', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    // Rapid switching
    await getSystemTab(page).click()
    await getMyTab(page).click()
    await getSystemTab(page).click()
    await getMyTab(page).click()
    await getSystemTab(page).click()

    // Final state: system tab active
    await assertTabActive(page, getSystemTab(page))
    await expect(page.locator('#service-table-body')).toContainText('sshd.service')
  })

  test('快速連續切換後 localStorage 儲存最終選擇', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    await getSystemTab(page).click()
    await getMyTab(page).click()
    await getSystemTab(page).click()

    const tab = await page.evaluate(() => localStorage.getItem('lms-tab'))
    expect(tab).toBe('system')
  })

  test('快速切換過程中表格資料不會錯亂', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    await getSystemTab(page).click()
    // Immediately check that locked service is visible
    await expect(page.locator('#service-table-body')).toContainText('sshd.service')
    await expect(page.locator('#service-table-body')).not.toContainText('nginx.service')

    await getMyTab(page).click()
    // Immediately check that unlocked services are visible
    await expect(page.locator('#service-table-body')).toContainText('nginx.service')
    await expect(page.locator('#service-table-body')).not.toContainText('sshd.service')
  })

  test('快速切換後執行 Refresh 不會導致 tab 錯亂', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    await getSystemTab(page).click()
    await getMyTab(page).click()
    await getSystemTab(page).click()

    // Refresh
    await page.locator('.btn-refresh').click()
    await page.waitForTimeout(500)

    // Should still be on system tab
    await assertTabActive(page, getSystemTab(page))
    await expect(page.locator('#service-table-body')).toContainText('sshd.service')
  })
})
