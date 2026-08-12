# 資源監控儀表板流程

> **對應 Roadmap**：Phase 4 — `docs/development/002-expansion-roadmap.md` 項目 #13
> **狀態**：設計中
> **設計日期**：2025-08-09
> **最後更新**：2025-08-09

---

## 1. 功能概述

在 Web UI 中提供即時主機資源監控儀表板，以互動式圖表呈現 CPU 使用率、記憶體用量、磁碟使用量、網路流量等系統指標，讓管理員不需 SSH 即可掌握主機健康狀態。

**核心價值**：一站式視覺化主機效能，快速識別資源瓶頸（CPU 飆高、記憶體洩漏、磁碟快滿、網路異常），為後續告警引擎（Phase 5）提供資料基礎。

---

## 2. 使用者與場景

| 項目 | 內容 |
|------|------|
| **角色** | 已登入的管理員 |
| **觸發入口** | Header 導覽列新增「Metrics」連結，點擊導航至 `/metrics` |
| **前置條件** | ☑ 已登入、☑ 後端指標收集模組已啟動（預設啟用）、☑ 主機已運行足夠時間以產生初始歷史資料（首次啟動至少 1 分鐘） |
| **使用情境** | 1. 管理員發現服務回應變慢，打開儀表板檢查 CPU / 記憶體是否異常<br>2. 管理員每日巡檢，快速瀏覽各項資源使用趨勢<br>3. 管理員要在擴充硬碟前確認目前磁碟使用成長率<br>4. 管理員診斷網路流量異常（如 DDoS 或服務異常流量）<br>5. 管理員長時間掛著儀表板，監控即時變化 |

---

## 3. 操作流程圖

### 3.1 主流程 — 儀表板瀏覽與互動

```mermaid
flowchart TD
    Start([管理員點擊 Header
    「Metrics」連結])
    
    Start --> Navigate[導航至 /metrics 頁面]
    
    Navigate --> LoadPage[MetricsDashboard 元件掛載
    顯示 4 區塊 skeleton 骨架屏]
    
    LoadPage --> FetchData[並行請求：
    GET /api/v1/metrics/current
    GET /api/v1/metrics/history?range=1h]
    
    FetchData --> CheckResult{API 回應?}
    
    CheckResult -- 成功有資料 --> RenderCharts[渲染 4 組指標圖表：
    CPU / Memory / Disk / Network]
    CheckResult -- 成功無歷史資料 --> RenderCurrent[僅顯示即時值數字
    折線圖顯示單點 +
    「資料收集中，歷史圖表將於數分鐘後可用」]
    CheckResult -- 部分失敗 --> RenderPartial[成功區塊正常顯示
    失敗區塊顯示錯誤 + 獨立重試]
    CheckResult -- 全部失敗 --> ShowError[顯示全域錯誤
    + 重試按鈕]
    
    RenderCharts --> StartPolling[啟動定時輪詢
    預設每 10 秒更新 current
    每 30 秒追加 history 新資料點]
    
    StartPolling --> Idle{管理員操作?}
    
    Idle -- 切換時間範圍 --> SwitchRange[變更 range 參數
    15m | 1h | 6h | 24h | 7d
    重新載入 history 全量資料]
    Idle -- 開關自動更新 --> TogglePolling[暫停 / 恢復輪詢
    按鈕狀態切換]
    Idle -- 調整更新頻率 --> ChangeInterval[變更輪詢間隔
    5s | 10s | 30s | 60s]
    Idle -- 展開單一指標 --> ExpandMetric[點擊指標卡片
    該區塊展開至全寬
    顯示更詳細圖表]
    Idle -- 游標懸停圖表 --> HoverTooltip[顯示該時間點
    精確數值 tooltip]
    Idle -- 返回 Dashboard --> Back[導航回 /]
    
    SwitchRange --> FetchHistory[GET /api/v1/metrics/history?range=NEW]
    TogglePolling --> Idle
    ChangeInterval --> Idle
    ExpandMetric --> Idle
    HoverTooltip --> Idle
    
    FetchHistory --> RenderCharts
    
    Back --> Dashboard([回到 Dashboard])

    ShowError --> Retry[點擊重試按鈕]
    Retry --> FetchData
    
    RenderPartial --> RetryFailed[點擊失敗區塊重試按鈕]
    RetryFailed --> FetchData

    style Start fill:#e8f5e9,stroke:#2e7d32
    style Dashboard fill:#e8f5e9,stroke:#2e7d32
    style RenderCharts fill:#e3f2fd,stroke:#1565c0
    style RenderCurrent fill:#fff8e1,stroke:#f9a825
    style ShowError fill:#fff0f0,stroke:#e00
    style RenderPartial fill:#fff3e0,stroke:#e65100
```

### 3.2 後端指標收集（背景子流程）

```mermaid
flowchart TD
    StartCollect[後端啟動
    metrics collector goroutine]
    
    StartCollect --> InitCollector[初始化 gopsutil
    註冊收集器：CPU/Mem/Disk/Net]
    
    InitCollector --> SetInterval[設定取樣間隔
    預設 5 秒]
    
    SetInterval --> Tick[等待 ticker 觸發]
    
    Tick --> Collect[並行收集 4 類指標：
    cpu_percent, mem_usage,
    disk_usage (per mount),
    net_io (per interface)]
    
    Collect --> StoreInMemory[寫入環形緩衝區
    保留最近 7 天資料
    超過自動淘汰最舊資料點]
    
    StoreInMemory --> Tick
    
    Collect --> CollectError{收集失敗?}
    CollectError -- gopsutil 錯誤 --> LogError[記錄 error log
    將該次資料點標記為 null
    不中斷收集循環]
    LogError --> Tick

    style StartCollect fill:#e8f5e9,stroke:#2e7d32
    style StoreInMemory fill:#e3f2fd,stroke:#1565c0
    style LogError fill:#fff0f0,stroke:#e00
```

---

## 4. 逐步互動說明

### 步驟 1：進入資源監控儀表板

| | 描述 |
|---|------|
| **觸發** | 管理員點擊 Header 導覽列中的「Metrics」連結 |
| **操作前** | 管理員在 Dashboard 或其他頁面 |
| **系統回應** | 路由導航至 `/metrics`。MetricsDashboard 元件掛載，顯示 4 個骨架屏區塊（灰色脈衝動畫），並行請求 `GET /api/v1/metrics/current` 與 `GET /api/v1/metrics/history?range=1h` |
| **操作後** | 4 組指標圖表渲染完成，頁面右上角顯示「自動更新：開啟」標籤與更新間隔 |
| **狀態變化** | 頁面：當前頁面 → /metrics<br>UI：skeleton → 即時圖表<br>輪詢：已啟動（10s 間隔） |

### 步驟 2：瀏覽即時指標總覽

| | 描述 |
|---|------|
| **觸發** | 儀表板載入完成 |
| **操作前** | 4 區塊已渲染 |
| **系統回應** | 頁面分為 2x2 網格佈局，每個區塊包含：<br>**CPU**：環形 gauge（目前使用率 %）+ 折線圖（歷史趨勢），圖例：user / system / iowait<br>**Memory**：橫條圖（已用 / 可用 / 快取）+ 折線圖，數值以 GB/MB 顯示<br>**Disk**：各掛載點甜甜圈圖（使用率 %）+ 折線圖（每掛載點一條線）<br>**Network**：折線圖（RX/TX bytes/sec），自動縮放單位（KB/s → MB/s） |
| **操作後** | 管理員可一眼掌握主機健康狀態。滑鼠懸停圖表任意時間點顯示精確數值 tooltip |
| **狀態變化** | 靜態瀏覽，輪詢持續更新即時值 |

### 步驟 3：切換時間範圍

| | 描述 |
|---|------|
| **觸發** | 管理員點擊時間範圍選擇器（預設顯示「1 小時」） |
| **操作前** | 圖表顯示最近 1 小時歷史資料 |
| **系統回應** | 下拉選單展開：15 分鐘 / 1 小時 / 6 小時 / 24 小時 / 7 天。選擇後，對所有圖表發出 `GET /api/v1/metrics/history?range={new_range}`。載入期間圖表顯示輕量 spinner overlay（不遮蔽已顯示資料） |
| **操作後** | 圖表 X 軸更新為新時間範圍。超過 6 小時的範圍自動啟用資料聚合（每 N 點取平均值），避免渲染過多資料點 |
| **狀態變化** | 圖表時間軸更新，歷史查詢參數變更，輪詢持續 |

### 步驟 4：展開單一指標詳細檢視

| | 描述 |
|---|------|
| **觸發** | 管理員點擊任一指標區塊的「展開」圖示（或雙擊區塊標題列） |
| **操作前** | 2x2 網格佈局，4 個區塊並排 |
| **系統回應** | 點擊的區塊展開至全寬，其他 3 個區塊縮小為底部縮圖列。展開的圖表顯示更精細的資料（如 CPU 顯示 per-core 折線、Disk 顯示各掛載點詳細 breakdown、Network 顯示 per-interface 流量） |
| **操作後** | 管理員可深入分析特定資源。再次點擊「折疊」或點其他區塊縮圖切換焦點 |
| **狀態變化** | 佈局切換，詳細度提升，其他指標仍持續更新 |

### 步驟 5：控制自動更新

| | 描述 |
|---|------|
| **觸發** | 管理員點擊右上角「自動更新」開關，或調整更新間隔下拉選單 |
| **操作前** | 自動更新開啟，間隔 10 秒 |
| **系統回應** | 點擊開關：立即停止 / 恢復輪詢計時器。開關顯示「已暫停」（灰色）。變更間隔：銷毀舊計時器，以新間隔建立。右上角顯示目前狀態 |
| **操作後** | 暫停時：current 值凍結在最後一次結果，圖表不再更新。恢復後立即拉取一次最新資料。手動重整按鈕在暫停時變得可用 |
| **狀態變化** | 輪詢狀態：運行中 ↔ 已暫停<br>UI 標籤更新 |

### 步驟 6：背景自動輪詢更新

| | 描述 |
|---|------|
| **觸發** | 定時器觸發（預設 10 秒） |
| **操作前** | 圖表顯示上次資料 |
| **系統回應** | 每 10 秒呼叫 `GET /api/v1/metrics/current` 更新即時值（gauge、數字）。每 30 秒呼叫 `GET /api/v1/metrics/history?range={range}&since={last_ts}` 追加新資料點至折線圖。圖表動畫平滑過渡（非瞬間跳變）。瀏覽器 tab 隱藏時自動暫停輪詢，切回時立即拉取一次並恢復 |
| **操作後** | 圖表向右推移，舊資料點向左移動。即時值數字可能有輕微波動 |
| **狀態變化** | 圖表資料 append，不觸發完整重繪 |

---

## 5. 異常處理

| 異常情境 | 使用者看到的回饋 | 恢復路徑 |
|----------|-----------------|---------|
| **後端指標收集模組未啟動** | API 回傳 503 + `"metrics collection not available"`。儀表板顯示「資源監控尚未啟用」訊息 + 說明文件連結 | 管理員重新啟動服務或檢查設定檔 |
| **部分指標收集失敗**（如 disk IO 權限不足） | 該區塊顯示「無法取得磁碟指標」錯誤圖示 + 獨立重試按鈕。其他區塊正常運作 | 點擊重試，或檢查 gopsutil 權限 |
| **API 請求逾時**（網路或後端忙碌） | 逾時的區塊顯示黃色警告「更新逾時，正在重試...」。自動重試最多 3 次，每次間隔 2 秒 | 3 次失敗後顯示「無法連線，請檢查主機狀態」+ 手動重試 |
| **歷史資料為空**（首次啟動） | 折線圖區域顯示空狀態插圖 + 「資料收集中，歷史圖表將於數分鐘後可用」。即時值仍正常顯示 | 等待 1-2 分鐘後圖表自動出現資料點 |
| **時間範圍內無資料點**（如選擇 15m 但收集器剛重啟） | 折線圖顯示現有資料點 + 提示「此範圍僅有 N 筆資料」 | 切換到較長時間範圍 |
| **環形緩衝區滿**（7 天保留期觸發） | 使用者無感知。最舊資料點自動淘汰，圖表不再顯示超過 7 天的資料 | 若需更長保留，設定外部時序儲存（Prometheus） |
| **瀏覽器 tab 長時間背景** | tab 隱藏時暫停輪詢，節省資源。切回 tab 時顯示短暫「同步中...」spinner，拉取最新資料 | 自動恢復，無需手動操作 |
| **高頻率輪詢造成後端負載** | 更新間隔設為 5 秒時，後端若回應變慢，前端自動降級為 10 秒間隔 + Toast 提示「已自動調整更新頻率」 | 管理員可手動調高間隔 |
| **磁碟使用率達臨界值**（>90%） | 磁碟指標卡片邊框變為紅色 + 圖表中超過 90% 的區域以淡紅色背景標示 | 管理員應立即清理磁碟或擴容 |

---

## 6. 邊界與限制

| 項目 | 限制說明 |
|------|---------|
| **指標種類** | 初期支援 CPU / Memory / Disk / Network 四大類。CPU 含 per-core 與 aggregate；Memory 含 used/free/cached/buffers；Disk 含所有實體掛載點（排除 tmpfs/snap）；Network 含所有實體介面（排除 lo） |
| **取樣頻率** | 後端每 5 秒收集一次，儲存至記憶體環形緩衝區。前端輪詢間隔可設為 5s/10s/30s/60s，預設 10 秒。最小間隔 5 秒是為避免 gopsutil 呼叫過於頻繁 |
| **歷史保留** | 記憶體內環形緩衝區保留最近 7 天（5 秒間隔 ≈ 120,960 筆/指標）。7 天前資料自動淘汰。可選配 Prometheus / VictoriaMetrics 外部儲存以延長保留 |
| **時間範圍** | 前端支援 15m / 1h / 6h / 24h / 7d。超過 6h 的查詢，後端以 1 分鐘聚合回傳（取平均值），前端最多渲染 1,000 個資料點 |
| **效能開銷** | gopsutil 收集本身微幅消耗（<1% CPU per collect）。環形緩衝區記憶體用量約 10-20MB（7 天 × 4 類指標） |
| **並發** | 後端收集器為單一 goroutine，無需鎖定。前端多 tab 同時開啟時，每個 tab 獨立輪詢，後端以無狀態 API 回應，無 session 綁定 |
| **網路介面聚合** | 若主機有多個實體網路介面，圖表預設顯示彙總（所有介面加總），展開後可檢視 per-interface 明細 |
| **磁碟掛載點** | 自動排除虛擬檔案系統（tmpfs, devtmpfs, squashfs, snap 掛載點）。若僅有 rootfs 一個實體掛載點，Disk 區塊仍正常顯示 |
| **單位換算** | Memory/Disk 自動換算（KB → MB → GB → TB），Network 自動換算（B/s → KB/s → MB/s）。閾值：>1024 進位 |
| **多機管理** | 初期僅監控本機。若後續導入 Agent 模式（Roadmap #12），Metrics API 會加上 `?node=xxx` 參數，前端 Node Switcher 切換監控目標 |

---

## 7. 驗收檢查清單

### 後端 — 指標收集

- [ ] 後端啟動時自動啟動 metrics collector goroutine
- [ ] 每 5 秒收集一次 CPU / Memory / Disk / Network 指標（使用 gopsutil）
- [ ] 收集失敗時不中斷收集循環，僅記錄 error log
- [ ] 記憶體環形緩衝區正確保留最近 7 天資料
- [ ] 超過 7 天的舊資料自動淘汰
- [ ] 取樣間隔可透過設定檔調整

### 後端 — API

- [ ] `GET /api/v1/metrics/current` 回傳最新一次收集的所有指標即時值
- [ ] `GET /api/v1/metrics/history?range=1h` 回傳指定時間範圍的時序資料
- [ ] `range` 支援 15m / 1h / 6h / 24h / 7d
- [ ] `GET /api/v1/metrics/history?range=1h&since={timestamp}` 支援增量查詢（僅回傳新資料點）
- [ ] 超過 6 小時的查詢自動聚合（1 分鐘平均值）
- [ ] API 回應格式含 metric 類型、時間戳、數值、單位
- [ ] 所有 metrics API 需驗證登入狀態
- [ ] 指標收集模組未啟動時回傳 503 與明確錯誤訊息

### 前端 — 頁面佈局

- [ ] Header 導覽列有「Metrics」連結，點擊導航至 `/metrics`
- [ ] 首載顯示 4 個 skeleton 骨架屏區塊（脈衝動畫）
- [ ] 2x2 網格佈局：CPU（左上）/ Memory（右上）/ Disk（左下）/ Network（右下）
- [ ] 每個區塊包含即時值摘要 + 折線圖
- [ ] RWD：小螢幕時自動切換為單欄垂直排列
- [ ] 頁面右上角顯示自動更新狀態與間隔

### 前端 — CPU 指標

- [ ] 環形 gauge 顯示目前 CPU 使用率 %
- [ ] 折線圖顯示 user / system / iowait 三條線（顏色區分）
- [ ] 展開後顯示 per-core 折線圖
- [ ] 游標懸停顯示精確數值 tooltip（時間 + 各項數值）

### 前端 — Memory 指標

- [ ] 橫條圖顯示已用 / 可用 / 快取（顏色區分）
- [ ] 數值自動換算單位（MB / GB）
- [ ] 折線圖顯示 used / free / cached 趨勢
- [ ] 總記憶體容量顯示於區塊標題列

### 前端 — Disk 指標

- [ ] 甜甜圈圖顯示每個掛載點使用率 %
- [ ] 折線圖顯示每個掛載點使用率趨勢（每掛載點一條線）
- [ ] 自動排除 tmpfs / snap / squashfs 等虛擬掛載
- [ ] 使用率超過 90% 的掛載點以紅色標示

### 前端 — Network 指標

- [ ] 折線圖顯示 RX / TX bytes/sec（兩條線，顏色區分）
- [ ] 自動縮放單位（B/s → KB/s → MB/s）
- [ ] 展開後顯示 per-interface 流量明細
- [ ] 預設聚合所有實體介面（排除 lo）

### 前端 — 互動功能

- [ ] 時間範圍選擇器：15m / 1h / 6h / 24h / 7d
- [ ] 切換時間範圍後所有圖表同步更新
- [ ] 自動更新開關：開啟 / 暫停
- [ ] 更新間隔下拉：5s / 10s / 30s / 60s
- [ ] 點擊展開按鈕，該區塊展開至全寬
- [ ] 展開後可折疊回 2x2 佈局
- [ ] 瀏覽器 tab 隱藏時自動暫停輪詢
- [ ] tab 恢復顯示時自動拉取最新資料

### 前端 — 異常處理

- [ ] API 失敗時顯示錯誤訊息 + 重試按鈕
- [ ] 部分指標失敗不影響其他區塊
- [ ] 無歷史資料時顯示「資料收集中」空狀態
- [ ] 後端回應變慢時自動降級更新頻率 + Toast 提示
- [ ] 磁碟使用率 >90% 時視覺警示（紅色邊框）

### 整合

- [ ] Dashboard ↔ Metrics 頁面來回導航正常，狀態不遺失
- [ ] 長時間開啟儀表板（>1 小時）無記憶體洩漏
- [ ] 圖表動畫平滑，不閃爍
- [ ] 與現有主題（深色/淺色）相容，圖表顏色自動調整

### 效能

- [ ] 儀表板首次載入（含 API + 圖表渲染）< 2 秒
- [ ] 輪詢更新僅 append 新資料點，不觸發完整重繪
- [ ] 7 天範圍查詢回應時間 < 1 秒（含聚合）
- [ ] 前端記憶體用量穩定（無持續成長）

---

*最後更新：2025-08-09*
