@audit-log @phase2
Feature: 稽核操作紀錄
  作為一個已登入的管理員
  我希望系統自動記錄所有關鍵操作並提供查閱介面
  以便追溯「誰在何時做了什麼」，滿足安全稽核與故障排查需求

  Background:
    Given 管理員已登入系統
    And Audit 模組已啟用

  # ═══════════════════════════════════════════════
  # Happy Path — 稽核頁面主要流程
  # ═══════════════════════════════════════════════

  @smoke @happy-path @p0
  Scenario: 進入 Audit Log 頁面並載入紀錄
    Given 系統中有多筆操作紀錄
    When 管理員點擊 Header 中的「Audit Log」連結
    Then 頁面導航至 /audit
    And 顯示 loading spinner
    And 呼叫 GET /api/v1/audit?page=1&limit=50
    And 表格顯示最近 50 筆稽核紀錄，依時間倒序排列

  @happy-path
  Scenario: 無任何操作紀錄時顯示空狀態
    Given 系統中沒有任何操作紀錄
    When 管理員進入 Audit Log 頁面
    Then 表格顯示空狀態提示「尚無操作紀錄」

  @happy-path
  Scenario: 瀏覽稽核紀錄表格
    Given Audit Log 頁面已載入 50 筆紀錄
    When 管理員捲動瀏覽表格
    Then 表格顯示欄位：時間（YYYY-MM-DD HH:mm:ss）、使用者、來源 IP、動作、目標服務、結果、詳細資訊
    And 成功的紀錄以綠色背景標示
    And 失敗的紀錄以紅色背景標示

  @happy-path
  Scenario: 搜尋稽核紀錄
    Given Audit Log 頁面已載入多筆紀錄
    When 管理員在搜尋框輸入關鍵字 "nginx"
    Then debounce 300ms 後發送 GET /api/v1/audit?search=nginx&page=1&limit=50
    And 表格更新為過濾後結果
    And 搜尋框下方顯示「找到 N 筆紀錄」
    And 分頁重設為第 1 頁

  @regression @p1
  Scenario: 搜尋輸入到一半暫停時畫面不閃爍、可繼續輸入（bug 回歸）
    Given Audit Log 頁面已載入多筆紀錄
    When 管理員在搜尋框輸入 "ngi" 後暫停，debounce 觸發 API 請求
    And 管理員在 API 請求進行中繼續輸入 "nx"
    Then 搜尋框保持可用、保有焦點，值變成 "nginx"
    And 畫面不閃爍（表格維持顯示，不被 spinner 取代）
    And 發送 GET /api/v1/audit?search=nginx&page=1&limit=50
    And 表格更新為 "nginx" 的搜尋結果

  @regression @p1
  Scenario: 快速連續輸入時較晚回應的舊請求不得覆蓋新結果
    Given Audit Log 頁面已載入多筆紀錄
    When 管理員在舊請求（search=ngi）回應前繼續輸入並送出新請求（search=nginx）
    And 舊請求的回應比新請求晚到達
    Then 表格顯示的是 search=nginx 的結果
    And 較晚回應的舊請求被忽略，不覆蓋新結果

  @happy-path
  Scenario: 日期範圍篩選
    Given Audit Log 頁面已載入多筆紀錄
    When 管理員選擇日期範圍 2025-08-01 ~ 2025-08-09
    Then 發送 GET /api/v1/audit?from=2025-08-01&to=2025-08-09&page=1&limit=50
    And 表格更新為該日期範圍內的紀錄
    And 分頁重設為第 1 頁

  @happy-path
  Scenario: 翻頁瀏覽稽核紀錄
    Given Audit Log 頁面顯示第 1 頁（共 5 頁）
    When 管理員點擊「下一頁」
    Then 發送 GET /api/v1/audit?page=2&limit=50
    And 頁面捲回表格頂端
    And 顯示第 2 頁紀錄
    And 分頁控制顯示目前頁碼為 2、總頁數為 5

  @happy-path
  Scenario: 匯出 CSV
    Given Audit Log 頁面已載入稽核紀錄
    When 管理員點擊「匯出 CSV」按鈕
    Then 發送 GET /api/v1/audit/export?format=csv
    And 後端回傳 CSV 檔案（Content-Disposition: attachment）
    And 瀏覽器觸發下載，檔名格式為 audit-log-{YYYY-MM-DD}.csv
    And Toast 顯示「稽核紀錄已匯出」

  @happy-path
  Scenario: 匯出 CSV 時保留過濾條件
    Given Audit Log 頁面已套用搜尋關鍵字 "nginx" 和日期範圍 2025-08-01 ~ 2025-08-09
    When 管理員點擊「匯出 CSV」按鈕
    Then 發送 GET /api/v1/audit/export?format=csv&search=nginx&from=2025-08-01&to=2025-08-09
    And CSV 內容僅包含符合過濾條件的紀錄

  # ═══════════════════════════════════════════════
  # Happy Path — 後端自動記錄
  # ═══════════════════════════════════════════════

  @smoke @happy-path @p0
  Scenario: 服務操作成功後自動寫入 audit log
    Given 管理員已登入
    When 管理員執行 POST /api/v1/services/nginx/restart 且操作成功
    Then 系統非同步寫入一筆 audit log：timestamp、username、source_ip、action=restart、target=nginx.service、result=success、detail=""
    And API 回應不受 audit log 寫入影響（非阻塞）

  @happy-path
  Scenario: 服務操作失敗後也寫入 audit log
    Given 管理員已登入
    When 管理員執行 POST /api/v1/services/nonexistent/start 且操作失敗
    Then 系統非同步寫入一筆 audit log：result=failure、detail 含錯誤訊息

  @happy-path
  Scenario: 登入成功時寫入 audit log
    Given 使用者尚未登入
    When 使用者以正確帳密登入成功
    Then 系統寫入一筆 audit log：action=login、result=success

  @happy-path
  Scenario: 登出時寫入 audit log
    Given 管理員已登入
    When 管理員執行登出
    Then 系統寫入一筆 audit log：action=logout、result=success

  @happy-path @p0
  Scenario Outline: 各種服務操作皆自動記錄
    Given 管理員已登入
    When 管理員執行 <API> 且操作 <結果>
    Then 系統寫入一筆 audit log：action=<動作>、target=<目標>、result=<結果>

    Examples:
      | API                                | 動作      | 目標           | 結果    |
      | /api/v1/services/nginx/start       | start     | nginx.service  | success |
      | /api/v1/services/nginx/stop        | stop      | nginx.service  | success |
      | /api/v1/services/nginx/restart     | restart   | nginx.service  | success |
      | /api/v1/services/nginx/enable      | enable    | nginx.service  | success |
      | /api/v1/services/nginx/disable     | disable   | nginx.service  | success |
      | /api/v1/services/nginx/start       | start     | nginx.service  | failure |
      | /api/v1/services/nginx/stop        | stop      | nginx.service  | failure |

  @business-rules
  Scenario: 記錄欄位完整性
    Given 管理員執行任何受保護的 API 操作
    When 操作完成（成功或失敗）
    Then audit log 記錄包含以下所有欄位：timestamp、username、source_ip、action、target、result、detail

  @business-rules
  Scenario: 不記錄敏感資訊
    Given 管理員登入系統
    When 寫入 audit log
    Then 記錄中不包含密碼、session token 或其他敏感認證資訊

  # ═══════════════════════════════════════════════
  # Error Handling
  # ═══════════════════════════════════════════════

  @error-handling
  Scenario: Audit log 儲存失敗不影響操作結果
    Given 磁碟空間已滿，audit log 無法寫入
    When 管理員執行 POST /api/v1/services/nginx/restart
    Then 服務操作仍成功執行並回傳正常 response
    And 後端僅 log error，不拋出例外

  @error-handling
  Scenario: 載入稽核頁面時 API 請求失敗
    Given 管理員進入 /audit 頁面
    When GET /api/v1/audit 請求失敗（網路錯誤或 500）
    Then 頁面顯示錯誤訊息
    And 顯示「重試」按鈕
    And 管理員可點擊重試或返回 Dashboard

  @error-handling
  Scenario: 搜尋無匹配結果
    Given Audit Log 頁面已載入多筆紀錄
    When 管理員搜尋不存在的關鍵字 "xyz123nonexistent"
    Then 表格顯示空狀態「沒有符合條件的紀錄」
    And 顯示「清除過濾」連結

  @error-handling
  Scenario: 未登入時存取稽核 API
    Given 使用者未登入
    When 使用者直接造訪 GET /api/v1/audit
    Then API 回傳 401 Unauthorized

  # ═══════════════════════════════════════════════
  # Edge Cases
  # ═══════════════════════════════════════════════

  @edge-case
  Scenario: CSV 匯出資料量超過上限
    Given 系統中有超過 10,000 筆符合條件的稽核紀錄
    When 管理員點擊「匯出 CSV」
    Then API 回傳最多 10,000 筆紀錄
    And Toast 顯示「已匯出最近 10,000 筆紀錄」

  @edge-case
  Scenario: 分頁請求超出範圍
    Given 系統中僅有 30 筆稽核紀錄
    When 管理員請求 GET /api/v1/audit?page=5&limit=50
    Then API 回傳空陣列，total 欄位顯示 30

  @edge-case
  Scenario: 每頁筆數達上限
    Given 系統中有多筆稽核紀錄
    When 管理員請求 GET /api/v1/audit?page=1&limit=100
    Then API 回傳最多 100 筆紀錄（不超過上限）

  @business-rules
  Scenario: 僅記錄 Web UI / API 操作
    Given 某服務 nginx.service 正在運行
    When 管理員透過 SSH 直接執行 systemctl stop nginx
    Then audit log 中不出現該操作紀錄

  @business-rules
  Scenario: 超過保留期限的紀錄自動清理
    Given 系統中有超過 90 天的舊稽核紀錄
    When 下一次寫入 audit log 時（或定時清理觸發）
    Then 超過 90 天的紀錄被移除
    And 90 天內的紀錄保留不變

  @business-rules @edge-case
  Scenario: JSON Lines 檔案達 100MB 上限
    Given audit.jsonl 檔案大小已達 100MB
    When 管理員執行任何操作觸發 audit log 寫入
    Then 系統仍嘗試寫入
    And 後端 log warning 提示檔案大小達上限
