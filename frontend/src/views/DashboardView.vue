<script setup lang="ts">
import { ref, onMounted } from 'vue'
import type { Service, ServiceAction } from '../types/service'
import { listServices, startService, stopService, restartService } from '../api/client'
import { useAuthStore } from '../stores/auth'
import { useToast } from '../composables/useToast'
import { useI18n } from '../composables/useI18n'
import AppHeader from '../components/AppHeader.vue'
import StatsBar from '../components/StatsBar.vue'
import TabsBar from '../components/TabsBar.vue'
import Toolbar from '../components/Toolbar.vue'
import ServiceTable from '../components/ServiceTable.vue'
import ToastContainer from '../components/ToastContainer.vue'

const { t } = useI18n()
const auth = useAuthStore()
const { showToast } = useToast()

const services = ref<Service[]>([])
const loading = ref(true)
const tab = ref(localStorage.getItem('lms-tab') || 'my')
const search = ref('')

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

function setTab(t: string) {
  tab.value = t
  localStorage.setItem('lms-tab', t)
}

async function handleLogout() {
  await auth.logout()
}

onMounted(loadServices)
</script>

<template>
  <main class="app-container">
    <AppHeader :username="auth.username" @refresh="loadServices" @logout="handleLogout" />
    <TabsBar :services="services" @set-tab="setTab" />
    <StatsBar :services="services" />
    <Toolbar @search="(s: string) => search = s" />
    <ServiceTable
      :services="services"
      :tab="tab"
      :search="search"
      :loading="loading"
      @action="handleAction"
      @refresh="loadServices"
    />
    <ToastContainer />
  </main>
</template>
