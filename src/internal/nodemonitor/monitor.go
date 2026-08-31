package nodemonitor

import (
	"context"
	"log"
	"time"

	"linux-service-manager/internal/agentproto"
	"linux-service-manager/internal/noderegistry"
)

const (
	StatusOnline      = "online"
	StatusWarning     = "warning"
	StatusOffline     = "offline"
	StatusLongOffline = "long_offline"
)

// StatusEvent is published when a node's status changes.
type StatusEvent struct {
	NodeID   string `json:"id"`
	NodeName string `json:"name"`
	Status   string `json:"status"`
	Message  string `json:"message,omitempty"`
}

// Config holds configurable thresholds for the monitor.
type Config struct {
	OfflineThreshold     time.Duration // default 30s
	LongOfflineThreshold time.Duration // default 300s
	ScanTick             time.Duration // default 5s
	StartupGrace         time.Duration // default 30s
	Now                  func() time.Time
}

// Monitor watches node heartbeats and transitions states.
type Monitor struct {
	reg     *noderegistry.Registry
	publish func(StatusEvent)
	cfg     Config
	started time.Time
}

// New creates a Monitor with sensible defaults for zero-value Config fields.
func New(reg *noderegistry.Registry, publish func(StatusEvent), cfg Config) *Monitor {
	if cfg.OfflineThreshold == 0 {
		cfg.OfflineThreshold = 30 * time.Second
	}
	if cfg.LongOfflineThreshold == 0 {
		cfg.LongOfflineThreshold = 300 * time.Second
	}
	if cfg.ScanTick == 0 {
		cfg.ScanTick = 5 * time.Second
	}
	if cfg.StartupGrace == 0 {
		cfg.StartupGrace = 30 * time.Second
	}
	if cfg.Now == nil {
		cfg.Now = time.Now
	}
	return &Monitor{
		reg:     reg,
		publish: publish,
		cfg:     cfg,
		started: cfg.Now(),
	}
}

// Run starts the monitoring loop. It ticks at cfg.ScanTick and checks
// node heartbeats. During the startup grace period no events are published.
func (m *Monitor) Run(ctx context.Context) {
	ticker := time.NewTicker(m.cfg.ScanTick)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case now := <-ticker.C:
			// During startup grace period, skip all checks (SYS-MON-10/11).
			if m.cfg.Now().Sub(m.started) < m.cfg.StartupGrace {
				continue
			}
			m.scanNodes(now)
		}
	}
}

// scanNodes iterates all nodes and checks heartbeat freshness.
func (m *Monitor) scanNodes(now time.Time) {
	nodes := m.reg.List()
	for _, node := range nodes {
		switch node.Status {
		case StatusOnline, StatusWarning:
			// online/warning → offline after OfflineThreshold
			if !node.LastHeartbeat.IsZero() && now.Sub(node.LastHeartbeat) > m.cfg.OfflineThreshold {
				// SYS-MON-09: only transition if not already offline
				// Atomically set status and OfflineSince under write lock.
				m.reg.SetOffline(node.ID, now)
				m.publish(StatusEvent{
					NodeID:   node.ID,
					NodeName: node.Name,
					Status:   StatusOffline,
					Message:  "No heartbeat received within threshold",
				})
			}
		case StatusOffline:
			// offline → long_offline after LongOfflineThreshold
			if !node.OfflineSince.IsZero() && now.Sub(node.OfflineSince) > m.cfg.LongOfflineThreshold {
				m.reg.SetRuntimeStatus(node.ID, StatusLongOffline)
				m.publish(StatusEvent{
					NodeID:   node.ID,
					NodeName: node.Name,
					Status:   StatusLongOffline,
					Message:  "Node offline for extended period",
				})
			}
		}
	}
}

// OnHeartbeat is called when a heartbeat is received from an agent.
func (m *Monitor) OnHeartbeat(nodeID string, stats noderegistry.HeartbeatStats) {
	node, ok := m.reg.Get(nodeID)
	if !ok {
		log.Printf("nodemonitor: heartbeat for unknown node %s", nodeID)
		return
	}

	// Check status BEFORE ApplyHeartbeat, since ApplyHeartbeat sets status to "online".
	wasOnline := node.Status == StatusOnline

	m.reg.ApplyHeartbeat(nodeID, stats, m.cfg.Now())

	if !wasOnline {
		// Recovery event: any non-online → online (SYS-MON-07/08)
		m.publish(StatusEvent{
			NodeID:   nodeID,
			NodeName: node.Name,
			Status:   StatusOnline,
		})
	}
	// If already online, just update stats — no event.
}

// OnConnect is called when an agent establishes a connection.
func (m *Monitor) OnConnect(nodeID string, p agentproto.RegisterPayload, minVersion string) {
	node, ok := m.reg.Get(nodeID)
	if !ok {
		log.Printf("nodemonitor: connect for unknown node %s", nodeID)
		return
	}

	// Version compatibility check.
	status := StatusOnline
	msg := ""
	versionCompat := true
	versionMessage := ""
	if minVersion != "" && p.Version < minVersion {
		versionCompat = false
		versionMessage = "Agent version outdated"
		status = StatusWarning
		msg = "Agent version outdated"
	}

	var onlineSince time.Time
	if status == StatusOnline {
		onlineSince = m.cfg.Now()
	}

	// Atomically update all runtime fields under write lock.
	m.reg.UpdateOnlineState(nodeID, p.Hostname, p.Version, status, versionCompat, versionMessage, onlineSince)

	m.publish(StatusEvent{
		NodeID:   nodeID,
		NodeName: node.Name,
		Status:   status,
		Message:  msg,
	})
}

// OnDisconnect is called when an agent disconnects.
func (m *Monitor) OnDisconnect(nodeID string) {
	node, ok := m.reg.Get(nodeID)
	if !ok {
		log.Printf("nodemonitor: disconnect for unknown node %s", nodeID)
		return
	}

	// Atomically set offline status and timestamp under write lock.
	m.reg.SetOffline(nodeID, m.cfg.Now())

	m.publish(StatusEvent{
		NodeID:   nodeID,
		NodeName: node.Name,
		Status:   StatusOffline,
	})
}
