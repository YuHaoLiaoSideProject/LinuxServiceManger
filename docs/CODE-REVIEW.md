# Code Review Report — T3: 代碼品質 & Bug

## 審查摘要
- 審查檔案數：30（17 Go backend + 5 TypeScript frontend + 8 supporting）
- 發現問題數：16 (🔴 Critical: 2 / 🟠 Major: 5 / 🟡 Moderate: 6 / 🟢 Minor: 3)

---

## 🔴 致命 (Critical)

- [ ] **C-01: HTTP Server 零逾時配置 — Slowloris DoS**
  - 檔案：`src/main.go:179`
  - 描述：`http.ListenAndServe(":"+port, r)` 使用預設 `http.Server`，所有逾時值為零（`ReadHeaderTimeout=0`, `ReadTimeout=0`, `WriteTimeout=0`, `IdleTimeout=0`）。攻擊者可透過 Slowloris 攻擊（極慢地發送 HTTP header）佔滿所有連線，使伺服器無法服務正常請求。
  - 觸發條件：攻擊者開啟數百個 TCP 連線並極慢地發送 HTTP header，即可耗盡連線池。
  - 建議修復：替換為顯式 `http.Server` 配置：
    ```go
    srv := &http.Server{
        Addr:              ":" + port,
        Handler:           r,
        ReadHeaderTimeout: 10 * time.Second,
        ReadTimeout:       30 * time.Second,
        WriteTimeout:      60 * time.Second,
        IdleTimeout:       120 * time.Second,
        MaxHeaderBytes:    1 << 20, // 1MB
    }
    log.Fatal(srv.ListenAndServe())
    ```

- [ ] **C-02: 無請求 Body 大小限制 — 記憶體耗盡 DoS**
  - 檔案：`src/internal/handler/json_handler.go:633`（HandleBatchServices）; `src/internal/handler/config_handler.go:112`（HandleSaveServiceConfig）; 多處 `json.NewDecoder(r.Body).Decode()`
  - 描述：所有 JSON API 端點使用 `json.NewDecoder(r.Body).Decode()` 讀取請求 body，無 `http.MaxBytesReader` 限制。攻擊者可發送數 GB 的 JSON body 使伺服器記憶體耗盡。特別是 `HandleSaveServiceConfig`：大小檢查 `if len(req.Config) > systemd.MaxConfigSize` 在 decode **之後**才執行，整個 body 已載入記憶體。
  - 觸發條件：`POST /api/v1/services/{name}/config` 發送含超大 `config` 欄位的 JSON；或 `POST /api/v1/services/batch` 發送巨型陣列。
  - 建議修復：在路由層或各 handler 開頭加入 body 大小限制：
    ```go
    r.Body = http.MaxBytesReader(w, r.Body, 1<<20) // 1MB 上限
    ```
    或在 `HandleSaveServiceConfig` 中，使用 `io.LimitedReader` 先讀取前 N bytes 做預檢。

---

## 🟠 嚴重 (Major)

- [ ] **M-01: Audit 日誌 username 系統性缺失 — Token 認證時永遠為空或 "system"**
  - 檔案：`src/internal/handler/node_handler.go:168-174`（HandleNodeAction）; `src/internal/handler/json_handler.go:183,207,232,257,282,307,687`（多處 action handler）; `src/internal/handler/config_handler.go:155`（writeConfigAudit）; `src/internal/handler/notify_handler.go:325`（writeNotifyAudit）
  - 描述：所有 audit 日誌寫入使用 `auth.GetSession(r).Values["username"].(string)` 提取操作者名稱。對於 Bearer Token 認證的請求，session 中沒有 username（middleware 只設定 `CtxKeyAuthMethod` 和 `CtxKeyTokenName`），導致 audit 日誌中 username 始終為空字串。`HandleNodeAction` 更使用 `r.Context().Value("username")`，該 key 從未被任何 middleware 設定，username 始終為 `"system"`。
  - 觸發條件：任何透過 API Token（非 session cookie）認證的操作（start/stop/restart/config save/channel create 等），audit 日誌中的 username 欄位為空。
  - 建議修復：建立共用函式從 context 正確提取 username：
    ```go
    func extractUsername(r *http.Request) string {
        // Try token name first
        if name, ok := r.Context().Value(middleware.CtxKeyTokenName).(string); ok && name != "" {
            return "token:" + name
        }
        // Fallback to session username
        session := auth.GetSession(r)
        if username, ok := session.Values["username"].(string); ok && username != "" {
            return username
        }
        return "unknown"
    }
    ```

- [ ] **M-02: nodemonitor 資料競態 — 未持有寫鎖修改 Node 狀態**
  - 檔案：`src/internal/nodemonitor/monitor.go:81-83`（scanNodes）; `monitor.go:104-107`（OnHeartbeat 週邊）; `monitor.go:118-125`（OnConnect）; `monitor.go:137-140`（OnDisconnect）
  - 描述：`OnConnect`、`OnDisconnect`、`scanNodes` 透過 `m.reg.Get(nodeID)` 取得 Node 指標後，**在鎖釋放後**直接修改 Node 欄位（`Status`、`OfflineSince`、`Hostname`、`AgentVersion` 等），而無持有寫鎖。同時 `SetRuntimeStatus` 和 `ApplyHeartbeat` 使用了正確的寫鎖。這種不一致性造成資料競態：HTTP handler 透過 `Registry.Get()`/`List()` 讀取 Node 時可能看到半寫入的狀態。
  - 觸發條件：heartbeat 到達與 HTTP 請求（如 `GET /api/v1/nodes`）同時發生時，可能讀取到不一致的 Node 狀態。
  - 建議修復：為 `nodemonitor` 新增 `Registry` 的原子更新方法，或在修改前取得寫鎖：
    ```go
    func (r *Registry) UpdateOnlineState(id string, hostname, version string, onlineSince time.Time) {
        r.mu.Lock()
        defer r.mu.Unlock()
        node, exists := r.nodes[id]
        if !exists { return }
        node.Hostname = hostname
        node.AgentVersion = version
        node.Status = StatusOnline
        node.OnlineSince = onlineSince
    }
    ```

- [ ] **M-03: Audit 日誌檔案權限 0644 — 全系統可讀**
  - 檔案：`src/internal/audit/audit.go:263`
  - 描述：`os.OpenFile(m.cfg.FilePath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)` 使審計日誌對所有使用者可讀。審計日誌包含使用者名稱、IP 位址、操作記錄等敏感資訊。
  - 觸發條件：任何能存取伺服器的使用者可讀取 `/var/lib/linux-service-manager/audit.jsonl`。
  - 建議修復：改為 `0640` 或 `0600`：
    ```go
    f, err := os.OpenFile(m.cfg.FilePath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0640)
    ```

- [ ] **M-04: 設定檔備份/還原固定使用 0644 — 丟失原始權限**
  - 檔案：`src/internal/systemd/config.go:242`（Backup）; `src/internal/systemd/config.go:320`（Restore）
  - 描述：`Backup()` 寫入備份檔時固定使用 `0644` 權限；`Restore()` 還原時也固定使用 `0o644`。原始設定檔可能為 `0600` 或 `0640`（例如由系統管理員設定），備份/還原週期後權限被放寬。
  - 觸發條件：任何 `PUT /api/v1/services/{name}/config` 操作後，備份檔為 0644；若寫入失敗觸發 Restore，原檔也變為 0644。
  - 建議修復：
    ```go
    // Backup: 保留原始權限
    func (s *ConfigStore) Backup(path string) (string, error) {
        content, err := os.ReadFile(path)
        ...
        mode := os.FileMode(0644)
        if info, err := os.Stat(path); err == nil {
            mode = info.Mode().Perm()
        }
        if err := os.WriteFile(backupPath, content, mode); err != nil { ... }
    }
    // Restore: 保留備份檔權限
    func (s *ConfigStore) Restore(backupPath, path string) error {
        content, err := os.ReadFile(backupPath)
        ...
        mode := os.FileMode(0644)
        if info, err := os.Stat(backupPath); err == nil {
            mode = info.Mode().Perm()
        }
        return os.WriteFile(path, content, mode)
    }
    ```

- [ ] **M-05: 錯誤訊息洩漏內部資訊至客户端**
  - 檔案：`src/internal/handler/nodes_handler.go:146,158,196,208,239,251`（HandleNodeServices, HandleNodeLogs, HandleNodeInfo）; `src/internal/handler/config_handler.go:82`
  - 描述：多處 `writeJSONError(w, http.StatusInternalServerError, err.Error())` 直接將底層錯誤訊息回傳給客户端。例如 RPC 錯誤、系統路徑、D-Bus 錯誤等內部資訊被暴露。`config_handler.go:82` 的 `writeJSON(w, http.StatusInternalServerError, messageJSON{Error: "無法讀取設定檔：" + err.Error()})` 也洩漏了檔案系統路徑。
  - 觸發條件：任何導致 500 錯誤的後端操作（RPC 失敗、檔案讀取失敗等）。
  - 建議修復：對外只回傳通用錯誤訊息，詳細錯誤寫入 log：
    ```go
    log.Printf("ERROR node services %s: %v", id, err)
    writeJSONError(w, http.StatusInternalServerError, "internal error")
    ```

---

## 🟡 中等 (Moderate)

- [ ] **P-01: Batch 操作 context timeout 無法取消進行中的服務操作**
  - 檔案：`src/internal/handler/json_handler.go:671-679`; `src/internal/systemd/systemd.go:228-245`
  - 描述：`HandleBatchServices` 使用 `context.WithTimeout(r.Context(), 60s)` 作為批次逾時，但 `StartService`/`StopService`/`RestartService` 各自建立獨立的 `context.WithTimeout(context.Background(), 30s)` context。批次逾時僅在操作之間的檢查點生效，無法取消正在執行的 systemctl 命令。若一個操作卡住 30 秒，即使批次已超時也無法中斷。
  - 觸發條件：某個 systemctl 操作卡住（如等待 dependent service），批次中已超時的剩餘操作仍會依序執行。
  - 建議修復：將批次 context 傳入 service 操作，或在操作前顯式檢查 `ctx.Err()`（目前已有，但操作內部未使用該 context）。

- [ ] **P-02: Audit/History 查詢全檔載入記憶體**
  - 檔案：`src/internal/audit/audit.go:344-401`（scanAndFilter）; `src/internal/notify/history.go:187-219`（scanAndFilter）
  - 描述：`scanAndFilter` 使用 `bufio.Scanner` 逐行讀取整個 JSONL 檔案至記憶體切片。Audit 檔案上限 100MB，History 檔案上限也由 Config 決定。在記憶體受限環境或高併發查詢時可能造成 OOM。
  - 觸發條件：多個用戶同時查詢 audit log（`GET /api/v1/audit`），每個查詢都載入完整 100MB 檔案至記憶體。
  - 建議修復：考慮使用索引檔或 B-tree 結構；短期可加入查詢並發限制。

- [ ] **P-03: notify/history.go scanAndFilter 使用 O(n²) 排序**
  - 檔案：`src/internal/notify/history.go:212-219`
  - 描述：使用巢狀迴圈做 bubble sort（`for i; for j`），時間複雜度 O(n²)。audit/audit.go 使用 `sort.Slice`（O(n log n)），不一致。
  - 觸發條件：History 記錄量大時（數萬筆），查詢效能顯著下降。
  - 建議修復：改用 `sort.Slice`：
    ```go
    sort.Slice(entries, func(i, j int) bool {
        return entries[i].Timestamp > entries[j].Timestamp
    })
    ```

- [ ] **P-04: Node ID 使用 UnixNano — 碰撞風險**
  - 檔案：`src/internal/noderegistry/registry.go:105`
  - 描述：`fmt.Sprintf("node-%d", r.now().UnixNano())` 使用納秒時間戳作為 Node ID。若兩個 Node 在同一納秒內建立（例如批量匯入），ID 會重複。
  - 觸發條件：高頻率建立 Node（如 API 自動化批量匯入）時，可能產生相同 ID。
  - 建議修復：使用 `crypto/rand` 生成 UUID，或在 timestamp 基礎上加入隨機 suffix。

- [ ] **P-05: WebSocket broadcast 阻塞風險**
  - 檔案：`src/internal/websocket/hub.go:99-106`
  - 描述：`Hub.Run()` 在 broadcast 時，若某個 client 的 Send channel 已滿（buffer 256），會嘗試將其加入 `Unregister` channel。若需清理的 dead client 數量超過 `channelBufferSize`（256），`h.Unregister <- client` 會阻塞，凍結整個 Hub event loop。
  - 觸發條件：大量客戶端同時斷線（如網路中斷），且 Send channel buffer 已滿。
  - 建議修復：使用 non-blocking send on Unregister：
    ```go
    select {
    case h.Unregister <- client:
    default:
        // Force close the client directly
        close(client.Send)
    }
    ```

- [ ] **P-06: `writeNodeAudit` / `writeConfigAudit` / `writeNotifyAudit` 對 Token 認證產生空 username**
  - 檔案：`src/internal/handler/node_handler.go:231`; `src/internal/handler/config_handler.go:155`; `src/internal/handler/notify_handler.go:325`
  - 描述：三個共用 audit 寫入函式均使用 `auth.GetSession(r).Values["username"].(string)` 提取 username。Bearer Token 認證時，session 中無 username 設定（middleware 僅設定 `CtxKeyAuthMethod` 和 `CtxKeyTokenName`），導致 username 為空字串。
  - 觸發條件：透過 API Token（非 session）進行的 config save、notify channel 操作、node 服務操作，audit 日誌中 username 為空。
  - 建議修復：同 M-01 的 `extractUsername` 共用函式。

---

## 🟢 輕微 (Minor)

- [ ] **L-01: 錯誤回應輔助函式不一致**
  - 檔案：`src/internal/handler/json_handler.go:62`（writeJSON）; `src/internal/handler/nodes_handler.go:465`（writeJSONError）; `src/internal/middleware/auth.go:85`（writeJSON）
  - 描述：存在三套 JSON 錯誤回應輔助函式：`handler.writeJSON`、`handler.writeJSONError`、`middleware.writeJSON`。`nodes_handler.go` 使用 `writeJSONError`，其他 handler 使用 `writeJSON`。`middleware.writeJSON` 是 handler 的複製品。
  - 建議修復：統一為一個共用函式。

- [ ] **L-02: token.Store.List() 使用 O(n²) bubble sort**
  - 檔案：`src/internal/token/token.go:332-339`
  - 描述：使用巢狀迴圈排序。雖然 `MaxActiveTokens=20` 使影響微乎其微，但與 audit 使用 `sort.Slice` 的慣例不一致。
  - 建議修復：改用 `sort.Slice`。

- [ ] **L-03: HandleAgentBinary 將整個 binary 載入記憶體**
  - 檔案：`src/internal/handler/nodes_handler.go:445-453`
  - 描述：`os.ReadFile(binaryPath)` 將整個 agent binary（~10-20MB）載入記憶體後寫入 response。可使用 `io.Copy(w, f)` 直接串流。
  - 建議修復：
    ```go
    f, err := os.Open(binaryPath)
    if err != nil { ... }
    defer f.Close()
    w.Header().Set("Content-Type", "application/octet-stream")
    w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, binaryName))
    io.Copy(w, f)
    ```

---

## ✅ 無問題區段

| 區段 | 審查結果 |
|------|----------|
| **systemd command injection 防護** | ✅ 所有 `exec.Command` 參數均來自 validated service name（正則 `^[a-zA-Z0-9][a-zA-Z0-9:@_.\-]*\.service$`）或固定字串，無使用者輸入直接拼接。 |
| **Config path traversal 防護** | ✅ `ValidatePath` 使用 `filepath.Clean` + `filepath.Rel` 雙重驗證，`ValidateSymlink` 解析 symlink 後確認仍在 `/etc/systemd/system/` 內。 |
| **WebSocket Origin 檢查** | ✅ `CheckOrigin()` 預設拒絕帶 Origin header 的瀏覽器請求（安全預設），僅允許無 Origin 的非瀏覽器客戶端。 |
| **Token 安全儲存** | ✅ Token 以 SHA-256 hash 儲存，原始值僅在建立時回傳一次；node token 比對使用 `crypto/subtle.ConstantTimeCompare` 防止 timing attack。 |
| **Session fixation 防護** | ✅ gorilla/sessions 在 `session.Save()` 時自動重新產生 session ID。 |
| **Service name 驗證** | ✅ 正則嚴格限制為 `.service` 結尾的合法 systemd unit name，所有 handler 均有驗證。 |
| **Rate limiting** | ✅ Login 端點有 5 次/分鐘/IP 限制；Agent WebSocket 有 5 連線/分鐘/IP 限制。 |
| **Config 並發衝突偵測** | ✅ SHA-256 checksum + baseChecksum 機制正確實作，409 衝突回應含 currentChecksum 供前端重新載入。 |
| **atomic write** | ✅ Config write、token save、channel save 均使用 temp + fsync + rename 原子寫入策略。 |
| **前端 API client** | ✅ 正確使用 `withCredentials`、`encodeURIComponent` 編碼 URL 參數、401 攔截器重設 auth 狀態。 |
| **WebSocket 連線管理** | ✅ 每個 user 限 5 連線、30 分鐘 TTL 過期、logout 時 `KillByUser` 清理所有連線、ping/pong keepalive。 |
| **前端 WebSocket reconnection** | ✅ 指數退避重連（max 30s）、45s heartbeat timeout、`onUnmounted` 正確斷線。 |
| **TLS 指紋 pinning** | ✅ `InsecureSkipVerify: true` 搭配 `VerifyPeerCertificate` callback 比對 SHA-256 SPKI 指紋（空指紋 = encrypt-only 模式，為設計決策 SYS-TLS-03）。 |

---

**Outcome: OK** — 已完成代碼品質審查。

**文件路徑**：`docs/CODE-REVIEW.md`

**重點摘要**：
1. 🔴 **C-01/C-02**：HTTP Server 缺逾時配置 + 無 body 大小限制 → DoS 風險，建議優先修復
2. 🟠 **M-01**：Audit 日誌對 Token 認證請求的 username 系統性缺失，影響稽核追溯能力
3. 🟠 **M-02**：nodemonitor 多處修改 Node 狀態未持鎖，存在資料競態
4. 🟠 **M-03/M-04**：檔案權限過寬（audit 0644、備份/還原 0644），應收緊至 0640/0600
5. 🟠 **M-05**：多處 500 錯誤直接將底層錯誤訊息暴露給客户端
6. 整體代碼品質良好：命令注入防護、路徑遍歷防護、Token 安全儲存、WebSocket 管理、前端 API client 等核心安全機制均已正確實作
