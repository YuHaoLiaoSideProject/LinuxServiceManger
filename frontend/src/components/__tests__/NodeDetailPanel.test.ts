/**
 * RED phase — NodeDetailPanel.vue（F-ND-01 ~ F-ND-03）
 * 對應 docs/test-plans/014-multi-node-agent-management測試計畫.md §3.8（決策 8）。
 *
 * NodeDetailPanel.vue 尚未建立 → import 失敗即為 RED。
 * 線上節點：GET /api/v1/nodes/{id}/info；離線節點：離線診斷（不呼叫 info）；
 * warning 節點：版本警告 Tooltip（§2.11）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { reactive } from 'vue'
import type { Node } from '../../types/node'

const { mockGetNodeInfo, mockDeleteNode, mockReconnectNode, mockToast, mockFetchNodes } = vi.hoisted(() => ({
  mockGetNodeInfo: vi.fn(),
  mockDeleteNode: vi.fn(),
  mockReconnectNode: vi.fn(),
  mockToast: vi.fn(),
  mockFetchNodes: vi.fn(),
}))

const nodesStore = reactive({
  nodes: [] as any[],
  byId(id: string) { return this.nodes.find(n => n.id === id) },
  fetchNodes: mockFetchNodes,
})

vi.mock('../../stores/nodes', () => ({
  useNodesStore: () => nodesStore,
}))

vi.mock('../../api/client', () => ({
  getNodeInfo: mockGetNodeInfo,
  deleteNode: mockDeleteNode,
  reconnectNode: mockReconnectNode,
}))

vi.mock('../../composables/useToast', () => ({
  useToast: () => ({ showToast: mockToast }),
}))

// ── 生產模組：NodeDetailPanel.vue 尚未建立 → import 失敗即 RED ──
import NodeDetailPanel from '../NodeDetailPanel.vue'

function makeNode(overrides: Partial<Node> = {}): Node {
  return {
    id: 'n1',
    name: 'web-server-01',
    address: '10.0.0.5:8443',
    hostname: 'web-server-01',
    agent_version: '1.2.0',
    os: 'Ubuntu 22.04',
    status: 'online',
    service_stats: { total: 3, active: 2, failed: 1 },
    created_at: '2026-08-13T08:00:00Z',
    updated_at: '2026-08-13T08:00:00Z',
    ...overrides,
  } as Node
}

const confirmStub = {
  props: ['show', 'message', 'title', 'confirmLabel'],
  emits: ['confirm', 'cancel'],
  template: `<div v-if="show" class="confirm-stub" data-testid="confirm-modal">
    <p class="confirm-msg">{{ message }}</p>
    <button class="stub-confirm" @click="$emit('confirm')">ok</button>
    <button class="stub-cancel" @click="$emit('cancel')">cancel</button>
  </div>`,
}

function mountPanel(nodeId = 'n1') {
  return mount(NodeDetailPanel, { props: { nodeId }, global: { stubs: { ConfirmModal: confirmStub } } })
}

describe('NodeDetailPanel（F-ND）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    nodesStore.nodes = []
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('F-ND-01: 線上節點資訊面板（GET info + 名稱/Hostname/版本/OS/最後心跳 + 重新連線/編輯/移除）', async () => {
    nodesStore.nodes = [makeNode({ id: 'n1', last_heartbeat: '2026-08-13T08:00:00Z' })]
    mockGetNodeInfo.mockResolvedValue({ os: 'Ubuntu 22.04', kernel: '6.2.0', uptime: 3600, cpu: 'x', mem: 'y', disk: 'z' })
    const wrapper = mountPanel('n1')
    await flushPromises()

    expect(mockGetNodeInfo).toHaveBeenCalledWith('n1')
    const panel = wrapper.find('[data-testid="node-detail-panel"]')
    expect(panel.exists()).toBe(true)
    expect(panel.text()).toContain('web-server-01')
    expect(panel.text()).toContain('web-server-01') // Hostname
    expect(panel.text()).toContain('1.2.0') // Agent 版本
    expect(panel.text()).toContain('Ubuntu 22.04') // OS
    expect(panel.text()).toContain('2026-08-13T08:00:00Z') // 最後心跳
    expect(panel.text()).toContain('重新連線')
    expect(panel.text()).toContain('編輯設定')
    expect(panel.text()).toContain('移除節點')
  })

  it('F-ND-02: 離線診斷面板（不呼叫 info；顯示最後心跳/操作建議/重新連線/移除，無編輯設定）', async () => {
    nodesStore.nodes = [makeNode({
      id: 'n1',
      status: 'offline',
      hostname: 'web-server-01',
      agent_version: '1.2.0',
      last_heartbeat: '2026-08-13T07:00:00Z',
    })]
    const wrapper = mountPanel('n1')
    await flushPromises()

    expect(mockGetNodeInfo).not.toHaveBeenCalled() // 離線時 info 不可得
    const panel = wrapper.find('[data-testid="node-detail-panel"]')
    expect(panel.exists()).toBe(true)
    expect(panel.text()).toContain('web-server-01') // Hostname
    expect(panel.text()).toContain('1.2.0') // Agent 版本
    expect(panel.text()).toContain('2026-08-13T07:00:00Z') // 最後心跳時間
    expect(panel.text()).toContain('檢查 Agent 是否執行') // 操作建議
    expect(panel.text()).toContain('重新連線')
    expect(panel.text()).toContain('移除節點')
    expect(panel.text()).not.toContain('編輯設定')
  })

  it('F-ND-03: 版本不相容警告 Tooltip（status=warning、agent_version=v1.0 → 🟡 + 建議升級 v1.2+）', async () => {
    nodesStore.nodes = [makeNode({ id: 'n1', status: 'warning', agent_version: 'v1.0' })]
    const wrapper = mountPanel('n1')
    await flushPromises()

    const panel = wrapper.find('[data-testid="node-detail-panel"]')
    expect(panel.text()).toContain('⚠')
    expect(panel.text()).toContain('Agent 版本過舊')
    expect(panel.text()).toContain('v1.0')
    expect(panel.text()).toContain('建議升級至 v1.2+')
  })

  // ══════════════════════════════════════════════════════════
  // 缺口 #3：動作按鈕接線（重新連線 / 編輯設定 / 移除節點）
  // ══════════════════════════════════════════════════════════

  it('F-ND-04: 移除節點 → ConfirmModal → 確認 → DELETE + Toast「節點已移除」+ close + store 更新', async () => {
    nodesStore.nodes = [makeNode({ id: 'n1' })]
    mockDeleteNode.mockResolvedValue(undefined)
    const wrapper = mountPanel('n1')
    await flushPromises()

    await wrapper.find('[data-testid="remove-node"]').trigger('click')
    const confirm = wrapper.find('[data-testid="confirm-modal"]')
    expect(confirm.exists()).toBe(true)
    expect(confirm.text()).toContain('確定要移除此節點？所有歷史資料將保留。')

    await wrapper.find('.stub-confirm').trigger('click')
    await flushPromises()

    expect(mockDeleteNode).toHaveBeenCalledWith('n1')
    expect(mockToast).toHaveBeenCalledWith('節點已移除', 'success')
    expect(wrapper.emitted('close')).toBeTruthy()
    expect(mockFetchNodes).toHaveBeenCalled()
  })

  it('F-ND-05: 取消移除 → 不呼叫 DELETE、面板不關閉', async () => {
    nodesStore.nodes = [makeNode({ id: 'n1' })]
    const wrapper = mountPanel('n1')
    await flushPromises()

    await wrapper.find('[data-testid="remove-node"]').trigger('click')
    await wrapper.find('.stub-cancel').trigger('click')
    await flushPromises()

    expect(mockDeleteNode).not.toHaveBeenCalled()
    expect(wrapper.emitted('close')).toBeFalsy()
    expect(wrapper.find('[data-testid="confirm-modal"]').exists()).toBe(false)
  })

  it('F-ND-06: 編輯設定 → emit edit（父層開 NodeFormModal 預填）', async () => {
    nodesStore.nodes = [makeNode({ id: 'n1', status: 'online' })]
    const wrapper = mountPanel('n1')
    await flushPromises()

    await wrapper.find('[data-testid="edit-node"]').trigger('click')
    expect(wrapper.emitted('edit')).toBeTruthy()
  })

  it('F-ND-07: 重新連線成功 → Toast「節點已重新連線」+ store 更新', async () => {
    nodesStore.nodes = [makeNode({ id: 'n1' })]
    mockReconnectNode.mockResolvedValue(makeNode({ id: 'n1' }))
    const wrapper = mountPanel('n1')
    await flushPromises()

    await wrapper.find('[data-testid="reconnect-node"]').trigger('click')
    await flushPromises()

    expect(mockReconnectNode).toHaveBeenCalledWith('n1')
    expect(mockToast).toHaveBeenCalledWith('節點已重新連線', 'success')
    expect(mockFetchNodes).toHaveBeenCalled()
  })

  it('F-ND-08: 重新連線失敗 → Toast「無法連線：{error}」error、不更新 store', async () => {
    nodesStore.nodes = [makeNode({ id: 'n1' })]
    mockReconnectNode.mockRejectedValue({ response: { data: { error: 'node offline' } } })
    const wrapper = mountPanel('n1')
    await flushPromises()

    await wrapper.find('[data-testid="reconnect-node"]').trigger('click')
    await flushPromises()

    expect(mockToast).toHaveBeenCalledWith('無法連線：node offline', 'error')
    expect(mockFetchNodes).not.toHaveBeenCalled()
  })

  it('F-ND-09: 重新連線期間按鈕 loading spinner + 禁用（防重複點擊）', async () => {
    nodesStore.nodes = [makeNode({ id: 'n1' })]
    let resolveReconnect!: (v: any) => void
    mockReconnectNode.mockReturnValue(new Promise(resolve => { resolveReconnect = resolve }))
    const wrapper = mountPanel('n1')
    await flushPromises()

    await wrapper.find('[data-testid="reconnect-node"]').trigger('click')
    await flushPromises()

    const btn = wrapper.find('[data-testid="reconnect-node"]')
    expect((btn.element as HTMLButtonElement).disabled).toBe(true)
    expect(btn.find('.spinner-sm').exists()).toBe(true)

    resolveReconnect(makeNode({ id: 'n1' }))
    await flushPromises()
    expect((wrapper.find('[data-testid="reconnect-node"]').element as HTMLButtonElement).disabled).toBe(false)
  })
})
