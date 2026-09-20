// Package impl 经期服务实现
//
// 业务规则（详见 md/spec-260919/）：
//  1. 只能操作自己的记录（user_id 从 ctx 取）；
//  2. `period_days` 是唯一事实源，`period_cycles` 是它的幂等派生结果（RebuildCycles）；
//  3. 一次提交原子写两张表：`PUT /period/days/:date` 的经期字段进 `period_days`，
//     心情/精力/备注进既有 `mood_logs`，**同一个事务**，避免「经期记上了、心情没记上」；
//  4. 预测不落表：每次写后实时重算并随响应返回（03 §14）；
//  5. 设置行懒创建 —— GET /period/settings 永远有值、不会 404。
package impl

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/gogf/gf/v2/errors/gerror"
	"github.com/gogf/gf/v2/frame/g"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"github.com/life-assistant/api/internal/consts/ecode"
	"github.com/life-assistant/api/internal/dao"
	"github.com/life-assistant/api/internal/model"
	"github.com/life-assistant/api/internal/model/dto"
	"github.com/life-assistant/api/internal/service"
	"github.com/life-assistant/api/internal/utility"
)

// 记录窗口约束（05 §5 校验表）
const (
	periodMaxRangeDays        = 366 // 区间查询跨度上限
	periodMaxBackYears        = 5   // 最早可记录到「今天 − 5 年」
	periodFutureToleranceDays = 1   // 允许记录到「今天 + 1 天」（跨时区补记）
	periodRecentSymptomDays   = 90  // 「近期症状」回看窗口
	periodManualClaimDays     = 10  // 人工修正周期认领所属出血组的容差（天）
	periodLastCycleBBTCapDays = 60  // 最后一个（进行中）周期的体温判定窗口上限
)

// PeriodService 经期服务实现
type PeriodService struct{}

// NewPeriodService 构造函数
func NewPeriodService() service.IPeriodService { return &PeriodService{} }

// Register
func init() { service.SetPeriod(NewPeriodService()) }

// ============================================================================
// 概览
// ============================================================================

// Overview GET /period/overview
func (s *PeriodService) Overview(ctx context.Context, req *dto.PeriodOverviewReq) (*dto.PeriodOverviewResp, error) {
	uid := ctxUserID(ctx)
	if uid == "" {
		return nil, gerror.NewCode(ecode.AuthTokenMissing)
	}
	today, err := resolvePeriodDate(req.Date, true)
	if err != nil {
		return nil, err
	}

	st, err := ensurePeriodSettings(ctx, uid)
	if err != nil {
		return nil, err
	}
	pred, cycles, err := computePeriodPrediction(ctx, uid, today)
	if err != nil {
		return nil, err
	}

	day, mood, err := loadDayAndMood(ctx, uid, today)
	if err != nil {
		return nil, err
	}

	return &dto.PeriodOverviewResp{
		Initialized:        len(cycles) > 0 || st.LastPeriodStart != nil,
		HasEnoughData:      pred.Confidence != utility.PeriodConfInsufficient,
		Today:              utility.DateStr(today),
		TodayLog:           periodDayDetail(day, mood),
		Prediction:         pred,
		Settings:           periodSettingsToResp(st),
		DisclaimerAccepted: st.DisclaimerAcceptedAt != nil,
	}, nil
}

// ============================================================================
// 月历
// ============================================================================

// markPriority marks 输出顺序（前端按固定顺序渲染，避免每天的花色顺序抖动）
var markPriority = []string{
	dto.MarkPeriod, dto.MarkFlowLight, dto.MarkFlowMedium, dto.MarkFlowHeavy,
	dto.MarkSpotting, dto.MarkOvulation, dto.MarkFertile, dto.MarkPeak,
	dto.MarkPeriodPredicted,
	// ↓ 分类小点（260919 新增）：有记录的那一类才出现，前端按此顺序上色，
	//   保证同一天的小点顺序稳定（不会今天红黄蓝、明天蓝黄红）
	dto.MarkMetricMood, dto.MarkMetricEnergy, dto.MarkMetricBBT,
	dto.MarkMetricWater, dto.MarkMetricBowel, dto.MarkMetricWeight,
	dto.MarkLogged, dto.MarkToday,
}

// Calendar GET /period/calendar?month=YYYY-MM
func (s *PeriodService) Calendar(ctx context.Context, req *dto.PeriodCalendarReq) (*dto.PeriodCalendarResp, error) {
	uid := ctxUserID(ctx)
	if uid == "" {
		return nil, gerror.NewCode(ecode.AuthTokenMissing)
	}
	month := strings.TrimSpace(req.Month)
	first, err := time.ParseInLocation("2006-01", month, time.Local)
	if err != nil {
		return nil, gerror.NewCode(ecode.PeriodMonthInvalid)
	}
	last := first.AddDate(0, 1, -1)
	today := periodToday()

	pred, _, err := computePeriodPrediction(ctx, uid, today)
	if err != nil {
		return nil, err
	}

	days, err := dao.PeriodDay.ListByRange(ctx, uid, first, last)
	if err != nil {
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "查询经期记录失败")
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

	for i := range days {
		d := days[i]
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
		default:
			add(ds, dto.MarkLogged)
		}
	}

	// 预测标记（仅在开关打开时返回；安全期**不返回**，见 04 §3.3）
	if pred != nil {
		if npp := pred.NextPeriod; npp != nil && npp.EndEst != "" {
			if from, e1 := utility.ParseDate(npp.Date); e1 == nil {
				if to, e2 := utility.ParseDate(npp.EndEst); e2 == nil {
					for d := from; !d.After(to); d = d.AddDate(0, 0, 1) {
						add(utility.DateStr(d), dto.MarkPeriodPredicted)
					}
				}
			}
		}
		if fw := pred.FertileWindow; fw != nil {
			if from, e1 := utility.ParseDate(fw.Start); e1 == nil {
				if to, e2 := utility.ParseDate(fw.End); e2 == nil {
					for d := from; !d.After(to); d = d.AddDate(0, 0, 1) {
						add(utility.DateStr(d), dto.MarkFertile)
					}
				}
			}
			if len(fw.Peak) == 2 {
				if from, e1 := utility.ParseDate(fw.Peak[0]); e1 == nil {
					if to, e2 := utility.ParseDate(fw.Peak[1]); e2 == nil {
						for d := from; !d.After(to); d = d.AddDate(0, 0, 1) {
							add(utility.DateStr(d), dto.MarkPeak)
						}
					}
				}
			}
		}
		if ov := pred.Ovulation; ov != nil && ov.Date != "" {
			add(ov.Date, dto.MarkOvulation)
		}
	}

	if !today.Before(first) && !today.After(last) {
		add(utility.DateStr(today), dto.MarkToday)
	}

	// 组装：按日期升序，marks 按 markPriority 固定顺序
	out := make([]dto.PeriodCalendarDay, 0, len(marks))
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
		out = append(out, dto.PeriodCalendarDay{Date: ds, Marks: list})
	}

	return &dto.PeriodCalendarResp{Month: month, Days: out, Prediction: pred}, nil
}

// ============================================================================
// 区间日记 / 单日详情
// ============================================================================

// ListDays GET /period/days?start=&end=
func (s *PeriodService) ListDays(ctx context.Context, req *dto.ListPeriodDaysReq) (*dto.ListPeriodDaysResp, error) {
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
	if end.Before(start) {
		return nil, gerror.NewCode(ecode.ValidationFailed)
	}
	if utility.DaysBetween(start, end)+1 > periodMaxRangeDays {
		return nil, gerror.NewCode(ecode.PeriodRangeTooWide)
	}

	merged, err := loadRangeDetails(ctx, uid, start, end)
	if err != nil {
		return nil, err
	}
	items := make([]dto.PeriodDayDetail, 0, len(merged))
	for d := start; !d.After(end); d = d.AddDate(0, 0, 1) {
		if v, ok := merged[utility.DateStr(d)]; ok {
			items = append(items, *v)
		}
	}
	return &dto.ListPeriodDaysResp{Items: items, Total: len(items)}, nil
}

// GetDay GET /period/days/:date
func (s *PeriodService) GetDay(ctx context.Context, date string) (*dto.PeriodDayDetailResp, error) {
	uid := ctxUserID(ctx)
	if uid == "" {
		return nil, gerror.NewCode(ecode.AuthTokenMissing)
	}
	d, err := resolvePeriodDate(date, false)
	if err != nil {
		return nil, err
	}
	day, mood, err := loadDayAndMood(ctx, uid, d)
	if err != nil {
		return nil, err
	}

	// 近期症状：近 90 天出现次数降序取前 6，不足用词库默认顺序补足；
	// 从未记录过 → 返回空数组（前端据此隐藏该分组，02 §4.4）
	today := periodToday()
	recentFrom := today.AddDate(0, 0, -periodRecentSymptomDays)
	recentDays, err := dao.PeriodDay.ListByRange(ctx, uid, recentFrom, today)
	if err != nil {
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "查询近期症状失败")
	}
	counts := map[string]int{}
	for i := range recentDays {
		for _, k := range recentDays[i].Symptoms {
			counts[k]++
		}
	}
	recentSymptoms := []string{}
	if len(counts) > 0 {
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
		for _, p := range pairs {
			if len(recentSymptoms) >= 6 {
				break
			}
			recentSymptoms = append(recentSymptoms, p.key)
		}
		for _, k := range utility.PeriodDefaultRecentSymptoms() {
			if len(recentSymptoms) >= 6 {
				break
			}
			dup := false
			for _, got := range recentSymptoms {
				if got == k {
					dup = true
					break
				}
			}
			if !dup {
				recentSymptoms = append(recentSymptoms, k)
			}
		}
	}

	// 沿用上次：最近一次有值的 bbt / weight
	last := &dto.PeriodLastValues{}
	for i := len(recentDays) - 1; i >= 0; i-- {
		if last.BBT == nil && recentDays[i].BBT != nil {
			v := *recentDays[i].BBT
			last.BBT = &v
		}
		if last.Weight == nil && recentDays[i].Weight != nil {
			v := *recentDays[i].Weight
			last.Weight = &v
		}
		if last.BBT != nil && last.Weight != nil {
			break
		}
	}
	if last.BBT == nil && last.Weight == nil {
		last = nil
	}

	return &dto.PeriodDayDetailResp{
		Day:            periodDayDetail(day, mood),
		RecentSymptoms: recentSymptoms,
		LastValues:     last,
	}, nil
}

// ============================================================================
// 写日记（核心）
// ============================================================================

// UpsertDay PUT /period/days/:date
//
// 整体覆盖语义（与既有 PUT /moods 一致）：请求体里没给的字段一律置为「未记录」。
// 这样「取消勾选症状」才能生效，也避免前端要为「清空 vs 不改」做额外的补丁协议。
func (s *PeriodService) UpsertDay(ctx context.Context, req *dto.UpsertPeriodDayReq) (*dto.UpsertPeriodDayResp, error) {
	uid := ctxUserID(ctx)
	if uid == "" {
		return nil, gerror.NewCode(ecode.AuthTokenMissing)
	}
	date, err := resolvePeriodDate(req.Date, false)
	if err != nil {
		return nil, err
	}
	today := periodToday()
	if err := validateRecordableDate(date, today); err != nil {
		return nil, err
	}
	if err := validateDayValues(req); err != nil {
		return nil, err
	}
	symptoms := filterPeriodSymptoms(ctx, req.Symptoms)
	ds := utility.DateStr(date)

	// 「整页全空 + 点完成」→ 删除该日记录，不留空行（02 §5）
	periodEmpty := req.Flow == 0 && len(symptoms) == 0 && req.PainLevel == 0 &&
		req.Discharge == 0 && req.BBT == nil && req.Weight == nil &&
		req.SleepHours == nil && req.Intercourse == 0

	moodGiven := req.Mood != nil || req.Energy != nil || req.Note != nil
	newMood, newEnergy, newNote := 0, 0, ""
	if req.Mood != nil {
		newMood = *req.Mood
	}
	if req.Energy != nil {
		newEnergy = *req.Energy
	}
	if req.Note != nil {
		newNote = strings.TrimSpace(*req.Note)
	}
	moodEmpty := newMood == 0 && newEnergy == 0 && newNote == ""

	changed := false
	err = dao.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// 1) period_days upsert
		if periodEmpty {
			if err := tx.Where("user_id = ? AND date = ?", uid, ds).Delete(&model.PeriodDay{}).Error; err != nil {
				return err
			}
		} else {
			row := &model.PeriodDay{
				ID: utility.NewID("pd"), UserID: uid, Date: date,
				Flow: req.Flow, Symptoms: model.StringArray(symptoms), PainLevel: req.PainLevel,
				Discharge: req.Discharge, BBT: req.BBT, Weight: req.Weight,
				SleepHours: req.SleepHours, Intercourse: req.Intercourse,
			}
			if err := tx.Clauses(clause.OnConflict{
				Columns: []clause.Column{{Name: "user_id"}, {Name: "date"}},
				DoUpdates: clause.AssignmentColumns([]string{
					"flow", "symptoms", "pain_level", "discharge",
					"bbt", "weight", "sleep_hours", "intercourse", "updated_at",
				}),
			}).Create(row).Error; err != nil {
				return err
			}
		}

		// 2) mood_logs：三个字段一个都没给 → 不触碰既有行；给了任一 → 整体覆盖
		//
		// ⚠️ 260919：心情/精力改成按小时记录后，本模块只认「日记槽位」hour = 12。
		// 经期日记仍是一天一条（用户已拍板），落到 12:00 那一格；
		// 绝不能不带 hour 地按 (user_id, date) 匹配 —— 那会连带清掉/覆盖
		// 用户当天在记录页按小时记的心情。
		if moodGiven {
			if moodEmpty {
				if err := tx.Where("user_id = ? AND date = ? AND hour = ?",
					uid, ds, model.MoodDiaryHour).Delete(&model.MoodLog{}).Error; err != nil {
					return err
				}
			} else {
				moodVal := newMood
				if moodVal == 0 {
					// 只给了 energy / note 没给心情档位：保留既有心情值；
					// 若本来就没有这一行，取中性档 3（一般）—— mood_logs.mood 是 NOT NULL，
					// 不能为了「不发明数据」而把用户写的备注丢掉（数据丢失更糟）。
					var exist model.MoodLog
					e := tx.Where("user_id = ? AND date = ? AND hour = ?",
						uid, ds, model.MoodDiaryHour).First(&exist).Error
					switch {
					case e == nil:
						moodVal = exist.Mood
					case errors.Is(e, gorm.ErrRecordNotFound):
						moodVal = 3
					default:
						return e
					}
				}
				row := &model.MoodLog{
					ID: utility.NewID("ml"), UserID: uid, Date: date,
					Hour: model.MoodDiaryHour, Mood: moodVal,
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

		// 3) RebuildCycles —— 幂等重算（同一事务内）
		c, err := rebuildPeriodCyclesTx(ctx, tx, uid)
		if err != nil {
			return err
		}
		changed = c
		return nil
	})
	if err != nil {
		return nil, wrapPeriodTxError(err, "保存经期记录失败")
	}

	// 4) 重算 prediction 并随响应返回，前端不必二次请求
	day, mood, err := loadDayAndMood(ctx, uid, date)
	if err != nil {
		return nil, err
	}
	pred, _, err := computePeriodPrediction(ctx, uid, today)
	if err != nil {
		return nil, err
	}
	return &dto.UpsertPeriodDayResp{
		Day:           periodDayDetail(day, mood),
		CyclesChanged: changed,
		Prediction:    pred,
	}, nil
}

// DeleteDay DELETE /period/days/:date
// 同一事务里连带删除当天的 mood_logs 行并重算周期。
func (s *PeriodService) DeleteDay(ctx context.Context, date string) error {
	uid := ctxUserID(ctx)
	if uid == "" {
		return gerror.NewCode(ecode.AuthTokenMissing)
	}
	d, err := resolvePeriodDate(date, false)
	if err != nil {
		return err
	}
	ds := utility.DateStr(d)

	err = dao.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("user_id = ? AND date = ?", uid, ds).Delete(&model.PeriodDay{}).Error; err != nil {
			return err
		}
		// ⚠️ 260919：只删日记槽位（hour = 12）。不带 hour 地按 (user_id, date) 删
		// 会把用户当天按小时记的心情一起抹掉 —— 那不是这个动作的语义。
		if err := tx.Where("user_id = ? AND date = ? AND hour = ?",
			uid, ds, model.MoodDiaryHour).Delete(&model.MoodLog{}).Error; err != nil {
			return err
		}
		_, err := rebuildPeriodCyclesTx(ctx, tx, uid)
		return err
	})
	if err != nil {
		return wrapPeriodTxError(err, "删除经期记录失败")
	}
	return nil
}

// ============================================================================
// 周期
// ============================================================================

// ListCycles GET /period/cycles?limit=12
func (s *PeriodService) ListCycles(ctx context.Context, req *dto.ListPeriodCyclesReq) (*dto.ListPeriodCyclesResp, error) {
	uid := ctxUserID(ctx)
	if uid == "" {
		return nil, gerror.NewCode(ecode.AuthTokenMissing)
	}
	limit := req.Limit
	if limit <= 0 {
		limit = 12
	}
	cycles, err := dao.PeriodCycle.ListByUser(ctx, uid, limit)
	if err != nil {
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "查询周期失败")
	}
	items := make([]dto.PeriodCycleResp, 0, len(cycles))
	for i := range cycles {
		items = append(items, *periodCycleToResp(&cycles[i]))
	}
	return &dto.ListPeriodCyclesResp{Items: items, Total: len(items)}, nil
}

// PatchCycle PATCH /period/cycles/:id（period:manage）
func (s *PeriodService) PatchCycle(ctx context.Context, req *dto.PatchPeriodCycleReq) (*dto.PatchPeriodCycleResp, error) {
	uid := ctxUserID(ctx)
	if uid == "" {
		return nil, gerror.NewCode(ecode.AuthTokenMissing)
	}
	cy, err := dao.PeriodCycle.GetByID(ctx, req.ID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, gerror.NewCode(ecode.PeriodCycleNotFound)
		}
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "查询周期失败")
	}
	if cy.UserID != uid {
		return nil, gerror.NewCode(ecode.PeriodCycleAccessDenied)
	}

	newStart := utility.TruncateDate(cy.StartDate)
	if strings.TrimSpace(req.StartDate) != "" {
		v, e := resolvePeriodDate(req.StartDate, false)
		if e != nil {
			return nil, e
		}
		newStart = v
	}

	// 重叠校验（05 §8）：新的 start_date 不能落进别的周期区间，也不能撞唯一键
	all, err := dao.PeriodCycle.ListAllByUser(ctx, uid)
	if err != nil {
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "查询周期失败")
	}
	for i := range all {
		if all[i].ID == cy.ID {
			continue
		}
		cs := utility.TruncateDate(all[i].StartDate)
		ce := cs.AddDate(0, 0, model.DefaultCycleLength-1)
		if all[i].EndDate != nil {
			ce = utility.TruncateDate(*all[i].EndDate)
		}
		if !newStart.Before(cs) && !newStart.After(ce) {
			return nil, gerror.NewCode(ecode.PeriodCycleOverlap)
		}
		if utility.DateStr(cs) == utility.DateStr(newStart) {
			return nil, gerror.NewCode(ecode.PeriodCycleOverlap)
		}
	}

	fields := map[string]any{"is_manual": 1}
	if strings.TrimSpace(req.StartDate) != "" {
		fields["start_date"] = newStart
	}
	if req.EndDate != nil {
		if strings.TrimSpace(*req.EndDate) == "" {
			fields["end_date"] = nil
		} else {
			e, err := resolvePeriodDate(*req.EndDate, false)
			if err != nil {
				return nil, err
			}
			if e.Before(newStart) {
				return nil, gerror.NewCode(ecode.ValidationFailed)
			}
			fields["end_date"] = e
		}
	}
	if strings.TrimSpace(req.Note) != "" {
		fields["note"] = strings.TrimSpace(req.Note)
	}
	if err := dao.PeriodCycle.UpdateFields(ctx, cy.ID, fields); err != nil {
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "修正周期失败")
	}

	if err := rebuildPeriodCycles(ctx, uid); err != nil {
		return nil, err
	}

	fresh, err := dao.PeriodCycle.GetByID(ctx, cy.ID)
	if err != nil {
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "重新查询周期失败")
	}
	pred, _, err := computePeriodPrediction(ctx, uid, periodToday())
	if err != nil {
		return nil, err
	}
	return &dto.PatchPeriodCycleResp{Cycle: periodCycleToResp(fresh), Prediction: pred}, nil
}

// ============================================================================
// 设置
// ============================================================================

// GetSettings GET /period/settings
func (s *PeriodService) GetSettings(ctx context.Context) (*dto.PeriodSettingsResp, error) {
	uid := ctxUserID(ctx)
	if uid == "" {
		return nil, gerror.NewCode(ecode.AuthTokenMissing)
	}
	st, err := ensurePeriodSettings(ctx, uid)
	if err != nil {
		return nil, err
	}
	return periodSettingsToResp(st), nil
}

// PatchSettings PATCH /period/settings
func (s *PeriodService) PatchSettings(ctx context.Context, req *dto.PatchPeriodSettingsReq) (*dto.PeriodSettingsResp, error) {
	uid := ctxUserID(ctx)
	if uid == "" {
		return nil, gerror.NewCode(ecode.AuthTokenMissing)
	}
	st, err := ensurePeriodSettings(ctx, uid)
	if err != nil {
		return nil, err
	}

	fields := map[string]any{}
	if req.AvgCycleLength != nil {
		if *req.AvgCycleLength < model.AvgCycleLengthMin || *req.AvgCycleLength > model.AvgCycleLengthMax {
			return nil, gerror.NewCode(ecode.PeriodSettingInvalid)
		}
		fields["avg_cycle_length"] = *req.AvgCycleLength
	}
	if req.AvgPeriodLength != nil {
		if *req.AvgPeriodLength < model.AvgPeriodLengthMin || *req.AvgPeriodLength > model.AvgPeriodLengthMax {
			return nil, gerror.NewCode(ecode.PeriodSettingInvalid)
		}
		fields["avg_period_length"] = *req.AvgPeriodLength
	}
	if req.LutealLength != nil {
		if *req.LutealLength < model.LutealLengthMin || *req.LutealLength > model.LutealLengthMax {
			return nil, gerror.NewCode(ecode.PeriodSettingInvalid)
		}
		fields["luteal_length"] = *req.LutealLength
	}
	if req.Goal != nil {
		if *req.Goal < model.GoalMin || *req.Goal > model.GoalMax {
			return nil, gerror.NewCode(ecode.PeriodSettingInvalid)
		}
		fields["goal"] = *req.Goal
	}
	if req.ShowFertileWindow != nil {
		fields["show_fertile_window"] = boolToTiny(*req.ShowFertileWindow != 0)
	}
	if req.IrregularAlert != nil {
		fields["irregular_alert"] = boolToTiny(*req.IrregularAlert != 0)
	}
	if req.LastPeriodStart != nil {
		if strings.TrimSpace(*req.LastPeriodStart) == "" {
			fields["last_period_start"] = nil
		} else {
			d, err := resolvePeriodDate(*req.LastPeriodStart, false)
			if err != nil {
				return nil, err
			}
			fields["last_period_start"] = d
		}
	}
	// 首次免责确认（04 §7）
	if req.AcceptDisclaimer != nil && *req.AcceptDisclaimer && st.DisclaimerAcceptedAt == nil {
		fields["disclaimer_accepted_at"] = time.Now()
	}

	if len(fields) > 0 {
		if err := dao.PeriodSetting.UpdateFields(ctx, st.ID, fields); err != nil {
			return nil, gerror.WrapCode(ecode.DatabaseError, err, "更新经期设置失败")
		}
	}
	fresh, err := dao.PeriodSetting.GetByUser(ctx, uid)
	if err != nil {
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "重新查询经期设置失败")
	}
	return periodSettingsToResp(fresh), nil
}

// ============================================================================
// 引导向导
// ============================================================================

// Setup POST /period/setup —— 把「引导 5 步」压成一次请求，避免填到一半断网留下半个状态
func (s *PeriodService) Setup(ctx context.Context, req *dto.PeriodSetupReq) (*dto.PeriodSetupResp, error) {
	uid := ctxUserID(ctx)
	if uid == "" {
		return nil, gerror.NewCode(ecode.AuthTokenMissing)
	}
	start, err := resolvePeriodDate(req.LastPeriodStart, false)
	if err != nil {
		return nil, err
	}
	today := periodToday()
	if start.After(today) {
		return nil, gerror.NewCode(ecode.PeriodDateOutOfRange)
	}
	st, err := ensurePeriodSettings(ctx, uid)
	if err != nil {
		return nil, err
	}

	avgPeriod := req.AvgPeriodLength
	if avgPeriod <= 0 {
		avgPeriod = model.DefaultPeriodLength
	}
	avgCycle := req.AvgCycleLength
	if avgCycle <= 0 {
		avgCycle = model.DefaultCycleLength
	}
	goal := req.Goal
	if goal <= 0 {
		goal = model.GoalTrack
	}
	if avgPeriod < model.AvgPeriodLengthMin || avgPeriod > model.AvgPeriodLengthMax ||
		avgCycle < model.AvgCycleLengthMin || avgCycle > model.AvgCycleLengthMax ||
		goal < model.GoalMin || goal > model.GoalMax {
		return nil, gerror.NewCode(ecode.PeriodSettingInvalid)
	}

	now := time.Now()
	settingsFields := map[string]any{
		"avg_cycle_length":    avgCycle,
		"avg_period_length":   avgPeriod,
		"goal":                goal,
		"show_fertile_window": boolToTiny(req.ShowFertileWindow != 0),
		"last_period_start":   start,
	}
	if st.DisclaimerAcceptedAt == nil {
		settingsFields["disclaimer_accepted_at"] = now
	}

	// 冷启动骨架：用户只知道上次是几号来的、来了几天，不可能补录每一次经量。
	// 先造出 flow = medium 的骨架，之后逐日细化。
	created := 0
	lastCreatable := start.AddDate(0, 0, avgPeriod-1)
	if lastCreatable.After(today) {
		lastCreatable = today // 不往未来造记录
	}

	err = dao.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&model.PeriodSetting{}).Where("id = ?", st.ID).Updates(settingsFields).Error; err != nil {
			return err
		}
		for d := start; !d.After(lastCreatable); d = d.AddDate(0, 0, 1) {
			var cnt int64
			if err := tx.Model(&model.PeriodDay{}).
				Where("user_id = ? AND date = ?", uid, utility.DateStr(d)).
				Count(&cnt).Error; err != nil {
				return err
			}
			if cnt > 0 {
				continue // 已有记录，不覆盖用户手工填的内容
			}
			row := &model.PeriodDay{
				ID: utility.NewID("pd"), UserID: uid, Date: d, Flow: model.FlowMedium,
			}
			if err := tx.Create(row).Error; err != nil {
				return err
			}
			created++
		}
		_, err := rebuildPeriodCyclesTx(ctx, tx, uid)
		return err
	})
	if err != nil {
		return nil, wrapPeriodTxError(err, "初始化经期设置失败")
	}

	pred, _, err := computePeriodPrediction(ctx, uid, today)
	if err != nil {
		return nil, err
	}
	return &dto.PeriodSetupResp{Prediction: pred, CreatedDays: created}, nil
}

// ============================================================================
// 重置
// ============================================================================

// Reset POST /period/reset（period:manage）
// 硬删 period_days 与 period_cycles，保留 period_settings 但清空 last_period_start。
func (s *PeriodService) Reset(ctx context.Context, req *dto.PeriodResetReq) error {
	uid := ctxUserID(ctx)
	if uid == "" {
		return gerror.NewCode(ecode.AuthTokenMissing)
	}
	if strings.TrimSpace(req.Confirm) != "RESET" {
		return gerror.NewCode(ecode.PeriodResetUnconfirmed)
	}
	err := dao.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("user_id = ?", uid).Delete(&model.PeriodDay{}).Error; err != nil {
			return err
		}
		if err := tx.Where("user_id = ?", uid).Delete(&model.PeriodCycle{}).Error; err != nil {
			return err
		}
		return tx.Model(&model.PeriodSetting{}).Where("user_id = ?", uid).
			Update("last_period_start", nil).Error
	})
	if err != nil {
		return wrapPeriodTxError(err, "重置经期数据失败")
	}
	return nil
}

// ============================================================================
// 周期报告（P1）
// ============================================================================

// Report GET /period/report?range=6m|12m
func (s *PeriodService) Report(ctx context.Context, req *dto.PeriodReportReq) (*dto.PeriodReportResp, error) {
	uid := ctxUserID(ctx)
	if uid == "" {
		return nil, gerror.NewCode(ecode.AuthTokenMissing)
	}
	rng := strings.TrimSpace(req.Range)
	if rng == "" {
		rng = "6m"
	}
	months := 6
	switch rng {
	case "6m":
	case "12m":
		months = 12
	default:
		return nil, gerror.NewCode(ecode.StatsRangeInvalid)
	}

	today := periodToday()
	from := today.AddDate(0, -months, 0)

	st, err := ensurePeriodSettings(ctx, uid)
	if err != nil {
		return nil, err
	}
	allCycles, err := dao.PeriodCycle.ListAllByUser(ctx, uid)
	if err != nil {
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "查询周期失败")
	}
	days, err := dao.PeriodDay.ListByRange(ctx, uid, from, today)
	if err != nil {
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "查询经期记录失败")
	}

	// 区间内的周期（按 start_date 升序，与 allCycles 同序）
	inRange := make([]model.PeriodCycle, 0, len(allCycles))
	for i := range allCycles {
		if !utility.TruncateDate(allCycles[i].StartDate).Before(from) {
			inRange = append(inRange, allCycles[i])
		}
	}

	// ── summary ──
	lengths := []int{}
	periodLens := []int{}
	for i := range inRange {
		if inRange[i].CycleLength != nil {
			lengths = append(lengths, *inRange[i].CycleLength)
		}
		if inRange[i].PeriodLength > 0 {
			periodLens = append(periodLens, inRange[i].PeriodLength)
		}
	}
	sigma := utility.RobustSigma(lengths)
	summary := &dto.PeriodReportSummary{
		CycleCount:  len(lengths),
		AvgCycle:    utility.MeanInt(lengths),
		MedianCycle: utility.MedianInt(lengths),
		MinCycle:    utility.MinInt(lengths),
		MaxCycle:    utility.MaxInt(lengths),
		Sigma:       utility.Round2(sigma),
		AvgPeriod:   utility.MeanInt(periodLens),
		Regularity:  utility.RegularityOf(sigma),
	}

	// ── cycle_trend：最近 12 个（倒序取回后翻正，让前端直接顺序画折线）──
	trend := []dto.PeriodReportTrendItem{}
	start := 0
	if len(inRange) > 12 {
		start = len(inRange) - 12
	}
	for i := start; i < len(inRange); i++ {
		trend = append(trend, dto.PeriodReportTrendItem{
			StartDate:    utility.DateStr(utility.TruncateDate(inRange[i].StartDate)),
			CycleLength:  inRange[i].CycleLength,
			PeriodLength: inRange[i].PeriodLength,
		})
	}

	// ── flow_distribution / bbt_series / 症状统计 ──
	flowCount := map[int]int{}
	symptomTotal := map[string]int{}
	phaseCount := map[string]map[string]int{}
	bbtSeries := []dto.PeriodBBTPoint{}
	cycleWithSymptom := map[string]map[int]bool{} // key → 出现过的周期序号集合

	// 为每天定位所属周期序号
	cycleIndexAt := func(d time.Time) int {
		idx := -1
		for i := range inRange {
			cs := utility.TruncateDate(inRange[i].StartDate)
			if !cs.After(d) {
				idx = i
			} else {
				break
			}
		}
		return idx
	}

	for i := range days {
		d := days[i]
		dd := utility.TruncateDate(d.Date)
		if d.Flow > 0 {
			flowCount[d.Flow]++
		}
		if d.BBT != nil {
			bbtSeries = append(bbtSeries, dto.PeriodBBTPoint{Date: utility.DateStr(dd), BBT: utility.Round2(*d.BBT)})
		}
		if len(d.Symptoms) == 0 {
			continue
		}
		idx := cycleIndexAt(dd)
		phase := periodPhaseKeyAt(dd, idx, inRange, st)
		for _, k := range d.Symptoms {
			symptomTotal[k]++
			if phaseCount[k] == nil {
				phaseCount[k] = map[string]int{}
			}
			phaseCount[k][phase]++
			if idx >= 0 {
				if cycleWithSymptom[k] == nil {
					cycleWithSymptom[k] = map[int]bool{}
				}
				cycleWithSymptom[k][idx] = true
			}
		}
	}

	flowKeys := make([]int, 0, len(flowCount))
	for f := range flowCount {
		flowKeys = append(flowKeys, f)
	}
	sortIntsAsc(flowKeys)
	flowDist := make([]dto.PeriodFlowBucket, 0, len(flowKeys))
	for _, f := range flowKeys {
		flowDist = append(flowDist, dto.PeriodFlowBucket{Flow: f, Days: flowCount[f]})
	}

	// ── symptom_frequency：按出现次数降序，rate = 出现在多少个周期 / 区间内周期数 ──
	cycleDenom := len(inRange)
	freq := make([]dto.PeriodSymptomFreq, 0, len(symptomTotal))
	for k, n := range symptomTotal {
		rate := 0.0
		if cycleDenom > 0 {
			rate = utility.Round2(float64(len(cycleWithSymptom[k])) / float64(cycleDenom))
		}
		freq = append(freq, dto.PeriodSymptomFreq{
			Key: k, Label: utility.PeriodSymptomLabel(k), Count: n, Rate: rate,
		})
	}
	sortPeriodFreq(freq)
	if len(freq) > 20 {
		freq = freq[:20]
	}

	// ── symptom_phase_correlation：取出现 ≥2 次的前 10 个症状，给出主导阶段 ──
	corr := []dto.PeriodSymptomPhase{}
	for _, f := range freq {
		if f.Count < 2 {
			continue
		}
		phases := phaseCount[f.Key]
		dom, domN := "", 0
		for _, p := range []string{"menstrual", "follicular", "ovulation", "luteal"} {
			if phases[p] > domN {
				dom, domN = p, phases[p]
			}
		}
		if dom == "" {
			continue
		}
		corr = append(corr, dto.PeriodSymptomPhase{
			Key:           f.Key,
			DominantPhase: dom,
			Rate:          utility.Round2(float64(domN) / float64(f.Count)),
		})
		if len(corr) >= 10 {
			break
		}
	}

	pred, _, err := computePeriodPrediction(ctx, uid, today)
	if err != nil {
		return nil, err
	}

	return &dto.PeriodReportResp{
		Range:            rng,
		Summary:          summary,
		CycleTrend:       trend,
		FlowDistribution: flowDist,
		SymptomFrequency: freq,
		SymptomPhaseCorr: corr,
		BBTSeries:        bbtSeries,
		Alerts:           pred.Alerts,
		SymptomForecast:  pred.SymptomForecast,
	}, nil
}

// periodPhaseKeyAt 判定某天落在所属周期的哪个阶段（报告页的相位关联用）
func periodPhaseKeyAt(d time.Time, idx int, cycles []model.PeriodCycle, st *model.PeriodSetting) string {
	if idx < 0 || idx >= len(cycles) {
		return "follicular"
	}
	cs := utility.TruncateDate(cycles[idx].StartDate)
	var nextStart time.Time
	switch {
	case idx+1 < len(cycles):
		nextStart = utility.TruncateDate(cycles[idx+1].StartDate)
	case cycles[idx].CycleLength != nil:
		nextStart = cs.AddDate(0, 0, *cycles[idx].CycleLength)
	default:
		nextStart = cs.AddDate(0, 0, st.AvgCycleLength)
	}
	luteal := st.LutealLength
	if luteal <= 0 {
		luteal = model.DefaultLutealLength
	}
	ov := nextStart.AddDate(0, 0, -luteal)

	if cycles[idx].OvulationDate != nil {
		ov = utility.TruncateDate(*cycles[idx].OvulationDate)
	}
	if !d.Before(cs) && !d.After(cs.AddDate(0, 0, max0(cycles[idx].PeriodLength-1))) {
		return "menstrual"
	}
	if !d.Before(ov.AddDate(0, 0, -1)) && !d.After(ov.AddDate(0, 0, 1)) {
		return "ovulation"
	}
	if d.After(ov.AddDate(0, 0, 1)) {
		return "luteal"
	}
	return "follicular"
}

func max0(v int) int {
	if v < 0 {
		return 0
	}
	return v
}

// sortIntsAsc 简单升序（避免为一个小排序引入 sort 依赖到本文件）
func sortIntsAsc(xs []int) {
	for i := 1; i < len(xs); i++ {
		for j := i; j > 0 && xs[j] < xs[j-1]; j-- {
			xs[j], xs[j-1] = xs[j-1], xs[j]
		}
	}
}

// sortPeriodFreq 频次降序（同频次按 key 升序，输出稳定）
func sortPeriodFreq(xs []dto.PeriodSymptomFreq) {
	for i := 1; i < len(xs); i++ {
		for j := i; j > 0; j-- {
			less := xs[j].Count > xs[j-1].Count ||
				(xs[j].Count == xs[j-1].Count && xs[j].Key < xs[j-1].Key)
			if !less {
				break
			}
			xs[j], xs[j-1] = xs[j-1], xs[j]
		}
	}
}

// ============================================================================
// RebuildCycles —— 幂等派生（02 §2）
// ============================================================================

// rebuildPeriodCyclesTx 在指定事务内重算周期表；返回「周期划分是否发生变化」
func rebuildPeriodCyclesTx(ctx context.Context, tx *gorm.DB, uid string) (bool, error) {
	var days []model.PeriodDay
	if err := tx.Where("user_id = ?", uid).Order("date ASC").Find(&days).Error; err != nil {
		return false, err
	}
	var existing []model.PeriodCycle
	if err := tx.Where("user_id = ?", uid).Order("start_date ASC").Find(&existing).Error; err != nil {
		return false, err
	}
	before := periodCycleSignature(existing)

	dayInputs := periodDayInputs(days)
	groups := utility.GroupBleedingDays(dayInputs)

	// ⚠️ 体温取自 health_days（2026-09-19 从 period_days 迁出，见 md/spec-20260919-v1/04 §6）。
	//    漏掉这段**不会报错、不会 panic**，只是体温法永远判定「无数据」→
	//    排卵日永远停留在算法推算值、ovulation_source 永远是 1、黄体期永远用默认 14 天。
	//    这类静默失效比报错难查一百倍，别删。
	bbtByDate, err := loadBBTByDate(ctx, tx, uid)
	if err != nil {
		return false, err
	}

	// 人工修正过的周期 → 其 start/end 以人工值为准，只在容差内认领所属出血组
	type wantCycle struct {
		start  time.Time
		end    time.Time
		plen   int
		manual *model.PeriodCycle
	}
	usedManual := map[string]bool{}
	want := make([]wantCycle, 0, len(groups))
	for _, g := range groups {
		var m *model.PeriodCycle
		for i := range existing {
			if existing[i].IsManual != 1 || usedManual[existing[i].ID] {
				continue
			}
			ms := utility.TruncateDate(existing[i].StartDate)
			if !ms.Before(g.StartDate.AddDate(0, 0, -periodManualClaimDays)) &&
				!ms.After(g.EndDate.AddDate(0, 0, periodManualClaimDays)) {
				m = &existing[i]
				usedManual[existing[i].ID] = true
				break
			}
		}
		if m != nil {
			end := g.EndDate
			if m.EndDate != nil {
				end = utility.TruncateDate(*m.EndDate)
			}
			want = append(want, wantCycle{start: utility.TruncateDate(m.StartDate), end: end, plen: g.PeriodLength, manual: m})
			continue
		}
		want = append(want, wantCycle{start: g.StartDate, end: g.EndDate, plen: g.PeriodLength})
	}

	// 保留集合：全部人工周期 + 起点仍在结果里的自动周期
	wantStarts := map[string]bool{}
	for _, w := range want {
		wantStarts[utility.DateStr(w.start)] = true
	}
	keep := map[string]bool{}
	for i := range existing {
		if existing[i].IsManual == 1 ||
			wantStarts[utility.DateStr(utility.TruncateDate(existing[i].StartDate))] {
			keep[existing[i].ID] = true
		}
	}

	now := periodToday()
	for i, w := range want {
		// cycle_length：本次 start − 上次 start；首个为 NULL；
		// 相邻间隔 > 90 天 → NULL（避免把「忘记录」当成「超长周期」，03 §13）
		var cl *int
		if i > 0 {
			if d := utility.DaysBetween(want[i-1].start, w.start); d > 0 && d <= utility.PeriodGapDays {
				v := d
				cl = &v
			}
		}

		// 排卵日：用户手动标记优先；否则用体温法事后确认（03 §8）
		var ovDate *time.Time
		ovSource := model.OvulationSourceNone
		if w.manual != nil && w.manual.OvulationSource == model.OvulationSourceManual {
			ovDate, ovSource = w.manual.OvulationDate, model.OvulationSourceManual
		} else {
			winEnd := now
			if i+1 < len(want) {
				winEnd = want[i+1].start.AddDate(0, 0, -1)
			} else if cap := w.start.AddDate(0, 0, periodLastCycleBBTCapDays); cap.Before(winEnd) {
				winEnd = cap
			}
			if ov := utility.DetectOvulationByBBT(w.start, winEnd, dayInputs, bbtByDate); ov != nil {
				ovDate, ovSource = ov, model.OvulationSourceBBT
			}
		}

		end := w.end
		row := &model.PeriodCycle{
			ID: utility.NewID("pc"), UserID: uid, StartDate: w.start, EndDate: &end,
			PeriodLength: w.plen, CycleLength: cl, OvulationDate: ovDate, OvulationSource: ovSource,
		}
		if err := tx.Clauses(clause.OnConflict{
			Columns: []clause.Column{{Name: "user_id"}, {Name: "start_date"}},
			// ⚠️ 不含 is_manual / note / start_date：人工标记一旦置 1，派生流程不应把它抹掉
			DoUpdates: clause.AssignmentColumns([]string{
				"end_date", "period_length", "cycle_length",
				"ovulation_date", "ovulation_source", "updated_at",
			}),
		}).Create(row).Error; err != nil {
			return false, err
		}
	}

	// 删掉不再成立的自动周期（人工周期永不删）
	for i := range existing {
		if keep[existing[i].ID] {
			continue
		}
		if err := tx.Where("id = ?", existing[i].ID).Delete(&model.PeriodCycle{}).Error; err != nil {
			return false, err
		}
	}

	var after []model.PeriodCycle
	if err := tx.Where("user_id = ?", uid).Order("start_date ASC").Find(&after).Error; err != nil {
		return false, err
	}
	return before != periodCycleSignature(after), nil
}

// rebuildPeriodCycles 独立事务版本（供 PatchCycle 使用）
func rebuildPeriodCycles(ctx context.Context, uid string) error {
	err := dao.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		_, err := rebuildPeriodCyclesTx(ctx, tx, uid)
		return err
	})
	if err != nil {
		return wrapPeriodTxError(err, "重算周期失败")
	}
	return nil
}

// periodCycleSignature 周期集合指纹，用于判断 RebuildCycles 是否真的改了东西
func periodCycleSignature(cycles []model.PeriodCycle) string {
	var b strings.Builder
	for i := range cycles {
		c := cycles[i]
		end := ""
		if c.EndDate != nil {
			end = utility.DateStr(*c.EndDate)
		}
		cl := "-"
		if c.CycleLength != nil {
			cl = itoa(*c.CycleLength)
		}
		b.WriteString(utility.DateStr(c.StartDate))
		b.WriteString("|")
		b.WriteString(end)
		b.WriteString("|")
		b.WriteString(itoa(c.PeriodLength))
		b.WriteString("|")
		b.WriteString(cl)
		b.WriteString("|")
		b.WriteString(itoa(c.OvulationSource))
		b.WriteString("|")
		b.WriteString(itoa(c.IsManual))
		b.WriteString(";")
	}
	return b.String()
}

// ============================================================================
// 预测装配
// ============================================================================

// computePeriodPrediction 加载设置 / 周期 / 近一年逐日记录，算出预测对象
func computePeriodPrediction(ctx context.Context, uid string, today time.Time) (*dto.PeriodPrediction, []model.PeriodCycle, error) {
	cycles, err := dao.PeriodCycle.ListAllByUser(ctx, uid)
	if err != nil {
		return nil, nil, gerror.WrapCode(ecode.DatabaseError, err, "查询周期失败")
	}
	st, err := ensurePeriodSettings(ctx, uid)
	if err != nil {
		return nil, nil, err
	}
	days, err := dao.PeriodDay.ListByRange(ctx, uid, today.AddDate(-1, 0, 0), today)
	if err != nil {
		return nil, nil, gerror.WrapCode(ecode.DatabaseError, err, "查询经期记录失败")
	}

	inputs := periodCycleInputs(cycles)
	// 边界（03 §13）：只填了 last_period_start、没有任何逐日记录 → 视为 1 个不完整周期，
	// confidence = low，用 settings.avg_cycle_length 预测（前端标注「基于默认 N 天周期」）
	if len(inputs) == 0 && st.LastPeriodStart != nil {
		inputs = []utility.PeriodCycleInput{{
			StartDate:    utility.TruncateDate(*st.LastPeriodStart),
			PeriodLength: st.AvgPeriodLength,
		}}
	}

	pred := utility.ComputePeriodPrediction(today, inputs, periodDayInputs(days), periodAlgoSettings(st))
	return pred, cycles, nil
}

// periodAlgoSettings 设置行 → 算法入参
func periodAlgoSettings(st *model.PeriodSetting) utility.PeriodAlgoSettings {
	return utility.PeriodAlgoSettings{
		AvgCycleLength:    st.AvgCycleLength,
		AvgPeriodLength:   st.AvgPeriodLength,
		LutealLength:      st.LutealLength,
		ShowFertileWindow: st.ShowFertileWindow != 0,
		IrregularAlert:    st.IrregularAlert != 0,
	}
}

func periodCycleInputs(cycles []model.PeriodCycle) []utility.PeriodCycleInput {
	out := make([]utility.PeriodCycleInput, 0, len(cycles))
	for i := range cycles {
		out = append(out, utility.PeriodCycleInput{
			StartDate:       utility.TruncateDate(cycles[i].StartDate),
			EndDate:         cycles[i].EndDate,
			PeriodLength:    cycles[i].PeriodLength,
			CycleLength:     cycles[i].CycleLength,
			OvulationDate:   cycles[i].OvulationDate,
			OvulationSource: cycles[i].OvulationSource,
		})
	}
	return out
}

func periodDayInputs(days []model.PeriodDay) []utility.PeriodDayInput {
	out := make([]utility.PeriodDayInput, 0, len(days))
	for i := range days {
		out = append(out, utility.PeriodDayInput{
			Date:     days[i].Date,
			Flow:     days[i].Flow,
			BBT:      days[i].BBT,
			Symptoms: days[i].Symptoms,
		})
	}
	return out
}

// ============================================================================
// 装配 / 校验工具
// ============================================================================

// loadBBTByDate 从 health_days 取该用户的基础体温（date 字符串 → ℃）
//
// ⚠️ 体温的**唯一真源**是 health_days.bbt（2026-09-19 从 period_days 迁出）。
//
//	过渡期 period_days 仍有旧列（双写），但读取一律以本函数的结果为准。
func loadBBTByDate(ctx context.Context, db *gorm.DB, uid string) (map[string]float64, error) {
	var days []model.HealthDay
	if err := db.WithContext(ctx).
		Select("date", "bbt").
		Where("user_id = ? AND bbt IS NOT NULL", uid).
		Find(&days).Error; err != nil {
		return nil, err
	}
	out := make(map[string]float64, len(days))
	for _, d := range days {
		if d.BBT == nil {
			continue
		}
		out[utility.DateStr(d.Date)] = *d.BBT
	}
	return out, nil
}

// ensurePeriodSettings 取设置行，不存在则懒创建（全默认值）
func ensurePeriodSettings(ctx context.Context, uid string) (*model.PeriodSetting, error) {
	st, err := dao.PeriodSetting.GetByUser(ctx, uid)
	if err == nil {
		return st, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "查询经期设置失败")
	}
	row := &model.PeriodSetting{
		ID:                utility.NewID("ps"),
		UserID:            uid,
		AvgCycleLength:    model.DefaultCycleLength,
		AvgPeriodLength:   model.DefaultPeriodLength,
		LutealLength:      model.DefaultLutealLength,
		Goal:              model.GoalTrack,
		ShowFertileWindow: 1,
		IrregularAlert:    1,
	}
	if err := dao.PeriodSetting.Create(ctx, row); err != nil {
		// 并发首次访问可能撞唯一键 → 重查一次即可
		if again, e2 := dao.PeriodSetting.GetByUser(ctx, uid); e2 == nil {
			return again, nil
		}
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "初始化经期设置失败")
	}
	return row, nil
}

// loadDayAndMood 取某天的 period_days 与 mood_logs 行（都不存在时返回两个 nil）
func loadDayAndMood(ctx context.Context, uid string, date time.Time) (*model.PeriodDay, *model.MoodLog, error) {
	day, err := dao.PeriodDay.GetByUserDate(ctx, uid, date)
	if err != nil {
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil, gerror.WrapCode(ecode.DatabaseError, err, "查询经期记录失败")
		}
		day = nil
	}
	// 只取日记槽位（hour = 12）：记录页按小时记的心情不该出现在经期日记里
	mood, err := dao.MoodLog.GetByUserDateHour(ctx, uid, date, model.MoodDiaryHour)
	if err != nil {
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil, gerror.WrapCode(ecode.DatabaseError, err, "查询心情记录失败")
		}
		mood = nil
	}
	return day, mood, nil
}

// loadRangeDetails 区间内「两表并集」的日记（key = YYYY-MM-DD）
func loadRangeDetails(ctx context.Context, uid string, start, end time.Time) (map[string]*dto.PeriodDayDetail, error) {
	days, err := dao.PeriodDay.ListByRange(ctx, uid, start, end)
	if err != nil {
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "查询经期记录失败")
	}
	// mood_logs 的区间查询是左闭右开；只取日记槽位（hour = 12），
	// 否则同一天会出现多行、map 互相覆盖，经期日记的心情会变成「当天最后一小时」的值
	moods, err := dao.MoodLog.ListDiaryByRange(ctx, uid, start, end.AddDate(0, 0, 1))
	if err != nil {
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "查询心情记录失败")
	}

	dayByDate := map[string]*model.PeriodDay{}
	for i := range days {
		dayByDate[utility.DateStr(days[i].Date)] = &days[i]
	}
	moodByDate := map[string]*model.MoodLog{}
	for i := range moods {
		moodByDate[utility.DateStr(moods[i].Date)] = &moods[i]
	}

	out := map[string]*dto.PeriodDayDetail{}
	for d := start; !d.After(end); d = d.AddDate(0, 0, 1) {
		ds := utility.DateStr(d)
		detail := periodDayDetail(dayByDate[ds], moodByDate[ds])
		if detail == nil {
			continue
		}
		out[ds] = detail
	}
	return out, nil
}

// periodDayDetail 组装一天的日记（period_days ∪ mood_logs）；两行都没有时返回 nil
func periodDayDetail(day *model.PeriodDay, mood *model.MoodLog) *dto.PeriodDayDetail {
	if day == nil && mood == nil {
		return nil
	}
	out := &dto.PeriodDayDetail{Symptoms: []string{}}
	if day != nil {
		out.Date = utility.DateStr(day.Date)
		out.Flow = day.Flow
		if len(day.Symptoms) > 0 {
			out.Symptoms = append(out.Symptoms, day.Symptoms...)
		}
		out.PainLevel = day.PainLevel
		out.Discharge = day.Discharge
		out.BBT = day.BBT
		out.Weight = day.Weight
		out.SleepHours = day.SleepHours
		out.Intercourse = day.Intercourse
	}
	if mood != nil {
		if out.Date == "" {
			out.Date = utility.DateStr(mood.Date)
		}
		m := mood.Mood
		out.Mood = &m
		if mood.Energy != nil {
			e := *mood.Energy
			out.Energy = &e
		}
		if mood.Note != nil {
			out.Note = *mood.Note
		}
	}
	return out
}

// periodCycleToResp 周期实体 → 响应（gap / suspect 是派生标记，不落库）
func periodCycleToResp(c *model.PeriodCycle) *dto.PeriodCycleResp {
	out := &dto.PeriodCycleResp{
		ID:              c.ID,
		StartDate:       utility.DateStr(c.StartDate),
		PeriodLength:    c.PeriodLength,
		CycleLength:     c.CycleLength,
		IsOngoing:       c.IsOngoing(),
		IsManual:        c.IsManual == 1,
		OvulationSource: c.OvulationSource,
		Gap:             c.HasGap(),
		Suspect:         c.IsSuspect(),
		Note:            c.Note,
	}
	if c.EndDate != nil {
		out.EndDate = utility.DateStr(*c.EndDate)
	}
	if c.OvulationDate != nil {
		out.OvulationDate = utility.DateStr(*c.OvulationDate)
	}
	return out
}

// periodSettingsToResp 设置实体 → 响应
func periodSettingsToResp(st *model.PeriodSetting) *dto.PeriodSettingsResp {
	out := &dto.PeriodSettingsResp{
		AvgCycleLength:    st.AvgCycleLength,
		AvgPeriodLength:   st.AvgPeriodLength,
		LutealLength:      st.LutealLength,
		Goal:              st.Goal,
		ShowFertileWindow: st.ShowFertileWindow,
		IrregularAlert:    st.IrregularAlert,
	}
	if st.LastPeriodStart != nil {
		out.LastPeriodStart = utility.DateStr(*st.LastPeriodStart)
	}
	if st.DisclaimerAcceptedAt != nil {
		out.DisclaimerAcceptedAt = st.DisclaimerAcceptedAt.Format(time.RFC3339)
	}
	return out
}

// resolvePeriodDate 解析请求里的日期；allowEmpty 时回落到今天
func resolvePeriodDate(s string, allowEmpty bool) (time.Time, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		if allowEmpty {
			return periodToday(), nil
		}
		return time.Time{}, gerror.NewCode(ecode.ValidationFailed)
	}
	d, err := utility.ParseDate(s)
	if err != nil {
		return time.Time{}, gerror.NewCode(ecode.PeriodDateOutOfRange)
	}
	return utility.TruncateDate(d), nil
}

// validateRecordableDate 日期窗口：不晚于「今天 + 1 天」，不早于「今天 − 5 年」
func validateRecordableDate(d, today time.Time) error {
	if d.After(today.AddDate(0, 0, periodFutureToleranceDays)) ||
		d.Before(today.AddDate(-periodMaxBackYears, 0, 0)) {
		return gerror.NewCode(ecode.PeriodDateOutOfRange)
	}
	return nil
}

// validateDayValues 数值字段校验（05 §5 校验表）
func validateDayValues(req *dto.UpsertPeriodDayReq) error {
	if req.Flow < model.FlowMin || req.Flow > model.FlowMax {
		return gerror.NewCode(ecode.PeriodFlowInvalid)
	}
	if req.PainLevel < model.PainLevelMin || req.PainLevel > model.PainLevelMax {
		return gerror.NewCode(ecode.PeriodPainInvalid)
	}
	if req.Discharge < model.DischargeMin || req.Discharge > model.DischargeMax {
		return gerror.NewCode(ecode.PeriodDischargeInvalid)
	}
	if req.Intercourse < model.IntercourseMin || req.Intercourse > model.IntercourseMax {
		return gerror.NewCode(ecode.PeriodIntercourseInvalid)
	}
	if req.BBT != nil && (*req.BBT < model.BBTMin || *req.BBT > model.BBTMax) {
		return gerror.NewCode(ecode.PeriodBBTInvalid)
	}
	if req.Weight != nil && (*req.Weight < model.WeightMin || *req.Weight > model.WeightMax) {
		return gerror.NewCode(ecode.PeriodWeightInvalid)
	}
	if req.SleepHours != nil && (*req.SleepHours < model.SleepHoursMin || *req.SleepHours > model.SleepHoursMax) {
		return gerror.NewCode(ecode.PeriodSleepInvalid)
	}
	if req.Mood != nil && *req.Mood != 0 && (*req.Mood < model.MoodMin || *req.Mood > model.MoodMax) {
		return gerror.NewCode(ecode.MoodValueInvalid)
	}
	if req.Energy != nil && *req.Energy != 0 && (*req.Energy < model.EnergyMin || *req.Energy > model.EnergyMax) {
		return gerror.NewCode(ecode.MoodEnergyInvalid)
	}
	if req.Note != nil && len([]rune(strings.TrimSpace(*req.Note))) > 50 {
		return gerror.NewCode(ecode.MoodNoteTooLong)
	}
	return nil
}

// filterPeriodSymptoms 未知 key 静默丢弃并记 warn
// （前端版本更新不同步时不至于整单失败，见 05 §5）
func filterPeriodSymptoms(ctx context.Context, in []string) []string {
	out := make([]string, 0, len(in))
	seen := map[string]bool{}
	for _, k := range in {
		k = strings.TrimSpace(k)
		if k == "" || seen[k] {
			continue
		}
		if !utility.PeriodSymptomValid(k) {
			g.Log("warn").Warningf(ctx, "period: 未知症状 key 已丢弃 key=%s", k)
			continue
		}
		seen[k] = true
		out = append(out, k)
	}
	return out
}

// wrapPeriodTxError 事务错误包装：保留业务错误码，其余包成 DATABASE_ERROR
// （与 controller.writeError 同一套解包方式，避免业务码在事务里被吞掉）
func wrapPeriodTxError(err error, msg string) error {
	if err == nil {
		return nil
	}
	if gerr, ok := err.(*gerror.Error); ok && gerr.Code() != nil {
		if bc, ok := gerr.Code().(ecode.BusinessCode); ok && bc.CodeValue != 0 {
			return err
		}
	}
	return gerror.WrapCode(ecode.DatabaseError, err, msg)
}

func boolToTiny(b bool) int {
	if b {
		return 1
	}
	return 0
}

// itoa 小整数转字符串（避免为签名引入 strconv 依赖链）
func itoa(v int) string {
	if v == 0 {
		return "0"
	}
	neg := v < 0
	if neg {
		v = -v
	}
	var buf [20]byte
	i := len(buf)
	for v > 0 {
		i--
		buf[i] = byte('0' + v%10)
		v /= 10
	}
	if neg {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}

// periodToday 服务端当天（归零）
func periodToday() time.Time { return utility.TruncateDate(time.Now()) }
