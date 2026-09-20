/**
 * 分类字典 —— 四类分类的唯一来源（02 §8.4 的合并目标，B05）。
 *
 * 此前同一个分类（如「学习 📚」）散落在多个文件里各自定义颜色，导致
 * 任务抽屉里是深紫、记账抽屉里是浅紫。此处收敛为唯一真相：
 * 每个分类在任何地方都是同一个图标（icon）+ 同一个语义色（tint）。
 *
 * 使用方式（业务代码只从这里查字典，不再本地定义）：
 *
 *   import { TASK_CATEGORIES, getTaskCategory } from '@/utils/category-dict'
 *   import { Icon, TINT_VARS } from '@/components/icon'
 *
 *   {TASK_CATEGORIES.map((c) => (
 *     <div style={{ background: TINT_VARS[c.tint].bg, color: TINT_VARS[c.tint].fg }}>
 *       <Icon name={c.icon} size={20} />
 *       <span>{c.label}</span>
 *     </div>
 *   ))}
 *
 * `emoji` 字段仅用于兼容后端存储（如交易的 category_emoji、习惯的 icon），
 * 渲染层一律用 `icon` + `tint`，不再直出 emoji。
 */
import { ICONS } from '@/components/icon'
import type { IconName, TintName, LucideIcon } from '@/components/icon'
import { getIconMapping } from '@/utils/icon-map'

export interface CategoryDef {
  /** 唯一 key：任务用 category_id（c_work…），习惯用 HabitCategory（sport…），收支用自定义 id */
  id: string
  /** 中文显示名 */
  label: string
  /** 兼容后端存储的 emoji（渲染层不使用，仅写库/查库用） */
  emoji: string
  /** Lucide 图标名（配合 <Icon name={...} />） */
  icon: IconName
  /** 语义色（配合 TINT_VARS[tint].bg / .fg） */
  tint: TintName
}

// ==========================================================================
// 任务分类（6）—— id 与后端 Task.category_id 一致
// ==========================================================================
export const TASK_CATEGORIES: readonly CategoryDef[] = [
  { id: 'c_work',   label: '工作', emoji: '💼', icon: 'Briefcase', tint: 'primary' },
  { id: 'c_study',  label: '学习', emoji: '📚', icon: 'BookOpen',  tint: 'accent' },
  { id: 'c_life',   label: '生活', emoji: '🏠', icon: 'Home',      tint: 'success' },
  { id: 'c_health', label: '健康', emoji: '💪', icon: 'Dumbbell',  tint: 'success' },
  { id: 'c_social', label: '社交', emoji: '👥', icon: 'Users',     tint: 'accent' },
  { id: 'c_other',  label: '其他', emoji: '📌', icon: 'Pin',       tint: 'neutral' },
]

// ==========================================================================
// 习惯分类（4）—— id 与后端 HabitCategory 一致（sport/diet/life/study）
// ==========================================================================
export const HABIT_CATEGORIES: readonly CategoryDef[] = [
  { id: 'sport', label: '运动', emoji: '💪', icon: 'Dumbbell', tint: 'success' },
  { id: 'diet',  label: '饮食', emoji: '🍎', icon: 'Apple',    tint: 'danger' },
  { id: 'life',  label: '生活', emoji: '🏠', icon: 'Home',     tint: 'success' },
  { id: 'study', label: '学习', emoji: '📚', icon: 'BookOpen', tint: 'accent' },
]

// ==========================================================================
// 支出分类（8）—— id 用于抽屉选择器；emoji 为后端存储值
// 注：不包含「转账」（transfer 是独立的交易类型，非支出分类）。
// ==========================================================================
export const EXPENSE_CATEGORIES: readonly CategoryDef[] = [
  { id: 'food',     label: '餐饮', emoji: '🍱', icon: 'Utensils',    tint: 'warning' },
  { id: 'transit',  label: '交通', emoji: '🚇', icon: 'Route',       tint: 'primary' },
  { id: 'shopping', label: '购物', emoji: '🛍️', icon: 'ShoppingBag', tint: 'danger' },
  { id: 'fun',      label: '娱乐', emoji: '🎬', icon: 'Video',       tint: 'accent' },
  { id: 'home',     label: '居住', emoji: '🏠', icon: 'Home',        tint: 'success' },
  { id: 'medical',  label: '医疗', emoji: '💊', icon: 'HeartPulse',  tint: 'danger' },
  { id: 'study',    label: '学习', emoji: '📚', icon: 'BookOpen',    tint: 'accent' },
  { id: 'other_e',  label: '其他', emoji: '📦', icon: 'Package',     tint: 'neutral' },
]

// ==========================================================================
// 收入分类（4）
// ==========================================================================
export const INCOME_CATEGORIES: readonly CategoryDef[] = [
  { id: 'salary',  label: '工资', emoji: '💰', icon: 'Banknote',   tint: 'success' },
  { id: 'part',    label: '兼职', emoji: '💼', icon: 'Briefcase',  tint: 'primary' },
  { id: 'invest',  label: '投资', emoji: '📈', icon: 'TrendingUp', tint: 'success' },
  { id: 'other_i', label: '其他', emoji: '💵', icon: 'Banknote',   tint: 'neutral' },
]

// ==========================================================================
// 账户图标（R19/R29：ACCOUNT_ICONS 的 14 个 emoji → 图标 key）
//
// ⚠️ 这里是账户图标的**唯一真相**。此前解析逻辑只存在于
// `pages/record/components/AccountManager.tsx` 内部（未导出），统计页的
// 账户汇总表只能绕过它直接调 `getIconMapping`，于是**同一个账户在两个页面
// 颜色不同** —— 例如「现金 💰」在记录页是 neutral 中性色，在统计页被
// icon-map 映射成 danger 红。这正是 B05 要消灭的那类问题。
// 现收敛到字典：所有页面一律走 `resolveAccountIcon`。
// ==========================================================================

/** 账户图标定义：emoji 是后端 accounts.icon 的存储值，icon/tint 是渲染层用的语义色 */
export interface AccountIconDef {
  emoji: string
  label: string
  icon: IconName
  tint: TintName
}

/**
 * 14 个账户图标。注：icon-map 把「现金 💰」映射成 danger，但账户语境下现金
 * 应是中性色，故此处以 neutral 为准（与 icon-map 的收支语义刻意不同）。
 */
export const ACCOUNT_ICON_KEYS: readonly AccountIconDef[] = [
  { emoji: '🏦', label: '银行',     icon: 'Landmark',       tint: 'success' },
  { emoji: '💳', label: '信用卡',   icon: 'CreditCard',     tint: 'warning' },
  { emoji: '💙', label: '花呗',     icon: 'Wallet',         tint: 'accent' },
  { emoji: '💚', label: '微信零钱', icon: 'MessageCircle',  tint: 'success' },
  { emoji: '💰', label: '现金',     icon: 'Banknote',       tint: 'neutral' },
  { emoji: '💵', label: '储蓄',     icon: 'PiggyBank',      tint: 'success' },
  { emoji: '💎', label: '资产',     icon: 'Gem',            tint: 'accent' },
  { emoji: '📊', label: '投资',     icon: 'BarChart3',      tint: 'primary' },
  { emoji: '🏠', label: '房产',     icon: 'Home',           tint: 'success' },
  { emoji: '🔒', label: '保险柜',   icon: 'Lock',           tint: 'neutral' },
  { emoji: '⚡', label: '快捷支付', icon: 'Zap',            tint: 'warning' },
  { emoji: '📱', label: '手机支付', icon: 'Smartphone',     tint: 'primary' },
  { emoji: '👤', label: '个人',     icon: 'User',           tint: 'accent' },
  { emoji: '🔑', label: '密钥',     icon: 'Key',            tint: 'warning' },
]

/**
 * 把后端存储的账户 emoji 反查成可渲染的 Lucide 组件 + 语义色。
 * 命中 14 个已知图标用其 tint；历史 / 自定义 emoji 回退到 icon-map
 * （未命中会降级 HelpCircle 并在开发期告警）。
 *
 * 所有渲染账户图标的页面都应调用此函数，不要直接调 getIconMapping，
 * 否则同一账户在不同页面会出现不同颜色。
 */
export function resolveAccountIcon(emoji: string): { icon: LucideIcon; tint: TintName } {
  const hit = ACCOUNT_ICON_KEYS.find((k) => k.emoji === emoji)
  if (hit) return { icon: ICONS[hit.icon], tint: hit.tint }
  const m = getIconMapping(emoji)
  return { icon: m.icon, tint: m.tint }
}

// ==========================================================================
// 查询辅助
// ==========================================================================

/** 按 id 查任务分类 */
export function getTaskCategory(id: string | undefined): CategoryDef | undefined {
  return TASK_CATEGORIES.find((c) => c.id === id)
}

/** 按 id 查习惯分类 */
export function getHabitCategory(id: string | undefined): CategoryDef | undefined {
  return HABIT_CATEGORIES.find((c) => c.id === id)
}

/** 按 id 查支出分类 */
export function getExpenseCategory(id: string | undefined): CategoryDef | undefined {
  return EXPENSE_CATEGORIES.find((c) => c.id === id)
}

/** 按 id 查收入分类 */
export function getIncomeCategory(id: string | undefined): CategoryDef | undefined {
  return INCOME_CATEGORIES.find((c) => c.id === id)
}

/**
 * 按后端存储的 emoji 反查收支分类（供记录页列表渲染运行时 emoji 时使用，B09）。
 * 优先在支出/收入里查，回退到任务/习惯。未命中返回 undefined。
 */
export function findCategoryByEmoji(emoji: string): CategoryDef | undefined {
  return (
    EXPENSE_CATEGORIES.find((c) => c.emoji === emoji) ??
    INCOME_CATEGORIES.find((c) => c.emoji === emoji) ??
    TASK_CATEGORIES.find((c) => c.emoji === emoji) ??
    HABIT_CATEGORIES.find((c) => c.emoji === emoji)
  )
}
