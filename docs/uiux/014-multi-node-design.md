# 多機管理 Agent 模式 — UI/UX 設計文件

> **對應功能**：#014 Multi-Node Agent Management（多機管理 Agent 模式）
> **畫面文件**：
> - `docs/uiux/014-aggregate-dashboard-design.html`（Aggregate Dashboard 完整規格）
> - `docs/uiux/014-node-management-design.html`（Node Management 完整規格）
> - `docs/uiux/014-node-dashboard-design.html`（node-aware 單節點 Dashboard 完整規格）
> **設計日期**：2025-08-18
> **狀態**：設計完成，待實作
> **輸出形式**：greenfield 新功能（三頁面），每頁面一份完整規格、共用同一套 token — 無 BEFORE 可比對，不採比較稿
> **上游文件**：
> - `docs/interaction-flows/014-multi-node-agent-management.md`（9 步驟 + 4 子流程圖 + 異常處理 + 邊界限制）
> - `docs/bdds/014-multi-node-agent-management.feature`（69 Scenario）
> - `docs/tech-decisions/014-multi-node-agent-management.md`（9 項決策）
> - `docs/development/014-multi-node-agent-management.md`（開發規格：前端 2.6~2.13、CSS §7）

---

## 1. 現況審計

### 1.1 既有元件審計（前端目前**零** nodes 程式碼 — greenfield，以下為可重用基礎）

> 實測方法：playwright（`frontend/measure-014-audit.mjs`）啟動真實前端（vite dev :5199 + mock API），於 1440×900 / 375×812 量測 `getBoundingClientRect`；CSS 變數取自 `assets/main.css`。

| # | 元件 | 位置 | 實測尺寸（1440×900） | 可複用？ | 014 用法 |
|---|------|------|---------------------|:---:|------|
| 1 | **AppHeader.vue** | `frontend/src/components/AppHeader.vue` | header 全高 **37px**；nav-group 絕對置中（300×49）；nav-item **41px 高**（padding 0.4rem 0.85rem、0.82rem 字級、7px 圓角） | ✅ 需擴充 | 主導航新增「Node Management」連結（第 3 項）；node-aware 模式在 header 內嵌 `NodeSwitcher` 下拉 |
| 2 | **Toolbar.vue** | `frontend/src/components/Toolbar.vue` | 工具列容器 **36px**；refresh 按鈕 **36px**；regex 切換 **26×32px**；搜尋輸入 36px（`--lms-h`） | ✅ 元件層級直接複用 | Aggregate 搜尋框**獨立設計**（跨節點語意不同），不塞入既有 Toolbar |
| 3 | **StatsBar.vue** | `frontend/src/components/StatsBar.vue` | 容器 **78px**（1440px 下 wrap 成 2 行）；pill 36px | ⚠️ 結構參考 | 014 Aggregate 統計列為 6 項節點/服務統計（語意不同），**新寫**但沿用 pill 樣式與 wrap 行為 |
| 4 | **ServiceTable.vue / ServiceRow.vue** | `frontend/src/components/` | 表頭 th **50px**；資料列 **80px**；列操作按鈕 **37px**（Pico）；icon-only 按鈕 36px（`.btn-act-config`，mobile 48px 寬/44px 高） | ✅ 直接複用（node-aware） | 單節點視圖佈局與既有 Dashboard 一致（互動流明訂），僅包裝於 node-aware 模式 |
| 5 | **ConfirmModal.vue** | `frontend/src/components/ConfirmModal.vue` | overlay 全屏 `rgba(0,0,0,.45)`；modal **420×284px**；動作按鈕 **46px**（Pico） | ✅ 直接複用 | 移除節點確認（「確定要移除此節點？所有歷史資料將保留。」） |
| 6 | **EmptyState.vue** | `frontend/src/components/EmptyState.vue` | 圖示 + 訊息 + 按鈕（0.75rem 上方間距） | ⚠️ 需 View 層處理 | props 語意固定「清除過濾」；014 空狀態按鈕語意不同 → 依開發規格 2.6 於 View 層直接渲染 `router-link`（不改元件） |
| 7 | **useToast.ts + ToastContainer.vue** | `frontend/src/composables/` `components/` | 三型態 success/error/warning（3500ms） | ✅ 直接複用 | 節點離線/恢復/註冊/移除/操作逾時全數使用 |
| 8 | **useWebSocket.ts** | `frontend/src/composables/useWebSocket.ts` | handlers Map 分發、自動重連（maxRetryDelay 30s） | ✅ 需擴充 | 新增 `node_status` / `node_online` / `node_offline` / `node_removed` 4 型 + nodes store 更新 + Toast |
| 9 | **useI18n.ts** | `frontend/src/composables/useI18n.ts` | `nav.*` 既有鍵 | ✅ 需擴充 | `nav.nodes` + `nodes.*` 節點頁翻譯（zh-TW/en） |
| 10 | **Pico CSS**（CDN） | `index.html` | 基底 button 高 2.5rem（實測含 padding 46px） | ✅ 基底 | 控制元件統一以 `--lms-h`（36px）覆寫 |
| 11 | **main.css 變數** | `assets/main.css` | `--lms-h:36px` / `--lms-h-mobile:44px` / `--lms-radius:10px` / `--lms-radius-sm:6px` / `--lms-shadow` 系列 | ✅ 直接使用 | 014 全部元件對齊此 token 集 |

### 1.2 需新建的元件

| # | 元件 | 位置 | 說明 |
|---|------|------|------|
| 1 | **AggregateDashboardView.vue** | `frontend/src/views/` | `/`（登入預設）：StatsBar(6 項) + 跨節點搜尋 + NodeCard 網格 + 空狀態 + NodeDetailPanel；WS handlers 註冊/移除 |
| 2 | **NodeManagementView.vue** | `frontend/src/views/` | `/nodes`：節點列表表格 + NodeFormModal + ConfirmModal 移除 + 下載 Agent（架構選單） |
| 3 | **NodeCard.vue** | `frontend/src/components/` | 網格卡片：狀態燈（4 色 + warning）、名稱/Hostname、服務統計 M/N、最後心跳相對時間、詳情按鈕；離線灰顯 |
| 4 | **NodeSwitcher.vue** | `frontend/src/components/` | Header 下拉：目前節點名/「所有節點」、狀態燈清單、active 反白；選取 → `?node={id}` |
| 5 | **NodeFormModal.vue** | `frontend/src/components/` | 新增/編輯節點表單（名稱/位址/指紋/token/備註 + 測試連線結果 inline + 前端驗證） |
| 6 | **NodeDetailPanel.vue** | `frontend/src/components/` | 右側滑出面板：線上資訊（info 代理）/ 離線診斷（最後心跳/持續時間/建議）/ 版本警告 / 重新連線・編輯・移除 |
| 7 | **stores/nodes.ts** | `frontend/src/stores/` | nodes / activeNodeId / summary / inFlight 標記 + applyNodeEvent（WS） |
| 8 | **types/node.ts + api/client.ts 擴充** | `frontend/src/` | Node / NodeSummary / NodePayload / SearchResponse 型別 + 13 個節點 API 函式（nodeId 前綴） |

### 1.3 實作 gap 清單

| # | 問題 | 嚴重度 | 位置 |
|---|------|:---:|------|
| 1 | 無 Aggregate / Node Management 視圖、無 nodes store — 功能無從進入 | P1 | `views/` + `stores/nodes.ts`（新建） |
| 2 | Header 主導航僅 2 項，無 Node Management 入口 | P1 | `AppHeader.vue` + `router/index.ts` + `useI18n.ts` |
| 3 | `useWebSocket` 無 node_* 4 型訊息與 handler（離線/恢復無法即時反映） | P1 | `useWebSocket.ts` |
| 4 | `DashboardView.vue` 綁定本機 `/services` API，無 node-aware 前綴、無離線禁用/Banner | P1 | `DashboardView.vue`（佈局零變動小改） |
| 5 | 主導航與既有畫面大量使用 emoji 圖示（🏠📋🟢🔴…），跨平台渲染不一致 | P2 | 本次新增項一律 inline SVG ／CSS 圓點；既有 emoji 列後續清理，不在本功能更動（避免 E2E testid 衝突） |
| 6 | `.lms-modal` `max-width:420px` 對 NodeFormModal 偏窄（5 欄位 + 測試結果 + 3 動作） | P2 | NodeFormModal 自訂 `max-width:520px`（沿用 overlay/radius/shadow pattern） |
| 7 | `EmptyState` 按鈕語意固定「清除過濾」 | P2 | View 層直接渲染 `router-link.btn-primary`（開發規格 2.6 已採此方案，元件不改） |
| 8 | 狀態指示燈若沿用互動流 emoji（🟢🟡🔴⚫）：僅靠顏色/符號傳達、跨平台不一致 | P2 | 設計改為 **SVG 圓點 + 文字標籤**（如「線上」「延遲」「離線」「長期離線」「警告」），色彩+文字雙重傳達（WCAG 1.4.1） |
| 9 | 節點 API（13 endpoint）與 WS 事件尚未定義於前端 client | P1 | `types/node.ts` + `api/client.ts` |

---

## 2. 設計決策

### 決策 1：登入預設 `/` = Aggregate Dashboard；單節點走 `/dashboard?node={id}`（對齊開發規格 D-2）

三視圖路由：

| 路由 | 視圖 | 說明 |
|------|------|------|
| `/` | AggregateDashboardView | 登入預設；StatsBar + NodeCard 網格 + 跨節點搜尋 |
| `/nodes` | NodeManagementView | 節點 CRUD、測試連線、下載 Agent |
| `/dashboard?node={id}` | DashboardView（node-aware） | 既有佈局零變動，僅 API 前綴 + 離線禁用/Banner |

「登入後預設進入 Aggregate Dashboard」為互動流明訂；`?node=` query 保留重整狀態（不跳走）。

### 決策 2：Aggregate 統計列 — 6 項 chips + wrap（新寫 StatsBar 語意）

```
🌐 總節點數  🟢 線上台數  🔴 離線台數  ── 分隔 ──  📦 總服務數  ▶ 執行中  ✖ 失敗
```

- 「線上台數」嚴格計 `status==online`；「離線台數」= `offline + long_offline`（開發規格 HandleNodesSummary 語意）
- 統計數值全部來自心跳附帶 ServiceStats 聚合（**零網路請求**，決策 3/9）— 無需代理查詢
- 樣式沿用 StatsBar pill 語系（`--lms-surface-2` 底、1rem gap、wrap 換行）；**圖示用 SVG**（🌐🟢📦 等僅為文字示意）
- Loading 時以「—」placeholder 呈現（不閃爍）

### 決策 3：NodeCard 網格 — 狀態燈為「SVG 圓點 + 文字」，離線移至底部

| 狀態 | 圓點 | 文字標籤 | 卡片行為 |
|------|:---:|---------|---------|
| `online`（age<10s） | 🟢 綠 | 線上 | 可點擊 → `/dashboard?node={id}`；詳情按鈕開資訊面板 |
| `degraded`（10–30s） | 🟡 黃 | 延遲 | 同 online（可操作） |
| `warning`（版本過舊） | 🟡 黃 | 警告 | 同 online + 卡片內版本警告行「⚠ Agent 版本過舊 (v1.0)，建議升級至 v1.2+」（Tooltip） |
| `offline`（30–300s） | 🔴 紅 | 離線 | 服務統計灰顯（opacity .5）；點擊 → 離線診斷面板（**不切換視圖**） |
| `long_offline`（≥300s） | ⚫ 深灰 | 長期離線 | 卡片 `opacity:.45` 且**移至網格底部**；點擊 → 離線診斷面板 |

- 網格：`repeat(auto-fill, minmax(280px, 1fr))` — ≥1024px 三欄、768–1023px 兩欄、≤767px 單欄（與 013 Channel 卡片同 pattern）
- 卡片內容（互動流明訂）：狀態燈+名稱+詳情按鈕（頭列）、Hostname、服務統計 `M/N 執行中`、最後心跳相對時間（「X 秒前」；無心跳「從未收到心跳」）
- 卡片 hover：`box-shadow` 提升 + 邊框 accent（cursor:pointer 僅限可點狀態）

### 決策 4：跨節點搜尋 — 置頂搜尋框（debounce 300ms）+ 結果面板 inline 展開

- 位置：統計列下方、卡片網格上方（搜尋服務是 Aggregate 的主要動作，需高可見性）
- 互動：輸入停止 300ms 才發送（BDD @search）；結果以**面板**展開於搜尋框下方（非覆蓋卡片網格）：每列「節點名 / 服務名 — 狀態」，點擊 → `/dashboard?node={id}&service={name}`（初始展開該服務）
- 結果尾部：`failed_nodes` 提示「**N 個節點無法查詢（離線/逾時）**：nodeA, nodeB」（部分失敗不阻塞，決策 9）
- 空結果：「沒有找到匹配的服務」；有輸入時顯示 ✕ clear 鈕（沿用 toolbar search pattern）；ESC/clear 關閉結果面板返回卡片視圖

### 決策 5：NodeSwitcher — Header 內嵌下拉（不跳出頁面，尊重互動流「節點切換下拉選單可見」）

```
[● 所有節點 ▾]  ← header nav 區右側；activeNode 時顯示「● web-server-01」
  ┌────────────────────────┐
  │ ▸ 所有節點             │  ← 「所有節點」→ `/`（返回 Aggregate）
  │ ────────────────────── │
  │ ● web-server-01  ← 反白│  ← active 節點 accent-light 底 + 粗體
  │ ● db-01               │
  │ ○ web-server-02 離線   │  ← 離線節點仍可選（進入單節點視圖顯示 Banner）
  └────────────────────────┘
```

- 下拉：`min-width:240px`、`--lms-shadow-lg`、8px 圓角；選項 = 狀態圓點 + 名稱 + （離線時）狀態文字
- ARIA：`aria-haspopup="menu"` + `aria-expanded`；選項 `role="menuitemradio"` + `aria-checked`（radiogroup 語意，WCAG 4.1.2）；Esc/點擊外部關閉（沿用 account menu pattern）
- mobile：切換按鈕全寬 44px（放置 header 下方第二列）

### 決策 6：NodeFormModal — 表單 Modal（520px）+ 測試連線結果 inline 三態

- 沿用 `.lms-modal` overlay/radius/動畫 pattern，`max-width:520px`（5 欄位 + 測試結果 + 3 動作，420px 放不下）
- 欄位（互動流 3.2）：節點名稱*、Agent 位址（host:port）*、TLS 憑證指紋（選填）、API Token（選填；編輯模式 placeholder「留空表示不變更」）、備註（選填）
- 前端驗證（BDD @validation）：名稱/位址空白 → 欄位紅框 + 紅字提示，**不發送請求**
- **測試連線**（`POST /nodes/test-connection`，5s）：成功 → 綠底提示「✅ 連線成功 — Agent v1.2.3 @ web-server-01 (Ubuntu 22.04)」；失敗 → 紅底提示「❌ 無法連線：connection refused / TLS 憑證驗證失敗：certificate expired」，**Modal 保持開啟**可修正重試；測試中按鈕 spinner
- 註冊成功（連線可達）→ 關閉 + Toast「節點 X 已註冊並上線」；位址不可達仍儲存 → Toast「節點 X 已註冊但無法連線」（warning）；名稱重複 409 → Toast + **Modal 保持開啟**
- 動作列：取消（secondary）/ 測試連線（secondary，帶 spinner）/ 註冊・儲存（primary）

### 決策 7：Node Management 頁 — page-header + 表格 6 欄 + 下載 Agent 架構選單

```
🌐 Node Management                [⬇ 下載 Agent ▾] [＋ 新增節點]
┌──────────────────────────────────────────────────────────────────┐
│ 名稱           位址          狀態         最後心跳      版本   操作 │
│ web-server-01  10.0.0.5:8443  ● 線上  08-18 10:03:12  1.2.0  ✏️ 🗑 │
│ ...                                                             │
└──────────────────────────────────────────────────────────────────┘
```

- 表格 6 欄：名稱、位址（mono）、狀態（圓點+文字 badge）、最後心跳（`toLocaleString`；無 →「—」）、版本（無 →「—」）、操作（編輯/移除 icon 按鈕）
- 狀態 badge：success-light/danger-light/warning-light 底 + 圓點 + 文字（不只顏色）
- 「下載 Agent」→ 下拉選 `agent-linux-amd64` / `agent-linux-arm64`（→ `GET /agents/download?arch=` 存檔）
- 移除 → ConfirmModal「確定要移除此節點？所有歷史資料將保留。」確認後 Toast「節點已移除」
- 空狀態：「尚無已註冊節點」+「＋ 新增節點」按鈕

### 決策 8：node-aware Dashboard — 離線 Banner + 操作禁用 + `?service=` 展開（對齊開發規格 2.12）

- Header 右側：`NodeSwitcher` + 「← 所有節點」返回連結（`/`）
- 節點狀態非 online/degraded/warning → 頂部黃色 Banner「⚠ 節點已離線，操作不可用」（`--lms-warning-light` 底 + warning 字，圓角 6px）+ **所有操作按鈕 disabled**（灰顯 + cursor:not-allowed）
- 同節點同服務並行限制：操作進行中按鈕 disabled + spinner（in-flight 標記，key 含 nodeId；不同節點可並行）
- 操作逾時（15s）→ Toast「web-server-01 操作逾時：nginx.service restart」（warning）+ 按鈕恢復
- 搜尋結果跳轉帶 `?service=` → 該服務列自動展開（LogDrawer 直接開啟）

### 決策 9：NodeDetailPanel — 右側滑出面板（線上資訊 / 離線診斷 / 版本警告共用）

- 寬 360px（max-width 90vw）、右側滑入（150ms，尊重 reduced-motion）、backdrop `rgba(0,0,0,.35)`（點擊關閉）
- **線上**：名稱/Hostname/Agent 版本/OS/上線時長（uptime→「Xd Xh Xm」）/最後心跳 + 動作「重新連線・編輯設定・移除節點」
- **離線診斷**（互動流 3.4）：最後上線時間、最後心跳、離線持續時間、「操作建議：檢查 Agent 是否執行（systemctl status linux-service-agent）」+「重新連線・移除節點」
- **warning**：版本警告行「⚠ Agent 版本過舊 (v1.0)，建議升級至 v1.2+」
- 動作列：36px 按鈕；「移除節點」→ ConfirmModal 確認

---

## 3. 設計原則

1. **一致性** — 全部元件對齊 `--lms-*` token 與既有 pattern（modal/confirm/toast/表格/header 導航）；單節點視圖佈局**零變動**重用（互動流明訂）；014 不引進新視覺語言
2. **漸進式揭露** — 離線診斷、版本警告、failed_nodes 提示僅在真實狀態出現；正常狀態下介面乾淨（Contextual 不佔位）
3. **即時性優先** — 節點狀態變更（上線/離線/移除）一律 WS 即時推送（無需重整）；心跳統計為 Aggregate 摘要唯一來源（零代理查詢）
4. **語意化圖示** — 本次新增圖示全部 inline SVG／CSS 圓點；狀態燈為「SVG 圓點 + 文字標籤」雙重傳達（WCAG 1.4.1），不使用 emoji-as-icon
5. **觸控與鍵盤優先** — 控制元件 36px desktop / 44px mobile（WCAG 2.5.5）；focus ring 3px；NodeSwitcher `radiogroup` 語意、Modal `role="dialog"`、Banner `role="alert"`

---

## 4. 目標設計（wireframe）

### 4.1 Aggregate Dashboard（`/`，Desktop ≥1024px）

```
┌──────────────────────────────────────────────────────────────────────┐
│ 🖥 Linux Service Manager   [🏠 Dashboard] [📋 Audit Log] [🌐 Node Mgmt]│ ← AppHeader（新增第 3 項）
├──────────────────────────────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────────────────────────────┐ │
│ │ 總節點 7 │ 線上 4 │ 離線 2 │  總服務 312 │ 執行中 287 │ 失敗 5  │ │ ← StatsBar（6 chips，wrap）
│ └─────────────────────────────────────────────────────────────────┘ │
│ [🔍 搜尋所有節點的服務…                    ]  ← debounce 300ms      │
│ ┌─────────────────────────────────────────────────────────────────┐ │
│ │ web-server-01            web-server-02         db-01            │ │ ← NodeCard grid 3 欄
│ │ ● 線上 · 38/42 執行中     ● 線上 · 22/24         ● 延遲 · 16/18    │ │
│ │ 最後心跳：5 秒前          最後心跳：3 秒前        最後心跳：18 秒前 │ │
│ │ ...                                                             │ │
│ │ web-server-03（離線 灰顯）  web-04（長期離線 ⚫ 底部）               │ │ ← 離線灰顯；長期離線置底
│ └─────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
```

### 4.2 跨節點搜尋結果面板

```
│ [🔍 nginx                                   ✕]                       │
│ ┌─────────────────────────────────────────────────────────────────┐ │
│ │ web-server-01 / nginx.service — active (running)              › │ │ ← 點擊 → /dashboard?node=..&service=nginx.service
│ │ web-server-02 / nginx.service — active (running)              › │ │
│ │ db-01 / nginx@.service — inactive (dead)                      › │ │
│ │ ⚠ 2 個節點無法查詢（離線/逾時）：web-server-03, web-04          │ │ ← failed_nodes 提示（黃字）
│ └─────────────────────────────────────────────────────────────────┘ │
```

### 4.3 Node Management（`/nodes`）

```
┌──────────────────────────────────────────────────────────────────────┐
│ 🌐 Node Management                    [⬇ 下載 Agent ▾] [＋ 新增節點]  │ ← page-header
├──────────────────────────────────────────────────────────────────────┤
│ 名稱            位址            狀態         最後心跳       版本  操作 │
│ web-server-01   10.0.0.5:8443   ● 線上   08-18 10:03  1.2.0  ✏️ 🗑 │
│ web-server-02   10.0.0.6:8443   ● 線上   08-18 10:03  1.2.0  ✏️ 🗑 │
│ web-server-03   10.0.0.7:8443   ● 離線   08-18 09:12  1.1.0  ✏️ 🗑 │
│ web-server-04   10.0.0.8:8443   ⚫ 長期離線  08-17 22:40  1.2.0 ✏️ 🗑│
└──────────────────────────────────────────────────────────────────────┘
```

### 4.4 NodeFormModal

```
░░░░░░ backdrop：rgba(0,0,0,.45)（點擊關閉；表單有輸入時先 ConfirmModal 確認）░░░░░░
┌──────────────────────────────────────────────────────────────────────┐
│ 新增節點                                                             │
│ 節點名稱 *        [web-server-05______________]  ← 空白時紅框          │
│ Agent 位址 *      [10.0.0.9:8443_____________]                        │
│ TLS 憑證指紋      [SHA-256（選填）____________]                        │
│ API Token        [lsm_node_…（選填；編輯：留空表示不變更）]             │
│ 備註              [生產環境 Web 前端（選填）______]                     │
│ ✅ 連線成功 — Agent v1.2.3 @ web-server-05 (Ubuntu 22.04)  ← 綠底提示  │
│ ❌ 無法連線：connection refused                         ← 紅底提示      │
│ ──────────────────────────────────────────────────────────────────  │
│        [取消]  [⟳ 測試連線]        [✓ 註冊]                            │
└──────────────────────────────────────────────────────────────────────┘
```

### 4.5 node-aware Dashboard（`/dashboard?node=web-server-01`）

```
┌──────────────────────────────────────────────────────────────────────┐
│ 🖥 Linux Service Manager  [🏠][📋][🌐]   [● web-server-01 ▾] [← 所有節點]│ ← NodeSwitcher + 返回
├──────────────────────────────────────────────────────────────────────┤
│ ⚠ 節點已離線，操作不可用                                            │ ← 離線 Banner（僅離線時）
├──────────────────────────────────────────────────────────────────────┤
│ [我的服務 ○][系統服務 ○]   （既有 TabsBar / StatsBar / Toolbar / 表格）  │ ← 佈局零變動；操作按鈕禁用
└──────────────────────────────────────────────────────────────────────┘
```

---

## 5. 狀態矩陣

### 5.1 NodeCard

| 狀態 | 視覺 | 互動 |
|------|------|------|
| **線上（online）** | 綠點 + 「線上」；正常卡片 | 點擊 → `/dashboard?node={id}`；詳情 → 線上資訊面板 |
| **延遲（degraded）** | 黃點 + 「延遲」 | 同線上（可操作） |
| **警告（warning）** | 黃點 + 「警告」+ 版本警告行 | 同線上 + Tooltip「Agent 版本過舊 (v1.0)，建議升級至 v1.2+」 |
| **離線（offline）** | 紅點 + 「離線」；卡片 opacity .6、服務統計灰顯（opacity .5） | 點擊 → **離線診斷面板**（不切換視圖） |
| **長期離線（long_offline）** | 深灰點 + 「長期離線」；opacity .45、網格底部 | 點擊 → 離線診斷面板 |
| **Hover / Focus** | box-shadow 提升 + accent 邊框；focus ring 3px | 可點狀態游標 pointer |
| **Loading** | 網格區 spinner（`aria-busy`） | — |
| **空結果** | EmptyState「尚無已註冊節點，請先新增節點」+「新增節點」router-link | 導向 `/nodes` |

### 5.2 跨節點搜尋

| 狀態 | 視覺 | 互動 |
|------|------|------|
| Idle | 搜尋框 placeholder「搜尋所有節點的服務…」 | 輸入 debounce 300ms |
| 搜尋中 | 結果面板 spinner | — |
| 有結果 | 節點/服務/狀態列 | 點擊跳轉 `?node=&service=` |
| 無匹配 | 「沒有找到匹配的服務」 | 可繼續輸入 |
| 部分失敗 | 結果列 + 尾部「N 個節點無法查詢（離線/逾時）：…」（黃字） | 不阻塞其他結果 |
| Clear | 有輸入時 ✕ 鈕 / Esc | 清除 + 關閉面板返回卡片視圖 |

### 5.3 NodeFormModal

| 狀態 | 視覺 | 互動 |
|------|------|------|
| 開啟 | backdrop 淡入 + dialog 滑入（150ms） | focus trap；背景捲動鎖定 |
| 必填錯誤 | 欄位 `--lms-danger` 邊框 + 紅字提示 | 前端攔截不發請求 |
| 測試連線中 | 測試按鈕 spinner + disabled | — |
| 測試成功 | 綠底「✅ 連線成功 — Agent v1.2.3 @ web-server-01 (Ubuntu 22.04)」 | Modal 保持開啟 |
| 測試失敗 | 紅底「❌ 無法連線：connection refused / TLS 憑證驗證失敗…」 | 修正後可重試 |
| 註冊中 | 註冊按鈕 spinner | 不可重複送出 |
| 註冊成功（可達） | Toast「節點 X 已註冊並上線」 | 關閉 + 列表更新 |
| 註冊成功（不可達） | Toast「節點 X 已註冊但無法連線」（warning） | 關閉 + 列表更新（離線） |
| 名稱重複 409 | Toast「節點名稱重複，請使用不同名稱」（error） | **Modal 保持開啟** |
| 編輯 | 預填；Token placeholder「留空表示不變更」 | PUT；token 留空不變更 |

### 5.4 NodeSwitcher

| 狀態 | 視覺 | 互動 |
|------|------|------|
| 收合 | 按鈕顯示「所有節點 ▾」或「● web-server-01 ▾」 | 點擊展開 |
| 展開 | 下拉：所有節點 + 「所有節點」第一項；active 反白（accent-light + 粗體） | Esc / 外部點擊關閉 |
| 選取 | 選項點擊 → `setActiveNode` + 導航 | active 切換；狀態燈同步 |
| 離線節點選項 | 選項含狀態文字（離線） | 仍可選（進入顯示 Banner） |

### 5.5 NodeDetailPanel

| 狀態 | 視覺 | 互動 |
|------|------|------|
| 線上資訊 | Hostname/版本/OS/上線時長/最後心跳 | 重新連線・編輯設定・移除節點 |
| 離線診斷 | 最後上線/心跳、離線持續時間、「操作建議：檢查 Agent 是否執行…」 | 重新連線・移除節點 |
| 版本警告 | 黃色警告行「⚠ Agent 版本過舊 (v1.0)…」 | — |
| 載入中 | 面板內 spinner（info 代理 10s） | — |
| 移除 | ConfirmModal「確定要移除此節點？所有歷史資料將保留。」 | 確認 → Toast「節點已移除」+ 面板關閉 |

### 5.6 node-aware Dashboard（單節點視圖）

| 狀態 | 視覺 | 互動 |
|------|------|------|
| 節點在線 | 正常操作（與單機一致） | start/stop/restart/enable/disable/logs |
| 節點離線 | 頂部黃色 Banner「⚠ 節點已離線，操作不可用」+ **全部操作按鈕 disabled** | 不可操作；LogDrawer 仍可看快取 |
| 操作進行中 | 按鈕 spinner + disabled（in-flight，key 含 nodeId） | 同節點同服務不可並行；**不同節點可並行** |
| 操作成功 | Toast「web-server-01 nginx.service 已重啟」 | 狀態更新（WS 同步） |
| 操作失敗 | Toast「web-server-01 nginx.service 重啟失敗：權限不足」（error） | 按鈕恢復 |
| 操作逾時（15s） | Toast「web-server-01 操作逾時：nginx.service restart」（warning） | 按鈕恢復可重試 |
| `?service=` 初始展開 | 目標服務列自動展開 LogDrawer | 搜尋跳轉情境 |

---

## 6. RWD 行為表

| 斷點 | Aggregate Dashboard | Node Management | 單節點視圖 | 觸控目標 |
|------|-------------------|-----------------|-----------|:---:|
| **≥1024px** | NodeCard grid 3 欄；統計列單行可 wrap；搜尋框 max-width 400px | 表格 6 欄完整；NodeFormModal 居中 520px；detail 360px | header 單列：NodeSwitcher + 返回並排 | 36px |
| **768–1023px** | grid 2 欄；統計列 wrap 2 行 | 表格 `overflow-x:auto`；Modal 居中 | header wrap；NodeSwitcher 收合 | 36px |
| **≤767px** | grid 1 欄（卡片全寬）；統計列 wrap；搜尋框全寬 | 表格橫向捲動；NodeFormModal 全螢幕 bottom sheet（`max-height:100dvh`、頂部圓角、footer sticky）；下載選單全寬 | NodeSwitcher 移至 header 下方第二列全寬 44px；離線 Banner 全寬 | 44px |

Mobile 特化：NodeFormModal 底部動作三鍵（取消/測試連線/註冊）並排全寬 44px；NodeCard 詳情按鈕 icon 44px；NodeSwitcher 選項高度 44px；detail panel 全寬滑出（max-width 90vw）。

---

## 7. 無障礙（WCAG）

| 準則 | 要求 | 實作方式 |
|------|------|---------|
| **1.4.1 色彩** | 不以顏色單獨傳達 | 狀態燈 = SVG 圓點 + 文字標籤（「線上/延遲/離線/長期離線/警告」）；離線卡片灰顯仍有文字；failed_nodes 以文字列出節點名；badge 均含文字 |
| **2.4.7 焦點** | 所有互動元件可見 focus ring | `box-shadow: 0 0 0 3px var(--lms-accent-light)`；NodeCard 鍵盤 Enter 等價點擊 |
| **2.5.5 觸控** | 觸控目標 ≥44×44px | Mobile 全部控制元件 44px；卡片 icon 按鈕 44px；NodeSwitcher 選項 44px |
| **4.1.2 名稱/角色** | 自訂元件正確 ARIA | NodeSwitcher `role="menu"/"menuitemradio"` + `aria-checked` + `aria-expanded`；NodeFormModal `role="dialog" aria-modal="true" aria-labelledby` + focus trap；ConfirmModal `role="alertdialog"`（既有）；離線 Banner `role="alert"`；spinner `role="progressbar"`/`aria-busy`；icon-only 按鈕 `aria-label`（「編輯 {name}」「移除 {name}」「詳情 {name}」） |
| **2.1.1 鍵盤** | 所有功能鍵盤可達 | 卡片 Enter 進入；NodeSwitcher 方向鍵於選單內移動、Esc 關閉；Modal Tab 循環；表單 Enter 提交 |
| **1.4.3 對比** | 文字對比 ≥4.5:1 | 離線灰顯不降亮度過頭（opacity ≥.45 且維持文字對比）；深色主題 warning 使用淺黃；Banner 黃底深字 |

---

## 8. CSS 變數對應與新增

### 8.1 既有變數（直接使用）

```css
--lms-accent / --lms-accent-light / --lms-accent-hover
--lms-success / --lms-success-light / --lms-success-border
--lms-danger / --lms-danger-light / --lms-danger-border
--lms-warning / --lms-warning-light / --lms-warning-border
--lms-bg / --lms-surface / --lms-surface-2 / --lms-surface-3
--lms-border / --lms-text / --lms-muted
--lms-radius (10px) / --lms-radius-sm (6px)
--lms-h (36px) / --lms-h-mobile (44px)
--lms-shadow / --lms-shadow-lg / --lms-transition
```

### 8.2 需新增樣式（.vue scoped 或 main.css，對應開發規格 §7 骨架）

| 樣式 | 說明 |
|------|------|
| `.aggregate-dashboard` | `padding:1.5rem; max-width:1200px; margin:0 auto` |
| `.stats-bar` | 6 chips wrap（`--lms-surface-2` 底、1rem gap、pill 36px）；loading 以「—」 |
| `.node-card-grid` | `repeat(auto-fill, minmax(280px,1fr)); gap:1rem` |
| `.node-card` / `.node-offline` / `.node-long-offline` | 卡片 + 離線灰顯（opacity .6/.45）；hover shadow；可點狀態 cursor:pointer |
| `.status-dot` | **SVG 圓點**（8px、四色 + warning 黃）+ 內嵌文字 label（`.status-text`）；雙重傳達 |
| `.node-stats.dimmed` | 離線服務統計灰顯（opacity .5） |
| `.node-heartbeat` | 最後心跳相對時間（0.8rem muted；「從未收到心跳」） |
| `.version-warning` | 黃字 0.8rem（`--lms-warning`） |
| `.search-bar` / `.search-results` / `.search-item` / `.failed-note` | 跨節點搜尋（結果面板 border + 黃字 failed 提示） |
| `.offline-banner` | 黃底深字（`--lms-warning-light` + 6px 圓角 + `role="alert"`） |
| `.node-switcher` / `.node-dropdown` / `.node-option.active` | Header 下拉（`min-width:240px`、`--lms-shadow-lg`、8px 圓角、active accent-light 反白） |
| `.node-table` / `.row-actions` | 6 欄表格 + 操作 icon 按鈕（36/44px） |
| `.node-form-modal` | Modal `max-width:520px`（沿用 overlay/radius/動畫）；mobile bottom sheet |
| `.test-result` / `.test-ok` / `.test-fail` | 測試連線結果綠/紅底提示（含 icon 文字，非純色） |
| `.arch-dropdown` | 下載 Agent 架構選單 |
| `.detail-overlay` / `.detail-panel` | 右側滑出面板 360px（backdrop .35、150ms 滑入、reduced-motion 尊重） |
| `.panel-actions` | 面板動作列 36px 按鈕 |

---

## 9. 驗收檢查清單

### 設計驗收

- [ ] 登入預設 `/` = Aggregate Dashboard（統計列 + NodeCard 網格 + 跨節點搜尋 + 空狀態）
- [ ] Header 新增第 3 項導覽「Node Management」（inline SVG），`/nodes` 路由可達
- [ ] StatsBar 6 項（總/線上/離線節點 + 總/執行中/失敗服務），數值來自心跳統計（零代理查詢）
- [ ] NodeCard：狀態燈 = SVG 圓點 + 文字（四態 + warning）；名稱/Hostname/服務統計/最後心跳/詳情按鈕；離線灰顯；長期離線置底
- [ ] 點擊線上卡片 → `/dashboard?node={id}`；點擊離線卡片 → 離線診斷面板（不切換）
- [ ] 跨節點搜尋 debounce 300ms；結果面板含節點/服務/狀態 + failed_nodes 黃字提示；空結果提示；clear/Esc 關閉
- [ ] 空狀態「尚無已註冊節點，請先新增節點」+ 引導按鈕
- [ ] Node Management 表格 6 欄（名稱/位址/狀態/最後心跳/版本/操作）；狀態 badge 文字+色彩
- [ ] NodeFormModal 520px：5 欄位 + 前端驗證紅框 + 測試連線三態（spinner/綠/紅）+ 註冊/取消；409 保持開啟；編輯 token「留空表示不變更」
- [ ] 移除節點 ConfirmModal「確定要移除此節點？所有歷史資料將保留。」
- [ ] 「下載 Agent」架構選單（amd64/arm64）
- [ ] NodeDetailPanel 右側滑出：線上資訊/離線診斷/版本警告三情境 + 動作列
- [ ] NodeSwitcher Header 下拉：狀態燈清單 + active 反白 + 「所有節點」返回 + radiogroup ARIA
- [ ] node-aware Dashboard：離線 Banner + 操作按鈕全部禁用；in-flight 同服務禁用；逾時 Toast；`?service=` 初始展開
- [ ] WS 4 事件（node_status/online/offline/removed）更新 store + Toast（離線/恢復）
- [ ] 深淺主題皆可讀；RWD 三斷點符合 §6；mobile 控制元件 44px
- [ ] 全部新增圖示 inline SVG、狀態燈非 emoji；`prefers-reduced-motion` 生效
- [ ] Headless 驗證：三份 HTML console 無 error、標籤平衡、所有互動正常

### BDD 覆蓋對照

| BDD 區塊 | 設計對應 |
|---------|---------|
| @entry / @aggregate（登入預設、統計列、Card 狀態燈、空狀態） | §2 決策 1-3、§4.1、§5.1 |
| @switch（切換節點、所有節點返回、下拉清單） | §2 決策 5、§5.4 |
| @search（debounce、跳轉展開、無匹配、部分失敗） | §2 決策 4、§4.2、§5.2 |
| @node-mgmt（列表、新增 Modal、驗證、測試連線、註冊、編輯、移除、下載） | §2 決策 6-7、§4.3-4.4、§5.3 |
| @node-detail（線上資訊、離線診斷） | §2 決策 9、§5.5 |
| @offline（離線灰顯、單節點 Banner + 禁用、長期離線置底、寬限期恢復 Toast） | §2 決策 3/8、§5.1/5.6 |
| @service（操作成功/失敗/逾時/日誌、並行限制） | §2 決策 8、§5.6 |
| @error-handling（409、註冊不可達、版本警告、多 Manager、TLS） | §5.3/5.1/5.5 |
| @websocket（4 事件即時推送、重連） | 決策 8、驗收 WS 項 |
| @business-rules / @data（持久化、移除保留歷史、audit 含 node） | Node Management 表格 + audit 欄位（後端） |
| @api 401 | 既有 AuthMiddlewareComposite — 前端登出即不顯示 |

### 實作後續（tech decision 關聯）

- [ ] `views/AggregateDashboardView.vue` + `views/NodeManagementView.vue` + `components/NodeCard.vue` / `NodeSwitcher.vue` / `NodeFormModal.vue` / `NodeDetailPanel.vue`
- [ ] `stores/nodes.ts` + `types/node.ts` + `api/client.ts` 13 函式（nodeId 前綴）
- [ ] `useWebSocket.ts` 4 事件 + `useI18n.ts` 翻譯 + `router/index.ts`（/ 改掛 Aggregate、+/nodes）+ `AppHeader.vue` 導覽
- [ ] `DashboardView.vue` node-aware 小改（?node 前綴 / 離線禁用 + Banner / ?service 展開）
- [ ] Playwright E2E（014 spec：註冊→測試連線→Aggregate→切換→操作→離線→恢復→跨節點搜尋）

---

*產出日期：2025-08-18*
