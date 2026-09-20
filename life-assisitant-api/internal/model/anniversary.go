// Package model 纪念日 / 倒数日（anniversaries）
//
// 一次设定、长期有效的**档案**，按落位规则（md/spec-20260919-v1/01 §3.2）进「我的」，
// 不占记录模块那 6 个二级 tab 的配额。展示在首页卡片（06 §2），管理在 `/me/anniversaries`。
//
// ⚠️ **不存「下次日期」** —— next_date / days_left 每次实时推导（04 §4）。
// 理由：存了就要有定时任务在每年元旦批量刷新，漏跑则数据静默过期
// （用户看到「还有 −360 天」）；而推导成本是 O(1)，没有任何性能理由要缓存。
package model

import (
	"database/sql/driver"
	"encoding/json"
	"errors"
	"fmt"
	"time"
)

// IntArray JSON 整数数组列（如 remind_days = [7,3,1,0]）
//
// 与 StringArray（period_day.go）同款实现：GORM 读写 MySQL json 列需要
// 自己实现 driver.Valuer / sql.Scanner，否则会报 unsupported type。
type IntArray []int

// Value 实现 driver.Valuer：写入时序列化为 JSON
func (a IntArray) Value() (driver.Value, error) {
	if a == nil {
		return nil, nil
	}
	b, err := json.Marshal(a)
	if err != nil {
		return nil, fmt.Errorf("model: marshal IntArray failed: %w", err)
	}
	return string(b), nil
}

// Scan 实现 sql.Scanner：读出时反序列化
func (a *IntArray) Scan(v interface{}) error {
	if v == nil {
		*a = nil
		return nil
	}
	var data []byte
	switch val := v.(type) {
	case []byte:
		data = val
	case string:
		data = []byte(val)
	default:
		return errors.New("model: unsupported scan type for IntArray")
	}
	if len(data) == 0 {
		*a = nil
		return nil
	}
	return json.Unmarshal(data, a)
}

// Anniversary 纪念日 / 倒数日
// 字段集：id / user_id / title / target_date / repeat_rule / calendar_type
//
//	/ remind_days / category / icon / color / is_pinned / note / created_at / updated_at
type Anniversary struct {
	ID     string `gorm:"column:id;primaryKey;type:varchar(32)" json:"id"`
	UserID string `gorm:"column:user_id;type:varchar(32);not null;index:idx_anniversaries_user_date,priority:1" json:"user_id"`
	Title  string `gorm:"column:title;type:varchar(50);not null" json:"title"`
	// TargetDate 基准日期（**首次发生的那天**，不是下一次的日期）
	TargetDate time.Time `gorm:"column:target_date;type:date;not null;index:idx_anniversaries_user_date,priority:2" json:"target_date"`
	// RepeatRule 重复规则（见下方 RepeatRule* 常量）
	RepeatRule int `gorm:"column:repeat_rule;type:tinyint;not null;default:2" json:"repeat_rule"`
	// CalendarType 历法（见下方 CalendarType* 常量）；农历需先换算成公历再算 next_date
	CalendarType int `gorm:"column:calendar_type;type:tinyint;not null;default:1" json:"calendar_type"`
	// RemindDays 提前几天提醒，子集 {0,1,3,7}；nil / [] = 不提醒
	// ⚠️ 2026-09-19 决策：**本期只存设置，不实际投递**（通知引擎尚不存在，见 06 §4）
	RemindDays IntArray `gorm:"column:remind_days;type:json" json:"remind_days,omitempty"`
	// Category 分类（见下方 Category*），影响默认图标与配色
	Category string `gorm:"column:category;type:varchar(20);not null;default:other" json:"category"`
	// Icon / Color 用户可覆盖的展示属性
	Icon     string `gorm:"column:icon;type:varchar(20);not null;default:calendar-heart" json:"icon"`
	Color    string `gorm:"column:color;type:varchar(20);not null;default:primary" json:"color"`
	IsPinned int    `gorm:"column:is_pinned;type:tinyint;not null;default:0" json:"is_pinned"`
	Note     string `gorm:"column:note;type:varchar(200);not null;default:''" json:"note"`

	CreatedAt time.Time `gorm:"column:created_at;autoCreateTime" json:"created_at"`
	UpdatedAt time.Time `gorm:"column:updated_at;autoUpdateTime" json:"updated_at"`
}

// TableName 显式指定表名
func (a *Anniversary) TableName() string { return "anniversaries" }

// RepeatRule 重复规则
const (
	RepeatNone    = 1 // 不重复（倒数日：过了就过滤掉）
	RepeatYearly  = 2 // 每年（默认）
	RepeatMonthly = 3 // 每月
	RepeatWeekly  = 4 // 每周
)

// CalendarType 历法
const (
	CalendarGregorian = 1 // 公历（默认）
	CalendarLunar     = 2 // 农历
)

// Category 分类
const (
	CategoryBirthday    = "birthday"
	CategoryAnniversary = "anniversary"
	CategoryCountdown   = "countdown"
	CategoryOther       = "other"
)

// 提醒提前量的合法取值（06 §3.2：多选 chips 7/3/1/当天）
const (
	RemindDaySameDay = 0
	RemindDay1       = 1
	RemindDay3       = 3
	RemindDay7       = 7
)
