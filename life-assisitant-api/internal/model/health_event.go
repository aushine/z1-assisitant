// Package model 健康模块：身体指标**时间轴事件表**（health_events）
//
// 定位（老大 260919 复核 spec 时提出）：体温 / 饮水 / 排便 / 体重 / 睡眠 这些
// **不是一天一个定值** —— 上午喝的水和下午喝的水是两次独立事件，
// 上午腹泻下午正常也是两次独立事件。所以它们必须按**时间轴多次记录**。
//
// ⚠️ 与 mood_logs 的关键区别（别搞混）：
//
//	mood_logs（心情 / 精力）        → 按小时，**向前延续**（没记的小时沿用上一条）
//	health_events（身体指标）       → 按时刻，**不延续**（没记就是没记）
//
//	延续对心情成立（「我现在心情不错」默认持续到我说别的为止）；
//	对喝水 / 排便 / 体温不成立 —— 「09:00 喝了 350ml」不代表 10:00 也喝了 350ml。
//
// ⚠️ 与 health_days 的关系（重要，别写反）：
//
//	health_events  = **唯一真源**（明细，多次）
//	health_days    = **日汇总缓存**（一天一行，由写 events 时同一事务内重算维护）
//
//	读明细（时间轴 UI / 统计曲线 / 形态分布）→ 查 events
//	读当日汇总（概览卡「今日饮水 1200ml」/ 经期算法的 bbt）→ 查 health_days
//
//	之所以保留 health_days 而不是全量实时聚合：概览卡和经期预测是高频读路径，
//	每次实时 SUM 会拖慢；而 events 只在**写**时触发重算，成本可控。
//	⚠️ 代价是双写 —— 所有写 events 的地方必须**在同一事务内**重算 health_days，
//	否则两边会漂（见 service/impl/health.go 的 recomputeDaySummary）。
package model

import "time"

// HealthEvent 一次身体指标记录（时间轴上的一个点）
type HealthEvent struct {
	ID string `gorm:"column:id;primaryKey;type:varchar(32)" json:"id"`
	// ⚠️ 索引必须显式写全名，与手写 DDL 逐字一致。
	// 裸写会触发 GORM MySQL 驱动 MigrateColumnUnique 的「清理冗余唯一索引」逻辑
	// （driver/mysql@v1.5.6/migrator.go:63-79）→ 被外键占用则 Error 1553、API 起不来；
	// 没有外键兜底则**静默丢掉唯一约束**。period_settings 已踩过一次（2026-09-19）。
	UserID string `gorm:"column:user_id;type:varchar(32);not null;index:idx_health_events_user_date,priority:1" json:"user_id"`
	// Date 冗余的日期列（与 TimeOfDay 拆开存）。
	// 按天查询是最高频的路径（时间轴 / 日历 / 日汇总重算），
	// 单独一个 date 列可以直接走索引，不用对 datetime 做 DATE() 函数（会失效索引）。
	Date time.Time `gorm:"column:date;type:date;not null;index:idx_health_events_user_date,priority:2" json:"date"`
	// TimeOfDay 一天内的时刻，"HH:mm" 定长 5 字符（如 "09:20"）。
	// ⚠️ 刻意**不用** datetime / time 类型：
	//   - 排序用字符串即可（"09:20" < "13:40" 字典序成立）；
	//   - 避免时区换算把「上午 9 点」显示成别的钟点；
	//   - 前端直接拿去展示，不用再格式化。
	TimeOfDay string `gorm:"column:time_of_day;type:char(5);not null" json:"time"`
	// MetricKey 指标类型，见下方 MetricKey* 常量
	MetricKey string `gorm:"column:metric_key;type:varchar(32);not null;index:idx_health_events_user_metric,priority:2" json:"metric_key"`

	// ValueNum 数值型取值（decimal）。各 metric_key 的含义见下方注释。
	// ⚠️ 与 ValueInt **二选一**使用，不会同时有值。
	ValueNum *float64 `gorm:"column:value_num;type:decimal(10,2)" json:"value_num,omitempty"`
	// ValueInt 离散枚举取值。目前只有 bowel（排便形态 1–4）用它。
	ValueInt *int `gorm:"column:value_int;type:int" json:"value_int,omitempty"`
	// Note 这一次记录的备注（≤200 字）。
	// ⚠️ 与 mood_logs.note 不同：这里的 note 属于**这一次事件**，不延续、不共享。
	Note string `gorm:"column:note;type:varchar(200);not null;default:''" json:"note"`

	CreatedAt time.Time `gorm:"column:created_at;autoCreateTime" json:"created_at"`
	UpdatedAt time.Time `gorm:"column:updated_at;autoUpdateTime" json:"updated_at"`
}

// TableName 显式指定表名
func (h *HealthEvent) TableName() string { return "health_events" }

// 指标类型（与两端 constants/health.ts 的 METRIC_KEY_* 逐字一致）
//
// ⚠️ 这些 key 同时用于：
//  1. 时间轴分组展示
//  2. 日历分类小点的颜色映射（07 §1.2 的 marks）
//  3. 日汇总重算时的分支
//
// 各 key 取值落在哪一列：
//
//	water   → ValueNum，ml（>0）
//	bbt     → ValueNum，℃（34.00–42.00）
//	weight  → ValueNum，kg（20.00–300.00）
//	sleep   → ValueNum，小时（0.0–24.0）
//	bowel   → ValueInt，形态 1–4（BowelTypeOK/Hard/Soft/Loose）
const (
	MetricKeyWater  = "water"
	MetricKeyBBT    = "bbt"
	MetricKeyWeight = "weight"
	MetricKeySleep  = "sleep"
	MetricKeyBowel  = "bowel"
)

// IsKnownMetricKey 是否是可识别的指标 key（controller 校验用）
func IsKnownMetricKey(k string) bool {
	switch k {
	case MetricKeyWater, MetricKeyBBT, MetricKeyWeight, MetricKeySleep, MetricKeyBowel:
		return true
	}
	return false
}

// UsesValueInt 该指标是否用 ValueInt 列（否则用 ValueNum）
func UsesValueInt(k string) bool { return k == MetricKeyBowel }
