<script setup lang="ts">
/**
 * TaskCard —— 单条待办卡片（移动端）
 *
 * SYNC-FROM-DESKTOP: life-assisitant-ui-desktop/src/pages/task/index.tsx
 *                    （columns 里的 标题 / 分类 / 优先级 / 截止 / 状态 / 操作 六列）
 * 最后同步：2026-09-18（Phase 2.3 + 2.4）
 *
 * 为什么单独抽组件：
 *   长按（`useLongPress`）内部调用 `onUnmounted`，必须在**组件 setup**里注册。
 *   如果在父页面的 `v-for` 里现算 composable，就会脱离组件实例、拿不到
 *   生命周期钩子（且无法保证定时器被清理）。抽成卡片组件后每张卡各自持有一个
 *   干净的手势实例。
 *
 * 交互映射：
 *   点卡片   → 多选模式 = 勾选；否则 → 详情页
 *   点复选框 → 多选模式 = 勾选；否则 = 切换完成
 *   长按     → 进入多选模式并选中
 *   左滑     → 编辑 / 删除
 */
import { computed } from 'vue'
import { useLongPress } from '@/composables/useLongPress'
import { getTaskPriority } from '@/utils/task-dict'
import { getTaskCategory, resolveCategory } from '@/utils/category-dict'
import { formatDayLabel, todayDate } from '@/utils/date'
import Icon from '@/components/icon/Icon.vue'
import type { IconName } from '@/components/icon/names'
import type { Task } from '@/api/types'

const props = defineProps<{
  task: Task
  /** 多选模式 */
  selecting: boolean
  /** 该条是否被选中 */
  selected: boolean
}>()

const emit = defineEmits<{
  (e: 'open'): void
  (e: 'toggle-complete', ev: Event): void
  (e: 'longpress'): void
  (e: 'edit'): void
  (e: 'remove'): void
}>()

// ==================== 长按 → 多选 ====================
const lp = useLongPress(() => emit('longpress'))

// ==================== 派生展示数据 ====================
const priority = computed(() => getTaskPriority(props.task.priority))
const category = computed(() => getTaskCategory(props.task.category_id ?? undefined))

const resolvedCat = computed(() => resolveCategory(props.task.category_emoji))
const iconName = computed<IconName>(() => category.value?.icon ?? resolvedCat.value.icon)
const iconBg = computed(() => category.value?.vars.bg ?? resolvedCat.value.vars.bg)
const iconFg = computed(() => category.value?.vars.fg ?? resolvedCat.value.vars.fg)

/** 截止文案 */
const dueText = computed(() => {
  const d = props.task.due_date
  const t = props.task.due_time
  if (!d && !t) return '无截止时间'
  if (d && t) return `${formatDayLabel(d)} ${t}`
  if (d) return formatDayLabel(d)
  return t || '无截止时间'
})

/** 是否逾期（截止时间标红） */
const overdue = computed(() => {
  const { due_date: d, status } = props.task
  if (!d || status === 'done') return false
  return d < todayDate()
})

/** 勾选态：多选看 selected，常规看 status */
const checked = computed(() => (props.selecting ? props.selected : props.task.status === 'done'))

const subCount = computed(() => (props.task.subtasks_count ? ` (${props.task.subtasks_count})` : ''))

function onCardClick(): void {
  // 吞掉长按后紧随的那次 click，否则长按进多选会立刻又被当作普通点击
  if (lp.consumeClick()) return
  emit('open')
}
</script>

<template>
  <van-swipe-cell :disabled="selecting">
    <div
      v-on="lp.handlers"
      class="task-card"
      :class="{ 'is-done': task.status === 'done', 'is-selected': selected }"
      @click="onCardClick"
    >
      <!-- 复选框 -->
      <button
        type="button"
        class="checkbox"
        :class="{ 'is-checked': checked }"
        :aria-label="selecting ? '选择任务' : (task.status === 'done' ? '标记为未完成' : '标记为已完成')"
        @click="emit('toggle-complete', $event)"
      >
        <span v-if="checked" class="check-tick" aria-hidden="true">✓</span>
      </button>

      <!-- 分类图标 -->
      <Icon class="task-emoji" :name="iconName" :size="16" :style="{ background: iconBg, color: iconFg }" aria-hidden="true" />

      <!-- 内容 -->
      <div class="task-body">
        <div class="task-row1">
          <span class="task-title">
            {{ task.title }}<span v-if="subCount" class="task-sub-count">{{ subCount }}</span>
          </span>
          <span
            class="priority-chip"
            :style="{ color: priority.fg, background: priority.bg }"
          >{{ priority.label }}</span>
        </div>
        <div v-if="task.description" class="task-desc">{{ task.description }}</div>
        <div class="task-row2">
          <span class="task-meta" :class="{ 'is-overdue': overdue }">{{ dueText }}</span>
          <span v-if="task.recurrence_rule" class="task-tag">重复</span>
          <span v-if="task.completed_at" class="task-meta-done">已完成</span>
        </div>
      </div>
    </div>

    <!-- 左滑操作（B4：替代桌面端 hover / 右键） -->
    <template #right>
      <div class="swipe-actions">
        <button type="button" class="swipe-btn is-edit" @click="emit('edit')">编辑</button>
        <button type="button" class="swipe-btn is-delete" @click="emit('remove')">删除</button>
      </div>
    </template>
  </van-swipe-cell>
</template>

<style lang="scss" scoped>
.task-card {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 16px;
  background: var(--color-bg-card);
  transition: all var(--duration-fast) var(--ease-default);
  -webkit-tap-highlight-color: transparent;
  cursor: pointer;
  &:active {
    transform: scale(0.99);
    background: var(--color-bg-hover);
  }
  &.is-selected { background: var(--color-primary-light); }
  &.is-done {
    .task-title { text-decoration: line-through; color: var(--color-text-disabled); }
    .task-desc { color: var(--color-text-disabled); }
    .task-meta { color: var(--color-text-disabled); }
  }
}

.swipe-actions {
  display: flex;
  height: 100%;
}
.swipe-btn {
  width: 68px;
  height: 100%;
  border: 0;
  padding: 0;
  font-size: var(--fs-body-sm);
  font-weight: 500;
  color: #FFFFFF;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  &:active { opacity: 0.85; }
  &.is-edit { background: var(--color-text-tertiary); }
  &.is-delete { background: var(--color-danger); }
}

/* 复选框 22x22 圆角 6 */
.checkbox {
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-bg-card);
  border: 1.5px solid var(--color-border-strong);
  border-radius: 6px;
  margin-top: 2px;
  cursor: pointer;
  transition: all var(--duration-fast) var(--ease-default);
  -webkit-tap-highlight-color: transparent;
  padding: 0;
  &:active { transform: scale(0.9); }
  &.is-checked {
    background: var(--color-primary);
    border-color: var(--color-primary);
  }
}
.check-tick {
  font-size: 14px;
  font-weight: 700;
  color: #FFFFFF;
  line-height: 1;
}

/* 分类图标标签 */
.task-emoji {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  line-height: 1;
  background: var(--color-bg-hover);
}

.task-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.task-row1 {
  display: flex;
  align-items: center;
  gap: 8px;
}
.task-title {
  flex: 1;
  min-width: 0;
  font-size: var(--fs-body);
  font-weight: 500;
  color: var(--color-text-primary);
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.task-sub-count {
  font-size: var(--fs-micro);
  font-weight: 400;
  color: var(--color-text-tertiary);
}
.priority-chip {
  flex-shrink: 0;
  padding: 2px 8px;
  font-size: var(--fs-micro);
  font-weight: 700;
  border-radius: 6px;
  line-height: 1.4;
}
.task-desc {
  font-size: var(--fs-caption-sm);
  color: var(--color-text-tertiary);
  line-height: 1.5;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
}
.task-row2 {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 2px;
}
.task-meta {
  font-size: var(--fs-caption-sm);
  color: var(--color-text-tertiary);
  &.is-overdue { color: var(--color-danger-dark); font-weight: 500; }
}
.task-tag {
  font-size: var(--fs-micro);
  color: var(--color-primary-dark);
  background: var(--color-primary-light);
  padding: 1px 6px;
  border-radius: 4px;
}
.task-meta-done {
  font-size: var(--fs-micro);
  color: var(--color-success-dark);
  background: var(--color-success-light);
  padding: 1px 6px;
  border-radius: 4px;
  font-weight: 500;
}
</style>
