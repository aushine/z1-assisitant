// Package controller 生活时间线控制器
package controller

import (
	"github.com/gogf/gf/v2/net/ghttp"

	"github.com/life-assistant/api/internal/consts/ecode"
	"github.com/life-assistant/api/internal/model/dto"
	"github.com/life-assistant/api/internal/response"
	"github.com/life-assistant/api/internal/service"
)

// TimelineController 时间线控制器
type TimelineController struct{}

var Timeline = &TimelineController{}

// Fetch GET /api/v1/timeline?date=YYYY-MM-DD&page=&page_size=
func (c *TimelineController) Fetch(r *ghttp.Request) {
	var req dto.TimelineReq
	if err := r.Parse(&req); err != nil {
		response.Error(r, ecode.ValidationFailed, err)
		return
	}
	out, err := service.Timeline().Fetch(r.Context(), &req)
	if err != nil {
		writeError(r, err)
		return
	}
	response.Success(r, out)
}
