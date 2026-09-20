// Package controller 统计控制器
// 规范：controller 只做参数解析 + 调 service + 返回响应
package controller

import (
	"github.com/gogf/gf/v2/net/ghttp"

	"github.com/life-assistant/api/internal/consts/ecode"
	"github.com/life-assistant/api/internal/model/dto"
	"github.com/life-assistant/api/internal/response"
	"github.com/life-assistant/api/internal/service"
)

// StatsController 统计控制器
type StatsController struct{}

var Stats = &StatsController{}

// GetOverview GET /api/v1/stats/overview
// 聚合首页/统计页 KPI：今日任务、本周完成率、本月支出/收入、总余额、今日习惯
func (c *StatsController) GetOverview(r *ghttp.Request) {
	out, err := service.Stats().GetOverview(r.Context())
	if err != nil {
		writeError(r, err)
		return
	}
	response.Success(r, out)
}

// GetTaskStats GET /api/v1/stats/tasks?range=7d
func (c *StatsController) GetTaskStats(r *ghttp.Request) {
	rng := r.Get("range").String()
	if rng == "" {
		rng = "30d"
	}
	out, err := service.Stats().GetTaskStats(r.Context(), rng)
	if err != nil {
		writeError(r, err)
		return
	}
	response.Success(r, out)
}

// GetHabitStats GET /api/v1/stats/habits?range=7d[&start_date=YYYY-MM-DD&end_date=YYYY-MM-DD]
func (c *StatsController) GetHabitStats(r *ghttp.Request) {
	rng := r.Get("range").String()
	if rng == "" {
		rng = "30d"
	}
	startDate := r.Get("start_date").String()
	endDate := r.Get("end_date").String()
	out, err := service.Stats().GetHabitStats(r.Context(), rng, startDate, endDate)
	if err != nil {
		writeError(r, err)
		return
	}
	response.Success(r, out)
}

// GetFinanceStats GET /api/v1/stats/finance?range=7d
func (c *StatsController) GetFinanceStats(r *ghttp.Request) {
	rng := r.Get("range").String()
	if rng == "" {
		rng = "30d"
	}
	out, err := service.Stats().GetFinanceStats(r.Context(), rng)
	if err != nil {
		writeError(r, err)
		return
	}
	response.Success(r, out)
}

// Export GET /api/v1/stats/export
func (c *StatsController) Export(r *ghttp.Request) {
	var req dto.ExportReq
	if err := r.Parse(&req); err != nil {
		response.Error(r, ecode.ValidationFailed, err)
		return
	}
	if req.Range == "" {
		req.Range = "30d"
	}
	if req.Type == "" {
		req.Type = "all"
	}
	if req.Format == "" {
		req.Format = "csv"
	}

	result, err := service.Stats().Export(r.Context(), &req)
	if err != nil {
		writeError(r, err)
		return
	}

	r.Response.Header().Set("Content-Type", "text/csv; charset=utf-8")
	r.Response.Header().Set("Content-Disposition", `attachment; filename="`+result.Filename+`"`)
	// UTF-8 BOM for Excel compatibility
	r.Response.Write([]byte{0xEF, 0xBB, 0xBF})
	r.Response.Write(result.CSV)
}
