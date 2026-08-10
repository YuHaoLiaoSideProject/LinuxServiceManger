import { ref, onUnmounted, readonly } from 'vue'

export type ConnectionStatus = 'connected' | 'connecting' | 'offline'

export interface StatusChangeMessage {
  type: 'status_change'
  name: string
  active: string
  sub: string
  unitFileState: string
}

export interface ServiceAddedMessage {
  type: 'service_added'
  name: string
  active: string
  sub: string
  unitFileState: string
}

export interface ServiceRemovedMessage {
  type: 'service_removed'
  name: string
}

export interface SnapshotMessage {
  type: 'snapshot'
  services: Array<{
    name: string
    active: string
    sub: string
    unitFileState: string
  }>
}

export type WsMessage = StatusChangeMessage | ServiceAddedMessage | ServiceRemovedMessage | SnapshotMessage

export function useWebSocket() {
  const status = ref<ConnectionStatus>('connecting')
  const lastUpdate = ref<Date | null>(null)
  const isSupported = ref(true)

  let ws: WebSocket | null = null
  let retryCount = 0
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let heartbeatTimer: ReturnType<typeof setTimeout> | null = null
  const maxRetryDelay = 30_000

  const handlers = new Map<string, (msg: any) => void>()

  function on(type: string, handler: (msg: any) => void) {
    handlers.set(type, handler)
  }

  function connect() {
    if (typeof window !== 'undefined' && !window.WebSocket) {
      isSupported.value = false
      status.value = 'offline'
      return
    }

    // Clean up any existing connection
    if (ws) {
      ws.onclose = null
      ws.onerror = null
      ws.onopen = null
      ws.onmessage = null
      ws.close()
      ws = null
    }

    status.value = 'connecting'

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${protocol}//${window.location.host}/api/v1/ws`

    ws = new WebSocket(wsUrl)

    ws.onopen = () => {
      status.value = 'connected'
      retryCount = 0
      resetHeartbeatTimer()
    }

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data)
        lastUpdate.value = new Date()
        resetHeartbeatTimer()

        const handler = handlers.get(msg.type)
        if (handler) {
          handler(msg)
        }
      } catch {
        // Ignore malformed messages
      }
    }

    ws.onclose = (event) => {
      ws = null
      if (event.code !== 1000) {
        status.value = 'connecting'
        scheduleReconnect()
      }
    }

    ws.onerror = () => {
      // onclose will fire after onerror
    }
  }

  function disconnect() {
    if (retryTimer) clearTimeout(retryTimer)
    if (heartbeatTimer) clearTimeout(heartbeatTimer)
    retryCount = 0
    if (ws) {
      ws.close(1000, 'User logout')
      ws = null
    }
    status.value = 'offline'
  }

  function scheduleReconnect() {
    const delay = Math.min(1000 * Math.pow(2, retryCount), maxRetryDelay)
    retryCount++
    retryTimer = setTimeout(() => {
      connect()
    }, delay)
  }

  function resetHeartbeatTimer() {
    if (heartbeatTimer) clearTimeout(heartbeatTimer)
    heartbeatTimer = setTimeout(() => {
      if (ws) {
        ws.close()
        ws = null
      }
      scheduleReconnect()
    }, 45_000)
  }

  // Auto-connect on creation (only in browser)
  if (typeof window !== 'undefined') {
    connect()
  }

  onUnmounted(() => {
    disconnect()
  })

  return {
    status: readonly(status),
    lastUpdate: readonly(lastUpdate),
    isSupported: readonly(isSupported),
    on,
    connect,
    disconnect,
  }
}
