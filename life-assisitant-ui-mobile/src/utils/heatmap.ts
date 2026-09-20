/**
 * 热度色阶 —— 习惯热力图 / 统计页热力图的唯一来源（移动端）
 *
 * SYNC-FROM-DESKTOP: life-assisitant-ui-desktop/src/utils/heatmap.ts
 * 最后同步：2026-09-18
 *
 * 桌面端这段完全相同的 5 档绿阶曾被复制在 HabitHeatmap.tsx 与 stat/index.tsx
 * 两处，属「平行定义」的漏网之鱼。移动端从第一天就只留这一个来源。
 *
 * ⚠️ 与 category-dict / task-dict 的**语义色**不同：这是**数据可视化的
 * 顺序色阶**（sequential colormap），语义是「由浅到深表示完成度递增」，
 * **不随主题切换**，故**刻意保留 hex 字面量**而非令牌化：
 *   - 色阶两端本就锚定语义色（#D1FAE5 = --color-success-light，
 *     #10B981 = --color-success），中间两档 #6EE7B7 / #34D399 无对应令牌。
 *   - 若改用令牌，暗色下整条色阶会翻转成深底色阶，
 *     热力图「越绿越多」的直觉就反了。
 * 两端都不要令牌化，这是有意为之。
 */

/** 5 档绿阶：0 / <25% / <50% / <75% / ≥75% 完成度 */
export const HEAT_COLORS = {
  empty: '#F3F4F6',
  low: '#D1FAE5',
  midLow: '#6EE7B7',
  midHigh: '#34D399',
  high: '#10B981',
} as const

/** 按完成率（0-1）取色 */
export function heatColor(ratio: number): string {
  if (!Number.isFinite(ratio) || ratio <= 0) return HEAT_COLORS.empty
  if (ratio < 0.25) return HEAT_COLORS.low
  if (ratio < 0.5) return HEAT_COLORS.midLow
  if (ratio < 0.75) return HEAT_COLORS.midHigh
  return HEAT_COLORS.high
}

/** 按「已完成 / 总数」取色（热力图数据项直接用这个） */
export function heatColorByCount(completed: number, total: number): string {
  if (!total || total <= 0) return HEAT_COLORS.empty
  return heatColor(completed / total)
}

/**
 * 图例色块（0 档 + 4 档），用于热力图下方的说明条。
 */
export const HEAT_LEGEND: ReadonlyArray<{ color: string; label: string }> = [
  { color: HEAT_COLORS.empty, label: '未记录' },
  { color: HEAT_COLORS.low, label: '<25%' },
  { color: HEAT_COLORS.midLow, label: '<50%' },
  { color: HEAT_COLORS.midHigh, label: '<75%' },
  { color: HEAT_COLORS.high, label: '≥75%' },
]
