/**
 * Transaction create Drawer
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  SideSheet,
  Button,
  InputNumber,
  TextArea,
  Select,
  RadioGroup,
  Radio,
  DatePicker,
  Typography,
} from '@douyinfe/semi-ui'
import { Icon, TINT_VARS } from '@/components/icon'
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES } from '@/utils/category-dict'
import type { CategoryDef } from '@/utils/category-dict'
import type {
  Account,
  CreateTransactionReq,
  TransactionType,
} from '@/api/types'

const { Title } = Typography

const TYPE_OPTIONS: { value: TransactionType; label: string; color: string }[] = [
  { value: 'expense', label: '支出', color: '#EF4444' },
  { value: 'income', label: '收入', color: '#10B981' },
  { value: 'transfer', label: '转账', color: '#8B5CF6' },
]

interface Props {
  visible: boolean
  accounts: Account[]
  defaultType?: TransactionType
  saving?: boolean
  onClose: () => void
  onSubmit: (data: CreateTransactionReq) => void
}

export default function TransactionEditDrawer({ visible, accounts, defaultType = 'expense', saving = false, onClose, onSubmit }: Props) {
  const [form, setForm] = useState<CreateTransactionReq>({
    type: 'expense',
    amount: 0,
    category_emoji: EXPENSE_CATEGORIES[0].emoji,
    category_name: EXPENSE_CATEGORIES[0].label,
    account_id: '',
    to_account_id: '',
    note: '',
    happened_at: new Date().toISOString().slice(0, 10),
  })
  const [amountError, setAmountError] = useState('')
  const [accountError, setAccountError] = useState('')

  useEffect(() => {
    if (!visible) return
    setForm({
      type: defaultType ?? 'expense',
      amount: 0,
      category_emoji: EXPENSE_CATEGORIES[0].emoji,
      category_name: EXPENSE_CATEGORIES[0].label,
      account_id: accounts[0]?.id ?? '',
      to_account_id: accounts[1]?.id ?? '',
      note: '',
      happened_at: new Date().toISOString().slice(0, 10),
    })
    setAmountError('')
    setAccountError('')
  }, [visible, accounts, defaultType])

  // Reset category when type changes（transfer 类型不展示也不提交 category 字段，无需重置）
  useEffect(() => {
    if (form.type === 'expense') {
      setForm((f) => ({ ...f, category_emoji: EXPENSE_CATEGORIES[0].emoji, category_name: EXPENSE_CATEGORIES[0].label }))
    } else if (form.type === 'income') {
      setForm((f) => ({ ...f, category_emoji: INCOME_CATEGORIES[0].emoji, category_name: INCOME_CATEGORIES[0].label }))
    }
  }, [form.type])

  const categoryOptions = useMemo<readonly CategoryDef[]>(() => {
    if (form.type === 'expense') return EXPENSE_CATEGORIES
    if (form.type === 'income') return INCOME_CATEGORIES
    return EXPENSE_CATEGORIES
  }, [form.type])

  // B09：账户下拉不再拼运行时 emoji（a.icon），只展示账户名 + 余额
  const accountOptions = useMemo(() =>
    accounts.map((a) => ({
      value: a.id,
      label: `${a.name}（¥${a.balance.toFixed(2)}）`,
    })),
    [accounts]
  )

  const pickCategory = useCallback((c: CategoryDef) => {
    setForm((f) => ({ ...f, category_emoji: c.emoji, category_name: c.label }))
  }, [])

  const onAmount = useCallback((v: number | string | undefined) => {
    const n = typeof v === 'number' ? v : parseFloat(String(v ?? '0'))
    setForm((f) => ({ ...f, amount: Number.isFinite(n) && n >= 0 ? n : 0 }))
    if (Number.isFinite(v as number) && (v as number) > 0) setAmountError('')
  }, [])

  const handleSubmit = useCallback(() => {
    let valid = true
    if (!form.amount || form.amount <= 0) {
      setAmountError('请输入金额')
      valid = false
    }
    if (!form.account_id) {
      setAccountError('请选择账户')
      valid = false
    }
    if (form.type === 'transfer' && !form.to_account_id) {
      setAccountError('请选择目标账户')
      valid = false
    }
    if (form.type === 'transfer' && form.to_account_id === form.account_id) {
      setAccountError('目标账户不能与来源账户相同')
      valid = false
    }
    if (!valid) return
    if (form.type === 'transfer') {
      // Transfer uses the dedicated /transactions/transfer API
      onSubmit({
        type: 'transfer',
        amount: form.amount,
        account_id: form.account_id,
        to_account_id: form.to_account_id,
        note: form.note?.trim() || undefined,
        happened_at: form.happened_at
          ? new Date(form.happened_at).toISOString()
          : undefined,
      })
    } else {
      onSubmit({
        type: form.type,
        amount: form.amount,
        category_emoji: form.category_emoji,
        category_name: form.category_name,
        account_id: form.account_id,
        note: form.note?.trim() || undefined,
        happened_at: form.happened_at
          ? new Date(form.happened_at).toISOString()
          : undefined,
      })
    }
  }, [form, onSubmit])

  return (
    <SideSheet
      visible={visible}
      onCancel={onClose}
      placement="right"
      width={480}
      maskClosable={!saving}
      closable={false}
      title={null}
      className="tx-drawer"
    >
      <div className="drawer-header">
        <Title heading={5} style={{ margin: 0 }}>记一笔</Title>
        <Button theme="borderless" type="tertiary" disabled={saving} onClick={onClose} aria-label="关闭">
          <Icon name="X" size={16} />
        </Button>
      </div>
      <div className="drawer-body">
        {/* Type */}
        <div className="field">
          <label className="field-label">类型</label>
          <RadioGroup
            value={form.type}
            onChange={(e: any) => setForm((f) => ({ ...f, type: e.target.value }))}
            type="button"
          >
            {TYPE_OPTIONS.map((t) => (
              <Radio key={t.value} value={t.value}>
                <span style={{ color: t.color, fontWeight: 600 }}>{t.label}</span>
              </Radio>
            ))}
          </RadioGroup>
        </div>

        {/* Amount */}
        <div className="field">
          <label className="field-label">金额 <span className="required">*</span></label>
          <div className="amount-row">
            <span className="amount-symbol">¥</span>
            <InputNumber
              value={form.amount}
              onChange={onAmount}
              placeholder="0.00"
              min={0}
              step={0.01}
              precision={2}
              style={{ flex: 1 }}
            />
          </div>
          {amountError && <div className="field-error">{amountError}</div>}
        </div>

        {/* Category */}
        {form.type !== 'transfer' && (
          <div className="field">
            <label className="field-label">类别</label>
            <div className="cat-grid">
              {categoryOptions.map((c) => (
                <div
                  key={c.id}
                  className={`cat-chip${form.category_name === c.label ? ' active' : ''}`}
                  onClick={() => pickCategory(c)}
                >
                  <div className="cat-emoji" style={{ background: TINT_VARS[c.tint].bg, color: TINT_VARS[c.tint].fg }}>
                    <Icon name={c.icon} size={18} style={{ color: TINT_VARS[c.tint].fg }} />
                  </div>
                  <div className="cat-name">{c.label}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Source Account */}
        <div className="field">
          <label className="field-label">
            {form.type === 'transfer' ? '从账户' : '账户'}
            <span className="required">*</span>
          </label>
          <Select
            value={form.account_id}
            onChange={(v: any) => setForm((f) => ({ ...f, account_id: String(v ?? '') }))}
            optionList={accountOptions}
            placeholder="选择账户"
            style={{ width: '100%' }}
          />
          {accountError && <div className="field-error">{accountError}</div>}
        </div>

        {/* Target Account (transfer only) */}
        {form.type === 'transfer' && (
          <div className="field">
            <label className="field-label">到账户 <span className="required">*</span></label>
            <div style={{ display: 'flex', gap: 8 }}>
              <Select
                value={form.to_account_id}
                onChange={(v: any) => setForm((f) => ({ ...f, to_account_id: String(v ?? '') }))}
                optionList={accountOptions}
                placeholder="选择目标账户"
                style={{ flex: 1 }}
              />
              <Button
                theme="light"
                type="secondary"
                icon={<Icon name="RefreshCw" size={16} />}
                onClick={() => setForm((f) => ({ ...f, account_id: f.to_account_id ?? '', to_account_id: f.account_id }))}
                title="互换账户"
              />
            </div>
          </div>
        )}

        {/* Date */}
        <div className="field">
          <label className="field-label">日期</label>
          <DatePicker
            value={form.happened_at}
            onChange={(v: any) => setForm((f) => ({ ...f, happened_at: String(v ?? '') }))}
            type="date"
            style={{ width: '100%' }}
          />
        </div>

        {/* Note */}
        <div className="field">
          <label className="field-label">备注</label>
          <TextArea
            value={form.note}
            onChange={(v: string) => setForm((f) => ({ ...f, note: v }))}
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
