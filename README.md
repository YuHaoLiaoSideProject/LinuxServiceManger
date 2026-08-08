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
| ▶️ **服務操作** | Start、Stop、Restart，附帶確認對話框防止誤操作 |
| 🔒 **服務保護** | 僅 `/etc/systemd/system/` 下的自訂服務可操作，系統服務自動鎖定；可透過環境變數解鎖 |
| 🔍 **搜尋過濾** | 前端即時搜尋，支援分頁（我的服務 / 系統服務） |
| 📊 **狀態統計** | 總服務數、執行中、失敗數量一目了然（StatsBar） |
| 🌗 **深色模式** | 支援亮色 / 暗色主題切換，記憶偏好 (localStorage) |
| 🌐 **雙語介面** | 繁體中文 / English 切換 (i18n) |
| 🛎️ **Toast 通知** | 操作結果即時彈出通知（成功 / 失敗） |
| 📱 **RWD 響應式** | 桌面表格、平板精簡、手機卡片三種佈局 |
| 🚀 **單檔部署** | 一個約 15MB 的 binary，內嵌 Vue 3 SPA，`scp` 上傳直接執行，無 runtime 依賴 |

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
┌──────────────────────────────────────────┐
│                Browser                    │
│         (Vue 3 SPA + 自訂 CSS)            │
└──────────────┬───────────────────────────┘
               │ HTTP (Cookie Session)
               │ /api/v1/*  JSON API
               │ /*         SPA static files
┌──────────────▼───────────────────────────┐
│           Go Binary (單一執行檔)           │
│                                           │
│  ┌─────────┐  ┌──────────┐  ┌─────────┐ │
│  │  chi    │  │  auth    │  │ systemd │ │
│  │ router  │──│ middleware│──│ handler │ │
│  └────┬────┘  └──────────┘  └────┬────┘ │
│       │                          │       │
│  ┌────▼────┐              ┌──────▼─────┐ │
│  │ embed   │              │  godbus/   │ │
│  │ static/ │              │  dbus5     │ │
│  │ (Vue    │              └──────┬─────┘ │
│  │  SPA)   │                     │       │
│  └─────────┘                     │       │
└──────────────────────────────────┼───────┘
                                   │ D-Bus
                          ┌────────▼────────┐
                          │    systemd       │
                          │  (系統 init)     │
                          └─────────────────┘
```

## 🚀 快速開始

### 一行指令安裝

```bash
curl -fsSL https://raw.githubusercontent.com/YuHaoLiaoSideProject/LinuxServiceManger/main/install.sh | bash
```

會自動下載最新版 binary，並可選擇安裝 systemd service 自動啟動。

指定版本：

```bash
curl -fsSL https://raw.githubusercontent.com/YuHaoLiaoSideProject/LinuxServiceManger/main/install.sh | bash -s -- --tag v1.0.0
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
| `UNLOCKED_SERVICES` | (空) | 解鎖指定服務的 glob 模式，逗號分隔（見下方說明） |

> ⚠️ **重要**：`ADMIN_PASS` 和 `SESSION_KEY` 兩個環境變數必須明確設定，使用預設值會導致程式拒絕啟動。

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
│   ├── main.go                    # 進入點 (Go embed static/)
│   ├── go.mod / go.sum            # Go module 依賴
│   ├── internal/
│   │   ├── auth/
│   │   │   ├── auth.go            # Session 管理、登入驗證
│   │   │   └── auth_test.go       # Session 測試
│   │   ├── handler/
│   │   │   ├── handler.go         # HTML/htmx 路由（legacy）+ 頁面路由
│   │   │   ├── handler_test.go    # JSON API 測試
│   │   │   └── json_handler.go    # JSON API (/api/v1/*) handlers
│   │   ├── middleware/
│   │   │   ├── auth.go            # 認證 middleware（HTML redirect + JSON 401）
│   │   │   └── auth_test.go       # middleware 測試
│   │   └── systemd/
│   │       ├── systemd.go         # D-Bus / systemctl 操作 systemd
│   │       └── systemd_test.go    # systemd 測試
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
│   │   │   └── DashboardView.vue  # 儀表板（服務管理）
│   │   ├── components/
│   │   │   ├── AppHeader.vue      # 頁首：重新整理、登出、主題/語言切換
│   │   │   ├── ConfirmModal.vue   # Stop/Restart 確認對話框
│   │   │   ├── LoginForm.vue      # 登入表單
│   │   │   ├── ServiceRow.vue     # 單一服務列（含操作按鈕）
│   │   │   ├── ServiceTable.vue   # 可排序、可篩選的服務表格
│   │   │   ├── StatsBar.vue       # 統計列：總數 / 執行中 / 失敗
│   │   │   ├── TabsBar.vue        # 分頁：我的服務 / 系統服務
│   │   │   ├── ToastContainer.vue # Toast 通知容器
│   │   │   └── Toolbar.vue        # 搜尋欄
│   │   ├── composables/
│   │   │   ├── useI18n.ts         # 繁體中文 / English 翻譯
│   │   │   ├── useTheme.ts        # 亮色 / 暗色主題
│   │   │   └── useToast.ts        # Toast 通知狀態
│   │   ├── stores/
│   │   │   └── auth.ts            # Pinia 認證 store
│   │   ├── api/
│   │   │   └── client.ts          # Axios API 客戶端
│   │   ├── router/
│   │   │   └── index.ts           # Vue Router 設定
│   │   ├── types/
│   │   │   └── service.ts         # TypeScript 型別定義
│   │   └── __tests__/             # 元件與 composable 單元測試
│   └── ...                        # Vite 設定、package.json 等
├── scripts/
│   ├── deploy.sh                  # 部署腳本
│   └── check.sh                   # 檢查腳本
├── install.sh                     # 一鍵安裝腳本
├── Makefile                       # build / run / dev / frontend / deploy
└── docs/
    ├── bdds/                      # BDD 場景定義（Gherkin）
    ├── user-stories/              # User Story 文件
    └── development/               # 開發決策文件
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

## 📖 相關文件

- [User Story: 管理員登入系統](docs/user-stories/001-管理員登入系統.md)
- [User Story: 管理員管理 systemd 服務](docs/user-stories/002-管理員管理systemd服務.md)
- [User Story: 部署安全性](docs/user-stories/003-部署安全性.md)
- [BDD: 管理員登入系統](docs/bdds/001-管理員登入系統.feature)
- [BDD: 管理員管理 systemd 服務](docs/bdds/002-管理員管理systemd服務.feature)
- [BDD: 部署安全性](docs/bdds/003-部署安全性.feature)
- [測試計畫](docs/test-plans/)
- [開發方案決策文件](docs/development/001-linux-service-manager.md)

## 📝 License

MIT
