/**
 * AccountManager — 账户 Tab 主体组件（R14 提取，勿复制粘贴）。
 *
 * spec-20260922-v1 Phase 3 重构（01 §6 交互 / §6.1.1 D28 / §6.4 桌面端形态）：
 * - 类型选择：4 个平铺 Select → **3 组宫格（桌面 6 列）**，18 类型带品牌 logo；
 *   needsInstitution 的项带 `›`（01 §6 规则 3）
 * - 「银行」行：仅 needsInstitution 时渲染；saving/credit 必选（行内提示）、
 *   loan/deposit 可选（B10）；选银行 → 图标自动换该行 logo（D22 最高优先级）
 * - 余额输入动态化：信用类 → 标签「欠款」+ 默认 `−` 前缀（输入辅助，存值恒负）
 *   + balanceHint；asset/investment → 「余额」中性；旧「填已用额度正数」语义废弃（D14）
 * - 类型可改（Q5/§A2）：编辑态宫格不锁定；跨 asset↔credit 行内提示
 *   「余额符号将自动取反」，**保存时取负一次**（以最终类别 vs 打开抽屉时初始类别
 *   对比为准，别连乘）；跨 investment 提示不取负；同 L1 静默
 * - 图标行（D28）：图标引用为 `brand:`（含已选银行）→ 只读（隐藏「换图标」入口，
 *   非置灰）；否则点开 IconPicker（仅 lucide）；emoji 存量照常回显
 * - Q10/§A3：编辑存量 emoji 账户且用户未主动换图标 → 保存时顺手换成对应 lucide
 *   （ACCOUNT_ICON_KEYS 映射，缺的保留 emoji）
 * - 容器：表单编辑 → SideSheet（项目浮层选型约定）
 * - 提交 payload 增加 `institution`（空串 = 未指定）与 `type`
 *
 * v2 共存约束（不可破坏）：编辑已有账户时「不记录收支」Checkbox 保留，
 * 保存**显式传 record_flow: true**（后端只有显式 true 才生成流水）；勾选则不传。
 * 新建账户永不传。
 *
 * 历史：AssetTab 与 AccountTab 原本 203 行里只有 10 行不同，R14 合并；
 * D-03 第十六轮删掉「资产」Tab，仅存 AccountTab 一个消费方。
 */
import { useEffect, useState } from 'react'
import {
  Button,
  Checkbox,
  Input,
  InputNumber,
  Modal,
  SideSheet,
  Skeleton,
  Tooltip,
} from '@douyinfe/semi-ui'
import { Icon } from '@/components/icon'
import BrandLogo from '@/components/BrandLogo'
import BankPicker from '@/components/finance/BankPicker'
import IconPicker from '@/components/finance/IconPicker'
import { useFinanceStore } from '@/stores/finance'
import { financeApi } from '@/api/finance'
import { ACCOUNT_ICON_KEYS } from '@/utils/category-dict'
import {
  ACCOUNT_TYPES,
  ACCOUNT_CATEGORIES,
  accountCategoryOf,
  accountTypeDefOf,
} from '@/constants/account'
import type { AccountCategory, AccountType } from '@/constants/account'
import { BANKS } from '@/constants/banks'
import ErrorState from '@/components/ErrorState'
import { EmptyHint } from '@/components/EmptyState'
import { AssetSummaryCard } from './AssetSummaryCard'
import { MoneyText } from '@/components/finance/MoneyText'
import TransactionEditDrawer from '@/components/TransactionEditDrawer'
import type { Account, CreateTransactionReq, DebtItem } from '@/api/types'

/** 新建账户默认卡片底色（沿用原 saving 预设） */
const DEFAULT_COLOR = '#E0F2FF'

interface FormState {
  name: string
  type: AccountType
  /** 图标引用三态（brand:/lucide:/emoji）；渲染期优先级：银行 logo → 类型 brand: → 本值 */
  icon: string
  color: string
  balance: number
  /** 银行 code，'' = 未指定 */
  institution: string
}

function defaultForm(): FormState {
  const def = accountTypeDefOf('saving')!
  return { name: '', type: 'saving', icon: def.icon, color: DEFAULT_COLOR, balance: 0, institution: '' }
}

function bankOf(code: string) {
  return BANKS.find((b) => b.code === code)
}

/** 非 brand:/lucide: 前缀视为 emoji 存量 */
function isEmojiIcon(s: string | null | undefined): boolean {
  return !!s && !s.startsWith('brand:') && !s.startsWith('lucide:')
}

/**
 * 图标引用渲染期派生（01 §6.1.1 要点 2，不新增字段）：
 * 优先级 institution（有 logo）→ 类型 brand: → accounts.icon（form.icon）
 */
function displayIconOf(f: FormState): string {
  if (f.institution) {
    const bank = bankOf(f.institution)
    if (bank?.logo) return `brand:${bank.logo}`
  }
  const def = accountTypeDefOf(f.type)
  if (def?.icon.startsWith('brand:')) return def.icon
  return f.icon || def?.icon || ''
}

/** 债务性质 → 中性标签（05 §C3；kinds ⊆ reimburse/lend/borrow） */
const DEBT_KIND_LABEL: Record<string, string> = {
  reimburse: '待报销',
  lend: '借出',
  borrow: '借入',
}

function debtKindLabel(kinds: string[]): string {
  return kinds.map((k) => DEBT_KIND_LABEL[k] ?? k).join('、')
}

/** 债权债务单组（空组整段不渲染） */
function DebtGroup({ title, items, onRow }: { title: string; items: DebtItem[]; onRow: (contact: string) => void }) {
  if (!items || items.length === 0) return null
  const sum = items.reduce((s, i) => s + i.open, 0)
  return (
    <div className="debt-group">
      <div className="debt-group-head">
        <span>{title}</span>
        <span style={{ fontVariantNumeric: 'tabular-nums' }}><MoneyText value={sum} /></span>
      </div>
      {items.map((it) => (
        <button key={it.contact} type="button" className="debt-row" onClick={() => onRow(it.contact)}>
          <span className="debt-contact">{it.contact}</span>
          <span className="debt-kind">{debtKindLabel(it.kinds)}</span>
          <span className="debt-open"><MoneyText value={it.open} /></span>
          <Icon name="ChevronRight" size={14} />
        </button>
      ))}
    </div>
  )
}

export function AccountManager({
  onViewContact,
  onViewAccount,
}: {
  /** Phase 4.2：点债权债务行 → 跳收支视图并按对方筛选（由 FinancialTab 提供） */
  onViewContact?: (contact: string) => void
  /** spec-20260922-v2 · 07 #30b：账户卡「查看流水」→ 跳收支视图并按该账户筛选（方案 B：账户 Select 自动同步选中） */
  onViewAccount?: (accountId: string) => void
} = {}) {
  const financeStore = useFinanceStore()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [sheetVisible, setSheetVisible] = useState(false)
  const [editing, setEditing] = useState<Account | null>(null)
  const [form, setForm] = useState<FormState>(defaultForm)
  // Q5/§A2：打开抽屉时初始类别（保存时跨 asset↔credit 取负一次的对比基准）
  const [initialCategory, setInitialCategory] = useState<AccountCategory | null>(null)
  // Q10/§A3：打开抽屉时的原始 icon（存量 emoji 顺手换 lucide 的判定基准）
  const [initialIcon, setInitialIcon] = useState<string>('')
  // 「不记录收支」（Phase 3.4）：仅编辑已有账户出现；默认不勾 = 默认记录
  const [noFlow, setNoFlow] = useState(false)
  // 银行必选行内提示（saving/credit，B10）
  const [bankError, setBankError] = useState<string | null>(null)
  const [bankPickerVisible, setBankPickerVisible] = useState(false)
  const [iconPickerVisible, setIconPickerVisible] = useState(false)
  const [txDrawerVisible, setTxDrawerVisible] = useState(false)
  const [txSaving, setTxSaving] = useState(false)

  async function load() {
    setLoading(true)
    setError(false)
    // store 的 fetchAccounts 静默吞错，这里额外探一次真实接口以区分「失败」与「空」（E02）
    const probe = financeApi
      .listAccounts()
      .then(() => setError(false))
      .catch(() => setError(true))
    await financeStore.fetchAccounts()
    await probe
    setLoading(false)
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 债权债务（v4）：挂载即拉；核销/删除后由 store 联动刷新（fetchDebts）
  useEffect(() => {
    financeStore.fetchDebts()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function openCreate() {
    setEditing(null)
    setInitialCategory('asset')
    setInitialIcon('')
    setNoFlow(false)
    setBankError(null)
    setForm(defaultForm())
    setSheetVisible(true)
  }

  function openEdit(a: Account) {
    setEditing(a)
    setInitialCategory(accountCategoryOf(a.type))
    setInitialIcon(a.icon || '')
    setNoFlow(false) // 默认记录（默认不勾「不记录收支」）
    setBankError(null)
    setForm({
      name: a.name,
      type: a.type,
      icon: a.icon || accountTypeDefOf(a.type)?.icon || '',
      color: a.color,
      balance: a.balance,
      institution: a.institution || '',
    })
    setSheetVisible(true)
  }

  function pickType(type: AccountType) {
    const def = accountTypeDefOf(type)
    if (!def) return
    setBankError(null)
    setForm((f) => {
      // 新类型不需要机构 → 清空 institution（银行行随之消失）
      const institution = def.needsInstitution ? f.institution : ''
      return { ...f, type, institution, icon: def.icon }
    })
  }

  function pickBank(code: string) {
    setBankError(null)
    setForm((f) => ({ ...f, institution: code }))
    // 图标回写由渲染期 displayIconOf 派生（银行 logo 优先级最高，D22）；
    // 清空银行时回退类型默认图标
  }

  const typeDef = accountTypeDefOf(form.type)
  const category: AccountCategory = accountCategoryOf(form.type)
  const isCredit = category === 'credit'
  const displayIcon = displayIconOf(form)
  const iconReadonly = displayIcon.startsWith('brand:')

  // 信用类输入辅助（01 §6 规则 6）：存值恒为负，输入框显示绝对值 + 视觉 − 前缀
  const balanceDisplay = isCredit ? Math.abs(Number(form.balance) || 0) : form.balance

  // Q5 跨 L1 行内提示（编辑态）
  let crossHint: string | null = null
  if (editing && initialCategory && initialCategory !== category) {
    if (
      (initialCategory === 'asset' && category === 'credit') ||
      (initialCategory === 'credit' && category === 'asset')
    ) {
      crossHint = '余额符号将自动取反（保存时生效）'
    } else if (category === 'investment') {
      crossHint = '将按市值理解，余额不变'
    }
  }

  async function submit() {
    if (!form.name.trim()) {
      Modal.error({ title: '请输入账户名', content: '账户名不能为空' })
      return
    }
    // B10：saving/credit 银行必选（行内提示，不弹窗）；loan/deposit 可选
    if (typeDef?.needsInstitution && (form.type === 'saving' || form.type === 'credit') && !form.institution) {
      setBankError('该账户类型需要选择银行')
      return
    }

    let balance = Number(form.balance) || 0
    // Q5/§A2：跨 asset↔credit → 保存时取负一次（对比基准 = 打开抽屉时的初始类别）
    if (
      editing &&
      initialCategory &&
      initialCategory !== category &&
      ((initialCategory === 'asset' && category === 'credit') ||
        (initialCategory === 'credit' && category === 'asset'))
    ) {
      balance = -balance
    }

    // 图标：brand:（类型/银行带出）优先；Q10 存量 emoji 未动过 → 顺手换 lucide
    let icon = displayIcon
    if (!icon.startsWith('brand:') && editing && isEmojiIcon(initialIcon) && form.icon === initialIcon) {
      const hit = ACCOUNT_ICON_KEYS.find((k) => k.emoji === initialIcon)
      if (hit) icon = `lucide:${hit.icon}`
    }

    const payload: Record<string, unknown> = {
      name: form.name.trim(),
      type: form.type,
      icon,
      color: form.color,
      balance,
      institution: form.institution || '',
    }
    if (editing) {
      // Phase 3.4：新前端「默认记录」= 显式传 record_flow: true（只有显式 true 才生成）；
      // 勾「不记录收支」→ 不传（后端 nil 与 false 一致：不生成）。新建账户永不传。
      if (!noFlow) payload.record_flow = true
      const ok = await financeStore.updateAccount(editing.id, payload as any)
      if (ok) setSheetVisible(false)
      return
    }
    const ok = await financeStore.createAccount(payload as any)
    if (ok) setSheetVisible(false)
  }

  function onDeleteAccount(a: Account) {
    Modal.confirm({
      title: '删除账户',
      content: `确认删除「${a.name}」？有关联交易的账户将无法删除。`,
      okText: '删除',
      okButtonProps: { type: 'danger', theme: 'solid' },
      cancelText: '取消',
      onOk: async () => {
        await financeStore.removeAccount(a.id)
      },
    })
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

  const selectedBank = form.institution ? bankOf(form.institution) : undefined
  const bankOptional = form.type === 'loan' || form.type === 'deposit'

  // ===== spec-20260922-v1 Phase 4：L1 大类分组 + 净资产小计（本地派生）=====
  // ⚠️ 刻意不读服务端 summary 字段：桌面 store 的 totalBalance 在多处乐观更新，
  // 本地派生与乐观更新天然同步（netWorth ≡ Σ balance 恒等，与后端口径一致）
  const groupedAccounts = ACCOUNT_CATEGORIES.map((cat) => ({
    key: cat.key,
    label: cat.label,
    items: financeStore.accounts.filter((a) => accountCategoryOf(a.type) === cat.key),
  })).filter((g) => g.items.length > 0)
  const summaryOf = (cat: AccountCategory) =>
    financeStore.accounts
      .filter((a) => accountCategoryOf(a.type) === cat)
      .reduce((s, a) => s + a.balance, 0)
  const netWorth = financeStore.accounts.reduce((s, a) => s + a.balance, 0)

  return (
    <div className="account-manager">
      <div className="toolbar">
        <div className="toolbar-left">
          <AssetSummaryCard
            totalBalance={netWorth}
            accounts={financeStore.accounts.length}
            assets={summaryOf('asset')}
            investments={summaryOf('investment')}
            debts={summaryOf('credit')}
          />
        </div>
        <div className="toolbar-right">
          <Button theme="solid" type="secondary" size="small" icon={<Icon name="PlusCircle" size={16} />} onClick={openCreate}>新建账户</Button>
          <Button theme="light" type="secondary" size="small" icon={<Icon name="RefreshCw" size={16} />} onClick={() => setTxDrawerVisible(true)}>转账</Button>
        </div>
      </div>

      {loading ? (
        <div className="skeleton-wrap"><Skeleton><Skeleton.Paragraph rows={3} /></Skeleton></div>
      ) : error && financeStore.accounts.length === 0 ? (
        <ErrorState compact message="账户加载失败，请重试" onRetry={load} />
      ) : groupedAccounts.length > 0 ? (
        // Phase 4（P8）：按 L1 大类分组渲染，空组不渲染；组内交互（hover 编辑/删除）不变
        <div>
          {groupedAccounts.map((g) => (
            <div key={g.key} className="account-group">
              <div className="account-group-label">{g.label}</div>
              <div className="account-row">
                {g.items.map((a) => (
                  <div key={a.id} className="account-card" style={{ background: a.color }}>
                    {/* P8 顺手项：卡片图标改走 BrandLogo 三态通道（brand:/lucide:/emoji） */}
                    <div className="acc-logo">
                      <BrandLogo
                        icon={a.icon || ''}
                        size={22}
                        fallbackText={a.name.slice(0, 1)}
                      />
                    </div>
                    <div className="acc-info">
                      <div className="acc-name">{a.name}</div>
                      <div className="acc-balance" style={{ color: a.balance < 0 ? 'var(--color-danger-dark)' : 'var(--color-text-primary)' }}>
                        <MoneyText value={a.balance} />
                      </div>
                    </div>
                    <div className="acc-actions">
                      {/* 查看流水（07 #30b）：写 txQuery.account_id → 收支视图，账户 Select 受控自动同步 */}
                      <Tooltip content="查看流水">
                        <Button theme="borderless" type="tertiary" size="small" icon={<Icon name="Receipt" size={16} />} onClick={() => onViewAccount?.(a.id)} />
                      </Tooltip>
                      <Tooltip content="编辑">
                        <Button theme="borderless" type="tertiary" size="small" icon={<Icon name="Pencil" size={16} />} onClick={() => openEdit(a)} />
                      </Tooltip>
                      <Tooltip content="删除">
                        <Button theme="borderless" type="tertiary" size="small" icon={<Icon name="X" size={16} />} onClick={() => onDeleteAccount(a)} />
                      </Tooltip>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyHint icon="FolderOpen" title="还没有账户" desc="点击「新建账户」开始" />
      )}

      {/* Phase 4.2：债权债务卡（空组不渲染；两组都空整卡不渲染；中性色，Q14 不并入总资产） */}
      {financeStore.debts && (financeStore.debts.owed_to_me.length > 0 || financeStore.debts.i_owe.length > 0) && (
        <div className="debt-card">
          <div className="debt-card-head">
            <span className="debt-card-title">债权债务</span>
            <span className="debt-net">净 <MoneyText value={financeStore.debts.net} /></span>
          </div>
          <DebtGroup title="别人欠我" items={financeStore.debts.owed_to_me} onRow={(c) => onViewContact?.(c)} />
          <DebtGroup title="我欠别人" items={financeStore.debts.i_owe} onRow={(c) => onViewContact?.(c)} />
        </div>
      )}

      {/* 账户表单（新建 / 编辑共用；表单编辑 → SideSheet，项目浮层选型约定） */}
      <SideSheet
        visible={sheetVisible}
        onCancel={() => setSheetVisible(false)}
        title={editing ? '编辑账户' : '新建账户'}
        width={480}
        footer={
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button onClick={() => setSheetVisible(false)}>取消</Button>
            <Button theme="solid" onClick={submit}>{editing ? '保存' : '创建'}</Button>
          </div>
        }
      >
        <div className="acc-modal">
          {/* 类型：3 组宫格（桌面 6 列），分组标题用 ACCOUNT_CATEGORIES（01 §6 规则 1） */}
          {ACCOUNT_CATEGORIES.map((cat) => (
            <div key={cat.key} className="field">
              <label className="field-label">{cat.label}</label>
              <div className="acc-type-grid">
                {ACCOUNT_TYPES.filter((t) => t.category === cat.key).map((t) => (
                  <button
                    key={t.value}
                    type="button"
                    className={`acc-type-cell${form.type === t.value ? ' active' : ''}`}
                    onClick={() => pickType(t.value)}
                  >
                    <BrandLogo icon={t.icon} size={20} fallbackText={t.label.slice(0, 1)} />
                    <span className="acc-type-label">{t.label}</span>
                    {t.needsInstitution && <Icon name="ChevronRight" size={12} className="acc-type-arrow" />}
                  </button>
                ))}
              </div>
            </div>
          ))}

          {/* 银行行：仅 needsInstitution 时渲染（01 §6 规则 4）；loan/deposit 可选（B10） */}
          {typeDef?.needsInstitution && (
            <div className="field">
              <label className="field-label">银行{bankOptional ? '（可选）' : ''}</label>
              <button
                type="button"
                className="acc-bank-trigger"
                onClick={() => setBankPickerVisible(true)}
              >
                {selectedBank ? (
                  <>
                    <BrandLogo
                      icon={selectedBank.logo ? `brand:${selectedBank.logo}` : ''}
                      size={20}
                      fallbackText={selectedBank.short.slice(0, 1)}
                    />
                    <span>{selectedBank.short}</span>
                  </>
                ) : (
                  <span className="acc-bank-placeholder">请选择银行</span>
                )}
                <Icon name="ChevronRight" size={14} className="acc-type-arrow" />
              </button>
              {bankError && <div className="acc-field-error">{bankError}</div>}
            </div>
          )}

          <div className="field">
            <label className="field-label">账户名</label>
            <Input
              value={form.name}
              onChange={(v) => setForm((f) => ({ ...f, name: v }))}
              placeholder="例如：招商储蓄卡"
              maxLength={20}
              showClear
            />
          </div>

          {/* 图标行（D28）：brand: → 只读（隐藏入口非置灰）；否则可点开 IconPicker（仅 lucide） */}
          <div className="field">
            <label className="field-label">图标</label>
            <div className="acc-icon-row">
              <BrandLogo
                icon={displayIcon}
                size={28}
                fallbackText={form.name.trim().slice(0, 1) || typeDef?.label.slice(0, 1)}
              />
              {iconReadonly ? (
                <span className="acc-icon-note">由类型决定</span>
              ) : (
                <Button size="small" theme="light" type="tertiary" onClick={() => setIconPickerVisible(true)}>
                  换图标
                </Button>
              )}
            </div>
          </div>

          {/* 余额：label/hint 按 L1 动态（01 §6 规则 6）；信用类默认 − 前缀输入辅助 */}
          <div className="field">
            <label className="field-label">{isCredit ? '欠款' : editing ? '余额' : '初始余额'}</label>
            <InputNumber
              value={balanceDisplay}
              onChange={(v) => {
                const n = parseFloat(String(v)) || 0
                setForm((f) => ({ ...f, balance: isCredit ? -Math.abs(n) : n }))
              }}
              placeholder="0.00"
              min={editing || !isCredit ? undefined : 0}
              step={0.01}
              prefix={isCredit ? <span className="acc-balance-minus">−</span> : undefined}
            />
            {isCredit && typeDef?.balanceHint && <div className="field-tip-text">{typeDef.balanceHint}</div>}
            {crossHint && <div className="acc-cross-hint">ⓘ {crossHint}</div>}
            {/* Phase 3.4（05 §5.1）：仅编辑已有账户显示；勾选 = 只改余额不生成流水 */}
            {editing && (
              <div className="field-tip">
                <Checkbox checked={noFlow} onChange={(e) => setNoFlow(!!e.target.checked)}>
                  不记录收支
                </Checkbox>
                <div style={{ marginTop: 2 }}>勾选后只改余额，不生成任何流水；默认会生成一笔「余额调整」记录</div>
              </div>
            )}
          </div>
        </div>
      </SideSheet>

      <BankPicker
        visible={bankPickerVisible}
        value={form.institution}
        onClose={() => setBankPickerVisible(false)}
        onSelect={pickBank}
      />
      <IconPicker
        visible={iconPickerVisible}
        value={form.icon.startsWith('lucide:') ? (form.icon.slice('lucide:'.length) as never) : null}
        onClose={() => setIconPickerVisible(false)}
        onSelect={(name) => setForm((f) => ({ ...f, icon: `lucide:${name}` }))}
      />

      <TransactionEditDrawer visible={txDrawerVisible} accounts={financeStore.accounts} defaultType="transfer" saving={txSaving} onClose={() => setTxDrawerVisible(false)} onSubmit={onTxSubmit} />
    </div>
  )
}

export default AccountManager
