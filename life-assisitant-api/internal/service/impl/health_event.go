// 健康模块：身体指标**时间轴事件**的服务实现（health_events）
//
// ⚠️ 本文件是身体指标（water / bbt / weight / sleep / bowel）的**唯一写入路径**。
// PUT /health/days/:date 已经不再处理这五项（见 UpsertDay 的注释）。
//
// ⚠️ 最重要的约束：**写 events 必须同一事务内重算 health_days 日汇总**。
// health_days 是概览卡 / 经期预测的高频读路径，不能每次实时 SUM events；
// 但如果重算漏了，两边会漂 —— 「时间轴显示喝了 1200ml，概览卡还是 800ml」。
// 所以 CreateEvent / PatchEvent / DeleteEvent 三个入口都要走 recomputeDaySummary。
package impl

import (
	"context"
	"strings"
	"time"

	"github.com/gogf/gf/v2/errors/gerror"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"github.com/life-assistant/api/internal/consts/ecode"
	"github.com/life-assistant/api/internal/dao"
	"github.com/life-assistant/api/internal/model"
	"github.com/life-assistant/api/internal/model/dto"
	"github.com/life-assistant/api/internal/utility"
)

// ============================================================================
// GET /health/events
// ============================================================================

// ListEvents 时间轴明细
//
// date 与 (start, end) 二选一；都没给 → 默认今天。
// 给了 metric_key 就按指标过滤（统计曲线用）。
func (s *HealthService) ListEvents(ctx context.Context, req *dto.ListHealthEventsReq) (*dto.ListHealthEventsResp, error) {
	uid := ctxUserID(ctx)
	if uid == "" {
		return nil, gerror.NewCode(ecode.AuthTokenMissing)
	}

	var start, end time.Time
	var single bool // 是否单日查询（是则返回 summary）
	switch {
	case strings.TrimSpace(req.Date) != "":
		d, err := utility.ParseDate(strings.TrimSpace(req.Date))
		if err != nil {
			return nil, gerror.NewCode(ecode.ValidationFailed)
		}
		start, end = utility.TruncateDate(d), utility.TruncateDate(d)
		single = true
	case strings.TrimSpace(req.Start) != "" && strings.TrimSpace(req.End) != "":
		a, e1 := utility.ParseDate(strings.TrimSpace(req.Start))
		b, e2 := utility.ParseDate(strings.TrimSpace(req.End))
		if e1 != nil || e2 != nil {
			return nil, gerror.NewCode(ecode.ValidationFailed)
		}
		start, end = utility.TruncateDate(a), utility.TruncateDate(b)
		if end.Before(start) {
			return nil, gerror.NewCode(ecode.ValidationFailed)
		}
		if int(end.Sub(start).Hours()/24) > 366 {
			return nil, gerror.NewCode(ecode.ValidationFailed)
		}
	default:
		t := utility.TruncateDate(time.Now())
		start, end = t, t
		single = true
	}

	var items []model.HealthEvent
	var err error
	if mk := strings.TrimSpace(req.MetricKey); mk != "" {
		if !model.IsKnownMetricKey(mk) {
			return nil, gerror.NewCode(ecode.ValidationFailed)
		}
		items, err = dao.HealthEvent.ListByMetricRange(ctx, uid, mk, start, end)
	} else {
		items, err = dao.HealthEvent.ListByRange(ctx, uid, start, end)
	}
	if err != nil {
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "查询健康事件失败")
	}

	out := make([]dto.HealthEventItem, 0, len(items))
	for i := range items {
		out = append(out, healthEventToItem(items[i]))
	}

	resp := &dto.ListHealthEventsResp{Items: out, Total: len(out)}
	if single {
		sum := summarizeEvents(utility.DateStr(start), items)
		resp.Summary = sum
	}
	return resp, nil
}

// ============================================================================
// POST /health/events
// ============================================================================

// CreateEvent 追加一次记录
//
// ⚠️ time 不传时取**服务端当前时刻**，不让前端传（客户端时钟可能不准 / 跨时区）。
func (s *HealthService) CreateEvent(ctx context.Context, req *dto.CreateHealthEventReq) (*dto.CreateHealthEventResp, error) {
	uid := ctxUserID(ctx)
	if uid == "" {
		return nil, gerror.NewCode(ecode.AuthTokenMissing)
	}

	date, err := utility.ParseDate(strings.TrimSpace(req.Date))
	if err != nil {
		return nil, gerror.NewCode(ecode.ValidationFailed)
	}
	date = utility.TruncateDate(date)
	today := utility.TruncateDate(time.Now())
	if err := validateRecordableDate(date, today); err != nil {
		return nil, err
	}

	key := strings.TrimSpace(req.MetricKey)
	if !model.IsKnownMetricKey(key) {
		return nil, gerror.NewCode(ecode.ValidationFailed)
	}
	if err := validateHealthEvent(key, req.ValueNum, req.ValueInt); err != nil {
		return nil, err
	}

	tod := strings.TrimSpace(req.Time)
	if tod == "" {
		tod = time.Now().Format("15:04")
	}
	if len(tod) != 5 || tod[2] != ':' {
		return nil, gerror.NewCode(ecode.ValidationFailed)
	}

	ev := &model.HealthEvent{
		ID:        utility.NewID("he"),
		UserID:    uid,
		Date:      date,
		TimeOfDay: tod,
		MetricKey: key,
		ValueNum:  req.ValueNum,
		ValueInt:  req.ValueInt,
		Note:      strings.TrimSpace(req.Note),
	}

	err = dao.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(ev).Error; err != nil {
			return err
		}
		// 体温影响排卵判定 → 只有 bbt 才需要重算周期（喝水/排便重算周期是白烧 CPU）
		rebuild := key == model.MetricKeyBBT
		return recomputeDaySummaryTx(ctx, tx, uid, date, rebuild)
	})
	if err != nil {
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "保存健康记录失败")
	}

	return buildEventResp(ctx, uid, date, ev)
}

// ============================================================================
// PATCH /health/events/:id
// ============================================================================

// PatchEvent 改某一次记录
//
// ⚠️ date 与 metric_key **不可改** —— 改了等于把这条记录挪到别的天 / 变成别的指标，
// 那种操作应该走「删除 + 新建」，语义更直白。
func (s *HealthService) PatchEvent(ctx context.Context, req *dto.PatchHealthEventReq) (*dto.PatchHealthEventResp, error) {
	uid := ctxUserID(ctx)
	if uid == "" {
		return nil, gerror.NewCode(ecode.AuthTokenMissing)
	}
	id := strings.TrimSpace(req.ID)
	if id == "" {
		return nil, gerror.NewCode(ecode.ValidationFailed)
	}

	ev, err := dao.HealthEvent.GetByID(ctx, id, uid)
	if err != nil {
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "查询健康记录失败")
	}
	if ev == nil {
		return nil, gerror.NewCode(ecode.ResourceNotFound)
	}

	if req.Time != nil {
		tod := strings.TrimSpace(*req.Time)
		if len(tod) != 5 || tod[2] != ':' {
			return nil, gerror.NewCode(ecode.ValidationFailed)
		}
		ev.TimeOfDay = tod
	}
	if req.Note != nil {
		ev.Note = strings.TrimSpace(*req.Note)
		if len([]rune(ev.Note)) > 200 {
			ev.Note = string([]rune(ev.Note)[:200])
		}
	}
	// ⚠️ 取值校验要用**合并后**的值：只给了 value_num 时 value_int 保持原值，
	// 反之亦然。分开校验会出现「改了水量，却因为形态是旧值而误判越界」。
	if req.ValueNum != nil || req.ValueInt != nil {
		if req.ValueNum != nil {
			ev.ValueNum = req.ValueNum
		}
		if req.ValueInt != nil {
			ev.ValueInt = req.ValueInt
		}
		if err := validateHealthEvent(ev.MetricKey, ev.ValueNum, ev.ValueInt); err != nil {
			return nil, err
		}
	}

	date := utility.TruncateDate(ev.Date)
	err = dao.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(ev).Select("time_of_day", "value_num", "value_int", "note", "updated_at").
			Where("id = ? AND user_id = ?", ev.ID, uid).Updates(ev).Error; err != nil {
			return err
		}
		rebuild := ev.MetricKey == model.MetricKeyBBT
		return recomputeDaySummaryTx(ctx, tx, uid, date, rebuild)
	})
	if err != nil {
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "保存健康记录失败")
	}

	resp, err := buildEventResp(ctx, uid, date, ev)
	if err != nil {
		return nil, err
	}
	return &dto.PatchHealthEventResp{
		Item:    resp.Item,
		Summary: resp.Summary,
		Day:     resp.Day,
	}, nil
}

// ============================================================================
// DELETE /health/events/:id
// ============================================================================

// DeleteEvent 删某一次记录（返回删完之后的当日汇总，前端不必二次请求）
func (s *HealthService) DeleteEvent(ctx context.Context, id string) (*dto.HealthEventDaySummary, error) {
	uid := ctxUserID(ctx)
	if uid == "" {
		return nil, gerror.NewCode(ecode.AuthTokenMissing)
	}
	id = strings.TrimSpace(id)
	if id == "" {
		return nil, gerror.NewCode(ecode.ValidationFailed)
	}

	ev, err := dao.HealthEvent.GetByID(ctx, id, uid)
	if err != nil {
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "查询健康记录失败")
	}
	if ev == nil {
		return nil, gerror.NewCode(ecode.ResourceNotFound)
	}
	date := utility.TruncateDate(ev.Date)
	key := ev.MetricKey

	if err := dao.HealthEvent.Delete(ctx, id, uid); err != nil {
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "删除健康记录失败")
	}

	err = dao.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		rebuild := key == model.MetricKeyBBT
		return recomputeDaySummaryTx(ctx, tx, uid, date, rebuild)
	})
	if err != nil {
		return nil, err
	}

	items, err := dao.HealthEvent.ListByDate(ctx, uid, date)
	if err != nil {
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "查询健康记录失败")
	}
	return summarizeEvents(utility.DateStr(date), items), nil
}

// ============================================================================
// 内部：日汇总重算（本文件最关键的函数）
// ============================================================================

// recomputeDaySummaryTx 在**给定事务内**把当天所有 events 聚合成 health_days 一行
//
// 聚合口径（各指标语义不同，别统一用 SUM 或 LAST）：
//
//	water  → SUM（一天喝的总和才有意义）
//	bowel  → COUNT（次数）+ 形态取**最后一次**（日级单一形态只是兼容列，分布从 events 算）
//	weight → **最早一次**（晨起口径，与 bbt 一致；一天称多次取最早那条）
//	bbt    → **最早一次**（基础体温是晨起测的，取最早才对得上「基础」二字）
//	sleep  → 最后一次
//
// ⚠️ 全空 → **删掉** health_days 行，不留空行（否则 HasAnyValue() 会把空行算成「已记录」，
// 日历上出现一个没有任何分类颜色的灰点）。
//
// ⚠️ 必须在事务里调：events 写完立刻重算，中间不允许被别的请求插队，否则会漂。
func recomputeDaySummaryTx(ctx context.Context, tx *gorm.DB, uid string, date time.Time, rebuildCycles bool) error {
	ds := utility.DateStr(date)

	var items []model.HealthEvent
	if err := tx.Where("user_id = ? AND date = ?", uid, ds).
		Order("time_of_day ASC, id ASC").
		Find(&items).Error; err != nil {
		return err
	}

	var (
		waterML    int
		bowelTimes int
		bowelTypes []int
		weightKG   *float64
		bbt        *float64
		sleepHours *float64
	)
	for i := range items {
		e := items[i]
		switch e.MetricKey {
		case model.MetricKeyWater:
			if e.ValueNum != nil && *e.ValueNum > 0 {
				waterML += int(*e.ValueNum)
			}
		case model.MetricKeyBowel:
			// ⚠️ 次数**无条件**累加：用户可能只记了「拉了一次」没选形态
			// （value_int 为 NULL），那也算一次，不能因为没形态就把次数丢了。
			// 形态单独收集，日级的 bowel_type 取最后一个**已知**形态。
			bowelTimes++
			if e.ValueInt != nil && *e.ValueInt > 0 {
				bowelTypes = append(bowelTypes, *e.ValueInt)
			}
		case model.MetricKeyWeight:
			// 最早一次：与 bbt 统一为晨起口径（一天称多次取最早那条，老大拍板 260920）
			if e.ValueNum != nil && weightKG == nil {
				v := *e.ValueNum
				weightKG = &v
			}
		case model.MetricKeyBBT:
			// 最早一次：只第一次赋值，后面的覆盖不了
			if e.ValueNum != nil && bbt == nil {
				v := *e.ValueNum
				bbt = &v
			}
		case model.MetricKeySleep:
			if e.ValueNum != nil {
				v := *e.ValueNum
				sleepHours = &v
			}
		}
	}

	bowelType := 0
	if n := len(bowelTypes); n > 0 {
		bowelType = bowelTypes[n-1]
	}
	empty := waterML == 0 && bowelTimes == 0 && weightKG == nil && bbt == nil && sleepHours == nil

	if empty {
		if err := tx.Where("user_id = ? AND date = ?", uid, ds).
			Delete(&model.HealthDay{}).Error; err != nil {
			return err
		}
	} else {
		row := &model.HealthDay{
			ID: utility.NewID("hd"), UserID: uid, Date: date,
			WaterML:    waterML,
			WeightKG:   weightKG,
			BBT:        bbt,
			SleepHours: sleepHours,
			BowelCount: bowelTimes,
			BowelType:  bowelType,
		}
		if err := tx.Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "user_id"}, {Name: "date"}},
			DoUpdates: clause.AssignmentColumns(healthDayUpdatableColumns),
		}).Create(row).Error; err != nil {
			return err
		}
	}

	// 体温变了 → 排卵判定可能变 → 重算周期。
	// ⚠️ 只有 bbt 才走：喝水 / 排便 / 体重重算周期是纯浪费。
	if rebuildCycles {
		if _, err := rebuildPeriodCyclesTx(ctx, tx, uid); err != nil {
			return err
		}
	}
	return nil
}

// summarizeEvents 把一批 events 聚合成当日汇总（响应体用，不落库）
//
// ⚠️ 聚合口径必须与 recomputeDaySummaryTx **逐条一致**，
// 否则会出现「接口返回的 summary 和库里 health_days 不一致」。
func summarizeEvents(date string, items []model.HealthEvent) *dto.HealthEventDaySummary {
	out := &dto.HealthEventDaySummary{Date: date, BowelTypes: []int{}}
	for i := range items {
		e := items[i]
		switch e.MetricKey {
		case model.MetricKeyWater:
			if e.ValueNum != nil && *e.ValueNum > 0 {
				out.WaterML += int(*e.ValueNum)
				out.WaterTimes++
			}
		case model.MetricKeyBowel:
			// 次数无条件累加（口径与 recomputeDaySummaryTx 一致，见那里的注释）
			out.BowelTimes++
			if e.ValueInt != nil && *e.ValueInt > 0 {
				out.BowelTypes = append(out.BowelTypes, *e.ValueInt)
			}
		case model.MetricKeyWeight:
			// 与 recomputeDaySummaryTx 一致：取最早一次（晨起口径）
			if e.ValueNum != nil && out.WeightKG == nil {
				v := *e.ValueNum
				out.WeightKG = &v
			}
		case model.MetricKeyBBT:
			if e.ValueNum != nil && out.BBT == nil {
				v := *e.ValueNum
				out.BBT = &v
			}
		case model.MetricKeySleep:
			if e.ValueNum != nil {
				v := *e.ValueNum
				out.SleepHours = &v
			}
		}
	}
	return out
}

// ============================================================================
// 内部：校验与装配
// ============================================================================

// validateHealthEvent 按指标类型校验取值
//
// ⚠️ 每个指标的边界不同，别写成一组统一判断：
//
//	water  0–10000 ml（超过只提示不阻断，出现「我真的喝了这么多却不让我记」很糟）
//	bbt    34.00–42.00 ℃
//	weight 20.00–300.00 kg
//	sleep  0.0–24.0 h
//	bowel  形态 1–4（model.BowelType*）
func validateHealthEvent(key string, num *float64, iv *int) error {
	switch key {
	case model.MetricKeyWater:
		if num == nil {
			return gerror.NewCode(ecode.ValidationFailed)
		}
		if *num < float64(model.WaterMLMin) || *num > float64(model.WaterMLMax) {
			return gerror.NewCode(ecode.ValidationFailed)
		}
	case model.MetricKeyBBT:
		if num == nil {
			return gerror.NewCode(ecode.ValidationFailed)
		}
		if *num < model.BBTMin || *num > model.BBTMax {
			return gerror.NewCode(ecode.ValidationFailed)
		}
	case model.MetricKeyWeight:
		if num == nil {
			return gerror.NewCode(ecode.ValidationFailed)
		}
		if *num < model.WeightMin || *num > model.WeightMax {
			return gerror.NewCode(ecode.ValidationFailed)
		}
	case model.MetricKeySleep:
		if num == nil {
			return gerror.NewCode(ecode.ValidationFailed)
		}
		if *num < model.SleepHoursMin || *num > model.SleepHoursMax {
			return gerror.NewCode(ecode.ValidationFailed)
		}
	case model.MetricKeyBowel:
		if iv == nil {
			return gerror.NewCode(ecode.ValidationFailed)
		}
		if *iv < model.BowelTypeOK || *iv > model.BowelTypeMax {
			return gerror.NewCode(ecode.ValidationFailed)
		}
	default:
		return gerror.NewCode(ecode.ValidationFailed)
	}
	return nil
}

func healthEventToItem(e model.HealthEvent) dto.HealthEventItem {
	return dto.HealthEventItem{
		ID:        e.ID,
		Date:      utility.DateStr(e.Date),
		Time:      e.TimeOfDay,
		MetricKey: e.MetricKey,
		ValueNum:  e.ValueNum,
		ValueInt:  e.ValueInt,
		Note:      e.Note,
		CreatedAt: e.CreatedAt.Format("2006-01-02 15:04:05"),
		UpdatedAt: e.UpdatedAt.Format("2006-01-02 15:04:05"),
	}
}

// buildEventResp 写操作后的统一响应装配（item + 当日汇总 + 重算后的 day）
func buildEventResp(ctx context.Context, uid string, date time.Time, ev *model.HealthEvent) (*dto.CreateHealthEventResp, error) {
	items, err := dao.HealthEvent.ListByDate(ctx, uid, date)
	if err != nil {
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "查询健康记录失败")
	}
	day, err := loadHealthDayDetail(ctx, uid, date)
	if err != nil {
		return nil, err
	}
	return &dto.CreateHealthEventResp{
		Item:    healthEventToItem(*ev),
		Summary: summarizeEvents(utility.DateStr(date), items),
		Day:     day,
	}, nil
}
