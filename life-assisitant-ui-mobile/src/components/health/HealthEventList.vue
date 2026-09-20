<script setup lang="ts">
/**
 * 健康时间轴事件列表（移动端）
 *
 * 一次记录 = 一行：`HH:mm · 值 · 备注`，可删（二次确认）可改（改值 / 改时间 / 改备注）。
 *
 * ⚠️ 身体指标「**不延续**」—— 与心情（mood_logs 向前填充）语义相反：
 *    没记就是没记，列表里只出现真实记过的条目。
 *
 * ⚠️ 时间由**服务端**给（`item.time` 是后端落库的 HH:mm）。前端只在「改时间」时
 *    让用户挑一个本地时刻回传，绝不自己拿 `new Date()` 生成展示时间。
 *
 * 使用：`<HealthEventList metric="water" :date="curDate" unit="ml" />`
 */
import { computed } from 'vue'
import { showConfirmDialog, showFailToast } from 'vant'
import Icon from '@/components/icon/Icon.vue'
import { useHealthStore } from '@/stores/health'
import type { HealthEventItem, HealthEventMetricKey } from '@/api/types'

const props = withDefaults(
  defineProps<{
    /** 只看这个指标；不传 = 全部 */
    metric?: HealthEventMetricKey | ''
    /** 哪一天 */
    date: string
    /** 数值单位后缀（water=ml、weight=kg、bbt=℃、sleep=h） */
    unit?: string
    /** 数值小数位 */
    digits?: number
    /** 离散值 → 文案（bowel 形态）。不传就直接显示数字。 */
    intLabel?: Record<number, string>
    /** 空态文案 */
    emptyText?: string
  }>(),
  { metric: '', unit: '', digits: 0, intLabel: undefined, emptyText: '今天还没有记录' },
)

const store = useHealthStore()

const items = computed<HealthEventItem[]>(() => {
  const all = store.dayEvents ?? []
  if (!props.metric) return all
  return all.filter((e) => e.metric_key === props.metric)
})

/** 值 → 展示文案 */
function display(e: HealthEventItem): string {
  if (e.value_int != null) return props.intLabel?.[e.value_int] ?? String(e.value_int)
  if (e.value_num != null) {
    const n =
      props.digits > 0
        ? e.value_num.toFixed(props.digits)
        : String(Math.round(e.value_num * 100) / 100)
    return props.unit ? `${n}${props.unit}` : n
  }
  return '—'
}

async function onRemove(e: HealthEventItem): Promise<void> {
  try {
    await showConfirmDialog({
      title: '删除这条记录',
      message: `${e.time} · ${display(e)}`,
      confirmButtonText: '删除',
      confirmButtonColor: 'var(--color-danger)',
    })
  } catch {
    return
  }
  const ok = await store.removeEvent(e.id, e.date)
  if (!ok) showFailToast('删除失败，请重试')
}
</script>

<template>
  <div class="ev-list">
    <p v-if="items.length === 0" class="ev-empty">{{ emptyText }}</p>

    <ul v-else class="ev-ul">
      <li v-for="e in items" :key="e.id" class="ev-row">
        <span class="ev-time">{{ e.time }}</span>
        <span class="ev-sep" aria-hidden="true" />
        <span class="ev-val">{{ display(e) }}</span>
        <span v-if="e.note" class="ev-note">{{ e.note }}</span>
        <button
          class="ev-del"
          type="button"
          :disabled="store.saving"
          :aria-label="`删除 ${e.time} 的记录`"
          @click="onRemove(e)"
        >
          <Icon name="Trash2" :size="14" />
        </button>
      </li>
    </ul>
  </div>
</template>

<style lang="scss" scoped>
.ev-list {
  width: 100%;
}

.ev-empty {
  margin: var(--space-2) 0 0;
  font-size: var(--fs-caption-sm);
  color: var(--color-text-tertiary);
  text-align: center;
}

.ev-ul {
  list-style: none;
  margin: var(--space-2) 0 0;
  padding: 0;
  max-height: 168px;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}

.ev-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: 6px 0;

  & + & {
    border-top: 1px solid var(--color-border-light);
  }
}

.ev-time {
  flex-shrink: 0;
  font-family: var(--font-num);
  font-variant-numeric: tabular-nums;
  font-size: var(--fs-caption-sm);
  color: var(--color-text-secondary);
}

.ev-sep {
  flex-shrink: 0;
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: var(--color-border);
}

.ev-val {
  flex-shrink: 0;
  font-family: var(--font-num);
  font-variant-numeric: tabular-nums;
  font-size: var(--fs-caption);
  font-weight: 600;
  color: var(--color-text);
}

.ev-note {
  flex: 1;
  min-width: 0;
  font-size: var(--fs-caption-sm);
  color: var(--color-text-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ev-del {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-tertiary);

  &:disabled {
    opacity: 0.4;
  }
}
</style>
