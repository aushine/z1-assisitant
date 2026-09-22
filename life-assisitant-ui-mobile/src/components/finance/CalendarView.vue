<script setup lang="ts">
/**
 * CalendarView —— 收支月历（移动端）
 *
 * SYNC-FROM-DESKTOP: life-assisitant-ui-desktop/src/components/finance/CalendarView.tsx
 * SYNC-FROM-BACKEND: life-assisitant-api/internal/service/impl/finance.go（GetCalendar）
 * 规范：md/spec-20260921-v2/03-流水与日历.md §B
 *
 * 结构（移动端上下堆叠；桌面端是左右两栏）：
 *   月份摘要（该月收入/支出/结余）→ 月历 → 当日明细卡（DailyDetailCard）
 *
 * 格子（D33）：净额**一个数字** —— >0 绿 + / <0 红 −(U+2212) / =0 中性 0
 *   / 无记录空白 / 未来日期空白但**长按仍可补录**（Q8）。
 *   缩写（Q9）：|净额| ≥ 10000 → `1.2万`；< 10000 → 整数无小数。
 *   ⚠️ 单日净额前端 `income − expense` 算（后端 CalendarDay 不下发 net，
 *      只有 summary.net 是后端算好的 —— 09-schedule §B15）。
 *
 * 手势（与经期/健康月历同款）：
 *   - 横滑切月：|dx| > 48 且 |dx| > |dy| × 1.5（PeriodCalendar 同阈值）
 *   - 长按 600ms 补录：长按后**吞掉本次抬手的 click**（PeriodCalendar:310-318 同做法），
 *     否则长按完又把该天选中，两个意图打架。
 *
 * 样式：布局与排版走共享层 `styles/_calendar.scss`（03 §C 第一批）；
 *   语义色（成功/危险/中性）用全局令牌，本组件不定义 st-*。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { financeApi } from '@/api/finance'
import { todayDate } from '@/utils/date'
import { formatCalendarNet, formatSignedAmount } from '@/utils/money'
import type { CalendarResp, Transaction } from '@/api/types'

const emit = defineEmits<{
  /** 长按某天 → 记一笔（父级打开记一笔浮层并预填该日期） */
  (e: 'create-at', date: string): void
  /** 「查看全部」→ 切到流水视图并带上该日筛选 */
  (e: 'view-all', date: string): void
  /** 点明细行 → 账目详情页（整笔透传，父级按 id 跳路由） */
  (e: 'view', tx: Transaction): void
}>()

/** 可切换范围：与后端 GetCalendar 的校验对齐（今年 −5 ~ 今年 +1） */
const NOW = new Date()
const MIN_MONTH = `${NOW.getFullYear() - 5}-01`
const MAX_MONTH = `${NOW.getFullYear() + 1}-12`

const WEEK_HEADERS = ['一', '二', '三', '四', '五', '六', '日'] as const

function pad(n: number): string {
  return String(n).padStart(2, '0')
}
function monthOf(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
}
function dateStr(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// ==================== 状态 ====================
const viewMonth = ref(monthOf(NOW))
const selectedDate = ref(todayDate())

const data = ref<CalendarResp | null>(null)
const loading = ref(false)
const error = ref(false)

const summary = computed(() => data.value?.summary ?? { income: 0, expense: 0, net: 0 })

async function load(): Promise<void> {
  loading.value = true
  error.value = false
  try {
    data.value = await financeApi.getCalendar(viewMonth.value)
  } catch (e) {
    data.value = null
    error.value = true
    // eslint-disable-next-line no-console
    console.error('[FinanceCalendar] load failed', e)
  } finally {
    loading.value = false
  }
}

watch(viewMonth, load, { immediate: true })

// ==================== 网格 ====================
interface Cell {
  date: string
  day: number
  inMonth: boolean
  isWeekend: boolean
}

const cells = computed<Cell[]>(() => {
  const [y, m] = viewMonth.value.split('-').map(Number)
  if (!y || !m) return []
  const daysInMonth = new Date(y, m, 0).getDate()
  // 周一=0 … 周日=6（与经期/习惯日历同式）
  const firstCol = (new Date(y, m - 1, 1).getDay() + 6) % 7
  const rows = Math.min(6, Math.max(4, Math.ceil((firstCol + daysInMonth) / 7)))

  const out: Cell[] = []
  for (let i = 0; i < rows * 7; i++) {
    const offset = i - firstCol
    const d = new Date(y, m - 1, 1 + offset)
    const wd = d.getDay()
    out.push({
      date: dateStr(d),
      day: d.getDate(),
      inMonth: offset >= 0 && offset < daysInMonth,
      isWeekend: wd === 0 || wd === 6,
    })
  }
  return out
})

/** 有记录的日期 → { income, expense }（后端只返回有记录的日子） */
const dayMap = computed(() => {
  const map = new Map<string, { income: number; expense: number }>()
  for (const d of data.value?.days ?? []) map.set(d.date, { income: d.income, expense: d.expense })
  return map
})

/** 单日净额：>0 绿 / <0 红 / =0 中性（颜色走全局语义令牌） */
function netColor(net: number): string {
  if (net > 0) return 'var(--color-success)'
  if (net < 0) return 'var(--color-danger)'
  return 'var(--color-text-tertiary)'
}

function cellClass(c: Cell): Record<string, boolean> {
  if (!c.inMonth) return { 'is-out': true }
  return {
    'is-today': c.date === todayDate(),
    'is-selected': c.date === selectedDate.value,
  }
}

/** 选中日的合计（传给当日明细卡；无记录 = 0/0） */
const selectedDay = computed(() => dayMap.value.get(selectedDate.value) ?? { income: 0, expense: 0 })

// ==================== 月份切换 ====================
const isCurrentMonth = computed(() => viewMonth.value === monthOf(NOW))

function shiftMonth(delta: number): void {
  const [y, m] = viewMonth.value.split('-').map(Number)
  if (!y || !m) return
  const next = monthOf(new Date(y, m - 1 + delta, 1))
  if (next < MIN_MONTH || next > MAX_MONTH) return
  viewMonth.value = next
  // 切月后右下明细跟随：原选中日不在新月份 → 落到当月 1 号（本月则回今天）
  if (!selectedDate.value.startsWith(next)) {
    selectedDate.value = next === monthOf(NOW) ? todayDate() : `${next}-01`
  }
}

function backToCurrent(): void {
  viewMonth.value = monthOf(NOW)
  selectedDate.value = todayDate()
}

// ==================== 手势：横滑切月 + 长按补录 ====================
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

/** 长按 600ms → 补录该天 */
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
    emit('create-at', date)
  }, 600)
}

function onCellClick(date: string): void {
  clearPress()
  if (longPressed) {
    // 长按已触发（补录），本次抬手不再当「选中该天」处理
    longPressed = false
    return
  }
  selectedDate.value = date
}

onBeforeUnmount(clearPress)
</script>

<template>
  <div class="fin-cal">
    <!-- ==================== 月历卡 ==================== -->
    <section class="cal-card">
      <!-- 月份摘要（该月，标题跟着切月走，不是固定「本月」） -->
      <div class="fin-cal-summary">
        <span class="fin-cal-summary-title">{{ viewMonth.split('-')[0] }} 年 {{ Number(viewMonth.split('-')[1]) }} 月</span>
        <span class="fin-cal-sum is-income">收入 {{ formatSignedAmount(summary.income, 'income') }}</span>
        <span class="fin-cal-sum is-expense">支出 {{ formatSignedAmount(summary.expense, 'expense') }}</span>
        <span class="fin-cal-sum" :style="{ color: netColor(summary.net) }">
          结余 {{ formatSignedAmount(Math.abs(summary.net), summary.net > 0 ? 'income' : summary.net < 0 ? 'expense' : 'transfer') }}
        </span>
      </div>

      <!-- 头部导航 -->
      <div class="cal-head">
        <span class="cal-title">{{ viewMonth.split('-')[0] }} 年 {{ Number(viewMonth.split('-')[1]) }} 月</span>
        <div class="cal-nav-group">
          <button class="cal-nav" type="button" aria-label="上个月" @click="shiftMonth(-1)">‹</button>
          <button class="cal-nav" type="button" aria-label="下个月" @click="shiftMonth(1)">›</button>
          <button v-if="!isCurrentMonth" class="cal-nav is-text" type="button" @click="backToCurrent">
            回到本月
          </button>
        </div>
      </div>

      <!-- 周标题（周一开头，与经期/健康日历一致） -->
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

      <!-- 日期网格（横滑切月挂在网格上） -->
      <div class="cal-grid" @touchstart.passive="onTouchStart" @touchend.passive="onTouchEnd">
        <button
          v-for="c in cells"
          :key="c.date"
          type="button"
          class="cal-cell fin-cal-cell"
          :class="cellClass(c)"
          :disabled="!c.inMonth"
          :aria-label="`${c.date}${dayMap.has(c.date) ? ' 有记录' : ''}`"
          @pointerdown="onCellPointerDown(c.date)"
          @pointerup="onCellClick(c.date)"
          @pointerleave="clearPress"
          @contextmenu.prevent
        >
          <span class="cal-day">{{ c.inMonth ? c.day : '' }}</span>
          <!-- 净额：有记录才显示（无记录/未来日期留白，长按仍可补录） -->
          <span
            v-if="c.inMonth && dayMap.has(c.date)"
            class="cal-net"
            :style="{ color: netColor((dayMap.get(c.date)?.income ?? 0) - (dayMap.get(c.date)?.expense ?? 0)) }"
          >
            {{ formatCalendarNet((dayMap.get(c.date)?.income ?? 0) - (dayMap.get(c.date)?.expense ?? 0)) }}
          </span>
        </button>
      </div>

      <div class="fin-cal-hint">长按任意日期可补录当天账目 · 左右滑动切换月份</div>
    </section>

    <!-- ==================== 当日明细（内联，不做弹层） ==================== -->
    <DailyDetailCard
      :date="selectedDate"
      :income="selectedDay.income"
      :expense="selectedDay.expense"
      @view="emit('view', $event)"
      @view-all="emit('view-all', $event)"
      @create-at="emit('create-at', $event)"
    />
  </div>
</template>

<style lang="scss" scoped>
/* 布局与排版来自共享层（03 §C 第一批）；⚠️ @use 必须位于其它规则之前 */
@use '@/styles/calendar';

.fin-cal {
  display: flex;
  flex-direction: column;
}

/* ==================== 月份摘要 ==================== */
.fin-cal-summary {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: var(--space-3);
  padding: 0 var(--space-2) var(--space-2);
}
.fin-cal-summary-title {
  font-size: var(--fs-body-sm);
  font-weight: 600;
  color: var(--color-text-primary);
}
.fin-cal-sum {
  font-size: var(--fs-caption-sm);
  font-family: var(--font-num);
  font-variant-numeric: tabular-nums;
  color: var(--color-text-secondary);
  &.is-income { color: var(--color-success); }
  &.is-expense { color: var(--color-danger); }
}

/* ==================== 格子：净额数字 ====================
   盒子沿用共享层 .cal-cell；这里只补「日期上、净额下」的收支专属排版 */
.fin-cal-cell {
  align-items: center;
  justify-content: center;
}
.cal-net {
  margin-top: 3px;
  max-width: 100%;
  font-size: var(--fs-micro);
  font-weight: 600;
  line-height: 1.2;
  font-family: var(--font-num);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ==================== 提示行 ==================== */
.fin-cal-hint {
  margin-top: var(--space-2);
  padding: 0 var(--space-2);
  font-size: var(--fs-micro);
  color: var(--color-text-disabled);
  text-align: center;
}
</style>
