// Package model 习惯实体（与 habits 表 1:1）
package model

import (
	"time"

	"gorm.io/gorm"
)

// Habit 习惯表实体
// MVP 字段集：id / user_id / title / description / icon / color /
//
//	frequency / target_count / unit / status / created_at / updated_at / deleted_at
//
// 软删除：gorm.DeletedAt
// 不做：子任务、提醒、重复 RRULE、复杂计划
type Habit struct {
	ID          string  `gorm:"column:id;primaryKey;type:varchar(32)"           json:"id"`
	UserID      string  `gorm:"column:user_id;type:varchar(32);not null;index"    json:"user_id"`
	Title       string  `gorm:"column:title;type:varchar(200);not null"           json:"title"`
	Description *string `gorm:"column:description;type:varchar(500)"             json:"description,omitempty"`
	// Icon 图标引用（lucide:<Name> / emoji）；⚠️ 空 = 继承分类图标（新优先级链，20260922）；
	// varchar(40)：'lucide:' + 名最长 29 字符，20 会静默截断导致图标消失
	Icon          string  `gorm:"column:icon;type:varchar(40);not null;default:''"  json:"icon"`
	Color         string  `gorm:"column:color;type:varchar(20);not null;default:#014DB2" json:"color"`
	Category      string  `gorm:"column:category;type:varchar(20);not null;default:life" json:"category"`
	Frequency     string  `gorm:"column:frequency;type:varchar(20);not null;default:daily" json:"frequency"`
	TargetCount   int     `gorm:"column:target_count;type:int;not null;default:1"   json:"target_count"`
	Unit          *string `gorm:"column:unit;type:varchar(20)"                     json:"unit,omitempty"`
	TrackDuration bool    `gorm:"column:track_duration;type:tinyint(1);not null;default:0" json:"track_duration"`
	// 连续打卡（单位由 frequency 决定：daily=天 / weekly=周 / monthly=月）
	CurrentStreak   int            `gorm:"column:current_streak;type:int;not null;default:0" json:"current_streak"`
	LongestStreak   int            `gorm:"column:longest_streak;type:int;not null;default:0" json:"longest_streak"`
	LastCheckInDate *time.Time     `gorm:"column:last_check_in_date;type:date" json:"last_check_in_date,omitempty"`
	TotalCheckIns   int            `gorm:"column:total_check_ins;type:int;not null;default:0" json:"total_check_ins"`
	Status          string         `gorm:"column:status;type:varchar(16);not null;default:active" json:"status"`
	CreatedAt       time.Time      `gorm:"column:created_at;autoCreateTime"                 json:"created_at"`
	UpdatedAt       time.Time      `gorm:"column:updated_at;autoUpdateTime"                 json:"updated_at"`
	DeletedAt       gorm.DeletedAt `gorm:"column:deleted_at;index"                          json:"deleted_at,omitempty"`
}

// TableName 显式指定表名
func (h *Habit) TableName() string { return "habits" }

// ====== 习惯状态枚举 ======
const (
	HabitStatusActive   = "active"
	HabitStatusArchived = "archived"
)

// ====== 习惯分类枚举 ======
const (
	HabitCategorySport = "sport" // 运动习惯
	HabitCategoryDiet  = "diet"  // 饮食习惯
	HabitCategoryLife  = "life"  // 生活习惯
	HabitCategoryStudy = "study" // 学习习惯
)

// ====== 习惯频率枚举 ======
const (
	HabitFrequencyDaily   = "daily"
	HabitFrequencyWeekly  = "weekly"
	HabitFrequencyMonthly = "monthly"
)
