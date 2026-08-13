/**
 * 013 — Webhook 通知設定 E2E Tests
 *
 * 對應文件：
 *   - docs/interaction-flows/013-webhook-notification.md
 *   - docs/test-plans/013-webhook-notification測試計畫.md §5（E2E-01~50，僅 mock 可測的 UI 流程）
 *   - docs/development/013-webhook-notification.md §3.3（7 個 API 合約）
 *
 * 環境：全 mock（page.route 攔截 API，不連真實後端）。
 * 背景觸發（D-Bus / polling → 服務狀態變更自動發送）為後端行為，
 * 已由單元/整合測試覆蓋，本 E2E 只測「管理員在瀏覽器中的操作路徑」。
 */

import { test, expect, type Page, type Route } from '@playwright/test'
import { setupApiMocks, loginViaUI } from './auth.setup'

// ── Mock 型別 ─────────────────────────────────────────────────────

type ChannelType = 'slack' | 'discord' | 'telegram' | 'custom'

interface MockChannel {
  id: string
  type: ChannelType
  name: string
  url?: string
  token?: string
  chat_id?: string
  method?: 'POST' | 'PUT'
  headers?: Record<string, string>
  events: string[]
  all_services: boolean
  services?: string[]
  enabled: boolean
  auto_disabled_reason?: string
  created_at: string
  updated_at: string
}

interface MockHistoryEntry {
  timestamp: string
  channel_id: string
  channel_name: string
  channel_type: string
  event: string
  service: string
  status: 'success' | 'failure'
  error?: string
  duration_ms: number
}

interface TestResult {
  success: boolean
  message?: string
  error?: string
  detail?: string
}

export interface NotifyMockOptions {
  channels?: MockChannel[]
  history?: MockHistoryEntry[]
  /** POST /channels/{id}/test 的回應（預設成功） */
  testResult?: TestResult
  /** test endpoint 人為延遲（ms），供 loading 狀態斷言 */
  testDelay?: number
  failCreate?: boolean
  failUpdate?: boolean
  failDelete?: boolean
  failPatch?: boolean
}

// ── 資料工廠 ──────────────────────────────────────────────────────

function makeChannel(overrides: Partial<MockChannel> = {}): MockChannel {
  return {
    id: 'chn_001',
    type: 'slack',
    name: '團隊 Slack',
    url: 'https://hooks.slack.com/services/T000/B000/XXXX',
    events: ['failed'],
    all_services: true,
    services: [],
    enabled: true,
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-01T00:00:00Z',
    ...overrides,
  }
}

function makeHistory(overrides: Partial<MockHistoryEntry> = {}): MockHistoryEntry {
  return {
    timestamp: '2026-08-13T10:00:00Z',
    channel_id: 'chn_001',
    channel_name: '團隊 Slack',
    channel_type: 'slack',
    event: 'failed',
    service: 'nginx.service',
    status: 'success',
    duration_ms: 120,
    ...overrides,
  }
}

// ── API Mock Setup ────────────────────────────────────────────────

function maskToken(token: string): string {
  return `****${token.slice(-4)}`
}

/**
 * Mock 7 個 notify endpoint（全狀態化 happy-path）。
 * 需與 setupApiMocks 搭配（先 setupApiMocks 再 setupNotifyMocks）。
 * 回傳可變狀態與 request 統計，供斷言（如「無 POST 請求」）。
 */
export async function setupNotifyMocks(page: Page, options: NotifyMockOptions = {}) {
  const channels: MockChannel[] = (options.channels ?? []).map(c => ({ ...c }))
  const history: MockHistoryEntry[] = (options.history ?? []).map(h => ({ ...h }))
  const testResult: TestResult = options.testResult ?? { success: true, message: '測試通知已發送' }

  const stats = {
    channelsGet: 0,
    post: 0,
    put: 0,
    patch: 0,
    delete: 0,
    test: 0,
    history: 0,
  }
  const lastPostBody: any = {}
  const lastPutBody: any = {}
  const lastPatchBody: any = {}

  const now = () => new Date().toISOString()
  const newId = () => `chn_${Math.random().toString(36).slice(2, 10)}`
  const fulfill = (route: Route, status: number, body: unknown) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })

  // 1) GET / POST /api/v1/notify/channels
  await page.route('**/api/v1/notify/channels', async (route) => {
    const method = route.request().method()
    if (method === 'GET') {
      stats.channelsGet++
      return fulfill(route, 200, { data: channels })
    }
    if (method === 'POST') {
      stats.post++
      if (options.failCreate) return fulfill(route, 500, { error: '伺服器內部錯誤' })
      const body = JSON.parse(route.request().postData() || '{}')
      Object.assign(lastPostBody, body)
      const created: MockChannel = {
        id: newId(),
        type: body.type,
        name: body.name,
        url: body.url,
        token: body.token ? maskToken(body.token) : undefined,
        chat_id: body.chat_id,
        method: body.method,
        headers: body.headers,
        events: body.events ?? [],
        all_services: body.all_services ?? true,
        services: body.services ?? [],
        enabled: true,
        created_at: now(),
        updated_at: now(),
      }
      channels.push(created)
      return fulfill(route, 201, { data: created })
    }
    return fulfill(route, 405, { error: 'method not allowed' })
  })

  // 2) PUT / PATCH / DELETE /api/v1/notify/channels/{id}
  await page.route('**/api/v1/notify/channels/*', async (route) => {
    const method = route.request().method()
    const pathname = new URL(route.request().url()).pathname
    const m = pathname.match(/\/notify\/channels\/([^/]+)$/)
    const cid = m ? decodeURIComponent(m[1]) : ''
    const idx = channels.findIndex(c => c.id === cid)
    if (idx === -1) return fulfill(route, 404, { error: 'not found' })

    if (method === 'PUT') {
      stats.put++
      if (options.failUpdate) return fulfill(route, 500, { error: '伺服器內部錯誤' })
      const body = JSON.parse(route.request().postData() || '{}')
      Object.assign(lastPutBody, body)
      const existing = channels[idx]
      const updated: MockChannel = {
        ...existing,
        type: body.type,
        name: body.name,
        url: body.url,
        token: body.token ? maskToken(body.token) : existing.token,
        chat_id: body.chat_id,
        method: body.method,
        headers: body.headers,
        events: body.events ?? existing.events,
        all_services: body.all_services ?? existing.all_services,
        services: body.services ?? existing.services,
        auto_disabled_reason: undefined,
        updated_at: now(),
      }
      channels[idx] = updated
      return fulfill(route, 200, { data: updated })
    }

    if (method === 'PATCH') {
      stats.patch++
      if (options.failPatch) return fulfill(route, 500, { error: '伺服器錯誤' })
      const body = JSON.parse(route.request().postData() || '{}')
      Object.assign(lastPatchBody, body)
      const existing = channels[idx]
      existing.enabled = !!body.enabled
      if (existing.enabled) existing.auto_disabled_reason = undefined
      existing.updated_at = now()
      return fulfill(route, 200, { data: { ...existing } })
    }

    if (method === 'DELETE') {
      stats.delete++
      if (options.failDelete) return fulfill(route, 500, { error: '伺服器錯誤' })
      channels.splice(idx, 1)
      return fulfill(route, 200, { message: 'Channel 已刪除' })
    }

    return fulfill(route, 405, { error: 'method not allowed' })
  })

  // 3) POST /api/v1/notify/channels/{id}/test
  await page.route('**/api/v1/notify/channels/*/test', async (route) => {
    stats.test++
    const pathname = new URL(route.request().url()).pathname
    const m = pathname.match(/\/notify\/channels\/([^/]+)\/test$/)
    const cid = m ? decodeURIComponent(m[1]) : ''
    if (!channels.find(c => c.id === cid)) return fulfill(route, 404, { error: 'not found' })
    if (options.testDelay) await new Promise(r => setTimeout(r, options.testDelay))
    if (testResult.success) {
      return fulfill(route, 200, { success: true, message: testResult.message ?? '測試通知已發送', detail: testResult.detail })
    }
    return fulfill(route, 502, { success: false, error: testResult.error ?? '連線逾時', detail: testResult.detail })
  })

  // 4) GET /api/v1/notify/history（含 query string）
  const handleHistory = async (route: Route) => {
    stats.history++
    const url = new URL(route.request().url())
    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10))
    const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '30', 10)))
    const channelId = url.searchParams.get('channel_id') || ''
    const status = url.searchParams.get('status') || 'all'

    let filtered = [...history]
    if (channelId) filtered = filtered.filter(h => h.channel_id === channelId)
    if (status && status !== 'all') filtered = filtered.filter(h => h.status === status)
    filtered.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1))

    const total = filtered.length
    const start = (page - 1) * limit
    const data = filtered.slice(start, start + limit)
    return fulfill(route, 200, { data, total, page, limit })
  }
  await page.route('**/api/v1/notify/history?*', handleHistory)
  await page.route('**/api/v1/notify/history', handleHistory)

  return { channels, history, stats, lastPostBody, lastPutBody, lastPatchBody }
}

// ── 頁面設定 / 導覽 helpers ───────────────────────────────────────

/** 設定語言 zh-TW（讓 i18n tab 標籤為「Channel 設定 / 發送紀錄」）+ 全 API mock */
async function setupPage(page: Page, options: NotifyMockOptions = {}) {
  await page.addInitScript(() => localStorage.setItem('lms-lang', 'zh-TW'))
  await setupApiMocks(page, { authenticated: false })
  return setupNotifyMocks(page, options)
}

/** 登入後由 Header 點「🔔 Notifications」進入 /notifications */
async function gotoNotifications(page: Page) {
  await loginViaUI(page)
  await page.click('[data-testid="nav-notifications"]')
  await page.waitForURL((u) => u.pathname === '/notifications', { timeout: 10_000 })
  await expect(page.locator('.notifications-page')).toBeVisible()
}

/** 勾選 ChannelForm 中的觸發事件 chip（input 視覺隱藏，改點擊 label） */
async function checkEvent(page: Page, name: string) {
  await page.locator('.event-chip').filter({ hasText: name }).click()
}

/** 開啟新增表單（header 右上 data-testid=add-channel） */
async function openCreateForm(page: Page) {
  await page.click('[data-testid="add-channel"]')
  await expect(page.locator('[data-testid="channel-type"]')).toBeVisible()
}

// ── 進入與列表 ────────────────────────────────────────────────────

test.describe('Webhook 通知設定 — 進入與列表', () => {
  test('E2E-01: 進入通知設定頁面（URL + 預設「Channel 設定」分頁）', async ({ page }) => {
    const mocks = await setupPage(page, { channels: [makeChannel()] })
    await gotoNotifications(page)

    await expect(page.locator('.notify-title')).toContainText('通知')
    // 預設「Channel 設定」分頁為 active
    await expect(page.locator('#tab-channels')).toHaveAttribute('aria-selected', 'true')
    await expect(page.locator('#tab-history')).toHaveAttribute('aria-selected', 'false')
    await expect(page.locator('#panel-channels')).toBeVisible()
    // GET /notify/channels 已被呼叫
    expect(mocks.stats.channelsGet).toBeGreaterThanOrEqual(1)
  })

  test('E2E-02: 已有 Channel 顯示卡片列表（名稱 / 類型圖示 / 事件 / toggle）', async ({ page }) => {
    await setupPage(page, {
      channels: [
        makeChannel({ id: 'chn_001', name: '團隊 Slack', type: 'slack', events: ['failed'] }),
        makeChannel({ id: 'chn_002', name: '團隊 Discord', type: 'discord', events: ['started', 'stopped'] }),
      ],
    })
    await gotoNotifications(page)

    await expect(page.locator('.channel-card')).toHaveCount(2)
    await expect(page.locator('.channel-name', { hasText: '團隊 Slack' })).toBeVisible()
    await expect(page.locator('.channel-name', { hasText: '團隊 Discord' })).toBeVisible()
    // 類型圖示
    await expect(page.locator('.channel-card').filter({ hasText: '團隊 Slack' }).locator('.channel-type-icon')).toHaveText('#')
    await expect(page.locator('.channel-card').filter({ hasText: '團隊 Discord' }).locator('.channel-type-icon')).toHaveText('🎮')
    // 事件 chip + toggle 開關
    await expect(page.locator('.channel-card').filter({ hasText: '團隊 Slack' }).locator('.event-badge', { hasText: 'failed' })).toBeVisible()
    await expect(page.locator('.channel-card [data-testid="channel-toggle"]')).toHaveCount(2)
  })

  test('E2E-03: 無 Channel 顯示空狀態 + 新增按鈕', async ({ page }) => {
    await setupPage(page, { channels: [] })
    await gotoNotifications(page)

    await expect(page.getByText('尚未設定任何通知 Channel')).toBeVisible()
    await expect(page.locator('[data-testid="add-channel"]')).toBeVisible()
  })
})

// ── 新增 / 編輯 Channel ───────────────────────────────────────────

test.describe('Webhook 通知設定 — 新增 / 編輯 Channel', () => {
  test('E2E-04: 新增 Slack Channel（完整流程 + Toast + 列表重整）', async ({ page }) => {
    const mocks = await setupPage(page, { channels: [] })
    await gotoNotifications(page)

    await openCreateForm(page)
    await page.selectOption('[data-testid="channel-type"]', 'slack')
    await expect(page.locator('#channel-url')).toHaveAttribute('placeholder', /hooks\.slack\.com/)
    await page.fill('#channel-url', 'https://hooks.slack.com/services/T000/B000/XXXX')
    await page.fill('#channel-name', '團隊 Slack')
    await checkEvent(page, 'failed')
    await page.click('[data-testid="channel-save-footer"]')

    // POST 已送出且 body 正確
    expect(mocks.stats.post).toBe(1)
    expect(mocks.lastPostBody).toMatchObject({ type: 'slack', name: '團隊 Slack', events: ['failed'] })

    // Toast + 列表重整出現新卡片
    await expect(page.locator('#toast-container')).toContainText('Channel「團隊 Slack」已建立')
    await expect(page.locator('.channel-name', { hasText: '團隊 Slack' })).toBeVisible()
  })

  test('E2E-05: 類型切換動態欄位（Slack/Discord/Telegram/自訂）', async ({ page }) => {
    await setupPage(page, { channels: [] })
    await gotoNotifications(page)
    await openCreateForm(page)

    // Slack
    await page.selectOption('[data-testid="channel-type"]', 'slack')
    await expect(page.locator('#channel-url')).toHaveAttribute('placeholder', /hooks\.slack\.com/)

    // Discord
    await page.selectOption('[data-testid="channel-type"]', 'discord')
    await expect(page.locator('#channel-url')).toHaveAttribute('placeholder', /discord\.com\/api\/webhooks/)

    // Telegram：Bot Token + Chat ID，無 URL 欄位
    await page.selectOption('[data-testid="channel-type"]', 'telegram')
    await expect(page.locator('#channel-token')).toBeVisible()
    await expect(page.locator('#channel-chatid')).toBeVisible()
    await expect(page.locator('#channel-url')).toHaveCount(0)

    // 自訂 Webhook：URL + Method + Headers 編輯器
    await page.selectOption('[data-testid="channel-type"]', 'custom')
    await expect(page.locator('#channel-url')).toBeVisible()
    await expect(page.locator('#channel-method')).toBeVisible()
    await expect(page.locator('.headers-editor')).toBeVisible()
  })

  test('E2E-06: 新增 Telegram Channel（Bot Token + Chat ID）', async ({ page }) => {
    const mocks = await setupPage(page, { channels: [] })
    await gotoNotifications(page)
    await openCreateForm(page)

    await page.selectOption('[data-testid="channel-type"]', 'telegram')
    await page.fill('#channel-token', '123456789:AAbCdEfGhIjKlMnOpQrStUvWxYz123456')
    await page.fill('#channel-chatid', '123456789')
    await page.fill('#channel-name', 'TG 通知')
    await checkEvent(page, 'failed')
    await page.click('[data-testid="channel-save-footer"]')

    expect(mocks.lastPostBody).toMatchObject({ type: 'telegram', chat_id: '123456789' })
    await expect(page.locator('#toast-container')).toContainText('Channel「TG 通知」已建立')
    await expect(page.locator('.channel-name', { hasText: 'TG 通知' })).toBeVisible()
  })

  test('E2E-07: 新增自訂 Webhook Channel（Method PUT + Headers）', async ({ page }) => {
    const mocks = await setupPage(page, { channels: [] })
    await gotoNotifications(page)
    await openCreateForm(page)

    await page.selectOption('[data-testid="channel-type"]', 'custom')
    await page.fill('#channel-url', 'https://example.com/hook')
    await page.fill('#channel-name', '自訂 Hook')
    await page.selectOption('#channel-method', 'PUT')
    // 預設一列 header row，填入 key/value
    await page.locator('.header-row input[aria-label="Header 名稱"]').first().fill('X-Custom')
    await page.locator('.header-row input[aria-label="Header 值"]').first().fill('v1')
    await checkEvent(page, 'stopped')
    await page.click('[data-testid="channel-save-footer"]')

    expect(mocks.lastPostBody).toMatchObject({ type: 'custom', method: 'PUT' })
    expect(mocks.lastPostBody.headers).toMatchObject({ 'X-Custom': 'v1' })
    await expect(page.locator('#toast-container')).toContainText('Channel「自訂 Hook」已建立')
    await expect(page.locator('.channel-name', { hasText: '自訂 Hook' })).toBeVisible()
  })

  test('E2E-08: 必填欄位空白攔截（無 POST 請求）', async ({ page }) => {
    const mocks = await setupPage(page, { channels: [] })
    await gotoNotifications(page)
    await openCreateForm(page)

    // 不填任何欄位直接儲存
    await page.click('[data-testid="channel-save-footer"]')

    await expect(page.locator('#toast-container')).toContainText('請填寫必要欄位')
    expect(mocks.stats.post).toBe(0)
  })

  test('E2E-09: 未勾選觸發事件攔截（無 POST 請求）', async ({ page }) => {
    const mocks = await setupPage(page, { channels: [] })
    await gotoNotifications(page)
    await openCreateForm(page)

    await page.selectOption('[data-testid="channel-type"]', 'slack')
    await page.fill('#channel-url', 'https://hooks.slack.com/services/T000/B000/XXXX')
    await page.fill('#channel-name', '團隊 Slack')
    // 不勾事件
    await page.click('[data-testid="channel-save-footer"]')

    await expect(page.locator('#toast-container')).toContainText('請至少勾選一個觸發事件')
    expect(mocks.stats.post).toBe(0)
  })

  test('E2E-10: 編輯預填 + PUT 更新', async ({ page }) => {
    const mocks = await setupPage(page, {
      channels: [makeChannel({ id: 'chn_001', name: '團隊 Slack', url: 'https://hooks.slack.com/services/OLD' })],
    })
    await gotoNotifications(page)

    await page.click('[aria-label="編輯 團隊 Slack"]')
    // 預填
    await expect(page.locator('#channel-name')).toHaveValue('團隊 Slack')
    await expect(page.locator('#channel-url')).toHaveValue('https://hooks.slack.com/services/OLD')
    await expect(page.locator('[data-testid="channel-type"]')).toHaveValue('slack')

    await page.fill('#channel-name', '團隊 Slack 更新')
    await page.click('[data-testid="channel-save-footer"]')

    expect(mocks.stats.put).toBe(1)
    expect(mocks.lastPutBody).toMatchObject({ name: '團隊 Slack 更新' })
    await expect(page.locator('#toast-container')).toContainText('Channel 已更新')
    await expect(page.locator('.channel-name', { hasText: '團隊 Slack 更新' })).toBeVisible()
  })
})

// ── 開關 / 刪除 / 測試 ────────────────────────────────────────────

test.describe('Webhook 通知設定 — 開關 / 刪除 / 測試', () => {
  test('E2E-11: Toggle 樂觀更新（PATCH enabled=false + 卡片灰顯）', async ({ page }) => {
    const mocks = await setupPage(page, { channels: [makeChannel({ id: 'chn_001', enabled: true })] })
    await gotoNotifications(page)

    await page.locator('.channel-card .switch .slider').click()

    expect(mocks.stats.patch).toBe(1)
    expect(mocks.lastPatchBody).toEqual({ enabled: false })
    await expect(page.locator('.channel-card')).toHaveClass(/channel-disabled/)
    await expect(page.locator('.channel-card .disabled-label')).toHaveText('已停用')
    await expect(page.locator('[data-testid="channel-toggle"]')).toHaveAttribute('aria-checked', 'false')
  })

  test('E2E-12: Toggle 失敗回復原狀態 + Toast', async ({ page }) => {
    const mocks = await setupPage(page, { channels: [makeChannel({ id: 'chn_001', enabled: true })], failPatch: true })
    await gotoNotifications(page)

    await page.locator('.channel-card .switch .slider').click()

    expect(mocks.stats.patch).toBe(1)
    await expect(page.locator('#toast-container')).toContainText('無法更新 Channel 狀態')
    // 回復原狀態（仍啟用）
    await expect(page.locator('[data-testid="channel-toggle"]')).toHaveAttribute('aria-checked', 'true')
    await expect(page.locator('.channel-card .disabled-label')).toHaveCount(0)
  })

  test('E2E-13: 刪除確認框（文字 + 取消無變化）', async ({ page }) => {
    const mocks = await setupPage(page, { channels: [makeChannel({ id: 'chn_001', name: '團隊 Slack' })] })
    await gotoNotifications(page)

    await page.click('[aria-label="刪除 團隊 Slack"]')
    const modal = page.locator('.lms-modal')
    await expect(modal).toBeVisible()
    await expect(modal).toContainText('確定刪除 Channel「團隊 Slack」？此操作無法復原。')

    // 取消
    await modal.locator('.secondary').click()
    await expect(modal).not.toBeVisible()
    await expect(page.locator('.channel-card')).toHaveCount(1)
    expect(mocks.stats.delete).toBe(0)
  })

  test('E2E-14: 確認刪除後卡片移除 + Toast', async ({ page }) => {
    const mocks = await setupPage(page, { channels: [makeChannel({ id: 'chn_001', name: '團隊 Slack' })] })
    await gotoNotifications(page)

    await page.click('[aria-label="刪除 團隊 Slack"]')
    await page.locator('.lms-modal .btn-danger').click()

    expect(mocks.stats.delete).toBe(1)
    await expect(page.locator('#toast-container')).toContainText('Channel 已刪除')
    await expect(page.locator('.channel-card')).toHaveCount(0)
    await expect(page.getByText('尚未設定任何通知 Channel')).toBeVisible()
  })

  test('E2E-15: 測試按鈕 loading → 成功 Toast', async ({ page }) => {
    const mocks = await setupPage(page, {
      channels: [makeChannel({ id: 'chn_001', name: '團隊 Slack' })],
      testDelay: 800,
    })
    await gotoNotifications(page)

    await page.locator('[data-testid="channel-test"]').click()

    // loading spinner
    await expect(page.locator('[data-testid="channel-test"] .spinner')).toBeVisible()
    await expect(page.locator('[data-testid="channel-test"]')).toBeDisabled()

    expect(mocks.stats.test).toBe(1)
    await expect(page.locator('#toast-container')).toContainText('測試通知已發送 ✅')
    await expect(page.locator('[data-testid="channel-test"]')).toBeEnabled()
  })

  test('E2E-16: 測試失敗 Toast（具體原因）', async ({ page }) => {
    const mocks = await setupPage(page, {
      channels: [makeChannel({ id: 'chn_001', name: '團隊 Slack' })],
      testResult: { success: false, error: '403 Forbidden', detail: '目標平台回覆異常' },
    })
    await gotoNotifications(page)

    await page.locator('[data-testid="channel-test"]').click()

    expect(mocks.stats.test).toBe(1)
    await expect(page.locator('#toast-container')).toContainText('測試失敗 ❌')
    await expect(page.locator('#toast-container')).toContainText('403 Forbidden')
  })
})

// ── 發送紀錄 ──────────────────────────────────────────────────────

test.describe('Webhook 通知設定 — 發送紀錄', () => {
  async function gotoHistory(page: Page) {
    await gotoNotifications(page)
    await page.click('#tab-history')
    await expect(page.locator('[data-testid="history-channel-filter"]')).toBeVisible()
  }

  test('E2E-17: 表格欄位 + 時間倒序 + 成功綠/失敗紅', async ({ page }) => {
    await setupPage(page, {
      channels: [makeChannel({ id: 'chn_001', name: '團隊 Slack' }), makeChannel({ id: 'chn_002', name: '團隊 Discord', type: 'discord' })],
      history: [
        makeHistory({ timestamp: '2026-08-13T10:00:00Z', channel_id: 'chn_001', channel_name: '團隊 Slack', event: 'failed', service: 'nginx.service', status: 'failure', error: '連線逾時', duration_ms: 120 }),
        makeHistory({ timestamp: '2026-08-13T09:00:00Z', channel_id: 'chn_001', channel_name: '團隊 Slack', event: 'started', service: 'nginx.service', status: 'success', duration_ms: 90 }),
        makeHistory({ timestamp: '2026-08-13T08:00:00Z', channel_id: 'chn_002', channel_name: '團隊 Discord', event: 'stopped', service: 'myapp.service', status: 'success', duration_ms: 80 }),
      ],
    })
    await gotoHistory(page)

    // 表頭欄位
    const thead = page.locator('.history-table thead')
    await expect(thead).toContainText('時間')
    await expect(thead).toContainText('Channel')
    await expect(thead).toContainText('觸發事件')
    await expect(thead).toContainText('目標服務')
    await expect(thead).toContainText('發送結果')
    await expect(thead).toContainText('錯誤訊息')

    // 時間倒序：最新一筆在最上（10:00 failure）
    const firstRow = page.locator('.history-table tbody tr').first()
    await expect(firstRow).toContainText('failed')
    await expect(firstRow).toContainText('連線逾時')

    // 成功綠 / 失敗紅
    await expect(page.locator('.result-success')).toHaveCount(2)
    await expect(page.locator('.result-failure')).toHaveCount(1)
  })

  test('E2E-18: Channel 下拉篩選', async ({ page }) => {
    const mocks = await setupPage(page, {
      channels: [makeChannel({ id: 'chn_001', name: '團隊 Slack' }), makeChannel({ id: 'chn_002', name: '團隊 Discord', type: 'discord' })],
      history: [
        makeHistory({ timestamp: '2026-08-13T10:00:00Z', channel_id: 'chn_001', channel_name: '團隊 Slack' }),
        makeHistory({ timestamp: '2026-08-13T09:00:00Z', channel_id: 'chn_002', channel_name: '團隊 Discord' }),
      ],
    })
    await gotoHistory(page)
    await expect(page.locator('.history-table tbody tr')).toHaveCount(2)

    await page.selectOption('[data-testid="history-channel-filter"]', 'chn_001')
    await expect(page.locator('.history-table tbody tr')).toHaveCount(1)
    await expect(page.locator('.history-table tbody')).toContainText('團隊 Slack')
    await expect(page.locator('.history-table tbody')).not.toContainText('團隊 Discord')
    expect(mocks.stats.history).toBeGreaterThanOrEqual(2)
  })

  test('E2E-19: 結果篩選（全部 / 成功 / 失敗）', async ({ page }) => {
    await setupPage(page, {
      channels: [makeChannel({ id: 'chn_001', name: '團隊 Slack' })],
      history: [
        makeHistory({ timestamp: '2026-08-13T10:00:00Z', event: 'failed', status: 'failure', error: '連線逾時' }),
        makeHistory({ timestamp: '2026-08-13T09:00:00Z', event: 'started', status: 'success' }),
        makeHistory({ timestamp: '2026-08-13T08:00:00Z', event: 'stopped', status: 'success' }),
      ],
    })
    await gotoHistory(page)

    // 全部
    await expect(page.locator('.history-table tbody tr')).toHaveCount(3)

    // 成功
    await page.selectOption('[data-testid="history-status-filter"]', 'success')
    await expect(page.locator('.history-table tbody tr')).toHaveCount(2)
    await expect(page.locator('.result-success')).toHaveCount(2)
    await expect(page.locator('.result-failure')).toHaveCount(0)

    // 失敗
    await page.selectOption('[data-testid="history-status-filter"]', 'failure')
    await expect(page.locator('.history-table tbody tr')).toHaveCount(1)
    await expect(page.locator('.result-failure')).toHaveCount(1)
  })

  test('E2E-20: 分頁下一頁', async ({ page }) => {
    const history45: MockHistoryEntry[] = Array.from({ length: 45 }, (_, i) => ({
      timestamp: new Date(Date.UTC(2026, 7, 13, 12, 0, 45 - i)).toISOString(),
      channel_id: 'chn_001',
      channel_name: '團隊 Slack',
      channel_type: 'slack',
      event: i % 2 === 0 ? 'failed' : 'started',
      service: 'nginx.service',
      status: i % 3 === 0 ? 'failure' : 'success',
      error: i % 3 === 0 ? '連線逾時' : undefined,
      duration_ms: 120 + i,
    }))
    await setupPage(page, { channels: [makeChannel({ id: 'chn_001', name: '團隊 Slack' })], history: history45 })
    await gotoHistory(page)

    await expect(page.locator('.history-table tbody tr')).toHaveCount(30)
    await expect(page.locator('.history-pager .pager-info')).toContainText('第 1 / 2 頁')

    await page.click('[data-testid="history-next"]')
    await expect(page.locator('.history-table tbody tr')).toHaveCount(15)
    await expect(page.locator('.history-pager .pager-info')).toContainText('第 2 / 2 頁')
    await expect(page.locator('[data-testid="history-next"]')).toBeDisabled()
  })

  test('E2E-21: 無紀錄空狀態「尚無通知發送紀錄」', async ({ page }) => {
    await setupPage(page, { channels: [], history: [] })
    await gotoHistory(page)

    await expect(page.getByText('尚無通知發送紀錄')).toBeVisible()
  })
})

// ── 自動停用補償 ──────────────────────────────────────────────────

test.describe('Webhook 通知設定 — 自動停用補償', () => {
  test('E2E-22: 載入含 enabled=false + auto_disabled_reason 顯示黃色警告 + Toast', async ({ page }) => {
    await setupPage(page, {
      channels: [makeChannel({ id: 'chn_001', name: '故障 Slack', enabled: false, auto_disabled_reason: '連續失敗 10 次自動停用' })],
    })
    await gotoNotifications(page)

    // 卡片黃色警示徽章 + 已停用標籤 + 灰顯
    const card = page.locator('.channel-card').filter({ hasText: '故障 Slack' })
    await expect(card).toHaveClass(/channel-disabled/)
    await expect(card.locator('.auto-disabled-badge')).toBeVisible()
    await expect(card.locator('.auto-disabled-badge')).toHaveAttribute('title', '因連續失敗已自動停用')
    await expect(card.locator('.disabled-label')).toHaveText('已停用')

    // 補償 Toast
    await expect(page.locator('#toast-container')).toContainText('因連續失敗已自動停用')
  })
})
