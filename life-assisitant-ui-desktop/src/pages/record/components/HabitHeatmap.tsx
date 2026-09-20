/**
 * HabitHeatmap — 当月习惯打卡日历热力图
 * 7 列（周一~周日）× 最多 6 行，连续格子，热度沿用绿色色阶
 * 每个格子显示：几号（公历）、农历日、节气、节假日/调休标识
 * 周六日格子灰色；法定节假日/调休标红；节气标绿
 *
 * ⚠️ 本文件中的 hex 字面量（含 A07 §4.2 点名的 `#3B82F6` / `#DC2626`）
 * 是**刻意保留**的，不是漏改：
 *
 *   格子的底色来自 `@/utils/heatmap` 的固定绿色阶（见该文件说明——顺序色阶
 *   不随主题翻转），因此**即使暗色主题下格子仍是浅底**。格内文字/边框必须与
 *   「浅底」保持对比，而不能与页面主题联动：
 *
 *     #9CA3AF  周末数字 / 农历日   → 换成 --color-text-tertiary 会在暗色下
 *                                   变浅（#9CA3AF 恰好同值）而在亮色下变深，
 *                                   与相邻格子不一致
 *     #3B82F6  今日格子外框        → 换成 --color-primary-500 会在暗色下变
 *                                   成 #5B9DFF 浅蓝，压在浅底上几乎看不见
 *     #DC2626  节气/节假日/「班」  → 换成 --color-danger 会在暗色下变成
 *                                   #F87171 浅红，同样压不住浅底
 *
 * 图例（「少 / 多 / 周末灰色…」那一行）在页面背景上，不受此限，如需令牌化
 * 应只改那一处。 —— 若后续把色阶改为主题联动，则本文件的字面量应同步令牌化。
 */
import { useMemo } from 'react'
import { Tooltip } from '@douyinfe/semi-ui'
import {
  getLunarDatesInRange,
  getSolarTerms,
  getDayDetail,
  isWorkday,
} from 'chinese-days'
import type { HabitHeatmapItem } from '@/api/types'
import { heatColor } from '@/utils/heatmap'

interface Props {
  data: HabitHeatmapItem[]
  year: number
  month: number // 1-12
}

const WEEK_HEADERS = ['一', '二', '三', '四', '五', '六', '日']

interface DayCell {
  date: string        // YYYY-MM-DD
  day: number         // 几号（公历）
  weekDay: number     // 0=周一 ... 6=周日
  inMonth: boolean    // 是否本月
  isWeekend: boolean  // 周六/周日
  lunarDay: string    // 农历日，如 "十九"、"初一"
  solarTerm: string   // 节气名（空表示无）
  holidayName: string // 节假日名（空表示无）
  isHoliday: boolean  // 法定节假日（含调休放假）
  isWorkdayInLieu: boolean // 调休补班日（本周末却要上班）
  ratio: number       // 完成率 0~1
  completed: number
  total: number
}

export function HabitHeatmap({ data, year, month }: Props) {
  const cells = useMemo<DayCell[]>(() => {
    // 当月天数
    const daysInMonth = new Date(year, month, 0).getDate()
    // 当月 1 号是星期几（0=周日, 1=周一 ... 6=周六）
    const firstWeekDay = new Date(year, month - 1, 1).getDay() // 0=周日
    // 转成周一=0 的索引
    const firstCol = (firstWeekDay + 6) % 7 // 周一=0 ... 周日=6

    // 构建网格：动态行数（含该月最后一天所在行），最多 6 行
    const lastOffset = firstCol + daysInMonth - 1
    const rows = Math.min(6, Math.max(4, Math.ceil((lastOffset + 1) / 7)))
    const totalCells = rows * 7
    const result: DayCell[] = []

    // 打卡数据 map
    const dataMap = new Map<string, HabitHeatmapItem>()
    for (const d of data) dataMap.set(d.date, d)

    // 农历范围：从网格第一天到网格最后一天
    const gridStart = new Date(year, month - 1, 1 - firstCol)
    const gridEnd = new Date(year, month - 1, 1 - firstCol + totalCells)
    const lunarList = getLunarDatesInRange(gridStart, gridEnd)
    const lunarMap = new Map<string, string>()
    for (const l of lunarList) lunarMap.set(l.date, l.lunarDayCN)

    // 节气
    const terms = getSolarTerms(gridStart, gridEnd)
    const termMap = new Map<string, string>()
    for (const t of terms) termMap.set(t.date, t.name)

    for (let i = 0; i < totalCells; i++) {
      const col = i % 7
      const row = Math.floor(i / 7)
      const dayOffset = row * 7 + col - firstCol // 相对 1 号的偏移
      const dateObj = new Date(year, month - 1, 1 + dayOffset)
      const y = dateObj.getFullYear()
      const m = dateObj.getMonth() + 1
      const d = dateObj.getDate()
      const dateStr = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`

      const inMonth = (1 + dayOffset) >= 1 && (1 + dayOffset) <= daysInMonth
      const weekDayIdx = dateObj.getDay() // 0=周日
      const isWeekend = weekDayIdx === 0 || weekDayIdx === 6

      // 节假日/调休
      let holidayName = ''
      let isHoliday = false
      let isWorkdayInLieu = false
      if (inMonth) {
        const detail = getDayDetail(dateStr)
        if (detail.work === false) {
          // 法定节假日（含假期中的周末，如国庆 10/3、10/4）；name 格式 "英文名,中文名,天数" → 取倒数第二段中文名
          const parts = (detail.name || '').split(',')
          holidayName = parts.length >= 2 ? parts[parts.length - 2] : ''
          if (holidayName) isHoliday = true
        } else if (isWeekend && isWorkday(dateStr)) {
          // 周末但被调休补班
          isWorkdayInLieu = true
        }
        // 注意：调休补班日（如国庆 10/10 周六）work=true，name 虽含"国庆节"但不标节日，走上面的 isWorkdayInLieu 标"班"
      }

      // 完成率
      const item = dataMap.get(dateStr)
      const completed = item?.completed ?? 0
      const total = item?.total ?? 0
      const ratio = total > 0 ? completed / total : 0

      result.push({
        date: dateStr,
        day: d,
        weekDay: weekDayIdx,
        inMonth,
        isWeekend,
        lunarDay: lunarMap.get(dateStr) ?? '',
        solarTerm: termMap.get(dateStr) ?? '',
        holidayName,
        isHoliday,
        isWorkdayInLieu,
        ratio,
        completed,
        total,
      })
    }

    return result
  }, [data, year, month])

  const todayStr = useMemo(() => {
    const n = new Date()
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`
  }, [])

  return (
    <div className="habit-calendar" style={{ width: '50%' }}>
      {/* 表头 */}
      <div className="habit-cal-week" style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', marginBottom: 8 }}>
        {WEEK_HEADERS.map((w, i) => (
          <div
            key={w}
            style={{
              textAlign: 'center',
              fontSize: 12,
              fontWeight: 600,
              color: i >= 5 ? '#9CA3AF' : 'var(--color-text-secondary)',
              padding: '4px 0',
            }}
          >
            {w}
          </div>
        ))}
      </div>

      {/* 格子网格 */}
      <div className="habit-cal-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6 }}>
        {cells.map((c) => {
          const isToday = c.date === todayStr
          const bg = c.inMonth ? heatColor(c.ratio) : 'transparent'
          // 周末且当月（非法定节假日）：灰色底；法定节假日不灰，用热度色，红色文字标识
          const cellBg = c.isWeekend && c.inMonth && !c.isHoliday ? '#F9FAFB' : bg
          // 热力深绿色背景上的农历文字用白色，浅色背景用灰色
          const lunarColor = c.inMonth && c.ratio >= 0.5 ? '#FFFFFF' : '#9CA3AF'

          const cell = (
            <div
              style={{
                position: 'relative',
                minHeight: 64,
                borderRadius: 8,
                padding: 4,
                background: cellBg,
                opacity: c.inMonth ? 1 : 0.35,
                border: isToday ? '2px solid #3B82F6' : '1px solid transparent',
                display: 'flex',
                flexDirection: 'column',
                transition: 'none',
              }}
            >
              {/* 公历几号 */}
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  lineHeight: 1,
                  color: c.isWeekend && c.inMonth && !c.isHoliday ? '#9CA3AF' : 'var(--color-text-primary)',
                }}
              >
                {c.inMonth ? c.day : ''}
              </div>

              {/* 农历 / 节气 / 节假日 标识 */}
              <div style={{ marginTop: 2, fontSize: 10, lineHeight: 1.3, display: 'flex', flexDirection: 'column', gap: 1 }}>
                {c.solarTerm ? (
                  <span style={{ color: '#059669', fontWeight: 600 }}>{c.solarTerm}</span>
                ) : c.lunarDay && c.inMonth ? (
                  <span style={{ color: lunarColor }}>{c.lunarDay}</span>
                ) : null}
                {c.isHoliday && c.holidayName ? (
                  <span style={{ color: '#DC2626', fontWeight: 600 }}>{c.holidayName}</span>
                ) : null}
                {c.isWorkdayInLieu ? (
                  <span style={{ color: '#DC2626', fontWeight: 600 }}>班</span>
                ) : null}
              </div>
            </div>
          )

          // 非本月格子不挂 Tooltip，避免空白气泡
          if (!c.inMonth) {
            return <div key={c.date}>{cell}</div>
          }

          return (
            <Tooltip
              key={c.date}
              content={`${c.date} 完成 ${c.completed}/${c.total}${c.solarTerm ? ' · ' + c.solarTerm : ''}${c.holidayName ? ' · ' + c.holidayName : ''}`}
            >
              {cell}
            </Tooltip>
          )
        })}
      </div>

      {/* 图例 */}
      <div className="heatmap-legend" style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 12 }}>
        <span style={{ fontSize: 11, color: '#9CA3AF' }}>少</span>
        {[0, 0.25, 0.5, 0.75, 1].map((r) => (
          <div key={r} style={{ width: 14, height: 14, borderRadius: 3, background: heatColor(r) }} />
        ))}
        <span style={{ fontSize: 11, color: '#9CA3AF' }}>多</span>
        <span style={{ marginLeft: 12, fontSize: 11, color: '#9CA3AF' }}>周末灰色 · 节气绿色 · 节日红色</span>
      </div>
    </div>
  )
}

export default HabitHeatmap
