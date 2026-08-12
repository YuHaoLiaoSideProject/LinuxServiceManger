# 服務設定檔編輯器 — 開發規格

> **對應 Roadmap**：Phase 3 — `docs/development/002-expansion-roadmap.md` 項目 #9
> **技術決策**：`docs/tech-decisions/012-service-config-editor.md`
> **操作流程**：`docs/interaction-flows/012-service-config-editor.md`
> **BDD**：`docs/bdds/012-service-config-editor.feature`
> **測試計畫**：`docs/test-plans/012-service-config-editor測試計畫.md`
> **狀態**：設計完成，待開發

---

## 概述

讓已登入管理員在 Web UI 中直接檢視與編輯 `/etc/systemd/system/` 下的自訂 service unit file，透過「編輯 → 語法驗證 → 變更確認儲存」三步驟工作流降低人為錯誤，所有檢視與儲存操作寫入 audit log，不需 SSH 進機器。核心包含：

1. **後端 ConfigStore（`internal/systemd/config.go`）**：FragmentPath 查詢、讀取與 checksum、`/etc/systemd/system/` 路徑邊界驗證（含 symlink 防護）、備份保留 5 份、atomic write、寫入失敗還原
2. **後端語法驗證（`internal/systemd/config_validate.go`）**：`systemd-analyze verify` 暫存檔驗證、輸出行號解析、10 秒逾時、`available:false` 降級
3. **後端 Config Handler（`internal/handler/config_handler.go`）**：`GET/PUT /api/v1/services/{name}/config` + `POST .../config/validate` 三端點、checksum 409 衝突偵測、audit `config_view` / `config_save`
4. **前端 UnitFileEditor.vue**：**CodeMirror 6** 封裝元件（INI 語法高亮、行號、錯誤波浪線/gutter 標記、深淺主題 compartment、readOnly）
5. **前端 useConfigEditor composable**：dirty state（內容比對）、baseChecksum 基準、載入/驗證/儲存流程
6. **前端 ConfigEditorView.vue**：載入/錯誤/404 三態、驗證面板（綠/紅/黃）、儲存 ConfirmModal、dirty 三層防護（route guard + 頁內 Modal + beforeunload）
7. **進入點整合**：ServiceRow「Edit Config / View Config」按鈕、router lazy-load 新路由、PWA precache 納入編輯器 chunk

> **技術裁決重點（以 Tech Decision 為準，與 BDD 不一致處一律依此）**：
> - 編輯器採用 **CodeMirror 6**（BDD / interaction flow 的 Monaco 描述全部改為 CodeMirror 對應設定）
> - **GET 鎖定服務回 200 唯讀檢視**（403 僅適用於 PUT 寫入）
> - **systemd-analyze 不可用回 `200 {valid:false, available:false}`**（非 500 crash）
> - **daemon-reload 失敗不還原設定檔**（僅「檔案寫入失敗」才還原備份）
> - 並發衝突以 **checksum 比對（PUT 帶 `baseChecksum`，不符回 409）**，不實作悲觀鎖定
> - JSON 欄位一律 **camelCase**（`fragmentPath` / `backupPath` / `baseChecksum` / `currentChecksum`）

---

## 1. 後端實作規格

### 1.1 依賴新增

零外部依賴。全部使用 Go 標準庫（`crypto/sha256`、`encoding/hex`、`encoding/json`、`os/exec`、`path/filepath`、`regexp`、`time`、`context`、`sync`、`crypto/rand`）。既有 `exec.CommandContext` / `exec.LookPath` mock 變數沿用 `internal/systemd` 既有 pattern（`execCommandContext` / `lookPath`）。

### 1.2 檔案改動總覽

```
src/
├── main.go                                  ← 修改：/api/v1/services 群組內註冊 3 條 config 路由
├── internal/
│   ├── systemd/
│   │   ├── config.go                        ← 新增：ConfigStore（讀取/checksum/路徑驗證/備份/atomic write/daemon-reload）
│   │   ├── config_validate.go               ← 新增：systemd-analyze 暫存檔驗證 + 輸出解析
│   │   └── config_test.go                   ← 新增：SYS-01 ~ SYS-46 單元測試
│   ├── handler/
│   │   ├── config_handler.go                ← 新增：HandleGetServiceConfig / HandleSaveServiceConfig / HandleValidateServiceConfig
│   │   └── config_handler_test.go           ← 新增：HDL-01 ~ HDL-30 handler 測試（httptest + temp dir）
│   └── audit/
│       └── audit.go                         ← 修改：新增 ActionConfigView / ActionConfigSave + display labels
```

不改動：`ServiceManager` interface、既有 start/stop/restart/enable/disable/batch handler、`isLocked()`、middleware、反向代理與部署腳本。

### 1.3 ConfigStore 模組（`internal/systemd/config.go`）

**職責**：unit file 的讀取、checksum 計算、路徑安全驗證（決策 5 完整驗證鏈）、備份/清理（決策 3）、atomic write、daemon-reload。與既有套件風格一致，以 struct + 可注入欄位設計（handler 持有實例，測試可替換 mock）。

```go
// Package systemd — config.go（新增至 linux-service-manager/internal/systemd）

const (
    // MaxConfigSize 是 unit file 讀取/寫入的大小上限（500KB）。
    MaxConfigSize = 500 * 1024
    // BackupKeepCount 是同目錄備份檔保留份數（含本次最新）。
    BackupKeepCount = 5
    // DaemonReloadTimeout 是 systemctl daemon-reload 的逾時（秒）。
    DaemonReloadTimeout = 10 * time.Second
    // SystemdSystemDir 是可編輯 unit file 的唯一根目錄。
    SystemdSystemDir = "/etc/systemd/system"
)

// 可注入函式（測試替換用，沿用 execCommandContext / lookPath pattern）
var (
    fragmentPathOf = func(ctx context.Context, name string) (string, error) {
        // systemctl show -p FragmentPath --value {name} → strings.TrimSpace
        // TODO: exec.CommandContext + Output
    }
)

// ConfigStore 提供 service unit file 的讀寫安全操作。
type ConfigStore struct {
    // 目前無需狀態；保留 struct 以便未來注入檔案系統/mock。
}

func NewConfigStore() *ConfigStore { return &ConfigStore{} }

// FragmentPathOf 以 systemctl show 查詢單一服務的 FragmentPath（信任來源為 systemd，非用戶端）。
func (s *ConfigStore) FragmentPathOf(name string) (string, error) { /* TODO */ }

// ServiceConfig 是 GET /config 的回應資料（含 checksum 供 PUT baseChecksum）。
type ServiceConfig struct {
    Name         string
    FragmentPath string
    Content      string
    Size         int64
    Checksum     string // SHA-256 hex（64 字元小寫）
}

// 錯誤哨兵值（handler 對映為 HTTP 狀態碼）
var (
    ErrConfigPathEmpty  = errors.New("設定檔路徑不存在")
    ErrConfigNotFound   = errors.New("設定檔不存在")
    ErrConfigTooLarge   = errors.New("設定檔超過 500KB 大小限制")
    ErrPathNotAllowed   = errors.New("不允許編輯此服務設定檔")
    ErrWriteFailed      = errors.New("寫入失敗")
    ErrConflict         = errors.New("設定檔已被其他使用者修改。請重新載入後再編輯。")
)

// ReadConfig 讀取 fragmentPath 指向的檔案並回傳內容/大小/checksum。
// 規則：path 為空 → ErrConfigPathEmpty；檔案不存在 → ErrConfigNotFound；
//       size > MaxConfigSize → ErrConfigTooLarge（413）；讀取失敗 → 包裝底層錯誤（500，含權限原因）。
func (s *ConfigStore) ReadConfig(name, path string) (*ServiceConfig, error) { /* TODO */ }

// ComputeChecksum 計算內容的 SHA-256 hex。
func (s *ConfigStore) ComputeChecksum(content string) string { /* sha256.Sum256 + hex.EncodeToString */ }

// currentChecksumOf 計算磁碟上現行檔的 checksum；檔案不存在回傳 ""（允許重建）。
func (s *ConfigStore) currentChecksumOf(path string) (string, error) { /* TODO */ }

// ValidatePath 驗證 path 確實在 /etc/systemd/system/ 下（決策 5 步驟 3）。
// 以 filepath.Clean + filepath.Rel 判斷（非 strings.HasPrefix，擋 /etc/systemd/system-evil 旁路）。
func (s *ConfigStore) ValidatePath(path string) error { /* TODO */ }

// ValidateExt 驗證副檔名為 .service（僅 .service 可寫入，.timer/.socket 不可）。
func (s *ConfigStore) ValidateExt(path string) error { /* TODO */ }

// ValidateSymlink 對存在的目標檔執行 EvalSymlinks；不存在時對 parent 目錄執行。
// 解析結果必須仍在 /etc/systemd/system/ 下（防 foo.service -> /etc/passwd 覆寫）。
func (s *ConfigStore) ValidateSymlink(path string) error { /* TODO */ }

// assertWritablePath 組合以上三者（Clean+Rel 邊界 / .service 副檔名 / symlink）— PUT 寫入前必調。
func (s *ConfigStore) assertWritablePath(path string) error { /* TODO */ }

// Backup 將現行檔 copy 為 {base}.bak.{20060102T150405Z}（UTC compact RFC3339，固定寬度，字典序=時間序）。
// copy 而非 rename — 現行檔必須保留原位供 atomic rename 覆蓋。
func (s *ConfigStore) Backup(path string) (string, error) { /* TODO */ }

// PruneBackups 以 {name}.service.bak. prefix glob 同目錄，字串降冪排序，保留前 keep 份刪除其餘。
func (s *ConfigStore) PruneBackups(path string, keep int) error { /* TODO */ }

// AtomicWrite 以 temp + chmod(保留原檔 mode，預設 0644) + fsync + rename 覆寫目標檔。
// rename 同目錄內為原子操作，失敗時原檔完好。
func (s *ConfigStore) AtomicWrite(path, content string) error { /* TODO */ }

// Restore 以備份檔還原原路徑（僅「寫入失敗」時呼叫）。
func (s *ConfigStore) Restore(backupPath, path string) error { /* TODO */ }

// CheckConflict 比對現行檔 checksum 與 baseChecksum：
// 檔案存在但 baseChecksum 為空 → ErrConflict（缺省視為衝突，防舊前端繞過，handler 層回 400）；
// 檔案不存在 → 視為「建立新檔」，跳過比對（對應 BDD 404 後可重建）；
// checksum 不一致 → 回 ErrConflict，並以 %w 包裝 ErrConflictCurrent{Current string} 附現行值。
type ErrConflictCurrent struct{ Current string }
func (s *ConfigStore) CheckConflict(path, baseChecksum string) error { /* TODO */ }

// DaemonReload 執行 systemctl daemon-reload，10 秒逾時（逾時視為失敗）。
func (s *ConfigStore) DaemonReload(ctx context.Context) error {
    // exec.CommandContext(ctx, "systemctl", "daemon-reload") with DaemonReloadTimeout
    // TODO: ctx.Err() == DeadlineExceeded → 回傳「daemon-reload 逾時」錯誤
}
```

**並發模型**：ConfigStore 為無狀態函式集合，不持 shared mutable state；同服務並發 PUT 由「檔案系統 + checksum 比對」保證 last-write-wins 語意（決策 4，不實作鎖）。atomic write 的 temp 檔名含 `rand` 避免碰撞；備份 prune 的 glob+rename 在單檔操作層級原子。

### 1.4 語法驗證模組（`internal/systemd/config_validate.go`）

**職責**：接收編輯內容 → 寫入 `/tmp/lsm-validate-{uuid}.service`（0600）→ `systemd-analyze verify`（10s 逾時）→ 解析輸出為 `{line, message}` → `defer os.Remove` 刪除暫存。**systemd-analyze 不存在時不視為 500**，回 `available:false`（決策 2 / D-3）。

```go
// Package systemd — config_validate.go（新增至 linux-service-manager/internal/systemd）

const (
    ValidateTimeout = 10 * time.Second
    // tmpFileMode 是驗證暫存檔的權限（0600，避免敏感內容被其他使用者讀取）。
    tmpFileMode = 0o600
)

// ValidateError 是單筆語法錯誤（含行號）。
type ValidateError struct {
    Line    int    `json:"line"`
    Message string `json:"message"`
}

// ValidateResult 是 POST /config/validate 的回應體。
// Available=false 代表 systemd-analyze 不可用（前端顯示黃色警告，不阻塞儲存）。
type ValidateResult struct {
    Valid     bool            `json:"valid"`
    Available bool            `json:"available"`
    Errors    []ValidateError `json:"errors"`
    Message   string          `json:"message,omitempty"`
}

// analyzeVerifyErrRe 解析 systemd-analyze 輸出：{path}:{line}: {message}
var analyzeVerifyErrRe = regexp.MustCompile(`^[^:]+:(\d+):\s*(.+)$`)

// ValidateConfig 驗證 unit file 內容語法（決策 2 方案 A）。
func (s *ConfigStore) ValidateConfig(content string) (*ValidateResult, error) {
    // 1. exec.LookPath("systemd-analyze") 失敗 → 回 &ValidateResult{Valid:false, Available:false,
    //    Message:"systemd-analyze 指令不存在，無法進行語法驗證"}（非 error，200 回應）
    // 2. uuid := ...; tmp := "/tmp/lsm-validate-" + uuid + ".service"
    //    os.WriteFile(tmp, []byte(content), tmpFileMode) 失敗 → error（handler 回 500，
    //    message:「無法建立暫存檔進行驗證。請檢查 /tmp 目錄空間與權限。」）
    //    defer os.Remove(tmp)  ← 保證成功/失敗/逾時路徑皆清理
    // 3. ctx 10s timeout; exec.CommandContext(ctx, "systemd-analyze", "verify", tmp)
    // 4. exit code 0 → &ValidateResult{Valid:true, Available:true, Errors:[]}
    //    （僅含警告但 exit 0 視為通過 — BDD @edge-case「警告不構成失敗」）
    // 5. 非 0 → 逐行以 analyzeVerifyErrRe 萃取 {line, message}；不可解析行 → 原始輸出為 message
    // 6. ctx.Err() == DeadlineExceeded → 視為失敗並 kill process
    // TODO: 完整實作
}
```

### 1.5 Config Handler（`internal/handler/config_handler.go`）

**職責**：三端點的 HTTP 層：參數/body 驗證、呼叫 ConfigStore、寫 audit log、錯誤碼對映。沿用既有 `writeJSON` / `messageJSON` helper。

```go
// Package handler — config_handler.go（新增至 linux-service-manager/internal/handler）
import (
    "linux-service-manager/internal/systemd"
    "linux-service-manager/internal/audit"
)

// ============================================================
//  Config API 資料型別（camelCase，依測試計畫 D-7）
// ============================================================

// ServiceConfigResponse 是 GET /api/v1/services/{name}/config 的回應體。
type ServiceConfigResponse struct {
    Name         string `json:"name"`
    FragmentPath string `json:"fragmentPath"`
    Config       string `json:"config"`
    Size         int64  `json:"size"`
    Checksum     string `json:"checksum"` // SHA-256 hex，供 PUT baseChecksum
}

// SaveConfigRequest 是 PUT /api/v1/services/{name}/config 的請求體。
type SaveConfigRequest struct {
    Config       string `json:"config"`
    BaseChecksum string `json:"baseChecksum"` // GET 回傳的 checksum，必填（檔案存在時）
}

// SaveConfigResponse 是 PUT 的回應體（成功或 reload 半成功皆含 backupPath）。
type SaveConfigResponse struct {
    Message    string `json:"message"`
    BackupPath string `json:"backupPath"` // 例: /etc/systemd/system/nginx.service.bak.20260812T153045Z
}

// conflictResponse 是 PUT 409 的回應體（含現行 checksum 供前端重新載入更新基準）。
type conflictResponse struct {
    Error            string `json:"error"`
    CurrentChecksum string `json:"currentChecksum"`
}

// ============================================================
//  GET /api/v1/services/{name}/config
// ============================================================

// HandleGetServiceConfig 讀取服務 FragmentPath 內容（唯讀檢視，鎖定服務亦可讀，依 D-2）。
func (h *Handler) HandleGetServiceConfig(w http.ResponseWriter, r *http.Request) {
    name := chi.URLParam(r, "name")
    if err := systemd.ValidateServiceName(name); err != nil {
        writeJSON(w, http.StatusBadRequest, messageJSON{Error: "invalid service name"}); return
    }

    path, err := h.config.FragmentPathOf(name)     // systemctl show（信任來源）
    if err != nil || path == "" {
        writeJSON(w, http.StatusNotFound, messageJSON{Error: "設定檔路徑不存在"}); return
    }
    // 註：GET 不檢查路徑邊界（鎖定服務/ /usr/lib 亦允許唯讀檢視，決策 5 / D-2）
    cfg, err := h.config.ReadConfig(name, path)
    switch {
    case errors.Is(err, systemd.ErrConfigNotFound):
        writeJSON(w, http.StatusNotFound, messageJSON{Error: "設定檔不存在: " + path}); return
    case errors.Is(err, systemd.ErrConfigTooLarge):
        writeJSON(w, http.StatusRequestEntityTooLarge, messageJSON{Error: err.Error()}); return
    case err != nil:
        // 權限不足等讀取失敗 → 500，錯誤訊息保留底層原因（含「權限」字樣）
        log.Printf("ERROR reading config %s: %v", name, err)
        writeJSON(w, http.StatusInternalServerError, messageJSON{Error: "無法讀取設定檔：" + err.Error()}); return
    }

    // Audit: config_view（鎖定服務唯讀檢視亦記錄）
    h.writeConfigAudit(r, audit.ActionConfigView, name, cfg.FragmentPath, audit.ResultSuccess, "")

    writeJSON(w, http.StatusOK, ServiceConfigResponse{
        Name: cfg.Name, FragmentPath: cfg.FragmentPath,
        Config: cfg.Content, Size: cfg.Size, Checksum: cfg.Checksum,
    })
}

// ============================================================
//  PUT /api/v1/services/{name}/config
// ============================================================

// HandleSaveServiceConfig 儲存設定檔：備份 → 衝突檢查 → atomic write → daemon-reload → audit。
func (h *Handler) HandleSaveServiceConfig(w http.ResponseWriter, r *http.Request) {
    name := chi.URLParam(r, "name")
    if err := systemd.ValidateServiceName(name); err != nil {
        writeJSON(w, http.StatusBadRequest, messageJSON{Error: "invalid service name"}); return
    }

    // 1. FragmentPath（信任來源 systemd）
    path, err := h.config.FragmentPathOf(name)
    if err != nil || path == "" {
        writeJSON(w, http.StatusNotFound, messageJSON{Error: "設定檔路徑不存在"}); return
    }

    // 2. 寫入權威驗證鏈（決策 5）：Clean+Rel 邊界 + .service 副檔名 + symlink 解析
    if err := h.config.assertWritablePath(path); err != nil {
        writeJSON(w, http.StatusForbidden, messageJSON{Error: "不允許編輯此服務設定檔"}); return
    }

    // 3. 解碼 body；baseChecksum 必填（檔案存在時）— 防舊前端/腳本繞過衝突偵測
    var req SaveConfigRequest
    if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
        writeJSON(w, http.StatusBadRequest, messageJSON{Error: "invalid request body"}); return
    }
    if len(req.Config) > systemd.MaxConfigSize {
        writeJSON(w, http.StatusRequestEntityTooLarge, messageJSON{Error: "設定檔超過 500KB 大小限制"}); return
    }

    // 4. 並發衝突偵測（決策 4）：409 + currentChecksum
    if err := h.config.CheckConflict(path, req.BaseChecksum); err != nil {
        if c, ok := unwrapConflict(err); ok {
            writeJSON(w, http.StatusConflict, conflictResponse{Error: err.Error(), CurrentChecksum: c}); return
        }
        writeJSON(w, http.StatusBadRequest, messageJSON{Error: "base_checksum is required"}); return // 缺省
    }

    // 5. 備份（copy）+ prune 保留 5 份
    backupPath, err := h.config.Backup(path)
    if err != nil { writeJSON(w, http.StatusInternalServerError, messageJSON{Error: "建立備份失敗"}); return }
    _ = h.config.PruneBackups(path, systemd.BackupKeepCount) // prune 失敗僅記錄（非阻斷）

    // 6. atomic write — 失敗 → 還原備份 → 500「寫入失敗」（決策 D-5）
    if err := h.config.AtomicWrite(path, req.Config); err != nil {
        if rbErr := h.config.Restore(backupPath, path); rbErr != nil {
            log.Printf("ERROR restore backup %s → %s: %v", backupPath, path, rbErr)
        }
        h.writeConfigAudit(r, audit.ActionConfigSave, name, path, audit.ResultFailure, "寫入失敗")
        writeJSON(w, http.StatusInternalServerError, messageJSON{Error: "寫入失敗"})
        return
    }

    // 7. daemon-reload — 失敗「不還原」（決策 D-4），回 500 + backupPath（半成功）
    ctx, cancel := context.WithTimeout(r.Context(), systemd.DaemonReloadTimeout)
    defer cancel()
    if err := h.config.DaemonReload(ctx); err != nil {
        detail := fmt.Sprintf("設定檔已寫入，daemon-reload 失敗: %v; backup=%s", err, backupPath)
        h.writeConfigAudit(r, audit.ActionConfigSave, name, path, audit.ResultSuccess, detail) // 半成功，audit result=success
        writeJSON(w, http.StatusInternalServerError, map[string]interface{}{
            "error":      "設定檔已儲存，但 daemon-reload 失敗: " + err.Error() + "。請手動執行 systemctl daemon-reload。備份檔：" + backupPath,
            "backupPath": backupPath,
        })
        return
    }

    // 8. 成功 + audit
    h.writeConfigAudit(r, audit.ActionConfigSave, name, path, audit.ResultSuccess, backupPath)
    writeJSON(w, http.StatusOK, SaveConfigResponse{
        Message:    name + " 設定檔已儲存，daemon-reload 已執行",
        BackupPath: backupPath,
    })
}

// ============================================================
//  POST /api/v1/services/{name}/config/validate
// ============================================================

// HandleValidateServiceConfig 以 systemd-analyze verify 驗證 body 內容。
// systemd-analyze 不存在 → 200 {valid:false, available:false}（決策 D-3，非 500）。
func (h *Handler) HandleValidateServiceConfig(w http.ResponseWriter, r *http.Request) {
    name := chi.URLParam(r, "name")
    if err := systemd.ValidateServiceName(name); err != nil {
        writeJSON(w, http.StatusBadRequest, messageJSON{Error: "invalid service name"}); return
    }

    var req struct{ Config string `json:"config"` }
    if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
        writeJSON(w, http.StatusBadRequest, messageJSON{Error: "invalid request body"}); return
    }

    result, err := h.config.ValidateConfig(req.Config)
    if err != nil {
        // 暫存檔建立失敗等 → 500（訊息提示檢查 /tmp 空間與權限）
        log.Printf("ERROR validating config %s: %v", name, err)
        writeJSON(w, http.StatusInternalServerError, messageJSON{Error: "無法建立暫存檔進行驗證。請檢查 /tmp 目錄空間與權限。"})
        return
    }
    writeJSON(w, http.StatusOK, result)
}

// writeConfigAudit 共用 audit 寫入（操作者/IP 取自 request）。
func (h *Handler) writeConfigAudit(r *http.Request, action audit.Action, name, target string, result audit.Result, detail string) { /* TODO */ }
```

### 1.6 Audit 整合（`internal/audit/audit.go`）

```go
const (
    ActionConfigView Action = "config_view" // GET config 成功時（含鎖定服務唯讀檢視）
    ActionConfigSave Action = "config_save" // PUT 成功（含 reload 失敗已寫入之半成功）
)
// validActions 新增兩者；actionDisplayLabels 新增：
//   ActionConfigView: "檢視設定檔"
//   ActionConfigSave: "儲存設定檔"
```

### 1.7 路由註冊（`src/main.go`）

```go
// 在既有 AuthMiddlewareComposite 保護的 /api/v1/services 群組內新增：
r.Get("/api/v1/services/{name}/config", h.HandleGetServiceConfig)
r.Put("/api/v1/services/{name}/config", h.HandleSaveServiceConfig)
r.Post("/api/v1/services/{name}/config/validate", h.HandleValidateServiceConfig)
// Handler struct 新增欄位：Config *systemd.ConfigStore（在 New() 或 main 初始化，
// nil 時 handler 以 systemd.NewConfigStore() 惰性建立）
```

---

## 2. 前端實作規格

### 2.1 檔案改動總覽

```
frontend/
├── package.json                          ← 修改：新增 7 個 CodeMirror 6 ESM 依賴
├── src/
│   ├── types/service.ts                  ← 修改：新增 ServiceConfigResponse / SaveConfigRequest / SaveConfigResponse / ValidateResponse / ValidateError
│   ├── api/client.ts                     ← 修改：新增 getServiceConfig / saveServiceConfig / validateServiceConfig
│   ├── composables/
│   │   ├── useConfigEditor.ts            ← 新增：dirty state / baseChecksum / load / verify / save / beforeunload
│   │   └── useI18n.ts                    ← 修改：新增 config 相關翻譯鍵（編輯/檢視/驗證/儲存/關閉/提示文案）
│   ├── components/
│   │   ├── UnitFileEditor.vue            ← 新增：CodeMirror 6 封裝（INI 高亮、行號、標記、主題、readOnly）
│   │   ├── ConfirmModal.vue              ← 修改：新增可選 title / cancelLabel / confirmLabel / confirmClass props（向後相容）
│   │   └── ServiceRow.vue                ← 修改：Actions 區域新增「Edit Config / View Config」按鈕
│   ├── views/
│   │   └── ConfigEditorView.vue          ← 新增：載入/驗證面板/儲存流程/dirty guard 三層
│   └── router/index.ts                   ← 修改：新增 /services/:name/config（lazy-load，meta.auth）
```

### 2.2 依賴新增（`frontend/package.json`）

```bash
npm install codemirror @codemirror/state @codemirror/view @codemirror/language \
            @codemirror/commands @codemirror/search @codemirror/legacy-modes
```

全部為可 tree-shake 的 ESM 套件（決策 1）；CodeMirror 無 web worker 依賴，動態 import 乾淨。編輯器核心約 ~130KB gzip，由 Vite code-splitting 拆為獨立 chunk，PWA `globPatterns`（`**/*.js`）自動 precache。

### 2.3 型別與 API client（`types/service.ts` / `api/client.ts`）

```typescript
// types/service.ts — 新增
export interface ServiceConfigResponse {
  name: string
  fragmentPath: string
  config: string
  size: number
  checksum: string
}
export interface SaveConfigRequest {
  config: string
  baseChecksum: string
}
export interface SaveConfigResponse {
  message: string
  backupPath: string
}
export interface ValidateError {
  line: number
  message: string
}
export interface ValidateResponse {
  valid: boolean
  available: boolean // false = systemd-analyze 不可用（黃色警告）
  errors: ValidateError[]
  message?: string
}

// api/client.ts — 新增（沿用既有 encodeURIComponent pattern；JSON body 需覆蓋 Content-Type header）
export async function getServiceConfig(name: string): Promise<ServiceConfigResponse> {
  const { data } = await api.get<ServiceConfigResponse>(`/services/${encodeURIComponent(name)}/config`)
  return data
}
export async function saveServiceConfig(name: string, req: SaveConfigRequest): Promise<SaveConfigResponse> {
  const { data } = await api.put<SaveConfigResponse>(`/services/${encodeURIComponent(name)}/config`, req, {
    headers: { 'Content-Type': 'application/json' },
  })
  return data
}
export async function validateServiceConfig(name: string, config: string): Promise<ValidateResponse> {
  const { data } = await api.post<ValidateResponse>(`/services/${encodeURIComponent(name)}/config/validate`,
    { config }, { headers: { 'Content-Type': 'application/json' } })
  return data
}
// 409 衝突：axios error.response.status === 409，error.response.data.currentChecksum 供重新載入流程使用
```

### 2.4 useConfigEditor composable

**職責**：編輯器頁面的單一狀態來源 — 載入、dirty state（內容比對，非 flag 累計）、baseChecksum 基準、驗證結果、儲存流程、`beforeunload` 註冊。

```typescript
// composables/useConfigEditor.ts
import { ref, computed, readonly } from 'vue'
import { getServiceConfig, saveServiceConfig, validateServiceConfig } from '../api/client'
import type { ServiceConfigResponse, ValidateResponse } from '../types/service'

export type EditorStatus = 'loading' | 'ready' | 'error' | 'not-found'
export type ValidateKind = 'success' | 'failure' | 'unavailable' | 'error' | null

export function useConfigEditor(serviceName: string) {
  const initialContent = ref('')          // GET 回傳之原始內容（dirty 比對基準）
  const content = ref('')                 // 目前編輯內容（v-model 到 UnitFileEditor）
  const baseChecksum = ref('')            // GET 回傳 checksum；409 重新載入後更新
  const fragmentPath = ref('')
  const size = ref(0)
  const status = ref<EditorStatus>('loading')
  const errorMessage = ref<string | null>(null)
  const validation = ref<ValidateResponse | null>(null)
  const validationKind = ref<ValidateKind>(null)
  const isVerifying = ref(false)
  const isSaving = ref(false)

  // dirty = 目前內容 ≠ 初始內容（內容還原回原始即回 clean，F-CE-03）
  const isDirty = computed(() => content.value !== initialContent.value)
  // 檔案超過 500KB 效能提示（防禦性 UI，正常由 GET 413 攔截，測試以 mock 驗證）
  const isLargeFile = computed(() => size.value > 500 * 1024)

  async function load(): Promise<void> {
    status.value = 'loading'
    errorMessage.value = null
    validation.value = null
    try {
      const res = await getServiceConfig(serviceName)
      initialContent.value = res.config
      content.value = res.config
      baseChecksum.value = res.checksum
      fragmentPath.value = res.fragmentPath
      size.value = res.size
      status.value = 'ready'
    } catch (e: any) {
      if (e?.response?.status === 404) {
        // 設定檔不存在 → 空編輯器 + 黃色提示，仍可輸入內容儲存（重建）
        initialContent.value = ''
        content.value = ''
        baseChecksum.value = ''
        status.value = 'not-found'
      } else {
        status.value = 'error'
        errorMessage.value = e?.response?.data?.error || '載入設定檔失敗'
      }
    }
  }

  function setContent(v: string) {
    content.value = v
    // 內容變更 → 自動清除先前驗證結果（BDD：舊驗證失效）
    if (isDirty.value) clearValidation()
  }

  function clearValidation() {
    validation.value = null
    validationKind.value = null
  }

  async function verify(): Promise<boolean> {
    if (content.value.trim() === '') {  // 空內容前端攔截，不發請求
      // 回傳特殊碼，由 view 顯示「設定檔內容為空，請先編輯或載入內容」
      return false
    }
    isVerifying.value = true
    try {
      const res = await validateServiceConfig(serviceName, content.value)
      validation.value = res
      validationKind.value = res.available ? (res.valid ? 'success' : 'failure') : 'unavailable'
      return res.valid
    } catch {
      validationKind.value = 'error'     // 500/網路錯誤 → 黃色警告
      return false
    } finally {
      isVerifying.value = false
    }
  }

  // save 回傳 { kind: 'success'|'conflict'|'reload-failed'|'error', backupPath?, currentChecksum? }
  async function save(): Promise<{ kind: string; backupPath?: string; currentChecksum?: string; error?: string }> {
    isSaving.value = true
    try {
      const res = await saveServiceConfig(serviceName, { config: content.value, baseChecksum: baseChecksum.value })
      initialContent.value = content.value   // 成功 → 轉 clean
      return { kind: 'success', backupPath: res.backupPath }
    } catch (e: any) {
      const status = e?.response?.status
      if (status === 409) {
        return { kind: 'conflict', currentChecksum: e?.response?.data?.currentChecksum }
      }
      if (e?.response?.data?.backupPath) {
        return { kind: 'reload-failed', backupPath: e.response.data.backupPath, error: e.response.data.error }
      }
      return { kind: 'error', error: e?.response?.data?.error || (e?.request ? '網路連線異常，請稍後重試' : '儲存失敗') }
    } finally {
      isSaving.value = false
    }
  }

  // 409 重新載入：重新 GET 並更新 baseChecksum（F-CE-07）
  async function reloadAfterConflict(): Promise<void> { await load() }

  // beforeunload 第三層防護：dirty 時觸發瀏覽器原生確認
  function onBeforeUnload(e: BeforeUnloadEvent) {
    if (isDirty.value) { e.preventDefault(); e.returnValue = '' }
  }

  return {
    content, isDirty, isLargeFile, status, errorMessage,
    fragmentPath, size, validation, validationKind,
    isVerifying, isSaving, baseChecksum,
    load, setContent, verify, save, reloadAfterConflict,
    onBeforeUnload,
  }
}
```

### 2.5 UnitFileEditor.vue（CodeMirror 6 封裝）

**職責**：唯一接觸 CodeMirror 的元件（決策 1：未來若需換 Monaco 僅替換此檔）。props: `modelValue` / `readOnly`；emits: `update:modelValue`。內部 `await import('codemirror...')` 動態載入（route-level chunk 由 view 的 v-if 控制 loading placeholder）。

```vue
<script setup lang="ts">
// components/UnitFileEditor.vue
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'
import { useTheme } from '../composables/useTheme'

const props = withDefaults(defineProps<{
  modelValue: string
  readOnly?: boolean
}>(), { readOnly: false })
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const host = ref<HTMLElement | null>(null)
let view: any = null              // EditorView 實例
let themeCompartment: any = null  // Compartment — 主題切換
const { theme } = useTheme()

onMounted(async () => {
  // 動態 import CodeMirror 套件（Vite 拆為獨立 chunk，納入 PWA precache）
  const [{ EditorView, keymap }, { EditorState }, { Compartment },
         { StreamLanguage }, { ini }, { lineNumbers }, { indentUnit },
         { defaultKeymap, history, historyKeymap }, ...] = await Promise.all([
    import('@codemirror/view'), import('@codemirror/state'), import('@codemirror/language'),
    import('@codemirror/language'), import('@codemirror/legacy-modes/mode/ini'),
    import('@codemirror/view'), import('@codemirror/language'),
    import('@codemirror/commands'), import('@codemirror/search'),
  ])

  themeCompartment = new Compartment()
  const dark = theme.value === 'dark'

  const state = EditorState.create({
    doc: props.modelValue,
    extensions: [
      lineNumbers(),                                    // 行號（BDD minimap 無對應概念）
      StreamLanguage.define(ini),                       // INI 語法高亮（[Section] 不同顏色）
      indentUnit.of('  '),                              // tabSize 對應 2（BDD tabSize=2）
      EditorView.lineWrapping,                          // BDD wordWrap=on 對應
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      EditorView.updateListener.of((u: any) => {
        if (u.docChanged && !props.readOnly) emit('update:modelValue', u.state.doc.toString())
      }),
      EditorView.editable.of(!props.readOnly),
      themeCompartment.of(EditorView.theme(dark ? darkTheme : lightTheme)),
      EditorView.theme({ '&': { fontFamily: 'var(--lms-font-mono, monospace)' } }), // 等寬字型
    ],
  })
  view = new EditorView({ state, parent: host.value! })
})

// 主題切換：compartment dispatch（即時生效，無需重載頁面）
watch(theme, (val) => {
  if (!view || !themeCompartment) return
  view.dispatch({ effects: themeCompartment.reconfigure(EditorView.theme(val === 'dark' ? darkTheme : lightTheme)) })
})

// 錯誤標記：setErrorMarks(lines: number[]) → 紅色波浪線 decoration + gutter ❌
function setErrorMarks(lines: number[]) { /* Decoration.mark + gutterMarker → dispatch */ }
// 清除全部標記
function clearMarks() { /* dispatch 移除 decorations */ }

watch(() => props.modelValue, (v) => {
  if (view && v !== view.state.doc.toString()) view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: v } })
})

onBeforeUnmount(() => { view?.destroy(); view = null })  // F-ED-13 資源釋放

defineExpose({ setErrorMarks, clearMarks })
</script>

<template>
  <div class="unit-file-editor" ref="host"></div>
</template>
```

**CodeMirror ↔ BDD 對照**（決策 D-1）：`language=ini` → `StreamLanguage.define(ini)`；`tabSize=2` → `indentUnit.of('  ')`；`wordWrap=on` → `EditorView.lineWrapping`；`minimap=off` → CodeMirror 無 minimap 概念（不實作）；深淺主題 → `Compartment` + `EditorView.theme`。

### 2.6 ConfigEditorView.vue

**職責**：路由視圖。整合 useConfigEditor + UnitFileEditor + ConfirmModal + Toast；管理 dirty 三層防護；決定 readOnly（store 中服務的 `locked` 或路由 `?readonly=1` query，供深鏈結）。

```vue
<script setup lang="ts">
// views/ConfigEditorView.vue
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useRoute, useRouter, onBeforeRouteLeave } from 'vue-router'
import UnitFileEditor from '../components/UnitFileEditor.vue'
import ConfirmModal from '../components/ConfirmModal.vue'
import { useConfigEditor } from '../composables/useConfigEditor'
import { useToast } from '../composables/useToast'
import { useI18n } from '../composables/useI18n'
import { useServiceStore } from '../stores/service'   // 查 locked 旗標

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const { showToast } = useToast()
const store = useServiceStore()
const serviceName = route.params.name as string
const editor = useConfigEditor(serviceName)

// readOnly：View Config 進入（?readonly=1）或 store 中該服務 locked=true
const readOnly = computed(() => route.query.readonly === '1' || store.services.find(s => s.name === serviceName)?.locked === true)

// 編輯器 ref（呼叫 setErrorMarks / clearMarks）
const editorRef = ref<InstanceType<typeof UnitFileEditor> | null>(null)
watch(editor.validationKind, (k) => {
  if (k === 'failure' && editor.validation.value) {
    editorRef.value?.clearMarks()
    editorRef.value?.setErrorMarks(editor.validation.value.errors.map(e => e.line))
  } else {
    editorRef.value?.clearMarks()
  }
})

// ── 載入 ──
onMounted(async () => { await editor.load() })

// ── Validate ──
async function onValidate() {
  if (editor.content.value.trim() === '') { showToast(t('config.validateEmpty'), 'warning'); return } // 前端攔截
  const ok = await editor.verify()
  if (!ok && editor.validationKind.value === 'unavailable') {
    showToast(t('config.validateUnavailable'), 'warning')
  }
}

// ── Save（儲存確認 Modal）──
const showSaveModal = ref(false)
const saveResult = ref<any>(null)
async function onSaveConfirm() {
  saveResult.value = await editor.save()
  const r = saveResult.value
  if (r.kind === 'success') {
    showToast(t('config.saved', { name: serviceName }), 'success')
    setTimeout(() => router.push('/'), 1500)   // 1.5s 後自動返回 Dashboard
  } else if (r.kind === 'conflict') {
    showToast(t('config.conflict'), 'error')    // 「設定檔已被其他使用者修改。請重新載入後再編輯。」
    showReloadModal.value = true                 // 提供重新載入動作 → editor.reloadAfterConflict()
  } else if (r.kind === 'reload-failed') {
    showToast(t('config.reloadFailed', { error: r.error, backupPath: r.backupPath }), 'error')
  } else {
    showToast(t('config.saveFailed', { error: r.error }), 'error')
  }
}

// ── 離開確認 Modal（第二層：頁內 Cancel / 返回鍵共用）──
const showDiscardModal = ref(false)
let leaveDecision: ((ok: boolean) => void) | null = null
function requestLeave() {
  if (!editor.isDirty.value) { router.push('/'); return }
  showDiscardModal.value = true
}
function onStay()   { showDiscardModal.value = false; leaveDecision?.(false); leaveDecision = null }
function onDiscard() {
  showDiscardModal.value = false
  leaveDecision?.(true)
  leaveDecision = null
  showToast(t('config.discarded'), 'warning')
  router.push('/')
}
// 第一層：route guard（含瀏覽器返回鍵/程式導航）— 非同步 promise 決策
onBeforeRouteLeave(() => {
  if (!editor.isDirty.value || editor.isSaving.value) return true
  return new Promise<boolean>((resolve) => {
    showDiscardModal.value = true
    leaveDecision = resolve
  })
})
// 第三層：beforeunload（分頁關閉原生確認）
onMounted(() => window.addEventListener('beforeunload', editor.onBeforeUnload))
onBeforeUnmount(() => window.removeEventListener('beforeunload', editor.onBeforeUnload))

// 唯讀模式僅 Close
function onClose() { if (editor.isDirty.value) requestLeave(); else router.push('/') }
</script>

<template>
  <div class="config-editor-page">
    <!-- 載入中 -->
    <div v-if="editor.status.value === 'loading'" class="config-loading">
      <span class="spinner"></span>{{ t('config.loading') }}  <!-- 「載入設定檔中...」 -->
    </div>

    <!-- 載入失敗（非 404）→ 錯誤 + 返回/重試 -->
    <div v-else-if="editor.status.value === 'error'" class="config-error-state">
      <p class="config-error-message">{{ editor.errorMessage.value }}</p>
      <div class="config-error-actions">
        <button class="outline secondary" @click="router.push('/')">{{ t('config.back') }}</button>
        <button class="primary" @click="editor.load()">{{ t('config.retry') }}</button>
      </div>
    </div>

    <template v-else>
      <!-- 標題列：服務名稱 + FragmentPath + dirty 指示 -->
      <header class="config-header">
        <h2>{{ serviceName }} <span v-if="editor.isDirty.value" class="dirty-dot" title="未儲存變更">●</span></h2>
        <code class="config-path">{{ editor.fragmentPath.value }}</code>
      </header>

      <!-- 黃色提示：設定檔不存在（404 後仍可輸入重建） -->
      <div v-if="editor.status.value === 'not-found'" class="config-notice warning" role="alert">
        {{ t('config.notFound', { path: editor.fragmentPath.value || '' }) }}
      </div>
      <!-- 黃色提示：大檔案效能 -->
      <div v-else-if="editor.isLargeFile.value" class="config-notice warning">
        {{ t('config.largeFile', { size: editor.size.value }) }}
      </div>

      <!-- 驗證狀態橫幅：綠（通過）/ 紅（失敗面板）/ 黃（不可用） -->
      <div v-if="editor.validationKind.value === 'success'" class="validation-banner success">✅ {{ t('config.validatePass') }}</div>
      <div v-else-if="editor.validationKind.value === 'failure'" class="validation-banner error" role="alert">
        <p v-for="(e, i) in editor.validation.value?.errors" :key="i" class="validation-error-item">Line {{ e.line }}: {{ e.message }}</p>
      </div>
      <div v-else-if="editor.validationKind.value === 'unavailable' || editor.validationKind.value === 'error'" class="validation-banner warning">⚠️ {{ t('config.validateUnavailable') }}</div>

      <!-- 編輯器 -->
      <UnitFileEditor ref="editorRef" v-model="editor.content.value" :read-only="readOnly || editor.isSaving.value" />

      <!-- 底部按鈕列 -->
      <footer class="config-footer">
        <template v-if="!readOnly">
          <button class="outline secondary" :disabled="editor.isVerifying.value || editor.isSaving.value" @click="onValidate">
            <span v-if="editor.isVerifying.value" class="spinner-sm"></span>{{ editor.isVerifying.value ? 'Verifying...' : t('config.validate') }}
          </button>
          <button class="primary" :disabled="!editor.isDirty.value || editor.isSaving.value" @click="showSaveModal = true">
            <span v-if="editor.isSaving.value" class="spinner-sm"></span>{{ editor.isSaving.value ? 'Saving...' : t('config.save') }}
          </button>
          <button class="outline secondary" :disabled="editor.isSaving.value" @click="requestLeave">{{ t('config.cancel') }}</button>
        </template>
        <button v-else class="outline secondary" @click="onClose">{{ t('config.close') }}</button>
      </footer>
    </template>

    <!-- 儲存確認 Modal（空內容時額外警告） -->
    <ConfirmModal
      :show="showSaveModal"
      :title="t('config.saveTitle')"
      :confirm-label="t('config.saveChanges')"
      :cancel-label="t('modal.cancel')"
      confirm-class="danger"
      :details="[
        t('config.saveConfirm', { path: editor.fragmentPath.value || '' }),
        t('config.saveReloadNotice'),
        t('config.saveRisk'),
        ...(editor.content.value.trim() === '' ? [t('config.saveEmptyWarning')] : []),
      ]"
      @cancel="showSaveModal = false"
      @confirm="showSaveModal = false; onSaveConfirm()"
    />
    <!-- 離開確認 Modal -->
    <ConfirmModal
      :show="showDiscardModal"
      :title="t('config.discardTitle')"
      :message="t('config.discardMessage')"
      :cancel-label="t('config.stay')"
      :confirm-label="t('config.discardChanges')"
      confirm-class="danger"
      @cancel="onStay"
      @confirm="onDiscard"
    />
  </div>
</template>
```

**ConfirmModal.vue 擴充**（向後相容）：新增 optional props `title?: string`（預設沿用 `t('modal.title')`）、`cancelLabel?: string` / `confirmLabel?: string`（預設 `modal.cancel` / `modal.confirm`）、`confirmClass?: 'danger' | 'primary'`（預設 `danger`，既有用法不變）。

### 2.7 ServiceRow.vue 按鈕與 router

```vue
<!-- ServiceRow.vue — Actions 區域新增 Slot 4（Edit/View Config） -->
<span class="action-slot">
  <button
    v-if="service.fragmentPath && !service.locked"
    class="outline secondary btn-act-config"
    :aria-label="'編輯 ' + service.name + ' 設定檔'"
    @click.stop="$router.push({ name: 'config-editor', params: { name: service.name } })"
  >
    ✏️ <span class="btn-label">Edit Config</span>
  </button>
  <button
    v-else-if="service.fragmentPath && service.locked"
    class="outline secondary btn-act-config"
    :aria-label="'檢視 ' + service.name + ' 設定檔'"
    @click.stop="$router.push({ name: 'config-editor', params: { name: service.name }, query: { readonly: '1' } })"
  >
    👁️ <span class="btn-label">View Config</span>
  </button>
</span>
```

- 顯示規則（BDD 商業規則）：`fragmentPath` 非空才顯示；`locked:false` → 「Edit Config」；`locked:true` → 「View Config」（唯讀，帶 `?readonly=1`）；`fragmentPath` 空 → 隱藏（F-SR-03）
- 樣式與其他操作按鈕一致（`outline secondary`，同列 `action-slot`）

```typescript
// router/index.ts — 新增（沿用 AuditLogView / TokenManageView lazy-load pattern）
const ConfigEditorView = () => import('../views/ConfigEditorView.vue')
// routes 新增：
{ path: '/services/:name/config', name: 'config-editor', component: ConfigEditorView, meta: { auth: true } },
```

### 2.8 useI18n.ts 新增翻譯鍵

| key | zh-TW | en |
|-----|-------|-----|
| `config.edit` | Edit Config（按鈕文字直接硬編碼亦可） | Edit Config |
| `config.view` | View Config | View Config |
| `config.loading` | 載入設定檔中... | Loading config file... |
| `config.validate` | Validate | Validate |
| `config.save` | Save | Save |
| `config.cancel` | Cancel | Cancel |
| `config.close` | Close | Close |
| `config.saveTitle` | 儲存設定檔變更 | Save Config Changes |
| `config.saveChanges` | Save Changes | Save Changes |
| `config.saveConfirm` | 確定要將變更寫入 {path} 嗎？ | Write changes to {path}? |
| `config.saveReloadNotice` | 儲存後將自動執行 systemctl daemon-reload 使變更生效 | A systemctl daemon-reload will run automatically |
| `config.saveRisk` | ⚠️ 錯誤的設定可能導致服務無法啟動。 | ⚠️ Incorrect settings may prevent the service from starting. |
| `config.saveEmptyWarning` | ⚠️ 設定檔內容為空。儲存空設定檔可能導致 systemd 無法解析。確定要繼續嗎？ | ⚠️ Config content is empty... |
| `config.validatePass` | 語法驗證通過 — 設定檔語法正確 | Syntax validation passed |
| `config.validateUnavailable` | 無法執行語法驗證 — systemd-analyze 不可用或執行錯誤。您仍可直接儲存設定檔。 | Unable to validate — systemd-analyze unavailable... |
| `config.validateEmpty` | 設定檔內容為空，請先編輯或載入內容 | Config content is empty... |
| `config.notFound` | 設定檔不存在：{path}。請確認服務設定檔是否已被手動刪除。 | Config file not found: {path}... |
| `config.largeFile` | 設定檔較大（{size}），編輯時可能有效能影響。 | Large config file ({size})... |
| `config.discardTitle` | 有未儲存的變更 | Unsaved changes |
| `config.discardMessage` | 有未儲存的變更，確定要離開嗎？未儲存的變更將會遺失。 | You have unsaved changes... |
| `config.stay` | Stay | Stay |
| `config.discardChanges` | Discard Changes | Discard Changes |
| `config.saved` | {name} 設定檔已儲存，daemon-reload 已執行 | ... saved, daemon-reload executed |
| `config.saveFailed` | 儲存失敗：{error} | Save failed: {error} |
| `config.reloadFailed` | 設定檔已儲存，但 daemon-reload 失敗：{error}。請手動執行 systemctl daemon-reload。備份檔：{backupPath} | ... daemon-reload failed ... |
| `config.conflict` | 設定檔已被其他使用者修改。請重新載入後再編輯。 | Config modified by another user... |
| `config.discarded` | 已放棄未儲存的變更 | Unsaved changes discarded |
| `config.back` / `config.retry` | 返回 / 重試 | Back / Retry |
| `audit.action.configView` / `audit.action.configSave` | 檢視設定檔 / 儲存設定檔 | View config / Save config |

---

## 3. API 合約

| 方法 | 路徑 | Request | Response | 說明 |
|------|------|---------|----------|------|
| GET | `/api/v1/services/{name}/config` | — | 200 `ServiceConfigResponse` | 讀取 FragmentPath 內容；鎖定服務（/usr/lib 等）亦可讀（唯讀檢視，D-2） |
| PUT | `/api/v1/services/{name}/config` | `{"config":"...","baseChecksum":"<sha256 hex>"}` | 200 `SaveConfigResponse` | 備份 → 衝突檢查 → atomic write → daemon-reload → audit |
| POST | `/api/v1/services/{name}/config/validate` | `{"config":"..."}` | 200 `ValidateResponse` | systemd-analyze verify（暫存檔）；不可用時 `available:false` |

Auth：三端點皆在 `AuthMiddlewareComposite(tokenStore)` 保護群組內（session 或 Bearer Token），未登入回 **401**。

### 3.1 GET `/api/v1/services/{name}/config`

**200 成功**

```json
{
  "name": "nginx.service",
  "fragmentPath": "/etc/systemd/system/nginx.service",
  "config": "[Unit]\nDescription=nginx...\n\n[Service]\nExecStart=/usr/sbin/nginx...",
  "size": 412,
  "checksum": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"
}
```

**錯誤碼**

| 狀態 | 情境 | 回應體 |
|------|------|--------|
| 400 | 服務名稱無效（`ValidateServiceName`） | `{"error":"invalid service name"}` |
| 404 | FragmentPath 為空 / 服務不存在 | `{"error":"設定檔路徑不存在"}` |
| 404 | 檔案已被刪除 | `{"error":"設定檔不存在: /etc/systemd/system/nginx.service"}` |
| 413 | 檔案 > 500KB | `{"error":"設定檔超過 500KB 大小限制"}` |
| 500 | 讀取失敗（權限不足等，訊息含底層原因） | `{"error":"無法讀取設定檔：..."}` |
| 401 | 未登入 | Auth middleware 攔截 |

> 註：GET 不檢查路徑邊界（鎖定服務回 200，依 D-2 裁決；BDD「GET 鎖定服務回 403」以技術決策調整為僅 PUT 適用）。

### 3.2 PUT `/api/v1/services/{name}/config`

**200 成功**

```json
{ "message": "nginx.service 設定檔已儲存，daemon-reload 已執行", "backupPath": "/etc/systemd/system/nginx.service.bak.20260812T153045Z" }
```

**錯誤碼**

| 狀態 | 情境 | 回應體 |
|------|------|--------|
| 400 | 名稱無效 / body 格式錯誤 / `baseChecksum` 缺省（檔案存在時） | `{"error":"invalid service name"}` / `{"error":"invalid request body"}` |
| 403 | FragmentPath 不在 `/etc/systemd/system/` 下（含 `/etc/systemd/system-xxx` 旁路、`..` 遍歷、symlink 脫離邊界） | `{"error":"不允許編輯此服務設定檔"}` |
| 403 | 副檔名非 `.service`（.timer / .socket） | `{"error":"僅支援 .service 設定檔"}` |
| 404 | FragmentPath 為空 / 服務不存在 | `{"error":"設定檔路徑不存在"}` |
| 409 | checksum 衝突（他人已修改） | `{"error":"設定檔已被其他使用者修改。請重新載入後再編輯。","currentChecksum":"5f8c..."}` |
| 413 | config > 500KB（不寫入、不建立備份） | `{"error":"設定檔超過 500KB 大小限制"}` |
| 500 | 寫入失敗（已還原備份） | `{"error":"寫入失敗"}` |
| 500 | daemon-reload 失敗（**不還原**，附 backupPath） | `{"error":"設定檔已儲存，但 daemon-reload 失敗: ...。請手動執行 systemctl daemon-reload。備份檔：{backupPath}","backupPath":"..."}` |
| 401 | 未登入（設定檔未被修改） | Auth middleware 攔截 |

**checksum 欄位語意**：`checksum = sha256(file content)` hex（64 字元小寫）。GET 回傳 `checksum`；PUT body 必填 `baseChecksum`。檔案存在且 `baseChecksum` 缺省 → 400；檔案不存在 → 視為建立新檔（對應 BDD「404 後輸入內容儲存」），跳過比對。

### 3.3 POST `/api/v1/services/{name}/config/validate`

**200 通過 / 失敗**

```json
// valid=true
{ "valid": true, "available": true, "errors": [] }
// valid=false（含行號）
{ "valid": false, "available": true, "errors": [ { "line": 12, "message": "Unknown key name 'ExecStartt'" } ] }
```

**200 systemd-analyze 不可用（決策 D-3，非 500 crash）**

```json
{ "valid": false, "available": false, "errors": [], "message": "systemd-analyze 指令不存在，無法進行語法驗證" }
```

**錯誤碼**

| 狀態 | 情境 | 回應體 |
|------|------|--------|
| 400 | 名稱無效 / body 格式錯誤 | `{"error":"invalid service name"}` / `{"error":"invalid request body"}` |
| 500 | 暫存檔建立失敗（/tmp 空間/權限） | `{"error":"無法建立暫存檔進行驗證。請檢查 /tmp 目錄空間與權限。"}` |
| 401 | 未登入 | Auth middleware 攔截 |

> 警告不構成失敗：`systemd-analyze verify` exit 0（僅警告）→ `valid:true`。

---

## 4. 資料流

### 4.1 編輯 → 驗證 → 儲存主流程

```
管理員點擊 ServiceRow「Edit Config」
  │  (locked:false + fragmentPath 非空；locked:true 顯示「View Config」→ ?readonly=1)
  ▼
router.push('/services/nginx/config')          [lazy-load ConfigEditorView]
  ▼
ConfigEditorView onMounted → editor.load()
  │ GET /api/v1/services/nginx/config
  │   → 200 {config, size, checksum} → initialContent/content/baseChecksum 設定，status=ready
  │   → 404 → status=not-found（空編輯器 + 黃色提示，可重建）
  │   → 其他錯誤 → status=error（錯誤訊息 + 返回/重試）
  ▼
編輯內容（UnitFileEditor emit update:modelValue → editor.setContent）
  │ → isDirty=true（Save 啟用 + 「●」指示）；先前驗證結果自動清除
  ▼
點擊 Validate
  ├─ 內容為空 → 前端攔截，提示「設定檔內容為空」（不發請求）
  └─ 非空 → POST /config/validate {config}
        ├─ 200 valid=true  → 綠色橫幅，清除標記
        ├─ 200 valid=false → 紅色錯誤面板 + 波浪線/gutter ❌
        └─ 200 available:false / 500 / 網路錯誤 → 黃色警告，不阻塞儲存
  ▼
點擊 Save → ConfirmModal（路徑 / daemon-reload 提示 / 風險警告 / 空內容額外警告 / 上次驗證失敗提醒）
  └─ 確認 → PUT /config {config, baseChecksum}
        ├─ 200 → 綠色 Toast；dirty 清除；1.5s 後自動返回 Dashboard
        ├─ 409 → Toast「已被他人修改」+ 重新載入（重新 GET 更新 baseChecksum）
        ├─ 500 + backupPath → daemon-reload 半成功 Toast（恢復可編輯）
        └─ 500 / 網路錯誤 → 紅色 Toast（恢復可編輯，內容保留）
```

### 4.2 後端 PUT 儲存子流程（含備份 / 還原 / reload / audit）

```
PUT /api/v1/services/nginx/config {config, baseChecksum}
 1. ValidateServiceName          失敗 → 400
 2. FragmentPathOf（systemctl show）  失敗/空 → 404
 3. assertWritablePath：Clean+Rel 邊界 / .service 副檔名 / EvalSymlinks
                                  失敗 → 403（檔案系統零副作用）
 4. decode body + size ≤ 500KB   格式錯 → 400；過大 → 413
 5. CheckConflict（現行 checksum vs baseChecksum）
                                  不一致 → 409 + currentChecksum（不寫入）
                                  檔案不存在 → 跳過（建立新檔）
 6. Backup(path) → {name}.service.bak.{20060102T150405Z}（copy）
 7. PruneBackups(5)               超過 5 份刪最舊（prefix 限定同服務）
 8. AtomicWrite（tmp + chmod 保留 mode + fsync + rename）
                                  失敗 → Restore(備份) → 500「寫入失敗」+ audit(failure)
 9. DaemonReload（10s 逾時）
                                  失敗 → 不還原 → 500 + backupPath + audit(success, detail 附註 reload 錯誤)
10. audit config_save（success, detail=backupPath）→ 200 {message, backupPath}
```

### 4.3 驗證子流程（後端）

```
POST /config/validate {config}
 1. LookPath("systemd-analyze")   不存在 → 200 {valid:false, available:false, message}
 2. 寫入 /tmp/lsm-validate-{uuid}.service（0600）；defer os.Remove
 3. systemd-analyze verify {tmp}（10s 逾時）
 4. exit 0 → 200 {valid:true, errors:[]}（警告視同通過）
    exit ≠ 0 → regex 解析 {path}:{line}: {message} → 200 {valid:false, errors:[{line,message}]}
 5. 完成 → 暫存檔刪除（成功/失敗/逾時皆清理）
```

### 4.4 Audit 記錄

| action | 觸發 | target | detail |
|--------|------|--------|--------|
| `config_view` | GET 成功（含鎖定服務唯讀） | 服務名稱 | FragmentPath |
| `config_save` | PUT 完整成功 | 服務名稱 | backupPath |
| `config_save` | PUT 寫入成功但 reload 失敗（半成功） | 服務名稱 | `設定檔已寫入，daemon-reload 失敗: ...; backup=...`（result=success） |
| `config_save` | PUT 寫入失敗 | 服務名稱 | 「寫入失敗」（result=failure） |

---

## 5. 生命週期

### 5.1 編輯器 dirty 狀態機

```
                    setContent(content ≠ initialContent)          save() 成功 / setContent(初始)
    ┌───────────┐ ───────────────────────────────────────────▶ ┌───────────┐
    │   clean   │ ◀─────────────────────────────────────────── │   dirty   │
    └───────────┘                                               └───────────┘
         ▲                                                            │
         └──────── 內容還原回 initialContent（內容比對，非 flag 累計）───┘
```

- **判定**：`isDirty = content ≠ initialContent`（computed，內容比對）
- **副作用**：dirty → Save 啟用、標題「●」指示；內容變更 → 自動清除驗證結果與行標記
- **清 dirty**：儲存成功（`initialContent = content`）；409 重新載入後以新內容重設；Discard 離開

### 5.2 載入 / 驗證 / 儲存狀態

| 狀態 | 數值 | UI 呈現 |
|------|------|---------|
| `status` | `loading` | spinner +「載入設定檔中...」 |
| | `ready` | 編輯器 + Validate/Save/Cancel |
| | `not-found` | 空編輯器 + 黃色提示（可輸入重建） |
| | `error` | 錯誤訊息 + 返回/重試 |
| `isVerifying` | true | Validate 按鈕 spinner +「Verifying...」+ disabled（防重複點擊） |
| `isSaving` | true | Save 按鈕「Saving...」+ 編輯器唯讀（儲存期間不可編輯） |
| `validationKind` | `success` / `failure` / `unavailable` / `error` / null | 綠 / 紅面板 / 黃警告 / 黃警告 / 無 |
| `isDirty` | boolean | 「●」指示 + Save enabled + guard 攔截 |

### 5.3 dirty 三層防護（決策 6 / D-9）

| 層 | 機制 | 覆蓋情境 |
|----|------|---------|
| 1 | `onBeforeRouteLeave` 回傳 Promise，dirty 時彈出 ConfirmModal（Stay → resolve(false)；Discard → resolve(true)） | 瀏覽器返回鍵、側邊連結、程式導航、頁內 Cancel |
| 2 | 頁內 Cancel 按鈕走同一 `requestLeave()` 流程（clean 直接導航；dirty 彈 Modal） | 頁內操作 |
| 3 | `beforeunload` handler（onMounted 註冊 / onBeforeUnmount 移除），dirty 時 `e.preventDefault(); e.returnValue=''` | 分頁關閉 / 重新整理（瀏覽器原生確認框） |

> 三層共用同一 `isDirty`（單一真源，避免不一致）；儲存成功後 dirty=false，自動返回 Dashboard 時 guard 自然放行。

### 5.4 唯讀模式生命週期

`readOnly = route.query.readonly === '1' || store 中該服務 locked === true`：編輯器 `readOnly:true`（不可輸入、不 emit）、無 Validate/Save、僅 Close；Close 於 clean 時直接返回、dirty（不可能，因唯讀）走同一 guard。GET 仍正常載入（D-2，鎖定服務回 200）。

---

## 6. 邊界條件處理

> 來源：BDD 全部 `@edge-case` / `@business-rules` / `@security` / `@boundary` + Tech Decision 裁決。測試對應編號（SYS/HDL/F/E2E/MAN）參照 `docs/test-plans/012-service-config-editor測試計畫.md` 覆蓋矩陣。

| # | 邊界條件 | 處理方式 | 對應 BDD Scenario | 測試 |
|---|---------|---------|------------------|------|
| 1 | **路徑遍歷 `..` / prefix 旁路** | API 不接受用戶端路徑；`filepath.Clean` + `filepath.Rel` 邊界（非 HasPrefix，擋 `/etc/systemd/system-evil/`）；PUT 前 `EvalSymlinks`（含 parent 目錄）解析仍須在邊界內；僅 `.service` 副檔名 | PUT 路徑遍歷嘗試 / PUT 非 .service / PUT 鎖定服務 | SYS-08~17, HDL-11~13, INT-09 |
| 2 | **symlink 指向目錄外** | 目標檔存在 → `EvalSymlinks(path)` 檢查；不存在 → 對 parent 目錄檢查，解析結果脫離邊界即 403 | PUT 路徑遍歷嘗試 | SYS-14~15 |
| 3 | **鎖定服務唯讀** | GET 回 200 唯讀檢視（D-2）；403 僅適用 PUT；UI 按鈕顯示「View Config」 | 唯讀模式檢視 / 僅 /etc 下可編輯 | F-VW-04, F-ED-03, HDL-03, HDL-11 |
| 4 | **`UNLOCKED_SERVICES` env 解鎖 /usr/lib 服務** | UI 顯示 Edit 按鈕但 API 一律 403（路徑為唯一安全邊界，決策 5 / D-8） | 僅 /etc 下可編輯 | HDL-11 |
| 5 | **500KB 大小限制** | GET/PUT 皆以 `MaxConfigSize=500*1024` 為界，超過回 413；PUT 413 時不寫入、不建立備份；前端 GET 成功回應 `size>500KB` 時顯示黃色效能提示（防禦性 UI，正常由 413 攔截；測試以 mock 驗證，F-VW-09） | GET/PUT 超過 500KB / 效能提示 | SYS-07, HDL-06, HDL-14, F-VW-09 |
| 6 | **404 後重建（檔案被刪除）** | GET 404 → 空編輯器 + 黃色提示；PUT 時檔案不存在 → 跳過 checksum 比對，允許建立新檔 | 設定檔已被刪除 / GET 檔案不存在 | F-VW-07~08, SYS-05 |
| 7 | **並發衝突 409** | GET 回傳 checksum；PUT 必填 `baseChecksum`（缺省回 400）；寫入前比對現行 checksum，不一致回 409 + `currentChecksum`；前端 Toast + 重新載入流程更新基準；不實作悲觀鎖定（last-write-wins） | PUT 並發衝突 / 不實作悲觀鎖定 | SYS-28~32, HDL-16~17, INT-03~04, E2E-16 |
| 8 | **備份保留 5 份** | 每次儲存前 copy 為 `{name}.service.bak.{20060102T150405Z}`（UTC compact RFC3339，固定寬度 → 字典序=時間序）；prune 以同服務 prefix glob、降冪排序保留 5 份 | 備份保留 5 份 | SYS-18~23, INT-08 |
| 9 | **daemon-reload 逾時 10 秒** | `context.WithTimeout(10s)`；逾時視為失敗，kill process；回 500 + backupPath，**不還原**設定檔 | daemon-reload 逾時 / reload 失敗不還原 | SYS-44~45, HDL-19, INT-07 |
| 10 | **寫入失敗還原** | 僅「檔案寫入失敗」時以備份還原（D-5）；回 500「寫入失敗」 | PUT 寫入失敗還原 | SYS-25, HDL-18, INT-06 |
| 11 | **systemd-analyze 不存在（容器）** | `LookPath` 失敗 → **200** `{valid:false, available:false, message}`（非 500 crash）；前端黃色警告、不阻塞儲存 | Validate systemd-analyze 不存在 / 驗證服務不可用 | SYS-38, HDL-23, F-VL-06 |
| 12 | **驗證暫存檔 /tmp 失敗或殘留** | 檔名 `lsm-validate-{uuid}.service`（UUID 防碰撞）、權限 0600、`defer os.Remove` 保證成功/失敗/逾時皆刪除；建立失敗回 500 提示檢查 /tmp | Validate 暫存檔建立失敗 / 暫存檔被刪除 | SYS-41~43, INT-05 |
| 13 | **驗證輸出僅含警告** | exit 0 → `valid:true`（警告不構成失敗） | 輸出僅含警告視為通過 | SYS-35 |
| 14 | **驗證輸出多種錯誤格式** | regex `^[^:]+:(\d+):\s*(.+)$` 萃取行號與訊息；不可解析行 → 原始輸出為 message，不 crash | 不同語法錯誤 Outline（Unknown key / Section not found / Missing '=' / Exec path） | SYS-34~37 |
| 15 | **空內容 Validate** | 前端攔截不發請求，提示「設定檔內容為空，請先編輯或載入內容」 | 空內容點擊 Validate | F-VL-02, E2E-21 |
| 16 | **空內容 Save** | ConfirmModal 額外顯示「⚠️ 設定檔內容為空...」；確認後仍可儲存 | 儲存內容為空額外警告 | F-SV-10, E2E-17 |
| 17 | **權限不足（讀/寫）** | 讀：GET 500 錯誤訊息含「權限」原因；寫：PUT 500 + 前端 Toast「儲存失敗：權限不足，無法寫入 {path}...」 | GET/PUT 權限不足 | F-VW-10, F-SV-11, MAN-03~04 |
| 18 | **網路中斷** | 前端 axios 網路錯誤 → 「網路連線異常，請稍後重試」；編輯內容保留於瀏覽器記憶體、恢復可編輯 | 儲存期間網路中斷 | F-SV-12, MAN-10 |
| 19 | **無效服務名稱三端點** | 三端點皆以 `ValidateServiceName` 驗證，回 400「invalid service name」；`../traversal` 等名稱被路由參數 regex 擋下或驗證拒絕，不執行檔案操作 | 無效名稱 Outline | HDL-02/10/25, E2E-22~26 |
| 20 | **未登入三端點** | AuthMiddlewareComposite 攔截 → 401；PUT 未登入時設定檔未被修改 | 未登入 GET/PUT/validate | HDL-08/20/26, E2E-27~29 |
| 21 | **設定檔超過 500KB 載入** | 正常由 GET 413 攔截（BDD @api 優先）；前端 `size>500KB` 提示為防禦性 UI 分支（BDD @editor 與 @api 的矛盾以 413 優先裁決，F-VW-09 以 mock 驗證 UI 邏輯） | 500KB 效能提示 vs GET 413 | SYS-07, F-VW-09 |
| 22 | **save 期間 editor 唯讀** | `isSaving=true` → `readOnly` 傳入編輯器，儲存中不可編輯 | 確認儲存後成功寫入 | F-SV-05 |
| 23 | **audit 記錄** | GET 成功 → `config_view`（含鎖定服務唯讀）；PUT 成功/半成功 → `config_save`（半成功 result=success、detail 附註 reload 錯誤）；PUT 寫入失敗 → `config_save` failure | audit config_view / config_save | HDL-27~30, INT-01~02 |

---

## 7. CSS 關鍵樣式

> 對應 `.vue` code skeleton 中的 class binding（與既有 `--lms-*` CSS variables 體系一致，深淺主題由 `[data-theme]` 切換）。

```css
/* 全域 CSS variables 擴充（assets/main.css，主題兩側皆需） */
:root {
  --lms-font-mono: 'SFMono-Regular', 'JetBrains Mono', Consolas, 'Liberation Mono', Menlo, monospace;
  --lms-success: #2e7d32;
  --lms-success-bg: #e8f5e9;
  --lms-success-border: #a5d6a7;
  --lms-warning: #f9a825;
  --lms-warning-bg: #fff8e1;
  --lms-warning-border: #ffe082;
  --lms-error: #c62828;
  --lms-error-bg: #fff0f0;
  --lms-error-border: #ef9a9a;
}

/* 1. 驗證狀態橫幅（綠/紅/黃三態）— validation-banner */
.validation-banner {
  padding: 0.6rem 0.9rem;
  border-radius: var(--lms-radius-sm);
  margin: 0.5rem 0;
  font-size: 0.9rem;
}
.validation-banner.success { background: var(--lms-success-bg); color: var(--lms-success); border: 1px solid var(--lms-success-border); }
.validation-banner.error   { background: var(--lms-error-bg);   color: var(--lms-error);   border: 1px solid var(--lms-error-border); }
.validation-banner.warning { background: var(--lms-warning-bg); color: #8a6d00;            border: 1px solid var(--lms-warning-border); }
.validation-error-item { margin: 0.15rem 0; font-family: var(--lms-font-mono); font-size: 0.85rem; }

/* 2. 錯誤/提示面板 — config-error-state / config-notice（不覆蓋編輯器，位於其下方） */
.config-error-state { text-align: center; padding: 3rem 1rem; }
.config-error-message { color: var(--lms-danger, #c62828); margin-bottom: 1rem; }
.config-notice.warning { /* 同 .validation-banner.warning 樣式 */ }

/* 3. dirty 指示「●」— dirty-dot（標題旁） */
.dirty-dot { color: var(--lms-warning); font-size: 1rem; vertical-align: middle; margin-left: 0.3rem; animation: none; }
/* 可選：編輯變更時短暫閃爍
@keyframes dirty-pulse { 0%,100% { opacity: 1; } 50% { opacity: .4; } } */

/* 4. 等寬字型（CodeMirror 容器 + 路徑顯示） */
.unit-file-editor, .config-path, .validation-error-item {
  font-family: var(--lms-font-mono);
  font-size: 0.85rem;
}
/* CodeMirror 深淺主題對應：由 UnitFileEditor 的 Compartment + EditorView.theme 程式化切換，
   與既有 [data-theme="dark"] 變數同步（測試 F-TH-01~03） */

/* 5. 底部按鈕列 RWD（手機不溢出螢幕） */
.config-footer {
  display: flex; gap: 0.5rem; flex-wrap: wrap; padding: 0.75rem 0;
}
@media (max-width: 767px) {
  .config-footer button { flex: 1 1 auto; min-width: 0; }
  .unit-file-editor { max-width: 100vw; overflow-x: auto; } /* 或縮小字型 */
  .config-header { flex-direction: column; align-items: flex-start; gap: 0.3rem; }
}

/* 6. 載入 spinner（沿用既有 .spinner / .spinner-sm） */
.config-loading { display: flex; align-items: center; gap: 0.6rem; padding: 3rem 0; justify-content: center; }
```

---

## 8. 開發順序

> DAG（無循環依賴）：後端基礎模組 → 後端 handler → audit 整合 → 前端基礎（依賴/型別/client）→ composable → 編輯器元件 → view 整合 → 進入點 → 測試。

| 步驟 | 內容 | 依賴 |
|------|------|------|
| 1 | `frontend/package.json`：安裝 7 個 CodeMirror 依賴（`codemirror`, `@codemirror/state`, `view`, `language`, `commands`, `search`, `legacy-modes`） | - |
| 2 | `internal/systemd/config.go`：ConfigStore（讀取/checksum/路徑驗證/備份/prune/atomic write/Restore/CheckConflict/DaemonReload） | - |
| 3 | `internal/systemd/config_validate.go`：systemd-analyze 暫存檔驗證 + 輸出解析 + available 降級 | #2（共用 exec mock pattern） |
| 4 | `internal/audit/audit.go`：新增 `ActionConfigView` / `ActionConfigSave` + display labels | - |
| 5 | `internal/handler/config_handler.go`：GET/PUT/validate 三 handler + audit 寫入 + 錯誤碼對映 | #2, #3, #4 |
| 6 | `src/main.go`：註冊 3 條路由 + Handler.Config 欄位初始化 | #5 |
| 7 | 後端單元測試：`config_test.go`（SYS-01~46）+ `config_handler_test.go`（HDL-01~30） | #2, #3, #5 |
| 8 | `types/service.ts` + `api/client.ts`：config 型別與三 API 函式 | - |
| 9 | `composables/useConfigEditor.ts`：dirty/baseChecksum/load/verify/save/beforeunload | #8 |
| 10 | `components/UnitFileEditor.vue`：CodeMirror 封裝（INI 高亮、標記、主題 compartment、readOnly、動態 import） | #1 |
| 11 | `components/ConfirmModal.vue`：擴充 title / 自訂按鈕 labels / confirmClass（向後相容） | - |
| 12 | `views/ConfigEditorView.vue`：載入/錯誤/404 三態、驗證面板、儲存流程、dirty 三層 guard | #9, #10, #11 |
| 13 | `ServiceRow.vue` 按鈕 + `router/index.ts` 新路由 + `useI18n.ts` 翻譯鍵 | #12 |
| 14 | 前端單元測試：UnitFileEditor / useConfigEditor / ConfigEditorView / ServiceRow / client 擴充（F-SR / F-ED / F-CE / F-VW / F-VL / F-SV / F-CN / F-AP / F-TH） | #9~#13 |
| 15 | Playwright E2E：`frontend/e2e/012-config-editor.spec.ts`（E2E-01~29） | #6, #13 |
| 16 | 手動驗證 checklist（MAN-01~12：真實 systemd / 權限 / 並發 / PWA 離線 / audit） | #6, #13 |

---

## 9. 基礎架構設定

### 9.1 PWA precache（`frontend/vite.config.ts`）

- **現狀**：`globPatterns: ['**/*.{html,js,css,svg,png,woff2}']` 已涵蓋所有 build 產物
- **本功能**：CodeMirror 動態 import 拆出的編輯器 chunk（約 ~130KB gzip）為 `**/*.js` 一員，**自動納入 precache，無需修改設定** → 離線進入編輯頁仍可使用（MAN-12）
- **備案**（僅當未來編輯器體積成長需排除時）：於 `globIgnores` 排除編輯器 chunk，改由既有 `runtimeCaching`（`/api/.*` NetworkFirst + 頁面 StaleWhileRevalidate）處理

### 9.2 驗證暫存檔 /tmp 權限

- 檔名：`/tmp/lsm-validate-{uuid}.service`（`crypto/rand` UUID，避免並發碰撞）
- 權限：`0600`（`tmpFileMode`）— 驗證內容可能含機敏設定（密鑰路徑等），不可被其他使用者讀取
- 清理：`defer os.Remove` 保證成功/失敗/逾時皆刪除；可選於啟動時清掃殘留 `lsm-validate-*`（Tech Decision 風險表提及）
- **運行前提**：LMS 執行使用者需對 `/etc/systemd/system/` 具寫入權限（實務以 root 執行或具 sudo），且具執行 `systemctl` / `systemd-analyze` 權限 — 於部署文件註明，非本功能新增設定

### 9.3 其他

- **反向代理 (nginx)**：無新變更（無 WebSocket 新端點、無新外部資產；config API 走既有 `/api/v1` 路徑）
- **環境變數**：無新增；既有 `UNLOCKED_SERVICES` 僅影響 UI 按鈕顯示，不影響後端路徑授權邊界（D-8）
- **資料目錄**：無新持久化檔案（備份檔與 unit file 同目錄，非 LMS 資料目錄）
- **audit.jsonl**：沿用既有 `/var/lib/linux-service-manager/audit.jsonl`，無 schema 變更（新 action 值 `config_view` / `config_save`）

---

## 附錄 A：BDD Scenario 對應索引

| BDD Scenario | 對應章節 |
|--------------|---------|
| 解鎖/鎖定服務顯示 Edit/View Config 按鈕 | §2.7 ServiceRow、§6 #3 |
| 點擊 Edit Config 導航 + 載入狀態 | §2.6 ConfigEditorView、§5.2 |
| 載入失敗錯誤與重試 / 404 空編輯器 | §2.4 load()、§6 #6 |
| 編輯器載入 + INI 高亮 / 唯讀模式 | §2.5 UnitFileEditor |
| 500KB 效能提示 | §2.4 isLargeFile、§6 #5/#21 |
| dirty 狀態 + Save 啟用 + 驗證結果清除 | §2.4 useConfigEditor、§5.1 |
| INI 固定編輯器設定（CodeMirror） | §2.5、§2.6 對照表 |
| Validate 通過/失敗/不可用/空內容/格式錯誤 | §2.6 onValidate、§3.3 |
| systemd-analyze 警告視為通過 | §1.4 ValidateConfig、§6 #13 |
| Save ConfirmModal / 取消 / 成功 / 失敗 / reload 半成功 / 409 / 空內容 / 權限 / 網路中斷 | §2.6 save 流程、§3.2、§6 #7/#16/#17/#18 |
| Cancel clean/dirty/Stay/Discard / 返回鍵 | §2.6 requestLeave、§5.3 |
| 權限不足讀取 | §2.6 error 狀態、§3.1、§6 #17 |
| GET/PUT/validate 三 API 全部 @api Scenario | §3 合約表 + §6 對應列 |
| 備份 5 份 / audit / daemon-reload 逾時 / 無悲觀鎖定 / 僅 /etc 可編輯 | §1.3、§1.6、§4.2、§6 #8/#9/#23 |
| 主題切換 / RWD / Dashboard 狀態更新 | §2.5 theme compartment、§7、§8 步驟 15 |
| 語法錯誤 Outline ×4 / 無效名稱 Outline ×5 | §1.4 regex 解析、§3、§6 #14/#19 |
