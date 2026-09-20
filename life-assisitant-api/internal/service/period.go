// Package service 经期服务接口
//
// 12 个方法对应 05-API规范.md 的 12 节接口。
// 预测结果不落表：每次写操作后实时重算并随响应返回。
package service

import (
	"context"

	"github.com/life-assistant/api/internal/model/dto"
)

// IPeriodService 经期服务
type IPeriodService interface {
	// Overview GET /period/overview —— 概览卡 + 引导态所需的一切，一次拉齐
	Overview(ctx context.Context, req *dto.PeriodOverviewReq) (*dto.PeriodOverviewResp, error)
	// Calendar GET /period/calendar —— 月历标记（只返回有标记的日期）
	Calendar(ctx context.Context, req *dto.PeriodCalendarReq) (*dto.PeriodCalendarResp, error)
	// ListDays GET /period/days —— 区间日记
	ListDays(ctx context.Context, req *dto.ListPeriodDaysReq) (*dto.ListPeriodDaysResp, error)
	// GetDay GET /period/days/:date —— 单日详情（无记录 day = null，不是 404）
	GetDay(ctx context.Context, date string) (*dto.PeriodDayDetailResp, error)
	// UpsertDay PUT /period/days/:date —— 核心写接口（整体覆盖，事务内联动 mood_logs + RebuildCycles）
	UpsertDay(ctx context.Context, req *dto.UpsertPeriodDayReq) (*dto.UpsertPeriodDayResp, error)
	// DeleteDay DELETE /period/days/:date —— 删除某日记录并重算周期
	DeleteDay(ctx context.Context, date string) error
	// ListCycles GET /period/cycles —— 周期历史
	ListCycles(ctx context.Context, req *dto.ListPeriodCyclesReq) (*dto.ListPeriodCyclesResp, error)
	// PatchCycle PATCH /period/cycles/:id —— 人工修正周期起止（period:manage）
	PatchCycle(ctx context.Context, req *dto.PatchPeriodCycleReq) (*dto.PatchPeriodCycleResp, error)
	// GetSettings GET /period/settings —— 懒创建，永远有值
	GetSettings(ctx context.Context) (*dto.PeriodSettingsResp, error)
	// PatchSettings PATCH /period/settings —— 只传要改的字段
	PatchSettings(ctx context.Context, req *dto.PatchPeriodSettingsReq) (*dto.PeriodSettingsResp, error)
	// Setup POST /period/setup —— 引导向导提交（一次性）
	Setup(ctx context.Context, req *dto.PeriodSetupReq) (*dto.PeriodSetupResp, error)
	// Reset POST /period/reset —— 整模块重置（需二次确认）
	Reset(ctx context.Context, req *dto.PeriodResetReq) error
	// Report GET /period/report?range=6m|12m —— 周期报告（P1）
	Report(ctx context.Context, req *dto.PeriodReportReq) (*dto.PeriodReportResp, error)
}
