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

const { mockGetNodeInfo } = vi.hoisted(() => ({
  mockGetNodeInfo: vi.fn(),
}))

const nodesStore = reactive({
  nodes: [] as any[],
  byId(id: string) { return this.nodes.find(n => n.id === id) },
})

vi.mock('../../stores/nodes', () => ({
  useNodesStore: () => nodesStore,
}))

vi.mock('../../api/client', () => ({
  getNodeInfo: mockGetNodeInfo,
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

function mountPanel(nodeId = 'n1') {
  return mount(NodeDetailPanel, { props: { nodeId } })
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
})
