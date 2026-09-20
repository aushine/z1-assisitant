/**
 * AccountManager — 账户 Tab 主体组件（R14 提取，勿复制粘贴）。
 *
 * 历史：AssetTab 与 AccountTab 原本 203 行里只有 10 行不同，R14 合并为
 * 本组件、两 Tab 变薄壳；D-03 第十六轮删掉重复的「资产」Tab，仅存
 * AccountTab 一个消费方（薄壳见 AccountTab.tsx）。
 *
 * 图标（R19 / R29）：账户选择器从 14 个 emoji 改为 Lucide 图标。
 * 后端 accounts.icon 字段仍存 emoji 字符串（前端无法改后端），
 * 保守策略：写库仍写 emoji（下面用 \u{...} 转义存储值，避免在渲染代码里出现裸 emoji，B08），
 * 渲染层用 ACCOUNT_ICON_KEYS 把 emoji 反查成图标 + tint；查不到再走 icon-map 兜底。
 *
 * 其它修复：
 * - R15 加载态 Skeleton；R16 Popover 图标统一 32px；R17 选中边框用 --color-primary-500；
 * - R18 账户编辑（改名/换类型/换图标/改余额，走 financeStore.updateAccount）；
 * - 新建账户按钮 theme 统一为 solid（原 AssetTab=light、AccountTab=solid 不一致）。
 */
import { useEffect, useState } from 'react'
import { Button, Input, InputNumber, Modal, Popover, Select, Skeleton, Tooltip } from '@douyinfe/semi-ui'
import { Icon, ICONS } from '@/components/icon'
import { useFinanceStore } from '@/stores/finance'
import { financeApi } from '@/api/finance'
import { ACCOUNT_ICON_KEYS, resolveAccountIcon } from '@/utils/category-dict'
import IconBox from '@/components/IconBox'
import ErrorState from '@/components/ErrorState'
import { EmptyHint } from '@/components/EmptyState'
import { AssetSummaryCard } from './AssetSummaryCard'
import TransactionEditDrawer from '@/components/TransactionEditDrawer'
import type { Account, AccountType, CreateTransactionReq } from '@/api/types'

/** 账户类型预设：type → 默认图标（emoji 存储值）+ 卡片底色 */
const ACCOUNT_PRESETS: { type: AccountType; label: string; icon: string; color: string }[] = [
  { type: 'saving', label: '储蓄卡', icon: '\u{1F3E6}', color: '#E0F2FF' },
  { type: 'credit', label: '信用卡', icon: '\u{1F4B3}', color: '#FFF3E0' },
  { type: 'huabei', label: '花呗', icon: '\u{1F499}', color: '#F0E8FF' },
  { type: 'wechat', label: '微信零钱', icon: '\u{1F49A}', color: '#E8F8F0' },
]

/**
 * 账户图标 key 表已收敛到 `@/utils/category-dict` 的 **唯一真相**
 * （ACCOUNT_ICON_KEYS / resolveAccountIcon）。
 *
 * 此前它定义在本文件内且未导出，导致统计页的账户汇总表只能绕过它直接调
 * `getIconMapping` —— 同一账户在两个页面颜色不同（现金 💰 记录页 neutral、
 * 统计页 danger 红）。现所有页面统一走字典里的 resolveAccountIcon。
 */

interface FormState {
  name: string
  type: AccountType
  icon: string
  color: string
  balance: number
}

function defaultForm(): FormState {
  const p = ACCOUNT_PRESETS[0]
  return { name: '', type: p.type, icon: p.icon, color: p.color, balance: 0 }
}

export function AccountManager() {
  const financeStore = useFinanceStore()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [modalVisible, setModalVisible] = useState(false)
  const [editing, setEditing] = useState<Account | null>(null)
  const [form, setForm] = useState<FormState>(defaultForm)
  const [txDrawerVisible, setTxDrawerVisible] = useState(false)
  const [txSaving, setTxSaving] = useState(false)

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

  function openCreate() {
    setEditing(null)
    setForm(defaultForm())
    setModalVisible(true)
  }

  function openEdit(a: Account) {
    setEditing(a)
    setForm({ name: a.name, type: a.type, icon: a.icon || ACCOUNT_PRESETS[0].icon, color: a.color, balance: a.balance })
    setModalVisible(true)
  }

  function pickAccountType(type: AccountType) {
    const preset = ACCOUNT_PRESETS.find((p) => p.type === type)
    setForm((f) => ({ ...f, type, icon: preset?.icon ?? f.icon, color: preset?.color ?? f.color }))
  }

  async function submit() {
    if (!form.name.trim()) {
      Modal.error({ title: '请输入账户名', content: '账户名不能为空' })
      return
    }
    const payload = {
      name: form.name.trim(),
      type: form.type,
      icon: form.icon,
      color: form.color,
      balance: Number(form.balance) || 0,
    }
    const ok = editing
      ? await financeStore.updateAccount(editing.id, payload)
      : await financeStore.createAccount(payload)
    if (ok) setModalVisible(false)
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

  const triggerIcon = resolveAccountIcon(form.icon || ACCOUNT_PRESETS[0].icon)

  return (
    <div className="account-manager">
      <div className="toolbar">
        <div className="toolbar-left">
          <AssetSummaryCard totalBalance={financeStore.totalBalance} accounts={financeStore.accounts.length} />
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
      ) : financeStore.accounts.length > 0 ? (
        <div className="account-row">
          {financeStore.accounts.map((a) => {
            const resolved = resolveAccountIcon(a.icon || ACCOUNT_PRESETS[0].icon)
            return (
              <div key={a.id} className="account-card" style={{ background: a.color }}>
                <IconBox icon={resolved.icon} bg="rgba(255,255,255,0.3)" fg="inherit" size={40} />
                <div className="acc-info">
                  <div className="acc-name">{a.name}</div>
                  <div className="acc-balance" style={{ color: a.balance < 0 ? 'var(--color-danger-dark)' : 'var(--color-text-primary)' }}>
                    ¥ {a.balance.toFixed(2)}
                  </div>
                </div>
                <div className="acc-actions">
                  <Tooltip content="编辑">
                    <Button theme="borderless" type="tertiary" size="small" icon={<Icon name="Pencil" size={16} />} onClick={() => openEdit(a)} />
                  </Tooltip>
                  <Tooltip content="删除">
                    <Button theme="borderless" type="tertiary" size="small" icon={<Icon name="X" size={16} />} onClick={() => onDeleteAccount(a)} />
                  </Tooltip>
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <EmptyHint icon="FolderOpen" title="还没有账户" desc="点击「新建账户」开始" />
      )}

      {/* Account Modal（新建 / 编辑共用） */}
      <Modal
        visible={modalVisible}
        onCancel={() => setModalVisible(false)}
        title={editing ? '编辑账户' : '新建账户'}
        width={480}
        okText={editing ? '保存' : '创建'}
        cancelText="取消"
        onOk={submit}
      >
        <div className="acc-modal">
          <div className="field">
            <label className="field-label">账户类型</label>
            <Select value={form.type} onChange={(v) => pickAccountType(v as AccountType)} style={{ width: '100%' }}>
              {ACCOUNT_PRESETS.map((p) => (
                <Select.Option key={p.type} value={p.type}>{p.label}</Select.Option>
              ))}
            </Select>
          </div>
          <div className="field">
            <label className="field-label">账户名</label>
            <Input
              value={form.name}
              onChange={(v) => setForm((f) => ({ ...f, name: v }))}
              placeholder="例如：招商储蓄卡"
              maxLength={20}
              showClear
              prefix={
                <Popover
                  trigger="click"
                  position="bottomLeft"
                  content={
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 8, padding: 8, maxWidth: 320 }}>
                      {ACCOUNT_ICON_KEYS.map((k) => {
                        const selected = form.icon === k.emoji
                        return (
                          <div
                            key={k.icon}
                            onClick={() => setForm((f) => ({ ...f, icon: k.emoji }))}
                            style={{
                              width: 32, height: 32, borderRadius: 8,
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              cursor: 'pointer',
                              border: selected ? '2px solid var(--color-primary-500)' : '2px solid transparent',
                              transition: 'border-color 0.15s',
                            }}
                          >
                            <IconBox icon={ICONS[k.icon]} tint={k.tint} size={32} />
                          </div>
                        )
                      })}
                    </div>
                  }
                >
                  <div style={{ margin: '0 2px' }}>
                    <IconBox icon={triggerIcon.icon} tint={triggerIcon.tint} size={32} />
                  </div>
                </Popover>
              }
            />
          </div>
          <div className="field">
            <label className="field-label">{editing ? '余额' : '初始余额'}</label>
            <InputNumber
              value={form.balance}
              onChange={(v) => setForm((f) => ({ ...f, balance: parseFloat(String(v)) || 0 }))}
              placeholder="0.00"
              min={editing ? undefined : 0}
              step={0.01}
            />
          </div>
        </div>
      </Modal>

      <TransactionEditDrawer visible={txDrawerVisible} accounts={financeStore.accounts} defaultType="transfer" saving={txSaving} onClose={() => setTxDrawerVisible(false)} onSubmit={onTxSubmit} />
    </div>
  )
}

export default AccountManager
