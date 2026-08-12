package systemd

// config_validate.go — systemd-analyze 暫存檔驗證（docs/development/012-service-config-editor.md §1.4）
// 流程：寫入 /tmp/lsm-validate-{uuid}.service（0600）→ systemd-analyze verify（逾時）
//       → 解析輸出為 {line, message} → defer 刪除暫存。
// systemd-analyze 不存在時回 available=false（200，非 500 crash）。

import (
	"context"
	"fmt"
	"os"
	"regexp"
	"strings"
	"time"
)

const (
	// tmpFileMode 是驗證暫存檔的權限（0600，避免敏感內容被其他使用者讀取）。
	tmpFileMode = 0o600
)

// ValidateTimeout 是 systemd-analyze verify 的逾時（var 以便測試覆寫）。
var ValidateTimeout = 10 * time.Second

// validateTmpDir 是驗證暫存檔目錄（測試可覆寫）。
var validateTmpDir = "/tmp"

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
// （systemd 257 實測：漏 = / Unknown key / Failed to parse 等「打錯字」級別問題
//  會印出 path:LINE 診斷但仍 exit 0；exit 0 時必須靠行號區分診斷與系統噪音。）
var analyzeVerifyErrRe = regexp.MustCompile(`^[^:]+:(\d+):\s*(.+)$`)

// ValidateConfig 驗證 unit file 內容語法（systemd-analyze verify 暫存檔方案）。
func (s *ConfigStore) ValidateConfig(content string) (*ValidateResult, error) {
	// 1. systemd-analyze 不存在 → available=false（非 error，200 回應）
	if _, err := lookPath("systemd-analyze"); err != nil {
		return &ValidateResult{
			Valid:     false,
			Available: false,
			Errors:    []ValidateError{},
			Message:   "systemd-analyze 指令不存在，無法進行語法驗證",
		}, nil
	}

	// 2. 建立暫存檔（UUID 檔名防碰撞、0600 權限）；defer 保證成功/失敗/逾時皆刪除
	tmp, err := os.CreateTemp(validateTmpDir, "lsm-validate-*.service")
	if err != nil {
		return nil, fmt.Errorf("無法建立暫存檔進行驗證。請檢查 /tmp 目錄空間與權限。: %w", err)
	}
	tmpPath := tmp.Name()
	defer os.Remove(tmpPath)

	if err := tmp.Chmod(tmpFileMode); err != nil {
		tmp.Close()
		return nil, fmt.Errorf("無法設定暫存檔權限: %w", err)
	}
	if _, err := tmp.WriteString(content); err != nil {
		tmp.Close()
		return nil, fmt.Errorf("無法寫入暫存檔: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return nil, fmt.Errorf("無法關閉暫存檔: %w", err)
	}

	// 3. 執行 systemd-analyze verify（10s 逾時）
	ctx, cancel := context.WithTimeout(context.Background(), ValidateTimeout)
	defer cancel()

	cmd := execCommandContext(ctx, "systemd-analyze", "verify", tmpPath)
	out, err := cmd.CombinedOutput()
	output := string(out)

	// 逾時：視為失敗（process 已被 CommandContext kill）
	if ctx.Err() == context.DeadlineExceeded {
		return nil, fmt.Errorf("語法驗證逾時（%s）", ValidateTimeout)
	}

	// 4. exit code 0 → 仍需解析輸出：systemd 對「打錯字」級別問題（Missing '='、
	//    Unknown key、Failed to parse 等）只印 path:LINE 診斷但仍 exit 0，
	//    該行會被 systemd 靜默忽略——必須視為錯誤。
	//    無行號的行是系統噪音（如 Configuration file ... is marked executable），濾除。
	if err == nil {
		errList := parseAnalyzeErrors(output)
		lineErrs := make([]ValidateError, 0, len(errList))
		for _, e := range errList {
			if e.Line > 0 {
				lineErrs = append(lineErrs, e)
			}
		}
		if len(lineErrs) > 0 {
			return &ValidateResult{
				Valid:     false,
				Available: true,
				Errors:    lineErrs,
			}, nil
		}
		return &ValidateResult{
			Valid:     true,
			Available: true,
			Errors:    []ValidateError{},
		}, nil
	}

	// 5. 非 0 → 逐行解析 {line, message}；不可解析行 → 原始輸出為 message
	errorsList := parseAnalyzeErrors(output)
	return &ValidateResult{
		Valid:     false,
		Available: true,
		Errors:    errorsList,
	}, nil
}

// parseAnalyzeErrors 從 systemd-analyze 輸出萃取錯誤清單。
func parseAnalyzeErrors(output string) []ValidateError {
	var errs []ValidateError
	for _, line := range strings.Split(strings.TrimRight(output, "\n"), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		m := analyzeVerifyErrRe.FindStringSubmatch(line)
		if m == nil {
			errs = append(errs, ValidateError{Line: 0, Message: line})
			continue
		}
		var ln int
		fmt.Sscanf(m[1], "%d", &ln)
		errs = append(errs, ValidateError{Line: ln, Message: m[2]})
	}
	return errs
}
