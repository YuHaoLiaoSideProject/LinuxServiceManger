package main

import (
	"embed"
	"io/fs"
	"log"
	"net/http"
	"os"

	"linux-service-manager/internal/handler"
	"linux-service-manager/internal/middleware"

	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"
)

//go:embed templates
var templatesFS embed.FS

func main() {
	// Extract the templates directory as a sub-filesystem
	templates, err := fs.Sub(templatesFS, "templates")
	if err != nil {
		log.Fatalf("failed to open templates: %v", err)
	}

	h := handler.New(templates)

	r := chi.NewRouter()
	r.Use(chimw.Logger)
	r.Use(chimw.Recoverer)

	// Public routes (no auth required)
	r.Get("/login", h.HandleLoginPage)
	r.Post("/login", h.HandleLogin)
	r.Get("/logout", h.HandleLogout)

	// Protected routes
	r.Group(func(r chi.Router) {
		r.Use(middleware.AuthMiddleware)
		r.Get("/", h.HandleIndex)
		r.Get("/services", h.HandleServices)
		r.Post("/api/services/{name}/start", h.HandleStart)
		r.Post("/api/services/{name}/stop", h.HandleStop)
		r.Post("/api/services/{name}/restart", h.HandleRestart)
	})

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	log.Printf("🚀 Linux Service Manager starting on http://localhost:%s", port)
	if err := http.ListenAndServe(":"+port, r); err != nil {
		log.Fatalf("server error: %v", err)
	}
}
