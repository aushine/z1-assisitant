/**
 * Stats Store（统计模块）
 *
 * SYNC-FROM-BACKEND: life-assisitant-api/internal/controller/stats.go
 *
 * 设计要点（对齐 md/移动端移植方案.md §5 P2 / §R5）：
 *   - 4 个 stats 接口用 Promise.allSettled **并发**拉取，单个失败不影响其余，
 *     避免一个接口挂掉整页白屏（桌面端是串行 + 静默吞错，移动端不照抄）。
 *   - 错误**直接暴露**为 error 状态给页面渲染 ErrorState，不做 store 静默吞错。
 *   - 区间取值 7d / 30d / 90d / custom，对齐桌面端（不再是 week/month/year）。
 */
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { statsApi } from '@/api/stats'
import type {
  ExportParams,
  FinanceStats,
  HabitStats,
  StatsOverview,
  StatsRange,
  TaskStats,
} from '@/api/types'

/** 各分区独立的加载/错误状态 */
export interface SectionState {
  loading: boolean
  /** null 表示无错误；字符串为可直接展示的提示 */
  error: string | null
}

function emptySection(): SectionState {
  return { loading: false, error: null }
}

/**
 * 统计区间选项（与桌面端 7/30/90 天一致）
 *
 * ⚠️ 260919 v1（spec 05 §3）：区间已从「二级 tab」降为**页内 chips**，
 *    本数组现在是 chips 的数据源，不再是 SubTabBar 的数据源（那是 STAT_SECTIONS）。
 */
export const STATS_RANGES: ReadonlyArray<{ value: StatsRange; label: string }> = [
  { value: '7d', label: '近 7 天' },
  { value: '30d', label: '近 30 天' },
  { value: '90d', label: '近 90 天' },
]

/**
 * 统计领域（二级 tab 的值域，spec 05 §2）
 *
 * 改造前二级 tab 装的是**区间**（7/30/90 天）—— 但区间是「参数」不是「视图」，
 * SubTabBar 的语义是「同一实体的不同视图」。用一个全局区间服务所有领域必然
 * 有一半领域错配（体重看 7 天只是噪声，财务 30 天才对得上月度预算心智）。
 */
export type StatsSection = 'overview' | 'health' | 'finance' | 'habit'

export const STAT_SECTIONS: ReadonlyArray<{ value: StatsSection; label: string }> = [
  { value: 'overview', label: '总览' },
  { value: 'health', label: '健康' },
  { value: 'finance', label: '财务' },
  { value: 'habit', label: '习惯' },
]

/**
 * 各领域的**默认区间**（spec 05 §3）
 *
 * ⚠️ 切领域时必须重置为该领域的默认值，而不是沿用上一个领域的 ——
 *    否则会出现「我在财务选了 90 天，切到习惯还是 90 天」的错位，
 *    用户不会理解为什么视图「变味」了。
 */
export const DEFAULT_RANGE_BY_SECTION: Record<StatsSection, StatsRange> = {
  overview: '7d', // 「这周过得怎么样」
  health: '90d', // 体重/体温需要更长跨度才有趋势；7 天只是噪声
  finance: '30d', // 与月度预算的心智对齐
  habit: '30d', // 4 周热力图是习惯的经典视图
}

export const useStatsStore = defineStore('stats', () => {
  // ==================== state ====================
  const overview = ref<StatsOverview | null>(null)
  const taskStats = ref<TaskStats | null>(null)
  const habitStats = ref<HabitStats | null>(null)
  const financeStats = ref<FinanceStats | null>(null)

  const range = ref<StatsRange>('30d')
  /** 当前领域（二级 tab 的真正值域）；初始值取「总览」的默认区间配套 */
  const section = ref<StatsSection>('overview')
  /** 概览接口不接受 range 参数，单独一个 loading */
  const overviewState = ref<SectionState>(emptySection())
  const taskState = ref<SectionState>(emptySection())
  const habitState = ref<SectionState>(emptySection())
  const financeState = ref<SectionState>(emptySection())

  const exporting = ref(false)

  // ==================== getters ====================
  /** 任一分区在加载 */
  const loading = computed(
    () =>
      overviewState.value.loading ||
      taskState.value.loading ||
      habitState.value.loading ||
      financeState.value.loading
  )

  /** 首屏是否完全空（用于整体空态判定） */
  const isEmpty = computed(
    () =>
      !overview.value && !taskStats.value && !habitStats.value && !financeStats.value
  )

  /** 是否有任一分区出错（页面用来决定是否显示「部分数据加载失败」提示条） */
  const hasError = computed(
    () =>
      !!overviewState.value.error ||
      !!taskState.value.error ||
      !!habitState.value.error ||
      !!financeState.value.error
  )

  // ==================== actions ====================

  /** 从异常里取可读文案（ApiError 已带 message） */
  function errText(e: unknown, fallback: string): string {
    if (e instanceof Error && e.message) return e.message
    return fallback
  }

  /**
   * 拉取统计概览（GET /stats/overview，无 range 参数）
   * 概览是 KPI 区的主数据，失败时清空以免显示陈旧数值。
   */
  async function fetchOverview(): Promise<void> {
    overviewState.value = { loading: true, error: null }
    try {
      overview.value = await statsApi.getOverview()
    } catch (e) {
      overview.value = null
      overviewState.value = { loading: false, error: errText(e, '概览数据加载失败') }
      return
    }
    overviewState.value = { loading: false, error: null }
  }

  /**
   * 并发拉取三个区间统计（tasks / habits / finance）。
   * 用 allSettled：任一失败只标该分区错误，其余照常渲染。
   */
  async function fetchRangeStats(customRange?: StatsRange): Promise<void> {
    if (customRange) range.value = customRange
    const params = { range: range.value }

    taskState.value = { loading: true, error: null }
    habitState.value = { loading: true, error: null }
    financeState.value = { loading: true, error: null }

    const [t, h, f] = await Promise.allSettled([
      statsApi.taskStats(params),
      statsApi.habitStats(params),
      statsApi.financeStats(params),
    ])

    if (t.status === 'fulfilled') {
      taskStats.value = t.value
      taskState.value = { loading: false, error: null }
    } else {
      taskStats.value = null
      taskState.value = { loading: false, error: errText(t.reason, '任务统计加载失败') }
    }

    if (h.status === 'fulfilled') {
      habitStats.value = h.value
      habitState.value = { loading: false, error: null }
    } else {
      habitStats.value = null
      habitState.value = { loading: false, error: errText(h.reason, '习惯统计加载失败') }
    }

    if (f.status === 'fulfilled') {
      financeStats.value = f.value
      financeState.value = { loading: false, error: null }
    } else {
      financeStats.value = null
      financeState.value = { loading: false, error: errText(f.reason, '财务统计加载失败') }
    }
  }

  /** 整页刷新：概览 + 三个区间统计并发 */
  async function refresh(): Promise<void> {
    await Promise.all([fetchOverview(), fetchRangeStats()])
  }

  /**
   * 切领域（由 SubTabBar 经 usePageChrome 调用）。
   *
   * ⚠️ 切领域会**连带重置区间**为该领域默认值（spec 05 §3）——
   *    这是本方法唯一的副作用，也是「各领域时间跨度根本不同」这条事实的必然结果。
   *    领域没变时不做事（避免反复触发请求）。
   */
  async function setSection(s: StatsSection): Promise<void> {
    if (s === section.value) return
    section.value = s
    await fetchRangeStats(DEFAULT_RANGE_BY_SECTION[s])
  }

  /** 切区间只影响区间统计（概览与区间无关） */
  async function setRange(r: StatsRange): Promise<void> {
    if (r === range.value) return
    await fetchRangeStats(r)
  }

  /**
   * 导出 CSV 并触发浏览器下载。
   * 后端直接返回文件流（带 UTF-8 BOM），不走 JSON 包装。
   */
  async function exportCSV(params: ExportParams, filename?: string): Promise<boolean> {
    exporting.value = true
    try {
      const blob = await statsApi.exportCSV(params)
      triggerDownload(blob, filename ?? defaultFilename(params))
      return true
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[StatsStore] exportCSV failed', e)
      return false
    } finally {
      exporting.value = false
    }
  }

  function reset(): void {
    overview.value = null
    taskStats.value = null
    habitStats.value = null
    financeStats.value = null
    range.value = DEFAULT_RANGE_BY_SECTION.overview
    section.value = 'overview'
    overviewState.value = emptySection()
    taskState.value = emptySection()
    habitState.value = emptySection()
    financeState.value = emptySection()
  }

  return {
    // state
    overview,
    taskStats,
    habitStats,
    financeStats,
    range,
    section,
    overviewState,
    taskState,
    habitState,
    financeState,
    exporting,
    // getters
    loading,
    isEmpty,
    hasError,
    // actions
    fetchOverview,
    fetchRangeStats,
    refresh,
    setSection,
    setRange,
    exportCSV,
    reset,
  }
})

/** 生成导出文件名（后端 Content-Disposition 在 blob 模式下拿不到，前端自造） */
function defaultFilename(params: ExportParams): string {
  const stamp = params.range ?? '30d'
  const typeLabel: Record<ExportParams['type'], string> = {
    all: '全部',
    transactions: '交易',
    tasks: '任务',
    habits: '习惯',
  }
  return `life-${typeLabel[params.type] ?? params.type}-${stamp}.csv`
}

/** 触发浏览器下载（移动端会走系统下载/分享） */
function triggerDownload(blob: Blob, filename: string): void {
  const url = window.URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  // 交给下一轮事件循环再释放，避免部分浏览器取消下载
  window.setTimeout(() => window.URL.revokeObjectURL(url), 1000)
}
