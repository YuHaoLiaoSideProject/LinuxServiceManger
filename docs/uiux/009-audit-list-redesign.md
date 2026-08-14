# 稽核紀錄列表 — Audit Log List 排版 UIUX 審計與改版設計

> **對應功能**：#009 Audit Log（稽核紀錄）
> **畫面文件**：`docs/uiux/009-audit-list-redesign-mockup.html`（互動比較稿：BEFORE / AFTER 上下堆疊 + 主題／裝置切換）
> **設計日期**：2026-08-14（2026-08-14 補 iPad Air 平板直向修正）
> **狀態**：審計完成，設計定稿，**程式碼已實作**（含 iPad Air 平板直向修正）
> **輸出形式**：比較稿（BEFORE / AFTER）— 本次為「以 UIUX 標準檢視既有排版」，對照現況與調整後差異
> **關聯文件**：
> - `docs/uiux/009-audit-toolbar-design.html`（Toolbar 已定稿 — 本次範圍**不含** Toolbar，僅列表／分頁）
> - `docs/interaction-flows/009-audit-log.md`、`docs/bdds/009-audit-log.feature`
> - `docs/uiux/000-toolbar-redesign-mockup.html`（既有比較稿風格參照）

---

## 1. 現況審計（實測，2026-08-14）

**實測方法**：以當前 commit（`6e51188`）重新建置前端 + 後端，於 `localhost:18080` 起 dev 實例；Playwright 於 **1440×900** 與 **390×844**（locale zh-TW）登入後開啟 `/audit`，以 `getBoundingClientRect` / `scrollWidth` 量測。資料為真實 audit.jsonl（312 筆）。**無 console error。**

### 1.1 實測數據

| # | 量測項 | Desktop 1440px | Mobile 390px | Mobile 320px |
|---|--------|---------------|-------------|-------------|
| 1 | 表格欄數 | 7 欄（無橫向捲動，1228px 內） | thead 隱藏 → 卡片 | 同左 |
| 2 | 列高 | **54 / 79px 參差**（detail 換行） | **287 / 309px 每卡** | 287px |
| 3 | 列底色（成功） | `rgba(0,200,0,0.05)`（硬編碼） | 同左 | 同左 |
| 4 | 結果徽章 | 白字 on `#188038`（5.02:1 ✓）／失敗 `#c5221f`（5.8:1 ✓）；字級 **16px** | 字級 **12.8px**（不一致） | 12.8px |
| 5 | 分頁按鈕 | 40px 高、單列 | **34px 高（<44px 觸控目標）**，換行 **3 行**、高 73px | 3 行、高 **96px** |
| 6 | `role="status"` 數量 | **50**（每列 badge 皆為 live region） | 50 | 50 |
| 7 | 深色主題列底色 | `rgba(0,200,0,0.05)` on `#181c25` → **幾乎不可見** | 同左 | 同左 |
| 8 | Action 欄文字 | 出現原始 `config_view`、`notify_toggle`（**未翻譯**） | 同左 | 同左 |
| 9 | 時間欄換行 | `white-space:nowrap`，無 overflow | 無 overflow | 無 overflow（260px 內） |

### 1.1b 平板實測（新增，2026-08-14）— iPad Air

**背景**：使用者回報 iPad Air 直向檢視稽核紀錄時「時間／使用者」欄位重疊。以 Playwright 於 iPad Air 實際尺寸（4th gen 820×1180、3rd gen 768×1024、橫向 1180×820／1024×768）重現，量測 Time 欄欄寬 vs 內容需求寬度：

| 裝置／方向 | 視窗寬 | Time 欄寬 | 時間戳內容寬 | 結果 |
|-----------|:---:|:---:|:---:|------|
| iPad Air 4th 直向 | 820px | **138px** | **185px** | ❌ 溢位 47px → 文字疊上「使用者」欄 |
| iPad Air 3rd 直向 | 768px | **129px** | **185px** | ❌ 溢位 56px → 文字疊上「使用者」欄 |
| iPad Air 4th 橫向 | 1180px | 201px | 185px | ✓ 無溢位 |
| iPad Air 3rd 橫向 | 1024px | **174px** | **196px** | ⚠️ 溢位 22px（輕微，仍會觸到下一欄） |

**根因（實測驗證）**：
1. **斷點落點**：768–1023px 為「表格」區間（§6 現況：`overflow-x:auto`），iPad Air 直向 768／820px 皆落在此區；7 欄在 ~730px 可用寬度下無法容納。
2. **`table-layout: fixed` 下 `min-width` 失效**：AuditTable.vue 對 Time 欄宣告 `width:18%; min-width:12.5rem`，實測 computed `min-width:225px` 存在，但欄寬仍被壓至 138px — **fixed layout 中 cell 的 `min-width` 不具約束力**；`white-space:nowrap` 使時間戳文字直接溢位（185px 內容塞 138px 欄）而重疊到「使用者」欄（`getBoundingClientRect`：Time 右緣 157px = User 左緣 157px，重疊即文字溢位）。
3. **最小實驗**（container 820px）：`th width:18% + min-width` → 欄寬 160px（min 被忽略）；`th width:12.5rem`（絕對單位）→ 欄寬 213px（**可靠遵守**）。

### 1.2 問題清單

| # | 問題 | 嚴重度 | 位置 | 依據 |
|---|------|:---:|------|------|
| 0 | **平板直向（768–1023px，iPad Air）時間／使用者重疊**：7 欄表格塞不下 ~730px 可用寬，Time 欄被壓至 129–138px（< 內容 185px）；且 `table-layout:fixed` 下 cell `min-width` 失效（實測 138px < 宣告 225px）→ nowrap 時間戳溢位疊上「使用者」欄 | **P1** | `main.css` 768–1023px 區段（表格模式）+ `AuditTable.vue` Time 欄寬寫法 | 實測 iPad Air 4th 820px：Time 138px vs 內容 185px，溢位 47px；3rd 768px 溢位 56px；3rd 橫向 1024px 亦溢位 22px |
| 1 | **Action 未翻譯**：後端 action 為 snake_case（`config_view`／`notify_toggle`…），前端 i18n key 是 camelCase（`audit.action.configView`）且 **`notify_*` 完全缺 key** → 表格顯示原始字串 | **P1** | `AuditTable.vue` `actionLabel()` + `useI18n.ts` | 實測首頁 50 筆中 `config_view` ×35、`notify_*` ×6 全數 raw |
| 2 | **Mobile 卡片過高**：7 個 label/value 列堆疊 → 每卡 ~287–309px；50 筆 = ~14,000px 捲動 | **P1** | `main.css` `@media ≤767px` 卡片轉換 | 實測 rowHeights [287,309,309,309] |
| 3 | **Mobile 分頁觸控目標不足**：按鈕僅 34px 高（padding 6px 12px），低於 WCAG 2.5.5 的 44px | **P1** | `AuditLogView.vue` `.page-btn` | 實測 34px（390px） |
| 4 | **Mobile 分頁換行**：9 個控件（上一頁＋7 頁碼＋下一頁）＋page-info 在 390px 換成 3 行（73px）、320px 96px | P2 | `AuditLogView.vue` `.pagination` flex-wrap | 實測 3 行 / 73px、96px |
| 5 | **列底色非主題感知**：`rgba(0,200,0,0.05)`／`rgba(255,0,0,0.05)` 硬編碼，dark surface 上近乎零對比；設計系統既有 `--lms-success-light/-border` 未使用 | **P1** | `AuditTable.vue` `.row-success/.row-failure` | 實測 dark 下 `rgba(0,200,0,0.05)` on `#181c25` |
| 6 | **每列 `role="status"`**：50 個 live region，SR 載入即朗讀 50 次「成功」 | P2 | `AuditTable.vue` badge `role="status"` | 實測 `[role="status"]` = 50 |
| 7 | **Desktop 列高參差**：detail 換行 → 54px 與 79px 混列，表格鋸齒 | P2 | `AuditTable.vue` `td:nth-child(7)` word-break | 實測 rowHeights [54,79,79,79] |
| 8 | **Badge 字級不一致**：desktop 16px / mobile 12.8px（Pico root font 縮放所致，非顯式 token） | P2 | `AuditTable.vue` `.badge` font-size 0.8rem | 實測 16 / 12.8px |
| 9 | **`:key="i"`** index key（Vue 反模式，排序／過濾時復用錯誤） | P2 | `AuditTable.vue` | code review |
| 10 | **Empty/Error 用 emoji 圖示**（⚠️／🔍）— 與設計系統「inline SVG」不符 | P2 | `AuditLogView.vue` | code review |
| 11 | `aria-label="稽核操作紀錄"` 硬編碼中文，未本地化（EN 模式仍唸中文） | P3 | `AuditTable.vue` | code review |
| 12 | Action 欄純文字、無掃讀 affordance：無法一眼分辨「失敗動作」或高風險動作 | P3 | `AuditTable.vue` | code review |
| 13 | 無「結果」篩選（僅搜尋＋日期）；本部署 312 筆中 0 失敗 → 失敗態從未被視覺驗證 | P3 | `AuditLogView.vue` | API 掃描 |

### 1.3 良點（保留）

- Toolbar 已符合 `009` 規格：搜尋／日期群組／動作按鈕皆 36px（mobile 44px），focus ring 3px，日期無效紅框 — **本次不動**
- 結果以「badge 文字＋色彩」雙重傳達（WCAG 1.4.1 已滿足），badge 對比 5.02:1 / 5.8:1 通過 AA
- thead sticky 有效；mobile 無 body 橫向捲動；時間欄 nowrap 無 overflow
- 條件回饋列（✓ 符合 N 筆 + 清除條件）符合 009 規格

---

## 2. 設計決策

### 決策 1：Action 翻譯 — i18n key 對齊後端 + 補齊 notify_*

| | 現況 | 調整後 |
|---|---|---|
| 後端 action | `config_view`（snake_case） | 不變（資料層不動） |
| 前端 key | `audit.action.configView`（camelCase，配不上）+ 無 `notify_*` | **改為 snake_case**（`audit.action.config_view`、`audit.action.notify_toggle`…），共 16 個 action 全數補齊（zh-TW + en） |
| `actionLabel()` | 查無 key → 回傳 raw 字串 | 查無 key → 回傳 raw（保留 fallback），但 key 齊全後不再發生 |

額外：表格 `aria-label` 改用 `t('audit.title')`，不再硬編碼。

### 決策 2：結果表達 — 取消整列淡色，改「左側 3px 邊條 + token 化徽章」

| 元素 | 現況 | 調整後 |
|------|------|--------|
| 列底色 | 整列 `rgba(0,200,0,0.05)`（硬編碼、dark 失效） | **移除**；改左側 `3px` 邊條：成功 `--lms-success-border`、失敗 `--lms-danger-border`（主題感知，兩主題皆清晰） |
| 成功徽章 | 白字 on `--lms-success`（5.02:1） | `--lms-success-light` 底 + **`#137333`** 深字（**5.26:1** ✓，與 Toast 同色系；dark 用 `rgba` 淡底 + `#8bdb9f` 淺綠字 **8.1:1**，比照 Dashboard 狀態 pill／Toast） |
| 失敗徽章 | 白字 on `--lms-danger`（5.8:1） | `--lms-danger-light` 底 + **`#c62828`** 深字（**4.77:1** ✓；dark 同 pattern） |
| Badge 字級 | 0.8rem（受 Pico root 縮放 → 16/12.8px 不一致） | 顯式 `12px`（desktop）+ `12px`（mobile），不再跟 root 縮放 |

> 理由：整列淡色在資料密集表格中是「過度著色」；結果已由徽章（文字＋色彩）雙重傳達，邊條僅作為視線輔助。深色主題下現況完全失效，tokens 化後兩主題一致。

### 決策 3：Desktop 列高一致 — Detail 兩行 clamp

- Detail 欄 `-webkit-line-clamp: 2`（`overflow:hidden`）＋ `title` 屬性顯示全文
- 結果：短內容列 54px、長內容列有界 79px（不再無限增高）；全文 hover 可讀、CSV 匯出保有完整資料
- 備案（不採）：1 行 ellipsis（資訊損失過大，稽核用途不適合）

### 決策 4：Action 欄語意化 — inline SVG 圖示 + 文字

依動作類型帶 6 組語意化小圖示（`aria-hidden`），輔助掃讀：

| 類別 | 動作 | 圖示 |
|------|------|------|
| 帳號 | login / logout | 進入／離開箭頭 |
| 服務控制 | start / stop / restart / enable / disable | 播放／停止／重啟／開關 |
| 設定檔 | config_view / config_save | 文件 |
| 憑證 | token_create / token_revoke | 金鑰 |
| 通知 | notify_* | 鈴鐺 |
| 登入 | login | 人像 |

### 決策 5：Mobile 卡片重排 — 4 區塊精簡（287px → ~150px）

現況（7 個 label/value 列，~300px）改為：

```
┌────────────────────────────────┐
│ 2026-08-14 07:53:25   [成功]    │ ← 區塊 1：時間（mono）＋ 結果徽章（右）
│ 檢視設定檔                      │ ← 區塊 2：動作（icon + 文字，0.95rem semibold）
│ admin · 192.168.0.37           │ ← 區塊 3：使用者 · 來源 IP（muted 0.8rem）
│ 目標 down18av.service          │ ← 區塊 4：目標（mono 0.8rem）
│ /etc/systemd/system/down18av…  │ ← 區塊 5：詳細資訊（clamp 2，全寬）
└────────────────────────────────┘
```

- 時間由 label/value 改為**卡片標頭**（主資訊），結果徽章與時間同列右側 — 掃讀首要資訊一眼可見
- 動作提升為次要標題（icon＋文字）
- 使用者／來源 IP 合併為 meta 列
- 目標 mono 字型（systemd unit 名）
- 詳細資訊全寬 clamp 2（title 全文）
- 失敗卡片：左側 3px danger 邊條（與桌機一致）+ 標頭徽章紅底

### 決策 6：Mobile／平板分頁 — 3 鍵均分、44px、頁碼收合

- **≤1023px**（含 iPad Air 直向）：`[‹ 上一頁] [第 1 / 7 頁] [下一頁 ›]` 三鍵均分全寬、**高 44px**（頁碼數字收合，避免 9 控件換行 3 行）
- **≥1024px**：維持完整數字頁碼（含省略號），按鈕 min-height 36px
- `page-info`（「共 N 筆」）於 ≤1023px 併入中央按鈕文字；≥1024px 維持右側獨立 meta

### 決策 7：無障礙清理

- 移除每列 `role="status"`（保留文字內容；live 宣告交由結果變更時的 Toast）
- `:key` 改 `${entry.timestamp}-${index}`（timestamp 具唯一性；後端補 id 列為建議）
- Empty／Error 圖示改 inline SVG（不引進新 emoji）
- 觸控目標：mobile 全控制元件 ≥44px

### 決策 8：平板直向（768–1023px，iPad Air）改卡片 + Time 欄絕對寬

> 新增（2026-08-14）— 使用者回報 iPad Air 直向「時間／使用者」重疊後實測補強。

| 項目 | 原定（§6） | 調整後 |
|------|-----------|--------|
| **768–1023px 佈局** | 表格 `overflow-x:auto`（現況保留） | **改為卡片 4 區塊重排**（與 ≤767px 完全相同：時間＋徽章標頭／動作次標題／meta／目標＋detail）— iPad Air 直向 768／820px 皆屬此區間，7 欄在 ~730px 無法容納，橫向捲動於觸控平板 UX 不佳 |
| **≥1024px 表格 Time 欄** | `width:18%; min-width:12.5rem` | **改 `width:12.5rem`（絕對單位）** — `table-layout:fixed` 下 cell `min-width` 不具約束力（最小實驗：min-width 版欄寬 160px、絕對 width 版 213px ✓）；同時消除 iPad Air 3rd 橫向 1024px 的 22px 輕微溢位 |
| **分頁斷點** | ≥768px 完整數字頁碼 | **≥1024px 完整數字頁碼**（含省略號，36px）；**≤1023px 三鍵均分 44px**（中央「第 X / Y 頁」）— 與卡片布局同步 |

> 理由：iPad Air 直向（768–820px）落於「介於手機與桌機之間」的臨界區，7 欄表格在此寬度必然壓縮；卡片布局（決策 5）已設計且驗證，直接沿用至 1023px，斷點由「768px 切卡片」改為「1024px 切卡片」，iPad Air 直向即被涵蓋。≥1024px 表格保留完整欄位，並以絕對寬 Time 欄保證任何寬度皆不溢位。

---

## 3. 設計原則

1. **一致性** — 全部沿用 `--lms-*` token（`--lms-success-light/-border`、`--lms-danger-light/-border`），與 Dashboard 狀態 pill／Toast 同一色彩語言；不再出現硬編碼 rgba
2. **漸進式揭露** — 詳細資訊 clamp 2 行＋hover title；分頁頁碼 mobile 收合；資訊不佔版不淹沒
3. **Contextual 不佔位** — 結果只用徽章＋邊條（真實狀態才出現）；Empty／Error 才顯示大圖示引導
4. **語意化圖示** — 全部 inline SVG；action 圖示輔助掃讀；不用 emoji-as-icon
5. **觸控與鍵盤優先** — mobile 全控制元件 44px（WCAG 2.5.5）；focus ring 3px；表格語意 `<table>/<th>/aria-label` 保留

---

## 4. 目標設計（wireframe）

### 4.1 Desktop ≥1024px

```
┌─────────────────────────────────────────────────────────────────────────┐
│ （Toolbar 沿用 009 規格 — 本文件不更動）                                   │
├─────────────────────────────────────────────────────────────────────────┤
│ 時間                使用者   來源 IP    動作          目標服務   結果  詳細資訊 │
│ ───────────────────────────────────────────────────────────────────── │
│▌2026-08-14 07:53:25  admin   192.168.0.37  ◈ 登入      -       [成功] -        │ ← ▌= 3px success 邊條
│▌2026-08-14 00:55:43  admin   192.168.0.16  ◈ 檢視設定檔  down18av…  [成功] /etc/…  │ ← detail clamp 2
│▌2026-08-13 23:04:59  admin   192.168.0.34  ◈ 切換通知    Linux 服務通知 [成功] -       │
│▌2026-08-13 16:03:53  admin   100.101.89.41 ◈ 啟動        simpleddn…  [成功] -       │
│ ▌2026-08-13 15:40:02  admin   100.101.89.41 ◈ 停止        nginx.service [失敗] 執行…  │ ← danger 邊條＋紅徽章
└─────────────────────────────────────────────────────────────────────────┘
     （分頁 ≥1024px：完整頁碼 + 省略號，36px）
```

- 時間：mono `0.78rem` nowrap
- Action：icon 14px + 文字 0.85rem；config/notify/token 全數翻譯
- Detail：clamp 2 + ellipsis + `title` 全文；短內容列與長內容列高度有界（54 / 79px）

### 4.2 Mobile ≤1023px（卡片 — 含 iPad Air 直向）

```
┌────────────────────────────────────────────┐
│ 2026-08-14 07:53:25            [成功]       │ 時間 mono 0.8rem ＋ 徽章右側
│ 檢視設定檔                                 │ 動作 0.95rem 600 ＋ icon
│ admin · 192.168.0.37                      │ meta muted 0.8rem
│ down18av.service                          │ 目標 mono 0.8rem
│ /etc/systemd/system/down18av.service       │ 詳細 clamp 2（title 全文）
└────────────────────────────────────────────┘
┌────────────────────────────────────────────┐
│ 2026-08-13 15:40:02            [失敗]       │ ← 卡左 3px danger 邊條
│ 停止                                       │
│ admin · 100.101.89.41                      │
│ nginx.service                              │
│ Job for nginx.service failed because the… │
└────────────────────────────────────────────┘
  [‹ 上一頁]  [第 1 / 7 頁]  [下一頁 ›]        ← 三鍵均分 44px（頁碼收合）
```

---

## 5. 狀態矩陣

| 狀態 | 視覺 | 互動 |
|------|------|------|
| **Idle（成功列）** | 左 3px `--lms-success-border` 邊條；徽章 success-light 底＋`#137333` 深字「成功」 | — |
| **Idle（失敗列）** | 左 3px `--lms-danger-border` 邊條；徽章 danger-light 底＋`#c62828`「失敗」 | — |
| **Hover** | 整列 `--lms-accent-light`（現況保留）；邊條維持 | — |
| **Focus** | 控制元件 3px accent ring；表格列非互動不設 focus | — |
| **Detail 過長** | clamp 2 行＋ellipsis | `title` 顯示全文 |
| **Mobile 卡片** | 4 區塊重排；失敗卡左邊條 | 卡片高度 ~150px（vs 現況 ~300px） |
| **分頁（≥1024px）** | 數字頁碼＋省略號；active accent 底 | 點擊跳頁；disabled 淡化 |
| **分頁（≤1023px，含 iPad Air 直向）** | 三鍵均分 44px，中央顯示「第 X / Y 頁」 | 上一頁／下一頁；中央無動作 |
| **Empty** | SVG 大圖示＋訊息 | 「清除條件」捷徑 |
| **Error** | SVG 警示圖示＋訊息 | 「重試」按鈕 |
| **Loading** | 首次載入中央 spinner；後續保留表格 | — |

---

## 6. RWD 行為表

| 斷點 | 表格 | 分頁 | 觸控目標 |
|------|------|------|:---:|
| **≥1024px**（桌機／iPad Air 橫向 1180px） | 7 欄完整表格；**Time 欄絕對寬 `12.5rem`**（fixed layout 下不溢位）；detail clamp 2 | 數字頁碼＋省略號，36px | 36px |
| **768–1023px**（iPad Air 3rd/4th 直向 768／820px、其他平板） | **卡片 4 區塊重排**（與 ≤767px 相同：時間＋徽章標頭、動作次標題、meta、目標、detail）；不再使用 7 欄表格（2026-08-14 修正：原為表格 `overflow-x:auto`，實測時間欄 129–138px < 內容 185px → 重疊） | 三鍵均分全寬 44px；中央「第 X / Y 頁」 | **44px** |
| **≤767px** | 卡片 4 區塊重排（同左） | 三鍵均分全寬 44px；中央「第 X / Y 頁」 | **44px** |

---

## 7. 無障礙（WCAG）

| 準則 | 要求 | 實作方式 |
|------|------|---------|
| **1.4.1 色彩** | 不以顏色單獨傳達 | 徽章有文字（成功／失敗）；邊條僅輔助；dark 主題對比維持（淡底＋深字 5.26:1／4.77:1） |
| **1.4.3 對比** | 文字 ≥4.5:1 | 成功徽章 `#137333` on success-light = 5.26:1（dark `#8bdb9f` = 8.1:1）；失敗 `#c62828` on danger-light = 4.77:1（dark `#f2a19d` = 7.3:1）；頁碼文字 10.3:1 |
| **2.5.5 觸控** | 觸控目標 ≥44×44px | **≤1023px**（含 iPad Air 直向）分頁按鈕 44px；Toolbar 已 44px |
| **2.4.7 焦點** | 可見 focus ring | 分頁按鈕 3px accent ring；清空條件 link 沿用 |
| **4.1.2 名稱/角色** | 正確語意 | 表格 `<caption class="sr-only">`＋`aria-label=t('audit.title')`；badge 移除多餘 `role="status"`（避免 50 個 live region 噪音）；action 圖示 `aria-hidden`；Empty/Error 改 inline SVG |
| **1.4.4 縮放** | 200% 不破版 | 卡片式 mobile 布局；時間 nowrap 有界 |

---

## 8. CSS 變數對應與新增

### 8.1 既有變數（直接使用）

```css
--lms-success-light / --lms-success-border
--lms-danger-light  / --lms-danger-border
--lms-accent / --lms-accent-light
--lms-surface / --lms-surface-2 / --lms-border / --lms-text / --lms-muted
--lms-mono（回退 ui-monospace…）
```

### 8.2 新增樣式（AuditTable.vue scoped 或 main.css）

| 樣式 | 說明 |
|------|------|
| `.row-success` / `.row-failure` | 改 `box-shadow: inset 3px 0 0 var(--lms-success-border)`（左邊條，主題感知） |
| `.badge-success` | `background: var(--lms-success-light); color: #137333`（dark 主題 rgba 淡底） |
| `.badge-failure` | `background: var(--lms-danger-light); color: #c62828`（dark 主題 rgba 淡底） |
| `.detail-clamp` | `display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden` |
| `.act-icon` | 14px inline SVG 容器 |
| `.mobile-card-head` / `.mobile-card-meta` | mobile 卡片區塊（**≤1023px 生效**） |
| `.pager-mobile` | **≤1023px** 三鍵均分（`grid-template-columns: 1fr 1fr 1fr`）、44px |
| `.pager-center` | 中央「第 X / Y 頁」顯示（非按鈕） |
| Time 欄寬（`AuditTable.vue`） | `width: 18%; min-width: 12.5rem` → **`width: 12.5rem`（絕對單位）** — fixed layout 下 `min-width` 不具約束力（實測欄寬 138px < 內容 185px → 重疊） |
| 卡片斷點（`main.css`） | Audit 卡片由 `≤767px` **提升至 `≤1023px`**（與 `.pager-mobile` 同斷點）；service-table 維持原斷點不動 |

### 8.3 i18n 新增／修正 key

```ts
// zh-TW（en 對應）
'audit.action.config_view':  '檢視設定檔'    // 原 configView（camelCase）移除
'audit.action.config_save':  '儲存設定檔'
'audit.action.token_create': '建立 Token'
'audit.action.token_revoke': '撤銷 Token'
'audit.action.notify_create': '建立通知 Channel'
'audit.action.notify_update': '更新通知 Channel'
'audit.action.notify_delete': '刪除通知 Channel'
'audit.action.notify_toggle': '切換通知 Channel'
'audit.action.notify_test':   '測試通知 Channel'
```

---

## 9. 驗收檢查清單

### 設計驗收
- [ ] BEFORE／AFTER 對照完整呈現（桌機表格＋mobile 卡片），可切主題／裝置
- [ ] Action 全數翻譯（16 個 key，snake_case 對齊後端；`config_view` 顯示「檢視設定檔」）
- [ ] 結果徽章 token 化：success-light＋`#137333`（5.26:1）、danger-light＋`#c62828`（4.77:1）；dark 主題可讀
- [ ] 整列淡色移除，改左 3px 邊條（success/danger border）
- [ ] Desktop detail clamp 2＋title；列高有界（54/79px）
- [ ] Action 欄語意化 icon（6 類 SVG）
- [ ] Mobile 卡片 4 區塊（時間＋徽章／動作／meta／目標＋detail），高度 ~150px
- [ ] **iPad Air 直向（768／820px）為卡片布局**，時間／使用者不再重疊（實測基準：Time 欄 129–138px < 內容 185px → 修正後卡片化）
- [ ] **≥1024px 表格 Time 欄絕對寬 `12.5rem`**，任何桌面／平板橫向寬度皆無溢位（含 iPad Air 3rd 橫向 1024px）
- [ ] Mobile 分頁三鍵均分 44px，中央「第 X / Y 頁」（**≤1023px 生效**）
- [ ] 移除每列 `role="status"`；`:key` 含 timestamp；`aria-label` 本地化
- [ ] Empty／Error 圖示 inline SVG
- [ ] 深淺主題皆可讀；RWD 三斷點符合 §6
- [ ] Headless 驗證：console 無 error、標籤平衡、互動正常

### 實作後續（2026-08-14 已完成）
- [x] `AuditTable.vue`：徽章 token 化／左邊條／detail clamp／action SVG icon／`:key` 含 timestamp／aria 本地化（badge 移除 `role="status"`）；**Time 欄 `width: 12.5rem`（絕對單位）**
- [x] `useI18n.ts`：snake_case keys＋補齊 config_view／token_*／notify_*（zh-TW + en）＋`audit.pagination.pageOf`
- [x] `AuditLogView.vue`：分頁 ≤1023px 三鍵 44px（中央「第 X / Y 頁」）、Empty/Error inline SVG
- [x] `main.css`：**Audit 卡片斷點 767→1023px**（4 區塊 grid）、`.pager-compact` 44px、`.row-empty` 隱藏噪音列
- [x] 補 E2E：iPad Air 直向 768／820px 卡片無重疊 ＋ 1024px 表格 Time 欄不溢位（C4 迴歸，3 案）

### 驗證結果（2026-08-14）
- 單元測試：538 全數通過（含 AuditTable 25 案、AuditLogView 32 案）
- E2E：audit 23 案全過（含新增 C4 iPad Air 3 案）；logout 38 案全過（LO-15 隨導覽列改版修正 Tab 順序）；全套 447 案僅存既有 flaky 除外
- `vue-tsc --noEmit`：無型別錯誤
- 實測 iPad 820px 直向：卡片高 131px、時間/徽章同列、meta 左右分欄、空值列隱藏；1024px 橫向：表格 Time 欄 238px 無溢位無橫向捲動

---

*產出日期：2026-08-14 · 實測 base：commit `6e51188`（iPad Air 平板修正實測於 commit `cc0e15e`，Playwright 820／768／1180／1024px）*
