package monitor

import (
	"log"
	"strings"

	"linux-service-manager/internal/systemd"
	"linux-service-manager/internal/websocket"

	"github.com/godbus/dbus/v5"
)

// DBusMonitor listens for systemd D-Bus PropertiesChanged signals
// and broadcasts status changes via the WebSocket hub.
type DBusMonitor struct {
	hub     *websocket.Hub
	systemd systemd.ServiceManager
	conn    *dbus.Conn
}

// NewDBusMonitor creates a new DBusMonitor and subscribes to systemd signals.
func NewDBusMonitor(hub *websocket.Hub, sm systemd.ServiceManager) (*DBusMonitor, error) {
	conn, err := dbus.SystemBus()
	if err != nil {
		return nil, err
	}
	match := "type='signal'," +
		"sender='org.freedesktop.systemd1'," +
		"interface='org.freedesktop.DBus.Properties'," +
		"member='PropertiesChanged'," +
		"path_namespace='/org/freedesktop/systemd1/unit'"
	if err := conn.BusObject().Call("org.freedesktop.DBus.AddMatch", 0, match).Err; err != nil {
		conn.Close()
		return nil, err
	}
	return &DBusMonitor{hub: hub, systemd: sm, conn: conn}, nil
}

// Start begins listening for D-Bus signals. It should be run in a goroutine.
func (m *DBusMonitor) Start() {
	log.Println("D-Bus monitor started")
	signalCh := make(chan *dbus.Signal, 64)
	m.conn.Signal(signalCh)
	for signal := range signalCh {
		unitPath := string(signal.Path)
		unitName := pathToUnitName(unitPath)
		if !strings.HasSuffix(unitName, ".service") {
			continue
		}
		active, sub, unitFileState := parsePropertiesChanged(signal.Body)
		if active != "" || unitFileState != "" {
			m.hub.BroadcastMessage(websocket.Message{
				Type: "status_change", Name: unitName,
				Active: active, Sub: sub, UnitFileState: unitFileState,
			})
		}
	}
}

// pathToUnitName converts a systemd D-Bus object path to a unit name.
// e.g. /org/freedesktop/systemd1/unit/nginx_2eservice → nginx.service
func pathToUnitName(path string) string {
	parts := strings.Split(path, "/")
	last := parts[len(parts)-1]
	// Unescape systemd's encoding: _2e → ., _2d → -, etc.
	decoded := strings.ReplaceAll(last, "_2e", ".")
	decoded = strings.ReplaceAll(decoded, "_2d", "-")
	decoded = strings.ReplaceAll(decoded, "_40", "@")
	decoded = strings.ReplaceAll(decoded, "_3a", ":")
	decoded = strings.ReplaceAll(decoded, "_5f", "_")
	return decoded
}

// parsePropertiesChanged extracts ActiveState, SubState, and UnitFileState
// from a D-Bus PropertiesChanged signal body.
func parsePropertiesChanged(body []interface{}) (active, sub, unitFileState string) {
	if len(body) < 2 {
		return "", "", ""
	}
	props, ok := body[1].(map[string]dbus.Variant)
	if !ok {
		return "", "", ""
	}
	if v, ok := props["ActiveState"]; ok {
		if s, ok2 := v.Value().(string); ok2 {
			active = s
		}
	}
	if v, ok := props["SubState"]; ok {
		if s, ok2 := v.Value().(string); ok2 {
			sub = s
		}
	}
	if v, ok := props["UnitFileState"]; ok {
		if s, ok2 := v.Value().(string); ok2 {
			unitFileState = s
		}
	}
	return
}
