// Node management API functions

import api from './client'
import type {
  ManagedNode,
  NodeSummary,
  NodeFormInput,
  TestConnectionInput,
  TestConnectionResult,
} from '../types/node'
import type { Service } from '../types/service'

// ── Node CRUD ──

export async function fetchNodes(): Promise<ManagedNode[]> {
  const { data } = await api.get<ManagedNode[]>('/nodes')
  return data
}

export async function fetchNode(id: string): Promise<ManagedNode> {
  const { data } = await api.get<ManagedNode>(`/nodes/${id}`)
  return data
}

export async function fetchNodeSummary(): Promise<NodeSummary> {
  const { data } = await api.get<NodeSummary>('/nodes/summary')
  return data
}

export async function createNode(body: NodeFormInput): Promise<ManagedNode> {
  const { data } = await api.post<ManagedNode>('/nodes', body, {
    headers: { 'Content-Type': 'application/json' },
  })
  return data
}

export async function updateNode(id: string, body: Partial<NodeFormInput>): Promise<ManagedNode> {
  const { data } = await api.put<ManagedNode>(`/nodes/${id}`, body, {
    headers: { 'Content-Type': 'application/json' },
  })
  return data
}

export async function deleteNode(id: string): Promise<{ message: string }> {
  const { data } = await api.delete<{ message: string }>(`/nodes/${id}`)
  return data
}

export async function reconnectNode(id: string): Promise<{ message: string }> {
  const { data } = await api.post<{ message: string }>(`/nodes/${id}/reconnect`)
  return data
}

export async function testConnection(body: TestConnectionInput): Promise<TestConnectionResult> {
  const { data } = await api.post<TestConnectionResult>('/nodes/test-connection', body, {
    headers: { 'Content-Type': 'application/json' },
  })
  return data
}

// ── Agent binary download ──

export function agentBinaryUrl(arch: 'amd64' | 'arm64'): string {
  return `/api/v1/nodes/agent-binary?arch=${arch}`
}

// ── Single-node service operations ──

export async function fetchNodeServices(nodeId: string): Promise<Service[]> {
  const { data } = await api.get(`/nodes/${nodeId}/services`)
  return data
}

export async function nodeServiceAction(
  nodeId: string,
  serviceName: string,
  action: string,
): Promise<{ message: string }> {
  const { data } = await api.post<{ message: string }>(
    `/nodes/${nodeId}/services/${encodeURIComponent(serviceName)}/${action}`,
  )
  return data
}

export async function fetchNodeServiceLogs(
  nodeId: string,
  serviceName: string,
  lines = 100,
): Promise<{ lines: string[] }> {
  const { data } = await api.get(`/nodes/${nodeId}/services/${encodeURIComponent(serviceName)}/logs`, {
    params: { lines },
  })
  return data
}

export async function fetchNodeInfo(nodeId: string): Promise<Record<string, unknown>> {
  const { data } = await api.get(`/nodes/${nodeId}/info`)
  return data
}
