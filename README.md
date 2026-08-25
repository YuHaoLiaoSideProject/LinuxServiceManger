# 🖥 Linux Service Manager

一套用 Go + Vue 3 打造的輕量級 Web 管理面板，讓你可以透過瀏覽器遠端管理 Linux 上的 systemd 服務。

[![Go Version](https://img.shields.io/badge/Go-1.24%2B-00ADD8?logo=go)](https://go.dev)
[![Vue](https://img.shields.io/badge/Vue-3.x-4FC08D?logo=vue.js)](https://vuejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.x-3178C6?logo=typescript)](https://www.typescriptlang.org)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## ✨ 功能特色

| 模組 | 功能 |
|------|------|
| 🔐 **管理員登入** | 帳號密碼驗證、Cookie-based session、30 分鐘閒置逾時、HttpOnly |
| 📋 **服務列表** | 即時查詢所有 systemd 服務，含 Load / Active / Sub 狀態，支援排序欄位 |
| ▶️ **服務操作** | Start、Stop、Restart、Enable、Disable，附帶確認對話框防止誤操作 |
| 🔒 **服務保護** | 僅 `/etc/systemd/system/` 下的自訂服務可操作，系統服務自動鎖定；可透過環境變數解鎖 |
| 🔍 **搜尋過濾** | 前端即時搜尋，支援分頁（我的服務 / 系統服務），含動態統計卡篩選 |
| 📊 **狀態統計** | 總服務數、執行中、失敗數量一目了然（StatsBar），點擊統計卡快速篩選 |
| 📝 **日誌檢視器** | WebSocket 串流即時查看服務 journalctl 日誌，支援自動捲動與暫停 |
| 🔄 **即時狀態推送** | WebSocket 雙向通道，systemd 狀態變更與開機啟動變更即時推送到前端 |
| 📜 **審計日誌** | 記錄所有服務操作（啟動/停止/重啟/啟用/停用），支援時間範圍查詢、搜尋與 CSV 匯出 |
| 📦 **批次操作** | 多選服務一次執行 start / stop / restart，含進度提示與個別結果回報 |
| 🌗 **深色模式** | 支援亮色 / 暗色主題切換，記憶偏好 (localStorage) |
| 🌐 **雙語介面** | 繁體中文 / English 切換 (i18n) |
| 🛎️ **Toast 通知** | 操作結果即時彈出通知（成功 / 失敗） |
| 📱 **RWD 響應式** | 桌面表格、平板精簡、手機 sticky header + segmented tabs + bottom sheet 佈局 |
| 🚀 **單檔部署** | 一個約 15MB 的 binary，內嵌 Vue 3 SPA，`scp` 上傳直接執行，無 runtime 依賴 |
| 🖧 **多機管理** | Manager + Agent 架構，透過 WebSocket 長連線管理多台 Linux 機器，支援節點 CRUD、心跳監控、狀態即時推送 |
| 📡 **Agent 模式** | 輕量 Agent 部署於被控端，outbound 撥號連線 Manager，指數退避重連，支援 TLS 指紋 pinning |
| 🟢 **節點狀態機** | online → offline → long_offline 自動偵測，30s/300s 閾值，啟動寬限期，WS 即時推送狀態變更 |
| 🖥️ **節點管理頁** | 節點列表 + CRUD Modal + 測試連線 + 下載 Agent binary，支援搜尋篩選 |
| 🔄 **Aggregate Dashboard** | 節點總覽 + 單節點切換，`?node={id}` query 分流，離線 Banner + 操作禁用 |

## 🛠 技術棧

| 層級 | 技術 | 用途 |
|------|------|------|
| 語言 | Go 1.24+ | 後端全部 |
| Router | [chi v5](https://github.com/go-chi/chi) | HTTP routing + middleware |
| 前端框架 | [Vue 3](https://vuejs.org) (Composition API) | SPA 單頁應用 |
| 前端語言 | TypeScript | 型別安全 |
| 前端建構 | [Vite](https://vitejs.dev) | 開發伺服器 + 打包 |
| 狀態管理 | [Pinia](https://pinia.vuejs.org) | Auth store |
| 路由 | [vue-router](https://router.vuejs.org) | SPA 路由 |
| HTTP 客戶端 | [axios](https://axios-http.com) | API 請求 |
| CSS | 自訂 CSS（登入表單沿用 PicoCSS 變數） | 樣式 |
| systemd | [godbus/dbus5](https://github.com/godbus/dbus) + `systemctl` fallback | D-Bus 操作 systemd |
| Session | [gorilla/sessions](https://github.com/gorilla/sessions) | Cookie-based session |
| 部署 | Go `embed` + Makefile | 內嵌 SPA 靜態檔為單一 binary |
| 測試 | [vitest](https://vitest.dev) + [@vue/test-utils](https://test-utils.vuejs.org) | 前端單元測試 |

### 架構圖

```
┌─────────────────────────────────────────────────────────┐
│                      Browser                            │
│               (Vue 3 SPA + 自訂 CSS)                    │
└──────────────────────┬──────────────────────────────────┘
                       │ HTTP (Cookie Session)
                       │ /api/v1/*  JSON API
                       │ /*         SPA static files
┌──────────────────────▼──────────────────────────────────┐
│              Manager (Go Binary)                         │
│                                                          │
│  ┌─────────┐  ┌──────────┐  ┌──────────┐  ┌─────────┐ │
│  │  chi    │  │  auth    │  │  nodes   │  │ systemd │ │
│  │ router  │──│ middleware│──│ handler  │──│ handler │ │
│  └────┬────┘  └──────────┘  └────┬─────┘  └─────────┘ │
│       │                          │                      │
│  ┌────▼────┐  ┌──────────┐  ┌───▼──────┐  ┌─────────┐ │
│  │ embed   │  │ websocket│  │ nodemoni-│  │noderegis-│ │
│  │ static/ │  │ hub      │  │ tor      │  │ try      │ │
│  │ (Vue    │  │ (browser)│  │ (心跳)   │  │(nodes.  │ │
│  │  SPA)   │  └────┬─────┘  └──────────┘  │ json)   │ │
│  └─────────┘       │                       └─────────┘ │
│                    │                                    │
│  ┌─────────────────▼──────────────────────────────────┐ │
│  │              nodeproxy Hub                          │ │
│  │  (Agent WS 連線管理 + RPC 轉發 + singleflight)     │ │
│  └─────────────────────┬──────────────────────────────┘ │
└────────────────────────┼────────────────────────────────┘
                         │ WebSocket (wss://)
                         │ /api/v1/agent/ws?token=
           ┌─────────────┼─────────────┐
           │             │             │
    ┌──────▼──────┐ ┌───▼─────┐ ┌─────▼──────┐
    │   Agent     │ │  Agent  │ │   Agent    │
    │  (web-01)   │ │ (db-01) │ │  (app-01)  │
    │ ┌─────────┐ │ │         │ │            │
    │ │agentcli-│ │ │         │ │            │
    │ │ent (WS) │ │ │         │ │            │
    │ ├─────────┤ │ │         │ │            │
    │ │agentapi │ │ │         │ │            │
    │ │(本地    │ │ │         │ │            │
    │ │ HTTP)   │ │ │         │ │            │
    │ └────┬────┘ │ │         │ │            │
    └──────┼──────┘ └────┬────┘ └─────┬──────┘
           │             │             │
    ┌──────▼──────┐ ┌───▼─────┐ ┌─────▼──────┐
    │  systemd    │ │ systemd │ │  systemd   │
    │ (系統 init) │ │         │ │            │
    └─────────────┘ └─────────┘ └────────────┘
```

## 🚀 快速開始

### 一行指令安裝

```bash
curl -fsSL https://raw.githubusercontent.com/YuHaoLiaoSideProject/LinuxServiceManger/main/install.sh | bash
```

會自動下載最新版 binary，並可選擇安裝 systemd service 自動啟動。

指定版本（tag 格式為日期版本號）：

```bash
curl -fsSL https://raw.githubusercontent.com/YuHaoLiaoSideProject/LinuxServiceManger/main/install.sh | bash -s -- --tag 20260812.01
```

僅下載 binary，不安裝 service：

```bash
curl -fsSL https://raw.githubusercontent.com/YuHaoLiaoSideProject/LinuxServiceManger/main/install.sh | bash -s -- --no-service
```

### 前置需求

- Linux 作業系統（支援 systemd）
- 使用者具備執行 `systemctl` 的權限（或用 `sudo` 執行）

### 手動下載

從 [Release 頁面](https://github.com/YuHaoLiaoSideProject/LinuxServiceManger/releases) 下載對應平台的 binary，直接執行：

```bash
# 設定環境變數（SESSION_KEY 和 ADMIN_PASS 必須設定，否則啟動失敗）
export ADMIN_USER=admin
export ADMIN_PASS=your_secure_password
export SESSION_KEY=your_random_session_key
export PORT=8080

# 執行
./linux-service-manager-linux-amd64
```

打開瀏覽器訪問 `http://localhost:8080` 即可。

### 從原始碼編譯

```bash
git clone git@github.com:YuHaoLiaoSideProject/LinuxServiceManger.git
cd LinuxServiceManger

# 安裝前端依賴並建構 SPA
make frontend

# 本機編譯（內嵌 SPA）
make build

# 本機靜態編譯（無 CGO，更可攜）
make static

# 交叉編譯 Linux amd64
make linux-build

# 交叉編譯 Linux amd64（靜態，最可攜）
make linux-static

# 編譯 Agent binary（amd64 + arm64）
make build-agent

# 執行測試
make test

# 開發模式：啟動後端
make dev-backend

# 開發模式：啟動前端 dev server（另開終端）
make dev-frontend
```

手動編譯：

```bash
# 先建構前端
cd frontend
npm install
npm run build
cd ..

# 編譯 Go（會自動 embed src/static/ 下的 SPA 輸出）
cd src
go build -o ../linux-service-manager main.go
```

## ⚙️ 環境變數

| 變數 | 預設值 | 說明 |
|------|--------|------|
| `ADMIN_USER` | `admin` | 管理員帳號 |
| `ADMIN_PASS` | `admin123` | 管理員密碼（**必須設定**，否則啟動拒絕） |
| `SESSION_KEY` | — | Session 加密金鑰（**必須設定**，否則啟動拒絕） |
| `PORT` | `8080` | HTTP 監聽埠號 |
| `SECURE_COOKIE` | `true` | Session cookie 是否啟用 `Secure` flag。純 HTTP 部署（無 HTTPS）**必須設為 `false`**，否則瀏覽器會拒絕 cookie 導致無法登入 |
| `UNLOCKED_SERVICES` | (空) | 解鎖指定服務的 glob 模式，逗號分隔（見下方說明） |
| `NODES_FILE_PATH` | `/var/lib/linux-service-manager/nodes.json` | 節點設定持久化路徑 |
| `AGENT_BINARY_DIR` | `/var/lib/linux-service-manager/agents` | Agent binary 存放目錄 |
| `MANAGER_OFFLINE_THRESHOLD` | `30s` | 節點離線判定閾值（3× 心跳間隔） |
| `MANAGER_LONG_OFFLINE_THRESHOLD` | `300s` | 長期離線判定閾值 |
| `MANAGER_RPC_TIMEOUT_ACTION` | `15s` | 服務操作 RPC 逾時 |
| `MANAGER_RPC_TIMEOUT_QUERY` | `10s` | 查詢類 RPC 逾時 |

> ⚠️ **重要**：`ADMIN_PASS` 和 `SESSION_KEY` 兩個環境變數必須明確設定，使用預設值會導致程式拒絕啟動。
> 
> ⚠️ **純 HTTP 部署注意**：若沒有使用 HTTPS（例如直接暴露 port 8080 或 10500），必須設定 `SECURE_COOKIE=false`。瀏覽器會拒絕儲存帶有 `Secure` flag 的 cookie 在 HTTP 連線上，導致登入成功後所有請求仍是 401。

### 解鎖服務

預設只允許操作 `/etc/systemd/system/` 下的自訂服務（且排除 `dbus-*` 和 `static/masked/alias` 類型的服務）。  
若要解鎖特定系統服務，設定 `UNLOCKED_SERVICES`：

```bash
# 解鎖單一服務
export UNLOCKED_SERVICES="ssh"

# 解鎖多個服務（支援 glob 模式）
export UNLOCKED_SERVICES="ssh,nginx,docker,my-*"
```

## 📁 專案結構

```
linux-service-manager/
├── src/
│   ├── main.go                    # Manager 進入點 (Go embed static/)
│   ├── go.mod / go.sum            # Go module 依賴
│   ├── cmd/
│   │   └── agent/
│   │       └── main.go            # Agent 進入點（WS client + 本地 HTTP API）
│   ├── internal/
│   │   ├── agentproto/
│   │   │   ├── proto.go           # Manager↔Agent WS wire protocol 類型
│   │   │   └── proto_test.go      # Wire protocol 測試
│   │   ├── agentclient/
│   │   │   ├── client.go          # Agent 側 WS 客戶端（撥號/重連/heartbeat/RPC dispatch）
│   │   │   └── client_test.go     # Agent client 測試
│   │   ├── agentapi/
│   │   │   ├── api.go             # Agent 本機 JSON API（/health, /api/v1/services）
│   │   │   └── api_test.go        # Agent API 測試
│   │   ├── noderegistry/
│   │   │   ├── registry.go        # 節點 CRUD + nodes.json atomic write
│   │   │   └── registry_test.go   # Registry 測試
│   │   ├── nodemonitor/
│   │   │   ├── monitor.go         # 心跳狀態機（online→offline→long_offline）
│   │   │   └── monitor_test.go    # 心跳監控測試（fake clock）
│   │   ├── nodeproxy/
│   │   │   ├── hub.go             # Agent WS 連線 Hub + RPC 轉發
│   │   │   ├── rpc.go             # WS RPC pending map + singleflight
│   │   │   ├── tls.go             # TLS 指紋 pinning
│   │   │   ├── hub_test.go        # Hub + RPC 測試
│   │   │   └── tls_test.go        # TLS 測試
│   │   ├── audit/
│   │   │   ├── audit.go           # 審計日誌記錄與查詢（含 node_id/node_name）
│   │   │   └── audit_test.go      # 審計日誌測試
│   │   ├── auth/
│   │   │   ├── auth.go            # Session 管理、登入驗證
│   │   │   └── auth_test.go       # Session 測試
│   │   ├── handler/
│   │   │   ├── handler.go         # HTML/htmx 路由（legacy）+ WebSocket handler
│   │   │   ├── nodes_handler.go   # /api/v1/nodes/* 全部端點（13 handlers）
│   │   │   ├── handler_test.go    # JSON API 測試
│   │   │   ├── handler_audit_test.go  # 審計 API 測試
│   │   │   ├── handler_batch_test.go  # 批次操作 API 測試
│   │   │   └── json_handler.go    # JSON API (/api/v1/*) handlers
│   │   ├── middleware/
│   │   │   ├── auth.go            # 認證 middleware（HTML redirect + JSON 401）
│   │   │   ├── auth_test.go       # middleware 測試
│   │   │   └── ratelimit.go       # 登入速率限制 middleware
│   │   ├── monitor/
│   │   │   ├── monitor.go         # 服務狀態監控調度
│   │   │   ├── dbus_monitor.go    # D-Bus signal 即時監聽
│   │   │   └── polling_monitor.go # 定期輪詢狀態監控
│   │   ├── systemd/
│   │   │   ├── systemd.go         # D-Bus / systemctl 操作 systemd
│   │   │   └── systemd_test.go    # systemd 測試
│   │   └── websocket/
│   │       ├── hub.go             # WebSocket Hub（client 管理與廣播 + node 事件）
│   │       ├── hub_test.go        # Hub 測試
│   │       ├── client.go          # WebSocket client 連線
│   │       └── origin.go          # WebSocket origin 檢查
│   ├── templates/
│   │   ├── index.html             # Legacy htmx 頁面
│   │   └── login.html             # Legacy 登入頁面
│   └── static/                    # Vue 3 SPA 建構輸出 (npm run build → embed)
├── frontend/                      # Vue 3 SPA 原始碼
│   ├── src/
│   │   ├── main.ts                # Vue 應用進入點
│   │   ├── App.vue                # 根元件
│   │   ├── views/
│   │   │   ├── LoginView.vue      # 登入頁面
│   │   │   ├── DashboardView.vue  # 儀表板（服務管理 + 節點切換）
│   │   │   ├── AuditLogView.vue   # 審計日誌查詢頁面
│   │   │   └── NodeManagementView.vue  # 節點管理頁面（列表 + CRUD）
│   │   ├── components/
│   │   │   ├── AppHeader.vue      # 頁首：導覽、重新整理、登出、主題/語言切換
│   │   │   ├── AuditTable.vue     # 審計日誌表格（含時間範圍、搜尋、匯出）
│   │   │   ├── BatchResultPanel.vue  # 批次操作結果面板
│   │   │   ├── BatchToolbar.vue   # 批次操作工具列（多選模式）
│   │   │   ├── ConfirmModal.vue   # Stop/Restart 確認對話框
│   │   │   ├── DateRangeGroup.vue # 日期範圍選擇器
│   │   │   ├── EmptyState.vue     # 空狀態提示
│   │   │   ├── LogDrawer.vue      # 日誌檢視器（WebSocket 即時串流）
│   │   │   ├── LoginForm.vue      # 登入表單
│   │   │   ├── NodeCard.vue       # 節點卡片（狀態燈/摘要/相對時間）
│   │   │   ├── NodeFormModal.vue  # 新增/編輯節點 Modal（含測試連線）
│   │   │   ├── NodeSummaryBar.vue # 頂部節點匯總統計列
│   │   │   ├── NodeSwitcher.vue   # Header 節點下拉選單
│   │   │   ├── ServiceRow.vue     # 單一服務列（含操作按鈕、多選 checkbox）
│   │   │   ├── ServiceTable.vue   # 可排序、可篩選的服務表格
│   │   │   ├── StatsBar.vue       # 統計卡：總數 / 執行中 / 失敗（可點擊篩選）
│   │   │   ├── TabsBar.vue        # 分頁：我的服務 / 系統服務
│   │   │   ├── ToastContainer.vue # Toast 通知容器
│   │   │   └── Toolbar.vue        # 搜尋欄 + 批次模式切換
│   │   ├── stores/
│   │   │   ├── auth.ts            # Pinia 認證 store
│   │   │   ├── service.ts         # Pinia 服務狀態 store（WebSocket 即時同步）
│   │   │   └── node.ts            # Pinia 節點 store（列表/摘要/WS 事件整合）
│   │   ├── api/
│   │   │   ├── client.ts          # Axios API 客戶端
│   │   │   └── nodeApi.ts         # 節點 CRUD + 服務代理 API
│   │   ├── composables/
│   │   │   ├── useAuditLog.ts     # 審計日誌查詢邏輯
│   │   │   ├── useI18n.ts         # 繁體中文 / English 翻譯
│   │   │   ├── useServiceFilter.ts # 服務搜尋過濾邏輯
│   │   │   ├── useTheme.ts        # 亮色 / 暗色主題
│   │   │   ├── useToast.ts        # Toast 通知狀態
│   │   │   └── useWebSocket.ts    # WebSocket 連線管理（含 node.* 事件）
│   │   ├── router/
│   │   │   └── index.ts           # Vue Router 設定（含 /nodes 路由）
│   │   ├── types/
│   │   │   ├── service.ts         # TypeScript 型別定義
│   │   │   └── node.ts            # ManagedNode / NodeSummary 型別
│   │   └── __tests__/             # 元件與 composable 單元測試
│   └── ...                        # Vite 設定、package.json 等
├── scripts/
│   ├── deploy.sh                  # 部署腳本
│   └── check.sh                   # 檢查腳本
├── install.sh                     # 一鍵安裝腳本
├── Makefile                       # build / run / dev / frontend / deploy
└── docs/
    ├── bdds/                      # BDD 場景定義（Gherkin）
    ├── development/               # 開發規格
    ├── interaction-flows/         # 互動流程設計（Mermaid 流程圖）
    ├── tech-decisions/            # 技術決策文件
    ├── test-plans/                # 測試計畫
    └── user-stories/              # User Story 文件
```

## 🔌 API 路由

### JSON API（SPA 使用）

前端 Vue 3 SPA 透過 `/api/v1/` 前綴存取以下端點：

| 方法 | 路徑 | 說明 | 認證 |
|------|------|------|:----:|
| `POST` | `/api/v1/login` | 登入（form-urlencoded） | ❌ |
| `POST` | `/api/v1/logout` | 登出 | ✅ |
| `GET` | `/api/v1/session` | 檢查 session 狀態 | ❌ |
| `GET` | `/api/v1/services` | 取得所有服務列表 (JSON) | ✅ |
| `POST` | `/api/v1/services/{name}/start` | 啟動服務 | ✅ |
| `POST` | `/api/v1/services/{name}/stop` | 停止服務 | ✅ |
| `POST` | `/api/v1/services/{name}/restart` | 重啟服務 | ✅ |
| `POST` | `/api/v1/services/{name}/enable` | 啟用服務（開機啟動） | ✅ |
| `POST` | `/api/v1/services/{name}/disable` | 停用服務（取消開機啟動） | ✅ |
| `POST` | `/api/v1/services/batch` | 批次操作多個服務 | ✅ |
| `GET` | `/api/v1/services/{name}/logs/ws` | WebSocket 即時日誌串流 | ✅ |
| `GET` | `/api/v1/ws` | WebSocket 服務狀態即時推送 | ✅ |
| `GET` | `/api/v1/audit` | 查詢審計日誌（支援分頁、搜尋、時間範圍） | ✅ |
| `GET` | `/api/v1/audit/export` | 匯出審計日誌（CSV） | ✅ |
| `POST` | `/api/v1/nodes` | 新增節點（name, address 必填） | ✅ |
| `GET` | `/api/v1/nodes` | 取得所有節點列表 | ✅ |
| `GET` | `/api/v1/nodes/summary` | 取得節點匯總統計 | ✅ |
| `GET` | `/api/v1/nodes/agent-binary` | 下載 Agent binary（?arch=amd64\|arm64） | ✅ |
| `GET` | `/api/v1/nodes/{id}` | 取得單一節點詳情 | ✅ |
| `PUT` | `/api/v1/nodes/{id}` | 更新節點設定 | ✅ |
| `DELETE` | `/api/v1/nodes/{id}` | 移除節點 | ✅ |
| `POST` | `/api/v1/nodes/{id}/reconnect` | 觸發節點重連 | ✅ |
| `POST` | `/api/v1/nodes/test-connection` | 測試 Agent 連線 | ✅ |
| `GET` | `/api/v1/nodes/{id}/services` | 代理查詢節點服務列表 | ✅ |
| `POST` | `/api/v1/nodes/{id}/services/{name}/{action}` | 代理執行服務操作 | ✅ |
| `GET` | `/api/v1/nodes/{id}/services/{name}/logs` | 代理查詢服務日誌 | ✅ |
| `GET` | `/api/v1/nodes/{id}/info` | 代理查詢節點系統資訊 | ✅ |
| `GET` | `/api/v1/agent/ws` | Agent WebSocket 升級端點（token 驗證） | Agent |

### 📖 互動式 API 文件

登入後於 SPA 導覽列點「API 文件」（或直接開啟 `/api/v1/docs/`）可查看完整互動式文件（Swagger UI），包含每個端點的 request/response schema、錯誤碼與「Try it out」功能。

文件由 Go handler 註解自動產生（swaggo），更新後端端點後執行 `make swagger` 重新產生。

#### 🔑 使用 API Token 呼叫

於「API Tokens」頁面建立 Token 後，以 Bearer header 呼叫任一受保護端點：

```bash
# read scope — 僅允許 GET / HEAD / OPTIONS（寫入操作回 403）
curl -sS -H "Authorization: Bearer lsm_你的Token" https://你的主機/api/v1/services

# full scope — 可執行所有操作（服務啟停、批次、設定檔、通知管理…）
curl -sS -X POST -H "Authorization: Bearer lsm_你的Token" \
  -H "Content-Type: application/json" \
  -d '{"names":["nginx.service"],"action":"restart"}' \
  https://你的主機/api/v1/services/batch
```

要點：
- Token 管理端點（`/api/v1/tokens`）僅限 Session 登入，不可用 Token 呼叫。
- 非 2xx 回應一律為 `{"error": "說明"}`。
- WebSocket 端點（`/api/v1/ws`、`/api/v1/services/{name}/logs/ws`）支援自訂 header 的 ws 客戶端帶 Bearer header；瀏覽器原生 WebSocket 需 Session cookie。

### Legacy HTML 路由（htmx）

以下路由為舊版 htmx 模式，仍可使用但非主要開發目標：

| 方法 | 路徑 | 說明 | 認證 |
|------|------|------|:----:|
| `GET` | `/htmx` | htmx 服務列表頁 | ✅ |
| `GET` | `/services` | 服務列表（htmx 局部刷新） | ✅ |
| `POST` | `/api/services/{name}/start` | 啟動服務 | ✅ |
| `POST` | `/api/services/{name}/stop` | 停止服務 | ✅ |
| `POST` | `/api/services/{name}/restart` | 重啟服務 | ✅ |

## 📦 部署

### 快速部署

專案內附 `deploy.sh` 腳本，會自動編譯、停止舊服務、安裝 binary、啟動服務：

```bash
sudo ./scripts/deploy.sh
```

> 預設部署至 `/opt/linux-service-manager/`，並假設已有同名 systemd service 在執行。

### systemd Service 設定

建立 `/etc/systemd/system/linux-service-manager.service`：

```ini
[Unit]
Description=Linux Service Manager - Web systemd management panel
After=network.target

[Service]
Type=simple
User=root
Environment="ADMIN_USER=admin"
Environment="ADMIN_PASS=change_me"
Environment="SESSION_KEY=change_me_to_random_string"
Environment="PORT=8080"
Environment="SECURE_COOKIE=false"
ExecStart=/opt/linux-service-manager/linux-service-manager
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

執行：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now linux-service-manager
```

### 搭配 Reverse Proxy（Nginx + HTTPS）

建議在生產環境使用 Nginx reverse proxy 加上 HTTPS，參考：

```nginx
server {
    listen 443 ssl;
    server_name your-domain.com;

    ssl_certificate     /etc/ssl/certs/your-cert.pem;
    ssl_certificate_key /etc/ssl/private/your-key.pem;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## 🔒 安全性考量

| 項目 | 建議 |
|------|------|
| **SESSION_KEY** | 必須設定為隨機長字串，程式拒絕使用預設值啟動 |
| **ADMIN_PASS** | 必須更換為強密碼，程式拒絕使用預設值啟動 |
| **HTTPS** | 生產環境請搭配 reverse proxy 啟用 HTTPS |
| **Session** | Cookie 設為 HttpOnly，30 分鐘閒置自動逾時 |
| **權限** | 避免以 root 直接執行，可考慮使用 `sudo` 或 polkit 設定 |
| **Agent Token** | Agent 設定檔中的 auth_token 用於反向驗證 Manager 身分，節點設定以 0600 權限儲存 |
| **TLS 指紋** | 支援 SHA-256 憑證指紋 pinning，防止中間人攻擊；空指紋 = 僅加密不驗證 |
| **節點上限** | 單一 Manager 最多管理 50 台 Agent 節點 |

## 📖 相關文件

### 核心功能

| 編號 | 功能 | User Story | BDD | 開發規格 | 測試計畫 | 互動流程 | 技術決策 |
|:---:|------|:---:|:---:|:---:|:---:|:---:|:---:|
| 001 | 管理員登入系統 | [📄](docs/user-stories/001-管理員登入系統.md) | [📄](docs/bdds/001-管理員登入系統.feature) | [📄](docs/development/001-linux-service-manager.md) | [📄](docs/test-plans/001-管理員登入系統測試計畫.md) | — | — |
| 002 | 管理 systemd 服務 | [📄](docs/user-stories/002-管理員管理systemd服務.md) | [📄](docs/bdds/002-管理員管理systemd服務.feature) | — | [📄](docs/test-plans/002-管理員管理systemd服務測試計畫.md) | — | — |
| 003 | 部署安全性 | [📄](docs/user-stories/003-部署安全性.md) | [📄](docs/bdds/003-部署安全性.feature) | — | [📄](docs/test-plans/003-部署安全性測試計畫.md) | — | — |
| 004 | Enable / Disable 服務 | — | [📄](docs/bdds/004-enable-disable-service.feature) | [📄](docs/development/004-enable-disable-service.md) | [📄](docs/test-plans/004-enable-disable-service測試計畫.md) | [📄](docs/interaction-flows/004-enable-disable-service.md) | — |
| 005 | journalctl 日誌檢視器 | — | [📄](docs/bdds/005-journalctl-log-viewer.feature) | [📄](docs/development/005-journalctl-log-viewer.md) | [📄](docs/test-plans/005-journalctl-log-viewer測試計畫.md) | [📄](docs/interaction-flows/005-journalctl-log-viewer.md) | [📄](docs/tech-decisions/005-journalctl-log-viewer.md) |
| 006 | PWA 支援 | — | [📄](docs/bdds/006-pwa-support.feature) | [📄](docs/development/006-pwa-support.md) | [📄](docs/test-plans/006-pwa-support測試計畫.md) | [📄](docs/interaction-flows/006-pwa-support.md) | [📄](docs/tech-decisions/006-pwa-support.md) |
| 007 | 服務搜尋增強 | — | [📄](docs/bdds/007-service-search-enhancement.feature) | [📄](docs/development/007-service-search-enhancement.md) | [📄](docs/test-plans/007-service-search-enhancement測試計畫.md) | [📄](docs/interaction-flows/007-service-search-enhancement.md) | [📄](docs/tech-decisions/007-service-search-enhancement.md) |
| 008 | WebSocket 狀態推送 | — | [📄](docs/bdds/008-websocket-status-push.feature) | [📄](docs/development/008-websocket-status-push.md) | [📄](docs/test-plans/008-websocket-status-push測試計畫.md) | [📄](docs/interaction-flows/008-websocket-status-push.md) | [📄](docs/tech-decisions/008-websocket-status-push.md) |
| 009 | 審計日誌 | — | [📄](docs/bdds/009-audit-log.feature) | [📄](docs/development/009-audit-log.md) | [📄](docs/test-plans/009-audit-log測試計畫.md) | [📄](docs/interaction-flows/009-audit-log.md) | [📄](docs/tech-decisions/009-audit-log.md) |
| 010 | 批次操作 | — | [📄](docs/bdds/010-batch-operations.feature) | [📄](docs/development/010-batch-operations.md) | [📄](docs/test-plans/010-batch-operations測試計畫.md) | [📄](docs/interaction-flows/010-batch-operations.md) | [📄](docs/tech-decisions/010-batch-operations.md) |
| 014 | 多機管理 Agent 模式 | — | [📄](docs/bdds/014-multi-node-agent-management.feature) | [📄](docs/development/014-multi-node-agent-management.md) | [📄](docs/test-plans/014-multi-node-agent-management測試計畫.md) | [📄](docs/interaction-flows/014-multi-node-agent-management.md) | [📄](docs/tech-decisions/014-multi-node-agent-management.md) |

### 綜合文件

- [擴充藍圖](docs/development/002-expansion-roadmap.md) — 專案整體 roadmap

## 📝 License

MIT
