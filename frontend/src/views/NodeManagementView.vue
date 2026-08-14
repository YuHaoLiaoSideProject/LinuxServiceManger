<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useNodesStore } from '../stores/nodes'
import { deleteNode, downloadAgent } from '../api/client'
import NodeFormModal from '../components/NodeFormModal.vue'
import ConfirmModal from '../components/ConfirmModal.vue'
import EmptyState from '../components/EmptyState.vue'
import NodeStatusDot from '../components/NodeStatusDot.vue'
import ToastContainer from '../components/ToastContainer.vue'
import { statusLabel } from '../utils/nodeStatus'
import { useToast } from '../composables/useToast'
import { useI18n } from '../composables/useI18n'
import type { Node } from '../types/node'

const nodesStore = useNodesStore()
const { showToast } = useToast()
const { t } = useI18n()

const formOpen = ref(false)
const editing = ref<Node | null>(null)
const deleting = ref<Node | null>(null)
const archMenuOpen = ref(false)

onMounted(() => { nodesStore.fetchNodes() })

function openCreate(): void { editing.value = null; formOpen.value = true }
function openEdit(n: Node): void { editing.value = n; formOpen.value = true }

async function handleDeleted(): Promise<void> {
  if (!deleting.value) return
  await deleteNode(deleting.value.id)          // 移除後該節點自列表與 Aggregate 消失（BDD @happy-path）
  showToast('節點已移除', 'success')
  deleting.value = null
  await nodesStore.fetchNodes()
}

async function handleDownload(arch: 'amd64' | 'arm64'): Promise<void> {
  const blob = await downloadAgent(arch)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = `agent-linux-${arch}`
  a.click(); URL.revokeObjectURL(url)
  archMenuOpen.value = false
}

/** 最後心跳 toLocaleString；無 → 「—」 */
function heartbeatText(hb?: string): string {
  return hb ? new Date(hb).toLocaleString() : '—'
}
</script>

<template>
  <div class="node-management">
    <div class="page-header">
      <h2>
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
        {{ t('nav.nodes') }}
      </h2>
      <div class="header-actions">
        <div class="arch-menu">
          <button class="btn btn-secondary" :aria-expanded="archMenuOpen" aria-haspopup="menu" @click="archMenuOpen = !archMenuOpen">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
            下載 Agent
            <svg class="chevron" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>
          </button>
          <div v-if="archMenuOpen" class="arch-dropdown" role="menu">
            <button role="menuitem" @click="handleDownload('amd64')">agent-linux-amd64</button>
            <button role="menuitem" @click="handleDownload('arm64')">agent-linux-arm64</button>
          </div>
        </div>
        <button class="btn btn-primary" data-testid="add-node" @click="openCreate">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
          {{ t('nodes.addNode') }}
        </button>
      </div>
    </div>

    <EmptyState v-if="!nodesStore.loading && nodesStore.nodes.length === 0" message="尚無已註冊節點" :show-button="false">
      <button class="btn btn-primary" @click="openCreate">{{ t('nodes.addNode') }}</button>
    </EmptyState>

    <div v-else class="table-scroll">
      <table class="node-table">
        <thead><tr>
          <th>{{ t('nodes.colName') }}</th><th>{{ t('nodes.colAddress') }}</th>
          <th>{{ t('nodes.colStatus') }}</th><th>{{ t('nodes.colHeartbeat') }}</th>
          <th>{{ t('nodes.colVersion') }}</th><th>{{ t('nodes.colActions') }}</th>
        </tr></thead>
        <tbody>
          <tr v-for="n in nodesStore.nodes" :key="n.id" data-testid="node-row">
            <td class="cell-name">{{ n.name }}</td>
            <td class="cell-addr node-address">{{ n.address }}</td>
            <td>
              <span class="node-status-badge" :class="`badge-${n.status}`">
                <NodeStatusDot :status="n.status" :size="9" />
                <span class="status-text">{{ statusLabel(n.status) }}</span>
              </span>
            </td>
            <td class="cell-hb">{{ heartbeatText(n.last_heartbeat) }}</td>
            <td class="cell-ver">{{ n.agent_version || '—' }}</td>
            <td>
              <div class="row-actions">
                <button class="btn btn-sm" :aria-label="`編輯 ${n.name}`" @click="openEdit(n)">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/></svg>
                  編輯
                </button>
                <button class="btn btn-sm btn-danger" data-testid="remove-node" :aria-label="`移除 ${n.name}`" @click="deleting = n">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>
                  移除
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <NodeFormModal v-if="formOpen" :node="editing" @close="formOpen = false" @saved="formOpen = false; nodesStore.fetchNodes()" />

    <ConfirmModal
      v-if="deleting"
      :show="true"
      :title="t('nodes.deleteTitle')"
      message="確定要移除此節點？所有歷史資料將保留。"
      confirm-label="確認移除"
      @confirm="handleDeleted"
      @cancel="deleting = null"
    />

    <!-- Toast（註冊/編輯/移除等全域通知；UIUX 014 決策 7） -->
    <ToastContainer />
  </div>
</template>
