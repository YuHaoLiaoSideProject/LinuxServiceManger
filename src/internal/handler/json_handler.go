package handler

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os/exec"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/gorilla/websocket"

	"linux-service-manager/internal/audit"
	wsutil "linux-service-manager/internal/websocket"
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

// batchRequest is the expected JSON body for POST /api/v1/services/batch.
type batchRequest struct {
	Names  []string `json:"names"`
	Action string   `json:"action"`
}

// batchResponse is the top-level JSON response for POST /api/v1/services/batch.
type batchResponse struct {
	Summary batchSummary  `json:"summary"`
	Results []batchResult `json:"results"`
}

// batchSummary contains aggregated counts.
type batchSummary struct {
	Total   int `json:"total"`
	Success int `json:"success"`
	Failed  int `json:"failed"`
}

// batchResult describes the outcome for a single service.
type batchResult struct {
	Name   string `json:"name"`
	Action string `json:"action"`
	Result string `json:"result"`          // "success" | "failure"
	Error  string `json:"error,omitempty"` // populated only on failure
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

	// Audit log
	if h.Audit != nil {
		entry, entryErr := audit.NewEntry(username, audit.ExtractClientIP(r),
			audit.ActionLogin, "-", audit.ResultSuccess, "")
		if entryErr == nil {
			h.Audit.Write(entry)
		}
	}

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
	username, _ := session.Values["username"].(string)
	session.Values["authenticated"] = false
	session.Options.MaxAge = -1
	auth.SaveSession(w, r, session)

	// Audit log
	if h.Audit != nil {
		entry, entryErr := audit.NewEntry(username, audit.ExtractClientIP(r),
			audit.ActionLogout, "-", audit.ResultSuccess, "")
		if entryErr == nil {
			h.Audit.Write(entry)
		}
	}

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
	err := h.systemd.StartService(name)

	// Audit log
	if h.Audit != nil {
		username, _ := auth.GetSession(r).Values["username"].(string)
		result := audit.ResultSuccess
		detail := ""
		if err != nil {
			result = audit.ResultFailure
			detail = err.Error()
		}
		entry, entryErr := audit.NewEntry(username, audit.ExtractClientIP(r),
			audit.ActionStart, name, result, detail)
		if entryErr == nil {
			h.Audit.Write(entry)
		}
	}

	if err != nil {
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
	err := h.systemd.StopService(name)

	// Audit log
	if h.Audit != nil {
		username, _ := auth.GetSession(r).Values["username"].(string)
		result := audit.ResultSuccess
		detail := ""
		if err != nil {
			result = audit.ResultFailure
			detail = err.Error()
		}
		entry, entryErr := audit.NewEntry(username, audit.ExtractClientIP(r),
			audit.ActionStop, name, result, detail)
		if entryErr == nil {
			h.Audit.Write(entry)
		}
	}

	if err != nil {
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
	err := h.systemd.RestartService(name)

	// Audit log
	if h.Audit != nil {
		username, _ := auth.GetSession(r).Values["username"].(string)
		result := audit.ResultSuccess
		detail := ""
		if err != nil {
			result = audit.ResultFailure
			detail = err.Error()
		}
		entry, entryErr := audit.NewEntry(username, audit.ExtractClientIP(r),
			audit.ActionRestart, name, result, detail)
		if entryErr == nil {
			h.Audit.Write(entry)
		}
	}

	if err != nil {
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
	err := h.systemd.EnableService(name)

	// Audit log
	if h.Audit != nil {
		username, _ := auth.GetSession(r).Values["username"].(string)
		result := audit.ResultSuccess
		detail := ""
		if err != nil {
			result = audit.ResultFailure
			detail = err.Error()
		}
		entry, entryErr := audit.NewEntry(username, audit.ExtractClientIP(r),
			audit.ActionEnable, name, result, detail)
		if entryErr == nil {
			h.Audit.Write(entry)
		}
	}

	if err != nil {
		log.Printf("ERROR enabling %s: %v", name, err)
		writeJSON(w, http.StatusInternalServerError, messageJSON{Error: "failed to enable " + name})
		return
	}

	// Push WebSocket after confirming actual state change
	if h.Hub != nil {
		if state, err := h.systemd.GetUnitFileState(name); err == nil && state != "" {
			h.Hub.BroadcastOnBootChange(name, state)
		}
	}

	writeJSON(w, http.StatusOK, messageJSON{Message: name + " enabled"})
}

// ============================================================
//  POST /api/v1/services/{name}/disable
// ============================================================

func (h *Handler) HandleDisableJSON(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	err := h.systemd.DisableService(name)

	// Audit log
	if h.Audit != nil {
		username, _ := auth.GetSession(r).Values["username"].(string)
		result := audit.ResultSuccess
		detail := ""
		if err != nil {
			result = audit.ResultFailure
			detail = err.Error()
		}
		entry, entryErr := audit.NewEntry(username, audit.ExtractClientIP(r),
			audit.ActionDisable, name, result, detail)
		if entryErr == nil {
			h.Audit.Write(entry)
		}
	}

	if err != nil {
		log.Printf("ERROR disabling %s: %v", name, err)
		writeJSON(w, http.StatusInternalServerError, messageJSON{Error: "failed to disable " + name})
		return
	}

	// Push WebSocket after confirming actual state change
	if h.Hub != nil {
		if state, err := h.systemd.GetUnitFileState(name); err == nil && state != "" {
			h.Hub.BroadcastOnBootChange(name, state)
		}
	}

	writeJSON(w, http.StatusOK, messageJSON{Message: name + " disabled"})
}

// ============================================================
//  GET /api/v1/audit
// ============================================================

// HandleAuditQuery returns paginated audit log entries via JSON.
func (h *Handler) HandleAuditQuery(w http.ResponseWriter, r *http.Request) {
	if h.Audit == nil {
		writeJSON(w, http.StatusInternalServerError, messageJSON{Error: "audit module not initialized"})
		return
	}

	q := r.URL.Query()

	page, _ := strconv.Atoi(q.Get("page"))
	if page < 1 {
		page = 1
	}
	limit, _ := strconv.Atoi(q.Get("limit"))
	search := q.Get("search")
	from := q.Get("from")
	to := q.Get("to")

	// Validate date format (YYYY-MM-DD)
	for _, v := range []struct {
		val, name string
	}{
		{from, "from"},
		{to, "to"},
	} {
		if v.val != "" {
			if _, err := time.Parse("2006-01-02", v.val); err != nil {
				writeJSON(w, http.StatusBadRequest, messageJSON{
					Error: fmt.Sprintf("invalid %s date format, expected YYYY-MM-DD", v.name),
				})
				return
			}
		}
	}

	params := audit.QueryParams{
		Page:   page,
		Limit:  limit,
		Search: search,
		From:   from,
		To:     to,
	}

	result, err := h.Audit.Query(params)
	if err != nil {
		log.Printf("ERROR audit query: %v", err)
		writeJSON(w, http.StatusInternalServerError, messageJSON{Error: "failed to query audit log"})
		return
	}

	writeJSON(w, http.StatusOK, result)
}

// ============================================================
//  GET /api/v1/audit/export
// ============================================================

// HandleAuditExport exports audit log entries as CSV.
func (h *Handler) HandleAuditExport(w http.ResponseWriter, r *http.Request) {
	if h.Audit == nil {
		writeJSON(w, http.StatusInternalServerError, messageJSON{Error: "audit module not initialized"})
		return
	}

	q := r.URL.Query()
	format := q.Get("format")
	if format != "csv" {
		writeJSON(w, http.StatusBadRequest, messageJSON{Error: "format parameter must be 'csv'"})
		return
	}

	search := q.Get("search")
	from := q.Get("from")
	to := q.Get("to")

	// Validate date format (YYYY-MM-DD)
	for _, v := range []struct {
		val, name string
	}{
		{from, "from"},
		{to, "to"},
	} {
		if v.val != "" {
			if _, err := time.Parse("2006-01-02", v.val); err != nil {
				writeJSON(w, http.StatusBadRequest, messageJSON{
					Error: fmt.Sprintf("invalid %s date format, expected YYYY-MM-DD", v.name),
				})
				return
			}
		}
	}

	params := audit.QueryParams{
		Search: search,
		From:   from,
		To:     to,
	}

	filename := fmt.Sprintf("audit-log-%s.csv", time.Now().UTC().Format("2006-01-02"))
	w.Header().Set("Content-Type", "text/csv")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, filename))

	count, err := h.Audit.ExportCSV(w, params)
	if err != nil {
		log.Printf("ERROR audit export: %v", err)
		return
	}
	log.Printf("AUDIT: exported %d entries to CSV", count)
}

// ============================================================
//  POST /api/v1/services/batch
// ============================================================

const (
	maxBatchSize = 50
	batchTimeout = 60 * time.Second
)

var validBatchActions = map[string]bool{
	"start":   true,
	"stop":    true,
	"restart": true,
}

// HandleBatchServices processes a batch service operation request.
// POST /api/v1/services/batch
func (h *Handler) HandleBatchServices(w http.ResponseWriter, r *http.Request) {
	// 1. Decode request body
	var req batchRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, messageJSON{Error: "invalid request body"})
		return
	}

	// 2. Validate: names must not be empty
	if len(req.Names) == 0 {
		writeJSON(w, http.StatusBadRequest, messageJSON{Error: "names must not be empty"})
		return
	}

	// 3. Validate: names count ≤ maxBatchSize
	if len(req.Names) > maxBatchSize {
		writeJSON(w, http.StatusBadRequest, messageJSON{
			Error: "batch size exceeds maximum of 50",
		})
		return
	}

	// 4. Validate: action must be one of {start, stop, restart}
	if !validBatchActions[req.Action] {
		writeJSON(w, http.StatusBadRequest, messageJSON{
			Error: "invalid action, must be start, stop, or restart",
		})
		return
	}

	// 5. Validate: no locked services in names
	services, err := h.systemd.ListServices()
	if err != nil {
		log.Printf("ERROR listing services for batch: %v", err)
		writeJSON(w, http.StatusInternalServerError, messageJSON{Error: "failed to list services"})
		return
	}
	lockedMap := make(map[string]bool, len(services))
	for _, svc := range services {
		if svc.Locked {
			lockedMap[svc.Name] = true
		}
	}
	for _, name := range req.Names {
		if lockedMap[name] {
			writeJSON(w, http.StatusBadRequest, messageJSON{
				Error: "locked service cannot be batch-operated: " + name,
			})
			return
		}
	}

	// 6. Set overall context timeout
	ctx, cancel := context.WithTimeout(r.Context(), batchTimeout)
	defer cancel()

	// 7. Get username for audit log
	username, _ := auth.GetSession(r).Values["username"].(string)
	clientIP := audit.ExtractClientIP(r)

	// 8. Sequential execution: iterate names, call systemd, write audit, collect results
	results := make([]batchResult, 0, len(req.Names))
	successCount := 0
	failedCount := 0

	for _, name := range req.Names {
		// Check context timeout before each operation
		if ctx.Err() != nil {
			results = append(results, batchResult{
				Name:   name,
				Action: req.Action,
				Result: "failure",
				Error:  "batch operation timed out",
			})
			failedCount++
			continue
		}

		// Call systemd manager based on action
		var svcErr error
		switch req.Action {
		case "start":
			svcErr = h.systemd.StartService(name)
		case "stop":
			svcErr = h.systemd.StopService(name)
		case "restart":
			svcErr = h.systemd.RestartService(name)
		}

		// Build result for this service
		if svcErr != nil {
			results = append(results, batchResult{
				Name:   name,
				Action: req.Action,
				Result: "failure",
				Error:  svcErr.Error(),
			})
			failedCount++
		} else {
			results = append(results, batchResult{
				Name:   name,
				Action: req.Action,
				Result: "success",
			})
			successCount++
		}

		// Write audit log (per service, independent)
		if h.Audit != nil {
			result := audit.ResultSuccess
			detail := ""
			if svcErr != nil {
				result = audit.ResultFailure
				detail = svcErr.Error()
			}
			// Map action string to audit.Action
			var auditAction audit.Action
			switch req.Action {
			case "start":
				auditAction = audit.ActionStart
			case "stop":
				auditAction = audit.ActionStop
			case "restart":
				auditAction = audit.ActionRestart
			}
			entry, entryErr := audit.NewEntry(username, clientIP,
				auditAction, name, result, detail)
			if entryErr == nil {
				h.Audit.Write(entry)
			}
		}
	}

	// 9. Return summary + results (always HTTP 200 — partial failure is still a valid response)
	resp := batchResponse{
		Summary: batchSummary{
			Total:   len(req.Names),
			Success: successCount,
			Failed:  failedCount,
		},
		Results: results,
	}
	writeJSON(w, http.StatusOK, resp)
}

// ============================================================
//  WebSocket log streaming (journalctl -f)
// ============================================================

// wsExecCommandContext and wsLookPath are package-level variables to allow mocking in tests.
var wsExecCommandContext = exec.CommandContext
var wsLookPath = exec.LookPath

// wsUpgrader is the WebSocket upgrader for the log streaming endpoint.
var wsUpgrader = websocket.Upgrader{
	CheckOrigin: wsutil.CheckOrigin(),
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
