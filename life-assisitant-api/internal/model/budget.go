// Package model 预算实体
package model

import (
	"time"

	"gorm.io/gorm"
)

// Budget 预算表实体
// MVP 字段集：id / user_id / name / period / amount / start_date / end_date /
//   alert_threshold / is_alerted / scope / category_emoji / category_name / created_at / updated_at
// used 字段不存表，由后端实时从 transactions 表计算（按 start_date~end_date 的 expense 合计）
// scope: total（总预算）/ category（分类预算），默认 total
// 不做：软删除（预算直接物理删）
type Budget struct {
	ID             string         `gorm:"column:id;primaryKey;type:varchar(32)"                     json:"id"`
	UserID         string         `gorm:"column:user_id;type:varchar(32);not null;index:idx_user_period,priority:1" json:"user_id"`
	Name           string         `gorm:"column:name;type:varchar(50);not null"                      json:"name"`
	Period         string         `gorm:"column:period;type:varchar(20);not null;default:monthly"    json:"period"`
	Amount         float64        `gorm:"column:amount;type:decimal(18,2);not null"                  json:"amount"`
	Scope          string         `gorm:"column:scope;type:varchar(20);not null;default:total"       json:"scope"`
	CategoryEmoji  *string        `gorm:"column:category_emoji;type:varchar(20)"                     json:"category_emoji,omitempty"`
	CategoryName   *string        `gorm:"column:category_name;type:varchar(50)"                      json:"category_name,omitempty"`
	// CategoryID 分类 id（权威）；scope=total 时为空，scope=category 时必填且必须是一级分类。
	// ⚠️ 索引名显式写全名，与手写 DDL 逐字一致（02 §1.2 铁律）。
	CategoryID *string `gorm:"column:category_id;type:varchar(32);index:idx_budget_category" json:"category_id,omitempty"`
	StartDate      time.Time      `gorm:"column:start_date;type:date;not null;index:idx_user_period,priority:2" json:"start_date"`
	EndDate        time.Time      `gorm:"column:end_date;type:date;not null;index:idx_user_period,priority:3"   json:"end_date"`
	AlertThreshold float64        `gorm:"column:alert_threshold;type:decimal(3,2);not null;default:0.80" json:"alert_threshold"`
	IsAlerted      bool           `gorm:"column:is_alerted;type:tinyint(1);not null;default:0"       json:"is_alerted"`
	CreatedAt      time.Time      `gorm:"column:created_at;autoCreateTime"                           json:"created_at"`
	UpdatedAt      time.Time      `gorm:"column:updated_at;autoUpdateTime"                           json:"updated_at"`
	DeletedAt      gorm.DeletedAt `gorm:"column:deleted_at;index"                                    json:"deleted_at,omitempty"`
}

// TableName 显式指定表名
func (b *Budget) TableName() string { return "budgets" }

// ====== 预算周期枚举 ======
const (
	BudgetPeriodMonthly = "monthly"
	BudgetPeriodWeekly  = "weekly"
	BudgetPeriodYearly  = "yearly"
)

// ====== 预算范围枚举 ======
const (
	BudgetScopeTotal    = "total"
	BudgetScopeCategory = "category"
)
