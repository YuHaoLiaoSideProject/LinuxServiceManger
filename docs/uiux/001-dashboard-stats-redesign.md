# Dashboard 統計卡片（StatsBar）— 升級為狀態過濾 UI/UX 設計文件

> **對應頁面**：Dashboard（服務列表頂部區：StatsBar ＋ Toolbar）
> **狀態**：✅ 已實作（2025-08-11，驗收結果見 §9）
> **設計日期**：2025-08-11
> **畫面文件**：`docs/uiux/001-dashboard-stats-redesign-mockup.html`（互動 mockup，可切換主題／裝置／點擊卡片過濾）
> **相關元件**：`StatsBar.vue`、`Toolbar.vue`、`DashboardView.vue`、`useServiceFilter.ts`、`main.css`
> **決策（2025-08-11 使用者確認）**：
> 1. 「未啟用」卡片 = ActiveState `inactive`（服務目前沒在跑），與現有 filter 語意相同
> 2. 「執行中」統計與過濾統一為精確 `sub === 'running'`（卡片數字 = 點擊後的列數）
> 3. 移除 Toolbar 的 status pills，狀態過濾完全由 stat cards 承擔
> 4. 本輪僅產出設計文件與 mockup，實作留待下一步

---

## 1. 背景與目標

Dashboard 頂部目前有兩個獨立元件各自呈現「服務狀態統計」：

| 元件 | 呈現 | 互動 |
|------|------|------|
| `StatsBar.vue` | 3 張卡片：📋 總服務數／✅ 執行中／❌ 失敗 | **不可點**（`cursor: default`） |
| `Toolbar.vue` 內 pills | 4 顆：全部／執行中／失敗／未啟用（dot + count badge） | 可點擊，驅動 `useServiceFilter` |

同一份資訊以兩種形式並排呈現，且「未啟用」只在 pills 出現、卡片缺這個最重要的健康訊號。

**目標**：

1. 卡片即 filter：點「執行中」卡片 → 列表只剩執行中的服務（消滅功能重複）
2. 新增「未啟用」卡片，四張卡片構成完整的狀態篩選
3. Toolbar 移除 pills，瘦身為「搜尋＋計數＋重新整理」單列
4. 順帶修正**計數口徑不一致**（見 §2 P2/P3），確保「卡片數字 = 點擊後的列數」

---

## 2. 現況審計

| # | 問題 | 嚴重度 | 位置 |
|---|------|:---:|------|
| P1 | StatsBar 與 pills **功能重複**：同一份狀態統計以「不可點卡片 + 可點 pills」雙重呈現 | 高 | `StatsBar.vue` / `Toolbar.vue` |
| P1 | **計數口徑不一致**：StatsBar 用 `statsServices`（**跟 tab**：我的服務/系統服務），pills 用 `filterCounts`（**全部 services**）。「我的服務」tab 下，卡片數字與 pills 數字可能不同，且 pills 數字不等於表格實際行數 | 高 | `DashboardView.vue`（`statsServices` vs `filterCounts`） |
| P1 | **「執行中」定義不一致**：StatsBar 的 running = active family（`['active','running','activating','deactivating','reloading']`），pills filter = `sub === 'running'`。**卡片數字 ≠ 點擊 filter 後的列數** | 高 | `StatsBar.vue` vs `useServiceFilter.ts` |
| P2 | 卡片用 emoji（📋✅❌）當圖示，跨平台渲染不一致（011 已確立「移除 emoji-as-icon」原則） | 中 | `StatsBar.vue` |
| P2 | 「未啟用」（inactive）是健康訊號中最該被看到的類別，卻完全沒有卡片，只在 pills 出現 | 中 | `StatsBar.vue` |
| P3 | Toolbar 的「顯示 X / 共 Y」以**全部 services** 計數，未反映 tab 篩選（「我的服務」tab 下顯示 13/13，表格卻只有 8 列） | 低 | `DashboardView.vue` |

> **排版事實（2025-08-11 依 code 確認）**：
> - `.stats-bar` 為 `flex-wrap`，desktop 4 張卡片在 1280px 容器內單列綽綽有餘（現況 3 張 card `min-width:100px`）
> - `.toolbar` 移除 pills 後只剩搜尋（`flex:1`＋`max-width:400px`）＋計數＋重新整理，**維持單列**不觸發 wrap
> - mobile（≤767px）`.stats-bar` 已是橫向捲動（`flex-wrap:nowrap` + `overflow-x:auto` + scroll-snap），4 張卡片沿用此機制即可

---

## 3. 設計原則

1. **單一真相來源** — 狀態統計只出現在一處（stat cards），數字即 filter 結果數；pills 移除
2. **數字即承諾** — 卡片數字 = 點擊後表格列數（tab + 狀態），任何 filter 組合下都成立
3. **漸進式揭露** — 狀態瀏覽（點卡片）與精準搜尋（搜尋框）分層，互不干擾但可疊加
4. **語意化圖示** — emoji → inline SVG；狀態不以顏色單獨傳達（卡片有文字標籤）
5. **觸控與鍵盤優先** — 卡片是 `<button>`，有 focus ring、`aria-pressed`、44px 觸控目標

---

## 4. 目標設計

### 4.1 版面（Desktop ≥1024px）

```
┌──────────────────────────────────────────────────────────────┐
│ [我的服務 8] [系統服務 5]        ← TabsBar（不變）              │
│ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐                 │
│ │ ◉ 全部 │ │ ▶ 執行中│ │ ⚠ 失敗 │ │ ⏸ 未啟用│   ← 4 張卡片   │
│ │   8    │ │   4    │ │   1    │ │   3    │     （可點選）     │
│ └────────┘ └────────┘ └────────┘ └────────┘                 │
│ [🔍 搜尋服務... ✕]         顯示 4 / 共 8     [↻ 重新整理]     │
│ ──────────────────────────────────────────────────────────── │
│ ☑ │ nginx.service      │ ● 執行中 │ running │...             │
└──────────────────────────────────────────────────────────────┘
```

- 卡片群組語意 = radio 群組：點「執行中」→ 過濾；再點一次 → 回到「全部」；點「全部」→ 回到全部
- 與搜尋文字**疊加**（狀態 + 文字同時成立），與現有 `useServiceFilter` 行為一致
- 卡片計數 = **tab-filtered** 服務的狀態統計（與 TabsBar 的 myCount/systemCount 對齊）

### 4.2 卡片規格

| 卡片 | 圖示（SVG） | 左邊線 | 計數語意（tab-filtered） |
|------|------------|:---:|------|
| 全部 | 方格/堆疊 icon | `--lms-accent` | `services.length` |
| 執行中 | 播放 icon | `--lms-success` | `sub === 'running'` |
| 失敗 | 警示三角 icon | `--lms-danger` | `active === 'failed'` |
| 未啟用 | 暫停 icon | `--lms-muted` | `active === 'inactive'` |

**外觀**（沿用現況 stat-card 骨架，改為 `<button>`）：

- 高度：內容自然高度（icon 1.4rem + value 1.3rem + label 0.75rem，內距 0.6rem/1rem）
- 圓角：`--lms-radius`（10px）；卡片間距 0.6rem
- **Idle**：`--lms-surface` 底、`--lms-border` 邊框、左邊線依狀態色
- **Hover**：上浮 2px + shadow + 邊框 accent（沿用現況）
- **Active（filter 生效）**：accent 邊框 + `--lms-accent-light` 底色 + 左邊線保留 + value 色調加深
- **Focus-visible**：2px accent outline + offset 2px

### 4.3 Toolbar（pills 移除後）

```
[🔍 搜尋服務... ✕]  顯示 X / 共 Y   [↻ 重新整理]
```

- 移除 `status-filters` 群組與 `statusFilter`／`counts` props
- 「顯示 X / 共 Y」改為**反映表格視圖**：X = tab + status + search 後的列數，Y = tab-filtered 總數
  （修正現況「顯示 13/13、表格 8 列」的口徑問題）

### 4.4 互動規則

| 操作 | 結果 |
|------|------|
| 點「執行中」卡片 | `statusFilter = running`，卡片 active，表格只剩執行中，URL `?status=running`（沿用現有 URL sync） |
| 再點同一張卡片 | 回到 `statusFilter = all`（現有 `setStatusFilter` toggle 行為） |
| 點「全部」卡片 | `statusFilter = all` |
| 卡片 active 時打字搜尋 | 疊加篩選，卡片保持 active |
| 切換 tab | 卡片計數與表格一起切換（tab-filtered）；選取與 filter 行為沿用現況（`setTab` 會 `clearSelection`） |
| EmptyState「清除條件」 | `clearAllFilters()` → 回到全部（卡片 active 解除） |

---

## 5. 狀態與互動矩陣（stat card）

| 狀態 | 視覺 | 互動 |
|------|------|------|
| Idle | surface 底、border、左邊線狀態色、muted label | 可點擊（`cursor: pointer`） |
| Hover | 上浮 2px、shadow、邊框 accent | 觸發 filter（單擊） |
| Focus-visible | 2px accent outline + offset | 鍵盤 Enter/Space 觸發 |
| Active（filter on） | accent 邊框 + accent-light 底 + 左邊線保留 + `aria-pressed=true` | 再點一次 → 回到「全部」 |
| Disabled（loading） | 50% opacity、`not-allowed` | 不觸發；**保留既有 filter 狀態**（沿用現況：pills disabled 但 filter 不清除） |
| 空結果（0 筆） | 數字顯示 0，卡片仍可點 | 表格顯示 EmptyState＋「清除條件」 |
| Reduced-motion | 無位移/淡入動畫 | — |

---

## 6. 無障礙檢查清單

- [ ] **WCAG 4.1.2**：卡片群組 `role="group"` + `aria-label="狀態過濾"`；每張卡片 `<button>` + `aria-pressed`（與現有 pills 實作一致，改動最小）
- [ ] **WCAG 1.4.1**：狀態不以顏色單獨傳達 — 卡片有文字標籤（全部/執行中/失敗/未啟用）＋數字，左邊線僅為輔助
- [ ] **WCAG 2.4.7**：每張卡片 focus 時顯示 2px accent ring（button 原生支援）
- [ ] **WCAG 2.5.5**：卡片為大面積按鈕（desktop 高約 60px+、mobile 更高），遠超 40px 目標
- [ ] 圖示一律 `aria-hidden="true"` inline SVG，文字才是名稱
- [ ] 鍵盤：Tab 順序 = 視覺順序；卡片群組位於 TabsBar 之後、Toolbar 之前

---

## 7. RWD 行為

| 斷點 | 卡片 | Toolbar |
|------|------|---------|
| ≥1024px | 4 張單列（flex，`min-width:100px`） | 單列：搜尋｜計數｜重新整理 |
| 768–1023px | 4 張單列或 wrap（依容器寬度自然換行） | 允許 wrap：搜尋可換列並全寬 |
| ≤767px | **橫向捲動**（`flex-wrap:nowrap` + `overflow-x:auto`，卡片 `min-width:110px`，44px+ 觸控；**2025-08-12 修正：移除 scroll-snap**，原因見下） | 堆疊：搜尋全寬 44px，計數與重新整理一行 |

> **⚠️ 2025-08-12 決策修正（scroll-snap 移除）**：
> 手機版實機回報「卡片無法 filter」。根因：`scroll-snap-type: x proximity` ＋ `scroll-snap-align: start` 下，
> 點擊位於 snap 點附近（或部分露出）的卡片時，iOS Safari／部分 Android 瀏覽器會把點擊判為
> 「捲動至 snap 位置」手勢而吞掉 click 事件（scroll-snap tap-suppression），filter 因此不觸發。
> **修正**：保留橫向捲動與 `-webkit-overflow-scrolling: touch`，移除 `scroll-snap-type`／`scroll-snap-align`；
> 卡片加 `touch-action: manipulation`（消除 300ms 延遲）與 `-webkit-tap-highlight-color: transparent`。
> 影響：4 張卡片的捲動不再有 snap 吸附（滑動結束位置自由），換來點擊一律可靠 — filter 優先於 snap 美觀。
> 相關驗收：e2e `016-statcard-filter.spec.ts`（含捲動後立即點擊的 regression 測試）。

---

## 8. 實作建議

1. **`StatsBar.vue`**：
   - 卡片改為 `<button>`（`type="button"`），外包 `role="group"` + `aria-label`
   - props 增加 `statusFilter: StatusFilter`；emit `set-status-filter`
   - 計數統一：`total = length`、`running = sub==='running'`、`failed = active==='failed'`、`inactive = active==='inactive'`（與 `useServiceFilter` 的 filter 述詞**完全一致**，避免口徑漂移 — 可抽成共用述詞函式）
   - 新增第 4 張「未啟用」卡；emoji → inline SVG（方格/播放/警示/暫停）
   - 新增 `stats.inactive` i18n key（zh-Hant「未啟用」／en「Inactive」，可先沿用 `filter.inactive`）
2. **`Toolbar.vue`**：移除 `statusOptions`、`statusFilter`、`counts`、`set-status-filter` emit 與 status-filters 區塊；保留搜尋＋計數＋重新整理
3. **`DashboardView.vue`**：
   - 移除 `filterCounts`（計數邏輯移入 StatsBar）
   - `<StatsBar :services="statsServices" :statusFilter="statusFilter" @set-status-filter="setStatusFilter" />`
   - 修正 Toolbar 計數：`filteredCount = filteredServices.filter(按 tab).length`、`totalCount = statsServices.length`，與表格視圖一致
4. **`useServiceFilter.ts`**：不變（述詞已與新卡片一致：running=`sub==='running'`、inactive=`active==='inactive'`、failed=`active==='failed'`）。若抽共用述詞，改由該處匯出
5. **`main.css`**：新增 `.stat-card` button reset（border/background/font 繼承）、`.stat-card.active`、focus-visible ring、第 4 卡 `.stat-inactive` 左邊線；移除 `.toolbar .status-filters` 系列樣式
6. **測試**：
   - `StatsBar.spec.ts`：running 述詞改為 `sub==='running'`（現況範例含 `activating` 服務，數字會從 3 → 2）；新增「未啟用」卡斷言
   - `Toolbar.spec.ts`：移除 pills 相關斷言
   - e2e `007-service-search-enhancement.spec.ts`：pill locator（`.status-filters .btn-status`）改為 stat card locator
   - e2e `003-theme-i18n.spec.ts`：`stats-bar` 文字斷言保留（總服務數/執行中不變）

---

## 9. 驗收清單

- [x] 四張卡片（全部/執行中/失敗/未啟用）都可點擊過濾，點擊卡片後表格即時更新
- [x] **卡片數字 = 點擊後表格列數**（任一 tab × 任一 filter 組合；e2e 007 計數測試驗證）
- [x] 再點一次已選卡片 → 回到「全部」（toggle 行為與現有 pills 一致）
- [x] 卡片計數隨 tab 切換（「我的服務」tab 的「全部」= TabsBar 的 myCount）
- [x] Toolbar 無 pills，維持單列：搜尋｜計數｜重新整理
- [x] 搜尋與卡片 filter 可疊加；EmptyState「清除條件」重置一切（含 EmptyState bug 修復）
- [x] URL sync 正常（`?status=running`；e2e 007 URL 同步 3 項通過）
- [x] 無 emoji 圖示（全 SVG）；light/dark 兩主題可讀
- [x] 卡片 focus ring 可見；`aria-pressed` 正確
- [x] mobile 橫向捲動順滑（scroll-snap），觸控目標 ≥ 44px
- [x] 既有測試更新後全綠：`StatsBar.spec.ts`、`Toolbar.spec.ts`、e2e `003/007`；`005/006` 僅剩既有失敗

---

## 10. 影響範圍

| 檔案 | 變更 |
|------|------|
| `frontend/src/components/StatsBar.vue` | 卡片化 filter（button + aria-pressed + active 態）、新增未啟用卡、running 述詞統一、SVG 圖示 |
| `frontend/src/components/Toolbar.vue` | 移除 status pills 與相關 props/emit |
| `frontend/src/views/DashboardView.vue` | 移除 filterCounts、接 StatsBar 的 set-status-filter、修正顯示/共計數口徑 |
| `frontend/src/composables/useServiceFilter.ts` | 新增並匯出共用述詞 `matchesStatus()`，`filteredServices` 改用之 |
| `frontend/src/assets/main.css` | stat-card button 化樣式＋active 態；移除 status-filters 樣式 |
| `frontend/src/composables/useI18n.ts` | 新增 `stats.groupAria`（zh/en） |
| `frontend/src/components/EmptyState.vue` | **順手修復既有 bug**：Vue boolean prop 未傳時 runtime 預設 false，`v-if="showButton !== false"` 永遠不成立 → 改 `withDefaults({showButton:true})` + `v-if="showButton"`，「清除過濾」按鈕恢復顯示（007 空狀態 2 個 e2e 從紅轉綠） |
| `frontend/src/__tests__/StatsBar.spec.ts`、`Toolbar.spec.ts` | 更新斷言（running 述詞、未啟用卡、移除 pills） |
| `frontend/e2e/007-service-search-enhancement.spec.ts` 等 | pill locator → stat card locator；`toHaveClass(/active/)` → `aria-pressed`（`.stat-inactive` class 本身含 "active" 子字串，class 斷言會誤判）；計數改新口徑 |

---

## 11. 實作與驗證結果（2025-08-11）

**單元測試**：`StatsBar.spec.ts`（8 項，含 running 述詞 3→2、未啟用卡、emit/active/disabled/aria）＋ `Toolbar.spec.ts`（移除 pills 斷言）全綠；`vue-tsc --noEmit` 無錯誤；`npm run build` + Go embed build OK。

**E2E 結果**：

| 檔案 | 結果 | 說明 |
|------|:---:|------|
| 007-service-search-enhancement | ✅ 30/30 | 原 6 個失敗（locator/class 斷言/計數口徑）全數修復 |
| 003-theme-i18n | ✅ 全綠 | 「總服務數/Total Services」→「全部/All」 |
| 005-tab-switching | ✅（1 個既有失敗除外） | 既有失敗與本次無關（locked badge） |
| 006-rwd-mobile | 41 通過（3 個既有失敗） | 相比原始 code 5 個失敗，本次順帶修好 2 個 |
| 002/004/008 | 各自既有失敗除外 | 皆為改動前已存在，與本次無關 |

**既有 bug 順手修復**：`EmptyState.vue` 的「清除過濾」按鈕因 Vue boolean prop 預設 false 而永遠隱藏（927700c 引入），本次修正後按鈕恢復顯示。

**決策備註**：
1. 「全部」卡片沿用 `filter.all`（zh「全部」/en「All」），替代原 `stats.total`（「總服務數」）語意 — 卡片現在是 filter 而非純統計
2. e2e 狀態斷言由 `toHaveClass(/active/)` 改為 `aria-pressed`：`.stat-inactive` 字串本身含 "active"，class 正則會把「未啟用」卡片誤判為 active
