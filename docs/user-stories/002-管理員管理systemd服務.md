# 002 — 管理員查詢服務列表並執行啟停操作

**User Story：**
> As a 已登入的團隊管理員，
> I want 查看 Linux 主機上的 systemd 服務狀態，並對特定服務執行 Start、Stop、Restart，
> So that 我可以在不登入 SSH 的情況下，快速處理服務異常或進行例行維護。

**驗收條件：**

**查詢服務列表：**
1. **Given** 已登入，**When** 進入服務列表頁，**Then** 前端呼叫 `GET /api/v1/services`，取得 JSON 陣列（每筆含 name、load、active、sub、locked 欄位），並依 locked 欄位區分為「我的服務」與「系統服務」兩個分頁
2. **Given** 服務列表已載入，**When** 點擊重新整理按鈕，**Then** 重新呼叫 API 取得最新服務狀態並更新列表
3. **Given** 某服務不存在或已移除，**When** 重新整理列表，**Then** 該服務從列表中消失，不顯示錯誤
4. **Given** 服務列表已載入，**When** 輸入關鍵字於搜尋欄，**Then** 列表即時過濾，只顯示名稱包含該關鍵字的服務
5. **Given** 服務列表已載入，**When** 點擊欄位標頭（Name、Load、Active、Sub），**Then** 列表依該欄位升冪排序，再次點擊則切換為降冪

**統計資訊：**
6. **Given** 已登入，**When** 進入服務列表頁，**Then** 頁面上方顯示統計列：總服務數、執行中數量、失敗數量

**Start 服務：**
7. **Given** 某服務狀態為 inactive (dead) 或 failed，**When** 點擊 Start 按鈕，**Then** 直接呼叫 `POST /api/v1/services/{name}/start`（無需二次確認），服務啟動，狀態更新為 active (running)，並以 toast 顯示「{name} 已啟動」操作成功提示
8. **Given** 某服務已在執行中（active），**When** 檢視列表，**Then** Start 按鈕不顯示

**Stop 服務：**
9. **Given** 某服務狀態為 active (running)，**When** 點擊 Stop 按鈕，**Then** 彈出確認視窗「確定要停止 {name} 嗎？」，確認後呼叫 `POST /api/v1/services/{name}/stop`，服務停止，狀態更新為 inactive (dead)，並以 toast 顯示操作成功提示
10. **Given** 某服務已停止（inactive），**When** 檢視列表，**Then** Stop 按鈕不顯示

**Restart 服務：**
11. **Given** 某服務為解鎖狀態（不限 active 或 inactive），**When** 點擊 Restart 按鈕，**Then** 彈出確認視窗「確定要重啟 {name} 嗎？」，確認後呼叫 `POST /api/v1/services/{name}/restart`，服務重新啟動或啟動，並以 toast 顯示操作成功提示
12. **Given** 某服務狀態為 inactive，**When** 點擊 Restart 按鈕並確認，**Then** 服務被啟動（等同 Start），狀態更新為 active (running)

**服務鎖定：**
13. **Given** 某服務的 locked 欄位為 true，**When** 檢視列表，**Then** 該服務的操作欄顯示 🔒 鎖定圖示，不顯示任何 Start/Stop/Restart 按鈕
14. **Given** 某服務為鎖定狀態，**When** 切換至「系統服務」分頁，**Then** 該服務顯示於此分頁中，僅供檢視，無法操作

**錯誤處理：**
15. **Given** 執行 Start/Stop/Restart 操作失敗（如權限不足或服務不存在），**When** API 回傳 500，**Then** 前端以 toast 顯示「{name} 操作失敗」，具體錯誤原因僅記錄於伺服器 log，不揭露給客戶端
16. **Given** API 呼叫時 session 已過期，**When** API 回傳 401，**Then** 前端自動導向登入頁

**邊界案例：**
- 服務名稱包含特殊字元（如 `@`、`-`、`.`）時，列表仍能正確顯示且操作正常
- 同時多位管理員對同一服務執行衝突操作（A 按 Stop、B 按 Start），以後執行者為準，前操作者若失敗則顯示服務狀態已變更
- 切換「我的服務」與「系統服務」分頁時，搜尋關鍵字仍維持，過濾條件僅在當前分頁內生效

**非功能性需求：**
- 列表載入時間不超過 3 秒（服務數量 < 500 個）
- Start/Stop/Restart 操作後 5 秒內反映最新狀態
- 介面支援 i18n 多語言切換（繁體中文 / English）
- 介面支援 RWD，在手機與桌面皆可正常操作
- 操作反饋使用 toast 通知，非阻擋式彈窗

**優先級：** Must

**複雜度：** M
