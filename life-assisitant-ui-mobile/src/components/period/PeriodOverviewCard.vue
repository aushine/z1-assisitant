<script setup lang="ts">
/**
 * 周期概览卡（移动端）
 *
 * SYNC-FROM-DESKTOP: life-assisitant-ui-desktop/src/pages/record/period/components/PeriodOverviewCard.tsx
 * SYNC-FROM-BACKEND: life-assisitant-api/internal/model/dto/period.go（PeriodPrediction）
 * 契约文档：md/spec-260919/04-页面与交互设计.md §4.1 / §6
 *
 * ⚠️ 前端**不做任何预测计算**：阶段、日期、区间、置信度、原因一律渲染后端返回值。
 *
 * ⚠️ 全案最硬的一条约束（04 §6.2）：`confidence === 'insufficient'` 时
 *    **一个具体日期都不许显示**。用默认 28 天算出来的假日期和真预测长得一模一样，
 *    是最容易毁掉用户信任的地方。本组件把这条收在 `canShowDates` 一处。
 *
 * 卡片高度在遮罩开/关下保持稳定（04 §3.6）：遮罩只是把文字换成等位掩码，
 * 不隐藏整块 —— 否则「这里原本有内容」本身就成了被泄露的信息。
 */
import { computed } from 'vue'
import Icon from '@/components/icon/Icon.vue'
import { PERIOD_MASK_TEXT, periodCanShowDates, type PeriodPhaseKey } from '@/constants/period'
import { formatMonthDay } from '@/utils/date'
import type { PeriodPrediction } from '@/api/types'

const props = defineProps<{
  prediction: PeriodPrediction | null
  /** 隐私遮罩（设备级 👁 状态） */
  masked: boolean
  /** 设置里是否开启易孕期展示（show_fertile_window） */
  showFertile: boolean
}>()

const emit = defineEmits<{
  (e: 'toggle-mask'): void
  (e: 'show-info'): void
  (e: 'go-settings'): void
  (e: 'show-fertile-info'): void
}>()

/** 是否允许展示具体日期（insufficient → false） */
const canShowDates = computed(() => periodCanShowDates(props.prediction?.confidence))

const currentCycle = computed(() => props.prediction?.current_cycle ?? null)

const phaseKey = computed<PeriodPhaseKey | null>(() => currentCycle.value?.phase?.key ?? null)

/** 阶段名（遮罩时换掩码） */
const phaseLabel = computed(() => {
  if (props.masked) return PERIOD_MASK_TEXT
  return currentCycle.value?.phase?.label ?? ''
})

/** 周期第 N 天 */
const dayIndex = computed(() => currentCycle.value?.day_index ?? 0)

/** 进度条填充比例（前端只做「已过多少天」的几何换算，不参与预测） */
const progressPct = computed(() => {
  const est = currentCycle.value?.estimated_length ?? 0
  if (!est || !dayIndex.value) return 0
  return Math.max(0, Math.min(100, (dayIndex.value / est) * 100))
})

/** 阶段 → 进度条填充色（令牌，不写死 hex） */
const progressColor = computed(() => {
  switch (phaseKey.value) {
    case 'menstrual':
      return 'var(--color-period)'
    case 'ovulation':
      return 'var(--color-ovulation)'
    case 'luteal':
      return 'var(--color-warning)'
    case 'follicular':
    default:
      return 'var(--color-primary)'
  }
})

/* ==================== 文案（04 §6）==================== */

const confidence = computed(() => props.prediction?.confidence ?? 'insufficient')
const nextPeriod = computed(() => props.prediction?.next_period ?? null)

/** 主文案 */
const mainText = computed(() => {
  const pred = props.prediction
  if (!pred) return ''
  if (props.masked) return PERIOD_MASK_TEXT
  if (confidence.value === 'insufficient') {
    return dayIndex.value ? `周期第 ${dayIndex.value} 天` : '开始记录你的周期'
  }
  const np = nextPeriod.value
  if (!np || np.overdue) return '预测窗口已过'
  if (confidence.value === 'low') {
    const [lo, hi] = np.window
    return lo === hi
      ? `预计 ${formatMonthDay(lo)}来月经`
      : `预计 ${formatMonthDay(lo)}–${formatMonthDay(hi)}来月经`
  }
  return `预计 ${formatMonthDay(np.date)}来月经`
})

/** 副文案 */
const subText = computed(() => {
  const pred = props.prediction
  if (!pred) return ''
  if (props.masked) return PERIOD_MASK_TEXT
  if (confidence.value === 'insufficient') return '再记录 1 个完整周期即可开启预测'
  const np = nextPeriod.value
  if (!np || np.overdue) return '记录今天的实际情况即可，预测会随之更新'
  if (confidence.value === 'low') {
    const cycles = pred.stats?.recent_cycles ?? []
    if (cycles.length >= 2) {
      const min = Math.min(...cycles)
      const max = Math.max(...cycles)
      return `你的周期波动较大（近 ${cycles.length} 个周期 ${min}–${max} 天），日期仅供参考`
    }
    return '你的周期波动较大，日期仅供参考'
  }
  if (np.days_until <= 0) return '预计就是今天'
  if (np.days_until === 1) return '还有 1 天'
  return `还有 ${np.days_until} 天`
})

/** 数据不足时的进度点：2 格表示「需要 2 个完整周期」 */
const insufficientDots = computed(() => {
  const have = Math.min(props.prediction?.sample_size ?? 0, 2)
  return [0, 1].map((i) => i < have)
})

/** 低置信度时多一行「记体温提准确度」的引导 */
const showBbtHint = computed(
  () => !props.masked && canShowDates.value && confidence.value === 'low'
)

/* ==================== 易孕期胶囊 ==================== */

/** `YYYY-MM-DD` → `M/D` */
function md(s?: string | null): string {
  if (!s) return ''
  const [, m, d] = s.split('-')
  if (!m || !d) return s
  return `${Number(m)}/${Number(d)}`
}

const fertileText = computed(() => {
  const fw = props.prediction?.fertile_window
  if (!fw) return ''
  const peak = fw.peak?.[0] && fw.peak?.[1] ? ` · 峰值 ${md(fw.peak[0])}–${md(fw.peak[1])}` : ''
  return `易孕期 ${md(fw.start)}–${md(fw.end)}${peak}`
})

const showFertile = computed(
  () => props.showFertile && !!fertileText.value && canShowDates.value
)
</script>

<template>
  <section class="ov-card">
    <!-- ==================== 顶部：阶段 + 图标组 ==================== -->
    <div class="ov-top">
      <div class="ov-top-left">
        <span v-if="phaseLabel" class="ov-phase">{{ props.masked ? PERIOD_MASK_TEXT : phaseLabel }}</span>
        <span v-else-if="canShowDates" class="ov-phase">{{ dayIndex ? `周期第 ${dayIndex} 天` : '' }}</span>
      </div>

      <div class="ov-icons">
        <button
          class="ov-icon"
          type="button"
          :aria-label="masked ? '显示敏感内容' : '隐藏敏感内容'"
          :aria-pressed="masked"
          @click="emit('toggle-mask')"
        >
          <Icon :name="masked ? 'EyeOff' : 'Eye'" :size="18" :class="masked ? 'is-on' : ''" />
        </button>
        <button class="ov-icon" type="button" aria-label="预测依据" @click="emit('show-info')">
          <Icon name="Info" :size="18" />
        </button>
        <button class="ov-icon" type="button" aria-label="经期设置" @click="emit('go-settings')">
          <Icon name="Settings" :size="18" />
        </button>
      </div>
    </div>

    <!-- 周期第 N 天（阶段名已占位时不重复；遮罩态不显示天数） -->
    <div v-if="dayIndex && canShowDates && !masked" class="ov-day">周期第 {{ dayIndex }} 天</div>

    <!-- ==================== 进度条 ==================== -->
    <div v-if="dayIndex && canShowDates" class="ov-bar" role="img" aria-label="本周期进度">
      <div class="ov-bar-fill" :style="{ width: `${progressPct}%`, background: progressColor }" />
      <div class="ov-bar-knob" :style="{ left: `${progressPct}%` }" />
    </div>

    <!-- ==================== 主 / 副文案 ==================== -->
    <p class="ov-main" :class="{ 'is-masked': masked }">{{ mainText }}</p>
    <p class="ov-sub" :class="{ 'is-masked': masked }">{{ subText }}</p>

    <!-- 数据不足：显示「还差几个周期」的点 -->
    <div v-if="!masked && confidence === 'insufficient'" class="ov-dots" aria-hidden="true">
      <span v-for="(filled, i) in insufficientDots" :key="i" class="ov-dot" :class="{ 'is-on': filled }" />
    </div>

    <!-- 低置信度引导：记体温提准确度 -->
    <button v-if="showBbtHint" class="ov-hint-link" type="button" @click="emit('show-info')">
      可记录基础体温提高准确度 ›
    </button>

    <!-- ==================== 易孕期胶囊 ==================== -->
    <button
      v-if="showFertile"
      class="ov-fertile"
      type="button"
      @click="emit('show-fertile-info')"
    >
      <Icon name="Sparkles" :size="13" />
      <span>{{ masked ? PERIOD_MASK_TEXT : fertileText }}</span>
    </button>
  </section>
</template>

<style lang="scss" scoped>
.ov-card {
  /* 高度在遮罩开关下保持不变：只换文字，不折叠结构 */
  position: relative;
  padding: var(--space-5);
  background: var(--color-bg-card);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-xs);
  margin-bottom: var(--space-3);
}

/* ==================== 顶部 ==================== */
.ov-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-2);
  min-height: 40px;
}
.ov-top-left {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  padding-top: 8px;
}
.ov-phase {
  font-size: var(--fs-h3);
  font-weight: 600;
  color: var(--color-text-primary);
}

.ov-icons {
  flex-shrink: 0;
  display: flex;
  gap: var(--space-2);
}
.ov-icon {
  /* 触控热区 40×40，图标 18px */
  width: 40px;
  height: 40px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  background: transparent;
  padding: 0;
  border-radius: var(--radius-base);
  color: var(--color-text-tertiary);
  -webkit-tap-highlight-color: transparent;

  :deep(svg) { display: block; }
  &.is-on { color: var(--color-primary); }
  &:active { background: var(--color-bg-hover); }
}

.ov-day {
  margin-top: -6px;
  font-size: var(--fs-caption);
  color: var(--color-text-tertiary);
}

/* ==================== 进度条 ==================== */
.ov-bar {
  position: relative;
  height: 6px;
  margin: var(--space-4) 0 var(--space-3);
  border-radius: var(--radius-pill);
  background: var(--color-border-light);
}
.ov-bar-fill {
  height: 100%;
  border-radius: var(--radius-pill);
  transition: width var(--duration-base, 260ms) var(--ease-default);
}
.ov-bar-knob {
  position: absolute;
  top: 50%;
  width: 10px;
  height: 10px;
  margin-left: -5px;
  transform: translateY(-50%);
  border-radius: 50%;
  background: var(--color-bg-card);
  border: 2px solid var(--color-text-primary);
  box-sizing: border-box;
}

/* ==================== 主 / 副文案 ==================== */
.ov-main {
  margin: 0;
  font-size: var(--fs-metric);
  font-weight: 600;
  font-family: var(--font-num);
  font-variant-numeric: tabular-nums;
  color: var(--color-text-primary);
  line-height: 1.3;

  &.is-masked {
    font-family: inherit;
    letter-spacing: 2px;
    color: var(--color-text-disabled);
  }
}
.ov-sub {
  margin: 4px 0 0;
  font-size: var(--fs-caption);
  color: var(--color-text-tertiary);
  line-height: 1.45;

  &.is-masked {
    letter-spacing: 2px;
    color: var(--color-text-disabled);
  }
}

/* ==================== 数据不足的点 ==================== */
.ov-dots {
  display: flex;
  gap: 5px;
  margin-top: 10px;
}
.ov-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  border: 1.5px solid var(--color-border-strong);
  box-sizing: border-box;

  &.is-on {
    border-color: var(--color-primary);
    background: var(--color-primary);
  }
}

/* ==================== 低置信度引导链接 ==================== */
.ov-hint-link {
  display: inline-block;
  margin-top: 10px;
  padding: 0;
  border: 0;
  background: transparent;
  font-size: var(--fs-caption-sm);
  color: var(--color-primary);
  text-align: left;

  &:active { opacity: 0.7; }
}

/* ==================== 易孕期胶囊 ==================== */
.ov-fertile {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin-top: var(--space-3);
  padding: 5px 10px;
  border: 0;
  border-radius: var(--radius-pill);
  background: var(--color-fertile-soft);
  color: var(--color-fertile-strong);
  font-size: var(--fs-caption-sm);
  font-weight: 500;

  :deep(svg) { display: block; }
  &:active { opacity: 0.85; }
}
</style>
