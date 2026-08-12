import { test, expect } from '@playwright/test'
import { setupApiMocks, loginViaUI, MOCK_SERVICES, getServiceRow, getActionButton } from './auth.setup'

/**
 * 002 — 管理員管理 systemd 服務 E2E Tests
 *
 * BDD scenarios covered:
 *   1. ✅ 載入服務列表 — 驗證表格、統計數字
 *   2. ✅ 搜尋過濾 — 輸入關鍵字僅顯示匹配服務
 *   3. ✅ 停止服務確認對話框 — Stop → ConfirmModal → 確認 → API call
 *   4. ✅ Start 操作無需確認 — 點 Start → 直接 API call
 *   5. ✅ 鎖定服務不顯示操作按鈕 → sshd 顯示 🔒
 *   6. ✅ Toast 通知 — 操作後顯示成功/失敗 toast
 *   7. ✅ 分頁切換 — "我的服務" vs "系統服務"
 *   8. ✅ 重新整理服務列表
 *   9. ✅ 特殊字元服務名稱
 *  10. ✅ 按鈕顯示/隱藏規則 (active/inactive/failed/locked)
 */

test.describe('Scenario 1: 載入服務列表', () => {
  test('應顯示所有 mock 服務，包含名稱、狀態與操作按鈕', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    await expect(page.locator('.table-wrapper')).toBeVisible()

    // Default tab is "My Services" — only unlocked services (4 of 5)
    const tbody = page.locator('#service-table-body')
    const unlockedCount = MOCK_SERVICES.filter(s => !s.locked).length
    await expect(tbody.locator('tr')).toHaveCount(unlockedCount)

    await expect(tbody).toContainText('nginx.service')
    await expect(tbody).toContainText('myapp.service')
    await expect(tbody).toContainText('crash.service')
    await expect(tbody).toContainText('bus-name@.service')
    // sshd is locked, should NOT be visible in "My Services"
    await expect(tbody).not.toContainText('sshd.service')

    await expect(tbody).toContainText('Running')
    await expect(tbody).toContainText('Dead')
    await expect(tbody).toContainText('Failed')
  })

  test('統計欄應顯示正確的服務數量', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    await expect(page.locator('.stats-bar')).toBeVisible()

    // Default tab is "My Services" → only unlocked services
    // Total: 6 unlocked (nginx, myapp, crash, bus-name@, static-svc, masked-svc)
    await expect(page.locator('.stat-total .stat-value')).toHaveText('6')
    // Running: nginx, bus-name@, static-svc = 3
    await expect(page.locator('.stat-active .stat-value')).toHaveText('3')
    // Failed: crash = 1
    await expect(page.locator('.stat-failed .stat-value')).toHaveText('1')
  })

  test('Header 應顯示使用者名稱', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)
    await expect(page.locator('[data-testid="account-btn"]')).toContainText('admin')
  })
})


test.describe('Scenario 2: 搜尋過濾', () => {
  test('搜尋 "nginx" 應僅顯示 nginx.service', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    await page.locator('.search-wrap input[type="search"]').fill('nginx')

    const rows = page.locator('#service-table-body tr')
    await expect(rows).toHaveCount(1)
    await expect(rows.first()).toContainText('nginx.service')
  })

  test('搜尋不存在的服務應顯示空狀態', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    await page.locator('.search-wrap input[type="search"]').fill('zzzz_not_exist')

    await expect(page.locator('.empty-state')).toBeVisible()
  })

  test('清除搜尋後應恢復完整列表', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    await page.locator('.search-wrap input[type="search"]').fill('nginx')
    await expect(page.locator('#service-table-body tr')).toHaveCount(1)

    await page.locator('.search-clear').click()
    // Restores to tab-filtered list ("My Services" = 4)
    const unlockedCount = MOCK_SERVICES.filter(s => !s.locked).length
    await expect(page.locator('#service-table-body tr')).toHaveCount(unlockedCount)
  })
})


test.describe('Scenario 3 & 4: 服務操作與確認對話框', () => {
  test('點擊 Stop 按鈕應彈出 ConfirmModal，確認後執行 API', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    const nginxRow = getServiceRow(page, 'nginx.service')
    const stopBtn = getActionButton(nginxRow, 'stop')
    await expect(stopBtn).toBeVisible()

    const stopRequest = page.waitForRequest(req =>
      req.url().includes('/api/v1/services/nginx.service/stop') && req.method() === 'POST',
    )

    await stopBtn.click()

    // ConfirmModal should appear
    await expect(page.locator('.lms-modal-overlay')).toBeVisible()
    await expect(page.locator('.lms-modal')).toContainText('Are you sure you want to stop nginx.service?')

    // Click confirm
    await page.locator('.lms-modal-actions .btn-danger').click()

    // Modal closes and API is called
    await expect(page.locator('.lms-modal-overlay')).not.toBeVisible()
    await stopRequest
  })

  test('在 ConfirmModal 中點擊取消不應執行操作', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    const nginxRow = getServiceRow(page, 'nginx.service')
    await getActionButton(nginxRow, 'stop').click()

    await expect(page.locator('.lms-modal-overlay')).toBeVisible()

    // Click cancel (the secondary button)
    await page.locator('.lms-modal-actions button.secondary').click()
    await expect(page.locator('.lms-modal-overlay')).not.toBeVisible()
  })

  test('點擊 Start 按鈕應直接執行，不彈 ConfirmModal', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    const myappRow = getServiceRow(page, 'myapp.service')
    const startBtn = getActionButton(myappRow, 'start')
    await expect(startBtn).toBeVisible()

    const startRequest = page.waitForRequest(req =>
      req.url().includes('/api/v1/services/myapp.service/start') && req.method() === 'POST',
    )

    await startBtn.click()

    // No modal should appear
    await expect(page.locator('.lms-modal-overlay')).not.toBeVisible()
    await startRequest
  })

  test('點擊 Restart 按鈕應彈出 ConfirmModal', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    const nginxRow = getServiceRow(page, 'nginx.service')
    const restartBtn = getActionButton(nginxRow, 'restart')
    await expect(restartBtn).toBeVisible()

    const restartRequest = page.waitForRequest(req =>
      req.url().includes('/api/v1/services/nginx.service/restart') && req.method() === 'POST',
    )

    await restartBtn.click()

    await expect(page.locator('.lms-modal-overlay')).toBeVisible()
    await expect(page.locator('.lms-modal')).toContainText('Are you sure you want to restart nginx.service?')

    await page.locator('.lms-modal-actions .btn-danger').click()
    await expect(page.locator('.lms-modal-overlay')).not.toBeVisible()
    await restartRequest
  })
})


test.describe('Scenario 5: 鎖定服務', () => {
  test('鎖定服務 sshd 應顯示 🔒 圖示，不顯示操作按鈕', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    // Switch to "System Services" tab to see locked services
    await page.locator('#tab-system').click()

    const sshdRow = getServiceRow(page, 'sshd.service')
    await expect(sshdRow).toBeVisible()
    await expect(sshdRow.locator('.locked-badge').first()).toBeVisible()
    await expect(sshdRow.locator('.locked-badge').first()).toContainText('🔒')

    // 僅保留 Logs 按鈕（無 Start/Stop/Restart）
    await expect(sshdRow.locator('button')).toHaveCount(1)
    await expect(sshdRow.locator('button.btn-act-logs')).toBeVisible()
  })
})


test.describe('Scenario 6: Toast 通知', () => {
  test('成功啟動服務後應顯示 success toast', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    const myappRow = getServiceRow(page, 'myapp.service')
    await getActionButton(myappRow, 'start').click()

    const toast = page.locator('.toast-success')
    await expect(toast).toBeVisible({ timeout: 5000 })
    await expect(toast).toContainText('myapp.service')
    await expect(toast).toContainText('started')
  })

  test('操作失敗時應顯示 error toast', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    // Override start for crash.service to return 500
    await page.route('**/api/v1/services/crash.service/start', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'failed to start crash.service' }),
      })
    })

    const crashRow = getServiceRow(page, 'crash.service')
    await getActionButton(crashRow, 'start').click()

    const toast = page.locator('.toast-error')
    await expect(toast).toBeVisible({ timeout: 5000 })
  })
})


test.describe('Scenario 7: 分頁切換', () => {
  test('預設顯示「我的服務」分頁（locked=false）', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    await expect(page.locator('#tab-my')).toHaveClass(/active/)

    // Only unlocked services (6 of 7)
    await expect(page.locator('#service-table-body tr')).toHaveCount(6)
    await expect(page.locator('#service-table-body')).not.toContainText('sshd.service')
  })

  test('切換到「系統服務」僅顯示 locked=true 的服務', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    await page.locator('#tab-system').click()

    // Only locked services (sshd = 1)
    await expect(page.locator('#service-table-body tr')).toHaveCount(1)
    await expect(page.locator('#service-table-body')).toContainText('sshd.service')
  })
})


test.describe('按鈕顯示/隱藏規則', () => {
  test('active (running) 服務：顯示 Stop + Restart，不顯示 Start', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    const nginxRow = getServiceRow(page, 'nginx.service')
    await expect(getActionButton(nginxRow, 'start')).not.toBeVisible()
    await expect(getActionButton(nginxRow, 'stop')).toBeVisible()
    await expect(getActionButton(nginxRow, 'restart')).toBeVisible()
  })

  test('inactive (dead) 服務：顯示 Start + Restart，不顯示 Stop', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    const myappRow = getServiceRow(page, 'myapp.service')
    await expect(getActionButton(myappRow, 'start')).toBeVisible()
    await expect(getActionButton(myappRow, 'stop')).not.toBeVisible()
    await expect(getActionButton(myappRow, 'restart')).toBeVisible()
  })

  test('failed 服務：顯示 Start + Restart，不顯示 Stop', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    const crashRow = getServiceRow(page, 'crash.service')
    await expect(getActionButton(crashRow, 'start')).toBeVisible()
    await expect(getActionButton(crashRow, 'stop')).not.toBeVisible()
    await expect(getActionButton(crashRow, 'restart')).toBeVisible()
  })
})


test.describe('特殊字元服務名稱', () => {
  test('bus-name@.service 應正確顯示並可操作', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    const row = getServiceRow(page, 'bus-name@.service')
    await expect(row).toBeVisible()
    await expect(row.locator('td[data-label="Name"]')).toContainText('bus-name@.service')

    // active/running and unlocked: should show Stop + Restart
    await expect(getActionButton(row, 'stop')).toBeVisible()
    await expect(getActionButton(row, 'restart')).toBeVisible()
  })
})


test.describe('重新整理 (Refresh)', () => {
  test('點擊重新整理按鈕應重新載入服務列表', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    const refreshRequest = page.waitForRequest(req =>
      req.url().endsWith('/api/v1/services') && req.method() === 'GET',
    )

    // Click refresh button in header
    await page.locator('.btn-refresh').click()
    await refreshRequest
  })
})
