// Package model 账户实体
package model

import (
	"time"

	"gorm.io/gorm"
)

// Account 账户表实体
// MVP 字段集：id / user_id / name / type / icon / color / balance / created_at / updated_at / deleted_at
// 软删除：gorm.DeletedAt
// 余额：float64，DB 列 DECIMAL(18,2)，损失精度可接受
// 不做：is_default 标记、credit_limit、billing_date、due_date
type Account struct {
	ID        string         `gorm:"column:id;primaryKey;type:varchar(32)"          json:"id"`
	UserID    string         `gorm:"column:user_id;type:varchar(32);not null;index:idx_user_type,priority:1" json:"user_id"`
	Name      string         `gorm:"column:name;type:varchar(50);not null"           json:"name"`
	Type      string         `gorm:"column:type;type:varchar(20);not null;index:idx_user_type,priority:2" json:"type"`
	Icon      string         `gorm:"column:icon;type:varchar(20);not null;default:💰"  json:"icon"`
	Color     string         `gorm:"column:color;type:varchar(20);not null;default:#E0F2FF" json:"color"`
	Balance   float64        `gorm:"column:balance;type:decimal(18,2);not null;default:0" json:"balance"`
	CreatedAt time.Time      `gorm:"column:created_at;autoCreateTime"               json:"created_at"`
	UpdatedAt time.Time      `gorm:"column:updated_at;autoUpdateTime"               json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"column:deleted_at;index"                        json:"deleted_at,omitempty"`
}

// TableName 显式指定表名
func (a *Account) TableName() string { return "accounts" }

// ====== 账户类型枚举 ======
const (
	AccountTypeSaving  = "saving"  // 储蓄卡
	AccountTypeCredit  = "credit"  // 信用卡
	AccountTypeHuabei  = "huabei"  // 花呗
	AccountTypeWechat  = "wechat"  // 微信零钱
)
