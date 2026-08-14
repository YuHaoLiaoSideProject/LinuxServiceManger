package handler

// config_handler.go — GET / PUT /api/v1/services/{name}/config + POST .../config/validate
// （docs/development/012-service-config-editor.md §1.5 / §3 API 合約）

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"

	"github.com/go-chi/chi/v5"

	"linux-service-manager/internal/audit"
	"linux-service-manager/internal/auth"
	"linux-service-manager/internal/systemd"
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
	BackupPath string `json:"backupPath"`
}

// conflictResponse 是 PUT 409 的回應體（含現行 checksum 供前端重新載入更新基準）。
type conflictResponse struct {
	Error           string `json:"error"`
	CurrentChecksum string `json:"currentChecksum"`
}

// ============================================================
//  GET /api/v1/services/{name}/config
// ============================================================

// HandleGetServiceConfig 讀取服務 FragmentPath 內容（唯讀檢視，鎖定服務亦可讀，依決策 D-2）。
// @Summary 取得服務設定檔
// @Description 讀取指定服務的 systemd unit 設定檔內容（含 SHA-256 checksum 供後續 PUT baseChecksum）。鎖定服務亦可唯讀檢視。`read` scope Token 可用。
// @Tags Service Config
// @Produce json
// @Security BearerAuth
// @Param name path string true "服務名稱（systemd unit name）"
// @Success 200 {object} ServiceConfigResponse
// @Failure 400 {object} messageJSON "服務名稱無效"
// @Failure 401 {object} messageJSON "未驗證"
// @Failure 404 {object} messageJSON "設定檔路徑或檔案不存在"
// @Failure 413 {object} messageJSON "設定檔過大"
// @Failure 500 {object} messageJSON "讀取失敗"
// @Router /services/{name}/config [get]
func (h *Handler) HandleGetServiceConfig(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	if err := systemd.ValidateServiceName(name); err != nil {
		writeJSON(w, http.StatusBadRequest, messageJSON{Error: "invalid service name"})
		return
	}

	path, err := h.Config.FragmentPathOf(name) // systemctl show（信任來源）
	if err != nil || path == "" {
		writeJSON(w, http.StatusNotFound, messageJSON{Error: "設定檔路徑不存在"})
		return
	}
	// 註：GET 不檢查路徑邊界（鎖定服務 / /usr/lib 亦允許唯讀檢視，決策 D-2）
	cfg, err := h.Config.ReadConfig(name, path)
	switch {
	case errors.Is(err, systemd.ErrConfigNotFound):
		writeJSON(w, http.StatusNotFound, messageJSON{Error: "設定檔不存在: " + path})
		return
	case errors.Is(err, systemd.ErrConfigTooLarge):
		writeJSON(w, http.StatusRequestEntityTooLarge, messageJSON{Error: err.Error()})
		return
	case err != nil:
		// 權限不足等讀取失敗 → 500，錯誤訊息保留底層原因
		log.Printf("ERROR reading config %s: %v", name, err)
		writeJSON(w, http.StatusInternalServerError, messageJSON{Error: "無法讀取設定檔：" + err.Error()})
		return
	}

	// Audit: config_view（鎖定服務唯讀檢視亦記錄）
	h.writeConfigAudit(r, audit.ActionConfigView, name, audit.ResultSuccess, cfg.FragmentPath)

	writeJSON(w, http.StatusOK, ServiceConfigResponse{
		Name:         cfg.Name,
		FragmentPath: cfg.FragmentPath,
		Config:       cfg.Content,
		Size:         cfg.Size,
		Checksum:     cfg.Checksum,
	})
}

// ============================================================
//  PUT /api/v1/services/{name}/config
// ============================================================

// HandleSaveServiceConfig 儲存設定檔：路徑驗證 → 衝突檢查 → 備份 → atomic write → daemon-reload → audit。
// @Summary 儲存服務設定檔
// @Description 覆寫指定服務的設定檔並執行 daemon-reload。需帶 GET 取得的 `baseChecksum` 做並發衝突偵測；衝突時回 409 與 `currentChecksum`。需 `full` scope Token。\n\n**半成功**：設定檔已寫入但 daemon-reload 失敗時回 500，附 `backupPath` 供手動還原。
// @Tags Service Config
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param name path string true "服務名稱（systemd unit name）"
// @Param body body SaveConfigRequest true "新設定檔內容與 baseChecksum"
// @Success 200 {object} SaveConfigResponse
// @Failure 400 {object} messageJSON "請求無效或缺 base_checksum"
// @Failure 401 {object} messageJSON "未驗證"
// @Failure 403 {object} messageJSON "唯讀 Token 或路徑不可寫"
// @Failure 404 {object} messageJSON "設定檔路徑不存在"
// @Failure 409 {object} conflictResponse "並發衝突（含 currentChecksum）"
// @Failure 413 {object} messageJSON "設定檔超過 500KB"
// @Failure 500 {object} map[string]interface{} "寫入/daemon-reload 失敗（含 backupPath）"
// @Router /services/{name}/config [put]
func (h *Handler) HandleSaveServiceConfig(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	if err := systemd.ValidateServiceName(name); err != nil {
		writeJSON(w, http.StatusBadRequest, messageJSON{Error: "invalid service name"})
		return
	}

	// 1. FragmentPath（信任來源 systemd）
	path, err := h.Config.FragmentPathOf(name)
	if err != nil || path == "" {
		writeJSON(w, http.StatusNotFound, messageJSON{Error: "設定檔路徑不存在"})
		return
	}

	// 2. 寫入權威驗證鏈（決策 5）：Clean+Rel 邊界 + .service 副檔名 + symlink 解析
	if err := h.Config.ValidateWritablePath(path); err != nil {
		if errors.Is(err, systemd.ErrExtNotService) {
			writeJSON(w, http.StatusForbidden, messageJSON{Error: "僅支援 .service 設定檔"})
			return
		}
		writeJSON(w, http.StatusForbidden, messageJSON{Error: "不允許編輯此服務設定檔"})
		return
	}

	// 3. 解碼 body；大小限制
	var req SaveConfigRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, messageJSON{Error: "invalid request body"})
		return
	}
	if len(req.Config) > systemd.MaxConfigSize {
		writeJSON(w, http.StatusRequestEntityTooLarge, messageJSON{Error: "設定檔超過 500KB 大小限制"})
		return
	}

	// 4. 並發衝突偵測（決策 4）：409 + currentChecksum；缺省 base → 400
	if err := h.Config.CheckConflict(path, req.BaseChecksum); err != nil {
		var cur systemd.ErrConflictCurrent
		if errors.As(err, &cur) {
			writeJSON(w, http.StatusConflict, conflictResponse{Error: err.Error(), CurrentChecksum: cur.Current})
			return
		}
		if errors.Is(err, systemd.ErrConflictMissingBase) || errors.Is(err, systemd.ErrInvalidChecksum) {
			writeJSON(w, http.StatusBadRequest, messageJSON{Error: "base_checksum is required"})
			return
		}
		log.Printf("ERROR conflict check %s: %v", name, err)
		writeJSON(w, http.StatusInternalServerError, messageJSON{Error: "衝突檢查失敗"})
		return
	}

	// 5. 備份（copy）+ prune 保留 5 份
	backupPath, err := h.Config.Backup(path)
	if err != nil {
		log.Printf("ERROR backup %s: %v", name, err)
		writeJSON(w, http.StatusInternalServerError, messageJSON{Error: "建立備份失敗"})
		return
	}
	if err := h.Config.PruneBackups(path, systemd.BackupKeepCount); err != nil {
		log.Printf("WARN prune backups %s: %v", name, err) // prune 失敗僅記錄（非阻斷）
	}

	// 6. atomic write — 失敗 → 還原備份 → 500「寫入失敗」（決策 D-5）
	if err := h.Config.AtomicWrite(path, req.Config); err != nil {
		if backupPath != "" {
			if rbErr := h.Config.Restore(backupPath, path); rbErr != nil {
				log.Printf("ERROR restore backup %s → %s: %v", backupPath, path, rbErr)
			}
		}
		h.writeConfigAudit(r, audit.ActionConfigSave, name, audit.ResultFailure, "寫入失敗")
		writeJSON(w, http.StatusInternalServerError, map[string]interface{}{
			"error":      "寫入失敗",
			"backupPath": backupPath,
		})
		return
	}

	// 7. daemon-reload — 失敗「不還原」（決策 D-4），回 500 + backupPath（半成功）
	ctx, cancel := context.WithTimeout(r.Context(), systemd.DaemonReloadTimeout)
	defer cancel()
	if err := h.Config.DaemonReload(ctx); err != nil {
		detail := fmt.Sprintf("設定檔已寫入，daemon-reload 失敗: %v; backup=%s", err, backupPath)
		h.writeConfigAudit(r, audit.ActionConfigSave, name, audit.ResultSuccess, detail) // 半成功，audit result=success
		writeJSON(w, http.StatusInternalServerError, map[string]interface{}{
			"error":      "設定檔已儲存，但 daemon-reload 失敗: " + err.Error() + "。請手動執行 systemctl daemon-reload。備份檔：" + backupPath,
			"backupPath": backupPath,
		})
		return
	}

	// 8. 成功 + audit
	h.writeConfigAudit(r, audit.ActionConfigSave, name, audit.ResultSuccess, backupPath)
	writeJSON(w, http.StatusOK, SaveConfigResponse{
		Message:    name + " 設定檔已儲存，daemon-reload 已執行",
		BackupPath: backupPath,
	})
}

// ============================================================
//  POST /api/v1/services/{name}/config/validate
// ============================================================

// HandleValidateServiceConfig 以 systemd-analyze verify 驗證 body 內容。
// @Summary 驗證服務設定檔
// @Description 以 `systemd-analyze verify` 驗證設定內容（不寫入）。systemd-analyze 不存在時回 200 `{valid:false, available:false}`。`read` scope Token 可用。
// @Tags Service Config
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param name path string true "服務名稱（systemd unit name）"
// @Param body body object true "{\"config\": \"<unit file 內容>\"}"
// @Success 200 {object} systemd.ValidateResult
// @Failure 400 {object} messageJSON "服務名稱無效或請求無效"
// @Failure 401 {object} messageJSON "未驗證"
// @Failure 500 {object} messageJSON "無法建立暫存檔"
// @Router /services/{name}/config/validate [post]
func (h *Handler) HandleValidateServiceConfig(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	if err := systemd.ValidateServiceName(name); err != nil {
		writeJSON(w, http.StatusBadRequest, messageJSON{Error: "invalid service name"})
		return
	}

	var req struct {
		Config string `json:"config"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, messageJSON{Error: "invalid request body"})
		return
	}

	result, err := h.Config.ValidateConfig(req.Config)
	if err != nil {
		// 暫存檔建立失敗等 → 500（訊息提示檢查 /tmp 空間與權限）
		log.Printf("ERROR validating config %s: %v", name, err)
		writeJSON(w, http.StatusInternalServerError, messageJSON{Error: "無法建立暫存檔進行驗證。請檢查 /tmp 目錄空間與權限。"})
		return
	}
	writeJSON(w, http.StatusOK, result)
}

// writeConfigAudit 共用 audit 寫入（操作者/IP 取自 request）。
func (h *Handler) writeConfigAudit(r *http.Request, action audit.Action, name string, result audit.Result, detail string) {
	if h.Audit == nil {
		return
	}
	username, _ := auth.GetSession(r).Values["username"].(string)
	entry, err := audit.NewEntry(username, audit.ExtractClientIP(r), action, name, result, detail)
	if err != nil {
		log.Printf("ERROR audit entry: %v", err)
		return
	}
	h.Audit.Write(entry)
}
