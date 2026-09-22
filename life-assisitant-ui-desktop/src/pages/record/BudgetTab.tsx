/**
 * BudgetTab — 预算 Tab：总预算 + 分类预算。
 *
 * R20：补加载态（Skeleton）。E02/E03：补错误态（financeStore 静默吞错，这里额外探接口）。
 * R21：alert_threshold 由「悬空字段」补上输入 UI + 消耗预警展示（接近预算 / 已超支）。
 * R22：预算编辑 —— 后端无 updateBudget 端点（api/finance.ts 只有 create/list/remove），
 *      故以「删旧建新」实现（后端会按周期重新聚合 used，语义等价）。
 * R23：卡片标题 emoji 移除，改用 Lucide 图标（Target / PieChart）。
 * R24：分类硬编码 8 项改查 category-dict 的 EXPENSE_CATEGORIES（渲染层不再直出 emoji）。
 */
import { useEffect, useMemo, useState } from 'react'
import {
  Button,
  Input,
  InputNumber,
  Select,
  Modal,
  Tag,
  Skeleton,
} from '@douyinfe/semi-ui'
import { Icon } from '@/components/icon'
import { useFinanceStore } from '@/stores/finance'
import { financeApi } from '@/api/finance'
import { CategoryBudgetItem } from './components/CategoryBudgetItem'
import CategoryPicker from '@/components/finance/CategoryPicker'
import ErrorState from '@/components/ErrorState'
import { EmptyHint } from '@/components/EmptyState'
import type {
  Budget,
  CreateBudgetReq,
  BudgetScope,
  BudgetPeriod,
  FinanceCategory,
} from '@/api/types'

/** 预算状态：over 超支 / warn 接近预算（≥ alert_threshold）/ ok 正常 */
function budgetStatus(b: Budget): 'over' | 'warn' | 'ok' {
  if (b.amount <= 0) return 'ok'
  const pct = b.used / b.amount
  if (pct >= 1) return 'over'
  if (pct >= (b.alert_threshold ?? 0.8)) return 'warn'
  return 'ok'
}

function barColor(b: Budget) {
  const s = budgetStatus(b)
  if (s === 'over') return 'var(--color-danger)'
  if (s === 'warn') return 'var(--color-warning)'
  return 'var(--color-success)'
}

export function BudgetTab() {
  const financeStore = useFinanceStore()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [budgetModalVisible, setBudgetModalVisible] = useState(false)
  const [editingBudget, setEditingBudget] = useState<Budget | null>(null)
  const [form, setForm] = useState<CreateBudgetReq>({
    name: '',
    period: 'monthly',
    amount: 0,
    alert_threshold: 0.8,
    scope: 'overall',
    category_id: null,
  })

  function load() {
    setLoading(true)
    setError(false)
    const probe = financeApi
      .listBudgets()
      .then(() => setError(false))
      .catch(() => setError(true))
    financeStore.fetchBudgets()
    probe.finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Separate budgets by scope
  const overallBudgets = useMemo(() =>
    financeStore.budgets.filter((b) => !b.scope || b.scope === 'overall'),
    [financeStore.budgets]
  )
  const categoryBudgets = useMemo(() =>
    financeStore.budgets.filter((b) => b.scope === 'category'),
    [financeStore.budgets]
  )

  function openCreateBudget(scope: BudgetScope = 'overall') {
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10)
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10)
    setEditingBudget(null)
    setForm({
      name: '',
      period: 'monthly',
      amount: 0,
      start_date: monthStart,
      end_date: monthEnd,
      alert_threshold: 0.8,
      scope,
    })
    setBudgetModalVisible(true)
  }

  function openEditBudget(b: Budget) {
    setEditingBudget(b)
    setForm({
      name: b.name,
      period: b.period,
      amount: b.amount,
      start_date: b.start_date,
      end_date: b.end_date,
      alert_threshold: b.alert_threshold ?? 0.8,
      scope: b.scope ?? 'overall',
      category_id: b.category_id ?? null,
      category_name: b.category_name,
      category_emoji: b.category_emoji,
    })
    setBudgetModalVisible(true)
  }

  async function submitBudget() {
    if (!form.name.trim()) {
      Modal.error({ title: '请输入预算名称', content: '预算名称不能为空' })
      return
    }
    if (!form.amount || form.amount <= 0) {
      Modal.error({ title: '请输入预算金额', content: '预算金额必须大于 0' })
      return
    }
    const payload: CreateBudgetReq = { ...form, name: form.name.trim() }
    if (editingBudget) {
      // 无 update 端点：新建成功后删旧（新建失败则旧预算保留，不丢数据）
      const created = await financeStore.createBudget(payload)
      if (created) {
        await financeStore.removeBudget(editingBudget.id)
        setBudgetModalVisible(false)
      }
    } else {
      const created = await financeStore.createBudget(payload)
      if (created) setBudgetModalVisible(false)
    }
  }

  function onDeleteBudget(b: Budget) {
    Modal.confirm({
      title: '删除预算',
      content: `确认删除「${b.name}」？`,
      okText: '删除',
      okButtonProps: { type: 'danger', theme: 'solid' },
      cancelText: '取消',
      onOk: async () => {
        await financeStore.removeBudget(b.id)
      },
    })
  }

  const scope = form.scope ?? 'overall'
  const showError = error && !loading && financeStore.budgets.length === 0

  if (showError) {
    return (
      <div className="budget-tab">
        <ErrorState compact message="预算加载失败，请重试" onRetry={load} />
      </div>
    )
  }

  return (
    <div className="budget-tab">
      {/* Overall Budgets */}
      <div style={{ marginBottom: 24 }}>
        <div className="card-head" style={{ marginBottom: 12 }}>
          <span className="card-title"><Icon name="Target" size={16} style={{ marginRight: 6 }} />总预算</span>
          <Button theme="light" type="secondary" size="small" icon={<Icon name="PlusCircle" size={16} />} onClick={() => openCreateBudget('overall')} style={{ marginLeft: 'auto' }}>新建总预算</Button>
        </div>
        {loading && overallBudgets.length === 0 ? (
          <div className="skeleton-wrap"><Skeleton><Skeleton.Paragraph rows={2} /></Skeleton></div>
        ) : overallBudgets.length > 0 ? (
          <div className="budget-list">
            {overallBudgets.map((b) => {
              const pct = b.amount > 0 ? Math.min(100, Math.round((b.used / b.amount) * 100)) : 0
              const color = barColor(b)
              const status = budgetStatus(b)
              return (
                <div key={b.id} className="budget-item">
                  <div className="budget-head">
                    <div className="budget-name">{b.name}</div>
                    <div className="budget-amounts">
                      <span style={{ color, fontWeight: 600 }}>¥{b.used.toFixed(0)}</span>
                      <span className="muted"> / ¥{b.amount.toFixed(0)}</span>
                      {status === 'over' && <Tag style={{ background: 'var(--color-danger-light)', color: 'var(--color-danger-dark)', border: 'none', marginLeft: 8, fontSize: 11 }}>已超支</Tag>}
                      {status === 'warn' && <Tag style={{ background: 'var(--color-warning-light)', color: 'var(--color-warning-dark)', border: 'none', marginLeft: 8, fontSize: 11 }}>接近预算</Tag>}
                    </div>
                  </div>
                  <div className="budget-bar">
                    <div className="budget-bar-fill" style={{ width: pct + '%', background: color }} />
                  </div>
                  <div className="budget-foot">
                    <span className="budget-pct" style={{ color }}>{pct}%</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <Button theme="borderless" type="tertiary" size="small" icon={<Icon name="Pencil" size={16} />} onClick={() => openEditBudget(b)} />
                      <Button theme="borderless" type="danger" size="small" icon={<Icon name="X" size={16} />} onClick={() => onDeleteBudget(b)} />
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <EmptyHint icon="Inbox" title="还没有总预算" />
        )}
      </div>

      {/* Category Budgets */}
      <div>
        <div className="card-head" style={{ marginBottom: 12 }}>
          <span className="card-title"><Icon name="PieChart" size={16} style={{ marginRight: 6 }} />分类预算</span>
          <Button theme="light" type="secondary" size="small" icon={<Icon name="PlusCircle" size={16} />} onClick={() => openCreateBudget('category')} style={{ marginLeft: 'auto' }}>新建分类预算</Button>
        </div>
        {loading && categoryBudgets.length === 0 ? (
          <div className="skeleton-wrap"><Skeleton><Skeleton.Paragraph rows={2} /></Skeleton></div>
        ) : categoryBudgets.length > 0 ? (
          <div className="budget-list">
            {categoryBudgets.map((b) => (
              <CategoryBudgetItem key={b.id} budget={b} onDelete={onDeleteBudget} onEdit={openEditBudget} />
            ))}
          </div>
        ) : (
          <EmptyHint icon="FolderOpen" title="还没有分类预算" desc="按消费类别设定预算上限" />
        )}
      </div>

      {/* Budget Modal（新建 / 编辑共用） */}
      <Modal
        visible={budgetModalVisible}
        onCancel={() => setBudgetModalVisible(false)}
        title={editingBudget ? '编辑预算' : scope === 'category' ? '新建分类预算' : '新建总预算'}
        width={480}
        okText={editingBudget ? '保存' : '创建'}
        cancelText="取消"
        onOk={submitBudget}
      >
        <div className="field">
          <label className="field-label">{scope === 'category' ? '分类' : '预算名称'}</label>
          {scope === 'category' ? (
            <CategoryPicker
              scope="expense"
              level1Only
              showCreate={false}
              value={form.category_id ?? undefined}
              onChange={(c: FinanceCategory) =>
                setForm((n) => ({
                  ...n,
                  category_id: c.id,
                  category_name: c.full_name,
                  category_emoji: c.emoji ?? undefined,
                  name: c.full_name,
                }))
              }
            />
          ) : (
            <Input value={form.name} onChange={(v) => setForm((n) => ({ ...n, name: v }))} placeholder="例如：7月总预算" maxLength={20} showClear />
          )}
        </div>
        <div className="field">
          <label className="field-label">预算金额</label>
          <InputNumber value={form.amount || 0} onChange={(v) => setForm((n) => ({ ...n, amount: parseFloat(String(v)) || 0 }))} placeholder="0.00" min={0} step={100} style={{ width: '100%' }} />
        </div>
        <div className="field">
          <label className="field-label">周期</label>
          <Select
            value={form.period}
            onChange={(v: any) => {
              const val = Array.isArray(v) ? v[0] : v
              setForm((n) => ({ ...n, period: val as BudgetPeriod }))
            }}
            optionList={[
              { value: 'monthly', label: '每月' },
              { value: 'weekly', label: '每周' },
              { value: 'yearly', label: '每年' },
            ]}
            style={{ width: '100%' }}
          />
        </div>
        <div className="field">
          <label className="field-label">预警阈值（达到该比例时提醒）</label>
          <InputNumber
            value={Math.round((form.alert_threshold ?? 0.8) * 100)}
            onChange={(v) => setForm((n) => ({ ...n, alert_threshold: (parseFloat(String(v)) || 0) / 100 }))}
            min={0}
            max={100}
            step={5}
            suffix="%"
            style={{ width: '100%' }}
          />
        </div>
      </Modal>
    </div>
  )
}

export default BudgetTab
