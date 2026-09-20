// Package impl 通知服务实现
// 通知落库：列表 / 未读数 / 单条已读 / 全部已读
package impl

import (
	"context"
	"errors"
	"time"

	"github.com/gogf/gf/v2/errors/gerror"
	"gorm.io/gorm"

	"github.com/life-assistant/api/internal/consts/ecode"
	"github.com/life-assistant/api/internal/dao"
	"github.com/life-assistant/api/internal/model"
	"github.com/life-assistant/api/internal/model/dto"
	"github.com/life-assistant/api/internal/service"
)

// NotificationService 通知服务实现
type NotificationService struct{}

func NewNotificationService() service.INotificationService { return &NotificationService{} }

// Register
func init() { service.SetNotification(NewNotificationService()) }

// notificationToItem 实体转列表项
func notificationToItem(n *model.Notification) dto.NotificationItem {
	item := dto.NotificationItem{
		ID:        n.ID,
		Type:      n.Type,
		Title:     n.Title,
		IsRead:    n.IsRead,
		CreatedAt: n.CreatedAt.UTC().Format(time.RFC3339),
	}
	if n.Body != nil {
		item.Body = *n.Body
	}
	if n.ReadAt != nil {
		item.ReadAt = n.ReadAt.UTC().Format(time.RFC3339)
	}
	return item
}

// List 通知列表（分页，created_at 倒序）
func (s *NotificationService) List(ctx context.Context, req *dto.ListNotificationsReq) (*dto.ListNotificationsResp, error) {
	uid := ctxUserID(ctx)
	if uid == "" {
		return nil, gerror.NewCode(ecode.AuthTokenMissing)
	}
	page := req.Page
	if page <= 0 {
		page = 1
	}
	pageSize := req.PageSize
	if pageSize <= 0 {
		pageSize = 20
	}
	items, total, err := dao.Notification.List(ctx, uid, page, pageSize)
	if err != nil {
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "查询通知列表失败")
	}
	out := make([]dto.NotificationItem, 0, len(items))
	for i := range items {
		out = append(out, notificationToItem(&items[i]))
	}
	return &dto.ListNotificationsResp{Items: out, Total: total}, nil
}

// UnreadCount 获取未读通知数
func (s *NotificationService) UnreadCount(ctx context.Context) (*dto.UnreadCountResp, error) {
	uid := ctxUserID(ctx)
	if uid == "" {
		return nil, gerror.NewCode(ecode.AuthTokenMissing)
	}
	n, err := dao.Notification.CountUnread(ctx, uid)
	if err != nil {
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "查询未读通知数失败")
	}
	return &dto.UnreadCountResp{Count: int(n)}, nil
}

// MarkRead 标记所有通知为已读
func (s *NotificationService) MarkRead(ctx context.Context) (*dto.MarkReadResp, error) {
	uid := ctxUserID(ctx)
	if uid == "" {
		return nil, gerror.NewCode(ecode.AuthTokenMissing)
	}
	n, err := dao.Notification.MarkAllRead(ctx, uid)
	if err != nil {
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "标记通知已读失败")
	}
	return &dto.MarkReadResp{Affected: int(n)}, nil
}

// MarkReadByID 标记单条通知为已读
func (s *NotificationService) MarkReadByID(ctx context.Context, id string) error {
	uid := ctxUserID(ctx)
	if uid == "" {
		return gerror.NewCode(ecode.AuthTokenMissing)
	}
	n, err := dao.Notification.GetByID(ctx, id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return gerror.NewCode(ecode.NotificationNotFound)
		}
		return gerror.WrapCode(ecode.DatabaseError, err, "查询通知失败")
	}
	if n.UserID != uid && ctxRole(ctx) != model.RoleAdmin {
		return gerror.NewCode(ecode.PermissionDenied)
	}
	if err := dao.Notification.MarkRead(ctx, uid, id); err != nil {
		return gerror.WrapCode(ecode.DatabaseError, err, "标记通知已读失败")
	}
	return nil
}
