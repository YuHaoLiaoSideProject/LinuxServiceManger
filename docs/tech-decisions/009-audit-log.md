# 開發方案決策文件：稽核操作紀錄

## 📌 決策摘要

| 項目 | 內容 |
|------|------|
| **最終方案** | 後端 JSON Lines 檔案儲存 + goroutine channel 非同步寫入 + middleware 攔截自動記錄 + 前端獨立 /audit 頁面 |
| **決策日期** | 2025-08-10 |
| **對應 Roadmap** | Phase 2 — `docs/development/002-expansion-roadmap.md` 項目 #10 |
| **輸入文件** | `docs/bdds/009-audit-log.feature`、`docs/interaction-flows/009-audit-log.md`、`docs/test-plans/009-audit-log測試計畫.md` |
| **共識程度** | ✅ 確認通過 |

---

## 1. 需求回顧

### 1.1 核心業務價值

自動記錄所有透過 Web UI / API 執行的關鍵操作（登入/登出、服務 start/stop/restart/enable/disable），提供獨立稽核頁面供管理員查閱、搜尋、日期篩選與 CSV 匯出。滿足安全稽核與故障排查需求，為 Phase 4 RBAC 打下審計基礎。

### 1.2 功能邊界

| 項目 | 範圍 |
|------|------|
| **Must Have (P0)** | 所有受保護 API 操作自動記錄（含成功/失敗）、稽核頁面查閱（時間倒序）、分頁（50/頁）、關鍵字搜尋（debounce 300ms）、日期範圍篩選、CSV 匯出（上限 10,000 筆） |
| **Should Have (P1)** | 記錄欄位完整性驗證、空狀態提示、錯誤狀態重試、搜尋結果計數、匯出保留過濾條件、Toast 通知 |
| **Nice to Have (P2)** | 檔案大小監控 warning、90 天自動清理、CSV 匯出進度提示 |

### 1.3 既有基礎

- 後端已有 chi router + AuthMiddlewareJSON（session-based auth）
- 前端已有 Vue 3 + Pinia 4 + Vue Router 4 + composable 模式
- 所有受保護 API 操作已實作於 `json_handler.go`
- Header 元件 (`AppHeader.vue`) 已有導覽選單結構
- 前端已有 EmptyState、ToastContainer、分頁模式（可參考現有元件）

---

## 2. 關鍵技術決策

### 決策 1：儲存後端

| 方案 | 描述 | 優點 | 缺點 |
|------|------|------|------|
| **A. JSON Lines 檔案（選定）** | append-only `/var/lib/linux-service-manager/audit.jsonl` | 零依賴、部署簡單、人類可讀、檔案層級備份容易、單檔 100MB 容納 ~200K 筆紀錄 | 查詢需掃描全檔、無索引、清理需 rewrite |
| B. SQLite | 嵌入式關聯式資料庫 | 查詢快（索引）、SQL 過濾、WAL 模式並發寫入 | 需引入 CGO 或 pure-Go SQLite driver、增加部署複雜度 |
| C. BoltDB / bbolt | Go 原生 embedded KV store | 無 CGO、交易安全 | 需自行實作分頁查詢、查詢彈性不如 SQL、社群較小 |

> **決策**：方案 A。Phase 2 階段資料量可控（90 天保留，單檔 100MB 上限），JSON Lines 檔案已足夠。保留未來遷移至 SQLite 的彈性（檔案格式簡單，遷移腳本容易）。符合上游 Interaction Flow 定義的 `@business-rules` 限制。

### 決策 2：非同步寫入機制

| 方案 | 描述 | 優點 | 缺點 |
|------|------|------|------|
| **A. goroutine + buffered channel（選定）** | audit 模組暴露 `WriteAudit(entry)` 函數，內部透過 buffered channel 傳遞給專屬 writer goroutine | 非阻塞、API 回應不受影響、channel 自然序列化寫入、buffer 防範瞬間大量寫入 | channel 滿時需決定策略（drop or block） |
| B. 直接在 handler 中 go func() | 每次操作直接 spawn goroutine | 最簡單 | 無法控制並發寫入順序、goroutine leak 風險、無 backpressure |
| C. 同步寫入 | handler 內直接 `os.File.Write()` | 實作最簡、保證寫入順序 | 違反 BDD 需求「API 回應不受 audit log 寫入影響」 |

> **決策**：方案 A。buffered channel 提供輕量 backpressure（buffer=100），channel 滿時以 select default 降級 drop + log warning，確保主流程不受影響。符合 BDD `@error-handling` 中「Audit log 儲存失敗不影響操作結果」。

### 決策 3：記錄觸發點

| 方案 | 描述 | 優點 | 缺點 |
|------|------|------|------|
| **A. Middleware wrapper（選定）** | 建立 `AuditMiddleware` 包裝現有 handler，在 handler 執行前後自動記錄 | 集中管理、不侵入現有 handler、容易擴充新 API | 需能攔截 handler 的回應狀態（成功/失敗） |
| B. 每個 handler 手動呼叫 | 在每個 `HandleStartJSON` / `HandleStopJSON` 等函數尾端手動寫入 | 精確控制時機與欄位 | 重複程式碼、容易遺漏、維護成本高 |
| C. Post-response hook in middleware | 使用 `chi` middleware + wrapped ResponseWriter 攔截 status code | 完全透明 | 無法取得 operation 語意（action/target），需從 URL pattern 推導 |

> **決策**：方案 B（配合方案 A 的部分思路）。因為 action/target 值需要從 URL 和請求內容推導（如 `/services/{name}/start` → action=start, target={name}.service），且登入/登出在 handler 內部才能取得操作結果。實作上在每個 JSON handler 結尾呼叫 `audit.Write()` 輔助函數，保持明確性。審計寫入本身封裝為模組方法，handler 僅需一行呼叫。

### 決策 4：查詢與搜尋實作

| 方案 | 描述 | 優點 | 缺點 |
|------|------|------|------|
| **A. 全檔掃描 + 記憶體過濾（選定）** | 讀取 audit.jsonl 每一行 JSON → parse → 依 search/日期/page 過濾 → 排序 → 回傳分頁 | 實作簡單、無外部依賴、100MB 檔案掃描 ~0.5s | 大量紀錄時效能下降 |
| B. 預先建立 in-memory index | 啟動時載入全檔至記憶體，建立 map index | 查詢極快 | 多實例時同步困難、記憶體佔用、違反 append-only 簡潔性 |
| C. 後端正則 | 傳送 regex 參數由 Go 端解析（類似方案 A 但用 regexp） | 更有彈性 | 上游明確定義為簡單關鍵字搜尋，regex 過度設計 |

> **決策**：方案 A。100MB JSON Lines ≈ 200K 筆紀錄，全檔掃描耗時在可接受範圍（Go I/O + JSON decode 效能優異）。查詢依時間倒序排列（最新在後面的行 ← 載入後 reverse），分頁參數 page/limit 用 slice 截取。

### 決策 5：保留期限清理策略

| 方案 | 描述 | 優點 | 缺點 |
|------|------|------|------|
| **A. 每次寫入時機率觸發（選定）** | 每 N 次寫入（如 10 次）觸發一次 cleanup，掃描檔案並 rewrite 保留 90 天內紀錄 | 簡單、寫入觸發自動維護、不需額外 cron/goroutine | 長時間無寫入時舊資料持續存在 |
| B. 定時 cron / ticker | 獨立 goroutine 定時（如每日 3am）清理 | 更可預測 | 需要額外 goroutine 生命週期管理 |
| C. 啟動時清理 | 僅在服務啟動時執行一次 cleanup | 最不干擾寫入 | 長時間運行無清理，檔案可能撐滿磁碟 |

> **決策**：方案 A。每 10 次寫入後機率觸發清理（1/10 機率），或在檔案大小超過 100MB 時強制觸發。清理時讀取全部有效紀錄 → 寫入暫存檔 → `os.Rename` 原子替換，確保不遺失資料。

### 決策 6：前端架構

| 方案 | 描述 | 優點 | 缺點 |
|------|------|------|------|
| **A. 獨立 /audit 路由 + AuditLogView（選定）** | 新增 Vue Router 路由 `/audit`，獨立頁面元件 AuditLogView.vue + composable useAuditLog.ts | 關注點分離、易於擴充（後續 RBAC 限權）、獨立 loading/error 狀態 | 需額外一個 view 元件 |
| B. Drawer / Modal 內嵌 | 在 Dashboard 中以側邊抽屜（LogDrawer 現有元件）顯示 audit log | 不需切換頁面 | UI 空間受限、不適合表格和分頁控制、CSV 匯出體驗差 |
| C. 純後端 API（無前端頁面） | 僅提供 API，無 GUI | 最簡 | 不滿足需求中「提供查閱介面」的核心價值 |

> **決策**：方案 A。Audit Log 是獨立功能模組，表格、搜尋、日期篩選、分頁、匯出需要完整頁面空間。獨立路由方便後續 RBAC 限縮權限。Header 新增導覽連結指向 `/audit`。

---

## 3. 架構概覽

```
┌─────────────────────────────────────────────────────────────┐
│  Browser                                                     │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  /audit — AuditLogView.vue                             │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌─────────────┐ │  │
│  │  │ SearchBox    │  │ DatePicker   │  │ Pagination  │ │  │
│  │  │ (debounce    │  │ (from/to)    │  │ (prev/next) │ │  │
│  │  │  300ms)      │  │              │  │             │ │  │
│  │  └──────────────┘  └──────────────┘  └─────────────┘ │  │
│  │  ┌──────────────────────────────────────────────────┐ │  │
│  │  │  AuditTable (time, user, IP, action, target,     │ │  │
│  │  │              result, detail)                     │ │  │
│  │  └──────────────────────────────────────────────────┘ │  │
│  │  ┌──────────────┐                                     │  │
│  │  │ Export CSV   │  Toast notification                │  │
│  │  └──────────────┘                                     │  │
│  └───────────────────────────────────────────────────────┘  │
│                          │ HTTP GET /api/v1/audit            │
└──────────────────────────┼──────────────────────────────────┘
                           │
┌──────────────────────────┼──────────────────────────────────┐
│  Go Backend                                                 │
│  ┌───────────────────────┴────────────────────────────────┐ │
│  │  chi Router (AuthMiddlewareJSON)                        │ │
│  │  ┌──────────────────────┐  ┌─────────────────────────┐ │ │
│  │  │ GET /api/v1/audit    │  │ GET /api/v1/audit/export│ │ │
│  │  │ ?page,limit,search,  │  │ ?format=csv&search&     │ │ │
│  │  │  from,to             │  │  from&to                │ │ │
│  │  └────────┬─────────────┘  └──────────┬──────────────┘ │ │
│  └───────────┼────────────────────────────┼────────────────┘ │
│              │                            │                   │
│  ┌───────────┴────────────────────────────┴────────────────┐ │
│  │  internal/audit/                                         │ │
│  │  ┌──────────────────┐  ┌──────────────┐  ┌────────────┐ │ │
│  │  │ WriteAudit()     │  │ QueryAudit() │  │ ExportCSV()│ │ │
│  │  │ → buffered chan  │  │ → scan+filter│  │ → stream   │ │ │
│  │  │ → writer goroutine│  │ → paginate   │  │   CSV      │ │ │
│  │  └──────────────────┘  └──────────────┘  └────────────┘ │ │
│  │  ┌──────────────────┐                                    │ │
│  │  │ CleanupAudit()   │  (every 10 writes / size ≥ 100MB) │ │
│  │  └──────────────────┘                                    │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                               │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │  Existing Handlers (modified)                             │ │
│  │  HandleStartJSON  ─┐                                      │ │
│  │  HandleStopJSON   ─┤                                      │ │
│  │  HandleRestartJSON─┼──→ audit.Write(audit.Entry{...})     │ │
│  │  HandleEnableJSON ─┤     (after operation completes)      │ │
│  │  HandleDisableJSON─┤                                      │ │
│  │  HandleLoginJSON  ─┤                                      │ │
│  │  HandleLogoutJSON ─┘                                      │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                               │
│  /var/lib/linux-service-manager/audit.jsonl                   │
│  {"timestamp":"...","username":"admin","source_ip":"...",     │
│   "action":"restart","target":"nginx.service",                │
│   "result":"success","detail":""}                             │
│  {"timestamp":"...","username":"admin","source_ip":"...",     │
│   "action":"stop","target":"nginx.service",                   │
│   "result":"failure","detail":"exit code 1: ..."}             │
└──────────────────────────────────────────────────────────────┘

Data Flow (Write):
  1. Handler executes operation (e.g., systemctl restart nginx)
  2. Handler calls audit.Write(entry) with result
  3. Write() sends entry to buffered channel (non-blocking, drops if full)
  4. Writer goroutine receives from channel, appends JSON line to audit.jsonl
  5. Periodically triggers CleanupAudit() (every 10 writes or size check)

Data Flow (Read):
  1. Frontend AuditLogView calls GET /api/v1/audit?page=1&limit=50
  2. Handler parses query params, calls audit.Query(params)
  3. Query reads audit.jsonl line by line, parses JSON, filters, sorts
  4. Returns paginated slice + total count as JSON
```

---

## 4. 風險評估

| 風險 | 可能性 | 影響 | 緩解措施 |
|------|--------|------|---------|
| audit.jsonl 檔案被外部程序修改/損毀 | 低 | 中 | append-only 權限控制（0640 root:linux-service-manager）；JSON Lines 格式每行獨立，單行損毀不影響其餘 |
| 大量寫入時 channel buffer 滿導致 drop | 低 | 低 | buffer 設 100，遠超瞬間並發量；drop 時 log warning |
| 全檔掃描效能下降（>100MB） | 中 | 中 | 100MB 上限 + 保留期限自動清理；未來可遷移 SQLite |
| cleanup rewrite 過程中服務 crash | 低 | 中 | 先寫暫存檔 → `os.Rename` 原子替換；crash 後原檔仍完整 |
| 磁碟空間滿導致 audit 無法寫入 | 低 | 高 | 操作主流程不受影響（channel drop + log error）；監控磁碟使用率 |
| 未登入使用者直接存取 /api/v1/audit | 低 | 中 | AuthMiddlewareJSON 攔截，回傳 401 |

---

## 5. 相依與整合

| 項目 | 影響 |
|------|------|
| `json_handler.go` — 所有服務操作 handler | 每個 handler 尾端新增 `audit.Write()` 呼叫（約 8 處） |
| `main.go` — chi router 註冊 | 新增 `/api/v1/audit` 和 `/api/v1/audit/export` 路由 |
| `internal/middleware/auth.go` | 無變更，沿用現有 `AuthMiddlewareJSON` |
| `AppHeader.vue` | 新增「Audit Log」導覽連結 |
| `router/index.ts` | 新增 `/audit` 路由 |
| 反向代理 (nginx) | 無需變更（純 REST API，無 WebSocket） |
| Deploy 流程 | 需確保 `/var/lib/linux-service-manager/` 目錄存在且有寫入權限 |

---

## 6. 不需變更的部分

- systemd 模組：audit log 不直接依賴 systemd
- WebSocket / Hub：audit log 不透過 WebSocket 推送
- 前端 service store / composables：不受影響
- D-Bus monitor：audit log 不監聽 D-Bus
- PWA / Service Worker：不受影響
- 登入/登出流程本身：僅在完成後附加 audit 寫入

---

*最後更新：2025-08-10*
