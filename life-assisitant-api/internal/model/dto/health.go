// Package dto 健康模块传输对象（md/spec-20260919-v1/07 §1）
//
// 设计约束：
//
//  1. 一天的记录由**三张表**拼成（07 §4 事务边界）：
//
//     health_days  饮水 / 体重 / 体温 / 睡眠 / 排便
//     period_days  经量 / 症状 / 疼痛 / 分泌物 / 性生活
//     mood_logs    心情 / 精力 / 备注（**按小时**，260919 改造）
//
//  2. 写接口是「整体覆盖」：请求体里没给的字段一律置为「未记录」。
//     唯一的例外是 period / moods 两个**子块**：子块整体缺省 = 不触碰既有行
//     —— 记体重时不该把当天已经填过的经期事实抹掉。
//
//  3. 心情按小时存，所以 moods 块落库时要选一个目标小时：
//     记今天 = 服务端当前小时；补记历史某天 = model.MoodDiaryHour（12，一天一条槽位）。
package dto

import "strings"

// ============================================================================
// 通用块
// ============================================================================

// HealthPeriodBlock 经期事实块（period_days）
type HealthPeriodBlock struct {
	// Flow 经量 0–4（0 = 未记录 / 无；1 = 点滴；2/3/4 = 少/中/多）
	Flow int `json:"flow"`
	// Symptoms 症状 key 数组，命中经期词库；未知 key 服务端静默丢弃
	Symptoms []string `json:"symptoms"`
	// PainLevel 疼痛程度 0–3
	PainLevel int `json:"pain_level"`
	// Discharge 分泌物 0–3
	Discharge int `json:"discharge"`
	// Intercourse 性生活 0/1
	Intercourse int `json:"intercourse"`
}

// HealthMoodBlock 心情块（mood_logs 的某一小时）
//
// ⚠️ mood_logs 是按小时的（UNIQUE(user_id,date,hour)），本块只是「一天一张表单」
// 的视图。读取时取：记今天 → 当前小时（含向前延续）；补记历史 → 日记槽位 hour=12。
type HealthMoodBlock struct {
	Mood   int    `json:"mood"`   // 1–5，0 = 未记录
	Energy int    `json:"energy"` // 1–3，0 = 未记录
	Note   string `json:"note"`   // ≤50 字；不跨小时延续
}

// HealthDayDetail 一天的完整健康记录（三表拼装结果）
type HealthDayDetail struct {
	Date string `json:"date"`

	// ↓ health_days
	WaterML    int      `json:"water_ml"`
	WeightKG   *float64 `json:"weight_kg"`
	BBT        *float64 `json:"bbt"`
	SleepHours *float64 `json:"sleep_hours"`
	BowelCount int      `json:"bowel_count"`
	BowelType  int      `json:"bowel_type"` // 0–4（见 model.BowelType*）

	// ↓ period_days（未启用经期时仍返回零值块，避免前端到处判空）
	Period *HealthPeriodBlock `json:"period"`
	// ↓ mood_logs
	Moods *HealthMoodBlock `json:"moods"`
	// ↓ health_events（时间轴明细，按 time 升序）
	//
	// ⚠️ 2026-09-19 起身体指标改为**多次时间轴记录**，这里带上当天全部事件，
	// 浮层打开就能直接画时间轴，不必再调一次 /health/events。
	// nil 与空数组都表示「这天没有事件」，前端用 `events?.length ?? 0` 判断即可。
	Events []HealthEventItem `json:"events,omitempty"`
}

// IsEmpty 三个字段全空（用于判断「这一天到底有没有心情记录」）
//
// ⚠️ 注意区分：Mood=0 只代表「这一小时没单独记心情」，整体为空才代表没记录。
func (m *HealthMoodBlock) IsEmpty() bool {
	return m == nil || (m.Mood == 0 && m.Energy == 0 && strings.TrimSpace(m.Note) == "")
}

// HealthLastValues 供「沿用上次」chip（07 §1.4）
//
// ⚠️ 只装 health_days 的两项：体重 / 体温在 2026-09-19 已从 period_days 迁走，
// 所以叫 health_last_values 而不是旧经期模块的 last_values。
type HealthLastValues struct {
	BBT      *float64 `json:"bbt"`
	WeightKG *float64 `json:"weight_kg"`
}

// ============================================================================
// 1. GET /health/overview
// ============================================================================

// HealthOverviewReq 概览查询
type HealthOverviewReq struct {
	Date string `json:"date" dc:"以哪一天为「今天」计算，默认服务端当天"`
}

// HealthSettingsResp 健康设置（每用户一行，懒创建 → GET 永不 404）
type HealthSettingsResp struct {
	MetricsEnabled []string `json:"metrics_enabled"`
	WaterGoalML    int      `json:"water_goal_ml"`
	// WaterStepML 「一杯」的容量 ml（快捷加水步进）。老行回落 200，见 model.NormalizeWaterStep
	WaterStepML  int      `json:"water_step_ml"`
	WeightGoalKG *float64 `json:"weight_goal_kg,omitempty"`
	// SetupDoneAt RFC3339；未引导时为空串
	SetupDoneAt string `json:"setup_done_at,omitempty"`
}

// HealthTodayProgress 今日完成度（分母只数**启用且可判定**的指标）
type HealthTodayProgress struct {
	Recorded int `json:"recorded"`
	Enabled  int `json:"enabled"`
}

// HealthCard 概览卡的指标行
//
// ⚠️ Tone 只取 normal / neutral —— 刻意不提供 good / bad，
// 防止前端拿去做价值判断给身体上色（07 §1.1）。
//
// ⚠️ 值拼装按 02 §14.2 五型分支（目标型 `1200 / 1500 ml`、次/日型 `55.2 kg`、
// 事件型 `2 次`、周期型 `周期第 26 天`、小时型取最近一次、未记录一律 `—`）。
// Count / State / Latest / Icon 为 02 §14.6 新增字段，供分类卡渲染「x 次」、色条、副值等。
type HealthCard struct {
	Key       string   `json:"key"`
	Label     string   `json:"label"`
	Value     string   `json:"value"` // 主值（未记录 = "—"）
	Progress  *float64 `json:"progress,omitempty"`
	DeltaText string   `json:"delta_text,omitempty"` // 体重等：较上周变化
	// Count 今日记录条数（来自 health_events 的 COUNT，周期/经期类为当日事实数）
	Count int `json:"count,omitempty"`
	// State 记录状态：recorded（已记录）/ empty（未记录，显示 —）/ n/a（周期型未到日子）
	State string `json:"state,omitempty"`
	// Latest 小时型指标（心情/精力）最近一次的时刻，如 "14:00"
	Latest string `json:"latest,omitempty"`
	// Icon 格子左侧图标（Lucide name），可选
	Icon string `json:"icon,omitempty"`
	Tone string `json:"tone"`
}

// 卡片色调
const (
	CardToneNormal  = "normal"
	CardToneNeutral = "neutral"
)

// HealthMonthSummary 月份指标摘要条（月历上方的那一行）
//
// 字段**按启用指标动态填充**：未启用的指标对应字段为零值，由调用方决定是否展示。
type HealthMonthSummary struct {
	Month         string   `json:"month"`
	RecordedDays  int      `json:"recorded_days"`
	WaterGoalDays int      `json:"water_goal_days"`
	WeightAvg     *float64 `json:"weight_avg,omitempty"`
	PeriodDays    int      `json:"period_days"`
}

// HealthOverviewResp 概览响应（一次拉齐，避免前端连打 4 个接口）
type HealthOverviewResp struct {
	Initialized   bool                 `json:"initialized"` // false → 前端进引导页
	Today         string               `json:"today"`
	Settings      *HealthSettingsResp  `json:"settings"`
	TodayLog      *HealthDayDetail     `json:"today_log"` // 无记录 = null
	TodayProgress *HealthTodayProgress `json:"today_progress"`
	// Cards 顺序与指标注册表一致；未启用的指标不出现
	Cards        []HealthCard        `json:"cards"`
	MonthSummary *HealthMonthSummary `json:"month_summary"`
	// Prediction 经期预测；未启用经期时为 null（结构见 dto.PeriodPrediction）
	Prediction *PeriodPrediction `json:"prediction,omitempty"`
}

// ============================================================================
// 2. GET /health/calendar
// ============================================================================

// HealthCalendarReq 月历查询
type HealthCalendarReq struct {
	Month string `json:"month" v:"required|length:7,7" dc:"YYYY-MM"`
}

// HealthCalendarDay 有标记的一天（**无标记的日期不返回**，否则响应体积翻 3 倍）
type HealthCalendarDay struct {
	Date  string   `json:"date"`
	Marks []string `json:"marks"`
}

// HealthCalendarResp 月历响应
type HealthCalendarResp struct {
	Month string              `json:"month"`
	Days  []HealthCalendarDay `json:"days"`
}

// ============================================================================
// 3. GET /health/days
// ============================================================================

// ListHealthDaysReq 区间查询（跨度上限 366 天，由 service 校验）
type ListHealthDaysReq struct {
	Start string `json:"start" dc:"YYYY-MM-DD"`
	End   string `json:"end" dc:"YYYY-MM-DD"`
}

// ListHealthDaysResp 区间记录
type ListHealthDaysResp struct {
	Items []HealthDayDetail `json:"items"`
	Total int               `json:"total"`
}

// ============================================================================
// 4. GET /health/days/:date
// ============================================================================

// HealthDayDetailResp 单日详情（打开浮层时用）
//
// ⚠️ 无记录时 Day = null 且**接口仍返回 200**（浮层要打开一张空表），不是 404。
type HealthDayDetailResp struct {
	Day *HealthDayDetail `json:"day"`
	// RecentSymptoms 近 90 天出现次数降序取前 6；从未记录过 = 空数组（前端据此隐藏分组）
	RecentSymptoms   []string          `json:"recent_symptoms"`
	HealthLastValues *HealthLastValues `json:"health_last_values"`
}

// ============================================================================
// 5. PUT /health/days/:date
// ============================================================================

// UpsertHealthDayReq 写某日健康记录（整体覆盖）
//
// 数值字段用**零值**表示「未记录」，所以不需要指针；
// 只有允许显式 NULL 的三项（体重 / 体温 / 睡眠）用指针区分「没给」与「给 null」。
// ⚠️ 2026-09-19 起变更（老大复核 spec 时提出）：
//
//	water_ml / weight_kg / bbt / sleep_hours / bowel_count / bowel_type 六项**已从本请求移除**。
//	它们的真源变成 health_events（一天多次、不延续），日汇总由后端在写 events 时
//	同一事务内重算写回 health_days —— **这里是只读的**，传了也无效。
//
//	要改身体指标请调 POST/PATCH/DELETE /health/events。
//	留着这些字段只会造成「两个写入口、语义冲突」（整体覆盖 vs 追加一条）。
type UpsertHealthDayReq struct {
	Date string `json:"date"`

	// Period 经期块；**nil = 不触碰既有 period_days 行**
	Period *HealthPeriodBlock `json:"period"`
	// Moods 心情块；**nil = 不触碰既有 mood_logs 行**
	Moods *HealthMoodBlock `json:"moods"`
}

// UpsertHealthDayResp 写响应
type UpsertHealthDayResp struct {
	Day *HealthDayDetail `json:"day"`
	// CyclesChanged period 块影响了经期划分 → true（前端可据此提示「周期已更新」）
	CyclesChanged bool `json:"cycles_changed"`
	// Prediction 重算后的预测，随响应返回，前端不必二次请求
	Prediction *PeriodPrediction `json:"prediction,omitempty"`
}

// ============================================================================
// 7. GET / PATCH /health/settings
// ============================================================================

// PatchHealthSettingsReq 只传要改的字段
//
// ⚠️ MetricsEnabled 为 nil 表示不动；传空数组 [] 表示**用户主动全关**（合法状态）。
// 这个 nil / [] 的区别很重要，别用 len()==0 一并处理。
type PatchHealthSettingsReq struct {
	MetricsEnabled []string `json:"metrics_enabled"`
	WaterGoalML    *int     `json:"water_goal_ml"`
	// WaterStepML 为 nil 表示不动；传 0 或越界 → 归一到 [50,1000] 的 50 倍数
	WaterStepML  *int     `json:"water_step_ml"`
	WeightGoalKG *float64 `json:"weight_goal_kg"`
}

// ============================================================================
// 8. POST /health/setup
// ============================================================================

// HealthPeriodInit 引导里的经期初始化（仅当勾选 period 时携带）
type HealthPeriodInit struct {
	LastPeriodStart string `json:"last_period_start"`
	AvgPeriodLength int    `json:"avg_period_length"`
	AvgCycleLength  int    `json:"avg_cycle_length"`
	Goal            int    `json:"goal"`
}

// HealthSetupReq 首次引导一次性提交
//
// 把「勾选指标 + 饮水目标 + 经期初始化」压成一次请求：
// 分三次提交的话，填到一半断网会留下半个状态（勾选了指标但没初始化经期）。
type HealthSetupReq struct {
	MetricsEnabled []string `json:"metrics_enabled"`
	WaterGoalML    int      `json:"water_goal_ml"`
	// WaterStepML 「一杯」的容量 ml；0 或越界 → 归一到 200
	WaterStepML int               `json:"water_step_ml"`
	PeriodInit  *HealthPeriodInit `json:"period_init"`
}

// HealthSetupResp 引导响应
type HealthSetupResp struct {
	Settings   *HealthSettingsResp `json:"settings"`
	Prediction *PeriodPrediction   `json:"prediction,omitempty"`
	// CreatedDays 批量生成的初始 period_days 行数
	CreatedDays int `json:"created_days"`
}
