# WebSocket 即時狀態推送 — 開發規格

> **對應 Roadmap**：Phase 2 — `docs/development/002-expansion-roadmap.md` 項目 #6
> **技術決策**：`docs/tech-decisions/008-websocket-status-push.md`
> **操作流程**：`docs/interaction-flows/008-websocket-status-push.md`
> **BDD**：`docs/bdds/008-websocket-status-push.feature`
> **測試計畫**：`docs/test-plans/008-websocket-status-push測試計畫.md`
> **狀態**：設計完成，待開發

---

## 概述

加入 WebSocket 即時狀態推送機制，讓後端主動推送服務狀態變更至瀏覽器，取代手動重整。核心包含：

1. **後端 WebSocket Hub**：管理客戶端連線、廣播訊息
2. **D-Bus 狀態監聽**：透過 D-Bus PropertiesChanged 訊號即時偵測變更
3. **Polling Fallback**：D-Bus 不可用時自動降級為 systemctl 定時比對
4. **前端 WebSocket composable**：連線生命週期管理、自動重連、狀態更新
5. **連線狀態指示器**：Header 即時顯示連線狀態（已連線 / 重連中 / 離線）

---

## 1. 後端實作規格

### 1.1 依賴新增

```bash
go get github.com/gorilla/websocket
go get github.com/godbus/dbus/v5
```

### 1.2 檔案改動總覽

```
src/
├── main.go                              ← 修改：註冊 WebSocket route
├── internal/
│   ├── handler/
│   │   └── websocket_handler.go         ← 新增：WebSocket upgrade + Hub 初始化
│   ├── websocket/
│   │   ├── hub.go                       ← 新增：Hub 連線管理與廣播
│   │   ├── client.go                    ← 新增：單一 WebSocket 客戶端讀寫
│   │   └── hub_test.go                  ← 新增：Hub 單元測試
│   ├── monitor/
│   │   ├── monitor.go                   ← 新增：狀態監控介面 + 變更偵測
│   │   ├── dbus_monitor.go              ← 新增：D-Bus PropertiesChanged 監聽
│   │   ├── polling_monitor.go           ← 新增：systemctl polling fallback
│   │   └── monitor_test.go              ← 新增：monitor 單元測試
│   └── systemd/
│       └── systemd.go                   ← 可能修改：ListServices 供 polling 比對
```

### 1.3 Hub 實作（`internal/websocket/hub.go`）

Hub 是 WebSocket 連線的中央管理中心，使用 channel-based 並發模型：

```go
package websocket

import (
	"encoding/json"
	"log"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// Message represents a WebSocket push message
type Message struct {
	Type          string `json:"type"`                    // status_change, service_added, service_removed, heartbeat, snapshot
	Name          string `json:"name,omitempty"`
	Active        string `json:"active,omitempty"`
	Sub           string `json:"sub,omitempty"`
	UnitFileState string `json:"unitFileState,omitempty"`
	Timestamp     string `json:"timestamp,omitempty"`
	Services      []ServiceSnapshot `json:"services,omitempty"` // for snapshot
}

type ServiceSnapshot struct {
	Name          string `json:"name"`
	Active        string `json:"active"`
	Sub           string `json:"sub"`
	UnitFileState string `json:"unitFileState"`
}

type Client struct {
	hub    *Hub
	conn   *websocket.Conn
	send   chan []byte
	userID string // session identifier
}

type Hub struct {
	mu       sync.RWMutex
	clients  map[*Client]bool
	broadcast  chan []byte
	register   chan *Client
	unregister chan *Client
	// OnSnapshot is called when a client reconnects and needs full state
	OnSnapshot func() []ServiceSnapshot
}

func NewHub() *Hub {
	return &Hub{
		clients:    make(map[*Client]bool),
		broadcast:  make(chan []byte, 256),
		register:   make(chan *Client),
		unregister: make(chan *Client),
	}
}

func (h *Hub) Run() {
	// Heartbeat ticker: every 30s send heartbeat to all clients
	heartbeat := time.NewTicker(30 * time.Second)
	defer heartbeat.Stop()

	for {
		select {
		case client := <-h.register:
			h.mu.Lock()
			h.clients[client] = true
			h.mu.Unlock()

			// Send snapshot on connect
			if h.OnSnapshot != nil {
				snapshot := h.OnSnapshot()
				msg := Message{
					Type:     "snapshot",
					Services: snapshot,
				}
				data, _ := json.Marshal(msg)
				client.send <- data
			}

		case client := <-h.unregister:
			h.mu.Lock()
			if _, ok := h.clients[client]; ok {
				delete(h.clients, client)
				close(client.send)
			}
			h.mu.Unlock()

		case message := <-h.broadcast:
			h.mu.RLock()
			for client := range h.clients {
				select {
				case client.send <- message:
				default:
					// Client send buffer full → assume slow/dead, drop it
					close(client.send)
					delete(h.clients, client)
				}
			}
			h.mu.RUnlock()

		case <-heartbeat.C:
			hb, _ := json.Marshal(Message{
				Type:      "heartbeat",
				Timestamp: time.Now().UTC().Format(time.RFC3339),
			})
			h.mu.RLock()
			for client := range h.clients {
				select {
				case client.send <- hb:
				default:
				}
			}
			h.mu.RUnlock()
		}
	}
}

// Broadcast sends a message to all connected clients
func (h *Hub) Broadcast(msg Message) {
	data, err := json.Marshal(msg)
	if err != nil {
		log.Printf("ERROR marshaling websocket message: %v", err)
		return
	}
	h.broadcast <- data
}

// Connected returns the number of active clients
func (h *Hub) Connected() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.clients)
}

// Limit per user: max 5 concurrent connections
func (h *Hub) CountByUser(userID string) int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	count := 0
	for c := range h.clients {
		if c.userID == userID {
			count++
		}
	}
	return count
}
```

### 1.4 Client 實作（`internal/websocket/client.go`）

```go
package websocket

import (
	"log"
	"time"

	"github.com/gorilla/websocket"
)

const (
	writeWait      = 10 * time.Second
	pongWait       = 60 * time.Second
	pingPeriod     = (pongWait * 9) / 10
	maxMessageSize = 512
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin:     func(r *http.Request) bool { return true }, // auth handled by middleware
}

// ReadPump reads messages from the WebSocket connection (handles pong/ping + close)
func (c *Client) ReadPump() {
	defer func() {
		c.hub.unregister <- c
		c.conn.Close()
	}()

	c.conn.SetReadLimit(maxMessageSize)
	c.conn.SetReadDeadline(time.Now().Add(pongWait))
	c.conn.SetPongHandler(func(string) error {
		c.conn.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})

	for {
		_, _, err := c.conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseNormalClosure) {
				log.Printf("WebSocket error: %v", err)
			}
			break
		}
		// Client-to-server messages are not expected; ignore
	}
}

// WritePump writes messages from the send channel to the WebSocket connection
func (c *Client) WritePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		c.conn.Close()
	}()

	for {
		select {
		case message, ok := <-c.send:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				// Hub closed the channel
				c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			if err := c.conn.WriteMessage(websocket.TextMessage, message); err != nil {
				return
			}

		case <-ticker.C:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}
```

### 1.5 WebSocket Handler（`internal/handler/websocket_handler.go`）

```go
package handler

import (
	"log"
	"net/http"

	"linux-service-manager/internal/websocket"
)

// HandleStatusWS upgrades HTTP to WebSocket for status push
func (h *Handler) HandleStatusWS(w http.ResponseWriter, r *http.Request) {
	conn, err := websocket.Upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("WebSocket upgrade error: %v", err)
		return
	}

	// Extract user/session info (set by AuthMiddlewareJSON)
	userID := r.Context().Value("username").(string)

	// Enforce per-user connection limit
	if h.Hub.CountByUser(userID) >= 5 {
		conn.WriteMessage(websocket.CloseMessage,
			websocket.FormatCloseMessage(websocket.ClosePolicyViolation, "Too many connections"))
		conn.Close()
		return
	}

	client := &websocket.Client{
		Hub:    h.Hub,
		Conn:   conn,
		Send:   make(chan []byte, 256),
		UserID: userID,
	}

	h.Hub.Register <- client

	go client.WritePump()
	go client.ReadPump()
}
```

### 1.6 D-Bus 狀態監控（`internal/monitor/dbus_monitor.go`）

```go
package monitor

import (
	"log"

	"linux-service-manager/internal/systemd"
	"linux-service-manager/internal/websocket"

	"github.com/godbus/dbus/v5"
)

type DBusMonitor struct {
	hub      *websocket.Hub
	systemd  systemd.ServiceManager
	signalCh chan *dbus.Signal
}

func NewDBusMonitor(hub *websocket.Hub, sm systemd.ServiceManager) (*DBusMonitor, error) {
	conn, err := dbus.SystemBus()
	if err != nil {
		return nil, err
	}

	// Subscribe to PropertiesChanged signals from systemd
	match := "type='signal'," +
		"sender='org.freedesktop.systemd1'," +
		"interface='org.freedesktop.DBus.Properties'," +
		"member='PropertiesChanged'," +
		"path_namespace='/org/freedesktop/systemd1/unit'"

	if err := conn.BusObject().Call(
		"org.freedesktop.DBus.AddMatch", 0, match,
	).Err; err != nil {
		return nil, err
	}

	signalCh := make(chan *dbus.Signal, 64)
	conn.Signal(signalCh)

	return &DBusMonitor{
		hub:      hub,
		systemd:  sm,
		signalCh: signalCh,
	}, nil
}

func (m *DBusMonitor) Start() {
	log.Println("D-Bus monitor started")
	for signal := range m.signalCh {
		// Extract unit path → unit name
		unitPath := string(signal.Path)
		unitName := pathToUnitName(unitPath)

		// Only process .service units
		if !strings.HasSuffix(unitName, ".service") {
			continue
		}

		// Parse PropertiesChanged body → extract ActiveState / SubState
		active, sub, unitFileState := parsePropertiesChanged(signal.Body)

		if active != "" {
			m.hub.Broadcast(websocket.Message{
				Type:          "status_change",
				Name:          unitName,
				Active:        active,
				Sub:           sub,
				UnitFileState: unitFileState,
			})
		}
	}
}

// pathToUnitName converts D-Bus object path to systemd unit name
// e.g. /org/freedesktop/systemd1/unit/nginx_2eservice → nginx.service
func pathToUnitName(path string) string {
	parts := strings.Split(path, "/")
	last := parts[len(parts)-1]
	return systemd.DecodeUnitName(last) // unescape systemd encoding
}

func parsePropertiesChanged(body []interface{}) (active, sub, unitFileState string) {
	// body[1] is map[string]dbus.Variant of changed properties
	if len(body) < 2 {
		return "", "", ""
	}
	props, ok := body[1].(map[string]dbus.Variant)
	if !ok {
		return "", "", ""
	}
	if v, ok := props["ActiveState"]; ok {
		active = v.Value().(string)
	}
	if v, ok := props["SubState"]; ok {
		sub = v.Value().(string)
	}
	if v, ok := props["UnitFileState"]; ok {
		unitFileState = v.Value().(string)
	}
	return
}
```

### 1.7 Polling Fallback（`internal/monitor/polling_monitor.go`）

```go
package monitor

import (
	"log"
	"time"

	"linux-service-manager/internal/systemd"
	"linux-service-manager/internal/websocket"
)

type PollingMonitor struct {
	hub           *websocket.Hub
	systemd       systemd.ServiceManager
	interval      time.Duration
	prevSnapshot  map[string]serviceState
}

type serviceState struct {
	Active        string
	Sub           string
	UnitFileState string
}

func NewPollingMonitor(hub *websocket.Hub, sm systemd.ServiceManager) *PollingMonitor {
	return &PollingMonitor{
		hub:           hub,
		systemd:       sm,
		interval:      5 * time.Second,
		prevSnapshot:  make(map[string]serviceState),
	}
}

func (m *PollingMonitor) Start() {
	log.Println("Polling monitor started (D-Bus fallback)")
	ticker := time.NewTicker(m.interval)
	defer ticker.Stop()

	// Initialize snapshot
	m.takeSnapshot()

	for range ticker.C {
		m.compareAndPush()
	}
}

func (m *PollingMonitor) takeSnapshot() {
	services, err := m.systemd.ListServices()
	if err != nil {
		log.Printf("ERROR polling services: %v", err)
		return
	}
	for _, svc := range services {
		m.prevSnapshot[svc.Name] = serviceState{
			Active:        svc.Active,
			Sub:           svc.Sub,
			UnitFileState: svc.UnitFileState,
		}
	}
}

func (m *PollingMonitor) compareAndPush() {
	services, err := m.systemd.ListServices()
	if err != nil {
		log.Printf("ERROR polling services: %v", err)
		return
	}

	current := make(map[string]serviceState)
	for _, svc := range services {
		current[svc.Name] = serviceState{
			Active:        svc.Active,
			Sub:           svc.Sub,
			UnitFileState: svc.UnitFileState,
		}
	}

	// Detect changes
	for name, state := range current {
		prev, exists := m.prevSnapshot[name]
		if !exists {
			// New service added
			m.hub.Broadcast(websocket.Message{
				Type:          "service_added",
				Name:          name,
				Active:        state.Active,
				Sub:           state.Sub,
				UnitFileState: state.UnitFileState,
			})
		} else if prev != state {
			// State changed
			m.hub.Broadcast(websocket.Message{
				Type:          "status_change",
				Name:          name,
				Active:        state.Active,
				Sub:           state.Sub,
				UnitFileState: state.UnitFileState,
			})
		}
	}

	// Detect removed services
	for name := range m.prevSnapshot {
		if _, exists := current[name]; !exists {
			m.hub.Broadcast(websocket.Message{
				Type: "service_removed",
				Name: name,
			})
		}
	}

	m.prevSnapshot = current
}
```

### 1.8 Monitor 初始化（`internal/monitor/monitor.go`）

```go
package monitor

import (
	"log"

	"linux-service-manager/internal/systemd"
	"linux-service-manager/internal/websocket"
)

// StartMonitor tries D-Bus first, falls back to polling
func StartMonitor(hub *websocket.Hub, sm systemd.ServiceManager) {
	dbusMon, err := NewDBusMonitor(hub, sm)
	if err != nil {
		log.Printf("D-Bus not available: %v — starting polling fallback", err)
		pollMon := NewPollingMonitor(hub, sm)
		go pollMon.Start()
		return
	}
	go dbusMon.Start()
}
```

### 1.9 main.go 改動

```go
// 在 Handler 初始化之後加入：

import (
	"linux-service-manager/internal/monitor"
	"linux-service-manager/internal/websocket"
)

// ...

// 初始化 WebSocket Hub
hub := websocket.NewHub()
hub.OnSnapshot = func() []websocket.ServiceSnapshot {
	services, _ := systemd.DefaultManager{}.ListServices()
	snapshots := make([]websocket.ServiceSnapshot, len(services))
	for i, s := range services {
		snapshots[i] = websocket.ServiceSnapshot{
			Name:          s.Name,
			Active:        s.Active,
			Sub:           s.Sub,
			UnitFileState: s.UnitFileState,
		}
	}
	return snapshots
}
go hub.Run()

// 啟動狀態監控
go monitor.StartMonitor(hub, &systemd.DefaultManager{})

// Handler 需要持有 hub 引用
h.SetHub(hub) // 或在 New() 時傳入

// 註冊 route（在受保護的 group 內）
r.Get("/api/v1/ws", h.HandleStatusWS)
```

---

## 2. 前端實作規格

### 2.1 檔案改動總覽

```
frontend/src/
├── composables/
│   ├── useWebSocket.ts               ← 新增：WebSocket 連線管理 composable
│   └── __tests__/
│       └── useWebSocket.spec.ts      ← 新增：單元測試
├── stores/
│   └── service.ts                    ← 新增：Pinia service store（如尚未獨立）
├── components/
│   └── AppHeader.vue                 ← 修改：加入連線狀態指示器
└── views/
    └── DashboardView.vue             ← 修改：初始化 WebSocket
```

### 2.2 useWebSocket composable（新增）

```typescript
// frontend/src/composables/useWebSocket.ts
import { ref, onUnmounted, readonly } from 'vue'
import { useToast } from './useToast'

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
  const isSupported = ref(true) // browser supports WebSocket?

  let ws: WebSocket | null = null
  let retryCount = 0
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let heartbeatTimer: ReturnType<typeof setTimeout> | null = null
  const maxRetryDelay = 30_000 // 30s

  // Callbacks registered by the consumer
  const handlers = new Map<string, (msg: any) => void>()

  function on(type: string, handler: (msg: any) => void) {
    handlers.set(type, handler)
  }

  function connect() {
    if (!window.WebSocket) {
      isSupported.value = false
      status.value = 'offline'
      return // Fallback: setInterval polling
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
      // Only reconnect on abnormal close (not on intentional logout)
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
    // If no message for 45s, consider disconnected
    heartbeatTimer = setTimeout(() => {
      if (ws) {
        ws.close()
        ws = null
      }
      scheduleReconnect()
    }, 45_000)
  }

  // Auto-connect on creation
  connect()

  // Cleanup on component unmount
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
```

### 2.3 Pinia Service Store 更新

```typescript
// frontend/src/stores/service.ts
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Service } from '@/types/service'

export const useServiceStore = defineStore('service', () => {
  const services = ref<Service[]>([])
  const loading = ref(false)

  // Update a single service from WebSocket status_change message
  function updateService(name: string, updates: Partial<Service>) {
    const idx = services.value.findIndex(s => s.name === name)
    if (idx !== -1) {
      services.value[idx] = { ...services.value[idx], ...updates }
    }
  }

  // Add a new service from service_added message
  function addService(service: Service) {
    if (!services.value.find(s => s.name === service.name)) {
      services.value.push(service)
    }
  }

  // Remove a service from service_removed message
  function removeService(name: string) {
    services.value = services.value.filter(s => s.name !== name)
  }

  // Apply full snapshot (on reconnect)
  function applySnapshot(snapshotServices: Service[]) {
    services.value = snapshotServices
  }

  async function loadServices() {
    loading.value = true
    try {
      const res = await fetch('/api/v1/services')
      services.value = await res.json()
    } finally {
      loading.value = false
    }
  }

  return {
    services,
    loading,
    updateService,
    addService,
    removeService,
    applySnapshot,
    loadServices,
  }
})
```

### 2.4 DashboardView.vue 整合

```vue
<script setup lang="ts">
import { onMounted } from 'vue'
import { useWebSocket } from '@/composables/useWebSocket'
import { useServiceStore } from '@/stores/service'
import { useToast } from '@/composables/useToast'

const store = useServiceStore()
const toast = useToast()
const { status, lastUpdate, isSupported, on } = useWebSocket()

// Register message handlers
on('status_change', (msg) => {
  store.updateService(msg.name, {
    activeState: msg.active,
    subState: msg.sub,
    unitFileState: msg.unitFileState,
  })
})

on('service_added', (msg) => {
  store.addService({
    name: msg.name,
    activeState: msg.active,
    subState: msg.sub,
    unitFileState: msg.unitFileState,
    // Other fields default
  } as any)
  toast.show(`偵測到新服務：${msg.name}`)
})

on('service_removed', (msg) => {
  store.removeService(msg.name)
  toast.show(`服務已移除：${msg.name}`)
})

on('snapshot', (msg) => {
  store.applySnapshot(msg.services.map(s => ({
    name: s.name,
    activeState: s.active,
    subState: s.sub,
    unitFileState: s.unitFileState,
  } as any)))
})

onMounted(async () => {
  await store.loadServices()
})
</script>
```

### 2.5 AppHeader 連線指示器

```vue
<!-- 在 AppHeader.vue template 中新增 -->
<template>
  <header class="app-header">
    <div class="header-left">
      <!-- 既有內容 -->
    </div>
    <div class="header-right">
      <!-- 連線狀態指示器 -->
      <span
        class="connection-indicator"
        :class="connectionClass"
        :title="connectionTitle"
      >
        <template v-if="wsStatus === 'connected'">🔗 已連線</template>
        <template v-else-if="wsStatus === 'connecting'">⟳ 重連中...</template>
        <template v-else>⚠ 離線</template>
      </span>
      <!-- 既有重整按鈕等 -->
    </div>
  </header>
</template>

<script setup lang="ts">
import type { ConnectionStatus } from '@/composables/useWebSocket'

defineProps<{ wsStatus: ConnectionStatus }>()

const connectionClass = computed(() => ({
  'indicator-connected': props.wsStatus === 'connected',
  'indicator-reconnecting': props.wsStatus === 'connecting',
  'indicator-offline': props.wsStatus === 'offline',
}))

const connectionTitle = computed(() => {
  switch (props.wsStatus) {
    case 'connected': return '即時推送運作中'
    case 'connecting': return '正在重新連線...'
    case 'offline': return '即時推送已離線，請手動重整'
  }
})
</script>
```

---

## 3. WebSocket 訊息合約

| 訊息類型 | 方向 | 欄位 | 說明 |
|---------|------|------|------|
| `status_change` | Server → Client | `type`, `name`, `active`, `sub`, `unitFileState` | 單一服務狀態變更，~150 bytes |
| `service_added` | Server → Client | `type`, `name`, `active`, `sub`, `unitFileState` | 系統新增服務 |
| `service_removed` | Server → Client | `type`, `name` | 系統移除服務 |
| `heartbeat` | Server → Client | `type`, `timestamp` | 每 30 秒發送，~50 bytes |
| `snapshot` | Server → Client | `type`, `services[]` | 連線建立/重連後推送完整狀態 |

---

## 4. 資料流

```
┌────────────────────────────────────────────────────┐
│  Browser                                            │
│                                                     │
│  useWebSocket ──→ Pinia store.updateService() ──→  │
│       ▲                                    │        │
│       │                              Vue reactive   │
│       │                                    │        │
│  WebSocket                            ServiceRow    │
│  (wss://)                             re-render     │
│       ▲                                            │
└───────┼────────────────────────────────────────────┘
        │
┌───────┴────────────────────────────────────────────┐
│  Go Backend                                         │
│                                                     │
│  Hub.broadcast() ←── DBusMonitor                    │
│       │                 (PropertiesChanged)         │
│       │              or PollingMonitor               │
│       │                 (systemctl every 5s)        │
│       │                                             │
│  ┌────┴────┐  ┌────┐  ┌────┐  ┌────┐              │
│  │ Client1 │  │ C2 │  │ C3 │  │ C4 │  ...          │
│  └─────────┘  └────┘  └────┘  └────┘              │
└─────────────────────────────────────────────────────┘
```

**關鍵資料流**：
1. 後端監控層（DBus/Polling）偵測變更 → Hub.Broadcast()
2. Hub 發送訊息至所有連線的 WebSocket Client
3. 前端 `useWebSocket.onmessage` → Pinia store action → Vue 響應式更新
4. 自身操作（start/stop/restart）先走 REST POST → 成功後後端推送 → 前端單列更新

---

## 5. 連線生命週期

```
登入 Dashboard
     │
     ▼
 loadServices() ← REST API
     │
     ▼
 new WebSocket('/api/v1/ws')
     │
     ├── 成功 → status='connected' → 接收 status_change / heartbeat / snapshot
     │                                      │
     │                                      ├── heartbeat 正常 → 維持連線
     │                                      ├── 異常中斷 → onclose → 重連
     │                                      └── 登出 → disconnect()
     │
     └── 失敗 → status='connecting' → 3s後重試
                    │
                    ├── 成功 → status='connected'
                    └── 超過30s → status='offline'
```

---

## 6. 邊界條件處理

| 情境 | 處理方式 |
|------|---------|
| **D-Bus 不可用** | 後端自動降級 polling（5s 間隔），前端無感知 |
| **WebSocket 連線失敗** | exponential backoff 重試，30s 後顯示離線 |
| **筆電休眠喚醒** | `onclose` 觸發，自動重連 |
| **多分頁** | 每個分頁獨立連線，後端廣播給所有 |
| **同 session >5 連線** | 後端拒絕第 6 個連線（ClosePolicyViolation） |
| **Heartbeat 超時 45s** | 前端主動關閉連線並重連 |
| **大量服務同時變更** | 前端 100ms debounce 合併 Pinia store 更新 |
| **瀏覽器不支援 WebSocket** | 檢測 `window.WebSocket`，降級為 `setInterval(fetch, 10000)` |
| **Nginx 反向代理** | 需設定 `proxy_set_header Upgrade` + `Connection "upgrade"` |
| **重連後狀態同步** | 後端推送完整 `snapshot`，前端 `applySnapshot()` |

---

## 7. CSS 關鍵樣式

```css
/* 連線狀態指示器 */
.connection-indicator {
  font-size: 0.85rem;
  padding: 2px 10px;
  border-radius: 12px;
}

.indicator-connected {
  color: #2e7d32;
  background: #e8f5e9;
}

.indicator-reconnecting {
  color: #e65100;
  background: #fff3e0;
}

.indicator-offline {
  color: #c62828;
  background: #ffebee;
}

/* 狀態變更 highlight 動畫 */
.service-row.highlight-active {
  animation: flash-green 0.5s ease-in-out;
}
.service-row.highlight-failed {
  animation: flash-red 0.5s ease-in-out;
}
.service-row.highlight-inactive {
  animation: flash-gray 0.5s ease-in-out;
}

@keyframes flash-green {
  0%   { background-color: #c8e6c9; }
  100% { background-color: transparent; }
}
@keyframes flash-red {
  0%   { background-color: #ffcdd2; }
  100% { background-color: transparent; }
}
@keyframes flash-gray {
  0%   { background-color: #eceff1; }
  100% { background-color: transparent; }
}
```

---

## 8. 開發順序

| 步驟 | 內容 | 依賴 |
|------|------|------|
| 1 | 後端：建立 `internal/websocket/` (hub.go + client.go) | - |
| 2 | 後端：建立 `internal/monitor/` (polling_monitor.go) | #1 |
| 3 | 後端：建立 `internal/monitor/dbus_monitor.go` | #1 |
| 4 | 後端：建立 handler `HandleStatusWS` | #1 |
| 5 | 後端：修改 `main.go` 整合 Hub + Monitor + Route | #2, #3, #4 |
| 6 | 前端：建立 `useWebSocket.ts` composable | - |
| 7 | 前端：建立 Pinia `serviceStore`（或擴充既有 store） | - |
| 8 | 前端：修改 `DashboardView.vue` 整合 WebSocket + Store | #6, #7 |
| 9 | 前端：修改 `AppHeader.vue` 加入連線指示器 | #6 |
| 10 | 前端：加入 highlight 動畫 CSS + ServiceRow 邏輯 | #9 |
| 11 | 後端測試：Hub 單元測試 | #1 |
| 12 | 後端測試：Monitor 單元測試 (mock systemd) | #2, #3 |
| 13 | 前端測試：useWebSocket 單元測試（Vitest + mock WebSocket） | #6 |
| 14 | E2E 測試：Playwright（依 BDD scenarios） | #5, #8 |

---

## 9. Nginx 反向代理設定

部署時需確保 Nginx 正確 proxy WebSocket 連線：

```nginx
location /api/v1/ws {
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_read_timeout 86400s;
}
```

---

*最後更新：2025-08-10*
