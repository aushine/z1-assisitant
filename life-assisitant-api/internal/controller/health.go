// Package controller 健康模块控制器
//
// 9 个 handler 对应 md/spec-20260919-v1/07 §1 的 8 个接口。
// 读挂 health:view、写挂 health:write、设置与引导挂 health:manage（见 router.go）。
//
// ⚠️ GET /health/days/:date 无记录时返回 200 + data:{day:null}，**不是 404** ——
// 浮层要打开一张空表，404 会让前端被迫写「忽略错误」的兜底分支。
package controller

import (
	"github.com/gogf/gf/v2/net/ghttp"

	"github.com/life-assistant/api/internal/consts/ecode"
	"github.com/life-assistant/api/internal/model/dto"
	"github.com/life-assistant/api/internal/response"
	"github.com/life-assistant/api/internal/service"
)

// HealthController 健康控制器
type HealthController struct{}

var Health = &HealthController{}

// Overview GET /api/v1/health/overview?date=
// 概览卡 + 月历摘要条所需的一切，一次拉齐
func (c *HealthController) Overview(r *ghttp.Request) {
	var req dto.HealthOverviewReq
	_ = r.Parse(&req)
	out, err := service.Health().Overview(r.Context(), &req)
	if err != nil {
		writeError(r, err)
		return
	}
	response.Success(r, out)
}

// Calendar GET /api/v1/health/calendar?month=YYYY-MM
// 月历标记（只返回有标记的日期）
func (c *HealthController) Calendar(r *ghttp.Request) {
	var req dto.HealthCalendarReq
	if err := r.Parse(&req); err != nil {
		response.Error(r, ecode.ValidationFailed, err)
		return
	}
	out, err := service.Health().Calendar(r.Context(), &req)
	if err != nil {
		writeError(r, err)
		return
	}
	response.Success(r, out)
}

// ListDays GET /api/v1/health/days?start=&end=
// 区间记录（补记 / 报告页 / 导出），跨度上限 366 天
func (c *HealthController) ListDays(r *ghttp.Request) {
	var req dto.ListHealthDaysReq
	if err := r.Parse(&req); err != nil {
		response.Error(r, ecode.ValidationFailed, err)
		return
	}
	out, err := service.Health().ListDays(r.Context(), &req)
	if err != nil {
		writeError(r, err)
		return
	}
	response.Success(r, out)
}

// GetDay GET /api/v1/health/days/:date
// 单日详情（打开浮层时用）；无记录 day = null，接口仍返回 200
func (c *HealthController) GetDay(r *ghttp.Request) {
	out, err := service.Health().GetDay(r.Context(), r.Get("date").String())
	if err != nil {
		writeError(r, err)
		return
	}
	response.Success(r, out)
}

// UpsertDay PUT /api/v1/health/days/:date
// 核心写接口（整体覆盖；事务内联动 health_days + period_days + mood_logs）
func (c *HealthController) UpsertDay(r *ghttp.Request) {
	var req dto.UpsertHealthDayReq
	if err := r.Parse(&req); err != nil {
		response.Error(r, ecode.ValidationFailed, err)
		return
	}
	// 日期在路径上，body 里也可能带一份（前端图省事会两边都传）→ 路径优先
	req.Date = r.Get("date").String()
	out, err := service.Health().UpsertDay(r.Context(), &req)
	if err != nil {
		writeError(r, err)
		return
	}
	response.Success(r, out)
}

// DeleteDay DELETE /api/v1/health/days/:date（204，无响应体）
// 前端删除后需自行重拉 overview
func (c *HealthController) DeleteDay(r *ghttp.Request) {
	if err := service.Health().DeleteDay(r.Context(), r.Get("date").String()); err != nil {
		writeError(r, err)
		return
	}
	response.NoContent(r)
}

// GetSettings GET /api/v1/health/settings
// 懒创建，永远有值 → 永不 404
func (c *HealthController) GetSettings(r *ghttp.Request) {
	out, err := service.Health().GetSettings(r.Context())
	if err != nil {
		writeError(r, err)
		return
	}
	response.Success(r, out)
}

// PatchSettings PATCH /api/v1/health/settings
// 只传要改的字段
func (c *HealthController) PatchSettings(r *ghttp.Request) {
	var req dto.PatchHealthSettingsReq
	if err := r.Parse(&req); err != nil {
		response.Error(r, ecode.ValidationFailed, err)
		return
	}
	out, err := service.Health().PatchSettings(r.Context(), &req)
	if err != nil {
		writeError(r, err)
		return
	}
	response.Success(r, out)
}

// Setup POST /api/v1/health/setup
// 首次引导一次性提交。⚠️ 前端「跳过」时不要调这个接口。
func (c *HealthController) Setup(r *ghttp.Request) {
	var req dto.HealthSetupReq
	if err := r.Parse(&req); err != nil {
		response.Error(r, ecode.ValidationFailed, err)
		return
	}
	out, err := service.Health().Setup(r.Context(), &req)
	if err != nil {
		writeError(r, err)
		return
	}
	response.Success(r, out)
}

// ============================================================================
// 身体指标时间轴事件（2026-09-19 新增）
//
// ⚠️ 这是 water / bbt / weight / sleep / bowel 五个指标的**唯一写入路径**。
// PUT /health/days/:date 已经不再处理它们（一天多次、不延续，装不进「一天一张表单」）。
// ============================================================================

// ListEvents GET /api/v1/health/events?date= 或 ?start=&end=&metric_key=
// 时间轴明细；只给 date 时会附带当天汇总 summary
func (c *HealthController) ListEvents(r *ghttp.Request) {
	var req dto.ListHealthEventsReq
	if err := r.Parse(&req); err != nil {
		response.Error(r, ecode.ValidationFailed, err)
		return
	}
	out, err := service.Health().ListEvents(r.Context(), &req)
	if err != nil {
		writeError(r, err)
		return
	}
	response.Success(r, out)
}

// CreateEvent POST /api/v1/health/events
// 追加一次记录。time 不传时由服务端取当前时刻（不让前端传，客户端时钟可能不准）。
func (c *HealthController) CreateEvent(r *ghttp.Request) {
	var req dto.CreateHealthEventReq
	if err := r.Parse(&req); err != nil {
		response.Error(r, ecode.ValidationFailed, err)
		return
	}
	out, err := service.Health().CreateEvent(r.Context(), &req)
	if err != nil {
		writeError(r, err)
		return
	}
	response.Success(r, out)
}

// PatchEvent PATCH /api/v1/health/events/:id
// 改某一次记录；date 与 metric_key 不可改（要改就删除 + 新建）
func (c *HealthController) PatchEvent(r *ghttp.Request) {
	var req dto.PatchHealthEventReq
	if err := r.Parse(&req); err != nil {
		response.Error(r, ecode.ValidationFailed, err)
		return
	}
	req.ID = r.Get("id").String()
	out, err := service.Health().PatchEvent(r.Context(), &req)
	if err != nil {
		writeError(r, err)
		return
	}
	response.Success(r, out)
}

// DeleteEvent DELETE /api/v1/health/events/:id
// 删某一次记录。⚠️ 不是 204 —— 要返回删完之后的当日汇总，省得前端二次请求。
func (c *HealthController) DeleteEvent(r *ghttp.Request) {
	out, err := service.Health().DeleteEvent(r.Context(), r.Get("id").String())
	if err != nil {
		writeError(r, err)
		return
	}
	response.Success(r, out)
}
