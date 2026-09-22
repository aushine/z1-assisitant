// FinanceCategoryDao 收支分类表数据访问对象
//
// ⚠️ 本表是**用户级**的（每人一份，内置种子懒创建），且主键是复合主键 `(id, user_id)`。
// 因此**所有按 id 的查询/更新都必须同时带 user_id** —— 否则会命中其他用户的同名内置分类
// （内置 id 是固定值 fc_b_food 这类，跨用户重复）。
package dao

import (
	"context"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"github.com/life-assistant/api/internal/model"
)

// FinanceCategoryDao 收支分类 DAO 接口
type FinanceCategoryDao interface {
	WithContext(ctx context.Context) FinanceCategoryDao

	// Create 新建分类（用户自建，id 用 uuid 去横线）
	Create(ctx context.Context, c *model.FinanceCategory) error

	// BatchInsertIgnore 批量播种内置分类；撞主键/唯一索引的行静默跳过（幂等）
	BatchInsertIgnore(ctx context.Context, items []model.FinanceCategory) error

	// GetByID 取**未删除**的某个分类（必须带 user_id）
	GetByID(ctx context.Context, userID, id string) (*model.FinanceCategory, error)

	// ListByUser 取某用户的全部分类（未删除），scope 为空则返回全部。
	// 排序：scope → 一级在前 → sort → created_at（见 06 §1.1）
	ListByUser(ctx context.Context, userID, scope string) ([]model.FinanceCategory, error)

	// ExistsBuiltin 是否已播种过（⚠️ **含已删除行**，见 02 §4.2：
	// 用户把内置项全删光后再进，不能被重新塞满）
	ExistsBuiltin(ctx context.Context, userID string) (bool, error)

	// ExistsActiveName 同 (user + scope + parent_id) 下是否已有**未删除**的同名分类。
	// excludeID 用于 PATCH 时排除自身（可为空串）。
	// ⚠️ 与唯一索引 uk_fin_cat_user_scope_parent_name（含 is_deleted）口径一致：
	// 软删除后的同名行不算冲突，允许用户重建（02 §1.2 坑 2 的目的）。
	ExistsActiveName(ctx context.Context, userID, scope, parentID, name, excludeID string) (bool, error)

	// Update 按 (user_id, id) 更新字段
	Update(ctx context.Context, userID, id string, fields map[string]any) error
}

type financeCategoryDao struct {
	db *gorm.DB
}

// NewFinanceCategoryDao 构造函数
func NewFinanceCategoryDao() FinanceCategoryDao { return &financeCategoryDao{db: DB} }

func (d *financeCategoryDao) WithContext(ctx context.Context) FinanceCategoryDao {
	return &financeCategoryDao{db: d.db.WithContext(ctx)}
}

func (d *financeCategoryDao) Create(ctx context.Context, c *model.FinanceCategory) error {
	return d.db.WithContext(ctx).Create(c).Error
}

func (d *financeCategoryDao) BatchInsertIgnore(ctx context.Context, items []model.FinanceCategory) error {
	if len(items) == 0 {
		return nil
	}
	// MySQL 下 DoNothing 会被翻译为 `ON DUPLICATE KEY UPDATE id = id`（等价 INSERT IGNORE）
	return d.db.WithContext(ctx).
		Clauses(clause.OnConflict{DoNothing: true}).
		CreateInBatches(items, 100).Error
}

func (d *financeCategoryDao) GetByID(ctx context.Context, userID, id string) (*model.FinanceCategory, error) {
	var c model.FinanceCategory
	err := d.db.WithContext(ctx).
		Where("user_id = ? AND id = ? AND is_deleted = 0", userID, id).
		First(&c).Error
	if err != nil {
		return nil, err
	}
	return &c, nil
}

func (d *financeCategoryDao) ListByUser(ctx context.Context, userID, scope string) ([]model.FinanceCategory, error) {
	var items []model.FinanceCategory
	q := d.db.WithContext(ctx).
		Model(&model.FinanceCategory{}).
		Where("user_id = ? AND is_deleted = 0", userID)
	if scope != "" {
		q = q.Where("scope = ?", scope)
	}
	// (parent_id = '') DESC 让一级排在其二级之前；(created_at, id) 是稳定的次级排序键
	err := q.Order("scope ASC, (parent_id = '') DESC, sort ASC, created_at ASC, id ASC").
		Find(&items).Error
	if err != nil {
		return nil, err
	}
	return items, nil
}

func (d *financeCategoryDao) ExistsBuiltin(ctx context.Context, userID string) (bool, error) {
	var n int64
	// ⚠️ 刻意不加 is_deleted = 0：已删除的内置行也算「播种过」
	err := d.db.WithContext(ctx).
		Model(&model.FinanceCategory{}).
		Where("user_id = ? AND is_builtin = 1", userID).
		Count(&n).Error
	if err != nil {
		return false, err
	}
	return n > 0, nil
}

func (d *financeCategoryDao) ExistsActiveName(ctx context.Context, userID, scope, parentID, name, excludeID string) (bool, error) {
	var n int64
	q := d.db.WithContext(ctx).
		Model(&model.FinanceCategory{}).
		Where("user_id = ? AND scope = ? AND parent_id = ? AND name = ? AND is_deleted = 0",
			userID, scope, parentID, name)
	if excludeID != "" {
		q = q.Where("id <> ?", excludeID)
	}
	if err := q.Count(&n).Error; err != nil {
		return false, err
	}
	return n > 0, nil
}

func (d *financeCategoryDao) Update(ctx context.Context, userID, id string, fields map[string]any) error {
	return d.db.WithContext(ctx).
		Model(&model.FinanceCategory{}).
		Where("user_id = ? AND id = ?", userID, id).
		Updates(fields).Error
}
