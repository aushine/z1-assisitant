// Package utility 纪念日「下次日期」推导（md/spec-20260919-v1/04 §4）
//
// ⚠️ **「下次日期」不落库，每次实时推导。** 理由：
//  1. 存了就必须有定时任务在每年元旦（或每月 1 号）批量刷新 —— 多一个会失败的环节；
//  2. 一旦任务漏跑，数据就**静默过期**（用户看到「还有 −360 天」）；
//  3. 推导成本 O(1)，没有任何性能理由要缓存。
//
// 推导规则：
//
//	rule = 1（不重复）: 返回基准日本身（是否已过由调用方判断并过滤）
//	rule = 2（每年）  : 今年基准的月日；若 < today 则 +1 年
//	rule = 3（每月）  : 本月基准的日；若 < today 则 +1 月（月日不存在时取该月最后一天）
//	rule = 4（每周）  : 本周基准的星期；若 < today 则 +7 天
//
// 边界（必须有单测）：
//   - rule=2 且基准是 2月29日 → 非闰年取 2月28日
//   - rule=3 且基准是 31 日   → 该月没有 31 日时取该月最后一天
package utility

import (
	"time"

	"github.com/life-assistant/api/internal/model"
)

// NextDate 推导下一次发生日（返回当天的 00:00:00 本地时间）
//
// 参数：
//   - base     基准日期（**首次发生的那天**，不是下一次）
//   - rule     model.RepeatNone / RepeatYearly / RepeatMonthly / RepeatWeekly
//   - today    今天（用于判断「今年这次是否已过」）
//
// 返回 (nextDate, ok)：ok=false 表示规则非法（调用方应回落到「不重复」而不是 panic）
func NextDate(base time.Time, rule int, today time.Time) (time.Time, bool) {
	// 统一截断到当天 0 点，避免时分秒干扰比较
	base = DateOnly(base)
	today = DateOnly(today)

	switch rule {
	case model.RepeatNone:
		return base, true

	case model.RepeatYearly:
		return nextYearly(base, today), true

	case model.RepeatMonthly:
		return nextMonthly(base, today), true

	case model.RepeatWeekly:
		return nextWeekly(base, today), true

	default:
		return base, false
	}
}

// nextYearly 每年：今年 base 的月日；若已过则 +1 年。2月29日在非闰年落到 2月28日。
func nextYearly(base, today time.Time) time.Time {
	y := today.Year()
	next := safeDate(y, base.Month(), base.Day())
	if next.Before(today) {
		next = safeDate(y+1, base.Month(), base.Day())
	}
	return next
}

// nextMonthly 每月：本月 base 的日；若已过则 +1 月。日超出月长时取该月最后一天。
func nextMonthly(base, today time.Time) time.Time {
	y, m := today.Year(), today.Month()
	next := safeDate(y, m, base.Day())
	if next.Before(today) {
		y, m = addMonth(y, m)
		next = safeDate(y, m, base.Day())
	}
	return next
}

// nextWeekly 每周：本周 base 的星期几；若已过则 +7 天。
func nextWeekly(base, today time.Time) time.Time {
	// Go 的 Weekday：Sunday = 0。以「今天所在周的周一」为锚点更直观。
	diff := int(base.Weekday()) - int(today.Weekday())
	next := today.AddDate(0, 0, diff)
	if next.Before(today) {
		next = next.AddDate(0, 0, 7)
	}
	return next
}

// safeDate 构造日期，日超出月长时自动取该月最后一天
// （覆盖 2月29日非闰年 → 2月28日、31 日在小月 → 30 日、2 月 → 28/29 日）
func safeDate(y int, m time.Month, d int) time.Time {
	if max := daysInMonth(y, m); d > max {
		d = max
	}
	return time.Date(y, m, d, 0, 0, 0, 0, time.Local)
}

// daysInMonth 某年某月的天数（闰年 2 月 = 29）
func daysInMonth(y int, m time.Month) int {
	// time.Date 的第 0 天 = 上个月最后一天，用它反推月长，避免自己维护闰年表
	return time.Date(y, m+1, 0, 0, 0, 0, 0, time.Local).Day()
}

// addMonth 年月 +1（12 月进到下一年 1 月）
func addMonth(y int, m time.Month) (int, time.Month) {
	if m == time.December {
		return y + 1, time.January
	}
	return y, m + 1
}

// DateOnly 截断到当天 00:00:00 本地时间（日期比较前必须先做，否则时分秒会干扰）
// 包名 utility 下此前只有 DateStr（period_algorithm.go），没有等价物，故在此定义。
func DateOnly(t time.Time) time.Time {
	return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.Local)
}

// DaysLeft 距下次发生还有几天（0 = 就是今天；负数 = 已过，调用方应过滤）
func DaysLeft(next, today time.Time) int {
	return int(DateOnly(next).Sub(DateOnly(today)).Hours() / 24)
}

// IsLeapYear 是否闰年（公历规则：能被 4 整除且不能被 100 整除，或能被 400 整除）
func IsLeapYear(y int) bool {
	return (y%4 == 0 && y%100 != 0) || y%400 == 0
}
