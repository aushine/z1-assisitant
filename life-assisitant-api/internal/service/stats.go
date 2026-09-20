// Package service 统计服务接口
package service

import (
	"context"

	"github.com/life-assistant/api/internal/model/dto"
)

// IStatsService 统计服务
// M1 扩展：GetOverview + GetTaskStats + GetHabitStats + GetFinanceStats + Export
type IStatsService interface {
	// GetOverview 聚合首页/统计页所需的 KPI
	GetOverview(ctx context.Context) (*dto.StatsOverviewResp, error)

	// GetTaskStats 任务统计（按 range 聚合）
	GetTaskStats(ctx context.Context, rng string) (*dto.TaskStatsResp, error)

	// GetHabitStats 习惯统计（按 range 聚合；startDate/endDate 可选，用于按月份等自定义区间）
	GetHabitStats(ctx context.Context, rng, startDate, endDate string) (*dto.HabitStatsResp, error)

	// GetFinanceStats 财务统计（按 range 聚合）
	GetFinanceStats(ctx context.Context, rng string) (*dto.FinanceStatsResp, error)

	// Export 导出 CSV
	Export(ctx context.Context, req *dto.ExportReq) (*dto.ExportResult, error)
}
