<script setup lang="ts">
/**
 * 健康设置页（移动端 · 全屏 sub-page）
 *
 * 由经期设置页（src/pages/record/period/settings.vue）改造而来，但表单本体自绘：
 * 指标开关 + 饮水目标（Slider）+ 一杯容量（Slider）+ 体重目标。
 *
 * ⚠️ 经期设置**已并入本页**（底部「经期与周期」段直接嵌入 PeriodSettingsForm），
 *    个人中心不再有独立的经期设置入口 —— 两套经期设置并存是老大 260919 复核 spec
 *    时指出的偏差。
 *
 * ⚠️ 关闭指标只隐藏 UI 入口，**历史数据保留**（PATCH 只传 metrics_enabled，
 *    后端不删任何已记录数据）。每条开关/滑块改动即时走 `PATCH /health/settings`，
 *    响应直接替换本地 settings。
 */
import { ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useHealthStore } from '@/stores/health'
import PeriodSettingsForm from '@/components/period/PeriodSettingsForm.vue'
import {
  DEFAULT_ENABLED_METRICS,
  DEFAULT_WATER_GOAL_ML,
  HEALTH_METRICS,
  WATER_GOAL_ML_MAX,
  WATER_GOAL_ML_MIN,
  WATER_GOAL_ML_STEP,
  WATER_STEP_ML_MAX,
  WATER_STEP_ML_MIN,
  WATER_STEP_ML_STEP,
  DEFAULT_WATER_STEP_ML,
} from '@/constants/health'

const router = useRouter()
const store = useHealthStore()

const metricsEnabled = ref<string[]>([...DEFAULT_ENABLED_METRICS])
const waterGoal = ref(DEFAULT_WATER_GOAL_ML)
/** 「一杯」多大：快捷加水的步进 */
const waterStep = ref(DEFAULT_WATER_STEP_ML)
const weightGoal = ref<number | null>(null)

const settingsLoaded = ref(false)

/** 进入页面若 store 还没有 settings，主动拉一次 */
void (async () => {
  if (!store.settings) await store.fetchSettings()
  const s = store.settings
  if (s) {
    metricsEnabled.value = [...s.metrics_enabled]
    waterGoal.value = s.water_goal_ml
    waterStep.value = s.water_step_ml || DEFAULT_WATER_STEP_ML
    weightGoal.value = s.weight_goal_kg ?? null
  }
  settingsLoaded.value = true
})()

watch(
  () => store.settings,
  (s) => {
    if (!s) return
    metricsEnabled.value = [...s.metrics_enabled]
    waterGoal.value = s.water_goal_ml
    waterStep.value = s.water_step_ml || DEFAULT_WATER_STEP_ML
    weightGoal.value = s.weight_goal_kg ?? null
  },
  { deep: true },
)

function isOn(key: string): boolean {
  return metricsEnabled.value.includes(key)
}

async function onToggleMetric(key: string, on: boolean): Promise<void> {
  const next = on
    ? [...new Set([...metricsEnabled.value, key])]
    : metricsEnabled.value.filter((k) => k !== key)
  metricsEnabled.value = next
  await store.patchSettings({ metrics_enabled: next })
}

async function onWaterChange(v: number): Promise<void> {
  waterGoal.value = v
  await store.patchSettings({ water_goal_ml: v })
}

async function onWaterStepChange(v: number): Promise<void> {
  waterStep.value = v
  await store.patchSettings({ water_step_ml: v })
}

async function commitWeight(): Promise<void> {
  const raw = weightGoal.value
  if (raw == null) {
    await store.patchSettings({ weight_goal_kg: null })
    return
  }
  if (!Number.isFinite(raw) || raw < 20 || raw > 300) {
    weightGoal.value = store.settings?.weight_goal_kg ?? null
    return
  }
  await store.patchSettings({ weight_goal_kg: Math.round(raw * 10) / 10 })
}

function back(): void {
  router.back()
}
</script>

<template>
  <div class="sub-page">
    <header class="sub-header">
      <button class="sub-back" type="button" aria-label="返回" @click="back">‹</button>
      <h2 class="sub-title">健康设置</h2>
    </header>

    <main class="sub-body">
      <div v-if="!settingsLoaded" class="skeleton" />

      <template v-else>
        <!-- ==================== 指标开关 ==================== -->
        <section class="card">
          <h3 class="card-title">记录指标</h3>
          <p class="field-hint">关闭的指标只是隐藏入口，已记录的历史数据会保留。</p>
          <div v-for="m in HEALTH_METRICS" :key="m.key" class="m-row">
            <span class="m-body">
              <span class="m-label">{{ m.name }}</span>
              <span class="m-sub">{{ m.group === 'privacy' ? '私密 · 默认关闭' : '' }}</span>
            </span>
            <van-switch
              :model-value="isOn(m.key)"
              size="22"
              @update:model-value="(v: boolean) => onToggleMetric(m.key, v)"
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
              @change="onWaterChange"
            />
            <span class="slider-val">{{ waterGoal }}ml</span>
          </div>
          <p class="field-hint">区间 {{ WATER_GOAL_ML_MIN }}–{{ WATER_GOAL_ML_MAX }}ml，步进 {{ WATER_GOAL_ML_STEP }}ml。</p>
        </section>

        <!-- ==================== 一杯多大（快捷加水步进）==================== -->
        <section class="card">
          <h3 class="card-title">一杯是多少</h3>
          <p class="field-hint">
            快捷加减就按这个量走。每个人的杯子不一样，设成你常用的那个容量，
            喝一杯点一下就行。
          </p>
          <div class="slider-row">
            <van-slider
              v-model="waterStep"
              :min="WATER_STEP_ML_MIN"
              :max="WATER_STEP_ML_MAX"
              :step="WATER_STEP_ML_STEP"
              active-color="var(--color-info)"
              @change="onWaterStepChange"
            />
            <span class="slider-val">{{ waterStep }}ml</span>
          </div>
          <p class="field-hint">
            区间 {{ WATER_STEP_ML_MIN }}–{{ WATER_STEP_ML_MAX }}ml，步进 {{ WATER_STEP_ML_STEP }}ml。
            当前快捷档：+1 杯 {{ waterStep }}ml / +2 杯 {{ waterStep * 2 }}ml。
          </p>
        </section>

        <!-- ==================== 体重目标 ==================== -->
        <section class="card">
          <h3 class="card-title">体重目标</h3>
          <input
            v-model.number="weightGoal"
            class="num-input"
            type="number"
            inputmode="decimal"
            step="0.1"
            min="20"
            max="300"
            placeholder="例如 55.0（留空 = 不设目标）"
            @blur="commitWeight"
            @keyup.enter="($event.target as HTMLInputElement).blur()"
          >
          <p class="field-hint">用于概览卡对比，不填则不显示目标线。</p>
        </section>

        <!-- ==================== 经期与周期 ====================
             ⚠️ 经期设置**已并入健康设置**，个人中心与记录页不再有独立的经期设置页
             （老大 260919 复核 spec 指出的偏差：两套经期设置并存）。
             只在「经期」指标开启时显示 —— 关掉指标只隐藏入口，历史数据保留。 -->
        <section v-if="isOn('period')" class="card">
          <h3 class="card-title">经期与周期</h3>
          <p class="field-hint">
            周期参数、预测开关与「重新设置向导」都在这里。关闭上面的「经期」指标只会隐藏入口，
            已记录的经期数据会保留。
          </p>
          <PeriodSettingsForm />
        </section>
      </template>
    </main>
  </div>
</template>

<style lang="scss" scoped>
@use '@/styles/subpage.scss' as *;

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
</style>
