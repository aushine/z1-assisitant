/**
 * FinancialTab — 财务 Tab（桌面端）
 *
 * SYNC-FROM-MOBILE: life-assisitant-ui-mobile/src/components/FinancialSection.vue
 *                   （子视图集合与子视图→FAB 文案的映射完全对齐）
 * 最后同步：2026-09-19（md/spec-20260919-v1 第四轮重构）
 *
 * 背景：spec 01 §2 把记录模块压成 **3 个领域 Tab**（习惯 / 财务 / 健康）。
 * 桌面端原本是「MoodSection + HabitSection 常驻 → 下方 Card 内 4 个 Tab
 * （收支/预算/账户/经期）」，其中收支/预算/账户三个都是财务域，占了 3/4 的
 * Tab 位。v1 把它们收进单一「财务」Tab，用页内分段控件切换 —— 与移动端
 * FinancialSection 的做法逐项对应。
 *
 * ⚠️ 分段控件在**页内**，不是又一层 Tabs：桌面端的 Tabs 只剩 3 个，
 *    再嵌套一层 Tabs 会出现两条下划线，视觉上像四级导航。
 *
 * ⚠️ 后端零改动：`/accounts` `/transactions` `/budgets` 三组接口保持原样
 *    （07 §3 明确要求不要动后端路由），本组件纯前端信息架构调整。
 */
import { useState } from 'react'
import { RadioGroup, Radio } from '@douyinfe/semi-ui'
import TransactionsTab from './TransactionsTab'
import BudgetTab from './BudgetTab'
import AccountTab from './AccountTab'
import CalendarView from '@/components/finance/CalendarView'
import { useFinanceStore } from '@/stores/finance'

/** 财务的四个子视图 —— 与移动端 FinanceSub 逐字一致（v2 加「日历」） */
export type FinanceSub = 'transactions' | 'budget' | 'account' | 'calendar'

const SUB_OPTIONS: ReadonlyArray<{ value: FinanceSub; label: string }> = [
  { value: 'transactions', label: '收支' },
  { value: 'calendar', label: '日历' },
  { value: 'budget', label: '预算' },
  { value: 'account', label: '账户' },
]

/**
 * @param sub         受控子视图（父级持有；不传则由本组件自持状态）
 * @param onSubChange 子视图变化回传（父级用它决定页头按钮行为）
 */
export function FinancialTab({
  sub: subProp,
  onSubChange,
}: {
  sub?: FinanceSub
  onSubChange?: (sub: FinanceSub) => void
}) {
  const [inner, setInner] = useState<FinanceSub>('transactions')
  const sub = subProp ?? inner

  function change(next: FinanceSub) {
    if (subProp === undefined) setInner(next)
    onSubChange?.(next)
  }

  // 日历「查看全部」→ 切回收支子视图并带上该日筛选（左闭右开）
  function handleViewAll(date: string) {
    const next = new Date(`${date}T00:00:00`)
    next.setDate(next.getDate() + 1)
    const end = next.toISOString().slice(0, 10)
    useFinanceStore.getState().setTxQuery({ start_date: date, end_date: end, type: undefined })
    useFinanceStore.getState().fetchTransactions()
    change('transactions')
  }

  // Phase 4.2：债权债务卡点行 → 切收支子视图并按对方筛选（contact 服务端等值参数）
  function handleViewContact(contact: string) {
    useFinanceStore.getState().setTxQuery({ contact, type: undefined, start_date: undefined, end_date: undefined })
    useFinanceStore.getState().fetchTransactions()
    change('transactions')
  }

  // spec-20260922-v2 · 07 #30b：账户卡「查看流水」→ 切收支并按该账户筛选。
  // 方案 B（Q10 拍板）：工具栏账户 Select 受控于 txQuery.account_id，写入即自动选中；
  // 与移动端不同，桌面端**不注入 chip**（chip 是移动端删下拉后的补偿形态）。
  function handleViewAccount(accountId: string) {
    useFinanceStore.getState().setTxQuery({ account_id: accountId, contact: undefined, start_date: undefined, end_date: undefined })
    useFinanceStore.getState().fetchTransactions()
    change('transactions')
  }

  return (
    <div className="financial-tab">
      <div className="fin-sub">
        <RadioGroup
          value={sub}
          onChange={(e: any) => change(e.target.value as FinanceSub)}
          type="button"
        >
          {SUB_OPTIONS.map((o) => (
            <Radio key={o.value} value={o.value}>
              {o.label}
            </Radio>
          ))}
        </RadioGroup>
      </div>

      {sub === 'transactions' && <TransactionsTab onGotoBudget={() => change('budget')} />}
      {sub === 'calendar' && <CalendarView onViewAll={handleViewAll} />}
      {sub === 'budget' && <BudgetTab />}
      {sub === 'account' && <AccountTab onViewContact={handleViewContact} onViewAccount={handleViewAccount} />}
    </div>
  )
}

export default FinancialTab
