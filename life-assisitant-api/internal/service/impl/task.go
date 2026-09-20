// Package impl 任务服务实现
// M5 扩展：
//   1. 子任务 CRUD + 全量替换 + 父任务自动完成
//   2. reminder_at 字段持久化（推送逻辑延迟至 v1.1）
//   3. recurrence_rule 字段持久化（定时扩展延迟至 v1.1）
//   4. 批量操作（complete / delete）
package impl

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/gogf/gf/v2/errors/gerror"
	"github.com/gogf/gf/v2/frame/g"
	"gorm.io/gorm"

	"github.com/life-assistant/api/internal/consts/ecode"
	"github.com/life-assistant/api/internal/dao"
	"github.com/life-assistant/api/internal/model"
	"github.com/life-assistant/api/internal/model/dto"
	"github.com/life-assistant/api/internal/service"
	"github.com/life-assistant/api/internal/utility"
)

// TaskService 任务服务实现
type TaskService struct{}

func NewTaskService() service.ITaskService { return &TaskService{} }

// Register 注册到 service 包
func init() { service.SetTask(NewTaskService()) }

// ====== 公共辅助 ======

// taskToResp 把 model.Task + 子任务列表 转为 dto.TaskResp
func taskToResp(t *model.Task, subtasks []model.Subtask) *dto.TaskResp {
	resp := &dto.TaskResp{
		ID:            t.ID,
		Title:         t.Title,
		Priority:      t.Priority,
		Status:        t.Status,
		SubtasksCount: t.SubtasksCount,
	}
	if t.Description != nil {
		resp.Description = *t.Description
	}
	if t.CategoryID != nil {
		resp.CategoryID = *t.CategoryID
	}
	if t.DueDate != nil {
		resp.DueDate = t.DueDate.Format("2006-01-02")
	}
	if t.DueTime != nil {
		resp.DueTime = *t.DueTime
	}
	if t.ReminderAt != nil {
		resp.ReminderAt = t.ReminderAt.UTC().Format(time.RFC3339)
	}
	if t.RecurrenceRule != nil {
		resp.RecurrenceRule = *t.RecurrenceRule
	}
	if t.ParentTaskID != nil {
		resp.ParentTaskID = *t.ParentTaskID
	}
	resp.CreatedAt = t.CreatedAt.UTC().Format(time.RFC3339)
	resp.UpdatedAt = t.UpdatedAt.UTC().Format(time.RFC3339)
	if t.CompletedAt != nil {
		resp.CompletedAt = t.CompletedAt.UTC().Format(time.RFC3339)
	}

	// 子任务
	if subtasks != nil {
		resp.Subtasks = make([]dto.SubtaskResp, 0, len(subtasks))
		for _, s := range subtasks {
			resp.Subtasks = append(resp.Subtasks, dto.SubtaskResp{
				ID:          s.ID,
				Title:       s.Title,
				IsCompleted: s.IsCompleted,
				Order:       s.Order,
			})
		}
	}

	return resp
}

// ctxUserID 从 ctx 取出 user_id
func ctxUserID(ctx context.Context) string {
	return g.RequestFromCtx(ctx).GetCtxVar("user_id").String()
}

// ctxRole 从 ctx 取出 role
func ctxRole(ctx context.Context) string {
	return g.RequestFromCtx(ctx).GetCtxVar("role").String()
}

// checkTaskOwner 校验任务所有权，返回任务对象
func checkTaskOwner(ctx context.Context, id string) (*model.Task, error) {
	uid := ctxUserID(ctx)
	if uid == "" {
		return nil, gerror.NewCode(ecode.AuthTokenMissing)
	}
	t, err := dao.Task.GetByID(ctx, id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, gerror.NewCode(ecode.TaskNotFound)
		}
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "查询任务失败")
	}
	if t.UserID != uid && ctxRole(ctx) != model.RoleAdmin {
		return nil, gerror.NewCode(ecode.TaskAccessDenied)
	}
	return t, nil
}

// checkSubtasksAutoComplete 检查子任务是否全部完成，如果是则自动将父任务设为 done
func checkSubtasksAutoComplete(ctx context.Context, taskID string) error {
	total, err := dao.Subtask.CountByTaskID(ctx, taskID)
	if err != nil {
		return err
	}
	if total == 0 {
		return nil // 没有子任务，不自动完成
	}
	completed, err := dao.Subtask.CountCompletedByTaskID(ctx, taskID)
	if err != nil {
		return err
	}
	if completed == total {
		// 所有子任务都完成了 → 自动标记父任务 done
		now := time.Now()
		return dao.Task.Update(ctx, taskID, map[string]any{
			"status":       model.TaskStatusDone,
			"completed_at": now,
		})
	}
	return nil
}

// buildSubtasks 将 DTO 子任务列表转为 model 列表（用于创建/全量替换）
func buildSubtasks(taskID string, reqs []dto.SubtaskReq) []model.Subtask {
	items := make([]model.Subtask, 0, len(reqs))
	for i, r := range reqs {
		id := r.ID
		if id == "" {
			id = utility.NewID("st")
		}
		isCompleted := false
		if r.IsCompleted != nil {
			isCompleted = *r.IsCompleted
		}
		order := r.Order
		if order == 0 {
			order = i
		}
		items = append(items, model.Subtask{
			ID:          id,
			TaskID:      taskID,
			Title:       strings.TrimSpace(r.Title),
			IsCompleted: isCompleted,
			Order:       order,
		})
	}
	return items
}

// ====== Create ======

func (s *TaskService) Create(ctx context.Context, req *dto.CreateTaskReq) (*dto.TaskResp, error) {
	uid := ctxUserID(ctx)
	if uid == "" {
		return nil, gerror.NewCode(ecode.AuthTokenMissing)
	}
	if strings.TrimSpace(req.Title) == "" {
		return nil, gerror.NewCode(ecode.TaskTitleEmpty)
	}

	priority := req.Priority
	if priority == "" {
		priority = model.TaskPriorityNormal
	}

	t := &model.Task{
		ID:       utility.NewID("t"),
		UserID:   uid,
		Title:    strings.TrimSpace(req.Title),
		Priority: priority,
		Status:   model.TaskStatusTodo,
	}

	if strings.TrimSpace(req.Description) != "" {
		d := strings.TrimSpace(req.Description)
		t.Description = &d
	}
	if req.CategoryID != "" {
		c := req.CategoryID
		t.CategoryID = &c
	}
	if req.DueDate != "" {
		dd, err := time.ParseInLocation("2006-01-02", req.DueDate, time.Local)
		if err != nil {
			return nil, gerror.NewCode(ecode.TaskDueDateInvalid)
		}
		t.DueDate = &dd
	}
	if req.DueTime != "" {
		dt := req.DueTime
		t.DueTime = &dt
	}
	if req.ReminderAt != "" {
		ra, err := time.ParseInLocation(time.RFC3339, req.ReminderAt, time.Local)
		if err != nil {
			// 尝试仅日期格式
			ra, err = time.ParseInLocation("2006-01-02T15:04", req.ReminderAt, time.Local)
			if err != nil {
				return nil, gerror.NewCode(ecode.TaskDueDateInvalid)
			}
		}
		t.ReminderAt = &ra
	}
	if req.RecurrenceRule != "" {
		rr := req.RecurrenceRule
		t.RecurrenceRule = &rr
	}

	// 子任务
	subtaskModels := buildSubtasks(t.ID, req.Subtasks)
	t.SubtasksCount = len(subtaskModels)

	if err := dao.Task.Create(ctx, t); err != nil {
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "创建任务失败")
	}

	// 批量创建子任务
	if len(subtaskModels) > 0 {
		if err := dao.Subtask.BatchCreate(ctx, subtaskModels); err != nil {
			return nil, gerror.WrapCode(ecode.DatabaseError, err, "创建子任务失败")
		}
	}

	return taskToResp(t, subtaskModels), nil
}

// ====== List ======

func (s *TaskService) List(ctx context.Context, req *dto.ListTasksReq) (*dto.ListTasksResp, error) {
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

	items, total, err := dao.Task.List(ctx, dao.TaskListOptions{
		UserID:   uid,
		Filter:   req.Filter,
		Status:   req.Status,
		Priority: req.Priority,
		Keyword:  req.Keyword,
		Sort:     req.Sort,
		Page:     page,
		PageSize: pageSize,
	})
	if err != nil {
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "查询任务列表失败")
	}

	out := make([]dto.TaskResp, 0, len(items))
	for i := range items {
		// 列表不查子任务详情，只返回 count
		out = append(out, *taskToResp(&items[i], nil))
	}
	return &dto.ListTasksResp{
		Items: out,
		Total: total,
		Page:  page,
	}, nil
}

// ====== Get ======

func (s *TaskService) Get(ctx context.Context, id string) (*dto.TaskResp, error) {
	t, err := checkTaskOwner(ctx, id)
	if err != nil {
		return nil, err
	}
	// 详情页查子任务
	subtasks, _ := dao.Subtask.ListByTaskID(ctx, t.ID)
	return taskToResp(t, subtasks), nil
}

// ====== Update ======

func (s *TaskService) Update(ctx context.Context, id string, req *dto.UpdateTaskReq) (*dto.TaskResp, error) {
	exist, err := checkTaskOwner(ctx, id)
	if err != nil {
		return nil, err
	}

	// 构造更新字段
	updates := map[string]any{}
	if req.Title != nil {
		t := strings.TrimSpace(*req.Title)
		if t == "" {
			return nil, gerror.NewCode(ecode.TaskTitleEmpty)
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
	if req.Priority != nil {
		updates["priority"] = *req.Priority
	}
	if req.Status != nil {
		updates["status"] = *req.Status
		if *req.Status == model.TaskStatusDone {
			if exist.Status != model.TaskStatusDone {
				updates["completed_at"] = time.Now()
			}
		} else {
			updates["completed_at"] = nil
		}
	}
	if req.CategoryID != nil {
		if *req.CategoryID == "" {
			updates["category_id"] = nil
		} else {
			updates["category_id"] = *req.CategoryID
		}
	}
	if req.DueDate != nil {
		if *req.DueDate == "" {
			updates["due_date"] = nil
		} else {
			dd, perr := time.ParseInLocation("2006-01-02", *req.DueDate, time.Local)
			if perr != nil {
				return nil, gerror.NewCode(ecode.TaskDueDateInvalid)
			}
			updates["due_date"] = dd
		}
	}
	if req.DueTime != nil {
		if *req.DueTime == "" {
			updates["due_time"] = nil
		} else {
			updates["due_time"] = *req.DueTime
		}
	}
	if req.ReminderAt != nil {
		if *req.ReminderAt == "" {
			updates["reminder_at"] = nil
		} else {
			ra, perr := time.ParseInLocation(time.RFC3339, *req.ReminderAt, time.Local)
			if perr != nil {
				ra, perr = time.ParseInLocation("2006-01-02T15:04", *req.ReminderAt, time.Local)
				if perr != nil {
					return nil, gerror.NewCode(ecode.TaskDueDateInvalid)
				}
			}
			updates["reminder_at"] = ra
		}
	}
	if req.RecurrenceRule != nil {
		if *req.RecurrenceRule == "" {
			updates["recurrence_rule"] = nil
		} else {
			updates["recurrence_rule"] = *req.RecurrenceRule
		}
	}

	// 子任务全量替换
	if req.Subtasks != nil {
		subtaskModels := buildSubtasks(id, req.Subtasks)
		updates["subtasks_count"] = len(subtaskModels)

		// 在事务中替换子任务
		if err := dao.DB.Transaction(func(tx *gorm.DB) error {
			// 删旧子任务
			if err := tx.Where("task_id = ?", id).Delete(&model.Subtask{}).Error; err != nil {
				return err
			}
			// 插新子任务
			if len(subtaskModels) > 0 {
				if err := tx.Create(&subtaskModels).Error; err != nil {
					return err
				}
			}
			// 更新任务字段
			if len(updates) > 0 {
				if err := tx.Model(&model.Task{}).Where("id = ?", id).Updates(updates).Error; err != nil {
					return err
				}
			}
			return nil
		}); err != nil {
			return nil, gerror.WrapCode(ecode.DatabaseError, err, "更新任务（含子任务）失败")
		}

		// 检查子任务自动完成
		_ = checkSubtasksAutoComplete(ctx, id)

		// 重新查
		fresh, err := dao.Task.GetByID(ctx, id)
		if err != nil {
			return nil, gerror.WrapCode(ecode.DatabaseError, err, "重新查询任务失败")
		}
		subtasks, _ := dao.Subtask.ListByTaskID(ctx, id)
		return taskToResp(fresh, subtasks), nil
	}

	if len(updates) == 0 {
		subtasks, _ := dao.Subtask.ListByTaskID(ctx, id)
		return taskToResp(exist, subtasks), nil
	}

	if err := dao.Task.Update(ctx, id, updates); err != nil {
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "更新任务失败")
	}

	fresh, err := dao.Task.GetByID(ctx, id)
	if err != nil {
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "重新查询任务失败")
	}
	subtasks, _ := dao.Subtask.ListByTaskID(ctx, id)
	return taskToResp(fresh, subtasks), nil
}

// ====== ToggleComplete ======

func (s *TaskService) ToggleComplete(ctx context.Context, id string) (*dto.TaskResp, error) {
	exist, err := checkTaskOwner(ctx, id)
	if err != nil {
		return nil, err
	}

	updates := map[string]any{}
	if exist.Status == model.TaskStatusDone {
		updates["status"] = model.TaskStatusTodo
		updates["completed_at"] = nil
	} else {
		updates["status"] = model.TaskStatusDone
		updates["completed_at"] = time.Now()
	}

	if err := dao.Task.Update(ctx, id, updates); err != nil {
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "切换任务状态失败")
	}

	fresh, err := dao.Task.GetByID(ctx, id)
	if err != nil {
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "重新查询任务失败")
	}
	subtasks, _ := dao.Subtask.ListByTaskID(ctx, id)
	return taskToResp(fresh, subtasks), nil
}

// ====== Delete ======

func (s *TaskService) Delete(ctx context.Context, id string) error {
	if _, err := checkTaskOwner(ctx, id); err != nil {
		return err
	}
	// 先删子任务
	if err := dao.Subtask.DeleteByTaskID(ctx, id); err != nil {
		return gerror.WrapCode(ecode.DatabaseError, err, "删除子任务失败")
	}
	if err := dao.Task.Delete(ctx, id); err != nil {
		return gerror.WrapCode(ecode.DatabaseError, err, "删除任务失败")
	}
	return nil
}

// ====== BatchAction ======

func (s *TaskService) BatchAction(ctx context.Context, req *dto.BatchTaskReq) (*dto.BatchTaskResp, error) {
	uid := ctxUserID(ctx)
	if uid == "" {
		return nil, gerror.NewCode(ecode.AuthTokenMissing)
	}
	if len(req.TaskIDs) == 0 {
		return &dto.BatchTaskResp{Affected: 0}, nil
	}

	var affected int64

	switch req.Action {
	case "complete":
		now := time.Now()
		for _, id := range req.TaskIDs {
			t, err := dao.Task.GetByID(ctx, id)
			if err != nil || t.UserID != uid {
				continue
			}
			if t.Status == model.TaskStatusDone {
				continue
			}
			if err := dao.Task.Update(ctx, id, map[string]any{
				"status":       model.TaskStatusDone,
				"completed_at": now,
			}); err == nil {
				affected++
			}
		}
	case "delete":
		for _, id := range req.TaskIDs {
			t, err := dao.Task.GetByID(ctx, id)
			if err != nil || t.UserID != uid {
				continue
			}
			// 删子任务
			_ = dao.Subtask.DeleteByTaskID(ctx, id)
			if err := dao.Task.Delete(ctx, id); err == nil {
				affected++
			}
		}
	default:
		return nil, gerror.NewCode(ecode.ValidationFailed)
	}

	return &dto.BatchTaskResp{Affected: affected}, nil
}

// ====== ToggleSubtask ======

func (s *TaskService) ToggleSubtask(ctx context.Context, taskID string, subtaskID string) (*dto.TaskResp, error) {
	if _, err := checkTaskOwner(ctx, taskID); err != nil {
		return nil, err
	}

	sub, err := dao.Subtask.GetByID(ctx, subtaskID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, gerror.NewCode(ecode.TaskNotFound)
		}
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "查询子任务失败")
	}
	if sub.TaskID != taskID {
		return nil, gerror.NewCode(ecode.TaskAccessDenied)
	}

	// 切换完成状态
	newCompleted := !sub.IsCompleted
	if err := dao.Subtask.Update(ctx, subtaskID, map[string]any{
		"is_completed": newCompleted,
	}); err != nil {
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "切换子任务状态失败")
	}

	// 检查是否所有子任务都完成了 → 自动完成父任务
	_ = checkSubtasksAutoComplete(ctx, taskID)

	// 返回完整任务（含子任务）
	fresh, err := dao.Task.GetByID(ctx, taskID)
	if err != nil {
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "重新查询任务失败")
	}
	subtasks, _ := dao.Subtask.ListByTaskID(ctx, taskID)
	return taskToResp(fresh, subtasks), nil
}
