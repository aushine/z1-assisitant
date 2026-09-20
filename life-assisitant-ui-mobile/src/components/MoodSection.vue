<script setup lang="ts">
/**
 * MoodSection —— 记录页「今日心情」区块（移动端，按小时记录）
 *
 * SYNC-FROM-DESKTOP: life-assisitant-ui-desktop/src/pages/record/components/MoodSection.tsx
 * SYNC-FROM-BACKEND: life-assisitant-api/internal/controller/mood.go
 * 最后同步：2026-09-19（改为按小时记录 + 时间线 + 当前小时快捷区）
 *
 * 结构（与桌面端一致）：
 *   卡片头：今日心情 + 此刻 实时时钟
 *   副标题：按小时记录 · 心情会延续
 *   此刻区：心情 5 档 / 精力 3 档(+不填) / 备注(≤50) + 保存；点一下立刻落库
 *   时间线：按小时倒序，当前小时高亮「现在」，点任一行打开 MoodHourSheet 编辑
 *
 * 交互要点（对齐后端三态契约）：
 *   - 「此刻」chips 点一下立刻落库：只发被点的那一个字段（mood / energy），
 *     再点同一个值 = 取消该字段（显式发 0）。
 *   - 备注「保存」只发 note；备注每小时一刷，不延续，输入框反映当前小时那一行。
 *   - 时间线当前小时行高亮 + 「现在」标记；点任一行打开 MoodHourSheet 编辑那个小时。
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { showSuccessToast } from 'vant'
import MoodHourSheet from '@/components/MoodHourSheet.vue'
import Icon from '@/components/icon/Icon.vue'
import { useMoodStore } from '@/stores/mood'
import {
  moodOptions,
  energyOptions,
  MOOD_META,
  ENERGY_META,
  type MoodMeta,
} from '@/utils/mood-dict'
import { todayDate } from '@/utils/date'
import type { EnergyValue, MoodHourItem, MoodValue } from '@/api/types'

const moodStore = useMoodStore()

/** 健康 tab 传 true：心情时间线默认 3 条 + 「展开全天」；首页传 false（默认）全量 */
const props = withDefaults(defineProps<{ collapse?: boolean }>(), { collapse: false })

const today = todayDate()

/** 加载失败（区别于时间线为空的「未记录」） */
const loadFailed = ref(false)
const loading = computed(() => moodStore.timelineLoading)

// 此刻实时时钟（仅用于头部展示；落库用的 hour 取自服务端 now_hour）
const now = ref(new Date())
const clockText = computed(() => {
  const d = now.value
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
})
let timer: number | undefined
function tick(): void {
  now.value = new Date()
}

async function load(): Promise<void> {
  loadFailed.value = false
  try {
    await moodStore.fetchTimeline(today)
  } catch (e) {
    loadFailed.value = true
    // eslint-disable-next-line no-console
    console.error('[MoodSection] load failed', e)
  }
}

onMounted(() => {
  timer = window.setInterval(tick, 30000)
  void load()
})
onUnmounted(() => {
  if (timer) window.clearInterval(timer)
})

// ---- 此刻选中态（延续后的当前值 = 时间线最后一条，后端已向前延续填充） ----
const latest = computed<MoodHourItem | null>(() => moodStore.timelineLatest)
const selMood = computed(() => latest.value?.mood ?? 0)
const selEnergy = computed(() => latest.value?.energy ?? 0)

/** 记录页用降序（很好 → 很差），见 utils/mood-dict.ts 的头注释 */
const moodOpts = moodOptions([5, 4, 3, 2, 1] as MoodValue[])
const energyOpts = energyOptions([3, 2, 1] as EnergyValue[])

// 当前小时那一行（备注只属于当前小时）
const currentHour = computed<MoodHourItem | null>(() => {
  const items = moodStore.timeline?.items ?? []
  return items.find((i) => i.hour === moodStore.nowHour) ?? null
})

// 备注草稿：反映当前小时那行的备注；跨小时 / 重拉后更新（编辑中不打断）
const noteDraft = ref('')
const noteEditing = ref(false)
watch(
  () => currentHour.value?.note,
  (v) => {
    if (!noteEditing.value) noteDraft.value = v ?? ''
  },
  { immediate: true }
)

async function pickMood(m: MoodValue): Promise<void> {
  // 再点同一个值 = 该小时不再单独记录（只发 mood:0），显示时回落到上一条的延续值
  const mood = selMood.value === m ? 0 : m
  const resp = await moodStore.upsertHour({ date: today, hour: moodStore.nowHour, mood })
  if (resp) {
    showSuccessToast(resp.item === null ? '已清除这一条' : mood === 0 ? '已恢复沿用上一条' : '已记录')
  }
}

async function pickEnergy(e: EnergyValue): Promise<void> {
  const energy = selEnergy.value === e ? 0 : e
  const resp = await moodStore.upsertHour({ date: today, hour: moodStore.nowHour, energy })
  if (resp) {
    showSuccessToast(resp.item === null ? '已清除这一条' : energy === 0 ? '已恢复沿用上一条' : '已记录')
  }
}

async function clearEnergy(): Promise<void> {
  const resp = await moodStore.upsertHour({ date: today, hour: moodStore.nowHour, energy: 0 })
  if (resp) showSuccessToast(resp.item === null ? '已清除这一条' : '已恢复沿用上一条')
}

async function saveNote(): Promise<void> {
  noteEditing.value = false
  const resp = await moodStore.upsertHour({
    date: today,
    hour: moodStore.nowHour,
    note: noteDraft.value.slice(0, 50),
  })
  if (resp) showSuccessToast('已记录')
}

// ---- 时间线（倒序：新→旧） ----
const timelineRows = computed(() => [...(moodStore.timeline?.items ?? [])].reverse())
const nowHour = computed(() => moodStore.nowHour)

/** 折叠态（健康 tab）下默认只展示最近 3 条，点「展开全天」才全量 */
const expanded = ref(false)
const visibleTimelineRows = computed(() =>
  props.collapse && !expanded.value ? timelineRows.value.slice(0, 3) : timelineRows.value,
)

function hourLabel(h: number): string {
  return `${String(h).padStart(2, '0')}:00`
}
function moodText(m: number): string {
  if (m === 0) return '未记录'
  return (MOOD_META as Record<MoodValue, MoodMeta>)[m as MoodValue]?.label ?? ''
}
function energyText(e: number): string {
  if (e === 0) return ''
  return (ENERGY_META as Record<EnergyValue, MoodMeta>)[e as EnergyValue]?.label ?? ''
}

// ---- 编辑某小时 ----
const sheetShow = ref(false)
const sheetHour = ref(0)
const sheetItem = ref<MoodHourItem | null>(null)

function openHour(item: MoodHourItem): void {
  sheetHour.value = item.hour
  sheetItem.value = item
  sheetShow.value = true
}

function onSheetSaved(): void {
  showSuccessToast('已保存')
}

defineExpose({ reload: load })
</script>

<template>
  <section class="card mood-card">
    <div class="card-head">
      <div class="card-titles">
        <h3 class="card-title">今日心情</h3>
        <span class="card-sub">按小时记录 · 心情会延续</span>
      </div>
      <span class="now-clock">
        <Icon name="Clock" :size="14" aria-hidden="true" />
        <span class="now-time">{{ clockText }}</span>
      </span>
    </div>

    <!-- 错误态 -->
    <div v-if="loadFailed" class="mood-error">
      <span class="mood-error-text">心情加载失败</span>
      <button type="button" class="mood-retry" @click="load">重试</button>
    </div>

    <!-- 骨架 -->
    <div v-else-if="loading && !moodStore.timeline" class="mood-skeleton">
      <div class="skel-line" />
      <div class="skel-line short" />
    </div>

    <template v-else>
      <!-- 此刻 -->
      <div class="section-label">此刻</div>
      <div class="now-zone">
        <div class="mp-row">
          <span class="mp-label">心情</span>
          <div class="mp-group" role="group" aria-label="此刻心情">
            <button
              v-for="o in moodOpts"
              :key="o.value"
              type="button"
              class="mp-btn"
              :class="{ 'is-active': selMood === o.value }"
              :style="selMood === o.value
                ? { background: o.vars.bg, borderColor: o.vars.fg, color: o.vars.fg }
                : { color: 'var(--color-text-tertiary)' }"
              :aria-pressed="selMood === o.value"
              :aria-label="o.label"
              @click="pickMood(o.value)"
            >
              <Icon :name="o.icon" :size="20" aria-hidden="true" />
            </button>
          </div>
        </div>

        <div class="mp-row">
          <span class="mp-label">精力</span>
          <div class="mp-group" role="group" aria-label="此刻精力">
            <button
              v-for="o in energyOpts"
              :key="o.value"
              type="button"
              class="mp-btn"
              :class="{ 'is-active': selEnergy === o.value }"
              :style="selEnergy === o.value
                ? { background: o.vars.bg, borderColor: o.vars.fg, color: o.vars.fg }
                : { color: 'var(--color-text-tertiary)' }"
              :aria-pressed="selEnergy === o.value"
              :aria-label="o.label"
              @click="pickEnergy(o.value)"
            >
              <Icon :name="o.icon" :size="20" aria-hidden="true" />
            </button>
            <button
              type="button"
              class="mp-btn mp-clear"
              :class="{ 'is-active': selEnergy === 0 }"
              :aria-pressed="selEnergy === 0"
              aria-label="精力不填"
              @click="clearEnergy"
            >
              <span class="mp-clear-text">不填</span>
            </button>
          </div>
        </div>

        <div class="note-row">
          <input
            v-model="noteDraft"
            type="text"
            class="note-input"
            placeholder="这一刻的想法…（≤50 字）"
            :maxlength="50"
            @focus="noteEditing = true"
            @blur="noteEditing = false"
            @keyup.enter="saveNote"
          >
          <button type="button" class="note-save" @click="saveNote">保存</button>
        </div>

        <p class="hint">不点就是继续沿用上一次的心情和精力；备注只属于当前这个小时</p>

        <p
          v-if="!moodStore.timeline || moodStore.timeline.items.length === 0"
          class="empty-tip"
        >
          今天还没有记录。点一下心情，就从现在开始。
        </p>
      </div>

      <!-- 时间线 -->
      <div class="section-label">今天的时间线</div>
      <ul v-if="timelineRows.length" class="timeline">
        <li
          v-for="item in visibleTimelineRows"
          :key="item.hour"
          class="tl-row"
          :class="{ 'is-now': item.hour === nowHour }"
          role="button"
          :aria-label="`${hourLabel(item.hour)} 的记录`"
          @click="openHour(item)"
        >
          <span v-if="item.hour === nowHour" class="tl-now">现在</span>
          <span class="tl-hour">{{ hourLabel(item.hour) }}</span>
          <span class="tl-mood">
            {{ moodText(item.mood) }}<template v-if="energyText(item.energy)"> · {{ energyText(item.energy) }}</template>
          </span>
          <span v-if="item.note" class="tl-note">{{ item.note }}</span>
        </li>
      </ul>
      <button
        v-if="props.collapse && timelineRows.length > 3 && !expanded"
        type="button"
        class="tl-expand"
        @click="expanded = true"
      >
        展开全天
      </button>
      <p v-else-if="!timelineRows.length" class="tl-empty">还没有时间线条目</p>
    </template>

    <MoodHourSheet
      v-model:show="sheetShow"
      :date="today"
      :hour="sheetHour"
      :item="sheetItem"
      @saved="onSheetSaved"
    />
  </section>
</template>

<style lang="scss" scoped>
.card {
  background: var(--color-bg-card);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-xs);
  padding: var(--space-4);
  margin-bottom: var(--space-4);
}
.card-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 12px;
}
.card-titles {
  display: flex;
  flex-direction: column;
  gap: 2px;
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
.now-clock {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-family: var(--font-num);
  font-variant-numeric: tabular-nums;
  font-size: var(--fs-caption);
  color: var(--color-text-secondary);
  flex-shrink: 0;
}

.mood-error {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  background: var(--color-danger-light);
  border-radius: var(--radius-md);
}
.mood-error-text {
  flex: 1;
  font-size: var(--fs-caption);
  color: var(--color-danger-dark);
}
.mood-retry {
  flex-shrink: 0;
  padding: 4px 12px;
  font-size: var(--fs-caption-sm);
  font-weight: 600;
  color: #FFFFFF;
  background: var(--color-danger);
  border: 0;
  border-radius: var(--radius-pill);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  &:active { transform: scale(0.95); }
}

.mood-skeleton {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.skel-line {
  height: 34px;
  border-radius: var(--radius-md);
  background: linear-gradient(90deg, #F3F4F6 25%, #E5E7EB 50%, #F3F4F6 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
  &.short { width: 60%; }
}
@keyframes shimmer {
  0%   { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

.section-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--fs-caption-sm);
  font-weight: 600;
  color: var(--color-text-secondary);
  margin: 4px 0 10px;
  &::before {
    content: '';
    width: 3px;
    height: 12px;
    border-radius: var(--radius-pill);
    background: var(--color-primary);
  }
}
.now-zone {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-bottom: 4px;
}

.mp-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.mp-label {
  flex-shrink: 0;
  width: 28px;
  font-size: var(--fs-caption-sm);
  color: var(--color-text-tertiary);
}
.mp-group {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.mp-btn {
  width: 34px;
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-bg-hover);
  border: 1.5px solid transparent;
  border-radius: var(--radius-md);
  padding: 0;
  cursor: pointer;
  transition: all var(--duration-fast) var(--ease-default);
  -webkit-tap-highlight-color: transparent;
  &:active { transform: scale(0.94); }
  &.is-active { transform: scale(1.04); }
}
.mp-btn > svg {
  display: block;
  flex-shrink: 0;
}
.mp-clear {
  width: auto;
  padding: 0 10px;
}
.mp-clear-text {
  font-size: var(--fs-caption-sm);
  font-weight: 500;
}
.mp-clear.is-active {
  background: var(--color-bg-hover);
  border-color: var(--color-border-light);
  color: var(--color-text-secondary);
}

.note-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.note-input {
  flex: 1;
  min-width: 0;
  height: 34px;
  padding: 0 10px;
  background: var(--color-bg-hover);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-md);
  font-size: var(--fs-caption);
  color: var(--color-text-primary);
  outline: none;
  &:focus { border-color: var(--color-primary); }
}
.note-save {
  flex-shrink: 0;
  height: 34px;
  padding: 0 16px;
  font-size: var(--fs-caption);
  font-weight: 600;
  color: #FFFFFF;
  background: var(--color-primary);
  border: 0;
  border-radius: var(--radius-md);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  &:active { transform: scale(0.96); }
}

.hint {
  margin: 0;
  font-size: var(--fs-micro);
  line-height: 1.4;
  color: var(--color-text-tertiary);
}
.empty-tip {
  margin: 0;
  padding: 10px 12px;
  background: var(--color-bg-hover);
  border-radius: var(--radius-md);
  font-size: var(--fs-caption);
  color: var(--color-text-secondary);
}

.timeline {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.tl-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: var(--radius-md);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  &:active { background: var(--color-bg-hover); }
  &.is-now {
    background: var(--color-primary-light);
  }
}
.tl-now {
  flex-shrink: 0;
  padding: 1px 6px;
  font-size: var(--fs-micro);
  font-weight: 600;
  color: var(--color-primary-dark, var(--color-primary));
  background: var(--color-primary);
  border-radius: var(--radius-pill);
}
.tl-hour {
  flex-shrink: 0;
  width: 42px;
  font-family: var(--font-num);
  font-variant-numeric: tabular-nums;
  font-size: var(--fs-caption-sm);
  font-weight: 600;
  color: var(--color-text-primary);
}
.tl-mood {
  flex-shrink: 0;
  font-size: var(--fs-caption-sm);
  color: var(--color-text-secondary);
}
.tl-note {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--fs-caption-sm);
  color: var(--color-text-tertiary);
}
.tl-empty {
  margin: 0;
  padding: 10px 0;
  font-size: var(--fs-caption-sm);
  color: var(--color-text-tertiary);
}
.tl-expand {
  display: block;
  width: 100%;
  margin-top: var(--space-2);
  padding: 8px 0;
  border: 0;
  background: transparent;
  font-size: var(--fs-caption-sm);
  font-weight: 500;
  color: var(--color-primary);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  &:active { opacity: 0.7; }
}
</style>
