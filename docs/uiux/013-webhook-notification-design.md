# Webhook 通知設定 — NotificationsView 設計文件

> **對應功能**：#013 Webhook Notification（Webhook 通知設定）
> **畫面文件**：`docs/uiux/013-webhook-notification-design.html`（互動 mockup，可切換主題／裝置／分頁／表單型態／三態 Demo）
> **設計日期**：2025-08-16
> **狀態**：設計完成，待實作
> **輸出形式**：單頁完整規格（greenfield 新頁面，無 BEFORE 可比對，不採比較稿）
> **上游文件**：
> - `docs/interaction-flows/013-webhook-notification.md`（11 步驟 + 4 子流程圖 + 異常處理 + 邊界限制）
> - `docs/bdds/013-webhook-notification.feature`（55+ Scenario）
> - `docs/tech-decisions/013-webhook-notification.md`（8 項決策：hub 回呼掛載、notify.json + JSONL 儲存、並行發送、4 種 payload、自動停用、30 天 TTL、前端 WS 事件、7 個 API）

---

## 1. 現況審計

### 1.1 既有元件審計（前端目前**零** notify 程式碼 — greenfield）

| # | 元件 | 位置 | 可複用？ | 說明 |
|---|------|------|:---:|------|
| 1 | **AppHeader.vue** | `frontend/src/components/AppHeader.vue` | ✅ 需擴充 | 主導航目前僅 2 項（🏠 儀表板、📋 稽核紀錄）；新增第 3 項「Notifications」導覽連結 + `nav.notifications` 翻譯 |
| 2 | **router/index.ts** | `frontend/src/router/index.ts` | ✅ 需擴充 | lazy-load pattern 已確立（AuditLog/TokenManage/ConfigEditor）；新增 `{ path: '/notifications', name: 'notifications', component: () => import('../views/NotificationsView.vue'), meta: { auth: true } }` |
| 3 | **useWebSocket.ts** | `frontend/src/composables/useWebSocket.ts` | ✅ 需擴充 | `WsMessage` union 目前 6 型態；新增 `NotifyChannelDisabledMessage { type:'notify_channel_disabled', id, name, reason }` + handlers Map 註冊 → 全域 Toast（沿用既有 pattern，Tech Decision D-5 雙通道） |
| 4 | **useI18n.ts** | `frontend/src/composables/useI18n.ts` | ✅ 需擴充 | `nav.*` 目前 3 鍵；新增 `nav.notifications`、「Channel 設定」「發送紀錄」「觸發事件」「服務範圍」等翻譯 |
| 5 | **useToast.ts + ToastContainer.vue** | `frontend/src/composables/` `components/` | ✅ 直接複用 | 三型態 `success/error/warning`（3500ms）；建立/刪除/測試/停用通知全數使用 |
| 6 | **ConfirmModal.vue** | `frontend/src/components/ConfirmModal.vue` | ✅ 直接複用 | confirm/cancel emits 齊備；刪除確認「確定刪除 Channel「XXX」？此操作無法復原。」直接使用 |
| 7 | **EmptyState.vue** | `frontend/src/components/EmptyState.vue` | ✅ 需擴充 | 目前 props `message/showButton` + emit `clear`（清除過濾語意）；Channel 空狀態需「新增 Channel」按鈕語意 — 擴充 `buttonLabel`/`buttonAction` prop 或改在 View 層直接渲染 |
| 8 | **toggle-switch 樣式** | `frontend/src/assets/main.css`（`.toggle-switch/.toggle-track/.toggle-thumb`，~1233 行） | ✅ 直接複用 | 既有 role=switch 開關（36×20 track / 16 thumb / 綠灰兩態 / loading pulse）已含樂觀更新與 loading 樣式，channel enabled 開關直接沿用 |
| 9 | **TokenManageView.vue** | `frontend/src/views/TokenManageView.vue` | ✅ 樣式參考 | page-header（標題 + 右上 primary 動作）＋表單展開＋loading/error/empty/table 四態結構可作 View 骨架範本 |
| 10 | **api/client.ts** | `frontend/src/api/client.ts` | ✅ 需擴充 | axios instance 與既有 `{data,total,page,limit}` 慣例齊備；新增 7 個 notify API 函式（listChannels/createChannel/updateChannel/deleteChannel/patchChannelEnabled/testChannel/getNotifyHistory） |

### 1.2 需新建的元件

| # | 元件 | 位置 | 說明 |
|---|------|------|------|
| 1 | **NotificationsView.vue** | `frontend/src/views/` | `/notifications` 頁面主元件（loading/error/empty 四態、兩分頁切換、ChannelForm 展開、WS 停用事件） |
| 2 | **ChannelCard.vue** | `frontend/src/components/` | channel 卡片（類型圖示、名稱、事件 chips、服務範圍摘要、toggle、測試/編輯/刪除動作） |
| 3 | **ChannelForm.vue** | `frontend/src/components/` | 新增/編輯表單（類型下拉動態欄位、headers key-value 編輯、事件 checkbox 群組、服務範圍 radio + 多選搜尋、驗證） |
| 4 | **ChannelHistoryTable.vue** | `frontend/src/components/` | 發送紀錄表格（Channel 下拉篩選、結果 pills、分頁、成功/失敗色標） |
| 5 | **useNotifyChannels.ts** | `frontend/src/composables/` | channels 狀態、CRUD、test、WS 停用事件處理（含 auto_disabled sessionStorage 去重） |
| 6 | **types/notify.ts** | `frontend/src/types/` | Channel / ChannelType / HistoryEntry 型別（對齊 Tech Decision §2 資料模型） |

### 1.3 實作 gap 清單

| # | 問題 | 嚴重度 | 位置 |
|---|------|:---:|------|
| 1 | Header 無 Notifications 導覽入口，功能無從進入 | P1 | `AppHeader.vue` + `router/index.ts` |
| 2 | 主導航圖示為 emoji（🏠 📋 🔔 若照 BDD 複製），跨平台渲染不一致 | P2 | `AppHeader.vue`（本次新增項一律 inline SVG，既有 emoji 列為後續清理） |
| 3 | 無 Channel / History 型別與 API client 函式 | P1 | `types/notify.ts` + `api/client.ts` |
| 4 | `EmptyState` 的按鈕語意固定為「清除過濾」，不適用「新增 Channel」 | P2 | `EmptyState.vue`（擴充或 View 層自渲染） |
| 5 | `useWebSocket` 無 `notify_channel_disabled` 訊息型別與 handler | P1 | `useWebSocket.ts` |
| 6 | Telegram Bot Token 於 API 回應為 masked（`****xxxx`），編輯表單需「留空=不變更」語意 | P2 | `ChannelForm.vue`（欄位 placeholder 說明 + 提交時留空不送） |

---

## 2. 設計決策

### 決策 1：入口 — Header 主導航第 3 項，圖示採 inline SVG 鈴鐺

| | 方案 A：主導航新增（選定） | 方案 B：收進帳號選單 | 方案 C：僅 Dashboard 卡片進入 |
|---|---|---|---|
| 可發現性 | ✅ 與儀表板/稽核同層級 | ⚠️ 收合於選單需多一步 | ❌ 需先回 Dashboard |
| 一致性 | ✅ 導航層級結構一致（BDD「點擊 Header 的 Notifications 連結」） | ✅ 選單已有 Tokens 先例 | ❌ 破壞「Header 進入」BDD |
| 空間 | 3 項 nav-item，現況可容納 | — | — |

**決策**：方案 A。`AppHeader.vue` 新增 `<router-link to="/notifications">`，**圖示用 inline SVG 鈴鐺**（`aria-hidden`）＋文字「Notifications」，`aria-current` 沿用既有 `.nav-item.active` pattern。BDD 以「🔔 Notifications 連結」描述，emoji 僅為文字示意，實作以 SVG 呈現（skill 規範：設計稿不使用 emoji-as-icon）。既有的 🏠/📋 emoji 列為 P2 後續清理項，不在本功能範圍內更動（避免與既有 E2E testid 衝突）。

### 決策 2：頁面結構 — 兩分頁（Channel 設定 / 發送紀錄），採用 pill 型 segmented 分頁

BDD「頁面提供『Channel 設定』分頁（預設顯示）與『發送紀錄』分頁」。設計採用 **pill 型 segmented control**（沿用 000-toolbar 的 `.pill` 樣式：18px 圓角、active 填 accent）置於頁面標題下方：

```
┌──────────────────────────────────────────────────────┐
│ 🔔 通知設定                          [＋ 新增 Channel] │ ← page-header（TokenManageView pattern）
│ ┌──────────────────────┐                              │
│ │ ○ Channel 設定 │ ○ 發送紀錄 │                       │ ← pill segmented（分頁）
│ └──────────────────────┘                              │
├──────────────────────────────────────────────────────┤
│ （分頁內容）                                          │
└──────────────────────────────────────────────────────┘
```

- **「新增 Channel」按鈕僅在 Channel 設定分頁顯示**（發送紀錄分頁隱藏，避免歧義）
- 分頁以 `role="tablist"` 實作（`aria-selected`、tabpanel `aria-labelledby`），鍵盤方向鍵切換
- 兩分頁各自獨立 loading / error / empty 狀態

### 決策 3：Channel 列表 — 卡片 grid（非表格）

| 理由 | 說明 |
|------|------|
| 資訊密度適中 | 每張卡片：類型圖示、名稱、事件 chips、服務範圍、toggle、3 動作 — 表格需 6+ 欄且 mobile 必爆版 |
| 停用視覺化 | 整卡灰化/半透明可直接表達 enabled=false（表格只能改列底色） |
| 既有先例 | 專案無 channel 型資料表格先例；卡片在 Dashboard 手機版已是主要 pattern |
| Mobile 優先 | 卡片單欄堆疊即完成 RWD，不需橫向捲動 |

卡片 grid：**desktop ≥1024px 三欄、768–1023px 兩欄、≤767px 單欄**（`repeat(auto-fill, minmax(280px, 1fr))`）。

### 決策 4：表單 — 頁面內展開卡片式（非 Modal）

Tech Decision 前端結構已定 `ChannelForm.vue`；BDD 允許「頁面內展開或 Modal」。設計採**頁面內展開**（accordion 卡片置於列表上方）：

| 情境 | 行為 |
|------|------|
| 新增 | 「＋ 新增 Channel」→ 展開空白表單（焦點移至類型下拉）；提交成功/取消 → 收起 |
| 編輯 | 卡片「編輯」→ 展開預填表單；同時間僅一張表單存在（展開新表單前自動收起舊表單） |

理由：表單欄位多（類型專屬欄位 + 4 事件 + 服務範圍多選 + 可能 headers 編輯），Modal 高度接近視窗高度，頁面內展開在 mobile 捲動更自然；且「表單與列表並存」符合 BDD「列表重整顯示新 channel」的上下文連續性。

### 決策 5：類型專屬欄位 — 動態切換（BDD Scenario Outline 四型）

| 類型 | 專屬欄位 | 提示（placeholder helper） |
|------|---------|------|
| Slack | Webhook URL | `https://hooks.slack.com/services/...` |
| Discord | Webhook URL | `https://discord.com/api/webhooks/...` |
| Telegram | Bot Token + Chat ID | 「請先向 @BotFather 建立 Bot 取得 Token，並在 @userinfobot 查詢 Chat ID」；編輯時 Token masked `****xxxx`，**留空 = 不變更** |
| 自訂 Webhook | Webhook URL + HTTP Method 下拉（POST/PUT）+ Headers key-value 編輯器 | headers ≤10 組；黑名單 Host / Content-Length / Transfer-Encoding / Connection |

選型後專屬欄位區以 150ms 淡入切換（尊重 `prefers-reduced-motion`）。

### 決策 6：觸發條件 — 事件 chips + 服務範圍 radio（全部 / 指定 + 多選搜尋）

- 觸發事件：4 個 checkbox 群組（started/stopped/failed/restarted），以 chip 樣式呈現勾選；**至少需選 1**（BDD @business-rules，前端攔截）
- 服務範圍：radio「全部服務」預設選中；「指定服務」切換後啟用多選搜尋（輸入關鍵字過濾服務列表、勾選多個、下方顯示已選 chips + 移除）
- 服務名稱精確匹配（BDD @service-matching：不支援 regex/glob），搜尋框僅過濾顯示，選擇以 systemd unit name 為準

### 決策 7：Toggle — 沿用既有 `.toggle-switch`，樂觀更新（BDD @channel）

- 沿用 `main.css` 既有 `.toggle-switch/.toggle-track/.toggle-thumb`（36×20px track、綠/灰、loading pulse）— 零新增樣式
- 互動：點擊立即切換（樂觀更新）→ `PATCH /api/v1/notify/channels/:id {enabled}` → 成功保持 / 失敗回復原狀態 + Toast「無法更新 Channel 狀態：{原因}」
- 停用（enabled=false）卡片灰化：`opacity: 0.55` + 卡片文字轉 muted（不以顏色單獨傳達，卡片上仍有「已停用」文字標籤）
- 測試中（POST test）卡片動作區鎖定其他操作（避免並發）

### 決策 8：自動停用警示 — 黃色徽章 + 全域 Toast 雙通道（Tech Decision D-5）

卡片若 `enabled=false && auto_disabled_reason != ""`：

```
┌──────────────────────────────┐
│ ⚠️ 已自動停用：連續失敗 10 次   │  ← 黃色警告橫幅（卡片頂部）
│ [重新啟用]                    │
└──────────────────────────────┘
```

- **即時**：WS `notify_channel_disabled` → 全域 Toast「Channel「XXX」因連續失敗已自動停用」（`role="alert"`）
- **補償**：頁面載入時比對 `enabled=false && auto_disabled_reason != ""` → 黃色 Toast + 卡片徽章；`sessionStorage` 去重避免重複 Toast
- 手動 re-enable（toggle 開啟）→ failures 歸零、reason 清空、徽章消失（Tech Decision D-5）

### 決策 9：發送紀錄 — 篩選列 + 表格 + 分頁（BDD @history）

```
┌──────────────────────────────────────────────────────────────┐
│ [Channel ▾ 全部]  ( ○全部 ○成功 ○失敗 )   第 1/3 頁 [‹][›]  │ ← 篩選列（36px）
├──────────────────────────────────────────────────────────────┤
│ 時間            Channel    觸發事件   目標服務    結果         │
│ 2025-08-16 10:03  團隊 Slack   failed    nginx.service  🟢 成功 │
│ 2025-08-16 09:58  個人 TG    started   postgres…      🔴 失敗  │
│ ...                                                          │
└──────────────────────────────────────────────────────────────┘
```

- 結果 pills：全部 / 成功 / 失敗（`status=success/failure` 參數）
- 成功綠（`--lms-success` + 文字「成功」）、失敗紅（`--lms-danger` + 錯誤訊息列於「結果」欄下方 mono 文字）— **文字 + 色彩雙重傳達**（WCAG 1.4.1）
- 分頁：每頁 30 筆，顯示「第 X/Y 頁」+ 上一頁/下一頁（BDD @history 分頁載入）
- 錯誤訊息過長以 `max-width` + 截斷（title 顯示全文）或換行顯示（設計採換行 + mono 0.75rem）
- **測試通知不寫入發送紀錄**（Tech Decision D-8）— 表格不會出現 test 事件；但後端資料模型保留 `test` 事件欄位（歷史相容）

---

## 3. 設計原則

1. **一致性** — 全部元件對齊 `--lms-*` 變數；分頁 pill、按鈕、toggle、Toast、ConfirmModal 全部沿用既有 pattern；Channel 表單欄位樣式對齊 TokenCreateForm
2. **漸進式揭露** — 類型專屬欄位選型才顯示；headers 編輯器收合於「＋ 新增 Header」；自動停用原因以徽章形式揭露，不常駐
3. **Contextual 不佔位** — 錯誤/警告 Toast 與卡片徽章僅在真實狀態出現；空狀態才顯示大圖示引導；正常狀態下介面乾淨
4. **語意化圖示** — 全部 inline SVG（Slack/Discord/Telegram/自訂類型圖示、鈴鐺、測試、編輯、刪除、警告）；不用 emoji-as-icon；成功/失敗以文字 + 色彩雙重傳達
5. **觸控與鍵盤優先** — 控制元件 36px desktop / 44px mobile（WCAG 2.5.5）；focus ring 可見；toggle `role="switch"`、分頁 `role="tablist"`、Modal `role="alertdialog"`

---

## 4. 目標設計（wireframe）

### 4.1 頁面結構（Desktop ≥1024px）

```
┌──────────────────────────────────────────────────────────────────────┐
│ 🖥 Linux Service Manager   [🏠 儀表板] [📋 稽核紀錄] [🔔 Notifications] │ ← AppHeader（新增第 3 項，SVG 鈴鐺）
├──────────────────────────────────────────────────────────────────────┤
│ 🔔 通知設定                                       [＋ 新增 Channel]   │ ← page-header（僅 Channel 分頁顯示按鈕）
│ 服務狀態變更時推送通知至 Slack / Discord / Telegram / 自訂 Webhook  │ ← 說明文字（muted 0.82rem）
├──────────────────────────────────────────────────────────────────────┤
│ [Channel 設定 ○] [發送紀錄 ○]                                       │ ← pill segmented（tablist）
├──────────────────────────────────────────────────────────────────────┤
│ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐                   │
│ │ ⬛ 團隊 Slack │ │ ⬛ 團隊 Discord│ │ ⬛ 個人 TG   │ ← 卡片 grid 3 欄  │
│ │ Slack · 已啟用│ │ Discord · 停用│ │ TG · 已啟用  │                  │
│ │ ┌failed┐┌start┐│ │ ┌started┐    │ │ ┌restarted┐  │                  │
│ │ 全部服務      │ │ 指定 2 服務   │ │ 全部服務      │                  │
│ │ [ON] 測試 ✏️ 🗑│ │ [OFF] 測試 ✏️🗑│ │ [ON] 測試 ✏️ 🗑│                  │
│ └──────────────┘ └──────────────┘ └──────────────┘                   │
└──────────────────────────────────────────────────────────────────────┘
```

### 4.2 ChannelForm（展開於列表上方）

```
┌──────────────────────────────────────────────────────────────────────┐
│ Channel 設定                                    [取消] [儲存]         │ ← 表單標題 + 動作（36px 按鈕）
│ ──────────────────────────────────────────────────────────────────  │
│ Channel 類型  [Slack ▾]   Channel 名稱  [團隊 Slack________]         │ ← 2 欄 grid（mobile 堆疊）
│ Webhook URL  [https://hooks.slack.com/services/..._________]        │ ← 類型專屬欄位（動態）
│ 觸發事件      ☑ failed  ☑ started  ☐ stopped  ☐ restarted          │ ← chips checkbox（≥1）
│ 服務範圍      ○ 全部服務   ○ 指定服務                               │ ← radio
│ （指定服務時）  [搜尋服務...]  已選：nginx.service ✕ postgresql.service ✕ │ ← 多選搜尋 + 已選 chips
│ 驗證錯誤      ⚠ 請填寫必要欄位（紅色邊框標示）                       │ ← 前端攔截（role="alert"）
└──────────────────────────────────────────────────────────────────────┘
```

自訂 Webhook 時額外區塊：

```
│ HTTP Method   [POST ▾]                                               │
│ Headers       ┌ Header 1: [Authorization▾] [Bearer xxx]  [🗑]      │
│               ┌ ＋ 新增 Header（最多 10 組）                          │
```

### 4.3 發送紀錄（ChannelHistoryTable）

```
┌──────────────────────────────────────────────────────────────────────┐
│ [Channel: 全部 ▾]   (○ 全部 ○ 成功 ○ 失敗)            第 1/3 頁 [‹][›] │
├──────────────────────────────────────────────────────────────────────┤
│ 時間                  Channel     觸發事件   目標服務      結果       │
│ 2025-08-16 10:03:12   團隊 Slack   failed    nginx.service  🟢 成功  │
│ 2025-08-16 09:58:41   個人 TG     started   postgresql…    🟢 成功  │
│ 2025-08-15 23:11:05   自訂監控     failed    mysql.service  🔴 失敗  │
│                                                          HTTP 500    │
├──────────────────────────────────────────────────────────────────────┤
│ 顯示 1–3 / 共 87 筆（時間倒序）                                      │
└──────────────────────────────────────────────────────────────────────┘
```

### 4.4 元件解剖

#### 4.4.1 ChannelCard

| 部位 | 規格 |
|------|------|
| 容器 | `--lms-surface` 背景、`1px --lms-border`、`border-radius: var(--lms-radius)`、`box-shadow` hover 提升 |
| 類型圖示 | 40×40px 圓角容器（`--lms-surface-2`），內嵌品牌 SVG（Slack 彩格/Discord 遊戲手把/Telegram 紙飛機/自訂 地球） |
| 名稱列 | 名稱 0.95rem semibold + 類型 label（mono 0.72rem muted） |
| 事件 chips | `.chip` 0.72rem、`--lms-accent-light` 底、accent 字、6px 圓角、`white-space:nowrap` |
| 服務範圍 | 「全部服務」或「N 個指定服務」（指定時 title 列出完整清單） |
| Toggle | 沿用 `.toggle-switch`（36×20 track）；ON 綠 / OFF 灰 / loading pulse |
| 動作列 | icon-only 36px 按鈕：測試（📤→SVG 紙飛機）、編輯（鉛筆）、刪除（垃圾桶）；`title` + `aria-label` 完整文字；測試中該按鈕轉 spinner |
| 停用態 | 卡片 `opacity:0.55`；「已停用」文字標籤於名稱旁；auto-disabled 時頂部黃色警告橫幅 + 「重新啟用」連結 |

#### 4.4.2 分頁 pills（tablist）

| 部位 | 規格 |
|------|------|
| 容器 | `--lms-surface-2` 底、`1px --lms-border`、10px 圓角、內 padding 3px（segmented） |
| pill | 高度 `var(--lms-h)`（mobile 44px）、18px 圓角、padding 0 0.85rem、hover accent、active 填 `--lms-accent` 白字 |
| ARIA | `role="tab"` + `aria-selected`、tabpanel `aria-labelledby`、方向鍵切換 |

#### 4.4.3 發送紀錄表格

| 部位 | 規格 |
|------|------|
| 表頭 | 0.72rem muted 600、`--lms-surface-2` 底 |
| 結果欄 | 🟢/🔴 改為「成功/失敗」文字 badge（success-light/danger-light 底）+ 錯誤訊息 mono 0.75rem 換行顯示 |
| 時間 | mono 0.78rem |
| 篩選列 | 36px 控制元件：Channel 下拉 + 結果 pills + 分頁控件右對齊 |

---

## 5. 狀態矩陣

### 5.1 ChannelCard

| 狀態 | 視覺 | 互動 |
|------|------|------|
| **Idle（啟用）** | 正常卡片、toggle ON 綠 | 測試/編輯/刪除可用；toggle 可點 |
| **Hover / Focus** | 卡片 `box-shadow` 提升；動作按鈕 accent 邊框；focus ring 3px | 按鈕可點 |
| **停用（enabled=false）** | 卡片 `opacity:0.55`、文字 muted、名稱旁「已停用」標籤 | toggle OFF；測試/編輯仍可用（重新啟用需 toggle）；刪除可用 |
| **自動停用（failures≥10）** | 同停用 + 卡片頂部黃色警告橫幅「⚠️ 已自動停用：{原因}」+「重新啟用」 | 重新啟用 → PATCH enabled=true（failures 歸零、徽章消失） |
| **測試中** | 測試按鈕轉 spinner + 卡片動作區鎖定 | 其餘動作 disabled；完成恢復 |
| **刪除確認** | ConfirmModal「確定刪除 Channel「XXX」？此操作無法復原。」 | 確認 → DELETE + 卡片淡出；取消 → 關閉無變化 |
| **刪除失敗** | Toast「無法刪除 Channel：{原因}」 | 卡片保留 |

### 5.2 ChannelForm

| 狀態 | 視覺 | 互動 |
|------|------|------|
| **Idle** | 類型 placeholder「請選擇 Channel 類型」；專屬欄位區隱藏 | 可填寫 |
| **類型已選** | 專屬欄位 150ms 淡入 | 依類型動態切換 |
| **必填錯誤** | 必填欄位 `--lms-danger` 邊框 + 紅框；頂部 `role="alert"`「請填寫必要欄位」 | 前端攔截不發 API |
| **事件未勾選** | 事件區紅框 + 提示「至少需勾選一個觸發事件」 | 前端攔截 |
| **Headers 超限** | 「＋ 新增 Header」disabled + 提示「最多 10 組」 | 前端攔截（11 組時） |
| **Saving** | 儲存按鈕 spinner + disabled | 不可重複送出 |
| **儲存成功** | Toast「Channel「XXX」已建立」/「Channel 已更新」 | 表單收起、列表重整 |
| **儲存失敗** | Toast 錯誤原因 | **表單內容保留**供修正 |
| **上限 20** | Toast「Channel 數量已達上限」 | 新增按鈕 disabled（或保留可點但攔截） |

### 5.3 Toggle

| 狀態 | 視覺 | 互動 |
|------|------|------|
| ON → OFF | 立即切灰（樂觀更新） | `PATCH {enabled:false}`；成功保持 / 失敗回復 ON + Toast |
| OFF → ON | 立即切綠 | `PATCH {enabled:true}`；成功保持（failures 歸零）/ 失敗回復 OFF + Toast |
| Pending | track loading pulse | 期間不可再點 |

### 5.4 發送紀錄

| 狀態 | 視覺 | 互動 |
|------|------|------|
| **Loading** | spinner +「載入中...」 | 不可操作 |
| **空結果** | EmptyState「尚無通知發送紀錄」 | — |
| **有資料** | 時間倒序表格 | Channel 下拉 / 結果 pills / 分頁 |
| **篩選中** | 篩選控件 active 樣式 + 表格即時更新 | 重新查詢 |
| **分頁** | 「第 X/Y 頁」+ ‹ › 按鈕 | 翻頁重新查詢 |
| **成功列** | 綠 badge「成功」 | — |
| **失敗列** | 紅 badge「失敗」+ 錯誤訊息 mono 換行 | title 顯示全文 |

### 5.5 測試 Webhook（按鈕 + Toast）

| 狀態 | 視覺 | 互動 |
|------|------|------|
| 發送中 | 按鈕 spinner + Toast「正在發送測試通知...」 | 動作鎖定 |
| 成功 | Toast「測試通知已發送 ✅，請檢查目標平台」 | 按鈕恢復 |
| 失敗 | Toast「測試失敗 ❌：{原因}」（如 403/404/timeout） | 按鈕恢復 |
| 平台異常 | Toast「⚠️ 請求已送出但目標平台回覆異常，請檢查 URL/Token」（HTTP 200 但平台拒絕） | 按鈕恢復 |

### 5.6 頁面層級

| 狀態 | 視覺 | 互動 |
|------|------|------|
| **Loading** | 中央 spinner +「載入中...」（`GET /api/v1/notify/channels`） | — |
| **Error** | 錯誤訊息 +「重試」按鈕 | 重試重新 GET |
| **空 Channel** | EmptyState「尚未設定任何通知 Channel」+「新增 Channel」按鈕 | 點擊展開表單 |
| **WS 停用事件** | 全域 Toast「Channel「XXX」因連續失敗已自動停用」（`role="alert"`） | 卡片同步黃色徽章 |

---

## 6. RWD 行為表

| 斷點 | Channel 卡片 | 表單 | 發送紀錄 | 觸控目標 |
|------|-------------|------|---------|:---:|
| **≥1024px** | grid 3 欄 | 2 欄 grid（類型+名稱並排；專屬欄位全寬） | 完整表格 6 欄 | 36px |
| **768–1023px** | grid 2 欄 | 同左，容器收窄 | 表格 `overflow-x:auto`；篩選列 wrap | 36px |
| **≤767px** | grid 1 欄（卡片全寬） | 全部欄位堆疊單欄；headers 編輯器單列 | 表格橫向捲動（或改卡片式簡表）；篩選列堆疊全寬 | 44px |

Mobile 分頁 pills：兩顆各 `flex:1` 全寬 44px；「新增 Channel」按鈕 `flex:1` 44px；卡片動作列 icon 按鈕 44px。

---

## 7. 無障礙（WCAG）

| 準則 | 要求 | 實作方式 |
|------|------|---------|
| **1.4.1 色彩** | 不以顏色單獨傳達 | 成功/失敗 badge 有文字（「成功」「失敗」）+ 色彩；停用卡片有「已停用」文字標籤；狀態事件以 chips 文字呈現 |
| **2.4.7 焦點** | 所有互動元件可見 focus ring | `box-shadow: 0 0 0 3px var(--lms-accent-light)`；表單展開後焦點移至類型下拉 |
| **2.5.5 觸控** | 觸控目標 ≥44×44px | Mobile 全部控制元件 44px；卡片動作 icon 44px |
| **4.1.2 名稱/角色** | 自訂元件正確 ARIA | Toggle `role="switch" aria-checked` + `aria-label`「啟用 {name}」；分頁 `role="tablist/tab" aria-selected`；Modal `role="alertdialog" aria-modal="true"`（既有 ConfirmModal）；Toast `role="status"/"alert"`；icon-only 按鈕 `aria-label`（「測試 {name}」「編輯 {name}」「刪除 {name}」） |
| **1.4.3 對比** | 文字對比 ≥4.5:1 | 停用卡片文字維持對比（不低於 4.5:1，僅降飽和不降亮度過頭）；warning 文字深色主題使用淺黃 |
| **2.1.1 鍵盤** | 所有功能鍵盤可達 | 分頁方向鍵切換；表單 Enter 提交；ConfirmModal focus trap（既有）；Esc 關閉表單/Modal |

---

## 8. CSS 變數對應與新增

### 8.1 既有變數（直接使用）

```css
--lms-accent / --lms-accent-light / --lms-accent-hover
--lms-success / --lms-success-light / --lms-success-border
--lms-danger / --lms-danger-light / --lms-danger-border
--lms-warning / --lms-warning-light
--lms-bg / --lms-surface / --lms-surface-2 / --lms-surface-3
--lms-border / --lms-text / --lms-muted
--lms-radius (10px) / --lms-radius-sm (6px)
--lms-h (36px) / --lms-h-mobile (44px)
--lms-shadow / --lms-shadow-lg / --lms-transition
```

### 8.2 需新增樣式（.vue scoped 或 main.css）

| 樣式 | 說明 |
|------|------|
| `.notify-page-header` | 標題 + 說明 + 右側動作（TokenManageView `.page-header` pattern） |
| `.notify-tabs` | pill segmented（`.pill` 樣式套用於 tablist） |
| `.channel-grid` | `display:grid; gap:1rem; grid-template-columns: repeat(auto-fill,minmax(280px,1fr))` |
| `.channel-card` / `.channel-card.disabled` | 卡片 + 停用灰化（`opacity:0.55`） |
| `.channel-card.auto-disabled` | 黃色警告橫幅（`--lms-warning-light` 底 + warning 字） |
| `.channel-chip` | 事件 chips（accent-light 底 6px 圓角） |
| `.channel-type-icon` | 40×40 類型圖示容器 |
| `.channel-actions .btn-act` | icon-only 36/44px 動作按鈕 |
| `.channel-form` / `.form-grid` | 表單卡片 + 2 欄 grid（mobile 單欄） |
| `.field-error` | `--lms-danger` 邊框 + 紅字提示 |
| `.header-editor-row` | headers key-value 編輯列 |
| `.history-table` | 發送紀錄表格（含 `overflow-x` 包裝） |
| `.result-badge.success/.failure` | 成功/失敗文字 badge |
| `.history-pager` | 分頁控件 |
| `.svc-multiselect` | 指定服務多選搜尋 + 已選 chips |

---

## 9. 驗收檢查清單

### 設計驗收

- [ ] Header 第 3 項導覽「Notifications」（inline SVG 鈴鐺），點擊導航 `/notifications`
- [ ] 兩分頁「Channel 設定」（預設）/「發送紀錄」以 pill segmented 呈現，`role="tablist"` 語意正確
- [ ] Channel 卡片含：類型圖示、名稱、事件 chips、服務範圍、toggle、測試/編輯/刪除
- [ ] 空狀態「尚未設定任何通知 Channel」+「新增 Channel」按鈕
- [ ] 表單類型下拉動態切換 4 型專屬欄位（Slack/Discord URL、Telegram Bot Token + Chat ID、自訂 method+headers）
- [ ] 觸發事件 ≥1 前端攔截；headers ≤10 組前端攔截；必填欄位紅框 + `role="alert"` 提示
- [ ] 指定服務範圍：搜尋多選 + 已選 chips + 移除
- [ ] Toggle 樂觀更新，失敗回復 + Toast；停用卡片灰化 + 「已停用」標籤
- [ ] 自動停用：黃色徽章 + 原因 + 重新啟用（WS 全域 Toast + sessionStorage 去重）
- [ ] 刪除 ConfirmModal「確定刪除 Channel「XXX」？此操作無法復原。」+ 淡出動畫
- [ ] 測試按鈕三態（loading/成功/失敗/平台異常）Toast 文案與 BDD 一致
- [ ] 發送紀錄：Channel 下拉 + 結果 pills + 分頁；成功綠/失敗紅 badge + 錯誤訊息
- [ ] 深淺主題皆可讀；RWD 三斷點行為符合 §6
- [ ] 所有圖示 inline SVG、無 emoji-as-icon；`prefers-reduced-motion` 生效
- [ ] Headless 驗證：console 無 error、標籤平衡、所有互動正常

### BDD 覆蓋對照

| BDD 區塊 | 設計對應 |
|---------|---------|
| @entry（進入頁面/兩分頁/列表/空狀態） | §2 決策 2、§4.1、§5.6 |
| @channel 新增（4 型 Outline） | §2 決策 4-6、§4.2 |
| @channel 驗證（必填/事件≥1/指定服務/儲存失敗保留） | §2 決策 6、§5.2 |
| @channel 編輯/開關/刪除 | §2 決策 4/7、§5.1 |
| @test 測試四態 | §5.5 |
| @trigger（背景觸發 — 無 UI） | 發送紀錄反映（@history） |
| @history（表格/空/篩選/分頁/色標） | §2 決策 9、§4.3、§5.4 |
| @error-handling 自動停用 | §2 決策 8、§5.1/5.6 |
| @edge-case 上限 20 / headers 超限 / 精確匹配 | §5.2（上限 Toast）、表單 headers 攔截、搜尋僅過濾 |
| @api 401 | 既有 AuthMiddlewareComposite — 前端登出即不顯示 |

### 實作後續（tech decision 關聯）

- [ ] `frontend/src/views/NotificationsView.vue` + `ChannelCard/ChannelForm/ChannelHistoryTable` + `useNotifyChannels` + `types/notify.ts` + 7 個 API 函式
- [ ] `useWebSocket.ts` 新增 `notify_channel_disabled` 型別與 handler
- [ ] `AppHeader.vue` 新增導覽 + `useI18n.ts` 翻譯
- [ ] Playwright E2E（新增→測試→觸發→紀錄→自動停用）後續依 test-plan 013 執行

---

*產出日期：2025-08-16*
