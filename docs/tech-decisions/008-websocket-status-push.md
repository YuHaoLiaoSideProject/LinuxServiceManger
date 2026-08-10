# 開發方案決策文件：WebSocket 即時狀態推送

## 📌 決策摘要

| 項目 | 內容 |
|------|------|
| **最終方案** | 後端 WebSocket + D-Bus 訊號監聽（fallback: systemctl polling）+ 前端 Pinia store 即時更新 |
| **決策日期** | 2025-08-10 |
| **對應 Roadmap** | Phase 2 — `docs/development/002-expansion-roadmap.md` 項目 #6 |
| **輸入文件** | `docs/bdds/008-websocket-status-push.feature`、`docs/interaction-flows/008-websocket-status-push.md` |
| **共識程度** | ✅ 確認通過 |

---

## 1. 需求回顧

### 1.1 核心業務價值

後端主動推送服務狀態變更到瀏覽器，取代目前的手動重整或 polling。當任何服務的 Active / Sub / UnitFileState 改變時，前端即時更新服務列表，讓管理員看到「活」的儀表板。服務 crash 或 recovery 時即時反映，大幅降低 MTTR。

### 1.2 功能邊界

| 項目 | 範圍 |
|------|------|
| **Must Have (P0)** | WebSocket 連線管理（自動建立/斷線重連）、D-Bus PropertiesChanged 監聽、status_change 推送、自身操作後單列更新不重整、手動重整保留、D-Bus 不可用時自動降級 polling |
| **Should Have (P1)** | 服務新增/移除通知（service_added/removed）、heartbeat 機制、多分頁支援、狀態變更 highlight 動畫、連線狀態指示器、重連後完整快照同步、exponential backoff 重連 |
| **Nice to Have (P2)** | 瀏覽器不支援 WebSocket 時前端 polling 降級、大量服務 debounce 合併 |

### 1.3 既有基礎

- 後端已有 REST API `/api/v1/services` 完整服務列表
- 前端已有 Pinia store (`useServiceStore`) 管理服務狀態
- Dashboard 已有手動重整按鈕與 loading 機制
- 後端已整合 systemctl 指令執行

---

## 2. 關鍵技術決策

### 決策 1：狀態變更偵測機制（後端）

| 方案 | 描述 | 優點 | 缺點 |
|------|------|------|------|
| **A. D-Bus + Polling fallback（選定）** | 優先使用 D-Bus PropertiesChanged 訊號，不可用時自動降級為 systemctl polling | 正常環境零延遲、容錯能力強、容器/非 systemd 環境仍可用 | 實作較複雜，需維護兩套偵測路徑 |
| B. 純 D-Bus | 只依賴 D-Bus 訊號，無 fallback | 實作簡單 | 容器/Docker 環境無法使用，相容性差 |
| C. 純 Polling | 僅使用 systemctl 定時輪詢 | 最簡單、無環境相依 | 永遠有延遲、CPU 開銷固定、無法滿足「即時」需求 |
| D. inotify 監控 unit files | 監控 `/etc/systemd/system/` 目錄變更 | 可偵測 unit file 異動 | 無法偵測服務狀態變化（crash/stop），僅限檔案層級 |

> **決策**：方案 A。D-Bus 是 Linux systemd 的原生 IPC 機制，能即時收到 PropertiesChanged 訊號。加入 polling fallback 確保在容器或非標準環境下仍可運作，符合 BDD 中「D-Bus 不可用時自動降級」的情境。

### 決策 2：WebSocket 實作框架（後端）

| 方案 | 描述 | 優點 | 缺點 |
|------|------|------|------|
| **A. gorilla/websocket（選定）** | Go 生態最成熟的 WebSocket library | 社群活躍、文件完整、效能優異、與現有 Go 後端整合無縫 | 需要手動管理連線池 |
| B. nhooyr.io/websocket | 較新的 Go WebSocket library | 更現代的 API、context 支援好 | 社群較小、專案成熟度不如 gorilla |
| C. Socket.IO（前端）+ Go server | 使用 Socket.IO 協定 | 內建重連、room 管理 | 需引入 Socket.IO Go 實作（非官方）、協定複雜度高 |

> **決策**：方案 A。`gorilla/websocket` 是 Go WebSocket 的實質標準，專案已使用 gorilla/mux router，技術棧一致。

### 決策 3：前端狀態更新策略

| 方案 | 描述 | 優點 | 缺點 |
|------|------|------|------|
| **A. Pinia store 直接 mutate（選定）** | WebSocket 收到訊息後直接更新 Pinia store 中對應服務物件 | 最簡單、Vue 響應式自動觸發重新渲染、不發 API 請求 | 需確保 store 結構相容 |
| B. 觸發 loadServices() 重新 fetch | 收到推送後自動呼叫 API 重整 | 保證資料一致性 | 違反 BDD「不重新 fetch 整個列表」，增加不必要的 API 流量 |
| C. EventBus + 元件層級更新 | 使用 mitt 或自訂 EventBus 傳遞更新事件 | 解耦 | 過度設計，Pinia store 已足夠 |

> **決策**：方案 A。Pinia store 是 Vue 3 的標準狀態管理，直接 mutate 搭配 Vue 響應式系統是最簡潔有效的方式。BDD 明確要求「不重新 fetch 整個列表」，方案 A 完美滿足。

### 決策 4：重連策略

| 方案 | 描述 | 優點 | 缺點 |
|------|------|------|------|
| **A. Exponential backoff（選定）** | 1s → 2s → 4s → 8s → ... → max 30s，重連成功後推送完整快照 | 標準作法、避免 server thundering herd、BDD 定義 | 需管理 timer lifecycle |
| B. 固定間隔重試 | 每 3 秒重試一次 | 簡單 | 浪費資源、長時間斷線後大量客戶端同時重連 |
| C. 僅依賴 heartbeat 偵測 | 不主動重連，等 heartbeat 觸發 | 實作最簡 | 使用者需手動重整，體驗差 |

> **決策**：方案 A。Exponential backoff 是業界標準，BDD 明確定義重試間隔。重連後推送完整快照確保狀態一致。

### 決策 5：Heartbeat 機制

| 方案 | 描述 | 優點 | 缺點 |
|------|------|------|------|
| **A. 後端主動 ping（選定）** | 後端每 30 秒發送 heartbeat 訊息，前端 45 秒未收到任何訊息判定斷線 | 雙向健康檢查、符合 BDD 定義 | 略增頻寬（每 30 秒 ~50 bytes） |
| B. WebSocket Ping/Pong 協定層 | 使用 WebSocket 內建 ping/pong frame | 協定層級、更輕量 | 前端 JavaScript WebSocket API 無法直接控制 ping/pong，需後端發起 |
| C. 前端定時發送 ping | 前端每 30 秒發 ping | 可偵測單向斷線 | 增加前端複雜度 |

> **決策**：方案 A（實際上與方案 B 並行）。後端發送應用層 heartbeat 訊息，同時可利用 gorilla/websocket 的 ping/pong 機制。BDD 定義的 30s/45s 閾值適用於應用層。

### 決策 6：連線狀態指示器位置

| 方案 | 描述 |
|------|------|
| **A. Header 區域（選定）** | Dashboard Header 右側顯示連線指示器 🔗 |

> **決策**：方案 A。Header 是全域可見區域，管理員任何時候都能看到連線狀態。與既有 UI 佈局一致。

---

## 3. 架構概覽

```
┌─────────────────────────────────────────────────────────┐
│  Browser (Dashboard)                                     │
│  ┌───────────────────────────────────────────────────┐  │
│  │  useWebSocket composable                           │  │
│  │  ┌───────────┐  ┌────────────┐  ┌──────────────┐ │  │
│  │  │ connect() │  │ reconnect()│  │ disconnect() │ │  │
│  │  └───────────┘  └────────────┘  └──────────────┘ │  │
│  │  onMessage → Pinia store.updateService(msg)       │  │
│  └───────────────────────────────────────────────────┘  │
│                          │ WebSocket (wss://)             │
└──────────────────────────┼──────────────────────────────┘
                           │
┌──────────────────────────┼──────────────────────────────┐
│  Go Backend              │                               │
│  ┌───────────────────────┴────────────────────────────┐  │
│  │  WebSocket Hub                                      │  │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────────────┐ │  │
│  │  │register  │  │unregister│  │ broadcast(msg)   │ │  │
│  │  │client    │  │client    │  │ → all clients     │ │  │
│  │  └──────────┘  └──────────┘  └──────────────────┘ │  │
│  └────────────────────────────────────────────────────┘  │
│                           ▲                               │
│  ┌────────────────────────┴────────────────────────────┐ │
│  │  Status Monitor                                      │ │
│  │  ┌──────────────┐  ┌────────────────────────────┐  │ │
│  │  │ D-Bus Listener│  │ Polling Fallback           │  │ │
│  │  │ (Properties  │  │ (systemctl every 5s,        │  │ │
│  │  │  Changed)    │  │  compare snapshots)         │  │ │
│  │  └──────┬───────┘  └────────────┬───────────────┘  │ │
│  │         │                       │                   │ │
│  │         └───────────┬───────────┘                   │ │
│  │                     ▼                               │ │
│  │              Hub.broadcast(status_change)           │ │
│  └─────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────┘

Data Flow:
  1. D-Bus signal or polling detects change
  2. Status Monitor parses change → creates message
  3. Hub.broadcast() sends to all connected WebSocket clients
  4. Frontend useWebSocket receives message
  5. Pinia store updates service object
  6. Vue reactivity re-renders affected row only
```

### WebSocket 訊息格式

```json
// status_change
{
  "type": "status_change",
  "name": "nginx.service",
  "active": "inactive",
  "sub": "dead",
  "unitFileState": "enabled"
}

// service_added
{
  "type": "service_added",
  "name": "myapp.service",
  "active": "active",
  "sub": "running",
  "unitFileState": "enabled"
}

// service_removed
{
  "type": "service_removed",
  "name": "oldapp.service"
}

// heartbeat
{
  "type": "heartbeat",
  "timestamp": "2025-08-10T12:00:00Z"
}

// snapshot (sent on reconnect)
{
  "type": "snapshot",
  "services": [
    { "name": "nginx.service", "active": "active", "sub": "running", "unitFileState": "enabled" },
    ...
  ]
}
```

---

## 4. 風險評估

| 風險 | 可能性 | 影響 | 緩解措施 |
|------|--------|------|---------|
| D-Bus 訊號遺漏導致狀態不同步 | 低 | 中 | 重連時推送完整快照；heartbeat 機制確保連線健康；管理員可手動重整 |
| WebSocket 連線數過多耗盡伺服器資源 | 中 | 高 | 限制同一 session 最多 5 個並發連線；heartbeat 偵測僵屍連線並清理 |
| gorilla/websocket 並發寫入 race condition | 中 | 高 | Hub 使用 channel-based 廣播，每個 client 有獨立 write goroutine + send channel |
| 大量服務變更時前端渲染效能 | 低 | 中 | 100ms debounce 合併更新；Vue computed 自動緩存；僅重渲染變更列 |
| 瀏覽器不支援 WebSocket（舊瀏覽器） | 低 | 低 | 前端自動降級為 polling（setInterval 10s 呼叫 API），提示使用者 |
| 反向代理（nginx）未正確配置 WebSocket | 中 | 高 | 部署文件明確標註需設定 `proxy_set_header Upgrade $http_upgrade` 與 `Connection "upgrade"` |

---

## 5. 相依與整合

| 項目 | 影響 |
|------|------|
| 現有 REST API `/api/v1/services` | 不受影響，仍用於初始載入和手動重整 |
| Pinia useServiceStore | 新增 `updateService(msg)`、`addService(msg)`、`removeService(name)` actions |
| ServiceTable.vue | 無需修改（Vue 響應式自動更新） |
| 日誌檢視器 WebSocket | 獨立連線，互不影響 |
| 反向代理 (nginx) | 需新增 WebSocket upgrade 設定 |
| Deploy 流程 | 需確保反向代理正確配置 WebSocket |

---

## 6. 不需變更的部分

- REST API 端點（start/stop/restart/enable/disable）：保持不變，WebSocket 僅推送結果
- 權限模型：WebSocket 連線使用同一 session 驗證
- Tab 切換邏輯：WebSocket 更新作用於全域 store，不影響 Tab 過濾
- 搜尋功能：WebSocket 更新不影響搜尋/過濾狀態

---

*最後更新：2025-08-10*
