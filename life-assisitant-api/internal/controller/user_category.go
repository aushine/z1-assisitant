// Package controller 习惯/待办分类控制器（20260922 新增，见 06 §3.3）
// 规范：controller 只做参数解析 + 调 service + 返回响应
package controller

import (
	"github.com/gogf/gf/v2/net/ghttp"

	"github.com/life-assistant/api/internal/consts/ecode"
	"github.com/life-assistant/api/internal/model/dto"
	"github.com/life-assistant/api/internal/response"
	"github.com/life-assistant/api/internal/service"
)

// UserCategoryController 习惯/待办分类控制器
type UserCategoryController struct{}

var UserCategory = &UserCategoryController{}

// List GET /user-categories?domain=habit|task
// ⚠️ 该 domain 首次请求会自动播种内置分类（4 / 6 条）
func (c *UserCategoryController) List(r *ghttp.Request) {
	out, err := service.UserCategory().List(r.Context(), r.Get("domain").String())
	if err != nil {
		writeError(r, err)
		return
	}
	response.Success(r, out)
}

// Create POST /user-categories
func (c *UserCategoryController) Create(r *ghttp.Request) {
	var req dto.CreateUserCategoryReq
	if err := r.Parse(&req); err != nil {
		response.Error(r, ecode.ValidationFailed, err)
		return
	}
	out, err := service.UserCategory().Create(r.Context(), &req)
	if err != nil {
		writeError(r, err)
		return
	}
	response.Created(r, dto.UserCategoryItemResp{Item: *out})
}

// Update PATCH /user-categories/:id
func (c *UserCategoryController) Update(r *ghttp.Request) {
	id := r.Get("id").String()
	if id == "" {
		response.Error(r, ecode.MissingRequiredField)
		return
	}
	var req dto.UpdateUserCategoryReq
	if err := r.Parse(&req); err != nil {
		response.Error(r, ecode.ValidationFailed, err)
		return
	}
	out, err := service.UserCategory().Update(r.Context(), id, &req)
	if err != nil {
		writeError(r, err)
		return
	}
	response.Success(r, dto.UserCategoryItemResp{Item: *out})
}

// Delete DELETE /user-categories/:id → 204（软删三件套）
func (c *UserCategoryController) Delete(r *ghttp.Request) {
	id := r.Get("id").String()
	if id == "" {
		response.Error(r, ecode.MissingRequiredField)
		return
	}
	if err := service.UserCategory().Delete(r.Context(), id); err != nil {
		writeError(r, err)
		return
	}
	response.NoContent(r)
}
