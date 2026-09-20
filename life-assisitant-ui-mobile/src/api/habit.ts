/**
 * 习惯模块 API
 * 路径前缀：/habits
 *
 * SYNC-FROM-BACKEND: life-assisitant-api/internal/controller/habit.go
 *                    life-assisitant-api/internal/model/dto/habit.go
 * 最后同步：2026-09-18
 *
 * ⚠️ 修掉的既有缺陷：
 *   - `list()` 原传 `include_today`，后端无此参数（会静默忽略）；今日进度
 *     其实由 /habits 自动填充 today_count / today_completed / today_date。
 *   - `getTodayHabits()` 原声明返回 ListHabitsResp，后端实际返回
 *     TodayHabitsResp（{date, items, total, done_count}），已修正。
 *
 * ⚠️ 刻意**不包装** `GET /habits/:id`（Phase 7 按 §9「零已实现但无调用」清理）：
 *    习惯列表与今日接口都返回全字段，编辑弹层直接用列表项；单取一条没有 UI 场景。
 */
import { http } from './request'
import type {
  CreateHabitReq,
  Habit,
  ListHabitsQuery,
  ListHabitsResp,
  LogHabitReq,
  TodayHabitsResp,
  UpdateHabitReq,
} from './types'

export const habitApi = {
  /**
   * 习惯列表（GET /habits，habit:view）
   * 走 response.Page，含 { items, total, page, page_size, has_more }。
   * 每条 item 已带 today_count / today_completed / today_date。
   */
  list(params: ListHabitsQuery = {}): Promise<ListHabitsResp> {
    return http.get<ListHabitsResp>('/habits', { params })
  },

  /**
   * 今日习惯（GET /habits/today，habit:view）
   * 与 list 的差别是返回 done_count 汇总，且 date 可指定历史某天。
   */
  getTodayHabits(date?: string): Promise<TodayHabitsResp> {
    return http.get<TodayHabitsResp>('/habits/today', { params: date ? { date } : {} })
  },

  /** 创建习惯（POST /habits，habit:create） */
  create(data: CreateHabitReq): Promise<Habit> {
    return http.post<Habit>('/habits', data)
  },

  /** 更新习惯（PATCH /habits/:id，habit:update） */
  update(id: string, data: UpdateHabitReq): Promise<Habit> {
    return http.patch<Habit>(`/habits/${id}`, data)
  },

  /** 删除习惯（DELETE /habits/:id，habit:delete；204 无响应体） */
  delete(id: string): Promise<void> {
    return http.delete<void>(`/habits/${id}`)
  },

  /**
   * 打卡（POST /habits/:id/log，habit:checkin）
   * ⚠️ 字段名是 `date`（YYYY-MM-DD）**不是** `log_date` —— 写错会 400，
   *    也不会有任何提示，表现为「点了没反应」。
   * 同一天同习惯只有一条 log，重复打卡是 count 累加（upsert）。
   */
  log(id: string, data: LogHabitReq): Promise<Habit> {
    return http.post<Habit>(`/habits/${id}/log`, data)
  },
}
