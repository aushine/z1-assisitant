package model

import (
	"time"

	"gorm.io/gorm"
)

// Subtask 子任务表实体
type Subtask struct {
	ID          string         `gorm:"column:id;primaryKey;type:varchar(32)"            json:"id"`
	TaskID      string         `gorm:"column:task_id;type:varchar(32);not null;index"   json:"task_id"`
	Title       string         `gorm:"column:title;type:varchar(200);not null"          json:"title"`
	IsCompleted bool           `gorm:"column:is_completed;type:tinyint(1);default:0"    json:"is_completed"`
	Order       int            `gorm:"column:order;type:int;default:0"                  json:"order"`
	CreatedAt   time.Time      `gorm:"column:created_at;autoCreateTime"                 json:"created_at"`
	UpdatedAt   time.Time      `gorm:"column:updated_at;autoUpdateTime"                 json:"updated_at"`
	DeletedAt   gorm.DeletedAt `gorm:"column:deleted_at;index"                          json:"deleted_at,omitempty"`
}

// TableName 显式指定表名
func (s *Subtask) TableName() string { return "subtasks" }
