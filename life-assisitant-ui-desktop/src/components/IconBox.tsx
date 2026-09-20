/**
 * 彩色圆 + 图标（02 §8.2）。
 *
 * 从「任意 bg/fg hex」收敛为 6 组 --tint-* 语义色：
 *   <IconBox icon={BookOpen} tint="accent" size={40} />
 *
 * 兼容期保留 bg/fg 字符串透传，用于数据驱动的颜色（如习惯自定义色），
 * 新代码应优先使用 tint。
 */
import type { CSSProperties, ComponentType } from 'react'
import { TINT_VARS } from '@/components/icon/tints'
import type { TintName } from '@/components/icon/tints'
import { strokeWidthForSize } from '@/components/icon/sizes'

/** 图标盒允许的尺寸（02 §8.2：32 / 40 / 48 三档） */
export type IconBoxSize = 32 | 40 | 48

interface IconBoxProps {
  /** 图标组件（Lucide 图标；兼容期也接受 Semi 图标） */
  icon: ComponentType<any>
  /** 语义色（优先），默认 neutral */
  tint?: TintName
  /** 背景色透传（数据驱动颜色用），优先用 tint */
  bg?: string
  /** 前景色透传（数据驱动颜色用），优先用 tint */
  fg?: string
  /** 圆直径（px），默认 40，允许 32 / 40 / 48 */
  size?: IconBoxSize | number
  /** 图标尺寸（px），默认取 size 的一半，落入 §4 标度 */
  iconSize?: number
  /** 描边宽度，默认按光学补偿标度注入 */
  strokeWidth?: number
  /** 附加类名 */
  className?: string
  /** 附加内联样式 */
  style?: CSSProperties
}

const DEFAULT_SIZE = 40

export default function IconBox({
  icon: Icon,
  tint = 'neutral',
  bg,
  fg,
  size = DEFAULT_SIZE,
  iconSize,
  strokeWidth,
  className,
  style,
}: IconBoxProps) {
  const resolvedIconSize = iconSize ?? Math.round(size / 2)
  const resolvedStrokeWidth = strokeWidth ?? strokeWidthForSize(resolvedIconSize)

  const tv = TINT_VARS[tint]
  const bgValue = bg ?? tv.bg
  const fgValue = fg ?? tv.fg

  // 圆角契约（01 §7.4）：<32 → 4px，32–44 → 8px，≥44 → 10px。
  // tokens.scss 已保值重命名为 xs=4 / sm=6 / md=8 / lg=10，故直接对齐到对应令牌。
  const radiusVar = size < 32 ? 'var(--radius-xs)' : size >= 44 ? 'var(--radius-lg)' : 'var(--radius-md)'

  return (
    <div
      className={className}
      style={{
        width: size,
        height: size,
        borderRadius: radiusVar,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: bgValue,
        color: fgValue,
        flexShrink: 0,
        ...style,
      }}
    >
      <Icon
        size={resolvedIconSize}
        strokeWidth={resolvedStrokeWidth}
        style={{ color: fgValue }}
      />
    </div>
  )
}
