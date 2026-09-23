<script setup lang="ts">
/**
 * HabitSection —— 记录页「习惯追踪」区块（移动端）
 *
 * SYNC-FROM-DESKTOP: life-assisitant-ui-desktop/src/pages/record/HabitSection.tsx
 * SYNC-FROM-BACKEND: life-assisitant-api/internal/model/dto/habit.go
 *                    life-assisitant-api/internal/controller/stats.go（热力图数据源）
 * 最后同步：2026-09-18（Phase 3.2 / 3.3）
 *
 * 与桌面端逐项对应：
 *   4 KPI（今日完成 / 最长连续 / 今日打卡 / 总习惯数）
 *   里程碑 7/21/66/100/365  → <MilestoneRow>
 *   月历热力图（chinese-days 农历/节气/节假日/调休）→ <HabitHeatmap>
 *   状态 + 分类筛选（分类为客户端过滤）
 *   逐行连续徽章 → <StreakBadge>
 *   打卡弹窗（可选时长，与桌面端同款交互）
 *
 * 移动端差异（交互层，业务语义不变）：
 *   - 表格 → 卡片列表（左滑编辑/删除，点击卡片编辑）
 *   - 筛选下拉 → van-dropdown-menu
 *   - 新建/编辑弹层由父级（记录页）持有，本组件只 emit 意图
 *
 * 热力图数据源：`GET /stats/habits?start_date&end_date`
 *   后端 service 中 start_date+end_date 同时存在时**优先于** range，
 *   故按月取数不需要传 range（与桌面端一致）。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { statsApi } from '@/api/stats'
import { useHabitStore } from '@/stores/habit'
import { HABIT_CATEGORIES, getHabitCategory, resolveHabitIconView } from '@/utils/category-dict'
import { useUserCategoryStore } from '@/stores/user-category'
import Icon from '@/components/icon/Icon.vue'
import { todayDate } from '@/utils/date'
import HabitHeatmap from '@/components/HabitHeatmap.vue'
import MilestoneRow from '@/components/MilestoneRow.vue'
import StreakBadge from '@/components/StreakBadge.vue'
import type { Habit, HabitHeatmapItem, HabitStatus } from '@/api/types'

const emit = defineEmits<{
  (e: 'create'): void
  (e: 'edit', habit: Habit): void
  (e: 'delete', habit: Habit): void
}>()

const habitStore = useHabitStore()
// 习惯/待办分类（spec-20260922-v2/04）：分类筛选与图标都改为 store 优先
const catStore = useUserCategoryStore()

// ==================== 日期 / 日历 ====================
const now = new Date()
const calYear = ref(now.getFullYear())
const calMonth = ref(now.getMonth() + 1) // 1-12
const isCurrentMonth = computed(
  () => calYear.value === now.getFullYear() && calMonth.value === now.getMonth() + 1
)

/** 频率 → streak 单位（04 §2.2，与桌面端 streakUnit 一致） */
function streakUnit(frequency: string | undefined): string {
  if (frequency === 'weekly') return '周'
  if (frequency === 'monthly') return '月'
  return '天'
}

/** 频率中文 */
function frequencyLabel(f: string | undefined): string {
  const map: Record<string, string> = { daily: '每日', weekly: '每周', monthly: '每月' }
  return f ? (map[f] ?? f) : '—'
}

// ==================== 热力图 ====================
const heatmapData = ref<HabitHeatmapItem[]>([])
const heatmapLoading = ref(false)
const heatmapFailed = ref(false)

async function fetchHeatmap(): Promise<void> {
  const mm = String(calMonth.value).padStart(2, '0')
  const daysInMonth = new Date(calYear.value, calMonth.value, 0).getDate()
  const startDate = `${calYear.value}-${mm}-01`
  const endDate = `${calYear.value}-${mm}-${String(daysInMonth).padStart(2, '0')}`
  heatmapLoading.value = true
  heatmapFailed.value = false
  try {
    const res = await statsApi.habitStats({ start_date: startDate, end_date: endDate })
    heatmapData.value = res.heatmap ?? []
  } catch (e) {
    heatmapData.value = []
    heatmapFailed.value = true
    // eslint-disable-next-line no-console
    console.error('[HabitSection] fetchHeatmap failed', e)
  } finally {
    heatmapLoading.value = false
  }
}

function shiftMonth(delta: number): void {
  let y = calYear.value
  let m = calMonth.value + delta
  if (m < 1) {
    m = 12
    y -= 1
  }
  if (m > 12) {
    m = 1
    y += 1
  }
  calYear.value = y
  calMonth.value = m
}

function backToCurrentMonth(): void {
  calYear.value = now.getFullYear()
  calMonth.value = now.getMonth() + 1
}

// ==================== 筛选 ====================
const STATUS_FILTERS: Array<{ text: string; value: HabitStatus | '' }> = [
  { text: '全部', value: '' },
  { text: '活跃', value: 'active' },
  { text: '已归档', value: 'archived' },
]
/**
 * 分类筛选选项 —— store 优先（用户可自由增删分类，04 §4.4），
 * 分类未拉回来时先用常量兜底表（数据到达后 Pinia 响应式替换）。
 */
const CATEGORY_FILTERS = computed<Array<{ text: string; value: string }>>(() => {
  const list = catStore.loadedOnce.habit
    ? catStore
        .listByDomain('habit')
        .map((c) => ({ text: catStore.resolveCategory('habit', c.id)?.name ?? c.name, value: c.id }))
    : HABIT_CATEGORIES.map((c) => ({ text: c.label, value: c.id }))
  return [{ text: '全部分类', value: '' }, ...list]
})

const statusIndex = ref(0)
const categoryIndex = ref(0)

async function onStatusChange(index: number | string): Promise<void> {
  const i = Number(index)
  habitStore.setStatusFilter(STATUS_FILTERS[i]?.value ?? '')
  await habitStore.fetchHabits()
}

function onCategoryChange(index: number | string): void {
  const i = Number(index)
  habitStore.setCategoryFilter(CATEGORY_FILTERS.value[i]?.value ?? '')
}

// ==================== 打卡 ====================
const checkInShow = ref(false)
const checkInTarget = ref<Habit | null>(null)
const checkInDuration = ref<number>(0)

function openCheckIn(h: Habit): void {
  if (h.status !== 'active') return
  if (h.today_done ?? h.today_completed) return
  checkInTarget.value = h
  checkInDuration.value = 0
  checkInShow.value = true
}

async function confirmCheckIn(): Promise<void> {
  const h = checkInTarget.value
  if (!h) return
  const minutes = Number(checkInDuration.value) || 0
  checkInShow.value = false
  await habitStore.logHabit(h.id, {
    date: todayDate(),
    count: 1,
    ...(minutes > 0 ? { duration_minutes: minutes } : {}),
  })
  // 打卡会改变 streak，热力图随之刷新
  await fetchHeatmap()
}

// ==================== 列表渲染辅助 ====================
const filteredItems = computed(() => habitStore.filteredHabits)

/** 既无列表又加载失败 → 错误态；store 静默吞错，这里用「空 + 非加载」判定 */
const showEmpty = computed(() => !habitStore.loading && filteredItems.value.length === 0)

function habitProgressPct(h: Habit): number {
  if (!h.target_count) return 0
  return Math.min(100, Math.round(((h.today_count ?? 0) / h.target_count) * 100))
}

function isDone(h: Habit): boolean {
  return !!(h.today_done ?? h.today_completed)
}

/**
 * 习惯图标 —— 04 §4.2 优先级链：`habits.icon`（存量可为 emoji，自动换算）
 * > 分类.icon > 分类.emoji > lucide:Pin。store 未加载时走常量兜底，不闪空。
 */
function habitIcon(h: Habit) {
  return resolveHabitIconView({ icon: h.icon, category: h.category })
}

// ==================== 生命周期 ====================
onMounted(async () => {
  // 分类 store 静默预热（SWR：缓存先渲染，后台对服务端，04 §4.2）
  void catStore.ensureFresh('habit')
  await Promise.all([habitStore.fetchHabits(), fetchHeatmap()])
})

// 日历月份变化 → 重新取热力图
watch([calYear, calMonth], () => {
  void fetchHeatmap()
})

// 习惯增删改后（列表长度变化）热力图可能变化，与桌面端依赖项保持一致
watch(
  () => habitStore.habits.length,
  () => {
    void fetchHeatmap()
  }
)

defineExpose({
  refresh: async () => {
    await Promise.all([habitStore.fetchHabits(), fetchHeatmap()])
  },
  openCheckIn,
})
</script>

<template>
  <section class="card habit-section">
    <div class="card-head">
      <h3 class="card-title">习惯追踪</h3>
      <span class="card-sub">坚持就是力量</span>
    </div>

    <!-- ============ 4 KPI ============ -->
    <div class="kpi-grid">
      <!-- KPI1 今日完成 -->
      <div class="kpi-card">
        <div class="kpi-label">今日完成</div>
        <div class="kpi-value">
          <span class="kv-strong">{{ habitStore.todayDone }}</span>
          <span class="kv-thin">/{{ habitStore.todayTotal }}</span>
        </div>
        <div class="kpi-bar">
          <div
            class="kpi-bar-fill"
            :style="{
              width: habitStore.todayTotal > 0
                ? Math.round((habitStore.todayDone / habitStore.todayTotal) * 100) + '%'
                : '0%',
            }"
          />
        </div>
        <div class="kpi-foot">
          {{ habitStore.todayTotal > 0
            ? Math.round((habitStore.todayDone / habitStore.todayTotal) * 100) + '%'
            : '—' }}
        </div>
      </div>

      <!-- KPI2 最长连续 -->
      <div class="kpi-card">
        <div class="kpi-label">最长连续</div>
        <div class="kpi-value">
          <Icon class="kv-flame" name="Flame" :size="16" :style="{ color: 'var(--tint-warning-fg)' }" aria-hidden="true" />
          <span class="kv-strong">{{ habitStore.bestStreak }}</span>
        </div>
        <div class="kpi-foot">天 · 历史最佳</div>
      </div>

      <!-- KPI3 今日打卡 -->
      <div class="kpi-card">
        <div class="kpi-label">今日打卡</div>
        <div class="kpi-value">
          <span class="kv-strong">{{ habitStore.todayCheckIns }}</span>
        </div>
        <div class="kpi-foot">次</div>
      </div>

      <!-- KPI4 总习惯数 -->
      <div class="kpi-card">
        <div class="kpi-label">总习惯数</div>
        <div class="kpi-value">
          <span class="kv-strong">{{ habitStore.total }}</span>
        </div>
        <div class="kpi-foot">含已归档</div>
      </div>
    </div>

    <!-- ============ 里程碑（7/21/66/100/365）============ -->
    <div class="milestone-section">
      <span class="section-label">里程碑</span>
      <MilestoneRow :longest-streak="habitStore.bestStreak" />
    </div>

    <!-- ============ 月历热力图 ============ -->
    <div class="heatmap-section">
      <div class="heatmap-head">
        <span class="heatmap-title">{{ calYear }}年{{ calMonth }}月打卡日历</span>
        <div class="heatmap-nav">
          <button type="button" class="nav-btn" aria-label="上个月" @click="shiftMonth(-1)">‹</button>
          <button type="button" class="nav-btn" aria-label="下个月" @click="shiftMonth(1)">›</button>
          <button
            v-if="!isCurrentMonth"
            type="button"
            class="nav-btn is-text"
            @click="backToCurrentMonth"
          >
            回到本月
          </button>
        </div>
      </div>

      <div v-if="heatmapLoading && heatmapData.length === 0" class="heatmap-skeleton">
        <div v-for="i in 5" :key="i" class="skel-bar" />
      </div>
      <div v-else-if="heatmapFailed && heatmapData.length === 0" class="heatmap-error">
        <span>打卡日历加载失败</span>
        <button type="button" class="heatmap-retry" @click="fetchHeatmap">重试</button>
      </div>
      <HabitHeatmap v-else-if="heatmapData.length > 0" :data="heatmapData" :year="calYear" :month="calMonth" />
      <div v-else class="heatmap-empty">本月还没有打卡记录</div>
    </div>

    <!-- ============ 筛选 ============ -->
    <van-dropdown-menu class="habit-filter" :overlay="false">
      <van-dropdown-item
        v-model="statusIndex"
        :options="STATUS_FILTERS"
        @change="onStatusChange"
      />
      <van-dropdown-item
        v-model="categoryIndex"
        :options="CATEGORY_FILTERS"
        @change="onCategoryChange"
      />
    </van-dropdown-menu>

    <div class="toolbar-right">
      <button type="button" class="btn-ghost" :disabled="habitStore.loading" @click="habitStore.fetchHabits()">
        <span aria-hidden="true">⟳</span> 刷新
      </button>
      <button type="button" class="btn-solid" @click="emit('create')">
        <span aria-hidden="true">＋</span> 新建习惯
      </button>
    </div>

    <!-- ============ 列表 ============ -->
    <div v-if="habitStore.loading && filteredItems.length === 0" class="loading-skeleton">
      <div v-for="i in 3" :key="i" class="skel-row" />
    </div>

    <div v-else-if="showEmpty" class="empty-state sm">
      <Icon class="empty-emoji" name="Sprout" :size="32" aria-hidden="true" />
      <h4 class="empty-title">还没有习惯</h4>
      <p class="empty-desc">点击「新建习惯」开始</p>
    </div>

    <ul v-else class="habit-list">
      <li v-for="h in filteredItems" :key="h.id" class="habit-swipe">
        <van-swipe-cell>
          <div class="habit-row" @click="emit('edit', h)">
            <Icon
              class="habit-emoji"
              :name="habitIcon(h).icon"
              :size="16"
              :style="{ background: (h.color || '#014DB2') + '22', color: habitIcon(h).vars.fg }"
            />

            <div class="habit-body">
              <div class="habit-title">{{ h.title }}</div>
              <div class="habit-sub">
                <span>{{ frequencyLabel(h.frequency) }}</span>
                <span class="dot">·</span>
                <span>目标 {{ h.target_count }} {{ h.unit || '次' }}</span>
                <template v-if="h.category">
                  <span class="dot">·</span>
                  <span
                    class="cat-tag"
                    :style="{
                      background: getHabitCategory(h.category)?.vars.bg,
                      color: getHabitCategory(h.category)?.vars.fg,
                    }"
                  >
                    <!-- 分类可能不在字典里（后端出现新枚举），图标兜底为 Pin -->
                    <Icon :name="getHabitCategory(h.category)?.icon ?? 'Pin'" :size="14" />
                    {{ getHabitCategory(h.category)?.label }}
                  </span>
                </template>
              </div>

              <!-- 进度条 + 连续徽章 -->
              <div class="habit-meta">
                <div class="mini-bar">
                  <div
                    class="mini-bar-fill"
                    :style="{
                      width: habitProgressPct(h) + '%',
                      background: isDone(h) ? 'var(--color-success)' : (h.color || 'var(--color-primary)'),
                    }"
                  />
                </div>
                <StreakBadge :streak="h.current_streak ?? 0" :unit="streakUnit(h.frequency)" />
                <span v-if="h.status === 'archived'" class="archived-tag">已归档</span>
              </div>
            </div>

            <button
              type="button"
              class="check-btn"
              :class="{ 'is-done': isDone(h), 'has-progress': (h.today_count ?? 0) > 0 && !isDone(h) }"
              :disabled="h.status !== 'active' || isDone(h)"
              @click.stop="openCheckIn(h)"
            >
              <template v-if="isDone(h)">
                <span class="check-tick">✓</span>
                <span class="check-text">已完成</span>
              </template>
              <template v-else>
                <span class="check-tick">+</span>
                <span class="check-text">{{ h.today_count ?? 0 }}/{{ h.target_count }}</span>
              </template>
            </button>
          </div>

          <!-- 左滑操作（B4：替代失效的 @contextmenu） -->
          <template #right>
            <div class="swipe-actions">
              <button type="button" class="swipe-btn is-edit" @click="emit('edit', h)">编辑</button>
              <button type="button" class="swipe-btn is-delete" @click="emit('delete', h)">删除</button>
            </div>
          </template>
        </van-swipe-cell>
      </li>
    </ul>

    <!-- ============ 打卡弹窗（可选时长，与桌面端一致）============
         ⚠️ teleport="body" 必留：本组件在记录页 main.tab-body（滚动容器）里，
         iOS 上会被布局层 chrome 压住。完整说明见 period/PeriodDaySheet.vue -->
    <van-popup v-model:show="checkInShow" position="bottom" round teleport="body">
      <div class="checkin-sheet">
        <h4 class="checkin-title">打卡</h4>
        <p class="checkin-sub">「{{ checkInTarget?.title }}」</p>

        <div class="checkin-field">
          <label class="checkin-label">打卡时长（分钟）</label>
          <van-stepper
            v-model="checkInDuration"
            :min="0"
            :max="1440"
            :step="5"
            theme="round"
            button-size="28"
          />
        </div>
        <p class="checkin-hint">留空或填 0 表示不记录时长</p>

        <div class="checkin-actions">
          <button type="button" class="btn-ghost is-wide" @click="checkInShow = false">取消</button>
          <button type="button" class="btn-solid is-wide" @click="confirmCheckIn">确认打卡</button>
        </div>
      </div>
    </van-popup>
  </section>
</template>

<style lang="scss" scoped>
.card {
  background: var(--color-bg-card);
  border-radius: 16px;
  box-shadow: var(--shadow-xs);
  padding: 16px;
  margin-bottom: 16px;
}
.card-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 12px;
}
.card-title {
  font-size: var(--fs-h4);
  font-weight: 600;
  color: var(--color-text-primary);
  margin: 0;
}
.card-sub {
  font-size: var(--fs-caption-sm);
  color: var(--color-text-tertiary);
}

/* ========== 4 KPI ========== */
.kpi-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
  margin-bottom: 14px;
}
.kpi-card {
  padding: 12px;
  background: var(--color-bg-hover);
  border-radius: 12px;
}
.kpi-label {
  font-size: var(--fs-caption-sm);
  color: var(--color-text-tertiary);
  margin-bottom: 4px;
}
.kpi-value {
  display: flex;
  align-items: baseline;
  gap: 3px;
}
.kv-strong {
  /* 数值阶令牌：与首页 / 待办 / 统计的 KPI 数值统一（原为 22px） */
  font-size: var(--fs-metric);
  font-weight: 700;
  color: var(--color-text-primary);
  font-family: var(--font-num);
  line-height: 1.15;
}
.kv-thin {
  /* 数值次要部分令牌：与首页 / 统计的数值次要部分统一 */
  font-size: var(--fs-metric-sm);
  color: var(--color-text-tertiary);
  font-family: var(--font-num);
}
.kv-flame { line-height: 1; }
.kpi-bar {
  height: 4px;
  margin: 6px 0 4px;
  background: var(--color-border-light);
  border-radius: 999px;
  overflow: hidden;
}
.kpi-bar-fill {
  height: 100%;
  background: var(--color-success);
  border-radius: 999px;
  transition: width var(--duration-normal) var(--ease-default);
}
.kpi-foot {
  font-size: var(--fs-micro);
  color: var(--color-text-tertiary);
}

/* ========== 里程碑 ========== */
.milestone-section {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 0 14px;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  &::-webkit-scrollbar { display: none; }
}
.section-label {
  flex-shrink: 0;
  font-size: var(--fs-caption);
  color: var(--color-text-tertiary);
}

/* ========== 热力图 ========== */
.heatmap-section {
  padding-bottom: 14px;
  border-bottom: 1px solid var(--color-border-light);
  margin-bottom: 8px;
}
.heatmap-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
.heatmap-title {
  font-size: var(--fs-caption);
  color: var(--color-text-secondary);
}
.heatmap-nav {
  display: flex;
  align-items: center;
  gap: 6px;
}
.nav-btn {
  min-width: 26px;
  height: 26px;
  padding: 0 8px;
  font-size: var(--fs-body);
  color: var(--color-text-secondary);
  background: var(--color-bg-hover);
  border: 0;
  border-radius: 8px;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  &:active { transform: scale(0.94); }
  &.is-text { font-size: var(--fs-caption-sm); color: var(--color-primary); }
}
.heatmap-skeleton {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.skel-bar {
  height: 26px;
  border-radius: 6px;
  background: linear-gradient(90deg, #F3F4F6 25%, #E5E7EB 50%, #F3F4F6 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
}
.heatmap-error {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px;
  font-size: var(--fs-caption);
  color: var(--color-danger-dark);
  background: var(--color-danger-light);
  border-radius: 10px;
}
.heatmap-retry {
  padding: 4px 12px;
  font-size: var(--fs-caption-sm);
  font-weight: 600;
  color: #FFFFFF;
  background: var(--color-danger);
  border: 0;
  border-radius: 999px;
  cursor: pointer;
}
.heatmap-empty {
  padding: 20px;
  text-align: center;
  font-size: var(--fs-caption-sm);
  color: var(--color-text-tertiary);
}

/* ========== 筛选 / 工具栏 ========== */
.habit-filter {
  margin: 8px -16px 10px;
  :deep(.van-dropdown-menu__bar) {
    background: transparent;
    box-shadow: none;
  }
  :deep(.van-dropdown-menu__title) {
    font-size: var(--fs-caption);
    color: var(--color-text-secondary);
  }
}
.toolbar-right {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  margin-bottom: 12px;
}
.btn-ghost,
.btn-solid {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 30px;
  padding: 0 12px;
  font-size: var(--fs-caption-sm);
  font-weight: 500;
  border: 0;
  border-radius: 999px;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  &:active { transform: scale(0.96); }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
  &.is-wide { flex: 1; height: 42px; justify-content: center; font-size: var(--fs-body-sm); }
}
.btn-ghost {
  color: var(--color-text-secondary);
  background: var(--color-bg-hover);
}
.btn-solid {
  color: #FFFFFF;
  background: var(--color-primary);
}

/* ========== 列表 ========== */
.habit-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.habit-swipe {
  border-radius: 12px;
  box-shadow: var(--shadow-xs);
  overflow: hidden;
}
.habit-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  background: var(--color-bg-card);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  &:active { background: var(--color-bg-hover); }
}
.habit-emoji {
  flex-shrink: 0;
  width: 38px;
  height: 38px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  line-height: 1;
}
.habit-body { flex: 1; min-width: 0; }
.habit-title {
  font-size: var(--fs-body-sm);
  font-weight: 600;
  color: var(--color-text-primary);
  margin-bottom: 3px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.habit-sub {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: var(--fs-micro);
  color: var(--color-text-tertiary);
  overflow: hidden;
  white-space: nowrap;
}
.dot { opacity: 0.5; }
.cat-tag {
  padding: 1px 6px;
  font-size: var(--fs-tab);
  border-radius: 999px;
  white-space: nowrap;
}
.habit-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
}
.mini-bar {
  flex: 1;
  min-width: 40px;
  max-width: 90px;
  height: 4px;
  background: var(--color-border-light);
  border-radius: 999px;
  overflow: hidden;
}
.mini-bar-fill {
  height: 100%;
  border-radius: 999px;
  transition: width var(--duration-normal) var(--ease-default);
}
.archived-tag {
  font-size: var(--fs-tab);
  color: var(--color-text-tertiary);
  background: var(--color-bg-hover);
  padding: 1px 6px;
  border-radius: 999px;
}

.check-btn {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 7px 11px;
  font-size: var(--fs-caption-sm);
  font-weight: 600;
  background: var(--color-primary);
  color: #FFFFFF;
  border: 0;
  border-radius: 999px;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  font-family: var(--font-num);
  &:active { transform: scale(0.94); }
  &.is-done { background: var(--color-success); }
  &.has-progress { background: var(--color-warning); }
  &:disabled { cursor: default; }
}
.check-tick { font-size: 13px; line-height: 1; }

.swipe-actions { display: flex; height: 100%; }
.swipe-btn {
  width: 68px;
  height: 100%;
  border: 0;
  padding: 0;
  font-size: var(--fs-body-sm);
  font-weight: 500;
  color: #FFFFFF;
  cursor: pointer;
  &:active { opacity: 0.85; }
  &.is-edit { background: var(--color-text-tertiary); }
  &.is-delete { background: var(--color-danger); }
}

/* ========== 打卡弹窗 ========== */
.checkin-sheet {
  padding: 20px 20px calc(20px + env(safe-area-inset-bottom, 0px));
}
.checkin-title {
  font-size: var(--fs-h4);
  font-weight: 600;
  color: var(--color-text-primary);
  margin: 0 0 4px;
}
.checkin-sub {
  font-size: var(--fs-caption);
  color: var(--color-text-secondary);
  margin: 0 0 16px;
}
.checkin-field {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.checkin-label {
  font-size: var(--fs-caption);
  color: var(--color-text-secondary);
}
.checkin-hint {
  font-size: var(--fs-micro);
  color: var(--color-text-tertiary);
  margin: 8px 0 18px;
}
.checkin-actions {
  display: flex;
  gap: 10px;
}

/* ========== 空 / 加载 ========== */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 48px 24px;
  text-align: center;
  &.sm { padding: 32px 24px; }
}
.empty-emoji { margin-bottom: 10px; opacity: 0.6; }
.empty-title {
  font-size: var(--fs-body);
  font-weight: 600;
  color: var(--color-text-primary);
  margin: 0 0 4px;
}
.empty-desc {
  font-size: var(--fs-caption-sm);
  color: var(--color-text-tertiary);
  margin: 0;
}
.loading-skeleton {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.skel-row {
  height: 64px;
  border-radius: 12px;
  background: linear-gradient(90deg, #F3F4F6 25%, #E5E7EB 50%, #F3F4F6 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
}
@keyframes shimmer {
  0%   { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
</style>
