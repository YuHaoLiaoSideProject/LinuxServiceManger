<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useNodesStore } from '../stores/nodes'
import NodeStatusDot from './NodeStatusDot.vue'
import { statusLabel } from '../utils/nodeStatus'

const nodesStore = useNodesStore()
const router = useRouter()
const open = ref(false)
const rootEl = ref<HTMLElement | null>(null)

function optionItems(): HTMLElement[] {
  return Array.from(rootEl.value?.querySelectorAll<HTMLElement>('.node-option') ?? [])
}

function select(id: string | null): void {
  nodesStore.setActiveNode(id)
  open.value = false
  router.push(id ? { path: '/dashboard', query: { node: id } } : { path: '/' }) // 「所有節點」返回 Aggregate（BDD @switch）
}

function toggle(): void {
  open.value = !open.value
}

function close(): void {
  open.value = false
}

/** 方向鍵於選單內移動（radiogroup 鍵盤語意，WCAG 2.1.1）；Esc 關閉 */
function onRootKeydown(e: KeyboardEvent): void {
  if (!open.value) return
  if (e.key === 'Escape') {
    e.preventDefault()
    close()
    rootEl.value?.querySelector<HTMLElement>('[data-testid="node-switcher"]')?.focus()
    return
  }
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return
  const items = optionItems()
  if (!items.length) return
  e.preventDefault()
  const idx = items.indexOf(document.activeElement as HTMLElement)
  let next = 0
  if (e.key === 'ArrowDown') next = idx === -1 ? 0 : (idx + 1) % items.length
  else if (e.key === 'ArrowUp') next = idx === -1 ? items.length - 1 : (idx - 1 + items.length) % items.length
  else if (e.key === 'Home') next = 0
  else if (e.key === 'End') next = items.length - 1
  items[next].focus()
}

/** 外部點擊關閉（沿用 account menu pattern，UIUX 決策 5） */
function onDocumentClick(e: MouseEvent): void {
  const target = e.target as Node | null
  if (rootEl.value && target && !rootEl.value.contains(target)) close()
}

onMounted(() => {
  document.addEventListener('click', onDocumentClick)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', onDocumentClick)
})
</script>

<template>
  <div ref="rootEl" class="node-switcher" @keydown="onRootKeydown">
    <button
      class="ns-btn"
      data-testid="node-switcher"
      type="button"
      aria-haspopup="menu"
      :aria-expanded="open"
      :class="{ open }"
      @click="toggle"
    >
      <NodeStatusDot v-if="nodesStore.activeNode" :status="nodesStore.activeNode.status" :size="9" />
      <svg v-else width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
      <span class="ns-label">{{ nodesStore.activeNode?.name || '所有節點' }}</span>
      <svg class="chevron" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true">
        <path d="M6 9l6 6 6-6" />
      </svg>
    </button>

    <div v-if="open" class="node-dropdown" role="menu" data-testid="node-dropdown">
      <button
        class="node-option all"
        :class="{ active: !nodesStore.activeNodeId }"
        role="menuitemradio"
        :aria-checked="!nodesStore.activeNodeId"
        @click="select(null)"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        </svg>
        <span class="opt-name">所有節點</span>
      </button>
      <button
        v-for="n in nodesStore.nodes"
        :key="n.id"
        class="node-option"
        :class="{ active: nodesStore.activeNodeId === n.id }"
        role="menuitemradio"
        :aria-checked="nodesStore.activeNodeId === n.id"
        data-testid="node-option"
        @click="select(n.id)"
      >
        <NodeStatusDot :status="n.status" :size="9" />
        <span class="opt-name">{{ n.name }}</span>
        <span v-if="n.status !== 'online'" class="opt-st">{{ statusLabel(n.status) }}</span>
      </button>
    </div>
  </div>
</template>
