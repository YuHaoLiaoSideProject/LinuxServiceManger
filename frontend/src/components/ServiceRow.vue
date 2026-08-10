<script setup lang="ts">
import { computed } from 'vue'
import type { Service, ServiceAction } from '../types/service'
import { useI18n } from '../composables/useI18n'

const { t } = useI18n()
const props = defineProps<{
  service: Service
  togglingService?: string
}>()
const emit = defineEmits<{
  action: [action: ServiceAction, name: string]
  toggle: [action: 'enable' | 'disable', name: string]
  'open-logs': [name: string]
}>()

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

// ── Auto-start toggle ──

const canToggleAutoStart = computed(() => {
  if (props.service.locked) return false
  const state = props.service.unitFileState
  if (['static', 'masked', 'alias', 'unknown'].includes(state)) return false
  if (!props.service.fragmentPath?.startsWith('/etc/systemd/system/')) return false
  return true
})

const toggleOn = computed(() => {
  return ['enabled', 'enabled-runtime'].includes(props.service.unitFileState)
})

const showNotApplicable = computed(() => {
  return ['static', 'masked', 'alias'].includes(props.service.unitFileState)
})

const isLoading = computed(() => props.togglingService === props.service.name)

function doToggle() {
  if (isLoading.value) return
  if (!canToggleAutoStart.value) return
  if (toggleOn.value) {
    emit('toggle', 'disable', props.service.name)
  } else {
    emit('toggle', 'enable', props.service.name)
  }
}
</script>

<template>
  <tr>
    <td :data-label="t('col.name')">{{ service.name }}</td>
    <td :data-label="t('col.load')">{{ t('status.load.' + service.load) }}</td>
    <td :data-label="t('col.active')">
      <span class="status-dot" :class="dotClass"></span>
      <span :class="statusClass">{{ t('status.active.' + service.active) }}</span>
    </td>
    <td :data-label="t('col.sub')">{{ t('status.sub.' + service.sub) }}</td>
    <td :data-label="t('col.autoStart')" class="auto-start-cell">
      <span v-if="showNotApplicable" class="na-badge">{{ t('autoStart.na') }}</span>
      <span v-else-if="!canToggleAutoStart" class="locked-badge" :title="t('locked.tooltip')">🔒</span>
      <button
        v-else
        class="toggle-switch"
        :class="{ 'toggle-on': toggleOn, 'toggle-off': !toggleOn, 'toggle-loading': isLoading }"
        :disabled="isLoading"
        :aria-label="toggleOn ? t('autoStart.disableAria', { name: service.name }) : t('autoStart.enableAria', { name: service.name })"
        @click="doToggle"
      >
        <span class="toggle-track">
          <span class="toggle-thumb"></span>
        </span>
        <span class="toggle-label">{{ isLoading ? '...' : (toggleOn ? t('autoStart.on') : t('autoStart.off')) }}</span>
      </button>
    </td>
    <td :data-label="t('col.actions')" class="actions-cell">
      <div class="actions">
        <!-- Slot 1: Primary action (Start/Stop) or Locked badge -->
        <span class="action-slot">
          <span v-if="service.locked" class="locked-badge" :title="t('locked.tooltip')">{{ t('locked.badge') }}</span>
          <button v-else-if="showStart" class="outline secondary" @click="doAction('start')" :aria-label="t('action.start.aria', { name: service.name })">
            <span class="btn-icon">▶</span><span class="btn-label">{{ t('action.start') }}</span>
          </button>
          <button v-else-if="showStop" class="outline secondary" @click="doAction('stop')" :aria-label="t('action.stop.aria', { name: service.name })">
            <span class="btn-icon">⏹</span><span class="btn-label">{{ t('action.stop') }}</span>
          </button>
        </span>
        <!-- Slot 2: Restart -->
        <span class="action-slot">
          <button v-if="showRestart && !service.locked" class="outline secondary" @click="doAction('restart')" :aria-label="t('action.restart.aria', { name: service.name })">
            <span class="btn-icon">🔄</span><span class="btn-label">{{ t('action.restart') }}</span>
          </button>
        </span>
        <!-- Slot 3: Logs -->
        <span class="action-slot">
          <button class="btn-logs outline secondary" title="查看日誌" @click.stop="$emit('open-logs', service.name)">
            📋 <span class="btn-label">Logs</span>
          </button>
        </span>
      </div>
    </td>
  </tr>
</template>
