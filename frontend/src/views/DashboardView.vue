<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import type { Service, ServiceAction } from '../types/service'
import { listServices, startService, stopService, restartService, enableService, disableService } from '../api/client'
import { useAuthStore } from '../stores/auth'
import { useServiceStore } from '../stores/service'
import { useToast } from '../composables/useToast'
import { useI18n } from '../composables/useI18n'
import { useServiceFilter } from '../composables/useServiceFilter'
import { useWebSocket } from '../composables/useWebSocket'
import AppHeader from '../components/AppHeader.vue'
import StatsBar from '../components/StatsBar.vue'
import TabsBar from '../components/TabsBar.vue'
import Toolbar from '../components/Toolbar.vue'
import ServiceTable from '../components/ServiceTable.vue'
import ConfirmModal from '../components/ConfirmModal.vue'
import ToastContainer from '../components/ToastContainer.vue'
import LogDrawer from '../components/LogDrawer.vue'

const { t } = useI18n()
const auth = useAuthStore()
const serviceStore = useServiceStore()
const { showToast } = useToast()

const services = ref<Service[]>([])
const loading = ref(true)
const tab = ref(localStorage.getItem('lms-tab') || 'my')

// ── WebSocket connection ──
const { status: wsStatus, on, disconnect } = useWebSocket()

on('status_change', (msg: any) => {
  serviceStore.updateService(msg.name, {
    active: msg.active,
    sub: msg.sub,
    unitFileState: msg.unitFileState,
  })
  // Sync local ref for useServiceFilter
  const idx = services.value.findIndex(s => s.name === msg.name)
  if (idx !== -1) {
    const svc = services.value[idx]
    services.value[idx] = { ...svc, active: msg.active, sub: msg.sub, unitFileState: msg.unitFileState }
  }
})

on('service_added', (msg: any) => {
  const newService: Service = {
    name: msg.name,
    active: msg.active,
    sub: msg.sub,
    unitFileState: msg.unitFileState,
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
  serviceStore.removeService(msg.name)
  services.value = services.value.filter(s => s.name !== msg.name)
  showToast(`服務已移除：${msg.name}`)
})

on('snapshot', (msg: any) => {
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

async function loadServices() {
  loading.value = true
  try {
    services.value = await listServices()
    serviceStore.setServices(services.value)
  } catch (err) {
    showToast('Failed to load services', 'error')
  } finally {
    loading.value = false
  }
}

async function handleAction(action: ServiceAction, name: string) {
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

const router = useRouter()

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

const disableConfirmMessage = computed(() => {
  if (!pendingDisableService.value) return ''
  return t('modal.disable', { name: pendingDisableService.value })
})

function setTab(t: string) {
  tab.value = t
  localStorage.setItem('lms-tab', t)
}

async function handleLogout() {
  disconnect()
  await auth.logout()
  router.replace('/login')
}

function openLogDrawer(name: string) {
  logDrawerServiceName.value = name
  logDrawerVisible.value = true
}

function closeLogDrawer() {
  logDrawerVisible.value = false
  logDrawerServiceName.value = ''
}

onMounted(() => {
  loadServices()
  initFromQuery()
})

onUnmounted(() => {
  disconnect()
})
</script>

<template>
  <main class="app-container">
    <AppHeader :username="auth.username" :wsStatus="wsStatus" @refresh="loadServices" @logout="handleLogout" />
    <TabsBar :services="services" :tab="tab" @set-tab="setTab" />
    <StatsBar :services="statsServices" />
    <Toolbar
      :statusFilter="statusFilter"
      :searchText="searchText"
      :regexMode="regexMode"
      :regexError="regexError"
      :filteredCount="filteredServices.length"
      :loading="loading"
      @update:searchText="searchText = $event"
      @set-status-filter="setStatusFilter"
      @toggle-regex="toggleRegex"
      @clear-search="clearSearch"
    />
    <ServiceTable
      :filteredServices="filteredServices"
      :tab="tab"
      :loading="loading"
      :togglingService="togglingService"
      @action="handleAction"
      @refresh="loadServices"
      @toggle="handleToggle"
      @open-logs="openLogDrawer"
      @clear-filters="clearAllFilters"
    />
    <ConfirmModal
      :show="showDisableConfirm"
      :message="disableConfirmMessage"
      @confirm="confirmDisable"
      @cancel="cancelDisable"
    />
    <ToastContainer />
    <LogDrawer
      :serviceName="logDrawerServiceName"
      :visible="logDrawerVisible"
      @close="closeLogDrawer"
    />
  </main>
</template>
