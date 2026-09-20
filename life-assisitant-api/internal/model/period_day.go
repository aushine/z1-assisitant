// Package model 经期逐日记录实体（与 period_days 表 1:1）
//
// 设计要点（见 md/spec-260919/02-数据模型.md）：
//   - 本表是经期模块的**唯一事实源**：每天一行（UNIQUE(user_id, date)）
//   - flow 是 5 值枚举（未记录/点滴/量少/中等/量多）—— 点滴与经量是同一连续谱上的不同档位
//   - 心情/精力/备注**不在本表**，复用 mood_logs（唯一真源，不二次存储）
//   - 不加 is_period_day 冗余列（恒等于 flow ∈ {2,3,4}，落库就是同步风险）
package model

import (
	"database/sql/driver"
	"encoding/json"
	"errors"
	"time"
)

// StringArray 自定义类型：把 []string 存入 MySQL JSON 列。
// 与 types.go 的 JSON（map）互补 —— 本模块的 period_days.symptoms 是数组而非对象。
type StringArray []string

// Value 实现 driver.Valuer
func (a StringArray) Value() (driver.Value, error) {
	if a == nil {
		return nil, nil
	}
	return json.Marshal(a)
}

// Scan 实现 sql.Scanner
func (a *StringArray) Scan(src any) error {
	if src == nil {
		*a = nil
		return nil
	}
	var data []byte
	switch v := src.(type) {
	case []byte:
		data = v
	case string:
		data = []byte(v)
	default:
		return errors.New("model: unsupported scan type for StringArray")
	}
	if len(data) == 0 {
		*a = nil
		return nil
	}
	return json.Unmarshal(data, a)
}

// PeriodDay 经期逐日记录
// 字段集：id / user_id / date / flow / symptoms / pain_level / discharge
//
//	/ bbt / weight / sleep_hours / intercourse / created_at / updated_at
type PeriodDay struct {
	ID          string      `gorm:"column:id;primaryKey;type:varchar(32)"              json:"id"`
	UserID      string      `gorm:"column:user_id;type:varchar(32);not null;index"     json:"user_id"`
	Date        time.Time   `gorm:"column:date;type:date;not null"                     json:"date"`
	Flow        int         `gorm:"column:flow;type:tinyint;not null;default:0"        json:"flow"`
	Symptoms    StringArray `gorm:"column:symptoms;type:json"                          json:"symptoms,omitempty"`
	PainLevel   int         `gorm:"column:pain_level;type:tinyint;not null;default:0"  json:"pain_level"`
	Discharge   int         `gorm:"column:discharge;type:tinyint;not null;default:0"   json:"discharge"`
	BBT         *float64    `gorm:"column:bbt;type:decimal(4,2)"                       json:"bbt,omitempty"`
	Weight      *float64    `gorm:"column:weight;type:decimal(5,2)"                    json:"weight,omitempty"`
	SleepHours  *float64    `gorm:"column:sleep_hours;type:decimal(3,1)"               json:"sleep_hours,omitempty"`
	Intercourse int         `gorm:"column:intercourse;type:tinyint;not null;default:0" json:"intercourse"`
	CreatedAt   time.Time   `gorm:"column:created_at;autoCreateTime"                   json:"created_at"`
	UpdatedAt   time.Time   `gorm:"column:updated_at;autoUpdateTime"                   json:"updated_at"`
}

// TableName 显式指定表名
func (p *PeriodDay) TableName() string { return "period_days" }

// Flow 经量档位（period_days.flow）
// ⚠️ 点滴出血（FlowSpotting）与经量是同一列的不同档位 —— 不允许出现
// 「有出血 + 点滴」这种非法组合，UI 上第 1 页与第 9 页互斥（见 02 §5）。
const (
	FlowNone     = 0 // 未记录
	FlowSpotting = 1 // 点滴出血（不参与周期划分）
	FlowLight    = 2 // 量少
	FlowMedium   = 3 // 中等
	FlowHeavy    = 4 // 量多
)

// Flow 取值范围（controller 校验用）
const (
	FlowMin = FlowNone
	FlowMax = FlowHeavy
)

// IsBleedingDay 是否算「出血日」（决定周期划分，点滴出血不算）
func (p *PeriodDay) IsBleedingDay() bool {
	return p.Flow == FlowLight || p.Flow == FlowMedium || p.Flow == FlowHeavy
}

// Discharge 分泌物 5 型（按生育力递增）
const (
	DischargeNone     = 0 // 未记录
	DischargeDry      = 1 // 干燥
	DischargeSticky   = 2 // 粘稠
	DischargeCreamy   = 3 // 乳白
	DischargeWatery   = 4 // 水样
	DischargeEggWhite = 5 // 蛋清拉丝（生育力最高的信号）
)

// Discharge 取值范围
const (
	DischargeMin = DischargeNone
	DischargeMax = DischargeEggWhite
)

// Intercourse 性生活记录
const (
	IntercourseNone          = 0 // 未记录
	IntercourseUnprotected   = 1 // 有（未避孕）
	IntercourseContraception = 2 // 有（避孕）
)

// Intercourse 取值范围
const (
	IntercourseMin = IntercourseNone
	IntercourseMax = IntercourseContraception
)

// 数值字段的取值范围（与 md/spec-260919/05-API规范.md §5 的校验表逐条对应）
const (
	PainLevelMin = 0
	PainLevelMax = 5

	BBTMin = 34.0
	BBTMax = 42.0

	WeightMin = 20.0
	WeightMax = 300.0

	SleepHoursMin = 0.0
	SleepHoursMax = 24.0
)
