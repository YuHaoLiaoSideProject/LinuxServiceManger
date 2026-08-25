# 014 - multi-node-agent-management（多機管理 Agent 模式）
# 上游文件：docs/interaction-flows/014-multi-node-agent-management.md
# 對應 Roadmap：docs/development/002-expansion-roadmap.md 項目 #12（Phase 4）
#
# 情境追溯說明：
#   - 「流程 3.x」對應 Interaction Flow 第 3 節 mermaid 流程圖
#   - 「步驟 N」對應 Interaction Flow 第 4 節逐步互動說明
#   - 「異常 R」對應 Interaction Flow 第 5 節異常處理表第 N 列
#   - 「規則 B」對應 Interaction Flow 第 6 節邊界與限制表第 N 列

@014 @multi-node-agent-management @regression
Feature: 多機管理 Agent 模式
  作為一個已登入的管理員
  我希望透過單一 Manager 主控面板管理多台 Linux 機器的 systemd 服務
  以便在同一操作介面掌握整個基礎設施的服務狀態，不需在每台機器分別開啟管理介面

  Background:
    Given 管理員已登入 Manager
    And Manager 服務已啟動
    And 以下節點已在 Node Registry 註冊並上線：
      | name           | hostname        | agentAddress          | status |
      | web-server-01  | web01.corp.lan  | 10.0.0.11:8443        | online |
      | db-server-01   | db01.corp.lan   | 10.0.0.12:8443        | online |

  # ============================================================
  # 主流程：Aggregate Dashboard（流程 3.1 / 步驟 1）
  # ============================================================

  @smoke @p0
  Scenario: 登入後預設進入 Aggregate Dashboard（流程 3.1 / 步驟 1）
    When 管理員登入成功後導航至 Dashboard
    Then 系統載入 Aggregate Dashboard 匯總視圖
    And 頂部統計列顯示「總節點數 2」「線上台數 2」「離線台數 0」
    And 頂部統計列顯示匯總服務統計「總服務數」「執行中」「失敗」
    And 中間以 Node Cards 網格顯示每個節點
    And 每張 Node Card 顯示節點名稱 "web-server-01"、Hostname "web01.corp.lan"
    And 每張 Node Card 顯示狀態指示燈 🟢 線上
    And 每張 Node Card 顯示服務摘要（M/N 執行中）、最後心跳時間與 CPU/Memory 簡要指標

  @p1 @edge-case
  Scenario: 尚無任何註冊節點時顯示空狀態引導（步驟 1 狀態變化）
    Given Node Registry 中沒有任何已註冊節點
    When 管理員登入成功後導航至 Dashboard
    Then Aggregate Dashboard 顯示空狀態訊息「尚無已註冊節點，請先新增節點」
    And 提供前往 Node Management 頁面的引導入口

  # ============================================================
  # 主流程：節點切換（流程 3.1 / 步驟 2）
  # ============================================================

  @smoke @p0
  Scenario Outline: 從 Aggregate Dashboard 點擊 Node Card 切換至單節點視圖（流程 3.1 / 步驟 2）
    Given 管理員在 Aggregate Dashboard 檢視所有節點
    When 管理員點擊節點 "<name>" 的 Node Card
    Then URL 變更為 "/dashboard?node=<nodeId>"
    And Header 顯示「目前節點：<name>」與節點切換下拉選單
    And Header 提供「所有節點」返回按鈕
    And 畫面顯示單節點 Dashboard，服務列表僅列出節點 "<name>" 的 systemd 服務

    Examples:
      | name          | nodeId |
      | web-server-01 | 1      |
      | db-server-01  | 2      |

  @p1
  Scenario: 從 Header 節點下拉選單切換至其他節點（流程 3.1 NodeDropdown）
    Given 管理員正在檢視節點 "web-server-01" 的單節點視圖
    When 管理員點擊 Header 的節點下拉選單並選取節點 "db-server-01"
    Then 畫面切換至節點 "db-server-01" 的單節點視圖
    And 服務列表改為顯示節點 "db-server-01" 的服務
    And Header 中目前節點名稱更新為 "db-server-01"

  @p1
  Scenario: 點擊「所有節點」按鈕返回 Aggregate Dashboard（流程 3.1 BackAgg）
    Given 管理員正在檢視節點 "web-server-01" 的單節點視圖
    When 管理員點擊 Header 的「所有節點」按鈕
    Then 畫面返回 Aggregate Dashboard
    And 重新顯示所有節點的 Node Cards 網格與匯總統計列

  # ============================================================
  # 主流程：單節點服務操作（流程 3.1 ServiceMgmt / 步驟 3）
  # ============================================================

  @smoke @p0
  Scenario Outline: 在單節點視圖操作目標節點的服務（步驟 3）
    Given 管理員正在檢視節點 "web-server-01" 的單節點視圖
    And 該節點上有服務 "nginx.service"
    When 管理員點擊服務 "nginx.service" 的 "<action>" 操作按鈕
    Then 操作按鈕顯示 loading spinner 直到操作完成
    And Manager 將請求代理至節點 "web-server-01" 的 Agent 執行 systemctl <action>
    And Toast 顯示「[web-server-01] nginx.service 已<actionLabel>」
    And 服務列表該列狀態依操作結果更新
    And Audit Log 新增一筆紀錄，包含 action 與 node_id "1"

    Examples:
      | action   | actionLabel |
      | start    | 啟動         |
      | stop     | 停止         |
      | restart  | 重啟         |
      | enable   | 設定開機啟動  |
      | disable  | 取消開機啟動  |

  @p1
  Scenario: 在單節點視圖查看該節點的服務日誌（流程 3.1 ServiceMgmt）
    Given 管理員正在檢視節點 "web-server-01" 的單節點視圖
    When 管理員點擊服務 "nginx.service" 的日誌檢視
    Then Manager 代理日誌查詢至節點 "web-server-01" 的 Agent
    And 日誌檢視器顯示節點 "web-server-01" 上 "nginx.service" 的 journalctl 日誌內容

  @p1
  Scenario: 服務操作失敗時顯示錯誤原因（步驟 3 操作後）
    Given 管理員正在檢視節點 "web-server-01" 的單節點視圖
    And 節點 "web-server-01" 上的 Agent 回報操作失敗
    When 管理員點擊服務 "nginx.service" 的 restart 操作按鈕
    Then Toast 顯示「[web-server-01] nginx.service 重啟失敗：權限不足」
    And 服務狀態維持操作前的狀態

  @p2 @business-rules
  Scenario: 同一節點同一服務不允許並行操作（規則 B4 並行操作限制）
    Given 管理員正在檢視節點 "web-server-01" 的單節點視圖
    And 服務 "nginx.service" 的前一個操作尚未完成
    When 管理員檢視服務 "nginx.service" 的操作按鈕
    Then 操作按鈕保持 disabled 狀態
    But 其他節點的服務操作不受影響且可並行執行

  # ============================================================
  # 子流程：新增節點（流程 3.2 / 步驟 4-6）
  # ============================================================

  @p1
  Scenario: 開啟新增節點表單 Modal（流程 3.2 FormModal / 步驟 4）
    Given 管理員從 Header 導航至 Node Management 頁面
    And 頁面顯示已註冊節點列表（名稱/位址/狀態/最後心跳/操作）
    When 管理員點擊「新增節點」按鈕
    Then 彈出新增節點表單 Modal
    And 表單包含必填欄位「節點名稱」與「Agent 位址（host:port）」
    And 表單包含選填欄位「TLS 憑證指紋」「API Token」「備註」
    And Modal 底部提供「測試連線」「註冊」「取消」按鈕

  @p1
  Scenario: 測試 Agent 連線成功（流程 3.2 TestResult 成功 / 步驟 5）
    Given 管理員已開啟新增節點表單 Modal
    And 已填寫 Agent 位址 "10.0.0.13:8443"
    When 管理員點擊「測試連線」按鈕
    Then 測試按鈕顯示 loading，Manager 向 Agent 位址發送健康檢查請求
    And Modal 內顯示綠色提示「連線成功」
    And 顯示 Agent 版本、主機名稱與系統資訊（如 "Agent v1.2.3 @ app03 (Ubuntu 22.04)"）
    And Modal 保持開啟讓管理員繼續填寫表單

  @p1 @edge-case
  Scenario: 測試 Agent 連線失敗可修正後重試（流程 3.2 TestResult 失敗 / 步驟 5）
    Given 管理員已開啟新增節點表單 Modal
    And 已填寫錯誤的 Agent 位址 "10.0.0.99:8443"
    When 管理員點擊「測試連線」按鈕
    Then Modal 內顯示紅色提示「無法連線：connection refused」
    And Modal 保持開啟，管理員可修改位址後重新點擊「測試連線」

  @p1
  Scenario: 表單驗證通過後完成節點註冊且 Agent 可達（流程 3.2 RegOK / 步驟 6）
    Given 管理員已開啟新增節點表單 Modal
    And 已填寫節點名稱 "app-server-01" 與 Agent 位址 "10.0.0.13:8443"
    When 管理員點擊「註冊」按鈕
    Then Manager 將節點設定儲存至 Node Registry
    And Manager 主動建立與 Agent 的持久連線並開始接收心跳
    And Modal 關閉，節點列表更新且新節點出現
    And 新節點狀態顯示 🟢 線上
    And Toast 通知「節點 app-server-01 已註冊並上線」
    And Aggregate Dashboard 的總節點數加 1

  @p1 @edge-case
  Scenario: 註冊時 Agent 無法連線仍儲存節點但標示離線（流程 3.2 ConnErr / 步驟 6）
    Given 管理員已開啟新增節點表單 Modal
    And 已填寫節點名稱 "backup-server-01" 與暫時不可達的 Agent 位址 "10.0.0.20:8443"
    When 管理員點擊「註冊」按鈕
    Then Manager 儲存節點設定至 Node Registry
    And 節點列表更新且新節點出現，狀態顯示 🔴 離線
    And Toast 通知「節點 backup-server-01 已註冊但無法連線」

  @p2
  Scenario: 點擊「取消」關閉新增節點表單（流程 3.2 取消分支）
    Given 管理員已開啟新增節點表單 Modal 且已填寫部分欄位
    When 管理員點擊「取消」按鈕
    Then Modal 關閉且未建立任何節點記錄
    And 畫面返回 Node Management 節點列表

  # ============================================================
  # 子流程：Agent 部署與上線（流程 3.3）
  # ============================================================

  @p1
  Scenario: 下載 Agent binary 供部署使用（流程 3.3 Download）
    Given 管理員在 Node Management 頁面
    When 管理員點擊「下載 Agent」按鈕並選擇目標架構 "<arch>"
    Then 瀏覽器下載對應架構的 Agent binary "agent-linux-<arch>"

    Examples:
      | arch   |
      | amd64  |
      | arm64  |

  @p0
  Scenario: Agent 部署後向 Manager 註冊並開始心跳（流程 3.3 AgentBoot 至 AggUpdate）
    Given 管理員已在目標 Linux 機器部署 Agent binary 並完成設定檔（manager_addr、auth_token、node_name）
    When Agent 在目標機器上啟動
    Then Agent 讀取設定檔並連接 Manager
    And Agent 發送註冊請求（node_name、hostname、version）
    And Manager 比對 node_name 與既有記錄，將節點狀態更新為「線上」並記錄上線時間
    And Agent 以每 10 秒一次的間隔定期發送心跳（規則 B2）
    And Manager 推送節點狀態更新至所有已連線的 Web UI

  # ============================================================
  # 子流程：心跳離線 / 恢復 / 長期離線（流程 3.4 / 步驟 9）
  # ============================================================

  @smoke @p0 @business-rules
  Scenario: 心跳中斷超過 30 秒觸發離線偵測（流程 3.4 Detect / 步驟 9 / 規則 B2）
    Given 節點 "web-server-01" 狀態為 🟢 線上
    When Agent 心跳中斷且連續 30 秒（3 次）未收到心跳
    Then Manager 將節點 "web-server-01" 狀態變更為 🔴 離線
    And Aggregate Dashboard 該節點 Card 狀態指示燈變紅、服務統計灰顯
    And Card 顯示「最後心跳：X 秒前」相對時間
    And Header 統計列更新：線上台數減 1、離線台數加 1
    And 若管理員正在檢視則 Toast 通知「web-server-01 已離線」

  @p0
  Scenario: 節點離線時單節點視圖的操作全部禁用（流程 3.4 UIUpdate / 步驟 9）
    Given 管理員正在檢視節點 "web-server-01" 的單節點視圖
    When 節點 "web-server-01" 因心跳中斷轉為離線
    Then 服務列表的所有操作按鈕（start/stop/restart/enable/disable）全部禁用
    And 頂部顯示黃色 Banner「節點已離線，操作不可用」

  @p1 @business-rules
  Scenario: 寬限期內恢復心跳自動回到線上（流程 3.4 ReOnline / 規則 B2）
    Given 節點 "web-server-01" 狀態為 🔴 離線
    And 離線持續時間尚在 300 秒寬限期內
    When Agent 心跳恢復
    Then 節點狀態回到 🟢 線上
    And Toast 通知「web-server-01 已恢復連線」
    And 重新載入該節點的服務狀態

  @p1 @business-rules
  Scenario: 超過 300 秒寬限期標示為長期離線（流程 3.4 LongOff / 規則 B2）
    Given 節點 "web-server-01" 狀態為 🔴 離線
    When 連續 300 秒（5 分鐘）未收到心跳
    Then 節點狀態標示為 ⚫ 長期離線
    And Aggregate Dashboard 中該節點卡片移至網格底部或摺疊顯示

  @p1
  Scenario: 查看離線節點資訊面板（流程 3.4 OffDetail）
    Given 節點 "web-server-01" 狀態為 🔴 離線或 ⚫ 長期離線
    When 管理員點擊離線節點 "web-server-01" 的 Node Card
    Then 顯示離線節點資訊面板，包含：
      | 欄位       | 說明                       |
      | 最後上線時間 | 最後一次線上的時間           |
      | 最後心跳時間 | 最後一次收到心跳的時間        |
      | 離線持續時間  | 自離線起算的經過時間         |
      | Agent 版本  | 最後回報的版本號            |
      | Hostname  | web01.corp.lan       |
    And 面板顯示操作建議「檢查 Agent 是否執行」
    And 面板提供「重新連線」與「移除節點」按鈕

  # ============================================================
  # 子流程：移除節點（流程 3.4 RemoveNode）
  # ============================================================

  @smoke @p1
  Scenario: 經確認對話框移除節點（流程 3.4 RemoveNode / DoRemove）
    Given 節點 "db-server-01" 存在於 Node Registry
    When 管理員點擊「移除節點」
    Then 顯示確認對話框「確定要移除此節點？所有歷史資料將保留。」
    When 管理員點擊確認
    Then Manager 移除節點 "db-server-01" 的註冊
    And 該節點從 Aggregate Dashboard 與節點列表消失
    And Toast 通知「節點已移除」
    And Aggregate Dashboard 的總節點數減 1

  # ============================================================
  # ⛔ REMOVED（2025-08-25）：跨節點服務搜尋已移出功能範圍（純切換模式決策，
  # 見 docs/uiux/014-multi-node-view-redesign.md），以下 Scenario 降為 @deferred，
  # 移入未來 backlog。保留供日後重新啟用時追溯。
  # ============================================================

  @deferred
  Scenario: 跨節點搜尋服務並彙總結果（步驟 7）
    Given 管理員在 Aggregate Dashboard
    And 節點 "web-server-01" 與 "db-server-01" 皆為線上
    And 兩個節點上皆有服務 "nginx.service"
    When 管理員在搜尋框輸入 "nginx"（debounce 300ms 後送出查詢）
    Then Manager 向所有線上 Agent 並行查詢匹配的服務並彙總結果
    And 搜尋結果列表顯示每一筆的節點名稱、匹配的服務名稱與服務狀態
    And 結果包含 "web-server-01 / nginx.service" 與 "db-server-01 / nginx.service"

  @deferred
  Scenario: 點擊搜尋結果跳轉至該節點並展開服務（步驟 7）
    Given 搜尋結果列表已顯示跨節點搜尋結果
    When 管理員點擊結果 "web-server-01 / nginx.service"
    Then 畫面跳轉至節點 "web-server-01" 的單節點視圖
    And 自動展開服務 "nginx.service"

  @deferred @edge-case
  Scenario: 搜尋無匹配結果時顯示空狀態（步驟 7）
    Given 管理員在 Aggregate Dashboard
    When 管理員在搜尋框輸入不存在的服務名稱 "nonexistent-svc"
    Then 搜尋結果顯示「沒有找到匹配的服務」

  @deferred @edge-case
  Scenario: 關閉搜尋結果返回 Card 視圖（步驟 7 狀態變化）
    Given 搜尋結果列表已顯示跨節點搜尋結果
    When 管理員關閉搜尋結果
    Then Dashboard 返回 Node Cards 網格視圖

  # ============================================================
  # 主流程：節點詳細資訊（流程 3.1 NodeDetail / 步驟 8）
  # ============================================================

  @p2
  Scenario: 查看節點詳細資訊面板（流程 3.1 NodeDetail / 步驟 8）
    When 管理員點擊節點 "web-server-01" 的 Node Card「詳情」按鈕
    Then 開啟側面板並由 Agent 回傳系統資訊
    And 面板顯示節點名稱、Hostname、Agent 版本、OS 資訊、上線時長、最後心跳
    And 面板顯示 CPU/Memory/Disk 資源使用概覽
    And 面板底部提供「重新連線」「編輯設定」「移除節點」操作按鈕

  # ============================================================
  # 異常處理（Interaction Flow 第 5 節）
  # ============================================================

  @regression @edge-case @p1
  Scenario: Agent 服務掛掉導致心跳中斷（異常 R1 / 流程 3.4）
    Given 管理員正在檢視節點 "web-server-01" 的單節點視圖
    When 節點 "web-server-01" 上的 Agent 服務掛掉導致心跳中斷超過 30 秒
    Then 節點 Card 狀態指示燈轉為 🔴 離線
    And 服務列表操作按鈕禁用且頂部顯示黃色 Banner「節點已離線」
    And Toast 通知「web-server-01 已離線」
    When 管理員在目標機器上重啟 Agent
    Then Agent 重新連線後節點狀態自動恢復為線上
    And Toast 通知「已恢復連線」

  @regression @edge-case @p1 @business-rules
  Scenario: 網路中斷於寬限期內恢復時無縫回復（異常 R2 / 規則 B2）
    Given 節點 "web-server-01" 狀態為 🟢 線上
    When Manager 與 Agent 間的網路中斷導致心跳逾時，節點轉為離線
    And 網路在 300 秒寬限期內恢復
    Then Agent 自動重連，節點狀態無縫回復為 🟢 線上

  @regression @edge-case @p1 @business-rules
  Scenario: 網路中斷超過寬限期需手動檢查（異常 R2 / 規則 B2）
    Given 節點 "web-server-01" 因網路中斷轉為離線
    When 網路在超過 300 秒寬限期後才恢復
    Then 節點標示為 ⚫ 長期離線
    And Agent 重連後管理員需確認節點狀態恢復

  @regression @edge-case @p1 @business-rules
  Scenario: 服務操作逾時 15 秒後提示並可重試（異常 R3 / 規則 B3 操作逾時）
    Given 管理員正在檢視節點 "web-server-01" 的單節點視圖
    And 節點 "web-server-01" 的 Agent 回應緩慢
    When 管理員點擊服務 "nginx.service" 的 restart 操作按鈕
    Then 操作按鈕顯示 loading spinner
    And 超過 15 秒（含 Manager → Agent 來回）未收到回應時操作逾時
    And Toast 顯示「[web-server-01] 操作逾時：nginx.service restart」
    And 管理員可重試操作

  @deferred @edge-case @business-rules
  Scenario: 跨節點搜尋部分節點失敗不阻塞其他結果（異常 R4 / 規則 B3 搜尋逾時）
    Given 管理員在 Aggregate Dashboard
    And 節點 "web-server-01" 線上、"db-server-01" 離線
    When 管理員在搜尋框輸入 "nginx" 進行跨節點搜尋
    And 搜尋總耗時接近 10 秒總逾時上限
    Then 搜尋結果僅顯示節點 "web-server-01" 的匹配項目
    And 離線節點 "db-server-01" 旁標示「無法查詢」
    And 其他節點的結果不被阻塞而先回傳顯示

  @regression @edge-case @p1
  Scenario: TLS 憑證過期導致測試連線失敗（異常 R5）
    Given 管理員已開啟新增節點表單 Modal
    And 目標 Agent 端的 TLS 憑證已過期
    When 管理員點擊「測試連線」按鈕
    Then 顯示紅色提示「TLS 憑證驗證失敗：certificate expired」

  @regression @edge-case @p1
  Scenario: 已註冊節點憑證過期後標示為離線（異常 R5）
    Given 節點 "web-server-01" 已註冊且狀態為 🟢 線上
    When 節點端 TLS 憑證過期使 Manager 無法連線
    Then 節點 "web-server-01" 標示為 🔴 離線
    When 管理員更新 Agent 端 TLS 憑證並在 Manager 更新指紋後重新連線
    Then 節點恢復連線並回到線上狀態

  @regression @edge-case @p2 @business-rules
  Scenario: Manager 重啟後有 30 秒啟動寬限期並自動重連所有 Agent（異常 R6 / 驗收清單）
    Given Manager 管理多個已註冊的 Agent 節點
    When Manager 服務重啟
    Then Aggregate Dashboard 所有節點短暫顯示為離線
    And Manager 啟動時依 Node Registry 逐一重新連接所有已註冊 Agent
    And Manager 重啟後 30 秒內不觸發任何離線通知（啟動寬限期）
    And 各 Agent 連線成功後節點狀態自動恢復

  @regression @edge-case @p2
  Scenario: 同一 Agent 被第二個 Manager 註冊時被拒絕（異常 R7）
    Given Agent 已接受第一個 Manager 的連線
    When 第二個 Manager 嘗試連線同一 Agent
    Then 第二個 Manager 的連線被拒絕
    And 第二個 Manager 上該節點顯示為離線
    And 修復方式為確認 Agent 設定檔中的 manager_addr 指向唯一 Manager

  @regression @edge-case @p1
  Scenario: 節點名稱重複註冊被拒絕（異常 R8 / 流程 3.2 DupErr / 驗收清單唯一性檢查）
    Given Node Registry 已存在節點 "web-server-01"
    When 管理員在新增節點表單填入名稱 "web-server-01" 並點擊「註冊」
    Then Toast 顯示「節點名稱重複，請使用不同名稱」
    And 表單保持開啟，管理員修改名稱後可重新送出

  @regression @edge-case @p2
  Scenario: Agent 版本不相容時顯示警告狀態（異常 R9 / 通訊層版本相容性檢查）
    Given 節點 "legacy-node-01" 的 Agent 版本為 v1.0
    When Manager 與該 Agent 建立連線並檢查版本
    Then 節點顯示 🟡 警告狀態
    And Tooltip 提示「Agent 版本過舊 (v1.0)，建議升級至 v1.2+」
    And 管理員可下載新版 Agent binary 部署至目標機器升級

  @regression @edge-case @p1
  Scenario: 必填欄位缺失時表單驗證不通過（流程 3.2 ShowValidation）
    Given 管理員已開啟新增節點表單 Modal
    And 節點名稱或 Agent 位址等必填欄位留空
    When 管理員點擊「註冊」按鈕
    Then 缺漏的必填欄位標示紅色提示
    And 不發送註冊請求

  # ============================================================
  # 業務規則（Interaction Flow 第 6 節）
  # ============================================================

  @business-rules @p2
  Scenario: 節點數達到上限 50 台（規則 B1 最大節點數）
    Given Node Registry 已註冊 50 個 Agent 節點
    When 管理員嘗試再註冊第 51 個節點
    Then 系統提示已達單實例支援的最大節點數 50 台
    And 註冊被拒絕

  @business-rules @p1
  Scenario: 心跳間隔與離線判定閾值（規則 B2）
    Given 節點 "web-server-01" 狀態為 🟢 線上
    Then Agent 每 10 秒發送一次心跳
    And Manager 收到心跳時更新 last_heartbeat
    And 連續 30 秒（3 次心跳週期）未收到心跳時節點標示為離線
    And 連續 300 秒未收到心跳時節點標示為長期離線

  @business-rules @p1
  Scenario: Manager 與 Agent 通訊強制 TLS 且可選 mTLS（規則 B5）
    When Manager 與任一 Agent 建立連線
    Then 通訊使用 TLS 加密
    And 未提供有效 TLS 憑證的連線被拒絕
    And 當啟用 mTLS 時雙方互相驗證憑證（Agent 驗證 Manager + Manager 驗證 Agent）

  @business-rules @p1
  Scenario: 連線失敗時以指數退避自動重試（驗收清單 — 通訊層）
    Given Manager 與節點 "backup-server-01" 的連線失敗
    When Manager 嘗試重建連線
    Then Manager 以 exponential backoff 自動重試
    And Agent 恢復可用後連線自動建立

  @business-rules @p2
  Scenario: 服務狀態即時代理查詢不做本地快取（規則 B8 資料一致性）
    Given 節點 "web-server-01" 為線上
    When 前端查詢該節點的服務列表
    Then Manager 即時代理請求至 Agent 並回傳 Agent 的回應
    And Manager 不回傳本地快取的服務狀態
    And Aggregate Dashboard 的摘要數據來自各節點最後一次心跳附帶的服務統計

  @business-rules @p2
  Scenario: 不支援跨節點服務相依編排需手動依序執行（規則 B9 跨節點操作）
    Given 管理員需要先重啟節點 "db-server-01" 的 DB 再重啟節點 "web-server-01" 的 App
    When 管理員檢視系統提供的操作能力
    Then 系統不提供跨節點的服務相依批次編排功能
    And 管理員需分別在各節點視圖手動依序執行操作

  @business-rules @p1
  Scenario: Audit Log 記錄跨節點操作含節點資訊（規則 B10 Audit Log）
    Given 管理員在節點 "web-server-01" 的單節點視圖
    When 管理員執行服務 "nginx.service" 的 restart 操作
    Then Audit Log 新增一筆紀錄
    And 紀錄包含 node_id 與 node_name 欄位，可追溯操作發生在哪個節點

  @business-rules @p2
  Scenario: Node Registry 持久化於 Manager 重啟後保留（驗收清單 — Node Registry）
    Given Node Registry 已註冊節點 "web-server-01" 與 "db-server-01"
    When Manager 服務重啟完成
    Then 所有節點設定（名稱、位址、TLS 設定、Token）保留不遺失

  @business-rules @p2
  Scenario: 管理員經 Manager 代理授權存取 Agent（規則 B7 認證模型）
    Given 管理員已登入 Manager
    And Manager 已設定向 Agent 驗證用的 Token 或 mTLS 憑證
    When 管理員對節點 "web-server-01" 執行服務操作
    Then Manager 使用預先設定的 Token 或 mTLS 憑證向該 Agent 驗證
    And Agent 不直接驗證管理員身分，信任 Manager 的代理授權

  # ============================================================
  # WebSocket 即時更新（驗收清單 — 前端 WebSocket）
  # ============================================================

  @p1
  Scenario: 節點狀態變更即時推送至 Dashboard（驗收清單 — WebSocket）
    Given 管理員的瀏覽器已連線至 Manager 的 Web UI
    When 任一節點狀態變更（上線/離線）
    Then Manager 透過 WebSocket 推送事件至前端
    And Aggregate Dashboard 無需重整頁面即更新該節點 Card 與統計列

  @p2
  Scenario: 節點新增或移除即時更新且斷線自動重連（驗收清單 — WebSocket）
    Given 管理員的瀏覽器已連線至 Manager 的 Web UI
    When 另一個管理階段作業新增或移除節點
    Then 前端無需重整頁面即更新節點列表
    And WebSocket 斷線時前端自動重連
