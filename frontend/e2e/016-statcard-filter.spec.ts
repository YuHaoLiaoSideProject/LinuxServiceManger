import { test, expect } from '@playwright/test'
import { setupApiMocks, loginViaUI, gotoDashboard } from './auth.setup'

/**
 * 016 — Stat Card 過濾（桌面 + 手機）E2E Tests
 *
 * BDD: docs/bdds/007-service-search-enhancement.feature（status-filter / stats-bar）
 * 規格: docs/uiux/014-dashboard-stats-redesign.md
 *
 * 背景：手機版實機回報「stat-card 無法 filter」。
 * 根因：mobile `.stats-bar` 使用 scroll-snap-type + scroll-snap-align，點擊位於
 * snap 點附近（或部分露出）的卡片時，iOS Safari／部分 Android 瀏覽器把點擊判為
 * 「捲動至 snap 位置」手勢而吞掉 click 事件（scroll-snap tap-suppression）。
 * 修正：保留橫向捲動、移除 scroll-snap（見 014 §7 決策修正）。
 * 本檔涵蓋桌面與手機（touch 模擬）的 stat-card 過濾行為，並以
 * 「捲動後點擊 / 點擊部分露出卡片」情境作為該 regression 的守門測試。
 */

// ── Mock data ──────────────────────────────────────────────────────
// 我的服務 tab（unlocked）：nginx/apache2/php-fpm(running)、myapp/oldapp(inactive)、crash(failed)
// 系統服務 tab（locked）：sshd/systemd-logind（皆 running）
// 我的 tab 卡片計數：All=6  Running=3  Failed=1  Inactive=2
const MOCK_016 = [
  { name: 'nginx.service',       load: 'loaded', active: 'running',  sub: 'running',  locked: false, unitFileState: 'enabled',  fragmentPath: '/etc/systemd/system/nginx.service' },
  { name: 'apache2.service',     load: 'loaded', active: 'running',  sub: 'running',  locked: false, unitFileState: 'enabled',  fragmentPath: '/etc/systemd/system/apache2.service' },
  { name: 'php-fpm.service',     load: 'loaded', active: 'running',  sub: 'running',  locked: false, unitFileState: 'enabled',  fragmentPath: '/etc/systemd/system/php-fpm.service' },
  { name: 'myapp.service',       load: 'loaded', active: 'inactive', sub: 'dead',     locked: false, unitFileState: 'disabled', fragmentPath: '/etc/systemd/system/myapp.service' },
  { name: 'oldapp.service',      load: 'loaded', active: 'inactive', sub: 'dead',     locked: false, unitFileState: 'disabled', fragmentPath: '/etc/systemd/system/oldapp.service' },
  { name: 'crash.service',       load: 'loaded', active: 'failed',   sub: 'failed',   locked: false, unitFileState: 'disabled', fragmentPath: '/etc/systemd/system/crash.service' },
  { name: 'sshd.service',        load: 'loaded', active: 'running',  sub: 'running',  locked: true,  unitFileState: 'enabled',  fragmentPath: '/usr/lib/systemd/system/sshd.service' },
  { name: 'systemd-logind.service', load: 'loaded', active: 'running', sub: 'running', locked: true, unitFileState: 'static', fragmentPath: '/usr/lib/systemd/system/systemd-logind.service' },
]

// ── Helpers ────────────────────────────────────────────────────────

function statCard(page: any, label: string) {
  return page.locator('.stats-bar .stat-card', { hasText: label })
}
function cardValue(page: any, cls: string) {
  return page.locator(`.stats-bar .stat-card.${cls} .stat-value`)
}
function serviceRows(page: any) { return page.locator('#service-table-body tr') }
function searchInput(page: any) { return page.locator('.search-wrap input[type="search"]') }
function filteredCountEl(page: any) { return page.locator('.filtered-count') }

async function assertPressed(page: any, label: string, expected: boolean) {
  await expect(statCard(page, label)).toHaveAttribute('aria-pressed', String(expected))
}

// ===================================================================
// Part 1 — 桌面版（1280×800）
// ===================================================================

test.describe('桌面版 Stat Card — 計數', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('四張卡片顯示正確計數（我的服務 tab：6/3/1/2）', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true, services: MOCK_016 })
    await loginViaUI(page)

    await expect(statCard(page, 'All')).toBeVisible()
    await expect(statCard(page, 'Running')).toBeVisible()
    await expect(statCard(page, 'Failed')).toBeVisible()
    await expect(statCard(page, 'Inactive')).toBeVisible()

    await expect(cardValue(page, 'stat-total')).toHaveText('6')
    await expect(cardValue(page, 'stat-active')).toHaveText('3')
    await expect(cardValue(page, 'stat-failed')).toHaveText('1')
    await expect(cardValue(page, 'stat-inactive')).toHaveText('2')
  })

  test('切到系統服務 tab，卡片計數跟著切換（2/2/0/0）', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true, services: MOCK_016 })
    await loginViaUI(page)

    await page.locator('#tab-system').click()

    await expect(cardValue(page, 'stat-total')).toHaveText('2')
    await expect(cardValue(page, 'stat-active')).toHaveText('2')
    await expect(cardValue(page, 'stat-failed')).toHaveText('0')
    await expect(cardValue(page, 'stat-inactive')).toHaveText('0')
  })
})

test.describe('桌面版 Stat Card — 點擊過濾', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('點擊 Running → 列表只剩 3 個 running 服務', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true, services: MOCK_016 })
    await loginViaUI(page)

    await statCard(page, 'Running').click()
    await assertPressed(page, 'Running', true)
    await assertPressed(page, 'All', false)

    await expect(serviceRows(page)).toHaveCount(3)
    await expect(page.locator('#service-table-body')).toContainText('nginx.service')
    await expect(page.locator('#service-table-body')).toContainText('apache2.service')
    await expect(page.locator('#service-table-body')).toContainText('php-fpm.service')
    await expect(page.locator('#service-table-body')).not.toContainText('myapp.service')
    await expect(page.locator('#service-table-body')).not.toContainText('crash.service')
  })

  test('點擊 Failed → 只剩 crash.service；點擊 Inactive → 2 個 inactive', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true, services: MOCK_016 })
    await loginViaUI(page)

    await statCard(page, 'Failed').click()
    await assertPressed(page, 'Failed', true)
    await expect(serviceRows(page)).toHaveCount(1)
    await expect(page.locator('#service-table-body')).toContainText('crash.service')

    await statCard(page, 'Inactive').click()
    await assertPressed(page, 'Inactive', true)
    await assertPressed(page, 'Failed', false)
    await expect(serviceRows(page)).toHaveCount(2)
    await expect(page.locator('#service-table-body')).toContainText('myapp.service')
    await expect(page.locator('#service-table-body')).toContainText('oldapp.service')
  })

  test('再點一次同一張卡片 → toggle 回 All（6 列）', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true, services: MOCK_016 })
    await loginViaUI(page)

    await statCard(page, 'Running').click()
    await assertPressed(page, 'Running', true)

    await statCard(page, 'Running').click()
    await assertPressed(page, 'All', true)
    await assertPressed(page, 'Running', false)
    await expect(serviceRows(page)).toHaveCount(6)
  })

  test('點 All 卡片 → 明確回到全部', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true, services: MOCK_016 })
    await loginViaUI(page)

    await statCard(page, 'Failed').click()
    await assertPressed(page, 'Failed', true)

    await statCard(page, 'All').click()
    await assertPressed(page, 'All', true)
    await expect(serviceRows(page)).toHaveCount(6)
  })
})

test.describe('桌面版 Stat Card — 計數即承諾（數字 = 過濾後列數）', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('任一 filter 下，卡片數字 = 表格列數', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true, services: MOCK_016 })
    await loginViaUI(page)

    const cases: Array<[string, string, number]> = [
      ['Running', 'stat-active', 3],
      ['Failed', 'stat-failed', 1],
      ['Inactive', 'stat-inactive', 2],
    ]

    for (const [label, cls, expected] of cases) {
      await statCard(page, label).click()
      await expect(serviceRows(page)).toHaveCount(expected)
      await expect(cardValue(page, cls)).toHaveText(String(expected))
      await expect(filteredCountEl(page)).toContainText(`${expected}`)
      // 回到 All 再測下一張
      await statCard(page, 'All').click()
    }
  })

  test('Running + 文字搜尋 nginx → 交集 1 列，計數仍顯示全域 3', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true, services: MOCK_016 })
    await loginViaUI(page)

    await statCard(page, 'Running').click()
    await searchInput(page).fill('nginx')
    await page.waitForTimeout(300)

    await expect(serviceRows(page)).toHaveCount(1)
    await expect(page.locator('#service-table-body')).toContainText('nginx.service')
    await expect(page.locator('#service-table-body')).not.toContainText('apache2.service')
    // 卡片數字是「全域」狀態統計，不受文字搜尋影響
    await expect(cardValue(page, 'stat-active')).toHaveText('3')
    await expect(filteredCountEl(page)).toContainText('1')
  })
})

test.describe('桌面版 Stat Card — URL 同步與跨 Tab', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('點擊卡片後 URL 帶 ?status=running', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true, services: MOCK_016 })
    await loginViaUI(page)

    await statCard(page, 'Running').click()
    await page.waitForTimeout(200)
    expect(new URL(page.url()).searchParams.get('status')).toBe('running')

    // toggle 回 All → URL 參數消失
    await statCard(page, 'Running').click()
    await page.waitForTimeout(200)
    expect(new URL(page.url()).searchParams.has('status')).toBe(false)
  })

  test('從 URL ?status=inactive 進入 → 卡片 active 且列表正確', async ({ page }) => {
    await setupApiMocks(page, { authenticated: true, services: MOCK_016 })

    await page.goto('/?status=inactive')
    await page.waitForSelector('.app-header', { timeout: 10_000 })

    await assertPressed(page, 'Inactive', true)
    await expect(serviceRows(page)).toHaveCount(2)
    await expect(page.locator('#service-table-body')).toContainText('myapp.service')
  })

  test('系統服務 tab 下 Running → 2 個 locked running 服務', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true, services: MOCK_016 })
    await loginViaUI(page)

    await page.locator('#tab-system').click()
    await statCard(page, 'Running').click()

    await expect(serviceRows(page)).toHaveCount(2)
    await expect(page.locator('#service-table-body')).toContainText('sshd.service')
    await expect(page.locator('#service-table-body')).toContainText('systemd-logind.service')
    await expect(page.locator('#service-table-body')).not.toContainText('nginx.service')
  })

  test('空結果 → EmptyState「清除過濾」→ 回到 All', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true, services: MOCK_016 })
    await loginViaUI(page)

    await statCard(page, 'Failed').click()
    await searchInput(page).fill('zzz')
    await page.waitForTimeout(300)

    await expect(page.locator('.empty-state')).toBeVisible()
    await page.locator('.empty-state .btn').click()

    await assertPressed(page, 'All', true)
    await expect(searchInput(page)).toHaveValue('')
    await expect(serviceRows(page)).toHaveCount(6)
  })
})

test.describe('桌面版 Stat Card — 載入狀態', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('載入中時卡片 disabled，載入後可點', async ({ page }) => {
    await page.route('**/api/v1/services', async (route) => {
      await new Promise(r => setTimeout(r, 1500))
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_016),
      })
    })
    await page.route('**/api/v1/session', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ authenticated: true, username: 'admin' }),
      })
    })
    await page.route('**/api/v1/login', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ username: 'admin', message: 'Login successful' }),
      })
    })

    await gotoDashboard(page)

    await expect(page.locator('.spinner-sm')).toBeVisible()
    for (const label of ['All', 'Running', 'Failed', 'Inactive']) {
      await expect(statCard(page, label)).toBeDisabled()
    }

    // 載入完成後恢復可點
    await expect(statCard(page, 'Running')).toBeEnabled({ timeout: 10_000 })
    await statCard(page, 'Running').click()
    await assertPressed(page, 'Running', true)
  })
})

// ===================================================================
// Part 2 — 手機版（390×844，touch 模擬）
// ===================================================================
// 使用 isMobile + hasTouch，讓 tap() 走真實 touch 事件路徑，
// 並以「捲動後點擊 / 點擊邊緣卡片」模擬實機 scroll-snap 吞 click 的場景。

test.describe('手機版 Stat Card — 橫向捲動 chips', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
  })

  test('卡片以橫向捲動 chips 呈現（可滑動）', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true, services: MOCK_016 })
    await loginViaUI(page)

    const bar = page.locator('.stats-bar')
    await expect(bar).toBeVisible()

    // nowrap + overflow-x:auto → 內容超出容器，可橫向捲動
    const overflow = await bar.evaluate((el: HTMLElement) => window.getComputedStyle(el).overflowX)
    expect(overflow).toBe('auto')

    const metrics = await bar.evaluate((el: HTMLElement) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }))
    expect(metrics.scrollWidth).toBeGreaterThan(metrics.clientWidth)

    // 實際滑動會改變 scrollLeft
    await bar.evaluate((el: HTMLElement) => { el.scrollLeft = 60 })
    const scrolled = await bar.evaluate((el: HTMLElement) => el.scrollLeft)
    expect(scrolled).toBeGreaterThan(0)
  })

  test('手機版 stat-card 無 scroll-snap（regression：移除 snap 才不會吞 click）', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true, services: MOCK_016 })
    await loginViaUI(page)

    const snapType = await page.locator('.stats-bar').evaluate(
      (el: HTMLElement) => window.getComputedStyle(el).scrollSnapType,
    )
    expect(snapType).toBe('none')

    const cardSnapAlign = await page.locator('.stat-card').first().evaluate(
      (el: HTMLElement) => window.getComputedStyle(el).scrollSnapAlign,
    )
    expect(cardSnapAlign).toBe('none')

    const touchAction = await page.locator('.stat-card').first().evaluate(
      (el: HTMLElement) => window.getComputedStyle(el).touchAction,
    )
    expect(touchAction).toContain('manipulation')
  })

  test('手機版每張卡片觸控目標高度 ≥ 44px', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true, services: MOCK_016 })
    await loginViaUI(page)

    const cards = page.locator('.stat-card')
    const count = await cards.count()
    for (let i = 0; i < count; i++) {
      const box = await cards.nth(i).boundingBox()
      expect(box!.height).toBeGreaterThanOrEqual(44)
    }
  })
})

test.describe('手機版 Stat Card — tap 過濾', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
  })

  test('tap Running → 列表只剩 3 個 running 服務', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true, services: MOCK_016 })
    await loginViaUI(page)

    await statCard(page, 'Running').tap()
    await assertPressed(page, 'Running', true)
    await assertPressed(page, 'All', false)

    await expect(serviceRows(page)).toHaveCount(3)
    await expect(page.locator('#service-table-body')).toContainText('nginx.service')
    await expect(page.locator('#service-table-body')).not.toContainText('crash.service')
  })

  test('tap 同一張卡片第二次 → toggle 回 All', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true, services: MOCK_016 })
    await loginViaUI(page)

    await statCard(page, 'Running').tap()
    await assertPressed(page, 'Running', true)

    await statCard(page, 'Running').tap()
    await assertPressed(page, 'All', true)
    await expect(serviceRows(page)).toHaveCount(6)
  })

  test('tap 邊緣（部分露出）的 Inactive 卡片 → 過濾生效', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true, services: MOCK_016 })
    await loginViaUI(page)

    // Inactive 是最後一張，390px 下原本超出容器右緣（需要橫向捲動才看得到）
    await statCard(page, 'Inactive').tap()

    await assertPressed(page, 'Inactive', true)
    await expect(serviceRows(page)).toHaveCount(2)
    await expect(page.locator('#service-table-body')).toContainText('myapp.service')
    await expect(page.locator('#service-table-body')).toContainText('oldapp.service')
    await expect(page.locator('#service-table-body')).not.toContainText('nginx.service')
  })

  test('捲動 chips 後立即 tap → 仍可過濾（scroll-settle 守門）', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true, services: MOCK_016 })
    await loginViaUI(page)

    // 先捲到中間位置（模擬使用者滑動 chips 後手指離開的位置）
    const bar = page.locator('.stats-bar')
    await bar.evaluate((el: HTMLElement) => { el.scrollLeft = 60 })
    await page.waitForTimeout(200)

    // 捲動後立刻點擊 — 舊版 scroll-snap 下此 tap 會被捲動吞掉
    await statCard(page, 'Failed').tap()
    await assertPressed(page, 'Failed', true)
    await expect(serviceRows(page)).toHaveCount(1)
    await expect(page.locator('#service-table-body')).toContainText('crash.service')
  })

  test('手機版計數 = 過濾後列數', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true, services: MOCK_016 })
    await loginViaUI(page)

    const cases: Array<[string, string, number]> = [
      ['Running', 'stat-active', 3],
      ['Failed', 'stat-failed', 1],
      ['Inactive', 'stat-inactive', 2],
    ]

    for (const [label, cls, expected] of cases) {
      await statCard(page, label).tap()
      await expect(serviceRows(page)).toHaveCount(expected)
      await expect(cardValue(page, cls)).toHaveText(String(expected))
      await expect(filteredCountEl(page)).toContainText(`${expected}`)
      await statCard(page, 'All').tap()
    }
  })

  test('手機版 URL 同步（?status=failed）', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true, services: MOCK_016 })
    await loginViaUI(page)

    await statCard(page, 'Failed').tap()
    await page.waitForURL(/(\?|&)status=failed/, { timeout: 5000 })
    expect(new URL(page.url()).searchParams.get('status')).toBe('failed')
  })

  test('手機版複合：tap Inactive + 搜尋 oldapp → 1 列', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true, services: MOCK_016 })
    await loginViaUI(page)

    await statCard(page, 'Inactive').tap()
    await searchInput(page).fill('oldapp')
    await page.waitForTimeout(300)

    await expect(serviceRows(page)).toHaveCount(1)
    await expect(page.locator('#service-table-body')).toContainText('oldapp.service')
    await expect(page.locator('#service-table-body')).not.toContainText('myapp.service')
    // 卡片數字是全域狀態統計，不受文字搜尋影響
    await expect(cardValue(page, 'stat-inactive')).toHaveText('2')
  })
})
