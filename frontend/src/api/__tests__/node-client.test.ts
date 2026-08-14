/**
 * RED phase — api/client.ts 節點 API 函數（F-AP-01 ~ F-AP-12）
 * 對應 docs/test-plans/014-multi-node-agent-management測試計畫.md §3.9。
 *
 * 依 §2.3，client.ts 需新增 12 個節點函式；
 * 目前尚未實作 → 靜態 named import 失敗即為 RED（沿用 client.test.ts 既有 pattern）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import api, {
  listNodes,
  createNode,
  updateNode,
  deleteNode,
  testConnection,
  getNodesSummary,
  searchServices,
  getNodeServices,
  nodeServiceAction,
  getNodeLogs,
  getNodeInfo,
  downloadAgent,
} from '../client'

describe('node API — axios 契約（F-AP-01 ~ F-AP-12）', () => {
  beforeEach(() => {
    vi.spyOn(api, 'get').mockResolvedValue({ data: {} })
    vi.spyOn(api, 'post').mockResolvedValue({ data: {} })
    vi.spyOn(api, 'put').mockResolvedValue({ data: {} })
    vi.spyOn(api, 'delete').mockResolvedValue({ data: {} })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('F-AP-01: listNodes → GET /api/v1/nodes（解包 data.data）', async () => {
    const node = { id: 'n1', name: 'web-server-01', status: 'online', service_stats: { total: 1, active: 1, failed: 0 } }
    const spy = vi.spyOn(api, 'get').mockResolvedValue({ data: { data: [node] } })

    const result = await listNodes()
    expect(spy).toHaveBeenCalledWith('/nodes')
    expect(result).toEqual([node])
  })

  it('F-AP-02: createNode → POST /api/v1/nodes（body 含 name/address/tls_fingerprint/token/notes）', async () => {
    const spy = vi.spyOn(api, 'post').mockResolvedValue({ data: { data: { id: 'n1' } } })
    const payload: any = { name: 'web-server-01', address: '10.0.0.5:8443', tls_fingerprint: '', token: 'lsm_node_x', notes: '' }

    await createNode(payload)
    expect(spy).toHaveBeenCalledWith('/nodes', payload)
  })

  it('F-AP-03: updateNode → PUT /api/v1/nodes/{id}', async () => {
    const spy = vi.spyOn(api, 'put').mockResolvedValue({ data: { data: { id: 'n1' } } })
    const payload: any = { name: 'web-server-01', address: '10.0.0.9:8443', tls_fingerprint: '', token: '', notes: 'moved' }

    await updateNode('n1', payload)
    expect(spy).toHaveBeenCalledWith('/nodes/n1', payload)
  })

  it('F-AP-04: deleteNode → DELETE /api/v1/nodes/{id}', async () => {
    const spy = vi.spyOn(api, 'delete').mockResolvedValue({ data: { message: '節點已移除' } })
    await deleteNode('n1')
    expect(spy).toHaveBeenCalledWith('/nodes/n1')
  })

  it('F-AP-05: testConnection → POST /api/v1/nodes/test-connection；502 錯誤可解析供 Toast', async () => {
    const spy = vi.spyOn(api, 'post').mockResolvedValue({
      data: { version: '1.2.3', hostname: 'web-server-01', os: 'Ubuntu 22.04', uptime: 100 },
    })
    const res = await testConnection({ address: '10.0.0.5:8443', token: 'lsm_node_x' })
    expect(spy).toHaveBeenCalledWith('/nodes/test-connection', expect.objectContaining({ address: '10.0.0.5:8443' }))
    expect(res.version).toBe('1.2.3')

    // 502（connection refused / TLS 失敗）→ reject，前端 Toast 可解析 response.data.error
    const axiosErr: any = new Error('Request failed with status code 502')
    axiosErr.response = { status: 502, data: { error: 'connection refused' } }
    vi.spyOn(api, 'post').mockRejectedValueOnce(axiosErr)
    await expect(testConnection({ address: '10.0.0.9:8443' })).rejects.toMatchObject({
      response: { status: 502, data: { error: 'connection refused' } },
    })
  })

  it('F-AP-06: getNodeServices → GET /api/v1/nodes/{id}/services（代理前綴）', async () => {
    const spy = vi.spyOn(api, 'get').mockResolvedValue({ data: [{ name: 'nginx.service' }] })
    const result = await getNodeServices('n1')
    expect(spy).toHaveBeenCalledWith('/nodes/n1/services')
    expect(result).toEqual([{ name: 'nginx.service' }])
  })

  it('F-AP-07: nodeServiceAction → POST /api/v1/nodes/{id}/services/{name}/{action}（encodeURIComponent）', async () => {
    const spy = vi.spyOn(api, 'post').mockResolvedValue({ data: { message: 'ok' } })
    await nodeServiceAction('n1', 'nginx.service', 'restart')
    expect(spy).toHaveBeenCalledWith('/nodes/n1/services/nginx.service/restart')

    // 含特殊字元的服務名稱需 URL encode
    await nodeServiceAction('n1', 'my weird.service', 'stop')
    expect(spy).toHaveBeenCalledWith('/nodes/n1/services/my%20weird.service/stop')
  })

  it('F-AP-08: getNodeLogs → GET /api/v1/nodes/{id}/services/{name}/logs?lines=', async () => {
    const spy = vi.spyOn(api, 'get').mockResolvedValue({ data: 'log line 1\nlog line 2' })
    const result = await getNodeLogs('n1', 'nginx.service', 100)
    expect(spy).toHaveBeenCalledWith('/nodes/n1/services/nginx.service/logs', expect.objectContaining({
      params: expect.objectContaining({ lines: 100 }),
    }))
    expect(result).toContain('log line 1')
  })

  it('F-AP-09: searchServices → GET /api/v1/nodes/services/search?q=', async () => {
    const spy = vi.spyOn(api, 'get').mockResolvedValue({
      data: { results: [{ node_id: 'n1', node_name: 'web-server-01', service: 'nginx.service', active: 'active', sub: 'running' }], failed_nodes: [] },
    })
    const result = await searchServices('nginx')
    expect(spy).toHaveBeenCalledWith('/nodes/services/search', expect.objectContaining({
      params: expect.objectContaining({ q: 'nginx' }),
    }))
    expect(result.results[0].node_name).toBe('web-server-01')
  })

  it('F-AP-10: getNodeInfo → GET /api/v1/nodes/{id}/info', async () => {
    const spy = vi.spyOn(api, 'get').mockResolvedValue({ data: { os: 'Ubuntu 22.04', kernel: '6.2', uptime: 3600, cpu: 'x', mem: 'y', disk: 'z' } })
    const result = await getNodeInfo('n1')
    expect(spy).toHaveBeenCalledWith('/nodes/n1/info')
    expect(result.os).toBe('Ubuntu 22.04')
  })

  it('F-AP-11: getNodesSummary → GET /api/v1/nodes/summary（解包 data.data，9 欄位）', async () => {
    const summary = { total_nodes: 3, online: 2, degraded: 0, offline: 1, long_offline: 0, warning: 0, total_services: 30, active_services: 25, failed_services: 2 }
    const spy = vi.spyOn(api, 'get').mockResolvedValue({ data: { data: summary } })
    const result = await getNodesSummary()
    expect(spy).toHaveBeenCalledWith('/nodes/summary')
    expect(result).toEqual(summary)
  })

  it('F-AP-12: downloadAgent → GET /api/v1/agents/download?arch=（responseType blob）', async () => {
    const spy = vi.spyOn(api, 'get').mockResolvedValue({ data: new Blob(['binary']) })
    const result = await downloadAgent('amd64')
    expect(spy).toHaveBeenCalledWith('/agents/download', expect.objectContaining({
      params: expect.objectContaining({ arch: 'amd64' }),
      responseType: 'blob',
    }))
    expect(result).toBeInstanceOf(Blob)
  })
})
