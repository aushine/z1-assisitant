<script setup lang="ts">
/**
 * 今日健康 · 分类卡（移动端）
 *
 * 一张大卡 + 卡内 3 个分组（身体数据 / 经期 / 其他），行式布局（02 §16）。
 *   - 每行 = 指标名 + 值 + 行尾 ChevronRight，**整行可点** → 打开浮层直达该指标页（§16.4）；
 *   - 饮水行是唯一就地操作：＋ 喝一杯（走 store.addEvent，成功后 refreshAfterEvent，**不弹 toast**，§16.5）；
 *   - 未记录显 `—`；去掉了全部 ± 与输入框；非 daily 指标不进完成度、只显次数（§14.5）。
 *   - tone 只做中性样式，绝不上红绿（07 §1.1）。
 *
 * ⚠️ 数据直接读 store.todayLog（日汇总缓存）+ store.settings.metrics_enabled 分组渲染，
 *    不再依赖后端 cards 数组的格式化文案，前端掌握行布局与点击入口。
 */
import { computed, ref } from 'vue'
import Icon from '@/components/icon/Icon.vue'
import { useHealthStore } from '@/stores/health'
import { DEFAULT_WATER_GOAL_ML, healthMetric, normalizeWaterStep } from '@/constants/health'
import type { HealthEventMetricKey } from '@/api/types'

const store = useHealthStore()

const emit = defineEmits<{
  (e: 'settings'): void
  (e: 'open-metric', key: string): void
}>()

/** 卡内分组定义（顺序即渲染顺序，02 §16.2） */
const GROUP_DEFS = [
  { title: '身体数据', keys: ['water', 'bowel', 'bbt', 'weight', 'sleep'], onlyIfPeriod: false },
  { title: '经期', keys: ['period', 'discharge', 'sex'], onlyIfPeriod: true },
  { title: '其他', keys: ['symptoms', 'note'], onlyIfPeriod: false },
] as const

/** 卡头「今天记了 N 项」的完成度分母 = 卡内启用的 daily 指标数（§14.5） */
const CARD_DAILY_KEYS = ['water', 'bbt', 'weight', 'sleep'] as const

const log = computed(() => store.todayLog)
const enabled = computed(() => store.enabledMetrics)
const waterGoal = computed(() => store.settings?.water_goal_ml || DEFAULT_WATER_GOAL_ML)
const waterStep = computed(() => normalizeWaterStep(store.settings?.water_step_ml ?? 0))
const today = computed(() => store.today)

/** 某项今日是否已记录（用于完成度与行显隐） */
function isRecorded(key: string): boolean {
  const d = log.value
  if (!d) return false
  switch (key) {
    case 'water': return d.water_ml > 0
    case 'bowel': return d.bowel_count > 0
    case 'bbt': return d.bbt != null
    case 'weight': return d.weight_kg != null
    case 'sleep': return d.sleep_hours != null
    case 'period': return !!d.period && d.period.flow > 0
    case 'discharge': return !!d.period && d.period.discharge > 0
    case 'sex': return !!d.period && d.period.intercourse > 0
    case 'symptoms': return !!d.period && d.period.symptoms.length > 0
    case 'note': return !!d.moods && !!d.moods.note.trim()
    default: return false
  }
}

/** 行展示值（未记录统一显 —） */
function rowValue(key: string): string {
  const d = log.value
  if (!d) return '—'
  switch (key) {
    case 'water': return `${d.water_ml} / ${waterGoal.value} ml`
    case 'bowel': return d.bowel_count > 0 ? `${d.bowel_count} 次` : '—'
    case 'bbt': return d.bbt != null ? `${d.bbt} ℃` : '—'
    case 'weight': return d.weight_kg != null ? `${d.weight_kg} kg` : '—'
    case 'sleep': return d.sleep_hours != null ? `${d.sleep_hours} h` : '—'
    case 'period': {
      const day = store.prediction?.current_cycle?.day_index
      if (day) return `周期第 ${day} 天`
      return d.period?.flow > 0 ? '经期中' : '—'
    }
    case 'discharge': return (d.period?.discharge ?? 0) > 0 ? '已记' : '—'
    case 'sex': return (d.period?.intercourse ?? 0) > 0 ? '已记' : '—'
    case 'symptoms': return (d.period?.symptoms.length ?? 0) > 0 ? `${d.period.symptoms.length} 项` : '—'
    case 'note': return d.moods?.note.trim() ? d.moods.note.trim() : '—'
    default: return '—'
  }
}

/** 行尾小字「次数」（仅 >1 时；事件型/目标型主值已是次数则不重复） */
function rowCount(key: string): number | null {
  const d = log.value
  if (!d) return null
  if (key === 'water') return d.water_ml > 0 ? null : null
  if (key === 'bowel') return d.bowel_count > 1 ? d.bowel_count : null
  return null
}

const groups = computed(() =>
  GROUP_DEFS
    .filter((g) => !g.onlyIfPeriod || enabled.value.includes('period'))
    .map((g) => ({
      title: g.title,
      metrics: g.keys
        .filter((k) => enabled.value.includes(k))
        .map((k) => ({
          key: k,
          label: healthMetric(k)?.name ?? k,
          value: rowValue(k),
          count: rowCount(k),
          isWater: k === 'water',
          recorded: isRecorded(k),
        })),
    }))
    .filter((g) => g.metrics.length > 0),
)

/** 完成度：卡内启用的 daily 指标里，今天已记了几项 */
const dailyEnabled = computed(() =>
  CARD_DAILY_KEYS.filter((k) => enabled.value.includes(k)),
)
const dailyRecorded = computed(() => dailyEnabled.value.filter((k) => isRecorded(k)).length)
const progressPct = computed(() => {
  const total = dailyEnabled.value.length
  if (!total) return 0
  return Math.min(100, Math.round((dailyRecorded.value / total) * 100))
})

/* ==================== 饮水就地操作（§16.5） ==================== */
const drinking = ref(false)
const bumped = ref(false)
let bumpTimer: ReturnType<typeof setTimeout> | undefined

async function onDrink(): Promise<void> {
  if (drinking.value) return
  drinking.value = true
  const ok = await store.addEvent(
    { date: today.value, metric_key: 'water' as HealthEventMetricKey, value_num: waterStep.value },
  )
  drinking.value = false
  if (ok) {
    bumped.value = true
    if (bumpTimer) clearTimeout(bumpTimer)
    bumpTimer = setTimeout(() => { bumped.value = false }, 220)
  }
}

function onOpenMetric(key: string): void {
  emit('open-metric', key)
}
function onSettings(): void {
  emit('settings')
}
</script>

<template>
  <section class="ov">
    <!-- ==================== 全部指标关闭 → 去配置引导 ==================== -->
    <div v-if="enabled.length === 0" class="ov-empty-card">
      <p class="ov-empty-text">健康记录已全部关闭</p>
      <button class="ov-empty-btn" type="button" @click="onSettings">去配置</button>
    </div>

    <template v-else>
      <!-- ==================== 卡头 ==================== -->
      <div class="ov-head">
        <div class="ov-head-left">
          <span class="ov-title">今日健康</span>
          <span class="ov-sub">今天记了 {{ dailyRecorded }} 项</span>
        </div>
        <button class="ov-gear" type="button" aria-label="健康设置" @click="onSettings">
          <Icon name="Settings" :size="18" />
        </button>
      </div>
      <div class="ov-bar">
        <span class="ov-bar-fill" :style="{ width: progressPct + '%' }" />
      </div>

      <!-- ==================== 分组 + 行 ==================== -->
      <div v-for="g in groups" :key="g.title" class="ov-group">
        <div class="ov-group-title">{{ g.title }}</div>
        <ul class="ov-rows">
          <li
            v-for="m in g.metrics"
            :key="m.key"
            class="ov-row"
            role="button"
            :aria-label="`${m.label}，点开记录`"
            @click="onOpenMetric(m.key)"
          >
            <span class="ov-name">{{ m.label }}</span>
            <span
              class="ov-value"
              :class="{ 'is-empty': !m.recorded, 'is-bumped': m.isWater && bumped }"
            >{{ m.value }}</span>
            <span v-if="m.count != null" class="ov-count">{{ m.count }} 次</span>
            <button
              v-if="m.isWater"
              class="ov-drink"
              type="button"
              :disabled="drinking"
              :aria-label="`喝一杯 ${waterStep}ml`"
              @click.stop="onDrink"
            >
              ＋ 喝一杯
            </button>
            <Icon name="ChevronRight" class="ov-chevron" :size="16" />
          </li>
        </ul>
      </div>
    </template>
  </section>
</template>

<style lang="scss" scoped>
.ov {
  padding: var(--space-2) var(--space-3) var(--space-3);
  background: var(--color-bg-card);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-xs);
  margin-bottom: var(--space-3);
}

/* ==================== 卡头 ==================== */
.ov-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  padding-top: var(--space-2);
}
.ov-head-left {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.ov-title {
  font-size: var(--fs-body-sm);
  font-weight: 600;
  color: var(--color-text-primary);
}
.ov-sub {
  font-size: var(--fs-caption-sm);
  color: var(--color-text-tertiary);
  font-variant-numeric: tabular-nums;
}
.ov-gear {
  width: 32px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  background: transparent;
  color: var(--color-text-tertiary);
  border-radius: var(--radius-base);

  :deep(svg) { display: block; }
  &:active { background: var(--color-bg-hover); }
}

/* ==================== 完成度条 ==================== */
.ov-bar {
  margin-top: var(--space-2);
  height: 4px;
  border-radius: var(--radius-pill);
  background: var(--color-bg-hover);
  overflow: hidden;
}
.ov-bar-fill {
  display: block;
  height: 100%;
  border-radius: var(--radius-pill);
  background: var(--color-primary);
  transition: width var(--duration-base) var(--ease-default);
}

/* ==================== 分组 ==================== */
.ov-group {
  margin-top: var(--space-1);
}
.ov-group-title {
  padding: var(--space-3) 0 2px;
  font-size: var(--fs-caption-sm);
  font-weight: 600;
  color: var(--color-text-secondary);
}
.ov-rows {
  list-style: none;
  margin: 0;
  padding: 0;
}

/* ==================== 行（高 44，值左对齐，末行不画底） ==================== */
.ov-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-height: 44px;
  border-bottom: 1px solid var(--color-border-light);
  -webkit-tap-highlight-color: transparent;

  &:last-child { border-bottom: 0; }
  &:active { background: var(--color-bg-hover); }
}
.ov-name {
  flex-shrink: 0;
  width: 64px;
  font-size: var(--fs-body-sm);
  color: var(--color-text-secondary);
}
.ov-value {
  flex: 1;
  min-width: 0;
  font-size: var(--fs-body-sm);
  font-weight: 600;
  font-family: var(--font-num);
  font-variant-numeric: tabular-nums;
  color: var(--color-text-primary);
  text-align: left;
  transition: transform var(--duration-fast) var(--ease-default);

  &.is-empty {
    color: var(--color-text-disabled);
    font-weight: 400;
  }
  &.is-bumped { transform: scale(1.06); }
}
.ov-count {
  flex-shrink: 0;
  font-size: var(--fs-caption-sm);
  color: var(--color-text-tertiary);
  font-variant-numeric: tabular-nums;
}

/* 饮水就地操作（唯一保留的按钮，§16.5） */
.ov-drink {
  flex-shrink: 0;
  height: 30px;
  padding: 0 12px;
  border: 0;
  border-radius: var(--radius-pill);
  background: var(--color-primary-light);
  color: var(--color-primary);
  font-size: var(--fs-caption);
  font-weight: 600;
  -webkit-tap-highlight-color: transparent;

  &:active:not(:disabled) { transform: scale(0.96); }
  &:disabled { opacity: 0.6; }
}

.ov-chevron {
  flex-shrink: 0;
  color: var(--color-text-disabled);
}

/* ==================== 全关引导 ==================== */
.ov-empty-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-5) var(--space-4);
}
.ov-empty-text {
  margin: 0;
  font-size: var(--fs-body-sm);
  color: var(--color-text-secondary);
}
.ov-empty-btn {
  width: 100%;
  height: 42px;
  border: 0;
  border-radius: var(--radius-pill);
  background: var(--color-primary);
  color: #FFFFFF;
  font-size: var(--fs-body-sm);
  font-weight: 600;

  &:active { background: var(--color-primary-dark); }
}
</style>
