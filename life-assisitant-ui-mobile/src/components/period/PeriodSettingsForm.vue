<script setup lang="ts">
/**
 * 经期设置表单（移动端）
 *
 * SYNC-FROM-DESKTOP: life-assisitant-ui-desktop/src/pages/record/period/components/PeriodSettingsDrawer.tsx
 * SYNC-FROM-BACKEND: life-assisitant-api/internal/model/dto/period.go（PeriodSettings / PeriodSettingsPatchReq）
 * 契约文档：md/spec-260919/04-页面与交互设计.md §1（双入口）、§7.5
 *
 * 双入口：经期 Tab 概览卡右上角 ⚙ + 「我的 → 经期设置」，两处**共用权限**
 * （period:view / period:write），不新增按钮级权限点。
 *
 * 所有改动走 `PATCH /period/settings`（部分更新），响应直接替换本地值。
 * 「重新设置向导」跳 /record/period/setup（同一份向导，帮助页也复用）。
 *
 * 日期选择用**原生 `<input type="date">`**：`max` 直接锁住「不能选未来」，
 * 且不需要为三个 stepper 拼一个月历。真机（iOS/Android WebView）上原生选择器
 * 的手感反而比自绘更好。
 */
import { computed, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { showConfirmDialog } from 'vant'
import { usePeriodStore } from '@/stores/period'
import { PERIOD_GOAL_OPTIONS } from '@/constants/period'
import { todayDate } from '@/utils/date'
import type { PeriodSettings } from '@/api/types'

const router = useRouter()
const store = usePeriodStore()

const s = computed<PeriodSettings | null>(() => store.settings)

const form = reactive<{
  goal: number
  avgCycle: number
  avgPeriod: number
  luteal: number
  showFertile: number
  irregularAlert: number
  lastStart: string
}>({
  goal: 2,
  avgCycle: 28,
  avgPeriod: 5,
  luteal: 14,
  showFertile: 1,
  irregularAlert: 1,
  lastStart: '',
})

/** 从 store 回填（进入页面 / PATCH 成功后同步） */
function syncFromSettings(v: PeriodSettings | null): void {
  if (!v) return
  form.goal = v.goal
  form.avgCycle = v.avg_cycle_length
  form.avgPeriod = v.avg_period_length
  form.luteal = v.luteal_length
  form.showFertile = v.show_fertile_window
  form.irregularAlert = v.irregular_alert
  form.lastStart = v.last_period_start ?? ''
}

watch(s, (v) => syncFromSettings(v), { immediate: true })

/** 首次进入若 store 还没有 settings，主动拉一次 */
const loading = ref(!store.settings)
void (async () => {
  if (!store.settings) {
    await store.fetchSettings()
    loading.value = false
  }
})()

const maxDate = computed(() => todayDate())

/* ==================== 保存 ==================== */

async function patch(partial: Record<string, unknown>): Promise<void> {
  await store.patchSettings(partial)
}

async function onGoal(v: number): Promise<void> {
  if (form.goal === v) return
  form.goal = v
  await patch({ goal: v })
}

async function onCycleChange(v: number): Promise<void> {
  await patch({ avg_cycle_length: v })
}

async function onPeriodChange(v: number): Promise<void> {
  await patch({ avg_period_length: v })
}

async function onLutealChange(v: number): Promise<void> {
  await patch({ luteal_length: v })
}

async function onFertileChange(v: number): Promise<void> {
  await patch({ show_fertile_window: v })
}

async function onAlertChange(v: number): Promise<void> {
  await patch({ irregular_alert: v })
}

async function onLastStartChange(): Promise<void> {
  if (!form.lastStart) return
  await patch({ last_period_start: form.lastStart })
}

/* ==================== 跳转 / 危险操作 ==================== */

function openWizard(): void {
  router.push('/record/period/setup')
}

async function onReset(): Promise<void> {
  try {
    await showConfirmDialog({
      title: '清空经期数据',
      message: '将删除全部经期记录、周期划分与设置，且无法恢复。确定继续吗？',
      confirmButtonText: '清空',
      confirmButtonColor: 'var(--color-danger)',
    })
  } catch {
    return
  }
  try {
    await showConfirmDialog({
      title: '再次确认',
      message: '这是不可逆操作。真的要清空全部经期数据吗？',
      confirmButtonText: '确认清空',
      confirmButtonColor: 'var(--color-danger)',
    })
  } catch {
    return
  }
  await store.reset()
}
</script>

<template>
  <div class="psf">
    <div v-if="loading" class="skeleton" />

    <template v-else>
      <!-- ==================== 目标 ==================== -->
      <section class="card">
        <h3 class="card-title">使用目标</h3>
        <p class="field-hint">只影响默认展示顺序与提示文案，不会关闭任何功能。</p>
        <button
          v-for="g in PERIOD_GOAL_OPTIONS"
          :key="g.value"
          type="button"
          class="goal-row"
          :class="{ 'is-on': form.goal === g.value }"
          @click="onGoal(g.value)"
        >
          <span class="goal-body">
            <span class="goal-label">{{ g.label }}</span>
            <span class="goal-desc">{{ g.desc }}</span>
          </span>
          <span class="goal-radio" :class="{ 'is-on': form.goal === g.value }" />
        </button>
      </section>

      <!-- ==================== 周期参数 ==================== -->
      <section class="card">
        <h3 class="card-title">周期参数</h3>

        <div class="row">
          <span class="row-body">
            <span class="row-label">平均周期长度</span>
            <span class="row-sub">两次月经第一天的间隔，15–60 天</span>
          </span>
          <van-stepper v-model="form.avgCycle" :min="15" :max="60" integer @change="onCycleChange" />
        </div>

        <div class="row">
          <span class="row-body">
            <span class="row-label">平均经期长度</span>
            <span class="row-sub">每次出血持续天数，1–15 天</span>
          </span>
          <van-stepper v-model="form.avgPeriod" :min="1" :max="15" integer @change="onPeriodChange" />
        </div>

        <div class="row">
          <span class="row-body">
            <span class="row-label">黄体期长度</span>
            <span class="row-sub">排卵到下次月经的天数，9–16 天</span>
          </span>
          <van-stepper v-model="form.luteal" :min="9" :max="16" integer @change="onLutealChange" />
        </div>

        <div class="row">
          <span class="row-body">
            <span class="row-label">上次月经开始日</span>
            <span class="row-sub">用于冷启动推算，可随时修正</span>
          </span>
          <input
            v-model="form.lastStart"
            class="date-input"
            type="date"
            :max="maxDate"
            @change="onLastStartChange"
          >
        </div>
      </section>

      <!-- ==================== 展示与提醒 ==================== -->
      <section class="card">
        <h3 class="card-title">展示与提醒</h3>

        <div class="row">
          <span class="row-body">
            <span class="row-label">显示易孕期</span>
            <span class="row-sub">关闭后概览卡与月历都不再标出易孕期</span>
          </span>
          <van-switch
            v-model="form.showFertile"
            :active-value="1"
            :inactive-value="0"
            size="22"
            @change="onFertileChange"
          />
        </div>

        <div class="row">
          <span class="row-body">
            <span class="row-label">周期异常提醒</span>
            <span class="row-sub">周期过短/过长、经期过长等自动提示</span>
          </span>
          <van-switch
            v-model="form.irregularAlert"
            :active-value="1"
            :inactive-value="0"
            size="22"
            @change="onAlertChange"
          />
        </div>
      </section>

      <!-- ==================== 向导 / 重置 ==================== -->
      <section class="card">
        <h3 class="card-title">其他</h3>
        <button class="link-row" type="button" @click="openWizard">
          重新运行设置向导
          <span class="link-arrow">›</span>
        </button>
        <button class="danger-row" type="button" @click="onReset">清空经期数据</button>
        <p class="field-hint">
          清空会删除全部经期记录与周期划分，无法恢复。若只是想重新填写参数，用上面的设置向导即可。
        </p>
      </section>
    </template>
  </div>
</template>

<style lang="scss" scoped>
/* 本组件用到 .card / .row / .field-hint / .skeleton 等公共类。
   它们来自 subpage.scss —— 而父页面的 scoped 样式**不会**作用到子组件内部，
   所以这里必须自己 @use 一份（scoped 会把选择器限到本组件，不会外泄）。 */
@use '@/styles/subpage.scss' as *;

.psf { display: block; }

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

/* 原生日期输入 */
.date-input {
  flex-shrink: 0;
  height: 34px;
  padding: 0 8px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-base);
  background: var(--color-bg-card);
  font-size: var(--fs-caption-sm);
  font-family: var(--font-num);
  color: var(--color-text-primary);
  outline: none;

  &:focus { border-color: var(--color-primary); }
}

/* 链接 / 危险行 */
.link-row {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 0;
  border: 0;
  background: transparent;
  font-size: var(--fs-body-sm);
  color: var(--color-text-primary);
  border-bottom: 1px solid var(--color-border-light);

  &:active { opacity: 0.7; }
}
.link-arrow {
  font-size: 18px;
  color: var(--color-text-disabled);
  line-height: 1;
}
.danger-row {
  width: 100%;
  margin-top: var(--space-3);
  padding: 11px 0;
  border: 0;
  border-radius: var(--radius-lg);
  background: var(--color-danger-light);
  color: var(--color-danger-dark);
  font-size: var(--fs-body-sm);
  font-weight: 600;

  &:active { opacity: 0.85; }
}
</style>
