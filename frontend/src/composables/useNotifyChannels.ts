import { ref } from 'vue'
import * as api from '../api/client'
import type { Channel, ChannelPayload } from '../types/notify'
import { useToast } from './useToast'
import { useWebSocket } from './useWebSocket'

/** 載入時補償 Toast 去重 key（決策 5：避免每次進入頁面重複 Toast） */
const DISABLED_TOAST_KEY = 'lsm.notify.disabled.toasted'

export function useNotifyChannels() {
  const channels = ref<Channel[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)
  const { showToast } = useToast()
  const ws = useWebSocket()

  /** 載入全部 channels；若有 enabled=false 且 auto_disabled_reason 非空 → 補償 Toast（sessionStorage 去重） */
  async function fetchChannels(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const list = await api.listChannels()
      channels.value = list

      const toasted = sessionStorage.getItem(DISABLED_TOAST_KEY)
      const autoDisabled = list.find(ch => !ch.enabled && ch.auto_disabled_reason)
      if (autoDisabled && !toasted) {
        showToast(
          `Channel「${autoDisabled.name}」因連續失敗已自動停用（${autoDisabled.auto_disabled_reason}）`,
          'warning',
        )
        sessionStorage.setItem(DISABLED_TOAST_KEY, '1')
      }
    } catch (e: any) {
      error.value = e?.response?.data?.error || e.message || '載入失敗'
    } finally {
      loading.value = false
    }
  }

  /** 新增 channel → POST；成功 Toast；失敗 Toast 錯誤並回拋（表單保留） */
  async function createChannel(payload: ChannelPayload): Promise<void> {
    try {
      const created = await api.createChannel(payload)
      channels.value.push(created)
      showToast(`Channel「${payload.name}」已建立`)
    } catch (e: any) {
      showToast(`無法建立 Channel：${e?.response?.data?.error || e.message}`, 'error')
      throw e
    }
  }

  /** 更新 channel → PUT；成功 Toast「Channel 已更新」 */
  async function updateChannel(id: string, payload: ChannelPayload): Promise<void> {
    try {
      const updated = await api.updateChannel(id, payload)
      const idx = channels.value.findIndex(c => c.id === id)
      if (idx !== -1) channels.value[idx] = updated
      showToast('Channel 已更新')
    } catch (e: any) {
      showToast(`無法更新 Channel：${e?.response?.data?.error || e.message}`, 'error')
      throw e
    }
  }

  /** 刪除 channel → DELETE；成功 Toast「Channel 已刪除」並從列表移除 */
  async function removeChannel(id: string): Promise<void> {
    try {
      await api.deleteChannel(id)
      channels.value = channels.value.filter(c => c.id !== id)
      showToast('Channel 已刪除')
    } catch (e: any) {
      showToast(`無法刪除 Channel：${e?.response?.data?.error || e.message}`, 'error')
      throw e
    }
  }

  /**
   * toggle 樂觀更新：立即切換 enabled → PATCH；
   * 成功以 server 回傳覆寫；失敗回復原狀態 + Toast
   */
  async function toggleEnabled(ch: Channel): Promise<void> {
    const original = ch.enabled
    ch.enabled = !original
    try {
      const updated = await api.patchChannelEnabled(ch.id, ch.enabled)
      Object.assign(ch, updated)
    } catch (e: any) {
      ch.enabled = original
      showToast(`無法更新 Channel 狀態：${e?.response?.data?.error || e.message}`, 'error')
    }
  }

  /** 測試按鈕：POST test → 成功/失敗/平台異常三種 Toast */
  async function testChannel(ch: Channel): Promise<void> {
    try {
      const res = await api.testChannel(ch.id)
      if (res.success && !res.detail) {
        showToast('測試通知已發送 ✅，請檢查目標平台')
      } else if (res.success && res.detail) {
        showToast('⚠️ 請求已送出但目標平台回覆異常，請檢查 URL/Token', 'warning')
      } else {
        showToast(`測試失敗 ❌：${res.error || res.detail || '未知錯誤'}`, 'error')
      }
    } catch (e: any) {
      showToast(`測試失敗 ❌：${e?.response?.data?.error || e.message}`, 'error')
    }
  }

  /** 註冊 WS notify_channel_disabled handler → 全域 Toast + 更新本地狀態 */
  function registerWsHandler(): void {
    ws.on('notify_channel_disabled', (msg: { id: string; name: string; reason: string }) => {
      showToast(
        `Channel「${msg.name}」因連續失敗已自動停用${msg.reason ? `（${msg.reason}）` : ''}`,
        'warning',
      )
      const ch = channels.value.find(c => c.id === msg.id)
      if (ch) {
        ch.enabled = false
        ch.auto_disabled_reason = msg.reason
      }
    })
  }

  return {
    channels,
    loading,
    error,
    fetchChannels,
    createChannel,
    updateChannel,
    removeChannel,
    toggleEnabled,
    testChannel,
    registerWsHandler,
  }
}
