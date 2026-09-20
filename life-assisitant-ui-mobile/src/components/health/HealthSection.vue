<script setup lang="ts">
/**
 * 健康 Tab 主容器（移动端）
 *
 * 整页顺序（02 §3 / §12.2 三次修订）：
 *   ① 今日健康（分类卡：值展示 + 录入入口）
 *   ② 今日心情（MoodSection，已内嵌）
 *   ③ 今日时间轴（HealthTodayTimeline）
 *   ④ 月历（翻历史）
 *   ⑤ FAB（在 record/index.vue，经 ref.openToday 打开完整浮层）
 *
 * ⚠️ 心情上移 + 合并「今日健康/快捷记录」为同一块（02 §16.7）：
 *   - MoodSection 从 record/index.vue 移入本组件内部渲染（位置由一处集中管理）；
 *   - 旧的「记录今天」按钮删除（与 FAB 重复），快捷记录并入今日健康分类卡。
 *
 * ⚠️ 本组件只负责编排，数据读写全部经 useHealthStore；记录浮层独立封装在
 *    HealthDaySheet，按 settings.metrics_enabled 动态组装分页，支持 metricKey 直达。
 *
 * ⚠️ 不硬写页面高度：本组件在 HomeLayout 的滚动容器内作为普通流内容渲染，
 *    高度由内容撑开（遵循移动端布局铁律）。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useHealthStore } from '@/stores/health'
import { todayDate } from '@/utils/date'
import HealthOverviewCard from './HealthOverviewCard.vue'
import HealthCalendar from './HealthCalendar.vue'
import HealthTodayTimeline from './HealthTodayTimeline.vue'
import HealthDaySheet from './HealthDaySheet.vue'
import MoodSection from '@/components/MoodSection.vue'

const router = useRouter()
const store = useHealthStore()

const currentMonth = computed(() => (store.today || todayDate()).slice(0, 7))

/** 展示月份（与 store.calendarMonth 双向同步） */
const month = computed(() => store.calendarMonth || currentMonth.value)

const calDays = computed(
  () => store.calendarCache[store.calendarMonth]?.days ?? [],
)

/** 摘要条仅在看「本月」时显示（overview 的 month_summary 只覆盖当前月） */
const summary = computed(() =>
  month.value === currentMonth.value ? store.monthSummary : null,
)

/* ==================== 记录浮层 ==================== */
const sheetShow = ref(false)
const sheetDate = ref('')
const sheetMetric = ref('')
const sheetInitialPage = ref(0)

function openSheet(date: string, metricKey = '', initialPage = 0): void {
  sheetDate.value = date
  sheetMetric.value = metricKey
  sheetInitialPage.value = initialPage
  sheetShow.value = true
}

/** 点击分类卡某行 → 打开浮层并直达该指标那一页 */
function openMetric(date: string, key: string): void {
  openSheet(date, key, 0)
}

/** 供父页 FAB 通过 ref 调用（打开今天，落第一页） */
function openToday(): void {
  const d = store.selectedDate || store.today || todayDate()
  store.selectedDate = d
  openSheet(d, '', 0)
}

function onPickDay(date: string): void {
  store.selectedDate = date
  openSheet(date)
}

function onRecordToday(): void {
  const d = store.selectedDate || store.today || todayDate()
  store.selectedDate = d
  openSheet(d)
}

function onSetup(): void {
  router.push('/record/health/setup')
}

function onSettings(): void {
  router.push('/record/health/settings')
}

function onChangeMonth(m: string): void {
  void store.fetchCalendar(m)
}

/** 分类卡点击事件：设置 / 直达某指标 */
function onOpenSettings(): void {
  onSettings()
}
function onOpenMetric(key: string): void {
  const d = store.selectedDate || store.today || todayDate()
  openMetric(d, key)
}

/* ==================== 生命周期 ==================== */
onMounted(async () => {
  await store.fetchOverview()
  await store.fetchCalendar(currentMonth.value)
})

watch(
  () => store.calendarMonth,
  (m) => {
    if (m) void store.fetchCalendar(m)
  },
)

defineExpose({ openToday })
</script>

<template>
  <div class="health-section">
    <!-- ==================== 引导入口卡（未初始化） ==================== -->
    <section v-if="!store.initialized && store.loaded" class="hs-guide">
      <div class="hs-guide-icon">❤</div>
      <h3 class="hs-guide-title">记录你的身体节律</h3>
      <p class="hs-guide-desc">
        经期、症状、心情、睡眠、体重、饮水、排便……一次勾选你关心的指标，每天花一分钟打卡。
      </p>
      <button class="hs-guide-btn" type="button" @click="onSetup">开始设置</button>
      <button class="hs-guide-skip" type="button" @click="onRecordToday">先随便记记</button>
    </section>

    <!-- ==================== 已初始化：正常视图 ==================== -->
    <template v-else>
      <!-- ① 今日健康（分类卡：值展示 + 录入入口） -->
      <HealthOverviewCard
        @settings="onOpenSettings"
        @open-metric="onOpenMetric"
      />

      <!-- ② 今日心情（MoodSection 内嵌，健康 tab 传 collapse=身体指标轴之外独立折叠） -->
      <MoodSection :collapse="true" />

      <!-- ③ 今日时间轴（一条轴贯穿全部身体指标事件） -->
      <HealthTodayTimeline @open-metric="onOpenMetric" />

      <!-- ④ 月历（翻历史：选某天 → 打开浮层） -->
      <HealthCalendar
        :month="month"
        :days="calDays"
        :summary="summary"
        :today="store.today"
        @change-month="onChangeMonth"
        @pick-day="onPickDay"
      />
    </template>

    <!-- ==================== 记录浮层 ==================== -->
    <HealthDaySheet
      v-model:show="sheetShow"
      :date="sheetDate"
      :metric-key="sheetMetric"
      :initial-page="sheetInitialPage"
    />
  </div>
</template>

<style lang="scss" scoped>
.health-section {
  padding: var(--space-3) var(--space-3) calc(var(--space-5) + env(safe-area-inset-bottom, 0px));
}

/* ==================== 引导卡 ==================== */
.hs-guide {
  margin: var(--space-4) 0;
  padding: var(--space-5) var(--space-4);
  background: var(--color-bg-card);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-xs);
  text-align: center;
}
.hs-guide-icon {
  font-size: 32px;
  line-height: 1;
  margin-bottom: var(--space-3);
}
.hs-guide-title {
  margin: 0 0 var(--space-2);
  font-size: var(--fs-h3);
  font-weight: 600;
  color: var(--color-text-primary);
}
.hs-guide-desc {
  margin: 0 0 var(--space-4);
  font-size: var(--fs-body-sm);
  line-height: 1.6;
  color: var(--color-text-secondary);
}
.hs-guide-btn {
  width: 100%;
  height: 46px;
  border: 0;
  border-radius: var(--radius-pill);
  background: var(--color-primary);
  color: #FFFFFF;
  font-size: var(--fs-body);
  font-weight: 600;
  box-shadow: var(--shadow-button);

  &:active:not(:disabled) { background: var(--color-primary-dark); }
}
.hs-guide-skip {
  width: 100%;
  margin-top: var(--space-2);
  height: 40px;
  border: 0;
  background: transparent;
  color: var(--color-text-tertiary);
  font-size: var(--fs-caption);
}
</style>
