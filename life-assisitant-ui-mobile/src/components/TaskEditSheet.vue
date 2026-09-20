<script setup lang="ts">
/**
 * TaskEditSheet —— 新建 / 编辑任务底部弹层（移动端 · 80vh）
 *
 * SYNC-FROM-DESKTOP: life-assisitant-ui-desktop/src/components/TaskEditDrawer.tsx
 * SYNC-FROM-BACKEND: life-assisitant-api/internal/model/dto/task.go
 *                    （CreateTaskReq / UpdateTaskReq / SubtaskReq）
 * 最后同步：2026-09-18（Phase 2.6）
 *
 * 字段：title / description / due_date / due_time / reminder_at /
 *       priority / category_id / recurrence_rule / subtasks
 *
 * Phase 2.6 新增：
 *   - 重复规则（不重复 / 每天 / 每周 / 每月 → RRULE）
 *   - 提醒时间（日期 + 时间 → ISO datetime）
 *   - 子任务编辑（增 / 删 / 改 / 勾选）
 *   - 分类改为走 `utils/category-dict` 的 `c_*` id
 *
 * ⚠️ 与桌面端的刻意差异：
 *   桌面端提醒时间只用一个 TimePicker（产出 `HH:mm`），而后端
 *   `CreateTaskReq.ReminderAt` 的契约是 **ISO datetime**（`v:"length:0,30"`）。
 *   移动端改为「日期 + 时间」两个选择器，拼成带本地时区偏移的 ISO，
 *   否则提醒时间落库后会被解析成 0001-01-01 之类。
 *
 * ⚠️ 分类 id 修复：旧实现硬编码 `cat_work` / `cat_other`，与
 *   `category-dict` 及桌面端的 `c_work` / `c_other` 不一致 ——
 *   后端只存 category_id、不返回 category_emoji，字典查不中就渲染不出图标。
 *   现统一为字典里的 `c_*`。
 */
import { computed, reactive, ref, watch } from 'vue'
import { showSuccessToast } from 'vant'
import type { CreateTaskReq, SubtaskReq, Task, TaskPriority } from '@/api/types'
import { TASK_PRIORITIES, DEFAULT_TASK_PRIORITY } from '@/utils/task-dict'
import { TASK_CATEGORIES } from '@/utils/category-dict'
import { todayDate, addDays, toLocalISOString } from '@/utils/date'
import Icon from '@/components/icon/Icon.vue'

interface Props {
  show: boolean
  /** 编辑模式传入；新建传 null */
  task: Task | null
  /** 保存回调：返回 true=成功 false=失败（由父组件 toast 提示） */
  onSave: (data: CreateTaskReq) => Promise<boolean>
}

const props = defineProps<Props>()
const emit = defineEmits<{
  (e: 'update:show', v: boolean): void
  (e: 'saved', task: Task | null): void
}>()

// ==================== 选项 ====================
/** 优先级（B1 修复：此前硬编码 P0~P3，真实值是 relaxed/normal/important/urgent） */
const PRIORITIES = TASK_PRIORITIES
/** 分类（走 category-dict 唯一真相，id 与后端 / 桌面端一致：c_work…） */
const CATEGORIES = TASK_CATEGORIES

/** 重复规则（RRULE 子集，与桌面端 RECURRENCE_OPTIONS 一致） */
const RECURRENCE_OPTIONS = [
  { value: '', label: '不重复' },
  { value: 'FREQ=DAILY', label: '每天' },
  { value: 'FREQ=WEEKLY', label: '每周' },
  { value: 'FREQ=MONTHLY', label: '每月' },
]

// ==================== 子任务编辑态 ====================
interface SubtaskForm {
  /** 已有子任务的真 id；新建行为空 */
  id?: string
  title: string
  is_completed: boolean
  order: number
}

// ==================== 表单 ====================
const form = reactive<{
  title: string
  description: string
  due_date: string
  due_time: string
  reminder_date: string
  reminder_time: string
  priority: TaskPriority
  category_id: string
  recurrence_rule: string
}>({
  title: '',
  description: '',
  due_date: '',
  due_time: '',
  reminder_date: '',
  reminder_time: '',
  priority: DEFAULT_TASK_PRIORITY,
  category_id: 'c_other',
  recurrence_rule: '',
})

const subtasks = ref<SubtaskForm[]>([])

const titleError = ref('')
const submitting = ref(false)

const isEdit = computed(() => !!props.task)
const titleMax = 100
// 后端 title 约束 length:1,200，但移动端 UI 沿用桌面端的 100 字提示
const descMax = 500

// ==================== Picker 弹层控制 ====================
const datePickerShow = ref(false)
const timePickerShow = ref(false)
const reminderDatePickerShow = ref(false)
const reminderTimePickerShow = ref(false)
const recurrencePickerShow = ref(false)

const minDate = new Date(2020, 0, 1)
const maxDate = new Date(2035, 11, 31)

/** van-date-picker / van-time-picker 的 v-model 列值是 string[]（Vant 4 契约） */
const datePickerValue = ref<string[]>([])
const timePickerValue = ref<string[]>([])
const reminderDatePickerValue = ref<string[]>([])
const reminderTimePickerValue = ref<string[]>([])

/** 重复规则 picker 的选中索引 */
const recurrenceIndex = ref(0)

/** 显示文字 */
const dueDateText = computed(() => form.due_date || '未设置')
const dueTimeText = computed(() => form.due_time || '未设置')
const recurrenceText = computed(
  () => RECURRENCE_OPTIONS.find((o) => o.value === form.recurrence_rule)?.label ?? '不重复'
)

// ==================== 监听 show：每次打开重置表单 ====================
watch(
  () => props.show,
  (v) => {
    if (v) resetForm()
  }
)

function resetForm() {
  const t = props.task
  form.title = t?.title ?? ''
  form.description = t?.description ?? ''
  form.due_date = t?.due_date ?? ''
  form.due_time = t?.due_time ?? ''
  form.priority = t?.priority ?? DEFAULT_TASK_PRIORITY
  form.category_id = t?.category_id || 'c_other'
  form.recurrence_rule = t?.recurrence_rule ?? ''

  // reminder_at 是 ISO datetime，拆成「日期 + 时间」两段
  if (t?.reminder_at) {
    const d = new Date(t.reminder_at)
    if (Number.isNaN(d.getTime())) {
      form.reminder_date = ''
      form.reminder_time = ''
    } else {
      form.reminder_date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
      form.reminder_time = `${pad(d.getHours())}:${pad(d.getMinutes())}`
    }
  } else {
    form.reminder_date = ''
    form.reminder_time = ''
  }

  subtasks.value = (t?.subtasks ?? []).map((s, i) => ({
    id: s.id,
    title: s.title,
    is_completed: s.is_completed,
    order: s.order ?? i,
  }))

  titleError.value = ''
  syncAllPickers()
}

function syncAllPickers() {
  syncDatePicker()
  syncTimePicker()
  syncReminderDatePicker()
  syncReminderTimePicker()
  const idx = RECURRENCE_OPTIONS.findIndex((o) => o.value === form.recurrence_rule)
  recurrenceIndex.value = idx >= 0 ? idx : 0
}

// ==================== 弹层关闭 ====================
function close() {
  if (submitting.value) return
  emit('update:show', false)
}

// ==================== 标题校验 ====================
function validateTitle(): boolean {
  const v = form.title.trim()
  if (!v) {
    titleError.value = '请输入任务标题'
    return false
  }
  if (v.length > titleMax) {
    titleError.value = `标题不能超过 ${titleMax} 字`
    return false
  }
  titleError.value = ''
  return true
}

function onTitleInput() {
  if (titleError.value && form.title.trim()) titleError.value = ''
}

// ==================== 截止日期 picker ====================
function openDatePicker() {
  if (submitting.value) return
  syncDatePicker()
  datePickerShow.value = true
}
function syncDatePicker() {
  // 列值是字符串形式的「索引」：月/日列为 0 基
  if (form.due_date) {
    const [y, m, d] = form.due_date.split('-').map(Number)
    datePickerValue.value = [String(y), String(m - 1), String(d - 1)]
  } else {
    const now = new Date()
    datePickerValue.value = [String(now.getFullYear()), String(now.getMonth()), String(now.getDate() - 1)]
  }
}
function onDatePickerConfirm({ selectedValues }: { selectedValues: string[] }) {
  const [y, m, d] = selectedValues
  form.due_date = `${y}-${pad(m)}-${pad(d)}`
  // 设了截止日期但没设提醒日期时，顺手把提醒日期也填上，减少一次操作
  if (!form.reminder_date) form.reminder_date = form.due_date
  datePickerShow.value = false
}
function clearDate() {
  form.due_date = ''
  datePickerShow.value = false
}

// ==================== 截止时间 picker ====================
function openTimePicker() {
  if (submitting.value) return
  syncTimePicker()
  timePickerShow.value = true
}
function syncTimePicker() {
  if (form.due_time) {
    const [h, m] = form.due_time.split(':').map(Number)
    timePickerValue.value = [String(h), String(m)]
  } else {
    timePickerValue.value = ['9', '0']
  }
}
function onTimePickerConfirm({ selectedValues }: { selectedValues: string[] }) {
  const [h, m] = selectedValues
  form.due_time = `${pad(h)}:${pad(m)}`
  timePickerShow.value = false
}
function clearTime() {
  form.due_time = ''
  timePickerShow.value = false
}

// ==================== 提醒日期 / 时间 picker（Phase 2.6） ====================
function openReminderDatePicker() {
  if (submitting.value) return
  syncReminderDatePicker()
  reminderDatePickerShow.value = true
}
function syncReminderDatePicker() {
  const base = form.reminder_date || form.due_date
  if (base) {
    const [y, m, d] = base.split('-').map(Number)
    reminderDatePickerValue.value = [String(y), String(m - 1), String(d - 1)]
  } else {
    const now = new Date()
    reminderDatePickerValue.value = [
      String(now.getFullYear()),
      String(now.getMonth()),
      String(now.getDate() - 1),
    ]
  }
}
function onReminderDateConfirm({ selectedValues }: { selectedValues: string[] }) {
  const [y, m, d] = selectedValues
  form.reminder_date = `${y}-${pad(m)}-${pad(d)}`
  if (!form.reminder_time) form.reminder_time = '09:00'
  reminderDatePickerShow.value = false
}
function openReminderTimePicker() {
  if (submitting.value) return
  if (!form.reminder_date) form.reminder_date = form.due_date || todayDate()
  syncReminderTimePicker()
  reminderTimePickerShow.value = true
}
function syncReminderTimePicker() {
  if (form.reminder_time) {
    const [h, m] = form.reminder_time.split(':').map(Number)
    reminderTimePickerValue.value = [String(h), String(m)]
  } else {
    reminderTimePickerValue.value = ['9', '0']
  }
}
function onReminderTimeConfirm({ selectedValues }: { selectedValues: string[] }) {
  const [h, m] = selectedValues
  form.reminder_time = `${pad(h)}:${pad(m)}`
  reminderTimePickerShow.value = false
}
function clearReminder() {
  form.reminder_date = ''
  form.reminder_time = ''
  reminderDatePickerShow.value = false
  reminderTimePickerShow.value = false
}

/** 快捷：明天 09:00 提醒 */
function quickTomorrow() {
  form.reminder_date = addDays(todayDate(), 1)
  form.reminder_time = '09:00'
}

// ==================== 重复规则 picker ====================
function openRecurrencePicker() {
  if (submitting.value) return
  const idx = RECURRENCE_OPTIONS.findIndex((o) => o.value === form.recurrence_rule)
  recurrenceIndex.value = idx >= 0 ? idx : 0
  recurrencePickerShow.value = true
}
function onRecurrenceConfirm({ selectedOptions }: { selectedOptions: Array<{ value?: string }> }) {
  const picked = selectedOptions?.[0]
  form.recurrence_rule = picked?.value ?? ''
  recurrencePickerShow.value = false
}

// ==================== 分类 ====================
function selectCategory(id: string) {
  // 再点一次取消选择（与桌面端 onPickCategory 一致），但保留兜底分类
  form.category_id = form.category_id === id ? 'c_other' : id
}

// ==================== 子任务（Phase 2.6） ====================
function addSubtask() {
  subtasks.value.push({
    title: '',
    is_completed: false,
    order: subtasks.value.length,
  })
}

function removeSubtask(index: number) {
  subtasks.value.splice(index, 1)
  subtasks.value.forEach((s, i) => { s.order = i })
}

function toggleSubtaskDone(index: number) {
  const s = subtasks.value[index]
  if (s) s.is_completed = !s.is_completed
}

// ==================== 提交 ====================
async function handleSave() {
  if (!validateTitle()) return
  submitting.value = true
  try {
    const validSubtasks: SubtaskReq[] = subtasks.value
      .filter((s) => s.title.trim())
      .map((s, i) => ({
        ...(s.id ? { id: s.id } : {}),
        title: s.title.trim(),
        is_completed: s.is_completed,
        order: i,
      }))

    const payload: CreateTaskReq = {
      title: form.title.trim(),
      description: form.description.trim() || undefined,
      priority: form.priority,
      category_id: form.category_id,
      due_date: form.due_date || undefined,
      due_time: form.due_time || undefined,
      reminder_at: buildReminderISO(),
      recurrence_rule: form.recurrence_rule || undefined,
      subtasks: validSubtasks.length > 0 ? validSubtasks : undefined,
    }

    const ok = await props.onSave(payload)
    if (ok) {
      showSuccessToast(isEdit.value ? '任务已更新' : '任务已创建')
      emit('saved', null)
      emit('update:show', false)
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[TaskEditSheet] save failed', e)
  } finally {
    submitting.value = false
  }
}

/**
 * 把「提醒日期 + 提醒时间」拼成带本地时区偏移的 ISO datetime。
 *
 * ⚠️ 后端 `ReminderAt` 是 `time.Time`（解析 ISO），不是 `HH:mm`。
 * 这里必须用 `toLocalISOString`（本地时区带偏移），
 * 不能用 `toISOString()`（UTC，东八区会整体偏 8 小时）。
 */
function buildReminderISO(): string | undefined {
  if (!form.reminder_date) return undefined
  const time = form.reminder_time || '09:00'
  const d = new Date(`${form.reminder_date}T${time}:00`)
  if (Number.isNaN(d.getTime())) return undefined
  return toLocalISOString(d)
}

function pad(n: string | number): string {
  return String(n).padStart(2, '0')
}
</script>

<template>
  <!-- ⚠️ teleport="body" 必留（iOS 弹层层叠坑，说明见 components/period/PeriodDaySheet.vue） -->
  <van-popup
    :show="show"
    position="bottom"
    :style="{ height: '84%' }"
    round
    closeable
    teleport="body"
    close-icon-position="top-left"
    :close-on-click-overlay="!submitting"
    @update:show="(v: boolean) => emit('update:show', v)"
  >
    <div class="task-sheet">
      <!-- 顶部 NavBar -->
      <van-nav-bar
        :title="isEdit ? '编辑任务' : '新建任务'"
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
          >{{ submitting ? '保存中…' : '保存' }}</span>
        </template>
      </van-nav-bar>

      <div class="sheet-body">
        <van-form @submit.prevent="handleSave">
          <!-- 1. 标题 -->
          <div class="field-group">
            <van-field
              v-model="form.title"
              label=""
              placeholder="任务标题（必填）"
              maxlength="100"
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
              rows="3"
              autosize
              placeholder="详细描述（选填）"
              :maxlength="descMax"
              show-word-limit
              :disabled="submitting"
              class="desc-field"
            />
          </div>

          <!-- 3. 截止日期 -->
          <div class="field-group">
            <van-cell
              title="截止日期"
              :value="dueDateText"
              :is-link="!submitting"
              :clickable="!submitting"
              class="picker-cell"
              @click="openDatePicker"
            >
              <template #right-icon>
                <span
                  v-if="form.due_date"
                  class="clear-icon"
                  role="button"
                  aria-label="清除日期"
                  @click.stop="clearDate"
                >×</span>
              </template>
            </van-cell>
          </div>

          <!-- 4. 截止时间 -->
          <div class="field-group">
            <van-cell
              title="截止时间"
              :value="dueTimeText"
              :is-link="!submitting"
              :clickable="!submitting"
              class="picker-cell"
              @click="openTimePicker"
            >
              <template #right-icon>
                <span
                  v-if="form.due_time"
                  class="clear-icon"
                  role="button"
                  aria-label="清除时间"
                  @click.stop="clearTime"
                >×</span>
              </template>
            </van-cell>
          </div>

          <!-- 5. 提醒（Phase 2.6） -->
          <div class="field-group">
            <van-cell
              title="提醒日期"
              :value="form.reminder_date || '未设置'"
              :is-link="!submitting"
              :clickable="!submitting"
              class="picker-cell"
              @click="openReminderDatePicker"
            >
              <template #right-icon>
                <span
                  v-if="form.reminder_date"
                  class="clear-icon"
                  role="button"
                  aria-label="清除提醒"
                  @click.stop="clearReminder"
                >×</span>
              </template>
            </van-cell>
            <van-cell
              title="提醒时间"
              :value="form.reminder_time || '未设置'"
              :is-link="!submitting"
              :clickable="!submitting"
              class="picker-cell"
              @click="openReminderTimePicker"
            />
            <div class="quick-row">
              <button
                type="button"
                class="quick-chip"
                :disabled="submitting"
                @click="quickTomorrow"
              >明天 09:00</button>
              <span class="quick-hint">提醒时间为本地时区</span>
            </div>
          </div>

          <!-- 6. 重复规则（Phase 2.6） -->
          <div class="field-group">
            <van-cell
              title="重复"
              :value="recurrenceText"
              :is-link="!submitting"
              :clickable="!submitting"
              class="picker-cell"
              @click="openRecurrencePicker"
            />
          </div>

          <!-- 7. 优先级 -->
          <div class="field-group">
            <div class="cell-label">优先级</div>
            <div class="priority-chips">
              <button
                v-for="p in PRIORITIES"
                :key="p.value"
                type="button"
                class="priority-chip"
                :class="{ 'is-active': form.priority === p.value }"
                :style="form.priority === p.value
                  ? { background: p.bg, color: p.fg, borderColor: p.fg }
                  : {}"
                :disabled="submitting"
                @click="form.priority = p.value"
              >{{ p.label }}</button>
            </div>
          </div>

          <!-- 8. 分类 -->
          <div class="field-group">
            <div class="cell-label">分类</div>
            <div class="category-grid">
              <button
                v-for="c in CATEGORIES"
                :key="c.id"
                type="button"
                class="category-item"
                :class="{ 'is-active': form.category_id === c.id }"
                :disabled="submitting"
                @click="selectCategory(c.id)"
              >
                <span class="cat-emoji" :style="{ background: c.vars.bg, color: c.vars.fg }">
                  <Icon :name="c.icon" :size="16" />
                </span>
                <span class="cat-name">{{ c.label }}</span>
              </button>
            </div>
          </div>

          <!-- 9. 子任务（Phase 2.6） -->
          <div class="field-group">
            <div class="cell-label">
              子任务
              <span v-if="subtasks.length > 0" class="cell-label-count">
                {{ subtasks.filter((s) => s.is_completed).length }}/{{ subtasks.length }}
              </span>
            </div>

            <ul v-if="subtasks.length > 0" class="subtask-list">
              <li v-for="(s, i) in subtasks" :key="s.id ?? `new-${i}`" class="subtask-row">
                <button
                  type="button"
                  class="st-check"
                  :class="{ 'is-checked': s.is_completed }"
                  :aria-label="s.is_completed ? '标记未完成' : '标记完成'"
                  :disabled="submitting"
                  @click="toggleSubtaskDone(i)"
                >
                  <span v-if="s.is_completed" aria-hidden="true">✓</span>
                </button>
                <input
                  v-model="s.title"
                  type="text"
                  class="st-input"
                  placeholder="子任务标题"
                  maxlength="200"
                  :disabled="submitting"
                >
                <button
                  type="button"
                  class="st-del"
                  aria-label="删除子任务"
                  :disabled="submitting"
                  @click="removeSubtask(i)"
                >×</button>
              </li>
            </ul>

            <button
              type="button"
              class="add-subtask"
              :disabled="submitting"
              @click="addSubtask"
            >＋ 添加子任务</button>
          </div>

          <!-- 10. 删除提醒的兜底入口（存在提醒时显示） -->
          <div v-if="form.reminder_date" class="field-group">
            <van-cell
              title="清除提醒"
              is-link
              class="picker-cell danger-cell"
              @click="clearReminder"
            />
          </div>

          <div class="bottom-hint" aria-hidden="true" />
        </van-form>
      </div>

      <!-- 截止日期选择器 -->
      <van-popup v-model:show="datePickerShow" position="bottom" round teleport="body" :style="{ height: '50%' }">
        <van-date-picker
          v-model="datePickerValue"
          :min-date="minDate"
          :max-date="maxDate"
          title="选择截止日期"
          :columns-type="['year', 'month', 'day']"
          @confirm="onDatePickerConfirm"
          @cancel="datePickerShow = false"
        />
      </van-popup>

      <!-- 截止时间选择器 -->
      <van-popup v-model:show="timePickerShow" position="bottom" round teleport="body" :style="{ height: '40%' }">
        <van-time-picker
          v-model="timePickerValue"
          title="选择截止时间"
          :columns-type="['hour', 'minute']"
          @confirm="onTimePickerConfirm"
          @cancel="timePickerShow = false"
        />
      </van-popup>

      <!-- 提醒日期选择器 -->
      <van-popup v-model:show="reminderDatePickerShow" position="bottom" round teleport="body" :style="{ height: '50%' }">
        <van-date-picker
          v-model="reminderDatePickerValue"
          :min-date="minDate"
          :max-date="maxDate"
          title="选择提醒日期"
          :columns-type="['year', 'month', 'day']"
          @confirm="onReminderDateConfirm"
          @cancel="reminderDatePickerShow = false"
        />
      </van-popup>

      <!-- 提醒时间选择器 -->
      <van-popup v-model:show="reminderTimePickerShow" position="bottom" round teleport="body" :style="{ height: '40%' }">
        <van-time-picker
          v-model="reminderTimePickerValue"
          title="选择提醒时间"
          :columns-type="['hour', 'minute']"
          @confirm="onReminderTimeConfirm"
          @cancel="reminderTimePickerShow = false"
        />
      </van-popup>

      <!-- 重复规则选择器 -->
      <van-popup v-model:show="recurrencePickerShow" position="bottom" round teleport="body">
        <van-picker
          :columns="RECURRENCE_OPTIONS"
          title="重复规则"
          @confirm="onRecurrenceConfirm"
          @cancel="recurrencePickerShow = false"
        />
      </van-popup>
    </div>
  </van-popup>
</template>

<style lang="scss" scoped>
.task-sheet {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--color-bg-app);
}

/* 顶部 NavBar */
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
  -webkit-user-select: none;
  &.is-disabled {
    color: var(--color-text-disabled);
    cursor: not-allowed;
  }
}

/* 表单滚动区 */
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
  min-height: 60px;
}

:deep(.picker-cell) {
  padding: 14px 16px;
  .van-cell__title {
    font-size: var(--fs-body);
    color: var(--color-text-primary);
  }
  .van-cell__value {
    font-size: var(--fs-body);
    color: var(--color-text-tertiary);
    text-align: right;
  }
}
:deep(.danger-cell .van-cell__title) { color: var(--color-danger); }

.clear-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  margin-left: 8px;
  font-size: 16px;
  color: var(--color-text-tertiary);
  background: var(--color-bg-hover);
  border-radius: 50%;
  line-height: 1;
  cursor: pointer;
  user-select: none;
  -webkit-user-select: none;
  &:active { background: var(--color-border); }
}

/* 快捷 chip 行 */
.quick-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 16px 12px;
}
.quick-chip {
  height: 26px;
  padding: 0 12px;
  background: var(--color-primary-light);
  border: 0;
  border-radius: 13px;
  color: var(--color-primary-dark);
  font-size: var(--fs-caption-sm);
  font-weight: 500;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  &:active { opacity: 0.8; }
  &:disabled { opacity: 0.5; }
}
.quick-hint {
  font-size: var(--fs-micro);
  color: var(--color-text-tertiary);
}

.cell-label {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 14px 16px 8px;
  font-size: var(--fs-body-sm);
  font-weight: 500;
  color: var(--color-text-tertiary);
}
.cell-label-count {
  font-size: var(--fs-micro);
  font-family: var(--font-num);
  color: var(--color-text-disabled);
}

/* 优先级 chips */
.priority-chips {
  display: flex;
  gap: 8px;
  padding: 0 16px 16px;
  overflow-x: auto;
}
.priority-chip {
  flex: 1;
  min-width: 64px;
  height: 36px;
  padding: 0 10px;
  font-size: var(--fs-caption);
  font-weight: 600;
  color: var(--color-text-secondary);
  background: var(--color-bg-hover);
  border: 1px solid transparent;
  border-radius: 8px;
  cursor: pointer;
  white-space: nowrap;
  transition: all var(--duration-fast) var(--ease-default);
  -webkit-tap-highlight-color: transparent;
  &:active { transform: scale(0.97); }
  &.is-active { font-weight: 700; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
}

/* 分类 grid */
.category-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  padding: 0 16px 16px;
}
.category-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 12px 4px;
  background: var(--color-bg-card);
  border: 1.5px solid var(--color-border-light);
  border-radius: 12px;
  cursor: pointer;
  transition: all var(--duration-fast) var(--ease-default);
  -webkit-tap-highlight-color: transparent;
  &:active { transform: scale(0.97); }
  &.is-active {
    border-color: var(--color-primary);
    background: var(--color-primary-light);
  }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
}
.cat-emoji {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 10px;
  line-height: 1;
  /* 图标尺寸由 <Icon :size> 控制 */
  svg { display: block; }
}
.cat-name {
  font-size: var(--fs-caption);
  color: var(--color-text-primary);
  font-weight: 500;
}
.category-item.is-active .cat-name {
  color: var(--color-primary);
  font-weight: 600;
}

/* 子任务 */
.subtask-list {
  list-style: none;
  margin: 0;
  padding: 0 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.subtask-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.st-check {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-bg-card);
  border: 1.5px solid var(--color-border-strong);
  border-radius: 5px;
  padding: 0;
  font-size: var(--fs-caption-sm);
  font-weight: 700;
  color: #FFFFFF;
  line-height: 1;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  &.is-checked {
    background: var(--color-success);
    border-color: var(--color-success);
  }
}
.st-input {
  flex: 1;
  min-width: 0;
  height: 36px;
  padding: 0 10px;
  background: var(--color-bg-hover);
  border: 1px solid transparent;
  border-radius: 8px;
  font-size: var(--fs-caption);
  color: var(--color-text-primary);
  outline: none;
  &:focus { border-color: var(--color-primary); background: var(--color-bg-card); }
  &:disabled { color: var(--color-text-disabled); }
}
.st-del {
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 0;
  border-radius: 50%;
  padding: 0;
  font-size: var(--fs-h4);
  line-height: 1;
  color: var(--color-text-tertiary);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  &:active { background: var(--color-bg-hover); }
}
.add-subtask {
  display: block;
  width: calc(100% - 32px);
  height: 36px;
  margin: 10px 16px 16px;
  background: var(--color-bg-hover);
  border: 1px dashed var(--color-border-strong);
  border-radius: 8px;
  color: var(--color-primary);
  font-size: var(--fs-caption);
  font-weight: 500;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  &:active { opacity: 0.8; }
  &:disabled { opacity: 0.5; }
}

.bottom-hint { height: 24px; }
</style>
