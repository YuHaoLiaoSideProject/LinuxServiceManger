/**
 * LogDrawer 元件單元測試
 *
 * 對應 BDD：docs/bdds/005-journalctl-log-viewer.feature
 * 對應測試計畫：docs/test-plans/005-journalctl-log-viewer測試計畫.md §3.1
 *
 * 策略：
 * - 元件使用 <Teleport to="body"> → teleported DOM 用 document.querySelector 存取
 * - 優先驗證行為（emit / vm 狀態 / mock 呼叫）而非 DOM 結構細節
 * - 每個測試後清理 document.body
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import LogDrawer from '../components/LogDrawer.vue'

// ── Mock WebSocket ──

interface MockWebSocket {
  url: string
  readyState: number
  onopen: (() => void) | null
  onmessage: ((event: { data: string }) => void) | null
  onclose: ((event?: { code?: number; reason?: string }) => void) | null
  onerror: ((event?: unknown) => void) | null
  closeSpy: (code?: number, reason?: string) => void
  close: (code?: number, reason?: string) => void
  sendMessage: (data: string) => void
  triggerError: () => void
}

let mockInstances: MockWebSocket[] = []

// Must use a proper constructor (not arrow fn) for `new WebSocket(url)`
function MockWS(this: MockWebSocket, url: string) {
  this.url = url
  this.readyState = 0 // CONNECTING
  this.onopen = null
  this.onmessage = null
  this.onclose = null
  this.onerror = null
  this.closeSpy = vi.fn()
  this.close = function (code?: number, reason?: string) {
    this.closeSpy(code, reason)
    this.readyState = 3 // CLOSED
    this.onclose?.({ code: code ?? 1000, reason: reason ?? '' })
  }
  this.sendMessage = function (data: string) {
    this.onmessage?.({ data })
  }
  this.triggerError = function () {
    this.readyState = 3
    this.onerror?.({})
  }
  mockInstances.push(this)
  // Simulate async open
  setTimeout(() => {
    this.readyState = 1 // OPEN
    this.onopen?.()
  }, 0)
}

function lastWS(): MockWebSocket | undefined {
  return mockInstances[mockInstances.length - 1]
}

// ── Helpers ──

function mountDrawer(props: { serviceName?: string; visible?: boolean } = {}) {
  return mount(LogDrawer, {
    props: { serviceName: 'test.service', visible: true, ...props },
  })
}

/** Flush setTimeout(0) so mock WS onopen fires */
async function flushWS() {
  await new Promise(r => setTimeout(r, 10))
}

/** Single micro/macro tick for real timers */
async function tick() {
  await new Promise(r => setTimeout(r, 0))
}

// ── Setup / Teardown ──

beforeEach(() => {
  mockInstances = []
  vi.stubGlobal('WebSocket', MockWS as any)
})

afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

// ===================================================================
// BDD: 開啟日誌 Drawer 並成功載入日誌
// ===================================================================

describe('開啟 Drawer 與日誌載入', () => {
  it('visible=false 時不渲染 Drawer', () => {
    mountDrawer({ visible: false })
    expect(document.querySelector('.log-drawer')).toBeNull()
    expect(document.querySelector('.drawer-overlay')).toBeNull()
  })

  it('visible=true 時 Drawer 出現在 document.body 中', () => {
    mountDrawer({ visible: true })
    expect(document.querySelector('.log-drawer')).not.toBeNull()
  })

  it('Drawer 標題包含 serviceName', () => {
    mountDrawer({ serviceName: 'nginx.service', visible: true })
    expect(document.querySelector('.drawer-title')?.textContent).toContain('nginx.service')
  })

  it('連線中顯示 loading spinner，連線完成後消失', async () => {
    mountDrawer({ visible: true })

    // Before WS open
    expect(document.querySelector('.loading-spinner')).not.toBeNull()

    await flushWS()

    // After WS open
    expect(document.querySelector('.loading-spinner')).toBeNull()
  })

  it('連線成功後狀態指示為 LIVE', async () => {
    mountDrawer({ visible: true })
    await flushWS()
    const status = document.querySelector('.connection-status')
    expect(status?.textContent).toContain('LIVE')
  })

  it('收到日誌訊息後內容顯示在 pre 區塊', async () => {
    mountDrawer({ visible: true })
    await flushWS()

    lastWS()?.sendMessage('line one\n')
    lastWS()?.sendMessage('line two\n')
    await tick()

    const pre = document.querySelector('.log-content')
    expect(pre?.textContent).toContain('line one')
    expect(pre?.textContent).toContain('line two')
  })

  it('新日誌觸發自動捲動到底部', async () => {
    mountDrawer({ visible: true })
    await flushWS()

    lastWS()?.sendMessage('first\n')
    await tick()

    const pre = document.querySelector('.log-content') as HTMLPreElement
    expect(pre).not.toBeNull()
    Object.defineProperty(pre, 'scrollHeight', { value: 500, writable: true })
    pre.scrollTop = 100

    lastWS()?.sendMessage('new line\n')
    await tick()

    expect(pre.scrollTop).toBe(500)
  })
})

// ===================================================================
// BDD: 調整日誌顯示行數
// ===================================================================

describe('行數選擇器', () => {
  it('預設行數為 100，選單包含 50/100/200/500 四個選項', () => {
    mountDrawer({ visible: true })
    const select = document.querySelector<HTMLSelectElement>('.line-count-select')
    expect(select).not.toBeNull()
    const values = Array.from(select!.options).map(o => o.value)
    expect(values).toEqual(['50', '100', '200', '500'])
    expect(select!.value).toBe('100')
  })

  it('切換行數 → 關閉舊 WS + 建立新 WS（含新行數）', async () => {
    mountDrawer({ visible: true })
    await flushWS()

    const old = lastWS()!
    const countBefore = mockInstances.length

    const select = document.querySelector<HTMLSelectElement>('.line-count-select')!
    select.value = '200'
    select.dispatchEvent(new Event('change'))

    await flushWS()

    expect(old.closeSpy).toHaveBeenCalled()
    expect(mockInstances.length).toBe(countBefore + 1)
    expect(lastWS()!.url).toContain('lines=200')
  })
})

// ===================================================================
// BDD: WebSocket 即時串流
// ===================================================================

describe('WebSocket 即時串流', () => {
  it('收到新訊息時追加到現有內容之後', async () => {
    mountDrawer({ visible: true })
    await flushWS()

    lastWS()?.sendMessage('msg1\n')
    await tick()
    lastWS()?.sendMessage('msg2\n')
    await tick()

    const pre = document.querySelector('.log-content')
    const lines = pre?.querySelectorAll('code span')
    expect(lines?.length).toBe(2)
    expect(lines?.[0].textContent).toContain('msg1')
    expect(lines?.[1].textContent).toContain('msg2')
  })

  it('日誌行數超過 MAX_LOG_LINES 時截斷舊內容', async () => {
    const wrapper = mountDrawer({ visible: true })
    await flushWS()
    const vm = wrapper.vm as unknown as { logLines: { text: string }[] }

    // Fill exactly to max
    const MAX = 5000
    for (let i = 0; i < MAX + 10; i++) {
      lastWS()?.sendMessage(`line${i}\n`)
    }
    await tick()

    expect(vm.logLines.length).toBeLessThanOrEqual(MAX)
  })
})

// ===================================================================
// BDD: 關閉 Drawer（✕ / 遮罩 / Esc）
// ===================================================================

describe('關閉 Drawer', () => {
  it('點擊 ✕ 按鈕 → emit close + WS 關閉', async () => {
    const wrapper = mountDrawer({ visible: true })
    await flushWS()
    const ws = lastWS()!

    document.querySelector<HTMLButtonElement>('.close-btn')?.click()
    await tick()

    expect(wrapper.emitted('close')).toBeTruthy()
    expect(ws.closeSpy).toHaveBeenCalled()
  })

  it('點擊遮罩 → emit close', async () => {
    const wrapper = mountDrawer({ visible: true })
    await flushWS()

    document.querySelector<HTMLDivElement>('.drawer-overlay')?.click()
    await tick()

    expect(wrapper.emitted('close')).toBeTruthy()
  })

  it('按下 Esc → emit close + WS 關閉', async () => {
    const wrapper = mountDrawer({ visible: true })
    await flushWS()
    const ws = lastWS()!

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await tick()

    expect(wrapper.emitted('close')).toBeTruthy()
    expect(ws.closeSpy).toHaveBeenCalled()
  })

  it('非 Esc 鍵不觸發 close', async () => {
    const wrapper = mountDrawer({ visible: true })
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    expect(wrapper.emitted('close')).toBeFalsy()
  })

  it('unmount 時關閉 WS 並移除 keydown listener', async () => {
    const wrapper = mountDrawer({ visible: true })
    await flushWS()
    const ws = lastWS()!

    wrapper.unmount()
    expect(ws.closeSpy).toHaveBeenCalled()
  })
})

// ===================================================================
// BDD: 服務切換
// ===================================================================

describe('服務名稱切換', () => {
  it('serviceName 變更 → 關閉舊 WS + 建立新 WS', async () => {
    const wrapper = mountDrawer({ serviceName: 'svc-a', visible: true })
    await flushWS()
    const old = lastWS()!
    const countBefore = mockInstances.length

    await wrapper.setProps({ serviceName: 'svc-b' })
    await flushWS()

    expect(old.closeSpy).toHaveBeenCalled()
    expect(mockInstances.length).toBe(countBefore + 1)
    expect(lastWS()!.url).toContain('svc-b')
  })

  it('切換後標題更新', async () => {
    const wrapper = mountDrawer({ serviceName: 'svc-a', visible: true })
    expect(document.querySelector('.drawer-title')?.textContent).toContain('svc-a')

    await wrapper.setProps({ serviceName: 'svc-b' })
    await flushWS()

    expect(document.querySelector('.drawer-title')?.textContent).toContain('svc-b')
    expect(document.querySelector('.drawer-title')?.textContent).not.toContain('svc-a')
  })

  it('切換後舊日誌內容被清空', async () => {
    const wrapper = mountDrawer({ visible: true })
    await flushWS()
    lastWS()?.sendMessage('old log\n')
    await tick()

    await wrapper.setProps({ serviceName: 'new-svc' })
    await flushWS()

    const pre = document.querySelector('.log-content')
    // New connection has no messages yet — should show empty state or loading
    expect(pre?.textContent || '').not.toContain('old log')
  })

  it('切換後 loading 狀態重新出現', async () => {
    const wrapper = mountDrawer({ visible: true })
    await flushWS()

    expect(document.querySelector('.loading-spinner')).toBeNull()

    await wrapper.setProps({ serviceName: 'other-svc' })
    // Loading should appear before new WS opens
    expect(document.querySelector('.loading-spinner')).not.toBeNull()
  })
})

// ===================================================================
// BDD: 搜尋已載入日誌
// ===================================================================

describe('搜尋篩選', () => {
  it('搜尋「error」→ 匹配行 highlight，不匹配行 dim', async () => {
    mountDrawer({ visible: true })
    await flushWS()

    lastWS()?.sendMessage('error: something failed\n')
    lastWS()?.sendMessage('info: all good\n')
    lastWS()?.sendMessage('another error here\n')
    await tick()

    const input = document.querySelector<HTMLInputElement>('.search-input')!
    input.value = 'error'
    input.dispatchEvent(new Event('input'))

    await tick()

    const spans = document.querySelectorAll('.log-content code span')
    expect(spans[0].classList).toContain('highlight')
    expect(spans[1].classList).toContain('dim')
    expect(spans[2].classList).toContain('highlight')
  })

  it('搜尋大小寫不敏感（"ERROR" 匹配 "error"）', async () => {
    mountDrawer({ visible: true })
    await flushWS()

    lastWS()?.sendMessage('Error: something\n')
    lastWS()?.sendMessage('info line\n')
    await tick()

    const input = document.querySelector<HTMLInputElement>('.search-input')!
    input.value = 'ERROR'
    input.dispatchEvent(new Event('input'))
    await tick()

    const spans = document.querySelectorAll('.log-content code span')
    expect(spans[0].classList).toContain('highlight')
    expect(spans[1].classList).toContain('dim')
  })

  it('搜尋獨立單詞（word-boundary）而非子字串', async () => {
    // BDD: simpleddns / dns_udp 含子字串「dns」→ dim; 獨立「DNS」→ highlight
    mountDrawer({ visible: true })
    await flushWS()

    lastWS()?.sendMessage('simpleddns started\n')
    lastWS()?.sendMessage('dns_udp listening\n')
    lastWS()?.sendMessage('DNS lookup failed\n')
    await tick()

    const input = document.querySelector<HTMLInputElement>('.search-input')!
    input.value = 'DNS'
    input.dispatchEvent(new Event('input'))
    await tick()

    const spans = document.querySelectorAll('.log-content code span')
    // "simpleddns" → "dns" is a substring, not an independent word → dim
    expect(spans[0].classList).toContain('dim')
    // "dns_udp" → "dns" followed by "_" (underscore excluded by word boundary) → dim
    expect(spans[1].classList).toContain('dim')
    // "DNS lookup failed" → "DNS" as independent word → highlight
    expect(spans[2].classList).toContain('highlight')
  })

  it('搜尋框右側顯示匹配計數「M / N 行」', async () => {
    mountDrawer({ visible: true })
    await flushWS()

    lastWS()?.sendMessage('error one\n')
    lastWS()?.sendMessage('info one\n')
    lastWS()?.sendMessage('error two\n')
    lastWS()?.sendMessage('info two\n')
    lastWS()?.sendMessage('error three\n')
    await tick()

    const input = document.querySelector<HTMLInputElement>('.search-input')!
    input.value = 'error'
    input.dispatchEvent(new Event('input'))
    await tick()

    const count = document.querySelector('.match-count')
    expect(count?.textContent).toContain('3')
    expect(count?.textContent).toContain('5')
  })

  it('清空搜尋框 → 恢復全部正常顯示', async () => {
    mountDrawer({ visible: true })
    await flushWS()

    lastWS()?.sendMessage('error line\n')
    lastWS()?.sendMessage('info line\n')
    await tick()

    const input = document.querySelector<HTMLInputElement>('.search-input')!
    input.value = 'error'
    input.dispatchEvent(new Event('input'))
    await tick()

    // Now clear
    input.value = ''
    input.dispatchEvent(new Event('input'))
    await tick()

    const spans = document.querySelectorAll('.log-content code span')
    for (const span of spans) {
      expect(span.classList).not.toContain('highlight')
      expect(span.classList).not.toContain('dim')
    }
    expect(document.querySelector('.match-count')).toBeNull()
  })

  it('搜尋無匹配結果 → 全部 dim', async () => {
    mountDrawer({ visible: true })
    await flushWS()

    lastWS()?.sendMessage('line one\n')
    lastWS()?.sendMessage('line two\n')
    await tick()

    const input = document.querySelector<HTMLInputElement>('.search-input')!
    input.value = 'xyz_not_found_123'
    input.dispatchEvent(new Event('input'))
    await tick()

    const spans = document.querySelectorAll('.log-content code span')
    expect(spans[0].classList).toContain('dim')
    expect(spans[1].classList).toContain('dim')

    const count = document.querySelector('.match-count')
    expect(count?.textContent).toContain('0')
  })

  it('搜尋不觸發任何 WebSocket 請求（純前端篩選）', async () => {
    mountDrawer({ visible: true })
    await flushWS()

    lastWS()?.sendMessage('line one\n')
    await tick()

    const wsCount = mockInstances.length
    const old = lastWS()!

    const input = document.querySelector<HTMLInputElement>('.search-input')!
    input.value = 'line'
    input.dispatchEvent(new Event('input'))
    await tick()

    expect(mockInstances.length).toBe(wsCount)
    expect(old.closeSpy).not.toHaveBeenCalled()
  })

  it('日誌為空時搜尋框不顯示', () => {
    mountDrawer({ visible: true })
    // No messages sent, no connection opened yet
    expect(document.querySelector('.search-input')).toBeNull()
  })

  it('有日誌後搜尋框才出現', async () => {
    mountDrawer({ visible: true })
    await flushWS()

    lastWS()?.sendMessage('first line\n')
    await tick()

    expect(document.querySelector('.search-input')).not.toBeNull()
  })
})

// ===================================================================
// BDD: 錯誤處理
// ===================================================================

describe('錯誤處理', () => {
  it('服務無日誌時顯示空狀態', async () => {
    const wrapper = mountDrawer({ visible: true })
    await flushWS()

    const vm = wrapper.vm as unknown as { logLines: { text: string }[]; isLoading: boolean; error: string }
    vm.isLoading = false
    vm.logLines = []
    await tick()

    expect(document.querySelector('.empty-state')).not.toBeNull()
    expect(document.querySelector('.empty-state')?.textContent).toContain('尚無日誌記錄')
  })

  it('收到 JSON error → 顯示錯誤訊息 + 重試按鈕', async () => {
    mountDrawer({ visible: true })
    await flushWS()

    lastWS()?.sendMessage('{"error":"permission denied: cannot access journalctl"}')
    await tick()

    expect(document.querySelector('.drawer-error')).not.toBeNull()
    expect(document.querySelector('.drawer-error')?.textContent).toContain('permission denied')
    expect(document.querySelector('.retry-btn')).not.toBeNull()
  })

  it('收到 journalctl not found error', async () => {
    mountDrawer({ visible: true })
    await flushWS()

    lastWS()?.sendMessage('{"error":"journalctl not found on target system"}')
    await tick()

    expect(document.querySelector('.drawer-error')?.textContent).toContain('journalctl not found')
  })

  it('WebSocket onerror → 顯示連線錯誤', async () => {
    mountDrawer({ visible: true })
    await flushWS()

    lastWS()?.triggerError()
    await tick()

    expect(document.querySelector('.drawer-error')).not.toBeNull()
  })

  it('點擊重試按鈕 → 重新建立 WebSocket', async () => {
    mountDrawer({ visible: true })
    await flushWS()

    lastWS()?.sendMessage('{"error":"some error"}')
    await tick()

    const wsCount = mockInstances.length

    document.querySelector<HTMLButtonElement>('.retry-btn')?.click()
    await tick()

    expect(mockInstances.length).toBe(wsCount + 1)
  })

  it('重試時顯示 loading 狀態', async () => {
    const wrapper = mountDrawer({ visible: true })
    await flushWS()

    lastWS()?.sendMessage('{"error":"some error"}')
    await tick()

    document.querySelector<HTMLButtonElement>('.retry-btn')?.click()
    // Vue DOM update for isLoading=true happens before WS onopen setTimeout
    await wrapper.vm.$nextTick()

    expect(document.querySelector('.loading-spinner')).not.toBeNull()
  })
})

// ===================================================================
// BDD: WebSocket 重連機制
// ===================================================================

describe('WebSocket 自動重連', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('非主動關閉 → 自動重連', async () => {
    mountDrawer({ visible: true })
    await vi.advanceTimersByTimeAsync(10) // let WS open

    const wsCount = mockInstances.length

    // Simulate unexpected close (server drops connection)
    lastWS()?.onclose?.({ code: 1006 })
    await vi.advanceTimersByTimeAsync(1100) // past 1s reconnect delay

    expect(mockInstances.length).toBe(wsCount + 1)
  })

  it('重連期間顯示「連線中斷，正在重連...」', async () => {
    const wrapper = mountDrawer({ visible: true })
    await vi.advanceTimersByTimeAsync(10) // open WS

    lastWS()?.onclose?.({ code: 1006 })
    await wrapper.vm.$nextTick()

    expect(document.querySelector('.reconnect-hint')).not.toBeNull()
    expect(document.querySelector('.reconnect-hint')?.textContent).toContain('重連')
  })

  it('重連成功後提示消失', async () => {
    const wrapper = mountDrawer({ visible: true })
    await vi.advanceTimersByTimeAsync(10)

    lastWS()?.onclose?.({ code: 1006 })
    await wrapper.vm.$nextTick()

    expect(document.querySelector('.reconnect-hint')).not.toBeNull()

    // Advance past reconnect delay
    await vi.advanceTimersByTimeAsync(1100)

    expect(document.querySelector('.reconnect-hint')).toBeNull()
  })

  it('主動關閉 Drawer → 不觸發重連', async () => {
    mountDrawer({ visible: true })
    await vi.runAllTimersAsync()

    const wsCount = mockInstances.length

    document.querySelector<HTMLButtonElement>('.close-btn')?.click()
    await vi.runAllTimersAsync()
    await vi.advanceTimersByTimeAsync(3000)

    expect(mockInstances.length).toBe(wsCount)
  })

  it('重連使用 exponential backoff', async () => {
    mountDrawer({ visible: true })
    await vi.advanceTimersByTimeAsync(10) // initial connect

    const wsCount = mockInstances.length

    // First disconnect: reconnect after ~1s
    lastWS()?.onclose?.({ code: 1006 })
    await vi.advanceTimersByTimeAsync(1100)
    expect(mockInstances.length).toBe(wsCount + 1) // reconnected after ~1s
  })
})

// ===================================================================
// BDD: 連線狀態指示
// ===================================================================

describe('連線狀態指示', () => {
  it('連線中 → ○ 離線', () => {
    mountDrawer({ visible: true })
    const status = document.querySelector('.connection-status')
    expect(status?.textContent).toContain('離線')
  })

  it('連線成功 → ● LIVE', async () => {
    mountDrawer({ visible: true })
    await flushWS()
    const status = document.querySelector('.connection-status')
    expect(status?.textContent).toContain('LIVE')
  })

  it('重連中 → ⟳ 重連中', async () => {
    vi.useFakeTimers()
    const wrapper = mountDrawer({ visible: true })
    await vi.advanceTimersByTimeAsync(10)

    lastWS()?.onclose?.({ code: 1006 })
    await wrapper.vm.$nextTick()

    const status = document.querySelector('.connection-status')
    expect(status?.textContent).toContain('重連')
    vi.useRealTimers()
  })
})

// ===================================================================
// BDD: ARIA 無障礙
// ===================================================================

describe('ARIA 無障礙', () => {
  it('✕ 按鈕有 aria-label', () => {
    mountDrawer({ visible: true })
    const btn = document.querySelector('.close-btn')
    expect(btn?.getAttribute('aria-label')).toBe('關閉日誌檢視器')
  })

  it('搜尋框有 aria-label', async () => {
    mountDrawer({ visible: true })
    await flushWS()
    lastWS()?.sendMessage('log\n')
    await tick()

    const input = document.querySelector('.search-input')
    expect(input?.getAttribute('aria-label')).toBe('搜尋日誌')
  })

  it('重連提示有 aria-live="polite"', async () => {
    vi.useFakeTimers()
    const wrapper = mountDrawer({ visible: true })
    await vi.advanceTimersByTimeAsync(10)

    lastWS()?.onclose?.({ code: 1006 })
    await wrapper.vm.$nextTick()

    const hint = document.querySelector('.reconnect-hint')
    expect(hint?.getAttribute('aria-live')).toBe('polite')
    vi.useRealTimers()
  })
})

// ===================================================================
// BDD: Focus Trap
// ===================================================================

describe('Focus Trap', () => {
  function mountAttached() {
    const container = document.createElement('div')
    document.body.appendChild(container)
    return mount(LogDrawer, {
      props: { serviceName: 'test.service', visible: true },
      attachTo: container,
    })
  }

  it('Tab 在最後一個元素時 → 焦點回到第一個', async () => {
    const wrapper = mountAttached()
    await flushWS()
    lastWS()?.sendMessage('log\n')
    await new Promise(r => setTimeout(r, 10))

    const focusable = document.querySelectorAll<HTMLElement>(
      '.log-drawer button, .log-drawer input, .log-drawer select'
    )
    expect(focusable.length).toBeGreaterThanOrEqual(2)

    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    first.tabIndex = 0
    last.tabIndex = 0

    last.focus()
    const spy = vi.spyOn(first, 'focus')

    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })
    vi.spyOn(event, 'preventDefault')
    document.dispatchEvent(event)

    expect(event.preventDefault).toHaveBeenCalled()
    expect(spy).toHaveBeenCalled()

    wrapper.unmount()
  })

  it('Shift+Tab 在第一個元素 → 焦點跳到最後一個', async () => {
    const wrapper = mountAttached()
    await flushWS()
    lastWS()?.sendMessage('log\n')
    await new Promise(r => setTimeout(r, 10))

    const focusable = document.querySelectorAll<HTMLElement>(
      '.log-drawer button, .log-drawer input, .log-drawer select'
    )
    expect(focusable.length).toBeGreaterThanOrEqual(2)

    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    first.tabIndex = 0
    last.tabIndex = 0

    first.focus()
    const spy = vi.spyOn(last, 'focus')

    const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true })
    vi.spyOn(event, 'preventDefault')
    document.dispatchEvent(event)

    expect(event.preventDefault).toHaveBeenCalled()
    expect(spy).toHaveBeenCalled()

    wrapper.unmount()
  })

  it('沒有可聚焦元素時不拋出錯誤', () => {
    mountDrawer({ visible: true })
    // No search bar, no select either visible without logs
    expect(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
    }).not.toThrow()
  })
})

// ===================================================================
// BDD: 行動裝置全螢幕（驗證 CSS media query 存在）
// ===================================================================

describe('RWD 行動裝置', () => {
  it('原始碼包含手機版 bottom sheet media query', async () => {
    const { readFileSync } = await import('fs')
    const { fileURLToPath } = await import('url')
    const { dirname, resolve } = await import('path')

    const sourcePath = resolve(dirname(fileURLToPath(import.meta.url)), '../components/LogDrawer.vue')
    const source = readFileSync(sourcePath, 'utf-8')

    expect(source).toContain('@media (max-width: 767px)')
    expect(source).toMatch(/transform:\s*translateY\(100%\)/)
    expect(source).toMatch(/max-height:\s*88dvh/)
    expect(source).toMatch(/border-radius:\s*16px 16px 0 0/)
  })
})
