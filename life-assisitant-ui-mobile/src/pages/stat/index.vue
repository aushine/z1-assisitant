<script setup lang="ts">
/**
 * 统计页（移动端 · Phase 4 重做 → 260919 领域 tab 重构）
 *
 * SYNC-FROM-DESKTOP: life-assisitant-ui-desktop/src/pages/stat/index.tsx
 * 最后同步：2026-09-18（Phase 4）
 *
 * 与桌面端的**业务口径完全一致**，实现层按移动端条件调整：
 *
 *  1. KPI 分区（口径同桌面端，不能改）：
 *     - 「今日任务」「本周完成率」「总净资产」是**固定维度**，来自 /stats/overview，
 *       该接口**不接受 range**（见后端 controller/stats.go GetOverview），故不随筛选变化；
 *     - 「支出」卡随 7/30/90 天筛选变化，取自 /stats/finance。
 *  2. 区间统计三接口用 allSettled 并发（在 stats store 内），单接口失败只让该分区
 *     显示错误态 + 重试，不整页白屏 —— 桌面端是串行 + 静默吞错，移动端不照抄。
 *  3. 图表：桌面端 chart.js → 移动端 ECharts（用户拍板），数据形状不变。
 *     颜色全部走 useChartTheme 从 CSS 变量取，主题切换自动重绘。
 *  4. 明细表：桌面端用 Semi Table，移动端改为**列表行**（小屏表格横向滚动体验差），
 *     字段与排序规则完全一致。
 *  5. 导出 4 种（全部/交易/任务/习惯），走后端文件流。
 *
 * ⚠️ rate 口径陷阱：StatsOverview.week_completion_rate 是 0-100，
 *    而 TaskStats.completion_rate / HabitStatItem.completion_rate 是 0-1。见 types.ts。
 *    本页显示时统一换算为百分比整数，避免「0.85%」这种假数字。
 *
 * ─────────────────────────────────────────────────────────────────────
 * 260919 领域 tab 重构（spec 05）：本页现在按 statsStore.section 分流内容。
 *   - 顶部 SubTabBar（领域：总览/健康/财务/习惯）在 HomeLayout 渲染，选中值读
 *     statsStore.section；切领域会连带把区间重置为该领域默认值（store.setSection 内）。
 *   - 区间已降为页内 chips（本文件 .range-chips），数据源 STATS_RANGES，
 *     点击调 statsStore.setRange(r)，位于 .stat-body 滚动容器内、内容区顶部。
 *   - overview 基本沿用整页既有面板；finance/habit 是既有面板的子集；
 *     health 是新增领域，数据源来自 health 接口（见下方 loadHealth）。
 */
// ⚠️ 显式组件名（spec-20260924-v2 S1）：供 HomeLayout 的 `<KeepAlive :include>` 匹配。
defineOptions({ name: 'Stat' })
import { computed, onActivated, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { showFailToast, showSuccessToast } from 'vant'
import { storeToRefs } from 'pinia'
import dayjs from 'dayjs'
import { useStatsStore, STATS_RANGES } from '@/stores/stats'
import { useHabitStore } from '@/stores/habit'
import { useFinanceStore } from '@/stores/finance'
import { useFinanceCategoryStore } from '@/stores/finance-category'
import { healthApi } from '@/api/health'
import { BOWEL_TYPE_OPTIONS, DEFAULT_WATER_GOAL_ML } from '@/constants/health'
import type { ExportType, FinanceCategoryStat, HealthDayDetail, HealthSettings, StatsRange } from '@/api/types'
import { getTint } from '@/utils/tint'
import { todayDate, addDays } from '@/utils/date'
import { heatColor } from '@/utils/heatmap'
import { findCategoryByEmoji, resolveAccountIcon } from '@/utils/category-dict'
import { getIconMapping } from '@/utils/icon-map'
import Icon from '@/components/icon/Icon.vue'
import MoneyText from '@/components/finance/MoneyText.vue'
import { useHeaderAction } from '@/composables/usePageChrome'
import type { IconMapping } from '@/utils/icon-map'
import BarChart from '@/components/charts/BarChart.vue'
import LineChart from '@/components/charts/LineChart.vue'
import DonutChart from '@/components/charts/DonutChart.vue'
import { VChart } from '@/plugins/echarts'
import { useChartTheme, withAlpha } from '@/composables/useChartTheme'

const router = useRouter()
const statsStore = useStatsStore()
const habitStore = useHabitStore()
const financeStore = useFinanceStore()
const catStore = useFinanceCategoryStore()
const { themeColors } = useChartTheme()

const {
  overview,
  taskStats,
  habitStats,
  financeStats,
  range,
  overviewState,
  taskState,
  habitState,
  financeState,
} = storeToRefs(statsStore)

// ==================== 领域分流 ====================
// 选中值读 statsStore.section；切 tab 由 usePageChrome → store.setSection 处理。
const showOverview = computed(() => statsStore.section === 'overview')
const showFinance = computed(() => statsStore.section === 'finance')
const showHabit = computed(() => statsStore.section === 'habit')
const showHealth = computed(() => statsStore.section === 'health')

// ==================== 区间 ====================
// 选项卡栏在 HomeLayout（配置见 composables/usePageChrome.ts），
// 选中值直接读 statsStore.range —— 页面这里只用它取中文 label 与驱动 chips。
const RANGES = STATS_RANGES

const rangeLabel = computed(
  () => RANGES.find((r) => r.value === range.value)?.label ?? '近 30 天'
)

/** chips 点击：调 setRange（概览与区间无关，区间统计会重拉） */
function onRangeChip(r: StatsRange): void {
  void statsStore.setRange(r)
}

// ==================== KPI ====================
/** 概览（固定维度） */
const taskTodayDone = computed(() => overview.value?.today_done_tasks ?? 0)
const taskTodayTotal = computed(() => overview.value?.today_total_tasks ?? 0)
const taskProgress = computed(() =>
  taskTodayTotal.value > 0 ? Math.round((taskTodayDone.value / taskTodayTotal.value) * 100) : 0
)
/** ⚠️ week_completion_rate 本身就是 0-100，不要再乘 100 */
const weekRate = computed(() => Math.round(overview.value?.week_completion_rate ?? 0))
const totalBalance = computed(() => overview.value?.total_balance ?? 0)

/** 「支出」卡随筛选 */
const rangeExpense = computed(() => financeStats.value?.expense ?? 0)
const rangeIncome = computed(() => financeStats.value?.income ?? 0)
const rangeNet = computed(() => financeStats.value?.net ?? 0)

/** 同比徽章：0 不显示；invert 表示「涨了是坏事」（支出） */
function changeText(v: number): string {
  return `${Math.abs(Math.round(v * 100)) / 100}%`
}

// ==================== 图表数据 ====================
const taskTrend = computed(() =>
  (taskStats.value?.by_day ?? []).map((d) => ({
    label: d.date.slice(5),
    value: d.completed,
  }))
)

const expenseTrend = computed(() =>
  (financeStats.value?.by_day ?? []).map((d) => ({
    label: d.date.slice(5),
    value: d.expense,
  }))
)

/**
 * 支出分类占比：分类色以 `finance-category` 的 tint 为唯一真相。
 *
 * ⚠️ 后端 `by_category[].color` 目前对**所有**分类都返回写死的占位灰 `#6B7280`，
 *   照单全收会让整张饼只有一个颜色。所以这里忽略后端色值：
 *   **按 `category_id` 查分类缓存**的 tint（05 §3），再映射到**当前主题下的真实 hex**
 *   （ECharts 画在 canvas 上吃不了 `var(--x)`；themeColors 的键名与 TintName 一一对应）。
 *   已删分类 → 中性色；无 id 的历史数据 → 快照 emoji 兜底。
 */
const categoryDoughnutData = computed(() =>
  (financeStats.value?.by_category ?? []).map((c) => ({
    label: c.category,
    value: c.amount,
    color: themeColors.value[catOf(c).tint],
  }))
)

const categoryTableData = computed(() => financeStats.value?.by_category ?? [])
const accountTableData = computed(() => financeStats.value?.by_account ?? [])
const topHabits = computed(() => (habitStats.value?.by_habit ?? []).slice(0, 5))
const habitRateTop4 = computed(() => (habitStats.value?.by_habit ?? []).slice(0, 4))

/** 热力图：取区间内最近 28 天，铺成 7 列 × 4 行（与桌面端同布局） */
const heatmapCells = computed(() => {
  const raw = habitStats.value?.heatmap ?? []
  if (raw.length === 0) return []
  return raw.slice(-28)
})

const WEEK_HEADERS = ['一', '二', '三', '四', '五', '六', '日']

/** 点击热力格查看详情（移动端没有 hover，替代桌面端 Tooltip） */
const pickedCell = ref<{ date: string; completed: number; total: number } | null>(null)

function onPickCell(c: { date: string; completed: number; total: number }): void {
  pickedCell.value = pickedCell.value?.date === c.date ? null : c
}

// ==================== 导出 ====================
const EXPORT_OPTIONS: Array<{ name: string; type: ExportType }> = [
  { name: '全部数据 (CSV)', type: 'all' },
  { name: '仅交易', type: 'transactions' },
  { name: '仅任务', type: 'tasks' },
  { name: '仅习惯', type: 'habits' },
]

/**
 * ⚠️ Vant 4 **没有** `showActionSheet` 命令式 API（只有 `showConfirmDialog` /
 * `showToast` 等少数几个函数式组件）。ActionSheet 只能用模板里的
 * `<van-action-sheet>` 组件，故这里用 visible 状态 + @select 事件。
 */
const exportSheetVisible = ref(false)
const exportActions = EXPORT_OPTIONS.map((o) => ({ name: o.name }))

function openExport(): void {
  exportSheetVisible.value = true
}

// 顶部栏右侧的「导出」按钮由 HomeLayout 渲染（见 usePageChrome 的 actions），
// 点击后回调本页注册的处理函数；页面卸载时自动注销。
useHeaderAction('stat:export', openExport)

async function onExportSelect(action: { name: string }): Promise<void> {
  exportSheetVisible.value = false
  const target = EXPORT_OPTIONS.find((o) => o.name === action.name)
  if (!target) return
  const ok = await statsStore.exportCSV({ range: range.value, type: target.type })
  // spec-20260922-v2 · 05 §2.2 R2 保留：导出为异步任务，"文件已开始下载"是浏览器侧动作
  if (ok) showSuccessToast('导出完成，文件已开始下载')
  else showFailToast('导出失败，请稍后重试')
}

// ==================== 分类图标 ====================
/** 习惯 / 数据驱动 emoji 的 tint（task/habit 语义，非收支分类） */
function categoryTint(emoji: string): { bg: string; fg: string } {
  return getTint(findCategoryByEmoji(emoji)?.tint ?? 'neutral')
}

/**
 * 财务分类渲染（05 §3）：**按 `category_id` 优先**、快照 emoji 兜底。
 * 后端统计接口已改按 id 聚合返回 `category_id`。
 */
function catOf(c: FinanceCategoryStat) {
  return catStore.resolveCat({
    category_id: c.category_id,
    category_name: c.category,
    category_emoji: c.emoji,
  })
}

/** 习惯图标：数据驱动的 emoji（习惯 icon 字段）走 icon-map 解析出 Lucide 名 + 语义色 */
function habitGlyph(emoji: string): IconMapping {
  return getIconMapping(emoji || '🎯')
}

// ==================== 健康领域（新增，spec 05 §5 / §6）====================
// 数据源：health 接口（listDays 区间日记 + getSettings 饮水目标）。
// 只读，不改 health store / constants / api。所有数值现算，不新增后端接口。
// 红线（§6.2）：不做诊断 / 不做价值判断 / 不造指标 / 体重不上红绿 /
//   小变化说「持平」。曲线统一用 --color-primary 中性色。

const healthDays = ref<HealthDayDetail[]>([])
const waterGoalMl = ref<number>(DEFAULT_WATER_GOAL_ML)
const healthLoading = ref(false)
const healthError = ref<string | null>(null)

/** 区间 → 天数（health 只用 7/30/90，无 custom） */
function rangeDays(r: StatsRange): number {
  if (r === '7d') return 7
  if (r === '90d') return 90
  return 30
}

async function loadHealth(): Promise<void> {
  const end = todayDate()
  const start = addDays(end, -(rangeDays(statsStore.range) - 1))
  healthLoading.value = true
  healthError.value = null
  try {
    const [daysRes, settings] = await Promise.all([
      healthApi.listDays(start, end),
      healthApi.getSettings(),
    ])
    healthDays.value = (daysRes.items ?? [])
      .slice()
      .sort((a, b) => (a.date < b.date ? -1 : 1))
    const s = settings as HealthSettings | null
    waterGoalMl.value = s?.water_goal_ml ?? DEFAULT_WATER_GOAL_ML
  } catch (e) {
    healthError.value = e instanceof Error ? e.message : '健康数据加载失败'
    healthDays.value = []
  } finally {
    healthLoading.value = false
  }
}

// 仅在健康领域（或切区间时仍在健康领域）拉取，避免无关请求
watch(
  () => `${statsStore.section}|${statsStore.range}`,
  () => {
    if (statsStore.section === 'health') void loadHealth()
  },
  { immediate: true }
)

/** 周一为一周起点的日期（用于排便周频次分桶） */
function isoWeekStart(date: string): string {
  const dow = dayjs(date).day() // 0=周日 .. 6=周六
  const offset = (dow + 6) % 7 // 距本周一的天数
  return addDays(date, -offset)
}

// ---- 体重曲线 ----
const weightPoints = computed(() =>
  healthDays.value
    .filter((d) => d.weight_kg != null && (d.weight_kg as number) > 0)
    .map((d) => ({ label: d.date.slice(5), value: d.weight_kg as number }))
)

const weightMa = computed<Array<{ label: string; value: number | null }>>(() => {
  const pts = weightPoints.value
  if (pts.length < 7) return []
  const out: Array<{ label: string; value: number | null }> = []
  for (let i = 0; i < pts.length; i++) {
    if (i < 6) {
      out.push({ label: pts[i].label, value: null })
      continue
    }
    let sum = 0
    for (let j = i - 6; j <= i; j++) sum += pts[j].value
    out.push({ label: pts[i].label, value: Math.round((sum / 7) * 100) / 100 })
  }
  return out
})

const weightLatest = computed(() =>
  weightPoints.value.length
    ? weightPoints.value[weightPoints.value.length - 1].value.toFixed(1)
    : '—'
)

const weightDeltaText = computed(() => {
  const pts = weightPoints.value
  if (pts.length < 2) return ''
  const last = pts[pts.length - 1].value
  const prev = pts[pts.length - 2].value
  const delta = Math.round((last - prev) * 10) / 10
  // ⚠️ 小变化（±0.5kg 内）说「持平」，不用涨跌箭头
  if (Math.abs(delta) <= 0.5) return '持平'
  return `较上次 ${delta > 0 ? '+' : ''}${delta} kg`
})

const weightChartOption = computed(() => {
  const t = themeColors.value
  const color = t.primary // 单一中性色，不上红绿
  const pts = weightPoints.value
  const ma = weightMa.value
  return {
    grid: { left: 8, right: 12, top: 16, bottom: 4, containLabel: true },
    tooltip: {
      trigger: 'axis',
      backgroundColor: t.tooltipBg,
      borderColor: t.tooltipBorder,
      borderWidth: 1,
      padding: [8, 12] as [number, number],
      textStyle: { color: t.tooltipText, fontSize: 12 },
      valueFormatter: (v: number) => (v == null ? '—' : `${Number(v).toFixed(1)} kg`),
    },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: pts.map((p) => p.label),
      axisLine: { lineStyle: { color: t.axisLine } },
      axisTick: { show: false },
      axisLabel: { color: t.textTertiary, fontSize: 10, interval: 'auto' },
    },
    yAxis: {
      type: 'value',
      scale: true,
      splitLine: { lineStyle: { color: t.gridLine } },
      axisLine: { show: false },
      axisLabel: { color: t.textTertiary, fontSize: 10 },
    },
    series: [
      {
        type: 'line',
        name: '体重',
        data: pts.map((p) => p.value),
        smooth: 0.3,
        symbol: 'circle',
        symbolSize: 5,
        lineStyle: { color, width: 2 },
        itemStyle: { color, borderColor: t.bgCard, borderWidth: 2 },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: withAlpha(color, 0.18) },
              { offset: 1, color: withAlpha(color, 0.02) },
            ],
          },
        },
        connectNulls: false,
      },
      // ⚠️ 记录少于 7 天不画均线（均线不可信），只画原始点
      ...(ma.length > 0
        ? [
            {
              type: 'line',
              name: '7日均线',
              data: ma.map((p) => p.value),
              smooth: 0.3,
              symbol: 'none' as const,
              lineStyle: { color, width: 1.5, type: 'dashed' as const },
              itemStyle: { color },
              connectNulls: false,
            },
          ]
        : []),
    ],
  }
})

// ---- 饮水达标 ----
const waterStats = computed(() => {
  const recs = healthDays.value.filter((d) => d.water_ml > 0)
  const total = recs.length
  if (total === 0) return { total: 0, rate: 0, streak: 0 }
  const met = recs.filter((d) => d.water_ml >= waterGoalMl.value).length
  // 连续达标：从最近一天往前数，碰到未达标即断
  const sorted = recs.slice().sort((a, b) => (a.date < b.date ? 1 : -1))
  let streak = 0
  for (const d of sorted) {
    if (d.water_ml >= waterGoalMl.value) streak++
    else break
  }
  return { total, rate: Math.round((met / total) * 100), streak }
})

// ---- 排便 ----
const bowelDays = computed(() =>
  healthDays.value.filter((d) => d.bowel_count > 0 || d.bowel_type > 0)
)

const bowelWeekly = computed(() => {
  const map = new Map<string, number>()
  for (const d of bowelDays.value) {
    const wk = isoWeekStart(d.date)
    map.set(wk, (map.get(wk) ?? 0) + d.bowel_count)
  }
  return [...map.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([k, v]) => ({ label: k.slice(5), value: v }))
})

const bowelTypeData = computed(() => {
  const counts: Record<number, number> = {}
  for (const d of bowelDays.value) {
    if (d.bowel_type > 0) counts[d.bowel_type] = (counts[d.bowel_type] ?? 0) + 1
  }
  // 按 BOWEL_TYPE_OPTIONS 固定顺序（偏硬/正常/偏软/腹泻）
  return BOWEL_TYPE_OPTIONS.filter((o) => counts[o.value]).map((o) => ({
    label: o.label,
    value: counts[o.value],
  }))
})

// ---- 体温曲线 ----
const tempPoints = computed(() =>
  healthDays.value
    .filter((d) => d.bbt != null && (d.bbt as number) > 0)
    .map((d) => ({ label: d.date.slice(5), value: d.bbt as number }))
)

/** 自动标注排卵升温台阶：连续 3 天 ≥ 前 6 天均值 +0.2℃ 的第一天（简化算法，不复制完整规则） */
const ovulationIndex = computed(() => {
  const pts = tempPoints.value
  const n = pts.length
  for (let i = 6; i + 2 < n; i++) {
    const prior = pts.slice(i - 6, i)
    const avg = prior.reduce((s, p) => s + p.value, 0) / prior.length
    if (
      pts[i].value >= avg + 0.2 &&
      pts[i + 1].value >= avg + 0.2 &&
      pts[i + 2].value >= avg + 0.2
    ) {
      return i
    }
  }
  return -1
})

const tempChartOption = computed(() => {
  const t = themeColors.value
  const color = t.primary
  const pts = tempPoints.value
  const idx = ovulationIndex.value
  return {
    grid: { left: 8, right: 12, top: 16, bottom: 4, containLabel: true },
    tooltip: {
      trigger: 'axis',
      backgroundColor: t.tooltipBg,
      borderColor: t.tooltipBorder,
      borderWidth: 1,
      padding: [8, 12] as [number, number],
      textStyle: { color: t.tooltipText, fontSize: 12 },
      valueFormatter: (v: number) => (v == null ? '—' : `${Number(v).toFixed(2)}℃`),
    },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: pts.map((p) => p.label),
      axisLine: { lineStyle: { color: t.axisLine } },
      axisTick: { show: false },
      axisLabel: { color: t.textTertiary, fontSize: 10, interval: 'auto' },
    },
    yAxis: {
      type: 'value',
      scale: true,
      splitLine: { lineStyle: { color: t.gridLine } },
      axisLine: { show: false },
      axisLabel: { color: t.textTertiary, fontSize: 10 },
    },
    series: [
      {
        type: 'line',
        name: '体温',
        data: pts.map((p) => p.value),
        smooth: 0.3,
        symbol: 'circle',
        symbolSize: 5,
        lineStyle: { color, width: 2 },
        itemStyle: { color, borderColor: t.bgCard, borderWidth: 2 },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: withAlpha(color, 0.18) },
              { offset: 1, color: withAlpha(color, 0.02) },
            ],
          },
        },
        // 仅当检测到升温台阶才打标记（中性 pin，无诊断语义）
        markPoint:
          idx >= 0
            ? {
                symbol: 'pin',
                symbolSize: 34,
                itemStyle: { color },
                label: { color: '#fff', fontSize: 10, formatter: '升温' },
                data: [{ coord: [pts[idx].label, pts[idx].value] }],
              }
            : undefined,
      },
    ],
  }
})

// ==================== 生命周期 ====================
// 2026-09-24（spec-20260924-v2 S1）：本页被 `<KeepAlive>` 缓存。
// 首拉带 loading（骨架屏），回归时静默刷新（不闪、不丢数据）。
// ⚠️ 首拉逻辑放 onActivated（首次挂载也会触发），用 firstLoad 区分首拉/回归。
let firstLoad = true
onActivated(async () => {
  const silent = !firstLoad
  firstLoad = false
  await Promise.all([
    statsStore.refresh({ silent }),
    habitStore.fetchHabits(),
    financeStore.fetchAccounts(),
    // 分类缓存：占比 / 明细按 category_id 查图标与色（未加载时快照兜底）
    // SWR：有缓存立即返回 + 后台静默刷新，不阻塞统计页首屏
    catStore.ensureFresh(),
  ])
})

/** 分区重试：概览与区间统计分别重试 */
function retryOverview(): void {
  void statsStore.fetchOverview()
}
function retryRange(): void {
  void statsStore.fetchRangeStats()
}
function retryHealth(): void {
  void loadHealth()
}
</script>

<template>
  <div class="stat-page">
    <!-- 顶部栏（统计 · 按周期复盘趋势 + 导出）与领域 tab 都已提到 HomeLayout
         常驻渲染，见 layouts/HomeLayout.vue + composables/usePageChrome.ts。 -->

    <!-- 导出选择（模板组件式，见 openExport 注释） -->
    <van-action-sheet
      v-model:show="exportSheetVisible"
      :actions="exportActions"
      title="导出数据"
      :description="`区间：${rangeLabel}`"
      cancel-text="取消"
      close-on-click-action
      @select="onExportSelect"
    />

    <main class="stat-body">
      <!-- ====== 区间 chips（页内，spec 05 §3；位于滚动容器内、内容区顶部）====== -->
      <div class="range-chips">
        <button
          v-for="r in RANGES"
          :key="r.value"
          type="button"
          class="chip"
          :class="{ active: range === r.value }"
          @click="onRangeChip(r.value)"
        >
          {{ r.label }}
        </button>
      </div>

      <!-- ============ 健康领域（新增）============ -->
      <div v-if="showHealth" class="health-block">
        <div v-if="healthLoading" class="chart-skel" />
        <div v-else-if="healthError" class="section-error">
          <span>{{ healthError }}</span>
          <button class="retry-btn sm" type="button" @click="retryHealth">重试</button>
        </div>
        <template v-else>
          <!-- 体重曲线 -->
          <section class="panel">
            <div class="panel-head">
              <h3 class="panel-title"><Icon name="Scale" :size="20" />体重曲线</h3>
              <span class="panel-sub">{{ rangeLabel }}</span>
            </div>
            <!-- 仅 1 个数据点：不画趋势，显示该点 + 引导 -->
            <div v-if="weightPoints.length <= 1" class="section-empty">
              <Icon name="Inbox" :size="32" class="empty-emoji" />
              <p v-if="weightPoints.length === 1">
                最新 {{ weightPoints[0].value.toFixed(1) }} kg · 再记录几次就能看到趋势
              </p>
              <p v-else>还没有体重记录</p>
            </div>
            <template v-else>
              <div class="health-chart" :style="{ height: '220px' }">
                <VChart class="chart" :option="weightChartOption" autoresize />
              </div>
              <p v-if="weightDeltaText" class="panel-note">
                最新 {{ weightLatest }} kg · {{ weightDeltaText }}
              </p>
            </template>
            <p class="panel-foot">数据来自你的每日记录，不构成医学诊断</p>
          </section>

          <!-- 饮水达标 -->
          <section class="panel">
            <div class="panel-head">
              <h3 class="panel-title"><Icon name="Droplet" :size="20" />饮水达标</h3>
              <span class="panel-sub">目标 {{ waterGoalMl }} ml</span>
            </div>
            <div v-if="waterStats.total === 0" class="section-empty">
              <Icon name="Inbox" :size="32" class="empty-emoji" />
              <p>还没有饮水记录</p>
            </div>
            <div v-else class="kpi-mini">
              <div class="kpi-mini-item">
                <div class="kpi-mini-val">{{ waterStats.rate }}%</div>
                <div class="kpi-mini-label">达标率</div>
              </div>
              <div class="kpi-mini-item">
                <div class="kpi-mini-val">{{ waterStats.streak }} 天</div>
                <div class="kpi-mini-label">连续达标</div>
              </div>
            </div>
          </section>

          <!-- 排便 -->
          <section class="panel">
            <div class="panel-head">
              <h3 class="panel-title"><Icon name="CircleDot" :size="20" />排便</h3>
              <span class="panel-sub">{{ rangeLabel }}</span>
            </div>
            <div v-if="bowelDays.length === 0" class="section-empty">
              <Icon name="Inbox" :size="32" class="empty-emoji" />
              <p>还没有排便记录</p>
            </div>
            <template v-else>
              <div class="panel-sub2">周频次</div>
              <BarChart :data="bowelWeekly" color="primary" :height="200" />
              <div class="panel-sub2">形态分布</div>
              <DonutChart v-if="bowelTypeData.length > 0" :data="bowelTypeData" :height="220" />
              <div v-else class="section-empty">
                <p>暂无形记录</p>
              </div>
            </template>
          </section>

          <!-- 体温曲线 -->
          <section class="panel">
            <div class="panel-head">
              <h3 class="panel-title"><Icon name="Thermometer" :size="20" />体温曲线</h3>
              <span class="panel-sub">{{ rangeLabel }}</span>
            </div>
            <div v-if="tempPoints.length < 2" class="section-empty">
              <Icon name="Inbox" :size="32" class="empty-emoji" />
              <p>
                {{
                  tempPoints.length === 1
                    ? '仅 1 次记录，再多测几次更准'
                    : '还没有体温记录'
                }}
              </p>
            </div>
            <template v-else>
              <div class="health-chart" :style="{ height: '220px' }">
                <VChart class="chart" :option="tempChartOption" autoresize />
              </div>
            </template>
            <p class="panel-foot">标注为连续升温的可能窗口，不构成医学诊断</p>
          </section>

          <!-- 经期周期报告入口（报告页不在本项目，仅入口，待建） -->
          <button class="goto-record" type="button" @click="router.push('/record')">
            经期周期报告 · 待建，去记录页 →
          </button>
        </template>
      </div>

      <!-- ============ 总览 / 财务 / 习惯 沿用既有面板 ============ -->

      <!-- ====== 4 KPI（总览全显；财务仅支出/净资产两张）====== -->
      <div
        v-if="(showOverview || showFinance) && (overviewState.loading && !overview)"
        class="kpi-grid"
      >
        <div v-for="i in 4" :key="i" class="kpi-card skel" />
      </div>

      <div
        v-else-if="(showOverview || showFinance) && overviewState.error && !overview"
        class="panel error-panel"
      >
        <Icon name="AlertTriangle" :size="32" :style="{ color: getTint('danger').fg }" />
        <p class="err-msg">{{ overviewState.error }}</p>
        <button class="retry-btn" type="button" @click="retryOverview">重试</button>
      </div>

      <div v-else-if="showOverview || showFinance" class="kpi-grid">
        <!-- 1. 今日任务（固定，仅总览） -->
        <div v-if="showOverview" class="kpi-card">
          <div class="kpi-head">
            <span class="kpi-emoji" :style="{ background: getTint('primary').bg }"><Icon name="ListChecks" :size="16" :style="{ color: getTint('primary').fg }" /></span>
            <span class="kpi-label">今日任务</span>
          </div>
          <div class="kpi-value">
            {{ taskTodayDone }}<span class="kpi-value-muted">/{{ taskTodayTotal }}</span>
          </div>
          <div class="kpi-bar">
            <div
              class="kpi-bar-fill"
              :style="{ width: `${taskProgress}%`, background: getTint('primary').fg }"
            />
          </div>
          <div class="kpi-foot">
            <span class="kpi-badge-fixed">固定</span>
            <span class="kpi-sub">{{ taskProgress }}%</span>
          </div>
          <div v-if="taskStats" class="kpi-hint">
            <span :class="taskStats.completion_rate_change >= 0 ? 'up' : 'down'">
              {{ taskStats.completion_rate_change >= 0 ? '↑' : '↓' }}
              {{ changeText(taskStats.completion_rate_change) }}
            </span>
            <span class="hint-label">完成率 vs 上期</span>
          </div>
        </div>

        <!-- 2. 本周完成率（固定，仅总览） -->
        <div v-if="showOverview" class="kpi-card">
          <div class="kpi-head">
            <span class="kpi-emoji" :style="{ background: getTint('success').bg }"><Icon name="TrendingUp" :size="16" :style="{ color: getTint('success').fg }" /></span>
            <span class="kpi-label">本周完成率</span>
          </div>
          <div class="kpi-value" :style="{ color: getTint('success').fg }">{{ weekRate }}%</div>
          <div class="kpi-sub">任务 + 习惯 综合</div>
          <div class="kpi-foot">
            <span class="kpi-badge-fixed">固定</span>
          </div>
        </div>

        <!-- 3. 支出（随筛选） -->
        <div class="kpi-card">
          <div class="kpi-head">
            <span class="kpi-emoji" :style="{ background: getTint('danger').bg }"><Icon name="Banknote" :size="16" :style="{ color: getTint('danger').fg }" /></span>
            <span class="kpi-label">{{ rangeLabel }}支出</span>
          </div>
          <div class="kpi-value" :style="{ color: getTint('danger').fg }">
            <MoneyText :value="rangeExpense" />
          </div>
          <div class="kpi-sub">收入 <MoneyText :value="rangeIncome" /></div>
          <div class="kpi-foot">
            <span class="kpi-badge-range">随筛选</span>
          </div>
          <div v-if="financeStats && financeStats.expense_change !== 0" class="kpi-hint">
            <span :class="financeStats.expense_change <= 0 ? 'up' : 'down'">
              {{ financeStats.expense_change >= 0 ? '↑' : '↓' }}
              {{ changeText(financeStats.expense_change) }}
            </span>
            <span class="hint-label">支出 vs 上期</span>
          </div>
        </div>

        <!-- 4. 总净资产（固定） -->
        <div class="kpi-card">
          <div class="kpi-head">
            <span class="kpi-emoji" :style="{ background: getTint('accent').bg }"><Icon name="Gem" :size="16" :style="{ color: getTint('accent').fg }" /></span>
            <span class="kpi-label">总净资产</span>
          </div>
          <div
            class="kpi-value"
            :style="{
              color: totalBalance < 0 ? getTint('danger').fg : getTint('success').fg,
            }"
          >
            <MoneyText :value="totalBalance" />
          </div>
          <div class="kpi-sub">本区间净值 <MoneyText :value="rangeNet" /></div>
          <div class="kpi-foot">
            <span class="kpi-badge-fixed">当前 · 固定</span>
          </div>
          <div v-if="financeStats && financeStats.income_change !== 0" class="kpi-hint">
            <span :class="financeStats.income_change >= 0 ? 'up' : 'down'">
              {{ financeStats.income_change >= 0 ? '↑' : '↓' }}
              {{ changeText(financeStats.income_change) }}
            </span>
            <span class="hint-label">收入 vs 上期</span>
          </div>
        </div>
      </div>

      <!-- ====== 任务完成趋势（总览）====== -->
      <section v-if="showOverview" class="panel">
        <div class="panel-head">
          <h3 class="panel-title"><Icon name="ListChecks" :size="20" />任务完成趋势</h3>
          <span class="panel-sub">{{ rangeLabel }}</span>
        </div>
        <div v-if="taskState.loading" class="chart-skel" />
        <div v-else-if="taskState.error" class="section-error">
          <span>{{ taskState.error }}</span>
          <button class="retry-btn sm" type="button" @click="retryRange">重试</button>
        </div>
        <BarChart v-else-if="taskTrend.length > 0" :data="taskTrend" color="primary" :height="220" />
        <div v-else class="section-empty">
          <Icon name="Inbox" :size="32" class="empty-emoji" />
          <p>暂无任务数据</p>
        </div>
      </section>

      <!-- ====== 支出趋势（总览 / 财务）====== -->
      <section v-if="showOverview || showFinance" class="panel">
        <div class="panel-head">
          <h3 class="panel-title"><Icon name="TrendingDown" :size="20" />支出趋势</h3>
          <span class="panel-sub">{{ rangeLabel }}</span>
        </div>
        <div v-if="financeState.loading" class="chart-skel" />
        <div v-else-if="financeState.error" class="section-error">
          <span>{{ financeState.error }}</span>
          <button class="retry-btn sm" type="button" @click="retryRange">重试</button>
        </div>
        <LineChart
          v-else-if="expenseTrend.length > 0"
          :data="expenseTrend"
          color="danger"
          :height="220"
          money
        />
        <div v-else class="section-empty">
          <Icon name="Inbox" :size="32" class="empty-emoji" />
          <p>暂无支出数据</p>
        </div>
      </section>

      <!-- ====== 习惯完成（总览 / 习惯）====== -->
      <section v-if="showOverview || showHabit" class="panel">
        <div class="panel-head">
          <h3 class="panel-title"><Icon name="Flame" :size="20" />习惯完成</h3>
        </div>
        <p v-if="habitStats" class="panel-meta">
          {{ rangeLabel }} · {{ habitStats.total_habits }} 个习惯 · 最长连续
          {{ habitStats.longest_streak_overall }} 天 · {{ habitStats.total_check_ins }} 次打卡 ·
          日均 {{ habitStats.daily_average?.toFixed(1) ?? '0' }}
        </p>

        <div v-if="habitState.loading" class="chart-skel" />
        <div v-else-if="habitState.error" class="section-error">
          <span>{{ habitState.error }}</span>
          <button class="retry-btn sm" type="button" @click="retryRange">重试</button>
        </div>
        <template v-else-if="topHabits.length > 0">
          <!-- 近 4 周热力图 -->
          <div class="heatmap-wrap">
            <div class="heatmap-title">近 4 周打卡热力图</div>
            <div class="heatmap-grid">
              <div v-for="w in WEEK_HEADERS" :key="w" class="heatmap-head">{{ w }}</div>
              <button
                v-for="(c, i) in heatmapCells"
                :key="i"
                type="button"
                class="heatmap-cell"
                :class="{ active: pickedCell?.date === c.date }"
                :style="{ background: heatColor(c.total > 0 ? c.completed / c.total : 0) }"
                @click="onPickCell(c)"
              />
            </div>
            <div
              class="heatmap-detail"
              :class="{ placeholder: !pickedCell }"
            >
              <template v-if="pickedCell">
                {{ pickedCell.date }} · {{ pickedCell.completed }}/{{ pickedCell.total }} 完成
              </template>
              <template v-else>点击格子查看当日打卡详情</template>
            </div>
          </div>

          <!-- Top 5 习惯 -->
          <div class="habit-list">
            <div v-for="h in topHabits" :key="h.habit_id" class="habit-item">
              <span class="habit-emoji" :style="{ background: habitGlyph(h.emoji).vars.bg }">
                <Icon :name="habitGlyph(h.emoji).icon" :size="16" :style="{ color: habitGlyph(h.emoji).vars.fg }" />
              </span>
              <div class="habit-info">
                <div class="habit-name">{{ h.name }}</div>
                <div class="habit-sub">
                  今日 {{ h.today_done }}/{{ h.today_target }}
                  <span v-if="h.today_done >= h.today_target" class="habit-done">已完成</span>
                </div>
              </div>
              <div class="habit-meta">
                <div class="habit-streak">
                  连续 {{ h.current_streak }} 天 · 最长 {{ h.longest_streak }} 天
                </div>
                <div class="habit-rate" :style="{ color: categoryTint(h.emoji).fg }">
                  {{ Math.round(h.completion_rate * 100) }}%
                </div>
              </div>
            </div>
          </div>
        </template>
        <div v-else class="section-empty">
          <Icon name="Sprout" :size="32" class="empty-emoji" />
          <p>还没有习惯数据</p>
        </div>
      </section>

      <!-- ====== 支出分类占比（总览 / 财务）====== -->
      <section v-if="showOverview || showFinance" class="panel">
        <div class="panel-head">
          <h3 class="panel-title"><Icon name="PieChart" :size="20" />支出分类占比</h3>
          <span class="panel-sub">Top 分类</span>
        </div>
        <div v-if="financeState.loading" class="chart-skel" />
        <div v-else-if="financeState.error" class="section-error">
          <span>{{ financeState.error }}</span>
          <button class="retry-btn sm" type="button" @click="retryRange">重试</button>
        </div>
        <DonutChart
          v-else-if="categoryDoughnutData.length > 0"
          :data="categoryDoughnutData"
          :height="240"
        />
        <div v-else class="section-empty">
          <Icon name="Inbox" :size="32" class="empty-emoji" />
          <p>暂无支出分类数据</p>
        </div>
      </section>

      <!-- ====== 习惯完成率（前 4，总览 / 习惯）====== -->
      <section v-if="showOverview || showHabit" class="panel">
        <div class="panel-head">
          <h3 class="panel-title"><Icon name="Target" :size="20" />习惯完成率</h3>
          <span class="panel-sub">连续天数</span>
        </div>
        <div v-if="habitState.loading" class="chart-skel" />
        <div v-else-if="habitState.error" class="section-error">
          <span>{{ habitState.error }}</span>
          <button class="retry-btn sm" type="button" @click="retryRange">重试</button>
        </div>
        <div v-else-if="habitRateTop4.length > 0" class="rate-grid">
          <div v-for="h in habitRateTop4" :key="h.habit_id" class="rate-item">
            <div
              class="rate-ring"
              :style="{ '--pct': `${Math.round(h.completion_rate * 100)}%`, '--ring': h.color || getTint('warning').fg } as any"
            >
              <span class="rate-num">{{ Math.round(h.completion_rate * 100) }}%</span>
            </div>
            <div class="rate-body">
              <div class="rate-name">
                <Icon :name="habitGlyph(h.emoji).icon" :size="14" :style="{ color: habitGlyph(h.emoji).vars.fg }" />
                {{ h.name }}
              </div>
              <div class="rate-sub">连续 {{ h.current_streak }} 天</div>
            </div>
          </div>
        </div>
        <div v-else class="section-empty">
          <Icon name="Sprout" :size="32" class="empty-emoji" />
          <p>暂无习惯数据</p>
        </div>
      </section>

      <!-- ====== 支出分类明细（总览 / 财务）====== -->
      <section v-if="showOverview || showFinance" class="panel">
        <div class="panel-head">
          <h3 class="panel-title"><Icon name="BarChart3" :size="20" />支出分类明细</h3>
          <span class="panel-sub">按分类汇总</span>
        </div>
        <div v-if="financeState.loading" class="chart-skel" />
        <div v-else-if="financeState.error" class="section-error">
          <span>{{ financeState.error }}</span>
          <button class="retry-btn sm" type="button" @click="retryRange">重试</button>
        </div>
        <div v-else-if="categoryTableData.length > 0" class="detail-list">
          <div v-for="(c, i) in categoryTableData" :key="c.category" class="detail-row">
            <span class="detail-rank" :data-rank="i + 1">{{ i + 1 }}</span>
            <span class="detail-emoji" :style="{ background: catOf(c).vars.bg }">
              <Icon :name="catOf(c).icon" :size="16" :style="{ color: catOf(c).vars.fg }" />
            </span>
            <div class="detail-body">
              <div class="detail-top">
                <span class="detail-name">{{ catOf(c).name }}</span>
                <span class="detail-amount"><MoneyText :value="c.amount" /></span>
              </div>
              <div class="detail-bottom">
                <div class="detail-bar">
                  <div class="detail-bar-fill" :style="{ width: `${Math.round(c.percentage * 100)}%` }" />
                </div>
                <span class="detail-count">{{ c.count }} 笔</span>
                <span class="detail-pct">{{ Math.round(c.percentage * 100) }}%</span>
              </div>
            </div>
          </div>
        </div>
        <div v-else class="section-empty">
          <Icon name="Inbox" :size="32" class="empty-emoji" />
          <p>暂无支出数据</p>
        </div>
      </section>

      <!-- ====== 账户汇总（总览 / 财务）====== -->
      <section v-if="showOverview || showFinance" class="panel">
        <div class="panel-head">
          <h3 class="panel-title"><Icon name="Landmark" :size="20" />账户汇总</h3>
          <span class="panel-sub">{{ rangeLabel }}</span>
        </div>
        <div v-if="financeState.loading" class="chart-skel" />
        <div v-else-if="financeState.error" class="section-error">
          <span>{{ financeState.error }}</span>
          <button class="retry-btn sm" type="button" @click="retryRange">重试</button>
        </div>
        <div v-else-if="accountTableData.length > 0" class="detail-list">
          <div v-for="a in accountTableData" :key="a.account" class="detail-row">
            <span class="detail-emoji" :style="{ background: resolveAccountIcon(a.emoji).vars.bg }">
              <Icon :name="resolveAccountIcon(a.emoji).icon" :size="16" :style="{ color: resolveAccountIcon(a.emoji).vars.fg }" />
            </span>
            <div class="detail-body">
              <div class="detail-top">
                <span class="detail-name">{{ a.account }}</span>
                <span class="detail-amount"><MoneyText :value="a.amount" /></span>
              </div>
              <div class="detail-bottom">
                <span class="detail-count">{{ a.count }} 笔</span>
              </div>
            </div>
          </div>
        </div>
        <div v-else class="section-empty">
          <Icon name="Landmark" :size="32" class="empty-emoji" />
          <p>暂无账户数据</p>
        </div>
      </section>

      <!-- 记录页快捷入口（非健康领域展示） -->
      <button
        v-if="showOverview || showFinance || showHabit"
        class="goto-record"
        type="button"
        @click="router.push('/record')"
      >
        去记录页打卡 / 记一笔 →
      </button>
    </main>
  </div>
</template>

<style lang="scss" scoped>
.stat-page {
  /* ⚠️ 不写 height：高度由 HomeLayout 的 .content 用 flex 直接分配
     （见 HomeLayout .content 注释）。写 height:100% 会与布局层的定位
     方案争抢同一组属性（特异性相同、由 CSS 注入顺序裁决），且依赖
     iOS 上不可靠的百分比解析 → 页面被内容撑高 → .stat-body 空转、
     滚动传到根。 */
  background: var(--color-bg-app);
  display: flex;
  flex-direction: column;
}

/* ====== 主体 ====== */
.stat-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  /* 滚到两端不把滚动链传给父级，避免 iOS 上整个视口跟着弹动 */
  overscroll-behavior-y: contain;
  /* 底部留白走令牌，与其它页一致（底距 + 胶囊高 + 呼吸位） */
  padding: var(--space-3) var(--space-5) var(--tabbar-reserve, 83px);
}

/* ====== 区间 chips（页内，spec 05 §3）====== */
.range-chips {
  display: flex;
  gap: 8px;
  margin-bottom: var(--space-3);
}
.chip {
  flex: 1;
  height: 32px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-pill);
  background: var(--color-bg-card);
  color: var(--color-text-secondary);
  font-size: var(--fs-tab);
  font-weight: 500;
  font-family: var(--font-num);
  &:active { background: var(--color-bg-hover); }
  &.active {
    background: var(--color-primary);
    border-color: var(--color-primary);
    color: #fff;
  }
}

/* ====== 健康领域 ====== */
.health-block {
  display: flex;
  flex-direction: column;
}
.kpi-mini {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
}
.kpi-mini-item {
  background: var(--color-bg-hover);
  border-radius: var(--radius-lg);
  padding: 14px;
  text-align: center;
}
.kpi-mini-val {
  /* 数值阶令牌，与 KPI 统一 */
  font-size: var(--fs-metric);
  font-weight: 700;
  font-family: var(--font-num);
  color: var(--color-text-primary);
  font-variant-numeric: tabular-nums;
}
.kpi-mini-label {
  margin-top: 4px;
  font-size: var(--fs-tab);
  color: var(--color-text-tertiary);
  font-family: var(--font-num);
}
.panel-sub2 {
  font-size: var(--fs-caption-sm);
  font-weight: 600;
  color: var(--color-text-secondary);
  margin: var(--space-3) 0 var(--space-2);
}
.panel-note {
  margin: var(--space-2) 0 0;
  font-size: var(--fs-tab);
  color: var(--color-text-secondary);
  font-family: var(--font-num);
  font-variant-numeric: tabular-nums;
}
.panel-foot {
  margin: var(--space-2) 0 0;
  font-size: var(--fs-micro);
  color: var(--color-text-tertiary);
}
.health-chart {
  width: 100%;
}
.health-chart :deep(.chart) {
  width: 100%;
  height: 100%;
}

/* ====== KPI ====== */
.kpi-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
  margin-bottom: var(--space-4);
}
.kpi-card {
  background: var(--color-bg-card);
  padding: 14px;
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-xs);
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 128px;
  &.skel {
    background: linear-gradient(90deg, var(--color-bg-hover) 25%, var(--color-border) 50%, var(--color-bg-hover) 75%);
    background-size: 200% 100%;
    animation: shimmer 1.5s infinite;
  }
}
@keyframes shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
.kpi-head {
  display: flex;
  align-items: center;
  gap: 6px;
}
.kpi-emoji {
  width: 26px;
  height: 26px;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-base);
  line-height: 1;
}
.kpi-label {
  font-size: var(--fs-caption-sm);
  font-weight: 500;
  color: var(--color-text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.kpi-value {
  /* 数值阶令牌：与首页 / 待办 / 记录·习惯卡统一（原为 --fs-h3 18px） */
  font-size: var(--fs-metric);
  font-weight: 700;
  font-family: var(--font-num);
  color: var(--color-text-primary);
  line-height: 1.15;
  font-variant-numeric: tabular-nums;
}
.kpi-value-muted {
  /* 数值次要部分令牌：与首页 .kpi-value-sub、习惯卡 .kv-thin 统一 */
  font-size: var(--fs-metric-sm);
  font-weight: 500;
  color: var(--color-text-tertiary);
}
.kpi-bar {
  height: 4px;
  border-radius: var(--radius-pill);
  background: var(--color-bg-hover);
  overflow: hidden;
}
.kpi-bar-fill {
  height: 100%;
  border-radius: var(--radius-pill);
  transition: width var(--duration-base) var(--ease-out);
}
.kpi-sub {
  font-size: var(--fs-micro);
  color: var(--color-text-tertiary);
  font-family: var(--font-num);
  font-variant-numeric: tabular-nums;
}
.kpi-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}
.kpi-badge-fixed,
.kpi-badge-range {
  font-size: var(--fs-tab);
  padding: 1px 6px;
  border-radius: var(--radius-pill);
  line-height: 1.5;
}
.kpi-badge-fixed {
  background: var(--tint-neutral-bg);
  color: var(--tint-neutral-fg);
}
.kpi-badge-range {
  background: var(--tint-warning-bg);
  color: var(--tint-warning-fg);
}
.kpi-hint {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: var(--fs-tab);
  font-family: var(--font-num);
  .up { color: var(--color-success); font-weight: 600; }
  .down { color: var(--color-danger); font-weight: 600; }
}
.hint-label { color: var(--color-text-tertiary); }

/* ====== 面板 ====== */
.panel {
  background: var(--color-bg-card);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-xs);
  padding: var(--space-4);
  margin-bottom: var(--space-4);
}
.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: var(--space-3);
}
.panel-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--fs-h4);
  font-weight: 600;
  color: var(--color-text-primary);
  margin: 0;
}
.panel-sub {
  font-size: var(--fs-micro);
  color: var(--color-text-tertiary);
  white-space: nowrap;
}
.panel-meta {
  margin: 0 0 var(--space-3);
  font-size: var(--fs-micro);
  line-height: 1.5;
  color: var(--color-text-tertiary);
}

.chart-skel {
  height: 200px;
  border-radius: var(--radius-lg);
  background: linear-gradient(90deg, var(--color-bg-hover) 25%, var(--color-border) 50%, var(--color-bg-hover) 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
}

.section-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 28px 0;
  .empty-emoji { opacity: 0.6; margin-bottom: 6px; }
  p { margin: 0; font-size: var(--fs-caption-sm); color: var(--color-text-tertiary); }
}

.section-error {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 14px;
  border-radius: var(--radius-lg);
  background: var(--tint-danger-bg);
  color: var(--tint-danger-fg);
  font-size: var(--fs-caption-sm);
}
.error-panel {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 28px var(--space-4);
  .err-msg {
    margin: 0;
    font-size: var(--fs-caption-sm);
    color: var(--color-danger);
    text-align: center;
  }
}
.retry-btn {
  flex-shrink: 0;
  border: none;
  border-radius: var(--radius-pill);
  background: var(--color-danger);
  color: #FFF;
  font-size: var(--fs-micro);
  font-weight: 600;
  padding: 5px 14px;
  &.sm { padding: 4px 12px; }
  &:active { opacity: 0.85; }
}

/* ====== 热力图 ====== */
.heatmap-wrap { margin-bottom: var(--space-4); }
.heatmap-title {
  font-size: var(--fs-caption-sm);
  font-weight: 600;
  color: var(--color-text-secondary);
  margin-bottom: 10px;
}
.heatmap-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 6px;
}
.heatmap-head {
  text-align: center;
  font-size: var(--fs-tab);
  color: var(--color-text-tertiary);
}
.heatmap-cell {
  width: 100%;
  aspect-ratio: 1 / 1;
  border: none;
  padding: 0;
  border-radius: var(--radius-sm);
  transition: transform var(--duration-fast) var(--ease-out);
  &.active {
    outline: 2px solid var(--color-primary);
    outline-offset: 1px;
  }
  &:active { transform: scale(0.9); }
}
.heatmap-detail {
  margin-top: 8px;
  font-size: var(--fs-micro);
  color: var(--color-text-secondary);
  font-family: var(--font-num);
  text-align: center;
  &.placeholder { color: var(--color-text-tertiary); }
}

/* ====== 习惯列表 ====== */
.habit-list {
  display: flex;
  flex-direction: column;
}
.habit-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 0;
  & + .habit-item { border-top: 1px solid var(--color-border-light); }
}
.habit-emoji {
  flex-shrink: 0;
  width: 34px;
  height: 34px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-lg);
  line-height: 1;
}
.habit-info { flex: 1; min-width: 0; }
.habit-name {
  font-size: var(--fs-body-sm);
  font-weight: 600;
  color: var(--color-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.habit-sub {
  font-size: var(--fs-micro);
  color: var(--color-text-tertiary);
  font-family: var(--font-num);
}
.habit-done {
  margin-left: 5px;
  padding: 0 5px;
  border-radius: var(--radius-pill);
  background: var(--tint-success-bg);
  color: var(--tint-success-fg);
  font-size: var(--fs-tab);
}
.habit-meta { flex-shrink: 0; text-align: right; }
.habit-streak {
  font-size: var(--fs-tab);
  color: var(--color-text-tertiary);
  font-family: var(--font-num);
}
.habit-rate {
  font-size: var(--fs-caption-sm);
  font-weight: 700;
  font-family: var(--font-num);
}

/* ====== 完成率环 ====== */
.rate-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
}
.rate-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px;
  border-radius: var(--radius-lg);
  background: var(--color-bg-hover);
}
.rate-ring {
  position: relative;
  flex-shrink: 0;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: conic-gradient(var(--ring) 0 var(--pct, 0%), var(--color-border) 0);
  display: flex;
  align-items: center;
  justify-content: center;
}
.rate-ring::before {
  content: '';
  position: absolute;
  inset: 5px;
  border-radius: 50%;
  background: var(--color-bg-card);
}
.rate-num {
  position: relative;
  font-size: var(--fs-micro);
  font-weight: 700;
  font-family: var(--font-num);
  color: var(--color-text-primary);
}
.rate-body { flex: 1; min-width: 0; }
.rate-name {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: var(--fs-caption-sm);
  font-weight: 600;
  color: var(--color-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.rate-sub {
  font-size: var(--fs-tab);
  color: var(--color-text-tertiary);
  font-family: var(--font-num);
}

/* ====== 明细列表 ====== */
.detail-list { display: flex; flex-direction: column; }
.detail-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 0;
  & + .detail-row { border-top: 1px solid var(--color-border-light); }
}
.detail-rank {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-pill);
  font-size: var(--fs-tab);
  font-weight: 700;
  color: #FFF;
  background: var(--color-text-disabled);
  &[data-rank='1'] { background: var(--medal-gold-bg); }
  &[data-rank='2'] { background: var(--medal-silver-bg); }
  &[data-rank='3'] { background: var(--medal-bronze-bg); }
}
.detail-emoji {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-base);
  line-height: 1;
}
.detail-body { flex: 1; min-width: 0; }
.detail-top {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}
.detail-name {
  font-size: var(--fs-body-sm);
  font-weight: 600;
  color: var(--color-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.detail-amount {
  flex-shrink: 0;
  font-size: var(--fs-caption);
  font-weight: 700;
  font-family: var(--font-num);
  color: var(--color-text-primary);
  font-variant-numeric: tabular-nums;
}
.detail-bottom {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 5px;
}
.detail-bar {
  flex: 1;
  height: 4px;
  border-radius: var(--radius-pill);
  background: var(--color-bg-hover);
  overflow: hidden;
}
.detail-bar-fill {
  height: 100%;
  border-radius: var(--radius-pill);
  background: var(--color-primary);
}
.detail-count,
.detail-pct {
  flex-shrink: 0;
  font-size: var(--fs-tab);
  color: var(--color-text-tertiary);
  font-family: var(--font-num);
}
.detail-pct { font-weight: 600; color: var(--color-text-secondary); }

/* ====== 底部入口 ====== */
.goto-record {
  width: 100%;
  height: 44px;
  border: 1px dashed var(--color-border-strong);
  border-radius: var(--radius-xl);
  background: transparent;
  color: var(--color-primary);
  font-size: var(--fs-caption-sm);
  font-weight: 600;
  &:active { background: var(--color-bg-hover); }
}
</style>
