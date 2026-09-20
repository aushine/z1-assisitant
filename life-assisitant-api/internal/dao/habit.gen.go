// HabitDao 习惯表数据访问对象
// 风格参考 task.gen.go：手写 + 链式 + GORM 原生
package dao

import (
	"context"
	"strings"

	"gorm.io/gorm"

	"github.com/life-assistant/api/internal/model"
)

// HabitDao 习惯 DAO 接口
type HabitDao interface {
	WithContext(ctx context.Context) HabitDao
	Create(ctx context.Context, h *model.Habit) error
	GetByID(ctx context.Context, id string) (*model.Habit, error)
	Update(ctx context.Context, id string, fields map[string]any) error
	Delete(ctx context.Context, id string) error // 软删

	// List 列表查询（按 user_id + 可选 status + 分页）
	List(ctx context.Context, opts HabitListOptions) ([]model.Habit, int64, error)

	// ListByIDs 按 ID 集合批量查询（含已归档，时间线聚合用）
	ListByIDs(ctx context.Context, ids []string) ([]model.Habit, error)
}

// HabitListOptions 习惯列表查询参数
type HabitListOptions struct {
	UserID   string
	Status   string // active / archived，空表示不过滤（除软删外）
	Page     int
	PageSize int
}

type habitDao struct {
	db *gorm.DB
}

// NewHabitDao 构造函数
func NewHabitDao() HabitDao { return &habitDao{db: DB} }

func (d *habitDao) WithContext(ctx context.Context) HabitDao {
	return &habitDao{db: d.db.WithContext(ctx)}
}

func (d *habitDao) Create(ctx context.Context, h *model.Habit) error {
	return d.db.WithContext(ctx).Create(h).Error
}

func (d *habitDao) GetByID(ctx context.Context, id string) (*model.Habit, error) {
	var h model.Habit
	if err := d.db.WithContext(ctx).Where("id = ?", id).First(&h).Error; err != nil {
		return nil, err
	}
	return &h, nil
}

func (d *habitDao) Update(ctx context.Context, id string, fields map[string]any) error {
	res := d.db.WithContext(ctx).Model(&model.Habit{}).Where("id = ?", id).Updates(fields)
	if res.Error != nil {
		return res.Error
	}
	return nil
}

func (d *habitDao) Delete(ctx context.Context, id string) error {
	// 软删
	return d.db.WithContext(ctx).Where("id = ?", id).Delete(&model.Habit{}).Error
}

// List 习惯列表：分页 + 状态筛选
func (d *habitDao) List(ctx context.Context, opts HabitListOptions) ([]model.Habit, int64, error) {
	if opts.Page <= 0 {
		opts.Page = 1
	}
	if opts.PageSize <= 0 || opts.PageSize > 100 {
		opts.PageSize = 20
	}

	q := d.db.WithContext(ctx).Model(&model.Habit{}).Where("user_id = ?", opts.UserID)
	if opts.Status != "" {
		q = q.Where("status = ?", opts.Status)
	} else {
		// 默认隐藏 archived
		q = q.Where("status <> ?", model.HabitStatusArchived)
	}

	// count
	var total int64
	if err := q.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	// 排序：target_count desc, created_at desc
	var items []model.Habit
	if err := q.Order(strings.Join([]string{"target_count DESC", "created_at DESC"}, ", ")).
		Limit(opts.PageSize).
		Offset((opts.Page - 1) * opts.PageSize).
		Find(&items).Error; err != nil {
		return nil, 0, err
	}
	return items, total, nil
}

// ListByIDs 按 ID 集合批量查询（含已归档，时间线聚合用）
func (d *habitDao) ListByIDs(ctx context.Context, ids []string) ([]model.Habit, error) {
	if len(ids) == 0 {
		return []model.Habit{}, nil
	}
	var items []model.Habit
	err := d.db.WithContext(ctx).
		Unscoped().
		Where("id IN ?", ids).
		Find(&items).Error
	if err != nil {
		return nil, err
	}
	return items, nil
}
