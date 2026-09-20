<script setup lang="ts">
/**
 * 记录浮层 —— 9 页横向卡片（移动端经期核心交互）
 *
 * SYNC-FROM-DESKTOP: life-assisitant-ui-desktop/src/pages/record/period/components/PeriodDayDrawer.tsx
 * SYNC-FROM-BACKEND: life-assisitant-api/internal/model/dto/period.go（PeriodDayUpsertReq）
 * 契约文档：md/spec-260919/04-页面与交互设计.md §4.3 / §4.4（9 页定义表 = 唯一真源）
 *
 * 抽屉内所有页共用一份草稿，点「完成」**一次性整体提交**
 * （`PUT /period/days/:date`，服务端在事务里原子写 period_days + mood_logs）。
 * 不做逐字段保存 —— 用户的心智是「补记这一天」，不是「改这一个字段」。
 *
 * 三条与后端绑死的语义：
 *   1. `flow` 是**单值**（0 未记录 / 1 点滴 / 2 量少 / 3 中等 / 4 量多）。
 *      「第 1 页有出血」与「第 9 页点滴出血」正是靠同一个字段天然互斥（02 §5），
 *      不要拆成两个布尔字段，否则两者会同时为真。
 *   2. 心情 / 精力 / 备注走**既有 mood_logs**（mood 1-5、energy 1-3、note ≤50），
 *      不是经期自己的表；`0` 与 `null` 都表示「不填」。
 *   3. 第 3 页刻意**不复用** MoodPicker.vue：那个组件读写的是全局「今天」的心情
 *      （stores/mood），而这里要记的是**任意一天**。视觉一致、数据通路不同，
 *      因此用同一份 MOOD_META 字典自绘，保证观感与首页一致。
 *
 * 空提交（04 §4.4）：所有页全空点「完成」→ 视为删除该日记录，
 * **仅在该日原本已有记录时**弹二次确认。
 */
import { computed, ref, watch } from 'vue'
import { showConfirmDialog } from 'vant'
import Icon from '@/components/icon/Icon.vue'
import { usePeriodStore } from '@/stores/period'
import { ENERGY_LEVELS, MOOD_LEVELS } from '@/utils/mood-dict'
import { formatMonthDayWeekday, todayDate } from '@/utils/date'
import {
  PERIOD_DEFAULT_RECENT_SYMPTOMS,
  PERIOD_DISCHARGE_OPTIONS,
  PERIOD_FLOW_LIGHT,
  PERIOD_FLOW_LEVELS,
  PERIOD_FLOW_MEDIUM,
  PERIOD_FLOW_SPOTTING,
  PERIOD_GOAL_OPTIONS,
  PERIOD_INTERCOURSE_OPTIONS,
  PERIOD_SYMPTOM_GROUPS,
  periodSymptomLabel,
} from '@/constants/period'
import type { PeriodDayUpsertReq } from '@/api/types'

const props = defineProps<{
  show: boolean
  /** 记录哪一天（YYYY-MM-DD） */
  date: string
  /** 打开时定位到第几页（0-based）：FAB=0，症状快捷=1 … */
  initialPage?: number
}>()

const emit = defineEmits<{
  (e: 'update:show', v: boolean): void
  (e: 'saved', date: string): void
}>()

const store = usePeriodStore()

/** 9 页定义（顺序即 true 唯一真源 04 §4.4） */
const PAGES = [
  { key: 'flow', title: '经期', tint: 'var(--color-period)', tintBg: 'var(--color-period-soft)' },
  { key: 'symptoms', title: '症状', tint: 'var(--color-accent)', tintBg: 'var(--tint-accent-bg)' },
  { key: 'mood', title: '心情', tint: 'var(--color-warning)', tintBg: 'var(--tint-warning-bg)' },
  // ⚠️ 没有 --tint-info-* 令牌（tint.ts 只有 6 组语义色），蓝色维度直接取 --color-info-*
  { key: 'energy', title: '精力 · 睡眠', tint: 'var(--color-info-dark)', tintBg: 'var(--color-info-light)' },
  { key: 'bbt', title: '体温', tint: 'var(--color-primary)', tintBg: 'var(--tint-primary-bg)' },
  { key: 'weight', title: '体重', tint: 'var(--color-success)', tintBg: 'var(--tint-success-bg)' },
  { key: 'discharge', title: '分泌物', tint: 'var(--color-accent)', tintBg: 'var(--tint-accent-bg)' },
  { key: 'intercourse', title: '性生活', tint: 'var(--color-danger)', tintBg: 'var(--tint-danger-bg)' },
  { key: 'other', title: '其他记录', tint: 'var(--color-text-secondary)', tintBg: 'var(--color-bg-hover)' },
] as const

/** 各维度 ⓘ 说明（04 §7.2，文案与桌面端逐字一致） */
const DIMENSION_INFO: Record<string, string> = {
  flow: '记录每天的实际出血情况。经量会随时间变化，连续记录能看出这个月偏多还是偏少。',
  symptoms: '身体的不适同样值得留档。记录 2–3 个周期后，你就能看到「哪些症状总在经前出现」。',
  mood: '心情与激素水平相关，黄体期出现情绪波动是常见现象，记录下来能帮你提前做心理准备。',
  energy: '卵泡期精力通常较好，黄体期容易疲惫。这些数据能让预测更贴合你的真实状态。',
  bbt: '基础体温需要在早晨醒来、未起床、未进食时测量。排卵后体温会升高 0.2–0.5 ℃ 并维持到下次经期，因此它擅长确认排卵，但通常要等排卵发生之后才看得出来。',
  weight: '黄体期因水钠潴留，体重上升 0.5–2 kg 属正常波动，不必因此焦虑。',
  discharge: '分泌物随周期变化：接近排卵时会变得清亮、可拉丝，这是生育力最高的信号。',
  intercourse: '仅供你自己参考。数据默认不显示在首页或统计中。',
  other: '点滴出血（量少到只需护垫）不等于月经。单独记录它可以避免把周期长度算错。',
}

/* ==================== 草稿 ==================== */

interface Draft {
  flow: number
  symptoms: string[]
  pain_level: number
  discharge: number
  bbt: number | null
  weight: number | null
  sleep_hours: number | null
  intercourse: number
  mood: number
  energy: number
  note: string
}

function emptyDraft(): Draft {
  return {
    flow: 0,
    symptoms: [],
    pain_level: 0,
    discharge: 0,
    bbt: null,
    weight: null,
    sleep_hours: null,
    intercourse: 0,
    mood: 0,
    energy: 0,
    note: '',
  }
}

/** 抽屉内部当前日期（头部箭头可改，不改月历视图） */
const curDate = ref(props.date || todayDate())
const draft = ref<Draft>(emptyDraft())
/** 该日原本是否已有记录（决定空提交时是否弹删除确认） */
const hadRecord = ref(false)
const recentSymptoms = ref<string[]>([])
const lastBbt = ref<number | null>(null)
const lastWeight = ref<number | null>(null)

const loading = ref(false)
const page = ref(0)
const swipeRef = ref<{ swipeTo: (i: number, opts?: Record<string, unknown>) => void } | null>(null)

const isBackfill = computed(() => curDate.value < todayDate())

/** 供「沿用上次」显示 */
const lastBbtText = computed(() => (lastBbt.value == null ? '' : lastBbt.value.toFixed(2)))
const lastWeightText = computed(() => (lastWeight.value == null ? '' : lastWeight.value.toFixed(1)))

/* ==================== 载入 ==================== */

async function load(date: string): Promise<void> {
  loading.value = true
  try {
    const res = await store.fetchDay(date)
    const day = res?.day ?? null
    hadRecord.value = !!day
    recentSymptoms.value =
      res?.recent_symptoms && res.recent_symptoms.length > 0
        ? res.recent_symptoms
        : [...PERIOD_DEFAULT_RECENT_SYMPTOMS]
    lastBbt.value = res?.last_values?.bbt ?? null
    lastWeight.value = res?.last_values?.weight ?? null
    draft.value = day
      ? {
          flow: day.flow,
          symptoms: [...day.symptoms],
          pain_level: day.pain_level,
          discharge: day.discharge,
          bbt: day.bbt,
          weight: day.weight,
          sleep_hours: day.sleep_hours,
          intercourse: day.intercourse,
          mood: day.mood ?? 0,
          energy: day.energy ?? 0,
          note: day.note ?? '',
        }
      : emptyDraft()
  } finally {
    loading.value = false
  }
}

watch(
  () => props.show,
  (v) => {
    if (!v) return
    curDate.value = props.date || todayDate()
    page.value = props.initialPage ?? 0
    void load(curDate.value).then(() => {
      // 数据到位后再定位，避免首屏闪一下第 1 页
      swipeRef.value?.swipeTo(page.value, { immediate: true })
    })
  }
)

function close(): void {
  emit('update:show', false)
}

async function shiftDate(delta: number): Promise<void> {
  const d = new Date(`${curDate.value}T00:00:00`)
  d.setDate(d.getDate() + delta)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  curDate.value = `${y}-${m}-${dd}`
  await load(curDate.value)
}

/* ==================== 第 1 页：经期 ==================== */

/** 有出血 = flow ∈ {量少,中等,量多}；点滴在第 9 页，天然互斥 */
const bleeding = computed(() => draft.value.flow >= PERIOD_FLOW_LIGHT)

function setBleeding(on: boolean): void {
  draft.value.flow = on ? PERIOD_FLOW_MEDIUM : 0
}

function setFlowLevel(v: number): void {
  draft.value.flow = v
}

/* ==================== 第 2 页：症状 ==================== */

/** 近期症状分组（后端近 90 天 Top6；无记录时用默认补足顺序） */
const recentGroup = computed(() => ({
  key: 'RECENT' as const,
  label: '近期症状',
  items: recentSymptoms.value.map((k) => ({ key: k, label: periodSymptomLabel(k) })),
}))

const symptomGroups = computed(() => [recentGroup.value, ...PERIOD_SYMPTOM_GROUPS])

function toggleSymptom(key: string): void {
  const list = draft.value.symptoms
  const i = list.indexOf(key)
  if (i >= 0) list.splice(i, 1)
  else list.push(key)
}

/* ==================== 第 3 页：心情（0 = 不填）==================== */

function pickMood(v: number): void {
  draft.value.mood = draft.value.mood === v ? 0 : v
}

/* ==================== 第 4 页：精力 / 睡眠 ==================== */

function pickEnergy(v: number): void {
  draft.value.energy = draft.value.energy === v ? 0 : v
}

function stepSleep(delta: number): void {
  const cur = draft.value.sleep_hours ?? 0
  const next = Math.round((cur + delta) * 2) / 2
  if (next <= 0) draft.value.sleep_hours = null
  else if (next > 24) draft.value.sleep_hours = 24
  else draft.value.sleep_hours = next
}

/* ==================== 第 5/6 页：数字输入 ==================== */

const bbtText = ref('')
const weightText = ref('')

watch(
  () => draft.value.bbt,
  (v) => {
    bbtText.value = v == null ? '' : v.toFixed(2)
  }
)
watch(
  () => draft.value.weight,
  (v) => {
    weightText.value = v == null ? '' : v.toFixed(1)
  }
)

function commitBbt(): void {
  const raw = bbtText.value.trim()
  if (!raw) {
    draft.value.bbt = null
    return
  }
  const n = Number(raw)
  // 34.00–42.00，超出直接丢弃（后端也会校验 PeriodBBTInvalid）
  if (!Number.isFinite(n) || n < 34 || n > 42) {
    draft.value.bbt = null
    bbtText.value = ''
    return
  }
  draft.value.bbt = Math.round(n * 100) / 100
}

function commitWeight(): void {
  const raw = weightText.value.trim()
  if (!raw) {
    draft.value.weight = null
    return
  }
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 20 || n > 300) {
    draft.value.weight = null
    weightText.value = ''
    return
  }
  draft.value.weight = Math.round(n * 10) / 10
}

/* ==================== 第 9 页：点滴 + 备注 ==================== */

const spotting = computed(() => draft.value.flow === PERIOD_FLOW_SPOTTING)

function setSpotting(on: boolean): void {
  draft.value.flow = on ? PERIOD_FLOW_SPOTTING : 0
}

const NOTE_MAX = 50
const noteCount = computed(() => draft.value.note.length)

/* ==================== 提交 ==================== */

const isEmpty = computed(() => {
  const d = draft.value
  return (
    d.flow === 0 &&
    d.symptoms.length === 0 &&
    d.pain_level === 0 &&
    d.discharge === 0 &&
    d.bbt == null &&
    d.weight == null &&
    d.sleep_hours == null &&
    d.intercourse === 0 &&
    d.mood === 0 &&
    d.energy === 0 &&
    !d.note.trim()
  )
})

async function onSubmit(): Promise<void> {
  const date = curDate.value

  if (isEmpty.value) {
    if (!hadRecord.value) {
      close()
      return
    }
    try {
      await showConfirmDialog({
        title: '清除记录',
        message: '这一天没有任何记录，确定要清除吗？',
        confirmButtonText: '清除',
        confirmButtonColor: 'var(--color-danger)',
      })
    } catch {
      return
    }
    const ok = await store.deleteDay(date)
    if (ok) {
      emit('saved', date)
      close()
    }
    return
  }

  const payload: Omit<PeriodDayUpsertReq, 'date'> = {
    flow: draft.value.flow,
    symptoms: [...draft.value.symptoms],
    pain_level: draft.value.pain_level,
    discharge: draft.value.discharge,
    bbt: draft.value.bbt,
    weight: draft.value.weight,
    sleep_hours: draft.value.sleep_hours,
    intercourse: draft.value.intercourse,
    mood: draft.value.mood,
    energy: draft.value.energy,
    note: draft.value.note.trim().slice(0, NOTE_MAX),
  }
  const ok = await store.upsertDay(date, payload)
  if (ok) {
    emit('saved', date)
    close()
  }
}

/** 各页 ⓘ 弹层 */
const infoKey = ref('')
const infoShow = ref(false)
function openInfo(key: string): void {
  infoKey.value = key
  infoShow.value = true
}

/** 目标模式只影响默认页序（04 §7.5 第 4 步）；当前仅用于文案校准，不做功能阉割 */
const goalLabel = computed(
  () => PERIOD_GOAL_OPTIONS.find((g) => g.value === store.settings?.goal)?.label ?? ''
)

defineExpose({ load })
</script>

<template>
  <!--
    ⚠️ teleport="body" **不能删**（2026-09-19 真机报障后修）。

    Vant 4 的 Popup 只有传了 teleport 才真的挂到 body（见
    node_modules/vant/es/popup/Popup.mjs 的 render：`props.teleport` 为假
    时走 Fragment 原地渲染），否则就在使用处原地渲染。

    本组件由 PeriodTab 渲染，而 PeriodTab 在 `main.tab-body` 里 —— 一个
    `overflow-y:auto` + `-webkit-overflow-scrolling:touch` 的滚动容器。
    桌面浏览器上 `position:fixed` 会正常逃逸到视口，所以**看着完全正常**；
    但 iOS 会把该滚动容器提升为独立合成层，弹层即便**几何位置正确**
    （实测过：顶边 8%、底边贴屏，与桌面逐像素一致），**绘制顺序**仍被困在
    那个上下文里 —— z-index 给到 2001 也照样被布局层 chrome 压住：
    顶部的 PageHeader / SubTabBar 盖掉弹层的拖拽条、日期行与卡片头，
    底部胶囊与 FAB 盖掉「完成」按钮，而且因为几何没错，**看不出是层级问题**，
    只会以为「内容被裁了」。

    挂到 body 后弹层脱离所有祖先层叠上下文（也脱离 .home-layout 的
    overflow:hidden 与各处滚动层），问题根除。同源坑见
    components/AccountEditSheet.vue 的图标选择器 —— 那边先踩过、先修的。
  -->
  <van-popup
    :show="show"
    position="bottom"
    round
    teleport="body"
    :style="{ height: '92%' }"
    :close-on-click-overlay="false"
    @update:show="emit('update:show', $event)"
  >
    <div class="day-sheet">
      <!-- ==================== 头部 ==================== -->
      <div class="ds-head">
        <div class="ds-head-row">
          <span class="ds-grab" aria-hidden="true" />
          <div class="ds-date">
            <button class="ds-date-nav" type="button" aria-label="前一天" @click="shiftDate(-1)">‹</button>
            <span class="ds-date-text">{{ formatMonthDayWeekday(curDate) }}</span>
            <button class="ds-date-nav" type="button" aria-label="后一天" @click="shiftDate(1)">›</button>
          </div>
          <button class="ds-close" type="button" aria-label="关闭" @click="close">
            <Icon name="X" :size="18" />
          </button>
        </div>
        <p v-if="isBackfill" class="ds-hint">补记 {{ formatMonthDayWeekday(curDate) }}</p>
      </div>

      <!-- ==================== 9 页 ==================== -->
      <div v-if="loading" class="ds-loading">加载中…</div>

      <van-swipe
        v-else
        ref="swipeRef"
        class="ds-swipe"
        :loop="false"
        :show-indicators="false"
        :initial-swipe="page"
        @change="(i: number) => (page = i)"
      >
        <!-- ---------- 1 / 9 经期 ---------- -->
        <van-swipe-item>
          <section class="ds-card">
            <header class="ds-card-head" :style="{ background: PAGES[0].tintBg, color: PAGES[0].tint }">
              <span class="ds-card-bar" :style="{ background: PAGES[0].tint }" />
              <span class="ds-card-title">经期</span>
              <button class="ds-info" type="button" aria-label="说明" @click="openInfo('flow')">
                <Icon name="Info" :size="18" />
              </button>
            </header>
            <div class="ds-card-body">
              <div class="ds-row" @click="setBleeding(true)">
                <span class="ds-row-label">有出血</span>
                <span class="ds-radio" :class="{ 'is-on': bleeding }">
                  <Icon v-if="bleeding" name="Check" :size="14" />
                </span>
              </div>
              <template v-if="bleeding">
                <div class="ds-group-title">经量</div>
                <div
                  v-for="lv in PERIOD_FLOW_LEVELS"
                  :key="lv.value"
                  class="ds-row"
                  @click="setFlowLevel(lv.value)"
                >
                  <span class="ds-row-label">
                    {{ lv.label }}
                    <span class="ds-row-hint">{{ lv.hint }}</span>
                  </span>
                  <span class="ds-radio" :class="{ 'is-on': draft.flow === lv.value }">
                    <Icon v-if="draft.flow === lv.value" name="Check" :size="14" />
                  </span>
                </div>
              </template>
              <div class="ds-row" @click="setBleeding(false)">
                <span class="ds-row-label">未出血</span>
                <span class="ds-radio" :class="{ 'is-on': !bleeding }">
                  <Icon v-if="!bleeding" name="Check" :size="14" />
                </span>
              </div>
            </div>
          </section>
        </van-swipe-item>

        <!-- ---------- 2 / 9 症状 ---------- -->
        <van-swipe-item>
          <section class="ds-card">
            <header class="ds-card-head" :style="{ background: PAGES[1].tintBg, color: PAGES[1].tint }">
              <span class="ds-card-bar" :style="{ background: PAGES[1].tint }" />
              <span class="ds-card-title">症状</span>
              <button class="ds-info" type="button" aria-label="说明" @click="openInfo('symptoms')">
                <Icon name="Info" :size="18" />
              </button>
            </header>
            <div class="ds-card-body">
              <p class="ds-lead">选择所有适用症状。</p>
              <template v-for="g in symptomGroups" :key="g.key">
                <div class="ds-group-title">{{ g.label }}</div>
                <div
                  v-for="it in g.items"
                  :key="it.key"
                  class="ds-row"
                  @click="toggleSymptom(it.key)"
                >
                  <span class="ds-row-label">{{ it.label }}</span>
                  <span class="ds-radio" :class="{ 'is-on': draft.symptoms.includes(it.key) }">
                    <Icon v-if="draft.symptoms.includes(it.key)" name="Check" :size="14" />
                  </span>
                </div>
              </template>

              <div class="ds-group-title">疼痛程度</div>
              <div class="ds-scale">
                <button
                  v-for="n in 5"
                  :key="n"
                  type="button"
                  class="ds-scale-btn"
                  :class="{ 'is-on': draft.pain_level === n }"
                  @click="draft.pain_level = draft.pain_level === n ? 0 : n"
                >
                  {{ n }}
                </button>
              </div>
            </div>
          </section>
        </van-swipe-item>

        <!-- ---------- 3 / 9 心情 ---------- -->
        <van-swipe-item>
          <section class="ds-card">
            <header class="ds-card-head" :style="{ background: PAGES[2].tintBg, color: PAGES[2].tint }">
              <span class="ds-card-bar" :style="{ background: PAGES[2].tint }" />
              <span class="ds-card-title">心情</span>
              <button class="ds-info" type="button" aria-label="说明" @click="openInfo('mood')">
                <Icon name="Info" :size="18" />
              </button>
            </header>
            <div class="ds-card-body">
              <div
                v-for="m in MOOD_LEVELS"
                :key="m.value"
                class="ds-row"
                @click="pickMood(m.value)"
              >
                <span class="ds-row-label ds-row-with-icon">
                  <Icon :name="m.icon" :size="18" />
                  {{ m.label }}
                </span>
                <span class="ds-radio" :class="{ 'is-on': draft.mood === m.value }">
                  <Icon v-if="draft.mood === m.value" name="Check" :size="14" />
                </span>
              </div>
              <p class="ds-foot-hint">再点一次可取消选择</p>
            </div>
          </section>
        </van-swipe-item>

        <!-- ---------- 4 / 9 精力 · 睡眠 ---------- -->
        <van-swipe-item>
          <section class="ds-card">
            <header class="ds-card-head" :style="{ background: PAGES[3].tintBg, color: PAGES[3].tint }">
              <span class="ds-card-bar" :style="{ background: PAGES[3].tint }" />
              <span class="ds-card-title">精力 · 睡眠</span>
              <button class="ds-info" type="button" aria-label="说明" @click="openInfo('energy')">
                <Icon name="Info" :size="18" />
              </button>
            </header>
            <div class="ds-card-body">
              <div class="ds-group-title">精力</div>
              <div class="ds-segment">
                <button
                  v-for="e in ENERGY_LEVELS"
                  :key="e.value"
                  type="button"
                  class="ds-segment-btn"
                  :class="{ 'is-on': draft.energy === e.value }"
                  @click="pickEnergy(e.value)"
                >
                  {{ e.label }}
                </button>
              </div>

              <div class="ds-group-title">睡眠时长</div>
              <div class="ds-stepper">
                <button class="ds-step-btn" type="button" aria-label="减少" @click="stepSleep(-0.5)">−</button>
                <span class="ds-step-value">
                  {{ draft.sleep_hours == null ? '未记录' : `${draft.sleep_hours} 小时` }}
                </span>
                <button class="ds-step-btn" type="button" aria-label="增加" @click="stepSleep(0.5)">＋</button>
              </div>
              <p class="ds-foot-hint">步进 0.5 小时，0–24 小时</p>
            </div>
          </section>
        </van-swipe-item>

        <!-- ---------- 5 / 9 体温 ---------- -->
        <van-swipe-item>
          <section class="ds-card">
            <header class="ds-card-head" :style="{ background: PAGES[4].tintBg, color: PAGES[4].tint }">
              <span class="ds-card-bar" :style="{ background: PAGES[4].tint }" />
              <span class="ds-card-title">体温</span>
              <button class="ds-info" type="button" aria-label="说明" @click="openInfo('bbt')">
                <Icon name="Info" :size="18" />
              </button>
            </header>
            <div class="ds-card-body">
              <div class="ds-num-field">
                <input
                  v-model="bbtText"
                  class="ds-num-input"
                  type="number"
                  inputmode="decimal"
                  step="0.01"
                  min="34"
                  max="42"
                  placeholder="36.55"
                  @blur="commitBbt"
                  @keyup.enter="($event.target as HTMLInputElement).blur()"
                >
                <span class="ds-num-unit">℃</span>
              </div>
              <button
                v-if="lastBbt != null"
                class="ds-reuse"
                type="button"
                @click="draft.bbt = lastBbt"
              >
                沿用上次 {{ lastBbtText }} ℃
              </button>
              <p class="ds-foot-hint">早晨醒来未起床时测量最准确。</p>
            </div>
          </section>
        </van-swipe-item>

        <!-- ---------- 6 / 9 体重 ---------- -->
        <van-swipe-item>
          <section class="ds-card">
            <header class="ds-card-head" :style="{ background: PAGES[5].tintBg, color: PAGES[5].tint }">
              <span class="ds-card-bar" :style="{ background: PAGES[5].tint }" />
              <span class="ds-card-title">体重</span>
              <button class="ds-info" type="button" aria-label="说明" @click="openInfo('weight')">
                <Icon name="Info" :size="18" />
              </button>
            </header>
            <div class="ds-card-body">
              <div class="ds-num-field">
                <input
                  v-model="weightText"
                  class="ds-num-input"
                  type="number"
                  inputmode="decimal"
                  step="0.1"
                  min="20"
                  max="300"
                  placeholder="55.2"
                  @blur="commitWeight"
                  @keyup.enter="($event.target as HTMLInputElement).blur()"
                >
                <span class="ds-num-unit">kg</span>
              </div>
              <button
                v-if="lastWeight != null"
                class="ds-reuse"
                type="button"
                @click="draft.weight = lastWeight"
              >
                沿用上次 {{ lastWeightText }} kg
              </button>
              <p class="ds-foot-hint">黄体期体重上升 0.5–2 kg 属正常波动。</p>
            </div>
          </section>
        </van-swipe-item>

        <!-- ---------- 7 / 9 分泌物 ---------- -->
        <van-swipe-item>
          <section class="ds-card">
            <header class="ds-card-head" :style="{ background: PAGES[6].tintBg, color: PAGES[6].tint }">
              <span class="ds-card-bar" :style="{ background: PAGES[6].tint }" />
              <span class="ds-card-title">分泌物</span>
              <button class="ds-info" type="button" aria-label="说明" @click="openInfo('discharge')">
                <Icon name="Info" :size="18" />
              </button>
            </header>
            <div class="ds-card-body">
              <div
                v-for="o in PERIOD_DISCHARGE_OPTIONS"
                :key="o.value"
                class="ds-row"
                @click="draft.discharge = draft.discharge === o.value ? 0 : o.value"
              >
                <span class="ds-row-label">
                  {{ o.label }}
                  <span class="ds-row-hint">{{ o.desc }}</span>
                </span>
                <span class="ds-radio" :class="{ 'is-on': draft.discharge === o.value }">
                  <Icon v-if="draft.discharge === o.value" name="Check" :size="14" />
                </span>
              </div>
            </div>
          </section>
        </van-swipe-item>

        <!-- ---------- 8 / 9 性生活 ---------- -->
        <van-swipe-item>
          <section class="ds-card">
            <header class="ds-card-head" :style="{ background: PAGES[7].tintBg, color: PAGES[7].tint }">
              <span class="ds-card-bar" :style="{ background: PAGES[7].tint }" />
              <span class="ds-card-title">性生活</span>
              <button class="ds-info" type="button" aria-label="说明" @click="openInfo('intercourse')">
                <Icon name="Info" :size="18" />
              </button>
            </header>
            <div class="ds-card-body">
              <div class="ds-row" @click="draft.intercourse = 0">
                <span class="ds-row-label">无记录</span>
                <span class="ds-radio" :class="{ 'is-on': draft.intercourse === 0 }">
                  <Icon v-if="draft.intercourse === 0" name="Check" :size="14" />
                </span>
              </div>
              <div
                v-for="o in PERIOD_INTERCOURSE_OPTIONS"
                :key="o.value"
                class="ds-row"
                @click="draft.intercourse = o.value"
              >
                <span class="ds-row-label">{{ o.label }}</span>
                <span class="ds-radio" :class="{ 'is-on': draft.intercourse === o.value }">
                  <Icon v-if="draft.intercourse === o.value" name="Check" :size="14" />
                </span>
              </div>
            </div>
          </section>
        </van-swipe-item>

        <!-- ---------- 9 / 9 其他记录 ---------- -->
        <van-swipe-item>
          <section class="ds-card">
            <header class="ds-card-head" :style="{ background: PAGES[8].tintBg, color: PAGES[8].tint }">
              <span class="ds-card-bar" :style="{ background: PAGES[8].tint }" />
              <span class="ds-card-title">其他记录</span>
              <button class="ds-info" type="button" aria-label="说明" @click="openInfo('other')">
                <Icon name="Info" :size="18" />
              </button>
            </header>
            <div class="ds-card-body">
              <div class="ds-row" @click="setSpotting(!spotting)">
                <span class="ds-row-label">
                  有点滴出血
                  <span class="ds-row-hint">量少到只需护垫</span>
                </span>
                <span class="ds-radio" :class="{ 'is-on': spotting }">
                  <Icon v-if="spotting" name="Check" :size="14" />
                </span>
              </div>

              <div class="ds-group-title">备注</div>
              <div class="ds-note">
                <textarea
                  v-model="draft.note"
                  class="ds-note-input"
                  rows="3"
                  :maxlength="NOTE_MAX"
                  placeholder="想记点什么？（选填）"
                />
                <span class="ds-note-count">{{ noteCount }}/{{ NOTE_MAX }}</span>
              </div>
            </div>
          </section>
        </van-swipe-item>
      </van-swipe>

      <!-- ==================== 底部 ==================== -->
      <footer class="ds-foot">
        <span class="ds-page">{{ page + 1 }} / 9</span>
        <button class="ds-submit" type="button" :disabled="store.saving" @click="onSubmit">
          {{ store.saving ? '保存中…' : '完成' }}
        </button>
        <span v-if="goalLabel" class="ds-goal">目标：{{ goalLabel }}</span>
      </footer>
    </div>

    <!-- 维度说明弹层（同样必须 teleport：父级 .van-popup 自身是
         `overflow-y:auto` 的滚动容器，嵌套弹层在 iOS 上会被同一类合成层问题困住） -->
    <van-popup v-model:show="infoShow" position="bottom" round teleport="body" class="ds-info-pop">
      <div class="ds-info-body">
        <h4 class="ds-info-title">{{ PAGES.find((p) => p.key === infoKey)?.title }}</h4>
        <p class="ds-info-text">{{ DIMENSION_INFO[infoKey] }}</p>
        <button class="ds-info-ok" type="button" @click="infoShow = false">知道了</button>
      </div>
    </van-popup>
  </van-popup>
</template>

<style lang="scss" scoped>
.day-sheet {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--color-bg-app);
}

/* ==================== 头部 ==================== */
.ds-head {
  flex-shrink: 0;
  padding: 8px var(--space-4) 4px;
}
.ds-head-row {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 36px;
}
.ds-grab {
  position: absolute;
  top: -4px;
  left: 50%;
  transform: translateX(-50%);
  width: 36px;
  height: 4px;
  border-radius: var(--radius-pill);
  background: var(--color-border-strong);
}
.ds-date {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.ds-date-nav {
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  background: transparent;
  padding: 0;
  font-size: var(--fs-h3);
  line-height: 1;
  color: var(--color-text-secondary);
  border-radius: var(--radius-base);

  &:active { background: var(--color-bg-hover); }
}
.ds-date-text {
  font-size: var(--fs-h4);
  font-weight: 600;
  color: var(--color-text-primary);
  font-variant-numeric: tabular-nums;
}
.ds-close {
  position: absolute;
  right: 0;
  width: 32px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  background: transparent;
  padding: 0;
  color: var(--color-text-tertiary);
  border-radius: var(--radius-base);

  :deep(svg) { display: block; }
  &:active { background: var(--color-bg-hover); }
}
.ds-hint {
  margin: 2px 0 0;
  text-align: center;
  font-size: var(--fs-caption-sm);
  color: var(--color-text-tertiary);
}

/* ==================== 分页 ==================== */
.ds-loading {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--fs-caption);
  color: var(--color-text-tertiary);
}
.ds-swipe {
  flex: 1;
  min-height: 0;

  /* 卡片两侧露出 16px，让用户知道能滑 */
  :deep(.van-swipe__track) { height: 100%; }
  :deep(.van-swipe-item) {
    padding: 0 var(--space-4);
    box-sizing: border-box;
    height: 100%;
  }
}

/* ==================== 卡片 ==================== */
.ds-card {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--color-bg-card);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-xs);
  overflow: hidden;
  /* 外层 swipe 只吃横向手势，卡片内的纵向滚动不被误判成翻页 */
  touch-action: pan-y;
}
.ds-card-head {
  flex-shrink: 0;
  position: relative;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;

  .ds-card-bar {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 3px;
  }
}
.ds-card-title {
  font-size: var(--fs-h4);
  font-weight: 600;
}
.ds-info {
  position: absolute;
  right: 8px;
  width: 32px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  background: transparent;
  padding: 0;
  color: currentColor;
  opacity: 0.75;
  border-radius: var(--radius-base);

  :deep(svg) { display: block; }
}
.ds-card-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
  padding: 0 var(--space-4) var(--space-4);
}

/* ==================== 行 / 单选 ==================== */
.ds-lead {
  margin: var(--space-3) 0 0;
  font-size: var(--fs-caption-sm);
  color: var(--color-text-secondary);
}
.ds-group-title {
  padding: var(--space-3) 0 4px;
  font-size: var(--fs-caption-sm);
  color: var(--color-text-tertiary);
}
.ds-row {
  min-height: 52px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  border-bottom: 1px solid var(--color-border-light);
  -webkit-tap-highlight-color: transparent;

  &:last-child { border-bottom: 0; }
  &:active { background: var(--color-bg-hover); }
}
.ds-row-label {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: var(--fs-body);
  color: var(--color-text-primary);
}
.ds-row-with-icon {
  flex-direction: row;
  align-items: center;
  gap: 8px;
}
.ds-row-hint {
  font-size: var(--fs-caption-sm);
  color: var(--color-text-tertiary);
}
.ds-radio {
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 1.5px solid var(--color-border-strong);
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #FFFFFF;

  &.is-on {
    background: var(--color-primary);
    border-color: var(--color-primary);
  }
  :deep(svg) { display: block; }
}

/* ==================== 5 级疼痛 ==================== */
.ds-scale {
  display: flex;
  gap: 8px;
  padding: 4px 0 var(--space-2);
}
.ds-scale-btn {
  flex: 1;
  height: 40px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-base);
  background: var(--color-bg-card);
  font-size: var(--fs-body-sm);
  font-family: var(--font-num);
  color: var(--color-text-secondary);

  &.is-on {
    border-color: var(--color-accent);
    background: var(--tint-accent-bg);
    color: var(--tint-accent-fg);
    font-weight: 600;
  }
}

/* ==================== 分段 / 步进 ==================== */
.ds-segment {
  display: flex;
  gap: 8px;
  padding: 4px 0 var(--space-2);
}
.ds-segment-btn {
  flex: 1;
  height: 40px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-base);
  background: var(--color-bg-card);
  font-size: var(--fs-caption);
  color: var(--color-text-secondary);

  &.is-on {
    border-color: var(--color-primary);
    background: var(--color-primary-light);
    color: var(--color-primary);
    font-weight: 600;
  }
}
.ds-stepper {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: 4px 0 var(--space-2);
}
.ds-step-btn {
  width: 40px;
  height: 40px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-base);
  background: var(--color-bg-card);
  font-size: var(--fs-h4);
  color: var(--color-text-primary);
  line-height: 1;

  &:active { background: var(--color-bg-hover); }
}
.ds-step-value {
  flex: 1;
  text-align: center;
  font-size: var(--fs-body-sm);
  font-family: var(--font-num);
  color: var(--color-text-primary);
}

/* ==================== 数字输入 ==================== */
.ds-num-field {
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin-top: var(--space-4);
  padding-bottom: 10px;
  border-bottom: 2px solid var(--color-border-light);
}
.ds-num-input {
  flex: 1;
  min-width: 0;
  border: 0;
  background: transparent;
  outline: none;
  font-size: var(--fs-metric-lg);
  font-weight: 600;
  font-family: var(--font-num);
  font-variant-numeric: tabular-nums;
  color: var(--color-text-primary);

  &::placeholder { color: var(--color-text-placeholder); }
}
.ds-num-unit {
  flex-shrink: 0;
  font-size: var(--fs-caption);
  color: var(--color-text-tertiary);
}
.ds-reuse {
  margin-top: var(--space-3);
  padding: 7px 12px;
  border: 0;
  border-radius: var(--radius-pill);
  background: var(--color-bg-hover);
  font-size: var(--fs-caption-sm);
  color: var(--color-text-secondary);

  &:active { opacity: 0.8; }
}

/* ==================== 备注 ==================== */
.ds-note {
  position: relative;
}
.ds-note-input {
  width: 100%;
  box-sizing: border-box;
  padding: 10px 12px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-base);
  background: var(--color-bg-hover);
  font-size: var(--fs-body-sm);
  font-family: inherit;
  color: var(--color-text-primary);
  resize: none;
  outline: none;

  &::placeholder { color: var(--color-text-placeholder); }
  &:focus { border-color: var(--color-primary); }
}
.ds-note-count {
  position: absolute;
  right: 10px;
  bottom: 8px;
  font-size: var(--fs-micro);
  font-family: var(--font-num);
  color: var(--color-text-tertiary);
}
.ds-foot-hint {
  margin: var(--space-2) 0 0;
  font-size: var(--fs-caption-sm);
  color: var(--color-text-tertiary);
  line-height: 1.5;
}

/* ==================== 底部 ==================== */
.ds-foot {
  flex-shrink: 0;
  padding: var(--space-2) var(--space-4) calc(var(--space-3) + env(safe-area-inset-bottom, 0px));
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}
.ds-page {
  font-size: var(--fs-caption-sm);
  color: var(--color-text-tertiary);
  font-variant-numeric: tabular-nums;
}
.ds-submit {
  width: 100%;
  height: 48px;
  border: 0;
  border-radius: var(--radius-pill);
  background: var(--color-primary);
  color: #FFFFFF;
  font-size: var(--fs-body);
  font-weight: 600;
  box-shadow: var(--shadow-button);

  &:active:not(:disabled) { background: var(--color-primary-dark); }
  &:disabled { opacity: 0.6; }
}
.ds-goal {
  font-size: var(--fs-micro);
  color: var(--color-text-tertiary);
}

/* ==================== 说明弹层 ==================== */
.ds-info-pop {
  padding: var(--space-5) var(--space-5) calc(var(--space-5) + env(safe-area-inset-bottom, 0px));
}
.ds-info-title {
  margin: 0 0 var(--space-2);
  font-size: var(--fs-h4);
  font-weight: 600;
  color: var(--color-text-primary);
}
.ds-info-text {
  margin: 0;
  font-size: var(--fs-body-sm);
  line-height: 1.6;
  color: var(--color-text-secondary);
}
.ds-info-ok {
  width: 100%;
  height: 44px;
  margin-top: var(--space-4);
  border: 0;
  border-radius: var(--radius-lg);
  background: var(--color-primary-light);
  color: var(--color-primary);
  font-size: var(--fs-body-sm);
  font-weight: 600;
}
</style>
