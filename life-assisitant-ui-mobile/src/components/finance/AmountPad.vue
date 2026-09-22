<script setup lang="ts">
/**
 * AmountPad —— 记一笔自绘计算键盘（移动端 · 02 §1）
 *
 * 顶部抓手条（点箭头 / 下拉拖拽收起）+ 16 键（4 列 × 4 行）+ 整行 `=` + 整行「完成」。
 * 形态：absolute 贴记账浮层底部
 * （⚠️ 不用 fixed —— 项目铁律：底部悬浮控件一律 absolute）；
 * 高度常量 --amount-pad-h 供浮层预留底部空白（tokens.scss）。
 *
 * 表达式状态在**本组件**（defineModel），编辑回填由父级写 v-model:expr；
 * 「完成」只 emit，求值采纳与否由父级裁决（÷0 / 超限失败时键盘不收起）。
 * 求值语义走 utils/calc.ts（与桌面端同一张 13 条用例表对齐）。
 *
 * 交互（02 §1.6）：
 *   - 连按两个运算符 → 替换前一个；以运算符开头 → 忽略
 *   - 多个小数点忽略；`.` 开头补 0；前导零归一
 *   - 单项超上限 → 拒绝该次按键（行内提示，表达式保持原样）
 *   - ⌫ 逐字符退格；长按 ≥600ms 清空整个表达式（轻震动反馈）
 *   - 运算键显示 × ÷ −（人看得懂），求值内部统一转 * / -
 *   - `=`：就地求值写回表达式（键盘不收起，可继续参与后续运算）
 *   - 顶部抓手条：点箭头或向下拖拽 ≥64px → emit('close')（与「完成」同采纳路径）
 */
import { computed, onBeforeUnmount, ref } from 'vue'
import { appendKey, evalAmountExpr, formatCents } from '@/utils/calc'
import Icon from '@/components/icon/Icon.vue'

const expr = defineModel<string>('expr', { default: '' })

const emit = defineEmits<{
  /** 点「完成」：表达式原样上抛，求值与采纳由父级处理 */
  (e: 'complete'): void
  /** 点顶部向下箭头 / 下拉拖拽过阈值：请求收起键盘（父级按「完成」同路径采纳） */
  (e: 'close'): void
}>()

/** 键位照 02 §1.3：数字 3 列 + 运算 1 列（+ − × ÷ 竖排），末行 . 0 × ÷ */
const KEYS: string[][] = [
  ['1', '2', '3', '⌫'],
  ['4', '5', '6', '+'],
  ['7', '8', '9', '−'],
  ['.', '0', '×', '÷'],
]

/** 行内提示（超上限等），短暂显示 */
const hint = ref('')
let hintTimer: ReturnType<typeof setTimeout> | null = null
function showHint(msg: string): void {
  hint.value = msg
  if (hintTimer) clearTimeout(hintTimer)
  hintTimer = setTimeout(() => (hint.value = ''), 2000)
}

/** 实时预览：无运算符不出（避免无谓高度跳动）；无效 → 「—」 */
const preview = computed(() => {
  const e = expr.value
  if (!e || !/[+−×÷]/.test(e)) return ''
  const r = evalAmountExpr(e)
  if (!r.valid) return '—'
  return `${r.rounded ? '≈' : '='} ${formatCents(r.cents)}`
})

/** 长按退格清空 */
let pressTimer: ReturnType<typeof setTimeout> | null = null
let longPressed = false

function pressEnd(): void {
  if (pressTimer) {
    clearTimeout(pressTimer)
    pressTimer = null
  }
}

/** `=`：就地求值写回表达式（键盘不收起）；无运算符/无效 → 不动，给行内提示 */
function onEquals(): void {
  const e = expr.value
  if (!e || !/[+−×÷]/.test(e)) return
  const r = evalAmountExpr(e)
  if (!r.valid) {
    showHint(/÷\s*0(?!.*\d)/.test(e) ? '除数不能为 0' : '算式无效')
    return
  }
  expr.value = formatCents(r.cents)
}

function onKey(key: string): void {
  if (longPressed) {
    longPressed = false
    return
  }
  if (key === '⌫') {
    expr.value = expr.value.slice(0, -1)
    return
  }
  const next = appendKey(expr.value, key)
  if (next === null) {
    // 以运算符开头 / 单项超上限 → 忽略该次按键（超限给行内提示）
    if (/[0-9]/.test(key) && expr.value) showHint('单笔金额超上限')
    return
  }
  expr.value = next
}

function onBackspaceDown(): void {
  longPressed = false
  pressTimer = setTimeout(() => {
    longPressed = true
    expr.value = ''
    // 轻震动反馈（不支持的环境静默跳过）
    navigator.vibrate?.(15)
  }, 600)
}

// ==================== 顶部抓手：点箭头 / 下拉拖拽收起 ====================
/** 拖拽位移 ≥ 该值松手即收起 */
const DRAG_CLOSE_PX = 64
/** 滑出动画时长（与 CSS transition 同步；到点才 emit close 卸载） */
const SLIDE_MS = 200
const padEl = ref<HTMLElement | null>(null)
const dragging = ref(false)
const dragY = ref(0)
let dragStartY = 0
/** 位移超过 4px 视为拖拽，吞掉紧随的 click（免得轻拖误触「点箭头收起」） */
let dragMoved = false
let closeTimer: ReturnType<typeof setTimeout> | null = null

function onGrabDown(e: TouchEvent): void {
  const t = e.touches[0]
  if (!t) return
  dragStartY = t.clientY
  dragging.value = true
  dragMoved = false
}

function onGrabMove(e: TouchEvent): void {
  if (!dragging.value) return
  const t = e.touches[0]
  if (!t) return
  const dy = t.clientY - dragStartY
  if (dy > 4) dragMoved = true
  // 只许向下拖（向上到顶就钉住 0）；非 passive 监听里阻止页面滚动
  dragY.value = Math.max(0, dy)
  if (e.cancelable) e.preventDefault()
}

function onGrabEnd(): void {
  dragging.value = false
  if (dragY.value >= DRAG_CLOSE_PX) requestClose()
  else dragY.value = 0 // 回弹（拖拽中 transition 关闭，松手恢复）
}

/** 点抓手条（未拖出位移）→ 收起 */
function onGrabClick(): void {
  if (dragMoved) {
    dragMoved = false
    return
  }
  requestClose()
}

/**
 * 收起前先本地预检求值：算式无效（÷0 / 超限）→ 行内提示、**不收起**
 * （与父级 adoptPad 的裁决一致，否则滑出屏幕却被父级拒收 = 卡在屏外）。
 */
function requestClose(): void {
  const e = expr.value
  if (e && /[+−×÷]/.test(e) && !evalAmountExpr(e).valid) {
    showHint(/÷\s*0(?!.*\d)/.test(e) ? '除数不能为 0' : '算式无效')
    dragging.value = false
    dragY.value = 0
    return
  }
  // 整块高度滑出屏幕 → 动画结束才通知父级（v-if）卸载
  dragY.value = padEl.value?.offsetHeight ?? 0
  if (closeTimer) clearTimeout(closeTimer)
  closeTimer = setTimeout(() => {
    closeTimer = null
    emit('close')
  }, SLIDE_MS)
}

onBeforeUnmount(() => {
  pressEnd()
  if (hintTimer) clearTimeout(hintTimer)
  if (closeTimer) clearTimeout(closeTimer)
})
</script>

<template>
  <!-- ⚠️ absolute 贴浮层底部（不用 fixed）；父级 .tx-sheet 已 position:relative -->
  <div
    ref="padEl"
    class="amount-pad"
    :style="{
      transform: dragY ? `translateY(${dragY}px)` : undefined,
      transition: dragging ? 'none' : undefined,
    }"
    @click.stop
  >
    <!-- 抓手条：点任意处 或 向下拖拽过阈值 → 收起（父级按「完成」同路径采纳） -->
    <div
      class="pad-grab"
      @touchstart="onGrabDown"
      @touchmove="onGrabMove"
      @touchend="onGrabEnd"
      @touchcancel="onGrabEnd"
      @click="onGrabClick"
    >
      <span class="grab-pill" aria-hidden="true" />
      <Icon class="grab-arrow" name="ChevronDown" :size="16" aria-label="收起键盘" />
      <span class="grab-pill" aria-hidden="true" />
    </div>

    <!-- 显示区：左侧行内提示 / 右侧结果预览（无运算符且无提示时整行塌缩为 0 高） -->
    <div class="pad-preview" aria-live="polite">
      <span v-if="hint" class="pad-hint">{{ hint }}</span>
      <span v-else-if="preview" class="pad-result">{{ preview }}</span>
    </div>

    <div class="pad-grid">
      <button
        v-for="key in KEYS.flat()"
        :key="key"
        type="button"
        class="pad-key"
        :class="{ 'is-op': '+−×÷'.includes(key) }"
        @click="onKey(key)"
        @touchstart.passive="key === '⌫' && onBackspaceDown()"
        @touchend.passive="key === '⌫' && pressEnd()"
        @touchcancel.passive="key === '⌫' && pressEnd()"
        @contextmenu.prevent
      >
        {{ key }}
      </button>
    </div>

    <button type="button" class="pad-equals" @click="onEquals">=</button>
    <button type="button" class="pad-done" @click="emit('complete')">完成</button>
  </div>
</template>

<style lang="scss" scoped>
.amount-pad {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 2;
  /* 顶部 4px 让给抓手条（比原 8px 略增高度，中部放下拉箭头） */
  padding: 0 12px calc(8px + env(safe-area-inset-bottom, 0px));
  background: var(--color-bg-card);
  border-top: 1px solid var(--color-border-light);
  /* 下拉拖拽跟手；松手回弹 / 收起都走这 200ms */
  transition: transform 0.2s ease;
  will-change: transform;
}

/* 抓手条：整条可点（收起）+ 可向下拖拽；中部一个向下箭头 */
.pad-grab {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 32px;
  cursor: pointer;
  touch-action: none; /* ⚠️ 关掉浏览器原生滚动/双击缩放，拖拽才不被吃掉 */
  -webkit-tap-highlight-color: transparent;
  user-select: none;
  &:active .grab-arrow { color: var(--color-primary); }
}
.grab-pill {
  width: 36px;
  height: 4px;
  border-radius: 999px;
  background: var(--color-border-light);
}
.grab-arrow {
  flex-shrink: 0;
  color: var(--color-text-tertiary);
  pointer-events: none; /* 点击统一归口到 .pad-grab，箭头只做视觉 */
}

/* 显示区：主行是浮层顶部的金额输入框，这里只有预览副行（--fs-caption / 主色） */
.pad-preview {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  min-height: 0;
  margin-bottom: 4px;

  &:empty {
    margin-bottom: 0;
  }
}
.pad-result {
  font-size: var(--fs-caption);
  color: var(--color-primary);
  font-family: var(--font-num);
  font-variant-numeric: tabular-nums;
}
.pad-hint {
  font-size: var(--fs-caption-sm);
  color: var(--color-danger);
}

.pad-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
}
.pad-key {
  height: 56px;
  border: 0;
  border-radius: 10px;
  background: var(--color-bg-hover);
  color: var(--color-text-primary);
  font-size: var(--fs-h3);
  font-family: var(--font-num);
  font-weight: 500;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  user-select: none;

  /* 按下反馈只加深背景，不做缩放（键盘缩放会晃眼，02 §1.3） */
  &:active {
    background: var(--color-border);
  }

  &.is-op {
    color: var(--color-primary);
    font-size: var(--fs-h4);
    font-weight: 600;
  }
}

/* `=`：就地求值写回表达式（键盘不收起），主色描边次级按钮，压在「完成」上方 */
.pad-equals {
  display: block;
  width: 100%;
  height: 40px;
  margin-top: 6px;
  border: 1.5px solid var(--color-primary);
  border-radius: 10px;
  background: var(--color-primary-light);
  color: var(--color-primary);
  font-size: var(--fs-h4);
  font-weight: 700;
  font-family: var(--font-num);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  &:active {
    background: var(--color-border-light);
  }
}

.pad-done {
  display: block;
  width: 100%;
  height: 48px;
  margin-top: 6px;
  border: 0;
  border-radius: 10px;
  background: var(--color-primary);
  color: #FFFFFF;
  font-size: var(--fs-body);
  font-weight: 600;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  &:active {
    background: var(--color-primary-dark);
  }
}
</style>
