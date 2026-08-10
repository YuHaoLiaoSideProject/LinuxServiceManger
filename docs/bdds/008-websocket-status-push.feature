@websocket @real-time @status-push @dashboard
Feature: WebSocket 即時狀態推送
  作為一個已登入的管理員
  我希望 Dashboard 透過 WebSocket 自動接收服務狀態變更推送
  以便不需手動重整就能看到「活的」儀表板，即時掌握服務 crash 或 recovery 狀況

  Background:
    Given 我已登入系統
    And 服務列表已載入完成
    And Header 區域顯示 WebSocket 連線狀態指示器

  # ============================================================
  # Happy Path — WebSocket 連線生命週期
  # ============================================================

  @smoke @happy-path @p0 @connection
  Scenario: 登入 Dashboard 後自動建立 WebSocket 連線
    When 我登入並進入 Dashboard
    Then Dashboard 自動發起 WebSocket 連線至 wss://host/api/v1/ws
    And Header 連線指示器顯示「🔗 已連線」綠色狀態

  @happy-path @p0 @connection
  Scenario: 登出或關閉分頁時正確關閉 WebSocket 連線
    Given WebSocket 已連線且指示器顯示「🔗 已連線」
    When 我登出系統或關閉瀏覽器分頁
    Then WebSocket 連線正確關閉
    And 後端釋放該客戶端資源

  # ============================================================
  # Happy Path — 服務狀態自動更新（外部變更）
  # ============================================================

  @smoke @happy-path @p0 @status-change
  Scenario: 外部 systemctl 停止服務時 Dashboard 即時更新
    Given WebSocket 已連線
    And 服務列表顯示 nginx.service 狀態為 active/running
    When 管理員在 SSH 終端執行 systemctl stop nginx
    Then 後端透過 WebSocket 推送 status_change 訊息
    And Dashboard 中 nginx.service 列即時更新為 inactive/dead
    And 狀態 dot 從綠色變為灰色
    And 該服務列閃爍 0.5s 灰色 highlight 動畫

  @smoke @happy-path @p0 @status-change
  Scenario: 服務 crash 時 Dashboard 即時顯示 failed 狀態
    Given WebSocket 已連線
    And 服務列表顯示某服務狀態為 active/running
    When 該服務因 crash 變為 failed 狀態
    Then 後端推送 status_change 訊息含 active=failed
    And Dashboard 中該服務列即時更新為 failed
    And 狀態 dot 從綠色變為紅色
    And 該服務列閃爍 0.5s 紅色 highlight 動畫

  @happy-path @p1 @status-change
  Scenario: 服務從 failed 恢復為 running 時即時反映
    Given WebSocket 已連線
    And 服務列表顯示某服務狀態為 failed
    When 該服務自動恢復或手動 restart 成功變為 running
    Then 後端推送 status_change 訊息含 active=active
    And Dashboard 中該服務列即時更新為 active/running
    And 狀態 dot 從紅色變為綠色

  # ============================================================
  # Happy Path — 服務狀態自動更新（自身操作）
  # ============================================================

  @smoke @happy-path @p0 @self-operation
  Scenario: Dashboard 內執行 Stop 後單列更新不重整整個列表
    Given WebSocket 已連線
    And 服務列表已載入
    When 我在 Dashboard 點擊 Stop 停止 nginx.service
    And 後端回應操作成功
    Then 後端推送 status_change 訊息給所有 WebSocket 客戶端
    And Dashboard 中 nginx.service 列即時更新為 inactive
    And 系統不重新 fetch 整個服務列表（不呼叫 GET /api/v1/services）
    And Toast 顯示操作成功通知

  @happy-path @p0 @self-operation
  Scenario: Dashboard 內執行 Start 後單列更新
    Given WebSocket 已連線
    And 服務列表顯示 nginx.service 狀態為 inactive
    When 我在 Dashboard 點擊 Start 啟動 nginx.service
    Then 後端推送 status_change 訊息
    And nginx.service 列即時更新為 active/running
    And 不重新 fetch 整個列表

  @happy-path @p0 @self-operation
  Scenario: Dashboard 內執行 Restart 後單列更新
    Given WebSocket 已連線
    And 服務列表顯示 nginx.service 狀態為 active/running
    When 我在 Dashboard 點擊 Restart 重啟 nginx.service
    Then 後端推送 status_change 訊息（可能含 active=deactivating 再 active=active）
    And nginx.service 列最終更新為 active/running
    And 不重新 fetch 整個列表

  @happy-path @p0 @self-operation
  Scenario: enable/disable 操作後 UnitFileState 即時更新
    Given WebSocket 已連線
    And 服務列表顯示 nginx.service 的 UnitFileState 為 enabled
    When 我在 Dashboard 點擊 Toggle 將 nginx.service 設為 disabled
    Then 後端推送 status_change 訊息含 unitFileState=disabled
    And nginx.service 列的 Toggle 開關即時反映為 disabled 狀態
    And 不重新 fetch 整個列表

  # ============================================================
  # Happy Path — 服務新增 / 移除通知
  # ============================================================

  @happy-path @p1 @service-added
  Scenario: 系統新增 service unit 時 Dashboard 插入新列並通知
    Given WebSocket 已連線
    When 系統中新增一個 service unit file 並執行 systemctl daemon-reload
    Then 後端推送 service_added 訊息含新服務資訊
    And 服務列表插入新服務列
    And Toast 顯示「偵測到新服務：xxx.service」

  @happy-path @p1 @service-removed
  Scenario: 系統移除 service unit 時 Dashboard 移除該列並通知
    Given WebSocket 已連線
    When 系統中移除一個 service unit file 並執行 systemctl daemon-reload
    Then 後端推送 service_removed 訊息含被移除的服務名稱
    And 服務列表移除對應服務列
    And Toast 顯示「服務已移除：xxx.service」

  # ============================================================
  # Happy Path — Heartbeat
  # ============================================================

  @happy-path @p1 @heartbeat
  Scenario: 後端每 30 秒發送 heartbeat 維持連線
    Given WebSocket 已連線
    When 30 秒內無任何狀態變更
    Then 後端發送 heartbeat 訊息
    And Dashboard 更新「最後更新時間」但不觸發列表變更

  # ============================================================
  # Happy Path — 手動重整保留
  # ============================================================

  @happy-path @p0 @manual-refresh
  Scenario: 手動重整按鈕永遠可用且重新載入完整列表
    Given WebSocket 已連線（或離線）
    When 我點擊 Header 重整按鈕
    Then 系統立即呼叫 GET /api/v1/services 取得完整列表
    And 重整期間顯示 loading 動畫
    And 服務列表完全更新

  # ============================================================
  # Error Handling — WebSocket 連線失敗
  # ============================================================

  @error-handling @p0 @connection-loss
  Scenario: 初始連線失敗時自動重試
    Given 我已登入進入 Dashboard
    When WebSocket 初始連線失敗（伺服器拒絕或網路不通）
    Then 指示器顯示「⟳ 重連中...」黃色狀態
    And 系統 3 秒後自動重試連線

  @error-handling @p0 @connection-loss
  Scenario: 連線異常中斷時自動重連
    Given WebSocket 已連線且指示器顯示「🔗 已連線」
    When 網路不穩導致 WebSocket 異常中斷
    Then onclose 事件觸發
    And 指示器變為「⟳ 重連中...」黃色狀態
    And 系統以 exponential backoff 重試（1s → 2s → 4s → ... → max 30s）

  @error-handling @p0 @connection-loss
  Scenario: 重連成功後推送完整狀態快照
    Given WebSocket 處於重連中狀態
    When 重連成功
    Then 指示器恢復「🔗 已連線」綠色狀態
    And Toast 顯示「即時連線已恢復」
    And 後端推送完整服務狀態快照
    And Dashboard 服務列表與後端狀態完全一致

  @error-handling @p0 @connection-loss
  Scenario: 重連失敗超過 30 秒顯示離線指示器
    Given WebSocket 處於重連中狀態
    And 重試時間已超過 30 秒仍未成功
    When 最後一次重試也失敗
    Then 指示器變為「⚠ 離線」紅色狀態
    And 手動重整按鈕仍可正常使用

  @error-handling @p1 @connection-loss
  Scenario: 筆電休眠喚醒後自動重連
    Given WebSocket 在休眠前已連線
    When 筆電從休眠中喚醒
    Then 系統偵測到 WebSocket 中斷
    And 自動啟動重連機制

  # ============================================================
  # Error Handling — Heartbeat 超時
  # ============================================================

  @error-handling @p1 @heartbeat-timeout
  Scenario: 超過 45 秒無任何訊息判定斷線
    Given WebSocket 已連線
    When 超過 45 秒未收到任何訊息（含 heartbeat）
    Then 前端判定連線中斷
    And 指示器變為「⟳ 重連中...」黃色狀態
    And 自動啟動重連機制

  @error-handling @p1 @heartbeat-timeout
  Scenario: 超過 15 秒無訊息顯示狀態可能過時警告
    Given WebSocket 已連線
    When 超過 15 秒未收到任何訊息
    Then 服務列表上方顯示「⚠ 狀態可能過時」提示
    And 管理員可手動重整取得最新狀態

  # ============================================================
  # Error Handling — D-Bus 不可用
  # ============================================================

  @error-handling @p0 @dbus-fallback
  Scenario: D-Bus 不可用時自動降級為 polling fallback
    Given 後端啟動
    When D-Bus 連線不可用（容器環境或非 systemd 系統）
    Then 後端自動切換為 polling fallback 模式
    And 每 5 秒執行 systemctl 比對服務狀態
    And 前端功能不受影響（延遲略高但正常運作）

  @error-handling @p1 @dbus-fallback
  Scenario: Polling 模式下仍正確推送狀態變更
    Given 後端處於 polling fallback 模式
    When 某服務狀態發生變更
    Then 後端在下一次 polling 週期（5 秒內）偵測到差異
    And 僅推送有變更的服務項目給 WebSocket 客戶端

  @error-handling @p2 @dbus-fallback
  Scenario: Polling 無法執行 systemctl 時記錄錯誤
    Given 後端處於 polling fallback 模式
    When systemctl 指令執行失敗
    Then 後端記錄錯誤 log
    And 前端依賴 WebSocket heartbeat 維持
    And 不影響已連線的 WebSocket

  # ============================================================
  # Edge Cases — 瀏覽器不支援 WebSocket
  # ============================================================

  @edge-case @p1 @browser-compat
  Scenario: 瀏覽器不支援 WebSocket 時自動降級為前端 polling
    Given 我使用不支援 WebSocket 的瀏覽器
    When 我登入進入 Dashboard
    Then 系統偵測到瀏覽器不支援 WebSocket
    And 自動切換為前端 polling（每 10 秒呼叫 GET /api/v1/services）
    And 顯示提示「您的瀏覽器不支援即時更新，已自動切換為定時重整」

  # ============================================================
  # Edge Cases — 多分頁
  # ============================================================

  @edge-case @p1 @multi-tab
  Scenario: 多分頁同時開啟時所有分頁皆收到更新
    Given 我在兩個瀏覽器分頁中開啟 Dashboard
    And 兩個分頁皆已建立獨立的 WebSocket 連線
    When 某服務狀態發生變更
    Then 後端廣播 status_change 給所有連線客戶端
    And 兩個分頁的服務列表皆即時更新

  # ============================================================
  # Edge Cases — 大量服務與大量更新
  # ============================================================

  @edge-case @performance @p1
  Scenario: 大量服務同時變更時以 debounce 合併更新
    Given WebSocket 已連線
    And 服務列表包含超過 200 個服務
    When 同時間多個服務狀態同時變更
    Then 前端以 100ms debounce 合併更新
    And UI 無卡頓或 DOM 抖動

  @edge-case @performance @p1
  Scenario: 單一 status_change 訊息大小約 150 bytes
    Given WebSocket 已連線
    When 後端推送一筆 status_change 訊息
    Then 該訊息大小約 150 bytes（不含 overhead）
    And 不造成明顯頻寬負擔

  # ============================================================
  # Edge Cases — 搜尋或過濾中收到更新
  # ============================================================

  @edge-case @p1 @filter-interaction
  Scenario: 搜尋中收到狀態更新仍正確反映
    Given 我在搜尋框中已輸入「nginx」進行過濾
    When 後端推送 nginx.service 的 status_change 訊息
    Then 列表中的 nginx.service 列即時更新
    And 過濾條件不受影響

  # ============================================================
  # Business Rules — 連線管理
  # ============================================================

  @business-rules @p1 @connection-limit
  Scenario: 同一 session 最多 5 個並發 WebSocket 連線
    Given 我使用同一 session 開啟多個分頁
    When 我開啟第 6 個 Dashboard 分頁嘗試建立 WebSocket
    Then 後端拒絕第 6 個連線或關閉最舊的連線
    And 確保資源不被無限制消耗

  @business-rules @p1 @connection-isolation
  Scenario: 狀態推送 WebSocket 與日誌檢視器 WebSocket 獨立
    Given Dashboard 已建立狀態推送 WebSocket 連線
    When 我開啟日誌檢視器並建立日誌 WebSocket 連線
    Then 兩個 WebSocket 連線互相獨立
    And 日誌檢視器連線不影響狀態推送功能

  # ============================================================
  # Business Rules — REST API 保留
  # ============================================================

  @business-rules @p0 @rest-fallback
  Scenario: WebSocket 是增強功能不取代 REST API
    Given WebSocket 連線已建立
    When 我執行 start/stop/restart/enable/disable 操作
    Then 操作仍透過 REST API（POST）發送
    And WebSocket 僅推送操作後的狀態變更結果
    And 手動重整按鈕永遠可用作為 fallback

  @business-rules @p0 @rest-fallback
  Scenario: WebSocket 離線時所有操作仍可透過 REST 完成
    Given WebSocket 處於離線狀態（指示器顯示「⚠ 離線」）
    When 我執行 start/stop/restart 操作
    Then 操作透過 REST API 正常完成
    And 操作後手動重整即可看到最新狀態
    And Toast 仍顯示操作成功通知

  # ============================================================
  # Business Rules — 狀態變更動畫
  # ============================================================

  @business-rules @p1 @highlight-animation
  Scenario: 狀態變更時依 Active 狀態顯示對應顏色動畫
    Given WebSocket 已連線
    When 服務 Active 狀態從 running 變為 failed
    Then 該服務列閃爍紅色 highlight 動畫（0.5s）

  @business-rules @p1 @highlight-animation
  Scenario: 狀態從 inactive 變為 active 時顯示綠色動畫
    Given WebSocket 已連線
    When 服務 Active 狀態從 inactive 變為 active/running
    Then 該服務列閃爍綠色 highlight 動畫（0.5s）

  @business-rules @p1 @highlight-animation
  Scenario: 狀態僅 SubState 變更但 Active 不變時無動畫
    Given WebSocket 已連線
    When 服務 Active 狀態未變更但 SubState 有變化
    Then 服務列靜默更新
    And 無 highlight 動畫觸發

  # ============================================================
  # Business Rules — D-Bus 與 Polling 模式切換
  # ============================================================

  @business-rules @p0 @mode-switch
  Scenario: D-Bus 模式下狀態變更零延遲推送
    Given 後端以 D-Bus 模式運行
    When 服務狀態發生變更（PropertiesChanged 訊號觸發）
    Then 後端在 1 秒內推送 status_change 訊息
    And Dashboard 在 1 秒內反映變更

  @business-rules @p1 @mode-switch
  Scenario: Polling 模式下延遲不超過 5 秒
    Given 後端以 polling fallback 模式運行
    When 服務狀態發生變更
    Then 後端在下一次 polling 週期（5 秒內）推送變更
    And Dashboard 在 5 秒內反映變更
