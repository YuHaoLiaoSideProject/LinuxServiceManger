<script setup lang="ts">
import { computed } from 'vue'
import type { Service, ServiceAction } from '../types/service'
import { useI18n } from '../composables/useI18n'

const { t } = useI18n()
const props = defineProps<{ service: Service }>()
const emit = defineEmits<{ action: [action: ServiceAction, name: string] }>()

const statusClass = computed(() => {
  const a = props.service.active
  if (['active', 'running', 'activating', 'deactivating', 'reloading'].includes(a)) return 'status-active'
  if (['inactive', 'dead'].includes(a)) return 'status-inactive'
  if (a === 'failed') return 'status-failed'
  return 'status-other'
})

const dotClass = computed(() => {
  const a = props.service.active
  if (['active', 'running', 'activating', 'deactivating', 'reloading'].includes(a)) return 'dot-active'
  if (['inactive', 'dead'].includes(a)) return 'dot-inactive'
  if (a === 'failed') return 'dot-failed'
  return 'dot-other'
})

const showStart = computed(() =>
  ['inactive', 'dead', 'failed'].includes(props.service.active) && !props.service.locked
)
const showStop = computed(() =>
  ['active', 'running', 'activating', 'deactivating', 'reloading'].includes(props.service.active) && !props.service.locked
)
const showRestart = computed(() => !props.service.locked)

function doAction(action: ServiceAction) {
  if (action === 'stop' || action === 'restart') {
    // Confirm handled by parent via modal
  }
  emit('action', action, props.service.name)
}
</script>

<template>
  <tr>
    <td data-label="Name">{{ service.name }}</td>
    <td data-label="Load">{{ service.load }}</td>
    <td data-label="Active">
      <span class="status-dot" :class="dotClass"></span>
      <span :class="statusClass">{{ service.active }}</span>
    </td>
    <td data-label="Sub">{{ service.sub }}</td>
    <td data-label="Actions" class="actions">
      <span v-if="service.locked" class="locked-badge" :title="t('locked.tooltip')">{{ t('locked.badge') }}</span>
      <template v-else>
        <button v-if="showStart" class="outline secondary" @click="doAction('start')" :aria-label="t('action.start.aria', { name: service.name })">
          <span class="btn-icon">▶</span><span class="btn-label">{{ t('action.start') }}</span>
        </button>
        <button v-if="showStop" class="outline secondary" @click="doAction('stop')" :aria-label="t('action.stop.aria', { name: service.name })">
          <span class="btn-icon">⏹</span><span class="btn-label">{{ t('action.stop') }}</span>
        </button>
        <button v-if="showRestart" class="outline secondary" @click="doAction('restart')" :aria-label="t('action.restart.aria', { name: service.name })">
          <span class="btn-icon">🔄</span><span class="btn-label">{{ t('action.restart') }}</span>
        </button>
      </template>
    </td>
  </tr>
</template>
