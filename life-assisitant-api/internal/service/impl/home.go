// Package impl 首页聚合服务实现
// 跨模块聚合：任务 + 习惯 + 财务 + 通知（未读数真实落库查询）
package impl

import (
	"context"
	"math"
	"time"

	"github.com/gogf/gf/v2/errors/gerror"

	"github.com/life-assistant/api/internal/consts/ecode"
	"github.com/life-assistant/api/internal/dao"
	"github.com/life-assistant/api/internal/model"
	"github.com/life-assistant/api/internal/model/dto"
	"github.com/life-assistant/api/internal/service"
)

// HomeService 首页聚合服务实现
type HomeService struct{}

func NewHomeService() service.IHomeService { return &HomeService{} }

// Register
func init() { service.SetHome(NewHomeService()) }

// Fetch 聚合首页数据
func (s *HomeService) Fetch(ctx context.Context) (*dto.HomeResp, error) {
	uid := ctxUserID(ctx)
	if uid == "" {
		return nil, gerror.NewCode(ecode.AuthTokenMissing)
	}

	now := time.Now()
	todayStart := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	monthStart := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, now.Location())
	monthEnd := monthStart.AddDate(0, 1, 0)

	// 上月（用于同比）
	prevMonthStart := monthStart.AddDate(0, -1, 0)
	prevMonthEnd := monthStart

	out := &dto.HomeResp{
		TodayDate:           now.Format("2006-01-02"),
		UnreadNotifications: 0,
	}

	// ====== Greeting ======
	out.Greeting = buildGreeting(now)
	out.Weekday = weekdayCN(now)

	// ====== Today Tasks ======
	todayTasks, err := s.fetchTodayTasks(ctx, uid, todayStart)
	if err != nil {
		return nil, gerror.WrapCode(ecode.StatsNotAvailable, err, "获取今日任务失败")
	}
	out.TodayTasks = todayTasks

	// ====== Today Habits ======
	todayHabits, err := s.fetchTodayHabits(ctx, uid, now)
	if err != nil {
		return nil, gerror.WrapCode(ecode.StatsNotAvailable, err, "获取今日习惯失败")
	}
	out.TodayHabits = todayHabits

	// ====== KPI ======
	out.KPI = s.buildKPI(ctx, uid, todayStart, now, todayTasks, todayHabits, monthStart, monthEnd)

	// ====== Month Finance ======
	mf, err := s.fetchMonthFinance(ctx, uid, monthStart, monthEnd, prevMonthStart, prevMonthEnd)
	if err != nil {
		return nil, gerror.WrapCode(ecode.StatsNotAvailable, err, "获取月度财务失败")
	}
	out.MonthFinance = *mf

	// KPI 的财务字段与 MonthFinance 同步
	out.KPI.MonthExpense = mf.Expense
	out.KPI.MonthIncome = mf.Income
	out.KPI.MonthExpenseChange = mf.ExpenseChange
	out.KPI.MonthIncomeChange = mf.IncomeChange

	// ====== 未读通知数（真实落库） ======
	if unread, err := dao.Notification.CountUnread(ctx, uid); err == nil {
		out.UnreadNotifications = int(unread)
	}

	return out, nil
}

// buildGreeting 根据时间段返回问候语
func buildGreeting(now time.Time) string {
	h := now.Hour()
	switch {
	case h >= 5 && h < 9:
		return "早上好 ☀️"
	case h >= 9 && h < 12:
		return "上午好 🌤️"
	case h >= 12 && h < 14:
		return "中午好 🌞"
	case h >= 14 && h < 18:
		return "下午好 🌅"
	case h >= 18 && h < 22:
		return "晚上好 🌙"
	default:
		return "夜深了 🌛"
	}
}

// weekdayCN 返回中文星期
func weekdayCN(now time.Time) string {
	days := []string{"星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"}
	return days[now.Weekday()]
}

// fetchTodayTasks 获取今日任务列表
func (s *HomeService) fetchTodayTasks(ctx context.Context, uid string, todayStart time.Time) ([]dto.HomeTaskItem, error) {
	items, _, err := dao.Task.List(ctx, dao.TaskListOptions{
		UserID:   uid,
		Filter:   model.TaskFilterToday,
		Page:     1,
		PageSize: 20,
	})
	if err != nil {
		return nil, err
	}

	result := make([]dto.HomeTaskItem, 0, len(items))
	for _, t := range items {
		item := dto.HomeTaskItem{
			ID:       t.ID,
			Title:    t.Title,
			Priority: t.Priority,
			Status:   t.Status,
			DueTime:  t.DueTime,
		}
		result = append(result, item)
	}
	return result, nil
}

// fetchTodayHabits 获取今日习惯列表
func (s *HomeService) fetchTodayHabits(ctx context.Context, uid string, now time.Time) ([]dto.HomeHabitItem, error) {
	activeItems, _, err := dao.Habit.List(ctx, dao.HabitListOptions{
		UserID:   uid,
		Status:   model.HabitStatusActive,
		Page:     1,
		PageSize: 50,
	})
	if err != nil {
		return nil, err
	}

	// 获取今日打卡
	logs, err := dao.HabitLog.ListByDate(ctx, uid, now)
	if err != nil {
		return nil, err
	}

	// 构建 habit_id -> count 映射
	countMap := make(map[string]int, len(logs))
	for _, l := range logs {
		countMap[l.HabitID] = l.Count
	}

	result := make([]dto.HomeHabitItem, 0, len(activeItems))
	for _, h := range activeItems {
		todayCount := countMap[h.ID]
		result = append(result, dto.HomeHabitItem{
			ID:          h.ID,
			Title:       h.Title,
			Icon:        h.Icon,
			Color:       h.Color,
			TargetCount: h.TargetCount,
			TodayCount:  todayCount,
			Completed:   todayCount >= h.TargetCount,
		})
	}
	return result, nil
}

// buildKPI 构建 KPI
func (s *HomeService) buildKPI(ctx context.Context, uid string, todayStart time.Time, now time.Time,
	tasks []dto.HomeTaskItem, habits []dto.HomeHabitItem,
	monthStart, monthEnd time.Time) dto.HomeKPI {

	kpi := dto.HomeKPI{}

	// 任务 KPI
	todoTotal := len(tasks)
	todoDone := 0
	for _, t := range tasks {
		if t.Status == model.TaskStatusDone {
			todoDone++
		}
	}
	kpi.TodoDone = todoDone
	kpi.TodoTotal = todoTotal
	if todoTotal > 0 {
		kpi.TodoRate = math.Round(float64(todoDone)/float64(todoTotal)*10000) / 100
	}

	// 习惯 KPI
	habitTotal := len(habits)
	habitDone := 0
	for _, h := range habits {
		if h.Completed {
			habitDone++
		}
	}
	kpi.HabitDone = habitDone
	kpi.HabitTotal = habitTotal
	if habitTotal > 0 {
		kpi.HabitRate = math.Round(float64(habitDone)/float64(habitTotal)*10000) / 100
	}

	return kpi
}

// fetchMonthFinance 获取月度财务数据
func (s *HomeService) fetchMonthFinance(ctx context.Context, uid string,
	monthStart, monthEnd, prevMonthStart, prevMonthEnd time.Time) (*dto.HomeMonthFinance, error) {

	// 本月支出/收入
	expense, err := dao.Transaction.SumByType(ctx, uid, model.TransactionTypeExpense, monthStart, monthEnd)
	if err != nil {
		return nil, err
	}
	income, err := dao.Transaction.SumByType(ctx, uid, model.TransactionTypeIncome, monthStart, monthEnd)
	if err != nil {
		return nil, err
	}

	// 上月支出/收入（同比）
	prevExpense, _ := dao.Transaction.SumByType(ctx, uid, model.TransactionTypeExpense, prevMonthStart, prevMonthEnd)
	prevIncome, _ := dao.Transaction.SumByType(ctx, uid, model.TransactionTypeIncome, prevMonthStart, prevMonthEnd)

	var expenseChange, incomeChange float64
	if prevExpense > 0 {
		expenseChange = round2((expense - prevExpense) / prevExpense * 100)
	}
	if prevIncome > 0 {
		incomeChange = round2((income - prevIncome) / prevIncome * 100)
	}

	// 日趋势
	dayRows, err := dao.Transaction.GroupByDay(ctx, uid, monthStart, monthEnd)
	if err != nil {
		return nil, err
	}
	dailyTrend := make([]dto.HomeFinanceDailyTrend, 0, len(dayRows))
	for _, row := range dayRows {
		dailyTrend = append(dailyTrend, dto.HomeFinanceDailyTrend{
			Date:   row.Date,
			Amount: row.Expense, // 首页仅展示支出趋势
		})
	}

	// 分类饼图
	catRows, err := dao.Transaction.GroupByCategory(ctx, uid, model.TransactionTypeExpense, monthStart, monthEnd)
	if err != nil {
		return nil, err
	}

	// 预定义颜色
	colors := []string{"#014DB2", "#F59E0B", "#10B981", "#EF4444", "#8B5CF6", "#EC4899", "#06B6D4", "#F97316"}
	categoryPie := make([]dto.HomeFinanceCategoryPie, 0, len(catRows))
	for i, row := range catRows {
		name := row.CategoryName
		if name == "" {
			name = "未分类"
		}
		color := colors[i%len(colors)]
		categoryPie = append(categoryPie, dto.HomeFinanceCategoryPie{
			Name:  name,
			Value: row.Amount,
			Color: color,
		})
	}

	return &dto.HomeMonthFinance{
		Expense:       expense,
		Income:        income,
		ExpenseChange: expenseChange,
		IncomeChange:  incomeChange,
		DailyTrend:    dailyTrend,
		CategoryPie:   categoryPie,
	}, nil
}
