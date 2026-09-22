<script setup lang="ts">
/**
 * HabitHeatmap —— 当月习惯打卡日历热力图（移动端）
 *
 * SYNC-FROM-DESKTOP: life-assisitant-ui-desktop/src/pages/record/components/HabitHeatmap.tsx
 * SYNC-FROM-BACKEND: life-assisitant-api/internal/model/dto/stats.go（HabitHeatmapItem）
 * 依赖：chinese-days@^1.5.9（农历 / 节气 / 法定节假日 / 调休，与桌面端同版本）
 * 最后同步：2026-09-18（Phase 3.3）
 *
 * 7 列（周一~周日）× 最多 6 行，连续格子，热度沿用 `utils/heatmap` 的绿色阶。
 * 每格显示：公历日、农历日或节气、节假日名、调休「班」标、周末休息「休」标。
 *
 * ⚠️ 260921 修订（老大看图报的 bug）：
 *   ① 周末灰底曾**无条件**覆盖打卡热度色 ⇒ 周末打了卡的格子也变灰。
 *      现在灰底只在 `total === 0`（该格没有打卡数据）时兜底。
 *   ② 周末（非调休补班）在文字行最左侧加「休」字，**不动**节日名与「班」字。
 *   桌面端 `pages/record/components/HabitHeatmap.tsx` 同步同改（双端契约）。
 *
 * ⚠️ 与桌面端的差异（交互层，不是视觉）：
 *   桌面端用 Semi Tooltip 悬浮展示某日详情；移动端没有 hover，
 *   改为**点击格子**后在日历下方固定展示该日详情行。
 *
 * ⚠️ hex 字面量刻意保留（与桌面端同因）：格子底色来自固定绿色阶
 *   （顺序色阶不随主题翻转），格内文字/边框必须与「浅底」保持对比，
 *   不能跟页面主题联动 —— 详见桌面端同文件头部注释。
 */
import { computed, ref } from 'vue'
import {
  getLunarDatesInRange,
  getSolarTerms,
  getDayDetail,
  isWorkday,
} from 'chinese-days'
import type { HabitHeatmapItem } from '@/api/types'
import { heatColor } from '@/utils/heatmap'
import { todayDate } from '@/utils/date'

const props = defineProps<{
  data: HabitHeatmapItem[]
  year: number
  /** 1-12 */
  month: number
}>()

const WEEK_HEADERS = ['一', '二', '三', '四', '五', '六', '日']

interface DayCell {
  date: string
  day: number
  inMonth: boolean
  isWeekend: boolean
  lunarDay: string
  solarTerm: string
  holidayName: string
  isHoliday: boolean
  isWorkdayInLieu: boolean
  ratio: number
  completed: number
  total: number
}

/** 点击选中的日期（移动端替代 Tooltip） */
const selectedDate = ref('')

const cells = computed<DayCell[]>(() => {
  const year = props.year
  const month = props.month
  const daysInMonth = new Date(year, month, 0).getDate()
  const firstWeekDay = new Date(year, month - 1, 1).getDay()
  const firstCol = (firstWeekDay + 6) % 7 // 周一=0 … 周日=6

  const lastOffset = firstCol + daysInMonth - 1
  const rows = Math.min(6, Math.max(4, Math.ceil((lastOffset + 1) / 7)))
  const totalCells = rows * 7
  const result: DayCell[] = []

  const dataMap = new Map<string, HabitHeatmapItem>()
  for (const d of props.data) dataMap.set(d.date, d)

  // 农历 / 节气范围：网格首日 → 网格末日
  const gridStart = new Date(year, month - 1, 1 - firstCol)
  const gridEnd = new Date(year, month - 1, 1 - firstCol + totalCells)

  const lunarMap = new Map<string, string>()
  for (const l of getLunarDatesInRange(gridStart, gridEnd)) {
    lunarMap.set(l.date, l.lunarDayCN)
  }
  const termMap = new Map<string, string>()
  for (const t of getSolarTerms(gridStart, gridEnd)) {
    termMap.set(t.date, t.name)
  }

  for (let i = 0; i < totalCells; i++) {
    const col = i % 7
    const row = Math.floor(i / 7)
    const dayOffset = row * 7 + col - firstCol
    const dateObj = new Date(year, month - 1, 1 + dayOffset)
    const y = dateObj.getFullYear()
    const m = dateObj.getMonth() + 1
    const d = dateObj.getDate()
    const dateStr = `${y}-${pad(m)}-${pad(d)}`

    const inMonth = 1 + dayOffset >= 1 && 1 + dayOffset <= daysInMonth
    const weekDayIdx = dateObj.getDay()
    const isWeekend = weekDayIdx === 0 || weekDayIdx === 6

    let holidayName = ''
    let isHoliday = false
    let isWorkdayInLieu = false
    if (inMonth) {
      const detail = getDayDetail(dateStr)
      if (detail.work === false) {
        // 法定节假日（含假期中的周末）；name 形如 "英文名,中文名,天数" → 取倒数第二段
        const parts = (detail.name || '').split(',')
        holidayName = parts.length >= 2 ? parts[parts.length - 2] : ''
        if (holidayName) isHoliday = true
      } else if (isWeekend && isWorkday(dateStr)) {
        // 周末但被调休补班
        isWorkdayInLieu = true
      }
    }

    const item = dataMap.get(dateStr)
    const completed = item?.completed ?? 0
    const total = item?.total ?? 0

    result.push({
      date: dateStr,
      day: d,
      inMonth,
      isWeekend,
      lunarDay: lunarMap.get(dateStr) ?? '',
      solarTerm: termMap.get(dateStr) ?? '',
      holidayName,
      isHoliday,
      isWorkdayInLieu,
      ratio: total > 0 ? completed / total : 0,
      completed,
      total,
    })
  }

  return result
})

const today = computed(() => todayDate())

/** 选中日的详情（点击格子后展示在日历下方） */
const selectedCell = computed(() => cells.value.find((c) => c.date === selectedDate.value) ?? null)

function onCellClick(c: DayCell): void {
  if (!c.inMonth) return
  selectedDate.value = selectedDate.value === c.date ? '' : c.date
}

/**
 * ⚠️「周末」只是**底噪**，不能盖掉打卡热度色（260921 修）。
 *
 * 原来这里是 `if (c.isWeekend && !c.isHoliday) return '#F9FAFB'` —— 无条件返灰，
 * 于是周末只要打了卡，整格就从热力绿变成灰，看起来像"没打卡"。
 * 现在灰底只在**这一格完全没有打卡数据**（total === 0）时兜底。
 */
function cellBg(c: DayCell): string {
  if (!c.inMonth) return 'transparent'
  if (c.isWeekend && !c.isHoliday && c.total === 0) return '#F9FAFB'
  return heatColor(c.ratio)
}

/** 该格是否为「休息日」（周末、且不是调休补班）→ 文字行左侧标「休」 */
function isRestDay(c: DayCell): boolean {
  return c.inMonth && c.isWeekend && !c.isWorkdayInLieu
}

/** 格内数字颜色：热力深绿底用白色，浅底用灰/主文本色 */
function dayNumColor(c: DayCell): string {
  if (c.ratio >= 0.5 && c.inMonth) return '#FFFFFF'
  // 灰字同样只属于「周末且无数据」，有数据的周末走主文本色（浅绿底上可读）
  if (c.isWeekend && c.inMonth && !c.isHoliday && c.total === 0) return '#9CA3AF'
  return 'var(--color-text-primary)'
}

function lunarColor(c: DayCell): string {
  return c.ratio >= 0.5 ? '#FFFFFF' : '#9CA3AF'
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}
</script>

<template>
  <div class="habit-calendar">
    <!-- 星期表头 -->
    <div class="cal-week">
      <div
        v-for="(w, i) in WEEK_HEADERS"
        :key="w"
        class="cal-week-cell"
        :class="{ 'is-weekend': i >= 5 }"
      >{{ w }}</div>
    </div>

    <!-- 日期网格 -->
    <div class="cal-grid">
      <button
        v-for="c in cells"
        :key="c.date"
        type="button"
        class="cal-cell"
        :class="{
          'is-out': !c.inMonth,
          'is-today': c.date === today,
          'is-selected': c.date === selectedDate,
        }"
        :style="{
          background: cellBg(c),
          borderColor: c.date === today ? '#3B82F6' : 'transparent',
        }"
        @click="onCellClick(c)"
      >
        <span class="cell-day" :style="{ color: dayNumColor(c) }">{{ c.inMonth ? c.day : '' }}</span>

        <span class="cell-sub">
          <!--
            首行：休息日「休」标 + 节气 / 农历。
            ⚠️「休」只能加在**这一行的最左边**，节日名（.sub-holiday）与调休「班」
            各自成行、原样保留 —— 260921 老大明确要求「不要覆盖当前的调休和节日字样」。
          -->
          <span class="cell-sub-line">
            <span v-if="isRestDay(c)" class="sub-rest">休</span>
            <span v-if="c.solarTerm" class="sub-term">{{ c.solarTerm }}</span>
            <span v-else-if="c.lunarDay && c.inMonth" class="sub-lunar" :style="{ color: lunarColor(c) }">
              {{ c.lunarDay }}
            </span>
          </span>
          <span v-if="c.isHoliday && c.holidayName" class="sub-holiday">{{ c.holidayName }}</span>
          <span v-if="c.isWorkdayInLieu" class="sub-holiday">班</span>
        </span>

        <!-- 完成度小点（有数据时才显示） -->
        <span
          v-if="c.inMonth && c.total > 0"
          class="cell-dot"
          :style="{ background: c.ratio >= 0.5 ? 'rgba(255,255,255,0.9)' : '#10B981' }"
        />
      </button>
    </div>

    <!-- 图例 -->
    <div class="cal-legend">
      <span class="legend-text">少</span>
      <span
        v-for="r in [0, 0.25, 0.5, 0.75, 1]"
        :key="r"
        class="legend-box"
        :style="{ background: heatColor(r) }"
      />
      <span class="legend-text">多</span>
      <span class="legend-hint">周末「休」· 调休「班」· 节气绿 · 节日红</span>
    </div>

    <!-- 选中日详情（移动端替代桌面端 Tooltip） -->
    <div v-if="selectedCell" class="cal-detail">
      <span class="detail-date">{{ selectedCell.date }}</span>
      <span class="detail-main">
        完成 <b>{{ selectedCell.completed }}</b> / {{ selectedCell.total }}
      </span>
      <span v-if="selectedCell.solarTerm" class="detail-tag">{{ selectedCell.solarTerm }}</span>
      <span v-if="selectedCell.holidayName" class="detail-tag is-holiday">{{ selectedCell.holidayName }}</span>
      <span v-if="selectedCell.isWorkdayInLieu" class="detail-tag is-holiday">调休上班</span>
      <span v-if="selectedCell.lunarDay" class="detail-lunar">农历 {{ selectedCell.lunarDay }}</span>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.habit-calendar {
  width: 100%;
}

/* 星期表头 */
.cal-week {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  margin-bottom: 6px;
}
.cal-week-cell {
  text-align: center;
  padding: 4px 0;
  font-size: var(--fs-micro);
  font-weight: 600;
  color: var(--color-text-secondary);
  &.is-weekend { color: #9CA3AF; }
}

/* 网格 */
.cal-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 4px;
}
.cal-cell {
  position: relative;
  min-height: 52px;
  padding: 4px;
  display: flex;
  flex-direction: column;
  border: 1.5px solid transparent;
  border-radius: 8px;
  background: transparent;
  text-align: left;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: transform var(--duration-fast) var(--ease-default);
  &:active { transform: scale(0.96); }
  &.is-out { opacity: 0.35; cursor: default; }
  &.is-today { border-width: 2px; }
  &.is-selected { box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.35); }
}
.cell-day {
  font-size: var(--fs-caption-sm);
  font-weight: 600;
  line-height: 1.1;
}
.cell-sub {
  display: flex;
  flex-direction: column;
  gap: 1px;
  margin-top: 2px;
  font-size: var(--fs-nano);
  line-height: 1.25;
}
/* 首行：「休」+ 节气/农历 横向排（休字在最左） */
.cell-sub-line {
  display: flex;
  align-items: center;
  gap: 1px;
  min-width: 0;
}
.sub-rest {
  color: #DC2626;
  font-weight: 600;
}
.sub-term {
  color: #059669;
  font-weight: 600;
}
.sub-lunar { color: #9CA3AF; }
.sub-holiday {
  color: #DC2626;
  font-weight: 600;
}
.cell-dot {
  position: absolute;
  right: 4px;
  bottom: 4px;
  width: 4px;
  height: 4px;
  border-radius: 50%;
}

/* 图例 */
.cal-legend {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 10px;
}
.legend-text {
  font-size: var(--fs-tab);
  color: #9CA3AF;
}
.legend-box {
  width: 12px;
  height: 12px;
  border-radius: 3px;
}
.legend-hint {
  margin-left: 8px;
  font-size: var(--fs-tab);
  color: #9CA3AF;
}

/* 选中日详情 */
.cal-detail {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 10px;
  padding: 8px 10px;
  background: var(--color-bg-hover);
  border-radius: 8px;
  font-size: var(--fs-caption-sm);
  color: var(--color-text-secondary);
}
.detail-date {
  font-family: var(--font-num);
  font-weight: 600;
  color: var(--color-text-primary);
}
.detail-main b {
  color: var(--color-success-dark);
  font-family: var(--font-num);
}
.detail-tag {
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--color-success-light);
  color: var(--color-success-dark);
  font-size: var(--fs-tab);
  font-weight: 600;
  &.is-holiday {
    background: var(--color-danger-light);
    color: var(--color-danger-dark);
  }
}
.detail-lunar {
  font-size: var(--fs-tab);
  color: var(--color-text-tertiary);
}
</style>
