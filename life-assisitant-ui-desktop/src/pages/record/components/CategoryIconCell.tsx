/**
 * CategoryIconCell — 交易列表「类别」单元格（R10 / R13 / B08）。
 *
 * ⭐ 升级：props 从「emoji + name」改为「category_id + name + emoji 兜底」，
 * 渲染按 **id 优先、快照兜底**（05 §3）：
 *   - 有 category_id 且命中 → 用分类的 icon / tint / name（icon/tint 空则继承父级）；
 *   - 命中但已删除 → 中性灰渲染（不在列表里标注「已删除」，避免噪音）；
 *   - 未命中 / 无 id → 退到快照 category_name + category_emoji。
 */
import { Icon, TINT_VARS } from '@/components/icon'
import { useFinanceCategoryStore, resolveCategoryView } from '@/stores/financeCategory'

interface Props {
  /** 分类 id（优先，按 id 渲染） */
  categoryId?: string | null
  /** 快照名（兜底） */
  categoryName?: string
  /** 快照 emoji（兜底） */
  categoryEmoji?: string
}

export function CategoryIconCell({ categoryId, categoryName, categoryEmoji }: Props) {
  const flat = useFinanceCategoryStore((s) => s.flat)
  const v = resolveCategoryView(
    { category_id: categoryId, category_name: categoryName, category_emoji: categoryEmoji },
    flat,
  )
  return (
    <div className="col-cat">
      <span className="cat-emoji" style={{ background: TINT_VARS[v.tint].bg, color: TINT_VARS[v.tint].fg }}>
        <Icon name={v.icon} size={16} style={{ color: TINT_VARS[v.tint].fg }} />
      </span>
      <span>{v.name}</span>
    </div>
  )
}

export default CategoryIconCell
