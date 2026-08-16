import axios from 'axios'
import type { Service, LoginResponse, SessionInfo, MessageResponse, BatchRequest, BatchResponse, TokenListResponse, CreateTokenRequest, CreateTokenResponse, RevokeTokenResponse, ServiceConfigResponse, SaveConfigRequest, SaveConfigResponse, ValidateResponse } from '../types/service'
import type { Channel, ChannelPayload, NotifyHistoryResult, HistoryQuery, TestChannelResponse } from '../types/notify'
import type { Node, NodeSummary, NodePayload, TestConnectionRequest, TestConnectionResult, SearchResponse, NodeSystemInfo } from '../types/node'
import { useAuthStore } from '../stores/auth'

const api = axios.create({
  baseURL: '/api/v1',
  withCredentials: true,
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
})

export default api

// Intercept 401 responses to reset auth state (session expired)
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      const auth = useAuthStore()
      auth.authenticated = false
      auth.username = ''
    }
    return Promise.reject(error)
  },
)

// Auth
export async function login(username: string, password: string): Promise<LoginResponse> {
  const params = new URLSearchParams({ username, password })
  const { data } = await api.post<LoginResponse>('/login', params)
  return data
}

export async function logout(): Promise<MessageResponse> {
  const { data } = await api.post<MessageResponse>('/logout')
  return data
}

export async function checkSession(): Promise<SessionInfo> {
  const { data } = await api.get<SessionInfo>('/session')
  return data
}

// Services
export async function listServices(): Promise<Service[]> {
  const { data } = await api.get<Service[]>('/services')
  return data
}

export async function startService(name: string): Promise<MessageResponse> {
  const { data } = await api.post<MessageResponse>(`/services/${encodeURIComponent(name)}/start`)
  return data
}

export async function stopService(name: string): Promise<MessageResponse> {
  const { data } = await api.post<MessageResponse>(`/services/${encodeURIComponent(name)}/stop`)
  return data
}

export async function restartService(name: string): Promise<MessageResponse> {
  const { data } = await api.post<MessageResponse>(`/services/${encodeURIComponent(name)}/restart`)
  return data
}

export async function enableService(name: string): Promise<MessageResponse> {
  const { data } = await api.post<MessageResponse>(`/services/${encodeURIComponent(name)}/enable`)
  return data
}

export async function disableService(name: string): Promise<MessageResponse> {
  const { data } = await api.post<MessageResponse>(`/services/${encodeURIComponent(name)}/disable`)
  return data
}

export async function batchServices(req: BatchRequest): Promise<BatchResponse> {
  const { data } = await api.post<BatchResponse>('/services/batch', req, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 65_000,
  })
  return data
}

// ── API Tokens ──

export async function listTokens(): Promise<TokenListResponse> {
  const { data } = await api.get<TokenListResponse>('/tokens')
  return data
}

export async function createToken(req: CreateTokenRequest): Promise<CreateTokenResponse> {
  const { data } = await api.post<CreateTokenResponse>('/tokens', req, {
    headers: { 'Content-Type': 'application/json' },
  })
  return data
}

export async function revokeToken(id: string): Promise<RevokeTokenResponse> {
  const { data } = await api.post<RevokeTokenResponse>(`/tokens/${encodeURIComponent(id)}/revoke`)
  return data
}

// ── Service Config Editor (012) ──

export async function getServiceConfig(name: string): Promise<ServiceConfigResponse> {
  const { data } = await api.get<ServiceConfigResponse>(`/services/${encodeURIComponent(name)}/config`)
  return data
}

export async function saveServiceConfig(name: string, req: SaveConfigRequest): Promise<SaveConfigResponse> {
  const { data } = await api.put<SaveConfigResponse>(`/services/${encodeURIComponent(name)}/config`, req, {
    headers: { 'Content-Type': 'application/json' },
  })
  return data
}

export async function validateServiceConfig(name: string, config: string): Promise<ValidateResponse> {
  const { data } = await api.post<ValidateResponse>(
    `/services/${encodeURIComponent(name)}/config/validate`,
    { config },
    { headers: { 'Content-Type': 'application/json' } },
  )
  return data
}

// ── Webhook Notification (013) ──

export async function listChannels(): Promise<Channel[]> {
  const { data } = await api.get<{ data: Channel[] }>('/notify/channels')
  return data.data
}

export async function createChannel(payload: ChannelPayload): Promise<Channel> {
  const { data } = await api.post<{ data: Channel }>('/notify/channels', payload, {
    headers: { 'Content-Type': 'application/json' },
  })
  return data.data
}

export async function updateChannel(id: string, payload: ChannelPayload): Promise<Channel> {
  const { data } = await api.put<{ data: Channel }>(`/notify/channels/${id}`, payload, {
    headers: { 'Content-Type': 'application/json' },
  })
  return data.data
}

export async function deleteChannel(id: string): Promise<void> {
  await api.delete(`/notify/channels/${id}`)
}

export async function patchChannelEnabled(id: string, enabled: boolean): Promise<Channel> {
  const { data } = await api.patch<{ data: Channel }>(`/notify/channels/${id}`, { enabled }, {
    headers: { 'Content-Type': 'application/json' },
  })
  return data.data
}

export async function testChannel(id: string): Promise<TestChannelResponse> {
  const { data } = await api.post<TestChannelResponse>(`/notify/channels/${id}/test`)
  return data
}

export async function getNotifyHistory(q: HistoryQuery = {}): Promise<NotifyHistoryResult> {
  const params = new URLSearchParams()
  if (q.page) params.set('page', String(q.page))
  if (q.limit) params.set('limit', String(q.limit))
  if (q.channel_id) params.set('channel_id', q.channel_id)
  if (q.status && q.status !== 'all') params.set('status', q.status)
  const { data } = await api.get<NotifyHistoryResult>('/notify/history', { params })
  return data
}

// ── Multi-Node Agent Management (014) ──
// 節點層 API（決策 8：service functions 接受 optional nodeId 前綴 — nodeId 存在時走 /nodes/{id}/… 代理）

export async function listNodes(): Promise<Node[]> {
  const { data } = await api.get<{ data: Node[] }>('/nodes')
  return data.data
}

export async function createNode(payload: NodePayload): Promise<Node> {
  const { data } = await api.post<{ data: Node }>('/nodes', payload)
  return data.data
}

export async function updateNode(id: string, payload: NodePayload): Promise<Node> {
  const { data } = await api.put<{ data: Node }>(`/nodes/${id}`, payload)
  return data.data
}

export async function deleteNode(id: string): Promise<void> {
  await api.delete(`/nodes/${id}`)
}

export async function reconnectNode(id: string): Promise<Node> {
  const { data } = await api.post<{ data: Node }>(`/nodes/${id}/reconnect`)
  return data.data
}

export async function testConnection(req: TestConnectionRequest): Promise<TestConnectionResult> {
  const { data } = await api.post<TestConnectionResult>('/nodes/test-connection', req)
  return data
}

export async function getNodesSummary(): Promise<NodeSummary> {
  const { data } = await api.get<{ data: NodeSummary }>('/nodes/summary')
  return data.data
}

export async function searchServices(q: string): Promise<SearchResponse> {
  const { data } = await api.get<SearchResponse>('/nodes/services/search', { params: { q } })
  return data
}

/** node-aware 服務函式：nodeId 存在 → 代理前綴；否則維持單機路徑（向後相容） */
export async function getNodeServices(nodeId: string): Promise<Service[]> {
  const { data } = await api.get<Service[]>(`/nodes/${nodeId}/services`)
  return data
}

export async function nodeServiceAction(nodeId: string, name: string, action: 'start' | 'stop' | 'restart' | 'enable' | 'disable'): Promise<MessageResponse> {
  const { data } = await api.post<MessageResponse>(`/nodes/${nodeId}/services/${encodeURIComponent(name)}/${action}`)
  return data
}

export async function getNodeLogs(nodeId: string, name: string, lines?: number): Promise<string> {
  const { data } = await api.get<string>(`/nodes/${nodeId}/services/${encodeURIComponent(name)}/logs`, { params: { lines } })
  return data
}

export async function getNodeInfo(nodeId: string): Promise<NodeSystemInfo> {
  const { data } = await api.get<NodeSystemInfo>(`/nodes/${nodeId}/info`)
  return data
}

export async function downloadAgent(arch: 'amd64' | 'arm64'): Promise<Blob> {
  const { data } = await api.get<Blob>(`/agents/download`, { params: { arch }, responseType: 'blob' })
  return data
}
