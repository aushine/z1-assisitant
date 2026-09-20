/**
 * iOS 视口高度 / 安全区：运行时修正与实测
 *
 * 这是移动端所有「一屏高度」「底部安全区」问题的唯一收口点。
 * 踩过两个 WebKit 坑，改代码前请先读完，不要再走回头路。
 *
 * ═══════════════════════════════════════════════════════════════
 * 坑 ①：standalone 冷启动时「视口高度」被少算
 * ═══════════════════════════════════════════════════════════════
 * 以主屏 App 方式**冷启动**时，WebKit 报告的动态视口高度
 * （100dvh / 100svh / window.innerHeight / visualViewport.height）
 * 会比真实屏幕**恰好矮一个 env(safe-area-inset-top)**：
 *
 *   iPhone 14 Pro（屏 393×852）  冷启动值      真实屏高    差值
 *   ---------------------------  -----------  ---------  ------
 *   screen.height                852          852        0     ✅
 *   100vh / 100lvh               852          852        0     ✅
 *   100dvh / 100svh              793          852       -59     ❌
 *   window.innerHeight           793          852       -59     ❌
 *   visualViewport.height        793          852       -59     ❌
 *
 * 后果：整页比屏幕矮约 59px，最后一条 UI 与屏幕物理底边之间留下可见空隙。
 * 这就是「胶囊下面空一块，电脑调试模式没问题」的根因 —— 桌面没有这个 bug。
 *
 * ⚠️ 因此**不要**用 window.innerHeight / visualViewport 当基准去测任何
 *    「底部差了多少」：基准本身就是错的，测出来的值永远圆不回来。
 *    （历史方案「探针测 fixed 内缩 + 负 bottom 抵消」正是栽在这里，
 *      而且 iOS 根本不渲染超出视口的 fixed 元素，负偏移会被忽略或裁掉。）
 *
 * 修法：standalone 下把 --app-height 覆写为 100vh（= 全屏）。
 * 浏览器模式必须保持 100dvh —— 那里 100vh 会含地址栏区域、反而偏高。
 *
 * ═══════════════════════════════════════════════════════════════
 * 坑 ②：env(safe-area-inset-*) 冷启动初期返回 0
 * ═══════════════════════════════════════════════════════════════
 * WebKit bug #191872：冷启动头几百毫秒 env() 可能读到 0px，需延时补测。
 * （另有 #274773：经 CSS 自定义属性 + getComputedStyle 读 env() 会拿到
 *   字面量字符串而非解析值 —— 所以下面的探针读的是**真实属性**
 *   offsetHeight，不经过自定义属性。）
 */

/** 全应用「一屏高度」的变量名（CSS 侧定义见 styles/reset.scss） */
const VAR_HEIGHT = '--app-height'

/** env(safe-area-inset-bottom) 的实测值 */
const VAR_ENV_BOTTOM = '--env-safe-bottom'

/**
 * 是否以「iOS 主屏 Web App」方式运行。
 *
 * 只用 navigator.standalone，**不用** matchMedia('(display-mode: standalone)')：
 * 后者在 iOS 上不可靠（可能回报 browser），而 navigator.standalone 是
 * iOS 专属且权威；Android 上为 undefined，于是本判定天然只命中 iOS。
 *
 * ⚠️ 这一点很关键：下面的 100vh 覆写**只对 iOS 正确**。
 *    Android PWA 的 100vh 含地址栏区域，必须继续用 100dvh。
 */
function isIOSStandalone(): boolean {
  return (navigator as Navigator & { standalone?: boolean }).standalone === true
}

/**
 * 坑 ① 的修复：把 --app-height 覆写为 100vh（= 全屏）。
 *
 * index.html 的 <head> 内联脚本已经做过一次（保证首帧正确），
 * 这里是挂载前的二次确认 —— 两处互为保险，都幂等。
 */
function applyStandaloneHeightFix(): void {
  if (!isIOSStandalone()) return
  document.documentElement.style.setProperty(VAR_HEIGHT, '100vh')
}

/**
 * 实测 env(safe-area-inset-bottom) 的真实像素值。
 *
 * 做法：造一个高度为 env() 的隐藏探针，读 offsetHeight。
 * 读的是**真实属性**而非自定义属性，规避 WebKit bug #274773。
 */
function measureEnvBottom(): number {
  const el = document.createElement('div')
  el.style.cssText =
    'position:fixed;top:0;left:0;width:0;visibility:hidden;pointer-events:none;'
  el.style.height = 'env(safe-area-inset-bottom, 0px)'
  document.body.appendChild(el)
  // 读布局属性会强制 reflow，避免拿到未计算的旧值
  const value = el.offsetHeight
  el.remove()
  return Number.isFinite(value) && value > 0 ? Math.round(value) : 0
}

/**
 * 坑 ① 的收尾：催促 iOS 完成「docking」重算。
 *
 * iOS 对主屏 Web App 有个未公开的 docking 行为：冷启动时视口单位先是错的
 * （少一个状态栏），只要满足以下任一条件就会重算并**缓存正确值**——
 *   · 页面发生过滚动         · 内容溢出视口哪怕 1px
 *   · 设备旋转一轮            · App 切到后台再回来
 * 未重算期间，文档（= --app-height = 100vh = 真实屏高）比视口高约 59px，
 * 底部那片区域在视口之外 —— 胶囊会被裁掉一截，必须让 iOS 尽快重算。
 *
 * 这里主动做一次 1px 的极小滚动来触发。触发是幂等的：已重算过（视口已是
 * 全屏高度）时文档不可滚，scrollTo 无任何效果。
 */
function triggerViewportRecalc(): void {
  if (!isIOSStandalone()) return
  const viewportShort = window.innerHeight < (window.screen?.height ?? 0) - 1
  if (!viewportShort) return
  window.scrollTo(0, 1)
  window.scrollTo(0, 0)
}

let initialised = false

/**
 * 初始化：修正视口高度 + 写入安全区实测值，并在会改变视口的事件上重测。
 * 必须在 app.mount() 之前调用，避免首帧用错值。
 */
export function initSafeArea(): void {
  if (initialised || typeof document === 'undefined') return
  initialised = true

  const applyEnv = () => {
    document.documentElement.style.setProperty(VAR_ENV_BOTTOM, `${measureEnvBottom()}px`)
  }

  // 视口高度修正要赶在首帧之前
  applyStandaloneHeightFix()
  applyEnv()

  // 坑 ②：冷启动初期 env() 可能还是 0，延时补测几次直到稳定。
  // 值相同时重复写入无副作用，所以不做去重与定时器清理。
  for (const ms of [60, 250, 800, 2000]) {
    window.setTimeout(applyEnv, ms)
  }

  // 坑 ① 的收尾：等首屏画完再催一次 docking 重算（两次互为保险）
  window.setTimeout(triggerViewportRecalc, 300)
  window.setTimeout(triggerViewportRecalc, 1200)

  // 旋转、键盘弹出、地址栏收放都会改变安全区
  window.addEventListener('resize', applyEnv)
  window.addEventListener('orientationchange', applyEnv)
  window.visualViewport?.addEventListener('resize', applyEnv)
}
