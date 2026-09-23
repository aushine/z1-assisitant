/**
 * AssetSummaryCard — 净资产总览汇总（spec-20260922-v1 Phase 4 · 01 §5）。
 *
 * - 标签「总资产」→「净资产」（读 net_worth = assets + investments + debts 恒等）
 * - 三组小计：资金 / 理财 / 负债（负债显示绝对值 + 「负债」标签，不用大红）
 * - 负值用 --color-danger-dark（既有语义）
 * - 卡片标题 emoji → Lucide Landmark（B10 既有）
 *
 * spec-20260922-v2 · 03 §2.2 #10 / §3.1：净资产 + 三组小计走 <MoneyText>（遮罩单一出口），
 * 卡片右上角挂**全站唯一**的金额遮罩开关（Eye/EyeOff）；切换不弹 toast（§3.1）。
 */
import { Card, Tooltip } from '@douyinfe/semi-ui'
import { Icon } from '@/components/icon'
import { MoneyText } from '@/components/finance/MoneyText'
import { useFinanceStore } from '@/stores/finance'

interface Props {
  /** 净资产（= assets + investments + debts ≡ SUM 全部 balance） */
  totalBalance: number
  accounts: number
  /** L1 大类小计（debts 保留负数原值）；缺省不显示小计行（向后兼容） */
  assets?: number
  investments?: number
  debts?: number
}

export function AssetSummaryCard({ totalBalance, accounts, assets, investments, debts }: Props) {
  const isNegative = totalBalance < 0
  const masked = useFinanceStore((s) => s.masked)
  const toggleMasked = useFinanceStore((s) => s.toggleMasked)
  const hasBreakdown =
    typeof assets === 'number' && typeof investments === 'number' && typeof debts === 'number'
  return (
    <Card bordered={false} className="summary-card asset-summary" bodyStyle={{ padding: 16 }}>
      {/* 遮罩开关（03 §2.3 / §3.1）：位置=卡片右上角，图标 18px，语义 = 当前状态不是动作 */}
      <Tooltip content={masked ? '显示金额' : '隐藏金额'}>
        <button
          type="button"
          className="mask-toggle"
          aria-label={masked ? '金额已隐藏' : '隐藏金额'}
          onClick={toggleMasked}
        >
          <Icon name={masked ? 'EyeOff' : 'Eye'} size={18} />
        </button>
      </Tooltip>
      <div className="summary-label">
        <Icon name="Landmark" size={16} style={{ marginRight: 4, verticalAlign: '-2px' }} />
        净资产
      </div>
      <div
        className="summary-value"
        style={{ color: isNegative ? 'var(--color-danger-dark)' : 'var(--color-primary-500)', fontWeight: 700, fontSize: 22, marginTop: 4 }}
      >
        <MoneyText value={totalBalance} />
      </div>
      <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)', marginTop: 4 }}>
        共 {accounts} 个账户
      </div>
      {hasBreakdown && (
        <div className="summary-breakdown">
          <span>资金 <MoneyText value={assets!} /></span>
          <span>理财 <MoneyText value={investments!} /></span>
          {(debts ?? 0) < 0 && <span className="summary-debt">负债 <MoneyText value={Math.abs(debts!)} /></span>}
        </div>
      )}
    </Card>
  )
}

export default AssetSummaryCard
