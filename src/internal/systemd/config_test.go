package systemd

// SYS-01 ~ SYS-46 單元測試（對應 docs/test-plans/012-service-config-editor測試計畫.md §2）
// 先寫測試（RED），再實作 ConfigStore 使其轉綠。

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"
)

// ============================================================
//  Helpers
// ============================================================

// newTestEnv 將 SystemdSystemDir 指向 temp dir，回傳 store 與 dir。
func newTestEnv(t *testing.T) (*ConfigStore, string) {
	t.Helper()
	dir := t.TempDir()
	orig := SystemdSystemDir
	SystemdSystemDir = dir
	t.Cleanup(func() { SystemdSystemDir = orig })
	return NewConfigStore(), dir
}

func writeFile(t *testing.T, path, content string, mode os.FileMode) {
	t.Helper()
	if err := os.WriteFile(path, []byte(content), mode); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
}

func readFile(t *testing.T, path string) string {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	return string(b)
}

func checksumOf(content string) string {
	sum := sha256.Sum256([]byte(content))
	return hex.EncodeToString(sum[:])
}

// mockAnalyze 讓 systemd-analyze 回傳固定 output 與 exit code；回傳 restore 函式。
func mockAnalyze(t *testing.T, output string, exitCode int) func() {
	t.Helper()
	outFile := filepath.Join(t.TempDir(), "analyze-out.txt")
	if err := os.WriteFile(outFile, []byte(output), 0644); err != nil {
		t.Fatal(err)
	}
	origCmd := execCommandContext
	origPath := lookPath
	lookPath = func(name string) (string, error) {
		if name == "systemd-analyze" {
			return "/usr/bin/systemd-analyze", nil
		}
		return "", os.ErrNotExist
	}
	execCommandContext = func(ctx context.Context, name string, args ...string) *exec.Cmd {
		return exec.CommandContext(ctx, "sh", "-c", fmt.Sprintf("cat %s; exit %d", outFile, exitCode))
	}
	return func() {
		execCommandContext = origCmd
		lookPath = origPath
	}
}

func restoreValidateTimeout(t *testing.T) {
	t.Helper()
	orig := ValidateTimeout
	t.Cleanup(func() { ValidateTimeout = orig })
}

// ============================================================
//  SYS-01~03 讀取與 checksum
// ============================================================

func TestReadConfig_Success(t *testing.T) {
	_, dir := newTestEnv(t)
	path := filepath.Join(dir, "nginx.service")
	content := "[Unit]\nDescription=test\n"
	writeFile(t, path, content, 0644)

	s := NewConfigStore()
	cfg, err := s.ReadConfig("nginx.service", path)
	if err != nil {
		t.Fatalf("ReadConfig: %v", err)
	}
	if cfg.Name != "nginx.service" {
		t.Errorf("Name = %q, want nginx.service", cfg.Name)
	}
	if cfg.FragmentPath != path {
		t.Errorf("FragmentPath = %q, want %q", cfg.FragmentPath, path)
	}
	if cfg.Content != content {
		t.Errorf("Content mismatch")
	}
	if cfg.Size != int64(len(content)) {
		t.Errorf("Size = %d, want %d", cfg.Size, len(content))
	}
	if cfg.Checksum != checksumOf(content) {
		t.Errorf("Checksum = %q, want %q", cfg.Checksum, checksumOf(content))
	}
}

func TestComputeChecksum(t *testing.T) {
	s := NewConfigStore()
	content := "[Unit]\nDescription=test"
	c := s.ComputeChecksum(content)
	expected := checksumOf(content)
	if c != expected {
		t.Errorf("ComputeChecksum = %q, want %q", c, expected)
	}
	if len(c) != 64 {
		t.Errorf("checksum length = %d, want 64", len(c))
	}
	// 相同內容 → 相同；不同內容 → 不同
	if s.ComputeChecksum("a") != s.ComputeChecksum("a") {
		t.Error("same content must produce same checksum")
	}
	if s.ComputeChecksum("a") == s.ComputeChecksum("b") {
		t.Error("different content must produce different checksum")
	}
}

// ============================================================
//  SYS-04~07 讀取錯誤情境
// ============================================================

func TestReadConfig_EmptyPath(t *testing.T) {
	s := NewConfigStore()
	_, err := s.ReadConfig("nginx.service", "")
	if !errors.Is(err, ErrConfigPathEmpty) {
		t.Errorf("want ErrConfigPathEmpty, got %v", err)
	}
}

func TestReadConfig_FileNotFound(t *testing.T) {
	_, dir := newTestEnv(t)
	s := NewConfigStore()
	_, err := s.ReadConfig("nginx.service", filepath.Join(dir, "missing.service"))
	if !errors.Is(err, ErrConfigNotFound) {
		t.Errorf("want ErrConfigNotFound, got %v", err)
	}
}

func TestReadConfig_PermissionDenied(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("running as root, permission checks are bypassed")
	}
	_, dir := newTestEnv(t)
	path := filepath.Join(dir, "nginx.service")
	writeFile(t, path, "x", 0o000)
	defer os.Chmod(path, 0644)

	s := NewConfigStore()
	_, err := s.ReadConfig("nginx.service", path)
	if err == nil {
		t.Fatal("expected permission error")
	}
	if errors.Is(err, ErrConfigNotFound) || errors.Is(err, ErrConfigTooLarge) {
		t.Errorf("unexpected sentinel error: %v", err)
	}
	if !strings.Contains(strings.ToLower(err.Error()), "permission") {
		t.Errorf("expected permission reason in error, got: %v", err)
	}
}

func TestReadConfig_TooLarge(t *testing.T) {
	_, dir := newTestEnv(t)
	path := filepath.Join(dir, "big.service")
	big := make([]byte, 600000) // > MaxConfigSize (500*1024)
	for i := range big {
		big[i] = 'A'
	}
	writeFile(t, path, string(big), 0644)

	s := NewConfigStore()
	_, err := s.ReadConfig("big.service", path)
	if !errors.Is(err, ErrConfigTooLarge) {
		t.Errorf("want ErrConfigTooLarge, got %v", err)
	}
}

// ============================================================
//  SYS-08~17 路徑安全驗證
// ============================================================

func TestValidatePath(t *testing.T) {
	_, dir := newTestEnv(t)
	s := NewConfigStore()

	// 08: 邊界內合法路徑通過（含非正規化 // 與 . 元件，clean 後仍在下）
	for _, p := range []string{
		filepath.Join(dir, "nginx.service"),
		filepath.Join(dir, "sub", "nginx.service"),
		dir + "//nginx.service",
		filepath.Join(dir, ".", "nginx.service"),
	} {
		if err := s.ValidatePath(p); err != nil {
			t.Errorf("ValidatePath(%q) should pass: %v", p, err)
		}
	}

	// 09/10: /usr/lib、/run 拒絕
	for _, p := range []string{
		"/usr/lib/systemd/system/systemd-journald.service",
		"/run/systemd/system/httpd.service",
	} {
		if err := s.ValidatePath(p); err == nil {
			t.Errorf("ValidatePath(%q) should reject", p)
		}
	}

	// 11: prefix 旁路 — /etc/systemd/system-evil/ 與 /etc/systemd/systemx/
	if err := s.ValidatePath(dir + "-evil/foo.service"); err == nil {
		t.Error("prefix bypass (/etc/systemd/system-evil/) must be rejected")
	}
	if err := s.ValidatePath(dir + "x/foo.service"); err == nil {
		t.Error("prefix bypass (/etc/systemd/systemx/) must be rejected")
	}

	// 12: 路徑遍歷 ..
	if err := s.ValidatePath(dir + "/../../etc/passwd"); err == nil {
		t.Error("path traversal must be rejected")
	}

	// 13: 正規化後不誤拒合法路徑（雙斜線已在上方驗證通過）
	if err := s.ValidatePath(filepath.Join(dir, "nginx.service")); err != nil {
		t.Errorf("canonical path should pass: %v", err)
	}
}

func TestValidateExt(t *testing.T) {
	s := NewConfigStore()
	// 16: 非 .service 拒絕
	for _, p := range []string{
		"/etc/systemd/system/backup.timer",
		"/etc/systemd/system/backup.socket",
		"/etc/systemd/system/backup.path",
	} {
		if err := s.ValidateExt(p); err == nil {
			t.Errorf("ValidateExt(%q) should reject", p)
		}
	}
	// 17: .service 通過
	if err := s.ValidateExt("/etc/systemd/system/nginx.service"); err != nil {
		t.Errorf("ValidateExt(.service) should pass: %v", err)
	}
}

func TestValidateSymlink(t *testing.T) {
	_, dir := newTestEnv(t)
	s := NewConfigStore()

	// 14: 目標檔為 symlink → 外部（/etc/hosts 存在於所有 Linux）
	target := filepath.Join(dir, "evil.service")
	if err := os.Symlink("/etc/hosts", target); err != nil {
		t.Fatalf("symlink: %v", err)
	}
	if err := s.ValidateSymlink(target); err == nil {
		t.Error("symlink to outside boundary must be rejected")
	}

	// symlink 指向邊界內 → 通過
	realFile := filepath.Join(dir, "real.service")
	writeFile(t, realFile, "x", 0644)
	link := filepath.Join(dir, "link.service")
	if err := os.Symlink(realFile, link); err != nil {
		t.Fatalf("symlink: %v", err)
	}
	if err := s.ValidateSymlink(link); err != nil {
		t.Errorf("symlink within boundary should pass: %v", err)
	}

	// 15: parent 目錄為 symlink → 外部（目標檔不存在）
	linkDir := filepath.Join(dir, "linkdir")
	if err := os.Symlink("/etc", linkDir); err != nil {
		t.Fatalf("symlink dir: %v", err)
	}
	missing := filepath.Join(linkDir, "foo.service")
	if err := s.ValidateSymlink(missing); err == nil {
		t.Error("parent symlink escaping boundary must be rejected")
	}

	// parent 目錄 symlink 在邊界內（目標檔不存在）→ 通過
	sub := filepath.Join(dir, "sub")
	if err := os.Mkdir(sub, 0755); err != nil {
		t.Fatal(err)
	}
	linkDir2 := filepath.Join(dir, "linkdir2")
	if err := os.Symlink(sub, linkDir2); err != nil {
		t.Fatalf("symlink dir: %v", err)
	}
	missing2 := filepath.Join(linkDir2, "foo.service")
	if err := s.ValidateSymlink(missing2); err != nil {
		t.Errorf("parent symlink within boundary should pass: %v", err)
	}

	// 一般檔案直接通過
	if err := s.ValidateSymlink(realFile); err != nil {
		t.Errorf("plain file should pass: %v", err)
	}
}

func TestValidateWritablePath(t *testing.T) {
	_, dir := newTestEnv(t)
	s := NewConfigStore()

	// 邊界內 .service 檔案（不存在也允許 — parent 檢查）→ 通過
	ok := filepath.Join(dir, "nginx.service")
	if err := s.ValidateWritablePath(ok); err != nil {
		t.Errorf("writable path should pass: %v", err)
	}

	// 非 .service → ErrExtNotService
	if err := s.ValidateWritablePath(filepath.Join(dir, "backup.timer")); !errors.Is(err, ErrExtNotService) {
		t.Errorf("want ErrExtNotService, got %v", err)
	}

	// 邊界外 → ErrPathNotAllowed
	if err := s.ValidateWritablePath("/usr/lib/systemd/system/x.service"); !errors.Is(err, ErrPathNotAllowed) {
		t.Errorf("want ErrPathNotAllowed, got %v", err)
	}

	// symlink 逃脫 → ErrPathNotAllowed
	evil := filepath.Join(dir, "evil.service")
	if err := os.Symlink("/etc/hosts", evil); err != nil {
		t.Fatal(err)
	}
	if err := s.ValidateWritablePath(evil); !errors.Is(err, ErrPathNotAllowed) {
		t.Errorf("want ErrPathNotAllowed for symlink escape, got %v", err)
	}
}

// ============================================================
//  SYS-18~23 備份與保留策略
// ============================================================

func TestBackup(t *testing.T) {
	_, dir := newTestEnv(t)
	path := filepath.Join(dir, "nginx.service")
	writeFile(t, path, "V1", 0644)

	s := NewConfigStore()
	backupPath, err := s.Backup(path)
	if err != nil {
		t.Fatalf("Backup: %v", err)
	}

	// 命名：{path}.bak.{20060102T150405Z}
	if !strings.HasPrefix(backupPath, path+".bak.") {
		t.Errorf("backup name = %q, want prefix %q", backupPath, path+".bak.")
	}
	suffix := strings.TrimPrefix(backupPath, path+".bak.")
	ts, err := time.Parse("20060102T150405Z", suffix)
	if err != nil {
		t.Fatalf("backup timestamp %q not in 20060102T150405Z format: %v", suffix, err)
	}
	if time.Since(ts) > time.Hour || ts.After(time.Now()) {
		t.Errorf("backup timestamp %q not current", suffix)
	}

	// 19: 內容為原檔副本
	if got := readFile(t, backupPath); got != "V1" {
		t.Errorf("backup content = %q, want V1", got)
	}
	// 原檔仍原位
	if got := readFile(t, path); got != "V1" {
		t.Errorf("original file changed: %q", got)
	}
}

func TestBackup_MissingFile(t *testing.T) {
	_, dir := newTestEnv(t)
	path := filepath.Join(dir, "nginx.service") // 不存在
	s := NewConfigStore()
	backupPath, err := s.Backup(path)
	if err != nil {
		t.Fatalf("Backup on missing file should not error: %v", err)
	}
	if backupPath != "" {
		t.Errorf("expected empty backup path for missing file, got %q", backupPath)
	}
}

func TestPruneBackups(t *testing.T) {
	_, dir := newTestEnv(t)
	path := filepath.Join(dir, "nginx.service")
	writeFile(t, path, "x", 0644)

	// 已有 5 份（t1 最舊 … t5）
	for i := 0; i < 5; i++ {
		ts := fmt.Sprintf("20260812T%06dZ", 150000+i)
		writeFile(t, path+".bak."+ts, "x", 0644)
	}
	// 第 6 份（本次）
	ts6 := "20260812T153045Z"
	writeFile(t, path+".bak."+ts6, "x", 0644)

	s := NewConfigStore()
	if err := s.PruneBackups(path, BackupKeepCount); err != nil {
		t.Fatalf("PruneBackups: %v", err)
	}

	files, _ := filepath.Glob(path + ".bak.*")
	if len(files) != 5 {
		t.Fatalf("after prune, %d backups remain, want 5", len(files))
	}
	// 最舊 t1 被刪除
	if _, err := os.Stat(path + ".bak.20260812T150000Z"); !os.IsNotExist(err) {
		t.Error("oldest backup should be removed")
	}
	// 最新 t6 保留
	if _, err := os.Stat(path + ".bak.20260812T153045Z"); err != nil {
		t.Errorf("newest backup should be kept: %v", err)
	}
}

func TestPruneBackups_UnderLimit(t *testing.T) {
	_, dir := newTestEnv(t)
	path := filepath.Join(dir, "nginx.service")
	writeFile(t, path, "x", 0644)

	for i := 0; i < 3; i++ {
		ts := fmt.Sprintf("20260812T%06dZ", 150000+i)
		writeFile(t, path+".bak."+ts, "x", 0644)
	}
	s := NewConfigStore()
	if err := s.PruneBackups(path, BackupKeepCount); err != nil {
		t.Fatal(err)
	}
	files, _ := filepath.Glob(path + ".bak.*")
	if len(files) != 3 {
		t.Errorf("under limit: %d backups, want 3 (no deletion)", len(files))
	}
}

func TestBackupTimestampSortOrder(t *testing.T) {
	names := []string{
		"nginx.service.bak.20260812T150000Z",
		"nginx.service.bak.20260812T153045Z",
		"nginx.service.bak.20260812T151000Z",
	}
	chronological := []string{
		"nginx.service.bak.20260812T150000Z",
		"nginx.service.bak.20260812T151000Z",
		"nginx.service.bak.20260812T153045Z",
	}
	sorted := append([]string(nil), names...)
	sort.Strings(sorted)
	for i := range chronological {
		if sorted[i] != chronological[i] {
			t.Errorf("lexicographic order != chronological at %d: %q vs %q", i, sorted[i], chronological[i])
		}
	}
}

func TestPruneBackups_OnlySameService(t *testing.T) {
	_, dir := newTestEnv(t)
	nginx := filepath.Join(dir, "nginx.service")
	mysql := filepath.Join(dir, "mysql.service")
	writeFile(t, nginx, "x", 0644)
	writeFile(t, mysql, "x", 0644)

	// nginx 5+1 份、mysql 1 份
	for i := 0; i < 6; i++ {
		ts := fmt.Sprintf("20260812T%06dZ", 150000+i)
		writeFile(t, nginx+".bak."+ts, "x", 0644)
	}
	writeFile(t, mysql+".bak.20260812T150000Z", "x", 0644)

	s := NewConfigStore()
	if err := s.PruneBackups(nginx, BackupKeepCount); err != nil {
		t.Fatal(err)
	}
	// mysql 備份不受影響
	if _, err := os.Stat(mysql + ".bak.20260812T150000Z"); err != nil {
		t.Errorf("mysql backup should be untouched: %v", err)
	}
	nginxFiles, _ := filepath.Glob(nginx + ".bak.*")
	if len(nginxFiles) != 5 {
		t.Errorf("nginx backups = %d, want 5", len(nginxFiles))
	}
}

// ============================================================
//  SYS-24~27 atomic write 與還原
// ============================================================

func TestAtomicWrite(t *testing.T) {
	_, dir := newTestEnv(t)
	path := filepath.Join(dir, "nginx.service")
	writeFile(t, path, "old", 0o640)

	s := NewConfigStore()
	if err := s.AtomicWrite(path, "new content"); err != nil {
		t.Fatalf("AtomicWrite: %v", err)
	}
	if got := readFile(t, path); got != "new content" {
		t.Errorf("content = %q, want new content", got)
	}
	// 26: mode 保留
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o640 {
		t.Errorf("mode = %o, want 640", info.Mode().Perm())
	}
	// 24: 無 .tmp 殘留
	tmps, _ := filepath.Glob(filepath.Join(dir, "*.tmp.*"))
	if len(tmps) != 0 {
		t.Errorf("tmp files left behind: %v", tmps)
	}
	// 新檔預設 0644
	p2 := filepath.Join(dir, "newfile.service")
	if err := s.AtomicWrite(p2, "x"); err != nil {
		t.Fatal(err)
	}
	info2, _ := os.Stat(p2)
	if info2.Mode().Perm() != 0o644 {
		t.Errorf("new file mode = %o, want 644", info2.Mode().Perm())
	}
}

func TestAtomicWrite_FailureLeavesOriginalAndRestore(t *testing.T) {
	_, dir := newTestEnv(t)
	path := filepath.Join(dir, "nginx.service")
	writeFile(t, path, "V1", 0644)

	s := NewConfigStore()
	backupPath, err := s.Backup(path)
	if err != nil {
		t.Fatal(err)
	}

	// 寫入失敗情境：parent 是普通檔案 → CreateTemp 失敗
	badParent := filepath.Join(dir, "notadir")
	writeFile(t, badParent, "x", 0644)
	if err := s.AtomicWrite(filepath.Join(badParent, "x.service"), "new"); err == nil {
		t.Error("expected AtomicWrite failure when parent is a file")
	}
	// 原檔完好
	if got := readFile(t, path); got != "V1" {
		t.Errorf("original file modified after failed write: %q", got)
	}

	// 目標是目錄 → rename 失敗
	dirTarget := filepath.Join(dir, "targetdir")
	if err := os.Mkdir(dirTarget, 0755); err != nil {
		t.Fatal(err)
	}
	if err := s.AtomicWrite(dirTarget, "x"); err == nil {
		t.Error("expected AtomicWrite failure when target is a directory")
	}

	// 25: 還原備份 — 模擬檔案已損毀，Restore 應恢復 V1
	writeFile(t, path, "corrupted", 0644)
	if err := s.Restore(backupPath, path); err != nil {
		t.Fatalf("Restore: %v", err)
	}
	if got := readFile(t, path); got != "V1" {
		t.Errorf("restored content = %q, want V1", got)
	}
}

func TestAtomicWrite_Concurrent(t *testing.T) {
	_, dir := newTestEnv(t)
	path := filepath.Join(dir, "nginx.service")
	writeFile(t, path, "init", 0644)
	s := NewConfigStore()

	contents := []string{
		strings.Repeat("A", 100000),
		strings.Repeat("B", 100000),
	}
	var wg sync.WaitGroup
	for _, c := range contents {
		wg.Add(1)
		go func(c string) {
			defer wg.Done()
			if err := s.AtomicWrite(path, c); err != nil {
				t.Errorf("AtomicWrite: %v", err)
			}
		}(c)
	}
	wg.Wait()

	got := readFile(t, path)
	if got != contents[0] && got != contents[1] {
		t.Error("concurrent writes produced partial/interleaved content")
	}
	if len(got) != 100000 {
		t.Errorf("content length = %d, want 100000 (no truncation)", len(got))
	}
}

// ============================================================
//  SYS-28~32 checksum 衝突偵測
// ============================================================

func TestCheckConflict(t *testing.T) {
	_, dir := newTestEnv(t)
	path := filepath.Join(dir, "nginx.service")
	writeFile(t, path, "V1", 0644)
	s := NewConfigStore()

	base, err := s.currentChecksumOf(path)
	if err != nil || base == "" {
		t.Fatalf("currentChecksumOf: %q, %v", base, err)
	}

	// 28: 一致 → 允許
	if err := s.CheckConflict(path, base); err != nil {
		t.Errorf("matching checksum should pass: %v", err)
	}

	// 29: 不一致 → ErrConflictCurrent + Current
	writeFile(t, path, "V2", 0644)
	err = s.CheckConflict(path, base)
	var cur ErrConflictCurrent
	if !errors.As(err, &cur) {
		t.Fatalf("want ErrConflictCurrent, got %v", err)
	}
	if cur.Current != checksumOf("V2") {
		t.Errorf("Current = %q, want %q", cur.Current, checksumOf("V2"))
	}

	// 30: 缺省（檔案存在）→ ErrConflictMissingBase
	if err := s.CheckConflict(path, ""); !errors.Is(err, ErrConflictMissingBase) {
		t.Errorf("missing base should be ErrConflictMissingBase, got %v", err)
	}

	// 31: 格式錯誤（非 64 hex）→ ErrInvalidChecksum
	if err := s.CheckConflict(path, "abc"); !errors.Is(err, ErrInvalidChecksum) {
		t.Errorf("bad checksum format should be ErrInvalidChecksum, got %v", err)
	}

	// 檔案不存在 → 跳過比對（允許重建）
	missing := filepath.Join(dir, "missing.service")
	if err := s.CheckConflict(missing, ""); err != nil {
		t.Errorf("missing file with empty base should pass (rebuild): %v", err)
	}
	if err := s.CheckConflict(missing, "whatever"); err != nil {
		t.Errorf("missing file should skip comparison: %v", err)
	}
}

func TestCheckConflict_RoundTrip(t *testing.T) {
	_, dir := newTestEnv(t)
	path := filepath.Join(dir, "nginx.service")
	writeFile(t, path, "V1", 0644)
	s := NewConfigStore()

	// GET → checksum C1
	c1, _ := s.currentChecksumOf(path)
	// PUT(base=C1)
	if err := s.CheckConflict(path, c1); err != nil {
		t.Fatal(err)
	}
	if err := s.AtomicWrite(path, "V2"); err != nil {
		t.Fatal(err)
	}
	// 再次 GET → C2 = V2 checksum
	c2, _ := s.currentChecksumOf(path)
	if c2 != checksumOf("V2") {
		t.Errorf("C2 = %q, want %q", c2, checksumOf("V2"))
	}
	if c2 == c1 {
		t.Error("C2 should differ from C1")
	}
	// 第三次 PUT 需以 C2 為基準
	if err := s.CheckConflict(path, c1); err == nil {
		t.Error("old base should conflict")
	}
	if err := s.CheckConflict(path, c2); err != nil {
		t.Errorf("new base should pass: %v", err)
	}
}

// ============================================================
//  FragmentPathOf（systemctl show 信任來源）
// ============================================================

func TestFragmentPathOf(t *testing.T) {
	orig := execCommandContext
	defer func() { execCommandContext = orig }()
	execCommandContext = func(ctx context.Context, name string, args ...string) *exec.Cmd {
		return exec.CommandContext(ctx, "sh", "-c", "printf '/etc/systemd/system/nginx.service'")
	}
	s := NewConfigStore()
	path, err := s.FragmentPathOf("nginx.service")
	if err != nil {
		t.Fatalf("FragmentPathOf: %v", err)
	}
	if path != "/etc/systemd/system/nginx.service" {
		t.Errorf("path = %q", path)
	}
}

func TestFragmentPathOf_EmptyOutput(t *testing.T) {
	orig := execCommandContext
	defer func() { execCommandContext = orig }()
	execCommandContext = func(ctx context.Context, name string, args ...string) *exec.Cmd {
		return exec.CommandContext(ctx, "sh", "-c", "printf ''")
	}
	s := NewConfigStore()
	path, err := s.FragmentPathOf("nginx.service")
	if err != nil {
		t.Fatalf("FragmentPathOf: %v", err)
	}
	if path != "" {
		t.Errorf("path = %q, want empty", path)
	}
}

// ============================================================
//  SYS-33~43 systemd-analyze 驗證
// ============================================================

func TestValidateConfig_Valid(t *testing.T) {
	restore := mockAnalyze(t, "", 0)
	defer restore()
	s := NewConfigStore()
	res, err := s.ValidateConfig("[Unit]\nDescription=ok\n")
	if err != nil {
		t.Fatalf("ValidateConfig: %v", err)
	}
	if !res.Valid {
		t.Error("valid config should be valid=true")
	}
	if !res.Available {
		t.Error("available should be true")
	}
	if len(res.Errors) != 0 {
		t.Errorf("errors = %v, want none", res.Errors)
	}
}

func TestValidateConfig_InvalidWithLine(t *testing.T) {
	restore := mockAnalyze(t, "/tmp/lsm-validate-abc.service:12: Unknown key 'ExecStartt'\n", 1)
	defer restore()
	s := NewConfigStore()
	res, err := s.ValidateConfig("[Service]\nExecStartt=/usr/bin/x\n")
	if err != nil {
		t.Fatalf("ValidateConfig: %v", err)
	}
	if res.Valid {
		t.Error("invalid config should be valid=false")
	}
	if len(res.Errors) != 1 {
		t.Fatalf("errors = %v, want 1", res.Errors)
	}
	if res.Errors[0].Line != 12 {
		t.Errorf("line = %d, want 12", res.Errors[0].Line)
	}
	if res.Errors[0].Message != "Unknown key 'ExecStartt'" {
		t.Errorf("message = %q", res.Errors[0].Message)
	}
}

func TestValidateConfig_WarningsOnlyIsValid(t *testing.T) {
	// exit 0（僅警告）→ valid=true
	restore := mockAnalyze(t, "/tmp/x.service:3: Some warning text\n", 0)
	defer restore()
	s := NewConfigStore()
	res, err := s.ValidateConfig("[Unit]\nDescription=x\n")
	if err != nil {
		t.Fatal(err)
	}
	if !res.Valid {
		t.Error("warnings with exit 0 should be valid")
	}
	if len(res.Errors) != 0 {
		t.Errorf("errors = %v, want none", res.Errors)
	}
}

func TestValidateConfig_MultipleErrors(t *testing.T) {
	output := strings.Join([]string{
		"/tmp/lsm-validate-a.service:1: Unknown key 'ExecStartt'",
		"/tmp/lsm-validate-a.service:3: Section [Service] not found",
		"/tmp/lsm-validate-a.service:5: Missing '=' in key/value assignment",
		"/tmp/lsm-validate-a.service:8: ExecStart= path does not exist: /usr/bin/not-exist",
	}, "\n") + "\n"
	restore := mockAnalyze(t, output, 1)
	defer restore()
	s := NewConfigStore()
	res, err := s.ValidateConfig("bad")
	if err != nil {
		t.Fatal(err)
	}
	if res.Valid {
		t.Error("should be invalid")
	}
	if len(res.Errors) != 4 {
		t.Fatalf("errors = %d, want 4: %v", len(res.Errors), res.Errors)
	}
	wantLines := []int{1, 3, 5, 8}
	wantMsgs := []string{
		"Unknown key 'ExecStartt'",
		"Section [Service] not found",
		"Missing '=' in key/value assignment",
		"ExecStart= path does not exist: /usr/bin/not-exist",
	}
	for i, e := range res.Errors {
		if e.Line != wantLines[i] {
			t.Errorf("errors[%d].Line = %d, want %d", i, e.Line, wantLines[i])
		}
		if e.Message != wantMsgs[i] {
			t.Errorf("errors[%d].Message = %q, want %q", i, e.Message, wantMsgs[i])
		}
	}
}

func TestValidateConfig_AnalyzeMissing(t *testing.T) {
	orig := lookPath
	lookPath = func(name string) (string, error) {
		return "", errors.New("exec: not found")
	}
	defer func() { lookPath = orig }()

	s := NewConfigStore()
	res, err := s.ValidateConfig("[Unit]\nDescription=x\n")
	if err != nil {
		t.Fatalf("analyze missing should NOT be an error (200 available=false), got: %v", err)
	}
	if res.Available {
		t.Error("available should be false")
	}
	if res.Valid {
		t.Error("valid should be false")
	}
	if !strings.Contains(res.Message, "systemd-analyze") {
		t.Errorf("message should mention systemd-analyze, got %q", res.Message)
	}
}

func TestValidateConfig_Timeout(t *testing.T) {
	restoreValidateTimeout(t)
	ValidateTimeout = 300 * time.Millisecond

	origCmd := execCommandContext
	origPath := lookPath
	lookPath = func(name string) (string, error) { return "/usr/bin/systemd-analyze", nil }
	execCommandContext = func(ctx context.Context, name string, args ...string) *exec.Cmd {
		return exec.CommandContext(ctx, "sleep", "30")
	}
	defer func() {
		execCommandContext = origCmd
		lookPath = origPath
	}()

	s := NewConfigStore()
	start := time.Now()
	_, err := s.ValidateConfig("[Unit]\nDescription=x\n")
	if err == nil {
		t.Fatal("expected timeout error")
	}
	if time.Since(start) > 10*time.Second {
		t.Error("timeout did not kill process promptly")
	}
}

func TestValidateConfig_UnparseableOutput(t *testing.T) {
	restore := mockAnalyze(t, "Random garbage line without pattern\n", 1)
	defer restore()
	s := NewConfigStore()
	res, err := s.ValidateConfig("x")
	if err != nil {
		t.Fatal(err)
	}
	if res.Valid {
		t.Error("should be invalid")
	}
	if len(res.Errors) != 1 {
		t.Fatalf("errors = %v, want 1 raw error", res.Errors)
	}
	if res.Errors[0].Message != "Random garbage line without pattern" {
		t.Errorf("raw message = %q", res.Errors[0].Message)
	}
}

func TestValidateConfig_TempCreateFailure(t *testing.T) {
	restoreValidateTimeout(t)
	orig := validateTmpDir
	validateTmpDir = filepath.Join(t.TempDir(), "nope", "sub")
	defer func() { validateTmpDir = orig }()

	origPath := lookPath
	lookPath = func(name string) (string, error) { return "/usr/bin/systemd-analyze", nil }
	defer func() { lookPath = origPath }()

	s := NewConfigStore()
	_, err := s.ValidateConfig("x")
	if err == nil {
		t.Fatal("expected temp create failure")
	}
	if !strings.Contains(err.Error(), "暫存檔") {
		t.Errorf("error should mention temp file: %v", err)
	}
}

func TestValidateConfig_TempNamingAndMode(t *testing.T) {
	restoreValidateTimeout(t)
	var capturedTmp string
	modeFile := filepath.Join(t.TempDir(), "mode.txt")

	origCmd := execCommandContext
	origPath := lookPath
	lookPath = func(name string) (string, error) { return "/usr/bin/systemd-analyze", nil }
	execCommandContext = func(ctx context.Context, name string, args ...string) *exec.Cmd {
		capturedTmp = args[len(args)-1]
		return exec.CommandContext(ctx, "sh", "-c",
			"stat -c '%a' \""+capturedTmp+"\" > \""+modeFile+"\"")
	}
	defer func() {
		execCommandContext = origCmd
		lookPath = origPath
	}()

	s := NewConfigStore()
	if _, err := s.ValidateConfig("[Unit]\nDescription=x\n"); err != nil {
		t.Fatal(err)
	}

	if capturedTmp == "" {
		t.Fatal("analyze command did not receive tmp path")
	}
	base := filepath.Base(capturedTmp)
	if !strings.HasPrefix(base, "lsm-validate-") || !strings.HasSuffix(base, ".service") {
		t.Errorf("tmp filename = %q, want lsm-validate-{uuid}.service", base)
	}
	modeBytes, err := os.ReadFile(modeFile)
	if err != nil {
		t.Fatalf("read mode file: %v", err)
	}
	if strings.TrimSpace(string(modeBytes)) != "600" {
		t.Errorf("tmp file mode = %s, want 600", strings.TrimSpace(string(modeBytes)))
	}
}

func TestValidateConfig_TempRemoved(t *testing.T) {
	restoreValidateTimeout(t)
	origTmp := validateTmpDir
	// 用獨立 temp dir 驗證無殘留，避免污染真實 /tmp
	validateTmpDir = t.TempDir()
	defer func() { validateTmpDir = origTmp }()

	// 成功路徑
	restore := mockAnalyze(t, "", 0)
	if _, err := NewConfigStore().ValidateConfig("good"); err != nil {
		t.Fatal(err)
	}
	restore()
	// 失敗路徑（exit 1）
	restore = mockAnalyze(t, "/tmp/x:1: err\n", 1)
	if _, err := NewConfigStore().ValidateConfig("bad"); err != nil {
		t.Fatal(err)
	}
	restore()

	leftovers, _ := filepath.Glob(filepath.Join(validateTmpDir, "lsm-validate-*"))
	if len(leftovers) != 0 {
		t.Errorf("temp files left behind: %v", leftovers)
	}
}

// ============================================================
//  SYS-44~46 商業規則
// ============================================================

func TestDaemonReload_Timeout(t *testing.T) {
	origTimeout := DaemonReloadTimeout
	DaemonReloadTimeout = 300 * time.Millisecond
	defer func() { DaemonReloadTimeout = origTimeout }()

	orig := execCommandContext
	execCommandContext = func(ctx context.Context, name string, args ...string) *exec.Cmd {
		return exec.CommandContext(ctx, "sleep", "30")
	}
	defer func() { execCommandContext = orig }()

	s := NewConfigStore()
	start := time.Now()
	err := s.DaemonReload(context.Background())
	if err == nil {
		t.Fatal("expected timeout error")
	}
	if !strings.Contains(err.Error(), "逾時") {
		t.Errorf("error should mention timeout: %v", err)
	}
	if time.Since(start) > 10*time.Second {
		t.Error("reload did not respect timeout")
	}
}

func TestDaemonReload_Success(t *testing.T) {
	orig := execCommandContext
	execCommandContext = func(ctx context.Context, name string, args ...string) *exec.Cmd {
		return exec.CommandContext(ctx, "true")
	}
	defer func() { execCommandContext = orig }()

	s := NewConfigStore()
	if err := s.DaemonReload(context.Background()); err != nil {
		t.Fatalf("DaemonReload: %v", err)
	}
}

// SYS-46 無悲觀鎖定：依序兩次儲存，後者基準不符回 409；無 lock 檔案。
func TestSequentialSavesNoPessimisticLock(t *testing.T) {
	_, dir := newTestEnv(t)
	path := filepath.Join(dir, "nginx.service")
	writeFile(t, path, "V1", 0644)
	s := NewConfigStore()

	base1, _ := s.currentChecksumOf(path)
	// 第一次 PUT（base1）成功
	if err := s.CheckConflict(path, base1); err != nil {
		t.Fatalf("first save should pass: %v", err)
	}
	if err := s.AtomicWrite(path, "V2"); err != nil {
		t.Fatal(err)
	}
	// 第二次 PUT（仍用 base1）→ 409
	if err := s.CheckConflict(path, base1); err == nil {
		t.Error("second save with stale base should conflict")
	}
	// 第二次 PUT（新 base）→ 成功（last-write-wins）
	base2, _ := s.currentChecksumOf(path)
	if err := s.CheckConflict(path, base2); err != nil {
		t.Fatalf("second save with fresh base should pass: %v", err)
	}
	// 無 lock 檔案
	locks, _ := filepath.Glob(filepath.Join(dir, "*.lock"))
	if len(locks) != 0 {
		t.Errorf("lock files should not exist: %v", locks)
	}
}
