/**
 * RED phase — stores/nodes.ts（F-NS-01 ~ F-NS-09）
 * 對應 docs/test-plans/014-multi-node-agent-management測試計畫.md §3.1（決策 8）。
 *
 * stores/nodes.ts 尚未建立 → 此 import 失敗即為 RED。
 * 型別（types/node.ts）尚不存在：以 import type（編譯期剝離）+ 本檔測試用型別處理。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { Node, NodeSummary } from '../../types/node'

const { mockListNodes, mockGetNodesSummary, mockToast } = vi.hoisted(() => ({
  mockListNodes: vi.fn(),
  mockGetNodesSummary: vi.fn(),
  mockToast: vi.fn(),
}))

// store 只依賴 api/client（listNodes / getNodesSummary）與 useToast（applyNodeEvent Toast）
vi.mock('../../api/client', () => ({
  listNodes: mockListNodes,
  getNodesSummary: mockGetNodesSummary,
}))

vi.mock('../../composables/useToast', () => ({
  useToast: () => ({ showToast: mockToast }),
}))

// ── 生產模組：stores/nodes.ts 尚未建立 → import 失敗即 RED ──
import { useNodesStore } from '../nodes'

// ── 測試資料 ──

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

const FULL_SUMMARY: NodeSummary = {
  total_nodes: 6,
  online: 2,
  degraded: 1,
  offline: 1,
  long_offline: 1,
  warning: 1,
  total_services: 30,
  active_services: 25,
  failed_services: 2,
}

describe('stores/nodes（F-NS）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('F-NS-01: fetchNodes 載入節點列表；失敗時 error state 且不覆蓋既有資料', async () => {
    const store = useNodesStore()
    mockListNodes.mockResolvedValue([
      makeNode(),
      makeNode({ id: 'n2', name: 'db-server-01', status: 'offline' }),
    ])

    await store.fetchNodes()

    expect(store.nodes).toHaveLength(2)
    expect(store.nodes[1].name).toBe('db-server-01')
    expect(store.loading).toBe(false)
    expect(store.error).toBeNull()

    // 失敗時不覆蓋既有資料（決策 8：nodes.value = await api.listNodes() 僅成功時賦值）
    mockListNodes.mockRejectedValue({ message: 'network down' })
    await store.fetchNodes()

    expect(store.nodes).toHaveLength(2)
    expect(store.error).toBe('network down')
  })

  it('F-NS-02: fetchSummary 載入統計（9 欄位與後端合約一致）', async () => {
    const store = useNodesStore()
    mockGetNodesSummary.mockResolvedValue(FULL_SUMMARY)

    await store.fetchSummary()

    expect(store.summary).toEqual(FULL_SUMMARY)
    expect(store.summary!.total_nodes).toBe(6)
    expect(store.summary!.online).toBe(2)
    expect(store.summary!.degraded).toBe(1)
    expect(store.summary!.offline).toBe(1)
    expect(store.summary!.long_offline).toBe(1)
    expect(store.summary!.warning).toBe(1)
    expect(store.summary!.total_services).toBe(30)
    expect(store.summary!.active_services).toBe(25)
    expect(store.summary!.failed_services).toBe(2)
  })

  it('F-NS-03: setActiveNode — id 設定 active 節點；null 表示 Aggregate 模式', () => {
    const store = useNodesStore()
    store.nodes = [makeNode({ id: 'n1' })]
    store.setActiveNode('n1')
    expect(store.activeNodeId).toBe('n1')
    expect(store.activeNode?.id).toBe('n1')

    store.setActiveNode(null)
    expect(store.activeNodeId).toBeNull()
    expect(store.activeNode).toBeNull()
  })

  it('F-NS-04: getter onlineNodes / byId', () => {
    const store = useNodesStore()
    store.nodes = [
      makeNode({ id: 'a', status: 'online' }),
      makeNode({ id: 'b', status: 'degraded' }),
      makeNode({ id: 'c', status: 'offline' }),
    ]
    expect(store.onlineNodes.map(n => n.id)).toEqual(['a'])
    expect(store.byId('b')?.status).toBe('degraded')
    expect(store.byId('nope')).toBeUndefined()
  })

  it('F-NS-05: applyNodeEvent node_status — 狀態/時間/版本更新（不 Toast）', () => {
    const store = useNodesStore()
    store.nodes = [makeNode({ id: 'n1', status: 'online' })]
    mockToast.mockClear()

    store.applyNodeEvent({
      type: 'node_status',
      id: 'n1',
      name: 'web-server-01',
      active: 'degraded',
      last_heartbeat: '2026-08-13T08:00:05Z',
      agent_version: '1.2.0',
      timestamp: '2026-08-13T08:00:05Z',
    })

    expect(store.byId('n1')!.status).toBe('degraded')
    expect(store.byId('n1')!.last_heartbeat).toBe('2026-08-13T08:00:05Z')
    expect(store.byId('n1')!.agent_version).toBe('1.2.0')
    expect(mockToast).not.toHaveBeenCalled() // node_status 不 Toast（決策 3）
  })

  it('F-NS-06: node_online 事件 — 狀態 → online + Toast「已恢復連線」', () => {
    const store = useNodesStore()
    store.nodes = [makeNode({ id: 'n1', status: 'offline' })]

    store.applyNodeEvent({ type: 'node_online', id: 'n1', name: 'web-server-01', active: 'online' })

    expect(store.byId('n1')!.status).toBe('online')
    expect(mockToast).toHaveBeenCalledWith('web-server-01 已恢復連線', 'success')
  })

  it('F-NS-07: node_offline 事件 — 狀態 → offline + Toast「{name} 已離線」', () => {
    const store = useNodesStore()
    store.nodes = [makeNode({ id: 'n1', status: 'online' })]

    store.applyNodeEvent({ type: 'node_offline', id: 'n1', name: 'web-server-01', active: 'offline' })

    expect(store.byId('n1')!.status).toBe('offline')
    expect(mockToast).toHaveBeenCalledWith('web-server-01 已離線', 'warning')
  })

  it('F-NS-08: node_removed 事件 — 節點從 nodes 移除（無需重整頁面）', () => {
    const store = useNodesStore()
    store.nodes = [
      makeNode({ id: 'n1' }),
      makeNode({ id: 'n2', name: 'db-server-01' }),
    ]

    store.applyNodeEvent({ type: 'node_removed', id: 'n1', name: 'web-server-01' })

    expect(store.nodes.map(n => n.id)).toEqual(['n2'])
    expect(mockToast).not.toHaveBeenCalled()
  })

  it('F-NS-09: 統計計算分類正確（線上嚴格計 status==online、離線 = offline+long_offline）', async () => {
    const store = useNodesStore()
    const nodes = [
      makeNode({ id: 'a', status: 'online' }),
      makeNode({ id: 'b', status: 'online' }),
      makeNode({ id: 'c', status: 'degraded' }),
      makeNode({ id: 'd', status: 'offline' }),
      makeNode({ id: 'e', status: 'long_offline' }),
      makeNode({ id: 'f', status: 'warning' }),
    ]
    mockListNodes.mockResolvedValue(nodes)
    await store.fetchNodes()
    mockGetNodesSummary.mockResolvedValue(FULL_SUMMARY)
    await store.fetchSummary()

    expect(store.summary!.total_nodes).toBe(6)
    // 線上台數嚴格計 status==online（degraded/warning 為獨立欄位，決策 3）
    const strictOnline = store.nodes.filter(n => n.status === 'online').length
    expect(store.summary!.online).toBe(strictOnline)
    expect(store.summary!.online).toBe(2)
    expect(store.summary!.degraded).toBe(1)
    expect(store.summary!.warning).toBe(1)
    // 離線台數 = offline + long_offline
    const offlineTotal = store.nodes.filter(n => n.status === 'offline' || n.status === 'long_offline').length
    expect(store.summary!.offline + store.summary!.long_offline).toBe(offlineTotal)
    expect(store.summary!.offline + store.summary!.long_offline).toBe(2)
  })

  it('F-NS-10（F-DV-09 支撐）: inFlight key 含 nodeId — 不同節點/不同服務可並行', () => {
    const store = useNodesStore()
    store.nodes = [
      makeNode({ id: 'n1', status: 'online' }),
      makeNode({ id: 'n2', status: 'online' }),
    ]

    store.markInFlight('n1', 'nginx.service', 'restart', true)
    expect(store.isNodeActionDisabled('n1', 'nginx.service', 'restart')).toBe(true)
    // 同服務不同節點：不受影響（決策 9：key 含 nodeId）
    expect(store.isNodeActionDisabled('n2', 'nginx.service', 'restart')).toBe(false)
    // 同節點不同服務：不受影響
    expect(store.isNodeActionDisabled('n1', 'docker.service', 'restart')).toBe(false)

    store.markInFlight('n1', 'nginx.service', 'restart', false)
    expect(store.isNodeActionDisabled('n1', 'nginx.service', 'restart')).toBe(false)
  })
})
