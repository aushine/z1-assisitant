import request from './request'
import type {
  Habit,
  CreateHabitReq,
  UpdateHabitReq,
  ListHabitsQuery,
  ListHabitsResp,
  LogHabitReq,
} from './types'

/**
 * 习惯 API
 * 规范：md/spec/12-记录.md · 8 数据结构
 * - 列表：GET /habits?status=&date=
 * - 今日：GET /habits/today?date=（含 today_count / today_completed）
 * - 创建：POST /habits
 * - 更新：PATCH /habits/:id
 * - 打卡：POST /habits/:id/log
 * - 删除：DELETE /habits/:id
 */
export const habitApi = {
  /** 获取习惯列表（不含今日打卡数据） */
  list(params?: ListHabitsQuery) {
    return request.get<unknown, ListHabitsResp>('/habits', { params })
  },

  /** 获取今日习惯（含 today_count / today_completed） */
  getToday(params?: { date?: string }) {
    return request.get<unknown, { date: string; items: Habit[]; total: number; done_count: number }>('/habits/today', { params })
  },

  /** 获取单个习惯 */
  get(id: string) {
    return request.get<unknown, Habit>(`/habits/${id}`)
  },

  /** 创建习惯 */
  create(data: CreateHabitReq) {
    return request.post<unknown, Habit>('/habits', data)
  },

  /** 更新习惯 */
  update(id: string, data: UpdateHabitReq) {
    return request.patch<unknown, Habit>(`/habits/${id}`, data)
  },

  /** 删除（软删除 — 归档） */
  remove(id: string) {
    return request.delete(`/habits/${id}`)
  },

  /**
   * 打卡（累加 +1，可重复调用以累加）
   * - 后端回写 updated habit（含最新 today_count / today_done / streak）
   */
  log(id: string, data: LogHabitReq) {
    return request.post<unknown, Habit>(`/habits/${id}/log`, data)
  },
}
