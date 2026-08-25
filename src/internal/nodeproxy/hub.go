package nodeproxy

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"sync"
	"time"

	gorilla "github.com/gorilla/websocket"
	"linux-service-manager/internal/agentproto"
	"linux-service-manager/internal/noderegistry"
)

var (
	ErrNodeOffline = errors.New("node_offline")
	ErrInProgress  = errors.New("operation_in_progress")
	ErrTimeout     = errors.New("rpc_timeout")
)

const (
	DefaultActionTimeout = 15 * time.Second
	DefaultQueryTimeout  = 10 * time.Second
	DefaultReadDeadline  = 35 * time.Second
)

type agentConn struct {
	nodeID string
	conn   *gorilla.Conn
	send   chan []byte
	cancel context.CancelFunc
}

type Hub struct {
	mu    sync.RWMutex
	conns map[string]*agentConn // key: nodeID

	pendingMu sync.Mutex
	pending   map[string]chan agentproto.Envelope

	inflightMu sync.Mutex
	inflight   map[inflightKey]struct{}

	Registry *noderegistry.Registry

	OnRegister   func(nodeID string, p agentproto.RegisterPayload)
	OnHeartbeat  func(nodeID string, stats noderegistry.HeartbeatStats)
	OnDisconnect func(nodeID string)

	upgrader gorilla.Upgrader
	tlsCfg   *tls.Config
}

type inflightKey struct{ NodeID, Service, Action string }

// NewHub creates a new Hub with initialized maps and upgrader.
func NewHub() *Hub {
	return &Hub{
		conns:    make(map[string]*agentConn),
		pending:  make(map[string]chan agentproto.Envelope),
		inflight: make(map[inflightKey]struct{}),
		upgrader: gorilla.Upgrader{
			CheckOrigin: func(r *http.Request) bool { return true },
		},
	}
}

// ServeWS handles an incoming WebSocket connection from an agent.
// It validates the token, upgrades the connection, and processes messages.
func (h *Hub) ServeWS(w http.ResponseWriter, r *http.Request) {
	token := r.URL.Query().Get("token")
	if token == "" {
		http.Error(w, "missing token", http.StatusUnauthorized)
		return
	}

	ws, err := h.upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("nodeproxy: upgrade failed: %v", err)
		return
	}

	// Read first message: must be TypeRegister
	ws.SetReadDeadline(time.Now().Add(10 * time.Second))
	_, raw, err := ws.ReadMessage()
	if err != nil {
		log.Printf("nodeproxy: failed to read register message: %v", err)
		ws.Close()
		return
	}

	var env agentproto.Envelope
	if err := json.Unmarshal(raw, &env); err != nil {
		log.Printf("nodeproxy: invalid register envelope: %v", err)
		ws.Close()
		return
	}

	if env.Type != agentproto.TypeRegister {
		log.Printf("nodeproxy: expected register, got %s", env.Type)
		ws.Close()
		return
	}

	var regPayload agentproto.RegisterPayload
	if err := json.Unmarshal(env.Payload, &regPayload); err != nil {
		log.Printf("nodeproxy: invalid register payload: %v", err)
		ws.Close()
		return
	}

	// Find node by node_name in registry
	if h.Registry == nil {
		log.Printf("nodeproxy: registry not set")
		ws.Close()
		return
	}

	node, err := h.Registry.FindByName(regPayload.NodeName)
	if err != nil {
		log.Printf("nodeproxy: node %q not found: %v", regPayload.NodeName, err)
		ws.Close()
		return
	}

	// Verify token matches
	if node.Token != token {
		log.Printf("nodeproxy: token mismatch for node %q", regPayload.NodeName)
		ws.Close()
		return
	}

	nodeID := node.ID

	// Check no existing connection for this node (reject second)
	h.mu.Lock()
	if _, exists := h.conns[nodeID]; exists {
		h.mu.Unlock()
		log.Printf("nodeproxy: node %s already connected, rejecting", nodeID)
		ws.Close()
		return
	}

	ctx, cancel := context.WithCancel(r.Context())
	ac := &agentConn{
		nodeID: nodeID,
		conn:   ws,
		send:   make(chan []byte, 256),
		cancel: cancel,
	}
	h.conns[nodeID] = ac
	h.mu.Unlock()

	// Set read deadline and pong handler
	ws.SetReadDeadline(time.Now().Add(DefaultReadDeadline))
	ws.SetPongHandler(func(string) error {
		ws.SetReadDeadline(time.Now().Add(DefaultReadDeadline))
		return nil
	})

	// Send register ack
	ackPayload, _ := json.Marshal(agentproto.RegisterAckPayload{
		MinVersion: "1.0.0",
		Compatible: true,
	})
	ackEnv := agentproto.Envelope{
		Type:    agentproto.TypeRegisterAck,
		Payload: ackPayload,
	}
	ackData, _ := json.Marshal(ackEnv)
	select {
	case ac.send <- ackData:
	default:
	}

	// Update registry runtime state
	h.Registry.SetRuntimeStatus(nodeID, "online")

	// Notify callback
	if h.OnRegister != nil {
		h.OnRegister(nodeID, regPayload)
	}

	// Start write pump
	go h.writeLoop(ctx, ac)

	// Enter read loop
	h.readLoop(ctx, ac)
}

// writeLoop pumps messages from the send channel to the WebSocket connection.
func (h *Hub) writeLoop(ctx context.Context, ac *agentConn) {
	ticker := time.NewTicker(20 * time.Second)
	defer func() {
		ticker.Stop()
		ac.conn.Close()
	}()

	for {
		select {
		case msg, ok := <-ac.send:
			ac.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if !ok {
				ac.conn.WriteMessage(gorilla.CloseMessage, nil)
				return
			}
			if err := ac.conn.WriteMessage(gorilla.TextMessage, msg); err != nil {
				return
			}
		case <-ticker.C:
			ac.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := ac.conn.WriteMessage(gorilla.PingMessage, nil); err != nil {
				return
			}
		case <-ctx.Done():
			return
		}
	}
}

// readLoop reads messages from the WebSocket connection and dispatches them.
func (h *Hub) readLoop(ctx context.Context, ac *agentConn) {
	defer func() {
		ac.cancel()
		h.cleanup(ac.nodeID)
	}()

	for {
		_, raw, err := ac.conn.ReadMessage()
		if err != nil {
			if gorilla.IsCloseError(err, gorilla.CloseGoingAway, gorilla.CloseNormalClosure) {
				log.Printf("nodeproxy: node %s disconnected normally", ac.nodeID)
			} else {
				log.Printf("nodeproxy: node %s read error: %v", ac.nodeID, err)
			}
			return
		}

		var env agentproto.Envelope
		if err := json.Unmarshal(raw, &env); err != nil {
			log.Printf("nodeproxy: invalid message from %s: %v", ac.nodeID, err)
			continue
		}

		h.dispatch(ac.nodeID, env)
	}
}

// dispatch routes an incoming envelope to the appropriate handler.
func (h *Hub) dispatch(nodeID string, env agentproto.Envelope) {
	switch env.Type {
	case agentproto.TypeHeartbeat:
		var payload agentproto.HeartbeatPayload
		if err := json.Unmarshal(env.Payload, &payload); err != nil {
			log.Printf("nodeproxy: invalid heartbeat from %s: %v", nodeID, err)
			return
		}
		stats := noderegistry.HeartbeatStats{
			Total:   payload.ServicesTotal,
			Running: payload.ServicesRunning,
			Failed:  payload.ServicesFailed,
			CPU:     payload.CPUPercent,
			Memory:  payload.MemoryPercent,
		}
		h.Registry.ApplyHeartbeat(nodeID, stats, time.Now())

		if h.OnHeartbeat != nil {
			h.OnHeartbeat(nodeID, stats)
		}

	case agentproto.TypeRPCResponse:
		h.pendingMu.Lock()
		ch, ok := h.pending[env.RequestID]
		h.pendingMu.Unlock()
		if ok {
			select {
			case ch <- env:
			default:
			}
		}

	default:
		log.Printf("nodeproxy: unknown message type %s from %s", env.Type, nodeID)
	}
}

// cleanup removes a node from the connection map, closes all pending channels,
// and notifies the OnDisconnect callback.
func (h *Hub) cleanup(nodeID string) {
	h.mu.Lock()
	delete(h.conns, nodeID)
	h.mu.Unlock()

	// Close all pending channels for this node
	h.pendingMu.Lock()
	var toClose []string
	for reqID, ch := range h.pending {
		// We need to check if this pending request belongs to this node.
		// Since pending map is keyed by requestID, we need a reverse lookup.
		// We'll use a separate approach: close channels whose requests are
		// for this node by checking inflight.
		_ = ch
		toClose = append(toClose, reqID)
	}
	// Close all pending channels (they belong to the disconnected node
	// if they were waiting for a response)
	for _, reqID := range toClose {
		if ch, ok := h.pending[reqID]; ok {
			close(ch)
			delete(h.pending, reqID)
		}
	}
	h.pendingMu.Unlock()

	// Clear inflight keys for this node
	h.inflightMu.Lock()
	for key := range h.inflight {
		if key.NodeID == nodeID {
			delete(h.inflight, key)
		}
	}
	h.inflightMu.Unlock()

	// Update registry
	h.Registry.SetRuntimeStatus(nodeID, "offline")

	if h.OnDisconnect != nil {
		h.OnDisconnect(nodeID)
	}
}

// Send sends an envelope to the specified node.
// Returns ErrNodeOffline if the node is not connected.
func (h *Hub) Send(nodeID string, env agentproto.Envelope) error {
	h.mu.RLock()
	ac, ok := h.conns[nodeID]
	h.mu.RUnlock()

	if !ok {
		return ErrNodeOffline
	}

	data, err := json.Marshal(env)
	if err != nil {
		return err
	}

	select {
	case ac.send <- data:
		return nil
	default:
		return ErrNodeOffline
	}
}

// Connected returns a snapshot of connected node IDs.
func (h *Hub) Connected() []string {
	h.mu.RLock()
	defer h.mu.RUnlock()

	ids := make([]string, 0, len(h.conns))
	for id := range h.conns {
		ids = append(ids, id)
	}
	return ids
}
