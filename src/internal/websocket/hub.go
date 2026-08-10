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
	Hub    *Hub
	Conn   *gorilla.Conn
	Send   chan []byte
	UserID string
}

// Hub maintains the set of active clients and broadcasts messages to them.
type Hub struct {
	mu         sync.RWMutex
	Clients    map[*Client]bool
	Broadcast  chan []byte
	Register   chan *Client
	Unregister chan *Client
	OnSnapshot func() []ServiceSnapshot
}

// NewHub creates a new Hub.
func NewHub() *Hub {
	return &Hub{
		Clients:    make(map[*Client]bool),
		Broadcast:  make(chan []byte, 256),
		Register:   make(chan *Client),
		Unregister: make(chan *Client),
	}
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
			h.mu.RLock()
			for client := range h.Clients {
				select {
				case client.Send <- message:
				default:
					close(client.Send)
					delete(h.Clients, client)
				}
			}
			h.mu.RUnlock()
		case <-heartbeat.C:
			hb, _ := json.Marshal(Message{Type: "heartbeat", Timestamp: time.Now().UTC().Format(time.RFC3339)})
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
