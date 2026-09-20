/**
 * ECharts 按需注册（移动端）
 *
 * 背景：桌面端用 chart.js（react-chartjs-2），移动端**不复用**，改用
 * ECharts + vue-echarts（见 md/移动端移植方案.md §4 / 用户拍板）。
 * 两条渲染栈并存是有意为之：移动端要的是 ECharts 的移动端交互与
 * 更小的按需体积，跨端共享的只有「数据形状」而不是图表实现。
 *
 * ⚠️ 只注册实际用到的模块。全量 `import * as echarts from 'echarts'`
 * 会把 ~1MB 的图表库全打进产物；本文件把体积压到 ~300KB 级别。
 * 新增图表类型时必须回到这里补注册，否则运行时会静默不渲染
 * （ECharts 对未注册的 series 不报错，只是画不出来）。
 *
 * 用法：在 **需要图表的组件里** `import '@/plugins/echarts'`，
 * 或直接 import 下面的 `VChart`。main.ts 不引入，保证首屏不带图表库。
 */
import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { BarChart, LineChart, PieChart } from 'echarts/charts'
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  TitleComponent,
  DatasetComponent,
  MarkPointComponent,
} from 'echarts/components'

use([
  CanvasRenderer,
  BarChart,
  LineChart,
  PieChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  TitleComponent,
  DatasetComponent,
  MarkPointComponent,
])

export { default as VChart } from 'vue-echarts'
