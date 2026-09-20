/**
 * IncomeSummaryCard — 本月收入汇总。
 * 卡片标题 emoji → Lucide Banknote；涨跌箭头半图标 → Lucide TrendingUp/Down（B09/B10）。
 */
import { Card } from '@douyinfe/semi-ui'
import { Icon } from '@/components/icon'

interface Props {
  income: number
  change: number  // percentage vs 上月
}

export function IncomeSummaryCard({ income, change }: Props) {
  const isUp = change >= 0
  return (
    <Card bordered={false} className="summary-card income-summary" bodyStyle={{ padding: 16 }}>
      <div className="summary-label">
        <Icon name="Banknote" size={16} style={{ marginRight: 4, verticalAlign: '-2px' }} />
        本月收入
      </div>
      <div className="summary-value" style={{ color: 'var(--color-success-dark)', fontWeight: 700, fontSize: 22, marginTop: 4 }}>
        +¥{income.toFixed(0)}
      </div>
      <div className="summary-change" style={{ color: isUp ? 'var(--color-success)' : 'var(--color-danger)', fontSize: 12, marginTop: 4 }}>
        {isUp ? <Icon name="TrendingUp" size={14} /> : <Icon name="TrendingDown" size={14} />} {Math.abs(change)}% vs 上月
      </div>
    </Card>
  )
}

export default IncomeSummaryCard
