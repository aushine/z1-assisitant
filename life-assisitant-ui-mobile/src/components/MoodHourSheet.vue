<script setup lang="ts">
/**
 * MoodHourSheet —— 编辑「某一个小时」的心情 / 精力 / 备注（移动端）
 *
 * SYNC-FROM-DESKTOP: life-assisitant-ui-desktop/src/pages/record/components/MoodHourModal.tsx
 * SYNC-FROM-BACKEND: life-assisitant-api/internal/model/dto/mood.go
 * 契约文档：见 stores/mood.ts 头部（三态语义）
 *
 * 由 `MoodSection.vue` 的时间线点击某一行打开。只编辑那一个 (date, hour) 格。
 *
 * ⚠️ 三态语义（后端 PUT /moods）决定了这里的交互：
 *   - **只发用户实际改过的字段**。没改的字段一律不出现在请求体里
 *     （缺省 = 不动既有值），这也是「心情/精力向前延续」的实现方式。
 *   - 备注「每小时一刷」：不延续，只属于写下它的那个小时。
 *   - 心情/精力**取消选中** = 该小时不再单独记录 → 显示时回落到上一条的延续值。
 *     所以提示语写「已恢复沿用上一条」而不是「已清除」—— 说「已清除」会让人
 *     以为这个小时彻底没数据了。
 *   - 真正想删掉这一条 → 「清除这一条」（显式发 mood:0 + energy:0 + note:''，
 *     后端把空行删掉并返回 item:null）。
 *
 * ⚠️ 必须 `teleport="body"`：本组件挂在记录页的 `main.tab-body`
 *    （`overflow-y:auto` 的滚动容器）里，iOS 上不挂 body 会被布局层 chrome 压住。
 *    完整说明见 `components/period/PeriodDaySheet.vue` 头部注释。
 */
import { computed, ref, watch } from 'vue'
import { showConfirmDialog, showFailToast } from 'vant'
import Icon from '@/components/icon/Icon.vue'
import { MOOD_NOTE_MAX, useMoodStore } from '@/stores/mood'
import { ENERGY_META, MOOD_META, energyOptions, moodOptions, type MoodMeta } from '@/utils/mood-dict'
import type { EnergyValue, MoodHourItem, MoodUpsertReq, MoodValue } from '@/api/types'

const props = defineProps<{
  /** v-model:show */
  show: boolean
  /** YYYY-MM-DD */
  date: string
  /** 0-23 */
  hour: number
  /** 该小时已有的行；理论上一定非 null（只有已存在的行才可点开） */
  item: MoodHourItem | null
}>()

const emit = defineEmits<{
  (e: 'update:show', v: boolean): void
  (e: 'saved'): void
}>()

const moodStore = useMoodStore()

const weekText = computed(() => `${String(props.hour).padStart(2, '0')}:00 的记录`)

/* ==================== 草稿 ==================== */

/** 0 = 不填 / 取消选中 */
const draftMood = ref<number>(0)
const draftEnergy = ref<number>(0)
const draftNote = ref('')

/** 打开时用该行的实际值初始化草稿 */
function resetDraft(): void {
  draftMood.value = props.item?.mood ?? 0
  draftEnergy.value = props.item?.energy ?? 0
  draftNote.value = props.item?.note ?? ''
}

watch(
  () => [props.show, props.hour, props.date] as const,
  ([show]) => {
    if (show) resetDraft()
  },
  { immediate: true }
)

const moodOpts = moodOptions([5, 4, 3, 2, 1] as MoodValue[])
const energyOpts = energyOptions([3, 2, 1] as EnergyValue[])

function moodLabel(v: number): string {
  return v === 0 ? '' : (MOOD_META as Record<MoodValue, MoodMeta>)[v as MoodValue]?.label ?? ''
}
function energyLabel(v: number): string {
  return v === 0 ? '' : (ENERGY_META as Record<EnergyValue, MoodMeta>)[v as EnergyValue]?.label ?? ''
}

/** 心情：点已选中的档位 = 取消（该小时不再单独记录，显示时沿用上一条） */
function tapMood(v: MoodValue): void {
  draftMood.value = draftMood.value === v ? 0 : v
}
/** 精力：点已选中的档位 = 取消 */
function tapEnergy(v: EnergyValue): void {
  draftEnergy.value = draftEnergy.value === v ? 0 : v
}
function clearEnergyField(): void {
  draftEnergy.value = 0
}

/* ==================== 保存 ==================== */

const saving = computed(() => moodStore.timelineSaving)

/** 只有被改过的字段才进请求体（缺省 = 不动既有值） */
function buildPayload(): MoodUpsertReq {
  const origin = props.item
  const payload: MoodUpsertReq = { date: props.date, hour: props.hour }
  if (draftMood.value !== (origin?.mood ?? 0)) payload.mood = draftMood.value as MoodValue | 0
  if (draftEnergy.value !== (origin?.energy ?? 0)) payload.energy = draftEnergy.value as EnergyValue | 0
  if (draftNote.value !== (origin?.note ?? '')) payload.note = draftNote.value.slice(0, MOOD_NOTE_MAX)
  return payload
}

async function onSave(): Promise<void> {
  const payload = buildPayload()
  // 什么都没改 → 直接关，不发请求（payload 只剩 date/hour 两个字段）
  if (Object.keys(payload).length <= 2) {
    emit('update:show', false)
    return
  }
  const resp = await moodStore.upsertHour(payload)
  if (!resp) {
    showFailToast('保存失败，请重试')
    return
  }
  emit('saved')
  emit('update:show', false)
}

/** 清除这一条：显式清空三个字段 → 后端删掉该行 */
async function onRemove(): Promise<void> {
  try {
    await showConfirmDialog({
      title: '清除这一条？',
      message: `${weekText.value}的心情、精力和备注都会被删除。`,
      confirmButtonText: '清除',
      cancelButtonText: '取消',
    })
  } catch {
    return // 用户取消
  }
  const resp = await moodStore.upsertHour({
    date: props.date,
    hour: props.hour,
    mood: 0,
    energy: 0,
    note: '',
  })
  if (!resp) {
    showFailToast('清除失败，请重试')
    return
  }
  emit('saved')
  emit('update:show', false)
}

function onClose(): void {
  emit('update:show', false)
}
</script>

<template>
  <van-popup
    :show="show"
    position="bottom"
    round
    teleport="body"
    class="mh-pop"
    @update:show="emit('update:show', $event)"
  >
    <div class="mh-body">
      <header class="mh-head">
        <h4 class="mh-title">{{ weekText }}</h4>
        <button type="button" class="mh-close" aria-label="关闭" @click="onClose">
          <Icon name="X" :size="18" />
        </button>
      </header>

      <!-- 心情 -->
      <div class="mh-row">
        <span class="mh-label">心情</span>
        <div class="mh-group" role="group" aria-label="该小时心情">
          <button
            v-for="o in moodOpts"
            :key="o.value"
            type="button"
            class="mh-btn"
            :class="{ 'is-active': draftMood === o.value }"
            :style="draftMood === o.value
              ? { background: o.vars.bg, borderColor: o.vars.fg, color: o.vars.fg }
              : { color: 'var(--color-text-tertiary)' }"
            :aria-pressed="draftMood === o.value"
            :aria-label="o.label"
            @click="tapMood(o.value)"
          >
            <Icon :name="o.icon" :size="20" aria-hidden="true" />
          </button>
        </div>
        <span class="mh-current">{{ moodLabel(draftMood) }}</span>
      </div>

      <!-- 精力 -->
      <div class="mh-row">
        <span class="mh-label">精力</span>
        <div class="mh-group" role="group" aria-label="该小时精力">
          <button
            v-for="o in energyOpts"
            :key="o.value"
            type="button"
            class="mh-btn"
            :class="{ 'is-active': draftEnergy === o.value }"
            :style="draftEnergy === o.value
              ? { background: o.vars.bg, borderColor: o.vars.fg, color: o.vars.fg }
              : { color: 'var(--color-text-tertiary)' }"
            :aria-pressed="draftEnergy === o.value"
            :aria-label="o.label"
            @click="tapEnergy(o.value)"
          >
            <Icon :name="o.icon" :size="20" aria-hidden="true" />
          </button>
          <button
            type="button"
            class="mh-btn mh-clear"
            :class="{ 'is-active': draftEnergy === 0 }"
            :aria-pressed="draftEnergy === 0"
            aria-label="精力不填"
            @click="clearEnergyField"
          >
            <span class="mh-clear-text">不填</span>
          </button>
        </div>
        <span class="mh-current">{{ energyLabel(draftEnergy) }}</span>
      </div>

      <!-- 备注（每小时一刷，不延续） -->
      <div class="mh-note">
        <input
          v-model="draftNote"
          type="text"
          class="mh-note-input"
          placeholder="这个小时的想法…（≤50 字）"
          :maxlength="MOOD_NOTE_MAX"
        >
        <span class="mh-note-count">{{ draftNote.length }}/{{ MOOD_NOTE_MAX }}</span>
      </div>

      <p class="mh-hint">
        心情和精力不填就是沿用它上一条的值；备注只属于这一个小时。
      </p>

      <div class="mh-actions">
        <button type="button" class="mh-remove" @click="onRemove">清除这一条</button>
        <button type="button" class="mh-save" :disabled="saving" @click="onSave">
          {{ saving ? '保存中…' : '保存' }}
        </button>
      </div>
    </div>
  </van-popup>
</template>

<style lang="scss" scoped>
.mh-pop {
  /* 底部安全区（iOS 主屏 App） */
  padding-bottom: env(safe-area-inset-bottom, 0px);
}
.mh-body {
  padding: var(--space-5);
}
.mh-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--space-4);
}
.mh-title {
  margin: 0;
  font-family: var(--font-num);
  font-variant-numeric: tabular-nums;
  font-size: var(--fs-h4);
  font-weight: 600;
  color: var(--color-text-primary);
}
.mh-close {
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: var(--radius-md);
  background: var(--color-bg-hover);
  color: var(--color-text-secondary);
  padding: 0;
  -webkit-tap-highlight-color: transparent;
  &:active { transform: scale(0.94); }
  :deep(svg) { display: block; }
}

.mh-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 46px;
}
.mh-label {
  flex-shrink: 0;
  width: 30px;
  font-size: var(--fs-caption-sm);
  color: var(--color-text-tertiary);
}
.mh-group {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.mh-btn {
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
  > :deep(svg) { display: block; flex-shrink: 0; }
}
.mh-clear {
  width: auto;
  padding: 0 10px;
}
.mh-clear-text {
  font-size: var(--fs-caption-sm);
  font-weight: 500;
}
.mh-current {
  font-size: var(--fs-caption-sm);
  color: var(--color-text-secondary);
}

.mh-note {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: var(--space-3);
}
.mh-note-input {
  flex: 1;
  min-width: 0;
  height: 36px;
  padding: 0 10px;
  background: var(--color-bg-hover);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-md);
  font-size: var(--fs-caption);
  color: var(--color-text-primary);
  outline: none;
  &:focus { border-color: var(--color-primary); }
}
.mh-note-count {
  flex-shrink: 0;
  font-family: var(--font-num);
  font-size: var(--fs-micro);
  color: var(--color-text-tertiary);
}

.mh-hint {
  margin: var(--space-3) 0 0;
  font-size: var(--fs-micro);
  line-height: 1.5;
  color: var(--color-text-tertiary);
}

.mh-actions {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin-top: var(--space-4);
}
.mh-remove {
  flex-shrink: 0;
  height: 44px;
  padding: 0 var(--space-4);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-lg);
  background: transparent;
  font-size: var(--fs-body-sm);
  color: var(--color-danger-dark);
  -webkit-tap-highlight-color: transparent;
  &:active { background: var(--color-danger-light); }
}
.mh-save {
  flex: 1;
  height: 44px;
  border: 0;
  border-radius: var(--radius-lg);
  background: var(--color-primary);
  color: #FFFFFF;
  font-size: var(--fs-body-sm);
  font-weight: 600;
  box-shadow: var(--shadow-button);
  -webkit-tap-highlight-color: transparent;
  &:active { background: var(--color-primary-dark); }
  &:disabled { opacity: 0.6; }
}
</style>
