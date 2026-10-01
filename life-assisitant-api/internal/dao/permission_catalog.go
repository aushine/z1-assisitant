// 权限目录自愈的数据访问实现（与 permission.gen.go 同属 PermissionDao）
//
// 为什么需要：权限点历史上只靠手写 SQL 增量脚本落库，漏跑 ⇒ 路由上的
// RequirePermission 对非 admin 角色恒 403（260922 的 category:* 事故）。
// 目录升格为代码权威清单后，启动时用这两个方法做**只补不删**的自愈。
package dao

import (
	"context"

	"gorm.io/gorm/clause"

	"github.com/life-assistant/api/internal/model"
)

// UpsertCatalog 幂等写入权限点目录：
//   - 新点 INSERT；
//   - 已存在的点只同步 description（不动 module/action，避免误改语义）。
//
// ⚠️ 只补不删：目录里残留的历史脏点不会被清理（数据订走 SQL 脚本，避免误删风险）。
func (d *permissionDao) UpsertCatalog(ctx context.Context, items []model.Permission) (int64, error) {
	if len(items) == 0 {
		return 0, nil
	}
	res := d.db.WithContext(ctx).Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "id"}},
		DoUpdates: clause.AssignmentColumns([]string{"description"}),
	}).Create(&items)
	return res.RowsAffected, res.Error
}

// GrantMissingToRole 给角色补齐缺失的权限点（INSERT IGNORE）。
//   - 已存在的行（含管理员显式 enabled=0 的项）**不会被改写**；
//   - version 取 1：矩阵版本取 MAX(version) 参与乐观锁，插入低版本行不影响。
func (d *permissionDao) GrantMissingToRole(ctx context.Context, roleCode string, permIDs []string) (int64, error) {
	if roleCode == "" || len(permIDs) == 0 {
		return 0, nil
	}
	rows := make([]model.RolePermission, 0, len(permIDs))
	for _, id := range permIDs {
		if id == "" {
			continue
		}
		rows = append(rows, model.RolePermission{
			RoleCode:     roleCode,
			PermissionID: id,
			Enabled:      true,
			Version:      1,
		})
	}
	if len(rows) == 0 {
		return 0, nil
	}
	res := d.db.WithContext(ctx).Clauses(clause.OnConflict{DoNothing: true}).Create(&rows)
	return res.RowsAffected, res.Error
}

// 编译期断言：确保 permissionDao 仍满足接口（加方法时漏实现会在这里报错）
var _ PermissionDao = (*permissionDao)(nil)
