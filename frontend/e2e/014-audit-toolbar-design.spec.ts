import { test, expect } from '@playwright/test'
import { setupApiMocks, gotoDashboard } from './auth.setup'

const AUDIT_ENTRIES = {
  total: 5, page: 1, limit: 50,
  data: [
    { timestamp: '2025-08-09T14:30:00Z', username: 'admin', source_ip: '10.0.0.1', action: 'start', target: 'nginx.service', result: 'success', detail: '' },
    { timestamp: '2025-08-09T13:00:00Z', username: 'operator', source_ip: '192.168.1.50', action: 'restart', target: 'ssh.service', result: 'failure', detail: 'permission denied' },
    { timestamp: '2025-08-09T12:30:00Z', username: 'admin', source_ip: '10.0.0.1', action: 'stop', target: 'myapp.service', result: 'success', detail: '' },
    { timestamp: '2025-08-09T11:00:00Z', username: 'admin', source_ip: '10.0.0.1', action: 'login', target: '-', result: 'success', detail: '' },
    { timestamp: '2025-08-09T10:30:00Z', username: 'admin', source_ip: '10.0.0.1', action: 'enable', target: 'nginx.service', result: 'success', detail: '' },
  ],
}

async function goAudit(page: any) {
  await setupApiMocks(page, { authenticated: true })
  await page.route('**/api/v1/audit?*', async (route: any) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(AUDIT_ENTRIES) })
  })
  await gotoDashboard(page)
  await page.locator('[data-testid="nav-audit"]').click()
  await page.waitForURL('**/audit')
  await expect(page.locator('main.app-container tbody tr').first()).toBeVisible()
}

test.describe('audit toolbar design tokens', () => {
  test('desktop: 36px 控制高度、單一外框、flex 伸縮搜尋', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await goAudit(page)

    const heights = await page.evaluate(() => {
      const q = (s: string) => document.querySelector<HTMLElement>(s)!
      return {
        search: q('.search-box input').offsetHeight,
        daterange: q('.daterange').offsetHeight,
        export: q('.btn-export').offsetHeight,
        refresh: q('.btn-refresh').offsetHeight,
      }
    })
    expect(heights.search).toBe(36)
    expect(heights.daterange).toBe(36)
    expect(heights.export).toBe(36)
    expect(heights.refresh).toBe(36)

    // 搜尋框 flex 伸縮（min 220 / max 420）
    const sw = await page.locator('.search-box').evaluate(el => ({ w: el.clientWidth, minW: getComputedStyle(el).minWidth, maxW: getComputedStyle(el).maxWidth }))
    expect(parseInt(sw.minW)).toBeGreaterThanOrEqual(220)
    expect(parseInt(sw.maxW)).toBe(420)

    // 日期群組：單一外框（inputs 無自己的 border）
    const daterange = await page.locator('.daterange').evaluate(el => {
      const inputs = el.querySelectorAll('input')
      return {
        inputBorders: Array.from(inputs).map(i => getComputedStyle(i).borderTopWidth),
        groupBorder: getComputedStyle(el).borderTopWidth,
        sepExists: !!el.querySelector('.sep'),
      }
    })
    expect(daterange.inputBorders.every(b => b === '0px')).toBe(true)
    expect(daterange.groupBorder).not.toBe('0px')
    expect(daterange.sepExists).toBe(true)

    // focus-within：點擊日期輸入 → 群組出現 accent 光圈（transition 0.2s，需等動畫完成）
    await page.locator('input[name="audit-date-from"]').focus()
    await page.waitForTimeout(350)
    const focusRing = await page.locator('.daterange').evaluate(el => {
      const s = getComputedStyle(el)
      return { shadow: s.boxShadow, border: s.borderTopColor }
    })
    expect(focusRing.shadow).not.toBe('none')
    expect(focusRing.border.toLowerCase()).toContain('26, 115, 232')
  })

  test('desktop: 日期輸入為原生 type="date"（內建日期選擇器）', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await goAudit(page)

    // 必須是原生 date input，才有瀏覽器內建日期選擇器
    const types = await page.locator('.daterange input').evaluateAll(
      (els) => els.map((e) => (e as HTMLInputElement).type),
    )
    expect(types).toEqual(['date', 'date'])

    // showPicker() API 存在且可呼叫 → 瀏覽器支援內建日期選擇器
    const pickerSupported = await page.locator('input[name="audit-date-from"]').evaluate((el) => {
      const input = el as HTMLInputElement & { showPicker?: () => void }
      if (typeof input.showPicker !== 'function') return false
      try {
        input.showPicker()
        return true
      } catch {
        return false
      }
    })
    expect(pickerSupported).toBe(true)
  })

  test('desktop: invalid 日期 → 整組紅框＋紅光圈，匯出/重新整理 disabled', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await goAudit(page)

    await page.locator('input[name="audit-date-from"]').fill('2025-08-09')
    await page.locator('input[name="audit-date-to"]').fill('2025-07-01')
    await page.waitForTimeout(300)

    await expect(page.locator('.daterange.invalid')).toHaveCount(1)
    const red = await page.locator('.daterange.invalid').evaluate(el => getComputedStyle(el).borderTopColor)
    expect(red.toLowerCase()).toContain('197, 34, 31')
    await expect(page.locator('.btn-export')).toBeDisabled()
    await expect(page.locator('.btn-refresh')).toBeDisabled()

    // 修正後自動恢復
    await page.locator('input[name="audit-date-to"]').fill('2025-08-11')
    await page.waitForTimeout(300)
    await expect(page.locator('.daterange.invalid')).toHaveCount(0)
    await expect(page.locator('.btn-export')).toBeEnabled()
  })

  test('desktop: 搜尋有值 → ✕ clear 出現 + 條件列「符合 N 筆」', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await goAudit(page)

    // 初始：無 clear、無條件列
    await expect(page.locator('.search-clear')).not.toBeVisible()
    await expect(page.locator('.cond-row')).not.toBeVisible()

    await page.locator('.search-box input').fill('nginx')
    await expect(page.locator('.search-clear')).toBeVisible()
    await expect(page.locator('.cond-row')).toBeVisible()
    await expect(page.locator('.cond-row')).toContainText('5')
    // 語言相關（zh-TW：清除條件 / en：Clear filters）
    const condText = await page.locator('.cond-row').textContent()
    expect(condText).toMatch(/清除條件|Clear filters/)

    // ✕ 清除搜尋 → 條件列消失
    await page.locator('.search-clear').click()
    await expect(page.locator('.cond-row')).not.toBeVisible()
  })

  test('mobile: 44px 觸控目標、全寬堆疊、按鈕 1:1 並排', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await goAudit(page)

    const heights = await page.evaluate(() => {
      const q = (s: string) => document.querySelector<HTMLElement>(s)!
      return {
        search: q('.search-box input').offsetHeight,
        daterange: q('.daterange').offsetHeight,
        export: q('.btn-export').offsetHeight,
        refresh: q('.btn-refresh').offsetHeight,
      }
    })
    expect(heights.search).toBe(44)
    expect(heights.daterange).toBe(44)
    expect(heights.export).toBe(44)
    expect(heights.refresh).toBe(44)

    // 搜尋全寬、日期群組全寬（用 offsetWidth 含 border，避免 clientWidth 差異）
    const tbWidth = await page.locator('.tb-row1').evaluate(el => el.offsetWidth)
    const swWidth = await page.locator('.search-box').evaluate(el => el.offsetWidth)
    const drWidth = await page.locator('.daterange').evaluate(el => el.offsetWidth)
    expect(swWidth).toBe(tbWidth)
    expect(drWidth).toBe(tbWidth)

    // 按鈕 1:1 並排
    const exportW = await page.locator('.btn-export').evaluate(el => el.clientWidth)
    const refreshW = await page.locator('.btn-refresh').evaluate(el => el.clientWidth)
    const diff = Math.abs(exportW - refreshW)
    expect(diff).toBeLessThanOrEqual(2)
  })
})
