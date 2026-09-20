// Package model 定义 GORM 实体结构（与数据库表 1:1 映射）
// 约定：
//   - 每个实体一个文件
//   - 字段名与列名完全对齐
//   - JSON tag 用于 API 响应序列化
//   - 软删除字段：gorm.DeletedAt
//   - 乐观锁：version int
package model

import (
	"database/sql/driver"
	"encoding/json"
	"errors"
)

// JSON 自定义类型：把 map/struct 存入 MySQL JSON 列
type JSON map[string]any

func (j JSON) Value() (driver.Value, error) {
	if j == nil {
		return nil, nil
	}
	return json.Marshal(j)
}

func (j *JSON) Scan(src any) error {
	if src == nil {
		*j = nil
		return nil
	}
	var data []byte
	switch v := src.(type) {
	case []byte:
		data = v
	case string:
		data = []byte(v)
	default:
		return errors.New("model: unsupported scan type for JSON")
	}
	return json.Unmarshal(data, j)
}

// UserStatus 用户状态枚举
const (
	UserStatusActive   = "active"
	UserStatusDisabled = "disabled"
	UserStatusDeleted  = "deleted"
)

// RoleCode 内置角色编码常量
// 2026-09-17 权限重构（D-03）：内置角色只剩 admin + user；
// editor/viewer 已废弃（迁移见 db/260917_role_permission_v2.sql），自定义角色由用户创建。
const (
	RoleAdmin = "admin" // 全权限，矩阵锁定不可改
	RoleUser  = "user"  // 默认角色：个人域全权限，不含用户/角色管理；矩阵可调
)
