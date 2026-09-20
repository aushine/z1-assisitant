// Package model 健康模块：身体指标逐日事实表（health_days）
//
// 定位（md/spec-20260919-v1/02）：健康 = 「测出来的数」的家。
// 本表承载 饮水 / 体重 / 基础体温 / 睡眠时长 / 排便 五项**客观量化指标**，一天一行。
//
// ⚠️ 与 period_days 的分工（见 04 §5 迁移）：
//   - 2026-09-19 起，weight / bbt / sleep_hours 三列从 period_days 迁到本表；
//   - period_days 只留经期事实（flow / symptoms / pain_level / discharge / intercourse）；
//   - 过渡期新代码**双写**两张表，读只读本表；第二步发布才 DROP 旧列。
//
// ⚠️ 主键与 user_id 的类型：本项目所有业务表一律 `id varchar(32)` + `user_id varchar(32)`
// （utility.NewID 生成的字符串 ID，如 "hd_a1b2c3d4e5f60718"）。
// md/spec-20260919-v1/04 §2 的 DDL 草案写的是 `bigint unsigned` + `int unsigned`，
// 那是**错的** —— 与 users.id（varchar(32)）类型不一致会导致无法建外键/关联。
// 此处按项目真实约定落地，SQL 文件同步。
package model

import (
	"time"
)

// HealthDay 身体指标逐日记录
// 字段集：id / user_id / date / water_ml / weight_kg / bbt / sleep_hours
//
//	/ bowel_count / bowel_type / created_at / updated_at
type HealthDay struct {
	ID string `gorm:"column:id;primaryKey;type:varchar(32)" json:"id"`
	// ⚠️ 复合唯一索引 (user_id, date)：两个字段写**同一个**索引名 + priority 定序。
	// 必须显式写全名，与手写 DDL 逐字一致。裸写会触发 GORM MySQL 驱动
	// MigrateColumnUnique 的「清理冗余唯一索引」逻辑（driver/mysql@v1.5.6/migrator.go:63-79）
	// → 被外键占用则 Error 1553、API 起不来；没有外键兜底则**静默丢掉唯一约束**。
	// period_settings 已踩过一次（2026-09-19）。
	UserID string    `gorm:"column:user_id;type:varchar(32);not null;uniqueIndex:uk_health_days_user_date,priority:1" json:"user_id"`
	Date   time.Time `gorm:"column:date;type:date;not null;uniqueIndex:uk_health_days_user_date,priority:2" json:"date"`

	// WaterML 当日累计饮水 ml（0–10000）。存「当日累计」而不是每次喝的流水：
	// 喝水频次太高（一天 5–8 次），逐条会淹没用户；用户也从不回看「12:40 喝了多少」。
	WaterML int `gorm:"column:water_ml;type:int;not null;default:0" json:"water_ml"`
	// WeightKG 体重 kg（20.00–300.00），NULL = 当天没称
	WeightKG *float64 `gorm:"column:weight_kg;type:decimal(5,2)" json:"weight_kg,omitempty"`
	// BBT 基础体温 ℃（34.00–42.00），NULL = 当天没量
	// ⚠️ 经期算法的「体温法排卵确认」改读本列（原读 period_days.bbt，见 04 §6）
	BBT *float64 `gorm:"column:bbt;type:decimal(4,2)" json:"bbt,omitempty"`
	// SleepHours 睡眠时长 h（0.0–24.0）
	SleepHours *float64 `gorm:"column:sleep_hours;type:decimal(3,1)" json:"sleep_hours,omitempty"`
	// BowelCount 当日排便次数 0–9
	BowelCount int `gorm:"column:bowel_count;type:tinyint;not null;default:0" json:"bowel_count"`
	// BowelType 排便形态 0–4（见下方 BowelType* 常量），0 = 未记录
	BowelType int `gorm:"column:bowel_type;type:tinyint;not null;default:0" json:"bowel_type"`

	CreatedAt time.Time `gorm:"column:created_at;autoCreateTime" json:"created_at"`
	UpdatedAt time.Time `gorm:"column:updated_at;autoUpdateTime" json:"updated_at"`
}

// TableName 显式指定表名
func (h *HealthDay) TableName() string { return "health_days" }

// 排便形态 4 档（md/spec-20260919-v1/03 §5.2）
//
// ⚠️ **刻意不用 Bristol 7 型量表**：那是临床标准，个人向产品的用户不需要 7 个分类的
// 认知负担，多数人也不会为了记录去查量表含义。4 档 + 每档一句人话描述即可。
const (
	BowelTypeNone  = 0 // 未记录
	BowelTypeHard  = 3 // 偏硬：干硬、费力
	BowelTypeSoft  = 2 // 偏软：不成形、偏稀
	BowelTypeLoose = 4 // 腹泻：水样
	BowelTypeOK    = 1 // 正常：成形、顺畅
)

// 取值范围（controller 校验用）
//
// ⚠️ 体重 / 体温 / 睡眠的取值范围**复用 period_day.go 里已有的常量**
// （WeightMin · WeightMax · BBTMin · BBTMax · SleepHoursMin · SleepHoursMax）——
// 这三列正是从 period_days 迁过来的，过渡期新代码**双写**两张表，必须用同一组边界，
// 否则会出现「同一份数据在一张表合法、另一张表越界」。
// 第二步发布（ALTER TABLE period_days DROP COLUMN …）后，再把那组常量搬到本文件。
const (
	WaterMLMin    = 0
	WaterMLMax    = 10000 // 超过只提示不阻断，避免出现「我真的喝了这么多却不让我记」
	BowelCountMin = 0
	BowelCountMax = 9
	BowelTypeMin  = BowelTypeNone
	BowelTypeMax  = BowelTypeLoose
)

// DefaultWaterGoalML 默认饮水目标（health_settings.water_goal_ml 的默认值）
const DefaultWaterGoalML = 1500

// HasAnyValue 当天是否有任一非空指标（月历「已记录」灰点的判定依据，02 §5.2）
func (h *HealthDay) HasAnyValue() bool {
	if h == nil {
		return false
	}
	return h.WaterML > 0 ||
		h.WeightKG != nil ||
		h.BBT != nil ||
		h.SleepHours != nil ||
		h.BowelCount > 0 ||
		h.BowelType != BowelTypeNone
}
