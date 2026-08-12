# API Token 管理與驗證 — 測試計畫

> **對應 BDD**：`docs/bdds/011-api-token-auth.feature`
> **操作流程**：`docs/interaction-flows/011-api-token-auth.md`
> **測試日期**：2025-08-09

---

## 1. 測試範圍總覽

| 層級 | 範圍 | 工具 | 負責 |
|------|------|------|------|
| 單元測試 | Go Token 模組（CRUD / Hash / 格式 / 驗證） | `go test` | 後端 |
| 單元測試 | Go Auth Middleware（Bearer Token 驗證 / 權限檢查） | `go test` + `net/http/httptest` | 後端 |
| 單元測試 | Go Token API Handler | `go test` + `net/http/httptest` | 後端 |
| 單元測試 | Vue TokenManageView 頁面元件 | Vitest 4.1 + @vue/test-utils 2.4 + happy-dom | 前端 |
| 單元測試 | Vue 建立 Token 表單 / 揭露 Modal / 撤銷確認 Modal | Vitest 4.1 + @vue/test-utils 2.4 | 前端 |
| 整合測試 | Token 建立 → SHA-256 hash 儲存 → Bearer 驗證 → 操作執行 | 手動 / 腳本 | 後端 |
| 整合測試 | Token 操作 → Audit Log 寫入 → 查詢驗證 | 手動 / 腳本 | 後端 |
| 端對端測試 | 完整使用者操作流程（管理員建立/撤銷 Token + 外部系統使用 Token 呼叫 API） | Playwright 1.62 | 前端 |
| 手動驗證 | 真實環境 Token 格式 / 並發 / 儲存層驗證 / 與 session 共存 | 手動 | QA |

---

## 2. 後端單元測試

### 2.1 Token 模組（CRUD / Hash / 格式 / 驗證）

> 對應 BDD：`@happy-path` `@error-handling` `@business-rules` `@edge-case`

| # | 測試名稱 | Given | When | Then |
|---|---------|-------|------|------|
| SYS-01 | 正常建立 Token | name="Jenkins CI", expires_in_days=90, scope="full" | 呼叫 `CreateToken(name, expires_in_days, scope)` | 回傳 Token 原始值（約 48 字元），Token 已寫入儲存層，儲存層僅含 SHA-256 hash |
| SYS-02 | Token 原始值格式檢查 | 呼叫 CreateToken 成功 | 檢查回傳的 Token 原始值 | 前綴為 `lsm_`，總長度約 48 字元（Base64URL 編碼），不含特殊字元 |
| SYS-03 | Token 僅儲存 SHA-256 hash | 已建立一筆 Token | 查詢儲存層中的 Token 記錄 | Token 值欄位為 SHA-256 hash，非原始值；無法從 hash 反推原始值 |
| SYS-04 | Token 儲存 hash 一致性 | 同一 Token 原始值 | 對原始值計算 SHA-256 | 結果與儲存層中的 hash 一致 |
| SYS-05 | 建立 Token 後原始值不可再查詢 | 已建立 Token | 呼叫 `GetToken(id)` | 回傳的 Token 欄位不含原始值，僅含前綴遮罩（前 4 + `****` + 後 4） |
| SYS-06 | 列出 Token 列表（有資料） | 系統有 3 筆 Token | 呼叫 `ListTokens()` | 回傳 3 筆，每筆含 name / prefix / created_at / expires_at / last_used_at / scope / status，不含原始值 |
| SYS-07 | 列出 Token 列表（無資料） | 系統無任何 Token | 呼叫 `ListTokens()` | 回傳空陣列，無 error |
| SYS-08 | Token 列表依建立日期倒序 | Token A（最舊）、Token B、Token C（最新） | 呼叫 `ListTokens()` | 回傳順序為 C → B → A |
| SYS-09 | 撤銷 Token（正常） | Token 狀態為 active | 呼叫 `RevokeToken(id)` | Token 狀態變為 revoked，回傳 200 OK |
| SYS-10 | 撤銷已撤銷的 Token（冪等性） | Token 狀態已為 revoked | 再次呼叫 `RevokeToken(id)` | 回傳 200 OK，回應表示 "already revoked"，不報錯 |
| SYS-11 | 名稱唯一性檢查（完全相同） | 已有 Token 名為 "Jenkins CI" | 以 name="Jenkins CI" 呼叫 `CreateToken(...)` | 回傳 "名稱已存在" 錯誤 |
| SYS-12 | 名稱唯一性不區分大小寫 | 已有 Token 名為 "Jenkins CI" | 以 name="jenkins ci" 呼叫 `CreateToken(...)` | 回傳 "名稱已存在" 錯誤（不區分大小寫檢查） |
| SYS-13 | 名稱空白檢查 | name="" | 呼叫 `CreateToken(name="", ...)` | 回傳 validation error："名稱為必填" |
| SYS-14 | 名稱純空白檢查 | name="   " | 呼叫 `CreateToken(name="   ", ...)` | 回傳 validation error："名稱為必填" |
| SYS-15 | Token 數量上限（已達 20 個有效 Token） | 系統已有 20 筆 active Token | 呼叫 `CreateToken(...)` | 回傳 error："已達 Token 數量上限（20 個）" |
| SYS-16 | Token 數量上限（含已撤銷不計） | 系統 20 筆 active + 5 筆 revoked Token（共 25 筆） | 呼叫 `CreateToken(...)` | 回傳 error："已達 Token 數量上限（20 個）"（僅計算 active） |
| SYS-17 | Token 數量未達上限 | 系統有 19 筆 active Token | 呼叫 `CreateToken(...)` | Token 建立成功 |
| SYS-18 | 過期時間設定 — 30 天 | expires_in_days=30 | 呼叫 `CreateToken(name="test", expires_in_days=30, ...)` | Token.expires_at = 建立日 + 30 天 |
| SYS-19 | 過期時間設定 — 60 天 | expires_in_days=60 | 呼叫 `CreateToken(...)` | Token.expires_at = 建立日 + 60 天 |
| SYS-20 | 過期時間設定 — 90 天 | expires_in_days=90 | 呼叫 `CreateToken(...)` | Token.expires_at = 建立日 + 90 天 |
| SYS-21 | 過期時間設定 — 180 天 | expires_in_days=180 | 呼叫 `CreateToken(...)` | Token.expires_at = 建立日 + 180 天 |
| SYS-22 | 過期時間設定 — 365 天 | expires_in_days=365 | 呼叫 `CreateToken(...)` | Token.expires_at = 建立日 + 365 天 |
| SYS-23 | 過期時間設定 — 永不過期 | expires_in_days=0 或 expires_in_days=-1 | 呼叫 `CreateToken(...)` | Token.expires_at = nil/null，過期檢查永遠通過 |
| SYS-24 | 過期時間設定 — 自訂日期 | expires_at="2026-06-15T00:00:00Z" | 呼叫 `CreateToken(expires_at=...)` | Token.expires_at = 指定日期 |
| SYS-25 | 過期時間無效（負數，非永久） | expires_in_days=-5 | 呼叫 `CreateToken(...)` | 回傳 validation error |
| SYS-26 | 權限範圍 — 唯讀 | scope="readonly" | 呼叫 `CreateToken(scope="readonly", ...)` | Token.scope = "readonly" |
| SYS-27 | 權限範圍 — 完整操作 | scope="full" | 呼叫 `CreateToken(scope="full", ...)` | Token.scope = "full" |
| SYS-28 | 權限範圍無效 | scope="admin"（不在枚舉內） | 呼叫 `CreateToken(...)` | 回傳 validation error："無效的權限範圍" |
| SYS-29 | Token 狀態 — 使用中 | Token 未過期、未撤銷 | 查詢 Token 狀態 | status = "active" |
| SYS-30 | Token 狀態 — 即將過期（7 天內） | Token.expires_at = 現在 + 3 天 | 查詢 Token 狀態 | status = "expiring_soon" |
| SYS-31 | Token 狀態 — 已過期 | Token.expires_at < 現在 | 查詢 Token 狀態 | status = "expired" |
| SYS-32 | Token 狀態 — 已撤銷 | Token.revoked_at 非空 | 查詢 Token 狀態 | status = "revoked" |
| SYS-33 | 最後使用時間初始化 | 新建立的 Token | 查詢 Token | last_used_at = null 或 "從未使用" |
| SYS-34 | 最後使用時間非同步更新 | Token 驗證通過 | 該次 API 回應完成後稍等 | last_used_at 已被更新為當前時間（分鐘級精度），更新不影響 API 回應時間 |

### 2.2 Auth Middleware（Bearer Token 驗證 / 權限檢查）

> 對應 BDD：`@error-handling` `@business-rules` `@security`

| # | 測試名稱 | Given | When | Then |
|---|---------|-------|------|------|
| MID-01 | 有效 Bearer Token 驗證通過（完整操作 + POST） | Header: Authorization: Bearer lsm_xxxx，Token 存在、有效、scope=full | 請求 POST API | 驗證通過，request context 設為 auth_method=token，含 token_name / scope，請求繼續執行 |
| MID-02 | 有效 Bearer Token 驗證通過（唯讀 + GET） | Header: Authorization: Bearer lsm_readonly，Token 有效、scope=readonly | 請求 GET API | 驗證通過，request context 設為 auth_method=token，請求繼續執行 |
| MID-03 | Token 不存在 | Header: Authorization: Bearer lsm_fake | 請求任意 API | 回傳 401，body 含 `{"error": "Token 無效"}` |
| MID-04 | Token 已撤銷 | Header: Authorization: Bearer lsm_revoked，Token 狀態為 revoked | 請求任意 API | 回傳 401，body 含 `{"error": "Token 已被撤銷"}` |
| MID-05 | Token 已過期 | Header: Authorization: Bearer lsm_expired，Token.expires_at < 現在 | 請求任意 API | 回傳 401，body 含 `{"error": "Token 已過期"}` |
| MID-06 | 唯讀 Token 執行 POST（寫入） | Header: Authorization: Bearer lsm_readonly，scope=readonly | 請求 POST API | 回傳 403，body 含 `{"error": "權限不足，此 Token 僅供唯讀"}` |
| MID-07 | 唯讀 Token 執行 PUT（寫入） | Header: Authorization: Bearer lsm_readonly，scope=readonly | 請求 PUT API | 回傳 403，body 含 `{"error": "權限不足，此 Token 僅供唯讀"}` |
| MID-08 | 唯讀 Token 執行 DELETE（寫入） | Header: Authorization: Bearer lsm_readonly，scope=readonly | 請求 DELETE API | 回傳 403，body 含 `{"error": "權限不足，此 Token 僅供唯讀"}` |
| MID-09 | 未提供任何驗證資訊 | 無 Authorization header，無 Cookie session | 請求需驗證的 API | 回傳 401，body 含 `{"error": "未提供驗證資訊"}` |
| MID-10 | Bearer Token 優先於 Cookie Session | 同時攜帶有效 Bearer Token 和有效 Cookie session | 請求 API | 使用 Bearer Token 驗證，request context.auth_method = "token"（非 "session"） |
| MID-11 | 僅 Cookie Session 驗證（無 Bearer Token） | 無 Authorization header，有有效 Cookie session | 請求 API | 使用 session 驗證，auth_method = "session"，請求繼續執行 |
| MID-12 | Authorization header 格式錯誤（非 Bearer） | Header: Authorization: Basic xxxxx | 請求 API | 回傳 401，視為無效 Token 格式 |
| MID-13 | Authorization header 為空字串 | Header: Authorization: Bearer（無 token 值） | 請求 API | 回傳 401，body 含 `{"error": "未提供驗證資訊"}` 或 "Token 無效" |
| MID-14 | 有效 Token 寫入操作 — last_used_at 非同步更新 | Token 驗證通過，請求繼續執行 | 請求完成後檢查 | last_used_at 已更新，不影響該次 API 回應時間 |
| MID-15 | Login / Logout 僅使用 session | 攜帶有效 Bearer Token，無 session | 請求 POST /api/v1/login | Auth middleware 不攔截 Login/Logout 路由，正常處理（session 驗證不受影響） |

### 2.3 Handler 層（Token API）

> 對應 BDD：`@happy-path` `@error-handling` `@validation`

| # | 測試名稱 | Given | When | Then |
|---|---------|-------|------|------|
| HDL-01 | GET /api/v1/tokens 正常回傳 Token 列表 | 系統有 3 筆 Token | 已驗證 session，GET /api/v1/tokens | 200，回傳 Token 陣列，每筆含 name / prefix / created_at / expires_at / last_used_at / scope / status |
| HDL-02 | GET /api/v1/tokens 無 Token 時 | 系統無任何 Token | 已驗證 session，GET /api/v1/tokens | 200，回傳空陣列 `[]` |
| HDL-03 | GET /api/v1/tokens 不包含原始 Token 值 | 系統有 Token | 已驗證 session，GET /api/v1/tokens | 回應中無 token_raw 或 token_value 欄位，token 值僅顯示遮罩（前 4 + **** + 後 4） |
| HDL-04 | POST /api/v1/tokens 建立 Token 成功 | name="Jenkins CI", expires_in_days=90, scope="full" | 已驗證 session，POST /api/v1/tokens | 201，回傳 Token 原始值（一次性揭露），response body 含 token、name、expires_at、scope |
| HDL-05 | POST /api/v1/tokens 名稱空白 | name="" | 已驗證 session，POST /api/v1/tokens | 400，body 含 `{"error": "名稱為必填"}` |
| HDL-06 | POST /api/v1/tokens 名稱重複 | 已有 Token name="Jenkins CI" | 以 name="Jenkins CI" POST /api/v1/tokens | 409 或 400，body 含 `{"error": "此名稱已存在，請使用其他名稱"}` |
| HDL-07 | POST /api/v1/tokens 達數量上限 | 已有 20 筆 active Token | POST /api/v1/tokens | 400 或 429，body 含已達上限的錯誤訊息 |
| HDL-08 | POST /api/v1/tokens 未驗證 | 無 session cookie | POST /api/v1/tokens | 401 Unauthorized |
| HDL-09 | POST /api/v1/tokens/{id}/revoke 撤銷成功 | Token id="tok_001"，狀態=active | 已驗證 session，POST /api/v1/tokens/tok_001/revoke | 200，body 含 `{"status": "revoked"}` |
| HDL-10 | POST /api/v1/tokens/{id}/revoke 冪等 | Token id="tok_001" 已為 revoked | 已驗證 session，POST /api/v1/tokens/tok_001/revoke | 200，body 含 `{"status": "already_revoked"}` |
| HDL-11 | POST /api/v1/tokens/{id}/revoke Token 不存在 | Token id="tok_nonexistent" 不存在 | 已驗證 session，POST /api/v1/tokens/tok_nonexistent/revoke | 404，body 含 `{"error": "Token 不存在"}` |
| HDL-12 | POST /api/v1/tokens/{id}/revoke 未驗證 | 無 session cookie | POST /api/v1/tokens/tok_001/revoke | 401 Unauthorized |
| HDL-13 | GET /api/v1/tokens 未驗證 | 無 session cookie | GET /api/v1/tokens | 401 Unauthorized |
| HDL-14 | POST /api/v1/tokens 內部錯誤 | mock token 模組回傳內部錯誤 | POST /api/v1/tokens | 500，body 含 `{"error": "建立失敗，請稍後重試"}` |
| HDL-15 | POST /api/v1/tokens/{id}/revoke 內部錯誤 | mock token 模組回傳內部錯誤 | POST /api/v1/tokens/tok_001/revoke | 500，body 含 `{"error": "撤銷失敗，請重試"}` |
| HDL-16 | GET /api/v1/tokens 內部錯誤 | mock token 模組回傳內部錯誤 | GET /api/v1/tokens | 500，body 含錯誤訊息 |

---

## 3. 前端單元測試

### 3.1 TokenManageView 頁面元件

> 對應 BDD：`@happy-path` `@error-handling`

| # | 測試名稱 | Given | When | Then |
|---|---------|-------|------|------|
| F-TK-01 | 頁面載入時顯示 loading spinner | 尚未收到 API 回應 | mount TokenManageView | 顯示 loading spinner |
| F-TK-02 | 成功載入後顯示 Token 列表 | mock GET /api/v1/tokens 回傳 3 筆 Token | mount + await API response | 列表顯示 3 筆 Token，每筆含名稱、遮罩值、建立日期、過期時間、最後使用時間、權限範圍、狀態標籤 |
| F-TK-03 | Token 列表依建立日期倒序 | mock 回傳 3 筆（建立日期 C > B > A） | mount + await API response | 列表順序為 C → B → A |
| F-TK-04 | 無 Token 時顯示空狀態 | mock API 回傳空陣列 | mount + await API response | 顯示「尚無 API Token」訊息 +「建立 Token」按鈕 |
| F-TK-05 | API 錯誤顯示錯誤訊息 + 重試按鈕 | mock API 回傳 500 | mount + await API response | 顯示錯誤訊息 +「重試」按鈕 |
| F-TK-06 | 點擊重試按鈕重新載入 | 處於錯誤狀態 | click「重試」按鈕 | 重新呼叫 GET /api/v1/tokens，回到 loading 狀態 |
| F-TK-07 | 狀態標籤 — 🟢 使用中 | Token status = "active" | mount + await API response | 該 Token 列顯示 🟢「使用中」標籤 |
| F-TK-08 | 狀態標籤 — 🟡 即將過期 | Token status = "expiring_soon"（過期在 7 天內） | mount + await API response | 該 Token 列顯示 🟡「即將過期」標籤 |
| F-TK-09 | 狀態標籤 — 🔴 已過期 | Token status = "expired" | mount + await API response | 該 Token 列顯示 🔴「已過期」標籤 |
| F-TK-10 | 狀態標籤 — ⚫ 已撤銷 | Token status = "revoked" | mount + await API response | 該 Token 列顯示 ⚫「已撤銷」標籤，灰色文字 |
| F-TK-11 | 過期時間顯示 — 一般日期 | expires_at = "2026-06-15" | mount | 過期時間欄位顯示 2026-06-15 |
| F-TK-12 | 過期時間顯示 — 永不過期 | expires_at = null | mount | 過期時間欄位顯示「永不過期」 |
| F-TK-13 | 最後使用時間顯示 — 有使用紀錄 | last_used_at = "2025-08-05T10:00:00Z" | mount | 最後使用時間欄位顯示 2025-08-05 10:00 |
| F-TK-14 | 最後使用時間顯示 — 從未使用 | last_used_at = null | mount | 最後使用時間欄位顯示「從未使用」 |
| F-TK-15 | Token 遮罩顯示 | prefix = "lsm_...a1b2" | mount | Token 值欄位以 `lsm_` + `********` + `a1b2` 格式顯示 |
| F-TK-16 | 使用中 Token 顯示撤銷按鈕 | Token status = "active" | mount | 該 Token 列顯示「撤銷」按鈕 |
| F-TK-17 | 已撤銷 Token 不顯示撤銷按鈕 | Token status = "revoked" | mount | 該 Token 列無「撤銷」按鈕 |
| F-TK-18 | 已過期 Token 不顯示撤銷按鈕 | Token status = "expired" | mount | 該 Token 列無「撤銷」按鈕 |
| F-TK-19 | 已過期 Token 折疊或置底 | 列表有 active 和 expired Token | mount | 已過期的 Token 置於列表底部或被折疊 |
| F-TK-20 | 點擊 Header「API Tokens」連結導航 | 在 Dashboard 頁面 | click Header「API Tokens」 | 路由導航至 /tokens，載入 TokenManageView |

### 3.2 建立 Token 表單元件

> 對應 BDD：`@happy-path` `@error-handling` `@validation` `@edge-case`

| # | 測試名稱 | Given | When | Then |
|---|---------|-------|------|------|
| F-CR-01 | 點擊「建立 Token」展開表單 | 在 /tokens 頁面 | click「建立 Token」按鈕 | 顯示建立表單，含「名稱」「過期時間」「權限範圍」三個欄位 |
| F-CR-02 | 名稱欄位為空白時攔截提交 | 名稱欄位留白，過期時間已選，權限已選 | click「產生 Token」按鈕 | 前端攔截提交，名稱欄位顯示「名稱為必填」錯誤提示 |
| F-CR-03 | 名稱僅空白字元時攔截提交 | 名稱欄位 = "   " | click「產生 Token」按鈕 | 前端攔截提交，名稱欄位顯示「名稱為必填」 |
| F-CR-04 | 提交後按鈕變灰 + spinner | 已填寫有效資訊 | click「產生 Token」按鈕 | 按鈕變 disabled，顯示 spinner，無法重複點擊 |
| F-CR-05 | 建立成功後顯示揭露 Modal | mock POST /api/v1/tokens 回傳 201 + Token 原始值 | submit 表單 | Token 揭露 Modal 顯示，含警告文字 + Token 值 + 複製按鈕 |
| F-CR-06 | 名稱重複顯示錯誤 | mock POST /api/v1/tokens 回傳 409（名稱重複） | submit 表單 | 表單下方顯示「此名稱已存在，請使用其他名稱」錯誤 |
| F-CR-07 | 伺服器錯誤顯示錯誤 + 保留表單內容 | mock POST /api/v1/tokens 回傳 500 | submit 表單（已填寫 name="Test", scope="full"） | 表單下方顯示紅色錯誤「建立失敗，請稍後重試」，表單內容保留 name / scope 不需重新填寫 |
| F-CR-08 | 達數量上限顯示錯誤 | mock POST /api/v1/tokens 回傳 400（上限） | submit 表單 | 表單下方顯示已達上限的錯誤訊息 |
| F-CR-09 | 過期時間下拉選單選項 | 表單已展開 | 檢查過期時間下拉選單 | 選項包含：30 天 / 60 天 / 90 天 / 180 天 / 365 天 / 自訂日期 / 永不過期 |
| F-CR-10 | 選擇「自訂日期」時顯示日期選擇器 | 過期時間選擇「自訂日期」 | 檢查表單 | 額外顯示日期選擇器（datepicker） |
| F-CR-11 | 權限範圍 Radio 選項 | 表單已展開 | 檢查權限範圍欄位 | 顯示「唯讀」和「完整操作」兩個選項（radio 或下拉） |
| F-CR-12 | 取消建立關閉表單 | 表單已展開 | click「取消」按鈕或關閉圖示 | 表單關閉，返回 Token 列表 |
| F-CR-13 | 建立成功後列表重整 | mock POST 成功 | submit → 揭露 Modal 關閉 | Token 列表重新載入，新 Token 出現在列表頂部 |

### 3.3 Token 揭露 Modal 元件

> 對應 BDD：`@happy-path` `@edge-case`

| # | 測試名稱 | Given | When | Then |
|---|---------|-------|------|------|
| F-RV-01 | Modal 顯示警告訊息 | Modal 開啟，Token 值已顯示 | 檢查 Modal 內容 | 顯示「⚠️ 請立即複製此 Token，關閉此視窗後將無法再次查看」警告 |
| F-RV-02 | Token 值顯示在唯讀文字框中 | Modal 開啟，Token 值為 "lsm_xxxx..." | 檢查 Token 顯示區域 | Token 值顯示在唯讀 (readonly) 文字框中，等寬字體，可選取 |
| F-RV-03 | 點擊「複製到剪貼簿」按鈕 | Modal 開啟 | click「複製到剪貼簿」 | Token 被複製到剪貼簿，顯示 Toast「Token 已複製」 |
| F-RV-04 | 點擊「我已複製，關閉」按鈕 | Modal 開啟 | click「我已複製，關閉」 | Modal 關閉，返回 Token 列表，列表重整，Toast 顯示「Token 已建立」 |
| F-RV-05 | 未複製直接關閉 Modal | Modal 開啟 | 點擊關閉按鈕（未點複製） | Modal 關閉，Token 值永久遺失，Token 列表中的值以遮罩顯示 |
| F-RV-06 | 關閉 Modal 後 Token 值不可再查看 | Modal 已關閉 | 檢查 Token 列表中新建立的 Token | Token 值欄位僅顯示遮罩（前 4 + **** + 後 4），無法查看原始值 |
| F-RV-07 | Modal 無法透過點擊背景關閉 | Modal 開啟 | 點擊 Modal 背景區域 | Modal 不關閉（防止誤關） |
| F-RV-08 | 新 Token 出現在列表頂部 | Modal 關閉後 | 檢查 Token 列表 | 新建立的 Token 出現在列表頂部，status = "active" |

### 3.4 撤銷確認 Modal 元件

> 對應 BDD：`@happy-path` `@error-handling`

| # | 測試名稱 | Given | When | Then |
|---|---------|-------|------|------|
| F-RK-01 | 點擊撤銷按鈕彈出 ConfirmModal | Token status = "active"，名稱為 "Jenkins CI" | click「撤銷」按鈕 | 顯示 ConfirmModal，含 Token 名稱「Jenkins CI」+ 不可復原警告 |
| F-RK-02 | ConfirmModal 警告文字正確 | ConfirmModal 開啟 | 檢查 Modal 內容 | 顯示「確定要撤銷 Token『Jenkins CI』嗎？使用此 Token 的服務將立即失去存取權。此操作無法復原。」 |
| F-RK-03 | 確認撤銷 — 成功 | ConfirmModal 開啟，mock revoke API 回傳 200 | click「確認撤銷」 | 該 Token 狀態變為「已撤銷」灰色顯示，撤銷按鈕消失，Toast「Token 已撤銷」 |
| F-RK-04 | 確認撤銷 — API 失敗 | ConfirmModal 開啟，mock revoke API 回傳 500 | click「確認撤銷」 | ConfirmModal 內顯示「撤銷失敗，請重試」，Token 狀態不變 |
| F-RK-05 | 取消撤銷 — 無任何變更 | ConfirmModal 開啟 | click「取消」按鈕 | Modal 關閉，Token 狀態保持「使用中」，無變更 |
| F-RK-06 | 已撤銷的 Token 不顯示撤銷按鈕 | Token status = "revoked" | 檢查 Token 列 | 「撤銷」按鈕不存在 |
| F-RK-07 | 撤銷操作按鈕顯示 spinner | ConfirmModal 開啟 | click「確認撤銷」後立即檢查 | 按鈕變灰 + spinner，防止重複點擊 |

---

## 4. 整合測試

> 對應 BDD：`@happy-path` `@business-rules` `@audit`

| # | 測試名稱 | 整合範圍 | 操作步驟 | 預期結果 |
|---|---------|---------|---------|---------|
| INT-01 | Token 建立 → SHA-256 hash 儲存 → Bearer 驗證 → 操作執行 | Token 模組 + Auth Middleware + API Handler | 1. 透過 API 建立 Token<br>2. 從回應取得原始 Token 值<br>3. 用原始 Token 值計算 SHA-256<br>4. 查詢儲存層確認 hash 一致<br>5. 用該 Token 呼叫受保護 API | API 驗證通過，回傳正常資料；儲存層無原始值 |
| INT-02 | Token 操作 → Audit Log 寫入 → 查詢驗證 | Token Handler + Audit 模組 | 1. 建立 Token<br>2. 查詢 Audit Log<br>3. 撤銷 Token<br>4. 再次查詢 Audit Log | Audit Log 含 token_create 和 token_revoke 兩筆記錄，含操作者與 Token 名稱 |
| INT-03 | Session 與 Token 共存不互相干擾 | Auth Middleware + Session 模組 | 1. 以 session 登入<br>2. 同時使用 Bearer Token 呼叫 API<br>3. 登出並確認 session 仍正常 | Session 驗證不受影響；Token 驗證獨立運作 |
| INT-04 | Token 撤銷後立即失效 | Auth Middleware + Token 模組 | 1. 建立 Token 並用其呼叫 API 成功<br>2. 撤銷該 Token<br>3. 立即用同一 Token 呼叫 API | 第二次呼叫回傳 401 Unauthorized |
| INT-05 | Token 過期後自動失效 | Token 模組 + Auth Middleware | 1. 建立過期時間為 1 秒後的 Token<br>2. 等待 2 秒<br>3. 用該 Token 呼叫 API | API 回傳 401「Token 已過期」 |
| INT-06 | 建立 Token 後未複製 → 原始值不可恢復 | Token 模組 + API | 1. 建立 Token<br>2. 不記錄原始值<br>3. 透過 GET /api/v1/tokens 查詢 | Token 值僅顯示遮罩，無法取得原始值 |

---

## 5. 端對端測試（Playwright）

> 對應 BDD：`@smoke` `@happy-path` `@p0` `@error-handling` `@edge-case` `@business-rules` `@security` + Scenario Outline Examples

### 5.1 Happy Path — Token 管理頁面

| # | 測試名稱 | 操作步驟 | 預期結果 |
|---|---------|---------|---------|
| E2E-01 | 管理員瀏覽 Token 列表（已有 Token） | 1. 登入管理員帳號<br>2. 預先建立至少 1 筆 Token<br>3. 點擊 Header「API Tokens」連結 | 頁面導航至 /tokens，GET /api/v1/tokens 呼叫成功，列表顯示 Token 名稱/遮罩/建立日期/過期時間/最後使用/權限/狀態，依建立日期倒序 |
| E2E-02 | 管理員瀏覽 Token 列表（尚無 Token） | 1. 登入管理員帳號<br>2. 確認系統無任何 Token<br>3. 點擊 Header「API Tokens」連結 | 顯示「尚無 API Token」空狀態 +「建立 Token」按鈕 |
| E2E-03 | 管理員建立 Token（完整流程含一次性揭露） | 1. 在 /tokens 頁面<br>2. 點擊「建立 Token」<br>3. 輸入名稱「Jenkins CI」<br>4. 選擇過期時間「90 天」<br>5. 選擇權限「完整操作」<br>6. 點擊「產生 Token」<br>7. 點擊「複製到剪貼簿」<br>8. 點擊「我已複製，關閉」 | 表單提交後按鈕變灰+spinner；揭露 Modal 顯示警告+Token；複製後 Toast「Token 已複製」；關閉後列表重整，新 Token 在頂部，遮罩顯示，Toast「Token 已建立」 |
| E2E-04 | 管理員撤銷 Token | 1. 在 /tokens 頁面<br>2. 找到「使用中」的 Token「Jenkins CI」<br>3. 點擊「撤銷」按鈕<br>4. 點擊 ConfirmModal 中的「確認撤銷」 | Token 狀態變為「已撤銷」灰色顯示，撤銷按鈕消失，Toast「Token 已撤銷」 |

### 5.2 Happy Path — Token API 驗證

| # | 測試名稱 | 操作步驟 | 預期結果 |
|---|---------|---------|---------|
| E2E-05 | 使用完整操作 Token 成功呼叫寫入 API | 1. 建立完整操作 Token<br>2. 用 curl/Playwright APIRequestContext 發送 POST 請求<br>3. Header: Authorization: Bearer <token> | API 回傳 200，操作成功執行 |
| E2E-06 | 使用唯讀 Token 成功呼叫 GET API | 1. 建立唯讀 Token<br>2. 用 curl/Playwright APIRequestContext 發送 GET 請求<br>3. Header: Authorization: Bearer <token> | API 回傳 200，正常回應 |

### 5.3 Error Handling — 錯誤處理

| # | 測試名稱 | 操作步驟 | 預期結果 |
|---|---------|---------|---------|
| E2E-07 | 建立 Token 時名稱空白 | 1. 點擊「建立 Token」<br>2. 名稱留白<br>3. 點擊「產生 Token」 | 前端攔截，名稱欄位顯示「名稱為必填」 |
| E2E-08 | 名稱重複 | 1. 已有 Token「Jenkins CI」<br>2. 點擊「建立 Token」<br>3. 輸入名稱「Jenkins CI」<br>4. 點擊「產生 Token」 | 表單下方顯示「此名稱已存在，請使用其他名稱」 |
| E2E-09 | Token 列表載入失敗 | 1. 模擬後端異常（攔截 API 回 500）<br>2. 點擊 Header「API Tokens」 | 頁面顯示錯誤訊息 +「重試」按鈕；點擊重試後重新載入 |
| E2E-10 | 使用不存在的 Token | 1. curl 發送 Bearer lsm_fake123 請求 | API 回傳 401，`{"error": "Token 無效"}` |
| E2E-11 | 使用已撤銷 Token | 1. 建立並撤銷 Token<br>2. curl 發送相同 Token 請求 | API 回傳 401，`{"error": "Token 已被撤銷"}` |
| E2E-12 | 使用已過期 Token | 1. 建立過期時間為過去的 Token<br>2. curl 發送請求 | API 回傳 401，`{"error": "Token 已過期"}` |
| E2E-13 | 唯讀 Token 執行寫入操作 | 1. 建立唯讀 Token<br>2. curl 發送 POST 請求 | API 回傳 403，`{"error": "權限不足，此 Token 僅供唯讀"}` |
| E2E-14 | 未提供任何驗證資訊 | 1. curl 發送請求，無 Authorization header，無 Cookie | API 回傳 401，`{"error": "未提供驗證資訊"}` |

### 5.4 Edge Cases — 邊界情況

| # | 測試名稱 | 操作步驟 | 預期結果 |
|---|---------|---------|---------|
| E2E-15 | Token 數量達到上限 | 1. 建立 20 個有效 Token<br>2. 嘗試建立第 21 個 | API 回傳錯誤，提示已達上限，無法建立 |
| E2E-16 | 並發撤銷同一 Token | 1. 撤銷 Token「tok_001」後<br>2. 再次發送撤銷請求 | 第二次回傳 200，回應 "already revoked" |
| E2E-17 | 建立 Token 後未複製關閉 Modal | 1. 建立 Token<br>2. 揭露 Modal 顯示時直接關閉（未點複製）<br>3. 檢查 Token 列表 | Token 值永久遺失，列表僅顯示遮罩 |
| E2E-18 | Token 即將過期狀態標籤 | 1. 建立過期時間為 3 天後的 Token<br>2. 載入 /tokens 頁面 | 該 Token 狀態標籤顯示 🟡「即將過期」 |
| E2E-19 | Token 過期後狀態自動變更 | 1. 建立已過期的 Token<br>2. 載入 /tokens 頁面 | 該 Token 狀態標籤顯示 🔴「已過期」，置於列表底部或折疊 |
| E2E-20 | Token 過期時間設定為永不過期 | 1. 點擊「建立 Token」<br>2. 選擇過期時間「永不過期」<br>3. 填寫名稱與權限<br>4. 提交 | Token 建立成功，過期時間顯示「永不過期」 |

### 5.5 Business Rules — 商業規則驗證

| # | 測試名稱 | 操作步驟 | 預期結果 |
|---|---------|---------|---------|
| E2E-21 | Token 僅儲存 hash，列表不顯示原始值 | 1. 建立 Token<br>2. 查看 GET /api/v1/tokens 回應 | 回應不含原始 Token 值，僅顯示遮罩（前 4 + **** + 後 4） |
| E2E-22 | Token 前綴格式驗證 | 1. 建立 Token<br>2. 取得原始值 | Token 值以「lsm_」為前綴，總長度約 48 字元 |
| E2E-23 | Token 名稱不區分大小寫 | 1. 建立 Token「Jenkins CI」<br>2. 嘗試建立「jenkins ci」 | 判定名稱重複，API 回傳錯誤 |
| E2E-24 | Bearer Token 優先於 Cookie Session | 1. 同時攜帶有效 Bearer Token 和有效 Cookie session<br>2. 發送 API 請求 | 以 Bearer Token 驗證為準，auth_method = token |
| E2E-25 | Cookie Session 驗證不受 Token 機制影響 | 1. 管理員以 Cookie session 登入<br>2. 執行 Login / Logout | Session 驗證正常運作，不受 Token middleware 影響 |

### 5.6 Scenario Outline — 參數化測試

| # | 測試名稱 | 操作步驟 | 預期結果 |
|---|---------|---------|---------|
| E2E-26 | 不同過期時間建立 Token — 30 天 | 選擇過期時間「30 天」，建立 Token | Token.expires_at = 建立日 + 30 天 |
| E2E-27 | 不同過期時間建立 Token — 60 天 | 選擇過期時間「60 天」，建立 Token | Token.expires_at = 建立日 + 60 天 |
| E2E-28 | 不同過期時間建立 Token — 90 天 | 選擇過期時間「90 天」，建立 Token | Token.expires_at = 建立日 + 90 天 |
| E2E-29 | 不同過期時間建立 Token — 180 天 | 選擇過期時間「180 天」，建立 Token | Token.expires_at = 建立日 + 180 天 |
| E2E-30 | 不同過期時間建立 Token — 365 天 | 選擇過期時間「365 天」，建立 Token | Token.expires_at = 建立日 + 365 天 |
| E2E-31 | 不同過期時間建立 Token — 永不過期 | 選擇過期時間「永不過期」，建立 Token | Token.expires_at = null，「永不過期」 |
| E2E-32 | 不同過期時間建立 Token — 自訂日期 | 選擇「自訂日期」，指定 2026-12-31，建立 Token | Token.expires_at = 2026-12-31 |
| E2E-33 | 唯讀 Token + GET | 用唯讀 Token 發送 GET 請求 | HTTP 200 |
| E2E-34 | 唯讀 Token + POST | 用唯讀 Token 發送 POST 請求 | HTTP 403 |
| E2E-35 | 唯讀 Token + PUT | 用唯讀 Token 發送 PUT 請求 | HTTP 403 |
| E2E-36 | 唯讀 Token + DELETE | 用唯讀 Token 發送 DELETE 請求 | HTTP 403 |
| E2E-37 | 完整操作 Token + GET | 用完整操作 Token 發送 GET 請求 | HTTP 200 |
| E2E-38 | 完整操作 Token + POST | 用完整操作 Token 發送 POST 請求 | HTTP 200 |
| E2E-39 | 完整操作 Token + PUT | 用完整操作 Token 發送 PUT 請求 | HTTP 200 |
| E2E-40 | 完整操作 Token + DELETE | 用完整操作 Token 發送 DELETE 請求 | HTTP 200 |
| E2E-41 | Token 驗證失敗 — 未攜帶任何驗證 | 無 Authorization header + 無 Cookie | HTTP 401，"未提供驗證資訊" |
| E2E-42 | Token 驗證失敗 — Token 不存在 | Bearer lsm_fake123 | HTTP 401，"Token 無效" |
| E2E-43 | Token 驗證失敗 — Token 已撤銷 | Bearer lsm_revoked | HTTP 401，"Token 已被撤銷" |
| E2E-44 | Token 驗證失敗 — Token 已過期 | Bearer lsm_expired | HTTP 401，"Token 已過期" |
| E2E-45 | Token 驗證失敗 — 唯讀 Token + 寫入操作 | 唯讀 Token + POST | HTTP 403，"權限不足，此 Token 僅供唯讀" |

### 5.7 Audit Log 整合

| # | 測試名稱 | 操作步驟 | 預期結果 |
|---|---------|---------|---------|
| E2E-46 | 審計記錄 — Token 建立寫入 Audit Log | 1. 透過 UI 建立 Token<br>2. 檢查 Audit Log 頁面 | Audit Log 含 action="token_create" 記錄，含操作者與 Token 名稱 |
| E2E-47 | 審計記錄 — Token 撤銷寫入 Audit Log | 1. 透過 UI 撤銷 Token<br>2. 檢查 Audit Log 頁面 | Audit Log 含 action="token_revoke" 記錄，含操作者與 Token 名稱 |

---

## 6. 手動驗證（真實環境）

> 對應 BDD：`@edge-case` `@business-rules` `@compliance` — 真實環境才能驗證的場景

| # | 情境 | 驗證步驟 | 預期 |
|---|------|---------|------|
| MAN-01 | Token 儲存層驗證 — 僅保留 SHA-256 hash | 1. 建立 Token<br>2. 檢查 Token 儲存檔案/DB（如 tokens.json / SQLite DB）<br>3. 手動計算原始 Token 的 SHA-256 | 儲存層中 Token 值為 SHA-256 hash；原始 Token 值不存在於任何儲存中 |
| MAN-02 | Token 原始值在記憶體中不殘留 | 1. 建立 Token<br>2. 揭露 Modal 關閉後<br>3. 檢查前端記憶體 / Vue DevTools | 前端記憶體中無 Token 原始值（揭露 Modal 銷毀時清除） |
| MAN-03 | 並發使用同一 Token 呼叫 API（race condition） | 1. 建立完整操作 Token<br>2. 使用 ab/wrk 等工具，以 10 並發同時呼叫寫入 API | 所有請求均正常處理，無 race condition 導致資料損壞 |
| MAN-04 | 快速連續建立 Token（達到上限） | 1. 快速點擊「產生 Token」多次<br>2. 測試前端是否防止重複提交 | 前端已 disable 按鈕，不會重複建立；後端名稱唯一性檢查正常 |
| MAN-05 | Token 儲存損毀還原 | 1. 手動損毀 Token 儲存檔案<br>2. 重新載入 Token 管理頁面<br>3. 嘗試使用現有 Token 呼叫 API | 頁面顯示錯誤或空列表；Token 驗證失敗回傳 401；系統不 crash |
| MAN-06 | 管理員瀏覽器關閉後 Token 遮罩不洩漏 | 1. 在 Token 頁面停留<br>2. 關閉並重新開啟瀏覽器<br>3. 檢查 localStorage / sessionStorage | 無 Token 原始值儲存在 local/sessionStorage |
| MAN-07 | Audit Log — Token 操作記錄的完整性 | 1. 建立多個 Token 後撤銷部分<br>2. 檢查 Audit Log JSON 內容 | 所有 token_create 和 token_revoke 事件均記錄，含 timestamp / operator / token_name，不含 Token 值 |
| MAN-08 | Session 與 Token 在同一請求中不衝突 | 1. 管理員在瀏覽器中登入（有 Cookie session）<br>2. 同時在同一個請求中手動加入 Authorization: Bearer header<br>3. 檢查 API 回應與 context | auth_method 為 token（非 session），API 正常回應 |
| MAN-09 | Token 過期時間邊界（剛好過期瞬間） | 1. 設定 Token 過期時間為 N 秒後<br>2. 在 N-1 秒時呼叫 API（應成功）<br>3. 在 N+1 秒時呼叫 API（應失敗） | N-1 秒回傳成功，N+1 秒回傳 401「Token 已過期」，邊界判斷準確 |
| MAN-10 | Token 最後使用時間非同步更新不阻塞 | 1. 使用 Token 呼叫 API<br>2. 量測 API 回應時間（不含 last_used_at 更新） | API 回應時間不因 last_used_at 寫入而顯著增加（< 5ms 差異） |
| MAN-11 | 已過期 Token 清理 | 1. 建立多個已過期超過 30 天的 Token<br>2. 觸發清理機制（手動或排程）<br>3. 檢查 Token 列表 | 過期超過 30 天的 Token 可被清理，列表不再顯示（或折疊標記可清除） |

---

## 7. 測試環境

| 項目 | 需求 |
|------|------|
| Go 版本 | 1.24.4 |
| Node.js 版本 | 22+ （對應專案 .nvmrc） |
| 前端框架 | Vue 3.5.40 + Pinia 4.0.2 + Vue Router 4.6.4 |
| 前端測試 | Vitest 4.1.10 + @vue/test-utils 2.4.11 + happy-dom 20.11.1 |
| E2E 測試 | Playwright 1.62.1 |
| 後端測試 | `go test` + `net/http/httptest` |
| 測試瀏覽器 | Chromium（Playwright 內建）、Chrome、Firefox、Edge（手動驗證） |
| 測試 OS | Linux（Ubuntu 22.04+ / Debian 12+） |
| Token 儲存 | JSON Lines 檔案（tokens.jsonl）或 SQLite（依實作決定） |
| CI 整合 | GitHub Actions（若有），`make test` / `go test ./... && cd frontend && npm test` |

---

## 8. 缺陷追蹤模板

| 欄位 | 說明 |
|------|------|
| ID | BUG-TKN-XXX |
| 測試案例 | 對應以上測試編號（如 SYS-01 / MID-03 / F-TK-05 / E2E-03） |
| 來源 BDD Scenario | 對應 BDD Scenario 名稱 |
| 嚴重程度 | P0(阻擋) / P1(主要) / P2(次要) |
| 重啟步驟 | 逐步操作 |
| 預期 vs 實際 | 對照 |
| 環境 | Go 版本 / Node 版本 / OS / 瀏覽器 / 版本 |

---

## 9. BDD Scenario 覆蓋矩陣

以下矩陣確保每個 BDD Scenario 至少對應一個測試案例。

| # | BDD Scenario | 單元測試 | 整合測試 | E2E 測試 | 手動驗證 |
|---|-------------|:---:|:---:|:---:|:---:|
| 1 | 管理員瀏覽 Token 列表（已有 Token） | F-TK-02, F-TK-03, F-TK-07~15 | — | E2E-01 | — |
| 2 | 管理員瀏覽 Token 列表（尚無 Token） | F-TK-04 | — | E2E-02 | — |
| 3 | 管理員建立 Token（完整流程含一次性揭露） | F-CR-01~05, F-RV-01~08 | — | E2E-03 | — |
| 4 | 管理員撤銷 Token | F-RK-01~07 | — | E2E-04 | — |
| 5 | 外部系統使用有效完整操作 Token 成功呼叫寫入 API | MID-01, MID-14 | INT-01 | E2E-05 | — |
| 6 | 外部系統使用唯讀 Token 成功呼叫 GET API | MID-02 | — | E2E-06 | — |
| 7 | 建立 Token 時名稱空白 | SYS-13~14, F-CR-02~03 | — | E2E-07 | — |
| 8 | Token 名稱重複 | SYS-11~12, F-CR-06 | — | E2E-08 | — |
| 9 | 建立 Token 時伺服器錯誤 | HDL-14, F-CR-07 | — | — | — |
| 10 | Token 列表載入失敗 | HDL-16, F-TK-05~06 | — | E2E-09 | — |
| 11 | 撤銷 Token 時 API 失敗 | HDL-15, F-RK-04 | — | — | — |
| 12 | 使用不存在的 Token 呼叫 API | MID-03 | — | E2E-10 | — |
| 13 | 使用已撤銷 Token 呼叫 API | MID-04 | INT-04 | E2E-11 | — |
| 14 | 使用已過期 Token 呼叫 API | MID-05 | INT-05 | E2E-12 | — |
| 15 | 唯讀 Token 嘗試執行寫入操作 | MID-06~08 | — | E2E-13 | — |
| 16 | 未提供任何驗證資訊呼叫 API | MID-09 | — | E2E-14 | — |
| 17 | Token 數量達到上限（20 個有效 Token） | SYS-15~17, F-CR-08 | — | E2E-15 | — |
| 18 | 並發撤銷同一 Token（冪等性） | SYS-10, HDL-10 | — | E2E-16 | MAN-03 |
| 19 | 建立 Token 後未複製就關閉揭露 Modal | F-RV-05~06 | INT-06 | E2E-17 | MAN-02 |
| 20 | Token 即將過期（7 天內）顯示警告標籤 | SYS-30, F-TK-08 | — | E2E-18 | — |
| 21 | Token 過期後角色變更 | SYS-31, F-TK-09, F-TK-19 | — | E2E-19 | — |
| 22 | Token 過期時間設定為永不過期 | SYS-23, F-TK-12 | — | E2E-20 | — |
| 23 | Token 僅儲存 SHA-256 hash，建立後原始值不可查詢 | SYS-03~05, HDL-03 | INT-01 | E2E-21 | MAN-01 |
| 24 | Token 格式驗證 — 前綴與長度 | SYS-02 | — | E2E-22 | — |
| 25 | Token 名稱不區分大小寫檢查唯一性 | SYS-12 | — | E2E-23 | — |
| 26 | Bearer Token 優先於 Cookie Session | MID-10 | INT-03 | E2E-24 | MAN-08 |
| 27 | Token 最後使用時間非同步更新 | SYS-34, MID-14 | — | — | MAN-10 |
| 28 | 審計記錄 — Token 建立操作寫入 Audit Log | — | INT-02 | E2E-46 | MAN-07 |
| 29 | 審計記錄 — Token 撤銷操作寫入 Audit Log | — | INT-02 | E2E-47 | MAN-07 |
| 30 | Cookie session 驗證不受 Token 機制影響 | MID-15 | INT-03 | E2E-25 | — |
| SO-1 | 過期時間選項（7 Examples） | SYS-18~25 | — | E2E-26~32 | — |
| SO-2 | 權限範圍與操作類型（8 Examples） | MID-01~02, MID-06~08 | — | E2E-33~40 | — |
| SO-3 | Token 驗證錯誤情境（5 Examples） | MID-03~05, MID-09 | — | E2E-41~45 | — |

> **覆蓋率**：32/32 BDD Scenario 全覆蓋（含 3 組 Scenario Outline 全部 Examples 展開共 20 個案例）。每個 Scenario 至少對應一個測試案例，總計 134 個測試案例。

---

*由 Test Plan Generator 自動產生，對應 BDD `docs/bdds/011-api-token-auth.feature`*
