// PermissionDao 权限点 + 角色-权限关联 数据访问对象
package dao

import (
	"context"

	"gorm.io/gorm"

	"github.com/life-assistant/api/internal/model"
)

type PermissionDao interface {
	WithContext(ctx context.Context) PermissionDao

	// Permission 维度
	ListAllPermissions(ctx context.Context) ([]model.Permission, error)
	FindByID(ctx context.Context, id string) (*model.Permission, error)

	// RolePermission 维度
	ListByRole(ctx context.Context, roleCode string) ([]model.RolePermission, error)
	GetMatrixByRole(ctx context.Context, roleCode string) (map[string][]string, int, error)
	UpdateMatrix(ctx context.Context, roleCode string, version int, enabled map[string]bool) (int64, error)
}

type permissionDao struct {
	db *gorm.DB
}

func NewPermissionDao() PermissionDao { return &permissionDao{db: DB} }

func (d *permissionDao) WithContext(ctx context.Context) PermissionDao {
	return &permissionDao{db: d.db.WithContext(ctx)}
}

func (d *permissionDao) ListAllPermissions(ctx context.Context) ([]model.Permission, error) {
	var ps []model.Permission
	err := d.db.WithContext(ctx).Order("module ASC, action ASC").Find(&ps).Error
	return ps, err
}

func (d *permissionDao) FindByID(ctx context.Context, id string) (*model.Permission, error) {
	var p model.Permission
	err := d.db.WithContext(ctx).Where("id = ?", id).First(&p).Error
	if err != nil {
		return nil, err
	}
	return &p, nil
}

func (d *permissionDao) ListByRole(ctx context.Context, roleCode string) ([]model.RolePermission, error) {
	var rps []model.RolePermission
	err := d.db.WithContext(ctx).Where("role_code = ? AND enabled = ?", roleCode, true).Find(&rps).Error
	return rps, err
}

// GetMatrixByRole 返回 map[module] -> []action
// 同时返回当前版本号（用于乐观锁）
func (d *permissionDao) GetMatrixByRole(ctx context.Context, roleCode string) (map[string][]string, int, error) {
	// 1. 拿所有 permission
	var perms []model.Permission
	if err := d.db.WithContext(ctx).Order("module ASC, action ASC").Find(&perms).Error; err != nil {
		return nil, 0, err
	}
	// 2. 拿该角色已开启的 role_permission
	var rps []model.RolePermission
	if err := d.db.WithContext(ctx).
		Where("role_code = ? AND enabled = ?", roleCode, true).
		Find(&rps).Error; err != nil {
		return nil, 0, err
	}
	enabled := make(map[string]bool, len(rps))
	maxVer := 0
	for _, rp := range rps {
		enabled[rp.PermissionID] = true
		if rp.Version > maxVer {
			maxVer = rp.Version
		}
	}
	matrix := make(map[string][]string, 8)
	for _, p := range perms {
		if enabled[p.ID] {
			matrix[p.Module] = append(matrix[p.Module], p.Action)
		}
	}
	return matrix, maxVer, nil
}

// UpdateMatrix 用全量替换方式更新某个角色的权限矩阵
// 必须在事务中执行；外层通过 tx 调用
// 返回受影响的行数
func (d *permissionDao) UpdateMatrix(ctx context.Context, roleCode string, version int, enabled map[string]bool) (int64, error) {
	// 全量替换：先删旧的，再插新的
	if err := d.db.WithContext(ctx).Where("role_code = ?", roleCode).Delete(&model.RolePermission{}).Error; err != nil {
		return 0, err
	}
	rps := make([]model.RolePermission, 0, len(enabled))
	for permID, ok := range enabled {
		if !ok {
			continue
		}
		rps = append(rps, model.RolePermission{
			RoleCode:     roleCode,
			PermissionID: permID,
			Enabled:      true,
			Version:      version,
		})
	}
	if len(rps) == 0 {
		return 0, nil
	}
	if err := d.db.WithContext(ctx).Create(&rps).Error; err != nil {
		return 0, err
	}
	return int64(len(rps)), nil
}

// 全局 DAO 实例（在 dao.SetDB 中统一初始化）
var Permission PermissionDao
