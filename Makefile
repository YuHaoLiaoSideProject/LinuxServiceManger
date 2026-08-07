.PHONY: build run linux-build static linux-static clean test deploy dev frontend

APP_NAME := linux-service-manager
SRC_DIR  := src
FE_DIR   := frontend
LDFLAGS  := -s -w

# ── Frontend ──

frontend:
	cd $(FE_DIR) && npm run build

# ── Backend + Frontend ──

# Dynamic build (native arch) — requires frontend built first
build: frontend
	cd $(SRC_DIR) && go build -ldflags="$(LDFLAGS)" -o ../$(APP_NAME) main.go

# Static build (native arch) — recommended for portability
static: frontend
	cd $(SRC_DIR) && CGO_ENABLED=0 go build -ldflags="$(LDFLAGS)" -o ../$(APP_NAME) main.go

run:
	cd $(SRC_DIR) && go run main.go

# Cross-compile for linux/amd64 (dynamic)
linux-build: frontend
	cd $(SRC_DIR) && GOOS=linux GOARCH=amd64 go build -ldflags="$(LDFLAGS)" -o ../$(APP_NAME)-linux-amd64 main.go

# Cross-compile for linux/amd64 (static) — most portable
linux-static: frontend
	cd $(SRC_DIR) && CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags="$(LDFLAGS)" -o ../$(APP_NAME)-linux-amd64 main.go

# ── Development ──

# Start Go backend (for dev with npm run dev proxy)
dev-backend:
	cd $(SRC_DIR) && go run main.go

# Start Vue dev server with hot-reload + proxy to Go backend
dev-frontend:
	cd $(FE_DIR) && npm run dev

clean:
	rm -f $(APP_NAME) $(APP_NAME)-linux-amd64
	rm -rf $(SRC_DIR)/static $(FE_DIR)/dist

test:
	cd $(SRC_DIR) && go test ./...

# Deploy to local machine (uses static build)
deploy:
	@./scripts/deploy.sh
