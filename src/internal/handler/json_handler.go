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
	"linux-service-manager/internal/auth"
	"linux-service-manager/internal/middleware"
	"linux-service-manager/internal/systemd"
	"linux-service-manager/internal/token"
	wsutil "linux-service-manager/internal/websocket"
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

// extractUsername returns the acting user for audit logging.
// It tries token name first (Bearer auth), then falls back to session username.
func extractUsername(r *http.Request) string {
	if name, ok := r.Context().Value(middleware.CtxKeyTokenName).(string); ok && name != "" {
		return "token:" + name
	}
	session := auth.GetSession(r)
	if username, ok := session.Values["username"].(string); ok && username != "" {
		return username
	}
	return "unknown"
}

// ============================================================
//  POST /api/v1/login
// ============================================================

// HandleLoginJSON 以帳號密碼登入並建立 session cookie。
// @Summary 登入
// @Description 以帳號密碼登入（form-urlencoded）。成功後設定 `session` cookie；亦有 rate limit（每 IP 每分鐘 5 次嘗試）。
// @Tags Auth
// @Accept x-www-form-urlencoded
// @Produce json
// @Param username formData string true "使用者名稱"
// @Param password formData string true "密碼"
// @Success 200 {object} map[string]interface{} "{username, message}"
// @Failure 400 {object} messageJSON "缺少帳號或密碼"
// @Failure 401 {object} messageJSON "帳號或密碼錯誤"
// @Router /login [post]
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

	// P-6: Prevent Session Fixation — destroy old session, then create a
	// brand-new session so the Session ID rotates upon successful login.
	oldSession := auth.GetSession(r)
	oldSession.Options.MaxAge = -1
	auth.SaveSession(w, r, oldSession)

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

// HandleLogoutJSON 登出並清除 session cookie。
// @Summary 登出
// @Description 登出並清除 session cookie。
// @Tags Auth
// @Produce json
// @Success 200 {object} messageJSON
// @Router /logout [post]
func (h *Handler) HandleLogoutJSON(w http.ResponseWriter, r *http.Request) {
	session := auth.GetSession(r)
	username, _ := session.Values["username"].(string)
	session.Values["authenticated"] = false
	session.Options.MaxAge = -1
	auth.SaveSession(w, r, session)

	// Terminate all WebSocket connections for this user so they cannot
	// continue receiving real-time updates after session invalidation.
	if h.Hub != nil && username != "" {
		h.Hub.KillByUser(username)
	}

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

// HandleSessionCheck 檢查目前 session 是否已登入。
// @Summary 檢查 session 狀態
// @Description 檢查目前 session 是否已登入（不需驗證）。
// @Tags Auth
// @Produce json
// @Success 200 {object} sessionJSON
// @Router /session [get]
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

// HandleServicesJSON 取得所有 systemd 服務列表。
// @Summary 取得服務列表
// @Description 取得所有 systemd 服務列表（名稱、Active/Sub 狀態、開機狀態、鎖定標記等）。`read` scope Token 可用。
// @Tags Services
// @Produce json
// @Security BearerAuth
// @Success 200 {array} serviceJSON
// @Failure 401 {object} messageJSON "未驗證"
// @Failure 500 {object} messageJSON "取得服務列表失敗"
// @Router /services [get]
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

// HandleStartJSON 啟動指定服務。
// @Summary 啟動服務
// @Description 啟動指定 systemd 服務。需 `full` scope Token。
// @Tags Services
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param name path string true "服務名稱（systemd unit name）"
// @Success 200 {object} messageJSON "{message: \"<name> started\"}"
// @Failure 401 {object} messageJSON "未驗證"
// @Failure 403 {object} messageJSON "唯讀 Token 權限不足"
// @Failure 500 {object} messageJSON "啟動失敗"
// @Router /services/{name}/start [post]
func (h *Handler) HandleStartJSON(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	err := h.systemd.StartService(r.Context(), name)

	// Audit log
	if h.Audit != nil {
		username := extractUsername(r)
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

// HandleStopJSON 停止指定服務。
// @Summary 停止服務
// @Description 停止指定 systemd 服務。需 `full` scope Token。
// @Tags Services
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param name path string true "服務名稱（systemd unit name）"
// @Success 200 {object} messageJSON
// @Failure 401 {object} messageJSON "未驗證"
// @Failure 403 {object} messageJSON "唯讀 Token 權限不足"
// @Failure 500 {object} messageJSON "停止失敗"
// @Router /services/{name}/stop [post]
func (h *Handler) HandleStopJSON(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	err := h.systemd.StopService(r.Context(), name)

	// Audit log
	if h.Audit != nil {
		username := extractUsername(r)
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

// HandleRestartJSON 重啟指定服務。
// @Summary 重啟服務
// @Description 重啟指定 systemd 服務。需 `full` scope Token。
// @Tags Services
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param name path string true "服務名稱（systemd unit name）"
// @Success 200 {object} messageJSON
// @Failure 401 {object} messageJSON "未驗證"
// @Failure 403 {object} messageJSON "唯讀 Token 權限不足"
// @Failure 500 {object} messageJSON "重啟失敗"
// @Router /services/{name}/restart [post]
func (h *Handler) HandleRestartJSON(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	err := h.systemd.RestartService(r.Context(), name)

	// Audit log
	if h.Audit != nil {
		username := extractUsername(r)
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

// HandleEnableJSON 啟用指定服務（開機自動啟動）。
// @Summary 啟用服務
// @Description 啟用指定服務（開機自動啟動，systemctl enable）。需 `full` scope Token。
// @Tags Services
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param name path string true "服務名稱（systemd unit name）"
// @Success 200 {object} messageJSON
// @Failure 401 {object} messageJSON "未驗證"
// @Failure 403 {object} messageJSON "唯讀 Token 權限不足"
// @Failure 500 {object} messageJSON "啟用失敗"
// @Router /services/{name}/enable [post]
func (h *Handler) HandleEnableJSON(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	err := h.systemd.EnableService(name)

	// Audit log
	if h.Audit != nil {
		username := extractUsername(r)
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

// HandleDisableJSON 停用指定服務（取消開機自動啟動）。
// @Summary 停用服務
// @Description 停用指定服務（取消開機自動啟動，systemctl disable）。需 `full` scope Token。
// @Tags Services
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param name path string true "服務名稱（systemd unit name）"
// @Success 200 {object} messageJSON
// @Failure 401 {object} messageJSON "未驗證"
// @Failure 403 {object} messageJSON "唯讀 Token 權限不足"
// @Failure 500 {object} messageJSON "停用失敗"
// @Router /services/{name}/disable [post]
func (h *Handler) HandleDisableJSON(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	err := h.systemd.DisableService(name)

	// Audit log
	if h.Audit != nil {
		username := extractUsername(r)
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

// HandleAuditQuery 查詢稽核日誌（分頁、搜尋、時間範圍）。
// @Summary 查詢稽核日誌
// @Description 分頁查詢稽核日誌。支援全文搜尋與日期範圍（YYYY-MM-DD）。`read` scope Token 可用。
// @Tags Audit
// @Produce json
// @Security BearerAuth
// @Param page query int false "頁碼（預設 1）" default(1)
// @Param limit query int false "每頁筆數（預設 30，上限 100）" default(30)
// @Param search query string false "全文搜尋關鍵字"
// @Param from query string false "起始日期 YYYY-MM-DD"
// @Param to query string false "結束日期 YYYY-MM-DD"
// @Success 200 {object} audit.QueryResult
// @Failure 400 {object} messageJSON "日期格式錯誤"
// @Failure 401 {object} messageJSON "未驗證"
// @Failure 500 {object} messageJSON "查詢失敗"
// @Router /audit [get]
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

// HandleAuditExport 匯出稽核日誌為 CSV 檔案。
// @Summary 匯出稽核日誌（CSV）
// @Description 依條件匯出稽核日誌為 CSV 檔案（Content-Disposition attachment）。`read` scope Token 可用。
// @Tags Audit
// @Produce plain
// @Security BearerAuth
// @Param format query string true "必須為 csv"
// @Param search query string false "全文搜尋關鍵字"
// @Param from query string false "起始日期 YYYY-MM-DD"
// @Param to query string false "結束日期 YYYY-MM-DD"
// @Success 200 {string} string "CSV 檔案內容"
// @Failure 400 {object} messageJSON "format 非 csv 或日期格式錯誤"
// @Failure 401 {object} messageJSON "未驗證"
// @Router /audit/export [get]
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

// HandleBatchServices 批次操作多個服務。
// @Summary 批次操作服務
// @Description 對多個服務執行 start/stop/restart（最多 50 個）。鎖定服務會被拒絕。部分失敗仍回 200，以 per-service result 表示。需 `full` scope Token。
// @Tags Services
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param body body batchRequest true "批次操作請求"
// @Success 200 {object} batchResponse
// @Failure 400 {object} messageJSON "請求無效（含鎖定服務）"
// @Failure 401 {object} messageJSON "未驗證"
// @Failure 403 {object} messageJSON "唯讀 Token 權限不足"
// @Failure 500 {object} messageJSON "取得服務列表失敗"
// @Router /services/batch [post]
func (h *Handler) HandleBatchServices(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20) // 1MB limit

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

	// 4.5. Validate all service names
	for _, name := range req.Names {
		if err := systemd.ValidateServiceName(name); err != nil {
			writeJSON(w, http.StatusBadRequest, messageJSON{Error: err.Error()})
			return
		}
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
	username := extractUsername(r)
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

		// Call systemd manager based on action — pass the batch context so
		// the subprocess is killed when the overall deadline expires.
		var svcErr error
		switch req.Action {
		case "start":
			svcErr = h.systemd.StartService(ctx, name)
		case "stop":
			svcErr = h.systemd.StopService(ctx, name)
		case "restart":
			svcErr = h.systemd.RestartService(ctx, name)
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

// HandleServiceLogsWS 以 WebSocket 串流服務即時日誌（journalctl -f）。
// @Summary 即時日誌串流（WebSocket）
// @Description 升級為 WebSocket 並串流指定服務的 journalctl 即時日誌（每行一個 TextMessage）。\n\n**認證**：支援自訂 header 的 ws 客戶端請帶 `Authorization: Bearer` header；瀏覽器原生 WebSocket 需 session cookie。\n**錯誤**：連線後若啟動 journalctl 失敗，會收到 `{"error":"..."}` TextMessage。\n\nclient 斷線即取消 journalctl 程序。
// @Tags Logs
// @Security BearerAuth
// @Param name path string true "服務名稱（systemd unit name）"
// @Param lines query int false "起始行數（預設 100，上限 1000）" default(100)
// @Success 101 "Switching Protocols（之後每行一個 JSON TextMessage）"
// @Failure 400 {object} messageJSON "lines 超出範圍或服務名稱無效"
// @Failure 401 {object} messageJSON "未驗證"
// @Failure 500 {object} messageJSON "journalctl 不可用"
// @Router /services/{name}/logs/ws [get]
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
		if strings.Contains(err.Error(), "permission denied") {
			conn.WriteMessage(websocket.TextMessage,
				[]byte(`{"error":"permission denied: user lacks journalctl access"}`))
		} else {
			conn.WriteMessage(websocket.TextMessage,
				[]byte(`{"error":"failed to start journalctl"}`))
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

// ============================================================
//  Token handlers
// ============================================================

// tokenListResponse wraps token list for JSON response.
type tokenListResponse struct {
	Data []token.TokenResponse `json:"data"`
}

// HandleListTokens 列出所有 API Token。
// @Summary 列出 API Tokens
// @Description 列出所有 API Token（遮罩值、狀態、scope）。**僅限 session 登入**（Token 不可管理 Token）。
// @Tags Tokens
// @Produce json
// @Success 200 {object} tokenListResponse
// @Failure 401 {object} messageJSON "未驗證"
// @Router /tokens [get]
func (h *Handler) HandleListTokens(w http.ResponseWriter, r *http.Request) {
	if h.TokenStore == nil {
		writeJSON(w, http.StatusInternalServerError, messageJSON{Error: "token store not initialized"})
		return
	}

	tokens := h.TokenStore.List()
	writeJSON(w, http.StatusOK, tokenListResponse{Data: tokens})
}

// HandleCreateToken 建立新的 API Token。
// @Summary 建立 API Token
// @Description 建立 API Token，原始值**僅在此回應揭露一次**（不儲存）。**僅限 session 登入**。名稱不區分大小寫唯一，最多 20 個 active Token。
// @Tags Tokens
// @Accept json
// @Produce json
// @Param body body token.CreateTokenInput true "建立請求（expires_in_days: -1=永不過期, 1-365=N 天, 0=自訂日期需帶 custom_expiry）"
// @Success 201 {object} token.CreateTokenResponse "含原始 token（一次性）"
// @Failure 400 {object} messageJSON "驗證失敗或達上限"
// @Failure 401 {object} messageJSON "未驗證"
// @Failure 409 {object} messageJSON "名稱重複"
// @Router /tokens [post]
func (h *Handler) HandleCreateToken(w http.ResponseWriter, r *http.Request) {
	if h.TokenStore == nil {
		writeJSON(w, http.StatusInternalServerError, messageJSON{Error: "token store not initialized"})
		return
	}

	var input token.CreateTokenInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeJSON(w, http.StatusBadRequest, messageJSON{Error: "invalid request body"})
		return
	}

	resp, err := h.TokenStore.Create(input)
	if err != nil {
		msg, _ := token.IsTokenError(err)
		if msg == "" {
			log.Printf("ERROR creating token: %v", err)
			writeJSON(w, http.StatusInternalServerError, messageJSON{Error: "建立失敗，請稍後重試"})
			return
		}
		// Map specific errors to status codes
		status := http.StatusBadRequest
		if msg == token.ErrNameDuplicate.Error() {
			status = http.StatusConflict
		}
		writeJSON(w, status, messageJSON{Error: msg})
		return
	}

	// Audit log
	if h.Audit != nil {
		username := extractUsername(r)
		entry, entryErr := audit.NewEntry(username, audit.ExtractClientIP(r),
			audit.ActionTokenCreate, resp.Name, audit.ResultSuccess, "")
		if entryErr == nil {
			h.Audit.Write(entry)
		}
	}

	writeJSON(w, http.StatusCreated, resp)
}

// HandleRevokeToken 撤銷指定 API Token。
// @Summary 撤銷 API Token
// @Description 撤銷指定 API Token（冪等 — 已撤銷回傳 200 `already_revoked`）。撤銷後使用該 Token 的請求立即回 401。**僅限 session 登入**。
// @Tags Tokens
// @Produce json
// @Param id path string true "Token ID（UUID）"
// @Success 200 {object} token.RevokeResponse
// @Failure 401 {object} messageJSON "未驗證"
// @Failure 404 {object} messageJSON "Token 不存在"
// @Router /tokens/{id}/revoke [post]
func (h *Handler) HandleRevokeToken(w http.ResponseWriter, r *http.Request) {
	if h.TokenStore == nil {
		writeJSON(w, http.StatusInternalServerError, messageJSON{Error: "token store not initialized"})
		return
	}

	id := chi.URLParam(r, "id")
	if id == "" {
		writeJSON(w, http.StatusBadRequest, messageJSON{Error: "token ID is required"})
		return
	}

	status, err := h.TokenStore.Revoke(id)
	if err != nil {
		msg, _ := token.IsTokenError(err)
		if msg == token.ErrNotFound.Error() {
			writeJSON(w, http.StatusNotFound, messageJSON{Error: msg})
			return
		}
		log.Printf("ERROR revoking token %s: %v", id, err)
		writeJSON(w, http.StatusInternalServerError, messageJSON{Error: "撤銷失敗，請重試"})
		return
	}

	// Audit log
	if h.Audit != nil {
		username := extractUsername(r)
		// Find token name for audit
		tokenName := id
		list := h.TokenStore.List()
		for _, t := range list {
			if t.ID == id {
				tokenName = t.Name
				break
			}
		}
		entry, entryErr := audit.NewEntry(username, audit.ExtractClientIP(r),
			audit.ActionTokenRevoke, tokenName, audit.ResultSuccess, "")
		if entryErr == nil {
			h.Audit.Write(entry)
		}
	}

	writeJSON(w, http.StatusOK, token.RevokeResponse{
		Message: "Token 已撤銷",
		Status:  status,
	})
}
