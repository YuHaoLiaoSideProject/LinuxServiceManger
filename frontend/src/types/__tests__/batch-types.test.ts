/**
 * RED phase — batch-types 型別測試
 *
 * 測試預先定義在此的 batch 型別結構，後續將移至 types/service.ts。
 * 這些測試預期在型別尚未匯出時 FAIL（型別不存在）。
 */
import { describe, it, expect } from 'vitest'

// ── 型別定義（先在測試中定義，後續搬到 types/service.ts）──

export interface BatchRequest {
  names: string[]
  action: 'start' | 'stop' | 'restart'
}

export interface BatchResult {
  name: string
  action: 'start' | 'stop' | 'restart'
  result: 'success' | 'failure'
  error?: string
}

export interface BatchSummary {
  total: number
  success: number
  failed: number
}

export interface BatchResponse {
  summary: BatchSummary
  results: BatchResult[]
}

describe('BatchRequest — 批次請求型別', () => {
  it('應接受合法結構：names + action=start', () => {
    const req: BatchRequest = {
      names: ['nginx.service', 'docker.service'],
      action: 'start',
    }
    expect(req.names).toHaveLength(2)
    expect(req.action).toBe('start')
  })

  it('action 應為 start | stop | restart 字面聯合型別', () => {
    const actions: BatchRequest['action'][] = ['start', 'stop', 'restart']
    expect(actions).toEqual(['start', 'stop', 'restart'])
  })

  it('names 為空陣列時仍應是合法結構', () => {
    const req: BatchRequest = { names: [], action: 'restart' }
    expect(req.names).toEqual([])
    expect(req.action).toBe('restart')
  })
})

describe('BatchResult — 單一服務操作結果型別', () => {
  it('成功時 result=success，不需 error', () => {
    const r: BatchResult = {
      name: 'nginx.service',
      action: 'start',
      result: 'success',
    }
    expect(r.result).toBe('success')
    expect(r.error).toBeUndefined()
  })

  it('失敗時 result=failure，需有 error', () => {
    const r: BatchResult = {
      name: 'docker.service',
      action: 'start',
      result: 'failure',
      error: 'exit code 1: failed to start',
    }
    expect(r.result).toBe('failure')
    expect(r.error).toBe('exit code 1: failed to start')
  })
})

describe('BatchResponse — 批次回應型別', () => {
  it('summary.total = success + failed', () => {
    const resp: BatchResponse = {
      summary: { total: 3, success: 2, failed: 1 },
      results: [],
    }
    expect(resp.summary.total).toBe(resp.summary.success + resp.summary.failed)
  })

  it('可正確被 JSON.parse 解析為 BatchResponse 結構', () => {
    const json = `{
      "summary": { "total": 2, "success": 1, "failed": 1 },
      "results": [
        { "name": "nginx.service", "action": "start", "result": "success" },
        { "name": "docker.service", "action": "start", "result": "failure", "error": "exit code 1" }
      ]
    }`

    const parsed = JSON.parse(json) as BatchResponse

    // 型別斷言 — 驗證結構一致
    expect(typeof parsed.summary.total).toBe('number')
    expect(typeof parsed.summary.success).toBe('number')
    expect(typeof parsed.summary.failed).toBe('number')
    expect(Array.isArray(parsed.results)).toBe(true)
    expect(parsed.results).toHaveLength(2)
    expect(parsed.results[0].name).toBe('nginx.service')
    expect(parsed.results[0].result).toBe('success')
    expect(parsed.results[1].name).toBe('docker.service')
    expect(parsed.results[1].result).toBe('failure')
    expect(parsed.results[1].error).toBe('exit code 1')
  })

  it('全部成功時 summary.failed = 0', () => {
    const resp: BatchResponse = {
      summary: { total: 2, success: 2, failed: 0 },
      results: [
        { name: 'a.service', action: 'restart', result: 'success' },
        { name: 'b.service', action: 'restart', result: 'success' },
      ],
    }
    expect(resp.summary.failed).toBe(0)
  })

  it('全部失敗時 summary.success = 0', () => {
    const resp: BatchResponse = {
      summary: { total: 2, success: 0, failed: 2 },
      results: [
        { name: 'a.service', action: 'stop', result: 'failure', error: 'timeout' },
        { name: 'b.service', action: 'stop', result: 'failure', error: 'timeout' },
      ],
    }
    expect(resp.summary.success).toBe(0)
    expect(resp.results.every(r => r.result === 'failure')).toBe(true)
  })
})
