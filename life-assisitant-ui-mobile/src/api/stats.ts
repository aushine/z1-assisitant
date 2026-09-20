/**
 * 统计模块 API
 * 路径前缀：/stats
 *
 * SYNC-FROM-BACKEND: life-assisitant-api/internal/controller/stats.go
 *                    life-assisitant-api/internal/model/dto/stats.go
 * 最后同步：2026-09-18
 *
 * ⚠️ 区间取值是 **7d / 30d / 90d / custom**（后端默认 30d），
 *    不是旧移动端的 week/month/year —— 传错会被 service 判为
 *    StatsRangeInvalid（400502）。
 *
 * ⚠️ rate 口径：StatsOverview.week_completion_rate 是 0-100（百分比），
 *    其余 TaskStats.completion_rate / TaskDayStat.rate 等是 0-1。
 */
import { http } from './request'
import type {
  ExportParams,
  ExportType,
  FinanceStats,
  HabitStats,
  StatsOverview,
  StatsRange,
  StatsRangeQuery,
  TaskStats,
} from './types'

export type { ExportType, StatsRange }

/** @deprecated 用 StatsRangeQuery */
export type StatsRangeParams = StatsRangeQuery

export const statsApi = {
  /**
   * 统计概览（GET /stats/overview，stat:view）
   * 注意：该接口**不接收** range 参数，恒为「今日 + 本周 + 本月」口径。
   */
  getOverview(): Promise<StatsOverview> {
    return http.get<StatsOverview>('/stats/overview')
  },

  /** 任务统计（GET /stats/tasks?range=30d） */
  taskStats(params: StatsRangeQuery = {}): Promise<TaskStats> {
    return http.get<TaskStats>('/stats/tasks', { params })
  },

  /** 习惯统计（GET /stats/habits?range=30d[&start_date&end_date]） */
  habitStats(params: StatsRangeQuery = {}): Promise<HabitStats> {
    return http.get<HabitStats>('/stats/habits', { params })
  },

  /** 财务统计（GET /stats/finance?range=30d） */
  financeStats(params: StatsRangeQuery = {}): Promise<FinanceStats> {
    return http.get<FinanceStats>('/stats/finance', { params })
  },

  /**
   * 导出 CSV（GET /stats/export，stat:export）
   * 后端直接写文件流（带 UTF-8 BOM，Excel 友好），**不是** JSON 包装，
   * 所以必须走 responseType: 'blob'，拦截器会把 Blob 原样透传出来。
   */
  exportCSV(params: ExportParams): Promise<Blob> {
    return http.get<Blob>('/stats/export', { params, responseType: 'blob' })
  },
}
