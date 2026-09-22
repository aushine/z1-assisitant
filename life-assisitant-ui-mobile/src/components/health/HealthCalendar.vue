<script setup lang="ts">
/**
 * 健康月历（移动端）
 *
 * SYNC-FROM: src/styles/_calendar.scss（260921 二批起，布局/排版/图例排版以共享层为准）
 * SYNC-FROM: src/components/period/PeriodCalendar.vue（st-* 语义色与标记语义仍是经期同源）
 * SYNC-FROM-BACKEND: life-assisitant-api/internal/model/dto/health.go（HealthCalendarDay.marks）
 *
 * 与经期日历的差异：
 *   1. 标记取值走 HEALTH_MARKS（含新增的 `logged` 灰点：格子下沿表示「当日有健康记录」）。
 *   2. 健康无隐私遮罩（👁）概念，不做 masking 分支。
 *   3. 月份上方多一条 month_summary 摘要条（记录天数 / 达标饮水天 / 体重均值 / 经期天数）。
 *
 * ⚠️ 颜色语义同经期：有形状/文字差异，不许只靠颜色区分；相对安全期不上色。
 * ⚠️ 横滑切月（触摸位移 > 48px），不引入 swiper。
 */
import { computed, onBeforeUnmount } from 'vue'
import { getLunarDatesInRange, getSolarTerms } from 'chinese-days'
import {
  CALENDAR_DOT_COLOR,
  CALENDAR_DOT_LABEL,
  CALENDAR_DOT_MARKS,
  CALENDAR_DOT_MAX,
  HEALTH_MARKS,
} from '@/constants/health'
import type { CalendarDotMark } from '@/constants/health'
import type { HealthCalendarDay, HealthMonthSummary } from '@/api/types'

const props = defineProps<{
  /** YYYY-MM */
  month: string
  /** 只包含有标记的日期 */
  days: HealthCalendarDay[]
  /** 月份摘要条 */
  summary?: HealthMonthSummary | null
  /** 今天（后端给的服务器口径） */
  today: string
  /**
   * 是否启用经期（来自 settings.metrics_enabled）。
   *
   * ⚠️ 后端日历接口已经按它过滤 marks（未启用经期不返回 period / period_predicted /
   *    spotting / fertile / peak / ovulation），但**图例是前端渲染的** —— 不门控就会出现
   *    「我没勾经期，日历底下却挂着经期/预测/易孕/排卵四个图例」的割裂感。
   */
  periodOn?: boolean
}>()

const emit = defineEmits<{
  (e: 'change-month', month: string): void
  (e: 'pick-day', date: string): void
  (e: 'longpress-day', date: string): void
}>()

const WEEK_HEADERS = ['一', '二', '三', '四', '五', '六', '日'] as const

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

const markMap = computed(() => {
  const map = new Map<string, string[]>()
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
  const firstCol = (new Date(y, m - 1, 1).getDay() + 6) % 7
  const rows = Math.min(6, Math.max(4, Math.ceil((firstCol + daysInMonth) / 7)))
  const total = rows * 7

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

const monthTitle = computed(() => {
  const [y, m] = props.month.split('-').map(Number)
  if (!y || !m) return ''
  return `${y}年${m}月`
})

type StateKind = 'ovulation' | 'heavy' | 'medium' | 'light' | 'period' | 'predicted' | 'peak' | 'fertile'

const STATE_PRIORITY: string[] = [
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
  /** 经期的「点滴」仍走单个红点（语义独立，不与分类点混排） */
  dot: '' | 'spotting'
  /** 当日记录了哪些指标（去重后的分类点，顺序固定：心情→精力→体温→饮水→排便→体重） */
  dots: CalendarDotMark[]
  /** 被折叠掉的点数（> 0 时渲染「+N」） */
  dotMore: number
  isToday: boolean
}

function resolveVis(date: string): CellVis {
  const marks = markMap.value.get(date) ?? []
  const isToday = date === props.today || marks.includes(HEALTH_MARKS.today)
  let kind: StateKind | null = null
  for (const p of STATE_PRIORITY) {
    if (marks.includes(p)) {
      kind = STATE_KIND[p]
      break
    }
  }
  const dot = marks.includes(HEALTH_MARKS.spotting) ? 'spotting' : ''
  // ⚠️ 分类点从 marks 里按 CALENDAR_DOT_MARKS 的固定顺序抽，保证同月每天的配色位置一致，
  //    用户能靠「位置」而不是只靠颜色辨认（色觉障碍友好）。
  const dots = CALENDAR_DOT_MARKS.filter((m) => marks.includes(m))
  const dotMore = Math.max(0, dots.length - CALENDAR_DOT_MAX)
  return { kind, dot, dots: dots.slice(0, CALENDAR_DOT_MAX), dotMore, isToday }
}

const visMap = computed(() => {
  const map = new Map<string, CellVis>()
  for (const c of cells.value) map.set(c.date, resolveVis(c.date))
  return map
})

const EMPTY_VIS: CellVis = { kind: null, dot: '', dots: [], dotMore: 0, isToday: false }

function visOf(date: string): CellVis {
  return visMap.value.get(date) ?? EMPTY_VIS
}

/** 单个分类点的颜色（a11y：颜色之外还有图例文字，不单靠颜色区分） */
function dotStyle(m: CalendarDotMark): Record<string, string> {
  return { background: CALENDAR_DOT_COLOR[m] }
}

function dotTitle(m: CalendarDotMark): string {
  return CALENDAR_DOT_LABEL[m]
}

function cellClass(c: DayCell): Record<string, boolean> {
  if (!c.inMonth) return { 'is-out': true }
  const v = visOf(c.date)
  return {
    [`st-${v.kind ?? 'none'}`]: true,
    'is-today': v.isToday,
    'is-weekend': c.isWeekend,
  }
}

function subOf(c: DayCell): string {
  if (!c.inMonth) return ''
  const v = visOf(c.date)
  if (v.kind) return STATE_LABEL[v.kind]
  return c.solarTerm || c.lunarDay
}

function subClass(c: DayCell): string {
  if (visOf(c.date).kind) return 'is-state'
  return c.solarTerm ? 'is-term' : 'is-lunar'
}

function ariaOf(c: DayCell): string {
  if (!c.inMonth) return ''
  const v = visOf(c.date)
  const label = subOf(c)
  const head = label ? `${c.date} ${label}` : c.date
  // a11y：分类点的信息不能只靠颜色传，读屏要能报出「记了心情、体温」
  const metrics = v.dots.map((m) => CALENDAR_DOT_LABEL[m]).join('、')
  const tail = metrics ? `。已记录：${metrics}${v.dotMore ? ` 等 ${v.dots.length + v.dotMore} 项` : ''}` : ''
  return head + tail
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
    longPressed = false
    return
  }
  emit('pick-day', date)
}

onBeforeUnmount(clearPress)

const todayInMonth = computed(() => !!props.today && props.today.startsWith(props.month))

/** 未显式传时按「启用」处理，避免漏传导致图例凭空消失 */
const periodOn = computed(() => props.periodOn !== false)

/* ==================== 摘要条 ==================== */
const summaryText = computed(() => {
  const s = props.summary
  if (!s) return ''
  const parts: string[] = [`记录 ${s.recorded_days} 天`]
  if (s.water_goal_days) parts.push(`饮水达标 ${s.water_goal_days} 天`)
  if (typeof s.weight_avg === 'number' && s.weight_avg != null) parts.push(`体重均 ${s.weight_avg.toFixed(1)}kg`)
  // 后端未启用经期时 period_days 恒为 0，这里再按 periodOn 兜一层，双保险
  if (periodOn.value && s.period_days) parts.push(`经期 ${s.period_days} 天`)
  return parts.join(' · ')
})
</script>

<template>
  <section class="cal-card">
    <!-- ==================== 摘要条 ==================== -->
    <div v-if="summaryText" class="cal-summary">{{ summaryText }}</div>

    <!-- ==================== 头部 ==================== -->
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

    <!-- ==================== 周标题 ==================== -->
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
        <!-- 经期点滴（独立语义，红色单排） -->
        <span v-if="visOf(c.date).dot === 'spotting'" class="cal-dot is-spot" />
        <!-- 分类点：一行最多 CALENDAR_DOT_MAX 个，重叠排布；超出的折叠成「+N」 -->
        <span v-if="visOf(c.date).dots.length" class="cal-dots">
          <span
            v-for="m in visOf(c.date).dots"
            :key="m"
            class="cal-dot is-metric"
            :style="dotStyle(m)"
            :title="dotTitle(m)"
          />
          <span v-if="visOf(c.date).dotMore" class="cal-dot-more">
            +{{ visOf(c.date).dotMore }}
          </span>
        </span>
      </button>
    </div>

    <!-- ==================== 图例 ==================== -->
    <!-- ⚠️ 经期相关图例仅在启用经期时出现，与后端 marks 的门控保持一致 -->
    <div class="cal-legend">
      <template v-if="periodOn">
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
      </template>
      <!-- 分类点图例：颜色之外带文字，不单靠颜色区分（色觉障碍友好） -->
      <span
        v-for="m in CALENDAR_DOT_MARKS"
        :key="m"
        class="cal-legend-item"
      >
        <span class="legend-dot is-metric" :style="dotStyle(m)" />{{ dotTitle(m) }}
      </span>
      <span v-if="todayInMonth" class="cal-legend-note">
        今天 {{ today.slice(5).replace('-', '/') }}
      </span>
    </div>
  </section>
</template>

<style lang="scss" scoped>
/* 布局与排版（.cal-card/.cal-head/.cal-nav/.cal-week/.cal-grid/.cal-cell/.cal-day
   /.cal-sub 与图例排版）已迁共享层 styles/_calendar.scss（260921 二批）。
   本块只留健康专属：摘要条、st-* 状态填色、分类点（.cal-dots/.is-metric/+N）、
   白点反白（仅 .is-spot —— 分类点不能跟着反白）。
   ⚠️ @use 必须位于其它规则之前（SCSS 硬规则，放后面编译直接失败）。 */
@use '@/styles/calendar';

/* ==================== 摘要条 ==================== */
.cal-summary {
  margin-bottom: var(--space-3);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-base);
  background: var(--color-bg-hover);
  font-size: var(--fs-caption-sm);
  color: var(--color-text-secondary);
  font-variant-numeric: tabular-nums;
}

/* ==================== 头部 ====================
   .cal-head / .cal-title / .cal-nav-group / .cal-nav（含 .is-text）→ 共享层 */

/* ==================== 周标题 ====================
   .cal-week / .cal-week-cell（含 .is-weekend）→ 共享层 */

/* ==================== 网格 ====================
   .cal-grid / .cal-cell（含 .is-out）/ .cal-day / .cal-sub（含 .is-state/
   .is-term/.is-lunar）→ 共享层 */

/* ==================== 状态 → 整格填色 ==================== */
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
.st-predicted {
  background: var(--color-period-soft);
  color: var(--color-period-dark);
  border: 1.5px dashed var(--color-period);
}
.st-fertile {
  background: var(--color-fertile-soft);
  color: var(--color-fertile-strong);
}
.st-peak {
  background: var(--color-fertile-soft);
  color: var(--color-fertile-strong);
  border: 1.5px solid var(--color-ovulation);
}
.st-ovulation {
  background: var(--color-ovulation-fill);
  color: #FFFFFF;
}

.cal-cell.is-today {
  border: 2px solid var(--color-primary);
}

/* ==================== 右下角圆点（经期点滴） ====================
   基础 .cal-dot 与 .is-spot 在共享层（与 Period 逐字相同）。 */

/* ==================== 分类点（日期下方一排，可重叠） ====================
 * 一格最多 CALENDAR_DOT_MAX 个，多出来的收成「+N」。
 * ⚠️ 点在日期数字**下方**居中排一排（不是右下角），因为要并排多个；
 *    经期点滴仍是右下角单排，两者不混在一个容器里。 */
.cal-dots {
  position: absolute;
  bottom: 3px;
  left: 0;
  right: 0;
  display: flex;
  justify-content: center;
  align-items: center;
  pointer-events: none;
}

.cal-dot.is-metric {
  position: static;
  width: 6px;
  height: 6px;
  box-sizing: border-box;
  flex-shrink: 0;
  /* 描边让相邻的同色点也能看出边界；卡片色描边在浅/深底上都成立 */
  border: 1px solid var(--color-bg-card);
  /* 重叠：后一个点向左压 2px，视觉上连成一串又不挤爆格子 */
  & + .cal-dot.is-metric { margin-left: -2px; }
}

.cal-dot-more {
  margin-left: 2px;
  font-size: var(--fs-micro);
  line-height: 1;
  color: var(--color-text-tertiary);
  font-variant-numeric: tabular-nums;
}

/* 经期/排卵整格填色时，右下角的点滴要反转成白色 ——
   ⚠️ 但**分类点不能跟着反白**（它们靠颜色区分指标，反白就全丢了）。 */
.cal-cell.st-medium .cal-dot.is-spot,
.cal-cell.st-heavy .cal-dot.is-spot,
.cal-cell.st-ovulation .cal-dot.is-spot {
  background: rgba(255, 255, 255, 0.92);
}

/* ==================== 图例 ====================
   排版（.cal-legend* / .legend-box 基础 / .legend-dot 基础与 .is-ovu /
   .cal-legend-note）→ 共享层。这里只留健康专属的图例色：
   分类点图例的颜色由 JS 的 CALENDAR_DOT_COLOR 内联给，这里只管形状（共享层基础已覆盖）。 */
</style>
