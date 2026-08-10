package monitor

import (
	"log"
	"time"

	"linux-service-manager/internal/systemd"
	"linux-service-manager/internal/websocket"
)

type serviceState struct {
	Active        string
	Sub           string
	UnitFileState string
}

// PollingMonitor watches service state changes by periodically polling systemd.
// It is used as a fallback when D-Bus monitoring is not available.
type PollingMonitor struct {
	hub          *websocket.Hub
	systemd      systemd.ServiceManager
	interval     time.Duration
	prevSnapshot map[string]serviceState
}

// NewPollingMonitor creates a new PollingMonitor.
func NewPollingMonitor(hub *websocket.Hub, sm systemd.ServiceManager) *PollingMonitor {
	return &PollingMonitor{
		hub:          hub,
		systemd:      sm,
		interval:     5 * time.Second,
		prevSnapshot: make(map[string]serviceState),
	}
}

// Start begins the polling loop. It should be run in a goroutine.
func (m *PollingMonitor) Start() {
	log.Println("Polling monitor started (D-Bus fallback)")
	m.takeSnapshot()
	ticker := time.NewTicker(m.interval)
	defer ticker.Stop()
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
	for name, state := range current {
		prev, exists := m.prevSnapshot[name]
		if !exists {
			m.hub.BroadcastMessage(websocket.Message{
				Type: "service_added", Name: name,
				Active: state.Active, Sub: state.Sub, UnitFileState: state.UnitFileState,
			})
		} else if prev != state {
			m.hub.BroadcastMessage(websocket.Message{
				Type: "status_change", Name: name,
				Active: state.Active, Sub: state.Sub, UnitFileState: state.UnitFileState,
			})
		}
	}
	for name := range m.prevSnapshot {
		if _, exists := current[name]; !exists {
			m.hub.BroadcastMessage(websocket.Message{Type: "service_removed", Name: name})
		}
	}
	m.prevSnapshot = current
}
