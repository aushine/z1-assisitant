// Package model 习惯打卡日志实体
package model

import (
	"time"
)

// HabitLog 习惯打卡日志表实体
// MVP 字段集：id / habit_id / user_id / log_date / count / note / duration_minutes / created_at
// 唯一索引：(habit_id, log_date)
// duration_minutes: 打卡时长（分钟），可选
type HabitLog struct {
	ID              string    `gorm:"column:id;primaryKey;type:varchar(32)"  json:"id"`
	HabitID         string    `gorm:"column:habit_id;type:varchar(32);not null;uniqueIndex:uk_habit_date" json:"habit_id"`
	UserID          string    `gorm:"column:user_id;type:varchar(32);not null;index" json:"user_id"`
	LogDate         time.Time `gorm:"column:log_date;type:date;not null;uniqueIndex:uk_habit_date" json:"log_date"`
	Count           int       `gorm:"column:count;type:int;not null;default:1" json:"count"`
	Note            *string   `gorm:"column:note;type:varchar(500)"           json:"note,omitempty"`
	DurationMinutes int       `gorm:"column:duration_minutes;type:int;not null;default:0" json:"duration_minutes"`
	CreatedAt       time.Time `gorm:"column:created_at;autoCreateTime"        json:"created_at"`
}

// TableName 显式指定表名
func (h *HabitLog) TableName() string { return "habit_logs" }
