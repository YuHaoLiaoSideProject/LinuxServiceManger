import { test, expect, type Page } from '@playwright/test'
import { setupApiMocks, gotoDashboard } from './auth.setup'

/**
 * 015 — Audit Log 搜尋框「輸入到一半暫停」E2E 回歸測試
 *
 * 使用者回報情境：
 *   在稽核紀錄搜尋框輸入到一半停下來 →
 *   debounce(300ms) 觸發 API 呼叫 → loading=true 期間
 *   畫面整區被替換成 spinner（閃一下）＋ 搜尋框被 disabled（失焦）→
 *   導致無法繼續輸入。
 *
 * 期望行為（本檔案要守住的行為）：
 *   - API 進行中：搜尋框保持 enabled、保有焦點、值不變
 *   - API 進行中：表格保持可見（不替換成 spinner、畫面不閃爍）
 *   - 暫停後可「不重新點擊」直接繼續輸入，完整關鍵字照常送出並更新表格
 *   - 較晚回應的舊請求不得覆蓋較新的搜尋結果（out-of-order 防護）
 */

// ── Mock data ─────────────────────────────────────────────────────────────

const AUDIT_ENTRIES = {
  total: 5,
  page: 1,
  limit: 50,
  data: [
    { timestamp: '2025-08-09T14:30:00Z', username: 'admin',   source_ip: '10.0.0.1',     action: 'start',   target: 'nginx.service', result: 'success', detail: '' },
    { timestamp: '2025-08-09T13:00:00Z', username: 'operator', source_ip: '192.168.1.50', action: 'restart', target: 'ssh.service',    result: 'failure', detail: 'permission denied' },
    { timestamp: '2025-08-09T12:30:00Z', username: 'admin',   source_ip: '10.0.0.1',     action: 'stop',    target: 'nginx.service', result: 'success', detail: '' },
    { timestamp: '2025-08-09T11:00:00Z', username: 'admin',   source_ip: '10.0.0.1',     action: 'login',   target: '-',             result: 'success', detail: '' },
    { timestamp: '2025-08-09T10:30:00Z', username: 'admin',   source_ip: '10.0.0.1',     action: 'enable',  target: 'nginx.service', result: 'success', detail: '' },
  ],
}

/** search=ngi 結果（3 筆 nginx 紀錄） */
const AUDIT_NGINX = {
  total: 3, page: 1, limit: 50,
  data: AUDIT_ENTRIES.data.filter((e: any) => e.target.includes('nginx')),
}

/** search=nginx 結果（刻意只有 1 筆，用於區分「較新結果」） */
const AUDIT_NGINX_ONE = {
  total: 1, page: 1, limit: 50,
  data: [AUDIT_ENTRIES.data[0]],
}

// ── Mock setup（支援延遲回應）─────────────────────────────────────────────

interface AuditMockOptions {
  /** 預設回傳資料（無 search 參數時） */
  data?: any
  /** 所有 audit 請求的統一回應延遲（ms） */
  delayMs?: number
  /** 依 search 關鍵字覆寫回傳資料 */
  bySearch?: Record<string, any>
  /** 依 search 關鍵字個別延遲（ms），覆寫 delayMs */
  delayBySearch?: Record<string, number>
}

async function setupAuditMocks(page: Page, opts: AuditMockOptions = {}) {
  const data = opts.data ?? AUDIT_ENTRIES
  await page.route('**/api/v1/audit?*', async (route) => {
    const url = new URL(route.request().url())
    const search = url.searchParams.get('search') || ''
    const pageParam = parseInt(url.searchParams.get('page') || '1')

    let body: any = data
    if (opts.bySearch?.[search]) {
      body = opts.bySearch[search]
    } else if (search) {
      // 簡易模擬後端：比對 target 欄位
      const filtered = data.data.filter((e: any) =>
        String(e.target).toLowerCase().includes(search.toLowerCase()),
      )
      body = { ...data, data: filtered, total: filtered.length }
    }
    body = { ...body, page: pageParam }

    const delay = opts.delayBySearch?.[search] ?? opts.delayMs ?? 0
    if (delay > 0) await new Promise((r) => setTimeout(r, delay))

    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })
}

// ── Selectors / helpers ───────────────────────────────────────────────────

const auditLink = (page: Page) => page.locator('[data-testid="nav-audit"]')
const searchInput = (page: Page) => page.locator('.search-box input')
const auditRows = (page: Page) => page.locator('main.app-container tbody tr')
const condRow = (page: Page) => page.locator('.audit-toolbar .cond-row')

const isAuditSearchReq = (r: { url(): string }, search: string) => {
  const u = new URL(r.url())
  return u.pathname.endsWith('/api/v1/audit') && u.searchParams.get('search') === search
}

async function goAudit(page: Page) {
  await gotoDashboard(page)
  await auditLink(page).click()
  await page.waitForURL('**/audit')
  await expect(auditRows(page).first()).toBeVisible()
}

// ═══════════════════════════════════════════════════════════════════════════
// E2E-20: 輸入到一半暫停 → 搜尋框保持可用/焦點 → 可繼續輸入
// ═══════════════════════════════════════════════════════════════════════════

test.describe('E2E-20~22: 搜尋輸入中斷回歸（flash + 失焦）', () => {
  test('E2E-20: API 進行中搜尋框保持 enabled＋focus＋值不變，可繼續輸入完整關鍵字', async ({ page }) => {
    await setupApiMocks(page, { authenticated: true })
    // 延遲回應 → 讓「請求進行中（loading）」狀態可被觀察
    await setupAuditMocks(page, { delayMs: 800 })
    await goAudit(page)
    await expect(auditRows(page)).toHaveCount(5)

    const input = searchInput(page)
    await input.focus()
    await input.pressSequentially('ngi')

    // debounce(300ms) 後送出第一個請求（search=ngi）
    const req1 = page.waitForRequest((r) => isAuditSearchReq(r, 'ngi'))
    await req1

    // ⚠️ 此處 loading=true（請求尚未回應）
    // Bug 重現：目前程式碼會把搜尋框 disabled → 失焦 → 無法繼續輸入
    await expect(input).toBeEnabled()
    await expect(input).toBeFocused()
    await expect(input).toHaveValue('ngi')

    // 不重新點擊搜尋框，模擬使用者直接繼續打字
    await page.keyboard.type('nx')
    await expect(input).toHaveValue('nginx')

    // 完整關鍵字照常送出並更新表格
    const resp2 = page.waitForResponse((r) => isAuditSearchReq(r, 'nginx'))
    await resp2
    await expect(auditRows(page)).toHaveCount(3)
    await expect(condRow(page)).toContainText('3')
  })

  test('E2E-21: API 進行中表格保持可見（不被 spinner 取代、畫面不閃爍）', async ({ page }) => {
    await setupApiMocks(page, { authenticated: true })
    await setupAuditMocks(page, { delayMs: 800 })
    await goAudit(page)
    await expect(auditRows(page)).toHaveCount(5)

    const req1 = page.waitForRequest((r) => isAuditSearchReq(r, 'nginx'))
    const resp1 = page.waitForResponse((r) => isAuditSearchReq(r, 'nginx'))
    await searchInput(page).fill('nginx')
    await req1

    // ⚠️ loading=true 期間的「快照檢查」：表格必須仍在 DOM 且可見
    // （閃爍 = v-if=loading 把整個表格區替換成 spinner）
    // 用 point-in-time snapshot，避免 polling assertion 等到回應回來才通過
    await page.waitForTimeout(50) // 給 Vue 一個 tick 套用 loading 狀態
    const snap = await page.evaluate(() => {
      const table = document.querySelector('main.app-container .table-wrapper table')
      const sp = document.querySelector('.spinner-sm')
      return {
        tableInDom: !!table,
        tableVisible: table ? (table as HTMLElement).getClientRects().length > 0 : false,
        spinnerInDom: !!sp,
      }
    })
    expect(snap.tableInDom, 'loading 中表格不應從 DOM 移除（畫面閃爍）').toBe(true)
    expect(snap.tableVisible, 'loading 中表格應保持可見').toBe(true)
    expect(snap.spinnerInDom, 'loading 中不應顯示全區 spinner').toBe(false)

    // 回應後表格更新為搜尋結果
    await resp1
    await expect(auditRows(page)).toHaveCount(3)
    await expect(condRow(page)).toContainText('3')
  })

  test('E2E-22: 較晚回應的舊請求不得覆蓋較新的搜尋結果（out-of-order 防護）', async ({ page }) => {
    await setupApiMocks(page, { authenticated: true })
    await setupAuditMocks(page, {
      // search=ngi（舊請求）回應慢 1200ms；search=nginx（新請求）回應快 50ms
      bySearch: { ngi: AUDIT_NGINX, nginx: AUDIT_NGINX_ONE },
      delayBySearch: { ngi: 1200, nginx: 50 },
    })
    await goAudit(page)
    await expect(auditRows(page)).toHaveCount(5)

    const input = searchInput(page)
    await input.focus()

    // 第一個請求：search=ngi（慢）
    const req1 = page.waitForRequest((r) => isAuditSearchReq(r, 'ngi'))
    const resp1 = page.waitForResponse((r) => isAuditSearchReq(r, 'ngi'))
    await input.pressSequentially('ngi')
    await req1

    // 請求 1 還在飛時，搜尋框必須仍可用 → 繼續輸入（search=nginx）
    await expect(input).toBeEnabled()
    await expect(input).toBeFocused()

    const req2 = page.waitForRequest((r) => isAuditSearchReq(r, 'nginx'))
    const resp2 = page.waitForResponse((r) => isAuditSearchReq(r, 'nginx'))
    await page.keyboard.type('nx')
    await req2
    await resp2

    // 新結果（1 筆）先套用
    await expect(auditRows(page)).toHaveCount(1)
    await expect(condRow(page)).toContainText('1')

    // 等舊請求（較晚回應）也結束 —— 不得覆蓋新結果
    await resp1
    await expect(auditRows(page)).toHaveCount(1)
    await expect(condRow(page)).toContainText('1')
  })
})
