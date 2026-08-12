import { test, expect } from '@playwright/test'
import { setupApiMocks, loginViaUI, getServiceRow } from './auth.setup'

/**
 * 017 — 手機版儀表板修正（使用者回饋）
 *
 * Scenarios covered:
 *   1. ✅ 手機版：隱藏批次 idle 提示區塊「☑ 勾選服務後，可在此批次 啟動 / 停止 / 重啟」，
 *        勾選服務後工具列才出現
 *   2. ✅ 手機版中文：按鈕顯示 啟動 / 停止 / 重啟 / 日誌（不再顯示英文 Start/Stop/Restart）
 *   3. ✅ 按下 start / stop / restart 後「開機啟動」狀態不被關閉
 *        （WebSocket status_change 未帶 unitFileState 時不得覆蓋原本狀態）
 */

test.describe('017 — 手機版儀表板修正', () => {
  test.use({ viewport: { width: 375, height: 812 } })

  test('手機版：批次 idle 提示區塊隱藏（桌面板仍顯示）', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    // 手機版（375px）：整個 batchbar（含「☑ 勾選服務後…」提示）隱藏
    await expect(page.locator('.batchbar')).not.toBeVisible()
    await expect(page.locator('.bb-hint')).not.toBeVisible()

    // 桌面板（1280px）：idle 提示仍應顯示（不影響批次工具列原有行為）
    await page.setViewportSize({ width: 1280, height: 800 })
    await expect(page.locator('.batchbar')).toBeVisible()
    await expect(page.locator('.bb-hint')).toBeVisible()
  })

  test('手機版中文：操作按鈕顯示 啟動 / 停止 / 重啟 / 日誌', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('lms-lang', 'zh-TW'))
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    // inactive 的 myapp → 啟動 + 重啟 + 日誌（限定在 actions 區塊，避免誤配 auto-start toggle）
    const myappActions = getServiceRow(page, 'myapp.service').locator('.actions')
    await expect(myappActions.locator('.btn-act-start .btn-label')).toHaveText('啟動')
    await expect(myappActions.locator('.btn-act-restart .btn-label')).toHaveText('重啟')
    await expect(myappActions.locator('.btn-act-logs .btn-label')).toHaveText('日誌')
    // 不應再出現英文 Start/Stop
    await expect(myappActions).not.toContainText('Start')

    // active 的 nginx → 停止 + 重啟
    const nginxActions = getServiceRow(page, 'nginx.service').locator('.actions')
    await expect(nginxActions.locator('.btn-act-stop .btn-label')).toHaveText('停止')
    await expect(nginxActions.locator('.btn-act-restart .btn-label')).toHaveText('重啟')
    await expect(nginxActions).not.toContainText('Stop')
  })

  test('start/stop/restart 後「開機啟動」狀態不被 WebSocket status_change 關閉', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('lms-lang', 'zh-TW'))
    await setupApiMocks(page, { authenticated: false, includeActions: true })

    // 攔截 WebSocket，保留連線供測試觸發（模擬 D-Bus monitor 的 status_change 推播）
    let wsConn: { send: (msg: string) => void } | null = null
    await page.routeWebSocket('**/api/v1/ws', (ws) => {
      wsConn = ws
    })

    await loginViaUI(page)

    // nginx 開機啟動原本為 ON
    const nginxRow = getServiceRow(page, 'nginx.service')
    const toggle = nginxRow.locator('button.toggle-switch')
    await expect(toggle).toHaveClass(/toggle-on/)
    await expect(toggle.locator('.toggle-label')).toHaveText('ON')

    // 按下 Stop → ConfirmModal → 確認
    await nginxRow.locator('.actions .btn-act-stop').click()
    await expect(page.locator('.lms-modal-overlay')).toBeVisible()
    await page.locator('.lms-modal-actions .btn-danger').click()
    await expect(page.locator('.toast-success')).toBeVisible({ timeout: 5000 })

    // 模擬 systemctl stop 後 systemd 推的 PropertiesChanged signal：
    // 只帶 active/sub，不帶 unitFileState（Go omitempty 會省略此欄位）
    expect(wsConn).toBeTruthy()
    wsConn!.send(JSON.stringify({
      type: 'status_change',
      name: 'nginx.service',
      active: 'inactive',
      sub: 'dead',
      // unitFileState 刻意省略
    }))

    // 證明訊息確實被處理：狀態欄應更新為「未啟用」
    await expect(nginxRow.locator('td[data-label="啟用狀態"]')).toContainText('未啟用')

    // 操作完成後：開機啟動仍維持 ON（未被 status_change 覆蓋）
    await expect(toggle).toHaveClass(/toggle-on/)
    await expect(toggle.locator('.toggle-label')).toHaveText('ON')
  })
})
