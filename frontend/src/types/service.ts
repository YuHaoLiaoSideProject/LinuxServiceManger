export interface Service {
  name: string
  load: string
  active: string
  sub: string
  locked: boolean
  unitFileState: string
  fragmentPath: string
}

export type ServiceAction = 'start' | 'stop' | 'restart'

export interface LoginResponse {
  username: string
  message: string
}

export interface SessionInfo {
  authenticated: boolean
  username: string
}

export interface MessageResponse {
  message?: string
  error?: string
}

export interface LogDrawerState {
  visible: boolean
  serviceName: string
}

export interface LogLine {
  text: string
  match: boolean
}

// ── Batch Operation Types ──

export interface BatchRequest {
  names: string[]
  action: 'start' | 'stop' | 'restart'
}

export interface BatchResult {
  name: string
  action: string
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

// ── API Token Types ──

export type TokenScope = 'read' | 'full'

export type TokenStatus = 'active' | 'expiring_soon' | 'expired' | 'revoked'

export interface TokenResponse {
  id: string
  name: string
  prefix: string       // "lsm_k3F8****a3eU9"
  scope: TokenScope
  created_at: string   // ISO 8601
  expires_at: string | null  // null = 永不過期
  last_used_at: string | null // null = 從未使用
  status: TokenStatus
}

export interface TokenListResponse {
  data: TokenResponse[]
}

export interface CreateTokenRequest {
  name: string
  expires_in_days: number  // -1 = 永不過期, 1-365 = N 天, 0 = 自訂日期
  custom_expiry?: string   // ISO 8601, 僅 expires_in_days=0 時
  scope: TokenScope
}

export interface CreateTokenResponse {
  id: string
  token: string          // RAW value — 一次性揭露
  name: string
  scope: TokenScope
  expires_at: string | null
}

export interface RevokeTokenResponse {
  message: string
  status: 'revoked' | 'already_revoked'
}
