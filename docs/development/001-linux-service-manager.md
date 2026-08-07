# 開發方案決策文件：Linux Service Manager

## 📌 決策摘要

| 項目 | 內容 |
|------|------|
| **最終方案** | Go 單一執行檔 + 內嵌前端（htmx） |
| **決策日期** | 2025-07-15 |
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

### 5.1 技術棧

| 層級 | 技術 | 版本 | 用途 |
|------|------|------|------|
| 語言 | Go | 1.22+ | 後端全部 |
| Router | chi | v5 | HTTP routing + middleware |
| 模板 | html/template | stdlib | 伺服器端渲染頁面 |
| 前端互動 | htmx | 2.0 | AJAX 請求、局部更新、確認對話框 |
| 前端樣式 | PicoCSS 或 MVP.css | - | 輕量 classless CSS |
| systemd | godbus/dbus5 | - | 直接透過 D-Bus 操作 systemd |
| Session | gorilla/sessions | - | Cookie-based session |
| 建構 | Makefile + Go embed | - | 內嵌模板與靜態檔 |

### 5.2 架構概覽

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

### 5.3 路由設計

| 方法 | 路徑 | 說明 | 認證 |
|------|------|------|------|
| `GET` | `/login` | 登入頁面 | ❌ |
| `POST` | `/login` | 提交登入 | ❌ |
| `GET` | `/logout` | 登出 | ✅ |
| `GET` | `/` | 服務列表頁 | ✅ |
| `GET` | `/api/services` | JSON 服務列表（htmx 刷新） | ✅ |
| `POST` | `/api/services/{name}/start` | 啟動服務 | ✅ |
| `POST` | `/api/services/{name}/stop` | 停止服務 | ✅ |
| `POST` | `/api/services/{name}/restart` | 重啟服務 | ✅ |

### 5.4 建議專案結構

```
linux-service-manager/
├── main.go                    # 進入點
├── go.mod
├── Makefile                   # build / run / cross-compile
├── internal/
│   ├── auth/
│   │   └── auth.go            # session 管理、登入驗證
│   ├── handler/
│   │   ├── auth.go            # 登入/登出 handler
│   │   └── service.go         # 服務列表 + 操作 handler
│   ├── middleware/
│   │   └── auth.go            # 認證 middleware
│   └── systemd/
│       └── systemd.go         # D-Bus 操作 systemd（list/start/stop/restart）
├── templates/
│   ├── layout.html            # 共用佈局（nav、flash message）
│   ├── login.html             # 登入頁
│   └── services.html          # 服務列表頁（含 htmx 屬性）
├── static/
│   └── style.css              # 自訂樣式微調（可選）
└── embed.go                   //go:embed templates static
```

### 5.5 初期任務拆分

| # | 任務 | 預估工時 | 依賴 | 對應 BDD |
|---|------|---------|------|----------|
| 1 | Go 專案初始化（go mod、目錄結構、Makefile） | 0.5d | - | - |
| 2 | systemd 模組：D-Bus 串接（list/start/stop/restart） | 1d | #1 | - |
| 3 | Auth 模組：session 管理、帳號驗證 | 0.5d | #1 | - |
| 4 | 登入頁面 + handler（GET/POST /login、/logout） | 0.5d | #3 | 001 |
| 5 | 服務列表頁 + API（GET /、GET /api/services） | 1d | #2, #3 | 002 (查詢) |
| 6 | 登入錯誤處理（錯誤密碼、帳號鎖定） | 0.5d | #4 | 001 (錯誤) |
| 7 | 閒置逾時自動登出 | 0.5d | #3 | 001 (逾時) |
| 8 | Start/Stop/Restart API + htmx 局部更新 | 1d | #2, #5 | 002 (操作) |
| 9 | Stop/Restart 二次確認對話框（htmx） | 0.5d | #8 | 002 (確認) |
| 10 | 按鈕狀態邏輯（禁用已啟動的 Start、已停止的 Stop） | 0.5d | #8 | 002 (狀態) |
| 11 | 錯誤處理（權限不足、操作失敗提示） | 0.5d | #8 | 002 (錯誤) |
| 12 | 服務搜尋過濾（前端 + API） | 0.5d | #5 | 002 (搜尋) |
| 13 | 邊界案例處理（特殊字元、衝突操作） | 0.5d | #8 | 002 (邊界) |
| 14 | Makefile cross-compile + 部署腳本 | 0.5d | #1 | - |
| 15 | Smoke test 全走一次 BDD scenarios | 0.5d | #1~14 | 全部 |

**總預估工時：約 8.5 天（單人開發）**

### 5.6 有待驗證的項目 (Spike)

- D-Bus 權限：一般 Linux 使用者是否能透過 D-Bus 操作 systemd（可能需要 polkit 設定或 sudo 配置）
- htmx 確認對話框：Stop/Restart 的二次確認是否能完全用 htmx 實作（`hx-confirm` 屬性應可滿足）
- Cross-compile：在 macOS 上交叉編譯 Linux binary 與 static linking 設定

---

## 6. 風險登錄

| 風險 | 可能性 | 影響 | 緩解措施 |
|------|--------|------|---------|
| systemd D-Bus 權限不足 | 中 | 高 | 改用 `os/exec` 呼叫 `systemctl` 作為 fallback，或文件說明 sudo 配置 |
| Go template 功能不足 | 低 | 低 | html/template 足以處理列表渲染；若不足可改用快速模板引擎如 `quicktemplate` |
| htmx 確認對話框網路延遲 | 低 | 低 | htmx 是 client-side 確認，不依賴網路 |
| 多人同時操作衝突 | 低 | 中 | systemd 本身會處理併發操作，只需在前端顯示最新狀態 |

---

## 📝 決策後續

- 本文件存至 `docs/tech-decision-linux-service-manager-2025-07-15.md`，應納入版本控制
- 建議功能上線 1 個月後回顧架構決策正確性
- 若未來需求擴充至多機管理，可考慮加入 agent 模式
