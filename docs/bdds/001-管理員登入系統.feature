@login @authentication @p0
Feature: 管理員登入系統
  作為一個團隊管理員
  我希望使用帳號密碼登入服務管理系統
  以便只有授權人員才能操作 Linux 服務，避免未授權的啟停操作

  Background:
    Given 系統已部署並正常運行
    And 已存在一組有效的管理員帳號 "admin" 與密碼

  # ============================================================
  # Happy Path
  # ============================================================

  @smoke @happy-path @p0
  Scenario: 使用正確帳號密碼登入
    Given 我到達登入頁面
    When 我輸入帳號 "admin" 與密碼
    And 我點擊「登入」按鈕
    Then 系統驗證帳號密碼通過
    And 頁面跳轉至服務列表頁
    And 系統顯示「登入成功」提示

  @smoke @happy-path @p0
  Scenario: 已登入管理員主動登出
    Given 我已登入系統
    And 我在服務列表頁
    When 我點擊「登出」按鈕
    Then 系統清除當前 session
    And 頁面跳轉至登入頁
    And 系統顯示「已登出」提示

  # ============================================================
  # Error Handling
  # ============================================================

  @error-handling @validation @p0
  Scenario: 使用錯誤密碼登入
    Given 我到達登入頁面
    When 我輸入帳號 "admin" 與錯誤的密碼
    And 我點擊「登入」按鈕
    Then 系統拒絕登入
    And 頁面停留在登入頁
    And 系統顯示「帳號或密碼錯誤」提示

  @error-handling @validation @p0
  Scenario: 使用不存在的帳號登入
    Given 我到達登入頁面
    When 我輸入不存在的帳號 "nonexistent" 與任意密碼
    And 我點擊「登入」按鈕
    Then 系統拒絕登入
    And 頁面停留在登入頁
    And 系統顯示「帳號或密碼錯誤」提示

  @error-handling @validation @p0
  Scenario: 未登入直接造訪服務列表頁
    Given 我尚未登入系統
    When 我嘗試造訪服務列表頁
    Then 系統強制跳轉至登入頁

  @error-handling @security @p1
  Scenario: 閒置逾時自動登出
    Given 我已登入系統
    And 我已閒置超過 30 分鐘
    When 我嘗試操作任何服務
    Then 系統自動清除 session
    And 頁面跳轉至登入頁
    And 系統顯示「閒置過久，已自動登出」提示

  # ============================================================
  # Edge Cases
  # ============================================================

  @edge-case @security @p1
  Scenario: 連續登入失敗達上限後帳號鎖定
    Given 我到達登入頁面
    When 我連續 5 次輸入錯誤密碼
    Then 系統鎖定該帳號
    And 系統顯示「帳號已鎖定，請 15 分鐘後再試」提示
    And 即使第 6 次輸入正確密碼，系統仍拒絕登入

  @edge-case @session @p2
  Scenario: 多人同時使用同一帳號登入
    Given 管理員 A 已使用帳號 "admin" 登入
    When 管理員 B 使用相同帳號 "admin" 登入
    Then 管理員 B 成功登入並建立獨立 session
    And 管理員 A 的 session 不受影響，仍可正常操作
