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
