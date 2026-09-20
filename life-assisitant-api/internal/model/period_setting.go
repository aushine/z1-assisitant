// Package model 经期设置实体（与 period_settings 表 1:1）
//
// 每用户一行，首次访问 /period/overview 时**懒创建**（全部默认值），
// 不要求用户先去设置页。
//
// ⚠️ 本表**没有 hide_tab**：用户级「隐藏经期 Tab」已取消，
// 隐私由前端卡片级「眼睛」遮罩承担（设备级 localStorage 状态，不占服务端字段）。
// 见 md/spec-260919/README.md D8 / D11。
package model

import (
	"time"
)

// PeriodSetting 经期设置
// 字段集：id / user_id / avg_cycle_length / avg_period_length / luteal_length / goal
//
//	/ show_fertile_window / irregular_alert / last_period_start
//	/ disclaimer_accepted_at / created_at / updated_at
type PeriodSetting struct {
	ID string `gorm:"column:id;primaryKey;type:varchar(32)" json:"id"`
	// ⚠️ 这里必须写成 uniqueIndex:uk_period_settings_user（全名），
	// **不能省略成名**。索引名与手写 DDL（db/init.sql §period_settings、
	// manifest/sql/0001_init.sql 第 14 节）逐字一致。
	//
	// 省略的后果（2026-09-19 已踩，API 直接起不来）：
	// GORM v1.25.10 的 MySQL 驱动 MigrateColumnUnique 有一段「清理冗余唯一索引」逻辑
	// （driver/mysql@v1.5.6/migrator.go:63-79），它会遍历表上所有单列唯一索引，
	// 凡 name 既不等于 GORM 自算的 UniqueName(table, DBName)（此处为
	// uni_period_settings_user_id）、又不等于本 tag 显式声明的 UniqueIndex 的，一律 DROP。
	// 裸 uniqueIndex 时 field.UniqueIndex 会被算成 idx_period_settings_user_id（IndexName
	// 走的是 Go 字段名 UserID），两个名字都对不上 → 生成
	// `DROP INDEX uk_period_settings_user ON period_settings`。
	// 而本表 user_id 上还挂着 fk_period_setting_user 外键，MySQL 正是拿这个唯一索引
	// 当外键的支撑索引 → 报 Error 1553
	// 「Cannot drop index 'uk_period_settings_user': needed in a foreign key constraint」，
	// AutoMigrate 整体失败 → main.go 里 log.Fatalf → 进程 exit 1。
	//
	// 另注：field.Unique 只由 `unique` 标签置位，`uniqueIndex` 不置位，
	// 所以带上全名后既不会走 DropConstraint，也不会被 CreateConstraint 补出一个重名索引。
	UserID               string     `gorm:"column:user_id;type:varchar(32);not null;uniqueIndex:uk_period_settings_user" json:"user_id"`
	AvgCycleLength       int        `gorm:"column:avg_cycle_length;type:smallint;not null;default:28"    json:"avg_cycle_length"`
	AvgPeriodLength      int        `gorm:"column:avg_period_length;type:smallint;not null;default:5"    json:"avg_period_length"`
	LutealLength         int        `gorm:"column:luteal_length;type:smallint;not null;default:14"       json:"luteal_length"`
	Goal                 int        `gorm:"column:goal;type:tinyint;not null;default:1"                  json:"goal"`
	ShowFertileWindow    int        `gorm:"column:show_fertile_window;type:tinyint(1);not null;default:1" json:"show_fertile_window"`
	IrregularAlert       int        `gorm:"column:irregular_alert;type:tinyint(1);not null;default:1"     json:"irregular_alert"`
	LastPeriodStart      *time.Time `gorm:"column:last_period_start;type:date"                           json:"last_period_start,omitempty"`
	DisclaimerAcceptedAt *time.Time `gorm:"column:disclaimer_accepted_at;type:datetime"                  json:"disclaimer_accepted_at,omitempty"`
	CreatedAt            time.Time  `gorm:"column:created_at;autoCreateTime"                             json:"created_at"`
	UpdatedAt            time.Time  `gorm:"column:updated_at;autoUpdateTime"                             json:"updated_at"`
}

// TableName 显式指定表名
func (p *PeriodSetting) TableName() string { return "period_settings" }

// Goal 目标模式：**只影响文案与默认展示顺序，不做功能阉割**（见 02 §3）
const (
	GoalTrack         = 1 // 仅记录
	GoalConceive      = 2 // 备孕（排卵日与体温项提前）
	GoalContraception = 3 // 避孕参考（易孕期提到最前并强化免责）
	GoalPerimenopause = 4 // 围绝经期（弱化排卵/易孕期，强化周期波动记录）
)

// Goal 取值范围
const (
	GoalMin = GoalTrack
	GoalMax = GoalPerimenopause
)

// 设置项的取值范围（与 md/spec-260919/05-API规范.md §9 的校验逐条对应）
const (
	AvgCycleLengthMin = 15
	AvgCycleLengthMax = 60

	AvgPeriodLengthMin = 1
	AvgPeriodLengthMax = 15

	// LutealLength 个体 11–16 天，取值略放宽到 9–18 以便体温法校准
	LutealLengthMin = 9
	LutealLengthMax = 18

	// DefaultCycleLength / DefaultPeriodLength / DefaultLutealLength 兜底默认值
	DefaultCycleLength  = 28
	DefaultPeriodLength = 5
	DefaultLutealLength = 14
)
