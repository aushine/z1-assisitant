// Package impl 生活时间线服务实现
// 跨模块聚合：习惯打卡 / 任务完成 / 记账 / 心情，按时间倒序
package impl

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/gogf/gf/v2/errors/gerror"

	"github.com/life-assistant/api/internal/consts/ecode"
	"github.com/life-assistant/api/internal/dao"
	"github.com/life-assistant/api/internal/model"
	"github.com/life-assistant/api/internal/model/dto"
	"github.com/life-assistant/api/internal/service"
)

// TimelineService 时间线服务实现
type TimelineService struct{}

func NewTimelineService() service.ITimelineService { return &TimelineService{} }

// Register
func init() { service.SetTimeline(NewTimelineService()) }

// 事件类型
const (
	TimelineTypeTask    = "task"
	TimelineTypeHabit   = "habit"
	TimelineTypeExpense = "expense"
	TimelineTypeIncome  = "income"
	TimelineTypeMood    = "mood"
)

// timelineItem 内部聚合项（携带完整时间用于排序）
type timelineItem struct {
	event dto.TimelineEvent
	ts    time.Time
}

// Fetch 聚合某天时间线
func (s *TimelineService) Fetch(ctx context.Context, req *dto.TimelineReq) (*dto.TimelineResp, error) {
	uid := ctxUserID(ctx)
	if uid == "" {
		return nil, gerror.NewCode(ecode.AuthTokenMissing)
	}

	// 解析日期（默认今天）
	date := time.Now()
	if strings.TrimSpace(req.Date) != "" {
		d, err := time.ParseInLocation("2006-01-02", req.Date, time.Local)
		if err != nil {
			return nil, gerror.NewCode(ecode.ValidationFailed)
		}
		date = d
	}
	dayStart := time.Date(date.Year(), date.Month(), date.Day(), 0, 0, 0, 0, date.Location())
	dayEnd := dayStart.AddDate(0, 0, 1)

	items := make([]timelineItem, 0, 64)

	// ====== 1. 习惯打卡 ======
	logs, err := dao.HabitLog.ListByDate(ctx, uid, date)
	if err != nil {
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "查询习惯打卡失败")
	}
	habitMap := map[string]*model.Habit{}
	if len(logs) > 0 {
		ids := make([]string, 0, len(logs))
		seen := map[string]bool{}
		for i := range logs {
			if !seen[logs[i].HabitID] {
				seen[logs[i].HabitID] = true
				ids = append(ids, logs[i].HabitID)
			}
		}
		habits, err := dao.Habit.ListByIDs(ctx, ids)
		if err != nil {
			return nil, gerror.WrapCode(ecode.DatabaseError, err, "查询习惯失败")
		}
		for i := range habits {
			habitMap[habits[i].ID] = &habits[i]
		}
	}
	for i := range logs {
		l := logs[i]
		title := "习惯打卡"
		icon := "📌"
		unit := "次"
		if h, ok := habitMap[l.HabitID]; ok {
			title = h.Title
			icon = h.Icon
			if h.Unit != nil && *h.Unit != "" {
				unit = *h.Unit
			}
		}
		items = append(items, timelineItem{
			event: dto.TimelineEvent{
				ID:       l.ID,
				Type:     TimelineTypeHabit,
				Title:    title,
				Detail:   fmt.Sprintf("+%d %s", l.Count, unit),
				Time:     l.CreatedAt.In(date.Location()).Format("15:04"),
				IconHint: icon,
			},
			ts: l.CreatedAt,
		})
	}

	// ====== 2. 任务完成 ======
	tasks, err := dao.Task.ListCompletedByRange(ctx, uid, dayStart, dayEnd)
	if err != nil {
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "查询任务完成失败")
	}
	for _, t := range tasks {
		ts := time.Now()
		if t.CompletedAt != nil {
			ts = *t.CompletedAt
		}
		items = append(items, timelineItem{
			event: dto.TimelineEvent{
				ID:       t.ID,
				Type:     TimelineTypeTask,
				Title:    t.Title,
				Detail:   "已完成",
				Time:     ts.In(date.Location()).Format("15:04"),
				IconHint: "✅",
			},
			ts: ts,
		})
	}

	// ====== 3. 记账（expense / income） ======
	txs, err := dao.Transaction.ListByRange(ctx, uid, dayStart, dayEnd)
	if err != nil {
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "查询交易失败")
	}
	for _, t := range txs {
		if t.Type == model.TransactionTypeTransfer {
			continue // 转账不计入时间线叙事
		}
		title := "未分类"
		if t.CategoryName != nil && *t.CategoryName != "" {
			title = *t.CategoryName
		}
		detail := ""
		if t.AccountName != nil {
			detail = *t.AccountName
		}
		icon := "📂"
		if t.CategoryEmoji != nil && *t.CategoryEmoji != "" {
			icon = *t.CategoryEmoji
		}
		amount := t.Amount
		eventType := TimelineTypeExpense
		if t.Type == model.TransactionTypeExpense {
			amount = -t.Amount // 支出为负
		} else {
			eventType = TimelineTypeIncome
		}
		items = append(items, timelineItem{
			event: dto.TimelineEvent{
				ID:       t.ID,
				Type:     eventType,
				Title:    title,
				Detail:   detail,
				Amount:   &amount,
				Time:     t.HappenedAt.In(date.Location()).Format("15:04"),
				IconHint: icon,
			},
			ts: t.HappenedAt,
		})
	}

	// ====== 4. 心情 ======
	moods, err := dao.MoodLog.ListByRange(ctx, uid, dayStart, dayEnd)
	if err != nil {
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "查询心情记录失败")
	}
	for _, m := range moods {
		detailParts := []string{}
		if m.Energy != nil {
			detailParts = append(detailParts, "精力"+energyLabel(*m.Energy))
		}
		if m.Note != nil && strings.TrimSpace(*m.Note) != "" {
			detailParts = append(detailParts, strings.TrimSpace(*m.Note))
		}
		// 260919：改为按小时记录后，同一天会有多条。
		// 展示/排序时间一律用「记录的那个小时」而不是行的创建时间 ——
		// 下午 3 点补记 9 点的心情，显示成 15:04 就是在编造事实。
		recTs := time.Date(m.Date.Year(), m.Date.Month(), m.Date.Day(),
			m.Hour, 0, 0, 0, date.Location())
		items = append(items, timelineItem{
			event: dto.TimelineEvent{
				ID:       m.ID,
				Type:     TimelineTypeMood,
				Title:    moodLabel(m.Mood),
				Detail:   strings.Join(detailParts, " · "),
				Time:     recTs.Format("15:04"),
				IconHint: moodEmoji(m.Mood),
			},
			ts: recTs,
		})
	}

	// ====== 倒序排序 ======
	sort.Slice(items, func(i, j int) bool { return items[i].ts.After(items[j].ts) })

	total := len(items)

	// ====== 分页 ======
	page := req.Page
	if page <= 0 {
		page = 1
	}
	pageSize := req.PageSize
	if pageSize <= 0 {
		pageSize = 20
	}
	start := (page - 1) * pageSize
	if start > total {
		start = total
	}
	end := start + pageSize
	if end > total {
		end = total
	}

	out := make([]dto.TimelineEvent, 0, end-start)
	for i := start; i < end; i++ {
		out = append(out, items[i].event)
	}

	return &dto.TimelineResp{
		Date:  dayStart.Format("2006-01-02"),
		Items: out,
		Total: total,
	}, nil
}

// moodLabel 心情 1-5 映射中文
func moodLabel(mood int) string {
	switch mood {
	case 1:
		return "很差"
	case 2:
		return "低落"
	case 3:
		return "一般"
	case 4:
		return "不错"
	case 5:
		return "很好"
	default:
		return "心情"
	}
}

// moodEmoji 心情 emoji 提示
func moodEmoji(mood int) string {
	switch mood {
	case 1:
		return "😠"
	case 2:
		return "😟"
	case 3:
		return "😐"
	case 4:
		return "🙂"
	case 5:
		return "😄"
	default:
		return "😐"
	}
}

// energyLabel 精力 1-3 映射中文
func energyLabel(energy int) string {
	switch energy {
	case 1:
		return "疲惫"
	case 2:
		return "一般"
	case 3:
		return "充沛"
	default:
		return "一般"
	}
}
