/**
 * 长按手势 composable
 *
 * 背景（Phase 0 · B4）：工程里所有「删除」原先都绑在 `@contextmenu` 上。
 * 桌面浏览器右键会派发 `contextmenu`，但**移动端浏览器长按不会**派发该事件
 * （iOS Safari 长按弹的是系统菜单，Android 多数只派发 touch 系列），
 * 所以这些删除入口在真机上是完全不可用的。
 *
 * 什么时候用哪个手势：
 *   - 竖向列表（任务、习惯）→ 用 `van-swipe-cell` 左滑，更符合直觉，见任务页
 *   - **横向滚动**的卡片（账户横滚条）→ 不能用左滑，横向拖动手势会和滚动冲突，
 *     此时用长按，见记录页账户区
 *   - 长按进入多选模式（Phase 2.4）→ 也复用本 composable
 *
 * 用法：
 *   const lp = useLongPress(() => showDeleteConfirm())
 *   <div v-on="lp.handlers" @click="onClick">
 *   function onClick() {
 *     if (lp.consumeClick()) return  // 丢弃长按后的那次 click
 *     openEditSheet()
 *   }
 *
 * `consumeClick()` 用来吞掉长按之后紧随的那次 click —— 否则长按删除后
 * 会立刻再触发一次「点击打开编辑弹层」。
 */
import { onUnmounted } from 'vue'

export interface LongPressOptions {
  /** 判定为长按所需的按住时长（ms） */
  duration?: number
  /** 手指移动超过该像素数即视为滚动，取消长按 */
  moveThreshold?: number
  /** 长按触发后多久内的 click 需要被吞掉（ms） */
  clickGuard?: number
}

export interface LongPressHandlers {
  onTouchstart: (e: TouchEvent) => void
  onTouchmove: (e: TouchEvent) => void
  onTouchend: () => void
  onTouchcancel: () => void
  onContextmenu: (e: Event) => void
}

export interface UseLongPressReturn {
  /** 直接 `v-on="handlers"` 展开到元素上 */
  handlers: LongPressHandlers
  /** 若刚刚发生过长按则返回 true 并消费掉这次判定（供 click 处理函数首行调用） */
  consumeClick: () => boolean
}

const DEFAULT_DURATION = 500
const DEFAULT_MOVE_THRESHOLD = 10
const DEFAULT_CLICK_GUARD = 700

export function useLongPress(
  handler: () => void,
  options: LongPressOptions = {}
): UseLongPressReturn {
  const duration = options.duration ?? DEFAULT_DURATION
  const moveThreshold = options.moveThreshold ?? DEFAULT_MOVE_THRESHOLD
  const clickGuard = options.clickGuard ?? DEFAULT_CLICK_GUARD

  let timer: ReturnType<typeof setTimeout> | null = null
  let startX = 0
  let startY = 0
  /** 长按触发的时间戳；0 表示未触发 */
  let firedAt = 0

  function clearTimer(): void {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  function onTouchstart(e: TouchEvent): void {
    const touch = e.touches[0]
    if (!touch) return
    startX = touch.clientX
    startY = touch.clientY
    clearTimer()
    timer = setTimeout(() => {
      timer = null
      firedAt = Date.now()
      handler()
    }, duration)
  }

  function onTouchmove(e: TouchEvent): void {
    if (timer === null) return
    const touch = e.touches[0]
    if (!touch) return
    const dx = Math.abs(touch.clientX - startX)
    const dy = Math.abs(touch.clientY - startY)
    // 判定为滚动 / 拖拽 → 放弃长按，避免滚动途中误触发
    if (dx > moveThreshold || dy > moveThreshold) clearTimer()
  }

  /** 阻止长按后浏览器弹出的系统上下文菜单（部分安卓 WebView 仍会派发） */
  function onContextmenu(e: Event): void {
    e.preventDefault()
  }

  function consumeClick(): boolean {
    if (firedAt === 0) return false
    const isRecent = Date.now() - firedAt <= clickGuard
    firedAt = 0
    return isRecent
  }

  onUnmounted(clearTimer)

  return {
    handlers: {
      onTouchstart,
      onTouchmove,
      onTouchend: clearTimer,
      onTouchcancel: clearTimer,
      onContextmenu,
    },
    consumeClick,
  }
}
