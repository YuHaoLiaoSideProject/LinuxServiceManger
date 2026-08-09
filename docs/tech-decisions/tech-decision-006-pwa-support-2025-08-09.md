# 開發方案決策文件：PWA 支援

## 📌 決策摘要

| 項目 | 內容 |
|------|------|
| **最終方案** | vite-plugin-pwa (generateSW) + Workbox + 自訂 runtimeCaching |
| **決策日期** | 2025-08-09 |
| **參與討論** | 單一開發者 |
| **共識程度** | ✅ 確認通過 |

---

## 1. 需求回顧

### 功能概述
為 Linux Service Manager 加入 Progressive Web App (PWA) 支援，讓管理員可將 Web 面板「安裝」到手機或桌面，以獨立應用程式形式執行（全螢幕、無瀏覽器工具列、離線可用）。

### 核心需求 (P0 Must)
- Service Worker 註冊與預快取關鍵資源（index.html、JS/CSS bundles、favicon）
- manifest.json（含 name / short_name / start_url / display / icons / theme_color / background_color）
- HTTPS 條件判斷（無 HTTPS 時 Service Worker 無法註冊，不影響正常功能）
- 各瀏覽器安裝提示與安裝流程
- 全螢幕 standalone 模式啟動
- PWA 內功能正常運作（登入、Dashboard、服務管理、日誌、深色模式、語言切換）
- 不支援 PWA 時漸進增強，不影響既有功能

### 次要需求 (P1 Should)
- 離線快取頁面框架 + 離線提示橫幅
- Service Worker 更新提示橫幅
- iOS Safari 手動加入主畫面（apple-touch-icon）
- stale-while-revalidate 快取策略
- App 圖示 192×192 + 512×512 PNG

### 已知限制
- PWA 強制要求 HTTPS（localhost 除外）：部署環境需反向代理終止 TLS
- Go 後端使用 `go:embed static` 嵌入前端，PWA 靜態資源（sw.js, manifest.json）需一併嵌入
- 單一開發者維護，方案需極低維護成本
- iOS Safari 行為特殊：無自動安裝提示、無背景同步、儲存空間上限較低
- 離線僅快取靜態資源，API 資料無法離線使用（合理限制）

### 現有技術棧
| 層級 | 技術 | 版本 | 備註 |
|------|------|------|------|
| 後端 | Go + chi/v5 | 1.x | 嵌入靜態檔案（go:embed） |
| 前端 | Vue 3 | 3.5+ | Composition API |
| 建構 | Vite | 8.2+ | @vitejs/plugin-vue |
| 狀態管理 | Pinia | 4.0+ | |
| 路由 | Vue Router | 4.6+ | |
| HTTP | Axios | 1.19+ | |
| 測試 | Vitest + Playwright | 4.1+ / 1.62+ | |
| 部署 | 單一二進位檔 | | Nginx 反向代理 TLS |

---

## 2. 候選方案

### 🟢 方案 A：vite-plugin-pwa generateSW（純自動）

**核心依賴**：`vite-plugin-pwa` generateSW 模式

**技術棧**：Vite 8 + vite-plugin-pwa + Workbox (內建)

**說明**：
- 插件自動產生 Service Worker（基於 Workbox generateSW）
- manifest.json 由插件設定自動產生
- 預設使用 precacheAndRoute 快取 Vite 產出的所有靜態資源
- 無 runtime caching 自訂，預設行為

**配置量**：~30 行 vite.config.ts

**適用情境**：最小可行 PWA，不需要自訂離線行為

---

### 🟡 方案 B：vite-plugin-pwa injectManifest（手寫 SW）

**核心依賴**：`vite-plugin-pwa` injectManifest 模式 + 手寫 Service Worker

**技術棧**：Vite 8 + vite-plugin-pwa + Workbox (手動 import)

**說明**：
- 手寫 `sw.ts`，使用 Workbox API（precacheAndRoute、registerRoute 等）
- Vite 插件負責注入 precache manifest 到自訂 SW
- 完全控制 Service Worker 生命週期、快取策略、更新流程

**配置量**：~30 行 vite.config.ts + ~50 行 sw.ts

**適用情境**：需要完全自訂 SW 邏輯，如自訂 install/activate 事件、訊息傳遞

---

### 🔵 方案 C：vite-plugin-pwa generateSW + 自訂 runtimeCaching（✅ 選擇）

**核心依賴**：`vite-plugin-pwa` generateSW 模式 + `runtimeCaching` 設定

**技術棧**：Vite 8 + vite-plugin-pwa + Workbox (內建)

**說明**：
- 使用 generateSW 模式，Workbox 自動產生 SW
- 透過 `workbox.runtimeCaching` 設定自訂 runtime 快取規則
- 設定 manifest.json 自訂 PWA 外觀與行為
- Precache 由 Vite 構建自動決定（所有 JS/CSS/HTML）
- Runtime caching 處理：
  - 頁面導航：stale-while-revalidate（離線可顯示快取頁面）
  - API 請求：NetworkFirst（優先網路，離線不顯示 toast 錯誤）
  - 字體與圖示：CacheFirst（不常變更）

**配置量**：~50 行 vite.config.ts

**適用情境**：BDD 中定義的所有場景均可滿足，不需手寫 SW

---

## 3. 權衡評估

### 權衡矩陣

| 維度 | 🟢 方案 A 純自動 | 🟡 方案 B 手寫 SW | 🔵 方案 C 自訂快取 |
|------|:---:|:---:|:---:|
| 🎯 需求符合度 | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| ⚡ 開發速度 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| 🔧 維護成本 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐ |
| 📈 擴充性（自訂彈性） | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| 👥 團隊熟悉度 | ⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐ |
| 💰 基礎設施成本 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| 🔒 穩定性與成熟度 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |

### 關鍵取捨分析

**取捨 #1：開發速度 vs 自訂彈性**
- 方案 A：10 分鐘即可有可用的 PWA，但離線行為無法細調
- 方案 B：可完全控制 SW 生命週期，但需要 2-3 倍開發時間
- 方案 C：與方案 A 幾乎相同的開發速度，runtimeCaching 配置足以覆蓋全部 BDD 場景
- **→ 方案 C 是在速度與彈性之間的最佳平衡點**

**取捨 #2：維護成本 vs 未來擴充**
- 方案 A/C：vite-plugin-pwa 升級後自動獲得新版 Workbox，無需手動維護 SW
- 方案 B：每次 Workbox API 變更需要手動調整 sw.ts
- **→ 單人維護專案，方案 C 的維護成本明顯更低**

**取捨 #3：Go embedded static 整合**
- 三個方案在 Go 整合面完全相同：Vite 輸出 sw.js + manifest.json 到 `../src/static/`
- Go 的 `go:embed static` 自動將所有靜態資源（含 PWA 檔案）嵌入二進位
- 後端不需要任何額外路由或中介層
- **→ 三個方案在此無差異**

---

## 4. 決策理由

### 🏆 最終選擇：方案 C — vite-plugin-pwa generateSW + 自訂 runtimeCaching

### 為什麼選擇此方案

1. **Workbox 開箱即用，完全滿足需求**
   - 用戶選擇 Workbox 作為 PWA 方案，generateSW 模式自動整合 Workbox
   - runtimeCaching 設定可覆蓋 BDD 中所有場景：precache 關鍵資源、stale-while-revalidate 頁面快取、NetworkFirst API 處理、離線提示

2. **約 50 行設定即可完成，開發時間最短**
   - vite.config.ts 中加入 vite-plugin-pwa 設定即可
   - 不需新增任何原始碼檔案（方案 B 需新增 sw.ts）
   - 不需修改 Go 後端程式碼

3. **Go embedded 無縫整合，零後端改動**
   - Vite 建構產出 `sw.js`、`manifest.json`、`workbox-*.js` 自動落入 `static/` 目錄
   - `go:embed static` 自動將所有 PWA 資源嵌入二進位檔
   - `sw.js` 路徑為 `/sw.js`，由 Go 的 SPA fallback 之前由 FileServer 正確服務

4. **維護成本極低，適合單人專案**
   - vite-plugin-pwa 升級自動帶入新版 Workbox，不需手動維護 SW
   - 快取策略以宣告式設定表達，意圖清晰，未來調整容易

### 為什麼放棄其他方案

- **方案 A（純自動 generateSW）**：缺少 runtimeCaching 設定，無法滿足 BDD 中「API 請求失敗時不顯示錯誤 toast」和「離線顯示快取頁面框架」的需求
- **方案 B（injectManifest 手寫 SW）**：對本專案過度設計。BDD 中 API 離線不可用是合理限制，不需要自訂 SW 生命週期事件或複雜的訊息傳遞邏輯。手寫 SW 增加維護負擔卻沒有對應價值

---

## 5. 行動計畫

### 技術棧

| 層級 | 技術 | 版本 | 備註 |
|------|------|------|------|
| PWA 插件 | vite-plugin-pwa | ^1.0 | generateSW 模式 |
| Service Worker | Workbox | 7.x (vite-plugin-pwa 內建) | precacheAndRoute + runtimeCaching |
| App 圖示 | 新設計 PNG | 192×192 / 512×512 | `public/` 目錄 |
| Manifest | vite-plugin-pwa 自動產生 | | 寫入 VitePluginPWA config |
| 前端 | Vue 3 + Vite 8 | 同上 | 不變 |
| 後端 | Go + chi/v5 | 同上 | 不需修改 |

### 架構概覽

```
                         ┌──────────────────────────┐
                         │     Nginx (HTTPS TLS)     │
                         │   reverse proxy :443→8080 │
                         └──────────┬───────────────┘
                                    │
                         ┌──────────▼───────────────┐
                         │   Go Binary (:8080)       │
                         │   ┌────────────────────┐  │
                         │   │  go:embed static   │  │
                         │   │  ├ index.html       │  │
                         │   │  ├ assets/*         │  │
                         │   │  ├ sw.js    ← PWA   │  │
                         │   │  ├ manifest.json ←  │  │
                         │   │  ├ workbox-*.js ←   │  │
                         │   │  ├ icon-192.png ←   │  │
                         │   │  └ icon-512.png ←   │  │
                         │   └────────────────────┘  │
                         │   chi router              │
                         │   /api/v1/* → Go handlers │
                         │   /assets/* → FileServer  │
                         │   /*        → index.html  │
                         └──────────────────────────┘

   Browser (HTTPS)
   ┌──────────────────────────┐
   │  1. 載入 /index.html     │
   │  2. 解析 <link manifest> │
   │  3. 註冊 /sw.js          │
   │  4. SW precache 關鍵資源 │
   │  5. 符合條件 → 安裝提示  │
   │  6. 安裝 → 桌面捷徑      │
   └──────────────────────────┘
```

### vite.config.ts 設定規劃

```typescript
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    vue(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        globPatterns: ['**/*.{html,js,css,svg,png,woff2}'],
        runtimeCaching: [
          {
            // 頁面導航：stale-while-revalidate
            urlPattern: /^https?:\/\/.*\/.*/,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'pages-cache',
              expiration: { maxEntries: 50, maxAgeSeconds: 7 * 24 * 60 * 60 }
            }
          },
          {
            // API 請求：NetworkFirst（離線不顯示錯誤）
            urlPattern: /\/api\/.*/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 }
            }
          }
        ]
      },
      manifest: {
        name: 'Linux Service Manager',
        short_name: 'LSM',
        description: 'Systemd 服務管理面板',
        theme_color: '#1a1a2e',
        background_color: '#1a1a2e',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' }
        ]
      }
    })
  ],
  server: {
    proxy: {
      '/api': { target: 'http://localhost:8080', changeOrigin: true },
      '/logout': { target: 'http://localhost:8080', changeOrigin: true },
      '/login': { target: 'http://localhost:8080', changeOrigin: true },
    },
  },
  build: {
    outDir: '../src/static',
    emptyOutDir: true,
  },
})
```

### 初期任務拆分

| 優先級 | 任務 | 預估工時 | 依賴 |
|--------|------|---------|------|
| P0 | 設計 App 圖示（192×192 + 512×512 PNG） | 1-2h | - |
| P0 | 安裝 vite-plugin-pwa 依賴 | 5m | - |
| P0 | 設定 vite.config.ts 加入 VitePWA 插件 | 30m | #1, #2 |
| P0 | 驗證 `sw.js` 和 `manifest.json` 正確產出至 `static/` | 15m | #3 |
| P0 | 驗證 Go embedded 正確服務 PWA 靜態資源 | 15m | #4 |
| P1 | 加入 apple-touch-icon meta 標籤（iOS 相容） | 10m | #1 |
| P1 | 加入 theme-color meta 標籤 | 5m | #3 |
| P1 | 設定 runtimeCaching 規則（頁面 + API） | 15m | #3 |
| P1 | Chrome 桌面安裝流程測試 | 15m | #5 |
| P1 | Chrome Android 安裝流程測試 | 15m | #5 |
| P1 | Safari iOS 手動加入主畫面測試 | 15m | #6 |
| P1 | 離線模式測試（DevTools Network Offline） | 15m | #8 |
| P1 | SW 更新流程測試 | 15m | #5 |
| P2 | Splash screen 精細調整 | 15m | #3 |
| P2 | 不支援 PWA 瀏覽器回歸測試 | 15m | #5 |
| P2 | Playwright E2E 測試撰寫 | 1h | #5 |

### 環境建置步驟

1. **Dev（localhost）**：
   ```bash
   cd frontend && npm install vite-plugin-pwa
   # 編輯 vite.config.ts 加入 VitePWA 設定
   npm run dev  # PWA 在 localhost 可用（HTTPS 非必要）
   ```

2. **Build**：
   ```bash
   cd frontend && npm run build  # 產出 sw.js + manifest.json 到 ../src/static/
   make static                    # Go 嵌入所有靜態資源並編譯
   ```

3. **Staging / Prod**：
   - 確保 Nginx 反向代理使用 HTTPS
   - 部署單一二進位檔
   - 驗證 `https://domain/sw.js` 可訪問

### 有待驗證的項目 (Spike)

- **Workbox runtimeCaching 與 Vue Router 的互動**：確認 SPA 路由切換不會觸發不必要的快取更新
- **API 請求 NetworkFirst 策略**：確認離線模式下 Axios 錯誤被正確攔截，不出現 toast
- **iOS Safari 儲存空間上限**：確認快取大小在 iOS 限制內（約 50MB）
- **Nginx TLS 反向代理下的 SW 註冊**：確認反向代理不會阻擋 `sw.js` 請求或修改 response header

---

## 6. 風險登錄

| 風險 | 可能性 | 影響 | 緩解措施 |
|------|--------|------|---------|
| vite-plugin-pwa 與 Vite 8 相容性 | 低 | 中 | Vite 8 為最新版，插件已有對應版本；若不相容可降級 Vite |
| Nginx 反向代理阻擋 SW 註冊 | 中 | 中 | SW 需要正確的 MIME type (`text/javascript`) 和 `Service-Worker-Allowed` header |
| iOS Safari PWA 行為與預期不同 | 中 | 低 | iOS PWA 限制已知（無自動提示、無背景同步），測試後確認行為 |
| 快取版本管理不當導致 stale 頁面 | 低 | 中 | `autoUpdate` 模式 + 更新提示橫幅確保管理員使用最新版本 |
| App 圖示設計延遲 | 低 | 低 | 可用 favicon.svg 暫時替代，後續再更換 |

---

## 7. Go 後端影響分析

### 需要修改的檔案：無

現有 Go routing 架構已經能正確服務新增的 PWA 靜態資源：

```go
// sw.js、manifest.json、workbox-*.js、icon-*.png
// 這些檔案會被 go:embed static 嵌入，並由以下路由服務：
r.Get("/assets/*", ...)     // 不會匹配（路徑不包含 /assets/）
r.Get("/favicon.svg", ...)  // 不會匹配
  
// 最終落入 SPA fallback 之前的隱含 FileServer 服務
// 因為 staticSub 已經是 http.FS，所有檔案路徑都可直接存取
```

> ⚠️ **注意**：需要確認 `sw.js`、`manifest.json`、`workbox-*.js` 的路由正確。
> 目前 Go 的 `staticHandler` 僅服務 `/assets/*` 和 `/favicon.svg`，
> 需要在 `main.go` 中加入 `sw.js`、`manifest.json` 等 PWA 資源的路由，
> 或將 SPA fallback 改為優先檢查靜態檔案。

#### 建議調整（main.go）：

在 `r.Get("/favicon.svg", ...)` 下方加入萬用靜態檔案路由：

```go
// Serve PWA static files (sw.js, manifest.json, workbox-*.js, icon-*.png)
r.Get("/*", func(w http.ResponseWriter, r *http.Request) {
    path := r.URL.Path
    // Check if file exists in embedded static
    if strings.HasPrefix(path, "/api/") {
        http.NotFound(w, r)
        return
    }
    // Try to serve as static file first
    f, err := staticSub.Open(strings.TrimPrefix(path, "/"))
    if err == nil {
        f.Close()
        staticHandler.ServeHTTP(w, r)
        return
    }
    // Fall back to SPA index.html
    indexContent, err := staticFS.ReadFile("static/index.html")
    if err != nil {
        http.Error(w, "SPA not built — run: cd frontend && npm run build", http.StatusNotFound)
        return
    }
    w.Header().Set("Content-Type", "text/html; charset=utf-8")
    w.Write(indexContent)
})
```

---

## 📝 決策後續

- 本文件已存至 `docs/tech-decisions/tech-decision-006-pwa-support-2025-08-09.md`，應納入版本控制
- 開發方案細節請參考 `docs/development/006-pwa-support.md`
- 測試計畫請參考 `docs/test-plans/006-pwa-support測試計畫.md`
- 建議 PWA 上線後 2 週回顧：檢查 SW 註冊成功率、快取命中率、安裝轉換率
- 若發現重大偏差，可啟動重新討論
