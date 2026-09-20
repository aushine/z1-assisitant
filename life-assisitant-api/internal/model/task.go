package model

import (
	"time"

	"gorm.io/gorm"
)

// Task 任务表实体
// M5 扩展字段：reminder_at / recurrence_rule / parent_task_id / subtasks_count
type Task struct {
	ID             string         `gorm:"column:id;primaryKey;type:varchar(32)"               json:"id"`
	UserID         string         `gorm:"column:user_id;type:varchar(32);not null;index"        json:"user_id"`
	Title          string         `gorm:"column:title;type:varchar(200);not null"               json:"title"`
	Description    *string        `gorm:"column:description;type:text"                          json:"description,omitempty"`
	Priority       string         `gorm:"column:priority;type:varchar(10);default:normal;index"      json:"priority"`
	Status         string         `gorm:"column:status;type:varchar(16);default:todo;index"     json:"status"`
	CategoryID     *string        `gorm:"column:category_id;type:varchar(32)"                   json:"category_id,omitempty"`
	DueDate        *time.Time     `gorm:"column:due_date;type:date"                             json:"due_date,omitempty"`
	DueTime        *string        `gorm:"column:due_time;type:varchar(5)"                       json:"due_time,omitempty"`
	ReminderAt     *time.Time     `gorm:"column:reminder_at;type:datetime"                      json:"reminder_at,omitempty"`
	RecurrenceRule *string        `gorm:"column:recurrence_rule;type:varchar(255)"              json:"recurrence_rule,omitempty"`
	ParentTaskID   *string        `gorm:"column:parent_task_id;type:varchar(32);index"          json:"parent_task_id,omitempty"`
	SubtasksCount  int            `gorm:"column:subtasks_count;type:int;default:0"              json:"subtasks_count"`
	CreatedAt      time.Time      `gorm:"column:created_at;autoCreateTime"                      json:"created_at"`
	UpdatedAt      time.Time      `gorm:"column:updated_at;autoUpdateTime"                      json:"updated_at"`
	CompletedAt    *time.Time     `gorm:"column:completed_at"                                   json:"completed_at,omitempty"`
	DeletedAt      gorm.DeletedAt `gorm:"column:deleted_at;index"                               json:"deleted_at,omitempty"`
}

// TableName 显式指定表名
func (t *Task) TableName() string { return "tasks" }

// ====== 任务状态枚举 ======
const (
	TaskStatusTodo        = "todo"
	TaskStatusInProgress  = "in_progress"
	TaskStatusDone        = "done"
	TaskStatusArchived    = "archived"
)

// ====== 优先级枚举 ======
const (
	TaskPriorityRelaxed  = "relaxed"
	TaskPriorityNormal   = "normal"
	TaskPriorityImportant = "important"
	TaskPriorityUrgent   = "urgent"
)

// ====== 列表 filter 取值 ======
const (
	TaskFilterAll      = "all"
	TaskFilterToday    = "today"
	TaskFilterUpcoming = "upcoming"
	TaskFilterDone     = "done"
	TaskFilterOverdue  = "overdue"
)
