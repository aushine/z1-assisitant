/**
 * UI 外壳状态（HomeLayout 渲染，页面驱动）
 *
 * 背景（2026-09-19）：
 *   顶部 header 与「模块内二级 tab 栏」原本写在 5 个 Tab 页各自的模板里。
 *   切模块时页面整体销毁重建，header / tab 也跟着消失再淡入 —— 肉眼看就是
 *   「切一下先白一下，标题和选项卡才出来」。
 *
 *   现在两者提升到 HomeLayout **常驻渲染**（配置见 composables/usePageChrome.ts）：
 *   路由一变，头部立刻换成新模块的文案，页面只负责内容区的淡入淡出。
 *
 * 于是产生了本 store —— 外壳需要、但数据源分散在各页面 / 各业务 store 的
 * 「非业务外壳状态」在这里收口：
 *   - 记录模块的二级 tab（纯 UI 状态，原本是 record 页的 local ref）
 *   - 首页头部文案（原本由 home 页的 /home 接口回填）
 *   - 页面临时接管头部（待办的多选模式）
 *   - header 右侧动作的处理函数（页面注册，布局调用）
 *
 * ⚠️ 业务数据（任务筛选 / 统计区间）**不**在这里另存一份 ——
 *    布局直接读 taskStore.filter、statsStore.range，避免两份状态漂移。
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { IconName } from '@/components/icon/names'

/**
 * 记录模块的二级 tab 取值（四个并列 tab，见 pages/record/index.vue 顶部注释）
 *
 * ⚠️ 2026-09-19 两轮去重：
 *    1. 原「资产」与「账户」两个 tab 指向同一个 AccountManager 组件、渲染
 *       完全相同的「总资产卡 + 账户网格 + 转账」—— 删「资产」留「账户」。
 *    2. 原「支出」「收入」两个 tab 共用同一个 TransactionList，而「支出」
 *       模式本就混合显示支出+收入（带类型筛选），「收入」是其纯子集 ——
 *       合并为单一「收支」（值 'transactions'，D-03 第十六轮，桌面端同步）。
 *    3. 2026-09-19 追加第 5 个维度「经期」（值 'period'）—— 位置**排在末尾**：
 *       二级 tab 的胶囊指示块位移是按索引算出来的，加末尾不动既有索引。
 */

/** ⚠️ 与 composables/usePageChrome.ts 的 RECORD_TABS **必须同改**（两处是唯一真源） */
export type RecordTab = 'habit' | 'finance' | 'health'

/** 顶部栏右侧的动作按钮 */
export interface HeaderAction {
  /** 唯一键。布局点击后按这个键回调页面注册的处理函数 */
  key: string
  label: string
  icon?: IconName
  /** 主色强调（如待办多选态的「全选」） */
  primary?: boolean
  /** 胶囊底色的按钮（如统计页「导出」）；不传则是纯文字按钮 */
  chip?: boolean
  disabled?: boolean
}

/** 页面临时接管顶部栏（目前只有待办的多选模式用得到） */
export interface HeaderOverride {
  /**
   * 只对哪个模块生效（值取路由 name，如 'Task'）。
   * ⚠️ 必须带模块名：离开模块时页面还没卸载（过渡期间），
   *    不带模块名的话下一个模块会先闪一下「已选 3 项」。
   */
  module: string
  title?: string
  actions?: HeaderAction[]
  /** 隐藏二级 tab 栏（与改造前 `v-if="!selecting"` 的行为一致） */
  hideTabs?: boolean
}

export const useUiStore = defineStore('ui', () => {
  // ==================== 记录模块的二级 tab ====================
  // 跨模块切换后保留上次选择（原实现每次进记录页都重置回「习惯」）
  const recordTab = ref<RecordTab>('habit')

  function setRecordTab(v: RecordTab): void {
    recordTab.value = v
  }

  // ==================== 首页头部文案 ====================
  // 问候语与日期优先用 /home 接口返回值（后端带 ☀️🌤️ 等 emoji），
  // 接口没回来前布局用本地时间兜底 —— 避免切回首页时头部先空一秒。
  const homeGreeting = ref('')
  const homeDate = ref('')

  function setHomeHeader(greeting: string, date: string): void {
    homeGreeting.value = greeting
    homeDate.value = date
  }

  // ==================== 页面临时接管头部 ====================
  const headerOverride = ref<HeaderOverride | null>(null)

  function setHeaderOverride(o: HeaderOverride | null): void {
    headerOverride.value = o
  }

  // ==================== header 动作处理函数 ====================
  /**
   * 页面注册、布局调用。用普通 Map 而不是 ref —— 函数不需要响应式，
   * 放进响应式容器反而会被 Proxy 包一层（每次读都拿到新引用，watch 会空转）。
   */
  const actionHandlers = new Map<string, () => void>()

  function registerAction(key: string, fn: () => void): void {
    actionHandlers.set(key, fn)
  }

  function unregisterAction(key: string): void {
    actionHandlers.delete(key)
  }

  function runAction(key: string): void {
    actionHandlers.get(key)?.()
  }

  return {
    recordTab,
    setRecordTab,
    homeGreeting,
    homeDate,
    setHomeHeader,
    headerOverride,
    setHeaderOverride,
    registerAction,
    unregisterAction,
    runAction,
  }
})
