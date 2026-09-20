<script setup lang="ts">
/**
 * Timeline —— 生活时间线（移动端）
 *
 * SYNC-FROM-DESKTOP: life-assisitant-ui-desktop/src/pages/home/Timeline.tsx
 * SYNC-FROM-BACKEND: life-assisitant-api/internal/model/dto/timeline.go
 * 最后同步：2026-09-18（Phase 2.2）
 *
 * 把「今天」的跨模块记录（任务完成 / 习惯打卡 / 记账 / 心情）连成一条叙事：
 *   - 左侧 2px 竖线为轴，节点按事件类型 tint 着色
 *   - 时间固定宽度 + 等宽数字
 *   - 金额等宽数字，支出红 / 收入绿（沿用桌面端 `-¥12.00` / `+¥12.00` 的形式）
 *   - 顶部一条「现在」高亮分隔线
 *
 * 数据来自 GET /timeline（已按完整时间戳倒序）。
 */
import { computed } from 'vue'
import { getTint, type TintName } from '@/utils/tint'
import Icon from '@/components/icon/Icon.vue'
import type { IconName } from '@/components/icon/names'
import type { TimelineEvent, TimelineEventType } from '@/api/types'

const props = defineProps<{
  items: TimelineEvent[]
}>()

interface TypeMeta {
  icon: IconName
  tint: TintName
  label: string
}

const TYPE_META: Record<TimelineEventType, TypeMeta> = {
  task: { icon: 'ListChecks', tint: 'primary', label: '任务' },
  habit: { icon: 'CheckSquare', tint: 'success', label: '习惯' },
  expense: { icon: 'TrendingDown', tint: 'danger', label: '支出' },
  income: { icon: 'TrendingUp', tint: 'success', label: '收入' },
  mood: { icon: 'Smile', tint: 'accent', label: '心情' },
  milestone: { icon: 'Trophy', tint: 'warning', label: '里程碑' },
}

const FALLBACK_META: TypeMeta = { icon: 'CircleDot', tint: 'neutral', label: '记录' }

/** 每项预先解析好 tint 与元信息，避免模板里反复查找 */
const rows = computed(() =>
  props.items.map((ev) => {
    const meta = TYPE_META[ev.type] ?? FALLBACK_META
    return { ev, meta, tint: getTint(meta.tint) }
  })
)

function formatAmount(n: number): string {
  const sign = n < 0 ? '-' : '+'
  return `${sign}¥${Math.abs(n).toFixed(2)}`
}
</script>

<template>
  <div v-if="items.length > 0" class="timeline">
    <!-- 「现在」分隔线 —— 分隔已发生的过去与尚未发生的未来 -->
    <div class="timeline-now">
      <span class="timeline-now-label">现在</span>
      <span class="timeline-now-line" />
    </div>

    <div v-for="row in rows" :key="row.ev.id" class="timeline-item">
      <div class="timeline-time">{{ row.ev.time }}</div>
      <div class="timeline-axis">
        <Icon
          class="timeline-node"
          :name="row.meta.icon"
          :size="14"
          :style="{ color: row.tint.fg }"
          :title="row.meta.label"
        />
      </div>
      <div class="timeline-content">
        <div class="timeline-title">{{ row.ev.title }}</div>
        <div v-if="row.ev.detail" class="timeline-detail">{{ row.ev.detail }}</div>
      </div>
      <div
        v-if="row.ev.amount != null"
        class="timeline-amount"
        :class="row.ev.amount < 0 ? 'is-expense' : 'is-income'"
      >
        {{ formatAmount(row.ev.amount) }}
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.timeline {
  display: flex;
  flex-direction: column;
}

/* 「现在」分隔线 */
.timeline-now {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}
.timeline-now-line {
  flex: 1;
  height: 1px;
  background: linear-gradient(90deg, var(--color-primary) 0%, transparent 100%);
  opacity: 0.5;
}
.timeline-now-label {
  flex-shrink: 0;
  font-size: var(--fs-micro);
  font-weight: 600;
  color: var(--color-primary);
}

.timeline-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  min-height: 44px;
}

/* 时间列：等宽数字，保证多行对齐 */
.timeline-time {
  flex-shrink: 0;
  width: 42px;
  padding-top: 2px;
  font-size: var(--fs-micro);
  font-family: var(--font-num);
  color: var(--color-text-tertiary);
  text-align: right;
}

/* 轴列：2px 竖线 + 节点 */
.timeline-axis {
  position: relative;
  flex-shrink: 0;
  width: 16px;
  align-self: stretch;
  display: flex;
  justify-content: center;
  &::before {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    left: 50%;
    width: 2px;
    margin-left: -1px;
    background: var(--color-border-light);
  }
}
.timeline-node {
  position: relative;
  z-index: 1;
  margin-top: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.timeline-content {
  flex: 1;
  min-width: 0;
  padding: 0 0 14px 2px;
}
.timeline-title {
  font-size: var(--fs-caption);
  font-weight: 500;
  color: var(--color-text-primary);
  line-height: 1.4;
  word-break: break-all;
}
.timeline-detail {
  margin-top: 2px;
  font-size: var(--fs-micro);
  color: var(--color-text-tertiary);
  line-height: 1.4;
}

.timeline-amount {
  flex-shrink: 0;
  padding-top: 2px;
  font-size: var(--fs-caption-sm);
  font-weight: 600;
  font-family: var(--font-num);
  &.is-expense { color: var(--color-danger-dark); }
  &.is-income { color: var(--color-success-dark); }
}
</style>
