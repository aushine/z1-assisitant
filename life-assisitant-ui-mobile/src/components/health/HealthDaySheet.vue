<script setup lang="ts">
/**
 * 健康记录浮层（移动端）
 *
 * SYNC-FROM: src/components/period/PeriodDaySheet.vue（复用结构与交互）
 * SYNC-FROM-BACKEND: life-assisitant-api/internal/model/dto/health.go（HealthDayDetail / UpsertHealthDayReq）
 * 契约文档：md/spec-20260919-v1/04-页面与交互设计.md
 *
 * 与经期浮层的差异：
 *   1. 分页**按 settings.metrics_enabled 动态组装**（最多 11 页），而不是固定 9 页。
 *   2. 数据形状是 HealthDayDetail：经期相关字段落在 `period` 子块，心情落在 `moods` 子块，
 *      体重/体温/睡眠/饮水/排便/备注是顶层标量。
 *   3. 整体提交仍走 store.saveDay（取回→合并→整体提交），保证「只改饮水不抹其它指标」。
 *
 * 空提交（全空点「完成」）→ 视为删除该日记录，仅在该日原本已有记录时弹二次确认。
 */
import { computed, ref, watch } from 'vue'
import { showConfirmDialog, showFailToast } from 'vant'
import Icon from '@/components/icon/Icon.vue'
import HealthEventList from '@/components/health/HealthEventList.vue'
import { useHealthStore } from '@/stores/health'
import { MOOD_LEVELS, ENERGY_LEVELS } from '@/utils/mood-dict'
import { formatMonthDayWeekday, todayDate } from '@/utils/date'
import {
  BOWEL_TYPE_OPTIONS,
  DEFAULT_WATER_GOAL_ML,
  HEALTH_METRICS,
  normalizeWaterStep,
  waterQuickOptions,
} from '@/constants/health'
import {
  PERIOD_DEFAULT_RECENT_SYMPTOMS,
  PERIOD_DISCHARGE_OPTIONS,
  PERIOD_INTERCOURSE_OPTIONS,
  PERIOD_SYMPTOM_GROUPS,
  periodSymptomLabel,
} from '@/constants/period'
import type { HealthDayDetail } from '@/api/types'

const props = defineProps<{
  show: boolean
  /** 记录哪一天（YYYY-MM-DD） */
  date: string
  /** 打开时定位到第几页（0-based） */
  initialPage?: number
  /**
   * 打开时直达某个指标那一页（按 key 而非数字索引，启用项变动时索引会错位）。
   * 与 initialPage 并存、**优先 metricKey**（02 §16.4）。
   */
  metricKey?: string
}>()

const emit = defineEmits<{
  (e: 'update:show', v: boolean): void
  (e: 'saved', date: string): void
}>()

// 经期词库来自 @/constants/period（唯一真源，不复制第二份）
const SYMPTOM_GROUPS = PERIOD_SYMPTOM_GROUPS
const symptomLabel = periodSymptomLabel

const store = useHealthStore()

/** 每个指标 → 页面元信息（标题 + 配色，与经期浮层同套令牌） */
const METRIC_PAGES: Record<string, { title: string; tint: string; tintBg: string }> = {
  period: { title: '经期', tint: 'var(--color-period)', tintBg: 'var(--color-period-soft)' },
  symptoms: { title: '症状', tint: 'var(--color-accent)', tintBg: 'var(--tint-accent-bg)' },
  mood: { title: '心情', tint: 'var(--color-warning)', tintBg: 'var(--tint-warning-bg)' },
  energy_sleep: { title: '精力 · 睡眠', tint: 'var(--color-info-dark)', tintBg: 'var(--color-info-light)' },
  bbt: { title: '基础体温', tint: 'var(--color-primary)', tintBg: 'var(--tint-primary-bg)' },
  weight: { title: '体重', tint: 'var(--color-success)', tintBg: 'var(--tint-success-bg)' },
  water: { title: '饮水', tint: 'var(--color-info)', tintBg: 'var(--color-info-light)' },
  bowel: { title: '排便', tint: 'var(--color-text-secondary)', tintBg: 'var(--color-bg-hover)' },
  discharge: { title: '分泌物', tint: 'var(--color-accent)', tintBg: 'var(--tint-accent-bg)' },
  sex: { title: '性生活', tint: 'var(--color-danger)', tintBg: 'var(--tint-danger-bg)' },
  note: { title: '备注', tint: 'var(--color-text-secondary)', tintBg: 'var(--color-bg-hover)' },
}

/** 按 HEALTH_METRICS 顺序过滤出已启用的分页 */
const pages = computed(() =>
  HEALTH_METRICS.filter((m) => store.enabledMetrics.includes(m.key)).map((m) => ({
    key: m.key,
    title: METRIC_PAGES[m.key]?.title ?? m.name,
    tint: METRIC_PAGES[m.key]?.tint ?? 'var(--color-text-secondary)',
    tintBg: METRIC_PAGES[m.key]?.tintBg ?? 'var(--color-bg-hover)',
  })),
)

/** 各维度 ⓘ 说明（文案逐字与产品稿一致） */
const DIMENSION_INFO: Record<string, string> = {
  period: '记录每天的实际出血情况。经量会随时间变化，连续记录能看出这个月偏多还是偏少。',
  symptoms: '身体的不适同样值得留档。记录 2–3 个周期后，你就能看到「哪些症状总在经前出现」。',
  mood: '心情与激素水平相关，黄体期出现情绪波动是常见现象，记录下来能帮你提前做心理准备。',
  energy_sleep: '卵泡期精力通常较好，黄体期容易疲惫；睡眠时长则影响第二天的状态。',
  bbt: '基础体温需要在早晨醒来、未起床、未进食时测量。排卵后体温会升高 0.2–0.5℃ 并维持到下次经期。',
  weight: '黄体期因水钠潴留，体重上升 0.5–2kg 属正常波动，不必因此焦虑。',
  water: '充足饮水有助于代谢。设一个适合你的目标，每天看一眼进度就好。',
  bowel: '排便形态与频率是肠道健康最直接的信号，4 档足够日常记录，不必追求临床精确。',
  discharge: '分泌物随周期变化：接近排卵时会变得清亮、可拉丝，这是生育力最高的信号。',
  sex: '仅供你自己参考。数据默认不显示在首页或统计中。',
  note: '想记点什么都可以，自由书写，作为当天的补充备注。',
}

/* ==================== 草稿 ==================== */

/**
 * ⚠️ 2026-09-19 起身体指标（water / bbt / weight / sleep / bowel）**不在草稿里**：
 *    它们改走 health_events 时间轴（一天多次、不延续），点选即落库（store.addEvent）。
 *    草稿只留「一天一张」的两块：period（经期）与 moods（心情 / 精力 / 备注）。
 */
interface Draft {
  period: { flow: number; symptoms: string[]; pain_level: number; discharge: number; intercourse: number }
  moods: { mood: number; energy: number; note: string }
}

function emptyDay(): Draft {
  return {
    period: { flow: 0, symptoms: [], pain_level: 0, discharge: 0, intercourse: 0 },
    moods: { mood: 0, energy: 0, note: '' },
  }
}

const curDate = ref(props.date || todayDate())
const draft = ref<Draft>(emptyDay())
const hadRecord = ref(false)
const recentSymptoms = ref<string[]>([])
const loading = ref(false)
const page = ref(0)
const swipeRef = ref<{ swipeTo: (i: number, opts?: Record<string, unknown>) => void } | null>(null)

const isBackfill = computed(() => curDate.value < todayDate())

/** 饮水目标（用于饮水页进度条） */
const waterGoal = computed(() => store.settings?.water_goal_ml || DEFAULT_WATER_GOAL_ML)
/** 「一杯」多大（快捷档由此推导，不写死 —— 每个用户的杯子不一样） */
const waterStep = computed(() => normalizeWaterStep(store.settings?.water_step_ml ?? 0))
const waterQuick = computed(() => waterQuickOptions(waterStep.value))

/** 排便形态：value → 标签（时间轴上要把 1/2/3/4 显示成人话） */
const bowelTypeLabel = computed<Record<number, string>>(() => {
  const map: Record<number, string> = {}
  for (const o of BOWEL_TYPE_OPTIONS) map[o.value] = o.label
  return map
})

/* ==================== 数字输入（体温 / 体重 / 睡眠） ====================
 * ⚠️ 这些不再是「一天一个值」，而是**新增一次事件**的输入框：
 *    填完点「记录此刻」→ 追加一条带时间点的事件。当天已有值只作参考占位。 */

const bbtText = ref('')
const weightText = ref('')
const sleepText = ref('')

/** 当天已记过的代表值（体温取最早一次，体重/睡眠取最后一次 —— 后端聚合口径） */
const bbtLatest = computed(() => store.daySummary?.bbt ?? null)
const weightLatest = computed(() => store.daySummary?.weight_kg ?? null)
const sleepLatest = computed(() => store.daySummary?.sleep_hours ?? null)

watch(
  bbtLatest,
  (v) => {
    bbtText.value = v == null ? '' : v.toFixed(2)
  },
  { immediate: true },
)
watch(
  weightLatest,
  (v) => {
    weightText.value = v == null ? '' : v.toFixed(1)
  },
  { immediate: true },
)
watch(
  sleepLatest,
  (v) => {
    sleepText.value = v == null ? '' : String(v)
  },
  { immediate: true },
)

/** 解析并校验，返回 null = 不合法（不清空输入框，让用户自己改） */
function parseNum(text: string, min: number, max: number, digits: number): number | null {
  const raw = text.trim()
  if (!raw) return null
  const n = Number(raw)
  if (!Number.isFinite(n) || n < min || n > max) return null
  const p = 10 ** digits
  return Math.round(n * p) / p
}

/** 追加一条事件（时间由服务端给 —— 前端不自己算 now） */
async function pushEvent(
  metricKey: 'water' | 'bbt' | 'weight' | 'sleep' | 'bowel',
  valueNum?: number,
  valueInt?: number,
): Promise<void> {
  await store.addEvent({
    date: curDate.value,
    metric_key: metricKey,
    ...(valueNum !== undefined ? { value_num: valueNum } : {}),
    ...(valueInt !== undefined ? { value_int: valueInt } : {}),
  })
}

async function addWaterEvent(delta: number): Promise<void> {
  await pushEvent('water', delta)
}

async function addBbtEvent(): Promise<void> {
  const v = parseNum(bbtText.value, 34, 42, 2)
  if (v == null) {
    showFailToast('体温需在 34–42℃ 之间')
    return
  }
  await pushEvent('bbt', v)
}

async function addWeightEvent(): Promise<void> {
  const v = parseNum(weightText.value, 20, 300, 1)
  if (v == null) {
    showFailToast('体重需在 20–300kg 之间')
    return
  }
  await pushEvent('weight', v)
}

async function addSleepEvent(): Promise<void> {
  const v = parseNum(sleepText.value, 0, 24, 1)
  if (v == null) {
    showFailToast('睡眠需在 0–24 小时之间')
    return
  }
  await pushEvent('sleep', v)
}

async function addBowelEvent(typeValue: number): Promise<void> {
  await pushEvent('bowel', undefined, typeValue)
}

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
    draft.value = day
      ? {
          period: {
            flow: day.period.flow,
            symptoms: [...day.period.symptoms],
            pain_level: day.period.pain_level,
            discharge: day.period.discharge,
            intercourse: day.period.intercourse,
          },
          moods: {
            mood: day.moods.mood ?? 0,
            energy: day.moods.energy ?? 0,
            note: day.moods.note ?? '',
          },
        }
      : emptyDay()
    // 身体指标的真源是 events，与日详情一并拉（时间轴 UI 要用）
    await store.fetchDayEvents(date)
  } finally {
    loading.value = false
  }
}

/** metricKey 优先，否则 initialPage，再否则 0（02 §16.4） */
function resolveInitialPage(): number {
  if (props.metricKey) {
    const idx = pages.value.findIndex((p) => p.key === props.metricKey)
    if (idx >= 0) return idx
  }
  return props.initialPage ?? 0
}

watch(
  () => props.show,
  (v) => {
    if (!v) return
    curDate.value = props.date || todayDate()
    page.value = resolveInitialPage()
    void load(curDate.value).then(() => {
      swipeRef.value?.swipeTo(page.value, { immediate: true })
    })
  },
)

/** 浮层已开时，外部改 metricKey 直接跳页（优先于 current page） */
watch(
  () => props.metricKey,
  (k) => {
    if (!props.show || !k) return
    const idx = pages.value.findIndex((p) => p.key === k)
    if (idx >= 0) {
      page.value = idx
      swipeRef.value?.swipeTo(idx, { immediate: true })
    }
  },
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

/* ==================== 各维度编辑 ==================== */

const symptomGroups = computed(() => [
  {
    key: 'RECENT' as const,
    label: '近期症状',
    items: recentSymptoms.value.map((k) => ({ key: k, label: symptomLabel(k) })),
  },
  ...SYMPTOM_GROUPS,
])

function toggleSymptom(key: string): void {
  const list = draft.value.period.symptoms
  const i = list.indexOf(key)
  if (i >= 0) list.splice(i, 1)
  else list.push(key)
}

function setFlow(v: number): void {
  draft.value.period.flow = draft.value.period.flow === v ? 0 : v
}

function pickMood(v: number): void {
  draft.value.moods.mood = draft.value.moods.mood === v ? 0 : v
}
function pickEnergy(v: number): void {
  draft.value.moods.energy = draft.value.moods.energy === v ? 0 : v
}
const NOTE_MAX = 50
const noteCount = computed(() => draft.value.moods.note.length)

/* ==================== 提交 ==================== */

/** 当天饮水总量（events 聚合，用于进度条；不是草稿值） */
const waterTotal = computed(() => store.daySummary?.water_ml ?? 0)

const isEmpty = computed(() => {
  const d = draft.value
  return (
    d.period.flow === 0 &&
    d.period.symptoms.length === 0 &&
    d.period.pain_level === 0 &&
    d.period.discharge === 0 &&
    d.period.intercourse === 0 &&
    d.moods.mood === 0 &&
    d.moods.energy === 0 &&
    !d.moods.note.trim() &&
    // 还有 events 就不算空 —— 否则「点完成」会把时间轴上的记录全删掉
    (store.dayEvents?.length ?? 0) === 0
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

  const payload: HealthDayDetail = {
    date,
    water_ml: store.daySummary?.water_ml ?? 0,
    weight_kg: store.daySummary?.weight_kg ?? null,
    bbt: store.daySummary?.bbt ?? null,
    sleep_hours: store.daySummary?.sleep_hours ?? null,
    bowel_count: store.daySummary?.bowel_times ?? 0,
    bowel_type: store.daySummary?.bowel_types?.length
      ? store.daySummary.bowel_types[store.daySummary.bowel_types.length - 1]
      : 0,
    period: { ...draft.value.period },
    moods: {
      mood: draft.value.moods.mood,
      energy: draft.value.moods.energy,
      note: draft.value.moods.note.trim().slice(0, NOTE_MAX),
    },
  }
  const ok = await store.saveDay(date, payload)
  if (ok) {
    emit('saved', date)
    close()
  }
}

/* ==================== ⓘ 弹层 ==================== */
const infoKey = ref('')
const infoShow = ref(false)
function openInfo(key: string): void {
  infoKey.value = key
  infoShow.value = true
}

defineExpose({ load })
</script>

<template>
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

      <!-- ==================== 分页 ==================== -->
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
        <van-swipe-item v-for="p in pages" :key="p.key">
          <section class="ds-card">
            <header class="ds-card-head" :style="{ background: p.tintBg, color: p.tint }">
              <span class="ds-card-bar" :style="{ background: p.tint }" />
              <span class="ds-card-title">{{ p.title }}</span>
              <button class="ds-info" type="button" aria-label="说明" @click="openInfo(p.key)">
                <Icon name="Info" :size="18" />
              </button>
            </header>
            <div class="ds-card-body">
              <!-- ---------- 经期 ---------- -->
              <template v-if="p.key === 'period'">
                <div class="ds-group-title">经量</div>
                <div
                  v-for="lv in [{v:0,l:'未出血'},{v:1,l:'点滴出血'},{v:2,l:'量少'},{v:3,l:'中等'},{v:4,l:'量多'}]"
                  :key="lv.v"
                  class="ds-row"
                  @click="setFlow(lv.v)"
                >
                  <span class="ds-row-label">{{ lv.l }}</span>
                  <span class="ds-radio" :class="{ 'is-on': draft.period.flow === lv.v }">
                    <Icon v-if="draft.period.flow === lv.v" name="Check" :size="14" />
                  </span>
                </div>
              </template>

              <!-- ---------- 症状 ---------- -->
              <template v-else-if="p.key === 'symptoms'">
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
                    <span class="ds-radio" :class="{ 'is-on': draft.period.symptoms.includes(it.key) }">
                      <Icon v-if="draft.period.symptoms.includes(it.key)" name="Check" :size="14" />
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
                    :class="{ 'is-on': draft.period.pain_level === n }"
                    @click="draft.period.pain_level = draft.period.pain_level === n ? 0 : n"
                  >
                    {{ n }}
                  </button>
                </div>
              </template>

              <!-- ---------- 心情 ---------- -->
              <template v-else-if="p.key === 'mood'">
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
                  <span class="ds-radio" :class="{ 'is-on': draft.moods.mood === m.value }">
                    <Icon v-if="draft.moods.mood === m.value" name="Check" :size="14" />
                  </span>
                </div>
                <p class="ds-foot-hint">再点一次可取消选择</p>
              </template>

              <!-- ---------- 精力 · 睡眠 ---------- -->
              <template v-else-if="p.key === 'energy_sleep'">
                <div class="ds-group-title">精力</div>
                <div class="ds-segment">
                  <button
                    v-for="e in ENERGY_LEVELS"
                    :key="e.value"
                    type="button"
                    class="ds-segment-btn"
                    :class="{ 'is-on': draft.moods.energy === e.value }"
                    @click="pickEnergy(e.value)"
                  >
                    {{ e.label }}
                  </button>
                </div>
                <div class="ds-group-title">睡眠时长（记一次）</div>
                <div class="ds-num-field">
                  <input
                    v-model="sleepText"
                    class="ds-num-input"
                    type="number"
                    inputmode="decimal"
                    step="0.5"
                    min="0"
                    max="24"
                    placeholder="7.5"
                  >
                  <span class="ds-num-unit">小时</span>
                </div>
                <div class="ds-stepper ds-stepper-quick">
                  <button
                    class="ds-step-btn is-quick"
                    type="button"
                    :disabled="store.saving"
                    @click="addSleepEvent"
                  >
                    记录此刻
                  </button>
                </div>
                <p class="ds-foot-hint">0–24 小时；一天可记多次（如午睡另记一条）。</p>
                <HealthEventList metric="sleep" :date="curDate" unit="h" :digits="1" empty-text="今天还没记睡眠" />
              </template>

              <!-- ---------- 基础体温 ---------- -->
              <template v-else-if="p.key === 'bbt'">
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
                  >
                  <span class="ds-num-unit">℃</span>
                </div>
                <div class="ds-stepper ds-stepper-quick">
                  <button
                    class="ds-step-btn is-quick"
                    type="button"
                    :disabled="store.saving"
                    @click="addBbtEvent"
                  >
                    记录此刻
                  </button>
                </div>
                <p class="ds-foot-hint">早晨醒来未起床时测量最准确；一天可记多次。</p>
                <HealthEventList metric="bbt" :date="curDate" unit="℃" :digits="2" empty-text="今天还没记体温" />
              </template>

              <!-- ---------- 体重 ---------- -->
              <template v-else-if="p.key === 'weight'">
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
                  >
                  <span class="ds-num-unit">kg</span>
                </div>
                <div class="ds-stepper ds-stepper-quick">
                  <button
                    class="ds-step-btn is-quick"
                    type="button"
                    :disabled="store.saving"
                    @click="addWeightEvent"
                  >
                    记录此刻
                  </button>
                </div>
                <p class="ds-foot-hint">黄体期体重上升 0.5–2kg 属正常波动；一天可记多次。</p>
                <HealthEventList metric="weight" :date="curDate" unit="kg" :digits="1" empty-text="今天还没记体重" />
              </template>

              <!-- ---------- 饮水 ---------- -->
              <template v-else-if="p.key === 'water'">
                <div class="ds-num-field">
                  <span class="ds-num-big">{{ waterTotal }}</span>
                  <span class="ds-num-unit">ml</span>
                </div>
                <!-- 喝一杯记一杯：快捷档 = 一杯 / 两杯，容量在设置里改 -->
                <div class="ds-stepper ds-stepper-quick">
                  <button
                    v-for="o in waterQuick"
                    :key="o.cups"
                    class="ds-step-btn is-quick"
                    type="button"
                    :disabled="store.saving"
                    @click="addWaterEvent(o.ml)"
                  >
                    {{ o.label }}
                  </button>
                </div>
                <div class="ds-stepper">
                  <button
                    class="ds-step-btn"
                    type="button"
                    aria-label="记错了，减一杯"
                    :disabled="store.saving"
                    @click="addWaterEvent(-waterStep)"
                  >
                    −{{ waterStep }}
                  </button>
                  <button
                    class="ds-step-btn"
                    type="button"
                    aria-label="加一杯"
                    :disabled="store.saving"
                    @click="addWaterEvent(waterStep)"
                  >
                    ＋{{ waterStep }}
                  </button>
                </div>
                <p class="ds-foot-hint">目标 {{ waterGoal }}ml · 一杯 {{ waterStep }}ml（设置里可改）</p>
                <div class="ds-meter">
                  <span
                    class="ds-meter-fill"
                    :style="{ width: Math.min(100, Math.round((waterTotal / waterGoal) * 100)) + '%' }"
                  />
                </div>
                <HealthEventList metric="water" :date="curDate" unit="ml" empty-text="今天还没记饮水" />
              </template>

              <!-- ---------- 排便 ---------- -->
              <template v-else-if="p.key === 'bowel'">
                <div class="ds-group-title">记一次（选形态）</div>
                <div
                  v-for="o in BOWEL_TYPE_OPTIONS"
                  :key="o.value"
                  class="ds-row"
                  :class="{ 'is-disabled': store.saving }"
                  @click="addBowelEvent(o.value)"
                >
                  <span class="ds-row-label">
                    {{ o.label }}
                    <span class="ds-row-hint">{{ o.desc }}</span>
                  </span>
                  <span class="ds-row-add" aria-hidden="true">
                    <Icon name="Plus" :size="14" />
                  </span>
                </div>
                <p class="ds-foot-hint">
                  上午腹泻、下午正常 → 就记两条，各自带时间。
                </p>
                <HealthEventList
                  metric="bowel"
                  :date="curDate"
                  :int-label="bowelTypeLabel"
                  empty-text="今天还没记排便"
                />
              </template>

              <!-- ---------- 分泌物 ---------- -->
              <template v-else-if="p.key === 'discharge'">
                <div
                  v-for="o in PERIOD_DISCHARGE_OPTIONS"
                  :key="o.value"
                  class="ds-row"
                  @click="draft.period.discharge = draft.period.discharge === o.value ? 0 : o.value"
                >
                  <span class="ds-row-label">
                    {{ o.label }}
                    <span class="ds-row-hint">{{ o.desc }}</span>
                  </span>
                  <span class="ds-radio" :class="{ 'is-on': draft.period.discharge === o.value }">
                    <Icon v-if="draft.period.discharge === o.value" name="Check" :size="14" />
                  </span>
                </div>
              </template>

              <!-- ---------- 性生活 ---------- -->
              <template v-else-if="p.key === 'sex'">
                <div class="ds-row" @click="draft.period.intercourse = 0">
                  <span class="ds-row-label">无记录</span>
                  <span class="ds-radio" :class="{ 'is-on': draft.period.intercourse === 0 }">
                    <Icon v-if="draft.period.intercourse === 0" name="Check" :size="14" />
                  </span>
                </div>
                <div
                  v-for="o in PERIOD_INTERCOURSE_OPTIONS"
                  :key="o.value"
                  class="ds-row"
                  @click="draft.period.intercourse = o.value"
                >
                  <span class="ds-row-label">{{ o.label }}</span>
                  <span class="ds-radio" :class="{ 'is-on': draft.period.intercourse === o.value }">
                    <Icon v-if="draft.period.intercourse === o.value" name="Check" :size="14" />
                  </span>
                </div>
              </template>

              <!-- ---------- 备注 ---------- -->
              <template v-else-if="p.key === 'note'">
                <div class="ds-note">
                  <textarea
                    v-model="draft.moods.note"
                    class="ds-note-input"
                    rows="4"
                    :maxlength="NOTE_MAX"
                    placeholder="想记点什么？（选填）"
                  />
                  <span class="ds-note-count">{{ noteCount }}/{{ NOTE_MAX }}</span>
                </div>
              </template>
            </div>
          </section>
        </van-swipe-item>
      </van-swipe>

      <!-- ==================== 底部 ==================== -->
      <footer class="ds-foot">
        <span class="ds-page">{{ page + 1 }} / {{ pages.length }}</span>
        <button class="ds-submit" type="button" :disabled="store.saving" @click="onSubmit">
          {{ store.saving ? '保存中…' : '完成' }}
        </button>
      </footer>
    </div>

    <!-- 维度说明弹层（同样 teleport） -->
    <van-popup v-model:show="infoShow" position="bottom" round teleport="body" class="ds-info-pop">
      <div class="ds-info-body">
        <h4 class="ds-info-title">{{ pages.find((p) => p.key === infoKey)?.title }}</h4>
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
/* 快捷档（1 杯 / 2 杯）：文案较长，宽度自适应而不是固定 40px */
.ds-stepper-quick {
  flex-wrap: wrap;
}
.ds-step-btn.is-quick {
  width: auto;
  min-width: 40px;
  height: 36px;
  padding: 0 var(--space-3);
  font-size: var(--fs-body-sm);
  color: var(--color-primary);
  background: var(--tint-primary-bg);
  border-color: transparent;
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

/* ==================== 数字 / 大数 ==================== */
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
.ds-num-big {
  font-size: var(--fs-metric-xl);
  font-weight: 700;
  font-family: var(--font-num);
  font-variant-numeric: tabular-nums;
  color: var(--color-text-primary);
}
.ds-num-unit {
  flex-shrink: 0;
  font-size: var(--fs-caption);
  color: var(--color-text-tertiary);
}
.ds-meter {
  margin-top: var(--space-3);
  height: 6px;
  border-radius: var(--radius-pill);
  background: var(--color-bg-hover);
  overflow: hidden;
}
.ds-meter-fill {
  display: block;
  height: 100%;
  border-radius: var(--radius-pill);
  background: var(--color-info);
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
