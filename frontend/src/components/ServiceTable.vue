<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Service, ServiceAction } from '../types/service'
import { useI18n } from '../composables/useI18n'
import ServiceRow from './ServiceRow.vue'
import ConfirmModal from './ConfirmModal.vue'

const { t } = useI18n()
const props = defineProps<{
  services: Service[]
  tab: string
  search: string
  loading: boolean
  togglingService?: string
}>()
const emit = defineEmits<{
  action: [action: ServiceAction, name: string]
  refresh: []
  toggle: [action: 'enable' | 'disable', name: string]
}>()

// Sort
const sortCol = ref<string | null>(null)
const sortAsc = ref(true)

function toggleSort(col: string) {
  if (sortCol.value === col) {
    sortAsc.value = !sortAsc.value
  } else {
    sortCol.value = col
    sortAsc.value = true
  }
}

// Filtered and sorted services
const filtered = computed(() => {
  let list = props.services.filter(s => {
    const tabMatch = props.tab === 'my' ? !s.locked : s.locked
    const searchMatch = !props.search || s.name.toLowerCase().includes(props.search.toLowerCase())
    return tabMatch && searchMatch
  })

  if (sortCol.value) {
    const col = sortCol.value
    const asc = sortAsc.value
    list = [...list].sort((a: any, b: any) => {
      const va = (a[col] || '').toLowerCase()
      const vb = (b[col] || '').toLowerCase()
      const na = parseFloat(va), nb = parseFloat(vb)
      if (!isNaN(na) && !isNaN(nb)) return asc ? na - nb : nb - na
      if (va < vb) return asc ? -1 : 1
      if (va > vb) return asc ? 1 : -1
      return 0
    })
  }

  return list
})

// Confirm modal
const showConfirm = ref(false)
const pendingAction = ref<{ action: ServiceAction; name: string } | null>(null)

function onAction(action: ServiceAction, name: string) {
  if (action === 'stop' || action === 'restart') {
    pendingAction.value = { action, name }
    showConfirm.value = true
  } else {
    emit('action', action, name)
  }
}

function confirmAction() {
  if (pendingAction.value) {
    emit('action', pendingAction.value.action, pendingAction.value.name)
  }
  showConfirm.value = false
  pendingAction.value = null
}

function cancelAction() {
  showConfirm.value = false
  pendingAction.value = null
}

const confirmMessage = computed(() => {
  if (!pendingAction.value) return ''
  const key = pendingAction.value.action === 'stop' ? 'modal.stop' : 'modal.restart'
  return t(key, { name: pendingAction.value.name })
})
</script>

<template>
  <div class="table-wrapper">
    <table>
      <caption>
        <span>{{ t('caption.title') }}</span>
        <span class="caption-sub">{{ t('caption.sub') }}</span>
      </caption>
      <thead>
        <tr>
          <th class="sortable" @click="toggleSort('name')">
            Name <span class="sort-icon" :class="{ active: sortCol === 'name' }">{{ sortCol === 'name' ? (sortAsc ? '▲' : '▼') : '' }}</span>
          </th>
          <th class="sortable" @click="toggleSort('load')">
            Load <span class="sort-icon" :class="{ active: sortCol === 'load' }">{{ sortCol === 'load' ? (sortAsc ? '▲' : '▼') : '' }}</span>
          </th>
          <th class="sortable" @click="toggleSort('active')">
            Active <span class="sort-icon" :class="{ active: sortCol === 'active' }">{{ sortCol === 'active' ? (sortAsc ? '▲' : '▼') : '' }}</span>
          </th>
          <th class="sortable" @click="toggleSort('sub')">
            Sub <span class="sort-icon" :class="{ active: sortCol === 'sub' }">{{ sortCol === 'sub' ? (sortAsc ? '▲' : '▼') : '' }}</span>
          </th>
          <th>Auto-start</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody id="service-table-body">
        <template v-if="loading">
          <tr><td colspan="6"><div class="empty-state"><div class="spinner-sm"></div></div></td></tr>
        </template>
        <template v-else-if="filtered.length === 0">
          <tr>
            <td colspan="6">
              <div class="empty-state">
                <div class="empty-icon">{{ search ? '🔍' : '📭' }}</div>
                <em>{{ search ? t('search.empty', { term: search }) : t('empty.state') }}</em>
              </div>
            </td>
          </tr>
        </template>
        <template v-else>
          <ServiceRow
            v-for="svc in filtered"
            :key="svc.name"
            :service="svc"
            :togglingService="togglingService"
            @action="onAction"
            @toggle="(action, name) => emit('toggle', action, name)"
          />
        </template>
      </tbody>
    </table>
  </div>

  <ConfirmModal
    :show="showConfirm"
    :message="confirmMessage"
    @confirm="confirmAction"
    @cancel="cancelAction"
  />
</template>
