export type ChannelType = 'slack' | 'discord' | 'telegram' | 'custom'
export type TriggerEvent = 'started' | 'stopped' | 'failed' | 'restarted'
export type HttpMethod = 'POST' | 'PUT'

export interface Channel {
  id: string
  type: ChannelType
  name: string
  url?: string
  token?: string            // Telegram bot token；API 回傳 masked（'****xxxx'）；編輯時留空表示不變更
  chat_id?: string          // Telegram chat id（僅 telegram；整數或 @channelusername）
  method?: HttpMethod       // custom，預設 POST
  headers?: Record<string, string>  // custom，≤10 組
  events: TriggerEvent[]
  all_services: boolean
  services?: string[]
  enabled: boolean
  auto_disabled_reason?: string  // 連續失敗停用原因（存在時顯示黃色警示徽章）
  created_at: string
  updated_at: string
}

/** ChannelForm 提交資料（POST/PUT body） */
export interface ChannelPayload {
  type: ChannelType
  name: string
  url: string
  token: string
  chat_id: string
  method: HttpMethod
  headers: Record<string, string>
  events: TriggerEvent[]
  all_services: boolean
  services: string[]
}

export interface HistoryEntry {
  timestamp: string
  channel_id: string
  channel_name: string
  channel_type: ChannelType
  event: string
  service: string
  status: 'success' | 'failure'
  error?: string
  duration_ms: number
}

export interface NotifyHistoryResult {
  data: HistoryEntry[]
  total: number
  page: number
  limit: number
}

export interface TestChannelResponse {
  success: boolean
  message?: string
  error?: string
  detail?: string
}

export interface HistoryQuery {
  page?: number
  limit?: number
  channel_id?: string
  status?: 'all' | 'success' | 'failure'
}
