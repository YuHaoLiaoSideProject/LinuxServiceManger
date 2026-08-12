# 開發方案決策文件：服務設定檔編輯器（service-config-editor）

## 📌 決策摘要

| 項目 | 內容 |
|------|------|
| **最終方案** | 後端新增 `ConfigStore`（讀取 / checksum 衝突偵測 / 備份保留 5 份 / atomic write / systemd-analyze 驗證）+ 3 個 config API（GET / PUT / validate）；前端以 **CodeMirror 6**（非 Monaco）實作內嵌編輯器，路由級 lazy-load，`onBeforeRouteLeave` + ConfirmModal 做 dirty 防護 |
| **決策日期** | 2026-08-12 |
| **對應 Roadmap** | Phase 3 — `docs/development/002-expansion-roadmap.md` 項目 #9 |
| **輸入文件** | `docs/interaction-flows/012-service-config-editor.md`（BDD 尚未產生，以 interaction flow 為主） |
| **共識程度** | ✅ 確認通過 |

---

## 1. 需求回顧

### 1.1 核心業務價值

讓管理員在 Web UI 中直接檢視與編輯 systemd service unit file（`/etc/systemd/system/*.service`），內建語法驗證與變更確認機制，補齊「狀態監控 → 啟停控制 → 日誌檢視 → 設定檔編輯」的最後一哩路，不需每次 SSH 進機器。編輯 → 驗證 → 儲存三步驟工作流降低人為錯誤，所有檢視與儲存操作記錄 audit log。

### 1.2 功能邊界

| 項目 | 範圍 |
|------|------|
| **Must Have (P0)** | `GET /api/v1/services/{name}/config` 讀取、`PUT /api/v1/services/{name}/config` 儲存（含備份、atomic write、daemon-reload）、`POST /api/v1/services/{name}/config/validate` 語法驗證、路徑遍歷防護、`/etc/systemd/system/` 權限邊界、鎖定服務唯讀檢視、dirty-state 防護、audit log（`config_view` / `config_save`） |
| **Should Have (P1)** | checksum 並發衝突偵測（409）、備份保留 5 份自動清理、500KB 檔案上限（413）、空內容儲存警告、systemd-analyze 不可用時的黃色降級警告、深色/淺色主題切換 |
| **Nice to Have (P2)** | 編輯器 diff 模式、錯誤行號 → 編輯器標記連動的即時 re-validate |

### 1.3 既有基礎

- 後端已有 chi v5 路由群組 + `AuthMiddlewareComposite`（Bearer 或 session）、`writeJSON` 輔助函式
- `internal/systemd` 已有 `Service` 結構（含 `FragmentPath`、`Locked`）、`ValidateServiceName`、`isLocked()`（`/etc/systemd/system/` prefix + dbus- + static/masked/alias + `UNLOCKED_SERVICES` env 覆寫）
- `internal/audit` 已有 `Module.Write()` 與 JSONL 持久化、`Action` 常數 + `actionDisplayLabels` 在地化對照
- `internal/token` 已示範 atomic write（temp file + rename）與檔案鎖 pattern
- 前端已有路由級 lazy-load pattern（`AuditLogView` / `TokenManageView` 以 `() => import()` 註冊）、`ConfirmModal.vue`、`ToastContainer.vue` + `useToast`、`ServiceRow.vue` / `ServiceTable.vue`、`useTheme.ts`（深淺主題切換）
- 前端依賴極精簡：僅 `vue` / `vue-router` / `pinia` / `axios` 四個 runtime 依賴；PWA 透過 `vite-plugin-pwa` precache 所有 build 產物
- 建置產出 `../src/static`，由 Go binary 以 embedded 方式提供 — **所有前端資產必須自行托管，不可依賴 CDN**

---

## 2. 關鍵技術決策

### 決策 1：內嵌編輯器選型（CodeMirror 6 vs Monaco Editor vs textarea）

> 上游 interaction flow 多次以「Monaco Editor」為預設，但 Roadmap 原文為「Monaco Editor 或 CodeMirror」。本決策以 bundle size、專案零大型依賴 pattern、embedded 部署方式為準，裁定為 **CodeMirror 6**。

| 方案 | 描述 | 優點 | 缺點 |
|------|------|------|------|
| **A. CodeMirror 6（選定）** | 模組化編輯器（`@codemirror/state`、`view`、`language`、`commands`、`search` + `@codemirror/legacy-modes` 提供 INI 高亮） | 核心全量約 **350KB min / ~130KB gzip**，可 tree-shake；不需 web worker；API 為現代 ESM，配合 Vite code-splitting 乾淨；主題可程式化切換（`EditorView.theme` compartment）滿足深淺模式需求；行號 gutter、行標記（波浪線/❌）、lint panel 均內建 | 需自行組合套件（相比 Monaco 開箱即用）；無內建 diff editor（P2 需另加 `@codemirror/merge`） |
| B. Monaco Editor | 完整 IDE 級編輯器（VS Code 核心） | 功能最強、內建 diff、language service、minimap；interaction flow 原始預設 | 全量約 **4–5MB minified / ~1.2MB+ gzip**；即使動態 import，進入編輯頁即下載數 MB；`vite-plugin-monaco-editor` 需額外建置設定；與專案「零大型依賴」pattern 直接衝突；PWA precache 暴漲 |
| C. textarea + 自製高亮 | 原生 textarea + overlay 自製語法高亮 | 零依賴 | 自製高亮效能差、捲動同步複雜、無行號/標記/錯誤定位能力；功能遠低於驗收清單（錯誤波浪線、gutter icon、主題切換） |

> **決策**：方案 A。CodeMirror 6 以約 1/10 的體積提供本功能所需的全部能力（INI 高亮、行號、gutter 標記、line decoration 紅色波浪線、行包繞、程式化主題切換）。考量：(1) 專案 runtime 依賴僅 4 個、零大型依賴 pattern；(2) build 產物由 Go binary embedded 提供、PWA precache 所有 JS — Monaco 的 1.2MB+ gzip 會拖垮首載與離線快取，CodeMirror 的 ~130KB gzip 可接受；(3) systemd unit file 語法即 INI 子集（`[Section]` + `Key=Value`），用 `legacy-modes` 的 `StreamLanguage.define(ini)` 即可達成驗收項「section 以不同顏色標示」；(4) interaction flow 中 Monaco 專屬設定（`minimap=off`、`language=ini`、`wordWrap=on`）在 CodeMirror 對應為「無 minimap 概念 / INI StreamLanguage / `EditorView.lineWrapping`」，不影響任何驗收項目。
>
> **規格**：`language: ini`（StreamLanguage）、`tabSize: 2`、`lineWrapping: true`、`lineNumbers: true`。編輯器邏輯封裝於 `UnitFileEditor.vue`（props: `modelValue` / `readOnly`；emits: `update:modelValue`），若未來需求升級 Monaco，替換僅限此元件。

### 決策 2：systemd 語法驗證實作方式

| 方案 | 描述 | 優點 | 缺點 |
|------|------|------|------|
| **A. systemd-analyze verify 暫存檔（選定）** | 前端把目前內容 POST 到 `/config/validate`；後端寫入 `/tmp/lsm-validate-{uuid}.service`，執行 `systemd-analyze verify {tmp}`（10s 逾時），解析輸出後刪除暫存檔，回傳 `{valid, errors:[{line,message}]}` | **權威驗證** — 直接使用系統真實解析器，可偵測 unknown key、非法 directive 值、Exec 路徑問題等；與 systemd 版本完全一致；符合 interaction flow 設計 | 依賴伺服器有 systemd（容器內可能無）；每次驗證耗時約數百 ms；需管理暫存檔生命週期 |
| B. 純前端語法檢查 | 前端以 INI 正規表達式解析 section/key 格式 | 即時、零伺服器往返 | 只能檢查「格式形狀」，無法驗證 directive 名稱/值是否合法（如 `ExecStartt` 拼錯字無法偵測 — 恰好是驗收清單的範例錯誤）；假陰性高，無法取代 systemd 真實行為 |
| C. 自製 Go 語法解析器 | 以 Go 重新實作 systemd 語法規則 | 不依賴外部指令 | 必須 mirror systemd 規則，維護成本高、必然與真實解析器產生分歧；投入產出比極差 |

> **決策**：方案 A，並以「前端輕量前置檢查」為輔助。後端執行流程：`exec.LookPath("systemd-analyze")` → 不存在或執行失敗時**不回傳 500**，改回傳 `200 {valid:false, available:false, errors:[], message:"systemd-analyze 指令不存在"}`，前端顯示黃色警告（不阻塞儲存，符合 interaction flow 的 VError 分支）。輸出解析：exit code 0 → valid；否則以正規表達式萃取 `{path}:{line}: {message}` 模式（systemd-analyze 輸出格式）填入 `errors[]`。暫存檔以 `defer os.Remove` 保證刪除，檔名含 UUID 避免並發碰撞、權限 0600。
>
> **前端輔助**：點擊 Validate 時先做空內容檢查（「設定檔內容為空」提示）與最小 INI 前置檢查（section 行需以 `[` 開頭結尾），通過才發送請求 — 這層檢查是 UX 快速回饋，不是安全/正確性依賴。儲存**不強制**要求先驗證通過（依 interaction flow，驗證失敗仍可儲存），但 ConfirmModal 中會顯示上次驗證失敗的提醒文字。

### 決策 3：備份機制設計

| 方案 | 描述 | 優點 | 缺點 |
|------|------|------|------|
| **A. 同目錄備份 + 固定寬度時間戳 + 保留 5 份（選定）** | 每次儲存前將現行檔**複製**為 `{name}.service.bak.{20060102T150405Z}`（UTC、固定寬度、字典序=時間序），glob 同 prefix 檔名、保留最新 5 份刪除最舊 | 備份與 unit file 同磁碟同目錄，還原不需跨裝置；固定寬度時間戳使「保留 N 份」的排序正確且簡單（`sort.Strings` 即時序）；備份檔名含服務名便於人工辨識與清理；符合 interaction flow 命名規範 | 備份檔會累積於 systemd 目錄（已被 5 份上限控制）；同一目錄寫入需注意目錄權限 |
| B. 集中備份目錄（如 `/var/lib/linux-service-manager/backups/`） | 備份統一存放於資料目錄 | 目錄乾淨、可統一管理 | systemd 掃描目錄（`systemctl daemon-reload`）不會影響，但人工 `ls /etc/systemd/system/` 看不到備份、還原路徑隔離；跨檔案系統 rename 不可用（需 copy） |
| C. 版本控制式備份（git / sqlite history） | 以 VCS 或 DB 記錄所有歷史版本 | 可回溯任意版本、可 diff | 過度設計；新增依賴；unit file 不在 VCS 管轄範圍 |

> **決策**：方案 A。具體規則：
>
> 1. **命名**：`{name}.service.bak.{20060102T150405Z}`（`nginx.service.bak.20260812T153045Z`）。interaction flow 規定 ISO8601 時間戳；採用無冒號的 compact RFC3339 變體 — 固定寬度保證字典序 = 時間序（prune 只需排序字串）、避免冒號在部分工具鏈（如某些 shell glob / Windows 不相容命名）造成問題、仍可被 `time.Parse(time.RFC3339)` 變體解析回真實時間。
> 2. **保留策略**：寫入前先 prune — 以 `{name}.service.bak.` 為 prefix glob 同目錄，字串降冪排序，保留前 5 份，其餘刪除（包含本次即將建立者則保留前 4 + 本次 = 5）。
> 3. **建立方式**：`os.ReadFile` 現行檔後以 `os.WriteFile` 建立備份（**copy，非 rename** — 現行檔必須保留原位，主寫入用 atomic rename 覆蓋）。
> 4. **主寫入（atomic write）**：寫入同目錄暫存檔 `.{name}.service.tmp.{rand}` → `fchmod` 保留原檔 mode（或預設 0644）→ `fsync` → `os.Rename` 覆蓋 FragmentPath。rename 在同目錄內為原子操作，失敗時原檔完好、立即嘗試以備份還原。
> 5. **還原策略（針對上游文件矛盾處的裁決）**：interaction flow 3.2 流程圖在 daemon-reload 失敗時畫了「還原備份檔」，但異常處理表與驗收清單均明確寫「daemon-reload 失敗時**不還原**設定檔，但回傳錯誤 + 備份路徑」。裁定以後者為準：**僅在「檔案寫入失敗」時還原備份；daemon-reload 失敗不還原** — 寫入已成功且內容合法（或至少是管理員意圖內容），daemon-reload 失敗通常是 systemd 狀態問題（dbus 異常等）而非檔案問題，還原會抹掉一次合法編輯。回傳 `500 {error, backup_path}` 讓管理員 SSH 處理。

### 決策 4：並發衝突偵測（checksum 409 vs 悲觀鎖定）

| 方案 | 描述 | 優點 | 缺點 |
|------|------|------|------|
| **A. Optimistic concurrency — checksum 比對（選定）** | `GET` 回傳檔案 SHA-256 hex 作為 `checksum`；`PUT` 的 body 帶 `base_checksum`（載入時的 checksum）；後端在寫入前重新計算現行檔 checksum，不一致 → `409 Conflict` + 附上 `current_checksum`，前端提示重新載入 | 無狀態、無額外 API/資源、符合 interaction flow 明確定義（last-write-wins + 偵測）；單一管理員場景下衝突機率低，偵測成本極低 | 衝突僅在寫入瞬間才被發現（非即時）；需要前端保存 base_checksum 並於 409 後提供重新載入流程 |
| B. 悲觀鎖定（lock table） | 編輯開始時取得鎖、結束釋放；鎖需 TTL 與過期清理 | 寫入前即可阻止並發編輯 | 需新增鎖的取得/釋放/續期 API 與儲存；用戶端斷線/瀏覽器關閉造成鎖洩漏需清理機制；管理員數量極少，鎖爭用機率近乎零 — 成本全付、收益極低 |
| C. 無偵測（純 last-write-wins） | 直接覆寫 | 最簡單 | 靜默覆蓋他人編輯，不符合 interaction flow 異常處理表要求（409） |

> **決策**：方案 A。`checksum = sha256(file content)`（hex）。PUT 必填 `base_checksum`（缺省回 400）— 防止舊前端/腳本繞過衝突偵測。409 回應體：`{"error":"設定檔已被其他使用者修改。請重新載入後再編輯。","current_checksum":"..."}`；前端收到 409 後以 Toast 提示 + 提供「重新載入」動作（重新 GET 並以 `current_checksum` 更新 base）。此決策與「後端不做鎖定」的 interaction flow 邊界限制一致。

### 決策 5：路徑安全防護（FragmentPath 驗證）

| 方案 | 描述 | 優點 | 缺點 |
|------|------|------|------|
| **A. 後端權威路徑驗證（選定）** | API **不接受用戶端傳遞路徑**（僅接受 `{name}`）；後端以既有 `ValidateServiceName` 驗證名稱 → 查詢該服務的 FragmentPath → `filepath.Clean` + `filepath.Rel` 確認位於 `/etc/systemd/system/` 下 → 寫入前額外檢查副檔名 `.service` 與 symlink 解析 | 攻擊面最小：用戶端無法指定寫入目標；多層防禦（名稱白名單、路徑正規化、字首邊界、symlink 解析） | 依賴 systemd 查詢結果正確（可信來源） |
| B. 字首比對（strings.HasPrefix） | 沿用 `isLocked()` 現行做法，僅檢查 prefix `/etc/systemd/system/` | 最簡單 | **脆弱**：`/etc/systemd/system-evil/`、`/etc/systemd/systemx/` 皆通過 prefix 檢查；且未處理 `..` 元件與 symlink |
| C. 用戶端傳路徑 + 後端驗證 | body 帶 target path | 彈性 | 徒增攻擊面；路徑驗證邏輯必須完美，否則即為 path traversal 漏洞；無任何必要 |

> **決策**：方案 A。完整驗證鏈（寫入時，讀取時同構）：
>
> 1. `ValidateServiceName(name)`（既有 regex：`^[A-Za-z0-9@._-]+$` 等）→ 失敗回 400
> 2. 以 `systemctl show {name} --property=FragmentPath` 取得路徑（**信任來源為 systemd，非用戶端**）
> 3. `filepath.Clean(path)` 後，`rel, err := filepath.Rel("/etc/systemd/system/", clean)`；若 `rel == "."` 或開頭為 `..` 或含 `/` 之外的跳脫 → 回 403（比 `strings.HasPrefix` 嚴格，可擋 `/etc/systemd/system-xxx` 旁路）
> 4. 寫入（PUT）額外要求 `filepath.Ext(path) == ".service"`（僅 `.service` 可編輯，`.timer`/`.socket` 不可 — interaction flow 邊界）
> 5. **Symlink 防護**：對存在的目標檔執行 `filepath.EvalSymlinks`，解析後結果必須仍在 `/etc/systemd/system/` 下（防 `foo.service -> /etc/passwd` 這類 symlink 覆寫）；檔不存在時對其 parent 目錄做 EvalSymlinks 檢查
> 6. 大小限制：讀取與寫入皆以 `MaxConfigSize = 500 * 1024`（500KB）為界，超過回 413
>
> **權限邊界裁決**：API 的授權邊界以**路徑**為準，而非 `locked` 旗標。`isLocked()` 的 `UNLOCKED_SERVICES` env 可將 `/usr/lib` 服務顯示為 unlocked（UI 出現 Edit 按鈕），此時 API 仍因路徑不在 `/etc/systemd/system/` 下而回 403 — **UI 可見性不等於後端授權**，後端路徑檢查是唯一安全邊界。

### 決策 6：前端 dirty-state 管理與未儲存變更防護

| 方案 | 描述 | 優點 | 缺點 |
|------|------|------|------|
| **A. 路由 guard + 頁內 Modal + beforeunload 三層（選定）** | `onBeforeRouteLeave` 於 dirty 時攔截並彈出 ConfirmModal（Stay / Discard）；頁內 Cancel 按鈕走同一流程；`beforeunload` handler 在 dirty 時回傳觸發瀏覽器原生確認 | 覆蓋導航（瀏覽器返回鍵、側邊連結、程式導航）與分頁關閉兩種情境；重用既有 `ConfirmModal.vue`；符合 interaction flow 全部驗收項（含「瀏覽器返回鍵觸發同樣的 dirty-check 邏輯」） | 三處邏輯需共用單一 dirty flag，避免不一致；`beforeunload` 只能顯示瀏覽器原生對話框（無法自訂樣式） |
| B. 僅頁內 Modal | 只有 Cancel 按鈕彈 Modal | 最簡單 | 瀏覽器返回鍵、重新整理、路由跳轉全部繞過 → 未儲存變更直接遺失，不符合驗收清單 |
| C. 僅全域 route guard | `router.beforeEach` 檢查全域 dirty state | 覆蓋所有導航 | 無法覆蓋分頁關閉/重新整理；全域狀態需以 module-level 變數傳遞（醜）；route guard 內彈 Modal 需 wait 非同步決策（較複雜） |

> **決策**：方案 A。實作方式：dirty 狀態以 composable `useConfigEditor()` 回傳的 reactive `isDirty` 管理（對比初始內容與目前內容）；導航離開採用 `onBeforeRouteLeave` 中 `return new Promise(resolve => 彈出 ConfirmModal)` 的非同步確認 pattern（Stay → resolve(false)、Discard → 設 dirty=false 後 resolve(true)）；`onBeforeRouteUnmount`/`onMounted` 註冊 `beforeunload` 監聽（dirty 時 `e.preventDefault(); e.returnValue = ''`）。儲存成功後 `isDirty` 設為 false 並導航回 Dashboard（1.5s 後自動返回或手動點擊 — 依 interaction flow，自動返回僅在成功時、此時 dirty 已清，guard 自然放行）。

### 決策 7：編輯器載入策略與 PWA bundle 影響

| 方案 | 描述 | 優點 | 缺點 |
|------|------|------|------|
| **A. 路由級 lazy-load + CodeMirror 動態 import + chunk 納入 precache（選定）** | `ConfigEditorView` 以 `() => import()` 註冊（沿用 AuditLogView / TokenManageView pattern）；`UnitFileEditor.vue` 內部再 `await import('codemirror...')` 組合編輯器；Vite 將編輯器拆為獨立 chunk（約 130KB gzip） | 首屏（Dashboard）完全不載入編輯器程式碼；編輯器 chunk 規模可控，可直接納入 PWA precache（`globPatterns` 已含 `**/*.js`），離線進入編輯頁亦可使用；無需 worker、無 CDN | 首次進入編輯頁需下載 ~130KB（在內網/本機部署情境可忽略）；需處理動態 import 期間的 loading spinner（interaction flow 已設計） |
| B. Monaco 動態 import | `vite-plugin-monaco-editor` + 動態載入 | 仍可避免首屏載入 | 進入編輯頁瞬間下載 1.2MB+ gzip；PWA precache 增加 1.2MB+（`globPatterns` 無法簡單排除，需 `globIgnores` 客製），或改用 runtime cache 使離線編輯不可用；多語系 worker 設定複雜 |
| C. 全量打包（無動態 import） | 編輯器直接進主 bundle | 最簡單 | 主 bundle 暴漲 ~130KB+（CodeMirror）或 ~1.2MB+（Monaco）；違背既有 lazy-load pattern，Dashboard 首載受拖累 |

> **決策**：方案 A。既有 `AuditLogView` / `TokenManageView` 已示範路由級 lazy-load，本功能沿用。CodeMirror 6 無 web worker 依賴（相較 Monaco 的 worker 資產），動態 import 乾淨單純。PWA 影響：編輯器 chunk（~130KB gzip）由 workbox 以既有 `globPatterns`（`**/*.js`）自動 precache — 規模可接受，且換來離線編輯能力；若未來體積成長，可在 `globIgnores` 排除編輯器 chunk 改走 runtime cache（`StaleWhileRevalidate`，已存在於 vite.config）。

---

## 3. 架構概覽

### 3.1 新增模組結構

```
src/internal/systemd/
├── config.go            # ConfigStore：讀取、checksum、備份/清理、atomic write（新）
├── config_validate.go   # systemd-analyze 驗證（暫存檔、逾時、輸出解析）（新）
└── config_test.go       # 單元測試（新）

src/internal/handler/
└── config_handler.go    # HandleGetServiceConfig / HandleSaveServiceConfig / HandleValidateServiceConfig（新）

frontend/src/
├── views/ConfigEditorView.vue     # 路由視圖：載入、驗證面板、儲存流程、dirty guard（新）
├── components/UnitFileEditor.vue  # CodeMirror 6 封裝（INI 高亮、行標記、主題切換）（新）
├── composables/useConfigEditor.ts # dirty state、載入/儲存/驗證邏輯（新）
├── api/client.ts                  # getServiceConfig / saveServiceConfig / validateServiceConfig（擴充）
└── types/service.ts               # ServiceConfigResponse 等型別（擴充）
```

### 3.2 系統架構圖

```
┌─────────────────────────────────────────────────────────┐
│  Browser (Vue SPA)                                       │
│                                                          │
│  Dashboard → ServiceRow「Edit Config / View Config」     │
│       │ route: /services/:name/config (lazy)             │
│       ▼                                                  │
│  ConfigEditorView.vue                                    │
│  ┌────────────────────────────────────────────────────┐  │
│  │ UnitFileEditor.vue (CodeMirror 6)                   │  │
│  │ • INI 高亮 • 行號 • gutter ❌/波浪線 • lineWrapping  │  │
│  │ • readOnly(鎖定服務) / 深淺主題 compartment          │  │
│  ├─ useConfigEditor.ts (isDirty / baseChecksum / api)  │  │
│  ├─ ValidatePanel（綠/紅/黃三態）                       │  │
│  └─ ConfirmModal（儲存確認 / 離開確認）                 │  │
│  └─ onBeforeRouteLeave + beforeunload (dirty guard)     │  │
└────────────────────────┬────────────────────────────────┘
                         │ GET/PUT/validate
┌────────────────────────┼────────────────────────────────┐
│  Go Backend            ▼                                 │
│  AuthMiddlewareComposite → chi /api/v1/services group    │
│  ┌──────────────────────────────────────────────────┐   │
│  │ handler.config_handler.go                         │   │
│  │ GET    /{name}/config          → view + audit    │   │
│  │ PUT    /{name}/config          → save + audit    │   │
│  │ POST   /{name}/config/validate → verify           │   │
│  └───────────────┬──────────────────────┬───────────┘   │
│                  ▼                      ▼                │
│  ConfigStore (internal/systemd)   ConfigStore.Validate   │
│  • ValidateServiceName            • /tmp/lsm-validate-   │
│  • FragmentPath lookup              {uuid}.service       │
│  • Clean+Rel 路徑邊界             • systemd-analyze      │
│  • EvalSymlinks 防 symlink          verify (10s timeout) │
│  • checksum 比對 (409)            • 解析輸出 → errors    │
│  • backup {name}.service.bak.ts   • defer 刪除暫存       │
│  • prune 保留 5 份                                        │
│  • atomic write (tmp+fsync+rename)                       │
│  • systemctl daemon-reload (10s)                         │
│  └───────────────┬──────────────────────────────────────┘
│                  ▼
│  audit.Module: config_view / config_save → audit.jsonl
└──────────────────────────────────────────────────────────┘
```

### 3.3 資料結構

```go
// GET /config 回應
type ServiceConfigResponse struct {
    Name         string `json:"name"`
    FragmentPath string `json:"fragment_path"`
    Config       string `json:"config"`
    Size         int64  `json:"size"`      // bytes
    Checksum     string `json:"checksum"`  // SHA-256 hex，供 PUT base_checksum
}

// PUT /config body
type SaveConfigRequest struct {
    Config       string `json:"config"`
    BaseChecksum string `json:"base_checksum"` // GET 回傳的 checksum，必填
}

// PUT /config 回應
type SaveConfigResponse struct {
    Message    string `json:"message"`
    BackupPath string `json:"backup_path"` // 例: /etc/systemd/system/nginx.service.bak.20260812T153045Z
}

// POST /config/validate 回應
type ValidateResult struct {
    Valid     bool           `json:"valid"`
    Available bool           `json:"available"` // false = systemd-analyze 不可用（黃色警告）
    Errors    []ValidateErr  `json:"errors"`
    Message   string         `json:"message,omitempty"` // 不可用原因
}

type ValidateErr struct {
    Line    int    `json:"line"`
    Message string `json:"message"`
}
```

### 3.4 API Endpoint 設計

| Method | Path | Auth | 說明 |
|--------|------|------|------|
| `GET` | `/api/v1/services/{name}/config` | Composite | 讀取 FragmentPath 內容；鎖定服務（`/usr/lib` 等）亦可讀（唯讀檢視） |
| `PUT` | `/api/v1/services/{name}/config` | Composite | 儲存（限 `/etc/systemd/system/` + `.service`）；備份、checksum 衝突偵測、atomic write、daemon-reload |
| `POST` | `/api/v1/services/{name}/config/validate` | Composite | 以 `systemd-analyze verify` 驗證 body 內容 |

### 3.5 回應格式

```json
// GET /api/v1/services/nginx/config → 200
{
  "name": "nginx.service",
  "fragment_path": "/etc/systemd/system/nginx.service",
  "config": "[Unit]\nDescription=nginx...\n\n[Service]\nExecStart=/usr/sbin/nginx...",
  "size": 412,
  "checksum": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"
}

// PUT /api/v1/services/nginx/config → 200
{
  "message": "nginx.service 設定檔已儲存，daemon-reload 已執行",
  "backup_path": "/etc/systemd/system/nginx.service.bak.20260812T153045Z"
}

// PUT 衝突 → 409
{ "error": "設定檔已被其他使用者修改。請重新載入後再編輯。", "current_checksum": "5f8c..." }

// POST /api/v1/services/nginx/config/validate → 200 valid=false
{ "valid": false, "available": true,
  "errors": [ { "line": 12, "message": "Unknown key name 'ExecStartt'" } ] }

// POST validate，systemd-analyze 不存在 → 200 available=false
{ "valid": false, "available": false, "errors": [],
  "message": "systemd-analyze 指令不存在，無法進行語法驗證" }

// 錯誤碼：400 名稱/請求格式錯誤｜403 路徑不在可編輯範圍｜404 服務或檔案不存在
// ｜409 checksum 衝突｜413 超過 500KB｜500 寫入/daemon-reload 失敗（附 backup_path）
```

### 3.6 儲存流程偽代碼

```go
func (h *Handler) HandleSaveServiceConfig(w http.ResponseWriter, r *http.Request) {
    name := chi.URLParam(r, "name")
    if err := systemd.ValidateServiceName(name); err != nil { writeJSON(w, 400, errResp(err)); return }

    path, err := h.systemd.FragmentPathOf(name)          // systemctl show → 信任來源
    if err != nil { writeJSON(w, 404, "服務不存在"); return }
    if !underEtcSystemd(path) || filepath.Ext(path) != ".service" { writeJSON(w, 403, "不允許編輯此設定檔"); return }
    if resolved, err := filepath.EvalSymlinks(path); err != nil || !underEtcSystemd(resolved) { writeJSON(w, 403, ...); return }

    var req SaveConfigRequest
    if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.BaseChecksum == "" { writeJSON(w, 400, ...); return }
    if len(req.Config) > MaxConfigSize { writeJSON(w, 413, ...); return }

    current := sha256Hex(path)
    if current != req.BaseChecksum { writeJSON(w, 409, map[string]string{"error": ..., "current_checksum": current}); return }

    backupPath := backup(path)          // copy → {name}.service.bak.{ts}
    pruneBackups(path, 5)               // glob + 降冪排序保留 5 份

    if err := atomicWrite(path, req.Config); err != nil {
        restore(backupPath, path)       // 僅寫入失敗時還原
        writeJSON(w, 500, "寫入失敗" + backupPath); return
    }

    if err := daemonReload(10*time.Second); err != nil {   // 不還原
        writeJSON(w, 500, map[string]string{"error": "設定檔已儲存，但 daemon-reload 失敗: "+err.Error(), "backup_path": backupPath}); return
    }

    h.Audit.Write(audit.Entry{Action: audit.ActionConfigSave, Target: name, Detail: backupPath, ...})
    writeJSON(w, 200, SaveConfigResponse{Message: ..., BackupPath: backupPath})
}
```

---

## 4. 與現有模組的整合

### 4.1 main.go 路由變更

在既有 `/api/v1/services` 群組（`AuthMiddlewareComposite` 保護）內新增 3 條路由：

```go
r.Get("/api/v1/services/{name}/config", h.HandleGetServiceConfig)
r.Put("/api/v1/services/{name}/config", h.HandleSaveServiceConfig)
r.Post("/api/v1/services/{name}/config/validate", h.HandleValidateServiceConfig)
```

`Handler` struct 不需新增欄位 — `ConfigStore` 可作為 `internal/systemd` 套件的函式集合（與 `ListServices` 相同風格）或獨立 struct，由 handler 直接呼叫（既有 handler 已直接呼叫 `systemd.StartService` 等套件函式）。若採 struct 注入，`Handler` 新增 `Config *systemd.ConfigStore` 欄位並在 `New()` 初始化。

### 4.2 Audit Log 整合

```go
const (
    ActionConfigView Action = "config_view" // GET config 成功時
    ActionConfigSave Action = "config_save" // PUT 成功（含 reload 失敗但已寫入）時
)
```

需同步更新：`validActions` map、`actionDisplayLabels` map（「檢視設定檔」/「儲存設定檔」）、前端 `useI18n.ts` 的 action 翻譯、AuditLogView 的 action filter（若為白名單）。儲存時 daemon-reload 失敗屬「已寫入但未生效」的半成功狀態 — audit `result` 欄位記錄 `success` 但 `detail` 附註 reload 錯誤，供稽核追蹤。

### 4.3 前端整合

- **ServiceRow.vue**：`locked: false` → 「Edit Config」按鈕；`locked: true` → 「View Config」按鈕（兩者皆需 `fragmentPath` 非空，空則隱藏）— 皆導航 `/services/{name}/config`
- **router/index.ts**：`{ path: '/services/:name/config', name: 'config-editor', component: () => import('../views/ConfigEditorView.vue'), meta: { auth: true } }`
- **api/client.ts**：`getServiceConfig(name)` / `saveServiceConfig(name, config, baseChecksum)` / `validateServiceConfig(name, config)`（axios，409 以 error response 處理）
- **ConfigEditorView.vue**：依 store 中該服務的 `locked` 決定 `readOnly`；唯讀模式僅顯示 Close 按鈕（驗收項）
- **useTheme.ts**：CodeMirror 以 `Compartment` + `EditorView.theme` 動態切換深淺主題，監聽現有 theme composable

### 4.4 不變更的部分

- `ServiceManager` interface 與既有 handler（start/stop/restart/enable/disable/batch）— config 功能以新增檔案/路由方式附加，不改動既有簽名（避免 3 個 handler 測試檔的 fake 大改）
- `isLocked()` 邏輯 — API 安全邊界獨立於 UI 旗標（見決策 5 裁決）
- Login / HTML routes / WebSocket / static serving
- 反向代理 (nginx) 與部署腳本 — 無新依賴、無新外部資源

---

## 5. 風險評估

| 風險 | 可能性 | 影響 | 緩解措施 |
|------|--------|------|---------|
| 路徑遍歷 / symlink 覆寫寫入系統檔案 | 低 | **極高** | 用戶端無法傳路徑；`filepath.Clean`+`Rel` 邊界檢查 + `EvalSymlinks` 解析（含 parent 目錄）；僅 `.service` 副檔名；單元測試覆蓋 `../`、`/etc/systemd/system-evil/`、symlink 案例 |
| 並發編輯互相覆蓋 | 低 | 中 | checksum 409 + 前端重新載入流程；單一管理員場景衝突率極低 |
| `UNLOCKED_SERVICES` env 解鎖非 /etc 服務後 UI 顯示可編輯 | 低 | 高 | API 以路徑為唯一授權邊界（決策 5），UI 按鈕可顯示但 API 一律 403 |
| daemon-reload 失敗 | 中 | 中 | 不還原（保留合法編輯）、回傳 `backup_path`、audit 記錄；互動流程已定義降級 UX |
| systemd-analyze 不存在（容器部署） | 中 | 低 | `available:false` 黃色警告，不阻塞儲存 |
| 備份檔累積佔用磁碟 | 低 | 低 | 保留 5 份 prune；備份與 unit file 同目錄、檔名可辨識 |
| 編輯器 bundle 增大影響 PWA | 中 | 中 | CodeMirror ~130KB gzip 可接受並納入 precache；路由級 lazy-load 不影響首屏；未來可 `globIgnores` 排除 |
| 暫存檔殘留（驗證中斷） | 低 | 低 | `defer os.Remove`；UUID 檔名避免碰撞；啟動時可選清理 `/tmp/lsm-validate-*` |
| 前端 dirty guard 遺漏路徑（如直接關閉分頁） | 中 | 低 | 三層防護（route guard + 頁內 Modal + beforeunload）；資料遺失最壞情況僅限未儲存編輯 |

---

## 6. 實作順序建議

| 優先級 | 任務 | 預估工時 | 依賴 |
|--------|------|---------|------|
| **P0** | `internal/systemd/config.go` — 讀取、checksum、備份/prune、atomic write | 4h | - |
| **P0** | `internal/systemd/config_validate.go` — systemd-analyze 暫存檔驗證 + 輸出解析 | 2h | config.go |
| **P0** | `internal/handler/config_handler.go` — GET / PUT / validate 三 handler | 3h | config.go |
| **P0** | `src/main.go` 路由註冊 + `audit` 新增 `config_view` / `config_save` | 1h | handler, audit |
| **P0** | `frontend/src/components/UnitFileEditor.vue` — CodeMirror 封裝（INI 高亮、標記、主題） | 4h | - |
| **P0** | `frontend/src/composables/useConfigEditor.ts` + `api/client.ts` + `types/service.ts` | 1.5h | - |
| **P0** | `frontend/src/views/ConfigEditorView.vue` — 載入/驗證面板/儲存流程/dirty guard | 4h | 上述 |
| **P0** | `ServiceRow.vue` 按鈕 + router 註冊 | 30m | view |
| **P1** | 後端單元測試（路徑防護、checksum、backup/prune、validate parser） | 3h | config.go |
| **P1** | 前端元件測試（UnitFileEditor、ConfigEditorView、dirty guard、409 流程） | 3h | view |
| **P1** | Playwright E2E（進入 → 編輯 → 驗證 → 儲存 → 返回） | 2h | 全部 |

**總預估工時**：約 28 小時（約 3.5 工作天）

---

## 7. 相依與影響

| 項目 | 影響 |
|------|------|
| `src/internal/systemd/config.go` (new) | 新增檔案；不改動 `ServiceManager` interface |
| `src/internal/systemd/config_validate.go` (new) | 依賴 `systemd-analyze`（執行期，非建置期） |
| `src/internal/handler/config_handler.go` (new) | 新增 3 個 handler method |
| `src/internal/audit/audit.go` | 新增 `ActionConfigView`, `ActionConfigSave` + display labels |
| `src/main.go` | 新增 3 條路由 |
| `frontend/package.json` | **新增依賴**：`codemirror`, `@codemirror/state`, `@codemirror/view`, `@codemirror/language`, `@codemirror/commands`, `@codemirror/search`, `@codemirror/legacy-modes`（全部為 dev 可 tree-shake 的 ESM 套件；無框架綁定） |
| `frontend/src/views/ConfigEditorView.vue` (new) | 新路由視圖（lazy-load） |
| `frontend/src/components/UnitFileEditor.vue` (new) | CodeMirror 封裝元件 |
| `frontend/src/components/ServiceRow.vue` | 新增 Edit/View Config 按鈕 |
| `frontend/src/api/client.ts` | 新增 3 個 API 函式 |
| `frontend/src/composables/useI18n.ts` | 新增 action 翻譯（「檢視設定檔」「儲存設定檔」） |
| 反向代理 (nginx) / 部署 (install.sh) | 無需變更（無新後端依賴、無 CDN 資產） |

---

*最後更新：2026-08-12*
