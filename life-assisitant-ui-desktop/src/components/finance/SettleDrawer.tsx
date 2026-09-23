/**
 * SettleDrawer — 核销小表单（桌面端，SideSheet —— 项目浮层选型：表单编辑用 SideSheet）
 *
 * Phase 4（05 §B4.2 / §C2 / §D2）：四个动作共用一个组件——
 *   记报销到账（reimburse 原笔）/ 记收回（lend 原笔）/ 记还回（borrow 原笔）/ 记退款（原支出）。
 *
 * 提交 = createTransaction({ type, amount, account_id, happened_at, note,
 *                            source, contact, settle_of, exclude_* })：
 *   - type 按资金流（报销到账/收回/退款=income；还回=expense）
 *   - contact 从原笔带上（后端强制继承，前端同样显式带，双保险）
 *   - settle_of = 原笔 id
 *   - 四类记录都不进收支统计、不占预算（05 §B2.3 表）→ exclude_budget/exclude_stats = true
 *   - 退款继承原支出分类（Q10：type=income + source=refund + category 继承）
 *
 * 金额默认 = 未结清额，可改（Q13 部分核销/部分报销）。成功后由 store 的
 * createTransaction → fetchDebts 联动刷新债权债务与列表。
 *
 * 260922 Phase 2（02 §7.4）：金额从 InputNumber 换成**表达式文本框 + 失焦采纳**，
 * 与记账 TransactionEditDrawer 同语义（空→不动 / 无效→保留原文 / 有效→统一 2 位小数写回），
 * 消除「记账能算、核销不能算」的不一致。⚠️ 预算 / 账户余额 / 健康等 InputNumber
 * **刻意不跟**（02 §7.4 Non-goals：步进器与范围校验不能被表达式吃掉）。
 */
import { useState, useEffect, useMemo } from 'react'
import { SideSheet, Button, Input, TextArea, Select, DatePicker, Toast, Typography } from '@douyinfe/semi-ui'
import { Icon } from '@/components/icon'
import { useFinanceStore } from '@/stores/finance'
import { evalAmountExpr, centsToFixed2 } from '@/utils/calc'
import type { Transaction } from '@/api/types'

const { Title } = Typography

export type SettleAction = 'reimburse' | 'lend' | 'borrow' | 'refund'

const ACTION_META: Record<SettleAction, { title: string; txType: 'income' | 'expense'; source: string }> = {
  reimburse: { title: '记报销到账', txType: 'income', source: 'reimburse' },
  lend: { title: '记收回', txType: 'income', source: 'lend' },
  borrow: { title: '记还回', txType: 'expense', source: 'borrow' },
  refund: { title: '记退款', txType: 'income', source: 'refund' },
}

function toLocalMin(iso?: string | Date): string {
  const d = iso ? new Date(iso) : new Date()
  if (isNaN(d.getTime())) return toLocalMin()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

interface Props {
  visible: boolean
  action: SettleAction | null
  /** 原笔（settle_of 指向它） */
  transaction: Transaction | null
  /** 未结清额（金额默认值） */
  openAmount: number
  onClose: () => void
  /** 提交成功后（父级刷新详情进度） */
  onSettled?: () => void
}

export default function SettleDrawer({ visible, action, transaction, openAmount, onClose, onSettled }: Props) {
  const financeStore = useFinanceStore()
  // 金额表达式原文（与记账抽屉 amountText 同构：文本为输入源，提交取 evalAmountExpr 结果）
  const [amountText, setAmountText] = useState('')
  const [accountId, setAccountId] = useState('')
  const [happenedAt, setHappenedAt] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [amountError, setAmountError] = useState('')
  const [accountError, setAccountError] = useState('')

  const meta = action ? ACTION_META[action] : null

  useEffect(() => {
    if (!visible || !action) return
    // 默认 = 未结清，可改（Q13）；统一 2 位小数写回形式（失焦幂等：默认值再失焦不变）
    setAmountText(centsToFixed2(Math.max(0, Math.round(openAmount * 100))))
    setAccountId(financeStore.accounts[0]?.id ?? '')
    setHappenedAt(toLocalMin())
    setNote('')
    setAmountError('')
    setAccountError('')
  }, [visible, action, openAmount])

  const accountOptions = useMemo(
    () => financeStore.accounts.map((a) => ({ value: a.id, label: `${a.name}（¥${a.balance.toFixed(2)}）` })),
    [financeStore.accounts]
  )

  // ===== 失焦采纳（02 §7.3 三规则，与记账 TransactionEditDrawer 全同；不弹任何「已计算」提示）=====
  const onAmountChange = (v: string) => {
    setAmountText(v)
    // 错误清除判定与记账同构：有效且非 0 才清（无效半成品由提交兜底再拦）
    const r = evalAmountExpr(v)
    if (r.valid && r.cents > 0) setAmountError('')
  }

  const onAmountBlur = () => {
    const raw = amountText.trim()
    if (!raw) return // ① 空框 → 不动
    const r = evalAmountExpr(raw)
    if (!r.valid) return // ② 无效表达式 → 保留原文（半成品不写坏）
    setAmountText(centsToFixed2(r.cents)) // ③ 有效 → 写回 2 位小数（幂等；payload 金额在提交时再 evalAmountExpr 兜底）
  }

  async function handleSubmit() {
    if (!meta || !transaction) return
    let valid = true
    // 金额 = 表达式文本：提交兜底再求值（与记账抽屉同语义，02 §8「提交兜底」行；无效不采纳、保留原文）
    const raw = amountText.trim()
    const r = evalAmountExpr(raw)
    if (!raw || !r.valid || r.cents <= 0) {
      setAmountError('请输入有效金额')
      valid = false
    }
    if (!accountId) {
      setAccountError('请选择账户')
      valid = false
    }
    if (!valid) return

    setSaving(true)
    try {
      const created = await financeStore.createTransaction({
        type: meta.txType,
        amount: r.cents / 100,
        account_id: accountId,
        // 退款继承原支出分类（05 §D3；可读性 + 为按分类冲减留前提）
        category_id: action === 'refund' ? (transaction.category_id ?? undefined) : undefined,
        category_name: action === 'refund' ? (transaction.category_name || undefined) : undefined,
        category_emoji: action === 'refund' ? (transaction.category_emoji || undefined) : undefined,
        note: note.trim() || undefined,
        happened_at: new Date(happenedAt.replace(' ', 'T')).toISOString(),
        // 四类核销记录一律：不占预算、不进收支（05 §B2.3）
        exclude_budget: true,
        exclude_stats: true,
        source: meta.source,
        // contact 从原笔带上（后端强制继承，前端显式传双保险）
        contact: transaction.contact ?? undefined,
        settle_of: transaction.id,
      })
      if (created) {
        onSettled?.()
        onClose()
      } else {
        Toast.error(`${meta.title}失败`)
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <SideSheet
      visible={visible && !!action}
      onCancel={onClose}
      placement="right"
      width={420}
      maskClosable={!saving}
      closable={false}
      title={null}
      className="tx-drawer settle-drawer"
    >
      <div className="drawer-header">
        <Title heading={5} style={{ margin: 0 }}>{meta?.title ?? '核销'}</Title>
        <Button theme="borderless" type="tertiary" disabled={saving} onClick={onClose} aria-label="关闭">
          <Icon name="X" size={16} />
        </Button>
      </div>
      <div className="drawer-body">
        {transaction?.contact && (
          <div className="field">
            <label className="field-label">对方</label>
            <div style={{ color: 'var(--color-text-primary)' }}>{transaction.contact}</div>
          </div>
        )}
        <div className="field">
          <label className="field-label">金额 <span className="required">*</span></label>
          <Input
            type="text"
            value={amountText}
            onChange={onAmountChange}
            onBlur={onAmountBlur}
            placeholder="0.00"
            style={{ width: '100%' }}
            // 表达式输入 + 失焦采纳（02 §7.4：与记账同语义；此处金额天然需要算 —— 分账/部分报销）
          />
          {amountError && <div className="field-error">{amountError}</div>}
          <div className="field-tip">默认未结清额，可改（部分核销）；支持 + − × ÷（例：15/3 → 5.00）</div>
        </div>
        <div className="field">
          <label className="field-label">账户 <span className="required">*</span></label>
          <Select
            value={accountId}
            onChange={(v: any) => setAccountId(String(v ?? ''))}
            optionList={accountOptions}
            placeholder="选择账户"
            style={{ width: '100%' }}
          />
          {accountError && <div className="field-error">{accountError}</div>}
        </div>
        <div className="field">
          <label className="field-label">日期</label>
          <DatePicker
            type="dateTime"
            format="yyyy-MM-dd HH:mm"
            value={happenedAt ? new Date(happenedAt.replace(' ', 'T')) : undefined}
            onChange={(v: any) => {
              const d = Array.isArray(v) ? v[0] : v
              if (d) setHappenedAt(toLocalMin(new Date(d)))
            }}
            style={{ width: '100%' }}
          />
        </div>
        <div className="field">
          <label className="field-label">备注</label>
          <TextArea
            value={note}
            onChange={(v: string) => setNote(v)}
            placeholder="补充一下细节（可选）"
            rows={2}
            maxLength={200}
            showClear
          />
        </div>
      </div>
      <div className="drawer-footer">
        <Button theme="light" type="secondary" disabled={saving} onClick={onClose}>取消</Button>
        <Button theme="solid" type="primary" loading={saving} onClick={handleSubmit}>保存</Button>
      </div>
    </SideSheet>
  )
}
