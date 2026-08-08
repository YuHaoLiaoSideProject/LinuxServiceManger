# 開發方案決策文件：Enable / Disable 開機自動啟動

> **對應互動流程**：`docs/interaction-flows/004-enable-disable-service.md`
> **對應 BDD**：`docs/bdds/004-enable-disable-service.feature`
> **對應 Roadmap**：Phase 1 — `docs/development/002-expansion-roadmap.md`

---

## 📌 決策摘要

| 項目 | 內容 |
|------|------|
| **最終方案** | 延伸既有 JSON API 模式，新增 enable/disable 端點 + 前端 Toggle 元件 |
| **決策日期** | 2025-08-08 |
| **共識程度** | ✅ 單一決策 — 此為既有架構下的唯一合理路徑 |
| **預估工時** | 後端 2h + 前端 4h + 整合測試 2h = **1 人天** |

---

## 1. 需求回顧

### 1.1 核心業務價值

補完服務生命週期管理：現有 start / stop / restart，加上 enable / disable 後，管理員不需 SSH 即可完整控制 systemd 服務。

### 1.2 功能邊界

| 項目 | 範圍 |
|------|------|
| **Must Have** | Dashboard 獨立 Auto-start 欄位，以 Toggle 顯示開關狀態；Enable 不彈確認；Disable 彈確認對話框；Toast 通知結果 |
| **Nice to Have** | 批次 enable/disable（Roadmap Phase 2，不在本次範圍） |
| **限制條件** | 僅解鎖服務（FragmentPath 在 `/etc/systemd/system/`）可操作；static/masked/alias 顯示「不適用」 |

### 1.3 既有基礎

- `systemd.Service` struct 已有 `UnitFileState` 和 `FragmentPath` 欄位
- `isLocked()` 函式已依 UnitFileState 判斷鎖定
- 前端已有 `Service` type、Pinia store、Toast、ConfirmModal
- JSON API 模式已用於 start/stop/restart

---

## 2. 方案分析

### 2.1 方案 A：延伸既有 JSON API 模式 ✅ 選定

| 項目 | 內容 |
|------|------|
| **策略** | 在既有 JSON API (`/api/v1/services/{name}/enable`, `/api/v1/services/{name}/disable`) 上新增兩個端點，前端沿用 Vue 3 + Pinia + Axios 架構 |
| **改動範圍** | `systemd.go` +2 方法、`json_handler.go` +2 handler、`main.go` +2 route、`client.ts` +2 API call、`service.ts` 補 UnitFileState 欄位、`ServiceRow.vue` 新增 Toggle 欄位、`DashboardView.vue` 新增 handleToggle |

#### 後端改動

```
src/internal/systemd/systemd.go
  + EnableService(name string) error   → exec systemctl enable {name}
  + DisableService(name string) error  → exec systemctl disable {name}
  + ServiceManager interface 補上兩個方法

src/internal/handler/json_handler.go
  + HandleEnableJSON(w, r)   → POST /api/v1/services/{name}/enable
  + HandleDisableJSON(w, r)  → POST /api/v1/services/{name}/disable

src/internal/handler/json_handler.go
  + serviceJSON struct 補上 unitFileState, fragmentPath 欄位
  + HandleServicesJSON 回傳時填入新欄位

src/main.go
  + 註冊兩個新 route
```

#### 前端改動

```
frontend/src/types/service.ts
  + unitFileState: string
  + fragmentPath: string

frontend/src/api/client.ts
  + enableService(name) → POST /services/{name}/enable
  + disableService(name) → POST /services/{name}/disable

frontend/src/components/ServiceRow.vue
  + 新增 <td> Auto-start 欄位，內含 Toggle 元件
  + 鎖定狀態顯示 🔒
  + static/masked/alias 顯示「不適用」

frontend/src/views/DashboardView.vue
  + handleToggle(action, name) 方法
  + disable 時先彈 ConfirmModal
  + Toast 成功/失敗通知
```

#### 優勢
- 完全符合互動流程文件的 JSON API 設計
- 與現有 start/stop/restart 模式一致，學習成本為零
- 重複使用既有元件（ToastContainer、ConfirmModal）
- 最小改動，最小風險

#### 劣勢
- 無顯著劣勢（此為既存模式的自然延伸）

---

### 2.2 方案 B：延伸 HTMX 伺服器端模式 ❌ 否決

| 項目 | 內容 |
|------|------|
| **策略** | 在 HTMX legacy 路由 (`/api/services/{name}/enable`) 上新增端點，沿用 `respondWithFlash` 模式 |
| **改動範圍** | `handler.go` +2 handler、`main.go` +2 HTMX route、Go template 調整 |

#### 否決理由
1. HTMX 路由已是 legacy，既有 Vue SPA 為主要前端
2. 互動流程文件明確設計為 Toggle + Toast（SPA 互動模式），HTMX 無法實現 Toggle 的 loading 狀態
3. HTMX 模式無法實現 disable 前的 ConfirmModal（需要前端狀態管理）
4. 方案 A 與既有 start/stop/restart JSON API 完全一致

---

### 2.3 方案 C：D-Bus 直接操作 ❌ 否決

| 項目 | 內容 |
|------|------|
| **策略** | 使用 D-Bus API (`EnableUnitFiles` / `DisableUnitFiles`) 而非 `systemctl` 指令 |

#### 否決理由
1. 既有 start/stop/restart 全部使用 systemctl 指令（一致性考量）
2. D-Bus 的 `EnableUnitFiles` 與 `systemctl enable` 行為有微妙差異（如 symlink 建立邏輯）
3. 既有程式碼已證明 systemctl fallback 模式穩定且易於除錯
4. 若要在 D-Bus 模式下做 enable，需要額外處理 `daemon-reload`

---

## 3. 權衡評估

| 維度 | 🟢 方案 A：JSON API 延伸 | 🟡 方案 B：HTMX 延伸 | 🔵 方案 C：D-Bus 直接操作 |
|------|:---:|:---:|:---:|
| 🎯 需求符合度 | ⭐⭐⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐⭐ |
| ⚡ 開發速度 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ |
| 🔧 維護成本 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ |
| 📈 擴充性 | ⭐⭐⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐⭐ |
| 👥 一致性 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ |
| 🔒 穩定性 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| 💰 改動成本 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐ |

---

## 4. 決策理由

### 為什麼選擇方案 A

1. **一致性**：既有 start/stop/restart 皆使用 JSON API + systemctl 指令模式，enable/disable 應遵循相同模式，降低維護者認知負擔
2. **互動流程文件已指定 JSON API**：`POST /api/v1/services/{name}/enable` / `disable`，設計文件與實作方向一致
3. **最小改動**：Service struct 已含 `UnitFileState` 和 `FragmentPath`、前端 ConfirmModal 和 ToastContainer 皆已存在、僅需新增 2 個端點 + Toggle 元件

### 為什麼放棄其他方案

- **方案 B (HTMX)**：HTMX 已是 legacy 模式，無法實現 Toggle loading 狀態和 ConfirmModal，與互動流程設計衝突
- **方案 C (D-Bus)**：增加不必要的複雜度，且與既有 start/stop/restart 的 systemctl 模式不一致

---

## 5. 行動計畫

### 5.1 技術棧（沿用既有）

| 層級 | 技術 | 版本 | 備註 |
|------|------|------|------|
| 後端 | Go | 1.24 | chi router, godbus/dbus |
| 前端 | Vue 3 | 3.5 | Composition API, TypeScript |
| 狀態管理 | Pinia | 4.0 | 既有 store |
| HTTP 客戶端 | Axios | 1.19 | 既有 client |
| 測試 (單元) | Vitest | 4.1 | 前端單元測試 |
| 測試 (e2e) | Playwright | 1.62 | 前端 e2e |
| 測試 (後端) | Go testing | std | 原生測試 |

### 5.2 架構概覽

```
┌─────────────────────────────────────────────────┐
│                  Vue 3 SPA                        │
│  ┌──────────┐  ┌──────────┐  ┌───────────────┐  │
│  │Dashboard │  │ServiceRow│  │ConfirmModal   │  │
│  │View      │──│  .vue    │──│(disable 確認) │  │
│  │(load/svc)│  │(Toggle)  │  └───────────────┘  │
│  └────┬─────┘  └────┬─────┘                     │
│       │             │                            │
│  ┌────▼─────────────▼─────┐  ┌───────────────┐  │
│  │   client.ts (Axios)    │  │ ToastContainer│  │
│  │ enableService(name)    │  │ (成功/失敗通知)│  │
│  │ disableService(name)   │  └───────────────┘  │
│  └────────┬───────────────┘                     │
└───────────┼─────────────────────────────────────┘
            │ POST /api/v1/services/{name}/enable
            │ POST /api/v1/services/{name}/disable
┌───────────▼─────────────────────────────────────┐
│              Go Backend (chi router)              │
│  ┌──────────────────┐  ┌──────────────────────┐  │
│  │ json_handler.go   │  │   systemd.go          │  │
│  │ HandleEnableJSON  │──│   EnableService()     │  │
│  │ HandleDisableJSON │──│   DisableService()    │  │
│  │ HandleServicesJSON│  │   (systemctl exec)    │  │
│  └──────────────────┘  └──────────────────────┘  │
└──────────────────────────────────────────────────┘
            │ systemctl enable/disable
┌───────────▼─────────────────────────────────────┐
│              systemd (Linux)                      │
│  建立/移除 /etc/systemd/system/multi-user.target │
│  下的 symlink                                     │
└──────────────────────────────────────────────────┘
```

### 5.3 任務拆分

| 優先級 | 任務 | 預估工時 | 依賴 | 檔案 |
|--------|------|---------|------|------|
| P0 | `systemd.go` 新增 `EnableService()` / `DisableService()` | 0.5h | - | `src/internal/systemd/systemd.go` |
| P0 | `ServiceManager` interface 補上兩個方法簽章 | 0.1h | #1 | 同上 |
| P0 | `json_handler.go` 新增 `HandleEnableJSON` / `HandleDisableJSON` | 0.5h | #1 | `src/internal/handler/json_handler.go` |
| P0 | `serviceJSON` struct 補上 `unitFileState` / `fragmentPath` | 0.2h | - | 同上 |
| P0 | `main.go` 註冊兩個新 route | 0.1h | #3 | `src/main.go` |
| P0 | Go 單元測試：`systemd_test.go` + `handler_test.go` | 0.5h | #1, #3 | `src/internal/systemd/systemd_test.go` 等 |
| P1 | `service.ts` type 補上 `unitFileState` / `fragmentPath` | 0.1h | - | `frontend/src/types/service.ts` |
| P1 | `client.ts` 新增 `enableService()` / `disableService()` | 0.2h | #7 | `frontend/src/api/client.ts` |
| P1 | `ServiceRow.vue` 新增 Auto-start 欄位（Toggle / 🔒 / 不適用） | 2h | #7, #8 | `frontend/src/components/ServiceRow.vue` |
| P1 | `DashboardView.vue` 新增 `handleToggle()` + ConfirmModal 串接 | 1h | #8, #9 | `frontend/src/views/DashboardView.vue` |
| P1 | 前端單元測試：`ServiceRow.spec.ts` + `DashboardView` 更新 | 1h | #9, #10 | `frontend/src/__tests__/` |
| P2 | Playwright e2e 測試：`004-enable-disable-service.spec.ts` | 1h | #9, #10 | `frontend/e2e/` |
| P2 | 編譯 binary + 真實環境驗收測試 | 0.5h | 全部 | - |

### 5.4 環境建置

無需新增環境變數或依賴。既有 `SESSION_KEY`、`ADMIN_USER`、`ADMIN_PASS` 即滿足需求。

### 5.5 有待驗證的項目 (Spike)

- `systemctl enable` 在非 root 使用者下的行為：當前 start/stop/restart 已有相同權限需求，若 LMS 以 root 執行則無問題；若非 root，需確認 sudoers 設定
- `systemctl disable` 對 `enabled-runtime` 狀態的服務是否正確移除 runtime symlink

---

## 6. 風險登錄

| 風險 | 可能性 | 影響 | 緩解措施 |
|------|--------|------|---------|
| 權限不足導致 enable/disable 失敗 | 中 | 低 | 回傳明確錯誤訊息，前端 Toast 顯示原因；安裝腳本已提示需 root |
| UnitFileState 非同步更新 | 低 | 低 | 操作成功後重整服務列表，以 systemd 回報為準 |
| Toggle UI 在既有 ServiceRow 佈局中過擠 | 中 | 中 | Auto-start 為獨立欄位，與 Actions 明確區分；RWD 卡片佈局已考量 |
| systemctl enable/disable 逾時 | 低 | 低 | 設定 15 秒 timeout（與 start/stop 的 30 秒不同，因此操作較輕量） |

---

## 7. 與既有測試文件整合

| 文件 | 關聯 |
|------|------|
| `docs/bdds/004-enable-disable-service.feature` | BDD 場景（19 個 Scenario） |
| `docs/interaction-flows/004-enable-disable-service.md` | 互動流程設計 |
| `docs/development/002-expansion-roadmap.md` | Phase 1 項目 #1 |
| `frontend/e2e/002-service-management.spec.ts` | 既有的服務管理 e2e，新增 enable/disable 測試 |

---

## 📝 決策後續

- 本文件存至 `docs/tech-decision-enable-disable-service-2025-08-08.md`，應納入版本控制
- 開發完成後進行一次真實環境驗收（依 BDD checklist 逐項確認）
- 若後續加入 WebSocket 即時推送（Roadmap Phase 2），Toggle 狀態可改為被動更新

---

*決策日期：2025-08-08*
