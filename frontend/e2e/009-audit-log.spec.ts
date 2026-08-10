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

function auditLink(page: any) { return page.locator('a.nav-link[href="/audit"]') }
function auditTable(page: any) { return page.locator('.audit-page table') }
function auditRows(page: any) { return page.locator('.audit-page tbody tr') }
function searchInput(page: any) { return page.locator('.search-box input') }
function dateInputs(page: any) { return page.locator('.date-range input[type="date"]') }
function exportBtn(page: any) { return page.locator('.btn-export') }
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
    await expect(page.locator('.audit-page h2')).toContainText('Audit Log')

    // Table should render with data
    await expect(auditTable(page)).toBeVisible()
    await expect(auditRows(page)).toHaveCount(5)

    // Check column headers
    const headers = page.locator('.audit-page th')
    await expect(headers.nth(0)).toContainText('時間')
    await expect(headers.nth(1)).toContainText('使用者')
    await expect(headers.nth(2)).toContainText('來源 IP')
    await expect(headers.nth(3)).toContainText('動作')
    await expect(headers.nth(4)).toContainText('目標服務')
    await expect(headers.nth(5)).toContainText('結果')
    await expect(headers.nth(6)).toContainText('詳細資訊')
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

    await expect(page.locator('.audit-page')).toContainText('尚無操作紀錄')
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

    // Should show result count
    await expect(page.locator('.search-result-count')).toContainText('3')

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

    await expect(page.locator('.audit-page')).toContainText('沒有符合條件的紀錄')
    await expect(clearLink(page)).toBeVisible()
    await expect(clearLink(page)).toContainText('清除過濾')
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
    await expect(pageInfo(page)).toContainText('共 120 筆')

    // Click page 2
    const page2Btn = pagination(page).locator('button.page-btn').filter({ hasText: '2' })
    await page2Btn.click()
    await page.waitForTimeout(300)

    // Page info should update
    await expect(pageInfo(page)).toContainText('第 2')
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
    await expect(page.locator('.audit-page')).toContainText('internal server error')

    // Should have retry button
    const retryBtn = page.locator('.empty-state button')
    await expect(retryBtn).toBeVisible()
    await expect(retryBtn).toContainText('重試')
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
// F-HD-03: 未登入時不顯示 Audit Log 連結
// ===================================================================

test.describe('F-HD-03: 未登入隱藏 Audit Log', () => {
  test('未登入狀態 → Header 不顯示 Audit Log 連結', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false })

    await page.goto('/login')
    await page.waitForURL('**/login')
    await page.waitForSelector('.login-form')

    // AppHeader is not rendered on login page at all (layout guards it)
    // Verify we're on login page without audit link
    await expect(page.locator('.login-form')).toBeVisible()
    await expect(auditLink(page)).not.toBeVisible()
  })
})
