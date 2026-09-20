<script setup lang="ts">
/**
 * 最近周期列表（移动端经期）
 *
 * SYNC-FROM-DESKTOP: life-assisitant-ui-desktop/src/pages/record/period/components/PeriodHistoryList.tsx
 * SYNC-FROM-BACKEND: life-assisitant-api/internal/model/dto/period.go（PeriodCycle）
 * 契约文档：md/spec-260919/04-页面与交互设计.md §4.1（最近周期）
 *
 * 每行两段信息：起止日 + 经期长度；右列周期长度。
 * ⚠️ cycle_length 为 NULL 有确切含义 —— 与上次间隔 > 90 天（`gap = true`），
 *    不是「还没算出来」，要显示成「—」而不是 0。
 */
import { computed } from 'vue'
import { PERIOD_MASK_TEXT } from '@/constants/period'
import type { PeriodCycle } from '@/api/types'

const props = withDefaults(
  defineProps<{
    cycles: PeriodCycle[]
    masked: boolean
    /** 概览位只展示前 N 条 */
    limit?: number
  }>(),
  { limit: 3 }
)

const emit = defineEmits<{
  (e: 'view-all'): void
  (e: 'pick-cycle', cycle: PeriodCycle): void
}>()

const shown = computed(() => props.cycles.slice(0, props.limit))
const hasMore = computed(() => props.cycles.length > props.limit)

/** `YYYY-MM-DD` → `M/D` */
function md(s?: string | null): string {
  if (!s) return ''
  const [, m, d] = s.split('-')
  if (!m || !d) return s
  return `${Number(m)}/${Number(d)}`
}

/** 周期长度文案（NULL = 间隔 > 90 天，不是缺失） */
function cycleLen(c: PeriodCycle): string {
  if (props.masked) return PERIOD_MASK_TEXT
  if (c.is_ongoing) return '进行中'
  if (c.gap || c.cycle_length == null) return '—'
  return `${c.cycle_length} 天`
}

function rangeText(c: PeriodCycle): string {
  if (props.masked) return PERIOD_MASK_TEXT
  const start = md(c.start_date)
  const end = c.is_ongoing ? '至今' : md(c.end_date)
  return `${start} – ${end}`
}

function periodLenText(c: PeriodCycle): string {
  if (props.masked) return PERIOD_MASK_TEXT
  return `经期 ${c.period_length} 天`
}
</script>

<template>
  <section class="hist-card">
    <h3 class="hist-title">最近周期</h3>

    <p v-if="shown.length === 0" class="hist-empty">还没有完整的周期记录</p>

    <template v-else>
      <button
        v-for="c in shown"
        :key="c.id"
        class="hist-row"
        type="button"
        @click="emit('pick-cycle', c)"
      >
        <span class="hist-left">
          <span class="hist-range" :class="{ 'is-masked': masked }">{{ rangeText(c) }}</span>
          <span class="hist-period" :class="{ 'is-masked': masked }">{{ periodLenText(c) }}</span>
        </span>
        <span class="hist-right">
          <span class="hist-cycle" :class="{ 'is-masked': masked }">{{ cycleLen(c) }}</span>
          <span class="hist-arrow">›</span>
        </span>
      </button>

      <button v-if="hasMore" class="hist-more" type="button" @click="emit('view-all')">
        查看更多 ›
      </button>
    </template>
  </section>
</template>

<style lang="scss" scoped>
.hist-card {
  padding: var(--space-4) var(--space-5);
  background: var(--color-bg-card);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-xs);
  margin-bottom: var(--space-3);
}
.hist-title {
  margin: 0 0 var(--space-2);
  font-size: var(--fs-body-sm);
  font-weight: 700;
  color: var(--color-text-primary);
}
.hist-empty {
  margin: var(--space-2) 0;
  font-size: var(--fs-caption-sm);
  color: var(--color-text-tertiary);
}

.hist-row {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: 11px 0;
  border: 0;
  background: transparent;
  text-align: left;

  & + .hist-row { border-top: 1px solid var(--color-border-light); }
  &:active { opacity: 0.7; }
}
.hist-left {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.hist-range {
  font-size: var(--fs-body-sm);
  font-weight: 500;
  color: var(--color-text-primary);
  font-variant-numeric: tabular-nums;

  &.is-masked { letter-spacing: 2px; color: var(--color-text-disabled); }
}
.hist-period {
  font-size: var(--fs-caption-sm);
  color: var(--color-text-tertiary);

  &.is-masked { letter-spacing: 2px; color: var(--color-text-disabled); }
}
.hist-right {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.hist-cycle {
  font-size: var(--fs-caption);
  color: var(--color-text-secondary);
  font-variant-numeric: tabular-nums;

  &.is-masked { letter-spacing: 2px; color: var(--color-text-disabled); }
}
.hist-arrow {
  font-size: 18px;
  line-height: 1;
  color: var(--color-text-disabled);
}
.hist-more {
  width: 100%;
  margin-top: var(--space-2);
  padding: 8px 0 0;
  border: 0;
  border-top: 1px solid var(--color-border-light);
  background: transparent;
  font-size: var(--fs-caption-sm);
  color: var(--color-primary);
  text-align: center;

  &:active { opacity: 0.7; }
}
</style>
