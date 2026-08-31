package nodeproxy

import (
	"context"
	"encoding/json"
	"fmt"
	"sync/atomic"
	"time"

	"linux-service-manager/internal/agentproto"
)

var rpcCounter uint64

// nextRequestID generates a unique request ID for RPC calls.
func nextRequestID() string {
	id := atomic.AddUint64(&rpcCounter, 1)
	return fmt.Sprintf("rpc-%d-%d", time.Now().UnixNano(), id)
}

// Call sends an RPC request to a node and waits for the response.
// It returns ErrNodeOffline if the node is not connected, ErrInProgress if
// the same operation is already in-flight, or ErrTimeout if the deadline expires.
func (h *Hub) Call(ctx context.Context, nodeID, method string, params, out any, timeout time.Duration) error {
	// Check node is online
	h.mu.RLock()
	_, ok := h.conns[nodeID]
	h.mu.RUnlock()
	if !ok {
		return ErrNodeOffline
	}

	// Build inflight key from method and params
	key := inflightKey{NodeID: nodeID, Action: method}
	if paramsMap, ok := params.(map[string]string); ok {
		key.Service = paramsMap["name"]
		key.Action = method
	}

	// Check singleflight: if same inflightKey already in-flight → ErrInProgress
	h.inflightMu.Lock()
	if _, exists := h.inflight[key]; exists {
		h.inflightMu.Unlock()
		return ErrInProgress
	}
	h.inflight[key] = struct{}{}
	h.inflightMu.Unlock()

	defer func() {
		h.inflightMu.Lock()
		delete(h.inflight, key)
		h.inflightMu.Unlock()
	}()

	// Generate requestID
	requestID := nextRequestID()

	// Marshal params
	var payload json.RawMessage
	if params != nil {
		var err error
		payload, err = json.Marshal(params)
		if err != nil {
			return fmt.Errorf("marshal params: %w", err)
		}
	}

	// Create pending channel (buffered 1)
	pendingCh := make(chan agentproto.Envelope, 1)
	h.pendingSet(requestID, nodeID, pendingCh)

	defer func() {
		h.pendingDelete(requestID)
	}()

	// Send rpc_request envelope
	env := agentproto.Envelope{
		Type:      agentproto.TypeRPCRequest,
		RequestID: requestID,
		Method:    method,
		Payload:   payload,
	}
	if err := h.Send(nodeID, env); err != nil {
		return err
	}

	// Wait for response or timeout
	timer := time.NewTimer(timeout)
	defer timer.Stop()

	select {
	case resp, ok := <-pendingCh:
		if !ok {
			// Channel closed (node disconnected)
			return ErrNodeOffline
		}
		if !resp.OK {
			// Parse error from payload if available
			var errPayload struct {
				Error string `json:"error"`
			}
			if resp.Payload != nil {
				json.Unmarshal(resp.Payload, &errPayload)
			}
			if errPayload.Error != "" {
				return fmt.Errorf("rpc error: %s", errPayload.Error)
			}
			return fmt.Errorf("rpc failed: method %s", method)
		}
		// Unmarshal payload into out if provided
		if out != nil && resp.Payload != nil {
			if err := json.Unmarshal(resp.Payload, out); err != nil {
				return fmt.Errorf("unmarshal response: %w", err)
			}
		}
		return nil

	case <-timer.C:
		return ErrTimeout

	case <-ctx.Done():
		return ctx.Err()
	}
}

// CallAction sends an action RPC (start/stop/restart/enable/disable) to a node.
// Actions use a longer timeout than queries.
func (h *Hub) CallAction(ctx context.Context, nodeID, method, service string) error {
	return h.Call(ctx, nodeID, method, map[string]string{"name": service}, nil, DefaultActionTimeout)
}

// CallQuery sends a query RPC (list/info/logs) to a node and decodes the
// response into out. Queries use a shorter timeout.
func (h *Hub) CallQuery(ctx context.Context, nodeID, method string, params, out any) error {
	return h.Call(ctx, nodeID, method, params, out, DefaultQueryTimeout)
}
