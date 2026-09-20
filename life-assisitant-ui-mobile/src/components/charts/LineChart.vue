<script setup lang="ts">
/**
 * 折线图（移动端 · 带面积填充）
 *
 * SYNC-FROM-DESKTOP: life-assisitant-ui-desktop/src/components/charts/LineChartCard.tsx
 * 数据形状与桌面端一致（{ label, value }[]），实现改用 ECharts。
 *
 * ⚠️ 高度走内联 style —— px 写在 SCSS 会被 postcss-px-to-viewport 转成 vw。
 */
import { computed } from 'vue'
import VChart from 'vue-echarts'
import '@/plugins/echarts'
import { useChartTheme, withAlpha } from '@/composables/useChartTheme'

const props = withDefaults(
  defineProps<{
    data: Array<{ label: string; value: number }>
    color?: string
    height?: number
    money?: boolean
  }>(),
  {
    color: '',
    height: 260,
    money: false,
  }
)

const { themeColors } = useChartTheme()

const resolvedColor = computed(() => {
  const c = props.color
  if (!c) return themeColors.value.danger
  const map: Record<string, string | undefined> = {
    primary: themeColors.value.primary,
    success: themeColors.value.success,
    warning: themeColors.value.warning,
    danger: themeColors.value.danger,
    accent: themeColors.value.accent,
    neutral: themeColors.value.neutral,
  }
  return map[c] ?? c
})

const option = computed(() => {
  const t = themeColors.value
  const color = resolvedColor.value
  return {
    grid: { left: 8, right: 12, top: 16, bottom: 4, containLabel: true },
    tooltip: {
      trigger: 'axis',
      backgroundColor: t.tooltipBg,
      borderColor: t.tooltipBorder,
      borderWidth: 1,
      padding: [8, 12],
      textStyle: { color: t.tooltipText, fontSize: 12 },
      axisPointer: { type: 'line', lineStyle: { color: withAlpha(color, 0.4) } },
      valueFormatter: (v: number) => (props.money ? `¥${Number(v).toFixed(2)}` : String(v)),
    },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: props.data.map((d) => d.label),
      axisLine: { lineStyle: { color: t.axisLine } },
      axisTick: { show: false },
      axisLabel: { color: t.textTertiary, fontSize: 10, interval: 'auto' },
    },
    yAxis: {
      type: 'value',
      splitLine: { lineStyle: { color: t.gridLine } },
      axisLine: { show: false },
      axisLabel: { color: t.textTertiary, fontSize: 10 },
    },
    series: [
      {
        type: 'line',
        data: props.data.map((d) => d.value),
        smooth: 0.4,
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
              { offset: 0, color: withAlpha(color, 0.22) },
              { offset: 1, color: withAlpha(color, 0.02) },
            ],
          },
        },
      },
    ],
  }
})
</script>

<template>
  <div class="chart-box" :style="{ height: `${height}px` }">
    <VChart class="chart" :option="option" autoresize />
  </div>
</template>

<style lang="scss" scoped>
.chart-box {
  width: 100%;
}
.chart {
  width: 100%;
  height: 100%;
}
</style>
