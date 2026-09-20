package utility

import (
	"testing"
	"time"

	"github.com/life-assistant/api/internal/model"
)

// ⚠️ 本文件是 md/spec-20260919-v1/04 §6 强制要求的回归测试：
// 体温从 period_days 迁到 health_days 后，算法的读取路径必须改。
// **不改的话不会报错、不会 panic、接口照常返回 200**，只是体温法永远判定「无数据」——
// 这类静默失效只能靠测试兜住。

var bbtBase = time.Date(2026, 3, 1, 0, 0, 0, 0, time.Local)

// ⚠️ 升温幅度必须 ≥ 0.3℃：阈值是「≥ 前 6 天均值 + 0.2」，而升温本身会把均值抬高，
//
//	第 3 天时前 6 天里已有 2 天是高温 → 只升 0.25 会在第 3 天掉到阈值下（36.65 < 36.68）。
const (
	bbtFlatV = 36.40
	bbtRiseV = 36.75 // +0.35，第 3 天时阈值 36.717，仍成立
)

// bbtSeries 构造 n 天体温：前 flat 天是 flatV，之后是 riseV
func bbtSeries(n, flat int, flatV, riseV float64) map[string]float64 {
	out := make(map[string]float64, n)
	for i := 0; i < n; i++ {
		v := flatV
		if i >= flat {
			v = riseV
		}
		out[bbtBase.AddDate(0, 0, i).Format("2006-01-02")] = v
	}
	return out
}

// T1 · 体温数据在 health_days，连续 3 天高于前 6 天均值 0.2℃ → 检出排卵日
func TestDetectOvulationByBBT_FromHealthDays(t *testing.T) {
	days := make([]PeriodDayInput, 0, 9)
	for i := 0; i < 9; i++ {
		days = append(days, PeriodDayInput{Date: bbtBase.AddDate(0, 0, i), Flow: model.FlowNone})
	}
	bbtByDate := bbtSeries(9, 6, bbtFlatV, bbtRiseV)

	ov := DetectOvulationByBBT(bbtBase, bbtBase.AddDate(0, 0, 8), days, bbtByDate)
	if ov == nil {
		t.Fatal("体温已迁到 health_days，必须能检出排卵日；返回 nil 说明读取路径没改（静默失效）")
	}
	// 升温区间第一天 = 第 7 天（index 6）→ 排卵日 = 它 − 1 天 = index 5
	want := bbtBase.AddDate(0, 0, 5)
	if !ov.Equal(want) {
		t.Errorf("排卵日 = %s, want %s", ov.Format("2006-01-02"), want.Format("2006-01-02"))
	}
}

// T2 · 单日异常跳变 +1.2℃（发烧/饮酒/熬夜）→ 该点被剔除，且日历连续性被打断 → 不判定
func TestDetectOvulationByBBT_IgnoresOutlierFromHealthDays(t *testing.T) {
	days := make([]PeriodDayInput, 0, 10)
	for i := 0; i < 10; i++ {
		days = append(days, PeriodDayInput{Date: bbtBase.AddDate(0, 0, i), Flow: model.FlowNone})
	}
	bbtByDate := bbtSeries(10, 6, bbtFlatV, bbtRiseV)
	// 第 7 天塞一个 +1.2℃ 的异常点
	bbtByDate[bbtBase.AddDate(0, 0, 6).Format("2006-01-02")] = 37.60

	// 异常点剔除后剩 9 个点（够门槛），但 day5 → day7 断了 2 天 → 连续性不成立 → nil
	if ov := DetectOvulationByBBT(bbtBase, bbtBase.AddDate(0, 0, 9), days, bbtByDate); ov != nil {
		t.Errorf("异常跳变点应被忽略，不应检出排卵日，got %s", ov.Format("2006-01-02"))
	}
}

// T3 · health_days 无 bbt、period_days 有历史 bbt → 回落到旧列，不 panic（过渡期双写兼容）
func TestDetectOvulationByBBT_FallsBackToPeriodDays(t *testing.T) {
	days := make([]PeriodDayInput, 0, 9)
	for i := 0; i < 9; i++ {
		v := bbtFlatV
		if i >= 6 {
			v = bbtRiseV
		}
		vv := v
		days = append(days, PeriodDayInput{Date: bbtBase.AddDate(0, 0, i), Flow: model.FlowNone, BBT: &vv})
	}
	// bbtByDate 传 nil（health_days 还没迁到数据）
	ov := DetectOvulationByBBT(bbtBase, bbtBase.AddDate(0, 0, 8), days, nil)
	if ov == nil {
		t.Fatal("过渡期 health_days 无数据时，应回落到 period_days 的历史体温，而不是直接判无数据")
	}
	want := bbtBase.AddDate(0, 0, 5)
	if !ov.Equal(want) {
		t.Errorf("排卵日 = %s, want %s", ov.Format("2006-01-02"), want.Format("2006-01-02"))
	}
}

// T4 · ⚠️ 最关键：用户只量体温、不记经期 → period_days 那天**根本没有行**，
//
//	体温只在 health_days。只遍历 days 会漏掉这些点，导致「明明每天量体温却判定无数据」。
func TestDetectOvulationByBBT_OnlyInHealthDays(t *testing.T) {
	days := []PeriodDayInput{} // period_days 一条都没有
	bbtByDate := bbtSeries(9, 6, bbtFlatV, bbtRiseV)

	ov := DetectOvulationByBBT(bbtBase, bbtBase.AddDate(0, 0, 8), days, bbtByDate)
	if ov == nil {
		t.Fatal("体温只存在于 health_days 时必须也能检出（构造 PeriodDayInput 的日期集合不能只来自 period_days）")
	}
	want := bbtBase.AddDate(0, 0, 5)
	if !ov.Equal(want) {
		t.Errorf("排卵日 = %s, want %s", ov.Format("2006-01-02"), want.Format("2006-01-02"))
	}
}

// T5 · health_days 的值**覆盖** period_days 的值（迁移后以新表为准）
func TestDetectOvulationByBBT_HealthDaysWins(t *testing.T) {
	days := make([]PeriodDayInput, 0, 9)
	for i := 0; i < 9; i++ {
		vv := bbtFlatV // period_days 全是平温（旧数据，不该被采用）
		days = append(days, PeriodDayInput{Date: bbtBase.AddDate(0, 0, i), Flow: model.FlowNone, BBT: &vv})
	}
	// health_days 有真实升温
	bbtByDate := bbtSeries(9, 6, bbtFlatV, bbtRiseV)

	ov := DetectOvulationByBBT(bbtBase, bbtBase.AddDate(0, 0, 8), days, bbtByDate)
	if ov == nil {
		t.Fatal("同一天两表都有值时必须以 health_days 为准；返回 nil 说明被旧列覆盖了")
	}
	want := bbtBase.AddDate(0, 0, 5)
	if !ov.Equal(want) {
		t.Errorf("排卵日 = %s, want %s", ov.Format("2006-01-02"), want.Format("2006-01-02"))
	}
}
