<script setup lang="ts">
/**
 * DateTimePicker —— 记一笔的 4 列日期时间滚轮（移动端 · 02 §B.1）
 *
 * 年 / 月 / 日 / 时间（HH:mm）四列，日列随年月联动（含闰年，超界取当月最大日）。
 * 容器 = van-popup position="bottom" + teleport="body"（铁律；不加 closeable）。
 *
 * ⚠️ 不用 van-date-picker（固定 3 列塞不进时间列），也不用两个 picker 拼。
 * ⚠️ Vant 4 契约：多列 columns = Option[][]，v-model 是 string[]（每列一个值）。
 * ⚠️ 时间列 1 分钟粒度 1440 项（Q3 拍板；真机卡顿再降级 5 分钟并注入原值）。
 *
 * 校验：点「确定」时不晚于「现在 + 1 天」（滚轮不禁选，超限回弹到上限 + 行内提示）。
 * 「取消」/ 点遮罩关闭 → 不改动原值。
 */
import { computed, ref, watch } from 'vue'

const show = defineModel<boolean>('show', { default: false })

const props = withDefaults(
  defineProps<{
    /** `YYYY-MM-DD HH:mm` */
    value: string
    title?: string
  }>(),
  { title: '选择日期时间' }
)

const emit = defineEmits<{
  (e: 'confirm', v: string): void
}>()

/** 两位补零 */
function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function daysInMonth(y: number, m: number): number {
  return new Date(y, m, 0).getDate()
}

/** 今年 −5 ~ +1（02 §B.1.1） */
const now = new Date()
const YEAR_OPTIONS = Array.from({ length: 7 }, (_, i) => String(now.getFullYear() - 5 + i))
const MONTH_OPTIONS = Array.from({ length: 12 }, (_, i) => pad(i + 1))
const TIME_OPTIONS = Array.from({ length: 24 * 60 }, (_, i) => `${pad(Math.floor(i / 60))}:${pad(i % 60)}`)

/** 当前选取（string[4]：年 / 月 / 日 / HH:mm） */
const picked = ref<string[]>([])

/** 超限行内提示（点确定时才可能显示） */
const limitHint = ref('')

const dayOptions = computed(() => {
  const y = Number(picked.value[0] || now.getFullYear())
  const m = Number(picked.value[1] || now.getMonth() + 1)
  const n = daysInMonth(y, m)
  return Array.from({ length: n }, (_, i) => pad(i + 1))
})

const columns = computed(() => [
  YEAR_OPTIONS.map((v) => ({ text: v, value: v })),
  MONTH_OPTIONS.map((v) => ({ text: v, value: v })),
  dayOptions.value.map((v) => ({ text: v, value: v })),
  TIME_OPTIONS.map((v) => ({ text: v, value: v })),
])

/** 打开时从 props.value 初始化；非法回落「现在」 */
watch(
  show,
  (v) => {
    if (!v) {
      limitHint.value = ''
      return
    }
    const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec((props.value || '').trim())
    if (m) {
      picked.value = [m[1], m[2], m[3], `${m[4]}:${m[5]}`]
    } else {
      const d = new Date()
      picked.value = [
        String(d.getFullYear()),
        pad(d.getMonth() + 1),
        pad(d.getDate()),
        `${pad(d.getHours())}:${pad(d.getMinutes())}`,
      ]
    }
    // 落到合法日（值来自外部时可能越界）
    clampDay()
  },
  { immediate: true }
)

/** 切年/月后：日超出该月天数 → 取当月最大日（含闰年） */
function clampDay(): void {
  const [ys, ms, ds] = picked.value
  const max = daysInMonth(Number(ys), Number(ms))
  if (Number(ds) > max) picked.value = [ys, ms, pad(max), picked.value[3]]
}

watch(
  () => [picked.value[0], picked.value[1]],
  () => clampDay()
)

function onCancel(): void {
  show.value = false
}

/** 「不晚于现在 + 1 天」校验；超限回弹到上限值并提示，不关闭 */
function onConfirm(): void {
  const [ys, ms, ds, ts] = picked.value
  const [hs, mins] = ts.split(':')
  const pickedDate = new Date(Number(ys), Number(ms) - 1, Number(ds), Number(hs), Number(mins))
  const max = new Date()
  max.setDate(max.getDate() + 1)
  max.setSeconds(0, 0)
  if (pickedDate.getTime() > max.getTime()) {
    picked.value = [String(max.getFullYear()), pad(max.getMonth() + 1), pad(max.getDate()), `${pad(max.getHours())}:${pad(max.getMinutes())}`]
    limitHint.value = '不能晚于明天此刻'
    return
  }
  limitHint.value = ''
  emit('confirm', `${ys}-${ms}-${ds} ${ts}`)
  show.value = false
}
</script>

<template>
  <!-- ⚠️ teleport="body" 必留（iOS 弹层层叠坑）；关闭出口只留「取消」+ 点遮罩 -->
  <van-popup
    :show="show"
    position="bottom"
    round
    teleport="body"
    @update:show="(v: boolean) => (show = v)"
  >
    <div class="dtp">
      <div class="dtp-toolbar">
        <button type="button" class="dtp-cancel" @click="onCancel">取消</button>
        <span class="dtp-title">{{ title }}</span>
        <button type="button" class="dtp-ok" @click="onConfirm">确定</button>
      </div>
      <div v-if="limitHint" class="dtp-hint">{{ limitHint }}</div>
      <van-picker v-model="picked" :columns="columns" :visible-item-count="5" />
    </div>
  </van-popup>
</template>

<style lang="scss" scoped>
.dtp-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  background: var(--color-bg-card);
}
.dtp-title {
  font-size: var(--fs-body-sm);
  font-weight: 600;
  color: var(--color-text-primary);
}
.dtp-cancel {
  border: 0;
  background: transparent;
  padding: 4px 8px;
  font-size: var(--fs-body);
  color: var(--color-text-secondary);
  cursor: pointer;
}
.dtp-ok {
  border: 0;
  background: transparent;
  padding: 4px 8px;
  font-size: var(--fs-body);
  font-weight: 600;
  color: var(--color-primary);
  cursor: pointer;
}
.dtp-hint {
  padding: 0 16px 6px;
  font-size: var(--fs-caption-sm);
  color: var(--color-danger);
  text-align: center;
}
</style>
