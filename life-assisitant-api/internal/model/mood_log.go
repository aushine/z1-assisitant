// Package model 心情/精力日志实体（与 mood_logs 表 1:1）
package model

import (
	"time"
)

// MoodDiaryHour 经期日记的「一天一条」槽位。
//
// 260919 变更：心情/精力从「一天一条」改为「按小时记录」（0-23），
// 唯一键由 UNIQUE(user_id, date) 改为 UNIQUE(user_id, date, hour)。
// 经期日记仍是一天一条 —— 它固定写/读 hour = MoodDiaryHour 这一行，
// 与记录模块的小时制共用同一张表，不新增概念。
const MoodDiaryHour = 12

// MoodLog 心情/精力日志表实体
//
// 字段集：id / user_id / date / hour / mood / energy / note / created_at / updated_at
// 唯一约束：UNIQUE(user_id, date, hour) —— 一天可有多条，按小时记，可随时改
//
// 字段语义（与 dto.MoodHourResp、两端 types.ts 严格一致）：
//   - hour 0-23，真实小时；12 同时是经期日记的槽位（见 MoodDiaryHour）
//   - mood 1-5，0 = 该小时确无心情（读取时按上一条向前延续，仍无才是 0）
//   - energy 1-3 可空（NULL 等价于 0 = 不填）
//   - note ≤50 字，**不延续**，只属于写下它的那个小时
//
// ⚠️ hour 刻意不带 gorm `default` 标签：带了之后 GORM 会把「hour = 0（午夜）」
// 当成零值而省略该列，静默写成 DB 默认值 12。两条写路径（mood 服务 /
// period 服务）都显式赋值，不依赖 DB 默认值。
type MoodLog struct {
	ID        string    `gorm:"column:id;primaryKey;type:varchar(32)" json:"id"`
	UserID    string    `gorm:"column:user_id;type:varchar(32);not null;uniqueIndex:uk_user_date_hour,priority:1" json:"user_id"`
	Date      time.Time `gorm:"column:date;type:date;not null;uniqueIndex:uk_user_date_hour,priority:2" json:"date"`
	Hour      int       `gorm:"column:hour;type:tinyint;not null;uniqueIndex:uk_user_date_hour,priority:3" json:"hour"`
	Mood      int       `gorm:"column:mood;type:tinyint;not null" json:"mood"`
	Energy    *int      `gorm:"column:energy;type:tinyint" json:"energy,omitempty"`
	Note      *string   `gorm:"column:note;type:varchar(200)" json:"note,omitempty"`
	CreatedAt time.Time `gorm:"column:created_at;autoCreateTime" json:"created_at"`
	UpdatedAt time.Time `gorm:"column:updated_at;autoUpdateTime" json:"updated_at"`
}

// TableName 显式指定表名
func (m *MoodLog) TableName() string { return "mood_logs" }

// 心情取值范围
const (
	MoodMin = 1
	MoodMax = 5

	EnergyMin = 1
	EnergyMax = 3

	// 小时取值范围
	HourMin = 0
	HourMax = 23
)

// MoodEnergyValue 归一化精力：NULL 与 0 都表示「不填」
func (m *MoodLog) MoodEnergyValue() int {
	if m.Energy == nil {
		return 0
	}
	return *m.Energy
}

// MoodNoteValue 归一化备注：NULL 与 "" 等价
func (m *MoodLog) MoodNoteValue() string {
	if m.Note == nil {
		return ""
	}
	return *m.Note
}
