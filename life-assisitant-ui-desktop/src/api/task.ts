import request from './request'
import type {
  Task,
  CreateTaskReq,
  UpdateTaskReq,
  ListTasksQuery,
  ListTasksResp,
  TaskFilter,
  TaskStatus,
  BatchTaskReq,
  BatchTaskResp,
} from './types'

/**
 * 任务 API
 * 规范：md/spec/11-任务.md · 8 数据结构
 * - 列表：GET /tasks?filter=&page=&page_size=&priority=&keyword=
 * - 创建：POST /tasks
 * - 更新：PATCH /tasks/:id
 * - 删除：DELETE /tasks/:id
 * M5 扩展：
 * - 批量操作：POST /tasks/batch
 * - 子任务切换：PATCH /tasks/:id/subtasks/:subtaskId
 */
export const taskApi = {
  /** 获取任务列表 */
  list(params?: ListTasksQuery) {
    return request.get<unknown, ListTasksResp>('/tasks', { params })
  },

  /** 获取单个任务 */
  get(id: string) {
    return request.get<unknown, Task>(`/tasks/${id}`)
  },

  /** 创建任务 */
  create(data: CreateTaskReq) {
    return request.post<unknown, Task>('/tasks', data)
  },

  /** 更新任务（全字段可选） */
  update(id: string, data: UpdateTaskReq) {
    return request.patch<unknown, Task>(`/tasks/${id}`, data)
  },

  /**
   * 切换完成状态
   * - 切到 done → 后端会回填 completed_at
   * - 从 done 切走 → 后端会清空 completed_at
   */
  toggleComplete(id: string, status: TaskStatus) {
    return request.patch<unknown, Task>(`/tasks/${id}`, { status })
  },

  /** 删除（软删除） */
  remove(id: string) {
    return request.delete(`/tasks/${id}`)
  },

  /** 批量操作（complete / delete） */
  batchAction(data: BatchTaskReq) {
    return request.post<unknown, BatchTaskResp>('/tasks/batch', data)
  },

  /** 切换子任务完成状态 */
  toggleSubtask(taskId: string, subtaskId: string) {
    return request.patch<unknown, Task>(`/tasks/${taskId}/subtasks/${subtaskId}`)
  },
}

// 工具：让 store / 组件更易读
export type { TaskFilter }
