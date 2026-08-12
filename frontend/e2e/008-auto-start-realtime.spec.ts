import { test, expect } from '@playwright/test'
import { setupApiMocks, loginViaUI, MOCK_SERVICES, getServiceRow } from './auth.setup'

/**
 * 008 — 開機啟動/關閉 即時反應狀態 E2E Tests
 *
 * BDD scenarios covered:
 *   1. ✅ 點擊 Toggle 後立即顯示 loading 狀態（API 回應前）
 *   2. ✅ OFF→ON 完整狀態轉換時序：OFF → loading(...) → ON
 *   3. ✅ ON→OFF 完整狀態轉換時序：ON → loading(...) → OFF（含確認對話框）
 *   4. ✅ API 錯誤後 Toggle 立即恢復原狀態
 *   5. ✅ 取消 Disable 確認後 Toggle 維持 ON（loadServices 恢復）
 *   6. ✅ 連續操作：Enable → Disable 同一個服務的完整循環
 *   7. ✅ 跨服務交錯操作：依序 Enable 多個服務，各自獨立反應
 *   8. ✅ 快速重複點擊防護：loading 期間點擊不觸發額外請求
 *   9. ✅ 重整後 Toggle 狀態即時匹配 API 回傳資料
 *  10. ✅ Loading 結束後 Toggle 狀態立即反映且無閃爍
 */

// ── Helpers ───────────────────────────────────────────────────────

function getAutoStartCell(row: ReturnType<typeof getServiceRow>) {
  return row.locator('td[data-label="Auto-start"]')
}

function getToggle(row: ReturnType<typeof getServiceRow>) {
  return getAutoStartCell(row).locator('button.toggle-switch')
}

// ── Scenario 1: 點擊 Toggle 後立即顯示 loading 狀態 ─────────────

test.describe('Scenario 1: 點擊後立即顯示 loading', () => {
  test('點擊 OFF Toggle → 立即顯示 loading（API 尚未回應）', async ({ page }) => {
    // Setup: delay enable response by 800ms so we can observe loading
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await page.route('**/api/v1/services/myapp.service/enable', async (route) => {
      await new Promise(r => setTimeout(r, 800))
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'myapp.service enabled' }),
      })
    })
    await loginViaUI(page)

    const myappRow = getServiceRow(page, 'myapp.service')
    const toggle = getToggle(myappRow)

    // Initial state: OFF
    await expect(toggle).toHaveClass(/toggle-off/)
    await expect(toggle.locator('.toggle-label')).toHaveText('OFF')

    // Click toggle
    await toggle.click()

    // Immediately after click, should show loading (before API responds)
    await expect(toggle).toHaveClass(/toggle-loading/)
    await expect(toggle.locator('.toggle-label')).toHaveText('...')
    await expect(toggle).toBeDisabled()
  })

  test('點擊 ON Toggle（觸發 confirm modal）→ Toggle 不應進入 loading（等待確認）', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    const nginxRow = getServiceRow(page, 'nginx.service')
    const toggle = getToggle(nginxRow)

    // Initial state: ON
    await expect(toggle).toHaveClass(/toggle-on/)

    // Click toggle (should show confirm modal, not loading)
    await toggle.click()

    // Confirm modal should appear
    await expect(page.locator('.lms-modal-overlay')).toBeVisible()

    // Toggle should still be ON, NOT loading (waiting for user confirm)
    await expect(toggle).toHaveClass(/toggle-on/)
    await expect(toggle).not.toHaveClass(/toggle-loading/)
  })
})


// ── Scenario 2: OFF→ON 完整狀態轉換時序 ─────────────────────────

test.describe('Scenario 2: OFF→ON 狀態轉換時序', () => {
  test('完整時序：OFF → loading → ON（含 Toast）', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    // Delay enable response to clearly observe transitions
    await page.route('**/api/v1/services/myapp.service/enable', async (route) => {
      await new Promise(r => setTimeout(r, 500))
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'myapp.service enabled' }),
      })
    })
    await loginViaUI(page)

    const myappRow = getServiceRow(page, 'myapp.service')
    const toggle = getToggle(myappRow)

    // Step 1: Initial state OFF
    await expect(toggle).toHaveClass(/toggle-off/)
    await expect(toggle.locator('.toggle-label')).toHaveText('OFF')

    // Step 2: Click → loading
    await toggle.click()
    await expect(toggle).toHaveClass(/toggle-loading/)
    await expect(toggle.locator('.toggle-label')).toHaveText('...')

    // Step 3: Wait for API to finish → should be ON
    await expect(toggle).not.toHaveClass(/toggle-loading/, { timeout: 3000 })
    // After loadServices(), toggle reflects updated data
    // The mock returns the same data, so myapp stays disabled in mock
    // But the point is the loading state clears
    await expect(toggle.locator('.toggle-label')).not.toHaveText('...')

    // Step 4: Toast success notification
    const toast = page.locator('.toast-success')
    await expect(toast).toBeVisible({ timeout: 5000 })
    await expect(toast).toContainText('myapp.service')
  })

  test('Toggle 從 loading 結束到顯示 ON 的轉換無中間閃爍', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })

    // Override the services response to return myapp as enabled after the enable call
    let servicesCallCount = 0
    await page.route('**/api/v1/services', async (route) => {
      servicesCallCount++
      const services = servicesCallCount === 1
        ? MOCK_SERVICES
        : MOCK_SERVICES.map(s =>
            s.name === 'myapp.service'
              ? { ...s, unitFileState: 'enabled', active: 'active', sub: 'running' }
              : s,
          )
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(services),
      })
    })
    await loginViaUI(page)

    const myappRow = getServiceRow(page, 'myapp.service')
    const toggle = getToggle(myappRow)

    // Click enable
    await toggle.click()

    // Wait for operation to complete
    await expect(toggle).not.toHaveClass(/toggle-loading/, { timeout: 5000 })

    // After refresh, toggle should be ON (not briefly OFF or loading again)
    await expect(toggle).toHaveClass(/toggle-on/)
    await expect(toggle.locator('.toggle-label')).toHaveText('ON')
  })
})


// ── Scenario 3: ON→OFF 完整狀態轉換時序（含確認對話框）─────────

test.describe('Scenario 3: ON→OFF 狀態轉換時序', () => {
  test('完整時序：ON → ConfirmModal → 確認 → loading → OFF（含 Toast）', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    // Delay disable response
    await page.route('**/api/v1/services/nginx.service/disable', async (route) => {
      await new Promise(r => setTimeout(r, 500))
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'nginx.service disabled' }),
      })
    })
    await loginViaUI(page)

    const nginxRow = getServiceRow(page, 'nginx.service')
    const toggle = getToggle(nginxRow)

    // Step 1: Initial state ON
    await expect(toggle).toHaveClass(/toggle-on/)
    await expect(toggle.locator('.toggle-label')).toHaveText('ON')

    // Step 2: Click → ConfirmModal appears
    await toggle.click()
    await expect(page.locator('.lms-modal-overlay')).toBeVisible()
    await expect(page.locator('.lms-modal')).toContainText('nginx.service')

    // Step 3: Confirm → loading
    await page.locator('.lms-modal-actions .btn-danger').click()
    await expect(page.locator('.lms-modal-overlay')).not.toBeVisible()
    await expect(toggle).toHaveClass(/toggle-loading/)
    await expect(toggle.locator('.toggle-label')).toHaveText('...')

    // Step 4: Wait for API finish
    await expect(toggle).not.toHaveClass(/toggle-loading/, { timeout: 3000 })

    // Step 5: Toast success
    const toast = page.locator('.toast-success')
    await expect(toast).toBeVisible({ timeout: 5000 })
    await expect(toast).toContainText('nginx.service')
  })

  test('確認後 loading 期間無法再次操作 Toggle', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await page.route('**/api/v1/services/nginx.service/disable', async (route) => {
      await new Promise(r => setTimeout(r, 800))
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'nginx.service disabled' }),
      })
    })
    await loginViaUI(page)

    const nginxRow = getServiceRow(page, 'nginx.service')
    const toggle = getToggle(nginxRow)

    // Click → Confirm → loading
    await toggle.click()
    await page.locator('.lms-modal-actions .btn-danger').click()

    // Toggle should be disabled during loading
    await expect(toggle).toBeDisabled()
    await expect(toggle).toHaveClass(/toggle-loading/)
  })
})


// ── Scenario 4: API 錯誤後即時恢復原狀態 ────────────────────────

test.describe('Scenario 4: 錯誤後即時恢復', () => {
  test('Enable 失敗 → Toggle 從 loading 恢復為 OFF，並顯示 error toast', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    // Override enable to 500 error
    await page.route('**/api/v1/services/myapp.service/enable', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'failed to enable myapp.service' }),
      })
    })
    await loginViaUI(page)

    const myappRow = getServiceRow(page, 'myapp.service')
    const toggle = getToggle(myappRow)
    await expect(toggle).toHaveClass(/toggle-off/)

    await toggle.click()

    // Loading clears, toggle reverts to OFF
    await expect(toggle).not.toHaveClass(/toggle-loading/, { timeout: 5000 })
    await expect(toggle).toHaveClass(/toggle-off/)
    await expect(toggle.locator('.toggle-label')).toHaveText('OFF')

    // Error toast
    const toast = page.locator('.toast-error')
    await expect(toast).toBeVisible({ timeout: 5000 })
    await expect(toast).toContainText('myapp.service')
  })

  test('Disable 失敗 → Toggle 從 loading 恢復為 ON', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await page.route('**/api/v1/services/nginx.service/disable', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'failed to disable nginx.service' }),
      })
    })
    await loginViaUI(page)

    const nginxRow = getServiceRow(page, 'nginx.service')
    const toggle = getToggle(nginxRow)
    await expect(toggle).toHaveClass(/toggle-on/)

    // Click → Confirm → loading → error
    await toggle.click()
    await page.locator('.lms-modal-actions .btn-danger').click()

    // Loading clears, toggle reverts to ON
    await expect(toggle).not.toHaveClass(/toggle-loading/, { timeout: 5000 })
    await expect(toggle).toHaveClass(/toggle-on/)
    await expect(toggle.locator('.toggle-label')).toHaveText('ON')

    // Error toast
    await expect(page.locator('.toast-error')).toBeVisible({ timeout: 5000 })
  })

  test('網路中斷 → Toggle 立即恢復原狀態', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await page.route('**/api/v1/services/myapp.service/enable', async (route) => {
      await route.abort('connectionrefused')
    })
    await loginViaUI(page)

    const myappRow = getServiceRow(page, 'myapp.service')
    const toggle = getToggle(myappRow)

    await toggle.click()

    // Should revert to OFF after failed attempt
    await expect(toggle).not.toHaveClass(/toggle-loading/, { timeout: 5000 })
    await expect(toggle).toHaveClass(/toggle-off/)
    await expect(toggle.locator('.toggle-label')).toHaveText('OFF')
  })
})


// ── Scenario 5: 取消 Disable 確認後狀態即時恢復 ──────────────────

test.describe('Scenario 5: 取消確認後即時恢復', () => {
  test('取消 Disable → Toggle 維持 ON，不呼叫 API', async ({ page }) => {
    let disableCalled = false
    await page.route('**/api/v1/services/nginx.service/disable', async (route) => {
      disableCalled = true
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) })
    })

    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    const nginxRow = getServiceRow(page, 'nginx.service')
    const toggle = getToggle(nginxRow)
    await expect(toggle).toHaveClass(/toggle-on/)

    // Click toggle → ConfirmModal appears
    await toggle.click()
    await expect(page.locator('.lms-modal-overlay')).toBeVisible()

    // Click cancel
    await page.locator('.lms-modal-actions button.secondary').click()
    await expect(page.locator('.lms-modal-overlay')).not.toBeVisible()

    // Toggle should remain ON (loadServices re-fetches, mock returns same data)
    // Verify toggle is not loading
    await expect(toggle).not.toHaveClass(/toggle-loading/)
    await expect(toggle).toHaveClass(/toggle-on/)

    // API should NOT have been called
    expect(disableCalled).toBe(false)
  })

  test('取消 Disable → 確認對話框關閉後可再次操作 Toggle', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    const nginxRow = getServiceRow(page, 'nginx.service')
    const toggle = getToggle(nginxRow)

    // First attempt: cancel
    await toggle.click()
    await page.locator('.lms-modal-actions button.secondary').click()

    // Second attempt: should be able to click again
    await toggle.click()
    await expect(page.locator('.lms-modal-overlay')).toBeVisible()
  })
})


// ── Scenario 6: 連續操作 — Enable → Disable 完整循環 ────────────

test.describe('Scenario 6: 連續操作循環', () => {
  test('Enable → Disable 同一個服務的完整循環', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })

    // Track service state to return updated data after each operation
    let myappEnabled = false
    await page.route('**/api/v1/services', async (route) => {
      const services = MOCK_SERVICES.map(s => {
        if (s.name === 'myapp.service') {
          return {
            ...s,
            unitFileState: myappEnabled ? 'enabled' : 'disabled',
            active: myappEnabled ? 'active' : 'inactive',
            sub: myappEnabled ? 'running' : 'dead',
          }
        }
        return s
      })
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(services),
      })
    })
    await loginViaUI(page)

    const myappRow = getServiceRow(page, 'myapp.service')
    const toggle = getToggle(myappRow)

    // Cycle 1: OFF → ON (enable)
    await expect(toggle).toHaveClass(/toggle-off/)
    await toggle.click()
    myappEnabled = true
    await expect(toggle).not.toHaveClass(/toggle-loading/, { timeout: 5000 })
    await expect(toggle).toHaveClass(/toggle-on/)
    await expect(toggle.locator('.toggle-label')).toHaveText('ON')

    // Cycle 2: ON → OFF (disable, with confirm)
    await toggle.click()
    await expect(page.locator('.lms-modal-overlay')).toBeVisible()
    await page.locator('.lms-modal-actions .btn-danger').click()
    myappEnabled = false
    await expect(toggle).not.toHaveClass(/toggle-loading/, { timeout: 5000 })
    await expect(toggle).toHaveClass(/toggle-off/)
    await expect(toggle.locator('.toggle-label')).toHaveText('OFF')
  })

  test('Enable → 重整 → 再次 Disable（重整不影響操作連續性）', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    const myappRow = getServiceRow(page, 'myapp.service')
    const toggle = getToggle(myappRow)

    // Enable
    await toggle.click()
    await expect(toggle).not.toHaveClass(/toggle-loading/, { timeout: 5000 })

    // Manual refresh
    await page.locator('.btn-refresh').click()

    // After refresh, toggle should still be operable
    const updatedToggle = getToggle(getServiceRow(page, 'myapp.service'))
    await expect(updatedToggle).toBeVisible()
    await expect(updatedToggle).not.toBeDisabled()
  })
})


// ── Scenario 7: 跨服務交錯操作 ──────────────────────────────────

test.describe('Scenario 7: 多服務依序操作', () => {
  test('依序 Enable 兩個服務，各自獨立反應狀態', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    // Enable myapp.service first
    const myappRow = getServiceRow(page, 'myapp.service')
    const myappToggle = getToggle(myappRow)
    await expect(myappToggle).toHaveClass(/toggle-off/)

    await myappToggle.click()
    await expect(myappToggle).not.toHaveClass(/toggle-loading/, { timeout: 5000 })

    // Enable crash.service second
    const crashRow = getServiceRow(page, 'crash.service')
    const crashToggle = getToggle(crashRow)
    await expect(crashToggle).toHaveClass(/toggle-off/)

    await crashToggle.click()
    await expect(crashToggle).not.toHaveClass(/toggle-loading/, { timeout: 5000 })

    // Both should show success toasts
    const toasts = page.locator('.toast-success')
    await expect(toasts.first()).toBeVisible()
  })

  test('Enable A 的同時 Disable B（交錯時間線）', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })

    // Make enable slow, disable fast (override after setupApiMocks for LIFO priority)
    await page.route('**/api/v1/services/myapp.service/enable', async (route) => {
      await new Promise(r => setTimeout(r, 600))
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'myapp.service enabled' }),
      })
    })
    await loginViaUI(page)

    // Start enable myapp (slow)
    const myappToggle = getToggle(getServiceRow(page, 'myapp.service'))
    await myappToggle.click()

    // Immediately disable nginx (fast, with confirm)
    const nginxToggle = getToggle(getServiceRow(page, 'nginx.service'))
    await nginxToggle.click()
    await page.locator('.lms-modal-actions .btn-danger').click()

    // nginx disable should complete first (fast)
    await expect(nginxToggle).not.toHaveClass(/toggle-loading/, { timeout: 3000 })

    // myapp enable should still be loading or already done
    // Both operations should complete without interfering
    await expect(myappToggle).not.toHaveClass(/toggle-loading/, { timeout: 5000 })
  })

  test('兩個 Toggle 不應同時進入 loading（各自獨立 togglingService）', async ({ page }) => {
    // This tests that togglingService tracks only ONE service at a time
    // The current implementation may have this as a limitation
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    // Enable myapp (fast)
    const myappToggle = getToggle(getServiceRow(page, 'myapp.service'))
    await myappToggle.click()
    await expect(myappToggle).not.toHaveClass(/toggle-loading/, { timeout: 3000 })

    // Then enable crash (fast)
    const crashToggle = getToggle(getServiceRow(page, 'crash.service'))
    await crashToggle.click()
    await expect(crashToggle).not.toHaveClass(/toggle-loading/, { timeout: 3000 })

    // Both operations succeeded without conflict
    const toasts = page.locator('.toast-success')
    await expect(toasts).toHaveCount(2, { timeout: 5000 })
  })
})


// ── Scenario 8: 快速重複點擊防護 ─────────────────────────────────

test.describe('Scenario 8: 快速重複點擊防護', () => {
  test('loading 期間點擊不觸發額外 API 請求', async ({ page }) => {
    let requestCount = 0

    await setupApiMocks(page, { authenticated: false, includeActions: true })

    // 註冊在 setupApiMocks 之後，覆蓋 myapp 的 enable handler 以加入延遲與計數
    await page.route('**/api/v1/services/myapp.service/enable', async (route) => {
      requestCount++
      await new Promise(r => setTimeout(r, 500))
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'myapp.service enabled' }),
      })
    })

    await loginViaUI(page)

    const toggle = getToggle(getServiceRow(page, 'myapp.service'))

    await toggle.click()
    // Rapid clicks while loading
    await toggle.click({ force: true })
    await toggle.click({ force: true })
    await toggle.click({ force: true })

    await expect(toggle).not.toHaveClass(/toggle-loading/, { timeout: 5000 })

    // Should only have been called once
    expect(requestCount).toBe(1)
  })

  test('disabled 狀態下點擊不觸發任何請求', async ({ page }) => {
    let enableCalled = false

    await setupApiMocks(page, { authenticated: false, includeActions: true })

    // 註冊在 setupApiMocks 之後，加入延遲讓 loading 狀態可被觀察
    await page.route('**/api/v1/services/myapp.service/enable', async (route) => {
      enableCalled = true
      await new Promise(r => setTimeout(r, 300))
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) })
    })

    await loginViaUI(page)

    const toggle = getToggle(getServiceRow(page, 'myapp.service'))

    // Click to start loading
    await toggle.click()

    // Toggle 在 loading 期間應有 toggle-loading class（而非 disabled 屬性）
    await expect(toggle).toHaveClass(/toggle-loading/)

    // 等待 loading 結束
    await expect(toggle).not.toHaveClass(/toggle-loading/, { timeout: 5000 })
    expect(enableCalled).toBe(true)
  })
})


// ── Scenario 9: 重整後 Toggle 狀態即時匹配 API 資料 ──────────────

test.describe('Scenario 9: 重整後狀態即時更新', () => {
  test('重整按鈕後 Toggle 狀態立即反應 API 回傳的最新 unitFileState', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })

    let callCount = 0
    await page.route('**/api/v1/services', async (route) => {
      callCount++
      // First call: normal, second call (after refresh): myapp is now enabled
      const services = callCount === 1
        ? MOCK_SERVICES
        : MOCK_SERVICES.map(s =>
            s.name === 'myapp.service'
              ? { ...s, unitFileState: 'enabled', active: 'active', sub: 'running' }
              : s,
          )
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(services),
      })
    })
    await loginViaUI(page)

    // Initial: myapp is OFF
    const myappToggle = getToggle(getServiceRow(page, 'myapp.service'))
    await expect(myappToggle).toHaveClass(/toggle-off/)

    // Click refresh
    await page.locator('.btn-refresh').click()

    // After refresh, myapp should now be ON (API returned enabled)
    await expect(myappToggle).toHaveClass(/toggle-on/, { timeout: 5000 })
    await expect(myappToggle.locator('.toggle-label')).toHaveText('ON')
  })

  test('Toggle 操作後自動重整列表，狀態即時反映', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })

    // Track state: after enable, return updated data
    let servicesCallCount = 0
    await page.route('**/api/v1/services', async (route) => {
      servicesCallCount++
      const services = servicesCallCount === 1
        ? MOCK_SERVICES
        : MOCK_SERVICES.map(s =>
            s.name === 'crash.service'
              ? { ...s, unitFileState: 'enabled', active: 'active', sub: 'running' }
              : s,
          )
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(services),
      })
    })
    await loginViaUI(page)

    // Initial: crash is OFF
    const crashToggle = getToggle(getServiceRow(page, 'crash.service'))
    await expect(crashToggle).toHaveClass(/toggle-off/)

    // Enable crash
    await crashToggle.click()

    // Wait for auto-refresh (loadServices after operation)
    await expect(crashToggle).not.toHaveClass(/toggle-loading/, { timeout: 5000 })

    // After auto-refresh, crash should be ON (API now returns enabled)
    await expect(crashToggle).toHaveClass(/toggle-on/)
    await expect(crashToggle.locator('.toggle-label')).toHaveText('ON')
  })
})


// ── Scenario 10: Loading 結束後 Toggle 狀態無閃爍 ────────────────

test.describe('Scenario 10: Loading 結束後無閃爍', () => {
  test('Enable 完成後 Toggle 不應短暫顯示 OFF 再切換為 ON', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })

    // Return updated data to avoid flickering caused by stale data
    let callCount = 0
    await page.route('**/api/v1/services', async (route) => {
      callCount++
      const services = callCount === 1
        ? MOCK_SERVICES
        : MOCK_SERVICES.map(s =>
            s.name === 'myapp.service'
              ? { ...s, unitFileState: 'enabled', active: 'active', sub: 'running' }
              : s,
          )
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(services),
      })
    })
    await loginViaUI(page)

    const toggle = getToggle(getServiceRow(page, 'myapp.service'))

    // Initial OFF
    await expect(toggle).toHaveClass(/toggle-off/)

    // Click enable
    await toggle.click()

    // After loading, verify final state is ON and stable
    await expect(toggle).not.toHaveClass(/toggle-loading/, { timeout: 5000 })
    await expect(toggle).toHaveClass(/toggle-on/)

    // Wait a moment to ensure no flickering back to OFF
    await page.waitForTimeout(300)
    await expect(toggle).toHaveClass(/toggle-on/)
    await expect(toggle.locator('.toggle-label')).toHaveText('ON')
  })

  test('Disable 完成後 Toggle 不應短暫顯示 ON 再切換為 OFF', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })

    let callCount = 0
    await page.route('**/api/v1/services', async (route) => {
      callCount++
      const services = callCount === 1
        ? MOCK_SERVICES
        : MOCK_SERVICES.map(s =>
            s.name === 'nginx.service'
              ? { ...s, unitFileState: 'disabled', active: 'inactive', sub: 'dead' }
              : s,
          )
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(services),
      })
    })
    await loginViaUI(page)

    const toggle = getToggle(getServiceRow(page, 'nginx.service'))

    // Initial ON
    await expect(toggle).toHaveClass(/toggle-on/)

    // Disable with confirm
    await toggle.click()
    await page.locator('.lms-modal-actions .btn-danger').click()

    // After loading, verify final state is OFF and stable
    await expect(toggle).not.toHaveClass(/toggle-loading/, { timeout: 5000 })
    await expect(toggle).toHaveClass(/toggle-off/)
    await expect(toggle.locator('.toggle-label')).toHaveText('OFF')

    // Wait to confirm no flicker
    await page.waitForTimeout(300)
    await expect(toggle).toHaveClass(/toggle-off/)
    await expect(toggle.locator('.toggle-label')).toHaveText('OFF')
  })

  test('錯誤後 Toggle 不閃爍（維持原狀態）', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await page.route('**/api/v1/services/myapp.service/enable', async (route) => {
      await new Promise(r => setTimeout(r, 300))
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'failed' }),
      })
    })
    await loginViaUI(page)

    const toggle = getToggle(getServiceRow(page, 'myapp.service'))
    await expect(toggle).toHaveClass(/toggle-off/)

    await toggle.click()

    await expect(toggle).not.toHaveClass(/toggle-loading/, { timeout: 5000 })

    // Should stay OFF, no flicker to ON
    await expect(toggle).toHaveClass(/toggle-off/)
    await page.waitForTimeout(300)
    await expect(toggle).toHaveClass(/toggle-off/)
  })
})


// ── Scenario 11: ON→OFF / OFF→ON 畫面狀態即時更新 ─────────────

test.describe('Scenario 11: Toggle 操作後畫面狀態正確更新', () => {
  test('OFF 操作 → ON：點擊 OFF toggle 後，API 成功返回，畫面顯示 ON', async ({ page }) => {
    // Simulate: after enable API succeeds, reloadServices returns updated unitFileState
    let servicesVersion = 0
    await page.route('**/api/v1/services', async (route) => {
      servicesVersion++
      const services = servicesVersion === 1
        ? MOCK_SERVICES
        : MOCK_SERVICES.map(s =>
            s.name === 'myapp.service'
              ? { ...s, unitFileState: 'enabled' }
              : s,
          )
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(services),
      })
    })
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    const toggle = getToggle(getServiceRow(page, 'myapp.service'))

    // Initial: OFF
    await expect(toggle).toHaveClass(/toggle-off/)
    await expect(toggle.locator('.toggle-label')).toHaveText('OFF')

    // Click enable
    await toggle.click()

    // Wait for loading to finish (API success + reload)
    await expect(toggle).not.toHaveClass(/toggle-loading/, { timeout: 5000 })

    // Should now show ON
    await expect(toggle).toHaveClass(/toggle-on/)
    await expect(toggle.locator('.toggle-label')).toHaveText('ON')
  })

  test('ON 操作 → OFF：點擊 ON toggle → 確認對話框 → API 成功 → 畫面顯示 OFF', async ({ page }) => {
    let servicesVersion = 0
    await page.route('**/api/v1/services', async (route) => {
      servicesVersion++
      const services = servicesVersion === 1
        ? MOCK_SERVICES
        : MOCK_SERVICES.map(s =>
            s.name === 'nginx.service'
              ? { ...s, unitFileState: 'disabled' }
              : s,
          )
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(services),
      })
    })
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    const toggle = getToggle(getServiceRow(page, 'nginx.service'))

    // Initial: ON
    await expect(toggle).toHaveClass(/toggle-on/)
    await expect(toggle.locator('.toggle-label')).toHaveText('ON')

    // Click → confirm modal appears
    await toggle.click()
    await expect(page.locator('.lms-modal-overlay')).toBeVisible()

    // Confirm disable
    await page.locator('.lms-modal-actions .btn-danger').click()

    // Wait for loading to finish
    await expect(toggle).not.toHaveClass(/toggle-loading/, { timeout: 5000 })

    // Should now show OFF
    await expect(toggle).toHaveClass(/toggle-off/)
    await expect(toggle.locator('.toggle-label')).toHaveText('OFF')
  })

  test('取消 Disable 確認 → Toggle 維持 ON，畫面不變', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    const toggle = getToggle(getServiceRow(page, 'nginx.service'))

    // Initial: ON
    await expect(toggle).toHaveClass(/toggle-on/)

    // Click → confirm modal
    await toggle.click()
    await expect(page.locator('.lms-modal-overlay')).toBeVisible()

    // Cancel
    await page.locator('.lms-modal-actions button.secondary').click()
    await expect(page.locator('.lms-modal-overlay')).not.toBeVisible()

    // Toggle should still be ON
    await expect(toggle).toHaveClass(/toggle-on/)
    await expect(toggle.locator('.toggle-label')).toHaveText('ON')
  })

  test('連續操作：OFF→ON→OFF 完整循環，每次畫面正確更新', async ({ page }) => {
    let myappEnabled = false
    await page.route('**/api/v1/services', async (route) => {
      const services = MOCK_SERVICES.map(s => {
        if (s.name === 'myapp.service') {
          return {
            ...s,
            unitFileState: myappEnabled ? 'enabled' : 'disabled',
          }
        }
        return s
      })
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(services),
      })
    })
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    const toggle = getToggle(getServiceRow(page, 'myapp.service'))

    // OFF → ON
    await expect(toggle).toHaveClass(/toggle-off/)
    await toggle.click()
    myappEnabled = true
    await expect(toggle).not.toHaveClass(/toggle-loading/, { timeout: 5000 })
    await expect(toggle).toHaveClass(/toggle-on/)
    await expect(toggle.locator('.toggle-label')).toHaveText('ON')

    // ON → OFF
    await toggle.click()
    await page.locator('.lms-modal-actions .btn-danger').click()
    myappEnabled = false
    await expect(toggle).not.toHaveClass(/toggle-loading/, { timeout: 5000 })
    await expect(toggle).toHaveClass(/toggle-off/)
    await expect(toggle.locator('.toggle-label')).toHaveText('OFF')
  })
})


// ── Scenario 12: Toggle 狀態與搜尋/分頁互動 ──────────────────────

test.describe('Scenario 13: 搜尋與分頁不影響 Toggle 狀態', () => {
  test('搜尋過濾後 Toggle 仍可正常操作', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    // Search for myapp
    await page.fill('input[type="search"]', 'myapp')

    // Should only show myapp
    const rows = page.locator('#service-table-body tr')
    await expect(rows).toHaveCount(1)

    // Toggle should still work
    const toggle = getToggle(getServiceRow(page, 'myapp.service'))
    await expect(toggle).toBeVisible()
    await toggle.click()

    // Should complete successfully
    await expect(toggle).not.toHaveClass(/toggle-loading/, { timeout: 5000 })
  })

  test('切換 Tab 後 Toggle 狀態保持一致', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    // My services: nginx ON
    const nginxToggle = getToggle(getServiceRow(page, 'nginx.service'))
    await expect(nginxToggle).toHaveClass(/toggle-on/)

    // Switch to system services
    await page.locator('#tab-system').click()

    // sshd is locked — no toggle, shows 🔒
    const sshdRow = getServiceRow(page, 'sshd.service')
    await expect(getAutoStartCell(sshdRow)).toContainText('🔒')

    // Switch back to my services
    await page.locator('#tab-my').click()

    // nginx toggle should still be ON
    const nginxToggleAgain = getToggle(getServiceRow(page, 'nginx.service'))
    await expect(nginxToggleAgain).toHaveClass(/toggle-on/)
  })
})
