// SubtaskDao 子任务数据访问对象
package dao

import (
	"context"

	"gorm.io/gorm"

	"github.com/life-assistant/api/internal/model"
)

// SubtaskDao 子任务 DAO 接口
type SubtaskDao interface {
	WithContext(ctx context.Context) SubtaskDao
	Create(ctx context.Context, s *model.Subtask) error
	BatchCreate(ctx context.Context, items []model.Subtask) error
	GetByID(ctx context.Context, id string) (*model.Subtask, error)
	ListByTaskID(ctx context.Context, taskID string) ([]model.Subtask, error)
	Update(ctx context.Context, id string, fields map[string]any) error
	Delete(ctx context.Context, id string) error
	DeleteByTaskID(ctx context.Context, taskID string) error
	CountByTaskID(ctx context.Context, taskID string) (int64, error)
	CountCompletedByTaskID(ctx context.Context, taskID string) (int64, error)
}

type subtaskDao struct {
	db *gorm.DB
}

// NewSubtaskDao 构造函数
func NewSubtaskDao() SubtaskDao { return &subtaskDao{db: DB} }

func (d *subtaskDao) WithContext(ctx context.Context) SubtaskDao {
	return &subtaskDao{db: d.db.WithContext(ctx)}
}

func (d *subtaskDao) Create(ctx context.Context, s *model.Subtask) error {
	return d.db.WithContext(ctx).Create(s).Error
}

func (d *subtaskDao) BatchCreate(ctx context.Context, items []model.Subtask) error {
	if len(items) == 0 {
		return nil
	}
	return d.db.WithContext(ctx).Create(&items).Error
}

func (d *subtaskDao) GetByID(ctx context.Context, id string) (*model.Subtask, error) {
	var s model.Subtask
	if err := d.db.WithContext(ctx).Where("id = ?", id).First(&s).Error; err != nil {
		return nil, err
	}
	return &s, nil
}

func (d *subtaskDao) ListByTaskID(ctx context.Context, taskID string) ([]model.Subtask, error) {
	var items []model.Subtask
	err := d.db.WithContext(ctx).
		Where("task_id = ?", taskID).
		Order("`order` ASC, created_at ASC").
		Find(&items).Error
	if err != nil {
		return nil, err
	}
	return items, nil
}

func (d *subtaskDao) Update(ctx context.Context, id string, fields map[string]any) error {
	return d.db.WithContext(ctx).Model(&model.Subtask{}).Where("id = ?", id).Updates(fields).Error
}

func (d *subtaskDao) Delete(ctx context.Context, id string) error {
	return d.db.WithContext(ctx).Where("id = ?", id).Delete(&model.Subtask{}).Error
}

func (d *subtaskDao) DeleteByTaskID(ctx context.Context, taskID string) error {
	return d.db.WithContext(ctx).Where("task_id = ?", taskID).Delete(&model.Subtask{}).Error
}

func (d *subtaskDao) CountByTaskID(ctx context.Context, taskID string) (int64, error) {
	var n int64
	err := d.db.WithContext(ctx).Model(&model.Subtask{}).
		Where("task_id = ?", taskID).
		Count(&n).Error
	return n, err
}

func (d *subtaskDao) CountCompletedByTaskID(ctx context.Context, taskID string) (int64, error) {
	var n int64
	err := d.db.WithContext(ctx).Model(&model.Subtask{}).
		Where("task_id = ? AND is_completed = 1", taskID).
		Count(&n).Error
	return n, err
}

// 全局 DAO 实例（在 dao.SetDB 中统一初始化）
var Subtask SubtaskDao
