// Package controller 任务控制器
// M5 扩展：批量操作 + 子任务切换
package controller

import (
	"github.com/gogf/gf/v2/net/ghttp"

	"github.com/life-assistant/api/internal/consts/ecode"
	"github.com/life-assistant/api/internal/middleware"
	"github.com/life-assistant/api/internal/model/dto"
	"github.com/life-assistant/api/internal/response"
	"github.com/life-assistant/api/internal/service"
)

// TaskController 任务控制器
type TaskController struct{}

var Task = &TaskController{}

// List GET /api/v1/tasks
func (c *TaskController) List(r *ghttp.Request) {
	var req dto.ListTasksReq
	if err := r.Parse(&req); err != nil {
		response.Error(r, ecode.ValidationFailed, err)
		return
	}
	out, err := service.Task().List(r.Context(), &req)
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

// Get GET /api/v1/tasks/:id
func (c *TaskController) Get(r *ghttp.Request) {
	id := r.Get("id").String()
	if id == "" {
		response.Error(r, ecode.MissingRequiredField)
		return
	}
	out, err := service.Task().Get(r.Context(), id)
	if err != nil {
		writeError(r, err)
		return
	}
	response.Success(r, out)
}

// Create POST /api/v1/tasks
func (c *TaskController) Create(r *ghttp.Request) {
	var req dto.CreateTaskReq
	if err := r.Parse(&req); err != nil {
		response.Error(r, ecode.ValidationFailed, err)
		return
	}
	out, err := service.Task().Create(r.Context(), &req)
	if err != nil {
		writeError(r, err)
		return
	}
	response.Created(r, out)
}

// Update PATCH /api/v1/tasks/:id
func (c *TaskController) Update(r *ghttp.Request) {
	id := r.Get("id").String()
	if id == "" {
		response.Error(r, ecode.MissingRequiredField)
		return
	}
	var req dto.UpdateTaskReq
	if err := r.Parse(&req); err != nil {
		response.Error(r, ecode.ValidationFailed, err)
		return
	}
	out, err := service.Task().Update(r.Context(), id, &req)
	if err != nil {
		writeError(r, err)
		return
	}
	response.Success(r, out)
}

// ToggleComplete PATCH /api/v1/tasks/:id/complete
func (c *TaskController) ToggleComplete(r *ghttp.Request) {
	id := r.Get("id").String()
	if id == "" {
		response.Error(r, ecode.MissingRequiredField)
		return
	}
	out, err := service.Task().ToggleComplete(r.Context(), id)
	if err != nil {
		writeError(r, err)
		return
	}
	response.Success(r, out)
}

// Delete DELETE /api/v1/tasks/:id
func (c *TaskController) Delete(r *ghttp.Request) {
	id := r.Get("id").String()
	if id == "" {
		response.Error(r, ecode.MissingRequiredField)
		return
	}
	if err := service.Task().Delete(r.Context(), id); err != nil {
		writeError(r, err)
		return
	}
	response.NoContent(r)
}

// BatchAction POST /api/v1/tasks/batch
func (c *TaskController) BatchAction(r *ghttp.Request) {
	var req dto.BatchTaskReq
	if err := r.Parse(&req); err != nil {
		response.Error(r, ecode.ValidationFailed, err)
		return
	}
	// D-03：路由中间件只能对 batch 做 ANY(task:complete, task:delete) 粗筛，
	// 这里按实际 action 细判，缺对应点直接拒绝
	if !middleware.PermissionGranted(r.Context(), r.GetCtxVar("role").String(), "task:"+req.Action) {
		response.Error(r, ecode.PermissionDenied)
		return
	}
	out, err := service.Task().BatchAction(r.Context(), &req)
	if err != nil {
		writeError(r, err)
		return
	}
	response.Success(r, out)
}

// ToggleSubtask PATCH /api/v1/tasks/:id/subtasks/:subtaskId
func (c *TaskController) ToggleSubtask(r *ghttp.Request) {
	id := r.Get("id").String()
	subtaskID := r.Get("subtaskId").String()
	if id == "" || subtaskID == "" {
		response.Error(r, ecode.MissingRequiredField)
		return
	}
	out, err := service.Task().ToggleSubtask(r.Context(), id, subtaskID)
	if err != nil {
		writeError(r, err)
		return
	}
	response.Success(r, out)
}
