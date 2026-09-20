/**
 * 心情 / 精力档位字典（唯一真源）
 *
 * SYNC-FROM-DESKTOP: life-assisitant-ui-desktop/src/utils/mood-dict.ts
 * 最后同步：2026-09-18（移动端新建，元数据与桌面端逐条一致）
 *
 * 为什么抽出来：这份 icon/tint/label 元数据原本内联在 stores/mood.ts，
 * 而 MoodPicker / 首页 / 记录页都要用，抽成字典才能一处改全局生效。
 *
 * ⚠️ 展示顺序**不在本文件**：首页从左到右是「很差 → 很好」（升序），
 *    记录页是「很好 → 很差」（降序），那是各页面自己的排列意图，
 *    由调用方传 values 决定，本文件只负责「某个档位长什么样」。
 */
import type { MoodValue, EnergyValue } from '@/api/types'
import type { IconName } from '@/components/icon/names'
import { getTint, type TintName, type TintVars } from '@/utils/tint'

export interface MoodMeta {
  /** Lucide 图标名 */
  icon: IconName
  /** 语义色名 */
  tint: TintName
  /** 中文短标签 */
  label: string
}

/** 带解析好颜色的元数据（模板里直接用 vars.bg / vars.fg） */
export interface MoodMetaWithVars extends MoodMeta {
  vars: TintVars
}

function withVars(m: MoodMeta): MoodMetaWithVars {
  return { ...m, vars: getTint(m.tint) }
}

/** 心情 5 档元数据（04 §3.2） */
export const MOOD_META: Record<MoodValue, MoodMeta> = {
  1: { icon: 'Angry', tint: 'danger', label: '很差' },
  2: { icon: 'Frown', tint: 'warning', label: '低落' },
  3: { icon: 'Meh', tint: 'neutral', label: '一般' },
  4: { icon: 'Smile', tint: 'success', label: '不错' },
  5: { icon: 'Laugh', tint: 'success', label: '很好' },
}

/** 精力 3 档元数据（04 §3.2） */
export const ENERGY_META: Record<EnergyValue, MoodMeta> = {
  1: { icon: 'BatteryLow', tint: 'danger', label: '疲惫' },
  2: { icon: 'BatteryMedium', tint: 'warning', label: '一般' },
  3: { icon: 'BatteryFull', tint: 'success', label: '充沛' },
}

/** 升序（首页 / 快捷面板用）：很差 → 很好 */
export const MOOD_VALUES_ASC: MoodValue[] = [1, 2, 3, 4, 5]

/** 降序（记录页用）：很好 → 很差 */
export const MOOD_VALUES_DESC: MoodValue[] = [5, 4, 3, 2, 1]

/** 精力升序 */
export const ENERGY_VALUES_ASC: EnergyValue[] = [1, 2, 3]

/** 按给定顺序生成心情选项列表：{ value, icon, tint, label, vars } */
export function moodOptions(values: MoodValue[]): Array<{ value: MoodValue } & MoodMetaWithVars> {
  return values.map((v) => ({ value: v, ...withVars(MOOD_META[v]) }))
}

/** 按给定顺序生成精力选项列表 */
export function energyOptions(
  values: EnergyValue[]
): Array<{ value: EnergyValue } & MoodMetaWithVars> {
  return values.map((v) => ({ value: v, ...withVars(ENERGY_META[v]) }))
}

/** 心情档位的中文短标签（"今天心情：不错" 这类文案用） */
export function moodLabelOf(v?: MoodValue | null): string {
  return v ? MOOD_META[v].label : ''
}

/** 精力档位的中文短标签 */
export function energyLabelOf(v?: EnergyValue | null): string {
  return v ? ENERGY_META[v].label : ''
}

/**
 * 兼容旧导出：升序的心情 5 档（原 stores/mood.ts 的 MOOD_LEVELS）。
 * 字段 `emoji` 已移除 —— 渲染请用 `icon`。
 */
export const MOOD_LEVELS: ReadonlyArray<{ value: MoodValue } & MoodMetaWithVars> =
  moodOptions(MOOD_VALUES_ASC)

/** 兼容旧导出：精力的 3 档（原 stores/mood.ts 的 ENERGY_LEVELS） */
export const ENERGY_LEVELS: ReadonlyArray<{ value: EnergyValue } & MoodMetaWithVars> =
  energyOptions(ENERGY_VALUES_ASC)
