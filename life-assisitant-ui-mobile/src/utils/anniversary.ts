/**
 * 纪念日 / 倒数日 · 展示层工具（移动端）
 *
 * SYNC-FROM-DESKTOP: life-assisitant-ui-desktop/src/utils/anniversary.ts
 * 契约：md/spec-20260919-v1/06-个人中心与纪念日.md
 *
 * ⚠️ 本文件**只做展示**，不做任何日期推导 ——
 *    next_date / days_left 是后端实时算的（utility/anniversary_next.go），
 *    前端自己算会在 2 月 29 日 / 31 日 / 跨月边界上与后端不一致。
 */
import { ICONS, type IconName } from '@/components/icon/names'
import type {
  AnniversaryCategory,
  AnniversaryRepeatRule,
} from '@/api/types'

/**
 * 后端存的图标 key → IconName。
 * ⚠️ 后端 icon 列是自由字符串（默认 'calendar-heart' 这类 kebab 名，
 *    与前端 lucide 的 PascalCase 名不是一套），且用户可以填任意值，
 *    所以必须**校验存在性**再传给 <Icon> —— 否则图标会整块消失。
 * 不存在时回落到分类默认图标。
 */
export function iconNameOf(raw: string | undefined, fallback: IconName): IconName {
  if (raw && raw in ICONS) return raw as IconName
  return fallback
}

/** 重复规则 → 文案 */
export function repeatLabel(rule: AnniversaryRepeatRule | number): string {
  switch (rule) {
    case 1:
      return '不重复'
    case 2:
      return '每年'
    case 3:
      return '每月'
    case 4:
      return '每周'
    default:
      return '每年'
  }
}

/**
 * 倒计时文案。
 * 0 = 就是今天；>0 = 还有 N 天；<0 = 已过 N 天（不重复项后端会过滤掉，
 * 所以这里主要兜住「列表已拉出来但时间跨过了零点」的情况）。
 */
export function daysLeftText(days: number): string {
  if (days === 0) return '就是今天'
  if (days > 0) return `还有 ${days} 天`
  return `已过 ${Math.abs(days)} 天`
}

/** 是否「最近」（首页卡片的高亮条件） */
export function isToday(days: number): boolean {
  return days === 0
}

export interface CategoryMeta {
  label: string
  /** 图标名（lucide，须存在于 components/icon/names.ts） */
  icon: IconName
  /** 配色 key（= TintName） */
  color: string
}

const CATEGORY_MAP: Record<AnniversaryCategory, CategoryMeta> = {
  birthday: { label: '生日', icon: 'Sparkles', color: 'accent' },
  anniversary: { label: '纪念日', icon: 'Calendar', color: 'primary' },
  countdown: { label: '倒数日', icon: 'Clock', color: 'warning' },
  other: { label: '其他', icon: 'Sun', color: 'neutral' },
}

/** 分类 → 展示元信息；未知分类回落 other（后端新增枚举时前端不崩） */
export function categoryMeta(c: AnniversaryCategory | string): CategoryMeta {
  return CATEGORY_MAP[c as AnniversaryCategory] ?? CATEGORY_MAP.other
}

/** 图标：用户选的优先，非法/缺失时回落分类默认 */
export function iconOf(raw: string | undefined, category: AnniversaryCategory | string): IconName {
  return iconNameOf(raw, categoryMeta(category).icon)
}

/** 提前提醒 → 文案（空 = 不提醒） */
export function remindText(days: number[]): string {
  if (!days || days.length === 0) return '不提醒'
  return days
    .slice()
    .sort((a, b) => b - a)
    .map((d) => (d === 0 ? '当天' : `${d} 天前`))
    .join('、')
}
