<script setup lang="ts">
import type { NodeSummary } from '../types/node'

defineProps<{ summary: NodeSummary | null }>()
</script>

<template>
  <div v-if="summary" class="nm-stats-bar" role="group" aria-label="節點統計">
    <span class="nm-stat">
      節點 <b>{{ summary.totalNodes }}</b>
      <b class="nm-stat--ok">{{ summary.online }} 線上</b>
      <b class="nm-stat--bad" v-if="summary.offline > 0">{{ summary.offline }} 離線</b>
    </span>
    <span class="nm-stat">
      服務 <b>{{ summary.servicesTotal }}</b>
      <b class="nm-stat--ok">{{ summary.running }} 執行中</b>
      <b class="nm-stat--bad" v-if="summary.failed > 0">{{ summary.failed }} 失敗</b>
    </span>
  </div>
</template>

<style scoped>
.nm-stats-bar {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid var(--lms-border);
  background: var(--lms-surface);
  border-radius: var(--lms-radius) var(--lms-radius) 0 0;
}

.nm-stat {
  display: inline-flex;
  align-items: baseline;
  gap: 0.4rem;
  background: var(--lms-surface-2);
  border: 1px solid var(--lms-border);
  border-radius: var(--lms-radius);
  padding: 0.4rem 0.8rem;
  font-size: 0.78rem;
}

.nm-stat b {
  font-size: 0.95rem;
}

.nm-stat--ok {
  color: var(--lms-success);
}

.nm-stat--bad {
  color: var(--lms-danger);
}
</style>
