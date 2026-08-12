# API Token 管理 — TokenManageView 設計文件

> **對應功能**：#011 API Token Auth
> **畫面文件**：`docs/uiux/011-token-management-design.html`（互動 mockup，可切換主題／裝置）
> **設計日期**：2025-08-15
> **狀態**：設計完成，待實作
> **上游文件**：
> - `docs/interaction-flows/011-api-token-auth.md`（4 張流程圖 + 逐步互動說明）
> - `docs/bdds/011-api-token-auth.feature`（33 個 Scenario）
> - `docs/tech-decisions/011-api-token-auth.md`（Token 格式 lsm_、SHA-256、權限模型）
> - `docs/development/011-api-token-auth.md`（前端 code skeleton）

---

## 1. 設計決策：入口位置

### 為什麼不放在主導航？

API Token 管理屬於「設定配置」而非「日常操作」：

| | Dashboard | Audit Log | API Tokens |
|---|---|---|---|
| 使用頻率 | 每天多次 | 每天/每週 | 建立 CI 時一次，偶爾旋轉 |
| 心理歸類 | 🛠 操作 | 📋 審查 | ⚙️ 設定 |

業界慣例（GitHub、GitLab、Vercel）皆將 Token 管理放在 Settings 下。
主導航保留 Dashboard + Audit 兩個日常操作入口，Token 管理透過帳號選單進入。

### 帳號選單結構

```
[👤 A ▼]
├── 👤 admin（已登入）
├── ── 設定 ──
├── 🔑 API Tokens        ← 新增
├── 🌙 外觀：淺色
├── 🌐 語言：中文
├── ──────────
└── 🚪 登出
```

「設定」區塊將 Token 管理、Theme、Language 三項歸為一組，語意清晰。
未來若有 Webhook（013）、RBAC（016）等設定，也可自然歸入此區塊。

---

## 2. 現況審計

### 1.1 既有元件審計

| # | 元件 | 位置 | 可複用？ | 說明 |
|---|------|------|:---:|------|
| 1 | **AppHeader.vue** | `frontend/src/components/AppHeader.vue` | ✅ 需擴充 | `.nav-group > .nav-item.active` 模式完整（保留 Dashboard + Audit）；帳號選單新增「設定」區塊 + API Tokens menu-item |
| 2 | **ConfirmModal.vue** | `frontend/src/components/ConfirmModal.vue` | ✅ 直接複用 | `show` / `message` / `details` props + `confirm` / `cancel` emits；取消 Token 時可傳「確定要撤銷 Token『{name}』嗎？…」 |
| 3 | **EmptyState.vue** | `frontend/src/components/EmptyState.vue` | ✅ 需微調 | `message` prop + `showButton` + `clear` emit；Token 空狀態需改為「尚無 API Token」+「建立 Token」按鈕 |
| 4 | **main.css** | `frontend/src/assets/main.css` | ✅ 完全複用 | 所有 `--lms-*` 變數已定義；`lms-modal-overlay` / `lms-modal` 樣式完整；表格 `.table-wrapper` 可直接用 |
| 5 | **router/index.ts** | `frontend/src/router/index.ts` | ✅ 需擴充 | 現有 `/ /login /audit` 三條路由；新增 `/tokens` 路由 + lazy import |

### 1.2 需新建的元件

| # | 元件 | 位置 | 說明 |
|---|------|------|------|
| 1 | **TokenManageView.vue** | `frontend/src/views/` | Token 管理頁面主元件（表格、loading、error、empty） |
| 2 | **TokenCreateForm.vue** | `frontend/src/components/` | 建立 Token 表單（名稱 / 過期 / 權限 + 驗證） |
| 3 | **TokenRevealModal.vue** | `frontend/src/components/` | Token 一次性揭露 Modal（不可背景關閉） |
| 4 | **useTokenManager.ts** | `frontend/src/composables/` | Token 管理狀態邏輯 composable |
| 5 | **API client 擴充** | `frontend/src/api/client.ts` | `listTokens` / `createToken` / `revokeToken` |
| 6 | **型別擴充** | `frontend/src/types/service.ts` | Token 相關 interface |

### 1.3 排版事實

- AppHeader 的 `.nav-group` 使用 `position: absolute; left: 50%; transform: translate(-50%,-50%)` 絕對置中。目前在 Desktop 下只有兩個 nav-item（Dashboard + Audit），新增一個不會觸發換行。
- 表格使用 `.table-wrapper` 容器（`overflow-x: auto` + `border-radius: var(--lms-radius)`），與 service-table 共用相同樣式基礎。
- Mobile（≤767px）：主表格轉為卡片布局（`.table-wrapper table thead { display: none }`），需在 Token 表格中加入對應的結構。

---

## 3. 設計原則

1. **一致性** — 所有 Token 與 Tais 值對齊 `--lms-*` 變數系統，與 Dashboard / Audit 共用同一套 Design Token
2. **漸進式揭露** — Token 值僅在建立後顯示一次（Modal）；列表僅顯示前綴 + 遮罩；撤銷後不可恢復
3. **語意化圖示** — 所有圖示使用 inline SVG，不使用 emoji（跨平台渲染不一致）；狀態以文字 + 色彩雙重傳達（WCAG 1.4.1）
4. **觸控與鍵盤優先** — 按鈕最小 36px desktop / 44px mobile（WCAG 2.5.5）；Tab 鍵順序合理；focus ring 可見（WCAG 2.4.7）
5. **安全感** — 撤銷操作有 ConfirmModal 阻擋誤觸；Token 揭露 Modal 不可點背景關閉，防止誤關遺失 Token

---

## 4. 目標設計

### 3.1 頁面結構（Desktop ≥1024px）

```
┌──────────────────────────────────────────────────────────────┐
│ 🖥 Linux Service Manager    [🏠 服務管理] [📋 稽核記錄]     [👤 A] ← Header
│                                                      主導航僅 Dashboard + Audit
│                                                      API Tokens 由帳號選單進入
├──────────────────────────────────────────────────────────────┤
│ 🔑 API Tokens                              [+ 建立 Token]    ← 頁面標頭
├──────────────────────────────────────────────────────────────┤
│ ┌─ 建立新 API Token ──────────────────────────────────────┐  │
│ │ 名稱: [Jenkins CI        ]  過期: [90 天 ▼]            │  │
│ │ 權限: [👁 唯讀] [🔒 完整操作]                           │  │
│ │                    [產生 Token]  [取消]                  │  │
│ └──────────────────────────────────────────────────────────┘  │
├──────────────────────────────────────────────────────────────┤
│ 名稱         │ Token            │ 建立日期  │ 過期     │ …  │  ← 表格
│ Jenkins CI   │ lsm_****a3eU9   │ 2025-08-10│2025-11-08│ 🟢  │
│ Monitoring   │ lsm_****b7F2d   │ 2025-05-15│2025-08-20│ 🟡  │
│ Old Backup   │ lsm_****c9D1e   │ 2025-01-20│2025-07-20│ 🔴  │
│ Test Deploy  │ lsm_****e2F8a   │ 2025-03-12│永不過期   │ ⚫  │
└──────────────────────────────────────────────────────────────┘
```

### 3.2 Token 狀態標籤規格

| 狀態 | API 值 | 標籤文字 | 色彩（底 / 字） | SVG 圓點 | 觸發條件 |
|------|--------|---------|----------------|----------|---------|
| 使用中 | `active` | 使用中 | `#e8f5e9` / `#2e7d32` | 綠色圓 | 未過期、未撤銷、非 7 天內過期 |
| 即將過期 | `expiring_soon` | 即將過期 | `#fff3e0` / `#e65100` | 橙色圓 | 過期時間在 7 天內 |
| 已過期 | `expired` | 已過期 | `#fbe9e7` / `#c62828` | 紅色圓 | 過期時間已過 |
| 已撤銷 | `revoked` | 已撤銷 | `#f5f5f5` / `#9e9e9e` | 灰色圓 | 管理員手動撤銷 |

### 3.3 表格欄位定義

| 欄位 | 寬度 | 內容 | 備註 |
|------|:---:|------|------|
| 名稱 | 16% | Token 名稱（使用者自訂） | `font-weight: 600` |
| Token | 18% | `lsm_****a3eU9`（前 4 + 後 4 字元，中間 `****`） | `font-family: monospace`, `user-select: all` |
| 建立日期 | 10% | `YYYY-MM-DD` | — |
| 過期時間 | 10% | `YYYY-MM-DD` 或「永不過期」 | — |
| 最後使用 | 10% | `YYYY-MM-DD HH:mm` 或「從未使用」 | — |
| 權限範圍 | 10% | 「唯讀」或「完整操作」 | — |
| 狀態 | 12% | 狀態標籤（見 §3.2） | 四色標籤 |
| 操作 | 14% | 撤銷按鈕（僅 active/expiring_soon 顯示） | 已撤銷/已過期顯示「—」 |

### 3.4 建立 Token 表單規格

| 欄位 | 類型 | 必填 | 規格 |
|------|------|:---:|------|
| 名稱 | `<input type="text">` | ✅ | placeholder「例如：Jenkins CI」；前端驗證空白攔截 |
| 過期時間 | `<select>` | ✅ | 選項：30 天 / 60 天 / 90 天 / 180 天 / 365 天 / 永不過期 / 自訂日期 |
| 自訂日期 | `<input type="date">` | 條件 | 僅選擇「自訂日期」時顯示；最短為明天 |
| 權限範圍 | Radio group（segmented control） | ✅ | 「唯讀」（僅 GET API）vs「完整操作」（所有 API） |

**驗證規則**：

| 規則 | 檢查時機 | 錯誤訊息 |
|------|:---:|------|
| 名稱不可空白 | 前端 submit 時 | 「名稱為必填」 |
| 名稱不可重複（不區分大小寫） | 後端 API 回應 | 「此名稱已存在，請使用其他名稱」 |
| Token 數量不可超過 20 | 後端 API 回應 | 「已達 Token 數量上限（20）」 |
| 自訂日期不可為過去 | 前端 submit 時 | 「過期日期不可為過去」 |

---

## 5. 狀態矩陣

### 4.1 Token 列表頁面

| 狀態 | 視覺 | 互動 |
|------|------|------|
| **Idle** | Token 列表完整顯示，表格行正常透明度 | 可點擊「建立 Token」展開表單、可點擊撤銷按鈕 |
| **Hover（表格行）** | 整列背景 `var(--lms-accent-light)` | 游標移至行時反白 |
| **Focus（輸入框）** | `3px var(--lms-accent-light)` 光圈 + accent 邊框 | 表單內 Tab 順序：名稱 → 過期 → 權限 → 產生 → 取消 |
| **Active（按鈕）** | 按鈕 `transform: scale(0.96)` 按下回饋 | 點擊瞬間縮放 |
| **Loading（列表）** | 頁面中央 spinner（32px，accent 色頂邊） | 初始化載入或重整時顯示 |
| **Loading（提交）** | 按鈕 disabled + spinner 圖示 + 「產生中…」 | 提交後等待 API 回應期間 |
| **Error（列表）** | 紅色錯誤訊息 + 「重試」按鈕 | 點擊重試 → 重新呼叫 `GET /api/v1/tokens` |
| **Error（表單）** | 欄位紅框 + 表單下方紅色錯誤區塊 | 修改表單後可重新提交 |
| **空結果** | 鑰匙圖示 + 「尚無 API Token」+ 「建立 Token」按鈕 | 點擊按鈕展開建立表單 |

### 4.2 Token 揭露 Modal

| 狀態 | 視覺 | 互動 |
|------|------|------|
| **Idle** | Modal 完整顯示，黃色警告區塊 + token 值 + 複製按鈕（accent） + 「我已複製，關閉」 | 可點複製或關閉 |
| **已複製** | 複製按鈕變為 success 綠色 + 「✓ 已複製」文字 | 1.5s 後自動恢復為原樣 |
| **關閉** | Modal 淡出動畫 | Token 值從前端記憶體清除（`revealToken = null`）；列表重整；新 Token 以遮罩顯示 |

### 4.3 撤銷 ConfirmModal（複用既有元件）

| 狀態 | 視覺 | 互動 |
|------|------|------|
| **Idle** | Modal 顯示 warning 訊息 + 「取消」「確認撤銷」（danger 色） | 點取消 → 關閉；點確認 → 呼叫 API |
| **Loading（撤銷中）** | 「確認撤銷」按鈕 disabled + spinner | 等待 API 回應期間不可操作 |
| **成功** | Modal 關閉 + Toast「Token 已撤銷」 | Token 狀態變為「已撤銷」灰色，撤銷按鈕消失 |
| **失敗** | Modal 內顯示紅色錯誤「撤銷失敗，請重試」 | 可重試或取消 |

---

## 6. RWD 行為表

| 斷點 | 表格 | 表單 | 導航 | 觸控目標 |
|------|------|------|------|:---:|
| **≥1024px** | 完整 8 欄表格 | 內嵌卡片，欄位並排 | sticky header + 絕對置中 nav-group | 36px |
| **768–1023px** | 表格水平捲動 | 欄位並排但較窄 | 同 desktop | 36px |
| **≤767px** | 轉為卡片布局（每筆 Token 一張卡） | 欄位全寬堆疊 | nav-group 變為 3 欄等分 grid；header sticky + blur | 44px |

### 5.1 Mobile 卡片布局細節（≤767px）

```
┌──────────────────────────────┐
│ Jenkins CI          🟢 使用中 │
│ Token    lsm_****a3eU9      │
│ 權限     完整操作             │
│ 建立     2025-08-10          │
│ 過期     2025-11-08          │
│ ┌──────────────────────────┐ │
│ │       🗑 撤銷 Token       │ │
│ └──────────────────────────┘ │
└──────────────────────────────┘
```

- 每張卡片：`border-radius: 14px`、`box-shadow: var(--lms-shadow)`
- 卡片標頭：Token 名稱（左）+ 狀態標籤（右）
- Meta 區：2 欄 grid（Token / 權限、建立 / 過期）
- 撤銷按鈕：全寬 44px，danger 色
- 已過期 / 已撤銷卡片：`opacity: 0.5`，無撤銷按鈕

---

## 7. 無障礙（WCAG）

| 準則 | 要求 | 實作方式 |
|------|------|---------|
| **1.4.1 色彩** | 不以顏色單獨傳達資訊 | 狀態標籤有文字（「使用中」「即將過期」…）+ 色彩 |
| **2.4.7 焦點** | 所有互動元件有可見 focus ring | `outline: 2px solid var(--lms-accent); outline-offset: 2px` 或 `box-shadow: 0 0 0 3px var(--lms-accent-light)` |
| **2.5.5 觸控** | 觸控目標 ≥ 44×44px | Mobile 按鈕 `height: var(--lms-h-mobile)` = 44px |
| **4.1.2 名稱/角色** | 自訂元件有正確 ARIA | ConfirmModal `role="alertdialog" aria-modal="true"`；nav-group `aria-label="主導航"`；radio group 用 `<button>` + `aria-pressed` |

---

## 8. 實作建議

### 7.1 CSS 變數對應

所有變數已存在於 `main.css`，無需新增：

```css
/* 表格 */
.token-table-wrap { border-radius: var(--lms-radius); border: 1px solid var(--lms-border); }

/* 狀態標籤 */
.status-tag { border-radius: 4px; padding: 2px 8px; }
.st-active   { background: var(--lms-success-light); color: var(--lms-success); }
.st-expiring { background: var(--lms-warning-light); color: #e65100; }
.st-expired  { background: var(--lms-danger-light); color: var(--lms-danger); }
.st-revoked  { opacity: 0.5; }

/* Token 遮罩值 */
.token-masked {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  user-select: all;
}

/* 已撤銷 / 已過期行 */
.row-revoked td, .row-expired td { opacity: 0.5; }

/* Token 揭露 Modal */
.token-reveal-warning {
  background: #fff3e0;
  border: 1px solid #ff9800;
  border-radius: var(--lms-radius-sm);
  color: #e65100;
}
```

### 7.2 元件依賴關係

```
TokenManageView.vue
├── TokenCreateForm.vue        （新建）
├── TokenRevealModal.vue       （新建）
├── ConfirmModal.vue           （複用既有）
├── EmptyState.vue             （複用既有）
└── useTokenManager.ts         （新建 composable）
    └── api/client.ts          （擴充 listTokens / createToken / revokeToken）
```

### 7.3 AppHeader 擴充

主導航 `.nav-group` 保持 Dashboard + Audit 兩個項目不變。
API Tokens 入口放在既有帳號選單（`.account > .menu-pop`）中：

在 `<div class="menu-pop" role="menu">` 中，`menu-head` 下方新增「設定」區塊：

```vue
<div class="menu-head">
  <div class="who">👤 {{ username }}</div>
  <div class="meta">{{ t('account.signedIn') }}</div>
</div>
<!-- 新增：設定區塊 -->
<div class="menu-section">{{ t('menu.sectionSettings') }}</div>
<router-link
  to="/tokens"
  class="menu-item"
  role="menuitem"
  data-testid="menu-tokens"
  @click="closeMenu"
>
  <svg><!-- key icon --></svg>
  {{ t('menu.apiTokens') }}
</router-link>
<button class="menu-item" role="menuitem" @click="handleToggleTheme">
  {{ t('menu.toggleTheme') }}
</button>
<button class="menu-item" role="menuitem" @click="handleToggleLang">
  {{ t('menu.toggleLang') }}
</button>
<hr class="menu-divider">
<button class="menu-item danger" role="menuitem" @click="emit('logout')">
  {{ t('menu.logout') }}
</button>
```

- i18n 新增 `menu.sectionSettings`（zh：「設定」/ en：「Settings」）
- i18n 新增 `menu.apiTokens`（zh：「API Tokens」/ en：「API Tokens」）
- `menu-section` 的 CSS：`padding: 0.3rem 0.9rem; font-size: 0.68rem; color: var(--lms-muted); font-weight: 600;`

### 7.4 TokenRevealModal 關鍵行為

```typescript
// 不允許背景點擊關閉
// 使用 @click.self 但不觸發 close，或 overlay pointer-events: none
// 僅「我已複製，關閉」按鈕可關閉
```

---

## 9. 驗收檢查清單

### 設計驗收

- [ ] 狀態標籤四色清晰可辨，深色主題下對比度足夠
- [ ] 所有圖示為 inline SVG，無 emoji
- [ ] 表格行 hover 有反白效果
- [ ] 已撤銷 / 已過期行透明度降低、無撤銷按鈕
- [ ] Token 揭露 Modal 不可點背景關閉
- [ ] Token 值以等寬字體顯示，可選取
- [ ] 空狀態有建立按鈕
- [ ] 載入失敗有重試按鈕
- [ ] RWD：desktop 表格 → mobile 卡片
- [ ] Nav-group 在 desktop 三項並排不換行
- [ ] Focus ring 在所有互動元件上可見
- [ ] 表單驗證錯誤（名稱空白）顯示紅框 + 提示
- [ ] 表單後端錯誤（名稱重複）顯示紅色區塊

### BDD 覆蓋

所有 33 個 BDD Scenario 中與前端 UI 相關的 Story 皆在本設計中覆蓋，包括：
- Token 列表（含空狀態、錯誤狀態）
- 建立 Token 表單（驗證、提交 loading、成功揭露、失敗提示）
- Token 揭露 Modal（複製、關閉）
- 撤銷 ConfirmModal（確認、取消、loading、錯誤）

---

*產出日期：2025-08-15*
