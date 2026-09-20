/**
 * TransactionsTab — 收支 Tab（D-03 第十六轮由「支出」正名）
 *
 * 收支交易统一入口：支出/收入混合列表（排除转账）+ 类型筛选 + 收入/总资产汇总卡。
 * 原「支出」「收入」两个 Tab 本就渲染同一份混合列表（IncomeTab 是其纯子集），
 * 第十六轮删除重复的收入 Tab，合并为单一「收支」。记收入经「记一笔」抽屉内
 * 的类型切换完成（TransactionEditDrawer 自带 expense/income/transfer 三态）。
 *
 * R8/R9：搜索经防抖写入 txQuery.keyword 并重新拉取（见 TransactionToolbar）。
 * R10：类别 emoji 直出改为 <Icon>，走 findCategoryByEmoji（category-dict）反查 icon+tint，
 *      查不到则降级 HelpCircle + neutral（B12 兜底）。
 */
import { useEffect, useMemo, useState } from 'react'
import { Button, Table, Skeleton, Tooltip, Modal } from '@douyinfe/semi-ui'
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table'
import { Icon } from '@/components/icon'
import { useFinanceStore } from '@/stores/finance'
import { financeApi } from '@/api/finance'
import TransactionEditDrawer from '@/components/TransactionEditDrawer'
import ErrorState from '@/components/ErrorState'
import { EmptyHint } from '@/components/EmptyState'
import { TransactionToolbar } from './components/TransactionToolbar'
import { CategoryIconCell } from './components/CategoryIconCell'
import { ReverseButton } from './components/ReverseButton'
import { IncomeSummaryCard } from './components/IncomeSummaryCard'
import { AssetSummaryCard } from './components/AssetSummaryCard'
import type { Transaction, TransactionType, CreateTransactionReq } from '@/api/types'

const TX_TYPE_META: Record<TransactionType, { label: string; bg: string; fg: string }> = {
  expense: { label: '支出', bg: 'var(--color-danger-light)', fg: 'var(--color-danger-dark)' },
  income: { label: '收入', bg: 'var(--color-success-light)', fg: 'var(--color-success-dark)' },
  transfer: { label: '转账', bg: 'var(--color-accent-light)', fg: 'var(--color-accent-dark)' },
}

function formatDate(iso: string) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function formatAmount(t: Transaction) {
  const sign = t.type === 'income' ? '+' : t.type === 'expense' ? '-' : '↔'
  return `${sign} ¥${t.amount.toFixed(2)}`
}

export function TransactionsTab() {
  const financeStore = useFinanceStore()
  const [txDrawerVisible, setTxDrawerVisible] = useState(false)
  const [txSaving, setTxSaving] = useState(false)
  const [drawerType, setDrawerType] = useState<TransactionType>('expense')
  const [typeFilter, setTypeFilter] = useState<TransactionType | undefined>(undefined)
  const [error, setError] = useState(false)

  // 初次加载探错（index.tsx 已在 mount 时 fetchTransactions，但 store 会静默吞错）
  useEffect(() => {
    let alive = true
    financeApi
      .listTransactions({})
      .then(() => { if (alive) setError(false) })
      .catch(() => { if (alive) setError(true) })
    return () => { alive = false }
  }, [])

  // 排除转账，再按客户端类型筛选
  const filteredTransactions = useMemo(() =>
    financeStore.transactions.filter((t) =>
      (t.type === 'expense' || t.type === 'income') &&
      (!typeFilter || t.type === typeFilter)
    ),
    [financeStore.transactions, typeFilter]
  )

  const totalIncome = useMemo(() => {
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    return financeStore.transactions
      .filter((t) => t.type === 'income' && new Date(t.happened_at) >= monthStart)
      .reduce((sum, t) => sum + t.amount, 0)
  }, [financeStore.transactions])

  const txColumns = useMemo<ColumnProps<Transaction>[]>(() => [
    {
      title: '日期',
      dataIndex: 'happened_at',
      width: 160,
      render: (v: string) => (
        <span style={{ color: 'var(--color-text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
          {formatDate(v)}
        </span>
      ),
    },
    {
      title: '类型',
      dataIndex: 'type',
      width: 90,
      render: (v: TransactionType) => {
        const m = TX_TYPE_META[v]
        return <span style={{ background: m.bg, color: m.fg, padding: '2px 8px', borderRadius: 4, fontSize: 12 }}>{m.label}</span>
      },
    },
    {
      title: '类别',
      dataIndex: 'category_name',
      width: 140,
      render: (_v: any, r: Transaction, _i: number) => (
        <CategoryIconCell emoji={r.category_emoji} name={r.category_name} />
      ),
    },
    {
      title: '账户',
      dataIndex: 'account_id',
      width: 160,
      render: (_v: any, r: Transaction, _i: number) => (
        <div style={{ color: 'var(--color-text-secondary)' }}>
          {r.account_name || r.account_id}
        </div>
      ),
    },
    {
      title: '金额',
      dataIndex: 'amount',
      width: 140,
      align: 'right',
      render: (_v: any, r: Transaction, _i: number) => {
        const m = TX_TYPE_META[r.type]
        return (
          <span style={{ fontWeight: 600, color: m.fg, fontVariantNumeric: 'tabular-nums' }}>
            {formatAmount(r)}
          </span>
        )
      },
    },
    {
      title: '备注',
      dataIndex: 'note',
      width: 160,
      render: (v?: string) => <span style={{ color: 'var(--color-text-tertiary)' }}>{v || '—'}</span>,
    },
    {
      title: '操作',
      dataIndex: 'actions',
      width: 140,
      render: (_v: any, r: Transaction, _i: number) => (
        <div className="col-actions">
          <ReverseButton tx={r} onReversed={() => financeStore.fetchTransactions()} />
          <Tooltip content="删除">
            <Button
              theme="borderless"
              type="danger"
              size="small"
              icon={<Icon name="X" size={16} />}
              onClick={() => {
                Modal.confirm({
                  title: '删除交易',
                  content: `确认删除「${r.category_name} ¥${r.amount.toFixed(2)}」？`,
                  okText: '删除',
                  okButtonProps: { type: 'danger', theme: 'solid' },
                  cancelText: '取消',
                  onOk: async () => {
                    await financeStore.removeTransaction(r.id)
                  },
                })
              }}
            />
          </Tooltip>
        </div>
      ),
    },
  ], [financeStore])

  function openCreateTx(type: TransactionType = 'expense') {
    setDrawerType(type)
    setTxDrawerVisible(true)
  }

  async function onTxSubmit(data: CreateTransactionReq) {
    setTxSaving(true)
    try {
      const created = await financeStore.createTransaction(data)
      if (created) setTxDrawerVisible(false)
    } finally {
      setTxSaving(false)
    }
  }

  const loadingEmpty = financeStore.txLoading && filteredTransactions.length === 0
  const showError = error && !financeStore.txLoading && filteredTransactions.length === 0

  return (
    <div className="transactions-tab">
      <TransactionToolbar
        showTypeFilter
        typeFilter={typeFilter}
        onTypeFilterChange={setTypeFilter}
        primaryLabel="记一笔"
        primaryType="primary"
        primaryTheme="solid"
        onPrimary={() => openCreateTx('expense')}
        onError={setError}
      />

      {loadingEmpty ? (
        <div className="skeleton-wrap"><Skeleton><Skeleton.Paragraph rows={3} /></Skeleton></div>
      ) : showError ? (
        <ErrorState compact message="交易加载失败，请重试" onRetry={() => { setError(false); financeStore.fetchTransactions() }} />
      ) : filteredTransactions.length > 0 ? (
        <Table columns={txColumns as any} dataSource={filteredTransactions} pagination={false} loading={financeStore.txLoading} rowKey="id" size="middle" className="tx-table" />
      ) : (
        <EmptyHint icon="Inbox" title="还没有交易" desc="点击「记一笔」开始" />
      )}

      {/* Summary Cards */}
      <div className="finance-summary" style={{ display: 'flex', gap: 16, marginTop: 16 }}>
        <div style={{ flex: 1 }}><IncomeSummaryCard income={totalIncome} change={0} /></div>
        <div style={{ flex: 1 }}><AssetSummaryCard totalBalance={financeStore.totalBalance} accounts={financeStore.accounts.length} /></div>
      </div>

      <TransactionEditDrawer visible={txDrawerVisible} accounts={financeStore.accounts} defaultType={drawerType} saving={txSaving} onClose={() => setTxDrawerVisible(false)} onSubmit={onTxSubmit} />
    </div>
  )
}

export default TransactionsTab
