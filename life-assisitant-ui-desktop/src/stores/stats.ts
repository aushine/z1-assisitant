import { create } from 'zustand'
import { statsApi } from '@/api/stats'
import { homeApi } from '@/api/home'
import type {
  HomeResp,
  StatsOverview,
  TaskStats,
  HabitStats,
  FinanceStats,
} from '@/api/types'

type RangeKey = '7d' | '30d' | '90d'

interface StatsStore {
  // 首页聚合
  homeData: HomeResp | null
  homeLoading: boolean
  fetchHome: () => Promise<void>

  // 概览
  overview: StatsOverview | null
  overviewLoading: boolean
  fetchOverview: () => Promise<void>

  // 任务统计
  taskStats: TaskStats | null
  taskStatsLoading: boolean
  fetchTaskStats: (range: RangeKey) => Promise<void>

  // 习惯统计
  habitStats: HabitStats | null
  habitStatsLoading: boolean
  fetchHabitStats: (range: RangeKey) => Promise<void>

  // 财务统计
  financeStats: FinanceStats | null
  financeStatsLoading: boolean
  fetchFinanceStats: (range: RangeKey) => Promise<void>

  // 导出
  exportCSV: (range: RangeKey, type: 'tasks' | 'habits' | 'transactions' | 'all') => Promise<void>

  // 便捷：加载所有统计（指定 range）
  fetchAll: (range: RangeKey) => Promise<void>
}

export const useStatsStore = create<StatsStore>((set, get) => ({
  homeData: null,
  homeLoading: false,

  overview: null,
  overviewLoading: false,

  taskStats: null,
  taskStatsLoading: false,

  habitStats: null,
  habitStatsLoading: false,

  financeStats: null,
  financeStatsLoading: false,

  async fetchHome() {
    set({ homeLoading: true })
    try {
      const homeData = await homeApi.fetch()
      set({ homeData })
    } catch {
      set({ homeData: null })
    } finally {
      set({ homeLoading: false })
    }
  },

  /**
   * 概览 KPI 是「固定维度」聚合（今日任务 / 本周完成率 / 本月收支 / 总余额 / 今日习惯）。
   * 后端 GET /stats/overview 不接受 range 参数（见 controller/stats.go GetOverview），
   * 因此概览不随 7d/30d/90d 切换；需要 range 的 KPI 请用 fetchTaskStats / fetchHabitStats / fetchFinanceStats。
   */
  async fetchOverview() {
    set({ overviewLoading: true })
    try {
      const overview = await statsApi.overview()
      set({ overview })
    } catch {
      set({ overview: null })
    } finally {
      set({ overviewLoading: false })
    }
  },

  async fetchTaskStats(range) {
    set({ taskStatsLoading: true })
    try {
      const taskStats = await statsApi.taskStats({ range })
      set({ taskStats })
    } catch {
      set({ taskStats: null })
    } finally {
      set({ taskStatsLoading: false })
    }
  },

  async fetchHabitStats(range) {
    set({ habitStatsLoading: true })
    try {
      const habitStats = await statsApi.habitStats({ range })
      set({ habitStats })
    } catch {
      set({ habitStats: null })
    } finally {
      set({ habitStatsLoading: false })
    }
  },

  async fetchFinanceStats(range) {
    set({ financeStatsLoading: true })
    try {
      const financeStats = await statsApi.financeStats({ range })
      set({ financeStats })
    } catch {
      set({ financeStats: null })
    } finally {
      set({ financeStatsLoading: false })
    }
  },

  async exportCSV(range, type) {
    const blob = await statsApi.exportCSV({ range, type, format: 'csv' })
    // 触发浏览器下载
    const url = window.URL.createObjectURL(blob as unknown as Blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `export-${type}-${range}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    window.URL.revokeObjectURL(url)
  },

  async fetchAll(range) {
    await Promise.all([
      get().fetchOverview(),
      get().fetchTaskStats(range),
      get().fetchHabitStats(range),
      get().fetchFinanceStats(range),
    ])
  },
}))
