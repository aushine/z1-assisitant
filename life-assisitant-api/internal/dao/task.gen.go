// TaskDao 任务表数据访问对象
// 风格参考 user.gen.go：手写 + 链式 + GORM 原生
package dao

import (
	"context"
	"time"

	"gorm.io/gorm"

	"github.com/life-assistant/api/internal/model"
)

// TaskDao 任务 DAO 接口
type TaskDao interface {
	WithContext(ctx context.Context) TaskDao
	Create(ctx context.Context, t *model.Task) error
	GetByID(ctx context.Context, id string) (*model.Task, error)
	Update(ctx context.Context, id string, fields map[string]any) error
	Delete(ctx context.Context, id string) error // 软删

	// List 列表查询（带分页/筛选/搜索）
	// 返回：items, total, error
	List(ctx context.Context, opts TaskListOptions) ([]model.Task, int64, error)
	// Count 统计某用户任务数（按 status）
	Count(ctx context.Context, userID, status string) (int64, error)

	// ====== 统计模块新增 ======
	// CountByRange 统计 due_date 在 [start, end) 区间内的任务数
	CountByRange(ctx context.Context, userID string, start, end time.Time) (int64, error)
	// CountDoneByRange 统计某区间内已完成任务数
	CountDoneByRange(ctx context.Context, userID string, start, end time.Time) (int64, error)
	// GroupByDay 按日分组统计任务
	GroupByDay(ctx context.Context, userID string, start, end time.Time) ([]TaskDayRow, error)
	// GroupByCategory 按分类分组统计任务
	GroupByCategory(ctx context.Context, userID string, start, end time.Time) ([]TaskCategoryRow, error)
	// CountOverdue 统计逾期任务数
	CountOverdue(ctx context.Context, userID string, today string) (int64, error)
	// ListCompletedByRange 取某区间内已完成任务（completed_at 在 [start, end)）
	ListCompletedByRange(ctx context.Context, userID string, start, end time.Time) ([]model.Task, error)
}

// TaskListOptions 列表查询参数
type TaskListOptions struct {
	UserID   string // 必填，限定到当前用户
	Filter   string // all / today / upcoming / done / overdue
	Status   string // 直接筛 status（与 Filter 二选一，Filter 优先）
	Priority string
	Keyword  string // 标题模糊搜索
	Sort     string // due_time / priority / created_at
	Page     int
	PageSize int
}

// TaskDayRow 按日分组统计行
type TaskDayRow struct {
	Date      string `json:"date"`
	Total     int64  `json:"total"`
	Completed int64  `json:"completed"`
}

// TaskCategoryRow 按分类分组统计行
type TaskCategoryRow struct {
	CategoryID string `json:"category_id"`
	Total      int64  `json:"total"`
	Completed  int64  `json:"completed"`
}

type taskDao struct {
	db *gorm.DB
}

// NewTaskDao 构造函数
func NewTaskDao() TaskDao { return &taskDao{db: DB} }

func (d *taskDao) WithContext(ctx context.Context) TaskDao {
	return &taskDao{db: d.db.WithContext(ctx)}
}

func (d *taskDao) Create(ctx context.Context, t *model.Task) error {
	return d.db.WithContext(ctx).Create(t).Error
}

func (d *taskDao) GetByID(ctx context.Context, id string) (*model.Task, error) {
	var t model.Task
	if err := d.db.WithContext(ctx).Where("id = ?", id).First(&t).Error; err != nil {
		return nil, err
	}
	return &t, nil
}

func (d *taskDao) Update(ctx context.Context, id string, fields map[string]any) error {
	res := d.db.WithContext(ctx).Model(&model.Task{}).Where("id = ?", id).Updates(fields)
	if res.Error != nil {
		return res.Error
	}
	return nil
}

func (d *taskDao) Delete(ctx context.Context, id string) error {
	// 软删：GORM 通过 gorm.DeletedAt 自动转为 UPDATE deleted_at = NOW()
	return d.db.WithContext(ctx).Where("id = ?", id).Delete(&model.Task{}).Error
}

func (d *taskDao) Count(ctx context.Context, userID, status string) (int64, error) {
	var n int64
	q := d.db.WithContext(ctx).Model(&model.Task{}).Where("user_id = ?", userID)
	if status != "" {
		q = q.Where("status = ?", status)
	}
	if err := q.Count(&n).Error; err != nil {
		return 0, err
	}
	return n, nil
}

// List 任务列表：分页 + 筛选 + 搜索
func (d *taskDao) List(ctx context.Context, opts TaskListOptions) ([]model.Task, int64, error) {
	if opts.Page <= 0 {
		opts.Page = 1
	}
	if opts.PageSize <= 0 || opts.PageSize > 100 {
		opts.PageSize = 20
	}

	now := time.Now()
	today := now.Format("2006-01-02")

	q := d.db.WithContext(ctx).Model(&model.Task{}).Where("user_id = ?", opts.UserID)

	// 1. filter 模式（业务侧语义化筛选）
	switch opts.Filter {
	case model.TaskFilterToday:
		q = q.Where("due_date = ?", today)
		// 今天还没完成的
		q = q.Where("status <> ?", model.TaskStatusDone)
	case model.TaskFilterUpcoming:
		q = q.Where("due_date > ?", today)
		q = q.Where("status <> ?", model.TaskStatusDone)
	case model.TaskFilterDone:
		q = q.Where("status = ?", model.TaskStatusDone)
	case model.TaskFilterOverdue:
		q = q.Where("due_date IS NOT NULL AND due_date < ?", today)
		q = q.Where("status <> ?", model.TaskStatusDone)
		// default TaskFilterAll：不加额外 status 条件（包含 todo/in_progress/archived）
	}

	// 2. 直接 status 筛选（filter 与 status 互斥时，filter 优先；status 单独给时生效）
	if opts.Filter == "" || opts.Filter == model.TaskFilterAll {
		if opts.Status != "" {
			q = q.Where("status = ?", opts.Status)
		} else {
			// 默认过滤 archived（软删已被 GORM 自动过滤）
			q = q.Where("status <> ?", model.TaskStatusArchived)
		}
	}

	// 3. priority
	if opts.Priority != "" {
		q = q.Where("priority = ?", opts.Priority)
	}

	// 4. keyword（标题模糊）
	if opts.Keyword != "" {
		like := "%" + opts.Keyword + "%"
		q = q.Where("title LIKE ?", like)
	}

	// count
	var total int64
	if err := q.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	// 排序
	order := buildTaskOrder(opts.Sort, now)
	q = q.Order(order)

	// 分页
	var items []model.Task
	if err := q.Limit(opts.PageSize).
		Offset((opts.Page - 1) * opts.PageSize).
		Find(&items).Error; err != nil {
		return nil, 0, err
	}
	return items, total, nil
}

// buildTaskOrder 根据 sort 字段拼 ORDER BY
// 优先级：P0 最高；due_time 早的在前；空 due_date 排末尾
func buildTaskOrder(sort string, _ time.Time) string {
	switch sort {
	case "priority":
		// 字典序 P0<P1<P2<P3，刚好就是从紧急到不紧急
		return "priority ASC, due_date IS NULL, due_date ASC, due_time ASC, created_at DESC"
	case "created_at":
		return "created_at DESC"
	case "due_time", "":
		// 默认：due_date 有值的按日期升序，NULL 排最后；同日期按 due_time 升序
		return "due_date IS NULL, due_date ASC, due_time IS NULL, due_time ASC, priority ASC, created_at DESC"
	default:
		return "due_date IS NULL, due_date ASC, due_time IS NULL, due_time ASC, priority ASC, created_at DESC"
	}
}

// 全局 DAO 实例（在 dao.SetDB 中统一初始化）
var Task TaskDao

// ====== 统计模块新增方法 ======

// CountByRange 统计 due_date 在 [start, end) 区间内的任务数
func (d *taskDao) CountByRange(ctx context.Context, userID string, start, end time.Time) (int64, error) {
	var n int64
	err := d.db.WithContext(ctx).
		Model(&model.Task{}).
		Where("user_id = ? AND due_date >= ? AND due_date < ?",
			userID, start.Format("2006-01-02"), end.Format("2006-01-02")).
		Count(&n).Error
	return n, err
}

// CountDoneByRange 统计某区间内已完成任务数
func (d *taskDao) CountDoneByRange(ctx context.Context, userID string, start, end time.Time) (int64, error) {
	var n int64
	err := d.db.WithContext(ctx).
		Model(&model.Task{}).
		Where("user_id = ? AND status = ? AND completed_at >= ? AND completed_at < ?",
			userID, model.TaskStatusDone, start, end).
		Count(&n).Error
	return n, err
}

// GroupByDay 按日分组统计任务
func (d *taskDao) GroupByDay(ctx context.Context, userID string, start, end time.Time) ([]TaskDayRow, error) {
	var rows []TaskDayRow
	err := d.db.WithContext(ctx).
		Model(&model.Task{}).
		Select("due_date as date, COUNT(*) as total, SUM(CASE WHEN status = ? THEN 1 ELSE 0 END) as completed", model.TaskStatusDone).
		Where("user_id = ? AND due_date >= ? AND due_date < ?",
			userID, start.Format("2006-01-02"), end.Format("2006-01-02")).
		Group("due_date").
		Order("due_date ASC").
		Find(&rows).Error
	return rows, err
}

// GroupByCategory 按分类分组统计任务
func (d *taskDao) GroupByCategory(ctx context.Context, userID string, start, end time.Time) ([]TaskCategoryRow, error) {
	var rows []TaskCategoryRow
	startStr := start.Format("2006-01-02")
	endStr := end.Format("2006-01-02")
	err := d.db.WithContext(ctx).
		Model(&model.Task{}).
		Select("COALESCE(category_id, '') as category_id, COUNT(*) as total, SUM(CASE WHEN status = ? THEN 1 ELSE 0 END) as completed", model.TaskStatusDone).
		Where("user_id = ? AND due_date >= ? AND due_date < ?", userID, startStr, endStr).
		Group("category_id").
		Find(&rows).Error
	return rows, err
}

// CountOverdue 统计逾期任务数
func (d *taskDao) CountOverdue(ctx context.Context, userID string, today string) (int64, error) {
	var n int64
	err := d.db.WithContext(ctx).
		Model(&model.Task{}).
		Where("user_id = ? AND due_date IS NOT NULL AND due_date < ? AND status <> ?",
			userID, today, model.TaskStatusDone).
		Count(&n).Error
	return n, err
}

// ListCompletedByRange 取某区间内已完成任务（completed_at 在 [start, end)）
func (d *taskDao) ListCompletedByRange(ctx context.Context, userID string, start, end time.Time) ([]model.Task, error) {
	var items []model.Task
	err := d.db.WithContext(ctx).
		Where("user_id = ? AND status = ? AND completed_at >= ? AND completed_at < ?",
			userID, model.TaskStatusDone, start, end).
		Order("completed_at ASC").
		Find(&items).Error
	if err != nil {
		return nil, err
	}
	return items, nil
}
