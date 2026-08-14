// ── 014 Multi-Node Agent Management — nodes store（決策 8）──
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { Node, NodeStatus, NodeSummary } from '../types/node'
import { listNodes, getNodesSummary } from '../api/client'
import { useToast } from '../composables/useToast'

export const useNodesStore = defineStore('nodes', () => {
  // ── state ──
  const nodes = ref<Node[]>([])
  const activeNodeId = ref<string | null>(null)   // null = Aggregate 模式
  const summary = ref<NodeSummary | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const inFlight = ref<Record<string, boolean>>({}) // key = `${nodeId}:${serviceName}:${action}`（同節點同服務並行限制，決策 9/D-9）

  // ── getters ──
  const onlineNodes = computed(() => nodes.value.filter(n => n.status === 'online'))
  const byId = (id: string) => nodes.value.find(n => n.id === id)
  const activeNode = computed(() => activeNodeId.value ? byId(activeNodeId.value) ?? null : null)
  const isNodeActionDisabled = (nodeId: string, name: string, action: string) =>
    !['online', 'degraded', 'warning'].includes(byId(nodeId)?.status ?? '') || !!inFlight.value[`${nodeId}:${name}:${action}`]
    // 語意與 DashboardView canOperate 一致（online/degraded/warning 可操作；僅 offline/long_offline 禁用）

  // ── actions ──
  async function fetchNodes(): Promise<void> {
    loading.value = true
    try {
      nodes.value = await listNodes()   // 失敗時不覆蓋既有資料
      error.value = null
    } catch (e: any) {
      error.value = e?.response?.data?.error || e.message
    } finally {
      loading.value = false
    }
  }

  async function fetchSummary(): Promise<void> {
    summary.value = await getNodesSummary()
  }

  function setActiveNode(id: string | null): void {
    activeNodeId.value = id
  }

  /** WS 事件應用（決策 3 / F-NS-05~08）：依 type 更新單一節點或移除 */
  function applyNodeEvent(msg: {
    type: 'node_status' | 'node_online' | 'node_offline' | 'node_removed'
    id: string; name?: string; active?: NodeStatus; last_heartbeat?: string; agent_version?: string; timestamp?: string
  }): void {
    const { showToast } = useToast()
    if (msg.type === 'node_removed') {
      nodes.value = nodes.value.filter(n => n.id !== msg.id)
      recomputeSummary()
      return
    }
    const n = byId(msg.id)
    if (!n) return
    if (msg.active) n.status = msg.active
    if (msg.last_heartbeat) n.last_heartbeat = msg.last_heartbeat
    if (msg.agent_version) n.agent_version = msg.agent_version
    // 節點狀態/心跳變更 → 同步本地 summary（BDD「無需手動重整頁面」：統計列即時反映，決策 3/7 聚合語意）
    recomputeSummary()
    if (msg.type === 'node_online') showToast(`${msg.name} 已恢復連線`, 'success')      // BDD 寬限期恢復
    if (msg.type === 'node_offline') showToast(`${msg.name} 已離線`, 'warning')          // BDD 30s 無心跳
  }

  /** 依 nodes 現況聚合 summary（與後端 HDL-15 語意一致：線上嚴格計 status==online、離線=offline+long_offline） */
  function recomputeSummary(): void {
    const list = nodes.value
    summary.value = {
      total_nodes: list.length,
      online: list.filter(n => n.status === 'online').length,
      degraded: list.filter(n => n.status === 'degraded').length,
      offline: list.filter(n => n.status === 'offline').length,
      long_offline: list.filter(n => n.status === 'long_offline').length,
      warning: list.filter(n => n.status === 'warning').length,
      total_services: list.reduce((s, n) => s + (n.service_stats?.total ?? 0), 0),
      active_services: list.reduce((s, n) => s + (n.service_stats?.active ?? 0), 0),
      failed_services: list.reduce((s, n) => s + (n.service_stats?.failed ?? 0), 0),
    }
  }

  /** 操作 in-flight 標記（同節點同服務禁用第二個並行操作，BDD @concurrency；不同節點可並行 — key 含 nodeId） */
  function markInFlight(nodeId: string, name: string, action: string, inflight: boolean): void {
    const key = `${nodeId}:${name}:${action}`
    if (inflight) inFlight.value[key] = true
    else delete inFlight.value[key]
  }

  return {
    nodes, activeNodeId, summary, loading, error, inFlight,
    onlineNodes, byId, activeNode, isNodeActionDisabled,
    fetchNodes, fetchSummary, setActiveNode, applyNodeEvent, markInFlight,
  }
})
