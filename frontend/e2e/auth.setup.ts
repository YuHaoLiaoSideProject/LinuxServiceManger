/**
 * Shared authentication helper for E2E tests.
 *
 * Route note: The dashboard route path is `/` (name: 'dashboard'),
 * not `/dashboard`. After login, the app redirects to `/`.
 *
 * IMPORTANT: Always navigate to `/` (not `/login`) because Vite's proxy
 * forwards `/login` to localhost:8080 (Pi agent).
 */

import { expect, type Page } from '@playwright/test'

export const VALID_USER = 'admin'
export const VALID_PASS = 'admin123'

// ── Mock Data ─────────────────────────────────────────────────────

export const MOCK_SERVICES = [
  { name: 'nginx.service', load: 'loaded', active: 'active', sub: 'running', locked: false, unitFileState: 'enabled', fragmentPath: '/etc/systemd/system/nginx.service' },
  { name: 'myapp.service', load: 'loaded', active: 'inactive', sub: 'dead', locked: false, unitFileState: 'disabled', fragmentPath: '/etc/systemd/system/myapp.service' },
  { name: 'crash.service', load: 'loaded', active: 'failed', sub: 'failed', locked: false, unitFileState: 'disabled', fragmentPath: '/etc/systemd/system/crash.service' },
  { name: 'sshd.service', load: 'loaded', active: 'active', sub: 'running', locked: true, unitFileState: 'enabled', fragmentPath: '/usr/lib/systemd/system/sshd.service' },
  { name: 'bus-name@.service', load: 'loaded', active: 'active', sub: 'running', locked: false, unitFileState: 'enabled-runtime', fragmentPath: '/etc/systemd/system/bus-name@.service' },
  { name: 'static-svc.service', load: 'loaded', active: 'active', sub: 'running', locked: false, unitFileState: 'static', fragmentPath: '/etc/systemd/system/static-svc.service' },
  { name: 'masked-svc.service', load: 'masked', active: 'inactive', sub: 'dead', locked: false, unitFileState: 'masked', fragmentPath: '/etc/systemd/system/masked-svc.service' },
]

// ── API Mock Setup ────────────────────────────────────────────────

export interface MockOptions {
  /** Whether GET /api/v1/session returns authenticated (dynamic: updates on login/logout) */
  authenticated?: boolean
  /** Service list to return from GET /api/v1/services */
  services?: typeof MOCK_SERVICES
  /** Whether to include service action mocks (start/stop/restart) */
  includeActions?: boolean
}

/**
 * Set up all API mocks on the page.
 * Session state is dynamic: after a successful login POST, session returns
 * authenticated; after logout, session returns unauthenticated.
 */
export async function setupApiMocks(page: Page, options: MockOptions = {}) {
  const { authenticated = false, services = MOCK_SERVICES, includeActions = false } = options

  // Mutable state so session response can change after login/logout
  let loggedIn = authenticated

  // Session check (called by authStore.init() on app mount)
  await page.route('**/api/v1/session', async (route) => {
    await route.fulfill({
      status: loggedIn ? 200 : 401,
      contentType: 'application/json',
      body: JSON.stringify(
        loggedIn
          ? { authenticated: true, username: VALID_USER }
          : { error: 'unauthorized' },
      ),
    })
  })

  // Login
  await page.route('**/api/v1/login', async (route) => {
    const body = route.request().postData() || ''
    if (
      body.includes(`username=${encodeURIComponent(VALID_USER)}`) &&
      body.includes(`password=${encodeURIComponent(VALID_PASS)}`)
    ) {
      loggedIn = true
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ username: VALID_USER, message: 'Login successful' }),
      })
    } else {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'invalid credentials' }),
      })
    }
  })

  // Logout
  await page.route('**/api/v1/logout', async (route) => {
    loggedIn = false
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'logged out' }),
    })
  })

  // Services list
  await page.route('**/api/v1/services', async (route) => {
    await route.fulfill({
      status: loggedIn ? 200 : 401,
      contentType: 'application/json',
      body: JSON.stringify(loggedIn ? services : { error: 'unauthorized' }),
    })
  })

  if (includeActions) {
    // Service actions (start/stop/restart)
    await page.route('**/api/v1/services/*/start', async (route) => {
      const name = route.request().url().match(/\/services\/(.+?)\/start/)?.[1] || 'unknown'
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ message: `${name} started` }),
      })
    })

    await page.route('**/api/v1/services/*/stop', async (route) => {
      const name = route.request().url().match(/\/services\/(.+?)\/stop/)?.[1] || 'unknown'
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ message: `${name} stopped` }),
      })
    })

    await page.route('**/api/v1/services/*/restart', async (route) => {
      const name = route.request().url().match(/\/services\/(.+?)\/restart/)?.[1] || 'unknown'
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ message: `${name} restarted` }),
      })
    })

    // Auto-start enable/disable
    await page.route('**/api/v1/services/*/enable', async (route) => {
      const name = route.request().url().match(/\/services\/(.+?)\/enable/)?.[1] || 'unknown'
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ message: `${name} enabled` }),
      })
    })

    await page.route('**/api/v1/services/*/disable', async (route) => {
      const name = route.request().url().match(/\/services\/(.+?)\/disable/)?.[1] || 'unknown'
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ message: `${name} disabled` }),
      })
    })
  }
}

// ── Navigation helpers ────────────────────────────────────────────

/**
 * Navigate to the app and log in from an unauthenticated state.
 * After login, URL will be http://localhost:5199/ (the dashboard route).
 */
export async function loginViaUI(page: Page) {
  await page.goto('/')
  await page.waitForURL((url) => url.pathname === '/login', { timeout: 10_000 })
  await page.waitForSelector('.login-form', { timeout: 10_000 })

  await page.fill('input[type="text"]', VALID_USER)
  await page.fill('input[type="password"]', VALID_PASS)
  await page.click('button[type="submit"]')

  await page.waitForURL((url) => url.pathname === '/', { timeout: 10_000 })
  await page.waitForSelector('.app-header', { timeout: 10_000 })
}

/**
 * Navigate directly to the dashboard when already authenticated.
 */
export async function gotoDashboard(page: Page) {
  await page.goto('/')
  await page.waitForURL((url) => url.pathname === '/', { timeout: 10_000 })
  await page.waitForSelector('.app-header', { timeout: 10_000 })
}

// ── Header account-menu helpers ───────────────────────────────────

/**
 * Open the account menu (👤 button in the header) and wait until visible.
 * Idempotent: clicking the trigger again would toggle it closed, so only
 * click when the menu is not already open.
 */
export async function openAccountMenu(page: Page) {
  const menu = page.locator('[data-testid="account-menu"]')
  const isOpen = await menu.isVisible().catch(() => false)
  if (!isOpen) {
    await page.locator('[data-testid="account-btn"]').click()
  }
  await expect(menu).toBeVisible()
}

/**
 * Toggle the UI language via the account menu (closes the menu after).
 */
export async function toggleLang(page: Page) {
  await openAccountMenu(page)
  await page.locator('[data-testid="menu-lang"]').click()
}

/**
 * Toggle the dark/light theme via the account menu (closes the menu after).
 */
export async function toggleTheme(page: Page) {
  await openAccountMenu(page)
  await page.locator('[data-testid="menu-theme"]').click()
}

/**
 * Open the account menu and click Logout.
 */
export async function logoutViaMenu(page: Page) {
  await openAccountMenu(page)
  await page.locator('[data-testid="menu-logout"]').click()
}

// ── Selector helpers ──────────────────────────────────────────────

/**
 * Get a service row by name and find a specific action button.
 * Uses exact text matching to avoid "Start" matching "Restart".
 */
export function getServiceRow(page: Page, serviceName: string) {
  return page.locator('#service-table-body tr', { hasText: serviceName })
}

/**
 * Click a specific action button on a service row.
 * Uses exact text matching via getByRole or getByLabel.
 */
export function getActionButton(row: ReturnType<Page['locator']>, action: 'start' | 'stop' | 'restart') {
  const labels = {
    start: '▶',
    stop: '⏹',
    restart: '🔄',
  }
  return row.locator('button').filter({ hasText: labels[action] })
}
