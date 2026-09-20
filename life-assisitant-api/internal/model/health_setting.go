// Package model 健康模块：用户级配置（health_settings）
//
// 每用户一行，**懒创建**（GET /health/settings 不存在时按全默认值创建）→ 该接口永不返回 404。
//
// 本表只装三件事：启用了哪些指标（metrics_enabled）、目标值（饮水 / 体重）、引导完成时间。
// ⚠️ **经期算法参数不在这里** —— 周期长度 / 黄体期 / 目标模式属于算法输入，留在
// period_settings（见 md/spec-20260919-v1/02 §9：健康设置只做「入口跳转」，不搬经期设置）。
package model

import (
	"time"
)

// HealthSetting 健康模块用户配置
// 字段集：id / user_id / metrics_enabled / water_goal_ml / weight_goal_kg
//
//	/ setup_done_at / created_at / updated_at
type HealthSetting struct {
	ID     string `gorm:"column:id;primaryKey;type:varchar(32)" json:"id"`
	UserID string `gorm:"column:user_id;type:varchar(32);not null;uniqueIndex:uk_health_settings_user" json:"user_id"`

	// MetricsEnabled 启用的指标 key 数组（唯一真源）。
	// 取值来自指标注册表（internal/utility/health_vocab.go，与两端 constants/health.ts 逐字一致）：
	//
	//	["period","symptoms","mood","energy_sleep","bbt","weight","water","bowel","discharge","sex","note"]
	//
	// 语义（04 §3）：
	//   - null  = 从未配置 → 用注册表的默认集合
	//   - []    = 全部关闭（合法状态，UI 走「去配置」引导态，**不是空白**）
	//   - 未知 key 静默丢弃并记 warn 日志（前端版本不一致时不至于整单失败）
	//
	// ⚠️ 关闭指标**只隐藏 UI，永不删数据**；重新开启历史数据立即恢复可见。
	MetricsEnabled StringArray `gorm:"column:metrics_enabled;type:json" json:"metrics_enabled,omitempty"`

	// WaterGoalML 饮水目标 500–4000，步进 100
	WaterGoalML int `gorm:"column:water_goal_ml;type:int;not null;default:1500" json:"water_goal_ml"`

	// WaterStepML 「一杯」的容量（ml），50–1000，步进 50。
	//
	// 老大 260919 追加：spec 03 §5.1 原定快捷档是写死的 [+200][+300][+500]，
	// 但每个人的杯子大小不一样 —— 快捷加水的步进必须能自己定，
	// 否则「喝一杯记一杯」这件事每次都要按自定义，快捷档就失去意义。
	// 快捷档由此列推导：[+1 杯 = step] [+2 杯 = 2×step]，扣减档 [−1 杯]。
	WaterStepML int `gorm:"column:water_step_ml;type:int;not null;default:200" json:"water_step_ml"`
	// WeightGoalKG 体重目标，**仅趋势参考，不做达标判定**
	// （给体重做「达标」等于 App 替用户评判身体，见 05 §6.2 红线）
	WeightGoalKG *float64 `gorm:"column:weight_goal_kg;type:decimal(5,2)" json:"weight_goal_kg,omitempty"`
	// SetupDoneAt 首次引导完成时间。
	// ⚠️ 用户点「跳过」时**不写**这个字段 —— 否则「跳过 → 立刻被推回引导」死循环。
	// 前端另需一个仅内存的 setupSkipped 标记（经期模块踩过同一个坑）。
	SetupDoneAt *time.Time `gorm:"column:setup_done_at;type:datetime" json:"setup_done_at,omitempty"`

	CreatedAt time.Time `gorm:"column:created_at;autoCreateTime" json:"created_at"`
	UpdatedAt time.Time `gorm:"column:updated_at;autoUpdateTime" json:"updated_at"`
}

// TableName 显式指定表名
func (h *HealthSetting) TableName() string { return "health_settings" }

// 饮水目标的取值范围
const (
	WaterGoalMLMin  = 500
	WaterGoalMLMax  = 4000
	WaterGoalMLStep = 100
)

// 「一杯」容量的取值范围
const (
	WaterStepMLMin     = 50
	WaterStepMLMax     = 1000
	WaterStepMLStep    = 50
	WaterStepMLDefault = 200
)

// IsInitialized 是否已完成首次引导（决定前端是否进引导页）
func (h *HealthSetting) IsInitialized() bool {
	return h != nil && h.SetupDoneAt != nil
}

// WaterStepOrDefault 归一化的「一杯」容量。
//
// 库里存了 0 / 越界值时（老行在加列前的默认值是 0）回落 200，
// 否则快捷档会变成 [+0] / [−0]，点了没反应。
func (h *HealthSetting) WaterStepOrDefault() int {
	if h == nil || h.WaterStepML <= 0 {
		return WaterStepMLDefault
	}
	if h.WaterStepML < WaterStepMLMin {
		return WaterStepMLMin
	}
	if h.WaterStepML > WaterStepMLMax {
		return WaterStepMLMax
	}
	return h.WaterStepML
}

// NormalizeWaterStep 把任意 int 收敛到 [50,1000] 且对齐到 50 的倍数。
//
// ⚠️ 必须**四舍五入**到最近的档位，不能截断 —— 两端共用同一个算法：
// 前端 constants/health.ts 的 normalizeWaterStep 用 Math.round，
// 后端若用整数除法截断，就会出现「前端显示 150、落库是 100」的错位（260919 实测踩到）。
func NormalizeWaterStep(v int) int {
	if v <= 0 {
		return WaterStepMLDefault
	}
	n := ((v + WaterStepMLStep/2) / WaterStepMLStep) * WaterStepMLStep
	if n < WaterStepMLMin {
		return WaterStepMLMin
	}
	if n > WaterStepMLMax {
		return WaterStepMLMax
	}
	return n
}
