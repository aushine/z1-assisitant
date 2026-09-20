/**
 * 统一图标组件（02 §8.1 / §8.3）。
 *
 * 注入光学补偿的 strokeWidth 默认值，并在开发期校验 size 是否落在 6 级标度内。
 *
 * 用法：
 *   <Icon name="Home" size={20} />           // 默认 strokeWidth 按标度注入
 *   <Icon name="Flame" size={24} strokeWidth={2} className="..." />
 */
import { forwardRef } from 'react'
import type { CSSProperties, Ref, SVGProps } from 'react'
import type { LucideIcon } from 'lucide-react'
import { ICONS } from './names'
import type { IconName } from './names'
import { ICON_SIZES, strokeWidthForSize } from './sizes'

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'ref'> {
  /** 图标名（来自 names.ts 注册表） */
  name: IconName
  /** 尺寸（px），仅允许 6 级标度数值：14/16/20/24/32/48 */
  size?: number
  /** 描边宽度，缺省时按光学补偿标度注入 */
  strokeWidth?: number
  className?: string
  style?: CSSProperties
}

function IconComponent(
  { name, size = 20, strokeWidth, className, style, ...rest }: IconProps,
  ref: Ref<SVGSVGElement>,
) {
  // 注册表以 as const 收窄，运行时可能被传入任意字符串，故做一次防御性查找
  const Cmp = (ICONS as Record<string, LucideIcon | undefined>)[name]

  if (import.meta.env.DEV && size !== undefined && !ICON_SIZES.includes(size)) {
    // 02 §4.2：只允许 6 个数值，越界在开发期告警
    console.warn(
      `[icon] size ${size} 不在 6 级标度内（${ICON_SIZES.join(' / ')}），请使用其中之一`,
    )
  }

  if (!Cmp) {
    if (import.meta.env.DEV) {
      console.warn(`[icon] 未知图标名 "${String(name)}"，已降级为 HelpCircle`)
    }
    const Fallback: LucideIcon = ICONS.HelpCircle
    const fbSize = size ?? 20
    return (
      <Fallback
        ref={ref}
        size={fbSize}
        strokeWidth={strokeWidth ?? strokeWidthForSize(fbSize)}
        className={className}
        style={style}
        {...rest}
      />
    )
  }

  return (
    <Cmp
      ref={ref}
      size={size}
      strokeWidth={strokeWidth ?? strokeWidthForSize(size)}
      className={className}
      style={style}
      {...rest}
    />
  )
}

const Icon = forwardRef(IconComponent)
Icon.displayName = 'Icon'

export default Icon
