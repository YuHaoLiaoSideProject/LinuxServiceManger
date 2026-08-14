/**
 * RED phase — DashboardView.vue node-aware 改造（F-DV-01 ~ F-DV-12）
 * 對應 docs/test-plans/014-multi-node-agent-management測試計畫.md §3.7（決策 8）。
 *
 * DashboardView.vue 目前存在但尚未 node-aware（無 ?node 前綴 / 離線 Banner / in-flight）→
 * 多數行為測試在 Phase 1 為 RED；Phase 2 依 §2.12 改造後轉綠。
 * 依賴（stores/nodes、stores/service、api/client、router、useWebSocket、useServiceFilter、useToast）全部 vi.mock 隔離。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { nextTick, reactive } from 'vue'
import type { Node } from '../../types/node'

const { mockRouterPush, mockToast, mockListServices, mockGetNodeServices, mockNodeServiceAction, mockGetNodeLogs, mockBatchServices, mockStartService, mockStopService, mockRestartService, mockEnableService, mockDisableService } = vi.hoisted(() => ({
  mockRouterPush: vi.fn(),
  mockToast: vi.fn(),
  mockListServices: vi.fn(),
  mockGetNodeServices: vi.fn(),
  mockNodeServiceAction: vi.fn(),
  mockGetNodeLogs: vi.fn(),
  mockBatchServices: vi.fn(),
  mockStartService: vi.fn(),
  mockStopService: vi.fn(),
  mockRestartService: vi.fn(),
  mockEnableService: vi.fn(),
  mockDisableService: vi.fn(),
}))

// ── route mock：reactive，供 F-DV-11 模擬 query 變更 ──
const routeState = reactive<{ query: Record<string, string> }>({ query: {} })

// ── nodes store mock（含 byId / activeNode / inFlight / isNodeActionDisabled）──
const nodesStore = reactive({
  nodes: [] as any[],
  activeNodeId: null as string | null,
  summary: null as any,
  loading: false,
  error: null as string | null,
  inFlight: {} as Record<string, boolean>,
  get activeNode() {
    return this.activeNodeId ? this.byId(this.activeNodeId) ?? null : null
  },
  byId(id: string) {
    return this.nodes.find(n => n.id === id)
  },
  isNodeActionDisabled(nodeId: string, name: string, action: string) {
    const n = this.byId(nodeId)
    return !['online', 'degraded', 'warning'].includes(n?.status ?? '') || !!this.inFlight[`${nodeId}:${name}:${action}`]
  },
  fetchNodes: vi.fn(),
  fetchSummary: vi.fn(),
  setActiveNode(id: string | null) { this.activeNodeId = id },
  applyNodeEvent: vi.fn(),
  markInFlight(nodeId: string, name: string, action: string, inflight: boolean) {
    const key = `${nodeId}:${name}:${action}`
    if (inflight) this.inFlight[key] = true
    else delete this.inFlight[key]
  },
})

// ── service store mock ──
const serviceStore = reactive({
  services: [] as any[],
  loading: false,
  setServices: vi.fn(function (this: any, list: any[]) { this.services = list }),
  updateService: vi.fn(),
  addService: vi.fn(),
  removeService: vi.fn(),
  applySnapshot: vi.fn(),
})

vi.mock('../../stores/nodes', () => ({
  useNodesStore: () => nodesStore,
}))

vi.mock('../../stores/service', () => ({
  useServiceStore: () => serviceStore,
}))

vi.mock('../../stores/auth', () => ({
  useAuthStore: () => ({ username: 'admin', authenticated: true, isLoggedIn: true, logout: vi.fn() }),
}))

vi.mock('../../api/client', () => ({
  listServices: mockListServices,
  startService: mockStartService,
  stopService: mockStopService,
  restartService: mockRestartService,
  enableService: mockEnableService,
  disableService: mockDisableService,
  batchServices: mockBatchServices,
  getNodeServices: mockGetNodeServices,
  nodeServiceAction: mockNodeServiceAction,
  getNodeLogs: mockGetNodeLogs,
}))

vi.mock('../../composables/useToast', () => ({
  useToast: () => ({ showToast: mockToast }),
}))

vi.mock('../../composables/useI18n', () => ({
  useI18n: () => ({
    t: (key: string) => key,
    lang: { value: 'zh-TW' },
    setLang: vi.fn(),
    toggleLang: vi.fn(),
  }),
}))

vi.mock('../../composables/useTheme', () => ({
  useTheme: () => ({ theme: { value: 'light' }, toggleTheme: vi.fn(), setTheme: vi.fn() }),
}))

vi.mock('../../composables/useWebSocket', () => ({
  useWebSocket: () => ({
    status: { value: 'connected' },
    lastUpdate: { value: null },
    isSupported: { value: true },
    on: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
  }),
}))

vi.mock('../../composables/useServiceFilter', () => ({
  useServiceFilter: (services: any) => ({
    statusFilter: { value: 'all' },
    searchText: { value: '' },
    regexMode: { value: false },
    regexError: { value: null },
    filteredServices: services,
    setStatusFilter: vi.fn(),
    clearSearch: vi.fn(),
    toggleRegex: vi.fn(),
    clearAllFilters: vi.fn(),
    initFromQuery: vi.fn(),
  }),
}))

vi.mock('vue-router', () => ({
  useRoute: () => ({ query: routeState.query }),
  useRouter: () => ({ push: mockRouterPush }),
}))

// ── 生產模組：DashboardView.vue（node-aware 改造後行為待 Phase 2）──
import DashboardView from '../DashboardView.vue'

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

const svcNginx = { name: 'nginx.service', load: 'loaded', active: 'active', sub: 'running', locked: false, unitFileState: 'enabled', fragmentPath: '/etc/systemd/system/nginx.service' }
const svcDocker = { name: 'docker.service', load: 'loaded', active: 'active', sub: 'running', locked: false, unitFileState: 'enabled', fragmentPath: '/etc/systemd/system/docker.service' }

const stubs = {
  RouterLink: { props: ['to'], template: '<a :href="typeof to === \'string\' ? to : to.path"><slot /></a>' },
  AppHeader: { template: '<div class="app-header-stub" />' },
  StatsBar: { template: '<div class="statsbar-stub" />' },
  TabsBar: { template: '<div class="tabsbar-stub" />' },
  Toolbar: { template: '<div class="toolbar-stub" />' },
  BatchResultPanel: { template: '<div class="batch-stub" />' },
  ConfirmModal: { template: '<div class="confirm-stub" />' },
  ToastContainer: { template: '<div class="toast-stub" />' },
  ConfigEditorModal: { template: '<div class="config-modal-stub" />' },
  NodeSwitcher: { template: '<div class="node-switcher-stub" />' },
  LogDrawer: {
    props: ['serviceName', 'visible'],
    emits: ['close'],
    template: '<div class="logdrawer-stub">{{ serviceName }}:{{ visible }}</div>',
  },
  ServiceTable: {
    props: ['filteredServices', 'tab', 'loading', 'togglingService', 'expandedService'],
    emits: ['action', 'refresh', 'toggle', 'open-logs', 'clear-filters', 'toggle-select', 'select-all', 'batch-action', 'clear-selection'],
    template: `
      <div class="service-table-stub" :data-expanded="expandedService || ''">
        <div v-for="s in filteredServices" :key="s.name" class="svc-row" :data-name="s.name">
          <span class="svc-name">{{ s.name }}</span>
          <button class="svc-restart" @click="$emit('action', 'restart', s.name)">restart</button>
          <button class="svc-stop" @click="$emit('action', 'stop', s.name)">stop</button>
          <button class="svc-logs" @click="$emit('open-logs', s.name)">logs</button>
        </div>
      </div>`,
  },
}

function mountDash() {
  return mount(DashboardView, { global: { stubs } })
}

function deferred<T = any>() {
  let resolve!: (v: T) => void
  let reject!: (e: any) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

describe('DashboardView node-aware（F-DV）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    routeState.query = {}
    nodesStore.nodes = []
    nodesStore.activeNodeId = null
    nodesStore.inFlight = {}
    serviceStore.services = []
    mockListServices.mockResolvedValue([svcNginx, svcDocker])
    mockGetNodeServices.mockResolvedValue([svcNginx, svcDocker])
    mockNodeServiceAction.mockResolvedValue({ message: '操作成功' })
    mockGetNodeLogs.mockResolvedValue('log lines')
    mockBatchServices.mockResolvedValue({ summary: { total: 1, success: 1, failed: 0 }, results: [] })
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('F-DV-01: 讀取 ?node 設定 active 節點（服務 API 走 /api/v1/nodes/{id}/... 前綴）', async () => {
    routeState.query = { node: 'n1' }
    nodesStore.nodes = [makeNode({ id: 'n1' })]
    const wrapper = mountDash()
    await flushPromises()

    expect(nodesStore.activeNodeId).toBe('n1') // onMounted → setActiveNode
    expect(mockGetNodeServices).toHaveBeenCalledWith('n1')
    wrapper.unmount()
  })

  it('F-DV-02: 服務列表以代理 API 載入（getNodeServices 而非本機 listServices）', async () => {
    routeState.query = { node: 'n1' }
    nodesStore.nodes = [makeNode({ id: 'n1' })]
    const wrapper = mountDash()
    await flushPromises()

    expect(mockGetNodeServices).toHaveBeenCalledWith('n1')
    expect(mockListServices).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('F-DV-03: 操作按鈕發送節點前綴請求 + in-flight 標記 + 按鈕 loading', async () => {
    routeState.query = { node: 'n1' }
    nodesStore.nodes = [makeNode({ id: 'n1', name: 'web-server-01' })]
    const d = deferred()
    mockNodeServiceAction.mockReturnValueOnce(d.promise)
    const wrapper = mountDash()
    await flushPromises()

    await wrapper.find('.svc-restart').trigger('click')
    await nextTick()

    expect(mockNodeServiceAction).toHaveBeenCalledWith('n1', 'nginx.service', 'restart')
    expect(nodesStore.inFlight['n1:nginx.service:restart']).toBe(true) // 操作進行中（BDD @concurrency）
    expect(nodesStore.isNodeActionDisabled('n1', 'nginx.service', 'restart')).toBe(true)

    d.resolve({ message: '已重啟' })
    await flushPromises()
    expect(nodesStore.inFlight['n1:nginx.service:restart']).toBeUndefined() // 完成後恢復可點擊
    wrapper.unmount()
  })

  it('F-DV-04: 操作成功 Toast + 重新載入列表', async () => {
    routeState.query = { node: 'n1' }
    nodesStore.nodes = [makeNode({ id: 'n1', name: 'web-server-01' })]
    mockNodeServiceAction.mockResolvedValue({ message: '已重啟' })
    const wrapper = mountDash()
    await flushPromises()

    await wrapper.find('.svc-restart').trigger('click')
    await flushPromises()

    expect(mockToast).toHaveBeenCalledWith(expect.stringContaining('web-server-01'), 'success')
    expect(mockToast).toHaveBeenCalledWith(expect.stringContaining('已重啟'), 'success')
    // 成功後重新載入服務列表
    expect(mockGetNodeServices).toHaveBeenCalledTimes(2)
    wrapper.unmount()
  })

  it('F-DV-05: 操作失敗 Toast 錯誤 + 狀態不變（500 permission denied）', async () => {
    routeState.query = { node: 'n1' }
    nodesStore.nodes = [makeNode({ id: 'n1', name: 'web-server-01' })]
    const err: any = new Error('Request failed with status code 500')
    err.response = { status: 500, data: { error: 'permission denied' } }
    mockNodeServiceAction.mockRejectedValueOnce(err)
    const wrapper = mountDash()
    await flushPromises()

    await wrapper.find('.svc-restart').trigger('click')
    await flushPromises()

    expect(mockToast).toHaveBeenCalledWith(expect.stringContaining('操作失敗'), 'error')
    expect(mockToast).toHaveBeenCalledWith(expect.stringContaining('permission denied'), 'error')
    expect(nodesStore.inFlight['n1:nginx.service:restart']).toBeUndefined() // in-flight 清除
    wrapper.unmount()
  })

  it('F-DV-06: 操作逾時 Toast + 按鈕恢復可點擊', async () => {
    routeState.query = { node: 'n1' }
    nodesStore.nodes = [makeNode({ id: 'n1', name: 'web-server-01' })]
    const timeoutErr = Object.assign(new Error('timeout of 15000ms exceeded'), { code: 'ECONNABORTED' })
    mockNodeServiceAction.mockRejectedValueOnce(timeoutErr)
    const wrapper = mountDash()
    await flushPromises()

    await wrapper.find('.svc-restart').trigger('click')
    await flushPromises()

    expect(mockToast).toHaveBeenCalledWith(expect.stringContaining('操作逾時'), 'warning')
    expect(mockToast).toHaveBeenCalledWith(expect.stringContaining('nginx.service'), 'warning')
    expect(mockToast).toHaveBeenCalledWith(expect.stringContaining('restart'), 'warning')
    expect(nodesStore.inFlight['n1:nginx.service:restart']).toBeUndefined() // 按鈕恢復
    wrapper.unmount()
  })

  it('F-DV-07: 節點離線 → 操作禁用 + 頂部黃色 Banner', async () => {
    routeState.query = { node: 'n1' }
    nodesStore.nodes = [makeNode({ id: 'n1', name: 'web-server-01', status: 'offline' })]
    const wrapper = mountDash()
    await flushPromises()

    expect(wrapper.find('[data-testid="offline-banner"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="offline-banner"]').text()).toContain('節點已離線，操作不可用')

    // 操作按鈕禁用：嘗試操作不發送任何 nodeServiceAction
    await wrapper.find('.svc-restart').trigger('click')
    await flushPromises()
    expect(mockNodeServiceAction).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('F-DV-08: 同節點同服務 in-flight 禁用（系統拒絕第二個並行操作）', async () => {
    routeState.query = { node: 'n1' }
    nodesStore.nodes = [makeNode({ id: 'n1', name: 'web-server-01', status: 'online' })]
    const d = deferred()
    mockNodeServiceAction.mockReturnValueOnce(d.promise).mockResolvedValue({ message: 'ok' })
    const wrapper = mountDash()
    await flushPromises()

    await wrapper.find('.svc-restart').trigger('click')
    await nextTick()
    expect(mockNodeServiceAction).toHaveBeenCalledTimes(1)
    expect(nodesStore.inFlight['n1:nginx.service:restart']).toBe(true)

    // restart 進行中，第二個 restart 請求被 in-flight 守衛拒絕
    await wrapper.find('.svc-restart').trigger('click')
    await nextTick()
    expect(mockNodeServiceAction).toHaveBeenCalledTimes(1)

    d.resolve({ message: '已重啟' })
    await flushPromises()
    expect(nodesStore.inFlight['n1:nginx.service:restart']).toBeUndefined()
    wrapper.unmount()
  })

  it('F-DV-09: 不同節點可並行（in-flight key 含 nodeId）', async () => {
    // 節點 A：restart 進行中（pending）
    routeState.query = { node: 'n1' }
    nodesStore.nodes = [makeNode({ id: 'n1', name: 'web-server-01', status: 'online' })]
    const dA = deferred()
    mockNodeServiceAction.mockReturnValueOnce(dA.promise)
    const w1 = mountDash()
    await flushPromises()
    await w1.find('.svc-restart').trigger('click')
    await nextTick()
    expect(nodesStore.inFlight['n1:nginx.service:restart']).toBe(true)
    w1.unmount()

    // 節點 B：同一服務 restart 不受節點 A 影響（決策 9：不同節點天然並行）
    routeState.query = { node: 'n2' }
    nodesStore.nodes = [makeNode({ id: 'n2', name: 'db-server-01', status: 'online' })]
    const w2 = mountDash()
    await flushPromises()
    await w2.find('.svc-restart').trigger('click')
    await flushPromises()

    expect(mockNodeServiceAction).toHaveBeenCalledWith('n2', 'nginx.service', 'restart')
    dA.resolve({ message: '已重啟' })
    await flushPromises()
    w2.unmount()
  })

  it('F-DV-10: 檢視日誌走節點端點（getNodeLogs）+ 日誌檢視器顯示', async () => {
    routeState.query = { node: 'n1' }
    nodesStore.nodes = [makeNode({ id: 'n1', name: 'web-server-01' })]
    const wrapper = mountDash()
    await flushPromises()

    await wrapper.find('.svc-logs').trigger('click')
    await flushPromises()

    expect(mockGetNodeLogs).toHaveBeenCalledWith('n1', 'nginx.service')
    expect(wrapper.find('.logdrawer-stub').text()).toContain('nginx.service')
    wrapper.unmount()
  })

  it('F-DV-11: ?service= 初始展開對應服務列（點擊搜尋結果跳轉）', async () => {
    // 初始帶 ?service → 展開（watch 需 immediate 或 onMounted 處理）
    routeState.query = { node: 'n1', service: 'nginx.service' }
    nodesStore.nodes = [makeNode({ id: 'n1' })]
    const wrapper = mountDash()
    await flushPromises()
    expect(wrapper.find('.service-table-stub').attributes('data-expanded')).toBe('nginx.service')

    // 路由變更（?service 新增）→ 展開更新
    routeState.query.service = 'docker.service'
    await nextTick()
    await flushPromises()
    expect(wrapper.find('.service-table-stub').attributes('data-expanded')).toBe('docker.service')
    wrapper.unmount()
  })

  it('F-DV-12: 無 ?node 且無註冊節點 → 維持原單機 Dashboard 行為（本機 /api/v1/services）', async () => {
    routeState.query = {}
    nodesStore.nodes = []
    serviceStore.services = [svcNginx, svcDocker]
    const wrapper = mountDash()
    await flushPromises()

    expect(nodesStore.activeNodeId).toBeNull()
    expect(mockGetNodeServices).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid="offline-banner"]').exists()).toBe(false)
    // 單機路徑：列表資料來自本機來源（serviceStore.setServices 被呼叫）
    expect(serviceStore.setServices).toHaveBeenCalled()
    expect(serviceStore.services.map((s: any) => s.name)).toContain('nginx.service')
    wrapper.unmount()
  })

  it('§2.13（nav-nodes）: AppHeader 主導航新增 Node Management 連結', async () => {
    // AppHeader 使用真實元件：Phase 2 §2.13 在 AppHeader 加入 nav-nodes 導覽連結
    routeState.query = {}
    const wrapper = mount(DashboardView, {
      global: { stubs: { ...stubs, AppHeader: false } },
    })
    await flushPromises()

    const navNodes = wrapper.find('[data-testid="nav-nodes"]')
    expect(navNodes.exists()).toBe(true)
    expect(navNodes.attributes('href')).toBe('/nodes')
    wrapper.unmount()
  })
})
