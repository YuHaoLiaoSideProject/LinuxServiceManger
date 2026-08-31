# Code Review Criteria — LinuxServiceManger

> 每筆問題必須附：**檔案路徑 + 行號 + 具體描述 + 觸發條件**
> 不因「聽起來嚴重」就列為重大——無證據 = 不列入

---

## 🔴 致命 (Critical) — 必須立即修復

| # | 檢查項目 | 檢查方法 |
|---|----------|----------|
| C1 | **Command Injection**：使用者輸入直接拼入 `exec.Command()` | grep `exec.Command` → 檢查參數是否來自使用者輸入 |
| C2 | **Path Traversal**：檔案操作路徑未做 `filepath.Clean` 或前綴檢查 | grep `os.Open\|os.Create\|ioutil.ReadFile` → 檢查路徑來源 |
| C3 | **硬編碼密碼/Token**：Source code 中出現明文凭证 | grep `password\|secret\|token\|api_key` in *.go, *.ts |
| C4 | **SQL Injection / NoSQL Injection**：（如有資料庫） | 檢查 SQL 查詢是否使用字串拼接 |
| C5 | **已知漏洞 API**：使用 `gets()`、`strcpy()`、`sprintf()` 等不安全 C 函式 | grep 在 .c/.h 檔案（如有） |
| C6 | **不當權限**：setuid bit、不必要的 sudo、`/etc/shadow` 寫入 | ls -la 檔案、grep `os.Chmod\|0777\|0666` |
| C7 | **明文傳輸敏感資料**：未加密連接傳輸密碼/token | 檢查 HTTP vs HTTPS、WebSocket 是否 ws:// (非 wss://) |
| C8 | **TLS 驗證繞過**：`InsecureSkipVerify: true` | grep `InsecureSkipVerify` |

## 🟠 嚴重 (Major) — 影響正常功能

| # | 檢查項目 | 檢查方法 |
|---|----------|----------|
| M1 | **未檢查系統呼叫錯誤**：`open()`, `fork()`, `exec()`, `listen()`, `bind()` 回傳值未檢查 | grep 系統呼叫 → 檢查 next 行是否有 `if err != nil` |
| M2 | **記憶體洩漏**：`malloc()`/`new()` 無對應 `free()`/`delete()` | grep `malloc\|new ` → 檢查配對 (Go 自動管理，較少此問題) |
| M3 | **競態條件**：多 goroutine 存取共用變數未用 `sync.Mutex` / `atomic` | grep `go func` → 檢查共用變數的鎖保護 |
| M4 | **資源未關閉**：`os.Open()`, `net.Listen()`, `sql.Open()` 無 `defer .Close()` | grep `os.Open\|net.Listen\|sql.Open` → 檢查 defer |
| M5 | **無限迴圈/遞迴**：缺少終止條件或 timeout | 迴圈/遞迴函式 → 檢查退出條件 |
| M6 | **WebSocket 未處理關閉**：連線斷開後未清理 | 檢查 WS handler 的 `close`/`error` 處理 |
| M7 | **Session fixation / 固定 session**：登入後未重新產生 session ID | 檢查登入流程是否呼叫 `session.Save()` 換新 ID |
| M8 | **API Token 洩漏**：Token 出現在 URL query string 或 logs 中 | grep token in logs/URL 構建 |

## 🟡 中等 (Moderate) — 潛在問題

| # | 檢查項目 | 檢查方法 |
|---|----------|----------|
| P1 | **邊界條件**：陣列/切片越界、nil 指標解引用 | 檢查 index 操作前是否有長度檢查 |
| P2 | **整數溢位**：int32/int64 轉換未檢查 | grep 類型轉換 |
| P3 | **效能問題**：不必要的大型切片拷貝、O(n²) 迴圈 | 檢查迴圈內是否有 append 或 map 操作 |
| P4 | **DoS 向量**：未設 body size limit、未設 timeout | 檢查 `http.MaxBytesReader`、`http.Server.ReadHeaderTimeout` |
| P5 | **Rate Limit 不足**：關鍵端點（login）未限速 | 檢查 rate limiter 是否套用到 /api/v1/login |
| P6 | **日誌洩漏**：敏感資料（密碼、token）寫入 logs | grep `log\.\|fmt\.Print` → 檢查是否含敏感值 |
| P7 | **錯誤訊息洩漏**：對外暴露內部路徑、stack trace | 檢查錯誤回應是否包含 `runtime.Caller` 或路徑 |

## 🟢 輕微 (Minor) — 建議改善

| # | 檢查項目 | 檢查方法 |
|---|----------|----------|
| L1 | **命名慣例**：不符合 Go / TypeScript 官方慣例 | 檢查函式/變數命名 |
| L2 | **冗餘 code**：重複邏輯、dead code | grep 未使用的 import、變數 |
| L3 | **文件缺失**：公開 API / 函式無 docstring | 檢查公開函式的 comment |
| L4 | **巢狀過深**：>3 層 if/for 嵌套 | 搜尋深層巢狀 |

## ⚪ 無問題 (Not an Issue)

- 設計選擇差異（非 bug）
- 符合專案慣例的寫法
- 效能與可讀性的合理取捨

---

## 審查範圍（依優先級）

1. **T3: 代碼品質 & Bug**：M1-M8, P1-P7, L1-L4
2. **T4: 安全性 & 設計**：C1-C8, M7-M8, P4-P7

---

*文件建立：2025-11*
