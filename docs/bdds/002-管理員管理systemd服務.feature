@service-management @systemd @p0
Feature: 管理員管理 systemd 服務
  作為一個已登入的團隊管理員
  我希望查看 Linux 主機上的 systemd 服務狀態，並對特定服務執行 Start、Stop、Restart
  以便在不登入 SSH 的情況下，快速處理服務異常或進行例行維護

  Background:
    Given 我已使用有效帳號登入系統
    And 我在服務列表頁
    And 系統已成功連接本地 systemd

  # ============================================================
  # Happy Path — 查詢服務列表
  # ============================================================

  @smoke @happy-path @p0
  Scenario: 載入服務列表
    When 我到達服務列表頁
    Then 系統顯示所有 systemd 服務
    And 每個服務顯示名稱、Load 狀態、Active 狀態、Sub 狀態

  @happy-path @p0
  Scenario: 以關鍵字搜尋過濾服務
    Given 服務列表已載入
    When 我在搜尋欄輸入關鍵字 "nginx"
    Then 列表僅顯示名稱包含 "nginx" 的服務

  @happy-path @p0
  Scenario: 重新整理服務列表
    Given 服務列表已載入
    When 我點擊「重新整理」按鈕
    Then 系統重新讀取 systemd 服務狀態
    And 列表更新為最新狀態

  @happy-path @p0
  Scenario: 已移除的服務從列表中消失
    Given 服務列表已載入
    And 某服務 "test-service" 已從系統中移除
    When 我點擊「重新整理」按鈕
    Then "test-service" 不再出現在服務列表中
    And 系統不顯示任何錯誤訊息

  # ============================================================
  # Happy Path — Start 服務
  # ============================================================

  @smoke @happy-path @p0
  Scenario: 成功啟動已停止的服務
    Given 服務 "nginx" 狀態為 inactive (dead)
    When 我點擊 "nginx" 的「Start」按鈕
    Then 系統執行 systemctl start nginx
    And "nginx" 狀態更新為 active (running)
    And 系統顯示「nginx 已成功啟動」提示

  # ============================================================
  # Happy Path — Stop 服務
  # ============================================================

  @smoke @happy-path @p0
  Scenario: 成功停止執行中的服務
    Given 服務 "nginx" 狀態為 active (running)
    When 我點擊 "nginx" 的「Stop」按鈕
    And 我在確認對話框中點擊「確認停止」
    Then 系統執行 systemctl stop nginx
    And "nginx" 狀態更新為 inactive (dead)
    And 系統顯示「nginx 已成功停止」提示

  # ============================================================
  # Happy Path — Restart 服務
  # ============================================================

  @smoke @happy-path @p0
  Scenario: 成功重啟執行中的服務
    Given 服務 "nginx" 狀態為 active (running)
    When 我點擊 "nginx" 的「Restart」按鈕
    And 我在確認對話框中點擊「確認重啟」
    Then 系統執行 systemctl restart nginx
    And 過程中 "nginx" 短暫顯示 intermediate 狀態
    And 最終 "nginx" 狀態回到 active (running)
    And 系統顯示「nginx 已成功重啟」提示

  @happy-path @p1
  Scenario: 對已停止的服務執行 Restart 等同 Start
    Given 服務 "nginx" 狀態為 inactive (dead)
    When 我點擊 "nginx" 的「Restart」按鈕
    And 我在確認對話框中點擊「確認重啟」
    Then 系統執行 systemctl restart nginx
    And "nginx" 狀態更新為 active (running)
    And 系統顯示「nginx 已成功啟動」提示

  # ============================================================
  # Error Handling
  # ============================================================

  @error-handling @p1
  Scenario: Start 已在執行的服務時顯示提示
    Given 服務 "nginx" 狀態為 active (running)
    Then "nginx" 的「Start」按鈕為禁用狀態

  @error-handling @p1
  Scenario: Stop 已停止的服務時顯示提示
    Given 服務 "nginx" 狀態為 inactive (dead)
    Then "nginx" 的「Stop」按鈕為禁用狀態

  @error-handling @p1
  Scenario: 操作失敗時顯示具體錯誤原因
    Given 服務 "protected-service" 存在但當前使用者無 systemd 操作權限
    When 我點擊 "protected-service" 的「Start」按鈕
    Then 系統顯示「權限不足：無法操作此服務」錯誤提示
    And "protected-service" 狀態保持不變

  # ============================================================
  # Edge Cases
  # ============================================================

  @edge-case @p1
  Scenario: 服務名稱包含特殊字元仍正常顯示與操作
    Given 系統中存在服務 "bus-name@.service"
    When 服務列表載入完成
    Then "bus-name@.service" 正確顯示在列表中
    And 其 Start/Stop/Restart 按鈕可正常操作

  @edge-case @concurrency @p2
  Scenario: 多人同時對同一服務執行衝突操作
    Given 服務 "nginx" 狀態為 active (running)
    And 管理員 A 點擊了 "nginx" 的「Stop」按鈕
    When 管理員 B 點擊 "nginx" 的「Start」按鈕
    Then 以後執行者（管理員 B）的操作為準
    And 管理員 A 若操作失敗，系統顯示「服務狀態已變更，請重新整理」提示

  # ============================================================
  # Business Rules
  # ============================================================

  @business-rules @p0
  Scenario: Stop 操作需要二次確認防止誤觸
    Given 服務 "nginx" 狀態為 active (running)
    When 我點擊 "nginx" 的「Stop」按鈕
    Then 系統彈出確認對話框，顯示「確定要停止 nginx 嗎？」
    And 需點擊「確認停止」才會實際執行

  @business-rules @p0
  Scenario: Restart 操作需要二次確認防止誤觸
    Given 服務 "nginx" 狀態為 active (running)
    When 我點擊 "nginx" 的「Restart」按鈕
    Then 系統彈出確認對話框，顯示「確定要重啟 nginx 嗎？」
    And 需點擊「確認重啟」才會實際執行

  @business-rules @p0
  Scenario: Start 操作不需要二次確認
    Given 服務 "nginx" 狀態為 inactive (dead)
    When 我點擊 "nginx" 的「Start」按鈕
    Then 系統直接執行啟動，不彈出確認對話框

  @business-rules @p1
  Scenario: 停止服務不自動影響其依賴服務
    Given 服務 "nginx" 依賴於 "network.service"
    And "network.service" 狀態為 active (running)
    When 我停止 "nginx"
    Then "nginx" 成功停止
    And "network.service" 狀態不受影響，仍為 active (running)
