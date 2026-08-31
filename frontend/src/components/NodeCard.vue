<script setup lang="ts">
import { computed } from 'vue'
import type { ManagedNode } from '../types/node'

const props = defineProps<{ node: ManagedNode }>()

const emit = defineEmits<{
  select: [nodeId: string]
}>()

const statusDotClass = computed(() => `nm-dot nm-dot--${props.node.status}`)

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

const isOffline = computed(() => props.node.status === 'offline' || props.node.status === 'long_offline')

function onCardClick() {
  if (isClickable.value) {
    emit('select', props.node.id)
  }
}
</script>

<template>
  <button
    class="nm-ncard"
    :class="{ 'nm-ncard--clickable': isClickable, 'nm-ncard--offline': isOffline }"
    :aria-label="`開啟 ${node.name}`"
    :tabindex="0"
    @click="onCardClick"
    @keydown.enter="onCardClick"
  >
    <div class="nm-ncard__header">
      <span :class="statusDotClass"></span>
      <span class="nm-ncard__name">{{ node.name }}</span>
      <span v-if="!node.versionCompatible" class="nm-ncard__version-warn" title="版本不相容">🟡</span>
    </div>
    <div class="nm-ncard__hostname">{{ node.hostname }}</div>
    <div class="nm-ncard__stats">
      <b>{{ node.servicesRunning }} / {{ node.servicesTotal }}</b> 執行中
    </div>
    <div v-if="node.cpuPercent != null || node.memoryPercent != null" class="nm-ncard__resources">
      <span v-if="node.cpuPercent != null" class="nm-ncard__cpu">CPU <b>{{ node.cpuPercent }}%</b></span>
      <span v-if="node.memoryPercent != null" class="nm-ncard__mem">MEM <b>{{ node.memoryPercent }}%</b></span>
    </div>
    <div class="nm-ncard__footer">
      <span class="nm-ncard__heartbeat">最後心跳：{{ lastHeartbeatText }}</span>
      <span v-if="isOffline" class="nm-ncard__offline-hint">點擊查看離線詳情</span>
    </div>
  </button>
</template>

<style scoped>
.nm-ncard {
  position: relative;
  background: var(--lms-surface);
  border: 1px solid var(--lms-border);
  border-radius: var(--lms-radius);
  padding: 0.85rem 0.95rem;
  cursor: pointer;
  transition: all var(--lms-transition);
  text-align: left;
  font: inherit;
  color: inherit;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  width: 100%;
}

.nm-ncard--clickable {
  cursor: pointer;
}

.nm-ncard:hover {
  border-color: var(--lms-accent);
  box-shadow: 0 2px 12px rgba(26, 115, 232, 0.12);
  transform: translateY(-1px);
}

.nm-ncard--offline {
  opacity: 0.62;
  cursor: help;
}

.nm-ncard__header {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.nm-ncard__name {
  font-weight: 700;
  font-size: 0.88rem;
}

.nm-ncard__version-warn {
  font-size: 0.85rem;
}

.nm-ncard__hostname {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.72rem;
  color: var(--lms-muted);
  margin-bottom: 0.25rem;
}

.nm-ncard__stats {
  font-size: 0.78rem;
  color: var(--lms-muted);
}

.nm-ncard__stats b {
  color: var(--lms-text);
}

.nm-ncard__resources {
  font-size: 0.7rem;
  display: inline-flex;
  gap: 0.7rem;
  margin-top: 0.3rem;
}

.nm-ncard__resources b {
  font-size: 0.78rem;
}

.nm-ncard__cpu b {
  color: var(--lms-accent);
}

.nm-ncard__mem b {
  color: var(--lms-warning);
}

.nm-ncard__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 0.35rem;
}

.nm-ncard__heartbeat {
  font-size: 0.7rem;
  color: var(--lms-muted);
}

.nm-ncard__offline-hint {
  font-size: 0.7rem;
  color: var(--lms-muted);
  font-style: italic;
}

/* ── Status dot ── */
.nm-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  display: inline-block;
  flex: none;
}
.nm-dot--online { background: var(--lms-success); }
.nm-dot--warning { background: var(--lms-warning); }
.nm-dot--offline { background: var(--lms-danger); }
.nm-dot--long_offline { background: #6b7280; }

/* ── Focus ring ── */
.nm-ncard:focus-visible {
  outline: 2px solid var(--lms-accent);
  outline-offset: 2px;
}
</style>
