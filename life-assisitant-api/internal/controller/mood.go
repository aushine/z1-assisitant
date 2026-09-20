// Package controller 心情/精力控制器
//
// 260919 变更：新增 GET /moods/timeline（按小时的时间线）。
// 三个读取端点都挂在 mood:view，写入挂在 mood:write（见 router.go）。
package controller

import (
	"github.com/gogf/gf/v2/net/ghttp"

	"github.com/life-assistant/api/internal/consts/ecode"
	"github.com/life-assistant/api/internal/model/dto"
	"github.com/life-assistant/api/internal/response"
	"github.com/life-assistant/api/internal/service"
)

// MoodController 心情控制器
type MoodController struct{}

var Mood = &MoodController{}

// Timeline GET /api/v1/moods/timeline?date=YYYY-MM-DD
// 某天时间线（按小时，含向前延续填充）；date 缺省 = 今天
func (c *MoodController) Timeline(r *ghttp.Request) {
	var req dto.GetMoodReq
	_ = r.Parse(&req)
	out, err := service.Mood().GetTimeline(r.Context(), &req)
	if err != nil {
		writeError(r, err)
		return
	}
	response.Success(r, out)
}

// GetByDate GET /api/v1/moods/today（或 ?date=YYYY-MM-DD）
// 该天最后一条（含向前延续填充）；无记录返回 null
func (c *MoodController) GetByDate(r *ghttp.Request) {
	var req dto.GetMoodReq
	_ = r.Parse(&req)
	out, err := service.Mood().GetByDate(r.Context(), &req)
	if err != nil {
		writeError(r, err)
		return
	}
	response.Success(r, out)
}

// Upsert PUT /api/v1/moods
// 记录/修改某天某个小时（三态语义：缺省 = 不动 / 0 或 "" = 清空 / 全空 = 删行）
func (c *MoodController) Upsert(r *ghttp.Request) {
	var req dto.UpsertMoodReq
	if err := r.Parse(&req); err != nil {
		response.Error(r, ecode.ValidationFailed, err)
		return
	}
	out, err := service.Mood().Upsert(r.Context(), &req)
	if err != nil {
		writeError(r, err)
		return
	}
	response.Success(r, out)
}

// List GET /api/v1/moods?start_date=&end_date=
func (c *MoodController) List(r *ghttp.Request) {
	var req dto.ListMoodsReq
	if err := r.Parse(&req); err != nil {
		response.Error(r, ecode.ValidationFailed, err)
		return
	}
	out, err := service.Mood().List(r.Context(), &req)
	if err != nil {
		writeError(r, err)
		return
	}
	response.Success(r, out)
}
