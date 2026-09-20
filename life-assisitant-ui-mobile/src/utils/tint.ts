/**
 * Tint · 语义色 6 组（移动端）
 *
 * SYNC-FROM-DESKTOP: life-assisitant-ui-desktop/src/components/icon/tints.ts
 * 契约变更时必须同步更新本文件与桌面端。最后同步：2026-09-18
 *
 * 桌面端把「任意 bg/fg hex」收敛为 6 组语义色，本文件是移动端的同源实现。
 * 差异只有一处：桌面端返回 lucide 图标组件，移动端只返回 CSS 变量字符串
 * （移动端图标沿用 emoji，不引入 lucide —— 见 md/移动端移植方案.md §3.4）。
 *
 * 变量定义在 `src/styles/tokens.scss`，全部别名到 `--color-*`，
 * **暗色下自动联动**，业务代码不要在这里再写 hex。
 *
 * 用法：
 *   import { TINT_VARS, getTint } from '@/utils/tint'
 *   :style="{ background: getTint('primary').bg, color: getTint('primary').fg }"
 */

/** 6 组语义色名 */
export type TintName = 'primary' | 'success' | 'warning' | 'danger' | 'accent' | 'neutral'

/** 顺序即 UI 展示优先级，勿随意调整 */
export const TINT_NAMES: readonly TintName[] = [
  'primary',
  'success',
  'warning',
  'danger',
  'accent',
  'neutral',
]

export interface TintVars {
  /** 底色（用于 background / background-color） */
  bg: string
  /** 前景色（用于 color / border-color） */
  fg: string
}

/**
 * tint 名 → CSS 变量字符串。
 * 注意值是 `var(--tint-*-bg)` 而非具体颜色 —— 交给浏览器在渲染时解析，
 * 这样主题切换（data-theme 变化）不需要重新计算 JS 侧的值。
 */
export const TINT_VARS: Record<TintName, TintVars> = {
  primary: { bg: 'var(--tint-primary-bg)', fg: 'var(--tint-primary-fg)' },
  success: { bg: 'var(--tint-success-bg)', fg: 'var(--tint-success-fg)' },
  warning: { bg: 'var(--tint-warning-bg)', fg: 'var(--tint-warning-fg)' },
  danger: { bg: 'var(--tint-danger-bg)', fg: 'var(--tint-danger-fg)' },
  accent: { bg: 'var(--tint-accent-bg)', fg: 'var(--tint-accent-fg)' },
  neutral: { bg: 'var(--tint-neutral-bg)', fg: 'var(--tint-neutral-fg)' },
}

/**
 * 按名取 tint，未知值回退 `neutral`。
 * 后端若出现新枚举值，前端不会崩，只是显示为中性色。
 */
export function getTint(name: TintName | string | undefined | null): TintVars {
  if (!name) return TINT_VARS.neutral
  return TINT_VARS[name as TintName] ?? TINT_VARS.neutral
}

/** 同 getTint，只取底色（高频场景：圆底 emoji 标签） */
export function tintBg(name: TintName | string | undefined | null): string {
  return getTint(name).bg
}

/** 同 getTint，只取前景色（高频场景：优先级圆点、状态文字） */
export function tintFg(name: TintName | string | undefined | null): string {
  return getTint(name).fg
}
