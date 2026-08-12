# 開發方案決策文件：API Token 管理與驗證

## 📌 決策摘要

| 項目 | 內容 |
|------|------|
| **最終方案** | 後端新增 Token 管理模組（SHA-256 hash 儲存 + JSON file 持久化）+ Bearer token middleware（優先於 session）+ 前端 TokenManageView 頁面 |
| **決策日期** | 2025-08-10 |
| **對應 Roadmap** | Phase 3 — `docs/development/002-expansion-roadmap.md` 項目 #11 |
| **輸入文件** | `docs/bdds/011-api-token-auth.feature`、`docs/interaction-flows/011-api-token-auth.md` |
| **共識程度** | ✅ 確認通過 |

---

## 1. 需求回顧

### 1.1 核心業務價值

讓管理員可以建立、管理 API Token（Bearer token），供 CI/CD pipeline 或自動化腳本透過 `Authorization: Bearer <token>` header 呼叫 API，不需依賴 Cookie-based session。Token 支援過期時間與權限範圍（唯讀 vs 完整操作），建立後僅顯示一次（類似 GitHub PAT），並可隨時撤銷單一 token 而不影響其他整合。

### 1.2 功能邊界

| 項目 | 範圍 |
|------|------|
| **Must Have (P0)** | Token CRUD（建立/列表/撤銷）、SHA-256 hash 儲存、Bearer token middleware、唯讀/完整操作權限檢查、過期時間驗證、Token 數量上限（20）、Bearer 優先於 Cookie session、Audit Log 整合 |
| **Should Have (P1)** | Token 名稱不區分大小寫唯一性、非同步 `last_used_at` 更新、Token 遮罩顯示（前4+後4字元）、即將過期（7天內）警告標籤 |
| **Nice to Have (P2)** | 自訂日期過期選擇器、過期 Token 自動折疊、手動清理過期 Token |

### 1.3 既有基礎

- 後端已有 Cookie-based session 驗證（gorilla/sessions, `AuthMiddlewareJSON`）
- 後端已有 Audit Log module（`audit.Module`, JSONL 儲存）
- 後端 handler 已使用 chi router group + `writeJSON` 輔助函式
- 前端已有 router（`/login`, `/`, `/audit`）、auth store（Pinia）
- 前端已有 AppHeader 導覽列元件
- 專案無外部資料庫相依（僅檔案系統 + embedded 靜態資源）

---

## 2. 關鍵技術決策

### 決策 1：Token 儲存後端（JSON file vs SQLite）

| 方案 | 描述 | 優點 | 缺點 |
|------|------|------|------|
| **A. JSON file（選定）** | 使用單一 JSON 檔案儲存所有 Token 的 metadata（含 hash），檔案鎖保護並發寫入 | 零外部相依、與專案現有 pattern 一致（audit.jsonl）、部署簡單、小規模 Token 數量適合 | 不支援複雜查詢、並發寫入需自行處理鎖 |
| B. SQLite | 使用內嵌 SQLite 資料庫儲存 Token | 支援 SQL 查詢、索引加速、交易保證 | 需引入新依賴（mattn/go-sqlite3 需 CGO 或 modernc.org/sqlite）、部署複雜度增加、專案目前零資料庫相依 |
| C. 純記憶體（無持久化） | Token 僅存在 process memory | 最簡單、最快 | 重啟後所有 Token 遺失、不符合 BDD 需求（管理頁面需顯示 Token 列表） |

> **決策**：方案 A。專案目前完全無資料庫相依（僅檔案系統：embedded static files + audit.jsonl），引入 SQLite 會增加建置與部署複雜度（CGO 跨平台編譯問題）。Token 數量上限僅 20 個，JSON file 的效能完全足夠。採用 `sync.RWMutex` 保護並發讀寫，檔案以 atomic write（temp file + rename）確保資料完整性。

### 決策 2：Token 儲存策略與 Hash 演算法

| 方案 | 描述 | 優點 | 缺點 |
|------|------|------|------|
| **A. SHA-256（選定）** | 使用 crypto/sha256 對原始 Token 做 hash，僅儲存 hash 值 | Go 標準庫、無外部依賴、安全性足夠、符合 BDD 明確要求 | 無法復原原始 Token（這正是設計目的） |
| B. bcrypt | 使用 bcrypt hash | 內建 salt、抗暴力破解 | 驗證速度慢（刻意設計）、Go 需額外依賴、Token 本身已是高熵隨機字串不需 bcrypt 強度 |
| C. HMAC-SHA256 | 使用 secret key 做 HMAC | 可加入 server-side secret | 需管理額外 secret key、與純 hash 相比無明顯優勢 |

> **決策**：方案 A。Token 本身是 32 bytes 的隨機字串（`crypto/rand`），熵值極高，暴力破解不可行。SHA-256 速度最快且符合 BDD 中「僅儲存 SHA-256 hash」的明確需求。使用 `crypto/sha256` 標準庫，無需外部依賴。

### 決策 3：Token 格式與產生方式

| 項目 | 決定 |
|------|------|
| **前綴** | `lsm_`（Linux Service Manager 縮寫，用於辨識與 log 過濾） |
| **隨機部分** | 32 bytes 隨機字元，以 `crypto/rand.Read()` 產生 |
| **編碼** | Base64URL（`encoding/base64.RawURLEncoding`），無 padding |
| **總長度** | 前綴 4 字元 + 43 字元（32 bytes Base64URL）= 約 47 字元 |
| **範例** | `lsm_k3F8aB2xQ9vR7mW1pL5nY6dC0jH4tG8sA3eU9` |

Base64URL 編碼確保 Token 可直接用於 HTTP header 無需 URL-encoding，且不含 `+` `/` `=` 等容易在 shell 或 YAML 中造成問題的字元。

### 決策 4：Bearer Token Middleware 與 Session Middleware 的優先級與共存

| 方案 | 描述 | 優點 | 缺點 |
|------|------|------|------|
| **A. Composite middleware：Bearer 優先，fallback session（選定）** | 單一 middleware 同時檢查 Bearer token 與 Cookie session，Bearer 優先 | 路由配置簡單、只需一個 middleware、行為明確 | middleware 內部邏輯稍複雜 |
| B. 雙 middleware chain | 先掛 Bearer middleware，失敗後 fallback session middleware | 可獨立測試兩個 middleware | chi 不支援 middleware chain 中的條件跳過（short-circuit）；需手動組合 |
| C. 分離路由群組 | 為 Bearer 和 Session 各自建立獨立路由群組 | 清晰分離 | 大量重複路由定義、維護兩份路由表 |

> **決策**：方案 A。建立新 middleware `AuthMiddlewareComposite`，邏輯為：
> 1. 檢查 `Authorization: Bearer <token>` header → 若存在且有效 → 設定 context，繼續請求
> 2. 若無 Bearer token → fallback 到既有 session 驗證（`AuthMiddlewareJSON` 邏輯）
> 3. 兩者皆無 → 回傳 `401 Unauthorized`
>
> 這樣只需一行改動：將既有 `AuthMiddlewareJSON` 替換為 `AuthMiddlewareComposite`，所有現有路由立即支援 Bearer token。符合 BDD 中「Bearer token 優先於 Cookie session」與「Cookie session 不受影響」。

### 決策 5：權限範圍模型

| 方案 | 描述 | 優點 | 缺點 |
|------|------|------|------|
| **A. 二元模型：唯讀 vs 完整操作（選定）** | 唯讀 = 所有 GET API；完整操作 = 所有 API | 簡單清晰、符合 BDD 定義、覆蓋當前需求 | 無法細緻控制（如僅允許某服務） |
| B. 路徑模式匹配 | Token 可設定允許的 API 路徑 pattern | 彈性最高 | 實作與 UI 複雜度大增、超出 BDD 範圍 |
| C. RBAC 角色映射 | 將 Token 綁定到預定義角色 | 可擴充 | 目前僅單一使用者、無角色系統 |

> **決策**：方案 A。當前僅單一管理員角色，二元模型覆蓋所有實際場景（CI/CD 需完整操作、監控腳本僅需唯讀）。middleware 中透過 HTTP method 判斷：`GET` / `HEAD` / `OPTIONS` 允許唯讀 Token，其他 method 僅允許完整操作 Token。後續若引入多用戶 RBAC 可擴充為角色映射。

### 決策 6：過期機制

| 方案 | 描述 | 優點 | 缺點 |
|------|------|------|------|
| **A. 驗證時檢查（選定）** | 每次請求時比對 `expires_at` 與當前時間 | 最簡單、無需背景排程 | 過期 Token 仍佔用儲存空間 |
| B. 背景清理 + 驗證時檢查 | 定時 goroutine 清理過期 Token + 驗證時檢查 | 自動清理 | 增加複雜度、過期 Token 保留可協助審計 |

> **決策**：方案 A（加上手動清理）。過期 Token 保留在列表中供管理員檢視（顯示 🔴「已過期」標籤），不會自動刪除。Token 數量上限僅計算「有效」Token（未撤銷、未過期），因此過期 Token 佔用空間不影響功能。管理員可手動清理過期 Token（P2）。永不過期選項：`expires_at` 設為 `nil` / `null`，驗證時跳過。

### 決策 7：`last_used_at` 非同步更新策略

| 方案 | 描述 | 優點 | 缺點 |
|------|------|------|------|
| **A. Goroutine + channel（選定）** | 驗證成功後將更新事件送入 buffered channel，背景 goroutine 批次寫入 | 不影響 API 回應時間、合併頻繁更新 | 需管理 goroutine 生命週期 |
| B. 同步寫入（請求內） | 驗證成功後直接寫入檔案 | 保證即時更新 | 增加每次 API 請求延遲（檔案 I/O） |
| C. 記憶體快取 + 定時 flush | 記憶體中更新，每 N 秒 flush 到檔案 | 效能最佳 | 重啟時遺失未 flush 的更新、精確度降低 |

> **決策**：方案 A。建立 buffered channel（容量 100），背景 goroutine 每 5 秒或累積 10 筆時批次寫入。失敗時僅 log warning，不影響請求。更新精確度為分鐘級（符合 BDD 定義）。專案已有類似 pattern（audit.Module 的 writerLoop goroutine）。

---

## 3. 架構概覽

### 3.1 新增模組結構

```
src/internal/token/
├── token.go          # Token 資料結構、CRUD 邏輯、hash、驗證
├── token_test.go     # 單元測試
├── store.go          # JSON file 儲存層（讀寫鎖、atomic write）
└── store_test.go     # 儲存層測試
```

### 3.2 系統架構圖

```
┌─────────────────────────────────────────────────────────┐
│  External Client (CI/CD, Script)                         │
│  Authorization: Bearer lsm_xxxx                          │
└────────────────────────┬────────────────────────────────┘
                         │
┌────────────────────────┼────────────────────────────────┐
│  Go Backend            ▼                                 │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │  middleware.AuthMiddlewareComposite               │   │
│  │  ┌──────────────────┐  ┌──────────────────────┐  │   │
│  │  │ Bearer Token     │  │ Session (fallback)    │  │   │
│  │  │ • extract header │  │ • cookie check        │  │   │
│  │  │ • sha256 lookup  │  │ • existing logic      │  │   │
│  │  │ • expiry check   │  └──────────────────────┘  │   │
│  │  │ • scope check    │                             │   │
│  │  │ • async update   │                             │   │
│  │  └────────┬─────────┘                             │   │
│  │           │ pass                                  │   │
│  │  context: auth_method, token_name, scope          │   │
│  └───────────┼──────────────────────────────────────┘   │
│              ▼                                            │
│  ┌──────────────────────────────────────────────────┐   │
│  │  Handler (existing)                               │   │
│  │  Check context for auth_method if needed          │   │
│  └──────────────────────────────────────────────────┘   │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │  Token Management (new: internal/token/)          │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────────┐   │   │
│  │  │ Create   │  │ List     │  │ Revoke       │   │   │
│  │  │ (hash)   │  │ (masked) │  │ (flag)       │   │   │
│  │  └────┬─────┘  └────┬─────┘  └──────┬───────┘   │   │
│  │       │              │               │            │   │
│  │       ▼              ▼               ▼            │   │
│  │  ┌──────────────────────────────────────────┐    │   │
│  │  │  store.go — Atomic JSON file persistence │    │   │
│  │  │  /var/lib/linux-service-manager/tokens.json   │    │
│  │  │  sync.RWMutex + temp file + rename        │    │   │
│  │  └──────────────────────────────────────────┘    │   │
│  └──────────────────────────────────────────────────┘   │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │  last_used_at Updater (background goroutine)     │   │
│  │  buffered channel → batch write every 5s         │   │
│  └──────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────┐
│  Vue SPA (Browser)                                        │
│                                                           │
│  ┌──────────────────────────────────────────────────┐    │
│  │  TokenManageView.vue (new)                        │    │
│  │  Route: /tokens                                   │    │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────────┐   │    │
│  │  │ TokenList│  │CreateForm│  │ConfirmRevoke │   │    │
│  │  │ (table)  │  │ (modal)  │  │ (modal)      │   │    │
│  │  └──────────┘  └──────────┘  └──────────────┘   │    │
│  └──────────────────────────────────────────────────┘    │
│                                                           │
│  ┌──────────────────────────────────────────────────┐    │
│  │  api/client.ts (new functions)                    │    │
│  │  listTokens() / createToken() / revokeToken()     │    │
│  └──────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────┘
```

### 3.3 Token 資料結構

```go
// Token represents a stored API token (hash only, never the raw value).
type Token struct {
    ID          string    `json:"id"`           // UUID v4
    Name        string    `json:"name"`         // 使用者自訂名稱（唯一，不區分大小寫）
    Hash        string    `json:"hash"`         // SHA-256 hash of raw token (hex encoded)
    Prefix      string    `json:"prefix"`       // 原始 token 前 8 字元（供 UI 顯示辨識）
    Scope       string    `json:"scope"`        // "read" | "full"
    CreatedAt   time.Time `json:"created_at"`
    ExpiresAt   *time.Time `json:"expires_at"`  // nil = 永不過期
    LastUsedAt  *time.Time `json:"last_used_at"` // nil = 從未使用
    Revoked     bool      `json:"revoked"`      // true = 已撤銷
}
```

### 3.4 API Endpoint 設計

| Method | Path | Auth | 說明 |
|--------|------|------|------|
| `GET` | `/api/v1/tokens` | Session | 列出所有 Token（回傳 name, prefix, scope, status, 時間欄位；**不含 hash 或原始值**） |
| `POST` | `/api/v1/tokens` | Session | 建立 Token（body: `{name, expires_in_days, scope}`）。成功回傳 `{token: "lsm_xxxx", id: "..."}` — **僅此一次** |
| `POST` | `/api/v1/tokens/{id}/revoke` | Session | 撤銷 Token（冪等：已撤銷仍回 200） |

### 3.5 回應格式

```json
// GET /api/v1/tokens 回應
{
  "data": [
    {
      "id": "uuid-xxxx",
      "name": "Jenkins CI",
      "prefix": "lsm_k3F8",
      "scope": "full",
      "created_at": "2025-08-10T12:00:00Z",
      "expires_at": "2025-11-08T12:00:00Z",
      "last_used_at": "2025-08-10T14:30:00Z",
      "status": "active"  // "active" | "expiring_soon" | "expired" | "revoked"
    }
  ]
}

// POST /api/v1/tokens 回應（建立成功）
{
  "id": "uuid-xxxx",
  "token": "lsm_k3F8aB2xQ9vR7mW1pL5nY6dC0jH4tG8sA3eU9",
  "name": "Jenkins CI",
  "scope": "full",
  "expires_at": "2025-11-08T12:00:00Z"
}

// POST /api/v1/tokens 回應（錯誤 — 名稱重複）
{
  "error": "此名稱已存在，請使用其他名稱"
}

// POST /api/v1/tokens 回應（錯誤 — 超過上限）
{
  "error": "已達 Token 數量上限（20）"
}

// POST /api/v1/tokens/{id}/revoke 回應
{
  "message": "Token 已撤銷"
}
```

### 3.6 Middleware 驗證流程偽代碼

```go
func AuthMiddlewareComposite(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        // 1. Check Bearer token first
        authHeader := r.Header.Get("Authorization")
        if strings.HasPrefix(authHeader, "Bearer ") {
            rawToken := strings.TrimPrefix(authHeader, "Bearer ")
            token, err := tokenStore.Validate(rawToken)
            if err != nil {
                // Specific error messages per BDD
                writeJSON(w, 401, map[string]string{"error": err.Error()})
                return
            }
            // Check scope against HTTP method
            if token.Scope == "read" && !isReadOnlyMethod(r.Method) {
                writeJSON(w, 403, map[string]string{"error": "權限不足，此 Token 僅供唯讀"})
                return
            }
            // Set context
            ctx := context.WithValue(r.Context(), ctxKeyAuthMethod, "token")
            ctx = context.WithValue(ctx, ctxKeyTokenName, token.Name)
            ctx = context.WithValue(ctx, ctxKeyTokenScope, token.Scope)
            // Async update last_used_at
            tokenStore.MarkUsed(token.ID)
            next.ServeHTTP(w, r.WithContext(ctx))
            return
        }

        // 2. Fallback to session
        session := auth.GetSession(r)
        if authenticated, ok := session.Values["authenticated"].(bool); !ok || !authenticated {
            writeJSON(w, 401, map[string]string{"error": "未提供驗證資訊"})
            return
        }
        next.ServeHTTP(w, r)
    })
}
```

---

## 4. 與現有模組的整合

### 4.1 main.go 路由變更

變更範圍極小，僅需：

1. **新增** token store 初始化（`internal/token` package）
2. **啟動** `last_used_at` 背景 goroutine
3. **替換** 既有 `middleware.AuthMiddlewareJSON` 為 `middleware.AuthMiddlewareComposite`
4. **新增** Token 管理路由（session 保護）

```go
// 新增 import: "linux-service-manager/internal/token"

// 新增初始化
tokenStore := token.NewStore("/var/lib/linux-service-manager/tokens.json")
go tokenStore.RunLastUsedUpdater()

// Token 管理路由（僅 session 驗證 — 管理員操作）
r.Group(func(r chi.Router) {
    r.Use(middleware.AuthMiddlewareJSON)  // 僅 session（管理 Token 本身不能用 Token）
    r.Get("/api/v1/tokens", h.HandleListTokens)
    r.Post("/api/v1/tokens", h.HandleCreateToken)
    r.Post("/api/v1/tokens/{id}/revoke", h.HandleRevokeToken)
})

// 既有 JSON API（將 AuthMiddlewareJSON 替換為 AuthMiddlewareComposite）
r.Group(func(r chi.Router) {
    r.Use(middleware.AuthMiddlewareComposite(tokenStore))  // Bearer or session
    r.Get("/api/v1/services", h.HandleServicesJSON)
    r.Post("/api/v1/services/{name}/start", h.HandleStartJSON)
    // ... 其他既有路由
})
```

### 4.2 Audit Log 整合

在 `audit` package 中新增兩個 action：

```go
const (
    ActionTokenCreate Action = "token_create"
    ActionTokenRevoke Action = "token_revoke"
)
```

Token 建立/撤銷時寫入 Audit Log（handler 層處理，與既有 `HandleLoginJSON` pattern 一致）。

### 4.3 與 WebSocket 的互動

WebSocket 端點（`/api/v1/ws`, `/api/v1/services/{name}/logs/ws`）的驗證不受影響。WebSocket 使用 `gorilla/websocket` upgrade，在 upgrade 前由 middleware 驗證（支援 Bearer 或 session）。既有的 WebSocket handler（`HandleStatusWS`）目前使用 session 取得 username，需改為從 context 讀取（支援 token 驗證時 userID = token name）。

### 4.4 不變更的部分

- Login / Logout API：僅使用 session 驗證，不受 Bearer token 影響
- HTML routes（htmx legacy）：保持使用 `AuthMiddleware`（redirect to /login）
- Audit Log 查詢/匯出 API：透過 composite middleware 支援 Bearer token
- Static file serving 與 SPA fallback：不受影響

---

## 5. 風險評估

| 風險 | 可能性 | 影響 | 緩解措施 |
|------|--------|------|---------|
| Token 檔案損毀（tokens.json） | 低 | 高 | Atomic write（write temp → rename）；啟動時檢查檔案完整性；管理員可重新建立 Token |
| 並發寫入導致資料競爭 | 中 | 高 | `sync.RWMutex` 保護所有讀寫操作；測試覆蓋並發場景 |
| `last_used_at` goroutine 洩漏 | 低 | 中 | `RunLastUsedUpdater` 提供 `Shutdown()` 方法；main.go 中 `defer tokenStore.Shutdown()` |
| Token hash 碰撞（不同 Token 產生相同 hash） | 極低 | 中 | SHA-256 碰撞機率極低（2^-128）；儲存層 double-check：hash 相同時檢查 prefix 是否一致 |
| Bearer token header 洩漏（HTTP log） | 中 | 低 | chi Logger middleware 目前記錄 request line，不記錄 header；確認無 Authorization header 記錄 |
| 管理端點誤用 Bearer token 驗證 | 低 | 高 | Token 管理路由使用獨立 group + `AuthMiddlewareJSON`（僅 session），不經 composite middleware |

---

## 6. 實作順序建議

| 優先級 | 任務 | 預估工時 | 依賴 |
|--------|------|---------|------|
| **P0** | `internal/token/token.go` — 資料結構、hash、驗證邏輯 | 2h | - |
| **P0** | `internal/token/store.go` — JSON file 儲存層（CRUD + atomic write） | 3h | token.go |
| **P0** | `internal/token/store.go` — `last_used_at` async updater | 1h | store.go |
| **P0** | `internal/middleware/auth.go` — `AuthMiddlewareComposite` | 2h | token.go |
| **P0** | `internal/handler/` — Token CRUD handler（`HandleListTokens`, `HandleCreateToken`, `HandleRevokeToken`） | 3h | store.go, middleware |
| **P0** | `main.go` — 路由整合、middleware 替換 | 1h | handler, middleware |
| **P0** | `frontend/src/api/client.ts` — Token API 函式 | 30m | - |
| **P0** | `frontend/src/views/TokenManageView.vue` — Token 管理頁面 | 4h | client.ts |
| **P0** | `frontend/src/router/index.ts` — `/tokens` 路由註冊 | 15m | TokenManageView.vue |
| **P0** | `frontend/src/components/AppHeader.vue` — 「API Tokens」導覽連結 | 15m | router |
| **P1** | `internal/token/token_test.go` — Token 單元測試 | 2h | token.go |
| **P1** | `internal/token/store_test.go` — Store 並發測試 | 2h | store.go |
| **P1** | `internal/handler/` — Token handler 整合測試 | 2h | handler |
| **P1** | `internal/middleware/auth_test.go` — Composite middleware 測試 | 2h | middleware |
| **P1** | `frontend/src/__tests__/TokenManageView.spec.ts` — 前端元件測試 | 2h | TokenManageView.vue |

**總預估工時**：約 24.5 小時（約 3 工作天）

---

## 7. 相依與影響

| 項目 | 影響 |
|------|------|
| `internal/token/` (new) | 全新模組，零外部依賴（僅 Go 標準庫） |
| `internal/middleware/auth.go` | 新增 `AuthMiddlewareComposite`，保留既有兩個 middleware |
| `internal/handler/handler.go` | 新增 `tokenStore` 欄位，新增 3 個 handler method |
| `internal/audit/audit.go` | 新增 `ActionTokenCreate`, `ActionTokenRevoke` |
| `main.go` | 新增 token store 初始化、路由、middleware 替換 |
| `frontend/src/router/index.ts` | 新增 `/tokens` 路由 |
| `frontend/src/api/client.ts` | 新增 `listTokens`, `createToken`, `revokeToken` |
| `frontend/src/components/AppHeader.vue` | 新增導覽連結 |
| `frontend/src/views/TokenManageView.vue` (new) | 全新頁面 |
| 反向代理 (nginx) | 無需變更（REST API，非 WebSocket） |
| 部署 (install.sh) | 無需變更（無新依賴） |

---

*最後更新：2025-08-10*
