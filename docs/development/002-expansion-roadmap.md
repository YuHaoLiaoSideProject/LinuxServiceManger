# 擴充方向規劃

> **建立日期**：2025-08-07
> **狀態**：規劃中，待討論優先順序

---

## 總覽

以下擴充方向依複雜度分為三級，涵蓋功能補完、體驗提升與重大架構擴充。

---

## 🟢 低複雜度（可快速實現）

### 1. Enable / Disable 服務

| 項目 | 內容 |
|------|------|
| **現狀** | 目前僅支援 start / stop / restart，缺少 `systemctl enable/disable` |
| **目標** | 新增 enable / disable 操作，讓使用者可以設定服務開機啟動與否 |
| **改動範圍** | `systemd.go` 模組 → 新增 `EnableService()` / `DisableService()` 、JSON API → `POST /api/v1/services/{name}/enable` / `disable` 、前端 ServiceRow.vue 加入按鈕 |
| **注意事項** | enable/disable 需要 root 權限（修改 symlink），權限不足時需 fallback 提示 |

### 2. journalctl 日誌檢視器

| 項目 | 內容 |
|------|------|
| **現狀** | 無日誌檢視功能，使用者需 SSH 進機器執行 `journalctl -u xxx` |
| **目標** | 在 Web UI 中直接查看服務的即時日誌，支援捲動與行數限制 |
| **改動範圍** | 新增 `GET /api/v1/services/{name}/logs?lines=100` endpoint → 執行 `journalctl -u {name} -n {lines} --no-pager` → 回傳純文字 / JSON 、前端新增 LogViewer.vue（modal 或側面板） |
| **擴充可能** | 後續可加入 WebSocket 即時 tail log、時間範圍篩選、關鍵字搜尋 |

### 3. 更多語言支援

| 項目 | 內容 |
|------|------|
| **現狀** | 繁體中文 (zh-TW) 與 English (en) |
| **目標** | 加入日文 (ja)、簡體中文 (zh-CN) 等 |
| **改動範圍** | 擴充 `useI18n.ts` 翻譯表、新增語言切換選項 |
| **注意事項** | `useI18n` 已是自訂 composable，無需額外依賴 |

### 4. 服務搜尋強化

| 項目 | 內容 |
|------|------|
| **現狀** | Toolbar.vue 提供基本文字搜尋，前端即時篩選 |
| **目標** | 加入正則搜尋模式、按 Active 狀態過濾（running / failed / inactive）的快速切換按鈕 |
| **改動範圍** | Toolbar.vue 新增過濾按鈕組、ServiceTable.vue 擴充篩選邏輯 |
| **擴充可能** | 後續可支援 URL query string 保留搜尋 / 過濾狀態 |

### 5. PWA 支援

| 項目 | 內容 |
|------|------|
| **現狀** | RWD 響應式設計已支援手機瀏覽器 |
| **目標** | 加入 service worker + web manifest，讓手機可以「安裝」成獨立 App |
| **改動範圍** | 安裝 `vite-plugin-pwa`、新增 `manifest.json`、設定 service worker 快取策略 |
| **注意事項** | SPA 資源由 Go binary 內嵌提供，需確認 service worker scope 正確 |

---

## 🟡 中複雜度（需適量開發）

### 6. WebSocket 即時狀態推送

| 項目 | 內容 |
|------|------|
| **現狀** | 前端透過 polling / 手動重整來更新服務狀態 |
| **目標** | 後端主動推送服務狀態變更到瀏覽器，實現即時更新 |
| **改動範圍** | Go 端加入 `gorilla/websocket`（或 `nhooyr.io/websocket`）、新增 `GET /api/v1/ws` endpoint、systemd 模組監聽 D-Bus PropertiesChanged 訊號、前端建立 WebSocket 連線並更新 Pinia store |
| **架構考量** | D-Bus signal 監聽僅在 D-Bus 連線可用時有效；systemctl fallback 模式仍須保留 polling |

### 7. 服務群組 / 標籤

| 項目 | 內容 |
|------|------|
| **現狀** | 所有服務扁平列表，僅分「我的服務」與「系統服務」 |
| **目標** | 讓使用者自訂服務分類（如「資料庫」、「Web」、「監控」），方便分組檢視與批次管理 |
| **改動範圍** | 後端群組設定檔（JSON / YAML 儲存在 `/etc/linux-service-manager/groups.json`）、API CRUD for groups、前端群組側欄 + 拖曳分類 UI |
| **擴充可能** | 可與批次操作、排程任務整合 |

### 8. 批次操作

| 項目 | 內容 |
|------|------|
| **現狀** | 服務操作為單一服務逐一執行 |
| **目標** | 支援同時選取多個服務，一次執行 start / stop / restart |
| **改動範圍** | 前端 ServiceTable 加入 checkbox 多選、批次操作工具列、後端新增 `POST /api/v1/services/batch` endpoint（接受 `{"names": [...], "action": "start"}`） |
| **注意事項** | 操作結果需逐一回報（部分成功 / 部分失敗）、確認對話框需列出受影響服務 |

### 9. 服務設定檔編輯器

| 項目 | 內容 |
|------|------|
| **現狀** | 使用者需 SSH 進機器編輯 `/etc/systemd/system/*.service` |
| **目標** | 在 Web UI 中直接檢視與編輯 service unit file，含語法檢查 |
| **改動範圍** | 新增 `GET/PUT /api/v1/services/{name}/config` API、前端嵌入 Monaco Editor 或 CodeMirror、`systemctl daemon-reload` 觸發 |
| **安全性** | 僅限 `/etc/systemd/system/` 下的檔案、需記錄 audit log、建議加上語法驗證後才儲存 |

### 10. Audit 操作紀錄

| 項目 | 內容 |
|------|------|
| **現狀** | 無操作紀錄，無法追溯誰做了什麼 |
| **目標** | 記錄 login / logout / start / stop / restart / enable / disable 等操作，含時間、使用者、IP、結果 |
| **改動範圍** | 新增 audit 模組（`internal/audit/`）、資料儲存（SQLite 或 JSON 檔案）、`GET /api/v1/audit?page=&limit=` API、前端 AuditLogView.vue 頁面 |
| **擴充可能** | 後續可加入匯出 CSV、保留期限設定 |

### 11. API Token 驗證

| 項目 | 內容 |
|------|------|
| **現狀** | 僅支援 Cookie-based session 驗證 |
| **目標** | 支援 API Token / API Key 驗證（Bearer token），方便 CI/CD pipeline 或自動化腳本呼叫 |
| **改動範圍** | auth 模組新增 token 管理、middleware 支援 `Authorization: Bearer <token>` header、前端新增 Token 管理頁面（CRUD） |
| **安全性** | Token 需可設定過期時間、可撤銷、權限範圍可限縮（唯讀 vs 完整操作） |

---

## 🔴 高複雜度（重大架構擴充）

### 12. 🌐 多機管理（Agent 模式）

| 項目 | 內容 |
|------|------|
| **現狀** | 單機管理，一個 binary 管理本機 systemd |
| **目標** | 一台主控面板管理多台 Linux 機器的 systemd 服務。每台被控端跑輕量 agent，主控端透過統一介面操作 |
| **改動範圍** | **主控端**：multi-node 路由、node registry、前端 node switcher、aggregate dashboard 、**Agent 端**：精簡版 binary（僅 API server，無前端）、心跳回報 、**通訊層**：HTTP/HTTPS with mTLS 或 gRPC |
| **架構圖** | 詳見下方「多機管理架構」 |
| **開發文件中提及** | 「若未來需求擴充至多機管理，可考慮加入 agent 模式」 |
| **注意事項** | 認證統一、agent 離線處理、延遲與超時設計 |

<details>
<summary>📐 多機管理架構草圖</summary>

```
┌──────────────────────────────────────────────┐
│              Manager Node                     │
│  ┌────────────────────────────────────────┐  │
│  │         Vue 3 SPA (Dashboard)          │  │
│  │  ┌──────────┐  ┌────────────────────┐  │  │
│  │  │ Node     │  │  Aggregate View    │  │  │
│  │  │ Switcher │  │  (所有 node 服務)   │  │  │
│  │  └──────────┘  └────────────────────┘  │  │
│  └────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────┐  │
│  │        Go Backend (Manager)            │  │
│  │  ┌──────────┐  ┌────────────────────┐  │  │
│  │  │ Node     │  │  API Proxy /       │  │  │
│  │  │ Registry │  │  Aggregate         │  │  │
│  │  └──────────┘  └────────────────────┘  │  │
│  └────────────────────────────────────────┘  │
└──────────────┬───────────────────────────────┘
               │ HTTPS / gRPC
    ┌──────────┼──────────┐
    ▼          ▼          ▼
┌────────┐ ┌────────┐ ┌────────┐
│ Agent  │ │ Agent  │ │ Agent  │
│ Node 1 │ │ Node 2 │ │ Node 3 │
│ (ARM)  │ │ (x64)  │ │ (x64)  │
└────────┘ └────────┘ └────────┘
```
</details>

### 13. 📊 資源監控儀表板

| 項目 | 內容 |
|------|------|
| **現狀** | 僅顯示 systemd 服務狀態統計（總數 / 執行中 / 失敗） |
| **目標** | 即時顯示主機 CPU、記憶體、磁碟、網路使用量，整合互動式圖表 |
| **改動範圍** | 後端整合 `shirou/gopsutil` 收集系統指標、新增 `GET /api/v1/metrics` API、前端新增 MetricsDashboard.vue 含圖表（Chart.js / ECharts / uPlot）、可選時序儲存（Prometheus / VictoriaMetrics） |
| **注意事項** | 指標收集本身有輕微效能開銷，需控制取樣頻率 |

### 14. 👥 多用戶 + RBAC

| 項目 | 內容 |
|------|------|
| **現狀** | 單一管理員帳號（`ADMIN_USER` / `ADMIN_PASS` 環境變數） |
| **目標** | 支援多管理員帳號，角色權限區分（唯讀 observer / 操作者 operator / 管理員 admin） |
| **改動範圍** | 後端引入資料庫（SQLite / BoltDB）儲存使用者、auth 模組重構支援多用戶、前端新增 UserManagement.vue 管理頁面（僅 admin 可見）、middleware 依角色限制 API 存取 |
| **資料模型** | users(id, username, password_hash, role, created_at, last_login) |

### 15. 🔗 OAuth / LDAP 整合

| 項目 | 內容 |
|------|------|
| **現狀** | 僅本機帳號密碼驗證 |
| **目標** | 支援第三方身分驗證：GitHub OAuth、Google OAuth、OIDC、LDAP |
| **改動範圍** | auth 模組新增 OAuth2 provider 抽象層、加入 `golang.org/x/oauth2`、前端登入頁面新增「使用 XXX 登入」按鈕、環境變數設定 provider |
| **注意事項** | 首次登入時自動建立使用者或對應到現有角色 |

### 16. 🐳 Docker 容器管理

| 項目 | 內容 |
|------|------|
| **現狀** | 僅管理 systemd 服務 |
| **目標** | 擴充範圍到 Docker 容器，統一管理 container 的 start / stop / restart / logs |
| **改動範圍** | 整合 Docker SDK (`docker/docker`)、新增 `GET /api/v1/containers` 等 API、前端新增 ContainerView / ContainerRow 元件、Container 與 Service 統一 dashboard |
| **注意事項** | 需 Docker socket 存取權限、Docker 非必要依賴（無 Docker 環境時自動隱藏） |

### 17. 📅 排程任務

| 項目 | 內容 |
|------|------|
| **現狀** | 無排程功能 |
| **目標** | 設定定時操作服務，如「每天凌晨 3 點重啟 nginx」、「每週一 6:00 暫停開發環境服務」 |
| **改動範圍** | 後端排程引擎（`robfig/cron` 或自訂）、排程 CRUD API、前端排程管理頁面（類似 cron 的視覺化編輯器）、排程執行紀錄 |
| **注意事項** | 排程設定需持久化、支援暫停 / 啟用 |

### 18. 🔔 Webhook / 通知

| 項目 | 內容 |
|------|------|
| **現狀** | 無外部通知機制 |
| **目標** | 服務狀態變更時觸發 webhook，整合 Slack、Discord、LINE Notify、Email |
| **改動範圍** | webhook 模組（`internal/notify/`）、通知規則設定（觸發條件：服務 failed / started / stopped）、前端通知設定頁面、支援多 channel |
| **擴充可能** | 後續可加入通知群組、靜音時段、告警升級 |

### 19. 📈 歷史指標與告警

| 項目 | 內容 |
|------|------|
| **現狀** | 僅查詢當下狀態，無歷史資料 |
| **目標** | 收集服務狀態歷史（何時 failed、何時 recovered），設定告警規則 |
| **改動範圍** | 時序資料儲存（Prometheus / 內建 TSDB / SQLite）、指標 API、前端歷史圖表、告警規則引擎（如「某服務 failed 超過 5 分鐘通知」） |
| **與 #13 #18 的關係** | 歷史指標可驅動資源監控圖表、告警可觸發 webhook 通知 |

---

## 🗺 建議 Roadmap

```
Phase 1 ─ 立即見效 ─────────────────────
  ├── Enable / Disable 服務（功能補完）
  ├── journalctl 日誌檢視器（實用性最高）
  └── PWA 支援（行動端體驗）

Phase 2 ─ 提升體驗 ─────────────────────
  ├── WebSocket 即時推送
  ├── 服務搜尋強化
  ├── 批次操作 + 服務群組
  └── Audit 操作紀錄

Phase 3 ─ 安全與自動化 ─────────────────
  ├── API Token 驗證
  ├── 服務設定檔編輯器
  └── Webhook / 通知

Phase 4 ─ 重大擴充 ─────────────────────
  ├── 多機管理 Agent 模式
  ├── 資源監控儀表板
  ├── 多用戶 + RBAC
  └── 排程任務

Phase 5 ─ 企業級 ───────────────────────
  ├── OAuth / LDAP 整合
  ├── Docker 容器管理
  └── 歷史指標與告警
```

---

## 📝 附註

- 本文件為規劃文件，各項目實作前建議先產出獨立的 User Story 與 BDD 場景
- Phase 4+ 的多機管理 Agent 模式已在開發文件中預留擴充點（見 `docs/development/001-linux-service-manager.md` 風險登錄）
- 所有改動需維持單一 binary 可部署的核心優勢

---

*最後更新：2025-08-07*
