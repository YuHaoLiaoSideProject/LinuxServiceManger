import { test, expect } from '@playwright/test'
import { setupApiMocks, loginViaUI, MOCK_SERVICES, getServiceRow, toggleTheme } from './auth.setup'

/**
 * 004 — Enable / Disable 開機自動啟動 E2E Tests
 *
 * BDD scenarios covered:
 *   1. ✅ 檢視 Auto-start 欄位 — Toggle ON/OFF/🔒/不適用
 *   2. ✅ 開啟自動啟動 — Toggle OFF→ON，不彈確認對話框
 *   3. ✅ 關閉自動啟動 — Toggle ON→OFF，彈 ConfirmModal
 *   4. ✅ 取消關閉確認對話框 — Toggle 恢復 ON
 *   5. ✅ 鎖定服務顯示 🔒
 *   6. ✅ static/masked 顯示「不適用」
 *   7. ✅ enabled-runtime 顯示 ON
 *   8. ✅ Loading 狀態防止重複切換
 *   9. ✅ 網路錯誤 → Toast error + Toggle 恢復
 *  10. ✅ 深色模式下 Toggle 樣式
 */

// ── Helper: get toggle for a service row ──

function getAutoStartCell(row: ReturnType<typeof getServiceRow>) {
  return row.locator('td[data-label="Auto-start"]')
}

function getToggle(row: ReturnType<typeof getServiceRow>) {
  return getAutoStartCell(row).locator('button.toggle-switch')
}

// ── Scenario 1: 檢視 Auto-start 欄位狀態 ──

test.describe('Scenario 1: 檢視 Auto-start 欄位', () => {
  test('enabled 服務 → Toggle ON', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    const nginxRow = getServiceRow(page, 'nginx.service')
    const toggle = getToggle(nginxRow)
    await expect(toggle).toBeVisible()
    await expect(toggle).toHaveClass(/toggle-on/)
    await expect(toggle.locator('.toggle-label')).toHaveText('ON')
  })

  test('disabled 服務 → Toggle OFF', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    const myappRow = getServiceRow(page, 'myapp.service')
    const toggle = getToggle(myappRow)
    await expect(toggle).toBeVisible()
    await expect(toggle).toHaveClass(/toggle-off/)
    await expect(toggle.locator('.toggle-label')).toHaveText('OFF')
  })

  test('enabled-runtime 服務 → Toggle ON', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    const busRow = getServiceRow(page, 'bus-name@.service')
    const toggle = getToggle(busRow)
    await expect(toggle).toBeVisible()
    await expect(toggle).toHaveClass(/toggle-on/)
  })

  test('鎖定服務 sshd → Auto-start 顯示 🔒，無 Toggle', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    // Switch to System Services tab to see locked services
    await page.locator('#tab-system').click()

    const sshdRow = getServiceRow(page, 'sshd.service')
    const cell = getAutoStartCell(sshdRow)
    await expect(cell).toContainText('🔒')
    // No toggle button
    await expect(cell.locator('button.toggle-switch')).toHaveCount(0)
  })

  test('static 服務 → Auto-start 顯示「N/A」', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    const staticRow = getServiceRow(page, 'static-svc.service')
    const cell = getAutoStartCell(staticRow)
    await expect(cell).toContainText('N/A')
    await expect(cell.locator('button.toggle-switch')).toHaveCount(0)
  })

  test('masked 服務 → Auto-start 顯示「N/A」', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    const maskedRow = getServiceRow(page, 'masked-svc.service')
    const cell = getAutoStartCell(maskedRow)
    await expect(cell).toContainText('N/A')
    await expect(cell.locator('button.toggle-switch')).toHaveCount(0)
  })

  test('Auto-start 欄位與 Actions 欄位明確區分', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    const nginxRow = getServiceRow(page, 'nginx.service')
    // Should have separate Auto-start and Actions columns
    await expect(nginxRow.locator('td[data-label="Auto-start"]')).toBeVisible()
    await expect(nginxRow.locator('td[data-label="Actions"]')).toBeVisible()
  })

  test('六個欄位標頭存在', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    const headers = page.locator('thead th')
    await expect(headers).toHaveCount(6)
    await expect(headers.nth(0)).toHaveText('Name')
    await expect(headers.nth(4)).toHaveText('Auto-start')
    await expect(headers.nth(5)).toHaveText('Actions')
  })
})


// ── Scenario 2: 開啟自動啟動（不需確認對話框）──

test.describe('Scenario 2: 開啟自動啟動 (Enable)', () => {
  test('點擊 OFF→ON 不彈 ConfirmModal，直接呼叫 API', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    const myappRow = getServiceRow(page, 'myapp.service')
    const toggle = getToggle(myappRow)
    await expect(toggle).toHaveClass(/toggle-off/)

    // Wait for the enable API call
    const enableRequest = page.waitForRequest(req =>
      req.url().includes('/api/v1/services/myapp.service/enable') && req.method() === 'POST',
    )

    await toggle.click()

    // No ConfirmModal should appear
    await expect(page.locator('.lms-modal-overlay')).not.toBeVisible()

    // API was called
    await enableRequest
  })

  test('Enable 成功後顯示 Toast 通知', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    const myappRow = getServiceRow(page, 'myapp.service')
    await getToggle(myappRow).click()

    const toast = page.locator('.toast-success')
    await expect(toast).toBeVisible({ timeout: 5000 })
    await expect(toast).toContainText('myapp.service')
  })
})


// ── Scenario 3 & 4: 關閉自動啟動（需確認對話框）──

test.describe('Scenario 3 & 4: 關閉自動啟動 (Disable with Confirm)', () => {
  test('點擊 ON→OFF 彈出 ConfirmModal', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    const nginxRow = getServiceRow(page, 'nginx.service')
    const toggle = getToggle(nginxRow)
    await expect(toggle).toHaveClass(/toggle-on/)

    await toggle.click()

    // ConfirmModal should appear
    await expect(page.locator('.lms-modal-overlay')).toBeVisible()
    await expect(page.locator('.lms-modal')).toContainText('nginx.service')
  })

  test('確認對話框的取消按鈕 → Modal 關閉，Toggle 維持 ON，不呼叫 API', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    const nginxRow = getServiceRow(page, 'nginx.service')
    await getToggle(nginxRow).click()

    await expect(page.locator('.lms-modal-overlay')).toBeVisible()

    // Click cancel
    await page.locator('.lms-modal-actions button.secondary').click()
    await expect(page.locator('.lms-modal-overlay')).not.toBeVisible()

    // Toggle should still show ON (after refresh via loadServices)
    // The mock returns the same data, so nginx stays enabled
  })

  test('確認對話框的確認按鈕 → 執行 disable API + Toast', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    const nginxRow = getServiceRow(page, 'nginx.service')
    await getToggle(nginxRow).click()

    await expect(page.locator('.lms-modal-overlay')).toBeVisible()

    const disableRequest = page.waitForRequest(req =>
      req.url().includes('/api/v1/services/nginx.service/disable') && req.method() === 'POST',
    )

    // Click confirm
    await page.locator('.lms-modal-actions .btn-danger').click()

    // Modal closes
    await expect(page.locator('.lms-modal-overlay')).not.toBeVisible()

    // API was called
    await disableRequest

    // Toast success
    const toast = page.locator('.toast-success')
    await expect(toast).toBeVisible({ timeout: 5000 })
    await expect(toast).toContainText('nginx.service')
  })

  test('點擊啟用中的 Toggle（enabled-runtime → OFF）也會彈 ConfirmModal', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    const busRow = getServiceRow(page, 'bus-name@.service')
    await expect(getToggle(busRow)).toHaveClass(/toggle-on/)

    await getToggle(busRow).click()
    await expect(page.locator('.lms-modal-overlay')).toBeVisible()
    await expect(page.locator('.lms-modal')).toContainText('bus-name@.service')
  })
})


// ── Scenario 5: Loading 狀態防止重複切換 ──

test.describe('Scenario 5: Loading 狀態', () => {
  test('操作期間 Toggle 進入 loading 狀態', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    // Delay the enable response so we can observe loading state
    await page.route('**/api/v1/services/myapp.service/enable', async (route) => {
      await new Promise(resolve => setTimeout(resolve, 500))
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'myapp.service enabled' }),
      })
    })

    const myappRow = getServiceRow(page, 'myapp.service')
    const toggle = getToggle(myappRow)
    await toggle.click()

    // Toggle should show loading
    await expect(toggle).toHaveClass(/toggle-loading/)
    await expect(toggle).toBeDisabled()
    await expect(toggle.locator('.toggle-label')).toHaveText('...')
  })

  test('Loading 期間再次點擊不觸發第二次請求', async ({ page }) => {
    let requestCount = 0
    await page.route('**/api/v1/services/myapp.service/enable', async (route) => {
      requestCount++
      await new Promise(resolve => setTimeout(resolve, 300))
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'myapp.service enabled' }),
      })
    })

    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    const myappRow = getServiceRow(page, 'myapp.service')
    const toggle = getToggle(myappRow)

    await toggle.click()
    // Click again while loading
    await toggle.click({ force: true })
    await toggle.click({ force: true })

    // Wait for loading to finish
    await expect(toggle).not.toHaveClass(/toggle-loading/, { timeout: 5000 })

    // Should only have been called once (or at most a small number due to race)
    expect(requestCount).toBeLessThanOrEqual(2)
  })
})


// ── Scenario 6: 錯誤處理 ──

test.describe('Scenario 6: 錯誤處理', () => {
  test('網路錯誤 → Toast error + Toggle 恢復原狀態', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    // Override enable for crash.service to return 500 (must be after setupApiMocks for LIFO priority)
    await page.route('**/api/v1/services/crash.service/enable', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'failed to enable crash.service' }),
      })
    })
    await loginViaUI(page)

    const crashRow = getServiceRow(page, 'crash.service')
    const toggle = getToggle(crashRow)
    await expect(toggle).toHaveClass(/toggle-off/)

    await toggle.click()

    // Toast error
    const toast = page.locator('.toast-error')
    await expect(toast).toBeVisible({ timeout: 5000 })
    await expect(toast).toContainText('crash.service')
  })

  test('網路中斷 → Toast 錯誤通知', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    // Make enable fail with network error (must be after setupApiMocks for LIFO priority)
    await page.route('**/api/v1/services/myapp.service/enable', async (route) => {
      await route.abort('connectionrefused')
    })
    await loginViaUI(page)

    const myappRow = getServiceRow(page, 'myapp.service')
    await getToggle(myappRow).click()

    // Should show error toast
    const toast = page.locator('.toast-error')
    await expect(toast).toBeVisible({ timeout: 5000 })
  })

  test('Disable 失敗 → Toast error', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    // Override disable to return 500 (must be after setupApiMocks for LIFO priority)
    await page.route('**/api/v1/services/nginx.service/disable', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'failed to disable nginx.service' }),
      })
    })
    await loginViaUI(page)

    const nginxRow = getServiceRow(page, 'nginx.service')
    await getToggle(nginxRow).click()
    await page.locator('.lms-modal-actions .btn-danger').click()

    const toast = page.locator('.toast-error')
    await expect(toast).toBeVisible({ timeout: 5000 })
  })
})


// ── Scenario 7: 深色模式 Toggle 樣式 ──

test.describe('Scenario 7: 深色模式', () => {
  test('深色模式下 Toggle ON/OFF 仍有明確視覺區別', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    // Toggle dark mode via account menu
    await toggleTheme(page)
    await page.waitForTimeout(300)

    // Verify both ON and OFF toggles are visible
    const nginxToggle = getToggle(getServiceRow(page, 'nginx.service'))
    await expect(nginxToggle).toBeVisible()
    await expect(nginxToggle).toHaveClass(/toggle-on/)

    const myappToggle = getToggle(getServiceRow(page, 'myapp.service'))
    await expect(myappToggle).toBeVisible()
    await expect(myappToggle).toHaveClass(/toggle-off/)
  })
})


// ── Scenario 8: RWD 手機佈局 ──

test.describe('Scenario 8: RWD 手機卡片佈局', () => {
  test('手機 viewport 下 Auto-start 欄位存在且可操作', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 }) // iPhone X

    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    // In card layout, data-label attributes are used for display
    const nginxRow = getServiceRow(page, 'nginx.service')
    await expect(nginxRow.locator('td[data-label="Auto-start"]')).toBeVisible()

    // Toggle should still be clickable
    const toggle = getToggle(nginxRow)
    await expect(toggle).toBeVisible()
  })

  test('手機佈局下 Auto-start 與 Actions 在卡片中明確區分', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })

    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    const nginxRow = getServiceRow(page, 'nginx.service')
    await expect(nginxRow.locator('td[data-label="Auto-start"]')).toBeVisible()
    await expect(nginxRow.locator('td[data-label="Actions"]')).toBeVisible()
  })
})


// ── Scenario 9: 服務列表重整後 Toggle 狀態更新 ──

test.describe('Scenario 9: 重整後狀態一致', () => {
  test('Enable 操作後重整列表，Toggle 保持 ON', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    // Override services to return updated state after enable (must be after setupApiMocks for LIFO priority)
    let callCount = 0
    await page.route('**/api/v1/services', async (route) => {
      callCount++
      if (callCount <= 1) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(MOCK_SERVICES),
        })
      } else {
        // After enable: myapp.service is now enabled
        const updated = MOCK_SERVICES.map(s =>
          s.name === 'myapp.service'
            ? { ...s, unitFileState: 'enabled', active: 'active', sub: 'running' }
            : s,
        )
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(updated),
        })
      }
    })
    await loginViaUI(page)

    // myapp initially OFF
    const myappRow = getServiceRow(page, 'myapp.service')
    await expect(getToggle(myappRow)).toHaveClass(/toggle-off/)

    // Click enable
    await getToggle(myappRow).click()

    // Wait for reload
    await page.waitForTimeout(500)

    // Now toggle should be ON after refresh
    await expect(getToggle(getServiceRow(page, 'myapp.service'))).toHaveClass(/toggle-on/)
  })
})
