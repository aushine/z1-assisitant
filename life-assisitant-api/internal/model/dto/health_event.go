// 健康模块：身体指标**时间轴事件** DTO（health_events）
//
// 对应接口（路由由 router.go 挂载）：
//
//	GET    /health/events?date=              → ListHealthEventsReq / ListHealthEventsResp
//	GET    /health/events?start=&end=        → 同上（区间）
//	POST   /health/events                    → CreateHealthEventReq / CreateHealthEventResp
//	PATCH  /health/events/:id                → PatchHealthEventReq / PatchHealthEventResp
//	DELETE /health/events/:id                → 无响应体（204）
//
// ⚠️ 与 PUT /health/days/:date 的分工（2026-09-19 起）：
//
//	身体指标（water / bbt / weight / sleep / bowel）→ **只走本文件的 events 接口**（多次、不延续）
//	经期块 period + 心情块 moods + 备注         → 仍走 PUT /health/days/:date（一天一张）
//
//	UpsertHealthDayReq 里的 water_ml / bbt / weight_kg / sleep_hours / bowel_* 已**移除** ——
//	那些列的真源变成 events，日汇总由后端在写 events 时同一事务内重算，
//	再接受这些字段就会出现「两个写入口、语义冲突」。
package dto

// 月历「分类小点」的 mark 取值（07 §1.2 扩展）
//
// 老大 260919：原来的 `logged` 灰点只能表达「这天记了点什么」，看不出**记了哪一类**。
// 改成按指标分类上色，日期下方一排可重叠的小点：
//
//	mood   黄   心情（mood_logs 当天有 mood 值）
//	energy 紫   精力 / 睡眠（mood_logs 当天有 energy 值，或 events 里有 sleep）
//	bbt    蓝   基础体温（events metric_key=bbt）
//	water  青   饮水（events metric_key=water）
//	bowel  棕   排便（events metric_key=bowel）
//	weight 灰   体重（events metric_key=weight）
//	period 红   经期（period_days 有出血记录，沿用 dto.MarkPeriod）
//
// ⚠️ `logged` **保留**：它是这些分类点的父集（有任一记录就有），
// 前端在「分类点数量 = 0 但 logged 存在」时仍可画一个中性灰点兜底。
const (
	MarkMetricMood   = "mood"
	MarkMetricEnergy = "energy"
	MarkMetricBBT    = "bbt"
	MarkMetricWater  = "water"
	MarkMetricBowel  = "bowel"
	MarkMetricWeight = "weight"
)

// HealthEventItem 时间轴上的一次记录
type HealthEventItem struct {
	ID        string   `json:"id"`
	Date      string   `json:"date"`       // YYYY-MM-DD
	Time      string   `json:"time"`       // "HH:mm"
	MetricKey string   `json:"metric_key"` // water / bbt / weight / sleep / bowel
	ValueNum  *float64 `json:"value_num,omitempty"`
	ValueInt  *int     `json:"value_int,omitempty"`
	Note      string   `json:"note"`
	CreatedAt string   `json:"created_at"`
	UpdatedAt string   `json:"updated_at"`
}

// ListHealthEventsReq GET /health/events
//
// date 与 (start, end) **二选一**：
//   - 给了 date → 只查这一天（时间轴 UI 打开某天时用）
//   - 给了 start+end → 查区间（统计曲线用），跨度上限 366 天由 service 校验
//   - 两个都没给 → 默认查今天
type ListHealthEventsReq struct {
	Date      string `json:"date"      dc:"YYYY-MM-DD，与 start/end 二选一"`
	Start     string `json:"start"     dc:"YYYY-MM-DD"`
	End       string `json:"end"       dc:"YYYY-MM-DD"`
	MetricKey string `json:"metric_key" dc:"按指标过滤，空=全部"`
}

// ListHealthEventsResp GET /health/events 响应
type ListHealthEventsResp struct {
	Items []HealthEventItem `json:"items"`
	Total int               `json:"total"`
	// Summary 当天的轻量汇总（时间轴 UI 顶部用），只有按单日查询时才给
	Summary *HealthEventDaySummary `json:"summary,omitempty"`
}

// HealthEventDaySummary 某一天从 events 聚合出来的汇总
//
// ⚠️ 与 health_days 的日汇总**同源同算法**（service/impl/health.go 的 recomputeDaySummary），
// 这里只是把它一并返回，省得前端再调一次 overview。
type HealthEventDaySummary struct {
	Date       string   `json:"date"`
	WaterML    int      `json:"water_ml"`    // SUM(water)
	WaterTimes int      `json:"water_times"` // COUNT(water)
	BowelTimes int      `json:"bowel_times"` // COUNT(bowel)
	BowelTypes []int    `json:"bowel_types"` // 当天出现过的形态（按时间升序，可重复）
	WeightKG   *float64 `json:"weight_kg"`   // 最后一次
	BBT        *float64 `json:"bbt"`         // 最早一次（基础体温是晨起的）
	SleepHours *float64 `json:"sleep_hours"` // 最后一次
}

// CreateHealthEventReq POST /health/events
//
// ⚠️ time 允许**不传** —— 后端取服务端当前时刻（HH:mm）。
// 前端不该自己算时间（客户端时钟可能不准，也可能跨时区）。
type CreateHealthEventReq struct {
	Date      string   `json:"date"       v:"required|date" dc:"YYYY-MM-DD"`
	Time      string   `json:"time"       dc:"HH:mm，空=服务端当前时刻"`
	MetricKey string   `json:"metric_key" v:"required"      dc:"water/bbt/weight/sleep/bowel"`
	ValueNum  *float64 `json:"value_num"  dc:"数值型取值（water=bbt=weight=sleep）"`
	ValueInt  *int     `json:"value_int"  dc:"离散取值（bowel 形态 1-4）"`
	Note      string   `json:"note"       v:"length:0,200"  dc:"这一次记录的备注 ≤200 字"`
}

// CreateHealthEventResp POST /health/events 响应
type CreateHealthEventResp struct {
	Item    HealthEventItem        `json:"item"`
	Summary *HealthEventDaySummary `json:"summary,omitempty"`
	// Day 重算后的 health_days 日汇总（前端概览卡可直接替换，不必二次请求）
	Day *HealthDayDetail `json:"day,omitempty"`
}

// PatchHealthEventReq PATCH /health/events/:id
//
// 所有字段可空；只覆盖传了的字段。
// ⚠️ date 与 metric_key **不可改**（改了等于把这条记录挪到别处，应走删除+新建）。
type PatchHealthEventReq struct {
	ID       string   `json:"id" dc:"路径参数，由 controller 回填"`
	Time     *string  `json:"time"      dc:"HH:mm"`
	ValueNum *float64 `json:"value_num"`
	ValueInt *int     `json:"value_int"`
	Note     *string  `json:"note" v:"length:0,200"`
}

// PatchHealthEventResp PATCH /health/events/:id 响应
type PatchHealthEventResp struct {
	Item    HealthEventItem        `json:"item"`
	Summary *HealthEventDaySummary `json:"summary,omitempty"`
	Day     *HealthDayDetail       `json:"day,omitempty"`
}
