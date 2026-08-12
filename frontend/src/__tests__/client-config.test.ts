import { describe, it, expect, vi, beforeEach } from 'vitest'

// F-AP-01 ~ F-AP-05：api/client.ts config 擴充
// （docs/test-plans/012-service-config-editor測試計畫.md §3.8）

const { mockGet, mockPut, mockPost } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockPut: vi.fn(),
  mockPost: vi.fn(),
}))

vi.mock('axios', () => {
  return {
    default: {
      create: () => ({
        get: mockGet,
        put: mockPut,
        post: mockPost,
        interceptors: { response: { use: vi.fn() } },
      }),
    },
  }
})

vi.mock('../stores/auth', () => ({
  useAuthStore: () => ({ authenticated: false, username: '' }),
}))

import { getServiceConfig, saveServiceConfig, validateServiceConfig } from '../api/client'
import type { ServiceConfigResponse } from '../types/service'

const CHECKSUM = '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08'

function makeConfig(): ServiceConfigResponse {
  return {
    name: 'nginx.service',
    fragmentPath: '/etc/systemd/system/nginx.service',
    config: '[Unit]\nDescription=nginx\n',
    size: 24,
    checksum: CHECKSUM,
  }
}

describe('api/client — config 三 API（F-AP）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('F-AP-01: getServiceConfig → GET /services/{name}/config', async () => {
    mockGet.mockResolvedValue({ data: makeConfig() })
    const res = await getServiceConfig('nginx.service')
    expect(mockGet).toHaveBeenCalledWith('/services/nginx.service/config')
    expect(res.checksum).toBe(CHECKSUM)
    expect(res.fragmentPath).toBe('/etc/systemd/system/nginx.service')
  })

  it('F-AP-02: saveServiceConfig → PUT /services/{name}/config body {config, baseChecksum}', async () => {
    mockPut.mockResolvedValue({ data: { message: 'ok', backupPath: '/etc/systemd/system/nginx.service.bak.20260812T153045Z' } })
    const res = await saveServiceConfig('nginx.service', { config: '[Unit]', baseChecksum: CHECKSUM })
    expect(mockPut).toHaveBeenCalledWith(
      '/services/nginx.service/config',
      { config: '[Unit]', baseChecksum: CHECKSUM },
      expect.objectContaining({ headers: { 'Content-Type': 'application/json' } }),
    )
    expect(res.backupPath).toContain('.bak.')
  })

  it('F-AP-03: validateServiceConfig → POST /services/{name}/config/validate body {config}', async () => {
    mockPost.mockResolvedValue({
      data: { valid: false, available: true, errors: [{ line: 12, message: 'Unknown key' }] },
    })
    const res = await validateServiceConfig('nginx.service', '[Service]\nExecStartt=x')
    expect(mockPost).toHaveBeenCalledWith(
      '/services/nginx.service/config/validate',
      { config: '[Service]\nExecStartt=x' },
      expect.objectContaining({ headers: { 'Content-Type': 'application/json' } }),
    )
    expect(res.valid).toBe(false)
    expect(res.errors[0].line).toBe(12)
  })

  it('F-AP-04: 409 錯誤可解析 currentChecksum', async () => {
    const current = '5f8c'.padEnd(64, 'a')
    mockPut.mockRejectedValue({
      response: { status: 409, data: { error: '設定檔已被其他使用者修改。請重新載入後再編輯。', currentChecksum: current } },
    })
    try {
      await saveServiceConfig('nginx.service', { config: 'x', baseChecksum: CHECKSUM })
      expect.unreachable()
    } catch (e: any) {
      expect(e.response.status).toBe(409)
      expect(e.response.data.currentChecksum).toBe(current)
    }
  })

  it('F-AP-05: URL encode 服務名稱', async () => {
    mockGet.mockResolvedValue({ data: makeConfig() })
    await getServiceConfig('nginx@1.service')
    expect(mockGet).toHaveBeenCalledWith('/services/nginx%401.service/config')
  })
})
