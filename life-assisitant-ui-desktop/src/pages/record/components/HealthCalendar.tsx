/**
 * HealthCalendar —— 健康月历（桌面版，可切月）
 *
 * SYNC-FROM: src/pages/record/components/PeriodCalendar.tsx（复用结构与样式）
 * SYNC-FROM-BACKEND: life-assisitant-api/internal/model/dto/health.go（HealthCalendarDay.marks）
 *
 * 与经期日历的差异：
 *   1. 标记取值走 HEALTH_MARKS（含新增的 `logged` 灰点：格子下沿表示「当日有健康记录」）。
 *   2. 健康无隐私遮罩（👁）概念，不做 masking 分支。
 *   3. 月份上方多一条 month_summary 摘要条（记录天数 / 达标饮水天 / 体重均值 / 经期天数）。
 *
 * ⚠️ 颜色语义同经期：有形状/文字差异，不许只靠颜色区分。
 * ⚠️ 网格/格子/图例复用 period-calendar 系列 class（标记词汇与经期完全一致）。
 */
import { useEffect, useState, useMemo } from 'react'
import { Card } from '@douyinfe/semi-ui'
import { useHealthStore } from '@/stores/health'
import {
  CALENDAR_DOT_COLOR,
  CALENDAR_DOT_LABEL,
  CALENDAR_DOT_MARKS,
  CALENDAR_DOT_MAX,
} from '@/constants/health'
import type { PeriodMark } from '@/api/types'
import { getLunarDatesInRange, getSolarTerms } from 'chinese-days'

/** 周表头从周一开始；索引 5、6 = 周六、周日 */
const WEEK = ['一', '二', '三', '四', '五', '六', '日']

function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

interface CellVisual {
  background: string
  color: string
  border: string
  /** 状态标签；为空表示「无状态标记」，由组件回落到节气/农历 */
  sub?: string
  dot?: 'spotting' | 'logged'
  /** 实心填充（中量 / 大量 / 排卵）：右下角圆点必须换白色才看得见 */
  solid?: boolean
}

function cellVisual(marks: PeriodMark[], isToday: boolean, isWeekend: boolean): CellVisual {
  const neutralBg = 'var(--color-bg-hover)'
  const neutralColor = isWeekend ? 'var(--color-text-tertiary)' : 'var(--color-text-primary)'

  let v: CellVisual
  if (marks.includes('ovulation')) {
    v = { background: 'var(--color-ovulation-fill)', color: '#FFFFFF', border: '1px solid transparent', sub: '排卵', solid: true }
  } else if (marks.includes('flow_heavy')) {
    v = { background: 'var(--color-period-fill-heavy)', color: '#FFFFFF', border: '1px solid transparent', sub: '大量', solid: true }
  } else if (marks.includes('flow_medium')) {
    v = { background: 'var(--color-period-fill-mid)', color: '#FFFFFF', border: '1px solid transparent', sub: '中量', solid: true }
  } else if (marks.includes('flow_light')) {
    v = { background: 'var(--color-period-soft)', color: 'var(--color-period-dark)', border: '1px solid transparent', sub: '少量' }
  } else if (marks.includes('period')) {
    v = { background: 'var(--color-period-soft)', color: 'var(--color-period-dark)', border: '1px solid transparent', sub: '经期' }
  } else if (marks.includes('period_predicted')) {
    v = { background: 'var(--color-period-soft)', color: 'var(--color-period-dark)', border: '1.5px dashed var(--color-period)', sub: '预测' }
  } else if (marks.includes('peak')) {
    v = { background: 'var(--color-fertile-soft)', color: 'var(--color-fertile-strong)', border: '1.5px solid var(--color-ovulation)', sub: '峰值' }
  } else if (marks.includes('fertile')) {
    v = { background: 'var(--color-fertile-soft)', color: 'var(--color-fertile-strong)', border: '1px solid transparent', sub: '易孕' }
  } else {
    v = { background: neutralBg, color: neutralColor, border: '1px solid transparent' }
  }

  // 圆点：spotting 优先于 logged，可与填充共存
  if (marks.includes('spotting')) v.dot = 'spotting'
  else if (marks.includes('logged')) v.dot = 'logged'

  // 「今天」边框优先级最高，覆盖 predicted/peak 的边框
  if (isToday) v.border = '2px solid var(--color-primary-500)'

  return v
}

interface CalCell {
  date: string
  day: number
  inMonth: boolean
  isWeekend: boolean
  lunarDay: string
  solarTerm: string
}

interface HealthCalendarProps {
  onPickDate: (date: string) => void
  /**
   * 是否启用经期（来自 settings.metrics_enabled）。
   * 不传时按「启用」处理，避免漏传导致图例凭空消失。
   */
  periodOn?: boolean
}

export default function HealthCalendar({ onPickDate, periodOn = true }: HealthCalendarProps) {
  const store = useHealthStore()
  const now = new Date()
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const [viewMonth, setViewMonth] = useState(currentMonth)

  useEffect(() => {
    store.fetchCalendar(viewMonth)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMonth])

  const cache = store.calendarCache[viewMonth]
  const tStr = todayStr()

  const maxFuture = (() => {
    const d = new Date(now.getFullYear(), now.getMonth() + 12, 1)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  })()
  const canNext = viewMonth < maxFuture

  const cells = useMemo<CalCell[]>(() => {
    const [y, m] = viewMonth.split('-').map(Number)
    const firstWeekDay = new Date(y, m - 1, 1).getDay()
    const firstCol = (firstWeekDay + 6) % 7
    const daysInMonth = new Date(y, m, 0).getDate()
    const rows = Math.min(6, Math.max(4, Math.ceil((firstCol + daysInMonth) / 7)))
    const totalCells = rows * 7

    const gridStart = new Date(y, m - 1, 1 - firstCol)
    const gridEnd = new Date(y, m - 1, 1 - firstCol + totalCells)
    const lunarMap = new Map<string, string>()
    for (const l of getLunarDatesInRange(gridStart, gridEnd)) lunarMap.set(l.date, l.lunarDayCN)
    const termMap = new Map<string, string>()
    for (const t of getSolarTerms(gridStart, gridEnd)) termMap.set(t.date, t.name)

    const result: CalCell[] = []
    for (let i = 0; i < totalCells; i++) {
      const dayOffset = i - firstCol
      const dateObj = new Date(y, m - 1, 1 + dayOffset)
      const yy = dateObj.getFullYear()
      const mm = dateObj.getMonth() + 1
      const dd = dateObj.getDate()
      const dateStr = `${yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`
      const inMonth = 1 + dayOffset >= 1 && 1 + dayOffset <= daysInMonth
      const weekDayIdx = dateObj.getDay()
      const isWeekend = weekDayIdx === 0 || weekDayIdx === 6
      result.push({
        date: dateStr,
        day: dd,
        inMonth,
        isWeekend,
        lunarDay: lunarMap.get(dateStr) ?? '',
        solarTerm: termMap.get(dateStr) ?? '',
      })
    }
    return result
  }, [viewMonth])

  const markMap = useMemo(() => {
    const map: Record<string, PeriodMark[]> = {}
    ;(cache?.days ?? []).forEach((d) => {
      map[d.date] = d.marks as PeriodMark[]
    })
    return map
  }, [cache])

  function shift(delta: number) {
    const [y, m] = viewMonth.split('-').map(Number)
    const d = new Date(y, m - 1 + delta, 1)
    setViewMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }

  const [yy, mm] = viewMonth.split('-').map(Number)

  // 摘要条：仅看「本月」时显示（overview 的 month_summary 只覆盖当前月）
  const summary = viewMonth === currentMonth ? store.monthSummary : null
  const summaryText = (() => {
    if (!summary) return ''
    const parts: string[] = [`记录 ${summary.recorded_days} 天`]
    if (summary.water_goal_days) parts.push(`饮水达标 ${summary.water_goal_days} 天`)
    if (typeof summary.weight_avg === 'number' && summary.weight_avg != null)
      parts.push(`体重均 ${summary.weight_avg.toFixed(1)}kg`)
    // 后端未启用经期时 period_days 恒为 0，这里再按 periodOn 兜一层，双保险
    if (periodOn && summary.period_days) parts.push(`经期 ${summary.period_days} 天`)
    return parts.join(' · ')
  })()

  return (
    <Card bordered={false} className="card period-calendar health-calendar">
      {/* 摘要条（仅本月） */}
      {summaryText && <div className="health-summary">{summaryText}</div>}

      {/* 头部：左标题 + 右导航 */}
      <div className="period-calendar-head">
        <span className="period-calendar-title">
          {yy} 年 {mm} 月
          <span className="period-calendar-subtitle">健康日历</span>
        </span>
        <div className="period-cal-nav-group">
          <button type="button" className="period-cal-nav-btn" onClick={() => shift(-1)} aria-label="上个月">
            ‹
          </button>
          {viewMonth !== currentMonth && (
            <button
              type="button"
              className="period-cal-nav-btn period-cal-nav-text"
              onClick={() => setViewMonth(currentMonth)}
            >
              回到本月
            </button>
          )}
          <button
            type="button"
            className="period-cal-nav-btn"
            onClick={() => canNext && shift(1)}
            disabled={!canNext}
            style={{ opacity: canNext ? 1 : 0.3 }}
            aria-label="下个月"
          >
            ›
          </button>
        </div>
      </div>

      {/* 周表头（周一开头） */}
      <div className="period-calendar-week">
        {WEEK.map((w, i) => (
          <span
            key={w}
            className="period-cal-week-cell"
            style={{ color: i >= 5 ? 'var(--color-text-tertiary)' : 'var(--color-text-secondary)' }}
          >
            {w}
          </span>
        ))}
      </div>

      {/* 格子网格（整格填色圆角方块） */}
      <div className="period-calendar-grid">
        {cells.map((c) => {
          if (!c.inMonth) return <span key={c.date} className="period-cal-cell empty" />
          const marks = markMap[c.date] ?? []
          const isToday = c.date === tStr
          const v = cellVisual(marks, isToday, c.isWeekend)

          let subEl: React.ReactNode = null
          if (v.sub) {
            subEl = <span className="period-cal-sub">{v.sub}</span>
          } else if (c.solarTerm) {
            subEl = <span className="period-cal-sub period-cal-sub-term">{c.solarTerm}</span>
          } else if (c.lunarDay) {
            subEl = <span className="period-cal-sub period-cal-sub-lunar">{c.lunarDay}</span>
          }

          // 经期点滴：整格填色时反白，保证在深底上看得见
          const dotBg = v.dot === 'spotting'
            ? v.solid
              ? 'rgba(255, 255, 255, 0.92)'
              : 'var(--color-period)'
            : undefined

          // 分类点：按固定顺序抽，保证同月每天的位置一致（不只靠颜色辨认）
          const dots = CALENDAR_DOT_MARKS.filter((k) => (marks as string[]).includes(k))
          const shownDots = dots.slice(0, CALENDAR_DOT_MAX)
          const dotMore = Math.max(0, dots.length - CALENDAR_DOT_MAX)

          return (
            <button
              key={c.date}
              type="button"
              className="period-cal-cell"
              style={{ background: v.background, color: v.color, border: v.border }}
              title={
                isToday
                  ? `今天${dots.length ? ` · ${dots.map((k) => CALENDAR_DOT_LABEL[k]).join('、')}` : ''}`
                  : c.date
              }
              onClick={() => onPickDate(c.date)}
            >
              <span className="period-cal-day">{c.day}</span>
              {subEl}
              {dotBg && <span className="period-cal-dot" style={{ background: dotBg }} />}
              {shownDots.length > 0 && (
                <span className="health-cal-dots">
                  {shownDots.map((k) => (
                    <span
                      key={k}
                      className="health-cal-dot"
                      style={{ background: CALENDAR_DOT_COLOR[k] }}
                      title={CALENDAR_DOT_LABEL[k]}
                    />
                  ))}
                  {dotMore > 0 && <span className="health-cal-dot-more">+{dotMore}</span>}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* 图例（a11y：形状差异）
          ⚠️ 经期相关图例仅在启用经期时出现 —— 后端 marks 已按 metrics_enabled 门控，
             图例是前端渲染的，不跟着门控就会出现「没勾经期却挂着经期/预测/易孕/排卵」。 */}
      <div className="period-legend">
        {periodOn && (
          <>
            <span className="period-legend-item period-legend-scale">
              经期 少
              <span className="period-legend-scale-blocks">
                <span className="period-legend-shape" style={{ background: 'var(--color-period-soft)' }} />
                <span className="period-legend-shape" style={{ background: 'var(--color-period-fill-mid)' }} />
                <span className="period-legend-shape" style={{ background: 'var(--color-period-fill-heavy)' }} />
              </span>
              多
            </span>
            <span className="period-legend-item">
              <span
                className="period-legend-shape"
                style={{ background: 'var(--color-period-soft)', border: '1.5px dashed var(--color-period)' }}
              />
              预测
            </span>
            <span className="period-legend-item">
              <span className="period-legend-shape" style={{ background: 'var(--color-fertile-soft)' }} />
              易孕
            </span>
            <span className="period-legend-item">
              <span
                className="period-legend-shape period-legend-round"
                style={{ background: 'var(--color-ovulation-fill)' }}
              />
              排卵
            </span>
            <span className="period-legend-item">
              <span className="period-legend-dot" style={{ background: 'var(--color-period)' }} />
              点滴
            </span>
          </>
        )}
        {/* 分类点图例：颜色之外带文字，不单靠颜色区分（色觉障碍友好）。
            ⚠️ 分类点**不跟着整格填色反白** —— 它们靠颜色区分指标，反白就全丢了。 */}
        {CALENDAR_DOT_MARKS.map((k) => (
          <span key={k} className="period-legend-item">
            <span className="period-legend-dot" style={{ background: CALENDAR_DOT_COLOR[k] }} />
            {CALENDAR_DOT_LABEL[k]}
          </span>
        ))}
      </div>
    </Card>
  )
}
