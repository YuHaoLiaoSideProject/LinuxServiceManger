/**
 * 014 Phase 3 — DOM / computed-style 驗證（非視覺截圖檢查）
 * 驗證套版清單：狀態燈 SVG、統計 chips、搜尋結果欄位、NodeCard 離線灰顯、
 * NodeSwitcher ARIA、NodeFormModal 520px/bottom-sheet/測試結果、badge、
 * detail panel、離線 Banner、dark theme、RWD 斷點。
 */
import { chromium } from '@playwright/test'

const BASE = 'http://localhost:5199'

const NODES = [
  { id: 'n1', name: 'web-server-01', address: '10.0.0.5:8443', tls_fingerprint: '', notes: '', status: 'online', last_heartbeat: new Date(Date.now() - 3000).toISOString(), agent_version: '1.2.0', hostname: 'web-server-01', os: 'Ubuntu 22.04', service_stats: { total: 42, active: 38, failed: 1 }, created_at: '2026-08-13T08:00:00Z', updated_at: '2026-08-13T08:00:00Z' },
  { id: 'n2', name: 'web-server-02', address: '10.0.0.6:8443', tls_fingerprint: '', notes: '', status: 'online', last_heartbeat: new Date(Date.now() - 5000).toISOString(), agent_version: '1.2.0', hostname: 'web-server-02', os: 'Ubuntu 22.04', service_stats: { total: 24, active: 22, failed: 0 }, created_at: '2026-08-13T08:00:00Z', updated_at: '2026-08-13T08:00:00Z' },
  { id: 'n3', name: 'db-01', address: '10.0.0.9:8443', tls_fingerprint: '', notes: '', status: 'degraded', last_heartbeat: new Date(Date.now() - 18000).toISOString(), agent_version: '1.2.0', hostname: 'db-01.internal', os: 'Debian 12', service_stats: { total: 18, active: 16, failed: 1 }, created_at: '2026-08-13T08:00:00Z', updated_at: '2026-08-13T08:00:00Z' },
  { id: 'n4', name: 'web-server-03', address: '10.0.0.7:8443', tls_fingerprint: '', notes: '', status: 'warning', last_heartbeat: new Date(Date.now() - 2000).toISOString(), agent_version: '1.0.0', hostname: 'web-server-03', os: 'Ubuntu 20.04', service_stats: { total: 33, active: 31, failed: 2 }, created_at: '2026-08-13T08:00:00Z', updated_at: '2026-08-13T08:00:00Z' },
  { id: 'n5', name: 'web-server-04', address: '10.0.0.8:8443', tls_fingerprint: '', notes: '', status: 'offline', last_heartbeat: new Date(Date.now() - 120000).toISOString(), agent_version: '1.2.0', hostname: 'web-server-04', os: 'Ubuntu 22.04', service_stats: { total: 21, active: 0, failed: 0 }, created_at: '2026-08-13T08:00:00Z', updated_at: '2026-08-13T08:00:00Z' },
  { id: 'n6', name: 'legacy-01', address: '10.0.0.11:8443', tls_fingerprint: '', notes: '', status: 'long_offline', last_heartbeat: new Date(Date.now() - 3600 * 1000 * 3).toISOString(), agent_version: '1.0.0', hostname: 'legacy-01.old', os: 'CentOS 7', service_stats: { total: 9, active: 0, failed: 0 }, created_at: '2026-08-13T08:00:00Z', updated_at: '2026-08-13T08:00:00Z' },
]
const SUMMARY = { total_nodes: 6, online: 2, degraded: 1, offline: 1, long_offline: 1, warning: 1, total_services: 147, active_services: 107, failed_services: 4 }
const SERVICES = [
  { name: 'nginx.service', load: 'loaded', active: 'active', sub: 'running', locked: false, unitFileState: 'enabled', fragmentPath: '/etc/systemd/system/nginx.service' },
  { name: 'myapp.service', load: 'loaded', active: 'inactive', sub: 'dead', locked: false, unitFileState: 'disabled', fragmentPath: '/etc/systemd/system/myapp.service' },
  { name: 'crash.service', load: 'loaded', active: 'failed', sub: 'failed', locked: false, unitFileState: 'disabled', fragmentPath: '/etc/systemd/system/crash.service' },
  { name: 'sshd.service', load: 'loaded', active: 'active', sub: 'running', locked: true, unitFileState: 'enabled', fragmentPath: '/usr/lib/systemd/system/sshd.service' },
]

async function setupMocks(page) {
  await page.route('**/api/v1/session', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ authenticated: true, username: 'admin' }) }))
  await page.route('**/api/v1/nodes/summary', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: SUMMARY }) }))
  await page.route('**/api/v1/nodes/services/search*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ results: [], failed_nodes: [] }) }))
  await page.route('**/api/v1/nodes/*/services', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SERVICES) }))
  await page.route('**/api/v1/nodes/*/info', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ os: 'Ubuntu 22.04', kernel: '6.2.0', uptime: 100, cpu: 'x', mem: 'y', disk: 'z' }) }))
  await page.route('**/api/v1/nodes/*/services/*/logs', (route) => route.fulfill({ status: 200, contentType: 'text/plain', body: 'log' }))
  await page.route('**/api/v1/services', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SERVICES) }))
  await page.route('**/api/v1/agents/download*', (route) => route.fulfill({ status: 200, contentType: 'application/octet-stream', body: Buffer.from('bin') }))
  await page.route('**/api/v1/nodes', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: NODES }) }))
}

let failures = 0
function check(name, ok, detail = '') {
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`)
  if (!ok) failures++
}

const browser = await chromium.launch()

// ── 1. Aggregate @1440（light）──
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  await setupMocks(page)
  await page.goto(BASE + '/')
  await page.waitForSelector('[data-testid="aggregate-stats"]')
  await page.waitForSelector('.node-card')

  // 狀態燈 = SVG 圓點 + 文字
  const dots = await page.locator('.node-card .node-status-dot').count()
  const svgCircles = await page.locator('.node-card .node-status-dot svg circle').count()
  check('NodeCard 狀態燈 SVG 圓點存在', dots === 6 && svgCircles === 6, `${dots} cards, ${svgCircles} svg circles`)
  const labels = await page.locator('.node-card .status-text').allTextContents()
  check('NodeCard 狀態文字標籤 5 態', ['線上', '延遲', '離線', '長期離線', '警告'].every(l => labels.includes(l)), labels.join(','))

  // 統計 chips 6 項
  const chips = await page.locator('.aggregate-stats .stat-chip').count()
  check('統計列 6 chips + SVG 圖示', chips === 6 && (await page.locator('.aggregate-stats .stat-chip .chip-icon svg').count()) === 6, `${chips} chips`)
  const statsText = await page.locator('[data-testid="aggregate-stats"]').textContent()
  check('統計數值渲染（6/2/2/147/107/4）', ['6', '2', '147', '107', '4'].every(v => statsText.includes(v)))

  // 長期離線置底
  const names = await page.locator('.node-card .node-name').allTextContents()
  check('長期離線置底', names[names.length - 1] === 'legacy-01', names.join(' > '))

  // 離線卡片 opacity
  const offOpacity = await page.locator('.node-card.node-offline').first().evaluate(el => getComputedStyle(el).opacity)
  const loOpacity = await page.locator('.node-card.node-long-offline').first().evaluate(el => getComputedStyle(el).opacity)
  check('離線卡片 opacity .6/.45', offOpacity === '0.62' && loOpacity === '0.45', `offline=${offOpacity} long_offline=${loOpacity}`)

  // 詳情按鈕 aria-label
  const aria = await page.locator('[data-testid="node-detail"]').first().getAttribute('aria-label')
  check('詳情按鈕 aria-label="詳情 {name}"', aria === '詳情 web-server-01', aria)

  // 詳情面板（線上）→ 右側滑出 + 動作列
  await page.locator('[data-testid="node-detail"]').first().click()
  await page.waitForSelector('[data-testid="node-detail-panel"]')
  const panelActions = await page.locator('.detail-panel .panel-actions .btn').count()
  check('詳情面板 3 動作按鈕', panelActions === 3, `${panelActions}`)
  const panelWidth = await page.locator('.detail-panel').evaluate(el => Math.round(el.getBoundingClientRect().width))
  check('詳情面板寬 360px', panelWidth === 360, `${panelWidth}px`)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  check('詳情面板 Esc 關閉', (await page.locator('[data-testid="node-detail-panel"]').count()) === 0)
  await ctx.close()
}

// ── 2. Aggregate 搜尋結果面板 ──
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  await setupMocks(page)
  await page.route('**/api/v1/nodes/services/search*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ results: [{ node_id: 'n1', node_name: 'web-server-01', service: 'nginx.service', active: 'active (running)', sub: 'running' }], failed_nodes: [{ node_id: 'n5', node_name: 'web-server-04', reason: 'offline' }] }) }))
  await page.goto(BASE + '/')
  await page.waitForSelector('[data-testid="aggregate-stats"]')
  await page.fill('[data-testid="node-search"]', 'nginx')
  await page.waitForSelector('[data-testid="search-results"] .search-item')
  const itemText = await page.locator('.search-item').textContent()
  check('搜尋結果含節點/服務/狀態', itemText.includes('web-server-01') && itemText.includes('nginx.service') && itemText.includes('active (running)'))
  const failedNote = await page.locator('.failed-note').textContent()
  check('failed_nodes 黃字提示', failedNote.includes('web-server-04'))
  // clear ✕
  await page.locator('.search-bar .search-clear').click()
  await page.waitForTimeout(100)
  check('clear ✕ 關閉結果面板', (await page.locator('[data-testid="search-results"]').count()) === 0)
  await ctx.close()
}

// ── 3. Node Management @1440 ──
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  await setupMocks(page)
  await page.goto(BASE + '/nodes')
  await page.waitForSelector('.node-table')
  const badges = await page.locator('.node-status-badge').count()
  check('Node Management 6 列 badge', badges === 6, `${badges}`)
  const badgeCls = await page.locator('.node-status-badge').nth(0).getAttribute('class')
  check('badge 含狀態 class', badgeCls.includes('badge-on'))
  const hb = await page.locator('.node-table .cell-hb').first().textContent()
  check('最後心跳 toLocaleString', /[0-9]+\/[0-9]+\/[0-9]+/.test(hb), hb)
  // 下載選單
  await page.locator('.arch-menu button').first().click()
  await page.waitForSelector('.arch-dropdown')
  const dlShadow = await page.locator('.arch-dropdown').evaluate(el => getComputedStyle(el).boxShadow)
  check('下載選單 shadow-lg', dlShadow !== 'none', dlShadow.slice(0, 40))
  await page.keyboard.press('Escape')
  // 新增節點 Modal → 520px
  await page.locator('[data-testid="add-node"]').click()
  await page.waitForSelector('.node-form-modal')
  await page.waitForTimeout(350) // 等 150ms slide-in 動畫結束再量測
  const mw = await page.locator('.node-form-modal').evaluate(el => Math.round(el.getBoundingClientRect().width))
  check('NodeFormModal 寬度 520px', mw === 520, `${mw}px`)
  const mbtnH = await page.locator('.form-actions .btn').first().evaluate(el => Math.round(el.getBoundingClientRect().height))
  check('desktop 動作按鈕 36px', mbtnH === 36, `${mbtnH}px`)
  const modalRole = await page.locator('.node-form-modal').getAttribute('role')
  check('Modal role=dialog aria-modal', modalRole === 'dialog' && (await page.locator('.node-form-modal').getAttribute('aria-modal')) === 'true')
  // 測試連線結果 aria-live
  await page.fill('[data-testid="node-name"]', 'web-05')
  await page.fill('[data-testid="node-address"]', '10.0.0.5:8443')
  await page.route('**/api/v1/nodes/test-connection', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ version: '1.2.3', hostname: 'web-05', os: 'Ubuntu 22.04', uptime: 100 }) }))
  await page.locator('[data-testid="test-connection"]').click()
  await page.waitForSelector('.test-result.test-ok')
  const live = await page.locator('.test-result').getAttribute('aria-live')
  const hasCheckSvg = await page.locator('.test-result svg').count()
  check('測試連線結果 ✅ SVG + aria-live', live === 'polite' && hasCheckSvg === 1, `aria-live=${live}`)
  await ctx.close()
}

// ── 4. NodeFormModal mobile bottom sheet @375 ──
{
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } })
  const page = await ctx.newPage()
  await setupMocks(page)
  await page.goto(BASE + '/nodes')
  await page.waitForSelector('.node-table')
  await page.locator('[data-testid="add-node"]').click()
  await page.waitForSelector('.node-form-modal')
  await page.waitForTimeout(350) // 動畫完成後量測
  const sheet = await page.locator('.modal-overlay').evaluate(el => {
    const m = el.querySelector('.node-form-modal').getBoundingClientRect()
    const o = el.getBoundingClientRect()
    return { mw: Math.round(m.width), mh: Math.round(m.height), oh: Math.round(o.height), br: getComputedStyle(el.querySelector('.node-form-modal')).borderRadius, maxH: getComputedStyle(el.querySelector('.node-form-modal')).maxHeight }
  })
  check('mobile bottom sheet 全寬', sheet.mw === 375, `${sheet.mw}px`)
  check('mobile bottom sheet max-height 100dvh', sheet.maxH === '812px', `${sheet.maxH} 視口 ${sheet.oh}`)
  check('mobile 頂部圓角 14px', sheet.br.startsWith('14px'), sheet.br)
  const btnH = await page.locator('.form-actions .btn').first().evaluate(el => Math.round(el.getBoundingClientRect().height))
  check('mobile 動作按鈕 44px', btnH === 44, `${btnH}px`)
  await ctx.close()
}

// ── 5. node-dashboard：NodeSwitcher ARIA + 離線 Banner + 禁用 ──
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  await setupMocks(page)
  await page.goto(BASE + '/dashboard?node=n5')
  await page.waitForSelector('[data-testid="offline-banner"]')
  const bannerRole = await page.locator('[data-testid="offline-banner"]').getAttribute('role')
  check('離線 Banner role=alert', bannerRole === 'alert', bannerRole)
  const disabled = await page.locator('#service-table-body button:disabled').count()
  check('離線時操作按鈕全部 disabled', disabled >= 10, `${disabled}`)
  // NodeSwitcher 下拉 ARIA
  const nsBtn = page.locator('[data-testid="node-switcher"]')
  check('NodeSwitcher aria-haspopup/expanded', (await nsBtn.getAttribute('aria-haspopup')) === 'menu' && (await nsBtn.getAttribute('aria-expanded')) === 'false')
  await nsBtn.click()
  const menuRole = await page.locator('.node-dropdown').getAttribute('role')
  const optRoles = await page.locator('.node-dropdown [role="menuitemradio"]').count()
  const checked = await page.locator('.node-dropdown [aria-checked="true"]').count()
  check('下拉 role=menu + menuitemradio + aria-checked', menuRole === 'menu' && optRoles === 7 && checked === 1, `menu=${menuRole} options=${optRoles} checked=${checked}`)
  // 方向鍵移動
  await page.keyboard.press('ArrowDown')
  const focused = await page.evaluate(() => document.activeElement?.textContent?.trim())
  check('方向鍵 ArrowDown 聚焦「所有節點」', focused && focused.includes('所有節點'), focused)
  await page.keyboard.press('ArrowDown')
  const focused2 = await page.evaluate(() => document.activeElement?.textContent?.trim())
  check('方向鍵再按移動至第一個節點', focused2 && focused2.includes('web-server-01'), focused2)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(100)
  check('Esc 關閉下拉', (await page.locator('.node-dropdown').count()) === 0)
  // 返回連結
  const backLink = await page.locator('.dashboard-header a.btn, .dashboard-header .back-link, .dashboard-header a').first().getAttribute('href')
  check('「← 所有節點」返回 /', backLink === '/', backLink)
  await ctx.close()
}

// ── 6. dark theme ──
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await ctx.addInitScript(() => localStorage.setItem('lms-theme', 'dark'))
  const page = await ctx.newPage()
  await setupMocks(page)
  await page.goto(BASE + '/')
  await page.waitForSelector('[data-testid="aggregate-stats"]')
  const theme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'))
  check('dark theme 生效', theme === 'dark', theme)
  const bg = await page.locator('.node-card').first().evaluate(el => getComputedStyle(el).backgroundColor)
  check('dark 卡片背景為深色', /rgba?\((\d+)/.exec(bg)[1] < 100, bg)
  await ctx.close()
}

await browser.close()
console.log(failures === 0 ? '\n✅ 全部 DOM 驗證通過' : `\n❌ ${failures} 項失敗`)
process.exit(failures === 0 ? 0 : 1)
