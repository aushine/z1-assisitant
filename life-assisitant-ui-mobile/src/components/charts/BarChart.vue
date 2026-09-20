<script setup lang="ts">
/**
 * 柱状图（移动端）
 *
 * SYNC-FROM-DESKTOP: life-assisitant-ui-desktop/src/components/charts/BarChartCard.tsx
 * 数据形状与桌面端一致（{ label, value }[]），实现改用 ECharts。
 *
 * ⚠️ 高度**必须**走内联 style，不能写进 <style lang="scss">：
 * postcss-px-to-viewport（基准 375）会把 SCSS 里的 px 全转成 vw，
 * 「固定 260px」会变成 ~69vw 随屏幕缩放变形。内联 style 不在 postcss
 * 处理范围内，是唯一安全位置（见 md/移动端移植方案.md §3.5）。
 */
import { computed } from 'vue'
import VChart from 'vue-echarts'
import '@/plugins/echarts'
import { useChartTheme, withAlpha } from '@/composables/useChartTheme'

const props = withDefaults(
  defineProps<{
    data: Array<{ label: string; value: number }>
    /** 主色，默认品牌主色；传 'primary' | 'success' 等语义名可自动跟随主题 */
    color?: string
    height?: number
    /** Y 轴是否为金额（格式化 tooltip） */
    money?: boolean
  }>(),
  {
    color: '',
    height: 260,
    money: false,
  }
)

const { themeColors } = useChartTheme()

/** 语义名 → 当前主题下的真实色值；也接受调用方直接给 hex（与桌面端兼容） */
const resolvedColor = computed(() => {
  const c = props.color
  if (!c) return themeColors.value.primary
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
      axisPointer: { type: 'shadow', shadowStyle: { color: withAlpha(color, 0.08) } },
      valueFormatter: (v: number) => (props.money ? `¥${Number(v).toFixed(2)}` : String(v)),
    },
    xAxis: {
      type: 'category',
      data: props.data.map((d) => d.label),
      axisLine: { lineStyle: { color: t.axisLine } },
      axisTick: { show: false },
      axisLabel: { color: t.textTertiary, fontSize: 10, interval: 'auto', rotate: 0 },
    },
    yAxis: {
      type: 'value',
      splitLine: { lineStyle: { color: t.gridLine } },
      axisLine: { show: false },
      axisLabel: { color: t.textTertiary, fontSize: 10 },
    },
    series: [
      {
        type: 'bar',
        data: props.data.map((d) => d.value),
        itemStyle: {
          color: withAlpha(color, 0.7),
          borderColor: color,
          borderWidth: 1,
          borderRadius: [4, 4, 0, 0],
        },
        barMaxWidth: 18,
        emphasis: { itemStyle: { color } },
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
  /* 高度由内联 style 给出，此处不写 px（会被转 vw） */
}
.chart {
  width: 100%;
  height: 100%;
}
</style>
