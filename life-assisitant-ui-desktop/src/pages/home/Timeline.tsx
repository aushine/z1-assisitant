/**
 * 生活时间线组件（04 §4）。
 *
 * 把「今天」的跨模块记录（任务完成 / 习惯打卡 / 记账 / 心情）连成一条叙事：
 * - 左侧 2px 竖线为轴，节点按事件类型 tint 着色
 * - 时间固定宽度 + 等宽数字
 * - 金额等宽数字，支出红 / 收入绿
 * - 顶部一条「现在」高亮分隔线
 *
 * 数据来自 GET /timeline（已按完整时间戳倒序）。
 */
import { TINT_VARS } from '@/components/icon'
import type { IconName, TintName } from '@/components/icon'
import type { TimelineEvent, TimelineEventType } from '@/api/types'

interface TypeMeta {
  icon: IconName
  tint: TintName
  label: string
}

const TYPE_META: Record<TimelineEventType, TypeMeta> = {
  task: { icon: 'CheckSquare', tint: 'primary', label: '任务' },
  habit: { icon: 'CalendarCheck', tint: 'success', label: '习惯' },
  expense: { icon: 'TrendingDown', tint: 'danger', label: '支出' },
  income: { icon: 'TrendingUp', tint: 'success', label: '收入' },
  mood: { icon: 'Smile', tint: 'accent', label: '心情' },
}

const FALLBACK_META: TypeMeta = { icon: 'CircleDot', tint: 'neutral', label: '记录' }

function formatAmount(n: number): string {
  const sign = n < 0 ? '-' : '+'
  return `${sign}¥${Math.abs(n).toFixed(2)}`
}

export default function Timeline({ items }: { items: TimelineEvent[] }) {
  if (!items || items.length === 0) return null

  return (
    <div className="timeline">
      {/* 「现在」分隔线 —— 顶部高亮，分隔已发生的过去与尚未发生的未来 */}
      <div className="timeline-now">
        <span className="timeline-now-line" />
        <span className="timeline-now-label">现在</span>
      </div>

      {items.map((ev) => {
        const meta = TYPE_META[ev.type] ?? FALLBACK_META
        const tv = TINT_VARS[meta.tint]
        return (
          <div key={ev.id} className="timeline-item">
            <div className="timeline-time">{ev.time}</div>
            <div className="timeline-axis">
              <span
                className="timeline-node"
                title={meta.label}
                style={{ background: tv.fg, boxShadow: `0 0 0 3px ${tv.bg}` }}
              />
            </div>
            <div className="timeline-content">
              <div className="timeline-title">{ev.title}</div>
              {ev.detail && <div className="timeline-detail">{ev.detail}</div>}
            </div>
            {ev.amount != null && (
              <div className={`timeline-amount ${ev.amount < 0 ? 'is-expense' : 'is-income'}`}>
                {formatAmount(ev.amount)}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
