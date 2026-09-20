/**
 * 热度色阶 —— 习惯热力图 / 统计页热力图的唯一来源。
 *
 * 此前这段完全相同的 5 档绿阶被复制在两处：
 *   `pages/record/components/HabitHeatmap.tsx:24-30`
 *   `pages/stat/index.tsx:117-123`
 * 是 B05（平行定义收敛）同一类问题的漏网之鱼。
 *
 * ⚠️ 与 `category-dict` / `task-dict` 的**语义色**不同：这是**数据可视化的顺序色阶**
 * （sequential colormap），语义是「由浅到深表示完成度递增」，不随主题切换 ——
 * 故**刻意保留字面量**而非令牌化：
 *   - 色阶两端本就锚定语义色（`#D1FAE5` = `--color-success-light`，
 *     `#10B981` = `--color-success`），中间两档 `#6EE7B7`/`#34D399` 无对应令牌。
 *   - 若改用令牌，暗色下整条色阶会翻转成深底色阶，热力图「越绿越多」的直觉反了。
 *
 * 本次收敛为**纯去重，零视觉变化**（两处原值逐字相同）。
 */

/** 5 档绿阶：0 / <25% / <50% / <75% / ≥75% 完成度 */
export function heatColor(ratio: number): string {
  if (ratio === 0) return '#F3F4F6'
  if (ratio < 0.25) return '#D1FAE5'
  if (ratio < 0.5) return '#6EE7B7'
  if (ratio < 0.75) return '#34D399'
  return '#10B981'
}
