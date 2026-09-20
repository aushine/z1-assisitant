<script setup lang="ts">
/**
 * HabitEditSheet
 * 新建 / 编辑习惯底部弹层（移动端）
 *
 * SYNC-FROM-DESKTOP: life-assisitant-ui-desktop/src/components/HabitEditDrawer.tsx
 * SYNC-FROM-BACKEND: life-assisitant-api/internal/model/dto/habit.go（CreateHabitReq / UpdateHabitReq）
 * 最后同步：2026-09-18（Phase 3.2）
 *
 * 字段：title / description / icon / color / **category** / frequency /
 *      target_count / unit / **track_duration**
 * 严格按 spec/12-记录.md §4.1 + spec/03-设计系统.md
 *
 * Phase 3.2 补齐 category 与 track_duration —— 这两个字段后端一直支持
 * （`in:,sport,diet,life,study` 与 `track_duration`），桌面端抽屉也有，
 * 但移动端弹层此前缺失：因此移动端新建的习惯永远是 life 分类、
 * 且永远不记录打卡时长，与桌面端编辑同一习惯时会互相覆盖。
 */
import { computed, reactive, ref, watch } from 'vue'
import { HABIT_CATEGORIES } from '@/utils/category-dict'
import { getIconMapping } from '@/utils/icon-map'
import Icon from '@/components/icon/Icon.vue'
import type { CreateHabitReq, Habit, HabitCategory, HabitFrequency } from '@/api/types'

interface Props {
  show: boolean
  /** 编辑模式传入；新建传 null */
  habit: Habit | null
  /** 保存回调 */
  onSave: (data: CreateHabitReq) => Promise<boolean>
}

const props = defineProps<Props>()
const emit = defineEmits<{
  (e: 'update:show', v: boolean): void
}>()

// ==================== 预设 emoji ====================
const EMOJIS: string[] = ['💧', '🏃', '📚', '🧘', '🍎', '✍️', '😴', '🎯']
// ==================== 预设颜色 ====================
const COLORS: Array<{ value: string; bg: string; label: string }> = [
  { value: '#014DB2', bg: '#E0F2FF', label: '蓝' },
  { value: '#10B981', bg: '#D1FAE5', label: '绿' },
  { value: '#F59E0B', bg: '#FEF3C7', label: '琥珀' },
  { value: '#8B5CF6', bg: '#EDE9FE', label: '紫' },
]

// ==================== 频率选项 ====================
const FREQUENCIES: Array<{ value: HabitFrequency; label: string }> = [
  { value: 'daily', label: '每日' },
  { value: 'weekly', label: '每周' },
  { value: 'monthly', label: '每月' },
]

// ==================== 表单 ====================
const form = reactive<{
  title: string
  description: string
  icon: string
  color: string
  category: HabitCategory
  frequency: HabitFrequency
  target_count: number
  unit: string
  /** 是否记录打卡时长（开启后记录页打卡弹层的时长才有意义） */
  track_duration: boolean
}>({
  title: '',
  description: '',
  icon: '💧',
  color: '#014DB2',
  category: 'life',
  frequency: 'daily',
  target_count: 1,
  unit: '次',
  track_duration: false,
})

const titleError = ref('')
const submitting = ref(false)
const isEdit = computed(() => !!props.habit)
const titleMax = 50

// ==================== watch：每次打开重置 ====================
watch(
  () => props.show,
  (v) => {
    if (v) resetForm()
  }
)

function resetForm() {
  if (props.habit) {
    form.title = props.habit.title
    form.description = props.habit.description || ''
    form.icon = props.habit.icon
    form.color = props.habit.color
    form.category = props.habit.category ?? 'life'
    form.frequency = props.habit.frequency
    form.target_count = props.habit.target_count
    form.unit = props.habit.unit ?? ''
    form.track_duration = props.habit.track_duration ?? false
  } else {
    form.title = ''
    form.description = ''
    form.icon = '💧'
    form.color = '#014DB2'
    form.category = 'life'
    form.frequency = 'daily'
    form.target_count = 1
    form.unit = '次'
    form.track_duration = false
  }
  titleError.value = ''
}

// ==================== 关闭 ====================
function close() {
  if (submitting.value) return
  emit('update:show', false)
}

// ==================== 校验 ====================
function validateTitle(): boolean {
  const v = form.title.trim()
  if (!v) {
    titleError.value = '请输入习惯名'
    return false
  }
  if (v.length > titleMax) {
    titleError.value = `习惯名不能超过 ${titleMax} 字`
    return false
  }
  titleError.value = ''
  return true
}

function onTitleInput() {
  if (titleError.value && form.title.trim()) {
    titleError.value = ''
  }
}

// ==================== 提交 ====================
/** 提交：校验通过后调父组件传入的 onSave（prop） */
async function handleSave() {
  if (!validateTitle()) return
  submitting.value = true
  try {
    const payload: CreateHabitReq = {
      title: form.title.trim(),
      description: form.description.trim() || undefined,
      icon: form.icon,
      color: form.color,
      category: form.category,
      frequency: form.frequency,
      target_count: Math.max(1, Number(form.target_count) || 1),
      unit: form.unit.trim() || '次',
      track_duration: form.track_duration,
    }
    const ok = await props.onSave(payload)
    if (ok) {
      emit('update:show', false)
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[HabitEditSheet] save failed', e)
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <!-- ⚠️ teleport="body" 必留（iOS 弹层层叠坑，说明见 components/period/PeriodDaySheet.vue） -->
  <van-popup
    :show="show"
    position="bottom"
    :style="{ height: '85%' }"
    round
    closeable
    teleport="body"
    close-icon-position="top-left"
    :close-on-click-overlay="!submitting"
    @update:show="(v: boolean) => emit('update:show', v)"
  >
    <div class="habit-sheet">
      <van-nav-bar
        :title="isEdit ? '编辑习惯' : '新建习惯'"
        :left-text="submitting ? '' : '取消'"
        :left-arrow="false"
        :border="false"
        @click-left="close"
      >
        <template #right>
          <span
            class="save-btn"
            :class="{ 'is-disabled': submitting || !form.title.trim() }"
            @click="handleSave"
          >
            {{ submitting ? '保存中…' : '保存' }}
          </span>
        </template>
      </van-nav-bar>

      <div class="sheet-body">
        <van-form @submit.prevent="handleSave">
          <!-- 1. 名称 -->
          <div class="field-group">
            <van-field
              v-model="form.title"
              label=""
              placeholder="习惯名（必填）"
              maxlength="50"
              :error="!!titleError"
              :error-message="titleError"
              :disabled="submitting"
              clearable
              class="title-field"
              @update:model-value="onTitleInput"
            />
          </div>

          <!-- 2. 描述 -->
          <div class="field-group">
            <van-field
              v-model="form.description"
              label=""
              type="textarea"
              rows="2"
              autosize
              placeholder="描述（选填）"
              maxlength="200"
              :disabled="submitting"
              class="desc-field"
            />
          </div>

          <!-- 3. emoji -->
          <div class="field-group">
            <div class="cell-label">图标</div>
            <div class="emoji-grid">
              <button
                v-for="e in EMOJIS"
                :key="e"
                type="button"
                class="emoji-item"
                :class="{ 'is-active': form.icon === e }"
                :disabled="submitting"
                @click="form.icon = e"
              ><Icon :name="getIconMapping(e).icon" :size="20" /></button>
            </div>
          </div>

          <!-- 4. 颜色 -->
          <div class="field-group">
            <div class="cell-label">颜色</div>
            <div class="color-row">
              <button
                v-for="c in COLORS"
                :key="c.value"
                type="button"
                class="color-dot"
                :class="{ 'is-active': form.color === c.value }"
                :style="{ background: c.bg, color: c.value }"
                :disabled="submitting"
                :aria-label="c.label"
                @click="form.color = c.value"
              >
                <span v-if="form.color === c.value" class="check">✓</span>
              </button>
            </div>
          </div>

          <!-- 5. 分类（sport / diet / life / study） -->
          <div class="field-group">
            <div class="cell-label">分类</div>
            <div class="freq-row">
              <button
                v-for="c in HABIT_CATEGORIES"
                :key="c.id"
                type="button"
                class="freq-chip"
                :class="{ 'is-active': form.category === c.id }"
                :style="form.category === c.id ? { background: c.vars.bg, borderColor: c.vars.fg, color: c.vars.fg } : {}"
                :disabled="submitting"
                @click="form.category = c.id as HabitCategory"
              ><Icon :name="c.icon" :size="14" /> {{ c.label }}</button>
            </div>
          </div>

          <!-- 6. 频率 -->
          <div class="field-group">
            <div class="cell-label">频率</div>
            <div class="freq-row">
              <button
                v-for="f in FREQUENCIES"
                :key="f.value"
                type="button"
                class="freq-chip"
                :class="{ 'is-active': form.frequency === f.value }"
                :disabled="submitting"
                @click="form.frequency = f.value"
              >{{ f.label }}</button>
            </div>
          </div>

          <!-- 7. 目标次数 + 单位 -->
          <div class="field-group">
            <div class="cell-label">目标</div>
            <div class="target-row">
              <van-stepper
                v-model="form.target_count"
                :min="1"
                :max="99"
                :disabled="submitting"
                integer
                theme="round"
                button-size="28"
              />
              <van-field
                v-model="form.unit"
                label=""
                placeholder="次 / 分钟 / 页"
                maxlength="6"
                :disabled="submitting"
                class="unit-field"
              />
            </div>
          </div>

          <!-- 8. 是否记录打卡时长 -->
          <div class="field-group">
            <div class="switch-row">
              <div class="switch-text">
                <div class="switch-title">记录打卡时长</div>
                <div class="switch-desc">开启后打卡时可填写本次时长（分钟）</div>
              </div>
              <van-switch
                v-model="form.track_duration"
                :disabled="submitting"
                size="22px"
              />
            </div>
          </div>

          <div class="bottom-hint" aria-hidden="true" />
        </van-form>
      </div>
    </div>
  </van-popup>
</template>

<style lang="scss" scoped>
.habit-sheet {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--color-bg-app);
}

:deep(.van-nav-bar) {
  flex-shrink: 0;
  background: var(--color-bg-card);
}
:deep(.van-nav-bar__title) {
  font-size: var(--fs-h4);
  font-weight: 600;
  color: var(--color-text-primary);
}
:deep(.van-nav-bar__text) {
  color: var(--color-text-secondary);
  font-size: var(--fs-body);
}
.save-btn {
  font-size: var(--fs-body);
  font-weight: 600;
  color: var(--color-primary);
  padding: 4px 8px;
  cursor: pointer;
  user-select: none;
  &.is-disabled {
    color: var(--color-text-disabled);
    cursor: not-allowed;
  }
}

.sheet-body {
  flex: 1;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  padding: 8px 0;
}
.field-group {
  background: var(--color-bg-card);
  margin-bottom: 8px;
}

:deep(.title-field .van-field__control) {
  font-size: var(--fs-h4);
  font-weight: 600;
  color: var(--color-text-primary);
  padding: 8px 0;
}
:deep(.title-field .van-cell) { padding: 12px 16px; }
:deep(.desc-field .van-cell) {
  padding: 12px 16px;
  align-items: flex-start;
}
:deep(.desc-field .van-field__control) {
  font-size: var(--fs-body);
  color: var(--color-text-primary);
  min-height: 48px;
}

.cell-label {
  padding: 14px 16px 8px;
  font-size: var(--fs-body-sm);
  font-weight: 500;
  color: var(--color-text-tertiary);
}

/* emoji 8 选 1 */
.emoji-grid {
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  gap: 8px;
  padding: 0 16px 16px;
}
.emoji-item {
  aspect-ratio: 1;
  background: var(--color-bg-hover);
  border: 1.5px solid transparent;
  border-radius: 10px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
  -webkit-tap-highlight-color: transparent;
  &:active { transform: scale(0.93); }
  &.is-active {
    border-color: var(--color-primary);
    background: var(--color-primary-light);
  }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
}

/* 颜色 4 选 1 */
.color-row {
  display: flex;
  gap: 12px;
  padding: 0 16px 16px;
}
.color-dot {
  width: 40px;
  height: 40px;
  border: 2px solid transparent;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--fs-h3);
  font-weight: 700;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  &:active { transform: scale(0.92); }
  &.is-active {
    border-color: currentColor;
  }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
}
.check { line-height: 1; }

/* 频率 chips */
.freq-row {
  display: flex;
  gap: 8px;
  padding: 0 16px 16px;
}
.freq-chip {
  flex: 1;
  height: 36px;
  font-size: var(--fs-caption);
  font-weight: 500;
  color: var(--color-text-secondary);
  background: var(--color-bg-hover);
  border: 1px solid transparent;
  border-radius: 8px;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  &:active { transform: scale(0.97); }
  &.is-active {
    color: var(--color-primary);
    background: var(--color-primary-light);
    border-color: var(--color-primary);
    font-weight: 600;
  }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
}

/* 目标 + 单位 */
.target-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 16px 16px;
}
:deep(.target-row .van-stepper) {
  flex-shrink: 0;
}
.unit-field {
  flex: 1;
  background: var(--color-bg-app);
  border-radius: 8px;
  padding: 0;
}
:deep(.unit-field .van-cell) {
  padding: 8px 12px;
}
:deep(.unit-field .van-field__control) {
  font-size: var(--fs-body);
  color: var(--color-text-primary);
  text-align: left;
}

/* 打卡时长开关 */
.switch-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px;
}
.switch-text { flex: 1; min-width: 0; }
.switch-title {
  font-size: var(--fs-body);
  color: var(--color-text-primary);
}
.switch-desc {
  margin-top: 2px;
  font-size: var(--fs-caption-sm);
  color: var(--color-text-tertiary);
}

.bottom-hint { height: 24px; }
</style>
