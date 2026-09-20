/**
 * 图表主题联动（移动端）
 *
 * 核心问题：ECharts 画在 <canvas> 上，**canvas 不吃 CSS 变量**。
 * 所以 `color: 'var(--x)'` 这类写法在图表里完全无效，必须把
 * CSS 变量解析成**具体 hex 字符串**再喂给 ECharts。
 *
 * 而一旦解析成 hex，主题切换（<html data-theme="dark">）就不会自动重绘 ——
 * 于是本 composable 的职责就是：
 *   1. 从 document.documentElement 的 computedStyle 读出当前主题下的真实颜色；
 *   2. 监听 data-theme 属性变化，重算颜色并触发图表重绘。
 *
 * 用途：所有 charts/*.vue 组件都从 `themeColors` 取色，
 * **不要在图表组件里写 hex 字面量**（热力图的 5 档绿阶是唯一例外，
 * 见 utils/heatmap.ts 的说明：顺序色阶刻意不随主题反转）。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useThemeStore } from '@/stores/theme'

/** 从 CSS 变量读一个颜色的具体值 */
function readVar(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

export interface ChartThemeColors {
  /** 主文字（tooltip 标题、轴标签强调） */
  textPrimary: string
  /** 次级文字（轴标签） */
  textSecondary: string
  /** 弱化文字 */
  textTertiary: string
  /** 网格线 */
  gridLine: string
  /** 轴/网格分割线（比 gridLine 更浅） */
  axisLine: string
  /** tooltip 背景 */
  tooltipBg: string
  /** tooltip 边框 */
  tooltipBorder: string
  /** tooltip 文字 */
  tooltipText: string
  /** 卡片背景（donut 描边色用的是它，避免白边在暗色下刺眼） */
  bgCard: string
  /** 品牌主色 */
  primary: string
  /** 语义色 */
  success: string
  warning: string
  danger: string
  accent: string
  /** 中性色（饼图兜底色） */
  neutral: string
}

/** 读当前主题下的全套图表用色 */
function readColors(): ChartThemeColors {
  return {
    textPrimary: readVar('--color-text-primary', '#0A1628'),
    textSecondary: readVar('--color-text-secondary', '#374151'),
    textTertiary: readVar('--color-text-tertiary', '#6B7280'),
    gridLine: readVar('--color-border-light', '#F3F4F6'),
    axisLine: readVar('--color-border', '#E5E7EB'),
    tooltipBg: readVar('--color-bg-card', '#FFFFFF'),
    tooltipBorder: readVar('--color-border', '#E5E7EB'),
    tooltipText: readVar('--color-text-secondary', '#374151'),
    bgCard: readVar('--color-bg-card', '#FFFFFF'),
    primary: readVar('--color-primary', '#014DB2'),
    success: readVar('--color-success', '#10B981'),
    warning: readVar('--color-warning', '#F59E0B'),
    danger: readVar('--color-danger', '#EF4444'),
    accent: readVar('--color-accent', '#8B5CF6'),
    neutral: readVar('--color-text-tertiary', '#6B7280'),
  }
}

/**
 * 返回当前主题下的图表用色，并随 data-theme 变化自动更新。
 * 返回值是 `computed`，图表组件的 option 用 computed 包一层即可自动重绘。
 */
export function useChartTheme() {
  const themeStore = useThemeStore()
  const colors = ref<ChartThemeColors>(readColors())

  let observer: MutationObserver | null = null

  function refresh(): void {
    colors.value = readColors()
  }

  onMounted(() => {
    // 主题切换的唯一信号是 <html data-theme> 被改写；
    // 监听属性而非 themeStore.theme，是因为 system 模式下系统偏好变化时
    // store 的 mode 值不变但 data-theme 会变 —— 只盯 store 会漏掉这一类。
    observer = new MutationObserver(() => refresh())
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    })
  })

  onBeforeUnmount(() => {
    observer?.disconnect()
    observer = null
  })

  return {
    /** 当前主题的图表用色（响应式） */
    themeColors: computed(() => colors.value),
    /** 当前是否暗色（个别图表需要分支处理时用） */
    isDark: computed(() => themeStore.resolved() === 'dark'),
    /** 手动刷新（例如 store 改主题后想立刻同步） */
    refresh,
  }
}

/** 把 hex 转成带透明度的 rgba（ECharts 的 areaStyle / 柱底色需要） */
export function withAlpha(hex: string, alpha: number): string {
  const h = hex.trim()
  // 不是 6 位 hex（例如已是 rgb()/var()）时原样返回，避免生成非法色值
  if (!/^#[0-9a-fA-F]{6}$/.test(h)) return h
  const r = parseInt(h.slice(1, 3), 16)
  const g = parseInt(h.slice(3, 5), 16)
  const b = parseInt(h.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}
