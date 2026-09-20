/**
 * 图标系统统一出口（02 §8.1）。
 *
 * 业务代码一律从这里导入：
 *   import { Icon, Home, ListChecks, type IconName, type TintName } from '@/components/icon'
 *
 * 未来若更换图标库，只需改这一个文件。
 */
export { default as Icon } from './Icon'
export type { IconProps } from './Icon'
export * from './names'
export * from './sizes'
export * from './tints'
