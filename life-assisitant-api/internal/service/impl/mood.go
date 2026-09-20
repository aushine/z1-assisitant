// Package impl 心情/精力服务实现
//
// 260919 变更：由「一天一条」改为**按小时记录**（可随时改、一天多条）。
//
// 业务规则：
//  1. 只能操作自己的记录（user_id 从 ctx 取）
//  2. 唯一键 UNIQUE(user_id, date, hour)；同格重复写入走 upsert
//  3. mood 1-5（0 = 该小时不填）、energy 1-3（0 或 NULL = 不填）、note ≤50 字
//  4. 读取时做**向前延续**（fill-forward）：mood/energy 为 0 的行取同日前一个
//     非 0 值；note 不延续，只属于写下它的那个小时
//  5. 三个字段最终全空 → 删掉该行（不留空行）
//
// ⚠️ 延续是**读取期派生**，不落库。这跟「预测不落表」「period_cycles 幂等派生」
// 是同一个取舍：避免存一份会和事实源对不上的副本。
package impl

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/gogf/gf/v2/errors/gerror"
	"gorm.io/gorm"

	"github.com/life-assistant/api/internal/consts/ecode"
	"github.com/life-assistant/api/internal/dao"
	"github.com/life-assistant/api/internal/model"
	"github.com/life-assistant/api/internal/model/dto"
	"github.com/life-assistant/api/internal/service"
	"github.com/life-assistant/api/internal/utility"
)

// 备注长度上限（与 dto / 两端 MOOD_NOTE_MAX 一致）
const moodNoteMaxRunes = 50

// MoodService 心情服务实现
type MoodService struct{}

func NewMoodService() service.IMoodService { return &MoodService{} }

// Register
func init() { service.SetMood(NewMoodService()) }

// moodNowHour 服务器当前小时（0-23）
func moodNowHour() int { return time.Now().Hour() }

// resolveMoodDate 解析日期；空串 = 服务器当天（原实现就是「缺省今天」）
func resolveMoodDate(s string) (time.Time, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return time.Now(), nil
	}
	d, err := time.ParseInLocation("2006-01-02", s, time.Local)
	if err != nil {
		return time.Time{}, gerror.NewCode(ecode.ValidationFailed)
	}
	return d, nil
}

// moodHourItem 单行 → 响应项（不做延续；延续统一由 fillForward 处理）
func moodHourItem(m *model.MoodLog) dto.MoodHourResp {
	return dto.MoodHourResp{
		ID:        m.ID,
		Date:      utility.DateStr(m.Date),
		Hour:      m.Hour,
		Mood:      m.Mood,
		Energy:    m.MoodEnergyValue(),
		Note:      m.MoodNoteValue(),
		CreatedAt: m.CreatedAt.UTC().Format(time.RFC3339),
		UpdatedAt: m.UpdatedAt.UTC().Format(time.RFC3339),
	}
}

// fillForward 向前延续（fill-forward）。
//
// 入参必须是**同一天**且按 hour 升序的行；返回与其等长的响应项：
//   - mood/energy 为 0 → 用前一个非 0 值填充（前面也没有则保持 0）
//   - note 不延续
//
// 刻意不做「跨天延续」：昨天的情绪不该自动算进今天。
func fillForward(rows []model.MoodLog) []dto.MoodHourResp {
	out := make([]dto.MoodHourResp, 0, len(rows))
	carryMood, carryEnergy := 0, 0
	for i := range rows {
		item := moodHourItem(&rows[i])
		if item.Mood == 0 {
			item.Mood = carryMood
		} else {
			carryMood = item.Mood
		}
		if item.Energy == 0 {
			item.Energy = carryEnergy
		} else {
			carryEnergy = item.Energy
		}
		out = append(out, item)
	}
	return out
}

// GetTimeline GET /moods/timeline
// 某天的时间线（默认今天）。Items 按 hour 升序，只含实际存在的行。
func (s *MoodService) GetTimeline(ctx context.Context, req *dto.GetMoodReq) (*dto.MoodTimelineResp, error) {
	uid := ctxUserID(ctx)
	if uid == "" {
		return nil, gerror.NewCode(ecode.AuthTokenMissing)
	}
	date, err := resolveMoodDate(req.Date)
	if err != nil {
		return nil, err
	}
	rows, err := dao.MoodLog.ListByDate(ctx, uid, date)
	if err != nil {
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "查询心情时间线失败")
	}
	return &dto.MoodTimelineResp{
		Date:    utility.DateStr(date),
		NowHour: moodNowHour(),
		Items:   fillForward(rows),
	}, nil
}

// GetByDate GET /moods/today
// 该天**最后一条**（含延续填充）；无记录返回 nil。首页紧凑选择器用它。
func (s *MoodService) GetByDate(ctx context.Context, req *dto.GetMoodReq) (*dto.MoodHourResp, error) {
	uid := ctxUserID(ctx)
	if uid == "" {
		return nil, gerror.NewCode(ecode.AuthTokenMissing)
	}
	date, err := resolveMoodDate(req.Date)
	if err != nil {
		return nil, err
	}
	rows, err := dao.MoodLog.ListByDate(ctx, uid, date)
	if err != nil {
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "查询心情记录失败")
	}
	items := fillForward(rows)
	if len(items) == 0 {
		return nil, nil // 当天无记录
	}
	last := items[len(items)-1]
	return &last, nil
}

// Upsert PUT /moods
// 记录/修改某天某个小时。hour 缺省 = 服务器当前小时。
//
// 三态语义（缺省 = 不动 / 0 或 "" = 清空）见 dto.UpsertMoodReq。
// 三字段最终全空 → 删行并返回 { item: null }。
func (s *MoodService) Upsert(ctx context.Context, req *dto.UpsertMoodReq) (*dto.UpsertMoodResp, error) {
	uid := ctxUserID(ctx)
	if uid == "" {
		return nil, gerror.NewCode(ecode.AuthTokenMissing)
	}
	date, err := resolveMoodDate(req.Date)
	if err != nil {
		return nil, err
	}

	hour := moodNowHour()
	if req.Hour != nil {
		hour = *req.Hour
	}
	if hour < model.HourMin || hour > model.HourMax {
		return nil, gerror.NewCode(ecode.ValidationFailed)
	}

	// 取值校验：0 是「显式清空」，只有非 0 才校验区间
	if req.Mood != nil && *req.Mood != 0 &&
		(*req.Mood < model.MoodMin || *req.Mood > model.MoodMax) {
		return nil, gerror.NewCode(ecode.MoodValueInvalid)
	}
	if req.Energy != nil && *req.Energy != 0 &&
		(*req.Energy < model.EnergyMin || *req.Energy > model.EnergyMax) {
		return nil, gerror.NewCode(ecode.MoodEnergyInvalid)
	}
	newNote := ""
	if req.Note != nil {
		newNote = strings.TrimSpace(*req.Note)
		if len([]rune(newNote)) > moodNoteMaxRunes {
			return nil, gerror.NewCode(ecode.MoodNoteTooLong)
		}
	}

	exist, err := dao.MoodLog.GetByUserDateHour(ctx, uid, date, hour)
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "查询心情记录失败")
	}

	// ---- 三态合并：缺省 = 不动既有值 ----
	moodVal, energyVal, noteVal := 0, 0, ""
	if exist != nil {
		moodVal = exist.Mood
		energyVal = exist.MoodEnergyValue()
		noteVal = exist.MoodNoteValue()
	}
	if req.Mood != nil {
		moodVal = *req.Mood
	}
	if req.Energy != nil {
		energyVal = *req.Energy
	}
	if req.Note != nil {
		noteVal = newNote
	}

	// ---- 三字段全空 → 删掉这一行，不留空行 ----
	if moodVal == 0 && energyVal == 0 && noteVal == "" {
		if exist != nil {
			if err := dao.MoodLog.DeleteByID(ctx, exist.ID); err != nil {
				return nil, gerror.WrapCode(ecode.DatabaseError, err, "清除心情记录失败")
			}
		}
		return &dto.UpsertMoodResp{Item: nil}, nil
	}

	var energyPtr *int
	if energyVal > 0 {
		e := energyVal
		energyPtr = &e
	}
	var notePtr *string
	if noteVal != "" {
		n := noteVal
		notePtr = &n
	}

	if exist != nil {
		// 用 map 更新：GORM 对 map 不会跳过零值，NULL 能真正写进去
		updates := map[string]any{"mood": moodVal, "energy": energyPtr, "note": notePtr}
		if err := dao.MoodLog.Update(ctx, exist.ID, updates); err != nil {
			return nil, gerror.WrapCode(ecode.DatabaseError, err, "更新心情记录失败")
		}
	} else {
		row := &model.MoodLog{
			ID:     utility.NewID("ml"),
			UserID: uid,
			Date:   date,
			Hour:   hour,
			Mood:   moodVal,
			Energy: energyPtr,
			Note:   notePtr,
		}
		if err := dao.MoodLog.Create(ctx, row); err != nil {
			return nil, gerror.WrapCode(ecode.DatabaseError, err, "创建心情记录失败")
		}
	}

	// 返回该格「延续后」的值，前端可直接用于更新选中态
	item, err := hourItemAfterFill(ctx, uid, date, hour)
	if err != nil {
		return nil, err
	}
	return &dto.UpsertMoodResp{Item: item}, nil
}

// hourItemAfterFill 重算当天时间线并取出 hour 那一格（延续后的值）
func hourItemAfterFill(
	ctx context.Context, uid string, date time.Time, hour int,
) (*dto.MoodHourResp, error) {
	rows, err := dao.MoodLog.ListByDate(ctx, uid, date)
	if err != nil {
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "查询心情记录失败")
	}
	items := fillForward(rows)
	for i := range items {
		if items[i].Hour == hour {
			return &items[i], nil
		}
	}
	return nil, nil
}

// List GET /moods?start_date=&end_date=
// 区间内全部小时行。每天内部延续，**不跨天延续**。
func (s *MoodService) List(ctx context.Context, req *dto.ListMoodsReq) (*dto.ListMoodsResp, error) {
	uid := ctxUserID(ctx)
	if uid == "" {
		return nil, gerror.NewCode(ecode.AuthTokenMissing)
	}
	start := strings.TrimSpace(req.StartDate)
	end := strings.TrimSpace(req.EndDate)
	if start == "" || end == "" {
		return nil, gerror.NewCode(ecode.ValidationFailed)
	}
	startT, err := time.ParseInLocation("2006-01-02", start, time.Local)
	if err != nil {
		return nil, gerror.NewCode(ecode.ValidationFailed)
	}
	endT, err := time.ParseInLocation("2006-01-02", end, time.Local)
	if err != nil {
		return nil, gerror.NewCode(ecode.ValidationFailed)
	}
	endT = endT.AddDate(0, 0, 1) // 含结束当天

	rows, err := dao.MoodLog.ListByRange(ctx, uid, startT, endT)
	if err != nil {
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "查询心情记录失败")
	}

	// 按日期切段后逐段延续（DAO 已按 date, hour 排序）
	out := make([]dto.MoodHourResp, 0, len(rows))
	bucket := make([]model.MoodLog, 0, 24)
	cur := ""
	flush := func() {
		if len(bucket) > 0 {
			out = append(out, fillForward(bucket)...)
			bucket = bucket[:0]
		}
	}
	for i := range rows {
		d := utility.DateStr(rows[i].Date)
		if cur == "" {
			cur = d
		} else if d != cur {
			flush()
			cur = d
		}
		bucket = append(bucket, rows[i])
	}
	flush()

	return &dto.ListMoodsResp{Items: out}, nil
}
