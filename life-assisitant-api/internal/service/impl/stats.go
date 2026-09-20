// Package impl 统计服务实现
// 业务规则：
//   1. 跨模块聚合（任务 + 习惯 + 财务）
//   2. user_id 从 ctx 取
//   3. 全部用 MySQL 聚合 + 进程内组装，不做缓存（MVP 简化）
//   4. 错误用 StatsNotAvailable 兜底
package impl

import (
	"bytes"
	"context"
	"encoding/csv"
	"fmt"
	"math"
	"time"

	"github.com/gogf/gf/v2/errors/gerror"

	"github.com/life-assistant/api/internal/consts/ecode"
	"github.com/life-assistant/api/internal/dao"
	"github.com/life-assistant/api/internal/model"
	"github.com/life-assistant/api/internal/model/dto"
	"github.com/life-assistant/api/internal/service"
)

// StatsService 统计服务实现
type StatsService struct{}

func NewStatsService() service.IStatsService { return &StatsService{} }

// Register 注册
func init() { service.SetStats(NewStatsService()) }

// ====== range 解析 ======

// parseRange 将 range 参数解析为 [start, end) 时间区间
// 支持：7d / 30d / 90d / custom（需配合 start_date / end_date）
// 同时返回上一区间 [prevStart, prevEnd)，用于同比计算
func parseRange(rng string) (start, end, prevStart, prevEnd time.Time, err error) {
	now := time.Now()
	todayStart := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())

	switch rng {
	case "7d":
		end = todayStart.AddDate(0, 0, 1) // 明天 00:00
		start = todayStart.AddDate(0, 0, -6)
	case "30d":
		end = todayStart.AddDate(0, 0, 1)
		start = todayStart.AddDate(0, 0, -29)
	case "90d":
		end = todayStart.AddDate(0, 0, 1)
		start = todayStart.AddDate(0, 0, -89)
	default:
		// 默认 30d
		end = todayStart.AddDate(0, 0, 1)
		start = todayStart.AddDate(0, 0, -29)
	}

	length := end.Sub(start)
	prevEnd = start
	prevStart = prevEnd.Add(-length)

	return start, end, prevStart, prevEnd, nil
}

// ====== GetOverview ======

// GetOverview 聚合首页 KPI
func (s *StatsService) GetOverview(ctx context.Context) (*dto.StatsOverviewResp, error) {
	uid := ctxUserID(ctx)
	if uid == "" {
		return nil, gerror.NewCode(ecode.AuthTokenMissing)
	}

	now := time.Now()
	todayStart := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())

	// 本周：周一 00:00 ~ 下周一 00:00
	weekday := int(now.Weekday())
	if weekday == 0 {
		weekday = 7 // 周日当周最后一天
	}
	weekStart := todayStart.AddDate(0, 0, -(weekday - 1))
	weekEnd := weekStart.AddDate(0, 0, 7)

	// 本月：1 号 00:00 ~ 下月 1 号 00:00
	monthStart := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, now.Location())
	monthEnd := monthStart.AddDate(0, 1, 0)

	out := &dto.StatsOverviewResp{
		MonthExpense: 0,
		MonthIncome:  0,
		TotalBalance: 0,
	}

	// ====== 任务：今日 total / done ======
	todayTotal, err := s.countTasksByDueDate(ctx, uid, todayStart)
	if err != nil {
		return nil, gerror.WrapCode(ecode.StatsNotAvailable, err, "统计今日任务失败")
	}
	out.TodayTotalTasks = int(todayTotal)

	todayDone, err := s.countTasksDoneSince(ctx, uid, todayStart)
	if err != nil {
		return nil, gerror.WrapCode(ecode.StatsNotAvailable, err, "统计今日已完成任务失败")
	}
	out.TodayDoneTasks = int(todayDone)

	// 本周完成率
	weekTotal, err := s.countTasksByDueRange(ctx, uid, weekStart, weekEnd)
	if err != nil {
		return nil, gerror.WrapCode(ecode.StatsNotAvailable, err, "统计本周任务失败")
	}
	weekDone, err := s.countTasksDoneByRange(ctx, uid, weekStart, weekEnd)
	if err != nil {
		return nil, gerror.WrapCode(ecode.StatsNotAvailable, err, "统计本周已完成任务失败")
	}
	if weekTotal > 0 {
		out.WeekCompletionRate = float64(weekDone) / float64(weekTotal) * 100
		out.WeekCompletionRate = float64(int(out.WeekCompletionRate*100)) / 100
	}

	// ====== 财务：本月支出/收入/总余额 ======
	monthExp, err := dao.Transaction.SumByType(ctx, uid, model.TransactionTypeExpense, monthStart, monthEnd)
	if err != nil {
		return nil, gerror.WrapCode(ecode.StatsNotAvailable, err, "统计本月支出失败")
	}
	out.MonthExpense = monthExp

	monthInc, err := dao.Transaction.SumByType(ctx, uid, model.TransactionTypeIncome, monthStart, monthEnd)
	if err != nil {
		return nil, gerror.WrapCode(ecode.StatsNotAvailable, err, "统计本月收入失败")
	}
	out.MonthIncome = monthInc

	totalBal, err := dao.Account.GetTotalBalance(ctx, uid)
	if err != nil {
		return nil, gerror.WrapCode(ecode.StatsNotAvailable, err, "统计总余额失败")
	}
	out.TotalBalance = totalBal

	// ====== 习惯：今日 done/total ======
	activeItems, _, err := dao.Habit.List(ctx, dao.HabitListOptions{
		UserID:   uid,
		Status:   model.HabitStatusActive,
		Page:     1,
		PageSize: 1000,
	})
	if err != nil {
		return nil, gerror.WrapCode(ecode.StatsNotAvailable, err, "统计习惯失败")
	}
	out.HabitTodayTotal = len(activeItems)

	logs, err := dao.HabitLog.ListByDate(ctx, uid, now)
	if err != nil {
		return nil, gerror.WrapCode(ecode.StatsNotAvailable, err, "统计今日习惯打卡失败")
	}
	targetMap := make(map[string]int, len(activeItems))
	for i := range activeItems {
		targetMap[activeItems[i].ID] = activeItems[i].TargetCount
	}
	done := 0
	for i := range logs {
		if logs[i].Count >= targetMap[logs[i].HabitID] {
			done++
		}
	}
	out.HabitTodayDone = done

	return out, nil
}

// ====== GetTaskStats ======

// GetTaskStats 任务统计
func (s *StatsService) GetTaskStats(ctx context.Context, rng string) (*dto.TaskStatsResp, error) {
	uid := ctxUserID(ctx)
	if uid == "" {
		return nil, gerror.NewCode(ecode.AuthTokenMissing)
	}

	start, end, prevStart, prevEnd, err := parseRange(rng)
	if err != nil {
		return nil, gerror.WrapCode(ecode.StatsRangeInvalid, err, "range 参数无效")
	}

	out := &dto.TaskStatsResp{}

	// 总数 + 完成
	total, err := dao.Task.CountByRange(ctx, uid, start, end)
	if err != nil {
		return nil, gerror.WrapCode(ecode.StatsNotAvailable, err, "统计任务总数失败")
	}
	out.Total = int(total)

	completed, err := dao.Task.CountDoneByRange(ctx, uid, start, end)
	if err != nil {
		return nil, gerror.WrapCode(ecode.StatsNotAvailable, err, "统计已完成任务失败")
	}
	out.Completed = int(completed)
	out.Pending = out.Total - out.Completed

	// 完成率
	if out.Total > 0 {
		out.CompletionRate = float64(out.Completed) / float64(out.Total)
	}

	// 上一区间完成率（计算 change）
	prevTotal, _ := dao.Task.CountByRange(ctx, uid, prevStart, prevEnd)
	prevCompleted, _ := dao.Task.CountDoneByRange(ctx, uid, prevStart, prevEnd)
	var prevRate float64
	if prevTotal > 0 {
		prevRate = float64(prevCompleted) / float64(prevTotal)
	}
	out.CompletionRateChange = out.CompletionRate - prevRate

	// 逾期
	todayStr := time.Now().Format("2006-01-02")
	overdue, err := dao.Task.CountOverdue(ctx, uid, todayStr)
	if err != nil {
		return nil, gerror.WrapCode(ecode.StatsNotAvailable, err, "统计逾期任务失败")
	}
	out.Overdue = int(overdue)

	// 按日分组
	dayRows, err := dao.Task.GroupByDay(ctx, uid, start, end)
	if err != nil {
		return nil, gerror.WrapCode(ecode.StatsNotAvailable, err, "统计按日任务失败")
	}
	out.ByDay = make([]dto.TaskDayStat, 0, len(dayRows))
	for _, row := range dayRows {
		var rate float64
		if row.Total > 0 {
			rate = float64(row.Completed) / float64(row.Total)
		}
		out.ByDay = append(out.ByDay, dto.TaskDayStat{
			Date:      row.Date,
			Total:     int(row.Total),
			Completed: int(row.Completed),
			Rate:      round2(rate),
		})
	}

	// 按分类分组
	catRows, err := dao.Task.GroupByCategory(ctx, uid, start, end)
	if err != nil {
		return nil, gerror.WrapCode(ecode.StatsNotAvailable, err, "统计按分类任务失败")
	}
	out.ByCategory = make([]dto.TaskCategoryStat, 0, len(catRows))
	for _, row := range catRows {
		var rate float64
		if row.Total > 0 {
			rate = float64(row.Completed) / float64(row.Total)
		}
		// 未分类的显示
		categoryName := row.CategoryID
		if categoryName == "" {
			categoryName = "未分类"
		}
		out.ByCategory = append(out.ByCategory, dto.TaskCategoryStat{
			Category:  categoryName,
			Emoji:     "📋",
			Color:     "#6B7280",
			Total:     int(row.Total),
			Completed: int(row.Completed),
			Rate:      round2(rate),
		})
	}

	return out, nil
}

// ====== GetHabitStats ======

// GetHabitStats 习惯统计
func (s *StatsService) GetHabitStats(ctx context.Context, rng, startDate, endDate string) (*dto.HabitStatsResp, error) {
	uid := ctxUserID(ctx)
	if uid == "" {
		return nil, gerror.NewCode(ecode.AuthTokenMissing)
	}

	var start, end time.Time
	var err error
	if startDate != "" && endDate != "" {
		// 自定义区间（按月等）
		start, err = time.Parse("2006-01-02", startDate)
		if err != nil {
			return nil, gerror.NewCode(ecode.StatsRangeInvalid)
		}
		end, err = time.Parse("2006-01-02", endDate)
		if err != nil {
			return nil, gerror.NewCode(ecode.StatsRangeInvalid)
		}
		end = end.AddDate(0, 0, 1) // 包含 endDate 当天
	} else {
		start, end, _, _, err = parseRange(rng)
		if err != nil {
			return nil, gerror.WrapCode(ecode.StatsRangeInvalid, err, "range 参数无效")
		}
	}

	out := &dto.HabitStatsResp{}

	// 活跃习惯
	activeItems, _, err := dao.Habit.List(ctx, dao.HabitListOptions{
		UserID:   uid,
		Status:   model.HabitStatusActive,
		Page:     1,
		PageSize: 1000,
	})
	if err != nil {
		return nil, gerror.WrapCode(ecode.StatsNotAvailable, err, "获取习惯列表失败")
	}
	out.TotalHabits = len(activeItems)

	// 总打卡次数
	totalCheckIns, err := dao.HabitLog.CountByUserAndRange(ctx, uid, start, end)
	if err != nil {
		return nil, gerror.WrapCode(ecode.StatsNotAvailable, err, "统计打卡次数失败")
	}
	out.TotalCheckIns = int(totalCheckIns)

	// 日均
	days := int(math.Ceil(end.Sub(start).Hours() / 24))
	if days > 0 {
		out.DailyAverage = round2(float64(totalCheckIns) / float64(days))
	}

	// 按习惯逐个统计
	out.ByHabit = make([]dto.HabitStatItem, 0, len(activeItems))
	longestStreakOverall := 0

	now := time.Now()
	todayStr := now.Format("2006-01-02")

	for i := range activeItems {
		h := activeItems[i]

		// 取该习惯区间内所有打卡
		logs, err := dao.HabitLog.ListByHabitAndRange(ctx, h.ID, start, end)
		if err != nil {
			continue
		}

		// 完成率（频率感知：daily=天 / weekly=周 / monthly=月）
		completed := completedPeriods(logs, h.Frequency, h.TargetCount)
		periodCount := countPeriodsInRange(h.Frequency, start, end)
		var completionRate float64
		if periodCount > 0 {
			completionRate = round2(float64(countCompletedInRange(completed, h.Frequency, start, end)) / float64(periodCount))
		}

		// 连续打卡：直接用 habits 上已维护的字段（打卡时重算落库，频率语义见 streak.go）
		currentStreak := h.CurrentStreak
		longestStreak := h.LongestStreak
		if longestStreak > longestStreakOverall {
			longestStreakOverall = longestStreak
		}

		// 今日完成情况
		todayDone := 0
		for _, l := range logs {
			if l.LogDate.Format("2006-01-02") == todayStr {
				todayDone = l.Count
			}
		}

		out.ByHabit = append(out.ByHabit, dto.HabitStatItem{
			HabitID:        h.ID,
			Name:           h.Title,
			Emoji:          h.Icon,
			Color:          h.Color,
			CompletionRate: completionRate,
			CurrentStreak:  currentStreak,
			LongestStreak:  longestStreak,
			TodayDone:      todayDone,
			TodayTarget:    h.TargetCount,
		})
	}
	out.LongestStreakOverall = longestStreakOverall

	// 热力图：按日聚合
	allLogs, err := dao.HabitLog.ListByUserAndRange(ctx, uid, start, end)
	if err != nil {
		return nil, gerror.WrapCode(ecode.StatsNotAvailable, err, "统计热力图失败")
	}

	// 构建 habit -> target_count 映射
	targetMap := make(map[string]int, len(activeItems))
	for i := range activeItems {
		targetMap[activeItems[i].ID] = activeItems[i].TargetCount
	}

	// 按日期聚合
	dateMap := make(map[string]*dto.HabitHeatmapItem)
	for _, l := range allLogs {
		ds := l.LogDate.Format("2006-01-02")
		item, ok := dateMap[ds]
		if !ok {
			item = &dto.HabitHeatmapItem{Date: ds}
			dateMap[ds] = item
		}
		item.Total++
		if l.Count >= targetMap[l.HabitID] {
			item.Completed++
		}
	}

	out.Heatmap = make([]dto.HabitHeatmapItem, 0, len(dateMap))
	// 按日期排序
	for d := start; d.Before(end); d = d.AddDate(0, 0, 1) {
		ds := d.Format("2006-01-02")
		if item, ok := dateMap[ds]; ok {
			out.Heatmap = append(out.Heatmap, *item)
		} else {
			out.Heatmap = append(out.Heatmap, dto.HabitHeatmapItem{Date: ds, Completed: 0, Total: 0})
		}
	}

	return out, nil
}

// ====== GetFinanceStats ======

// GetFinanceStats 财务统计
func (s *StatsService) GetFinanceStats(ctx context.Context, rng string) (*dto.FinanceStatsResp, error) {
	uid := ctxUserID(ctx)
	if uid == "" {
		return nil, gerror.NewCode(ecode.AuthTokenMissing)
	}

	start, end, prevStart, prevEnd, err := parseRange(rng)
	if err != nil {
		return nil, gerror.WrapCode(ecode.StatsRangeInvalid, err, "range 参数无效")
	}

	out := &dto.FinanceStatsResp{}

	// 本区间收入/支出
	expense, err := dao.Transaction.SumByType(ctx, uid, model.TransactionTypeExpense, start, end)
	if err != nil {
		return nil, gerror.WrapCode(ecode.StatsNotAvailable, err, "统计支出失败")
	}
	income, err := dao.Transaction.SumByType(ctx, uid, model.TransactionTypeIncome, start, end)
	if err != nil {
		return nil, gerror.WrapCode(ecode.StatsNotAvailable, err, "统计收入失败")
	}
	out.Expense = expense
	out.Income = income
	out.Net = income - expense

	// 同比
	prevExpense, _ := dao.Transaction.SumByType(ctx, uid, model.TransactionTypeExpense, prevStart, prevEnd)
	prevIncome, _ := dao.Transaction.SumByType(ctx, uid, model.TransactionTypeIncome, prevStart, prevEnd)
	if prevExpense > 0 {
		out.ExpenseChange = round2((expense - prevExpense) / prevExpense * 100)
	}
	if prevIncome > 0 {
		out.IncomeChange = round2((income - prevIncome) / prevIncome * 100)
	}

	// 按日分组
	dayRows, err := dao.Transaction.GroupByDay(ctx, uid, start, end)
	if err != nil {
		return nil, gerror.WrapCode(ecode.StatsNotAvailable, err, "统计按日财务失败")
	}
	out.ByDay = make([]dto.FinanceDayStat, 0, len(dayRows))
	for _, row := range dayRows {
		out.ByDay = append(out.ByDay, dto.FinanceDayStat{
			Date:    row.Date,
			Expense: row.Expense,
			Income:  row.Income,
		})
	}

	// 按分类分组（支出维度）
	catRows, err := dao.Transaction.GroupByCategory(ctx, uid, model.TransactionTypeExpense, start, end)
	if err != nil {
		return nil, gerror.WrapCode(ecode.StatsNotAvailable, err, "统计按分类财务失败")
	}
	out.ByCategory = make([]dto.FinanceCategoryStat, 0, len(catRows))
	for _, row := range catRows {
		var pct float64
		if expense > 0 {
			pct = round2(row.Amount / expense)
		}
		out.ByCategory = append(out.ByCategory, dto.FinanceCategoryStat{
			Category:   row.CategoryName,
			Emoji:      row.CategoryEmoji,
			Color:      "#6B7280",
			Amount:     row.Amount,
			Percentage: pct,
			Count:      int(row.Count),
		})
	}

	// 按账户分组（支出维度）
	accRows, err := dao.Transaction.GroupByAccount(ctx, uid, model.TransactionTypeExpense, start, end)
	if err != nil {
		return nil, gerror.WrapCode(ecode.StatsNotAvailable, err, "统计按账户财务失败")
	}
	out.ByAccount = make([]dto.FinanceAccountStat, 0, len(accRows))
	for _, row := range accRows {
		out.ByAccount = append(out.ByAccount, dto.FinanceAccountStat{
			Account: row.AccountName,
			Emoji:   row.AccountIcon,
			Amount:  row.Amount,
			Count:   int(row.Count),
		})
	}

	return out, nil
}

// ====== Export ======

// Export 导出 CSV
func (s *StatsService) Export(ctx context.Context, req *dto.ExportReq) (*dto.ExportResult, error) {
	uid := ctxUserID(ctx)
	if uid == "" {
		return nil, gerror.NewCode(ecode.AuthTokenMissing)
	}

	// 解析时间范围
	var start, end time.Time
	if req.Range == "custom" {
		if req.StartDate == "" || req.EndDate == "" {
			return nil, gerror.NewCode(ecode.StatsRangeInvalid)
		}
		var err error
		start, err = time.Parse("2006-01-02", req.StartDate)
		if err != nil {
			return nil, gerror.NewCode(ecode.StatsRangeInvalid)
		}
		end, err = time.Parse("2006-01-02", req.EndDate)
		if err != nil {
			return nil, gerror.NewCode(ecode.StatsRangeInvalid)
		}
		end = end.AddDate(0, 0, 1) // 包含 end_date 当天
	} else {
		start, end, _, _, _ = parseRange(req.Range)
	}

	exportType := req.Type
	if exportType == "" {
		exportType = "all"
	}

	var buf bytes.Buffer
	writer := csv.NewWriter(&buf)

	switch exportType {
	case "all":
		s.exportTransactions(ctx, uid, start, end, writer, true)
		s.exportTasks(ctx, uid, start, end, writer)
		s.exportHabits(ctx, uid, start, end, writer)
	case "transactions":
		s.exportTransactions(ctx, uid, start, end, writer, false)
	case "tasks":
		s.exportTasks(ctx, uid, start, end, writer)
	case "habits":
		s.exportHabits(ctx, uid, start, end, writer)
	default:
		return nil, gerror.NewCode(ecode.StatsExportFailed)
	}

	writer.Flush()
	if writer.Error() != nil {
		return nil, gerror.WrapCode(ecode.StatsExportFailed, writer.Error(), "写入 CSV 失败")
	}

	filename := fmt.Sprintf("%s_%s_%s.csv", exportType, start.Format("20060102"), end.Format("20060102"))
	return &dto.ExportResult{
		CSV:      buf.Bytes(),
		Filename: filename,
	}, nil
}

// exportTransactions 导出交易
func (s *StatsService) exportTransactions(ctx context.Context, uid string, start, end time.Time, w *csv.Writer, appendHeader bool) {
	if appendHeader {
		w.Write([]string{"=== 交易记录 ==="})
	}
	w.Write([]string{"日期", "类型", "分类", "金额", "账户", "备注"})

	items, err := dao.Transaction.ListByRange(ctx, uid, start, end)
	if err != nil {
		return
	}
	for _, t := range items {
		categoryName := ""
		if t.CategoryName != nil {
			categoryName = *t.CategoryName
		}
		note := ""
		if t.Note != nil {
			note = *t.Note
		}
		w.Write([]string{
			t.HappenedAt.Format("2006-01-02"),
			t.Type,
			categoryName,
			fmt.Sprintf("%.2f", t.Amount),
			t.AccountID,
			note,
		})
	}
	w.Write([]string{})
}

// exportTasks 导出任务
func (s *StatsService) exportTasks(ctx context.Context, uid string, start, end time.Time, w *csv.Writer) {
	w.Write([]string{"=== 任务记录 ==="})
	w.Write([]string{"截止日期", "标题", "优先级", "状态", "分类ID", "完成时间"})

	// 通过 DAO 的 GroupByDay 不能直接拿任务列表，这里用 List 接口模拟
	// 通过现有 List 方法获取（取大 page）
	items, _, err := dao.Task.List(ctx, dao.TaskListOptions{
		UserID:   uid,
		Filter:   model.TaskFilterAll,
		Page:     1,
		PageSize: 10000,
	})
	if err != nil {
		return
	}
	for _, t := range items {
		dueDate := ""
		if t.DueDate != nil {
			dueDate = t.DueDate.Format("2006-01-02")
			// 只导出区间内的
			d, _ := time.Parse("2006-01-02", dueDate)
			if d.Before(start) || !d.Before(end) {
				continue
			}
		}
		completedAt := ""
		if t.CompletedAt != nil {
			completedAt = t.CompletedAt.Format("2006-01-02 15:04:05")
		}
		categoryID := ""
		if t.CategoryID != nil {
			categoryID = *t.CategoryID
		}
		w.Write([]string{
			dueDate,
			t.Title,
			t.Priority,
			t.Status,
			categoryID,
			completedAt,
		})
	}
	w.Write([]string{})
}

// exportHabits 导出习惯
func (s *StatsService) exportHabits(ctx context.Context, uid string, start, end time.Time, w *csv.Writer) {
	w.Write([]string{"=== 习惯打卡记录 ==="})
	w.Write([]string{"日期", "习惯ID", "完成次数", "目标次数"})

	logs, err := dao.HabitLog.ListByUserAndRange(ctx, uid, start, end)
	if err != nil {
		return
	}

	// 构建 habit -> target_count
	activeItems, _, _ := dao.Habit.List(ctx, dao.HabitListOptions{
		UserID:   uid,
		Status:   model.HabitStatusActive,
		Page:     1,
		PageSize: 1000,
	})
	targetMap := make(map[string]int, len(activeItems))
	for i := range activeItems {
		targetMap[activeItems[i].ID] = activeItems[i].TargetCount
	}

	for _, l := range logs {
		target := targetMap[l.HabitID]
		w.Write([]string{
			l.LogDate.Format("2006-01-02"),
			l.HabitID,
			fmt.Sprintf("%d", l.Count),
			fmt.Sprintf("%d", target),
		})
	}
	w.Write([]string{})
}

// ====== 辅助方法 ======

// countTasksByDueDate 统计某用户 due_date=today 的任务数
func (s *StatsService) countTasksByDueDate(ctx context.Context, userID string, date time.Time) (int64, error) {
	todayStr := date.Format("2006-01-02")
	var n int64
	err := dao.DB.WithContext(ctx).
		Model(&model.Task{}).
		Where("user_id = ? AND due_date = ?", userID, todayStr).
		Count(&n).Error
	return n, err
}

// countTasksByDueRange 统计 due_date 在 [start, end) 区间内的任务数
func (s *StatsService) countTasksByDueRange(ctx context.Context, userID string, start, end time.Time) (int64, error) {
	startStr := start.Format("2006-01-02")
	endStr := end.Format("2006-01-02")
	var n int64
	err := dao.DB.WithContext(ctx).
		Model(&model.Task{}).
		Where("user_id = ? AND due_date >= ? AND due_date < ?", userID, startStr, endStr).
		Count(&n).Error
	return n, err
}

// countTasksDoneSince 统计 completed_at >= since 的已完成任务数
func (s *StatsService) countTasksDoneSince(ctx context.Context, userID string, since time.Time) (int64, error) {
	var n int64
	err := dao.DB.WithContext(ctx).
		Model(&model.Task{}).
		Where("user_id = ? AND status = ? AND completed_at >= ?",
			userID, model.TaskStatusDone, since).
		Count(&n).Error
	return n, err
}

// countTasksDoneByRange 统计某区间内已完成任务数
func (s *StatsService) countTasksDoneByRange(ctx context.Context, userID string, start, end time.Time) (int64, error) {
	var n int64
	err := dao.DB.WithContext(ctx).
		Model(&model.Task{}).
		Where("user_id = ? AND status = ? AND completed_at >= ? AND completed_at < ?",
			userID, model.TaskStatusDone, start, end).
		Count(&n).Error
	return n, err
}

// round2 保留 2 位小数
func round2(f float64) float64 {
	return math.Round(f*100) / 100
}
