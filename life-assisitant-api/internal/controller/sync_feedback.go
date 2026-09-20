package controller

import (
	"github.com/gogf/gf/v2/net/ghttp"

	"github.com/life-assistant/api/internal/consts/ecode"
	"github.com/life-assistant/api/internal/model/dto"
	"github.com/life-assistant/api/internal/response"
	"github.com/life-assistant/api/internal/service"
)

// FeedbackController 反馈控制器
type FeedbackController struct{}

var Feedback = &FeedbackController{}

// Create POST /api/v1/feedback
func (c *FeedbackController) Create(r *ghttp.Request) {
	uid := r.GetCtxVar("user_id").String()
	if uid == "" {
		response.Error(r, ecode.AuthTokenMissing)
		return
	}
	var req dto.CreateFeedbackReq
	if err := r.Parse(&req); err != nil {
		response.Error(r, ecode.ValidationFailed, err)
		return
	}
	out, err := service.Feedback().Create(r.Context(), uid, &req)
	if err != nil {
		writeError(r, err)
		return
	}
	response.Created(r, out)
}

// SyncController 同步控制器
type SyncController struct{}

var Sync = &SyncController{}

// Status GET /api/v1/sync/status
func (c *SyncController) Status(r *ghttp.Request) {
	uid := r.GetCtxVar("user_id").String()
	if uid == "" {
		response.Error(r, ecode.AuthTokenMissing)
		return
	}
	out, err := service.Sync().GetStatus(r.Context(), uid)
	if err != nil {
		writeError(r, err)
		return
	}
	response.Success(r, out)
}

// Trigger POST /api/v1/sync
func (c *SyncController) Trigger(r *ghttp.Request) {
	uid := r.GetCtxVar("user_id").String()
	if uid == "" {
		response.Error(r, ecode.AuthTokenMissing)
		return
	}
	out, err := service.Sync().TriggerSync(r.Context(), uid)
	if err != nil {
		writeError(r, err)
		return
	}
	response.Success(r, out)
}
