// Package agentapi provides the HTTP API served by the agent node.
// This API exposes local service information and accepts commands
// forwarded from the manager.
package agentapi

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strconv"

	"github.com/go-chi/chi/v5"
)

// ServiceController abstracts systemd operations for the agent API.
// This is defined locally to avoid circular imports with agentclient.
type ServiceController interface {
	List() ([]ServiceInfo, error)
	Start(name string) error
	Stop(name string) error
	Restart(name string) error
	Enable(name string) error
	Disable(name string) error
	Logs(name string, lines int) (string, error)
	SystemInfo() (SystemInfo, error)
}

// ServiceInfo represents a simplified service status for JSON responses.
type ServiceInfo struct {
	Name          string `json:"name"`
	Active        string `json:"active"`
	Sub           string `json:"sub"`
	UnitFileState string `json:"unit_file_state"`
}

// SystemInfo represents basic system information.
type SystemInfo struct {
	OS       string `json:"os"`
	Kernel   string `json:"kernel"`
	Hostname string `json:"hostname"`
	Uptime   string `json:"uptime"`
	CPU      string `json:"cpu"`
	Memory   string `json:"memory"`
}

// Config holds configuration for the agent HTTP API.
type Config struct {
	ListenAddr string `json:"listen_addr"`
	TLSCert    string `json:"tls_cert"`
	TLSKey     string `json:"tls_key"`
	AuthToken  string `json:"auth_token"`
}

// NewRouter creates a chi router with the agent API routes.
func NewRouter(svc ServiceController, version string) http.Handler {
	r := chi.NewRouter()

	// Health endpoint (no auth required)
	r.Get("/health", handleHealth(version))

	// API v1 routes with token auth
	r.Route("/api/v1", func(r chi.Router) {
		r.Use(tokenAuth())
		r.Get("/services", handleListServices(svc))
		r.Post("/services/{name}/start", handleAction(svc, "start"))
		r.Post("/services/{name}/stop", handleAction(svc, "stop"))
		r.Post("/services/{name}/restart", handleAction(svc, "restart"))
		r.Post("/services/{name}/enable", handleAction(svc, "enable"))
		r.Post("/services/{name}/disable", handleAction(svc, "disable"))
		r.Get("/services/{name}/logs", handleLogs(svc))
		r.Get("/info", handleSystemInfo(svc))
	})

	return r
}

// tokenAuth is a middleware that validates the Authorization header.
func tokenAuth() func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			token := os.Getenv("AGENT_AUTH_TOKEN")
			if token == "" {
				// No token configured, skip auth
				next.ServeHTTP(w, r)
				return
			}

			authHeader := r.Header.Get("Authorization")
			if authHeader == "" {
				http.Error(w, `{"error":"missing authorization header"}`, http.StatusUnauthorized)
				return
			}

			// Support both "Bearer <token>" and raw token
			bearerToken := authHeader
			if len(authHeader) > 7 && authHeader[:7] == "Bearer " {
				bearerToken = authHeader[7:]
			}

			if bearerToken != token {
				http.Error(w, `{"error":"invalid token"}`, http.StatusUnauthorized)
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

// handleHealth returns basic health information.
func handleHealth(version string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		hostname, _ := os.Hostname()

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{
			"version":  version,
			"hostname": hostname,
			"os":       os.Getenv("GOOS"),
		})
	}
}

// handleListServices returns all services as JSON.
func handleListServices(svc ServiceController) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		services, err := svc.List()
		if err != nil {
			http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(services)
	}
}

// handleAction returns a handler that performs a service action.
func handleAction(svc ServiceController, action string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		name := chi.URLParam(r, "name")
		if name == "" {
			http.Error(w, `{"error":"missing service name"}`, http.StatusBadRequest)
			return
		}

		var err error
		switch action {
		case "start":
			err = svc.Start(name)
		case "stop":
			err = svc.Stop(name)
		case "restart":
			err = svc.Restart(name)
		case "enable":
			err = svc.Enable(name)
		case "disable":
			err = svc.Disable(name)
		default:
			http.Error(w, `{"error":"unknown action"}`, http.StatusBadRequest)
			return
		}

		if err != nil {
			http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"ok":      true,
			"service": name,
			"action":  action,
		})
	}
}

// handleLogs returns service logs.
func handleLogs(svc ServiceController) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		name := chi.URLParam(r, "name")
		if name == "" {
			http.Error(w, `{"error":"missing service name"}`, http.StatusBadRequest)
			return
		}

		lines := 100 // default
		if linesStr := r.URL.Query().Get("lines"); linesStr != "" {
			if l, err := strconv.Atoi(linesStr); err == nil && l > 0 {
				lines = l
			}
		}

		logs, err := svc.Logs(name, lines)
		if err != nil {
			http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		fmt.Fprint(w, logs)
	}
}

// handleSystemInfo returns system information.
func handleSystemInfo(svc ServiceController) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		info, err := svc.SystemInfo()
		if err != nil {
			http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(info)
	}
}
