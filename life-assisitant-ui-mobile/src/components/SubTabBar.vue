<script setup lang="ts" generic="T extends string">
/**
 * 模块内二级 Tab 栏（SubTabBar）
 *
 * 三个 Tab 模块（待办 / 记录 / 统计）的顶部选项卡**共用这一套实现**。
 *
 * 为什么抽成组件而不是各页自己写：
 *   历史问题 —— 记录页是手写的 nav，待办页和统计页用 van-tabs，结果三处
 *   长得都不一样（记录 42px 高、待办 40px 且上方有 10px 缝隙、统计还额外
 *   包了一张圆角卡片）。同一个角色三种外观，根源是「同一件事写三遍」。
 *   抽成组件后三处天然一致，也避免了 van-tabs 的样式需要逐个 :deep() 覆盖。
 *
 * 设计语言（以记录页为基准，三模块统一）：
 *   - 整条铺满宽度，背景 --color-bg-card，与上方 .page-header **同色无缝**，
 *     二者连成一片（这是「选项卡和 header 连在一起」的关键）
 *   - 底部一条 1px 分隔线与内容区分开
 *   - 未选中：--color-text-tertiary / 选中：--color-primary
 *   - 下划线 20×3px 圆角，**一条共享的滑动条**（见下）
 *
 * ──────────────────────────────────────────────────────────────
 * 滑动下划线 + 连续变色（2026-09-19 晚）
 *
 * 原来每个 tab 各自带一条 underline，靠 `is-active` 的 scaleX(0→1) 展开。
 * 这导致左右滑时下划线只能在「手指抬起、tab 真的切了」之后才动 ——
 * 手势拖到一半时下划线纹丝不动，松手才啪一下跳过去，非常生硬。
 *
 * 现在改成：整条 tab 栏只有**一根**绝对定位的下划线，位置由父级传进来的
 * 连续 `progress`（浮点下标，见 composables/useSwipeTabs.ts）插值得到：
 *
 *     center = lerp(tab[i0].center, tab[i1].center, 小数部分)
 *
 * 拖动中 `dragging` 为 true → 关掉 transition，下划线像素级跟手；
 * 松手后恢复 transition，它带弹簧缓动落到目标 tab。
 *
 * 文字颜色同理：每个 tab 的文字渲染两层（下层 tertiary、上层 primary），
 * 上层按 `1 - |progress - i|` 的不透明度交叉淡入，于是颜色是**渐变**的，
 * 不再是某一刻突然从灰变蓝。
 *   两层同字重（600）：如果上层是 600 而下层 500，渐变中途两层字宽不同
 *   会露出重影，且 is-active 时字重跳变本身也是一次「跳」。
 *
 * 用法：
 *   <SubTabBar :tabs="TABS" :active="filter" aria-label="状态筛选" @change="onTabChange" />
 * 左右滑切换时（HomeLayout）额外传进度与拖动态：
 *   <SubTabBar :progress="progress" :dragging="dragging" … />
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps<{
  /** 选项卡数据；value 建议用字符串联合类型，父组件的 active 与回调会自动对齐 */
  tabs: readonly { value: T; label: string }[]
  /** 当前选中的 value */
  active: T
  /** 无障碍标签，描述这组 tab 的用途 */
  ariaLabel?: string
  /**
   * 连续进度（浮点下标）。左右滑时由 useSwipeTabs 提供，用来让下划线与文字
   * 跟手滑动；不传则退化为「只按 active 的整数下标」（点击切换仍然有动画）。
   */
  progress?: number
  /** 是否正在跟手拖动：拖动中关掉下划线的 transition，避免它「追」手指 */
  dragging?: boolean
}>()

const emit = defineEmits<{
  change: [value: T]
}>()

/** 下划线宽度（px）—— 与旧设计一致，固定值，不随 tab 文字长短变化 */
const UNDERLINE_W = 20

const innerRef = ref<HTMLElement | null>(null)
/** 每个 tab 按钮的中心 X（相对 .sub-tabbar-inner 的内容坐标系） */
const centers = ref<number[]>([])
let ro: ResizeObserver | null = null

/**
 * 取当前渲染出来的 tab 按钮（DOM 顺序 == tabs 顺序）。
 *
 * ⚠️ 刻意不用 v-for 的函数 ref 收集：拖动中 progress 每帧都变 → 组件每帧
 * 重渲染 → 函数 ref 每帧被解绑再绑定一次，收集数组会反复抖动，甚至某一帧
 * 被清空导致下划线闪一下。直接查 DOM 只在需要测量时执行，与渲染频率无关。
 */
function itemEls(): HTMLElement[] {
  const inner = innerRef.value
  if (!inner) return []
  return Array.from(inner.querySelectorAll<HTMLElement>('.sub-tab-item'))
}

/**
 * 量一遍各 tab 的中心位置。
 *
 * 用 offsetLeft 而不是 getBoundingClientRect：inner 是横向滚动容器，
 * 下划线是它的绝对定位子元素，需要的是「内容坐标系」里的位置
 * （不随 scrollLeft 变化），rect 给的是视口坐标，滚动时会飘。
 */
function measure(): void {
  const els = itemEls()
  if (els.length === 0) return
  centers.value = els.map((el) => el.offsetLeft + el.offsetWidth / 2)
}

/** 当前激活下标（progress 缺省时的 fallback） */
const activeIndex = computed(() => {
  const i = props.tabs.findIndex((t) => t.value === props.active)
  return i < 0 ? 0 : i
})

/** 夹紧后的连续进度 */
const raw = computed<number>(() => {
  const n = props.tabs.length
  if (n === 0) return 0
  const p = props.progress ?? activeIndex.value
  if (!Number.isFinite(p)) return activeIndex.value
  return Math.max(0, Math.min(n - 1, p))
})

/** 下划线位置：在相邻两个 tab 的中心之间插值 */
const underlineStyle = computed(() => {
  const cs = centers.value
  if (cs.length === 0) return { opacity: '0' }
  const p = raw.value
  const i0 = Math.floor(p)
  const i1 = Math.min(cs.length - 1, i0 + 1)
  const t = p - i0
  const c = cs[i0] + (cs[i1] - cs[i0]) * t
  return {
    // 只动 transform：合成层动画，不触发布局重排
    transform: `translateX(${c - UNDERLINE_W / 2}px)`,
    // 跟手时不要过渡，否则下划线是在「追」手指而不是被手指拖着走
    transition: props.dragging
      ? 'none'
      : `transform var(--duration-base) var(--ease-spring)`,
  }
})

/**
 * 第 i 个 tab 文字的「选中权重」：1 = 完全主色，0 = 完全弱化色。
 * 与下划线的位置用同一个 progress，两者永远同步。
 */
function weight(i: number): number {
  return Math.max(0, 1 - Math.abs(raw.value - i))
}

/** 把激活项滚进可视区（tab 多到需要横滚时，如记录页 5 个在窄屏上） */
function scrollActiveIntoView(): void {
  const inner = innerRef.value
  if (!inner || inner.scrollWidth <= inner.clientWidth + 4) return
  const el = itemEls()[activeIndex.value]
  if (!el) return
  const target = el.offsetLeft - (inner.clientWidth - el.offsetWidth) / 2
  inner.scrollTo({ left: Math.max(0, target), behavior: 'smooth' })
}

onMounted(() => {
  measure()
  if (innerRef.value && typeof ResizeObserver !== 'undefined') {
    // 屏幕旋转 / 容器宽度变化都会让中心位置变
    ro = new ResizeObserver(() => measure())
    ro.observe(innerRef.value)
  }
  // 中文字体加载完成前量到的是 fallback 字体的宽度，加载完要再量一次
  document.fonts?.ready.then(() => measure()).catch(() => {})
})

onBeforeUnmount(() => {
  ro?.disconnect()
  ro = null
})

// tab 集合变了（切模块 / 待办进出多选态）→ 等新按钮渲染完再量
watch(
  () => props.tabs,
  () => {
    nextTick(() => {
      measure()
      scrollActiveIntoView()
    })
  }
)

// 点击切换 / 手势切换完成后，把激活项滚到中间（拖动中不动，免得和下划线抢滚动）
watch(activeIndex, () => {
  if (!props.dragging) scrollActiveIntoView()
})
</script>

<template>
  <nav class="sub-tabbar" role="tablist" :aria-label="ariaLabel">
    <div ref="innerRef" class="sub-tabbar-inner">
      <!-- 一根共享的滑动下划线：位置由 progress 插值（见 script 顶部说明） -->
      <span
        class="sub-tab-underline"
        :style="underlineStyle"
        aria-hidden="true"
      />
      <button
        v-for="(t, i) in tabs"
        :key="t.value"
        type="button"
        role="tab"
        class="sub-tab-item"
        :class="{ 'is-active': active === t.value }"
        :aria-selected="active === t.value"
        @click="emit('change', t.value)"
      >
        <!-- 两层文字交叉淡入 = 颜色的连续渐变（避免某一刻突然变色） -->
        <span class="sub-tab-text">
          {{ t.label }}
          <span class="sub-tab-text-on" :style="{ opacity: weight(i) }" aria-hidden="true">
            {{ t.label }}
          </span>
        </span>
      </button>
    </div>
  </nav>
</template>

<style scoped lang="scss">
.sub-tabbar {
  /* 与上方 .page-header 同为 --color-bg-card 且无外边距 —— 二者视觉连成一片。
     ⚠️ 不要在这里加 margin-top，否则会漏出页面底色、把 header 和选项卡割开。 */
  flex-shrink: 0;
  background: var(--color-bg-card);
  border-bottom: 1px solid var(--color-border-light);
}

.sub-tabbar-inner {
  /* 下划线的定位容器（absolute 子元素相对它定位） */
  position: relative;
  display: flex;
  align-items: stretch;
  /* tab 较多时（如记录页 5 个）允许横向滚动，正常情况下等分铺满 */
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
  &::-webkit-scrollbar { display: none; }
}

.sub-tab-item {
  flex: 1 0 auto;
  min-width: 56px;
  /* 高度用统一令牌：三个模块的选项卡高度必须一致 */
  height: var(--app-tabbar-height);
  padding: 0 4px;
  /* 字号用统一令牌（原记录 14px / 待办硬编码 13px / 统计走 Vant 默认 14px） */
  font-size: var(--fs-body-sm);
  /* 两层文字同字重：渐变中途字宽不同会露重影，且 is-active 时的字重跳变
     本身就是一次视觉「跳」（见 script 顶部说明） */
  font-weight: 600;
  color: var(--color-text-tertiary);
  background: transparent;
  border: 0;
  cursor: pointer;
  white-space: nowrap;
  -webkit-tap-highlight-color: transparent;
}

/* 文字容器：两层文字叠在一起（下层弱化色，上层主色按权重淡入） */
.sub-tab-text {
  position: relative;
  display: inline-block;
}
.sub-tab-text-on {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  color: var(--color-primary);
}

/* 单一滑动下划线：由 progress 驱动 transform，不再 per-item scaleX 展开 */
.sub-tab-underline {
  position: absolute;
  left: 0;
  bottom: 0;
  width: 20px;
  height: 3px;
  border-radius: 999px;
  background: var(--color-primary);
  pointer-events: none;
  will-change: transform;
}

/* 尊重「减少动态效果」的系统设置 */
@media (prefers-reduced-motion: reduce) {
  .sub-tab-underline { transition: none !important; }
}
</style>
