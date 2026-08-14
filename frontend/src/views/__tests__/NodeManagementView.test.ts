/**
 * RED phase — NodeManagementView.vue（F-NM-01 ~ F-NM-08）
 * 對應 docs/test-plans/014-multi-node-agent-management測試計畫.md §3.6（決策 8）。
 *
 * NodeManagementView.vue 尚未建立 → import 失敗即為 RED。
 * NodeFormModal / ConfirmModal 以 stub 隔離（各自契約另有 F-NF / ConfirmModal 既有測試）；
 * EmptyState 使用真實元件。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { reactive } from 'vue'
import type { Node } from '../../types/node'

const { mockFetchNodes, mockDeleteNode, mockDownloadAgent, mockToast } = vi.hoisted(() => ({
  mockFetchNodes: vi.fn(),
  mockDeleteNode: vi.fn(),
  mockDownloadAgent: vi.fn(),
  mockToast: vi.fn(),
}))

// ── nodes store mock ──
const nodesStore = reactive({
  nodes: [] as any[],
  activeNodeId: null as string | null,
  summary: null as any,
  loading: false,
  error: null as string | null,
  inFlight: {} as Record<string, boolean>,
  byId(id: string) { return this.nodes.find(n => n.id === id) },
  get activeNode() { return this.activeNodeId ? this.byId(this.activeNodeId) ?? null : null },
  isNodeActionDisabled() { return false },
  fetchNodes: mockFetchNodes,
  fetchSummary: vi.fn(),
  setActiveNode(id: string | null) { this.activeNodeId = id },
  applyNodeEvent: vi.fn(),
  markInFlight: vi.fn(),
})

vi.mock('../../stores/nodes', () => ({
  useNodesStore: () => nodesStore,
}))

vi.mock('../../api/client', () => ({
  deleteNode: mockDeleteNode,
  downloadAgent: mockDownloadAgent,
}))

vi.mock('../../composables/useToast', () => ({
  useToast: () => ({ showToast: mockToast }),
}))

vi.mock('../../composables/useI18n', () => ({
  useI18n: () => ({
    t: (key: string) => ({
      'nav.nodes': 'Node Management',
      'nodes.addNode': '新增節點',
      'nodes.colName': '名稱',
      'nodes.colAddress': '位址',
      'nodes.colStatus': '狀態',
      'nodes.colHeartbeat': '最後心跳',
      'nodes.colVersion': '版本',
      'nodes.colActions': '操作',
      'nodes.deleteTitle': '移除節點',
    }[key] ?? key),
    lang: { value: 'zh-TW' },
    setLang: vi.fn(),
    toggleLang: vi.fn(),
  }),
}))

// ── 生產模組：NodeManagementView.vue 尚未建立 → import 失敗即 RED ──
import NodeManagementView from '../NodeManagementView.vue'

// ── 測試資料 ──
let seedNodes: Node[] = []

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

const stubs = {
  NodeFormModal: {
    props: ['node'],
    emits: ['close', 'saved'],
    template: `<div class="node-form-stub" data-testid="node-form-modal">
      <span class="editing-name">{{ node?.name || 'new' }}</span>
      <button class="stub-save" @click="$emit('saved')">save</button>
      <button class="stub-close" @click="$emit('close')">close</button>
    </div>`,
  },
  ConfirmModal: {
    props: ['show', 'message', 'title', 'confirmLabel'],
    emits: ['confirm', 'cancel'],
    template: `<div v-if="show" class="confirm-stub" data-testid="confirm-modal">
      <p class="confirm-msg">{{ message }}</p>
      <button class="stub-confirm" @click="$emit('confirm')">ok</button>
      <button class="stub-cancel" @click="$emit('cancel')">cancel</button>
    </div>`,
  },
}

function mountView() {
  return mount(NodeManagementView, { global: { stubs } })
}

describe('NodeManagementView（F-NM）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    seedNodes = [makeNode(), makeNode({ id: 'n2', name: 'db-server-01', address: '10.0.0.6:8443', status: 'offline' })]
    nodesStore.nodes = []
    nodesStore.loading = false
    mockFetchNodes.mockImplementation(async () => {
      nodesStore.loading = true
      await Promise.resolve()
      nodesStore.nodes = [...seedNodes]
      nodesStore.loading = false
    })
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('F-NM-01: 列表欄位完整（名稱/位址/狀態/最後心跳/版本/操作）+ 新增節點與下載 Agent 按鈕', async () => {
    const wrapper = mountView()
    await flushPromises()

    const rows = wrapper.findAll('[data-testid="node-row"]')
    expect(rows).toHaveLength(2)
    expect(wrapper.text()).toContain('名稱')
    expect(wrapper.text()).toContain('位址')
    expect(wrapper.text()).toContain('狀態')
    expect(wrapper.text()).toContain('最後心跳')
    expect(wrapper.text()).toContain('版本')
    expect(wrapper.text()).toContain('操作')
    expect(wrapper.find('[data-testid="add-node"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('下載 Agent')
    // 每列資料：名稱 / 位址 / 狀態 badge（SVG 圓點 + 文字，非 emoji）
    expect(rows[0].text()).toContain('web-server-01')
    expect(rows[0].text()).toContain('10.0.0.5:8443')
    expect(rows[0].find('.node-status-badge').exists()).toBe(true)
    expect(rows[0].find('.node-status-badge svg circle').exists()).toBe(true)
    expect(rows[0].find('.status-text').text()).toBe('線上')
  })

  it('F-NM-02: 空列表狀態', async () => {
    seedNodes = []
    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.text()).toContain('尚無已註冊節點')
    expect(wrapper.find('[data-testid="add-node"]').exists()).toBe(true)
  })

  it('F-NM-03: 點「新增節點」開啟 NodeFormModal（node=null）', async () => {
    const wrapper = mountView()
    await flushPromises()

    await wrapper.find('[data-testid="add-node"]').trigger('click')
    expect(wrapper.find('[data-testid="node-form-modal"]').exists()).toBe(true)
    expect(wrapper.find('.editing-name').text()).toBe('new')
  })

  it('F-NM-04: 編輯儲存更新列表（saved → 重新 fetchNodes）', async () => {
    const wrapper = mountView()
    await flushPromises()

    // 點第一列「編輯」→ 表單預填
    const editBtn = wrapper.findAll('[data-testid="node-row"]')[0]
      .findAll('button').find(b => b.text().includes('編輯'))!
    await editBtn.trigger('click')
    expect(wrapper.find('[data-testid="node-form-modal"]').exists()).toBe(true)
    expect(wrapper.find('.editing-name').text()).toBe('web-server-01')

    // 模擬伺服器已更新位址 → saved → 重新拉取
    seedNodes[0].address = '10.0.0.9:8443'
    await wrapper.find('.stub-save').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="node-form-modal"]').exists()).toBe(false)
    expect(mockFetchNodes).toHaveBeenCalledTimes(2) // mount + saved
    expect(wrapper.find('[data-testid="node-row"]').text()).toContain('10.0.0.9:8443')
  })

  it('F-NM-05: 點「移除」彈出確認對話框', async () => {
    const wrapper = mountView()
    await flushPromises()

    await wrapper.find('[data-testid="remove-node"]').trigger('click')
    const confirm = wrapper.find('[data-testid="confirm-modal"]')
    expect(confirm.exists()).toBe(true)
    expect(confirm.text()).toContain('確定要移除此節點？所有歷史資料將保留。')
  })

  it('F-NM-06: 確認移除 → DELETE + Toast「節點已移除」+ 節點自列表消失', async () => {
    mockDeleteNode.mockResolvedValue(undefined)
    const wrapper = mountView()
    await flushPromises()

    await wrapper.find('[data-testid="remove-node"]').trigger('click')
    seedNodes = seedNodes.filter(n => n.id !== 'n1') // 伺服器端已移除
    await wrapper.find('.stub-confirm').trigger('click')
    await flushPromises()

    expect(mockDeleteNode).toHaveBeenCalledWith('n1')
    expect(mockToast).toHaveBeenCalledWith('節點已移除', 'success')
    expect(wrapper.findAll('[data-testid="node-row"]')).toHaveLength(1)
  })

  it('F-NM-07: 取消移除無變更', async () => {
    const wrapper = mountView()
    await flushPromises()

    await wrapper.find('[data-testid="remove-node"]').trigger('click')
    await wrapper.find('.stub-cancel').trigger('click')
    await flushPromises()

    expect(mockDeleteNode).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid="confirm-modal"]').exists()).toBe(false)
    expect(wrapper.findAll('[data-testid="node-row"]')).toHaveLength(2)
  })

  it('F-NM-08: 下載 Agent 選架構（amd64 / arm64，Outline ×2）→ GET /agents/download?arch=', async () => {
    URL.createObjectURL = vi.fn(() => 'blob:mock') as any
    URL.revokeObjectURL = vi.fn() as any
    mockDownloadAgent.mockResolvedValue(new Blob(['binary']))
    const wrapper = mountView()
    await flushPromises()

    // 開啟架構選單 → 選 amd64
    await wrapper.findAll('button').find(b => b.text().includes('下載 Agent'))!.trigger('click')
    await wrapper.findAll('button').find(b => b.text() === 'agent-linux-amd64')!.trigger('click')
    expect(mockDownloadAgent).toHaveBeenCalledWith('amd64')

    // 再次開啟 → 選 arm64
    await wrapper.findAll('button').find(b => b.text().includes('下載 Agent'))!.trigger('click')
    await wrapper.findAll('button').find(b => b.text() === 'agent-linux-arm64')!.trigger('click')
    expect(mockDownloadAgent).toHaveBeenCalledWith('arm64')
  })
})
