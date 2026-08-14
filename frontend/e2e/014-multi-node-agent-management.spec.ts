/**
 * 014 — 多機管理 Agent 模式 E2E Tests
 *
 * 對應文件：
 *   - docs/test-plans/014-multi-node-agent-management測試計畫.md §5（E2E-01~56）
 *   - docs/bdds/014-multi-node-agent-management.feature（69 Scenario）
 *   - docs/development/014-multi-node-agent-management.md §2 前端 / §3.2 API / §3.4 WS 合約
 *   - 技術決策 014（D-1~D-10，以 D-2 路由變更為準：`/`=Aggregate、`/dashboard?node=`=單節點）
 *
 * 環境：全 mock（page.route 攔截 API + page.routeWebSocket 模擬 WS server 推播）。
 * 分節對照測試計畫 §5：5.1 Aggregate / 5.2 切換 / 5.3 服務操作 / 5.4 搜尋 /
 * 5.5 詳情 / 5.6 Node Management / 5.7 心跳離線 / 5.8 異常邊界。
 */

import { test, expect, type Page } from '@playwright/test'
import {
  setupApiMocks, setupNodeApiMocks, mockNodeWs, loginViaUI, gotoDashboard,
  makeNode, computeNodeSummary, MOCK_SERVICES,
  type NodeApiMockOptions, type NodeMocks, type WsHub,
} from './auth.setup'
import type { Node } from '../src/types/node'

// ── 測試資料 ──────────────────────────────────────────────────────

const NODE_WEB: Node = makeNode({
  id: 'n_web', name: 'web-server-01', address: '10.0.0.5:8443', status: 'online',
  hostname: 'web-server-01', agent_version: '1.2.0',
  service_stats: { total: 3, active: 2, failed: 1 },
})
const NODE_DB: Node = makeNode({
  id: 'n_db', name: 'db-server-01', address: '10.0.0.6:8443', status: 'online',
  hostname: 'db-server-01', agent_version: '1.2.0',
  service_stats: { total: 4, active: 4, failed: 0 },
})
const NODE_CACHE: Node = makeNode({
  id: 'n_cache', name: 'cache-server-01', address: '10.0.0.7:8443', status: 'offline',
  hostname: 'cache-server-01', agent_version: '1.0.5',
  last_heartbeat: new Date(Date.now() - 60_000).toISOString(),
  service_stats: { total: 2, active: 0, failed: 2 },
})
const NODE_LEGACY: Node = makeNode({
  id: 'n_legacy', name: 'legacy-server-01', address: '10.0.0.8:8443', status: 'long_offline',
  hostname: 'legacy-server-01', agent_version: '1.1.0',
  last_heartbeat: new Date(Date.now() - 3600_000).toISOString(),
  service_stats: { total: 1, active: 0, failed: 0 },
})
const NODE_DEGRADED: Node = makeNode({
  id: 'n_deg', name: 'edge-server-01', address: '10.0.0.9:8443', status: 'degraded',
  hostname: 'edge-server-01', agent_version: '1.2.0',
  last_heartbeat: new Date(Date.now() - 15_000).toISOString(),
  service_stats: { total: 1, active: 1, failed: 0 },
})
const NODE_OLD: Node = makeNode({
  id: 'n_old', name: 'old-agent-01', address: '10.0.0.10:8443', status: 'warning',
  hostname: 'old-agent-01', agent_version: 'v1.0',
  service_stats: { total: 5, active: 3, failed: 0 },
})

// ── 頁面設定 helpers ──────────────────────────────────────────────

interface SetupResult { mocks: NodeMocks; ws: WsHub }

/** 登入並停留在 Aggregate（`/`）；node API + WS 全 mock */
async function gotoAggregate(page: Page, nodeOpts: NodeApiMockOptions = {}): Promise<SetupResult> {
  await page.addInitScript(() => localStorage.setItem('lms-lang', 'zh-TW'))
  await setupApiMocks(page, { authenticated: false, includeActions: true })
  const mocks = await setupNodeApiMocks(page, nodeOpts)
  const ws = await mockNodeWs(page)
  await loginViaUI(page, { landOn: 'aggregate' })
  return { mocks, ws }
}

/** 登入後直接進入單節點視圖 /dashboard?node= */
async function gotoNodeDashboard(page: Page, nodeId: string, nodeOpts: NodeApiMockOptions = {}): Promise<SetupResult> {
  await page.addInitScript(() => localStorage.setItem('lms-lang', 'zh-TW'))
  await setupApiMocks(page, { authenticated: false, includeActions: true })
  const mocks = await setupNodeApiMocks(page, nodeOpts)
  const ws = await mockNodeWs(page)
  await loginViaUI(page)
  await page.goto(`/dashboard?node=${nodeId}`)
  await page.waitForSelector('.app-header', { timeout: 10_000 })
  return { mocks, ws }
}

/** 登入後進入 Node Management（/nodes） */
async function gotoNodeManagement(page: Page, nodeOpts: NodeApiMockOptions = {}): Promise<SetupResult> {
  await page.addInitScript(() => localStorage.setItem('lms-lang', 'zh-TW'))
  await setupApiMocks(page, { authenticated: false, includeActions: true })
  const mocks = await setupNodeApiMocks(page, nodeOpts)
  const ws = await mockNodeWs(page)
  await loginViaUI(page)
  await page.click('[data-testid="nav-nodes"]')
  await page.waitForURL((u) => u.pathname === '/nodes', { timeout: 10_000 })
  await page.waitForSelector('.node-management', { timeout: 10_000 })
  return { mocks, ws }
}

const card = (page: Page, name: string) => page.locator('.node-card', { hasText: name })
const chip = (page: Page, idx: number) => page.locator('[data-testid="aggregate-stats"] .stat-chip').nth(idx).locator('b')

// WS 訊息工廠（開發規格 §3.4 合約）
const offlineMsg = (n: Node, active = 'offline') => ({ type: 'node_offline', id: n.id, name: n.name, active, timestamp: new Date().toISOString() })
const onlineMsg = (n: Node) => ({ type: 'node_online', id: n.id, name: n.name, active: 'online', timestamp: new Date().toISOString() })
const statusMsg = (n: Node, active: Node['status'], extra: Partial<Record<string, unknown>> = {}) => ({
  type: 'node_status', id: n.id, name: n.name, active, timestamp: new Date().toISOString(), ...extra,
})

// ===================================================================
// §5.1 Aggregate Dashboard（@entry @aggregate）E2E-01~05
// ===================================================================

test.describe('5.1 Aggregate Dashboard', () => {
  test('E2E-01: 登入後預設進入 Aggregate Dashboard（並行 nodes+summary）', async ({ page }) => {
    // 並行驗證：nodes GET 延遲 400ms，summary 必須在 nodes 尚未完成時就已發送
    let nodesResolve!: () => void
    const nodesGate = new Promise<void>((r) => { nodesResolve = r })
    let sawParallel = false
    let nodesReq = 0
    let summaryReq = 0

    await page.addInitScript(() => localStorage.setItem('lms-lang', 'zh-TW'))
    await setupApiMocks(page, { authenticated: false })
    const mocks = await setupNodeApiMocks(page, { nodes: [NODE_WEB, NODE_DB] })
    await mockNodeWs(page)

    await page.route('**/api/v1/nodes', async (route) => {
      if (route.request().method() !== 'GET') return route.continue()
      nodesReq++
      await new Promise((r) => setTimeout(r, 400))
      nodesResolve()
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: mocks.nodes }) })
    })
    await page.route('**/api/v1/nodes/summary', async (route) => {
      summaryReq++
      const nodesDone = await Promise.race([
        nodesGate.then(() => true),
        new Promise<boolean>((r) => setTimeout(() => r(false), 150)),
      ])
      if (!nodesDone) sawParallel = true   // summary 在 nodes 完成前即已發出 → 並行
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: computeNodeSummary(mocks.nodes) }) })
    })

    await loginViaUI(page, { landOn: 'aggregate' })

    // 路由為 /
    expect(new URL(page.url()).pathname).toBe('/')
    // 統計列 + Node Cards 網格
    await expect(page.locator('[data-testid="aggregate-stats"]')).toBeVisible()
    await expect(page.locator('.node-card')).toHaveCount(2)
    // 兩個請求被並行呼叫
    expect(nodesReq).toBeGreaterThanOrEqual(1)
    expect(summaryReq).toBeGreaterThanOrEqual(1)
    expect(sawParallel).toBe(true)
  })

  test('E2E-02: 頂部統計列數值正確（3 節點：2 線上 1 離線）', async ({ page }) => {
    await gotoAggregate(page, { nodes: [NODE_WEB, NODE_DB, NODE_CACHE] })

    // 總節點數 / 線上台數 / 離線台數
    await expect(chip(page, 0)).toHaveText('3')
    await expect(chip(page, 1)).toHaveText('2')
    await expect(chip(page, 2)).toHaveText('1')
    // 總服務數 / 執行中 / 失敗（心跳統計聚合：3+4+2 / 2+4+0 / 1+0+2）
    await expect(chip(page, 3)).toHaveText('9')
    await expect(chip(page, 4)).toHaveText('6')
    await expect(chip(page, 5)).toHaveText('3')
  })

  test('E2E-03: Node Cards 網格資訊完整（名稱/Hostname/狀態燈/服務統計/最後心跳）', async ({ page }) => {
    await gotoAggregate(page, { nodes: [NODE_WEB, NODE_CACHE] })

    const web = card(page, 'web-server-01')
    await expect(web).toBeVisible()
    await expect(web.locator('.node-name')).toHaveText('web-server-01')
    await expect(web.locator('.node-hostname')).toHaveText('web-server-01')
    // 狀態燈（SVG + 文字標籤）
    await expect(web.locator('.node-status-dot svg circle')).toHaveAttribute('fill', 'var(--lms-success)')
    await expect(web.locator('.status-text')).toHaveText('線上')
    // 服務統計 M/N 執行中
    await expect(web.locator('.node-stats')).toHaveText('2/3 執行中')
    // 最後心跳相對時間
    await expect(web.locator('.node-heartbeat')).toContainText('最後心跳：')
    await expect(web.locator('.node-heartbeat')).toContainText('秒前')

    const cache = card(page, 'cache-server-01')
    await expect(cache.locator('.node-hostname')).toHaveText('cache-server-01')
    // 離線：服務統計灰顯
    await expect(cache.locator('.node-stats')).toHaveClass(/dimmed/)
    await expect(cache).toHaveClass(/node-offline/)
  })

  test('E2E-04: 無節點空狀態與導引', async ({ page }) => {
    await gotoAggregate(page, { nodes: [] })

    await expect(page.getByText('尚無已註冊節點，請先新增節點')).toBeVisible()
    // 導引至 Node Management 入口
    const guide = page.locator('.aggregate-dashboard a', { hasText: 'Node Management' })
    await expect(guide).toBeVisible()
    await expect(guide).toHaveAttribute('href', '/nodes')
    // 無統計數字（空狀態仍顯示統計列為 0）
    await expect(chip(page, 0)).toHaveText('0')
  })

  test('E2E-05: 4 種狀態燈顯示（online/degraded/offline/long_offline → 🟢🟡🔴⚫）', async ({ page }) => {
    await gotoAggregate(page, { nodes: [NODE_WEB, NODE_DEGRADED, NODE_CACHE, NODE_LEGACY] })

    const cards = page.locator('.node-card')
    await expect(cards).toHaveCount(4)
    // 排序：online/degraded 在前、offline 次之、long_offline 置底
    await expect(cards.nth(0)).toContainText('web-server-01')
    await expect(cards.nth(0).locator('.status-text')).toHaveText('線上')
    await expect(cards.nth(0).locator('.node-status-dot svg circle')).toHaveAttribute('fill', 'var(--lms-success)')

    await expect(cards.nth(1)).toContainText('edge-server-01')
    await expect(cards.nth(1).locator('.status-text')).toHaveText('延遲')
    await expect(cards.nth(1).locator('.node-status-dot svg circle')).toHaveAttribute('fill', 'var(--lms-warning)')

    await expect(cards.nth(2)).toContainText('cache-server-01')
    await expect(cards.nth(2).locator('.status-text')).toHaveText('離線')
    await expect(cards.nth(2).locator('.node-status-dot svg circle')).toHaveAttribute('fill', 'var(--lms-danger)')
    await expect(cards.nth(2)).toHaveClass(/node-offline/)

    await expect(cards.nth(3)).toContainText('legacy-server-01')
    await expect(cards.nth(3).locator('.status-text')).toHaveText('長期離線')
    await expect(cards.nth(3).locator('.node-status-dot svg circle')).toHaveAttribute('fill', 'var(--lms-muted)')
    await expect(cards.nth(3)).toHaveClass(/node-long-offline/)
  })
})

// ===================================================================
// §5.2 節點切換（@switch）E2E-06~09
// ===================================================================

test.describe('5.2 節點切換', () => {
  test('E2E-06: 點擊線上節點 Card 切換單節點視圖', async ({ page }) => {
    const { mocks } = await gotoAggregate(page, { nodes: [NODE_WEB, NODE_DB] })

    await card(page, 'web-server-01').click()

    await page.waitForURL((u) => u.pathname === '/dashboard' && u.searchParams.get('node') === 'n_web', { timeout: 10_000 })
    // GET /api/v1/nodes/{id}/services 已發送
    await expect.poll(() => mocks.stats.services).toBeGreaterThanOrEqual(1)
    // Header 顯示節點名稱 + 下拉
    await expect(page.locator('[data-testid="node-switcher"] .ns-label')).toHaveText('web-server-01')
    await expect(page.locator('[data-testid="node-switcher"]')).toBeVisible()
    // 服務列表載入（代理回傳 MOCK_SERVICES）
    await expect(page.locator('#service-table-body')).toContainText('nginx.service')
  })

  test('E2E-07: Header 下拉切換節點（服務列表重新載入）', async ({ page }) => {
    const { mocks } = await gotoNodeDashboard(page, 'n_web', { nodes: [NODE_WEB, NODE_DB] })
    await expect(page.locator('#service-table-body')).toContainText('nginx.service')
    const servicesBefore = mocks.stats.services

    // 下拉選 db-server-01
    await page.click('[data-testid="node-switcher"]')
    await page.locator('[data-testid="node-dropdown"] .node-option', { hasText: 'db-server-01' }).click()

    await page.waitForURL((u) => u.pathname === '/dashboard' && u.searchParams.get('node') === 'n_db', { timeout: 10_000 })
    // Header 名稱更新 + 服務列表重新載入
    await expect(page.locator('[data-testid="node-switcher"] .ns-label')).toHaveText('db-server-01')
    await expect.poll(() => mocks.stats.services).toBeGreaterThan(servicesBefore)
  })

  test('E2E-08: 「所有節點」返回 Aggregate', async ({ page }) => {
    await gotoNodeDashboard(page, 'n_web', { nodes: [NODE_WEB, NODE_DB] })

    await page.click('[data-testid="node-switcher"]')
    await page.locator('[data-testid="node-dropdown"] .node-option.all').click()

    await page.waitForURL((u) => u.pathname === '/', { timeout: 10_000 })
    await expect(page.locator('[data-testid="aggregate-stats"]')).toBeVisible()
    await expect(page.locator('.node-card')).toHaveCount(2)
  })

  test('E2E-09: 下拉列出所有節點 + 狀態燈 + 目前節點反白', async ({ page }) => {
    await gotoNodeDashboard(page, 'n_web', { nodes: [NODE_WEB, NODE_DB, NODE_CACHE, NODE_LEGACY] })

    await page.click('[data-testid="node-switcher"]')
    const dropdown = page.locator('[data-testid="node-dropdown"]')
    await expect(dropdown).toBeVisible()

    // 「所有節點」+ 4 個節點選項
    await expect(dropdown.locator('.node-option')).toHaveCount(5)
    // 每選項含名稱 + 狀態燈
    const webOpt = dropdown.locator('.node-option', { hasText: 'web-server-01' })
    await expect(webOpt.locator('.node-status-dot')).toBeVisible()
    await expect(webOpt).toHaveClass(/active/)
    await expect(webOpt).toHaveAttribute('aria-checked', 'true')
    // 離線選項帶狀態文字
    const cacheOpt = dropdown.locator('.node-option', { hasText: 'cache-server-01' })
    await expect(cacheOpt.locator('.opt-st')).toHaveText('離線')
    const legacyOpt = dropdown.locator('.node-option', { hasText: 'legacy-server-01' })
    await expect(legacyOpt.locator('.opt-st')).toHaveText('長期離線')
    // 目前節點反白（web）
    await expect(webOpt).toHaveClass(/active/)
    await expect(dropdown.locator('.node-option.all')).not.toHaveClass(/active/)
  })
})

// ===================================================================
// §5.3 單節點服務操作（@service，Outline ×5）E2E-10~16
// ===================================================================

test.describe('5.3 單節點服務操作', () => {
  test('E2E-10: 啟動服務（myapp inactive → Start）', async ({ page }) => {
    await gotoNodeDashboard(page, 'n_web', { nodes: [NODE_WEB] })

    const row = page.locator('#service-table-body tr', { hasText: 'myapp.service' })
    await row.locator('.btn-act-start').click()

    await expect(page.locator('#toast-container')).toContainText('web-server-01 myapp.service 已啟動')
  })

  test('E2E-11: 停止服務（nginx active → Stop）', async ({ page }) => {
    await gotoNodeDashboard(page, 'n_web', { nodes: [NODE_WEB] })

    const row = page.locator('#service-table-body tr', { hasText: 'nginx.service' })
    await row.locator('.btn-act-stop').click()
    // stop/restart 需經 ConfirmModal（ServiceTable onAction）
    await page.locator('.lms-modal .btn-danger').click()

    await expect(page.locator('#toast-container')).toContainText('web-server-01 nginx.service 已停止')
  })

  test('E2E-12: 重啟服務（nginx → Restart）', async ({ page }) => {
    await gotoNodeDashboard(page, 'n_web', { nodes: [NODE_WEB] })

    const row = page.locator('#service-table-body tr', { hasText: 'nginx.service' })
    await row.locator('.btn-act-restart').click()
    await page.locator('.lms-modal .btn-danger').click()

    await expect(page.locator('#toast-container')).toContainText('web-server-01 nginx.service 已重啟')
  })

  test('E2E-13: 啟用服務（myapp Auto-start OFF → ON）', async ({ page }) => {
    await gotoNodeDashboard(page, 'n_web', { nodes: [NODE_WEB] })

    const row = page.locator('#service-table-body tr', { hasText: 'myapp.service' })
    const toggle = row.locator('.toggle-switch')
    await expect(toggle).toHaveClass(/toggle-off/)
    await toggle.click()

    await expect(page.locator('#toast-container')).toContainText('web-server-01 myapp.service 已啟用')
  })

  test('E2E-14: 停用服務（nginx Auto-start ON → 確認 → OFF）', async ({ page }) => {
    await gotoNodeDashboard(page, 'n_web', { nodes: [NODE_WEB] })

    const row = page.locator('#service-table-body tr', { hasText: 'nginx.service' })
    const toggle = row.locator('.toggle-switch')
    await expect(toggle).toHaveClass(/toggle-on/)
    await toggle.click()

    // 停用需確認（ConfirmModal）
    await expect(page.locator('.lms-modal-overlay')).toBeVisible()
    await page.locator('.lms-modal .btn-danger').click()

    await expect(page.locator('#toast-container')).toContainText('web-server-01 nginx.service 已停用')
  })

  test('E2E-15: 檢視服務日誌（getNodeLogs + 日誌檢視器）', async ({ page }) => {
    const { mocks } = await gotoNodeDashboard(page, 'n_web', { nodes: [NODE_WEB] })

    const row = page.locator('#service-table-body tr', { hasText: 'nginx.service' })
    await row.locator('.btn-act-logs').click()

    // GET /api/v1/nodes/{id}/services/nginx.service/logs
    await expect.poll(() => mocks.stats.logs).toBeGreaterThanOrEqual(1)
    await expect(page.locator('.log-drawer')).toBeVisible()
    await expect(page.locator('.log-drawer')).toContainText('nginx.service')
    await expect(page.locator('.log-drawer')).toContainText('hello from nginx.service')
  })

  test('E2E-16: 操作失敗顯示錯誤原因（500 權限不足 → Toast + 狀態不變）', async ({ page }) => {
    await gotoNodeDashboard(page, 'n_web', {
      nodes: [NODE_WEB],
      actionResponses: { restart: { status: 500, body: { error: '權限不足' } } },
    })

    const row = page.locator('#service-table-body tr', { hasText: 'nginx.service' })
    await row.locator('.btn-act-restart').click()
    await page.locator('.lms-modal .btn-danger').click()

    await expect(page.locator('#toast-container')).toContainText('web-server-01 nginx.service 操作失敗：權限不足')
    // 服務列表狀態不變（仍 active/執行中，zh-TW）
    await expect(row).toContainText('執行中')
  })
})

// ===================================================================
// §5.4 跨節點搜尋（@search）E2E-17~20
// ===================================================================

test.describe('5.4 跨節點搜尋', () => {
  test('E2E-17: 跨節點搜尋服務（debounce 300ms 後發送 + 結果列表）', async ({ page }) => {
    const { mocks } = await gotoAggregate(page, {
      nodes: [NODE_WEB, NODE_DB],
      search: () => ({
        results: [
          { node_id: 'n_web', node_name: 'web-server-01', service: 'nginx.service', active: 'active', sub: 'running' },
          { node_id: 'n_db', node_name: 'db-server-01', service: 'nginx.service', active: 'active', sub: 'running' },
        ],
        failed_nodes: [],
      }),
    })

    await page.fill('[data-testid="node-search"]', 'nginx')

    // 停止輸入 300ms 後才發送 GET search?q=nginx
    await expect.poll(() => mocks.stats.search, { timeout: 3_000 }).toBeGreaterThanOrEqual(1)
    // 結果列表顯示節點名稱、服務名稱、狀態
    const results = page.locator('[data-testid="search-results"]')
    await expect(results).toBeVisible()
    await expect(results.locator('.search-item')).toHaveCount(2)
    await expect(results.locator('.search-item').first().locator('.search-node')).toHaveText('web-server-01')
    await expect(results.locator('.search-item').first().locator('.search-service')).toHaveText('nginx.service')
    await expect(results.locator('.search-item').first().locator('.search-state')).toHaveText('active')
  })

  test('E2E-18: 點擊結果跳轉並展開（?node=&service=）', async ({ page }) => {
    await gotoAggregate(page, {
      nodes: [NODE_WEB, NODE_DB],
      search: () => ({
        results: [
          { node_id: 'n_web', node_name: 'web-server-01', service: 'nginx.service', active: 'active', sub: 'running' },
        ],
        failed_nodes: [],
      }),
    })

    await page.fill('[data-testid="node-search"]', 'nginx')
    await page.locator('[data-testid="search-results"] .search-item').first().click()

    // 切換至 /dashboard?node={id}&service=nginx.service 並自動展開服務日誌
    await page.waitForURL((u) => u.pathname === '/dashboard'
      && u.searchParams.get('node') === 'n_web'
      && u.searchParams.get('service') === 'nginx.service', { timeout: 10_000 })
    await expect(page.locator('.log-drawer')).toBeVisible()
    await expect(page.locator('.log-drawer')).toContainText('nginx.service')
  })

  test('E2E-19: 搜尋無匹配空提示（可關閉返回 Card 視圖）', async ({ page }) => {
    await gotoAggregate(page, {
      nodes: [NODE_WEB, NODE_DB],
      search: () => ({ results: [], failed_nodes: [] }),
    })

    await page.fill('[data-testid="node-search"]', 'mysql')
    await expect(page.locator('[data-testid="search-results"]')).toBeVisible()
    await expect(page.getByText('沒有找到匹配的服務')).toBeVisible()

    // 關閉搜尋返回 Card 視圖
    await page.locator('.search-clear').click()
    await expect(page.locator('[data-testid="search-results"]')).toHaveCount(0)
    await expect(page.locator('.node-card')).toHaveCount(2)
  })

  test('E2E-20: 部分節點離線僅回傳可達節點結果（failed_nodes 標示）', async ({ page }) => {
    await gotoAggregate(page, {
      nodes: [NODE_WEB, NODE_CACHE],
      search: () => ({
        results: [
          { node_id: 'n_web', node_name: 'web-server-01', service: 'nginx.service', active: 'active', sub: 'running' },
        ],
        failed_nodes: [{ node_id: 'n_cache', node_name: 'cache-server-01', reason: 'offline' }],
      }),
    })

    await page.fill('[data-testid="node-search"]', 'nginx')
    const results = page.locator('[data-testid="search-results"]')
    await expect(results).toBeVisible()
    // 僅顯示可達節點結果
    await expect(results.locator('.search-item')).toHaveCount(1)
    await expect(results.locator('.search-item').first().locator('.search-node')).toHaveText('web-server-01')
    // 尾部「N 個節點無法查詢（離線/逾時）」
    await expect(results.locator('.failed-note')).toContainText('1')
    await expect(results.locator('.failed-note')).toContainText('個節點無法查詢（離線/逾時）')
    await expect(results.locator('.failed-note')).toContainText('cache-server-01')
  })
})

// ===================================================================
// §5.5 節點詳細資訊（@node-detail）E2E-21~22
// ===================================================================

test.describe('5.5 節點詳細資訊', () => {
  test('E2E-21: 查看節點詳情面板（GET info + 名稱/Hostname/版本/OS/上線時長/最後心跳 + 按鈕）', async ({ page }) => {
    const { mocks } = await gotoAggregate(page, { nodes: [NODE_WEB] })

    await card(page, 'web-server-01').locator('[data-testid="node-detail"]').click()

    // GET /api/v1/nodes/{id}/info 已發送
    await expect.poll(() => mocks.stats.info).toBeGreaterThanOrEqual(1)
    const panel = page.locator('[data-testid="node-detail-panel"]')
    await expect(panel).toBeVisible()
    await expect(panel).toContainText('web-server-01')
    await expect(panel).toContainText('Hostname')
    await expect(panel).toContainText('Agent 版本')
    await expect(panel).toContainText('1.2.0')
    await expect(panel).toContainText('Ubuntu 22.04')
    await expect(panel).toContainText('上線時長')
    await expect(panel).toContainText('最後心跳')
    // 底部按鈕：重新連線 / 編輯設定 / 移除節點
    await expect(panel.locator('.panel-actions .btn', { hasText: '重新連線' })).toBeVisible()
    await expect(panel.locator('.panel-actions .btn', { hasText: '編輯設定' })).toBeVisible()
    await expect(panel.locator('.panel-actions .btn', { hasText: '移除節點' })).toBeVisible()
  })

  test('E2E-22: 離線節點離線資訊面板（最後上線/心跳/離線持續時間 + 建議）', async ({ page }) => {
    await gotoAggregate(page, { nodes: [NODE_CACHE] })

    // 點擊離線 Card → 離線面板（非切換視圖）
    await card(page, 'cache-server-01').click()
    await expect(page.url()).not.toContain('/dashboard')

    const panel = page.locator('[data-testid="node-detail-panel"]')
    await expect(panel).toBeVisible()
    await expect(panel).toContainText('cache-server-01')
    await expect(panel).toContainText('最後上線')
    await expect(panel).toContainText('最後心跳')
    await expect(panel).toContainText('離線持續時間')
    // 操作建議
    await expect(panel).toContainText('操作建議：檢查 Agent 是否執行')
    // 重新連線 / 移除節點（離線無編輯設定）
    await expect(panel.locator('.panel-actions .btn', { hasText: '重新連線' })).toBeVisible()
    await expect(panel.locator('.panel-actions .btn', { hasText: '移除節點' })).toBeVisible()
  })
})

// ===================================================================
// §5.6 Node Management（@node-mgmt @agent @download）E2E-23~38
// ===================================================================

test.describe('5.6 Node Management', () => {
  test('E2E-23: 進入 Node Management 列表（欄位 + 按鈕）', async ({ page }) => {
    const { mocks } = await gotoNodeManagement(page, { nodes: [NODE_WEB, NODE_CACHE] })
    await expect(page.locator('.node-table')).toBeVisible()

    // 表頭欄位
    const thead = page.locator('.node-table thead')
    await expect(thead).toContainText('名稱')
    await expect(thead).toContainText('位址')
    await expect(thead).toContainText('狀態')
    await expect(thead).toContainText('最後心跳')
    await expect(thead).toContainText('版本')
    await expect(thead).toContainText('操作')
    // 兩行節點
    await expect(page.locator('[data-testid="node-row"]')).toHaveCount(2)
    // 新增節點 + 下載 Agent 按鈕
    await expect(page.locator('[data-testid="add-node"]')).toBeVisible()
    await expect(page.locator('.arch-menu button', { hasText: '下載 Agent' })).toBeVisible()
    expect(mocks.stats.nodesGet).toBeGreaterThanOrEqual(1)
  })

  test('E2E-24: 新增節點 Modal 欄位完整', async ({ page }) => {
    await gotoNodeManagement(page, { nodes: [] })

    await page.click('[data-testid="add-node"]')
    const modal = page.locator('.node-form-modal')
    await expect(modal).toBeVisible()
    await expect(page.locator('[data-testid="node-name"]')).toBeVisible()
    await expect(page.locator('[data-testid="node-address"]')).toBeVisible()
    // TLS 指紋（選填）/ Token（選填）/ 備註（選填）
    await expect(page.locator('input[placeholder="SHA-256"]')).toBeVisible()
    await expect(page.locator('input[placeholder="lsm_node_…"]')).toBeVisible()
    await expect(page.locator('input[placeholder="lsm_node_…"]')).toHaveAttribute('type', 'password')
    // 底部按鈕
    await expect(page.locator('[data-testid="test-connection"]')).toBeVisible()
    await expect(page.locator('[data-testid="node-save"]')).toHaveText('註冊')
    await expect(modal.locator('button', { hasText: '取消' })).toBeVisible()
  })

  test('E2E-25: 必填欄位缺失攔截（不發送 POST + 紅色標示）', async ({ page }) => {
    const { mocks } = await gotoNodeManagement(page, { nodes: [] })

    await page.click('[data-testid="add-node"]')
    await page.click('[data-testid="node-save"]')

    // 前端攔截：不發送 POST /api/v1/nodes
    expect(mocks.stats.create).toBe(0)
    // 必填欄位紅色標示
    await expect(page.locator('[data-testid="node-name"]')).toHaveClass(/field-error/)
    await expect(page.locator('[data-testid="node-address"]')).toHaveClass(/field-error/)
    await expect(page.getByText('節點名稱為必填')).toBeVisible()
    await expect(page.getByText('Agent 位址為必填')).toBeVisible()
  })

  test('E2E-26: 測試連線成功（綠色提示 + Modal 保持開啟）', async ({ page }) => {
    const { mocks } = await gotoNodeManagement(page, { nodes: [] })

    await page.click('[data-testid="add-node"]')
    await page.fill('[data-testid="node-address"]', '10.0.0.5:8443')
    await page.click('[data-testid="test-connection"]')

    await expect.poll(() => mocks.stats.testConnection).toBeGreaterThanOrEqual(1)
    await expect(page.locator('.test-result.test-ok')).toContainText('連線成功 — Agent v1.2.3 @ web-server-01 (Ubuntu 22.04)')
    // Modal 保持開啟
    await expect(page.locator('.node-form-modal')).toBeVisible()
  })

  test('E2E-27: 測試連線失敗（connection refused → 可重試）', async ({ page }) => {
    const { mocks } = await gotoNodeManagement(page, { nodes: [], unreachableAddresses: ['10.0.0.9'] })

    await page.click('[data-testid="add-node"]')
    await page.fill('[data-testid="node-address"]', '10.0.0.9:8443')
    await page.click('[data-testid="test-connection"]')

    await expect(page.locator('.test-result.test-fail')).toContainText('無法連線：connection refused')
    // 表單內容保留可修改重試
    await expect(page.locator('[data-testid="node-address"]')).toHaveValue('10.0.0.9:8443')
    expect(mocks.stats.testConnection).toBeGreaterThanOrEqual(1)
  })

  test('E2E-28: 測試連線失敗（TLS 憑證過期）', async ({ page }) => {
    await gotoNodeManagement(page, {
      nodes: [],
      testConnection: () => ({ status: 502, body: { error: 'TLS 憑證驗證失敗：certificate expired' } }),
    })

    await page.click('[data-testid="add-node"]')
    await page.fill('[data-testid="node-address"]', '10.0.0.5:8443')
    await page.click('[data-testid="test-connection"]')

    await expect(page.locator('.test-result.test-fail')).toContainText('無法連線：TLS 憑證驗證失敗：certificate expired')
  })

  test('E2E-29: 註冊成功立即上線（Modal 關閉 + 🟢 + Toast）', async ({ page }) => {
    const { mocks } = await gotoNodeManagement(page, { nodes: [] })

    await page.click('[data-testid="add-node"]')
    await page.fill('[data-testid="node-name"]', 'web-server-01')
    await page.fill('[data-testid="node-address"]', '10.0.0.5:8443')
    await page.click('[data-testid="node-save"]')

    // Modal 關閉 + Toast + 列表新增 🟢 線上節點
    await expect(page.locator('.node-form-modal')).toHaveCount(0)
    await expect(page.locator('#toast-container')).toContainText('節點 web-server-01 已註冊並上線')
    await expect(page.locator('[data-testid="node-row"]')).toHaveCount(1)
    await expect(page.locator('[data-testid="node-row"] .status-text')).toHaveText('線上')
    // POST /nodes 儲存
    expect(mocks.stats.create).toBe(1)
  })

  test('E2E-30: 名稱重複拒絕（Toast + Modal 保持開啟）', async ({ page }) => {
    const { mocks } = await gotoNodeManagement(page, { nodes: [NODE_WEB] })

    await page.click('[data-testid="add-node"]')
    await page.fill('[data-testid="node-name"]', 'web-server-01')
    await page.fill('[data-testid="node-address"]', '10.0.0.99:8443')
    await page.click('[data-testid="node-save"]')

    await expect(page.locator('#toast-container')).toContainText('節點名稱重複，請使用不同名稱')
    // Modal 保持開啟供修改
    await expect(page.locator('.node-form-modal')).toBeVisible()
    await expect(page.locator('[data-testid="node-row"]')).toHaveCount(1)
    expect(mocks.stats.create).toBe(1)
  })

  test('E2E-31: 位址不可達仍儲存（🔴 離線 + Toast）', async ({ page }) => {
    await gotoNodeManagement(page, { nodes: [], unreachableAddresses: ['10.0.0.9'] })

    await page.click('[data-testid="add-node"]')
    await page.fill('[data-testid="node-name"]', 'db-server-01')
    await page.fill('[data-testid="node-address"]', '10.0.0.9:8443')
    await page.click('[data-testid="node-save"]')

    await expect(page.locator('.node-form-modal')).toHaveCount(0)
    await expect(page.locator('#toast-container')).toContainText('節點 db-server-01 已註冊但無法連線')
    await expect(page.locator('[data-testid="node-row"]')).toHaveCount(1)
    await expect(page.locator('[data-testid="node-row"] .status-text')).toHaveText('離線')
  })

  test('E2E-32: 取消新增無變更', async ({ page }) => {
    const { mocks } = await gotoNodeManagement(page, { nodes: [NODE_WEB] })

    await page.click('[data-testid="add-node"]')
    await page.fill('[data-testid="node-name"]', 'temp-node')
    await page.locator('.node-form-modal button', { hasText: '取消' }).click()

    await expect(page.locator('.node-form-modal')).toHaveCount(0)
    await expect(page.locator('[data-testid="node-row"]')).toHaveCount(1)
    expect(mocks.stats.create).toBe(0)
  })

  test('E2E-33: 編輯節點更新（PUT + 列表顯示新位址 + Toast）', async ({ page }) => {
    const { mocks } = await gotoNodeManagement(page, { nodes: [NODE_WEB] })

    await page.click('[aria-label="編輯 web-server-01"]')
    // 預填目前設定
    await expect(page.locator('[data-testid="node-name"]')).toHaveValue('web-server-01')
    await expect(page.locator('[data-testid="node-address"]')).toHaveValue('10.0.0.5:8443')
    // Token 留空顯示「留空表示不變更」
    await expect(page.locator('input[placeholder="留空表示不變更"]')).toBeVisible()

    await page.fill('[data-testid="node-address"]', '10.0.0.50:8443')
    await page.click('[data-testid="node-save"]')

    await expect(page.locator('#toast-container')).toContainText('節點設定已更新')
    await expect(page.locator('[data-testid="node-row"] .node-address')).toHaveText('10.0.0.50:8443')
    expect(mocks.stats.update).toBe(1)
  })

  test('E2E-34: 移除確認對話框', async ({ page }) => {
    await gotoNodeManagement(page, { nodes: [NODE_WEB] })

    await page.click('[data-testid="remove-node"]')
    const modal = page.locator('.lms-modal')
    await expect(modal).toBeVisible()
    await expect(modal).toContainText('確定要移除此節點？所有歷史資料將保留。')
    await expect(modal.locator('.btn-danger')).toHaveText('確認移除')
    await expect(modal.locator('.secondary')).toBeVisible()
  })

  test('E2E-35: 確認移除節點消失（DELETE + Toast）', async ({ page }) => {
    const { mocks } = await gotoNodeManagement(page, { nodes: [NODE_WEB, NODE_DB] })

    await page.click('[data-testid="remove-node"]')
    await page.locator('.lms-modal .btn-danger').click()

    await expect(page.locator('#toast-container')).toContainText('節點已移除')
    await expect(page.locator('[data-testid="node-row"]')).toHaveCount(1)
    await expect(page.locator('[data-testid="node-row"]')).toContainText('db-server-01')
    expect(mocks.stats.delete).toBe(1)
  })

  test('E2E-36: 取消移除無變更', async ({ page }) => {
    const { mocks } = await gotoNodeManagement(page, { nodes: [NODE_WEB] })

    await page.click('[data-testid="remove-node"]')
    await page.locator('.lms-modal .secondary').click()

    await expect(page.locator('.lms-modal')).toHaveCount(0)
    await expect(page.locator('[data-testid="node-row"]')).toHaveCount(1)
    expect(mocks.stats.delete).toBe(0)
  })

  for (const [arch, label] of [['amd64', 'agent-linux-amd64'], ['arm64', 'agent-linux-arm64']] as const) {
    test(`E2E-${arch === 'amd64' ? '37' : '38'}: 下載 Agent（${arch}）`, async ({ page }) => {
      const { mocks } = await gotoNodeManagement(page, { nodes: [] })

      const downloadPromise = page.waitForEvent('download', { timeout: 10_000 }).catch(() => null)
      await page.locator('.arch-menu button', { hasText: '下載 Agent' }).click()
      await page.locator('.arch-dropdown button', { hasText: label }).click()

      const download = await downloadPromise
      if (download) {
        expect(download.suggestedFilename()).toContain(`agent-linux-${arch}`)
      }
      // GET /api/v1/agents/download?arch= 已發送
      await expect.poll(() => mocks.stats.download).toBeGreaterThanOrEqual(1)
    })
  }
})

// ===================================================================
// §5.7 心跳與離線（@heartbeat @offline @websocket）E2E-39~43
// ===================================================================

test.describe('5.7 心跳與離線', () => {
  test('E2E-39: 30 秒無心跳 → 離線（Card 🔴 + 灰顯 + 統計更新 + Toast）', async ({ page }) => {
    const { ws } = await gotoAggregate(page, { nodes: [NODE_WEB, NODE_DB] })
    await ws.waitConnected()

    // 初始：web 線上
    const web = card(page, 'web-server-01')
    await expect(web.locator('.status-text')).toHaveText('線上')
    await expect(chip(page, 1)).toHaveText('2')
    await expect(chip(page, 2)).toHaveText('0')

    // 30s 無心跳 → node_offline 推播（模擬 supervisor 狀態機）
    ws.push(offlineMsg(NODE_WEB))

    // Card 變 🔴 + 服務統計灰顯
    await expect(web).toHaveClass(/node-offline/)
    await expect(web.locator('.status-text')).toHaveText('離線')
    await expect(web.locator('.node-stats')).toHaveClass(/dimmed/)
    // 統計列更新（線上 -1、離線 +1）
    await expect(chip(page, 1)).toHaveText('1')
    await expect(chip(page, 2)).toHaveText('1')
    // Toast「web-server-01 已離線」
    await expect(page.locator('#toast-container')).toContainText('web-server-01 已離線')
  })

  test('E2E-40: 離線視圖禁用操作 + Banner', async ({ page }) => {
    const { ws, mocks } = await gotoAggregate(page, { nodes: [NODE_WEB] })
    await ws.waitConnected()

    // 節點轉離線（WS 推播更新 store；同時同步 mock 狀態供整頁導航後保留）
    ws.push(offlineMsg(NODE_WEB))
    await expect(card(page, 'web-server-01')).toHaveClass(/node-offline/)
    mocks.nodes.find(n => n.id === 'n_web')!.status = 'offline'

    // 進入該節點單機視圖
    await page.goto('/dashboard?node=n_web')
    await page.waitForSelector('.app-header')

    // 頂部黃色 Banner
    const banner = page.locator('[data-testid="offline-banner"]')
    await expect(banner).toBeVisible()
    await expect(banner).toContainText('節點已離線，操作不可用')
    // 所有操作按鈕禁用（start/stop/restart/logs + auto-start toggle；設定檔檢視按鈕除外）
    const tableButtons = page.locator('#service-table-body button')
    const btnCount = await tableButtons.count()
    expect(btnCount).toBeGreaterThan(0)
    for (let i = 0; i < btnCount; i++) {
      const btn = tableButtons.nth(i)
      const cls = (await btn.getAttribute('class')) || ''
      if (cls.includes('btn-edit-config') || cls.includes('btn-view-config')) continue
      await expect(btn).toBeDisabled()
    }
  })

  test('E2E-41: 寬限期內恢復上線（🟢 + Toast「已恢復連線」+ 統計回復）', async ({ page }) => {
    const { ws } = await gotoAggregate(page, { nodes: [NODE_WEB] })
    await ws.waitConnected()

    ws.push(offlineMsg(NODE_WEB))
    await expect(card(page, 'web-server-01')).toHaveClass(/node-offline/)
    await expect(chip(page, 1)).toHaveText('0')

    // Agent 重連恢復心跳（<300s 寬限期）→ node_online
    ws.push(onlineMsg(NODE_WEB))

    await expect(card(page, 'web-server-01')).not.toHaveClass(/node-offline/)
    await expect(card(page, 'web-server-01').locator('.status-text')).toHaveText('線上')
    await expect(chip(page, 1)).toHaveText('1')
    await expect(page.locator('#toast-container')).toContainText('web-server-01 已恢復連線')
  })

  test('E2E-42: 超過 300s 長期離線（⚫ 置底/摺疊）', async ({ page }) => {
    await gotoAggregate(page, { nodes: [NODE_WEB, NODE_CACHE, NODE_LEGACY] })

    const cards = page.locator('.node-card')
    await expect(cards).toHaveCount(3)
    // ⚫ 長期離線 Card 位於列表底部
    await expect(cards.nth(2)).toContainText('legacy-server-01')
    await expect(cards.nth(2).locator('.status-text')).toHaveText('長期離線')
    await expect(cards.nth(2)).toHaveClass(/node-long-offline/)
    // 線上/離線依序在前
    await expect(cards.nth(0)).toContainText('web-server-01')
    await expect(cards.nth(1)).toContainText('cache-server-01')
  })

  test('E2E-43: WS 即時推送雙瀏覽器（含斷線重連）', async ({ page, context }) => {
    const pageB = await context.newPage()
    try {
      // 兩個瀏覽器皆開啟 Aggregate（各自獨立 WS mock）
      const setup = async (p: Page) => {
        await p.addInitScript(() => localStorage.setItem('lms-lang', 'zh-TW'))
        await setupApiMocks(p, { authenticated: false })
        await setupNodeApiMocks(p, { nodes: [NODE_WEB] })
        return mockNodeWs(p)
      }
      const hubA = await setup(page)
      const hubB = await setup(pageB)
      await loginViaUI(page, { landOn: 'aggregate' })
      await loginViaUI(pageB, { landOn: 'aggregate' })
      await hubA.waitConnected()
      await hubB.waitConnected()

      // 觸發節點狀態變更 → 兩瀏覽器皆即時更新（無需重整）
      hubA.push(offlineMsg(NODE_WEB))
      hubB.push(offlineMsg(NODE_WEB))
      await expect(card(page, 'web-server-01')).toHaveClass(/node-offline/)
      await expect(card(pageB, 'web-server-01')).toHaveClass(/node-offline/)

      // WS 斷線自動重連（BDD @integration @websocket #69）
      const clientsBefore = hubA.clients.length
      await hubA.clients[0].close({ code: 1006, reason: 'network drop' })
      await expect.poll(() => hubA.clients.length).toBeGreaterThan(0) // 重連後新 client（舊的已移除）
      await expect.poll(() => hubA.clients.length).toBe(clientsBefore)

      // 恢復事件 → 兩頁皆 🟢（重連後仍即時更新）
      hubA.push(onlineMsg(NODE_WEB))
      hubB.push(onlineMsg(NODE_WEB))
      await expect(card(page, 'web-server-01').locator('.status-text')).toHaveText('線上')
      await expect(card(pageB, 'web-server-01').locator('.status-text')).toHaveText('線上')
    } finally {
      await pageB.close()
    }
  })
})

// ===================================================================
// §5.8 異常與邊界（@error-handling @edge-case @business-rules）E2E-44~56
// ===================================================================

test.describe('5.8 異常與邊界', () => {
  test('E2E-44: Agent 掛掉重啟自動恢復', async ({ page }) => {
    const { ws } = await gotoAggregate(page, { nodes: [NODE_WEB] })
    await ws.waitConnected()

    // Agent 掛掉（心跳中斷 → 離線）
    ws.push(offlineMsg(NODE_WEB))
    await expect(card(page, 'web-server-01')).toHaveClass(/node-offline/)
    await expect(page.locator('#toast-container')).toContainText('web-server-01 已離線')

    // 重啟 Agent → 自動恢復連線
    ws.push(onlineMsg(NODE_WEB))
    await expect(card(page, 'web-server-01').locator('.status-text')).toHaveText('線上')
    await expect(page.locator('#toast-container')).toContainText('web-server-01 已恢復連線')
  })

  test('E2E-45: 操作逾時 15 秒（XHR timeout → Toast「操作逾時」+ 按鈕恢復可重試）', async ({ page }) => {
    // 以 addInitScript 縮短 XHR timeout（模擬 axios ECONNABORTED 逾時路徑，D-5 操作 15s）
    await page.addInitScript(() => {
      // axios 在 open() 後會覆寫 request.timeout，故改在 send() 時設定（模擬 ECONNABORTED 逾時路徑）
      const origSend = XMLHttpRequest.prototype.send
      XMLHttpRequest.prototype.send = function (this: XMLHttpRequest, ...args: any[]) {
        this.timeout = 1500
        return origSend.apply(this, args as never)
      }
    })
    await gotoNodeDashboard(page, 'n_web', {
      nodes: [NODE_WEB],
      delays: { action: 2500 },
    })

    const row = page.locator('#service-table-body tr', { hasText: 'nginx.service' })
    await row.locator('.btn-act-restart').click()
    await page.locator('.lms-modal .btn-danger').click()

    // Toast「web-server-01 操作逾時：nginx.service restart」（warning）
    await expect(page.locator('#toast-container')).toContainText('web-server-01 操作逾時：nginx.service restart')
    // 按鈕恢復可點擊（逾時後 in-flight 清除）
    await expect(row.locator('.btn-act-restart')).toBeEnabled()

    // 可重試（後註冊的即時成功 route 覆寫延遲）→ 成功
    await page.route('**/api/v1/nodes/*/services/*/*', (route) => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify({ message: '已重啟' }),
    }))
    await row.locator('.btn-act-restart').click()
    await page.locator('.lms-modal .btn-danger').click()
    await expect(page.locator('#toast-container')).toContainText('web-server-01 nginx.service 已重啟')
  })

  test('E2E-46: 同節點同服務不並行（in-flight 期間第二個操作被拒絕）', async ({ page }) => {
    const { mocks } = await gotoNodeDashboard(page, 'n_web', {
      nodes: [NODE_WEB],
      delays: { action: 800 },
    })

    const row = page.locator('#service-table-body tr', { hasText: 'nginx.service' })
    // restart 進行中（mock 延遲 800ms）
    await row.locator('.btn-act-restart').click()
    await page.locator('.lms-modal .btn-danger').click()
    await expect.poll(() => mocks.stats.actions['restart']).toBe(1)

    // 嘗試第二個並行 restart → in-flight 守門拒絕（無第二個請求；決策 9/D-9 前端 in-flight）
    await row.locator('.btn-act-restart').click()
    await page.locator('.lms-modal .btn-danger').click()
    await expect.poll(() => mocks.stats.actions['restart']).toBe(1)

    // 等待第一個完成（成功 Toast）
    await expect(page.locator('#toast-container')).toContainText('web-server-01 nginx.service 已重啟')

    // 完成後可再次操作
    await row.locator('.btn-act-restart').click()
    await page.locator('.lms-modal .btn-danger').click()
    await expect.poll(() => mocks.stats.actions['restart']).toBe(2)
  })

  test('E2E-47: 不同節點可並行（兩節點同時 restart 互不影響）', async ({ page }) => {
    await gotoNodeDashboard(page, 'n_web', {
      nodes: [NODE_WEB, NODE_DB],
      delays: { action: 800 },
    })

    const webRestart = page.waitForRequest((req) =>
      req.url().includes('/api/v1/nodes/n_web/services/nginx.service/restart') && req.method() === 'POST')
    await page.locator('#service-table-body tr', { hasText: 'nginx.service' }).locator('.btn-act-restart').click()
    await page.locator('.lms-modal .btn-danger').click()

    // 切換至 db-server-01 並同時 restart（in-flight key 含 nodeId → 互不影響，決策 9）
    await page.click('[data-testid="node-switcher"]')
    await page.locator('[data-testid="node-dropdown"] .node-option', { hasText: 'db-server-01' }).click()
    await page.waitForURL((u) => u.searchParams.get('node') === 'n_db')

    const dbRestart = page.waitForRequest((req) =>
      req.url().includes('/api/v1/nodes/n_db/services/nginx.service/restart') && req.method() === 'POST')
    await page.locator('#service-table-body tr', { hasText: 'nginx.service' }).locator('.btn-act-restart').click()
    await page.locator('.lms-modal .btn-danger').click()

    // 兩個請求皆成功發出（web 的 restart 仍在進行中時 db 已發送 → 並行）
    await webRestart
    await dbRestart
    // 兩者皆完成
    await expect(page.locator('#toast-container')).toContainText('nginx.service 已重啟')
  })

  test('E2E-48: TLS 憑證過期 → 離線 → 更新憑證恢復', async ({ page }) => {
    const { ws } = await gotoAggregate(page, { nodes: [NODE_WEB] })
    await ws.waitConnected()

    // TLS 憑證過期 → Manager 連線失敗 → 🔴
    ws.push(offlineMsg(NODE_WEB))
    await expect(card(page, 'web-server-01')).toHaveClass(/node-offline/)

    // 更新憑證並同步指紋 → 恢復上線
    ws.push(onlineMsg(NODE_WEB))
    await expect(card(page, 'web-server-01').locator('.status-text')).toHaveText('線上')
    await expect(page.locator('#toast-container')).toContainText('web-server-01 已恢復連線')
  })

  test('E2E-49: 版本不相容警告（🟡 + Tooltip「Agent 版本過舊」）', async ({ page }) => {
    await gotoAggregate(page, { nodes: [NODE_OLD] })

    const old = card(page, 'old-agent-01')
    await expect(old.locator('.status-text')).toHaveText('警告')
    await expect(old.locator('.node-status-dot svg circle')).toHaveAttribute('fill', 'var(--lms-warning)')
    // 版本警告文字
    await expect(old.locator('.nc-version')).toContainText('Agent 版本過舊 (v1.0)，建議升級至 v1.2+')
    // 不阻斷操作（warning 可點擊切換視圖）
    await expect(old).toHaveClass(/clickable/)
  })

  test('E2E-50: 50 節點上限拒絕第 51 個', async ({ page }) => {
    const manyNodes: Node[] = Array.from({ length: 50 }, (_, i) =>
      makeNode({ id: `n_${i}`, name: `node-${String(i).padStart(2, '0')}`, address: `10.0.1.${i}:8443` }))
    await gotoNodeManagement(page, { nodes: manyNodes })
    await expect(page.locator('[data-testid="node-row"]')).toHaveCount(50)

    await page.click('[data-testid="add-node"]')
    await page.fill('[data-testid="node-name"]', 'overflow-node')
    await page.fill('[data-testid="node-address"]', '10.0.2.1:8443')
    await page.click('[data-testid="node-save"]')

    // 後端拒絕 → Toast 說明已達上限
    await expect(page.locator('#toast-container')).toContainText('已達節點數量上限')
    await expect(page.locator('.node-form-modal')).toBeVisible()
    await expect(page.locator('[data-testid="node-row"]')).toHaveCount(50)
  })

  test('E2E-51: 心跳機制三規則（正常心跳 / 30s 離線 / 300s 長期離線）', async ({ page }) => {
    const { ws } = await gotoAggregate(page, { nodes: [NODE_WEB] })
    await ws.waitConnected()
    const web = card(page, 'web-server-01')

    // Rule 1: 正常心跳 → last_heartbeat 更新（node_status 承載新心跳）
    ws.push(statusMsg(NODE_WEB, 'online', { last_heartbeat: new Date().toISOString(), agent_version: '1.2.0' }))
    await expect(web.locator('.node-heartbeat')).toContainText('最後心跳：')
    await expect(web.locator('.node-heartbeat')).toHaveText(/最後心跳：[0-5] 秒前/)

    // Rule 2: 停止心跳 30s → 🔴 離線
    ws.push(offlineMsg(NODE_WEB))
    await expect(web).toHaveClass(/node-offline/)
    await expect(web.locator('.status-text')).toHaveText('離線')

    // Rule 3: 超過 300s → ⚫ 長期離線
    ws.push(offlineMsg(NODE_WEB, 'long_offline'))
    await expect(web).toHaveClass(/node-long-offline/)
    await expect(web.locator('.status-text')).toHaveText('長期離線')
  })

  test('E2E-52: 逾時規則兩類型（15s 操作 / 10s 搜尋部分結果先回）', async ({ page }) => {
    // Type 1: 單一服務操作逾時 → 失敗提示（XHR timeout 模擬 ECONNABORTED）
    await page.addInitScript(() => {
      // axios 在 open() 後會覆寫 request.timeout，故改在 send() 時設定（模擬 ECONNABORTED 逾時路徑）
      const origSend = XMLHttpRequest.prototype.send
      XMLHttpRequest.prototype.send = function (this: XMLHttpRequest, ...args: any[]) {
        this.timeout = 1500
        return origSend.apply(this, args as never)
      }
    })
    const { mocks } = await gotoNodeDashboard(page, 'n_web', {
      nodes: [NODE_WEB, NODE_DB],
      delays: { action: 2500 },
      search: () => ({
        results: [{ node_id: 'n_web', node_name: 'web-server-01', service: 'nginx.service', active: 'active', sub: 'running' }],
        failed_nodes: [{ node_id: 'n_db', node_name: 'db-server-01', reason: 'timeout' }],
      }),
    })

    const row = page.locator('#service-table-body tr', { hasText: 'nginx.service' })
    await row.locator('.btn-act-restart').click()
    await page.locator('.lms-modal .btn-danger').click()
    await expect(page.locator('#toast-container')).toContainText('web-server-01 操作逾時：nginx.service restart')

    // Type 2: 跨節點搜尋總逾時 → 部分結果先回（failed_nodes 標示不可達節點）
    await page.goto('/')
    await page.waitForSelector('[data-testid="aggregate-stats"]')
    await page.fill('[data-testid="node-search"]', 'nginx')
    await expect.poll(() => mocks.stats.search, { timeout: 3_000 }).toBeGreaterThanOrEqual(1)
    const results = page.locator('[data-testid="search-results"]')
    await expect(results.locator('.search-item')).toHaveCount(1)
    await expect(results.locator('.failed-note')).toContainText('db-server-01')
  })

  test('E2E-53: Manager 重啟自動重連（節點保留 + 啟動寬限期不推播離線）', async ({ page }) => {
    const { ws } = await gotoAggregate(page, { nodes: [NODE_WEB, NODE_DB] })
    await ws.waitConnected()
    await expect(page.locator('.node-card')).toHaveCount(2)

    // 模擬 Manager 重啟：整頁 reload（session mock + 節點 mock 為 stateful → 保留）
    await page.reload()
    await page.waitForSelector('[data-testid="aggregate-stats"]')
    await expect(page.locator('.node-card')).toHaveCount(2)
    await expect(card(page, 'web-server-01').locator('.status-text')).toHaveText('線上')
    // 啟動 30s 寬限期內不觸發離線通知（無離線 Toast）
    await page.waitForTimeout(500)
    await expect(page.locator('#toast-container')).not.toContainText('已離線')
  })

  test('E2E-54: 未登入 9 節點 API 回 401（Outline ×9 + 補充代理端點）', async ({ page }) => {
    // 不登入：模擬後端 AuthMiddlewareComposite（決策 8：nodes 全數受保護）
    await page.addInitScript(() => localStorage.setItem('lms-lang', 'zh-TW'))
    await setupApiMocks(page, { authenticated: false })
    // 註冊 401 route（後註冊者優先覆寫 setupApiMocks 預設節點 mock）
    await page.route('**/api/v1/nodes**', (route) => route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'unauthorized' }) }))
    await page.route('**/api/v1/agents/download*', (route) => route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'unauthorized' }) }))

    await page.goto('/')
    await page.waitForURL('**/login')

    const urls = [
      { m: 'GET', u: '/api/v1/nodes' },
      { m: 'POST', u: '/api/v1/nodes' },
      { m: 'GET', u: '/api/v1/nodes/n1' },
      { m: 'PUT', u: '/api/v1/nodes/n1' },
      { m: 'DELETE', u: '/api/v1/nodes/n1' },
      { m: 'POST', u: '/api/v1/nodes/test-connection' },
      { m: 'GET', u: '/api/v1/nodes/summary' },
      { m: 'GET', u: '/api/v1/nodes/n1/services' },
      { m: 'GET', u: '/api/v1/nodes/services/search?q=nginx' },
      // 決策 6/8 補充代理端點
      { m: 'GET', u: '/api/v1/nodes/n1/info' },
      { m: 'GET', u: '/api/v1/nodes/n1/services/nginx.service/logs' },
      { m: 'POST', u: '/api/v1/nodes/n1/services/nginx.service/restart' },
      { m: 'GET', u: '/api/v1/agents/download?arch=amd64' },
    ]

    const results = await page.evaluate(async (list) => {
      const out: Array<{ m: string; u: string; s: number }> = []
      for (const { m, u } of list) {
        try {
          const r = await fetch(u, { method: m, credentials: 'include' })
          out.push({ m, u, s: r.status })
        } catch {
          out.push({ m, u, s: -1 })
        }
      }
      return out
    }, urls)

    for (const item of results) {
      expect(item.s, `${item.m} ${item.u} 應回 401`).toBe(401)
    }
  })

  test('E2E-55: registry 持久化重啟保留（註冊 → 重載 → 節點保留並上線）', async ({ page }) => {
    const { mocks } = await gotoNodeManagement(page, { nodes: [] })

    // 註冊節點
    await page.click('[data-testid="add-node"]')
    await page.fill('[data-testid="node-name"]', 'web-server-01')
    await page.fill('[data-testid="node-address"]', '10.0.0.5:8443')
    await page.click('[data-testid="node-save"]')
    await expect(page.locator('[data-testid="node-row"]')).toHaveCount(1)
    await expect(page.locator('[data-testid="node-row"] .status-text')).toHaveText('線上')

    // 模擬 Manager 重啟（stateful mock 保留 nodes）
    await page.reload()
    await page.waitForSelector('.node-management')
    await expect(page.locator('[data-testid="node-row"]')).toHaveCount(1)
    await expect(page.locator('[data-testid="node-row"]')).toContainText('web-server-01')
    await expect(page.locator('[data-testid="node-row"] .status-text')).toHaveText('線上')
    expect(mocks.nodes.some(n => n.name === 'web-server-01')).toBe(true)
  })

  test('E2E-56: 移除節點歷史保留（節點移除 + 歷史 Audit 不刪）', async ({ page }) => {
    const { mocks } = await gotoNodeManagement(page, { nodes: [NODE_WEB, NODE_DB] })

    await page.click('[data-testid="remove-node"]')
    await page.locator('.lms-modal .btn-danger').click()

    await expect(page.locator('#toast-container')).toContainText('節點已移除')
    await expect(page.locator('[data-testid="node-row"]')).toHaveCount(1)
    // registry 中已移除
    expect(mocks.nodes.find(n => n.id === 'n_web')).toBeUndefined()
    // 歷史資料與 Audit Log 保留為後端保證（SYS-07/HDL-10/INT-08；E2E mock 驗證 DELETE 成功與列表反映）
    await expect(page.locator('[data-testid="node-row"]')).toContainText('db-server-01')
  })
})
