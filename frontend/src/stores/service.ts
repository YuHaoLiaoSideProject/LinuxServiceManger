import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Service } from '../types/service'

export const useServiceStore = defineStore('service', () => {
  const services = ref<Service[]>([])
  const loading = ref(false)

  function setServices(list: Service[]) {
    services.value = list
  }

  function updateService(name: string, updates: Partial<Service>) {
    const idx = services.value.findIndex(s => s.name === name)
    if (idx !== -1) {
      services.value[idx] = { ...services.value[idx], ...updates }
    }
  }

  function addService(service: Service) {
    if (!services.value.find(s => s.name === service.name)) {
      services.value.push(service)
    }
  }

  function removeService(name: string) {
    services.value = services.value.filter(s => s.name !== name)
  }

  function applySnapshot(snapshotServices: Array<{
    name: string; active: string; sub: string; unitFileState: string
  }>) {
    // Merge snapshot: update existing, add new, remove stale
    const snapshotNames = new Set(snapshotServices.map(s => s.name))

    // Remove services not in snapshot
    services.value = services.value.filter(s => snapshotNames.has(s.name))

    for (const snap of snapshotServices) {
      const existing = services.value.find(s => s.name === snap.name)
      if (existing) {
        existing.active = snap.active
        existing.sub = snap.sub
        existing.unitFileState = snap.unitFileState
      } else {
        services.value.push({
          name: snap.name,
          active: snap.active,
          sub: snap.sub,
          unitFileState: snap.unitFileState,
          load: 'loaded',
          locked: false,
          fragmentPath: '',
        })
      }
    }
  }

  return {
    services,
    loading,
    setServices,
    updateService,
    addService,
    removeService,
    applySnapshot,
  }
})
