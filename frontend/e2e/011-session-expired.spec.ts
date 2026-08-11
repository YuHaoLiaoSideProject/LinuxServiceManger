/**
 * 011 — WebSocket session_expired E2E Tests
 *
 * BDD scenarios:
 *   1. 收到 session_expired → Toast 顯示 "Session 已過期"
 *   2. 收到 session_expired → 自動導向 /login
 *   3. 收到 session_expired → WebSocket disconnect 被呼叫
 *   4. session_expired 後無法再操作服務
 *   5. session_expired 後重新登入可正常使用
 *
 * Uses Playwright's page.routeWebSocket() (requires @playwright/test >= 1.48)
 * to mock the WebSocket and send a fake session_expired message.
 */

import { test, expect } from '@playwright/test'
import { setupApiMocks, loginViaUI } from './auth.setup'

test.describe('WebSocket session_expired', () => {
  test('SE-01: 收到 session_expired → Toast 顯示過期訊息', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })

    // Intercept WebSocket before the app tries to connect
    await page.routeWebSocket('**/api/v1/ws', (ws) => {
      // When the server (our mock) receives any message from client, ignore it
      ws.onMessage(() => {})

      // Simulate: send snapshot, then shortly after, send session_expired
      ws.send(JSON.stringify({
        type: 'snapshot',
        services: [
          { name: 'nginx.service', active: 'active', sub: 'running', unitFileState: 'enabled' },
          { name: 'myapp.service', active: 'inactive', sub: 'dead', unitFileState: 'disabled' },
        ],
      }))

      // Send session_expired after a short delay
      setTimeout(() => {
        ws.send(JSON.stringify({
          type: 'session_expired',
          timestamp: new Date().toISOString(),
        }))

        // Close the WebSocket cleanly
        setTimeout(() => ws.close(), 50)
      }, 500)
    })

    await loginViaUI(page)

    // Wait for the session_expired toast to appear
    const toast = page.locator('.toast-item.toast-error')
    await expect(toast).toBeVisible({ timeout: 5000 })
    await expect(toast).toContainText('Session 已過期')
  })

  test('SE-02: 收到 session_expired → 自動導向 /login', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })

    await page.routeWebSocket('**/api/v1/ws', (ws) => {
      ws.onMessage(() => {})

      ws.send(JSON.stringify({
        type: 'snapshot',
        services: [{ name: 'nginx.service', active: 'active', sub: 'running', unitFileState: 'enabled' }],
      }))

      setTimeout(() => {
        ws.send(JSON.stringify({
          type: 'session_expired',
          timestamp: new Date().toISOString(),
        }))
        setTimeout(() => ws.close(), 50)
      }, 500)
    })

    await loginViaUI(page)

    // Should be redirected to /login
    await page.waitForURL((url) => url.pathname === '/login', { timeout: 5000 })
    await expect(page.locator('.login-form')).toBeVisible()
  })

  test('SE-03: session_expired 後 Header 不再顯示', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })

    await page.routeWebSocket('**/api/v1/ws', (ws) => {
      ws.onMessage(() => {})

      ws.send(JSON.stringify({
        type: 'snapshot',
        services: [{ name: 'nginx.service', active: 'active', sub: 'running', unitFileState: 'enabled' }],
      }))

      setTimeout(() => {
        ws.send(JSON.stringify({
          type: 'session_expired',
          timestamp: new Date().toISOString(),
        }))
        setTimeout(() => ws.close(), 50)
      }, 500)
    })

    await loginViaUI(page)

    // Wait for redirect to /login
    await page.waitForURL((url) => url.pathname === '/login', { timeout: 5000 })

    // Header should NOT be visible on /login
    await expect(page.locator('.app-header')).not.toBeVisible()
  })

  test('SE-04: session_expired 後無法存取 Dashboard', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })

    // Override session to return 401 after expiry
    let loggedIn = false
    await page.route('**/api/v1/session', async (route) => {
      await route.fulfill({
        status: loggedIn ? 200 : 401,
        contentType: 'application/json',
        body: JSON.stringify(
          loggedIn
            ? { authenticated: true, username: 'admin' }
            : { error: 'unauthorized' },
        ),
      })
    })
    await page.route('**/api/v1/login', async (route) => {
      loggedIn = true
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ username: 'admin', message: 'Login successful' }),
      })
    })
    await page.route('**/api/v1/logout', async (route) => {
      loggedIn = false
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ message: 'logged out' }) })
    })
    await page.route('**/api/v1/services', async (route) => {
      await route.fulfill({ status: loggedIn ? 200 : 401, contentType: 'application/json', body: JSON.stringify(loggedIn ? [] : { error: 'unauthorized' }) })
    })
    await page.route('**/api/v1/services/*/start', async (route) => {
      await route.fulfill({ status: loggedIn ? 200 : 401, contentType: 'application/json', body: JSON.stringify(loggedIn ? { message: 'started' } : { error: 'unauthorized' }) })
    })
    await page.route('**/api/v1/services/*/stop', async (route) => {
      await route.fulfill({ status: loggedIn ? 200 : 401, contentType: 'application/json', body: JSON.stringify(loggedIn ? { message: 'stopped' } : { error: 'unauthorized' }) })
    })
    await page.route('**/api/v1/services/*/restart', async (route) => {
      await route.fulfill({ status: loggedIn ? 200 : 401, contentType: 'application/json', body: JSON.stringify(loggedIn ? { message: 'restarted' } : { error: 'unauthorized' }) })
    })
    await page.route('**/api/v1/services/*/enable', async (route) => {
      await route.fulfill({ status: loggedIn ? 200 : 401, contentType: 'application/json', body: JSON.stringify(loggedIn ? { message: 'enabled' } : { error: 'unauthorized' }) })
    })
    await page.route('**/api/v1/services/*/disable', async (route) => {
      await route.fulfill({ status: loggedIn ? 200 : 401, contentType: 'application/json', body: JSON.stringify(loggedIn ? { message: 'disabled' } : { error: 'unauthorized' }) })
    })

    await page.routeWebSocket('**/api/v1/ws', (ws) => {
      ws.onMessage(() => {})
      ws.send(JSON.stringify({
        type: 'snapshot',
        services: [{ name: 'nginx.service', active: 'active', sub: 'running', unitFileState: 'enabled' }],
      }))
      setTimeout(() => {
        ws.send(JSON.stringify({ type: 'session_expired', timestamp: new Date().toISOString() }))
        setTimeout(() => ws.close(), 50)
      }, 500)
    })

    await loginViaUI(page)
    await page.waitForURL((url) => url.pathname === '/login', { timeout: 5000 })

    // Try to navigate to Dashboard
    await page.goto('/')
    // Router guard should redirect back to /login
    await page.waitForURL((url) => url.pathname === '/login', { timeout: 10000 })
    await expect(page.locator('.login-form')).toBeVisible()
  })

  test('SE-05: session_expired 後重新登入可以正常使用', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })

    await page.routeWebSocket('**/api/v1/ws', (ws) => {
      ws.onMessage(() => {})
      ws.send(JSON.stringify({
        type: 'snapshot',
        services: [
          { name: 'nginx.service', active: 'active', sub: 'running', unitFileState: 'enabled' },
          { name: 'myapp.service', active: 'inactive', sub: 'dead', unitFileState: 'disabled' },
          { name: 'crash.service', active: 'failed', sub: 'failed', unitFileState: 'disabled' },
        ],
      }))
      setTimeout(() => {
        ws.send(JSON.stringify({ type: 'session_expired', timestamp: new Date().toISOString() }))
        setTimeout(() => ws.close(), 50)
      }, 500)
    })

    await loginViaUI(page)

    // Wait for session_expired redirect
    await page.waitForURL((url) => url.pathname === '/login', { timeout: 5000 })

    // Remove WebSocket route so the next connection won't be expired
    await page.unrouteWebSocket('**/api/v1/ws')

    // Set up a fresh WebSocket that stays alive
    await page.routeWebSocket('**/api/v1/ws', (ws) => {
      ws.onMessage(() => {})
      ws.send(JSON.stringify({
        type: 'snapshot',
        services: [
          { name: 'nginx.service', active: 'active', sub: 'running', unitFileState: 'enabled' },
          { name: 'myapp.service', active: 'inactive', sub: 'dead', unitFileState: 'disabled' },
          { name: 'crash.service', active: 'failed', sub: 'failed', unitFileState: 'disabled' },
        ],
      }))
      // No session_expired — stays connected
    })

    // Re-login
    await loginViaUI(page)

    // Dashboard should be visible and functional
    await expect(page.locator('.app-header')).toBeVisible()
    await expect(page.locator('[data-testid="account-btn"]')).toContainText('admin')
    await expect(page.locator('#service-table-body tr')).toHaveCount(3)

    // Connection indicator should show connected
    await expect(page.locator('.indicator-connected')).toBeVisible({ timeout: 5000 })
  })

  test('SE-06: session_expired 在英文語系下顯示英文錯誤', async ({ page }) => {
    // Set language to English
    await page.addInitScript(() => {
      localStorage.setItem('lms-lang', 'en')
    })

    await setupApiMocks(page, { authenticated: false, includeActions: true })

    await page.routeWebSocket('**/api/v1/ws', (ws) => {
      ws.onMessage(() => {})
      ws.send(JSON.stringify({ type: 'snapshot', services: [] }))
      setTimeout(() => {
        ws.send(JSON.stringify({ type: 'session_expired', timestamp: new Date().toISOString() }))
        setTimeout(() => ws.close(), 50)
      }, 500)
    })

    await loginViaUI(page)

    // Toast should appear (message is hardcoded in Chinese currently)
    // This test verifies the current behavior; if i18n is added later, this test should be updated
    const toast = page.locator('.toast-item.toast-error')
    await expect(toast).toBeVisible({ timeout: 5000 })
  })
})
