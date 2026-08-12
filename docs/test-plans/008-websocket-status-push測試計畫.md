# WebSocket 即時狀態推送測試計畫

> **對應 BDD**：[008-websocket-status-push.feature](../bdds/008-websocket-status-push.feature)
> **對應技術決策**：[008-websocket-status-push.md](../tech-decisions/008-websocket-status-push.md)
> **對應開發規格**：[008-websocket-status-push.md](../development/008-websocket-status-push.md)
> **測試日期**：待定
> **測試狀態**：待執行

---

## 1. 測試範圍與策略

### 測試層級

| 層級 | 工具 | 範圍 |
|------|------|------|
| **單元測試（後端）** | Go `testing` | Hub 連線管理與廣播、PollingMonitor 狀態比對邏輯、DBusMonitor 訊號解析 |
| **單元測試（前端）** | Vitest | `useWebSocket` composable：連線生命週期、重連邏輯、訊息路由、Pinia store actions |
| **整合測試** | Go `testing` + mock WebSocket client | WebSocket upgrade、訊息收發、snapshot 推送、heartbeat |
| **E2E 測試** | Playwright | 完整流程：連線建立、狀態變更推送、重連機制、離線 fallback |

### 測試環境

| 環境 | 用途 |
|------|------|
| localhost (Go + Vite dev) | 開發階段快速迭代測試 |
| Linux VM (含 systemd) | D-Bus 模式真機驗證 |
| Docker 容器 (不含 systemd) | Polling fallback 驗證 |
| Chrome / Firefox | 跨瀏覽器 WebSocket 相容性 |
| 網路限速/斷線模擬 | 重連機制驗證 |

### 測試工具

| 工具 | 用途 |
|------|------|
| `websocat` | CLI WebSocket 客戶端，手動測試訊息格式 |
| Chrome DevTools Network tab | 觀察 WebSocket frame、連線升級、heartbeat 時序 |
| `systemctl` 直接操作 | 觸發真實狀態變更 |
| Playwright `route.webSocket()` | E2E WebSocket mock |

---

## 2. 測試案例

### 2.1 WebSocket 連線生命週期（P0）

| ID | 測試案例 | BDD Scenario | 類型 | 優先級 |
|----|---------|-------------|------|--------|
| WS-01 | 登入 Dashboard 後自動發起 WebSocket 連線 | 登入 Dashboard 後自動建立 WebSocket 連線 | E2E | P0 |
| WS-02 | 連線成功後 Header 顯示「🔗 已連線」綠色指示器 | 同上 | E2E | P0 |
| WS-03 | 連線建立後後端推送完整 snapshot | （技術驗證） | 整合 | P0 |
| WS-04 | 登出後 WebSocket 正確關閉（code 1000） | 登出或關閉分頁時正確關閉 WebSocket 連線 | E2E | P0 |
| WS-05 | 後端清理已斷線客戶端資源 | 同上 | 單元 | P0 |
| WS-06 | 開新分頁建立獨立連線（不同於第一個分頁的連線） | （技術驗證） | E2E | P1 |

### 2.2 服務狀態自動更新 — 外部變更（P0）

| ID | 測試案例 | BDD Scenario | 類型 | 優先級 |
|----|---------|-------------|------|--------|
| SC-01 | SSH `systemctl stop nginx` → Dashboard 即時更新為 inactive/dead | 外部 systemctl 停止服務時 Dashboard 即時更新 | E2E | P0 |
| SC-02 | 狀態 dot 顏色從綠色變為灰色 | 同上（驗證細節） | E2E | P0 |
| SC-03 | 該列閃爍 0.5s 灰色 highlight 動畫 | 同上（驗證細節） | E2E | P0 |
| SC-04 | 服務 crash 變 failed → Dashboard 即時顯示 failed + 紅色 dot | 服務 crash 時 Dashboard 即時顯示 failed 狀態 | E2E | P0 |
| SC-05 | 服務從 failed 恢復為 running → 紅色 dot 變綠色 | 服務從 failed 恢復為 running 時即時反映 | E2E | P1 |
| SC-06 | SSH `systemctl start nginx` → Dashboard 即時更新為 active | （反向操作） | E2E | P0 |

### 2.3 服務狀態自動更新 — 自身操作（P0）

| ID | 測試案例 | BDD Scenario | 類型 | 優先級 |
|----|---------|-------------|------|--------|
| SO-01 | Dashboard Stop 操作後單列更新，不重新 fetch 整個列表 | Dashboard 內執行 Stop 後單列更新不重整整個列表 | E2E | P0 |
| SO-02 | Dashboard Start 操作後單列更新 | Dashboard 內執行 Start 後單列更新 | E2E | P0 |
| SO-03 | Dashboard Restart 操作後單列更新 | Dashboard 內執行 Restart 後單列更新 | E2E | P0 |
| SO-04 | enable/disable Toggle 後 UnitFileState 即時反映 | enable/disable 操作後 UnitFileState 即時更新 | E2E | P0 |
| SO-05 | 確認自身操作後 Network tab 無 GET /api/v1/services 請求 | （技術驗證：不重整整個列表） | E2E | P0 |

### 2.4 狀態變更訊息格式驗證（P0）

| ID | 測試案例 | BDD Scenario | 類型 | 優先級 |
|----|---------|-------------|------|--------|
| MF-01 | status_change 訊息類型為 JSON 且包含所有必要欄位 | （技術驗證） | 整合 | P0 |
| MF-02 | status_change 訊息大小約 150 bytes | 單一 status_change 訊息大小約 150 bytes | 單元 | P1 |
| MF-03 | heartbeat 訊息類型為 JSON 含 timestamp | （技術驗證） | 整合 | P1 |

### 2.5 服務新增 / 移除通知（P1）

| ID | 測試案例 | BDD Scenario | 類型 | 優先級 |
|----|---------|-------------|------|--------|
| AD-01 | 建立新 service unit + daemon-reload → 列表出現新列 | 系統新增 service unit 時 Dashboard 插入新列並通知 | E2E | P1 |
| AD-02 | 偵測到新服務時顯示 Toast 通知 | 同上（驗證細節） | E2E | P1 |
| AD-03 | 移除 service unit + daemon-reload → 列表移除該列 | 系統移除 service unit 時 Dashboard 移除該列並通知 | E2E | P1 |
| AD-04 | 移除服務時顯示 Toast 通知 | 同上（驗證細節） | E2E | P1 |

### 2.6 Heartbeat（P1）

| ID | 測試案例 | BDD Scenario | 類型 | 優先級 |
|----|---------|-------------|------|--------|
| HB-01 | 30 秒內無狀態變更時後端發送 heartbeat | 後端每 30 秒發送 heartbeat 維持連線 | 整合 | P1 |
| HB-02 | 前端收到 heartbeat 後更新「最後更新時間」 | 同上（驗證細節） | E2E | P1 |
| HB-03 | heartbeat 訊息不觸發服務列表重新渲染 | （技術驗證） | 單元 | P1 |

### 2.7 WebSocket 連線失敗與重連（P0）

| ID | 測試案例 | BDD Scenario | 類型 | 優先級 |
|----|---------|-------------|------|--------|
| RC-01 | 初始連線失敗後 3 秒自動重試 | 初始連線失敗時自動重試 | E2E | P0 |
| RC-02 | 連線失敗時指示器顯示「⟳ 重連中...」黃色 | 同上（驗證細節） | E2E | P0 |
| RC-03 | 異常中斷後觸發 onclose，自動啟動重連 | 連線異常中斷時自動重連 | E2E | P0 |
| RC-04 | Exponential backoff 重試間隔（1s, 2s, 4s, 8s, ... max 30s） | （技術驗證） | 單元 | P0 |
| RC-05 | 重連成功後推送完整 snapshot 同步狀態 | 重連成功後推送完整狀態快照 | 整合 | P0 |
| RC-06 | 重連成功後指示器恢復「🔗 已連線」+ Toast | 同上（驗證細節） | E2E | P0 |
| RC-07 | 超過 30 秒仍無法重連 → 指示器「⚠ 離線」紅色 | 重連失敗超過 30 秒顯示離線指示器 | E2E | P0 |
| RC-08 | 離線狀態下手動重整按鈕仍可正常使用 | 同上（驗證細節） | E2E | P0 |
| RC-09 | 筆電休眠喚醒後自動偵測斷線並重連 | 筆電休眠喚醒後自動重連 | E2E | P1 |

### 2.8 Heartbeat 超時（P1）

| ID | 測試案例 | BDD Scenario | 類型 | 優先級 |
|----|---------|-------------|------|--------|
| HT-01 | 超過 45 秒無任何訊息 → 前端判定斷線 | 超過 45 秒無任何訊息判定斷線 | 單元 | P1 |
| HT-02 | 超過 15 秒無訊息 → 顯示「⚠ 狀態可能過時」 | 超過 15 秒無訊息顯示狀態可能過時警告 | E2E | P1 |
| HT-03 | 手動重整可取得最新狀態 | 同上（驗證細節） | E2E | P1 |

### 2.9 D-Bus 不可用 — Polling Fallback（P0）

| ID | 測試案例 | BDD Scenario | 類型 | 優先級 |
|----|---------|-------------|------|--------|
| DB-01 | D-Bus 不可用時後端自動降級為 polling（每 5 秒） | D-Bus 不可用時自動降級為 polling fallback | 整合 | P0 |
| DB-02 | Polling 僅推送有變更的服務（不推送未變更項目） | Polling 模式下仍正確推送狀態變更 | 單元 | P1 |
| DB-03 | Polling 模式延遲不超過 5 秒 | Polling 模式下延遲不超過 5 秒 | 整合 | P1 |
| DB-04 | systemctl 執行失敗時僅記錄錯誤 log，不影響 WebSocket | Polling 無法執行 systemctl 時記錄錯誤 | 單元 | P2 |
| DB-05 | D-Bus 模式下狀態變更在 1 秒內推送 | D-Bus 模式下狀態變更零延遲推送 | 整合 | P0 |

### 2.10 瀏覽器相容性（P1）

| ID | 測試案例 | BDD Scenario | 類型 | 優先級 |
|----|---------|-------------|------|--------|
| BC-01 | 不支援 WebSocket 的瀏覽器自動降級為前端 polling（10s） | 瀏覽器不支援 WebSocket 時自動降級為前端 polling | 單元 | P1 |
| BC-02 | 顯示提示「您的瀏覽器不支援即時更新」 | 同上（驗證細節） | E2E | P1 |
| BC-03 | Chrome 最新版正常連線 | （跨瀏覽器） | E2E | P1 |
| BC-04 | Firefox 最新版正常連線 | （跨瀏覽器） | E2E | P1 |

### 2.11 多分頁支援（P1）

| ID | 測試案例 | BDD Scenario | 類型 | 優先級 |
|----|---------|-------------|------|--------|
| MT-01 | 兩個分頁各自建立獨立 WebSocket 連線 | 多分頁同時開啟時所有分頁皆收到更新 | E2E | P1 |
| MT-02 | 狀態變更時兩個分頁皆即時更新 | 同上 | E2E | P1 |
| MT-03 | 同一 session 超過 5 個連線時拒絕第 6 個 | 同一 session 最多 5 個並發 WebSocket 連線 | 整合 | P1 |

### 2.12 大量服務與效能（P1）

| ID | 測試案例 | BDD Scenario | 類型 | 優先級 |
|----|---------|-------------|------|--------|
| PF-01 | 200+ 服務同時變更時前端以 100ms debounce 合併 | 大量服務同時變更時以 debounce 合併更新 | 單元 | P1 |
| PF-02 | 更新期間 UI 無卡頓或 DOM 抖動 | 同上 | E2E | P1 |
| PF-03 | 快速連續發送 50 筆 status_change 訊息無遺漏 | （技術驗證） | 整合 | P1 |

### 2.13 搜尋或過濾中收到更新（P1）

| ID | 測試案例 | BDD Scenario | 類型 | 優先級 |
|----|---------|-------------|------|--------|
| FI-01 | 搜尋框過濾中收到 status_change，列表正確更新且過濾條件保留 | 搜尋中收到更新仍正確反映 | E2E | P1 |

### 2.14 手動重整保留（P0）

| ID | 測試案例 | BDD Scenario | 類型 | 優先級 |
|----|---------|-------------|------|--------|
| MR-01 | 已連線狀態下手動重整按鈕仍可正常使用 | 手動重整按鈕永遠可用且重新載入完整列表 | E2E | P0 |
| MR-02 | 離線狀態下手動重整按鈕仍可正常使用 | 同上 | E2E | P0 |
| MR-03 | 重整期間顯示 loading 動畫 | 同上（驗證細節） | E2E | P0 |
| MR-04 | 重整後列表完全更新 | 同上（驗證細節） | E2E | P0 |

### 2.15 REST API 與 WebSocket 關係（P0）

| ID | 測試案例 | BDD Scenario | 類型 | 優先級 |
|----|---------|-------------|------|--------|
| RA-01 | start/stop/restart 操作仍走 REST POST（非 WebSocket） | WebSocket 是增強功能不取代 REST API | E2E | P0 |
| RA-02 | WebSocket 離線時所有操作仍可透過 REST 完成 | WebSocket 離線時所有操作仍可透過 REST 完成 | E2E | P0 |
| RA-03 | 狀態推送與日誌 WebSocket 為獨立連線 | 狀態推送 WebSocket 與日誌檢視器 WebSocket 獨立 | E2E | P1 |

### 2.16 Highlight 動畫（P1）

| ID | 測試案例 | BDD Scenario | 類型 | 優先級 |
|----|---------|-------------|------|--------|
| HL-01 | 狀態從 running→failed：紅色 highlight 動畫 0.5s | 狀態變更時依 Active 狀態顯示對應顏色動畫 | E2E | P1 |
| HL-02 | 狀態從 inactive→active：綠色 highlight 動畫 0.5s | 狀態從 inactive 變為 active 時顯示綠色動畫 | E2E | P1 |
| HL-03 | SubState 變更但 Active 不變：無動畫，靜默更新 | 狀態僅 SubState 變更但 Active 不變時無動畫 | E2E | P1 |

### 2.17 Hub 並發安全（P0）

| ID | 測試案例 | BDD Scenario | 類型 | 優先級 |
|----|---------|-------------|------|--------|
| HB-T1 | 同時 register/unregister/broadcast 無 race condition | （技術驗證） | 單元 | P0 |
| HB-T2 | Client send buffer 滿時正確清理 | （技術驗證） | 單元 | P1 |
| HB-T3 | Heartbeat broadcast 與 status_change broadcast 並發無資料競爭 | （技術驗證） | 單元 | P1 |

---

## 3. 測試環境準備

### 3.1 D-Bus 模式測試

```bash
# 確保測試機有 systemd（Linux VM）
systemctl --version

# 監聽 D-Bus signal（手動驗證用）
dbus-monitor --system \
  "type='signal',sender='org.freedesktop.systemd1',interface='org.freedesktop.DBus.Properties',member='PropertiesChanged'"

# 觸發變更
systemctl stop nginx
systemctl start nginx
```

### 3.2 Polling 模式測試

```bash
# Docker 內執行（無 systemd bus）
docker run --rm -v $(pwd):/app -p 8080:8080 golang:1.22 \
  bash -c "cd /app && go run . "
# 確認後端 log 輸出：D-Bus not available — starting polling fallback
```

### 3.3 WebSocket 手動測試

```bash
# 使用 websocat 連線
websocat ws://localhost:8080/api/v1/ws

# 手動驗證訊息格式
# 期望收到：{"type":"snapshot","services":[...]}
# 然後每 30 秒：{"type":"heartbeat","timestamp":"..."}
```

### 3.4 網路中斷模擬

```bash
# Chrome DevTools → Network → 右鍵 WebSocket → "Block request domain"
# 或使用 iptables 模擬斷線：
sudo iptables -A OUTPUT -p tcp --dport 8080 -j DROP
sleep 10
sudo iptables -D OUTPUT -p tcp --dport 8080 -j DROP
```

---

## 4. Playwright E2E 測試框架

```typescript
// e2e/websocket-status-push.spec.ts
import { test, expect } from '@playwright/test'

test.describe('WebSocket 即時狀態推送', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/login')
    await page.fill('input[name="username"]', 'admin')
    await page.fill('input[name="password"]', process.env.ADMIN_PASS || 'admin')
    await page.click('button[type="submit"]')
    await page.waitForURL('/')
  })

  test('WS-01: 登入後自動建立 WebSocket 連線', async ({ page }) => {
    // 監聽 WebSocket
    const wsPromise = page.waitForEvent('websocket')
    await page.goto('/')
    const ws = await wsPromise
    expect(ws.url()).toContain('/api/v1/ws')
  })

  test('WS-02: Header 顯示已連線指示器', async ({ page }) => {
    await expect(page.locator('.indicator-connected')).toBeVisible()
    await expect(page.locator('.indicator-connected')).toContainText('已連線')
  })

  test('SC-01: 外部停止服務時即時更新', async ({ page, browser }) => {
    // 等待連線
    await expect(page.locator('.indicator-connected')).toBeVisible()

    // 透過 API 模擬外部停止（等同 systemctl stop）
    await page.evaluate(() => {
      // Simulate WebSocket status_change message
      const fakeMsg = JSON.stringify({
        type: 'status_change',
        name: 'nginx.service',
        active: 'inactive',
        sub: 'dead',
        unitFileState: 'enabled'
      })
      // Inject via postMessage for test
      window.postMessage({ type: 'mock-ws-message', data: fakeMsg }, '*')
    })

    // 驗證 nginx 列更新
    const nginxRow = page.locator('tr', { hasText: 'nginx.service' })
    await expect(nginxRow.locator('.status-dot')).toHaveClass(/inactive/)
  })

  test('RC-07: 離線指示器顯示', async ({ page }) => {
    // 模擬 WebSocket 斷線
    await page.evaluate(() => {
      window.postMessage({ type: 'mock-ws-close' }, '*')
    })

    // 等待 30s+ 重試失敗
    await page.waitForSelector('.indicator-offline', { timeout: 35000 })
    await expect(page.locator('.indicator-offline')).toContainText('離線')
  })

  test('MR-01: 手動重整按鈕仍可使用', async ({ page }) => {
    await page.click('button[title="重整"]')
    await expect(page.locator('.loading-indicator')).toBeVisible()
    await expect(page.locator('.loading-indicator')).not.toBeVisible({ timeout: 10000 })
  })

})
```

---

## 5. 效能基準

| 指標 | 目標 | 測量方式 |
|------|------|---------|
| D-Bus 模式端到端延遲 | < 1 秒 | `systemctl stop` → Chrome DevTools WS frame timestamp 差值 |
| Polling 模式端到端延遲 | < 5 秒 | 同上，polling 環境 |
| WebSocket 連線建立時間 | < 1 秒 | `new WebSocket()` → `onopen` 時間差 |
| 心跳訊息大小 | ~50 bytes | DevTools WS frame 大小 |
| status_change 訊息大小 | ~150 bytes | DevTools WS frame 大小 |
| 200 服務同時變更前端更新時間 | < 200ms | `performance.now()` 計時 |
| 重連後 snapshot 同步時間 | < 2 秒（100 服務） | `onclose` → `snapshot` 處理完成 |

---

## 6. 測試執行順序

| 階段 | 內容 | 依賴 |
|------|------|------|
| **Phase 1** | 後端單元測試：Hub、PollingMonitor、DBusMonitor | 開發步驟 #1-3 |
| **Phase 2** | 後端整合測試：WebSocket upgrade、訊息格式、heartbeat | 開發步驟 #4-5 |
| **Phase 3** | 前端單元測試：useWebSocket composable (mock WebSocket) | 開發步驟 #6 |
| **Phase 4** | 前端單元測試：Pinia store actions | 開發步驟 #7 |
| **Phase 5** | E2E 測試：連線生命週期、狀態更新、重連、離線 | 開發步驟 #5-9 |
| **Phase 6** | 真機測試：Linux VM (D-Bus) + Docker (polling fallback) | Phase 1-5 通過 |
| **Phase 7** | 效能測試：大量服務、並發連線、長時間穩定度 | Phase 6 通過 |

---

*最後更新：2025-08-10*
