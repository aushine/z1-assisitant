// Package controller 习惯控制器
// 规范：controller 只做参数解析 + 调 service + 返回响应
// 业务校验在 service 层完成
package controller

import (
	"github.com/gogf/gf/v2/net/ghttp"

	"github.com/life-assistant/api/internal/consts/ecode"
	"github.com/life-assistant/api/internal/model/dto"
	"github.com/life-assistant/api/internal/response"
	"github.com/life-assistant/api/internal/service"
)

// HabitController 习惯控制器
type HabitController struct{}

var Habit = &HabitController{}

// List GET /api/v1/habits
// Query 参数：status / page / page_size
func (c *HabitController) List(r *ghttp.Request) {
	var req dto.ListHabitsReq
	if err := r.Parse(&req); err != nil {
		response.Error(r, ecode.ValidationFailed, err)
		return
	}
	out, err := service.Habit().List(r.Context(), &req)
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

// GetToday GET /api/v1/habits/today
func (c *HabitController) GetToday(r *ghttp.Request) {
	var req dto.GetTodayHabitsReq
	_ = r.Parse(&req) // 可选参数
	out, err := service.Habit().GetToday(r.Context(), &req)
	if err != nil {
		writeError(r, err)
		return
	}
	response.Success(r, out)
}

// Get GET /api/v1/habits/:id
func (c *HabitController) Get(r *ghttp.Request) {
	id := r.Get("id").String()
	if id == "" {
		response.Error(r, ecode.MissingRequiredField)
		return
	}
	out, err := service.Habit().Get(r.Context(), id)
	if err != nil {
		writeError(r, err)
		return
	}
	response.Success(r, out)
}

// Create POST /api/v1/habits
func (c *HabitController) Create(r *ghttp.Request) {
	var req dto.CreateHabitReq
	if err := r.Parse(&req); err != nil {
		response.Error(r, ecode.ValidationFailed, err)
		return
	}
	out, err := service.Habit().Create(r.Context(), &req)
	if err != nil {
		writeError(r, err)
		return
	}
	response.Created(r, out)
}

// Update PATCH /api/v1/habits/:id
func (c *HabitController) Update(r *ghttp.Request) {
	id := r.Get("id").String()
	if id == "" {
		response.Error(r, ecode.MissingRequiredField)
		return
	}
	var req dto.UpdateHabitReq
	if err := r.Parse(&req); err != nil {
		response.Error(r, ecode.ValidationFailed, err)
		return
	}
	out, err := service.Habit().Update(r.Context(), id, &req)
	if err != nil {
		writeError(r, err)
		return
	}
	response.Success(r, out)
}

// Delete DELETE /api/v1/habits/:id
func (c *HabitController) Delete(r *ghttp.Request) {
	id := r.Get("id").String()
	if id == "" {
		response.Error(r, ecode.MissingRequiredField)
		return
	}
	if err := service.Habit().Delete(r.Context(), id); err != nil {
		writeError(r, err)
		return
	}
	response.NoContent(r)
}

// Log POST /api/v1/habits/:id/log
func (c *HabitController) Log(r *ghttp.Request) {
	id := r.Get("id").String()
	if id == "" {
		response.Error(r, ecode.MissingRequiredField)
		return
	}
	var req dto.LogHabitReq
	if err := r.Parse(&req); err != nil {
		response.Error(r, ecode.ValidationFailed, err)
		return
	}
	out, err := service.Habit().Log(r.Context(), id, &req)
	if err != nil {
		writeError(r, err)
		return
	}
	response.Success(r, out)
}
