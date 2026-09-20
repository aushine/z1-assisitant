// RoleDao 角色表数据访问对象
package dao

import (
	"context"

	"gorm.io/gorm"

	"github.com/life-assistant/api/internal/model"
)

type RoleDao interface {
	WithContext(ctx context.Context) RoleDao
	FindByCode(ctx context.Context, code string) (*model.Role, error)
	ListAll(ctx context.Context) ([]model.Role, error)
	IncUserCount(ctx context.Context, code string, delta int) error
	// D-03 权限重构新增：自定义角色 CRUD
	Create(ctx context.Context, r *model.Role) error
	UpdateMeta(ctx context.Context, code string, updates map[string]any) error
	Delete(ctx context.Context, code string) error
}

type roleDao struct {
	db *gorm.DB
}

func NewRoleDao() RoleDao { return &roleDao{db: DB} }

func (d *roleDao) WithContext(ctx context.Context) RoleDao {
	return &roleDao{db: d.db.WithContext(ctx)}
}

func (d *roleDao) FindByCode(ctx context.Context, code string) (*model.Role, error) {
	var r model.Role
	err := d.db.WithContext(ctx).Where("code = ?", code).First(&r).Error
	if err != nil {
		return nil, err
	}
	return &r, nil
}

// ListAll 按自增 id 排序：admin(1) → user(2) → 自定义角色按创建顺序，
// 不再出现「新角色按编码插在管理员和用户中间」
func (d *roleDao) ListAll(ctx context.Context) ([]model.Role, error) {
	var roles []model.Role
	err := d.db.WithContext(ctx).Order("id ASC").Find(&roles).Error
	return roles, err
}

func (d *roleDao) IncUserCount(ctx context.Context, code string, delta int) error {
	return d.db.WithContext(ctx).Model(&model.Role{}).
		Where("code = ?", code).
		UpdateColumn("user_count", gorm.Expr("user_count + ?", delta)).Error
}

// Create 新建自定义角色
// Select 强制列清单：is_system=false / user_count=0 是零值，
// GORM 对带 default tag 的零值字段默认跳列（会吃 DB 默认值 true → 新角色被标成内置）。
func (d *roleDao) Create(ctx context.Context, r *model.Role) error {
	return d.db.WithContext(ctx).
		Select("code", "name", "description", "is_system", "user_count").
		Create(r).Error
}

// UpdateMeta 更新角色元信息（name / description），触碰 updated_at
func (d *roleDao) UpdateMeta(ctx context.Context, code string, updates map[string]any) error {
	return d.db.WithContext(ctx).Model(&model.Role{}).
		Where("code = ?", code).
		Updates(updates).Error
}

// Delete 删除角色（调用方须先清 role_permissions 并确认无用户占用——两侧 FK 均为 RESTRICT）
func (d *roleDao) Delete(ctx context.Context, code string) error {
	return d.db.WithContext(ctx).Where("code = ?", code).Delete(&model.Role{}).Error
}

// 全局 DAO 实例（在 dao.SetDB 中统一初始化）
var Role RoleDao
