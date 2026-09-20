/**
 * 模块内二级 tab 的「左右滑切换」（移动端）
 *
 * 用法（HomeLayout 的内容区）：
 *   const { style: contentStyle, handlers, progress, dragging } = useSwipeTabs({
 *     tabs: () => tabs.value,
 *     active: () => activeTab.value,
 *     onChange: onTabChange,
 *     viewport: () => contentRef.value?.clientWidth ?? window.innerWidth,
 *   })
 *   <main ref="contentRef" :style="contentStyle" @touchstart=… >
 *   <SubTabBar :progress="progress" :dragging="dragging" … />
 *
 * ────────────────────────────────────────────────────────────────
 * 核心概念：**进度（progress）而不是像素位移**
 *
 * 本轮（2026-09-19 晚）把「只算位移」改成「算一个浮点下标」：
 *
 *     progress = 当前 tab 下标 + 手指拖出的比例（左滑为正）
 *
 * 拖动中它是连续小数（如 1.37 = 停在 tab1 与 tab2 之间 37% 处），
 * 三个视觉层同时消费它：
 *   - 选项卡下划线  → 按 progress 在两个 tab 中心之间插值（跟手滑动）
 *   - 选项卡文字色  → 按 progress 在相邻两项之间交叉淡入（连续变色）
 *   - 内容区        → translateX = -(progress - 当前下标) × 视口宽（1:1 跟手）
 *
 * 这样手指、下划线、内容是同一个量的三种投影，不会有「下划线先跳、
 * 内容后动」的割裂感 —— 这是「生硬」的头号来源。
 * ────────────────────────────────────────────────────────────────
 *
 * 设计要点（每一条都是踩出来的或刻意权衡的）：
 *
 * 1) **轴向锁定**：先动哪个方向就认哪个方向。
 *    垂直滚动的页面里，手指几乎不可能走纯直线；不锁轴的话，一次正常的
 *    上下滑就会被判成横滑而误切 tab。锁轴阈值 8px，且要求
 *    |dx| > |dy| × 1.4 才判横向 —— 斜着划拉优先让位给滚动。
 *    锁定横向后 touchmove 会 preventDefault：否则手指略微带一点纵向分量时
 *    页面会一边切 tab 一边滚，两条动效打架，看起来同样很脏。
 *
 * 2) **不接管的地方要让位**（`shouldSkip`）：
 *    - `van-swipe-cell`（待办任务卡 / 交易 / 习惯列表的**左滑删除**）：
 *      它自己就是横滑手势，抢了就删不掉条目了。
 *    - 任何**横向可滚动**的祖先容器（习惯区的里程碑条、tab 栏、
 *      金额标签横向列表）：那里左右滑是在滚容器，不是在切 tab。
 *    判断用「computed overflowX 是 auto/scroll 且 scrollWidth > clientWidth」，
 *    只看真正能滚的容器，静止的 overflow-x:hidden 不受影响。
 *
 * 3) **只在起点判断一次**：整次手势的归属在 touchstart 就定下来，
 *    中途不反悔，避免拖到一半突然改成滚动或改成切 tab 的抽搐感。
 *
 * 4) **1:1 跟手 + 到头阻尼**：拖动时内容区与手指同速平移（像素级跟手，
 *    这才是 ViewPager 的手感；原来的 0.5 阻尼反而像「拖不动」）。
 *    到头了（第一个还往右拉 / 最后一个还往左拉）阻尼降到 0.25，
 *    给「拉不动但手指没死」的反馈。
 *
 * 5) ⚠️ **静止时不写 transform**（`style` 为空对象）：
 *    transform 会创建层叠上下文 + 把内部 `position: fixed` 的包含块
 *    劫持到本元素上。本项目里所有弹层都必须 teleport="body" 正是为了
 *    躲 iOS 的绘制顺序问题，如果这里常驻一个 `translateX(0)`，等于
 *    又给页面内的 fixed 元素挖了个坑。所以只在真的有位移时才输出 transform。
 *    （拖动 / 离场 / 入场期间那 ~300ms 是有 transform 的，这一条靠
 *    「所有 popup 必须 teleport」兜底，不要在页面内新增 fixed 元素。）
 *
 * 6) **切换分三段播完，不要瞬变**（`commit()`）：
 *    各 tab 的内容是 v-if 惰性渲染（记录页刻意如此，避免两个
 *    TransactionList 同时 onMounted 发重复请求），**没有相邻内容可以真的
 *    滑进来**。所以不能照抄 ViewPager 的「两页并排平移」。
 *    这里的做法是给「替换」本身套一层位移：
 *
 *       leaving  110ms：旧内容朝手指方向滑出 16% 视口宽 + 淡出
 *       ───────────── 此刻才 onChange（内容替换）─────────────
 *       entering 160ms：新内容从反方向 12% 处滑回 0 + 淡入
 *
 *    手指抬起后看到的是「内容继续朝你划的方向走出去 → 新内容从另一侧走进来」，
 *    方向连续、没有突变。总时长 270ms，与模块切换的淡入淡出（260ms）同级。
 *
 *    下标动画（下划线 / 文字色）不参与这三段：它在手指抬起时直接带
 *    transition 滑到目标位置，与 leaving 段并行，观感上「下划线先到位、
 *    内容随后跟进」，符合先指示器后内容的直觉。
 */
import { computed, nextTick, onUnmounted, ref, watch, type CSSProperties } from 'vue'

/** 轴向锁定阈值：小于它的位移视为抖动，不表态 */
const AXIS_LOCK = 8
/** 判横向所需的最小「水平 / 垂直」比值 */
const AXIS_RATIO = 1.4
/** 触发切换的水平位移：视口宽的 18%，夹在 44~96px 之间（宽屏不至于太远） */
const TRIGGER_RATIO = 0.18
const TRIGGER_MIN = 44
const TRIGGER_MAX = 96
/** 快速轻扫：位移够短但动作够快也算数（单位 px / ms） */
const FLICK_DIST = 24
const FLICK_TIME = 240
/** 到头时的阻尼系数（跟手时是 1:1，只有到头才衰减） */
const FOLLOW_EDGE = 0.25
/** 左边缘保护区（px）：iOS 浏览器模式下从最左边缘起手的右滑是系统「返回上一页」，别抢 */
const EDGE_GUARD = 24
/** 离场 / 入场：位移占视口宽的比例与时长（ms） */
const EXIT_SHIFT = 0.16
const ENTER_SHIFT = 0.12
const EXIT_MS = 110
const ENTER_MS = 160

export interface SwipeTabsOptions {
  /** 当前模块的二级 tab（顺序即左右顺序） */
  tabs: () => ReadonlyArray<{ value: string }>
  /** 当前激活值 */
  active: () => string
  /** 切换回调 —— 与点击 tab 同一个入口，保证两条路径行为一致 */
  onChange: (value: string) => void
  /**
   * 内容区可视宽度（px）。
   * 用来把「像素位移」换算成「进度」（第几个 tab 的小数位置），
   * 以及算离场 / 入场的位移距离。传内容区的 clientWidth 即可。
   */
  viewport: () => number
}

/**
 * 手势起点是否落在「不该被接管」的区域。
 * 返回 true = 本次手势完全不参与（交给列表左滑 / 容器自己的横滚）。
 */
function shouldSkip(el: EventTarget | null): boolean {
  // 用 Element 而不是 HTMLElement：页面里的图标是 <svg>（SVGElement），
  // 手指落在图标上滑动时 target 就不是 HTMLElement，会被误判成「跳过」。
  if (!(el instanceof Element)) return true
  // van-swipe-cell：左滑删除，横滑归它
  if (el.closest('.van-swipe-cell')) return true
  // 输入框内：横滑是移动光标 / 选中文本，不是切 tab
  if (el.closest('input, textarea, select, [contenteditable="true"]')) return true
  // 横向可滚动的祖先容器：横滑归容器
  let node: Element | null = el
  while (node && node !== document.body) {
    // scrollWidth / clientWidth 只有 HTMLElement 才有（SVG 元素没有）
    if (node instanceof HTMLElement) {
      const ox = getComputedStyle(node).overflowX
      // 只认**真的能横滚**的容器。
      // 余量给到 4px：只写了 `overflow-y:auto` 的容器，按 CSS 规范其 overflow-x
      // 的 computed 值也会被算成 `auto`，但它的 scrollWidth 与 clientWidth
      // 基本相等（可能差 1~2px 的取整误差），不能因此把竖向滚动容器误判成横滚容器。
      if ((ox === 'auto' || ox === 'scroll') && node.scrollWidth > node.clientWidth + 4) return true
    }
    node = node.parentElement
  }
  return false
}

export function useSwipeTabs(opts: SwipeTabsOptions) {
  /** 内容区水平位移（px）。正 = 朝右（手指右滑 / 新内容从右进场） */
  const offset = ref(0)
  /** 手指是否正按着并已锁定横向 */
  const dragging = ref(false)
  /** 瞬时归位（入场第一帧就位）：这一帧不要过渡，否则新内容会从旧位置滑过来 */
  const instant = ref(false)
  /** 内容区不透明度（离场淡出 / 入场淡入） */
  const opacity = ref(1)
  /** 切换编排的阶段：idle → leaving → entering → idle */
  const phase = ref<'idle' | 'leaving' | 'entering'>('idle')
  /**
   * leaving / entering 期间 progress 锚到「目标下标」（此时 active 还没变 / 刚变，
   * 直接用 index() 会让下划线在换内容的瞬间抖一下）。
   */
  const targetIndex = ref(0)

  let tracking = false
  let axis: 'none' | 'x' | 'y' = 'none'
  let startX = 0
  let startY = 0
  let startAt = 0
  let lastDx = 0
  let lastDy = 0
  /** 世代号：切模块 / tab 集合变化时 +1，用来作废进行中的切换编排 */
  let gen = 0
  let timer: ReturnType<typeof setTimeout> | null = null

  const vw = (): number => Math.max(1, opts.viewport())
  const count = (): number => opts.tabs().length
  const index = (): number => Math.max(0, opts.tabs().findIndex((t) => t.value === opts.active()))

  function clearTimer(): void {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  /** 回到完全静止：清位移、清阶段、作废进行中的编排 */
  function cancelAll(): void {
    gen++
    clearTimer()
    tracking = false
    axis = 'none'
    lastDx = 0
    lastDy = 0
    dragging.value = false
    instant.value = false
    offset.value = 0
    opacity.value = 1
    phase.value = 'idle'
  }

  function reset(): void {
    tracking = false
    axis = 'none'
    lastDx = 0
    lastDy = 0
  }

  /** 延时 ms；返回 false 表示这段时间里被 cancelAll 作废了（调用方应立刻收手） */
  function sleep(ms: number, g: number): Promise<boolean> {
    return new Promise((resolve) => {
      timer = setTimeout(() => {
        timer = null
        resolve(g === gen)
      }, ms)
    })
  }

  function begin(x: number, y: number, el: EventTarget | null): void {
    reset()
    // 无 tab / 只有一个 tab / 二级页 → 不接管
    if (count() < 2) return
    // 上一次切换还没播完：不打断，等它播完（否则会看到两段动画叠在一起）
    if (phase.value !== 'idle') return
    if (x < EDGE_GUARD) return
    if (shouldSkip(el)) return
    offset.value = 0
    opacity.value = 1
    tracking = true
    startX = x
    startY = y
    startAt = Date.now()
  }

  /** 返回 true = 本次事件已按横向手势处理（调用方可据此 preventDefault） */
  function move(x: number, y: number): boolean {
    if (!tracking) return false
    lastDx = x - startX
    lastDy = y - startY

    if (axis === 'none') {
      if (Math.abs(lastDx) < AXIS_LOCK && Math.abs(lastDy) < AXIS_LOCK) return false
      if (Math.abs(lastDx) > Math.abs(lastDy) * AXIS_RATIO) {
        axis = 'x'
        dragging.value = true
      } else {
        // 判为竖向：本次手势到此为止，交还给页面滚动
        reset()
        return false
      }
    }
    if (axis !== 'x') return false

    const i = index()
    const atStart = i <= 0 && lastDx > 0
    const atEnd = i >= count() - 1 && lastDx < 0
    // 1:1 跟手；只有拉到头了才衰减
    offset.value = lastDx * (atStart || atEnd ? FOLLOW_EDGE : 1)
    return true
  }

  function finish(): void {
    if (!tracking || axis !== 'x') {
      reset()
      dragging.value = false
      return
    }

    const dx = lastDx
    const elapsed = Date.now() - startAt
    const flick =
      Math.abs(dx) >= FLICK_DIST && elapsed < FLICK_TIME && Math.abs(dx) > Math.abs(lastDy)
    const threshold = Math.min(TRIGGER_MAX, Math.max(TRIGGER_MIN, vw() * TRIGGER_RATIO))
    const far = Math.abs(dx) >= threshold
    const dir = dx < 0 ? 1 : -1 // 左滑 → 下一个
    const next = index() + dir

    reset()
    if ((far || flick) && next >= 0 && next < count()) {
      void commit(dir, next)
    } else {
      // 没到阈值：松手弹回。
      // ⚠️ 不能在同一帧里把 offset 直接改成 0：offset 归零后 style 就不输出
      //    transform 了（见文件头第 5 条），元素会「跳」回原位，没有过渡可播。
      //    先保留当前位移结束拖动（transition 生效），下一帧再归零 → 回弹动画。
      dragging.value = false
      instant.value = false
      nextTick(() => {
        offset.value = 0
      })
    }
  }

  /**
   * 点击 tab 时走**同一套**编排（见文件头第 6 条）。
   *
   * 不做这个的话，「滑动切」是柔和的三段动画、「点击切」是内容瞬间替换，
   * 同一个操作两条观感，落差比单纯生硬更难受。
   * 方向取「新 tab 在当前 tab 的哪一侧」，与手指划的方向语义一致。
   */
  function switchTo(value: string): void {
    if (phase.value !== 'idle') {
      // 上一段动画还没播完：不叠动画，直接切（宁可快，不要糊）
      opts.onChange(value)
      return
    }
    const next = opts.tabs().findIndex((t) => t.value === value)
    const cur = index()
    if (next < 0 || next === cur) return
    void commit(next > cur ? 1 : -1, next)
  }

  /** 切换编排：滑出 → 换内容 → 滑入（见文件头第 6 条） */
  async function commit(dir: number, next: number): Promise<void> {
    const g = gen
    const w = vw()

    // ── 离场：旧内容朝手指方向滑出并淡出 ──
    dragging.value = false
    instant.value = false
    targetIndex.value = next
    phase.value = 'leaving'
    offset.value = -dir * w * EXIT_SHIFT
    opacity.value = 0
    if (!(await sleep(EXIT_MS, g))) return

    // ── 换内容（v-if 惰性渲染，没有相邻页可滑，只能在这一刻替换）──
    opts.onChange(opts.tabs()[next].value)

    // ── 入场：从反方向就位（无过渡），再滑回 0 并淡入 ──
    phase.value = 'entering'
    instant.value = true
    offset.value = dir * w * ENTER_SHIFT
    opacity.value = 0
    await nextTick()
    if (g !== gen) return
    instant.value = false
    offset.value = 0
    opacity.value = 1
    if (!(await sleep(ENTER_MS, g))) return

    phase.value = 'idle'
  }

  // 切模块 / tab 集合变了（如待办进入多选态隐藏 tab）→ 中止一切进行中的动画
  watch(
    () => opts.tabs(),
    () => {
      cancelAll()
    }
  )

  // ==================== 触摸（真机）====================
  function onTouchStart(e: TouchEvent): void {
    if (e.touches.length > 1) {
      // 多指（缩放等）：不参与
      reset()
      return
    }
    begin(e.touches[0].clientX, e.touches[0].clientY, e.target)
  }

  function onTouchMove(e: TouchEvent): void {
    if (!tracking) return
    const t = e.touches[0]
    if (!t) return
    // 锁定横向后阻止默认行为：否则手指带一点纵向分量时，页面会一边切 tab
    // 一边纵向滚动，两条动效同时跑，非常脏。
    // （模板上的 touchmove 不是 passive 的 —— Vue 只有写 .passive 修饰符才是 ——
    //   所以这里 preventDefault 有效。）
    if (move(t.clientX, t.clientY) && e.cancelable) e.preventDefault()
  }

  function onTouchEnd(): void {
    finish()
  }

  // ==================== 鼠标（桌面调试用）====================
  // 桌面浏览器没有 touch 事件，加一段鼠标拖拽，方便在电脑上验证手势逻辑。
  // 只在真正拖出位移后才 preventDefault 阻止文本选中，单击按钮不受影响。
  function onMouseDown(e: MouseEvent): void {
    if (e.button !== 0) return
    begin(e.clientX, e.clientY, e.target)
    if (!tracking) return
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }

  function onMouseMove(e: MouseEvent): void {
    if (move(e.clientX, e.clientY) && e.cancelable) e.preventDefault()
  }

  function onMouseUp(): void {
    finish()
    window.removeEventListener('mousemove', onMouseMove)
    window.removeEventListener('mouseup', onMouseUp)
  }

  // 卸载时兜底摘掉全局监听与定时器（正常路径由 onMouseUp 自己摘）
  onUnmounted(() => {
    window.removeEventListener('mousemove', onMouseMove)
    window.removeEventListener('mouseup', onMouseUp)
    clearTimer()
    gen++
  })

  /**
   * 连续进度（浮点下标）。
   *
   * 拖动中 = 当前下标 + 手指拖出的比例（左滑为正，因为左滑是去下一个）；
   * 切换编排中 = 目标下标（下划线与内容同步到位）；
   * 静止 = 当前下标（整数）。
   *
   * 消费方：SubTabBar 用它插值下划线位置与文字颜色，HomeLayout 用它算内容位移。
   */
  const progress = computed<number>(() => {
    if (phase.value === 'leaving' || phase.value === 'entering') return targetIndex.value
    if (dragging.value) {
      const n = count()
      const p = index() - offset.value / vw()
      return Math.max(0, Math.min(n - 1, p))
    }
    return index()
  })

  /** 内容区样式：静止时**不输出** transform（见文件头第 5 条） */
  const style = computed<CSSProperties>(() => {
    const idle = offset.value === 0 && opacity.value === 1
    if (idle) return {}
    const noAnim = dragging.value || instant.value
    const dur = phase.value === 'leaving' ? EXIT_MS : ENTER_MS
    return {
      transform: `translateX(${offset.value}px)`,
      opacity: opacity.value,
      transition: noAnim
        ? 'none'
        : `transform ${dur}ms var(--ease-out), opacity ${dur}ms var(--ease-out)`,
      willChange: 'transform, opacity',
    }
  })

  const handlers = {
    touchstart: onTouchStart,
    touchmove: onTouchMove,
    touchend: onTouchEnd,
    touchcancel: onTouchEnd,
    mousedown: onMouseDown,
  }

  return { style, handlers, progress, dragging, switchTo }
}
