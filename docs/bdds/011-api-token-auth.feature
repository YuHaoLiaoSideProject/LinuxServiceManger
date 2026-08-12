@011 @api-token-auth @smoke @regression
Feature: API Token 管理與驗證
  作為一個已登入的管理員
  我希望建立與管理 API Token（Bearer token）
  以便讓 CI/CD pipeline 或自動化腳本透過 Token 安全地呼叫 API，不需在腳本中儲存帳號密碼

  Background:
    Given 我是一位已登入的管理員
    And 系統處於正常運作狀態

  # ============================================================
  # Happy Path — 正常流程
  # ============================================================

  @happy-path @p0 @smoke
  Scenario: 管理員瀏覽 Token 列表（已有 Token）
    Given 系統中已有至少一筆 API Token
    When 我點擊 Header 中的「API Tokens」導覽連結
    Then 頁面導航至 /tokens 並載入 TokenManageView
    And 系統呼叫 GET /api/v1/tokens
    And Token 列表顯示每筆 Token 的：名稱、前綴遮罩值、建立日期、過期時間、最後使用時間、權限範圍、狀態標籤
    And 列表依建立日期倒序排列

  @happy-path @p0 @smoke
  Scenario: 管理員瀏覽 Token 列表（尚無 Token）
    Given 系統中尚無任何 API Token
    When 我點擊 Header 中的「API Tokens」導覽連結
    Then 頁面顯示「尚無 API Token」空狀態
    And 頁面顯示「建立 Token」按鈕

  @happy-path @p0 @smoke
  Scenario: 管理員建立 Token（完整流程含一次性揭露）
    Given 我在 /tokens 頁面
    When 我點擊「建立 Token」按鈕
    Then 系統顯示建立表單，包含「名稱」「過期時間」「權限範圍」三個欄位
    When 我輸入名稱「Jenkins CI」
    And 我選擇過期時間為「90 天」
    And 我選擇權限範圍為「完整操作」
    And 我點擊「產生 Token」按鈕
    Then 按鈕變灰並顯示 spinner
    And 系統呼叫 POST /api/v1/tokens 並成功回傳
    And 系統顯示 Token 揭露 Modal，內含警告「⚠️ 請立即複製此 Token，關閉此視窗後將無法再次查看」
    And Modal 中 Token 值顯示在唯讀文字框中
    When 我點擊「複製到剪貼簿」按鈕
    Then Token 被複製到剪貼簿
    And 系統顯示 Toast「Token 已複製」
    When 我點擊「我已複製，關閉」按鈕
    Then Modal 關閉，返回 Token 列表
    And 新 Token 出現在列表頂部，Token 值以遮罩形式顯示（僅顯示前 4 字元 + 後 4 字元）
    And 系統顯示 Toast「Token 已建立」

  @happy-path @p0 @smoke
  Scenario: 管理員撤銷 Token
    Given 我在 /tokens 頁面
    And 列表中存在一筆狀態為「使用中」的 Token「Jenkins CI」
    When 我點擊該 Token 列的「撤銷」按鈕
    Then 系統彈出 ConfirmModal，顯示「確定要撤銷 Token『Jenkins CI』嗎？使用此 Token 的服務將立即失去存取權。此操作無法復原。」
    When 我點擊「確認撤銷」
    Then 系統呼叫 POST /api/v1/tokens/{id}/revoke
    And 該 Token 狀態變為「已撤銷」以灰色顯示
    And 撤銷按鈕消失
    And 系統顯示 Toast「Token 已撤銷」

  @happy-path @p0 @smoke
  Scenario: 外部系統使用有效 Bearer Token 成功執行完整操作 API
    Given 系統中有一筆有效的完整操作 Token，其值為「lsm_xxxx」
    And Auth middleware 已啟用
    When 外部客戶端發送 POST 請求，攜帶 Authorization: Bearer lsm_xxxx header
    Then Auth middleware 從 header 提取 Token
    And Token 存在於儲存中、未被撤銷、未過期
    And Token 權限範圍為「完整操作」，允許執行該 POST 操作
    Then 請求被允許繼續執行
    And request context 設定為 auth_method=token，包含 token_name 與 scope
    And Token 的 last_used_at 非同步更新

  @happy-path @p0
  Scenario: 外部系統使用唯讀 Token 成功呼叫 GET API
    Given 系統中有一筆有效的唯讀 Token，其值為「lsm_readonly」
    When 外部客戶端發送 GET 請求，攜帶 Authorization: Bearer lsm_readonly header
    Then Token 權限範圍為「唯讀」，該 GET 操作在允許範圍內
    And 請求被允許繼續執行
    And API 回傳正常回應

  # ============================================================
  # Error Handling — 錯誤處理
  # ============================================================

  @error-handling @p0 @validation
  Scenario: 建立 Token 時名稱空白
    Given 我在 /tokens 頁面的建立 Token 表單
    When 我將名稱欄位留白
    And 我點擊「產生 Token」按鈕
    Then 前端驗證攔截提交
    And 名稱欄位顯示「名稱為必填」錯誤提示

  @error-handling @p0 @validation
  Scenario: Token 名稱重複
    Given 系統中已存在名為「Jenkins CI」的 Token
    And 我在 /tokens 頁面的建立 Token 表單
    When 我輸入名稱「Jenkins CI」
    And 我選擇過期時間為「90 天」
    And 我選擇權限範圍為「完整操作」
    And 我點擊「產生 Token」按鈕
    Then 系統呼叫 POST /api/v1/tokens
    And API 回傳錯誤
    And 表單下方顯示「此名稱已存在，請使用其他名稱」

  @error-handling @p0
  Scenario: 建立 Token 時伺服器錯誤
    Given 我在 /tokens 頁面的建立 Token 表單
    And 後端服務暫時異常
    When 我填寫完整有效資訊並點擊「產生 Token」按鈕
    Then 系統呼叫 POST /api/v1/tokens 失敗
    And 表單下方顯示紅色錯誤「建立失敗，請稍後重試」
    And 表單內容保留，不需重新填寫

  @error-handling @p0
  Scenario: Token 列表載入失敗
    Given 後端服務暫時異常
    When 我點擊 Header 中的「API Tokens」導覽連結
    Then 系統呼叫 GET /api/v1/tokens 失敗
    And 頁面顯示錯誤訊息
    And 頁面顯示「重試」按鈕

  @error-handling @p0
  Scenario: 撤銷 Token 時 API 失敗
    Given 我在 /tokens 頁面
    And 列表中存在一筆「使用中」的 Token
    And 後端服務暫時異常
    When 我點擊該 Token 的「撤銷」按鈕
    And 在 ConfirmModal 中點擊「確認撤銷」
    Then 系統呼叫 POST /api/v1/tokens/{id}/revoke 失敗
    And ConfirmModal 內顯示「撤銷失敗，請重試」

  @error-handling @p0 @security
  Scenario: 使用不存在的 Token 呼叫 API
    Given 系統中不存在 Token 值為「lsm_fake123」的記錄
    When 外部客戶端發送請求，攜帶 Authorization: Bearer lsm_fake123 header
    Then Auth middleware 查詢後確認 Token 不存在
    And API 回傳 401 Unauthorized
    And 回應內容包含 {"error": "Token 無效"}

  @error-handling @p0 @security
  Scenario: 使用已撤銷 Token 呼叫 API
    Given 系統中有一筆狀態為「已撤銷」的 Token，其值為「lsm_revoked」
    When 外部客戶端發送請求，攜帶 Authorization: Bearer lsm_revoked header
    Then Auth middleware 查詢後確認 Token 已被撤銷
    And API 回傳 401 Unauthorized
    And 回應內容包含 {"error": "Token 已被撤銷"}

  @error-handling @p0 @security
  Scenario: 使用已過期 Token 呼叫 API
    Given 系統中有一筆過期時間為過去日期的 Token，其值為「lsm_expired」
    When 外部客戶端發送請求，攜帶 Authorization: Bearer lsm_expired header
    Then Auth middleware 查詢後確認 Token 已過期
    And API 回傳 401 Unauthorized
    And 回應內容包含 {"error": "Token 已過期"}

  @error-handling @p0 @security
  Scenario: 唯讀 Token 嘗試執行寫入操作
    Given 系統中有一筆有效的唯讀 Token，其值為「lsm_readonly」
    When 外部客戶端發送 POST 請求（寫入操作），攜帶 Authorization: Bearer lsm_readonly header
    Then Token 權限範圍為「唯讀」，不允許該 POST 操作
    And API 回傳 403 Forbidden
    And 回應內容包含 {"error": "權限不足，此 Token 僅供唯讀"}

  @error-handling @p0 @security
  Scenario: 未提供任何驗證資訊呼叫 API
    Given 客戶端未攜帶 Authorization header
    And 客戶端無有效的 Cookie session
    When 外部客戶端發送請求至需驗證的 API
    Then Auth middleware 檢測到無 Bearer token 也無 session
    And API 回傳 401 Unauthorized
    And 回應內容包含 {"error": "未提供驗證資訊"}

  # ============================================================
  # Edge Cases — 邊界情況
  # ============================================================

  @edge-case @p1 @boundary
  Scenario: Token 數量達到上限（20 個有效 Token）
    Given 我已建立 20 個有效（未撤銷、未過期）的 API Token
    And 我在 /tokens 頁面
    When 我點擊「建立 Token」按鈕並填寫完整有效資訊
    And 我點擊「產生 Token」按鈕
    Then 系統呼叫 POST /api/v1/tokens
    And API 回傳錯誤，提示已達 Token 數量上限
    And 無法再建立新的 Token

  @edge-case @p1 @boundary
  Scenario: 並發撤銷同一 Token（冪等性）
    Given 系統中有一筆狀態為「使用中」的 Token，ID 為「tok_001」
    And Token「tok_001」剛被撤銷，狀態已變為「已撤銷」
    When 再次對 Token「tok_001」發送 POST /api/v1/tokens/tok_001/revoke 請求
    Then API 回傳 200 OK
    And 回應表示 Token 已處於撤銷狀態（already revoked）

  @edge-case @p1 @boundary
  Scenario: 建立 Token 後未複製就關閉揭露 Modal
    Given 我剛完成 Token 建立，Token 揭露 Modal 正在顯示
    And Token 原始值顯示於 Modal 的文字框中
    When 我直接點擊關閉按鈕（未點擊「複製到剪貼簿」）
    And Modal 關閉
    Then Token 值永久遺失，無法再次查看
    And Token 列表中的該 Token 值僅以遮罩形式顯示
    And 若需取得 Token 值，必須撤銷該 Token 並重新建立

  @edge-case @p1 @boundary
  Scenario: Token 即將過期（7 天內）顯示警告標籤
    Given 系統中有一筆 Token，過期時間在 7 天內
    When 管理員載入 /tokens 頁面
    Then 該 Token 的狀態標籤顯示為 🟡「即將過期」

  @edge-case @p1 @boundary
  Scenario: Token 過期後角色變更
    Given 系統中有一筆過期時間為過去的 Token
    When 管理員載入 /tokens 頁面
    Then 該 Token 的狀態標籤顯示為 🔴「已過期」
    And 已過期的 Token 自動折疊或置於列表底部

  @edge-case @p0 @boundary
  Scenario: Token 過期時間設定為永不過期
    Given 我在 /tokens 頁面的建立 Token 表單
    When 我選擇過期時間為「永不過期」
    And 我填寫其他必要資訊並提交
    Then 系統成功建立 Token
    And 該 Token 的過期時間欄位顯示為「永不過期」

  # ============================================================
  # Business Rules — 商業規則驗證
  # ============================================================

  @business-rules @p0 @security @compliance
  Scenario: Token 僅儲存 SHA-256 hash，建立後原始值不可查詢
    Given 系統中已存在一筆 Token，其原始值已在建立時揭露
    When 管理員透過 GET /api/v1/tokens 查看 Token 列表
    Then 回應中不包含 Token 原始值
    And Token 值僅顯示前綴（前 4 字元）+ 遮罩 + 後 4 字元
    And 系統儲存層中僅保留 Token 的 SHA-256 hash

  @business-rules @p1 @compliance
  Scenario: Token 格式驗證 — 前綴與長度
    Given 管理員建立了一筆新 Token
    When Token 產生完成
    Then Token 值以「lsm_」為前綴
    And Token 總長度約 48 字元（Base64URL 編碼）

  @business-rules @p1 @compliance
  Scenario: Token 名稱不區分大小寫檢查唯一性
    Given 系統中已存在名為「Jenkins CI」的 Token
    When 我嘗試建立名為「jenkins ci」的 Token
    Then 系統不區分大小寫檢查，判定名稱重複
    And API 回傳名稱重複錯誤

  @business-rules @p1 @compliance
  Scenario: Bearer Token 優先於 Cookie Session
    Given 客戶端同時攜帶有效的 Bearer Token 與有效的 Cookie session
    When 客戶端發送 API 請求
    Then Auth middleware 優先使用 Bearer Token 進行驗證
    And request context 的 auth_method 設為 token（而非 session）

  @business-rules @p1 @compliance
  Scenario: Token 最後使用時間非同步更新
    Given 系統中有一筆有效的 Token
    When 客戶端使用該 Token 成功呼叫 API
    Then Token 的 last_used_at 非同步更新
    And 更新不影響該次 API 回應時間

  @business-rules @p0 @audit @compliance
  Scenario: 審計記錄 — Token 建立操作寫入 Audit Log
    Given 我是一位已登入的管理員
    When 我成功建立一筆新 Token
    Then Audit Log 中記錄一筆 action 為「token_create」的操作
    And 記錄內容包含操作者與 Token 名稱

  @business-rules @p0 @audit @compliance
  Scenario: 審計記錄 — Token 撤銷操作寫入 Audit Log
    Given 我是一位已登入的管理員
    When 我成功撤銷一筆 Token
    Then Audit Log 中記錄一筆 action 為「token_revoke」的操作
    And 記錄內容包含操作者與 Token 名稱

  @business-rules @p0 @compliance
  Scenario: Cookie session 驗證不受 Token 機制影響
    Given 管理員已透過 Cookie session 登入
    When 管理員執行 Login / Logout 操作
    Then 這些操作僅使用 session 驗證，不受 Token 機制影響
    And Cookie session 驗證仍然正常運作

  # ============================================================
  # Scenario Outline — 過期時間選項
  # ============================================================

  @happy-path @p0
  Scenario Outline: 管理員設定不同過期時間建立 Token
    Given 我在 /tokens 頁面的建立 Token 表單
    When 我輸入名稱「<token_name>」
    And 我選擇過期時間為「<expiry_option>」
    And 我選擇權限範圍為「完整操作」
    And 我點擊「產生 Token」按鈕
    Then Token 建立成功
    And 過期時間設定為 <expected_value>

    Examples:
      | token_name        | expiry_option | expected_value     |
      | CI 30天 Token     | 30 天         | 建立日 + 30 天     |
      | CI 60天 Token     | 60 天         | 建立日 + 60 天     |
      | CI 90天 Token     | 90 天         | 建立日 + 90 天     |
      | CI 180天 Token    | 180 天        | 建立日 + 180 天    |
      | CI 365天 Token    | 365 天        | 建立日 + 365 天    |
      | CI 永久 Token     | 永不過期      | 永不過期           |
      | CI 自訂 Token     | 自訂日期      | 使用者指定的日期   |

  # ============================================================
  # Scenario Outline — 權限範圍與操作類型
  # ============================================================

  @business-rules @p0 @security
  Scenario Outline: 不同權限範圍 Token 的操作限制
    Given 系統中有一筆有效的 Token，權限範圍為「<scope>」
    When 外部客戶端發送 <http_method> 請求，攜帶該 Token
    Then API 回應 HTTP <http_status>
    And 回應訊息為「<response_message>」

    Examples:
      | scope      | http_method | http_status | response_message                |
      | 唯讀       | GET         | 200         | (正常回應)                      |
      | 唯讀       | POST        | 403         | 權限不足，此 Token 僅供唯讀     |
      | 唯讀       | PUT         | 403         | 權限不足，此 Token 僅供唯讀     |
      | 唯讀       | DELETE      | 403         | 權限不足，此 Token 僅供唯讀     |
      | 完整操作   | GET         | 200         | (正常回應)                      |
      | 完整操作   | POST        | 200         | (正常回應)                      |
      | 完整操作   | PUT         | 200         | (正常回應)                      |
      | 完整操作   | DELETE      | 200         | (正常回應)                      |

  # ============================================================
  # Scenario Outline — Token 驗證錯誤情境
  # ============================================================

  @error-handling @p0 @security
  Scenario Outline: Token 驗證失敗回傳對應錯誤
    Given Auth middleware 已啟用
    When 外部客戶端發送請求，<token_condition>
    Then API 回傳 <http_status>
    And 回應內容包含 {"error": "<error_message>"}

    Examples:
      | token_condition                                              | http_status | error_message                     |
      | 未攜帶任何 Authorization header，且無 Cookie session        | 401         | 未提供驗證資訊                     |
      | 攜帶不存在的 Bearer Token                                   | 401         | Token 無效                        |
      | 攜帶已撤銷的 Bearer Token                                   | 401         | Token 已被撤銷                     |
      | 攜帶已過期的 Bearer Token                                   | 401         | Token 已過期                       |
      | 攜帶有效的唯讀 Token，但執行 POST（寫入）操作               | 403         | 權限不足，此 Token 僅供唯讀        |
