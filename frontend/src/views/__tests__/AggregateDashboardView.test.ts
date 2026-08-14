/**
 * RED phase — AggregateDashboardView.vue（F-AD-01 ~ F-AD-17）
 * 對應 docs/test-plans/014-multi-node-agent-management測試計畫.md §3.2（決策 8/9）。
 *
 * AggregateDashboardView.vue 尚未建立 → import 失敗即為 RED。
 * NodeCard（§2.7）與 NodeDetailPanel（§2.11）使用真實元件（Phase 2 依規格實作）；
 * store / api / router / i18n / useWebSocket 以 vi.mock 隔離。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { reactive } from 'vue'
import type { Node, NodeSummary, SearchResponse } from '../../types/node'

const { mockFetchNodes, mockFetchSummary, mockSearchServices, mockGetNodeInfo, mockRouterPush, mockWsOn } = vi.hoisted(() => ({
  mockFetchNodes: vi.fn(),
  mockFetchSummary: vi.fn(),
  mockSearchServices: vi.fn(),
  mockGetNodeInfo: vi.fn(),
  mockRouterPush: vi.fn(),
  mockWsOn: vi.fn(),
}))

// ── nodes store mock（真實 NodeCard / NodeDetailPanel 需要 byId / activeNode）──
const nodesStore = reactive({
  nodes: [] as any[],
  activeNodeId: null as string | null,
  summary: null as NodeSummary | null,
  loading: false,
  error: null as string | null,
  inFlight: {} as Record<string, boolean>,
  get activeNode() {
    return this.activeNodeId ? this.nodes.find((n: any) => n.id === this.activeNodeId) ?? null : null
  },
  byId(id: string) {
    return this.nodes.find((n: any) => n.id === id)
  },
  isNodeActionDisabled() { return false },
  fetchNodes: mockFetchNodes,
  fetchSummary: mockFetchSummary,
  setActiveNode(id: string | null) { this.activeNodeId = id },
  applyNodeEvent: vi.fn(),
  markInFlight: vi.fn(),
})

vi.mock('../../stores/nodes', () => ({
  useNodesStore: () => nodesStore,
}))

vi.mock('../../api/client', () => ({
  searchServices: mockSearchServices,
  getNodeInfo: mockGetNodeInfo,
}))

vi.mock('../../composables/useWebSocket', () => ({
  useWebSocket: () => ({
    status: { value: 'connected' },
    lastUpdate: { value: null },
    isSupported: { value: true },
    on: mockWsOn,
    connect: vi.fn(),
    disconnect: vi.fn(),
  }),
}))

vi.mock('../../composables/useI18n', () => ({
  useI18n: () => ({
    t: (key: string) => ({
      'nodes.total': '總節點數',
      'nodes.online': '線上台數',
      'nodes.offline': '離線台數',
      'nodes.totalServices': '總服務數',
      'nodes.activeServices': '執行中',
      'nodes.failedServices': '失敗',
      'nodes.searchPlaceholder': '搜尋服務…',
      'nodes.searchEmpty': '沒有找到匹配的服務',
      'nodes.failedNodes': '個節點無法查詢（離線/逾時）',
      'nav.nodes': 'Node Management',
    }[key] ?? key),
    lang: { value: 'zh-TW' },
    setLang: vi.fn(),
    toggleLang: vi.fn(),
  }),
}))

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: mockRouterPush }),
}))

// ── 生產模組：AggregateDashboardView.vue 尚未建立 → import 失敗即 RED ──
import AggregateDashboardView from '../AggregateDashboardView.vue'

// ── 測試資料 ──
let seedNodes: Node[] = []
let seedSummary: NodeSummary | null = null

function makeNode(overrides: Partial<Node> = {}): Node {
  return {
    id: 'n1',
    name: 'web-server-01',
    address: '10.0.0.5:8443',
    hostname: 'web-server-01',
    status: 'online',
    service_stats: { total: 3, active: 2, failed: 1 },
    created_at: '2026-08-13T08:00:00Z',
    updated_at: '2026-08-13T08:00:00Z',
    ...overrides,
  } as Node
}

function makeSummary(overrides: Partial<NodeSummary> = {}): NodeSummary {
  return {
    total_nodes: 2,
    online: 1,
    degraded: 0,
    offline: 1,
    long_offline: 0,
    warning: 0,
    total_services: 8,
    active_services: 4,
    failed_services: 4,
    ...overrides,
  }
}

function makeSearch(overrides: Partial<SearchResponse> = {}): SearchResponse {
  return {
    results: [],
    failed_nodes: [],
    ...overrides,
  }
}

function mountAggregate() {
  return mount(AggregateDashboardView, {
    global: {
      stubs: {
        RouterLink: {
          props: ['to'],
          template: '<a :href="typeof to === \'string\' ? to : to.path"><slot /></a>',
        },
        // NodeCard / NodeDetailPanel 使用真實元件（Phase 2）
      },
    },
  })
}

describe('AggregateDashboardView（F-AD）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    seedNodes = []
    seedSummary = null
    nodesStore.nodes = []
    nodesStore.activeNodeId = null
    nodesStore.summary = null
    nodesStore.loading = false
    nodesStore.error = null
    nodesStore.inFlight = {}
    mockFetchNodes.mockImplementation(async () => {
      nodesStore.loading = true
      await Promise.resolve()
      nodesStore.nodes = [...seedNodes]
      nodesStore.loading = false
    })
    mockFetchSummary.mockImplementation(async () => {
      nodesStore.summary = seedSummary
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('F-AD-01: 載入中顯示 spinner，並行發送 GET /nodes 與 GET /nodes/summary', async () => {
    seedNodes = [makeNode()]
    nodesStore.loading = true
    const wrapper = mountAggregate()
    await flushPromises()

    expect(mockFetchNodes).toHaveBeenCalled()
    expect(mockFetchSummary).toHaveBeenCalled() // 並行（onMounted 同步呼叫兩者，BDD @entry）
    expect(wrapper.find('[aria-busy="true"], .loading-spinner').exists()).toBe(true)

    nodesStore.loading = false
    await flushPromises()
  })

  it('F-AD-02: 載入完成顯示統計列與 Cards 網格', async () => {
    seedNodes = [
      makeNode(),
      makeNode({ id: 'n2', name: 'db-server-01', status: 'offline', service_stats: { total: 5, active: 2, failed: 3 } }),
    ]
    seedSummary = makeSummary()
    const wrapper = mountAggregate()
    await flushPromises()

    const stats = wrapper.find('[data-testid="aggregate-stats"]')
    expect(stats.exists()).toBe(true)
    expect(stats.text()).toContain('總節點數')
    expect(stats.text()).toContain('2') // total_nodes
    expect(stats.text()).toContain('1') // online
    expect(stats.text()).toContain('8') // total_services
    expect(stats.text()).toContain('4') // active_services

    expect(wrapper.findAll('[data-testid="node-card"]')).toHaveLength(2)
  })

  it('F-AD-03: 每張 Card 資訊完整（名稱 / Hostname / 狀態燈 / 服務統計 / 最後心跳）', async () => {
    seedNodes = [makeNode({ last_heartbeat: '2026-08-13T08:00:00Z' })]
    const wrapper = mountAggregate()
    await flushPromises()

    const card = wrapper.find('[data-testid="node-card"]')
    expect(card.exists()).toBe(true)
    expect(card.text()).toContain('web-server-01')
    expect(card.text()).toContain('web-server-01') // hostname fallback
    // 狀態燈 = SVG 圓點 + 文字（UIUX 決策 3 / WCAG 1.4.1）
    expect(card.find('.node-status-dot svg circle').exists()).toBe(true)
    expect(card.find('.status-text').text()).toBe('線上')
    expect(card.text()).toContain('2/3 執行中')
    expect(card.text()).toContain('最後心跳')
  })

  it('F-AD-04: 無節點空狀態與導引至 Node Management', async () => {
    seedNodes = []
    seedSummary = makeSummary({ total_nodes: 0, online: 0, offline: 0, total_services: 0, active_services: 0, failed_services: 0 })
    const wrapper = mountAggregate()
    await flushPromises()

    expect(wrapper.text()).toContain('尚無已註冊節點，請先新增節點')
    expect(wrapper.find('a[href="/nodes"]').exists()).toBe(true)
  })

  it('F-AD-05: 載入失敗顯示錯誤 + 重試按鈕重新拉取（依賴失敗）', async () => {
    // fetchNodes 失敗 → store.error 設定；視圖需顯示錯誤訊息與重試（Phase 2 需在 §2.6 模板加入錯誤區塊）
    mockFetchNodes.mockImplementation(async () => {
      nodesStore.loading = true
      await Promise.resolve()
      nodesStore.error = '載入失敗：無法連線'
      nodesStore.loading = false
    })
    seedNodes = []
    const wrapper = mountAggregate()
    await flushPromises()

    expect(nodesStore.error).toBe('載入失敗：無法連線')
    expect(wrapper.text()).toContain('載入失敗')

    const retry = wrapper.find('[data-testid="retry"]')
    expect(retry.exists()).toBe(true)
    await retry.trigger('click')
    expect(mockFetchNodes).toHaveBeenCalledTimes(2)
  })

  it('F-AD-06: 搜尋 debounce 300ms（快速連續輸入只發一次）', async () => {
    vi.useFakeTimers()
    mockSearchServices.mockResolvedValue(makeSearch())
    seedNodes = []
    const wrapper = mountAggregate()
    await vi.advanceTimersByTimeAsync(0)

    const input = wrapper.find('[data-testid="node-search"]')
    await input.setValue('nginx')
    await vi.advanceTimersByTimeAsync(299)
    expect(mockSearchServices).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(2)
    expect(mockSearchServices).toHaveBeenCalledTimes(1)
    expect(mockSearchServices).toHaveBeenCalledWith('nginx')

    // 快速連續輸入：只發一次
    await input.setValue('ngi')
    await input.setValue('ngin')
    await input.setValue('nginxx')
    await vi.advanceTimersByTimeAsync(300)
    expect(mockSearchServices).toHaveBeenCalledTimes(2)
  })

  it('F-AD-07: 搜尋結果列表（節點名稱 / 服務名稱 / 狀態）', async () => {
    vi.useFakeTimers()
    mockSearchServices.mockResolvedValue(makeSearch({
      results: [
        { node_id: 'n1', node_name: 'web-server-01', service: 'nginx.service', active: 'active', sub: 'running' },
        { node_id: 'n2', node_name: 'db-server-01', service: 'postgresql.service', active: 'active', sub: 'running' },
      ],
    }))
    seedNodes = []
    const wrapper = mountAggregate()
    await vi.advanceTimersByTimeAsync(0)

    await wrapper.find('[data-testid="node-search"]').setValue('nginx')
    await vi.advanceTimersByTimeAsync(300)

    expect(wrapper.find('[data-testid="search-results"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('web-server-01')
    expect(wrapper.text()).toContain('nginx.service')
    expect(wrapper.text()).toContain('active')
  })

  it('F-AD-08: 搜尋無結果空提示，可關閉返回 Card 視圖', async () => {
    vi.useFakeTimers()
    mockSearchServices.mockResolvedValue(makeSearch())
    seedNodes = [makeNode()]
    const wrapper = mountAggregate()
    await vi.advanceTimersByTimeAsync(0)

    await wrapper.find('[data-testid="node-search"]').setValue('mysql')
    await vi.advanceTimersByTimeAsync(300)

    expect(wrapper.text()).toContain('沒有找到匹配的服務')

    // 關閉搜尋 → 返回 Card 網格
    await wrapper.find('.search-bar button').trigger('click')
    await vi.advanceTimersByTimeAsync(0)
    expect(wrapper.find('[data-testid="search-results"]').exists()).toBe(false)
    expect(wrapper.findAll('[data-testid="node-card"]').length).toBeGreaterThan(0)
  })

  it('F-AD-09: 部分節點失敗標示（failed_nodes 尾部提示，決策 9）', async () => {
    vi.useFakeTimers()
    mockSearchServices.mockResolvedValue(makeSearch({
      results: [
        { node_id: 'n1', node_name: 'web-server-01', service: 'nginx.service', active: 'active', sub: 'running' },
      ],
      failed_nodes: [
        { node_id: 'n2', node_name: 'db-server-01', reason: 'offline' },
      ],
    }))
    seedNodes = []
    const wrapper = mountAggregate()
    await vi.advanceTimersByTimeAsync(0)

    await wrapper.find('[data-testid="node-search"]').setValue('nginx')
    await vi.advanceTimersByTimeAsync(300)

    expect(wrapper.text()).toContain('web-server-01')
    expect(wrapper.text()).toContain('db-server-01')
    expect(wrapper.text()).toContain('個節點無法查詢（離線/逾時）')
  })

  it('F-AD-10: 點擊搜尋結果 → /dashboard?node={id}&service={name}（?service 初始展開）', async () => {
    vi.useFakeTimers()
    mockSearchServices.mockResolvedValue(makeSearch({
      results: [
        { node_id: 'n1', node_name: 'web-server-01', service: 'nginx.service', active: 'active', sub: 'running' },
      ],
    }))
    seedNodes = []
    const wrapper = mountAggregate()
    await vi.advanceTimersByTimeAsync(0)

    await wrapper.find('[data-testid="node-search"]').setValue('nginx')
    await vi.advanceTimersByTimeAsync(300)
    await wrapper.find('[data-testid="search-results"] .search-item').trigger('click')

    expect(mockRouterPush).toHaveBeenCalledWith({
      path: '/dashboard',
      query: { node: 'n1', service: 'nginx.service' },
    })
  })

  it('F-AD-11: 點擊線上節點 Card → /dashboard?node={id}（BDD @switch）', async () => {
    seedNodes = [makeNode({ id: 'n1', name: 'web-server-01', status: 'online' })]
    const wrapper = mountAggregate()
    await flushPromises()

    await wrapper.find('[data-testid="node-card"]').trigger('click')
    expect(mockRouterPush).toHaveBeenCalledWith({ path: '/dashboard', query: { node: 'n1' } })
  })

  it('F-AD-12: 點擊離線節點 Card → 顯示離線資訊面板（非切換視圖）', async () => {
    seedNodes = [makeNode({ id: 'n1', name: 'web-server-01', status: 'offline', last_heartbeat: '2026-08-13T07:00:00Z' })]
    const wrapper = mountAggregate()
    await flushPromises()

    await wrapper.find('[data-testid="node-card"]').trigger('click')

    expect(mockRouterPush).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid="node-detail-panel"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('web-server-01')
    expect(wrapper.text()).toContain('檢查 Agent 是否執行')
  })

  it('F-AD-13: 長期離線（⚫）Card 移至列表底部', async () => {
    seedNodes = [
      makeNode({ id: 'a', name: 'node-a', status: 'online' }),
      makeNode({ id: 'b', name: 'node-b', status: 'offline' }),
      makeNode({ id: 'c', name: 'node-c-long-offline', status: 'long_offline' }),
      makeNode({ id: 'd', name: 'node-d', status: 'degraded' }),
    ]
    const wrapper = mountAggregate()
    await flushPromises()

    const cards = wrapper.findAll('[data-testid="node-card"]')
    expect(cards).toHaveLength(4)
    expect(cards[3].text()).toContain('node-c-long-offline') // ⚫ 位於底部（BDD @offline）
  })

  it('F-AD-14: 5 種狀態燈文字標籤（線上/延遲/離線/長期離線/警告，非 emoji）', async () => {
    seedNodes = [
      makeNode({ id: 'a', name: 'node-a', status: 'online' }),
      makeNode({ id: 'b', name: 'node-b', status: 'degraded' }),
      makeNode({ id: 'c', name: 'node-c', status: 'offline' }),
      makeNode({ id: 'd', name: 'node-d', status: 'long_offline' }),
    ]
    const wrapper = mountAggregate()
    await flushPromises()

    // 每張 Card 均為 SVG 圓點 + 文字標籤（WCAG 1.4.1 雙重傳達）
    const dots = wrapper.findAll('.node-status-dot')
    expect(dots.length).toBe(4)
    expect(dots.every(d => d.find('svg circle').exists())).toBe(true)
    const labels = wrapper.findAll('.status-text').map(d => d.text())
    expect(labels).toEqual(expect.arrayContaining(['線上', '延遲', '離線', '長期離線']))
  })

  it('F-AD-15: 最後心跳相對時間（「最後心跳：5 秒前」）', async () => {
    seedNodes = [makeNode({ id: 'n1', last_heartbeat: new Date(Date.now() - 5000).toISOString() })]
    const wrapper = mountAggregate()
    await flushPromises()

    expect(wrapper.text()).toContain('最後心跳：5 秒前')
  })

  it('F-AD-16: 點「詳情」→ GET /api/v1/nodes/{id}/info + 側面板顯示', async () => {
    seedNodes = [makeNode({
      id: 'n1',
      name: 'web-server-01',
      hostname: 'web-server-01',
      agent_version: '1.2.0',
      status: 'online',
      last_heartbeat: '2026-08-13T08:00:00Z',
    })]
    mockGetNodeInfo.mockResolvedValue({ os: 'Ubuntu 22.04', kernel: '6.2.0', uptime: 3600, cpu: 'x', mem: 'y', disk: 'z' })
    const wrapper = mountAggregate()
    await flushPromises()

    await wrapper.find('[data-testid="node-detail"]').trigger('click')
    await flushPromises()

    expect(mockGetNodeInfo).toHaveBeenCalledWith('n1')
    const panel = wrapper.find('[data-testid="node-detail-panel"]')
    expect(panel.exists()).toBe(true)
    expect(panel.text()).toContain('web-server-01')
    expect(panel.text()).toContain('Ubuntu 22.04')
    expect(panel.text()).toContain('1.2.0')
    expect(panel.text()).toContain('重新連線')
    expect(panel.text()).toContain('編輯設定')
    expect(panel.text()).toContain('移除節點')
  })

  it('F-AD-17: 關閉搜尋返回 Card 視圖', async () => {
    vi.useFakeTimers()
    mockSearchServices.mockResolvedValue(makeSearch({
      results: [{ node_id: 'n1', node_name: 'web-server-01', service: 'nginx.service', active: 'active', sub: 'running' }],
    }))
    seedNodes = [makeNode()]
    const wrapper = mountAggregate()
    await vi.advanceTimersByTimeAsync(0)

    await wrapper.find('[data-testid="node-search"]').setValue('nginx')
    await vi.advanceTimersByTimeAsync(300)
    expect(wrapper.find('[data-testid="search-results"]').exists()).toBe(true)

    await wrapper.find('.search-bar button').trigger('click')
    await vi.advanceTimersByTimeAsync(0)

    expect(wrapper.find('[data-testid="search-results"]').exists()).toBe(false)
    expect(wrapper.findAll('[data-testid="node-card"]').length).toBeGreaterThan(0)
  })
})
