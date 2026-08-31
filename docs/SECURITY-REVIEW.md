# Security Review Report — T4: 安全性 & 設計

## 審查摘要
- 審查檔案數：16
- 發現問題數：7 (🔴 Critical: 1 / 🟠 Major: 3 / 🟡 Moderate: 3)

---

## 🔴 致命 (Critical)

- [ ] **C-01: Agent WS Token 泄漏至日誌（明文）**
  - 檔案：`src/internal/agentclient/client.go:205`
  - 漏洞類型：CWE-532（敏感資訊寫入日誌）
  - 描述：Agent WebSocket 連線時，完整 URL（含 `?token=<auth_token>`）以明文寫入 log。
    ```go
    log.Printf("[agentclient] dialing %s", wsURL)
    ```
    `wsURL` 由 `u.String()` 組成，包含 query string 中的 token。
  - 攻擊情境：任何可讀取 agent 日誌（/var/log/ 或 stdout）的使用者，均可直接取得 agent 認證 token，偽裝為該節點連接 Manager。
  - 影響：**Agent 身份冒充**——攻擊者可偽裝已授權節點，接收 RPC 指令、操控其他伺服器的 systemd 服務。
  - 建議修復：
    ```go
    // 方案 1：URL 編碼時遮罩 token
    logURL := u.String()
    if c.cfg.AuthToken != "" {
        logURL = strings.Replace(logURL, "token="+c.cfg.AuthToken, "token=***", 1)
    }
    log.Printf("[agentclient] dialing %s", logURL)
    ```

---

## 🟠 嚴重 (Major)

- [ ] **M-01: 主伺服器未設定 HTTP Timeout（Slowloris DDoS）**
  - 檔案：`src/main.go:262`
  - 漏洞類型：CWE-400（Resource Exhaustion）/ P4
  - 描述：Manager 主伺服器使用 `http.ListenAndServe(":"+port, r)`，底層 `http.Server` 未設定 `ReadHeaderTimeout`、`ReadTimeout`、`WriteTimeout`、`IdleTimeout`。
    ```go
    log.Printf("🚀 Linux Service Manager starting on http://localhost:%s", port)
    if err := http.ListenAndServe(":"+port, r); err != nil {
    ```
  - 攻擊情境：攻擊者建立大量慢速連線（Slowloris），以極慢速率發送 HTTP header，佔滿 goroutine / 連線池，導致合法用戶無法連線。
  - 影響：**整個 Manager 服務不可用（DoS）**。
  - 建議修復：
    ```go
    srv := &http.Server{
        Addr:              ":" + port,
        Handler:           r,
        ReadHeaderTimeout: 10 * time.Second,
        ReadTimeout:       30 * time.Second,
        WriteTimeout:      60 * time.Second,
        IdleTimeout:       120 * time.Second,
    }
    if err := srv.ListenAndServe(); err != nil {
    ```

- [ ] **M-02: Login 端點未限速（Brute Force）**
  - 檔案：`src/main.go:156-158`
  - 漏洞類型：CWE-307（Improper Restriction of Excessive Authentication Attempts）/ P5
  - 描述：Rate limit middleware 僅套用在 `r.Group` 內，`/api/v1/login` 有 rate limit (5/min)。但同時 `/api/v1/logout` 和 `/api/v1/session` 位於 Group **外**，無任何 rate limit。
    ```go
    // 登入有限速 ✓
    r.Group(func(r chi.Router) {
        r.Use(middleware.RateLimit(5, time.Minute))
        r.Post("/api/v1/login", h.HandleLoginJSON)
    })
    // logout 和 session 無限速 ✗
    r.Post("/api/v1/logout", h.HandleLogoutJSON)
    r.Get("/api/v1/session", h.HandleSessionCheck)
    ```
    而更關鍵的是：**Token 管理 API（/tokens、/tokens/{id}/revoke）未獨立限速**，可被暴力破解 token ID（雖為 UUID，但仍是不必要風險）。
  - 攻擊情境：大量重複呼叫 `/api/v1/logout` 可造成 session 競態；大量呼叫 `/api/v1/tokens/{id}/revoke` 可嘗試枚舉 token ID。
  - 影響：**帳戶鎖定（logout 濫用）**、**Token 竊取風險**。
  - 建議修復：
    ```go
    r.Post("/api/v1/logout", h.HandleLogoutJSON)       // 無限速（已登入）
    r.Get("/api/v1/session", h.HandleSessionCheck)     // 無限速（低風險）
    // Token 管理應在 protected group 內（已有 auth，風險較低）
    ```

- [ ] **M-03: Nodes Handler 使用錯誤的 Context Key 取得 Username（永遠取得 "system"）**
  - 檔案：`src/internal/handler/nodes_handler.go:324-328`
  - 漏洞類型：M7（Session / Auth Context Misuse）
  - 描述：`HandleNodeAction` 嘗試從 context 取得 username，但使用了硬編碼字串 `"username"` 作為 key，而非 auth middleware 設定的 `middleware.CtxKeyAuthMethod`。
    ```go
    username := "system"
    if u := r.Context().Value("username"); u != nil {
        if s, ok := u.(string); ok {
            username = s
        }
    }
    ```
    Auth middleware 設定的是 `CtxKeyAuthMethod`（值為 "session" 或 "token"），並未設定 `"username"` key。因此此處 **永遠取得 "system"**。
  - 攻擊情境：不影響機密性，但所有節點操作的 audit log 皆記錄為 `username="system"`，無法追蹤真正的操作者。
  - 影響：**稽核追蹤失效**——若發生安全事件，無法確認是哪位使用者執行了節點操作。
  - 建議修復：
    ```go
    username := "system"
    session := auth.GetSession(r)
    if u, ok := session.Values["username"].(string); ok && u != "" {
        username = u
    }
    ```

---

## 🟡 中等 (Moderate)

- [ ] **P-01: Error Response 泄漏伺服器內部路徑（路徑遍歷風險）**
  - 檔案：`src/internal/handler/config_handler.go:94,216`
  - 漏洞類型：CWE-209（Information Exposure Through Error Messages）/ P7
  - 描述：`HandleGetServiceConfig` 在讀取失敗時將完整錯誤訊息（含底層檔案路徑）回傳給用戶端：
    ```go
    writeJSON(w, http.StatusInternalServerError, messageJSON{Error: "無法讀取設定檔：" + err.Error()})
    ```
    `HandleSaveServiceConfig` 半成功時亦回傳完整 `backupPath`（含伺服器內部路徑）：
    ```go
    writeJSON(w, http.StatusInternalServerError, map[string]interface{}{
        "error": "設定檔已儲存，但 daemon-reload 失敗: " + err.Error() + "...",
    })
    ```
  - 攻擊情境：攻擊者透過故意觸發讀取失敗（如存取無權限的檔案），從錯誤訊息取得內部路徑結構（/etc/systemd/system/、/var/lib/linux-service-manager/）。
  - 影響：**資訊洩漏**——攻擊者可利用路徑資訊進行進一步攻擊。
  - 建議修復：記錄詳細錯誤於 server log，回傳給用戶端的錯誤訊息只含通用描述（不含路徑）。

- [ ] **P-02: 前端未驗證 API 回應中的敏感欄位洩漏**
  - 檔案：`frontend/src/api/client.ts:17`（間接）
  - 漏洞類型：CWE-200（Exposure of Sensitive Information）
  - 描述：前端 axios instance 設定 `withCredentials: true`（正確），但 401 interceptor 只清空 auth store，未清除瀏覽器的 service worker cache（PWA）。若有多個分頁，其他分頁可能仍持有舊的 cached API 回應。
    ```ts
    api.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.response?.status === 401) {
          const auth = useAuthStore()
          auth.authenticated = false
          auth.username = ''
        }
        return Promise.reject(error)
      },
    )
    ```
  - 攻擊情境：使用者登出後，其他分頁可能仍可從 SW cache 讀取已過期的 API 回應（如服務列表）。
  - 影響：**低風險**——因為敏感操作（start/stop/revalidate）需 POST，GET 響應快取的服務列表不含敏感資料。
  - 建議修復：登出時呼叫 `caches.keys()` 清除 SW cache，或確保 SW 不快取含敏感資料的 API 回應。

- [ ] **P-03: Session Fixation 風險（登入後未明確重新產生 Session ID）**
  - 檔案：`src/internal/handler/json_handler.go:116-121`
  - 漏洞類型：CWE-384（Session Fixation）/ M7
  - 描述：`HandleLoginJSON` 取得現有 session 後直接設定 `authenticated=true`，但 **未呼叫 `session.Save()` 強制重新產生 session ID**。gorilla/sessions 的 `CookieStore` 在 `Get()` 時從 cookie 讀取現有 session ID；若攻擊者能預先植入 session ID（如透過 XSS），登入後 session ID 不變，攻擊者可劫持已認證的 session。
    ```go
    session := auth.GetSession(r)  // 讀取現有 session ID
    session.Values["authenticated"] = true
    session.Values["username"] = username
    auth.SaveSession(w, r, session)  // Save 會寫入 cookie，但不一定換 ID
    ```
    gorilla/sessions 的 `CookieStore` 在呼叫 `Save()` 時，若 session ID 未變，不會自動重新產生。
  - 攻擊情境：攻擊者先透過某種方式（XSS / 共用電腦）取得受害者未認證的 session ID，受害者之後登入，攻擊者以相同的 session ID 取得已認證狀態。
  - 影響：**Account takeover**（前提是有其他漏洞能取得初始 session ID）。
  - 建議修復：在登入前呼叫 `session.Options.MaxAge = -1` 並 `session.Save()`，然後重新 `session = auth.GetSession(r)` 取得新 session：
    ```go
    // 銷毀舊 session
    oldSession := auth.GetSession(r)
    oldSession.Options.MaxAge = -1
    auth.SaveSession(w, r, oldSession)
    // 建立新 session
    session := auth.GetSession(r)
    session.Values["authenticated"] = true
    session.Values["username"] = username
    auth.SaveSession(w, r, session)
    ```

---

## ✅ 安全設計優點

1. **TLS 指紋驗證（nodeproxy/tls.go）**：使用 `VerifyPeerCertificate` callback 進行 SPKI fingerprint pinning，而非依賴系統 CA，防止中間人攻擊。有空 fingerprint 時才退回 "encrypt-only" 模式，明確標示風險。

2. **Token 安全設計（token/token.go）**：Token 使用 SHA-256 hash 儲存，raw value 僅在建立時回傳一次。Token 有 scope（read/full）、過期機制、數量上限（20）、名稱大小寫唯一等設計。

3. **Constant-time Token 比對（nodeproxy/hub.go:258）**：使用 `subtle.ConstantTimeCompare` 驗證 agent token，防止 timing attack。

4. **Service Name 正則驗證（systemd/systemd.go）**：使用 `^[a-zA-Z0-9][a-zA-Z0-9:@_.\-]*\.service$` 格式驗證服務名稱，有效防止 command injection。

5. **路徑邊界驗證（systemd/config.go）**：使用 `filepath.Clean + filepath.Rel`（非 `strings.HasPrefix`）驗證路徑在 `/etc/systemd/system/` 下，包含 symlink 解析，防止 path traversal。

6. **Rate Limiting 架構**：IP-based rate limiter 有 `maxEntries=10000` 上限防止記憶體耗盡，有 background cleanup goroutine。Agent WS 有獨立的 rate limiter。

7. **WebSocket Origin 檢查（websocket/origin.go）**：安全預設——不設定 `WS_ALLOWED_ORIGINS` 時拒絕所有帶 Origin header 的請求（瀏覽器），非瀏覽器客戶端（無 Origin）仍可連線。

8. **Session 安全設定（auth/auth.go）**：HttpOnly=true、Secure 可透過環境變數設定、SameSite=Lax、MaxAge=30 分鐘、使用隨機 32 bytes key（若未設定 SESSION_KEY）。

9. **Logout 清除所有 WS 連線**：`KillByUser` 在登出時關閉所有屬於該用戶的 WebSocket 連線，防止 session 失效後仍接收即時推送。

10. **Agent Binary 限制架構**：下載端點限定 `amd64/arm64`，防止目錄遍歷。`BinaryDir` 由環境變數控制。

---

## 📋 建議改進清單（按優先級排序）

| 優先級 | 編號 | 改善建議 | 說明 |
|--------|------|----------|------|
| 🔴 P0 | C-01 | Agent dial 時遮罩 token 再寫入 log | 防止 credential 洩漏至日誌 |
| 🟠 P1 | M-01 | 主伺服器加上 `http.Server` timeout 設定 | 防止 Slowloris DDoS |
| 🟠 P1 | M-03 | Nodes Handler 使用 `auth.GetSession(r)` 取得 username | 修復 audit log 永遠顯示 "system" |
| 🟡 P2 | P-03 | 登入流程加入 session fixation 防護 | 銷毀舊 session 再建立新 session |
| 🟡 P2 | P-01 | Error response 不含伺服器內部路徑 | 防止資訊洩漏 |
| 🟡 P3 | P-02 | Logout 時清除 SW cache（如適用） | PWA cache 安全清理 |
| 🟡 P3 | M-02 | 評估 /logout 是否需要 rate limit | 低風險但建議評估 |

---

*文件建立：2025-11 | 審查員：AI Code Review (T4)*
*審查範圍：C1-C8, M7-M8, P4-P7（安全性 & 設計專項）*
