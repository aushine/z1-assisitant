// Package dto 经期模块 DTO
//
// 契约见 md/spec-260919/05-API规范.md（响应只写 data 部分）。
// 三条铁律：
//  1. 心情 / 精力 / 备注走既有 mood_logs（mood 1-5 单选、energy 1-3、note ≤50 字），
//     不新建表、不引入「心情 key 数组」；
//  2. 预测结果不落表，随所有 period 接口以 prediction 对象返回（03 §12）；
//  3. 日期一律 YYYY-MM-DD（用户本地日期，后端不做时区换算）。
package dto

// ============================================================================
// 预测结果（03-预测算法规范.md §12）—— 前端只渲染，不做任何计算
// ============================================================================

// PeriodPrediction 预测对象（所有 period 接口的公共尾巴）
type PeriodPrediction struct {
	Today            string `json:"today"`
	Confidence       string `json:"confidence"`        // high / medium / low / insufficient
	ConfidenceReason string `json:"confidence_reason"` // 显示在概览卡 ⓘ 弹层里
	SampleSize       int    `json:"sample_size"`

	// 数据不足（insufficient）时以下字段除 stats 外全部为 null，
	// 前端据此隐藏所有具体日期 —— 这是本模块最重要的一条约束。
	CurrentCycle    *PeriodCurrentCycle    `json:"current_cycle,omitempty"`
	NextPeriod      *PeriodNextPeriod      `json:"next_period,omitempty"`
	Ovulation       *PeriodOvulation       `json:"ovulation,omitempty"`
	FertileWindow   *PeriodFertileWindow   `json:"fertile_window,omitempty"`
	PMSWindow       *PeriodDateRange       `json:"pms_window,omitempty"`
	SafeWindows     []PeriodDateRange      `json:"safe_windows"`
	Stats           *PeriodPredictionStats `json:"stats,omitempty"`
	SymptomForecast []PeriodSymptomItem    `json:"symptom_forecast"`
	Alerts          []PeriodAlert          `json:"alerts"`
}

// PeriodPhase 阶段（四相）
type PeriodPhase struct {
	Key   string `json:"key"`   // menstrual / follicular / ovulation / luteal
	Label string `json:"label"` // 月经期 / 卵泡期 / 排卵期 / 黄体期
	Desc  string `json:"desc"`  // 一句话特征（UI 文案）
}

// PeriodCurrentCycle 当前周期
type PeriodCurrentCycle struct {
	StartDate       string       `json:"start_date"`
	DayIndex        int          `json:"day_index"`        // 1-based，D1 = 经期第一天
	EstimatedLength int          `json:"estimated_length"` // C_hat
	Phase           *PeriodPhase `json:"phase,omitempty"`
}

// PeriodNextPeriod 下次经期
type PeriodNextPeriod struct {
	Date      string   `json:"date"`   // 中心日（区间模式下仍给，前端按 confidence 决定展示单日或区间）
	Window    []string `json:"window"` // [下界, 上界]，high 时两端相同
	LengthEst int      `json:"length_est"`
	EndEst    string   `json:"end_est,omitempty"`
	DaysUntil int      `json:"days_until"`
	Overdue   bool     `json:"overdue"`
}

// PeriodOvulation 排卵日
type PeriodOvulation struct {
	Date   string   `json:"date"`
	Window []string `json:"window"`
	Passed bool     `json:"passed"`
}

// PeriodFertileWindow 易孕期
type PeriodFertileWindow struct {
	Start string   `json:"start"`
	End   string   `json:"end"`
	Peak  []string `json:"peak"` // [峰值起, 峰值止]
}

// PeriodDateRange 通用日期区间
type PeriodDateRange struct {
	Start string `json:"start"`
	End   string `json:"end"`
}

// PeriodPredictionStats 统计特征（无论置信度都给，供 ⓘ 弹层展示「凭什么」）
type PeriodPredictionStats struct {
	MedianCycle  int     `json:"median_cycle"`
	Sigma        float64 `json:"sigma"`
	RecentCycles []int   `json:"recent_cycles"`
	MedianPeriod int     `json:"median_period"`
	LutealLength int     `json:"luteal_length"`
}

// PeriodSymptomItem 症状预测项（03 §11）
type PeriodSymptomItem struct {
	Key   string  `json:"key"`
	Label string  `json:"label"`
	Rate  float64 `json:"rate"`
}

// PeriodAlert 异常提醒（03 §10）
type PeriodAlert struct {
	Code  string `json:"code"`  // CYCLE_SHORT / CYCLE_LONG / PERIOD_LONG / IRREGULAR / NO_PERIOD_90 / SUSPECT_RECORD
	Level string `json:"level"` // warning / info
	Text  string `json:"text"`
}

// ============================================================================
// 日记录
// ============================================================================

// PeriodDayDetail 一天的完整日记（period_days ∪ mood_logs）
// 心情三字段来自 mood_logs 的 LEFT JOIN；该行不存在时 mood / energy 为 null。
type PeriodDayDetail struct {
	Date        string   `json:"date"`
	Flow        int      `json:"flow"`
	Symptoms    []string `json:"symptoms"`
	PainLevel   int      `json:"pain_level"`
	Discharge   int      `json:"discharge"`
	BBT         *float64 `json:"bbt"`
	Weight      *float64 `json:"weight"`
	SleepHours  *float64 `json:"sleep_hours"`
	Intercourse int      `json:"intercourse"`
	// ↓ mood_logs 三字段
	Mood   *int   `json:"mood"`
	Energy *int   `json:"energy"`
	Note   string `json:"note"`
}

// PeriodLastValues 供「沿用上次」chip
type PeriodLastValues struct {
	BBT    *float64 `json:"bbt"`
	Weight *float64 `json:"weight"`
}

// ============================================================================
// 1. GET /period/overview
// ============================================================================

// PeriodOverviewReq 概览查询
type PeriodOverviewReq struct {
	Date string `json:"date" v:"date" dc:"以哪一天为「今天」计算，默认服务端当天"`
}

// PeriodSettingsResp 经期设置（每用户一行，懒创建，GET 永远有值）
type PeriodSettingsResp struct {
	AvgCycleLength       int    `json:"avg_cycle_length"`
	AvgPeriodLength      int    `json:"avg_period_length"`
	LutealLength         int    `json:"luteal_length"`
	Goal                 int    `json:"goal"`
	ShowFertileWindow    int    `json:"show_fertile_window"`
	IrregularAlert       int    `json:"irregular_alert"`
	LastPeriodStart      string `json:"last_period_start,omitempty"`
	DisclaimerAcceptedAt string `json:"disclaimer_accepted_at,omitempty"`
}

// PeriodOverviewResp 概览响应（一次拉齐）
type PeriodOverviewResp struct {
	Initialized        bool                `json:"initialized"`     // false = 从没记录过，前端显示引导卡
	HasEnoughData      bool                `json:"has_enough_data"` // false = 数据不足，禁止展示具体日期
	Today              string              `json:"today"`
	TodayLog           *PeriodDayDetail    `json:"today_log"`
	Prediction         *PeriodPrediction   `json:"prediction,omitempty"`
	Settings           *PeriodSettingsResp `json:"settings"`
	DisclaimerAccepted bool                `json:"disclaimer_accepted"`
}

// ============================================================================
// 2. GET /period/calendar
// ============================================================================

// PeriodCalendarReq 月历查询
type PeriodCalendarReq struct {
	Month string `json:"month" v:"required|length:7,7" dc:"YYYY-MM"`
}

// PeriodCalendarDay 有标记的一天（无标记的日期不返回）
type PeriodCalendarDay struct {
	Date  string   `json:"date"`
	Marks []string `json:"marks"`
}

// PeriodCalendarResp 月历响应
type PeriodCalendarResp struct {
	Month      string              `json:"month"`
	Days       []PeriodCalendarDay `json:"days"`
	Prediction *PeriodPrediction   `json:"prediction,omitempty"`
}

// 月历 mark 取值（与 05 §2 表格一致）
const (
	MarkPeriod          = "period"
	MarkPeriodPredicted = "period_predicted"
	MarkFlowLight       = "flow_light"
	MarkFlowMedium      = "flow_medium"
	MarkFlowHeavy       = "flow_heavy"
	MarkSpotting        = "spotting"
	MarkFertile         = "fertile"
	MarkPeak            = "peak"
	MarkOvulation       = "ovulation"
	MarkToday           = "today"
	MarkLogged          = "logged"
)

// ============================================================================
// 3. GET /period/days
// ============================================================================

// ListPeriodDaysReq 区间日记查询
type ListPeriodDaysReq struct {
	Start string `json:"start" v:"required|date" dc:"起始日期 YYYY-MM-DD"`
	End   string `json:"end"   v:"required|date" dc:"结束日期 YYYY-MM-DD（含当天）"`
}

// ListPeriodDaysResp 区间日记响应
type ListPeriodDaysResp struct {
	Items []PeriodDayDetail `json:"items"`
	Total int               `json:"total"`
}

// ============================================================================
// 4. GET /period/days/:date
// ============================================================================

// PeriodDayDetailResp 单日详情
type PeriodDayDetailResp struct {
	// Day 为 null 仅当 period_days 与 mood_logs 两行都不存在（浮层要打开一张空表）
	Day            *PeriodDayDetail  `json:"day"`
	RecentSymptoms []string          `json:"recent_symptoms"`
	LastValues     *PeriodLastValues `json:"last_values,omitempty"`
}

// ============================================================================
// 5. PUT /period/days/:date
// ============================================================================

// UpsertPeriodDayReq 写入某天日记（整体覆盖语义）
//
// 指针字段的作用是区分「没给」与「给了空值」：
//   - bbt / weight / sleep_hours：没给 → 置 NULL
//   - mood / energy / note：三个都没给 → 不触碰既有 mood_logs 行；
//     只要给了任一（哪怕 mood = 0）→ 整体覆盖
type UpsertPeriodDayReq struct {
	// Date 由 controller 从路径参数 :date 回填（放 body 里也可，路径优先）
	Date        string   `json:"date"                          dc:"YYYY-MM-DD"`
	Flow        int      `json:"flow"         v:"between:0,4"      dc:"0未记录 1点滴 2量少 3中等 4量多"`
	Symptoms    []string `json:"symptoms"                          dc:"症状 key 数组，未知 key 静默丢弃"`
	PainLevel   int      `json:"pain_level"   v:"between:0,5"      dc:"痛经等级 0-5"`
	Discharge   int      `json:"discharge"    v:"between:0,5"      dc:"0未记录 1干燥 2粘稠 3乳白 4水样 5蛋清拉丝"`
	BBT         *float64 `json:"bbt"                               dc:"基础体温 ℃ 34.00-42.00"`
	Weight      *float64 `json:"weight"                            dc:"体重 kg 20.00-300.00"`
	SleepHours  *float64 `json:"sleep_hours"                       dc:"睡眠时长 h 0.0-24.0"`
	Intercourse int      `json:"intercourse"  v:"between:0,2"      dc:"0未记录 1有(未避孕) 2有(避孕)"`
	Mood        *int     `json:"mood"                              dc:"1-5；0 = 不填"`
	Energy      *int     `json:"energy"                            dc:"1-3；0 = 不填"`
	Note        *string  `json:"note"         v:"length:0,50"      dc:"备注 ≤50 字"`
}

// UpsertPeriodDayResp 写入结果
type UpsertPeriodDayResp struct {
	Day           *PeriodDayDetail  `json:"day"`
	CyclesChanged bool              `json:"cycles_changed"` // 前端据此决定要不要清月历缓存
	Prediction    *PeriodPrediction `json:"prediction,omitempty"`
}

// ============================================================================
// 7. GET /period/cycles
// ============================================================================

// ListPeriodCyclesReq 周期列表查询
type ListPeriodCyclesReq struct {
	Limit int `json:"limit" v:"max:120" d:"12" dc:"取最近 N 个，默认 12"`
}

// PeriodCycleResp 周期响应
type PeriodCycleResp struct {
	ID              string `json:"id"`
	StartDate       string `json:"start_date"`
	EndDate         string `json:"end_date,omitempty"`
	PeriodLength    int    `json:"period_length"`
	CycleLength     *int   `json:"cycle_length"`
	IsOngoing       bool   `json:"is_ongoing"`
	IsManual        bool   `json:"is_manual"`
	OvulationDate   string `json:"ovulation_date,omitempty"`
	OvulationSource int    `json:"ovulation_source"`
	Gap             bool   `json:"gap"`
	Suspect         bool   `json:"suspect"`
	Note            string `json:"note,omitempty"`
}

// ListPeriodCyclesResp 周期列表响应
type ListPeriodCyclesResp struct {
	Items []PeriodCycleResp `json:"items"`
	Total int               `json:"total"`
}

// ============================================================================
// 8. PATCH /period/cycles/:id
// ============================================================================

// PatchPeriodCycleReq 人工修正周期（period:manage）
type PatchPeriodCycleReq struct {
	// ID 由 controller 从路径参数 :id 回填
	ID        string  `json:"id"                            dc:"路径参数，由 controller 回填"`
	StartDate string  `json:"start_date" v:"date"              dc:"修正后的第一天；空 = 不改"`
	EndDate   *string `json:"end_date"                         dc:"修正后的最后一天；nil = 不改，空串 = 清空（进行中）"`
	Note      string  `json:"note"       v:"length:0,255"      dc:"周期备注"`
}

// PatchPeriodCycleResp 修正结果
type PatchPeriodCycleResp struct {
	Cycle      *PeriodCycleResp  `json:"cycle"`
	Prediction *PeriodPrediction `json:"prediction,omitempty"`
}

// ============================================================================
// 9. GET / PATCH /period/settings
// ============================================================================

// PatchPeriodSettingsReq 部分更新设置（只传要改的字段）
type PatchPeriodSettingsReq struct {
	AvgCycleLength    *int    `json:"avg_cycle_length"    v:"between:15,60" dc:"默认周期长度"`
	AvgPeriodLength   *int    `json:"avg_period_length"   v:"between:1,15"  dc:"默认经期长度"`
	LutealLength      *int    `json:"luteal_length"       v:"between:9,18"  dc:"黄体期长度"`
	Goal              *int    `json:"goal"                v:"between:1,4"   dc:"1仅记录 2备孕 3避孕参考 4围绝经期"`
	ShowFertileWindow *int    `json:"show_fertile_window" v:"in:0,1"        dc:"是否显示易孕期/排卵日"`
	IrregularAlert    *int    `json:"irregular_alert"     v:"in:0,1"        dc:"是否开启异常提醒"`
	LastPeriodStart   *string `json:"last_period_start"   v:"date"          dc:"上次经期开始日"`
	// AcceptDisclaimer 首次免责确认（写 disclaimer_accepted_at = now）
	AcceptDisclaimer *bool `json:"accept_disclaimer" dc:"确认免责声明"`
}

// ============================================================================
// 10. POST /period/setup
// ============================================================================

// PeriodSetupReq 引导向导提交（一次性，避免填到一半断网留下半个状态）
type PeriodSetupReq struct {
	LastPeriodStart   string `json:"last_period_start"   v:"required|date" dc:"上次经期开始日"`
	AvgPeriodLength   int    `json:"avg_period_length"   v:"between:1,15"  dc:"经期持续天数"`
	AvgCycleLength    int    `json:"avg_cycle_length"    v:"between:15,60" dc:"平均周期长度"`
	Goal              int    `json:"goal"                v:"between:1,4"   dc:"目标模式"`
	ShowFertileWindow int    `json:"show_fertile_window" v:"in:0,1"        dc:"是否显示易孕期"`
}

// PeriodSetupResp 引导提交结果
type PeriodSetupResp struct {
	Prediction  *PeriodPrediction `json:"prediction,omitempty"`
	CreatedDays int               `json:"created_days"`
}

// ============================================================================
// 12. POST /period/reset
// ============================================================================

// PeriodResetReq 整模块重置（需二次确认）
type PeriodResetReq struct {
	Confirm string `json:"confirm" v:"required" dc:"必须为字符串 RESET"`
}

// ============================================================================
// 11. GET /period/report?range=6m|12m（P1）
// ============================================================================

// PeriodReportReq 周期报告查询
type PeriodReportReq struct {
	Range string `json:"range" v:"in:6m,12m" d:"6m" dc:"统计区间，默认 6m"`
}

// PeriodReportSummary 报告汇总
type PeriodReportSummary struct {
	CycleCount  int     `json:"cycle_count"`
	AvgCycle    float64 `json:"avg_cycle"`
	MedianCycle int     `json:"median_cycle"`
	MinCycle    int     `json:"min_cycle"`
	MaxCycle    int     `json:"max_cycle"`
	Sigma       float64 `json:"sigma"`
	AvgPeriod   float64 `json:"avg_period"`
	Regularity  string  `json:"regularity"` // high / medium / low（由 σ 映射，03 §4）
}

// PeriodReportTrendItem 周期趋势项
type PeriodReportTrendItem struct {
	StartDate    string `json:"start_date"`
	CycleLength  *int   `json:"cycle_length"`
	PeriodLength int    `json:"period_length"`
}

// PeriodFlowBucket 经量分布
type PeriodFlowBucket struct {
	Flow int `json:"flow"`
	Days int `json:"days"`
}

// PeriodSymptomFreq 症状频次
type PeriodSymptomFreq struct {
	Key   string  `json:"key"`
	Label string  `json:"label"`
	Count int     `json:"count"`
	Rate  float64 `json:"rate"`
}

// PeriodSymptomPhase 症状与阶段的关联
type PeriodSymptomPhase struct {
	Key           string  `json:"key"`
	DominantPhase string  `json:"dominant_phase"`
	Rate          float64 `json:"rate"`
}

// PeriodBBTPoint 基础体温序列点
type PeriodBBTPoint struct {
	Date string  `json:"date"`
	BBT  float64 `json:"bbt"`
}

// PeriodReportResp 周期报告响应
type PeriodReportResp struct {
	Range            string                  `json:"range"`
	Summary          *PeriodReportSummary    `json:"summary"`
	CycleTrend       []PeriodReportTrendItem `json:"cycle_trend"`
	FlowDistribution []PeriodFlowBucket      `json:"flow_distribution"`
	SymptomFrequency []PeriodSymptomFreq     `json:"symptom_frequency"`
	SymptomPhaseCorr []PeriodSymptomPhase    `json:"symptom_phase_correlation"`
	BBTSeries        []PeriodBBTPoint        `json:"bbt_series"`
	Alerts           []PeriodAlert           `json:"alerts"`
	SymptomForecast  []PeriodSymptomItem     `json:"symptom_forecast"`
}
