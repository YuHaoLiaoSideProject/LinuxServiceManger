# language: zh-TW

@auto-start @service-management @p0
Feature: 開機自動啟動管理
  作為一個已登入的管理員
  我希望在 Dashboard 服務列表中直接控制服務的開機自動啟動狀態
  以便不需 SSH 進機器就能完整管理服務的生命週期（start / stop / restart / enable / disable）

  Background:
    Given 我已登入系統
    And Dashboard 服務列表已載入完成
    And 服務列表包含 Name、Load、Active、Sub、Auto-start、Actions 欄位

  # ============================================================
  # Happy Path - 正常流程
  # ============================================================

  @smoke @happy-path @p0
  Scenario: 檢視服務列表中的 Auto-start 欄位
    Given 服務 "nginx" 的 UnitFileState 為 "enabled"
    And 服務 "myapp" 的 UnitFileState 為 "disabled"
    When 我檢視 Dashboard 服務列表
    Then 服務 "nginx" 的 Auto-start 欄位顯示 Toggle 為 ON
    And 服務 "myapp" 的 Auto-start 欄位顯示 Toggle 為 OFF
    And Auto-start 欄位與右側 Actions 欄位明確區分

  @smoke @happy-path @p0
  Scenario: 開啟開機自動啟動（不需確認對話框）
    Given 服務 "myapp" 的 UnitFileState 為 "disabled"
    And 服務 "myapp" 已解鎖且可操作
    And Auto-start Toggle 目前顯示為 OFF
    When 我將 "myapp" 的 Auto-start Toggle 從 OFF 切換為 ON
    Then Toggle 立即進入 loading 狀態且不可操作
    And 系統執行 systemctl enable "myapp"
    And 操作成功後 Toast 顯示綠色通知「myapp 已設為開機自動啟動」
    And Toggle 停在 ON 狀態
    And 服務 "myapp" 的 UnitFileState 更新為 "enabled"

  @happy-path @p0
  Scenario: 關閉開機自動啟動（需確認對話框）
    Given 服務 "nginx" 的 UnitFileState 為 "enabled"
    And 服務 "nginx" 已解鎖且可操作
    And Auto-start Toggle 目前顯示為 ON
    When 我將 "nginx" 的 Auto-start Toggle 從 ON 切換為 OFF
    Then 系統彈出 ConfirmModal 確認對話框
    And 對話框顯示「確定要停用 nginx 的開機自動啟動嗎？此服務下次重開機後將不會自動啟動。」
    When 我點擊確認對話框的「確認」按鈕
    Then 對話框關閉
    And Toggle 進入 loading 狀態且不可操作
    And 系統執行 systemctl disable "nginx"
    And 操作成功後 Toast 顯示綠色通知「nginx 已取消開機自動啟動」
    And Toggle 停在 OFF 狀態
    And 服務 "nginx" 的 UnitFileState 更新為 "disabled"

  @happy-path @p0
  Scenario: 取消關閉開機自動啟動的確認對話框
    Given 服務 "nginx" 的 UnitFileState 為 "enabled"
    And Auto-start Toggle 目前顯示為 ON
    When 我將 "nginx" 的 Auto-start Toggle 從 ON 切換為 OFF
    And 系統彈出 ConfirmModal 確認對話框
    When 我點擊確認對話框的「取消」按鈕
    Then 對話框關閉
    And Toggle 維持 ON 狀態
    And 系統不執行任何 enable 或 disable 操作
    And 服務列表保持不變

  @happy-path @p1
  Scenario Outline: 根據 UnitFileState 顯示正確的 Auto-start 狀態
    Given 服務 "<serviceName>" 的 UnitFileState 為 "<unitFileState>"
    And 服務 "<serviceName>" 已解鎖且可操作
    When 我檢視 Dashboard 服務列表
    Then 服務 "<serviceName>" 的 Auto-start 欄位顯示 "<displayState>"

    Examples:
      | serviceName | unitFileState    | displayState |
      | nginx       | enabled          | Toggle ON    |
      | nginx       | enabled-runtime  | Toggle ON    |
      | myapp       | disabled         | Toggle OFF   |
      | myapp       | indirect         | Toggle OFF   |

  # ============================================================
  # Error Handling - 錯誤處理
  # ============================================================

  @error-handling @p0
  Scenario: 操作失敗時權限不足
    Given 服務 "nginx" 的 UnitFileState 為 "disabled"
    And Auto-start Toggle 目前顯示為 OFF
    And 後端執行 systemctl enable 會因為權限不足而失敗
    When 我將 "nginx" 的 Auto-start Toggle 從 OFF 切換為 ON
    Then Toggle 顯示 loading 狀態
    And 系統嘗試執行 systemctl enable "nginx"
    And 操作失敗後 Toast 顯示紅色錯誤通知「nginx 自動啟動設定失敗：權限不足，請確認執行使用者具備 systemctl 權限」
    And Toggle 恢復為 OFF 狀態
    And 服務列表不變

  @error-handling @p0
  Scenario: 操作失敗時服務不存在
    Given 服務 "deleted-service" 存在於 Dashboard 列表中
    And Auto-start Toggle 目前顯示為 OFF
    And 後端執行 systemctl enable 時發現服務已不存在
    When 我將 "deleted-service" 的 Auto-start Toggle 從 OFF 切換為 ON
    Then Toggle 顯示 loading 狀態
    And 操作失敗後 Toast 顯示紅色錯誤通知「deleted-service 自動啟動設定失敗：服務不存在」
    And Toggle 恢復為 OFF 狀態

  @error-handling @p1
  Scenario: 網路連線異常導致操作失敗
    Given 服務 "nginx" 的 UnitFileState 為 "disabled"
    And Auto-start Toggle 目前顯示為 OFF
    And 前端與後端之間的網路連線中斷
    When 我將 "nginx" 的 Auto-start Toggle 從 OFF 切換為 ON
    Then Toggle 顯示 loading 狀態
    And axios 請求失敗
    And Toast 顯示紅色錯誤通知「網路連線異常，請稍後重試」
    And Toggle 恢復為 OFF 狀態

  @error-handling @p1
  Scenario: systemctl 指令執行逾時
    Given 服務 "large-service" 的 UnitFileState 為 "disabled"
    And Auto-start Toggle 目前顯示為 OFF
    And systemctl enable 執行時間超過 15 秒
    When 我將 "large-service" 的 Auto-start Toggle 從 OFF 切換為 ON
    Then Toggle 顯示 loading 狀態
    And 操作失敗後 Toast 顯示紅色錯誤通知「large-service 自動啟動設定失敗：操作逾時，請稍後重試」
    And Toggle 恢復為 OFF 狀態

  # ============================================================
  # Edge Cases - 邊界情況
  # ============================================================

  @edge-case @boundary @p1
  Scenario: 鎖定的服務不可操作 Auto-start
    Given 服務 "systemd-logind" 為系統服務且已鎖定
    When 我檢視 Dashboard 服務列表
    Then 服務 "systemd-logind" 的 Auto-start 欄位顯示 🔒
    And Auto-start 欄位不可操作
    And 無法切換 Toggle

  @edge-case @boundary @p1
  Scenario Outline: 不適用 enable/disable 的 UnitFileState 顯示「不適用」
    Given 服務 "<serviceName>" 的 UnitFileState 為 "<unitFileState>"
    And 服務 "<serviceName>" 已解鎖
    When 我檢視 Dashboard 服務列表
    Then 服務 "<serviceName>" 的 Auto-start 欄位顯示「不適用」
    And Auto-start 欄位不可操作
    And 無法切換 Toggle

    Examples:
      | serviceName    | unitFileState |
      | static-service | static        |
      | masked-service | masked        |
      | alias-service  | alias         |

  @edge-case @p1
  Scenario: 操作期間 Toggle 進入 loading 狀態防止重複切換
    Given 服務 "nginx" 的 UnitFileState 為 "disabled"
    And Auto-start Toggle 目前顯示為 OFF 且可操作
    When 我將 "nginx" 的 Auto-start Toggle 從 OFF 切換為 ON
    And Toggle 已進入 loading 狀態
    When 我再次點擊同一個 Toggle
    Then 系統不觸發任何新的 enable 或 disable 請求
    And Toggle 維持 loading 狀態不變

  @edge-case @p1
  Scenario: 多人同時操作時以 systemd 實際狀態為準
    Given 服務 "shared-service" 的 UnitFileState 為 "disabled"
    And Auto-start Toggle 目前顯示為 OFF
    And 另一位管理員已在另一 session 中對 "shared-service" 執行 systemctl enable
    When 我重新整理 Dashboard 服務列表
    Then 服務 "shared-service" 的 Auto-start Toggle 顯示為 ON
    And 狀態以 systemd 回報的實際 UnitFileState 為準

  @edge-case @boundary @p2
  Scenario: 深色模式下 Toggle 樣式正常
    Given 我已登入系統
    And 系統目前處於深色模式
    When 我檢視 Dashboard 服務列表
    Then 每個服務的 Auto-start Toggle 樣式在深色背景下清晰可見
    And Toggle ON 與 OFF 狀態有明確視覺區別

  @edge-case @boundary @p2
  Scenario: 手機 RWD 卡片佈局下 Auto-start 欄位正常顯示
    Given 我使用手機裝置開啟 Dashboard
    When 我檢視服務列表的卡片佈局
    Then 每個服務卡片包含 Auto-start 欄位
    And Toggle 在卡片佈局中可正常操作
    And Auto-start 欄位與 Actions 欄位在卡片內明確區分

  # ============================================================
  # Business Rules - 商業規則驗證
  # ============================================================

  @business-rules @p0
  Scenario: 僅 FragmentPath 在 /etc/systemd/system/ 下的服務可操作 Auto-start
    Given 服務 "user-app" 的 FragmentPath 為 "/etc/systemd/system/user-app.service"
    And 服務 "system-svc" 的 FragmentPath 為 "/lib/systemd/system/system-svc.service"
    When 我檢視 Dashboard 服務列表
    Then 服務 "user-app" 的 Auto-start 欄位顯示可操作的 Toggle
    And 服務 "system-svc" 的 Auto-start 欄位顯示 🔒 且不可操作

  @business-rules @p0
  Scenario: 開啟自動啟動不需確認對話框（低風險操作）
    Given 服務 "myapp" 的 UnitFileState 為 "disabled"
    And Auto-start Toggle 目前顯示為 OFF
    When 我將 "myapp" 的 Auto-start Toggle 從 OFF 切換為 ON
    Then 系統不彈出任何確認對話框
    And 系統直接執行 systemctl enable "myapp"

  @business-rules @p0
  Scenario: 關閉自動啟動需確認對話框（高風險操作）
    Given 服務 "nginx" 的 UnitFileState 為 "enabled"
    And Auto-start Toggle 目前顯示為 ON
    When 我將 "nginx" 的 Auto-start Toggle 從 ON 切換為 OFF
    Then 系統彈出 ConfirmModal 確認對話框
    And 對話框包含服務名稱 "nginx"
    And 對話框包含風險提示「此服務下次重開機後將不會自動啟動」
    And 在管理員確認之前系統不執行 systemctl disable

  @business-rules @p1
  Scenario: enable/disable 操作逾時上限為 15 秒
    Given 服務 "slow-service" 的 Auto-start Toggle 目前顯示為 OFF
    When 我將 "slow-service" 的 Auto-start Toggle 從 OFF 切換為 ON
    Then 系統在 15 秒內等待 systemctl 回應
    And 若超過 15 秒未回應則回傳逾時錯誤
    And Toast 顯示「slow-service 自動啟動設定失敗：操作逾時，請稍後重試」
