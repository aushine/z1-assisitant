<script lang="ts">
/**
 * 纪念日 / 倒数日 · 编辑浮层（移动端）
 *
 * SYNC-FROM-BACKEND: life-assisitant-api/internal/model/dto/anniversary.go
 * 设计：md/spec-20260919-v1/06-个人中心与纪念日.md §3.2
 *
 * ⚠️ 布局铁律：所有 van-popup 必须 teleport="body"（含嵌套的日期选择器），
 *    否则落进页内滚动容器后，iOS 上会被 HomeLayout 的 chrome 压住。
 *
 * ⚠️ 农历（calendar_type = 2）后端**尚未实现换算**（没引农历库，后端有明确
 *    TODO，当前按公历日期计算）。所以这里显示农历选项但不假装能换算 ——
 *    选中后给一句明确提示，避免用户以为存进去的是农历。
 */
export interface AnniversaryForm {
  title: string
  target_date: string
  repeat_rule: 1 | 2 | 3 | 4
  calendar_type: 1 | 2
  remind_days: number[]
  category: 'birthday' | 'anniversary' | 'countdown' | 'other'
  icon: string
  color: string
  is_pinned: boolean
  note: string
}

export function defaultAnniversaryForm(): AnniversaryForm {
  return {
    title: '',
    target_date: '',
    repeat_rule: 2,
    calendar_type: 1,
    remind_days: [0],
    category: 'anniversary',
    icon: 'Calendar',
    color: 'primary',
    is_pinned: false,
    note: '',
  }
}
</script>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { showFailToast } from 'vant'
import Icon from '@/components/icon/Icon.vue'
import { useAnniversaryStore } from '@/stores/anniversary'
import { todayDate } from '@/utils/date'
import { TINT_NAMES, getTint, type TintName } from '@/utils/tint'
import type { AnniversaryItem } from '@/api/types'

/* AnniversaryForm / defaultAnniversaryForm 由上方普通 <script> 块导出，
   同一 SFC 内两个 script 块会编译进同一个模块作用域，这里无需再 import。 */

const props = defineProps<{
  show: boolean
  /** null = 新建；传 item = 编辑 */
  item: AnniversaryItem | null
}>()

const emit = defineEmits<{
  (e: 'update:show', v: boolean): void
  (e: 'saved'): void
}>()

const store = useAnniversaryStore()

const TITLE_MAX = 50
const NOTE_MAX = 200

const form = ref<AnniversaryForm>(defaultAnniversaryForm())
const saving = ref(false)
const titleError = ref('')

/* ==================== 选项 ==================== */
const REPEAT_OPTIONS = [
  { value: 1, label: '不重复' },
  { value: 2, label: '每年' },
  { value: 3, label: '每月' },
  { value: 4, label: '每周' },
] as const

const CALENDAR_OPTIONS = [
  { value: 1, label: '公历' },
  { value: 2, label: '农历' },
] as const

/** 提前提醒（chips 多选，可全不选 = 不提醒） */
const REMIND_OPTIONS = [
  { value: 7, label: '7 天前' },
  { value: 3, label: '3 天前' },
  { value: 1, label: '1 天前' },
  { value: 0, label: '当天' },
] as const

const CATEGORY_OPTIONS = [
  { value: 'birthday', label: '生日', icon: 'Sparkles', color: 'accent' },
  { value: 'anniversary', label: '纪念日', icon: 'Calendar', color: 'primary' },
  { value: 'countdown', label: '倒数日', icon: 'Clock', color: 'warning' },
  { value: 'other', label: '其他', icon: 'Sun', color: 'neutral' },
] as const

const ICON_OPTIONS = ['Sparkles', 'Calendar', 'Clock', 'Sun', 'HeartPulse'] as const

/* ==================== 打开 / 回填 ==================== */
watch(
  () => props.show,
  (v) => {
    if (!v) return
    titleError.value = ''
    const it = props.item
    form.value = it
      ? {
          title: it.title,
          target_date: it.target_date,
          repeat_rule: it.repeat_rule,
          calendar_type: it.calendar_type,
          remind_days: [...it.remind_days],
          category: it.category,
          icon: it.icon || 'Calendar',
          color: it.color || 'primary',
          is_pinned: it.is_pinned,
          note: it.note || '',
        }
      : { ...defaultAnniversaryForm(), target_date: todayDate() }
  },
)

const isEdit = computed(() => !!props.item)
const lunarHint = computed(() => form.value.calendar_type === 2)

/* ==================== 日期选择器（嵌套 popup，同样 teleport） ==================== */
const datePickerShow = ref(false)
const datePickerValue = ref<string[]>([])

function openDatePicker(): void {
  const base = form.value.target_date || todayDate()
  const [y, m, d] = base.split('-').map(Number)
  datePickerValue.value = [String(y), String(m - 1), String(d - 1)]
  datePickerShow.value = true
}

function onDateConfirm({ selectedValues }: { selectedValues: string[] }): void {
  const [y, m, d] = selectedValues
  form.value.target_date = `${y}-${pad(Number(m) + 1)}-${pad(Number(d) + 1)}`
  datePickerShow.value = false
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

/* ==================== 分类 / 提醒 ==================== */
function pickCategory(v: string): void {
  const meta = CATEGORY_OPTIONS.find((o) => o.value === v)
  form.value.category = v as AnniversaryForm['category']
  // 分类影响默认图标与配色；用户手动改过之后就不再跟着分类变（简单起见每次都同步）
  if (meta) {
    form.value.icon = meta.icon
    form.value.color = meta.color
  }
}

function toggleRemind(v: number): void {
  const cur = form.value.remind_days
  form.value.remind_days = cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]
}

function onTitleInput(): void {
  if (titleError.value && form.value.title.trim()) titleError.value = ''
}

/* ==================== 提交 ==================== */
async function submit(): Promise<void> {
  if (!form.value.title.trim()) {
    titleError.value = '请填写标题'
    return
  }
  if (!form.value.target_date) {
    showFailToast('请选择日期')
    return
  }
  saving.value = true
  const payload = {
    title: form.value.title.trim().slice(0, TITLE_MAX),
    target_date: form.value.target_date,
    repeat_rule: form.value.repeat_rule,
    calendar_type: form.value.calendar_type,
    remind_days: [...form.value.remind_days].sort((a, b) => b - a) as (0 | 1 | 3 | 7)[],
    category: form.value.category,
    icon: form.value.icon,
    color: form.value.color,
    is_pinned: form.value.is_pinned,
    note: form.value.note.slice(0, NOTE_MAX),
  }
  const ok = props.item
    ? await store.patch(props.item.id, payload)
    : await store.create(payload)
  saving.value = false
  if (!ok) return
  emit('saved')
  emit('update:show', false)
}

function close(): void {
  emit('update:show', false)
}
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
    <div class="aes">
      <header class="aes-head">
        <button class="aes-x" type="button" aria-label="关闭" @click="close">
          <Icon name="X" :size="20" />
        </button>
        <h3 class="aes-title">{{ isEdit ? '编辑' : '新建' }}纪念日</h3>
        <span class="aes-head-space" />
      </header>

      <div class="aes-body">
        <!-- 标题 -->
        <div class="aes-field">
          <label class="aes-label" for="aes-title">标题</label>
          <input
            id="aes-title"
            v-model="form.title"
            class="aes-input"
            type="text"
            :maxlength="TITLE_MAX"
            placeholder="例如：妈妈生日"
            @input="onTitleInput"
          >
          <p v-if="titleError" class="aes-err">{{ titleError }}</p>
        </div>

        <!-- 日期 -->
        <div class="aes-field">
          <span class="aes-label">日期</span>
          <button class="aes-pick" type="button" @click="openDatePicker">
            <Icon name="Calendar" :size="16" />
            <span class="aes-pick-text">{{ form.target_date || '请选择' }}</span>
          </button>
        </div>

        <!-- 重复 -->
        <div class="aes-field">
          <span class="aes-label">重复</span>
          <div class="aes-seg">
            <button
              v-for="o in REPEAT_OPTIONS"
              :key="o.value"
              class="aes-seg-btn"
              :class="{ 'is-on': form.repeat_rule === o.value }"
              type="button"
              @click="form.repeat_rule = o.value"
            >
              {{ o.label }}
            </button>
          </div>
        </div>

        <!-- 历法 -->
        <div class="aes-field">
          <span class="aes-label">历法</span>
          <div class="aes-seg">
            <button
              v-for="o in CALENDAR_OPTIONS"
              :key="o.value"
              class="aes-seg-btn"
              :class="{ 'is-on': form.calendar_type === o.value }"
              type="button"
              @click="form.calendar_type = o.value"
            >
              {{ o.label }}
            </button>
          </div>
          <p v-if="lunarHint" class="aes-hint is-warn">
            农历换算暂未支持，当前按公历日期计算
          </p>
        </div>

        <!-- 提前提醒 -->
        <div class="aes-field">
          <span class="aes-label">提前提醒<em class="aes-opt">（可不选）</em></span>
          <div class="aes-chips">
            <button
              v-for="o in REMIND_OPTIONS"
              :key="o.value"
              class="aes-chip"
              :class="{ 'is-on': form.remind_days.includes(o.value) }"
              type="button"
              @click="toggleRemind(o.value)"
            >
              {{ o.label }}
            </button>
          </div>
        </div>

        <!-- 分类 -->
        <div class="aes-field">
          <span class="aes-label">分类</span>
          <div class="aes-chips">
            <button
              v-for="o in CATEGORY_OPTIONS"
              :key="o.value"
              class="aes-chip"
              :class="{ 'is-on': form.category === o.value }"
              type="button"
              @click="pickCategory(o.value)"
            >
              <Icon :name="o.icon" :size="14" />
              {{ o.label }}
            </button>
          </div>
        </div>

        <!-- 图标 -->
        <div class="aes-field">
          <span class="aes-label">图标</span>
          <div class="aes-icons">
            <button
              v-for="n in ICON_OPTIONS"
              :key="n"
              class="aes-icon-btn"
              :class="{ 'is-on': form.icon === n }"
              type="button"
              :aria-label="n"
              @click="form.icon = n"
            >
              <Icon :name="n" :size="18" />
            </button>
          </div>
        </div>

        <!-- 配色 -->
        <div class="aes-field">
          <span class="aes-label">配色</span>
          <div class="aes-icons">
            <button
              v-for="t in TINT_NAMES"
              :key="t"
              class="aes-color-btn"
              :class="{ 'is-on': form.color === t }"
              type="button"
              :style="{ background: getTint(t as TintName).bg, color: getTint(t as TintName).fg }"
              :aria-label="t"
              @click="form.color = t"
            >
              <Icon v-if="form.color === t" name="Check" :size="14" />
            </button>
          </div>
        </div>

        <!-- 置顶 -->
        <button
          class="aes-row"
          type="button"
          @click="form.is_pinned = !form.is_pinned"
        >
          <span class="aes-row-label">置顶</span>
          <span class="aes-switch" :class="{ 'is-on': form.is_pinned }">
            <span class="aes-switch-dot" />
          </span>
        </button>

        <!-- 备注 -->
        <div class="aes-field">
          <label class="aes-label" for="aes-note">备注<em class="aes-opt">（选填）</em></label>
          <textarea
            id="aes-note"
            v-model="form.note"
            class="aes-textarea"
            rows="3"
            :maxlength="NOTE_MAX"
            placeholder="想说点什么…"
          />
          <p class="aes-hint">{{ form.note.length }}/{{ NOTE_MAX }}</p>
        </div>
      </div>

      <footer class="aes-foot">
        <button class="aes-submit" type="button" :disabled="saving" @click="submit">
          {{ saving ? '保存中…' : '保存' }}
        </button>
      </footer>
    </div>

    <!-- 嵌套日期选择器（⚠️ 同样 teleport） -->
    <van-popup v-model:show="datePickerShow" position="bottom" round teleport="body">
      <van-date-picker
        v-model="datePickerValue"
        title="选择日期"
        :min-date="new Date(1900, 0, 1)"
        :max-date="new Date(2100, 11, 31)"
        @confirm="onDateConfirm"
        @cancel="datePickerShow = false"
      />
    </van-popup>
  </van-popup>
</template>

<style lang="scss" scoped>
.aes {
  display: flex;
  flex-direction: column;
  height: 100%;
}

/* ====== 头 ====== */
.aes-head {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid var(--color-border-light);
}
.aes-x {
  width: 32px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  background: transparent;
  color: var(--color-text-secondary);
}
.aes-title {
  flex: 1;
  text-align: center;
  font-size: var(--fs-h4);
  font-weight: 600;
  color: var(--color-text-primary);
}
.aes-head-space { width: 32px; }

/* ====== 内容 ====== */
.aes-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior-y: contain;
  padding: var(--space-4) var(--space-4) var(--space-6);
}

.aes-field { margin-bottom: var(--space-5); }
.aes-label {
  display: block;
  font-size: var(--fs-caption-sm);
  font-weight: 600;
  color: var(--color-text-secondary);
  margin-bottom: 8px;
}
.aes-opt { font-style: normal; font-weight: 400; color: var(--color-text-tertiary); }

.aes-input,
.aes-textarea {
  width: 100%;
  padding: 10px var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-bg-card);
  color: var(--color-text-primary);
  font-size: var(--fs-body-sm);
  font-family: inherit;
  &:focus { outline: none; border-color: var(--color-primary); }
}
.aes-textarea { resize: none; }
.aes-err {
  margin-top: 6px;
  font-size: var(--fs-micro);
  color: var(--color-danger);
}
.aes-hint {
  margin-top: 6px;
  font-size: var(--fs-micro);
  color: var(--color-text-tertiary);
  &.is-warn { color: var(--color-warning); }
}

.aes-pick {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-bg-card);
  color: var(--color-text-primary);
  font-size: var(--fs-body-sm);
}
.aes-pick-text { font-family: var(--font-num); }

/* 分段控件 */
.aes-seg {
  display: flex;
  gap: 6px;
  padding: 3px;
  background: var(--color-bg-hover);
  border-radius: var(--radius-md);
}
.aes-seg-btn {
  flex: 1;
  padding: 7px 0;
  border: 0;
  border-radius: var(--radius-base);
  background: transparent;
  color: var(--color-text-secondary);
  font-size: var(--fs-caption-sm);
  font-weight: 500;
  &.is-on {
    background: var(--color-bg-card);
    color: var(--color-primary);
    font-weight: 600;
    box-shadow: var(--shadow-xs);
  }
}

/* chips */
.aes-chips { display: flex; flex-wrap: wrap; gap: 8px; }
.aes-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 7px 12px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-full, 999px);
  background: var(--color-bg-card);
  color: var(--color-text-secondary);
  font-size: var(--fs-caption-sm);
  &.is-on {
    border-color: var(--color-primary);
    background: var(--tint-primary-bg);
    color: var(--tint-primary-fg);
    font-weight: 600;
  }
}

/* 图标 / 配色 */
.aes-icons { display: flex; flex-wrap: wrap; gap: 8px; }
.aes-icon-btn {
  width: 40px;
  height: 40px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-bg-card);
  color: var(--color-text-secondary);
  &.is-on {
    border-color: var(--color-primary);
    color: var(--color-primary);
    background: var(--tint-primary-bg);
  }
}
.aes-color-btn {
  width: 40px;
  height: 40px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 2px solid transparent;
  border-radius: var(--radius-md);
  &.is-on { border-color: var(--color-primary); }
}

/* 置顶行 */
.aes-row {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 0;
  margin-bottom: var(--space-4);
  border: 0;
  background: transparent;
}
.aes-row-label {
  font-size: var(--fs-body-sm);
  color: var(--color-text-primary);
}
.aes-switch {
  position: relative;
  width: 44px;
  height: 26px;
  border-radius: 999px;
  background: var(--color-border);
  transition: background var(--duration-fast) var(--ease-default);
  &.is-on { background: var(--color-primary); }
}
.aes-switch-dot {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #FFFFFF;
  transition: transform var(--duration-fast) var(--ease-default);
}
.aes-switch.is-on .aes-switch-dot { transform: translateX(18px); }

/* ====== 底 ====== */
.aes-foot {
  flex-shrink: 0;
  padding: var(--space-3) var(--space-4) calc(var(--space-4) + env(safe-area-inset-bottom));
  border-top: 1px solid var(--color-border-light);
  background: var(--color-bg-card);
}
.aes-submit {
  width: 100%;
  height: 46px;
  border: 0;
  border-radius: var(--radius-md);
  background: var(--color-primary);
  color: #FFFFFF;
  font-size: var(--fs-body);
  font-weight: 600;
  &:disabled { opacity: 0.6; }
}
</style>
