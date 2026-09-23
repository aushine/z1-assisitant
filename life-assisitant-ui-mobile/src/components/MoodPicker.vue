<script setup lang="ts">
/**
 * MoodPicker —— 今日心情 / 精力点选（移动端）
 *
 * SYNC-FROM-DESKTOP: life-assisitant-ui-desktop/src/pages/home/index.tsx
 *                    （MOOD_OPTIONS / ENERGY_OPTIONS + onPickMood / onPickEnergy）
 * SYNC-FROM-BACKEND: life-assisitant-api/internal/model/dto/mood.go
 * 最后同步：2026-09-19（改为按小时记录；mood 已可空，只选精力不再补默认心情）
 *
 * 语义（与后端 + 桌面端严格一致）：
 *   - mood 1-5；energy 1-3，**0 表示不填**；两者**都可独立为空**
 *   - 不传 `hour` ⇒ 服务端落在**当前小时**，所以「点选 = 记录此刻」
 *   - 点选即 upsert（PUT /moods），只发被点的那一个字段（缺省 = 不动既有值），
 *     这正是「心情/精力向前延续」的实现方式；失败提示在 store 里
 *
 * 两种形态：
 *   - 默认（紧凑）：一行心情 + 一行精力，用于首页问候条
 *   - `show-note`：额外带 50 字备注输入
 * ⚠️ 记录页的「今日心情」已改用 `MoodSection.vue`（时间线 + 此刻快捷区），
 *    不再使用本组件的 `show-note` 形态；本组件保留给首页。
 */
import { computed, ref, watch } from 'vue'
import { ENERGY_LEVELS, MOOD_LEVELS, MOOD_NOTE_MAX, useMoodStore } from '@/stores/mood'
import Icon from '@/components/icon/Icon.vue'
import type { EnergyValue, MoodValue } from '@/api/types'

const props = withDefaults(
  defineProps<{
    /** 是否显示备注输入（记录页用） */
    showNote?: boolean
    /** 只读（非今天时禁用点选） */
    readonly?: boolean
  }>(),
  { showNote: false, readonly: false }
)

const emit = defineEmits<{
  (e: 'changed'): void
}>()

const moodStore = useMoodStore()

/**
 * 心情 / 精力档位（icon + tint + vars 已在 utils/mood-dict.ts 里解析好）。
 * 选中态的颜色由按钮的 `color` 承载，Icon 默认继承 currentColor，
 * 这样图标描边会跟着语义色走（02 §5.1「默认继承，只有携带信息时才着色」）。
 */
const moodOptions = MOOD_LEVELS
/** 精力 3 档 */
const energyOptions = ENERGY_LEVELS

const activeMood = computed(() => moodStore.moodValue)
const activeEnergy = computed(() => moodStore.energyValue)

/** 备注草稿（不在输入过程中直接 upsert，避免每敲一个字发一次请求） */
const noteDraft = ref(moodStore.note)
const noteEditing = ref(false)

watch(
  () => moodStore.note,
  (v) => {
    if (!noteEditing.value) noteDraft.value = v
  }
)

async function onPickMood(mood: MoodValue): Promise<void> {
  if (props.readonly) return
  const ok = await moodStore.setMood(mood)
  if (ok) {
    emit('changed')
  }
}

async function onPickEnergy(energy: EnergyValue): Promise<void> {
  if (props.readonly) return
  // 2026-09-19 起心情改为可空（按小时记录，心情/精力独立延续）：
  // 只选精力不再默认补一个「一般(3)」—— 那是旧「一天一条 + mood NOT NULL」时代的补丁，
  // 现在会凭空发明一个用户没有选过的心情。
  const ok = await moodStore.setEnergy(energy)
  if (ok) {
    emit('changed')
  }
}

/** 失焦 / 回车时落库，减少请求次数 */
async function commitNote(): Promise<void> {
  noteEditing.value = false
  if (props.readonly) return
  const next = noteDraft.value.slice(0, MOOD_NOTE_MAX)
  if (next === moodStore.note) return
  if (!moodStore.hasRecord) return
  const ok = await moodStore.setNote(next)
  if (ok) emit('changed')
}

function onNoteFocus(): void {
  noteEditing.value = true
}
</script>

<template>
  <div class="mood-picker" :class="{ 'is-readonly': readonly }">
    <!-- 心情 5 档 -->
    <div class="mp-row">
      <span class="mp-label">心情</span>
      <div class="mp-group" role="group" aria-label="今日心情">
        <button
          v-for="o in moodOptions"
          :key="o.value"
          type="button"
          class="mp-btn"
          :class="{ 'is-active': activeMood === o.value }"
          :style="activeMood === o.value
            ? { background: o.vars.bg, borderColor: o.vars.fg, color: o.vars.fg }
            : { color: 'var(--color-text-tertiary)' }"
          :disabled="readonly"
          :aria-label="o.label"
          :aria-pressed="activeMood === o.value"
          @click="onPickMood(o.value)"
        >
          <Icon :name="o.icon" :size="20" aria-hidden="true" />
        </button>
      </div>
      <span v-if="activeMood" class="mp-current">
        {{ moodOptions.find((o) => o.value === activeMood)?.label }}
      </span>
    </div>

    <!-- 精力 3 档 -->
    <div class="mp-row">
      <span class="mp-label">精力</span>
      <div class="mp-group" role="group" aria-label="今日精力">
        <button
          v-for="o in energyOptions"
          :key="o.value"
          type="button"
          class="mp-btn"
          :class="{ 'is-active': activeEnergy === o.value }"
          :style="activeEnergy === o.value
            ? { background: o.vars.bg, borderColor: o.vars.fg, color: o.vars.fg }
            : { color: 'var(--color-text-tertiary)' }"
          :disabled="readonly"
          :aria-label="o.label"
          :aria-pressed="activeEnergy === o.value"
          @click="onPickEnergy(o.value)"
        >
          <Icon :name="o.icon" :size="20" aria-hidden="true" />
        </button>
      </div>
      <span v-if="activeEnergy" class="mp-current">
        {{ energyOptions.find((o) => o.value === activeEnergy)?.label }}
      </span>
    </div>

    <!-- 备注（记录页用） -->
    <div v-if="showNote" class="mp-note">
      <input
        v-model="noteDraft"
        type="text"
        class="mp-note-input"
        :placeholder="moodStore.hasRecord ? '写点什么（选填，50 字内）' : '先选个心情吧'"
        :maxlength="MOOD_NOTE_MAX"
        :disabled="readonly || !moodStore.hasRecord"
        @focus="onNoteFocus"
        @blur="commitNote"
        @keyup.enter="($event.target as HTMLInputElement).blur()"
      >
      <span class="mp-note-count">{{ noteDraft.length }}/{{ MOOD_NOTE_MAX }}</span>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.mood-picker {
  display: flex;
  flex-direction: column;
  gap: 8px;
  &.is-readonly { opacity: 0.6; }
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
}
.mp-btn {
  width: 34px;
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-bg-hover);
  border: 1.5px solid transparent;
  border-radius: 10px;
  padding: 0;
  cursor: pointer;
  transition: all var(--duration-fast) var(--ease-default);
  -webkit-tap-highlight-color: transparent;
  &:active { transform: scale(0.94); }
  &.is-active { transform: scale(1.04); }
  &:disabled { cursor: not-allowed; }
}
/* 图标颜色由按钮的 currentColor 提供（选中 = 语义色，未选 = 弱化色） */
.mp-btn > svg {
  display: block;
  flex-shrink: 0;
}
.mp-current {
  font-size: var(--fs-caption-sm);
  font-weight: 500;
  color: var(--color-text-secondary);
}

.mp-note {
  display: flex;
  align-items: center;
  gap: 8px;
}
.mp-note-input {
  flex: 1;
  min-width: 0;
  height: 34px;
  padding: 0 10px;
  background: var(--color-bg-hover);
  border: 1px solid var(--color-border-light);
  border-radius: 8px;
  font-size: var(--fs-caption);
  color: var(--color-text-primary);
  outline: none;
  &:focus { border-color: var(--color-primary); }
  &:disabled { color: var(--color-text-disabled); }
}
.mp-note-count {
  flex-shrink: 0;
  font-size: var(--fs-micro);
  font-family: var(--font-num);
  color: var(--color-text-tertiary);
}
</style>
