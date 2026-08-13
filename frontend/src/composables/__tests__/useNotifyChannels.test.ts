/**
 * RED phase — useNotifyChannels composable 測試（F-AP-01 ~ F-AP-08）
 * 對應 docs/test-plans/013-webhook-notification測試計畫.md §3.5。
 * useNotifyChannels.ts 尚未實作 → import 失敗即為 RED。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const {
  mockList, mockCreate, mockUpdate, mockDelete, mockPatch, mockTest,
  mockWsOn, mockToast,
} = vi.hoisted(() => ({
  mockList: vi.fn(),
  mockCreate: vi.fn(),
  mockUpdate: vi.fn(),
  mockDelete: vi.fn(),
  mockPatch: vi.fn(),
  mockTest: vi.fn(),
  mockWsOn: vi.fn(),
  mockToast: vi.fn(),
}))

vi.mock('../../api/client', () => ({
  listChannels: mockList,
  createChannel: mockCreate,
  updateChannel: mockUpdate,
  deleteChannel: mockDelete,
  patchChannelEnabled: mockPatch,
  testChannel: mockTest,
}))

vi.mock('../../composables/useWebSocket', () => ({
  useWebSocket: () => ({ on: mockWsOn }),
}))

vi.mock('../../composables/useToast', () => ({
  useToast: () => ({ showToast: mockToast }),
}))

import { useNotifyChannels } from '../useNotifyChannels'
import type { Channel } from '../../types/notify'

function makeChannel(overrides: Partial<Channel> = {}): Channel {
  return {
    id: 'c1',
    type: 'slack',
    name: '團隊 Slack',
    url: 'https://hooks.slack.com/services/x',
    events: ['failed'],
    all_services: true,
    enabled: true,
    created_at: '2025-08-09T12:00:00Z',
    updated_at: '2025-08-09T12:00:00Z',
    ...overrides,
  }
}

describe('useNotifyChannels（F-AP）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sessionStorage.clear()
    mockList.mockResolvedValue([])
  })

  it('F-AP-01: fetchChannels 呼叫 listChannels 並填入 channels', async () => {
    mockList.mockResolvedValue([makeChannel()])
    const { channels, fetchChannels } = useNotifyChannels()

    expect(mockList).not.toHaveBeenCalled()
    await fetchChannels()

    expect(mockList).toHaveBeenCalledTimes(1)
    expect(channels.value).toHaveLength(1)
    expect(channels.value[0].name).toBe('團隊 Slack')
  })

  it('F-AP-02: createChannel 呼叫 createChannel(payload) 並 Toast', async () => {
    mockCreate.mockResolvedValue(makeChannel())
    const { createChannel } = useNotifyChannels()

    const payload: any = { type: 'slack', name: '新 Channel', url: 'https://hooks.slack.com/services/y', events: ['failed'], all_services: true }
    await createChannel(payload)

    expect(mockCreate).toHaveBeenCalledWith(payload)
    expect(mockToast).toHaveBeenCalledWith('Channel「新 Channel」已建立')
  })

  it('F-AP-03: updateChannel 呼叫 updateChannel(id, payload)', async () => {
    mockUpdate.mockResolvedValue(makeChannel({ name: '更新後' }))
    const { updateChannel } = useNotifyChannels()

    const payload: any = { type: 'slack', name: '更新後', url: 'https://hooks.slack.com/services/y', events: ['failed'], all_services: true }
    await updateChannel('c1', payload)

    expect(mockUpdate).toHaveBeenCalledWith('c1', payload)
    expect(mockToast).toHaveBeenCalledWith('Channel 已更新')
  })

  it('F-AP-04: removeChannel 呼叫 deleteChannel(id) 並從列表移除', async () => {
    mockDelete.mockResolvedValue(undefined)
    const { channels, removeChannel } = useNotifyChannels()
    channels.value.push(makeChannel({ id: 'c1' }))

    await removeChannel('c1')

    expect(mockDelete).toHaveBeenCalledWith('c1')
    expect(channels.value).toHaveLength(0)
    expect(mockToast).toHaveBeenCalledWith('Channel 已刪除')
  })

  it('F-AP-05: toggleEnabled 樂觀更新 → PATCH → 成功以 server 覆寫', async () => {
    const updated = makeChannel({ enabled: false })
    mockPatch.mockResolvedValue(updated)
    const { toggleEnabled } = useNotifyChannels()
    const ch = makeChannel({ enabled: true })

    const p = toggleEnabled(ch)
    expect(ch.enabled).toBe(false) // 樂觀更新
    await p

    expect(mockPatch).toHaveBeenCalledWith('c1', false)
    expect(ch.enabled).toBe(false)
  })

  it('F-AP-05: toggleEnabled 失敗回復原狀態 + Toast', async () => {
    mockPatch.mockRejectedValue({ response: { data: { error: '更新失敗' } } })
    const { toggleEnabled } = useNotifyChannels()
    const ch = makeChannel({ enabled: true })

    await toggleEnabled(ch)

    expect(ch.enabled).toBe(true) // 回復
    expect(mockToast).toHaveBeenCalledWith('無法更新 Channel 狀態：更新失敗', 'error')
  })

  it('F-AP-06: testChannel 成功 Toast（三態之一）', async () => {
    mockTest.mockResolvedValue({ success: true })
    const { testChannel } = useNotifyChannels()

    await testChannel(makeChannel())

    expect(mockTest).toHaveBeenCalledWith('c1')
    expect(mockToast).toHaveBeenCalledWith('測試通知已發送 ✅，請檢查目標平台')
  })

  it('F-AP-06: testChannel 平台回覆異常 → warning Toast', async () => {
    mockTest.mockResolvedValue({ success: true, detail: '平台拒絕' })
    const { testChannel } = useNotifyChannels()

    await testChannel(makeChannel())

    expect(mockToast).toHaveBeenCalledWith('⚠️ 請求已送出但目標平台回覆異常，請檢查 URL/Token', 'warning')
  })

  it('F-AP-06: testChannel 失敗 Toast（含 502 error）', async () => {
    mockTest.mockResolvedValue({ success: false, error: '403 Forbidden' })
    const { testChannel } = useNotifyChannels()

    await testChannel(makeChannel())

    expect(mockToast).toHaveBeenCalledWith('測試失敗 ❌：403 Forbidden', 'error')
  })

  it('F-AP-06: testChannel axios 例外 → 失敗 Toast', async () => {
    mockTest.mockRejectedValue({ response: { data: { error: '連線逾時' } } })
    const { testChannel } = useNotifyChannels()

    await testChannel(makeChannel())

    expect(mockToast).toHaveBeenCalledWith('測試失敗 ❌：連線逾時', 'error')
  })

  it('F-AP-08: registerWsHandler 註冊 notify_channel_disabled handler', () => {
    const { registerWsHandler } = useNotifyChannels()
    registerWsHandler()
    expect(mockWsOn).toHaveBeenCalledWith('notify_channel_disabled', expect.any(Function))
  })

  it('F-AP-08: WS handler 觸發時 Toast + 更新本地 channel 狀態', () => {
    let captured: ((msg: any) => void) | undefined
    mockWsOn.mockImplementation((_type: string, handler: (msg: any) => void) => {
      captured = handler
    })

    const { channels, registerWsHandler } = useNotifyChannels()
    channels.value.push(makeChannel({ id: 'c1', enabled: true }))
    registerWsHandler()

    captured!({ id: 'c1', name: '團隊 Slack', reason: '連續失敗 10 次自動停用' })

    expect(mockToast).toHaveBeenCalledWith(expect.stringContaining('團隊 Slack'), 'warning')
    expect(channels.value[0].enabled).toBe(false)
    expect(channels.value[0].auto_disabled_reason).toBe('連續失敗 10 次自動停用')
  })

  it('F-NV-06: fetchChannels 載入時偵測 auto-disabled → 補償 Toast', async () => {
    mockList.mockResolvedValue([
      makeChannel({ id: 'c1', enabled: false, auto_disabled_reason: '連續失敗 10 次自動停用' }),
    ])
    const { fetchChannels } = useNotifyChannels()

    await fetchChannels()

    expect(mockToast).toHaveBeenCalledWith(expect.stringContaining('團隊 Slack'), 'warning')
  })

  it('F-NV-06: 補償 Toast 以 sessionStorage 去重', async () => {
    sessionStorage.setItem('lsm.notify.disabled.toasted', '1')
    mockList.mockResolvedValue([
      makeChannel({ id: 'c1', enabled: false, auto_disabled_reason: '連續失敗 10 次自動停用' }),
    ])
    const { fetchChannels } = useNotifyChannels()

    await fetchChannels()

    expect(mockToast).not.toHaveBeenCalled()
  })
})
