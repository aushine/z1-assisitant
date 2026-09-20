/**
 * AssetSummaryCard — 资产总览汇总。
 * 卡片标题 emoji → Lucide Landmark（B10）。
 */
import { Card } from '@douyinfe/semi-ui'
import { Icon } from '@/components/icon'

interface Props {
  totalBalance: number
  accounts: number
}

export function AssetSummaryCard({ totalBalance, accounts }: Props) {
  const isNegative = totalBalance < 0
  return (
    <Card bordered={false} className="summary-card asset-summary" bodyStyle={{ padding: 16 }}>
      <div className="summary-label">
        <Icon name="Landmark" size={16} style={{ marginRight: 4, verticalAlign: '-2px' }} />
        总资产
      </div>
      <div
        className="summary-value"
        style={{ color: isNegative ? 'var(--color-danger-dark)' : 'var(--color-primary-500)', fontWeight: 700, fontSize: 22, marginTop: 4 }}
      >
        ¥{totalBalance.toFixed(2)}
      </div>
      <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)', marginTop: 4 }}>
        共 {accounts} 个账户
      </div>
    </Card>
  )
}

export default AssetSummaryCard
