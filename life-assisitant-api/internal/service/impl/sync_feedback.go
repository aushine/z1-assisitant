// Package impl 反馈 + 同步服务实现
// M4: 反馈 CRUD + 同步状态查询/触发
package impl

import (
	"context"
	"fmt"
	"time"

	"github.com/life-assistant/api/internal/dao"
	"github.com/life-assistant/api/internal/model"
	"github.com/life-assistant/api/internal/model/dto"
	"github.com/life-assistant/api/internal/service"
	"github.com/life-assistant/api/internal/utility"
)

// ====== 反馈 ======

// FeedbackService 反馈服务实现
type FeedbackService struct{}

func NewFeedbackService() service.IFeedbackService { return &FeedbackService{} }

func init() { service.SetFeedback(NewFeedbackService()) }

// Create 提交反馈
func (s *FeedbackService) Create(ctx context.Context, userID string, req *dto.CreateFeedbackReq) (*dto.FeedbackResp, error) {
	fb := &model.Feedback{
		ID:      utility.NewID("fb"),
		UserID:  userID,
		Type:    req.Type,
		Content: req.Content,
		Status:  "pending",
	}
	if req.Contact != "" {
		fb.Contact = &req.Contact
	}
	if err := dao.DB.Create(fb).Error; err != nil {
		return nil, fmt.Errorf("创建反馈失败: %w", err)
	}
	return &dto.FeedbackResp{
		ID:        fb.ID,
		Type:      fb.Type,
		Content:   fb.Content,
		Contact:   stringPtr(fb.Contact),
		Status:    fb.Status,
		CreatedAt: fb.CreatedAt.Format(time.RFC3339),
	}, nil
}

// ====== 同步 ======

// SyncService 同步服务实现
// MVP：同步状态基于各模块最后 updated_at 估算，不做真实双向同步
type SyncService struct{}

func NewSyncService() service.ISyncService { return &SyncService{} }

func init() { service.SetSync(NewSyncService()) }

// GetStatus 获取同步状态
func (s *SyncService) GetStatus(ctx context.Context, userID string) (*dto.SyncStatusResp, error) {
	details := make(map[string]dto.SyncModuleDetail)

	// 查询各模块最后更新时间
	modules := []struct {
		name  string
		table string
	}{
		{"tasks", "tasks"},
		{"habits", "habits"},
		{"transactions", "transactions"},
		{"budgets", "budgets"},
	}

	var lastGlobal time.Time
	var totalPending int

	for _, m := range modules {
		var lastUpdated *time.Time
		err := dao.DB.Table(m.table).
			Where("user_id = ? AND deleted_at IS NULL", userID).
			Select("MAX(updated_at)").
			Scan(&lastUpdated).Error
		if err != nil {
			lastUpdated = nil
		}

		status := "synced"
		pending := 0

		detail := dto.SyncModuleDetail{
			Status:       status,
			PendingCount: pending,
		}
		if lastUpdated != nil {
			detail.LastSync = lastUpdated.Format(time.RFC3339)
			if lastUpdated.After(lastGlobal) {
				lastGlobal = *lastUpdated
			}
		}

		details[m.name] = detail
		totalPending += pending
	}

	globalStatus := "synced"
	if totalPending > 0 {
		globalStatus = "pending"
	}

	lastSyncAt := ""
	if !lastGlobal.IsZero() {
		lastSyncAt = lastGlobal.Format(time.RFC3339)
	}

	return &dto.SyncStatusResp{
		LastSyncAt: lastSyncAt,
		Status:     globalStatus,
		Pending:    totalPending,
		Details:    details,
	}, nil
}

// TriggerSync 触发同步
// MVP：仅标记时间戳，不做真实双向同步
func (s *SyncService) TriggerSync(ctx context.Context, userID string) (*dto.SyncTriggerResp, error) {
	// 未来：拉取远端数据 → 合并 → 推送本地变更
	// MVP：直接返回成功
	return &dto.SyncTriggerResp{
		Status:  "synced",
		Message: "同步完成",
	}, nil
}

// ====== helpers ======

func stringPtr(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}
