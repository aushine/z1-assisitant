package utility

import (
	"testing"
	"time"

	"github.com/life-assistant/api/internal/model"
)

// ⚠️ 本文件覆盖 md/spec-20260919-v1/04 §4 明确要求的边界：
//   - rule=2（每年）且基准为 2月29日 → 非闰年落到 2月28日
//   - rule=3（每月）且基准为 31 日   → 该月没有 31 日时取该月最后一天
//   - rule=4（每周）的跨周围绕
func TestNextDate(t *testing.T) {
	cases := []struct {
		name  string
		base  string // 基准日期 YYYY-MM-DD
		rule  int
		today string
		want  string // 期望的 next_date
	}{
		// ---- 不重复 ----
		{name: "不重复_未来", base: "2026-12-25", rule: model.RepeatNone, today: "2026-09-19", want: "2026-12-25"},
		{name: "不重复_已过仍返回基准（由调用方过滤）", base: "2020-01-01", rule: model.RepeatNone, today: "2026-09-19", want: "2020-01-01"},

		// ---- 每年 ----
		{name: "每年_今年未到", base: "1990-10-22", rule: model.RepeatYearly, today: "2026-09-19", want: "2026-10-22"},
		{name: "每年_今年已过", base: "1990-02-14", rule: model.RepeatYearly, today: "2026-09-19", want: "2027-02-14"},
		{name: "每年_就是今天", base: "1990-09-19", rule: model.RepeatYearly, today: "2026-09-19", want: "2026-09-19"},

		// ---- 每年 × 2月29日（⚠️ 关键边界）----
		{name: "每年_2月29日_2026平年落到2月28", base: "2000-02-29", rule: model.RepeatYearly, today: "2026-01-01", want: "2026-02-28"},
		{name: "每年_2月29日_2028闰年正常2月29", base: "2000-02-29", rule: model.RepeatYearly, today: "2028-01-01", want: "2028-02-29"},
		{name: "每年_2月29日_已过则次年", base: "2000-02-29", rule: model.RepeatYearly, today: "2026-03-01", want: "2027-02-28"},

		// ---- 每月 × 31 日（⚠️ 关键边界）----
		{name: "每月_31日_31天月正常", base: "2020-01-31", rule: model.RepeatMonthly, today: "2026-08-01", want: "2026-08-31"},
		{name: "每月_31日_30天月取30", base: "2020-01-31", rule: model.RepeatMonthly, today: "2026-09-01", want: "2026-09-30"},
		{name: "每月_31日_2月平年取28", base: "2020-01-31", rule: model.RepeatMonthly, today: "2026-02-01", want: "2026-02-28"},
		{name: "每月_31日_2月闰年取29", base: "2020-01-31", rule: model.RepeatMonthly, today: "2028-02-01", want: "2028-02-29"},
		{name: "每月_15日_本月已过则下月", base: "2020-01-15", rule: model.RepeatMonthly, today: "2026-09-19", want: "2026-10-15"},

		// ---- 每周 ----
		{name: "每周_本周未到", base: "2026-01-05", rule: model.RepeatWeekly, today: "2026-09-19", want: "2026-09-21"}, // 基准周一 → 本周/下周周一
		{name: "每周_同星期就是今天", base: "2026-09-12", rule: model.RepeatWeekly, today: "2026-09-19", want: "2026-09-19"},

		// ---- 跨年 ----
		{name: "每年_跨年到次年1月", base: "1990-01-05", rule: model.RepeatYearly, today: "2026-12-31", want: "2027-01-05"},
		{name: "每月_12月跨年", base: "2020-01-10", rule: model.RepeatMonthly, today: "2026-12-15", want: "2027-01-10"},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			base := mustDate(t, c.base)
			today := mustDate(t, c.today)
			want := mustDate(t, c.want)

			got, ok := NextDate(base, c.rule, today)
			if !ok {
				t.Fatalf("NextDate 返回 ok=false（规则非法？）rule=%d", c.rule)
			}
			if !got.Equal(want) {
				t.Errorf("NextDate(base=%s, rule=%d, today=%s) = %s, want %s",
					c.base, c.rule, c.today, got.Format("2006-01-02"), c.want)
			}
		})
	}
}

func TestNextDate_InvalidRule(t *testing.T) {
	base := mustDate(t, "2026-01-01")
	today := mustDate(t, "2026-09-19")
	_, ok := NextDate(base, 99, today)
	if ok {
		t.Error("非法规则应返回 ok=false，让调用方回落到「不重复」，而不是 panic 或静默算错")
	}
}

func TestDaysLeft(t *testing.T) {
	cases := []struct {
		next  string
		today string
		want  int
	}{
		{next: "2026-09-19", today: "2026-09-19", want: 0}, // 就是今天
		{next: "2026-09-22", today: "2026-09-19", want: 3},
		{next: "2026-09-10", today: "2026-09-19", want: -9}, // 已过（调用方过滤）
		{next: "2027-01-01", today: "2026-12-31", want: 1},  // 跨年
	}
	for _, c := range cases {
		got := DaysLeft(mustDate(t, c.next), mustDate(t, c.today))
		if got != c.want {
			t.Errorf("DaysLeft(%s, %s) = %d, want %d", c.next, c.today, got, c.want)
		}
	}
}

func TestIsLeapYear(t *testing.T) {
	cases := map[int]bool{
		2000: true, // 能被 400 整除
		2024: true,
		2028: true,
		1900: false, // 能被 100 整除但不能被 400 整除
		2026: false,
		2027: false,
	}
	for y, want := range cases {
		if got := IsLeapYear(y); got != want {
			t.Errorf("IsLeapYear(%d) = %v, want %v", y, got, want)
		}
	}
}

func TestDateOnly_TruncatesTime(t *testing.T) {
	in := time.Date(2026, 9, 19, 23, 59, 59, 999999999, time.Local)
	got := DateOnly(in)
	if got.Hour() != 0 || got.Minute() != 0 || got.Second() != 0 || got.Nanosecond() != 0 {
		t.Errorf("DateOnly 未截断时分秒：%v", got)
	}
}

// mustDate 解析 YYYY-MM-DD，失败直接 fail（测试数据写错就该立刻暴露）
func mustDate(t *testing.T, s string) time.Time {
	t.Helper()
	d, err := time.ParseInLocation("2006-01-02", s, time.Local)
	if err != nil {
		t.Fatalf("测试日期解析失败 %q: %v", s, err)
	}
	return d
}
