# 服務搜尋強化測試計畫

> **對應 BDD**：[007-service-search-enhancement.feature](../bdds/007-service-search-enhancement.feature)
> **對應技術決策**：[007-service-search-enhancement.md](../tech-decisions/007-service-search-enhancement.md)
> **對應開發規格**：[007-service-search-enhancement.md](../development/007-service-search-enhancement.md)
> **測試日期**：待定
> **測試狀態**：待執行

---

## 1. 測試範圍與策略

### 測試層級

| 層級 | 工具 | 範圍 |
|------|------|------|
| **單元測試** | Vitest | `useServiceFilter` composable：過濾邏輯、debounce、regex 驗證、URL sync |
| **E2E 測試** | Playwright | 完整互動流程：狀態過濾、文字搜尋、正則模式、複合過濾、錯誤處理、空狀態、載入狀態、Tab 切換、URL sync |

### 測試環境

| 環境 | 用途 |
|------|------|
| localhost (Vite dev) | 開發階段快速迭代測試 |
| Chrome / Firefox / Safari | 跨瀏覽器相容性 |
| Mobile viewport (≤768px) | RWD 響應式驗證 |

---

## 2. 測試案例

### 2.1 狀態過濾（P0）

| ID | 測試案例 | BDD Scenario | 類型 | 優先級 |
|----|---------|-------------|------|--------|
| SF-01 | 點擊「🟢 Running」過濾，列表僅顯示 running 服務 | 一鍵過濾顯示所有 Running 服務 | E2E | P0 |
| SF-02 | 點擊「🔴 Failed」過濾，列表僅顯示 failed 服務 | 一鍵過濾顯示所有 Failed 服務 | E2E | P0 |
| SF-03 | 點擊「⚪ Inactive」過濾，列表僅顯示 inactive 服務 | 一鍵過濾顯示所有 Inactive 服務 | E2E | P0 |
| SF-04 | 再次點擊已 active 的按鈕取消過濾，回到 All | 再次點擊已 active 的狀態按鈕取消過濾 | E2E | P0 |
| SF-05 | 點擊不同狀態按鈕時切換 active（前一個取消） | 切換至不同狀態過濾 | E2E | P0 |
| SF-06 | 點擊「All」按鈕清除狀態過濾 | 點擊「All」按鈕清除狀態過濾但保留文字搜尋 | E2E | P0 |

### 2.2 文字搜尋（P0）

| ID | 測試案例 | BDD Scenario | 類型 | 優先級 |
|----|---------|-------------|------|--------|
| TS-01 | 輸入關鍵字後 debounce 150ms 篩選服務名稱（不分大小寫） | 以關鍵字即時搜尋服務名稱（普通模式） | E2E | P0 |
| TS-02 | 輸入後搜尋框顯示清除 ✕ 按鈕 | 同上 | E2E | P0 |
| TS-03 | 點擊清除 ✕ 按鈕清空搜尋並恢復列表 | 清除文字搜尋恢復完整列表 | E2E | P0 |
| TS-04 | 輸入「NGINX」可匹配「nginx」、「Nginx」等變體 | 普通模式文字搜尋不分大小寫 | 單元 | P1 |
| TS-05 | 快速連續輸入 5 個字元僅觸發一次篩選 | 文字輸入 debounce 150ms 後才觸發篩選 | 單元 | P1 |

### 2.3 正則搜尋（P0）

| ID | 測試案例 | BDD Scenario | 類型 | 優先級 |
|----|---------|-------------|------|--------|
| RX-01 | 點擊正則開關從 OFF → ON，placeholder 變更、開關 highlight | 開啟正則模式以正則表達式搜尋服務 | E2E | P0 |
| RX-02 | 輸入合法正則「nginx-.*」即時篩選匹配服務 | 在正則模式下以合法正則表達式篩選服務 | E2E | P0 |
| RX-03 | 關閉正則模式（ON → OFF），恢復普通搜尋 | 關閉正則模式回到普通文字搜尋 | E2E | P0 |
| RX-04 | 搜尋框已有文字時開啟正則模式，立即以正則重新評估 | 開啟正則模式時搜尋框已有文字則立即以正則重新評估 | E2E | P0 |
| RX-05 | 輸入不合法正則「[invalid(regex」→ 紅框 + 錯誤提示 + 列表不更新 | 輸入不合法的正則表達式時顯示錯誤且不更新列表 | E2E | P0 |
| RX-06 | 修正正則語法後錯誤消失並恢復篩選 | 修正正則語法錯誤後錯誤提示消失並恢復篩選 | E2E | P0 |
| RX-07 | 關閉正則模式可清除正則錯誤狀態 | 關閉正則模式可立即清除正則錯誤狀態 | E2E | P0 |
| RX-08 | 正則「nginx」不加 i flag 僅匹配小寫 | 正則模式大小寫由使用者透過 flag 控制 | 單元 | P1 |
| RX-09 | 正則「/nginx/i」匹配不分大小寫 | 同上 | 單元 | P1 |
| RX-10 | 確認使用 JS RegExp 引擎（ECMAScript 規範） | 正則模式使用 JavaScript RegExp 引擎 | 單元 | P1 |

### 2.4 複合過濾（P0）

| ID | 測試案例 | BDD Scenario | 類型 | 優先級 |
|----|---------|-------------|------|--------|
| CF-01 | 狀態過濾 Running + 文字搜尋 nginx → 取交集 | 狀態過濾與文字搜尋同時作用取交集 | E2E | P0 |
| CF-02 | 狀態過濾 Failed + 正則搜尋 php.* → 取交集 | 狀態過濾與正則搜尋同時作用取交集 | E2E | P0 |
| CF-03 | 變更任一過濾條件立即重新計算交集 | 複合過濾中任一條件變更即重新計算交集 | E2E | P0 |
| CF-04 | 點擊「All」清除狀態但保留文字搜尋 | 點擊「All」按鈕清除狀態過濾但保留文字搜尋 | E2E | P0 |

### 2.5 錯誤處理（P0/P1）

| ID | 測試案例 | BDD Scenario | 類型 | 優先級 |
|----|---------|-------------|------|--------|
| ER-01 | 輸入不存在的關鍵字 → 空狀態頁面 + 提示文字 + 清除按鈕 | 過濾結果為空時顯示空狀態頁面 | E2E | P1 |
| ER-02 | 點擊「清除過濾」按鈕恢復完整列表 | 從空狀態點擊清除過濾恢復完整列表 | E2E | P1 |

### 2.6 載入狀態（P1）

| ID | 測試案例 | BDD Scenario | 類型 | 優先級 |
|----|---------|-------------|------|--------|
| LD-01 | 載入中時狀態過濾按鈕 disabled，搜尋框可輸入但不生效 | 服務列表載入中時過濾按鈕為不可用狀態 | E2E | P1 |
| LD-02 | 載入完成後自動套用等待中的過濾條件 | 服務列表載入完成後自動套用等待中的過濾條件 | E2E | P1 |

### 2.7 Tab 切換（P1）

| ID | 測試案例 | BDD Scenario | 類型 | 優先級 |
|----|---------|-------------|------|--------|
| TB-01 | 我的服務 → 系統服務：狀態過濾保留並套用 | Tab 切換時過濾條件保留並對新 Tab 服務集合套用 | E2E | P1 |
| TB-02 | 我的服務 → 系統服務：文字搜尋保留並套用 | Tab 切換時文字搜尋條件保留並對新 Tab 服務集合套用 | E2E | P1 |

### 2.8 URL 同步（P2）

| ID | 測試案例 | BDD Scenario | 類型 | 優先級 |
|----|---------|-------------|------|--------|
| URL-01 | 狀態過濾 + 文字搜尋 + 正則模式 → URL query 同步 | 過濾狀態同步至 URL query string | E2E | P2 |
| URL-02 | 從帶參數 URL 進入時自動恢復過濾條件 | 從帶有過濾參數的 URL 進入時自動恢復過濾條件 | E2E | P2 |
| URL-03 | 瀏覽器上一頁 / 下一頁時過濾狀態恢復 | 瀏覽器上一頁 / 下一頁時過濾狀態正確恢復 | E2E | P2 |

### 2.9 商業規則（P1）

| ID | 測試案例 | BDD Scenario | 類型 | 優先級 |
|----|---------|-------------|------|--------|
| BR-01 | 狀態過濾僅作用於當前 Tab 服務集合 | 狀態過濾僅作用於當前 Tab 的服務集合 | E2E | P1 |
| BR-02 | 文字搜尋僅作用於當前 Tab 服務集合 | 文字搜尋僅作用於當前 Tab 的服務集合 | E2E | P1 |
| BR-03 | 所有過濾操作不發送 API 請求 | 所有過濾操作在前端執行不發送 API 請求 | E2E | P1 |
| BR-04 | StatsBar 數字反映全域統計不受過濾影響 | StatsBar 數字反映全域統計不受過濾影響 | E2E | P1 |

### 2.10 RWD（P2）

| ID | 測試案例 | BDD Scenario | 類型 | 優先級 |
|----|---------|-------------|------|--------|
| RWD-01 | 手機佈局 (≤768px) 下過濾按鈕不擠壓搜尋框 | 手機佈局下過濾按鈕不擠壓搜尋框 | E2E | P2 |

### 2.11 深色模式（P2）

| ID | 測試案例 | BDD Scenario | 類型 | 優先級 |
|----|---------|-------------|------|--------|
| DM-01 | 深色模式下 active/inactive 按鈕樣式清晰可辨 | 深色模式下過濾按鈕 active/inactive 樣式正常 | E2E | P2 |

---

## 3. 單元測試規格

### 3.1 useServiceFilter 測試

```typescript
// frontend/src/composables/__tests__/useServiceFilter.spec.ts

describe('useServiceFilter', () => {
  describe('statusFilter', () => {
    it('預設為 all')
    it('setStatusFilter("running") → statusFilter 變為 running')
    it('setStatusFilter 同一值兩次 → 取消回到 all')
    it('切換不同狀態 → 前一個取消，新狀態 active')
  })

  describe('textSearch', () => {
    it('空字串 → 不篩選，顯示全部')
    it('輸入 "nginx" → 僅顯示名稱含 nginx 的服務（不分大小寫）')
    it('輸入後 150ms 內不觸發篩選')
    it('150ms 後以完整關鍵字篩選一次')
    it('清除文字 → 恢復完整列表')
  })

  describe('regexMode', () => {
    it('預設為 false')
    it('toggleRegex() → true')
    it('toggleRegex() 再呼叫 → false')
    it('合法正則 "nginx-.*" → 正確篩選匹配服務')
    it('不合法正則 "[invalid" → regexError 非 null、列表不更新')
    it('關閉正則模式 → regexError 清除')
  })

  describe('combined filtering', () => {
    it('狀態 running + 文字 nginx → 取交集')
    it('變更任一條件 → 重新計算交集')
    it('點擊 All → 僅清除狀態過濾，文字搜尋保留')
  })

  describe('URL sync', () => {
    it('過濾條件變更 → router.replace 被呼叫')
    it('onMounted → 從 route.query 初始化過濾條件')
  })
})
```

---

## 4. E2E 測試骨架

E2E 測試將於實作完成後依 BDD scenarios 撰寫 Playwright spec。

預計測試檔案：`frontend/e2e/007-service-search-enhancement.spec.ts`

預估案例數：約 30 個 scenarios（對應上方 2.1 ~ 2.11 所有 P0/P1 測試案例）

---

## 5. 測試執行順序

| 階段 | 內容 | 觸發時機 |
|------|------|---------|
| **開發中** | 單元測試：useServiceFilter（Vitest） | 每步開發完成後立即執行 |
| **開發完成** | E2E 測試：完整互動流程（Playwright） | 所有元件整合完成後 |
| **迴歸** | 全測試套件 | PR / Merge 前 |

---

*最後更新：2025-08-10*
