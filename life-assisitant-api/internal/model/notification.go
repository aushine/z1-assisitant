// Package model 站内通知实体（与 notifications 表 1:1）
package model

import (
	"time"
)

// Notification 站内通知表实体
// 字段集：id / user_id / type / title / body / is_read / read_at / created_at
type Notification struct {
	ID        string     `gorm:"column:id;primaryKey;type:varchar(32)" json:"id"`
	UserID    string     `gorm:"column:user_id;type:varchar(32);not null;index" json:"user_id"`
	Type      string     `gorm:"column:type;type:varchar(30);not null" json:"type"`
	Title     string     `gorm:"column:title;type:varchar(200);not null" json:"title"`
	Body      *string    `gorm:"column:body;type:varchar(1000)" json:"body,omitempty"`
	IsRead    bool       `gorm:"column:is_read;type:tinyint(1);not null;default:0" json:"is_read"`
	ReadAt    *time.Time `gorm:"column:read_at" json:"read_at,omitempty"`
	CreatedAt time.Time  `gorm:"column:created_at;autoCreateTime" json:"created_at"`
}

// TableName 显式指定表名
func (n *Notification) TableName() string { return "notifications" }

// 通知类型枚举
const (
	NotificationTypeTaskReminder  = "task_reminder"
	NotificationTypeHabitReminder = "habit_reminder"
	NotificationTypeBudgetAlert   = "budget_alert"
	NotificationTypeWeeklyReport  = "weekly_report"
	NotificationTypeSystem        = "system"
)
