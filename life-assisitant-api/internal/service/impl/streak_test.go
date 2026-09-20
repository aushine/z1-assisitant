package impl

import (
	"testing"
	"time"

	"github.com/life-assistant/api/internal/model"
)

func dt(y int, m time.Month, d int) time.Time {
	return time.Date(y, m, d, 0, 0, 0, 0, time.UTC)
}

// mkLogs 构造「每天一条、count 恰好达标」的打卡日志
func mkLogs(freq string, target int, days ...time.Time) []model.HabitLog {
	logs := make([]model.HabitLog, 0, len(days))
	for _, d := range days {
		logs = append(logs, model.HabitLog{LogDate: d, Count: target})
	}
	return logs
}

func TestDailyCurrentStreak_AcrossMonthBoundary(t *testing.T) {
	// 1月31、2月1、2月2 连续，now = 2月2
	logs := mkLogs(model.HabitFrequencyDaily, 1, dt(2021, 1, 31), dt(2021, 2, 1), dt(2021, 2, 2))
	completed := completedPeriods(logs, model.HabitFrequencyDaily, 1)
	got := calcCurrentStreakFreq(completed, model.HabitFrequencyDaily, dt(2021, 2, 2))
	if got != 3 {
		t.Fatalf("跨月连续期望 3，实际 %d", got)
	}
}

func TestDailyCurrentStreak_TodayNotChecked(t *testing.T) {
	// 昨天(2/1)与前天(1/31)已打卡，今天(2/2)未打卡 → 连续 2（今天未打卡不算断）
	logs := mkLogs(model.HabitFrequencyDaily, 1, dt(2021, 1, 31), dt(2021, 2, 1))
	completed := completedPeriods(logs, model.HabitFrequencyDaily, 1)
	got := calcCurrentStreakFreq(completed, model.HabitFrequencyDaily, dt(2021, 2, 2))
	if got != 2 {
		t.Fatalf("今天未打卡期望 2，实际 %d", got)
	}
}

func TestDailyCurrentStreak_Broken(t *testing.T) {
	// 2/1 打卡、1/30 打卡，但 1/31 断签，今天(2/2)未打卡 → 连续 1
	logs := mkLogs(model.HabitFrequencyDaily, 1, dt(2021, 1, 30), dt(2021, 2, 1))
	completed := completedPeriods(logs, model.HabitFrequencyDaily, 1)
	got := calcCurrentStreakFreq(completed, model.HabitFrequencyDaily, dt(2021, 2, 2))
	if got != 1 {
		t.Fatalf("断签期望 1，实际 %d", got)
	}
}

func TestDailyLongestStreak_AcrossYear(t *testing.T) {
	// 2020-12-30/31 + 2021-01-01 连续 3 天
	logs := mkLogs(model.HabitFrequencyDaily, 1, dt(2020, 12, 30), dt(2020, 12, 31), dt(2021, 1, 1))
	completed := completedPeriods(logs, model.HabitFrequencyDaily, 1)
	got := calcLongestStreakFreq(completed, model.HabitFrequencyDaily)
	if got != 3 {
		t.Fatalf("跨年最长连续期望 3，实际 %d", got)
	}
}

func TestDailyLongestStreak_Backfill(t *testing.T) {
	// 补签场景：1/3、1/5 打卡（1/4 缺），补签 1/4 后最长连续应变为 3
	logs := mkLogs(model.HabitFrequencyDaily, 1, dt(2021, 1, 3), dt(2021, 1, 5))
	completed := completedPeriods(logs, model.HabitFrequencyDaily, 1)
	if got := calcLongestStreakFreq(completed, model.HabitFrequencyDaily); got != 1 {
		t.Fatalf("补签前最长连续期望 1，实际 %d", got)
	}
	logs = append(logs, model.HabitLog{LogDate: dt(2021, 1, 4), Count: 1})
	completed = completedPeriods(logs, model.HabitFrequencyDaily, 1)
	if got := calcLongestStreakFreq(completed, model.HabitFrequencyDaily); got != 3 {
		t.Fatalf("补签后最长连续期望 3，实际 %d", got)
	}
}

func TestWeekly_CurrentStreak(t *testing.T) {
	// ISO 周：2021-01-04/11/18 均为周一，连续 3 周
	logs := mkLogs(model.HabitFrequencyWeekly, 1, dt(2021, 1, 4), dt(2021, 1, 11), dt(2021, 1, 18))
	completed := completedPeriods(logs, model.HabitFrequencyWeekly, 1)
	got := calcCurrentStreakFreq(completed, model.HabitFrequencyWeekly, dt(2021, 1, 19))
	if got != 3 {
		t.Fatalf("周连续期望 3，实际 %d", got)
	}
}

func TestWeekly_WeeklyAggregation(t *testing.T) {
	// 同一周内多次打卡累加：1/4 一次、1/6 一次，target=2 → 本周达成
	logs := []model.HabitLog{
		{LogDate: dt(2021, 1, 4), Count: 1},
		{LogDate: dt(2021, 1, 6), Count: 1},
	}
	completed := completedPeriods(logs, model.HabitFrequencyWeekly, 2)
	if !completed[periodStart(model.HabitFrequencyWeekly, dt(2021, 1, 4))] {
		t.Fatalf("周内聚合应达成目标")
	}
}

func TestWeekly_LongestStreak_AcrossYear(t *testing.T) {
	// 2020 最后一周(周一 12/28) 与 2021 第一周(周一 1/4) 连续
	logs := mkLogs(model.HabitFrequencyWeekly, 1, dt(2020, 12, 28), dt(2021, 1, 4))
	completed := completedPeriods(logs, model.HabitFrequencyWeekly, 1)
	got := calcLongestStreakFreq(completed, model.HabitFrequencyWeekly)
	if got != 2 {
		t.Fatalf("跨年周连续期望 2，实际 %d", got)
	}
}

func TestMonthly_CurrentStreak(t *testing.T) {
	logs := mkLogs(model.HabitFrequencyMonthly, 1, dt(2021, 1, 15), dt(2021, 2, 10), dt(2021, 3, 5))
	completed := completedPeriods(logs, model.HabitFrequencyMonthly, 1)
	got := calcCurrentStreakFreq(completed, model.HabitFrequencyMonthly, dt(2021, 3, 20))
	if got != 3 {
		t.Fatalf("月连续期望 3，实际 %d", got)
	}
}

func TestMonthly_LongestStreak_AcrossYear(t *testing.T) {
	// 2020-12 与 2021-01 连续
	logs := mkLogs(model.HabitFrequencyMonthly, 1, dt(2020, 12, 20), dt(2021, 1, 20))
	completed := completedPeriods(logs, model.HabitFrequencyMonthly, 1)
	got := calcLongestStreakFreq(completed, model.HabitFrequencyMonthly)
	if got != 2 {
		t.Fatalf("跨年月连续期望 2，实际 %d", got)
	}
}

func TestTimezone_PeriodStartUsesLocalZone(t *testing.T) {
	// 东八区：跨日边界附近，periodStart 应落在当地日历日的 00:00
	cst := time.FixedZone("CST", 8*3600)
	late := time.Date(2021, 2, 1, 23, 30, 0, 0, cst)
	start := periodStart(model.HabitFrequencyDaily, late)
	if start.Year() != 2021 || start.Month() != 2 || start.Day() != 1 {
		t.Fatalf("periodStart 应落在当地时间 2/1 00:00，实际 %v", start)
	}
	if start.Location() != cst {
		t.Fatalf("periodStart 应保留原时区，实际 %v", start.Location())
	}
}

func TestCountPeriodsInRange(t *testing.T) {
	// daily：2021-02-01 ~ 2021-02-04 共 3 天
	if got := countPeriodsInRange(model.HabitFrequencyDaily, dt(2021, 2, 1), dt(2021, 2, 4)); got != 3 {
		t.Fatalf("daily 区间期望 3，实际 %d", got)
	}
	// weekly：2021-01-04 ~ 2021-01-25 共 3 周
	if got := countPeriodsInRange(model.HabitFrequencyWeekly, dt(2021, 1, 4), dt(2021, 1, 25)); got != 3 {
		t.Fatalf("weekly 区间期望 3，实际 %d", got)
	}
	// monthly：2021-01-01 ~ 2021-04-01 共 3 个月
	if got := countPeriodsInRange(model.HabitFrequencyMonthly, dt(2021, 1, 1), dt(2021, 4, 1)); got != 3 {
		t.Fatalf("monthly 区间期望 3，实际 %d", got)
	}
}
