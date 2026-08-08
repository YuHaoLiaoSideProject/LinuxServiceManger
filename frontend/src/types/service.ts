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
