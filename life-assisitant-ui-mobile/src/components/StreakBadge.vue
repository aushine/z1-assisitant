<script setup lang="ts">
/**
 * StreakBadge —— 连续打卡徽章（移动端）
 *
 * SYNC-FROM-DESKTOP: life-assisitant-ui-desktop/src/pages/record/components/StreakBadge.tsx
 * 最后同步：2026-09-18（Phase 3.2）
 *
 * 五档视觉分档（与桌面端 tierOf 完全一致，04 §2.5）：
 *   ≥66 自动化  → warning-light 底 + 加粗 + 外发光
 *   ≥21 习惯    → warning-light 底 + 加粗
 *   ≥7  稳定    → warning-light 底
 *   ≥3  点燃    → tint-warning 底
 *   <3  起步    → tint-neutral 底
 *
 * 渲染层已与桌面端统一：两端都是 lucide Flame（移动端引入 lucide-vue-next@0.300.0，
 * 与桌面端 lucide-react 同版本号）。原「移动端用 emoji」的决策已作废。
 */
import { computed } from 'vue'
import Icon from '@/components/icon/Icon.vue'

const props = withDefaults(
  defineProps<{
    streak: number
    /** 单位文案：天 / 周 / 月（随 frequency 变化） */
    unit?: string
  }>(),
  { unit: '天' }
)

/** 频率 → streak 单位（与桌面端 streakUnit 一致） */
interface Tier {
  bg: string
  fg: string
  bold: boolean
  glow: boolean
}

const tier = computed<Tier>(() => {
  const s = Math.max(0, props.streak)
  if (s >= 66)
    return {
      bg: 'var(--color-warning-light)',
      fg: 'var(--color-warning-dark)',
      bold: true,
      glow: true,
    }
  if (s >= 21)
    return { bg: 'var(--color-warning-light)', fg: 'var(--color-warning-dark)', bold: true, glow: false }
  if (s >= 7)
    return { bg: 'var(--color-warning-light)', fg: 'var(--color-warning-dark)', bold: false, glow: false }
  if (s >= 3) return { bg: 'var(--tint-warning-bg)', fg: 'var(--tint-warning-fg)', bold: false, glow: false }
  return { bg: 'var(--tint-neutral-bg)', fg: 'var(--tint-neutral-fg)', bold: false, glow: false }
})
</script>

<template>
  <span
    class="streak-badge"
    :style="{
      background: tier.bg,
      color: tier.fg,
      boxShadow: tier.glow ? '0 0 8px rgba(245, 158, 11, 0.45)' : undefined,
    }"
  >
    <Icon class="sb-flame" name="Flame" :size="16" :style="{ color: tier.fg }" aria-hidden="true" />
    <span class="sb-num" :style="{ fontWeight: tier.bold ? 700 : 500 }">{{ Math.max(0, streak) }}</span>
    <span class="sb-unit">{{ unit }}</span>
  </span>
</template>

<style lang="scss" scoped>
.streak-badge {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: var(--fs-caption-sm);
  line-height: 18px;
  white-space: nowrap;
}
.sb-flame { line-height: 1; }
.sb-num { font-family: var(--font-num); font-variant-numeric: tabular-nums; }
.sb-unit { font-size: var(--fs-micro); opacity: 0.85; }
</style>
