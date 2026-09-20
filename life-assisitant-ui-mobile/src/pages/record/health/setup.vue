<script setup lang="ts">
/**
 * 健康设置向导页（移动端 · 全屏 sub-page）
 *
 * 顶层路由（不挂 HomeLayout）：二级页自己管滚动（理由见 router/index.ts）。
 *
 * 两步的取舍（照抄经期向导）：
 *   1. 提交走**一次** `POST /health/setup`，不在中途落库。
 *   2. 「跳过」**不写**任何后端状态（否则「跳过→立刻被推回引导」死循环），只在内存标记；
 *      下次进入若仍 !initialized 会再弹引导。回跳前把 `ui.recordTab` 置为 'health'。
 *
 * 内容：勾选指标（默认 DEFAULT_ENABLED_METRICS，sex 默认关）+ 饮水目标（Slider）
 *     + 体重目标（选填）+ 勾选 period 时的经期初始化（复用 /period/setup 的参数）。
 */
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useHealthStore } from '@/stores/health'
import { useUiStore } from '@/stores/ui'
import {
  DEFAULT_ENABLED_METRICS,
  DEFAULT_WATER_GOAL_ML,
  HEALTH_METRICS,
  WATER_GOAL_ML_MAX,
  WATER_GOAL_ML_MIN,
  WATER_GOAL_ML_STEP,
  DEFAULT_WATER_STEP_ML,
  WATER_STEP_ML_MAX,
  WATER_STEP_ML_MIN,
  WATER_STEP_ML_STEP,
} from '@/constants/health'
import { PERIOD_GOAL_OPTIONS } from '@/constants/period'
import { addDays, todayDate } from '@/utils/date'
import type { HealthSetupReq } from '@/api/types'

const router = useRouter()
const store = useHealthStore()
const ui = useUiStore()

const selectedMetrics = ref<string[]>([...DEFAULT_ENABLED_METRICS])
const waterGoal = ref(DEFAULT_WATER_GOAL_ML)
/** 「一杯」多大：快捷加水的步进，之后可在设置里改 */
const waterStep = ref(DEFAULT_WATER_STEP_ML)
const weightGoal = ref<number | null>(null)

function isOn(key: string): boolean {
  return selectedMetrics.value.includes(key)
}
function toggleMetric(key: string, on: boolean): void {
  if (on) {
    if (!selectedMetrics.value.includes(key)) selectedMetrics.value = [...selectedMetrics.value, key]
  } else {
    selectedMetrics.value = selectedMetrics.value.filter((k) => k !== key)
  }
}

/** 勾选 period 时才出现经期初始化段 */
const periodEnabled = computed(() => isOn('period'))

const lastPeriodStart = ref(addDays(todayDate(), -28))
const avgPeriodLength = ref(5)
const avgCycleLength = ref(28)
const goal = ref(2)
const maxDate = computed(() => todayDate())

const submitting = ref(false)

async function submit(): Promise<void> {
  submitting.value = true
  const req: HealthSetupReq = {
    metrics_enabled: [...selectedMetrics.value],
    water_goal_ml: waterGoal.value,
    water_step_ml: waterStep.value,
    weight_goal_kg: weightGoal.value,
  }
  if (periodEnabled.value) {
    req.period = {
      last_period_start: lastPeriodStart.value,
      avg_period_length: avgPeriodLength.value,
      avg_cycle_length: avgCycleLength.value,
      goal: goal.value,
      show_fertile_window: 1,
    }
  }
  const ok = await store.setup(req)
  submitting.value = false
  if (ok) backToRecord()
}

function skip(): void {
  // 只标记「本次会话已跳过」，不写后端（避免「跳过→立刻被推回引导」死循环）
  store.skipSetup()
  backToRecord()
}

function backToRecord(): void {
  ui.recordTab = 'health'
  router.replace('/record')
}
</script>

<template>
  <div class="sub-page">
    <header class="sub-header">
      <button class="sub-back" type="button" aria-label="返回" @click="backToRecord">‹</button>
      <h2 class="sub-title">健康引导</h2>
      <button class="sub-skip" type="button" @click="skip">先看看</button>
    </header>

    <main class="sub-body">
      <!-- ==================== 选择指标 ==================== -->
      <section class="card">
        <h3 class="card-title">记录哪些指标</h3>
        <p class="field-hint">勾选你关心的维度，之后随时可在设置里增减。关闭的指标只是隐藏入口，历史数据会保留。</p>
        <div
          v-for="m in HEALTH_METRICS"
          :key="m.key"
          class="m-row"
        >
          <span class="m-body">
            <span class="m-label">{{ m.name }}</span>
            <span class="m-sub">{{ m.group === 'privacy' ? '私密 · 默认关闭' : '' }}</span>
          </span>
          <van-switch
            :model-value="isOn(m.key)"
            size="22"
            @update:model-value="(v: boolean) => toggleMetric(m.key, v)"
          />
        </div>
      </section>

      <!-- ==================== 饮水目标 ==================== -->
      <section class="card">
        <h3 class="card-title">每日饮水目标</h3>
        <div class="slider-row">
          <van-slider
            v-model="waterGoal"
            :min="WATER_GOAL_ML_MIN"
            :max="WATER_GOAL_ML_MAX"
            :step="WATER_GOAL_ML_STEP"
            active-color="var(--color-info)"
          />
          <span class="slider-val">{{ waterGoal }}ml</span>
        </div>
        <p class="field-hint">区间 {{ WATER_GOAL_ML_MIN }}–{{ WATER_GOAL_ML_MAX }}ml，步进 {{ WATER_GOAL_ML_STEP }}ml。</p>
      </section>

      <!-- ==================== 一杯多大（快捷加水步进）==================== -->
      <section class="card">
        <h3 class="card-title">一杯是多少</h3>
        <p class="field-hint">
          快捷加减按这个量走。设成你常用的杯子容量，喝一杯点一下就行；之后可在设置里改。
        </p>
        <div class="slider-row">
          <van-slider
            v-model="waterStep"
            :min="WATER_STEP_ML_MIN"
            :max="WATER_STEP_ML_MAX"
            :step="WATER_STEP_ML_STEP"
            active-color="var(--color-info)"
          />
          <span class="slider-val">{{ waterStep }}ml</span>
        </div>
        <p class="field-hint">
          当前快捷档：+1 杯 {{ waterStep }}ml / +2 杯 {{ waterStep * 2 }}ml。
        </p>
      </section>

      <!-- ==================== 体重目标（选填） ==================== -->
      <section class="card">
        <h3 class="card-title">体重目标（选填）</h3>
        <input
          v-model.number="weightGoal"
          class="num-input"
          type="number"
          inputmode="decimal"
          step="0.1"
          min="20"
          max="300"
          placeholder="例如 55.0"
        >
        <p class="field-hint">用于概览卡对比，不填则不显示目标线。</p>
      </section>

      <!-- ==================== 经期初始化（勾选 period 时） ==================== -->
      <section v-if="periodEnabled" class="card">
        <h3 class="card-title">经期冷启动</h3>
        <p class="field-hint">顺手填一下，预测会更准；之后都能改。</p>

        <div class="m-field">
          <label class="m-field-label">上次月经是几号来的？</label>
          <input v-model="lastPeriodStart" class="date-input" type="date" :max="maxDate">
        </div>

        <div class="m-field">
          <div class="m-field-label">
            <span>一般来几天？</span>
            <span class="m-field-val">{{ avgPeriodLength }} 天</span>
          </div>
          <van-stepper v-model="avgPeriodLength" :min="1" :max="15" integer />
        </div>

        <div class="m-field">
          <div class="m-field-label">
            <span>周期大概多少天？</span>
            <span class="m-field-val">{{ avgCycleLength }} 天</span>
          </div>
          <van-stepper v-model="avgCycleLength" :min="15" :max="60" integer />
        </div>

        <div class="m-field">
          <span class="m-field-label">主要想做什么？</span>
          <button
            v-for="g in PERIOD_GOAL_OPTIONS"
            :key="g.value"
            type="button"
            class="goal-row"
            :class="{ 'is-on': goal === g.value }"
            @click="goal = g.value"
          >
            <span class="goal-body">
              <span class="goal-label">{{ g.label }}</span>
              <span class="goal-desc">{{ g.desc }}</span>
            </span>
            <span class="goal-radio" :class="{ 'is-on': goal === g.value }" />
          </button>
        </div>
      </section>

      <button class="btn btn-primary" type="button" :disabled="submitting" @click="submit">
        {{ submitting ? '保存中…' : '完成' }}
      </button>
    </main>
  </div>
</template>

<style lang="scss" scoped>
@use '@/styles/subpage.scss' as *;

.sub-skip {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 6px 10px;
  border: 0;
  border-radius: var(--radius-pill);
  background: var(--color-bg-hover);
  font-size: var(--fs-caption-sm);
  color: var(--color-text-secondary);

  :deep(svg) { display: block; }
  &:active { opacity: 0.8; }
}

/* 指标行 */
.m-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 0;

  & + .m-row { border-top: 1px solid var(--color-border-light); }
}
.m-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.m-label {
  font-size: var(--fs-body-sm);
  font-weight: 500;
  color: var(--color-text-primary);
}
.m-sub {
  font-size: var(--fs-micro);
  color: var(--color-text-tertiary);
}

/* 饮水滑块 */
.slider-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) 4px 0;
}
.slider-row :deep(.van-slider) {
  flex: 1;
}
.slider-val {
  flex-shrink: 0;
  font-size: var(--fs-body-sm);
  font-weight: 600;
  font-family: var(--font-num);
  color: var(--color-text-primary);
  font-variant-numeric: tabular-nums;
}

/* 数字 / 日期输入 */
.num-input {
  width: 100%;
  margin-top: var(--space-3);
  box-sizing: border-box;
  height: 42px;
  padding: 0 12px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-base);
  background: var(--color-bg-hover);
  font-size: var(--fs-body-sm);
  font-family: var(--font-num);
  color: var(--color-text-primary);
  outline: none;

  &::placeholder { color: var(--color-text-placeholder); }
  &:focus { border-color: var(--color-primary); }
}
.m-field {
  padding: var(--space-3) 0;
  border-top: 1px solid var(--color-border-light);

  &:first-of-type { border-top: 0; padding-top: var(--space-2); }
}
.m-field-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: var(--fs-caption-sm);
  color: var(--color-text-secondary);
  margin-bottom: 8px;
}
.m-field-val {
  font-family: var(--font-num);
  font-weight: 600;
  color: var(--color-text-primary);
}
.date-input {
  width: 100%;
  height: 38px;
  padding: 0 10px;
  box-sizing: border-box;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-base);
  background: var(--color-bg-card);
  font-size: var(--fs-caption-sm);
  font-family: var(--font-num);
  color: var(--color-text-primary);
  outline: none;

  &:focus { border-color: var(--color-primary); }
}

/* 目标模式 */
.goal-row {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: 12px 0;
  border: 0;
  background: transparent;
  text-align: left;

  & + .goal-row { border-top: 1px solid var(--color-border-light); }
}
.goal-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.goal-label {
  font-size: var(--fs-body-sm);
  font-weight: 500;
  color: var(--color-text-primary);
}
.goal-desc {
  font-size: var(--fs-caption-sm);
  color: var(--color-text-tertiary);
  line-height: 1.4;
}
.goal-radio {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: 1.5px solid var(--color-border-strong);
  box-sizing: border-box;

  &.is-on {
    border-color: var(--color-primary);
    background: radial-gradient(circle, var(--color-primary) 0 5px, transparent 5px 100%);
  }
}
</style>
