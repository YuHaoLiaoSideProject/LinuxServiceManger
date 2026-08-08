@journalctl @log-viewer @drawer @dashboard
Feature: journalctl 日誌檢視器
  作為一個已登入的管理員
  我希望在 Web UI 中直接查看任意服務的 systemd 日誌
  以便不需 SSH 進機器就能快速排查服務異常

  Background:
    Given 我已登入系統
    And 我在 Dashboard 服務列表頁面
    And 服務列表中存在至少一個服務

  # ============================================================
  # Happy Path — 正常流程
  # ============================================================

  @smoke @happy-path @p0
  Scenario: 開啟日誌 Drawer 並成功載入日誌
    Given 目標服務有可用的 journalctl 日誌
    When 我點擊該服務的「📋 Logs」按鈕
    Then 右側滑入 Log Drawer，標題顯示「📋 {服務名稱} Logs」
    And Drawer 內容區先顯示 loading spinner
    And API 成功回傳日誌內容後，loading spinner 消失
    And 日誌內容以等寬字體顯示，自動捲動到最底部
    And Drawer 底部顯示行數選擇器（預設 100）與自動刷新開關（預設 OFF）

  @smoke @happy-path @p0
  Scenario: 調整日誌顯示行數
    Given Log Drawer 已開啟且顯示日誌內容
    And 行數下拉選單目前為「100」
    When 我在行數下拉選單選擇「200」
    Then 內容區回到 loading 狀態
    And 重新呼叫 API 取得 200 行日誌
    And 日誌內容更新為 200 行，自動捲動到底部
    And 行數下拉選單反映新選擇「200」

  @happy-path @p1
  Scenario: 開啟自動刷新以即時監看日誌
    Given Log Drawer 已開啟且顯示日誌內容
    And 自動刷新開關目前為 OFF
    When 我切換自動刷新開關為 ON
    Then 開關視覺變為 ON（綠色高亮）
    And 前端每 3 秒自動呼叫 API 取得最新日誌
    And 新行自動追加到日誌區塊底部
    And 若有新內容則自動捲動到底部

  @happy-path @p1
  Scenario: 關閉自動刷新停止追加
    Given Log Drawer 已開啟且自動刷新開關為 ON
    When 我切換自動刷新開關為 OFF
    Then 定時器停止，不再呼叫 API
    And 日誌內容維持當前狀態不變

  @happy-path @p1
  Scenario: 搜尋已載入的日誌內容
    Given Log Drawer 已開啟且顯示日誌內容
    And 搜尋框為空
    When 我在搜尋框輸入關鍵字「error」
    Then 包含「error」的日誌行以黃色背景 highlight
    And 不含關鍵字的行降低透明度
    And 搜尋框右側顯示匹配行數統計，如「3 / 100 行」
    And 此搜尋僅在已載入的日誌中篩選，不觸發後端請求

  @happy-path @p0
  Scenario Outline: 關閉日誌 Drawer
    Given Log Drawer 已開啟且顯示日誌內容
    When 我執行<關閉動作>
    Then 自動刷新定時器停止（若先前為 ON）
    And Drawer 向右滑出關閉
    And 遮罩淡出
    And Dashboard 恢復可互動狀態
    And 該服務的 Logs 按鈕恢復可點擊

    Examples:
      | 關閉動作                   |
      | 點擊 Drawer 右上角 ✕ 按鈕  |
      | 點擊 Drawer 外側半透明遮罩  |
      | 按下鍵盤 Esc 鍵            |

  @happy-path @p0
  Scenario: 點擊另一服務的 Logs 按鈕切換日誌
    Given Log Drawer 已開啟服務 A 的日誌
    When 我點擊服務 B 的「📋 Logs」按鈕
    Then 服務 A 的 Drawer 先關閉，停止自動刷新
    And 隨即開啟服務 B 的 Log Drawer
    And Drawer 標題更新為服務 B 的名稱
    And 載入服務 B 的日誌內容

  # ============================================================
  # Error Handling — 錯誤處理
  # ============================================================

  @error-handling @p1
  Scenario: 服務從未產生日誌
    Given 目標服務存在但從未輸出任何日誌
    When 我點擊該服務的「📋 Logs」按鈕
    Then Log Drawer 開啟
    And 內容區顯示空狀態插圖與文字「此服務尚無日誌記錄」

  @error-handling @p1
  Scenario: 系統不支援 journalctl
    Given 目標主機上 journalctl 指令不存在
    When 我點擊任一服務的「📋 Logs」按鈕
    Then Log Drawer 開啟
    And 內容區顯示錯誤訊息「無法讀取日誌：系統不支援 journalctl」

  @error-handling @p1
  Scenario: 讀取日誌權限不足
    Given 執行使用者不具備 journalctl 讀取權限
    When 我點擊任一服務的「📋 Logs」按鈕
    Then Log Drawer 開啟
    And 內容區顯示錯誤訊息「讀取日誌失敗：權限不足。請確認執行使用者具備 journalctl 權限」
    And 提供重試按鈕

  @error-handling @validation @p1
  Scenario: 請求行數超出上限
    Given API 日誌行數上限為 1000 行
    When 我請求超過 1000 行的日誌
    Then API 回傳 400 Bad Request
    And Drawer 顯示錯誤提示「僅顯示最近 1000 行，請縮小行數範圍」

  @error-handling @p2
  Scenario: 自動刷新期間 API 連線失敗
    Given Log Drawer 已開啟且自動刷新開關為 ON
    When 某次自動刷新 API 呼叫失敗
    Then 目前日誌內容保持不變
    And 控制列顯示小字警告「自動刷新失敗，10 秒後重試」
    And 系統於 10 秒後自動重試

  @error-handling @p2
  Scenario: 自動刷新連續失敗五次後自動關閉
    Given Log Drawer 已開啟且自動刷新開關為 ON
    When 自動刷新 API 連續失敗 5 次
    Then 自動刷新開關自動切換為 OFF
    And 控制列顯示警告提示

  @error-handling @p1
  Scenario: API 請求逾時
    Given Log Drawer 已開啟
    When 呼叫日誌 API 超過 5 秒無回應
    Then 內容區顯示錯誤訊息
    And 提供重試按鈕

  # ============================================================
  # Edge Cases — 邊界情況
  # ============================================================

  @edge-case @p2
  Scenario: 行動裝置上 Drawer 改為全螢幕顯示
    Given 我使用行動裝置（螢幕寬度小於斷點）
    When 我點擊任一服務的「📋 Logs」按鈕
    Then Drawer 以全螢幕（100vw）顯示
    And 關閉按鈕改為左上角返回箭頭
    And 搜尋框置頂

  @edge-case @p2
  Scenario: Drawer 開啟中導航至其他頁面
    Given Log Drawer 已開啟且自動刷新為 ON
    When 我透過路由導航至其他頁面
    Then Log Drawer 自動關閉
    And 自動刷新定時器停止
    And 導航正常繼續

  # ============================================================
  # Business Rules — 商業規則驗證
  # ============================================================

  @business-rules @p1
  Scenario: 鎖定服務的 Logs 按鈕仍可點擊
    Given 服務列表中有一鎖定服務
    When 我檢視該服務的 Actions 區塊
    Then 「📋 Logs」按鈕顯示為可點擊狀態

  @business-rules @p1
  Scenario: 鎖定服務仍可查看日誌內容
    Given 服務列表中有一鎖定服務
    When 我點擊該鎖定服務的「📋 Logs」按鈕
    Then Log Drawer 正常開啟
    And 成功載入該服務的日誌內容

  @business-rules @p0
  Scenario: 行數選項僅限四檔可選
    Given Log Drawer 已開啟
    When 我查看行數下拉選單的選項
    Then 僅顯示「50」「100」「200」「500」四個選項
    And 預設選擇為「100」

  @business-rules @p1
  Scenario: 搜尋僅在客戶端已載入日誌中篩選
    Given Log Drawer 已開啟且已載入 100 行日誌
    When 我在搜尋框輸入任意關鍵字
    Then 不觸發任何後端 API 請求
    And 僅在當前已載入的 100 行中進行比對與 highlight

  @business-rules @p2
  Scenario: 第一版不支援時間範圍篩選
    Given Log Drawer 已開啟
    When 我查看 Drawer 內的所有控制項
    Then 不存在時間範圍選擇器（日期或時間 picker）
    And 僅支援以行數範圍檢視日誌
