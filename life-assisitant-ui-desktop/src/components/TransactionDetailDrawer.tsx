/**
 * TransactionDetailDrawer — 账目详情抽屉（桌面端，SideSheet）
 *
 * SYNC（字段与移动端 tx-detail 同一套，04 §2.3）：金额 / 类型 / 分类 / 账户 /
 * 时间 / 备注 / 口径 / 来源 / 创建更新时间 / reversed_by 横幅。
 *
 * 形态：用抽屉不用路由页（不丢列表滚动位置与筛选状态）。
 * 数据：GET /transactions/:id 独立拉取（不复用列表 store）。
 *
 * 操作：编辑 / 撤销 / 删除（与表格操作列、与移动端同一套确认文案）。
 *   · 转账：不可编辑（Q6 编辑走不通，09-schedule §B3）→ 隐藏「编辑」
 *   · 转账 / 已撤销：隐藏「撤销」
 *
 * Phase 4（05 文档）：
 *  - 「对方」行（contact 非空才显示；空值 JSON 字段不出现 → 真值判断，§B18）
 *  - 核销进度：「已报销/已收回/已还回/已退款 N / M」（部分核销显示，Q13）
 *  - 核销按钮（按 source + 未结清显示；反向笔（settle_of 非空）只显示进度）：
 *      待报销 → 记报销到账 / 借出 → 记收回 / 借入 → 记还回 / 普通支出 → 记退款
 *  - ⚠️ 核销进度口径（报告 §B 备案）：后端无「按 settle_of 查询」参数（D51 只聚合了
 *    /finance/debts 按对方维度），前端以 start_date=原笔日期 向后翻页拉取流水、
 *    客户端过滤 settle_of === 原笔 id 求和（上限 10 页 ×100 条；核销笔 contact 继承，
 *    理论上都晚于原笔）。若后续后端补 settle_of 查询参数应替换此实现。
 */
import { useState, useEffect, useCallback } from 'react'
import { SideSheet, Button, Modal, Toast, Typography, Skeleton } from '@douyinfe/semi-ui'
import { Icon } from '@/components/icon'
import { financeApi } from '@/api/finance'
import { useFinanceStore } from '@/stores/finance'
import { CategoryIconCell } from '@/pages/record/components/CategoryIconCell'
import SettleDrawer, { type SettleAction } from '@/components/finance/SettleDrawer'
import type { Transaction } from '@/api/types'
import { formatSignedAmount, amountColorVar, sourceLabel } from '@/utils/money'

const { Title } = Typography

const TYPE_LABEL: Record<Transaction['type'], string> = {
  expense: '支出',
  income: '收入',
  transfer: '转账',
}

/** source → 核销动作（原笔才有；null = 无动作） */
function settleActionOf(tx: Transaction): SettleAction | null {
  if (tx.settle_of) return null // 反向笔（核销记录本身）不发起核销
  if (tx.source === 'reimburse') return 'reimburse'
  if (tx.source === 'lend') return 'lend'
  if (tx.source === 'borrow') return 'borrow'
  // 普通支出（source 空值 JSON 不出现，§B18）→ 可记退款；余额调整不可退
  if (tx.type === 'expense' && !tx.source) return 'refund'
  return null
}

/** source → 核销进度标签 */
function settledLabelOf(tx: Transaction): string | null {
  if (tx.source === 'reimburse') return '已报销'
  if (tx.source === 'lend') return '已收回'
  if (tx.source === 'borrow') return '已还回'
  if (tx.type === 'expense' && !tx.source) return '已退款'
  return null
}

function formatDateTime(iso?: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * 求原笔的已核销额（Σ settle_of === txId 的 amount，未删除由后端 GetByID/列表天然过滤）。
 * start_date = 原笔发生日（核销必不早于原笔）；翻页至 has_more=false，上限 10 页×100。
 */
async function fetchSettledAmount(txId: string, sinceISO: string): Promise<number> {
  const start = new Date(sinceISO)
  if (isNaN(start.getTime())) return 0
  const pad = (n: number) => String(n).padStart(2, '0')
  const startDate = `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`
  let sum = 0
  let page = 1
  while (page <= 10) {
    const res = await financeApi.listTransactions({
      start_date: startDate,
      page,
      page_size: 100,
    })
    for (const t of res.items || []) {
      if (t.settle_of === txId) sum += t.amount
    }
    if (!res.has_more) break
    page++
  }
  return sum
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="tx-detail-row">
      <span className="tx-detail-label">{label}</span>
      <span className="tx-detail-value">{children}</span>
    </div>
  )
}

interface Props {
  visible: boolean
  /** 当前查看的交易 id（null = 关闭） */
  txId: string | null
  onClose: () => void
  /** 点击「编辑」→ 打开编辑抽屉并回填 */
  onEdit: (tx: Transaction) => void
  /** 删除成功后（返回列表并刷新） */
  onDeleted?: () => void
}

export default function TransactionDetailDrawer({
  visible,
  txId,
  onClose,
  onEdit,
  onDeleted,
}: Props) {
  const financeStore = useFinanceStore()
  const [loading, setLoading] = useState(false)
  const [notFound, setNotFound] = useState(false)
  const [tx, setTx] = useState<Transaction | null>(null)
  // 已核销额（null = 未计算 / 不适用；核销进度与按钮都依赖它）
  const [settled, setSettled] = useState<number | null>(null)
  const [settleAction, setSettleAction] = useState<SettleAction | null>(null)

  useEffect(() => {
    if (!visible || !txId) return
    let alive = true
    setLoading(true)
    setNotFound(false)
    setTx(null)
    setSettled(null)
    financeApi
      .getTransaction(txId)
      .then((t) => {
        if (!alive) return
        setTx(t)
        setLoading(false)
      })
      .catch(() => {
        if (!alive) return
        setNotFound(true)
        setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [visible, txId])

  // 核销进度（可发起核销的笔才计算）
  useEffect(() => {
    if (!tx || tx.settle_of) return
    const applicable =
      tx.source === 'reimburse' || tx.source === 'lend' || tx.source === 'borrow' ||
      (tx.type === 'expense' && !tx.source)
    if (!applicable) return
    let alive = true
    fetchSettledAmount(tx.id, tx.happened_at)
      .then((sum) => {
        if (alive) setSettled(sum)
      })
      .catch(() => {
        if (alive) setSettled(0) // 计算失败按 0 处理（仍显示按钮，可重进重算）
      })
    return () => {
      alive = false
    }
  }, [tx])

  const isTransfer = tx?.type === 'transfer'
  const isReversed = !!tx?.reversed_by

  // 核销按钮：原笔 + 未结清时显示（未结清 = amount − settled，≤0.005 视为已结清，05 §2.2）
  const action = tx && !isReversed ? settleActionOf(tx) : null
  const openAmount =
    tx && settled !== null ? Math.max(0, tx.amount - settled) : (tx?.amount ?? 0)
  const isFullySettled = tx ? tx.amount - (settled ?? 0) <= 0.005 : false
  const settledLabel = tx ? settledLabelOf(tx) : null
  const showSettleProgress = !!settledLabel && (settled ?? 0) > 0
  const showSettleBtn = !!action && !isFullySettled

  const refreshDetail = useCallback(() => {
    if (!txId) return
    financeApi.getTransaction(txId).then((t) => setTx(t)).catch(() => {})
  }, [txId])

  const handleReverse = useCallback(() => {
    if (!tx) return
    Modal.confirm({
      title: '撤销交易',
      content: '将生成一笔反向交易，原账户余额回滚。确认撤销？',
      okText: '确认撤销',
      okButtonProps: { type: 'danger', theme: 'solid' },
      cancelText: '取消',
      onOk: async () => {
        const ok = await financeStore.reverseTransaction(tx.id, undefined)
        if (ok) {
          // 留在详情：重新拉取，显示「该笔已被撤销」横幅 + 隐藏撤销
          refreshDetail()
        }
      },
    })
  }, [tx, financeStore, refreshDetail])

  const handleDelete = useCallback(() => {
    if (!tx) return
    Modal.confirm({
      title: '删除交易',
      content: `确认删除「${tx.category_name} ¥${tx.amount.toFixed(2)}」？`,
      okText: '删除',
      okButtonProps: { type: 'danger', theme: 'solid' },
      cancelText: '取消',
      onOk: async () => {
        const ok = await financeStore.removeTransaction(tx.id)
        if (ok) {
          Toast.success('交易已删除')
          onClose()
          onDeleted?.()
        }
      },
    })
  }, [tx, financeStore, onClose, onDeleted])

  // 口径行文案
  const scopeTags: string[] = []
  if (tx?.exclude_budget) scopeTags.push('不计入预算')
  if (tx?.exclude_stats) scopeTags.push('不计入收支')

  return (
    <SideSheet
      visible={visible}
      onCancel={onClose}
      placement="right"
      width={480}
      maskClosable
      closable={false}
      title={null}
      className="tx-drawer tx-detail-drawer"
    >
      <div className="drawer-header">
        <Title heading={5} style={{ margin: 0 }}>账目详情</Title>
        <Button theme="borderless" type="tertiary" onClick={onClose} aria-label="关闭">
          <Icon name="X" size={16} />
        </Button>
      </div>

      <div className="drawer-body">
        {loading && (
          <Skeleton placeholder={<Skeleton.Paragraph rows={6} />} loading={loading} active>
            <div />
          </Skeleton>
        )}

        {!loading && notFound && (
          <div className="tx-detail-empty">
            <Icon name="Inbox" size={32} />
            <div className="tx-detail-empty-text">该记录已不存在</div>
            <Button theme="light" type="secondary" onClick={onClose}>返回</Button>
          </div>
        )}

        {!loading && !notFound && tx && (
          <>
            {isReversed && (
              <div className="tx-detail-banner">该笔已被撤销</div>
            )}

            {/* 金额（大字，收入绿 / 支出红 / 转账中性） */}
            <div
              className="tx-detail-amount"
              style={{ color: amountColorVar(tx.type) }}
            >
              {formatSignedAmount(tx.amount, tx.type)}
            </div>
            <div className="tx-detail-type" style={{ color: 'var(--color-text-secondary)' }}>
              {TYPE_LABEL[tx.type]}
            </div>

            <div className="tx-detail-divider" />

            {/* 分类（转账不显示此行） */}
            {!isTransfer && (
              <DetailRow label="分类">
                <CategoryIconCell
                  categoryId={tx.category_id}
                  categoryName={tx.category_name}
                  categoryEmoji={tx.category_emoji}
                />
              </DetailRow>
            )}

            {/* 账户（转账：A → B） */}
            <DetailRow label="账户">
              {isTransfer
                ? `${tx.account_name || tx.account_id} → ${tx.to_account_name || tx.to_account_id || ''}`
                : (tx.account_name || tx.account_id)}
            </DetailRow>

            {/* 对方（contact 非空才显示，Phase 4） */}
            {tx.contact && <DetailRow label="对方">{tx.contact}</DetailRow>}

            {/* 时间 */}
            <DetailRow label="时间">{formatDateTime(tx.happened_at)}</DetailRow>

            {/* 备注（空则不显示） */}
            {tx.note ? <DetailRow label="备注">{tx.note}</DetailRow> : null}

            {/* 口径（两个都关则不显示） */}
            {scopeTags.length > 0 && (
              <DetailRow label="口径">
                <span className="tx-detail-scope">{scopeTags.join(' · ')}</span>
              </DetailRow>
            )}

            {/* 来源（source 非空才显示） */}
            {tx.source && sourceLabel(tx.source) && (
              <DetailRow label="来源">
                <span className="tx-detail-source">{sourceLabel(tx.source)}</span>
              </DetailRow>
            )}

            {/* 核销进度（有核销记录时显示；部分核销 → 「已 X N / M」，05 §B4.3） */}
            {showSettleProgress && settled !== null && (
              <DetailRow label={settledLabel ?? ''}>
                <span className="tx-detail-progress">
                  {((settledLabel ?? '') + ` ¥ ${Math.min(settled, tx.amount).toFixed(2)} / ¥ ${tx.amount.toFixed(2)}`)}
                </span>
              </DetailRow>
            )}

            <div className="tx-detail-divider" />

            {/* 创建 / 更新时间 */}
            <DetailRow label="创建">{formatDateTime(tx.created_at)}</DetailRow>
            {tx.updated_at && tx.updated_at !== tx.created_at && (
              <DetailRow label="更新">{formatDateTime(tx.updated_at)}</DetailRow>
            )}
          </>
        )}
      </div>

      {/* 操作区：核销 / 编辑 / 撤销 / 删除（与表格、与移动端同一套确认文案） */}
      {!loading && !notFound && tx && (
        <div className="drawer-footer tx-detail-actions">
          {/* 核销：原笔 + 未结清（反向笔只显示进度不显示按钮） */}
          {showSettleBtn && action && (
            <Button
              theme="solid"
              type="primary"
              block
              onClick={() => setSettleAction(action)}
            >
              {action === 'reimburse' && '记报销到账'}
              {action === 'lend' && '记收回'}
              {action === 'borrow' && '记还回'}
              {action === 'refund' && '记退款'}
            </Button>
          )}
          {/* 转账编辑走不通（Q6）→ 隐藏编辑 */}
          {!isTransfer && (
            <Button
              theme="light"
              type="secondary"
              block
              onClick={() => onEdit(tx)}
            >
              编辑
            </Button>
          )}
          <div className="tx-detail-action-row">
            {/* 转账 / 已撤销 → 隐藏撤销 */}
            {!isTransfer && !isReversed && (
              <Button theme="borderless" type="tertiary" onClick={handleReverse}>
                撤销
              </Button>
            )}
            <Button theme="borderless" type="danger" onClick={handleDelete}>
              删除
            </Button>
          </div>
        </div>
      )}

      {/* 核销小表单（四动作共用一个 SideSheet） */}
      <SettleDrawer
        visible={!!settleAction && !isTransfer}
        action={settleAction}
        transaction={tx}
        openAmount={openAmount}
        onClose={() => setSettleAction(null)}
        onSettled={() => {
          // 重拉详情 + 重算进度（按钮按未结清自动消失/默认金额变化）
          refreshDetail()
          setSettled(null)
        }}
      />
    </SideSheet>
  )
}
