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
 *
 * 260922（spec-20260922-v2/04 §4.1）：
 *   - 8 格 emoji 网格 → 单行「已选图标 + 更换 ›」，点开 **IconPicker**（lucide）；
 *   - 4 个固定分类 chip → `CategoryTiles` 平铺（store 优先，用户可新增）+「管理 ›」；
 *   - 新建默认 icon = ''（**继承分类图标**，04 §4.2 优先级链）；
 *   - 存量 emoji 照常渲染，本次编辑保存时顺手换成 `lucide:<Name>`（与账户 Q10 同一套）。
 */
import { computed, reactive, ref, watch } from 'vue'
import { resolveHabitIconView } from '@/utils/category-dict'
import { getIconMapping } from '@/utils/icon-map'
import { ICONS } from '@/components/icon/names'
import type { IconName } from '@/components/icon/names'
import Icon from '@/components/icon/Icon.vue'
import IconPicker from '@/components/finance/IconPicker.vue'
import CategoryTiles from '@/components/finance/CategoryTiles.vue'
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

// ==================== 图标选择（IconPicker，04 §4.3） ====================
const iconPickerShow = ref(false)

/** 摘要行展示的图标：habit.icon > 分类.icon > 分类.emoji > Pin（store 优先、常量兜底） */
const iconView = computed(() => resolveHabitIconView({ icon: form.icon, category: form.category }))

/** IconPicker 的 modelValue 要的是**裸名**（无 lucide: 前缀）；存量 emoji 视为未选 */
const pickerIcon = computed<string | null>(() => {
  const raw = form.icon
  if (!raw) return null
  const bare = raw.startsWith('lucide:') ? raw.slice(7) : raw
  return bare in ICONS ? (bare as IconName) : null
})

function openIconPicker() {
  if (submitting.value) return
  iconPickerShow.value = true
}

function onPickIcon(name: string) {
  // 落库口径 `lucide:<Name>`（04 §4.3）
  form.icon = `lucide:${name}`
}

/**
 * Q10：新建/编辑保存时统一图标引用 ——
 * 空 = 继承分类图标；lucide 引用原样；存量 emoji 顺手换成 `lucide:<映射名>`。
 */
function iconForPayload(raw: string): string {
  if (!raw) return ''
  if (raw.startsWith('lucide:')) return raw
  if (raw in ICONS) return `lucide:${raw}`
  return `lucide:${getIconMapping(raw).icon}`
}

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
  icon: '', // 空 = 继承分类图标（04 §4.2 优先级链）
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
    form.icon = '' // 新建默认「跟随分类」
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
      icon: iconForPayload(form.icon),
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
  <!--
    ⚠️ teleport="body" 必留（iOS 弹层层叠坑，说明见 components/period/PeriodDaySheet.vue）
    ⚠️ 不要加 `closeable`：Vant 的关闭叉叉固定在弹层左上角，与 nav-bar 的「取消」
       并排出现两个关闭入口（260921 点名去掉的「灰色叉叉」）。
  -->
  <van-popup
    :show="show"
    position="bottom"
    :style="{ height: '85%' }"
    round
    teleport="body"
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

          <!-- 3. 图标：单行摘要 +「更换 ›」→ IconPicker（04 §4.1，替代 8 格 emoji） -->
          <div class="field-group">
            <div class="cell-label">图标</div>
            <div class="icon-row" role="button" tabindex="0" :aria-disabled="submitting" @click="openIconPicker">
              <span class="icon-preview" :style="{ background: (form.color || '#014DB2') + '22', color: iconView.vars.fg }">
                <Icon :name="iconView.icon" :size="20" />
              </span>
              <span class="icon-summary">{{ form.icon ? '已自选图标' : '跟随分类图标' }}</span>
              <span class="icon-change">更换 ›</span>
            </div>
            <IconPicker
              v-model:show="iconPickerShow"
              :model-value="pickerIcon"
              @select="onPickIcon"
            />
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

          <!-- 5. 分类（store 优先平铺 +「管理 ›」，04 §4.1；一级 ⇒ 点即选中无弹窗） -->
          <div class="field-group">
            <div class="cell-label">分类</div>
            <CategoryTiles
              v-model="form.category"
              domain="habit"
              :disabled="submitting"
            />
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

/* 图标单行摘要（04 §4.1：替代 emoji 8 格，形态与财务的图标行统一） */
.icon-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 4px 16px 16px;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  &:active { opacity: 0.7; }
  &[aria-disabled="true"] { opacity: 0.5; cursor: not-allowed; }
}
.icon-preview {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  line-height: 1;
}
.icon-summary {
  flex: 1;
  min-width: 0;
  font-size: var(--fs-body);
  color: var(--color-text-primary);
}
.icon-change {
  font-size: var(--fs-body-sm);
  color: var(--color-primary);
  flex-shrink: 0;
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
