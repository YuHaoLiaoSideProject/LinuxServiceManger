package noderegistry

import (
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"sync"
	"time"
)

// generateNodeID produces a cryptographically random node ID.
// Falls back to timestamp-based ID if crypto/rand fails.
func generateNodeID() string {
	b := make([]byte, 16)
	_, err := rand.Read(b)
	if err != nil {
		// fallback to timestamp
		return fmt.Sprintf("node-%d", time.Now().UnixNano())
	}
	return fmt.Sprintf("node-%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:])
}

var (
	ErrDuplicateName = errors.New("node name already exists")
	ErrMaxNodes      = errors.New("maximum of 50 nodes")
	ErrNotFound      = errors.New("node not found")
	ErrInvalidJSON   = errors.New("corrupted nodes.json")
)

const MaxNodes = 50

type Node struct {
	// Persistent fields (saved to nodes.json)
	// SECURITY NOTE: Token is stored in plaintext. The file is written with 0600
	// permissions (owner-only read/write) and should reside under /var/lib/ which
	// is typically root-owned. If the server process is compromised, tokens are
	// exposed. For higher security, consider mTLS or JWT-signed agent auth.
	ID             string `json:"id"`
	Name           string `json:"name"`
	Address        string `json:"address"`
	TLSFingerprint string `json:"tls_fingerprint,omitempty"`
	Token          string `json:"token"`
	Note           string `json:"note,omitempty"`

	// Runtime state (NOT persisted, refreshed by Agent reconnection)
	Status         string        `json:"-"`
	Hostname       string        `json:"-"`
	AgentVersion   string        `json:"-"`
	VersionCompat  bool          `json:"-"`
	VersionMessage string        `json:"-"`
	LastHeartbeat  time.Time     `json:"-"`
	LastOnlineAt   time.Time     `json:"-"`
	OfflineSince   time.Time     `json:"-"`
	OnlineSince    time.Time     `json:"-"`
	HeartbeatStats HeartbeatStats `json:"-"`
}

type HeartbeatStats struct {
	Total   int     `json:"total"`
	Running int     `json:"running"`
	Failed  int     `json:"failed"`
	CPU     float64 `json:"cpu,omitempty"`
	Memory  float64 `json:"mem,omitempty"`
}

type AddRequest struct {
	Name, Address, TLSFingerprint, Token, Note string
}

type UpdateRequest struct {
	Name, Address, TLSFingerprint, Token, Note *string
}

type Registry struct {
	mu    sync.RWMutex
	path  string
	nodes map[string]*Node
	now   func() time.Time
}

// LoadRegistry creates a new Registry by reading from the given file path.
// If the file doesn't exist, it returns an empty registry.
// If the file exists but contains invalid JSON, it returns ErrInvalidJSON.
func LoadRegistry(path string) (*Registry, error) {
	r := &Registry{
		path:  path,
		nodes: make(map[string]*Node),
		now:   time.Now,
	}

	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return r, nil
		}
		return nil, err
	}

	var nodes []*Node
	if err := json.Unmarshal(data, &nodes); err != nil {
		return nil, ErrInvalidJSON
	}

	for _, n := range nodes {
		r.nodes[n.ID] = n
	}

	return r, nil
}

// Add creates a new node with the given request and persists it.
// Returns ErrDuplicateName if a node with the same name already exists.
// Returns ErrMaxNodes if the maximum number of nodes has been reached.
func (r *Registry) Add(req AddRequest) (*Node, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	// Check name uniqueness
	for _, n := range r.nodes {
		if n.Name == req.Name {
			return nil, ErrDuplicateName
		}
	}

	// Check max nodes
	if len(r.nodes) >= MaxNodes {
		return nil, ErrMaxNodes
	}

	node := &Node{
		ID:             generateNodeID(),
		Name:           req.Name,
		Address:        req.Address,
		TLSFingerprint: req.TLSFingerprint,
		Token:          req.Token,
		Note:           req.Note,
	}

	r.nodes[node.ID] = node

	if err := r.persist(); err != nil {
		return nil, err
	}

	return node, nil
}

// Update modifies an existing node identified by id with the given request.
// Returns ErrNotFound if the node doesn't exist.
// Returns ErrDuplicateName if the new name conflicts with another node.
func (r *Registry) Update(id string, req UpdateRequest) (*Node, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	node, exists := r.nodes[id]
	if !exists {
		return nil, ErrNotFound
	}

	// Apply non-nil fields
	if req.Name != nil {
		// Check name uniqueness if name is changing
		if *req.Name != node.Name {
			for _, n := range r.nodes {
				if n.ID != id && n.Name == *req.Name {
					return nil, ErrDuplicateName
				}
			}
			node.Name = *req.Name
		}
	}

	if req.Address != nil {
		node.Address = *req.Address
	}

	if req.TLSFingerprint != nil {
		node.TLSFingerprint = *req.TLSFingerprint
	}

	if req.Token != nil {
		node.Token = *req.Token
	}

	if req.Note != nil {
		node.Note = *req.Note
	}

	if err := r.persist(); err != nil {
		return nil, err
	}

	return node, nil
}

// Remove deletes a node identified by id and persists the change.
// Returns ErrNotFound if the node doesn't exist.
func (r *Registry) Remove(id string) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	if _, exists := r.nodes[id]; !exists {
		return ErrNotFound
	}

	delete(r.nodes, id)

	return r.persist()
}

// Get returns a node by id and whether it was found.
func (r *Registry) Get(id string) (*Node, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	node, exists := r.nodes[id]
	return node, exists
}

// List returns a snapshot of all nodes.
func (r *Registry) List() []Node {
	r.mu.RLock()
	defer r.mu.RUnlock()

	nodes := make([]Node, 0, len(r.nodes))
	for _, n := range r.nodes {
		nodes = append(nodes, *n)
	}
	return nodes
}

// Count returns the number of nodes.
func (r *Registry) Count() int {
	r.mu.RLock()
	defer r.mu.RUnlock()

	return len(r.nodes)
}

// FindByName returns the node with the given name, or ErrNotFound.
func (r *Registry) FindByName(name string) (*Node, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	for _, n := range r.nodes {
		if n.Name == name {
			return n, nil
		}
	}
	return nil, ErrNotFound
}

// SetRuntimeStatus sets the runtime status of a node.
// This is not persisted to disk.
func (r *Registry) SetRuntimeStatus(id, status string) {
	r.mu.Lock()
	defer r.mu.Unlock()

	node, exists := r.nodes[id]
	if !exists {
		return
	}
	node.Status = status
}

// ApplyHeartbeat updates the heartbeat stats and timestamps for a node.
// If the current status is not "online", it sets the status to "online"
// and updates OnlineSince. This is not persisted to disk.
func (r *Registry) ApplyHeartbeat(id string, stats HeartbeatStats, at time.Time) {
	r.mu.Lock()
	defer r.mu.Unlock()

	node, exists := r.nodes[id]
	if !exists {
		return
	}

	node.LastHeartbeat = at
	node.HeartbeatStats = stats

	if node.Status != "online" {
		node.Status = "online"
		node.OnlineSince = at
	}
}

// UpdateOnlineState atomically updates a node's runtime state for connect events.
// Fields with zero values are skipped (use time.Time{} to skip OnlineSince).
func (r *Registry) UpdateOnlineState(id, hostname, version, status string, versionCompat bool, versionMessage string, onlineSince time.Time) {
	r.mu.Lock()
	defer r.mu.Unlock()

	node, exists := r.nodes[id]
	if !exists {
		return
	}

	if hostname != "" {
		node.Hostname = hostname
	}
	if version != "" {
		node.AgentVersion = version
	}
	node.Status = status
	node.VersionCompat = versionCompat
	node.VersionMessage = versionMessage
	if !onlineSince.IsZero() {
		node.OnlineSince = onlineSince
	}
}

// SetOffline atomically transitions a node to offline status.
func (r *Registry) SetOffline(id string, offlineSince time.Time) {
	r.mu.Lock()
	defer r.mu.Unlock()

	node, exists := r.nodes[id]
	if !exists {
		return
	}
	node.Status = "offline"
	node.OfflineSince = offlineSince
}

// persist writes the nodes to disk atomically.
// It writes to a temporary file first, then renames it to the target path.
// File mode 0600 ensures only the process owner can read/write the file
// (which contains node tokens in plaintext).
func (r *Registry) persist() error {
	nodes := make([]*Node, 0, len(r.nodes))
	for _, n := range r.nodes {
		nodes = append(nodes, n)
	}

	data, err := json.MarshalIndent(nodes, "", "  ")
	if err != nil {
		return err
	}

	tmpPath := r.path + ".tmp"
	const fileMode = 0600 // owner-only: protect node tokens stored in plaintext
	if err := os.WriteFile(tmpPath, data, fileMode); err != nil {
		return err
	}

	// Ensure the target file also has strict permissions (in case it was
	// created previously with more permissive mode).
	if err := os.Rename(tmpPath, r.path); err != nil {
		os.Remove(tmpPath)
		return err
	}
	os.Chmod(r.path, fileMode) // best-effort; ignore error on read-only filesystems

	return nil
}
