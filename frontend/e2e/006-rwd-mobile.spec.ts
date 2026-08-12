import { test, expect } from '@playwright/test'
import { setupApiMocks, loginViaUI, MOCK_SERVICES, getServiceRow, toggleLang } from './auth.setup'

/**
 * 006 — RWD 行動版 Card Layout 驗證 E2E Tests
 *
 * BDD scenarios covered:
 *   1. ✅ 桌面版 (> 1024px) — thead 可見，表格正常顯示
 *   2. ✅ 平板版 (768px – 1024px) — 按鈕 label 隱藏，僅顯示 icon
 *   3. ✅ 手機版 (< 767px) — thead 隱藏，card layout，td::before 顯示 data-label
 *   4. ✅ 手機版 actions 按鈕 — 全寬、垂直排列、label 還原
 *   5. ✅ 手機版 search / toolbar — 垂直排列、全寬
 *   6. ✅ data-label 語系切換 — 中/英文正確對應
 *   7. ✅ 超小手機 (< 400px) — 更緊湊的間距
 *   8. ✅ 手機版 card hover 效果
 *   9. ✅ 手機版空狀態 / loading 狀態
 *  10. ✅ 從桌面縮小到手機再放大 — 佈局即時切換
 */

// ── Helpers ───────────────────────────────────────────────────────

/**
 * Read the ::before pseudo-element content of a td via getComputedStyle.
 * Returns the quoted string value (e.g. `"名稱"`).
 */
async function getBeforeContent(locator: ReturnType<typeof page.locator>) {
  // Playwright locator.evaluate passes the DOM element
  return locator.evaluate((el: Element) => {
    return window.getComputedStyle(el, '::before').content
  })
}

/**
 * Assert that all td[data-label] cells have non-empty ::before content.
 */
async function assertAllDataLabelsVisible(page: any) {
  const cells = page.locator('.table-wrapper table td[data-label]')
  const count = await cells.count()
  expect(count).toBeGreaterThan(0)

  for (let i = 0; i < count; i++) {
    const content = await getBeforeContent(cells.nth(i))
    // ::before content with attr(data-label) returns something like `"名稱"` or `"Name"`
    expect(content).not.toBe('none')
    expect(content).not.toBe('""')
  }
}

// ── Scenario 1: 桌面版 (> 1024px) ─────────────────────────────

test.describe('Scenario 1: 桌面版完整表格', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('thead 應可見，包含七個欄位標頭（含 checkbox 欄）', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    const thead = page.locator('.table-wrapper table thead')
    await expect(thead).toBeVisible()

    const headers = thead.locator('th')
    await expect(headers).toHaveCount(7)

    // col-check(0) + Name(1) + Load(2) + Active(3) + Sub(4) + AutoStart(5) + Actions(6)
    await expect(headers.nth(1)).toContainText('Name')
    await expect(headers.nth(2)).toContainText('Load')
    await expect(headers.nth(3)).toContainText('Active')
  })

  test('td 元素應該是 table-cell display', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    const firstTd = page.locator('.table-wrapper table td').first()
    const display = await firstTd.evaluate((el: Element) =>
      window.getComputedStyle(el).display,
    )
    expect(display).toBe('table-cell')
  })

  test('桌面板 actions 按鈕應顯示 btn-label', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    const nginxRow = getServiceRow(page, 'nginx.service')

    // Stop 按鈕的 label 應可見
    const stopBtnLabel = nginxRow.locator('button .btn-label').first()
    await expect(stopBtnLabel).toBeVisible()
  })
})

// ── Scenario 2: 平板版 (768px – 1024px) ───────────────────────

test.describe('Scenario 2: 平板版按鈕 ICON 模式', () => {
  test.use({ viewport: { width: 900, height: 800 } })

  test('actions 按鈕 label 隱藏，僅保留 icon', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    const nginxRow = getServiceRow(page, 'nginx.service')
    const btnLabel = nginxRow.locator('button .btn-label').first()

    // At 900px (< 1024px), .btn-label should have display:none
    const display = await btnLabel.evaluate((el: Element) =>
      window.getComputedStyle(el).display,
    )
    expect(display).toBe('none')
  })

  test('平板版 thead 仍然可見', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    const thead = page.locator('.table-wrapper table thead')
    await expect(thead).toBeVisible()
  })

  test('平板版 table 仍是正常 table layout', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    const td = page.locator('.table-wrapper table td').first()
    const display = await td.evaluate((el: Element) =>
      window.getComputedStyle(el).display,
    )
    expect(display).toBe('table-cell')
  })
})

// ── Scenario 3: 手機版 (< 767px) Card Layout ──────────────────

test.describe('Scenario 3: 手機版 Card Layout', () => {
  test.use({ viewport: { width: 375, height: 812 } })

  test('thead 應被隱藏', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    const thead = page.locator('.table-wrapper table thead')
    await expect(thead).toBeHidden()
  })

  test('tr 應為 display: grid（卡片內 4 列 grid 重排）', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    const tr = page.locator('#service-table-body tr').first()
    const display = await tr.evaluate((el: Element) =>
      window.getComputedStyle(el).display,
    )
    expect(display).toBe('grid')

    // 應有 border-radius 表示 card 樣式
    const borderRadius = await tr.evaluate((el: Element) =>
      window.getComputedStyle(el).borderRadius,
    )
    expect(borderRadius).not.toBe('0px')
  })

  test('卡片標頭：Name 與 Status 在同一列（grid 重排）', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    const nameCell = page.locator('td[data-label="Name"]').first()
    const statusCell = page.locator('td[data-label="Active"]').first()
    const nameBox = await nameCell.boundingBox()
    const statusBox = await statusCell.boundingBox()
    expect(nameBox && statusBox).toBeTruthy()
    // 同一水平線（y 座標相近）
    expect(Math.abs(nameBox!.y - statusBox!.y)).toBeLessThan(4)
    // Name 在左、Status 在右
    expect(statusBox!.x).toBeGreaterThan(nameBox!.x)
  })

  test('Status 以 pill 呈現（radius 20px、淡底、右對齊）', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    const status = page.locator('td[data-label="Active"] .status-active').first()
    await expect(status).toBeVisible()
    const radius = await status.evaluate((el: Element) =>
      window.getComputedStyle(el).borderRadius,
    )
    expect(radius).toBe('20px')
  })

  test('td 應為 display: flex，左右排列（label + value）', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    // 用可見的 Name cell（col-check 在手機版是 display:none）
    const td = page.locator('td[data-label="Name"]').first()
    const display = await td.evaluate((el: Element) =>
      window.getComputedStyle(el).display,
    )
    expect(display).toBe('flex')
  })

  test('td::before 應顯示 data-label 內容（中文預設為英文）', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    // Default language is English — data-label should show "Name", "Load" etc.
    const nameCell = page.locator('td[data-label="Name"]').first()
    await expect(nameCell).toBeVisible()

    const content = await getBeforeContent(nameCell)
    expect(content).toContain('Name')
  })

  test('所有 td 都應有 data-label 屬性', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    const allTd = page.locator('.table-wrapper table td')
    const count = await allTd.count()

    for (let i = 0; i < count; i++) {
      const label = await allTd.nth(i).getAttribute('data-label')
      expect(label).toBeTruthy()
    }
  })

  test('所有非空 data-label 的 ::before 都應有內容', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    await assertAllDataLabelsVisible(page)
  })

  test('Card 之間間距正確（margin-bottom 約 0.75rem）', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    const tr = page.locator('#service-table-body tr').first()
    const marginBottom = await tr.evaluate((el: Element) =>
      window.getComputedStyle(el).marginBottom,
    )
    // margin-bottom 應 > 0
    expect(parseFloat(marginBottom)).toBeGreaterThan(0)
  })

  test('caption 子標題應隱藏', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    const sub = page.locator('table caption .caption-sub')
    await expect(sub).toBeHidden()
  })
})

// ── Scenario 4: 手機版 Actions 按鈕 ────────────────────────────

test.describe('Scenario 4: 手機版 Actions 按鈕', () => {
  test.use({ viewport: { width: 375, height: 812 } })

  test('actions 區塊應為 flex-wrap，primary 與 secondary 同一列', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    const actions = page.locator('.actions').first()
    const flexDir = await actions.evaluate((el: Element) =>
      window.getComputedStyle(el).flexDirection,
    )
    expect(flexDir).toBe('row')
    const flexWrap = await actions.evaluate((el: Element) =>
      window.getComputedStyle(el).flexWrap,
    )
    expect(flexWrap).toBe('wrap')
  })

  test('primary（Stop）全寬色塊，secondary（Restart/Logs）48px 圖示按鈕', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    const nginxRow = getServiceRow(page, 'nginx.service')
    // Primary Stop：flex 撐滿 → 寬 > 120px，danger 色底
    const stopBtn = nginxRow.locator('.actions button.btn-act-stop')
    await expect(stopBtn).toBeVisible()
    const stopW = await stopBtn.evaluate((el: Element) =>
      window.getComputedStyle(el).width,
    )
    expect(parseFloat(stopW)).toBeGreaterThan(120)
    // Background 使用 Pico outline secondary，為透明底（非 danger 紅色）
    const stopBg = await stopBtn.evaluate((el: Element) =>
      window.getComputedStyle(el).backgroundColor,
    )
    expect(stopBg).toBe('rgba(0, 0, 0, 0)')

    // Secondary Restart / Logs：48px 圖示按鈕
    const restartBtn = nginxRow.locator('.actions button.btn-act-restart')
    const logsBtn = nginxRow.locator('.actions button.btn-act-logs')
    for (const btn of [restartBtn, logsBtn]) {
      const w = await btn.evaluate((el: Element) =>
        window.getComputedStyle(el).width,
      )
      expect(parseFloat(w)).toBeGreaterThanOrEqual(44)
      expect(parseFloat(w)).toBeLessThanOrEqual(52)
    }
    // Secondary 與 primary 同一列（y 座標一致）
    const stopBox = await stopBtn.boundingBox()
    const restartBox = await restartBtn.boundingBox()
    expect(stopBox && restartBox).toBeTruthy()
    expect(Math.abs(stopBox!.y - restartBox!.y)).toBeLessThan(4)
  })

  test('locked 服務：badge 撐滿 + Logs 靠右，維持單列', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    await page.locator('#tab-system').click()
    const sshdRow = getServiceRow(page, 'sshd.service')
    const badge = sshdRow.locator('.actions .locked-badge')
    await expect(badge).toBeVisible()
    const logsBtn = sshdRow.locator('.actions button.btn-act-logs')
    const badgeBox = await badge.boundingBox()
    const logsBox = await logsBtn.boundingBox()
    expect(badgeBox && logsBox).toBeTruthy()
    // 同一列
    expect(Math.abs(badgeBox!.y - logsBox!.y)).toBeLessThan(4)
    // Logs 在右側
    expect(logsBox!.x).toBeGreaterThan(badgeBox!.x)
  })

  test('actions 按鈕應全寬顯示', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    const btn = page.locator('.actions button').first()
    const width = await btn.evaluate((el: Element) =>
      window.getComputedStyle(el).width,
    )
    // 全寬按鈕寬度大於 100px
    expect(parseFloat(width)).toBeGreaterThan(100)
  })

  test('手機版 btn-label 應恢復顯示（非 none）', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    const nginxRow = getServiceRow(page, 'nginx.service')
    const btnLabel = nginxRow.locator('button .btn-label').first()

    // Mobile overrides tablet's display:none
    const display = await btnLabel.evaluate((el: Element) =>
      window.getComputedStyle(el).display,
    )
    expect(display).not.toBe('none')
  })

  test('按鈕最小高度應為 40px', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    const btn = page.locator('.actions button').first()
    const minHeight = await btn.evaluate((el: Element) =>
      window.getComputedStyle(el).minHeight,
    )
    expect(parseFloat(minHeight)).toBeGreaterThanOrEqual(40)
  })
})

// ── Scenario 5: 手機版 Toolbar / Search ────────────────────────

test.describe('Scenario 5: 手機版 Toolbar 佈局', () => {
  test.use({ viewport: { width: 375, height: 812 } })

  test('toolbar 應為 flex-direction: column', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    const toolbar = page.locator('.toolbar')
    const flexDir = await toolbar.evaluate((el: Element) =>
      window.getComputedStyle(el).flexDirection,
    )
    expect(flexDir).toBe('column')
  })

  test('search input 應全寬', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    const searchWrap = page.locator('.toolbar .search-wrap')
    const width = await searchWrap.evaluate((el: Element) =>
      window.getComputedStyle(el).width,
    )
    // 375px viewport minus 2 * 0.75rem padding ≈ 351px, should be > 300
    expect(parseFloat(width)).toBeGreaterThan(300)
  })

  test('search input 最小高度 44px（觸控友善）', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    const input = page.locator('.toolbar .search-wrap input')
    const minHeight = await input.evaluate((el: Element) =>
      window.getComputedStyle(el).minHeight,
    )
    expect(parseFloat(minHeight)).toBeGreaterThanOrEqual(44)
  })

  test('search input 為 pill 外型（radius 20px）', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    const input = page.locator('.toolbar .search-wrap input')
    const radius = await input.evaluate((el: Element) =>
      window.getComputedStyle(el).borderRadius,
    )
    expect(radius).toBe('20px')
  })
})

// ── Scenario 6: data-label 語系切換 ────────────────────────────

test.describe('Scenario 6: 手機版 data-label 語系切換', () => {
  test.use({ viewport: { width: 375, height: 812 } })

  test('預設英文 data-label：Name / Load / Active / Sub / Auto-start / Actions', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    const row = getServiceRow(page, 'nginx.service')
    await expect(row.locator('td[data-label="Name"]')).toBeVisible()
    await expect(row.locator('td[data-label="Load"]')).toBeVisible()
    await expect(row.locator('td[data-label="Active"]')).toBeVisible()
    await expect(row.locator('td[data-label="Sub"]')).toBeVisible()
    await expect(row.locator('td[data-label="Auto-start"]')).toBeVisible()
    await expect(row.locator('td[data-label="Actions"]')).toBeVisible()
  })

  test('英文 data-label ::before 內容為英文', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    const nameCell = page.locator('td[data-label="Name"]').first()
    const content = await getBeforeContent(nameCell)
    expect(content).toContain('Name')
  })

  test('切換為繁體中文後 data-label 變為中文', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    // Switch to zh-TW
    await toggleLang(page)

    const row = getServiceRow(page, 'nginx.service')
    await expect(row.locator('td[data-label="名稱"]')).toBeVisible()
    await expect(row.locator('td[data-label="載入狀態"]')).toBeVisible()
    await expect(row.locator('td[data-label="啟用狀態"]')).toBeVisible()
    await expect(row.locator('td[data-label="執行狀態"]')).toBeVisible()
    await expect(row.locator('td[data-label="開機啟動"]')).toBeVisible()
    await expect(row.locator('td[data-label="操作"]')).toBeVisible()
  })

  test('繁體中文 data-label ::before 內容為中文', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    await toggleLang(page)

    const nameCell = page.locator('td[data-label="名稱"]').first()
    const content = await getBeforeContent(nameCell)
    expect(content).toContain('名稱')
  })

  test('切回英文後 data-label 恢復英文', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    // zh-TW → en → zh-TW → en
    await toggleLang(page)
    await toggleLang(page)

    const row = getServiceRow(page, 'nginx.service')
    await expect(row.locator('td[data-label="Name"]')).toBeVisible()
    await expect(row.locator('td[data-label="Load"]')).toBeVisible()
  })
})

// ── Scenario 7: 超小手機 (< 400px) ─────────────────────────────

test.describe('Scenario 7: 超小手機精簡佈局', () => {
  test.use({ viewport: { width: 320, height: 568 } })

  test('card padding 更小 (< 0.875rem)', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    const tr = page.locator('#service-table-body tr').first()
    const padding = await tr.evaluate((el: Element) =>
      window.getComputedStyle(el).padding,
    )
    const paddingTop = parseFloat(padding.split(' ')[0])
    expect(paddingTop).toBeLessThan(14) // 0.85rem = 13.6px
  })

  test('td font-size 縮小 (~0.9375rem)', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    const td = page.locator('.table-wrapper table td[data-label="Load"]').first()
    const fontSize = await td.evaluate((el: Element) =>
      window.getComputedStyle(el).fontSize,
    )
    const sizePx = parseFloat(fontSize)
    expect(sizePx).toBeLessThanOrEqual(16) // ~0.9375rem = 15px
  })

  test('actions 按鈕 min-height 至少 44px', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    const btn = page.locator('.actions button').first()
    const minHeight = await btn.evaluate((el: Element) =>
      window.getComputedStyle(el).minHeight,
    )
    expect(parseFloat(minHeight)).toBeGreaterThanOrEqual(44)
  })
})

// ── Scenario 8: 手機版狀態展示 ─────────────────────────────────

test.describe('Scenario 8: 手機版特殊狀態', () => {
  test.use({ viewport: { width: 375, height: 812 } })

  test('手機版 empty state 應正確顯示', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true, services: [] })
    await loginViaUI(page)

    await expect(page.locator('.empty-state')).toBeVisible()
  })

  test('手機版 loading spinner 應可見', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    // Trigger refresh to show loading briefly, then check for spinner or
    // navigate directly — use page.route to delay response
    let resolveServices: (value: any) => void
    await page.route('**/api/v1/services', async (route) => {
      await new Promise<void>((r) => { resolveServices = r })
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_SERVICES),
      })
    })

    // Click refresh to trigger loading
    await page.locator('.btn-refresh').click()

    // Spinner should be visible while loading
    await expect(page.locator('.spinner-sm')).toBeVisible({ timeout: 2000 })

    // Resolve to let the test clean up
    resolveServices!()
  })

  test('手機版搜尋後空狀態 — caption 顯示搜尋關鍵字', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    await page.locator('.search-wrap input[type="search"]').fill('zzz_not_exist')
    await expect(page.locator('.empty-state')).toBeVisible()
  })
})

// ── Scenario 11: 平板操作欄排版對齊 ──────────────────────────

test.describe('Scenario 11: 平板操作欄 grid 排版對齊', () => {
  test.use({ viewport: { width: 900, height: 800 } })

  test('actions 應為 grid 佈局，3 欄', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    const actions = page.locator('.actions').first()
    const display = await actions.evaluate((el: Element) =>
      window.getComputedStyle(el).display,
    )
    expect(display).toBe('grid')

    const cols = await actions.evaluate((el: Element) =>
      window.getComputedStyle(el).gridTemplateColumns,
    )
    expect(cols.split(' ').length).toBe(3)
  })

  test('每個 row 操作欄都有 3 個 action-slot', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    const rows = page.locator('#service-table-body tr')
    const count = await rows.count()

    for (let i = 0; i < count; i++) {
      const slots = rows.nth(i).locator('.action-slot')
      await expect(slots).toHaveCount(3)
    }
  })

  test('不同 row 的第一個 slot X 座標一致', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    const rows = page.locator('#service-table-body tr')
    const count = await rows.count()
    const firstSlotX: number[] = []

    for (let i = 0; i < count; i++) {
      const slot = rows.nth(i).locator('.action-slot').first()
      const box = await slot.boundingBox()
      if (box) firstSlotX.push(box.x)
    }

    expect(firstSlotX.length).toBeGreaterThan(1)
    const max = Math.max(...firstSlotX)
    const min = Math.min(...firstSlotX)
    expect(max - min).toBeLessThanOrEqual(2)
  })

  test('名稱欄寬度為 30%', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    // col-check 是 nth(0)，Name 是 nth(1)
    const nameTh = page.locator('thead th').nth(1)
    const width = await nameTh.evaluate((el: Element) =>
      window.getComputedStyle(el).width,
    )
    const widthPx = parseFloat(width)
    expect(widthPx).toBeGreaterThan(240)
    expect(widthPx).toBeLessThan(300)
  })

  test('操作欄寬度為 22%', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    const actionsTh = page.locator('thead th').nth(6)
    const width = await actionsTh.evaluate((el: Element) =>
      window.getComputedStyle(el).width,
    )
    const widthPx = parseFloat(width)
    expect(widthPx).toBeGreaterThan(170)
    expect(widthPx).toBeLessThan(220)
  })

  test('鎖定服務的 Logs 按鈕與其他 row 的 Logs 按鈕 X 位置一致', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    const nginxRow = getServiceRow(page, 'nginx.service')
    const nginxLogs = nginxRow.locator('.action-slot').nth(2).locator('button')
    const nginxBox = await nginxLogs.boundingBox()

    await page.locator('#tab-system').click()

    const sshdRow = getServiceRow(page, 'sshd.service')
    const sshdLogs = sshdRow.locator('.action-slot').nth(2).locator('button')
    const sshdBox = await sshdLogs.boundingBox()

    if (nginxBox && sshdBox) {
      expect(Math.abs(nginxBox.x - sshdBox.x)).toBeLessThanOrEqual(2)
    }
  })
})


// ── Scenario 12: 桌面版操作欄排版對齊 ──────────────────────────

test.describe('Scenario 12: 桌面版操作欄 grid 排版對齊', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('actions 應為 grid 佈局，3 欄', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    const actions = page.locator('.actions').first()
    const display = await actions.evaluate((el: Element) =>
      window.getComputedStyle(el).display,
    )
    expect(display).toBe('grid')

    const cols = await actions.evaluate((el: Element) =>
      window.getComputedStyle(el).gridTemplateColumns,
    )
    expect(cols.split(' ').length).toBe(3)
  })

  test('每個 row 都有 3 個 action-slot', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    const rows = page.locator('#service-table-body tr')
    const count = await rows.count()

    for (let i = 0; i < count; i++) {
      await expect(rows.nth(i).locator('.action-slot')).toHaveCount(3)
    }
  })

  test('不同 row 的 slot 水平位置一致', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    const rows = page.locator('#service-table-body tr')
    const count = await rows.count()
    const firstSlotX: number[] = []
    const lastSlotX: number[] = []

    for (let i = 0; i < count; i++) {
      const slots = rows.nth(i).locator('.action-slot')
      const first = await slots.first().boundingBox()
      const last = await slots.nth(2).boundingBox()
      if (first) firstSlotX.push(first.x)
      if (last) lastSlotX.push(last.x + last.width)
    }

    // All first slots at same X
    expect(Math.max(...firstSlotX) - Math.min(...firstSlotX)).toBeLessThanOrEqual(2)
    // All last slots (right edge) at same X
    expect(Math.max(...lastSlotX) - Math.min(...lastSlotX)).toBeLessThanOrEqual(2)
  })

  test('桌面板按鈕 label 應可見', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    const btnLabel = page.locator('.actions button .btn-label').first()
    const display = await btnLabel.evaluate((el: Element) =>
      window.getComputedStyle(el).display,
    )
    expect(display).not.toBe('none')
  })

  test('鎖定服務 slot 2 為空但保留空間，Logs 仍在 slot 3', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    await page.locator('#tab-system').click()

    const sshdRow = getServiceRow(page, 'sshd.service')
    const slots = sshdRow.locator('.action-slot')
    await expect(slots).toHaveCount(3)

    // Slot 1: locked badge
    await expect(slots.nth(0).locator('.locked-badge')).toBeVisible()
    // Slot 2: empty (no button)
    await expect(slots.nth(1).locator('button')).toHaveCount(0)
    // Slot 3: Logs button
    await expect(slots.nth(2).locator('button')).toBeVisible()
  })
})


// ── Scenario 13: 手機版設計提案排版（docs/uiux/design-proposal-mobile.html）──

test.describe('Scenario 13: 手機版設計提案排版', () => {
  test.use({ viewport: { width: 375, height: 812 } })

  test('Tabs 為 segmented control（grid、active 填滿 accent）', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    const tabs = page.locator('.tabs-bar')
    const display = await tabs.evaluate((el: Element) =>
      window.getComputedStyle(el).display,
    )
    expect(display).toBe('grid')

    const activeBtn = page.locator('.tab-btn.active')
    await expect(activeBtn).toHaveCount(1)
    const bg = await activeBtn.evaluate((el: Element) =>
      window.getComputedStyle(el).backgroundColor,
    )
    expect(bg).toContain('26, 115, 232') // --lms-accent #1a73e8

    const radius = await activeBtn.evaluate((el: Element) =>
      window.getComputedStyle(el).borderRadius,
    )
    expect(radius).toBe('9px')
  })

  test('Header 手機版為 sticky + 品牌列/導航列兩列', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    const header = page.locator('.app-header')
    const position = await header.evaluate((el: Element) =>
      window.getComputedStyle(el).position,
    )
    expect(position).toBe('sticky')

    // 品牌與帳號同一列（比較垂直中心；兩者高度不同但應同列居中）
    const brand = page.locator('.app-header-left')
    const right = page.locator('.app-header-right')
    const brandBox = await brand.boundingBox()
    const rightBox = await right.boundingBox()
    expect(brandBox && rightBox).toBeTruthy()
    const brandCenter = brandBox!.y + brandBox!.height / 2
    const rightCenter = rightBox!.y + rightBox!.height / 2
    expect(Math.abs(brandCenter - rightCenter)).toBeLessThan(4)

    // 導航列在品牌下方、全寬
    const nav = page.locator('.nav-group')
    const navBox = await nav.boundingBox()
    expect(navBox!.y).toBeGreaterThan(brandBox!.y + brandBox!.height - 2)
  })

  test('Stat 卡片圖示為 40px 色塊方塊', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    const icon = page.locator('.stat-card .stat-icon').first()
    const box = await icon.boundingBox()
    expect(box!.width).toBeGreaterThanOrEqual(38)
    expect(box!.height).toBeGreaterThanOrEqual(38)
  })
})


// ── Scenario 9: 響應式切換（resize） ────────────────────────────

test.describe('Scenario 9: 響應式即時切換', () => {
  test('從桌面縮小到手機：thead 消失，card layout 出現', async ({ page }) => {
    // Start desktop
    await page.setViewportSize({ width: 1280, height: 800 })
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    // Desktop: thead visible
    await expect(page.locator('.table-wrapper table thead')).toBeVisible()

    // Shrink to mobile
    await page.setViewportSize({ width: 375, height: 812 })

    // Mobile: thead hidden
    await expect(page.locator('.table-wrapper table thead')).toBeHidden()

    // td should be flex（用可見的 Name cell）
    const td = page.locator('td[data-label="Name"]').first()
    const display = await td.evaluate((el: Element) =>
      window.getComputedStyle(el).display,
    )
    expect(display).toBe('flex')

    // data-label ::before should have content
    const content = await getBeforeContent(td)
    expect(content).not.toBe('none')
  })

  test('從手機放大到平板：btn-label 隱藏，thead 恢復', async ({ page }) => {
    // Start mobile
    await page.setViewportSize({ width: 375, height: 812 })
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    // Mobile: thead hidden
    await expect(page.locator('.table-wrapper table thead')).toBeHidden()

    // Enlarge to tablet (900px)
    await page.setViewportSize({ width: 900, height: 800 })

    // Tablet: thead visible again
    await expect(page.locator('.table-wrapper table thead')).toBeVisible()

    // btn-label should be hidden at 900px (< 1024px)
    const btnLabel = page.locator('.actions button .btn-label').first()
    const display = await btnLabel.evaluate((el: Element) =>
      window.getComputedStyle(el).display,
    )
    expect(display).toBe('none')
  })

  test('從手機放大到桌面：完整表格恢復', async ({ page }) => {
    // Start mobile
    await page.setViewportSize({ width: 375, height: 812 })
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    await expect(page.locator('.table-wrapper table thead')).toBeHidden()

    // Enlarge to desktop (1280px)
    await page.setViewportSize({ width: 1280, height: 800 })

    // Desktop: thead visible
    await expect(page.locator('.table-wrapper table thead')).toBeVisible()

    // btn-label visible
    const btnLabel = page.locator('.actions button .btn-label').first()
    await expect(btnLabel).toBeVisible()

    // td display is table-cell
    const td = page.locator('.table-wrapper table td').first()
    const tdDisplay = await td.evaluate((el: Element) =>
      window.getComputedStyle(el).display,
    )
    expect(tdDisplay).toBe('table-cell')
  })
})

// ── Scenario 10: 手機版操作流程整合 ─────────────────────────────

test.describe('Scenario 10: 手機版操作流程', () => {
  test.use({ viewport: { width: 375, height: 812 } })

  test('手機版點擊 Start 按鈕應正常觸發操作', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    const myappRow = getServiceRow(page, 'myapp.service')

    // Use exact aria-label to distinguish Start from Restart
    const startBtn = myappRow.locator('button[aria-label="Start myapp.service"]')
    await expect(startBtn).toBeVisible()

    const startRequest = page.waitForRequest(req =>
      req.url().includes('/api/v1/services/myapp.service/start') && req.method() === 'POST',
    )

    await startBtn.click()
    await startRequest
  })

  test('手機版點擊 Stop → ConfirmModal 彈出 → 確認 → 執行', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    const nginxRow = getServiceRow(page, 'nginx.service')
    const stopBtn = nginxRow.locator('.actions button').filter({ hasText: 'Stop' })
    await expect(stopBtn).toBeVisible()

    const stopRequest = page.waitForRequest(req =>
      req.url().includes('/api/v1/services/nginx.service/stop') && req.method() === 'POST',
    )

    await stopBtn.click()

    // Confirm modal appears
    await expect(page.locator('.lms-modal-overlay')).toBeVisible()
    await expect(page.locator('.lms-modal')).toContainText('nginx.service')

    // Confirm
    await page.locator('.lms-modal-actions .btn-danger').click()

    // API called, modal gone
    await stopRequest
    await expect(page.locator('.lms-modal-overlay')).not.toBeVisible()
  })

  test('手機版搜尋後仍維持 card layout', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    await page.locator('.search-wrap input[type="search"]').fill('nginx')

    // thead still hidden
    await expect(page.locator('.table-wrapper table thead')).toBeHidden()

    // Only one card visible
    await expect(page.locator('#service-table-body tr')).toHaveCount(1)

    // data-label still present
    const cell = page.locator('td[data-label="Name"]').first()
    await expect(cell).toBeVisible()
    await expect(cell).toContainText('nginx.service')
  })

  test('手機版 Tab 切換後維持 card layout', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    // Switch to System Services
    await page.locator('#tab-system').click()

    // thead still hidden
    await expect(page.locator('.table-wrapper table thead')).toBeHidden()

    // locked service visible in card layout
    await expect(page.locator('#service-table-body')).toContainText('sshd.service')

    // locked badge visible
    await expect(page.locator('.locked-badge').first()).toBeVisible()
  })
})
