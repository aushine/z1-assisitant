/**
 * 分类字典 —— 四类分类的唯一来源（移动端）
 *
 * SYNC-FROM-DESKTOP: life-assisitant-ui-desktop/src/utils/category-dict.ts
 * 最后同步：2026-09-18
 *
 * 桌面端把每个分类的「图标 + 语义色」收敛为唯一真相，消灭了同一个分类
 * 在不同页面颜色/图标不一致的问题（如「学习 📚」在任务抽屉是深紫、
 * 在记账抽屉是浅紫）。移动端沿用同一套 id / label / emoji / tint / icon，
 * 图标本体也已完成对齐：移动端引入 `lucide-vue-next@0.300.0`
 * （与桌面端 lucide-react 同版本号），渲染层输出 `<Icon>` 而非 emoji。
 *
 * 使用方式：
 *   import { TASK_CATEGORIES, getTaskCategory } from '@/utils/category-dict'
 *   import Icon from '@/components/icon/Icon.vue'
 *
 *   <div :style="{ background: c.vars.bg, color: c.vars.fg }">
 *     <Icon :name="c.icon" :size="16" /><span>{{ c.label }}</span>
 *   </div>
 *
 * ⚠️ `emoji` 是**存储契约**字段：后端交易的 category_emoji、习惯的 icon、
 *    账户的 icon 直接存取这个 emoji。它不再用于渲染（渲染走 `icon`），
 *    但**改 emoji 等于改数据**，务必两端同步。
 *
 * ⚠️ 260922 分类实体化（spec-20260922-v2/04）后，本文件的习惯 / 任务两张表
 *    **降级为兜底显示表**（#52/53）：`getHabitCategory` / `getTaskCategory`
 *    先查 `stores/user-category`（store 优先），分类尚未拉回来时才查这里的
 *    常量 —— 所以旧常量**不许删**。收支（EXPENSE/INCOME）与账户两张表不受影响。
 */
import { getTint, type TintName, type TintVars } from '@/utils/tint'
import { getIconMapping } from '@/utils/icon-map'
import type { IconName } from '@/components/icon/names'
import { useUserCategoryStore, normalizeIconRef, DOMAIN_FALLBACK_ICON } from '@/stores/user-category'
import type { UserCategoryDomain } from '@/api/types'

export interface CategoryDef {
  /** 唯一 key：任务用 category_id（c_work…），习惯用 HabitCategory（sport…），收支用自定义 id */
  id: string
  /** 中文显示名 */
  label: string
  /** emoji —— 后端存储值（渲染层不再直出，见 `icon`） */
  emoji: string
  /** Lucide 图标名，配合 <Icon :name="..." /> 渲染 */
  icon: IconName
  /** 语义色名，配合 getTint() */
  tint: TintName
  /** 语义色解析结果（bg/fg），模板里可直接用 */
  vars: TintVars
  /** true = 用户分类已被软删（label 固定「已删除分类」+ 中性色，04 §3.3） */
  deleted?: boolean
  /** true = id 不在用户分类表里（异常数据）：label 为原 id + 中性色（04 §3.3） */
  unknown?: boolean
}

/** 内部构造：把 tint 名展开成可用的 bg/fg */
function def(
  id: string,
  label: string,
  emoji: string,
  icon: IconName,
  tint: TintName
): CategoryDef {
  return { id, label, emoji, icon, tint, vars: getTint(tint) }
}

// ==========================================================================
// 任务分类（6）—— id 与后端 Task.category_id 一致
// ==========================================================================
export const TASK_CATEGORIES: readonly CategoryDef[] = [
  def('c_work', '工作', '💼', 'Briefcase', 'primary'),
  def('c_study', '学习', '📚', 'BookOpen', 'accent'),
  def('c_life', '生活', '🏠', 'Home', 'success'),
  def('c_health', '健康', '💪', 'Dumbbell', 'success'),
  def('c_social', '社交', '👥', 'Users', 'accent'),
  def('c_other', '其他', '📌', 'Pin', 'neutral'),
]

// ==========================================================================
// 习惯分类（4）—— id 与后端 HabitCategory 一致（sport/diet/life/study）
// ==========================================================================
export const HABIT_CATEGORIES: readonly CategoryDef[] = [
  def('sport', '运动', '💪', 'Dumbbell', 'success'),
  def('diet', '饮食', '🍎', 'Apple', 'danger'),
  def('life', '生活', '🏠', 'Home', 'success'),
  def('study', '学习', '📚', 'BookOpen', 'accent'),
]

// ==========================================================================
// 支出分类（8）—— emoji 为后端存储值
// 注：不包含「转账」（transfer 是独立交易类型，非支出分类）。
// ==========================================================================
export const EXPENSE_CATEGORIES: readonly CategoryDef[] = [
  def('food', '餐饮', '🍱', 'Utensils', 'warning'),
  def('transit', '交通', '🚇', 'Route', 'primary'),
  def('shopping', '购物', '🛍️', 'ShoppingBag', 'danger'),
  def('fun', '娱乐', '🎬', 'Video', 'accent'),
  def('home', '居住', '🏠', 'Home', 'success'),
  def('medical', '医疗', '💊', 'HeartPulse', 'danger'),
  def('study', '学习', '📚', 'BookOpen', 'accent'),
  def('other_e', '其他', '📦', 'Package', 'neutral'),
]

// ==========================================================================
// 收入分类（4）
// ==========================================================================
export const INCOME_CATEGORIES: readonly CategoryDef[] = [
  def('salary', '工资', '💰', 'Banknote', 'success'),
  def('part', '兼职', '💼', 'Briefcase', 'primary'),
  def('invest', '投资', '📈', 'TrendingUp', 'success'),
  def('other_i', '其他', '💵', 'Banknote', 'neutral'),
]

// ==========================================================================
// 账户图标（14）—— 账户图标的**唯一真相**
//
// 桌面端曾把这段解析逻辑只写在 AccountManager 内部且未导出，导致统计页
// 只能绕过它直接调 getIconMapping，于是同一个账户在两个页面颜色不同
// （「现金 💰」记录页 neutral、统计页 danger）。移动端从第一天就收敛到字典。
// ==========================================================================

/** 账户图标定义：emoji 是后端 accounts.icon 的存储值 */
export interface AccountIconDef {
  /** emoji —— 后端存储值 */
  emoji: string
  label: string
  /** Lucide 图标名 */
  icon: IconName
  tint: TintName
  vars: TintVars
}

/**
 * 14 个账户预设图标。
 * 注意：icon-map 把「现金 💰」映射成 danger（那是**收支语境**的语义），
 * 但账户语境下现金应是中性色，故此处以 neutral 为准 —— 两者刻意不同。
 */
export const ACCOUNT_ICON_KEYS: readonly AccountIconDef[] = [
  def_account('🏦', '银行', 'Landmark', 'success'),
  def_account('💳', '信用卡', 'CreditCard', 'warning'),
  def_account('💙', '花呗', 'Wallet', 'accent'),
  def_account('💚', '微信零钱', 'MessageCircle', 'success'),
  def_account('💰', '现金', 'Banknote', 'neutral'),
  def_account('💵', '储蓄', 'PiggyBank', 'success'),
  def_account('💎', '资产', 'Gem', 'accent'),
  def_account('📊', '投资', 'BarChart3', 'primary'),
  def_account('🏠', '房产', 'Home', 'success'),
  def_account('🔒', '保险柜', 'Lock', 'neutral'),
  def_account('⚡', '快捷支付', 'Zap', 'warning'),
  def_account('📱', '手机支付', 'Smartphone', 'primary'),
  def_account('👤', '个人', 'User', 'accent'),
  def_account('🔑', '密钥', 'Key', 'warning'),
]

function def_account(
  emoji: string,
  label: string,
  icon: IconName,
  tint: TintName
): AccountIconDef {
  return { emoji, label, icon, tint, vars: getTint(tint) }
}

/**
 * 把后端存储的账户 emoji 反查成可渲染的语义色。
 * 命中 14 个已知图标用其 tint；历史 / 自定义 emoji 回退到 icon-map。
 *
 * 所有渲染账户图标的页面都应调用此函数，不要直接调 getIconMapping，
 * 否则同一账户在不同页面会出现不同颜色。
 */
export interface ResolvedAccountIcon {
  /** emoji —— 原样返回，便于调用方做「未命中字典」的判断 */
  emoji: string
  /** Lucide 图标名 */
  icon: IconName
  tint: TintName
  vars: TintVars
}

export function resolveAccountIcon(emoji: string): ResolvedAccountIcon {
  const hit = ACCOUNT_ICON_KEYS.find((k) => k.emoji === emoji)
  if (hit) return { emoji: hit.emoji, icon: hit.icon, tint: hit.tint, vars: hit.vars }
  const m = getIconMapping(emoji)
  return { emoji, icon: m.icon, tint: m.tint, vars: m.vars }
}

// ==========================================================================
// 查询辅助
// ==========================================================================

/**
 * 按 id 查任务分类 —— **store 优先、常量兜底**（spec-20260922-v2 #53）。
 *
 * - user-category store 该域已加载 → 返回 store 解析结果（含「已删除分类 /
 *   原 id + 中性」两种降级，04 §3.3）；
 * - store 未加载 → 查本文件的常量兜底表（旧内置，**不删** —— 分类未拉回来
 *   时列表要先有得渲染，数据到了由 Pinia 响应式替换）；
 * - 在组件 setup/render 里调用会建立响应式依赖（store 加载完成后自动重渲染）。
 */
export function getTaskCategory(id: string | undefined | null): CategoryDef | undefined {
  return categoryView('task', id) ?? (id ? TASK_CATEGORIES.find((c) => c.id === id) : undefined)
}

/** 按 id 查习惯分类 —— 规则同上（store 优先、常量兜底） */
export function getHabitCategory(id: string | undefined | null): CategoryDef | undefined {
  return categoryView('habit', id) ?? (id ? HABIT_CATEGORIES.find((c) => c.id === id) : undefined)
}

/** store 优先解析（在组件上下文之外调用时静默走兜底表） */
function categoryView(domain: UserCategoryDomain, id: string | undefined | null): CategoryDef | undefined {
  if (!id) return undefined
  try {
    const store = useUserCategoryStore()
    if (!store.loadedOnce[domain]) return undefined
    const r = store.resolveCategory(domain, id)
    if (!r) return undefined
    return {
      id: r.id,
      label: r.name,
      emoji: r.emoji ?? '',
      icon: r.icon,
      tint: r.tint,
      vars: r.vars,
      deleted: r.deleted,
      unknown: r.unknown,
    }
  } catch {
    // 组件上下文之外（如模块顶层求值）拿不到 Pinia：按未加载处理
    return undefined
  }
}

/** 图标解析结果（04 §4.2 优先级链的产物，列表 / 卡片直接拿去渲染） */
export interface ResolvedIconView {
  icon: IconName
  tint: TintName
  vars: TintVars
}

/**
 * 习惯图标视图：`habits.icon`（存量可为 emoji）> 分类.icon > 分类.emoji > lucide:Pin。
 * 分类 store 未加载时走常量兜底表，渲染先不空，数据到了 Pinia 触发替换。
 */
export function resolveHabitIconView(
  habit: { icon?: string; category?: string },
): ResolvedIconView {
  const ref = normalizeIconRef(habit.icon)
  if (ref) {
    const tint = ref.tint ?? categoryView('habit', habit.category)?.tint
      ?? getHabitCategory(habit.category)?.tint ?? 'neutral'
    return { icon: ref.icon, tint, vars: getTint(tint) }
  }
  const cat = categoryView('habit', habit.category) ?? getHabitCategory(habit.category)
  if (cat) return { icon: cat.icon, tint: cat.tint, vars: cat.vars }
  return { icon: DOMAIN_FALLBACK_ICON.habit, tint: 'neutral', vars: getTint('neutral') }
}

/**
 * 任务图标视图：`tasks.icon`（新列，可空）> 分类.icon > 分类.emoji > lucide:CircleDashed。
 */
export function resolveTaskIconView(
  task: { icon?: string; category_id?: string | null },
): ResolvedIconView {
  const ref = normalizeIconRef(task.icon)
  if (ref) {
    const tint = ref.tint ?? categoryView('task', task.category_id)?.tint
      ?? getTaskCategory(task.category_id)?.tint ?? 'neutral'
    return { icon: ref.icon, tint, vars: getTint(tint) }
  }
  const cat = categoryView('task', task.category_id) ?? getTaskCategory(task.category_id)
  if (cat) return { icon: cat.icon, tint: cat.tint, vars: cat.vars }
  return { icon: DOMAIN_FALLBACK_ICON.task, tint: 'neutral', vars: getTint('neutral') }
}

/** 按 id 查支出分类 */
export function getExpenseCategory(id: string | undefined | null): CategoryDef | undefined {
  if (!id) return undefined
  return EXPENSE_CATEGORIES.find((c) => c.id === id)
}

/** 按 id 查收入分类 */
export function getIncomeCategory(id: string | undefined | null): CategoryDef | undefined {
  if (!id) return undefined
  return INCOME_CATEGORIES.find((c) => c.id === id)
}

/**
 * 按后端存储的 emoji 反查收支分类（记录页拿到运行时 emoji 时用）。
 * 优先在支出/收入里查，回退到任务/习惯。未命中返回 undefined。
 */
export function findCategoryByEmoji(emoji: string | undefined | null): CategoryDef | undefined {
  if (!emoji) return undefined
  return (
    EXPENSE_CATEGORIES.find((c) => c.emoji === emoji) ??
    INCOME_CATEGORIES.find((c) => c.emoji === emoji) ??
    TASK_CATEGORIES.find((c) => c.emoji === emoji) ??
    HABIT_CATEGORIES.find((c) => c.emoji === emoji)
  )
}

/** 按交易类型取对应分类表（transfer 无分类，返回空数组） */
export function categoriesByTransactionType(
  type: 'expense' | 'income' | 'transfer'
): readonly CategoryDef[] {
  if (type === 'expense') return EXPENSE_CATEGORIES
  if (type === 'income') return INCOME_CATEGORIES
  return []
}

/**
 * 把后端 emoji 解析成「可渲染分类」。
 * 未命中字典时返回一个降级对象（Package 图标 + neutral），
 * 保证列表项永远有图标有底色。
 */
export function resolveCategory(emoji: string | undefined | null): CategoryDef {
  const hit = findCategoryByEmoji(emoji)
  if (hit) return hit
  return def('__fallback__', '未分类', emoji || '📦', 'Package', 'neutral')
}
