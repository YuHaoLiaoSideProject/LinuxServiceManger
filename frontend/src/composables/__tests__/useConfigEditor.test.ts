import { describe, it, expect, vi, beforeEach } from 'vitest'

// F-CE-01 ~ F-CE-10：useConfigEditor composable（dirty / baseChecksum / load / verify / save）
// （docs/test-plans/012-service-config-editor測試計畫.md §3.3）

const { mockGetConfig, mockSaveConfig, mockValidateConfig } = vi.hoisted(() => ({
  mockGetConfig: vi.fn(),
  mockSaveConfig: vi.fn(),
  mockValidateConfig: vi.fn(),
}))

vi.mock('../../api/client', () => ({
  getServiceConfig: mockGetConfig,
  saveServiceConfig: mockSaveConfig,
  validateServiceConfig: mockValidateConfig,
}))

import { useConfigEditor } from '../useConfigEditor'
import type { ServiceConfigResponse } from '../../types/service'

const SAMPLE_CONFIG = '[Unit]\nDescription=nginx\n\n[Service]\nExecStart=/usr/sbin/nginx\n'

function makeConfig(overrides: Partial<ServiceConfigResponse> = {}): ServiceConfigResponse {
  return {
    name: 'nginx.service',
    fragmentPath: '/etc/systemd/system/nginx.service',
    config: SAMPLE_CONFIG,
    size: SAMPLE_CONFIG.length,
    checksum: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
    ...overrides,
  }
}

describe('useConfigEditor（F-CE）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('F-CE-01: 載入成功設定初始狀態（content/initialContent/baseChecksum）', async () => {
    mockGetConfig.mockResolvedValue(makeConfig())
    const ed = useConfigEditor('nginx.service')
    expect(ed.status.value).toBe('loading')
    await ed.load()

    expect(ed.status.value).toBe('ready')
    expect(ed.content.value).toBe(SAMPLE_CONFIG)
    expect(ed.initialContent.value).toBe(SAMPLE_CONFIG)
    expect(ed.baseChecksum.value).toBe('9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08')
    expect(ed.fragmentPath.value).toBe('/etc/systemd/system/nginx.service')
    expect(ed.isDirty.value).toBe(false)
  })

  it('F-CE-02: 內容變更進入 dirty', async () => {
    mockGetConfig.mockResolvedValue(makeConfig())
    const ed = useConfigEditor('nginx.service')
    await ed.load()
    ed.setContent(SAMPLE_CONFIG + '\nEnvironment=FOO=bar')
    expect(ed.isDirty.value).toBe(true)
  })

  it('F-CE-03: 內容還原回初始 → clean（內容比對，非 flag 累計）', async () => {
    mockGetConfig.mockResolvedValue(makeConfig())
    const ed = useConfigEditor('nginx.service')
    await ed.load()
    ed.setContent(SAMPLE_CONFIG + '\nEnvironment=FOO=bar')
    expect(ed.isDirty.value).toBe(true)
    ed.setContent(SAMPLE_CONFIG)
    expect(ed.isDirty.value).toBe(false)
  })

  it('F-CE-04: 儲存成功轉 clean', async () => {
    mockGetConfig.mockResolvedValue(makeConfig())
    mockSaveConfig.mockResolvedValue({ message: 'saved', backupPath: '/etc/systemd/system/nginx.service.bak.20260812T153045Z' })
    const ed = useConfigEditor('nginx.service')
    await ed.load()
    ed.setContent(SAMPLE_CONFIG + '\nEnvironment=FOO=bar')

    const res = await ed.save()
    expect(res.kind).toBe('success')
    expect(ed.isDirty.value).toBe(false)
    // baseChecksum 基準更新為目前內容
    expect(ed.initialContent.value).toBe(ed.content.value)
  })

  it('F-CE-05: 儲存失敗保持 dirty、內容保留', async () => {
    mockGetConfig.mockResolvedValue(makeConfig())
    mockSaveConfig.mockRejectedValue({
      response: { status: 500, data: { error: '寫入失敗' } },
    })
    const ed = useConfigEditor('nginx.service')
    await ed.load()
    const edited = SAMPLE_CONFIG + '\nEnvironment=FOO=bar'
    ed.setContent(edited)

    const res = await ed.save()
    expect(res.kind).toBe('error')
    expect(ed.isDirty.value).toBe(true)
    expect(ed.content.value).toBe(edited)
  })

  it('F-CE-06: 內容變更清除先前驗證結果', async () => {
    mockGetConfig.mockResolvedValue(makeConfig())
    mockValidateConfig.mockResolvedValue({
      valid: false, available: true,
      errors: [{ line: 12, message: "Unknown key 'ExecStartt'" }],
    })
    const ed = useConfigEditor('nginx.service')
    await ed.load()
    ed.setContent(SAMPLE_CONFIG + '\nExecStartt=bad')

    const ok = await ed.verify()
    expect(ok).toBe(false)
    expect(ed.validationKind.value).toBe('failure')

    ed.setContent(SAMPLE_CONFIG + '\nExecStartt=bad\nEnvironment=X=1')
    expect(ed.validationKind.value).toBeNull()
    expect(ed.validation.value).toBeNull()
  })

  it('F-CE-07: 409 後重新載入更新 baseChecksum，再次儲存成功', async () => {
    mockGetConfig.mockResolvedValueOnce(makeConfig())
    const newChecksum = '5f8c'.padEnd(64, 'a')
    mockGetConfig.mockResolvedValueOnce(makeConfig({ checksum: newChecksum, config: SAMPLE_CONFIG + '\n#other changed' }))
    mockSaveConfig.mockRejectedValueOnce({
      response: { status: 409, data: { error: '設定檔已被其他使用者修改。請重新載入後再編輯。', currentChecksum: newChecksum } },
    })
    mockSaveConfig.mockResolvedValueOnce({ message: 'saved', backupPath: '/x.bak' })

    const ed = useConfigEditor('nginx.service')
    await ed.load()
    ed.setContent(SAMPLE_CONFIG + '\nEnvironment=FOO=bar')

    const res = await ed.save()
    expect(res.kind).toBe('conflict')
    expect(res.currentChecksum).toBe(newChecksum)

    await ed.reloadAfterConflict()
    expect(ed.baseChecksum.value).toBe(newChecksum)

    const res2 = await ed.save()
    expect(res2.kind).toBe('success')
  })

  it('F-CE-08: 儲存中 isSaving 狀態', async () => {
    mockGetConfig.mockResolvedValue(makeConfig())
    let resolveSave!: (v: unknown) => void
    mockSaveConfig.mockReturnValue(new Promise((r) => { resolveSave = r }))
    const ed = useConfigEditor('nginx.service')
    await ed.load()
    ed.setContent(SAMPLE_CONFIG + 'x')

    const p = ed.save()
    expect(ed.isSaving.value).toBe(true)
    resolveSave({ message: 'saved', backupPath: '/x.bak' })
    await p
    expect(ed.isSaving.value).toBe(false)
  })

  it('F-CE-09: beforeunload — dirty 時 preventDefault、clean 時不攔截', async () => {
    mockGetConfig.mockResolvedValue(makeConfig())
    const ed = useConfigEditor('nginx.service')
    await ed.load()

    const evt = { preventDefault: vi.fn(), returnValue: '' } as unknown as BeforeUnloadEvent
    ed.onBeforeUnload(evt)
    expect(evt.preventDefault).not.toHaveBeenCalled()

    ed.setContent(SAMPLE_CONFIG + 'x')
    const evt2 = { preventDefault: vi.fn(), returnValue: '' } as unknown as BeforeUnloadEvent
    ed.onBeforeUnload(evt2)
    expect(evt2.preventDefault).toHaveBeenCalled()
  })

  it('F-CE-10: 載入 404 → not-found 狀態（空內容、可重建）', async () => {
    mockGetConfig.mockRejectedValue({ response: { status: 404, data: { error: '設定檔不存在' } } })
    const ed = useConfigEditor('nginx.service')
    await ed.load()
    expect(ed.status.value).toBe('not-found')
    expect(ed.content.value).toBe('')
    expect(ed.baseChecksum.value).toBe('')
  })

  it('F-CE-11: 載入其他錯誤 → error 狀態 + 訊息', async () => {
    mockGetConfig.mockRejectedValue({ response: { status: 500, data: { error: '無法讀取設定檔：permission denied' } } })
    const ed = useConfigEditor('nginx.service')
    await ed.load()
    expect(ed.status.value).toBe('error')
    expect(ed.errorMessage.value).toContain('無法讀取設定檔')
  })

  it('F-CE-12: verify 空內容攔截（不發 API 請求）', async () => {
    mockGetConfig.mockResolvedValue(makeConfig())
    const ed = useConfigEditor('nginx.service')
    await ed.load()
    ed.setContent('')
    const ok = await ed.verify()
    expect(ok).toBe(false)
    expect(mockValidateConfig).not.toHaveBeenCalled()
  })

  it('F-CE-13: verify 網路/500 錯誤 → validationKind=error（黃色警告）', async () => {
    mockGetConfig.mockResolvedValue(makeConfig())
    mockValidateConfig.mockRejectedValue(new Error('network'))
    const ed = useConfigEditor('nginx.service')
    await ed.load()
    ed.setContent('x')
    const ok = await ed.verify()
    expect(ok).toBe(false)
    expect(ed.validationKind.value).toBe('error')
  })

  it('F-CE-14: verify available=false → unavailable', async () => {
    mockGetConfig.mockResolvedValue(makeConfig())
    mockValidateConfig.mockResolvedValue({
      valid: false, available: false, errors: [], message: 'systemd-analyze 指令不存在',
    })
    const ed = useConfigEditor('nginx.service')
    await ed.load()
    ed.setContent('x')
    await ed.verify()
    expect(ed.validationKind.value).toBe('unavailable')
  })

  it('F-CE-15: 500 + backupPath → reload-failed 半成功', async () => {
    mockGetConfig.mockResolvedValue(makeConfig())
    mockSaveConfig.mockRejectedValue({
      response: { status: 500, data: { error: 'daemon-reload 失敗: x', backupPath: '/etc/systemd/system/nginx.service.bak.20260812T153045Z' } },
    })
    const ed = useConfigEditor('nginx.service')
    await ed.load()
    ed.setContent(SAMPLE_CONFIG + 'x')
    const res = await ed.save()
    expect(res.kind).toBe('reload-failed')
    expect(res.backupPath).toContain('.bak.')
  })
})
