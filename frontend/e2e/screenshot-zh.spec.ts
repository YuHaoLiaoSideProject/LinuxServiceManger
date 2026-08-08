import { test, expect } from '@playwright/test'
import { setupApiMocks, loginViaUI } from './auth.setup'

test('擷取繁體中文介面截圖', async ({ page }) => {
  await setupApiMocks(page, { authenticated: false, includeActions: true })
  await loginViaUI(page)

  // Switch to zh-TW
  await page.locator('.lang-toggle').click()
  await page.waitForTimeout(500)

  // Verify Chinese headers
  await expect(page.locator('.stats-bar')).toContainText('總服務數')

  // Screenshot
  await page.screenshot({ path: 'e2e/screenshots/lms-zh-tw.png', fullPage: true })

  // Also screenshot English for comparison
  await page.locator('.lang-toggle').click()
  await page.waitForTimeout(500)
  await page.screenshot({ path: 'e2e/screenshots/lms-en.png', fullPage: true })
})
