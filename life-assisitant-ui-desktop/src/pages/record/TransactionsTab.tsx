/**
 * TransactionsTab — 收支 Tab（D-03 第十六轮由「支出」正名）
 *
 * 收支交易统一入口：支出/收入/转账混合列表 + 类型筛选 + 收入/总资产汇总卡。
 * 原「支出」「收入」两个 Tab 本就渲染同一份混合列表（IncomeTab 是其纯子集），
 * 第十六轮删除重复的收入 Tab，合并为单一「收支」。记收入经「记一笔」抽屉内
 * 的类型切换完成（TransactionEditDrawer 自带 expense/income/transfer 三态）。
 *
 * R8/R9：搜索经防抖写入 txQuery.keyword 并重新拉取（见 TransactionToolbar）。
 * R10：类别 emoji 直出改为 <Icon>，走 findCategoryByEmoji（category-dict）反查 icon+tint，
 *      查不到则降级 HelpCircle + neutral（B12 兜底）。
 *
 * Phase 3.3（09-schedule）：类型筛选改**服务端过滤**（txQuery.type 透传 + 切类型重置
 * 第 1 页重拉）；「全部类型」= 不传 type（**含转账**）；删除原先「排除转账 +
 * 客户端过滤」的 useMemo。列表无「支出/收入合计」汇总行，无需另行排除转账。
 * Phase 4：类型列下加来源中性标签（待报销/借出/借入/退款/余额调整）；
 * 债权债务卡跳转带 contact 筛选 → 本组件渲染可移除的「对方」chip。
 *
 * spec-20260922-v2 · 01 §2.7（本文件）：底部两张汇总卡（本月收入/总资产）**下线**，
 * 换成顶部 `<SummaryCards>`（两卡四面 + 周期切换，四数全走 /finance/summary）；
 * 本地 `totalIncome` useMemo（只算已加载记录 = S2 失真源）随之删除。
 * ⚠️ 与移动端的差异是**刻意**的（Q10 方案 B）：桌面账户下拉**保留**——
 *   三个控件横排 530px 不挤，且下拉是「主动浏览」，chip 给不了。
 */
import { useEffect, useMemo, useState } from 'react'
import { Button, Table, Skeleton, Tooltip, Modal } from '@douyinfe/semi-ui'
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table'
import { Icon } from '@/components/icon'
import { useFinanceStore } from '@/stores/finance'
import { financeApi } from '@/api/finance'
import TransactionEditDrawer from '@/components/TransactionEditDrawer'
import TransactionDetailDrawer from '@/components/TransactionDetailDrawer'
import ErrorState from '@/components/ErrorState'
import { EmptyHint } from '@/components/EmptyState'
import SummaryCards from '@/components/finance/SummaryCards'
import { TransactionToolbar } from './components/TransactionToolbar'
import { CategoryIconCell } from './components/CategoryIconCell'
import { ReverseButton } from './components/ReverseButton'
import { sourceLabel } from '@/utils/money'
import type { Transaction, TransactionType, CreateTransactionReq, UpdateTransactionReq } from '@/api/types'

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

export function TransactionsTab({ onGotoBudget }: { onGotoBudget?: () => void } = {}) {
  const financeStore = useFinanceStore()
  const [txSaving, setTxSaving] = useState(false)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [editState, setEditState] = useState<{
    visible: boolean
    mode: 'create' | 'edit'
    transaction: Transaction | null
    defaultType: TransactionType
    defaultDate?: string
  }>({ visible: false, mode: 'create', transaction: null, defaultType: 'expense', defaultDate: undefined })
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

  // Phase 3.3：列表直接用服务端返回（筛选已下推 txQuery；不再排除转账）
  const filteredTransactions = financeStore.transactions
  const typeFilter = financeStore.txQuery.type

  /** 类型筛选切换：写入 txQuery.type（setTxQuery 自动重置第 1 页）并重拉 */
  function onTypeFilterChange(t: TransactionType | undefined) {
    financeStore.setTxQuery({ type: t })
    financeStore.fetchTransactions()
  }

  /** 清除「对方」筛选（债权债务卡跳转留下的 contact） */
  function onClearContact() {
    financeStore.setTxQuery({ contact: undefined })
    financeStore.fetchTransactions()
  }

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
      render: (v: TransactionType, r: Transaction) => {
        const m = TX_TYPE_META[v]
        const src = sourceLabel(r.source)
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ background: m.bg, color: m.fg, padding: '2px 8px', borderRadius: 4, fontSize: 12, alignSelf: 'flex-start' }}>{m.label}</span>
            {/* Phase 4：来源中性色小标（source 空值 JSON 不出现 → 真值判断，B18） */}
            {src && (
              <span style={{ color: 'var(--color-text-tertiary)', fontSize: 11, alignSelf: 'flex-start' }}>{src}</span>
            )}
          </div>
        )
      },
    },
    {
      title: '类别',
      dataIndex: 'category_name',
      width: 140,
      render: (_v: any, r: Transaction, _i: number) => (
        <CategoryIconCell categoryId={r.category_id} categoryName={r.category_name} categoryEmoji={r.category_emoji} />
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
    // ⚠️ 依赖必须是 []：useFinanceStore() 无 selector 返回整个 state 对象，每次 set
    // 都换引用；依赖它会让 columns 频繁重建，Semi Table getDerivedStateFromProps
    // 检测到新 columns 引用就重算 queries → componentDidUpdate 再 setState，
    // 是 Maximum update depth 的经典诱因。columns 闭包里用到的 store actions
    // （removeTransaction / fetchTransactions）是 zustand 定义期固定引用，捕获首次即可。
  ], [])

  function openCreateTx(type: TransactionType = 'expense') {
    setEditState({ visible: true, mode: 'create', transaction: null, defaultType: type, defaultDate: undefined })
  }

  // 详情抽屉「编辑」→ 打开 edit 模式并回填；同时关闭详情（编辑保存后由 onTxEdit 重新打开详情刷新）
  function onDetailEdit(tx: Transaction) {
    setEditState({ visible: true, mode: 'edit', transaction: tx, defaultType: tx.type, defaultDate: undefined })
    setDetailId(null)
  }

  async function onTxCreate(data: CreateTransactionReq) {
    setTxSaving(true)
    try {
      const created = await financeStore.createTransaction(data)
      if (created) setEditState((s) => ({ ...s, visible: false }))
    } finally {
      setTxSaving(false)
    }
  }

  async function onTxEdit(id: string, data: UpdateTransactionReq) {
    setTxSaving(true)
    try {
      const updated = await financeStore.updateTransaction(id, data)
      if (updated) {
        setEditState((s) => ({ ...s, visible: false }))
        setDetailId(id) // 留在详情页并刷新（详情抽屉会按 id 重新拉取）
      }
    } finally {
      setTxSaving(false)
    }
  }

  const loadingEmpty = financeStore.txLoading && filteredTransactions.length === 0
  const showError = error && !financeStore.txLoading && filteredTransactions.length === 0

  return (
    <div className="transactions-tab">
      {/* 顶部数据块（01 §2.7）：两卡四面 + 周期切换，替代原底部两张汇总卡 */}
      <SummaryCards onGotoBudget={onGotoBudget} />

      <TransactionToolbar
        showTypeFilter
        typeFilter={typeFilter}
        onTypeFilterChange={onTypeFilterChange}
        primaryLabel="记一笔"
        primaryType="primary"
        primaryTheme="solid"
        onPrimary={() => openCreateTx('expense')}
        onError={setError}
      />

      {/* 对方筛选 chip（债权债务卡点行跳转留下；可移除防「看不见的过滤」残留） */}
      {financeStore.txQuery.contact && (
        <div className="tx-contact-filter">
          <span>对方：{financeStore.txQuery.contact}</span>
          <Button
            theme="borderless"
            type="tertiary"
            size="small"
            icon={<Icon name="X" size={14} />}
            onClick={onClearContact}
            aria-label="清除对方筛选"
          />
        </div>
      )}

      {loadingEmpty ? (
        <div className="skeleton-wrap"><Skeleton><Skeleton.Paragraph rows={3} /></Skeleton></div>
      ) : showError ? (
        <ErrorState compact message="交易加载失败，请重试" onRetry={() => { setError(false); financeStore.fetchTransactions() }} />
      ) : filteredTransactions.length > 0 ? (
        <Table
          columns={txColumns as any}
          dataSource={filteredTransactions}
          pagination={false}
          loading={financeStore.txLoading}
          rowKey="id"
          size="middle"
          className="tx-table"
          // Semi 的 OnRow 回调参数类型是 `Transaction | undefined`（虚拟滚动/占位行），
          // 故此处收窄后再返回行属性；undefined 时返回空对象（行为与之前一致）
          onRow={(record) =>
            record
              ? {
                  style: { cursor: 'pointer' as const },
                  onClick: (e: React.MouseEvent) => {
                    // 点操作列（撤销/删除）不触发详情，避免误开
                    const t = e.target as HTMLElement
                    if (t.closest('.col-actions')) return
                    setDetailId(record.id)
                  },
                }
              : {}
          }
        />
      ) : (
        <EmptyHint icon="Inbox" title="还没有交易" desc="点击「记一笔」开始" />
      )}

      <TransactionDetailDrawer
        visible={detailId !== null}
        txId={detailId}
        onClose={() => setDetailId(null)}
        onEdit={onDetailEdit}
      />

      <TransactionEditDrawer
        visible={editState.visible}
        mode={editState.mode}
        transaction={editState.transaction}
        defaultType={editState.defaultType}
        defaultDate={editState.defaultDate}
        accounts={financeStore.accounts}
        saving={txSaving}
        onClose={() => setEditState((s) => ({ ...s, visible: false }))}
        onSubmit={onTxCreate}
        onEditSubmit={onTxEdit}
      />
    </div>
  )
}

export default TransactionsTab
