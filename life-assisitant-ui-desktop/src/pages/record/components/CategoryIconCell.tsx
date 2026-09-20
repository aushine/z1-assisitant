/**
 * CategoryIconCell — 交易列表「类别」单元格（R10 / R13 / B08）。
 *
 * 后端交易的 category_emoji 是 emoji 字符串，渲染层一律不直出 emoji，
 * 而是经 category-dict 反查 icon+tint；查不到则降级 HelpCircle + neutral（B12 兜底）。
 */
import { Icon, TINT_VARS } from '@/components/icon'
import { findCategoryByEmoji } from '@/utils/category-dict'

interface Props {
  emoji: string
  name: string
}

export function CategoryIconCell({ emoji, name }: Props) {
  const c = findCategoryByEmoji(emoji)
  const tint = c?.tint ?? 'neutral'
  const icon = c?.icon ?? 'HelpCircle'
  return (
    <div className="col-cat">
      <span className="cat-emoji" style={{ background: TINT_VARS[tint].bg, color: TINT_VARS[tint].fg }}>
        <Icon name={icon} size={16} style={{ color: TINT_VARS[tint].fg }} />
      </span>
      <span>{name}</span>
    </div>
  )
}

export default CategoryIconCell
