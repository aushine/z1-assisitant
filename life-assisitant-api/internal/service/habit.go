// Package service 习惯服务接口
// 业务校验、跨 DAO 编排在这里完成
package service

import (
	"context"

	"github.com/life-assistant/api/internal/model/dto"
)

// IHabitService 习惯服务
// MVP 范围：Create / List / Get / Update / Delete / Log / GetToday
type IHabitService interface {
	// Create 创建习惯（userID 从 ctx 注入）
	Create(ctx context.Context, req *dto.CreateHabitReq) (*dto.HabitResp, error)
	// List 习惯列表（按 user_id + status）
	List(ctx context.Context, req *dto.ListHabitsReq) (*dto.ListHabitsResp, error)
	// Get 习惯详情
	Get(ctx context.Context, id string) (*dto.HabitResp, error)
	// Update 部分更新
	Update(ctx context.Context, id string, req *dto.UpdateHabitReq) (*dto.HabitResp, error)
	// Delete 软删
	Delete(ctx context.Context, id string) error
	// Log 打卡（upsert：同 habit+date 同一天多次打卡只保留一条，count 累加）
	Log(ctx context.Context, habitID string, req *dto.LogHabitReq) (*dto.HabitResp, error)
	// GetToday 今日习惯 + 是否完成
	GetToday(ctx context.Context, req *dto.GetTodayHabitsReq) (*dto.TodayHabitsResp, error)
}
