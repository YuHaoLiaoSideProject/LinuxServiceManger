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
				m.reg.SetRuntimeStatus(node.ID, StatusOffline)
				// Fetch the updated node for OfflineSince
				if n, ok := m.reg.Get(node.ID); ok {
					n.OfflineSince = now
				}
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

	// Update runtime info from payload.
	node.Hostname = p.Hostname
	node.AgentVersion = p.Version

	// Version compatibility check.
	status := StatusOnline
	msg := ""
	if minVersion != "" && p.Version < minVersion {
		node.VersionCompat = false
		node.VersionMessage = "Agent version outdated"
		status = StatusWarning
		msg = "Agent version outdated"
	} else {
		node.VersionCompat = true
		node.VersionMessage = ""
	}

	// Set status (any non-online → online is recovery, SYS-MON-07/08).
	node.Status = status
	if status == StatusOnline {
		node.OnlineSince = m.cfg.Now()
	}

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

	now := m.cfg.Now()
	node.Status = StatusOffline
	node.OfflineSince = now

	m.publish(StatusEvent{
		NodeID:   nodeID,
		NodeName: node.Name,
		Status:   StatusOffline,
	})
}
