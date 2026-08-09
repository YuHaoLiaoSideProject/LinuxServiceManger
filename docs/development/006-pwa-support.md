# PWA 支援 — 開發實作方案

> **對應技術決策**：[006-pwa-support.md](../tech-decisions/006-pwa-support.md)
> **對應 BDD**：[006-pwa-support.feature](../bdds/006-pwa-support.feature)
> **對應操作流程**：[006-pwa-support.md](../interaction-flows/006-pwa-support.md)
> **狀態**：設計完成，待實作
> **設計日期**：2025-08-09

---

## 1. 實作範圍

### 需要修改的檔案

| 檔案 | 變更類型 | 說明 |
|------|---------|------|
| `frontend/package.json` | 修改 | 加入 `vite-plugin-pwa` 依賴 |
| `frontend/vite.config.ts` | 修改 | 加入 `VitePWA` 插件設定 |
| `frontend/index.html` | 修改 | 加入 theme-color meta + apple-touch-icon link |
| `src/main.go` | 修改 | 加入 PWA 靜態檔案路由（sw.js, manifest.json 等） |
| `frontend/public/icon-192.png` | 新增 | App 圖示 192×192 |
| `frontend/public/icon-512.png` | 新增 | App 圖示 512×512 |

### 不需要修改的檔案

- Go handler / middleware / systemd — PWA 是純前端功能
- Vue components / views / router — PWA 為漸進增強層
- API / stores / composables — 不需要變更

---

## 2. 逐步實作指南

### Step 1：安裝依賴

```bash
cd frontend
npm install -D vite-plugin-pwa
```

### Step 2：準備 App 圖示

將設計好的圖示放入 `frontend/public/`：

```
frontend/public/
├── icon-192.png   (192×192 px)
└── icon-512.png   (512×512 px)
```

> 暫時可用 favicon.svg 轉出 PNG 替代，後續再更換正式圖示。

### Step 3：修改 vite.config.ts

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
            // 離線時顯示快取頁面，上線時背景更新
            urlPattern: /^https?:\/\/.*\/.*/,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'pages-cache',
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 7 * 24 * 60 * 60, // 7 days
              },
            },
          },
          {
            // API 請求：NetworkFirst
            // 優先網路，離線不出現錯誤 toast
            urlPattern: /\/api\/.*/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              networkTimeoutSeconds: 5,
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 60 * 60, // 1 hour
              },
            },
          },
        ],
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
          {
            src: '/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: '/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
          },
        ],
      },
    }),
  ],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
      '/logout': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
      '/login': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: '../src/static',
    emptyOutDir: true,
  },
})
```

### Step 4：修改 index.html

在 `<head>` 中加入 PWA 相關 meta 標籤：

```html
<!-- PWA -->
<meta name="theme-color" content="#1a1a2e">
<link rel="apple-touch-icon" href="/icon-192.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="LSM">
```

### Step 5：修改 main.go（Go 後端路由）

需要修改 `main.go` 中的 SPA fallback 邏輯，讓 PWA 的靜態資源（sw.js, manifest.json, workbox-*.js, icon-*.png）能被正確服務。這些檔案的路徑不屬於 `/assets/*`，目前會被 SPA fallback 攔截而無法正確存取。

**修改前**（現有 `/*` fallback）：

```go
// SPA fallback: serve index.html for all non-API routes
r.Get("/*", func(w http.ResponseWriter, r *http.Request) {
    if strings.HasPrefix(r.URL.Path, "/api/") {
        http.NotFound(w, r)
        return
    }
    indexContent, err := staticFS.ReadFile("static/index.html")
    if err != nil {
        http.Error(w, "SPA not built — run: cd frontend && npm run build", http.StatusNotFound)
        return
    }
    w.Header().Set("Content-Type", "text/html; charset=utf-8")
    w.Write(indexContent)
})
```

**修改後**（優先檢查靜態檔案，找不到才 fallback 到 index.html）：

```go
// SPA fallback: try static file first, then serve index.html
r.Get("/*", func(w http.ResponseWriter, r *http.Request) {
    if strings.HasPrefix(r.URL.Path, "/api/") {
        http.NotFound(w, r)
        return
    }
    // Try to serve as static file first (for PWA sw.js, manifest.json, etc.)
    path := strings.TrimPrefix(r.URL.Path, "/")
    if path == "" {
        path = "index.html"
    }
    f, err := staticSub.Open(path)
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

### Step 6：驗證建構產出

```bash
cd frontend && npm run build
ls ../src/static/
# 應該看到：
#   index.html
#   assets/
#   sw.js              ← PWA Service Worker
#   manifest.json      ← PWA Web App Manifest
#   workbox-*.js       ← Workbox runtime
#   icon-192.png       ← App 圖示
#   icon-512.png       ← App 圖示
```

---

## 3. 檔案結構（變更後）

```
LinuxServiceManger/
├── frontend/
│   ├── public/
│   │   ├── icon-192.png          ← 新增
│   │   └── icon-512.png          ← 新增
│   ├── src/
│   │   └── ... (unchanged)
│   ├── index.html                ← 修改
│   ├── package.json              ← 修改 (新增 vite-plugin-pwa)
│   └── vite.config.ts            ← 修改 (加入 VitePWA)
├── src/
│   ├── main.go                   ← 修改 (SPA fallback 路由)
│   └── static/                   ← 建構產出
│       ├── sw.js                 ← 自動產生
│       ├── manifest.json         ← 自動產生
│       ├── workbox-*.js          ← 自動產生
│       └── ...
└── ...
```

---

## 4. 離線行為說明

| 場景 | 行為 |
|------|------|
| 有網路、首次載入 | SW 註冊 → precache 關鍵資源 → 正常使用 |
| 有網路、再次載入 | SW 回傳快取（快速）→ 背景更新快取 |
| 無網路、已有快取 | SW 回傳快取頁面框架 → 顯示離線提示橫幅 → API 請求靜默失敗 |
| 無網路、無快取 | 顯示離線頁面「需要網路連線」 |
| 部署新版本 | 舊 SW 繼續服務 → 新 SW 在背景 waiting → 顯示更新提示橫幅 → 重整後新 SW 接管 |

---

## 5. Nginx 反向代理設定（部署用）

當部署在 Nginx 反向代理之後時，需確保 SW 相關 header 正確：

```nginx
location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

# Service Worker 需要正確的 MIME type
location ~ ^/(sw\.js|workbox-.*\.js)$ {
    proxy_pass http://127.0.0.1:8080;
    proxy_set_header Host $host;
    add_header Service-Worker-Allowed /;
    add_header Cache-Control "no-cache, must-revalidate";
}
```

---

## 6. 驗收檢查清單

### 設定與資源
- [ ] `npm install vite-plugin-pwa` 完成
- [ ] `vite.config.ts` 加入 VitePWA 設定
- [ ] App 圖示 icon-192.png / icon-512.png 存在於 public/
- [ ] `index.html` 加入 theme-color meta 與 apple-touch-icon
- [ ] `main.go` SPA fallback 正確服務 PWA 靜態資源
- [ ] `npm run build` 產出 sw.js + manifest.json + workbox-*.js
- [ ] `make static` Go 編譯成功

### PWA 安裝測試（HTTPS）
- [ ] Chrome 桌面：網址列出現安裝圖示
- [ ] Chrome 桌面：安裝後以獨立視窗啟動，無瀏覽器工具列
- [ ] Chrome Android：底部出現安裝提示橫幅
- [ ] Edge 桌面：網址列出現安裝圖示
- [ ] Firefox 桌面：網址列出現安裝圖示
- [ ] Safari iOS：手動「加入主畫面」後從主畫面啟動正常

### PWA 功能測試
- [ ] standalone 模式下登入 / Dashboard / 服務操作正常
- [ ] standalone 模式下深色模式切換正常
- [ ] standalone 模式下語言切換正常
- [ ] standalone 模式下 Journalctl 日誌查看正常

### 離線測試（DevTools → Network → Offline）
- [ ] 重整後仍可顯示 App shell（非白畫面）
- [ ] 顯示離線提示橫幅
- [ ] API 請求失敗時不出現錯誤 toast
- [ ] 無快取時顯示「需要網路連線」頁面

### 更新測試
- [ ] 部署新版本後，已安裝 PWA 顯示更新提示
- [ ] 重整後新版本生效

### 回歸測試
- [ ] 不支援 PWA 的瀏覽器：無安裝提示，功能正常
- [ ] HTTP 環境：SW 無法註冊，功能正常
- [ ] 未安裝 PWA：瀏覽器版功能正常
