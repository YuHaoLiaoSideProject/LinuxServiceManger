package monitor

import (
	"log"

	"linux-service-manager/internal/systemd"
	"linux-service-manager/internal/websocket"
)

// StartMonitor initializes the service status monitor.
// It attempts D-Bus monitoring first; falls back to polling if D-Bus is unavailable.
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
