package handler

// notify_handler.go — 7 個 notify REST endpoint（docs/development/013-webhook-notification.md §1.9 / §3 API 合約）

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"regexp"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"

	"linux-service-manager/internal/audit"
	"linux-service-manager/internal/auth"
	"linux-service-manager/internal/notify"
	"linux-service-manager/internal/systemd"
)

// ============================================================
//  Request/Response 型別
// ============================================================

// ChannelPayload 是 POST/PUT /channels 的請求體。
type ChannelPayload struct {
	Type        notify.ChannelType `json:"type"`
	Name        string             `json:"name"`
	URL         string             `json:"url"`
	Token       string             `json:"token"`
	ChatID      string             `json:"chat_id"`
	SubChatID   string             `json:"sub_chat_id"`
	Method      string             `json:"method"`
	Headers     map[string]string  `json:"headers"`
	Events      []string           `json:"events"`
	AllServices bool               `json:"all_services"`
	Services    []string           `json:"services"`
}

// PatchEnabledPayload 是 PATCH /channels/{id} 的請求體。
type PatchEnabledPayload struct {
	Enabled *bool `json:"enabled"`
}

// TestResponse 是 POST /channels/{id}/test 的回應體。
type TestResponse struct {
	Success bool   `json:"success"`
	Message string `json:"message,omitempty"`
	Error   string `json:"error,omitempty"`
	Detail  string `json:"detail,omitempty"`
}

var telegramTokenRe = regexp.MustCompile(`^\d+:[A-Za-z0-9_-]{30,}$`)
var telegramSubChatIDRe = regexp.MustCompile(`^\d+$`)

// ============================================================
//  GET /api/v1/notify/channels
// ============================================================

// HandleListChannels 回傳所有 channel（masked token、無 failures）。
func (h *Handler) HandleListChannels(w http.ResponseWriter, r *http.Request) {
	if h.Notify == nil {
		writeJSON(w, http.StatusInternalServerError, messageJSON{Error: "notify not configured"})
		return
	}
	channels := h.Notify.ListChannels()
	out := make([]*notify.Channel, 0, len(channels))
	for _, ch := range channels {
		out = append(out, maskChannel(ch))
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"data": out})
}

// ============================================================
//  POST /api/v1/notify/channels
// ============================================================

// HandleCreateChannel 建立 channel。
func (h *Handler) HandleCreateChannel(w http.ResponseWriter, r *http.Request) {
	if h.Notify == nil {
		writeJSON(w, http.StatusInternalServerError, messageJSON{Error: "notify not configured"})
		return
	}

	var p ChannelPayload
	if err := json.NewDecoder(r.Body).Decode(&p); err != nil {
		writeJSON(w, http.StatusBadRequest, messageJSON{Error: "invalid request body"})
		return
	}
	if msg := validateChannelPayload(&p); msg != "" {
		writeJSON(w, http.StatusBadRequest, messageJSON{Error: msg})
		return
	}
	if h.Notify.CountChannels() >= notify.MaxChannels {
		writeJSON(w, http.StatusConflict, messageJSON{Error: "已達 Channel 數量上限（20）"})
		return
	}

	ch := buildChannelFromPayload(&p, nil)
	created, err := h.Notify.CreateChannel(ch)
	if err != nil {
		if errors.Is(err, notify.ErrChannelLimit) {
			writeJSON(w, http.StatusConflict, messageJSON{Error: "已達 Channel 數量上限（20）"})
			return
		}
		log.Printf("ERROR creating channel: %v", err)
		writeJSON(w, http.StatusInternalServerError, messageJSON{Error: err.Error()})
		return
	}

	h.writeNotifyAudit(r, audit.ActionNotifyCreate, created.Name, audit.ResultSuccess, "")
	writeJSON(w, http.StatusCreated, map[string]interface{}{"data": maskChannel(created)})
}

// ============================================================
//  PUT /api/v1/notify/channels/{id}
// ============================================================

// HandleUpdateChannel 覆寫更新 channel 設定。
func (h *Handler) HandleUpdateChannel(w http.ResponseWriter, r *http.Request) {
	if h.Notify == nil {
		writeJSON(w, http.StatusInternalServerError, messageJSON{Error: "notify not configured"})
		return
	}

	id := chi.URLParam(r, "id")
	existing := h.Notify.GetChannel(id)
	if existing == nil {
		writeJSON(w, http.StatusNotFound, messageJSON{Error: "Channel 不存在"})
		return
	}

	var p ChannelPayload
	if err := json.NewDecoder(r.Body).Decode(&p); err != nil {
		writeJSON(w, http.StatusBadRequest, messageJSON{Error: "invalid request body"})
		return
	}
	// telegram token 留空或為 masked（'****' 前綴）= 保留原值（編輯不回傳 token）
	if p.Type == notify.ChannelTypeTelegram && existing.Type == notify.ChannelTypeTelegram {
		if p.Token == "" || strings.HasPrefix(p.Token, "****") {
			p.Token = existing.Token
		}
	}
	if msg := validateChannelPayload(&p); msg != "" {
		writeJSON(w, http.StatusBadRequest, messageJSON{Error: msg})
		return
	}

	ch := buildChannelFromPayload(&p, existing)
	updated, err := h.Notify.UpdateChannel(ch)
	if err != nil {
		if errors.Is(err, notify.ErrChannelNotFound) {
			writeJSON(w, http.StatusNotFound, messageJSON{Error: "Channel 不存在"})
			return
		}
		log.Printf("ERROR updating channel: %v", err)
		writeJSON(w, http.StatusInternalServerError, messageJSON{Error: err.Error()})
		return
	}

	h.writeNotifyAudit(r, audit.ActionNotifyUpdate, updated.Name, audit.ResultSuccess, "")
	writeJSON(w, http.StatusOK, map[string]interface{}{"data": maskChannel(updated)})
}

// ============================================================
//  DELETE /api/v1/notify/channels/{id}
// ============================================================

// HandleDeleteChannel 刪除 channel（關聯發送紀錄保留）。
func (h *Handler) HandleDeleteChannel(w http.ResponseWriter, r *http.Request) {
	if h.Notify == nil {
		writeJSON(w, http.StatusInternalServerError, messageJSON{Error: "notify not configured"})
		return
	}

	id := chi.URLParam(r, "id")
	existing := h.Notify.GetChannel(id)
	if existing == nil {
		writeJSON(w, http.StatusNotFound, messageJSON{Error: "Channel 不存在"})
		return
	}

	if err := h.Notify.DeleteChannel(id); err != nil {
		log.Printf("ERROR deleting channel: %v", err)
		writeJSON(w, http.StatusInternalServerError, messageJSON{Error: err.Error()})
		return
	}

	h.writeNotifyAudit(r, audit.ActionNotifyDelete, existing.Name, audit.ResultSuccess, "")
	writeJSON(w, http.StatusOK, messageJSON{Message: "Channel 已刪除"})
}

// ============================================================
//  PATCH /api/v1/notify/channels/{id}
// ============================================================

// HandlePatchChannelEnabled 更新 enabled（toggle）。
func (h *Handler) HandlePatchChannelEnabled(w http.ResponseWriter, r *http.Request) {
	if h.Notify == nil {
		writeJSON(w, http.StatusInternalServerError, messageJSON{Error: "notify not configured"})
		return
	}

	id := chi.URLParam(r, "id")
	var p PatchEnabledPayload
	if err := json.NewDecoder(r.Body).Decode(&p); err != nil || p.Enabled == nil {
		writeJSON(w, http.StatusBadRequest, messageJSON{Error: "invalid request body"})
		return
	}

	ch, err := h.Notify.SetChannelEnabled(id, *p.Enabled)
	if err != nil {
		if errors.Is(err, notify.ErrChannelNotFound) {
			writeJSON(w, http.StatusNotFound, messageJSON{Error: "Channel 不存在"})
			return
		}
		log.Printf("ERROR patching channel: %v", err)
		writeJSON(w, http.StatusInternalServerError, messageJSON{Error: err.Error()})
		return
	}

	h.writeNotifyAudit(r, audit.ActionNotifyToggle, ch.Name, audit.ResultSuccess, "")
	writeJSON(w, http.StatusOK, map[string]interface{}{"data": maskChannel(ch)})
}

// ============================================================
//  POST /api/v1/notify/channels/{id}/test
// ============================================================

// HandleTestChannel 發送測試訊息（不寫 history、不累計 failures；成功歸零）。
func (h *Handler) HandleTestChannel(w http.ResponseWriter, r *http.Request) {
	if h.Notify == nil {
		writeJSON(w, http.StatusInternalServerError, messageJSON{Error: "notify not configured"})
		return
	}

	id := chi.URLParam(r, "id")
	ch := h.Notify.GetChannel(id)
	if ch == nil {
		writeJSON(w, http.StatusNotFound, messageJSON{Error: "Channel 不存在"})
		return
	}

	ok, detail := h.Notify.TestChannel(ch)
	if ok {
		h.writeNotifyAudit(r, audit.ActionNotifyTest, ch.Name, audit.ResultSuccess, "")
		writeJSON(w, http.StatusOK, TestResponse{Success: true, Message: "測試通知已發送"})
		return
	}
	h.writeNotifyAudit(r, audit.ActionNotifyTest, ch.Name, audit.ResultFailure, detail)
	writeJSON(w, http.StatusBadGateway, TestResponse{Success: false, Error: detail})
}

// ============================================================
//  GET /api/v1/notify/history
// ============================================================

// HandleNotifyHistory 查詢發送紀錄（分頁 + channel + 結果篩選）。
func (h *Handler) HandleNotifyHistory(w http.ResponseWriter, r *http.Request) {
	if h.Notify == nil {
		writeJSON(w, http.StatusInternalServerError, messageJSON{Error: "notify not configured"})
		return
	}

	q := r.URL.Query()

	page := 1
	if v := q.Get("page"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 1 {
			writeJSON(w, http.StatusBadRequest, messageJSON{Error: "page 必須 ≥ 1"})
			return
		}
		page = n
	}

	limit := 30
	if v := q.Get("limit"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 1 || n > 100 {
			writeJSON(w, http.StatusBadRequest, messageJSON{Error: "limit 必須介於 1 至 100"})
			return
		}
		limit = n
	}

	status := q.Get("status")
	if status != "" && status != "all" && status != "success" && status != "failure" {
		writeJSON(w, http.StatusBadRequest, messageJSON{Error: "無效的 status"})
		return
	}

	res, err := h.Notify.QueryHistory(notify.HistoryQuery{
		Page:      page,
		Limit:     limit,
		ChannelID: q.Get("channel_id"),
		Status:    status,
	})
	if err != nil {
		log.Printf("ERROR querying history: %v", err)
		writeJSON(w, http.StatusInternalServerError, messageJSON{Error: err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, res)
}

// ============================================================
//  驗證與輔助函式
// ============================================================

// validateChannelPayload 驗證 ChannelPayload，回傳第一個錯誤訊息（空字串 = 合法）。
func validateChannelPayload(p *ChannelPayload) string {
	if strings.TrimSpace(p.Name) == "" {
		return "名稱為必填"
	}
	if len([]rune(p.Name)) > 64 {
		return "名稱不可超過 64 字元"
	}

	switch p.Type {
	case notify.ChannelTypeSlack, notify.ChannelTypeDiscord, notify.ChannelTypeTelegram, notify.ChannelTypeCustom:
	default:
		return "無效的 Channel 類型"
	}

	if p.Type != notify.ChannelTypeTelegram {
		if p.URL == "" {
			return "Webhook URL 為必填"
		}
		if !strings.HasPrefix(p.URL, "https://") {
			return "URL 必須為 https://"
		}
	} else {
		if p.Token == "" {
			return "Telegram Bot Token 為必填"
		}
		if !telegramTokenRe.MatchString(p.Token) {
			return "Telegram Bot Token 格式無效"
		}
		if strings.TrimSpace(p.ChatID) == "" {
			return "Telegram Chat ID 為必填"
		}
		if p.SubChatID != "" && !telegramSubChatIDRe.MatchString(p.SubChatID) {
			return "Telegram 子 Chat ID 必須為正整數"
		}
	}

	if len(p.Events) == 0 {
		return "至少需勾選一個觸發事件"
	}
	for _, e := range p.Events {
		valid := false
		for _, k := range notify.AllEventKinds {
			if e == string(k) {
				valid = true
				break
			}
		}
		if !valid {
			return "無效的觸發事件: " + e
		}
	}

	for _, svc := range p.Services {
		if err := systemd.ValidateServiceName(svc); err != nil {
			return "無效的服務名稱: " + svc
		}
	}

	if len(p.Headers) > notify.MaxCustomHeaders {
		return "自訂 Headers 最多 10 組"
	}
	for k := range p.Headers {
		if notify.IsBlacklistedHeader(k) {
			return "不可使用保留 Header: " + k
		}
	}
	for k, v := range p.Headers {
		if strings.Contains(k, "\r") || strings.Contains(k, "\n") ||
			strings.Contains(v, "\r") || strings.Contains(v, "\n") {
			return "Header 不可包含換行字元"
		}
	}

	return ""
}

// buildChannelFromPayload 將 payload 轉為 Channel；existing 非 nil 時保留 ID/created_at/enabled。
func buildChannelFromPayload(p *ChannelPayload, existing *notify.Channel) *notify.Channel {
	ch := &notify.Channel{
		Type:        p.Type,
		Name:        p.Name,
		URL:         p.URL,
		Token:       p.Token,
		ChatID:      p.ChatID,
		SubChatID:   p.SubChatID,
		Method:      p.Method,
		Headers:     p.Headers,
		Events:      p.Events,
		AllServices: p.AllServices,
		Services:    p.Services,
		Enabled:     true,
	}
	if existing != nil {
		ch.ID = existing.ID
		ch.Enabled = existing.Enabled
		ch.CreatedAt = existing.CreatedAt
	}
	if ch.Type == notify.ChannelTypeCustom && ch.Method == "" {
		ch.Method = "POST"
	}
	return ch
}

// maskChannel 回傳 API 安全的 channel（Telegram token masked）。
func maskChannel(ch *notify.Channel) *notify.Channel {
	c := *ch
	if c.Type == notify.ChannelTypeTelegram && c.Token != "" {
		c.Token = maskToken(c.Token)
	}
	return &c
}

// maskToken 將 token 遮罩為 "****" + 後 4 碼（決策 10）。
func maskToken(token string) string {
	if len(token) <= 4 {
		return "****"
	}
	return "****" + token[len(token)-4:]
}

// writeNotifyAudit 共用 audit 寫入。
func (h *Handler) writeNotifyAudit(r *http.Request, action audit.Action, target string, result audit.Result, detail string) {
	if h.Audit == nil {
		return
	}
	username, _ := auth.GetSession(r).Values["username"].(string)
	entry, err := audit.NewEntry(username, audit.ExtractClientIP(r), action, target, result, detail)
	if err != nil {
		log.Printf("ERROR audit entry: %v", err)
		return
	}
	h.Audit.Write(entry)
}
