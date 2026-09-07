export type NodeStatus = 'online' | 'degraded' | 'warning' | 'offline' | 'long_offline'

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
  last_heartbeat?: string | null
  lastOnlineAt: string | null
  onlineSince: string | null
  offlineSince: string | null
  servicesTotal: number
  servicesRunning: number
  servicesFailed: number
  cpuPercent?: number
  memoryPercent?: number
  agent_version?: string
  service_stats?: {
    total: number
    active: number
    failed: number
  }
}

export interface NodeSummary {
  totalNodes: number
  total_nodes?: number
  online: number
  offline: number
  degraded: number
  long_offline: number
  warning: number
  servicesTotal: number
  total_services?: number
  running: number
  active_services?: number
  failed: number
  failed_services?: number
}

export interface NodeFormInput {
  name: string
  address: string
  tls_fingerprint?: string
  token?: string
  note?: string
}

export type Node = ManagedNode
export type NodePayload = NodeFormInput
export type TestConnectionRequest = TestConnectionInput

export interface SearchResponse {
  results: SearchResult[]
  failed_nodes: FailedNode[]
}

export interface SearchResult {
  node_id: string
  node_name: string
  service: string
  active: boolean
}

export interface FailedNode {
  node_id: string
  node_name: string
  error: string
}

export interface NodeSystemInfo {
  hostname: string
  os: string
  arch: string
  uptime: string
  cpu_cores: number
  memory_total: number
  memory_used: number
  disk_total: number
  disk_used: number
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
