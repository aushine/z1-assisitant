// Package impl 纪念日 / 倒数日服务实现
//
// 业务规则（详见 md/spec-20260919-v1/）：
//  1. 只能操作自己的记录（user_id 从 ctx 取）；
//  2. next_date / days_left **不落库**，每次实时推导（model/anniversary.go 头注释）；
//  3. 倒数日（不重复）一旦已过（days_left < 0）即在列表中过滤掉；
//  4. 农历暂按公历处理（项目未引农历库，见 Create 内 TODO）。
package impl

import (
	"context"
	"strings"
	"time"

	"github.com/gogf/gf/v2/errors/gerror"
	"github.com/gogf/gf/v2/frame/g"

	"github.com/life-assistant/api/internal/consts/ecode"
	"github.com/life-assistant/api/internal/dao"
	"github.com/life-assistant/api/internal/model"
	"github.com/life-assistant/api/internal/model/dto"
	"github.com/life-assistant/api/internal/service"
	"github.com/life-assistant/api/internal/utility"
)

// AnniversaryService 纪念日 / 倒数日服务实现
type AnniversaryService struct{}

// NewAnniversaryService 构造函数
func NewAnniversaryService() service.IAnniversaryService { return &AnniversaryService{} }

// Register 注册到 service 包（service.SetAnniversary 由 team-lead 在 service.go 添加）
func init() { service.SetAnniversary(NewAnniversaryService()) }

// ============================================================================
// List GET /anniversaries
// ============================================================================

func (s *AnniversaryService) List(ctx context.Context, req *dto.ListAnniversariesReq) (*dto.ListAnniversariesResp, error) {
	uid := ctxUserID(ctx)
	if uid == "" {
		return nil, gerror.NewCode(ecode.AuthTokenMissing)
	}
	today := utility.DateOnly(time.Now())

	all, err := dao.Anniversary.ListByUser(ctx, uid)
	if err != nil {
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "查询纪念日列表失败")
	}

	scope := strings.TrimSpace(req.Scope)
	if scope != "upcoming" && scope != "month" {
		scope = "all" // 未知值按 all 处理
	}

	entries := make([]anniversaryEntry, 0, len(all))
	for i := range all {
		e, keep := s.toEntry(&all[i], today)
		if !keep {
			continue
		}
		switch scope {
		case "upcoming":
			if e.DaysLeft > 30 { // 只留 30 天内
				continue
			}
		case "month":
			if e.Next.Year() != today.Year() || e.Next.Month() != today.Month() { // 只留本月
				continue
			}
		}
		entries = append(entries, *e)
	}

	// 排序：置顶优先 → 距今天数升序
	sortAnniversaryEntries(entries)

	if req.Limit > 0 && len(entries) > req.Limit {
		entries = entries[:req.Limit]
	}

	items := make([]dto.AnniversaryItem, 0, len(entries))
	for i := range entries {
		items = append(items, entries[i].Item)
	}
	return &dto.ListAnniversariesResp{Items: items, Total: len(items)}, nil
}

// ============================================================================
// Upcoming GET /anniversaries/upcoming
// ============================================================================

func (s *AnniversaryService) Upcoming(ctx context.Context, req *dto.UpcomingAnniversariesReq) (*dto.UpcomingAnniversariesResp, error) {
	uid := ctxUserID(ctx)
	if uid == "" {
		return nil, gerror.NewCode(ecode.AuthTokenMissing)
	}
	today := utility.DateOnly(time.Now())

	all, err := dao.Anniversary.ListByUser(ctx, uid)
	if err != nil {
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "查询纪念日列表失败")
	}

	limit := req.Limit
	if limit <= 0 {
		limit = 3
	}
	if limit > 10 {
		limit = 10 // 上限 10
	}

	entries := make([]anniversaryEntry, 0, len(all))
	for i := range all {
		e, keep := s.toEntry(&all[i], today)
		if !keep {
			continue
		}
		if e.DaysLeft < 0 { // 先过滤掉已过的不重复项
			continue
		}
		entries = append(entries, *e)
	}
	// 最近优先（days_left 升序，同值置顶优先）
	sortUpcomingEntries(entries)

	if len(entries) > limit {
		entries = entries[:limit]
	}

	items := make([]dto.AnniversaryBrief, 0, len(entries))
	for i := range entries {
		items = append(items, dto.AnniversaryBrief{
			ID:       entries[i].Item.ID,
			Title:    entries[i].Item.Title,
			NextDate: entries[i].Item.NextDate,
			DaysLeft: entries[i].Item.DaysLeft,
			Category: entries[i].Item.Category,
			Icon:     entries[i].Item.Icon,
			Color:    entries[i].Item.Color,
			IsPinned: entries[i].Item.IsPinned,
		})
	}
	return &dto.UpcomingAnniversariesResp{Items: items, Total: len(items)}, nil
}

// ============================================================================
// Create POST /anniversaries
// ============================================================================

func (s *AnniversaryService) Create(ctx context.Context, req *dto.CreateAnniversaryReq) (*dto.CreateAnniversaryResp, error) {
	uid := ctxUserID(ctx)
	if uid == "" {
		return nil, gerror.NewCode(ecode.AuthTokenMissing)
	}

	title := strings.TrimSpace(req.Title)
	if title == "" || len([]rune(title)) > 50 {
		return nil, gerror.NewCode(ecode.ValidationFailed)
	}

	td, err := time.ParseInLocation("2006-01-02", strings.TrimSpace(req.TargetDate), time.Local)
	if err != nil {
		return nil, gerror.NewCode(ecode.ValidationFailed)
	}

	rule := req.RepeatRule
	if rule == 0 {
		rule = model.RepeatYearly // 缺省每年
	}
	if rule < model.RepeatNone || rule > model.RepeatWeekly {
		return nil, gerror.NewCode(ecode.ValidationFailed)
	}

	cal := req.CalendarType
	if cal == 0 {
		cal = model.CalendarGregorian // 缺省公历
	}
	if cal != model.CalendarGregorian && cal != model.CalendarLunar {
		return nil, gerror.NewCode(ecode.ValidationFailed)
	}

	remind := normalizeRemindDays(ctx, req.RemindDays)

	category := strings.TrimSpace(req.Category)
	if category == "" || !validAnniversaryCategory(category) {
		category = model.CategoryOther
	}
	icon := strings.TrimSpace(req.Icon)
	if icon == "" {
		icon = "calendar-heart"
	}
	color := strings.TrimSpace(req.Color)
	if color == "" {
		color = "primary"
	}
	note := req.Note
	if len([]rune(note)) > 200 {
		return nil, gerror.NewCode(ecode.ValidationFailed)
	}

	// TODO(农历): calendar_type = 2（农历）目前无法换算，因为项目尚未引入农历库。
	// 本期**直接按公历处理** target_date 来推导 next_date —— 仅当公历与农历恰好吻合时才正确，
	// 否则会整体偏移。等引入农历库（如 natezhang/lunar 或类似）后，应在此处先把 target_date 由农历
	// 换算成公历基准日，再交给 utility.NextDate；届时务必补对应单测。切勿假装已实现。

	row := &model.Anniversary{
		ID:           utility.NewID("an"),
		UserID:       uid,
		Title:        title,
		TargetDate:   td,
		RepeatRule:   rule,
		CalendarType: cal,
		RemindDays:   model.IntArray(remind),
		Category:     category,
		Icon:         icon,
		Color:        color,
		IsPinned:     boolToInt(req.IsPinned),
		Note:         note,
	}
	if err := dao.Anniversary.Create(ctx, row); err != nil {
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "创建纪念日失败")
	}

	item, _, _, _ := anniversaryToItem(row, utility.DateOnly(time.Now()))
	return &dto.CreateAnniversaryResp{Item: item}, nil
}

// ============================================================================
// Patch PATCH /anniversaries/:id
// ============================================================================

func (s *AnniversaryService) Patch(ctx context.Context, req *dto.PatchAnniversaryReq) (*dto.PatchAnniversaryResp, error) {
	uid := ctxUserID(ctx)
	if uid == "" {
		return nil, gerror.NewCode(ecode.AuthTokenMissing)
	}
	id := strings.TrimSpace(req.ID)
	if id == "" {
		return nil, gerror.NewCode(ecode.ValidationFailed)
	}

	a, err := dao.Anniversary.GetByID(ctx, id, uid)
	if err != nil {
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "查询纪念日失败")
	}
	if a == nil {
		return nil, gerror.NewCode(ecode.ResourceNotFound)
	}

	if req.Title != nil {
		t := strings.TrimSpace(*req.Title)
		if t == "" || len([]rune(t)) > 50 {
			return nil, gerror.NewCode(ecode.ValidationFailed)
		}
		a.Title = t
	}
	if req.TargetDate != nil {
		td, perr := time.ParseInLocation("2006-01-02", strings.TrimSpace(*req.TargetDate), time.Local)
		if perr != nil {
			return nil, gerror.NewCode(ecode.ValidationFailed)
		}
		a.TargetDate = td
	}
	if req.RepeatRule != nil {
		r := *req.RepeatRule
		if r < model.RepeatNone || r > model.RepeatWeekly {
			return nil, gerror.NewCode(ecode.ValidationFailed)
		}
		a.RepeatRule = r
	}
	if req.CalendarType != nil {
		c := *req.CalendarType
		if c != model.CalendarGregorian && c != model.CalendarLunar {
			return nil, gerror.NewCode(ecode.ValidationFailed)
		}
		a.CalendarType = c
	}
	if req.RemindDays != nil {
		// 整体覆盖：重新归一化（丢非法值、去重、降序）
		a.RemindDays = model.IntArray(normalizeRemindDays(ctx, *req.RemindDays))
	}
	if req.Category != nil {
		c := strings.TrimSpace(*req.Category)
		if c == "" || !validAnniversaryCategory(c) {
			c = model.CategoryOther
		}
		a.Category = c
	}
	if req.Icon != nil {
		ic := strings.TrimSpace(*req.Icon)
		if ic == "" {
			ic = "calendar-heart"
		}
		a.Icon = ic
	}
	if req.Color != nil {
		col := strings.TrimSpace(*req.Color)
		if col == "" {
			col = "primary"
		}
		a.Color = col
	}
	if req.IsPinned != nil {
		a.IsPinned = boolToInt(*req.IsPinned)
	}
	if req.Note != nil {
		n := *req.Note
		if len([]rune(n)) > 200 {
			return nil, gerror.NewCode(ecode.ValidationFailed)
		}
		a.Note = n
	}

	if err := dao.Anniversary.Update(ctx, a); err != nil {
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "更新纪念日失败")
	}

	item, _, _, _ := anniversaryToItem(a, utility.DateOnly(time.Now()))
	return &dto.PatchAnniversaryResp{Item: item}, nil
}

// ============================================================================
// Delete DELETE /anniversaries/:id
// ============================================================================

func (s *AnniversaryService) Delete(ctx context.Context, id string) error {
	uid := ctxUserID(ctx)
	if uid == "" {
		return gerror.NewCode(ecode.AuthTokenMissing)
	}
	id = strings.TrimSpace(id)
	if id == "" {
		return gerror.NewCode(ecode.ValidationFailed)
	}
	// dao.Anniversary.Delete 不返回 ErrRecordNotFound，先判存在
	a, err := dao.Anniversary.GetByID(ctx, id, uid)
	if err != nil {
		return gerror.WrapCode(ecode.DatabaseError, err, "查询纪念日失败")
	}
	if a == nil {
		return gerror.NewCode(ecode.ResourceNotFound)
	}
	if err := dao.Anniversary.Delete(ctx, id, uid); err != nil {
		return gerror.WrapCode(ecode.DatabaseError, err, "删除纪念日失败")
	}
	return nil
}

// ============================================================================
// 装配 / 工具
// ============================================================================

// anniversaryEntry 列表排序用中间结构：item + 排序键
type anniversaryEntry struct {
	Item     dto.AnniversaryItem
	IsPinned int
	DaysLeft int
	Next     time.Time
}

// anniversaryToItem 实体 → 响应项（含实时推导字段）。
// 返回 (item, next, daysLeft, nonRepeating)：nonRepeating=true 表示「不重复且已过应被过滤」。
// 注意：Create / Patch 的响应**不应用** nonRepeating 过滤，直接取 item 即可。
func anniversaryToItem(a *model.Anniversary, today time.Time) (dto.AnniversaryItem, time.Time, int, bool) {
	rule := a.RepeatRule
	next, ok := utility.NextDate(a.TargetDate, rule, today)
	if !ok {
		// 非法规则回落到「不重复」，避免 panic
		rule = model.RepeatNone
		next, _ = utility.NextDate(a.TargetDate, model.RepeatNone, today)
	}
	daysLeft := utility.DaysLeft(next, today)
	item := dto.AnniversaryItem{
		ID:           a.ID,
		Title:        a.Title,
		TargetDate:   utility.DateStr(a.TargetDate),
		NextDate:     utility.DateStr(next),
		DaysLeft:     daysLeft,
		RepeatRule:   a.RepeatRule,
		CalendarType: a.CalendarType,
		RemindDays:   []int(a.RemindDays),
		Category:     a.Category,
		Icon:         a.Icon,
		Color:        a.Color,
		IsPinned:     a.IsPinned == 1,
		Note:         a.Note,
	}
	nonRepeating := a.RepeatRule == model.RepeatNone || !ok
	return item, next, daysLeft, nonRepeating
}

// toEntry 实体 → 列表条目；keep=false 表示该条应被过滤（不重复且已过）
func (s *AnniversaryService) toEntry(a *model.Anniversary, today time.Time) (*anniversaryEntry, bool) {
	item, next, daysLeft, nonRepeating := anniversaryToItem(a, today)
	if nonRepeating && daysLeft < 0 {
		return nil, false
	}
	return &anniversaryEntry{Item: item, IsPinned: a.IsPinned, DaysLeft: daysLeft, Next: next}, true
}

// sortAnniversaryEntries 置顶优先 → 距今天数升序
func sortAnniversaryEntries(xs []anniversaryEntry) {
	for i := 1; i < len(xs); i++ {
		for j := i; j > 0; j-- {
			less := xs[j].IsPinned > xs[j-1].IsPinned ||
				(xs[j].IsPinned == xs[j-1].IsPinned && xs[j].DaysLeft < xs[j-1].DaysLeft)
			if !less {
				break
			}
			xs[j], xs[j-1] = xs[j-1], xs[j]
		}
	}
}

// sortUpcomingEntries 最近优先（days_left 升序，同值置顶优先）
func sortUpcomingEntries(xs []anniversaryEntry) {
	for i := 1; i < len(xs); i++ {
		for j := i; j > 0; j-- {
			less := xs[j].DaysLeft < xs[j-1].DaysLeft ||
				(xs[j].DaysLeft == xs[j-1].DaysLeft && xs[j].IsPinned > xs[j-1].IsPinned)
			if !less {
				break
			}
			xs[j], xs[j-1] = xs[j-1], xs[j]
		}
	}
}

// normalizeRemindDays 过滤非法值（记 warn）、去重、按降序存（7,3,1,0）
func normalizeRemindDays(ctx context.Context, in []int) []int {
	valid := map[int]bool{
		model.RemindDaySameDay: true,
		model.RemindDay1:       true,
		model.RemindDay3:       true,
		model.RemindDay7:       true,
	}
	seen := map[int]bool{}
	out := make([]int, 0, len(in))
	for _, d := range in {
		if !valid[d] {
			g.Log().Warningf(ctx, "anniversary: 未知 remind_days 已丢弃 day=%d", d)
			continue
		}
		if seen[d] {
			continue
		}
		seen[d] = true
		out = append(out, d)
	}
	// 降序（插入排序，列表通常很短）
	for i := 1; i < len(out); i++ {
		for j := i; j > 0 && out[j] > out[j-1]; j-- {
			out[j], out[j-1] = out[j-1], out[j]
		}
	}
	return out
}

// validAnniversaryCategory 是否为合法分类
func validAnniversaryCategory(c string) bool {
	switch c {
	case model.CategoryBirthday, model.CategoryAnniversary, model.CategoryCountdown, model.CategoryOther:
		return true
	}
	return false
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}
