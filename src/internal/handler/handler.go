package handler

import (
	"html/template"
	"io/fs"
	"log"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	gw "github.com/gorilla/websocket"

	"linux-service-manager/internal/audit"
	"linux-service-manager/internal/auth"
	"linux-service-manager/internal/notify"
	"linux-service-manager/internal/systemd"
	"linux-service-manager/internal/token"
	"linux-service-manager/internal/websocket"
)

// Handler holds the parsed templates and systemd manager.
type Handler struct {
	tmpl       *template.Template
	systemd    systemd.ServiceManager
	Hub        *websocket.Hub
	Audit      *audit.Module
	TokenStore *token.Store
	Config     systemd.ConfigAPI // service config store（GET/PUT/validate config API）
	Notify     *notify.Notifier  // webhook 通知模組（由 main.go/測試指派）
}

// New creates a new Handler with the given template filesystem and systemd manager.
// tplFS may be nil for JSON-only usage (e.g. tests).
func New(tplFS fs.FS, sm systemd.ServiceManager, auditMod *audit.Module, tokenStore *token.Store) *Handler {
	var tmpl *template.Template
	if tplFS != nil {
		tmpl = template.Must(template.ParseFS(tplFS, "index.html", "login.html"))
	}
	return &Handler{tmpl: tmpl, systemd: sm, Audit: auditMod, TokenStore: tokenStore, Config: systemd.NewConfigStore()}
}

// HandleIndex serves the full HTML page.
func (h *Handler) HandleIndex(w http.ResponseWriter, r *http.Request) {
	services, err := h.systemd.ListServices()
	if err != nil {
		log.Printf("ERROR listing services: %v", err)
		http.Error(w, "Failed to list services", http.StatusInternalServerError)
		return
	}

	session := auth.GetSession(r)
	username, _ := session.Values["username"].(string)

	data := map[string]interface{}{
		"Services": services,
		"Username": username,
	}

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	if err := h.tmpl.ExecuteTemplate(w, "page", data); err != nil {
		log.Printf("ERROR rendering template: %v", err)
	}
}

// HandleServices returns only the table rows (for htmx AJAX refresh).
func (h *Handler) HandleServices(w http.ResponseWriter, r *http.Request) {
	services, err := h.systemd.ListServices()
	if err != nil {
		log.Printf("ERROR listing services: %v", err)
		http.Error(w, "Failed to list services", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	if err := h.tmpl.ExecuteTemplate(w, "rows", map[string]interface{}{
		"Services": services,
	}); err != nil {
		log.Printf("ERROR rendering rows: %v", err)
	}
}

// HandleLoginPage serves the login form.
func (h *Handler) HandleLoginPage(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	h.tmpl.ExecuteTemplate(w, "login", nil)
}

// HandleLogin processes the login form submission.
func (h *Handler) HandleLogin(w http.ResponseWriter, r *http.Request) {
	r.ParseForm()
	username := r.FormValue("username")
	password := r.FormValue("password")

	if !auth.Login(username, password) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write([]byte(`<div class="error">帳號或密碼錯誤</div>`))
		return
	}

	session := auth.GetSession(r)
	session.Values["authenticated"] = true
	session.Values["username"] = username
	auth.SaveSession(w, r, session)

	w.Header().Set("HX-Redirect", "/")
}

// HandleLogout clears the session and redirects to login.
func (h *Handler) HandleLogout(w http.ResponseWriter, r *http.Request) {
	session := auth.GetSession(r)
	session.Values["authenticated"] = false
	session.Options.MaxAge = -1
	auth.SaveSession(w, r, session)
	http.Redirect(w, r, "/login", http.StatusFound)
}

// HandleStart starts a systemd service.
func (h *Handler) HandleStart(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	err := h.systemd.StartService(name)
	h.respondWithFlash(w, name, "啟動", err)
}

// HandleStop stops a systemd service.
func (h *Handler) HandleStop(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	err := h.systemd.StopService(name)
	h.respondWithFlash(w, name, "停止", err)
}

// HandleRestart restarts a systemd service.
func (h *Handler) HandleRestart(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	err := h.systemd.RestartService(name)
	h.respondWithFlash(w, name, "重啟", err)
}

// HandleStatusWS upgrades an HTTP connection to WebSocket and registers
// the client with the hub for real-time status push notifications.
// @Summary 服務狀態即時推送（WebSocket）
// @Description 升級為 WebSocket 並即時推送服務狀態變更。**連線後不須傳入任何訊息** — 伺服器於狀態變更時主動推送快照（JSON：`{name, active, sub, unitFileState}`），連線建立時亦推送完整快照。\n\n**認證**：支援自訂 header 的 ws 客戶端請帶 `Authorization: Bearer` header；瀏覽器原生 WebSocket 需 session cookie。\n**限制**：每個 user 最多 5 個連線，超過回 close 1008（policy violation）。
// @Tags WebSocket
// @Security BearerAuth
// @Success 101 "Switching Protocols（之後為服務狀態快照 JSON TextMessage）"
// @Failure 401 {object} messageJSON "未驗證"
// @Router /ws [get]
func (h *Handler) HandleStatusWS(w http.ResponseWriter, r *http.Request) {
	conn, err := websocket.Upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("WebSocket upgrade error: %v", err)
		return
	}
	userID := "unknown"
	session := auth.GetSession(r)
	if username, ok := session.Values["username"].(string); ok {
		userID = username
	}

	if h.Hub.CountByUser(userID) >= 5 {
		conn.WriteMessage(gw.CloseMessage,
			gw.FormatCloseMessage(gw.ClosePolicyViolation, "Too many connections"))
		conn.Close()
		return
	}

	client := &websocket.Client{
		Hub:         h.Hub,
		Conn:        conn,
		Send:        make(chan []byte, 256),
		UserID:      userID,
		ConnectedAt: time.Now(),
	}
	h.Hub.Register <- client
	go client.WritePump()
	go client.ReadPump()
}

// respondWithFlash renders the updated rows and an OOB flash message.
func (h *Handler) respondWithFlash(w http.ResponseWriter, name, action string, err error) {
	var flashType, flashMsg string
	if err != nil {
		flashType = "error"
		flashMsg = name + " " + action + "失敗"
	} else {
		flashType = "success"
		flashMsg = name + " 已成功" + action
	}

	services, listErr := h.systemd.ListServices()
	if listErr != nil {
		log.Printf("ERROR listing services: %v", listErr)
	}

	w.Header().Set("Content-Type", "text/html; charset=utf-8")

	// Write rows first, then flash OOB.
	// Order matters: if the OOB div comes first, whitespace between it and
	// the <tr> elements can leak into <tbody> and break table layout.
	h.tmpl.ExecuteTemplate(w, "rows", map[string]interface{}{
		"Services": services,
	})

	flashHTML := `<div id="flash-container" hx-swap-oob="true"><div class="flash flash-` + flashType + `">` + flashMsg + `</div></div>`
	w.Write([]byte(flashHTML))
}
