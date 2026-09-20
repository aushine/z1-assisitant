package service

import (
	"context"

	"github.com/life-assistant/api/internal/model/dto"
)

// IFeedbackService 反馈服务
type IFeedbackService interface {
	// Create 提交反馈
	Create(ctx context.Context, userID string, req *dto.CreateFeedbackReq) (*dto.FeedbackResp, error)
}

// ISyncService 同步服务
type ISyncService interface {
	// GetStatus 获取同步状态
	GetStatus(ctx context.Context, userID string) (*dto.SyncStatusResp, error)
	// TriggerSync 触发同步
	TriggerSync(ctx context.Context, userID string) (*dto.SyncTriggerResp, error)
}
