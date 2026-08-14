@multi-node-agent-management @agent @node @p0 @smoke @regression
Feature: 多機管理 Agent 模式
  作為一個已登入的管理員
  我希望透過單一 Manager 主控面板管理多台 Linux 機器的 systemd 服務，包括節點註冊、Agent 部署上線、離線偵測與跨節點服務搜尋
  以便不需在每台機器分別開啟管理介面，即可在同一操作介面掌握整個基礎設施的服務狀態，降低分散環境的管理負擔

  Background:
    Given 管理員已登入 Manager
    And Manager 已啟動並正常運作
    And WebSocket 即時推送模組已啟用

  # ══════════════════════════════════════════════════════════════
  # 主流程 — Aggregate Dashboard（IF 3.1 / 步驟 1）
  # ══════════════════════════════════════════════════════════════

  @entry @happy-path @p0 @smoke
  Scenario: 登入後預設進入 Aggregate Dashboard 並載入節點匯總資料
    When 管理員完成登入
    Then 路由導航至 /dashboard（Aggregate 模式）
    And 系統並行發送 GET /api/v1/nodes 與 GET /api/v1/nodes/summary
    And 頁面顯示頂部統計列與 Node Cards 網格

  @aggregate @happy-path @p0 @smoke
  Scenario: Aggregate Dashboard 顯示頂部統計列與節點狀態摘要
    Given Manager 已註冊多個節點且部分節點在線
    When Aggregate Dashboard 載入完成
    Then 頂部統計列顯示總節點數 / 線上台數 / 離線台數
    And 顯示總服務數 / 執行中 / 失敗統計
    And 每個節點以 Node Card 顯示節點名稱、Hostname、狀態指示燈、服務統計（M/N 執行中）與最後心跳時間

  @aggregate @happy-path @p0 @smoke
  Scenario: 節點 Card 狀態指示燈依心跳狀態顯示不同顏色
    Given 節點 A 心跳正常、節點 B 心跳稍有延遲但未逾時、節點 C 心跳逾時
    And 節點 D 離線超過寬限期
    When Aggregate Dashboard 顯示節點 Cards
    Then 節點 A 顯示 🟢 線上
    And 節點 B 顯示 🟡 延遲
    And 節點 C 顯示 🔴 離線
    And 節點 D 顯示 ⚫ 長期離線

  @aggregate @happy-path @p1
  Scenario: 無註冊節點時顯示空狀態與引導
    Given Manager 尚未註冊任何節點
    When 管理員登入並載入 Aggregate Dashboard
    Then 頁面顯示空狀態「尚無已註冊節點，請先新增節點」
    And 空狀態提供導引至 Node Management 頁面的入口

  # ══════════════════════════════════════════════════════════════
  # 主流程 — 節點切換與單節點視圖（IF 3.1 / 步驟 2）
  # ══════════════════════════════════════════════════════════════

  @switch @happy-path @p0 @smoke
  Scenario: 點擊線上節點 Card 切換至單節點視圖
    Given Aggregate Dashboard 顯示線上節點「web-server-01」的 Card
    When 管理員點擊該節點 Card
    Then URL 變更為 /dashboard?node={nodeId}
    And 系統發送 GET /api/v1/nodes/{id}/services 由 Manager 代理查詢 Agent
    And Header 顯示目前節點名稱與節點切換下拉選單
    And 頁面顯示該節點專屬的服務列表（與單機 Dashboard 相同佈局）

  @switch @happy-path @p1
  Scenario: 從 Header 節點下拉選單切換至其他節點
    Given 管理員位於單節點視圖（目前節點為 web-server-01）
    And Manager 已註冊多個節點
    When 管理員點擊 Header 節點下拉選單並選取「db-server-01」
    Then 視圖切換至 db-server-01 的單節點視圖
    And Header 目前節點名稱更新為 db-server-01
    And 服務列表重新載入該節點服務

  @switch @happy-path @p1
  Scenario: 點擊「所有節點」返回 Aggregate Dashboard
    Given 管理員位於單節點視圖
    When 管理員點擊 Header 中的「所有節點」按鈕
    Then 路由變更回 /dashboard（無 node 參數）
    And 系統重新載入 Aggregate Dashboard 與匯總統計

  @switch @happy-path @p1
  Scenario: 節點下拉選單列出所有節點及其狀態指示燈
    Given 管理員位於單節點視圖
    When 管理員展開 Header 節點下拉選單
    Then 選單列出所有已註冊節點
    And 每個選項顯示節點名稱與狀態指示燈（🟢/🟡/🔴/⚫）
    And 目前節點名稱在選單中反白

  # ══════════════════════════════════════════════════════════════
  # 主流程 — 單節點服務操作（IF 3.1 / 步驟 3）
  # ══════════════════════════════════════════════════════════════

  @service @happy-path @p0 @smoke
  Scenario Outline: 在選定節點上執行「<action>」操作成功
    Given 管理員位於節點「web-server-01」的單節點視圖
    And 節點狀態為 🟢 線上
    When 管理員點擊 nginx.service 的「<action>」按鈕
    Then 操作期間按鈕顯示 loading spinner
    And 系統發送 POST /api/v1/nodes/{id}/services/nginx.service/<endpoint>
    And Manager 代理請求至 Agent 並在目標機器執行 systemctl <cmd>
    And 操作完成後 Toast 顯示「web-server-01 nginx.service <done_msg>」
    And 服務列表該列狀態更新
    And Audit Log 新增一筆紀錄（含 action 與 node_id）

    Examples:
      | action | endpoint | cmd     | done_msg |
      | 啟動   | start    | start   | 已啟動   |
      | 停止   | stop     | stop    | 已停止   |
      | 重啟   | restart  | restart | 已重啟   |
      | 啟用   | enable   | enable  | 已啟用   |
      | 停用   | disable  | disable | 已停用   |

  @service @happy-path @p1
  Scenario: 在單節點視圖檢視服務日誌
    Given 管理員位於節點「web-server-01」的單節點視圖
    And 節點狀態為 🟢 線上
    When 管理員點擊 nginx.service 的「查看日誌」按鈕
    Then 系統發送 GET /api/v1/nodes/{id}/services/nginx.service/logs
    And 日誌檢視器顯示該節點 nginx.service 的 journal 內容

  @service @error-handling @p0
  Scenario: 服務操作失敗時顯示錯誤原因並寫入 Audit Log
    Given 管理員位於節點「web-server-01」的單節點視圖
    And Agent 回傳操作失敗（如權限不足）
    When 管理員點擊 nginx.service 的「重啟」按鈕
    Then Toast 顯示「web-server-01 nginx.service 重啟失敗：權限不足」
    And 服務列表狀態維持不變
    And Audit Log 記錄失敗操作

  # ══════════════════════════════════════════════════════════════
  # 主流程 — 跨節點搜尋服務（IF 3.1 / 步驟 7）
  # ══════════════════════════════════════════════════════════════

  @search @happy-path @p0 @smoke
  Scenario: 在 Aggregate Dashboard 跨節點搜尋服務
    Given 管理員位於 Aggregate Dashboard
    And 多個線上節點執行包含「nginx」的服務
    When 管理員在搜尋框輸入「nginx」
    Then 輸入停止 300ms（debounce）後系統發送 GET /api/v1/nodes/services/search?q=nginx
    And Manager 向所有線上 Agent 並行查詢匹配服務並彙總結果
    And 搜尋結果列表顯示節點名稱、服務名稱與服務狀態

  @search @happy-path @p1
  Scenario: 點擊搜尋結果跳轉至對應節點並展開服務
    Given 搜尋「nginx」已回傳結果「web-server-01 / nginx.service」
    When 管理員點擊該搜尋結果
    Then 視圖切換至 web-server-01 的單節點視圖
    And 服務列表自動展開 nginx.service

  @search @happy-path @p1
  Scenario: 搜尋無匹配結果時顯示空提示
    Given 所有節點皆無與「mysql」匹配的服務
    When 管理員在搜尋框輸入「mysql」
    Then 搜尋結果顯示「沒有找到匹配的服務」
    And 管理員可關閉搜尋返回 Card 視圖

  @search @error-handling @p1 @partial-failure
  Scenario: 部分節點離線時搜尋僅回傳可達節點的結果
    Given 節點 db-server-01 離線、web-server-01 線上
    And 兩個節點皆有匹配「nginx」的服務
    When 管理員搜尋「nginx」
    Then 結果僅顯示 web-server-01 的匹配服務
    And 離線節點旁標示「無法查詢」
    And 其他節點的結果不被阻塞

  # ══════════════════════════════════════════════════════════════
  # 主流程 — 節點詳細資訊（IF 3.1 / 步驟 8）
  # ══════════════════════════════════════════════════════════════

  @node-detail @happy-path @p0
  Scenario: 查看節點詳細資訊面板
    Given Aggregate Dashboard 顯示節點「web-server-01」的 Card
    When 管理員點擊該 Card 的「詳情」按鈕
    Then 彈出節點資訊側面板
    And 系統發送 GET /api/v1/nodes/{id}/info
    And 面板顯示節點名稱、Hostname、Agent 版本、OS 資訊、上線時長與最後心跳時間
    And 面板底部提供「重新連線 / 編輯設定 / 移除節點」操作按鈕

  @node-detail @happy-path @p1
  Scenario: 離線節點 Card 點擊顯示離線資訊面板
    Given 節點「web-server-01」目前為 🔴 離線
    When 管理員點擊該離線節點 Card
    Then 顯示離線資訊面板：最後上線時間、最後心跳時間、離線持續時間、Agent 版本與 Hostname
    And 面板顯示操作建議（檢查 Agent 是否執行）
    And 面板提供「重新連線」與「移除節點」按鈕

  # ══════════════════════════════════════════════════════════════
  # 子流程 — 新增節點註冊（IF 3.2 / 步驟 4-6）
  # ══════════════════════════════════════════════════════════════

  @entry @node-mgmt @happy-path @p0 @smoke
  Scenario: 進入 Node Management 頁面顯示已註冊節點列表
    When 管理員點擊 Header 中的「Node Management」導覽連結
    Then 路由導航至 /nodes
    And 頁面顯示已註冊節點列表表格
    And 表格欄位包含名稱、位址、狀態、最後心跳、版本與操作
    And 頁面提供「新增節點」與「下載 Agent」按鈕

  @node-mgmt @happy-path @p0
  Scenario: 點擊「新增節點」彈出表單 Modal
    Given 管理員位於 Node Management 頁面
    When 管理員點擊「新增節點」按鈕
    Then 彈出新增節點表單 Modal
    And 表單包含節點名稱（必填）與 Agent 位址 host:port（必填）
    And 表單包含 TLS 憑證指紋（選填）、API Token（選填）與備註（選填）
    And 底部按鈕為「測試連線 / 註冊 / 取消」

  @node-mgmt @happy-path @p0 @validation
  Scenario: 必填欄位缺失時標示紅色提示且不發送請求
    Given 新增節點表單中名稱與位址為空白
    When 管理員點擊「註冊」
    Then 前端攔截請求，不發送 POST /api/v1/nodes
    And 必填欄位以紅色標示提示

  @node-mgmt @happy-path @p0 @smoke
  Scenario: 測試連線成功顯示 Agent 資訊
    Given 管理員在新增節點表單填入位址 10.0.0.5:8443
    When 管理員點擊「測試連線」
    Then 系統發送 POST /api/v1/nodes/test-connection 攜帶位址與 TLS 設定
    And Manager 對 Agent 健康檢查端點發起 GET /health
    And 表單內顯示綠色提示「連線成功 — Agent v1.2.3 @ web-server-01 (Ubuntu 22.04)」
    And Modal 保持開啟

  @node-mgmt @error-handling @p0
  Scenario Outline: 測試連線失敗顯示「<failure_msg>」且可修正重試
    Given 管理員在新增節點表單填入位址 <address>
    When 管理員點擊「測試連線」
    Then 表單內顯示紅色提示「無法連線：<failure_msg>」
    And Modal 保持開啟且表單內容保留
    And 管理員可修改位址後重新測試

    Examples:
      | address       | failure_msg                        |
      | 10.0.0.9:8443 | connection refused                 |
      | 10.0.0.5:8443 | TLS 憑證驗證失敗：certificate expired |

  @node-mgmt @happy-path @p0 @smoke
  Scenario: 註冊成功且連線成功時節點立即上線
    Given 新增節點表單已填寫名稱「web-server-01」與可達位址 10.0.0.5:8443
    When 管理員點擊「註冊」
    Then 系統發送 POST /api/v1/nodes 儲存節點設定至 registry
    And Manager 與 Agent 建立持久連線並開始接收心跳
    And Modal 關閉且節點列表新增該節點
    And 節點狀態顯示 🟢 線上
    And Toast 顯示「節點 web-server-01 已註冊並上線」

  @node-mgmt @error-handling @p0 @duplicate
  Scenario: 節點名稱重複時註冊被拒絕並返回表單
    Given Manager 已存在節點名稱「web-server-01」
    When 管理員以相同名稱「web-server-01」點擊「註冊」
    Then 後端拒絕註冊
    And Toast 顯示「節點名稱重複，請使用不同名稱」
    And Modal 保持開啟供管理員修改名稱

  @node-mgmt @error-handling @p0
  Scenario: 註冊時位址不可達則節點仍儲存但標示離線
    Given 新增節點表單已填寫名稱「db-server-01」與不可達位址 10.0.0.9:8443
    When 管理員點擊「註冊」
    Then Manager 仍儲存節點設定至 registry
    And 節點列表新增該節點並標示 🔴 離線
    And Toast 顯示「節點 db-server-01 已註冊但無法連線」

  @node-mgmt @happy-path @p1
  Scenario: 取消新增節點關閉 Modal 不產生任何變更
    Given 新增節點表單已開啟且填入部分資料
    When 管理員點擊「取消」
    Then Modal 關閉
    And 節點列表維持不變且未新增任何節點

  @node-mgmt @happy-path @p1
  Scenario: 編輯節點設定後儲存更新
    Given 節點「web-server-01」已存在於列表
    When 管理員點擊該節點的「編輯」按鈕並修改位址後儲存
    Then 系統發送 PUT /api/v1/nodes/{id}
    And 節點列表顯示更新後的位址
    And Toast 顯示節點設定已更新

  @node-mgmt @happy-path @p0
  Scenario: 移除節點前彈出確認對話框
    Given 節點「web-server-01」已存在於列表
    When 管理員點擊該節點的「移除」按鈕
    Then 彈出確認對話框「確定要移除此節點？所有歷史資料將保留。」
    And 對話框提供確認與取消按鈕

  @node-mgmt @happy-path @p1
  Scenario: 確認移除後節點從 Dashboard 消失
    Given 移除確認對話框已開啟
    When 管理員點擊「確認移除」
    Then 系統發送 DELETE /api/v1/nodes/{id}
    And Manager 移除節點註冊
    And 該節點從節點列表與 Aggregate Dashboard 消失
    And Toast 顯示「節點已移除」

  @node-mgmt @happy-path @p1
  Scenario: 取消移除不產生任何變更
    Given 移除確認對話框已開啟
    When 管理員點擊「取消」
    Then 對話框關閉
    And 節點仍保留在列表中

  # ══════════════════════════════════════════════════════════════
  # 背景流程 — Agent 部署與上線（IF 3.3）
  # ══════════════════════════════════════════════════════════════

  @agent @happy-path @p1 @download
  Scenario Outline: 從 Manager 下載 <arch> 架構的 Agent binary
    Given 管理員位於 Node Management 頁面
    When 管理員點擊「下載 Agent」並選擇 <arch> 架構
    Then 瀏覽器下載精簡版 Agent binary（無前端內嵌、無靜態資源）
    And binary 可部署至目標 Linux 機器

    Examples:
      | arch  |
      | amd64 |
      | arm64 |

  @agent @happy-path @p0 @smoke
  Scenario: Agent 啟動後向 Manager 註冊並更新為線上
    Given 目標機器已部署 Agent binary
    And agent.yaml 已設定 manager_addr、auth_token 與 node_name
    When Agent 啟動並連接 Manager WebSocket/gRPC
    Then Agent 發送註冊請求（含 node_name、hostname、version）
    And Manager 比對 node_name 與既有記錄
    And 節點狀態更新為 🟢 線上
    And 系統記錄上線時間

  @agent @happy-path @p1
  Scenario: Agent 註冊的 node_name 與既有離線節點比對一致時恢復該節點
    Given Manager 已註冊節點「web-server-01」但目前為 🔴 離線
    When Agent 以 node_name=web-server-01 啟動並發送註冊請求
    Then Manager 比對成功並更新該節點狀態為 🟢 線上
    And 不產生重複節點記錄

  @heartbeat @happy-path @p0 @smoke
  Scenario: Agent 定期發送心跳且 Manager 更新 last_heartbeat
    Given Agent「web-server-01」已上線
    When Agent 每 10 秒發送一次心跳至 Manager
    Then Manager 接受心跳並更新 last_heartbeat
    And 節點保持 🟢 線上狀態

  @heartbeat @happy-path @p0 @websocket
  Scenario: 節點狀態變更即時推送至所有已連線的 Web UI
    Given 兩個管理員瀏覽器皆已開啟 Aggregate Dashboard
    And 節點「web-server-01」狀態發生變更（如離線或上線）
    When Manager 推送節點狀態更新事件
    Then 兩個瀏覽器的 Dashboard 皆即時更新節點狀態
    And 不需手動重整頁面

  # ══════════════════════════════════════════════════════════════
  # 背景流程 — 節點離線處理（IF 3.4 / 步驟 9）
  # ══════════════════════════════════════════════════════════════

  @offline @happy-path @p0 @smoke
  Scenario: 連續 30 秒未收到心跳時節點標示離線
    Given 節點「web-server-01」為 🟢 線上
    And Agent 心跳中斷
    When Manager 心跳監控器連續 30 秒未收到心跳
    Then 節點狀態變更為 🔴 離線
    And Aggregate Dashboard 該節點 Card 指示燈變紅且服務統計灰顯
    And Card 顯示「最後心跳：X 秒前」
    And Header 統計更新（線上台數 -1、離線台數 +1）
    And 若管理員正在檢視則 Toast 顯示「web-server-01 已離線」

  @offline @happy-path @p1
  Scenario: 離線時單節點視圖的操作按鈕全部禁用並顯示 Banner
    Given 管理員位於節點「web-server-01」的單節點視圖
    And 該節點心跳中斷超過 30 秒
    When 節點狀態變更為離線
    Then 服務列表所有操作按鈕（start/stop/restart/enable/disable）禁用
    And 頂部顯示黃色 Banner「節點已離線，操作不可用」

  @offline @happy-path @p0 @smoke
  Scenario: 寬限期內心跳恢復自動回到線上
    Given 節點「web-server-01」已離線 60 秒（未超過 300 秒寬限期）
    When Agent 重新連線並恢復心跳
    Then 節點狀態自動變更回 🟢 線上
    And Toast 顯示「web-server-01 已恢復連線」
    And 服務狀態重新載入

  @offline @happy-path @p1
  Scenario: 超過 300 秒寬限期標示為長期離線
    Given 節點「web-server-01」已離線超過 300 秒
    When Manager 心跳監控器判定超過寬限期
    Then 節點狀態變更為 ⚫ 長期離線
    And Aggregate Dashboard 中該節點卡片移至底部或摺疊

  @offline @happy-path @p1
  Scenario: 長期離線節點可從列表移除且歷史資料保留
    Given 節點「db-server-01」為 ⚫ 長期離線
    When 管理員點擊「移除節點」並確認
    Then Manager 移除節點註冊
    And 該節點從 Dashboard 消失
    And 歷史資料仍保留

  # ══════════════════════════════════════════════════════════════
  # 異常處理 — 對應 IF 第 5 節異常處理表格
  # ══════════════════════════════════════════════════════════════

  @error-handling @p0 @agent-crash
  Scenario: Agent 服務掛掉後重啟自動恢復連線
    Given 節點「web-server-01」因 Agent 服務掛掉而 🔴 離線
    When 管理員在目標機器重啟 Agent 服務
    Then Agent 重新連線並發送註冊請求
    And 節點自動恢復為 🟢 線上
    And Toast 顯示「已恢復連線」

  @error-handling @p1 @network
  Scenario: Manager 與 Agent 網路中斷恢復後於寬限期內無縫回復
    Given Manager 與 Agent「web-server-01」之間網路中斷
    And 節點已標示為 🔴 離線
    When 網路恢復且 Agent 自動重連
    Then 節點在寬限期內自動回到線上狀態
    And 無需管理員手動介入

  @error-handling @p0 @timeout
  Scenario: 服務操作逾時 15 秒顯示逾時錯誤
    Given 管理員對節點「web-server-01」的 nginx.service 執行重啟
    And Agent 未在 15 秒內回應（含 Manager → Agent 來回）
    When 操作逾時
    Then Toast 顯示「web-server-01 操作逾時：nginx.service restart」
    And 操作按鈕恢復為可點擊狀態
    And 管理員可重試操作或檢查 Agent 機器負載狀況

  @error-handling @p1 @tls
  Scenario: TLS 憑證過期導致已註冊節點離線
    Given 節點「web-server-01」的 Agent 端 TLS 憑證已過期
    When Manager 嘗試與 Agent 建立連線
    Then 連線失敗且節點標示為 🔴 離線
    When 管理員更新 Agent 端憑證並同步 Manager 端指紋後重新連線
    Then 節點恢復上線

  @error-handling @p0 @restart
  Scenario: Manager 重啟後於啟動寬限期內重連所有 Agent
    Given Manager 重新啟動
    When Manager 依 node registry 逐一重新連接所有已註冊 Agent
    Then 連線成功的節點狀態自動恢復為 🟢 線上
    And 啟動後 30 秒內不觸發離線通知（啟動寬限期）

  @error-handling @p1 @multi-manager
  Scenario: 同一個 Agent 被第二個 Manager 連線時被拒絕
    Given Agent「web-server-01」已接受第一個 Manager 的連線
    When 第二個 Manager 嘗試連線該 Agent
    Then Agent 拒絕第二個 Manager 的連線
    And 第二個 Manager 上的該節點顯示為 🔴 離線
    And 管理員確認 Agent 設定檔 manager_addr 指向唯一 Manager

  @error-handling @p1 @version
  Scenario: Agent 版本不相容時節點顯示警告狀態
    Given Agent「web-server-01」版本為 v1.0
    And Manager 支援的最低版本為 v1.2
    When Manager 連線時檢查 Agent 版本
    Then 節點顯示 🟡 警告狀態
    And Tooltip 提示「Agent 版本過舊 (v1.0)，建議升級至 v1.2+」

  # ══════════════════════════════════════════════════════════════
  # 邊界與限制 — 對應 IF 第 6 節邊界與限制表格
  # ══════════════════════════════════════════════════════════════

  @edge-case @p0 @node-limit
  Scenario: 節點數量達到 50 個上限時拒絕新增
    Given Manager 已註冊 50 個節點
    When 管理員嘗試註冊第 51 個節點
    Then 系統拒絕註冊並回傳錯誤
    And 頁面顯示 Toast 說明節點數量已達上限

  @edge-case @p1 @heartbeat
  Scenario Outline: 心跳機制依 <threshold> 規則判定
    Given 節點「web-server-01」已上線
    When <condition>
    Then <expectation>

    Examples:
      | threshold | condition                                     | expectation                                    |
      | 心跳間隔  | Agent 每 10 秒發送一次心跳                   | Manager 正常接收並更新 last_heartbeat          |
      | 離線閾值  | 連續 3 次（30 秒）未收到心跳                 | 節點標示為 🔴 離線                             |
      | 寬限期    | 離線持續超過 300 秒（5 分鐘）                | 節點標示為 ⚫ 長期離線                         |

  @edge-case @p1 @timeout
  Scenario Outline: 操作逾時依操作類型套用 <timeout_rule>
    Given 管理員執行 <operation>
    When 逾時時間到達
    Then <expectation>

    Examples:
      | operation       | timeout_rule                                  | expectation                                  |
      | 單一服務操作     | 逾時為 15 秒（含 Manager → Agent 來回）       | 操作判定失敗並顯示逾時錯誤                   |
      | 跨節點搜尋查詢   | 總逾時為 10 秒                                | 逾時後回傳已可達節點的部分結果               |

  @edge-case @p0 @concurrency
  Scenario: 同一節點同一服務不允許並行操作
    Given 管理員對節點「web-server-01」的 nginx.service 執行重啟（操作進行中）
    When 管理員嘗試再次對同一服務執行停止
    Then 操作按鈕保持 disabled
    And 系統拒絕第二個並行操作

  @edge-case @p1 @concurrency
  Scenario: 不同節點可並行操作
    Given 管理員正在對節點「web-server-01」的 nginx.service 執行重啟
    When 管理員同時對節點「db-server-01」的 postgresql.service 執行重啟
    Then 兩個操作並行執行互不影響

  @edge-case @p0 @tls
  Scenario Outline: Manager ↔ Agent 通訊使用 <tls_mode> 模式
    Given Manager 與 Agent 皆設定 <tls_mode>
    When 雙方建立連線
    Then 通訊使用 TLS 加密
    And <validation_rule>

    Examples:
      | tls_mode     | validation_rule                                       |
      | TLS（單向）   | Manager 驗證 Agent 憑證                                |
      | mTLS（雙向）  | Agent 驗證 Manager 憑證且 Manager 驗證 Agent 憑證       |

  @edge-case @p1 @auth
  Scenario: Agent 信任 Manager 的代理授權不直接驗證管理員
    Given 管理員已登入 Manager
    When 管理員透過 Manager 對節點執行服務操作
    Then Manager 以預先設定的 Token 或 mTLS 憑證向 Agent 驗證
    And Agent 不直接驗證管理員身分，信任 Manager 的代理授權

  @edge-case @p1 @consistency
  Scenario: 服務狀態以 Agent 即時回報為準不做本地快取
    Given 管理員查詢節點「web-server-01」的服務列表
    When Manager 處理請求
    Then Manager 每次查詢皆代理至 Agent
    And 服務狀態以 Agent 即時回報為準
    And Aggregate Dashboard 摘要數據來自各節點最後一次心跳附帶的服務統計

  @edge-case @p1 @orchestration
  Scenario: 不支援跨節點的服務相依操作
    Given 管理員希望先重啟 Node-A 的 DB 再重啟 Node-B 的 App
    When 管理員嘗試一次性的跨節點編排操作
    Then 系統不提供跨節點服務相依操作
    And 管理員需手動依序在兩個節點分別執行

  # ══════════════════════════════════════════════════════════════
  # 商業規則 — 對應 IF 第 7 節驗收檢查清單
  # ══════════════════════════════════════════════════════════════

  @api @business-rules @error-handling @p0 @security
  Scenario Outline: 節點相關 API 未登入時回傳 401
    Given 客戶端未登入且未攜帶有效驗證資訊
    When 客戶端發送 <http_method> 請求至 <endpoint>
    Then Auth middleware 攔截請求
    And 後端回傳 HTTP 401 Unauthorized

    Examples:
      | http_method | endpoint                                  |
      | GET         | /api/v1/nodes                             |
      | POST        | /api/v1/nodes                             |
      | GET         | /api/v1/nodes/1                           |
      | PUT         | /api/v1/nodes/1                           |
      | DELETE      | /api/v1/nodes/1                           |
      | POST        | /api/v1/nodes/test-connection             |
      | GET         | /api/v1/nodes/summary                     |
      | GET         | /api/v1/nodes/1/services                  |
      | GET         | /api/v1/nodes/services/search?q=nginx     |

  @business-rules @p1 @data
  Scenario: Node registry 持久化於磁碟且重啟後保留
    Given 管理員已註冊節點「web-server-01」
    When Manager 重新啟動
    Then 所有節點設定於重啟後保留
    And Manager 依 registry 自動重連各節點

  @business-rules @p1 @data
  Scenario: 移除節點時保留其歷史資料與 Audit Log
    Given 節點「web-server-01」存在歷史 Audit Log 紀錄
    When 管理員移除該節點
    Then 節點註冊被移除
    And 歷史資料與 Audit Log 紀錄仍保留

  @business-rules @p1 @audit
  Scenario: 跨節點操作記錄包含 node_id 與 node_name
    Given 管理員對節點「web-server-01」的 nginx.service 執行重啟
    When Audit Log 寫入操作紀錄
    Then 紀錄包含 action、node_id 與 node_name 欄位
    And 可追溯操作發生在哪個節點

  @agent @business-rules @p1
  Scenario: Agent 離線時本地服務操作仍可透過直接存取 Agent 執行
    Given 節點「web-server-01」離線且與 Manager 斷連
    When 管理員直接存取該節點上的 Agent
    Then Agent 仍提供完整 JSON API（與單機 Manager 相同，僅無前端）
    And 管理員可在該節點本地執行服務操作

  @agent @business-rules @p1 @security
  Scenario: Agent 支援 Token 驗證來自 Manager 的請求
    Given Agent 設定檔包含 auth_token
    When Manager 發送請求至 Agent
    Then Agent 驗證請求攜帶正確 Token
    And Token 無效的請求被拒絕

  # ══════════════════════════════════════════════════════════════
  # 整合 — 對應 IF 第 7 節整合驗收清單
  # ══════════════════════════════════════════════════════════════

  @integration @p0 @smoke
  Scenario Outline: Manager + 1 Agent 完成「<action>」服務管理流程
    Given Manager 已註冊節點「web-server-01」且 Agent 上線
    When 管理員透過 Aggregate Dashboard 切換至該節點並執行 <action>
    Then Agent 在目標機器執行對應 systemctl 操作
    And 服務狀態正確回傳並顯示於前端
    And Audit Log 記錄該操作

    Examples:
      | action  |
      | start   |
      | stop    |
      | restart |
      | enable  |
      | disable |

  @integration @p0 @smoke
  Scenario: Manager + 1 Agent 完成日誌查詢流程
    Given Manager 已註冊節點「web-server-01」且 Agent 上線
    When 管理員在單節點視圖檢視 nginx.service 日誌
    Then Manager 代理請求至 Agent
    And 日誌內容顯示於日誌檢視器

  @integration @p1
  Scenario: Manager + 3 Agents 時 Aggregate Dashboard 正確顯示所有節點
    Given Manager 已註冊 3 個 Agent 節點且全部上線
    When 管理員載入 Aggregate Dashboard
    Then Dashboard 顯示 3 張節點 Cards
    And 頂部統計列顯示總節點數 3、線上台數 3、離線台數 0
    And 各節點服務統計與最後心跳皆正確顯示

  @integration @p1 @offline
  Scenario: Agent 離線 → Dashboard 更新 → Agent 恢復 → Dashboard 恢復
    Given Manager + 1 Agent 環境運作中
    When Agent 停止發送心跳 30 秒
    Then Dashboard 即時更新該節點為 🔴 離線
    When Agent 重新啟動並恢復心跳
    Then Dashboard 即時更新該節點為 🟢 線上
    And 整個過程無需管理員手動操作或重整頁面

  @integration @p1 @restart
  Scenario: Manager 重啟後所有 Agent 自動重連
    Given Manager + 多個 Agent 環境運作中
    When Manager 重新啟動
    Then 各 Agent 依設定自動重連 Manager
    And 連線成功的節點狀態自動恢復為 🟢 線上
    And 30 秒啟動寬限期內不觸發離線通知

  @integration @p1 @tls
  Scenario Outline: TLS 憑證 <cert_status> 時通訊<outcome>
    Given Manager 與 Agent 使用 TLS 通訊
    And Agent 端憑證 <cert_status>
    When 雙方建立連線
    Then <outcome>

    Examples:
      | cert_status  | outcome                                            |
      | 有效         | 連線成功且正常收發心跳與服務操作                   |
      | 無效/過期    | 連線被正確拒絕並提示 TLS 驗證錯誤                  |

  @integration @p1 @websocket
  Scenario: WebSocket 斷線後自動重連並恢復即時更新
    Given 管理員瀏覽器已開啟 Aggregate Dashboard
    And WebSocket 連線中斷
    When 瀏覽器偵測到斷線
    Then 自動重連 WebSocket
    And 重連成功後恢復節點狀態即時更新
