// Package dto 统计模块 DTO
package dto

// StatsOverviewResp 统计概览响应（首页/统计页用）
// MVP 字段：今日任务/本周完成率/本月支出收入/总余额/今日习惯
type StatsOverviewResp struct {
	// 任务
	TodayDoneTasks    int     `json:"today_done_tasks"`     // 今日已完成任务数
	TodayTotalTasks   int     `json:"today_total_tasks"`    // 今日总任务数
	WeekCompletionRate float64 `json:"week_completion_rate"` // 本周完成率 0-100

	// 财务
	MonthExpense float64 `json:"month_expense"` // 本月支出（元）
	MonthIncome  float64 `json:"month_income"`  // 本月收入（元）
	TotalBalance float64 `json:"total_balance"` // 总净资产（元）

	// 习惯
	HabitTodayDone  int `json:"habit_today_done"`  // 今日习惯完成数
	HabitTodayTotal int `json:"habit_today_total"` // 今日习惯总数（active）
}

// ====== 任务统计 ======

// TaskStatsResp 任务统计响应
type TaskStatsResp struct {
	Total                int                `json:"total"`
	Completed            int                `json:"completed"`
	Pending              int                `json:"pending"`
	Overdue              int                `json:"overdue"`
	CompletionRate       float64            `json:"completion_rate"`         // 0-1
	CompletionRateChange float64            `json:"completion_rate_change"`  // -1~1
	ByDay                []TaskDayStat      `json:"by_day"`
	ByCategory           []TaskCategoryStat `json:"by_category"`
}

// TaskDayStat 按日任务统计
type TaskDayStat struct {
	Date      string  `json:"date"`       // YYYY-MM-DD
	Total     int     `json:"total"`
	Completed int     `json:"completed"`
	Rate      float64 `json:"rate"`       // 0-1
}

// TaskCategoryStat 按分类任务统计
type TaskCategoryStat struct {
	Category  string  `json:"category"`
	Emoji     string  `json:"emoji"`
	Color     string  `json:"color"`
	Total     int     `json:"total"`
	Completed int     `json:"completed"`
	Rate      float64 `json:"rate"`
}

// ====== 习惯统计 ======

// HabitStatsResp 习惯统计响应
type HabitStatsResp struct {
	TotalHabits          int                `json:"total_habits"`
	TotalCheckIns        int                `json:"total_check_ins"`
	DailyAverage         float64            `json:"daily_average"`
	LongestStreakOverall int                `json:"longest_streak_overall"`
	ByHabit              []HabitStatItem    `json:"by_habit"`
	Heatmap              []HabitHeatmapItem `json:"heatmap"`
}

// HabitStatItem 单个习惯统计
type HabitStatItem struct {
	HabitID        string  `json:"habit_id"`
	Name           string  `json:"name"`
	Emoji          string  `json:"emoji"`
	Color          string  `json:"color"`
	CompletionRate float64 `json:"completion_rate"`
	CurrentStreak  int     `json:"current_streak"`
	LongestStreak  int     `json:"longest_streak"`
	TodayDone      int     `json:"today_done"`
	TodayTarget    int     `json:"today_target"`
}

// HabitHeatmapItem 习惯热力图项
type HabitHeatmapItem struct {
	Date      string `json:"date"`
	Completed int    `json:"completed"`
	Total     int    `json:"total"`
}

// ====== 财务统计 ======

// FinanceStatsResp 财务统计响应
type FinanceStatsResp struct {
	Expense       float64                  `json:"expense"`
	Income        float64                  `json:"income"`
	Net           float64                  `json:"net"`
	ExpenseChange float64                  `json:"expense_change"` // 同比 %
	IncomeChange  float64                  `json:"income_change"`
	ByDay         []FinanceDayStat         `json:"by_day"`
	ByCategory    []FinanceCategoryStat    `json:"by_category"`
	ByAccount     []FinanceAccountStat     `json:"by_account"`
}

// FinanceDayStat 按日财务统计
type FinanceDayStat struct {
	Date    string  `json:"date"`
	Expense float64 `json:"expense"`
	Income  float64 `json:"income"`
}

// FinanceCategoryStat 按分类财务统计
type FinanceCategoryStat struct {
	Category   string  `json:"category"`
	Emoji      string  `json:"emoji"`
	Color      string  `json:"color"`
	Amount     float64 `json:"amount"`
	Percentage float64 `json:"percentage"` // 0-1
	Count      int     `json:"count"`
}

// FinanceAccountStat 按账户财务统计
type FinanceAccountStat struct {
	Account string  `json:"account"`
	Emoji   string  `json:"emoji"`
	Amount  float64 `json:"amount"`
	Count   int     `json:"count"`
}

// ====== 导出 ======

// ExportReq 导出请求
type ExportReq struct {
	Range     string `json:"range"`                                       // 7d / 30d / 90d / custom
	StartDate string `json:"start_date" v:"date" dc:"起始日期 YYYY-MM-DD"` // custom 时必填
	EndDate   string `json:"end_date"   v:"date" dc:"结束日期 YYYY-MM-DD"`   // custom 时必填
	Type      string `json:"type"       v:"in:tasks,habits,transactions,all" dc:"导出类型"`
	Format    string `json:"format"     v:"in:csv" dc:"导出格式，目前仅 csv"`
}

// ExportResult 导出结果（内部使用）
type ExportResult struct {
	CSV      []byte
	Filename string
}
