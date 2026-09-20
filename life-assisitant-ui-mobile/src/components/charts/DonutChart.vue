<script setup lang="ts">
/**
 * 环形图（移动端）
 *
 * SYNC-FROM-DESKTOP: life-assisitant-ui-desktop/src/components/charts/DoughnutCard.tsx
 * 数据形状与桌面端一致（{ label, value, color? }[]），实现改用 ECharts。
 *
 * ⚠️ 桌面端给饼图色是 `c.color || '#6B7280'`（后端 by_category 不带色时兜底中性灰）。
 * 移动端多走一步：**未给色时按 tint 循环取语义色**，避免整张饼是灰的——
 * 后端 by_category 目前确实不带 color 字段，照抄桌面端会得到一张灰饼。
 *
 * ⚠️ 高度走内联 style（px→vw 坑）。
 */
import { computed } from 'vue'
import VChart from 'vue-echarts'
import '@/plugins/echarts'
import { useChartTheme } from '@/composables/useChartTheme'

const props = withDefaults(
  defineProps<{
    data: Array<{ label: string; value: number; color?: string }>
    height?: number
    /** 图例位置：移动端默认底部横向，桌面端是右侧竖排 */
    legendPosition?: 'bottom' | 'right'
  }>(),
  {
    height: 260,
    legendPosition: 'bottom',
  }
)

const { themeColors } = useChartTheme()

/** 兜底调色板：按序循环，取自当前主题的语义色 */
const palette = computed(() => {
  const t = themeColors.value
  return [t.primary, t.danger, t.warning, t.success, t.accent, t.neutral]
})

const displayData = computed(() =>
  props.data.map((d, i) => ({
    ...d,
    fill: d.color || palette.value[i % palette.value.length],
  }))
)

const total = computed(() => displayData.value.reduce((s, d) => s + d.value, 0))

const option = computed(() => {
  const t = themeColors.value
  return {
    tooltip: {
      trigger: 'item',
      backgroundColor: t.tooltipBg,
      borderColor: t.tooltipBorder,
      borderWidth: 1,
      padding: [8, 12],
      textStyle: { color: t.tooltipText, fontSize: 12 },
      formatter: (p: { name: string; value: number; percent: number }) =>
        `${p.name}: ¥${Number(p.value).toFixed(2)} (${Math.round(p.percent)}%)`,
    },
    legend: {
      type: 'scroll',
      orient: props.legendPosition === 'right' ? 'vertical' : 'horizontal',
      ...(props.legendPosition === 'right'
        ? { right: 0, top: 'center' }
        : { bottom: 0, left: 'center' }),
      icon: 'circle',
      itemWidth: 8,
      itemHeight: 8,
      itemGap: 10,
      textStyle: { color: t.textSecondary, fontSize: 11 },
      formatter: (name: string) => (name.length > 6 ? `${name.slice(0, 6)}…` : name),
    },
    series: [
      {
        type: 'pie',
        radius: ['52%', '76%'],
        center: props.legendPosition === 'right' ? ['36%', '50%'] : ['50%', '44%'],
        avoidLabelOverlap: true,
        itemStyle: { borderColor: t.bgCard, borderWidth: 2 },
        label: { show: false },
        labelLine: { show: false },
        emphasis: {
          scale: true,
          scaleSize: 6,
          itemStyle: { shadowBlur: 12, shadowColor: 'rgba(0,0,0,0.18)' },
        },
        data: displayData.value.map((d) => ({
          name: d.label,
          value: d.value,
          itemStyle: { color: d.fill },
        })),
      },
    ],
    // 中心显示总支出（桌面端没有，移动端小屏更需要一个总量锚点）
    graphic:
      total.value > 0
        ? [
            {
              type: 'text',
              left: props.legendPosition === 'right' ? '36%' : 'center',
              top: '40%',
              style: {
                text: `¥${total.value.toFixed(0)}`,
                textAlign: 'center',
                fill: t.textPrimary,
                fontSize: 16,
                fontWeight: 700,
              },
            },
            {
              type: 'text',
              left: props.legendPosition === 'right' ? '36%' : 'center',
              top: '49%',
              style: {
                text: '合计',
                textAlign: 'center',
                fill: t.textTertiary,
                fontSize: 11,
              },
            },
          ]
        : [],
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
