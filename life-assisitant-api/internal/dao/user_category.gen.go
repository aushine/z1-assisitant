// UserCategoryDao 习惯/待办分类表（user_categories）数据访问对象
//
// ⚠️ 本表是**用户级**的（每人一份，内置种子懒创建），且主键是复合主键 `(id, user_id)`。
// 因此**所有按 id 的查询/更新/删除都必须同时带 user_id** —— 否则会命中其他用户的
// 同名内置分类（内置 id 是固定值 sport / c_work 这类，跨用户重复）。
package dao

import (
	"context"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"github.com/life-assistant/api/internal/model"
)

// UserCategoryDao 习惯/待办分类 DAO 接口
type UserCategoryDao interface {
	WithContext(ctx context.Context) UserCategoryDao

	// Create 新建分类（用户自建，id 用 uc_<domain>_<10位随机>）
	Create(ctx context.Context, c *model.UserCategory) error

	// BatchInsertIgnore 批量播种内置分类；撞主键/唯一索引的行静默跳过（幂等，并发安全）
	BatchInsertIgnore(ctx context.Context, items []model.UserCategory) error

	// GetByID 取**未删除**的某个分类（必须带 user_id）
	GetByID(ctx context.Context, userID, id string) (*model.UserCategory, error)

	// ListByDomain 取某用户某 domain 的全部分类（未删除），按 sort → created_at → id 排序
	ListByDomain(ctx context.Context, userID, domain string) ([]model.UserCategory, error)

	// ExistsBuiltin 该用户该 domain 是否已播种过（⚠️ **含已删除行**，06 §3.1 铁律 3：
	// 判断标准是「存在 is_builtin=1 的行」而不是「分类数为 0」，
	// 否则用户把内置项全删光后再进会被重新塞满，删除功能形同虚设）
	ExistsBuiltin(ctx context.Context, userID, domain string) (bool, error)

	// ExistsActiveName 同 (user, domain) 下是否已有**未删除**的同名分类。
	// excludeID 用于 PATCH 时排除自身（可为空串）。
	// ⚠️ 与唯一索引 uk_user_cat(user_id, domain, name, deleted_seq) 口径一致：
	// 软删行的 deleted_seq 是随机值 ≠ ''，不算活跃冲突，允许用户重建同名。
	ExistsActiveName(ctx context.Context, userID, domain, name, excludeID string) (bool, error)

	// Update 按 (user_id, id) 更新字段
	Update(ctx context.Context, userID, id string, fields map[string]any) error

	// SoftDelete 软删三件套一起写：is_deleted=1 + deleted_at=now + deleted_seq=随机值。
	// deleted_seq 由调用方生成（避免 dao 包依赖 utility）；漏写会让「同名删了再删」撞 1062。
	SoftDelete(ctx context.Context, userID, id, deletedSeq string, now time.Time) error
}

type userCategoryDao struct {
	db *gorm.DB
}

// NewUserCategoryDao 构造函数
func NewUserCategoryDao() UserCategoryDao { return &userCategoryDao{db: DB} }

func (d *userCategoryDao) WithContext(ctx context.Context) UserCategoryDao {
	return &userCategoryDao{db: d.db.WithContext(ctx)}
}

func (d *userCategoryDao) Create(ctx context.Context, c *model.UserCategory) error {
	return d.db.WithContext(ctx).Create(c).Error
}

func (d *userCategoryDao) BatchInsertIgnore(ctx context.Context, items []model.UserCategory) error {
	if len(items) == 0 {
		return nil
	}
	// MySQL 下 DoNothing 会被翻译为 `ON DUPLICATE KEY UPDATE id = id`（等价 INSERT IGNORE）
	return d.db.WithContext(ctx).
		Clauses(clause.OnConflict{DoNothing: true}).
		CreateInBatches(items, 100).Error
}

func (d *userCategoryDao) GetByID(ctx context.Context, userID, id string) (*model.UserCategory, error) {
	var c model.UserCategory
	err := d.db.WithContext(ctx).
		Where("user_id = ? AND id = ? AND is_deleted = 0", userID, id).
		First(&c).Error
	if err != nil {
		return nil, err
	}
	return &c, nil
}

func (d *userCategoryDao) ListByDomain(ctx context.Context, userID, domain string) ([]model.UserCategory, error) {
	var items []model.UserCategory
	err := d.db.WithContext(ctx).
		Model(&model.UserCategory{}).
		Where("user_id = ? AND domain = ? AND is_deleted = 0", userID, domain).
		Order("sort ASC, created_at ASC, id ASC").
		Find(&items).Error
	if err != nil {
		return nil, err
	}
	return items, nil
}

func (d *userCategoryDao) ExistsBuiltin(ctx context.Context, userID, domain string) (bool, error) {
	var n int64
	// ⚠️ 刻意不加 is_deleted = 0：已删除的内置行也算「播种过」（06 §3.1 铁律 3）
	err := d.db.WithContext(ctx).
		Model(&model.UserCategory{}).
		Where("user_id = ? AND domain = ? AND is_builtin = 1", userID, domain).
		Count(&n).Error
	if err != nil {
		return false, err
	}
	return n > 0, nil
}

func (d *userCategoryDao) ExistsActiveName(ctx context.Context, userID, domain, name, excludeID string) (bool, error) {
	var n int64
	q := d.db.WithContext(ctx).
		Model(&model.UserCategory{}).
		Where("user_id = ? AND domain = ? AND name = ? AND is_deleted = 0", userID, domain, name)
	if excludeID != "" {
		q = q.Where("id <> ?", excludeID)
	}
	if err := q.Count(&n).Error; err != nil {
		return false, err
	}
	return n > 0, nil
}

func (d *userCategoryDao) Update(ctx context.Context, userID, id string, fields map[string]any) error {
	return d.db.WithContext(ctx).
		Model(&model.UserCategory{}).
		Where("user_id = ? AND id = ?", userID, id).
		Updates(fields).Error
}

func (d *userCategoryDao) SoftDelete(ctx context.Context, userID, id, deletedSeq string, now time.Time) error {
	// ⚠️ 软删三件套一起写，缺一会破坏 uk_user_cat 的「删了再建」语义（06 §3.3）
	return d.db.WithContext(ctx).
		Model(&model.UserCategory{}).
		Where("user_id = ? AND id = ? AND is_deleted = 0", userID, id).
		Updates(map[string]any{
			"is_deleted":  1,
			"deleted_at":  now,
			"deleted_seq": deletedSeq,
		}).Error
}
