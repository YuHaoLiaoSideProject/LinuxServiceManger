# 服務設定檔編輯器 — ConfigEditorView 設計文件

> **對應功能**：#012 Service Config Editor（服務設定檔編輯器）
> **畫面文件**：`docs/uiux/012-service-config-editor-design.html`（互動 mockup，可切換主題／裝置／驗證狀態）
> **設計日期**：2025-08-15
> **狀態**：設計完成，待實作
> **上游文件**：
> - `docs/interaction-flows/012-service-config-editor.md`（主流程 + 儲存/驗證子流程圖 + 異常處理）
> - `docs/bdds/012-service-config-editor.feature`（67 個 Scenario）
> - `docs/tech-decisions/012-service-config-editor.md`（**CodeMirror 6** 取代 Monaco、checksum 409、dirty 三層防護、GET 鎖定回 200）
> - `docs/development/012-service-config-editor.md`（前端 code skeleton、CSS 樣式）

---

## 1. 現況審計

### 1.1 既有元件審計

| # | 元件 | 位置 | 可複用？ | 說明 |
|---|------|------|:---:|------|
| 1 | **ServiceRow.vue** | `frontend/src/components/ServiceRow.vue` | ✅ 需擴充 | Actions 區域目前 3 個 grid slot（Start/Stop、Restart、Logs）；新增「Edit/View Config」第 4 個 slot |
| 2 | **ConfirmModal.vue** | `frontend/src/components/ConfirmModal.vue` | ✅ 需擴充 | 目前 props 僅 `show/message/details/confirmLoading/confirmError`，標題固定 `t('modal.title')`；需新增 `title/cancelLabel/confirmLabel/confirmClass`（向後相容） |
| 3 | **useToast.ts** | `frontend/src/composables/useToast.ts` | ✅ 直接複用 | 三型態 `success/error/warning`（3500ms），儲存成功／失敗／409 通知直接使用 |
| 4 | **router/index.ts** | `frontend/src/router/index.ts` | ✅ 需擴充 | lazy-load pattern 已確立（AuditLog/TokenManage），新增 `/services/:name/config` 無額外障礙 |
| 5 | **main.css** | `frontend/src/assets/main.css` | ✅ 需擴充 | `--lms-h 36px / --lms-h-mobile 44px`、success/danger/warning 色組齊備；驗證橫幅需新增 success-bg / warning-bg 變數（沿用 `--lms-*-light` 命名慣例） |
| 6 | **DashboardView.vue** | `frontend/src/views/DashboardView.vue` | ✅ 不改 | 服務列表由 ServiceStore 驅動，Config 按鈕導航後返回不需特殊處理 |

### 1.2 需新建的元件

| # | 元件 | 位置 | 說明 |
|---|------|------|------|
| 1 | **ConfigEditorView.vue** | `frontend/src/views/` | 編輯器頁面主元件（載入/錯誤/404 三態、驗證面板、儲存流程、dirty 三層 guard） |
| 2 | **UnitFileEditor.vue** | `frontend/src/components/` | CodeMirror 6 封裝（INI 高亮、行號、錯誤標記、主題 compartment、readOnly） |
| 3 | **useConfigEditor.ts** | `frontend/src/composables/` | dirty state / baseChecksum / load / verify / save / beforeunload |
| 4 | **API client 擴充** | `frontend/src/api/client.ts` | `getServiceConfig` / `saveServiceConfig` / `validateServiceConfig` |

### 1.3 排版事實（實測數據 — playwright getBoundingClientRect）

> 實測方法：複製 main.css 中 `.actions` / `.action-slot` / `.actions button` 樣式，以真實按鈕內容渲染，量測不同欄數與視窗寬度。

| 變體 | 容器 1240px（1440 視窗） | Actions 欄 360px | 結果 |
|------|------------------------|-----------------|------|
| **現況 3 按鈕**（Start/Restart/Logs） | 3 欄 grid | 單列 | ✅ 單列 32px，按鈕各 116px |
| **4 按鈕（加 Edit Config 文字），維持 3 欄 grid** | 3 欄 grid 塞 4 項 | 單列 | ❌ **換行成兩列，高度 32→69px**（違反 BDD「與 Start/Stop/Restart 同列」） |
| 4 按鈕，改 4 欄 grid | 4 欄 | 單列 32px | ⚠️ 按鈕被壓縮至 86px，「Edit Config」最小內容寬 ~116px → **文字被裁切** |
| 4 按鈕，4 欄 grid @1025 視窗 | Actions 欄 286px | 單列 | ❌ 按鈕 67px + `overflow: true`（水平溢出） |

**結論**：以「完整文字標籤 + 與既有按鈕同列」的方式塞入第 4 顆按鈕，在任何常見桌面寬度（1025–1440px）皆無法容納。必須改採窄型按鈕（icon-only）或改版面。

### 1.4 實作 gap 清單

| # | 問題 | 嚴重度 | 位置 |
|---|------|:---:|------|
| 1 | Actions 4 顆文字按鈕在桌面排版爆版（實測 2 列或裁切） | P1 | `ServiceRow.vue` + `main.css` `.actions` |
| 2 | ConfirmModal 標題固定，無法顯示「儲存設定檔變更」語意 | P1 | `ConfirmModal.vue` |
| 3 | 缺驗證橫幅色組變數（success-bg / warning-bg） | P2 | `main.css` |
| 4 | ServiceRow 既有按鈕圖示為 emoji（▶ ⏹ 🔄 📋），跨平台渲染不一致 | P2 | `ServiceRow.vue` |
| 5 | 編輯器主題需與 `[data-theme]` 同步（CodeMirror Compartment） | P2 | `UnitFileEditor.vue` |

---

## 2. 設計決策

### 決策 1：進入點 — Actions 區域第 4 個 slot 採「icon-only + tooltip」

**數據依據**：§1.3 實測 — 文字按鈕無法同列容納。

| | 方案 A：icon-only（選定） | 方案 B：文字標籤 + Actions 欄加寬至 40% | 方案 C：獨立「設定檔」欄 |
|---|---|---|---|
| 版面 | 第 4 個 grid slot，36px 圖示按鈕 | 4 欄文字按鈕 | 獨立窄欄（~48px） |
| 同列 | ✅ | ✅ | ✅ |
| 最小需求 | 4×36px + gap ≈ 150px | ~440px（僅 ≥1280 視窗可行） | ~100px |
| 一致性 | 與 tablet/mobile 既有 icon-only pattern（Restart/Logs）一致 | 桌面字級需縮小，與既有不一致 | 表頭結構變動較大 |
| 可發現性 | ⚠️ 需 tooltip 補償 | ✅ 最好 | ✅ 好 |
| 改動範圍 | 最小（僅新增 slot + 樣式） | 中（欄寬重分配 + 響應式） | 大（ServiceTable 表頭 + 欄寬） |

**決策**：方案 A。icon-only（鉛筆/眼睛 SVG，36px desktop / 48px tablet+mobile），`title` tooltip + `aria-label` 顯示「編輯 {name} 設定檔」/「檢視 {name} 設定檔」完整文字（無障礙名稱即 BDD 的按鈕語意）。同時將 Actions 欄寬由 29% → **33%**（自 Sub 9%→7%、AutoStart 15%→13% 調整），為既有 3 顆按鈕增加呼吸空間並預留 4 顆窄按鈕。BDD「與其他操作按鈕同列」「樣式一致」皆滿足；「顯示『Edit Config』按鈕」由 aria-label/tooltip 呈現，互動流程文件已允許「（或 icon）」表述。

**若產品堅持可見文字**：採方案 B，但僅能在 ≥1280px 視窗完整呈現，1025–1279px 需降級為 icon-only（CSS media query），維護成本高 — 不建議。

### 決策 2：編輯器 — CodeMirror 6（決策依 Tech Decision D-1）

Monaco → CodeMirror 6 的對應（Tech Decision D-1，~130KB vs 1.2MB gzip）：

| Interaction Flow 描述 | CodeMirror 實作 |
|----------------------|----------------|
| `language=ini` 語法高亮 | `StreamLanguage.define(ini)`（legacy-modes） |
| `tabSize=2` | `indentUnit.of('  ')` |
| `wordWrap=on` | `EditorView.lineWrapping` |
| `minimap=off` | CodeMirror 無 minimap（不實作） |
| 深淺主題 | `Compartment` + `EditorView.theme`（隨 `[data-theme]` 切換） |
| 錯誤波浪線 + gutter ❌ | `Decoration.mark`（wavy underline）+ gutter marker |

### 決策 3：語意色 — 驗證結果三態（綠/紅/黃），不以顏色單獨傳達

- **通過**：綠色橫幅 + 文字「語法驗證通過 ✅」+ 清除標記（WCAG 1.4.1：文字與色彩雙重傳達）
- **失敗**：紅色錯誤面板（逐條 `Line {n}: {message}`）+ 編輯器該行紅色波浪線 + gutter ❌ 標記
- **不可用 / 錯誤**：黃色警告橫幅，**不阻塞**儲存流程

### 決策 4：dirty 防護三層（決策依 Tech Decision D-9）

`onBeforeRouteLeave`（含瀏覽器返回鍵）→ 頁內 Cancel → `beforeunload`；三層共用同一 `isDirty`（內容比對，非 flag 累計）。

### 決策 5：表單元件一致化

Validate / Save / Cancel 沿用既有 `.outline.secondary` / `.primary` 按鈕樣式；Save 於 dirty 時才啟用；儲存中 spinner +「Saving...」；編輯器唯讀。

---

## 3. 設計原則

1. **一致性** — 所有元件對齊 `--lms-*` 變數系統；按鈕沿用既有 outline/secondary pattern；編輯器字級 0.85rem、等寬字型 `--lms-mono`
2. **漸進式揭露** — 編輯器為主角，驗證結果以橫幅/面板呈現於編輯器下方（不覆蓋內容）；儲存風險於 ConfirmModal 才揭露
3. **Contextual 不佔位** — 錯誤面板僅在有錯誤時出現；驗證通過為輕量綠色橫幅；黃色警告只在真正降級時出現
4. **語意化圖示** — 全部 inline SVG（鉛筆/眼睛/警告/勾），不用 emoji-as-icon；狀態以文字 + 色彩雙重傳達（WCAG 1.4.1）
5. **觸控與鍵盤優先** — 底部按鈕 36px desktop / 44px mobile（WCAG 2.5.5）；focus ring 可見；`role="alert"` 橫幅即時宣告

---

## 4. 目標設計

### 4.1 頁面結構（Desktop ≥1024px）

```
┌──────────────────────────────────────────────────────────────┐
│ 🖥 Linux Service Manager    [🏠 服務管理] [📋 稽核記錄]     [👤 A] ← AppHeader（既有）
├──────────────────────────────────────────────────────────────┤
│ nginx.service ●                                   ← 標題列   │
│ /etc/systemd/system/nginx.service                   ← 路徑    │
│  ● = 未儲存變更指示（dirty dot，僅 dirty 時顯示）             │
├──────────────────────────────────────────────────────────────┤
│ ┌─ 語法驗證通過 ✅（綠橫幅，成功時）───────────────────────┐  │
│ │ 語法驗證通過 — 設定檔語法正確                            │  │
│ └──────────────────────────────────────────────────────────┘  │
│ ┌─ 驗證錯誤（紅面板，失敗時）─────────────────────────────┐  │
│ │ Line 12: Unknown key 'ExecStartt'                        │  │
│ └──────────────────────────────────────────────────────────┘  │
├──────────────────────────────────────────────────────────────┤
│ ┌────────────────────────────────────────────────────────┐   │
│ │  1 [Unit]                     ← CodeMirror 編輯器      │   │
│ │  2 Description=nginx          （INI 高亮、行號、）      │   │
│ │  3 ...                        （2 空格縮排、自動換行）   │   │
│ │ 12 ExecStartt=/usr/sbin/nginx  ← 錯誤行：紅色波浪線+❌ │   │
│ └────────────────────────────────────────────────────────┘   │
├──────────────────────────────────────────────────────────────┤
│ [Validate]  [Save]  [Cancel]      ← 底部按鈕列（dirty 才啟用 Save）│
│ 唯讀模式：[Close] 單一按鈕                                    │
└──────────────────────────────────────────────────────────────┘
```

### 4.2 ServiceRow 進入點（Actions 區域）

```
┌──────────────────────────────────────────────────┐
│ Actions（欄寬 33%）                                │
│ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐      │
│ │ ▶ Start│ │🔄 Rest.│ │📋 Logs │ │ ✏️      │ ← 鉛筆 SVG
│ └────────┘ └────────┘ └────────┘ └────────┘      │   title="編輯 nginx 設定檔"
│  lock=true 時顯示 👁（眼睛 SVG）→ View Config 唯讀 │
└──────────────────────────────────────────────────┘
```

顯示規則（BDD 商業規則）：`fragmentPath` 非空才顯示；`locked:false` → 鉛筆（Edit）；`locked:true` → 眼睛（View，`?readonly=1`）；`fragmentPath` 空 → 隱藏。

### 4.3 元件解剖

#### 4.3.1 UnitFileEditor（CodeMirror 封裝）

| 部位 | 規格 |
|------|------|
| 容器 | `border: 1px solid var(--lms-border)`、`border-radius: var(--lms-radius)`、背景 `--lms-surface` |
| 字型 | `--lms-mono`，字級 0.85rem，行高 1.6 |
| 行號欄 | 32px 寬、右對齊、`--lms-muted`、字級 0.75rem |
| 語法高亮 | `[Section]` → accent 藍、key → text、value → muted、`#` 註解 → muted italic |
| 錯誤行 | 紅色 wavy underline + gutter ❌（`--lms-danger`） |
| 編輯中 | 游標行高亮 `--lms-accent-light` 微底 |
| readOnly | 游標變 not-allowed、無 selection 高亮、無 context menu |

#### 4.3.2 驗證狀態橫幅

| 狀態 | 背景 / 文字 / 邊框 | 內容 | role |
|------|------------------|------|------|
| success | `--lms-success-light` / `--lms-success` / `--lms-success-border` | 「✅ 語法驗證通過 — 設定檔語法正確」 | `role="status"` |
| failure | `--lms-danger-light` / `--lms-danger` / `--lms-danger-border` | 逐條 `Line {n}: {message}`（mono） | `role="alert"` |
| warning | `--lms-warning-light` / `#8a6d00` / `--lms-warning-border` | 「⚠️ 無法執行語法驗證 — 您仍可直接儲存」 | `role="alert"` |

#### 4.3.3 底部按鈕列（config-footer）

| 按鈕 | 樣式 | 狀態 |
|------|------|------|
| Validate | `.outline.secondary` | verifying 時 spinner +「Verifying...」+ disabled |
| Save | `.primary`（danger 語意於 ConfirmModal） | 未 dirty disabled；saving 時 spinner +「Saving...」 |
| Cancel | `.outline.secondary` | dirty 時走 requestLeave 流程 |
| Close（唯讀） | `.outline.secondary` | 唯讀模式唯一按鈕 |

---

## 5. 狀態矩陣

### 5.1 ConfigEditorView 頁面

| 狀態 | 視覺 | 互動 |
|------|------|------|
| **Loading** | 頁面中央 spinner（accent 頂邊 32px）+「載入設定檔中...」 | 不可操作；GET 完成後轉態 |
| **Ready（clean）** | 編輯器顯示原始內容，Save disabled、無 dirty dot | 可編輯、Validate/Cancel 可用 |
| **Ready（dirty）** | 標題旁 `●`（warning 色）+ Save enabled | 編輯後即 dirty；內容還原即回 clean |
| **Not Found（404）** | 空編輯器 + 黃色提示「設定檔不存在：{path}...」 | 仍可輸入內容並儲存（重建） |
| **Error** | 紅色錯誤訊息 + 「返回」「重試」按鈕 | 重試 → 重新 GET；返回 → Dashboard |
| **Verifying** | Validate 按鈕 spinner + disabled | 不可重複點擊；完成後恢復 |
| **Saving** | Save「Saving...」+ 編輯器唯讀 | 期間不可編輯；成功 1.5s 後回 Dashboard |
| **Read-only** | 編輯器不可輸入；底部僅 Close | GET 正常載入（鎖定服務 200） |

### 5.2 Validate 結果三態

| 狀態 | 視覺 | 互動 |
|------|------|------|
| 通過 | 綠色橫幅 + 標記清除 | 可直接 Save |
| 失敗 | 紅色面板 + 錯誤行波浪線/❌ | 編輯內容變更 → 自動清除舊結果 |
| 不可用 / 錯誤 | 黃色警告 | 不阻塞，可略過驗證直接儲存 |

### 5.3 Save 流程（ConfirmModal）

| 狀態 | 視覺 | 互動 |
|------|------|------|
| 確認 | Modal：標題「儲存設定檔變更」+ 路徑 + daemon-reload 提示 + 風險警告（danger 確認鍵） | 取消 → 關閉；確認 → 發 PUT |
| 空內容 | Modal 內額外黃色警告行「⚠️ 設定檔內容為空...」 | 確認仍可儲存 |
| 成功 | 綠色 Toast「{name} 設定檔已儲存，daemon-reload 已執行」 | 1.5s 後自動返回 Dashboard |
| 409 衝突 | 紅色 Toast「設定檔已被其他使用者修改...」+ 重新載入 Modal | 重新 GET 更新 baseChecksum |
| daemon-reload 失敗 | 紅色 Toast + 備份路徑 | 恢復可編輯（設定檔已寫入） |
| 寫入失敗 | 紅色 Toast「儲存失敗：{原因}」 | 恢復可編輯，內容保留 |

### 5.4 Dirty 防護（離開確認）

| 狀態 | 視覺 | 互動 |
|------|------|------|
| clean 離開 | 直接返回 Dashboard | 無阻擋 |
| dirty 離開 | Modal「有未儲存的變更...」Stay / Discard Changes | Stay → 回編輯器；Discard → 回 Dashboard + 灰色 Toast「已放棄未儲存的變更」 |
| 分頁關閉 | 瀏覽器原生確認框 | `beforeunload` 第三層 |

---

## 6. RWD 行為表

| 斷點 | 編輯器 | 底部按鈕 | ServiceRow 進入點 | 觸控目標 |
|------|--------|---------|------------------|:---:|
| **≥1024px** | 完整 CodeMirror，字級 0.85rem | Validate/Save/Cancel 並排，`flex-wrap` 不溢出 | Actions 4 顆並排（icon-only config 36px） | 36px |
| **768–1023px** | 同左，容器收窄 | 同左 | Actions `flex-wrap`；Start/Stop 全寬色塊 + 48px icon 按鈕 | 36px |
| **≤767px** | `max-width:100vw; overflow-x:auto`（或縮小字級）；行號欄隱藏（省寬） | 按鈕 `flex:1` 全寬 44px 堆疊 | 卡片布局；全部 48px | 44px |

Mobile 標題列：服務名稱 + 路徑改上下堆疊（`flex-direction: column; align-items: flex-start`）。

---

## 7. 無障礙（WCAG）

| 準則 | 要求 | 實作方式 |
|------|------|---------|
| **1.4.1 色彩** | 不以顏色單獨傳達 | 驗證橫幅有文字（「語法驗證通過」「Line 12: ...」）+ 色彩；狀態點有文字標籤 |
| **2.4.7 焦點** | 所有互動元件可見 focus ring | `box-shadow: 0 0 0 3px var(--lms-accent-light)`；編輯器內 Tab 順序：Validate → Save → Cancel |
| **2.5.5 觸控** | 觸控目標 ≥44×44px | Mobile 底部按鈕 44px；ServiceRow 48px icon 按鈕 |
| **4.1.2 名稱/角色** | 自訂元件正確 ARIA | 驗證橫幅 `role="status"/"alert"`；ConfirmModal `role="alertdialog" aria-modal="true"`（既有）；icon-only 按鈕 `aria-label`；dirty dot `aria-hidden` + 標題文字提示 |
| **1.4.3 對比** | 文字對比 ≥4.5:1 | warning 橫幅文字 `#8a6d00`（深色主題下用淺黃）；編輯器字色 `--lms-text` |
| **2.1.1 鍵盤** | 所有功能鍵盤可達 | 編輯器保留 CodeMirror 預設 keymap；Modal focus trap（既有元件） |

---

## 8. CSS 變數對應與新增

### 8.1 既有變數（直接使用）

```css
--lms-h: 36px;            /* 底部按鈕高度 */
--lms-h-mobile: 44px;     /* mobile 觸控目標 */
--lms-radius: 10px;       /* 編輯器容器 */
--lms-radius-sm: 6px;     /* 按鈕 / 橫幅 */
--lms-success / --lms-success-light / --lms-success-border
--lms-danger / --lms-danger-light / --lms-danger-border
--lms-warning / --lms-warning-light
--lms-mono                 /* 編輯器字型 */
--lms-border / --lms-surface / --lms-text / --lms-muted
```

### 8.2 需新增變數（main.css，主題兩側皆需）

```css
:root {
  --lms-warning-border: #ffe082;   /* 黃色橫幅邊框（light） */
  --lms-error-text: #c62828;       /* 驗證錯誤文字（深色主題需提高對比） */
}
[data-theme="dark"] {
  --lms-warning-border: rgba(255, 224, 130, 0.35);
}
```

> 驗證橫幅背景直接使用既有 `--lms-success-light` / `--lms-danger-light` / `--lms-warning-light`，不另建 `-bg` 命名，維持變數最小化。

### 8.3 新增樣式（.vue scoped 或 main.css）

| 樣式 | 說明 |
|------|------|
| `.validation-banner.success/.error/.warning` | 三態橫幅（§4.3.2） |
| `.validation-error-item` | mono 0.85rem，`Line {n}: {message}` |
| `.dirty-dot` | `color: var(--lms-warning)`，「●」+ `aria-hidden` |
| `.config-loading` | 中央 spinner 32px |
| `.config-error-state` | 置中錯誤 + 返回/重試 |
| `.config-notice.warning` | 404 / 大檔案黃色提示 |
| `.unit-file-editor` | `font-family: var(--lms-mono); font-size: 0.85rem` |
| `.config-footer` | `display:flex; gap:0.5rem; flex-wrap:wrap`；mobile 全寬 |
| `.btn-act-config` | 36px icon 按鈕（desktop）/ 48px（mobile）；SVG 填色 `--lms-muted` hover `--lms-accent` |

---

## 9. 驗收檢查清單

### 設計驗收

- [ ] 編輯器載入後顯示 INI 語法高亮（[Section] / key / value / 註解四色）
- [ ] 驗證三態橫幅在深淺主題下對比度足夠、文字+色彩雙重傳達
- [ ] 錯誤行顯示 wavy underline + gutter ❌，編輯後自動清除
- [ ] Save 按鈕 dirty 前 disabled / dirty 後 enabled，字級與其他按鈕一致
- [ ] ConfirmModal 顯示路徑、daemon-reload 提示、風險警告；空內容額外警告
- [ ] 409 衝突有重新載入流程（Toast + Modal 動作）
- [ ] dirty 三層防護（返回鍵 / 頁內 Cancel / 分頁關閉）共用同一 isDirty
- [ ] ServiceRow 4 顆按鈕同列不換行（實測單列 32px）
- [ ] icon-only config 按鈕有 tooltip + aria-label（「編輯/檢視 {name} 設定檔」）
- [ ] RWD：desktop 完整編輯器 → mobile 全寬按鈕 + 橫向捲動編輯器
- [ ] Focus ring 在所有互動元件上可見；橫幅 role 正確
- [ ] 所有圖示為 inline SVG，無 emoji-as-icon
- [ ] `prefers-reduced-motion` 生效（動畫近零）

### BDD 覆蓋

- 進入點：解鎖/鎖定服務 Edit/View Config 按鈕顯示規則（F-SR-01~03）
- 編輯器：載入/高亮/唯讀/dirty/500KB 提示（F-ED、F-VW）
- Validate：通過/失敗/不可用/空內容/格式錯誤（F-VL）
- Save：ConfirmModal/成功/失敗/409/reload 失敗/空內容/權限/網路中斷（F-SV）
- Cancel/返回：clean/dirty/Stay/Discard/返回鍵（F-CN）
- 主題切換 / RWD（F-TH）
- 後端三 API 之 UI 對應（GET/PUT/validate 錯誤碼的 Toast/橫幅呈現）

---

*產出日期：2025-08-15*
