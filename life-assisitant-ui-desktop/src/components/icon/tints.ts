/**
 * 分类图标语义色（02 §5.2）。
 *
 * 原 icon-map.ts 有约 20 种 bg/fg 色对，收敛为 6 组语义色。
 * 每组别名到既有的 --color-* 令牌，暗色主题下随源令牌联动。
 *
 * 注意：设计文档中单个 Token 名（如 `--tint-primary`）实际需要 bg / fg 两个值，
 * 因此落地为 `--tint-{name}-bg` / `--tint-{name}-fg` 两个 CSS 变量（见 tokens.scss）。
 */

export type TintName = 'primary' | 'success' | 'warning' | 'danger' | 'accent' | 'neutral'

export interface TintVars {
  bg: string
  fg: string
}

export const TINT_NAMES: readonly TintName[] = [
  'primary',
  'success',
  'warning',
  'danger',
  'accent',
  'neutral',
]

/**
 * 静态字符串查找表（而非模板字符串拼接）。
 * 每个值都写成完整的 CSS 变量引用，便于审计脚本核对。
 */
export const TINT_VARS: Record<TintName, TintVars> = {
  primary: { bg: 'var(--tint-primary-bg)', fg: 'var(--tint-primary-fg)' },
  success: { bg: 'var(--tint-success-bg)', fg: 'var(--tint-success-fg)' },
  warning: { bg: 'var(--tint-warning-bg)', fg: 'var(--tint-warning-fg)' },
  danger: { bg: 'var(--tint-danger-bg)', fg: 'var(--tint-danger-fg)' },
  accent: { bg: 'var(--tint-accent-bg)', fg: 'var(--tint-accent-fg)' },
  neutral: { bg: 'var(--tint-neutral-bg)', fg: 'var(--tint-neutral-fg)' },
}
