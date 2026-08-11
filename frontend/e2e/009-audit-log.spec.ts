import { test, expect } from '@playwright/test'
import { setupApiMocks, loginViaUI, gotoDashboard, VALID_USER } from './auth.setup'

/**
 * 009 — Audit Log 稽核操作紀錄 E2E Tests
 *
 * BDD: docs/bdds/009-audit-log.feature
 */

// ── Audit log mock data ───────────────────────────────────────────

const AUDIT_ENTRIES = {
  total: 5,
  page: 1,
  limit: 50,
  data: [
    { timestamp: '2025-08-09T14:30:00Z', username: 'admin',   source_ip: '10.0.0.1',     action: 'start',   target: 'nginx.service',  result: 'success', detail: '' },
    { timestamp: '2025-08-09T13:00:00Z', username: 'operator', source_ip: '192.168.1.50', action: 'restart', target: 'ssh.service',    result: 'failure', detail: 'permission denied' },
    { timestamp: '2025-08-09T12:30:00Z', username: 'admin',   source_ip: '10.0.0.1',     action: 'stop',    target: 'myapp.service',   result: 'success', detail: '' },
    { timestamp: '2025-08-09T11:00:00Z', username: 'admin',   source_ip: '10.0.0.1',     action: 'login',   target: '-',             result: 'success', detail: '' },
    { timestamp: '2025-08-09T10:30:00Z', username: 'admin',   source_ip: '10.0.0.1',     action: 'enable',  target: 'nginx.service',  result: 'success', detail: '' },
  ],
}

const AUDIT_MANY = (count: number) => {
  const data = []
  for (let i = 0; i < count; i++) {
    data.push({
      timestamp: `2025-08-0${(i % 9) + 1}T${String(10 + (i % 14)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}:00Z`,
      username: i % 3 === 0 ? 'admin' : 'operator',
      source_ip: `10.0.0.${(i % 254) + 1}`,
      action: ['start', 'stop', 'restart', 'login', 'logout'][i % 5],
      target: i % 4 === 0 ? '-' : ['nginx.service', 'ssh.service', 'myapp.service'][i % 3],
      result: i % 7 === 0 ? 'failure' : 'success',
      detail: i % 7 === 0 ? 'unit not found' : '',
    })
  }
  return { total: count, page: 1, limit: 50, data }
}

const AUDIT_SEARCH_NGINX = {
  total: 3,
  page: 1,
  limit: 50,
  data: [
    { timestamp: '2025-08-09T14:30:00Z', username: 'admin',   source_ip: '10.0.0.1', action: 'start',  target: 'nginx.service', result: 'success', detail: '' },
    { timestamp: '2025-08-09T10:30:00Z', username: 'admin',   source_ip: '10.0.0.1', action: 'enable', target: 'nginx.service', result: 'success', detail: '' },
    { timestamp: '2025-08-08T09:00:00Z', username: 'operator', source_ip: '10.0.0.2', action: 'stop',   target: 'nginx.service', result: 'failure', detail: 'timeout' },
  ],
}

const AUDIT_EMPTY = { total: 0, page: 1, limit: 50, data: [] }

const AUDIT_SEARCH_NONE = { total: 0, page: 1, limit: 50, data: [] }

// ── Helpers ───────────────────────────────────────────────────────

async function setupAuditMocks(page: any, auditData = AUDIT_ENTRIES) {
  // Audit query API
  await page.route('**/api/v1/audit?*', async (route: any) => {
    const url = new URL(route.request().url())
    const search = url.searchParams.get('search') || ''
    const from = url.searchParams.get('from') || ''
    const to = url.searchParams.get('to') || ''
    const pageParam = parseInt(url.searchParams.get('page') || '1')

    let response = { ...auditData }

    if (search === 'nginx') {
      response = { ...AUDIT_SEARCH_NGINX }
    } else if (search === '登入') {
      // 模擬後端行為：動作「login」也會比對本地化標籤「登入」
      // （見 src/internal/audit/audit.go 的 actionDisplayLabels）
      const filtered = auditData.data.filter((e: any) => e.action === 'login')
      response = { ...auditData, data: filtered, total: filtered.length }
    } else if (search === 'nonexistent123') {
      response = { ...AUDIT_SEARCH_NONE }
    }

    if (from || to) {
      // Filter by date range (simplified for mock)
      const filtered = auditData.data.filter((e: any) => {
        const d = e.timestamp.slice(0, 10)
        if (from && d < from) return false
        if (to && d > to) return false
        return true
      })
      response = { ...auditData, data: filtered, total: filtered.length }
    }

    response.page = pageParam

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(response),
    })
  })

  // Audit export CSV
  await page.route('**/api/v1/audit/export?*', async (route: any) => {
    const csvRows = ['timestamp,username,source_ip,action,target,result,detail']
    for (const e of auditData.data) {
      csvRows.push(`${e.timestamp},${e.username},${e.source_ip},${e.action},${e.target},${e.result},${e.detail}`)
    }
    await route.fulfill({
      status: 200,
      contentType: 'text/csv',
      headers: { 'Content-Disposition': 'attachment; filename="audit-log-2025-08-09.csv"' },
      body: csvRows.join('\n'),
    })
  })
}

function auditLink(page: any) { return page.locator('[data-testid="nav-audit"]') }
function auditTable(page: any) { return page.locator('main.app-container .table-wrapper table') }
function auditRows(page: any) { return page.locator('main.app-container tbody tr') }
function searchInput(page: any) { return page.locator('.search-box input') }
function dateInputs(page: any) { return page.locator('.daterange input') }
function exportBtn(page: any) { return page.locator('.btn-export') }
function condRow(page: any) { return page.locator('.audit-toolbar .cond-row') }
function pagination(page: any) { return page.locator('.pagination') }
function pageInfo(page: any) { return page.locator('.page-info') }
function spinner(page: any) { return page.locator('.spinner-sm') }
function errorState(page: any) { return page.locator('.empty-state') }
function clearLink(page: any) { return page.locator('.clear-link') }

// ===================================================================
// E2E-01: 進入 Audit Log 頁面並載入紀錄
// ===================================================================

test.describe('E2E-01~03: 進入 Audit Log 頁面', () => {
  test('點擊 Header Audit Log → 導航至 /audit 並顯示表格', async ({ page }) => {
    await setupApiMocks(page, { authenticated: true })
    await setupAuditMocks(page)
    await gotoDashboard(page)

    // Click Audit Log link in header
    await expect(auditLink(page)).toBeVisible()
    await auditLink(page).click()
    await page.waitForURL('**/audit')

    // Should see the audit page
    await expect(page.locator('main.app-container h2')).toContainText('Audit Log')

    // Table should render with data
    await expect(auditTable(page)).toBeVisible()
    await expect(auditRows(page)).toHaveCount(5)

    // Check column headers
    const headers = page.locator('main.app-container th')
    await expect(headers.nth(0)).toContainText('Time')
    await expect(headers.nth(1)).toContainText('User')
    await expect(headers.nth(2)).toContainText('Source IP')
    await expect(headers.nth(3)).toContainText('Action')
    await expect(headers.nth(4)).toContainText('Target')
    await expect(headers.nth(5)).toContainText('Result')
    await expect(headers.nth(6)).toContainText('Detail')
  })

  test('成功紀錄綠色背景、失敗紀錄紅色背景', async ({ page }) => {
    await setupApiMocks(page, { authenticated: true })
    await setupAuditMocks(page)
    await gotoDashboard(page)

    await auditLink(page).click()
    await page.waitForURL('**/audit')

    // First row: action=start, result=success → green
    const firstRow = auditRows(page).nth(0)
    await expect(firstRow).toHaveClass(/row-success/)

    // Second row: action=restart, result=failure → red
    const secondRow = auditRows(page).nth(1)
    await expect(secondRow).toHaveClass(/row-failure/)
  })
})

// ===================================================================
// E2E-02: 無紀錄時顯示空狀態
// ===================================================================

test.describe('E2E-02: 無任何操作紀錄', () => {
  test('total=0 → 顯示「尚無操作紀錄」', async ({ page }) => {
    await setupApiMocks(page, { authenticated: true })
    await setupAuditMocks(page, AUDIT_EMPTY)
    await gotoDashboard(page)

    await auditLink(page).click()
    await page.waitForURL('**/audit')

    await expect(page.locator('main.app-container')).toContainText('No audit records')
    await expect(auditTable(page)).not.toBeVisible()
  })
})

// ===================================================================
// E2E-04: 搜尋稽核紀錄
// ===================================================================

test.describe('E2E-04: 搜尋稽核紀錄', () => {
  test('輸入 "nginx" → 表格更新 + 顯示搜尋計數', async ({ page }) => {
    await setupApiMocks(page, { authenticated: true })
    await setupAuditMocks(page)
    await gotoDashboard(page)

    await auditLink(page).click()
    await page.waitForURL('**/audit')

    await searchInput(page).fill('nginx')

    // Wait for debounce (300ms) + API call
    await page.waitForTimeout(500)

    // Should show condition row with matched count
    await expect(condRow(page)).toContainText('3')

    // Table should update to 3 rows
    await expect(auditRows(page)).toHaveCount(3)
  })

  test('搜尋無匹配 → 顯示「沒有符合條件的紀錄」+ 清除過濾', async ({ page }) => {
    await setupApiMocks(page, { authenticated: true })
    await setupAuditMocks(page)
    await gotoDashboard(page)

    await auditLink(page).click()
    await page.waitForURL('**/audit')

    await searchInput(page).fill('nonexistent123')
    await page.waitForTimeout(500)

    await expect(page.locator('main.app-container')).toContainText('No matching records')
    await expect(clearLink(page)).toBeVisible()
    await expect(clearLink(page)).toContainText('Clear filters')
  })

  test('點擊清除過濾 → 恢復全部紀錄', async ({ page }) => {
    await setupApiMocks(page, { authenticated: true })
    await setupAuditMocks(page)
    await gotoDashboard(page)

    await auditLink(page).click()
    await page.waitForURL('**/audit')

    await searchInput(page).fill('nonexistent123')
    await page.waitForTimeout(500)

    await clearLink(page).click()
    await page.waitForTimeout(300)

    // Should be back to full list
    await expect(auditRows(page)).toHaveCount(5)
  })

  test('搜尋「登入」（動作顯示文字）→ 必須顯示登入紀錄（bug 回歸）', async ({ page }) => {
    // 重現使用者情境：中文介面動作欄顯示「登入」，搜尋框輸入「登入」
    await page.addInitScript(() => localStorage.setItem('lms-lang', 'zh-TW'))
    await setupApiMocks(page, { authenticated: true })
    await setupAuditMocks(page)
    await gotoDashboard(page)

    await auditLink(page).click()
    await page.waitForURL('**/audit')
    // 初始載入 5 筆，其中 1 筆是 action=login
    await expect(auditRows(page)).toHaveCount(5)

    // 送出「登入」搜尋（後端比對本地化動作標籤，模擬修正後行為）
    const searchResp = page.waitForResponse((resp) => {
      const u = new URL(resp.url())
      return u.pathname.includes('/api/v1/audit') && u.searchParams.get('search') === '登入'
    })
    await searchInput(page).fill('登入')
    await searchResp

    // 必須顯示資料，而不是「沒有符合條件的紀錄」
    await expect(auditRows(page)).toHaveCount(1)
    await expect(page.locator('main.app-container')).not.toContainText('沒有符合條件的紀錄')
    // 動作欄確實是「登入」紀錄
    await expect(auditRows(page).first()).toContainText('登入')
    // 條件回饋列「符合 1 筆記錄」
    await expect(condRow(page)).toContainText('1')
  })

  test('搜尋「登入」但沒有登入紀錄 → 仍顯示「沒有符合條件的紀錄」', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('lms-lang', 'zh-TW'))
    await setupApiMocks(page, { authenticated: true })
    // 沒有任何 audit 資料（無 login 紀錄）
    await setupAuditMocks(page, AUDIT_EMPTY)
    await gotoDashboard(page)

    await auditLink(page).click()
    await page.waitForURL('**/audit')

    await searchInput(page).fill('登入')
    await page.waitForTimeout(500)

    // 真的沒有登入紀錄時，空狀態訊息仍要正確顯示
    await expect(auditRows(page)).toHaveCount(0)
    await expect(page.locator('main.app-container')).toContainText('沒有符合條件的紀錄')
    await expect(clearLink(page)).toBeVisible()
  })

  test('搜尋不存在的資料 → 請求帶 search 參數、條件列 0 筆、✕ 清除可恢復', async ({ page }) => {
    await setupApiMocks(page, { authenticated: true })
    await setupAuditMocks(page)
    await gotoDashboard(page)

    await auditLink(page).click()
    await page.waitForURL('**/audit')
    await expect(auditRows(page)).toHaveCount(5)

    // 1. 搜尋不存在的資料 → 等待 debounce 後送出帶 search 參數的請求
    const searchResp = page.waitForResponse(
      (resp) => resp.url().includes('/api/v1/audit') && resp.url().includes('search=nonexistent123'),
    )
    await searchInput(page).fill('nonexistent123')
    await searchResp

    // 2. 表格 0 筆 → EmptyState「沒有符合條件的紀錄」+ 清除條件捷徑
    await expect(auditRows(page)).toHaveCount(0)
    await expect(page.locator('main.app-container')).toContainText('No matching records')
    await expect(clearLink(page)).toBeVisible()

    // 3. 條件回饋列顯示「符合 0 筆記錄」
    await expect(condRow(page)).toBeVisible()
    await expect(condRow(page)).toContainText('0')

    // 4. 搜尋框出現 ✕ clear
    const clearBtn = page.locator('.search-clear')
    await expect(clearBtn).toBeVisible()

    // 5. 點 ✕ → 清空搜尋並恢復全部紀錄（請求不再帶 search 參數）、條件列消失
    const resetResp = page.waitForResponse(
      (resp) => resp.url().includes('/api/v1/audit') && !resp.url().includes('search='),
    )
    await clearBtn.click()
    await resetResp
    await expect(auditRows(page)).toHaveCount(5)
    await expect(condRow(page)).not.toBeVisible()
  })
})

// ===================================================================
// E2E-05: 日期範圍篩選
// ===================================================================

test.describe('E2E-05: 日期範圍篩選', () => {
  test('選擇日期範圍 → 表格更新為範圍內紀錄', async ({ page }) => {
    await setupApiMocks(page, { authenticated: true })
    await setupAuditMocks(page, AUDIT_MANY(10))
    await gotoDashboard(page)

    await auditLink(page).click()
    await page.waitForURL('**/audit')

    const dates = dateInputs(page)
    await expect(dates).toHaveCount(2)

    await dates.nth(0).fill('2025-08-01')
    await dates.nth(1).fill('2025-08-05')

    await page.waitForTimeout(300)

    // Table should be visible with filtered results
    await expect(auditTable(page)).toBeVisible()
  })
})

// ===================================================================
// E2E-06: 翻頁瀏覽
// ===================================================================

test.describe('E2E-06: 翻頁瀏覽', () => {
  test('120 筆紀錄 → 分頁顯示，可切換頁碼', async ({ page }) => {
    await setupApiMocks(page, { authenticated: true })
    await setupAuditMocks(page, AUDIT_MANY(120))
    await gotoDashboard(page)

    await auditLink(page).click()
    await page.waitForURL('**/audit')

    // Pagination should be visible (totalPages > 1)
    await expect(pagination(page)).toBeVisible()
    await expect(pageInfo(page)).toContainText('120 records')

    // Click page 2
    const page2Btn = pagination(page).locator('button.page-btn').filter({ hasText: '2' })
    await page2Btn.click()
    await page.waitForTimeout(300)

    // Page info should update
    await expect(pageInfo(page)).toContainText('Page 2')
  })

  test('第一頁 → 上一頁 disabled', async ({ page }) => {
    await setupApiMocks(page, { authenticated: true })
    await setupAuditMocks(page, AUDIT_MANY(120))
    await gotoDashboard(page)

    await auditLink(page).click()
    await page.waitForURL('**/audit')

    const prevBtn = pagination(page).locator('button.page-btn').first()
    await expect(prevBtn).toBeDisabled()
  })
})

// ===================================================================
// E2E-07~08: 匯出 CSV
// ===================================================================

test.describe('E2E-07~08: 匯出 CSV', () => {
  test('點擊匯出 CSV → 觸發下載', async ({ page }) => {
    await setupApiMocks(page, { authenticated: true })
    await setupAuditMocks(page)
    await gotoDashboard(page)

    await auditLink(page).click()
    await page.waitForURL('**/audit')

    // Set up download listener
    const downloadPromise = page.waitForEvent('download', { timeout: 5000 })

    await exportBtn(page).click()

    const download = await downloadPromise
    expect(download.suggestedFilename()).toMatch(/audit-log-.*\.csv/)
  })
})

// ===================================================================
// E2E-18: API 錯誤顯示重試
// ===================================================================

test.describe('E2E-18: API 錯誤', () => {
  test('audit API 500 → 顯示錯誤 + 重試按鈕', async ({ page }) => {
    await setupApiMocks(page, { authenticated: true })

    // Mock audit API to return 500
    await page.route('**/api/v1/audit?*', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'internal server error' }),
      })
    })

    await gotoDashboard(page)
    await auditLink(page).click()
    await page.waitForURL('**/audit')

    // Should show error state
    await expect(errorState(page)).toBeVisible()
    await expect(page.locator('main.app-container')).toContainText('internal server error')

    // Should have retry button
    const retryBtn = page.locator('.empty-state button')
    await expect(retryBtn).toBeVisible()
    await expect(retryBtn).toContainText('Retry')
  })
})

// ===================================================================
// E2E-19: 搜尋 + 日期 + 翻頁組合
// ===================================================================

test.describe('E2E-19: 組合過濾', () => {
  test('搜尋 + 日期 → 翻頁保留過濾條件', async ({ page }) => {
    await setupApiMocks(page, { authenticated: true })
    await setupAuditMocks(page, AUDIT_MANY(120))
    await gotoDashboard(page)

    await auditLink(page).click()
    await page.waitForURL('**/audit')

    // Apply search and date filters
    await searchInput(page).fill('nginx')
    const dates = dateInputs(page)
    await dates.nth(0).fill('2025-08-01')
    await dates.nth(1).fill('2025-08-09')
    await page.waitForTimeout(500)

    // Pagination should still work with filters applied
    await expect(pagination(page)).toBeVisible()
  })
})

// ===================================================================
// UI/UX Audit: C1 — AppHeader 應在 Audit Log 頁面保持可見
// ===================================================================

test.describe('UI/UX Audit: 導航一致性', () => {
  test('C1: 從 Dashboard 導航至 /audit 後 AppHeader 仍應可見', async ({ page }) => {
    await setupApiMocks(page, { authenticated: true })
    await setupAuditMocks(page)
    await gotoDashboard(page)

    // Verify AppHeader is on dashboard first
    await expect(page.locator('.app-header')).toBeVisible()

    await auditLink(page).click()
    await page.waitForURL('**/audit')

    // C1 RED: AppHeader should still be visible after navigating to /audit
    // Currently AuditLogView does not include AppHeader → will FAIL
    await expect(page.locator('.app-header')).toBeVisible({ timeout: 3000 })
    await expect(page.locator('[data-testid="account-btn"]')).toBeVisible()
    // Should have a way to navigate back
    await expect(page.locator('.app-header-left h1')).toBeVisible()
  })
})

// ===================================================================
// UI/UX Audit: C2 — Mobile RWD 資料標籤
// ===================================================================

test.describe('UI/UX Audit: 行動版響應式設計', () => {
  test('C2: 375px viewport → <td> 必須有 data-label 屬性', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })

    await setupApiMocks(page, { authenticated: true })
    await setupAuditMocks(page)
    await gotoDashboard(page)

    await auditLink(page).click()
    await page.waitForURL('**/audit')

    // Wait for table to render
    await expect(auditTable(page)).toBeVisible()

    // C2 RED: data-label 是 mobile card layout 的關鍵屬性
    // 目前 AuditTable 沒有 data-label → 第一個 td 的 data-label 為 null
    const firstTd = page.locator('main.app-container tbody tr td').first()
    const label = await firstTd.getAttribute('data-label')
    expect(label).toBeTruthy()
  })

  test('C2: 375px viewport → 所有 td 都應有 data-label', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })

    await setupApiMocks(page, { authenticated: true })
    await setupAuditMocks(page)
    await gotoDashboard(page)

    await auditLink(page).click()
    await page.waitForURL('**/audit')
    await expect(auditTable(page)).toBeVisible()

    // All td elements in the first row should have data-label
    const tds = page.locator('main.app-container tbody tr:first-child td')
    const count = await tds.count()
    expect(count).toBe(7)

    for (let i = 0; i < count; i++) {
      const label = await tds.nth(i).getAttribute('data-label')
      expect(label, `td[${i}] 缺少 data-label`).toBeTruthy()
    }
  })
})

// ===================================================================
// UI/UX Audit: C3 — 時間欄位寬度（迴歸：main.css 全域欄寬洩漏）
// ===================================================================

test.describe('UI/UX Audit: 時間欄位寬度', () => {
  test('C3: Time 欄寬度必須足以容納完整時間戳（不被壓扁/截斷）', async ({ page }) => {
    await setupApiMocks(page, { authenticated: true })
    await setupAuditMocks(page)
    await gotoDashboard(page)

    await auditLink(page).click()
    await page.waitForURL('**/audit')
    await expect(auditTable(page)).toBeVisible()

    // Time 欄曾因 main.css 全域欄寬洩漏只剩 ~61px
    const timeBox = await page.locator('main.app-container th').nth(0).boundingBox()
    expect(timeBox).not.toBeNull()
    expect(timeBox!.width).toBeGreaterThanOrEqual(120)

    // 完整時間戳應渲染為單行，不換行、不截斷
    const firstTimeCell = page.locator('main.app-container tbody tr td').first()
    await expect(firstTimeCell).toHaveText(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
    const noOverflow = await firstTimeCell.evaluate((el) => {
      const td = el as HTMLTableCellElement
      return td.scrollWidth <= td.clientWidth + 1
    })
    expect(noOverflow).toBe(true)
  })
})

// ===================================================================
// F-HD-03: 未登入時不顯示 Audit Log 連結
// ===================================================================

test.describe('F-HD-03: 未登入隱藏 Audit Log', () => {
  test('未登入狀態 → Header 不顯示 Audit Log 連結', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false })

    // NOTE: 不能直接 goto('/login')，因為 Vite proxy 會把 /login 轉發到 Pi agent
    // 必須先載入 SPA (/)，讓 client-side router 重導向到 /login
    await page.goto('/')
    await page.waitForURL('**/login')
    await page.waitForSelector('.login-form')

    // AppHeader is not rendered on login page at all (layout guards it)
    // Verify we're on login page without audit link
    await expect(page.locator('.login-form')).toBeVisible()
    await expect(auditLink(page)).not.toBeVisible()
  })
})
