<script setup lang="ts">
import { computed } from 'vue'
import type { Service } from '../types/service'
import { useI18n } from '../composables/useI18n'

const { t } = useI18n()
const props = defineProps<{ services: Service[] }>()

const total = computed(() => props.services.length)
const running = computed(() => props.services.filter(s =>
  ['active', 'running', 'activating', 'deactivating', 'reloading'].includes(s.active)
).length)
const failed = computed(() => props.services.filter(s => s.active === 'failed').length)
</script>

<template>
  <div class="stats-bar">
    <div class="stat-card stat-total">
      <span class="stat-icon">📋</span>
      <div>
        <div class="stat-value">{{ total }}</div>
        <div class="stat-label">{{ t('stats.total') }}</div>
      </div>
    </div>
    <div class="stat-card stat-active">
      <span class="stat-icon">✅</span>
      <div>
        <div class="stat-value">{{ running }}</div>
        <div class="stat-label">{{ t('stats.running') }}</div>
      </div>
    </div>
    <div class="stat-card stat-failed">
      <span class="stat-icon">❌</span>
      <div>
        <div class="stat-value">{{ failed }}</div>
        <div class="stat-label">{{ t('stats.failed') }}</div>
      </div>
    </div>
  </div>
</template>
