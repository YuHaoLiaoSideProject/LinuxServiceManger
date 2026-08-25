package agentproto

import "encoding/json"

// MessageType for WS messages
type MessageType string

const (
	TypeRegister    MessageType = "register"
	TypeRegisterAck MessageType = "register_ack"
	TypeHeartbeat   MessageType = "heartbeat"
	TypeRPCRequest  MessageType = "rpc_request"
	TypeRPCResponse MessageType = "rpc_response"
)

// Envelope is the unified wrapper for all messages
type Envelope struct {
	Type      MessageType     `json:"type"`
	RequestID string          `json:"request_id,omitempty"`
	Method    string          `json:"method,omitempty"`
	OK        bool            `json:"ok,omitempty"`
	Payload   json.RawMessage `json:"payload,omitempty"`
}

// RegisterPayload - Agent registration info
type RegisterPayload struct {
	NodeName string `json:"node_name"`
	Hostname string `json:"hostname"`
	Version  string `json:"version"`
	OS       string `json:"os"`
}

// RegisterAckPayload - registration response
type RegisterAckPayload struct {
	MinVersion string `json:"min_version"`
	Compatible bool   `json:"compatible"`
}

// HeartbeatPayload - heartbeat with service stats (rule B8)
type HeartbeatPayload struct {
	ServicesTotal   int     `json:"services_total"`
	ServicesRunning int     `json:"services_running"`
	ServicesFailed  int     `json:"services_failed"`
	CPUPercent      float64 `json:"cpu_percent,omitempty"`
	MemoryPercent   float64 `json:"memory_percent,omitempty"`
}

// RPC method constants
const (
	MethodListServices = "services.list"
	MethodStart        = "services.start"
	MethodStop         = "services.stop"
	MethodRestart      = "services.restart"
	MethodEnable       = "services.enable"
	MethodDisable      = "services.disable"
	MethodLogs         = "services.logs"
	MethodSystemInfo   = "system.info"
)
