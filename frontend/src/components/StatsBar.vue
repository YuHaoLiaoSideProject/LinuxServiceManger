<script setup lang="ts">
import { computed } from 'vue'
import type { Service } from '../types/service'
import { useI18n } from '../composables/useI18n'
import { matchesStatus, type StatusFilter } from '../composables/useServiceFilter'

const { t } = useI18n()
const props = withDefaults(defineProps<{
  services: Service[]
  statusFilter?: StatusFilter
  loading?: boolean
}>(), {
  statusFilter: 'all',
  loading: false,
})

const emit = defineEmits<{ 'set-status-filter': [status: StatusFilter] }>()

const total = computed(() => props.services.length)
const running = computed(() => props.services.filter(s => matchesStatus(s, 'running')).length)
const failed = computed(() => props.services.filter(s => matchesStatus(s, 'failed')).length)
const inactive = computed(() => props.services.filter(s => matchesStatus(s, 'inactive')).length)

// 規格：docs/uiux/014-dashboard-stats-redesign.html（卡片即 filter，計數口徑與 filter 一致）
const cards = computed(() => [
  {
    filter: 'all' as StatusFilter,
    cls: 'stat-total',
    label: t('filter.all'),
    value: total.value,
    icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="8" height="8" rx="2"/><rect x="13" y="3" width="8" height="8" rx="2"/><rect x="3" y="13" width="8" height="8" rx="2"/><rect x="13" y="13" width="8" height="8" rx="2"/></svg>',
  },
  {
    filter: 'running' as StatusFilter,
    cls: 'stat-active',
    label: t('stats.running'),
    value: running.value,
    icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M7 4.5v15l12-7.5z"/></svg>',
  },
  {
    filter: 'failed' as StatusFilter,
    cls: 'stat-failed',
    label: t('stats.failed'),
    value: failed.value,
    icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M12 3L2 20h20L12 3z"/><path d="M12 10v4"/><path d="M12 17.5v.01"/></svg>',
  },
  {
    filter: 'inactive' as StatusFilter,
    cls: 'stat-inactive',
    label: t('filter.inactive'),
    value: inactive.value,
    icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><rect x="6" y="4" width="4" height="16" rx="1.5"/><rect x="14" y="4" width="4" height="16" rx="1.5"/></svg>',
  },
])

function onCardClick(filter: StatusFilter) {
  emit('set-status-filter', filter)
}
</script>

<template>
  <div class="stats-bar" role="group" :aria-label="t('stats.groupAria')">
    <button
      v-for="card in cards"
      :key="card.filter"
      type="button"
      class="stat-card"
      :class="[card.cls, { active: statusFilter === card.filter }]"
      :disabled="loading"
      :aria-pressed="statusFilter === card.filter"
      @click="onCardClick(card.filter)"
    >
      <span class="stat-icon" v-html="card.icon"></span>
      <span>
        <span class="stat-value">{{ card.value }}</span>
        <span class="stat-label">{{ card.label }}</span>
      </span>
    </button>
  </div>
</template>
