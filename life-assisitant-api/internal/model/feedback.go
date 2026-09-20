package model

import (
	"time"

	"gorm.io/gorm"
)

// Feedback 反馈表实体
type Feedback struct {
	ID        string         `gorm:"column:id;primaryKey;type:varchar(32)"  json:"id"`
	UserID    string         `gorm:"column:user_id;type:varchar(32);not null;index" json:"user_id"`
	Type      string         `gorm:"column:type;type:varchar(20);not null"  json:"type"` // bug / suggestion / other
	Content   string         `gorm:"column:content;type:text;not null"      json:"content"`
	Contact   *string        `gorm:"column:contact;type:varchar(100)"       json:"contact,omitempty"`
	Status    string         `gorm:"column:status;type:varchar(20);default:pending" json:"status"` // pending / processing / resolved / closed
	Reply     *string        `gorm:"column:reply;type:text"                 json:"reply,omitempty"`
	CreatedAt time.Time      `gorm:"column:created_at;autoCreateTime"       json:"created_at"`
	UpdatedAt time.Time      `gorm:"column:updated_at;autoUpdateTime"       json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"column:deleted_at;index"                json:"deleted_at,omitempty"`
}

// TableName 显式指定表名
func (f *Feedback) TableName() string { return "feedbacks" }
