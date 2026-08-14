/**
 * Shared authentication helper for E2E tests.
 *
 * Route note（014 決策 8）：前端路由已變更：
 *   - `/`        = AggregateDashboardView（登入預設，多機管理）
 *   - `/dashboard` = DashboardView（單機 / `?node=` node-aware）
 *   - `/nodes`   = NodeManagementView
 *
 * IMPORTANT: Always navigate to `/` (not `/login`) because Vite's proxy
 * forwards `/login` to localhost:8080 (Pi agent).
 *
 * `loginViaUI()` 預設在登入流程驗證完成後（登入會導向 `/` = Aggregate）
 * 導向 `/dashboard`（單機服務管理視圖），讓既有以「服務表格」為主的 spec
 * 不需逐個修改；若要停留在 Aggregate（例如 014 E2E-01），傳 `{ landOn: 'aggregate' }`。
 */

import { expect, type Page, type Route, type WebSocketRoute } from '@playwright/test'
import type { Node, NodeSummary, SearchResponse, NodeSystemInfo } from '../src/types/node'

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

// ── Node mock 資料工廠（014）──────────────────────────────────────

let nodeSeq = 0
export function nextNodeId(): string {
  nodeSeq += 1
  return `node_${String(nodeSeq).padStart(3, '0')}`
}

/** 建立節點 mock 物件（決策 8：token masked `lsm_node_****xxxx`） */
export function makeNode(overrides: Partial<Node> = {}): Node {
  const id = overrides.id ?? nextNodeId()
  return {
    id,
    name: 'web-server-01',
    address: '10.0.0.5:8443',
    status: 'online',
    token: 'lsm_node_****' + id.slice(-4),
    service_stats: { total: 3, active: 2, failed: 1 },
    last_heartbeat: new Date(Date.now() - 5_000).toISOString(),
    agent_version: '1.2.0',
    hostname: 'web-server-01',
    os: 'Ubuntu 22.04',
    created_at: '2026-08-13T08:00:00Z',
    updated_at: '2026-08-13T08:00:00Z',
    ...overrides,
  } as Node
}

/** 由節點陣列聚合 summary（決策 3/7：以心跳 stats 為準，零網路請求） */
export function computeNodeSummary(nodes: Node[]): NodeSummary {
  return {
    total_nodes: nodes.length,
    online: nodes.filter(n => n.status === 'online').length,
    degraded: nodes.filter(n => n.status === 'degraded').length,
    offline: nodes.filter(n => n.status === 'offline').length,
    long_offline: nodes.filter(n => n.status === 'long_offline').length,
    warning: nodes.filter(n => n.status === 'warning').length,
    total_services: nodes.reduce((s, n) => s + (n.service_stats?.total ?? 0), 0),
    active_services: nodes.reduce((s, n) => s + (n.service_stats?.active ?? 0), 0),
    failed_services: nodes.reduce((s, n) => s + (n.service_stats?.failed ?? 0), 0),
  }
}

/** 建立 system info（決策 6：info 10s 代理） */
export function makeSystemInfo(overrides: Partial<NodeSystemInfo> = {}): NodeSystemInfo {
  return {
    os: 'Ubuntu 22.04.4 LTS',
    kernel: '5.15.0-91-generic',
    uptime: 360_000,
    cpu: 'Intel(R) Xeon(R) CPU E5-2680 v4 @ 2.40GHz',
    mem: '15.6 GiB / 31.3 GiB',
    disk: '45% (112G / 250G)',
    ...overrides,
  }
}

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
 *
 * 014（決策 8）：登入預設 `/` 為 AggregateDashboardView — 補上預設節點 mock
 * （nodes 空陣列 + summary 全零）讓 Aggregate 呈現乾淨空狀態（不噴錯誤/不進 retry）。
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

  // ── 014 預設節點 mock（決策 8）：Aggregate 乾淨空狀態 ──
  // 註冊順序在 setupNodeApiMocks 之前 → 被更晚註冊的 node mocks 覆寫（last wins）
  // 注意：恆回 200（空狀態）— 節點 API 僅在已登入的視圖（Aggregate/Dashboard/NodeManagement）被呼叫，
  // 登入流程由 /session 與 /login mock 控制；若 spec 覆寫 login route（如 011-session-expired），
  // 此處 loggedIn 不變 true，回 401 會誤觸發 axios 401 interceptor → 登出（歷史 flaky）。
  await page.route('**/api/v1/nodes/summary', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { total_nodes: 0, online: 0, degraded: 0, offline: 0, long_offline: 0, warning: 0, total_services: 0, active_services: 0, failed_services: 0 } }),
    })
  })
  await page.route('**/api/v1/nodes', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [] }),
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

// ── 014 狀態化節點 mock（setupNodeApiMocks）───────────────────────

export interface NodeApiMockOptions {
  /** 初始節點（預設 []） */
  nodes?: Node[]
  /** 每節點服務列表（key = nodeId；未指定 → MOCK_SERVICES） */
  servicesByNode?: Record<string, typeof MOCK_SERVICES>
  /** address 於此清單（prefix 比對）視為不可達 → 註冊回傳 status=offline（E2E-31） */
  unreachableAddresses?: string[]
  /** test-connection 回應覆寫（E2E-26~28）；未指定 → 依 unreachableAddresses 回 502 或 200 */
  testConnection?: (body: { address: string; tls_fingerprint?: string; token?: string }) => { status: number; body: any }
  /** 操作回應覆寫（key = action）；未指定 → 200 { message: 動作動詞 }；E2E-16 用 500 */
  actionResponses?: Record<string, { status: number; body: any }>
  /** GET /nodes/{id}/services 狀態覆寫：回非 200 時模擬節點離線/逾時 */
  servicesStatus?: (nodeId: string) => number
  /** search 回應（E2E-17~20）；未指定 → 空結果 */
  search?: (q: string) => { results: SearchResponse['results']; failed_nodes: SearchResponse['failed_nodes'] }
  /** download 回應覆寫（E2E-37/38） */
  download?: { status: number; contentType: string; body: Buffer }
  /** 節點數量上限（E2E-50，預設 50） */
  nodeLimit?: number
  /** 各 route 人為延遲（ms）供 loading 斷言（E2E-26/46） */
  delays?: { nodes?: number; summary?: number; services?: number; action?: number; search?: number; testConnection?: number; info?: number }
}

export interface NodeMocks {
  /** 可變節點陣列（直接 mutate 供 E2E-39/42/55 使用） */
  nodes: Node[]
  stats: {
    nodesGet: number
    nodesSummary: number
    create: number
    update: number
    delete: number
    testConnection: number
    search: number
    download: number
    services: number
    logs: number
    info: number
    actions: Record<string, number>
  }
  lastCreateBody: Record<string, any>
  lastUpdateBody: Record<string, any>
}

const ACTION_VERBS: Record<string, string> = {
  start: '已啟動',
  stop: '已停止',
  restart: '已重啟',
  enable: '已啟用',
  disable: '已停用',
}

function delay(ms?: number): Promise<void> {
  return ms ? new Promise(r => setTimeout(r, ms)) : Promise.resolve()
}

/**
 * 狀態化節點 API mock（014 決策 4/5/6/9）：
 *  - nodes 陣列可變（CRUD / WS 事件直接改陣列 → 重新載入/斷言即反映）
 *  - summary 由 nodes 聚合（決策 3/7）
 *  - 涵蓋：nodes CRUD（含 409 重複 / 50 上限 / 不可達仍註冊）、test-connection、
 *    proxy services / ops / logs / info、search（results + failed_nodes）、agents/download
 *
 * 必須在 setupApiMocks 之後呼叫（後註冊的 route 優先）。
 */
export async function setupNodeApiMocks(page: Page, options: NodeApiMockOptions = {}): Promise<NodeMocks> {
  const nodes: Node[] = (options.nodes ?? []).map(n => ({ ...n, service_stats: { total: 0, active: 0, failed: 0, ...(n.service_stats ?? {}) } }))
  const unreachable = options.unreachableAddresses ?? []
  const servicesByNode = options.servicesByNode ?? {}
  const actionResponses = options.actionResponses ?? {}
  const servicesStatus = options.servicesStatus ?? (() => 200)
  const search = options.search ?? (() => ({ results: [], failed_nodes: [] }))
  const download = options.download
  const nodeLimit = options.nodeLimit ?? 50
  const delays = options.delays ?? {}

  const stats: NodeMocks['stats'] = {
    nodesGet: 0, nodesSummary: 0, create: 0, update: 0, delete: 0, testConnection: 0,
    search: 0, download: 0, services: 0, logs: 0, info: 0, actions: {},
  }
  const lastCreateBody: Record<string, any> = {}
  const lastUpdateBody: Record<string, any> = {}

  const fulfill = (route: Route, status: number, body: unknown, contentType = 'application/json') =>
    route.fulfill({ status, contentType, body: typeof body === 'string' ? body : JSON.stringify(body) })

  const isUnreachable = (addr: string) => unreachable.some(p => addr.startsWith(p))

  /** 解析請求 body：axios 預設 Content-Type 為 x-www-form-urlencoded（物件 → URLSearchParams）；
   *  含 JSON header 的呼叫則解析 JSON */
  const parseBody = (route: Route): Record<string, any> => {
    const raw = route.request().postData() || ''
    const ct = route.request().headers()['content-type'] || ''
    if (ct.includes('application/json')) {
      try { return JSON.parse(raw) } catch { return {} }
    }
    try {
      return Object.fromEntries(new URLSearchParams(raw))
    } catch {
      return {}
    }
  }

  const nodeServices = (nodeId: string) => servicesByNode[nodeId] ?? MOCK_SERVICES

  // ── route 註冊順序注意：Playwright 以「最後註冊者優先」，故通用 pattern 先註冊、
  //    特定 pattern（summary / test-connection / search / logs）最後註冊以覆寫之 ──

  // 8) GET /api/v1/nodes（列表）/ POST /api/v1/nodes（註冊）
  await page.route('**/api/v1/nodes', async (route) => {
    const method = route.request().method()
    if (method === 'GET') {
      stats.nodesGet++
      await delay(delays.nodes)
      return fulfill(route, 200, { data: nodes })
    }
    if (method === 'POST') {
      stats.create++
      const body = parseBody(route)
      Object.assign(lastCreateBody, body)
      const name = (body.name ?? '').trim()
      const address = (body.address ?? '').trim()
      // 必填驗證（BDD @validation / HDL-04）
      if (!name || !address) return fulfill(route, 400, { error: '名稱與位址為必填' })
      // 名稱重複（BDD @duplicate）
      if (nodes.some(n => n.name === name)) return fulfill(route, 409, { error: '節點名稱重複' })
      // 50 上限（BDD @node-limit）
      if (nodes.length >= nodeLimit) return fulfill(route, 409, { error: '已達節點數量上限' })
      // 註：token/指紋至少其一為後端契約（決策 5，HDL-05），前端 Modal 不強制 — E2E 註冊流程不帶 token 仍成功
      const now = new Date().toISOString()
      const created: Node = {
        id: nextNodeId(),
        name,
        address,
        tls_fingerprint: body.tls_fingerprint || undefined,
        token: body.token ? `lsm_node_****${body.token.slice(-4)}` : undefined,
        notes: body.notes,
        status: isUnreachable(address) ? 'offline' : 'online',  // E2E-31 不可達仍儲存（離線）
        last_heartbeat: isUnreachable(address) ? undefined : now,
        agent_version: isUnreachable(address) ? undefined : '1.2.0',
        hostname: isUnreachable(address) ? undefined : name,
        os: isUnreachable(address) ? undefined : 'Ubuntu 22.04',
        service_stats: { total: 0, active: 0, failed: 0 },
        created_at: now,
        updated_at: now,
      }
      nodes.push(created)
      return fulfill(route, 201, { data: created })
    }
    return fulfill(route, 405, { error: 'method not allowed' })
  })

  // 9) GET/PUT/DELETE /api/v1/nodes/{id}
  await page.route('**/api/v1/nodes/*', async (route) => {
    // 特定子路徑由稍後註冊的專屬 route 覆寫（summary / test-connection）
    const method = route.request().method()
    const nodeId = route.request().url().match(/\/nodes\/([^/]+)$/)?.[1] ?? ''
    const idx = nodes.findIndex(n => n.id === nodeId)
    if (method === 'GET') {
      if (idx === -1) return fulfill(route, 404, { error: 'node not found' })
      return fulfill(route, 200, { data: nodes[idx] })
    }
    if (method === 'PUT') {
      stats.update++
      if (idx === -1) return fulfill(route, 404, { error: 'node not found' })
      const body = parseBody(route)
      Object.assign(lastUpdateBody, body)
      const updated: Node = {
        ...nodes[idx],
        name: (body.name ?? nodes[idx].name).trim(),
        address: (body.address ?? nodes[idx].address).trim(),
        tls_fingerprint: body.tls_fingerprint !== undefined ? body.tls_fingerprint : nodes[idx].tls_fingerprint,
        token: body.token ? `lsm_node_****${body.token.slice(-4)}` : nodes[idx].token, // token 留空 = 不變更（決策 5）
        notes: body.notes !== undefined ? body.notes : nodes[idx].notes,
        updated_at: new Date().toISOString(),
      }
      nodes[idx] = updated
      return fulfill(route, 200, { data: updated })
    }
    if (method === 'DELETE') {
      stats.delete++
      if (idx === -1) return fulfill(route, 404, { error: 'node not found' })
      nodes.splice(idx, 1)   // 歷史資料與 Audit Log 保留（BDD @data）
      return fulfill(route, 200, { message: '節點已移除' })
    }
    return fulfill(route, 405, { error: 'method not allowed' })
  })

  // 10) GET /api/v1/agents/download?arch=（決策 1/4：go:embed binary）
  await page.route('**/api/v1/agents/download*', async (route) => {
    stats.download++
    const arch = new URL(route.request().url()).searchParams.get('arch') ?? ''
    if (download) return fulfill(route, download.status, download.body, download.contentType)
    if (arch !== 'amd64' && arch !== 'arm64') return fulfill(route, 400, { error: 'unsupported arch' })
    const buf = Buffer.from(`mock agent binary for ${arch}`)
    return fulfill(route, 200, buf, 'application/octet-stream')
  })

  // 1) GET /api/v1/nodes/summary（決策 3/7：聚合心跳 stats，零網路請求）— 最後註冊覆寫 /nodes/*
  await page.route('**/api/v1/nodes/summary', async (route) => {
    stats.nodesSummary++
    await delay(delays.summary)
    await fulfill(route, 200, { data: computeNodeSummary(nodes) })
  })

  // 2) POST /api/v1/nodes/test-connection（決策 6：health 5s；502 帶具體原因）— 最後註冊覆寫 /nodes/*
  await page.route('**/api/v1/nodes/test-connection', async (route) => {
    stats.testConnection++
    await delay(delays.testConnection)
    const body = parseBody(route)
    if (options.testConnection) {
      const r = options.testConnection(body)
      return fulfill(route, r.status, r.body)
    }
    if (isUnreachable(body.address)) {
      return fulfill(route, 502, { error: 'connection refused' })
    }
    return fulfill(route, 200, { version: '1.2.3', hostname: 'web-server-01', os: 'Ubuntu 22.04', uptime: 360_000 })
  })

  // 3) GET /api/v1/nodes/services/search?q=（決策 9：fan-out + failed_nodes）
  const handleSearch = async (route: Route) => {
    stats.search++
    await delay(delays.search)
    const url = new URL(route.request().url())
    const q = url.searchParams.get('q') ?? ''
    if (!q.trim()) return fulfill(route, 400, { error: '缺少查詢字串' })
    const r = await search(q)
    return fulfill(route, 200, { results: r.results, failed_nodes: r.failed_nodes })
  }
  await page.route('**/api/v1/nodes/services/search*', handleSearch)

  // 5) POST /api/v1/nodes/{id}/services/{name}/{action}（決策 6：15s 操作代理）
  const handleAction = async (route: Route) => {
    const url = route.request().url()
    const m = url.match(/\/nodes\/([^/]+)\/services\/(.+?)\/(start|stop|restart|enable|disable)$/)
    const nodeId = m ? m[1] : ''
    const name = m ? decodeURIComponent(m[2]) : ''
    const action = m ? m[3] : ''
    stats.actions[action] = (stats.actions[action] ?? 0) + 1
    await delay(delays.action)
    if (!nodes.find(n => n.id === nodeId)) return fulfill(route, 404, { error: 'node not found' })
    const override = actionResponses[action]
    if (override) return fulfill(route, override.status, override.body)
    return fulfill(route, 200, { message: ACTION_VERBS[action] ?? `${name} ${action}` })
  }
  await page.route('**/api/v1/nodes/*/services/*/*', handleAction)

  // 4) GET /api/v1/nodes/{id}/services/{name}/logs（決策 6：15s 代理，text/plain）— 最後註冊（覆寫 ops 的 */* pattern）
  await page.route('**/api/v1/nodes/*/services/*/logs', async (route) => {
    stats.logs++
    const url = route.request().url()
    const m = url.match(/\/nodes\/([^/]+)\/services\/(.+?)\/logs/)
    const nodeId = m ? m[1] : ''
    const name = m ? decodeURIComponent(m[2]) : ''
    if (!nodes.find(n => n.id === nodeId)) return fulfill(route, 404, { error: 'node not found' })
    await fulfill(route, 200, `── journal for ${name} (mock node ${nodeId}) ──\nAug 13 10:00:01 mock systemd[1]: Started ${name}.\nAug 13 10:00:02 mock app[1234]: hello from ${name}`, 'text/plain')
  })

  // 6) GET /api/v1/nodes/{id}/services（決策 8：代理 Agent 服務列表）
  await page.route('**/api/v1/nodes/*/services', async (route) => {
    stats.services++
    await delay(delays.services)
    const nodeId = route.request().url().match(/\/nodes\/([^/]+)\/services/)?.[1] ?? ''
    const st = servicesStatus(nodeId)
    if (st !== 200) return fulfill(route, st, { error: 'node offline' })
    if (!nodes.find(n => n.id === nodeId)) return fulfill(route, 404, { error: 'node not found' })
    await fulfill(route, 200, nodeServices(nodeId))
  })

  // 7) GET /api/v1/nodes/{id}/info（決策 6：10s 代理）
  await page.route('**/api/v1/nodes/*/info', async (route) => {
    stats.info++
    await delay(delays.info)
    await fulfill(route, 200, makeSystemInfo())
  })

  return { nodes, stats, lastCreateBody, lastUpdateBody }
}

// ── WS mock（014：node_* 事件推播）────────────────────────────────

export interface WsHub {
  clients: WebSocketRoute[]
  /** 推播 JSON 訊息給所有已連線的 WebSocket 客戶端（E2E-39/41/43…） */
  push(msg: unknown): void
  /** 等待至少一個 WS 客戶端連上（防止推播時尚未連線） */
  waitConnected(timeoutMs?: number): Promise<void>
}

/**
 * Mock WebSocket server（Playwright 1.62 `page.routeWebSocket`）：
 * 接受 `ws://{host}/api/v1/ws` 連線並提供 `push(msg)` 推播 node_* 事件。
 * 需在頁面導覽（WS 連線建立）之前註冊。
 */
export async function mockNodeWs(page: Page): Promise<WsHub> {
  const clients: WebSocketRoute[] = []
  await page.routeWebSocket('**/api/v1/ws', (ws) => {
    clients.push(ws)
    // 客戶端心跳/ping 訊息忽略即可
    ws.onMessage(() => {})
    ws.onClose(() => {
      const i = clients.indexOf(ws)
      if (i !== -1) clients.splice(i, 1)
    })
  })
  return {
    clients,
    push(msg) {
      const payload = JSON.stringify(msg)
      for (const ws of clients) {
        try { ws.send(payload) } catch { /* 已關閉的連線忽略 */ }
      }
    },
    async waitConnected(timeoutMs = 5_000) {
      const deadline = Date.now() + timeoutMs
      while (clients.length === 0 && Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 50))
      }
      expect(clients.length).toBeGreaterThan(0)
    },
  }
}

// ── Navigation helpers ────────────────────────────────────────────

/**
 * Navigate to the app and log in from an unauthenticated state.
 *
 * 登入流程本身會導向 `/`（Aggregate，決策 8）— 此處先驗證登入成功落在 `/`，
 * 再依 `landOn` 決定停留位置（預設導向 `/dashboard` 單機服務管理視圖，
 * 讓既有以服務表格為主的 spec 不需逐一修改）。
 */
export async function loginViaUI(page: Page, opts: { landOn?: 'aggregate' | 'dashboard' } = {}) {
  const { landOn = 'dashboard' } = opts
  await page.goto('/')
  await page.waitForURL((url) => url.pathname === '/login', { timeout: 10_000 })
  await page.waitForSelector('.login-form', { timeout: 10_000 })

  await page.fill('input[type="text"]', VALID_USER)
  await page.fill('input[type="password"]', VALID_PASS)
  await page.click('button[type="submit"]')

  // 登入成功 → 導向 `/`（AggregateDashboardView）
  await page.waitForURL((url) => url.pathname === '/', { timeout: 10_000 })
  await page.waitForSelector('.aggregate-dashboard', { timeout: 10_000 })
  if (landOn === 'dashboard') {
    await page.goto('/dashboard')
    await page.waitForURL((url) => url.pathname === '/dashboard', { timeout: 10_000 })
    await page.waitForSelector('.app-header', { timeout: 10_000 })
  }
}

/**
 * Navigate directly to the single-machine services dashboard when already authenticated.
 * （014 決策 8：單機/`?node=` 視圖位於 `/dashboard`）
 */
export async function gotoDashboard(page: Page) {
  await page.goto('/dashboard')
  await page.waitForURL((url) => url.pathname === '/dashboard', { timeout: 10_000 })
  await page.waitForSelector('.app-header', { timeout: 10_000 })
}

/** 登入後直接進入單機服務 Dashboard（既有服務表格 spec 的統一入口） */
export async function loginAndOpenDashboard(page: Page) {
  await loginViaUI(page)
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
