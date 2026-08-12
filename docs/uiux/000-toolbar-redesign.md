# Toolbar 調整 — UI/UX 設計文件

> **對應頁面**：Dashboard（服務過濾 Toolbar、批次操作 Toolbar）、Audit Log（稽核 Toolbar）
> **狀態**：設計提案（待實作）
> **設計日期**：2025-08-11
> **畫面文件**：`docs/uiux/000-toolbar-redesign-mockup.html`（互動 mockup，可切換主題／裝置／批次狀態）
> **相關元件**：`Toolbar.vue`、`BatchToolbar.vue`、`AuditLogView.vue`（內嵌 toolbar）

---

## 1. 背景與目標

目前系統有三處 toolbar，樣式與互動各自為政：

| 位置 | 元件 | 內容 |
|------|------|------|
| Dashboard 服務列表 | `Toolbar.vue` | 狀態 filter + 搜尋 + regex 開關 + 重新整理 |
| Dashboard 表格上方 | `BatchToolbar.vue` | 批次選取計數 + Start/Stop/Restart + 取消選取 |
| Audit Log 頁 | `AuditLogView.vue` 內嵌 | 搜尋 + 日期範圍 + 匯出 CSV + 重新整理 |

**目標**：

1. 三個 toolbar 收斂到同一視覺語言與間距尺度，看起來是同一個設計系統
2. 改善可掃讀性、可達性（Accessibility）與 RWD 行為
3. 移除 emoji-as-icon 的跨平台渲染與色盲可讀性問題
4. 批次操作工具列改為 contextual（有意義時才出現），減少版面噪音
5. Audit toolbar 元件化，消除重複樣式

---

## 2. 現況審計

| # | 問題 | 嚴重度 | 位置 |
|---|------|:---:|------|
| P1 | 狀態 filter 用 emoji（🟢🔴⚪）當圖示，不同 OS/字型渲染不一致；且「只靠顏色」區分狀態，不符 WCAG 1.4.1 | 高 | `Toolbar.vue` |
| P1 | 批次工具列**未選取時仍佔一整列**且顯示 3 顆亮色 disabled 按鈕（硬編碼淺色底 #e8f5e9…，深色模式突兀） | 高 | `BatchToolbar.vue` |
| P2 | regex 進階開關以「`.*`」文字塞在搜尋框內，可發現性低、初學者困惑 | 中 | `Toolbar.vue` |
| P2 | Audit toolbar 非元件化，與主 Toolbar 樣式不一致（無搜尋 icon、間距不同、按鈕階層混亂） | 中 | `AuditLogView.vue` |
| P2 | 批次按鈕色彩 hardcode（`#e8f5e9`、`#fff0f0`…），不隨 dark/light theme 變換 | 中 | `BatchToolbar.vue` |
| P3 | 批次執行進度是純文字「正在執行... 3/5」，無視覺進度 | 中 | `BatchToolbar.vue` |
| P3 | 結果計數「N 個服務」語意不明（是「顯示中」還是「總數」？） | 低 | `Toolbar.vue` |
| P3 | 觸控目標偏小（`btn-status` 約 28px 高），未達 40px | 低 | 全部 |

---

## 3. 設計原則

1. **一致性優先** — 單一 Toolbar 骨架 + 插槽（slot），三頁面共用
2. **漸進式揭露** — 進階功能（regex、日期範圍）折疊/次要化，預設只顯示多數使用者需要的
3. **Contextual 不佔位** — 批次工具列只在「有意義時」出現（選取 > 0 或執行中）
4. **語意化圖示** — 圖示一律用 inline SVG / CSS 形狀；顏色永遠搭配文字或形狀，不單獨傳達狀態
5. **觸控與鍵盤優先** — ≥40px 觸控目標、可見 focus ring、完整 aria

---

## 4. 目標設計

### 4.1 共用骨架與 Design Token

```
┌──────────────────────────────────────────────────────────────┐
│ [狀態過濾群組]  [🔍 搜尋＿＿＿＿＿ ✕]   12/34   [↻ 重新整理]   │
└──────────────────────────────────────────────────────────────┘
```

> **排版事實（2025-08-11 實測確認）**：桌面版（≥1024px）pills、搜尋、計數、重新整理**全部在同一列**（`.toolbar` 容器最寬 1280px，`flex-wrap` 僅在窄視窗才觸發）。設計維持單列，不改變現行排版結構。

| Token | 值 | 說明 |
|-------|-----|------|
| 高度（desktop） | **36px** | 所有控制元件一致：pills、搜尋輸入、regex 開關、按鈕、批次動作、link 點擊區 |
| 高度（mobile） | **44px** | 觸控目標（WCAG 2.5.5） |
| 字級 | 14px（按鈕/輸入）／ 13px（pills）／ 12px（計數 meta） | |
| 元件間距 | 8px | filter 群組內部 |
| 群組間距 | 16px | 過濾 / 搜尋 / 動作之間 |
| 圓角 | pill 18px（filter）／ 6px（輸入與按鈕） | pill 僅外型橢圓，高度仍與其他控制元件同高 |
| 色彩 | 一律 `--lms-*` CSS 變數 | 不得 hardcode hex |
| 動畫 | 內容淡入 150ms | 尊重 `prefers-reduced-motion`（main.css 已處理） |

> **高度一致化是「排版看起來亂」的主因**：現況實測 pills 30px、搜尋 32px、regex 21px、重新整理 33px、批次按鈕 31px 混雜。調整後同一列所有互動元件同高（36px）同字級同圓角，視覺立刻整齊（見 mockup §0 對照表）。

### 4.2 服務過濾 Toolbar（Dashboard，`Toolbar.vue`）

**Desktop（≥1024px）**

```
┌──────────────────────────────────────────────────────────────┐
│ [全部34][執行中12][失敗2][未啟用20]  [🔍 搜尋...✕]  12/34  ↻ │
└──────────────────────────────────────────────────────────────┘
```

調整內容：

1. **狀態 filter → segmented control（pill 群組）**
   - 移除 emoji 🟢🔴⚪，改為 CSS 圓點（●）＋ 文字；active 選項用 accent 底色
   - 每個選項可帶即時 count badge（可選增強，`全部(34) 執行中(12)`）
   - 語意：以 `aria-pressed` 標記 active，或整組用 `radiogroup`
2. **搜尋框**
   - 固定放大鏡 icon（inline SVG）+ 有內容時顯示 ✕ clear 按鈕
   - regex 從「框內按鈕」改為搜尋框右側的「進階」開關（`.*` 仍保留，但移至 clear 鈕外側、獨立按鈕並加 tooltip + `aria-pressed`）
3. **計數**：改為「顯示 X / 共 Y」，語意明確；與表格 empty state 的「清除條件」互相呼應
4. **重新整理**：固定右上 secondary 按鈕，loading 時顯示 spinner 並 disabled

**Mobile（≤767px）**

```
┌──────────────────────────────┐
│ [全部][執行中][失敗][未啟用]    │  ← pills wrap（2 列）
│ 🔍 搜尋服務名稱...            │  ← 全寬，高 44px
│ ↻ 重新整理         12/34     │
└──────────────────────────────┘
```

### 4.3 批次操作 Toolbar（`BatchToolbar.vue`）

**決策（2025-08-11 依使用者回饋調整）**：維持「固定顯示、不跳出/不消失」（避免版面位移與劇烈視覺變動），但改用**固定槽位＋內容淡入替換**：

- 工具列永遠佔同一個位置（min-height 52px）→ 表格零位移
- **Idle（未選取）**：單行 muted 提示「☑ 勾選服務後，可在此批次啟動 / 停止 / 重啟」，不顯示亮色按鈕
- **已選取**：計數＋動作按鈕 fade-in（150ms）；左側 accent 邊線亮起
- **執行中**：動作按鈕 disabled＋實際進度列＋「N/M 完成」輔助文字

**Idle**

```
┌──────────────────────────────────────────────────────────────┐
│ ☑ 勾選服務後，可在此批次 啟動 / 停止 / 重啟                  │
└──────────────────────────────────────────────────────────────┘
```

**已選取 N > 0（內容淡入）**

```
┌──────────────────────────────────────────────────────────────┐
│ ☑ 已選取 5 個服務   ▶ Start  ⏹ Stop  🔄 Restart     取消選取 │
└──────────────────────────────────────────────────────────────┘
```

**執行中**

```
┌──────────────────────────────────────────────────────────────┐
│ ☑ 已選取 5 個服務   ▓▓▓▓▓▓▓▓░░░░░░  3/5 完成                │
└──────────────────────────────────────────────────────────────┘
```

調整內容：

1. **色彩 theme-aware**：改用 `--lms-success` / `--lms-danger` / `--lms-accent` + 對應 light 底（`--lms-success-light` 等已存在），dark theme 自動正確
2. **進度列**：真實 `<progress>` 或自製 bar（`role="progressbar"` + `aria-valuemin/max/now`），取代純文字；完成數「3/5 完成」保留為輔助文字
3. **按鈕**：SVG icon（▶⏹🔄 換成 play/stop/refresh icon）＋文字；disabled 時去色（灰階 40% opacity + `cursor: not-allowed`）
4. **取消選取**：維持右側 link 樣式；mobile 時改為全寬按鈕
5. 與 ServiceTable 的 checkbox 選取邏輯不變（僅視覺層調整）

> 備用方案（若團隊傾向保留全按鈕常駐）：至少套用「統一 36px 高度＋theme 色彩＋disabled 全灰去色」三項修正，見 mockup §2-b。

### 4.4 Audit Log Toolbar（`AuditLogView.vue` → 共用元件）

**無條件狀態**

```
┌──────────────────────────────────────────────────────────────┐
│ 🔍 搜尋操作者/動作/服務...  [日期起] – [日期迄]    [↓ 匯出] [↻] │
└──────────────────────────────────────────────────────────────┘
```

**條件啟用時**

```
┌──────────────────────────────────────────────────────────────┐
│ 🔍 搜尋…            [日期起] – [日期迄]        [↓ 匯出] [↻]   │
│ ✓ 符合 42 筆記錄   ✕ 清除條件                                │
└──────────────────────────────────────────────────────────────┘
```

調整內容：

1. **元件化**：抽成共用 Toolbar 骨架 + `SearchInput` 元件，與 Dashboard 共用樣式（icon、focus ring、間距）
2. **搜尋框**：加放大鏡 icon；寬度 300px 改為 `min-width: 220px` + flex 伸縮
3. **日期範圍**：視覺群組（外框包住起訖兩欄 + 中間「–」分隔），縮小佔寬
4. **匯出 CSV = primary**（accent 底），**重新整理 = secondary**，階層清楚
5. 條件啟用時顯示「符合 N 筆」＋「✕ 清除條件」可點連結（取代現行散落的 `search-result-count`）

---

## 5. 狀態與互動矩陣

| 狀態 | 視覺 | 行為 |
|------|------|------|
| Loading | 搜尋/按鈕 disabled、重新整理轉圈 | 保留既有 filter 狀態，不清除 |
| Disabled（批次） | 40% opacity + `not-allowed` | 不觸發、不跳 confirm |
| Executing（批次） | 進度列 + 全部動作按鈕 disabled | 阻止重複送出（現有邏輯保留） |
| Regex error | 輸入框紅框 + 下方 monospace 錯誤文字 | 即時驗證，輸入有效即清除 |
| 空結果 | filter 保留，表格區顯示 EmptyState | 「清除條件」一鍵重置 |
| 選取中切 Tab | 批次工具列消失、選取清空 | 沿用現有 `clearSelection()` |

---

## 6. 無障礙檢查清單

- [ ] **WCAG 1.4.1**：狀態不以顏色單獨傳達（CSS dot ＋ 文字標籤）
- [ ] **WCAG 2.5.5**：觸控目標 ≥ 40px（mobile 44px）
- [ ] **WCAG 2.4.7**：所有互動元件 focus 時顯示 2px accent focus ring
- [ ] **WCAG 4.1.2**：segmented filter 用 `radiogroup`／`aria-pressed`；批次按鈕 `aria-label` 含數量（如「啟動 5 個服務」）
- [ ] 進度列：`role="progressbar"` + `aria-valuemin/valuemax/valuenow`
- [ ] 鍵盤：Tab 順序 = 視覺順序；Esc 清除搜尋
- [ ] 圖示僅為裝飾（`aria-hidden="true"`），文字才是名稱

---

## 7. RWD 行為

| 斷點 | 行為 |
|------|------|
| ≥1024px | 單列：filter 左／搜尋中（flex 伸縮）／動作右 |
| 768–1023px | 允許 wrap：搜尋換第二列並全寬 |
| ≤767px | 全寬堆疊；filter pills 2 列均分寬度；控制元件與批次按鈕全寬 **44px**；計數移至右側 |

---

## 8. 實作建議

1. 抽出共用元件：`BaseToolbar`（骨架＋插槽）、`SearchInput`（icon＋clear＋可選 regex 開關）、`SegmentedFilter`
2. `BatchToolbar` 改為 contextual（`v-show`），注意滑入動畫僅在首次出現時觸發（`transition` + `v-if` 交替）
3. 顏色全面改用 `--lms-*` 變數，刪除 `BatchToolbar.vue` 內 hardcode hex
4. 圖示改用 inline SVG，移除 emoji；`header.refresh` 等含 emoji 的 i18n 文案同步調整
5. i18n 新增 key：`filter.count.shown`（顯示 {shown} / 共 {total}）、`batch.progress`（{done}/{total} 完成）、`audit.matched`（符合 {count} 筆）、`audit.clearFilters`
6. 移除/合併 AuditLogView 內嵌樣式（`.audit-toolbar`、`.search-box` 等），改用共用元件

---

## 9. 驗收清單

- [ ] 三個 toolbar 共用同一 design token 與骨架（視覺一致）
- [ ] 同一列所有控制元件高度一致：desktop 36px、mobile 44px（mockup §0 矩陣逐項核對）
- [ ] 批次工具列固定顯示不消失；idle 為單行提示、無亮色按鈕
- [ ] 批次執行中顯示進度列，動作按鈕 disabled（去色）不可重複點擊
- [ ] 狀態 filter 無 emoji；light/dark theme 皆可讀
- [ ] 批次按鈕色彩皆走 CSS 變數，深色模式正確
- [ ] 觸控目標 ≥ 40px（mobile 44px）
- [ ] 鍵盤可完整操作；focus ring 可見
- [ ] regex 開關可發現、有 tooltip、`aria-pressed` 正確
- [ ] 現有 e2e 通過：`005-tab-switching`、`006-rwd-mobile`、`007-service-search-enhancement`、`009-audit-log`、批次相關測試
- [ ] 手動驗證：批次失敗→保留失敗項重試流程不變

---

## 10. 影響範圍

| 檔案 | 變更 |
|------|------|
| `frontend/src/components/Toolbar.vue` | 重構（SegmentedFilter + SearchInput），統一 36px 高度 |
| `frontend/src/components/BatchToolbar.vue` | 固定槽位＋內容淡入、進度列、theme 色彩、去色 disabled |
| `frontend/src/views/AuditLogView.vue` | 改用共用元件、清除條件互動 |
| `frontend/src/assets/main.css` | 新增共用 toolbar token（--h:36px／--h-mobile:44px）、移除 hardcode |
| `frontend/src/composables/useI18n.ts` | 新增/調整 key |
| 新增：`frontend/src/components/SearchInput.vue`、`SegmentedFilter.vue`、`BaseToolbar.vue` | 共用元件 |
