<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useNodesStore } from '../stores/nodes'
import { deleteNode, getNodeInfo, reconnectNode } from '../api/client'
import NodeStatusDot from './NodeStatusDot.vue'
import ConfirmModal from './ConfirmModal.vue'
import { useToast } from '../composables/useToast'
import type { NodeSystemInfo } from '../types/node'

const props = defineProps<{ nodeId: string }>()
const emit = defineEmits<{ close: []; edit: [] }>()

const { showToast } = useToast()
const nodesStore = useNodesStore()
const node = computed(() => nodesStore.byId(props.nodeId))
const info = ref<NodeSystemInfo | null>(null)
const offline = computed(() => node.value?.status === 'offline' || node.value?.status === 'long_offline')
const deleting = ref(false)        // ConfirmModal 顯示與否（沿用 NodeManagementView pattern）
const reconnecting = ref(false)    // 重新連線按鈕 loading spinner

/** 上線時長（uptime_seconds → Xd Xh Xm）／離線持續時間（now - last_heartbeat） */
const uptimeText = computed(() => {
  const sec = info.value?.uptime ?? 0
  if (sec <= 0) return '—'
  const d = Math.floor(sec / 86400)
  const h = Math.floor((sec % 86400) / 3600)
  const m = Math.floor((sec % 3600) / 60)
  return [d ? `${d}d` : '', h ? `${h}h` : '', `${m}m`].filter(Boolean).join(' ') || '0m'
})

const offlineDuration = computed(() => {
  if (!node.value?.last_heartbeat) return '—'
  const diff = Math.max(0, Math.floor((Date.now() - new Date(node.value.last_heartbeat).getTime()) / 1000))
  if (diff < 60) return `${diff} 秒`
  const m = Math.floor(diff / 60)
  if (m < 60) return `${m} 分鐘`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} 小時 ${m % 60} 分`
  return `${Math.floor(h / 24)} 天 ${h % 24} 小時`
})

/** Esc 關閉（右側面板） */
function onDocumentKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') emit('close')
}

onMounted(async () => {
  document.addEventListener('keydown', onDocumentKeydown)
  if (node.value?.status === 'online') {
    try { info.value = await getNodeInfo(props.nodeId) } catch { /* 離線時 info 不可得，顯示最後心跳資訊 */ }
  }
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onDocumentKeydown)
})

/** 重新連線（POST /nodes/{id}/reconnect）：成功 → Toast + 重新拉取 store；失敗 → 錯誤 Toast；按鈕 loading spinner */
async function handleReconnect(): Promise<void> {
  if (reconnecting.value) return
  reconnecting.value = true
  try {
    await reconnectNode(props.nodeId)
    showToast('節點已重新連線', 'success')
    await nodesStore.fetchNodes()
  } catch (e: any) {
    showToast(`無法連線：${e?.response?.data?.error || e.message}`, 'error')
  } finally {
    reconnecting.value = false
  }
}

/** 移除節點：確認 → DELETE + Toast → emit close + 重新拉取 store（面板隨之關閉） */
async function handleConfirmDelete(): Promise<void> {
  try {
    await deleteNode(props.nodeId)
    showToast('節點已移除', 'success')
    deleting.value = false
    emit('close')
    await nodesStore.fetchNodes()
  } catch (e: any) {
    showToast(`移除失敗：${e?.response?.data?.error || e.message}`, 'error')
    deleting.value = false
  }
}
</script>

<template>
  <div class="detail-overlay" @click.self="$emit('close')">
    <aside class="detail-panel" data-testid="node-detail-panel" role="dialog" aria-modal="true" aria-labelledby="node-detail-title">
      <h3 id="node-detail-title">
        <NodeStatusDot v-if="node" :status="node.status" :size="11" />
        <span class="dp-name">{{ node?.name }}</span>
        <button class="close-btn" :aria-label="`關閉 ${node?.name || ''} 詳情`" @click="$emit('close')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12" /></svg>
        </button>
      </h3>
      <dl>
        <dt>Hostname</dt><dd>{{ node?.hostname || '—' }}</dd>
        <dt>Agent 版本</dt><dd>{{ node?.agent_version || '—' }}</dd>
        <dt>OS</dt><dd>{{ info?.os || node?.os || '—' }}</dd>
        <template v-if="node?.status === 'online'">
          <dt>上線時長</dt><dd>{{ uptimeText }}</dd>
          <dt>最後心跳</dt><dd>{{ node?.last_heartbeat || '—' }}</dd>
        </template>
        <template v-else>
          <dt>最後上線</dt><dd>{{ node?.last_heartbeat || '—' }}</dd>
          <dt>最後心跳</dt><dd>{{ node?.last_heartbeat || '—' }}</dd>
          <dt>離線持續時間</dt><dd>{{ offlineDuration }}</dd>
        </template>
      </dl>
      <div v-if="offline" class="dp-suggest">
        操作建議：檢查 Agent 是否執行（systemctl status linux-service-agent）
      </div>
      <p v-if="node?.status === 'warning'" class="dp-warn">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <path d="M12 9v4m0 4h.01" />
        </svg>
        <span>⚠ Agent 版本過舊 ({{ node.agent_version }})，建議升級至 v1.2+</span>
      </p>
      <div class="panel-actions">
        <button class="btn btn-secondary" :disabled="reconnecting" data-testid="reconnect-node" @click="handleReconnect">
          <span v-if="reconnecting" class="spinner-sm" aria-hidden="true"></span> 重新連線
        </button>
        <button v-if="node?.status === 'online'" class="btn btn-secondary" data-testid="edit-node" @click="$emit('edit')">編輯設定</button>
        <button class="btn btn-danger" data-testid="remove-node" @click="deleting = true">移除節點</button>
      </div>

      <ConfirmModal
        v-if="deleting"
        :show="true"
        title="移除節點"
        message="確定要移除此節點？所有歷史資料將保留。"
        confirm-label="確認移除"
        @confirm="handleConfirmDelete"
        @cancel="deleting = false"
      />
    </aside>
  </div>
</template>
