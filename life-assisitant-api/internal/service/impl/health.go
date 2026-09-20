// Package impl 健康服务实现（md/spec-20260919-v1/07 §1）
//
// ⚠️ 本模块最容易出错的地方不是算法，而是**一次提交要写三张表**：
//
//	health_days  饮水 / 体重 / 体温 / 睡眠 / 排便
//	period_days  经量 / 症状 / 疼痛 / 分泌物 / 性生活
//	mood_logs    心情 / 精力 / 备注（按小时）
//
// 必须在同一事务里（UpsertDay 是唯一入口）。分开写的代码在测试里永远是对的 ——
// 因为测试不会中途断网；但线上会出现「体重记上了、经期没记上」，
// 用户不会报错，只会某天发现数据对不上，然后不再信任这个 App。
package impl

import (
	"context"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"

	"github.com/gogf/gf/v2/errors/gerror"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"github.com/life-assistant/api/internal/consts/ecode"
	"github.com/life-assistant/api/internal/dao"
	"github.com/life-assistant/api/internal/model"
	"github.com/life-assistant/api/internal/model/dto"
	"github.com/life-assistant/api/internal/service"
	"github.com/life-assistant/api/internal/utility"
)

// 近期症状的回看窗口（天）与区间查询的跨度上限
const (
	healthRecentSymptomDays = 90
	healthMaxRangeDays      = 366
	healthRecentSymptomTopN = 6
	healthWeightDeltaDays   = 7 // 「较上周」的比较基准
)

// NewHealthService 构造函数
func NewHealthService() service.IHealthService { return &HealthService{} }

func init() { service.SetHealth(NewHealthService()) }

// HealthService 健康服务
type HealthService struct{}

// ============================================================================
// 1. GET /health/overview
// ============================================================================

// Overview 概览卡 + 月历摘要条所需的一切，一次拉齐。
func (s *HealthService) Overview(ctx context.Context, req *dto.HealthOverviewReq) (*dto.HealthOverviewResp, error) {
	uid := ctxUserID(ctx)
	if uid == "" {
		return nil, gerror.NewCode(ecode.AuthTokenMissing)
	}
	dateStr := ""
	if req != nil {
		dateStr = req.Date
	}
	today, err := resolvePeriodDate(dateStr, true)
	if err != nil {
		return nil, err
	}
	today = utility.TruncateDate(today)

	st, err := ensureHealthSettings(ctx, uid)
	if err != nil {
		return nil, err
	}
	enabled := utility.MetricsOrDefault(st.MetricsEnabled)
	enabledSet := make(map[string]bool, len(enabled))
	for _, k := range enabled {
		enabledSet[k] = true
	}

	day, err := loadHealthDayDetail(ctx, uid, today)
	if err != nil {
		return nil, err
	}

	// 经期预测：未启用经期时**不返回**（07 §1.1）
	var pred *dto.PeriodPrediction
	if enabledSet["period"] {
		pred, _, err = computePeriodPrediction(ctx, uid, today)
		if err != nil {
			return nil, err
		}
	}

	recorded, total := healthProgress(enabled, day)

	monthFirst := time.Date(today.Year(), today.Month(), 1, 0, 0, 0, 0, today.Location())
	monthLast := monthFirst.AddDate(0, 1, -1)
	summary, err := buildMonthSummary(ctx, uid, monthFirst, monthLast, st.WaterGoalML, enabledSet)
	if err != nil {
		return nil, err
	}

	cards, err := buildHealthCards(ctx, uid, today, day, enabledSet, st, pred)
	if err != nil {
		return nil, err
	}

	return &dto.HealthOverviewResp{
		Initialized:   st.IsInitialized(),
		Today:         utility.DateStr(today),
		Settings:      healthSettingsResp(st),
		TodayLog:      day,
		TodayProgress: &dto.HealthTodayProgress{Recorded: recorded, Enabled: total},
		Cards:         cards,
		MonthSummary:  summary,
		Prediction:    pred,
	}, nil
}

// ============================================================================
// 2. GET /health/calendar
// ============================================================================

// Calendar 月历标记。⚠️ 只返回有标记的日期（空白日不返回，否则响应体积翻 3 倍）。
func (s *HealthService) Calendar(ctx context.Context, req *dto.HealthCalendarReq) (*dto.HealthCalendarResp, error) {
	uid := ctxUserID(ctx)
	if uid == "" {
		return nil, gerror.NewCode(ecode.AuthTokenMissing)
	}
	month := strings.TrimSpace(req.Month)
	first, err := time.ParseInLocation("2006-01", month, time.Local)
	if err != nil {
		return nil, gerror.NewCode(ecode.ValidationFailed)
	}
	last := first.AddDate(0, 1, -1)

	st, err := ensureHealthSettings(ctx, uid)
	if err != nil {
		return nil, err
	}
	periodOn := false
	for _, k := range utility.MetricsOrDefault(st.MetricsEnabled) {
		if k == "period" {
			periodOn = true
		}
	}

	marks := map[string]map[string]bool{}
	add := func(date, mark string) {
		m, ok := marks[date]
		if !ok {
			m = map[string]bool{}
			marks[date] = m
		}
		m[mark] = true
	}

	// ── 分类小点（260919 新增，老大要求）─────────────────────────────────
	//
	// 原来的 `logged` 灰点只能表达「这天记了点什么」，看不出**记了哪一类**。
	// 改成按指标分类上色，前端在日期下方画一排可重叠的小点：
	//   黄=mood 紫=energy/sleep 蓝=bbt 青=water 棕=bowel 灰=weight 红=period
	//
	// ⚠️ 两个数据源，别搞混：
	//   身体指标 → health_events（一天多次、**不延续**）
	//   心情精力 → mood_logs（按小时、**向前延续**）
	hasAny := map[string]bool{}

	// 1) 身体指标：health_events
	metricKeys, err := dao.HealthEvent.MetricKeysInRange(ctx, uid, first, last)
	if err != nil {
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "查询健康事件失败")
	}
	for ds, keys := range metricKeys {
		for _, k := range keys {
			switch k {
			case model.MetricKeyBBT:
				add(ds, dto.MarkMetricBBT)
			case model.MetricKeyWater:
				add(ds, dto.MarkMetricWater)
			case model.MetricKeyBowel:
				add(ds, dto.MarkMetricBowel)
			case model.MetricKeyWeight:
				add(ds, dto.MarkMetricWeight)
			case model.MetricKeySleep:
				// 睡眠归到「精力·睡眠」紫点，与 mood_logs 的 energy 共用一个点
				add(ds, dto.MarkMetricEnergy)
			}
		}
		hasAny[ds] = true
	}

	// 2) 心情 / 精力：mood_logs（只认**自己有值**的行，不把延续值算成记录）
	moods, err := dao.MoodLog.ListByRange(ctx, uid, first, last)
	if err != nil {
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "查询心情记录失败")
	}
	for i := range moods {
		m := moods[i]
		// ⚠️ Energy / Note 是指针（区分「没记」与「记为 0 / 空串」），不能裸比较
		hasMood := m.Mood > 0
		hasEnergy := m.Energy != nil && *m.Energy > 0
		hasNote := m.Note != nil && strings.TrimSpace(*m.Note) != ""
		if !hasMood && !hasEnergy && !hasNote {
			continue
		}
		ds := utility.DateStr(m.Date)
		if hasMood {
			add(ds, dto.MarkMetricMood)
		}
		if hasEnergy {
			add(ds, dto.MarkMetricEnergy)
		}
		hasAny[ds] = true
	}

	// 3) health_days 兜底：过渡期可能存在「日汇总有值、events 还没迁」的老行
	hdays, err := dao.HealthDay.ListByRange(ctx, uid, first, last)
	if err != nil {
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "查询健康记录失败")
	}
	for i := range hdays {
		if hdays[i].HasAnyValue() {
			hasAny[utility.DateStr(hdays[i].Date)] = true
		}
	}

	// 经期标记：未启用经期时一概不返回 period / period_predicted / spotting /
	// fertile / peak / ovulation（07 §1.2 的红线）
	if periodOn {
		pdays, err := dao.PeriodDay.ListByRange(ctx, uid, first, last)
		if err != nil {
			return nil, gerror.WrapCode(ecode.DatabaseError, err, "查询经期记录失败")
		}
		for i := range pdays {
			d := pdays[i]
			ds := utility.DateStr(d.Date)
			switch {
			case utility.IsBleedingFlow(d.Flow):
				add(ds, dto.MarkPeriod)
				switch d.Flow {
				case model.FlowLight:
					add(ds, dto.MarkFlowLight)
				case model.FlowMedium:
					add(ds, dto.MarkFlowMedium)
				case model.FlowHeavy:
					add(ds, dto.MarkFlowHeavy)
				}
			case d.Flow == model.FlowSpotting:
				add(ds, dto.MarkSpotting)
			}
		}

		today := utility.TruncateDate(time.Now())
		pred, _, err := computePeriodPrediction(ctx, uid, today)
		if err != nil {
			return nil, err
		}
		addPredictionMarks(marks, add, pred)

		if !today.Before(first) && !today.After(last) {
			add(utility.DateStr(today), dto.MarkToday)
		}
	} else {
		today := utility.TruncateDate(time.Now())
		if !today.Before(first) && !today.After(last) {
			add(utility.DateStr(today), dto.MarkToday)
		}
	}

	// 4) logged 父集兜底：有任一记录就给灰点。
	//    前端在「分类点都取不到颜色」时用它画一个中性灰点，避免格子看起来是空的。
	for ds := range hasAny {
		add(ds, dto.MarkLogged)
	}

	out := make([]dto.HealthCalendarDay, 0, len(marks))
	for d := first; !d.After(last); d = d.AddDate(0, 0, 1) {
		ds := utility.DateStr(d)
		set, ok := marks[ds]
		if !ok {
			continue
		}
		list := make([]string, 0, len(set))
		for _, m := range markPriority {
			if set[m] {
				list = append(list, m)
			}
		}
		out = append(out, dto.HealthCalendarDay{Date: ds, Marks: list})
	}
	return &dto.HealthCalendarResp{Month: month, Days: out}, nil
}

// addPredictionMarks 把预测区间摊成逐日标记
//
// ⚠️ 安全期（SafeWindows）**不上月历**（见 md/spec-260919/04 §3.3），这里刻意不处理。
func addPredictionMarks(marks map[string]map[string]bool, add func(string, string), pred *dto.PeriodPrediction) {
	if pred == nil {
		return
	}
	span := func(from, to string, mark string) {
		f, e1 := utility.ParseDate(from)
		t, e2 := utility.ParseDate(to)
		if e1 != nil || e2 != nil {
			return
		}
		for d := f; !d.After(t); d = d.AddDate(0, 0, 1) {
			add(utility.DateStr(d), mark)
		}
	}
	if npp := pred.NextPeriod; npp != nil && npp.EndEst != "" {
		span(npp.Date, npp.EndEst, dto.MarkPeriodPredicted)
	}
	if fw := pred.FertileWindow; fw != nil {
		span(fw.Start, fw.End, dto.MarkFertile)
		if len(fw.Peak) == 2 {
			span(fw.Peak[0], fw.Peak[1], dto.MarkPeak)
		}
	}
	if ov := pred.Ovulation; ov != nil && ov.Date != "" {
		add(ov.Date, dto.MarkOvulation)
	}
}

// ============================================================================
// 3. GET /health/days
// ============================================================================

// ListDays 区间记录（补记 / 报告页 / 导出）。跨度上限 366 天。
func (s *HealthService) ListDays(ctx context.Context, req *dto.ListHealthDaysReq) (*dto.ListHealthDaysResp, error) {
	uid := ctxUserID(ctx)
	if uid == "" {
		return nil, gerror.NewCode(ecode.AuthTokenMissing)
	}
	start, err := resolvePeriodDate(req.Start, false)
	if err != nil {
		return nil, err
	}
	end, err := resolvePeriodDate(req.End, false)
	if err != nil {
		return nil, err
	}
	start, end = utility.TruncateDate(start), utility.TruncateDate(end)
	if end.Before(start) {
		return nil, gerror.NewCode(ecode.ValidationFailed)
	}
	if int(end.Sub(start).Hours()/24)+1 > healthMaxRangeDays {
		return nil, gerror.NewCode(ecode.ValidationFailed)
	}

	items, err := loadHealthDayRange(ctx, uid, start, end)
	if err != nil {
		return nil, err
	}
	return &dto.ListHealthDaysResp{Items: items, Total: len(items)}, nil
}

// ============================================================================
// 4. GET /health/days/:date
// ============================================================================

// GetDay 单日详情。⚠️ 无记录时 Day = null 且接口返回 200（浮层要打开一张空表），不是 404。
func (s *HealthService) GetDay(ctx context.Context, date string) (*dto.HealthDayDetailResp, error) {
	uid := ctxUserID(ctx)
	if uid == "" {
		return nil, gerror.NewCode(ecode.AuthTokenMissing)
	}
	d, err := resolvePeriodDate(date, false)
	if err != nil {
		return nil, err
	}
	d = utility.TruncateDate(d)

	day, err := loadHealthDayDetail(ctx, uid, d)
	if err != nil {
		return nil, err
	}

	recent, err := healthRecentSymptoms(ctx, uid)
	if err != nil {
		return nil, err
	}
	last, err := healthLastValues(ctx, uid)
	if err != nil {
		return nil, err
	}

	return &dto.HealthDayDetailResp{
		Day:              day,
		RecentSymptoms:   recent,
		HealthLastValues: last,
	}, nil
}

// ============================================================================
// 5. PUT /health/days/:date —— 核心写接口
// ============================================================================

// UpsertDay 整体覆盖：请求体里没给的字段一律置为「未记录」。
//
// 唯一的例外是 period / moods 两个子块：**子块整体缺省 = 不触碰既有行**。
// 记体重时不该把当天已经填过的经期事实抹掉。
func (s *HealthService) UpsertDay(ctx context.Context, req *dto.UpsertHealthDayReq) (*dto.UpsertHealthDayResp, error) {
	uid := ctxUserID(ctx)
	if uid == "" {
		return nil, gerror.NewCode(ecode.AuthTokenMissing)
	}
	date, err := resolvePeriodDate(req.Date, false)
	if err != nil {
		return nil, err
	}
	date = utility.TruncateDate(date)
	today := utility.TruncateDate(time.Now())
	if err := validateRecordableDate(date, today); err != nil {
		return nil, err
	}
	if err := validateHealthValues(req); err != nil {
		return nil, err
	}
	ds := utility.DateStr(date)

	// 心情块落到哪个小时：记今天 = 当前小时；补记历史 = 日记槽位 12
	// （「某天没有此刻」，落到一天一条的那个槽位）
	moodHour := model.MoodDiaryHour
	if ds == utility.DateStr(today) {
		moodHour = moodNowHour()
	}

	// 症状过词库过滤（未知 key 静默丢弃 + warn）
	var symptoms []string
	periodGiven := req.Period != nil
	periodEmpty := true
	if periodGiven {
		symptoms = filterPeriodSymptoms(ctx, req.Period.Symptoms)
		periodEmpty = req.Period.Flow == 0 && len(symptoms) == 0 &&
			req.Period.PainLevel == 0 && req.Period.Discharge == 0 && req.Period.Intercourse == 0
	}

	moodGiven := req.Moods != nil
	newMood, newEnergy, newNote := 0, 0, ""
	if moodGiven {
		newMood = req.Moods.Mood
		newEnergy = req.Moods.Energy
		newNote = strings.TrimSpace(req.Moods.Note)
		// ⚠️ 复用心情模块的备注长度上限（mood.go 的 moodNoteMaxRunes = 50），
		//    不另立一个常量 —— 两处不一致会出现「心情页能存、健康浮层被截断」。
		if len([]rune(newNote)) > moodNoteMaxRunes {
			newNote = string([]rune(newNote)[:moodNoteMaxRunes])
		}
	}
	moodEmpty := newMood == 0 && newEnergy == 0 && newNote == ""

	// ⚠️ 2026-09-19 起身体指标（water / bbt / weight / sleep / bowel）**不再由本接口写**。
	// 它们改走 POST/PATCH/DELETE /health/events（多次、时间轴、不延续），
	// health_days 的日汇总由 recomputeDaySummary 在同一事务内重算维护。
	// 本接口只负责 period_days（经期事实）与 mood_logs（心情/精力/备注）。
	changed := false
	err = dao.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// 1) period_days
		switch {
		case periodGiven && periodEmpty:
			if err := tx.Where("user_id = ? AND date = ?", uid, ds).Delete(&model.PeriodDay{}).Error; err != nil {
				return err
			}
		case periodGiven:
			row := &model.PeriodDay{
				ID: utility.NewID("pd"), UserID: uid, Date: date,
				Flow: req.Period.Flow, Symptoms: model.StringArray(symptoms),
				PainLevel: req.Period.PainLevel, Discharge: req.Period.Discharge,
				Intercourse: req.Period.Intercourse,
				// ⚠️ bbt / weight / sleep_hours 三列**不再在这里写**：
				// 它们的真源是 health_events，日汇总由 recomputeDaySummary 维护到 health_days。
				// period_days 的旧列留着只为第二步发布（DROP）前的回滚，不再双写。
			}
			if err := tx.Clauses(clause.OnConflict{
				Columns: []clause.Column{{Name: "user_id"}, {Name: "date"}},
				DoUpdates: clause.AssignmentColumns([]string{
					"flow", "symptoms", "pain_level", "discharge", "intercourse", "updated_at",
				}),
			}).Create(row).Error; err != nil {
				return err
			}
		}

		// 2) mood_logs：只动目标小时那一格，绝不按 (user_id, date) 整体删
		if moodGiven {
			if moodEmpty {
				if err := tx.Where("user_id = ? AND date = ? AND hour = ?", uid, ds, moodHour).
					Delete(&model.MoodLog{}).Error; err != nil {
					return err
				}
			} else {
				moodVal := newMood
				if moodVal == 0 {
					// 只给了 energy / note：保留既有心情值；本来没这行就取中性档 3
					// （mood_logs.mood 是 NOT NULL，不能为了「不发明数据」把用户写的备注丢掉）
					var exist model.MoodLog
					e := tx.Where("user_id = ? AND date = ? AND hour = ?", uid, ds, moodHour).
						First(&exist).Error
					switch {
					case e == nil:
						moodVal = exist.Mood
					case isNotFound(e):
						moodVal = 3
					default:
						return e
					}
				}
				row := &model.MoodLog{
					ID: utility.NewID("ml"), UserID: uid, Date: date,
					Hour: moodHour, Mood: moodVal,
				}
				if newEnergy > 0 {
					e := newEnergy
					row.Energy = &e
				}
				if newNote != "" {
					n := newNote
					row.Note = &n
				}
				if err := tx.Clauses(clause.OnConflict{
					Columns:   []clause.Column{{Name: "user_id"}, {Name: "date"}, {Name: "hour"}},
					DoUpdates: clause.AssignmentColumns([]string{"mood", "energy", "note", "updated_at"}),
				}).Create(row).Error; err != nil {
					return err
				}
			}
		}

		// 3) 经期块影响划分 → 幂等重算周期（同一事务内）
		c, err := rebuildPeriodCyclesTx(ctx, tx, uid)
		if err != nil {
			return err
		}
		changed = c
		return nil
	})
	if err != nil {
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "保存健康记录失败")
	}

	day, err := loadHealthDayDetail(ctx, uid, date)
	if err != nil {
		return nil, err
	}
	var pred *dto.PeriodPrediction
	st, e2 := ensureHealthSettings(ctx, uid)
	if e2 == nil {
		for _, k := range utility.MetricsOrDefault(st.MetricsEnabled) {
			if k == "period" {
				pred, _, err = computePeriodPrediction(ctx, uid, today)
				if err != nil {
					return nil, err
				}
			}
		}
	}
	return &dto.UpsertHealthDayResp{Day: day, CyclesChanged: changed, Prediction: pred}, nil
}

// ============================================================================
// 6. DELETE /health/days/:date
// ============================================================================

// DeleteDay 删除某日健康记录。
//
// ⚠️ mood_logs 只删本模块写过的那一格（今天的当前小时 / 历史的日记槽位），
// **不按 (user_id, date) 整体删** —— 那会把用户在心情页按小时记的记录一起抹掉。
func (s *HealthService) DeleteDay(ctx context.Context, date string) error {
	uid := ctxUserID(ctx)
	if uid == "" {
		return gerror.NewCode(ecode.AuthTokenMissing)
	}
	d, err := resolvePeriodDate(date, false)
	if err != nil {
		return err
	}
	d = utility.TruncateDate(d)
	ds := utility.DateStr(d)
	todayStr := utility.DateStr(time.Now())
	hours := []int{model.MoodDiaryHour}
	if ds == todayStr {
		hours = append(hours, moodNowHour())
	}

	err = dao.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("user_id = ? AND date = ?", uid, ds).Delete(&model.HealthDay{}).Error; err != nil {
			return err
		}
		if err := tx.Where("user_id = ? AND date = ?", uid, ds).Delete(&model.PeriodDay{}).Error; err != nil {
			return err
		}
		// ⚠️ 必须连带删 events：身体指标的真源已经迁到 health_events，
		//    只删 health_days 会留下孤儿事件 —— 「清除这一天」之后日历上
		//    的分类点还在，但点进去什么都没有。
		if err := tx.Where("user_id = ? AND date = ?", uid, ds).Delete(&model.HealthEvent{}).Error; err != nil {
			return err
		}
		if err := tx.Where("user_id = ? AND date = ? AND hour IN ?", uid, ds, hours).
			Delete(&model.MoodLog{}).Error; err != nil {
			return err
		}
		_, err := rebuildPeriodCyclesTx(ctx, tx, uid)
		return err
	})
	if err != nil {
		return gerror.WrapCode(ecode.DatabaseError, err, "删除健康记录失败")
	}
	return nil
}

// ============================================================================
// 7. GET / PATCH /health/settings
// ============================================================================

// GetSettings 懒创建：不存在就按全默认值建一行 → **永不 404**。
func (s *HealthService) GetSettings(ctx context.Context) (*dto.HealthSettingsResp, error) {
	uid := ctxUserID(ctx)
	if uid == "" {
		return nil, gerror.NewCode(ecode.AuthTokenMissing)
	}
	st, err := ensureHealthSettings(ctx, uid)
	if err != nil {
		return nil, err
	}
	return healthSettingsResp(st), nil
}

// PatchSettings 只传要改的字段。
//
// ⚠️ metrics_enabled 的 nil 与 [] 是两回事：nil = 不动，[] = 用户主动全关（合法）。
func (s *HealthService) PatchSettings(ctx context.Context, req *dto.PatchHealthSettingsReq) (*dto.HealthSettingsResp, error) {
	uid := ctxUserID(ctx)
	if uid == "" {
		return nil, gerror.NewCode(ecode.AuthTokenMissing)
	}
	st, err := ensureHealthSettings(ctx, uid)
	if err != nil {
		return nil, err
	}
	if req.MetricsEnabled != nil {
		st.MetricsEnabled = model.StringArray(utility.NormalizeMetrics(req.MetricsEnabled))
	}
	if req.WaterGoalML != nil {
		if *req.WaterGoalML < model.WaterGoalMLMin || *req.WaterGoalML > model.WaterGoalMLMax {
			return nil, gerror.NewCode(ecode.ValidationFailed)
		}
		st.WaterGoalML = *req.WaterGoalML
	}
	// 「一杯」容量：nil = 不动；0 / 越界 → 归一到 [50,1000] 的 50 倍数（不报错）
	if req.WaterStepML != nil {
		st.WaterStepML = model.NormalizeWaterStep(*req.WaterStepML)
	}
	if req.WeightGoalKG != nil {
		v := *req.WeightGoalKG
		if v < model.WeightMin || v > model.WeightMax {
			return nil, gerror.NewCode(ecode.ValidationFailed)
		}
		st.WeightGoalKG = &v
	}
	if err := dao.HealthSetting.Upsert(ctx, st); err != nil {
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "保存健康设置失败")
	}
	return healthSettingsResp(st), nil
}

// ============================================================================
// 8. POST /health/setup
// ============================================================================

// Setup 首次引导一次性提交。
//
// ⚠️ 前端「跳过」时**不要调这个接口**（不写 setup_done_at），否则会
// 「跳过 → 立刻被推回引导」死循环。跳过的标记只存在前端内存里。
func (s *HealthService) Setup(ctx context.Context, req *dto.HealthSetupReq) (*dto.HealthSetupResp, error) {
	uid := ctxUserID(ctx)
	if uid == "" {
		return nil, gerror.NewCode(ecode.AuthTokenMissing)
	}

	st, err := ensureHealthSettings(ctx, uid)
	if err != nil {
		return nil, err
	}
	st.MetricsEnabled = model.StringArray(utility.NormalizeMetrics(req.MetricsEnabled))
	if req.WaterGoalML > 0 {
		if req.WaterGoalML < model.WaterGoalMLMin || req.WaterGoalML > model.WaterGoalMLMax {
			return nil, gerror.NewCode(ecode.ValidationFailed)
		}
		st.WaterGoalML = req.WaterGoalML
	}
	st.WaterStepML = model.NormalizeWaterStep(req.WaterStepML)
	now := time.Now()
	st.SetupDoneAt = &now

	periodOn := false
	for _, k := range st.MetricsEnabled {
		if string(k) == "period" {
			periodOn = true
		}
	}

	var pred *dto.PeriodPrediction
	createdDays := 0
	if periodOn && req.PeriodInit != nil {
		// 复用经期模块已实现的引导（upsert period_settings + 批量生成 period_days + RebuildCycles），
		// 不在这里重抄一遍 —— 两份实现迟早会对不上。
		out, err := service.Period().Setup(ctx, &dto.PeriodSetupReq{
			LastPeriodStart: req.PeriodInit.LastPeriodStart,
			AvgPeriodLength: req.PeriodInit.AvgPeriodLength,
			AvgCycleLength:  req.PeriodInit.AvgCycleLength,
			Goal:            req.PeriodInit.Goal,
		})
		if err != nil {
			return nil, err
		}
		if out != nil {
			pred = out.Prediction
			createdDays = out.CreatedDays
		}
	}

	if err := dao.HealthSetting.Upsert(ctx, st); err != nil {
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "保存健康引导失败")
	}
	return &dto.HealthSetupResp{
		Settings:    healthSettingsResp(st),
		Prediction:  pred,
		CreatedDays: createdDays,
	}, nil
}

// ============================================================================
// 装配 / 校验工具
// ============================================================================

// healthDayUpdatableColumns 冲突时需要覆盖的列（不含 id / user_id / date / created_at）
var healthDayUpdatableColumns = []string{
	"water_ml", "weight_kg", "bbt", "sleep_hours", "bowel_count", "bowel_type", "updated_at",
}

// ensureHealthSettings 取设置行，不存在则懒创建（全默认值）
func ensureHealthSettings(ctx context.Context, uid string) (*model.HealthSetting, error) {
	st, err := dao.HealthSetting.GetByUserID(ctx, uid)
	if err != nil {
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "查询健康设置失败")
	}
	if st != nil {
		return st, nil
	}
	row := &model.HealthSetting{
		ID:             utility.NewID("hs"),
		UserID:         uid,
		MetricsEnabled: model.StringArray(utility.DefaultEnabledMetrics()),
		WaterGoalML:    model.DefaultWaterGoalML,
		WaterStepML:    model.WaterStepMLDefault,
	}
	if err := dao.HealthSetting.Upsert(ctx, row); err != nil {
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "创建健康设置失败")
	}
	return row, nil
}

// healthSettingsResp model → 响应（metrics 走规范化，保证顺序稳定 + 依赖裁剪）
func healthSettingsResp(st *model.HealthSetting) *dto.HealthSettingsResp {
	out := &dto.HealthSettingsResp{
		MetricsEnabled: utility.MetricsOrDefault(st.MetricsEnabled),
		WaterGoalML:    st.WaterGoalML,
		WaterStepML:    st.WaterStepOrDefault(),
		WeightGoalKG:   st.WeightGoalKG,
	}
	if st.SetupDoneAt != nil {
		out.SetupDoneAt = st.SetupDoneAt.Format(time.RFC3339)
	}
	return out
}

// loadHealthDayDetail 三表拼装某一天
func loadHealthDayDetail(ctx context.Context, uid string, date time.Time) (*dto.HealthDayDetail, error) {
	ds := utility.DateStr(date)

	hd, err := dao.HealthDay.GetByUserDate(ctx, uid, date)
	if err != nil {
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "查询健康记录失败")
	}
	pd, err := dao.PeriodDay.GetByUserDate(ctx, uid, date)
	if err != nil && !isNotFound(err) {
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "查询经期记录失败")
	}
	if isNotFound(err) {
		// ⚠️ dao.PeriodDay.GetByUserDate 与 HealthDay 的**行为不一致**：
		//    没记录时它返回 ErrRecordNotFound 而不是 (nil, nil)。
		//    「当天没记经期」是常态不是错误，必须在这里吞掉 ——
		//    否则查任意空白日都会 500002（冒烟时实测踩到）。
		pd = nil
	}
	mood, err := loadHealthMoodBlock(ctx, uid, date)
	if err != nil {
		return nil, err
	}

	// 三张表都没东西 → 返回 null（前端据此显示空表，不是「有记录但全零」）
	if hd == nil && pd == nil && mood.IsEmpty() {
		return nil, nil
	}

	detail := &dto.HealthDayDetail{
		Date:     ds,
		Period:   &dto.HealthPeriodBlock{Symptoms: []string{}},
		Moods:    mood,
		WeightKG: nil,
	}
	if hd != nil {
		detail.WaterML = hd.WaterML
		detail.WeightKG = hd.WeightKG
		detail.BBT = hd.BBT
		detail.SleepHours = hd.SleepHours
		detail.BowelCount = hd.BowelCount
		detail.BowelType = hd.BowelType
	}
	if pd != nil {
		detail.Period.Flow = pd.Flow
		detail.Period.Symptoms = append([]string{}, pd.Symptoms...)
		detail.Period.PainLevel = pd.PainLevel
		detail.Period.Discharge = pd.Discharge
		detail.Period.Intercourse = pd.Intercourse
	}
	if detail.Period.Symptoms == nil {
		detail.Period.Symptoms = []string{}
	}
	// 时间轴明细：浮层打开就能直接画，不必再调一次 /health/events
	evs, err := dao.HealthEvent.ListByDate(ctx, uid, date)
	if err != nil {
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "查询健康事件失败")
	}
	if len(evs) > 0 {
		detail.Events = make([]dto.HealthEventItem, 0, len(evs))
		for i := range evs {
			detail.Events = append(detail.Events, healthEventToItem(evs[i]))
		}
	}
	return detail, nil
}

// loadHealthDayRange 区间拼装（一次查三张表，不在循环里查库）
func loadHealthDayRange(ctx context.Context, uid string, start, end time.Time) ([]dto.HealthDayDetail, error) {
	hdays, err := dao.HealthDay.ListByRange(ctx, uid, start, end)
	if err != nil {
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "查询健康记录失败")
	}
	pdays, err := dao.PeriodDay.ListByRange(ctx, uid, start, end)
	if err != nil {
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "查询经期记录失败")
	}
	mrows, err := dao.MoodLog.ListByRange(ctx, uid, start, end)
	if err != nil {
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "查询心情记录失败")
	}

	byDate := map[string]*dto.HealthDayDetail{}
	ensure := func(ds string) *dto.HealthDayDetail {
		d, ok := byDate[ds]
		if !ok {
			d = &dto.HealthDayDetail{
				Date:   ds,
				Period: &dto.HealthPeriodBlock{Symptoms: []string{}},
				Moods:  &dto.HealthMoodBlock{},
			}
			byDate[ds] = d
		}
		return d
	}
	for i := range hdays {
		d := ensure(utility.DateStr(hdays[i].Date))
		d.WaterML = hdays[i].WaterML
		d.WeightKG = hdays[i].WeightKG
		d.BBT = hdays[i].BBT
		d.SleepHours = hdays[i].SleepHours
		d.BowelCount = hdays[i].BowelCount
		d.BowelType = hdays[i].BowelType
	}
	for i := range pdays {
		d := ensure(utility.DateStr(pdays[i].Date))
		d.Period.Flow = pdays[i].Flow
		d.Period.Symptoms = append([]string{}, pdays[i].Symptoms...)
		d.Period.PainLevel = pdays[i].PainLevel
		d.Period.Discharge = pdays[i].Discharge
		d.Period.Intercourse = pdays[i].Intercourse
	}
	// 心情：按天分桶做向前延续，取该天目标小时那一格
	buckets := map[string][]model.MoodLog{}
	order := []string{}
	for i := range mrows {
		ds := utility.DateStr(mrows[i].Date)
		if _, ok := buckets[ds]; !ok {
			order = append(order, ds)
		}
		buckets[ds] = append(buckets[ds], mrows[i])
	}
	todayStr := utility.DateStr(time.Now())
	for _, ds := range order {
		filled := fillForward(buckets[ds])
		target := model.MoodDiaryHour
		if ds == todayStr {
			target = moodNowHour()
		}
		if it := pickHourItem(filled, target); it != nil {
			ensure(ds).Moods = &dto.HealthMoodBlock{Mood: it.Mood, Energy: it.Energy, Note: it.Note}
		}
	}

	out := make([]dto.HealthDayDetail, 0, len(byDate))
	for d := start; !d.After(end); d = d.AddDate(0, 0, 1) {
		if v, ok := byDate[utility.DateStr(d)]; ok {
			out = append(out, *v)
		}
	}
	return out, nil
}

// loadHealthMoodBlock 某天的心情块（含向前延续）
func loadHealthMoodBlock(ctx context.Context, uid string, date time.Time) (*dto.HealthMoodBlock, error) {
	rows, err := dao.MoodLog.ListByDate(ctx, uid, date)
	if err != nil {
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "查询心情记录失败")
	}
	block := &dto.HealthMoodBlock{}
	if len(rows) == 0 {
		return block, nil
	}
	target := model.MoodDiaryHour
	if utility.DateStr(date) == utility.DateStr(time.Now()) {
		target = moodNowHour()
	}
	it := pickHourItem(fillForward(rows), target)
	if it == nil {
		return block, nil
	}
	block.Mood = it.Mood
	block.Energy = it.Energy
	block.Note = it.Note
	return block, nil
}

// pickHourItem 取目标小时那一格；没有精确命中时取最后一个 ≤ target 的行
func pickHourItem(items []dto.MoodHourResp, target int) *dto.MoodHourResp {
	if len(items) == 0 {
		return nil
	}
	for i := range items {
		if items[i].Hour == target {
			return &items[i]
		}
	}
	var last *dto.MoodHourResp
	for i := range items {
		if items[i].Hour <= target {
			last = &items[i]
		}
	}
	return last
}

// healthRecentSymptoms 近 90 天出现次数降序取前 6；从未记录过 → 空数组
func healthRecentSymptoms(ctx context.Context, uid string) ([]string, error) {
	today := utility.TruncateDate(time.Now())
	from := today.AddDate(0, 0, -healthRecentSymptomDays)
	days, err := dao.PeriodDay.ListByRange(ctx, uid, from, today)
	if err != nil {
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "查询近期症状失败")
	}
	counts := map[string]int{}
	for i := range days {
		for _, k := range days[i].Symptoms {
			counts[k]++
		}
	}
	if len(counts) == 0 {
		return []string{}, nil
	}
	type kv struct {
		key string
		n   int
	}
	pairs := make([]kv, 0, len(counts))
	for k, n := range counts {
		pairs = append(pairs, kv{k, n})
	}
	for i := 1; i < len(pairs); i++ { // 次数降序（同次数按 key 升序，保证稳定）
		for j := i; j > 0; j-- {
			if pairs[j].n > pairs[j-1].n || (pairs[j].n == pairs[j-1].n && pairs[j].key < pairs[j-1].key) {
				pairs[j], pairs[j-1] = pairs[j-1], pairs[j]
			} else {
				break
			}
		}
	}
	out := make([]string, 0, healthRecentSymptomTopN)
	for _, p := range pairs {
		if len(out) >= healthRecentSymptomTopN {
			break
		}
		out = append(out, p.key)
	}
	for _, k := range utility.PeriodDefaultRecentSymptoms() {
		if len(out) >= healthRecentSymptomTopN {
			break
		}
		dup := false
		for _, got := range out {
			if got == k {
				dup = true
				break
			}
		}
		if !dup {
			out = append(out, k)
		}
	}
	return out, nil
}

// healthLastValues 「沿用上次」chip：最近一次有值的体温 / 体重
func healthLastValues(ctx context.Context, uid string) (*dto.HealthLastValues, error) {
	rows, err := dao.HealthDay.ListLatest(ctx, uid, healthRecentSymptomDays)
	if err != nil {
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "查询最近健康记录失败")
	}
	out := &dto.HealthLastValues{}
	for i := range rows {
		if out.BBT == nil && rows[i].BBT != nil {
			v := *rows[i].BBT
			out.BBT = &v
		}
		if out.WeightKG == nil && rows[i].WeightKG != nil {
			v := *rows[i].WeightKG
			out.WeightKG = &v
		}
		if out.BBT != nil && out.WeightKG != nil {
			break
		}
	}
	if out.BBT == nil && out.WeightKG == nil {
		return nil, nil
	}
	return out, nil
}

// healthProgress 今日完成度：启用指标里有值的个数 / 启用指标个数
//
// ⚠️ 分母只数「预期每天都有」（daily=true）的指标（02 §14.5）：
// 排便 / 症状 / 性生活 / 分泌物 / 备注 / 经期这些「不一定每天有 / 周期性」的指标
// 不计入分母，否则进度条永远完不成。计数（recorded）同样只在这批指标里统计。
func healthProgress(enabled []string, day *dto.HealthDayDetail) (recorded, total int) {
	for _, k := range enabled {
		m, ok := utility.GetHealthMetric(k)
		if !ok || !m.Daily {
			continue
		}
		total++
		if day != nil && healthMetricRecorded(k, day) {
			recorded++
		}
	}
	return recorded, total
}

// healthMetricRecorded 该指标今天是否已有值
func healthMetricRecorded(key string, d *dto.HealthDayDetail) bool {
	switch key {
	case "water":
		return d.WaterML > 0
	case "weight":
		return d.WeightKG != nil
	case "bbt":
		return d.BBT != nil
	case "energy_sleep":
		return d.SleepHours != nil
	case "bowel":
		return d.BowelCount > 0 || d.BowelType != model.BowelTypeNone
	case "period":
		return d.Period != nil && d.Period.Flow != 0
	case "symptoms":
		return d.Period != nil && len(d.Period.Symptoms) > 0
	case "discharge":
		return d.Period != nil && d.Period.Discharge != 0
	case "sex":
		return d.Period != nil && d.Period.Intercourse != 0
	case "mood":
		return d.Moods != nil && d.Moods.Mood != 0
	case "note":
		return d.Moods != nil && strings.TrimSpace(d.Moods.Note) != ""
	default:
		return false
	}
}

// buildHealthCards 概览卡的指标行（顺序与注册表一致，未启用的不出现）
//
// 值拼装按 02 §14.2 五型分支；同时填 Count / State / Latest / Icon（§14.6）。
// ⚠️ 心情 / 精力（mood / energy_sleep）按 §16.7 **不进**今日健康卡（归 §15 专属卡），这里跳过。
func buildHealthCards(
	ctx context.Context, uid string, today time.Time,
	day *dto.HealthDayDetail, enabled map[string]bool,
	st *model.HealthSetting, pred *dto.PeriodPrediction,
) ([]dto.HealthCard, error) {
	// 今天各指标的事件条数（来自 day.Events，避免再查库）
	eventCount := map[string]int{}
	if day != nil {
		for i := range day.Events {
			eventCount[day.Events[i].MetricKey]++
		}
	}
	// 指标 key（注册表）↔ 事件 metric_key 的映射：energy_sleep 在 events 里是 "sleep"
	eventKey := func(regKey string) string {
		if regKey == "energy_sleep" {
			return "sleep"
		}
		return regKey
	}

	cards := make([]dto.HealthCard, 0, len(utility.HealthMetrics))
	for _, m := range utility.HealthMetrics {
		if !enabled[m.Key] {
			continue
		}
		// 心情不进今日健康卡（归 §15 专属卡）；精力·睡眠里的「睡眠」在健康卡展示（§16.2）
		if m.Key == "mood" {
			continue
		}
		card := dto.HealthCard{
			Key:   m.Key,
			Label: m.Name,
			Icon:  healthCardIcon(m.Key),
			Tone:  dto.CardToneNormal,
		}
		count := eventCount[eventKey(m.Key)]
		card.Count = count

		switch m.Key {
		case "water":
			got := 0
			if day != nil {
				got = day.WaterML
			}
			p := 0.0
			if st.WaterGoalML > 0 {
				p = math.Min(float64(got)/float64(st.WaterGoalML), 1)
			}
			pp := math.Round(p*100) / 100
			card.Value = fmt.Sprintf("%d / %d ml", got, st.WaterGoalML)
			card.Progress = &pp
			card.State = stateOf(got > 0)
		case "weight":
			if day == nil || day.WeightKG == nil {
				card.Value, card.State = emDash, stateEmpty
			} else {
				card.Value = fmt.Sprintf("%.1f kg", *day.WeightKG)
				card.DeltaText = healthWeightDeltaText(ctx, uid, today, *day.WeightKG)
				card.State = stateRecorded
			}
		case "bbt":
			if day == nil || day.BBT == nil {
				card.Value, card.State = emDash, stateEmpty
			} else {
				card.Value = fmt.Sprintf("%.2f ℃", *day.BBT)
				card.State = stateRecorded
			}
		case "sleep": // 注册表 key 为 energy_sleep，但这里已跳过，故不会走到；保留作防御
			if day == nil || day.SleepHours == nil {
				card.Value, card.State = emDash, stateEmpty
			} else {
				card.Value = fmt.Sprintf("%.1f h", *day.SleepHours)
				card.State = stateRecorded
			}
		case "bowel":
			n := 0
			if day != nil {
				n = day.BowelCount
			}
			if n <= 0 {
				card.Value, card.State = emDash, stateEmpty
			} else {
				card.Value = fmt.Sprintf("%d 次", n)
				card.State = stateRecorded
			}
		case "symptoms":
			n := 0
			if day != nil && day.Period != nil {
				n = len(day.Period.Symptoms)
			}
			if n <= 0 {
				card.Value, card.State = emDash, stateEmpty
			} else {
				card.Value = fmt.Sprintf("%d 项", n)
				card.State = stateRecorded
			}
		case "discharge":
			if day == nil || day.Period == nil || day.Period.Discharge == 0 {
				card.Value, card.State = emDash, stateEmpty
			} else {
				card.Value, card.State = "已记", stateRecorded
			}
		case "sex":
			if day == nil || day.Period == nil || day.Period.Intercourse == 0 {
				card.Value, card.State = emDash, stateEmpty
			} else {
				card.Value, card.State = "已记", stateRecorded
			}
		case "note":
			if day == nil || day.Moods == nil || strings.TrimSpace(day.Moods.Note) == "" {
				card.Value, card.State = emDash, stateEmpty
			} else {
				card.Value, card.State = "已记", stateRecorded
			}
		case "period":
			if pred == nil {
				continue
			}
			card.Value = periodCardText(pred)
			// 周期型：在周期内 = recorded，否则 = n/a（未到日子）
			if pred.CurrentCycle != nil && pred.CurrentCycle.DayIndex > 0 {
				card.State = stateRecorded
			} else {
				card.State = stateNA
			}
		default:
			card.Value, card.State = emDash, stateEmpty
		}
		cards = append(cards, card)
	}
	return cards, nil
}

// 状态常量（02 §14.6）
const (
	stateRecorded = "recorded"
	stateEmpty    = "empty"
	stateNA       = "n/a"
)

// emDash 未记录统一用 — 表示（§14.2）
const emDash = "—"

// stateOf 是否记录 → recorded / empty
func stateOf(has bool) string {
	if has {
		return stateRecorded
	}
	return stateEmpty
}

// healthCardIcon 各指标左侧图标（Lucide name，前端照抄）
func healthCardIcon(key string) string {
	switch key {
	case "water":
		return "droplets"
	case "weight":
		return "scale"
	case "bbt":
		return "thermometer"
	case "bowel":
		return "toilet"
	case "symptoms":
		return "activity"
	case "period":
		return "calendar-heart"
	case "discharge":
		return "droplet"
	case "sex":
		return "heart"
	case "note":
		return "sticky-note"
	case "energy_sleep", "sleep":
		return "moon"
	default:
		return ""
	}
}

// periodCardText 经期卡片文案，如「周期第 26 天 · 距下次 4 天」
func periodCardText(pred *dto.PeriodPrediction) string {
	parts := []string{}
	if c := pred.CurrentCycle; c != nil && c.DayIndex > 0 {
		parts = append(parts, fmt.Sprintf("周期第 %d 天", c.DayIndex))
	}
	if n := pred.NextPeriod; n != nil {
		if n.Overdue {
			parts = append(parts, "已推迟")
		} else if n.DaysUntil > 0 {
			parts = append(parts, fmt.Sprintf("距下次 %d 天", n.DaysUntil))
		}
	}
	if len(parts) == 0 {
		return "数据不足"
	}
	return strings.Join(parts, " · ")
}

// healthWeightDeltaText 「较上周 ±x.x」；不到一周的数据则给空串（不编造对比）
func healthWeightDeltaText(ctx context.Context, uid string, today time.Time, cur float64) string {
	rows, err := dao.HealthDay.ListLatest(ctx, uid, healthWeightDeltaDays*3)
	if err != nil {
		return ""
	}
	base := today.AddDate(0, 0, -healthWeightDeltaDays)
	for i := range rows {
		d := utility.TruncateDate(rows[i].Date)
		if d.After(base) || rows[i].WeightKG == nil {
			continue
		}
		diff := cur - *rows[i].WeightKG
		sign := "+"
		if diff < 0 {
			sign = "−"
		}
		return fmt.Sprintf("较上周 %s%.1f", sign, math.Abs(diff))
	}
	return ""
}

// buildMonthSummary 月份指标摘要条
func buildMonthSummary(
	ctx context.Context, uid string, first, last time.Time,
	waterGoal int, enabled map[string]bool,
) (*dto.HealthMonthSummary, error) {
	out := &dto.HealthMonthSummary{Month: first.Format("2006-01")}

	hdays, err := dao.HealthDay.ListByRange(ctx, uid, first, last)
	if err != nil {
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "查询当月健康记录失败")
	}
	seen := map[string]bool{}
	sum, n := 0.0, 0
	for i := range hdays {
		if !hdays[i].HasAnyValue() {
			continue
		}
		seen[utility.DateStr(hdays[i].Date)] = true
		if enabled["water"] && waterGoal > 0 && hdays[i].WaterML >= waterGoal {
			out.WaterGoalDays++
		}
		if enabled["weight"] && hdays[i].WeightKG != nil {
			sum += *hdays[i].WeightKG
			n++
		}
	}
	out.RecordedDays = len(seen)
	if n > 0 {
		avg := math.Round(sum/float64(n)*10) / 10
		out.WeightAvg = &avg
	}
	if enabled["period"] {
		pdays, err := dao.PeriodDay.ListByRange(ctx, uid, first, last)
		if err != nil {
			return nil, gerror.WrapCode(ecode.DatabaseError, err, "查询当月经期记录失败")
		}
		for i := range pdays {
			if utility.IsBleedingFlow(pdays[i].Flow) {
				out.PeriodDays++
			}
		}
	}
	return out, nil
}

// validateHealthValues 经期块 / 心情块的数值边界校验（07 §1.5 表格）
//
// ⚠️ 2026-09-19 起身体指标（water / bbt / weight / sleep / bowel）的校验**移出本函数**：
// 它们改走 /health/events，由 validateHealthEvent 单独校验（允许按指标给不同边界）。
func validateHealthValues(req *dto.UpsertHealthDayReq) error {
	if req.Period != nil {
		// ⚠️ 取值范围一律取 period_day.go 的常量，**不照抄 spec 07 §1.5 的表格**：
		//    那份表写的是 discharge 0–3 / intercourse 0–1 / pain_level 0–3，
		//    而经期模块实际用的是 0–5 / 0–2 / 0–5（分泌物 5 型、疼痛 5 级）。
		//    两边共用 period_days，按 spec 校验会把经期浮层的合法值判成 400。
		if req.Period.Flow < model.FlowMin || req.Period.Flow > model.FlowMax {
			return gerror.NewCode(ecode.ValidationFailed)
		}
		if req.Period.PainLevel < model.PainLevelMin || req.Period.PainLevel > model.PainLevelMax {
			return gerror.NewCode(ecode.ValidationFailed)
		}
		if req.Period.Discharge < model.DischargeMin || req.Period.Discharge > model.DischargeMax {
			return gerror.NewCode(ecode.ValidationFailed)
		}
		if req.Period.Intercourse < model.IntercourseMin || req.Period.Intercourse > model.IntercourseMax {
			return gerror.NewCode(ecode.ValidationFailed)
		}
	}
	if req.Moods != nil {
		if req.Moods.Mood != 0 && (req.Moods.Mood < model.MoodMin || req.Moods.Mood > model.MoodMax) {
			return gerror.NewCode(ecode.ValidationFailed)
		}
		if req.Moods.Energy != 0 && (req.Moods.Energy < model.EnergyMin || req.Moods.Energy > model.EnergyMax) {
			return gerror.NewCode(ecode.ValidationFailed)
		}
	}
	return nil
}

// isNotFound GORM「未找到」判定
//
// ⚠️ 别用字符串匹配 err.Error()：GORM 的 ErrRecordNotFound 可能被 Wrap，
// 而且文案变了就会静默退化成 500002。一律走 errors.Is。
func isNotFound(err error) bool {
	return errors.Is(err, gorm.ErrRecordNotFound)
}
