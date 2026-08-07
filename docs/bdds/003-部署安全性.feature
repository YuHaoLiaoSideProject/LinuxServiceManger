@deployment @security @p0
Feature: 部署安全性
  作為一個部署維運人員
  我希望系統啟動時強制檢查必要的安全性環境變數已設定
  以便不會因為忘記設定而使用預設密碼或預設 session 金鑰，導致系統暴露在攻擊風險中

  # ============================================================
  # Happy Path
  # ============================================================

  @smoke @happy-path @p0
  Scenario: 正確設定所有安全性環境變數後系統正常啟動
    Given 已設定環境變數 SESSION_KEY 為一個 32 bytes 以上的隨機字串
    And 已設定環境變數 ADMIN_PASS 為高強度密碼
    When 我執行伺服器啟動指令
    Then 系統正常啟動
    And 系統開始監聽指定 port（預設 8080）
    And 啟動訊息包含 "🚀 Linux Service Manager starting on http://localhost"

  # ============================================================
  # Error Handling
  # ============================================================

  @error-handling @security @p0
  Scenario: 未設定 SESSION_KEY 時系統拒絕啟動
    Given 未設定環境變數 SESSION_KEY
    And 已設定環境變數 ADMIN_PASS
    When 我執行伺服器啟動指令
    Then 系統立即終止
    And 輸出錯誤訊息 "SESSION_KEY and ADMIN_PASS environment variables are required. Set them before starting."

  @error-handling @security @p0
  Scenario: 未設定 ADMIN_PASS 時系統拒絕啟動
    Given 已設定環境變數 SESSION_KEY
    And 未設定環境變數 ADMIN_PASS
    When 我執行伺服器啟動指令
    Then 系統立即終止
    And 輸出錯誤訊息 "SESSION_KEY and ADMIN_PASS environment variables are required. Set them before starting."

  @error-handling @security @p0
  Scenario: 兩個安全性環境變數都未設定時系統拒絕啟動
    Given 未設定環境變數 SESSION_KEY
    And 未設定環境變數 ADMIN_PASS
    When 我執行伺服器啟動指令
    Then 系統立即終止
    And 輸出錯誤訊息 "SESSION_KEY and ADMIN_PASS environment variables are required. Set them before starting."

  # ============================================================
  # Error Handling — 資訊不洩漏
  # ============================================================

  @error-handling @security @p0
  Scenario: API 內部錯誤不洩漏系統細節
    Given 系統已正常啟動
    And 系統後端與 D-Bus 連線發生故障
    When 前端呼叫 GET /api/v1/services
    Then 回應 HTTP 500
    And 回應 body 僅包含 generic 錯誤訊息 "failed to list services"
    And 不包含內部 stack trace、檔案路徑或 D-Bus 連線細節

  @error-handling @security @p0
  Scenario: 服務操作失敗不洩漏系統細節
    Given 系統已正常啟動
    And 某服務操作因權限不足而失敗
    When 前端呼叫 POST /api/v1/services/protected-service/start
    Then 回應 HTTP 500
    And 回應 body 僅包含 generic 錯誤訊息 "failed to start protected-service"
    And 不包含 "permission denied" 等系統層級錯誤細節

  # ============================================================
  # Edge Cases
  # ============================================================

  @edge-case @security @p1
  Scenario: SESSION_KEY 長度不足時仍允許啟動但記錄警告
    # 註：目前尚未實作 SESSION_KEY 長度檢查與警告，系統僅檢查變數是否為空
    Given 已設定環境變數 SESSION_KEY 為一個短字串（少於 16 bytes）
    And 已設定環境變數 ADMIN_PASS
    When 我執行伺服器啟動指令
    Then 系統正常啟動（不強制拒絕，以免向後不相容）
    And 伺服器 log 輸出警告建議使用更長的密鑰

  @edge-case @security @p1
  Scenario: 環境變數僅設定為空白字串時視為未設定
    Given 已設定環境變數 SESSION_KEY 為空字串 ""
    And 已設定環境變數 ADMIN_PASS
    When 我執行伺服器啟動指令
    Then 系統立即終止
    And 輸出錯誤訊息 "SESSION_KEY and ADMIN_PASS environment variables are required. Set them before starting."
