/**
 * 当前模块的「外壳」配置（顶部栏 + 模块内二级 tab 栏）
 *
 * 由 HomeLayout 调用一次，页面**不再**自己渲染 header / tab 栏。
 *
 * 为什么这么拆：
 *   1）切模块时头部不再重建 —— 路由一变，标题/副标题/选项卡立刻换新，
 *      页面只做内容区的淡入淡出（原来整套头部跟着页面一起销毁重建，
 *      肉眼就是「先白一下再出来」）。
 *   2）三个模块的二级 tab 栏只有一份实现（components/SubTabBar.vue），
 *      现在连「谁来喂数据」也只有一份，不会再出现各页各写各的。
 *
 * 数据源分工（刻意不做二次存储，避免两份状态漂移）：
 *   - 待办筛选   → taskStore.filter      （业务状态，接口查询要用）
 *   - 统计区间   → statsStore.range      （业务状态，接口查询要用）
 *   - 记录 tab   → uiStore.recordTab     （纯 UI 状态）
 *   - 首页文案   → uiStore.homeGreeting / homeDate（/home 接口回填）
 *
 * 用法（HomeLayout）：
 *   const { header, tabs, activeTab, onTabChange, onAction } = usePageChrome()
 */
import { computed, onUnmounted } from 'vue'
import { useRoute } from 'vue-router'
import { useUiStore, type HeaderAction, type RecordTab } from '@/stores/ui'
import { useUserStore } from '@/stores/user'
import { useTaskStore } from '@/stores/task'
import { useStatsStore, STAT_SECTIONS } from '@/stores/stats'
import { formatDateFullWeekday, formatMonthDayWeekday, greetingByHour, todayDate } from '@/utils/date'
import type { StatsSection, TaskFilter } from '@/api/types'

/** 归属于 HomeLayout 的五个一级模块（键 = 路由 name） */
export type TabModuleKey = 'Home' | 'Task' | 'Record' | 'Stat' | 'Me'

/** 二级 tab 定义（与 components/SubTabBar.vue 的 props 对齐） */
export interface SubTabDef {
  value: string
  label: string
}

/** 顶部栏渲染配置（与 components/PageHeader.vue 的 props 对齐） */
export interface PageHeaderConfig {
  title: string
  subtitle?: string
  /** 右侧次要文字（记录页的日期） */
  trailingText?: string
  /** hero = 首页那条渐变色带（带圆形头像） */
  variant: 'default' | 'hero'
  avatarText?: string
  actions: HeaderAction[]
}

// ==================== 各模块的二级 tab ====================
// 改造前这三份数组分别写在三个页面里（待办的 TABS、记录的 MAIN_TABS、
// 统计的 STATS_RANGES），现在集中在这里，布局与页面读同一份。

export const TASK_TABS: ReadonlyArray<{ value: TaskFilter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'today', label: '今日' },
  { value: 'upcoming', label: '即将' },
  { value: 'done', label: '已完成' },
  { value: 'overdue', label: '逾期' },
]

/**
 * 记录模块的二级 tab（5 个）。
 *
 * 三轮演进（2026-09-19）：
 *   1. 「资产」与「账户」都渲染 AccountManager，内容完全一致 —— 删「资产」
 *      留「账户」，位置顺位不变。
 *   2. 「支出」Tab 的列表本就混合显示支出+收入（TransactionList expense 模式
 *      + 类型筛选），「收入」Tab 是纯子集 —— 合并为单一「收支」
 *      （D-03 第十六轮，桌面端同步）。
 *   3. 新增第 5 个维度「经期」（值 'period'）—— **固定排在末尾**，
 *      不动既有 4 项的索引（胶囊指示块的位移按索引计算，插中间会牵动全部）。
 *
 * ⚠️ 本数组与 stores/ui.ts 的 `RecordTab` 类型是唯一真源，两处必须同改。
 *
 * ⚠️ 260919 v1 重构：5 → 3。
 *   - 「收支 / 预算 / 账户」合并为单一「财务」Tab（值 'finance'），页内用分段控件切换；
 *   - 「经期」并入「健康」Tab（值 'health'）—— 健康是「测出来的数」的家，
 *     经期事实只是其中一块，不该单独占一个二级 tab。
 *   - ⚠️ 二级 tab 物理上限 6 个（超了会横滚 + 左右滑切 tab 失效），
 *     所以新维度只能往页内塞，不能再加 tab。
 */
export const RECORD_TABS: ReadonlyArray<{ value: RecordTab; label: string }> = [
  { value: 'habit', label: '习惯' },
  { value: 'finance', label: '财务' },
  { value: 'health', label: '健康' },
]

/**
 * 统计模块的二级 tab：**领域**（spec 05 §2）
 *
 * ⚠️ 改造前这里装的是**区间**（7/30/90 天）。区间是「参数」不是「视图」——
 *    SubTabBar 的语义是「同一实体的不同视图」，而不同领域需要的时间跨度根本不同
 *    （体重 7 天只是噪声、财务 30 天才对得上月度预算心智）。
 *    区间已降为页内 chips（见 pages/stat/index.vue）。
 *
 * ⚠️ 改这里必须同时改三处，缺一不可（spec 05 §4）：
 *     1. 本数组（STAT_TABS）
 *     2. 下面 activeTab 的 Stat 分支 → statsStore.section
 *     3. 下面 onTabChange 的 Stat 分支 → statsStore.setSection
 *    两套值域（区间 vs 领域）不重叠，只改一处会表现为「点了没反应」。
 *
 * 区间选项仍在 STATS_RANGES（stores/stats.ts），现在只喂页内 chips。
 */
export const STAT_TABS: ReadonlyArray<{ value: StatsSection; label: string }> = STAT_SECTIONS

// ==================== 各模块的顶部栏静态部分 ====================
const MODULE_TITLES: Record<TabModuleKey, string> = {
  Home: '首页',
  Task: '待办',
  Record: '记录',
  Stat: '统计',
  Me: '我的',
}

/** 统计页副标题（原写在 stat 页 header 里） */
const STAT_SUBTITLE = '按周期复盘趋势'

export function usePageChrome() {
  const route = useRoute()
  const ui = useUiStore()
  const userStore = useUserStore()
  const taskStore = useTaskStore()
  const statsStore = useStatsStore()

  /** 当前一级模块；二级页（任务详情等）为 null → 布局不渲染外壳，页面自带返回栏 */
  const module = computed<TabModuleKey | null>(() => {
    const name = route.name
    return name && name in MODULE_TITLES ? (name as TabModuleKey) : null
  })

  /** 页面临时接管的头部（只认自己模块的那份，避免过渡期串台） */
  const override = computed(() =>
    module.value && ui.headerOverride?.module === module.value ? ui.headerOverride : null
  )

  // ==================== 二级 tab ====================
  const tabs = computed<ReadonlyArray<SubTabDef>>(() => {
    if (override.value?.hideTabs) return []
    switch (module.value) {
      case 'Task':
        return TASK_TABS
      case 'Record':
        return RECORD_TABS
      case 'Stat':
        return STAT_TABS
      default:
        return []
    }
  })

  const activeTab = computed<string>(() => {
    switch (module.value) {
      case 'Task':
        return taskStore.filter
      case 'Record':
        return ui.recordTab
      case 'Stat':
        return statsStore.section
      default:
        return ''
    }
  })

  function onTabChange(value: string): void {
    switch (module.value) {
      case 'Task':
        void taskStore.setFilter(value as TaskFilter)
        break
      case 'Record':
        // 记录页 watch 这个值做副作用（刷新习惯区 / 补拉账户、预算）
        ui.setRecordTab(value as RecordTab)
        break
      case 'Stat':
        // ⚠️ 必须走 setSection：它内部会把区间重置为该领域默认值。
        //    这里若误调 setRange（值域不重叠）会被 store 忽略 → 点了没反应。
        void statsStore.setSection(value as StatsSection)
        break
      default:
        break
    }
  }

  // ==================== 顶部栏 ====================
  const actions = computed<HeaderAction[]>(() => {
    if (override.value?.actions) return override.value.actions
    if (module.value === 'Stat') {
      // 导出：处理函数由 stat 页注册（见 useHeaderAction），这里只管外观与禁用态
      return [{ key: 'stat:export', label: '导出', icon: 'FileText', chip: true, disabled: statsStore.exporting }]
    }
    return []
  })

  const header = computed<PageHeaderConfig | null>(() => {
    const m = module.value
    if (!m) return null

    // 首页：渐变色带 + 头像 + 问候语；问候语优先用 /home 接口回填的值
    if (m === 'Home') {
      const name = userStore.user?.name || userStore.user?.username || '同学'
      const greeting = ui.homeGreeting || greetingByHour()
      return {
        variant: 'hero',
        title: override.value?.title ?? `${greeting}，${name}`,
        subtitle: ui.homeDate || formatMonthDayWeekday(todayDate()),
        avatarText: name.charAt(0).toUpperCase(),
        actions: actions.value,
      }
    }

    if (m === 'Record') {
      return {
        variant: 'default',
        title: override.value?.title ?? MODULE_TITLES.Record,
        trailingText: formatDateFullWeekday(todayDate()),
        actions: actions.value,
      }
    }

    if (m === 'Stat') {
      return {
        variant: 'default',
        title: override.value?.title ?? MODULE_TITLES.Stat,
        subtitle: STAT_SUBTITLE,
        actions: actions.value,
      }
    }

    return {
      variant: 'default',
      title: override.value?.title ?? MODULE_TITLES[m],
      actions: actions.value,
    }
  })

  /** 头部右侧动作 → 页面注册的处理函数 */
  function onAction(key: string): void {
    ui.runAction(key)
  }

  return { module, header, tabs, activeTab, onTabChange, onAction }
}

/**
 * 页面注册「顶部栏右侧动作」的处理函数（布局负责渲染与点击）。
 *
 * 组件卸载时自动注销：否则切走模块后布局仍握着一个已卸载页面的闭包，
 * 再次点同一个按钮就会调到旧实例上（拿到的还是旧数据）。
 *
 * 用法（统计页）：
 *   useHeaderAction('stat:export', openExport)
 */
export function useHeaderAction(key: string, fn: () => void): void {
  const ui = useUiStore()
  ui.registerAction(key, fn)
  onUnmounted(() => ui.unregisterAction(key))
}
