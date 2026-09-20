// Package utility 经期预测算法（纯函数，无 IO，便于单测）
//
// 实现依据：md/spec-260919/03-预测算法规范.md
// 为什么放在后端：两端复用同一份算法，避免移动端 / 桌面端漂移；
// 且置信度、异常检测这类逻辑一旦分裂，两边会在不同时间给出不同结论 —— 用户会立刻发现。
//
// 三条不可动摇的约束：
//  1. 一律用中位数 + MAD×1.4826，不用均值 + 标准差（一次漏记的 60 天「周期」能把均值拉偏 5 天以上）；
//  2. 置信度 = insufficient 时**一个日期都不返回**（用默认 28 天算出来的假日期和真预测长得一模一样）；
//  3. 「相对安全期」不上色、不落 mark，旁必附「仅作参考，不能作为避孕依据」。
package utility

import (
	"fmt"
	"math"
	"sort"
	"time"

	"github.com/life-assistant/api/internal/model"
	"github.com/life-assistant/api/internal/model/dto"
)

// PeriodDateLayout 项目统一日期格式
const PeriodDateLayout = "2006-01-02"

// 置信度四档（03 §4）
const (
	PeriodConfHigh         = "high"
	PeriodConfMedium       = "medium"
	PeriodConfLow          = "low"
	PeriodConfInsufficient = "insufficient"
)

// 算法常量（03 §1）
const (
	// PeriodSampleWindow 统计样本窗口：只用最近 6 个完整周期
	PeriodSampleWindow = 6
	// PeriodFertileLeadDays 易孕期从排卵日**往前**算 5 天（精子存活 3–5 天，卵子仅 12–24h）
	PeriodFertileLeadDays = 5
	// PeriodPMSLeadDays PMS 窗口：下次经期前 7 天
	PeriodPMSLeadDays = 7
	// PeriodGapDays 相邻两次经期开始间隔 > 90 天 → 视为跨越中断，cycle_length = NULL
	PeriodGapDays = 90
	// PeriodSuspectCycle 周期短于 15 天 → 标记 suspect（可能录错，但不自动合并）
	PeriodSuspectCycle = 15
	// PeriodLutealMin/Max 体温法校准后的黄体期区间（个体 11–16 天）
	PeriodLutealMin = 11
	PeriodLutealMax = 16
	// periodMergeGapDays 组内允许夹的无出血天数（间隔 1 天仍视为同一次经期）
	periodMergeGapDays = 1
)

// PeriodCycleInput 周期输入（RebuildCycles 的产物）
type PeriodCycleInput struct {
	StartDate       time.Time
	EndDate         *time.Time
	PeriodLength    int
	CycleLength     *int
	OvulationDate   *time.Time
	OvulationSource int
}

// PeriodDayInput 逐日输入（只取算法用得到的列）
type PeriodDayInput struct {
	Date     time.Time
	Flow     int
	BBT      *float64
	Symptoms []string
}

// PeriodAlgoSettings 预测入参（period_settings 的相关字段）
type PeriodAlgoSettings struct {
	AvgCycleLength    int
	AvgPeriodLength   int
	LutealLength      int
	ShowFertileWindow bool
	IrregularAlert    bool
}

// ============================================================================
// 主入口
// ============================================================================

// ComputePeriodPrediction 计算完整预测对象（03 §12）
//
// cycles 必须按 start_date 升序；days 顺序不限（本函数只做聚合）。
// 无任何周期记录时返回 confidence = insufficient 的对象，
// 除 stats 外所有日期字段为 nil —— 前端据此隐藏全部具体日期。
func ComputePeriodPrediction(
	today time.Time,
	cycles []PeriodCycleInput,
	days []PeriodDayInput,
	st PeriodAlgoSettings,
) *dto.PeriodPrediction {
	today = TruncateDate(today)
	if st.AvgCycleLength <= 0 {
		st.AvgCycleLength = 28
	}
	if st.AvgPeriodLength <= 0 {
		st.AvgPeriodLength = 5
	}
	if st.LutealLength <= 0 {
		st.LutealLength = 14
	}

	// ── 步骤 1：历史特征统计（中位数 + MAD） ──
	lengths := recentCycleLengths(cycles, PeriodSampleWindow)
	med := medianInt(lengths)
	sigma := 1.4826 * medianFloat(absDeviations(lengths, med))

	periodLens := recentPeriodLengths(cycles, PeriodSampleWindow)
	medPeriod := medianInt(periodLens)

	C := st.AvgCycleLength // C_hat
	if len(lengths) > 0 {
		C = med
	}
	L := st.AvgPeriodLength // L_hat
	if len(periodLens) > 0 {
		L = medPeriod
	}

	// ── 步骤 2：置信度分级 ──
	conf, reason := periodConfidence(cycles, lengths, C, sigma)

	p := &dto.PeriodPrediction{
		Today:            DateStr(today),
		Confidence:       conf,
		ConfidenceReason: reason,
		SampleSize:       len(lengths),
		SafeWindows:      []dto.PeriodDateRange{},
		SymptomForecast:  []dto.PeriodSymptomItem{},
		Alerts:           []dto.PeriodAlert{},
		Stats: &dto.PeriodPredictionStats{
			MedianCycle:  C,
			Sigma:        Round2(sigma),
			RecentCycles: lengths,
			MedianPeriod: L,
			LutealLength: st.LutealLength,
		},
	}

	// 一次经期都没记录 → 到此为止，日期字段全部为 nil（最值钱的一条约束）
	if len(cycles) == 0 {
		return p
	}

	// ── 步骤 3：下次经期 ──
	S := TruncateDate(cycles[len(cycles)-1].StartDate)
	nextStart := S.AddDate(0, 0, C)

	half := clampInt(int(math.Ceil(sigma)), 0, 3)
	if conf == PeriodConfLow {
		// low：下限放宽到 max(4, ceil(σ))，上限 7 天（03 §5）
		half = clampInt(int(math.Ceil(sigma)), 4, 7)
	}

	p.NextPeriod = &dto.PeriodNextPeriod{
		Date:      DateStr(nextStart),
		Window:    []string{DateStr(nextStart.AddDate(0, 0, -half)), DateStr(nextStart.AddDate(0, 0, half))},
		LengthEst: L,
		EndEst:    DateStr(nextStart.AddDate(0, 0, L-1)),
		DaysUntil: DaysBetween(today, nextStart),
		Overdue:   today.After(nextStart.AddDate(0, 0, half)),
	}

	// ── 步骤 4：排卵日与易孕期 ──
	luteal := personalizedLuteal(cycles, st.LutealLength)
	O := nextStart.AddDate(0, 0, -luteal)
	// 边界（03 §13）：O 落到 S 之前 → 本次周期排卵日无法可靠推算，排卵与易孕期整体隐藏
	ovulationValid := st.ShowFertileWindow && !O.Before(S)

	if ovulationValid {
		oHalf := half
		if conf == PeriodConfLow {
			oHalf = maxInt(2, half)
		}
		p.Ovulation = &dto.PeriodOvulation{
			Date:   DateStr(O),
			Window: []string{DateStr(O.AddDate(0, 0, -oHalf)), DateStr(O.AddDate(0, 0, oHalf))},
			Passed: today.After(O),
		}
		p.FertileWindow = &dto.PeriodFertileWindow{
			Start: DateStr(O.AddDate(0, 0, -PeriodFertileLeadDays)),
			End:   DateStr(O),
			Peak:  []string{DateStr(O.AddDate(0, 0, -1)), DateStr(O)},
		}
		p.SafeWindows = periodSafeWindows(S, L, O, nextStart)
	}

	// ── 步骤 5：当前周期与阶段 ──
	cur := currentCycleOf(cycles, today)
	curS := TruncateDate(cur.StartDate)
	dayIndex := DaysBetween(curS, today) + 1
	if dayIndex < 1 {
		dayIndex = 1
	}
	p.CurrentCycle = &dto.PeriodCurrentCycle{
		StartDate:       DateStr(curS),
		DayIndex:        dayIndex,
		EstimatedLength: C,
		Phase:           periodPhaseOf(today, curS, L, O, C, luteal, ovulationValid),
	}

	// ── 步骤 6：PMS 窗口 ──
	p.PMSWindow = &dto.PeriodDateRange{
		Start: DateStr(nextStart.AddDate(0, 0, -PeriodPMSLeadDays)),
		End:   DateStr(nextStart.AddDate(0, 0, -1)),
	}

	p.Stats.LutealLength = luteal

	// ── 步骤 8：异常检测 ──
	if st.IrregularAlert {
		p.Alerts = detectPeriodAlerts(cycles, lengths, C, L, S, today)
	}

	// ── 步骤 9：症状预测 ──
	p.SymptomForecast = forecastSymptoms(days, cycles, C)

	return p
}

// ============================================================================
// 步骤 2 —— 置信度
// ============================================================================

// periodConfidence 置信度分级（03 §4）
//
// 与 §4 表格的一处刻意偏离：§4 写「N == 0 → insufficient」，但 §13 又要求
// 「只有引导时填的 last_period_start、无逐日记录」时 confidence = low（用默认周期预测）。
// 二者在「已有 1 次经期、尚无完整周期」时冲突，这里按 §13 处理：
//   - 一次经期都没有（cycles 空）→ insufficient（真的没数据）
//   - 有经期但还没有一个完整周期（lengths 空）→ low，并说明「按默认 N 天周期估算」
func periodConfidence(cycles []PeriodCycleInput, lengths []int, C int, sigma float64) (string, string) {
	switch {
	case len(cycles) == 0:
		return PeriodConfInsufficient, "还没有任何经期记录，先从记录一次经期开始"
	case len(lengths) == 0:
		return PeriodConfLow, fmt.Sprintf("目前只有 1 次经期记录，按默认 %d 天周期估算", C)
	case len(lengths) == 1:
		return PeriodConfLow, "目前只有 1 个完整周期，预测仅供参考"
	case len(lengths) >= 3 && sigma <= 1.5:
		return PeriodConfHigh, fmt.Sprintf("近 %d 个周期波动在 %.1f 天以内", len(lengths), sigma)
	case sigma <= 3.5:
		return PeriodConfMedium, fmt.Sprintf("近 %d 个周期波动约 %.1f 天", len(lengths), sigma)
	default:
		return PeriodConfLow, fmt.Sprintf("近 %d 个周期波动较大（约 %.1f 天）", len(lengths), sigma)
	}
}

// ============================================================================
// 步骤 4 —— 黄体期长度个性化（03 §8 的消费端）
// ============================================================================

// personalizedLuteal 能用体温法就个性化，否则用设置值
// samples = cycles[i+1].start_date − cycles[i].ovulation_date（取最近 3 个体温法周期）
func personalizedLuteal(cycles []PeriodCycleInput, fallback int) int {
	var samples []int
	for i := 0; i < len(cycles)-1; i++ {
		c := cycles[i]
		if c.OvulationSource != model.OvulationSourceBBT || c.OvulationDate == nil {
			continue
		}
		d := DaysBetween(*c.OvulationDate, cycles[i+1].StartDate)
		if d > 0 {
			samples = append(samples, d)
		}
	}
	if len(samples) == 0 {
		return fallback
	}
	if len(samples) > 3 {
		samples = samples[len(samples)-3:]
	}
	return clampInt(medianInt(samples), PeriodLutealMin, PeriodLutealMax)
}

// ============================================================================
// 步骤 5 —— 阶段判定（四相）
// ============================================================================

// periodPhaseOf 判定某天所处阶段（03 §7）
func periodPhaseOf(today, S time.Time, L int, O time.Time, C, luteal int, oValid bool) *dto.PeriodPhase {
	const (
		keyMenstrual   = "menstrual"
		keyFollicular  = "follicular"
		keyOvulation   = "ovulation"
		keyLuteal      = "luteal"
		descMenstrual  = "子宫内膜脱落，注意保暖与休息"
		descFollicular = "雌激素回升，精力与状态通常最好"
		descOvulation  = "受孕概率最高的窗口"
		descLuteal     = "孕激素升高，可能出现水肿、情绪波动"
	)
	dayIndex := DaysBetween(S, today) + 1

	switch {
	case dayIndex <= L:
		return &dto.PeriodPhase{Key: keyMenstrual, Label: "月经期", Desc: descMenstrual}
	case oValid && dayIndex > L && absInt(DaysBetween(today, O)) <= 1:
		return &dto.PeriodPhase{Key: keyOvulation, Label: "排卵期", Desc: descOvulation}
	case oValid && today.After(O.AddDate(0, 0, 1)):
		return &dto.PeriodPhase{Key: keyLuteal, Label: "黄体期", Desc: descLuteal}
	case !oValid && dayIndex > C-luteal:
		// 排卵日无法推算时的降级：按剩余天数落在黄体期区间
		return &dto.PeriodPhase{Key: keyLuteal, Label: "黄体期", Desc: descLuteal}
	default:
		return &dto.PeriodPhase{Key: keyFollicular, Label: "卵泡期", Desc: descFollicular}
	}
}

// ============================================================================
// 步骤 7 —— 「相对安全期」（03 §9）
// ============================================================================

// periodSafeWindows 相对不易受孕的区间
// ⚠️ 产品红线：日历法避孕年失败率 7.2%–8.3%，前端**不上色**、旁必附免责行。
// 区间长度 < 2 天则不返回（没有意义的碎片）。
func periodSafeWindows(S time.Time, L int, O, nextStart time.Time) []dto.PeriodDateRange {
	out := []dto.PeriodDateRange{}

	// 黄体期后段：卵子已失活，相对最低风险
	w1s, w1e := O.AddDate(0, 0, 2), nextStart.AddDate(0, 0, -1)
	if DaysBetween(w1s, w1e)+1 >= 2 {
		out = append(out, dto.PeriodDateRange{Start: DateStr(w1s), End: DateStr(w1e)})
	}

	// 经期结束到易孕期之前
	w2s, w2e := S.AddDate(0, 0, L), O.AddDate(0, 0, -PeriodFertileLeadDays-1)
	if DaysBetween(w2s, w2e)+1 >= 2 {
		out = append(out, dto.PeriodDateRange{Start: DateStr(w2s), End: DateStr(w2e)})
	}

	return out
}

// ============================================================================
// 步骤 8 —— 异常检测（03 §10）
// ============================================================================

// detectPeriodAlerts 异常提醒（仅在 irregular_alert = 1 时调用）
// ⚠️ 所有 alert 渲染后必须跟随固定尾注（见 dto 注释 / 04 §7），前端负责。
func detectPeriodAlerts(cycles []PeriodCycleInput, lengths []int, C, L int, S, today time.Time) []dto.PeriodAlert {
	out := []dto.PeriodAlert{}
	add := func(code, level, text string) {
		out = append(out, dto.PeriodAlert{Code: code, Level: level, Text: text})
	}

	if C < 21 {
		add("CYCLE_SHORT", "warning", fmt.Sprintf("你的周期偏短（平均 %d 天）。周期短于 21 天建议咨询医生。", C))
	}
	if C > 35 {
		add("CYCLE_LONG", "warning", fmt.Sprintf("你的周期偏长（平均 %d 天）。周期长于 35 天建议咨询医生。", C))
	}
	if L > 7 {
		add("PERIOD_LONG", "warning", fmt.Sprintf("经期已持续 %d 天，如果长期如此建议就医检查。", L))
	}

	// IRREGULAR：最近 3 个周期与 C_hat 偏差均 > 7 天
	if len(lengths) >= 3 {
		allOff := true
		for _, x := range lengths[len(lengths)-3:] {
			if absInt(x-C) <= 7 {
				allOff = false
				break
			}
		}
		if allOff {
			add("IRREGULAR", "info",
				"你的周期波动较大，日历预测参考价值有限。记录基础体温能显著提高准确度。")
		}
	}

	// NO_PERIOD_90：中文案里的「N 天」用 today − S
	if gap := DaysBetween(S, today); gap > PeriodGapDays {
		add("NO_PERIOD_90", "warning",
			fmt.Sprintf("已有 %d 天没有记录经期。若非已知原因（如怀孕、哺乳、绝经），建议咨询医生。", gap))
	}

	// SUSPECT_RECORD：最近一次 suspect 周期
	for i := len(cycles) - 1; i >= 0; i-- {
		if cycles[i].CycleLength != nil && *cycles[i].CycleLength < PeriodSuspectCycle {
			add("SUSPECT_RECORD", "info",
				fmt.Sprintf("这两次记录间隔很短（%d 天），是否录入有误？", *cycles[i].CycleLength))
			break
		}
	}

	return out
}

// ============================================================================
// 步骤 9 —— 症状预测（03 §11）
// ============================================================================

// forecastSymptoms 经前常见症状 Top 3
//
// 「按周期日分桶」的实现细节（03 §11 的落地补注）：§11 写的是
// `PRE_PMS = [next_start−7, next_start−1]`，若直接拿**未来**的 next_start 分桶，
// 历史记录永远不会落进窗口，功能等于不生效。因此这里改成：
// 对每一条历史周期各自算出「它自己的经前 7 天」窗口，再统计症状落点。
// 最后一个（进行中的）周期用 `C_hat` 估算它的下次经期。
//
// 数据不足（该症状在经前窗口内出现 < 3 次）不输出，
// 避免「你 100% 会头痛」这种基于一次的荒谬结论。
func forecastSymptoms(days []PeriodDayInput, cycles []PeriodCycleInput, C int) []dto.PeriodSymptomItem {
	type span struct{ s, e time.Time }
	windows := make([]span, 0, len(cycles))
	for i, c := range cycles {
		cs := TruncateDate(c.StartDate)
		var nextStart time.Time
		switch {
		case i+1 < len(cycles):
			nextStart = TruncateDate(cycles[i+1].StartDate)
		case c.CycleLength != nil:
			nextStart = cs.AddDate(0, 0, *c.CycleLength)
		default:
			nextStart = cs.AddDate(0, 0, C)
		}
		windows = append(windows, span{
			s: nextStart.AddDate(0, 0, -PeriodPMSLeadDays),
			e: nextStart.AddDate(0, 0, -1),
		})
	}

	total := map[string]int{}
	inPMS := map[string]int{}
	for _, d := range days {
		dd := TruncateDate(d.Date)
		hit := false
		for _, w := range windows {
			if !dd.Before(w.s) && !dd.After(w.e) {
				hit = true
				break
			}
		}
		for _, k := range d.Symptoms {
			total[k]++
			if hit {
				inPMS[k]++
			}
		}
	}

	type cand struct {
		key  string
		n    int
		rate float64
	}
	cands := []cand{}
	for k, n := range inPMS {
		if n < 3 {
			continue
		}
		rate := float64(n) / float64(total[k])
		if rate < 0.5 {
			continue
		}
		cands = append(cands, cand{key: k, n: n, rate: rate})
	}
	sort.Slice(cands, func(i, j int) bool {
		if cands[i].n != cands[j].n {
			return cands[i].n > cands[j].n
		}
		return cands[i].key < cands[j].key
	})
	if len(cands) > 3 {
		cands = cands[:3]
	}

	out := make([]dto.PeriodSymptomItem, 0, len(cands))
	for _, c := range cands {
		out = append(out, dto.PeriodSymptomItem{
			Key:   c.key,
			Label: PeriodSymptomLabel(c.key),
			Rate:  Round2(c.rate),
		})
	}
	return out
}

// ============================================================================
// 步骤 6 —— 体温法确认排卵（03 §8）
// ============================================================================

// bbtPoint 一个体温采样点
type bbtPoint struct {
	d time.Time
	v float64
}

// DetectOvulationByBBT 用基础体温确认排卵日
//
// 判定：bbt[i] ≥ mean(bbt[i-6..i-1]) + 0.2 ℃ 且连续成立 ≥ 3 天
//
//	→ 该连续区间的第一天 − 1 天 = 排卵日
//
// 参数 bbtByDate：**来自 health_days 的体温**（date 字符串 → ℃），优先于 days 里的 BBT 列。
//
// ⚠️ 2026-09-19 迁移（md/spec-20260919-v1/04 §6）：体温已从 period_days 迁到 health_days，
//
//	必须传这个 map。不传（nil）时回落到 days[i].BBT，只为兼容过渡期的双写数据 ——
//	**正式链路不允许传 nil**，否则体温法永远判定「无数据」：
//	不报错、不 panic、接口照常 200，但排卵日永远停留在算法推算值，
//	ovulation_source 永远是 1、黄体期永远用默认 14 天无法校准。
//	这类「静默失效」比报错难查一百倍。
//
// 返回 nil 表示窗口内数据不足或未检测到升温。
// ⚠️ 体温法只能**事后确认**，不能事前预测（UI 文案必须写清这一点）。
// 异常点（与前 6 天均值偏差 > 0.5 ℃，如发烧 / 饮酒 / 熬夜）自动忽略。
// 仅对「日历连续测量」的片段做判定 —— 跳天测量会打断连续性，宁可不出结论。
func DetectOvulationByBBT(start, end time.Time, days []PeriodDayInput, bbtByDate map[string]float64) *time.Time {
	pts := collectBBT(start, end, days, bbtByDate)
	if len(pts) < 9 {
		return nil
	}
	run := 0
	for i := 6; i < len(pts); i++ {
		mean6, ok := bbtMean6Before(pts, i)
		if !ok {
			run = 0
			continue
		}
		if pts[i].v >= mean6+0.2 {
			run++
		} else {
			run = 0
		}
		if run >= 3 {
			first := pts[i-run+1].d
			ov := first.AddDate(0, 0, -1)
			if ov.Before(TruncateDate(start)) {
				return nil // 排卵日落在周期起点之前 → 不可靠，放弃
			}
			return &ov
		}
	}
	return nil
}

// collectBBT 收集窗口内的体温点（升序，已剔除异常跳变点）
//
// ⚠️ 体温来源：health_days（bbtByDate）**优先**于 period_days（days[i].BBT）。
//
//	并且要合并两边的**日期集合** —— 用户可能只量体温、不记经期，
//	那种日期在 days 里根本没有行，只在 health_days 里。
//	只遍历 days 会漏掉这些点，「明明每天量体温却判定无数据」。
func collectBBT(start, end time.Time, days []PeriodDayInput, bbtByDate map[string]float64) []bbtPoint {
	start, end = TruncateDate(start), TruncateDate(end)

	// 1. 合并日期集合：period_days 的体温 → health_days 的体温（后者覆盖前者）
	merged := make(map[string]float64, len(days)+len(bbtByDate))
	for _, d := range days {
		if d.BBT != nil {
			merged[TruncateDate(d.Date).Format("2006-01-02")] = *d.BBT
		}
	}
	for dateStr, v := range bbtByDate {
		merged[dateStr] = v
	}

	// 2. 按窗口过滤并排序
	raw := []bbtPoint{}
	for dateStr, v := range merged {
		dd, err := time.ParseInLocation("2006-01-02", dateStr, time.Local)
		if err != nil {
			continue
		}
		if dd.Before(start) || dd.After(end) {
			continue
		}
		raw = append(raw, bbtPoint{d: dd, v: v})
	}
	sort.Slice(raw, func(i, j int) bool { return raw[i].d.Before(raw[j].d) })

	out := make([]bbtPoint, 0, len(raw))
	for i, p := range raw {
		if i >= 6 {
			if m, ok := bbtMean6Before(raw, i); ok && math.Abs(p.v-m) > 0.5 {
				continue // 单日异常跳变，忽略该点
			}
		}
		out = append(out, p)
	}
	return out
}

// bbtMean6Before 返回 pts[i-6..i-1] 的均值；这 6 个点必须与 pts[i] 日历连续，否则 ok = false
func bbtMean6Before(pts []bbtPoint, i int) (float64, bool) {
	if i < 6 || i >= len(pts) {
		return 0, false
	}
	for j := i - 5; j <= i; j++ {
		if DaysBetween(pts[j-1].d, pts[j].d) != 1 {
			return 0, false
		}
	}
	var sum float64
	for j := i - 6; j < i; j++ {
		sum += pts[j].v
	}
	return sum / 6, true
}

// ============================================================================
// RebuildCycles 的纯函数部分（02 §2 派生规则）
// ============================================================================

// BleedingGroup 一次经期（RebuildCycles 的分组结果）
type BleedingGroup struct {
	StartDate    time.Time
	EndDate      time.Time
	PeriodLength int // 组内实际出血日数（不含夹缝里的空白天）
}

// GroupBleedingDays 把逐日记录按派生规则分组为「一次经期」
//
//  1. 出血日 = flow ∈ {2,3,4}；点滴日（flow=1）不参与周期划分；
//  2. 连续出血日归为同一组；允许组内夹 1 天无出血（间隔 1 天仍视为同一次经期）；
//     无出血间隔 ≥ 2 天 → 断为新的一次经期。
func GroupBleedingDays(days []PeriodDayInput) []BleedingGroup {
	sorted := make([]PeriodDayInput, len(days))
	copy(sorted, days)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i].Date.Before(sorted[j].Date) })
	for i := range sorted {
		sorted[i].Date = TruncateDate(sorted[i].Date)
	}

	out := []BleedingGroup{}
	var cur *BleedingGroup
	var lastBleed time.Time

	for _, d := range sorted {
		if !IsBleedingFlow(d.Flow) {
			continue
		}
		if cur == nil {
			cur = &BleedingGroup{StartDate: d.Date, EndDate: d.Date, PeriodLength: 1}
			lastBleed = d.Date
			continue
		}
		if DaysBetween(lastBleed, d.Date) <= periodMergeGapDays+1 {
			// 与上一次出血日相邻或仅夹 1 天 → 同一次经期
			cur.EndDate = d.Date
			cur.PeriodLength++
			lastBleed = d.Date
			continue
		}
		out = append(out, *cur)
		cur = &BleedingGroup{StartDate: d.Date, EndDate: d.Date, PeriodLength: 1}
		lastBleed = d.Date
	}
	if cur != nil {
		out = append(out, *cur)
	}
	return out
}

// IsBleedingFlow 是否算「出血日」（决定周期划分，点滴出血 flow=1 不算）
func IsBleedingFlow(flow int) bool {
	switch flow {
	case model.FlowLight, model.FlowMedium, model.FlowHeavy:
		return true
	default:
		return false
	}
}

// ============================================================================
// 通用小工具
// ============================================================================

// TruncateDate 归零到当天 00:00（保留原时区）
func TruncateDate(t time.Time) time.Time {
	return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, t.Location())
}

// DateStr 格式化为 YYYY-MM-DD
func DateStr(t time.Time) string { return t.Format(PeriodDateLayout) }

// ParseDate 解析 YYYY-MM-DD 为用户本地日期
func ParseDate(s string) (time.Time, error) {
	return time.ParseInLocation(PeriodDateLayout, s, time.Local)
}

// DaysBetween 返回 b − a 的天数（先归零，四舍五入以容忍夏令时偏移）
func DaysBetween(a, b time.Time) int {
	d := TruncateDate(b).Sub(TruncateDate(a))
	return int(math.Round(d.Hours() / 24))
}

// Round2 保留两位小数
func Round2(v float64) float64 { return math.Round(v*100) / 100 }

func clampInt(v, lo, hi int) int {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func absInt(v int) int {
	if v < 0 {
		return -v
	}
	return v
}

// recentCycleLengths 最近 n 个非空 cycle_length（cycles 已按 start_date 升序）
func recentCycleLengths(cycles []PeriodCycleInput, n int) []int {
	out := []int{}
	for _, c := range cycles {
		if c.CycleLength != nil {
			out = append(out, *c.CycleLength)
		}
	}
	if len(out) > n {
		out = out[len(out)-n:]
	}
	return out
}

// recentPeriodLengths 最近 n 个 period_length > 0 的周期
func recentPeriodLengths(cycles []PeriodCycleInput, n int) []int {
	out := []int{}
	for _, c := range cycles {
		if c.PeriodLength > 0 {
			out = append(out, c.PeriodLength)
		}
	}
	if len(out) > n {
		out = out[len(out)-n:]
	}
	return out
}

// currentCycleOf 取「包含 today 的那个周期」；today 早于全部记录时退回最早一个
func currentCycleOf(cycles []PeriodCycleInput, today time.Time) PeriodCycleInput {
	cur := cycles[0]
	for i := range cycles {
		if !TruncateDate(cycles[i].StartDate).After(today) {
			cur = cycles[i]
		}
	}
	return cur
}

func medianInt(xs []int) int {
	if len(xs) == 0 {
		return 0
	}
	s := make([]int, len(xs))
	copy(s, xs)
	sort.Ints(s)
	n := len(s)
	if n%2 == 1 {
		return s[n/2]
	}
	return int(math.Round(float64(s[n/2-1]+s[n/2]) / 2))
}

func medianFloat(xs []float64) float64 {
	if len(xs) == 0 {
		return 0
	}
	s := make([]float64, len(xs))
	copy(s, xs)
	sort.Float64s(s)
	n := len(s)
	if n%2 == 1 {
		return s[n/2]
	}
	return (s[n/2-1] + s[n/2]) / 2
}

func absDeviations(xs []int, center int) []float64 {
	out := make([]float64, 0, len(xs))
	for _, x := range xs {
		out = append(out, math.Abs(float64(x-center)))
	}
	return out
}

// ── 以下导出给「周期报告」复用（报告页与预测必须用同一套统计口径） ──

// MedianInt 中位数（偶数个取中间两个的均值四舍五入）
func MedianInt(xs []int) int { return medianInt(xs) }

// RobustSigma 稳健标准差 = 1.4826 × MAD
func RobustSigma(xs []int) float64 {
	if len(xs) == 0 {
		return 0
	}
	return 1.4826 * medianFloat(absDeviations(xs, medianInt(xs)))
}

// MeanInt 算术平均
func MeanInt(xs []int) float64 {
	if len(xs) == 0 {
		return 0
	}
	sum := 0
	for _, x := range xs {
		sum += x
	}
	return Round2(float64(sum) / float64(len(xs)))
}

// MinInt 最小值（空切片返回 0）
func MinInt(xs []int) int {
	if len(xs) == 0 {
		return 0
	}
	m := xs[0]
	for _, x := range xs {
		if x < m {
			m = x
		}
	}
	return m
}

// MaxInt 最大值（空切片返回 0）
func MaxInt(xs []int) int {
	if len(xs) == 0 {
		return 0
	}
	m := xs[0]
	for _, x := range xs {
		if x > m {
			m = x
		}
	}
	return m
}

// RegularityOf σ → 规律度（与 03 §4 的置信度阈值同一套）
func RegularityOf(sigma float64) string {
	switch {
	case sigma <= 1.5:
		return PeriodConfHigh
	case sigma <= 3.5:
		return PeriodConfMedium
	default:
		return PeriodConfLow
	}
}
