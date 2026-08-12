# 服務設定檔編輯器 — 測試計畫

> **對應 BDD**：`docs/bdds/012-service-config-editor.feature`
> **操作流程**：`docs/interaction-flows/012-service-config-editor.md`
> **技術決策**：`docs/tech-decisions/012-service-config-editor.md`
> **對應 Roadmap**：Phase 3 — `docs/development/002-expansion-roadmap.md` 項目 #9
> **測試日期**：2026-08-12

---

## 0. 測試計畫決策備註（依 Tech Decision 裁決）

BDD 與 Tech Decision 存在下列差異，本測試計畫一律**以 Tech Decision 為準**，測試案例對應關係皆依此調整：

| # | 差異點 | BDD / Interaction Flow 描述 | Tech Decision 裁決（本計畫採用） |
|---|--------|------------------------------|----------------------------------|
| D-1 | **編輯器選型** | BDD / interaction flow 多次以 Monaco Editor 為預設（language=ini、tabSize=2、wordWrap=on、minimap=off） | **CodeMirror 6**（決策 1）。對應設定：`language: ini`（`StreamLanguage`）、`tabSize: 2`、`lineWrapping: true`（=wordWrap on）、`lineNumbers: true`；**無 minimap 概念**。編輯器邏輯封裝於 `UnitFileEditor.vue`（props: `modelValue`/`readOnly`；emits: `update:modelValue`） |
| D-2 | **GET 鎖定服務** | BDD Scenario「GET 鎖定服務（FragmentPath 不在 /etc/systemd/system/ 下）回傳 403」 | **GET 鎖定服務回 200 唯讀檢視**（決策 3.4：「鎖定服務（/usr/lib 等）亦可讀（唯讀檢視）」；決策 5 權限邊界裁決）。否則 BDD Scenario「唯讀模式檢視鎖定服務設定檔（View Config）」無法運作。**403 僅適用於 PUT**（寫入才受路徑邊界限制） |
| D-3 | **systemd-analyze 不可用** | BDD「驗證服務不可用（500 或網路錯誤）」 | 後端偵測 `systemd-analyze` 不存在時回 **HTTP 200 `{valid:false, available:false, message:"systemd-analyze 指令不存在..."}`（非 500 crash）**（決策 2）。僅真正伺服器錯誤（如暫存檔建立失敗）才回 5xx。前端對 `available:false`、500、網路錯誤一律顯示黃色警告且不阻塞儲存 |
| D-4 | **daemon-reload 失敗不還原** | interaction flow 3.2 流程圖於 reload 失敗時畫「還原備份檔」 | **daemon-reload 失敗不還原設定檔**（決策 3）：寫入已成功、內容為管理員意圖，還原會抹掉合法編輯。回 500 + `backupPath` 讓管理員自行處理 |
| D-5 | **僅寫入失敗還原** | — | **僅「檔案寫入失敗」時還原備份**（決策 3），回 500「寫入失敗」 |
| D-6 | **checksum 409** | BDD「後端比對寫入前後 checksum」 | **Optimistic concurrency**（決策 4）：GET 回傳 `checksum`（SHA-256 hex）；PUT body 必填 `base_checksum`（**缺省回 400**）；不一致回 **409 + `currentChecksum`**，前端提示重新載入並更新基準 |
| D-7 | **JSON 欄位命名** | BDD 使用 camelCase（`fragmentPath`、`backupPath`、`baseChecksum`、`currentChecksum`） | 採 **camelCase** — 與既有 `json_handler.go`（`fragmentPath`、`unitFileState`）及 BDD 一致（tech decision 偽代碼的 `fragment_path`/`backup_path` 不採用） |
| D-8 | **可編輯範圍判定** | BDD「僅 /etc/systemd/system/ 下的自訂服務可編輯」 | **API 授權邊界以路徑為準，非 locked 旗標**（決策 5）：`UNLOCKED_SERVICES` env 解鎖 /usr/lib 服務時 UI 顯示 Edit 按鈕，但 API 仍回 403 — 後端路徑檢查是唯一安全邊界 |
| D-9 | **dirty 防護** | BDD「瀏覽器返回鍵觸發相同的 dirty-check 邏輯」 | **三層防護**（決策 6）：`onBeforeRouteLeave`（含返回鍵/程式導航）+ 頁內 Cancel 同流程 + `beforeunload`（分頁關閉原生確認） |
| D-10 | **暫存檔命名/權限** | BDD「/tmp/lsm-validate-{uuid}.service」 | 檔名含 UUID 避免並發碰撞、**權限 0600**、`defer os.Remove` 保證刪除（決策 2） |

---

## 1. 測試範圍總覽

| 層級 | 範圍 | 工具 | 負責 |
|------|------|------|------|
| 單元測試 | Go `ConfigStore`（讀取 / checksum / 路徑驗證 / 備份 / atomic write / 衝突偵測） | `go test` | 後端 |
| 單元測試 | Go `config_validate`（systemd-analyze 暫存檔驗證 / 輸出解析 / 逾時） | `go test` | 後端 |
| 單元測試 | Go Config Handler（GET / PUT / validate 三 API + audit 寫入） | `go test` + `net/http/httptest` | 後端 |
| 單元測試 | Vue `ServiceRow.vue`（Edit/View Config 按鈕進入點） | Vitest 4.1.10 + @vue/test-utils 2.4.11 + happy-dom | 前端 |
| 單元測試 | Vue `UnitFileEditor.vue`（CodeMirror 6 封裝：INI 高亮 / 行標記 / 主題） | Vitest 4.1.10 + @vue/test-utils 2.4.11 | 前端 |
| 單元測試 | Vue `useConfigEditor.ts`（dirty state / baseChecksum / 儲存流程） | Vitest 4.1.10 + @vue/test-utils 2.4.11 | 前端 |
| 單元測試 | Vue `ConfigEditorView.vue`（載入 / Validate 面板 / Save 流程 / ConfirmModal / dirty guard） | Vitest 4.1.10 + @vue/test-utils 2.4.11 | 前端 |
| 單元測試 | Vue `api/client.ts` 擴充（get/save/validate config 三函式） | Vitest 4.1.10 | 前端 |
| 整合測試 | ConfigStore ↔ Handler ↔ Audit（真實檔案系統 / 暫存目錄） | `go test`（integration）/ 腳本 | 後端 |
| 端對端測試 | 完整使用者操作流程（進入 → 編輯 → 驗證 → 儲存 → 返回 + 異常分支） | Playwright 1.62.1 | 前端 |
| 手動驗證 | 真實 systemd 環境（daemon-reload 生效 / 備份實檔 / 權限 / 並發 / PWA 離線） | 手動 | QA |

---

## 2. 後端單元測試

> 新增測試檔：`src/internal/systemd/config_test.go`、`src/internal/handler/config_handler_test.go`
> 沿用既有 pattern：table-driven test + `httptest.NewRecorder` + `assertJSON` helper（`handler_test.go`）

### 2.1 ConfigStore — 讀取與 checksum（`internal/systemd/config.go`）

> 對應 BDD：GET API 各 Scenario

| # | 測試名稱 | Given | When | Then |
|---|---------|-------|------|------|
| SYS-01 | 讀取存在且可讀的設定檔 | FragmentPath 指向之檔案存在、可讀、內容為已知字串 | 呼叫 `ReadConfig(name, path)` | 回傳完整內容、size=位元組數、checksum=SHA-256 hex |
| SYS-02 | checksum 正確性 | 內容已知（如 `[Unit]\nDescription=test`） | 對讀取結果計算 checksum | 與 `sha256.Sum256` 手算結果一致，64 字元 hex 小寫 |
| SYS-03 | 相同內容 checksum 穩定、不同內容 checksum 不同 | 兩份內容僅差一個字元 | 分別計算 checksum | 相同內容 → 相同 checksum；不同內容 → 不同 checksum |
| SYS-04 | FragmentPath 為空 | 服務 FragmentPath = "" | 呼叫讀取 | 回傳「設定檔路徑不存在」錯誤（→ 404） |
| SYS-05 | 檔案不存在 | FragmentPath 指向之檔案不存在 | 呼叫讀取 | 回傳「設定檔不存在」錯誤（→ 404） |
| SYS-06 | 讀取權限不足 | 檔案 mode 000（無讀取權限） | 呼叫讀取 | 回傳 500 錯誤，錯誤訊息含「權限」原因 |
| SYS-07 | 檔案超過 500KB | 檔案大小 = 600000 bytes（> MaxConfigSize=500\*1024） | 呼叫讀取 | 回傳 413 錯誤，訊息說明超過 500KB 大小限制 |

### 2.2 ConfigStore — 路徑安全驗證（決策 5 完整驗證鏈）

> 對應 BDD：`@security` `@validation` — 路徑邊界 / 路徑遍歷 / symlink

| # | 測試名稱 | Given | When | Then |
|---|---------|-------|------|------|
| SYS-08 | 路徑在 /etc/systemd/system/ 下通過 | FragmentPath = `/etc/systemd/system/nginx.service` | 執行 `Clean` + `Rel("/etc/systemd/system/", path)` 驗證 | 通過，允許讀寫 |
| SYS-09 | /usr/lib 路徑拒絕 | FragmentPath = `/usr/lib/systemd/system/systemd-journald.service` | 執行路徑驗證 | 拒絕（403 邊界），不可編輯 |
| SYS-10 | /run 路徑拒絕 | FragmentPath = `/run/systemd/system/httpd.service` | 執行路徑驗證 | 拒絕（403 邊界），不可編輯 |
| SYS-11 | prefix 旁路攻擊 | FragmentPath = `/etc/systemd/system-evil/foo.service` 或 `/etc/systemd/systemx/foo.service` | 執行 `Rel` 驗證（非 `HasPrefix`） | 拒絕 — 證明採用 `Rel` 而非 `HasPrefix` |
| SYS-12 | 路徑遍歷 `..` | FragmentPath = `/etc/systemd/system/../../etc/passwd` | `filepath.Clean` 後執行 `Rel` | rel 開頭為 `..`，拒絕 |
| SYS-13 | 非正規化路徑 | FragmentPath = `/etc/systemd/system//nginx.service` 或含 `.` 元件 | `filepath.Clean` 後執行 `Rel` | 正規化後判定，不誤拒合法路徑（clean 後仍在下） |
| SYS-14 | symlink 指向目錄外 | 目標檔為 symlink → `/etc/passwd`（存在） | `filepath.EvalSymlinks(path)` 解析 | 解析結果不在 /etc/systemd/system/ 下，拒絕 |
| SYS-15 | parent 目錄 symlink 指向外部 | 目標檔不存在，但其 parent 目錄為 symlink → `/etc` 等外部目錄 | 對 parent 執行 `EvalSymlinks` | 解析結果脫離邊界，拒絕 |
| SYS-16 | 副檔名非 .service | FragmentPath = `/etc/systemd/system/backup.timer`（.timer / .socket） | 檢查 `filepath.Ext` | 拒絕（僅 `.service` 可寫入） |
| SYS-17 | 副檔名為 .service | FragmentPath = `/etc/systemd/system/nginx.service` | 檢查 `filepath.Ext` | 通過 |

### 2.3 ConfigStore — 備份與保留策略（決策 3）

> 對應 BDD：`@business-rules` 備份保留 5 份、PUT 備份流程

| # | 測試名稱 | Given | When | Then |
|---|---------|-------|------|------|
| SYS-18 | 儲存前建立備份 | 現行檔存在、內容 V1 | 執行 `backup(path)` | 同目錄產生 `nginx.service.bak.{20060102T150405Z}`（UTC compact RFC3339） |
| SYS-19 | 備份內容為原檔副本 | 現行檔內容 V1 | 讀取備份檔 | 內容與 V1 完全一致（copy，非 rename — 現行檔仍原位） |
| SYS-20 | 保留 5 份 — 已滿 5 份 | 目錄已有 5 份備份（t1 最舊 … t5 最新） | 建立第 6 份並 prune | 產生 t6；最舊 t1 被刪除；目錄維持 5 份 |
| SYS-21 | 保留 5 份 — 未滿 | 目錄已有 3 份備份 | 建立第 4 份並 prune | 產生後共 4 份，無任何刪除 |
| SYS-22 | 固定寬度時間戳排序正確 | 備份檔名含 `20260812T153045Z` 等固定寬度時間戳 | `sort.Strings` 降冪排序 | 字典序 = 時間序（排序正確性，prune 依賴此性質） |
| SYS-23 | prune 不誤刪其他服務備份 | 目錄同時有 `nginx.service.bak.*` 與 `mysql.service.bak.*` | 對 nginx prune | 僅操作 `nginx.service.bak.` prefix，mysql 備份不受影響 |

### 2.4 ConfigStore — atomic write 與還原（決策 3）

> 對應 BDD：PUT 成功 / 寫入失敗還原

| # | 測試名稱 | Given | When | Then |
|---|---------|-------|------|------|
| SYS-24 | atomic write 成功 | 目錄可寫 | 執行 `atomicWrite(path, 新內容)`（tmp + fsync + rename） | 目標檔內容 = 新內容；無 `.tmp` 殘留 |
| SYS-25 | 寫入失敗還原備份 | 備份已建立（內容 V1）；寫入步驟失敗（模擬磁碟錯誤/權限移除） | 執行還原 | 備份內容還原至原路徑，原檔恢復 V1；回傳「寫入失敗」錯誤 |
| SYS-26 | 寫入後保留原檔 mode | 原檔 mode 0640 | atomic write 後檢查 | 新檔 mode 仍為 0640（fchmod 保留） |
| SYS-27 | 並發 atomic write 無部分寫入 | 兩個 goroutine 同時寫入不同內容 | 執行後讀取 | 檔案內容為兩者之一（完整），無交錯/截斷（race detector 無警告） |

### 2.5 ConfigStore — checksum 衝突偵測（決策 4）

> 對應 BDD：PUT 409 衝突、last-write-wins 商業規則

| # | 測試名稱 | Given | When | Then |
|---|---------|-------|------|------|
| SYS-28 | base_checksum 一致 | 現行檔 checksum == 請求 `base_checksum` | 執行衝突檢查 | 無衝突，允許寫入 |
| SYS-29 | base_checksum 不一致 | 檔案已被他人修改（現行 checksum ≠ base_checksum） | 執行衝突檢查 | 回傳 409 + `currentChecksum`（現行值） |
| SYS-30 | base_checksum 缺省 | 請求 body 無 `base_checksum` 欄位 | 解析請求 | 回 400（防止舊前端/腳本繞過衝突偵測） |
| SYS-31 | base_checksum 格式錯誤 | `base_checksum` = "abc"（非 64 hex） | 執行衝突檢查 | 回 400 |
| SYS-32 | 連續儲存 round-trip | GET → PUT（base=GET checksum）→ 再次 GET | 第二次 GET 回傳新 checksum | 新 checksum = 第一次 PUT 內容之 checksum；第三次 PUT 需以新 checksum 為基準 |

### 2.6 systemd-analyze 驗證（`internal/systemd/config_validate.go`，決策 2）

> 對應 BDD：POST validate 全部 Scenario + Outline

| # | 測試名稱 | Given | When | Then |
|---|---------|-------|------|------|
| SYS-33 | 語法正確回傳 valid=true | 內容合法；`systemd-analyze verify` exit 0 | 執行驗證 | `{valid:true, errors:[]}` |
| SYS-34 | 語法錯誤回傳 valid=false + 行號 | 內容含錯誤；verify exit 非 0，輸出 `{path}:12: Unknown key 'ExecStartt'` | 執行驗證並解析輸出 | `{valid:false, errors:[{line:12, message:"Unknown key 'ExecStartt'"}]}` |
| SYS-35 | 輸出僅含警告視為通過 | verify 輸出僅警告（無錯誤）但 exit 0 | 執行驗證 | valid=true（警告不構成失敗） |
| SYS-36 | 錯誤行號解析 — 多種格式 | 輸出含 `Section [Service] not found`、`Missing '=' in key/value assignment` 等 | 套用解析正規表達式 | 正確萃取 `{line, message}`，行號型別為 int |
| SYS-37 | 多筆錯誤解析 | 輸出含 4 筆不同行號錯誤（Outline 範例） | 執行驗證 | errors 陣列含 4 筆，各自 line/message 正確 |
| SYS-38 | systemd-analyze 不存在 | `exec.LookPath("systemd-analyze")` 失敗（模擬容器環境） | 執行驗證 | 回 `{valid:false, available:false, message:"systemd-analyze 指令不存在..."}`，**非 500 crash** |
| SYS-39 | 執行逾時 10 秒 | `systemd-analyze verify` 執行超過 10s（mock 慢指令） | 執行驗證 | 判定逾時視為失敗，回合理錯誤，process 被 kill |
| SYS-40 | 執行失敗但輸出不可解析 | exit 非 0、輸出不含 `:line:` 模式 | 執行驗證 | 回 valid=false + 原始輸出為 message，不 crash |
| SYS-41 | 暫存檔建立失敗 | /tmp 不可寫（模擬空間不足/權限） | 執行驗證 | 回錯誤「無法建立暫存檔進行驗證。請檢查 /tmp 目錄空間與權限。」 |
| SYS-42 | 暫存檔命名與權限 | 執行驗證 | 檢查建立的暫存檔 | 檔名為 `lsm-validate-{uuid}.service`、權限 0600 |
| SYS-43 | 暫存檔確實刪除（成功/失敗路徑） | 驗證完成（含失敗/逾時/暫存建立失敗前置路徑） | 檢查 /tmp | `defer os.Remove` 生效，無 `lsm-validate-*` 殘留 |

### 2.7 商業規則與裁決

> 對應 BDD：`@business-rules` — 逾時、還原裁決、無悲觀鎖定

| # | 測試名稱 | Given | When | Then |
|---|---------|-------|------|------|
| SYS-44 | daemon-reload 逾時 = 10 秒 | mock `systemctl daemon-reload` 阻塞 > 10s | 執行 reload | 判定逾時並視為失敗（對應 BDD「daemon-reload 逾時設定為 10 秒」） |
| SYS-45 | 還原裁決：寫入失敗還原、reload 失敗不還原 | (a) 寫入失敗 (b) reload 失敗兩種情境 | 執行儲存流程 | (a) 還原備份；(b) **不還原**、回 500 + `backupPath`（決策 D-4/D-5） |
| SYS-46 | 不實作悲觀鎖定 | 兩位管理員同時編輯（模擬兩個 PUT 依序到達） | 依序執行兩次 PUT | 無 lock 檔案/狀態；先到者成功、後到者若基準不符回 409（last-write-wins + checksum 偵測） |

### 2.8 Handler 層（`internal/handler/config_handler.go`）

> 對應 BDD：三大 API 之 `@api` Scenario（401/400/403/404/409/413/500）
> 測試方式：`httptest` + 以 temp dir 模擬 `/etc/systemd/system/`、mock `FragmentPathOf` 查詢、mock systemd-analyze/systemctl

#### 2.8.1 GET /api/v1/services/{name}/config

| # | 測試名稱 | Given | When | Then |
|---|---------|-------|------|------|
| HDL-01 | GET 成功回傳設定檔內容 | 解鎖服務 nginx、檔案存在 | GET /api/v1/services/nginx/config | 200；JSON 含 name / fragmentPath / config（完整內容）/ size / checksum |
| HDL-02 | GET 名稱無效 | name = "invalid name!" | GET 該路徑 | 400，`{"error":"invalid service name"}`（ValidateServiceName 套用） |
| HDL-03 | GET 鎖定服務 — 唯讀檢視允許 | FragmentPath = `/usr/lib/.../systemd-journald.service` | GET /api/v1/services/systemd-journald/config | **200** 回傳內容（唯讀檢視，依決策 D-2；非 BDD 之 403） |
| HDL-04 | GET FragmentPath 為空 | 服務存在但 FragmentPath = "" | GET /api/v1/services/nginx/config | 404，明確錯誤訊息（設定檔路徑不存在） |
| HDL-05 | GET 檔案不存在 | FragmentPath 指向檔案已刪除 | GET /api/v1/services/nginx/config | 404，明確錯誤訊息（設定檔不存在） |
| HDL-06 | GET 檔案超過 500KB | 檔案 = 600000 bytes | GET /api/v1/services/big-svc/config | 413，錯誤訊息說明大小限制 |
| HDL-07 | GET 權限不足 | 檔案無讀取權限 | GET /api/v1/services/nginx/config | 500，錯誤原因含權限 |
| HDL-08 | GET 未登入 | 無 session / 無 Bearer Token | GET /api/v1/services/nginx/config | 401 Unauthorized（Auth middleware 攔截） |

#### 2.8.2 PUT /api/v1/services/{name}/config

| # | 測試名稱 | Given | When | Then |
|---|---------|-------|------|------|
| HDL-09 | PUT 成功（完整流程） | 解鎖服務、base_checksum 一致 | PUT body `{"config":"...","base_checksum":"..."}` | 200，`{message, backupPath}`；備份建立、寫入、daemon-reload、audit 依序執行（mock 驗證呼叫順序） |
| HDL-10 | PUT 名稱無效 | name = "invalid name!" | PUT 該路徑 | 400，`{"error":"invalid service name"}` |
| HDL-11 | PUT 鎖定服務 | FragmentPath 不在 /etc/systemd/system/ 下 | PUT /api/v1/services/systemd-journald/config | 403，`{"error":"不允許編輯此服務設定檔"}` |
| HDL-12 | PUT 路徑遍歷嘗試 | FragmentPath 被竄改為 `/etc/systemd/system/../../etc/passwd` | PUT /api/v1/services/evil-svc/config | 403，檔案系統不受任何影響（無寫入痕跡） |
| HDL-13 | PUT 非 .service 類型 | FragmentPath = `/etc/systemd/system/backup.timer` | PUT /api/v1/services/backup/config | 403，訊息說明僅支援 .service |
| HDL-14 | PUT 內容超過 500KB | body config = 600000 bytes | PUT /api/v1/services/nginx/config | 413；**設定檔未被寫入且不建立備份** |
| HDL-15 | PUT body JSON 格式錯誤 | body = 非法 JSON | PUT | 400 |
| HDL-16 | PUT base_checksum 缺省 | body 僅 `{"config":"..."}` | PUT | 400（決策 D-6） |
| HDL-17 | PUT checksum 衝突 | base_checksum 與現行不一致 | PUT | 409，`{"error":"設定檔已被其他使用者修改。請重新載入後再編輯。","currentChecksum":"..."}`；檔案未變更 |
| HDL-18 | PUT 寫入失敗還原 | 寫入步驟失敗（mock） | PUT | 500「寫入失敗」+ backupPath；備份已還原 |
| HDL-19 | PUT daemon-reload 失敗不還原 | 寫入成功、reload 失敗（mock） | PUT | 500，error 含「daemon-reload 失敗」+ backupPath；**設定檔內容保留新值（不還原）** |
| HDL-20 | PUT 未登入 | 無驗證資訊 | PUT /api/v1/services/nginx/config | 401；設定檔未被修改 |

#### 2.8.3 POST /api/v1/services/{name}/config/validate

| # | 測試名稱 | Given | When | Then |
|---|---------|-------|------|------|
| HDL-21 | Validate 語法正確 | 內容合法，systemd-analyze exit 0 | POST /validate body `{"config":"..."}` | 200，`{"valid":true,"errors":[]}` |
| HDL-22 | Validate 語法錯誤 + 行號 | 內容含錯誤（12 行） | POST /validate | 200，`{"valid":false,"errors":[{"line":12,"message":"Unknown key 'ExecStartt'"}]}` |
| HDL-23 | Validate systemd-analyze 不存在 | 環境無 systemd-analyze | POST /validate | 200，`{valid:false, available:false, message:"systemd-analyze 指令不存在..."}`（非 500，決策 D-3） |
| HDL-24 | Validate 暫存檔建立失敗 | /tmp 不可寫 | POST /validate | 錯誤回應，訊息「無法建立暫存檔進行驗證...」 |
| HDL-25 | Validate body 格式錯誤 | body 非法 JSON 或無 config | POST /validate | 400 |
| HDL-26 | Validate 未登入 | 無驗證資訊 | POST /validate | 401 |

#### 2.8.4 Audit 整合（handler 層）

| # | 測試名稱 | Given | When | Then |
|---|---------|-------|------|------|
| HDL-27 | GET 成功寫入 config_view | 解鎖服務、GET 成功 | GET /config | `audit.Module.Write` 收到 `ActionConfigView`，記錄操作者與服務名稱 |
| HDL-28 | PUT 成功寫入 config_save | 完整儲存流程成功 | PUT /config | audit 收到 `ActionConfigSave`，含操作者、服務名稱、backupPath |
| HDL-29 | PUT reload 失敗仍寫 audit（半成功） | 寫入成功、reload 失敗 | PUT /config | audit 記錄 `ActionConfigSave`，`result=success`、detail 附註 reload 錯誤（決策 4.2） |
| HDL-30 | GET 鎖定服務亦寫 config_view | 鎖定服務唯讀檢視 | GET /config | audit 記錄 `ActionConfigView`（唯讀檢視亦需稽核） |

---

## 3. 前端單元測試

> 新增：`frontend/src/components/__tests__/UnitFileEditor.test.ts`、`frontend/src/composables/__tests__/useConfigEditor.test.ts`、`frontend/src/views/__tests__/ConfigEditorView.test.ts`、擴充 `ServiceRow.test.ts`、`client.test.ts`
> 沿用既有測試 pattern（`@vue/test-utils` + happy-dom + vi.mock api client）

### 3.1 ServiceRow.vue — 進入點按鈕

> 對應 BDD：`@entry` 3 Scenario + 商業規則「僅 /etc/systemd/system/ 下的自訂服務可編輯」

| # | 測試名稱 | Given | When | Then |
|---|---------|-------|------|------|
| F-SR-01 | 解鎖服務顯示 Edit Config | service = {locked:false, fragmentPath:"/etc/systemd/system/nginx.service"} | mount ServiceRow | Actions 區域顯示「Edit Config」按鈕，與 Start/Stop/Restart 同列，樣式一致（outline secondary class） |
| F-SR-02 | 鎖定服務顯示 View Config | service = {locked:true, fragmentPath:"/usr/lib/..."} | mount ServiceRow | 顯示「View Config」按鈕，**不顯示**「Edit Config」 |
| F-SR-03 | fragmentPath 為空隱藏按鈕 | service = {locked:false, fragmentPath:""} | mount ServiceRow | 不顯示 Edit/View Config 按鈕 |
| F-SR-04 | 三服務混合列表（BDD 商業規則表） | nginx（解鎖）/ systemd-journald（鎖定）/ httpd（鎖定） | mount ServiceTable | nginx 顯示 Edit Config；其餘顯示 View Config |

### 3.2 UnitFileEditor.vue — CodeMirror 6 封裝

> 對應 BDD：`@editor` 語法 highlight、唯讀、固定設定；決策 D-1

| # | 測試名稱 | Given | When | Then |
|---|---------|-------|------|------|
| F-ED-01 | 載入顯示內容 | props.modelValue = unit file 內容 | mount | 編輯器（CodeMirror）顯示該內容 |
| F-ED-02 | 編輯 emit update:modelValue | 使用者在編輯器輸入 | 觸發內容變更 | emit `update:modelValue` 帶新內容 |
| F-ED-03 | readOnly 不可編輯 | props.readOnly = true | mount 並嘗試輸入 | 內容不可變更，不 emit |
| F-ED-04 | INI 語法高亮 | 內容含 `[Unit]` `[Service]` `[Install]` section | mount | 使用 `StreamLanguage.define(ini)`（legacy-modes），section 行套用高亮 class（不同顏色標示） |
| F-ED-05 | tabSize = 2 | 預設組態 | mount 後檢查 EditorState 設定 | tabSize = 2（`indentUnit` 對應） |
| F-ED-06 | lineWrapping on | 預設組態 | mount 後檢查 EditorView 擴充 | `EditorView.lineWrapping` 已安裝（= BDD wordWrap on） |
| F-ED-07 | lineNumbers on | 預設組態 | mount 後檢查 | `lineNumbers()` 已安裝，左側顯示行號 |
| F-ED-08 | 主題切換 light/dark | 目前主題 dark | 切換主題（compartment dispatch） | EditorView 重新 dispatch `EditorView.theme`，主題 class 對應變更 |
| F-ED-09 | 錯誤行波浪線標記 | 指定 line 12 | 呼叫 setErrorMarks([12]) | 第 12 行套用紅色波浪線 decoration |
| F-ED-10 | gutter ❌ icon | 指定 line 12 | 呼叫 setGutterMark(12) | gutter 顯示 ❌ icon（decorations） |
| F-ED-11 | 清除標記 | 已有錯誤標記 | 呼叫 clearMarks() | 波浪線與 ❌ 全部移除 |
| F-ED-12 | 等寬字型 | 預設 | 檢查 CSS | 編輯器字型為 monospace 家族 |
| F-ED-13 | 元件卸載釋放資源 | editor 已 mount | unmount | EditorView.destroy() 被呼叫，無記憶體洩漏/重複渲染 |
| F-ED-14 | 動態 import 載入中 | CodeMirror chunk 尚未就緒 | mount 時檢查 | 顯示 loading placeholder（由 view 的 v-if 控制） |

### 3.3 useConfigEditor.ts — dirty state / baseChecksum（決策 6）

> 對應 BDD：`@editor` dirty 狀態、Save 啟用、驗證結果清除

| # | 測試名稱 | Given | When | Then |
|---|---------|-------|------|------|
| F-CE-01 | 載入成功設定初始狀態 | GET 成功回傳內容 + checksum | call load() | initialContent = 回傳內容；isDirty = false；baseChecksum = 回傳 checksum |
| F-CE-02 | 內容變更進入 dirty | 初始內容 A | setContent("B") | isDirty = true |
| F-CE-03 | 內容還原回 clean | 內容變更為 B 後 | setContent(初始 A) | isDirty = false（內容比對，非 flag 累計） |
| F-CE-04 | 儲存成功轉 clean | 儲存 API 200 | 完成儲存流程 | isDirty = false；未儲存指示清除 |
| F-CE-05 | 儲存失敗保持 dirty | 儲存 API 500 | 完成儲存流程 | isDirty = true；編輯內容保留 |
| F-CE-06 | 內容變更清除驗證結果 | 先前驗證失敗顯示錯誤面板 | setContent(變更) | validationResult 清空、錯誤標記移除 |
| F-CE-07 | 409 後更新 baseChecksum | 儲存回 409 + currentChecksum | 使用者執行「重新載入」 | 重新 GET 並以新 checksum 更新 baseChecksum，再次儲存成功 |
| F-CE-08 | 儲存中狀態 | 儲存請求已送出 | 檢查狀態 | isSaving = true（Save 按鈕 loading、編輯器唯讀）；完成後恢復 |
| F-CE-09 | beforeunload 註冊/移除 | dirty 狀態 | mount / unmount composable | onMounted 註冊、onUnmounted 移除；dirty 時 handler 觸發 `e.preventDefault()` |
| F-CE-10 | 離開決策 promise | dirty 時觸發導航 | resolve(false) / resolve(true) | Stay → 留在頁面；Discard → 設 dirty=false 後放行 |

### 3.4 ConfigEditorView.vue — 載入與顯示

> 對應 BDD：`@entry` 載入狀態、載入失敗重試、404 空編輯器、500KB 提示、權限錯誤、唯讀模式

| # | 測試名稱 | Given | When | Then |
|---|---------|-------|------|------|
| F-VW-01 | 載入中顯示 spinner | API 尚未回應 | mount ConfigEditorView | 顯示 loading spinner +「載入設定檔中...」 |
| F-VW-02 | 載入成功顯示服務資訊 | GET 200 | await 回應 | 編輯器上方顯示服務名稱與 FragmentPath |
| F-VW-03 | 編輯模式底部三按鈕 | 解鎖服務載入成功 | 檢查底部 | Validate / Save / Cancel 三按鈕；Save 初始 disabled |
| F-VW-04 | 唯讀模式僅 Close | 鎖定服務（readOnly） | 檢查底部 | 僅顯示「Close」；無 Validate / Save |
| F-VW-05 | 載入失敗顯示錯誤 + 重試 | GET 失敗（非 404） | await 失敗回應 | 顯示錯誤訊息與原因 +「返回」+「重試」按鈕 |
| F-VW-06 | 重試重新載入 | 錯誤狀態 | click「重試」 | 重新呼叫 GET，回到 loading |
| F-VW-07 | 404 顯示空編輯器 + 黃色提示 | GET 404 | await 回應 | 編輯器空內容 + 黃色提示「設定檔不存在：{path}。請確認服務設定檔是否已被手動刪除。」 |
| F-VW-08 | 404 後可輸入並建立新檔 | 404 狀態 | 輸入內容並儲存 | 可正常儲存（建立新設定檔） |
| F-VW-09 | 超過 500KB 顯示效能提示 | GET 回傳 size = 600000 | 載入完成 | 黃色提示「設定檔較大（600000），編輯時可能有效能影響。」，不阻塞編輯 |
| F-VW-10 | 權限不足錯誤訊息 | GET 500 + 權限原因 | await 回應 | 顯示「無法讀取設定檔：權限不足。請確認 LMS 執行使用者具備讀取權限。」+ 返回按鈕 |
| F-VW-11 | Save 隨 dirty 啟用 | clean → 修改內容 | 檢查按鈕狀態 | Save 由 disabled → enabled |
| F-VW-12 | 未儲存變更指示「●」 | dirty 狀態 | 檢查標題/tab 區域 | 顯示「●」指示；clean 時隱藏 |

### 3.5 Validate 流程

> 對應 BDD：`@validate` 全部 Scenario

| # | 測試名稱 | Given | When | Then |
|---|---------|-------|------|------|
| F-VL-01 | 點擊 Validate 顯示 loading | 內容非空、未驗證 | click Validate | 按鈕變 spinner +「Verifying...」+ disabled（防重複點擊） |
| F-VL-02 | 空內容攔截不發請求 | 編輯器內容為空 | click Validate | **前端攔截**，無 API 呼叫，顯示「設定檔內容為空，請先編輯或載入內容」 |
| F-VL-03 | 驗證通過綠色提示 | POST 回 200 valid=true | click Validate | 綠色提示「✅ 語法驗證通過 — 設定檔語法正確」；錯誤標記清除；按鈕恢復 |
| F-VL-04 | 驗證失敗紅色面板 | POST 回 valid=false + errors[{line:12,...}] | click Validate | 編輯器下方紅色錯誤面板（不覆蓋編輯器），逐條「Line 12: Unknown key 'ExecStartt'」 |
| F-VL-05 | 失敗行號標記 | valid=false + line 12 | click Validate | 第 12 行波浪線 + gutter ❌ |
| F-VL-06 | available:false 黃色警告 | POST 回 200 `{valid:false, available:false}` | click Validate | 黃色警告「⚠️ 無法執行語法驗證 — systemd-analyze 不可用...」；編輯器維持可編輯 |
| F-VL-07 | 500/網路錯誤黃色警告 | POST 回 500 或 axios 網路錯誤 | click Validate | 黃色警告（同 F-VL-06 文案）；不阻塞；可稍後重試 |
| F-VL-08 | 400/422 請求格式錯誤 | POST 回 400/422 | click Validate | 顯示「請求格式錯誤」；編輯器維持可編輯 |
| F-VL-09 | 內容變更清除舊驗證結果 | 先前驗證失敗面板已顯示 | 再次編輯內容 | 驗證面板與行標記自動清除 |

### 3.6 Save 流程與 ConfirmModal

> 對應 BDD：`@save` 全部 Scenario

| # | 測試名稱 | Given | When | Then |
|---|---------|-------|------|------|
| F-SV-01 | dirty 點 Save 彈出 ConfirmModal | dirty 狀態、Save enabled | click Save | ConfirmModal 開啟，標題「儲存設定檔變更」 |
| F-SV-02 | Modal 內容完整 | Modal 開啟 | 檢查內容 | 含「確定要將變更寫入 /etc/systemd/system/nginx.service 嗎？」+「儲存後將自動執行 systemctl daemon-reload 使變更生效」+ 風險警告「⚠️ 錯誤的設定可能導致服務無法啟動。」 |
| F-SV-03 | Modal 按鈕配置 | Modal 開啟 | 檢查按鈕 | Cancel（次要）+ Save Changes（主要/危險色） |
| F-SV-04 | Cancel 關閉 Modal 狀態不變 | Modal 開啟 | click Cancel | Modal 關閉；編輯內容與 dirty 狀態不變 |
| F-SV-05 | 確認儲存 loading + 唯讀 | click Save Changes | 檢查狀態 | Save 按鈕 spinner +「Saving...」；編輯器設為唯讀 |
| F-SV-06 | 儲存成功完整流程 | PUT 200 + backupPath | 完成儲存 | 綠色 Toast「nginx 設定檔已儲存，daemon-reload 已執行」；dirty 清除；1.5s 後導航回 Dashboard（或手動 Back） |
| F-SV-07 | 儲存失敗恢復可編輯 | PUT 500 | 完成儲存 | 紅色 Toast「儲存失敗：{錯誤原因}」；編輯器恢復可編輯；**編輯內容保留** |
| F-SV-08 | daemon-reload 失敗部分成功 | PUT 500 + backupPath | 完成儲存 | 紅色 Toast「設定檔已儲存，但 daemon-reload 失敗：{錯誤}。請手動執行 systemctl daemon-reload。備份檔：{backupPath}」；恢復可編輯 |
| F-SV-09 | 409 衝突提示重新載入 | PUT 409 | 完成儲存 | Toast「設定檔已被其他使用者修改。請重新載入後再編輯。」+ 提供重新載入動作 |
| F-SV-10 | 空內容儲存額外警告 | 編輯器內容為空 | click Save | ConfirmModal 額外顯示「⚠️ 設定檔內容為空。儲存空設定檔可能導致 systemd 無法解析。確定要繼續嗎？」；確認後仍可儲存 |
| F-SV-11 | 權限不足寫入錯誤 | PUT 500 + 權限訊息 | 完成儲存 | 紅色 Toast「儲存失敗：權限不足，無法寫入 /etc/systemd/system/nginx.service。請確認 LMS 執行使用者具備寫入權限。」；恢復可編輯 |
| F-SV-12 | 儲存期間網路中斷 | PUT 請求失敗（網路錯誤） | 完成儲存 | 顯示「網路連線異常，請稍後重試」；編輯內容保留在瀏覽器記憶體；恢復可編輯 |

### 3.7 Cancel / dirty guard（決策 6 三層防護）

> 對應 BDD：`@cancel` 全部 Scenario + 返回鍵

| # | 測試名稱 | Given | When | Then |
|---|---------|-------|------|------|
| F-CN-01 | clean 點 Cancel 直接返回 | clean 狀態 | click Cancel | 不彈任何確認框，直接導航回 Dashboard |
| F-CN-02 | dirty 點 Cancel 彈出放棄確認 | dirty 狀態 | click Cancel | ConfirmModal「有未儲存的變更，確定要離開嗎？未儲存的變更將會遺失。」+ Stay / Discard Changes |
| F-CN-03 | Stay 回到編輯器 | 放棄確認 Modal 開啟 | click Stay | Modal 關閉；編輯內容與 dirty 保持不變 |
| F-CN-04 | Discard 返回 Dashboard + Toast | 放棄確認 Modal 開啟 | click Discard Changes | Modal 關閉；返回 Dashboard；灰色 Toast「已放棄未儲存的變更」 |
| F-CN-05 | 瀏覽器返回鍵 dirty-check | dirty 狀態 | 觸發 `onBeforeRouteLeave`（模擬返回鍵） | 攔截並彈出與 Cancel 相同的確認對話框 |
| F-CN-06 | Discard 後 guard 放行 | 確認 Modal 中選 Discard | resolve 離開 | 路由成功離開編輯器頁面 |
| F-CN-07 | beforeunload dirty 攔截 | dirty 狀態 | 觸發 beforeunload event | `preventDefault()` 被呼叫（瀏覽器原生確認） |
| F-CN-08 | beforeunload clean 不攔截 | clean 狀態 | 觸發 beforeunload event | 不 preventDefault，可正常關閉/重整 |
| F-CN-09 | 儲存成功後導航放行 | 儲存成功（dirty=false） | 觸發導航回 Dashboard | guard 不攔截（dirty 已清） |

### 3.8 api/client.ts 擴充

> 對應 BDD：三大 API 請求契約

| # | 測試名稱 | Given | When | Then |
|---|---------|-------|------|------|
| F-AP-01 | getServiceConfig | service = "nginx" | call getServiceConfig | axios GET `/services/nginx/config`；回傳型別含 checksum |
| F-AP-02 | saveServiceConfig | name、config、baseChecksum | call saveServiceConfig | axios PUT `/services/nginx/config`，body `{config, baseChecksum}` |
| F-AP-03 | validateServiceConfig | name、config | call validateServiceConfig | axios POST `/services/nginx/config/validate`，body `{config}` |
| F-AP-04 | 409 錯誤辨識 | axios 回 409 + currentChecksum | call saveServiceConfig | error 可解析出 currentChecksum 供重新載入流程使用 |
| F-AP-05 | URL encode | name = "nginx@1" 或含特殊字元 | call 任一函式 | 路徑以 encodeURIComponent 處理 |
| F-AP-06 | validate 空內容不發請求（元件層） | 內容空 | click Validate | API client 未被呼叫（F-VL-02 之 network 層驗證） |

### 3.9 主題與 RWD（`@integration @ui`）

| # | 測試名稱 | Given | When | Then |
|---|---------|-------|------|------|
| F-TH-01 | 淺色模式 light 主題 | theme = light | 開啟編輯器 | CodeMirror 使用 light theme（compartment） |
| F-TH-02 | 深色模式 dark 主題 | theme = dark | 開啟編輯器 | CodeMirror 使用 dark theme |
| F-TH-03 | 主題切換即時生效 | 編輯器已開啟 | 切換 theme | EditorView compartment 重新 dispatch，無需重載頁面 |
| F-TH-04 | 手機 RWD 按鈕不溢出 | viewport < 768px | 檢查編輯器版面 | Validate / Save / Cancel 按鈕不超出螢幕範圍；編輯器支援捲動輸入 |

---

## 4. 整合測試

> 對應 BDD：`@business-rules` `@audit` `@compliance` — 跨模組真實檔案系統驗證
> 方式：`go test`（在 temp dir 佈建 fake `/etc/systemd/system/` + mock systemctl/systemd-analyze）+ curl 腳本

| # | 測試名稱 | 整合範圍 | 操作步驟 | 預期結果 |
|---|---------|---------|---------|---------|
| INT-01 | GET → audit config_view | Handler + ConfigStore + Audit | 1. 佈建 nginx.service<br>2. GET /config<br>3. 讀 audit.jsonl | 200 回傳內容；audit.jsonl 新增 `config_view` 記錄（含操作者、服務名稱） |
| INT-02 | PUT 完整成功流程 | Handler + ConfigStore + Audit + daemon-reload | 1. GET 取得 checksum<br>2. PUT 新內容<br>3. 讀回檔案比對<br>4. 檢查備份與 audit | 200 + backupPath；檔案內容 = 新內容；備份檔存在且為舊內容；audit 含 `config_save` |
| INT-03 | GET→PUT round-trip checksum 一致 | ConfigStore + Handler | 1. GET → checksum C1<br>2. PUT(base=C1)<br>3. GET → checksum C2<br>4. PUT(base=C2) | 兩次 PUT 皆成功（C2 = 新內容 checksum） |
| INT-04 | 409 → 重新載入 → 成功 | Handler + ConfigStore + 前端流程 | 1. A 載入（checksum C1）<br>2. 以腳本直接改檔案（模擬 B 儲存）<br>3. A PUT(base=C1) → 409<br>4. A 重新 GET → 新 checksum C2<br>5. A PUT(base=C2) | 步驟 3 回 409 + currentChecksum；步驟 5 成功；無資料遺失（last-write-wins + 偵測） |
| INT-05 | Validate 暫存檔清理 | config_validate + /tmp | 1. POST validate（成功內容）<br>2. POST validate（錯誤內容）<br>3. 檢查 /tmp | 兩次驗證後 `/tmp/lsm-validate-*` 皆不存在 |
| INT-06 | 寫入失敗還原 | ConfigStore atomic write + backup | 1. 建立備份（V1）<br>2. 模擬寫入失敗（移除目錄寫權限）<br>3. 檢查檔案 | 原檔內容仍為 V1（備份已還原）；回 500「寫入失敗」 |
| INT-07 | daemon-reload 失敗不還原 | ConfigStore + Handler | 1. mock reload 失敗<br>2. PUT 新內容<br>3. 檢查檔案與回應 | 回應 500 + backupPath；**檔案內容為新值（不還原）**；備份檔存在供手動處理 |
| INT-08 | 備份保留 5 份（連續儲存） | ConfigStore backup/prune | 1. 連續 PUT 7 次<br>2. ls 備份目錄 | 目錄僅存最近 5 份 `nginx.service.bak.*`（時間戳排序正確） |
| INT-09 | 路徑遍歷真實請求無副作用 | Handler + ConfigStore | 1. 竄改 FragmentPath 為 `../../etc/passwd`<br>2. PUT | 403；`/etc/passwd` 內容未被修改（無任何副作用） |
| INT-10 | 儲存後 WebSocket 狀態一致（可選） | Handler + WebSocket | 1. 編輯儲存含 restart 性變更<br>2. 檢查 WebSocket 推送 | 服務狀態推送正確反映新設定（與 008 功能整合） |

---

## 5. 端對端測試（Playwright）

> 對應 BDD：`@smoke` `@happy-path` `@p0` `@error-handling` `@edge-case` `@business-rules` `@security` + Scenario Outline
> 測試檔建議：`frontend/e2e/012-config-editor.spec.ts`（Playwright + 後端 mock 或真實測試服務）

### 5.1 進入點與載入（`@entry`）

| # | 測試名稱 | 操作步驟 | 預期結果 |
|---|---------|---------|---------|
| E2E-01 | Dashboard 顯示 Edit/View Config 按鈕 | 1. 登入管理員<br>2. 預備解鎖服務（nginx）與鎖定服務（systemd-journald）<br>3. 檢視 Actions 區域 | nginx 列顯示「Edit Config」；systemd-journald 列顯示「View Config」；按鈕與其他操作按鈕同列 |
| E2E-02 | 進入編輯器主流程 | 1. 點擊 nginx「Edit Config」<br>2. 等待載入 | URL 為 `/services/nginx/config`；先顯示 spinner +「載入設定檔中...」；載入完成後顯示 unit file 內容與語法高亮；上方顯示服務名稱與 FragmentPath；底部 Validate / Save / Cancel |
| E2E-03 | 唯讀模式檢視鎖定服務 | 1. 點擊鎖定服務「View Config」<br>2. 等待載入 | 編輯器唯讀（無法輸入）；內容有高亮；底部僅「Close」 |
| E2E-12 | 載入失敗顯示錯誤與重試 | 1. 攔截 GET 回 500<br>2. 點擊 Edit Config | 顯示錯誤訊息與原因 +「返回」+「重試」；點重試後重新載入成功 |
| E2E-13 | 設定檔不存在（404） | 1. 攔截 GET 回 404 | 空編輯器 + 黃色提示「設定檔不存在：/etc/systemd/system/nginx.service...」；可輸入內容並儲存 |

### 5.2 編輯與 dirty 狀態（`@editor`）

| # | 測試名稱 | 操作步驟 | 預期結果 |
|---|---------|---------|---------|
| E2E-04 | 編輯後 dirty + Save 啟用 | 1. 進入編輯器<br>2. 修改內容（新增 Environment 行） | Save 由 disabled → enabled；標題旁顯示「●」未儲存指示 |
| E2E-11 | 瀏覽器返回鍵 dirty-check | 1. 編輯內容（dirty）<br>2. 按瀏覽器返回鍵 | 攔截並彈出「有未儲存的變更...」ConfirmModal（非直接離開） |

### 5.3 Validate（`@validate`）

| # | 測試名稱 | 操作步驟 | 預期結果 |
|---|---------|---------|---------|
| E2E-05 | Validate 通過（主流程） | 1. 編輯合法內容<br>2. 點擊 Validate | 按鈕 spinner +「Verifying...」；綠色提示「✅ 語法驗證通過 — 設定檔語法正確」 |
| E2E-06 | Validate 失敗（錯誤面板 + 行號標記） | 1. 輸入含錯誤內容（如 `ExecStartt=` 拼錯，第 12 行）<br>2. 點擊 Validate | 紅色錯誤面板「Line 12: Unknown key 'ExecStartt'」；第 12 行波浪線；gutter ❌ |
| E2E-21 | Validate 空內容前端攔截 | 1. 清空編輯器內容<br>2. 點擊 Validate | 顯示「設定檔內容為空，請先編輯或載入內容」；**network 面板無 validate 請求** |

### 5.4 Save（`@save`）

| # | 測試名稱 | 操作步驟 | 預期結果 |
|---|---------|---------|---------|
| E2E-07 | 儲存成功主流程 | 1. 編輯 → Validate → Save<br>2. ConfirmModal 檢查內容<br>3. 點擊 Save Changes<br>4. 等待成功 | Modal 含路徑/reload 提示/風險警告；按鈕 loading +「Saving...」；編輯器唯讀；綠色 Toast「nginx 設定檔已儲存，daemon-reload 已執行」；1.5s 後自動返回 Dashboard |
| E2E-08 | 儲存確認取消 | 1. 點擊 Save<br>2. ConfirmModal 點擊 Cancel | Modal 關閉；回到編輯器，內容與 dirty 狀態不變 |
| E2E-09 | dirty Cancel → Discard | 1. 編輯內容<br>2. 點擊 Cancel<br>3. 點擊 Discard Changes | 返回 Dashboard；灰色 Toast「已放棄未儲存的變更」 |
| E2E-10 | dirty Cancel → Stay | 1. 編輯內容<br>2. 點擊 Cancel<br>3. 點擊 Stay | Modal 關閉；回到編輯器，編輯內容保留 |
| E2E-14 | 儲存失敗（500） | 1. 攔截 PUT 回 500<br>2. Save → 確認 | 紅色 Toast「儲存失敗：{錯誤原因}」；編輯器恢復可編輯；編輯內容保留 |
| E2E-15 | daemon-reload 失敗 | 1. 攔截 PUT 回 500 + backupPath | 紅色 Toast「設定檔已儲存，但 daemon-reload 失敗：... 備份檔：{backupPath}」；恢復可編輯 |
| E2E-16 | 409 衝突 | 1. 攔截 PUT 回 409 + currentChecksum | Toast「設定檔已被其他使用者修改。請重新載入後再編輯。」；提供重新載入動作 |
| E2E-17 | 空內容儲存額外警告 | 1. 清空內容<br>2. 點擊 Save | Modal 額外顯示「⚠️ 設定檔內容為空...」；確認後仍可儲存；取消則回編輯器 |

### 5.5 整合情境（`@integration`）

| # | 測試名稱 | 操作步驟 | 預期結果 |
|---|---------|---------|---------|
| E2E-18a | 淺色模式編輯器主題 | 1. 切換淺色模式<br>2. 開啟編輯器 | CodeMirror 使用 light 主題（Scenario Outline Example 1） |
| E2E-18b | 深色模式編輯器主題 | 1. 切換深色模式<br>2. 開啟編輯器 | CodeMirror 使用 dark 主題（Scenario Outline Example 2） |
| E2E-19 | 手機 RWD | 1. viewport 375×667<br>2. 開啟編輯器並編輯 | 可正常輸入（捲動/字型調整）；按鈕不超出螢幕 |
| E2E-20 | 儲存後 Dashboard 狀態更新 | 1. 完成儲存返回 Dashboard<br>2. 檢查服務列表 | 服務列表重新載入顯示最新狀態；「Edit Config」仍可點擊 |

### 5.6 Scenario Outline — 參數化

| # | 測試名稱 | 操作步驟 | 預期結果 |
|---|---------|---------|---------|
| E2E-22 | 無效名稱 GET（invalid name!） | APIRequestContext GET `/services/invalid name!/config` | 400 `{"error":"invalid service name"}` |
| E2E-23 | 無效名稱 PUT（invalid name!） | PUT `/services/invalid name!/config` | 400 |
| E2E-24 | 無效名稱 POST validate | POST `/services/invalid name!/config/validate` | 400 |
| E2E-25 | 路徑遍歷 GET（../traversal） | GET `/services/../traversal/config`（URL-encoded） | 400（ValidateServiceName 拒絕，或路由層 404，不得執行檔案操作） |
| E2E-26 | 路徑遍歷 PUT（../traversal） | PUT `/services/../traversal/config` | 400，無檔案副作用 |
| E2E-27 | 未登入 GET config | 無驗證資訊發送 GET /config | 401 Unauthorized |
| E2E-28 | 未登入 PUT config | 無驗證資訊發送 PUT /config | 401，設定檔未被修改 |
| E2E-29 | 未登入 POST validate | 無驗證資訊發送 POST /validate | 401 |

---

## 6. 手動驗證（真實環境）

> 對應 BDD：`@edge-case` `@compliance` — 真實 systemd 環境才可驗證的場景（真 daemon-reload、真權限、真檔案系統）

| # | 情境 | 驗證步驟 | 預期 |
|---|------|---------|------|
| MAN-01 | 真實 systemd 完整流程生效 | 1. 在真實 Linux 以 LMS 編輯 nginx.service<br>2. 修改 ExecStart 參數<br>3. Validate → Save<br>4. `systemctl cat nginx.service` 與 `systemctl status nginx` | 檔案內容正確更新；daemon-reload 後服務以新參數運作 |
| MAN-02 | 備份檔實檔檢查 | 1. 儲存設定檔<br>2. `ls -la /etc/systemd/system/` | 出現 `nginx.service.bak.{時間戳}`；內容為舊版本；連續儲存 6 次後僅保留 5 份 |
| MAN-03 | 權限不足（讀取） | 1. `chmod 000 /etc/systemd/system/nginx.service`<br>2. 重新載入編輯器 | 顯示「無法讀取設定檔：權限不足...」+ 返回按鈕；復原權限 |
| MAN-04 | 權限不足（寫入） | 1. 將 LMS 執行使用者對該檔無寫權限（chmod 444 + 目錄 555）<br>2. 編輯並儲存 | 紅色 Toast「儲存失敗：權限不足，無法寫入 ...」；編輯器恢復可編輯 |
| MAN-05 | systemd-analyze 不存在（容器） | 1. 於無 systemd-analyze 的容器/環境啟動 LMS<br>2. 點擊 Validate | 黃色警告「systemd-analyze 指令不存在...」；仍可直接儲存 |
| MAN-06 | 兩瀏覽器並發編輯 → 409 | 1. 瀏覽器 A、B 同時開啟同一服務編輯器<br>2. A 儲存成功<br>3. B 修改後儲存 | B 收到 409 Toast「設定檔已被其他使用者修改...」；B 重新載入後可再編輯 |
| MAN-07 | 500KB 大檔案效能 | 1. 建立接近 500KB 的測試 unit file<br>2. 開啟編輯器 | 黃色效能提示；載入與編輯流暢度可接受；超過 500KB 儲存被 413 拒絕 |
| MAN-08 | Audit log 內容檢查 | 1. 檢視 + 編輯 + 儲存設定檔<br>2. 檢查 `audit.jsonl` | 含 `config_view` 與 `config_save` 兩筆；含操作者、服務名稱、backupPath；daemon-reload 失敗案例之 detail 附註 |
| MAN-09 | 分頁關閉 beforeunload | 1. 編輯內容（dirty）<br>2. 直接關閉瀏覽器分頁 | 瀏覽器彈出原生離開確認（未儲存變更防護第三層） |
| MAN-10 | 網路中斷 | 1. DevTools → Offline<br>2. 點擊 Save / Validate | 顯示「網路連線異常，請稍後重試」；編輯內容保留在記憶體；恢復連線後可重試 |
| MAN-11 | 暫存檔長期殘留檢查 | 1. 反覆執行 Validate（含成功/失敗/中斷）<br>2. `ls /tmp/lsm-validate-*` | 無殘留暫存檔（defer 清理 + UUID 命名） |
| MAN-12 | PWA 離線編輯 | 1. 以正常連線進入過編輯器頁面<br>2. 切斷網路<br>3. 重新開啟編輯器 | 編輯器 chunk 已由 workbox precache，離線仍可開啟並編輯 |

---

## 7. 測試環境

| 項目 | 需求 |
|------|------|
| Go 版本 | 1.24.4（module `linux-service-manager`，`src/go.mod`） |
| 後端依賴 | chi/v5 v5.3.1、godbus/dbus/v5、gorilla/sessions、gorilla/websocket |
| Node.js 版本 | 22+（對應專案 `.nvmrc`） |
| 前端框架 | Vue 3.5.40 + Pinia 4.0.2 + Vue Router 4.6.4 + axios |
| 前端測試 | Vitest 4.1.10 + @vue/test-utils 2.4.11 + happy-dom |
| E2E 測試 | Playwright 1.62.1（Chromium 內建） |
| 後端測試 | `go test` + `net/http/httptest`（`cd src && go test ./...`） |
| 測試瀏覽器 | Chromium（Playwright）、Chrome、Firefox、Edge（手動） |
| 測試 OS | Linux（Ubuntu 22.04+ / Debian 12+），具 systemd 1.x 與 `systemd-analyze`（手動驗證必備） |
| 編輯器 | CodeMirror 6（`codemirror`、`@codemirror/state`、`view`、`language`、`commands`、`search`、`legacy-modes`，決策 1 新增依賴） |
| 測試用 unit file | `/etc/systemd/system/nginx.service`（測試環境可建立 dummy 服務） |
| CI 整合 | `make test` / `cd src && go test ./... && cd frontend && npm test && npx playwright test` |

---

## 8. 缺陷追蹤模板

| 欄位 | 說明 |
|------|------|
| ID | BUG-CFG-XXX |
| 測試案例 | 對應以上測試編號（如 SYS-25 / HDL-19 / F-SV-08 / E2E-15） |
| 來源 BDD Scenario | 對應 BDD Scenario 名稱 |
| 嚴重程度 | P0(阻擋) / P1(主要) / P2(次要) |
| 重啟步驟 | 逐步操作 |
| 預期 vs 實際 | 對照 |
| 環境 | Go 版本 / Node 版本 / OS / systemd 版本 / 瀏覽器 |

---

## 9. BDD Scenario 覆蓋矩陣

以下矩陣確保每個 BDD Scenario 至少對應一個測試案例（含 Scenario Outline 全部 Examples 展開）。

| # | BDD Scenario | 單元測試 | 整合測試 | E2E 測試 | 手動驗證 |
|---|-------------|:---:|:---:|:---:|:---:|
| 1 | 解鎖服務顯示「Edit Config」按鈕 | F-SR-01 | — | E2E-01 | — |
| 2 | 鎖定服務顯示「View Config」唯讀按鈕 | F-SR-02 | — | E2E-01 | — |
| 3 | 點擊 Edit Config 導航至編輯器頁面並顯示載入狀態 | F-VW-01~03 | — | E2E-02 | — |
| 4 | 設定檔載入失敗時顯示錯誤與重試 | F-VW-05~06 | — | E2E-12 | — |
| 5 | 設定檔已被刪除時顯示空編輯器與提示 | F-VW-07~08 | — | E2E-13 | — |
| 6 | 編輯器載入 unit file 內容並套用語法 highlight | F-ED-01, F-ED-04 | — | E2E-02 | — |
| 7 | 唯讀模式檢視鎖定服務設定檔 | F-ED-03, F-VW-04 | — | E2E-03 | — |
| 8 | 設定檔超過 500KB 時顯示效能提示 | F-VW-09 | — | — | MAN-07 |
| 9 | 編輯內容後進入 dirty 狀態並啟用 Save | F-CE-01~03, F-VW-11~12 | — | E2E-04 | — |
| 10 | 內容變更後自動清除先前驗證結果 | F-CE-06, F-VL-09 | — | — | — |
| 11 | 編輯器使用 INI 語法與固定編輯器設定（CodeMirror 6，決策 D-1） | F-ED-04~07 | — | — | — |
| 12 | 語法驗證通過顯示綠色提示 | F-VL-03, F-ED-11 | — | E2E-05 | — |
| 13 | 語法驗證失敗顯示錯誤面板與行號標記 | F-VL-04~05, F-ED-09~10 | — | E2E-06 | — |
| 14 | 驗證服務不可用時顯示黃色警告且不阻塞 | F-VL-06~07 | — | — | MAN-05 |
| 15 | 編輯器內容為空時點擊 Validate 顯示提示 | F-VL-02, F-AP-06 | — | E2E-21 | — |
| 16 | 驗證請求格式錯誤顯示錯誤 | F-VL-08 | — | — | — |
| 17 | systemd-analyze 輸出僅含警告時視為通過 | SYS-35 | — | — | — |
| 18 | 點擊 Save 彈出變更確認對話框 | F-SV-01~03 | — | E2E-07 | — |
| 19 | 儲存確認對話框點擊取消後回到編輯器 | F-SV-04 | — | E2E-08 | — |
| 20 | 確認儲存後成功寫入並返回 Dashboard | F-SV-05~06, F-CE-04 | INT-02 | E2E-07 | MAN-01 |
| 21 | 儲存失敗時顯示紅色 Toast 並恢復可編輯 | F-SV-07, F-CE-05 | — | E2E-14 | — |
| 22 | daemon-reload 失敗時顯示部分成功提示與備份路徑 | F-SV-08, HDL-19 | INT-07 | E2E-15 | — |
| 23 | 儲存遭遇 409 衝突時提示重新載入 | F-SV-09, F-CE-07 | INT-04 | E2E-16 | MAN-06 |
| 24 | 儲存內容為空時顯示額外警告 | F-SV-10 | — | E2E-17 | — |
| 25 | 權限不足無法寫入設定檔 | F-SV-11 | — | — | MAN-04 |
| 26 | 儲存期間網路中斷 | F-SV-12 | — | — | MAN-10 |
| 27 | 編輯器為 clean 時點擊 Cancel 直接返回 | F-CN-01 | — | — | — |
| 28 | 編輯器為 dirty 時點擊 Cancel 彈出放棄確認 | F-CN-02 | — | E2E-09 | — |
| 29 | 放棄確認中選擇 Stay 回到編輯器 | F-CN-03 | — | E2E-10 | — |
| 30 | 放棄確認中選擇 Discard Changes 返回 Dashboard | F-CN-04 | — | E2E-09 | — |
| 31 | 瀏覽器返回鍵觸發相同的 dirty-check 邏輯 | F-CN-05~06 | — | E2E-11 | — |
| 32 | 權限不足無法讀取設定檔 | F-VW-10 | — | — | MAN-03 |
| 33 | GET 成功回傳設定檔內容 | SYS-01~03, HDL-01 | INT-01 | — | — |
| 34 | GET 服務名稱無效回傳 400 | HDL-02 | — | E2E-22 | — |
| 35 | GET 鎖定服務回傳 403（**依決策 D-2 調整**：GET 鎖定服務回 200 唯讀，403 僅適用 PUT） | HDL-03 | — | E2E-03 | — |
| 36 | GET FragmentPath 為空回傳 404 | SYS-04, HDL-04 | — | — | — |
| 37 | GET 設定檔不存在回傳 404 | SYS-05, HDL-05 | — | E2E-13 | — |
| 38 | GET 檔案超過 500KB 回傳 413 | SYS-07, HDL-06 | — | — | MAN-07 |
| 39 | GET 權限不足回傳 500 | SYS-06, HDL-07 | — | — | MAN-03 |
| 40 | GET 未登入回傳 401 | HDL-08 | — | E2E-27 | — |
| 41 | PUT 成功儲存設定檔（備份 → 寫入 → daemon-reload → audit） | SYS-18~19, SYS-24~26, HDL-09 | INT-02 | E2E-07 | MAN-01 |
| 42 | PUT 服務名稱無效回傳 400 | HDL-10 | — | E2E-23 | — |
| 43 | PUT 鎖定服務回傳 403 | SYS-09~10, HDL-11 | — | — | — |
| 44 | PUT 路徑遍歷嘗試回傳 403 | SYS-12, HDL-12 | INT-09 | — | — |
| 45 | PUT 非 .service 類型設定檔回傳 403 | SYS-16~17, HDL-13 | — | — | — |
| 46 | PUT 內容超過 500KB 回傳 413 | HDL-14 | — | — | MAN-07 |
| 47 | PUT 寫入失敗時還原備份並回傳 500 | SYS-25, HDL-18, SYS-45 | INT-06 | — | — |
| 48 | PUT daemon-reload 失敗時不還原設定檔並回傳錯誤與備份路徑 | SYS-44~45, HDL-19 | INT-07 | E2E-15 | — |
| 49 | PUT 偵測並發衝突回傳 409 | SYS-28~32, HDL-16~17 | INT-03~04 | E2E-16 | MAN-06 |
| 50 | PUT 未登入回傳 401 | HDL-20 | — | E2E-28 | — |
| 51 | Validate 語法正確回傳 valid=true | SYS-33, HDL-21 | INT-05 | E2E-05 | — |
| 52 | Validate 語法錯誤回傳 valid=false 與行號錯誤 | SYS-34, HDL-22 | INT-05 | E2E-06 | — |
| 53 | Validate 時 systemd-analyze 不存在回傳明確錯誤（依決策 D-3：200 available:false） | SYS-38, HDL-23 | — | — | MAN-05 |
| 54 | Validate 暫存檔建立失敗回傳錯誤 | SYS-41, HDL-24 | — | — | — |
| 55 | Validate 未登入回傳 401 | HDL-26 | — | E2E-29 | — |
| 56 | Validate 執行後暫存檔被刪除 | SYS-42~43 | INT-05 | — | MAN-11 |
| 57 | 備份保留最近 5 份，超出刪除最舊 | SYS-20~23 | INT-08 | — | MAN-02 |
| 58 | 檢視設定檔寫入 audit log（config_view） | HDL-27, HDL-30 | INT-01 | — | MAN-08 |
| 59 | 儲存設定檔寫入 audit log（config_save） | HDL-28~29 | INT-02 | — | MAN-08 |
| 60 | daemon-reload 逾時設定為 10 秒 | SYS-44 | — | — | — |
| 61 | 後端不實作悲觀鎖定（last-write-wins） | SYS-46 | INT-04 | — | MAN-06 |
| 62 | 僅 /etc/systemd/system/ 下的自訂服務可編輯 | SYS-08~10, F-SR-04 | — | E2E-01 | — |
| 63 | 不同佈景模式下編輯器主題正確切換（Outline ×2） | F-TH-01~03 | — | E2E-18a, E2E-18b | — |
| 64 | 手機 RWD 下編輯器仍可使用 | F-TH-04 | — | E2E-19 | — |
| 65 | 儲存後回到 Dashboard 服務列表狀態正確更新 | — | INT-10 | E2E-20 | — |
| 66 | 不同語法錯誤回傳對應行號與訊息（Outline ×4） | SYS-36~37（覆蓋 4 Examples：Unknown key / Section not found / Missing '=' / Exec path） | — | E2E-06（代表性） | — |
| 67 | 無效服務名稱在三種 API 上皆回傳 400（Outline ×5） | HDL-02, HDL-10, HDL-25 | — | E2E-22~26 | — |

> **覆蓋率**：67/67 BDD Scenario 全覆蓋（含 3 組 Scenario Outline 之 Examples 全部展開：主題 ×2、語法錯誤 ×4、無效名稱 ×5）。
> **已知 BDD 矛盾**：#35（GET 鎖定服務 403）依 Tech Decision D-2 調整為「GET 鎖定服務回 200 唯讀檢視、403 僅適用 PUT」——否則唯讀檢視（Scenario 7）與 View Config 進入點（Scenario 2）無法成立。
> **總計**：SYS 46 + HDL 30 + F 約 50 + INT 10 + E2E 29 + MAN 12 ≈ 177 個測試案例。

---

*由 Test Plan Generator 自動產生，對應 BDD `docs/bdds/012-service-config-editor.feature`（技術裁決依 `docs/tech-decisions/012-service-config-editor.md`）*
