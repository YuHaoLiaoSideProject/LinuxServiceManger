package handler

import (
	"encoding/json"
	"log"
	"net/http"

	"github.com/go-chi/chi/v5"

	"linux-service-manager/internal/auth"
)

// ============================================================
//  JSON API response types
// ============================================================

type serviceJSON struct {
	Name   string `json:"name"`
	Load   string `json:"load"`
	Active string `json:"active"`
	Sub    string `json:"sub"`
	Locked bool   `json:"locked"`
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
			Name:   svc.Name,
			Load:   svc.Load,
			Active: svc.Active,
			Sub:    svc.Sub,
			Locked: svc.Locked,
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
