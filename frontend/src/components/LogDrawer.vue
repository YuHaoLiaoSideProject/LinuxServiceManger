<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import type { LogLine } from '../types/service'

const props = defineProps<{
  serviceName: string
  visible: boolean
}>()

const emit = defineEmits<{
  close: []
  'switch-service': [name: string]
}>()

const logLines = ref<LogLine[]>([])
const isLoading = ref(false)
const error = ref('')
const lineCount = ref(100)
const isConnected = ref(false)
const searchQuery = ref('')
const reconnecting = ref(false)
const preRef = ref<HTMLPreElement | null>(null)

let ws: WebSocket | null = null
let intentionalClose = false

// ── Computed: search filtering ──

const filteredLines = computed(() => {
  if (!searchQuery.value) {
    return logLines.value.map(line => ({ text: line.text, match: false }))
  }
  const q = searchQuery.value.toLowerCase()
  return logLines.value.map(line => ({
    text: line.text,
    match: line.text.toLowerCase().includes(q),
  }))
})

const matchCount = computed(() => filteredLines.value.filter(l => l.match).length)
const totalLines = computed(() => logLines.value.length)

// ── WebSocket connection ──

function connect() {
  if (!props.visible || !props.serviceName) return

  disconnect()

  isLoading.value = true
  error.value = ''
  logLines.value = []
  isConnected.value = false
  reconnecting.value = false
  intentionalClose = false

  try {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const host = window.location.host
    const url = `${protocol}//${host}/api/v1/services/${encodeURIComponent(props.serviceName)}/logs/ws?lines=${lineCount.value}`

    ws = new WebSocket(url)

    ws.onopen = () => {
      isLoading.value = false
      isConnected.value = true
      reconnecting.value = false
    }

    ws.onmessage = (event: { data: string }) => {
      const text = event.data
      // Check if it's an error message (JSON)
      try {
        const parsed = JSON.parse(text)
        if (parsed.error) {
          error.value = parsed.error
          isLoading.value = false
          return
        }
      } catch {
        // Not JSON, it's a regular log line
      }

      logLines.value.push({ text, match: false })

      // Auto-scroll to bottom
      nextTick(() => {
        if (preRef.value) {
          preRef.value.scrollTop = preRef.value.scrollHeight
        }
      })
    }

    ws.onclose = () => {
      isConnected.value = false
      isLoading.value = false

      // Reconnect if not intentional
      if (!intentionalClose && props.visible && props.serviceName) {
        reconnecting.value = true
        setTimeout(() => {
          connect()
        }, 1000)
      }
    }

    ws.onerror = () => {
      error.value = 'WebSocket 連線失敗'
      isLoading.value = false
    }
  } catch (e: any) {
    error.value = e.message || 'Failed to connect'
    isLoading.value = false
  }
}

function disconnect() {
  if (ws) {
    intentionalClose = true
    ws.onclose = null
    ws.close()
    ws = null
    isConnected.value = false
    reconnecting.value = false
  }
}

// ── Actions ──

function handleClose() {
  disconnect()
  emit('close')
}

function handleRetry() {
  connect()
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && props.visible) {
    handleClose()
    return
  }
  if (e.key !== 'Tab' || !props.visible) return

  const drawer = document.querySelector('.log-drawer')
  if (!drawer) return
  const focusable = drawer.querySelectorAll<HTMLElement>(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  )
  if (focusable.length === 0) return

  const first = focusable[0]
  const last = focusable[focusable.length - 1]

  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault()
    last.focus()
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault()
    first.focus()
  }
}

// ── Watchers ──

// Handle line count changes → reconnect
watch(lineCount, () => {
  if (props.visible && props.serviceName) {
    connect()
  }
})

// Handle visibility and serviceName changes
watch(
  [() => props.visible, () => props.serviceName],
  ([newVisible, newServiceName]) => {
    if (newVisible && newServiceName) {
      connect()
    } else {
      disconnect()
    }
  },
  { immediate: true }
)

onMounted(() => {
  document.addEventListener('keydown', onKeydown)
})

onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown)
  disconnect()
})
</script>

<template>
  <div v-if="visible" class="drawer-overlay" @click.self="handleClose">
    <div class="log-drawer">
      <!-- Header -->
      <div class="drawer-header">
        <h2 class="drawer-title">
          📋 {{ serviceName }} — 日誌
        </h2>
        <div class="drawer-controls">
          <select v-model="lineCount" class="line-count-select">
            <option value="50">50 行</option>
            <option value="100">100 行</option>
            <option value="200">200 行</option>
            <option value="500">500 行</option>
          </select>
          <button class="close-btn" @click="handleClose" aria-label="關閉日誌檢視器">✕</button>
        </div>
      </div>

      <!-- Search bar -->
      <div v-if="isConnected && logLines.length > 0" class="search-bar">
        <input
          v-model="searchQuery"
          class="search-input"
          type="text"
          placeholder="搜尋日誌..."
          aria-label="搜尋日誌"
        />
        <span v-if="searchQuery" class="match-count">{{ matchCount }} / {{ totalLines }} 行</span>
      </div>

      <!-- Log content area -->
      <div class="drawer-body">
        <!-- Reconnect hint -->
        <div v-if="reconnecting" class="reconnect-hint" aria-live="polite">
          連線中斷，正在重連...
        </div>

        <!-- Loading spinner -->
        <div v-if="isLoading" class="loading-spinner">
          <div class="spinner"></div>
          <span>正在載入日誌...</span>
        </div>

        <!-- Error message -->
        <div v-else-if="error" class="drawer-error">
          <p>{{ error }}</p>
          <button class="retry-btn" @click="handleRetry">重試</button>
        </div>

        <!-- Empty state -->
        <div v-else-if="isConnected && logLines.length === 0" class="empty-state">
          📭 此服務尚無日誌記錄
        </div>

        <!-- Log display -->
        <pre
          v-else
          ref="preRef"
          class="log-content"
        ><code><template v-for="(line, idx) in filteredLines" :key="idx"><span :class="{ highlight: line.match, dim: searchQuery && !line.match }">{{ line.text }}</span></template></code></pre>
      </div>
    </div>
  </div>
</template>

<style scoped>
.drawer-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: 1000;
  display: flex;
  justify-content: flex-end;
}

.log-drawer {
  width: 50%;
  min-width: 400px;
  max-width: 800px;
  height: 100%;
  background: var(--color-bg-primary, #fff);
  box-shadow: -4px 0 12px rgba(0, 0, 0, 0.15);
  display: flex;
  flex-direction: column;
}

@media (max-width: 768px) {
  .log-drawer {
    width: 100vw;
    min-width: unset;
    max-width: unset;
  }
}

.drawer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--color-border, #e0e0e0);
  flex-shrink: 0;
}

.drawer-title {
  margin: 0;
  font-size: 1.1rem;
  font-weight: 600;
}

.drawer-controls {
  display: flex;
  align-items: center;
  gap: 12px;
}

.line-count-select {
  padding: 4px 8px;
  border: 1px solid var(--color-border, #ccc);
  border-radius: 4px;
  background: var(--color-bg-secondary, #f5f5f5);
  font-size: 0.85rem;
}

.close-btn {
  background: none;
  border: none;
  font-size: 1.3rem;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 4px;
  color: var(--color-text-secondary, #666);
}

.close-btn:hover {
  background: var(--color-bg-hover, #eee);
}

.search-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 20px;
  border-bottom: 1px solid var(--color-border, #e0e0e0);
  flex-shrink: 0;
}

.search-input {
  flex: 1;
  padding: 6px 10px;
  border: 1px solid var(--color-border, #ccc);
  border-radius: 4px;
  font-size: 0.85rem;
  background: var(--color-bg-secondary, #f5f5f5);
  color: var(--color-text-primary, #333);
}

.search-input:focus {
  outline: none;
  border-color: var(--color-primary, #4a90d9);
}

.match-count {
  font-size: 0.8rem;
  color: var(--color-text-secondary, #666);
  white-space: nowrap;
}

.drawer-body {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  position: relative;
}

.reconnect-hint {
  padding: 8px 20px;
  background: #fff3e0;
  color: #e65100;
  font-size: 0.85rem;
  text-align: center;
  flex-shrink: 0;
}

.loading-spinner {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 40px;
  color: var(--color-text-secondary, #666);
}

.spinner {
  width: 32px;
  height: 32px;
  border: 3px solid var(--color-border, #e0e0e0);
  border-top-color: var(--color-primary, #4a90d9);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.drawer-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 20px;
  color: #d32f2f;
  text-align: center;
}

.retry-btn {
  padding: 6px 20px;
  border: 1px solid var(--color-border, #ccc);
  border-radius: 4px;
  background: var(--color-bg-secondary, #f5f5f5);
  cursor: pointer;
  font-size: 0.85rem;
}

.retry-btn:hover {
  background: var(--color-bg-hover, #eee);
}

.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px;
  color: var(--color-text-secondary, #999);
  font-style: italic;
}

.log-content {
  flex: 1;
  margin: 0;
  padding: 16px;
  overflow-y: auto;
  font-family: 'Courier New', Courier, monospace;
  font-size: 0.85rem;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-all;
  background: var(--color-bg-code, #1e1e1e);
  color: var(--color-text-code, #d4d4d4);
}

.log-content code {
  font-family: inherit;
}

.log-content code span.highlight {
  background: rgba(255, 235, 59, 0.4);
}

.log-content code span.dim {
  opacity: 0.4;
}
</style>
