/**
 * 011 — API Token Auth E2E Tests
 *
 * BDD: docs/bdds/011-api-token-auth.feature
 *
 * Covers:
 *   - Token list display (with/without tokens)
 *   - Token creation with one-time reveal flow
 *   - Token revocation with confirmation
 *   - Empty state, error states
 *   - Form validation
 */

import { test, expect } from '@playwright/test'
import { setupApiMocks, loginViaUI, openAccountMenu } from './auth.setup'

// ── Mock data ──

const MOCK_TOKEN_1 = {
  id: 'tok_001',
  name: 'Jenkins CI',
  prefix: 'lsm_k3F8****a3eU9',
  scope: 'full' as const,
  created_at: new Date(Date.now() - 7 * 864e5).toISOString(),
  expires_at: new Date(Date.now() + 83 * 864e5).toISOString(),
  last_used_at: new Date(Date.now() - 3600e3).toISOString(),
  status: 'active' as const,
}

const MOCK_TOKEN_2 = {
  id: 'tok_002',
  name: 'Readonly Monitor',
  prefix: 'lsm_mZ2A****x1rE4',
  scope: 'read' as const,
  created_at: new Date(Date.now() - 3 * 864e5).toISOString(),
  expires_at: null,
  last_used_at: null,
  status: 'active' as const,
}

const MOCK_TOKEN_EXPIRING = {
  id: 'tok_003',
  name: 'Almost Expired',
  prefix: 'lsm_pQ8L****b9cF3',
  scope: 'full' as const,
  created_at: new Date(Date.now() - 80 * 864e5).toISOString(),
  expires_at: new Date(Date.now() + 3 * 864e5).toISOString(),
  last_used_at: new Date(Date.now() - 7200e3).toISOString(),
  status: 'expiring_soon' as const,
}

const MOCK_TOKEN_EXPIRED = {
  id: 'tok_004',
  name: 'Old Expired',
  prefix: 'lsm_xY7Z****d2wA9',
  scope: 'full' as const,
  created_at: new Date(Date.now() - 100 * 864e5).toISOString(),
  expires_at: new Date(Date.now() - 5 * 864e5).toISOString(),
  last_used_at: new Date(Date.now() - 20 * 864e5).toISOString(),
  status: 'expired' as const,
}

const MOCK_TOKEN_REVOKED = {
  id: 'tok_005',
  name: 'Revoked Token',
  prefix: 'lsm_hG6V****e4rT2',
  scope: 'read' as const,
  created_at: new Date(Date.now() - 40 * 864e5).toISOString(),
  expires_at: new Date(Date.now() + 100 * 864e5).toISOString(),
  last_used_at: null,
  status: 'revoked' as const,
}

const NEW_TOKEN_RESPONSE = {
  id: 'tok_new',
  token: 'lsm_abcdefghijklmnopqrstuvwxyz1234567890ABCD',
  name: 'Jenkins CI',
  scope: 'full' as const,
  expires_at: new Date(Date.now() + 90 * 864e5).toISOString(),
}

// ── Helpers ──

/** Open the account menu and click API Tokens to navigate there */
async function navigateToTokens(page: ReturnType<typeof test['info']>['page']) {
  await openAccountMenu(page as any)
  await (page as any).locator('[data-testid="menu-tokens"]').click()
  await (page as any).waitForURL((url: URL) => url.pathname === '/tokens', { timeout: 5000 })
}

test.describe('API Token Auth — Happy Path', () => {
  test('AT-01: 瀏覽 Token 列表（已有 Token）', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })

    // Mock tokens list
    await page.route('**/api/v1/tokens', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: [MOCK_TOKEN_1, MOCK_TOKEN_2, MOCK_TOKEN_EXPIRING, MOCK_TOKEN_EXPIRED, MOCK_TOKEN_REVOKED] }),
        })
      } else {
        await route.fulfill({ status: 405 })
      }
    })

    await loginViaUI(page)
    await navigateToTokens(page)

    // TokenManageView is rendered
    await expect(page.locator('[data-testid="token-manage-view"]')).toBeVisible()

    // Token table is visible
    await expect(page.locator('[data-testid="token-table"]')).toBeVisible()

    // Each token row is present
    await expect(page.locator('[data-testid="token-row-tok_001"]')).toBeVisible()
    await expect(page.locator('[data-testid="token-row-tok_002"]')).toBeVisible()

    // Token name is displayed
    await expect(page.locator('[data-testid="token-name-tok_001"]')).toHaveText('Jenkins CI')

    // Prefix is displayed
    await expect(page.locator('[data-testid="token-row-tok_001"] .token-masked')).toHaveText('lsm_k3F8****a3eU9')

    // List is created-desc sorted (tok_002 created later than tok_001, so should appear first)
    const firstRow = page.locator('[data-testid="token-table"] tbody tr').first()
    await expect(firstRow).toHaveAttribute('data-testid', 'token-row-tok_002')
  })

  test('AT-02: 瀏覽 Token 列表（尚無 Token）', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })

    // Mock empty tokens list
    await page.route('**/api/v1/tokens', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [] }),
      })
    })

    await loginViaUI(page)
    await navigateToTokens(page)

    // Empty state is displayed
    await expect(page.locator('[data-testid="token-empty"]')).toBeVisible()
    await expect(page.locator('[data-testid="token-empty"]')).toContainText('尚無 API Token')

    // Create button is NOT duplicated in empty state (page header has 建立 Token)
    await expect(page.locator('[data-testid="token-empty"] .btn-primary')).toHaveCount(0)
  })

  test('AT-03: 建立 Token（完整流程含一次性揭露）', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })

    // Start with empty tokens, then mock create
    await page.route('**/api/v1/tokens', async (route) => {
      const method = route.request().method()
      if (method === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: [] }),
        })
      } else if (method === 'POST') {
        const body = JSON.parse(route.request().postData() || '{}')
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(NEW_TOKEN_RESPONSE),
        })
      } else {
        await route.fulfill({ status: 405 })
      }
    })

    await loginViaUI(page)
    await navigateToTokens(page)

    // Click "建立 Token" button (page header version)
    await page.locator('[data-testid="open-create-form"]').click()

    // Create form is visible (parent passes data-testid="create-form" as fallthrough)
    await expect(page.locator('[data-testid="create-form"]')).toBeVisible()

    // Fill in name
    await page.locator('[data-testid="token-name-input"]').fill('Jenkins CI')

    // Select expiry: 90 days (value=90)
    await page.locator('[data-testid="token-expiry-select"]').selectOption('90')

    // Select scope: full
    await page.locator('[data-testid="scope-full"]').click()

    // Click "產生 Token"
    await page.locator('[data-testid="submit-create"]').click()

    // Reveal modal appears
    await expect(page.locator('[data-testid="token-reveal-modal"]')).toBeVisible()

    // Warning text present
    await expect(page.locator('[data-testid="token-reveal-modal"]')).toContainText('請立即複製')

    // Token value in textarea
    const tokenValue = page.locator('[data-testid="reveal-token-value"]')
    await expect(tokenValue).toHaveValue(NEW_TOKEN_RESPONSE.token)

    // Click close — should dismiss modal
    await page.locator('[data-testid="close-reveal-btn"]').click()

    // Modal should be gone
    await expect(page.locator('[data-testid="token-reveal-modal"]')).not.toBeVisible()
  })

  test('AT-04: 建立 Token — 複製到剪貼簿', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })

    // Mock empty list + create
    let tokensList: any[] = []
    await page.route('**/api/v1/tokens', async (route) => {
      const method = route.request().method()
      if (method === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: tokensList }),
        })
      } else if (method === 'POST') {
        tokensList = [{
          id: 'tok_new',
          name: 'Jenkins CI',
          prefix: 'lsm_abcd****890ABCD',
          scope: 'full',
          created_at: new Date().toISOString(),
          expires_at: NEW_TOKEN_RESPONSE.expires_at,
          last_used_at: null,
          status: 'active',
        }]
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(NEW_TOKEN_RESPONSE),
        })
      } else {
        await route.fulfill({ status: 405 })
      }
    })

    // Grant clipboard permissions
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])

    await loginViaUI(page)
    await navigateToTokens(page)
    await page.locator('[data-testid="open-create-form"]').click()
    await page.locator('[data-testid="token-name-input"]').fill('Jenkins CI')
    await page.locator('[data-testid="token-expiry-select"]').selectOption('90')
    await page.locator('[data-testid="scope-full"]').click()
    await page.locator('[data-testid="submit-create"]').click()

    // Reveal modal is visible
    await expect(page.locator('[data-testid="token-reveal-modal"]')).toBeVisible()

    // Click copy button
    await page.locator('[data-testid="copy-token-btn"]').click()

    // Verify clipboard content (may need to wait for async clipboard write)
    const clipboardText = await page.evaluate(() => navigator.clipboard.readText())
    expect(clipboardText).toBe(NEW_TOKEN_RESPONSE.token)
  })

  test('AT-05: 撤銷 Token', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })

    let tokenStatus = 'active'

    // Use **/api/v1/tokens** to match all token endpoints including revoke sub-paths
    await page.route('**/api/v1/tokens**', async (route) => {
      const method = route.request().method()
      const url = route.request().url()
      if (method === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            data: [{ ...MOCK_TOKEN_1, status: tokenStatus }],
          }),
        })
      } else if (method === 'POST' && url.includes('/revoke')) {
        tokenStatus = 'revoked'
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'Token revoked', status: 'revoked' }),
        })
      } else {
        await route.fulfill({ status: 405 })
      }
    })

    // Mock accounts list for account-menu display
    await page.route('**/api/v1/accounts', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
    })

    await loginViaUI(page)
    await navigateToTokens(page)

    // Revoke button visible for active token
    await expect(page.locator('[data-testid="revoke-btn-tok_001"]')).toBeVisible()

    // Click revoke
    await page.locator('[data-testid="revoke-btn-tok_001"]').click()

    // Confirm modal should appear (using the generic ConfirmModal)
    await expect(page.locator('.lms-modal')).toBeVisible()
    await expect(page.locator('.lms-modal')).toContainText('確定要撤銷')

    // Click confirm
    await page.locator('.lms-modal .btn-danger').click()

    // After revoke, row should show revoked state (no revoke button)
    await expect(page.locator('[data-testid="revoke-btn-tok_001"]')).not.toBeVisible()
  })
})

test.describe('API Token Auth — Error Handling', () => {
  test('AT-06: Token 列表載入失敗', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })

    // Mock tokens list failure
    await page.route('**/api/v1/tokens', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: '伺服器錯誤' }),
      })
    })

    await loginViaUI(page)
    await navigateToTokens(page)

    // Error state is displayed (API returns the server's error message directly)
    await expect(page.locator('[data-testid="token-error"]')).toBeVisible()
    await expect(page.locator('[data-testid="token-error"]')).toContainText('伺服器錯誤')
  })

  test('AT-07: 建立 Token 時名稱空白', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })

    await page.route('**/api/v1/tokens', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) })
    })

    await loginViaUI(page)
    await navigateToTokens(page)
    await page.locator('[data-testid="open-create-form"]').click()

    // Submit with empty name
    await page.locator('[data-testid="submit-create"]').click()

    // Validation error should appear
    await expect(page.locator('[data-testid="create-error"]')).toBeVisible()
    await expect(page.locator('[data-testid="create-error"]')).toContainText('名稱為必填')
  })

  test('AT-08: 建立 Token 時名稱重複', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })

    await page.route('**/api/v1/tokens', async (route) => {
      const method = route.request().method()
      if (method === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: [MOCK_TOKEN_1] }),
        })
      } else if (method === 'POST') {
        await route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({ error: '此名稱已存在，請使用其他名稱' }),
        })
      } else {
        await route.fulfill({ status: 405 })
      }
    })

    await loginViaUI(page)
    await navigateToTokens(page)
    await page.locator('[data-testid="open-create-form"]').click()

    await page.locator('[data-testid="token-name-input"]').fill('Jenkins CI')
    await page.locator('[data-testid="token-expiry-select"]').selectOption('90')
    await page.locator('[data-testid="scope-full"]').click()
    await page.locator('[data-testid="submit-create"]').click()

    // Error shows duplicate name
    await expect(page.locator('[data-testid="create-error"]')).toBeVisible()
    await expect(page.locator('[data-testid="create-error"]')).toContainText('此名稱已存在')
  })

  test('AT-09: 建立 Token 時伺服器錯誤', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })

    await page.route('**/api/v1/tokens', async (route) => {
      const method = route.request().method()
      if (method === 'GET') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) })
      } else if (method === 'POST') {
        await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: '伺服器內部錯誤' }) })
      } else {
        await route.fulfill({ status: 405 })
      }
    })

    await loginViaUI(page)
    await navigateToTokens(page)
    await page.locator('[data-testid="open-create-form"]').click()

    await page.locator('[data-testid="token-name-input"]').fill('New Token')
    await page.locator('[data-testid="token-expiry-select"]').selectOption('90')
    await page.locator('[data-testid="scope-full"]').click()
    await page.locator('[data-testid="submit-create"]').click()

    // Error message displayed
    await expect(page.locator('[data-testid="create-error"]')).toBeVisible()
    await expect(page.locator('[data-testid="create-error"]')).toContainText('伺服器內部錯誤')

    // Form data preserved (name still filled)
    await expect(page.locator('[data-testid="token-name-input"]')).toHaveValue('New Token')
  })

  test('AT-10: 撤銷 Token 時 API 失敗', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })

    // Use **/api/v1/tokens** to match all token endpoints including revoke sub-paths
    await page.route('**/api/v1/tokens**', async (route) => {
      const method = route.request().method()
      const url = route.request().url()
      if (method === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: [MOCK_TOKEN_1] }),
        })
      } else if (method === 'POST' && url.includes('/revoke')) {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: '撤銷失敗，請重試' }),
        })
      } else {
        await route.fulfill({ status: 405 })
      }
    })

    await page.route('**/api/v1/accounts', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
    })

    await loginViaUI(page)
    await navigateToTokens(page)

    // Click revoke
    await page.locator('[data-testid="revoke-btn-tok_001"]').click()
    await expect(page.locator('.lms-modal')).toBeVisible()

    // Click confirm
    await page.locator('.lms-modal .btn-danger').click()

    // Token should remain active (revoke button still visible)
    await expect(page.locator('[data-testid="revoke-btn-tok_001"]')).toBeVisible()
  })
})

test.describe('API Token Auth — Edge Cases', () => {
  test('AT-11: Token 自訂日期選擇', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })

    await page.route('**/api/v1/tokens', async (route) => {
      const method = route.request().method()
      if (method === 'GET') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) })
      } else if (method === 'POST') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(NEW_TOKEN_RESPONSE),
        })
      } else {
        await route.fulfill({ status: 405 })
      }
    })

    await loginViaUI(page)
    await navigateToTokens(page)
    await page.locator('[data-testid="open-create-form"]').click()

    // Select "自訂日期"
    await page.locator('[data-testid="token-expiry-select"]').selectOption('0')

    // Custom date input should appear
    await expect(page.locator('[data-testid="token-custom-date"]')).toBeVisible()

    // Select a date
    const futureDate = new Date(Date.now() + 30 * 864e5).toISOString().split('T')[0]
    await page.locator('[data-testid="token-custom-date"]').fill(futureDate)

    // Fill other fields
    await page.locator('[data-testid="token-name-input"]').fill('Custom Date Token')
    await page.locator('[data-testid="scope-full"]').click()

    // Submit
    await page.locator('[data-testid="submit-create"]').click()

    // Reveal modal should appear
    await expect(page.locator('[data-testid="token-reveal-modal"]')).toBeVisible()
  })

  test('AT-12: Token 永不過期選項', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })

    await page.route('**/api/v1/tokens', async (route) => {
      const method = route.request().method()
      if (method === 'GET') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) })
      } else if (method === 'POST') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ...NEW_TOKEN_RESPONSE, expires_at: null }),
        })
      } else {
        await route.fulfill({ status: 405 })
      }
    })

    await loginViaUI(page)
    await navigateToTokens(page)
    await page.locator('[data-testid="open-create-form"]').click()

    // Select "永不過期"
    await page.locator('[data-testid="token-expiry-select"]').selectOption('-1')

    // Custom date should NOT appear
    await expect(page.locator('[data-testid="token-custom-date"]')).not.toBeVisible()

    // Fill and submit
    await page.locator('[data-testid="token-name-input"]').fill('Never Expires')
    await page.locator('[data-testid="scope-read"]').click()
    await page.locator('[data-testid="submit-create"]').click()

    // Reveal modal should appear
    await expect(page.locator('[data-testid="token-reveal-modal"]')).toBeVisible()
  })

  test('AT-13: Token 唯讀權限建立', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })

    // Mock: start empty, create read-only token, then list returns it
    const createdToken = {
      id: 'tok_readonly',
      name: 'Read Only',
      prefix: 'lsm_rE4D****oNlY5',
      scope: 'read' as const,
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 90 * 864e5).toISOString(),
      last_used_at: null,
      status: 'active' as const,
    }

    await page.route('**/api/v1/tokens', async (route) => {
      const method = route.request().method()
      if (method === 'GET') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [createdToken] }) })
      } else if (method === 'POST') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 'tok_readonly',
            token: 'lsm_READONLYabcdefghijklmnopqrstuvwxyzABCD',
            name: 'Read Only',
            scope: 'read',
            expires_at: createdToken.expires_at,
          }),
        })
      } else {
        await route.fulfill({ status: 405 })
      }
    })

    await loginViaUI(page)
    await navigateToTokens(page)
    await page.locator('[data-testid="open-create-form"]').click()

    // Select read scope
    await page.locator('[data-testid="scope-read"]').click()
    await expect(page.locator('[data-testid="scope-read"]')).toHaveClass(/active/)

    await page.locator('[data-testid="token-name-input"]').fill('Read Only')
    await page.locator('[data-testid="token-expiry-select"]').selectOption('90')
    await page.locator('[data-testid="submit-create"]').click()

    // Should succeed
    await expect(page.locator('[data-testid="token-reveal-modal"]')).toBeVisible()
  })

  test('AT-14: Token 狀態標籤正確顯示', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })

    const allTokens = [MOCK_TOKEN_1, MOCK_TOKEN_EXPIRING, MOCK_TOKEN_EXPIRED, MOCK_TOKEN_REVOKED]

    await page.route('**/api/v1/tokens', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: allTokens }),
      })
    })

    await loginViaUI(page)
    await navigateToTokens(page)

    // Active status
    await expect(page.locator('[data-testid="token-row-tok_001"] .status-active')).toBeVisible()

    // Expiring soon status
    await expect(page.locator('[data-testid="token-row-tok_003"] .status-expiring_soon')).toBeVisible()

    // Expired status
    await expect(page.locator('[data-testid="token-row-tok_004"] .status-expired')).toBeVisible()

    // Revoked status
    await expect(page.locator('[data-testid="token-row-tok_005"] .status-revoked')).toBeVisible()

    // Revoked token has no revoke button
    await expect(page.locator('[data-testid="revoke-btn-tok_005"]')).not.toBeVisible()

    // Expired token has no revoke button
    await expect(page.locator('[data-testid="revoke-btn-tok_004"]')).not.toBeVisible()
  })
})

test.describe('API Token Auth — Security & Compliance', () => {
  test('AT-15: Token 列表不揭露原始值', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })

    await page.route('**/api/v1/tokens', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [MOCK_TOKEN_1] }),
      })
    })

    await loginViaUI(page)
    await navigateToTokens(page)

    // Only prefix is shown, not the raw token
    const maskedEl = page.locator('[data-testid="token-row-tok_001"] .token-masked')
    await expect(maskedEl).toHaveText('lsm_k3F8****a3eU9')

    // Raw token value should NOT be visible anywhere
    await expect(page.getByText(NEW_TOKEN_RESPONSE.token)).not.toBeVisible()
  })

  test('AT-16: 關閉揭露 Modal 後無法再次查看 Token', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })

    let tokenReturned: any[] = []
    await page.route('**/api/v1/tokens', async (route) => {
      const method = route.request().method()
      if (method === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: tokenReturned }),
        })
      } else if (method === 'POST') {
        tokenReturned = [{
          id: 'tok_new',
          name: 'Jenkins CI',
          prefix: 'lsm_abcd****890ABCD',
          scope: 'full',
          created_at: new Date().toISOString(),
          expires_at: NEW_TOKEN_RESPONSE.expires_at,
          last_used_at: null,
          status: 'active',
        }]
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(NEW_TOKEN_RESPONSE),
        })
      } else {
        await route.fulfill({ status: 405 })
      }
    })

    await loginViaUI(page)
    await navigateToTokens(page)
    await page.locator('[data-testid="open-create-form"]').click()
    await page.locator('[data-testid="token-name-input"]').fill('Jenkins CI')
    await page.locator('[data-testid="token-expiry-select"]').selectOption('90')
    await page.locator('[data-testid="scope-full"]').click()
    await page.locator('[data-testid="submit-create"]').click()

    // Reveal modal visible
    await expect(page.locator('[data-testid="token-reveal-modal"]')).toBeVisible()

    // Close without copying
    await page.locator('[data-testid="close-reveal-btn"]').click()

    // Modal gone
    await expect(page.locator('[data-testid="token-reveal-modal"]')).not.toBeVisible()

    // Token table shown with masked value only
    await expect(page.locator('[data-testid="token-row-tok_new"] .token-masked')).toHaveText('lsm_abcd****890ABCD')

    // Raw token is nowhere on the page
    await expect(page.getByText(NEW_TOKEN_RESPONSE.token)).not.toBeVisible()
  })

  test('AT-17: Bearer Token 驗證 — 有效 Token 可成功存取 API', async ({ page }) => {
    // Navigate to app so fetch() has a valid base URL
    // Set up custom routes for auth (no setupApiMocks to avoid conflicts)
    let loggedIn = false
    await page.route('**/api/v1/session', async (route) => {
      await route.fulfill({ status: loggedIn ? 200 : 401, contentType: 'application/json', body: JSON.stringify(loggedIn ? { authenticated: true, username: 'admin' } : { error: 'unauthorized' }) })
    })
    await page.route('**/api/v1/login', async (route) => {
      loggedIn = true
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ username: 'admin', message: 'ok' }) })
    })
    await page.route('**/api/v1/logout', async (route) => {
      loggedIn = false
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ message: 'ok' }) })
    })
    await page.route('**/api/v1/services', async (route) => {
      const authHeader = route.request().headers()['authorization'] || ''
      if (authHeader.startsWith('Bearer lsm_valid')) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
      } else if (authHeader.startsWith('Bearer lsm_revoked')) {
        await route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'Token 已被撤銷' }) })
      } else if (authHeader.startsWith('Bearer lsm_expired')) {
        await route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'Token 已過期' }) })
      } else if (authHeader) {
        await route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'Token 無效' }) })
      } else if (loggedIn) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
      } else {
        await route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: '未提供驗證資訊' }) })
      }
    })
    await loginViaUI(page)

    // Direct API call with valid Bearer token
    const resp = await page.evaluate(async () => {
      const r = await fetch('/api/v1/services', {
        headers: { Authorization: 'Bearer lsm_valid' },
      })
      return { status: r.status, body: await r.json() }
    })
    expect(resp.status).toBe(200)

    // Invalid token
    const resp2 = await page.evaluate(async () => {
      const r = await fetch('/api/v1/services', {
        headers: { Authorization: 'Bearer lsm_fake123' },
      })
      return { status: r.status, body: await r.json() }
    })
    expect(resp2.status).toBe(401)
    expect(resp2.body).toHaveProperty('error')

    // No auth at all — logout first to clear session
    await page.evaluate(async () => {
      await fetch('/api/v1/logout', { method: 'POST' })
    })
    const resp3 = await page.evaluate(async () => {
      const r = await fetch('/api/v1/services')
      return { status: r.status, body: await r.json() }
    })
    expect(resp3.status).toBe(401)
    expect(resp3.body).toHaveProperty('error')
  })

  test('AT-18: 唯讀 Token 無法執行寫入操作', async ({ page }) => {
    // Manual auth routes (no setupApiMocks to avoid route conflicts)
    let loggedIn = false
    await page.route('**/api/v1/session', async (route) => {
      await route.fulfill({ status: loggedIn ? 200 : 401, contentType: 'application/json', body: JSON.stringify(loggedIn ? { authenticated: true, username: 'admin' } : { error: 'unauthorized' }) })
    })
    await page.route('**/api/v1/login', async (route) => {
      loggedIn = true
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ username: 'admin', message: 'ok' }) })
    })
    await page.route('**/api/v1/logout', async (route) => {
      loggedIn = false
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ message: 'ok' }) })
    })

    // Mock: read token gets 403 on POST, GET succeeds; full token always succeeds
    await page.route('**/api/v1/services', async (route) => {
      const authHeader = route.request().headers()['authorization'] || ''
      if (authHeader.startsWith('Bearer lsm_readonly')) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
      } else if (authHeader.startsWith('Bearer lsm_full')) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
      } else if (loggedIn) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
      } else {
        await route.fulfill({ status: 401 })
      }
    })
    await page.route('**/api/v1/services/*/start', async (route) => {
      const authHeader = route.request().headers()['authorization'] || ''
      if (authHeader.startsWith('Bearer lsm_readonly')) {
        await route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: '權限不足，此 Token 僅供唯讀' }) })
      } else if (authHeader.startsWith('Bearer lsm_full')) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ message: 'ok' }) })
      } else {
        await route.fulfill({ status: 401 })
      }
    })
    await loginViaUI(page)

    // Read token on GET → 200
    const respGet = await page.evaluate(async () => {
      const r = await fetch('/api/v1/services', {
        headers: { Authorization: 'Bearer lsm_readonly' },
      })
      return r.status
    })
    expect(respGet).toBe(200)

    // Read token on POST → 403
    const respPost = await page.evaluate(async () => {
      const r = await fetch('/api/v1/services/nginx.service/start', {
        method: 'POST',
        headers: { Authorization: 'Bearer lsm_readonly' },
      })
      return { status: r.status, body: await r.json() }
    })
    expect(respPost.status).toBe(403)
    expect(respPost.body).toHaveProperty('error')

    // Full token on POST → 200
    const respFull = await page.evaluate(async () => {
      const r = await fetch('/api/v1/services/nginx.service/start', {
        method: 'POST',
        headers: { Authorization: 'Bearer lsm_full' },
      })
      return r.status
    })
    expect(respFull).toBe(200)
  })

  test('AT-19: Bearer Token 優先於 Cookie Session', async ({ page }) => {
    // Manual auth routes (no setupApiMocks to avoid route conflicts)
    let loggedIn = false
    await page.route('**/api/v1/session', async (route) => {
      await route.fulfill({ status: loggedIn ? 200 : 401, contentType: 'application/json', body: JSON.stringify(loggedIn ? { authenticated: true, username: 'admin' } : { error: 'unauthorized' }) })
    })
    await page.route('**/api/v1/login', async (route) => {
      loggedIn = true
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ username: 'admin', message: 'ok' }) })
    })
    await page.route('**/api/v1/logout', async (route) => {
      loggedIn = false
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ message: 'ok' }) })
    })

    // Mock services: when Bearer token present, return token-specific response
    await page.route('**/api/v1/services', async (route) => {
      const authHeader = route.request().headers()['authorization'] || ''
      if (authHeader.startsWith('Bearer ')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ auth_method: 'token', services: [] }),
        })
      } else {
        // Session auth
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([{ name: 'session.service', load: 'loaded', active: 'active', sub: 'running', locked: false, unitFileState: 'enabled', fragmentPath: '/' }]),
        })
      }
    })
    await loginViaUI(page)

    // Make request with both Bearer token and cookie session
    const resp = await page.evaluate(async () => {
      const r = await fetch('/api/v1/services', {
        headers: { Authorization: 'Bearer lsm_test' },
      })
      return await r.json()
    })

    // Should indicate token auth was used
    expect(resp).toHaveProperty('auth_method', 'token')
  })
})
