.PHONY: build run linux-build static linux-static clean test deploy

APP_NAME := linux-service-manager
SRC_DIR  := src
LDFLAGS  := -s -w

# Dynamic build (native arch)
build:
	cd $(SRC_DIR) && go build -ldflags="$(LDFLAGS)" -o ../$(APP_NAME) main.go

# Static build (native arch) — recommended for portability
static:
	cd $(SRC_DIR) && CGO_ENABLED=0 go build -ldflags="$(LDFLAGS)" -o ../$(APP_NAME) main.go

run:
	cd $(SRC_DIR) && go run main.go

# Cross-compile for linux/amd64 (dynamic)
linux-build:
	cd $(SRC_DIR) && GOOS=linux GOARCH=amd64 go build -ldflags="$(LDFLAGS)" -o ../$(APP_NAME)-linux-amd64 main.go

# Cross-compile for linux/amd64 (static) — most portable
linux-static:
	cd $(SRC_DIR) && CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags="$(LDFLAGS)" -o ../$(APP_NAME)-linux-amd64 main.go

clean:
	rm -f $(APP_NAME) $(APP_NAME)-linux-amd64

test:
	cd test && go test ./...

# Deploy to local machine (uses static build)
deploy:
	@./scripts/deploy.sh
