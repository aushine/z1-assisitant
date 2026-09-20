<script setup lang="ts">
/**
 * 经期 Tab —— 记录模块第 5 个维度的容器（移动端）
 *
 * SYNC-FROM-DESKTOP: life-assisitant-ui-desktop/src/pages/record/PeriodTab.tsx
 * SYNC-FROM-BACKEND: life-assisitant-api/internal/controller/period.go
 * 契约文档：md/spec-260919/04-页面与交互设计.md（§2 线框 / §4 组件 / §6 状态）
 *
 * 页面结构（滚动容器是父级 .tab-body，本组件**不写 height、不自己滚动**）：
 *   概览卡（或首次引导卡）→ 异常提醒 → 月历 → 今天快捷条 → 最近周期
 *
 * 三条产品红线在这个文件里落地：
 *   1. 首次进入且未确认免责 → 跳 /record/period/setup（04 §7.5）。
 *   2. `confidence === 'insufficient'` → 概览卡一个日期都不显示（在概览卡内收口）。
 *   3. 「今天快捷条」存在的唯一理由：日常高频动作只有一个 ——
 *      今天出血了没有、量多少。让它在一屏内一步完成（04 §2）。
 *
 * 快捷条写库走**整体覆盖**语义（PUT /period/days/:date），所以必须先取回当天
 * 已存在的记录再合并，否则会把当天其它维度（症状/心情/体温…）整页抹掉。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { showConfirmDialog, showToast } from 'vant'
import Icon from '@/components/icon/Icon.vue'
import { usePeriodStore } from '@/stores/period'
import { PERIOD_FLOW_LEVELS, PERIOD_FLOW_MEDIUM } from '@/constants/period'
import { formatMonthDay, todayDate } from '@/utils/date'
import PeriodOverviewCard from './PeriodOverviewCard.vue'
import PeriodCalendar from './PeriodCalendar.vue'
import PeriodHistoryList from './PeriodHistoryList.vue'
import PeriodDaySheet from './PeriodDaySheet.vue'
import type { PeriodCycle, PeriodDayUpsertReq } from '@/api/types'

const router = useRouter()
const store = usePeriodStore()

/** 当前展示月份（YYYY-MM） */
const month = ref((store.today || todayDate()).slice(0, 7))

const calendarDays = computed(() => store.calendarCache[month.value]?.days ?? [])
const prediction = computed(() => store.prediction)
const masked = computed(() => store.masked)
const showFertile = computed(() => (store.settings?.show_fertile_window ?? 1) === 1)

/** 从没记录过 → 用引导卡替换概览卡（04 §6.1） */
const showGuide = computed(() => store.loaded && !store.initialized)

/* ==================== 记录浮层 ==================== */

const sheetShow = ref(false)
const sheetDate = ref(todayDate())
const sheetPage = ref(0)

/** 免责确认过一次就不再弹（后端 disclaimer_accepted_at 为准） */
async function ensureDisclaimer(): Promise<boolean> {
  if (store.disclaimerAccepted) return true
  try {
    await showConfirmDialog({
      title: '关于经期预测',
      message:
        '本功能根据你自己记录的日期推算，属于日历法预测，存在误差：只有约 13% 的人周期正好是 28 天，日历法对排卵日的准确率约 21%，因此「相对安全期」不能作为避孕依据。\n\n预测有助于了解自己的节律，但不能代替医学检查。',
      confirmButtonText: '我知道了',
      cancelButtonText: '取消',
    })
  } catch {
    return false
  }
  // 只写免责时间，不改动其它设置
  const ok = await store.patchSettings({ accept_disclaimer: true })
  return ok
}

async function openSheet(date: string, page = 0): Promise<void> {
  const allowed = await ensureDisclaimer()
  if (!allowed) return
  sheetDate.value = date
  sheetPage.value = page
  sheetShow.value = true
}

/** 供记录页 FAB 调用的「记录今天」 */
function openToday(): void {
  void openSheet(store.today || todayDate(), 0)
}

/* ==================== 快捷条（一步记录）==================== */

/** 用当天已有记录合成一份完整请求（整体覆盖语义，不能只发 flow） */
function mergeToday(patch: Partial<Omit<PeriodDayUpsertReq, 'date'>>): Omit<PeriodDayUpsertReq, 'date'> {
  const d = store.todayLog
  return {
    flow: d?.flow ?? 0,
    symptoms: d ? [...d.symptoms] : [],
    pain_level: d?.pain_level ?? 0,
    discharge: d?.discharge ?? 0,
    bbt: d?.bbt ?? null,
    weight: d?.weight ?? null,
    sleep_hours: d?.sleep_hours ?? null,
    intercourse: d?.intercourse ?? 0,
    mood: d?.mood ?? 0,
    energy: d?.energy ?? 0,
    note: d?.note ?? '',
    ...patch,
  }
}

async function quickSetFlow(v: number): Promise<void> {
  const date = store.today || todayDate()
  // 已是该量级 → 再点一次取消（写回 0）
  const next = store.todayLog?.flow === v ? 0 : v
  const ok = await store.upsertDay(date, mergeToday({ flow: next }))
  if (ok) await refreshCalendar()
}

/** 今日已记的其它维度摘要（快捷条下方一行） */
const todaySummary = computed(() => {
  const d = store.todayLog
  if (!d) return ''
  const parts: string[] = []
  if (d.symptoms.length) parts.push(`症状 ${d.symptoms.length}`)
  if (d.mood) parts.push('心情')
  if (d.bbt != null) parts.push('体温')
  if (d.weight != null) parts.push('体重')
  if (d.note) parts.push('备注')
  return parts.join(' · ')
})

/* ==================== 遮罩 / 说明弹层 ==================== */

let maskToastShown = false
function toggleMask(): void {
  store.toggleMasked()
  if (!maskToastShown && store.masked) {
    maskToastShown = true
    showToast({ message: '已隐藏敏感内容，再点一次恢复', duration: 2000 })
  }
}

const statsShow = ref(false)
const fertileShow = ref(false)
const cyclesShow = ref(false)

/* ==================== 数据加载 ==================== */

async function refreshCalendar(force = false): Promise<void> {
  await store.fetchCalendar(month.value, force)
}

watch(month, () => {
  void refreshCalendar()
})

/** 保存后：周期划分可能变了 → 清缓存并重拉当前月 */
async function onSaved(): Promise<void> {
  store.invalidateCalendar()
  await Promise.all([refreshCalendar(true), store.fetchOverview(), store.fetchCycles(24)])
}

function onCalendarMonth(m: string): void {
  month.value = m
}

/** 长按快捷「设为经期第一天」（写入量中等） */
async function onLongPressDay(date: string): Promise<void> {
  const allowed = await ensureDisclaimer()
  if (!allowed) return
  // 需要先取当天记录再合并（整体覆盖）
  const res = await store.fetchDay(date)
  const d = res?.day ?? null
  const ok = await store.upsertDay(date, {
    flow: PERIOD_FLOW_MEDIUM,
    symptoms: d ? [...d.symptoms] : [],
    pain_level: d?.pain_level ?? 0,
    discharge: d?.discharge ?? 0,
    bbt: d?.bbt ?? null,
    weight: d?.weight ?? null,
    sleep_hours: d?.sleep_hours ?? null,
    intercourse: d?.intercourse ?? 0,
    mood: d?.mood ?? 0,
    energy: d?.energy ?? 0,
    note: d?.note ?? '',
  })
  if (ok) {
    await onSaved()
    showToast({ message: `已记录 ${formatMonthDay(date)} 为经期第一天`, duration: 1800 })
  }
}

function onPickCycle(c: PeriodCycle): void {
  // 跳到该周期所在月份（P1 的「周期详情」另开页面，这里先做定位）
  month.value = c.start_date.slice(0, 7)
}

/* ==================== 生命周期 ==================== */

onMounted(async () => {
  if (!store.loaded) await store.fetchOverview()
  // 未确认免责 → 直接进向导（设计的首次路径）。
  // setupSkipped 是「本次会话已点过先看看」的内存标记：不加这个判断，
  // 用户一跳过就会被再推回向导，永远进不来（见 stores/period.ts 注释）。
  if (store.loaded && !store.disclaimerAccepted && !store.setupSkipped) {
    router.replace('/record/period/setup')
    return
  }
  await Promise.all([refreshCalendar(), store.fetchCycles(24)])
})

/** store 里的 today 到位后校正默认月份（首屏可能先用本地日期兜底） */
watch(
  () => store.today,
  (t) => {
    if (t && !store.calendarMonth) month.value = t.slice(0, 7)
  }
)

defineExpose({ openToday })
</script>

<template>
  <div class="period-tab">
    <!-- ==================== 骨架 ==================== -->
    <div v-if="store.loading && !store.loaded" class="pt-skeleton" />

    <template v-else>
      <!-- ==================== 首次引导卡（04 §6.1）==================== -->
      <section v-if="showGuide" class="pt-guide">
        <h3 class="pt-guide-title">开始记录你的周期</h3>
        <p class="pt-guide-text">记录 1–2 次经期后，就能看到排卵日、易孕期和下次经期预测。</p>
        <button class="pt-guide-btn" type="button" @click="router.push('/record/period/setup')">
          开始记录
        </button>
      </section>

      <!-- ==================== 概览卡 ==================== -->
      <PeriodOverviewCard
        v-else-if="prediction"
        :prediction="prediction"
        :masked="masked"
        :show-fertile="showFertile"
        @toggle-mask="toggleMask"
        @show-info="statsShow = true"
        @go-settings="router.push('/record/period/settings')"
        @show-fertile-info="fertileShow = true"
      />

      <!-- ==================== 异常提醒（04 §6.5）==================== -->
      <details
        v-if="prediction && prediction.alerts.length > 0 && !masked"
        class="pt-alerts"
      >
        <summary class="pt-alerts-summary">
          <Icon name="AlertTriangle" :size="15" class="pt-alerts-ico" />
          <span>{{ prediction.alerts[0].text }}</span>
          <span v-if="prediction.alerts.length > 1" class="pt-alerts-count">
            +{{ prediction.alerts.length - 1 }}
          </span>
        </summary>
        <ul class="pt-alerts-list">
          <li v-for="(a, i) in prediction.alerts" :key="i">{{ a.text }}</li>
        </ul>
        <p class="pt-alerts-foot">
          以上提示基于你的记录数据自动生成，不构成医学诊断。如有不适请咨询专业医生。
        </p>
      </details>

      <!-- ==================== 月历 ==================== -->
      <PeriodCalendar
        :month="month"
        :days="calendarDays"
        :masked="masked"
        :today="store.today || todayDate()"
        @change-month="onCalendarMonth"
        @pick-day="openSheet($event, 0)"
        @longpress-day="onLongPressDay"
      />

      <!-- ==================== 今天快捷条 ==================== -->
      <section class="pt-today">
        <div class="pt-today-head">
          <span class="pt-today-title">今天</span>
          <span v-if="todaySummary" class="pt-today-sum">{{ todaySummary }}</span>
        </div>

        <div class="pt-row">
          <span class="pt-row-label">经量</span>
          <div class="pt-chips">
            <button
              v-for="lv in PERIOD_FLOW_LEVELS"
              :key="lv.value"
              type="button"
              class="pt-chip"
              :class="{ 'is-on': store.todayLog?.flow === lv.value }"
              :disabled="store.saving"
              @click="quickSetFlow(lv.value)"
            >
              {{ lv.label }}
            </button>
          </div>
        </div>

        <button class="pt-add" type="button" @click="openSheet(store.today || todayDate(), 1)">
          <span class="pt-add-label">症状</span>
          <span class="pt-add-action">+ 添加</span>
        </button>
        <button class="pt-add" type="button" @click="openSheet(store.today || todayDate(), 2)">
          <span class="pt-add-label">心情</span>
          <span class="pt-add-action">+ 添加</span>
        </button>
      </section>

      <!-- ==================== 最近周期 ==================== -->
      <PeriodHistoryList
        :cycles="store.cycles"
        :masked="masked"
        :limit="3"
        @view-all="cyclesShow = true"
        @pick-cycle="onPickCycle"
      />
    </template>

    <!-- ==================== 记录浮层（常驻，避免每次重挂）==================== -->
    <PeriodDaySheet
      v-model:show="sheetShow"
      :date="sheetDate"
      :initial-page="sheetPage"
      @saved="onSaved"
    />

    <!-- ==================== 预测依据 ⓘ ==================== -->
    <!-- ⚠️ 本组件全部弹层都要 teleport="body"：PeriodTab 挂在记录页的
         main.tab-body（overflow-y:auto 滚动容器）里，iOS 上不挂 body 会被
         布局层 chrome 压住。完整说明见 components/period/PeriodDaySheet.vue -->
    <van-popup v-model:show="statsShow" position="bottom" round teleport="body" class="pt-pop">
      <div class="pt-pop-body">
        <h4 class="pt-pop-title">预测依据</h4>
        <template v-if="prediction">
          <div class="pt-pop-row"><span>置信度</span><b>{{ prediction.confidence_reason }}</b></div>
          <div class="pt-pop-row"><span>参考样本</span><b>{{ prediction.sample_size }} 个完整周期</b></div>
          <div v-if="prediction.stats" class="pt-pop-row">
            <span>中位周期</span><b>{{ prediction.stats.median_cycle }} 天</b>
          </div>
          <div v-if="prediction.stats" class="pt-pop-row">
            <span>波动范围</span>
            <b>
              {{ prediction.stats.recent_cycles.length ? prediction.stats.recent_cycles.join(' / ') : '—' }}
            </b>
          </div>
          <p class="pt-pop-hint">
            预测用「中位数 + 稳健波动」估算，而不是平均值 —— 个别异常周期不会把结果带偏。
            记录 2–3 个周期后会明显变准，记录基础体温还能确认排卵。
          </p>
        </template>
        <button class="pt-pop-ok" type="button" @click="statsShow = false">知道了</button>
      </div>
    </van-popup>

    <!-- ==================== 易孕期说明 ==================== -->
    <van-popup v-model:show="fertileShow" position="bottom" round teleport="body" class="pt-pop">
      <div class="pt-pop-body">
        <h4 class="pt-pop-title">易孕期是怎么算的</h4>
        <p class="pt-pop-hint">
          精子在体内可存活约 5 天，而卵子排出后约 24 小时内可受精。因此把排卵日往前推 5 天
          （共 6 天）作为易孕期；其中受孕概率最高的两天是峰值期。
        </p>
        <p class="pt-pop-hint">
          日历法对排卵日的准确率约 21%，所以这里只是一个参考范围，不能作为避孕依据。
        </p>
        <button class="pt-pop-ok" type="button" @click="fertileShow = false">知道了</button>
      </div>
    </van-popup>

    <!-- ==================== 全部周期 ==================== -->
    <van-popup v-model:show="cyclesShow" position="bottom" round teleport="body" class="pt-pop">
      <div class="pt-pop-body">
        <h4 class="pt-pop-title">全部周期</h4>
        <div class="pt-cycle-list">
          <div v-for="c in store.cycles" :key="c.id" class="pt-cycle-row">
            <span class="pt-cycle-range">
              {{ masked ? '••••' : `${formatMonthDay(c.start_date)} – ${c.is_ongoing ? '至今' : formatMonthDay(c.end_date)}` }}
            </span>
            <span class="pt-cycle-len">
              {{ masked ? '••••' : c.is_ongoing ? '进行中' : c.gap || c.cycle_length == null ? '—' : `${c.cycle_length} 天` }}
            </span>
          </div>
          <p v-if="store.cycles.length === 0" class="pt-pop-hint">还没有完整的周期记录。</p>
        </div>
        <button class="pt-pop-ok" type="button" @click="cyclesShow = false">关闭</button>
      </div>
    </van-popup>
  </div>
</template>

<style lang="scss" scoped>
/* ⚠️ 本组件是 Tab 的内容，外层 .tab-body 已是唯一滚动容器：
   这里**不写 height、不写 overflow**，否则会出现嵌套滚动。 */
.period-tab {
  display: block;
}

/* ==================== 骨架 ==================== */
.pt-skeleton {
  height: 320px;
  border-radius: var(--radius-lg);
  background: linear-gradient(
    90deg,
    var(--color-bg-hover) 25%,
    var(--color-border) 50%,
    var(--color-bg-hover) 75%
  );
  background-size: 200% 100%;
  animation: pt-shimmer 1.5s infinite;
}
@keyframes pt-shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

/* ==================== 首次引导卡 ==================== */
.pt-guide {
  padding: var(--space-5);
  background: var(--color-bg-card);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-xs);
  margin-bottom: var(--space-3);
}
.pt-guide-title {
  margin: 0 0 6px;
  font-size: var(--fs-h3);
  font-weight: 600;
  color: var(--color-text-primary);
}
.pt-guide-text {
  margin: 0 0 var(--space-4);
  font-size: var(--fs-body-sm);
  color: var(--color-text-secondary);
  line-height: 1.55;
}
.pt-guide-btn {
  width: 100%;
  height: 46px;
  border: 0;
  border-radius: var(--radius-lg);
  background: var(--color-primary);
  color: #FFFFFF;
  font-size: var(--fs-body);
  font-weight: 600;
  box-shadow: var(--shadow-button);

  &:active { background: var(--color-primary-dark); }
}

/* ==================== 异常提醒 ==================== */
.pt-alerts {
  margin-bottom: var(--space-3);
  padding: 10px var(--space-4);
  border-radius: var(--radius-lg);
  background: var(--tint-warning-bg);
  border-left: 3px solid var(--color-warning);
}
.pt-alerts-summary {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--fs-caption-sm);
  color: var(--tint-warning-fg);
  font-weight: 500;
  list-style: none;
  cursor: pointer;

  &::-webkit-details-marker { display: none; }
}
.pt-alerts-ico { flex-shrink: 0; :deep(svg) { display: block; } }
.pt-alerts-count {
  margin-left: auto;
  font-size: var(--fs-micro);
  opacity: 0.8;
}
.pt-alerts-list {
  margin: var(--space-2) 0 0;
  padding-left: 18px;

  li {
    font-size: var(--fs-caption-sm);
    line-height: 1.6;
    color: var(--tint-warning-fg);
  }
}
.pt-alerts-foot {
  margin: var(--space-2) 0 0;
  font-size: var(--fs-micro);
  line-height: 1.5;
  color: var(--color-text-tertiary);
}

/* ==================== 今天快捷条 ==================== */
.pt-today {
  padding: var(--space-4) var(--space-5);
  background: var(--color-bg-card);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-xs);
  margin-bottom: var(--space-3);
}
.pt-today-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-2);
  margin-bottom: var(--space-2);
}
.pt-today-title {
  font-size: var(--fs-body-sm);
  font-weight: 700;
  color: var(--color-text-primary);
}
.pt-today-sum {
  font-size: var(--fs-caption-sm);
  color: var(--color-text-tertiary);
}
.pt-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-height: 44px;
}
.pt-row-label {
  flex-shrink: 0;
  font-size: var(--fs-caption);
  color: var(--color-text-tertiary);
}
.pt-chips {
  display: flex;
  gap: 8px;
}
.pt-chip {
  min-width: 58px;
  height: 32px;
  padding: 0 12px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-pill);
  background: var(--color-bg-card);
  font-size: var(--fs-caption-sm);
  color: var(--color-text-secondary);
  transition: all var(--duration-fast) var(--ease-default);

  &.is-on {
    border-color: var(--color-period);
    background: var(--color-period-soft);
    color: var(--color-period-dark);
    font-weight: 600;
  }
  &:active:not(:disabled) { transform: scale(0.96); }
  &:disabled { opacity: 0.6; }
}
.pt-add {
  width: 100%;
  min-height: 44px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border: 0;
  border-top: 1px solid var(--color-border-light);
  background: transparent;
  text-align: left;

  &:active { opacity: 0.7; }
}
.pt-add-label {
  font-size: var(--fs-caption);
  color: var(--color-text-tertiary);
}
.pt-add-action {
  font-size: var(--fs-caption-sm);
  color: var(--color-primary);
}

/* ==================== 弹层 ==================== */
.pt-pop {
  padding: var(--space-5) var(--space-5) calc(var(--space-5) + env(safe-area-inset-bottom, 0px));
}
.pt-pop-title {
  margin: 0 0 var(--space-3);
  font-size: var(--fs-h4);
  font-weight: 600;
  color: var(--color-text-primary);
}
.pt-pop-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-3);
  padding: 9px 0;
  border-bottom: 1px solid var(--color-border-light);

  span { font-size: var(--fs-caption); color: var(--color-text-tertiary); }
  b {
    font-size: var(--fs-caption);
    font-weight: 600;
    color: var(--color-text-primary);
    text-align: right;
  }
}
.pt-pop-hint {
  margin: var(--space-3) 0 0;
  font-size: var(--fs-caption-sm);
  line-height: 1.6;
  color: var(--color-text-secondary);
}
.pt-pop-ok {
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
.pt-cycle-list {
  max-height: 46vh;
  overflow-y: auto;
}
.pt-cycle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 0;
  border-bottom: 1px solid var(--color-border-light);
}
.pt-cycle-range {
  font-size: var(--fs-caption);
  color: var(--color-text-primary);
  font-variant-numeric: tabular-nums;
}
.pt-cycle-len {
  font-size: var(--fs-caption-sm);
  color: var(--color-text-secondary);
}
</style>
