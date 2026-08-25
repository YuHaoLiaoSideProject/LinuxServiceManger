package agentproto

import (
	"encoding/json"
	"testing"
)

func TestEnvelopeMarshalUnmarshalRoundtrip(t *testing.T) {
	original := Envelope{
		Type:      TypeRPCRequest,
		RequestID: "req-123",
		Method:    MethodListServices,
		OK:        true,
		Payload:   json.RawMessage(`{"key":"value"}`),
	}

	data, err := json.Marshal(original)
	if err != nil {
		t.Fatalf("Marshal failed: %v", err)
	}

	var decoded Envelope
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("Unmarshal failed: %v", err)
	}

	if decoded.Type != original.Type {
		t.Errorf("Type: got %q, want %q", decoded.Type, original.Type)
	}
	if decoded.RequestID != original.RequestID {
		t.Errorf("RequestID: got %q, want %q", decoded.RequestID, original.RequestID)
	}
	if decoded.Method != original.Method {
		t.Errorf("Method: got %q, want %q", decoded.Method, original.Method)
	}
	if decoded.OK != original.OK {
		t.Errorf("OK: got %v, want %v", decoded.OK, original.OK)
	}
	if string(decoded.Payload) != string(original.Payload) {
		t.Errorf("Payload: got %s, want %s", decoded.Payload, original.Payload)
	}
}

func TestEnvelopeOmitempty(t *testing.T) {
	// Minimal envelope (no optional fields)
	min := Envelope{Type: TypeHeartbeat}
	data, err := json.Marshal(min)
	if err != nil {
		t.Fatalf("Marshal failed: %v", err)
	}

	// Should not contain request_id, method, ok, or payload keys
	s := string(data)
	for _, key := range []string{"request_id", "method", "ok", "payload"} {
		if contains := jsonKeyExists(data, key); contains {
			t.Errorf("expected key %q to be absent from JSON, got: %s", key, s)
		}
	}
}

func TestRegisterPayloadJSONTags(t *testing.T) {
	p := RegisterPayload{
		NodeName: "node-1",
		Hostname: "host.example.com",
		Version:  "1.0.0",
		OS:       "linux",
	}

	data, err := json.Marshal(p)
	if err != nil {
		t.Fatalf("Marshal failed: %v", err)
	}

	var raw map[string]json.RawMessage
	if err := json.Unmarshal(data, &raw); err != nil {
		t.Fatalf("Unmarshal to map failed: %v", err)
	}

	expected := []string{"node_name", "hostname", "version", "os"}
	for _, key := range expected {
		if _, ok := raw[key]; !ok {
			t.Errorf("expected JSON key %q, keys: %v", key, keysOf(raw))
		}
	}
}

func TestHeartbeatPayloadOptionalFields(t *testing.T) {
	// Without optional cpu/mem fields
	h := HeartbeatPayload{
		ServicesTotal:   10,
		ServicesRunning: 8,
		ServicesFailed:  2,
	}

	data, err := json.Marshal(h)
	if err != nil {
		t.Fatalf("Marshal failed: %v", err)
	}

	var raw map[string]json.RawMessage
	if err := json.Unmarshal(data, &raw); err != nil {
		t.Fatalf("Unmarshal to map failed: %v", err)
	}

	// cpu_percent and memory_percent should be absent when zero
	if _, ok := raw["cpu_percent"]; ok {
		t.Error("expected cpu_percent to be absent when zero (omitempty)")
	}
	if _, ok := raw["memory_percent"]; ok {
		t.Error("expected memory_percent to be absent when zero (omitempty)")
	}

	// Required fields should always be present
	for _, key := range []string{"services_total", "services_running", "services_failed"} {
		if _, ok := raw[key]; !ok {
			t.Errorf("expected required key %q to be present", key)
		}
	}

	// Now with optional fields set
	h2 := HeartbeatPayload{
		ServicesTotal:   10,
		ServicesRunning: 8,
		ServicesFailed:  2,
		CPUPercent:      45.5,
		MemoryPercent:   72.3,
	}
	data2, err := json.Marshal(h2)
	if err != nil {
		t.Fatalf("Marshal (with optional) failed: %v", err)
	}

	var raw2 map[string]json.RawMessage
	if err := json.Unmarshal(data2, &raw2); err != nil {
		t.Fatalf("Unmarshal (with optional) to map failed: %v", err)
	}
	if _, ok := raw2["cpu_percent"]; !ok {
		t.Error("expected cpu_percent to be present when non-zero")
	}
	if _, ok := raw2["memory_percent"]; !ok {
		t.Error("expected memory_percent to be present when non-zero")
	}
}

func TestMessageTypeConstants(t *testing.T) {
	tests := []struct {
		name     string
		got      MessageType
		expected string
	}{
		{"TypeRegister", TypeRegister, "register"},
		{"TypeRegisterAck", TypeRegisterAck, "register_ack"},
		{"TypeHeartbeat", TypeHeartbeat, "heartbeat"},
		{"TypeRPCRequest", TypeRPCRequest, "rpc_request"},
		{"TypeRPCResponse", TypeRPCResponse, "rpc_response"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if string(tt.got) != tt.expected {
				t.Errorf("%s = %q, want %q", tt.name, string(tt.got), tt.expected)
			}
		})
	}
}

func TestMethodConstants(t *testing.T) {
	tests := []struct {
		name     string
		got      string
		expected string
	}{
		{"MethodListServices", MethodListServices, "services.list"},
		{"MethodStart", MethodStart, "services.start"},
		{"MethodStop", MethodStop, "services.stop"},
		{"MethodRestart", MethodRestart, "services.restart"},
		{"MethodEnable", MethodEnable, "services.enable"},
		{"MethodDisable", MethodDisable, "services.disable"},
		{"MethodLogs", MethodLogs, "services.logs"},
		{"MethodSystemInfo", MethodSystemInfo, "system.info"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.got != tt.expected {
				t.Errorf("%s = %q, want %q", tt.name, tt.got, tt.expected)
			}
		})
	}
}

// helpers

func jsonKeyExists(data []byte, key string) bool {
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(data, &raw); err != nil {
		return false
	}
	_, ok := raw[key]
	return ok
}

func keysOf(m map[string]json.RawMessage) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	return keys
}
