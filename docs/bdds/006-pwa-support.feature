# language: zh-TW

@pwa @progressive-enhancement @p0
Feature: PWA 支援
  作為一個使用行動裝置或桌面瀏覽器的管理員
  我希望將 LMS Web 面板安裝為 Progressive Web App
  以便像原生 App 一樣全螢幕快速存取服務面板，並在離線時仍可瀏覽快取頁面

  Background:
    Given 管理員使用支援 PWA 的現代瀏覽器
    And 網站已部署 HTTPS

  # ============================================================
  # Happy Path - 正常流程
  # ============================================================

  @smoke @happy-path @p0
  Scenario: 首次造訪時自動註冊 Service Worker 並預快取資源
    Given 管理員首次造訪 LMS 網站
    When 瀏覽器完成頁面載入
    Then Service Worker 在背景註冊成功
    And Service Worker 狀態從 installing 轉為 activated
    And Service Worker 預快取關鍵資源（index.html、JS/CSS bundles、favicon）
    And 管理員此時無任何感知，不影響正常使用

  @smoke @happy-path @p0
  Scenario Outline: 瀏覽器顯示 PWA 安裝提示
    Given Service Worker 已註冊且啟用
    And 管理員已多次造訪 LMS 網站或停留足夠時間
    When 瀏覽器評估 PWA 安裝條件符合
    Then 瀏覽器顯示安裝提示，提示方式為 "<promptBehavior>"

    Examples:
      | browser         | promptBehavior                            |
      | Chrome 桌面     | 網址列右側顯示 ⊕ 安裝圖示                  |
      | Chrome Android  | 底部彈出安裝提示橫幅，附「安裝」和「取消」按鈕 |
      | Edge 桌面       | 網址列右側顯示安裝圖示                      |
      | Firefox 桌面    | 網址列顯示安裝圖示                          |

  @smoke @happy-path @p0
  Scenario: 管理員接受安裝提示並完成 PWA 安裝
    Given 瀏覽器已顯示 PWA 安裝提示
    And 安裝提示包含 App 名稱「Linux Service Manager」與圖示
    When 管理員點擊安裝提示中的「安裝」按鈕
    Then 瀏覽器調用作業系統的安裝對話框
    And 對話框顯示 App 名稱、圖示、來源 URL
    When 管理員在系統對話框中點擊「新增」或「安裝」
    Then 桌面出現 LMS 捷徑（或手機主畫面出現圖示）
    And App 安裝狀態從未安裝變更為已安裝

  @happy-path @p1
  Scenario: 管理員忽略安裝提示後繼續使用瀏覽器版
    Given 瀏覽器已顯示 PWA 安裝提示
    When 管理員點擊安裝提示中的「取消」按鈕（或關閉提示）
    Then 安裝提示關閉
    And 管理員繼續使用瀏覽器版 LMS
    And 後續造訪時瀏覽器可能再次顯示安裝提示

  @smoke @happy-path @p0
  Scenario: 從主畫面啟動 PWA 以全螢幕獨立視窗執行
    Given LMS PWA 已安裝至裝置
    When 管理員從主畫面或桌面捷徑點擊 LMS 圖示啟動
    Then 顯示 splash screen（自訂背景色 + App 圖示）
    And 頁面從快取優先載入，同時背景檢查更新
    And PWA 以全螢幕 standalone 模式顯示（無瀏覽器工具列、網址列）
    And 管理員看到登入畫面或 Dashboard（若 session 仍有效）

  @happy-path @p0
  Scenario Outline: PWA 獨立視窗內功能操作正常
    Given 管理員已從主畫面啟動 LMS PWA
    And 管理員已登入系統
    When 管理員執行 "<功能操作>"
    Then "<功能操作>" 在 PWA standalone 模式下正常運作

    Examples:
      | 功能操作             |
      | 登入系統             |
      | 檢視 Dashboard       |
      | 啟動服務             |
      | 停止服務             |
      | 重啟服務             |
      | 切換開機自動啟動     |
      | 檢視 Journalctl 日誌 |
      | 切換深色模式         |
      | 切換語言             |

  @happy-path @p1
  Scenario: Safari iOS 手動加入主畫面
    Given 管理員使用 Safari iOS 瀏覽器造訪 LMS 網站
    And Service Worker 已註冊且啟用
    When 管理員點擊 Safari 分享按鈕
    And 管理員選擇「加入主畫面」
    Then 系統顯示「加入主畫面」對話框，包含 App 名稱與圖示
    When 管理員點擊「新增」
    Then LMS 圖示出現在 iOS 主畫面
    And 從主畫面啟動後以全螢幕模式顯示

  # ============================================================
  # Error Handling - 錯誤處理
  # ============================================================

  @error-handling @p0
  Scenario: 瀏覽器不支援 PWA 時不觸發任何 PWA 功能
    Given 管理員使用不支援 PWA 的舊版瀏覽器
    And 網站已部署 HTTPS
    When 管理員造訪 LMS 網站
    Then 網站正常載入且所有功能可正常使用
    And 瀏覽器不顯示任何 PWA 安裝提示
    And 不註冊 Service Worker
    And 管理員使用體驗等同一般網站

  @error-handling @p0
  Scenario: 未使用 HTTPS 時 Service Worker 無法註冊
    Given LMS 網站僅透過 HTTP 部署（無 HTTPS）
    When 管理員造訪 LMS 網站
    Then 網站正常載入且所有功能可正常使用
    And Service Worker 無法註冊
    And 瀏覽器不觸發任何 PWA 安裝提示
    And 不影響任何既有功能

  @error-handling @p0
  Scenario: Service Worker 更新衝突時顯示更新提示
    Given LMS PWA 已安裝且舊版 Service Worker 正在服務中
    And 伺服器已部署新版本
    And 新版 Service Worker 已在背景 waiting
    When 管理員使用 PWA 期間新版 SW 等待啟用
    Then 頁面顯示更新提示橫幅：「有新版本可用，重整以更新」
    And 舊版 SW 仍繼續服務當前頁面
    And 管理員重整頁面後新版 SW 接管

  @error-handling @p1
  Scenario: App 安裝後伺服器停止時顯示連線錯誤
    Given LMS PWA 已安裝至裝置
    And LMS 伺服器已停止運作
    When 管理員從主畫面啟動 LMS PWA
    Then Service Worker 攔截請求，發現無法連線至伺服器
    And 若無快取則顯示離線頁面「需要網路連線」
    And 若有快取則顯示快取頁面框架與離線提示橫幅

  @error-handling @p1
  Scenario: Service Worker 註冊失敗時網站仍正常運作
    Given 管理員使用支援 PWA 的瀏覽器
    And Service Worker 註冊因不明原因失敗
    When 管理員造訪 LMS 網站
    Then 網站正常載入且所有功能可正常使用
    And 不顯示任何錯誤訊息給管理員
    And PWA 安裝功能不啟用

  # ============================================================
  # Edge Cases - 邊界情況
  # ============================================================

  @edge-case @p0
  Scenario: 離線存取時顯示快取頁面框架與離線提示
    Given 管理員已多次造訪 LMS 網站（Service Worker 已有快取）
    And 裝置目前無網路連線
    When 管理員從主畫面啟動 LMS PWA
    Then Service Worker 回傳快取的 index.html 與 JS/CSS
    And 頁面頂部顯示黃色提示橫幅：「⚠️ 離線模式 — 部分功能無法使用」
    And 管理員可瀏覽快取的頁面框架
    And API 請求失敗時不顯示錯誤 toast
    And 管理員無法登入或執行任何需要後端 API 的操作

  @edge-case @p0
  Scenario: 離線且無快取時顯示離線頁面
    Given 管理員首次造訪 LMS 網站後即離線
    And Service Worker 尚未快取任何資源
    And 裝置目前無網路連線
    When 管理員從主畫面啟動 LMS PWA
    Then 顯示離線頁面，提示「需要網路連線」
    And 不顯示白畫面

  @edge-case @p2
  Scenario: 快取儲存空間滿時正常使用不受影響
    Given Service Worker 快取儲存空間已滿
    When Service Worker 嘗試寫入新快取
    Then 快取寫入失敗
    And 瀏覽器自動清理舊快取
    And 管理員正常使用不受任何影響
    And 不顯示任何錯誤訊息

  @edge-case @p1
  Scenario: PWA 啟動時顯示 Splash screen
    Given LMS PWA 已安裝至裝置
    And manifest.json 已設定 background_color 與 icons
    When 管理員從主畫面點擊 LMS 圖示啟動
    Then 在頁面完全載入前顯示 splash screen
    And splash screen 顯示自訂背景色與 App 圖示
    And splash screen 持續時間約 0.5 秒

  @edge-case @p2
  Scenario: PWA 安裝後 localStorage / sessionStorage 獨立
    Given LMS PWA 已安裝至裝置
    And 管理員曾在瀏覽器版 LMS 中登入
    When 管理員從主畫面啟動 LMS PWA
    Then PWA 的儲存空間與瀏覽器版共用（同源）
    And 管理員在瀏覽器版的登入 session 在 PWA 中同樣有效

  # ============================================================
  # Business Rules - 商業規則驗證
  # ============================================================

  @business-rules @p0
  Scenario: PWA 為漸進增強不影響既有功能
    Given LMS 網站正常部署
    When 管理員在不支援 PWA 的環境中造訪網站
    Then 所有 Vue 3 SPA 功能正常運作
    And 所有服務管理功能正常運作
    And 管理員不受任何 PWA 相關限制影響
    And PWA 功能僅在符合條件時自動增強使用體驗

  @business-rules @p0
  Scenario: HTTPS 為 PWA 啟用的必要條件（localhost 除外）
    Given LMS 網站部署環境為 "<deploymentEnv>"
    When 管理員造訪 LMS 網站
    Then Service Worker 註冊狀態為 "<swStatus>"
    And PWA 安裝功能狀態為 "<pwaStatus>"

    Examples:
      | deploymentEnv    | swStatus       | pwaStatus     |
      | HTTPS 正式環境   | 註冊成功       | 可安裝        |
      | HTTP 正式環境    | 無法註冊       | 不啟用        |
      | localhost 開發   | 註冊成功       | 可安裝        |
      | HTTPS 反向代理   | 註冊成功       | 可安裝        |

  @business-rules @p1
  Scenario: Service Worker 使用 stale-while-revalidate 快取策略
    Given LMS PWA 已安裝且 Service Worker 已啟用
    And Service Worker 已有頁面資源快取
    When 管理員啟動 LMS PWA
    Then Service Worker 優先回傳快取內容以加快載入速度
    And Service Worker 在背景檢查伺服器是否有新版本
    And 若有新版本則在背景更新快取
    And 新版本於管理員下次啟動 PWA 時生效

  @business-rules @p1
  Scenario: App 圖示須包含 192×192 與 512×512 兩種尺寸
    Given manifest.json 已設定 icons 陣列
    When 瀏覽器解析 manifest.json
    Then icons 陣列中包含 192×192 尺寸的 PNG 圖示
    And icons 陣列中包含 512×512 尺寸的 PNG 圖示
    And 圖示格式為 PNG
    And 圖示用途標記為 "any"

  @business-rules @p1
  Scenario: iOS Safari PWA 限制
    Given 管理員使用 Safari iOS 瀏覽器
    And LMS PWA 已手動加入主畫面
    When 管理員使用 LMS PWA
    Then 無自動安裝提示（須手動操作分享 → 加入主畫面）
    And 無背景同步功能
    And 儲存空間上限較其他平台低
    And 需設定 apple-touch-icon meta 標籤以顯示主畫面圖示

  @business-rules @p2
  Scenario: manifest.json 包含必要欄位
    Given 專案中存在 manifest.json 檔案
    When 檢查 manifest.json 內容
    Then 包含 name 欄位
    And 包含 short_name 欄位
    And 包含 start_url 欄位
    And 包含 display 欄位（值為 "standalone"）
    And 包含 icons 欄位
    And 包含 theme_color 欄位
    And 包含 background_color 欄位
