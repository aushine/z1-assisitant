// Package model 经期周期实体（与 period_cycles 表 1:1）
//
// 本表是 period_days 的**幂等派生结果**（RebuildCycles），不是用户输入：
//   - 用户唯一愿意做的输入是「今天有没有出血、量多少」，周期长度/经期长度都应算出来
//   - 唯一需要人工介入的场景是「算错了」（中间漏记），此时允许改 start_date，
//     改完置 IsManual = 1，RebuildCycles 只保护该行的 start/end，其余照常重算
package model

import (
	"time"
)

// PeriodCycle 经期周期
// 字段集：id / user_id / start_date / end_date / period_length / cycle_length
//
//	/ ovulation_date / ovulation_source / is_manual / note / created_at / updated_at
//
// 唯一约束：UNIQUE(user_id, start_date)
type PeriodCycle struct {
	ID              string     `gorm:"column:id;primaryKey;type:varchar(32)"                 json:"id"`
	UserID          string     `gorm:"column:user_id;type:varchar(32);not null;index"        json:"user_id"`
	StartDate       time.Time  `gorm:"column:start_date;type:date;not null"                  json:"start_date"`
	EndDate         *time.Time `gorm:"column:end_date;type:date"                             json:"end_date,omitempty"`
	PeriodLength    int        `gorm:"column:period_length;type:smallint;not null;default:0" json:"period_length"`
	CycleLength     *int       `gorm:"column:cycle_length;type:smallint"                     json:"cycle_length,omitempty"`
	OvulationDate   *time.Time `gorm:"column:ovulation_date;type:date"                       json:"ovulation_date,omitempty"`
	OvulationSource int        `gorm:"column:ovulation_source;type:tinyint;not null;default:0" json:"ovulation_source"`
	IsManual        int        `gorm:"column:is_manual;type:tinyint(1);not null;default:0"   json:"is_manual"`
	Note            string     `gorm:"column:note;type:varchar(255);not null;default:''"     json:"note"`
	CreatedAt       time.Time  `gorm:"column:created_at;autoCreateTime"                      json:"created_at"`
	UpdatedAt       time.Time  `gorm:"column:updated_at;autoUpdateTime"                      json:"updated_at"`
}

// TableName 显式指定表名
func (p *PeriodCycle) TableName() string { return "period_cycles" }

// OvulationSource 排卵日的来源（可信度递增）
const (
	OvulationSourceNone   = 0 // 无
	OvulationSourceAlgo   = 1 // 算法推算（下次经期 − 黄体期）
	OvulationSourceBBT    = 2 // 基础体温法确认（事后确认，可校准黄体期长度）
	OvulationSourceManual = 3 // 用户手动标记
)

// IsOngoing 本次经期是否还在进行中（end_date 为 NULL）
func (p *PeriodCycle) IsOngoing() bool { return p.EndDate == nil }

// HasGap 与上一次间隔 > 90 天（cycle_length 为 NULL，不计入统计）
func (p *PeriodCycle) HasGap() bool { return p.CycleLength == nil }

// IsSuspect 疑似误记（cycle_length < 15 天 → 前端提示复核，但不自动合并）
func (p *PeriodCycle) IsSuspect() bool {
	return p.CycleLength != nil && *p.CycleLength < SuspectCycleLength
}

// RebuildCycles 的判定阈值（见 02 §2 派生规则 6 / 7）
const (
	// GapDays 相邻两次经期开始间隔超过该天数 → 视为「跨越中断」：
	// cycle_length = NULL（避免把「忘记录」当成「超长周期」）
	GapDays = 90

	// SuspectCycleLength 周期短于该天数 → 标记 suspect（可能录错）
	SuspectCycleLength = 15

	// MergeGapDays 组内允许夹的无出血天数（间隔 1 天仍视为同一次经期）
	MergeGapDays = 1
)
