<script setup lang="ts">
/**
 * HomeLayout
 * 移动端主布局：状态栏 + 页面顶部栏 + 模块内二级 tab 栏 + 内容区 + 底部 Pill TabBar
 * 严格遵循 spec/02-导航规范.md §1
 *
 * ⚠️ 2026-09-19 起，顶部栏（PageHeader）与模块内二级 tab 栏（SubTabBar）**由本布局
 *    常驻渲染**，不再写在 5 个页面里（配置见 composables/usePageChrome.ts）。
 *
 *    原因：原来 header / tab 是页面模板的一部分，切模块时跟着页面一起销毁重建，
 *    用户看到的是「先白一下，标题和选项卡才出来」。提到布局层后，路由一变头部
 *    立刻换文案与新 tab，页面只负责内容区的过渡 —— 切模块不再等头部。
 *
 *    副作用（好事）：三个模块的二级 tab 栏连数据源也只有一份，不会再出现
 *    「同一个角色三处各写各的」。
 *
 * ⚠️ 2026-09-19：**所有弹层（van-popup）都必须写 `teleport="body"`。**
 *
 *    本布局的 chrome（PageHeader / SubTabBar / .tabbar）与各页 FAB 都活在根层叠
 *    上下文里，靠 z-index 200 / 300 压在内容区之上。而 Vant 4 的 Popup **不传
 *    teleport 就是原地渲染**（node_modules/vant/es/popup/Popup.mjs 的 render 里
 *    `props.teleport` 为假时走 Fragment），于是弹层会落在 `.content` 内部的滚动
 *    容器里。桌面浏览器上 `position:fixed` 正常逃逸到视口，看不出问题；iOS 上
 *    该滚动容器被 WebKit 提升为独立合成层，弹层的**绘制顺序**被困在里面 ——
 *    z-index 给到 2001 也照样被上面的 chrome 盖住顶部与底部（真机报障：
 *    经期记录浮层的日期行被二级 tab 栏吃掉、「完成」按钮被胶囊与 FAB 吃掉）。
 *
 *    完整推理与实测数据见 components/period/PeriodDaySheet.vue 顶部注释。
 *    新增弹层时不要省这个属性，也不要以为「z-index 调大点就行」。
 */
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Icon from '@/components/icon/Icon.vue'
import PageHeader from '@/components/PageHeader.vue'
import SubTabBar from '@/components/SubTabBar.vue'
import { usePageChrome } from '@/composables/usePageChrome'
import { useSwipeTabs } from '@/composables/useSwipeTabs'
import type { IconName } from '@/components/icon/names'
import { prefetchTabChunks } from '@/router/prefetch'

interface TabItem {
  name: string         // 路由 name
  path: string         // 路由 path
  label: string        // 中文标签
  enLabel: string      // 英文标签
  icon: IconName       // Lucide 图标名（与桌面端侧栏同一套）
}

/**
 * Tab 图标与桌面端侧栏导航逐条对应（02 §6.1）。
 * 注意：记录页桌面端是 BookOpen，移动端历史上用的 emoji 是 📔，图标名仍取 BookOpen。
 */
const TABS: TabItem[] = [
  { name: 'Home',   path: '/home',   label: '首页', enLabel: 'HOME',   icon: 'Home' },
  { name: 'Task',   path: '/task',   label: '任务', enLabel: 'TASKS',  icon: 'ListChecks' },
  { name: 'Record', path: '/record', label: '记录', enLabel: 'RECS',   icon: 'BookOpen' },
  { name: 'Stat',   path: '/stat',   label: '统计', enLabel: 'STATS',  icon: 'BarChart3' },
  { name: 'Me',     path: '/me',     label: '我的', enLabel: 'ME',     icon: 'User' },
]

const route = useRoute()
const router = useRouter()

/** 顶部栏 + 模块内二级 tab 栏：由当前路由推导，路由一变立即生效（不经过页面） */
const { module, header, tabs, activeTab, onTabChange, onAction } = usePageChrome()

/**
 * 内容区左右滑 → 切换当前模块的二级 tab（待办 / 记录 / 统计）。
 *
 * 只认「有 tab 的模块」：首页、我的、二级页的 tabs 是空数组，手势自动失效。
 * 切换走的是 onTabChange（与点击 tab 同一个入口），所以两条路径的数据加载、
 * 副作用完全一致。
 * 让位规则（左滑删除 / 横向滚动容器）见 composables/useSwipeTabs.ts 文件头。
 *
 * 手势对外只吐一个「连续进度 progress」（浮点下标），三个视觉层同时消费它：
 *   contentStyle → 内容区位移（1:1 跟手）
 *   SubTabBar    → 下划线位置 + 文字颜色（跟着手指走，见组件顶部说明）
 * 三者同源，才不会出现「下划线先跳、内容后动」的割裂。
 *
 * ⚠️ 必须在 setup 顶层解构成独立变量：模板的 ref 自动解包**只对顶层绑定生效**，
 *    写 `swipe.style` 拿到的是 ComputedRef 实例本身（运行时与类型检查都不会解包）。
 */
const contentRef = ref<HTMLElement | null>(null)
const {
  style: contentStyle,
  handlers: swipeHandlers,
  progress,
  dragging: swiping,
  switchTo,
} = useSwipeTabs({
    tabs: () => tabs.value,
    active: () => activeTab.value,
    onChange: onTabChange,
    // 内容区宽度：把像素位移换算成「第几个 tab 的小数位置」
    viewport: () => contentRef.value?.clientWidth ?? window.innerWidth,
  })

/** 当前激活 tab（基于 route.name） */
const activeTabName = computed(() => {
  const found = TABS.find((t) => t.name === route.name)
  return found?.name ?? ''
})

/** 激活项下标 —— 胶囊里那块滑动背景靠它做位移 */
const activeIndex = computed(() => {
  const i = TABS.findIndex((t) => t.name === activeTabName.value)
  return i < 0 ? 0 : i
})

/** 点击 tab */
function onTabClick(tab: TabItem) {
  if (tab.name === activeTabName.value) return
  router.push(tab.path)
}

/**
 * 二级页面（如 `/task/:id` 详情）通过 `meta.hideTab` 隐藏底部 TabBar。
 * 否则详情页底部会被 TabBar 压住，且「当前 tab」高亮会莫名其妙地全部熄灭。
 */
const hideTab = computed(() => route.meta.hideTab === true)

/**
 * 内容区 router-view 的 key。
 *
 * 2026-09-24（spec-20260924-v2 S1）：切页不再销毁重建 —— 5 个主 Tab 页由
 * `<KeepAlive>` 缓存（见 template），切回来瞬显、不重拉。key 的取值随之调整：
 *
 * ⚠️ 主 Tab 页的 key 用 **route.name**，**不能**再用 route.fullPath。
 *    KeepAlive 靠 key 判断「是不是同一个实例」：若用 fullPath，同一个 Tab
 *    带不同 query（如 /task?filter=all → /task?filter=done）会被当成两个实例、
 *    缓存两份、且都命中不了，反而更慢。用 route.name 后同 Tab 恒定复用同一实例；
 *    Tab 内的 query 变化交给页面自己的 watch 处理。
 *
 * ⚠️ 例外：**覆盖层子路由**（`meta.overlay`，见 router/index.ts 的
 *    /record/finance-categories）必须与它的宿主页面共用同一个 key ——
 *    否则 push 覆盖层时 key 一变，宿主页（记录页）就被销毁重建，
 *    「返回后回到记一笔、且不重播动画」直接落空。
 *    这里取 matched 里**上一层**的 name（即宿主页面 Record）。
 *
 * ⚠️ 二级页（/task/:id 等）本就不在 KeepAlive 白名单里，key 取 name 也无妨：
 *    它们的 name 各不相同，切换时照常重建。
 */
const viewKey = computed(() => {
  if (route.meta.overlay) {
    // 返回宿主页面的 name（如 /record/finance-categories 的宿主是 Record），
    // 与直接访问 /record 时产出的 key 完全一致（都是 'Record'），
    // 从而保证 push/pop 覆盖层时宿主页**不被重建**。
    const host = route.matched[route.matched.length - 2]
    return host?.name ?? route.name ?? route.fullPath
  }
  return route.name ?? route.fullPath
})

/**
 * `<KeepAlive>` 缓存白名单（spec-20260924-v2 S1）。
 *
 * 只缓存 5 个主 Tab 页，**不**含二级页 / 详情页（它们的 name 不在名单里，
 * 照常销毁重建）。按 name 精确匹配，避免误缓存。
 */
const KEEP_ALIVE_TABS = ['Home', 'Task', 'Record', 'Stat', 'Me']

/**
 * 状态栏占位的底色：必须与「当前页 header 的首端色」严格同色。
 *
 * 占位条是 content 之外的独立元素，默认透明 → 露出 --color-bg-app(#F9F9F9)。
 * 而各 Tab 页的 header 用的是 --color-bg-card(#FFFFFF) 纯白，两者不同色，
 * 于是在状态栏区域留下一道「没铺满的白色条块」（首页当年也是这个毛病，
 * 只是它顺手用 is-hero 打补丁修掉了）。
 *
 * 现在按模块统一取色（口径与 PageHeader 一致）：
 *   - 首页         → header 是 --color-primary-light 起头的色带，占位条沿用同色
 *   - 其它一级模块 → header 是 --color-bg-card 实色
 *   - 二级页       → 页面自带返回栏，此处透明
 * 暗色模式下两个令牌都会跟随切换，不会漏光。
 */
const statusBarBg = computed(() => {
  if (module.value === 'Home') return 'var(--color-primary-light)'
  if (module.value) return 'var(--color-bg-card)'
  return 'transparent'
})

/**
 * 进入主应用后趁浏览器空闲预取其余 Tab 的代码分包，
 * 让「首次点某个 Tab」不必等下载（见 router/prefetch.ts）。
 */
onMounted(() => {
  prefetchTabChunks()
})
</script>

<template>
  <div class="home-layout">
    <!-- 顶部状态栏占位（iOS 44 + 实际状态栏 18 = 62px）；底色跟随当前页 header 首端色 -->
    <div
      class="status-bar-placeholder"
      :style="{ background: statusBarBg }"
      aria-hidden="true"
    />

    <!-- 页面顶部栏（常驻，切模块只换文案不重建） -->
    <PageHeader v-if="header" v-bind="header" @action="onAction" />

    <!-- 模块内二级 tab 栏（待办 / 记录 / 统计；同样常驻）
         progress / dragging 来自左右滑手势：拖动时下划线与文字色跟手连续变化，
         不再等「切完了才动」。不滑的时候 progress 就是整数下标，点击仍有动画。 -->
    <SubTabBar
      v-if="tabs.length"
      :tabs="tabs"
      :active="activeTab"
      :progress="progress"
      :dragging="swiping"
      aria-label="模块内导航"
      @change="switchTo"
    />

    <!-- 中间内容区（自己不滚动，滚动在页面内部的 body 容器里，见下方样式注释）。
         左右滑切换二级 tab 的手势也绑在这里（见 script 里的 useSwipeTabs 注释）：
         待办 / 记录 / 统计三个模块生效，首页 / 我的 / 二级页自动失效。 -->
    <main
      ref="contentRef"
      class="content"
      :style="contentStyle"
      @touchstart="swipeHandlers.touchstart"
      @touchmove="swipeHandlers.touchmove"
      @touchend="swipeHandlers.touchend"
      @touchcancel="swipeHandlers.touchcancel"
      @mousedown="swipeHandlers.mousedown"
    >
      <router-view v-slot="{ Component }">
        <!-- 2026-09-24（spec-20260924-v2 S1+S2）：
             ① `<KeepAlive>` 缓存 5 个主 Tab 页，切回不重建、不重拉（瞬切）；
             ② transition 去掉 `mode="out-in"`，缩短时长——原来串行 260ms
                （淡出 130 + 淡入 130）中间有一小段空档，现在重叠且总时长约 90ms。
             详见同批 spec `md/spec-20260924-v2/`。 -->
        <transition name="fade-page">
          <keep-alive :include="KEEP_ALIVE_TABS">
            <component :is="Component" :key="viewKey" />
          </keep-alive>
        </transition>
      </router-view>
    </main>

    <!-- 底部 Pill Tab Bar -->
    <nav v-if="!hideTab" class="tabbar" role="navigation" aria-label="主导航">
      <div class="tabbar-pill" :style="{ '--tab-count': TABS.length }">
        <!--
          滑动背景：一块与 tab 等宽的实心圆角块，靠 translateX 在 5 个位置之间滑。
          之前是直接给 .is-active 换底色 —— 切换时是「旧的啪一下没、新的啪一下有」，
          两块之间没有任何连续性。改成滑动块后，切换时背景是「移」过去的。
        -->
        <span
          class="tab-pill-indicator"
          :style="{ '--tab-index': activeIndex }"
          aria-hidden="true"
        />
        <button
          v-for="tab in TABS"
          :key="tab.name"
          type="button"
          class="tab-item"
          :class="{ 'is-active': activeTabName === tab.name }"
          :aria-label="tab.label"
          :aria-current="activeTabName === tab.name ? 'page' : undefined"
          @click="onTabClick(tab)"
        >
          <Icon :name="tab.icon" :size="20" class="tab-icon" aria-hidden="true" />
          <span class="tab-label">{{ tab.enLabel }}</span>
        </button>
      </div>
    </nav>
  </div>
</template>

<style lang="scss" scoped>
.home-layout {
  display: flex;
  flex-direction: column;
  width: 100%;
  /* ⚠️ 高度有两条铁律：
     1) 必须是**固定高度**（height），不能用 min-height —— min-height 会被
        内容撑高，使 .content 的 overflow:hidden 空转、溢出一路传到 body，
        整页出现根滚动（iOS 上 fixed 的胶囊被带着滚、各页顶部栏滑走）。
     2) 必须用**百分比**跟随父级（#app → .app-root），不能写 100vh / 100dvh。
        整条链只用百分比时高度基准唯一；混入视口单位后，只要 dvh 与百分比
        基准差哪怕几像素，本容器就会超出根元素 —— 还是根滚动。
     详见 styles/reset.scss 顶部的高度链说明。 */
  height: 100%;
  height: var(--app-height);
  overflow: hidden;
  background: var(--color-bg-app);
  /* 定位容器：底部胶囊 / 各页悬浮按钮都锚定到这里（见 .tabbar 注释）。
     ⚠️ 本容器**自己不滚动**（overflow:hidden），滚动只发生在页面内部的
     body 容器里，所以锚定在它上面的元素天然不会跟随滚动。 */
  position: relative;
}

/* 状态栏占位：iOS 安全区 + 系统状态栏。
   高度与各页 .page-header 上下拼接成连续色块，底色由 statusBarBg 内联注入
   （见 script 里的注释：必须与当前页 header 的首端色同色）。 */
.status-bar-placeholder {
  height: calc(env(safe-area-inset-top, 0px) + 18px);
  background: var(--color-bg-app);
  flex-shrink: 0;
}

/* 中间内容：**自己不滚动**，只负责把高度分配给页面。
 *
 * 滚动下沉到每个页面内部的 body 容器（.home-body / .task-list-wrap /
 * .tab-body / .stat-body / .page-body / .detail-body）。
 * 这样页面的顶部栏天然落在滚动区之外 —— 不滚、不需要 position:sticky，
 * 也就永远不会与上方状态栏色带「拉断开」。
 * 历史方案（header 用 sticky 钉在 .content 里）在 iOS 下拉回弹时
 * sticky 元素会被一起带下来，header 与色带之间就露出一条缝。
 *
 * 高度的传递不用百分比，而是靠 flex（见下方 display:flex + 子项 flex:1）：
 * 页面根的 body 子元素依然是 flex:1 + min-height:0 + overflow-y:auto，
 * 只要页面根拿到确定高度，页内滚动就成立。
 *
 * 底部胶囊的留白改由各页 body 的 padding-bottom 承担（--tabbar-reserve），
 * 二级页（hideTab）自带 padding，不在此处叠加。 */
.content {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  /* 本容器是 flex 容器：高度**由 flex 算法直接分配给页面根**，
     页面根自己不需要（也不该）再写 height:100%。 */
  display: flex;
  flex-direction: column;

  /**
   * 页面根元素（5 个 Tab 页 / 任务详情）填满内容区。
   *
   * ⚠️ 这里**必须**用 flex 传高度，**不能**用 `position:absolute; inset:0`。
   *
   * absolute 方案要求页面根保持 `position: static`，但每个页面根都必须写
   * `position: relative`（它是 FAB / 批量操作栏的定位容器）。两条规则
   * 特异性相同（都是一个 class + 一个属性选择器），**谁生效完全取决于
   * CSS 的加载顺序** —— 而子路由的样式总在 HomeLayout 之后注入，于是
   * 页面根的 `relative` 静默胜出，absolute 方案被架空，页面高度又退回
   * 依赖 `height:100%` 的百分比解析（iOS Safari 上不可靠：布局早期父级
   * 高度未定型，WebKit 先按 auto 处理）。
   *
   * 症状（用户真机报障）：「待办模块的滚动行为和其他模块不一致，上下滑
   * 会导致 header 和胶囊跟着动」—— 页面根被内容撑高 → 页内滚动容器
   * （.task-list-wrap）空转 → 触摸传导到根 → 整个视觉视口被拖着弹。
   *
   * flex 方案没有这个隐患：高度由 flex 算法给定，不经过百分比解析，
   * 也不与页面根的 position 争抢同一个属性。
   */
  > :deep(*) {
    flex: 1 1 0%;
    min-height: 0;
  }
}

/* ========== 底部 TabBar（spec/02-导航规范.md §1） ========== */
.tabbar {
  /* ⚠️ 必须是 absolute，**不能**是 fixed。
   *
   * fixed 是唯一会被 iOS 系统「特殊对待」的定位方式：主屏 Web App 下
   * 系统会把 fixed 元素的底边自动内缩一个安全区高度（避让 Home
   * Indicator）。这个内缩发生在系统/浏览器层，**网页无法用 CSS 感知、
   * 也无法撤销** —— 之前用「探针实测 + 负 bottom 抵消」绕，但探针在
   * 真机上测不准（iOS 的 screen.height / innerHeight 与安全区的关系
   * 随机型与版本变化），结果就是胶囊下方始终空一块（用户连续三轮报障：
   * 「胶囊下面空一块，电脑调试模式没问题」）。
   *
   * absolute 定位到 .home-layout（定位容器、且自身不滚动），由**包含块
   * 几何**决定位置，系统不介入 —— 桌面浏览器、Android、iOS 浏览器模式、
   * iOS 主屏 Web App 四种环境下落点完全一致。
   * 「滚动不带动胶囊」也由这一点保证：包含块 .home-layout 不滚，
   * 滚动只发生在页面内部的 body 容器里。 */
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: var(--z-fixed);
  /* 底距只留 --tabbar-bottom-gap。 */
  padding: 12px 21px var(--tabbar-bottom-gap, 10px);
  /* 胶囊下方渐隐到页面底色。
     原来是 transparent：滚到底时列表内容会从胶囊下方直接穿出，加上系统
     Home Indicator 区域（standalone 下约 34px）也在这一带，看起来就是一条
     突兀的色块。改成渐变后既保留「悬浮胶囊」的观感，又让下方与页面底色连续。 */
  background: linear-gradient(
    to bottom,
    transparent 0%,
    transparent 38%,
    var(--color-bg-app) 76%
  );
  pointer-events: none; /* 容器不接收事件，由 pill 接收 */
}

.tabbar-pill {
  display: flex;
  align-items: center;
  height: var(--tabbar-pill-height);  /* 62px */
  padding: 4px;
  background: var(--color-bg-card);
  border: 1px solid var(--color-border);
  border-radius: 36px;  /* 半圆胶囊 */
  box-shadow: var(--shadow-md);
  pointer-events: auto;
  /* 滑动背景块的定位容器 */
  position: relative;
}

/**
 * 激活项背后的滑动色块。
 *
 * 用法上它和 .tab-item 一一对应：位置 = 激活项下标 × 自身宽度，
 * 靠 transform 位移（合成层动画，不触发布局重排，比改 left 流畅）。
 *
 * width 用 (100% - 8px) / 数量：8px = 胶囊左右 padding 之和，
 * 这样每块正好盖住一个 tab（tab 本身是 flex:1 等分剩余空间）。
 */
.tab-pill-indicator {
  position: absolute;
  top: 4px;
  bottom: 4px;
  left: 4px;
  width: calc((100% - 8px) / var(--tab-count, 5));
  border-radius: 26px;
  background: var(--color-primary);
  transform: translateX(calc(var(--tab-index, 0) * 100%));
  transition: transform var(--duration-base) var(--ease-spring);
  pointer-events: none;
  will-change: transform;
}

/* 尊重「减少动态效果」的系统设置 */
@media (prefers-reduced-motion: reduce) {
  .tab-pill-indicator { transition: none; }
}

.tab-item {
  position: relative;
  z-index: 1;  /* 压在滑动块之上，才看得到字与图标 */
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  height: 100%;
  border-radius: 26px;
  background: transparent;
  color: #9CA3AF;  /* 未激活：弱化色 */
  /* 只过渡颜色与按压缩放（原来写 all，会把背景色也一起动画化；
     现在底色由滑动块承担，不需要了） */
  transition:
    color var(--duration-fast) var(--ease-default),
    transform var(--duration-instant) var(--ease-default);
  -webkit-tap-highlight-color: transparent;
  outline: none;
  min-height: 44px; /* 无障碍：触摸目标 ≥ 44pt */

  /* 按下反馈 */
  &:active {
    transform: scale(0.96);
  }

  /* 激活态：白字 —— 底色由 .tab-pill-indicator 滑动块承担 */
  &.is-active {
    color: #FFFFFF;
  }
}

.tab-icon {
  display: block;
  /* 颜色继承 .tab-item 的 currentColor：未激活弱化、激活白字 */
}

.tab-label {
  font-size: var(--fs-tab);  /* 10pt */
  font-weight: 500;
  line-height: 1;
  letter-spacing: 0.5px;
  text-transform: uppercase;
}

/* 页面过渡（Tab 之间切换）。

   2026-09-24（spec-20260924-v2 S2）：
   - 去掉 `mode="out-in"`（模板里已去）—— 原来串行：旧淡出 130ms 完，新才淡入
     130ms，总 260ms 且中间有空档。现在两者重叠，总时长约 90ms。
   - `--duration-page`（130ms）→ `--duration-instant`（80ms）量级。
   配合 S1 的 KeepAlive（新内容已就绪），过渡只是锦上添花，越短越好。 */
.fade-page-enter-active,
.fade-page-leave-active {
  transition: opacity var(--duration-instant) var(--ease-default);
}
.fade-page-enter-from,
.fade-page-leave-to {
  opacity: 0;
}

/* 尊重「减少动态效果」的系统设置 */
@media (prefers-reduced-motion: reduce) {
  .fade-page-enter-active,
  .fade-page-leave-active {
    transition: none;
  }
}
</style>
