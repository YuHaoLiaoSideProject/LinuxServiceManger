# 開發方案決策文件：服務搜尋強化

## 📌 決策摘要

| 項目 | 內容 |
|------|------|
| **最終方案** | 純前端方案：Vue 3 computed + Pinia store 複合過濾 + Vue Router query sync |
| **決策日期** | 2025-08-10 |
| **對應 Roadmap** | Phase 2 — `docs/development/002-expansion-roadmap.md` 項目 #4 |
| **輸入文件** | `docs/bdds/007-service-search-enhancement.feature`、`docs/interaction-flows/007-service-search-enhancement.md` |
| **共識程度** | ✅ 確認通過 |

---

## 1. 需求回顧

### 1.1 核心業務價值

在現有文字搜尋基礎上，加入狀態過濾按鈕（Running / Failed / Inactive）與正則搜尋模式，讓管理員在大量服務中快速定位目標。所有過濾在前端執行，不發送 API 請求。

### 1.2 功能邊界

| 項目 | 範圍 |
|------|------|
| **Must Have (P0)** | 狀態過濾按鈕組、正則模式開關、文字搜尋（含 debounce）、複合過濾取交集、正則語法錯誤提示、空狀態頁面 |
| **Should Have (P1)** | URL query string 同步、Tab 切換保留過濾條件、StatsBar 維持全域統計、載入中 disabled 狀態 |
| **Nice to Have (P2)** | RWD 響應式、深色模式適配、100+ 服務效能 |

### 1.3 既有基礎

- Toolbar.vue 已有基本文字搜尋（v-model + 前端即時篩選）
- ServiceTable.vue 已有 filteredServices computed（目前僅文字過濾）
- 服務清單由 Pinia store (`useServiceStore`) 管理，含 `activeState` 欄位
- Vue Router 已用於 Tab 切換（我的服務 / 系統服務）

---

## 2. 關鍵技術決策

### 決策 1：狀態過濾按鈕互動模式

| 方案 | 描述 | 優點 | 缺點 |
|------|------|------|------|
| **A. Single-select（選定）** | 同一時間只有一個按鈕 active，點擊已 active 按鈕取消回到 All | 互動單純、與現有 UI 一致、符合 filter-group 常見模式 | 無法同時選多個狀態（需求不要求） |
| B. Multi-select toggle | 可同時 active 多個按鈕（如 Running + Failed） | 彈性高 | UI 複雜、使用場景少、違反 BDD 規格 |

> **決策**：方案 A。BDD 明確描述單選行為，且需求為「快速篩出異常服務」，單選已滿足。

### 決策 2：正則引擎

| 方案 | 描述 | 優點 | 缺點 |
|------|------|------|------|
| **A. JS RegExp（選定）** | 使用瀏覽器內建 `new RegExp(input)` | 零依賴、前端過濾一致、ECMAScript 標準 | 無 |
| B. 後端正則 | API 傳送 regex 參數由 Go 端解析 | 無 | 違反「純前端過濾」設計原則、增加延遲 |

> **決策**：方案 A。需求明確定義「所有過濾操作在前端執行」，JS RegExp 為唯一合理選擇。

### 決策 3：Debounce 策略

| 方案 | 描述 | 優點 | 缺點 |
|------|------|------|------|
| **A. 150ms debounce（選定）** | 使用 `setTimeout` 或 Vue `useDebounceFn`（VueUse） | 互動流暢、避免每次按鍵觸發篩選 | 極輕微延遲感 |
| B. input 事件直接觸發 | 每次按鍵立即篩選 | 即時回饋 | 大量服務時效能問題 |
| C. 300ms+ debounce | 更長的延遲 | 更少計算 | 使用者感知延遲 |

> **決策**：方案 A。150ms 是 BDD 明確定義的值，在主觀感受上幾乎無延遲，同時有效減少計算次數。

### 決策 4：URL Query String 同步

| 方案 | 描述 | 優點 | 缺點 |
|------|------|------|------|
| **A. Vue Router query（選定）** | 使用 `router.replace({ query })` 同步 `status`、`search`、`regex` 參數 | 原生整合、支援瀏覽器上一頁、可分享連結 | 需處理初始化恢復邏輯 |
| B. 不實作 URL 同步 | 過濾狀態僅存記憶體 | 最簡 | 重整後遺失、無法分享 |
| C. localStorage | 存於 localStorage | 重整不遺失 | 無法分享、無上一頁支援 |

> **決策**：方案 A。優先級 P1，但架構簡單（僅 `router.replace`），一次投入即可獲得分享、書籤、瀏覽器導航支援。

### 決策 5：StatsBar 行為

| 方案 | 描述 | 優點 | 缺點 |
|------|------|------|------|
| **A. 全域統計（選定）** | StatsBar 永遠顯示全部服務的統計數字 | 一致的總覽資訊、符合 BDD | 與過濾後列表數字不一致 |
| B. 過濾後統計 | StatsBar 數字跟隨過濾條件變化 | 反映當前列表 | BDD 明確排除此行為 |

> **決策**：方案 A。BDD Scenario「StatsBar 數字反映全域統計不受過濾影響」明確定義。

### 決策 6：Tab 切換時過濾保留

| 方案 | 描述 |
|------|------|
| **A. 保留並套用（選定）** | 切換 Tab 時過濾條件保留，對新 Tab 服務集合重新套用 |

> **決策**：方案 A。唯一合理選擇，BDD 明確定義。

---

## 3. 架構概覽

```
┌──────────────────────────────────────────────────┐
│  DashboardView.vue                                │
│  ┌────────────────────────────────────────────┐  │
│  │  Toolbar.vue                                │  │
│  │  ┌──────────┐ ┌─────┐ ┌─────┐ ┌─────┐     │  │
│  │  │ SearchBox │ │ All │ │ Run │ │Fail │ ... │  │  │
│  │  │ + Regex   │ │ btn │ │ btn │ │ btn │     │  │  │
│  │  └──────────┘ └─────┘ └─────┘ └─────┘     │  │  │
│  └────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────┐  │
│  │  ServiceTable.vue                           │  │
│  │  filteredServices = computed(               │  │
│  │    services                                  │  │
│  │    ∩ statusFilter                           │  │
│  │    ∩ textSearch (regex or substring)        │  │
│  │  )                                          │  │
│  └────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────┐  │
│  │  EmptyState.vue (when filteredServices=0)  │  │
│  └────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────┘

Data Flow:
  Pinia store (all services)
       │
       ▼
  useServiceFilter composable
       │  statusFilter: 'all' | 'running' | 'failed' | 'inactive'
       │  searchText: string
       │  regexMode: boolean
       │  filteredServices: computed
       │
       ▼
  ServiceTable (renders filtered result)
       │
       ▼
  router.replace({ query })  ← URL sync (P1)
```

---

## 4. 風險評估

| 風險 | 可能性 | 影響 | 緩解措施 |
|------|--------|------|---------|
| 大量服務（100+）時正則過濾效能 | 低 | 中 | computed 自動緩存、debounce 150ms；若仍慢可加 `shallowRef` |
| URL query 參數與其他功能衝突 | 低 | 低 | 僅使用 `status`/`search`/`regex` 三個 key，不干擾現有 `tab` 參數 |
| 正則 ReDoS（正則拒絕服務） | 低 | 中 | 可加入 timeout 保護（如 1000ms 後強制中斷），但一般使用場景風險極低 |
| 手機佈局過濾按鈕過擠 | 中 | 低 | P2 項目，可用 flex-wrap 或摺疊選單容錯 |

---

## 5. 相依與整合

| 項目 | 影響 |
|------|------|
| 現有 Toolbar.vue 文字搜尋 | 擴充，不破壞既有行為 |
| ServiceTable.vue filteredServices | 擴充過濾邏輯 |
| Pinia useServiceStore | 無需修改（僅讀取） |
| Vue Router | 新增 query sync（不影響現有 route） |
| Tab 切換（我的服務 / 系統服務） | 過濾條件跨 Tab 保留 |

---

## 6. 不需變更的部分

- 後端：無任何 API 改動（純前端過濾）
- 權限模型：無影響
- 現有文字搜尋行為：向後相容
- Deploy 流程：無影響

---

*最後更新：2025-08-10*
