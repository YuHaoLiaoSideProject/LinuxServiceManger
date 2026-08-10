@batch @operations @dashboard @smoke @regression
Feature: 批次操作服務
  作為一個已登入的管理員
  我希望在服務列表中選取多個服務，一次性執行 start / stop / restart 操作
  以便在維護窗口快速管理一組相關服務（如「所有 Web 服務」），大幅減少重複點擊，提升管理效率

  Background:
    Given 管理員已登入系統
    And 管理員位於 Dashboard 服務列表頁面
    And 服務列表已成功載入

  # ──────────────────────────────────────────────
  # 選取 UI — 基本選取行為
  # ──────────────────────────────────────────────

  @selection @happy-path @p0
  Scenario: 選取單一服務後顯示批次工具列
    Given 服務列表中有至少 3 個解鎖服務
    And 當前沒有任何服務被勾選
    And 批次操作工具列處於隱藏狀態
    When 管理員點擊某個解鎖服務左側的 checkbox
    Then 該服務的 checkbox 變為已勾選
    And 批次操作工具列以 slide down 動畫浮現
    And 工具列顯示「已選取 1 個服務」
    And 工具列顯示 Start、Stop、Restart 按鈕
    And 工具列顯示「取消選取」連結

  @selection @happy-path @p0
  Scenario: 取消所有勾選後隱藏批次工具列
    Given 管理員已勾選至少 1 個服務
    And 批次操作工具列處於顯示狀態
    When 管理員取消勾選最後一個已選服務的 checkbox
    Then 選取數量變為 0
    And 批次操作工具列向上滑出隱藏
    And 所有 checkbox 回到未勾選狀態

  @selection @happy-path @p0
  Scenario: 點擊表頭全選 checkbox 勾選所有可見解鎖服務
    Given 目前 Tab 下有 8 個解鎖服務
    And 沒有任何過濾條件或搜尋關鍵字
    When 管理員點擊表頭的全選 checkbox
    Then 所有 8 個解鎖服務的 checkbox 全部變為已勾選
    And 工具列顯示「已選取 8 個服務」
    And 鎖定服務的 checkbox 不受影響

  @selection @happy-path @p0
  Scenario: 點擊表頭全選 checkbox 取消全選
    Given 目前 Tab 下有 8 個解鎖服務全部已勾選
    When 管理員再次點擊表頭的全選 checkbox（取消全選）
    Then 所有 checkbox 取消勾選
    And 選取數量變為 0
    And 批次操作工具列隱藏

  @selection @happy-path @p0
  Scenario: 透過工具列「取消選取」連結清除所有勾選
    Given 管理員已勾選 5 個服務
    And 批次操作工具列可見
    When 管理員點擊工具列上的「取消選取」連結
    Then 所有 checkbox 取消勾選
    And 批次操作工具列隱藏
    And 介面回到初始狀態

  # ──────────────────────────────────────────────
  # 選取 UI — 鎖定服務排除
  # ──────────────────────────────────────────────

  @selection @edge-case @p1
  Scenario: 鎖定服務不顯示 checkbox
    Given 服務列表中包含 2 個鎖定服務和 5 個解鎖服務
    When 管理員查看服務列表
    Then 鎖定服務列左側不顯示 checkbox 或顯示 🔒 圖示
    And 僅解鎖服務列左側顯示可操作的 checkbox

  @selection @edge-case @p1
  Scenario: 全選時排除鎖定服務
    Given 服務列表中包含 2 個鎖定服務和 5 個解鎖服務
    When 管理員點擊表頭的全選 checkbox
    Then 僅 5 個解鎖服務被勾選
    And 工具列顯示「已選取 5 個服務」
    And 鎖定服務維持未勾選且不可勾選

  # ──────────────────────────────────────────────
  # 選取 UI — Tab 隔離
  # ──────────────────────────────────────────────

  @selection @edge-case @p1
  Scenario: 切換 Tab 時清除所有選取
    Given 管理員在「我的服務」Tab 下已勾選 3 個服務
    And 批次操作工具列可見
    When 管理員切換到「系統服務」Tab
    Then 先前的 3 個勾選全部清除
    And 批次操作工具列隱藏
    And 「系統服務」Tab 下的服務列表無任何勾選

  # ──────────────────────────────────────────────
  # 選取 UI — 過濾 + 全選
  # ──────────────────────────────────────────────

  @selection @edge-case @p1
  Scenario: 全選僅勾選目前過濾結果中的解鎖服務
    Given 目前 Tab 下有 20 個解鎖服務
    When 管理員輸入搜尋關鍵字「web」過濾出 4 個服務
    And 管理員點擊表頭的全選 checkbox
    Then 僅過濾結果中的 4 個服務被勾選
    And 工具列顯示「已選取 4 個服務」
    And 其他 16 個未出現在過濾結果中的服務不受影響

  @selection @edge-case @p2
  Scenario: 過濾結果為空時全選 checkbox 不可用
    Given 目前 Tab 下有解鎖服務
    When 管理員輸入搜尋關鍵字「zzz_nonexistent」導致過濾結果為空
    Then 表頭的全選 checkbox 處於 disabled 狀態且不可點擊

  # ──────────────────────────────────────────────
  # 選取 UI — 數量上限
  # ──────────────────────────────────────────────

  @selection @edge-case @p1
  Scenario: 批次選取上限為 50 個服務
    Given 目前 Tab 下有 60 個解鎖服務
    When 管理員點擊表頭的全選 checkbox
    Then 僅前 50 個服務被勾選
    And 工具列顯示「已選取 50 個服務」
    And 顯示提示「單次批次操作上限為 50 個服務」

  # ──────────────────────────────────────────────
  # 批次工具列 — 呈現與行為
  # ──────────────────────────────────────────────

  @toolbar @happy-path @p0
  Scenario: 批次工具列在表格捲動時固定可見
    Given 管理員已勾選 5 個服務
    And 批次操作工具列已顯示在列表上方
    When 管理員向下捲動服務列表超出可視範圍
    Then 批次操作工具列保持固定在頁面上方（sticky）

  @toolbar @happy-path @p0
  Scenario: 選取數量變更時工具列即時更新
    Given 管理員已勾選 3 個服務
    And 工具列顯示「已選取 3 個服務」
    When 管理員再勾選 2 個服務
    Then 工具列即時更新為「已選取 5 個服務」

  @toolbar @edge-case @p1
  Scenario: 0 個選取時操作按鈕為 disabled
    Given 當前沒有任何服務被勾選
    And 批次操作工具列處於隱藏狀態
    Then Start、Stop、Restart 按鈕不可見且無法點擊

  # ──────────────────────────────────────────────
  # 確認對話框
  # ──────────────────────────────────────────────

  @confirmation @happy-path @p0
  Scenario: 執行批次 Start 前顯示確認對話框
    Given 管理員已勾選 4 個服務
    And 批次操作工具列可見
    When 管理員點擊工具列上的 Start 按鈕
    Then 彈出確認對話框
    And 對話框標題顯示「確定要啟動 4 個服務？」
    And 對話框列出受影響的服務名稱（最多顯示前 5 個）
    And 對話框顯示確認與取消按鈕

  @confirmation @happy-path @p0
  Scenario: 執行批次 Stop 前顯示確認對話框
    Given 管理員已勾選 4 個服務
    When 管理員點擊工具列上的 Stop 按鈕
    Then 彈出確認對話框
    And 對話框標題顯示「確定要停止 4 個服務？」
    And 對話框列出受影響的服務名稱

  @confirmation @business-rule @p0
  Scenario: 執行批次 Restart 前顯示確認對話框並附帶中斷提示
    Given 管理員已勾選 4 個服務
    When 管理員點擊工具列上的 Restart 按鈕
    Then 彈出確認對話框
    And 對話框標題顯示「確定要重啟 4 個服務？」
    And 對話框額外顯示警告提示「重啟會造成服務短暫中斷」
    And 對話框列出受影響的服務名稱

  @confirmation @happy-path @p0
  Scenario: 確認對話框中服務清單超過 5 個時顯示摘要
    Given 管理員已勾選 10 個服務：svc-a, svc-b, svc-c, svc-d, svc-e, svc-f, svc-g, svc-h, svc-i, svc-j
    When 管理員點擊 Start 按鈕觸發確認對話框
    Then 對話框顯示前 5 個服務名稱：svc-a, svc-b, svc-c, svc-d, svc-e
    And 對話框顯示「...及其他 5 個」

  @confirmation @happy-path @p0
  Scenario: 在確認對話框中點擊確認後執行操作
    Given 批次 Start 確認對話框已開啟
    When 管理員點擊「確認」按鈕
    Then 對話框關閉
    And 系統開始執行批次操作
    And 工具列顯示執行進度

  @confirmation @happy-path @p0
  Scenario: 在確認對話框中點擊取消後保留選取狀態
    Given 管理員已勾選 5 個服務
    And 批次 Stop 確認對話框已開啟
    When 管理員點擊「取消」按鈕
    Then 對話框關閉
    And 回到服務列表頁面
    And 5 個服務的勾選狀態保持不變
    And 批次操作工具列仍然可見

  # ──────────────────────────────────────────────
  # 批次執行 — 全部成功
  # ──────────────────────────────────────────────

  @execution @happy-path @p0
  Scenario: 批次操作全部成功
    Given 管理員已勾選 5 個解鎖服務並點擊 Start 按鈕
    And 確認對話框中已點擊確認
    And 後端將對所有 5 個服務回傳成功
    When 批次操作執行完畢
    Then 顯示綠色 Toast 通知「5 個服務已成功啟動」
    And 所有 checkbox 自動取消勾選
    And 批次操作工具列隱藏
    And 服務列表自動重整

  @execution @happy-path @p0
  Scenario: 批次操作期間顯示執行進度
    Given 管理員已確認對 5 個服務執行 Restart
    And 後端正循序執行各服務操作
    When 第 3 個服務操作完成時
    Then 工具列顯示「正在執行... 3/5」
    And Start、Stop、Restart 按鈕處於 disabled 狀態

  # ──────────────────────────────────────────────
  # 批次執行 — 部分失敗
  # ──────────────────────────────────────────────

  @execution @error-handling @p0
  Scenario: 批次操作部分失敗時顯示失敗清單
    Given 管理員已勾選 6 個服務並執行 Restart
    And 後端回報 4 個成功、2 個失敗（svc-x 因「權限不足」、svc-y 因「服務不存在」）
    When 批次操作執行完畢
    Then 顯示黃色 Toast 警告「4 成功，2 失敗」
    And 展開詳細結果面板（inline），列出失敗服務：
      | 服務名稱 | 錯誤原因     |
      | svc-x    | 權限不足     |
      | svc-y    | 服務不存在   |
    And 工具列恢復為閒置狀態
    And 失敗服務的勾選保留以便重試

  @execution @error-handling @p1
  Scenario: 部分失敗後管理員可對失敗項目手動重試
    Given 前次批次 Restart 操作部分失敗
    And 詳細結果面板顯示 2 個失敗服務
    And 失敗服務的 checkbox 仍維持勾選
    When 管理員再次點擊 Restart 按鈕並確認
    Then 僅對仍勾選的失敗服務重新執行 Restart

  # ──────────────────────────────────────────────
  # 批次執行 — 全部失敗
  # ──────────────────────────────────────────────

  @execution @error-handling @p1
  Scenario: 批次操作全部失敗時顯示所有錯誤
    Given 管理員已勾選 3 個服務並執行 Start
    And 後端回報所有 3 個服務均操作失敗
    When 批次操作執行完畢
    Then 顯示紅色 Toast 錯誤「批次操作失敗」
    And 詳細結果面板顯示所有 3 個失敗服務的名稱及錯誤原因
    And 所有勾選保留以便重試

  # ──────────────────────────────────────────────
  # 異常處理 — 網路中斷
  # ──────────────────────────────────────────────

  @execution @error-handling @p1
  Scenario: 批次執行期間網路中斷
    Given 管理員已確認對 5 個服務執行 Stop
    And 後端正循序執行中
    When 執行期間發生網路中斷
    Then 工具列顯示「連線中斷，正在重試...」
    And 系統以 axios 重試機制嘗試恢復連線
    And 若連線恢復則繼續執行剩餘操作
    And 若重試仍失敗則顯示失敗結果

  # ──────────────────────────────────────────────
  # 異常處理 — 逾時
  # ──────────────────────────────────────────────

  @execution @error-handling @p1
  Scenario: 批次操作整體逾時
    Given 管理員已確認對大量服務執行 Restart
    And 批次請求整體逾時設定為 60 秒
    When 操作執行超過 60 秒仍未全部完成
    Then 未完成的服務回報失敗
    And 錯誤原因顯示「操作逾時」
    And 已完成的服務結果正常回報
    And 管理員可對逾時失敗的服務手動重試

  # ──────────────────────────────────────────────
  # 異常處理 — 選取中包含不存在服務
  # ──────────────────────────────────────────────

  @execution @error-handling @p2
  Scenario: 選取中包含已不存在的服務
    Given 管理員勾選了服務 svc-a, svc-b, svc-c
    And svc-c 在選取後已被其他管理員刪除
    When 管理員對這 3 個服務執行 Start 並確認
    Then 後端回傳 svc-c 個別錯誤「svc-c.service 不存在」
    And svc-a 和 svc-b 正常執行並成功
    And 結果顯示 2 成功、1 失敗（svc-c: 服務不存在）
    And 下一輪重整列表時 svc-c 自動從選取清單中消失

  # ──────────────────────────────────────────────
  # 後端 API — 請求與回應
  # ──────────────────────────────────────────────

  @api @p1
  Scenario: 後端接受批次操作請求
    Given 管理員對服務 svc-a, svc-b 執行 Start
    When 前端發送 POST 請求至 /api/v1/services/batch
    And 請求 body 為 {"names": ["svc-a", "svc-b"], "action": "start"}
    Then 後端回傳 HTTP 200
    And 回應 body 包含各服務的個別結果：
      | name   | action | result  |
      | svc-a  | start  | success |
      | svc-b  | start  | success |

  @api @error-handling @p1
  Scenario: 後端拒絕批次操作鎖定服務
    Given 管理員嘗試對鎖定服務 locked-svc 執行 Stop
    When 前端發送 POST 請求至 /api/v1/services/batch
    And 請求 body 為 {"names": ["locked-svc"], "action": "stop"}
    Then 後端回傳 locked-svc 的個別錯誤
    And locked-svc 的 result 為 failure 且 error 為「服務已鎖定，無法操作」

  @api @edge-case @p1
  Scenario: 後端拒絕超過 50 個服務的批次請求
    When 前端發送 POST 請求至 /api/v1/services/batch
    And 請求 body 中 names 陣列包含 51 個服務名稱
    Then 後端回傳 HTTP 422 或 400
    And 錯誤訊息為「單次批次操作上限為 50 個服務」

  @api @p1
  Scenario: 後端循序執行各服務操作
    Given 請求包含 3 個服務的 Restart 操作
    When 後端處理此批次請求
    Then 後端依序對第 1 個服務執行 Restart，等待完成後再處理第 2 個
    And 後端依序對第 2 個服務執行 Restart，等待完成後再處理第 3 個
    And 所有操作的 systemctl 指令不會發生鎖定衝突

  @api @p2
  Scenario: 批次操作記錄寫入 Audit Log
    Given 管理員對 3 個服務執行批次 Stop
    When 後端完成所有操作
    Then Audit Log 中寫入 3 筆獨立的操作記錄
    And 每筆記錄包含服務名稱、操作類型（stop）、執行結果、時間戳記

  # ──────────────────────────────────────────────
  # 整合 — 過濾後全選
  # ──────────────────────────────────────────────

  @integration @p1
  Scenario: 使用搜尋過濾後全選進行批次操作
    Given 目前 Tab 下有 15 個解鎖服務
    When 管理員輸入搜尋關鍵字「agent」過濾出 3 個服務
    And 管理員點擊表頭全選 checkbox 勾選這 3 個服務
    And 管理員對這 3 個服務執行 Restart 並確認
    Then 僅這 3 個過濾出的服務被操作
    And 操作結果正確顯示

  # ──────────────────────────────────────────────
  # 整合 — WebSocket 整合
  # ──────────────────────────────────────────────

  @integration @p2
  Scenario: 批次操作期間 WebSocket 推送不干擾進度顯示
    Given 管理員正在執行 5 個服務的批次 Stop
    And 工具列顯示執行進度「正在執行... 2/5」
    When WebSocket 推送各服務的狀態變更事件
    Then 前端暫時忽略這些即時推送
    And 批次操作進度顯示不受干擾
    And 操作全部完成後以一次重整取代

  # ──────────────────────────────────────────────
  # 整合 — 介面樣式
  # ──────────────────────────────────────────────

  @integration @ui @p2
  Scenario Outline: 不同佈景模式下 checkbox 與工具列樣式正常
    Given 管理員已登入系統
    And 系統目前為 <佈景模式>
    When 管理員查看服務列表
    Then checkbox 樣式與 <佈景模式> 一致
    And 批次操作工具列配色與 <佈景模式> 一致

    Examples:
      | 佈景模式   |
      | 淺色模式   |
      | 深色模式   |

  @integration @ui @p2
  Scenario: 手機 RWD 下 checkbox 與工具列佈局正常
    Given 管理員使用手機裝置（螢幕寬度小於 768px）開啟 Dashboard
    When 管理員查看服務列表並勾選服務
    Then checkbox 尺寸適中且易於點擊
    And 批次操作工具列以響應式佈局顯示
    And 工具列按鈕與文字不超出螢幕範圍

  # ──────────────────────────────────────────────
  # 資料驅動 — 不同操作類型
  # ──────────────────────────────────────────────

  @execution @happy-path @p0
  Scenario Outline: 批次操作不同類型的基本流程
    Given 管理員已勾選 3 個服務
    When 管理員點擊工具列上的 <按鈕> 按鈕
    And 在確認對話框中點擊確認
    And 後端對所有服務回傳成功
    Then 顯示綠色 Toast 通知「3 個服務已成功<動作>」
    And 服務列表自動重整

    Examples:
      | 按鈕     | 動作   |
      | Start    | 啟動   |
      | Stop     | 停止   |
      | Restart  | 重啟   |
