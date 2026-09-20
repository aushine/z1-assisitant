// Package controller 经期控制器
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

// PeriodController 经期控制器
type PeriodController struct{}

// Period 经期控制器单例
var Period = &PeriodController{}

// Overview GET /z1/api/v1/period/overview
// Query：date（可选，以哪一天为「今天」）
func (c *PeriodController) Overview(r *ghttp.Request) {
	var req dto.PeriodOverviewReq
	_ = r.Parse(&req) // date 可选
	out, err := service.Period().Overview(r.Context(), &req)
	if err != nil {
		writeError(r, err)
		return
	}
	response.Success(r, out)
}

// Calendar GET /z1/api/v1/period/calendar?month=YYYY-MM
func (c *PeriodController) Calendar(r *ghttp.Request) {
	var req dto.PeriodCalendarReq
	if err := r.Parse(&req); err != nil {
		response.Error(r, ecode.ValidationFailed, err)
		return
	}
	out, err := service.Period().Calendar(r.Context(), &req)
	if err != nil {
		writeError(r, err)
		return
	}
	response.Success(r, out)
}

// ListDays GET /z1/api/v1/period/days?start=&end=
func (c *PeriodController) ListDays(r *ghttp.Request) {
	var req dto.ListPeriodDaysReq
	if err := r.Parse(&req); err != nil {
		response.Error(r, ecode.ValidationFailed, err)
		return
	}
	out, err := service.Period().ListDays(r.Context(), &req)
	if err != nil {
		writeError(r, err)
		return
	}
	response.Success(r, out)
}

// GetDay GET /z1/api/v1/period/days/:date
func (c *PeriodController) GetDay(r *ghttp.Request) {
	out, err := service.Period().GetDay(r.Context(), r.Get("date").String())
	if err != nil {
		writeError(r, err)
		return
	}
	response.Success(r, out)
}

// UpsertDay PUT /z1/api/v1/period/days/:date
// 路径参数 :date 优先于 body 里的 date（避免两处不一致）
func (c *PeriodController) UpsertDay(r *ghttp.Request) {
	var req dto.UpsertPeriodDayReq
	if err := r.Parse(&req); err != nil {
		response.Error(r, ecode.ValidationFailed, err)
		return
	}
	if p := r.Get("date").String(); p != "" {
		req.Date = p
	}
	out, err := service.Period().UpsertDay(r.Context(), &req)
	if err != nil {
		writeError(r, err)
		return
	}
	response.Success(r, out)
}

// DeleteDay DELETE /z1/api/v1/period/days/:date（204，无响应体）
func (c *PeriodController) DeleteDay(r *ghttp.Request) {
	if err := service.Period().DeleteDay(r.Context(), r.Get("date").String()); err != nil {
		writeError(r, err)
		return
	}
	response.NoContent(r)
}

// ListCycles GET /z1/api/v1/period/cycles?limit=12
func (c *PeriodController) ListCycles(r *ghttp.Request) {
	var req dto.ListPeriodCyclesReq
	_ = r.Parse(&req)
	out, err := service.Period().ListCycles(r.Context(), &req)
	if err != nil {
		writeError(r, err)
		return
	}
	response.Success(r, out)
}

// PatchCycle PATCH /z1/api/v1/period/cycles/:id（period:manage）
func (c *PeriodController) PatchCycle(r *ghttp.Request) {
	var req dto.PatchPeriodCycleReq
	if err := r.Parse(&req); err != nil {
		response.Error(r, ecode.ValidationFailed, err)
		return
	}
	req.ID = r.Get("id").String()
	if req.ID == "" {
		response.Error(r, ecode.MissingRequiredField)
		return
	}
	out, err := service.Period().PatchCycle(r.Context(), &req)
	if err != nil {
		writeError(r, err)
		return
	}
	response.Success(r, out)
}

// GetSettings GET /z1/api/v1/period/settings
func (c *PeriodController) GetSettings(r *ghttp.Request) {
	out, err := service.Period().GetSettings(r.Context())
	if err != nil {
		writeError(r, err)
		return
	}
	response.Success(r, out)
}

// PatchSettings PATCH /z1/api/v1/period/settings
func (c *PeriodController) PatchSettings(r *ghttp.Request) {
	var req dto.PatchPeriodSettingsReq
	if err := r.Parse(&req); err != nil {
		response.Error(r, ecode.ValidationFailed, err)
		return
	}
	out, err := service.Period().PatchSettings(r.Context(), &req)
	if err != nil {
		writeError(r, err)
		return
	}
	response.Success(r, out)
}

// Setup POST /z1/api/v1/period/setup
func (c *PeriodController) Setup(r *ghttp.Request) {
	var req dto.PeriodSetupReq
	if err := r.Parse(&req); err != nil {
		response.Error(r, ecode.ValidationFailed, err)
		return
	}
	out, err := service.Period().Setup(r.Context(), &req)
	if err != nil {
		writeError(r, err)
		return
	}
	response.Success(r, out)
}

// Reset POST /z1/api/v1/period/reset（period:manage，204）
func (c *PeriodController) Reset(r *ghttp.Request) {
	var req dto.PeriodResetReq
	if err := r.Parse(&req); err != nil {
		response.Error(r, ecode.ValidationFailed, err)
		return
	}
	if err := service.Period().Reset(r.Context(), &req); err != nil {
		writeError(r, err)
		return
	}
	response.NoContent(r)
}

// Report GET /z1/api/v1/period/report?range=6m|12m
func (c *PeriodController) Report(r *ghttp.Request) {
	var req dto.PeriodReportReq
	_ = r.Parse(&req)
	out, err := service.Period().Report(r.Context(), &req)
	if err != nil {
		writeError(r, err)
		return
	}
	response.Success(r, out)
}
