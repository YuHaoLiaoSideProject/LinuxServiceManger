/**
 * 014 Phase 3 — 套版驗證截圖腳本（standalone，非 vitest/playwright test）
 *
 * 起 dev server（port 5199）後以 Chromium 於 3 斷點 + 深色主題截圖三視圖：
 *   /                        → Aggregate Dashboard
 *   /nodes                   → Node Management
 *   /dashboard?node=web-01   → node-aware Dashboard（另補離線節點 Banner 情境）
 *
 * 同時檢查：console error、橫向捲動溢出、mobile 觸控目標尺寸。
 * 截圖輸出：frontend/e2e/screenshots/014-phase3-*.png
 */
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = resolve(__dirname, 'screenshots')
mkdirSync(OUT_DIR, { recursive: true })

const BASE = 'http://localhost:5199'

// ── Mock 資料（對齊 UIUX mockup）──
const NODES = [
  { id: 'n1', name: 'web-server-01', address: '10.0.0.5:8443', tls_fingerprint: '', notes: '', status: 'online', last_heartbeat: new Date(Date.now() - 3000).toISOString(), agent_version: '1.2.0', hostname: 'web-server-01', os: 'Ubuntu 22.04', service_stats: { total: 42, active: 38, failed: 1 }, created_at: '2026-08-13T08:00:00Z', updated_at: '2026-08-13T08:00:00Z' },
  { id: 'n2', name: 'web-server-02', address: '10.0.0.6:8443', tls_fingerprint: '', notes: '', status: 'online', last_heartbeat: new Date(Date.now() - 5000).toISOString(), agent_version: '1.2.0', hostname: 'web-server-02', os: 'Ubuntu 22.04', service_stats: { total: 24, active: 22, failed: 0 }, created_at: '2026-08-13T08:00:00Z', updated_at: '2026-08-13T08:00:00Z' },
  { id: 'n3', name: 'db-01', address: '10.0.0.9:8443', tls_fingerprint: '', notes: '', status: 'degraded', last_heartbeat: new Date(Date.now() - 18000).toISOString(), agent_version: '1.2.0', hostname: 'db-01.internal', os: 'Debian 12', service_stats: { total: 18, active: 16, failed: 1 }, created_at: '2026-08-13T08:00:00Z', updated_at: '2026-08-13T08:00:00Z' },
  { id: 'n4', name: 'web-server-03', address: '10.0.0.7:8443', tls_fingerprint: '', notes: '', status: 'warning', last_heartbeat: new Date(Date.now() - 2000).toISOString(), agent_version: '1.0.0', hostname: 'web-server-03', os: 'Ubuntu 20.04', service_stats: { total: 33, active: 31, failed: 2 }, created_at: '2026-08-13T08:00:00Z', updated_at: '2026-08-13T08:00:00Z' },
  { id: 'n5', name: 'web-server-04', address: '10.0.0.8:8443', tls_fingerprint: '', notes: '', status: 'offline', last_heartbeat: new Date(Date.now() - 120000).toISOString(), agent_version: '1.2.0', hostname: 'web-server-04', os: 'Ubuntu 22.04', service_stats: { total: 21, active: 0, failed: 0 }, created_at: '2026-08-13T08:00:00Z', updated_at: '2026-08-13T08:00:00Z' },
  { id: 'n6', name: 'legacy-01', address: '10.0.0.11:8443', tls_fingerprint: '', notes: '', status: 'long_offline', last_heartbeat: new Date(Date.now() - 3600 * 1000 * 3).toISOString(), agent_version: '1.0.0', hostname: 'legacy-01.old', os: 'CentOS 7', service_stats: { total: 9, active: 0, failed: 0 }, created_at: '2026-08-13T08:00:00Z', updated_at: '2026-08-13T08:00:00Z' },
]

const SUMMARY = {
  total_nodes: 6, online: 2, degraded: 1, offline: 1, long_offline: 1, warning: 1,
  total_services: 147, active_services: 107, failed_services: 4,
}

const SERVICES = [
  { name: 'nginx.service', load: 'loaded', active: 'active', sub: 'running', locked: false, unitFileState: 'enabled', fragmentPath: '/etc/systemd/system/nginx.service' },
  { name: 'myapp.service', load: 'loaded', active: 'inactive', sub: 'dead', locked: false, unitFileState: 'disabled', fragmentPath: '/etc/systemd/system/myapp.service' },
  { name: 'crash.service', load: 'loaded', active: 'failed', sub: 'failed', locked: false, unitFileState: 'disabled', fragmentPath: '/etc/systemd/system/crash.service' },
  { name: 'sshd.service', load: 'loaded', active: 'active', sub: 'running', locked: true, unitFileState: 'enabled', fragmentPath: '/usr/lib/systemd/system/sshd.service' },
]

async function setupMocks(page) {
  await page.route('**/api/v1/session', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ authenticated: true, username: 'admin' }) }))
  await page.route('**/api/v1/nodes/summary', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: SUMMARY }) }))
  await page.route('**/api/v1/nodes/services/search*', (route) => {
    const q = new URL(route.request().url()).searchParams.get('q') || ''
    if (!q) return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'missing query' }) })
    const match = q.includes('nginx')
    return route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        results: match ? [
          { node_id: 'n1', node_name: 'web-server-01', service: 'nginx.service', active: 'active (running)', sub: 'running' },
          { node_id: 'n2', node_name: 'web-server-02', service: 'nginx.service', active: 'active (running)', sub: 'running' },
        ] : [],
        failed_nodes: match ? [{ node_id: 'n5', node_name: 'web-server-04', reason: 'offline' }] : [],
      }),
    })
  })
  await page.route('**/api/v1/nodes/*/services', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SERVICES) }))
  await page.route('**/api/v1/nodes/*/info', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ os: 'Ubuntu 22.04', kernel: '6.2.0', uptime: 3600 * 24 * 12 + 4 * 3600 + 18 * 60, cpu: '8 vCPU', mem: '16 GB', disk: '200 GB' }) }))
  await page.route('**/api/v1/nodes/*/services/*/logs', (route) => route.fulfill({ status: 200, contentType: 'text/plain', body: 'Jun 01 10:00:00 host nginx[1]: started' }))
  await page.route('**/api/v1/services', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SERVICES) }))
  await page.route('**/api/v1/agents/download*', (route) => route.fulfill({ status: 200, contentType: 'application/octet-stream', body: Buffer.from('agent-binary') }))
  // 節點列表：必須最後註冊（URL 尾段精確匹配不衝突，但保險起見）
  await page.route('**/api/v1/nodes', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: NODES }) }))
}

async function checkLayout(page, label, report) {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement
    return {
      scrollW: doc.scrollWidth,
      clientW: doc.clientWidth,
      bodyScrollW: document.body.scrollWidth,
    }
  })
  if (overflow.scrollW > overflow.clientW + 1) {
    report.push(`⚠️ [${label}] 橫向捲動溢出: scrollWidth=${overflow.scrollW} clientWidth=${overflow.clientW}`)
  } else {
    report.push(`✅ [${label}] 無橫向捲動 (${overflow.clientW}px)`)
  }
}

async function checkTouchTargets(page, label, report) {
  const small = await page.evaluate(() => {
    const out = []
    const selector = 'button, a.btn, input, [role="menuitemradio"], [role="menuitem"]'
    document.querySelectorAll(selector).forEach((el) => {
      const r = el.getBoundingClientRect()
      const style = getComputedStyle(el)
      if (style.visibility === 'hidden' || style.display === 'none') return
      if (r.width < 40 && r.height < 40) {
        const text = (el.textContent || '').trim().slice(0, 24) || el.getAttribute('aria-label') || el.className
        out.push(`${text} (${Math.round(r.width)}×${Math.round(r.height)})`)
      }
    })
    return out
  })
  if (small.length) report.push(`⚠️ [${label}] 觸控目標 <40px: ${small.join(' | ')}`)
  else report.push(`✅ [${label}] 觸控目標均 ≥40px`)
}

async function main() {
  const browser = await chromium.launch()
  const report = []
  let consoleIssues = []

  const viewports = [
    { name: '1440', width: 1440, height: 900 },
    { name: '900', width: 900, height: 800 },
    { name: '375', width: 375, height: 812 },
  ]

  const views = [
    { name: 'aggregate', url: '/', waitFor: '[data-testid="aggregate-stats"]' },
    { name: 'node-management', url: '/nodes', waitFor: '.node-table' },
    { name: 'node-dashboard', url: '/dashboard?node=n1', waitFor: '.dashboard-header' },
  ]

  for (const v of viewports) {
    for (const view of views) {
      const context = await browser.newContext({ viewport: { width: v.width, height: v.height } })
      const page = await context.newPage()
      await setupMocks(page)
      page.on('console', (msg) => {
        if (msg.type() === 'error') consoleIssues.push(`[${view.name}@${v.name}] ${msg.text()}`)
      })
      page.on('pageerror', (err) => consoleIssues.push(`[${view.name}@${v.name}] pageerror: ${err.message}`))

      await page.goto(BASE + view.url)
      await page.waitForSelector(view.waitFor, { timeout: 15000 })
      await page.waitForTimeout(600) // 等動畫/請求完成
      await page.screenshot({ path: `${OUT_DIR}/014-phase3-${view.name}-${v.name}.png`, fullPage: true })
      await checkLayout(page, `${view.name}@${v.name}`, report)
      if (v.name === '375') await checkTouchTargets(page, `${view.name}@${v.name}`, report)
      await context.close()
    }
  }

  // 深色主題（1440×900 三視圖）：直接以 localStorage 設定（aggregate 視圖無 account menu）
  for (const view of views) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    await context.addInitScript(() => localStorage.setItem('lms-theme', 'dark'))
    const page = await context.newPage()
    await setupMocks(page)
    await page.goto(BASE + view.url)
    await page.waitForSelector(view.waitFor, { timeout: 15000 })
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${OUT_DIR}/014-phase3-${view.name}-dark.png`, fullPage: true })
    await checkLayout(page, `${view.name}@dark`, report)
    await context.close()
  }

  // 離線節點 node-dashboard（Banner + 禁用按鈕）
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  await setupMocks(page)
  await page.goto(BASE + '/dashboard?node=n5')
  await page.waitForSelector('[data-testid="offline-banner"]', { timeout: 15000 })
  await page.waitForTimeout(600)
  await page.screenshot({ path: `${OUT_DIR}/014-phase3-node-dashboard-offline.png`, fullPage: true })
  const disabledCount = await page.locator('#service-table-body button:disabled').count()
  report.push(`ℹ️ 離線節點視圖 disabled 操作按鈕數量: ${disabledCount}`)
  await ctx.close()

  // 搜尋結果面板（aggregate）
  const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page2 = await ctx2.newPage()
  await setupMocks(page2)
  await page2.goto(BASE + '/')
  await page2.waitForSelector('[data-testid="aggregate-stats"]', { timeout: 15000 })
  await page2.fill('[data-testid="node-search"]', 'nginx')
  await page2.waitForSelector('[data-testid="search-results"] .search-item', { timeout: 15000 })
  await page2.waitForTimeout(300)
  await page2.screenshot({ path: `${OUT_DIR}/014-phase3-search-results.png`, fullPage: true })
  await ctx2.close()

  await browser.close()

  console.log('\n═══ Layout / a11y 檢查 ═══')
  console.log(report.join('\n'))
  const realIssues = consoleIssues.filter((m) => !/WebSocket|websocket|ws:|net::ERR|Failed to load resource|404/.test(m))
  if (realIssues.length) {
    console.log('\n═══ Console errors ═══')
    realIssues.forEach((m) => console.log(m))
  } else {
    console.log('\n✅ 無非預期 console error（WS 連線失敗為預期，因無後端）')
  }
  console.log(`\n截圖已輸出至 ${OUT_DIR}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
