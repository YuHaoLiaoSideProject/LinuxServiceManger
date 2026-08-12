@service-config-editor @config @systemd @smoke @regression
Feature: 服務設定檔編輯器
  作為一個已登入的管理員
  我希望在 Web UI 中直接檢視與編輯 systemd service unit file（僅限 /etc/systemd/system/ 下的自訂服務），並透過內建語法驗證與變更確認機制編輯設定
  以便不需 SSH 進機器即可完成服務設定檔調整，降低人為錯誤風險，並讓 audit log 完整記錄每次設定變更

  Background:
    Given 管理員已登入系統
    And 系統處於正常運作狀態
    And systemd 服務管理器正常運作

  # ══════════════════════════════════════════════════════════════
  # 前端 — 進入點（Dashboard → 編輯器）
  # ══════════════════════════════════════════════════════════════

  @entry @happy-path @p0 @smoke
  Scenario: 解鎖服務顯示「Edit Config」按鈕
    Given 服務列表中有一個解鎖服務 nginx（locked: false，FragmentPath 為 /etc/systemd/system/nginx.service）
    When 管理員查看該服務列的 Actions 區域
    Then Actions 區域顯示「Edit Config」按鈕（與 Start / Stop / Restart 按鈕同列）
    And 按鈕樣式與其他操作按鈕一致

  @entry @happy-path @p0 @smoke
  Scenario: 鎖定服務顯示「View Config」唯讀按鈕
    Given 服務列表中有一個鎖定服務 systemd-journald（locked: true）
    When 管理員查看該服務列的 Actions 區域
    Then Actions 區域顯示「View Config」按鈕而非「Edit Config」

  @entry @happy-path @p0 @smoke
  Scenario: 點擊 Edit Config 導航至編輯器頁面並顯示載入狀態
    Given 管理員位於 Dashboard 服務列表
    And 服務 nginx 為解鎖狀態且 FragmentPath 非空
    When 管理員點擊 nginx 的「Edit Config」按鈕
    Then 前端路由導航至 /services/nginx/config
    And 頁面顯示 loading spinner 與「載入設定檔中...」文字
    And 前端發送 GET /api/v1/services/nginx/config 請求

  @entry @error-handling @p0
  Scenario: 設定檔載入失敗時顯示錯誤與重試
    Given 管理員已點擊「Edit Config」按鈕並進入編輯器頁面
    And GET /api/v1/services/nginx/config 回傳失敗（非 404）
    When 前端收到失敗回應
    Then 頁面顯示錯誤訊息與錯誤原因
    And 頁面顯示「返回」按鈕
    And 頁面顯示「重試」按鈕

  @entry @error-handling @p1
  Scenario: 設定檔已被刪除時顯示空編輯器與提示
    Given 服務 nginx 的 FragmentPath /etc/systemd/system/nginx.service 已不存在（設定檔被手動刪除）
    When 管理員點擊 nginx 的「Edit Config」按鈕
    And GET /api/v1/services/nginx/config 回傳 404
    Then 編輯器顯示空內容
    And 頁面顯示黃色提示「設定檔不存在：/etc/systemd/system/nginx.service。請確認服務設定檔是否已被手動刪除。」
    And 管理員仍可手動輸入內容後儲存（建立新設定檔）

  # ══════════════════════════════════════════════════════════════
  # 前端 — 編輯器載入與顯示
  # ══════════════════════════════════════════════════════════════

  @editor @happy-path @p0 @smoke
  Scenario: 編輯器載入 unit file 內容並套用語法 highlight
    Given GET /api/v1/services/nginx/config 已成功回傳設定檔內容
    When Monaco Editor 載入完成
    Then 編輯器顯示 unit file 原始內容
    And 編輯器套用 systemd unit file 語法 highlight（[Unit]、[Service]、[Install] 等 section 以不同顏色標示）
    And 編輯器上方顯示服務名稱與 FragmentPath（/etc/systemd/system/nginx.service）
    And 頁面底部顯示 Validate / Save / Cancel 三個按鈕

  @editor @happy-path @p1
  Scenario: 唯讀模式檢視鎖定服務設定檔
    Given 管理員透過「View Config」進入鎖定服務的編輯器頁面
    When 頁面載入完成
    Then 編輯器設為唯讀（readOnly: true）
    And 設定檔內容顯示並有語法 highlight，但不接受任何編輯
    And 底部僅顯示「Close」按鈕，不顯示 Validate / Save

  @editor @edge-case @p1
  Scenario: 設定檔超過 500KB 時顯示效能提示
    Given GET /api/v1/services/nginx/config 回傳 size 為 600000（超過 500KB）
    When 編輯器載入完成
    Then 編輯器仍可正常載入內容
    And 頁面顯示黃色提示「設定檔較大（600000），編輯時可能有效能影響。」
    And 該提示不阻塞後續編輯操作

  # ══════════════════════════════════════════════════════════════
  # 前端 — 編輯與 dirty 狀態
  # ══════════════════════════════════════════════════════════════

  @editor @happy-path @p0
  Scenario: 編輯內容後進入 dirty 狀態並啟用 Save
    Given 編輯器已載入 nginx 設定檔原始內容
    And Save 按鈕為灰色（disabled），因為尚無變更
    When 管理員在編輯器中修改內容（例如更改 ExecStart 或新增 Environment）
    Then Save 按鈕由 disabled 變為 enabled
    And 頁面標題旁或編輯器 tab 顯示「●」未儲存變更指示

  @editor @happy-path @p1
  Scenario: 內容變更後自動清除先前驗證結果
    Given 管理員先前已執行語法驗證且結果為「失敗」並顯示錯誤面板
    When 管理員再次編輯設定檔內容
    Then 先前的驗證結果自動清除（因為內容已變更，舊驗證結果失效）
    And 編輯器上的錯誤行標記一併清除

  @editor @business-rules @p1
  Scenario: Monaco Editor 使用 INI 語法與固定編輯器設定
    Given 編輯器已載入設定檔
    When 管理員檢視編輯器設定
    Then 編輯器 language 設定為 ini（systemd unit file 相容於 INI）
    And tabSize 為 2
    And wordWrap 為 on
    And minimap 為 off

  # ══════════════════════════════════════════════════════════════
  # 前端 — 語法驗證（Validate）
  # ══════════════════════════════════════════════════════════════

  @validate @happy-path @p0 @smoke
  Scenario: 語法驗證通過顯示綠色提示
    Given 管理員已修改 nginx 設定檔內容
    And 目前編輯器內容語法正確
    When 管理員點擊「Validate」按鈕
    Then Validate 按鈕變為 loading spinner 並顯示「Verifying...」，且按鈕禁用防止重複點擊
    And 前端發送 POST /api/v1/services/nginx/config/validate（body 含目前編輯內容）
    And 後端回傳 valid=true
    Then 頁面顯示綠色提示「✅ 語法驗證通過 — 設定檔語法正確」
    And 編輯器中的任何錯誤標記被清除
    And Validate 按鈕恢復正常狀態

  @validate @happy-path @p0
  Scenario: 語法驗證失敗顯示錯誤面板與行號標記
    Given 管理員已修改 nginx 設定檔內容
    And 後端驗證回傳 valid=false 且 errors 包含 [{ "line": 12, "message": "Unknown key 'ExecStartt'" }]
    When 管理員點擊「Validate」按鈕
    Then 頁面在編輯器下方顯示紅色錯誤面板（不覆蓋編輯器）
    And 錯誤面板逐條列出錯誤「Line 12: Unknown key 'ExecStartt'」
    And 編輯器第 12 行左側顯示紅色波浪線標記
    And 編輯器 gutter 顯示 ❌ icon
    And Validate 按鈕恢復正常狀態

  @validate @error-handling @p1
  Scenario: 驗證服務不可用時顯示黃色警告且不阻塞
    Given 管理員已修改 nginx 設定檔內容
    And 後端驗證服務不可用（500 或網路錯誤）
    When 管理員點擊「Validate」按鈕
    Then 頁面顯示黃色警告「⚠️ 無法執行語法驗證 — systemd-analyze 不可用或執行錯誤。您仍可直接儲存設定檔。」
    And 編輯器維持可編輯狀態
    And 管理員可選擇略過驗證直接儲存，或稍後重試

  @validate @error-handling @p0 @validation
  Scenario: 編輯器內容為空時點擊 Validate 顯示提示
    Given 編輯器中沒有任何內容
    When 管理員點擊「Validate」按鈕
    Then 前端攔截請求，不發送 API 呼叫
    And 頁面顯示提示「設定檔內容為空，請先編輯或載入內容」

  @validate @error-handling @p1
  Scenario: 驗證請求格式錯誤顯示錯誤
    Given 管理員已修改 nginx 設定檔內容
    And 後端對驗證請求回傳 400 或 422（請求格式錯誤）
    When 管理員點擊「Validate」按鈕
    Then 頁面顯示錯誤「請求格式錯誤」
    And 編輯器維持可編輯狀態

  @validate @edge-case @p1
  Scenario: systemd-analyze 輸出僅含系統噪音（無行號診斷）時視為通過
    Given 後端執行 systemd-analyze verify 的輸出僅包含無行號的系統噪音（如其他 unit 的 permission 警告）
    When 管理員點擊「Validate」按鈕
    Then 後端回傳 valid=true
    And 頁面顯示綠色提示「✅ 語法驗證通過 — 設定檔語法正確」

  @validate @edge-case @p1
  Scenario: 打錯字級別問題（Missing '=' / Unknown key）即使 exit 0 仍視為失敗
    Given 管理員把「WantedBy=multi-user.target」改為「WantedBy multi-user.target」（漏掉等號）
    And systemd-analyze verify 對該內容印出「Missing '=', ignoring line.」診斷但 exit 0（systemd 257 實測行為：該行會被靜默忽略）
    When 管理員點擊「Validate」按鈕
    Then 後端回傳 valid=false 且 errors 包含 [{ "line": 8, "message": "Missing '=', ignoring line." }]
    And 頁面顯示紅色錯誤面板並在第 8 行標記波浪線

  # ══════════════════════════════════════════════════════════════
  # 前端 — 儲存（Save）
  # ══════════════════════════════════════════════════════════════

  @save @happy-path @p0 @smoke
  Scenario: 點擊 Save 彈出變更確認對話框
    Given 編輯器處於 dirty 狀態（有未儲存變更）
    And Save 按鈕已啟用
    When 管理員點擊「Save」按鈕
    Then 彈出 ConfirmModal，標題為「儲存設定檔變更」
    And Modal 內容包含「確定要將變更寫入 /etc/systemd/system/nginx.service 嗎？」
    And Modal 內容包含「儲存後將自動執行 systemctl daemon-reload 使變更生效」
    And Modal 內容包含風險警告「⚠️ 錯誤的設定可能導致服務無法啟動。」
    And Modal 顯示 Cancel（次要）與 Save Changes（主要/危險色）按鈕

  @save @happy-path @p1
  Scenario: 儲存確認對話框點擊取消後回到編輯器
    Given 儲存 ConfirmModal 已開啟
    When 管理員點擊「Cancel」按鈕
    Then Modal 關閉
    And 回到編輯器，編輯內容與 dirty 狀態保持不變

  @save @happy-path @p0 @smoke
  Scenario: 確認儲存後成功寫入並返回 Dashboard
    Given 管理員已在儲存 ConfirmModal 中點擊「Save Changes」
    When 系統執行儲存流程
    Then Save 按鈕變為 loading spinner 並顯示「Saving...」
    And 編輯器設為唯讀（儲存期間不可編輯）
    And 前端發送 PUT /api/v1/services/nginx/config（body 含目前編輯內容）
    And 後端回傳 200 且包含 backupPath
    And 編輯器標記變為 clean（未儲存指示清除）
    And 頁面顯示綠色 Toast「nginx 設定檔已儲存，daemon-reload 已執行」
    And 1.5 秒後自動返回 Dashboard（或管理員手動點擊 Back）

  @save @error-handling @p0
  Scenario: 儲存失敗時顯示紅色 Toast 並恢復可編輯
    Given 管理員已在儲存 ConfirmModal 中點擊「Save Changes」
    And 後端對 PUT /api/v1/services/nginx/config 回傳錯誤（如 500 寫入失敗）
    When 系統收到失敗回應
    Then 頁面顯示紅色 Toast「儲存失敗：{錯誤原因}」
    And 編輯器恢復可編輯狀態
    And 編輯內容保留，管理員可修正後再次儲存

  @save @error-handling @p0
  Scenario: daemon-reload 失敗時顯示部分成功提示與備份路徑
    Given 管理員已在儲存 ConfirmModal 中點擊「Save Changes」
    And 設定檔已成功寫入，但 systemctl daemon-reload 執行失敗
    When 系統收到後端回應（錯誤 + backupPath）
    Then 頁面顯示紅色 Toast「設定檔已儲存，但 daemon-reload 失敗：{錯誤}。請手動執行 systemctl daemon-reload。備份檔：{backupPath}」
    And 編輯器恢復可編輯狀態

  @save @error-handling @p0
  Scenario: 儲存遭遇 409 衝突時提示重新載入
    Given 管理員已在儲存 ConfirmModal 中點擊「Save Changes」
    And 後端偵測到設定檔已被其他使用者修改，回傳 409 Conflict
    When 系統收到 409 回應
    Then 頁面顯示 Toast「設定檔已被其他使用者修改。請重新載入後再編輯。」
    And 提示管理員重新載入設定檔並對比差異後再次編輯

  @save @edge-case @p1
  Scenario: 儲存內容為空時顯示額外警告
    Given 編輯器內容為空
    When 管理員點擊「Save」按鈕
    Then 儲存 ConfirmModal 額外顯示警告「⚠️ 設定檔內容為空。儲存空設定檔可能導致 systemd 無法解析。確定要繼續嗎？」
    And 管理員確認後仍可儲存
    And 管理員點擊取消則回到編輯器

  @save @error-handling @p1
  Scenario: 權限不足無法寫入設定檔
    Given 管理員已在儲存 ConfirmModal 中點擊「Save Changes」
    And LMS 執行使用者對 /etc/systemd/system/nginx.service 無寫入權限
    When 系統收到後端寫入失敗回應
    Then 頁面顯示紅色 Toast「儲存失敗：權限不足，無法寫入 /etc/systemd/system/nginx.service。請確認 LMS 執行使用者具備寫入權限。」
    And 編輯器恢復可編輯狀態

  @save @error-handling @p1
  Scenario: 儲存期間網路中斷
    Given 管理員已在儲存 ConfirmModal 中點擊「Save Changes」
    And 儲存請求發送後網路中斷
    When 系統偵測到請求失敗
    Then 頁面顯示「網路連線異常，請稍後重試」
    And 編輯器內容保留在瀏覽器記憶體中
    And 編輯器恢復可編輯狀態

  # ══════════════════════════════════════════════════════════════
  # 前端 — 取消 / 返回
  # ══════════════════════════════════════════════════════════════

  @cancel @happy-path @p1
  Scenario: 編輯器為 clean 時點擊 Cancel 直接返回
    Given 編輯器處於 clean 狀態（無未儲存變更）
    When 管理員點擊「Cancel」按鈕
    Then 不彈出任何確認對話框
    And 直接返回 Dashboard

  @cancel @happy-path @p1
  Scenario: 編輯器為 dirty 時點擊 Cancel 彈出放棄確認
    Given 編輯器處於 dirty 狀態（有未儲存變更）
    When 管理員點擊「Cancel」按鈕
    Then 彈出 ConfirmModal「有未儲存的變更，確定要離開嗎？未儲存的變更將會遺失。」
    And Modal 顯示 Stay 與 Discard Changes 按鈕

  @cancel @happy-path @p1
  Scenario: 放棄確認中選擇 Stay 回到編輯器
    Given 放棄變更 ConfirmModal 已開啟
    When 管理員點擊「Stay」按鈕
    Then Modal 關閉
    And 回到編輯器，編輯內容與 dirty 狀態保持不變

  @cancel @happy-path @p1
  Scenario: 放棄確認中選擇 Discard Changes 返回 Dashboard
    Given 放棄變更 ConfirmModal 已開啟
    When 管理員點擊「Discard Changes」按鈕
    Then Modal 關閉
    And 返回 Dashboard
    And 頁面顯示灰色 Toast「已放棄未儲存的變更」

  @cancel @edge-case @p1
  Scenario: 瀏覽器返回鍵觸發相同的 dirty-check 邏輯
    Given 編輯器處於 dirty 狀態（有未儲存變更）
    When 管理員按下瀏覽器返回鍵
    Then 前端攔截並彈出與點擊 Cancel 相同的確認對話框
    And 管理員選擇 Discard Changes 後才離開編輯器頁面

  # ══════════════════════════════════════════════════════════════
  # 前端 — 權限不足（讀取）與其他異常
  # ══════════════════════════════════════════════════════════════

  @load @error-handling @p1
  Scenario: 權限不足無法讀取設定檔
    Given LMS 執行使用者對 /etc/systemd/system/nginx.service 無讀取權限
    And GET /api/v1/services/nginx/config 回傳 500 且錯誤原因為權限不足
    When 管理員點擊「Edit Config」按鈕
    Then 編輯器顯示錯誤「無法讀取設定檔：權限不足。請確認 LMS 執行使用者具備讀取權限。」
    And 頁面顯示「返回」按鈕

  # ══════════════════════════════════════════════════════════════
  # 後端 API — GET /api/v1/services/{name}/config
  # ══════════════════════════════════════════════════════════════

  @api @happy-path @p0 @smoke
  Scenario: GET 成功回傳設定檔內容
    Given 服務 nginx 存在，FragmentPath 為 /etc/systemd/system/nginx.service
    And 該檔案存在且可讀取
    When 前端發送 GET 請求至 /api/v1/services/nginx/config
    Then 後端讀取 FragmentPath 指向的檔案內容
    And 後端回傳 HTTP 200
    And 回應 JSON 包含 name 為「nginx」
    And 回應 JSON 包含 fragmentPath 為「/etc/systemd/system/nginx.service」
    And 回應 JSON 包含 config 欄位為檔案完整內容
    And 回應 JSON 包含 size 欄位為檔案位元組數

  @api @error-handling @p0 @validation
  Scenario: GET 服務名稱無效回傳 400
    When 前端發送 GET 請求至 /api/v1/services/invalid name!/config
    Then 後端以 ValidateServiceName 驗證服務名稱
    And 後端回傳 HTTP 400
    And 錯誤訊息為「invalid service name」

  @api @error-handling @p0 @security
  Scenario: GET 鎖定服務（FragmentPath 不在 /etc/systemd/system/ 下）回傳 403
    Given 服務 systemd-journald 的 FragmentPath 為 /usr/lib/systemd/system/systemd-journald.service（鎖定服務）
    When 前端發送 GET 請求至 /api/v1/services/systemd-journald/config
    Then 後端驗證 FragmentPath 不在 /etc/systemd/system/ 目錄下
    And 後端回傳 HTTP 403
    And 錯誤訊息為「不允許編輯此服務設定檔」

  @api @error-handling @p0
  Scenario: GET FragmentPath 為空回傳 404
    Given 服務 nginx 存在但其 FragmentPath 為空
    When 前端發送 GET 請求至 /api/v1/services/nginx/config
    Then 後端回傳 HTTP 404
    And 回應包含明確錯誤訊息（設定檔路徑不存在）

  @api @error-handling @p0
  Scenario: GET 設定檔不存在回傳 404
    Given 服務 nginx 的 FragmentPath 為 /etc/systemd/system/nginx.service
    And 該檔案已不存在
    When 前端發送 GET 請求至 /api/v1/services/nginx/config
    Then 後端回傳 HTTP 404
    And 回應包含明確錯誤訊息（設定檔不存在）

  @api @error-handling @p0 @boundary
  Scenario: GET 檔案超過 500KB 回傳 413
    Given 服務 big-svc 的設定檔大小為 600000 bytes（超過 500KB）
    When 前端發送 GET 請求至 /api/v1/services/big-svc/config
    Then 後端回傳 HTTP 413
    And 錯誤訊息說明設定檔超過 500KB 大小限制

  @api @error-handling @p1
  Scenario: GET 權限不足回傳 500
    Given LMS 執行使用者對設定檔無讀取權限
    When 前端發送 GET 請求至 /api/v1/services/nginx/config
    Then 後端讀取檔案失敗
    And 後端回傳 HTTP 500
    And 回應包含錯誤原因（權限不足）

  @api @error-handling @p0 @security
  Scenario: GET 未登入回傳 401
    Given 客戶端未登入且未攜帶有效驗證資訊
    When 客戶端發送 GET 請求至 /api/v1/services/nginx/config
    Then Auth middleware 攔截請求
    And 後端回傳 HTTP 401 Unauthorized

  # ══════════════════════════════════════════════════════════════
  # 後端 API — PUT /api/v1/services/{name}/config
  # ══════════════════════════════════════════════════════════════

  @api @happy-path @p0 @smoke
  Scenario: PUT 成功儲存設定檔（備份 → 寫入 → daemon-reload → audit）
    Given 服務 nginx 為解鎖服務，FragmentPath 為 /etc/systemd/system/nginx.service
    And 編輯前檔案內容 checksum 與管理員載入時的基準一致（無並發修改）
    When 前端發送 PUT 請求至 /api/v1/services/nginx/config
    And 請求 body 為 {"config": "<編輯後的 unit file 內容>"}
    Then 後端驗證服務名稱合法
    And 後端驗證 FragmentPath 確實在 /etc/systemd/system/ 目錄下（路徑遍歷防護）
    And 後端在寫入前建立備份檔 nginx.service.bak.{ISO8601_timestamp}（存放於同一目錄）
    And 後端將新內容寫入 /etc/systemd/system/nginx.service
    And 後端執行 systemctl daemon-reload
    And 後端寫入 audit log（action=config_save）
    And 後端回傳 HTTP 200
    And 回應 JSON 包含 message 與 backupPath

  @api @error-handling @p0 @validation
  Scenario: PUT 服務名稱無效回傳 400
    When 前端發送 PUT 請求至 /api/v1/services/invalid name!/config
    And 請求 body 為 {"config": "..."}
    Then 後端以 ValidateServiceName 驗證服務名稱
    And 後端回傳 HTTP 400
    And 錯誤訊息為「invalid service name」

  @api @error-handling @p0 @security
  Scenario: PUT 鎖定服務回傳 403
    Given 服務 systemd-journald 為鎖定服務（FragmentPath 為 /usr/lib/systemd/system/systemd-journald.service）
    When 前端發送 PUT 請求至 /api/v1/services/systemd-journald/config
    And 請求 body 為 {"config": "..."}
    Then 後端驗證 FragmentPath 不在 /etc/systemd/system/ 目錄下
    And 後端拒絕寫入並回傳 HTTP 403
    And 錯誤訊息為「不允許編輯此服務設定檔」

  @api @error-handling @p0 @security
  Scenario: PUT 路徑遍歷嘗試回傳 403
    Given 服務 evil-svc 的 FragmentPath 被竄改為 /etc/systemd/system/../../etc/passwd
    When 前端發送 PUT 請求至 /api/v1/services/evil-svc/config
    And 請求 body 為 {"config": "..."}
    Then 後端以正規化路徑驗證 FragmentPath 仍在 /etc/systemd/system/ 目錄下
    And 路徑遍歷被偵測，後端拒絕寫入並回傳 HTTP 403
    And 檔案系統不受任何影響

  @api @error-handling @p1
  Scenario: PUT 非 .service 類型設定檔回傳 403
    Given 服務 backup 的 FragmentPath 為 /etc/systemd/system/backup.timer（非 .service 結尾）
    When 前端發送 PUT 請求至 /api/v1/services/backup/config
    And 請求 body 為 {"config": "..."}
    Then 後端確認檔案類型非 .service
    And 後端拒絕編輯並回傳 HTTP 403
    And 錯誤訊息說明僅支援 .service 設定檔

  @api @error-handling @p0 @boundary
  Scenario: PUT 內容超過 500KB 回傳 413
    Given 管理員編輯後的設定檔內容大小為 600000 bytes（超過 500KB）
    When 前端發送 PUT 請求至 /api/v1/services/nginx/config
    And 請求 body 為 {"config": "<600KB 內容>"}
    Then 後端回傳 HTTP 413
    And 設定檔未被寫入且不建立備份

  @api @error-handling @p1
  Scenario: PUT 寫入失敗時還原備份並回傳 500
    Given 後端已建立備份 nginx.service.bak.{timestamp}
    And 寫入新設定檔內容時發生錯誤（如磁碟空間不足）
    When 後端處理 PUT 請求
    Then 後端還原備份檔至原路徑
    And 後端回傳 HTTP 500
    And 錯誤訊息為「寫入失敗」

  @api @error-handling @p1
  Scenario: PUT daemon-reload 失敗時不還原設定檔並回傳錯誤與備份路徑
    Given 新設定檔內容已成功寫入 /etc/systemd/system/nginx.service
    And systemctl daemon-reload 執行失敗（或超過 10 秒逾時）
    When 後端執行 daemon-reload
    Then 後端不還原已寫入的設定檔
    And 後端回傳 HTTP 500
    And 回應包含錯誤訊息（daemon-reload 失敗）與 backupPath

  @api @error-handling @p0 @edge-case
  Scenario: PUT 偵測並發衝突回傳 409
    Given 管理員 A 於時間 T0 載入設定檔（內容版本 V1）
    And 另一位管理員已於 T1 儲存修改（目前檔案內容為 V2，與管理員 A 的基準不一致）
    When 管理員 A 發送 PUT 請求儲存其修改
    Then 後端比對寫入前後 checksum，偵測到檔案已被他人修改
    And 後端回傳 HTTP 409 Conflict
    And 錯誤訊息為「設定檔已被其他使用者修改。請重新載入後再編輯。」

  @api @error-handling @p0 @security
  Scenario: PUT 未登入回傳 401
    Given 客戶端未登入且未攜帶有效驗證資訊
    When 客戶端發送 PUT 請求至 /api/v1/services/nginx/config
    Then Auth middleware 攔截請求
    And 後端回傳 HTTP 401 Unauthorized
    And 設定檔未被修改

  # ══════════════════════════════════════════════════════════════
  # 後端 API — POST /api/v1/services/{name}/config/validate
  # ══════════════════════════════════════════════════════════════

  @api @happy-path @p0 @smoke
  Scenario: Validate 語法正確回傳 valid=true
    Given 管理員編輯後的設定檔內容語法正確
    When 前端發送 POST 請求至 /api/v1/services/nginx/config/validate
    And 請求 body 為 {"config": "<編輯內容>"}
    Then 後端將內容寫入暫存檔 /tmp/lsm-validate-{uuid}.service
    And 後端執行 systemd-analyze verify /tmp/lsm-validate-{uuid}.service
    And 後端解析輸出並確認無錯誤
    And 後端刪除暫存檔
    And 後端回傳 HTTP 200
    And 回應 JSON 為 {"valid": true, "errors": []}

  @api @happy-path @p0
  Scenario: Validate 語法錯誤回傳 valid=false 與行號錯誤
    Given 管理員編輯後的設定檔內容包含錯誤「Unknown key 'ExecStartt'」位於第 12 行
    When 前端發送 POST 請求至 /api/v1/services/nginx/config/validate
    And 請求 body 為 {"config": "<含錯誤內容>"}
    Then 後端執行 systemd-analyze verify 並解析錯誤輸出（含行號）
    And 後端刪除暫存檔
    And 後端回傳 HTTP 200
    And 回應 JSON 為 {"valid": false, "errors": [{"line": 12, "message": "Unknown key 'ExecStartt' in section [Service], ignoring."}]}

  @api @error-handling @p1
  Scenario: Validate 時 systemd-analyze 不存在回傳明確錯誤
    Given 系統環境中不存在 systemd-analyze 指令（例如容器環境）
    When 前端發送 POST 請求至 /api/v1/services/nginx/config/validate
    And 請求 body 為 {"config": "..."}
    Then 後端偵測 systemd-analyze 指令不存在
    And 後端回傳明確錯誤（非 500 crash），訊息為「systemd-analyze 指令不存在，無法進行語法驗證」
    And 前端據此顯示黃色警告且不阻塞後續操作

  @api @error-handling @p1
  Scenario: Validate 暫存檔建立失敗回傳錯誤
    Given /tmp 目錄空間不足或權限異常
    When 前端發送 POST 請求至 /api/v1/services/nginx/config/validate
    And 請求 body 為 {"config": "..."}
    Then 後端建立暫存檔 /tmp/lsm-validate-{uuid}.service 失敗
    And 後端回傳錯誤，訊息為「無法建立暫存檔進行驗證。請檢查 /tmp 目錄空間與權限。」
    And 前端據此顯示黃色警告

  @api @error-handling @p0 @security
  Scenario: Validate 未登入回傳 401
    Given 客戶端未登入且未攜帶有效驗證資訊
    When 客戶端發送 POST 請求至 /api/v1/services/nginx/config/validate
    Then Auth middleware 攔截請求
    And 後端回傳 HTTP 401 Unauthorized

  @api @edge-case @p1
  Scenario: Validate 執行後暫存檔被刪除
    Given 後端已建立暫存檔 /tmp/lsm-validate-{uuid}.service
    When 後端完成 systemd-analyze verify 並回傳結果
    Then 暫存檔被立即刪除
    And /tmp 目錄中不殘留驗證暫存檔

  # ══════════════════════════════════════════════════════════════
  # 商業規則 — 備份、稽核與安全性
  # ══════════════════════════════════════════════════════════════

  @business-rules @p0 @audit @compliance
  Scenario: 備份保留最近 5 份，超出刪除最舊
    Given 服務 nginx 的備份目錄中已有 5 份備份（nginx.service.bak.{t1} 至 nginx.service.bak.{t5}，t1 為最舊）
    When 管理員再次儲存 nginx 設定檔
    Then 建立第 6 份備份 nginx.service.bak.{t6}
    And 最舊備份 nginx.service.bak.{t1} 被刪除
    And 備份目錄維持最近 5 份備份

  @business-rules @p0 @audit @compliance
  Scenario: 檢視設定檔寫入 audit log（config_view）
    Given 服務 nginx 為解鎖服務
    When 管理員載入 /services/nginx/config 頁面且 GET 請求成功
    Then Audit Log 中記錄一筆 action 為「config_view」的操作
    And 記錄內容包含操作者與服務名稱

  @business-rules @p0 @audit @compliance
  Scenario: 儲存設定檔寫入 audit log（config_save）
    Given 管理員成功儲存 nginx 設定檔變更
    When 後端完成整個儲存流程（寫入 + daemon-reload 成功）
    Then Audit Log 中記錄一筆 action 為「config_save」的操作
    And 記錄內容包含操作者、服務名稱與時間戳記

  @business-rules @p0 @security
  Scenario: daemon-reload 逾時設定為 10 秒
    Given 後端準備執行 systemctl daemon-reload
    When systemctl daemon-reload 執行超過 10 秒
    Then 後端判定 daemon-reload 逾時並視為失敗
    And 回傳錯誤但仍告知設定檔已寫入，並附上備份路徑

  @business-rules @p1 @security
  Scenario: 後端不實作悲觀鎖定（last-write-wins）
    Given 兩位管理員同時編輯同一服務的設定檔
    When 兩者皆送出儲存請求
    Then 後端不鎖定檔案，允許兩者依序寫入
    And 後端以 checksum 比對偵測並發衝突
    And 先寫入者成功，後寫入者若基準不一致則收到 409

  @business-rules @p1
  Scenario: 僅 /etc/systemd/system/ 下的自訂服務可編輯
    Given 服務列表包含以下服務：
      | 服務            | FragmentPath                             | locked |
      | nginx           | /etc/systemd/system/nginx.service        | false  |
      | systemd-journald| /usr/lib/systemd/system/systemd-journald.service | true |
      | httpd           | /run/systemd/system/httpd.service        | true   |
    When 管理員查看各服務的 Actions 區域
    Then nginx 顯示「Edit Config」（可編輯）
    And systemd-journald 與 httpd 顯示「View Config」（唯讀）

  # ══════════════════════════════════════════════════════════════
  # 整合 — 佈景主題與 RWD
  # ══════════════════════════════════════════════════════════════

  @integration @ui @p2
  Scenario Outline: 不同佈景模式下編輯器主題正確切換
    Given 管理員已登入系統
    And 系統目前為 <佈景模式>
    When 管理員開啟設定檔編輯器
    Then Monaco Editor 使用對應的 <編輯器主題> 主題
    And 編輯器字型為等寬字型（monospace）

    Examples:
      | 佈景模式   | 編輯器主題 |
      | 淺色模式   | light      |
      | 深色模式   | dark       |

  @integration @ui @p2
  Scenario: 手機 RWD 下編輯器仍可使用
    Given 管理員使用手機裝置（螢幕寬度小於 768px）開啟編輯器
    When 管理員編輯設定檔內容
    Then 編輯器可正常輸入（支援橫向捲動或字型調整）
    And Validate / Save / Cancel 按鈕不超出螢幕範圍

  @integration @p2
  Scenario: 儲存後回到 Dashboard 服務列表狀態正確更新
    Given 管理員成功儲存 nginx 設定檔並返回 Dashboard
    When 服務列表重新載入
    Then 服務列表顯示 nginx 最新狀態
    And 服務的「Edit Config」按鈕仍可點擊

  # ══════════════════════════════════════════════════════════════
  # Scenario Outline — Validate 錯誤解析
  # ══════════════════════════════════════════════════════════════

  @validate @api @happy-path @p0
  Scenario Outline: 不同語法錯誤回傳對應行號與訊息
    Given 管理員編輯後的設定檔內容包含錯誤「<error_message>」位於第 <line> 行
    When 前端發送 POST 請求至 /api/v1/services/nginx/config/validate
    And 請求 body 為 {"config": "<含錯誤內容>"}
    Then 後端回傳 HTTP 200
    And 回應 JSON 的 valid 為 false
    And errors 陣列包含 {"line": <line>, "message": "<error_message>"}

    Examples:
      | line | error_message                                            |
      | 1    | Unknown key 'ExecStartt'                                |
      | 3    | Section [Service] not found                             |
      | 5    | Missing '=' in key/value assignment                     |
      | 8    | ExecStart= path does not exist: /usr/bin/not-exist      |

  # ══════════════════════════════════════════════════════════════
  # Scenario Outline — 三個 API 的服務名稱驗證
  # ══════════════════════════════════════════════════════════════

  @api @error-handling @p0 @validation
  Scenario Outline: 無效服務名稱在三種 API 上皆回傳 400
    Given 服務名稱「<service_name>」不符合命名規則
    When 客戶端發送 <http_method> 請求至 /api/v1/services/<service_name>/config<path_suffix>
    Then 後端以 ValidateServiceName 驗證並拒絕
    And 後端回傳 HTTP 400
    And 錯誤訊息為「invalid service name」

    Examples:
      | service_name     | http_method | path_suffix |
      | invalid name!    | GET         |             |
      | invalid name!    | PUT         |             |
      | invalid name!    | POST        | /validate   |
      | ../traversal     | GET         |             |
      | ../traversal     | PUT         |             |
