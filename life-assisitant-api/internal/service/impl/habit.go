// Package impl 习惯服务实现
// 业务规则：
//   1. 只能操作自己的习惯（user_id 从 ctx 取）
//   2. Create 时 status 默认 active，frequency 默认 daily，target_count 默认 1
//   3. Log 打卡：upsert（habit_id + log_date 唯一），count 累加
//   4. GetToday 默认取 server 当天日期，返回所有 active 习惯 + 今日完成状态
//   5. 不做：子任务、提醒、重复 RRULE
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

// HabitService 习惯服务实现
type HabitService struct{}

func NewHabitService() service.IHabitService { return &HabitService{} }

// Register 注册到 service 包（避免循环引用）
func init() { service.SetHabit(NewHabitService()) }

// ====== 公共辅助：model -> dto ======

func habitToResp(h *model.Habit) *dto.HabitResp {
	resp := &dto.HabitResp{
		ID:            h.ID,
		Title:         h.Title,
		Icon:          h.Icon,
		Color:         h.Color,
		Category:      h.Category,
		Frequency:     h.Frequency,
		TargetCount:   h.TargetCount,
		Status:        h.Status,
		TrackDuration: h.TrackDuration,
		CurrentStreak: h.CurrentStreak,
		LongestStreak: h.LongestStreak,
		TotalCheckIns: h.TotalCheckIns,
	}
	if h.Description != nil {
		resp.Description = *h.Description
	}
	if h.Unit != nil {
		resp.Unit = *h.Unit
	}
	if h.LastCheckInDate != nil {
		resp.LastCheckInDate = h.LastCheckInDate.Format("2006-01-02")
	}
	resp.CreatedAt = h.CreatedAt.UTC().Format(time.RFC3339)
	resp.UpdatedAt = h.UpdatedAt.UTC().Format(time.RFC3339)
	return resp
}

// ====== Create ======

// Create 创建习惯
func (s *HabitService) Create(ctx context.Context, req *dto.CreateHabitReq) (*dto.HabitResp, error) {
	uid := ctxUserID(ctx)
	if uid == "" {
		return nil, gerror.NewCode(ecode.AuthTokenMissing)
	}
	title := strings.TrimSpace(req.Title)
	if title == "" {
		return nil, gerror.NewCode(ecode.HabitTitleEmpty)
	}

	freq := req.Frequency
	if freq == "" {
		freq = model.HabitFrequencyDaily
	}
	target := req.TargetCount
	if target <= 0 {
		target = 1
	}
	icon := req.Icon
	if icon == "" {
		icon = "📌"
	}
	color := req.Color
	if color == "" {
		color = "#014DB2"
	}
	category := req.Category
	if category == "" {
		category = model.HabitCategoryLife
	}

	h := &model.Habit{
		ID:          utility.NewID("h"),
		UserID:      uid,
		Title:       title,
		Frequency:   freq,
		TargetCount: target,
		Icon:        icon,
		Color:       color,
		Category:    category,
		TrackDuration: req.TrackDuration,
		Status:      model.HabitStatusActive,
	}
	if desc := strings.TrimSpace(req.Description); desc != "" {
		h.Description = &desc
	}
	if unit := strings.TrimSpace(req.Unit); unit != "" {
		h.Unit = &unit
	}

	if err := dao.Habit.Create(ctx, h); err != nil {
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "创建习惯失败")
	}
	return habitToResp(h), nil
}

// ====== List ======

// List 习惯列表
func (s *HabitService) List(ctx context.Context, req *dto.ListHabitsReq) (*dto.ListHabitsResp, error) {
	uid := ctxUserID(ctx)
	if uid == "" {
		return nil, gerror.NewCode(ecode.AuthTokenMissing)
	}

	page := req.Page
	if page <= 0 {
		page = 1
	}
	pageSize := req.PageSize
	if pageSize <= 0 {
		pageSize = 20
	}
	status := req.Status
	if status == "" {
		status = model.HabitStatusActive
	}

	items, total, err := dao.Habit.List(ctx, dao.HabitListOptions{
		UserID:   uid,
		Status:   status,
		Page:     page,
		PageSize: pageSize,
	})
	if err != nil {
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "查询习惯列表失败")
	}

	out := make([]dto.HabitResp, 0, len(items))
	for i := range items {
		out = append(out, *habitToResp(&items[i]))
	}
	return &dto.ListHabitsResp{
		Items: out,
		Total: total,
		Page:  page,
	}, nil
}

// ====== Get ======

// Get 习惯详情
func (s *HabitService) Get(ctx context.Context, id string) (*dto.HabitResp, error) {
	uid := ctxUserID(ctx)
	if uid == "" {
		return nil, gerror.NewCode(ecode.AuthTokenMissing)
	}
	h, err := dao.Habit.GetByID(ctx, id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, gerror.NewCode(ecode.HabitNotFound)
		}
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "查询习惯失败")
	}
	if h.UserID != uid && ctxRole(ctx) != model.RoleAdmin {
		return nil, gerror.NewCode(ecode.HabitAccessDenied)
	}
	return habitToResp(h), nil
}

// ====== Update ======

// Update 部分更新
func (s *HabitService) Update(ctx context.Context, id string, req *dto.UpdateHabitReq) (*dto.HabitResp, error) {
	uid := ctxUserID(ctx)
	if uid == "" {
		return nil, gerror.NewCode(ecode.AuthTokenMissing)
	}
	exist, err := dao.Habit.GetByID(ctx, id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, gerror.NewCode(ecode.HabitNotFound)
		}
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "查询习惯失败")
	}
	if exist.UserID != uid && ctxRole(ctx) != model.RoleAdmin {
		return nil, gerror.NewCode(ecode.HabitAccessDenied)
	}

	updates := map[string]any{}
	if req.Title != nil {
		t := strings.TrimSpace(*req.Title)
		if t == "" {
			return nil, gerror.NewCode(ecode.HabitTitleEmpty)
		}
		updates["title"] = t
	}
	if req.Description != nil {
		d := strings.TrimSpace(*req.Description)
		if d == "" {
			updates["description"] = nil
		} else {
			updates["description"] = d
		}
	}
	if req.Icon != nil {
		updates["icon"] = *req.Icon
	}
	if req.Color != nil {
		updates["color"] = *req.Color
	}
	if req.Category != nil {
		updates["category"] = *req.Category
	}
	if req.Frequency != nil {
		updates["frequency"] = *req.Frequency
	}
	if req.TargetCount != nil && *req.TargetCount > 0 {
		updates["target_count"] = *req.TargetCount
	}
	if req.Unit != nil {
		u := strings.TrimSpace(*req.Unit)
		if u == "" {
			updates["unit"] = nil
		} else {
			updates["unit"] = u
		}
	}
	if req.Status != nil {
		updates["status"] = *req.Status
	}
	if req.TrackDuration != nil {
		updates["track_duration"] = *req.TrackDuration
	}

	if len(updates) == 0 {
		return habitToResp(exist), nil
	}

	if err := dao.Habit.Update(ctx, id, updates); err != nil {
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "更新习惯失败")
	}
	fresh, err := dao.Habit.GetByID(ctx, id)
	if err != nil {
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "重新查询习惯失败")
	}
	return habitToResp(fresh), nil
}

// ====== Delete ======

// Delete 软删
func (s *HabitService) Delete(ctx context.Context, id string) error {
	uid := ctxUserID(ctx)
	if uid == "" {
		return gerror.NewCode(ecode.AuthTokenMissing)
	}
	exist, err := dao.Habit.GetByID(ctx, id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return gerror.NewCode(ecode.HabitNotFound)
		}
		return gerror.WrapCode(ecode.DatabaseError, err, "查询习惯失败")
	}
	if exist.UserID != uid && ctxRole(ctx) != model.RoleAdmin {
		return gerror.NewCode(ecode.HabitAccessDenied)
	}
	if err := dao.Habit.Delete(ctx, id); err != nil {
		return gerror.WrapCode(ecode.DatabaseError, err, "删除习惯失败")
	}
	return nil
}

// ====== Log（打卡） ======

// Log 打卡：upsert（habit_id+log_date 唯一，count 累加）
func (s *HabitService) Log(ctx context.Context, habitID string, req *dto.LogHabitReq) (*dto.HabitResp, error) {
	uid := ctxUserID(ctx)
	if uid == "" {
		return nil, gerror.NewCode(ecode.AuthTokenMissing)
	}
	// 1. 校验 habit 所有权
	h, err := dao.Habit.GetByID(ctx, habitID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, gerror.NewCode(ecode.HabitNotFound)
		}
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "查询习惯失败")
	}
	if h.UserID != uid && ctxRole(ctx) != model.RoleAdmin {
		return nil, gerror.NewCode(ecode.HabitAccessDenied)
	}
	if h.Status != model.HabitStatusActive {
		return nil, gerror.NewCode(ecode.HabitAccessDenied)
	}

	// 2. 解析日期
	date, err := time.ParseInLocation("2006-01-02", req.Date, time.Local)
	if err != nil {
		return nil, gerror.NewCode(ecode.ValidationFailed)
	}

	// 3. 打卡次数
	count := req.Count
	if count <= 0 {
		count = 1
	}

	// 4. upsert：查已存在 → 累加 / 否则 insert
	existLog, err := dao.HabitLog.GetByDate(ctx, habitID, date)
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "查询打卡记录失败")
	}
	if existLog != nil {
		newCount := existLog.Count + count
		updates := map[string]any{"count": newCount}
		if note := strings.TrimSpace(req.Note); note != "" {
			updates["note"] = note
		}
		if req.DurationMinutes > 0 {
			updates["duration_minutes"] = existLog.DurationMinutes + req.DurationMinutes
		}
		if err := dao.HabitLog.Update(ctx, existLog.ID, updates); err != nil {
			return nil, gerror.WrapCode(ecode.HabitLogFailed, err, "更新打卡记录失败")
		}
	} else {
		note := strings.TrimSpace(req.Note)
		newLog := &model.HabitLog{
			ID:              utility.NewID("hl"),
			HabitID:         habitID,
			UserID:          uid,
			LogDate:         date,
			Count:           count,
			DurationMinutes: req.DurationMinutes,
		}
		if note != "" {
			newLog.Note = &note
		}
		if err := dao.HabitLog.Create(ctx, newLog); err != nil {
			return nil, gerror.WrapCode(ecode.HabitLogFailed, err, "创建打卡记录失败")
		}
	}

	// 5. 重算 streak / last_check_in_date / total_check_ins 并落库
	if err := s.recomputeStreak(ctx, habitID, h.Frequency, h.TargetCount); err != nil {
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "更新连续打卡统计失败")
	}

	// 6. 重新查 habit 返回
	fresh, err := dao.Habit.GetByID(ctx, habitID)
	if err != nil {
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "重新查询习惯失败")
	}
	return habitToResp(fresh), nil
}

// recomputeStreak 基于该习惯全部打卡日志重算 streak 统计并写回 habits
func (s *HabitService) recomputeStreak(ctx context.Context, habitID, freq string, targetCount int) error {
	logs, err := dao.HabitLog.ListByHabit(ctx, habitID)
	if err != nil {
		return err
	}

	completed := completedPeriods(logs, freq, targetCount)
	now := time.Now()
	updates := map[string]any{
		"current_streak": calcCurrentStreakFreq(completed, freq, now),
		"longest_streak": calcLongestStreakFreq(completed, freq),
	}

	// total_check_ins = SUM(count)；last_check_in_date = MAX(log_date)
	total := 0
	var lastDate *time.Time
	for i := range logs {
		total += logs[i].Count
		d := logs[i].LogDate
		if lastDate == nil || d.After(*lastDate) {
			lastDate = &d
		}
	}
	updates["total_check_ins"] = total
	if lastDate != nil {
		updates["last_check_in_date"] = *lastDate
	}

	return dao.Habit.Update(ctx, habitID, updates)
}

// ====== GetToday（今日习惯 + 打卡状态） ======

// GetToday 今日所有 active 习惯 + 各自的完成状态
func (s *HabitService) GetToday(ctx context.Context, req *dto.GetTodayHabitsReq) (*dto.TodayHabitsResp, error) {
	uid := ctxUserID(ctx)
	if uid == "" {
		return nil, gerror.NewCode(ecode.AuthTokenMissing)
	}

	// 1. 解析日期（默认今天）
	date := time.Now()
	if strings.TrimSpace(req.Date) != "" {
		d, err := time.ParseInLocation("2006-01-02", req.Date, time.Local)
		if err != nil {
			return nil, gerror.NewCode(ecode.ValidationFailed)
		}
		date = d
	}
	dateStr := date.Format("2006-01-02")

	// 2. 取所有 active 习惯
	items, _, err := dao.Habit.List(ctx, dao.HabitListOptions{
		UserID:   uid,
		Status:   model.HabitStatusActive,
		Page:     1,
		PageSize: 100,
	})
	if err != nil {
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "查询习惯失败")
	}

	// 3. 批量取今日所有 log（一次 N+1 解决）
	logs, err := dao.HabitLog.ListByDate(ctx, uid, date)
	if err != nil {
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "查询今日打卡失败")
	}
	logByHabit := make(map[string]*model.HabitLog, len(logs))
	for i := range logs {
		logByHabit[logs[i].HabitID] = &logs[i]
	}

	// 4. 组装响应
	out := make([]dto.HabitResp, 0, len(items))
	done := 0
	for i := range items {
		resp := *habitToResp(&items[i])
		resp.TodayDate = dateStr
		if lg, ok := logByHabit[items[i].ID]; ok {
			resp.TodayCount = lg.Count
			if lg.Count >= items[i].TargetCount {
				resp.TodayCompleted = true
				done++
			}
		}
		out = append(out, resp)
	}

	return &dto.TodayHabitsResp{
		Date:      dateStr,
		Items:     out,
		Total:     len(out),
		DoneCount: done,
	}, nil
}
