import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import LogDrawer from '../components/LogDrawer.vue'

// ── Mock WebSocket with tracking ──

let mockWSInstances: MockWebSocket[] = []

class MockWebSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3

  readyState = MockWebSocket.CONNECTING
  url: string
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: ((event?: { code?: number; reason?: string }) => void) | null = null
  onerror: ((event?: any) => void) | null = null
  closeSpy = vi.fn()

  constructor(url: string) {
    this.url = url
    mockWSInstances.push(this)
    // Simulate async connection
    setTimeout(() => {
      this.readyState = MockWebSocket.OPEN
      this.onopen?.()
    }, 0)
  }

  close(code?: number, reason?: string) {
    this.closeSpy(code, reason)
    this.readyState = MockWebSocket.CLOSED
    this.onclose?.({ code: code || 1000, reason: reason || '' })
  }

  // Test helpers
  sendMessage(data: string) {
    this.onmessage?.({ data })
  }

  triggerError() {
    this.onerror?.({})
  }
}

function lastInstance(): MockWebSocket | undefined {
  return mockWSInstances[mockWSInstances.length - 1]
}

describe('LogDrawer — 日誌檢視器', () => {
  beforeEach(() => {
    mockWSInstances = []
    vi.stubGlobal('WebSocket', MockWebSocket)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // ── F-LD-01 ──
  it('F-LD-01: visible=false 時不渲染任何元素', () => {
    const wrapper = mount(LogDrawer, {
      props: { serviceName: 'nginx.service', visible: false },
    })
    expect(wrapper.find('.drawer-overlay').exists()).toBe(false)
    expect(wrapper.find('.log-drawer').exists()).toBe(false)
  })

  // ── F-LD-02 ──
  it('F-LD-02: visible=true 時渲染 Drawer，標題含 serviceName', () => {
    const wrapper = mount(LogDrawer, {
      props: { serviceName: 'nginx.service', visible: true },
    })
    expect(wrapper.find('.log-drawer').exists()).toBe(true)
    expect(wrapper.text()).toContain('nginx.service')
  })

  // ── F-LD-03 ──
  it('F-LD-03: WebSocket 連線中顯示 loading spinner', () => {
    const wrapper = mount(LogDrawer, {
      props: { serviceName: 'test.service', visible: true },
    })
    // WebSocket onopen hasn't fired yet (setTimeout 0) — we're in the same macrotask
    expect(wrapper.find('.loading-spinner').exists()).toBe(true)
  })

  it('F-LD-03: WebSocket 連線完成後隱藏 loading spinner', async () => {
    const wrapper = mount(LogDrawer, {
      props: { serviceName: 'test.service', visible: true },
    })
    // Wait for onopen (macrotask)
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(wrapper.find('.loading-spinner').exists()).toBe(false)
  })

  // ── F-LD-04 ──
  it('F-LD-04: WebSocket onMessage → 日誌內容追加到 <pre> 區塊', async () => {
    const wrapper = mount(LogDrawer, {
      props: { serviceName: 'test.service', visible: true },
    })
    // Wait for connection
    await new Promise(resolve => setTimeout(resolve, 10))

    // Simulate incoming log messages
    const instance = lastInstance()
    instance?.sendMessage('line1\n')
    instance?.sendMessage('line2\n')

    await new Promise(resolve => setTimeout(resolve, 0))

    const pre = wrapper.find('pre')
    expect(pre.exists()).toBe(true)
    expect(pre.text()).toContain('line1')
    expect(pre.text()).toContain('line2')
  })

  // ── F-LD-05 ──
  it('F-LD-05: 日誌自動捲動到底部', async () => {
    const wrapper = mount(LogDrawer, {
      props: { serviceName: 'test.service', visible: true },
    })
    await new Promise(resolve => setTimeout(resolve, 10))

    // First send a message so <pre> appears
    lastInstance()?.sendMessage('first line\n')
    await new Promise(resolve => setTimeout(resolve, 0))

    // Now <pre> should be rendered
    const pre = wrapper.find('pre').element as HTMLPreElement
    Object.defineProperty(pre, 'scrollHeight', { value: 500, writable: true })
    pre.scrollTop = 100

    // Simulate another message
    lastInstance()?.sendMessage('new line\n')

    // nextTick + flush
    await new Promise(resolve => setTimeout(resolve, 0))

    // After auto-scroll, scrollTop should equal scrollHeight
    expect(pre.scrollTop).toBe(500)
  })

  // ── F-LD-06 ──
  it('F-LD-06: 點擊 ✕ 按鈕 → emit close 事件', async () => {
    const wrapper = mount(LogDrawer, {
      props: { serviceName: 'test.service', visible: true },
    })

    const closeBtn = wrapper.find('.close-btn')
    expect(closeBtn.exists()).toBe(true)

    await closeBtn.trigger('click')

    expect(wrapper.emitted('close')).toBeTruthy()
    expect(wrapper.emitted('close')!.length).toBe(1)
  })

  // ── F-LD-07 ──
  it('F-LD-07: 點擊遮罩 → emit close 事件', async () => {
    const wrapper = mount(LogDrawer, {
      props: { serviceName: 'test.service', visible: true },
    })

    const overlay = wrapper.find('.drawer-overlay')
    expect(overlay.exists()).toBe(true)

    await overlay.trigger('click')

    expect(wrapper.emitted('close')).toBeTruthy()
  })

  // ── F-LD-08 ──
  it('F-LD-08: 按下 Esc 鍵 → emit close 事件', async () => {
    const wrapper = mount(LogDrawer, {
      props: { serviceName: 'test.service', visible: true },
    })

    // Dispatch Escape key on document
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))

    expect(wrapper.emitted('close')).toBeTruthy()
  })

  it('F-LD-08: 按下非 Esc 鍵不觸發 close', async () => {
    const wrapper = mount(LogDrawer, {
      props: { serviceName: 'test.service', visible: true },
    })

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))

    expect(wrapper.emitted('close')).toBeFalsy()
  })

  // ── F-LD-09 ──
  it('F-LD-09: 連線後無日誌 → 顯示「此服務尚無日誌記錄」', async () => {
    const wrapper = mount(LogDrawer, {
      props: { serviceName: 'test.service', visible: true },
    })
    // Wait for connection to open
    await new Promise(resolve => setTimeout(resolve, 10))

    // After connection but without any messages, should show empty state
    expect(wrapper.text()).toContain('此服務尚無日誌記錄')
  })

  // ── F-LD-10 ──
  it('F-LD-10: 行數下拉選單包含 50/100/200/500 四個選項', () => {
    const wrapper = mount(LogDrawer, {
      props: { serviceName: 'test.service', visible: true },
    })

    const select = wrapper.find('select')
    expect(select.exists()).toBe(true)

    const options = select.findAll('option')
    const values = options.map(o => o.attributes('value'))
    expect(values).toContain('50')
    expect(values).toContain('100')
    expect(values).toContain('200')
    expect(values).toContain('500')
    expect(options.length).toBe(4)
  })

  // ── F-LD-11 ──
  it('F-LD-11: 行數切換 → 關閉舊 WebSocket + 建立新 WebSocket', async () => {
    const wrapper = mount(LogDrawer, {
      props: { serviceName: 'test.service', visible: true },
    })
    await new Promise(resolve => setTimeout(resolve, 10))

    // Track the first WS instance
    const firstInstance = lastInstance()!
    const oldCloseSpy = firstInstance.closeSpy

    // Change line count
    const select = wrapper.find('select')
    await select.setValue('200')

    // Wait for watch to trigger reconnect
    await new Promise(resolve => setTimeout(resolve, 10))

    // Old WebSocket.close() should have been called
    expect(oldCloseSpy).toHaveBeenCalled()

    // New WebSocket should have been created with updated URL
    const newInstance = lastInstance()!
    expect(newInstance).not.toBe(firstInstance)
    expect(newInstance.url).toContain('lines=200')
  })

  // ── Additional: error message display ──
  it('WebSocket 收到 JSON error message 時顯示錯誤', async () => {
    const wrapper = mount(LogDrawer, {
      props: { serviceName: 'test.service', visible: true },
    })
    await new Promise(resolve => setTimeout(resolve, 10))

    lastInstance()?.sendMessage('{"error":"Service not found"}')

    await new Promise(resolve => setTimeout(resolve, 0))

    expect(wrapper.text()).toContain('Service not found')
  })

  // ── Additional: close disconnects WebSocket ──
  it('關閉時 WebSocket.close() 被呼叫', async () => {
    const wrapper = mount(LogDrawer, {
      props: { serviceName: 'test.service', visible: true },
    })
    await new Promise(resolve => setTimeout(resolve, 10))

    const instance = lastInstance()!
    expect(instance).toBeDefined()

    await wrapper.find('.close-btn').trigger('click')

    expect(instance.closeSpy).toHaveBeenCalled()
  })

  // ═══════════════════════════════════════════════════════════════
  // P1: 搜尋 highlight + 匹配計數
  // ═══════════════════════════════════════════════════════════════

  // ── F-LD-SEARCH-01 ──
  it('F-LD-SEARCH-01: searchQuery 為空 → 所有日誌行正常顯示（無 highlight/dim class）', async () => {
    const wrapper = mount(LogDrawer, {
      props: { serviceName: 'test.service', visible: true },
    })
    await new Promise(resolve => setTimeout(resolve, 10))

    lastInstance()?.sendMessage('line one\n')
    lastInstance()?.sendMessage('line two\n')
    await new Promise(resolve => setTimeout(resolve, 0))

    // searchQuery is empty by default
    const spans = wrapper.findAll('code span')
    for (const span of spans) {
      expect(span.classes()).not.toContain('highlight')
      expect(span.classes()).not.toContain('dim')
    }
  })

  // ── F-LD-SEARCH-02 ──
  it('F-LD-SEARCH-02: 輸入 "error" → 包含 "error" 的行有 highlight class，不含的有 dim class', async () => {
    const wrapper = mount(LogDrawer, {
      props: { serviceName: 'test.service', visible: true },
    })
    await new Promise(resolve => setTimeout(resolve, 10))

    lastInstance()?.sendMessage('error: something failed\n')
    lastInstance()?.sendMessage('info: all good\n')
    lastInstance()?.sendMessage('another error occurred\n')
    await new Promise(resolve => setTimeout(resolve, 0))

    const input = wrapper.find('.search-input')
    await input.setValue('error')

    const spans = wrapper.findAll('code span')
    expect(spans[0].classes()).toContain('highlight')
    expect(spans[0].classes()).not.toContain('dim')
    expect(spans[1].classes()).toContain('dim')
    expect(spans[1].classes()).not.toContain('highlight')
    expect(spans[2].classes()).toContain('highlight')
  })

  // ── F-LD-SEARCH-03 ──
  it('F-LD-SEARCH-03: 搜尋忽略大小寫（"ERROR" 也匹配 "error"）', async () => {
    const wrapper = mount(LogDrawer, {
      props: { serviceName: 'test.service', visible: true },
    })
    await new Promise(resolve => setTimeout(resolve, 10))

    lastInstance()?.sendMessage('Error: something failed\n')
    lastInstance()?.sendMessage('info: all good\n')
    await new Promise(resolve => setTimeout(resolve, 0))

    const input = wrapper.find('.search-input')
    await input.setValue('ERROR')

    const spans = wrapper.findAll('code span')
    expect(spans[0].classes()).toContain('highlight')
    expect(spans[1].classes()).toContain('dim')
  })

  // ── F-LD-SEARCH-04 ──
  it('F-LD-SEARCH-04: 搜尋框右側顯示匹配行數統計，如「3 / 100 行」', async () => {
    const wrapper = mount(LogDrawer, {
      props: { serviceName: 'test.service', visible: true },
    })
    await new Promise(resolve => setTimeout(resolve, 10))

    // Send 5 lines, 3 contain "error"
    lastInstance()?.sendMessage('error one\n')
    lastInstance()?.sendMessage('info one\n')
    lastInstance()?.sendMessage('error two\n')
    lastInstance()?.sendMessage('info two\n')
    lastInstance()?.sendMessage('error three\n')
    await new Promise(resolve => setTimeout(resolve, 0))

    const input = wrapper.find('.search-input')
    await input.setValue('error')

    expect(wrapper.find('.match-count').exists()).toBe(true)
    expect(wrapper.find('.match-count').text()).toContain('3')
    expect(wrapper.find('.match-count').text()).toContain('5')
    expect(wrapper.find('.match-count').text()).toContain('行')
  })

  // ── F-LD-SEARCH-05 ──
  it('F-LD-SEARCH-05: 清空搜尋框 → 恢復全部正常顯示', async () => {
    const wrapper = mount(LogDrawer, {
      props: { serviceName: 'test.service', visible: true },
    })
    await new Promise(resolve => setTimeout(resolve, 10))

    lastInstance()?.sendMessage('error line\n')
    lastInstance()?.sendMessage('info line\n')
    await new Promise(resolve => setTimeout(resolve, 0))

    const input = wrapper.find('.search-input')
    await input.setValue('error')

    // Verify dim/highlight are present
    let spans = wrapper.findAll('code span')
    expect(spans[0].classes()).toContain('highlight')
    expect(spans[1].classes()).toContain('dim')

    // Clear search
    await input.setValue('')

    spans = wrapper.findAll('code span')
    for (const span of spans) {
      expect(span.classes()).not.toContain('highlight')
      expect(span.classes()).not.toContain('dim')
    }
  })

  // ── F-LD-SEARCH-06 ──
  it('F-LD-SEARCH-06: 搜尋僅在已載入日誌中篩選，不觸發任何 WebSocket 動作', async () => {
    const wrapper = mount(LogDrawer, {
      props: { serviceName: 'test.service', visible: true },
    })
    await new Promise(resolve => setTimeout(resolve, 10))

    const instance = lastInstance()!
    const oldCloseSpy = instance.closeSpy

    lastInstance()?.sendMessage('line one\n')
    await new Promise(resolve => setTimeout(resolve, 0))

    // Count WebSocket instances after initial connection
    const wsCountBefore = mockWSInstances.length

    const input = wrapper.find('.search-input')
    await input.setValue('line')

    // No new WebSocket should have been created
    expect(mockWSInstances.length).toBe(wsCountBefore)
    // Old WebSocket should not have been closed
    expect(oldCloseSpy).not.toHaveBeenCalled()
  })

  // ═══════════════════════════════════════════════════════════════
  // P1: 錯誤處理 UI
  // ═══════════════════════════════════════════════════════════════

  // ── F-LD-ERR-01 ──
  it('F-LD-ERR-01: WebSocket 收到 permission denied error → 顯示錯誤訊息 + 重試按鈕', async () => {
    const wrapper = mount(LogDrawer, {
      props: { serviceName: 'test.service', visible: true },
    })
    await new Promise(resolve => setTimeout(resolve, 10))

    lastInstance()?.sendMessage('{"error":"permission denied: cannot access journalctl"}')
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(wrapper.text()).toContain('permission denied')
    expect(wrapper.find('.retry-btn').exists()).toBe(true)
  })

  // ── F-LD-ERR-02 ──
  it('F-LD-ERR-02: WebSocket 收到 journalctl not found error → 顯示對應錯誤訊息', async () => {
    const wrapper = mount(LogDrawer, {
      props: { serviceName: 'test.service', visible: true },
    })
    await new Promise(resolve => setTimeout(resolve, 10))

    lastInstance()?.sendMessage('{"error":"journalctl not found on target system"}')
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(wrapper.text()).toContain('journalctl not found')
    expect(wrapper.find('.retry-btn').exists()).toBe(true)
  })

  // ── F-LD-ERR-03 ──
  it('F-LD-ERR-03: WebSocket onerror 觸發 → 顯示連線失敗錯誤', async () => {
    const wrapper = mount(LogDrawer, {
      props: { serviceName: 'test.service', visible: true },
    })
    await new Promise(resolve => setTimeout(resolve, 10))

    lastInstance()?.triggerError()
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(wrapper.find('.drawer-error').exists()).toBe(true)
    expect(wrapper.text()).toContain('連線')
  })

  // ── F-LD-ERR-04 ──
  it('F-LD-ERR-04: 點擊重試按鈕 → 重新呼叫 connectWebSocket', async () => {
    const wrapper = mount(LogDrawer, {
      props: { serviceName: 'test.service', visible: true },
    })
    await new Promise(resolve => setTimeout(resolve, 10))

    // Trigger error
    lastInstance()?.sendMessage('{"error":"some error"}')
    await new Promise(resolve => setTimeout(resolve, 0))

    const wsCountBefore = mockWSInstances.length

    const retryBtn = wrapper.find('.retry-btn')
    await retryBtn.trigger('click')

    // A new WebSocket should be created
    expect(mockWSInstances.length).toBe(wsCountBefore + 1)
  })

  // ── F-LD-ERR-05 ──
  it('F-LD-ERR-05: 重試期間顯示 loading 狀態', async () => {
    const wrapper = mount(LogDrawer, {
      props: { serviceName: 'test.service', visible: true },
    })
    await new Promise(resolve => setTimeout(resolve, 10))

    // Trigger error
    lastInstance()?.sendMessage('{"error":"some error"}')
    await new Promise(resolve => setTimeout(resolve, 0))

    // Click retry
    const retryBtn = wrapper.find('.retry-btn')
    await retryBtn.trigger('click')

    // Should show loading state immediately (before new WS opens)
    expect(wrapper.find('.loading-spinner').exists()).toBe(true)
  })

  // ═══════════════════════════════════════════════════════════════
  // P1: 服務切換
  // ═══════════════════════════════════════════════════════════════

  // ── F-LD-SWITCH-01 ──
  it('F-LD-SWITCH-01: serviceName 從 "nginx" 變 "apache" → 關閉舊 WebSocket + 建立新 WebSocket', async () => {
    const wrapper = mount(LogDrawer, {
      props: { serviceName: 'nginx', visible: true },
    })
    await new Promise(resolve => setTimeout(resolve, 10))

    const firstInstance = lastInstance()!
    const oldCloseSpy = firstInstance.closeSpy

    // Switch service name
    await wrapper.setProps({ serviceName: 'apache' })
    await new Promise(resolve => setTimeout(resolve, 10))

    // Old WS should be closed
    expect(oldCloseSpy).toHaveBeenCalled()

    // New WS should have been created
    const newInstance = lastInstance()!
    expect(newInstance).not.toBe(firstInstance)
    expect(newInstance.url).toContain('apache')
  })

  // ── F-LD-SWITCH-02 ──
  it('F-LD-SWITCH-02: 切換後 logContent 清空為空', async () => {
    const wrapper = mount(LogDrawer, {
      props: { serviceName: 'nginx', visible: true },
    })
    await new Promise(resolve => setTimeout(resolve, 10))

    // Add some log lines
    lastInstance()?.sendMessage('old log line\n')
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(wrapper.find('pre').text()).toContain('old log line')

    // Switch service
    await wrapper.setProps({ serviceName: 'apache' })
    await new Promise(resolve => setTimeout(resolve, 10))

    // After switch, the pre should show new logs (empty until more messages arrive)
    // The log should not contain the old line anymore
    const preExists = wrapper.find('pre').exists()
    if (preExists) {
      expect(wrapper.find('pre').text()).not.toContain('old log line')
    }
  })

  // ── F-LD-SWITCH-03 ──
  it('F-LD-SWITCH-03: 切換後標題更新為新服務名稱', async () => {
    const wrapper = mount(LogDrawer, {
      props: { serviceName: 'nginx', visible: true },
    })

    expect(wrapper.find('.drawer-title').text()).toContain('nginx')

    await wrapper.setProps({ serviceName: 'apache' })

    expect(wrapper.find('.drawer-title').text()).toContain('apache')
    expect(wrapper.find('.drawer-title').text()).not.toContain('nginx')
  })

  // ── F-LD-SWITCH-04 ──
  it('F-LD-SWITCH-04: 切換後 isLoading 回到 true（等待新連線）', async () => {
    const wrapper = mount(LogDrawer, {
      props: { serviceName: 'nginx', visible: true },
    })
    await new Promise(resolve => setTimeout(resolve, 10))

    // After initial connection, loading should be gone
    expect(wrapper.find('.loading-spinner').exists()).toBe(false)

    // Switch service
    await wrapper.setProps({ serviceName: 'apache' })

    // Loading should reappear immediately (before new WS opens)
    expect(wrapper.find('.loading-spinner').exists()).toBe(true)
  })

  // ═══════════════════════════════════════════════════════════════
  // P1: WebSocket 重連機制
  // ═══════════════════════════════════════════════════════════════

  // ── F-LD-RECON-01 ──
  it('F-LD-RECON-01: WebSocket onclose（非主動關閉） → 1 秒後自動重連', async () => {
    vi.useFakeTimers()

    mount(LogDrawer, {
      props: { serviceName: 'test.service', visible: true },
    })
    await vi.runAllTimersAsync()

    const firstInstance = lastInstance()!
    const wsCountBefore = mockWSInstances.length

    // Simulate unexpected close (server closes connection)
    // Trigger onclose directly without going through component's disconnect
    firstInstance.onclose?.({ code: 1006 })

    // Fast-forward past the 1s reconnect delay
    await vi.advanceTimersByTimeAsync(1100)

    // New WebSocket should have been created
    expect(mockWSInstances.length).toBe(wsCountBefore + 1)

    vi.useRealTimers()
  })

  // ── F-LD-RECON-02 ──
  it('F-LD-RECON-02: 重連期間顯示「連線中斷，正在重連...」提示', async () => {
    vi.useFakeTimers()

    const wrapper = mount(LogDrawer, {
      props: { serviceName: 'test.service', visible: true },
    })
    // Advance past initial WS onopen (setTimeout 0)
    await vi.advanceTimersByTimeAsync(10)

    // Trigger unexpected close
    lastInstance()?.onclose?.({ code: 1006 })
    // Flush microtasks only (reconnecting is set synchronously, setTimeout not yet fired)
    await wrapper.vm.$nextTick()

    // Should show reconnecting hint (before setTimeout fires)
    expect(wrapper.find('.reconnect-hint').exists()).toBe(true)
    expect(wrapper.text()).toContain('重連')

    vi.useRealTimers()
  })

  // ── F-LD-RECON-03 ──
  it('F-LD-RECON-03: 重連成功 → 提示消失，isConnected = true', async () => {
    vi.useFakeTimers()

    const wrapper = mount(LogDrawer, {
      props: { serviceName: 'test.service', visible: true },
    })
    await vi.advanceTimersByTimeAsync(10)

    // Trigger unexpected close
    lastInstance()?.onclose?.({ code: 1006 })
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.reconnect-hint').exists()).toBe(true)

    // Advance past reconnect delay (1000ms) + new WS onopen (0ms)
    await vi.advanceTimersByTimeAsync(1100)

    // New WS onopen should have fired → hint gone
    expect(wrapper.find('.reconnect-hint').exists()).toBe(false)

    vi.useRealTimers()
  })

  // ── F-LD-RECON-04 ──
  it('F-LD-RECON-04: 主動關閉 Drawer → 不觸發重連', async () => {
    vi.useFakeTimers()

    const wrapper = mount(LogDrawer, {
      props: { serviceName: 'test.service', visible: true },
    })
    await vi.runAllTimersAsync()

    const wsCountBefore = mockWSInstances.length

    // Close drawer (active close)
    await wrapper.find('.close-btn').trigger('click')
    await vi.runAllTimersAsync()

    // Fast-forward well past reconnect delay
    await vi.advanceTimersByTimeAsync(3000)

    // No new WebSocket should have been created
    expect(mockWSInstances.length).toBe(wsCountBefore)

    vi.useRealTimers()
  })
})
