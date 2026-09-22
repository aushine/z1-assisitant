// Package controller 记账分类控制器
// 规范：controller 只做参数解析 + 调 service + 返回响应
package controller

import (
	"github.com/gogf/gf/v2/net/ghttp"

	"github.com/life-assistant/api/internal/consts/ecode"
	"github.com/life-assistant/api/internal/model/dto"
	"github.com/life-assistant/api/internal/response"
	"github.com/life-assistant/api/internal/service"
)

// FinanceCategoryController 记账分类控制器
type FinanceCategoryController struct{}

var FinanceCategory = &FinanceCategoryController{}

// List GET /finance/categories?scope=expense|income
// ⚠️ 首次请求会自动播种内置分类
func (c *FinanceCategoryController) List(r *ghttp.Request) {
	out, err := service.FinanceCategory().List(r.Context(), r.Get("scope").String())
	if err != nil {
		writeError(r, err)
		return
	}
	response.Success(r, out)
}

// Create POST /finance/categories
func (c *FinanceCategoryController) Create(r *ghttp.Request) {
	var req dto.CreateFinanceCategoryReq
	if err := r.Parse(&req); err != nil {
		response.Error(r, ecode.ValidationFailed, err)
		return
	}
	out, err := service.FinanceCategory().Create(r.Context(), &req)
	if err != nil {
		writeError(r, err)
		return
	}
	response.Created(r, dto.FinanceCategoryItemResp{Item: *out})
}

// Update PATCH /finance/categories/:id
func (c *FinanceCategoryController) Update(r *ghttp.Request) {
	id := r.Get("id").String()
	if id == "" {
		response.Error(r, ecode.MissingRequiredField)
		return
	}
	var req dto.UpdateFinanceCategoryReq
	if err := r.Parse(&req); err != nil {
		response.Error(r, ecode.ValidationFailed, err)
		return
	}
	out, err := service.FinanceCategory().Update(r.Context(), id, &req)
	if err != nil {
		writeError(r, err)
		return
	}
	response.Success(r, dto.FinanceCategoryItemResp{Item: *out})
}

// Delete DELETE /finance/categories/:id
func (c *FinanceCategoryController) Delete(r *ghttp.Request) {
	id := r.Get("id").String()
	if id == "" {
		response.Error(r, ecode.MissingRequiredField)
		return
	}
	if err := service.FinanceCategory().Delete(r.Context(), id); err != nil {
		writeError(r, err)
		return
	}
	response.NoContent(r)
}
