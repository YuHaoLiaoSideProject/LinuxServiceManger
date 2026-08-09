<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import type { Service, ServiceAction } from '../types/service'
import { listServices, startService, stopService, restartService, enableService, disableService } from '../api/client'
import { useAuthStore } from '../stores/auth'
import { useToast } from '../composables/useToast'
import { useI18n } from '../composables/useI18n'
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
const { showToast } = useToast()

const services = ref<Service[]>([])
const loading = ref(true)
const tab = ref(localStorage.getItem('lms-tab') || 'my')
const search = ref('')

// Log drawer state
const logDrawerVisible = ref(false)
const logDrawerServiceName = ref('')

async function loadServices() {
  loading.value = true
  try {
    services.value = await listServices()
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
    await loadServices()
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
    // Update local state directly to avoid full page refresh
    const svc = services.value.find(s => s.name === name)
    if (svc) {
      svc.unitFileState = action === 'enable' ? 'enabled' : 'disabled'
    }
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

const router = useRouter()

async function handleLogout() {
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

onMounted(loadServices)
</script>

<template>
  <main class="app-container">
    <AppHeader :username="auth.username" @refresh="loadServices" @logout="handleLogout" />
    <TabsBar :services="services" :tab="tab" @set-tab="setTab" />
    <StatsBar :services="statsServices" />
    <Toolbar @search="(s: string) => search = s" />
    <ServiceTable
      :services="services"
      :tab="tab"
      :search="search"
      :loading="loading"
      :togglingService="togglingService"
      @action="handleAction"
      @refresh="loadServices"
      @toggle="handleToggle"
      @open-logs="openLogDrawer"
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
