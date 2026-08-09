import { test, expect } from '@playwright/test'
import { setupApiMocks, loginViaUI, getServiceRow } from './auth.setup'

/**
 * 010 — Log Search (搜尋日誌) E2E Tests
 *
 * BDD scenarios covered (from 005-journalctl-log-viewer.feature):
 *   E2E-10: 搜尋已載入的日誌內容 — highlight + dim + match count
 *   E2E-11: 清除搜尋關鍵字恢復完整日誌 — clear → restore all
 *   E2E-12: 搜尋無匹配結果 — all dim, no highlight, "0 / N 行"
 *   E2E-13: 搜尋大小寫不敏感 — "ERROR" matches "error"
 *   E2E-14: 搜尋不觸發後端請求 — client-side only
 *   E2E-15: 搜尋框僅在有日誌內容時顯示 — visibility condition
 */

// ── Mock Log Data ─────────────────────────────────────────────────

const MOCK_LOG_LINES = [
  'Aug 09 00:07:25 MiniServer systemd[1]: Started simpleddns.service - SimpleDDNS - 權威 DNS + 動態 DNS 服務（zone: o.mdevs.uk）.',
  'Aug 09 00:07:26 MiniServer simpleddns[3967904]: time=2026-08-09T00:07:26.010+08:00 level=INFO msg="simpleddns started" dns_udp=[::]:53 dns_tcp=[::]:53 http=127.0.0.1:8081 base_domain=o.mdevs.uk',
  'Aug 08 23:33:40 MiniServer systemd[1]: Started simpleddns.service - SimpleDDNS - 權威 DNS + 動態 DNS 服務（zone: o.mdevs.uk）.',
  'Aug 08 23:33:51 MiniServer simpleddns[3958846]: time=2026-08-08T23:33:51.852+08:00 level=INFO msg="shutting down"',
  'Aug 08 23:33:51 MiniServer systemd[1]: Stopping simpleddns.service - SimpleDDNS - 權威 DNS + 動態 DNS 服務（zone: o.mdevs.uk）...',
  'Aug 08 23:33:51 MiniServer systemd[1]: simpleddns.service: Deactivated successfully.',
  'Aug 08 23:33:51 MiniServer systemd[1]: Stopped simpleddns.service - SimpleDDNS - 權威 DNS + 動態 DNS 服務（zone: o.mdevs.uk）.',
  'Aug 08 23:34:12 MiniServer simpleddns[3958884]: error: DNS resolution timeout for upstream ns1.example.com',
  'Aug 08 23:34:12 MiniServer simpleddns[3958884]: time=2026-08-08T23:34:12.456+08:00 level=INFO msg="shutting down"',
  'Aug 08 23:34:12 MiniServer systemd[1]: Stopped simpleddns.service - SimpleDDNS - 權威 DNS + 動態 DNS 服務（zone: o.mdevs.uk）.',
]

// Lines matched by various search queries (word-boundary, case-insensitive):
//   "DNS"  → indices 0,1,2,4,6,7,9 (lines with standalone "DNS")
//            NOT: 3,5,8 ("shutting down", "Deactivated") — no "DNS" word
//            NOTE: "simpleddns" does NOT match because "dns" is part of a word
//            NOTE: "dns_udp", "dns_tcp" do NOT match (underscore is word char)
//   "error" → index 7 only ("error: DNS resolution timeout")
//   "服務" → indices 0,2,4,6,9 (CJK word boundary)

// ── Helpers ───────────────────────────────────────────────────────

/**
 * Set up a mock WebSocket that sends mock log lines when connected.
 * Returns the route so the caller can control timing (e.g., delayed send).
 */
async function setupLogWebSocketMock(
  page: any,
  options: { delay?: number; lines?: string[] } = {},
) {
  const { delay = 0, lines = MOCK_LOG_LINES } = options

  await page.routeWebSocket('**/api/v1/services/*/logs/ws**', (ws: any) => {
    ws.onMessage(() => {
      // Client doesn't send data to the server; no-op
    })

    const sendLogs = () => {
      for (const line of lines) {
        ws.send(line)
      }
    }

    if (delay > 0) {
      setTimeout(sendLogs, delay)
    } else {
      sendLogs()
    }
  })
}

/**
 * Open the log drawer for a given service and wait for log content to appear.
 */
async function openLogDrawerAndWait(page: any, serviceName: string) {
  const row = getServiceRow(page, serviceName)
  const logsBtn = row.locator('button').filter({ hasText: '📋' })
  await logsBtn.click()
  await expect(page.locator('.log-drawer')).toBeVisible()
  // Wait for at least one log line to render
  await expect(page.locator('.log-content code span').first()).toBeVisible({ timeout: 5000 })
}

/**
 * Get all log line spans currently visible (filtered).
 */
function logLineSpans(page: any) {
  return page.locator('.log-content code span')
}

/**
 * Get highlighted log line spans.
 */
function highlightedSpans(page: any) {
  return page.locator('.log-content code span.highlight')
}

/**
 * Get dimmed log line spans.
 */
function dimmedSpans(page: any) {
  return page.locator('.log-content code span.dim')
}

// ═══════════════════════════════════════════════════════════════════
// E2E-10: 搜尋已載入的日誌內容
// ═══════════════════════════════════════════════════════════════════

test.describe('E2E-10: 搜尋已載入的日誌內容', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('輸入關鍵字後應 highlight 匹配行、dim 非匹配行、顯示統計', async ({ page }) => {
    await setupLogWebSocketMock(page)
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    // Open log drawer
    await openLogDrawerAndWait(page, 'nginx.service')

    // Verify search bar is visible (logs are loaded)
    const searchBar = page.locator('.search-bar')
    await expect(searchBar).toBeVisible()

    // Verify search input is present
    const searchInput = page.locator('.search-input')
    await expect(searchInput).toBeVisible()
    await expect(searchInput).toHaveAttribute('placeholder', '搜尋日誌...')

    // Type search keyword
    await searchInput.fill('error')

    // Only index 7 has standalone "error" (word-boundary match)
    // "simpleddns" / "dns_udp" / "dns_tcp" do NOT match "error"
    await expect(highlightedSpans(page)).toHaveCount(1)

    // Non-matching lines should be dimmed (10 total - 1 matched = 9 dimmed)
    await expect(dimmedSpans(page)).toHaveCount(9)

    // Match count should show "1 / 10 行"
    const matchCount = page.locator('.match-count')
    await expect(matchCount).toBeVisible()
    await expect(matchCount).toHaveText('1 / 10 行')
  })

  test('搜尋 DNS 不應匹配 simpleddns、dns_udp、dns_tcp（word-boundary）', async ({ page }) => {
    await setupLogWebSocketMock(page)
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    await openLogDrawerAndWait(page, 'nginx.service')

    const searchInput = page.locator('.search-input')
    await searchInput.fill('DNS')

    const allSpans = logLineSpans(page)
    await expect(allSpans).toHaveCount(10)

    // Lines without standalone "DNS" → indices 3,5,8 must NOT highlight
    //   index 3: "shutting down"
    //   index 5: "Deactivated successfully"
    //   index 8: "shutting down"
    // Lines with standalone "DNS" → indices 0,2,4,6,7,9 → 6 highlights
    await expect(highlightedSpans(page)).toHaveCount(6)
    await expect(dimmedSpans(page)).toHaveCount(4)

    // Verify index 3 ("shutting down") has NO highlight
    await expect(allSpans.nth(3)).not.toHaveClass(/highlight/)
    await expect(allSpans.nth(3)).toHaveClass(/dim/)

    // Verify index 5 ("Deactivated successfully") has NO highlight
    await expect(allSpans.nth(5)).not.toHaveClass(/highlight/)
    await expect(allSpans.nth(5)).toHaveClass(/dim/)

    // Verify index 8 ("shutting down") has NO highlight
    await expect(allSpans.nth(8)).not.toHaveClass(/highlight/)
    await expect(allSpans.nth(8)).toHaveClass(/dim/)

    // Verify match count
    await expect(page.locator('.match-count')).toHaveText('6 / 10 行')

    // Verify index 7 (has standalone "DNS" in "DNS resolution timeout") IS highlighted
    await expect(allSpans.nth(7)).toHaveClass(/highlight/)
    await expect(allSpans.nth(7)).not.toHaveClass(/dim/)
  })

  test('只應 highlight 真正包含關鍵字的行，不相關的行不得亮燈', async ({ page }) => {
    await setupLogWebSocketMock(page)
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    await openLogDrawerAndWait(page, 'nginx.service')

    const searchInput = page.locator('.search-input')
    await searchInput.fill('error')

    // Get all log spans
    const allSpans = logLineSpans(page)
    await expect(allSpans).toHaveCount(10)

    // Check each span individually: only index 7 has standalone "error"
    // All other lines contain "simpleddns" / "dns_udp" / "dns_tcp" etc. — no "error" word
    for (let i = 0; i < 10; i++) {
      const span = allSpans.nth(i)
      if (i === 7) {
        await expect(span).toHaveClass(/highlight/)
        await expect(span).not.toHaveClass(/dim/)
      } else {
        await expect(span).not.toHaveClass(/highlight/)
        await expect(span).toHaveClass(/dim/)
      }
    }
  })

  test('搜尋框為空時無 highlight 也無 dim，不顯示統計', async ({ page }) => {
    await setupLogWebSocketMock(page)
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    await openLogDrawerAndWait(page, 'nginx.service')

    // No search query → no highlights, no dim, no match count
    await expect(highlightedSpans(page)).toHaveCount(0)
    await expect(dimmedSpans(page)).toHaveCount(0)
    await expect(page.locator('.match-count')).not.toBeVisible()
  })
})

// ═══════════════════════════════════════════════════════════════════
// E2E-11: 清除搜尋關鍵字恢復完整日誌
// ═══════════════════════════════════════════════════════════════════

test.describe('E2E-11: 清除搜尋關鍵字恢復完整日誌', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('清空搜尋框後恢復完整日誌、移除 highlight/dim、統計消失', async ({ page }) => {
    await setupLogWebSocketMock(page)
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    await openLogDrawerAndWait(page, 'nginx.service')

    const searchInput = page.locator('.search-input')

    // First: type search query
    await searchInput.fill('error')

    // Verify filtering is active
    await expect(highlightedSpans(page)).toHaveCount(1)
    await expect(dimmedSpans(page)).toHaveCount(9)
    await expect(page.locator('.match-count')).toBeVisible()

    // Clear search input
    await searchInput.fill('')

    // All highlights should disappear
    await expect(highlightedSpans(page)).toHaveCount(0)

    // All dims should disappear
    await expect(dimmedSpans(page)).toHaveCount(0)

    // Match count should disappear
    await expect(page.locator('.match-count')).not.toBeVisible()

    // All 10 log lines should be visible (no dim)
    await expect(logLineSpans(page)).toHaveCount(10)
  })

  test('使用 Backspace 逐字刪除後恢復正常', async ({ page }) => {
    await setupLogWebSocketMock(page)
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    await openLogDrawerAndWait(page, 'nginx.service')

    const searchInput = page.locator('.search-input')

    // Type "err" first
    await searchInput.fill('err')
    // "err" is NOT a standalone word in our data → 0 matches (word-boundary)
    await expect(highlightedSpans(page)).toHaveCount(0)
    await expect(dimmedSpans(page)).toHaveCount(10)

    // Backspace to "er"
    await searchInput.fill('er')
    // "er" as standalone word → 0 matches in this data
    const matchCountAfter = await highlightedSpans(page).count()
    expect(matchCountAfter).toBe(0)

    // Clear completely
    await searchInput.fill('')
    await expect(highlightedSpans(page)).toHaveCount(0)
    await expect(dimmedSpans(page)).toHaveCount(0)
  })
})

// ═══════════════════════════════════════════════════════════════════
// E2E-12: 搜尋無匹配結果
// ═══════════════════════════════════════════════════════════════════

test.describe('E2E-12: 搜尋無匹配結果', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('搜尋不存在關鍵字 → 全部 dim、無 highlight、顯示 "0 / N 行"', async ({ page }) => {
    await setupLogWebSocketMock(page)
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    await openLogDrawerAndWait(page, 'nginx.service')

    const searchInput = page.locator('.search-input')

    // Search for a keyword that doesn't exist in any log line
    await searchInput.fill('xyz_not_found_123')

    // No highlights
    await expect(highlightedSpans(page)).toHaveCount(0)

    // All lines should be dimmed
    await expect(dimmedSpans(page)).toHaveCount(10)

    // Match count shows "0 / 10 行"
    const matchCount = page.locator('.match-count')
    await expect(matchCount).toBeVisible()
    await expect(matchCount).toHaveText('0 / 10 行')
  })
})

// ═══════════════════════════════════════════════════════════════════
// E2E-13: 搜尋大小寫不敏感
// ═══════════════════════════════════════════════════════════════════

test.describe('E2E-13: 搜尋大小寫不敏感', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('大寫 "ERROR" 應匹配小寫 "error" 的行', async ({ page }) => {
    await setupLogWebSocketMock(page)
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    await openLogDrawerAndWait(page, 'nginx.service')

    const searchInput = page.locator('.search-input')

    // Search uppercase "ERROR"
    await searchInput.fill('ERROR')

    // Should match the same 1 line as lowercase "error" (word-boundary)
    await expect(highlightedSpans(page)).toHaveCount(1)
    await expect(dimmedSpans(page)).toHaveCount(9)
    await expect(page.locator('.match-count')).toHaveText('1 / 10 行')
  })

  test('大寫與小寫搜尋結果應一致', async ({ page }) => {
    await setupLogWebSocketMock(page)
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    await openLogDrawerAndWait(page, 'nginx.service')

    const searchInput = page.locator('.search-input')

    // Search lowercase first
    await searchInput.fill('error')
    const lowerHighlightCount = await highlightedSpans(page).count()
    const lowerMatchText = await page.locator('.match-count').textContent()

    // Clear and search uppercase
    await searchInput.fill('')
    await searchInput.fill('ERROR')
    const upperHighlightCount = await highlightedSpans(page).count()
    const upperMatchText = await page.locator('.match-count').textContent()

    // Results should be identical
    expect(upperHighlightCount).toBe(lowerHighlightCount)
    expect(upperMatchText).toBe(lowerMatchText)
  })

  test('搜尋 CJK 字詞「服務」應正確使用 word-boundary', async ({ page }) => {
    await setupLogWebSocketMock(page)
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    await openLogDrawerAndWait(page, 'nginx.service')

    const searchInput = page.locator('.search-input')
    await searchInput.fill('服務')

    // Lines with standalone "服務" → indices 0,2,4,6,9 (description lines)
    // Lines without → indices 1,3,5,7,8
    await expect(highlightedSpans(page)).toHaveCount(5)
    await expect(dimmedSpans(page)).toHaveCount(5)

    // Verify descriptive line (index 0) is highlighted
    await expect(logLineSpans(page).nth(0)).toHaveClass(/highlight/)

    // Verify "shutting down" (index 3) is NOT highlighted
    await expect(logLineSpans(page).nth(3)).not.toHaveClass(/highlight/)
    await expect(logLineSpans(page).nth(3)).toHaveClass(/dim/)

    // Verify match count shows "5 / 10 行"
    await expect(page.locator('.match-count')).toHaveText('5 / 10 行')
  })
})

// ═══════════════════════════════════════════════════════════════════
// E2E-14: 搜尋不觸發後端請求
// ═══════════════════════════════════════════════════════════════════

test.describe('E2E-14: 搜尋不觸發後端請求', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('輸入搜尋關鍵字期間不觸發任何 HTTP API 請求', async ({ page }) => {
    await setupLogWebSocketMock(page)
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    await openLogDrawerAndWait(page, 'nginx.service')

    // Start tracking new API requests after drawer is fully loaded
    const apiRequests: string[] = []
    page.on('request', (request) => {
      const url = request.url()
      if (url.includes('/api/v1/')) {
        apiRequests.push(url)
      }
    })

    const searchInput = page.locator('.search-input')

    // Type search query
    await searchInput.fill('error')
    await page.waitForTimeout(300)

    // No new API requests should have been made during search
    expect(apiRequests.length).toBe(0)

    // Clear search
    await searchInput.fill('')
    await page.waitForTimeout(300)
    expect(apiRequests.length).toBe(0)
  })

  test('快速連續輸入多個關鍵字不觸發 WebSocket 重連', async ({ page }) => {
    let wsConnectionCount = 0

    // Track WebSocket connections
    await page.routeWebSocket('**/api/v1/services/*/logs/ws**', (ws: any) => {
      wsConnectionCount++
      ws.onMessage(() => {})

      // Send mock logs
      for (const line of MOCK_LOG_LINES) {
        ws.send(line)
      }
    })

    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    await openLogDrawerAndWait(page, 'nginx.service')

    // Should have exactly 1 WebSocket connection
    const wsCountAfterOpen = wsConnectionCount
    expect(wsCountAfterOpen).toBe(1)

    const searchInput = page.locator('.search-input')

    // Rapid successive searches
    await searchInput.fill('e')
    await searchInput.fill('er')
    await searchInput.fill('err')
    await searchInput.fill('erro')
    await searchInput.fill('error')
    await searchInput.fill('')
    await searchInput.fill('nginx')

    await page.waitForTimeout(300)

    // WebSocket connection count should remain unchanged
    expect(wsConnectionCount).toBe(wsCountAfterOpen)
  })
})

// ═══════════════════════════════════════════════════════════════════
// E2E-15: 搜尋框僅在有日誌內容時顯示
// ═══════════════════════════════════════════════════════════════════

test.describe('E2E-15: 搜尋框僅在有日誌內容時顯示', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('日誌未載入前不顯示搜尋框，載入後才出現', async ({ page }) => {
    // Delay WebSocket messages so we can observe the "no search bar" state
    await setupLogWebSocketMock(page, { delay: 1500 })
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    // Open log drawer
    const row = getServiceRow(page, 'nginx.service')
    const logsBtn = row.locator('button').filter({ hasText: '📋' })
    await logsBtn.click()
    await expect(page.locator('.log-drawer')).toBeVisible()

    // Immediately after opening, search bar should NOT be visible (no logs yet)
    await expect(page.locator('.search-bar')).not.toBeVisible()

    // Wait for logs to arrive
    await expect(page.locator('.log-content code span').first()).toBeVisible({ timeout: 5000 })

    // Now search bar should appear
    const searchBar = page.locator('.search-bar')
    await expect(searchBar).toBeVisible()

    // Verify search input has correct placeholder
    const searchInput = page.locator('.search-input')
    await expect(searchInput).toBeVisible()
    await expect(searchInput).toHaveAttribute('placeholder', '搜尋日誌...')
  })

  test('日誌載入失敗時不顯示搜尋框', async ({ page }) => {
    // Mock WebSocket to send an error instead of log lines
    await page.routeWebSocket('**/api/v1/services/*/logs/ws**', (ws: any) => {
      ws.onMessage(() => {})
      // Send an error JSON message
      ws.send(JSON.stringify({ error: '無法讀取日誌：系統不支援 journalctl' }))
    })

    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    // Open log drawer
    const row = getServiceRow(page, 'nginx.service')
    const logsBtn = row.locator('button').filter({ hasText: '📋' })
    await logsBtn.click()
    await expect(page.locator('.log-drawer')).toBeVisible()

    // Wait for error message
    await expect(page.locator('.drawer-error')).toBeVisible({ timeout: 5000 })

    // Search bar should NOT be visible (no log lines)
    await expect(page.locator('.search-bar')).not.toBeVisible()
  })

  test('關閉再重新開啟 Drawer 後搜尋框正確重置', async ({ page }) => {
    await setupLogWebSocketMock(page)
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    // First open: search for something
    await openLogDrawerAndWait(page, 'nginx.service')

    const searchInput = page.locator('.search-input')
    await searchInput.fill('error')
    await expect(highlightedSpans(page)).toHaveCount(1)

    // Close drawer
    await page.locator('.log-drawer .close-btn').click()
    await expect(page.locator('.log-drawer')).not.toBeVisible()

    // Reopen drawer
    await openLogDrawerAndWait(page, 'nginx.service')

    // Search input should be empty (reset)
    // Note: searchQuery is reset in connect() when drawer reopens
    await expect(searchInput).toHaveValue('')

    // No highlights or dims (search cleared → no filtering)
    await expect(highlightedSpans(page)).toHaveCount(0)
    await expect(dimmedSpans(page)).toHaveCount(0)

    // Match count should not be visible
    await expect(page.locator('.match-count')).not.toBeVisible()
  })
})
