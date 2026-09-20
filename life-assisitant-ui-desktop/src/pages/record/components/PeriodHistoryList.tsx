/**
 * PeriodHistoryList —— 最近周期列表
 *
 * 数据：usePeriodStore.cycles（GET /period/cycles）。
 * 红线：隐私遮罩开启时，日期与天数 → 掩码（只保留操作，不阉割）。
 */
import { Card } from '@douyinfe/semi-ui'
import { Icon } from '@/components/icon'
import { usePeriodStore } from '@/stores/period'
import { PERIOD_MASK_TEXT } from '@/constants/period'

function fmtMD(s?: string): string {
  if (!s) return '—'
  const [, m, d] = s.split('-')
  return `${Number(m)}月${Number(d)}日`
}

export default function PeriodHistoryList({ onPickCycle }: { onPickCycle: (start: string) => void }) {
  const store = usePeriodStore()
  const cycles = store.cycles
  const masked = store.masked

  return (
    <Card bordered={false} className="card period-history">
      <div className="card-head">
        <span className="card-title">最近周期</span>
      </div>
      {cycles.length === 0 ? (
        <div className="period-history-empty" style={{ color: 'var(--color-text-tertiary)' }}>
          还没有周期记录
        </div>
      ) : (
        <div className="period-history-list">
          {cycles.slice(0, 6).map((c) => (
            <div
              key={c.id}
              className="period-history-row"
              role="button"
              tabIndex={0}
              onClick={() => onPickCycle(c.start_date)}
              onKeyDown={(e) => e.key === 'Enter' && onPickCycle(c.start_date)}
            >
              <div className="period-history-date">
                {masked ? PERIOD_MASK_TEXT : `${fmtMD(c.start_date)} – ${fmtMD(c.end_date)}`}
              </div>
              <div className="period-history-meta">
                <span>经期 {masked ? PERIOD_MASK_TEXT : `${c.period_length} 天`}</span>
                <span style={{ marginLeft: 12 }}>
                  周期 {masked ? PERIOD_MASK_TEXT : c.cycle_length != null ? `${c.cycle_length} 天` : '—'}
                </span>
                {c.suspect && (
                  <span style={{ marginLeft: 12, color: 'var(--color-warning)' }} title="间隔很短，是否录入有误？">
                    疑
                  </span>
                )}
              </div>
              <Icon name="ChevronRight" size={16} className="period-history-arrow" />
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}
