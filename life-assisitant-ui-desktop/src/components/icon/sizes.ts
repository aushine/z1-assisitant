/**
 * 图标尺寸标度（02 §4）。
 *
 * 6 级标度 + 光学补偿：图标越大、描边越细，让不同尺寸图标的视觉重量守恒。
 * 业务代码只允许使用下表的 6 个数值（02 §4.2），禁止语义档位（small/large）。
 */

export interface IconScaleStep {
  size: number
  strokeWidth: number
}

export const ICON_SCALE = {
  xs: { size: 14, strokeWidth: 2.25 },
  sm: { size: 16, strokeWidth: 2 },
  md: { size: 20, strokeWidth: 1.75 },
  lg: { size: 24, strokeWidth: 1.75 },
  xl: { size: 32, strokeWidth: 1.5 },
  '2xl': { size: 48, strokeWidth: 1.25 },
} as const

export type IconScaleName = keyof typeof ICON_SCALE

/** 6 级标度允许的数值集合（02 §4.2） */
export const ICON_SIZES: readonly number[] = Object.values(ICON_SCALE).map((s) => s.size)

const SCALE_STEPS: readonly IconScaleStep[] = Object.values(ICON_SCALE)

/** 判断某个数值是否落在 6 级标度内 */
export function isIconSize(size: number): boolean {
  return ICON_SIZES.includes(size)
}

/**
 * 光学补偿：按尺寸返回描边宽度。
 * 精确命中档位时返回对应值；未命中时取最邻近档位的描边宽度，
 * 保证任意尺寸下描边不会突兀地保持 2px。
 */
export function strokeWidthForSize(size: number): number {
  let nearest = SCALE_STEPS[0]
  let delta = Math.abs(size - nearest.size)
  for (const step of SCALE_STEPS) {
    const d = Math.abs(size - step.size)
    if (d < delta) {
      nearest = step
      delta = d
    }
  }
  return nearest.strokeWidth
}
