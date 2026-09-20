/**
 * 心情 / 精力档位字典（唯一真源）
 *
 * 为什么抽出来：这份 icon/tint/label 元数据原本在 pages/home/index.tsx 与
 * pages/record/components/MoodSection.tsx 各抄了一份，左下角快捷面板是第三个使用方。
 *
 * ⚠️ 展示顺序**不在本文件**：首页从左到右是「很差 → 很好」（升序），
 * 记录页是「很好 → 很差」（降序），那是各页面自己的排列意图，
 * 由调用方传 values 决定，本文件只负责「某个档位长什么样」。
 */
import type { MoodValue, EnergyValue } from '@/api/types'
import type { IconName, TintName } from '@/components/icon'

export interface MoodMeta {
  icon: IconName
  tint: TintName
  label: string
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

/** 按给定顺序生成选项列表：{ value, icon, tint, label } */
export function moodOptions(values: MoodValue[]) {
  return values.map((v) => ({ value: v, ...MOOD_META[v] }))
}

/** 按给定顺序生成精力选项列表 */
export function energyOptions(values: EnergyValue[]) {
  return values.map((v) => ({ value: v, ...ENERGY_META[v] }))
}

/** 心情档位的中文短标签（"今天心情：不错" 这类文案用） */
export function moodLabelOf(v?: MoodValue | null): string {
  return v ? MOOD_META[v].label : ''
}
