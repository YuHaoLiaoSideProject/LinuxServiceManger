@service-search @dashboard @toolbar
Feature: 服務搜尋強化
  作為一個已登入的管理員
  我希望在 Dashboard Toolbar 使用狀態過濾按鈕與正則搜尋模式快速篩選服務列表
  以便在管理數十甚至上百個服務時，能一鍵篩出異常服務或用正則精準定位目標服務

  Background:
    Given 我已登入系統
    And 服務列表已載入完成
    And Dashboard Toolbar 已顯示搜尋框、狀態過濾按鈕組（All / 🟢 Running / 🔴 Failed / ⚪ Inactive）與正則模式開關（預設 OFF）
    And 「All」按鈕為 active 狀態

  # ============================================================
  # Happy Path — 狀態過濾
  # ============================================================

  @smoke @happy-path @p0 @status-filter
  Scenario: 一鍵過濾顯示所有 Running 服務
    When 我點擊「🟢 Running」狀態過濾按鈕
    Then 「🟢 Running」按鈕變為 active 樣式
    And 「All」、「🔴 Failed」、「⚪ Inactive」按鈕恢復為 inactive 樣式
    And 服務列表僅顯示 Active 狀態為 running 的服務
    And 搜尋框下方顯示「N 個服務」（N 為過濾後數量）

  @smoke @happy-path @p0 @status-filter
  Scenario: 一鍵過濾顯示所有 Failed 服務
    When 我點擊「🔴 Failed」狀態過濾按鈕
    Then 「🔴 Failed」按鈕變為 active 樣式
    And 服務列表僅顯示 Active 狀態為 failed 的服務

  @smoke @happy-path @p0 @status-filter
  Scenario: 一鍵過濾顯示所有 Inactive 服務
    When 我點擊「⚪ Inactive」狀態過濾按鈕
    Then 「⚪ Inactive」按鈕變為 active 樣式
    And 服務列表僅顯示 Active 狀態為 inactive 的服務

  @happy-path @p0 @status-filter
  Scenario: 再次點擊已 active 的狀態按鈕取消過濾
    Given 我已點擊「🟢 Running」按鈕使列表處於過濾狀態
    When 我再次點擊「🟢 Running」狀態過濾按鈕
    Then 「🟢 Running」按鈕恢復為 inactive 樣式
    And 「All」按鈕恢復為 active 樣式
    And 服務列表恢復顯示全部服務

  @happy-path @p0 @status-filter
  Scenario: 切換至不同狀態過濾
    Given 我已點擊「🟢 Running」按鈕使列表僅顯示 running 服務
    When 我點擊「🔴 Failed」狀態過濾按鈕
    Then 「🟢 Running」按鈕恢復為 inactive 樣式
    And 「🔴 Failed」按鈕變為 active 樣式
    And 服務列表僅顯示 Active 狀態為 failed 的服務

  # ============================================================
  # Happy Path — 文字搜尋
  # ============================================================

  @smoke @happy-path @p0 @text-search
  Scenario: 以關鍵字即時搜尋服務名稱（普通模式）
    Given 正則模式開關為 OFF
    When 我在搜尋框輸入「nginx」
    Then 經過 debounce 150ms 後服務列表僅顯示名稱包含「nginx」的服務（不分大小寫）
    And 搜尋框右側顯示清除 ✕ 按鈕

  @happy-path @p0 @text-search
  Scenario: 清除文字搜尋恢復完整列表
    Given 搜尋框內已有文字「nginx」且列表處於過濾狀態
    When 我點擊搜尋框右側的清除 ✕ 按鈕
    Then 搜尋框內容清空
    And 服務列表恢復為僅受狀態過濾條件影響的結果
    And 清除 ✕ 按鈕消失

  # ============================================================
  # Happy Path — 正則搜尋
  # ============================================================

  @smoke @happy-path @p0 @regex-search
  Scenario: 開啟正則模式以正則表達式搜尋服務
    Given 正則模式開關為 OFF
    When 我點擊正則模式開關
    Then 正則開關變為 ON 並顯示 highlight 樣式
    And 搜尋框 placeholder 變更為「正則搜尋，例如：nginx-.*」
    And 搜尋行為從子字串匹配切換為正則表達式匹配

  @happy-path @p0 @regex-search
  Scenario: 在正則模式下以合法正則表達式篩選服務
    Given 正則模式開關為 ON
    When 我在搜尋框輸入合法的正則表達式「nginx-.*」
    Then 服務列表即時顯示名稱匹配該正則的服務

  @happy-path @p0 @regex-search
  Scenario: 關閉正則模式回到普通文字搜尋
    Given 正則模式開關為 ON
    And 搜尋框內有合法正則「nginx-.*」
    When 我點擊正則模式開關將其設為 OFF
    Then 正則開關恢復為 OFF 且 highlight 樣式消失
    And 搜尋框 placeholder 恢復為「搜尋服務名稱...」
    And 搜尋行為恢復為子字串匹配（不分大小寫）
    And 若有正則錯誤提示則一併清除

  @happy-path @p0 @regex-search
  Scenario: 開啟正則模式時搜尋框已有文字則立即以正則重新評估
    Given 正則模式開關為 OFF
    And 搜尋框內已有文字「nginx」
    When 我點擊正則模式開關
    Then 服務列表立即以正則「nginx」重新篩選

  # ============================================================
  # Happy Path — 複合過濾
  # ============================================================

  @smoke @happy-path @p0 @combined-filter
  Scenario: 狀態過濾與文字搜尋同時作用取交集
    Given 我已點擊「🟢 Running」按鈕使列表僅顯示 running 服務
    When 我在搜尋框輸入「nginx」
    Then 服務列表僅顯示名稱包含「nginx」且 Active 狀態為 running 的服務（交集）

  @happy-path @p0 @combined-filter
  Scenario: 狀態過濾與正則搜尋同時作用取交集
    Given 我已點擊「🔴 Failed」按鈕使列表僅顯示 failed 服務
    And 正則模式開關為 ON
    When 我在搜尋框輸入正則「php.*」
    Then 服務列表僅顯示名稱匹配「php.*」且 Active 狀態為 failed 的服務（交集）

  @happy-path @p0 @combined-filter
  Scenario: 複合過濾中任一條件變更即重新計算交集
    Given 我已點擊「🟢 Running」按鈕且搜尋框輸入「nginx」
    And 列表顯示交集結果
    When 我點擊「🔴 Failed」切換狀態過濾
    Then 列表立即更新為名稱包含「nginx」且 Active 狀態為 failed 的服務

  @happy-path @p0 @combined-filter
  Scenario: 點擊「All」按鈕清除狀態過濾但保留文字搜尋
    Given 我已點擊「🟢 Running」按鈕且搜尋框輸入「nginx」
    When 我點擊「All」按鈕
    Then 服務列表顯示所有名稱包含「nginx」的服務（不受狀態限制）

  # ============================================================
  # Error Handling — 正則語法錯誤
  # ============================================================

  @error-handling @validation @p0 @regex-search
  Scenario: 輸入不合法的正則表達式時顯示錯誤且不更新列表
    Given 正則模式開關為 ON
    When 我在搜尋框輸入不合法的正則表達式「[invalid(regex」
    Then 搜尋框邊框變為紅色
    And 搜尋框下方顯示紅色錯誤提示「無效的正則表達式：{錯誤細節}」
    And 服務列表維持上一次有效搜尋結果不變

  @error-handling @validation @p0 @regex-search
  Scenario: 修正正則語法錯誤後錯誤提示消失並恢復篩選
    Given 正則模式開關為 ON
    And 搜尋框內有不合法的正則且顯示錯誤提示
    When 我修改正則表達式為合法格式「nginx-.*」
    Then 搜尋框邊框恢復正常（非紅色）
    And 錯誤提示消失
    And 服務列表以修正後的正則重新篩選

  @error-handling @validation @p0 @regex-search
  Scenario: 關閉正則模式可立即清除正則錯誤狀態
    Given 正則模式開關為 ON
    And 搜尋框內有不合法的正則且顯示錯誤提示
    When 我點擊正則模式開關將其設為 OFF
    Then 正則錯誤提示消失
    And 搜尋框邊框恢復正常
    And 服務列表恢復為普通文字搜尋結果

  # ============================================================
  # Error Handling — 過濾結果為空
  # ============================================================

  @error-handling @empty-state @p1
  Scenario: 過濾結果為空時顯示空狀態頁面
    Given 服務列表已載入
    When 我輸入一個不存在於任何服務名稱的關鍵字「xyz_not_exist_123」
    Then 表格區域顯示空狀態插圖
    And 顯示提示文字「沒有符合條件的服務」
    And 顯示「清除過濾」按鈕

  @error-handling @empty-state @p1
  Scenario: 從空狀態點擊清除過濾恢復完整列表
    Given 過濾結果為空且空狀態頁面已顯示
    When 我點擊「清除過濾」按鈕
    Then 所有過濾條件恢復預設值
    And 搜尋框清空
    And 狀態過濾恢復為「All」active
    And 正則模式恢復為 OFF
    And 服務列表顯示全部服務

  # ============================================================
  # Edge Cases — 載入狀態
  # ============================================================

  @edge-case @loading @p1
  Scenario: 服務列表載入中時過濾按鈕為不可用狀態
    Given 我已登入系統
    And 服務列表尚在載入中
    When 我檢視 Toolbar
    Then 狀態過濾按鈕（Running / Failed / Inactive）顯示為 disabled 狀態且不可點擊
    And 搜尋框仍可輸入但暫不生效

  @edge-case @loading @p1
  Scenario: 服務列表載入完成後自動套用等待中的過濾條件
    Given 服務列表尚在載入中
    And 我已在搜尋框輸入「nginx」
    When 服務列表載入完成
    Then 搜尋框文字「nginx」自動套用至已載入的列表
    And 狀態過濾按鈕恢復為可點擊狀態

  # ============================================================
  # Edge Cases — Tab 切換
  # ============================================================

  @edge-case @tab-switch @p1
  Scenario: Tab 切換時過濾條件保留並對新 Tab 服務集合套用
    Given 我在「我的服務」Tab 且已過濾顯示 running 服務
    When 我切換至「系統服務」Tab
    Then 狀態過濾條件（Running）保留
    And 列表顯示「系統服務」Tab 中所有 running 服務
    And 若新 Tab 無匹配結果則顯示空狀態

  @edge-case @tab-switch @p1
  Scenario: Tab 切換時文字搜尋條件保留並對新 Tab 服務集合套用
    Given 我在「我的服務」Tab 且搜尋框輸入「nginx」
    When 我切換至「系統服務」Tab
    Then 搜尋框仍顯示「nginx」
    And 列表顯示「系統服務」Tab 中名稱包含「nginx」的服務

  # ============================================================
  # Edge Cases — 瀏覽器導航（URL 同步）
  # ============================================================

  @edge-case @url-sync @p2
  Scenario: 過濾狀態同步至 URL query string
    When 我點擊「🟢 Running」狀態過濾
    And 我在搜尋框輸入「nginx」
    And 我開啟正則模式
    Then 瀏覽器 URL query string 包含「status=running&search=nginx&regex=true」

  @edge-case @url-sync @p2
  Scenario: 從帶有過濾參數的 URL 進入時自動恢復過濾條件
    Given 我透過 URL「?status=failed&search=php&regex=false」進入 Dashboard
    When Dashboard 頁面載入完成
    Then 狀態過濾自動設為「🔴 Failed」active
    And 搜尋框顯示「php」
    And 正則模式為 OFF
    And 列表顯示符合所有條件的服務

  @edge-case @url-sync @p2
  Scenario: 瀏覽器上一頁／下一頁時過濾狀態正確恢復
    Given 我已套用狀態過濾與文字搜尋且 URL 已同步
    And 我導航至其他頁面
    When 我點擊瀏覽器上一頁
    Then Dashboard 自動恢復離開前的過濾條件
    And 列表顯示對應的過濾結果

  # ============================================================
  # Edge Cases — 大量服務效能
  # ============================================================

  @edge-case @performance @p2
  Scenario: 超過 100 個服務時過濾操作流暢無延遲
    Given 服務列表包含超過 100 個服務
    When 我快速連續點擊不同狀態過濾按鈕（Running → Failed → Inactive → All）
    Then 每次過濾結果在 200ms 內顯示
    And UI 無卡頓或凍結

  @edge-case @performance @p2
  Scenario: 大量服務下正則搜尋即時響應
    Given 服務列表包含超過 100 個服務
    And 正則模式開關為 ON
    When 我在搜尋框快速輸入正則表達式「.*」
    Then 列表篩選在 debounce 150ms 後即時更新
    And UI 保持可互動狀態

  # ============================================================
  # Edge Cases — RWD 響應式佈局
  # ============================================================

  @edge-case @rwd @mobile @p2
  Scenario: 手機佈局下過濾按鈕不擠壓搜尋框
    Given 我使用寬度 ≤ 768px 的行動裝置
    When 我檢視 Toolbar 區域
    Then 狀態過濾按鈕組不會擠壓搜尋框
    And 搜尋框與過濾按鈕保持可點擊且文字清晰可讀

  # ============================================================
  # Business Rules — 過濾範圍
  # ============================================================

  @business-rules @p1
  Scenario: 狀態過濾僅作用於當前 Tab 的服務集合
    Given 我在「我的服務」Tab 點擊「🟢 Running」
    Then 列表僅顯示「我的服務」Tab 中 running 的服務
    And 「系統服務」Tab 中的服務不受影響（切換後才套用）

  @business-rules @p1
  Scenario: 文字搜尋僅作用於當前 Tab 的服務集合
    Given 我在「我的服務」Tab 搜尋框輸入「nginx」
    Then 列表僅顯示「我的服務」Tab 中名稱包含「nginx」的服務

  # ============================================================
  # Business Rules — 正則引擎
  # ============================================================

  @business-rules @regex-engine @p1
  Scenario: 正則模式使用 JavaScript RegExp 引擎（ECMAScript 規範）
    Given 正則模式開關為 ON
    When 我在搜尋框輸入正則「nginx-\d+」
    Then 系統使用 JavaScript RegExp 引擎解析該表達式
    And 僅匹配名稱符合該 ECMAScript 正則規則的服務

  @business-rules @regex-engine @p1
  Scenario: 正則模式大小寫由使用者透過 flag 控制
    Given 正則模式開關為 ON
    When 我在搜尋框輸入正則「nginx」不加 i flag
    Then 僅匹配名稱精確包含「nginx」（小寫）的服務
    When 我在搜尋框輸入正則「nginx」加上 i flag「/nginx/i」
    Then 匹配名稱包含「nginx」的服務（不分大小寫）

  # ============================================================
  # Business Rules — 前端過濾
  # ============================================================

  @business-rules @client-side @p1
  Scenario: 所有過濾操作在前端執行不發送 API 請求
    Given 服務列表已載入至瀏覽器 memory
    When 我進行任何狀態過濾、文字搜尋或正則搜尋操作
    Then 系統不發送任何 API 請求
    And 所有篩選在前端即時完成

  # ============================================================
  # Business Rules — 文字搜尋行為
  # ============================================================

  @business-rules @text-search @p1
  Scenario: 普通模式文字搜尋不分大小寫
    Given 正則模式開關為 OFF
    When 我在搜尋框輸入「NGINX」
    Then 服務列表顯示名稱包含「nginx」、「Nginx」、「NGINX」等所有大小寫變體的服務

  @business-rules @text-search @p1
  Scenario: 文字輸入 debounce 150ms 後才觸發篩選
    Given 正則模式開關為 OFF
    When 我在搜尋框快速連續輸入「n」「g」「i」「n」「x」
    Then 系統不會在每次按鍵時立即篩選
    And 在最後一次按鍵 150ms 後才以完整關鍵字「nginx」執行一次篩選

  # ============================================================
  # Business Rules — StatsBar
  # ============================================================

  @business-rules @stats-bar @p1
  Scenario: StatsBar 數字反映全域統計不受過濾影響
    Given 服務列表共有 50 個服務（30 running、5 failed、15 inactive）
    When 我點擊「🔴 Failed」過濾後列表僅顯示 5 個服務
    Then StatsBar 仍顯示全域統計數字（50 總數）
    And StatsBar 的 running / failed / inactive 計數不受過濾影響

  # ============================================================
  # Business Rules — 深色模式
  # ============================================================

  @business-rules @dark-mode @p2
  Scenario: 深色模式下過濾按鈕 active/inactive 樣式正常
    Given 系統處於深色模式
    When 我點擊「🟢 Running」狀態過濾按鈕
    Then active 按鈕樣式在深色背景下清晰可辨
    And inactive 按鈕在深色背景下不會難以識別
