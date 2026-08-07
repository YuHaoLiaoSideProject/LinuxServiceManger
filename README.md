# 🖥 Linux Service Manager

一套用 Go 打造的輕量級 Web 管理面板，讓你可以透過瀏覽器遠端管理 Linux 上的 systemd 服務。

[![Go Version](https://img.shields.io/badge/Go-1.22%2B-00ADD8?logo=go)](https://go.dev)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## ✨ 功能特色

| 模組 | 功能 |
|------|------|
| 🔐 **管理員登入** | 帳號密碼驗證、Cookie-based session、30 分鐘閒置逾時 |
| 📋 **服務列表** | 即時查詢所有 systemd 服務，含 Load / Active / Sub 狀態 |
| ▶️ **服務操作** | Start、Stop、Restart，支援二次確認對話框 |
| 🔒 **服務保護** | 僅 `/etc/systemd/system/` 下的自訂服務可操作，系統服務自動鎖定；可透過環境變數解鎖 |
| 🔍 **搜尋過濾** | 前端即時搜尋，支援分頁（我的服務 / 系統服務） |
| 📊 **狀態統計** | 總服務數、執行中、失敗數量一目了然 |
| 🌗 **深色模式** | 支援亮色 / 暗色主題切換，記憶偏好 |
| 🌐 **雙語介面** | 繁體中文 / English 切換 |
| 📱 **RWD 響應式** | 桌面表格、平板精簡、手機卡片三種佈局 |
| 🚀 **單檔部署** | 一個不到 15MB 的 binary，`scp` 上傳直接執行，無 runtime 依賴 |

## 🛠 技術棧

| 層級 | 技術 | 用途 |
|------|------|------|
| 語言 | Go 1.22+ | 後端全部 |
| Router | [chi v5](https://github.com/go-chi/chi) | HTTP routing + middleware |
| 模板 | `html/template` | 伺服器端渲染 |
| 前端互動 | [htmx 2.0](https://htmx.org) | AJAX 請求、局部更新、確認對話框 |
| 前端樣式 | [PicoCSS](https://picocss.com) | 輕量 classless CSS |
| systemd | [godbus/dbus5](https://github.com/godbus/dbus) + `systemctl` fallback | D-Bus 操作 systemd |
| Session | [gorilla/sessions](https://github.com/gorilla/sessions) | Cookie-based session |
| 建構 | Go embed + Makefile | 內嵌模板與靜態檔 |

### 架構圖

```
┌──────────────────────────────────────────┐
│                Browser                    │
│         (htmx + PicoCSS)                  │
└──────────────┬───────────────────────────┘
               │ HTTP (Cookie Session)
┌──────────────▼───────────────────────────┐
│           Go Binary (單一執行檔)           │
│                                           │
│  ┌─────────┐  ┌──────────┐  ┌─────────┐ │
│  │  chi    │  │  auth    │  │ systemd │ │
│  │ router  │──│ middleware│──│ handler │ │
│  └────┬────┘  └──────────┘  └────┬────┘ │
│       │                          │       │
│  ┌────▼────┐              ┌──────▼─────┐ │
│  │ html/   │              │  godbus/   │ │
│  │template │              │  dbus5     │ │
│  └─────────┘              └──────┬─────┘ │
│                                  │       │
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
# 設定環境變數（可選，未設定會使用預設值）
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

# 本機編譯
make build

# 交叉編譯 Linux amd64
make linux-build

# 直接執行（開發模式）
make run
```

手動編譯：

```bash
cd src
go build -o ../linux-service-manager main.go
```

## ⚙️ 環境變數

| 變數 | 預設值 | 說明 |
|------|--------|------|
| `ADMIN_USER` | `admin` | 管理員帳號 |
| `ADMIN_PASS` | `admin123` | 管理員密碼 |
| `SESSION_KEY` | `linux-service-manager-secret-key-change-me` | Session 加密金鑰，**生產環境請務必更換** |
| `PORT` | `8080` | HTTP 監聽埠號 |
| `UNLOCKED_SERVICES` | (空) | 解鎖指定服務的 glob 模式，逗號分隔（見下方說明） |

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
├── main.go                        # 進入點
├── go.mod / go.sum                # Go module 依賴
├── Makefile                       # build / run / cross-compile
├── deploy.sh                      # 部署腳本
├── internal/
│   ├── auth/
│   │   └── auth.go                # session 管理、登入驗證
│   ├── handler/
│   │   └── handler.go             # HTTP handler（頁面 + API）
│   ├── middleware/
│   │   └── auth.go                # 認證 middleware
│   └── systemd/
│       └── systemd.go             # D-Bus / systemctl 操作 systemd
├── templates/
│   ├── index.html                 # 主頁面（服務列表、儀表板）
│   └── login.html                 # 登入頁面
├── docs/
│   ├── bdds/                      # BDD 場景定義（Gherkin）
│   ├── user-stories/              # User Story 文件
│   └── development/               # 開發決策文件
└── test/                          # 測試
```

## 🔌 API 路由

| 方法 | 路徑 | 說明 | 認證 |
|------|------|------|:----:|
| `GET` | `/login` | 登入頁面 | ❌ |
| `POST` | `/login` | 提交登入 | ❌ |
| `GET` | `/logout` | 登出 | ✅ |
| `GET` | `/` | 服務列表頁（完整 HTML） | ✅ |
| `GET` | `/services` | 服務列表（htmx 局部刷新） | ✅ |
| `POST` | `/api/services/{name}/start` | 啟動服務 | ✅ |
| `POST` | `/api/services/{name}/stop` | 停止服務 | ✅ |
| `POST` | `/api/services/{name}/restart` | 重啟服務 | ✅ |

## 📦 部署

### 快速部署

專案內附 `deploy.sh` 腳本，會自動編譯、停止舊服務、安裝 binary、啟動服務：

```bash
sudo ./deploy.sh
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
| **預設帳密** | 務必透過環境變數更換 `ADMIN_USER` 和 `ADMIN_PASS` |
| **Session Key** | 務必更換 `SESSION_KEY` 為隨機長字串 |
| **HTTPS** | 生產環境請搭配 reverse proxy 啟用 HTTPS |
| **權限** | 避免以 root 直接執行，可考慮使用 `sudo` 或 polkit 設定 |
| **防護** | 登入頁面有簡易的帳號鎖定機制（連續失敗） |

## 📖 相關文件

- [User Story: 管理員登入系統](docs/user-stories/001-管理員登入系統.md)
- [User Story: 管理員管理 systemd 服務](docs/user-stories/002-管理員管理systemd服務.md)
- [BDD: 管理員登入系統](docs/bdds/001-管理員登入系統.feature)
- [BDD: 管理員管理 systemd 服務](docs/bdds/002-管理員管理systemd服務.feature)
- [開發方案決策文件](docs/development/001-linux-service-manager.md)

## 📝 License

MIT
