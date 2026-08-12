package systemd

// ConfigStore — service unit file 的安全讀寫（docs/development/012-service-config-editor.md §1.3）
// 職責：FragmentPath 查詢、讀取與 checksum、路徑邊界驗證（Clean+Rel / .service / symlink）、
//       備份保留 5 份、atomic write、寫入失敗還原、checksum 並發衝突偵測（409）、daemon-reload。

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
)

const (
	// MaxConfigSize 是 unit file 讀取/寫入的大小上限（500KB）。
	MaxConfigSize = 500 * 1024
	// BackupKeepCount 是同目錄備份檔保留份數（含本次最新）。
	BackupKeepCount = 5
	// backupTimeLayout 是備份檔時間戳格式（UTC compact RFC3339，固定寬度 → 字典序 = 時間序）。
	backupTimeLayout = "20060102T150405Z"
)

// DaemonReloadTimeout 是 systemctl daemon-reload 的逾時（var 以便測試覆寫）。
var DaemonReloadTimeout = 10 * time.Second

// SystemdSystemDir 是可編輯 unit file 的唯一根目錄。
// 以 var 宣告以便測試覆寫；生產環境維持 /etc/systemd/system。
var SystemdSystemDir = "/etc/systemd/system"

// 可注入函式（測試替換用，沿用 execCommandContext / lookPath pattern）。
var (
	// fragmentPathOf 以 systemctl show 查詢單一服務的 FragmentPath（信任來源為 systemd）。
	fragmentPathOf = func(ctx context.Context, name string) (string, error) {
		cmd := execCommandContext(ctx, "systemctl", "show", "-p", "FragmentPath", "--value", name)
		out, err := cmd.Output()
		if err != nil {
			return "", fmt.Errorf("systemctl show %s: %w", name, err)
		}
		return strings.TrimSpace(string(out)), nil
	}
	// backupTimeNow 提供備份檔時間戳（測試可覆寫）。
	backupTimeNow = time.Now
)

// 錯誤哨兵值（handler 對映為 HTTP 狀態碼）。
var (
	ErrConfigPathEmpty  = errors.New("設定檔路徑不存在")
	ErrConfigNotFound   = errors.New("設定檔不存在")
	ErrConfigTooLarge   = errors.New("設定檔超過 500KB 大小限制")
	ErrPathNotAllowed   = errors.New("不允許編輯此服務設定檔")
	ErrExtNotService    = errors.New("僅支援 .service 設定檔")
	ErrWriteFailed      = errors.New("寫入失敗")
	ErrConflict         = errors.New("設定檔已被其他使用者修改。請重新載入後再編輯。")
	ErrConflictMissingBase = errors.New("base_checksum is required")
	ErrInvalidChecksum  = errors.New("invalid base_checksum")
)

// ErrConflictCurrent 是 409 衝突錯誤，附帶現行 checksum 供前端重新載入更新基準。
type ErrConflictCurrent struct {
	Current string
}

func (e ErrConflictCurrent) Error() string { return ErrConflict.Error() }

// ServiceConfig 是 GET /config 的回應資料（含 checksum 供 PUT baseChecksum）。
type ServiceConfig struct {
	Name         string
	FragmentPath string
	Content      string
	Size         int64
	Checksum     string // SHA-256 hex（64 字元小寫）
}

// ConfigAPI 是 handler 需要的設定檔操作介面（方便 handler 測試注入 fake）。
type ConfigAPI interface {
	FragmentPathOf(name string) (string, error)
	ReadConfig(name, path string) (*ServiceConfig, error)
	ValidateWritablePath(path string) error
	CheckConflict(path, baseChecksum string) error
	Backup(path string) (string, error)
	PruneBackups(path string, keep int) error
	AtomicWrite(path, content string) error
	Restore(backupPath, path string) error
	DaemonReload(ctx context.Context) error
	ValidateConfig(content string) (*ValidateResult, error)
}

// ConfigStore 提供 service unit file 的讀寫安全操作（無狀態函式集合）。
type ConfigStore struct{}

// NewConfigStore 建立 ConfigStore。
func NewConfigStore() *ConfigStore { return &ConfigStore{} }

var _ ConfigAPI = (*ConfigStore)(nil)

// FragmentPathOf 以 systemctl show 查詢單一服務的 FragmentPath（信任來源為 systemd，非用戶端）。
func (s *ConfigStore) FragmentPathOf(name string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	return fragmentPathOf(ctx, name)
}

// ReadConfig 讀取 fragmentPath 指向的檔案並回傳內容/大小/checksum。
// path 為空 → ErrConfigPathEmpty；檔案不存在 → ErrConfigNotFound；
// size > MaxConfigSize → ErrConfigTooLarge；讀取失敗 → 包裝底層錯誤（含權限原因）。
func (s *ConfigStore) ReadConfig(name, path string) (*ServiceConfig, error) {
	if path == "" {
		return nil, ErrConfigPathEmpty
	}
	content, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, ErrConfigNotFound
		}
		return nil, fmt.Errorf("%s: %w", path, err)
	}
	if len(content) > MaxConfigSize {
		return nil, ErrConfigTooLarge
	}
	return &ServiceConfig{
		Name:         name,
		FragmentPath: path,
		Content:      string(content),
		Size:         int64(len(content)),
		Checksum:     s.ComputeChecksum(string(content)),
	}, nil
}

// ComputeChecksum 計算內容的 SHA-256 hex。
func (s *ConfigStore) ComputeChecksum(content string) string {
	sum := sha256.Sum256([]byte(content))
	return hex.EncodeToString(sum[:])
}

// currentChecksumOf 計算磁碟上現行檔的 checksum；檔案不存在回傳 ""（允許重建）。
func (s *ConfigStore) currentChecksumOf(path string) (string, error) {
	content, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return "", nil
		}
		return "", err
	}
	return s.ComputeChecksum(string(content)), nil
}

// ValidatePath 驗證 path 確實在 /etc/systemd/system/ 下。
// 以 filepath.Clean + filepath.Rel 判斷（非 strings.HasPrefix，擋 /etc/systemd/system-evil 旁路）。
func (s *ConfigStore) ValidatePath(path string) error {
	clean := filepath.Clean(path)
	rel, err := filepath.Rel(SystemdSystemDir, clean)
	if err != nil {
		return ErrPathNotAllowed
	}
	if rel == "." {
		// path 等於根目錄本身（/etc/systemd/system）— 非檔案，拒絕
		return ErrPathNotAllowed
	}
	if rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return ErrPathNotAllowed
	}
	return nil
}

// ValidateExt 驗證副檔名為 .service（僅 .service 可寫入，.timer/.socket 不可）。
func (s *ConfigStore) ValidateExt(path string) error {
	if filepath.Ext(path) != ".service" {
		return ErrExtNotService
	}
	return nil
}

// ValidateSymlink 對存在的目標檔執行 EvalSymlinks；不存在時對 parent 目錄執行。
// 解析結果必須仍在 /etc/systemd/system/ 下（防 foo.service -> /etc/passwd 覆寫）。
func (s *ConfigStore) ValidateSymlink(path string) error {
	// 目標存在 → 解析完整路徑必須仍在邊界內
	if resolved, err := filepath.EvalSymlinks(path); err == nil {
		if !withinSystemDir(resolved) {
			return ErrPathNotAllowed
		}
		return nil
	}
	// 目標不存在 → 解析 parent 目錄（必須在邊界內或等於邊界，防 parent symlink 逃逸）
	parent := filepath.Dir(path)
	if resolved, err := filepath.EvalSymlinks(parent); err == nil {
		if !withinSystemDir(resolved) {
			return ErrPathNotAllowed
		}
		return s.ValidatePath(path)
	}
	// parent 也無法解析（目錄不存在）→ 以 clean 檢查
	return s.ValidatePath(path)
}

// withinSystemDir 判斷 path 是否在 SystemdSystemDir 內或等於其本身（供 symlink 驗證用）。
func withinSystemDir(path string) bool {
	clean := filepath.Clean(path)
	rel, err := filepath.Rel(SystemdSystemDir, clean)
	if err != nil {
		return false
	}
	if rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return false
	}
	return true
}

// ValidateWritablePath 組合路徑邊界 / .service 副檔名 / symlink 檢查 — PUT 寫入前必調。
func (s *ConfigStore) ValidateWritablePath(path string) error {
	if err := s.ValidatePath(path); err != nil {
		return err
	}
	if err := s.ValidateExt(path); err != nil {
		return err
	}
	if err := s.ValidateSymlink(path); err != nil {
		return err
	}
	return nil
}

// Backup 將現行檔 copy 為 {path}.bak.{20060102T150405Z}（UTC compact RFC3339）。
// copy 而非 rename — 現行檔必須保留原位供 atomic rename 覆蓋。
// 現行檔不存在時回傳 ("", nil)（允許建立新檔，無需備份）。
func (s *ConfigStore) Backup(path string) (string, error) {
	content, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return "", nil
		}
		return "", err
	}
	ts := backupTimeNow().UTC().Format(backupTimeLayout)
	backupPath := path + ".bak." + ts
	if err := os.WriteFile(backupPath, content, 0644); err != nil {
		return "", err
	}
	return backupPath, nil
}

// PruneBackups 以 {path}.bak. prefix glob 同目錄，字串降冪排序，保留前 keep 份刪除其餘。
// 固定寬度時間戳保證字典序 = 時間序。
func (s *ConfigStore) PruneBackups(path string, keep int) error {
	pattern := path + ".bak.*"
	files, err := filepath.Glob(pattern)
	if err != nil {
		return err
	}
	if len(files) <= keep {
		return nil
	}
	sort.Sort(sort.Reverse(sort.StringSlice(files)))
	for _, f := range files[keep:] {
		if err := os.Remove(f); err != nil {
			return err
		}
	}
	return nil
}

// AtomicWrite 以 temp + chmod(保留原檔 mode，預設 0644) + fsync + rename 覆寫目標檔。
// rename 同目錄內為原子操作，失敗時原檔完好。
func (s *ConfigStore) AtomicWrite(path, content string) error {
	dir := filepath.Dir(path)
	base := filepath.Base(path)

	// 保留原檔 mode（不存在則 0644）
	mode := os.FileMode(0o644)
	if info, err := os.Stat(path); err == nil {
		mode = info.Mode().Perm()
	}

	// 同目錄暫存檔（含 rand 避免並發碰撞）
	tmp, err := os.CreateTemp(dir, "."+base+".tmp.*")
	if err != nil {
		return fmt.Errorf("create temp: %w", err)
	}
	tmpName := tmp.Name()
	cleanup := func() {
		tmp.Close()
		os.Remove(tmpName)
	}

	if err := os.Chmod(tmpName, mode); err != nil {
		cleanup()
		return fmt.Errorf("chmod temp: %w", err)
	}
	if _, err := tmp.WriteString(content); err != nil {
		cleanup()
		return fmt.Errorf("write temp: %w", err)
	}
	if err := tmp.Sync(); err != nil {
		cleanup()
		return fmt.Errorf("fsync temp: %w", err)
	}
	if err := tmp.Close(); err != nil {
		os.Remove(tmpName)
		return fmt.Errorf("close temp: %w", err)
	}
	if err := os.Rename(tmpName, path); err != nil {
		os.Remove(tmpName)
		return fmt.Errorf("rename: %w", err)
	}
	return nil
}

// Restore 以備份檔還原原路徑（僅「寫入失敗」時呼叫）。
func (s *ConfigStore) Restore(backupPath, path string) error {
	content, err := os.ReadFile(backupPath)
	if err != nil {
		return err
	}
	return os.WriteFile(path, content, 0o644)
}

// CheckConflict 比對現行檔 checksum 與 baseChecksum：
//   - 檔案存在且 baseChecksum 為空 → ErrConflictMissingBase（handler 回 400，防舊前端繞過）
//   - 檔案存在且 baseChecksum 格式錯誤（非 64 hex）→ ErrInvalidChecksum
//   - checksum 不一致 → ErrConflictCurrent{Current}（handler 回 409）
//   - 檔案不存在 → 視為「建立新檔」，跳過比對
func (s *ConfigStore) CheckConflict(path, baseChecksum string) error {
	cur, err := s.currentChecksumOf(path)
	if err != nil {
		return err
	}
	if cur == "" {
		return nil // 檔案不存在 → 允許重建
	}
	if baseChecksum == "" {
		return ErrConflictMissingBase
	}
	if !isSHA256Hex(baseChecksum) {
		return ErrInvalidChecksum
	}
	if cur != baseChecksum {
		return ErrConflictCurrent{Current: cur}
	}
	return nil
}

var sha256HexRe = regexp.MustCompile(`^[0-9a-f]{64}$`)

func isSHA256Hex(s string) bool { return sha256HexRe.MatchString(s) }

// DaemonReload 執行 systemctl daemon-reload，逾時視為失敗。
func (s *ConfigStore) DaemonReload(ctx context.Context) error {
	ctx, cancel := context.WithTimeout(ctx, DaemonReloadTimeout)
	defer cancel()

	cmd := execCommandContext(ctx, "systemctl", "daemon-reload")
	out, err := cmd.CombinedOutput()
	if err != nil {
		if ctx.Err() == context.DeadlineExceeded {
			return fmt.Errorf("daemon-reload 逾時")
		}
		return fmt.Errorf("systemctl daemon-reload: %s: %w", strings.TrimSpace(string(out)), err)
	}
	return nil
}


