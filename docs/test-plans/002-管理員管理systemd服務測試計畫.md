# 002 — 管理員管理 systemd 服務測試計畫

> 對應 BDD：`docs/bdds/002-管理員管理systemd服務.feature`（18 scenarios）
> 對應 User Story：`docs/user-stories/002-管理員管理systemd服務.md`

## 📌 摘要

| 項目 | 內容 |
|------|------|
| **BDD Scenarios** | 18 個（含 2 個非本系統範圍） |
| **現有測試** | 10 個 scenario 已覆蓋 |
| **待補測試** | 6 個 scenario |
| **目標覆蓋率** | 16/16 可測場景 = 100% |
| **預估工時** | 2.5 天 |

---

## 1. BDD Scenario 覆蓋分析

### 查詢服務列表

| # | Scenario | Tag | 現有測試 | 狀態 |
|---|----------|-----|---------|:---:|
| 1 | 載入服務列表 | @p0 | `TestServicesList_Success` + `ServiceTable.spec.ts` | ✅ |
| 2 | 以關鍵字搜尋過濾服務 | @p0 | `ServiceTable.spec.ts` | ✅ |
| 3 | 重新整理服務列表 | @p0 | ❌ | 🔴 |
| 4 | 已移除的服務從列表中消失 | @p0 | ❌ | 🟡 |

### Start 服務

| # | Scenario | Tag | 現有測試 | 狀態 |
|---|----------|-----|---------|:---:|
| 5 | 成功啟動已停止的服務 | @p0 | `TestServiceStart_Success` | ✅ |
| 9 | Start 已在執行的服務時按鈕隱藏 | @p1 | `ServiceTable.spec.ts` | ✅ |

### Stop 服務

| # | Scenario | Tag | 現有測試 | 狀態 |
|---|----------|-----|---------|:---:|
| 6 | 成功停止執行中的服務 | @p0 | `TestServiceStop_Success` | ✅ |
| 10 | Stop 已停止的服務時按鈕隱藏 | @p1 | `ServiceTable.spec.ts` | ✅ |

### Restart 服務

| # | Scenario | Tag | 現有測試 | 狀態 |
|---|----------|-----|---------|:---:|
| 7 | 成功重啟執行中的服務 | @p0 | `TestServiceRestart_Success` | ✅ |
| 8 | 對已停止的服務執行 Restart 等同 Start | @p1 | ❌ | 🔴 |

### 錯誤處理

| # | Scenario | Tag | 現有測試 | 狀態 |
|---|----------|-----|---------|:---:|
| 11 | 操作失敗時顯示通用錯誤提示 | @p1 | `TestServiceStart_Error` + `TestServiceStop_Error` | ✅ |
| 12 | 服務名稱包含特殊字元 | @p1 | `TestServiceAction_SpecialCharacters` | ✅ |

### 邊界案例

| # | Scenario | Tag | 現有測試 | 狀態 |
|---|----------|-----|---------|:---:|
| 13 | 多人同時對同一服務執行衝突操作 | @p2 | ❌ | ⚫ 尚未實作衝突偵測 |

### 業務規則

| # | Scenario | Tag | 現有測試 | 狀態 |
|---|----------|-----|---------|:---:|
| 14 | Stop 操作需要二次確認 | @p0 | ❌ | 🔴 |
| 15 | Restart 操作需要二次確認 | @p0 | ❌ | 🔴 |
| 16 | Start 操作不需要二次確認 | @p0 | ❌ | 🔴 |
| 17 | 鎖定的服務無法操作 | @p1 | `ServiceTable.spec.ts` | ✅ |

### 系統行為

| # | Scenario | Tag | 現有測試 | 狀態 |
|---|----------|-----|---------|:---:|
| 18 | 停止服務不自動影響其依賴服務 | @p1 | ❌ | ⚫ 屬 systemd 行為，非本系統範圍 |

---

## 2. 待補測試項目

### 🔴 P0（必須補齊 — 對應 @p0 BDD 場景）

| ID | 測試名稱 | 類型 | 檔案位置 | 對應 Scenario |
|----|---------|------|---------|:---:|
| F03 | ConfirmModal: Stop 二次確認對話框 | 前端單元 | `__tests__/ConfirmModal.spec.ts` | #14 |
| F04 | ConfirmModal: Restart 二次確認對話框 | 前端單元 | `__tests__/ConfirmModal.spec.ts` | #15 |
| F05 | ServiceRow: Start 不彈確認對話框 | 前端單元 | `__tests__/ServiceRow.spec.ts` | #16 |
| F06 | ServiceRow: Stop/Restart 發射 confirm 事件 | 前端單元 | `__tests__/ServiceRow.spec.ts` | #14, #15 |
| F07 | Toolbar: 重新整理按鈕 emit refresh | 前端單元 | `__tests__/Toolbar.spec.ts` | #3 |
| F09 | AppHeader: 重新整理 emit | 前端單元 | `__tests__/AppHeader.spec.ts` | #3 |

### 🟡 P1（應該補齊 — 對應 @p1 BDD 場景）

| ID | 測試名稱 | 類型 | 檔案位置 | 對應 Scenario |
|----|---------|------|---------|:---:|
| F32 | ServiceRow: inactive→Start 按鈕顯示、Restart 顯示 | 前端單元 | `__tests__/ServiceRow.spec.ts` | #5, #8 |
| F33 | ServiceRow: active→Stop+Restart 按鈕顯示 | 前端單元 | `__tests__/ServiceRow.spec.ts` | #6, #7 |
| F34 | ServiceRow: failed→Start 按鈕顯示 | 前端單元 | `__tests__/ServiceRow.spec.ts` | #5 |
| F35 | Restart inactive 服務等同 Start（後端驗證） | 後端整合 | `internal/handler/handler_test.go` | #8 |

### 📦 相關基礎設施測試

| ID | 測試名稱 | 類型 | 檔案位置 | 說明 |
|----|---------|------|---------|------|
| F29 | useToast composable: 顯示/自動消失 | 前端單元 | `__tests__/useToast.spec.ts` | 操作結果通知 |
| F30 | ToastContainer 元件渲染 | 前端單元 | `__tests__/ToastContainer.spec.ts` | Toast UI |
| F26 | useTheme composable: 深色/淺色切換 | 前端單元 | `__tests__/useTheme.spec.ts` | 儀表板主題 |
| F27 | useTheme: 系統偏好偵測 | 前端單元 | `__tests__/useTheme.spec.ts` | 自動主題 |
| F28 | useTheme: localStorage 持久化 | 前端單元 | `__tests__/useTheme.spec.ts` | 主題偏好 |
| F39 | systemd: ValidateServiceName 合法/非法名稱 | 後端單元 | `internal/systemd/systemd_test.go` | #12 |
| F40 | systemd: parseSystemctlOutput 正常/空/畸形 | 後端單元 | `internal/systemd/systemd_test.go` | #1 |

---

## 3. 測試案例明細

### F03 / F04 — ConfirmModal 元件

```typescript
// frontend/src/__tests__/ConfirmModal.spec.ts
describe('確認對話框 — 使用者互動', () => {
  it('Stop 操作顯示「確定要停止 {name} 嗎？」')
  it('Restart 操作顯示「確定要重啟 {name} 嗎？」')
  it('點擊「取消」按鈕，emit cancel 事件')
  it('點擊「確認」按鈕，emit confirm 事件')
  it('未傳入 visible=true 時不渲染')
  it('支援 i18n 多語言切換（zh-TW / en）')
})
```

### F05 / F06 / F32-F34 — ServiceRow 元件

```typescript
// frontend/src/__tests__/ServiceRow.spec.ts
describe('服務列表列 — 按鈕狀態', () => {
  // 按鈕可見性
  it('inactive (dead) 服務：顯示 Start 與 Restart 按鈕，不顯示 Stop')
  it('active (running) 服務：顯示 Stop 與 Restart 按鈕，不顯示 Start')
  it('failed 服務：顯示 Start 與 Restart 按鈕，不顯示 Stop')
  it('locked=true 服務：顯示 🔒 鎖定圖示，不顯示任何按鈕')

  // 確認對話框
  it('點擊 Start 按鈕：直接 emit start 事件，不彈確認（#16）')
  it('點擊 Stop 按鈕：emit confirm-stop 事件，由父層決定是否顯示 ConfirmModal（#14）')
  it('點擊 Restart 按鈕：emit confirm-restart 事件，由父層決定是否顯示 ConfirmModal（#15）')

  // 特殊字元服務名稱
  it('服務名稱含 @ 字元，仍正確渲染')
  it('服務名稱含 - 字元，仍正確渲染')
})
```

### F07 / F09 — Toolbar / AppHeader

```typescript
// frontend/src/__tests__/Toolbar.spec.ts
describe('工具列 — 使用者操作', () => {
  it('點擊「重新整理」按鈕，emit refresh 事件')
  it('搜尋欄輸入關鍵字，emit search 事件（含 debounce）')
})

// frontend/src/__tests__/AppHeader.spec.ts
describe('頂部導航列', () => {
  it('點擊「重新整理」按鈕，emit refresh 事件')
  it('顯示服務管理標題')
})
```

### F29 / F30 — Toast 通知

```typescript
// frontend/src/__tests__/useToast.spec.ts
describe('Toast 通知 composable', () => {
  it('showToast("nginx 已啟動") → toasts 陣列新增一筆 success')
  it('showToast("操作失敗", "error") → toasts 陣列新增一筆 error')
  it('3.5 秒後 toast 自動移除')
})

// frontend/src/__tests__/ToastContainer.spec.ts
describe('Toast 容器元件', () => {
  it('無 toast 時不渲染任何元素')
  it('有 2 個 toast 時渲染 2 個通知')
  it('success toast 使用綠色樣式')
  it('error toast 使用紅色樣式')
})
```

### F35 — 後端 Restart inactive 服務

```go
// handler_test.go 擴充
func TestServiceRestart_InactiveService(t *testing.T) {
    // 1. Mock systemd: myapp.service 為 inactive
    // 2. POST /api/v1/services/myapp.service/restart
    // 3. 預期 200 OK，呼叫了 RestartService("myapp.service")
    // 4. 行為等同 Start（後端不區分 active/inactive，交由 systemctl restart 處理）
}
```

### F26-F28 — useTheme

```typescript
// frontend/src/__tests__/useTheme.spec.ts
describe('主題 composable', () => {
  it('toggleTheme() 在 dark ↔ light 之間切換')
  it('setTheme("dark") 設定 document.documentElement data-theme')
  it('無 localStorage 時，依 window.matchMedia 偏好決定')
  it('有 localStorage 時，優先使用 localStorage 值')
})
```

### F39 / F40 — systemd 純函數

```go
// src/internal/systemd/systemd_test.go
func TestValidateServiceName(t *testing.T) {
    tests := []struct {
        name    string
        wantErr bool
    }{
        {"nginx.service", false},
        {"my-app.service", false},
        {"myapp@.service", false},
        {"my.app.service", false},
        {"", true},
        {"no-suffix", true},
        {"../etc/passwd", true},
    }
    for _, tt := range tests { ... }
}

func TestParseSystemctlOutput(t *testing.T) {
    // 正常輸出
    // 空輸出 → []Service{}
    // 畸形行（少於 4 欄位）→ 跳過
    // 非 .service 結尾的行 → 過濾
}
```

---

## 4. 執行順序

```
Phase 3a (1d) — 前端核心互動元件
├── __tests__/ConfirmModal.spec.ts   (F03, F04)
├── __tests__/ServiceRow.spec.ts     (F05, F06, F32-F34)
└── __tests__/Toolbar.spec.ts        (F07)

Phase 3b (0.5d) — Toast + 主題 + AppHeader
├── __tests__/useToast.spec.ts       (F29)
├── __tests__/ToastContainer.spec.ts (F30)
├── __tests__/useTheme.spec.ts       (F26-F28)
└── __tests__/AppHeader.spec.ts      (F09)

Phase 4 (0.5d) — 後端擴充
├── handler_test.go 擴充             (F35)
└── systemd_test.go                  (F39, F40)

Phase 5 (0.5d) — 整合測試
└── __tests__/DashboardView.spec.ts  (完整服務管理流程)
```

---

## 5. 驗收標準

- [ ] 18 個 Scenario 中 16 個可測場景有對應測試（#13 未實作、#18 非本系統）
- [ ] ConfirmModal 覆蓋 Stop/Restart 兩種二次確認
- [ ] ServiceRow 覆蓋 4 種服務狀態（active / inactive / failed / locked）的按鈕顯示
- [ ] Toast 通知覆蓋 success / error 兩種型態與自動消失
- [ ] `go test ./internal/systemd/...` 全部通過
- [ ] `npx vitest run` 全部通過

---

*對應主計畫：`docs/tech-decision-測試案例補齊計畫-2025-08-07.md`*
