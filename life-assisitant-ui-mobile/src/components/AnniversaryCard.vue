<script setup lang="ts">
/**
 * 首页「重要日子」卡片（移动端）
 *
 * SYNC-FROM-DESKTOP: life-assisitant-ui-desktop/src/components/AnniversaryCard.tsx
 * 设计：md/spec-20260919-v1/06-个人中心与纪念日.md §2
 *
 * 规则：
 *   - 最近 3 条（后端 upcoming 接口给的，已按 days_left 升序）
 *   - days_left === 0 → 「就是今天」并高亮
 *   - ⚠️ 一条都没有时**整卡不渲染**（不放空卡片占位）
 *   - dismiss 只关当天：localStorage 存一个日期串，次日自动恢复
 *
 * ⚠️ 倒计时与下次发生日**全部来自后端**（days_left / next_date），
 *    前端不自己算日期差 —— 跨月 / 2 月 29 日边界后端已处理。
 */
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import Icon from '@/components/icon/Icon.vue'
import { useAnniversaryStore } from '@/stores/anniversary'
import { categoryMeta, daysLeftText, iconOf, isToday } from '@/utils/anniversary'
import { getTint } from '@/utils/tint'
import { todayDate } from '@/utils/date'

/** 「今天不再显示」的记忆键（存的是日期串，不是布尔 —— 次日自动恢复） */
const DISMISS_KEY = 'life-anniversary-card-dismissed-on'

const router = useRouter()
const store = useAnniversaryStore()

const dismissedOn = ref<string>(readDismissed())

onMounted(() => {
  // 跨过零点后日期变了 → 自动恢复
  if (dismissedOn.value && dismissedOn.value !== todayDate()) {
    dismissedOn.value = ''
  }
  void store.fetchUpcoming(3)
})

function readDismissed(): string {
  try {
    return localStorage.getItem(DISMISS_KEY) ?? ''
  } catch {
    return ''
  }
}

const items = computed(() => store.upcoming)
const visible = computed(() => dismissedOn.value !== todayDate() && items.value.length > 0)

function dismiss(): void {
  const today = todayDate()
  dismissedOn.value = today
  try {
    localStorage.setItem(DISMISS_KEY, today)
  } catch {
    /* 隐私模式下 localStorage 不可用时静默降级：只在本会话内隐藏 */
  }
}

function tintOf(it: { color: string; category: string }) {
  return getTint(it.color || categoryMeta(it.category).color)
}

function goAll(): void {
  router.push('/me/anniversaries')
}
</script>

<template>
  <section v-if="visible" class="ann-card">
    <div class="ann-card-head">
      <span class="ann-card-title">
        <Icon name="Calendar" :size="16" />
        重要日子
      </span>
      <span class="ann-card-right">
        <button class="ann-card-link" type="button" @click="goAll">全部 ›</button>
        <button class="ann-card-x" type="button" aria-label="今天不再显示" @click="dismiss">
          <Icon name="X" :size="14" />
        </button>
      </span>
    </div>

    <button
      v-for="it in items"
      :key="it.id"
      class="ann-item"
      :class="{ 'is-today': isToday(it.days_left) }"
      type="button"
      @click="goAll"
    >
      <span class="ann-item-icon" :style="{ background: tintOf(it).bg, color: tintOf(it).fg }">
        <Icon :name="iconOf(it.icon, it.category)" :size="16" />
      </span>
      <span class="ann-item-title">{{ it.title }}</span>
      <span class="ann-item-days" :class="{ 'is-today': isToday(it.days_left) }">
        {{ daysLeftText(it.days_left) }}
      </span>
    </button>
  </section>
</template>

<style lang="scss" scoped>
.ann-card {
  background: var(--color-bg-card);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-xs);
  padding: var(--space-4);
  margin-bottom: var(--space-3);
}

.ann-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}
.ann-card-title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: var(--fs-body-sm);
  font-weight: 700;
  color: var(--color-text-primary);
}
.ann-card-right {
  display: inline-flex;
  align-items: center;
  gap: 10px;
}
.ann-card-link {
  border: 0;
  background: transparent;
  padding: 0;
  font-size: var(--fs-caption-sm);
  color: var(--color-primary);
}
.ann-card-x {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--color-text-tertiary);
}

.ann-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
  border: 0;
  background: transparent;
  text-align: left;

  & + .ann-item { border-top: 1px solid var(--color-border-light); }
  &.is-today { background: var(--tint-danger-bg); border-radius: var(--radius-md); padding-left: 6px; padding-right: 6px; }
}
.ann-item-icon {
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-base);
}
.ann-item-title {
  flex: 1;
  min-width: 0;
  font-size: var(--fs-caption);
  color: var(--color-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ann-item-days {
  flex-shrink: 0;
  font-size: var(--fs-caption-sm);
  font-weight: 600;
  color: var(--color-text-secondary);
  font-family: var(--font-num);
  &.is-today { color: var(--color-danger); }
}
</style>
