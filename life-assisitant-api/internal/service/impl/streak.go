// Package impl 频率感知的连续打卡（streak）纯函数
//
// 频率语义（04 §2.2）：
//   - daily：当日 count ≥ target_count 达成，streak 单位「天」
//   - weekly：当周累计 count ≥ target_count 达成，streak 单位「周」（ISO 周，周一起）
//   - monthly：当月累计 count ≥ target_count 达成，streak 单位「月」
package impl

import (
	"sort"
	"time"

	"github.com/life-assistant/api/internal/model"
)

// periodStart 返回 t 所属周期的起点（零点对齐）
// daily → 当天 00:00；weekly → ISO 周周一 00:00；monthly → 当月 1 号 00:00
func periodStart(freq string, t time.Time) time.Time {
	loc := t.Location()
	d := time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, loc)
	switch freq {
	case model.HabitFrequencyWeekly:
		wd := int(d.Weekday())
		if wd == 0 {
			wd = 7 // 周日归到本周（ISO 周周一为一周开始）
		}
		return d.AddDate(0, 0, -(wd - 1))
	case model.HabitFrequencyMonthly:
		return time.Date(t.Year(), t.Month(), 1, 0, 0, 0, 0, loc)
	default: // daily
		return d
	}
}

// nextPeriodStart 返回下一周期起点
func nextPeriodStart(freq string, start time.Time) time.Time {
	switch freq {
	case model.HabitFrequencyWeekly:
		return start.AddDate(0, 0, 7)
	case model.HabitFrequencyMonthly:
		return start.AddDate(0, 1, 0)
	default:
		return start.AddDate(0, 0, 1)
	}
}

// prevPeriodStart 返回上一周期起点
func prevPeriodStart(freq string, start time.Time) time.Time {
	switch freq {
	case model.HabitFrequencyWeekly:
		return start.AddDate(0, 0, -7)
	case model.HabitFrequencyMonthly:
		return start.AddDate(0, -1, 0)
	default:
		return start.AddDate(0, 0, -1)
	}
}

// completedPeriods 从打卡日志构建「已达成周期」集合（键为周期起点）
// 同一周期内多条打卡 count 累加，累计 ≥ targetCount 视为达成
func completedPeriods(logs []model.HabitLog, freq string, targetCount int) map[time.Time]bool {
	sums := make(map[time.Time]int, len(logs))
	for _, l := range logs {
		sums[periodStart(freq, l.LogDate)] += l.Count
	}
	out := make(map[time.Time]bool, len(sums))
	for t, v := range sums {
		if v >= targetCount {
			out[t] = true
		}
	}
	return out
}

// calcCurrentStreakFreq 计算当前连续周期数（从当前周期往回数）
// 规则：当前周期未达成时，从上一周期起算（今天还没打卡不算断）；
//       若上一周期也未达成，则连续中断，返回 0。
func calcCurrentStreakFreq(completed map[time.Time]bool, freq string, now time.Time) int {
	if len(completed) == 0 {
		return 0
	}
	cur := periodStart(freq, now)
	if !completed[cur] {
		cur = prevPeriodStart(freq, cur)
	}
	streak := 0
	for completed[cur] {
		streak++
		cur = prevPeriodStart(freq, cur)
	}
	return streak
}

// calcLongestStreakFreq 计算历史最长连续周期数
func calcLongestStreakFreq(completed map[time.Time]bool, freq string) int {
	if len(completed) == 0 {
		return 0
	}
	starts := make([]time.Time, 0, len(completed))
	for t := range completed {
		starts = append(starts, t)
	}
	sort.Slice(starts, func(i, j int) bool { return starts[i].Before(starts[j]) })

	longest := 1
	run := 1
	for i := 1; i < len(starts); i++ {
		if starts[i].Equal(nextPeriodStart(freq, starts[i-1])) {
			run++
			if run > longest {
				longest = run
			}
		} else {
			run = 1
		}
	}
	return longest
}

// countPeriodsInRange 统计区间 [start, end) 内的周期总数
func countPeriodsInRange(freq string, start, end time.Time) int {
	n := 0
	for p := periodStart(freq, start); p.Before(end); p = nextPeriodStart(freq, p) {
		n++
	}
	return n
}

// countCompletedInRange 统计区间 [start, end) 内已达成的周期数
func countCompletedInRange(completed map[time.Time]bool, freq string, start, end time.Time) int {
	n := 0
	for p := periodStart(freq, start); p.Before(end); p = nextPeriodStart(freq, p) {
		if completed[p] {
			n++
		}
	}
	return n
}
