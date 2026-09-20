/**
 * Emoji → 图标 + 语义色（tint）映射（移动端）
 *
 * SYNC-FROM-DESKTOP: life-assisitant-ui-desktop/src/utils/icon-map.ts
 *                    life-assisitant-ui-desktop/src/components/icon/tints.ts
 * 最后同步：2026-09-18（本次补齐 `icon` 字段，图标本体与桌面端对齐）
 *
 * 本表是历史 / 自定义 emoji 的兜底解析：后端存了哪些 emoji，渲染时就要
 * 给它一个图标和一个语义色。业务分类请优先查 `category-dict`（那里是唯一真相）。
 *
 * 与桌面端逐条一致，包括桌面端做过的语义纠错：
 *   💧 喝水原为 Flag → 现 Droplet + primary
 *   🔥 连续天数原为 Activity → 现 Flame + warning
 *   💤 睡眠原为 Alarm（语义相反）→ 现 Moon + accent
 *   🏦 储蓄原为 CreditCard → 现 Landmark + success
 *
 * 用法：
 *   import { getIconMapping } from '@/utils/icon-map'
 *   const { icon, tint, vars } = getIconMapping('💧')  // icon='Droplet', tint='primary'
 *   <Icon :name="icon" :size="16" :style="{ color: vars.fg }" />
 */
import { getTint, type TintName, type TintVars } from '@/utils/tint'
import type { IconName } from '@/components/icon/names'

export interface IconMapping {
  /** Lucide 图标名，配合 <Icon :name="..." /> */
  icon: IconName
  /** 语义色名 */
  tint: TintName
  /** 语义色解析结果（bg/fg），模板里可直接用 */
  vars: TintVars
  /** 兼容字段：tint 派生的背景色（CSS 变量字符串） */
  bg: string
  /** 兼容字段：tint 派生的前景色（CSS 变量字符串） */
  fg: string
}

function mapping(icon: IconName, tint: TintName): IconMapping {
  const vs = getTint(tint)
  return { icon, tint, vars: vs, bg: vs.bg, fg: vs.fg }
}

/**
 * emoji → 图标 + 语义色表。
 * 键与桌面端 EMOJI_ICON_MAP 完全一致，值也完全一致。
 */
export const EMOJI_ICON_MAP: Record<string, IconMapping> = {
  // ---- 任务分类（6）----
  '💼': mapping('Briefcase', 'primary'), // 工作
  '📚': mapping('BookOpen', 'accent'), // 学习
  '🏠': mapping('Home', 'success'), // 家庭
  '💪': mapping('Dumbbell', 'success'), // 运动
  '👥': mapping('Users', 'accent'), // 社交
  '📌': mapping('Pin', 'neutral'), // 其他

  // ---- KPI / 区块（8）----
  '📋': mapping('ListChecks', 'primary'), // 待办
  '🔥': mapping('Flame', 'warning'), // 连续天数
  '💰': mapping('Banknote', 'danger'), // 支出（收支语境；账户语境见 category-dict 的 neutral）
  '🏦': mapping('Landmark', 'success'), // 储蓄 / 储蓄卡
  '⚡': mapping('Zap', 'warning'), // 快捷
  '📊': mapping('BarChart3', 'primary'), // 统计
  '👤': mapping('User', 'accent'), // 用户
  '💳': mapping('CreditCard', 'warning'), // 信用卡

  // ---- 支出分类（7）----
  '🍱': mapping('Utensils', 'warning'), // 餐饮
  '🚇': mapping('Route', 'primary'), // 交通
  '🛍️': mapping('ShoppingBag', 'danger'), // 购物
  '🎬': mapping('Video', 'accent'), // 娱乐
  '💊': mapping('HeartPulse', 'danger'), // 医疗
  '📦': mapping('Package', 'neutral'), // 其他
  '🔄': mapping('RefreshCw', 'accent'), // 订阅

  // ---- 收入分类（2）----
  '📈': mapping('TrendingUp', 'success'), // 投资
  '💵': mapping('Banknote', 'neutral'), // 现金

  // ---- 习惯图标（13）----
  '💧': mapping('Droplet', 'primary'), // 喝水
  '🏃': mapping('Footprints', 'success'), // 跑步
  '🧘': mapping('Sparkles', 'accent'), // 冥想
  '🍎': mapping('Apple', 'danger'), // 饮食
  '💤': mapping('Moon', 'accent'), // 睡眠
  // 移动端独有：习惯图标选择器（HabitEditSheet）的预设里有 '😴'（睡着的脸），
  // 与 '💤' 是同一语义的两个 emoji。桌面端选择器不用这个码点，故仅移动端补齐。
  '😴': mapping('Moon', 'accent'), // 睡眠（变体）
  '☕': mapping('Coffee', 'warning'), // 咖啡
  '🎯': mapping('Target', 'danger'), // 目标
  '✍️': mapping('PenLine', 'primary'), // 写作
  '🚴': mapping('Bike', 'success'), // 骑行
  '🎨': mapping('Palette', 'accent'), // 创作
  '🎵': mapping('Music', 'warning'), // 音乐
  '🧹': mapping('Brush', 'primary'), // 家务
  '🌱': mapping('Sprout', 'success'), // 成长

  // ---- 账户预设（2）----
  '💙': mapping('Wallet', 'accent'), // 花呗
  '💚': mapping('MessageCircle', 'success'), // 微信零钱

  // ---- 其他 / 通用（13）----
  '👋': mapping('Sun', 'warning'), // 问候
  '🔒': mapping('Lock', 'neutral'), // 锁定
  '🧭': mapping('Compass', 'primary'), // 探索
  '👑': mapping('Crown', 'warning'), // 管理员
  '✏️': mapping('Pencil', 'success'), // 编辑
  '👁': mapping('Eye', 'accent'), // 可见
  '🔑': mapping('Key', 'warning'), // 密钥
  '📱': mapping('Smartphone', 'primary'), // 通知
  '➕': mapping('PlusCircle', 'primary'), // 新建
  '💎': mapping('Gem', 'accent'), // 会员 / 等级
  '🏆': mapping('Trophy', 'warning'), // 成就
  '⚡️': mapping('Zap', 'warning'), // 精力（带变体选择符，与上方 '⚡' 是两个不同码点）
  '❓': mapping('HelpCircle', 'neutral'), // 未知（兜底）
}

/** 兜底映射：未知 emoji → 问号图标 + 中性色 */
const FALLBACK_MAPPING: IconMapping = mapping('HelpCircle', 'neutral')

/** 已告警过的 emoji，避免控制台刷屏（开发期 warn 一次） */
const warnedMissing = new Set<string>()

/**
 * 获取 emoji 对应的图标 + 语义色映射。
 * 未命中时降级为「问号 + 中性色」，并在开发期 console.warn 一次。
 */
export function getIconMapping(emoji: string): IconMapping {
  const hit = EMOJI_ICON_MAP[emoji]
  if (hit) return hit
  if (import.meta.env.DEV && !warnedMissing.has(emoji)) {
    warnedMissing.add(emoji)
    // eslint-disable-next-line no-console
    console.warn(`[icon-map] 未映射的 emoji "${emoji}" 已降级为 HelpCircle（中性色）`)
  }
  return FALLBACK_MAPPING
}

/** 快捷取语义色名 */
export function tintOf(emoji: string | undefined | null): TintName {
  if (!emoji) return 'neutral'
  return getIconMapping(emoji).tint
}

/** 快捷取图标名 */
export function iconOf(emoji: string | undefined | null): IconName {
  return getIconMapping(emoji ?? '').icon
}
