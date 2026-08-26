<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import type { ManagedNode } from '../types/node'
import { deleteNode, agentBinaryUrl } from '../api/nodeApi'
import { useNodeStore } from '../stores/node'
import { useToast } from '../composables/useToast'
import AppHeader from '../components/AppHeader.vue'
import NodeSummaryBar from '../components/NodeSummaryBar.vue'
import NodeFormModal from '../components/NodeFormModal.vue'
import ConfirmModal from '../components/ConfirmModal.vue'
import ToastContainer from '../components/ToastContainer.vue'

const router = useRouter()
const nodeStore = useNodeStore()
const { showToast } = useToast()

const loading = ref(true)
const searchText = ref('')

// Modal state
const showFormModal = ref(false)
const formMode = ref<'create' | 'edit'>('create')
const editingNode = ref<ManagedNode | undefined>()

// Confirm delete state
const showDeleteConfirm = ref(false)
const deletingNode = ref<ManagedNode | null>(null)

// Download dropdown
const downloadOpen = ref(false)

const filteredNodes = computed(() => {
  const term = searchText.value.toLowerCase()
  if (!term) return nodeStore.nodes
  return nodeStore.nodes.filter(n =>
    n.name.toLowerCase().includes(term) ||
    n.hostname.toLowerCase().includes(term) ||
    n.address.toLowerCase().includes(term)
  )
})

async function loadNodes() {
  loading.value = true
  try {
    await Promise.all([nodeStore.fetchNodes(), nodeStore.fetchSummary()])
  } catch (err) {
    showToast('載入節點失敗', 'error')
  } finally {
    loading.value = false
  }
}

function openCreateModal() {
  formMode.value = 'create'
  editingNode.value = undefined
  showFormModal.value = true
}

function openEditModal(node: ManagedNode) {
  formMode.value = 'edit'
  editingNode.value = node
  showFormModal.value = true
}

function onFormCreated(node: ManagedNode) {
  nodeStore.addNode(node)
  showFormModal.value = false
  nodeStore.fetchSummary()
}

function onFormUpdated(_node: ManagedNode) {
  showFormModal.value = false
  nodeStore.fetchNodes().then(() => nodeStore.fetchSummary())
}

function onNodeSelect(nodeId: string) {
  router.push(`/?node=${nodeId}`)
}

function confirmDelete(node: ManagedNode) {
  deletingNode.value = node
  showDeleteConfirm.value = true
}

async function executeDelete() {
  if (!deletingNode.value) return
  try {
    await deleteNode(deletingNode.value.id)
    nodeStore.removeNode(deletingNode.value.id)
    showToast(`已移除「${deletingNode.value.name}」`, 'success')
    nodeStore.fetchSummary()
  } catch (err: any) {
    showToast(err.response?.data?.error || '移除失敗', 'error')
  } finally {
    showDeleteConfirm.value = false
    deletingNode.value = null
  }
}

function cancelDelete() {
  showDeleteConfirm.value = false
  deletingNode.value = null
}

function statusLabel(status: string): string {
  const map: Record<string, string> = {
    online: '線上',
    warning: '延遲',
    offline: '離線',
    long_offline: '長期離線',
  }
  return map[status] || status
}

function lastHeartbeatText(ts: string | null): string {
  if (!ts) return '—'
  const diff = Date.now() - new Date(ts).getTime()
  const sec = Math.floor(diff / 1000)
  if (sec < 60) return `${sec} 秒前`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min} 分鐘前`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} 小時前`
  const day = Math.floor(hr / 24)
  return `${day} 天前`
}

function toggleDownload() {
  downloadOpen.value = !downloadOpen.value
}

function closeDownload() {
  downloadOpen.value = false
}

onMounted(loadNodes)
</script>

<template>
  <main class="app-container">
    <AppHeader />

    <h2 class="page-title">節點管理</h2>

    <NodeSummaryBar :summary="nodeStore.summary" />

    <!-- Toolbar -->
    <div class="node-toolbar">
      <button class="btn-primary" @click="openCreateModal">＋ 新增節點</button>

      <div class="download-dropdown" @mouseleave="closeDownload">
        <button class="secondary" @click="toggleDownload">下載 Agent ▾</button>
        <div v-if="downloadOpen" class="download-dropdown__menu">
          <a :href="agentBinaryUrl('amd64')" class="download-dropdown__item" @click="closeDownload">Linux amd64</a>
          <a :href="agentBinaryUrl('arm64')" class="download-dropdown__item" @click="closeDownload">Linux arm64</a>
        </div>
      </div>

      <div class="node-search-wrap">
        <input
          v-model="searchText"
          type="search"
          placeholder="搜尋節點名稱、位址..."
          aria-label="搜尋節點"
        />
      </div>
    </div>

    <!-- Empty state -->
    <div v-if="!loading && filteredNodes.length === 0" class="empty-state">
      <div class="empty-icon">🖥️</div>
      <p>{{ nodeStore.nodes.length === 0 ? '尚無已註冊節點' : '找不到符合條件的節點' }}</p>
      <div v-if="nodeStore.nodes.length === 0" class="empty-state__actions">
        <button class="btn-primary" @click="openCreateModal">＋ 新增節點</button>
        <a :href="agentBinaryUrl('amd64')" class="secondary">下載 Agent</a>
      </div>
    </div>

    <!-- Loading -->
    <div v-else-if="loading" class="loading-state">載入中...</div>

    <!-- Nodes table -->
    <div v-else class="node-table-wrap">
      <table class="node-table">
        <thead>
          <tr>
            <th>名稱</th>
            <th>位址</th>
            <th>狀態</th>
            <th>最後心跳</th>
            <th>版本</th>
            <th>備註</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="node in filteredNodes" :key="node.id">
            <td>
              <span
                v-if="node.status === 'online'"
                class="node-link"
                @click="onNodeSelect(node.id)"
              >{{ node.name }}</span>
              <span v-else>{{ node.name }}</span>
            </td>
            <td class="cell-address">{{ node.address }}</td>
            <td>
              <span class="node-dot-inline" :class="`node-dot node-dot--${node.status}`"></span>
              <span class="status-text">{{ statusLabel(node.status) }}</span>
            </td>
            <td>{{ lastHeartbeatText(node.lastHeartbeat) }}</td>
            <td>
              <span v-if="!node.versionCompatible" class="version-warn" title="版本不相容">🟡</span>
              {{ node.version }}
            </td>
            <td class="cell-note">{{ node.note || '—' }}</td>
            <td class="cell-actions">
              <button class="action-btn secondary" @click="openEditModal(node)">編輯</button>
              <button class="action-btn btn-danger" @click="confirmDelete(node)">移除</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Form modal -->
    <NodeFormModal
      v-if="showFormModal"
      :mode="formMode"
      :initialData="editingNode"
      @close="showFormModal = false"
      @created="onFormCreated"
      @updated="onFormUpdated"
    />

    <!-- Delete confirm -->
    <ConfirmModal
      :show="showDeleteConfirm"
      :message="`確定要移除節點「${deletingNode?.name || ''}」嗎？此操作無法復原。`"
      @confirm="executeDelete"
      @cancel="cancelDelete"
    />

    <ToastContainer />
  </main>
</template>

<style scoped>
.page-title {
  margin: 1.25rem 0 1rem;
  font-size: 1.25rem;
}

.node-toolbar {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin: 1rem 0;
  flex-wrap: wrap;
}

.node-search-wrap {
  flex: 1;
  min-width: 200px;
}

.node-search-wrap input {
  width: 100%;
  padding: 0.4rem 0.65rem;
  border: 1px solid var(--lms-border);
  border-radius: var(--lms-radius-sm);
  background: var(--lms-surface);
  font-size: 0.9rem;
}

.download-dropdown {
  position: relative;
}

.download-dropdown__menu {
  position: absolute;
  top: 100%;
  right: 0;
  margin-top: 0.3rem;
  background: var(--lms-surface);
  border: 1px solid var(--lms-border);
  border-radius: var(--lms-radius-sm);
  box-shadow: var(--lms-shadow);
  z-index: 10;
  min-width: 160px;
}

.download-dropdown__item {
  display: block;
  padding: 0.5rem 0.75rem;
  color: var(--lms-text);
  text-decoration: none;
  font-size: 0.85rem;
}

.download-dropdown__item:hover {
  background: var(--lms-surface-2);
}

.empty-state__actions {
  display: flex;
  gap: 0.75rem;
  margin-top: 0.75rem;
}

.loading-state {
  text-align: center;
  padding: 3rem;
  color: var(--lms-muted);
}

.node-table-wrap {
  overflow-x: auto;
}

.node-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.9rem;
}

.node-table th {
  text-align: left;
  padding: 0.6rem 0.75rem;
  border-bottom: 2px solid var(--lms-border);
  font-weight: 600;
  font-size: 0.8rem;
  color: var(--lms-muted);
  white-space: nowrap;
}

.node-table td {
  padding: 0.6rem 0.75rem;
  border-bottom: 1px solid var(--lms-border);
  vertical-align: middle;
}

.node-link {
  color: var(--lms-accent);
  cursor: pointer;
  font-weight: 600;
  text-decoration: none;
}

.node-link:hover {
  text-decoration: underline;
}

.cell-address {
  font-family: monospace;
  font-size: 0.85rem;
}

.cell-note {
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--lms-muted);
}

.version-warn {
  margin-right: 0.25rem;
}

.node-dot-inline {
  display: inline-block;
  vertical-align: middle;
  margin-right: 0.35rem;
}

.status-text {
  font-size: 0.85rem;
}

.cell-actions {
  display: flex;
  gap: 0.4rem;
  white-space: nowrap;
}

.action-btn {
  padding: 0.25rem 0.55rem;
  font-size: 0.8rem;
  border-radius: var(--lms-radius-sm);
  white-space: nowrap;
}

.btn-danger {
  background: var(--lms-danger);
  color: #fff;
  border: none;
}

.btn-danger:hover {
  opacity: 0.85;
}

.btn-primary {
  background: var(--lms-accent);
  color: #fff;
  border: none;
  padding: 0.45rem 1rem;
  border-radius: var(--lms-radius-sm);
  cursor: pointer;
  font-weight: 600;
  font-size: 0.9rem;
}

.btn-primary:hover {
  background: var(--lms-accent-hover);
}
</style>
