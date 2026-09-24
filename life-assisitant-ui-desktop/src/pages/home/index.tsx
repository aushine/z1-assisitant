/**
 * 首页 —— 私人管家「门面」（04 §4.5 信息架构重构）。
 *
 * 从「仪表盘卡片堆叠」重构为「管家问候 + 今日叙事」两栏：
 *   ① 问候条 + 今日状态（心情/精力）+ 快捷入口
 *   ② 4 张 KPI 卡
 *   ③ 管家建议（SmartBanner，可操作 / 可关闭 / 多条轮播）
 *   ④ 今日时间线（主区 2/3，吸收「今日任务卡」）  │ ⑤ 今日习惯
 *                                                 │ ⑥ 本月财务
 *
 * 数据：homeApi（聚合）、timelineApi（时间线）、moodStore（心情）、habitStore（习惯/streak）。
 * 首页与时间线直接走 API 并持有本地 loading/error 状态，以便区分「加载失败」与「暂无数据」。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, Skeleton, Button, Tooltip } from '@douyinfe/semi-ui'
import { Icon, TINT_VARS } from '@/components/icon'
import type { IconName, TintName } from '@/components/icon'
import { homeApi } from '@/api/home'
import { timelineApi } from '@/api/timeline'
import { useMoodStore } from '@/stores/mood'
import { useHabitStore } from '@/stores/habit'
import { resolveHabitIconView } from '@/utils/category-dict'
import { moodOptions, energyOptions, MOOD_VALUES_ASC } from '@/utils/mood-dict'
import ErrorState from '@/components/ErrorState'
import { MoneyText } from '@/components/finance/MoneyText'
import { EmptyHint } from '@/components/EmptyState'
import AnniversaryCard from '@/components/AnniversaryCard'
import { SmartBanner, computeRecs } from '@/components/SmartBanner'
import Timeline from './Timeline'
import MoodSection from '@/pages/record/components/MoodSection'
import type { HomeResp, TimelineEvent, MoodValue, EnergyValue } from '@/api/types'

/** 本地时区当天日期 YYYY-MM-DD（避免 toISOString 的 UTC 偏移跨天） */
function todayStr(d: Date = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** SVG 进度环 helper */
function progressArc(pct: number, size = 80, stroke = 8) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const offset = c * (1 - Math.min(pct, 100) / 100)
  return { r, c, offset, size, stroke }
}

/** KPI 涨跌指示（Lucide 图标） */
function KpiChange({ value }: { value: number }) {
  if (value === 0) return null
  const isUp = value > 0
  const color = isUp ? 'var(--color-success)' : 'var(--color-danger)'
  return (
    <span style={{ fontSize: 11, color, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 2 }}>
      <Icon name={isUp ? 'TrendingUp' : 'TrendingDown'} size={14} />
      {Math.abs(value).toFixed(1)}%
    </span>
  )
}

// 心情 / 精力档位元数据统一走 utils/mood-dict.ts（首页、记录页、左下角面板共用一份），
// 这里只声明本页的展示顺序：从左到右「很差 → 很好」。
const MOOD_OPTIONS = moodOptions(MOOD_VALUES_ASC)
const ENERGY_OPTIONS = energyOptions([1, 2, 3])

/** 快捷入口（04 §4.5：取消 2×2，收进问候条右侧） */
const QUICK_ENTRIES: { icon: IconName; label: string; route: string }[] = [
  { icon: 'PlusCircle', label: '记一笔', route: '/record' },
  { icon: 'ListChecks', label: '新建任务', route: '/todo' },
  { icon: 'BarChart3', label: '统计', route: '/stat' },
  { icon: 'User', label: '我的', route: '/me' },
]

/** KPI 卡配置（H2：6 种 tint） */
const KPI_ITEMS: { key: string; icon: IconName; tint: TintName; label: string; route: string }[] = [
  { key: 'todo', icon: 'ListChecks', tint: 'primary', label: '今日任务', route: '/todo' },
  { key: 'habit', icon: 'CalendarCheck', tint: 'warning', label: '今日习惯', route: '/record' },
  { key: 'expense', icon: 'TrendingDown', tint: 'danger', label: '本月支出', route: '/stat' },
  { key: 'income', icon: 'TrendingUp', tint: 'success', label: '本月收入', route: '/stat' },
]

/**
 * 首页模块级数据缓存（spec-20260924-v2 S1 · 桌面端数据级缓存）
 *
 * 桌面端 React 无 KeepAlive，切页会卸载重挂。用模块级变量做 SWR：
 * 再次进页时先用上次数据立即渲染（不闪 loading），后台静默刷新。
 * 模块级变量不随组件实例销毁而清空；登出时不必特意清（登录页不渲染首页，
 * 下次登录后首次进首页会静默刷新覆盖）。若未来要严格隔离账号，可在登出流程里重置。
 */
const homeCache: { data: HomeResp | null; timeline: TimelineEvent[] | null; at: number } = {
  data: null,
  timeline: null,
  at: 0,
}

export default function HomePage() {
  const navigate = useNavigate()
  const moodStore = useMoodStore()
  const habitStore = useHabitStore()

  // —— 首页聚合数据（本地状态，以便区分 error / empty）——
  // 初始值取模块级缓存（有则立即渲染、不闪 loading；无则首拉）
  const [home, setHome] = useState<HomeResp | null>(() => homeCache.data)
  const [homeLoading, setHomeLoading] = useState(homeCache.data === null)
  const [homeError, setHomeError] = useState(false)

  // —— 时间线数据 ——
  const [timelineItems, setTimelineItems] = useState<TimelineEvent[]>(() => homeCache.timeline ?? [])
  const [timelineLoading, setTimelineLoading] = useState(homeCache.timeline === null)
  const [timelineError, setTimelineError] = useState(false)

  /**
   * @param silent 静默刷新（2026-09-24 S1）：不置 loading、失败不清空已有数据。
   *        再次进页时 true；首进 / 手动重试不传。
   */
  const refresh = useCallback(async (opts: { silent?: boolean } = {}) => {
    const silent = opts.silent === true
    if (!silent) {
      setHomeLoading(true)
      setHomeError(false)
      setTimelineLoading(true)
      setTimelineError(false)
    }

    const [homeRes, timelineRes] = await Promise.allSettled([
      homeApi.fetch(),
      timelineApi.getTimeline({ date: todayStr() }),
    ])

    if (homeRes.status === 'fulfilled') {
      setHome(homeRes.value)
      homeCache.data = homeRes.value
      homeCache.at = Date.now()
    } else if (!silent) {
      setHome(null)
      setHomeError(true)
    }
    setHomeLoading(false)

    if (timelineRes.status === 'fulfilled') {
      setTimelineItems(timelineRes.value.items ?? [])
      homeCache.timeline = timelineRes.value.items ?? []
    } else if (!silent) {
      setTimelineItems([])
      homeCache.timeline = []
      setTimelineError(true)
    }
    setTimelineLoading(false)
  }, [])

  useEffect(() => {
    // 有缓存 → 静默刷新（先显缓存）；无缓存 → 首拉带 loading
    refresh({ silent: homeCache.data !== null })
    // 拉时间线而不是只拉 today：顺带拿到服务端 now_hour，点心情才能落到正确的小时
    moodStore.fetchTimeline()
    habitStore.fetchList()
  }, [refresh])

  const kpi = home?.kpi
  const todayHabits = home?.today_habits ?? []
  const monthFinance = home?.month_finance
  const dateText = home?.today_date && home?.weekday ? `${home.today_date} · ${home.weekday}` : ''

  const todoProgress = kpi ? Math.round(kpi.todo_rate * 100) : 0
  const habitProgress = kpi ? (kpi.habit_total > 0 ? Math.round((kpi.habit_done / kpi.habit_total) * 100) : 0) : 0

  const habitArc = useMemo(() => progressArc(habitProgress, 100, 10), [habitProgress])

  // 最长连续天数（首页习惯卡环形图下方一行，04 §2.4）
  const longestStreak = useMemo(
    () => Math.max(0, ...habitStore.items.map((h) => h.longest_streak ?? 0)),
    [habitStore.items],
  )

  // 管家建议（含断卡预警 / 里程碑临近）
  const recs = useMemo(
    () => computeRecs(home, habitStore.items, new Date()),
    [home, habitStore.items],
  )

  // —— 心情 / 精力选择 ——
  // 新契约是按小时记录：只发被点的那一个字段，绝不动另一个；
  // 再点当前已选中的同一个值 = 显式发 0（这一小时不再单独记，显示回落到延续值）。
  function onPickMood(mood: MoodValue) {
    const cur = moodStore.current?.mood ?? 0
    void moodStore.setMood(cur === mood ? 0 : mood)
  }
  function onPickEnergy(energy: EnergyValue) {
    const cur = moodStore.current?.energy ?? 0
    void moodStore.setEnergy(cur === energy ? 0 : energy)
  }

  // —— 习惯打卡（完成后刷新首页 + 时间线，使卡片与叙事同步）——
  /** 只需要 id：首页简表 HomeHabitItem 也能直接打卡 */
  async function onCheckIn(h: { id: string }) {
    await habitStore.checkIn(h.id)
    refresh()
  }

  /** KPI 卡渲染（4 张统一结构） */
  function renderKpi(icon: IconName, tint: TintName, label: string, route: string, value: ReactNode, foot: ReactNode) {
    const tv = TINT_VARS[tint]
    return (
      <div className="kpi-card" onClick={() => navigate(route)}>
        <div className="kpi-icon" style={{ background: tv.bg, color: tv.fg }}>
          <Icon name={icon} size={20} />
        </div>
        <div className="kpi-body">
          <div className="kpi-label">{label}</div>
          <div className="kpi-value">{value}</div>
          <div className="kpi-foot">{foot}</div>
        </div>
      </div>
    )
  }

  // 整体加载骨架（首页聚合数据首次加载）
  if (homeLoading && !home) {
    return (
      <div className="home-page">
        <Skeleton.Title style={{ width: 300, marginBottom: 24 }} />
        <Skeleton.Paragraph rows={8} />
      </div>
    )
  }

  // 首页聚合数据加载失败（网络异常等）—— 与「暂无数据」区分
  if (homeError && !home) {
    return (
      <div className="home-page">
        <div className="card">
          <ErrorState message="首页数据加载失败，请检查网络后重试" onRetry={refresh} />
        </div>
      </div>
    )
  }

  return (
    <div className="home-page">
      {/* ① 问候条 + 今日状态 + 快捷入口 */}
      <div className="welcome">
        <div className="welcome-left">
          <div className="welcome-sun"><Icon name="Sun" size={24} /></div>
          <div>
            <div className="greet-line1">{home?.greeting ?? ''}</div>
            <div className="greet-line2">{dateText} · 今天也要加油鸭</div>
          </div>
        </div>

        <div className="welcome-right">
          {/* 心情 / 精力（常驻，04 §3.2） */}
          <div className="mood-picker" role="group" aria-label="今日心情与精力">
            <div className="mood-group">
              {MOOD_OPTIONS.map((o) => {
                const active = moodStore.current?.mood === o.value
                const tv = TINT_VARS[o.tint]
                return (
                  <Tooltip key={o.value} content={o.label}>
                    <button
                      className={`mood-btn${active ? ' active' : ''}`}
                      onClick={() => onPickMood(o.value)}
                      style={active ? { background: '#fff', color: tv.fg } : undefined}
                    >
                      <Icon name={o.icon} size={16} />
                    </button>
                  </Tooltip>
                )
              })}
            </div>
            <span className="mood-sep" />
            <div className="mood-group">
              {ENERGY_OPTIONS.map((o) => {
                const active = moodStore.current?.energy === o.value
                const tv = TINT_VARS[o.tint]
                return (
                  <Tooltip key={o.value} content={o.label}>
                    <button
                      className={`mood-btn${active ? ' active' : ''}`}
                      onClick={() => onPickEnergy(o.value)}
                      style={active ? { background: '#fff', color: tv.fg } : undefined}
                    >
                      <Icon name={o.icon} size={16} />
                    </button>
                  </Tooltip>
                )
              })}
            </div>
          </div>

          {/* 快捷入口 */}
          <div className="welcome-actions">
            {QUICK_ENTRIES.map((q) => (
              <button key={q.route} className="welcome-action" onClick={() => navigate(q.route)}>
                <Icon name={q.icon} size={16} />
                <span>{q.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ② 4 张 KPI */}
      <div className="kpi-row">
        {renderKpi(
          KPI_ITEMS[0].icon, KPI_ITEMS[0].tint, KPI_ITEMS[0].label, KPI_ITEMS[0].route,
          <>{kpi?.todo_done ?? 0}<span className="kpi-value-sub">/{kpi?.todo_total ?? 0}</span></>,
          <>
            <div className="kpi-bar"><div className="kpi-bar-fill" style={{ width: todoProgress + '%', background: 'var(--color-primary-500)' }} /></div>
            <span className="kpi-foot-text">{todoProgress}%</span>
          </>,
        )}
        {renderKpi(
          KPI_ITEMS[1].icon, KPI_ITEMS[1].tint, KPI_ITEMS[1].label, KPI_ITEMS[1].route,
          <>{kpi?.habit_done ?? 0}<span className="kpi-value-sub">/{kpi?.habit_total ?? 0}</span></>,
          <>
            <div className="kpi-bar"><div className="kpi-bar-fill" style={{ width: habitProgress + '%', background: 'var(--color-warning)' }} /></div>
            <span className="kpi-foot-text">{habitProgress}%</span>
          </>,
        )}
        {renderKpi(
          KPI_ITEMS[2].icon, KPI_ITEMS[2].tint, KPI_ITEMS[2].label, KPI_ITEMS[2].route,
          <span style={{ color: 'var(--color-danger-dark)' }}><MoneyText value={kpi?.month_expense ?? 0} /></span>,
          <>
            <KpiChange value={kpi?.month_expense_change ?? 0} />
            <span className="kpi-foot-text muted">同比</span>
          </>,
        )}
        {renderKpi(
          KPI_ITEMS[3].icon, KPI_ITEMS[3].tint, KPI_ITEMS[3].label, KPI_ITEMS[3].route,
          <span style={{ color: 'var(--color-success-dark)' }}><MoneyText value={kpi?.month_income ?? 0} /></span>,
          <>
            <KpiChange value={kpi?.month_income_change ?? 0} />
            <span className="kpi-foot-text muted">同比</span>
          </>,
        )}
      </div>

      {/* ③ 管家建议 */}
      <SmartBanner recs={recs} />

      {/* ④⑤⑥ 两栏：时间线（主区） | 今日习惯 + 本月财务 */}
      <div className="home-columns">
        <Card bordered={false} className="card timeline-card">
          <div className="card-head">
            <span className="card-title"><Icon name="History" size={20} style={{ marginRight: 6 }} />今日时间线</span>
            <span className="card-sub">{home?.today_date ?? todayStr()}</span>
          </div>

          {timelineLoading ? (
            <div className="timeline-skeleton">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="timeline-skeleton-row">
                  <Skeleton.Title style={{ width: 32, margin: 0 }} />
                  <Skeleton.Paragraph rows={1} style={{ flex: 1, margin: 0 }} />
                </div>
              ))}
            </div>
          ) : timelineError ? (
            <ErrorState compact message="时间线加载失败，请重试" onRetry={refresh} />
          ) : timelineItems.length > 0 ? (
            <Timeline items={timelineItems} />
          ) : (
            <EmptyHint
              icon="Inbox"
              title="今天还没有记录"
              desc="完成的任务、习惯打卡和记账会出现在这里，连成你的一天"
            />
          )}
        </Card>

        <div className="home-side-col">
          {/* ⑤ 今日习惯 */}
          <Card bordered={false} className="card habit-check-card">
            <div className="card-head">
              <span className="card-title"><Icon name="CalendarCheck" size={20} style={{ marginRight: 6 }} />今日习惯</span>
              <a className="view-all" onClick={() => navigate('/record')}>全部</a>
            </div>

            {todayHabits.length > 0 ? (
              <div className="habit-check-row">
                <div className="habit-ring-wrap">
                  <svg width={habitArc.size} height={habitArc.size}>
                    <circle cx={habitArc.size / 2} cy={habitArc.size / 2} r={habitArc.r} stroke="var(--color-bg-hover)" strokeWidth={habitArc.stroke} fill="none" />
                    <circle
                      cx={habitArc.size / 2} cy={habitArc.size / 2} r={habitArc.r} stroke="var(--color-warning)" strokeWidth={habitArc.stroke} fill="none"
                      strokeDasharray={habitArc.c} strokeDashoffset={habitArc.offset} strokeLinecap="round"
                      transform={`rotate(-90 ${habitArc.size / 2} ${habitArc.size / 2})`}
                    />
                    <text x={habitArc.size / 2} y={habitArc.size / 2} textAnchor="middle" dominantBaseline="central"
                      className="habit-ring-value">
                      {kpi?.habit_done ?? 0}
                    </text>
                    <text x={habitArc.size / 2} y={habitArc.size / 2 + 18} textAnchor="middle" dominantBaseline="central"
                      style={{ fontSize: 11, fill: 'var(--color-text-tertiary)' }}>
                      / {kpi?.habit_total ?? 0}
                    </text>
                  </svg>
                  {longestStreak > 0 && (
                    <div className="habit-ring-sub">最长连续 {longestStreak} 天</div>
                  )}
                </div>

                <div className="habit-check-list">
                  {todayHabits.map((h) => {
                    // HomeHabitItem 无 category/icon 之外的分类信息 ⇒ 回 habit store 按 id 兜底，
                    // 再走 04 §4.2 优先级链：habits.icon > 分类.icon > 分类.emoji > lucide:Pin
                    const sh = habitStore.items.find((x) => x.id === h.id)
                    const iv = resolveHabitIconView({ icon: sh?.icon || h.icon, category: sh?.category })
                    const done = h.completed
                    const pct = h.target_count > 0 ? Math.min(100, Math.round(((h.today_count ?? 0) / h.target_count) * 100)) : 0
                    const tv = TINT_VARS[iv.tint]
                    return (
                      <div key={h.id} className={`habit-check-item${done ? ' done' : ''}`}>
                        <div className="hci-icon" style={{ background: tv.bg, color: tv.fg }}>
                          <Icon name={iv.icon} size={16} />
                        </div>
                        <div className="hci-body">
                          <div className="hci-title">{h.title}</div>
                          <div className="hci-sub">
                            <div className="hci-bar">
                              <div className="hci-bar-fill" style={{ width: pct + '%', background: done ? 'var(--color-success)' : h.color || 'var(--color-primary-500)' }} />
                            </div>
                            <span className="hci-pct">{h.today_count ?? 0}/{h.target_count} {sh?.unit ?? ''}</span>
                          </div>
                        </div>
                        <Tooltip content={done ? '已打卡' : '打卡'}>
                          <Button
                            theme={done ? 'light' : 'solid'}
                            type={done ? 'tertiary' : 'primary'}
                            size="small"
                            icon={<Icon name="CheckSquare" size={16} />}
                            disabled={done}
                            onClick={() => onCheckIn(h)}
                          />
                        </Tooltip>
                      </div>
                    )
                  })}
                </div>
              </div>
            ) : (
              <EmptyHint icon="FolderOpen" title="还没有习惯" desc="去记录页创建你的第一个习惯吧" />
            )}
          </Card>

          {/* ⑥ 本月财务 */}
          <Card bordered={false} className="card">
            <div className="card-head">
              <span className="card-title"><Icon name="CreditCard" size={20} style={{ marginRight: 6 }} />本月财务</span>
              <a className="view-all" onClick={() => navigate('/stat')}>详情</a>
            </div>

            {monthFinance ? (
              <>
                <div className="finance-summary">
                  <div className="finance-summary-item is-expense">
                    <div className="finance-summary-label">支出</div>
                    <div className="finance-summary-value"><MoneyText value={monthFinance.expense} /></div>
                    <KpiChange value={monthFinance.expense_change} />
                  </div>
                  <div className="finance-summary-item is-income">
                    <div className="finance-summary-label">收入</div>
                    <div className="finance-summary-value"><MoneyText value={monthFinance.income} /></div>
                    <KpiChange value={monthFinance.income_change} />
                  </div>
                </div>

                {monthFinance.category_pie.length > 0 && (
                  <div className="finance-cats">
                    <div className="finance-cats-title">分类占比</div>
                    {monthFinance.category_pie.slice(0, 4).map((cat) => {
                      const pct = monthFinance.expense > 0 ? Math.round((cat.value / monthFinance.expense) * 100) : 0
                      return (
                        <div key={cat.name} className="finance-cat-row">
                          <span className="finance-cat-dot" style={{ background: cat.color }} />
                          <span className="finance-cat-name">{cat.name}</span>
                          <span className="finance-cat-value"><MoneyText value={cat.value} /></span>
                          <span className="finance-cat-pct">{pct}%</span>
                        </div>
                      )
                    })}
                  </div>
                )}
              </>
            ) : (
              <EmptyHint icon="FolderOpen" title="暂无财务数据" />
            )}
          </Card>

          {/* ⑥.5 重要日子（纪念日 / 倒数日）
               位置按 spec 06 §2：本月财务之后（与移动端同序）。
               ⚠️ 一条都没有时组件内部整卡不渲染，这里不额外判空。 */}
          <AnniversaryCard />

          {/* ⑦ 今日心情（完整卡，全量、不折叠）
               与顶栏「此刻」1-tap 快捷并存：欢迎条负责一眼点选，
               这里给出按小时记录 + 全天时间线的完整视图（双轴之一：心情/精力轴）。
               collapse 不传 → 默认 false → 全量渲染。 */}
          <MoodSection />
        </div>
      </div>
    </div>
  )
}
