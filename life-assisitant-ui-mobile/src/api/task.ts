/**
 * 任务模块 API
 * 路径前缀：/tasks（详见 spec/04-API规范.md + spec/11-任务.md）
 * 端点遵循 spec/11-任务.md §8
 */
import { http } from './request'
import type {
  BatchTaskReq,
  BatchTaskResp,
  CreateTaskReq,
  ListTasksResp,
  Task,
  TaskFilter,
  TaskPriority,
  TaskStatus,
  UpdateTaskReq,
} from './types'

/** 列表查询参数 */
export interface ListTasksParams {
  filter?: TaskFilter
  priority?: TaskPriority
  keyword?: string
  page?: number
  page_size?: number
  sort?: string
}

export const taskApi = {
  /**
   * 列出任务（支持筛选 + 分页）
   * GET /tasks?filter=today&page=1&page_size=20
   */
  list(params: ListTasksParams = {}): Promise<ListTasksResp> {
    return http.get<ListTasksResp>('/tasks', { params })
  },

  /**
   * 获取单个任务
   * GET /tasks/:id
   */
  get(id: string): Promise<Task> {
    return http.get<Task>(`/tasks/${id}`)
  },

  /**
   * 创建任务
   * POST /tasks
   */
  create(data: CreateTaskReq): Promise<Task> {
    return http.post<Task>('/tasks', data)
  },

  /**
   * 部分更新任务（含状态变更）
   * PATCH /tasks/:id
   */
  update(id: string, data: UpdateTaskReq): Promise<Task> {
    return http.patch<Task>(`/tasks/${id}`, data)
  },

  /**
   * 切换完成状态（便捷方法：等价于 update(id, { status })）
   * PATCH /tasks/:id { status: 'done' | 'todo' }
   */
  toggleComplete(id: string, status: TaskStatus): Promise<Task> {
    return http.patch<Task>(`/tasks/${id}`, { status })
  },

  /**
   * 删除任务（软删除，30 天后物理删除）
   * DELETE /tasks/:id
   */
  delete(id: string): Promise<void> {
    return http.delete<void>(`/tasks/${id}`)
  },

  /**
   * 批量操作（批量完成 / 批量删除）
   * POST /tasks/batch
   */
  batchAction(data: BatchTaskReq): Promise<BatchTaskResp> {
    return http.post<BatchTaskResp>('/tasks/batch', data)
  },

  /**
   * 切换子任务完成状态
   * PATCH /tasks/:id/subtasks/:subtaskId
   */
  toggleSubtask(taskId: string, subtaskId: string): Promise<Task> {
    return http.patch<Task>(`/tasks/${taskId}/subtasks/${subtaskId}`)
  },
}
