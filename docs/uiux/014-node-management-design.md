# Node Management 頁面 — UI/UX 設計規格

> **功能編號**：014（多機管理 Agent 模式）的 UIUX 子設計
> **互動稿**：`docs/uiux/014-node-management-design.html`
> **上游**：`docs/interaction-flows/014-multi-node-agent-management.md` §3.2–3.4
> **關聯**：`docs/uiux/014-multi-node-view-redesign.md`（節點切換模式，已定案）
> **狀態**：設計中

---

## 1. 設計原則

| 原則 | 說明 |
|------|------|
| **漸進式揭露** | 節點列表預設精簡；操作按鈕在列上可見，詳細設定僅在 Modal 中 |
| **立即反饋** | 測試連線即時顯示結果，註冊/刪除後 Toast 通知 + 列表即時更新 |
| **安全網** | 刪除需二次確認；不可逆操作有明確提示 |
| **一致體驗** | 沿用 `--lms-*` Design Token，與 Dashboard 視覺語言一致 |
| **無障礙** | WCAG 2.1 AA 對比、完整鍵盤導航、ARIA 標註 |

---

## 2. 路由與資訊架構

| 路由 | 頁面 | 入口 |
|------|------|------|
| `/nodes` | Node Management 頁面 | Header 導覽列「節點管理」連結 |

頁面結構：

```
┌─ Header（共用）─────────────────────────────┐
│  Brand │ 儀表板 │ 節點管理(on) │ 稽核日誌    │
├─────────────────────────────────────────────┤
│  工具列：[＋新增節點] [⬇ 下載 Agent] 搜尋框  │
├─────────────────────────────────────────────┤
│  節點列表表格                                 │
│  ┌─名稱─┬─位址─┬─狀態─┬─最後心跳─┬─版本─┬─操作─┐│
│  │ ...  │ ...  │ ...  │  ...    │ ...  │ 編輯 ││
│  │      │      │      │         │      │ 移除 ││
│  └──────┴──────┴──────┴─────────┴──────┴──────┘│
├─────────────────────────────────────────────┤
│  分頁列（節點 > 20 時）                       │
└─────────────────────────────────────────────┘
```

---

## 3. 元件規格

### 3.1 工具列 (Toolbar)

| 元件 | 規格 |
|------|------|
| **新增節點按鈕** | 主按鈕（accent 背景、白字），內含 `+` icon。觸發新增節點 Modal |
| **下載 Agent 按鈕** | 次要按鈕（outlined），內含下載 icon。點擊展開架構選擇下拉（amd64/arm64） |
| **搜尋框** | 右側 pill 搜尋框，debounce 300ms，即時篩選節點名稱/位址 |

尺寸：工具列高度 ~48px，按鈕高度 `var(--h)` 36px（mobile 44px）。

### 3.2 節點列表表格 (Node Table)

| 欄位 | 類型 | 說明 |
|------|------|------|
| **名稱** | 文字 + 狀態燈 | 節點名稱（粗體）+ 狀態指示燈（inline） |
| **位址** | 等寬文字 | `host:port` 格式，`font-family: var(--mono)` |
| **狀態** | Badge | 🟢 線上 / 🟡 延遲 / 🔴 離線 / ⚫ 長期離線 |
| **最後心跳** | 相對時間 | 「3 秒前」「2 分鐘前」「1 小時前」，超 24h 顯示日期 |
| **版本** | 文字 | Agent 版本號，如 `v1.2.3`。離線時顯示 `—` |
| **備註** | 文字 | 備註摘要（截斷 30 字），hover 顯示完整 |
| **操作** | 按鈕組 | [編輯] [移除]，離線節點仍可操作（管理設定用） |

行互動：
- hover：整列 `background: var(--surface-2)`
- focus（鍵盤）：row 取得 focus ring
- 節點名稱可點擊跳轉至 Dashboard 單機視圖（僅線上/延遲狀態）

### 3.3 狀態 Badge

| 狀態 | Badge 樣式 | 顯示文字 |
|------|-----------|---------|
| 🟢 線上 | 綠底綠字 + 綠燈 | `線上` |
| 🟡 延遲 | 黃底黃字 + 黃燈 | `延遲` |
| 🔴 離線 | 紅底紅字 + 紅燈 | `離線` |
| ⚫ 長期離線 | 灰底灰字 + 灰燈 | `長期離線` |

### 3.4 空狀態

- 圖示：📦（或自訂 node icon）
- 標題：「尚無已註冊節點」
- 說明：「請先在目標機器部署 Agent，然後點擊「新增節點」進行註冊。」
- 操作：[下載 Agent] + [新增節點]

---

## 4. Modal 規格

### 4.1 新增節點 Modal

**尺寸**：寬度 520px（mobile 100vw - 2rem），最大高度 85vh，可滾動。

**結構**：

```
┌─ 標題列 ──────────────────────────────[✕]┐
│                                           │
│  節點名稱 *                                │
│  ┌───────────────────────────────────────┐│
│  │ web-server-02                         ││
│  └───────────────────────────────────────┘│
│                                           │
│  Agent 位址 *                              │
│  ┌───────────────────────────────────────┐│
│  │ 192.168.1.100:8443                    ││
│  └───────────────────────────────────────┘│
│  host:port 格式                           │
│                                           │
│  TLS 憑證指紋                              │
│  ┌───────────────────────────────────────┐│
│  │                                       ││
│  └───────────────────────────────────────┘│
│  選填。mTLS 時填入 Agent 憑證 SHA256 指紋   │
│                                           │
│  API Token                                │
│  ┌───────────────────────────────────────┐│
│  │ ••••••••••••                          ││
│  └───────────────────────────────────────┘│
│  選填。用於驗證 Manager 連線               │
│                                           │
│  備註                                      │
│  ┌───────────────────────────────────────┐│
│  │                                       ││
│  └───────────────────────────────────────┘│
│  選填。自由文字備註                         │
│                                           │
│  ┌─ 連線測試結果區 ──────────────────────┐│
│  │ (預設隱藏，測試後顯示)                 ││
│  └───────────────────────────────────────┘│
│                                           │
│  ┌──────────┬──────────┬────────────────┐│
│  │ 測試連線   │    註冊    │     取消       ││
│  └──────────┴──────────┴────────────────┘│
└───────────────────────────────────────────┘
```

**表單欄位**：

| 欄位 | 必填 | 類型 | placeholder | 驗證 |
|------|------|------|-------------|------|
| 節點名稱 | ✅ | text | `web-server-02` | 1–64 字元，不可含 `/`，唯一性 |
| Agent 位址 | ✅ | text | `192.168.1.100:8443` | `host:port` 格式，port 1–65535 |
| TLS 憑證指紋 | ❌ | text | (空) | SHA256 hex 格式（若有填寫） |
| API Token | ❌ | password | (空) | — |
| 備註 | ❌ | textarea | (空) | 最多 200 字 |

**按鈕行為**：

| 按鈕 | 樣式 | 行為 |
|------|------|------|
| **測試連線** | 次要按鈕（outlined） | 驗證必填欄位 → POST `/api/v1/nodes/test-connection` → 顯示結果 |
| **註冊** | 主按鈕（accent） | 驗證所有欄位 → POST `/api/v1/nodes` → 關閉 Modal + 更新列表 |
| **取消** | 文字按鈕 | 關閉 Modal，不儲存 |

### 4.2 編輯節點 Modal

**與新增 Modal 共用表單結構**，差異：

| 差異點 | 說明 |
|--------|------|
| 標題 | 「編輯節點 — {name}」 |
| 節點 ID | 新增唯讀欄位，顯示 `Node ID: abc123...`，不可編輯 |
| 按鈕 | [測試連線] [儲存] [取消]（無「註冊」） |
| 初始值 | 所有欄位預填目前值 |
| 位址變更 | 若位址有變更，註冊後觸發重連 |

### 4.3 刪除確認對話框

**尺寸**：寬度 400px。

```
┌─ 移除節點 ────────────────────[✕]┐
│                                   │
│  ⚠ 確定要移除此節點？              │
│                                   │
│  所有歷史資料將保留。               │
│  此操作無法復原。                   │
│                                   │
│  ┌──────────┬──────────────────┐ │
│  │   取消    │    確認移除 🔴    │ │
│  └──────────┴──────────────────┘ │
└───────────────────────────────────┘
```

| 按鈕 | 樣式 | 行為 |
|------|------|------|
| **取消** | 次要按鈕 | 關閉對話框 |
| **確認移除** | 危險按鈕（danger 背景、白字） | DELETE `/api/v1/nodes/{id}` → 關閉 + 列表更新 + Toast |

---

## 5. 測試連線流程

### 視覺狀態

| 狀態 | 顯示 |
|------|------|
| **Idle** | 測試連線按鈕 normal |
| **Loading** | 按鈕文字 → 「測試中…」+ spinner，表單 disabled |
| **成功** | 結果區顯示綠色區塊：✅ 連線成功 — Agent v1.2.3 @ web-server-02 (Ubuntu 22.04) |
| **失敗** | 結果區顯示紅色區塊：❌ 無法連線 — connection refused / TLS 憑證不符 |
| **重試** | 修改位址後，結果區清除，可再次測試 |

### 結果區 HTML 結構

```html
<div class="test-result success" role="status" aria-live="polite">
  <svg class="icon">✅ check-circle</svg>
  <div>
    <strong>連線成功</strong>
    <span>Agent v1.2.3 · web-server-02 · Ubuntu 22.04</span>
  </div>
</div>

<div class="test-result error" role="alert" aria-live="assertive">
  <svg class="icon">❌ x-circle</svg>
  <div>
    <strong>無法連線</strong>
    <span>connection refused (192.168.1.100:8443)</span>
  </div>
</div>
```

---

## 6. 狀態矩陣

### 節點列表行

| 狀態 | 視覺 | 互動 |
|------|------|------|
| 🟢 線上 | 綠燈、正常色 | 名稱可點擊 → Dashboard |
| 🟡 延遲 | 黃燈 + 「⚠ 心跳延遲」tooltip | 同上 |
| 🔴 離線 | 紅燈、行文字降低 opacity 0.65 | 名稱不可點擊、Tooltip「節點離線」 |
| ⚫ 長期離線 | 灰燈 | 同離線 |
| hover | 行背景 `var(--surface-2)` | cursor default |
| focus | focus ring（WCAG 2.4.7） | Tab 鍵盤導航 |
| 已選取 | 行背景 `var(--accent-light)` | 若支援多選（未來） |

### 操作按鈕

| 狀態 | 視覺 | 互動 |
|------|------|------|
| idle | outlined 按鈕 | hover → accent 邊框 + 文字色 |
| hover | accent 邊框 + accent 文字 | — |
| focus | focus ring | Enter/Space 觸發 |
| loading | spinner + disabled | 不可重複點擊 |
| disabled | opacity 0.45, cursor not-allowed | 不可互動 |

### Modal 整體

| 狀態 | 視覺 | 互動 |
|------|------|------|
| 關閉 | 不渲染（display:none 或 v-if） | — |
| 開啟 | 背景 dimming overlay + Modal 滑入/淡入 | Escape 鍵關閉、點擊 overlay 關閉 |
| 表單驗證失敗 | 對應欄位紅色邊框 + 底部錯誤訊息 | focus 至第一個錯誤欄位 |
| Loading（測試/註冊） | 按鈕 spinner、表單 disabled | 防止重複提交 |

---

## 7. RWD 行為表

| 斷點 | 節點列表 | Modal | 工具列 |
|------|---------|-------|--------|
| **≥1024** | 完整表格（7 欄） | 520px 寬、置中 | 單列：按鈕 + 搜尋框 |
| **768–1023** | 完整表格，字級略小 | 480px 寬 | 按鈕換行 |
| **≤767** | 卡片式列表（每張卡片 = 一行資料） | 100vw - 2rem，底部滑入 | 垂直堆疊：按鈕列 + 搜尋框 |

### Mobile 卡片式列表（≤767px）

桌面表格在 mobile 轉為卡片佈局：

```
┌─────────────────────────────┐
│ 🟢 web-server-02            │
│ 192.168.1.100:8443          │
│ 線上 · v1.2.3               │
│ 最後心跳：3 秒前             │
│ 備註：主要 Web 伺服器        │
│             [編輯] [移除]    │
└─────────────────────────────┘
```

每張卡片包含所有欄位，操作按鈕右下角排列。

---

## 8. 無障礙清單

| 項目 | 要求 | 實作方式 |
|------|------|---------|
| **色彩對比** | WCAG AA 4.5:1（文字）/ 3:1（大文字） | 所有 `--lms-*` 色值已驗證通過 |
| **鍵盤導航** | Tab 順序：工具列 → 表格行 → 分頁 → Modal | 所有互動元素可聚焦 |
| **Focus Ring** | 2px solid accent，offset 2px | `outline: 2px solid var(--accent); outline-offset: 2px` |
| **ARIA Labels** | 按鈕、連結、表單欄位皆有描述 | `aria-label` 或 `aria-describedby` |
| **狀態傳達** | 狀態燈不以顏色單獨傳達 | 燈號 + 文字標籤（線上/離線等） |
| **Modal 焦點鎖定** | Modal 開啟時焦點限制在 Modal 內 | `aria-modal="true"` + focus trap |
| **Screen Reader** | 表格使用 `role="table"` + `aria-label` | `<table aria-label="節點列表">` |
| **動態內容** | 測試結果、Toast 通知需 screen reader 可讀 | `aria-live="polite"` / `aria-live="assertive"` |
| **減少動效** | `prefers-reduced-motion: reduce` 時禁用動畫 | `* { transition: none !important; }` |
| **刪除確認** | 危險操作需明確提示 | 對話框含 `role="alertdialog"` |
| **表單錯誤** | 錯誤訊息與欄位關聯 | `aria-describedby` 指向錯誤訊息元素 |
| **表格標題** | 使用 `<th>` + `scope="col"` | 語意化表格結構 |

---

## 9. 互動細節

### 9.1 Toast 通知

| 情境 | 類型 | 訊息 |
|------|------|------|
| 節點註冊成功 | success | 「節點 {name} 已註冊」 |
| 節點註冊成功但無法連線 | warning | 「節點 {name} 已註冊，但目前無法連線」 |
| 節點名稱重複 | error | 「節點名稱重複，請使用不同名稱」 |
| 節點已更新 | success | 「節點 {name} 設定已更新」 |
| 節點已移除 | success | 「節點 {name} 已移除」 |
| 測試連線失敗 | error | 「無法連線：{錯誤訊息}」 |
| Agent 下載開始 | info | 「開始下載 Agent binary」 |

Toast 位置：右上角，自動消失 5 秒（error 8 秒），可手動關閉。

### 9.2 下載 Agent 按鈕

- 點擊後展開下拉選單：`linux-agent-amd64` / `linux-agent-arm64`
- 選取後觸發瀏覽器下載
- 下載來源：`GET /api/v1/agents/download?arch={arch}`

### 9.3 搜尋篩選

- 即時篩選（debounce 300ms）
- 範圍：節點名稱、位址、備註
- 無結果時顯示空狀態：「找不到符合「{query}」的節點」
- 清除按鈕（×）在有輸入時顯示

---

## 10. 實作建議

### 10.1 元件拆分

```
views/
  NodeManagement.vue          # 頁面容器
components/
  nodes/
    NodeTable.vue             # 節點列表表格
    NodeTableMobile.vue       # Mobile 卡片式列表
    NodeRow.vue               # 單行/卡片
    NodeToolbar.vue           # 工具列
    NodeAddModal.vue          # 新增節點 Modal（含表單）
    NodeEditModal.vue         # 編輯節點 Modal（共用 NodeAddModal 逻辑）
    NodeDeleteDialog.vue      # 刪除確認對話框
    TestConnectionResult.vue  # 測試連線結果元件
    AgentDownloadDropdown.vue # 下載 Agent 下拉選單
```

### 10.2 狀態管理

- 使用 Pinia store `useNodeStore` 管理節點列表狀態
- API 呼叫抽成 `composables/useNodeApi.ts`
- WebSocket 監聽節點狀態變更事件

### 10.3 表單共用

新增與編輯 Modal 共用 `NodeForm.vue` 元件，差異透過 props 控制：
- `mode: 'add' | 'edit'`
- `initialData?: NodeConfig`（edit 模式時傳入）
- `nodeId?: string`（edit 模式唯讀欄位）

### 10.4 表格 / 卡片響應式

使用 `useMediaQuery` 或 CSS media query 控制：
- `≥768px`：渲染 `<NodeTable>`（`<table>` 元件）
- `<768px`：渲染 `<NodeTableMobile>`（卡片列表）

### 10.5 載入與骨架屏

- 初次載入時顯示 skeleton rows（3–5 行 shimmer 動畫）
- 操作後（刪除、編輯） optimistic update + rollback on error

---

## 11. API 對應

| 功能 | 方法 | 端點 | 請求體 |
|------|------|------|--------|
| 取得節點列表 | GET | `/api/v1/nodes` | — |
| 取得單一節點 | GET | `/api/v1/nodes/{id}` | — |
| 新增節點 | POST | `/api/v1/nodes` | `{ name, address, tls_fingerprint, token, notes }` |
| 更新節點 | PUT | `/api/v1/nodes/{id}` | `{ name, address, tls_fingerprint, token, notes }` |
| 刪除節點 | DELETE | `/api/v1/nodes/{id}` | — |
| 測試連線 | POST | `/api/v1/nodes/test-connection` | `{ address, tls_fingerprint, token }` |
| 下載 Agent | GET | `/api/v1/agents/download?arch={arch}` | — (binary) |

---

## 12. 驗收清單

### 頁面基礎

- [ ] `/nodes` 路由可達，顯示 Node Management 頁面
- [ ] 工具列包含「新增節點」「下載 Agent」按鈕和搜尋框
- [ ] 節點列表正確顯示所有欄位（名稱、位址、狀態、心跳、版本、備註、操作）

### 節點列表

- [ ] 線上節點：綠燈 + 「線上」Badge
- [ ] 延遲節點：黃燈 + 「延遲」Badge + tooltip「心跳延遲」
- [ ] 離線節點：紅燈 + 「離線」Badge + 行 opacity 降低
- [ ] 長期離線：灰燈 + 「長期離線」Badge
- [ ] 最後心跳顯示相對時間（秒/分/時/天）
- [ ] 節點名稱（線上/延遲）可點擊跳轉 Dashboard
- [ ] 搜尋框即時篩選（debounce 300ms）
- [ ] 搜尋無結果時顯示空狀態

### 新增節點 Modal

- [ ] 點擊「新增節點」開啟 Modal
- [ ] 表單包含 5 個欄位（名稱*、位址*、TLS 指紋、Token、備註）
- [ ] 必填欄位未填時顯示紅色邊框 + 錯誤訊息
- [ ] 「測試連線」成功：顯示綠色結果區 + Agent 資訊
- [ ] 「測試連線」失敗：顯示紅色結果區 + 錯誤訊息
- [ ] 測試中按鈕顯示 spinner + 表單 disabled
- [ ] 「註冊」成功：Modal 關閉 + 列表更新 + Toast 通知
- [ ] 節點名稱重複時：Toast 錯誤通知
- [ ] 「取消」關閉 Modal 不儲存
- [ ] Escape 鍵關閉 Modal
- [ ] 點擊 overlay 關閉 Modal

### 編輯節點 Modal

- [ ] 點擊「編輯」開啟 Modal，預填目前值
- [ ] 節點 ID 顯示為唯讀欄位
- [ ] 「儲存」更新成功：Modal 關閉 + 列表更新 + Toast
- [ ] 位址變更後觸發重連

### 刪除確認對話框

- [ ] 點擊「移除」開啟確認對話框
- [ ] 顯示「確定要移除此節點？所有歷史資料將保留。」
- [ ] 「確認移除」執行刪除 + Toast 通知
- [ ] 「取消」關閉對話框

### 下載 Agent

- [ ] 點擊「下載 Agent」展開架構選擇
- [ ] 選取後觸發瀏覽器下載

### RWD

- [ ] ≥1024px：完整表格佈局
- [ ] 768–1023px：表格字級略小
- [ ] ≤767px：卡片式列表佈局
- [ ] Mobile Modal 底部滑入

### 無障礙

- [ ] 所有按鈕/連結可鍵盤到達
- [ ] Focus ring 可見（WCAG 2.4.7）
- [ ] 狀態傳達不依賴顏色
- [ ] Modal 焦點鎖定
- [ ] 表格使用語意化標籤
- [ ] 動態內容有 `aria-live`
- [ ] `prefers-reduced-motion` 支援

### 主題

- [ ] Light 主題下所有元素可讀
- [ ] Dark 主題下所有元素可讀
- [ ] 主題切換時無闪烁

---

*最後更新：2025-08-25*
