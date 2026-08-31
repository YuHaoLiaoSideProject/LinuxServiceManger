package handler

// HDL-01 ~ HDL-30 handler 測試（對應 docs/test-plans/012-service-config-editor測試計畫.md §2.8）
// 先寫測試（RED），再實作 config_handler.go 使其轉綠。

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"linux-service-manager/internal/audit"
	"linux-service-manager/internal/auth"
	"linux-service-manager/internal/systemd"

	"github.com/go-chi/chi/v5"
)

func TestMain(m *testing.M) {
	auth.Setup() // initialize session store before any test runs
	os.Exit(m.Run())
}

// ============================================================
//  fakeConfig — 可腳本化的 ConfigAPI（mock systemd.ConfigStore）
// ============================================================

type fakeConfig struct {
	real        *systemd.ConfigStore
	paths       map[string]string
	pathErrs    map[string]error
	backupPath  string
	backupErr   error
	writeErr    error
	restoreErr  error
	reloadErr   error
	conflictErr error
	pathValErr  error
	readFn      func(name, path string) (*systemd.ServiceConfig, error)
	validateFn  func(content string) (*systemd.ValidateResult, error)

	backupCalled  []string
	pruneCalled   []string
	writeCalled   []string
	restoreCalled []string
	reloadCalled  int
}

func (f *fakeConfig) FragmentPathOf(name string) (string, error) {
	if f.pathErrs != nil {
		if err, ok := f.pathErrs[name]; ok {
			return "", err
		}
	}
	if p, ok := f.paths[name]; ok {
		return p, nil
	}
	return "", fmt.Errorf("no fragment path for %s", name)
}

func (f *fakeConfig) ReadConfig(name, path string) (*systemd.ServiceConfig, error) {
	if f.readFn != nil {
		return f.readFn(name, path)
	}
	if f.real != nil {
		return f.real.ReadConfig(name, path)
	}
	return nil, fmt.Errorf("ReadConfig not configured")
}

func (f *fakeConfig) ValidateWritablePath(path string) error { return f.pathValErr }

func (f *fakeConfig) CheckConflict(path, baseChecksum string) error { return f.conflictErr }

func (f *fakeConfig) Backup(path string) (string, error) {
	f.backupCalled = append(f.backupCalled, path)
	if f.backupErr != nil {
		return "", f.backupErr
	}
	return f.backupPath, nil
}

func (f *fakeConfig) PruneBackups(path string, keep int) error {
	f.pruneCalled = append(f.pruneCalled, path)
	return nil
}

func (f *fakeConfig) AtomicWrite(path, content string) error {
	f.writeCalled = append(f.writeCalled, path)
	return f.writeErr
}

func (f *fakeConfig) Restore(backupPath, path string) error {
	f.restoreCalled = append(f.restoreCalled, backupPath)
	return f.restoreErr
}

func (f *fakeConfig) DaemonReload(ctx context.Context) error {
	f.reloadCalled++
	return f.reloadErr
}

func (f *fakeConfig) ValidateConfig(content string) (*systemd.ValidateResult, error) {
	if f.validateFn != nil {
		return f.validateFn(content)
	}
	return &systemd.ValidateResult{Valid: true, Available: true}, nil
}

var _ systemd.ConfigAPI = (*fakeConfig)(nil)

// ============================================================
//  Test router
// ============================================================

func setupConfigRouter(h *Handler) *chi.Mux {
	r := chi.NewRouter()
	r.Group(func(r chi.Router) {
		r.Use(authMiddlewareJSON)
		r.Get("/api/v1/services/{name}/config", h.HandleGetServiceConfig)
		r.Put("/api/v1/services/{name}/config", h.HandleSaveServiceConfig)
		r.Post("/api/v1/services/{name}/config/validate", h.HandleValidateServiceConfig)
	})
	return r
}

func newConfigTestHandler(t *testing.T, fake *fakeConfig, auditMod *audit.Module) (*Handler, *chi.Mux) {
	t.Helper()
	if fake == nil {
		fake = &fakeConfig{}
	}
	mock := &mockSystemd{}
	h := New(nil, mock, auditMod, nil)
	h.Config = fake
	return h, setupConfigRouter(h)
}

// doConfigReq 以 admin 身份發送請求（cookie 可為 nil → 未登入）。
func doConfigReq(t *testing.T, router http.Handler, method, target, body string, cookie *http.Cookie) *httptest.ResponseRecorder {
	t.Helper()
	var reqBody *strings.Reader
	if body != "" {
		reqBody = strings.NewReader(body)
	} else {
		reqBody = strings.NewReader("")
	}
	req := httptest.NewRequest(method, target, reqBody)
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	if cookie != nil {
		req.AddCookie(cookie)
	}
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	return w
}

func loginCookie(t *testing.T, router http.Handler) *http.Cookie {
	t.Helper()
	origUser, origPass := auth.AdminUser, auth.AdminPass
	auth.AdminUser, auth.AdminPass = "admin", "pass"
	t.Cleanup(func() { auth.AdminUser, auth.AdminPass = origUser, origPass })

	form := url.Values{}
	form.Set("username", "admin")
	form.Set("password", "pass")
	req := httptest.NewRequest(http.MethodPost, "/api/v1/login", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	w := httptest.NewRecorder()
	// 需要 login route
	loginRouter := chi.NewRouter()
	loginRouter.Post("/api/v1/login", func(w http.ResponseWriter, r *http.Request) {
		r.ParseForm()
		session := auth.GetSession(r)
		session.Values["authenticated"] = true
		session.Values["username"] = "admin"
		auth.SaveSession(w, r, session)
		writeJSON(w, http.StatusOK, map[string]interface{}{"username": "admin"})
	})
	loginRouter.ServeHTTP(w, req)
	cookies := w.Result().Cookies()
	for _, c := range cookies {
		if c.Name == "linux-service-manager" {
			return c
		}
	}
	t.Fatal("no session cookie")
	return nil
}

// waitAudit 輪詢 audit file 直到總筆數 >= n。
func waitAudit(t *testing.T, m *audit.Module, n int) []audit.Entry {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		res, err := m.Query(audit.QueryParams{Page: 1, Limit: 100})
		if err == nil && res.Total >= n {
			return res.Entries
		}
		time.Sleep(10 * time.Millisecond)
	}
	res, _ := m.Query(audit.QueryParams{Page: 1, Limit: 100})
	t.Fatalf("audit entries = %d, want >= %d", res.Total, n)
	return nil
}

const validChecksum = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"

// ============================================================
//  GET /api/v1/services/{name}/config
// ============================================================

func TestGetConfig_Success(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "nginx.service")
	content := "[Unit]\nDescription=nginx\n"
	if err := os.WriteFile(path, []byte(content), 0644); err != nil {
		t.Fatal(err)
	}
	real := systemd.NewConfigStore()
	fake := &fakeConfig{real: real, paths: map[string]string{"nginx.service": path}}
	_, router := newConfigTestHandler(t, fake, nil)
	cookie := loginCookie(t, router)

	w := doConfigReq(t, router, http.MethodGet, "/api/v1/services/nginx.service/config", "", cookie)
	body := assertJSON(t, w, http.StatusOK)

	if body["name"] != "nginx.service" {
		t.Errorf("name = %v", body["name"])
	}
	if body["fragmentPath"] != path {
		t.Errorf("fragmentPath = %v", body["fragmentPath"])
	}
	if body["config"] != content {
		t.Errorf("config = %v", body["config"])
	}
	if int64(body["size"].(float64)) != int64(len(content)) {
		t.Errorf("size = %v", body["size"])
	}
	if body["checksum"] != systemd.NewConfigStore().ComputeChecksum(content) {
		t.Errorf("checksum = %v", body["checksum"])
	}
}

func TestGetConfig_InvalidName(t *testing.T) {
	_, router := newConfigTestHandler(t, nil, nil)
	cookie := loginCookie(t, router)
	w := doConfigReq(t, router, http.MethodGet, "/api/v1/services/invalid%20name!/config", "", cookie)
	body := assertJSON(t, w, http.StatusBadRequest)
	if body["error"] != "invalid service name" {
		t.Errorf("error = %v", body["error"])
	}
}

func TestGetConfig_LockedServiceAllowed(t *testing.T) {
	// 決策 D-2：GET 鎖定服務（/usr/lib 等）回 200 唯讀檢視
	content := "[Unit]\nDescription=journald\n"
	fake := &fakeConfig{
		paths:  map[string]string{"systemd-journald.service": "/usr/lib/systemd/system/systemd-journald.service"},
		readFn: func(name, path string) (*systemd.ServiceConfig, error) {
			return &systemd.ServiceConfig{
				Name: name, FragmentPath: path, Content: content,
				Size: int64(len(content)), Checksum: systemd.NewConfigStore().ComputeChecksum(content),
			}, nil
		},
	}
	_, router := newConfigTestHandler(t, fake, nil)
	cookie := loginCookie(t, router)
	w := doConfigReq(t, router, http.MethodGet, "/api/v1/services/systemd-journald.service/config", "", cookie)
	body := assertJSON(t, w, http.StatusOK)
	if body["config"] != content {
		t.Errorf("config = %v", body["config"])
	}
}

func TestGetConfig_EmptyFragmentPath(t *testing.T) {
	fake := &fakeConfig{paths: map[string]string{"nginx.service": ""}}
	_, router := newConfigTestHandler(t, fake, nil)
	cookie := loginCookie(t, router)
	w := doConfigReq(t, router, http.MethodGet, "/api/v1/services/nginx.service/config", "", cookie)
	body := assertJSON(t, w, http.StatusNotFound)
	if body["error"] != "設定檔路徑不存在" {
		t.Errorf("error = %v", body["error"])
	}
}

func TestGetConfig_FileNotFound(t *testing.T) {
	fake := &fakeConfig{
		paths: map[string]string{"nginx.service": "/etc/systemd/system/nginx.service"},
		readFn: func(name, path string) (*systemd.ServiceConfig, error) {
			return nil, systemd.ErrConfigNotFound
		},
	}
	_, router := newConfigTestHandler(t, fake, nil)
	cookie := loginCookie(t, router)
	w := doConfigReq(t, router, http.MethodGet, "/api/v1/services/nginx.service/config", "", cookie)
	body := assertJSON(t, w, http.StatusNotFound)
	if !strings.Contains(body["error"].(string), "設定檔不存在") {
		t.Errorf("error = %v", body["error"])
	}
}

func TestGetConfig_TooLarge(t *testing.T) {
	fake := &fakeConfig{
		paths: map[string]string{"big.service": "/etc/systemd/system/big.service"},
		readFn: func(name, path string) (*systemd.ServiceConfig, error) {
			return nil, systemd.ErrConfigTooLarge
		},
	}
	_, router := newConfigTestHandler(t, fake, nil)
	cookie := loginCookie(t, router)
	w := doConfigReq(t, router, http.MethodGet, "/api/v1/services/big.service/config", "", cookie)
	body := assertJSON(t, w, http.StatusRequestEntityTooLarge)
	if !strings.Contains(body["error"].(string), "500KB") {
		t.Errorf("error = %v", body["error"])
	}
}

func TestGetConfig_PermissionDenied(t *testing.T) {
	fake := &fakeConfig{
		paths: map[string]string{"nginx.service": "/etc/systemd/system/nginx.service"},
		readFn: func(name, path string) (*systemd.ServiceConfig, error) {
			return nil, errors.New("permission denied reading file")
		},
	}
	_, router := newConfigTestHandler(t, fake, nil)
	cookie := loginCookie(t, router)
	w := doConfigReq(t, router, http.MethodGet, "/api/v1/services/nginx.service/config", "", cookie)
	body := assertJSON(t, w, http.StatusInternalServerError)
	if !strings.Contains(strings.ToLower(body["error"].(string)), "無法讀取設定檔") {
		t.Errorf("error = %v", body["error"])
	}
}

func TestGetConfig_Unauthorized(t *testing.T) {
	_, router := newConfigTestHandler(t, nil, nil)
	w := doConfigReq(t, router, http.MethodGet, "/api/v1/services/nginx.service/config", "", nil)
	assertJSON(t, w, http.StatusUnauthorized)
}

// ============================================================
//  PUT /api/v1/services/{name}/config
// ============================================================

func TestPutConfig_Success(t *testing.T) {
	auditMod := newTestAuditModule(t)
	backupPath := "/etc/systemd/system/nginx.service.bak.20260812T153045Z"
	fake := &fakeConfig{
		paths:      map[string]string{"nginx.service": "/etc/systemd/system/nginx.service"},
		backupPath: backupPath,
	}
	_, router := newConfigTestHandler(t, fake, auditMod)
	cookie := loginCookie(t, router)

	bodyReq := fmt.Sprintf(`{"config":"[Unit]\nDescription=new","baseChecksum":"%s"}`, validChecksum)
	w := doConfigReq(t, router, http.MethodPut, "/api/v1/services/nginx.service/config", bodyReq, cookie)
	body := assertJSON(t, w, http.StatusOK)

	if body["backupPath"] != backupPath {
		t.Errorf("backupPath = %v", body["backupPath"])
	}
	if !strings.Contains(body["message"].(string), "daemon-reload 已執行") {
		t.Errorf("message = %v", body["message"])
	}
	// 流程依序執行：backup → prune → write → reload
	if len(fake.backupCalled) != 1 {
		t.Errorf("backup called %d times", len(fake.backupCalled))
	}
	if len(fake.pruneCalled) != 1 {
		t.Errorf("prune called %d times", len(fake.pruneCalled))
	}
	if len(fake.writeCalled) != 1 {
		t.Errorf("write called %d times", len(fake.writeCalled))
	}
	if fake.reloadCalled != 1 {
		t.Errorf("reload called %d times", fake.reloadCalled)
	}
	if len(fake.restoreCalled) != 0 {
		t.Errorf("restore should not be called on success: %v", fake.restoreCalled)
	}
	// audit config_save
	entries := waitAudit(t, auditMod, 1)
	if entries[0].Action != audit.ActionConfigSave {
		t.Errorf("action = %s, want config_save", entries[0].Action)
	}
	if entries[0].Target != "nginx.service" {
		t.Errorf("target = %s", entries[0].Target)
	}
	if entries[0].Detail != backupPath {
		t.Errorf("detail = %s, want backupPath", entries[0].Detail)
	}
}

func TestPutConfig_InvalidName(t *testing.T) {
	_, router := newConfigTestHandler(t, nil, nil)
	cookie := loginCookie(t, router)
	w := doConfigReq(t, router, http.MethodPut, "/api/v1/services/invalid%20name!/config", `{"config":"x","baseChecksum":"`+validChecksum+`"}`, cookie)
	body := assertJSON(t, w, http.StatusBadRequest)
	if body["error"] != "invalid service name" {
		t.Errorf("error = %v", body["error"])
	}
}

func TestPutConfig_LockedService(t *testing.T) {
	fake := &fakeConfig{
		paths:      map[string]string{"systemd-journald.service": "/usr/lib/systemd/system/systemd-journald.service"},
		pathValErr: systemd.ErrPathNotAllowed,
	}
	_, router := newConfigTestHandler(t, fake, nil)
	cookie := loginCookie(t, router)
	bodyReq := fmt.Sprintf(`{"config":"x","baseChecksum":"%s"}`, validChecksum)
	w := doConfigReq(t, router, http.MethodPut, "/api/v1/services/systemd-journald.service/config", bodyReq, cookie)
	body := assertJSON(t, w, http.StatusForbidden)
	if body["error"] != "不允許編輯此服務設定檔" {
		t.Errorf("error = %v", body["error"])
	}
	if len(fake.writeCalled) != 0 {
		t.Error("locked service must not be written")
	}
}

func TestPutConfig_PathTraversal(t *testing.T) {
	fake := &fakeConfig{
		paths:      map[string]string{"evil.service": "/etc/systemd/system/../../etc/passwd"},
		pathValErr: systemd.ErrPathNotAllowed,
	}
	_, router := newConfigTestHandler(t, fake, nil)
	cookie := loginCookie(t, router)
	bodyReq := fmt.Sprintf(`{"config":"x","baseChecksum":"%s"}`, validChecksum)
	w := doConfigReq(t, router, http.MethodPut, "/api/v1/services/evil.service/config", bodyReq, cookie)
	body := assertJSON(t, w, http.StatusForbidden)
	if body["error"] != "不允許編輯此服務設定檔" {
		t.Errorf("error = %v", body["error"])
	}
	if len(fake.writeCalled) != 0 || len(fake.backupCalled) != 0 {
		t.Error("no file system side effects allowed for traversal attempt")
	}
}

func TestPutConfig_NonServiceExt(t *testing.T) {
	fake := &fakeConfig{
		paths:      map[string]string{"backup.service": "/etc/systemd/system/backup.timer"},
		pathValErr: systemd.ErrExtNotService,
	}
	_, router := newConfigTestHandler(t, fake, nil)
	cookie := loginCookie(t, router)
	bodyReq := fmt.Sprintf(`{"config":"x","baseChecksum":"%s"}`, validChecksum)
	w := doConfigReq(t, router, http.MethodPut, "/api/v1/services/backup.service/config", bodyReq, cookie)
	body := assertJSON(t, w, http.StatusForbidden)
	if body["error"] != "僅支援 .service 設定檔" {
		t.Errorf("error = %v", body["error"])
	}
}

func TestPutConfig_TooLarge(t *testing.T) {
	fake := &fakeConfig{paths: map[string]string{"nginx.service": "/etc/systemd/system/nginx.service"}}
	_, router := newConfigTestHandler(t, fake, nil)
	cookie := loginCookie(t, router)
	big := strings.Repeat("A", 600000)
	bodyReq := fmt.Sprintf(`{"config":"%s","baseChecksum":"%s"}`, big, validChecksum)
	w := doConfigReq(t, router, http.MethodPut, "/api/v1/services/nginx.service/config", bodyReq, cookie)
	body := assertJSON(t, w, http.StatusRequestEntityTooLarge)
	if !strings.Contains(body["error"].(string), "500KB") {
		t.Errorf("error = %v", body["error"])
	}
	if len(fake.writeCalled) != 0 || len(fake.backupCalled) != 0 {
		t.Error("413 must not write or backup")
	}
}

func TestPutConfig_BadJSON(t *testing.T) {
	fake := &fakeConfig{paths: map[string]string{"nginx.service": "/etc/systemd/system/nginx.service"}}
	_, router := newConfigTestHandler(t, fake, nil)
	cookie := loginCookie(t, router)
	w := doConfigReq(t, router, http.MethodPut, "/api/v1/services/nginx.service/config", `{invalid json`, cookie)
	body := assertJSON(t, w, http.StatusBadRequest)
	if body["error"] != "invalid request body" {
		t.Errorf("error = %v", body["error"])
	}
}

func TestPutConfig_MissingBaseChecksum(t *testing.T) {
	fake := &fakeConfig{
		paths:       map[string]string{"nginx.service": "/etc/systemd/system/nginx.service"},
		conflictErr: systemd.ErrConflictMissingBase,
	}
	_, router := newConfigTestHandler(t, fake, nil)
	cookie := loginCookie(t, router)
	w := doConfigReq(t, router, http.MethodPut, "/api/v1/services/nginx.service/config", `{"config":"x"}`, cookie)
	body := assertJSON(t, w, http.StatusBadRequest)
	if body["error"] != "base_checksum is required" {
		t.Errorf("error = %v", body["error"])
	}
}

func TestPutConfig_Conflict(t *testing.T) {
	fake := &fakeConfig{
		paths:       map[string]string{"nginx.service": "/etc/systemd/system/nginx.service"},
		conflictErr: systemd.ErrConflictCurrent{Current: "5f8cdeadbeef"},
	}
	_, router := newConfigTestHandler(t, fake, nil)
	cookie := loginCookie(t, router)
	bodyReq := fmt.Sprintf(`{"config":"x","baseChecksum":"%s"}`, validChecksum)
	w := doConfigReq(t, router, http.MethodPut, "/api/v1/services/nginx.service/config", bodyReq, cookie)
	body := assertJSON(t, w, http.StatusConflict)
	if body["error"] != "設定檔已被其他使用者修改。請重新載入後再編輯。" {
		t.Errorf("error = %v", body["error"])
	}
	if body["currentChecksum"] != "5f8cdeadbeef" {
		t.Errorf("currentChecksum = %v", body["currentChecksum"])
	}
	if len(fake.writeCalled) != 0 {
		t.Error("conflict must not write")
	}
}

func TestPutConfig_WriteFailureRestores(t *testing.T) {
	auditMod := newTestAuditModule(t)
	backupPath := "/etc/systemd/system/nginx.service.bak.20260812T153045Z"
	fake := &fakeConfig{
		paths:      map[string]string{"nginx.service": "/etc/systemd/system/nginx.service"},
		backupPath: backupPath,
		writeErr:   errors.New("disk full"),
	}
	_, router := newConfigTestHandler(t, fake, auditMod)
	cookie := loginCookie(t, router)
	bodyReq := fmt.Sprintf(`{"config":"x","baseChecksum":"%s"}`, validChecksum)
	w := doConfigReq(t, router, http.MethodPut, "/api/v1/services/nginx.service/config", bodyReq, cookie)
	body := assertJSON(t, w, http.StatusInternalServerError)
	if body["error"] != "寫入失敗" {
		t.Errorf("error = %v", body["error"])
	}
	if body["backupPath"] != backupPath {
		t.Errorf("backupPath = %v", body["backupPath"])
	}
	// 還原備份被呼叫
	if len(fake.restoreCalled) != 1 || fake.restoreCalled[0] != backupPath {
		t.Errorf("restore called = %v, want [%s]", fake.restoreCalled, backupPath)
	}
	// audit failure
	entries := waitAudit(t, auditMod, 1)
	if entries[0].Action != audit.ActionConfigSave || entries[0].Result != audit.ResultFailure {
		t.Errorf("audit = %+v, want config_save/failure", entries[0])
	}
}

func TestPutConfig_ReloadFailureNoRestore(t *testing.T) {
	auditMod := newTestAuditModule(t)
	backupPath := "/etc/systemd/system/nginx.service.bak.20260812T153045Z"
	fake := &fakeConfig{
		paths:      map[string]string{"nginx.service": "/etc/systemd/system/nginx.service"},
		backupPath: backupPath,
		reloadErr:  errors.New("dbus connection lost"),
	}
	_, router := newConfigTestHandler(t, fake, auditMod)
	cookie := loginCookie(t, router)
	bodyReq := fmt.Sprintf(`{"config":"new-content","baseChecksum":"%s"}`, validChecksum)
	w := doConfigReq(t, router, http.MethodPut, "/api/v1/services/nginx.service/config", bodyReq, cookie)
	body := assertJSON(t, w, http.StatusInternalServerError)
	if !strings.Contains(body["error"].(string), "daemon-reload 失敗") {
		t.Errorf("error = %v", body["error"])
	}
	if body["backupPath"] != backupPath {
		t.Errorf("backupPath = %v", body["backupPath"])
	}
	// 不還原（寫入成功）
	if len(fake.restoreCalled) != 0 {
		t.Errorf("reload failure must NOT restore: %v", fake.restoreCalled)
	}
	if len(fake.writeCalled) != 1 {
		t.Error("file should have been written")
	}
	// audit：半成功 result=success，detail 附註 reload 錯誤
	entries := waitAudit(t, auditMod, 1)
	if entries[0].Result != audit.ResultSuccess {
		t.Errorf("audit result = %s, want success (half-success)", entries[0].Result)
	}
	if !strings.Contains(entries[0].Detail, "daemon-reload 失敗") {
		t.Errorf("audit detail = %q", entries[0].Detail)
	}
}

func TestPutConfig_Unauthorized(t *testing.T) {
	fake := &fakeConfig{paths: map[string]string{"nginx.service": "/etc/systemd/system/nginx.service"}}
	_, router := newConfigTestHandler(t, fake, nil)
	bodyReq := fmt.Sprintf(`{"config":"x","baseChecksum":"%s"}`, validChecksum)
	w := doConfigReq(t, router, http.MethodPut, "/api/v1/services/nginx.service/config", bodyReq, nil)
	assertJSON(t, w, http.StatusUnauthorized)
	if len(fake.writeCalled) != 0 {
		t.Error("file must not be modified by unauthorized request")
	}
}

// ============================================================
//  POST /api/v1/services/{name}/config/validate
// ============================================================

func TestValidateConfig_Valid(t *testing.T) {
	fake := &fakeConfig{
		validateFn: func(content string) (*systemd.ValidateResult, error) {
			return &systemd.ValidateResult{Valid: true, Available: true, Errors: []systemd.ValidateError{}}, nil
		},
	}
	_, router := newConfigTestHandler(t, fake, nil)
	cookie := loginCookie(t, router)
	w := doConfigReq(t, router, http.MethodPost, "/api/v1/services/nginx.service/config/validate", `{"config":"[Unit]\nDescription=x"}`, cookie)
	body := assertJSON(t, w, http.StatusOK)
	if body["valid"] != true {
		t.Errorf("valid = %v", body["valid"])
	}
	if body["available"] != true {
		t.Errorf("available = %v", body["available"])
	}
}

func TestValidateConfig_InvalidWithLine(t *testing.T) {
	fake := &fakeConfig{
		validateFn: func(content string) (*systemd.ValidateResult, error) {
			return &systemd.ValidateResult{
				Valid:     false,
				Available: true,
				Errors:    []systemd.ValidateError{{Line: 12, Message: "Unknown key 'ExecStartt'"}},
			}, nil
		},
	}
	_, router := newConfigTestHandler(t, fake, nil)
	cookie := loginCookie(t, router)
	w := doConfigReq(t, router, http.MethodPost, "/api/v1/services/nginx.service/config/validate", `{"config":"bad"}`, cookie)
	body := assertJSON(t, w, http.StatusOK)
	if body["valid"] != false {
		t.Errorf("valid = %v", body["valid"])
	}
	errs, ok := body["errors"].([]interface{})
	if !ok || len(errs) != 1 {
		t.Fatalf("errors = %v", body["errors"])
	}
	e := errs[0].(map[string]interface{})
	if int(e["line"].(float64)) != 12 || e["message"] != "Unknown key 'ExecStartt'" {
		t.Errorf("error entry = %v", e)
	}
}

func TestValidateConfig_AnalyzeUnavailable(t *testing.T) {
	fake := &fakeConfig{
		validateFn: func(content string) (*systemd.ValidateResult, error) {
			return &systemd.ValidateResult{
				Valid: false, Available: false,
				Errors:  []systemd.ValidateError{},
				Message: "systemd-analyze 指令不存在，無法進行語法驗證",
			}, nil
		},
	}
	_, router := newConfigTestHandler(t, fake, nil)
	cookie := loginCookie(t, router)
	w := doConfigReq(t, router, http.MethodPost, "/api/v1/services/nginx.service/config/validate", `{"config":"x"}`, cookie)
	body := assertJSON(t, w, http.StatusOK) // 200，非 500（決策 D-3）
	if body["available"] != false {
		t.Errorf("available = %v", body["available"])
	}
	if body["valid"] != false {
		t.Errorf("valid = %v", body["valid"])
	}
	if !strings.Contains(body["message"].(string), "systemd-analyze") {
		t.Errorf("message = %v", body["message"])
	}
}

func TestValidateConfig_TempCreateFailure(t *testing.T) {
	fake := &fakeConfig{
		validateFn: func(content string) (*systemd.ValidateResult, error) {
			return nil, errors.New("無法建立暫存檔進行驗證。請檢查 /tmp 目錄空間與權限。")
		},
	}
	_, router := newConfigTestHandler(t, fake, nil)
	cookie := loginCookie(t, router)
	w := doConfigReq(t, router, http.MethodPost, "/api/v1/services/nginx.service/config/validate", `{"config":"x"}`, cookie)
	body := assertJSON(t, w, http.StatusInternalServerError)
	if !strings.Contains(body["error"].(string), "無法建立暫存檔") {
		t.Errorf("error = %v", body["error"])
	}
}

func TestValidateConfig_BadJSON(t *testing.T) {
	_, router := newConfigTestHandler(t, nil, nil)
	cookie := loginCookie(t, router)
	w := doConfigReq(t, router, http.MethodPost, "/api/v1/services/nginx.service/config/validate", `{bad`, cookie)
	body := assertJSON(t, w, http.StatusBadRequest)
	if body["error"] != "invalid request body" {
		t.Errorf("error = %v", body["error"])
	}
}

func TestValidateConfig_Unauthorized(t *testing.T) {
	_, router := newConfigTestHandler(t, nil, nil)
	w := doConfigReq(t, router, http.MethodPost, "/api/v1/services/nginx.service/config/validate", `{"config":"x"}`, nil)
	assertJSON(t, w, http.StatusUnauthorized)
}

// ============================================================
//  Audit 整合（HDL-27~30）
// ============================================================

func TestGetConfig_WritesConfigViewAudit(t *testing.T) {
	auditMod := newTestAuditModule(t)
	content := "[Unit]\nDescription=nginx\n"
	fake := &fakeConfig{
		paths: map[string]string{"nginx.service": "/etc/systemd/system/nginx.service"},
		readFn: func(name, path string) (*systemd.ServiceConfig, error) {
			return &systemd.ServiceConfig{
				Name: name, FragmentPath: path, Content: content,
				Size: int64(len(content)), Checksum: systemd.NewConfigStore().ComputeChecksum(content),
			}, nil
		},
	}
	_, router := newConfigTestHandler(t, fake, auditMod)
	cookie := loginCookie(t, router)
	doConfigReq(t, router, http.MethodGet, "/api/v1/services/nginx.service/config", "", cookie)

	entries := waitAudit(t, auditMod, 1)
	if entries[0].Action != audit.ActionConfigView {
		t.Errorf("action = %s, want config_view", entries[0].Action)
	}
	if entries[0].Target != "nginx.service" {
		t.Errorf("target = %s", entries[0].Target)
	}
	if entries[0].Username != "admin" {
		t.Errorf("username = %s", entries[0].Username)
	}
}

func TestGetConfig_LockedServiceWritesViewAudit(t *testing.T) {
	auditMod := newTestAuditModule(t)
	content := "[Unit]\nDescription=journald\n"
	fake := &fakeConfig{
		paths: map[string]string{"systemd-journald.service": "/usr/lib/systemd/system/systemd-journald.service"},
		readFn: func(name, path string) (*systemd.ServiceConfig, error) {
			return &systemd.ServiceConfig{
				Name: name, FragmentPath: path, Content: content,
				Size: int64(len(content)), Checksum: systemd.NewConfigStore().ComputeChecksum(content),
			}, nil
		},
	}
	_, router := newConfigTestHandler(t, fake, auditMod)
	cookie := loginCookie(t, router)
	doConfigReq(t, router, http.MethodGet, "/api/v1/services/systemd-journald.service/config", "", cookie)

	entries := waitAudit(t, auditMod, 1)
	if entries[0].Action != audit.ActionConfigView {
		t.Errorf("action = %s, want config_view (readonly view also audited)", entries[0].Action)
	}
}

// ============================================================
//  未登入三端點（401）額外驗證 — body 型別檢查
// ============================================================

func TestConfigEndpoints_UseCamelCase(t *testing.T) {
	// 驗證回應 JSON 欄位為 camelCase（D-7）
	var resp struct {
		Name         string `json:"name"`
		FragmentPath string `json:"fragmentPath"`
		Config       string `json:"config"`
		Size         int64  `json:"size"`
		Checksum     string `json:"checksum"`
	}
	dir := t.TempDir()
	path := filepath.Join(dir, "nginx.service")
	if err := os.WriteFile(path, []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	fake := &fakeConfig{real: systemd.NewConfigStore(), paths: map[string]string{"nginx.service": path}}
	_, router := newConfigTestHandler(t, fake, nil)
	cookie := loginCookie(t, router)
	w := doConfigReq(t, router, http.MethodGet, "/api/v1/services/nginx.service/config", "", cookie)
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("response not parseable with camelCase struct: %v — %s", err, w.Body.String())
	}
	if resp.FragmentPath == "" {
		t.Error("fragmentPath field missing (camelCase required)")
	}
	if resp.Checksum == "" {
		t.Error("checksum field missing")
	}
}
