<script setup lang="ts">
import { computed } from 'vue'
import type { ManagedNode } from '../types/node'

const props = defineProps<{ node: ManagedNode }>()

const emit = defineEmits<{
  select: [nodeId: string]
  detail: [nodeId: string]
}>()

const statusDotClass = computed(() => `node-dot node-dot--${props.node.status}`)

const lastHeartbeatText = computed(() => {
  if (!props.node.lastHeartbeat) return '—'
  const diff = Date.now() - new Date(props.node.lastHeartbeat).getTime()
  const sec = Math.floor(diff / 1000)
  if (sec < 60) return `${sec} 秒前`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min} 分鐘前`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} 小時前`
  const day = Math.floor(hr / 24)
  return `${day} 天前`
})

const isClickable = computed(() => props.node.status === 'online' || props.node.status === 'warning')

function onCardClick() {
  if (isClickable.value) {
    emit('select', props.node.id)
  } else {
    emit('detail', props.node.id)
  }
}

function onDetailClick(e: Event) {
  e.stopPropagation()
  emit('detail', props.node.id)
}
</script>

<template>
  <div
    class="node-card"
    :class="{ 'node-card--clickable': isClickable }"
    role="button"
    tabindex="0"
    @click="onCardClick"
    @keydown.enter="onCardClick"
  >
    <div class="node-card__header">
      <span :class="statusDotClass" :aria-label="`狀態：${node.status}`"></span>
      <span class="node-card__name">{{ node.name }}</span>
      <span v-if="!node.versionCompatible" class="node-card__version-warn" title="版本不相容">🟡</span>
    </div>
    <div class="node-card__meta">
      <span class="node-card__hostname">{{ node.hostname }}</span>
      <span class="node-card__address">{{ node.address }}</span>
    </div>
    <div class="node-card__stats">
      <span>服務：{{ node.servicesRunning }}/{{ node.servicesTotal }} 執行中</span>
    </div>
    <div class="node-card__footer">
      <span class="node-card__heartbeat">最後心跳：{{ lastHeartbeatText }}</span>
      <button class="node-card__detail-btn secondary" @click="onDetailClick">詳情</button>
    </div>
  </div>
</template>

<style scoped>
.node-card {
  border: 1px solid var(--lms-border);
  border-radius: var(--lms-radius);
  padding: 1rem 1.15rem;
  background: var(--lms-surface);
  transition: box-shadow var(--lms-transition), border-color var(--lms-transition);
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.node-card--clickable {
  cursor: pointer;
}

.node-card--clickable:hover {
  border-color: var(--lms-accent);
  box-shadow: 0 2px 12px rgba(26, 115, 232, 0.12);
}

.node-card__header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.node-card__name {
  font-weight: 600;
  font-size: 1rem;
}

.node-card__version-warn {
  font-size: 0.85rem;
}

.node-card__meta {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  font-size: 0.85rem;
  color: var(--lms-muted);
}

.node-card__stats {
  font-size: 0.9rem;
}

.node-card__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 0.25rem;
}

.node-card__heartbeat {
  font-size: 0.8rem;
  color: var(--lms-muted);
}

.node-card__detail-btn {
  padding: 0.25rem 0.65rem;
  font-size: 0.8rem;
  border-radius: var(--lms-radius-sm);
}
</style>
