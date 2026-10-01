<script setup lang="ts">
/**
 * 首页（移动端 · Phase 2.1 + 2.2）
 *
 * SYNC-FROM-DESKTOP: life-assisitant-ui-desktop/src/pages/home/index.tsx
 * SYNC-FROM-BACKEND: life-assisitant-api/internal/model/dto/home.go
 * 最后同步：2026-09-18
 *
 * Phase 2 改动：
 *   2.1 数据源由「拼 4 个接口」改为 `/home` 聚合接口一次请求
 *       （+ `/timeline` 取今日事件流，两个请求 allSettled 并发、各自独立错误态）
 *   2.2 新增：心情/精力区、第 4 个 KPI（本月收入）、管家建议横幅、今日时间线；
 *       习惯区补「完成环 + 最长连续」，财务区补「分类占比」
 *
 * 与桌面端的差异（刻意）：
 *   - 桌面端 `todoProgress = kpi.todo_rate * 100` —— 但后端 `todo_rate` 注释明确是
 *     **0-100**（`model/dto/home.go`），桌面端这一处多乘了 100（进度条恒 100%）。
 *     移动端按后端口径直接用，不再复刻该缺陷。
 *   - `HomeHabitItem`（dto/home.go）只有 `icon` / `color`，**没有 `category` / `unit`**
 *     ⇒ 分类图标与单位都要回 habit store 按 id 兜底查。
 *     20260922 两端一致：走 `resolveHabitIconView`（04 §4.2 优先级链），
 *     桌面端原先读 `h.category`（结构里没有 ⇒ 图标恒为灰色）已同轮修正。
 */
// ⚠️ 显式组件名（spec-20260924-v2 S1）：HomeLayout 的 `<KeepAlive :include>` 按
// **组件名**匹配，而本页文件是 index.vue，不写 name 时推断名会是 "index"，
// 与 include 白名单（'Home'）对不上 → 缓存失效。必须显式声明。
defineOptions({ name: 'Home' })
import { computed, onActivated, ref, watchEffect } from 'vue'
import { useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import { useUiStore } from '@/stores/ui'
import { useTaskStore } from '@/stores/task'
import { useHabitStore } from '@/stores/habit'
import { useFinanceStore } from '@/stores/finance'
import { useMoodStore } from '@/stores/mood'
import { homeApi } from '@/api/home'
import { timelineApi } from '@/api/timeline'
import TransactionEditSheet from '@/components/TransactionEditSheet.vue'
import SmartBanner from '@/components/SmartBanner.vue'
import AnniversaryCard from '@/components/AnniversaryCard.vue'
import Timeline from '@/components/Timeline.vue'
import MoodSection from '@/components/MoodSection.vue'
import type {
  CreateTransactionReq,
  HomeHabitItem,
  HomeResp,
  TimelineEvent,
  TransferReq,
  TransactionType,
  UpdateTransactionReq,
} from '@/api/types'
import { getTint, type TintName } from '@/utils/tint'
import { formatMonthDayWeekday, greetingByHour, todayDate } from '@/utils/date'
import Icon from '@/components/icon/Icon.vue'
import MoneyText from '@/components/finance/MoneyText.vue'
import type { IconName } from '@/components/icon/names'
import { resolveHabitIconView } from '@/utils/category-dict'
import { computeRecs } from '@/utils/smart-recs'

const router = useRouter()
const taskStore = useTaskStore()
const habitStore = useHabitStore()
const financeStore = useFinanceStore()
const moodStore = useMoodStore()

const { accounts } = storeToRefs(financeStore)

// 顶部栏（头像 + 问候语 + 日期）已提到 HomeLayout 常驻渲染，
// 本页通过 uiStore 把 /home 接口回来的文案推上去（见下方 watchEffect）。
const ui = useUiStore()

// ==================== 聚合数据（本地 loading / error，区分「加载失败」与「暂无数据」） ====================
const home = ref<HomeResp | null>(null)
const homeLoading = ref(true)
const homeError = ref(false)

const timelineItems = ref<TimelineEvent[]>([])
const timelineLoading = ref(true)
const timelineError = ref(false)

async function refresh(opts: { silent?: boolean } = {}): Promise<void> {
  const silent = opts.silent === true
  // 静默刷新（2026-09-24 S1）：切回 Tab 时不清空、不显示 loading，先拿缓存渲染，
  // 拉到新数据再替换（失败也保留已有内容）。首拉 / 下拉刷新仍走非静默分支。
  if (!silent) {
    homeLoading.value = true
    homeError.value = false
    timelineLoading.value = true
    timelineError.value = false
  }

  const [homeRes, timelineRes] = await Promise.allSettled([
    homeApi.fetch(),
    timelineApi.fetch({ date: todayDate() }),
  ])

  if (homeRes.status === 'fulfilled') {
    home.value = homeRes.value
    homeError.value = false
  } else if (!silent) {
    home.value = null
    homeError.value = true
  }
  homeLoading.value = false

  if (timelineRes.status === 'fulfilled') {
    timelineItems.value = timelineRes.value.items ?? []
    timelineError.value = false
  } else if (!silent) {
    timelineItems.value = []
    timelineError.value = true
  }
  timelineLoading.value = false
}

// ==================== 欢迎语 ====================
// 顶部栏（头像 + 问候语 + 日期）现在由 HomeLayout 常驻渲染（见 components/PageHeader.vue
// + composables/usePageChrome.ts）。本页只负责把「接口回来的文案」推上去：
// 后端 greeting 带 ☀️🌤️ 等 emoji、日期用 today_date · weekday，比本地兜底更准。
// 接口没回来前 greeting / dateText 本身就有本地兜底值，所以推上去也不会空。
const greeting = computed(() => home.value?.greeting || greetingByHour())
const dateText = computed(() => {
  const h = home.value
  if (h?.today_date && h?.weekday) return `${h.today_date} · ${h.weekday}`
  return formatMonthDayWeekday(todayDate())
})

watchEffect(() => {
  ui.setHomeHeader(greeting.value, dateText.value)
})

// ==================== KPI ====================
const kpi = computed(() => home.value?.kpi ?? null)

/** 任务完成率（后端 0-100，直接用，不再 ×100） */
const todoProgress = computed(() => clampPct(kpi.value?.todo_rate ?? 0))
/** 习惯完成率（后端只给 done/total，自行换算） */
const habitProgress = computed(() => {
  const k = kpi.value
  if (!k || k.habit_total <= 0) return 0
  return clampPct((k.habit_done / k.habit_total) * 100)
})

interface KpiCell {
  key: string
  label: string
  icon: IconName
  tint: TintName
  value: string
  /** 金额型 KPI（03 §2.2 #9）：给真值而非拼好的字符串 —— 遮罩统一由 MoneyText 接管 */
  amount?: number
  /** 金额取整（KPI 位窄，大额显示 `¥1.2万`→仍为千分位整数） */
  integer?: boolean
  sub?: string
  progress?: number
  route: string
}

const kpiCells = computed<KpiCell[]>(() => {
  const k = kpi.value
  return [
    {
      key: 'todo',
      label: '今日任务',
      icon: 'ListChecks',
      tint: 'primary',
      value: `${k?.todo_done ?? 0}`,
      sub: `/${k?.todo_total ?? 0}`,
      progress: todoProgress.value,
      route: '/task',
    },
    {
      key: 'habit',
      label: '今日习惯',
      icon: 'Flame',
      tint: 'warning',
      value: `${k?.habit_done ?? 0}`,
      sub: `/${k?.habit_total ?? 0}`,
      progress: habitProgress.value,
      route: '/record',
    },
    {
      key: 'expense',
      label: '本月支出',
      icon: 'Banknote',
      tint: 'danger',
      value: '',
      amount: k?.month_expense ?? 0,
      integer: true,
      route: '/stat',
    },
    {
      key: 'income',
      label: '本月收入',
      icon: 'Banknote',
      tint: 'success',
      value: '',
      amount: k?.month_income ?? 0,
      integer: true,
      route: '/stat',
    },
  ]
})

/** KPI 涨跌（同比 %）；0 不显示 */
function changeLabel(v?: number): string {
  if (!v) return ''
  return `${v > 0 ? '+' : ''}${v.toFixed(1)}%`
}
function changeColor(v?: number): string {
  if (!v) return 'var(--color-text-tertiary)'
  // 支出涨 = 差（红），收入涨 = 好（绿）—— 此处沿用桌面端的 ± 方向色
  return v > 0 ? 'var(--color-danger-dark)' : 'var(--color-success-dark)'
}

// ==================== 管家建议 ====================
const recs = computed(() => computeRecs(home.value, habitStore.habits, new Date()))

// ==================== 今日习惯 ====================
const todayHabits = computed(() => home.value?.today_habits ?? [])

/** 习惯环 SVG 参数（size 88 / stroke 9） */
const habitArc = computed(() => {
  const size = 88
  const stroke = 9
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  return { size, stroke, r, c, offset: c * (1 - habitProgress.value / 100) }
})

/** 最长连续天数（首页习惯卡环形图下方一行） */
const longestStreak = computed(() =>
  habitStore.habits.reduce((max, h) => Math.max(max, h.longest_streak ?? 0), 0)
)

/** 习惯单位：HomeHabitItem 不含 unit，从 habit store 兜底查 */
function habitUnit(id: string): string {
  return habitStore.findById(id)?.unit ?? ''
}

/**
 * 首页习惯图标：HomeHabitItem 也不含 `category` / `icon`（只有裸 icon），
 * 20260922 起 `habits.icon` 空 = **继承分类图标**（04 §4.2），故同样从 habit store
 * 兜底取 category 后再走优先级链：habits.icon > 分类.icon > 分类.emoji > lucide:Pin。
 * store 未到位时退化为响应里的 icon 本身（不空、不闪）。
 */
function habitIconView(h: HomeHabitItem) {
  const s = habitStore.findById(h.id)
  return resolveHabitIconView({ icon: s?.icon || h.icon, category: s?.category })
}

/** 习惯行（图标视图算一次，模板里不再重复调用） */
const todayHabitRows = computed(() =>
  todayHabits.value.map((h) => ({ h, iv: habitIconView(h) }))
)

function habitPct(item: { today_count: number; target_count: number }): number {
  if (item.target_count <= 0) return 0
  return Math.min(100, Math.round((item.today_count / item.target_count) * 100))
}

/**
 * 打卡（B2 修复点：`LogHabitReq` 字段名是 `date`，此前首页传 `log_date` 静默失效）
 * 打卡后同时刷新聚合数据 + 时间线 + 习惯列表，使三处同步。
 */
async function onCheckIn(id: string): Promise<void> {
  const ok = await habitStore.logHabit(id, { date: todayDate(), count: 1 })
  if (ok) await refresh()
}

// ==================== 本月财务 ====================
const monthFinance = computed(() => home.value?.month_finance ?? null)

/** 分类占比（最多 4 条，百分比相对本月支出） */
const financeCats = computed(() => {
  const mf = monthFinance.value
  if (!mf || mf.category_pie.length === 0) return []
  return mf.category_pie.slice(0, 4).map((c) => ({
    ...c,
    pct: mf.expense > 0 ? Math.round((c.value / mf.expense) * 100) : 0,
  }))
})

// ==================== 快捷入口 ====================
interface QuickItem {
  key: string
  label: string
  icon: IconName
  bg: string
  color: string
  onClick: () => void
}

const quickItems = computed<QuickItem[]>(() => {
  const task = getTint('primary')
  const habit = getTint('success')
  const tx = getTint('warning')
  const stat = getTint('accent')
  return [
    {
      key: 'tx',
      label: '记一笔',
      icon: 'Banknote',
      bg: tx.bg,
      color: tx.fg,
      onClick: () => { txSheetShow.value = true },
    },
    {
      key: 'task',
      label: '新建任务',
      icon: 'ListChecks',
      bg: task.bg,
      color: task.fg,
      onClick: () => router.push('/task'),
    },
    {
      key: 'habit',
      label: '去打卡',
      icon: 'Sprout',
      bg: habit.bg,
      color: habit.fg,
      onClick: () => router.push('/record'),
    },
    {
      key: 'stat',
      label: '查看统计',
      icon: 'BarChart3',
      bg: stat.bg,
      color: stat.fg,
      onClick: () => router.push('/stat'),
    },
  ]
})

// ==================== 记一笔弹层 ====================
const txSheetShow = ref(false)
/**
 * 首页只做「新建」（记一笔 / 转账），编辑走记录页。
 * 第三个参数 `mode` 是 Phase 3.4 给 TransactionEditSheet 加编辑模式时引入的，
 * 首页恒为 'create'。
 */
async function onQuickTxSave(
  payload: CreateTransactionReq | TransferReq | UpdateTransactionReq,
  type: TransactionType,
  _mode: 'create' | 'update' = 'create'
): Promise<boolean> {
  if (type === 'transfer') {
    const r = await financeStore.transfer(payload as TransferReq)
    if (r !== null) await refresh()
    return r !== null
  }
  const r = await financeStore.createTransaction(payload as CreateTransactionReq)
  if (r !== null) await refresh()
  return r !== null
}

// ==================== 生命周期 ====================
// 2026-09-24（spec-20260924-v2 S1）：本页被 `<KeepAlive>` 缓存，切回不再重建。
// 首拉带 loading（走骨架屏），回归时**静默刷新**：先拿缓存渲染，后台拉新数据替换。
// ⚠️ 首拉逻辑放 onActivated（不可放 onMounted）—— Vue 中首次挂载也会触发
//    onActivated，放两处会重复发一次请求。用 firstLoad 区分首拉/回归。
let firstLoad = true
onActivated(async () => {
  const silent = !firstLoad
  firstLoad = false
  await Promise.all([
    refresh({ silent }),
    moodStore.fetchByDate(todayDate()),
    habitStore.fetchHabits(),
    financeStore.fetchAccounts(),
    // 首页也预载今日待办，供「今日时间线」之外的即时跳转兜底
    taskStore.fetchTasks('today'),
  ])
})

/** 把任意数值夹到 0-100 */
function clampPct(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(100, Math.round(n)))
}
</script>

<template>
  <div class="home-page">
    <!-- 顶部栏（头像 + 问候语 + 日期）已提到 HomeLayout 常驻渲染
         （components/PageHeader.vue 的 hero 变体 + composables/usePageChrome.ts），
         本页只把文案通过 uiStore 推上去，见 script 里的 watchEffect。 -->

    <main class="home-body">
      <!-- ① 心情 / 精力（常驻，点选即 upsert；完整卡，不折叠，全量时间线） -->
      <MoodSection />

      <!-- ② 4 张 KPI（2×2） -->
      <section class="kpi-grid">
        <button
          v-for="k in kpiCells"
          :key="k.key"
          type="button"
          class="kpi-card"
          @click="router.push(k.route)"
        >
          <div class="kpi-head">
            <span
              class="kpi-emoji"
              :style="{ background: getTint(k.tint).bg }"
              aria-hidden="true"
            ><Icon :name="k.icon" :size="16" :style="{ color: getTint(k.tint).fg }" /></span>
            <span class="kpi-label">{{ k.label }}</span>
          </div>
          <div class="kpi-value" :style="{ color: getTint(k.tint).fg }">
            <MoneyText v-if="k.amount !== undefined" :value="k.amount" :integer="k.integer" />
            <template v-else>{{ k.value }}</template><span v-if="k.sub" class="kpi-value-sub">{{ k.sub }}</span>
          </div>
          <div v-if="k.progress !== undefined" class="kpi-foot">
            <div class="kpi-bar">
              <div
                class="kpi-bar-fill"
                :style="{ width: k.progress + '%', background: getTint(k.tint).fg }"
              />
            </div>
            <span class="kpi-foot-text">{{ k.progress }}%</span>
          </div>
          <div v-else class="kpi-foot">
            <span
              v-if="k.key === 'expense' && kpi?.month_expense_change"
              class="kpi-change"
              :style="{ color: changeColor(kpi.month_expense_change) }"
            >{{ changeLabel(kpi.month_expense_change) }}</span>
            <span
              v-else-if="k.key === 'income' && kpi?.month_income_change"
              class="kpi-change"
              :style="{ color: changeColor(kpi.month_income_change) }"
            >{{ changeLabel(kpi.month_income_change) }}</span>
            <span class="kpi-foot-text muted">同比</span>
          </div>
        </button>
      </section>

      <!-- ③ 管家建议横幅 -->
      <SmartBanner :recs="recs" />

      <!-- ④ 今日时间线 -->
      <section class="card">
        <div class="card-head">
          <h3 class="card-title">今日时间线</h3>
          <span class="card-sub">{{ home?.today_date ?? todayDate() }}</span>
        </div>

        <div v-if="timelineLoading" class="panel-skel">
          <div v-for="i in 3" :key="i" class="skel-row" />
        </div>
        <div v-else-if="timelineError" class="panel-error">
          <span>时间线加载失败</span>
          <button type="button" class="retry-btn" @click="refresh()">重试</button>
        </div>
        <div v-else-if="timelineItems.length === 0" class="panel-empty">
          <Icon name="Clock" :size="32" class="empty-emoji" aria-hidden="true" />
          <span>今天还没有记录</span>
          <span class="empty-desc">完成的任务、习惯打卡和记账会出现在这里</span>
        </div>
        <Timeline v-else :items="timelineItems" />
      </section>

      <!-- ⑤ 今日习惯 -->
      <section class="card">
        <div class="card-head">
          <h3 class="card-title">今日习惯</h3>
          <button type="button" class="card-more" @click="router.push('/record')">全部 ›</button>
        </div>

        <div v-if="homeLoading && !home" class="panel-skel">
          <div v-for="i in 2" :key="i" class="skel-row" />
        </div>
        <div v-else-if="todayHabits.length === 0" class="panel-empty">
          <Icon name="Sprout" :size="32" class="empty-emoji" aria-hidden="true" />
          <span>还没有习惯</span>
          <span class="empty-desc">去记录页创建你的第一个习惯吧</span>
        </div>
        <div v-else class="habit-wrap">
          <!-- 完成环 + 最长连续 -->
          <div class="habit-ring-wrap">
            <svg :width="habitArc.size" :height="habitArc.size" class="habit-ring">
              <circle
                :cx="habitArc.size / 2" :cy="habitArc.size / 2" :r="habitArc.r"
                stroke="var(--color-bg-hover)" :stroke-width="habitArc.stroke" fill="none"
              />
              <circle
                :cx="habitArc.size / 2" :cy="habitArc.size / 2" :r="habitArc.r"
                stroke="var(--color-warning)" :stroke-width="habitArc.stroke" fill="none"
                :stroke-dasharray="habitArc.c" :stroke-dashoffset="habitArc.offset"
                stroke-linecap="round"
                :transform="`rotate(-90 ${habitArc.size / 2} ${habitArc.size / 2})`"
              />
              <text
                :x="habitArc.size / 2" :y="habitArc.size / 2 - 4"
                text-anchor="middle" dominant-baseline="central" class="ring-value"
              >{{ kpi?.habit_done ?? 0 }}</text>
              <text
                :x="habitArc.size / 2" :y="habitArc.size / 2 + 14"
                text-anchor="middle" dominant-baseline="central" class="ring-sub"
              >/ {{ kpi?.habit_total ?? 0 }}</text>
            </svg>
            <div v-if="longestStreak > 0" class="ring-caption">最长连续 {{ longestStreak }} 天</div>
          </div>

          <ul class="habit-list">
            <li v-for="{ h, iv } in todayHabitRows" :key="h.id" class="habit-line" :class="{ 'is-done': h.completed }">
              <span class="habit-emoji" :style="{ background: iv.vars.bg }" aria-hidden="true">
                <Icon :name="iv.icon" :size="16" :style="{ color: iv.vars.fg }" />
              </span>
              <div class="habit-body">
                <div class="habit-name">{{ h.title }}</div>
                <div class="habit-progress-row">
                  <div class="habit-bar">
                    <div
                      class="habit-bar-fill"
                      :style="{
                        width: habitPct(h) + '%',
                        background: h.completed ? 'var(--color-success)' : h.color,
                      }"
                    />
                  </div>
                  <span class="habit-count">
                    {{ h.today_count }}/{{ h.target_count }}{{ habitUnit(h.id) }}
                  </span>
                </div>
              </div>
              <button
                type="button"
                class="habit-check"
                :disabled="h.completed"
                :aria-label="h.completed ? '已打卡' : '打卡'"
                @click="onCheckIn(h.id)"
              >{{ h.completed ? '✓' : '+' }}</button>
            </li>
          </ul>
        </div>
      </section>

      <!-- ⑥ 本月财务 -->
      <section class="card">
        <div class="card-head">
          <h3 class="card-title">本月财务</h3>
          <button type="button" class="card-more" @click="router.push('/stat')">详情 ›</button>
        </div>

        <template v-if="monthFinance">
          <div class="finance-summary">
            <div class="finance-cell">
              <div class="finance-label">支出</div>
              <!-- 精确金额 ⇒ 遮（03 §5 判别式）；颜色 class 在父容器，遮罩态由 MoneyText 中性化 -->
              <div class="finance-value is-expense"><MoneyText :value="monthFinance.expense" integer /></div>
              <div class="kpi-change" :style="{ color: changeColor(monthFinance.expense_change) }">
                {{ changeLabel(monthFinance.expense_change) }}
              </div>
            </div>
            <div class="finance-cell">
              <div class="finance-label">收入</div>
              <div class="finance-value is-income"><MoneyText :value="monthFinance.income" integer /></div>
              <div class="kpi-change" :style="{ color: changeColor(monthFinance.income_change) }">
                {{ changeLabel(monthFinance.income_change) }}
              </div>
            </div>
          </div>

          <div v-if="financeCats.length > 0" class="finance-cats">
            <div class="finance-cats-title">分类占比</div>
            <div v-for="c in financeCats" :key="c.name" class="finance-cat-row">
              <span class="finance-cat-dot" :style="{ background: c.color }" />
              <span class="finance-cat-name">{{ c.name }}</span>
              <span class="finance-cat-value"><MoneyText :value="c.value" integer /></span>
              <span class="finance-cat-pct">{{ c.pct }}%</span>
            </div>
          </div>
        </template>
        <div v-else class="panel-empty">
          <Icon name="FolderOpen" :size="32" class="empty-emoji" aria-hidden="true" />
          <span>暂无财务数据</span>
        </div>
      </section>

      <!-- ⑥.5 重要日子（纪念日 / 倒数日）
           位置按 spec 06 §2：本月财务之下、快捷操作之上。
           ⚠️ 一条都没有时组件内部整卡不渲染，这里不额外判空。 -->
      <AnniversaryCard />

      <!-- ⑦ 快捷入口 -->
      <section class="quick-grid">
        <button
          v-for="q in quickItems"
          :key="q.key"
          type="button"
          class="quick-item"
          :style="{ background: q.bg, color: q.color }"
          @click="q.onClick"
        >
          <Icon :name="q.icon" :size="24" aria-hidden="true" />
          <span class="quick-label">{{ q.label }}</span>
        </button>
      </section>

      <!-- 整体加载失败（与「暂无数据」区分） -->
      <div v-if="homeError && !home" class="global-error">
        <span>首页数据加载失败，请检查网络后重试</span>
        <button type="button" class="retry-btn" @click="refresh()">重试</button>
      </div>
    </main>

    <!-- 记一笔弹层（从首页 + 唤起） -->
    <TransactionEditSheet
      v-model:show="txSheetShow"
      :accounts="accounts"
      :on-save="onQuickTxSave"
    />
  </div>
</template>

<style lang="scss" scoped>
.home-page {
  /* ⚠️ 这里**不写** height：高度由 HomeLayout 的 .content 用 flex 直接分配
     （flex:1 1 0% + min-height:0），不经过百分比解析，也不与布局层的定位
     方案在同一组属性上争抢（详见 HomeLayout .content 的注释）。
     历史坑：之前写 height:100%，而 .content 用 `position:absolute; inset:0`
     钉页面根 —— 两条规则特异性相同，本文件的样式在 HomeLayout 之后注入，
     于是 `position:relative`（.fab 的定位容器需要）静默胜出，absolute 被
     架空，高度退回依赖百分比解析（iOS 上不可靠）→ 页面被内容撑高 →
     .home-body 的 flex:1 空转 → 滚动传到根、顶部栏与胶囊一起弹。 */
  background: var(--color-bg-app);
  display: flex;
  flex-direction: column;
}

/* ========== Header ==========
   顶部栏（头像 + 问候语 + 日期）不在本页渲染了：
   → HomeLayout 的 components/PageHeader.vue（hero 变体）
   本页只保留滚动容器 .home-body。 */

.home-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  /* 滚到两端不把滚动链传给父级，避免 iOS 上整个视口跟着弹动 */
  overscroll-behavior-y: contain;
  /* 底部留白统一走令牌（底距 + 胶囊高 + 呼吸位），离开胶囊不会贴住 */
  padding: 16px var(--space-5) var(--tabbar-reserve, 83px);
}

/* ========== 通用卡片 ========== */
.card {
  background: var(--color-bg-card);
  border-radius: 16px;
  box-shadow: var(--shadow-xs);
  padding: 14px 16px;
  margin-bottom: 16px;
}
.mood-card { padding: 14px 16px; }

.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}
.card-title {
  /* 小标题令牌：与记录/统计/账户等模块的卡片标题统一（原为 15px，
     其余模块都是 --fs-h4 16px） */
  font-size: var(--fs-h4);
  font-weight: 600;
  color: var(--color-text-primary);
  margin: 0;
}
.card-sub {
  font-size: var(--fs-micro);
  font-family: var(--font-num);
  color: var(--color-text-tertiary);
}
.card-more {
  background: transparent;
  border: 0;
  padding: 0;
  font-size: var(--fs-caption-sm);
  color: var(--color-text-tertiary);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

/* ========== KPI（2×2） ========== */
.kpi-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
  margin-bottom: 16px;
}
.kpi-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px;
  background: var(--color-bg-card);
  border: 0;
  border-radius: 14px;
  box-shadow: var(--shadow-xs);
  text-align: left;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  &:active { transform: scale(0.98); }
}
.kpi-head {
  display: flex;
  align-items: center;
  gap: 6px;
}
.kpi-emoji {
  width: 24px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 7px;
  line-height: 1;
  flex-shrink: 0;
}
.kpi-label {
  font-size: var(--fs-caption-sm);
  color: var(--color-text-tertiary);
}
.kpi-value {
  /* 数值阶令牌：与待办 / 统计 / 记录·习惯卡的 KPI 数值同大（原为 19px，
     同一角色在待办是 17px、统计 18px、习惯卡 22px，五种大小） */
  font-size: var(--fs-metric);
  font-weight: 700;
  font-family: var(--font-num);
  line-height: 1.15;
}
.kpi-value-sub {
  /* 数值次要部分令牌：与统计页 .kpi-value-muted 统一（原为 12px） */
  font-size: var(--fs-metric-sm);
  font-weight: 500;
  color: var(--color-text-tertiary);
}
.kpi-foot {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 2px;
  min-height: 14px;
}
.kpi-bar {
  flex: 1;
  height: 4px;
  background: var(--color-bg-hover);
  border-radius: 2px;
  overflow: hidden;
}
.kpi-bar-fill {
  height: 100%;
  border-radius: 2px;
  transition: width var(--duration-normal) var(--ease-default);
}
.kpi-foot-text {
  flex-shrink: 0;
  font-size: var(--fs-micro);
  font-family: var(--font-num);
  color: var(--color-text-secondary);
  &.muted { color: var(--color-text-tertiary); }
}
.kpi-change {
  font-size: var(--fs-micro);
  font-weight: 600;
  font-family: var(--font-num);
}

/* ========== 骨架 / 空态 / 错误态 ========== */
.panel-skel { display: flex; flex-direction: column; gap: 8px; }
.skel-row {
  height: 36px;
  background: linear-gradient(90deg, #F3F4F6 25%, #E5E7EB 50%, #F3F4F6 75%);
  background-size: 200% 100%;
  border-radius: 6px;
  animation: shimmer 1.5s infinite;
}
.panel-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 12px 0;
  font-size: var(--fs-caption-sm);
  color: var(--color-text-tertiary);
  .empty-emoji { opacity: 0.6; }
  .empty-desc { font-size: var(--fs-micro); }
}
.panel-error,
.global-error {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 16px 0;
  font-size: var(--fs-caption-sm);
  color: var(--color-danger-dark);
}
.retry-btn {
  height: 26px;
  padding: 0 12px;
  border: 1px solid currentColor;
  border-radius: 13px;
  background: transparent;
  color: inherit;
  font-size: var(--fs-caption-sm);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

/* ========== 今日习惯 ========== */
.habit-wrap {
  display: flex;
  gap: 14px;
  align-items: flex-start;
}
.habit-ring-wrap {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}
.habit-ring { display: block; }
.ring-value {
  /* 数值阶令牌：环图中心数值与各模块 KPI 同大 */
  font-size: var(--fs-metric);
  font-weight: 700;
  font-family: var(--font-num);
  fill: var(--color-text-primary);
}
.ring-sub {
  font-size: var(--fs-micro);
  font-family: var(--font-num);
  fill: var(--color-text-tertiary);
}
.ring-caption {
  font-size: var(--fs-tab);
  color: var(--color-text-tertiary);
  white-space: nowrap;
}

.habit-list {
  flex: 1;
  min-width: 0;
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.habit-line {
  display: flex;
  align-items: center;
  gap: 8px;
  &.is-done .habit-name { color: var(--color-text-tertiary); }
}
.habit-emoji {
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  line-height: 1;
}
.habit-body { flex: 1; min-width: 0; }
.habit-name {
  /* 小正文令牌：与记录页 .habit-title、统计页 .habit-name 统一（原为 13px，
     同名元素在统计页是 14px） */
  font-size: var(--fs-body-sm);
  font-weight: 500;
  color: var(--color-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.habit-progress-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 3px;
}
.habit-bar {
  flex: 1;
  height: 4px;
  background: var(--color-bg-hover);
  border-radius: 2px;
  overflow: hidden;
}
.habit-bar-fill {
  height: 100%;
  border-radius: 2px;
  transition: width var(--duration-normal) var(--ease-default);
}
.habit-count {
  flex-shrink: 0;
  font-size: var(--fs-tab);
  font-family: var(--font-num);
  color: var(--color-text-tertiary);
}
.habit-check {
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-primary);
  color: #FFFFFF;
  border: 0;
  border-radius: 50%;
  font-size: var(--fs-h4);
  font-weight: 700;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  &:active:not(:disabled) { transform: scale(0.9); }
  &:disabled {
    background: var(--color-success);
    cursor: default;
  }
}

/* ========== 本月财务 ========== */
.finance-summary {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
}
.finance-cell {
  padding: 10px 12px;
  background: var(--color-bg-hover);
  border-radius: 10px;
}
.finance-label {
  font-size: var(--fs-micro);
  color: var(--color-text-tertiary);
}
.finance-value {
  margin: 2px 0;
  font-size: var(--fs-h4);
  font-weight: 700;
  font-family: var(--font-num);
  &.is-expense { color: var(--color-danger-dark); }
  &.is-income { color: var(--color-success-dark); }
}
.finance-cats { margin-top: 12px; }
.finance-cats-title {
  font-size: var(--fs-micro);
  color: var(--color-text-tertiary);
  margin-bottom: 6px;
}
.finance-cat-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 0;
  font-size: var(--fs-caption-sm);
}
.finance-cat-dot {
  flex-shrink: 0;
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
.finance-cat-name {
  flex: 1;
  min-width: 0;
  color: var(--color-text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.finance-cat-value {
  flex-shrink: 0;
  font-family: var(--font-num);
  color: var(--color-text-primary);
}
.finance-cat-pct {
  flex-shrink: 0;
  width: 36px;
  text-align: right;
  font-family: var(--font-num);
  color: var(--color-text-tertiary);
}

/* ========== 快捷入口 ========== */
.quick-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
}
.quick-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 14px 4px;
  border: 0;
  border-radius: 14px;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  &:active { transform: scale(0.96); }
}
.quick-label {
  font-size: var(--fs-caption-sm);
  font-weight: 500;
}

@keyframes shimmer {
  0%   { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
</style>
