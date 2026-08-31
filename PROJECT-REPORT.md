# PROJECT-REPORT.md — Linux Service Manager

> Auto-generated exploration report

## 1. Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Backend | **Go 1.24+** | HTTP server, systemd D-Bus integration, Agent binary |
| HTTP Router | **chi v5** | REST routing + middleware chain |
| systemd API | **godbus/dbus v5** | D-Bus IPC with systemd; `systemctl` fallback |
| Session | **gorilla/sessions** | Cookie-based session management |
| WebSocket | **gorilla/websocket** | Real-time status push + journalctl log streaming |
| Swagger | **swaggo/swag** | Auto-generated interactive API docs |
| Frontend Framework | **Vue 3** (Composition API) | SPA single-page application |
| Language | **TypeScript 6.x** | Type-safe frontend |
| Build Tool | **Vite 8.x** | Dev server + production bundle |
| State Management | **Pinia 4.x** | Auth / service / node stores |
| Routing | **vue-router 4.x** | Client-side SPA routes |
| HTTP Client | **axios** | API requests |
| Code Editor | **CodeMirror 6** | Service config file editor |
| PWA | **vite-plugin-pwa** + workbox | Offline support, installable |
| Unit Testing | **vitest 4.x** + @vue/test-utils | Frontend unit tests |
| E2E Testing | **Playwright** | End-to-end browser tests |
| Go Testing | `go test ./...` | Backend unit tests |
| Deployment | Go `embed` + Makefile | Single binary (~15MB) with embedded SPA |
| Agent | Go (cross-compiled linux/amd64 + arm64) | Remote node sidecar |

## 2. Project Structure (Key Paths)

```
LinuxServiceManger/
├── src/                              # Go backend source
│   ├── main.go                       # ★ Manager entry point
│   ├── go.mod / go.sum
│   ├── cmd/agent/main.go             # ★ Agent entry point
│   ├── internal/
│   │   ├── systemd/systemd.go        # D-Bus / systemctl service ops
│   │   ├── handler/json_handler.go   # JSON API handlers (login, services, batch, audit, tokens)
│   │   ├── handler/nodes_handler.go  # Node CRUD + agent proxy endpoints
│   │   ├── handler/node_proxy_handler.go  # Proxy requests to agent nodes
│   │   ├── handler/config_handler.go # Service config file editor
│   │   ├── handler/notify_handler.go # Webhook notification endpoints
│   │   ├── handler/search_handler.go # Enhanced service search
│   │   ├── handler/handler.go        # Legacy htmx handlers + hub attachment
│   │   ├── auth/auth.go              # Session setup + login validation
│   │   ├── middleware/auth.go        # Auth middleware (JSON 401 / HTML redirect)
│   │   ├── middleware/ratelimit.go   # IP-based rate limiting
│   │   ├── websocket/hub.go          # WS hub (broadcast service state + node events)
│   │   ├── websocket/client.go       # WS client connection
│   │   ├── monitor/monitor.go        # Service status monitoring orchestrator
│   │   ├── monitor/dbus_monitor.go   # D-Bus signal listener (real-time)
│   │   ├── monitor/polling_monitor.go # Polling fallback (systemd-less env)
│   │   ├── audit/audit.go            # JSONL audit log (write + query + CSV export)
│   │   ├── token/token.go            # API Token CRUD (lsm_* prefix, scope: read/full)
│   │   ├── token/store.go            # Token persistent store (JSON file)
│   │   ├── agentproto/proto.go       # Manager↔Agent wire protocol types
│   │   ├── agentclient/client.go     # Agent-side WS client (dial/reconnect/RPC)
│   │   ├── agentapi/api.go           # Agent local HTTP API (/health, /api/v1/services)
│   │   ├── agent/server.go           # Agent gRPC-style request handler
│   │   ├── agent/config.go           # Agent config parsing
│   │   ├── agent/heartbeat.go        # Agent heartbeat sender
│   │   ├── agent/sysinfo.go          # Agent system info collector
│   │   ├── noderegistry/registry.go  # Node CRUD + nodes.json atomic write
│   │   ├── nodemonitor/monitor.go    # Heartbeat state machine (online→offline→long_offline)
│   │   ├── nodeproxy/hub.go          # Agent WS connection hub + RPC forwarding
│   │   ├── nodeproxy/rpc.go          # RPC pending map + singleflight dedup
│   │   ├── nodeproxy/tls.go          # TLS fingerprint pinning
│   │   ├── nodes/manager.go          # Node lifecycle manager
│   │   ├── nodes/registry.go         # Node registry (newer version)
│   │   ├── nodes/heartbeat.go        # Heartbeat handling
│   │   ├── nodes/supervisor.go       # Node supervision
│   │   ├── nodes/client.go           # Client-side node connection
│   │   ├── notify/notifier.go        # Webhook notification dispatcher
│   │   ├── notify/sender.go          # HTTP webhook sender
│   │   ├── notify/payload.go         # Notification payload types
│   │   ├── notify/store.go           # Notification rule store
│   │   ├── notify/history.go         # Notification delivery history
│   │   ├── systemd/config.go         # Service config file read/write/validate
│   │   └── systemd/config_validate.go # Config validation rules
│   ├── static/                       # Built Vue SPA (embed target)
│   └── templates/                    # Legacy htmx HTML templates
├── frontend/                         # Vue 3 SPA source
│   ├── src/
│   │   ├── main.ts                   # Vue app entry
│   │   ├── App.vue                   # Root component
│   │   ├── views/
│   │   │   ├── LoginView.vue         # Login page
│   │   │   ├── DashboardView.vue     # Main dashboard (services + node switcher)
│   │   │   ├── AuditLogView.vue      # Audit log query page
│   │   │   └── NodeManagementView.vue # Node CRUD management page
│   │   ├── components/
│   │   │   ├── ServiceTable.vue      # Sortable/filterable service table
│   │   │   ├── ServiceRow.vue        # Single service row with action buttons
│   │   │   ├── StatsBar.vue          # Stats cards (total/running/failed) — clickable filter
│   │   │   ├── TabsBar.vue           # My Services / System Services tabs
│   │   │   ├── Toolbar.vue           # Search + batch mode toggle
│   │   │   ├── BatchToolbar.vue      # Multi-select action toolbar
│   │   │   ├── BatchResultPanel.vue  # Batch operation results panel
│   │   │   ├── LogDrawer.vue         # Real-time log viewer (WebSocket)
│   │   │   ├── ConfirmModal.vue      # Stop/restart confirmation dialog
│   │   │   ├── AppHeader.vue         # Nav bar (refresh, logout, theme, language)
│   │   │   ├── NodeCard.vue          # Node status card
│   │   │   ├── NodeFormModal.vue     # Node create/edit modal
│   │   │   ├── NodeSwitcher.vue      # Header node dropdown
│   │   │   ├── NodeSummaryBar.vue    # Node summary statistics
│   │   │   ├── AuditTable.vue        # Audit log table (search, date range, CSV export)
│   │   │   ├── ToastContainer.vue    # Toast notification container
│   │   │   ├── LoginForm.vue         # Login form
│   │   │   ├── EmptyState.vue        # Empty state placeholder
│   │   │   └── DateRangeGroup.vue    # Date range picker
│   │   ├── stores/
│   │   │   ├── auth.ts               # Pinia auth store
│   │   │   ├── service.ts            # Pinia service store (WS real-time sync)
│   │   │   └── node.ts               # Pinia node store (list/summary/WS events)
│   │   ├── api/
│   │   │   ├── client.ts             # Axios instance with interceptors
│   │   │   └── nodeApi.ts            # Node CRUD + service proxy API
│   │   ├── composables/
│   │   │   ├── useWebSocket.ts       # WebSocket connection (service + node events)
│   │   │   ├── useI18n.ts            # zh-TW / en i18n translations
│   │   │   ├── useTheme.ts           # Light/dark theme (localStorage)
│   │   │   ├── useServiceFilter.ts   # Service search/filter logic
│   │   │   ├── useAuditLog.ts        # Audit log query logic
│   │   │   └── useToast.ts           # Toast notification state
│   │   ├── router/index.ts           # Vue Router (/, /audit, /nodes)
│   │   └── types/
│   │       ├── service.ts            # Service TypeScript types
│   │       └── node.ts               # ManagedNode / NodeSummary types
│   ├── package.json
│   ├── vite.config.ts
│   └── vitest.config.ts
├── scripts/
│   ├── deploy.sh                     # Deployment script
│   └── check.sh                      # Health check script
├── install.sh                        # One-line install script (curl | bash)
├── Makefile                          # Build orchestration
├── docs/                             # Design docs (BDD, user stories, interaction flows, tech decisions, test plans, UIUX mockups)
└── test/                             # Go integration tests (go.mod)
```

## 3. Core Modules

### Backend (Go)

| Module | Package | Key File | Responsibility |
|--------|---------|----------|----------------|
| **Systemd Interface** | `internal/systemd` | `systemd.go` | D-Bus IPC + systemctl CLI fallback; List/Start/Stop/Restart/Enable/Disable services; service lock policy |
| **JSON API Handlers** | `internal/handler` | `json_handler.go` | All `/api/v1/*` endpoints: login, services CRUD, batch ops, audit, tokens, WebSocket log stream |
| **Node Handlers** | `internal/handler` | `nodes_handler.go` | `/api/v1/nodes/*` endpoints: CRUD, reconnect, agent proxy for services/logs/info |
| **Node Proxy** | `internal/handler` | `node_proxy_handler.go` | Proxy service actions to remote agent nodes via WS RPC |
| **Config Editor** | `internal/handler` | `config_handler.go` | Service unit file editor (read/write/validate via systemd/config) |
| **Webhook Notifications** | `internal/handler` | `notify_handler.go` | Webhook rule CRUD + delivery history |
| **Auth** | `internal/auth` | `auth.go` | Session management, login validation, env-based config |
| **Middleware** | `internal/middleware` | `auth.go`, `ratelimit.go` | Auth enforcement (JSON 401 / HTML redirect), IP rate limiting |
| **WebSocket Hub** | `internal/websocket` | `hub.go` | Browser WS connections; broadcast service state changes + node events |
| **Service Monitor** | `internal/monitor` | `monitor.go`, `dbus_monitor.go` | D-Bus signal listener for real-time systemd state; polling fallback |
| **Audit Log** | `internal/audit` | `audit.go` | JSONL append-only log; query with pagination/search/date range; CSV export |
| **API Token** | `internal/token` | `token.go`, `store.go` | Token CRUD with `lsm_*` prefix; scope: `read` (GET only) / `full`; persistent JSON store |
| **Agent Wire Protocol** | `internal/agentproto` | `proto.go` | Manager↔Agent message types (register, heartbeat, request/response) |
| **Agent Client** | `internal/agentclient` | `client.go` | Agent-side WS dial, reconnect with exponential backoff, heartbeat, RPC dispatch |
| **Agent API** | `internal/agentapi` | `api.go` | Agent local HTTP API: `/health`, `/api/v1/services`, `/api/v1/services/{name}/{action}` |
| **Node Registry** | `internal/noderegistry` | `registry.go` | Node CRUD with atomic JSON file write, token generation, 50-node limit |
| **Node Monitor** | `internal/nodemonitor` | `monitor.go` | Heartbeat state machine: online → offline (30s) → long_offline (300s) |
| **Node Proxy Hub** | `internal/nodeproxy` | `hub.go`, `rpc.go` | Agent WS connection management, RPC forwarding with singleflight dedup |
| **Node Supervisor** | `internal/nodes` | `supervisor.go`, `manager.go` | Higher-level node lifecycle management, heartbeat, registry |
| **Webhook Sender** | `internal/notify` | `sender.go`, `notifier.go` | HTTP webhook delivery with retry, history tracking, rule store |
| **Service Config** | `internal/systemd` | `config.go`, `config_validate.go` | Read/write/validate systemd unit files |

### Frontend (Vue 3)

| Module | Directory | Key Files | Responsibility |
|--------|-----------|-----------|----------------|
| **Login** | `views/` | `LoginView.vue`, `LoginForm.vue` | Username/password form → session cookie |
| **Dashboard** | `views/` | `DashboardView.vue` | Main service management view with node switcher |
| **Service Table** | `components/` | `ServiceTable.vue`, `ServiceRow.vue` | Sortable service list with action buttons, batch select |
| **Stats Bar** | `components/` | `StatsBar.vue` | Clickable stats cards (total/running/failed) for filtering |
| **Log Viewer** | `components/` | `LogDrawer.vue` | Real-time journalctl log stream via WebSocket |
| **Batch Operations** | `components/` | `BatchToolbar.vue`, `BatchResultPanel.vue` | Multi-select mode with progress/results |
| **Node Management** | `views/` | `NodeManagementView.vue`, `NodeCard.vue`, `NodeFormModal.vue` | Node CRUD, status cards, test connection |
| **Audit Log** | `views/` | `AuditLogView.vue`, `AuditTable.vue` | Query with date range, search, CSV export |
| **Real-time Sync** | `composables/` | `useWebSocket.ts` | WebSocket connection for service state + node events |
| **State Stores** | `stores/` | `auth.ts`, `service.ts`, `node.ts` | Pinia stores for auth, services (WS-synced), nodes |
| **i18n** | `composables/` | `useI18n.ts` | zh-TW / English translation |
| **Theme** | `composables/` | `useTheme.ts` | Light/dark mode with localStorage persistence |

### Agent (Standalone Binary)

| Component | Key File | Responsibility |
|-----------|----------|----------------|
| **Entry** | `src/cmd/agent/main.go` | Reads config, starts WS client + local HTTP API server |
| **WS Client** | `internal/agentclient/client.go` | Dials manager, sends heartbeat, handles RPC dispatch |
| **Local HTTP API** | `internal/agentapi/api.go` | Serves `/health`, `/api/v1/services` for local access |
| **System Info** | `internal/agent/sysinfo.go` | Collects hostname, uptime, CPU, memory |
| **Heartbeat** | `internal/agent/heartbeat.go` | Periodic heartbeat with system stats |
| **Config** | `internal/agent/config.go` | JSON config parsing (`manager_addr`, `auth_token`, `tls_fingerprint`, etc.) |

## 4. Build Conventions

### Makefile Targets

| Target | Description |
|--------|-------------|
| `make frontend` | Build Vue 3 SPA (`npm run build` → `frontend/dist/`) |
| `make build` | Build Go binary with embedded SPA (native arch) |
| `make static` | Build Go binary with `CGO_ENABLED=0` (most portable) |
| `make linux-build` | Cross-compile for `linux/amd64` (dynamic) |
| `make linux-static` | Cross-compile for `linux/amd64` (static, most portable) |
| `make build-agent` | Build Agent binaries for `linux/amd64` + `linux/arm64` |
| `make swagger` | Regenerate Swagger docs via `swag init` |
| `make test` | Run Go backend tests (`go test ./...`) |
| `make dev-backend` | Start Go dev server |
| `make dev-frontend` | Start Vite dev server with hot-reload + API proxy |
| `make deploy` | Run `scripts/deploy.sh` (stop → build → install → start) |
| `make clean` | Remove build artifacts |

### Build Flow

```
make frontend        →  cd frontend && npm run build
                                    ↓
                           frontend/dist/ (SPA assets)
                                    ↓ (post-build.mjs copies to)
                           src/static/ (embed source)
                                    ↓
make build           →  cd src && go build -ldflags="-s -w" main.go
                                    ↓
                           ./linux-service-manager (single binary ~15MB)
```

- Go `//go:embed static` directive in `main.go` embeds the entire SPA into the binary
- `-ldflags="-s -w"` strips debug symbols for smaller binary
- `CGO_ENABLED=0` for static builds (no libc dependency)

### Frontend Build

- `vue-tsc -b` — TypeScript type checking
- `vite build` — production bundle
- `scripts/post-build.mjs` — copies output to `src/static/` for Go embed
- PWA support via `vite-plugin-pwa` + workbox (service worker, manifest)

### Testing

- **Go**: `make test` → `cd src && go test ./...`
- **Frontend**: `npm test` (vitest) in `frontend/`
- **E2E**: `npm run test:e2e` (Playwright) in `frontend/`

### Runtime Configuration

All via environment variables (no config files for Manager):

| Variable | Required | Default |
|----------|----------|---------|
| `ADMIN_USER` | No | `admin` |
| `ADMIN_PASS` | **Yes** | — (refuses to start if unset) |
| `SESSION_KEY` | **Yes** | — (refuses to start if unset) |
| `PORT` | No | `8080` |
| `SECURE_COOKIE` | No | `true` (set `false` for HTTP) |
| `UNLOCKED_SERVICES` | No | (empty = lock all non-custom services) |
| `NODES_FILE_PATH` | No | `/var/lib/linux-service-manager/nodes.json` |
| `AGENT_BINARY_DIR` | No | `/var/lib/linux-service-manager/agents` |

Agent uses JSON config file (`/etc/linux-service-manager/agent.json`).

## 5. Key Architectural Decisions

1. **Single Binary Deployment**: Go embed + `//go:embed static` bundles the entire Vue SPA into the Go binary. One `scp` + execute = deployed. No nginx/docker required (though recommended for HTTPS).

2. **Dual Service Access Pattern**: D-Bus IPC preferred (fast, real-time signals), with `systemctl` CLI fallback for compatibility.

3. **Service Lock Policy**: Only services under `/etc/systemd/system/` with non-static/masked/alias state are unlocked. `UNLOCKED_SERVICES` env var supports glob patterns for explicit unlock.

4. **Multi-Node Manager+Agent**: Manager owns a node registry (JSON file). Agents connect outbound via WebSocket (no inbound port needed on agent). Heartbeat state machine detects offline/long_offline. RPC forwarding via singleflight dedup.

5. **Real-time Updates**: Two WebSocket channels — one for browser clients (service state + node events), one for agent connections (RPC + heartbeat). D-Bus signal monitor pushes state changes instantly.

6. **Security Layers**: Session cookie (HttpOnly) + rate limiting + service lock + Agent TLS fingerprint pinning + API Token scoping (read/full).

---

*Report generated from source exploration of `/fork/YuHaoLiaoSideProject/LinuxServiceManger`*
