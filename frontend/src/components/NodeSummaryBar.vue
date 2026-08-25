<script setup lang="ts">
import type { NodeSummary } from '../types/node'

defineProps<{ summary: NodeSummary | null }>()
</script>

<template>
  <div v-if="summary" class="node-summary-bar" role="group" aria-label="節點統計">
    <div class="node-summary-item">
      <span class="node-summary-value">{{ summary.totalNodes }}</span>
      <span class="node-summary-label">總節點數</span>
      <span class="node-summary-detail">
        線上 {{ summary.online }}・離線 {{ summary.offline }}
      </span>
    </div>
    <div class="node-summary-item">
      <span class="node-summary-value">{{ summary.servicesTotal }}</span>
      <span class="node-summary-label">總服務</span>
      <span class="node-summary-detail">
        執行中 {{ summary.running }}・失敗 {{ summary.failed }}
      </span>
    </div>
  </div>
</template>

<style scoped>
.node-summary-bar {
  display: flex;
  gap: 1rem;
  flex-wrap: wrap;
}

.node-summary-item {
  flex: 1;
  min-width: 180px;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 1rem 1.25rem;
  border: 1px solid var(--lms-border);
  border-radius: var(--lms-radius);
  background: var(--lms-surface);
  text-align: center;
  gap: 0.25rem;
}

.node-summary-value {
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--lms-accent);
}

.node-summary-label {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--lms-muted);
}

.node-summary-detail {
  font-size: 0.8rem;
  color: var(--lms-muted);
}
</style>
