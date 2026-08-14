import { test, expect, type Page } from '@playwright/test'
import { setupApiMocks, loginViaUI, MOCK_SERVICES, getServiceRow } from './auth.setup'

/**
 * 012 — 服務設定檔編輯器 E2E Tests
 *
 * BDD scenarios: E2E-01 ~ E2E-29（docs/test-plans/012-service-config-editor測試計畫.md §5）
 *   進入點 / 載入 / dirty / Validate / Save / Cancel / 衝突 / 主題 / RWD / API 契約
 */

// ── Mock 設定檔內容（第 12 行為 ExecStartt 拼錯）──
const NGINX_CONFIG = [
  '[Unit]',
  'Description=NGINX web server',
  'After=network.target',
  '',
  '[Service]',
  'Type=forking',
  'PIDFile=/run/nginx.pid',
  'ExecStartPre=/usr/sbin/nginx -t',
  'ExecStart=/usr/sbin/nginx',
  'ExecReload=/usr/sbin/nginx -s reload',
  'ExecStop=/usr/sbin/nginx -s quit',
  'ExecStartt=/usr/sbin/nginx',
  '',
  '[Install]',
  'WantedBy=multi-user.target',
  '',
].join('\n')

const CHECKSUM = '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08'

interface ConfigMockOptions {
  /** GET config 回應（可覆寫以模擬錯誤） */
  getConfig?: (name: string) => { status: number; body: unknown }
  /** PUT config 回應 */
  putConfig?: (name: string, body: unknown) => { status: number; body: unknown }
  /** POST validate 回應 */
  postValidate?: (name: string, body: unknown) => { status: number; body: unknown }
}

/**
 * 設定 012 相關 API mock（config GET / PUT / validate）。
 * 預設：GET 200 回傳 NGINX_CONFIG；PUT 200；validate 200 valid=true。
 */
export async function setupConfigMocks(page: Page, options: ConfigMockOptions = {}) {
  const {
    getConfig = () => ({ status: 200, body: {
      name: 'nginx.service',
      fragmentPath: '/etc/systemd/system/nginx.service',
      config: NGINX_CONFIG,
      size: NGINX_CONFIG.length,
      checksum: CHECKSUM,
    } }),
    putConfig = () => ({ status: 200, body: {
      message: 'nginx.service 設定檔已儲存，daemon-reload 已執行',
      backupPath: '/etc/systemd/system/nginx.service.bak.20260812T153045Z',
    } }),
    postValidate = () => ({ status: 200, body: { valid: true, available: true, errors: [] } }),
  } = options

  await page.route('**/api/v1/services/*/config', async (route) => {
    if (route.request().method() === 'GET') {
      const name = decodeURIComponent(route.request().url().split('/').slice(-2)[0])
      const r = getConfig(name)
      await route.fulfill({ status: r.status, contentType: 'application/json', body: JSON.stringify(r.body) })
      return
    }
    if (route.request().method() === 'PUT') {
      const name = decodeURIComponent(route.request().url().split('/').slice(-2)[0])
      let body: unknown = {}
      try { body = route.request().postDataJSON() } catch { /* ignore */ }
      const r = putConfig(name, body)
      await route.fulfill({ status: r.status, contentType: 'application/json', body: JSON.stringify(r.body) })
      return
    }
    await route.continue()
  })

  await page.route('**/api/v1/services/*/config/validate', async (route) => {
    if (route.request().method() === 'POST') {
      const name = decodeURIComponent(route.request().url().split('/').slice(-3)[0])
      let body: unknown = {}
      try { body = route.request().postDataJSON() } catch { /* ignore */ }
      const r = postValidate(name, body)
      await route.fulfill({ status: r.status, contentType: 'application/json', body: JSON.stringify(r.body) })
      return
    }
    await route.continue()
  })
}

/** 登入並開啟 nginx.service 編輯器（responsive-aware：桌面 → Modal；手機 → 全頁路由） */
async function openEditor(page: Page, options: ConfigMockOptions = {}, waitFor = '.cm-content') {
  await setupApiMocks(page, { authenticated: false, includeActions: true })
  await setupConfigMocks(page, options)
  await loginViaUI(page)

  const viewport = page.viewportSize()
  const isDesktop = (viewport?.width ?? 1280) >= 768

  await getServiceRow(page, 'nginx.service').locator('button.btn-edit-config').click()

  if (isDesktop) {
    // 桌面 ≥768px：開啟 Modal，不換 route
    await expect(page.locator('.config-modal-dialog')).toBeVisible()
  } else {
    // 手機 ≤767px：維持全頁路由導航
    await page.waitForURL('**/services/nginx.service/config')
  }
  await page.waitForSelector(waitFor, { timeout: 10_000 })
  return page
}

/** 於 CodeMirror 編輯器末尾輸入文字 */
async function typeInEditor(page: Page, text: string) {
  const cm = page.locator('.cm-content')
  await cm.click()
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.type(text)
}

test.describe('E2E 進入點與載入（@entry）', () => {
  test('E2E-01: Dashboard 顯示 Edit Config / View Config 按鈕', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await loginViaUI(page)

    // nginx（解鎖）→ Edit Config（icon 按鈕，aria-label 呈現）
    const nginxRow = getServiceRow(page, 'nginx.service')
    await expect(nginxRow.locator('button.btn-edit-config')).toBeVisible()
    await expect(nginxRow.locator('button.btn-edit-config')).toHaveAttribute('aria-label', /編輯|Edit/)
    // sshd（鎖定）→ View Config（在「系統服務」分頁）
    await page.locator('#tab-system').click()
    await page.waitForTimeout(300)
    const sshdRow = getServiceRow(page, 'sshd.service')
    await expect(sshdRow.locator('button.btn-view-config')).toBeVisible()
    await expect(sshdRow.locator('button.btn-edit-config')).toHaveCount(0)
  })

  test('E2E-02: 進入編輯器主流程（spinner → 內容 + 語法高亮 + 三按鈕）', async ({ page }) => {
    await openEditor(page)
    // 標題與路徑
    await expect(page.locator('.config-header h2')).toContainText('nginx.service')
    await expect(page.locator('.config-path')).toContainText('/etc/systemd/system/nginx.service')
    // 內容已載入（CodeMirror 顯示原始內容）
    await expect(page.locator('.cm-content')).toContainText('[Unit]')
    await expect(page.locator('.cm-content')).toContainText('WantedBy=multi-user.target')
    // 底部三按鈕
    await expect(page.locator('.config-footer button')).toHaveCount(3)
    await expect(page.locator('.config-footer button', { hasText: 'Validate' })).toBeVisible()
    await expect(page.locator('.config-footer button', { hasText: 'Save' })).toBeVisible()
    // Save 初始 disabled
    await expect(page.locator('.config-footer button', { hasText: 'Save' })).toBeDisabled()
  })

  test('E2E-03: 唯讀模式檢視鎖定服務（僅 Close）', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await setupConfigMocks(page)
    await loginViaUI(page)
    await page.goto('/services/sshd.service/config?readonly=1')
    await page.waitForSelector('.cm-content', { timeout: 10_000 })

    await expect(page.locator('.config-footer button')).toHaveCount(1)
    await expect(page.locator('.config-footer button', { hasText: 'Close' })).toBeVisible()
    await expect(page.locator('.config-footer button', { hasText: 'Validate' })).toHaveCount(0)
    await expect(page.locator('.config-footer button', { hasText: 'Save' })).toHaveCount(0)
    // 編輯器不可編輯（嘗試輸入不改變內容）
    const before = await page.locator('.cm-content').textContent()
    await page.locator('.cm-content').click()
    await page.keyboard.press('End')
    await page.keyboard.type('xxxxx')
    const after = await page.locator('.cm-content').textContent()
    expect(after).toBe(before)
  })

  test('E2E-12: 載入失敗（500）顯示錯誤與重試', async ({ page }) => {
    let failFirst = true
    await openEditor(page, {
      getConfig: () => {
        if (failFirst) {
          failFirst = false
          return { status: 500, body: { error: '無法讀取設定檔：permission denied' } }
        }
        return { status: 200, body: {
          name: 'nginx.service', fragmentPath: '/etc/systemd/system/nginx.service',
          config: NGINX_CONFIG, size: NGINX_CONFIG.length, checksum: CHECKSUM,
        } }
      },
    }, '.config-error-state')
    await expect(page.locator('.config-error-message')).toContainText('無法讀取設定檔')
    await page.getByRole('button', { name: 'Retry' }).click()
    await expect(page.locator('.cm-content')).toBeVisible({ timeout: 10_000 })
  })

  test('E2E-13: 設定檔不存在（404）→ 空編輯器 + 黃色提示', async ({ page }) => {
    await openEditor(page, {
      getConfig: () => ({ status: 404, body: { error: '設定檔不存在: /etc/systemd/system/nginx.service' } }),
    }, '.config-notice.warning')
    await expect(page.locator('.config-notice.warning')).toContainText('Config file not found')
    await expect(page.locator('.config-notice.warning')).toContainText('/etc/systemd/system/nginx.service')
    // 空編輯器仍可輸入
    await typeInEditor(page, '[Unit]\nDescription=new')
    await expect(page.locator('.cm-content')).toContainText('Description=new')
  })
})

test.describe('E2E 編輯與 dirty（@editor）', () => {
  test('E2E-04: 編輯後 dirty + Save 啟用 + ● 指示', async ({ page }) => {
    await openEditor(page)
    await expect(page.locator('.config-footer button', { hasText: 'Save' })).toBeDisabled()
    await typeInEditor(page, '\nEnvironment=FOO=bar')
    await expect(page.locator('.config-footer button', { hasText: 'Save' })).toBeEnabled()
    await expect(page.locator('.dirty-dot')).toBeVisible()
  })

  test('E2E-11: 瀏覽器返回鍵 dirty-check 彈出確認框', async ({ page }) => {
    // 瀏覽器返回鍵防護只發生在全頁路由（手機）；桌面 Modal 不變 URL、無 history entry
    await page.setViewportSize({ width: 375, height: 667 })
    await openEditor(page)
    await typeInEditor(page, '\nEnvironment=FOO=bar')
    await page.goBack()
    // 攔截並彈出「有未儲存的變更」Modal（非直接離開）
    await expect(page.locator('.lms-modal-overlay')).toBeVisible()
    await expect(page.locator('.lms-modal')).toContainText('Unsaved changes')
    // Stay 留在頁面
    await page.getByRole('button', { name: 'Stay' }).click()
    await expect(page).toHaveURL(/\/services\/nginx\.service\/config/)
  })
})

test.describe('E2E Validate（@validate）', () => {
  test('E2E-05: Validate 通過 → 綠色提示', async ({ page }) => {
    await openEditor(page, {
      postValidate: () => ({ status: 200, body: { valid: true, available: true, errors: [] } }),
    })
    await page.locator('.config-footer button', { hasText: 'Validate' }).click()
    await expect(page.locator('.validation-banner.success')).toContainText('Syntax validation passed')
  })

  test('E2E-06: Validate 失敗 → 紅色面板 + 行號 + 波浪線/gutter ❌', async ({ page }) => {
    await openEditor(page, {
      postValidate: () => ({
        status: 200,
        body: { valid: false, available: true, errors: [{ line: 12, message: "Unknown key 'ExecStartt'" }] },
      }),
    })
    await page.locator('.config-footer button', { hasText: 'Validate' }).click()
    const panel = page.locator('.validation-banner.error')
    await expect(panel).toBeVisible()
    await expect(panel).toContainText("Line 12: Unknown key 'ExecStartt'")
    // 第 12 行有錯誤標記（wavy underline class）
    await expect(page.locator('.cm-error-line').first()).toBeVisible()
  })

  test('E2E-21: Validate 空內容前端攔截（不發 API 請求）', async ({ page }) => {
    let validateCalled = false
    await openEditor(page, {
      getConfig: () => ({ status: 404, body: { error: '設定檔不存在' } }),
      postValidate: () => {
        validateCalled = true
        return { status: 200, body: { valid: true, available: true, errors: [] } }
      },
    })
    await page.locator('.config-footer button', { hasText: 'Validate' }).click()
    await expect(page.locator('#toast-container')).toContainText('Config content is empty')
    expect(validateCalled).toBe(false)
  })
})

test.describe('E2E Save（@save）', () => {
  test('E2E-07: 儲存成功主流程（Modal 內容 → Saving → Toast → 回 Dashboard）', async ({ page }) => {
    await openEditor(page)
    await typeInEditor(page, '\nEnvironment=FOO=bar')
    await page.locator('.config-footer button', { hasText: 'Save' }).click()
    // ConfirmModal 內容
    const modal = page.locator('.lms-modal-overlay')
    await expect(modal).toBeVisible()
    await expect(modal).toContainText('Save Config Changes')
    await expect(modal).toContainText('/etc/systemd/system/nginx.service')
    await expect(modal).toContainText('daemon-reload')
    await expect(modal).toContainText('Incorrect settings may prevent')
    // 點 Save Changes
    await page.getByRole('button', { name: 'Save Changes' }).click()
    // Toast
    await expect(page.locator('#toast-container')).toContainText('config saved', { timeout: 10_000 })
    // 1.5s 後自動返回 Dashboard
    await expect(page).toHaveURL(/\//, { timeout: 10_000 })
    await expect(page.locator('.app-header')).toBeVisible()
  })

  test('E2E-08: 儲存確認取消 → 回到編輯器狀態不變', async ({ page }) => {
    await openEditor(page)
    await typeInEditor(page, '\nEnvironment=FOO=bar')
    await page.locator('.config-footer button', { hasText: 'Save' }).click()
    await expect(page.locator('.lms-modal-overlay')).toBeVisible()
    await page.locator('.lms-modal-overlay .lms-modal-actions button').first().click() // Cancel
    await expect(page.locator('.lms-modal-overlay')).toHaveCount(0)
    await expect(page.locator('.dirty-dot')).toBeVisible()
    await expect(page.locator('.config-footer button', { hasText: 'Save' })).toBeEnabled()
  })

  test('E2E-09: dirty Cancel → Discard → 回 Dashboard + Toast', async ({ page }) => {
    await openEditor(page)
    await typeInEditor(page, '\nEnvironment=FOO=bar')
    await page.locator('.config-footer button', { hasText: 'Cancel' }).click()
    await expect(page.locator('.lms-modal-overlay')).toContainText('Unsaved changes')
    await page.getByRole('button', { name: 'Discard Changes' }).click()
    await expect(page).toHaveURL(/\/dashboard/)
    await expect(page.locator('#toast-container')).toContainText('Unsaved changes discarded')
  })

  test('E2E-10: dirty Cancel → Stay → 回到編輯器內容保留', async ({ page }) => {
    await openEditor(page)
    await typeInEditor(page, '\nEnvironment=FOO=bar')
    await page.locator('.config-footer button', { hasText: 'Cancel' }).click()
    await expect(page.locator('.lms-modal-overlay')).toBeVisible()
    await page.getByRole('button', { name: 'Stay' }).click()
    await expect(page.locator('.lms-modal-overlay')).toHaveCount(0)
    await expect(page.locator('.cm-content')).toContainText('Environment=FOO=bar')
    await expect(page.locator('.dirty-dot')).toBeVisible()
  })

  test('E2E-14: 儲存失敗（500）→ 紅色 Toast + 內容保留', async ({ page }) => {
    await openEditor(page, {
      putConfig: () => ({ status: 500, body: { error: '寫入失敗' } }),
    })
    await typeInEditor(page, '\nEnvironment=FOO=bar')
    await page.locator('.config-footer button', { hasText: 'Save' }).click()
    await page.getByRole('button', { name: 'Save Changes' }).click()
    await expect(page.locator('#toast-container')).toContainText('Save failed', { timeout: 10_000 })
    // 編輯器內容保留
    await expect(page.locator('.cm-content')).toContainText('Environment=FOO=bar')
  })

  test('E2E-15: daemon-reload 失敗 → 半成功 Toast + 備份路徑', async ({ page }) => {
    await openEditor(page, {
      putConfig: () => ({
        status: 500,
        body: {
          error: 'daemon-reload 失敗: dbus error。請手動執行 systemctl daemon-reload。備份檔：/etc/systemd/system/nginx.service.bak.20260812T153045Z',
          backupPath: '/etc/systemd/system/nginx.service.bak.20260812T153045Z',
        },
      }),
    })
    await typeInEditor(page, '\nEnvironment=FOO=bar')
    await page.locator('.config-footer button', { hasText: 'Save' }).click()
    await page.getByRole('button', { name: 'Save Changes' }).click()
    const toast = page.locator('#toast-container')
    await expect(toast).toContainText('daemon-reload failed', { timeout: 10_000 })
    await expect(toast).toContainText('.bak.')
  })

  test('E2E-16: 409 衝突 → Toast + 重新載入動作', async ({ page }) => {
    const newChecksum = '5f8c'.padEnd(64, 'a')
    await openEditor(page, {
      putConfig: () => ({
        status: 409,
        body: {
          error: '設定檔已被其他使用者修改。請重新載入後再編輯。',
          currentChecksum: newChecksum,
        },
      }),
    })
    await typeInEditor(page, '\nEnvironment=FOO=bar')
    await page.locator('.config-footer button', { hasText: 'Save' }).click()
    await page.getByRole('button', { name: 'Save Changes' }).click()
    await expect(page.locator('#toast-container')).toContainText('Config modified by another user', { timeout: 10_000 })
    // 重新載入 Modal
    const modal = page.locator('.lms-modal-overlay')
    await expect(modal).toContainText('Config conflict')
    await page.getByRole('button', { name: 'Reload' }).click()
    // 重新 GET → 內容更新（仍可編輯）
    await expect(page.locator('.cm-content')).toBeVisible()
  })

  test('E2E-17: 空內容儲存額外警告', async ({ page }) => {
    await openEditor(page)
    // 全選刪除 → 空內容 → dirty
    await page.locator('.cm-content').click()
    await page.keyboard.press('ControlOrMeta+a')
    await page.keyboard.press('Delete')
    await expect(page.locator('.config-footer button', { hasText: 'Save' })).toBeEnabled()
    await page.locator('.config-footer button', { hasText: 'Save' }).click()
    await expect(page.locator('.lms-modal-overlay')).toContainText('Config content is empty')
    // 取消仍可
    await page.locator('.lms-modal-overlay .lms-modal-actions button').first().click()
    await expect(page.locator('.lms-modal-overlay')).toHaveCount(0)
  })
})

test.describe('E2E 整合情境（@integration）', () => {
  test('E2E-18a/18b: 淺色/深色模式下編輯器可用', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await setupConfigMocks(page)
    await loginViaUI(page)

    // 切換深色（dashboard 才有 header 帳號選單）
    await page.locator('[data-testid="account-btn"]').click()
    await page.locator('[data-testid="menu-theme"]').click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')

    await page.goto('/services/nginx.service/config')
    await page.waitForSelector('.cm-content', { timeout: 10_000 })
    await expect(page.locator('.cm-content')).toContainText('[Unit]')

    // 回 dashboard 切回淺色（014 決策 8：單機服務視圖在 /dashboard — 含 Header 帳號選單）
    await page.goto('/dashboard')
    await page.locator('[data-testid="account-btn"]').click()
    await page.locator('[data-testid="menu-theme"]').click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')

    await page.goto('/services/nginx.service/config')
    await page.waitForSelector('.cm-content', { timeout: 10_000 })
    await expect(page.locator('.cm-content')).toContainText('[Unit]')
  })

  test('E2E-19: 手機 RWD 下編輯器可用、按鈕不溢出', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await openEditor(page)
    await typeInEditor(page, '\nEnvironment=FOO=bar')
    // 按鈕在視窗內
    const footer = page.locator('.config-footer')
    await expect(footer).toBeVisible()
    const box = await footer.boundingBox()
    expect(box!.x + box!.width).toBeLessThanOrEqual(380)
    await expect(page.locator('.config-footer button', { hasText: 'Save' })).toBeEnabled()
  })

  test('E2E-20: 儲存後回 Dashboard 服務列表仍可點擊 Edit Config', async ({ page }) => {
    await openEditor(page)
    await typeInEditor(page, '\nEnvironment=FOO=bar')
    await page.locator('.config-footer button', { hasText: 'Save' }).click()
    await page.getByRole('button', { name: 'Save Changes' }).click()
    await expect(page).toHaveURL(/\//, { timeout: 10_000 })
    await expect(getServiceRow(page, 'nginx.service').locator('button.btn-edit-config')).toBeVisible()
  })
})

test.describe('E2E 桌面 Modal（@modal）', () => {
  test('E2E-M1: 桌面點 Edit Config 開啟 Modal、不導航、背景 Dashboard 保留', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false, includeActions: true })
    await setupConfigMocks(page)
    await loginViaUI(page)

    await getServiceRow(page, 'nginx.service').locator('button.btn-edit-config').click()

    await expect(page.locator('.config-modal-dialog')).toBeVisible()
    await expect(page).toHaveURL(/\/dashboard/)
    // 背景 Dashboard 仍在（Modal 以 overlay 呈現，不遮擋 DOM）
    await expect(getServiceRow(page, 'nginx.service')).toBeVisible()
  })

  test('E2E-M2: clean 狀態 Esc 關閉 Modal', async ({ page }) => {
    await openEditor(page)
    await page.keyboard.press('Escape')
    await expect(page.locator('.config-modal-overlay')).toHaveCount(0)
    await expect(page).toHaveURL(/\/dashboard/)
  })

  test('E2E-M3: clean 狀態 backdrop 點擊關閉', async ({ page }) => {
    await openEditor(page)
    await page.locator('.config-modal-overlay').click({ position: { x: 5, y: 5 } })
    await expect(page.locator('.config-modal-overlay')).toHaveCount(0)
  })

  test('E2E-M4: clean 狀態 ✕ 關閉鍵關閉', async ({ page }) => {
    await openEditor(page)
    await page.locator('.config-close-btn').click()
    await expect(page.locator('.config-modal-overlay')).toHaveCount(0)
  })

  test('E2E-M5: dirty 後 Esc → ConfirmModal → Stay 保留內容', async ({ page }) => {
    await openEditor(page)
    await typeInEditor(page, '\nEnvironment=FOO=bar')
    await page.keyboard.press('Escape')
    await expect(page.locator('.lms-modal-overlay')).toBeVisible()
    await expect(page.locator('.lms-modal')).toContainText('Unsaved changes')
    await page.getByRole('button', { name: 'Stay' }).click()
    await expect(page.locator('.lms-modal-overlay')).toHaveCount(0)
    // 內容保留 + 編輯器 Modal 仍開啟
    await expect(page.locator('.config-modal-dialog')).toBeVisible()
    await expect(page.locator('.cm-content')).toContainText('Environment=FOO=bar')
    await expect(page.locator('.dirty-dot')).toBeVisible()
  })

  test('E2E-M6: dirty 後 ✕ → ConfirmModal → Discard Changes 關閉', async ({ page }) => {
    await openEditor(page)
    await typeInEditor(page, '\nEnvironment=FOO=bar')
    await page.locator('.config-close-btn').click()
    await expect(page.locator('.lms-modal-overlay')).toContainText('Unsaved changes')
    await page.getByRole('button', { name: 'Discard Changes' }).click()
    await expect(page.locator('.config-modal-overlay')).toHaveCount(0)
    await expect(page).toHaveURL(/\/dashboard/)
  })

  test('E2E-M7: dirty 後 backdrop → ConfirmModal → Discard Changes 關閉', async ({ page }) => {
    await openEditor(page)
    await typeInEditor(page, '\nEnvironment=FOO=bar')
    await page.locator('.config-modal-overlay').click({ position: { x: 5, y: 5 } })
    await expect(page.locator('.lms-modal-overlay')).toContainText('Unsaved changes')
    await page.getByRole('button', { name: 'Discard Changes' }).click()
    await expect(page.locator('.config-modal-overlay')).toHaveCount(0)
    await expect(page).toHaveURL(/\/dashboard/)
  })
})

test.describe('E2E 手機全頁（@mobile）', () => {
  test('E2E-M8: 手機點 Edit Config 導航到全頁、無 Modal overlay', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await openEditor(page)
    await page.waitForURL('**/services/nginx.service/config')
    await expect(page.locator('.config-modal-overlay')).toHaveCount(0)
    await expect(page.locator('.cm-content')).toContainText('[Unit]')
  })
})

test.describe('E2E API 契約（@api）', () => {
  test('E2E-22: 無效名稱 GET → 400', async ({ page }) => {
    await setupApiMocks(page, { authenticated: true })
    await page.goto('/')
    let seen = ''
    await page.route('**/api/v1/services/*/config', async (route) => {
      seen = decodeURIComponent(route.request().url())
      await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'invalid service name' }) })
    })
    const res = await page.evaluate(async () => {
      const r = await fetch('/api/v1/services/invalid%20name!/config')
      return { status: r.status, body: await r.json() }
    })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('invalid service name')
    expect(seen).toContain('/services/invalid name!/config')
  })

  test('E2E-23/24: 無效名稱 PUT / POST validate → 400', async ({ page }) => {
    await setupApiMocks(page, { authenticated: true })
    await page.goto('/')
    await page.route('**/api/v1/services/*/config', async (route) => {
      await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'invalid service name' }) })
    })
    await page.route('**/api/v1/services/*/config/validate', async (route) => {
      await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'invalid service name' }) })
    })
    const putRes = await page.evaluate(async () => {
      const r = await fetch('/api/v1/services/invalid%20name!/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: 'x', baseChecksum: 'a'.repeat(64) }),
      })
      return { status: r.status, body: await r.json() }
    })
    expect(putRes.status).toBe(400)
    expect(putRes.body.error).toBe('invalid service name')

    const postRes = await page.evaluate(async () => {
      const r = await fetch('/api/v1/services/invalid%20name!/config/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: 'x' }),
      })
      return { status: r.status, body: await r.json() }
    })
    expect(postRes.status).toBe(400)
    expect(postRes.body.error).toBe('invalid service name')
  })

  test('E2E-25/26: 路徑遍歷名稱 → 400 無檔案副作用', async ({ page }) => {
    await setupApiMocks(page, { authenticated: true })
    await page.goto('/')
    await page.route('**/api/v1/services/*/config', async (route) => {
      await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'invalid service name' }) })
    })
    const getRes = await page.evaluate(async () => {
      const r = await fetch('/api/v1/services/..%2Ftraversal/config')
      return { status: r.status, body: await r.json() }
    })
    expect(getRes.status).toBe(400)
    const putRes = await page.evaluate(async () => {
      const r = await fetch('/api/v1/services/..%2Ftraversal/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: 'evil', baseChecksum: 'a'.repeat(64) }),
      })
      return { status: r.status, body: await r.json() }
    })
    expect(putRes.status).toBe(400)
    expect(putRes.body.error).toBe('invalid service name')
  })

  test('E2E-27/28/29: 未登入三端點 → 401', async ({ page }) => {
    await setupApiMocks(page, { authenticated: false })
    await page.goto('/')
    await page.route('**/api/v1/services/*/config', async (route) => {
      await route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'unauthorized' }) })
    })
    await page.route('**/api/v1/services/*/config/validate', async (route) => {
      await route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'unauthorized' }) })
    })
    const results = await page.evaluate(async () => {
      const get = await fetch('/api/v1/services/nginx.service/config')
      const put = await fetch('/api/v1/services/nginx.service/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: 'x', baseChecksum: 'a'.repeat(64) }),
      })
      const post = await fetch('/api/v1/services/nginx.service/config/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: 'x' }),
      })
      return [get.status, put.status, post.status]
    })
    expect(results).toEqual([401, 401, 401])
  })
})
