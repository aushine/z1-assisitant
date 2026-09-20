/**
 * PeriodCalendar —— 经期月历（可切月）
 *
 * 视觉语言与「习惯打卡热力图」(HabitHeatmap) 同构：整格填色的圆角方块 +
 * 左上角公历日期 + 下方小字（状态标签 / 节气 / 农历）。色系仍走经期语义令牌
 * （红=经期、紫=易孕/排卵），所有颜色用 var() 令牌，暗色主题下随令牌翻转。
 *
 * 红线守卫：
 *  - 相对安全期**不上色**（后端本就不返回 safe mark，前端也不渲染）
 *  - 隐私遮罩开启：经期 / 预测 / 易孕 / 排卵 / 点滴标记全部不渲染，只保留「今天」环与「已记录」灰点
 *  - 图例常驻，避免只靠颜色区分（a11y）
 *
 * 接口保持不变：export default function PeriodCalendar({ onPickDate })
 */
import { useEffect, useState, useMemo } from 'react'
import { Card } from '@douyinfe/semi-ui'
import { usePeriodStore } from '@/stores/period'
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

/**
 * 按优先级（从高到低）取第一个命中的状态标记，决定整格填充 + 文字色 + 小字标签。
 * 圆点为独立一层，可与填充共存。
 */
function cellVisual(
  marks: PeriodMark[],
  masked: boolean,
  isToday: boolean,
  isWeekend: boolean,
): CellVisual {
  const neutralBg = 'var(--color-bg-hover)'
  const neutralColor = isWeekend ? 'var(--color-text-tertiary)' : 'var(--color-text-primary)'

  // 隐私遮罩：一律中性底，不显示任何状态标记；只保留今天环 + logged 灰点
  if (masked) {
    const v: CellVisual = { background: neutralBg, color: neutralColor, border: '1px solid transparent' }
    if (marks.includes('logged')) v.dot = 'logged'
    if (isToday) v.border = '2px solid var(--color-primary-500)'
    return v
  }

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

export default function PeriodCalendar({ onPickDate }: { onPickDate: (date: string) => void }) {
  const store = usePeriodStore()
  const now = new Date()
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const [viewMonth, setViewMonth] = useState(currentMonth)

  useEffect(() => {
    store.fetchCalendar(viewMonth)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMonth])

  const cache = store.calendarCache[viewMonth]
  const masked = store.masked
  const tStr = todayStr()

  const maxFuture = (() => {
    const d = new Date(now.getFullYear(), now.getMonth() + 12, 1)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  })()
  const canNext = viewMonth < maxFuture

  // 网格：周一开始，行数动态（4~6 行），总格数恒为 7 的倍数，避免末行错位
  const cells = useMemo<CalCell[]>(() => {
    const [y, m] = viewMonth.split('-').map(Number)
    const firstWeekDay = new Date(y, m - 1, 1).getDay() // 0=周日
    const firstCol = (firstWeekDay + 6) % 7 // 周一=0 ... 周日=6
    const daysInMonth = new Date(y, m, 0).getDate()
    const rows = Math.min(6, Math.max(4, Math.ceil((firstCol + daysInMonth) / 7)))
    const totalCells = rows * 7

    // 农历 / 节气范围：网格第一天 → 网格最后一天（原样沿用 HabitHeatmap 的逻辑）
    const gridStart = new Date(y, m - 1, 1 - firstCol)
    const gridEnd = new Date(y, m - 1, 1 - firstCol + totalCells)
    const lunarList = getLunarDatesInRange(gridStart, gridEnd)
    const lunarMap = new Map<string, string>()
    for (const l of lunarList) lunarMap.set(l.date, l.lunarDayCN)
    const terms = getSolarTerms(gridStart, gridEnd)
    const termMap = new Map<string, string>()
    for (const t of terms) termMap.set(t.date, t.name)

    const result: CalCell[] = []
    for (let i = 0; i < totalCells; i++) {
      const dayOffset = i - firstCol
      const dateObj = new Date(y, m - 1, 1 + dayOffset)
      const yy = dateObj.getFullYear()
      const mm = dateObj.getMonth() + 1
      const dd = dateObj.getDate()
      const dateStr = `${yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`
      const inMonth = 1 + dayOffset >= 1 && 1 + dayOffset <= daysInMonth
      const weekDayIdx = dateObj.getDay() // 0=周日
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
      map[d.date] = d.marks
    })
    return map
  }, [cache])

  function shift(delta: number) {
    const [y, m] = viewMonth.split('-').map(Number)
    const d = new Date(y, m - 1 + delta, 1)
    setViewMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }

  const [yy, mm] = viewMonth.split('-').map(Number)

  return (
    <Card bordered={false} className="card period-calendar">
      {/* 头部：左标题 + 右导航 */}
      <div className="period-calendar-head">
        <span className="period-calendar-title">
          {yy} 年 {mm} 月
          <span className="period-calendar-subtitle">经期日历</span>
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
          const v = cellVisual(marks, masked, isToday, c.isWeekend)

          // 小字：状态标签优先；无状态标记时回落到节气（绿）/ 农历（灰）
          let subEl: React.ReactNode = null
          if (v.sub) {
            subEl = <span className="period-cal-sub">{v.sub}</span>
          } else if (c.solarTerm) {
            subEl = (
              <span className="period-cal-sub period-cal-sub-term">{c.solarTerm}</span>
            )
          } else if (c.lunarDay) {
            subEl = (
              <span className="period-cal-sub period-cal-sub-lunar">{c.lunarDay}</span>
            )
          }

          // 圆点配色要压得住任意底色：
          //  - 实心填充（中量/大量/排卵）→ 白色，否则灰点/红点几乎不可见
          //  - 中性或淡底 → 点滴用经期红；已记录用 text-tertiary
          //    （刻意不用 text-disabled：它在淡紫/淡红底上只有约 2:1，太弱）
          const dotBg = v.solid
            ? 'rgba(255, 255, 255, 0.92)'
            : v.dot === 'spotting'
              ? 'var(--color-period)'
              : v.dot === 'logged'
                ? 'var(--color-text-tertiary)'
                : undefined

          return (
            <button
              key={c.date}
              type="button"
              className="period-cal-cell"
              style={{ background: v.background, color: v.color, border: v.border }}
              title={isToday ? '今天' : c.date}
              onClick={() => onPickDate(c.date)}
            >
              <span className="period-cal-day">{c.day}</span>
              {subEl}
              {dotBg && <span className="period-cal-dot" style={{ background: dotBg }} />}
            </button>
          )
        })}
      </div>

      {/* 图例（常驻，a11y：形状差异） */}
      <div className="period-legend">
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
        {masked && <span className="period-legend-hidden">内容已隐藏</span>}
      </div>
    </Card>
  )
}
