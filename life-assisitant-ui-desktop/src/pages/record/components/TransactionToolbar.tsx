/**
 * TransactionToolbar — 支出/收入共用的交易工具栏（R11 提取，勿复制粘贴）。
 *
 * 承担：类型筛选、账户筛选（服务端）、备注/分类关键字搜索（服务端）、刷新、分页加载。
 * - 搜索真正写入 store 的 txQuery.keyword（P0-07/R8：此前 txSearch 只存本地，从未生效）。
 * - 防抖定时器用 useRef 持有（R9：此前 let 声明在函数体内，每次 render 被重置为 null）。
 * - 错误探测（E02）：store 的 fetchTransactions 静默吞错并置空列表，无法区分「失败」与「空」，
 *   故额外发一次真实请求作探针，失败经 onError 上报，由 Tab 渲染 ErrorState。
 *
 * Phase 3.3（09-schedule）：类型筛选改**服务端过滤**——写入 txQuery.type 并重拉
 * （切段重置第 1 页由 setTxQuery 保证）。「全部」= 不传 type（含转账）。
 * 当前财务 Tab 只剩一个收支视图，写共享 store 的 txQuery.type 不再有两 Tab 互污染问题。
 */
import { useMemo, useRef } from 'react'
import { Button, Input, Select } from '@douyinfe/semi-ui'
import { Icon } from '@/components/icon'
import { useFinanceStore } from '@/stores/finance'
import { financeApi } from '@/api/finance'
import type { TransactionType } from '@/api/types'

const txTypeOptions = [
  { value: undefined as TransactionType | undefined, label: '全部类型' },
  { value: 'expense' as TransactionType, label: '支出' },
  { value: 'income' as TransactionType, label: '收入' },
  { value: 'transfer' as TransactionType, label: '转账' },
]

interface Props {
  /** 是否显示类型筛选（收支 Tab 显示） */
  showTypeFilter?: boolean
  /** 当前类型筛选值（Phase 3.3 起由父级写入 txQuery.type 做服务端过滤） */
  typeFilter?: TransactionType | undefined
  /** 类型筛选变更 */
  onTypeFilterChange?: (t: TransactionType | undefined) => void
  /** 搜索框占位文案 */
  searchPlaceholder?: string
  /** 主按钮文案 */
  primaryLabel: string
  /** 主按钮 type（Semi） */
  primaryType?: 'primary' | 'secondary'
  /** 主按钮 theme（Semi） */
  primaryTheme?: 'solid' | 'light'
  /** 主按钮点击 */
  onPrimary: () => void
  /** 加载失败上报（供 Tab 区分「失败」与「空」） */
  onError?: (hasError: boolean) => void
}

export function TransactionToolbar({
  showTypeFilter = false,
  typeFilter,
  onTypeFilterChange,
  searchPlaceholder = '搜索备注 / 分类…',
  primaryLabel,
  primaryType = 'primary',
  primaryTheme = 'solid',
  onPrimary,
  onError,
}: Props) {
  const financeStore = useFinanceStore()
  const searchTimer = useRef<number | null>(null)

  const accountOptions = useMemo(() => [
    { value: undefined as string | undefined, label: '全部账户' },
    ...financeStore.accounts.map((a) => ({ value: a.id as string | undefined, label: a.name })),
  ], [financeStore.accounts])

  /** 探针：真实请求成功/失败 → 上报错误态（store 吞错，无法据此判断） */
  function probeError() {
    if (!onError) return
    const q = useFinanceStore.getState().txQuery
    financeApi
      .listTransactions({
        type: q.type,
        account_id: q.account_id,
        keyword: q.keyword,
        contact: q.contact,
        start_date: q.start_date,
        end_date: q.end_date,
        page: q.page,
        page_size: q.page_size,
      })
      .then(() => onError(false))
      .catch(() => onError(true))
  }

  /** 统一重拉 + 探错 */
  function refetch() {
    financeStore.fetchTransactions()
    probeError()
  }

  function onSearchInput(v: string) {
    // 立即写入 keyword（受控输入 + hasTxFilter 推导），只对「重新拉取」做防抖
    financeStore.setTxQuery({ keyword: v.trim() ? v : undefined })
    if (searchTimer.current) window.clearTimeout(searchTimer.current)
    searchTimer.current = window.setTimeout(() => {
      financeStore.fetchTransactions()
      probeError()
    }, 350)
  }

  function onSearchClear() {
    financeStore.setTxQuery({ keyword: undefined })
    refetch()
  }

  function onAccountChange(v: unknown) {
    const val = Array.isArray(v) ? v[0] : (v as string | undefined)
    financeStore.setTxQuery({ account_id: val })
    refetch()
  }

  return (
    <div className="toolbar">
      <div className="toolbar-left">
        {showTypeFilter && (
          <Select
            value={typeFilter as any}
            optionList={txTypeOptions as any}
            onChange={(v: unknown) => {
              const val = Array.isArray(v) ? v[0] : (v as TransactionType | undefined)
              onTypeFilterChange?.(val)
            }}
            style={{ width: 130 }}
          />
        )}
        <Select
          value={financeStore.txQuery.account_id as any}
          optionList={accountOptions as any}
          onChange={onAccountChange}
          style={{ width: 180 }}
        />
        <Input
          value={financeStore.txQuery.keyword ?? ''}
          onChange={onSearchInput}
          placeholder={searchPlaceholder}
          style={{ width: 220 }}
          showClear
          onClear={onSearchClear}
        />
      </div>
      <div className="toolbar-right">
        <Button
          theme={primaryTheme}
          type={primaryType}
          size="small"
          icon={<Icon name="PlusCircle" size={16} />}
          onClick={onPrimary}
        >
          {primaryLabel}
        </Button>
        <Button
          theme="borderless"
          type="tertiary"
          icon={<Icon name="RefreshCw" size={16} />}
          onClick={refetch}
          loading={financeStore.txLoading}
        >
          刷新
        </Button>
        {financeStore.txHasMore && (
          <Button
            theme="light"
            type="secondary"
            size="small"
            onClick={() => financeStore.loadMore()}
            loading={financeStore.txLoading}
          >
            加载更多
          </Button>
        )}
      </div>
    </div>
  )
}

export default TransactionToolbar
