// Package dto 首页聚合 DTO
package dto

// HomeResp 首页聚合响应
type HomeResp struct {
	Greeting            string          `json:"greeting"`
	TodayDate           string          `json:"today_date"`
	Weekday             string          `json:"weekday"`
	KPI                 HomeKPI         `json:"kpi"`
	TodayTasks          []HomeTaskItem  `json:"today_tasks"`
	TodayHabits         []HomeHabitItem `json:"today_habits"`
	MonthFinance        HomeMonthFinance `json:"month_finance"`
	UnreadNotifications int             `json:"unread_notifications"`
}

// HomeKPI 首页 KPI
type HomeKPI struct {
	TodoDone          int     `json:"todo_done"`
	TodoTotal         int     `json:"todo_total"`
	TodoRate          float64 `json:"todo_rate"`           // 0-100
	HabitDone         int     `json:"habit_done"`
	HabitTotal        int     `json:"habit_total"`
	HabitRate         float64 `json:"habit_rate"`          // 0-100
	MonthExpense      float64 `json:"month_expense"`
	MonthExpenseChange float64 `json:"month_expense_change"` // 同比 %
	MonthIncome       float64 `json:"month_income"`
	MonthIncomeChange float64 `json:"month_income_change"`
}

// HomeTaskItem 首页任务简表
type HomeTaskItem struct {
	ID           string  `json:"id"`
	Title        string  `json:"title"`
	Priority     string  `json:"priority"`
	Status       string  `json:"status"`
	CategoryEmoji string `json:"category_emoji,omitempty"`
	DueTime      *string `json:"due_time,omitempty"`
}

// HomeHabitItem 首页习惯简表
type HomeHabitItem struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	Icon        string `json:"icon"`
	Color       string `json:"color"`
	TargetCount int    `json:"target_count"`
	TodayCount  int    `json:"today_count"`
	Completed   bool   `json:"completed"` // today_count >= target_count
}

// HomeMonthFinance 首页月度财务
type HomeMonthFinance struct {
	Expense       float64                     `json:"expense"`
	Income        float64                     `json:"income"`
	ExpenseChange float64                     `json:"expense_change"`
	IncomeChange  float64                     `json:"income_change"`
	DailyTrend    []HomeFinanceDailyTrend     `json:"daily_trend"`
	CategoryPie   []HomeFinanceCategoryPie    `json:"category_pie"`
}

// HomeFinanceDailyTrend 首页日支出趋势
type HomeFinanceDailyTrend struct {
	Date   string  `json:"date"`
	Amount float64 `json:"amount"`
}

// HomeFinanceCategoryPie 首页支出分类饼图
type HomeFinanceCategoryPie struct {
	Name  string  `json:"name"`
	Value float64 `json:"value"`
	Color string  `json:"color"`
}
