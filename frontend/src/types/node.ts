// ── 014 Multi-Node Agent Management 型別（決策 3/4/8）──

export type NodeStatus = 'online' | 'degraded' | 'offline' | 'long_offline' | 'warning'

export interface ServiceStats {
  total: number
  active: number
  failed: number
}

export interface Node {
  id: string
  name: string
  address: string
  tls_fingerprint?: string
  token?: string            // API 回傳 masked（lsm_node_****xxxx）；編輯時留空表示不變更
  notes?: string
  status: NodeStatus
  last_heartbeat?: string   // RFC3339 UTC
  agent_version?: string
  hostname?: string
  os?: string
  service_stats: ServiceStats
  created_at: string
  updated_at: string
}

export interface NodeSummary {
  total_nodes: number
  online: number
  degraded: number
  offline: number
  long_offline: number
  warning: number
  total_services: number
  active_services: number
  failed_services: number
}

export interface NodePayload {
  name: string
  address: string
  tls_fingerprint: string
  token: string
  notes: string
}

export interface TestConnectionRequest {
  address: string
  tls_fingerprint?: string
  token?: string
}

export interface TestConnectionResult {
  version: string
  hostname: string
  os: string
  uptime: number
}

export interface SearchResultItem {
  node_id: string
  node_name: string
  service: string
  active: string
  sub: string
}

export interface FailedNode {
  node_id: string
  node_name: string
  reason: string
}

export interface SearchResponse {
  results: SearchResultItem[]
  failed_nodes: FailedNode[]
}

export interface NodeSystemInfo {
  os: string
  kernel: string
  uptime: number
  cpu: string
  mem: string
  disk: string
}
