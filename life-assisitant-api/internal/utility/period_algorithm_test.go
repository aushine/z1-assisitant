package utility

import (
	"testing"
	"time"

	"github.com/life-assistant/api/internal/model"
)

// baseDay 测试基准日（2026-08-25，与 03 §12 的示例一致）
func baseDay() time.Time {
	return time.Date(2026, 8, 25, 0, 0, 0, 0, time.Local)
}

// buildCycles 造一批周期：首个周期 cycle_length = NULL（与真实派生结果一致）
func buildCycles(firstStart time.Time, cycleLengths []int, periodLen int) []PeriodCycleInput {
	out := []PeriodCycleInput{}
	cur := firstStart
	e0 := cur.AddDate(0, 0, periodLen-1)
	out = append(out, PeriodCycleInput{StartDate: cur, EndDate: &e0, PeriodLength: periodLen})
	prev := cur
	for _, l := range cycleLengths {
		cur = prev.AddDate(0, 0, l)
		e := cur.AddDate(0, 0, periodLen-1)
		lenVal := l
		out = append(out, PeriodCycleInput{
			StartDate: cur, EndDate: &e, PeriodLength: periodLen, CycleLength: &lenVal,
		})
		prev = cur
	}
	return out
}

func defaultSettings() PeriodAlgoSettings {
	return PeriodAlgoSettings{
		AvgCycleLength:    28,
		AvgPeriodLength:   5,
		LutealLength:      14,
		ShowFertileWindow: true,
		IrregularAlert:    true,
	}
}

// ── §13 边界：一次都没记录 → insufficient，任何日期字段都不许出现 ──

func TestCompute_NoDataIsInsufficientAndHidesAllDates(t *testing.T) {
	today := baseDay()
	p := ComputePeriodPrediction(today, nil, nil, defaultSettings())

	if p.Confidence != PeriodConfInsufficient {
		t.Fatalf("confidence = %q, want %q", p.Confidence, PeriodConfInsufficient)
	}
	if p.NextPeriod != nil || p.Ovulation != nil || p.FertileWindow != nil ||
		p.PMSWindow != nil || p.CurrentCycle != nil {
		t.Fatalf("insufficient 下不允许返回任何日期：%+v", p)
	}
	if len(p.SafeWindows) != 0 {
		t.Fatalf("insufficient 下 safe_windows 必须为空，got %d", len(p.SafeWindows))
	}
	// 空切片而非 nil：JSON 里应是 [] 而不是 null
	if p.SafeWindows == nil || p.SymptomForecast == nil || p.Alerts == nil {
		t.Fatal("三个数组字段必须是非 nil 空切片（JSON 输出 [] 而非 null）")
	}
	if p.Stats == nil || p.Stats.MedianCycle != 28 {
		t.Fatalf("无样本时 stats.median_cycle 应回落到设置默认 28，got %+v", p.Stats)
	}
}

// ── §13 边界：只有 1 次经期（引导冷启动）→ low，且用默认周期估算 ──

func TestCompute_SingleIncompleteCycleIsLowAndUsesDefaultCycle(t *testing.T) {
	today := baseDay().AddDate(0, 0, 3)
	cycles := buildCycles(baseDay(), nil, 5) // 只有首个周期，cycle_length = NULL

	p := ComputePeriodPrediction(today, cycles, nil, defaultSettings())

	if p.Confidence != PeriodConfLow {
		t.Fatalf("confidence = %q, want low", p.Confidence)
	}
	if p.SampleSize != 0 {
		t.Fatalf("sample_size = %d, want 0", p.SampleSize)
	}
	if p.NextPeriod == nil {
		t.Fatal("low 置信度仍应给出（区间化的）下次经期")
	}
	if want := DateStr(baseDay().AddDate(0, 0, 28)); p.NextPeriod.Date != want {
		t.Fatalf("next_period.date = %s, want %s", p.NextPeriod.Date, want)
	}
	// low → half = clamp(ceil(σ),4,7)，σ=0 → 4
	if got := p.NextPeriod.Window[1]; got != DateStr(baseDay().AddDate(0, 0, 32)) {
		t.Fatalf("窗口上界 = %s, want +32", got)
	}
	if p.CurrentCycle == nil || p.CurrentCycle.DayIndex != 4 {
		t.Fatalf("current_cycle.day_index = %+v, want 4", p.CurrentCycle)
	}
}

// ── §4 置信度：6 个规律周期 → high ──

func TestCompute_RegularSixCyclesIsHigh(t *testing.T) {
	today := baseDay().AddDate(0, 0, 200)
	cycles := buildCycles(baseDay(), []int{29, 28, 30, 29, 29, 28}, 5)

	p := ComputePeriodPrediction(today, cycles, nil, defaultSettings())

	if p.Confidence != PeriodConfHigh {
		t.Fatalf("confidence = %q, want high (reason=%s)", p.Confidence, p.ConfidenceReason)
	}
	if p.SampleSize != 6 {
		t.Fatalf("sample_size = %d, want 6", p.SampleSize)
	}
	if p.Stats.MedianCycle != 29 {
		t.Fatalf("median_cycle = %d, want 29", p.Stats.MedianCycle)
	}
	if p.NextPeriod == nil || p.Ovulation == nil || p.FertileWindow == nil || p.PMSWindow == nil {
		t.Fatal("high 置信度必须给出完整的预测字段")
	}
	// 窗口有序性：下界 ≤ 中心日 ≤ 上界
	if p.NextPeriod.Window[0] > p.NextPeriod.Date || p.NextPeriod.Date > p.NextPeriod.Window[1] {
		t.Fatalf("窗口不合法：%v / %s", p.NextPeriod.Window, p.NextPeriod.Date)
	}
	// 易孕期必须落在排卵日**往前** 5 天（这是最容易写反的地方）
	wantFertileStart := DateStr(ParseMust(t, p.Ovulation.Date).AddDate(0, 0, -5))
	if p.FertileWindow.Start != wantFertileStart {
		t.Fatalf("fertile.start = %s, want %s（易孕期必须往前算）", p.FertileWindow.Start, wantFertileStart)
	}
	if p.FertileWindow.End != p.Ovulation.Date {
		t.Fatalf("fertile.end = %s, want %s", p.FertileWindow.End, p.Ovulation.Date)
	}
	// PMS 窗口 = 下次经期前 7 天
	if want := DateStr(ParseMust(t, p.NextPeriod.Date).AddDate(0, 0, -7)); p.PMSWindow.Start != want {
		t.Fatalf("pms.start = %s, want %s", p.PMSWindow.Start, want)
	}
}

// ── §3 中位数的抗干扰性：一次 60 天的漏记不能把 C_hat 带偏 ──

func TestCompute_MedianResistsOutlier(t *testing.T) {
	cycles := buildCycles(baseDay(), []int{28, 28, 28, 28, 60}, 5)
	p := ComputePeriodPrediction(baseDay().AddDate(0, 0, 260), cycles, nil, defaultSettings())

	if p.Stats.MedianCycle != 28 {
		t.Fatalf("median_cycle = %d, want 28（均值会被 60 拉到 34.4）", p.Stats.MedianCycle)
	}
	if p.NextPeriod == nil {
		t.Fatal("应当仍能给出下次经期")
	}
}

// ── §4/§5 波动大 → low，且区间下限放宽到 ≥4 天 ──

func TestCompute_IrregularIsLowWithWideWindow(t *testing.T) {
	cycles := buildCycles(baseDay(), []int{25, 40, 22, 45}, 5)
	p := ComputePeriodPrediction(baseDay().AddDate(0, 0, 140), cycles, nil, defaultSettings())

	if p.Confidence != PeriodConfLow {
		t.Fatalf("confidence = %q, want low", p.Confidence)
	}
	center := ParseMust(t, p.NextPeriod.Date)
	low := ParseMust(t, p.NextPeriod.Window[0])
	high := ParseMust(t, p.NextPeriod.Window[1])
	if DaysBetween(low, center) < 4 || DaysBetween(center, high) < 4 {
		t.Fatalf("low 置信度窗口过窄：%v", p.NextPeriod.Window)
	}
	if DaysBetween(low, center) > 7 {
		t.Fatalf("low 置信度窗口上限应为 7 天，got %d", DaysBetween(low, center))
	}
	// 排卵窗口在 low 下也要放宽到 ≥2 天
	if p.Ovulation != nil {
		oc := ParseMust(t, p.Ovulation.Date)
		if DaysBetween(oc, ParseMust(t, p.Ovulation.Window[1])) < 2 {
			t.Fatalf("low 置信度排卵窗口过窄：%v", p.Ovulation.Window)
		}
	}
}

// ── §13 边界：O 落到 S 之前 → 排卵与易孕期整体隐藏 ──

func TestCompute_HidesOvulationWhenLutealTooLongForCycle(t *testing.T) {
	st := defaultSettings()
	st.LutealLength = 18 // 个体偏长
	cycles := buildCycles(baseDay(), []int{15, 15, 15}, 5)

	p := ComputePeriodPrediction(baseDay().AddDate(0, 0, 40), cycles, nil, st)

	if p.NextPeriod == nil {
		t.Fatal("下次经期仍应给出")
	}
	if p.Ovulation != nil || p.FertileWindow != nil {
		t.Fatalf("排卵日推算不可靠时必须整体隐藏，got %+v / %+v", p.Ovulation, p.FertileWindow)
	}
	if len(p.SafeWindows) != 0 {
		t.Fatalf("没有排卵日时不应给出安全期，got %v", p.SafeWindows)
	}
}

// ── §9 关闭易孕期开关 → 排卵 / 易孕期 / 安全期一并隐藏 ──

func TestCompute_FertileToggleOffHidesEverything(t *testing.T) {
	st := defaultSettings()
	st.ShowFertileWindow = false
	cycles := buildCycles(baseDay(), []int{29, 28, 30, 29, 29, 28}, 5)

	p := ComputePeriodPrediction(baseDay().AddDate(0, 0, 200), cycles, nil, st)

	if p.Ovulation != nil || p.FertileWindow != nil {
		t.Fatal("show_fertile_window = 0 时排卵与易孕期必须隐藏")
	}
	if len(p.SafeWindows) != 0 {
		t.Fatal("只留下「安全期」是最糟的组合，必须一并隐藏")
	}
	if p.NextPeriod == nil {
		t.Fatal("下次经期不受该开关影响")
	}
}

// ── §10 异常检测 ──

func TestAlert_CycleShortAndSuspect(t *testing.T) {
	cycles := buildCycles(baseDay(), []int{18, 18, 12}, 5)
	p := ComputePeriodPrediction(baseDay().AddDate(0, 0, 60), cycles, nil, defaultSettings())

	codes := map[string]bool{}
	for _, a := range p.Alerts {
		codes[a.Code] = true
	}
	if !codes["CYCLE_SHORT"] {
		t.Fatalf("周期 18 天应触发 CYCLE_SHORT，got %+v", p.Alerts)
	}
	if !codes["SUSPECT_RECORD"] {
		t.Fatalf("cycle_length = 12 应触发 SUSPECT_RECORD，got %+v", p.Alerts)
	}
}

func TestAlert_DisabledBySetting(t *testing.T) {
	st := defaultSettings()
	st.IrregularAlert = false
	cycles := buildCycles(baseDay(), []int{18, 18, 18}, 5)

	p := ComputePeriodPrediction(baseDay().AddDate(0, 0, 60), cycles, nil, st)
	if len(p.Alerts) != 0 {
		t.Fatalf("irregular_alert = 0 时不应有任何提醒，got %+v", p.Alerts)
	}
}

func TestAlert_NoPeriod90(t *testing.T) {
	cycles := buildCycles(baseDay(), nil, 5)
	p := ComputePeriodPrediction(baseDay().AddDate(0, 0, 120), cycles, nil, defaultSettings())

	found := false
	for _, a := range p.Alerts {
		if a.Code == "NO_PERIOD_90" {
			found = true
		}
	}
	if !found {
		t.Fatalf("120 天未记录应触发 NO_PERIOD_90，got %+v", p.Alerts)
	}
}

// ── §8 体温法确认排卵 ──

func TestDetectOvulationByBBT_FindsRise(t *testing.T) {
	base := baseDay()
	vals := []float64{36.40, 36.45, 36.42, 36.48, 36.44, 36.46, 36.75, 36.80, 36.78}
	days := make([]PeriodDayInput, 0, len(vals))
	for i, v := range vals {
		vv := v
		days = append(days, PeriodDayInput{Date: base.AddDate(0, 0, i), Flow: model.FlowNone, BBT: &vv})
	}

	ov := DetectOvulationByBBT(base, base.AddDate(0, 0, 8), days, nil)
	if ov == nil {
		t.Fatal("应检测到升温并给出排卵日")
	}
	if want := DateStr(base.AddDate(0, 0, 5)); DateStr(*ov) != want {
		t.Fatalf("排卵日 = %s, want %s（升温首日 8/31 的前一天）", DateStr(*ov), want)
	}
}

func TestDetectOvulationByBBT_IgnoresOutlierAndNeedsContinuity(t *testing.T) {
	base := baseDay()
	// 第 8 天是发烧导致的异常跳变（+0.9），应被忽略；且只有 2 天连续升温 → 不出结论
	vals := []float64{36.40, 36.45, 36.42, 36.48, 36.44, 36.46, 36.75, 37.40, 36.60}
	days := make([]PeriodDayInput, 0, len(vals))
	for i, v := range vals {
		vv := v
		days = append(days, PeriodDayInput{Date: base.AddDate(0, 0, i), BBT: &vv})
	}

	if ov := DetectOvulationByBBT(base, base.AddDate(0, 0, 8), days, nil); ov != nil {
		t.Fatalf("只有 2 天连续升温不应给出结论，got %s", DateStr(*ov))
	}
}

// ── §2 派生规则：出血日分组 ──

func TestGroupBleedingDays_MergesOneDayGap(t *testing.T) {
	base := baseDay()
	mk := func(offsets []int, flow int) []PeriodDayInput {
		out := []PeriodDayInput{}
		for _, o := range offsets {
			out = append(out, PeriodDayInput{Date: base.AddDate(0, 0, o), Flow: flow})
		}
		return out
	}
	// 8/25,8/26,8/27 出血；8/28 空白；8/29 又出血 → 仍算同一次（夹 1 天）
	days := append(mk([]int{0, 1, 2}, model.FlowMedium), mk([]int{4}, model.FlowLight)...)

	groups := GroupBleedingDays(days)
	if len(groups) != 1 {
		t.Fatalf("夹 1 天应合并为 1 次，got %d", len(groups))
	}
	if groups[0].PeriodLength != 4 {
		t.Fatalf("出血天数 = %d, want 4（不含夹缝里的空白天）", groups[0].PeriodLength)
	}
	if DateStr(groups[0].StartDate) != DateStr(base) || DateStr(groups[0].EndDate) != DateStr(base.AddDate(0, 0, 4)) {
		t.Fatalf("起止 = %s~%s", DateStr(groups[0].StartDate), DateStr(groups[0].EndDate))
	}
}

func TestGroupBleedingDays_SplitsAtTwoDayGapAndIgnoresSpotting(t *testing.T) {
	base := baseDay()
	days := []PeriodDayInput{
		{Date: base, Flow: model.FlowMedium},
		{Date: base.AddDate(0, 0, 1), Flow: model.FlowHeavy},
		{Date: base.AddDate(0, 0, 2), Flow: model.FlowSpotting}, // 点滴不算
		{Date: base.AddDate(0, 0, 3), Flow: model.FlowNone},
		{Date: base.AddDate(0, 0, 4), Flow: model.FlowNone},
		{Date: base.AddDate(0, 0, 5), Flow: model.FlowLight}, // 隔了 4 天 → 新的一次
	}

	groups := GroupBleedingDays(days)
	if len(groups) != 2 {
		t.Fatalf("间隔 ≥2 天应断为新的一次，got %d", len(groups))
	}
	if groups[0].PeriodLength != 2 {
		t.Fatalf("第一组出血天数 = %d, want 2（点滴不计入）", groups[0].PeriodLength)
	}
	if groups[1].PeriodLength != 1 {
		t.Fatalf("第二组出血天数 = %d, want 1", groups[1].PeriodLength)
	}
}

// ── §11 症状预测 ──

func TestForecastSymptoms_Thresholds(t *testing.T) {
	base := baseDay()
	cycleLen := 30
	// 单个周期：start = base，length = 30 → 它的「经前 7 天」= base+23 .. base+29
	cycles := []PeriodCycleInput{{StartDate: base, CycleLength: &cycleLen, PeriodLength: 5}}
	pmsStart := base.AddDate(0, 0, 23)

	days := []PeriodDayInput{}
	// bloating：窗口内 3 次 + 窗口外 1 次 → n=3 ≥3，rate=0.75 → 命中
	for i := 0; i < 3; i++ {
		days = append(days, PeriodDayInput{Date: pmsStart.AddDate(0, 0, i), Symptoms: []string{"bloating"}})
	}
	days = append(days, PeriodDayInput{Date: pmsStart.AddDate(0, 0, -20), Symptoms: []string{"bloating"}})
	// cramps：窗口内 2 次 → n<3 → 不命中
	days = append(days, PeriodDayInput{Date: pmsStart.AddDate(0, 0, 1), Symptoms: []string{"cramps"}})
	days = append(days, PeriodDayInput{Date: pmsStart.AddDate(0, 0, 2), Symptoms: []string{"cramps"}})
	// headache：窗口内 3 次，但总出现 8 次 → rate=0.375 <0.5 → 不命中
	for i := 0; i < 3; i++ {
		days = append(days, PeriodDayInput{Date: pmsStart.AddDate(0, 0, i), Symptoms: []string{"headache"}})
	}
	for i := 0; i < 5; i++ {
		days = append(days, PeriodDayInput{Date: pmsStart.AddDate(0, 0, -30-i), Symptoms: []string{"headache"}})
	}

	out := forecastSymptoms(days, cycles, 30)
	if len(out) != 1 {
		t.Fatalf("只有 bloating 应命中，got %+v", out)
	}
	if out[0].Key != "bloating" || out[0].Label != "腹胀" {
		t.Fatalf("命中项 = %+v, want bloating/腹胀", out[0])
	}
	if out[0].Rate != 0.75 {
		t.Fatalf("rate = %v, want 0.75", out[0].Rate)
	}
}

// ── 词库一致性 ──

func TestSymptomVocabulary(t *testing.T) {
	if got := PeriodSymptomCount(); got != 31 {
		t.Fatalf("症状词库应为 31 项，got %d", got)
	}
	for _, g := range PeriodSymptomGroups() {
		for _, it := range g.Items {
			if !PeriodSymptomValid(it.Key) {
				t.Fatalf("key %q 未登记", it.Key)
			}
			if PeriodSymptomLabel(it.Key) != it.Label {
				t.Fatalf("label 不一致：%s → %s / %s", it.Key, PeriodSymptomLabel(it.Key), it.Label)
			}
		}
	}
	if PeriodSymptomLabel("not_a_key") != "not_a_key" {
		t.Fatal("未知 key 应原样返回，而不是空串")
	}
	if len(PeriodDefaultRecentSymptoms()) != 6 {
		t.Fatal("近期症状默认补足顺序应为 6 项")
	}
	if PeriodDischargeLabel(5) != "蛋清拉丝" || PeriodDischargeLabel(0) != "未记录" {
		t.Fatal("分泌物文案映射错误")
	}
}

// ── 工具函数 ──

func TestDaysBetweenAndRound2(t *testing.T) {
	a := time.Date(2026, 8, 25, 23, 30, 0, 0, time.Local)
	b := time.Date(2026, 9, 23, 1, 0, 0, 0, time.Local)
	if got := DaysBetween(a, b); got != 29 {
		t.Fatalf("DaysBetween = %d, want 29（必须先归零再算）", got)
	}
	if got := Round2(1.4826 * 0.5); got != 0.74 {
		t.Fatalf("Round2 = %v, want 0.74", got)
	}
}

// ParseMust 测试内解析日期，失败即 fail
func ParseMust(t *testing.T, s string) time.Time {
	t.Helper()
	d, err := ParseDate(s)
	if err != nil {
		t.Fatalf("解析日期失败：%s", s)
	}
	return d
}
