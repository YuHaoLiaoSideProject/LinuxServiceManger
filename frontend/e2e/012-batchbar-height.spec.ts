import { test, expect } from '@playwright/test'
import { setupApiMocks, loginViaUI } from './auth.setup'

/**
 * 012 — BatchBar：勾選服務後批次 啟動/停止/重啟，且高度三態一致
 *
 * BDD scenarios covered:
 *   1. ✅ Idle：未選取 → 顯示提示、無動作按鈕，高度 52px
 *   2. ✅ 已選取：顯示計數 + 啟動/停止/重啟 + 取消選取，高度仍為 52px
 *   3. ✅ 執行中：顯示進度列，高度仍為 52px（三態高度不變，表格不跳動）
 *   4. ✅ 批次動作 emit：點擊 Start/Stop/Restart → 送出 /api/v1/services/batch
 *   5. ✅ 取消選取 → 回到 idle
 */

async function barHeight(page: any): Promise<number> {
  return page.evaluate(() => {
    const bar: HTMLElement | null = document.querySelector('.batchbar')
    return bar ? Math.round(bar.getBoundingClientRect().height * 100) / 100 : -1
  })
}

async function tableTop(page: any): Promise<number> {
  return page.evaluate(() => {
    const t = document.querySelector('.table-wrapper')
    return t ? Math.round(t.getBoundingClientRect().top * 100) / 100 : -1
  })
}

test.describe('BatchBar — 高度三態一致 + 批次動作', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('勾選前後與執行中，batchbar 高度皆為 52px，表格位置不跳動', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)
    await page.waitForSelector('.batchbar')

    // 批次 endpoint（延遲回應，捕捉執行中狀態）
    await page.route('**/api/v1/services/batch', async (route) => {
      await new Promise(r => setTimeout(r, 1200))
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          results: [
            { name: 'nginx.service', result: 'success', message: 'ok' },
            { name: 'myapp.service', result: 'success', message: 'ok' },
          ],
          summary: { success: 2, failed: 0 },
        }),
      })
    })

    // ── Idle 態 ──
    await expect(page.locator('.bb-hint')).toBeVisible()
    await expect(page.locator('.btn-start')).toHaveCount(0)
    const idleHeight = await barHeight(page)
    const idleTableTop = await tableTop(page)

    // ── 已選取態 ──
    const rows = page.locator('.service-table tbody tr')
    await rows.nth(0).locator('input[type=checkbox]').check()
    await rows.nth(1).locator('input[type=checkbox]').check()
    await page.waitForTimeout(250)

    await expect(page.locator('.batch-count')).toBeVisible()
    await expect(page.locator('.btn-start')).toBeVisible()
    await expect(page.locator('.btn-stop')).toBeVisible()
    await expect(page.locator('.btn-restart')).toBeVisible()
    await expect(page.locator('.btn-clear-link')).toBeVisible()
    const selectedHeight = await barHeight(page)
    const selectedTableTop = await tableTop(page)

    // ── 執行中態 ──
    await page.locator('.btn-start').first().click()
    await page.locator('.lms-modal .btn-danger').click()
    await page.waitForSelector('.progress[role="progressbar"]')
    const executingHeight = await barHeight(page)
    const executingTableTop = await tableTop(page)

    expect(idleHeight).toBe(52)
    expect(selectedHeight).toBe(52)
    expect(executingHeight).toBe(52)
    // 表格頂端位置三態一致（不因 batchbar 高度變化而跳動）
    expect(selectedTableTop).toBe(idleTableTop)
    expect(executingTableTop).toBe(idleTableTop)
  })

  test('批次動作按鈕送出正確的 action 到 /api/v1/services/batch', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)
    await page.waitForSelector('.batchbar')

    const requests: string[] = []
    await page.route('**/api/v1/services/batch', async (route) => {
      const body = JSON.parse(route.request().postData() || '{}')
      requests.push(body.action)
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          results: [
            { name: 'nginx.service', result: 'success', message: 'ok' },
            { name: 'myapp.service', result: 'success', message: 'ok' },
          ],
          summary: { success: 2, failed: 0 },
        }),
      })
    })

    const rows = page.locator('.service-table tbody tr')
    const selectTwo = async () => {
      await rows.nth(0).locator('input[type=checkbox]').check()
      await rows.nth(1).locator('input[type=checkbox]').check()
      await page.waitForTimeout(200)
    }

    // Start（成功後清空選取 → 重新勾選再測 Stop）
    await selectTwo()
    await page.locator('.btn-start').first().click()
    await page.locator('.lms-modal .btn-danger').click()
    await page.waitForTimeout(400)

    // Stop
    await selectTwo()
    await page.locator('.btn-stop').first().click()
    await page.locator('.lms-modal .btn-danger').click()
    await page.waitForTimeout(400)

    // Restart
    await selectTwo()
    await page.locator('.btn-restart').first().click()
    await page.locator('.lms-modal .btn-danger').click()
    await page.waitForTimeout(400)

    expect(requests).toEqual(['start', 'stop', 'restart'])
  })

  test('取消選取回到 idle（高度不變、動作按鈕消失）', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)
    await page.waitForSelector('.batchbar')

    const idleHeight = await barHeight(page)

    const rows = page.locator('.service-table tbody tr')
    await rows.nth(0).locator('input[type=checkbox]').check()
    await page.waitForTimeout(250)
    expect(await barHeight(page)).toBe(idleHeight)

    await page.locator('.btn-clear-link').click()
    await page.waitForTimeout(250)

    await expect(page.locator('.bb-hint')).toBeVisible()
    await expect(page.locator('.btn-start')).toHaveCount(0)
    expect(await barHeight(page)).toBe(idleHeight)
  })
})
