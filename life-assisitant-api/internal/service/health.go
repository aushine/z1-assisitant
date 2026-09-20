// Package service 健康服务接口
//
// 9 个方法对应 md/spec-20260919-v1/07 §1 的 8 个接口（settings 的读写算一个）。
//
// ⚠️ 健康 = 「测出来的数」的家：饮水 / 体重 / 体温 / 睡眠 / 排便落在 health_days，
// 经期事实仍在 period_days，心情 / 精力 / 备注仍在 mood_logs（按小时）。
// 一次「完成」提交可能同时写这三张表 —— **必须在同一事务里**（07 §4），
// 否则会出现「体重记上了、经期没记上」这种不报错、只会某天才被发现的静默不一致。
package service

import (
	"context"

	"github.com/life-assistant/api/internal/model/dto"
)

// IHealthService 健康服务
type IHealthService interface {
	// Overview GET /health/overview —— 概览卡 + 月历摘要条所需的一切，一次拉齐
	Overview(ctx context.Context, req *dto.HealthOverviewReq) (*dto.HealthOverviewResp, error)
	// Calendar GET /health/calendar —— 月历标记（只返回有标记的日期）
	Calendar(ctx context.Context, req *dto.HealthCalendarReq) (*dto.HealthCalendarResp, error)
	// ListDays GET /health/days —— 区间记录（补记 / 报告页 / 导出）
	ListDays(ctx context.Context, req *dto.ListHealthDaysReq) (*dto.ListHealthDaysResp, error)
	// GetDay GET /health/days/:date —— 单日详情（无记录 day = null 且**返回 200**，不是 404）
	GetDay(ctx context.Context, date string) (*dto.HealthDayDetailResp, error)
	// UpsertDay PUT /health/days/:date —— 核心写接口（整体覆盖，事务内联动三表）
	UpsertDay(ctx context.Context, req *dto.UpsertHealthDayReq) (*dto.UpsertHealthDayResp, error)
	// DeleteDay DELETE /health/days/:date —— 删除某日记录
	DeleteDay(ctx context.Context, date string) error
	// GetSettings GET /health/settings —— 懒创建，永远有值
	GetSettings(ctx context.Context) (*dto.HealthSettingsResp, error)
	// PatchSettings PATCH /health/settings —— 只传要改的字段
	PatchSettings(ctx context.Context, req *dto.PatchHealthSettingsReq) (*dto.HealthSettingsResp, error)
	// Setup POST /health/setup —— 首次引导一次性提交
	Setup(ctx context.Context, req *dto.HealthSetupReq) (*dto.HealthSetupResp, error)

	// ListEvents GET /health/events —— 时间轴明细（某一天，或区间 + 可选按指标过滤）
	ListEvents(ctx context.Context, req *dto.ListHealthEventsReq) (*dto.ListHealthEventsResp, error)
	// CreateEvent POST /health/events —— 追加一次记录（事务内重算 health_days 日汇总）
	CreateEvent(ctx context.Context, req *dto.CreateHealthEventReq) (*dto.CreateHealthEventResp, error)
	// PatchEvent PATCH /health/events/:id —— 改某一次记录（date / metric_key 不可改）
	PatchEvent(ctx context.Context, req *dto.PatchHealthEventReq) (*dto.PatchHealthEventResp, error)
	// DeleteEvent DELETE /health/events/:id —— 删某一次记录
	DeleteEvent(ctx context.Context, id string) (*dto.HealthEventDaySummary, error)
}
