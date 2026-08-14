<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { Service, ServiceAction, BatchResult } from '../types/service'
import { listServices, startService, stopService, restartService, enableService, disableService, batchServices, getNodeServices, nodeServiceAction, getNodeLogs } from '../api/client'
import { useAuthStore } from '../stores/auth'
import { useServiceStore } from '../stores/service'
import { useNodesStore } from '../stores/nodes'
import { useToast } from '../composables/useToast'
import { useI18n } from '../composables/useI18n'
import { useServiceFilter } from '../composables/useServiceFilter'
import { useWebSocket } from '../composables/useWebSocket'
import AppHeader from '../components/AppHeader.vue'
import StatsBar from '../components/StatsBar.vue'
import TabsBar from '../components/TabsBar.vue'
import Toolbar from '../components/Toolbar.vue'
import ServiceTable from '../components/ServiceTable.vue'
import BatchResultPanel from '../components/BatchResultPanel.vue'
import ConfirmModal from '../components/ConfirmModal.vue'
import ToastContainer from '../components/ToastContainer.vue'
import LogDrawer from '../components/LogDrawer.vue'
import ConfigEditorModal from '../components/ConfigEditorModal.vue'
import NodeSwitcher from '../components/NodeSwitcher.vue'

const { t } = useI18n()
const auth = useAuthStore()
const serviceStore = useServiceStore()
const nodesStore = useNodesStore()
const { showToast } = useToast()

const route = useRoute()
const router = useRouter()

const services = ref<Service[]>([])
const loading = ref(true)
const tab = ref(localStorage.getItem('lms-tab') || 'my')

// ── node-aware 狀態（決策 8）：?node= 存在 → 節點模式；否則單機向後相容 ──
const nodeId = computed(() => route.query.node as string | undefined)
const isNodeMode = computed(() => !!nodeId.value)
const nodeOffline = computed(() => {
  const n = nodeId.value ? nodesStore.byId(nodeId.value) : null
  return !!n && !['online', 'degraded', 'warning'].includes(n.status)
})
/** 節點離線 → 操作按鈕全部禁用（BDD @offline @p1）＋ 頂部黃色 Banner「節點已離線，操作不可用」 */
const canOperate = computed(() => !isNodeMode.value || !nodeOffline.value)
/** ?service= 初始展開（點擊搜尋結果跳轉，決策 8） */
const expandedServiceName = computed(() => route.query.service as string | undefined)

// ── Batch selection state ──
const selectedNames = ref<Set<string>>(new Set())
const batchExecuting = ref(false)
const batchProgress = ref<{ done: number; total: number } | null>(null)
const batchResults = ref<BatchResult[]>([])
const showBatchResult = ref(false)
const showBatchConfirm = ref(false)
const pendingBatchAction = ref<ServiceAction | null>(null)

const selectedCount = computed(() => selectedNames.value.size)

const batchConfirmMessage = computed(() => {
  if (!pendingBatchAction.value) return ''
  const n = selectedCount.value
  const actMap: Record<string, string> = { start: '啟動', stop: '停止', restart: '重啟' }
  let msg = `確定要${actMap[pendingBatchAction.value]} ${n} 個服務？`
  if (pendingBatchAction.value === 'restart') {
    msg += '\n⚠️ 重啟會造成服務短暫中斷'
  }
  return msg
})

const batchConfirmDetails = computed(() => {
  const names = Array.from(selectedNames.value)
  if (names.length <= 5) return names
  return [...names.slice(0, 5), `...及其他 ${names.length - 5} 個`]
})

// ── WebSocket connection ──
const { status: wsStatus, on, disconnect } = useWebSocket()

on('status_change', (msg: any) => {
  // node 模式：服務列表來自 Agent 代理查詢，本機 WS 事件不套用（決策 6：每次皆代理，E-8）
  if (isNodeMode.value) return
  // Suppress WebSocket updates during batch execution
  if (batchExecuting.value) return

  // status_change 只帶 active/sub（執行狀態），不含 unitFileState
  const updates: Partial<Service> = { active: msg.active, sub: msg.sub }
  serviceStore.updateService(msg.name, updates)
  // Sync local ref for useServiceFilter
  const idx = services.value.findIndex(s => s.name === msg.name)
  if (idx !== -1) {
    services.value[idx] = { ...services.value[idx], ...updates }
  }
})

on('on_boot_change', (msg: any) => {
  if (isNodeMode.value) return
  // on_boot_change 只帶 unitFileState（開機啟動狀態）
  serviceStore.updateService(msg.name, { unitFileState: msg.unitFileState })
  const idx = services.value.findIndex(s => s.name === msg.name)
  if (idx !== -1) {
    services.value[idx] = { ...services.value[idx], unitFileState: msg.unitFileState }
  }
})

on('service_added', (msg: any) => {
  if (isNodeMode.value) return
  const newService: Service = {
    name: msg.name,
    active: msg.active,
    sub: msg.sub,
    unitFileState: msg.unitFileState || 'unknown',
    load: 'loaded',
    locked: false,
    fragmentPath: '',
  }
  serviceStore.addService(newService)
  if (!services.value.find(s => s.name === msg.name)) {
    services.value.push(newService)
  }
  showToast(`偵測到新服務：${msg.name}`)
})

on('service_removed', (msg: any) => {
  if (isNodeMode.value) return
  serviceStore.removeService(msg.name)
  services.value = services.value.filter(s => s.name !== msg.name)
  showToast(`服務已移除：${msg.name}`)
})

on('snapshot', (msg: any) => {
  if (isNodeMode.value) return
  serviceStore.applySnapshot(msg.services)
  // Sync local ref from store
  services.value = [...serviceStore.services]
})

on('session_expired', () => {
  disconnect()
  showToast('Session 已過期，請重新登入', 'error')
  auth.logout()
  router.replace('/login')
})

// Log drawer state
const logDrawerVisible = ref(false)
const logDrawerServiceName = ref('')
const nodeLogsText = ref<string | null>(null) // node 模式：getNodeLogs 拉取的靜態日誌

/** 服務列表載入：node mode → GET /api/v1/nodes/{id}/services（Manager 代理 Agent）；否則本機 /services（向後相容） */
async function loadServices() {
  loading.value = true
  try {
    const list = nodeId.value ? await getNodeServices(nodeId.value) : await listServices()
    services.value = list
    serviceStore.setServices(list)
  } catch (err) {
    showToast('Failed to load services', 'error')
  } finally {
    loading.value = false
  }
}

/** 節點模式服務操作（決策 8 / D-9）：
 * 逾時（15s）→ Toast「web-server-01 操作逾時：nginx.service restart」＋ 按鈕恢復可點擊（BDD @timeout）
 * in-flight 標記（同節點同服務並行限制，BDD @concurrency；key 含 nodeId，不同節點可並行） */
async function runAction(name: string, action: 'start' | 'stop' | 'restart' | 'enable' | 'disable') {
  if (!canOperate.value || !nodeId.value) return
  const key = `${nodeId.value}:${name}:${action}`
  if (nodesStore.inFlight[key]) return
  nodesStore.markInFlight(nodeId.value, name, action, true)
  try {
    const res = await nodeServiceAction(nodeId.value, name, action)
    showToast(`${nodesStore.activeNode?.name} ${name} ${res.message || '操作成功'}`, 'success')
    await loadServices()
  } catch (e: any) {
    if (e.code === 'ECONNABORTED' || e?.message?.includes('timeout')) {
      showToast(`${nodesStore.activeNode?.name} 操作逾時：${name} ${action}`, 'warning')
    } else {
      showToast(`${nodesStore.activeNode?.name} ${name} 操作失敗：${e?.response?.data?.error || e.message}`, 'error')
    }
  } finally {
    nodesStore.markInFlight(nodeId.value, name, action, false)
  }
}

async function handleAction(action: ServiceAction, name: string) {
  if (isNodeMode.value) {
    await runAction(name, action)
    return
  }
  try {
    const actionMap: Record<ServiceAction, { fn: Function; key: string }> = {
      start: { fn: startService, key: 'toast.started' },
      stop: { fn: stopService, key: 'toast.stopped' },
      restart: { fn: restartService, key: 'toast.restarted' },
    }
    await actionMap[action].fn(name)
    showToast(t(actionMap[action].key, { name }), 'success')
    // WebSocket will push status change; no need to reload
  } catch (err: any) {
    showToast(err.response?.data?.error || t('toast.error', { name }), 'error')
    await loadServices()
  }
}

const togglingService = ref<string>()

async function handleToggle(action: 'enable' | 'disable', name: string) {
  if (action === 'disable') {
    showDisableConfirm.value = true
    pendingDisableService.value = name
    return
  }
  await executeToggle(action, name)
}

async function executeToggle(action: 'enable' | 'disable', name: string) {
  if (isNodeMode.value) {
    // node 模式：enable/disable 走節點代理端點（決策 8）
    await runAction(name, action)
    return
  }
  togglingService.value = name
  try {
    if (action === 'enable') {
      await enableService(name)
      showToast(t('toast.enabled', { name }), 'success')
    } else {
      await disableService(name)
      showToast(t('toast.disabled', { name }), 'success')
    }
    // Update local state immediately for the toggled service
    const newState = action === 'enable' ? 'enabled' : 'disabled'
    const idx = services.value.findIndex(s => s.name === name)
    if (idx !== -1) {
      services.value[idx] = { ...services.value[idx], unitFileState: newState }
    }
    serviceStore.updateService(name, { unitFileState: newState })
  } catch (err: any) {
    const errMsg = err.response?.data?.error || t('toast.error', { name })
    showToast(errMsg, 'error')
    await loadServices()
  } finally {
    togglingService.value = undefined
  }
}

// Disable confirm state
const showDisableConfirm = ref(false)
const pendingDisableService = ref<string>()

function confirmDisable() {
  if (pendingDisableService.value) {
    executeToggle('disable', pendingDisableService.value)
  }
  showDisableConfirm.value = false
  pendingDisableService.value = undefined
}

function cancelDisable() {
  showDisableConfirm.value = false
  pendingDisableService.value = undefined
}

// Service filtering composable
const {
  statusFilter,
  searchText,
  regexMode,
  regexError,
  filteredServices,
  setStatusFilter,
  clearSearch,
  toggleRegex,
  clearAllFilters,
  initFromQuery,
} = useServiceFilter(services, router)

const statsServices = computed(() =>
  services.value.filter(s => tab.value === 'my' ? !s.locked : s.locked)
)

// 表格視圖計數：tab + 狀態 + 搜尋 後的列數（與 ServiceTable 顯示一致）
const tabbedFilteredCount = computed(() =>
  filteredServices.value.filter(s => tab.value === 'my' ? !s.locked : s.locked).length
)

const disableConfirmMessage = computed(() => {
  if (!pendingDisableService.value) return ''
  return t('modal.disable', { name: pendingDisableService.value })
})

function setTab(t: string) {
  tab.value = t
  localStorage.setItem('lms-tab', t)
  clearSelection()
}

// ── Batch selection handlers ──

function toggleSelect(name: string) {
  const next = new Set(selectedNames.value)
  if (next.has(name)) {
    next.delete(name)
  } else {
    next.add(name)
  }
  selectedNames.value = next
}

function selectAllFiltered(filteredNames: string[]) {
  if (filteredNames.length === 0) {
    clearSelection()
  } else {
    selectedNames.value = new Set(filteredNames)
  }
}

function clearSelection() {
  selectedNames.value = new Set()
  showBatchResult.value = false
}

// ── Batch execution ──

function onBatchAction(action: ServiceAction) {
  pendingBatchAction.value = action
  showBatchConfirm.value = true
}

function confirmBatch() {
  showBatchConfirm.value = false
  if (pendingBatchAction.value) {
    executeBatch(pendingBatchAction.value)
  }
}

function cancelBatch() {
  showBatchConfirm.value = false
  pendingBatchAction.value = null
}

async function executeBatch(action: ServiceAction) {
  const names = Array.from(selectedNames.value)
  if (names.length === 0) return

  batchExecuting.value = true
  batchProgress.value = { done: 0, total: names.length }
  showBatchResult.value = false

  try {
    const resp = await batchServices({ names, action })
    batchResults.value = resp.results
    showBatchResult.value = true

    if (resp.summary.failed === 0) {
      // All success
      showToast(`${resp.summary.success} 個服務已成功${action === 'start' ? '啟動' : action === 'stop' ? '停止' : '重啟'}`, 'success')
      clearSelection()
      await loadServices()
    } else if (resp.summary.success === 0) {
      // All failure
      showToast('批次操作失敗', 'error')
      // Keep selection for retry
    } else {
      // Partial failure
      showToast(`${resp.summary.success} 成功，${resp.summary.failed} 失敗`, 'warning')
      // Keep failed items selected for retry
      const failedNames = new Set(resp.results.filter(r => r.result === 'failure').map(r => r.name))
      selectedNames.value = failedNames
    }
  } catch (err: any) {
    showToast(err.response?.data?.error || '批次操作失敗', 'error')
  } finally {
    batchExecuting.value = false
    batchProgress.value = null
    pendingBatchAction.value = null
  }
}

function retryBatch(name: string) {
  // Retry single failed service with same action
  handleAction(pendingBatchAction.value || 'start', name)
}

function dismissBatchResult() {
  showBatchResult.value = false
}

async function handleLogout() {
  disconnect()
  await auth.logout()
  router.replace('/login')
}

/** 開啟日誌檢視器：node 模式 → getNodeLogs 拉取靜態日誌（決策 8/F-DV-10）；單機 → LogDrawer WS 即時串流 */
async function openLogDrawer(name: string) {
  logDrawerServiceName.value = name
  nodeLogsText.value = null
  if (nodeId.value) {
    try {
      nodeLogsText.value = await getNodeLogs(nodeId.value, name)
    } catch {
      nodeLogsText.value = '(無法取得日誌：節點離線或逾時)'
    }
  }
  logDrawerVisible.value = true
}

function closeLogDrawer() {
  logDrawerVisible.value = false
  logDrawerServiceName.value = ''
  nodeLogsText.value = null
}

/** ?service= 初始展開（點擊搜尋結果跳轉，決策 8）：自動展開該服務的日誌檢視器 */
watch(expandedServiceName, (svc) => {
  if (svc) openLogDrawer(svc)
}, { immediate: true })

/** ?node= 變更（Header NodeSwitcher 切換，F-SW-04）：重設 active 節點 + 重新載入服務列表；
 *  immediate 處理首次掛載（BDD @switch：讀取 ?node 設定 active 節點） */
watch(nodeId, (id) => {
  if (id) {
    nodesStore.setActiveNode(id)          // 讀取 ?node（BDD @switch）
    // 直接造訪 /dashboard?node= 時 nodes 尚未載入：補拉節點清單（離線 Banner / NodeSwitcher 依賴）
    if (nodesStore.nodes.length === 0) nodesStore.fetchNodes()
  } else {
    nodesStore.setActiveNode(null)         // 非節點模式（單機向後相容）
  }
  loadServices()
}, { immediate: true })

onMounted(() => {
  initFromQuery()
})

onUnmounted(() => {
  disconnect()
})
</script>

<template>
  <main class="app-container dashboard-page">
    <!-- node-aware Header：NodeSwitcher + 「所有節點」返回（BDD @switch） -->
    <div class="dashboard-header">
      <NodeSwitcher />
      <router-link v-if="isNodeMode" class="btn btn-sm" to="/">← 所有節點</router-link>
    </div>

    <!-- 離線 Banner（BDD @offline @p1） -->
    <div v-if="nodeOffline" class="offline-banner" data-testid="offline-banner" role="alert">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4m0 4h.01"/></svg>
      <span>節點已離線，操作不可用</span>
    </div>

    <AppHeader :username="auth.username" :wsStatus="wsStatus" @logout="handleLogout" />
    <TabsBar :services="services" :tab="tab" @set-tab="setTab" />
    <StatsBar
      :services="statsServices"
      :statusFilter="statusFilter"
      :loading="loading"
      @set-status-filter="setStatusFilter"
    />
    <BatchResultPanel
      v-if="showBatchResult && batchResults.length > 0"
      :results="batchResults"
      @retry="retryBatch"
      @dismiss="dismissBatchResult"
    />
    <Toolbar
      :searchText="searchText"
      :regexMode="regexMode"
      :regexError="regexError"
      :filteredCount="tabbedFilteredCount"
      :totalCount="statsServices.length"
      :loading="loading"
      :showRefresh="true"
      @update:searchText="searchText = $event"
      @toggle-regex="toggleRegex"
      @clear-search="clearSearch"
      @refresh="loadServices"
    />
    <ServiceTable
      :filteredServices="filteredServices"
      :tab="tab"
      :loading="loading"
      :togglingService="togglingService"
      :selectedNames="selectedNames"
      :batchExecuting="batchExecuting"
      :batchProgress="batchProgress"
      :expandedService="expandedServiceName"
      :actionsDisabled="!canOperate"
      @action="handleAction"
      @refresh="loadServices"
      @toggle="handleToggle"
      @open-logs="openLogDrawer"
      @clear-filters="clearAllFilters"
      @toggle-select="toggleSelect"
      @select-all="selectAllFiltered"
      @batch-action="onBatchAction"
      @clear-selection="clearSelection"
    />
    <ConfirmModal
      :show="showDisableConfirm"
      :message="disableConfirmMessage"
      @confirm="confirmDisable"
      @cancel="cancelDisable"
    />
    <ConfirmModal
      :show="showBatchConfirm"
      :message="batchConfirmMessage"
      :details="batchConfirmDetails"
      @confirm="confirmBatch"
      @cancel="cancelBatch"
    />
    <ToastContainer />
    <LogDrawer
      :serviceName="logDrawerServiceName"
      :visible="logDrawerVisible"
      :logs="nodeLogsText"
      @close="closeLogDrawer"
    />
    <ConfigEditorModal />
  </main>
</template>
