package model

import "time"

// Role 角色表实体
type Role struct {
	// ID 自增代理键（仅展示排序用，业务主键仍是 Code）：
	// -> = GORM 只读（Create/Update 由 DB auto_increment 负责）；-:migration = 不参与建表迁移
	ID          int64     `gorm:"column:id;->;-:migration"                  json:"id"`
	Code        string    `gorm:"column:code;primaryKey;type:varchar(20)"  json:"code"`
	Name        string    `gorm:"column:name;type:varchar(50);not null"     json:"name"`
	Description *string   `gorm:"column:description;type:varchar(200)"     json:"description,omitempty"`
	// IsSystem/UserCount 原先带 default:true / default:0 tag——GORM 对「零值 + default tag」
	// 字段在 Create 时直接跳列吃 DB 默认值，导致新角色 is_system=false 被写成 true（显示内置）。
	// DB 层 DDL 默认值保留，模型层去掉 tag，插什么是什么。
	IsSystem    bool      `gorm:"column:is_system"                         json:"is_system"`
	UserCount   int       `gorm:"column:user_count"                        json:"user_count"`
	CreatedAt   time.Time `gorm:"column:created_at;autoCreateTime"         json:"created_at"`
	UpdatedAt   time.Time `gorm:"column:updated_at;autoUpdateTime"         json:"updated_at"`
}

func (r *Role) TableName() string { return "roles" }
