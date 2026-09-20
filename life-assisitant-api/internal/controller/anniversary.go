// Package controller 纪念日 / 倒数日控制器
// controller 只做参数解析 + 调 service + 返回响应；业务校验在 service 层完成。
// 路由由 router.go 挂载（anniversary:view / anniversary:write）。
package controller

import (
	"github.com/gogf/gf/v2/net/ghttp"

	"github.com/life-assistant/api/internal/consts/ecode"
	"github.com/life-assistant/api/internal/model/dto"
	"github.com/life-assistant/api/internal/response"
	"github.com/life-assistant/api/internal/service"
)

// AnniversaryController 纪念日 / 倒数日控制器
type AnniversaryController struct{}

// Anniversary 控制器单例
var Anniversary = &AnniversaryController{}

// List GET /api/v1/anniversaries?scope=upcoming|month|all
func (c *AnniversaryController) List(r *ghttp.Request) {
	var req dto.ListAnniversariesReq
	_ = r.Parse(&req) // scope / limit 可选
	out, err := service.Anniversary().List(r.Context(), &req)
	if err != nil {
		writeError(r, err)
		return
	}
	response.Success(r, out)
}

// Upcoming GET /api/v1/anniversaries/upcoming?limit=3
func (c *AnniversaryController) Upcoming(r *ghttp.Request) {
	var req dto.UpcomingAnniversariesReq
	_ = r.Parse(&req) // limit 可选
	out, err := service.Anniversary().Upcoming(r.Context(), &req)
	if err != nil {
		writeError(r, err)
		return
	}
	response.Success(r, out)
}

// Create POST /api/v1/anniversaries
func (c *AnniversaryController) Create(r *ghttp.Request) {
	var req dto.CreateAnniversaryReq
	if err := r.Parse(&req); err != nil {
		response.Error(r, ecode.ValidationFailed, err)
		return
	}
	out, err := service.Anniversary().Create(r.Context(), &req)
	if err != nil {
		writeError(r, err)
		return
	}
	response.Success(r, out)
}

// Patch PATCH /api/v1/anniversaries/:id（只改传了的字段）
func (c *AnniversaryController) Patch(r *ghttp.Request) {
	var req dto.PatchAnniversaryReq
	if err := r.Parse(&req); err != nil {
		response.Error(r, ecode.ValidationFailed, err)
		return
	}
	req.ID = r.Get("id").String()
	if req.ID == "" {
		response.Error(r, ecode.ValidationFailed)
		return
	}
	out, err := service.Anniversary().Patch(r.Context(), &req)
	if err != nil {
		writeError(r, err)
		return
	}
	response.Success(r, out)
}

// Delete DELETE /api/v1/anniversaries/:id（204，无响应体）
func (c *AnniversaryController) Delete(r *ghttp.Request) {
	id := r.Get("id").String()
	if err := service.Anniversary().Delete(r.Context(), id); err != nil {
		writeError(r, err)
		return
	}
	response.NoContent(r)
}
