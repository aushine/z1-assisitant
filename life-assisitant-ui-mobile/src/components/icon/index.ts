/**
 * 图标系统统一出口（02 §8.1）
 *
 * 业务代码一律从这里导入：
 *   import Icon from '@/components/icon/Icon.vue'
 *   import { ICONS, type IconName, type TintName } from '@/components/icon'
 *
 * 未来若更换图标库，只需改 `names.ts` 这一个文件。
 *
 * 与桌面端的差异（有意）：
 *   - 桌面端 tint 定义在 `components/icon/tints.ts`，移动端收口在 `utils/tint.ts`
 *     （多了 getTint/tintBg/tintFg 三个便捷函数），此处再导出一次以免两端 import 路径分歧。
 */
export { default as Icon } from './Icon.vue'
export * from './names'
export * from './sizes'
export { TINT_VARS, getTint, tintBg, tintFg, TINT_NAMES } from '@/utils/tint'
export type { TintName, TintVars } from '@/utils/tint'
