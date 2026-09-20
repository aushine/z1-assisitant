package controller

import (
	"github.com/gogf/gf/v2/net/ghttp"

	"github.com/life-assistant/api/internal/consts/ecode"
	"github.com/life-assistant/api/internal/model/dto"
	"github.com/life-assistant/api/internal/response"
	"github.com/life-assistant/api/internal/service"
)

// NotificationController 通知控制器
type NotificationController struct{}

var Notification = &NotificationController{}

// List GET /api/v1/notifications
func (c *NotificationController) List(r *ghttp.Request) {
	var req dto.ListNotificationsReq
	if err := r.Parse(&req); err != nil {
		response.Error(r, ecode.ValidationFailed, err)
		return
	}
	out, err := service.Notification().List(r.Context(), &req)
	if err != nil {
		writeError(r, err)
		return
	}
	page := req.Page
	if page <= 0 {
		page = 1
	}
	pageSize := req.PageSize
	if pageSize <= 0 {
		pageSize = 20
	}
	response.Page(r, out.Items, out.Total, page, pageSize)
}

// UnreadCount GET /api/v1/notifications/unread-count
func (c *NotificationController) UnreadCount(r *ghttp.Request) {
	uid := r.GetCtxVar("user_id").String()
	if uid == "" {
		response.Error(r, ecode.AuthTokenMissing)
		return
	}
	out, err := service.Notification().UnreadCount(r.Context())
	if err != nil {
		writeError(r, err)
		return
	}
	response.Success(r, out)
}

// MarkRead POST /api/v1/notifications/mark-read
func (c *NotificationController) MarkRead(r *ghttp.Request) {
	uid := r.GetCtxVar("user_id").String()
	if uid == "" {
		response.Error(r, ecode.AuthTokenMissing)
		return
	}
	out, err := service.Notification().MarkRead(r.Context())
	if err != nil {
		writeError(r, err)
		return
	}
	response.Success(r, out)
}

// MarkReadByID POST /api/v1/notifications/:id/read
func (c *NotificationController) MarkReadByID(r *ghttp.Request) {
	id := r.Get("id").String()
	if id == "" {
		response.Error(r, ecode.MissingRequiredField)
		return
	}
	if err := service.Notification().MarkReadByID(r.Context(), id); err != nil {
		writeError(r, err)
		return
	}
	response.Success(r, map[string]any{"affected": 1})
}
