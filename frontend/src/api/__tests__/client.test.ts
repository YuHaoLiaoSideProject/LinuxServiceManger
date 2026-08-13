/**
 * RED phase — batchServices API 函數測試
 *
 * 測試 api/client.ts 中 batchServices() 函數。
 * 函數尚未實作 — 靜態 import 失敗 → 整個 test file 為 RED。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import api, {
  batchServices,
  listChannels,
  createChannel,
  updateChannel,
  deleteChannel,
  patchChannelEnabled,
  testChannel,
  getNotifyHistory,
} from '../client'

describe('batchServices — 批次操作 API', () => {
  beforeEach(() => {
    // 預設 mock，避免任何測試意外發出真實 HTTP 請求
    vi.spyOn(api, 'post').mockResolvedValue({
      data: { summary: { total: 1, success: 1, failed: 0 }, results: [] },
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('應存在 batchServices 函數', () => {
    expect(typeof batchServices).toBe('function')
  })

  it('應接受 BatchRequest 並回傳 Promise<BatchResponse>', () => {
    const req = { names: ['nginx.service'], action: 'start' as const }
    const result = batchServices(req)
    expect(result).toBeInstanceOf(Promise)
  })

  it('應呼叫 POST /api/v1/services/batch', async () => {
    const spy = vi.spyOn(api, 'post').mockResolvedValue({
      data: {
        summary: { total: 1, success: 1, failed: 0 },
        results: [{ name: 'nginx.service', action: 'start', result: 'success' }],
      },
    })

    const req = { names: ['nginx.service'], action: 'start' as const }
    await batchServices(req)

    expect(spy).toHaveBeenCalledWith('/services/batch', req, expect.objectContaining({
      headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
    }))
  })

  it('應傳送正確的 JSON body（含 names 和 action）', async () => {
    const spy = vi.spyOn(api, 'post').mockResolvedValue({
      data: { summary: { total: 2, success: 1, failed: 1 }, results: [] },
    })

    const req = { names: ['nginx.service', 'docker.service'], action: 'restart' as const }
    await batchServices(req)

    expect(spy).toHaveBeenCalledWith('/services/batch', req, expect.any(Object))
    const callArgs = spy.mock.calls[0]
    expect(callArgs[1]).toEqual(req)
  })

  it('應正確處理成功回應：回傳 BatchResponse 結構', async () => {
    const mockData = {
      summary: { total: 2, success: 2, failed: 0 },
      results: [
        { name: 'a.service', action: 'start', result: 'success' as const },
        { name: 'b.service', action: 'start', result: 'success' as const },
      ],
    }

    vi.spyOn(api, 'post').mockResolvedValue({ data: mockData })

    const result = await batchServices({ names: ['a.service', 'b.service'], action: 'start' })
    expect(result).toEqual(mockData)
    expect(result.summary.total).toBe(2)
    expect(result.summary.success).toBe(2)
    expect(result.summary.failed).toBe(0)
    expect(result.results).toHaveLength(2)
  })

  it('應正確處理部分失敗回應', async () => {
    const mockData = {
      summary: { total: 2, success: 1, failed: 1 },
      results: [
        { name: 'a.service', action: 'stop', result: 'success' as const },
        { name: 'b.service', action: 'stop', result: 'failure' as const, error: 'timeout' },
      ],
    }

    vi.spyOn(api, 'post').mockResolvedValue({ data: mockData })

    const result = await batchServices({ names: ['a.service', 'b.service'], action: 'stop' })
    expect(result.summary.failed).toBe(1)
    expect(result.results[1].error).toBe('timeout')
  })

  it('應正確處理錯誤回應（HTTP error）', async () => {
    const axiosError = new Error('Request failed with status code 400') as any
    axiosError.response = {
      status: 400,
      data: { error: 'names must not be empty' },
    }
    axiosError.isAxiosError = true

    vi.spyOn(api, 'post').mockRejectedValue(axiosError)

    await expect(
      batchServices({ names: [], action: 'start' })
    ).rejects.toThrow('Request failed with status code 400')
  })

  it('request headers 應包含 Content-Type: application/json', async () => {
    const spy = vi.spyOn(api, 'post').mockResolvedValue({
      data: { summary: { total: 1, success: 1, failed: 0 }, results: [] },
    })

    await batchServices({ names: ['nginx.service'], action: 'start' })

    const config = spy.mock.calls[0]?.[2]
    expect(config).toBeDefined()
    expect(config?.headers).toBeDefined()
    expect(config?.headers?.['Content-Type']).toBe('application/json')
  })

  it('timeout 應設為 65000（略大於後端 60s）', async () => {
    const spy = vi.spyOn(api, 'post').mockResolvedValue({
      data: { summary: { total: 1, success: 1, failed: 0 }, results: [] },
    })

    await batchServices({ names: ['nginx.service'], action: 'start' })

    const config = spy.mock.calls[0]?.[2]
    expect(config?.timeout).toBe(65_000)
  })
})

// ============================================================
//  RED phase — notify 7 個 API 函數（F-AP-01 ~ F-AP-07）
//  對應 docs/test-plans/013-webhook-notification測試計畫.md §3.5。
//  函數尚未實作於 client.ts → 靜態 import 失敗即為 RED。
// ============================================================

describe('notify API 函數 — axios 契約（F-AP-01 ~ F-AP-07）', () => {
  beforeEach(() => {
    vi.spyOn(api, 'get').mockResolvedValue({ data: {} })
    vi.spyOn(api, 'post').mockResolvedValue({ data: {} })
    vi.spyOn(api, 'put').mockResolvedValue({ data: {} })
    vi.spyOn(api, 'patch').mockResolvedValue({ data: {} })
    vi.spyOn(api, 'delete').mockResolvedValue({ data: {} })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('F-AP-01: listChannels → GET /notify/channels', async () => {
    const spy = vi.spyOn(api, 'get').mockResolvedValue({ data: { data: [] } })
    await listChannels()
    expect(spy).toHaveBeenCalledWith('/notify/channels')
  })

  it('F-AP-02: createChannel → POST /notify/channels（JSON body）', async () => {
    const spy = vi.spyOn(api, 'post').mockResolvedValue({ data: { data: { id: 'c1' } } })
    const payload: any = { type: 'slack', name: 'S', url: 'https://hooks.slack.com/services/x', events: ['failed'], all_services: true }
    await createChannel(payload)
    expect(spy).toHaveBeenCalledWith('/notify/channels', payload, expect.objectContaining({
      headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
    }))
  })

  it('F-AP-03: updateChannel → PUT /notify/channels/{id}', async () => {
    const spy = vi.spyOn(api, 'put').mockResolvedValue({ data: { data: { id: 'c1' } } })
    const payload: any = { type: 'slack', name: 'S', url: 'https://hooks.slack.com/services/x', events: ['failed'], all_services: true }
    await updateChannel('c1', payload)
    expect(spy).toHaveBeenCalledWith('/notify/channels/c1', payload, expect.any(Object))
  })

  it('F-AP-04: deleteChannel → DELETE /notify/channels/{id}', async () => {
    const spy = vi.spyOn(api, 'delete').mockResolvedValue({ data: {} })
    await deleteChannel('c1')
    expect(spy).toHaveBeenCalledWith('/notify/channels/c1')
  })

  it('F-AP-05: patchChannelEnabled → PATCH /notify/channels/{id} body {enabled}', async () => {
    const spy = vi.spyOn(api, 'patch').mockResolvedValue({ data: { data: { id: 'c1', enabled: false } } })
    await patchChannelEnabled('c1', false)
    expect(spy).toHaveBeenCalledWith('/notify/channels/c1', { enabled: false }, expect.any(Object))
  })

  it('F-AP-06: testChannel → POST /notify/channels/{id}/test', async () => {
    const spy = vi.spyOn(api, 'post').mockResolvedValue({ data: { success: true, message: 'ok' } })
    await testChannel('c1')
    expect(spy).toHaveBeenCalledWith('/notify/channels/c1/test')
  })

  it('F-AP-07: getNotifyHistory → GET /notify/history 帶 query params', async () => {
    const spy = vi.spyOn(api, 'get').mockResolvedValue({ data: { data: [], total: 0, page: 1, limit: 30 } })
    await getNotifyHistory({ page: 2, limit: 30, channel_id: 'c1', status: 'failure' })

    const callArgs = spy.mock.calls[0]
    expect(callArgs[0]).toBe('/notify/history')
    expect(callArgs[1]).toBeDefined()
    const params = callArgs[1]!.params as URLSearchParams
    expect(params).toBeInstanceOf(URLSearchParams)
    expect(params.get('page')).toBe('2')
    expect(params.get('limit')).toBe('30')
    expect(params.get('channel_id')).toBe('c1')
    expect(params.get('status')).toBe('failure')
  })

  it('F-AP-07: getNotifyHistory status=all 不帶 status 參數', async () => {
    const spy = vi.spyOn(api, 'get').mockResolvedValue({ data: { data: [], total: 0, page: 1, limit: 30 } })
    await getNotifyHistory({ status: 'all' })
    const params = spy.mock.calls[0][1]!.params as URLSearchParams
    expect(params.has('status')).toBe(false)
  })
})
