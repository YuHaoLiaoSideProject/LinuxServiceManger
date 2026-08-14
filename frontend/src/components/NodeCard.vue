<script setup lang="ts">
import { computed } from 'vue'
import type { Node } from '../types/node'
import NodeStatusDot from './NodeStatusDot.vue'

const props = defineProps<{ node: Node }>()
const emit = defineEmits<{ click: [id: string, status: string]; detail: [id: string] }>()

/** 可操作狀態（線上/延遲/警告）→ cursor:pointer + hover 提升；離線維持預設 cursor（UIUX §5.1） */
const clickable = computed(() => ['online', 'degraded', 'warning'].includes(props.node.status))

/** 最後心跳相對時間（「最後心跳：X 秒前」；無心跳 → 「從未收到心跳」） */
const lastHeartbeatText = computed(() => {
  if (!props.node.last_heartbeat) return '從未收到心跳'
  const sec = Math.max(0, Math.floor((Date.now() - new Date(props.node.last_heartbeat).getTime()) / 1000))
  return `最後心跳：${sec} 秒前`
})

const offline = computed(() => props.node.status === 'offline' || props.node.status === 'long_offline')

function onCardKeydown(e: KeyboardEvent): void {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    emit('click', props.node.id, props.node.status)
  }
}
</script>

<template>
  <div
    class="node-card"
    :class="{
      'node-offline': offline,
      'node-long-offline': node.status === 'long_offline',
      clickable,
    }"
    data-testid="node-card"
    role="button"
    tabindex="0"
    :aria-label="`節點 ${node.name}`"
    @click="emit('click', node.id, node.status)"
    @keydown="onCardKeydown"
  >
    <div class="node-card-head">
      <NodeStatusDot :status="node.status" show-label />
      <h3 class="node-name">{{ node.name }}</h3>
      <button
        class="icon-btn nc-detail"
        data-testid="node-detail"
        :aria-label="`詳情 ${node.name}`"
        :title="`詳情 ${node.name}`"
        @click.stop="emit('detail', node.id)"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
          <circle cx="12" cy="12" r="10" />
          <path d="M12 16v-4m0-4h.01" />
        </svg>
      </button>
    </div>
    <p class="node-hostname">{{ node.hostname || node.address }}</p>
    <!-- 離線：服務統計灰顯（BDD @offline） -->
    <div class="node-stats" :class="{ dimmed: offline }">
      <b>{{ node.service_stats.active }}</b>/{{ node.service_stats.total }} 執行中
    </div>
    <p v-if="node.status === 'warning'" class="nc-version" title="Agent 版本過舊，建議升級">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <path d="M12 9v4m0 4h.01" />
      </svg>
      Agent 版本過舊 ({{ node.agent_version }})，建議升級至 v1.2+
    </p>
    <p class="node-heartbeat">{{ lastHeartbeatText }}</p>
  </div>
</template>
