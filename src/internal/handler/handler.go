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
}

// New creates a new Handler with the given template filesystem and systemd manager.
// tplFS may be nil for JSON-only usage (e.g. tests).
func New(tplFS fs.FS, sm systemd.ServiceManager, auditMod *audit.Module, tokenStore *token.Store) *Handler {
	var tmpl *template.Template
	if tplFS != nil {
		tmpl = template.Must(template.ParseFS(tplFS, "index.html", "login.html"))
	}
	return &Handler{tmpl: tmpl, systemd: sm, Audit: auditMod, TokenStore: tokenStore}
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
