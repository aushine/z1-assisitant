import request from './request'
import type {
  StatsOverview,
  TaskStats,
  HabitStats,
  FinanceStats,
  ExportParams,
} from './types'

/**
 * 统计 API
 * 规范：md/spec/13-统计.md · 8.1 / 8.2 / 8.3 / 8.4
 * - 概览：GET /stats/overview
 * - 任务：GET /stats/tasks?range=
 * - 习惯：GET /stats/habits?range=
 * - 财务：GET /stats/finance?range=
 * - 导出：GET /stats/export
 */
export const statsApi = {
  /** 整体概览（首页 / 统计页 KPI 用） */
  overview() {
    return request.get<unknown, StatsOverview>('/stats/overview')
  },

  /** 任务统计 */
  taskStats(params: { range: string; start_date?: string; end_date?: string }) {
    return request.get<unknown, TaskStats>('/stats/tasks', { params })
  },

  /** 习惯统计 */
  habitStats(params: { range?: string; start_date?: string; end_date?: string }) {
    return request.get<unknown, HabitStats>('/stats/habits', { params })
  },

  /** 财务统计 */
  financeStats(params: { range: string }) {
    return request.get<unknown, FinanceStats>('/stats/finance', { params })
  },

  /** 导出 CSV（返回 blob） */
  exportCSV(params: ExportParams) {
    return request.get('/stats/export', { params, responseType: 'blob' })
  },
}
