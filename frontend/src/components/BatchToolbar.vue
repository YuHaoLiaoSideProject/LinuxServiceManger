<script setup lang="ts">
import type { ServiceAction } from '../types/service'
import { useI18n } from '../composables/useI18n'

const { t } = useI18n()

defineProps<{
  selectedCount: number
  executing: boolean
  progress: { done: number; total: number } | null
}>()

defineEmits<{
  'batch-action': [action: ServiceAction]
  'clear-selection': []
}>()
</script>

<template>
  <div class="batch-toolbar" :class="{ 'batch-executing': executing, 'batch-empty': selectedCount === 0 }">
    <span class="batch-count">
      已選取 <strong>{{ selectedCount }}</strong> 個服務
    </span>

    <template v-if="executing && progress">
      <span class="batch-progress">正在執行... {{ progress.done }}/{{ progress.total }}</span>
    </template>

    <template v-if="!executing">
      <button class="btn btn-start" :disabled="selectedCount === 0" @click="$emit('batch-action', 'start')">
        ▶ {{ t('action.start') }}
      </button>
      <button class="btn btn-stop" :disabled="selectedCount === 0" @click="$emit('batch-action', 'stop')">
        ⏹ {{ t('action.stop') }}
      </button>
      <button class="btn btn-restart" :disabled="selectedCount === 0" @click="$emit('batch-action', 'restart')">
        🔄 {{ t('action.restart') }}
      </button>
    </template>

    <button v-if="!executing" class="btn-clear-link" :class="{ hidden: selectedCount === 0 }" @click="$emit('clear-selection')">
      取消選取
    </button>
  </div>
</template>

<style scoped>
.batch-toolbar {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
  background: var(--color-surface, #fff);
  border-bottom: 2px solid var(--color-primary, #1976d2);
  flex-wrap: wrap;
}

.batch-toolbar.batch-empty {
  border-bottom-color: var(--color-border, #ccc);
  opacity: 0.7;
}

.batch-toolbar.batch-executing {
  background: var(--color-surface-alt, #f3f5f7);
  border-bottom-color: var(--color-warning, #f9a825);
}

@keyframes batch-slide-down {
  from { opacity: 0; transform: translateY(-12px); }
  to   { opacity: 1; transform: translateY(0); }
}

.batch-count {
  font-size: 0.9rem;
  color: var(--color-text-secondary, #555);
}

.batch-count strong {
  color: var(--color-primary, #1976d2);
  font-size: 1.1rem;
}

.batch-progress {
  font-size: 0.9rem;
  color: var(--color-warning, #f9a825);
  font-weight: 600;
  animation: pulse 1.5s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.6; }
}

.batch-toolbar .btn {
  padding: 0.4rem 0.8rem;
  border-radius: 6px;
  border: 1px solid var(--color-border, #ccc);
  cursor: pointer;
  font-size: 0.85rem;
  transition: background 0.15s, opacity 0.15s;
}

.batch-toolbar .btn:hover { opacity: 0.85; }

.btn-start  { background: #e8f5e9; color: #2e7d32; border-color: #a5d6a7; }
.btn-stop   { background: #fff0f0; color: #c62828; border-color: #ef9a9a; }
.btn-restart { background: #e3f2fd; color: #1565c0; border-color: #90caf9; }

.btn-clear-link {
  background: none;
  border: none;
  color: var(--color-text-muted, #888);
  cursor: pointer;
  font-size: 0.85rem;
  text-decoration: underline;
  margin-left: auto;
}

.btn-clear-link.hidden {
  visibility: hidden;
}

.batch-toolbar .btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

@media (max-width: 767px) {
  .batch-toolbar {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.5rem;
    padding: 0.6rem;
  }
  .batch-toolbar .btn {
    width: 100%;
    text-align: center;
  }
}
</style>
