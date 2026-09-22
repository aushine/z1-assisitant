/**
 * Transaction create / edit Drawer
 *
 * v2（Phase 2）扩展：mode/transaction/defaultDate/onEditSubmit（可选，向后兼容）。
 *
 * Phase 3（批次一前端 · 记一笔，02 文档）：
 *  - 3.1 金额 = 表达式输入（D6 桌面端不做自绘键盘）：Input type=text，
 *    支持全角＋－×÷ / U+2212，右侧实时预览（= 精确 / ≈ 舍入 / 失败红字），
 *    求值语义与移动端 utils/calc.ts 同一张 13 条用例表（左到右、分上整数运算）。
 *    ⚠️ 编辑回填最终金额（不回填表达式，算式不落库）。
 *  - 3.2 日期 DatePicker type="dateTime"（yyyy-MM-dd HH:mm）；编辑回填完整时分
 *    （原 slice(0,10) 会把时间静默清掉）；提交用用户选的时分（秒补 :00）；
 *    不晚于「现在 + 1 天」（disabledDate 只挡日期，提交前兜底校验）。
 *  - 3.4 「更多选项」折叠区（默认收起，右侧「已开启 N 项」）：
 *    可见性 支出=两开关 / 收入=只「不计入收支」/ 转账=整区不渲染；
 *    ⚠️ 切类型时把被隐藏的开关重置 false（防止带看不见的 true 提交）。
 *
 * Phase 4（批次三 · 财务功能，05 文档）：
 *  - 「性质」单选（支出：普通/待报销/借出；收入：普通/借入；转账不显示；
 *    edit 模式不显示——PUT 不允许改 source）。
 *  - 选「待报销/借出/借入」自动勾上两个口径开关（可见、可取消，Q11）。
 *  - 「对方」输入：非普通时出现，借出/借入必填（行内报错）；最近候选 ≤5
 *    （localStorage 本地缓存，Q12 不做通讯录）。
 *  - ⚠️ 提交映射：待报销/借出 = type=expense + source=reimburse/lend；
 *    借入 = type=income + source=borrow；都不是 transfer、to_account_id 不传。
 *  - edit 模式：source 不可改，仅当原笔带 contact 时展示「对方」可编辑。
 */
import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  SideSheet,
  Button,
  Input,
  TextArea,
  Select,
  RadioGroup,
  Radio,
  DatePicker,
  Typography,
  Checkbox,
} from '@douyinfe/semi-ui'
import type {
  FinanceCategory,
  TransactionType,
  CreateTransactionReq,
  UpdateTransactionReq,
  Transaction,
} from '@/api/types'
import { useFinanceCategoryStore } from '@/stores/financeCategory'
import { evalAmountExpr, centsToAmount } from '@/utils/calc'
import CategoryPicker from '@/components/finance/CategoryPicker'
import { Icon } from '@/components/icon'

const { Title } = Typography

const TYPE_OPTIONS: { value: TransactionType; label: string; color: string }[] = [
  { value: 'expense', label: '支出', color: '#EF4444' },
  { value: 'income', label: '收入', color: '#10B981' },
  { value: 'transfer', label: '转账', color: '#8B5CF6' },
]

const TYPE_LABEL: Record<TransactionType, string> = {
  expense: '支出',
  income: '收入',
  transfer: '转账',
}

/** 性质选项（按交易类型过滤；value '' = 普通） */
const NATURE_OPTIONS: { value: string; label: string; types: TransactionType[] }[] = [
  { value: '', label: '普通', types: ['expense', 'income'] },
  { value: 'reimburse', label: '待报销', types: ['expense'] },
  { value: 'lend', label: '借出', types: ['expense'] },
  { value: 'borrow', label: '借入', types: ['income'] },
]

/** 最近对方候选（Q12：本地缓存最近输入 ≤5，不做通讯录） */
const RECENT_CONTACTS_KEY = 'fin_recent_contacts'

function loadRecentContacts(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_CONTACTS_KEY)
    const arr = raw ? JSON.parse(raw) : []
    return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string').slice(0, 5) : []
  } catch {
    return []
  }
}

function saveRecentContact(contact: string) {
  const c = contact.trim()
  if (!c) return
  const next = [c, ...loadRecentContacts().filter((x) => x !== c)].slice(0, 5)
  try {
    localStorage.setItem(RECENT_CONTACTS_KEY, JSON.stringify(next))
  } catch {
    /* 存储不可用时静默（候选只是便利功能） */
  }
}

/** 本地时间（string / Date / undefined=现在）→ 'YYYY-MM-DD HH:mm'（分钟粒度） */
function toLocalMin(iso?: string | Date): string {
  const d = iso ? new Date(iso) : new Date()
  if (isNaN(d.getTime())) return toLocalMin()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 'YYYY-MM-DD HH:mm'（本地墙钟）→ ISO（秒补 :00，时区约定不变，02 §3.2） */
function localMinToISO(local?: string): string | undefined {
  if (!local) return undefined
  const d = new Date(local.replace(' ', 'T'))
  return isNaN(d.getTime()) ? undefined : d.toISOString()
}

interface Props {
  visible: boolean
  accounts: { id: string; name: string; balance: number }[]
  defaultType?: TransactionType
  /** 预填日期（YYYY-MM-DD），create 模式右键补录用（时分取现在） */
  defaultDate?: string
  saving?: boolean
  onClose: () => void
  /** create 模式保存回调 */
  onSubmit: (data: CreateTransactionReq) => void
  // ===== v2：edit 模式（可选，向后兼容）=====
  mode?: 'create' | 'edit'
  /** edit 模式的回填源 */
  transaction?: Transaction | null
  /** edit 模式保存回调（PUT /transactions/:id，不带 type/source/settle_of） */
  onEditSubmit?: (id: string, data: UpdateTransactionReq) => void
}

export default function TransactionEditDrawer({
  visible,
  accounts,
  defaultType = 'expense',
  defaultDate,
  saving = false,
  onClose,
  onSubmit,
  mode = 'create',
  transaction,
  onEditSubmit,
}: Props) {
  const tree = useFinanceCategoryStore((s) => s.tree)
  const fetchTree = useFinanceCategoryStore((s) => s.fetchTree)

  const isEdit = mode === 'edit' && !!transaction

  const [form, setForm] = useState<CreateTransactionReq>({
    type: 'expense',
    amount: 0,
    category_id: '',
    category_emoji: '',
    category_name: '',
    account_id: '',
    to_account_id: '',
    note: '',
    happened_at: '',
    exclude_budget: false,
    exclude_stats: false,
    source: '',
    contact: '',
  })
  // 金额表达式原文（form.amount 保存最近一次有效求值结果）
  const [amountText, setAmountText] = useState('')
  const [moreOpen, setMoreOpen] = useState(false)
  const [contactError, setContactError] = useState('')
  const [dateError, setDateError] = useState('')
  const [amountError, setAmountError] = useState('')
  const [accountError, setAccountError] = useState('')

  useEffect(() => {
    if (tree.length === 0) void fetchTree()
  }, [tree.length, fetchTree])

  // 打开时初始化表单：edit 模式回填 transaction；create 模式重置
  useEffect(() => {
    if (!visible) return
    setMoreOpen(false)
    setContactError('')
    setDateError('')
    if (isEdit && transaction) {
      setForm({
        type: transaction.type,
        amount: transaction.amount,
        category_id: transaction.category_id ?? '',
        category_emoji: transaction.category_emoji ?? '',
        category_name: transaction.category_name ?? '',
        account_id: transaction.account_id,
        to_account_id: transaction.to_account_id ?? '',
        note: transaction.note ?? '',
        happened_at: toLocalMin(transaction.happened_at),
        exclude_budget: !!transaction.exclude_budget,
        exclude_stats: !!transaction.exclude_stats,
        source: transaction.source ?? '',
        contact: transaction.contact ?? '',
      })
      // 02 §1.6-14：编辑回填最终金额，不回填表达式（算式不落库）
      setAmountText(transaction.amount.toFixed(2))
      setAmountError('')
      setAccountError('')
      return
    }
    const now = toLocalMin()
    setForm((f) => ({
      ...f,
      type: defaultType ?? 'expense',
      amount: 0,
      category_id: '',
      category_emoji: '',
      category_name: '',
      account_id: accounts[0]?.id ?? '',
      to_account_id: accounts[1]?.id ?? '',
      note: '',
      happened_at: defaultDate ? `${defaultDate} ${now.slice(11)}` : now,
      exclude_budget: false,
      exclude_stats: false,
      source: '',
      contact: '',
    }))
    setAmountText('')
    setAmountError('')
    setAccountError('')
  }, [visible, accounts, defaultType, defaultDate, isEdit, transaction])

  // 类型切换 / 树就绪后：保证已选中一个默认分类（按 id，向后兼容未加载时留空）
  useEffect(() => {
    if (form.type === 'transfer') return
    if (form.category_id) return
    const first = tree.find((c) => c.scope === form.type)
    if (first) {
      setForm((f) => ({
        ...f,
        category_id: first.id,
        category_name: first.full_name,
        category_emoji: first.emoji ?? '',
      }))
    }
  }, [form.type, form.category_id, tree])

  const accountOptions = (accounts ?? []).map((a) => ({
    value: a.id,
    label: `${a.name}（¥${a.balance.toFixed(2)}）`,
  }))

  const pickCategory = useCallback((c: FinanceCategory) => {
    setForm((f) => ({
      ...f,
      category_id: c.id,
      category_name: c.full_name,
      category_emoji: c.emoji ?? '',
    }))
  }, [])

  // ===== 金额表达式（实时预览；提交时采纳求值结果）=====
  const amountEval = useMemo(() => evalAmountExpr(amountText), [amountText])
  const amountPreview = useMemo(() => {
    if (!/[+\-*/]/.test(amountText)) return null // 无运算符不留预览位（02 §1.4）
    if (!amountEval.valid) return null
    return `${amountEval.rounded ? '≈' : '='} ${centsToAmount(amountEval.cents)}`
  }, [amountText, amountEval])

  const onAmountText = useCallback((v: string) => {
    setAmountText(v)
    const r = evalAmountExpr(v)
    if (r.valid) {
      setForm((f) => ({ ...f, amount: r.cents / 100 }))
      if (r.cents > 0) setAmountError('')
    }
  }, [])

  // ===== 类型切换：把被隐藏的开关/性质重置（05 §2 ⚠️ + 05 §B3.1 ⚠️）=====
  const onTypeChange = useCallback((next: TransactionType) => {
    setForm((f) => {
      const patch: Partial<CreateTransactionReq> = { type: next }
      if (next === 'expense') {
        // 两个开关都显示：保持现状
      } else if (next === 'income') {
        patch.exclude_budget = false // 「不计入预算」被隐藏 → 重置
      } else {
        patch.exclude_budget = false
        patch.exclude_stats = false // 转账：两个都隐藏 → 全重置
      }
      // 性质：离开原类型后不合法 → 重置为普通（借出→收入 等）
      const nature = NATURE_OPTIONS.find((o) => o.value === (f.source ?? ''))
      if (!nature || !nature.types.includes(next)) patch.source = ''
      return { ...f, ...patch }
    })
  }, [])

  // 选「待报销/借出/借入」→ 自动勾上两个口径开关（可见、可取消，Q11）
  const onNatureChange = useCallback((next: string) => {
    setForm((f) => {
      if (next && next !== '') {
        return { ...f, source: next, exclude_budget: true, exclude_stats: true }
      }
      return { ...f, source: '' }
    })
    setContactError('')
  }, [])

  const recentContacts = useMemo(loadRecentContacts, [visible])
  const contactCandidates = useMemo(() => {
    const q = (form.contact ?? '').trim()
    if (!q) return []
    return recentContacts.filter((c) => c.includes(q) && c !== q).slice(0, 5)
  }, [form.contact, recentContacts, visible])

  // ===== 提交 =====
  const handleSubmit = useCallback(() => {
    let valid = true

    // 金额：表达式求值兜底（无效不采纳、保留原文）
    const r = evalAmountExpr(amountText)
    if (!amountText.trim()) {
      setAmountError('请输入金额')
      valid = false
    } else if (!r.valid) {
      setAmountError(/(?:÷|\/)\s*0+$/.test(amountText.trim()) ? '除数不能为 0' : '算式无效')
      valid = false
    } else if (r.cents <= 0) {
      setAmountError('请输入金额')
      valid = false
    }

    // 日期：不晚于「现在 + 1 天」（02 §B2；disabledDate 只挡日期，这里兜底）
    if (form.happened_at) {
      const d = new Date(form.happened_at.replace(' ', 'T'))
      if (!isNaN(d.getTime()) && d.getTime() > Date.now() + 24 * 3600 * 1000) {
        setDateError('日期不能晚于明天')
        valid = false
      } else {
        setDateError('')
      }
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

    // 性质 → 提交映射（05 §统一模型）：待报销/借出=expense+source；借入=income+source
    const nature = form.source ?? ''
    const contact = (form.contact ?? '').trim()
    if (form.type !== 'transfer' && nature !== '') {
      const needContact = nature === 'lend' || nature === 'borrow'
      if (needContact && !contact) {
        setContactError(nature === 'lend' ? '借出需填写对方' : '借入需填写对方')
        valid = false
      } else {
        setContactError('')
      }
    } else {
      setContactError('')
    }

    if (!valid) return

    const happenedISO = localMinToISO(form.happened_at)
    const amount = r.cents / 100

    // edit 模式：PUT /transactions/:id（不带 type；source/settle_of 后端本就不收）
    if (isEdit && transaction) {
      const data: UpdateTransactionReq = {
        amount,
        category_id: form.category_id || undefined,
        category_emoji: form.category_emoji || undefined,
        category_name: form.category_name || undefined,
        account_id: form.account_id,
        note: form.note?.trim() || undefined,
        happened_at: happenedISO,
      }
      if (transaction.type === 'transfer') {
        data.to_account_id = form.to_account_id || undefined
      } else {
        // 口径开关（后端指针语义，缺省不改；这里始终按表单提交）
        data.exclude_budget = !!form.exclude_budget
        data.exclude_stats = !!form.exclude_stats
        // 对方：仅原笔带 contact 的记录展示并提交（PATCH 只放开 contact）
        if (transaction.source && transaction.source !== 'balance_adjust') {
          data.contact = contact || undefined
        }
      }
      onEditSubmit?.(transaction.id, data)
      return
    }

    // create 模式
    if (form.type === 'transfer') {
      onSubmit({
        type: 'transfer',
        amount,
        account_id: form.account_id,
        to_account_id: form.to_account_id,
        note: form.note?.trim() || undefined,
        happened_at: happenedISO,
      })
      return
    }

    const data: CreateTransactionReq = {
      type: form.type,
      amount,
      category_id: form.category_id || undefined,
      category_emoji: form.category_emoji || undefined,
      category_name: form.category_name || undefined,
      account_id: form.account_id,
      note: form.note?.trim() || undefined,
      happened_at: happenedISO,
      exclude_budget: !!form.exclude_budget,
      exclude_stats: !!form.exclude_stats,
      contact: contact || undefined,
    }
    if (nature !== '') data.source = nature // balance_adjust 前端永不产生
    saveRecentContact(contact)
    onSubmit(data)
  }, [form, amountText, isEdit, transaction, onEditSubmit, onSubmit])

  const title = isEdit && transaction
    ? `编辑${TYPE_LABEL[transaction.type]}`
    : '记一笔'

  // 口径开关可见性：支出=两个 / 收入=只「不计入收支」/ 转账=都不显示
  const showExcludeBudget = form.type === 'expense'
  const showExcludeStats = form.type !== 'transfer'
  const showMoreSection = showExcludeBudget || showExcludeStats
  const moreCount =
    (showExcludeBudget && form.exclude_budget ? 1 : 0) +
    (showExcludeStats && form.exclude_stats ? 1 : 0)

  // 性质区：create 模式 + 非转账；edit 模式 source 不可改（PUT 不收）不显示
  const natureOptions = NATURE_OPTIONS.filter((o) => o.types.includes(form.type))
  const showNature = !isEdit && form.type !== 'transfer'
  // 对方输入：性质非普通时出现；edit 模式下原笔带 contact（非余额调整）也可改
  const showContact = showNature
    ? (form.source ?? '') !== ''
    : isEdit && !!transaction && !!transaction.source && transaction.source !== 'balance_adjust'
  const contactRequired = form.source === 'lend' || form.source === 'borrow'

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
        <Title heading={5} style={{ margin: 0 }}>{title}</Title>
        <Button theme="borderless" type="tertiary" disabled={saving} onClick={onClose} aria-label="关闭">
          <Icon name="X" size={16} />
        </Button>
      </div>
      <div className="drawer-body">
        {/* Type（edit 模式隐藏类型选择，与移动端同规则） */}
        {!isEdit && (
          <div className="field">
            <label className="field-label">类型</label>
            <RadioGroup
              value={form.type}
              onChange={(e: any) => onTypeChange(e.target.value as TransactionType)}
              type="button"
            >
              {TYPE_OPTIONS.map((t) => (
                <Radio key={t.value} value={t.value}>
                  <span style={{ color: t.color, fontWeight: 600 }}>{t.label}</span>
                </Radio>
              ))}
            </RadioGroup>
          </div>
        )}

        {/* Amount：表达式输入（D6，不做自绘键盘） */}
        <div className="field">
          <label className="field-label">金额 <span className="required">*</span></label>
          <div className="amount-row">
            <span className="amount-symbol">¥</span>
            <Input
              type="text"
              value={amountText}
              onChange={onAmountText}
              placeholder="0.00"
              style={{ flex: 1 }}
              // 全角＋－×÷ 也可输入，求值前半角化；不带 InputNumber 的原生校验
            />
            {amountPreview && (
              <span className={`amount-preview${amountEval.rounded ? ' is-rounded' : ''}`}>
                {amountPreview}
              </span>
            )}
          </div>
          <div className="field-tip">支持 + − × ÷（例：199/3 → 66.33）</div>
          {amountError && <div className="field-error">{amountError}</div>}
        </div>

        {/* Category */}
        {form.type !== 'transfer' && (
          <div className="field">
            <label className="field-label">类别</label>
            <CategoryPicker
              scope={form.type}
              value={form.category_id || undefined}
              onChange={pickCategory}
            />
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

        {/* Date（dateTime：补记/编辑都保留用户选的时分） */}
        <div className="field">
          <label className="field-label">日期</label>
          <DatePicker
            type="dateTime"
            format="yyyy-MM-dd HH:mm"
            value={form.happened_at ? new Date(form.happened_at.replace(' ', 'T')) : undefined}
            onChange={(v: any) => {
              const d = Array.isArray(v) ? v[0] : v
              setForm((f) => ({ ...f, happened_at: d ? toLocalMin(new Date(d)) : f.happened_at }))
              if (dateError) setDateError('')
            }}
            style={{ width: '100%' }}
          />
          {dateError && <div className="field-error">{dateError}</div>}
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

        {/* 性质（Phase 4，05 §B3.1；单选 chip，edit 模式不显示） */}
        {showNature && (
          <div className="field">
            <label className="field-label">性质</label>
            <RadioGroup
              value={form.source ?? ''}
              onChange={(e: any) => onNatureChange(e.target.value as string)}
              type="button"
            >
              {natureOptions.map((o) => (
                <Radio key={o.value} value={o.value}>{o.label}</Radio>
              ))}
            </RadioGroup>
          </div>
        )}

        {/* 对方（性质非普通时出现；借出/借入必填） */}
        {showContact && (
          <div className="field">
            <label className="field-label">
              对方{contactRequired && <span className="required">*</span>}
            </label>
            <Input
              type="text"
              value={form.contact ?? ''}
              onChange={(v: string) => {
                setForm((f) => ({ ...f, contact: v }))
                if (contactError) setContactError('')
              }}
              placeholder={contactRequired ? '借给谁 / 向谁借（必填）' : '报销对象（可选）'}
              maxLength={20}
              showClear
            />
            {contactCandidates.length > 0 && (
              <div className="contact-candidates">
                {contactCandidates.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className="contact-chip"
                    onClick={() => setForm((f) => ({ ...f, contact: c }))}
                  >
                    {c}
                  </button>
                ))}
              </div>
            )}
            {contactError && <div className="field-error">{contactError}</div>}
          </div>
        )}

        {/* 更多选项：口径开关（默认收起；转账整区不显示） */}
        {showMoreSection && (
          <div className="field">
            <button
              type="button"
              className="more-options-toggle"
              onClick={() => setMoreOpen((o) => !o)}
            >
              <span className="more-options-title">更多选项</span>
              <span className="more-options-right">
                {moreCount > 0 && <span className="more-options-count">已开启 {moreCount} 项</span>}
                <Icon name={moreOpen ? 'ChevronUp' : 'ChevronDown'} size={14} />
              </span>
            </button>
            {moreOpen && (
              <div className="more-options-body">
                {showExcludeBudget && (
                  <Checkbox
                    checked={!!form.exclude_budget}
                    onChange={(e) => setForm((f) => ({ ...f, exclude_budget: e.target.checked }))}
                  >
                    <span className="more-option-label">不计入预算</span>
                    <span className="more-option-desc">这笔支出不占用任何预算额度</span>
                  </Checkbox>
                )}
                {showExcludeStats && (
                  <Checkbox
                    checked={!!form.exclude_stats}
                    onChange={(e) => setForm((f) => ({ ...f, exclude_stats: e.target.checked }))}
                  >
                    <span className="more-option-label">不计入收支</span>
                    <span className="more-option-desc">不计入月度收支与分类占比</span>
                  </Checkbox>
                )}
              </div>
            )}
          </div>
        )}
      </div>
      <div className="drawer-footer">
        <Button theme="light" type="secondary" disabled={saving} onClick={onClose}>取消</Button>
        <Button theme="solid" type="primary" loading={saving} onClick={handleSubmit}>保存</Button>
      </div>
    </SideSheet>
  )
}
