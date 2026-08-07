# 002 — 管理員查詢服務列表並執行啟停操作

**User Story：**
> As a 已登入的團隊管理員，
> I want 查看 Linux 主機上的 systemd 服務狀態，並對特定服務執行 Start、Stop、Restart，
> So that 我可以在不登入 SSH 的情況下，快速處理服務異常或進行例行維護。

**驗收條件：**

**查詢服務列表：**
1. **Given** 已登入，**When** 進入服務列表頁，**Then** 顯示所有 systemd 服務名稱、Load 狀態、Active 狀態、Sub 狀態，並支援關鍵字搜尋過濾
2. **Given** 服務列表已載入，**When** 點擊重新整理按鈕，**Then** 重新讀取最新服務狀態並更新列表
3. **Given** 某服務不存在或已移除，**When** 重新整理列表，**Then** 該服務從列表中消失，不顯示錯誤

**Start 服務：**
4. **Given** 某服務狀態為 inactive (dead)，**When** 點擊 Start 按鈕，**Then** 服務啟動，狀態更新為 active (running)，並顯示操作成功提示
5. **Given** 某服務已在執行中，**When** 點擊 Start 按鈕，**Then** 按鈕為禁用狀態或操作後顯示「服務已在執行中」提示

**Stop 服務：**
6. **Given** 某服務狀態為 active (running)，**When** 點擊 Stop 按鈕，**Then** 服務停止，狀態更新為 inactive (dead)，並顯示操作成功提示
7. **Given** 某服務已停止，**When** 點擊 Stop 按鈕，**Then** 按鈕為禁用狀態或操作後顯示「服務已停止」提示

**Restart 服務：**
8. **Given** 某服務狀態為 active (running)，**When** 點擊 Restart 按鈕，**Then** 服務重新啟動，過程中短暫顯示 intermediate 狀態，最終回到 active (running)，並顯示操作成功提示
9. **Given** 某服務狀態為 inactive，**When** 點擊 Restart 按鈕，**Then** 服務被啟動（等同 Start），狀態更新為 active (running)

**錯誤處理：**
10. **Given** 執行 Start/Stop/Restart 操作失敗（如權限不足或服務不存在），**When** 操作完成，**Then** 顯示具體錯誤原因（如「權限不足：無法操作此服務」）

**邊界案例：**
- 某服務依賴其他服務（如 nginx 依賴 network），停止或重啟時不自動影響依賴服務，由管理員自行判斷
- 服務名稱包含特殊字元（如 `@`、`-`、`.`）時，列表仍能正確顯示且操作正常
- 同時多位管理員對同一服務執行衝突操作（A 按 Stop、B 按 Start），以後執行者為準，前操作者若失敗則顯示服務狀態已變更提示

**非功能性需求：**
- 列表載入時間不超過 3 秒（服務數量 < 500 個）
- Start/Stop/Restart 操作後 5 秒內反映最新狀態
- 操作按鈕需二次確認（Stop/Restart 才需要，Start 不需要），防止誤觸

**優先級：** Must

**複雜度：** M
