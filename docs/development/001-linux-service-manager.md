# 開發方案決策文件：Linux Service Manager

> **📝 文件狀態**：本文件為活文件（living document），已根據專案實際演進更新。
> 前端技術棧已從初始的 htmx + PicoCSS 升級為 Vue 3 SPA（詳見下方「架構演進記錄」）。

## 📌 決策摘要

| 項目 | 內容 |
|------|------|
| **最終方案** | Go 單一執行檔 + 內嵌 Vue 3 SPA 前端 |
| **初始決策日期** | 2025-07-15 |
| **前端升級日期** | 2025-08（Vue 3 SPA 取代 htmx） |
| **參與討論** | 團隊管理員 |
| **共識程度** | ✅ 一致通過 |

---

## 1. 需求回顧

| 編號 | 功能 | 優先級 | 複雜度 |
|------|------|--------|--------|
| 001 | 管理員登入系統（帳號密碼、session、閒置逾時、鎖定） | Must | S |
| 002 | systemd 服務管理（列表查詢、Start、Stop、Restart、二次確認） | Must | M |

- **使用者**：小團隊管理員，需登入驗證
- **範圍**：單台 Linux 機器，操作本地 systemd
- **時程**：無壓力，品質優先
- **環境**：任意 Linux 發行版（支援 systemd）

詳細需求見：
- `docs/user-stories/001-管理員登入系統.md`
- `docs/user-stories/002-管理員管理systemd服務.md`
- `docs/bdds/001-管理員登入系統.feature`
- `docs/bdds/002-管理員管理systemd服務.feature`

---

## 2. 候選方案

| 方案 | 技術棧 | 部署方式 |
|------|--------|---------|
| 🟢 A | Go + Chi router + html/template + htmx | 單一 binary |
| 🟡 B | Python FastAPI + Jinja2 + htmx | uvicorn + venv + pip |
| 🔵 C | Node.js Express + Vue 3 SPA | node + npm install |

---

## 3. 權衡評估

| 維度 | 🟢 Go 單檔 | 🟡 Python FastAPI | 🔵 Node.js + Vue |
|------|:---:|:---:|:---:|
| 🎯 需求符合度 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| ⚡ 開發速度 | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| 🔧 維護成本 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ |
| 📈 擴充性 | ⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| 👥 學習門檻 | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| 💰 基礎設施成本 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ |
| 🔒 穩定性與成熟度 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| 🚀 部署簡易度 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ |

---

## 4. 決策理由

### 🏆 選擇：Go 單一執行檔

**為什麼選 Go：**

1. **部署最簡** — 一個 10MB 不到的 binary，`scp` 上傳直接執行，零 runtime 依賴。完全符合「簡單網頁架在 Linux」的初衷
2. **維護成本最低** — 編譯後無 pip/npm/node_modules，不會有依賴地獄。半年後拿出來照樣能跑
3. **系統親和性最佳** — Go 原生支援 cross-compile（在 Mac/Windows 上交叉編譯 Linux binary）、可直接透過 dbus 操作 systemd，不依賴 shell 權限
4. **htmx 足夠用** — 這個工具本質是「遠端 systemctl 面板」：列表、按鈕、確認對話框。htmx 就能做到 AJAX 更新，不需要 SPA 框架的複雜度

**為什麼不選：**

| 方案 | 理由 |
|------|------|
| Python FastAPI | 開發快但部署需 Python runtime + venv + pip，長期維護依賴管理負擔較高 |
| Node.js + Vue | SPA + API 分離架構對這個規模過重，多了 Vite 建構流程和 node_modules 負擔 |

---

## 5. 行動計畫

### 🔄 架構演進記錄

專案最初依決策文件以 **htmx + PicoCSS** 實作前端，路由為伺服器端渲染（SSR）模式。開發完成後，為提升使用者體驗（客戶端路由、無閃爍頁面切換、更豐富的互動），決定將前端升級為 **Vue 3 SPA**，同時保留原有 htmx 路由作為向後相容。後端 Go API 層從單純的 htmx partial 渲染，擴展為同時提供 JSON API（給 Vue SPA 使用）與 HTML 路由（legacy htmx）。

### 5.1 技術棧（現行）

| 層級 | 技術 | 版本 | 用途 |
|------|------|------|------|
| 語言 | Go | 1.22+ | 後端全部 |
| Router | chi | v5 | HTTP routing + middleware |
| Session | gorilla/sessions | - | Cookie-based session |
| systemd | godbus/dbus5 + systemctl fallback | - | D-Bus 操作 systemd，權限不足時 fallback 到 shell |
| **前端框架** | Vue 3 (TypeScript) | ^3.5 | SPA 單頁應用 |
| **前端建構** | Vite | ^8.2 | 開發伺服器 / 打包 |
| **狀態管理** | Pinia | ^4.0 | 前端全域狀態（auth） |
| **前端路由** | vue-router | ^4.6 | 客戶端路由（/login、/dashboard） |
| **HTTP 客戶端** | axios | ^1.19 | 前端 API 呼叫 |
| **前端樣式** | Custom CSS | - | 自訂 CSS（部分使用 PicoCSS 變數於登入表單） |
| **i18n** | 自訂 composable (useI18n) | - | 支援 zh-TW / en |
| **主題** | 自訂 composable (useTheme) | - | 深色/淺色模式（系統偏好偵測 + localStorage） |
| **前端測試** | Vitest + @vue/test-utils | ^4.1 / ^2.4 | 元件單元測試 |
| **後端測試** | Go testing | stdlib | handler 測試 |
| 建構 | Makefile + Vite + Go embed | - | Vite 輸出到 src/static/，Go embed 內嵌 |

<details>
<summary>📦 初始技術棧（已棄用，供參考）</summary>

| 層級 | 技術 | 版本 | 用途 |
|------|------|------|------|
| 語言 | Go | 1.22+ | 後端全部 |
| Router | chi | v5 | HTTP routing + middleware |
| 模板 | html/template | stdlib | 伺服器端渲染頁面 |
| 前端互動 | htmx | 2.0 | AJAX 請求、局部更新、確認對話框 |
| 前端樣式 | PicoCSS | - | 輕量 classless CSS |
| systemd | godbus/dbus5 | - | 直接透過 D-Bus 操作 systemd |
| Session | gorilla/sessions | - | Cookie-based session |
| 建構 | Makefile + Go embed | - | 內嵌模板與靜態檔 |

</details>

### 5.2 架構概覽（現行）

```
┌──────────────────────────────────────────────┐
│                 Browser                       │
│   Vue 3 SPA                                  │
│   ┌──────────┐ ┌──────────┐ ┌────────────┐  │
│   │ Pinia    │ │ vue-router│ │ composables│  │
│   │ (auth)   │ │ (/login, │ │ (useI18n,  │  │
│   │          │ │ /dashboard)│ │ useTheme,  │  │
│   │          │ │          │ │ useToast)  │  │
│   └──────────┘ └──────────┘ └────────────┘  │
│                                               │
│   Custom CSS (部分 PicoCSS 變數)              │
└──────────────┬────────────────────────────────┘
               │ HTTP (Cookie Session / JSON API)
┌──────────────▼────────────────────────────────┐
│             Go Binary (單一執行檔)             │
│                                                │
│  ┌──────────┐  ┌──────────┐  ┌─────────────┐ │
│  │   chi    │  │   auth   │  │   systemd   │ │
│  │  router  │──│middleware│──│  handler     │ │
│  └────┬─────┘  └──────────┘  └──────┬──────┘ │
│       │                             │         │
│  ┌────▼──────┐  ┌────────────┐ ┌───▼───────┐ │
│  │ JSON API  │  │  Legacy    │ │ godbus/   │ │
│  │ handlers  │  │  HTML/htmx │ │ dbus5 +   │ │
│  │(/api/v1/*)│  │  handlers  │ │ systemctl │ │
│  └───────────┘  └────────────┘ └─────┬─────┘ │
│                                      │        │
│  ┌────────────────────┐              │        │
│  │ //go:embed static/ │              │        │
│  │ (Vite 建構產出)     │              │        │
│  └────────────────────┘              │        │
└──────────────────────────────────────┼────────┘
                                       │ D-Bus
                              ┌────────▼────────┐
                              │    systemd       │
                              │  (系統 init)     │
                              └─────────────────┘
```

### 5.3 路由設計（現行）

#### JSON API（Vue 3 SPA 使用）

| 方法 | 路徑 | 說明 | 認證 |
|------|------|------|------|
| `POST` | `/api/v1/login` | 登入（form-urlencoded） | ❌ |
| `POST` | `/api/v1/logout` | 登出 | ❌ |
| `GET` | `/api/v1/session` | 檢查 session 狀態 | ❌ |
| `GET` | `/api/v1/services` | 服務列表（JSON） | ✅ |
| `POST` | `/api/v1/services/{name}/start` | 啟動服務 | ✅ |
| `POST` | `/api/v1/services/{name}/stop` | 停止服務 | ✅ |
| `POST` | `/api/v1/services/{name}/restart` | 重啟服務 | ✅ |

#### Legacy HTML 路由（htmx，保留向後相容）

| 方法 | 路徑 | 說明 | 認證 |
|------|------|------|------|
| `GET` | `/htmx` | htmx 服務列表頁 | ✅ |
| `GET` | `/services` | htmx 服務列表（partial） | ✅ |
| `POST` | `/api/services/{name}/start` | 啟動服務（htmx） | ✅ |
| `POST` | `/api/services/{name}/stop` | 停止服務（htmx） | ✅ |
| `POST` | `/api/services/{name}/restart` | 重啟服務（htmx） | ✅ |

> Vue SPA 透過 vue-router 處理客戶端路由（`/login`、`/dashboard`），所有資料操作經由 `/api/v1/*` JSON API。

### 5.4 專案結構（現行）

```
linux-service-manager/
├── src/                         # Go 後端
│   ├── main.go                  # 進入點：chi router 設定、embed 靜態檔
│   ├── go.mod / go.sum
│   ├── internal/
│   │   ├── auth/
│   │   │   └── auth.go          # session 管理、登入驗證
│   │   ├── handler/
│   │   │   ├── handler.go       # HTML/htmx 路由 handler
│   │   │   ├── handler_test.go  # 後端測試
│   │   │   └── json_handler.go  # JSON API (/api/v1/*) handler
│   │   ├── middleware/
│   │   │   └── auth.go          # 認證 middleware
│   │   └── systemd/
│   │       └── systemd.go       # D-Bus + systemctl fallback
│   ├── templates/               # Legacy htmx 模板
│   │   ├── index.html
│   │   └── login.html
│   └── static/                  # Vite 建構產出（Go embed 內嵌）
├── frontend/                    # Vue 3 SPA 原始碼
│   ├── src/
│   │   ├── main.ts              # Vue 入口：Pinia + router + mount
│   │   ├── App.vue
│   │   ├── views/
│   │   │   ├── LoginView.vue
│   │   │   └── DashboardView.vue
│   │   ├── components/
│   │   │   ├── AppHeader.vue
│   │   │   ├── ConfirmModal.vue # 操作確認對話框
│   │   │   ├── LoginForm.vue
│   │   │   ├── ServiceRow.vue
│   │   │   ├── ServiceTable.vue
│   │   │   ├── StatsBar.vue     # 服務狀態統計
│   │   │   ├── TabsBar.vue      # 分頁（全部/已啟用/已停用）
│   │   │   ├── ToastContainer.vue
│   │   │   └── Toolbar.vue
│   │   ├── composables/
│   │   │   ├── useI18n.ts       # zh-TW / en
│   │   │   ├── useTheme.ts      # 深色/淺色模式
│   │   │   └── useToast.ts
│   │   ├── stores/
│   │   │   └── auth.ts          # Pinia auth store
│   │   ├── api/
│   │   │   └── client.ts        # axios 實例 + API 函式
│   │   ├── router/
│   │   │   └── index.ts         # vue-router 設定
│   │   ├── types/
│   │   │   └── service.ts       # TypeScript 型別定義
│   │   ├── style.css            # 全域自訂樣式
│   │   └── __tests__/
│   │       ├── LoginView.spec.ts
│   │       ├── ServiceTable.spec.ts
│   │       ├── StatsBar.spec.ts
│   │       └── TabsBar.spec.ts
│   ├── __tests__/               # （別名，與 src/__tests__ 對應）
│   └── ...
├── scripts/
│   ├── deploy.sh
│   └── check.sh
├── install.sh
├── Makefile
└── docs/
```

### 5.5 任務拆分（含執行狀態）

#### 階段一：基礎架構（htmx 時期）

| # | 任務 | 預估 | 狀態 | 對應 BDD |
|---|------|------|------|----------|
| 1 | Go 專案初始化（go mod、目錄結構、Makefile） | 0.5d | ✅ 完成 | - |
| 2 | systemd 模組：D-Bus 串接（list/start/stop/restart + systemctl fallback） | 1d | ✅ 完成 | - |
| 3 | Auth 模組：session 管理、帳號驗證 | 0.5d | ✅ 完成 | - |
| 4 | 登入頁面 + handler（GET/POST /login、/logout） | 0.5d | ✅ 完成 | 001 |
| 5 | 服務列表頁 + htmx partial 渲染（GET /、/services） | 1d | ✅ 完成 | 002 (查詢) |
| 6 | 登入錯誤處理（錯誤密碼、帳號鎖定） | 0.5d | ✅ 完成 | 001 (錯誤) |
| 7 | 閒置逾時自動登出 | 0.5d | ✅ 完成 | 001 (逾時) |
| 8 | Start/Stop/Restart API + htmx 局部更新 | 1d | ✅ 完成 | 002 (操作) |
| 9 | Stop/Restart 二次確認對話框（htmx `hx-confirm`） | 0.5d | ✅ 完成 | 002 (確認) |
| 10 | 按鈕狀態邏輯（禁用已啟動的 Start、已停止的 Stop） | 0.5d | ✅ 完成 | 002 (狀態) |
| 11 | 錯誤處理（權限不足、操作失敗提示） | 0.5d | ✅ 完成 | 002 (錯誤) |
| 12 | 服務搜尋過濾（前端 + htmx） | 0.5d | ✅ 完成 | 002 (搜尋) |
| 13 | 邊界案例處理（特殊字元、衝突操作） | 0.5d | ✅ 完成 | 002 (邊界) |
| 14 | Makefile cross-compile + 部署腳本 | 0.5d | ✅ 完成 | - |

#### 階段二：前端升級 Vue 3 SPA

| # | 任務 | 預估 | 狀態 | 說明 |
|---|------|------|------|------|
| 15 | Vue 3 專案初始化（Vite、TypeScript、Pinia、vue-router、axios） | 0.5d | ✅ 完成 | `frontend/` 目錄 |
| 16 | JSON API 層開發（`/api/v1/*` routes，`json_handler.go`） | 0.5d | ✅ 完成 | 與 htmx handler 並存 |
| 17 | LoginView + auth store + session 檢查 | 1d | ✅ 完成 | Pinia auth store、LoginForm 元件 |
| 18 | DashboardView + ServiceTable + ServiceRow | 1d | ✅ 完成 | 服務列表與操作 |
| 19 | StatsBar（服務狀態統計） + TabsBar（分頁） | 0.5d | ✅ 完成 | 全部/已啟用/已停用 |
| 20 | ConfirmModal + ToastContainer 元件 | 0.5d | ✅ 完成 | 操作確認與通知 |
| 21 | useI18n composable（zh-TW / en） | 0.5d | ✅ 完成 | 自訂 i18n |
| 22 | useTheme composable（深色/淺色 + 系統偏好 + localStorage） | 0.5d | ✅ 完成 | 主題切換 |
| 23 | AppHeader + Toolbar 元件 | 0.5d | ✅ 完成 | 導航與工具列 |
| 24 | Custom CSS（部分整合 PicoCSS 變數於登入表單） | 0.5d | ✅ 完成 | `style.css` |
| 25 | 前端單元測試（Vitest）：LoginView、ServiceTable、StatsBar、TabsBar | 1d | ✅ 完成 | 4 個 spec 檔 |
| 26 | Go 後端測試擴充（`handler_test.go`） | 0.5d | ✅ 完成 | JSON + HTML handler |
| 27 | Vite 建構整合：輸出到 `src/static/`，Go embed 內嵌 | 0.5d | ✅ 完成 | Single binary 部署不變 |
| 28 | 整合測試 / Smoke test | 0.5d | ✅ 完成 | - |

**總實際工時：約 15 天（含兩階段開發，單人開發）**

### 5.6 有待驗證的項目 (Spike) — 驗證結果

- ✅ **D-Bus 權限**：一般使用者可能無法透過 D-Bus 操作 systemd；已實作 `systemctl` shell fallback，可透過 sudo 配置解決
- ✅ **htmx 確認對話框**：`hx-confirm` 可滿足二次確認需求；Vue 升級後改用 ConfirmModal 元件
- ✅ **Cross-compile**：已在 macOS 上成功交叉編譯 Linux binary（CGO_ENABLED=0 + GOOS=linux）
- ✅ **Vite + Go embed 整合**：Vite 建構產出至 `src/static/`，Go 透過 `//go:embed static/*` 內嵌，單一 binary 部署模式保持不變

---

## 6. 風險登錄

| 風險 | 可能性 | 影響 | 緩解措施 | 狀態 |
|------|--------|------|---------|------|
| systemd D-Bus 權限不足 | 中 | 高 | 已實作 `os/exec` 呼叫 `systemctl` 作為 fallback，文件說明 sudo 配置 | ✅ 已緩解 |
| Go template 功能不足 | 低 | 低 | html/template 足以處理列表渲染（htmx 階段已驗證）；Vue SPA 已完全取代模板渲染 | ✅ 已消除 |
| htmx 使用者體驗限制 | — | — | 已升級為 Vue 3 SPA，提供無閃爍頁面切換、客戶端路由、豐富互動 | ✅ 已解決 |
| 多人同時操作衝突 | 低 | 中 | systemd 本身會處理併發操作，前端顯示最新狀態 | ⏳ 持續監控 |
| Vue SPA 首次載入體積 | 低 | 低 | Vite tree-shaking + code split；SPA 資源由 Go binary 內嵌提供，無 CDN 依賴 | ✅ 已緩解 |

---

## 📝 決策後續

- 本文件存至 `docs/development/001-linux-service-manager.md`，已納入版本控制
- 前端已於 2025 年 8 月從 htmx 升級為 Vue 3 SPA，本文件已更新以反映現況
- 建議功能上線 1 個月後回顧架構決策正確性
- 若未來需求擴充至多機管理，可考慮加入 agent 模式

---

*最後更新：2025-08-07 — 前端升級為 Vue 3 SPA，更新全部技術棧、路由、專案結構與任務狀態*
