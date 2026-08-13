@webhook-notification @notify @notification @p0 @smoke @regression
Feature: Webhook 通知設定
  作為一個管理員
  我希望在系統中設定 Webhook 通知 Channel（Slack / Discord / Telegram / 自訂 Webhook），並在 systemd 服務狀態變更（started / stopped / failed / restarted）時自動推送通知，且能查看發送紀錄
  以便不需盯螢幕也能即時掌握服務狀態變化，在服務異常時第一時間於常用通訊平台收到通知，降低服務中斷的察覺延遲

  Background:
    Given 管理員已登入系統
    And 系統處於正常運作狀態
    And WebSocket 即時推送模組已啟用
    And D-Bus 監聽運作中

  # ══════════════════════════════════════════════════════════════
  # 主流程 — 進入通知設定頁面（IF 步驟 1）
  # ══════════════════════════════════════════════════════════════

  @entry @happy-path @p0 @smoke
  Scenario: 點擊 Header 的 Notifications 連結進入通知設定頁面
    Given 管理員位於系統任一頁面（如 Dashboard）
    When 管理員點擊 Header 中的「🔔 Notifications」導覽連結
    Then 路由導航至 /notifications 頁面
    And 頁面顯示 loading spinner
    And 系統發送 GET /api/v1/notify/channels 取得所有 channel 設定
    And 載入完成後預設顯示「Channel 設定」分頁

  @entry @happy-path @p0 @smoke
  Scenario: 已有 Channel 時顯示 Channel 列表
    Given 系統中已存在 channel 設定
    When GET /api/v1/notify/channels 載入完成
    Then 頁面顯示 channel 列表
    And 每個 channel 卡片顯示類型圖示、名稱、觸發事件摘要、服務範圍與啟用/停用 toggle 開關

  @entry @happy-path @p1
  Scenario: 無 Channel 時顯示空狀態與新增按鈕
    Given 系統中沒有任何 channel 設定
    When GET /api/v1/notify/channels 載入完成
    Then 頁面顯示空狀態「尚未設定任何通知 Channel」
    And 空狀態中顯示「新增 Channel」按鈕

  @entry @happy-path @p1
  Scenario: 通知頁面提供「Channel 設定」與「發送紀錄」兩個分頁
    Given 管理員位於通知設定頁面
    When 管理員檢視頁面分頁結構
    Then 頁面提供「Channel 設定」分頁（預設顯示）
    And 頁面提供「發送紀錄」分頁

  # ══════════════════════════════════════════════════════════════
  # 主流程 — 新增 Channel（IF 步驟 2-5）
  # ══════════════════════════════════════════════════════════════

  @channel @happy-path @p0 @smoke
  Scenario Outline: 新增「<channel_type>」類型 Channel 並成功建立
    Given 管理員位於通知設定頁面的「Channel 設定」分頁
    When 管理員點擊「新增 Channel」並在類型下拉選單中選擇「<channel_type>」
    Then 表單顯示該類型專屬欄位：<type_fields>
    And 管理員填寫專屬欄位與通用欄位後點擊「儲存」
    Then 系統發送 POST /api/v1/notify/channels 建立 channel
    And 頁面顯示 Toast「Channel「<channel_name>」已建立」
    And 表單關閉且 channel 列表重整顯示新 channel
    And 新 channel 的 toggle 預設為開啟

    Examples:
      | channel_type | channel_name | type_fields                                                   |
      | Slack        | 團隊 Slack   | Webhook URL 輸入框（格式 https://hooks.slack.com/services/...）|
      | Discord      | 團隊 Discord | Webhook URL 輸入框（格式 https://discord.com/api/webhooks/...）|
      | Telegram     | 個人群組     | Bot Token + Chat ID 輸入框（需先至 @BotFather 建立 bot 取得 token，並向 @userinfobot 取得 chat_id） |
      | 自訂 Webhook | 自訂監控     | Webhook URL、HTTP Method 下拉與自訂 Headers 編輯             |

  @channel @error-handling @p0 @validation
  Scenario: 必填欄位空白時儲存被攔截並標示錯誤
    Given 管理員在新增 channel 表單中未填寫必要欄位
    When 管理員點擊「儲存」
    Then 前端攔截請求，不發送 API 呼叫
    And 必填欄位以紅色標示
    And 頁面顯示提示「請填寫必要欄位」

  @channel @business-rules @p1 @validation
  Scenario: 至少需勾選一個觸發事件才能儲存
    Given 管理員已填寫 channel 名稱與專屬欄位
    And 觸發事件（started / stopped / failed / restarted）皆未勾選
    When 管理員點擊「儲存」
    Then 前端攔截請求並提示需至少勾選一個觸發事件
    And channel 未建立

  @channel @happy-path @p1
  Scenario: 指定服務範圍時可透過搜尋多選服務
    Given 管理員在新增 channel 表單中選擇「指定服務」範圍
    When 管理員在搜尋框輸入關鍵字過濾服務列表並勾選多個服務
    Then 表單顯示已選取的服務清單
    And 儲存後僅這些服務的狀態變更會觸發該 channel 的通知

  @channel @error-handling @p0 @channel-save
  Scenario: Channel 儲存失敗時顯示錯誤並保留表單內容
    Given 管理員已填寫新增 channel 表單
    And POST /api/v1/notify/channels 回傳錯誤（如伺服器錯誤）
    When 系統收到失敗回應
    Then 頁面顯示 Toast 錯誤訊息
    And 表單內容保留供管理員修正
    And 管理員可修正後重新送出

  # ══════════════════════════════════════════════════════════════
  # 主流程 — 編輯 Channel（IF 步驟 6）
  # ══════════════════════════════════════════════════════════════

  @channel @happy-path @p0
  Scenario: 點擊編輯展開預填表單並成功更新
    Given channel「團隊 Slack」已存在於列表中
    When 管理員點擊該 channel 的「編輯」按鈕
    Then 展開編輯表單且欄位預填目前設定值
    When 管理員修改設定後點擊「儲存」
    Then 系統發送 PUT /api/v1/notify/channels/:id
    And 頁面顯示 Toast「Channel 已更新」
    And 表單關閉且 channel 卡片顯示更新後的內容

  @channel @error-handling @p1
  Scenario: 編輯儲存失敗時顯示錯誤訊息
    Given 管理員已修改 channel 設定並送出 PUT 請求
    And 後端回傳錯誤
    When 系統收到失敗回應
    Then 頁面顯示 Toast 錯誤原因
    And channel 卡片維持原設定不變

  # ══════════════════════════════════════════════════════════════
  # 主流程 — 開關 Channel（IF 步驟 7）
  # ══════════════════════════════════════════════════════════════

  @channel @happy-path @p0
  Scenario: 切換 Toggle 樂觀更新 Channel 啟用狀態
    Given channel「團隊 Slack」目前為啟用狀態
    When 管理員點擊該 channel 的 toggle 開關
    Then toggle 立即切換為停用狀態（樂觀更新）
    And 系統發送 PATCH /api/v1/notify/channels/:id 更新 enabled=false
    And 更新成功後 toggle 保持停用狀態
    And 該 channel 卡片變灰/半透明顯示停用狀態

  @channel @error-handling @p1
  Scenario: Toggle 更新失敗時回復原狀態
    Given 管理員已點擊 channel「團隊 Slack」的 toggle 開關
    And PATCH /api/v1/notify/channels/:id 回傳錯誤
    When 系統收到失敗回應
    Then toggle 回復為原狀態
    And 頁面顯示 Toast「無法更新 Channel 狀態：{原因}」

  # ══════════════════════════════════════════════════════════════
  # 主流程 — 刪除 Channel（IF 步驟 8）
  # ══════════════════════════════════════════════════════════════

  @channel @happy-path @p0
  Scenario: 刪除 Channel 前彈出確認對話框
    Given channel「團隊 Slack」顯示於列表中
    When 管理員點擊該 channel 的「刪除」按鈕
    Then 彈出確認對話框「確定刪除 Channel「團隊 Slack」？此操作無法復原。」
    And 對話框提供確認與取消按鈕

  @channel @happy-path @p0
  Scenario: 確認刪除後 Channel 從列表移除
    Given 刪除確認對話框已開啟
    When 管理員點擊「確認刪除」
    Then 系統發送 DELETE /api/v1/notify/channels/:id
    And 頁面顯示 Toast「Channel 已刪除」
    And 該 channel 從列表移除（淡出動畫）
    And 列表由 N 項變為 N-1 項

  @channel @happy-path @p1
  Scenario: 取消刪除不產生任何變更
    Given 刪除確認對話框已開啟
    When 管理員點擊「取消」
    Then 對話框關閉
    And channel 列表維持不變

  @channel @error-handling @p1 @channel-delete
  Scenario: 刪除操作被 API 拒絕時卡片保留
    Given 管理員在確認對話框中確認刪除 channel
    And DELETE /api/v1/notify/channels/:id 回傳錯誤
    When 系統收到失敗回應
    Then 頁面顯示 Toast「無法刪除 Channel：{原因}」
    And 該 channel 卡片仍保留在列表中

  # ══════════════════════════════════════════════════════════════
  # 主流程 — 測試 Webhook 連線（IF 步驟 9）
  # ══════════════════════════════════════════════════════════════

  @test @happy-path @p0 @smoke
  Scenario: 點擊測試按鈕顯示發送中狀態
    Given channel「團隊 Slack」已存在且 toggle 為開啟
    When 管理員點擊該 channel 的「測試」按鈕
    Then 按鈕變為 loading spinner
    And 頁面顯示 Toast「正在發送測試通知...」
    And 系統發送 POST /api/v1/notify/channels/:id/test

  @test @happy-path @p0
  Scenario: 測試通知發送成功顯示成功提示
    Given channel「團隊 Slack」已存在且 toggle 為開啟
    When 管理員點擊「測試」且 POST /api/v1/notify/channels/:id/test 回傳成功
    Then 頁面顯示 Toast「測試通知已發送 ✅，請檢查目標平台」
    And 按鈕恢復為可點擊狀態

  @test @error-handling @p0
  Scenario: 測試通知失敗顯示具體錯誤原因
    Given channel「團隊 Slack」已存在且 toggle 為開啟
    And 後端發送測試訊息失敗（如連線逾時或 403 Forbidden）
    When 管理員點擊「測試」
    Then 頁面顯示 Toast「測試失敗 ❌：{原因}」
    And 按鈕恢復為可點擊狀態

  @test @error-handling @p1
  Scenario: 請求已送出但目標平台回覆異常時顯示警告
    Given channel「團隊 Slack」已存在且 toggle 為開啟
    And 後端收到 HTTP 200 但目標平台回覆異常
    When 管理員點擊「測試」
    Then 頁面顯示 Toast「⚠️ 請求已送出但目標平台回覆異常，請檢查 URL/Token」
    And 按鈕恢復為可點擊狀態

  # ══════════════════════════════════════════════════════════════
  # 背景流程 — 狀態變更觸發通知（IF 步驟 10）
  # ══════════════════════════════════════════════════════════════

  @trigger @happy-path @p0 @smoke
  Scenario: 服務狀態變更時匹配的 Channel 自動收到通知並寫入紀錄
    Given 已存在啟用的 channel「團隊 Slack」
    And 該 channel 的觸發事件包含 failed 且服務範圍為全部服務
    When nginx.service 因異常 crash 進入 failed 狀態
    Then internal/notify 模組接收 D-Bus 狀態變更事件
    And 系統載入所有已啟用的 channels 並逐一檢查觸發條件
    And 該 channel 的觸發事件與服務範圍皆匹配
    And 系統依類型建構 Slack payload 並發送 HTTP POST
    And 通知發送紀錄新增一筆 status=success、觸發事件=failed、目標服務=nginx.service 的紀錄

  @trigger @happy-path @p0 @smoke
  Scenario Outline: 服務狀態變更為「<event>」時觸發匹配 Channel 的通知
    Given 已存在啟用的 channel，觸發事件包含「<event>」且服務範圍為全部服務
    When systemd 服務 nginx.service 狀態變更為「<event>」
    Then 系統檢查觸發事件匹配
    And 系統建構通知 payload 並發送 HTTP 請求至目標平台
    And 通知發送紀錄新增一筆觸發事件為「<event>」的紀錄

    Examples:
      | event     |
      | started   |
      | stopped   |
      | failed    |
      | restarted |

  @trigger @business-rules @p0
  Scenario: 已停用的 Channel 不會收到任何通知
    Given channel「維護通知」已停用（enabled=false）
    When 系統服務狀態發生變更
    Then 系統跳過該 channel
    And 該 channel 不發送通知且不新增發送紀錄

  @trigger @business-rules @p0
  Scenario Outline: 觸發事件與服務範圍需同時匹配才發送通知
    Given channel「DB 通知」的觸發事件為 failed 且服務範圍為 postgresql.service
    When <service> 狀態變更為 <event>
    Then <expectation>

    Examples:
      | service            | event   | expectation                                                        |
      | nginx.service      | failed  | 該 channel 不發送通知（觸發事件匹配但服務範圍不匹配）             |
      | postgresql.service | stopped | 該 channel 不發送通知（服務範圍匹配但觸發事件不匹配）             |
      | postgresql.service | failed  | 該 channel 發送通知（觸發事件與服務範圍皆匹配）                   |

  @trigger @error-handling @p1 @parallel
  Scenario: 多個 Channel 同時匹配時並行發送互不影響
    Given 兩個啟用的 channel「團隊 Slack」與「個人群組」皆匹配目前服務狀態變更
    When 服務狀態變更觸發通知
    Then 兩個 channel 並行發送通知
    And 任一 channel 發送失敗不影響其他 channel
    And 各 channel 的發送結果獨立寫入通知紀錄

  @trigger @error-handling @p1 @dbus-fallback
  Scenario: D-Bus 監聽中斷時以 systemctl fallback 模式繼續觸發通知
    Given 後端 D-Bus 監聽中斷並進入 systemctl fallback 模式
    When 服務狀態發生變更
    Then 通知模組從 WebSocket 內部事件獲取狀態變更
    And 匹配的 channel 仍正常收到通知

  @trigger @error-handling @p0 @background-failure
  Scenario: 背景發送失敗時通知紀錄顯示 failure 與錯誤原因
    Given 已啟用的 channel 匹配目前服務狀態變更
    And 目標 webhook 伺服器回傳錯誤（如 HTTP 500）
    When 系統發送通知
    Then 通知發送紀錄寫入 status=failure 與 error detail
    And 管理員可在發送紀錄中查看失敗原因

  # ══════════════════════════════════════════════════════════════
  # 通知發送紀錄（IF 步驟 11）
  # ══════════════════════════════════════════════════════════════

  @history @happy-path @p0
  Scenario: 發送紀錄表格顯示完整欄位且依時間倒序
    Given 系統中存在多筆通知發送紀錄
    When 管理員點擊「發送紀錄」分頁
    Then 系統發送 GET /api/v1/notify/history?page=1&limit=30
    And 頁面顯示紀錄表格，欄位包含時間、Channel 名稱、觸發事件、目標服務、發送結果與錯誤訊息
    And 紀錄依時間倒序排列

  @history @happy-path @p1
  Scenario: 無發送紀錄時顯示空狀態
    Given 系統中沒有任何通知發送紀錄
    When 管理員點擊「發送紀錄」分頁
    Then 頁面顯示空狀態「尚無通知發送紀錄」

  @history @happy-path @p1
  Scenario: 依 Channel 下拉篩選發送紀錄
    Given 發送紀錄中包含多個 channel 的紀錄
    When 管理員在下拉選單選擇 channel「團隊 Slack」
    Then 系統以 channel_id 重新查詢發送紀錄
    And 表格僅顯示該 channel 的紀錄

  @history @happy-path @p1
  Scenario Outline: 依發送結果切換為「<result_label>」篩選
    Given 發送紀錄中包含成功與失敗的紀錄
    When 管理員切換結果篩選為「<result_label>」
    Then 系統以 <result_param> 重新查詢發送紀錄
    And 表格僅顯示 <result_label> 的紀錄

    Examples:
      | result_label | result_param      |
      | 全部         | 不帶 status 參數   |
      | 成功         | status=success     |
      | 失敗         | status=failure     |

  @history @happy-path @p1
  Scenario: 發送紀錄分頁載入更多
    Given 系統中有超過 30 筆發送紀錄
    When 管理員捲動至列表底部或點擊下一頁
    Then 系統發送 GET /api/v1/notify/history?page=2&limit=30
    And 表格追加顯示下一頁紀錄
    And 頁面顯示目前頁碼與總頁數

  @history @happy-path @p2
  Scenario: 成功與失敗紀錄以不同顏色標示
    Given 發送紀錄中包含成功與失敗的紀錄
    When 管理員查看發送紀錄表格
    Then 成功紀錄以綠色標示（🟢）
    And 失敗紀錄以紅色標示（🔴）並顯示錯誤訊息

  # ══════════════════════════════════════════════════════════════
  # 異常處理 — 對應 IF 第 5 節異常處理表格
  # ══════════════════════════════════════════════════════════════

  @error-handling @p1 @invalid-url
  Scenario: Webhook URL 無效時儲存成功但測試顯示具體 HTTP 錯誤
    Given 管理員建立的 Slack channel 使用了無效的 Webhook URL
    And 該 channel 儲存成功
    When 管理員點擊「測試」驗證連線
    Then 測試失敗並顯示具體 HTTP 錯誤（如 404 / 403 / 連線逾時）
    And 管理員修正 URL 後可重新測試

  @error-handling @edge-case @p0 @auto-disable
  Scenario: 連續失敗 10 次後 Channel 自動停用並提示管理員
    Given channel「團隊 Slack」已連續發送失敗 9 次
    When 第 10 次發送再次失敗
    Then 系統自動停用該 channel（enabled=false）並記錄停用原因
    And 管理員下次開啟通知頁面時顯示 Toast「Channel「團隊 Slack」因連續失敗已自動停用」
    And 管理員修正設定後可手動重新啟用

  @error-handling @edge-case @p0 @timeout
  Scenario: 通知發送逾時 10 秒視為失敗且最多重試 1 次
    Given 目標 webhook 伺服器無法在 10 秒內回應
    When 系統發送 webhook 請求
    Then 請求於 10 秒後判定逾時
    And 系統自動重試 1 次
    And 重試仍失敗後該次通知紀錄寫入 failure
    And 系統不再進行第 2 次重試（該請求總計最多 20 秒）

  @error-handling @p1 @history
  Scenario: 發送紀錄過多時以分頁與 30 天清理機制管理
    Given 系統中發送紀錄超過單頁可顯示數量
    When 管理員查看發送紀錄
    Then 紀錄依時間倒序分頁顯示，每頁 30 筆
    And 超過 30 天的紀錄已被自動清理
    And 管理員可使用篩選縮小查詢範圍

  # ══════════════════════════════════════════════════════════════
  # 邊界與限制 — 對應 IF 第 6 節邊界與限制表格
  # ══════════════════════════════════════════════════════════════

  @edge-case @p0 @channel-limit
  Scenario: Channel 數量達到 20 個上限時拒絕新增
    Given 系統已存在 20 個 channels
    When 管理員嘗試建立第 21 個 channel
    Then 系統拒絕建立並回傳錯誤
    And 頁面顯示 Toast 說明 channel 數量已達上限

  @edge-case @p1 @payload
  Scenario: 通知 payload 僅含服務摘要不包含完整 log
    Given nginx.service 的 journal log 包含大量內容
    When 系統建構通知 payload
    Then payload 僅包含服務名稱、狀態、時間等摘要資訊
    And 不包含任何完整 log 內容

  @edge-case @p1 @trigger-events
  Scenario: 服務執行 reloaded 時不觸發任何通知
    Given 已存在啟用的 channel，觸發事件包含 started/stopped/failed/restarted
    When 管理員執行 systemctl reload nginx.service（狀態變更為 reloaded）
    Then 系統不發送任何通知
    And 通知發送紀錄無新增

  @edge-case @p1 @retention
  Scenario: 通知發送紀錄保留最近 30 天，超過自動清理
    Given 系統中存在 30 天前的發送紀錄
    When 系統執行發送紀錄清理
    Then 超過 30 天的紀錄被自動刪除
    And 30 天內的紀錄完整保留

  @edge-case @p1 @telegram
  Scenario: Telegram 回傳 rate limit 資訊時後端記錄但不強制阻擋
    Given 已存在的 Telegram channel 接近速率上限（Bot API 整體約 30 msg/s、單一 chat 約 1 msg/s、群組約 20 msg/min）
    When Telegram Bot API 回應 HTTP 429 且 body 包含 retry_after
    Then 後端將 rate limit 資訊（含 retry_after）記錄於通知紀錄
    And 不強制阻擋該 channel 繼續發送

  @edge-case @p1 @custom-webhook
  Scenario Outline: 自訂 Webhook 以 <http_method> 方法發送 JSON payload
    Given 已存在啟用的自訂 Webhook channel，HTTP 方法設定為 <http_method>
    When 服務狀態變更觸發該 channel 的通知
    Then 系統以 <http_method> 方法發送請求
    And 請求 payload 為 JSON 格式（含服務名稱、狀態、時間）
    And 請求攜帶自訂 headers（最多 10 組 key-value）

    Examples:
      | http_method |
      | POST        |
      | PUT         |

  @edge-case @p1 @custom-webhook
  Scenario: 自訂 Webhook headers 超過 10 組時拒絕建立
    Given 管理員在自訂 Webhook channel 中設定了 11 組 headers
    When 管理員點擊「儲存」
    Then 前端驗證失敗並提示 headers 最多 10 組
    And channel 未建立

  @edge-case @p1 @service-matching
  Scenario Outline: 服務名稱僅支援精確匹配，<service> 不觸發指定服務的 Channel
    Given channel「指定服務通知」的服務範圍僅為「nginx.service」
    When 服務「<service>」狀態變更為 failed
    Then 該 channel 不發送通知（不支援 regex 或 glob pattern）

    Examples:
      | service           |
      | nginx             |
      | nginx-ssl.service |
      | web.service       |

  # ══════════════════════════════════════════════════════════════
  # 商業規則 — 對應 IF 第 7 節驗收檢查清單
  # ══════════════════════════════════════════════════════════════

  @business-rules @p0 @payload
  Scenario Outline: 依 Channel 類型建構對應格式的通知 payload
    Given 已存在啟用的 <channel_type> channel「<channel_name>」
    And 該 channel 匹配目前服務狀態變更（nginx.service failed）
    When internal/notify 模組建構通知 payload
    Then payload 依 <channel_type> 規則建構：<payload_rule>
    And 以對應的授權與 HTTP 方式發送至目標平台

    Examples:
      | channel_type | channel_name | payload_rule                                                          |
      | Slack        | 團隊 Slack   | attachments 格式，color 依狀態對應（started=good / stopped=warning / failed=danger） |
      | Discord      | 團隊 Discord | embed 格式並含 embed color                                            |
      | Telegram     | 個人群組     | bot token 內嵌 URL 路徑 + JSON body {chat_id, text}                  |
      | 自訂 Webhook | 自訂監控     | JSON payload 含服務名稱、狀態、時間 + 自訂 headers                   |

  @api @business-rules @error-handling @p0 @security
  Scenario Outline: 通知相關 API 未登入時回傳 401
    Given 客戶端未登入且未攜帶有效驗證資訊
    When 客戶端發送 <http_method> 請求至 <endpoint>
    Then Auth middleware 攔截請求
    And 後端回傳 HTTP 401 Unauthorized

    Examples:
      | http_method | endpoint                       |
      | GET         | /api/v1/notify/channels        |
      | POST        | /api/v1/notify/channels        |
      | PUT         | /api/v1/notify/channels/1      |
      | PATCH       | /api/v1/notify/channels/1      |
      | DELETE      | /api/v1/notify/channels/1      |
      | POST        | /api/v1/notify/channels/1/test |
      | GET         | /api/v1/notify/history         |

  @business-rules @p1 @data
  Scenario: Channel 設定儲存於 JSON 檔案
    Given 管理員建立或更新 channel 設定
    When 系統持久化 channel 設定
    Then 設定寫入 /var/lib/linux-service-manager/notify.json

  @business-rules @p1 @data
  Scenario: 發送紀錄以 JSON Lines 格式儲存
    Given 系統完成一次通知發送
    When 系統寫入發送紀錄
    Then 紀錄以 JSON Lines 格式追加寫入 notify-history.jsonl

  @business-rules @p1 @data
  Scenario: 刪除 Channel 時保留其關聯的發送紀錄
    Given channel「團隊 Slack」存在多筆發送紀錄
    When 管理員刪除該 channel
    Then channel 設定被刪除
    And 其歷史發送紀錄仍保留於發送紀錄中

  @business-rules @p1 @security
  Scenario: 所有已登入管理員皆可管理通知設定
    Given 系統尚未啟用 RBAC 限縮（目前所有已登入管理員皆可管理）
    When 管理員存取通知設定頁面
    Then 可檢視、新增、編輯、刪除與開關所有 channels

  # ══════════════════════════════════════════════════════════════
  # 整合 — 對應 IF 第 7 節整合驗收清單
  # ══════════════════════════════════════════════════════════════

  @integration @p0 @smoke
  Scenario Outline: 實際<action>後匹配 Channel 於目標平台收到對應通知
    Given 已存在啟用的 channel「通知 nginx」
    And 該 channel 的觸發事件包含 <event> 且服務範圍為 nginx.service
    When <action>
    Then 管理員在目標平台收到狀態為 <event> 的通知訊息
    And 通知發送紀錄新增一筆成功紀錄

    Examples:
      | action                                       | event     |
      | 管理員實際停止 nginx.service                  | stopped   |
      | 管理員實際啟動 nginx.service                  | started   |
      | nginx.service 因異常 crash 進入 failed 狀態   | failed    |
      | 管理員對 nginx.service 執行 restart           | restarted |

  @integration @p1
  Scenario: 測試按鈕可在目標平台看到測試訊息
    Given channel「團隊 Slack」已啟用且設定正確
    When 管理員點擊「測試」並收到成功 Toast
    Then 目標平台（Slack）顯示測試訊息「🧪 這是一筆來自 Linux Service Manager 的測試通知」

  @integration @p1
  Scenario: 未匹配的 Channel 不會收到通知
    Given channel「DB 通知」的服務範圍為 postgresql.service
    And channel「nginx 通知」的服務範圍為 nginx.service
    When nginx.service 狀態變更為 failed
    Then 「nginx 通知」收到通知
    And 「DB 通知」不收到通知

  @integration @p1
  Scenario: 通知發送紀錄正確寫入且可查詢
    Given 系統已觸發多次通知發送（含成功與失敗）
    When 管理員查看發送紀錄
    Then 每筆發送皆有一筆對應紀錄
    And 紀錄可依 channel 與發送結果篩選查詢
