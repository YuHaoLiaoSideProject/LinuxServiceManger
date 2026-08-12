package websocket

import (
	"encoding/json"
	"log"
	"sync"
	"time"

	gorilla "github.com/gorilla/websocket"
)

// Message represents a WebSocket push message
type Message struct {
	Type          string            `json:"type"`
	Name          string            `json:"name,omitempty"`
	Active        string            `json:"active,omitempty"`
	Sub           string            `json:"sub,omitempty"`
	UnitFileState string            `json:"unitFileState,omitempty"`
	Timestamp     string            `json:"timestamp,omitempty"`
	Services      []ServiceSnapshot `json:"services,omitempty"`
}

// ServiceSnapshot is a lightweight service state snapshot.
type ServiceSnapshot struct {
	Name          string `json:"name"`
	Active        string `json:"active"`
	Sub           string `json:"sub"`
	UnitFileState string `json:"unitFileState"`
}

// Client represents a single WebSocket connection.
type Client struct {
	Hub         *Hub
	Conn        *gorilla.Conn
	Send        chan []byte
	UserID      string
	ConnectedAt time.Time
}

// DefaultSessionTTL is the default session expiry duration for WebSocket connections.
const DefaultSessionTTL = 30 * time.Minute

// Hub maintains the set of active clients and broadcasts messages to them.
type Hub struct {
	mu         sync.RWMutex
	Clients    map[*Client]bool
	Broadcast  chan []byte
	Register   chan *Client
	Unregister chan *Client
	OnSnapshot func() []ServiceSnapshot
	SessionTTL time.Duration // 0 means use DefaultSessionTTL
}

const channelBufferSize = 256

// NewHub creates a new Hub with the default session TTL.
func NewHub() *Hub {
	return &Hub{
		Clients:    make(map[*Client]bool),
		Broadcast:  make(chan []byte, channelBufferSize),
		Register:   make(chan *Client, channelBufferSize),
		Unregister: make(chan *Client, channelBufferSize),
		SessionTTL: DefaultSessionTTL,
	}
}

// ttl returns the effective session TTL, falling back to DefaultSessionTTL if unset.
func (h *Hub) ttl() time.Duration {
	if h.SessionTTL <= 0 {
		return DefaultSessionTTL
	}
	return h.SessionTTL
}

// Run starts the hub event loop. It should be run in a goroutine.
func (h *Hub) Run() {
	heartbeat := time.NewTicker(30 * time.Second)
	defer heartbeat.Stop()
	for {
		select {
		case client := <-h.Register:
			h.mu.Lock()
			h.Clients[client] = true
			h.mu.Unlock()
			if h.OnSnapshot != nil {
				snapshot := h.OnSnapshot()
				msg := Message{Type: "snapshot", Services: snapshot}
				data, _ := json.Marshal(msg)
				client.Send <- data
			}
		case client := <-h.Unregister:
			h.mu.Lock()
			if _, ok := h.Clients[client]; ok {
				delete(h.Clients, client)
				close(client.Send)
			}
			h.mu.Unlock()
		case message := <-h.Broadcast:
			var deadClients []*Client
			h.mu.RLock()
			for client := range h.Clients {
				select {
				case client.Send <- message:
				default:
					deadClients = append(deadClients, client)
				}
			}
			h.mu.RUnlock()
			for _, client := range deadClients {
				h.Unregister <- client
			}
		case <-heartbeat.C:
			now := time.Now()

			// Expire clients connected longer than session TTL
			ttl := h.ttl()
			var expired []*Client
			h.mu.RLock()
			for client := range h.Clients {
				if now.Sub(client.ConnectedAt) > ttl {
					expired = append(expired, client)
				}
			}
			h.mu.RUnlock()

			for _, client := range expired {
				exp, _ := json.Marshal(Message{Type: "session_expired", Timestamp: now.UTC().Format(time.RFC3339)})
				select {
				case client.Send <- exp:
				default:
				}
				h.Unregister <- client
			}

			// Send heartbeat to remaining clients
			hb, _ := json.Marshal(Message{Type: "heartbeat", Timestamp: now.UTC().Format(time.RFC3339)})
			h.mu.RLock()
			for client := range h.Clients {
				select {
				case client.Send <- hb:
				default:
				}
			}
			h.mu.RUnlock()
		}
	}
}

// BroadcastMessage sends a message to all connected clients.
func (h *Hub) BroadcastMessage(msg Message) {
	data, err := json.Marshal(msg)
	if err != nil {
		log.Printf("ERROR marshaling websocket message: %v", err)
		return
	}
	h.Broadcast <- data
}

// BroadcastStatusChange sends a status_change message (active/sub only).
func (h *Hub) BroadcastStatusChange(name, active, sub string) {
	h.BroadcastMessage(Message{
		Type:   "status_change",
		Name:   name,
		Active: active,
		Sub:    sub,
	})
}

// BroadcastOnBootChange sends an on_boot_change message (unitFileState only).
func (h *Hub) BroadcastOnBootChange(name, unitFileState string) {
	h.BroadcastMessage(Message{
		Type:          "on_boot_change",
		Name:          name,
		UnitFileState: unitFileState,
	})
}

// Connected returns the number of connected clients.
func (h *Hub) Connected() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.Clients)
}

// CountByUser returns the number of connections for the given user ID.
func (h *Hub) CountByUser(userID string) int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	count := 0
	for c := range h.Clients {
		if c.UserID == userID {
			count++
		}
	}
	return count
}
