<script setup lang="ts">
/**
 * 月历（移动端经期）
 *
 * SYNC-FROM-DESKTOP: life-assisitant-ui-desktop/src/pages/record/components/PeriodCalendar.tsx
 * SYNC-FROM-BACKEND: life-assisitant-api/internal/model/dto/period.go（PeriodCalendarDay.marks）
 * 契约文档：md/spec-260919/04-页面与交互设计.md §3 / §4.2
 *
 * ============================ 视觉：与习惯打卡日历同构 ============================
 * 2026-09-19：老大要求「和习惯那边的日历样式保持差不多，色调用经期自己的」。
 * 于是格子从「圆形数字 chip」改成与 `components/HabitHeatmap.vue` 完全同构的
 * **整格填色圆角方块**：周一开头 / 7 列自适应 / 整格底色表示状态 / 左上角日期
 * / 下方一行小字（有状态显示状态，无状态显示节气或农历）/ 右下角圆点表示点滴或已记录
 * / 空格子沿用中性灰（对应习惯热力图的「未记录」档）。
 *
 * ⚠️ 唯一与 HabitHeatmap 的关键差异（**不要照抄它的做法**）：
 *    习惯热力图的绿色阶是「不随主题翻转的顺序色阶」，所以它**刻意硬编码 hex**；
 *    经期用的是会翻转的语义色令牌（--color-period* 暗色下整体提亮），
 *    因此这里**必须全部走 var() 令牌**，否则暗色主题下会出现「白字压浅红底」的
 *    不可读事故。经量三档的实心填充另有独立令牌（见 styles/tokens.scss 的说明：
 *    暗色下 --color-period-dark 是**文字色**，直接当填充会让色阶方向反转）。
 *
 * ⚠️ 颜色语义是这个功能的命门（04 §3.1），每个标记都**有形状/文字差异**，
 *    不许只靠颜色区分（04 §3.5）：经期=实心块 / 预测=虚线框 / 易孕=淡紫底 /
 *    排卵=紫色实心 / 峰值=紫描边 / 点滴=右下红点 / 已记录=右下灰点。
 *    改造后每个格子还多了**中文状态标签**，可读性和 a11y 都更强。
 *
 * ⚠️ 「相对安全期」**不上色**（04 §3.3）。它是「没有高风险标记」的默认留白，
 *    给它上色（尤其绿色）会制造危险的确定感。后端也从不把 safe 作为 mark 返回。
 *
 * ⚠️ 遮罩（👁）开启时：经期/预测/易孕/排卵/点滴标记**全部不渲染**，
 *    格子回落成中性灰 + 农历/节气（非敏感信息），只保留「今天」描边与
 *    「已记录」灰点；日期格仍可点击补记（04 §3.6）。
 *
 * 与设计稿的一处实现差异：设计写「左右滑动切月（swiper）」，
 * 这里用**轻量手势**（触摸横向位移 > 48px 切月）而非引入 van-swipe 的
 * 月份列表 —— 只为切月挂载一整套 swiper 不划算，手感一致。
 */
import { computed, onBeforeUnmount } from 'vue'
import { getLunarDatesInRange, getSolarTerms } from 'chinese-days'
import type { PeriodCalendarDay, PeriodMark } from '@/api/types'

const props = defineProps<{
  /** YYYY-MM */
  month: string
  /** 只包含有标记的日期 */
  days: PeriodCalendarDay[]
  /** 隐私遮罩 */
  masked: boolean
  /** 今天（后端给的服务器口径，统一用这个而不是本地 new Date） */
  today: string
}>()

const emit = defineEmits<{
  (e: 'change-month', month: string): void
  (e: 'pick-day', date: string): void
  (e: 'longpress-day', date: string): void
}>()

/** 周一开头，周末（六/日）落在最后两列 —— 与 HabitHeatmap 一致 */
const WEEK_HEADERS = ['一', '二', '三', '四', '五', '六', '日'] as const

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

const markMap = computed(() => {
  const map = new Map<string, PeriodMark[]>()
  for (const d of props.days) map.set(d.date, d.marks)
  return map
})

interface DayCell {
  date: string
  day: number
  inMonth: boolean
  isWeekend: boolean
  lunarDay: string
  solarTerm: string
}

const cells = computed<DayCell[]>(() => {
  const [y, m] = props.month.split('-').map(Number)
  if (!y || !m) return []
  const daysInMonth = new Date(y, m, 0).getDate()
  // 周一=0 … 周日=6（与 HabitHeatmap 同式）
  const firstCol = (new Date(y, m - 1, 1).getDay() + 6) % 7
  // 行数对齐整周（习惯热力图同款算法）：不足一行的补满，否则最后一行格子宽度会错位
  const rows = Math.min(6, Math.max(4, Math.ceil((firstCol + daysInMonth) / 7)))
  const total = rows * 7

  // 农历 / 节气：范围取整个网格（含上/下月的补格）
  const gridStart = new Date(y, m - 1, 1 - firstCol)
  const gridEnd = new Date(y, m - 1, 1 - firstCol + total)
  const lunarMap = new Map<string, string>()
  for (const l of getLunarDatesInRange(gridStart, gridEnd)) lunarMap.set(l.date, l.lunarDayCN)
  const termMap = new Map<string, string>()
  for (const t of getSolarTerms(gridStart, gridEnd)) termMap.set(t.date, t.name)

  const out: DayCell[] = []
  for (let i = 0; i < total; i++) {
    const offset = i - firstCol
    const d = new Date(y, m - 1, 1 + offset)
    const ds = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    const wd = d.getDay()
    out.push({
      date: ds,
      day: d.getDate(),
      inMonth: offset >= 0 && offset < daysInMonth,
      isWeekend: wd === 0 || wd === 6,
      lunarDay: lunarMap.get(ds) ?? '',
      solarTerm: termMap.get(ds) ?? '',
    })
  }
  return out
})

/** 月份标题 */
const monthTitle = computed(() => {
  const [y, m] = props.month.split('-').map(Number)
  if (!y || !m) return ''
  return `${y}年${m}月经期日历`
})

/* ==================== 标记 → 视觉（04 §3.1 优先级）==================== */

type StateKind =
  | 'ovulation'
  | 'heavy'
  | 'medium'
  | 'light'
  | 'period'
  | 'predicted'
  | 'peak'
  | 'fertile'

/** 占据整格底色的状态，按优先级从高到低 */
const STATE_PRIORITY: PeriodMark[] = [
  'ovulation',
  'flow_heavy',
  'flow_medium',
  'flow_light',
  'period',
  'period_predicted',
  'peak',
  'fertile',
]

const STATE_KIND: Record<string, StateKind> = {
  ovulation: 'ovulation',
  flow_heavy: 'heavy',
  flow_medium: 'medium',
  flow_light: 'light',
  period: 'period',
  period_predicted: 'predicted',
  peak: 'peak',
  fertile: 'fertile',
}

/** 格子右下角小字标签：既是可读性（不只靠颜色），也是 a11y 的落点 */
const STATE_LABEL: Record<StateKind, string> = {
  ovulation: '排卵',
  heavy: '大量',
  medium: '中量',
  light: '少量',
  period: '经期',
  predicted: '预测',
  peak: '峰值',
  fertile: '易孕',
}

interface CellVis {
  kind: StateKind | null
  dot: '' | 'spotting' | 'logged'
  isToday: boolean
}

function resolveVis(date: string): CellVis {
  const marks = markMap.value.get(date) ?? []
  const isToday = date === props.today || marks.includes('today')

  // 遮罩态：所有「结论性」标记都不渲染，只留今天描边与已记录灰点
  if (props.masked) {
    return { kind: null, dot: marks.includes('logged') ? 'logged' : '', isToday }
  }

  let kind: StateKind | null = null
  for (const p of STATE_PRIORITY) {
    if (marks.includes(p)) {
      kind = STATE_KIND[p]
      break
    }
  }
  // spotting 与出血量互斥（后端 switch 分支），所以红点只会落在非实心格上
  const dot = marks.includes('spotting')
    ? 'spotting'
    : marks.includes('logged')
      ? 'logged'
      : ''
  return { kind, dot, isToday }
}

const visMap = computed(() => {
  const map = new Map<string, CellVis>()
  for (const c of cells.value) map.set(c.date, resolveVis(c.date))
  return map
})

function visOf(date: string): CellVis {
  return visMap.value.get(date) ?? { kind: null, dot: '', isToday: false }
}

function cellClass(c: DayCell): Record<string, boolean> {
  // 非本月：整格留白（不上任何状态底色），只留淡淡的日期做「跨月补记」的参照
  if (!c.inMonth) return { 'is-out': true }
  const v = visOf(c.date)
  return {
    [`st-${v.kind ?? 'none'}`]: true,
    'is-today': v.isToday,
    'is-weekend': c.isWeekend,
  }
}

/** 格子下方小字：有状态 → 状态标签；无状态 → 节气优先、其次农历（与习惯热力图同规则） */
function subOf(c: DayCell): string {
  if (!c.inMonth) return ''
  const v = visOf(c.date)
  if (v.kind) return STATE_LABEL[v.kind]
  return c.solarTerm || c.lunarDay
}

/**
 * 小字配色分三类。
 * ⚠️ 绿色/灰色只可能出现在**中性底色**的格子上（因为 `subOf` 一旦命中状态就返回
 *    状态标签），所以这里用主题令牌是安全的 —— 不会出现「深绿压在深红实心上」。
 */
function subClass(c: DayCell): string {
  if (visOf(c.date).kind) return 'is-state'
  return c.solarTerm ? 'is-term' : 'is-lunar'
}

function dotOf(c: DayCell): string {
  return c.inMonth ? visOf(c.date).dot : ''
}

function ariaOf(c: DayCell): string {
  if (!c.inMonth) return ''
  const label = subOf(c)
  return label ? `${c.date} ${label}` : `${c.date} 记录`
}

/* ==================== 月份切换 ==================== */

const isCurrentMonth = computed(() => props.month === (props.today || '').slice(0, 7))

function shiftMonth(delta: number): void {
  const [y, m] = props.month.split('-').map(Number)
  if (!y || !m) return
  const d = new Date(y, m - 1 + delta, 1)
  emit('change-month', `${d.getFullYear()}-${pad(d.getMonth() + 1)}`)
}

function backToCurrent(): void {
  const t = props.today || ''
  if (t) emit('change-month', t.slice(0, 7))
}

/* ==================== 手势：横滑切月 + 长按 ==================== */

let startX = 0
let startY = 0

function onTouchStart(e: TouchEvent): void {
  const t = e.touches[0]
  if (!t) return
  startX = t.clientX
  startY = t.clientY
}

function onTouchEnd(e: TouchEvent): void {
  const t = e.changedTouches[0]
  if (!t) return
  const dx = t.clientX - startX
  const dy = t.clientY - startY
  if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.5) {
    shiftMonth(dx < 0 ? 1 : -1)
  }
}

/** 长按「设为经期第一天」 */
let pressTimer: ReturnType<typeof setTimeout> | null = null
let longPressed = false

function clearPress(): void {
  if (pressTimer) {
    clearTimeout(pressTimer)
    pressTimer = null
  }
}

function onCellPointerDown(date: string): void {
  longPressed = false
  clearPress()
  pressTimer = setTimeout(() => {
    longPressed = true
    emit('longpress-day', date)
  }, 600)
}

function onCellClick(date: string): void {
  clearPress()
  if (longPressed) {
    // 长按已触发，本次抬手不再当点击处理
    longPressed = false
    return
  }
  emit('pick-day', date)
}

onBeforeUnmount(clearPress)

/** 今天是否落在当前展示月（图例右侧的提示用） */
const todayInMonth = computed(() => !!props.today && props.today.startsWith(props.month))
</script>

<template>
  <section class="cal-card">
    <!-- ==================== 头部：左标题 + 右导航（对齐习惯打卡日历）==================== -->
    <div class="cal-head">
      <span class="cal-title">{{ monthTitle }}</span>
      <div class="cal-nav-group">
        <button class="cal-nav" type="button" aria-label="上个月" @click="shiftMonth(-1)">‹</button>
        <button class="cal-nav" type="button" aria-label="下个月" @click="shiftMonth(1)">›</button>
        <button v-if="!isCurrentMonth" class="cal-nav is-text" type="button" @click="backToCurrent">
          回到本月
        </button>
      </div>
    </div>

    <!-- ==================== 周标题（周一开头）==================== -->
    <div class="cal-week">
      <span
        v-for="(w, i) in WEEK_HEADERS"
        :key="w"
        class="cal-week-cell"
        :class="{ 'is-weekend': i >= 5 }"
      >
        {{ w }}
      </span>
    </div>

    <!-- ==================== 日期网格 ==================== -->
    <div class="cal-grid" @touchstart.passive="onTouchStart" @touchend.passive="onTouchEnd">
      <button
        v-for="c in cells"
        :key="c.date"
        type="button"
        class="cal-cell"
        :class="cellClass(c)"
        :disabled="!c.inMonth"
        :aria-label="ariaOf(c)"
        @pointerdown="onCellPointerDown(c.date)"
        @pointerup="onCellClick(c.date)"
        @pointerleave="clearPress"
        @contextmenu.prevent
      >
        <span class="cal-day">{{ c.inMonth ? c.day : '' }}</span>
        <span class="cal-sub" :class="subClass(c)">{{ subOf(c) }}</span>
        <span
          v-if="dotOf(c)"
          class="cal-dot"
          :class="dotOf(c) === 'spotting' ? 'is-spot' : 'is-logged'"
        />
      </button>
    </div>

    <!-- ==================== 图例 ==================== -->
    <div class="cal-legend">
      <span class="cal-legend-group">
        <span class="cal-legend-text">经期</span>
        <span class="legend-box is-soft" />
        <span class="legend-box is-mid" />
        <span class="legend-box is-heavy" />
        <span class="cal-legend-text">少→多</span>
      </span>
      <span class="cal-legend-item"><span class="legend-box is-dashed" />预测</span>
      <span class="cal-legend-item"><span class="legend-box is-fertile" />易孕</span>
      <span class="cal-legend-item"><span class="legend-dot is-ovu" />排卵</span>
      <span class="cal-legend-item"><span class="legend-dot is-spot" />点滴</span>
      <span v-if="masked" class="cal-legend-note">内容已隐藏</span>
      <span v-else-if="todayInMonth" class="cal-legend-note">
        今天 {{ today.slice(5).replace('-', '/') }}
      </span>
    </div>
  </section>
</template>

<style lang="scss" scoped>
/* 布局与排版（.cal-card/.cal-head/.cal-nav/.cal-week/.cal-grid/.cal-cell/.cal-day
   /.cal-sub 与图例排版）已迁共享层 styles/_calendar.scss（260921 二批，
   逐 class diff 后只抽 Period/Health 两两完全相同的规则）。
   本块只留经期专属：st-* 状态填色、已记录灰点、实心格白点反白。
   ⚠️ @use 必须位于其它规则之前（SCSS 硬规则，放后面编译直接失败）。 */
@use '@/styles/calendar';

/* ==================== 头部 ====================
   .cal-head / .cal-title / .cal-nav-group / .cal-nav（含 .is-text）→ 共享层 */

/* ==================== 周标题 ====================
   .cal-week / .cal-week-cell（含 .is-weekend）→ 共享层 */

/* ==================== 网格 ====================
   .cal-grid / .cal-cell（含 .is-out）/ .cal-day / .cal-sub（含 .is-state/
   .is-term/.is-lunar）→ 共享层 */

/* ==================== 状态 → 整格填色 ====================
   填充令牌见 styles/tokens.scss（暗色下重排，保证「越深/越亮 = 量越多」单调）。
   今天的主色边框规则放在本段之后 —— 同为 (0,2,0) 特异性，靠源码顺序取胜。 */
.st-none {
  background: var(--color-bg-hover);
  color: var(--color-text-primary);

  &.is-weekend { color: var(--color-text-tertiary); }
}
.st-light,
.st-period {
  background: var(--color-period-soft);
  color: var(--color-period-dark);
}
.st-medium {
  background: var(--color-period-fill-mid);
  color: #FFFFFF;
}
.st-heavy {
  background: var(--color-period-fill-heavy);
  color: #FFFFFF;
}
/* 预测经期：虚线框是「还没发生」的关键信号（与实心经期区分） */
.st-predicted {
  background: var(--color-period-soft);
  color: var(--color-period-dark);
  border: 1.5px dashed var(--color-period);
}
.st-fertile {
  background: var(--color-fertile-soft);
  color: var(--color-fertile-strong);
}
/* 峰值期：淡紫底 + 紫色细描边 */
.st-peak {
  background: var(--color-fertile-soft);
  color: var(--color-fertile-strong);
  border: 1.5px solid var(--color-ovulation);
}
/* 排卵日：全局唯一的一天，视觉必须唯一 */
.st-ovulation {
  background: var(--color-ovulation-fill);
  color: #FFFFFF;
}

/* 今天：优先级最高的边框（覆盖预测/峰值的边框；状态标签仍在，语义不丢） */
.cal-cell.is-today {
  border: 2px solid var(--color-primary);
}

/* ==================== 右下角圆点（点滴 / 已记录）====================
   基础 .cal-dot 与 .is-spot 在共享层；这里只留 Period 专属的已记录灰点。 */
.cal-dot.is-logged { background: var(--color-text-tertiary); }
/* 实心底（中量/大量/排卵）上任何圆点都换白色，否则看不见。
   注：spotting 与出血量互斥，所以红点只可能落在非实心格上。 */
.cal-cell.st-medium .cal-dot,
.cal-cell.st-heavy .cal-dot,
.cal-cell.st-ovulation .cal-dot {
  background: rgba(255, 255, 255, 0.92);
}

/* ==================== 图例 ====================
   排版（.cal-legend* / .legend-box 基础 / .legend-dot 基础与 .is-ovu /
   .cal-legend-note）→ 共享层。这里只留 Period 专属的点滴图例色：
   底色变体（is-soft/is-mid/...）是经期语义色，按 03 §C「不抽语义色」留在本组件。 */
.legend-box {
  &.is-soft { background: var(--color-period-soft); }
  &.is-mid { background: var(--color-period-fill-mid); }
  &.is-heavy { background: var(--color-period-fill-heavy); }
  &.is-dashed {
    background: var(--color-period-soft);
    border: 1.5px dashed var(--color-period);
  }
  &.is-fertile { background: var(--color-fertile-soft); }
}
.legend-dot.is-spot { width: 6px; height: 6px; background: var(--color-period); }
</style>
