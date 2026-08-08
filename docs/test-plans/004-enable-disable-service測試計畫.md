# 004 — Enable / Disable 開機自動啟動測試計畫

> 對應 BDD：`docs/bdds/004-enable-disable-service.feature`（19 scenarios）
> 對應互動流程：`docs/interaction-flows/004-enable-disable-service.md`
> 對應開發方案：`docs/tech-decision-enable-disable-service-2025-08-08.md`

## 📌 摘要

| 項目 | 內容 |
|------|------|
| **BDD Scenarios** | 19 個（17 Scenario + 2 Scenario Outline） |
| **現有測試** | 0 個（全新功能） |
| **待補測試** | 19 個 scenario |
| **目標覆蓋率** | 19/19 可測場景 = 100% |
| **預估工時** | 2 天 |

---

## 1. BDD Scenario 覆蓋分析

### Happy Path — 正常流程

| # | Scenario | Tag | 測試類型 | 狀態 |
|---|----------|-----|---------|:---:|
| 1 | 檢視服務列表中的 Auto-start 欄位 | @smoke @happy-path @p0 | 單元 + e2e | 🔴 |
| 2 | 開啟開機自動啟動（不需確認對話框） | @smoke @happy-path @p0 | 單元 + e2e | 🔴 |
| 3 | 關閉開機自動啟動（需確認對話框） | @happy-path @p0 | 單元 + e2e | 🔴 |
| 4 | 取消關閉開機自動啟動的確認對話框 | @happy-path @p0 | 單元 + e2e | 🔴 |
| 5 | 根據 UnitFileState 顯示正確的 Auto-start 狀態 (Outline: 4 examples) | @happy-path @p1 | 單元 | 🔴 |

### Error Handling — 錯誤處理

| # | Scenario | Tag | 測試類型 | 狀態 |
|---|----------|-----|---------|:---:|
| 6 | 操作失敗時權限不足 | @error-handling @p0 | 單元 | 🔴 |
| 7 | 操作失敗時服務不存在 | @error-handling @p0 | 單元 | 🔴 |
| 8 | 網路連線異常導致操作失敗 | @error-handling @p1 | e2e | 🔴 |
| 9 | systemctl 指令執行逾時 | @error-handling @p1 | 單元 | 🔴 |

### Edge Cases — 邊界情況

| # | Scenario | Tag | 測試類型 | 狀態 |
|---|----------|-----|---------|:---:|
| 10 | 鎖定的服務不可操作 Auto-start | @edge-case @p1 | 單元 + e2e | 🔴 |
| 11 | 不適用 enable/disable 的 UnitFileState 顯示「不適用」 (Outline: 3 examples) | @edge-case @p1 | 單元 | 🔴 |
| 12 | 操作期間 Toggle 進入 loading 狀態防止重複切換 | @edge-case @p1 | 單元 | 🔴 |
| 13 | 多人同時操作時以 systemd 實際狀態為準 | @edge-case @p1 | 單元 | 🔴 |
| 14 | 深色模式下 Toggle 樣式正常 | @edge-case @p2 | e2e (視覺) | 🔴 |
| 15 | 手機 RWD 卡片佈局下 Auto-start 欄位正常顯示 | @edge-case @p2 | e2e (視覺) | 🔴 |

### Business Rules — 商業規則驗證

| # | Scenario | Tag | 測試類型 | 狀態 |
|---|----------|-----|---------|:---:|
| 16 | 僅 FragmentPath 在 /etc/systemd/system/ 下的服務可操作 Auto-start | @business-rules @p0 | 單元 | 🔴 |
| 17 | 開啟自動啟動不需確認對話框（低風險操作） | @business-rules @p0 | 單元 | 🔴 |
| 18 | 關閉自動啟動需確認對話框（高風險操作） | @business-rules @p0 | 單元 + e2e | 🔴 |
| 19 | enable/disable 操作逾時上限為 15 秒 | @business-rules @p1 | 單元 | 🔴 |

---

## 2. 待補測試項目

### 2.1 後端單元測試（Go）

#### `systemd_test.go` — 新增測試

```go
// TestEnableService_Success
//   模擬 systemctl enable 成功 → 回傳 nil

// TestEnableService_Error
//   模擬 systemctl enable 失敗（如權限不足） → 回傳 error

// TestDisableService_Success
//   模擬 systemctl disable 成功 → 回傳 nil

// TestDisableService_Error
//   模擬 systemctl disable 失敗 → 回傳 error

// TestEnableService_InvalidName
//   傳入非法服務名稱 → ValidateServiceName 攔截

// TestDisableService_InvalidName
//   傳入非法服務名稱 → ValidateServiceName 攔截

// TestListServices_IncludesUnitFileState
//   驗證 ListServices 回傳的 Service 包含 UnitFileState 和 FragmentPath

// TestEnableService_Timeout
//   模擬 systemctl enable 逾時 15 秒 → 回傳 timeout error

// TestDisableService_Timeout
//   模擬 systemctl disable 逾時 15 秒 → 回傳 timeout error
```

#### `handler_test.go` — 新增測試

```go
// TestHandleEnable_Success
//   POST /api/v1/services/foo.service/enable → 200 + {"message":"foo.service enabled"}

// TestHandleEnable_Error
//   後端 EnableService 失敗 → 500 + {"error":"..."}

// TestHandleDisable_Success
//   POST /api/v1/services/foo.service/disable → 200 + {"message":"foo.service disabled"}

// TestHandleDisable_Error
//   後端 DisableService 失敗 → 500 + {"error":"..."}

// TestHandleServices_IncludesUnitFileState
//   GET /api/v1/services → response 包含 unitFileState 和 fragmentPath 欄位

// TestHandleServices_LockedService
//   FragmentPath 非 /etc/systemd/system/ → locked: true, unitFileState 正確

// TestHandleServices_StaticService
//   UnitFileState = "static" → locked: true
```

### 2.2 前端單元測試（Vitest）

#### `ServiceRow.spec.ts` — 新增測試

```
// renders auto-start toggle for unlocked service
//   解鎖服務 → Toggle 存在且可操作

// renders lock icon for locked service
//   鎖定服務 → 顯示 🔒，無 Toggle

// renders "不適用" for static/masked/alias service
//   UnitFileState = static/masked/alias → 顯示「不適用」

// toggle displays ON when UnitFileState is enabled or enabled-runtime
//   UnitFileState = "enabled" / "enabled-runtime" → Toggle ON

// toggle displays OFF when UnitFileState is disabled or indirect
//   UnitFileState = "disabled" / "indirect" → Toggle OFF

// emits enable event when toggle switched to ON
//   點擊 Toggle OFF→ON → emit('toggle', 'enable', name)

// emits disable event when toggle switched to OFF
//   點擊 Toggle ON→OFF → emit('toggle', 'disable', name)

// shows loading state during operation
//   Toggle 操作中 → 顯示 loading 且不可點擊

// does not emit event when toggle is in loading state
//   loading 狀態中再次點擊 → 不觸發第二次 emit
```

#### `DashboardView.spec.ts` — 新增測試（或獨立的 enable-disable 測試）

```
// handleToggle enable calls API and shows success toast
//   觸發 enable → 呼叫 enableService API → Toast success → 重整列表

// handleToggle enable shows error toast on failure
//   觸發 enable → API 失敗 → Toast error

// handleToggle disable shows confirm modal
//   觸發 disable → ConfirmModal 彈出

// handleToggle disable confirm executes disable
//   確認對話框 → 點擊確認 → 呼叫 disableService API

// handleToggle disable cancel does nothing
//   確認對話框 → 點擊取消 → 不呼叫 API，Toggle 恢復

// services include unitFileState after load
//   loadServices 後 → Service 物件含 unitFileState 和 fragmentPath
```

### 2.3 E2E 測試（Playwright）

新建 `frontend/e2e/004-enable-disable-service.spec.ts`：

```
Test scenarios:
// toggle enable — no confirmation
//   1. 登入 → 找一個 disabled 服務 → 切換 Toggle ON
//   2. 驗證無 ConfirmModal 彈出
//   3. 驗證 Toast success
//   4. 重整後 Toggle 停在 ON

// toggle disable — with confirmation
//   1. 找一個 enabled 服務 → 切換 Toggle OFF
//   2. 驗證 ConfirmModal 彈出，內容包含服務名稱
//   3. 點擊取消 → Toggle 維持 ON
//   4. 再次切換 OFF → 點擊確認 → Toast success → Toggle OFF

// locked service shows lock icon
//   1. 確認鎖定服務的 Auto-start 欄位顯示 🔒
//   2. 驗證無法互動

// static/masked service shows "不適用"
//   1. 確認 static/masked 服務顯示「不適用」

// error handling: network failure
//   1. 模擬網路中斷 → 切換 Toggle
//   2. 驗證 Toast error + Toggle 恢復

// dark mode toggle visibility
//   1. 切換深色模式 → 驗證 Toggle 可見且狀態明確

// RWD mobile layout
//   1. 設定手機 viewport → 驗證卡片佈局中 Auto-start 欄位存在
```

---

## 3. 測試環境需求

| 環境 | 需求 |
|------|------|
| **Go 單元測試** | 既有 mock (systemd_test.go 中的 mockManager)，無需真實 systemd |
| **Vitest 單元測試** | happy-dom (已安裝)，mock axios |
| **Playwright e2e** | 需要 Linux 環境（或有 systemctl mock 的 container） |
| **真實環境驗收** | Linux with systemd，LMS 以 root 或具 systemctl 權限的使用者執行 |

---

## 4. 測試執行順序

```
Phase 1: 後端單元測試
  ├── systemd_test.go (EnableService / DisableService)
  ├── handler_test.go (HandleEnableJSON / HandleDisableJSON)
  └── 驗證 Service struct 含 UnitFileState + FragmentPath

Phase 2: 前端單元測試
  ├── ServiceRow.spec.ts (Toggle 狀態邏輯)
  ├── DashboardView 更新測試 (handleToggle)
  └── 驗證 client.ts API call

Phase 3: E2E 測試
  ├── 004-enable-disable-service.spec.ts
  └── 與 002-service-management.spec.ts 整合（不破壞既有測試）

Phase 4: 真實環境驗收
  ├── 依 BDD checklist 逐項驗證
  └── 確認 systemctl enable/disable 實際生效
```

---

## 5. 驗收檢查清單（對應互動流程 §7）

### 前端

- [ ] 服務列表有獨立「Auto-start」欄位，與 Actions 欄位明確區分
- [ ] 解鎖服務的 Auto-start 欄位出現 Toggle/Switch（依 UnitFileState 顯示 ON/OFF）
- [ ] 鎖定的服務 Auto-start 欄位顯示 🔒 不可操作
- [ ] static / masked / alias 服務 Auto-start 欄位顯示「不適用」
- [ ] 切換 Toggle 為 ON 不彈確認對話框，直接執行
- [ ] 切換 Toggle 為 OFF 彈出確認對話框，內容包含服務名稱和風險提示
- [ ] 確認對話框的「取消」按鈕關閉對話框，Toggle 維持 ON
- [ ] 確認對話框的「確認」按鈕關閉對話框，執行關閉自動啟動
- [ ] 操作期間 Toggle 顯示 loading 狀態且不可操作
- [ ] 操作成功後 Toast 顯示綠色成功通知
- [ ] 操作成功後 Toggle 停在最終狀態
- [ ] 操作失敗後 Toast 顯示紅色錯誤通知，Toggle 恢復原狀態
- [ ] 深色模式 / 淺色模式下 Toggle 樣式正常
- [ ] 手機 RWD 卡片佈局下 Auto-start 欄位正常顯示

### 後端

- [ ] `POST /api/v1/services/{name}/enable` 正確執行 `systemctl enable`
- [ ] `POST /api/v1/services/{name}/disable` 正確執行 `systemctl disable`
- [ ] 服務名稱驗證（`ValidateServiceName`）套用於 enable/disable
- [ ] 權限不足時回傳明確錯誤訊息
- [ ] `GET /api/v1/services` 回傳的資料包含 `unitFileState` 欄位
- [ ] 操作逾時時回傳適當錯誤

### 整合

- [ ] 在真實 Linux 環境測試 Toggle ON → 確認開機自動啟動生效
- [ ] 在真實 Linux 環境測試 Toggle OFF → 確認開機不再自動啟動
- [ ] 測試 disabled 服務的 Toggle 切 ON 不會觸發確認對話框
- [ ] 測試 enabled 服務的 Toggle 切 OFF 會觸發確認對話框

---

*建立日期：2025-08-08*
