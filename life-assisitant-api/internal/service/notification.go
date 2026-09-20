// Package service 通知服务接口
package service

import (
	"context"

	"github.com/life-assistant/api/internal/model/dto"
)

// INotificationService 通知服务
// 落库通知的列表 / 未读数 / 标记已读
type INotificationService interface {
	// List 通知列表（分页，created_at 倒序）
	List(ctx context.Context, req *dto.ListNotificationsReq) (*dto.ListNotificationsResp, error)

	// UnreadCount 获取当前用户未读通知数
	UnreadCount(ctx context.Context) (*dto.UnreadCountResp, error)

	// MarkRead 标记所有通知为已读，返回受影响条数
	MarkRead(ctx context.Context) (*dto.MarkReadResp, error)

	// MarkReadByID 标记单条通知为已读
	MarkReadByID(ctx context.Context, id string) error
}
