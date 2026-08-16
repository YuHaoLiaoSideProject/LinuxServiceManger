<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useNodesStore } from '../stores/nodes'
import { searchServices } from '../api/client'
import { useWebSocket } from '../composables/useWebSocket'
import { useI18n } from '../composables/useI18n'
import NodeCard from '../components/NodeCard.vue'
import NodeDetailPanel from '../components/NodeDetailPanel.vue'
import NodeFormModal from '../components/NodeFormModal.vue'
import EmptyState from '../components/EmptyState.vue'
import ToastContainer from '../components/ToastContainer.vue'
import type { Node, SearchResponse } from '../types/node'

const nodesStore = useNodesStore()
const router = useRouter()
const ws = useWebSocket()
const { t } = useI18n()

const searchQ = ref('')
const searchResult = ref<SearchResponse | null>(null)
const searchOpen = ref(false)
const searching = ref(false)
const detailNodeId = ref<string | null>(null)
const editingNode = ref<Node | null>(null)   // 詳情面板「編輯設定」→ NodeFormModal 預填（缺口 #3）

const summary = computed(() => nodesStore.summary)

let debounceTimer: ReturnType<typeof setTimeout> | null = null

/** 依狀態排序：online/degraded/warning 在前、offline 次之、long_offline ⚫ 移至底部/摺疊（BDD @offline） */
const sortedNodes = computed(() => [...nodesStore.nodes].sort((a, b) => rank(a.status) - rank(b.status)))

function rank(s: string): number {
  if (s === 'long_offline') return 2
  if (s === 'offline') return 1
  return 0
}

/** 跨節點搜尋 debounce 300ms（BDD @search）：停止輸入 300ms 後才發送；快速連續輸入只發一次 */
function onSearchInput(): void {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(async () => {
    const q = searchQ.value.trim()
    if (!q) { searchResult.value = null; searchOpen.value = false; return }
    searching.value = true
    try {
      searchResult.value = await searchServices(q)   // failed_nodes 尾部標示「N 個節點無法查詢（離線/逾時）」（BDD @partial-failure）
      searchOpen.value = true
    } finally {
      searching.value = false
    }
  }, 300)
}

function closeSearch(): void {
  searchQ.value = ''
  searchOpen.value = false
  searchResult.value = null
}

function onCardClick(nodeId: string, status: string): void {
  if (status === 'online' || status === 'degraded' || status === 'warning') {
    router.push({ path: '/dashboard', query: { node: nodeId } })   // BDD @switch
  } else {
    detailNodeId.value = nodeId                                     // 離線 → 離線資訊面板（BDD @node-detail）
  }
}

/** 詳情面板「編輯設定」→ 開 NodeFormModal（預填目前詳情節點；儲存後由 saved 重新拉取 store） */
function onEditDetailNode(): void {
  editingNode.value = nodesStore.byId(detailNodeId.value ?? '') ?? null
}

function onSearchResultClick(item: { node_id: string; service: string }): void {
  router.push({ path: '/dashboard', query: { node: item.node_id, service: item.service } }) // ?service= 初始展開（決策 8）
}

/** 載入失敗重試（F-AD-05）：重新拉取節點與統計 */
function retryLoad(): void {
  nodesStore.fetchNodes()
  nodesStore.fetchSummary()
}

onMounted(() => {
  nodesStore.fetchNodes()
  nodesStore.fetchSummary()                    // 並行請求（BDD @entry）
  ws.on('node_status', nodesStore.applyNodeEvent)
  ws.on('node_online', nodesStore.applyNodeEvent)
  ws.on('node_offline', nodesStore.applyNodeEvent)
  ws.on('node_removed', nodesStore.applyNodeEvent)
})
</script>

<template>
  <div class="aggregate-dashboard">
    <!-- 統計列（BDD @aggregate）：總節點數 / 線上台數 / 離線台數 + 總服務數 / 執行中 / 失敗
         數值來自心跳附帶 ServiceStats（零代理查詢，UIUX 決策 2/9）；Loading 顯示「—」 -->
    <div class="stats-bar aggregate-stats" data-testid="aggregate-stats">
      <span class="stat-chip">
        <span class="chip-icon"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg></span>
        <span class="chip-label">{{ t('nodes.total') }}</span> <b>{{ summary?.total_nodes ?? '—' }}</b>
      </span>
      <span class="stat-chip online">
        <span class="chip-icon"><svg width="13" height="13" viewBox="0 0 8 8" aria-hidden="true"><circle cx="4" cy="4" r="4" fill="var(--lms-success)"/></svg></span>
        <span class="chip-label">{{ t('nodes.online') }}</span> <b>{{ summary?.online ?? '—' }}</b>
      </span>
      <span class="stat-chip offline">
        <span class="chip-icon"><svg width="13" height="13" viewBox="0 0 8 8" aria-hidden="true"><circle cx="4" cy="4" r="4" fill="var(--lms-danger)"/></svg></span>
        <span class="chip-label">{{ t('nodes.offline') }}</span> <b>{{ (summary?.offline ?? 0) + (summary?.long_offline ?? 0) }}</b>
      </span>
      <span class="stat-divider" aria-hidden="true"></span>
      <span class="stat-chip">
        <span class="chip-icon"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg></span>
        <span class="chip-label">{{ t('nodes.totalServices') }}</span> <b>{{ summary?.total_services ?? '—' }}</b>
      </span>
      <span class="stat-chip">
        <span class="chip-icon"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg></span>
        <span class="chip-label">{{ t('nodes.activeServices') }}</span> <b>{{ summary?.active_services ?? '—' }}</b>
      </span>
      <span class="stat-chip offline">
        <span class="chip-icon"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg></span>
        <span class="chip-label">{{ t('nodes.failedServices') }}</span> <b>{{ summary?.failed_services ?? '—' }}</b>
      </span>
    </div>

    <!-- 跨節點搜尋（debounce 300ms；clear ✕ / Esc 關閉；結果列表 / 無匹配 / failed_nodes 標示） -->
    <div class="search-bar" :class="{ 'has-value': !!searchQ }">
      <span class="search-icon"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg></span>
      <input
        v-model="searchQ"
        type="text"
        :placeholder="t('nodes.searchPlaceholder')"
        data-testid="node-search"
        aria-label="跨節點搜尋服務"
        autocomplete="off"
        @input="onSearchInput"
        @keydown.esc="closeSearch"
      />
      <button v-if="searchQ" class="search-clear" aria-label="清除搜尋" @click="closeSearch">✕</button>
    </div>
    <div v-if="searchOpen" class="search-results" data-testid="search-results">
      <div v-if="searching" class="loading-spinner-sm" aria-busy="true" />
      <p v-else-if="!searchResult?.results.length" class="search-empty">{{ t('nodes.searchEmpty') }}</p>
      <template v-else>
        <button v-for="r in searchResult?.results" :key="r.node_id + r.service" class="search-item" @click="onSearchResultClick(r)">
          <span class="search-node">{{ r.node_name }}</span>
          <span class="search-service">{{ r.service }}</span>
          <span class="search-state">{{ r.active }}</span>
          <span class="search-arrow"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg></span>
        </button>
      </template>
      <p v-if="searchResult?.failed_nodes.length" class="failed-note">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4m0 4h.01"/></svg>
        <span><b>{{ searchResult.failed_nodes.length }}</b> {{ t('nodes.failedNodes') }}（{{ searchResult.failed_nodes.map(f => f.node_name).join(', ') }}）</span>
      </p>
    </div>

    <!-- 載入失敗：錯誤訊息 + 重試（F-AD-05） -->
    <div v-if="nodesStore.error" class="load-error" role="alert" data-testid="load-error">
      <span>⚠ {{ nodesStore.error }}</span>
      <button class="btn btn-secondary" data-testid="retry" @click="retryLoad">重試</button>
    </div>

    <div v-show="nodesStore.loading" class="loading-spinner" aria-busy="true" />
    <EmptyState v-if="!nodesStore.loading && !nodesStore.error && nodesStore.nodes.length === 0" message="尚無已註冊節點，請先新增節點" :show-button="false">
      <router-link class="btn btn-primary" to="/nodes">{{ t('nav.nodes') }}</router-link>
    </EmptyState>
    <div v-if="!nodesStore.loading && !nodesStore.error && nodesStore.nodes.length > 0" class="node-card-grid">
      <NodeCard v-for="n in sortedNodes" :key="n.id" :node="n" @click="onCardClick(n.id, n.status)" @detail="detailNodeId = n.id" />
    </div>

    <NodeDetailPanel v-if="detailNodeId" :node-id="detailNodeId" @close="detailNodeId = null" @edit="onEditDetailNode" />

    <NodeFormModal v-if="editingNode" :node="editingNode" @close="editingNode = null" @saved="editingNode = null; nodesStore.fetchNodes()" />

    <!-- Toast（節點離線/恢復/註冊等全域通知；UIUX 014 決策 7：三視圖皆需 Toast） -->
    <ToastContainer />
  </div>
</template>
