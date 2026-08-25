export type NodeStatus = 'online' | 'warning' | 'offline' | 'long_offline'

export interface ManagedNode {
  id: string
  name: string
  hostname: string
  address: string
  status: NodeStatus
  tls_fingerprint?: string
  note?: string
  version: string
  versionCompatible: boolean
  versionMessage: string
  lastHeartbeat: string | null      // ISO timestamp
  lastOnlineAt: string | null
  onlineSince: string | null
  offlineSince: string | null
  servicesTotal: number
  servicesRunning: number
  servicesFailed: number
  cpuPercent?: number
  memoryPercent?: number
}

export interface NodeSummary {
  totalNodes: number
  online: number
  offline: number
  servicesTotal: number
  running: number
  failed: number
}

export interface NodeFormInput {
  name: string
  address: string
  tls_fingerprint?: string
  token?: string
  note?: string
}

export interface TestConnectionInput {
  address: string
  tls_fingerprint?: string
  token?: string
}

export interface TestConnectionResult {
  ok: boolean
  version?: string
  hostname?: string
  os?: string
  error?: string
}
