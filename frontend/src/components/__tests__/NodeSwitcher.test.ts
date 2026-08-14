/**
 * RED phase — NodeSwitcher.vue（F-SW-01 ~ F-SW-05）
 * 對應 docs/test-plans/014-multi-node-agent-management測試計畫.md §3.4（決策 8）。
 *
 * NodeSwitcher.vue 尚未建立 → import 失敗即為 RED。
 * 「服務列表重新載入」（F-SW-04）為 DashboardView 於 route push 後 remount 的職責，
 * 本元件層僅驗證 setActiveNode + router.push（§2.8）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { reactive } from 'vue'
import type { Node } from '../../types/node'

const { mockRouterPush } = vi.hoisted(() => ({
  mockRouterPush: vi.fn(),
}))

const nodesStore = reactive({
  nodes: [] as any[],
  activeNodeId: null as string | null,
  summary: null as any,
  loading: false,
  error: null as string | null,
  inFlight: {} as Record<string, boolean>,
  get activeNode() { return this.activeNodeId ? this.nodes.find((n: any) => n.id === this.activeNodeId) ?? null : null },
  byId(id: string) { return this.nodes.find((n: any) => n.id === id) },
  isNodeActionDisabled() { return false },
  fetchNodes: vi.fn(),
  fetchSummary: vi.fn(),
  setActiveNode(id: string | null) { this.activeNodeId = id },
  applyNodeEvent: vi.fn(),
  markInFlight: vi.fn(),
})

vi.mock('../../stores/nodes', () => ({
  useNodesStore: () => nodesStore,
}))

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: mockRouterPush }),
}))

// ── 生產模組：NodeSwitcher.vue 尚未建立 → import 失敗即 RED ──
import NodeSwitcher from '../NodeSwitcher.vue'

function makeNode(overrides: Partial<Node> = {}): Node {
  return {
    id: 'n1',
    name: 'web-server-01',
    address: '10.0.0.5:8443',
    status: 'online',
    service_stats: { total: 3, active: 2, failed: 1 },
    created_at: '2026-08-13T08:00:00Z',
    updated_at: '2026-08-13T08:00:00Z',
    ...overrides,
  } as Node
}

function mountSwitcher() {
  return mount(NodeSwitcher)
}

describe('NodeSwitcher（F-SW）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    nodesStore.nodes = []
    nodesStore.activeNodeId = null
  })

  it('F-SW-01: 顯示目前節點名稱；無 active → 「所有節點」', () => {
    nodesStore.nodes = [makeNode({ id: 'n1', name: 'web-server-01' })]
    nodesStore.activeNodeId = 'n1'
    let wrapper = mountSwitcher()
    expect(wrapper.find('[data-testid="node-switcher"]').text()).toContain('web-server-01')

    nodesStore.activeNodeId = null
    wrapper = mountSwitcher()
    expect(wrapper.find('[data-testid="node-switcher"]').text()).toContain('所有節點')
  })

  it('F-SW-02: 下拉列出所有節點 + 狀態燈（SVG 圓點 + 文字，非 emoji）', async () => {
    nodesStore.nodes = [
      makeNode({ id: 'a', name: 'node-a', status: 'online' }),
      makeNode({ id: 'b', name: 'node-b', status: 'degraded' }),
      makeNode({ id: 'c', name: 'node-c', status: 'offline' }),
      makeNode({ id: 'd', name: 'node-d', status: 'long_offline' }),
    ]
    const wrapper = mountSwitcher()
    await wrapper.find('[data-testid="node-switcher"]').trigger('click')

    const options = wrapper.findAll('[data-testid="node-option"]')
    expect(options).toHaveLength(4)
    expect(options[0].text()).toContain('node-a')
    // 每個選項皆有 SVG 圓點
    expect(options.every(o => o.find('.node-status-dot svg circle').exists())).toBe(true)
    // 非 online 選項顯示狀態文字標籤（延遲/離線/長期離線）
    expect(options[1].text()).toContain('延遲')
    expect(options[2].text()).toContain('離線')
    expect(options[3].text()).toContain('長期離線')
  })

  it('F-SW-03: 目前節點選項反白（.active）', async () => {
    nodesStore.nodes = [
      makeNode({ id: 'a', name: 'node-a', status: 'online' }),
      makeNode({ id: 'b', name: 'node-b', status: 'offline' }),
    ]
    nodesStore.activeNodeId = 'a'
    const wrapper = mountSwitcher()
    await wrapper.find('[data-testid="node-switcher"]').trigger('click')

    const options = wrapper.findAll('[data-testid="node-option"]')
    expect(options[0].classes()).toContain('active')
    expect(options[1].classes()).not.toContain('active')
  })

  it('F-SW-04: 選取節點 → setActiveNode(id) + router → /dashboard?node={id}', async () => {
    nodesStore.nodes = [
      makeNode({ id: 'a', name: 'node-a', status: 'online' }),
      makeNode({ id: 'b', name: 'db-server-01', status: 'online' }),
    ]
    const wrapper = mountSwitcher()
    await wrapper.find('[data-testid="node-switcher"]').trigger('click')

    const options = wrapper.findAll('[data-testid="node-option"]')
    await options.find(o => o.text().includes('db-server-01'))!.trigger('click')

    expect(nodesStore.activeNodeId).toBe('b')
    expect(mockRouterPush).toHaveBeenCalledWith({ path: '/dashboard', query: { node: 'b' } })
  })

  it('F-SW-05: 「所有節點」→ setActiveNode(null) + router → /（返回 Aggregate）', async () => {
    nodesStore.nodes = [makeNode({ id: 'a', name: 'node-a', status: 'online' })]
    nodesStore.activeNodeId = 'a'
    const wrapper = mountSwitcher()
    await wrapper.find('[data-testid="node-switcher"]').trigger('click')

    // 下拉第一列「所有節點」選項（trigger 按鈕此時顯示 node-a ▾，不與選項混淆）
    const allOption = wrapper.findAll('button').find(b => b.text() === '所有節點')!
    await allOption.trigger('click')

    expect(nodesStore.activeNodeId).toBeNull()
    expect(mockRouterPush).toHaveBeenCalledWith({ path: '/' })
    await flushPromises()
  })
})
