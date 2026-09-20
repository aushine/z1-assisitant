/**
 * 主 Tab 页面代码分包预取
 *
 * 背景：5 个 Tab 页都是路由级懒加载（`() => import('@/pages/xxx/index.vue')`），
 * 首次点到某个 Tab 时才去下载它的 JS chunk。网络稍慢就是一段白屏 ——
 * 这正是「切模块白屏久」里属于**网络下载**的那一半（另一半是布局被重建，
 * 见 App.vue 里 router-view 的 key 注释）。
 *
 * 做法：布局挂载后，趁浏览器空闲（requestIdleCallback）把其余 Tab 的模块
 * 提前拉进缓存。用户真正点击时模块已在内存里，切换只剩渲染耗时。
 *
 * 为什么安全：
 *   - 只在 `requestIdleCallback`（或 600ms 后的兜底 setTimeout）里跑，
 *     不与首屏渲染抢主线程 / 带宽；
 *   - 放在 HomeLayout 挂载时触发，即登录后才预热，未登录的登录页不会白下；
 *   - 每个 import 都 catch 掉，预取只是优化，失败绝不影响主流程。
 */
const TAB_CHUNKS: Array<() => Promise<unknown>> = [
  () => import('@/pages/home/index.vue'),
  () => import('@/pages/task/index.vue'),
  () => import('@/pages/record/index.vue'),
  () => import('@/pages/stat/index.vue'),
  () => import('@/pages/me/index.vue'),
]

/** 幂等：重复调用只生效一次（布局重挂载时不必再预热一遍） */
let started = false

export function prefetchTabChunks(): void {
  if (started) return
  started = true

  const run = () => {
    TAB_CHUNKS.forEach((load) => {
      // 静默失败：任何异常都不该冒泡到全局错误处理
      load().catch(() => {})
    })
  }

  type IdleWindow = Window & {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number
  }
  const idle = (window as IdleWindow).requestIdleCallback

  if (typeof idle === 'function') idle(run, { timeout: 2000 })
  else window.setTimeout(run, 600)
}
