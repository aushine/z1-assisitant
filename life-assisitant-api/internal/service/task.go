// Package service 任务服务接口
// M5 扩展：子任务 / 提醒 / 重复 / 批量操作
package service

import (
	"context"

	"github.com/life-assistant/api/internal/model/dto"
)

// ITaskService 任务服务
type ITaskService interface {
	// Create 创建任务（含子任务）
	Create(ctx context.Context, req *dto.CreateTaskReq) (*dto.TaskResp, error)
	// List 任务列表
	List(ctx context.Context, req *dto.ListTasksReq) (*dto.ListTasksResp, error)
	// Get 任务详情（含子任务）
	Get(ctx context.Context, id string) (*dto.TaskResp, error)
	// Update 部分更新（含子任务全量替换）
	Update(ctx context.Context, id string, req *dto.UpdateTaskReq) (*dto.TaskResp, error)
	// ToggleComplete 切换完成状态：todo <-> done
	ToggleComplete(ctx context.Context, id string) (*dto.TaskResp, error)
	// Delete 软删
	Delete(ctx context.Context, id string) error
	// BatchAction 批量操作（complete / delete）
	BatchAction(ctx context.Context, req *dto.BatchTaskReq) (*dto.BatchTaskResp, error)
	// ToggleSubtask 切换子任务完成状态
	ToggleSubtask(ctx context.Context, taskID string, subtaskID string) (*dto.TaskResp, error)
}
