<script setup lang="ts">
import type { BatchResult } from '../types/service'

defineProps<{
  results: BatchResult[]
}>()

defineEmits<{
  retry: [name: string]
  dismiss: []
}>()
</script>

<template>
  <div class="batch-result-panel">
    <div class="result-header">
      <span class="result-summary">操作結果</span>
      <button class="btn-dismiss" @click="$emit('dismiss')">✕</button>
    </div>
    <div>
      <div v-for="r in results" :key="r.name" class="result-item">
        <span :class="r.result === 'success' ? 'result-ok' : 'result-fail'">
          {{ r.result === 'success' ? '✅' : '❌' }}
        </span>
        <span class="result-name">{{ r.name }}</span>
        <span v-if="r.result === 'success'" class="result-detail">已成功{{ r.action === 'start' ? '啟動' : r.action === 'stop' ? '停止' : '重啟' }}</span>
        <span v-else class="result-error">{{ r.error }}</span>
        <button v-if="r.result === 'failure'" class="btn-retry" @click="$emit('retry', r.name)">重試</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.batch-result-panel {
  margin: 0 0 1rem 0;
  padding: 0.75rem 1rem;
  border: 1px solid var(--color-border, #ddd);
  border-radius: 8px;
  background: var(--color-surface, #fff);
}

.result-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.5rem;
}

.result-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.35rem 0;
  font-size: 0.9rem;
  border-bottom: 1px solid var(--color-border-light, #eee);
}

.result-name { font-family: monospace; min-width: 180px; }
.result-ok   { color: #2e7d32; }
.result-fail { color: #c62828; }
.result-error { color: #c62828; font-size: 0.85rem; flex: 1; }
.btn-retry { font-size: 0.8rem; padding: 0.2rem 0.5rem; cursor: pointer; }
.btn-dismiss { background: none; border: none; cursor: pointer; font-size: 1.1rem; }
</style>
