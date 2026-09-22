/**
 * CategoryBudgetItem — 分类预算条目。
 *
 * ⭐ 升级：分类图标改按 `budget.category_id` 渲染（id 优先、快照兜底），
 * 不再按 emoji 比对（05 §3）。删除图标用 Lucide X。
 */
import { Button, Tag } from '@douyinfe/semi-ui'
import { Icon, TINT_VARS } from '@/components/icon'
import { useFinanceCategoryStore, resolveCategoryView } from '@/stores/financeCategory'
import type { Budget } from '@/api/types'

interface Props {
  budget: Budget
  onDelete: (b: Budget) => void
  onEdit: (b: Budget) => void
}

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

export function CategoryBudgetItem({ budget, onDelete, onEdit }: Props) {
  const flat = useFinanceCategoryStore((s) => s.flat)
  const pct = budget.amount > 0 ? Math.min(100, Math.round((budget.used / budget.amount) * 100)) : 0
  const color = barColor(budget)
  const status = budgetStatus(budget)
  const cat = resolveCategoryView(
    {
      category_id: budget.category_id,
      category_name: budget.category_name,
      category_emoji: budget.category_emoji,
    },
    flat,
  )

  return (
    <div className="budget-item category-budget-item">
      <div className="budget-head">
        <div className="budget-name">
          <span
            className="cat-emoji"
            style={{ marginRight: 6, background: TINT_VARS[cat.tint].bg, color: TINT_VARS[cat.tint].fg }}
          >
            <Icon name={cat.icon} size={14} />
          </span>
          {cat.name || budget.name}
        </div>
        <div className="budget-amounts">
          <span style={{ color, fontWeight: 600 }}>¥{budget.used.toFixed(0)}</span>
          <span className="muted"> / ¥{budget.amount.toFixed(0)}</span>
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
          <Button theme="borderless" type="tertiary" size="small" icon={<Icon name="Pencil" size={16} />} onClick={() => onEdit(budget)} />
          <Button theme="borderless" type="danger" size="small" icon={<Icon name="X" size={16} />} onClick={() => onDelete(budget)} />
        </div>
      </div>
    </div>
  )
}

export default CategoryBudgetItem
