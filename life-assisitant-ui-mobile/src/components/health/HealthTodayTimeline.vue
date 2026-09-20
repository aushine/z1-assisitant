<script setup lang="ts">
/**
 * 今日时间轴（移动端，02 §12）
 *
 * 一条轴贯穿**全部指标**：数据取 store.todayLog.events（GET /health/overview 已带，
 * 零额外请求；⚠️ 不是 store.dayEvents —— 那是浮层当前选中日期，浏览历史时会串数据）。
 *
 *   - 倒序（与首页 Timeline 一致，「刚记了什么」第一眼可见，02 §12.5 老大拍板）；
 *   - 视觉照抄 components/Timeline.vue 的 .timeline-axis / .timeline-node / .timeline-time，
 *     ⚠️ 不新造、也不把 Timeline 改成通用组件（10 §3）；
 *   - 圆点 = 该指标色（CALENDAR_DOT_COLOR，与月历分类小点同一套色彩语言）；
 *   - ⚠️ 只放身体指标（water/bbt/weight/sleep/bowel）；心情/精力已拆成独立轴（MoodSection），不混排；
 *   - 底部「今天还没记：X、Y」+ 记录 ›（直达浮层第一个未记录指标，02 §12.3）；
 *   - 点条目 → 底部弹层改时间 / 数值 / 备注 / 删（走已有 store.editEvent / removeEvent，10 §5）；
 *   - 空态**不隐藏整块**（02 §12.7）。
 */
import { computed, ref } from 'vue'
import { showConfirmDialog } from 'vant'
import { useHealthStore } from '@/stores/health'
import { todayDate } from '@/utils/date'
import {
  BOWEL_TYPE_OPTIONS,
  CALENDAR_DOT_COLOR,
  METRIC_META,
  healthMetric,
  isKnownMetricKey,
  type MetricKey,
} from '@/constants/health'
import type { HealthEventItem, PatchHealthEventReq } from '@/api/types'

const emit = defineEmits<{
  (e: 'open-metric', key: string): void
}>()

const store = useHealthStore()

/** 收起时默认展示最近几条（02 §12.6） */
const COLLAPSED_COUNT = 5

/* ==================== 数据：按时间倒序 ==================== */

/**
 * ⚠️ 这条轴**只放身体指标**（water / bbt / weight / sleep / bowel），
 *    数据取 store.todayLog.events（GET /health/overview 已带，零额外请求）。
 *    心情/精力已拆成独立轴（MoodSection），不在这里混排。
 * ⚠️ 防御性排序：后端口径是升序，这里不信任输入顺序（展示层稳定优先）。
 */
const rows = computed<HealthEventItem[]>(() => {
  const all = [...(store.todayLog?.events ?? [])].sort((a, b) =>
    a.time < b.time ? -1 : a.time > b.time ? 1 : 0,
  )
  return all.reverse()
})

const expanded = ref(false)
const visibleRows = computed(() =>
  expanded.value ? rows.value : rows.value.slice(0, COLLAPSED_COUNT),
)

/* ==================== 行展示 ==================== */

function dotColor(key: string): string {
  if (key === 'sleep') return CALENDAR_DOT_COLOR.energy
  const c = CALENDAR_DOT_COLOR[key as keyof typeof CALENDAR_DOT_COLOR]
  return c ?? 'var(--color-text-disabled)'
}

function metricLabel(key: string): string {
  if (isKnownMetricKey(key as MetricKey)) return METRIC_META[key as MetricKey].label
  return healthMetric(key)?.name ?? key
}

const BOWEL_LABEL: Record<number, string> = BOWEL_TYPE_OPTIONS.reduce<
  Record<number, string>
>((acc, o) => {
  acc[o.value] = o.label
  return acc
}, {})

function displayValue(e: HealthEventItem): string {
  if (!isKnownMetricKey(e.metric_key)) return '—'
  const meta = METRIC_META[e.metric_key]
  if (meta.usesInt) {
    return e.value_int != null ? (BOWEL_LABEL[e.value_int] ?? String(e.value_int)) : '—'
  }
  if (e.value_num == null) return '—'
  const n =
    meta.decimals > 0 ? e.value_num.toFixed(meta.decimals) : String(Math.round(e.value_num))
  return meta.unit ? `${n} ${meta.unit}` : n
}

/* ==================== 缺口提示（02 §12.3） ==================== */

/** 「预期每天都有」的指标（daily 口径，02 §14.5）；mood/精力有专属卡，不在这里催 */
const DAILY_CHECKS: { key: string; recorded: () => boolean }[] = [
  { key: 'water', recorded: () => (store.todayLog?.water_ml ?? 0) > 0 },
  { key: 'bbt', recorded: () => store.todayLog?.bbt != null },
  { key: 'weight', recorded: () => store.todayLog?.weight_kg != null },
  { key: 'energy_sleep', recorded: () => store.todayLog?.sleep_hours != null },
]

const missing = computed(() =>
  DAILY_CHECKS.filter((c) => store.enabledMetrics.includes(c.key) && !c.recorded()).map(
    (c) => c.key,
  ),
)
const missingText = computed(() => missing.value.map(metricLabel).join('、'))

function onRecord(): void {
  emit('open-metric', missing.value[0] ?? '')
}

/* ==================== 条目编辑弹层（10 §5：UI 接上已有的 editEvent/removeEvent） ==================== */

const editShow = ref(false)
const editing = ref<HealthEventItem | null>(null)
const editTime = ref('')
const editNum = ref<number | null>(null)
const editInt = ref<number>(0)
const editNote = ref('')
/** 弹层内的指标元信息（决定数值控件形态） */
const editUsesInt = computed(() =>
  editing.value ? METRIC_META[editing.value.metric_key]?.usesInt ?? false : false,
)
const editDecimals = computed(() =>
  editing.value ? METRIC_META[editing.value.metric_key]?.decimals ?? 0 : 0,
)
const editLabel = computed(() =>
  editing.value ? metricLabel(editing.value.metric_key) : '',
)

function openEdit(e: HealthEventItem): void {
  editing.value = e
  editTime.value = e.time
  editNum.value = e.value_num ?? null
  editInt.value = e.value_int ?? 0
  editNote.value = e.note ?? ''
  editShow.value = true
}

async function onSaveEdit(): Promise<void> {
  const e = editing.value
  if (!e || !editTime.value.trim()) return
  const data: Omit<PatchHealthEventReq, 'id'> = {
    time: editTime.value,
    note: editNote.value,
  }
  if (editUsesInt.value) data.value_int = editInt.value
  else if (editNum.value != null) data.value_num = editNum.value
  await store.editEvent(e.id, data)
  editShow.value = false
}

async function onDeleteEdit(): Promise<void> {
  const e = editing.value
  if (!e) return
  try {
    await showConfirmDialog({
      title: '删除这条记录',
      message: `${e.time} · ${displayValue(e)}`,
      confirmButtonText: '删除',
      confirmButtonColor: 'var(--color-danger)',
    })
  } catch {
    return
  }
  const ok = await store.removeEvent(e.id, e.date || store.today || todayDate())
  if (ok) editShow.value = false
}
</script>

<template>
  <section class="tt">
    <!-- ==================== 卡头 ==================== -->
    <div class="tt-head">
      <span class="tt-title">今天</span>
      <button
        v-if="rows.length > 0"
        class="tt-count"
        type="button"
        @click="expanded = !expanded"
      >
        {{ rows.length }} 条记录
      </button>
    </div>

    <!-- ==================== 空态（不隐藏整块，02 §12.7） ==================== -->
    <div v-if="rows.length === 0" class="tt-empty">
      <p class="tt-empty-title">还没有记录</p>
      <p class="tt-empty-desc">记录第一次，这里就会长出你的时间轴</p>
      <button class="tt-empty-btn" type="button" @click="onRecord">记录今天</button>
    </div>

    <template v-else>
      <!-- ==================== 时间轴（视觉照抄 Timeline.vue） ==================== -->
      <ul class="tt-list">
        <li
          v-for="(r, i) in visibleRows"
          :key="r.id"
          class="tt-item"
          :class="{ 'is-first': i === 0, 'is-last': i === visibleRows.length - 1 }"
          role="button"
          :aria-label="`编辑 ${r.time} 的${metricLabel(r.metric_key)}记录`"
          @click="openEdit(r)"
        >
          <div class="timeline-time">{{ r.time }}</div>
          <div class="timeline-axis">
            <span class="timeline-node" :style="{ background: dotColor(r.metric_key) }" />
          </div>
          <div class="tt-main">
            <div class="tt-row">
              <span class="tt-name">{{ metricLabel(r.metric_key) }}</span>
              <span class="tt-val">{{ displayValue(r) }}</span>
            </div>
            <div v-if="r.note" class="tt-note">{{ r.note }}</div>
          </div>
        </li>
      </ul>
      <button
        v-if="!expanded && rows.length > COLLAPSED_COUNT"
        class="tt-more"
        type="button"
        @click="expanded = true"
      >
        展开全部 {{ rows.length }} 条
      </button>

      <!-- ==================== 缺口提示 ==================== -->
      <div v-if="missing.length > 0" class="tt-missing">
        <span class="tt-missing-text">今天还没记：{{ missingText }}</span>
        <button class="tt-missing-btn" type="button" @click="onRecord">记录 ›</button>
      </div>
    </template>

    <!-- ==================== 编辑弹层（改时间 / 数值 / 备注 / 删） ==================== -->
    <van-popup
      v-model:show="editShow"
      position="bottom"
      round
      teleport="body"
      class="tt-edit-pop"
    >
      <div class="tt-edit">
        <div class="tt-edit-head">
          <span class="tt-edit-title">编辑{{ editLabel }}记录</span>
          <button
            class="tt-edit-del"
            type="button"
            :disabled="store.saving"
            @click="onDeleteEdit"
          >
            删除
          </button>
        </div>

        <label class="tt-field">
          <span class="tt-field-label">时间</span>
          <input v-model="editTime" class="tt-input" type="time" />
        </label>

        <label v-if="!editUsesInt" class="tt-field">
          <span class="tt-field-label">数值</span>
          <input
            v-model.number="editNum"
            class="tt-input"
            type="number"
            :step="editDecimals > 0 ? Math.pow(10, -editDecimals) : 1"
            inputmode="decimal"
          />
        </label>
        <div v-else class="tt-field">
          <span class="tt-field-label">形态</span>
          <div class="tt-chips">
            <button
              v-for="o in BOWEL_TYPE_OPTIONS"
              :key="o.value"
              class="tt-chip"
              :class="{ 'is-on': editInt === o.value }"
              type="button"
              @click="editInt = o.value"
            >
              {{ o.label }}
            </button>
          </div>
        </div>

        <label class="tt-field">
          <span class="tt-field-label">备注</span>
          <input
            v-model="editNote"
            class="tt-input"
            type="text"
            maxlength="50"
            placeholder="可留空"
          />
        </label>

        <button
          class="tt-edit-save"
          type="button"
          :disabled="store.saving || !editTime"
          @click="onSaveEdit"
        >
          保存
        </button>
      </div>
    </van-popup>
  </section>
</template>

<style lang="scss" scoped>
.tt {
  padding: var(--space-3);
  background: var(--color-bg-card);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-xs);
  margin-bottom: var(--space-3);
}

/* ==================== 卡头 ==================== */
.tt-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-2);
}
.tt-title {
  font-size: var(--fs-body-sm);
  font-weight: 600;
  color: var(--color-text-primary);
}
.tt-count {
  border: 0;
  background: transparent;
  padding: 0;
  font-size: var(--fs-caption-sm);
  color: var(--color-text-tertiary);
  font-variant-numeric: tabular-nums;

  &:active { color: var(--color-text-secondary); }
}

/* ==================== 空态 ==================== */
.tt-empty {
  padding: var(--space-5) var(--space-4);
  text-align: center;
}
.tt-empty-title {
  margin: 0;
  font-size: var(--fs-body-sm);
  font-weight: 600;
  color: var(--color-text-secondary);
}
.tt-empty-desc {
  margin: var(--space-1) 0 var(--space-3);
  font-size: var(--fs-caption-sm);
  color: var(--color-text-tertiary);
}
.tt-empty-btn {
  height: 36px;
  padding: 0 var(--space-5);
  border: 0;
  border-radius: var(--radius-pill);
  background: var(--color-primary);
  color: #FFFFFF;
  font-size: var(--fs-caption);
  font-weight: 600;

  &:active { background: var(--color-primary-dark); }
}

/* ==================== 时间轴 ==================== */
.tt-list {
  list-style: none;
  margin: var(--space-2) 0 0;
  padding: 0;
}
.tt-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  min-height: 34px;
  -webkit-tap-highlight-color: transparent;

  &:active .tt-main { background: var(--color-bg-hover); }
}

/* —— 以下三个类照抄 components/Timeline.vue 的规范（02 §12.4，不要新造） —— */
.timeline-time {
  flex-shrink: 0;
  width: 42px;
  padding-top: 2px;
  font-size: var(--fs-caption-sm);
  font-family: var(--font-num);
  font-variant-numeric: tabular-nums;
  color: var(--color-text-secondary);
  text-align: right;
}
.timeline-axis {
  position: relative;
  flex-shrink: 0;
  width: 16px;
  align-self: stretch;
  display: flex;
  justify-content: center;

  &::before {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    left: 50%;
    width: 2px;
    margin-left: -1px;
    background: var(--color-border-light);
  }
}
/* 首尾竖线收进去 8px，不顶到卡片边（02 §12.4） */
.tt-item.is-first .timeline-axis::before { top: 8px; }
.tt-item.is-last .timeline-axis::before { bottom: 8px; }

.timeline-node {
  position: relative;
  z-index: 1;
  margin-top: 4px;
  display: flex;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  /* 外圈 2px 卡片底色让竖线「断开」（02 §12.4） */
  box-shadow: 0 0 0 2px var(--color-bg-card);
}

.tt-main {
  flex: 1;
  min-width: 0;
  padding: var(--space-2) var(--space-1);
  border-radius: var(--radius-sm);
}
.tt-row {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
}
.tt-name {
  flex-shrink: 0;
  width: 56px;
  font-size: var(--fs-caption);
  color: var(--color-text-secondary);
}
.tt-val {
  font-size: var(--fs-body-sm);
  font-weight: 600;
  font-family: var(--font-num);
  font-variant-numeric: tabular-nums;
  color: var(--color-text-primary);
}
.tt-note {
  margin-top: 2px;
  font-size: var(--fs-caption-sm);
  color: var(--color-text-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tt-more {
  display: block;
  width: 100%;
  margin-top: var(--space-2);
  padding: var(--space-2) 0 0;
  border: 0;
  border-top: 1px solid var(--color-border-light);
  background: transparent;
  font-size: var(--fs-caption-sm);
  color: var(--color-text-tertiary);
  text-align: center;

  &:active { color: var(--color-text-secondary); }
}

/* ==================== 缺口提示 ==================== */
.tt-missing {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  margin-top: var(--space-3);
  padding-top: var(--space-3);
  border-top: 1px solid var(--color-border-light);
}
.tt-missing-text {
  min-width: 0;
  font-size: var(--fs-caption-sm);
  color: var(--color-text-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tt-missing-btn {
  flex-shrink: 0;
  border: 0;
  background: transparent;
  padding: 0;
  font-size: var(--fs-caption-sm);
  font-weight: 600;
  color: var(--color-primary);

  &:active { opacity: 0.7; }
}

/* ==================== 编辑弹层 ==================== */
.tt-edit {
  padding: var(--space-4) var(--space-4) calc(var(--space-4) + env(safe-area-inset-bottom, 0px));
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.tt-edit-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.tt-edit-title {
  font-size: var(--fs-body);
  font-weight: 600;
  color: var(--color-text-primary);
}
.tt-edit-del {
  border: 0;
  background: transparent;
  padding: var(--space-1) var(--space-2);
  font-size: var(--fs-caption);
  color: var(--color-danger);

  &:disabled { opacity: 0.4; }
}
.tt-field {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}
.tt-field-label {
  flex-shrink: 0;
  width: 40px;
  font-size: var(--fs-caption);
  color: var(--color-text-secondary);
}
.tt-input {
  flex: 1;
  min-width: 0;
  height: 38px;
  padding: 0 var(--space-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-base);
  background: var(--color-bg-app);
  font-size: var(--fs-body-sm);
  font-family: var(--font-num);
  color: var(--color-text-primary);

  &:focus { border-color: var(--color-primary); outline: none; }
}
.tt-chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}
.tt-chip {
  height: 32px;
  padding: 0 var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-pill);
  background: var(--color-bg-app);
  font-size: var(--fs-caption);
  color: var(--color-text-secondary);

  &.is-on {
    border-color: var(--color-primary);
    background: var(--tint-primary-bg);
    color: var(--color-primary);
    font-weight: 600;
  }
}
.tt-edit-save {
  height: 44px;
  border: 0;
  border-radius: var(--radius-pill);
  background: var(--color-primary);
  color: #FFFFFF;
  font-size: var(--fs-body);
  font-weight: 600;

  &:active:not(:disabled) { background: var(--color-primary-dark); }
  &:disabled { opacity: 0.5; }
}
</style>
