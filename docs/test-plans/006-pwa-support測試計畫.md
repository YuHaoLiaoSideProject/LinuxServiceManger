# PWA 支援測試計畫

> **對應技術決策**：[tech-decision-006-pwa-support-2025-08-09.md](../tech-decisions/tech-decision-006-pwa-support-2025-08-09.md)
> **對應 BDD**：[006-pwa-support.feature](../bdds/006-pwa-support.feature)
> **測試日期**：2025-08-09
> **測試狀態**：待執行

---

## 1. 測試範圍與策略

### 測試層級

| 層級 | 工具 | 範圍 |
|------|------|------|
| **單元測試** | Vitest | vite.config PWA 設定驗證、manifest 結構驗證 |
| **E2E 測試** | Playwright | PWA 安裝流程、離線行為、跨瀏覽器 |
| **手動測試** | DevTools + 實機 | 真實 PWA 安裝、iOS Safari、Service Worker 行為 |

### 測試環境

| 環境 | 用途 |
|------|------|
| localhost (Vite dev) | 開發階段 SW 註冊驗證 |
| localhost + `make static` | 模擬生產環境（Go embedded） |
| HTTPS Staging (Nginx 反代) | 完整 PWA 安裝測試 |
| Chrome DevTools Network Offline | 離線行為測試 |
| 實機 Android Chrome | 真實手機 PWA 安裝與啟動 |
| 實機 iOS Safari | iOS 手動加入主畫面 |

---

## 2. 測試案例

### 2.1 Service Worker 生命週期

| ID | 測試案例 | BDD 對應 | 類型 | 優先級 |
|----|---------|---------|------|--------|
| SW-01 | 首次造訪時自動註冊 Service Worker | 首次造訪時自動註冊 Service Worker 並預快取資源 | E2E | P0 |
| SW-02 | SW 狀態從 installing → installed → activated | 同上 | E2E | P0 |
| SW-03 | SW 預快取關鍵資源（index.html、JS/CSS bundles、favicon） | 同上 | E2E | P0 |
| SW-04 | 管理員註冊過程中無感知，不影響正常使用 | 同上 | E2E | P0 |
| SW-05 | 瀏覽器不支援 PWA 時不註冊 SW | 瀏覽器不支援 PWA 時不觸發任何 PWA 功能 | E2E | P0 |
| SW-06 | 未使用 HTTPS 時 SW 無法註冊（localhost 除外） | 未使用 HTTPS 時 Service Worker 無法註冊 | E2E | P0 |
| SW-07 | SW 註冊失敗時網站仍正常運作 | Service Worker 註冊失敗時網站仍正常運作 | E2E | P1 |
| SW-08 | SW 更新衝突時顯示更新提示橫幅 | Service Worker 更新衝突時顯示更新提示 | E2E | P0 |

### 2.2 PWA 安裝流程

| ID | 測試案例 | BDD 對應 | 類型 | 優先級 |
|----|---------|---------|------|--------|
| INST-01 | Chrome 桌面網址列顯示安裝圖示 | 瀏覽器顯示 PWA 安裝提示 — Chrome 桌面 | 手動 | P0 |
| INST-02 | Chrome Android 底部彈出安裝提示橫幅 | 瀏覽器顯示 PWA 安裝提示 — Chrome Android | 手動 | P0 |
| INST-03 | Edge 桌面網址列顯示安裝圖示 | 瀏覽器顯示 PWA 安裝提示 — Edge 桌面 | 手動 | P0 |
| INST-04 | Firefox 桌面網址列顯示安裝圖示 | 瀏覽器顯示 PWA 安裝提示 — Firefox 桌面 | 手動 | P0 |
| INST-05 | 接受安裝後完成 PWA 安裝（桌面捷徑 / 主畫面圖示） | 管理員接受安裝提示並完成 PWA 安裝 | E2E | P0 |
| INST-06 | 忽略安裝提示後繼續使用瀏覽器版 | 管理員忽略安裝提示後繼續使用瀏覽器版 | E2E | P1 |
| INST-07 | Safari iOS 手動加入主畫面 | Safari iOS 手動加入主畫面 | 手動 | P1 |

### 2.3 PWA 啟動與全螢幕模式

| ID | 測試案例 | BDD 對應 | 類型 | 優先級 |
|----|---------|---------|------|--------|
| LAUNCH-01 | 從主畫面啟動顯示 splash screen | PWA 啟動時顯示 Splash screen | E2E | P1 |
| LAUNCH-02 | PWA 以全螢幕 standalone 模式顯示 | 從主畫面啟動 PWA 以全螢幕獨立視窗執行 | E2E | P0 |
| LAUNCH-03 | 無瀏覽器工具列、網址列 | 同上 | E2E | P0 |
| LAUNCH-04 | 從快取優先載入，背景檢查更新 | 同上 | E2E | P1 |

### 2.4 PWA 內功能操作

| ID | 測試案例 | BDD 對應 | 類型 | 優先級 |
|----|---------|---------|------|--------|
| FUNC-01 | 登入系統 | PWA 獨立視窗內功能操作正常 — 登入系統 | E2E | P0 |
| FUNC-02 | 檢視 Dashboard | PWA 獨立視窗內功能操作正常 — 檢視 Dashboard | E2E | P0 |
| FUNC-03 | 啟動服務 | PWA 獨立視窗內功能操作正常 — 啟動服務 | E2E | P0 |
| FUNC-04 | 停止服務 | PWA 獨立視窗內功能操作正常 — 停止服務 | E2E | P0 |
| FUNC-05 | 重啟服務 | PWA 獨立視窗內功能操作正常 — 重啟服務 | E2E | P0 |
| FUNC-06 | 切換開機自動啟動 | PWA 獨立視窗內功能操作正常 — 切換開機自動啟動 | E2E | P0 |
| FUNC-07 | 檢視 Journalctl 日誌 | PWA 獨立視窗內功能操作正常 — 檢視 Journalctl 日誌 | E2E | P0 |
| FUNC-08 | 切換深色模式 | PWA 獨立視窗內功能操作正常 — 切換深色模式 | E2E | P0 |
| FUNC-09 | 切換語言 | PWA 獨立視窗內功能操作正常 — 切換語言 | E2E | P0 |

### 2.5 離線行為

| ID | 測試案例 | BDD 對應 | 類型 | 優先級 |
|----|---------|---------|------|--------|
| OFF-01 | 離線時顯示快取頁面框架 + 離線提示橫幅 | 離線存取時顯示快取頁面框架與離線提示 | E2E | P0 |
| OFF-02 | API 請求失敗時不顯示錯誤 toast | 同上 | E2E | P0 |
| OFF-03 | 離線且無快取時顯示離線頁面 | 離線且無快取時顯示離線頁面 | E2E | P0 |
| OFF-04 | 不顯示白畫面 | 同上 | E2E | P0 |
| OFF-05 | App 安裝後伺服器停止時顯示連線錯誤 | App 安裝後伺服器停止時顯示連線錯誤 | E2E | P1 |

### 2.6 Manifest 與資源

| ID | 測試案例 | BDD 對應 | 類型 | 優先級 |
|----|---------|---------|------|--------|
| MAN-01 | manifest.json 含 name 欄位 | manifest.json 包含必要欄位 — name | 單元 | P2 |
| MAN-02 | manifest.json 含 short_name 欄位 | manifest.json 包含必要欄位 — short_name | 單元 | P2 |
| MAN-03 | manifest.json 含 start_url 欄位 | manifest.json 包含必要欄位 — start_url | 單元 | P2 |
| MAN-04 | manifest.json display 值為 standalone | manifest.json 包含必要欄位 — display | 單元 | P2 |
| MAN-05 | manifest.json 含 icons 欄位 | manifest.json 包含必要欄位 — icons | 單元 | P2 |
| MAN-06 | manifest.json 含 theme_color 欄位 | manifest.json 包含必要欄位 — theme_color | 單元 | P2 |
| MAN-07 | manifest.json 含 background_color 欄位 | manifest.json 包含必要欄位 — background_color | 單元 | P2 |
| MAN-08 | icons 含 192×192 PNG | App 圖示須包含 192×192 與 512×512 兩種尺寸 | 單元 | P1 |
| MAN-09 | icons 含 512×512 PNG | 同上 | 單元 | P1 |
| MAN-10 | apple-touch-icon meta 標籤存在 | iOS Safari PWA 限制 | 單元 | P1 |

### 2.7 回歸測試

| ID | 測試案例 | BDD 對應 | 類型 | 優先級 |
|----|---------|---------|------|--------|
| REG-01 | 不支援 PWA 瀏覽器：全部功能正常，無安裝提示 | PWA 為漸進增強不影響既有功能 | E2E | P0 |
| REG-02 | HTTP 環境：全部功能正常，SW 無法註冊 | HTTPS 為 PWA 啟用的必要條件 | E2E | P0 |
| REG-03 | 未安裝 PWA：瀏覽器版全部功能正常 | PWA 為漸進增強不影響既有功能 | E2E | P0 |
| REG-04 | HTTPS 反向代理環境：SW 註冊成功 | HTTPS 為 PWA 啟用的必要條件 — HTTPS 反向代理 | E2E | P0 |

### 2.8 邊界情況

| ID | 測試案例 | BDD 對應 | 類型 | 優先級 |
|----|---------|---------|------|--------|
| EDGE-01 | 快取儲存空間滿時正常使用不受影響 | 快取儲存空間滿時正常使用不受影響 | E2E | P2 |
| EDGE-02 | PWA 與瀏覽器版共用 localStorage/sessionStorage | PWA 安裝後 localStorage / sessionStorage 獨立 | E2E | P2 |
| EDGE-03 | Splash screen 約 0.5 秒顯示 | PWA 啟動時顯示 Splash screen | 手動 | P1 |
| EDGE-04 | stale-while-revalidate 策略正確運作 | Service Worker 使用 stale-while-revalidate 快取策略 | E2E | P1 |

---

## 3. 測試環境準備

### 3.1 前置步驟

```bash
# 1. 建構前端與後端
cd frontend && npm install && npm run build
cd .. && make static

# 2. 啟動（模擬生產環境）
./linux-service-manager

# 3. 若需要 HTTPS，使用 Nginx 反向代理或 Caddy
# 或使用 localhost 開發（PWA 在 localhost 可註冊 SW）
```

### 3.2 Chrome DevTools — PWA 測試工具

- **Application → Service Workers**：查看 SW 狀態、手動觸發更新、unregister
- **Application → Manifest**：驗證 manifest.json 結構
- **Application → Cache Storage**：查看快取內容
- **Network → Offline**：模擬離線狀態
- **Lighthouse → PWA audit**：自動化 PWA 合規檢查

### 3.3 Playwright E2E 測試設定

```typescript
// frontend/src/__tests__/pwa-install.spec.ts
import { test, expect } from '@playwright/test';

test.describe('PWA Manifest', () => {
  test('manifest.json is served correctly', async ({ page }) => {
    const response = await page.goto('/manifest.json');
    expect(response?.status()).toBe(200);
    const json = await response?.json();
    expect(json.name).toBe('Linux Service Manager');
    expect(json.display).toBe('standalone');
    expect(json.icons.length).toBeGreaterThanOrEqual(2);
  });
});

test.describe('Service Worker', () => {
  test('sw.js is served with correct MIME type', async ({ page }) => {
    const response = await page.goto('/sw.js');
    expect(response?.status()).toBe(200);
    expect(response?.headers()['content-type']).toContain('javascript');
  });
});
```

---

## 4. 執行時間估算

| 測試類型 | 案例數 | 預估時間 |
|---------|--------|---------|
| 單元測試（Vitest） | 8 | 30 min |
| E2E 測試（Playwright） | 20 | 2 hr |
| 手動測試（Chrome 桌面） | 8 | 30 min |
| 手動測試（Android Chrome） | 6 | 30 min |
| 手動測試（iOS Safari） | 4 | 30 min |
| **總計** | **46** | **~4 hr** |

---

## 5. 缺陷嚴重度定義

| 嚴重度 | 定義 | 範例 |
|--------|------|------|
| **Critical** | PWA 相關改動導致非 PWA 環境功能損壞 | PWA 改動導致 HTTP 環境下網站無法載入 |
| **High** | PWA 核心功能無法運作 | SW 無法註冊、manifest 404、安裝流程中斷 |
| **Medium** | PWA 輔助功能異常 | 離線快取未生效、更新提示未顯示 |
| **Low** | 不影響功能的視覺問題 | Splash screen 顯示時間過長、圖示邊緣裁切 |
