<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import type { ManagedNode } from '../types/node'
import { deleteNode, agentBinaryUrl } from '../api/nodeApi'
import { useNodeStore } from '../stores/node'
import { useToast } from '../composables/useToast'
import { useI18n } from '../composables/useI18n'
import AppHeader from '../components/AppHeader.vue'
import NodeSummaryBar from '../components/NodeSummaryBar.vue'
import NodeFormModal from '../components/NodeFormModal.vue'
import ToastContainer from '../components/ToastContainer.vue'

const router = useRouter()
const nodeStore = useNodeStore()
const { showToast } = useToast()
const { t } = useI18n()

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
    showToast(t('nodes.loadError'), 'error')
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
    showToast(t('nodes.removed', { name: deletingNode.value.name }), 'success')
    nodeStore.fetchSummary()
  } catch (err: any) {
    showToast(err.response?.data?.error || t('nodes.removeError'), 'error')
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
  const key = `status.${status}`
  const translated = t(key)
  return translated === key ? status : translated
}

function statusEmoji(status: string): string {
  const map: Record<string, string> = {
    online: '🟢',
    warning: '🟡',
    offline: '🔴',
    long_offline: '⚫',
  }
  return map[status] || ''
}

function lastHeartbeatText(ts: string | null): string {
  if (!ts) return '—'
  const diff = Date.now() - new Date(ts).getTime()
  const sec = Math.floor(diff / 1000)
  if (sec < 60) return t('time.secondsAgo', { sec: String(sec) })
  const min = Math.floor(sec / 60)
  if (min < 60) return t('time.minutesAgo', { min: String(min) })
  const hr = Math.floor(min / 60)
  if (hr < 24) return t('time.hoursAgo', { hr: String(hr) })
  const day = Math.floor(hr / 24)
  return t('time.daysAgo', { day: String(day) })
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

    <NodeSummaryBar :summary="nodeStore.summary" />

    <!-- Toolbar -->
    <div class="nm-toolbar">
      <button class="nm-btn nm-btn--primary" @click="openCreateModal">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        {{ t('nodes.addNode') }}
      </button>

      <div class="nm-dropdown" @mouseleave="closeDownload">
        <button class="nm-btn nm-btn--secondary" @click="toggleDownload">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          {{ t('nodes.downloadAgent') || '下載 Agent' }}
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
        <div v-if="downloadOpen" class="nm-dropdown__menu">
          <a :href="agentBinaryUrl('amd64')" class="nm-dropdown__item" @click="closeDownload">linux-agent-amd64</a>
          <a :href="agentBinaryUrl('arm64')" class="nm-dropdown__item" @click="closeDownload">linux-agent-arm64</a>
        </div>
      </div>

      <span class="nm-toolbar__spacer"></span>

      <span class="nm-search" :class="{ 'has-value': searchText }">
        <svg class="nm-search__icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
        <input
          v-model="searchText"
          type="search"
          :placeholder="t('nodes.searchNodePlaceholder')"
          :aria-label="t('nodes.searchLabel')"
        />
        <button v-if="searchText" class="nm-search__clear" @click="searchText = ''" :aria-label="t('nodes.clearSearch')">✕</button>
      </span>
    </div>

    <!-- Empty state -->
    <div v-if="!loading && filteredNodes.length === 0" class="nm-empty">
      <div class="nm-empty__icon">📦</div>
      <div class="nm-empty__title">{{ nodeStore.nodes.length === 0 ? t('nodes.noNodes') : t('nodes.noMatch') }}</div>
      <div v-if="nodeStore.nodes.length === 0" class="nm-empty__desc">{{ t('nodes.emptyDesc') }}</div>
      <div v-if="nodeStore.nodes.length === 0" class="nm-empty__actions">
        <a :href="agentBinaryUrl('amd64')" class="nm-btn nm-btn--secondary">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          {{ t('nodes.downloadAgent') || '下載 Agent' }}
        </a>
        <button class="nm-btn nm-btn--primary" @click="openCreateModal">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          {{ t('nodes.addNode') }}
        </button>
      </div>
    </div>

    <!-- Loading -->
    <div v-else-if="loading" class="nm-loading">{{ t('nodes.loading') }}</div>

    <!-- Desktop: Nodes table -->
    <div v-else class="nm-table-wrap">
      <table class="nm-table" :aria-label="t('nodes.tableLabel')">
        <thead>
          <tr>
            <th scope="col">{{ t('nodes.colName') }}</th>
            <th scope="col">{{ t('nodes.colAddress') }}</th>
            <th scope="col">{{ t('nodes.colStatus') }}</th>
            <th scope="col">{{ t('nodes.colHeartbeat') }}</th>
            <th scope="col">{{ t('nodes.colVersion') }}</th>
            <th scope="col">{{ t('nodes.colNotes') }}</th>
            <th scope="col" style="text-align:right">{{ t('nodes.colActions') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="node in filteredNodes"
            :key="node.id"
            :class="{ 'row-offline': node.status === 'offline' || node.status === 'long_offline' }"
          >
            <td>
              <span class="nm-node-name">
                <span class="nm-dot" :class="`nm-dot--${node.status}`"></span>
                <a
                  v-if="node.status === 'online' || node.status === 'warning'"
                  class="nm-node-link"
                  @click="onNodeSelect(node.id)"
                  :title="node.status === 'warning' ? t('nodes.warningTooltip') : ''"
                >{{ node.name }}</a>
                <span v-else class="nm-node-name__text" :title="node.status === 'offline' ? t('nodes.offlineTooltip') : t('nodes.longOfflineTooltip')">{{ node.name }}</span>
              </span>
            </td>
            <td class="nm-cell-addr">{{ node.address }}</td>
            <td>
              <span class="nm-badge" :class="`nm-badge--${node.status}`">
                {{ statusEmoji(node.status) }} {{ statusLabel(node.status) }}
              </span>
            </td>
            <td class="nm-cell-hb">{{ lastHeartbeatText(node.lastHeartbeat) }}</td>
            <td class="nm-cell-ver">
              <span v-if="node.version">{{ node.version }}</span>
              <span v-else>—</span>
            </td>
            <td class="nm-cell-notes">{{ node.note || '—' }}</td>
            <td>
              <span class="nm-row-actions">
                <button class="nm-btn-icon" @click="openEditModal(node)" :title="t('nodes.edit')">✏️</button>
                <button class="nm-btn-icon nm-btn-icon--danger" @click="confirmDelete(node)" :title="t('nodes.remove')">🗑️</button>
              </span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Mobile: Card list -->
    <div v-if="!loading && filteredNodes.length > 0" class="nm-card-list">
      <div
        v-for="node in filteredNodes"
        :key="node.id + '-card'"
        class="nm-card-item"
        :class="{ 'row-offline': node.status === 'offline' || node.status === 'long_offline' }"
      >
        <div class="nm-card-top">
          <span class="nm-dot" :class="`nm-dot--${node.status}`"></span>
          <span class="nm-card-name">{{ node.name }}</span>
          <span class="nm-badge" :class="`nm-badge--${node.status}`" style="margin-left:auto">
            {{ statusEmoji(node.status) }} {{ statusLabel(node.status) }}
          </span>
        </div>
        <div class="nm-card-addr">{{ node.address }}</div>
        <div class="nm-card-meta">
          <span>{{ node.version || '—' }}</span>
          <span>·</span>
          <span>{{ t('nodes.heartbeat', { time: lastHeartbeatText(node.lastHeartbeat) }) }}</span>
        </div>
        <div v-if="node.note" class="nm-card-notes">{{ node.note }}</div>
        <div class="nm-card-actions">
          <button class="nm-btn-icon" @click="openEditModal(node)">✏️ {{ t('nodes.edit') }}</button>
          <button class="nm-btn-icon nm-btn-icon--danger" @click="confirmDelete(node)">🗑️ {{ t('nodes.remove') }}</button>
        </div>
      </div>
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
    <Teleport to="body">
      <div v-if="showDeleteConfirm" class="nm-modal-overlay" @click.self="cancelDelete">
        <div class="nm-modal" style="max-width:400px" role="alertdialog" aria-modal="true" :aria-label="t('nodes.deleteTitle')">
          <div class="nm-modal__head">
            <h3>{{ t('nodes.deleteTitle') }}</h3>
            <button class="nm-modal__close" @click="cancelDelete" :aria-label="t('nodes.close')">&times;</button>
          </div>
          <div class="nm-modal__body">
            <div style="display:flex;align-items:flex-start;gap:0.6rem">
              <span style="font-size:1.5rem;line-height:1">⚠️</span>
              <div>
                <div style="font-weight:700;margin-bottom:0.3rem">{{ t('nodes.deleteConfirm') }}</div>
                <small style="color:var(--lms-muted);line-height:1.6">{{ t('nodes.deleteDesc') }}</small>
              </div>
            </div>
          </div>
          <div class="nm-modal__foot">
            <button class="nm-btn nm-btn--ghost" @click="cancelDelete">{{ t('nodes.cancel') }}</button>
            <button class="nm-btn nm-btn--danger" @click="executeDelete">{{ t('nodes.deleteConfirmBtn') }}</button>
          </div>
        </div>
      </div>
    </Teleport>

    <ToastContainer />
  </main>
</template>

<style scoped>
/* ═══════════ Node Management Styles ═══════════
   Design spec: docs/uiux/014-node-management-design.md
   Tokens: --lms-* from main.css */

/* ── Toolbar ── */
.nm-toolbar {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  margin: 1rem 0;
  flex-wrap: wrap;
}

.nm-toolbar__spacer {
  flex: 1;
}

/* ── Buttons ── */
.nm-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  border-radius: var(--lms-radius-sm);
  height: var(--lms-h, 36px);
  padding: 0 1rem;
  font-size: 0.82rem;
  font-weight: 600;
  cursor: pointer;
  transition: all var(--lms-transition);
  font: inherit;
  white-space: nowrap;
  text-decoration: none;
}

.nm-btn--primary {
  background: var(--lms-accent);
  color: #fff;
  border: none;
}
.nm-btn--primary:hover {
  background: var(--lms-accent-hover);
}

.nm-btn--secondary {
  background: var(--lms-surface);
  color: var(--lms-text);
  border: 1px solid var(--lms-border);
}
.nm-btn--secondary:hover {
  border-color: var(--lms-accent);
  color: var(--lms-accent);
}

.nm-btn--ghost {
  background: none;
  border: none;
  color: var(--lms-muted);
  padding: 0.3rem 0.5rem;
  font-weight: 400;
}
.nm-btn--ghost:hover {
  color: var(--lms-text);
  background: var(--lms-surface-2);
}

.nm-btn--danger {
  background: var(--lms-danger);
  color: #fff;
  border: none;
}
.nm-btn--danger:hover {
  background: #a51a1a;
}

/* ── Dropdown ── */
.nm-dropdown {
  position: relative;
}
.nm-dropdown__menu {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  background: var(--lms-surface);
  border: 1px solid var(--lms-border);
  border-radius: var(--lms-radius-sm);
  box-shadow: var(--lms-shadow);
  min-width: 180px;
  z-index: 50;
  padding: 0.3rem 0;
}
.nm-dropdown__item {
  display: block;
  width: 100%;
  text-align: left;
  padding: 0.5rem 0.85rem;
  font-size: 0.82rem;
  color: var(--lms-text);
  background: none;
  border: none;
  cursor: pointer;
  font: inherit;
  text-decoration: none;
  transition: background var(--lms-transition);
}
.nm-dropdown__item:hover {
  background: var(--lms-surface-2);
}

/* ── Search box (pill shape) ── */
.nm-search {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  border: 1px solid var(--lms-border);
  background: var(--lms-surface);
  border-radius: 18px;
  height: var(--lms-h, 36px);
  padding: 0 0.9rem;
  min-width: 200px;
  flex: 1;
  max-width: 300px;
  transition: border-color var(--lms-transition);
}
.nm-search:focus-within {
  border-color: var(--lms-accent);
}
.nm-search__icon {
  color: var(--lms-muted);
  flex-shrink: 0;
}
.nm-search input {
  border: none;
  outline: none;
  background: none;
  color: var(--lms-text);
  font-size: 0.82rem;
  width: 100%;
  font: inherit;
}
.nm-search input::placeholder {
  color: var(--lms-muted);
}
.nm-search__clear {
  background: none;
  border: none;
  color: var(--lms-muted);
  cursor: pointer;
  padding: 0 0.2rem;
  font-size: 1rem;
  line-height: 1;
  transition: color var(--lms-transition);
}
.nm-search__clear:hover {
  color: var(--lms-text);
}

/* ── Table ── */
.nm-table-wrap {
  overflow-x: auto;
  border-radius: var(--lms-radius);
  border: 1px solid var(--lms-border);
  background: var(--lms-surface);
  box-shadow: var(--lms-shadow);
}

.nm-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.82rem;
}

.nm-table th {
  text-align: left;
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--lms-muted);
  padding: 0.6rem 1rem;
  border-bottom: 2px solid var(--lms-border);
  background: var(--lms-surface-2);
  white-space: nowrap;
}

.nm-table td {
  padding: 0.65rem 1rem;
  border-bottom: 1px solid var(--lms-border);
  vertical-align: middle;
}

.nm-table tr:last-child td {
  border-bottom: none;
}

.nm-table tbody tr {
  transition: background var(--lms-transition);
}

.nm-table tbody tr:hover {
  background: var(--lms-surface-2);
}

/* ── Node name cell ── */
.nm-node-name {
  font-weight: 700;
  display: flex;
  align-items: center;
  gap: 0.45rem;
}

.nm-node-link {
  color: var(--lms-text);
  text-decoration: none;
  cursor: pointer;
}
.nm-node-link:hover {
  color: var(--lms-accent);
}

.nm-node-name__text {
  color: var(--lms-muted);
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

/* ── Status badge ── */
.nm-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.7rem;
  border-radius: 20px;
  padding: 0.15rem 0.6rem;
  font-weight: 600;
  white-space: nowrap;
}
.nm-badge--online {
  background: var(--lms-success-light);
  color: var(--lms-success);
  border: 1px solid var(--lms-success-border);
}
.nm-badge--warning {
  background: var(--lms-warning-light);
  color: var(--lms-warning);
  border: 1px solid rgba(227, 116, 0, 0.3);
}
.nm-badge--offline {
  background: var(--lms-danger-light);
  color: var(--lms-danger);
  border: 1px solid var(--lms-danger-border);
}
.nm-badge--long_offline {
  background: var(--lms-surface-2);
  color: var(--lms-muted);
  border: 1px solid var(--lms-border);
}

/* ── Cell styles ── */
.nm-cell-addr {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.78rem;
  color: var(--lms-muted);
}
.nm-cell-hb {
  font-size: 0.78rem;
  color: var(--lms-muted);
  white-space: nowrap;
}
.nm-cell-ver {
  font-size: 0.78rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.nm-cell-notes {
  font-size: 0.78rem;
  color: var(--lms-muted);
  max-width: 150px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ── Row offline ── */
.row-offline {
  opacity: 0.6;
}

/* ── Action buttons (ghost style) ── */
.nm-row-actions {
  display: inline-flex;
  gap: 0.3rem;
  justify-content: flex-end;
}

.nm-btn-icon {
  background: none;
  border: none;
  color: var(--lms-muted);
  cursor: pointer;
  padding: 0.3rem 0.5rem;
  border-radius: var(--lms-radius-sm);
  font-size: 0.82rem;
  transition: all var(--lms-transition);
  font: inherit;
}
.nm-btn-icon:hover {
  color: var(--lms-text);
  background: var(--lms-surface-2);
}
.nm-btn-icon--danger:hover {
  color: var(--lms-danger);
}

/* ── Empty state ── */
.nm-empty {
  padding: 3rem 1rem;
  text-align: center;
}
.nm-empty__icon {
  font-size: 2rem;
  margin-bottom: 0.5rem;
}
.nm-empty__title {
  font-weight: 600;
  font-size: 0.95rem;
  margin-bottom: 0.3rem;
}
.nm-empty__desc {
  font-size: 0.82rem;
  color: var(--lms-muted);
  margin-bottom: 1rem;
  max-width: 380px;
  margin-left: auto;
  margin-right: auto;
  line-height: 1.6;
}
.nm-empty__actions {
  display: flex;
  justify-content: center;
  gap: 0.6rem;
}

/* ── Loading ── */
.nm-loading {
  text-align: center;
  padding: 3rem;
  color: var(--lms-muted);
}

/* ── Modal ── */
.nm-modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.45);
  z-index: 10000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 0.75rem;
}
.nm-modal {
  background: var(--lms-surface);
  border: 1px solid var(--lms-border);
  border-radius: var(--lms-radius);
  width: 100%;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 8px 32px rgba(0,0,0,0.2);
}
.nm-modal__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem 1.25rem;
  border-bottom: 1px solid var(--lms-border);
}
.nm-modal__head h3 {
  margin: 0;
  font-size: 1rem;
}
.nm-modal__close {
  background: none;
  border: none;
  font-size: 1.2rem;
  cursor: pointer;
  color: var(--lms-muted);
  padding: 0.2rem 0.4rem;
  border-radius: 4px;
  transition: all var(--lms-transition);
  line-height: 1;
}
.nm-modal__close:hover {
  color: var(--lms-text);
  background: var(--lms-surface-2);
}
.nm-modal__body {
  padding: 1.25rem;
  overflow-y: auto;
  flex: 1;
}
.nm-modal__foot {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.5rem;
  padding: 1rem 1.25rem;
  border-top: 1px solid var(--lms-border);
}

/* ═══════════ Mobile card list (hidden on desktop) ═══════════ */
.nm-card-list {
  display: none;
}

/* ═══════════ RWD: Mobile (< 768px) ═══════════ */
@media (max-width: 767px) {
  /* Hide table, show card list */
  .nm-table-wrap {
    display: none;
  }
  .nm-card-list {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }

  /* Toolbar: stack vertically */
  .nm-toolbar {
    flex-direction: column;
    align-items: stretch;
    gap: 0.5rem;
  }
  .nm-toolbar__spacer {
    display: none;
  }
  .nm-btn {
    justify-content: center;
    height: var(--lms-h-mobile, 44px);
    font-size: 0.9rem;
  }
  .nm-search {
    max-width: none;
    min-width: 0;
    height: var(--lms-h-mobile, 44px);
    border-radius: 20px;
  }
  .nm-search input {
    font-size: 16px; /* ≥16px 避免 iOS focus 自動放大 */
  }

  /* Mobile card styles */
  .nm-card-item {
    background: var(--lms-surface);
    border: 1px solid var(--lms-border);
    border-radius: var(--lms-radius-sm);
    padding: 0.75rem 0.85rem;
    transition: all var(--lms-transition);
  }
  .nm-card-item:hover {
    border-color: var(--lms-accent);
  }
  .nm-card-top {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin-bottom: 0.25rem;
  }
  .nm-card-name {
    font-weight: 700;
    font-size: 0.88rem;
  }
  .nm-card-addr {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 0.75rem;
    color: var(--lms-muted);
    margin-bottom: 0.3rem;
  }
  .nm-card-meta {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.78rem;
    color: var(--lms-muted);
    margin-bottom: 0.35rem;
    flex-wrap: wrap;
  }
  .nm-card-notes {
    font-size: 0.78rem;
    color: var(--lms-muted);
    font-style: italic;
    margin-bottom: 0.4rem;
  }
  .nm-card-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.4rem;
  }
}
</style>
