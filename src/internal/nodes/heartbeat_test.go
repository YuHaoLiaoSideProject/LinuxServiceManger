package nodes

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// ============================================================
//  Helpers
// ============================================================

func newHeartbeatHandler(t *testing.T) (*Registry, *HeartbeatHandler, string) {
	t.Helper()
	r := newTestRegistry(t)
	created, err := r.Create(&Node{Name: "web-server-01", Address: "10.0.0.5:8443"})
	if err != nil {
		t.Fatalf("create node: %v", err)
	}
	h := NewHeartbeatHandler(r)
	h.MinInterval = 0 // disable throttling for tests
	return r, h, created.Token
}

func validHeartbeatBody() string {
	return `{"node_name":"web-server-01","agent_version":"1.2.0","hostname":"web-01",` +
		`"os":"Ubuntu 22.04","uptime_seconds":3600,` +
		`"services":{"total":10,"active":8,"failed":2},` +
		`"timestamp":"2025-08-13T10:00:00Z"}`
}

func doHeartbeat(t *testing.T, h *HeartbeatHandler, token, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/agent/heartbeat", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	w := httptest.NewRecorder()
	h.Handle(w, req)
	return w
}

// ============================================================
//  SYS-15: 心跳 token 正確接受並更新 last_heartbeat
// ============================================================

func TestHeartbeat_Accepted(t *testing.T) {
	r, h, tok := newHeartbeatHandler(t)

	w := doHeartbeat(t, h, tok, validHeartbeatBody())
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var body map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("invalid JSON response: %v", err)
	}
	if body["ok"] != true || body["accepted"] != true {
		t.Errorf("expected {ok:true, accepted:true}, got %v", body)
	}
	if r.GetByName("web-server-01").LastHeartbeat == "" {
		t.Error("last_heartbeat not updated after accepted heartbeat")
	}
}

// ============================================================
//  SYS-16: 心跳 token 不符拒絕 → 401
// ============================================================

func TestHeartbeat_WrongToken(t *testing.T) {
	_, h, _ := newHeartbeatHandler(t)

	w := doHeartbeat(t, h, "wrong-token", validHeartbeatBody())
	if w.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", w.Code)
	}
}

// ============================================================
//  SYS-17: 心跳 node_name 不存在拒絕 → 401
// ============================================================

func TestHeartbeat_UnknownNode(t *testing.T) {
	_, h, tok := newHeartbeatHandler(t)

	body := strings.Replace(validHeartbeatBody(), "web-server-01", "ghost-node", 1)
	w := doHeartbeat(t, h, tok, body)
	if w.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", w.Code)
	}
}

// ============================================================
//  SYS-18: 心跳附帶服務統計更新（Aggregate 摘要資料來源）
// ============================================================

func TestHeartbeat_UpdatesServiceStats(t *testing.T) {
	r, h, tok := newHeartbeatHandler(t)

	w := doHeartbeat(t, h, tok, validHeartbeatBody())
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	stats := r.GetByName("web-server-01").ServiceStats
	if stats != (ServiceStats{Total: 10, Active: 8, Failed: 2}) {
		t.Errorf("service_stats mismatch: got %+v, want {10 8 2}", stats)
	}
	if r.GetByName("web-server-01").AgentVersion != "1.2.0" {
		t.Errorf("agent_version not updated: %q", r.GetByName("web-server-01").AgentVersion)
	}
}

// ============================================================
//  SYS-19: 心跳 body 非法 JSON → 400（last_heartbeat 不更新）
// ============================================================

func TestHeartbeat_MalformedBody(t *testing.T) {
	r, h, tok := newHeartbeatHandler(t)

	w := doHeartbeat(t, h, tok, `{not valid json!!!`)
	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
	if r.GetByName("web-server-01").LastHeartbeat != "" {
		t.Error("last_heartbeat must NOT update on malformed body")
	}
}
