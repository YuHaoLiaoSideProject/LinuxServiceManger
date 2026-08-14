/**
 * RED phase — useWebSocket.ts 節點事件擴充（F-AP-13 ~ F-AP-14）
 * 對應 docs/test-plans/014-multi-node-agent-management測試計畫.md §3.9（決策 3）。
 *
 * §2.5：WsMessage union 新增 NodeStatusMessage（node_status / node_online /
 * node_offline / node_removed）；前端 4 個 handler 更新 store + Toast。
 * 型別擴充（NodeStatusMessage / WsMessage union 成員）無法於 runtime 驗證；
 * 本檔驗證 4 型事件的 handler 路由、unmount 移除（disconnect）與斷線自動重連。
 * 既有 useWebSocket 行為不可回歸（勿破壞既有測試）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { defineComponent, ref } from 'vue'
import type { NodeStatus } from '../../types/node'

// ── Fake WebSocket（happy-dom 環境替身）──
class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  static reset() { FakeWebSocket.instances = [] }
  url: string
  onopen: ((e: any) => void) | null = null
  onmessage: ((e: any) => void) | null = null
  onclose: ((e: any) => void) | null = null
  onerror: ((e: any) => void) | null = null
  closeCode: number | null = null
  closed = false

  constructor(url: string) {
    this.url = url
    FakeWebSocket.instances.push(this)
  }

  send() { /* noop */ }

  close(code?: number, _reason?: string) {
    this.closeCode = code ?? 1000
    this.closed = true
  }

  // ── test helpers ──
  fakeOpen() { this.onopen?.({}) }
  fakeClose(code: number) { this.onclose?.({ code, wasClean: code === 1000 }) }
  emit(type: string, payload: Record<string, unknown> = {}) {
    this.onmessage?.({ data: JSON.stringify({ type, ...payload }) })
  }
}

// ── 測試元件：註冊 4 個節點事件 handler ──
const TestComponent = defineComponent({
  setup() {
    const { on } = useWebSocket()
    const received = ref<any[]>([])
    ;(['node_status', 'node_online', 'node_offline', 'node_removed'] as const).forEach(t => {
      on(t, (msg: any) => received.value.push(msg))
    })
    return { received }
  },
  template: '<div class="ws-test">{{ received.length }}|{{ received.map(r => r.type).join(",") }}</div>',
})

import { useWebSocket } from '../useWebSocket'

describe('useWebSocket 節點事件（F-AP-13 ~ F-AP-14）', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    FakeWebSocket.reset()
    vi.stubGlobal('WebSocket', FakeWebSocket)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    document.body.innerHTML = ''
  })

  it('F-AP-13: 4 個節點事件 handler 註冊/路由；unmount 移除（disconnect）', async () => {
    const wrapper = mount(TestComponent)
    const ws = FakeWebSocket.instances[0]
    expect(ws).toBeTruthy()
    ws.fakeOpen()

    // 4 型節點事件皆送達對應 handler（決策 3）
    ws.emit('node_status', { id: 'n1', name: 'web-server-01', active: 'degraded', last_heartbeat: '2026-08-13T08:00:05Z', agent_version: '1.2.0' })
    ws.emit('node_online', { id: 'n1', name: 'web-server-01', active: 'online' })
    ws.emit('node_offline', { id: 'n1', name: 'web-server-01', active: 'offline' })
    ws.emit('node_removed', { id: 'n1', name: 'web-server-01' })
    await nextTick()

    expect(wrapper.find('.ws-test').text()).toContain('4|node_status,node_online,node_offline,node_removed')

    // 非節點事件不觸發節點 handler（handler 依 type 精確匹配）
    ws.emit('status_change', { name: 'nginx.service', active: 'active' })
    await nextTick()
    expect(wrapper.find('.ws-test').text()).toContain('4|')

    // unmount → 移除 handlers（disconnect：close(1000)）
    wrapper.unmount()
    expect(ws.closeCode).toBe(1000)
    expect(ws.closed).toBe(true)
  })

  it('F-AP-14: WS 斷線自動重連，重連後恢復節點狀態即時更新', async () => {
    const wrapper = mount(TestComponent)
    let ws = FakeWebSocket.instances[0]
    ws.fakeOpen()

    // 非正常關閉（code 1006 ≠ 1000）→ 排程重連（exponential：1s → 2s → …）
    ws.fakeClose(1006)
    await vi.advanceTimersByTimeAsync(999)
    expect(FakeWebSocket.instances.length).toBe(1) // 尚未重連

    await vi.advanceTimersByTimeAsync(1)
    expect(FakeWebSocket.instances.length).toBe(2) // 重連建立新連線

    ws = FakeWebSocket.instances[1]
    ws.fakeOpen()
    ws.emit('node_status', { id: 'n1', name: 'web-server-01', active: 'online', last_heartbeat: '2026-08-13T08:00:10Z' })
    await nextTick()

    // 重連後恢復節點狀態即時更新（BDD @integration @websocket）
    expect(wrapper.find('.ws-test').text()).toContain('1|node_status')

    wrapper.unmount()
    expect(ws.closeCode).toBe(1000)
  })

  it('F-AP-13b（型別附註）: NodeStatus 五態型別值齊全（編譯期契約；runtime 僅列舉）', () => {
    const statuses: NodeStatus[] = ['online', 'degraded', 'offline', 'long_offline', 'warning']
    expect(statuses).toHaveLength(5)
    expect(statuses).toContain('online')
    expect(statuses).toContain('long_offline')
  })
})
