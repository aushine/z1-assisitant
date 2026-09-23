/**
 * SummaryCards —— 收支页顶部数据块（桌面端 · spec-20260922-v2 · 01 §2 / §2.7）
 *
 * SYNC-FROM-MOBILE: life-assisitant-ui-mobile/src/components/finance/SummaryCards.vue
 * （两卡两面 / 三热区 / 边界态与移动端**同构**；周期与两面存**同一组 localStorage key**
 *   —— 01 §2.7「用户在一端选了另一段也跟着变」是期望行为，key 见 constants/finance.ts）
 *
 * 左块：本月收入 ⇄ 本月支出（块主体点击翻面）
 * 右块：剩余预算 ⇄ 月结余（翻面 + 标题里的「月/周/年」周期字独立热区，月→周→年 循环）
 * 四个数全部走 GET /finance/summary（服务端口径，修 S2/S3）。
 *
 * 边界态（01 §2.8）：加载 = 骨架无 spinner；失败 = `—` + 「加载失败 · 点击重试」；
 * 无 total 预算 = `—` + 「未设预算 · 去设置 ›」（onGotoBudget，不显示 ¥0）；结余负 = danger。
 * 桌面差异（01 §2.7）：周期字改为 Semi Dropdown 下拉选择（R5 2026-09-24，原为点单字循环）。
 */
import { useEffect } from 'react'
import { Dropdown } from '@douyinfe/semi-ui'
import { Icon } from '@/components/icon'
import { useFinanceStore } from '@/stores/finance'
import { MoneyText } from '@/components/finance/MoneyText'
import type { MoneyType } from '@/utils/money'

const CARD: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  height: 84,
  boxSizing: 'border-box',
  padding: '10px 16px',
  borderRadius: 'var(--radius-lg)',
  background: 'var(--color-bg-card)',
  border: '1px solid var(--color-border-light)',
  cursor: 'pointer',
  userSelect: 'none',
  overflow: 'hidden',
}
const TITLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 12,
  lineHeight: '16px',
  color: 'var(--color-text-secondary)',
  whiteSpace: 'nowrap',
}
const MAIN: React.CSSProperties = {
  fontSize: 22,
  fontWeight: 700,
  lineHeight: '30px',
  fontVariantNumeric: 'tabular-nums',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
}
const SUB: React.CSSProperties = {
  fontSize: 12,
  lineHeight: '16px',
  color: 'var(--color-text-tertiary)',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
}
const FLIP: React.CSSProperties = { fontSize: 12, color: 'var(--color-text-tertiary)' }
const PERIOD: React.CSSProperties = {
  color: 'var(--color-primary)',
  cursor: 'pointer',
  borderBottom: '1px dashed var(--color-primary)',
  lineHeight: '16px',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 2,
}
const SK: React.CSSProperties = {
  display: 'block',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--color-bg-hover)',
}

export function SummaryCards({ onGotoBudget }: { onGotoBudget?: () => void }) {
  const summary = useFinanceStore((s) => s.summary)
  const loading = useFinanceStore((s) => s.summaryLoading)
  const error = useFinanceStore((s) => s.summaryError)
  const period = useFinanceStore((s) => s.summaryPeriod)
  const cardLeft = useFinanceStore((s) => s.summaryCardLeft)
  const cardRight = useFinanceStore((s) => s.summaryCardRight)
  const fetchSummary = useFinanceStore((s) => s.fetchSummary)
  const setPeriod = useFinanceStore((s) => s.setSummaryPeriod)
  const flipLeft = useFinanceStore((s) => s.flipSummaryCardLeft)
  const flipRight = useFinanceStore((s) => s.flipSummaryCardRight)

  /** 进视图就拉一次（数字常新；翻面/切周期的刷新由 store 动作自己触发） */
  useEffect(() => {
    void fetchSummary()
  }, [fetchSummary])

  /* 三态（01 §2.8）：加载/首次无数据 = 骨架；失败 = 重试态；否则数据 */
  const phase: 'skeleton' | 'error' | 'data' =
    loading || !summary ? (error ? 'error' : 'skeleton') : 'data'

  const pShort = period === 'week' ? '周' : period === 'year' ? '年' : '月'
  const pPrefix = `今${pShort}`

  /* 左块（收入 face 带 +¥ 绿 / 支出 face 带 −¥(U+2212) 红；副行 = 另一面无符号）
     ⚠️ 数字一律交给 <MoneyText>（03 §2.2 #16）：遮罩态它自带中性色，
        会盖过父容器继承来的红/绿 ⇒ 不泄露正负 */
  const leftFace: MoneyType = cardLeft === 'income' ? 'income' : 'expense'
  const leftTitle = `${pPrefix}${cardLeft === 'income' ? '收入' : '支出'}`
  const leftMainValue = summary ? (cardLeft === 'income' ? summary.income : summary.expense) : 0
  const leftMainColor = summary
    ? cardLeft === 'income'
      ? 'var(--color-success-dark)'
      : 'var(--color-danger-dark)'
    : 'var(--color-text-primary)'
  const leftSubValue = summary ? (cardLeft === 'income' ? summary.expense : summary.income) : 0

  /* 右块 */
  const budgetEmpty = !!summary && summary.budget.count === 0
  /** R5：周期选择（下拉）——替代原「点单字循环」。桌面端用 Semi Dropdown。 */
  const periodMenu = (
    <Dropdown.Menu>
      {([['week', '本周'], ['month', '本月'], ['year', '本年']] as const).map(([val, label]) => (
        <Dropdown.Item
          key={val}
          type={period === val ? 'primary' : 'tertiary'}
          onClick={() => setPeriod(val)}
        >
          {label}{period === val ? ' ✓' : ''}
        </Dropdown.Item>
      ))}
    </Dropdown.Menu>
  )
  const periodTrigger = (
    <span style={PERIOD} onClick={(e) => e.stopPropagation()}>
      {pShort}
      <Icon name="ChevronDown" size={12} />
    </span>
  )

  const rightTitleA = (
      <>
        <span>剩余预算 ·</span>
        <Dropdown trigger="click" position="bottomLeft" render={periodMenu}>
          {periodTrigger}
        </Dropdown>
      </>
  )
  const rightTitleB = (
      <>
        <Dropdown trigger="click" position="bottomLeft" render={periodMenu}>
          {periodTrigger}
        </Dropdown>
        <span>结余</span>
      </>
  )
  /** null = 无 total 预算（渲染 `—`，不显示 ¥0，Q3） */
  let rightMainValue: number | null = null
  let rightSigned: MoneyType | '' = ''
  let rightMainColor = 'var(--color-text-primary)'
  let rightSubPrefix = ''
  let rightSubValue: number | null = null
  let rightSubText = ''
  let rightSubAction = false
  if (summary) {
    if (cardRight === 'budget') {
      if (budgetEmpty) {
        rightSubText = '未设预算 · 去设置 ›'
        rightSubAction = true
      } else {
        rightMainValue = Math.abs(summary.budget.remaining)
        rightSigned = summary.budget.remaining < 0 ? 'expense' : ''
        if (summary.budget.remaining < 0) rightMainColor = 'var(--color-danger-dark)'
        rightSubPrefix = `${pShort}结余 `
        rightSubValue = summary.net
      }
    } else {
      rightMainValue = Math.abs(summary.net)
      rightSigned = summary.net >= 0 ? 'income' : 'expense'
      rightMainColor = summary.net >= 0 ? 'var(--color-success-dark)' : 'var(--color-danger-dark)'
      if (budgetEmpty) {
        rightSubText = '剩余预算 —'
      } else {
        rightSubPrefix = '剩余预算 '
        rightSubValue = summary.budget.remaining
      }
    }
  }

  const onLeftBody = () => {
    if (phase === 'error') void fetchSummary()
    else if (phase === 'data') flipLeft()
  }
  const onRightBody = () => {
    if (phase === 'error') void fetchSummary()
    else if (phase === 'data') flipRight()
  }

  return (
    <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
      {/* ==================== 左块 ==================== */}
      <div style={CARD} onClick={onLeftBody} title={phase === 'data' ? '点击切换 收入 / 支出' : undefined}>
        {phase === 'data' ? (
          <>
            <div style={TITLE}><span>{leftTitle}</span><span style={FLIP}>⇄</span></div>
            <div style={{ ...MAIN, color: leftMainColor }}>
              <MoneyText value={leftMainValue} signed={leftFace} />
            </div>
            <div style={SUB}>
              {cardLeft === 'income' ? '支出 ' : '收入 '}<MoneyText value={leftSubValue} />
            </div>
          </>
        ) : phase === 'error' ? (
          <>
            <div style={TITLE}><span>数据</span></div>
            <div style={MAIN}>—</div>
            <div style={SUB}>加载失败 · 点击重试</div>
          </>
        ) : (
          <>
            <span style={{ ...SK, width: '40%', height: 12 }} />
            <span style={{ ...SK, width: '62%', height: 22, display: 'block', marginTop: 6 }} />
          </>
        )}
      </div>

      {/* ==================== 右块 ==================== */}
      <div style={CARD} onClick={onRightBody} title={phase === 'data' ? '点击切换 预算 / 结余' : undefined}>
        {phase === 'data' ? (
          <>
            <div style={TITLE}>
              {cardRight === 'budget' ? rightTitleA : rightTitleB}
              <span style={FLIP}>⇄</span>
            </div>
            <div style={{ ...MAIN, color: rightMainColor }}>
              {rightMainValue === null ? '—' : <MoneyText value={rightMainValue} signed={rightSigned} />}
            </div>
            <div
              style={{ ...SUB, ...(rightSubAction ? { color: 'var(--color-primary)', cursor: 'pointer' } : null) }}
              onClick={
                rightSubAction
                  ? (e) => { e.stopPropagation(); onGotoBudget?.() }
                  : undefined
              }
            >
              {rightSubValue === null
                ? rightSubText
                : <>{rightSubPrefix}<MoneyText value={rightSubValue} /></>}
            </div>
          </>
        ) : phase === 'error' ? (
          <>
            <div style={TITLE}>
              <span>数据 ·</span>
              <Dropdown trigger="click" position="bottomLeft" render={periodMenu}>
                {periodTrigger}
              </Dropdown>
            </div>
            <div style={MAIN}>—</div>
            <div style={SUB}>加载失败 · 点击重试</div>
          </>
        ) : (
          <>
            <span style={{ ...SK, width: '46%', height: 12 }} />
            <span style={{ ...SK, width: '62%', height: 22, display: 'block', marginTop: 6 }} />
          </>
        )}
      </div>
    </div>
  )
}

export default SummaryCards
