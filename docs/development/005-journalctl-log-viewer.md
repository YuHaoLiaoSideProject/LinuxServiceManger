# journalctl 日誌檢視器 — 開發規格（WebSocket 版）

> **對應 Roadmap**：Phase 1 — `docs/development/002-expansion-roadmap.md`
> **技術決策**：`docs/tech-decisions/005-journalctl-log-viewer.md`（方案 B：WebSocket + journalctl -f）
> **前次決策**：已合併至上方文件附錄（方案 A：HTTP Polling，已廢棄）
> **操作流程**：`docs/interaction-flows/005-journalctl-log-viewer.md`
> **BDD**：`docs/bdds/005-journalctl-log-viewer.feature`
> **測試計畫**：`docs/test-plans/005-journalctl-log-viewer測試計畫.md`
> **狀態**：設計完成，待開發（使用 TDD）

---

## 1. 後端實作規格

### 1.1 Interface 擴充

```go
// systemd.go — ServiceManager interface 新增方法
type ServiceManager interface {
    // ... 現有方法 ...
    GetServiceLogs(name string, lines int) (string, error)
}
```

### 1.2 GetServiceLogs 實作（基礎版，不含 -f）

```go
func (m *DefaultManager) GetServiceLogs(name string, lines int) (string, error) {
    return GetServiceLogs(name, lines)
}

func GetServiceLogs(name string, lines int) (string, error) {
    // 1. 驗證服務名稱
    if err := ValidateServiceName(name); err != nil {
        return "", err
    }

    // 2. 驗證行數範圍
    if lines < 1 || lines > 1000 {
        return "", fmt.Errorf("lines must be between 1 and 1000")
    }

    // 3. 檢查 journalctl 是否存在
    if _, err := exec.LookPath("journalctl"); err != nil {
        return "", fmt.Errorf("journalctl not found: system does not support journalctl")
    }

    // 4. 執行 journalctl（無 -f；GetServiceLogs 僅用於單次查詢與測試）
    ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
    defer cancel()

    cmd := exec.CommandContext(ctx,
        "journalctl", "-u", name,
        "-n", strconv.Itoa(lines),
        "--no-pager",
        "-o", "short-iso",
    )

    out, err := cmd.CombinedOutput()
    if err != nil {
        if ctx.Err() == context.DeadlineExceeded {
            return "", fmt.Errorf("timeout reading logs")
        }
        stderr := strings.TrimSpace(string(out))
        if strings.Contains(stderr, "permission denied") ||
           strings.Contains(stderr, "not authorized") {
            return "", fmt.Errorf("permission denied: user lacks journalctl access")
        }
        return "", fmt.Errorf("journalctl error: %s", stderr)
    }

    return string(out), nil
}
```

### 1.3 WebSocket Handler（方案 B 核心）

```go
// json_handler.go 新增

import (
    "bufio"
    "github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
    CheckOrigin: func(r *http.Request) bool { return true },
}

func (h *Handler) HandleServiceLogsWS(w http.ResponseWriter, r *http.Request) {
    name := chi.URLParam(r, "name")

    // 1. 解析 lines 參數，預設 100
    linesStr := r.URL.Query().Get("lines")
    lines := 100
    if linesStr != "" {
        var err error
        lines, err = strconv.Atoi(linesStr)
        if err != nil || lines < 1 || lines > 1000 {
            writeJSON(w, http.StatusBadRequest, messageJSON{
                Error: "lines must be between 1 and 1000",
            })
            return
        }
    }

    // 2. 驗證服務名稱
    if err := systemd.ValidateServiceName(name); err != nil {
        writeJSON(w, http.StatusBadRequest, messageJSON{Error: err.Error()})
        return
    }

    // 3. 檢查 journalctl 是否存在
    if _, err := exec.LookPath("journalctl"); err != nil {
        writeJSON(w, http.StatusInternalServerError, messageJSON{
            Error: "journalctl not found: system does not support journalctl",
        })
        return
    }

    // 4. Upgrade HTTP → WebSocket
    conn, err := upgrader.Upgrade(w, r, nil)
    if err != nil {
        log.Printf("ERROR upgrading WebSocket for %s: %v", name, err)
        return
    }
    defer conn.Close()

    // 5. 啟動 journalctl -f（follow mode）
    ctx, cancel := context.WithCancel(r.Context())
    defer cancel()

    cmd := exec.CommandContext(ctx,
        "journalctl", "-u", name,
        "-n", strconv.Itoa(lines),
        "-f",               // ★ follow mode: 持續輸出新增日誌
        "--no-pager",
        "-o", "short-iso",
    )

    stdout, err := cmd.StdoutPipe()
    if err != nil {
        log.Printf("ERROR creating stdout pipe for %s: %v", name, err)
        conn.WriteMessage(websocket.TextMessage, []byte(`{"error":"failed to start journalctl"}`))
        return
    }

    if err := cmd.Start(); err != nil {
        log.Printf("ERROR starting journalctl for %s: %v", name, err)
        // 區分權限不足
        errMsg := err.Error()
        if strings.Contains(errMsg, "permission denied") {
            conn.WriteMessage(websocket.TextMessage, []byte(`{"error":"permission denied: user lacks journalctl access"}`))
        } else {
            conn.WriteMessage(websocket.TextMessage, []byte(`{"error":"`+errMsg+`"}`))
        }
        return
    }

    // 6. 讀取 journalctl stdout，逐行推送 WebSocket
    scanner := bufio.NewScanner(stdout)
    for scanner.Scan() {
        line := scanner.Bytes()
        if err := conn.WriteMessage(websocket.TextMessage, line); err != nil {
            // Client 斷線 → 跳出迴圈 → cancel ctx → kill journalctl
            log.Printf("INFO WebSocket write error for %s (client disconnected): %v", name, err)
            break
        }
    }

    // 7. 等待 journalctl 退出
    if err := cmd.Wait(); err != nil {
        if ctx.Err() != context.Canceled {
            log.Printf("ERROR journalctl for %s exited: %v", name, err)
        }
    }
}
```

### 1.4 路由註冊

```go
// main.go — 在 protected JSON API group 新增
r.Group(func(r chi.Router) {
    r.Use(middleware.AuthMiddlewareJSON)
    // ... 現有路由 ...
    r.Get("/api/v1/services/{name}/logs/ws", h.HandleServiceLogsWS)  // ★ WebSocket
})
```

> **注意**：路由結尾是 `/logs/ws`，前端用 `wss://host/api/v1/services/{name}/logs/ws?lines=100` 連線。

### 1.5 Mock 更新

```go
// handler_test.go 或 systemd_test.go 的 mock 需新增：
func (m *MockServiceManager) GetServiceLogs(name string, lines int) (string, error) {
    args := m.Called(name, lines)
    return args.String(0), args.Error(1)
}
```

---

## 2. 前端實作規格（WebSocket 版）

### 2.1 元件樹變更

```
DashboardView.vue
├── StatsBar.vue          （不變）
├── Toolbar.vue           （不變）
├── TabsBar.vue           （不變）
├── ServiceTable.vue      （不變）
│   └── ServiceRow.vue    ★ 修改：Actions 新增「📋 Logs」按鈕
│       └── emit("open-logs", serviceName)
└── LogDrawer.vue         ★ 新增：Drawer 元件（WebSocket client）
```

### 2.2 ServiceRow.vue — 修改點

在 Actions 區塊加入 Logs 按鈕：

```vue
<!-- 新增：所有服務（含 lock）都可查看日誌 -->
<button
  class="btn btn-sm btn-ghost"
  title="查看日誌"
  @click.stop="$emit('open-logs', service.name)"
>
  📋 Logs
</button>
```

### 2.3 LogDrawer.vue — 新增元件（WebSocket 版）

**Props**：
```typescript
interface LogDrawerProps {
  serviceName: string       // 當前服務名稱
  visible: boolean          // Drawer 是否開啟
}
```

**Emits**：
```typescript
interface LogDrawerEmits {
  (e: 'close'): void                         // 關閉 Drawer
  (e: 'switch-service', name: string): void  // 切換服務
}
```

**Local State**：
```typescript
const logContent = ref('')          // 日誌文字（逐行 append）
const isLoading = ref(false)        // WebSocket 連線中
const error = ref('')              // 錯誤訊息
const lineCount = ref(100)         // 目前選擇的行數（50/100/200/500）
const searchQuery = ref('')        // 搜尋關鍵字
const matchCount = ref(0)          // 搜尋匹配行數
const isConnected = ref(false)     // WebSocket 連線狀態
let ws: WebSocket | null = null    // WebSocket 實例
```

> **注意**：相較於方案 A，不需要 `autoRefresh`、`refreshTimer`、失敗計數器。WebSocket 原生處理即時串流。

**生命週期**：

```
watch(visible + serviceName):
  if visible && serviceName:
    connectWebSocket()
  else:
    disconnectWebSocket()

watch(lineCount):
  if isConnected:
    disconnectWebSocket()
    connectWebSocket()   // 以新行數重新連線

onUnmounted:
  disconnectWebSocket()
```

**connectWebSocket 邏輯**：
```
1. isLoading = true, error = '', logContent = ''
2. 建立 WebSocket:
   ws = new WebSocket(`wss://host/api/v1/services/${name}/logs/ws?lines=${lineCount}`)
3. ws.onopen:
   - isLoading = false
   - isConnected = true
4. ws.onmessage (event):
   - 檢查是否為 error JSON（{"error": "..."}）
     → 是：error.value = message.error, isConnected = false
   - 否則：logContent.value += event.data + '\n'
   - 自動捲動到底部
5. ws.onclose:
   - isConnected = false
   - 若非主動關閉 → 顯示重連提示，1s 後 auto-reconnect
6. ws.onerror:
   - error.value = 'WebSocket 連線失敗'
   - isLoading = false
```

**disconnectWebSocket 邏輯**：
```
1. if ws:
     ws.onclose = null  // 避免觸發 auto-reconnect
     ws.close()
     ws = null
2. isConnected = false
```

**搜尋邏輯**（與方案 A 相同）：
```
computed filteredLines:
  if searchQuery 為空 → 全部行正常顯示
  else → 每行檢查是否包含 searchQuery（忽略大小寫）
    - 匹配：highlight class（黃色背景）
    - 不匹配：dim class（降低透明度）
  matchCount = 匹配行數
```

**模板結構**：
```vue
<template>
  <Teleport to="body">
    <!-- 遮罩 -->
    <div v-if="visible" class="drawer-overlay" @click="$emit('close')" />
    
    <!-- Drawer -->
    <div v-if="visible" class="drawer" :class="{ 'drawer--open': visible }">
      <!-- Header：標題 + ✕ + 連線狀態指示器 -->
      <div class="drawer-header">
        <h2>📋 {{ serviceName }} Logs</h2>
        <span class="connection-status" :class="{ connected: isConnected }">
          {{ isConnected ? '● LIVE' : '○ 離線' }}
        </span>
        <button @click="$emit('close')" class="drawer-close">✕</button>
      </div>
      
      <!-- 搜尋框 -->
      <div class="drawer-search">
        <input v-model="searchQuery" placeholder="搜尋日誌..." />
        <span v-if="searchQuery">{{ matchCount }} / {{ totalLines }} 行</span>
      </div>
      
      <!-- 內容區 -->
      <div class="drawer-content" ref="contentRef">
        <!-- Loading：WebSocket 連線中 -->
        <div v-if="isLoading" class="drawer-loading">
          <div class="spinner"></div>
          <p>連線中...</p>
        </div>
        
        <!-- Error -->
        <div v-else-if="error" class="drawer-error">
          <p>{{ error }}</p>
          <button @click="connectWebSocket">重試</button>
        </div>
        
        <!-- Empty -->
        <div v-else-if="!logContent && isConnected" class="drawer-empty">
          此服務尚無日誌記錄
        </div>
        
        <!-- Log content -->
        <pre v-else class="drawer-log">
          <span v-for="(line, i) in filteredLines" :key="i"
                :class="line.match ? 'highlight' : 'dim'">
            {{ line.text }}
          </span>
        </pre>
      </div>
      
      <!-- Footer：控制列 -->
      <div class="drawer-footer">
        <select v-model="lineCount">
          <option :value="50">50</option>
          <option :value="100">100</option>
          <option :value="200">200</option>
          <option :value="500">500</option>
        </select>
        
        <span class="line-count-hint">顯示最近 {{ lineCount }} 行 · 即時串流中</span>
      </div>
    </div>
  </Teleport>
</template>
```

> **關鍵差異 vs 方案 A**：
> - Footer 不再有「自動刷新開關」— journalctl -f 本身就是持續串流
> - Header 新增連線狀態指示器（● LIVE / ○ 離線）
> - 行數切換時關閉舊 WebSocket + 建立新 WebSocket
> - 不需 timer / 失敗計數器 / diff 邏輯

**CSS 關鍵樣式**：
```css
.drawer-overlay {
  position: fixed; inset: 0;
  background: rgba(0,0,0,0.3);
  z-index: 1000;
}
.drawer {
  position: fixed; top: 0; right: 0; bottom: 0;
  width: min(50vw, 700px); min-width: 400px;
  background: var(--bg-primary);
  z-index: 1001;
  transform: translateX(100%);
  transition: transform 200ms ease;
  display: flex; flex-direction: column;
}
.drawer--open { transform: translateX(0); }

.drawer-header {
  display: flex; align-items: center; gap: 8px;
  padding: 16px; border-bottom: 1px solid var(--border-color);
}
.connection-status { font-size: 0.75rem; color: #999; }
.connection-status.connected { color: #4caf50; }
.drawer-close { margin-left: auto; }

.drawer-content { flex: 1; overflow-y: auto; padding: 0 16px; }
.drawer-log {
  font-family: 'Fira Code', 'Consolas', monospace;
  font-size: 0.8125rem; line-height: 1.5;
  white-space: pre-wrap; overflow-x: auto;
  margin: 0;
}
.highlight { background: rgba(255, 235, 59, 0.4); }
.dim { opacity: 0.4; }

.drawer-footer {
  padding: 12px 16px; border-top: 1px solid var(--border-color);
  display: flex; align-items: center; gap: 12px;
}
.line-count-hint { font-size: 0.75rem; color: #888; }

/* 行動裝置 */
@media (max-width: 768px) {
  .drawer { width: 100vw; min-width: unset; }
}
```

### 2.4 DashboardView.vue — 整合

```vue
<script setup lang="ts">
// ... 現有 imports ...
import LogDrawer from '../components/LogDrawer.vue'

const logDrawerVisible = ref(false)
const logDrawerServiceName = ref('')

function openLogDrawer(name: string) {
  // 若已有 Drawer 開啟且為不同服務 → 先關閉再開（由 LogDrawer watch 處理）
  logDrawerServiceName.value = name
  logDrawerVisible.value = true
}

function closeLogDrawer() {
  logDrawerVisible.value = false
  logDrawerServiceName.value = ''
}
</script>

<template>
  <main class="app-container">
    <!-- ... 現有內容 ... -->
    <LogDrawer
      :service-name="logDrawerServiceName"
      :visible="logDrawerVisible"
      @close="closeLogDrawer"
    />
  </main>
</template>
```

### 2.5 鍵盤與無障礙

| 互動 | 行為 |
|------|------|
| `Esc` | 關閉 Drawer |
| Tab / Shift+Tab | 焦點困在 Drawer 內（focus trap，P2 實作） |
| Drawer 開啟時 | `aria-hidden="true"` 加在背景 Dashboard 上 |
| ✕ 按鈕 | `aria-label="關閉日誌檢視器"` |
| 連線狀態 | `aria-live="polite"` 即時播報狀態變化 |

### 2.6 TypeScript 型別擴充

```typescript
// types/service.ts 新增
export interface LogDrawerState {
  visible: boolean
  serviceName: string
}

export interface LogLine {
  text: string
  match: boolean
}
```

---

## 3. 測試需求（WebSocket 版）

### 3.1 後端單元測試

| 測試 | 檔案 | 說明 |
|------|------|------|
| `GetServiceLogs` 正常回傳 | `systemd_test.go` | mock exec 回傳假日誌文字 |
| 無效的服務名稱 | `systemd_test.go` | `name=""` 或 `name="../../../"` |
| lines 超出範圍 | `systemd_test.go` | lines=0, lines=1001 |
| journalctl 不存在 | `systemd_test.go` | 模擬 LookPath 失敗 |
| WebSocket upgrade 成功 | `handler_test.go` | 模擬 WS 握手 |
| WebSocket 收到 journalctl 輸出行 | `handler_test.go` | 模擬 stdout pipe → WS message |
| WebSocket client 關閉 → journalctl process killed | `handler_test.go` | context cancel 驗證 |
| WebSocket 權限不足 → 錯誤訊息 | `handler_test.go` | mock journalctl 回傳 permission denied |
| 未驗證請求 → 401 | `handler_test.go` | AuthMiddleware |

### 3.2 前端單元測試（Vitest）

| # | 測試 | 說明 |
|---|------|------|
| F-LD-01 | `visible=false` 不渲染 | Drawer 不存在 |
| F-LD-02 | `visible=true` 渲染 Drawer + 標題 | Props 綁定 |
| F-LD-03 | 連線中顯示 loading | WebSocket CONNECTING |
| F-LD-04 | WebSocket onMessage → 日誌追加 | append 到 logContent |
| F-LD-05 | 日誌自動捲動到底部 | scrollTop 驗證 |
| F-LD-06 | 點擊 ✕ → emit close + WS 關閉 | close 事件 |
| F-LD-07 | 點擊遮罩關閉 | overlay click |
| F-LD-08 | Esc 鍵關閉 | keyboard event |
| F-LD-09 | 無日誌空狀態 | isConnected + 無內容 |
| F-LD-10 | 行數選擇器四檔可選 | `<select>` 選項驗證 |
| F-LD-11 | 行數切換 → WS 重連 | watch lineCount |
| F-LD-12 | WebSocket onClose → 重連 | 非主動關閉時 |
| F-LD-13 | 連線失敗顯示錯誤 + 重試按鈕 | onerror |
| F-LD-14 | 搜尋 highlight 匹配行 | filteredLines |
| F-LD-15 | 搜尋匹配計數 | matchCount |
| F-LD-16 | 清空搜尋恢復顯示 | reset |
| F-LD-17 | 即時串流新行追加 | onMessage append |
| F-LD-18 | 連線狀態指示器 | isConnected |
| F-LD-19 | serviceName 變更 → WS 重連 | watch serviceName |
| F-LD-20 | unmount 時關閉 WS | onUnmounted |

### 3.3 端對端測試（Playwright）

| 測試 | 說明 |
|------|------|
| 完整 happy path | 登入 → 點擊 Logs → Drawer 滑入 → 日誌即時顯示 → 切換行數 → 搜尋 → 關閉 |
| 無日誌服務 | 點擊無輸出服務的 Logs → 空狀態 |
| Drawer 遮罩點擊關閉 | 點擊遮罩區域 → Drawer 關閉 |
| 切換服務 | Drawer 開啟中點擊另一服務的 Logs → 內容更新 |
| 即時串流 | 觸發服務輸出新日誌 → Drawer 自動顯示新行 |
| 行動裝置 | 窄螢幕 → Drawer 全螢幕 |

---

## 4. 部署考量

| 項目 | 說明 |
|------|------|
| **journalctl 權限** | 執行 linux-service-manager 的使用者需具備 `systemd-journal` 群組成員資格 |
| **無 journalctl 環境** | WebSocket upgrade 前檢查 `exec.LookPath`，失敗時回傳明確錯誤 |
| **WebSocket 資源** | 每個 Drawer 消耗一個 WebSocket 連線 + 一個 journalctl -f process。同時僅一個 Drawer，資源可控 |
| **反向代理** | 若有 nginx reverse proxy，需設定 WebSocket 支援（`proxy_set_header Upgrade $http_upgrade`） |
| **Binary 大小** | 新增 `gorilla/websocket` 依賴，binary 增加約 200KB |
| **process 清理** | `defer cancel()` + `cmd.Wait()` 確保 Drawer 關閉時 journalctl process 被終止 |

---

*最後更新：2026-08-08 — 更新為方案 B（WebSocket + journalctl -f）*
