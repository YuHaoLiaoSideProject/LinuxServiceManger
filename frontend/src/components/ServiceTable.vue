<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Service, ServiceAction } from '../types/service'
import { useI18n } from '../composables/useI18n'
import ServiceRow from './ServiceRow.vue'
import BatchToolbar from './BatchToolbar.vue'
import ConfirmModal from './ConfirmModal.vue'
import EmptyState from './EmptyState.vue'

const { t } = useI18n()
const props = defineProps<{
  filteredServices: Service[]
  tab: string
  loading: boolean
  togglingService?: string
  selectedNames?: Set<string>
  batchExecuting?: boolean
  batchProgress?: { done: number; total: number } | null
}>()
const emit = defineEmits<{
  action: [action: ServiceAction, name: string]
  refresh: []
  toggle: [action: 'enable' | 'disable', name: string]
  'open-logs': [name: string]
  'clear-filters': []
  'toggle-select': [name: string]
  'select-all': [filteredNames: string[]]
  'batch-action': [action: ServiceAction]
  'clear-selection': []
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

// Apply tab filter + sorting on the pre-filtered list from upstream
const displayServices = computed(() => {
  let list = props.filteredServices.filter(s => {
    return props.tab === 'my' ? !s.locked : s.locked
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

// ── Batch selection computed ──
const selectedNamesSet = computed(() => props.selectedNames || new Set<string>())

const selectedCount = computed(() => selectedNamesSet.value.size)

const allSelected = computed(() => {
  const selectable = displayServices.value.filter(s => !s.locked)
  return selectable.length > 0 && selectable.every(s => selectedNamesSet.value.has(s.name))
})

const selectableCount = computed(() =>
  displayServices.value.filter(s => !s.locked).length
)

function onSelectAll() {
  if (allSelected.value) {
    emit('select-all', [])
  } else {
    emit('select-all', displayServices.value.filter(s => !s.locked).map(s => s.name))
  }
}
</script>

<template>
  <BatchToolbar
    :selectedCount="selectedCount"
    :executing="batchExecuting || false"
    :progress="batchProgress || null"
    @batch-action="(action) => emit('batch-action', action)"
    @clear-selection="emit('clear-selection')"
  />
  <div class="table-wrapper">
    <table class="service-table">
      <caption>
        <span>{{ t('caption.title') }}</span>
        <span class="caption-sub">{{ t('caption.sub') }}</span>
      </caption>
      <thead>
        <tr>
          <th class="col-check">
            <input
              type="checkbox"
              name="select-all"
              :checked="allSelected"
              :disabled="selectableCount === 0 || batchExecuting"
              @change="onSelectAll"
            />
          </th>
          <th class="sortable" @click="toggleSort('name')">
            {{ t('col.name') }} <span class="sort-icon" :class="{ active: sortCol === 'name' }">{{ sortCol === 'name' ? (sortAsc ? '▲' : '▼') : '' }}</span>
          </th>
          <th class="sortable" @click="toggleSort('load')">
            {{ t('col.load') }} <span class="sort-icon" :class="{ active: sortCol === 'load' }">{{ sortCol === 'load' ? (sortAsc ? '▲' : '▼') : '' }}</span>
          </th>
          <th class="sortable" @click="toggleSort('active')">
            {{ t('col.active') }} <span class="sort-icon" :class="{ active: sortCol === 'active' }">{{ sortCol === 'active' ? (sortAsc ? '▲' : '▼') : '' }}</span>
          </th>
          <th class="sortable" @click="toggleSort('sub')">
            {{ t('col.sub') }} <span class="sort-icon" :class="{ active: sortCol === 'sub' }">{{ sortCol === 'sub' ? (sortAsc ? '▲' : '▼') : '' }}</span>
          </th>
          <th>{{ t('col.autoStart') }}</th>
          <th>{{ t('col.actions') }}</th>
        </tr>
      </thead>
      <tbody id="service-table-body">
        <template v-if="loading">
          <tr class="row-feedback"><td colspan="7"><div class="empty-state"><div class="spinner-sm"></div></div></td></tr>
        </template>
        <template v-else-if="displayServices.length === 0">
          <tr class="row-feedback">
            <td colspan="7">
              <EmptyState @clear="$emit('clear-filters')" />
            </td>
          </tr>
        </template>
        <template v-else>
          <ServiceRow
            v-for="svc in displayServices"
            :key="svc.name"
            :service="svc"
            :togglingService="togglingService"
            :selected="selectedNamesSet.has(svc.name)"
            :batchExecuting="batchExecuting"
            @action="onAction"
            @toggle="(action, name) => emit('toggle', action, name)"
            @open-logs="(name) => emit('open-logs', name)"
            @toggle-select="(name) => emit('toggle-select', name)"
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
