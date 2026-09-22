/**
 * 统计页（React 18 + TSX）—— Chart.js + 后端统计 API。
 *
 * 本页直接调用 statsApi 并持有本地 loading/error 状态，以便区分「加载失败」与「暂无数据」。
 * 概览 KPI 是固定维度（今日任务 / 本周完成率 / 总净资产），不随 7/30/90 天筛选变化；
 * 只有「支出」卡与下方趋势/图表/明细随筛选变化（后端 GET /stats/overview 不接受 range）。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import {
  Card,
  Tabs,
  TabPane,
  Table,
  Skeleton,
  Button,
  Tooltip,
  Dropdown,
  Toast,
  RadioGroup,
  Radio,
} from '@douyinfe/semi-ui'
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table'
import { Icon, TINT_VARS } from '@/components/icon'
import { statsApi } from '@/api/stats'
import { useStatsStore } from '@/stores/stats'
import { useFinanceCategoryStore, resolveCategoryView } from '@/stores/financeCategory'
import { findCategoryByEmoji, resolveAccountIcon } from '@/utils/category-dict'
import { heatColor } from '@/utils/heatmap'
import { BarChartCard } from '@/components/charts/BarChartCard'
import { LineChartCard } from '@/components/charts/LineChartCard'
import { DoughnutCard } from '@/components/charts/DoughnutCard'
import ErrorState from '@/components/ErrorState'
import { EmptyHint } from '@/components/EmptyState'
import HealthStats from './HealthStats'
import type {
  StatsOverview,
  TaskStats,
  HabitStats,
  FinanceStats,
  FinanceCategoryStat,
  FinanceAccountStat,
  HabitHeatmapItem,
} from '@/api/types'

// ====== Range type ======
type RangeKey = '7d' | '30d' | '90d'

const rangeLabels: Record<RangeKey, string> = {
  '7d': '近 7 天',
  '30d': '近 30 天',
  '90d': '近 90 天',
}

const RANGE_OPTIONS: ReadonlyArray<{ value: RangeKey; label: string }> = [
  { value: '7d', label: '7 天' },
  { value: '30d', label: '30 天' },
  { value: '90d', label: '90 天' },
]

/**
 * 统计领域（spec 05 §2）
 *
 * ⚠️ 改造前 Tabs 装的是**区间**（7/30/90 天）。区间是「参数」不是「视图」——
 *    SubTabBar/Tabs 的语义是「同一实体的不同视图」，而不同领域需要的时间跨度
 *    根本不同（体重看 7 天只是噪声、财务 30 天才对得上月度预算心智）。
 *    区间已降为 `.page-tipbar` 右侧的 RadioGroup。
 */
type SectionKey = 'overview' | 'health' | 'finance' | 'habit'

/**
 * 各领域的**默认区间**（spec 05 §3）
 *
 * ⚠️ 切领域时必须重置为该领域默认值，不沿用上一个领域的 ——
 *    否则会出现「我在财务选了 90 天，切到习惯还是 90 天」的错位。
 */
const DEFAULT_RANGE_BY_SECTION: Record<SectionKey, RangeKey> = {
  overview: '7d', // 「这周过得怎么样」
  health: '90d', // 体重/体温需要更长跨度才有趋势；7 天只是噪声
  finance: '30d', // 与月度预算的心智对齐
  habit: '30d', // 4 周热力图是习惯的经典视图
}

// ====== Helper: money formatting ======
function formatMoney(n: number) {
  return `¥${n.toFixed(2)}`
}

// ====== Helper: SVG ring progress ======
function progressArc(pct: number, size = 80, stroke = 8) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const offset = c * (1 - Math.min(pct, 100) / 100)
  return { r, c, offset, size, stroke }
}

// ====== 图表骨架（S5：加载态不再闪「暂无数据」）======
function ChartSkeleton({ height = 260 }: { height?: number }) {
  return (
    <div style={{ height, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
      <Skeleton.Title style={{ width: '40%', marginBottom: 16 }} />
      <Skeleton.Paragraph rows={4} />
    </div>
  )
}

// ====== 区块状态包装（加载骨架 / 错误态 / 内容）======
function SectionBody({
  loading,
  error,
  onRetry,
  children,
}: {
  loading: boolean
  error: boolean
  onRetry: () => void
  children: ReactNode
}) {
  if (loading) return <ChartSkeleton />
  if (error) return <ErrorState compact message="加载失败，请重试" onRetry={onRetry} />
  return <>{children}</>
}

// ====== Habit Heatmap（保留 SVG，接真实后端数据）======
function HabitHeatmap({ data, cellSize = 26, gap = 6 }: {
  data: HabitHeatmapItem[]
  cellSize?: number
  gap?: number
}) {
  if (!data || data.length === 0) return null

  const days = data.slice(-28)
  const cols = 7
  const rows = 4
  const labelH = 18
  const svgW = cols * (cellSize + gap) + gap
  const svgH = rows * (cellSize + gap) + gap + labelH

  const dayLabels = ['一', '二', '三', '四', '五', '六', '日']

  return (
    <svg
      viewBox={`0 0 ${svgW} ${svgH}`}
      preserveAspectRatio="xMidYMid meet"
      style={{ display: 'block', width: '100%', aspectRatio: `${svgW} / ${svgH}` }}
    >
      {dayLabels.map((label, i) => (
        <text
          key={label}
          x={gap + i * (cellSize + gap) + cellSize / 2}
          y={labelH - 4}
          textAnchor="middle"
          style={{ fontSize: 10, fill: 'var(--color-text-disabled)' }}
        >
          {label}
        </text>
      ))}
      {days.map((d, i) => {
        const col = i % 7
        const row = Math.floor(i / 7)
        const x = gap + col * (cellSize + gap)
        const y = labelH + row * (cellSize + gap)
        const ratio = d.total > 0 ? d.completed / d.total : 0
        return (
          <Tooltip key={i} content={`${d.date}: ${d.completed}/${d.total}`}>
            <rect
              x={x}
              y={y}
              width={cellSize}
              height={cellSize}
              rx={4}
              fill={heatColor(ratio)}
            />
          </Tooltip>
        )
      })}
    </svg>
  )
}

// ====== KPI Change badge ======
function ChangeBadge({ value, invert = false }: { value: number; invert?: boolean }) {
  if (value === 0) return null
  const isUp = value > 0
  const isGood = invert ? !isUp : isUp
  return (
    <span className="kpi-change" style={{ color: isGood ? 'var(--color-success)' : 'var(--color-danger)' }}>
      <Icon name={isUp ? 'TrendingUp' : 'TrendingDown'} size={14} />
      {' '}{Math.abs(Math.round(value * 100)) / 100}%
    </span>
  )
}

// ====== Main page ======
export default function StatPage() {
  const statsStore = useStatsStore()
  const fetchCategories = useFinanceCategoryStore((s) => s.fetchTree)
  const categoryFlat = useFinanceCategoryStore((s) => s.flat)
  const [section, setSection] = useState<SectionKey>('overview')
  const [range, setRange] = useState<RangeKey>(DEFAULT_RANGE_BY_SECTION.overview)

  // —— 概览（固定维度，只取一次）——
  const [overview, setOverview] = useState<StatsOverview | null>(null)
  const [overviewLoading, setOverviewLoading] = useState(true)
  const [overviewError, setOverviewError] = useState(false)

  // —— 区间统计（随 7/30/90 天变化）——
  const [taskStats, setTaskStats] = useState<TaskStats | null>(null)
  const [taskLoading, setTaskLoading] = useState(true)
  const [taskError, setTaskError] = useState(false)
  const [habitStats, setHabitStats] = useState<HabitStats | null>(null)
  const [habitLoading, setHabitLoading] = useState(true)
  const [habitError, setHabitError] = useState(false)
  const [financeStats, setFinanceStats] = useState<FinanceStats | null>(null)
  const [financeLoading, setFinanceLoading] = useState(true)
  const [financeError, setFinanceError] = useState(false)

  const loadOverview = useCallback(async () => {
    setOverviewLoading(true)
    setOverviewError(false)
    try {
      setOverview(await statsApi.overview())
    } catch {
      setOverview(null)
      setOverviewError(true)
    } finally {
      setOverviewLoading(false)
    }
  }, [])

  const loadRange = useCallback(async (r: RangeKey) => {
    setTaskLoading(true)
    setHabitLoading(true)
    setFinanceLoading(true)
    setTaskError(false)
    setHabitError(false)
    setFinanceError(false)

    const [t, h, f] = await Promise.allSettled([
      statsApi.taskStats({ range: r }),
      statsApi.habitStats({ range: r }),
      statsApi.financeStats({ range: r }),
    ])

    if (t.status === 'fulfilled') setTaskStats(t.value)
    else {
      setTaskStats(null)
      setTaskError(true)
    }
    if (h.status === 'fulfilled') setHabitStats(h.value)
    else {
      setHabitStats(null)
      setHabitError(true)
    }
    if (f.status === 'fulfilled') setFinanceStats(f.value)
    else {
      setFinanceStats(null)
      setFinanceError(true)
    }

    setTaskLoading(false)
    setHabitLoading(false)
    setFinanceLoading(false)
  }, [])

  useEffect(() => {
    loadOverview()
    loadRange(range)
    if (useFinanceCategoryStore.getState().tree.length === 0) void fetchCategories()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // —— KPI 值（概览固定维度）——
  const taskTodayTotal = overview?.today_total_tasks ?? 0
  const taskTodayDone = overview?.today_done_tasks ?? 0
  const taskProgress = taskTodayTotal > 0 ? Math.round((taskTodayDone / taskTodayTotal) * 100) : 0

  const weekRate = Math.round(overview?.week_completion_rate ?? 0)
  const habitTodayDone = overview?.habit_today_done ?? 0
  const habitTodayTotal = overview?.habit_today_total ?? 0
  const habitProgress = habitTodayTotal > 0 ? Math.round((habitTodayDone / habitTodayTotal) * 100) : 0

  const totalBalance = overview?.total_balance ?? 0

  // 任务完成趋势
  const taskTrend = useMemo(() => {
    if (!taskStats?.by_day) return []
    return taskStats.by_day.map((d) => ({
      label: d.date.slice(5),
      value: d.completed,
    }))
  }, [taskStats])

  // 支出趋势
  const expenseTrend = useMemo(() => {
    if (!financeStats?.by_day) return []
    return financeStats.by_day.map((d) => ({
      label: d.date.slice(5),
      value: d.expense,
    }))
  }, [financeStats])

  // 支出分类占比（doughnut）
  const categoryDoughnutData = useMemo(() => {
    if (!financeStats?.by_category) return []
    return financeStats.by_category.map((c) => ({
      label: c.category,
      value: c.amount,
      color: c.color || '#6B7280', // Chart.js 画布色不支持 CSS 变量，保留中性灰兜底
    }))
  }, [financeStats])

  const categoryTableData = financeStats?.by_category ?? []
  const accountTableData = financeStats?.by_account ?? []
  const topHabits = habitStats?.by_habit.slice(0, 5) ?? []
  const heatmapData = habitStats?.heatmap ?? []

  const arc = progressArc(weekRate)
  const habitArc = progressArc(habitProgress, 100, 10)

  // —— 区间切换（页内 RadioGroup，不再占 Tabs） ——
  function onRangeChange(key: string) {
    const v = key as RangeKey
    setRange(v)
    loadRange(v)
  }

  /**
   * 领域切换。
   * ⚠️ 必须连带把区间重置为该领域默认值（spec 05 §3），否则会出现
   *    「我在财务选了 90 天，切到习惯还是 90 天」的错位。
   */
  function onSectionChange(key: string) {
    const s = key as SectionKey
    if (s === section) return
    setSection(s)
    const def = DEFAULT_RANGE_BY_SECTION[s]
    setRange(def)
    loadRange(def)
  }

  // —— 导出（S6：await + 失败提示）——
  async function onExport(type: 'tasks' | 'habits' | 'transactions' | 'all') {
    try {
      await statsStore.exportCSV(range, type)
      Toast.success('导出完成，文件已开始下载')
    } catch {
      Toast.error('导出失败，请稍后重试')
    }
  }

  // —— 分类明细表列 ——
  const catColumns = useMemo<ColumnProps<FinanceCategoryStat>[]>(() => [
    {
      title: '排名',
      dataIndex: 'rank',
      width: 80,
      render: (_v, _r, i) => (
        <div className="rank-badge" data-rank={i + 1}>{i + 1}</div>
      ),
    },
    {
      title: '类别',
      dataIndex: 'category',
      width: 200,
      render: (_v, r) => {
        const v = resolveCategoryView(
          { category_id: r.category_id, category_name: r.category, category_emoji: r.emoji },
          categoryFlat,
        )
        const tv = TINT_VARS[v.tint]
        return (
          <div className="col-cat">
            <div className="cat-icon" style={{ background: tv.bg, color: tv.fg }}>
              <Icon name={v.icon} size={16} />
            </div>
            <span style={{ fontWeight: 600 }}>{v.name}</span>
          </div>
        )
      },
    },
    {
      title: '金额',
      dataIndex: 'amount',
      width: 160,
      align: 'right',
      render: (v: number) => (
        <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
          ¥ {v.toFixed(2)}
        </span>
      ),
    },
    {
      title: '笔数',
      dataIndex: 'count',
      width: 80,
      align: 'center',
      render: (v: number) => <span style={{ color: 'var(--color-text-tertiary)' }}>{v}</span>,
    },
    {
      title: '占比',
      dataIndex: 'percentage',
      render: (v: number) => {
        const pct = Math.round(v * 100)
        return (
          <div className="pct-row">
            <div className="pct-bar">
              <div className="pct-fill" style={{ width: pct + '%' }} />
            </div>
            <span style={{ marginLeft: 12, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
              {pct}%
            </span>
          </div>
        )
      },
    },
  ], [])

  // —— 账户汇总表列 ——
  const accColumns = useMemo<ColumnProps<FinanceAccountStat>[]>(() => [
    {
      title: '账户',
      dataIndex: 'account',
      width: 200,
      render: (_v, r) => {
        // 走字典的「唯一真相」解析，与记录页账户卡保持一致；
        // 此前直接用 getIconMapping，导致同一账户在本页与记录页颜色不同。
        const { icon: AccountIcon, tint } = resolveAccountIcon(r.emoji)
        return (
          <span style={{ fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <span className="cat-icon" style={{ background: TINT_VARS[tint].bg, color: TINT_VARS[tint].fg }}>
              <AccountIcon size={16} />
            </span>
            {r.account}
          </span>
        )
      },
    },
    {
      title: '金额',
      dataIndex: 'amount',
      width: 160,
      align: 'right',
      render: (v: number) => (
        <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
          ¥ {v.toFixed(2)}
        </span>
      ),
    },
    {
      title: '笔数',
      dataIndex: 'count',
      width: 100,
      align: 'center',
    },
  ], [])

  return (
    <div className="stat-page">
      {/* D-03 第七轮：去页内大标题（与顶部导航重复），改用户管理式一行小字 */}
      <div className="page-tipbar">
        <span className="page-tip">统计 · 按领域复盘趋势，点右侧按钮导出数据</span>
        <div className="header-right">
          {/* 区间降为页内筛选器（spec 05 §3）：放 tipbar 右侧，不再占 Tabs。
              ⚠️ 用 RadioGroup 而不是再来一层 Tabs —— 与领域 Tabs 撞形。 */}
          <RadioGroup
            value={range}
            onChange={(e: any) => onRangeChange(e.target.value as RangeKey)}
            type="button"
          >
            {RANGE_OPTIONS.map((o) => (
              <Radio key={o.value} value={o.value}>
                {o.label}
              </Radio>
            ))}
          </RadioGroup>
          <Dropdown
            trigger="click"
            position="bottomRight"
            render={
              <Dropdown.Menu>
                <Dropdown.Item onClick={() => onExport('all')}>全部数据 (CSV)</Dropdown.Item>
                <Dropdown.Item onClick={() => onExport('transactions')}>仅交易</Dropdown.Item>
                <Dropdown.Item onClick={() => onExport('tasks')}>仅任务</Dropdown.Item>
                <Dropdown.Item onClick={() => onExport('habits')}>仅习惯</Dropdown.Item>
              </Dropdown.Menu>
            }
          >
            <Button theme="light" type="secondary" icon={<Icon name="FileText" size={20} />}>导出</Button>
          </Dropdown>
        </div>
      </div>

      {/* 领域 Tabs（spec 05 §2）—— 区间已移到 tipbar 右侧的 RadioGroup */}
      <Card bordered={false} className="card">
        <Tabs activeKey={section} onChange={onSectionChange} type="line">
          <TabPane itemKey="overview" tab="总览">

      {/* 4 KPI Grid */}
      {overviewLoading && !overview ? (
        <div className="kpi-grid">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i} bordered={false} className="kpi-large">
              <Skeleton><Skeleton.Paragraph rows={2} /></Skeleton>
            </Card>
          ))}
        </div>
      ) : overviewError && !overview ? (
        <div className="card">
          <ErrorState compact message="概览数据加载失败，请重试" onRetry={loadOverview} />
        </div>
      ) : (
        <div className="kpi-grid">
          {/* 今日任务（固定 · 今日） */}
          <Card bordered={false} className="kpi-large kpi-task">
            <div className="kpi-large-head">
              <div className="kpi-large-icon" style={{ background: 'var(--color-primary-50)', color: 'var(--color-primary-500)' }}>
                <Icon name="ListChecks" size={24} />
              </div>
              <div className="kpi-large-head-main">
                <div className="kpi-large-label">今日任务</div>
                <div className="kpi-large-value">
                  {taskTodayDone}<span className="muted">/ {taskTodayTotal}</span>
                </div>
              </div>
              <span className="kpi-large-dim">今日 · 固定</span>
            </div>
            <div className="kpi-large-foot">
              <div className="progress-bar">
                <div className="progress-fill" style={{ width: taskProgress + '%', background: 'var(--color-primary-500)' }} />
              </div>
              <span className="progress-text">{taskProgress}%</span>
            </div>
            {taskStats && (
              <div className="kpi-large-hint">
                <ChangeBadge value={taskStats.completion_rate_change} />
                <span style={{ marginLeft: 6, color: 'var(--color-text-tertiary)' }}>完成率 vs 上期</span>
              </div>
            )}
          </Card>

          {/* 本周完成率（固定 · 本周） */}
          <Card bordered={false} className="kpi-large kpi-rate">
            <div className="kpi-large-head">
              <svg width={arc.size} height={arc.size} className="ring">
                <circle cx={arc.size / 2} cy={arc.size / 2} r={arc.r} strokeWidth={arc.stroke} fill="none" style={{ stroke: 'var(--color-bg-hover)' }} />
                <circle
                  cx={arc.size / 2} cy={arc.size / 2} r={arc.r} strokeWidth={arc.stroke} fill="none"
                  strokeDasharray={arc.c} strokeDashoffset={arc.offset} strokeLinecap="round"
                  transform={`rotate(-90 ${arc.size / 2} ${arc.size / 2})`}
                  style={{ stroke: 'var(--color-success)' }}
                />
                <text x={arc.size / 2} y={arc.size / 2} textAnchor="middle" dominantBaseline="central"
                  className="ring-value" style={{ fill: 'var(--color-success)' }}>
                  {weekRate}%
                </text>
              </svg>
              <div className="kpi-large-head-main">
                <div className="kpi-large-label">本周完成率</div>
                <div className="kpi-large-sub">任务 + 习惯 综合</div>
              </div>
              <span className="kpi-large-dim">本周 · 固定</span>
            </div>
          </Card>

          {/* 支出（随筛选） */}
          <Card bordered={false} className="kpi-large kpi-expense">
            <div className="kpi-large-head">
              <div className="kpi-large-icon" style={{ background: 'var(--color-danger-light)', color: 'var(--color-danger-dark)' }}>
                <Icon name="TrendingDown" size={24} />
              </div>
              <div className="kpi-large-head-main">
                <div className="kpi-large-label">{rangeLabels[range]}支出</div>
                <div className="kpi-large-value" style={{ color: 'var(--color-danger-dark)' }}>
                  {formatMoney(financeStats?.expense ?? 0)}
                </div>
              </div>
              <span className="kpi-large-dim kpi-large-dim--range">随筛选</span>
            </div>
            <div className="kpi-large-foot">
              <div className="kpi-large-sub">收入 {formatMoney(financeStats?.income ?? 0)}</div>
            </div>
            {financeStats && (
              <div className="kpi-large-hint">
                <ChangeBadge value={financeStats.expense_change} invert />
                <span style={{ marginLeft: 6, color: 'var(--color-text-tertiary)' }}>支出 vs 上期</span>
              </div>
            )}
          </Card>

          {/* 总净资产（固定 · 当前） */}
          <Card bordered={false} className="kpi-large kpi-asset">
            <div className="kpi-large-head">
              <div className="kpi-large-icon" style={{ background: 'var(--color-success-light)', color: 'var(--color-success-dark)' }}>
                <Icon name="CreditCard" size={24} />
              </div>
              <div className="kpi-large-head-main">
                <div className="kpi-large-label">总净资产</div>
                <div className="kpi-large-value" style={{ color: totalBalance < 0 ? 'var(--color-danger-dark)' : 'var(--color-success-dark)' }}>
                  {formatMoney(totalBalance)}
                </div>
              </div>
              <span className="kpi-large-dim">当前 · 固定</span>
            </div>
            <div className="kpi-large-foot">
              <div className="kpi-large-sub">净值 {formatMoney(financeStats?.net ?? 0)}</div>
            </div>
            {financeStats && (
              <div className="kpi-large-hint">
                <ChangeBadge value={financeStats.income_change} />
                <span style={{ marginLeft: 6, color: 'var(--color-text-tertiary)' }}>收入 vs 上期</span>
              </div>
            )}
          </Card>
        </div>
      )}

      {/* Charts row: 任务完成趋势 + 支出趋势 */}
      <div className="chart-row">
        <Card bordered={false} className="card chart-card">
          <div className="card-head">
            <span className="card-title"><Icon name="ListChecks" size={20} style={{ marginRight: 6 }} />任务完成趋势</span>
            <span className="card-sub">{rangeLabels[range]}</span>
          </div>
          <SectionBody loading={taskLoading} error={taskError} onRetry={() => loadRange(range)}>
            {taskTrend.length > 0 ? (
              <BarChartCard data={taskTrend} color="#014DB2" height={260} />
            ) : (
              <EmptyHint icon="Inbox" title="暂无任务数据" />
            )}
          </SectionBody>
        </Card>

        <Card bordered={false} className="card chart-card">
          <div className="card-head">
            <span className="card-title"><Icon name="TrendingDown" size={20} style={{ marginRight: 6 }} />支出趋势</span>
            <span className="card-sub">{rangeLabels[range]}</span>
          </div>
          <SectionBody loading={financeLoading} error={financeError} onRetry={() => loadRange(range)}>
            {expenseTrend.length > 0 ? (
              <LineChartCard data={expenseTrend} color="#EF4444" height={260} />
            ) : (
              <EmptyHint icon="Inbox" title="暂无支出数据" />
            )}
          </SectionBody>
        </Card>
      </div>
          </TabPane>

          {/* 健康：从 /health/days 现算，四块均带数据不足降级态 */}
          <TabPane itemKey="health" tab="健康">
            <HealthStats range={range} />
          </TabPane>

          <TabPane itemKey="habit" tab="习惯">

      {/* 习惯完成 + 热力图 */}
      <Card bordered={false} className="card">
        <div className="card-head">
          <span className="card-title"><Icon name="Flame" size={20} style={{ marginRight: 6 }} />习惯完成</span>
          <span className="card-sub">
            {rangeLabels[range]} · {habitStats?.total_habits ?? 0} 个习惯 · 最长连续 {habitStats?.longest_streak_overall ?? 0} 天 · {habitStats?.total_check_ins ?? 0} 次打卡 · 日均 {habitStats?.daily_average?.toFixed(1) ?? '0'}
          </span>
        </div>

        <SectionBody loading={habitLoading} error={habitError} onRetry={() => loadRange(range)}>
          {topHabits.length > 0 ? (
            <div className="habit-stats-row">
              <div className="habit-stat-left">
                <div className="habit-ring-wrap">
                  <svg width={habitArc.size} height={habitArc.size}>
                    <circle cx={habitArc.size / 2} cy={habitArc.size / 2} r={habitArc.r} strokeWidth={habitArc.stroke} fill="none" style={{ stroke: 'var(--color-bg-hover)' }} />
                    <circle
                      cx={habitArc.size / 2} cy={habitArc.size / 2} r={habitArc.r} strokeWidth={habitArc.stroke} fill="none"
                      strokeDasharray={habitArc.c} strokeDashoffset={habitArc.offset} strokeLinecap="round"
                      transform={`rotate(-90 ${habitArc.size / 2} ${habitArc.size / 2})`}
                      style={{ stroke: 'var(--color-warning)' }}
                    />
                    <text x={habitArc.size / 2} y={habitArc.size / 2} textAnchor="middle" dominantBaseline="central"
                      className="ring-value" style={{ fill: 'var(--color-warning-dark)' }}>
                      {habitTodayDone}
                    </text>
                    <text x={habitArc.size / 2} y={habitArc.size / 2 + 22} textAnchor="middle" dominantBaseline="central"
                      style={{ fontSize: 11, fill: 'var(--color-text-tertiary)' }}>
                      / {habitTodayTotal}
                    </text>
                  </svg>
                </div>
                <div className="habit-heatmap-section">
                  <div className="heatmap-title">近 4 周打卡热力图</div>
                  <HabitHeatmap data={heatmapData} />
                </div>
              </div>
              <div className="habit-stat-right">
                {topHabits.map((h) => {
                  const def = findCategoryByEmoji(h.emoji)
                  const tv = TINT_VARS[def?.tint ?? 'neutral']
                  return (
                    <div key={h.habit_id} className="habit-stat-item">
                      <div className="hsi-icon" style={{ background: tv.bg, color: tv.fg, width: 32, height: 32, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Icon name={def?.icon ?? 'CircleDot'} size={16} />
                      </div>
                      <div className="hsi-info">
                        <div className="hsi-title">{h.name}</div>
                        <div className="hsi-sub">
                          今日 {h.today_done}/{h.today_target}
                          {h.today_done >= h.today_target && <span className="badge-done"><Icon name="CheckSquare" size={14} /> 完成</span>}
                        </div>
                      </div>
                      <div className="hsi-meta">
                        <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>连续 {h.current_streak} 天 · 最长 {h.longest_streak} 天</div>
                        <div style={{ fontSize: 11, color: 'var(--color-success)', fontWeight: 600 }}>{Math.round(h.completion_rate * 100)}%</div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ) : (
            <EmptyHint icon="FolderOpen" title="还没有习惯数据" />
          )}
        </SectionBody>
      </Card>

      {/* 习惯完成率（习惯领域；原「支出分类占比」已移到财务领域） */}
        <Card bordered={false} className="card chart-card">
          <div className="card-head">
            <span className="card-title"><Icon name="Gauge" size={20} style={{ marginRight: 6 }} />习惯完成率</span>
            <span className="card-sub">连续天数</span>
          </div>
          <SectionBody loading={habitLoading} error={habitError} onRetry={() => loadRange(range)}>
            {habitStats && habitStats.by_habit.length > 0 ? (
              <div className="habit-rate-grid">
                {habitStats.by_habit.slice(0, 4).map((h) => {
                  const pct = Math.round(h.completion_rate * 100)
                  const ringSize = 60
                  const ringStroke = 6
                  const r2 = (ringSize - ringStroke) / 2
                  const c2 = 2 * Math.PI * r2
                  const o2 = c2 * (1 - pct / 100)
                  const def = findCategoryByEmoji(h.emoji)
                  const tv = TINT_VARS[def?.tint ?? 'neutral']
                  return (
                    <div key={h.habit_id} className="habit-rate-item">
                      <svg width={ringSize} height={ringSize}>
                        <circle cx={ringSize / 2} cy={ringSize / 2} r={r2} strokeWidth={ringStroke} fill="none" style={{ stroke: 'var(--color-bg-hover)' }} />
                        <circle
                          cx={ringSize / 2} cy={ringSize / 2} r={r2} strokeWidth={ringStroke} fill="none"
                          strokeDasharray={c2} strokeDashoffset={o2} strokeLinecap="round"
                          transform={`rotate(-90 ${ringSize / 2} ${ringSize / 2})`}
                          style={{ stroke: h.color || 'var(--color-warning)' }}
                        />
                        <text x={ringSize / 2} y={ringSize / 2} textAnchor="middle" dominantBaseline="central"
                          style={{ fontSize: 14, fontWeight: 700, fill: h.color || 'var(--color-warning-dark)' }}>{pct}%</text>
                      </svg>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <Icon name={def?.icon ?? 'CircleDot'} size={14} style={{ color: tv.fg }} />
                          {h.name}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>连续 {h.current_streak} 天</div>
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <EmptyHint icon="FolderOpen" title="暂无习惯数据" />
            )}
          </SectionBody>
        </Card>
          </TabPane>

          <TabPane itemKey="finance" tab="财务">
        <Card bordered={false} className="card chart-card">
          <div className="card-head">
            <span className="card-title"><Icon name="PieChart" size={20} style={{ marginRight: 6 }} />支出分类占比</span>
            <span className="card-sub">Top 分类</span>
          </div>
          <SectionBody loading={financeLoading} error={financeError} onRetry={() => loadRange(range)}>
            {categoryDoughnutData.length > 0 ? (
              <DoughnutCard data={categoryDoughnutData} height={260} />
            ) : (
              <EmptyHint icon="Inbox" title="暂无支出分类数据" />
            )}
          </SectionBody>
        </Card>

      {/* 支出分类明细表 */}
      <Card bordered={false} className="card">
        <div className="card-head">
          <span className="card-title"><Icon name="PieChart" size={20} style={{ marginRight: 6 }} />支出分类明细</span>
          <span className="card-sub">按分类汇总</span>
        </div>
        <SectionBody loading={financeLoading} error={financeError} onRetry={() => loadRange(range)}>
          {categoryTableData.length > 0 ? (
            <Table columns={catColumns} dataSource={categoryTableData} pagination={false} size="middle" rowKey="category" />
          ) : (
            <EmptyHint icon="Inbox" title="暂无支出数据" />
          )}
        </SectionBody>
      </Card>

      {/* 账户汇总（S7：始终渲染卡片，无数据时显示空态） */}
      <Card bordered={false} className="card">
        <div className="card-head">
          <span className="card-title"><Icon name="CreditCard" size={20} style={{ marginRight: 6 }} />账户汇总</span>
          <span className="card-sub">{rangeLabels[range]}</span>
        </div>
        <SectionBody loading={financeLoading} error={financeError} onRetry={() => loadRange(range)}>
          {accountTableData.length > 0 ? (
            <Table columns={accColumns} dataSource={accountTableData} pagination={false} size="middle" rowKey="account" />
          ) : (
            <EmptyHint icon="FolderOpen" title="暂无账户数据" />
          )}
        </SectionBody>
      </Card>
          </TabPane>
        </Tabs>
      </Card>
    </div>
  )
}
