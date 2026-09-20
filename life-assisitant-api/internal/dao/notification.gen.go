// NotificationDao 站内通知表数据访问对象
// 风格参考 task.gen.go：手写 + 链式 + GORM 原生
package dao

import (
	"context"
	"time"

	"gorm.io/gorm"

	"github.com/life-assistant/api/internal/model"
)

// NotificationDao 通知 DAO 接口
type NotificationDao interface {
	WithContext(ctx context.Context) NotificationDao
	Create(ctx context.Context, n *model.Notification) error
	GetByID(ctx context.Context, id string) (*model.Notification, error)
	// List 列表查询（按 user_id + 分页，created_at 倒序）
	List(ctx context.Context, userID string, page, pageSize int) ([]model.Notification, int64, error)
	// CountUnread 统计未读数
	CountUnread(ctx context.Context, userID string) (int64, error)
	// MarkAllRead 全部标记已读，返回受影响条数
	MarkAllRead(ctx context.Context, userID string) (int64, error)
	// MarkRead 单条标记已读
	MarkRead(ctx context.Context, userID, id string) error
}

type notificationDao struct {
	db *gorm.DB
}

// NewNotificationDao 构造函数
func NewNotificationDao() NotificationDao { return &notificationDao{db: DB} }

func (d *notificationDao) WithContext(ctx context.Context) NotificationDao {
	return &notificationDao{db: d.db.WithContext(ctx)}
}

func (d *notificationDao) Create(ctx context.Context, n *model.Notification) error {
	return d.db.WithContext(ctx).Create(n).Error
}

func (d *notificationDao) GetByID(ctx context.Context, id string) (*model.Notification, error) {
	var n model.Notification
	if err := d.db.WithContext(ctx).Where("id = ?", id).First(&n).Error; err != nil {
		return nil, err
	}
	return &n, nil
}

func (d *notificationDao) List(ctx context.Context, userID string, page, pageSize int) ([]model.Notification, int64, error) {
	if page <= 0 {
		page = 1
	}
	if pageSize <= 0 || pageSize > 100 {
		pageSize = 20
	}

	q := d.db.WithContext(ctx).Model(&model.Notification{}).Where("user_id = ?", userID)

	var total int64
	if err := q.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	var items []model.Notification
	if err := q.Order("created_at DESC").
		Limit(pageSize).
		Offset((page - 1) * pageSize).
		Find(&items).Error; err != nil {
		return nil, 0, err
	}
	return items, total, nil
}

func (d *notificationDao) CountUnread(ctx context.Context, userID string) (int64, error) {
	var n int64
	err := d.db.WithContext(ctx).Model(&model.Notification{}).
		Where("user_id = ? AND is_read = ?", userID, false).
		Count(&n).Error
	return n, err
}

func (d *notificationDao) MarkAllRead(ctx context.Context, userID string) (int64, error) {
	now := time.Now()
	res := d.db.WithContext(ctx).Model(&model.Notification{}).
		Where("user_id = ? AND is_read = ?", userID, false).
		Updates(map[string]any{"is_read": true, "read_at": now})
	return res.RowsAffected, res.Error
}

func (d *notificationDao) MarkRead(ctx context.Context, userID, id string) error {
	now := time.Now()
	res := d.db.WithContext(ctx).Model(&model.Notification{}).
		Where("id = ? AND user_id = ? AND is_read = ?", id, userID, false).
		Updates(map[string]any{"is_read": true, "read_at": now})
	return res.Error
}
