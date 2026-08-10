package handler

import (
	"bufio"
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os/exec"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/gorilla/websocket"

	"linux-service-manager/internal/auth"
	"linux-service-manager/internal/systemd"
)

// ============================================================
//  JSON API response types
// ============================================================

type serviceJSON struct {
	Name          string `json:"name"`
	Load          string `json:"load"`
	Active        string `json:"active"`
	Sub           string `json:"sub"`
	Locked        bool   `json:"locked"`
	UnitFileState string `json:"unitFileState"`
	FragmentPath  string `json:"fragmentPath"`
}

type messageJSON struct {
	Message string `json:"message,omitempty"`
	Error   string `json:"error,omitempty"`
}

type sessionJSON struct {
	Authenticated bool   `json:"authenticated"`
	Username      string `json:"username,omitempty"`
}

// ============================================================
//  Helpers
// ============================================================

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

// ============================================================
//  POST /api/v1/login
// ============================================================

func (h *Handler) HandleLoginJSON(w http.ResponseWriter, r *http.Request) {
	r.ParseForm()
	username := r.FormValue("username")
	password := r.FormValue("password")

	if username == "" || password == "" {
		writeJSON(w, http.StatusBadRequest, messageJSON{Error: "username and password are required"})
		return
	}

	if !auth.Login(username, password) {
		writeJSON(w, http.StatusUnauthorized, messageJSON{Error: "invalid credentials"})
		return
	}

	session := auth.GetSession(r)
	session.Values["authenticated"] = true
	session.Values["username"] = username
	auth.SaveSession(w, r, session)

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"username": username,
		"message":  "login successful",
	})
}

// ============================================================
//  POST /api/v1/logout
// ============================================================

func (h *Handler) HandleLogoutJSON(w http.ResponseWriter, r *http.Request) {
	session := auth.GetSession(r)
	session.Values["authenticated"] = false
	session.Options.MaxAge = -1
	auth.SaveSession(w, r, session)

	writeJSON(w, http.StatusOK, messageJSON{Message: "logged out"})
}

// ============================================================
//  GET /api/v1/session
// ============================================================

func (h *Handler) HandleSessionCheck(w http.ResponseWriter, r *http.Request) {
	session := auth.GetSession(r)
	authenticated, _ := session.Values["authenticated"].(bool)
	username, _ := session.Values["username"].(string)

	writeJSON(w, http.StatusOK, sessionJSON{
		Authenticated: authenticated,
		Username:      username,
	})
}

// ============================================================
//  GET /api/v1/services
// ============================================================

func (h *Handler) HandleServicesJSON(w http.ResponseWriter, r *http.Request) {
	services, err := h.systemd.ListServices()
	if err != nil {
		log.Printf("ERROR listing services: %v", err)
		writeJSON(w, http.StatusInternalServerError, messageJSON{Error: "failed to list services"})
		return
	}

	result := make([]serviceJSON, 0, len(services))
	for _, svc := range services {
		result = append(result, serviceJSON{
			Name:          svc.Name,
			Load:          svc.Load,
			Active:        svc.Active,
			Sub:           svc.Sub,
			Locked:        svc.Locked,
			UnitFileState: svc.UnitFileState,
			FragmentPath:  svc.FragmentPath,
		})
	}

	writeJSON(w, http.StatusOK, result)
}

// ============================================================
//  POST /api/v1/services/{name}/start
// ============================================================

func (h *Handler) HandleStartJSON(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	if err := h.systemd.StartService(name); err != nil {
		log.Printf("ERROR starting %s: %v", name, err)
		writeJSON(w, http.StatusInternalServerError, messageJSON{Error: "failed to start " + name})
		return
	}

	writeJSON(w, http.StatusOK, messageJSON{Message: name + " started"})
}

// ============================================================
//  POST /api/v1/services/{name}/stop
// ============================================================

func (h *Handler) HandleStopJSON(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	if err := h.systemd.StopService(name); err != nil {
		log.Printf("ERROR stopping %s: %v", name, err)
		writeJSON(w, http.StatusInternalServerError, messageJSON{Error: "failed to stop " + name})
		return
	}

	writeJSON(w, http.StatusOK, messageJSON{Message: name + " stopped"})
}

// ============================================================
//  POST /api/v1/services/{name}/restart
// ============================================================

func (h *Handler) HandleRestartJSON(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	if err := h.systemd.RestartService(name); err != nil {
		log.Printf("ERROR restarting %s: %v", name, err)
		writeJSON(w, http.StatusInternalServerError, messageJSON{Error: "failed to restart " + name})
		return
	}

	writeJSON(w, http.StatusOK, messageJSON{Message: name + " restarted"})
}

// ============================================================
//  POST /api/v1/services/{name}/enable
// ============================================================

func (h *Handler) HandleEnableJSON(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	if err := h.systemd.EnableService(name); err != nil {
		log.Printf("ERROR enabling %s: %v", name, err)
		writeJSON(w, http.StatusInternalServerError, messageJSON{Error: "failed to enable " + name})
		return
	}

	writeJSON(w, http.StatusOK, messageJSON{Message: name + " enabled"})
}

// ============================================================
//  POST /api/v1/services/{name}/disable
// ============================================================

func (h *Handler) HandleDisableJSON(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	if err := h.systemd.DisableService(name); err != nil {
		log.Printf("ERROR disabling %s: %v", name, err)
		writeJSON(w, http.StatusInternalServerError, messageJSON{Error: "failed to disable " + name})
		return
	}

	writeJSON(w, http.StatusOK, messageJSON{Message: name + " disabled"})
}

// ============================================================
//  WebSocket log streaming (journalctl -f)
// ============================================================

// wsExecCommandContext and wsLookPath are package-level variables to allow mocking in tests.
var wsExecCommandContext = exec.CommandContext
var wsLookPath = exec.LookPath

// wsUpgrader is the WebSocket upgrader for the log streaming endpoint.
var wsUpgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

// HandleServiceLogsWS handles WebSocket connections for streaming service logs.
// It runs journalctl -f and pipes stdout line-by-line to the WebSocket client.
func (h *Handler) HandleServiceLogsWS(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")

	// 1. Parse lines query param (default 100, max 1000)
	linesStr := r.URL.Query().Get("lines")
	lines := 100
	if linesStr != "" {
		var err error
		lines, err = strconv.Atoi(linesStr)
		if err != nil || lines < 1 || lines > 1000 {
			writeJSON(w, http.StatusBadRequest, messageJSON{
				Error: "lines must be between 1 and 1000",
			})
			return
		}
	}

	// 2. Validate service name
	if err := systemd.ValidateServiceName(name); err != nil {
		writeJSON(w, http.StatusBadRequest, messageJSON{Error: err.Error()})
		return
	}

	// 3. Check journalctl exists
	if _, err := wsLookPath("journalctl"); err != nil {
		writeJSON(w, http.StatusInternalServerError, messageJSON{
			Error: "journalctl not found: system does not support journalctl",
		})
		return
	}

	// 4. Upgrade HTTP → WebSocket
	conn, err := wsUpgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("ERROR upgrading WebSocket for %s: %v", name, err)
		return
	}
	defer conn.Close()

	// 5. Start journalctl -f (follow mode)
	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()

	cmd := wsExecCommandContext(ctx,
		"journalctl", "_SYSTEMD_UNIT="+name,
		"-n", strconv.Itoa(lines),
		"-f",
		"--no-pager",
		"-o", "short-iso",
	)

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		log.Printf("ERROR creating stdout pipe for %s: %v", name, err)
		conn.WriteMessage(websocket.TextMessage, []byte(`{"error":"failed to start journalctl"}`))
		return
	}

	if err := cmd.Start(); err != nil {
		log.Printf("ERROR starting journalctl for %s: %v", name, err)
		errMsg := err.Error()
		if strings.Contains(errMsg, "permission denied") {
			conn.WriteMessage(websocket.TextMessage,
				[]byte(`{"error":"permission denied: user lacks journalctl access"}`))
		} else {
			conn.WriteMessage(websocket.TextMessage,
				[]byte(`{"error":"`+errMsg+`"}`))
		}
		return
	}

	// 6. Read journalctl stdout line by line, push via WebSocket
	scanner := bufio.NewScanner(stdout)
	for scanner.Scan() {
		line := scanner.Bytes()
		if err := conn.WriteMessage(websocket.TextMessage, line); err != nil {
			// Client disconnected → break loop → cancel ctx → kill journalctl
			log.Printf("INFO WebSocket write error for %s (client disconnected): %v", name, err)
			break
		}
	}

	// 7. Wait for journalctl to exit
	if err := cmd.Wait(); err != nil {
		if ctx.Err() != context.Canceled {
			log.Printf("ERROR journalctl for %s exited: %v", name, err)
		}
	}
}
