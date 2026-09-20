// 纪念日 / 倒数日数据访问对象（anniversaries）
// 风格参考 period.gen.go：手写 + 链式 + GORM 原生
//
// ⚠️ next_date / days_left **不落库**，由 service 层实时推导（model/anniversary.go 头注释）。
// 本 DAO 只负责存取基准事实（target_date / repeat_rule / calendar_type / remind_days …）。
package dao

import (
	"context"

	"gorm.io/gorm"

	"github.com/life-assistant/api/internal/model"
)

// AnniversaryDao 纪念日 DAO 接口
type AnniversaryDao interface {
	WithContext(ctx context.Context) AnniversaryDao

	Create(ctx context.Context, a *model.Anniversary) error
	// Update 按 (id, user_id) 整体覆盖；⚠️ 必须带 user_id，否则越权可改他人数据
	Update(ctx context.Context, a *model.Anniversary) error

	// GetByID 单条；不存在返回 (nil, nil)
	GetByID(ctx context.Context, id, userID string) (*model.Anniversary, error)
	// ListByUser 该用户全部条目。
	// 排序只排**存储字段**（置顶优先 → 基准日期升序）；days_left 的排序在 service 层做，
	// 因为它是推导值，SQL 排不了。
	ListByUser(ctx context.Context, userID string) ([]model.Anniversary, error)

	Delete(ctx context.Context, id, userID string) error
	DeleteAllByUser(ctx context.Context, userID string) (int64, error)
}

type anniversaryDao struct {
	db *gorm.DB
}

// NewAnniversaryDao 构造函数
func NewAnniversaryDao() AnniversaryDao { return &anniversaryDao{db: DB} }

func (d *anniversaryDao) WithContext(ctx context.Context) AnniversaryDao {
	return &anniversaryDao{db: d.db.WithContext(ctx)}
}

// anniversaryUpdatable 冲突/更新时需要覆盖的列（不含 id / user_id / created_at）
var anniversaryUpdatable = []string{
	"title", "target_date", "repeat_rule", "calendar_type", "remind_days",
	"category", "icon", "color", "is_pinned", "note", "updated_at",
}

func (d *anniversaryDao) Create(ctx context.Context, a *model.Anniversary) error {
	return d.db.WithContext(ctx).Create(a).Error
}

func (d *anniversaryDao) Update(ctx context.Context, a *model.Anniversary) error {
	return d.db.WithContext(ctx).
		Model(&model.Anniversary{}).
		Where("id = ? AND user_id = ?", a.ID, a.UserID).
		Select(anniversaryUpdatable).
		Updates(a).Error
}

func (d *anniversaryDao) GetByID(ctx context.Context, id, userID string) (*model.Anniversary, error) {
	var a model.Anniversary
	err := d.db.WithContext(ctx).
		Where("id = ? AND user_id = ?", id, userID).
		First(&a).Error
	if err == gorm.ErrRecordNotFound {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &a, nil
}

func (d *anniversaryDao) ListByUser(ctx context.Context, userID string) ([]model.Anniversary, error) {
	var items []model.Anniversary
	err := d.db.WithContext(ctx).
		Where("user_id = ?", userID).
		Order("is_pinned DESC, target_date ASC").
		Find(&items).Error
	if err != nil {
		return nil, err
	}
	return items, nil
}

func (d *anniversaryDao) Delete(ctx context.Context, id, userID string) error {
	return d.db.WithContext(ctx).
		Where("id = ? AND user_id = ?", id, userID).
		Delete(&model.Anniversary{}).Error
}

func (d *anniversaryDao) DeleteAllByUser(ctx context.Context, userID string) (int64, error) {
	res := d.db.WithContext(ctx).Where("user_id = ?", userID).Delete(&model.Anniversary{})
	return res.RowsAffected, res.Error
}
