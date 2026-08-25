import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useRoute } from 'vue-router'
import type { ManagedNode, NodeSummary, NodeFormInput, NodeStatus } from '../types/node'
import {
  fetchNodes as apiFetchNodes,
  fetchNodeSummary as apiFetchSummary,
  createNode as apiCreateNode,
  deleteNode as apiDeleteNode,
  reconnectNode as apiReconnectNode,
} from '../api/nodeApi'

export const useNodeStore = defineStore('node', () => {
  // ── State ──
  const nodes = ref<ManagedNode[]>([])
  const summary = ref<NodeSummary | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  // ── Getters ──
  const currentNodeId = computed(() => {
    const route = useRoute()
    const nodeParam = route.query.node
    return nodeParam ? String(nodeParam) : null
  })

  const currentNode = computed(() =>
    currentNodeId.value
      ? nodes.value.find(n => n.id === currentNodeId.value) ?? null
      : null
  )

  const totalNodes = computed(() => nodes.value.length)
  const onlineCount = computed(() => nodes.value.filter(n => n.status === 'online').length)
  const offlineCount = computed(() =>
    nodes.value.filter(n => n.status === 'offline' || n.status === 'long_offline').length
  )

  // ── Actions ──
  async function fetchNodes() {
    loading.value = true
    error.value = null
    try {
      nodes.value = await apiFetchNodes()
    } catch (e: any) {
      error.value = e.message || 'Failed to fetch nodes'
    } finally {
      loading.value = false
    }
  }

  async function fetchSummary() {
    try {
      summary.value = await apiFetchSummary()
    } catch {
      // Non-critical, silently fail
    }
  }

  function applyStatusChanged(payload: { id: string; name: string; status: NodeStatus; message?: string }) {
    const node = nodes.value.find(n => n.id === payload.id)
    if (!node) return null
    const oldStatus = node.status
    node.status = payload.status
    if (payload.message) node.versionMessage = payload.message
    recomputeSummary()
    return { oldStatus, newStatus: payload.status, name: payload.name }
  }

  function applyRegistryChanged(payload: { action: 'added' | 'removed'; node: ManagedNode }) {
    if (payload.action === 'added') {
      if (!nodes.value.some(n => n.id === payload.node.id)) {
        nodes.value.push(payload.node)
      }
    } else if (payload.action === 'removed') {
      nodes.value = nodes.value.filter(n => n.id !== payload.node.id)
    }
    recomputeSummary()
  }

  function recomputeSummary() {
    summary.value = {
      totalNodes: nodes.value.length,
      online: nodes.value.filter(n => n.status === 'online').length,
      offline: nodes.value.filter(n => n.status === 'offline' || n.status === 'long_offline').length,
      servicesTotal: nodes.value.reduce((sum, n) => sum + n.servicesTotal, 0),
      running: nodes.value.reduce((sum, n) => sum + n.servicesRunning, 0),
      failed: nodes.value.reduce((sum, n) => sum + n.servicesFailed, 0),
    }
  }

  async function addNode(body: NodeFormInput) {
    const data = await apiCreateNode(body)
    if (!nodes.value.some(n => n.id === data.id)) {
      nodes.value.push(data)
    }
    recomputeSummary()
    return data
  }

  async function removeNode(id: string) {
    await apiDeleteNode(id)
    // WS event will handle the actual removal from state
  }

  async function reconnect(id: string) {
    await apiReconnectNode(id)
  }

  return {
    nodes, summary, loading, error,
    currentNodeId, currentNode, totalNodes, onlineCount, offlineCount,
    fetchNodes, fetchSummary,
    applyStatusChanged, applyRegistryChanged,
    addNode, removeNode, reconnect,
  }
})
