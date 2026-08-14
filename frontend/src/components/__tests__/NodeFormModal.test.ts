/**
 * RED phase — NodeFormModal.vue（F-NF-01 ~ F-NF-11）
 * 對應 docs/test-plans/014-multi-node-agent-management測試計畫.md §3.5（決策 5/8）。
 *
 * NodeFormModal.vue 尚未建立 → import 失敗即為 RED。
 * Modal 依 §2.9 為一般 DOM（無 Teleport）→ 以 wrapper 內查詢。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import type { Node } from '../../types/node'

const { mockCreateNode, mockUpdateNode, mockTestConnection, mockToast } = vi.hoisted(() => ({
  mockCreateNode: vi.fn(),
  mockUpdateNode: vi.fn(),
  mockTestConnection: vi.fn(),
  mockToast: vi.fn(),
}))

vi.mock('../../api/client', () => ({
  createNode: mockCreateNode,
  updateNode: mockUpdateNode,
  testConnection: mockTestConnection,
}))

vi.mock('../../composables/useToast', () => ({
  useToast: () => ({ showToast: mockToast }),
}))

// ── 生產模組：NodeFormModal.vue 尚未建立 → import 失敗即 RED ──
import NodeFormModal from '../NodeFormModal.vue'

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

function mountForm(node: Node | null = null) {
  return mount(NodeFormModal, { props: { node } })
}

async function fillForm(wrapper: ReturnType<typeof mountForm>, fields: { name?: string; address?: string; token?: string }) {
  if (fields.name !== undefined) await wrapper.find('[data-testid="node-name"]').setValue(fields.name)
  if (fields.address !== undefined) await wrapper.find('[data-testid="node-address"]').setValue(fields.address)
  if (fields.token !== undefined) await wrapper.find('input[type="password"]').setValue(fields.token)
}

async function submitForm(wrapper: ReturnType<typeof mountForm>) {
  await wrapper.find('form').trigger('submit')
}

function apiError(status: number, error: string): any {
  const e: any = new Error(`Request failed with status code ${status}`)
  e.response = { status, data: { error } }
  return e
}

describe('NodeFormModal（F-NF）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('F-NF-01: Modal 欄位完整（名稱* / 位址* / TLS 指紋 / Token / 備註 + 測試連線/註冊/取消）', () => {
    const wrapper = mountForm()
    expect(wrapper.find('[data-testid="node-name"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="node-address"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('TLS 憑證指紋（選填）')
    expect(wrapper.text()).toContain('API Token（選填）')
    expect(wrapper.text()).toContain('備註（選填）')
    expect(wrapper.find('[data-testid="test-connection"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="node-save"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('取消')
    // 新增模式：註冊按鈕
    expect(wrapper.find('[data-testid="node-save"]').text()).toContain('註冊')
  })

  it('F-NF-02: 必填欄位缺失攔截 — 不發送 POST /api/v1/nodes + 紅色標示', async () => {
    const wrapper = mountForm()
    await submitForm(wrapper)

    expect(mockCreateNode).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid="node-name"]').classes()).toContain('field-error')
    expect(wrapper.find('[data-testid="node-address"]').classes()).toContain('field-error')
    expect(wrapper.text()).toContain('節點名稱為必填')
    expect(wrapper.text()).toContain('Agent 位址為必填')
  })

  it('F-NF-03: 測試連線 loading — 按鈕 disabled + POST /nodes/test-connection', async () => {
    let resolveTest!: (v: any) => void
    mockTestConnection.mockImplementation(() => new Promise((res) => { resolveTest = res }))
    const wrapper = mountForm()
    await fillForm(wrapper, { name: 'web-server-01', address: '10.0.0.5:8443' })

    await wrapper.find('[data-testid="test-connection"]').trigger('click')
    await flushPromises()

    expect(mockTestConnection).toHaveBeenCalledWith(expect.objectContaining({ address: '10.0.0.5:8443' }))
    expect((wrapper.find('[data-testid="test-connection"]').attributes('disabled'))).toBeDefined()

    resolveTest({ version: '1.2.3', hostname: 'web-server-01', os: 'Ubuntu 22.04', uptime: 100 })
    await flushPromises()
  })

  it('F-NF-04: 測試連線成功 → 綠色提示（Agent 版本/hostname/OS）；Modal 保持開啟', async () => {
    mockTestConnection.mockResolvedValue({ version: '1.2.3', hostname: 'web-server-01', os: 'Ubuntu 22.04', uptime: 100 })
    const wrapper = mountForm()
    await fillForm(wrapper, { name: 'web-server-01', address: '10.0.0.5:8443' })

    await wrapper.find('[data-testid="test-connection"]').trigger('click')
    await flushPromises()

    const result = wrapper.find('.test-result')
    expect(result.exists()).toBe(true)
    expect(result.classes()).toContain('test-ok')
    expect(result.text()).toContain('連線成功 — Agent v1.2.3 @ web-server-01 (Ubuntu 22.04)')
    expect(wrapper.emitted('close')).toBeUndefined() // Modal 保持開啟
  })

  it('F-NF-05: 測試連線失敗（Outline ×2：connection refused / TLS certificate expired）→ 紅色提示可重試', async () => {
    const failures = [
      apiError(502, 'connection refused'),
      apiError(502, 'TLS 憑證驗證失敗：certificate expired'),
    ]
    for (const err of failures) {
      mockTestConnection.mockRejectedValueOnce(err)
      const wrapper = mountForm()
      await fillForm(wrapper, { name: 'web-server-01', address: '10.0.0.5:8443' })

      await wrapper.find('[data-testid="test-connection"]').trigger('click')
      await flushPromises()

      const result = wrapper.find('.test-result')
      expect(result.classes()).toContain('test-fail')
      expect(result.text()).toContain('無法連線：')
      expect(result.text()).toContain(err.response.data.error)
      // 表單內容保留可修改重試
      expect((wrapper.find('[data-testid="node-address"]').element as HTMLInputElement).value).toBe('10.0.0.5:8443')
    }
  })

  it('F-NF-06: 註冊成功（線上）→ emit saved + Toast「節點 X 已註冊並上線」', async () => {
    mockCreateNode.mockResolvedValue(makeNode({ id: 'n1', name: 'web-server-01', status: 'online' }))
    const wrapper = mountForm()
    await fillForm(wrapper, { name: 'web-server-01', address: '10.0.0.5:8443', token: 'lsm_node_x' })
    await submitForm(wrapper)
    await flushPromises()

    expect(mockCreateNode).toHaveBeenCalledWith(expect.objectContaining({ name: 'web-server-01', address: '10.0.0.5:8443', token: 'lsm_node_x' }))
    expect(mockToast).toHaveBeenCalledWith('節點 web-server-01 已註冊並上線', 'success')
    expect(wrapper.emitted('saved')).toBeTruthy()
  })

  it('F-NF-07: 名稱重複（409）→ Toast「節點名稱重複，請使用不同名稱」；Modal 保持開啟', async () => {
    mockCreateNode.mockRejectedValueOnce(apiError(409, '節點名稱重複'))
    const wrapper = mountForm()
    await fillForm(wrapper, { name: 'web-server-01', address: '10.0.0.5:8443', token: 'lsm_node_x' })
    await submitForm(wrapper)
    await flushPromises()

    expect(mockToast).toHaveBeenCalledWith('節點名稱重複，請使用不同名稱', 'error')
    expect(wrapper.emitted('saved')).toBeUndefined()
    expect(wrapper.emitted('close')).toBeUndefined() // Modal 保持開啟供修改
  })

  it('F-NF-08: 位址不可達仍註冊（離線）→ Toast「節點 X 已註冊但無法連線」', async () => {
    mockCreateNode.mockResolvedValue(makeNode({ id: 'n2', name: 'db-server-01', status: 'offline' }))
    const wrapper = mountForm()
    await fillForm(wrapper, { name: 'db-server-01', address: '10.0.0.9:8443', token: 'lsm_node_y' })
    await submitForm(wrapper)
    await flushPromises()

    expect(mockToast).toHaveBeenCalledWith('節點 db-server-01 已註冊但無法連線', 'warning')
    expect(wrapper.emitted('saved')).toBeTruthy()
  })

  it('F-NF-09: 取消關閉無變更', async () => {
    const wrapper = mountForm()
    await fillForm(wrapper, { name: 'web-server-01' })

    await wrapper.findAll('button').find(b => b.text().includes('取消'))!.trigger('click')

    expect(wrapper.emitted('close')).toBeTruthy()
    expect(mockCreateNode).not.toHaveBeenCalled()
  })

  it('F-NF-10: 編輯模式預填（名稱/位址/備註）；Token 留空顯示「留空表示不變更」', async () => {
    const node = makeNode({ id: 'n1', name: 'web-server-01', address: '10.0.0.5:8443', notes: 'prod', token: 'lsm_node_****xxxx' })
    const wrapper = mountForm(node)

    expect((wrapper.find('[data-testid="node-name"]').element as HTMLInputElement).value).toBe('web-server-01')
    expect((wrapper.find('[data-testid="node-address"]').element as HTMLInputElement).value).toBe('10.0.0.5:8443')
    // 備註預填
    const inputs = wrapper.findAll('input')
    expect((inputs[inputs.length - 1].element as HTMLInputElement).value).toBe('prod')
    // token 不預填 masked 值
    expect((wrapper.find('input[type="password"]').element as HTMLInputElement).value).toBe('')
    expect((wrapper.find('input[type="password"]').element as HTMLInputElement).placeholder).toContain('留空表示不變更')
    // 儲存 → PUT（token 留空表示不變更，決策 5）
    mockUpdateNode.mockResolvedValue(node)
    await wrapper.findAll('button').find(b => b.text().includes('儲存'))!.trigger('click')
    await flushPromises()
    expect(mockUpdateNode).toHaveBeenCalledWith('n1', expect.objectContaining({ name: 'web-server-01', token: '' }))
    expect(mockToast).toHaveBeenCalledWith('節點設定已更新', 'success')
    expect(wrapper.emitted('saved')).toBeTruthy()
  })

  it('F-NF-11: 註冊按鈕 loading（saving → disabled，防重複送出）', async () => {
    let resolveCreate!: (v: any) => void
    mockCreateNode.mockImplementation(() => new Promise((res) => { resolveCreate = res }))
    const wrapper = mountForm()
    await fillForm(wrapper, { name: 'web-server-01', address: '10.0.0.5:8443', token: 'lsm_node_x' })

    await wrapper.find('[data-testid="node-save"]').trigger('click')
    await flushPromises()

    expect(mockCreateNode).toHaveBeenCalledTimes(1)
    expect(wrapper.find('[data-testid="node-save"]').attributes('disabled')).toBeDefined()

    resolveCreate(makeNode({ id: 'n1', status: 'online' }))
    await flushPromises()
  })
})
