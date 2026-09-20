<script setup lang="ts">
/**
 * MilestoneRow —— 里程碑徽章行（移动端）
 *
 * SYNC-FROM-DESKTOP: life-assisitant-ui-desktop/src/pages/record/components/StreakBadge.tsx
 *                    （MilestoneRow 部分）
 * 最后同步：2026-09-18（Phase 3.2）
 *
 * 里程碑 7 / 21 / 66 / 100 / 365 天（04 §2.6）。
 * 以「最长连续天数」判断达成；已达成用奖牌金 --medal-gold，
 * 未达成为禁用文字色 + 浅边框。
 *
 * ⚠️ --medal-gold 是**纯色**令牌，只能用于 color / border-color；
 *    渐变形式是 --medal-gold-bg，仅用于 background（定义在 styles/tokens.scss）。
 */
import { computed } from 'vue'
import Icon from '@/components/icon/Icon.vue'
import type { IconName } from '@/components/icon/names'

const props = defineProps<{
  /** 以最长连续天数判断哪些里程碑已达成 */
  longestStreak: number
}>()

interface Milestone {
  days: number
  emoji: string
  label: string
}

const MILESTONES: readonly Milestone[] = [
  { days: 7, emoji: '🎖️', label: '一周不断' },
  { days: 21, emoji: '🏅', label: '习惯萌芽' },
  { days: 66, emoji: '🏆', label: '自动化' },
  { days: 100, emoji: '💎', label: '百日' },
  { days: 365, emoji: '👑', label: '一年' },
]

/** emoji → Lucide 图标（存储值不变，仅渲染层替换） */
const MILESTONE_ICON: Record<string, IconName> = {
  '🎖️': 'Medal',
  '🏅': 'Medal',
  '🏆': 'Trophy',
  '💎': 'Gem',
  '👑': 'Crown',
}

const items = computed(() =>
  MILESTONES.map((m) => ({
    ...m,
    icon: MILESTONE_ICON[m.emoji] ?? 'Medal',
    reached: props.longestStreak >= m.days,
  }))
)
</script>

<template>
  <div class="milestone-row">
    <div
      v-for="m in items"
      :key="m.days"
      class="milestone-chip"
      :class="{ 'is-reached': m.reached }"
      :style="{
        color: m.reached ? 'var(--medal-gold)' : 'var(--color-text-disabled)',
        borderColor: m.reached ? 'var(--medal-gold)' : 'var(--color-border-light)',
      }"
      :aria-label="`${m.days} 天 · ${m.label}`"
    >
      <Icon
        class="mc-emoji"
        :name="m.icon"
        :size="16"
        :style="{ color: m.reached ? 'var(--medal-gold)' : 'var(--color-text-disabled)' }"
        aria-hidden="true"
      />
      <span class="mc-days">{{ m.days }}</span>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.milestone-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.milestone-chip {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  height: 28px;
  padding: 0 8px;
  border: 1px solid var(--color-border-light);
  border-radius: 999px;
  background: var(--color-bg-card);
  transition: all var(--duration-fast) var(--ease-default);
  &.is-reached { font-weight: 600; }
}
.mc-emoji {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
}
.mc-days {
  font-size: var(--fs-micro);
  font-family: var(--font-num);
  font-variant-numeric: tabular-nums;
}
</style>
