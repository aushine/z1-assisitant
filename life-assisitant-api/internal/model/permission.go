package model

import "time"

// Permission 权限点实体（模块×操作）
type Permission struct {
	ID          string    `gorm:"column:id;primaryKey;type:varchar(32)"  json:"id"`
	Module      string    `gorm:"column:module;type:varchar(50);not null" json:"module"`
	Action      string    `gorm:"column:action;type:varchar(20);not null" json:"action"`
	Description *string   `gorm:"column:description;type:varchar(200)"   json:"description,omitempty"`
	CreatedAt   time.Time `gorm:"column:created_at;autoCreateTime"        json:"created_at"`
}

func (p *Permission) TableName() string { return "permissions" }

// RolePermission 角色-权限关联（含乐观锁）
type RolePermission struct {
	RoleCode     string    `gorm:"column:role_code;primaryKey;type:varchar(20)"  json:"role_code"`
	PermissionID string    `gorm:"column:permission_id;primaryKey;type:varchar(32)" json:"permission_id"`
	Enabled      bool      `gorm:"column:enabled;default:true"                   json:"enabled"`
	UpdatedAt    time.Time `gorm:"column:updated_at;autoUpdateTime"              json:"updated_at"`
	Version      int       `gorm:"column:version;default:0"                      json:"version"`
}

func (rp *RolePermission) TableName() string { return "role_permissions" }
