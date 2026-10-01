<script setup lang="ts">
/**
 * 记录页（移动端 · Phase 3 完整移植）
 *
 * SYNC-FROM-DESKTOP: life-assisitant-ui-desktop/src/pages/record/index.tsx
 *                    习惯区/财务区结构、5 个财务 Tab 的划分与业务流转
 * 最后同步：2026-09-18（Phase 3.1 ~ 3.6）
 *
 * 桌面端结构是「MoodSection + HabitSection 常驻 → 下方 Card 内 5 个 Tab
 * （支出/收入/资产/预算/账户）」。移动端在 375px 宽下无法把习惯区和财务区
 * 纵向堆在一屏里，故把桌面端的「习惯区」提升为并列 Tab。
 * （MoodSection 已从记录模块移除，见下方第 5 条。）
 *
 * 现为 **3 个并列 Tab**（md/spec-20260919-v1 · 2026-09-19 第四轮重构）：
 *
 *     习惯 | 财务 | 健康
 *
 *   习惯 → HabitSection（四 KPI/里程碑/连续徽章 + 热力图）
 *   财务 → FinancialSection（页内分段：收支 / 预算 / 账户）
 *   健康 → HealthSection（概览卡 + 月历 + 快捷条）+ MoodSection（按小时的心情时间线，跟在后面）
 *         └ 心情 / 精力归健康（02 §2 注册表第 3 / 4 项），浮层第 3 / 4 页也是它们。
 *           今日心情的快捷入口在首页（01 §4「首页 ├ 心情/精力」），三处写同一张 mood_logs。
 *
 * ⚠️ 演进（2026-09-19，五次改动）：
 *    1. 「资产」Tab 已删 —— 和「账户」渲染同一个 AccountManager，纯重复。
 *    2. 「收入」Tab 已并入「收支」—— 原「支出」Tab 的列表本就含收入
 *      （排除转账 + 类型筛选可选 全部/支出/收入），「收入」是纯子集视图。
 *      记收入走 FAB「记一笔」抽屉内的类型切换（TransactionEditSheet 三态）。
 *    3. 「经期」Tab 是新增的第 5 个维度（md/spec-260919），排在末尾。
 *    4. **v1 重构：5 → 3**。「收支 / 预算 / 账户」压成单一「财务」Tab（页内分段控件）；
 *      「经期」并入新的「健康」Tab —— 健康是「测出来的数」的家，经期事实只是其中一块。
 *      ⚠️ 二级 tab 有**物理上限 6 个**（超了会横滚 + 左右滑切 tab 失效），
 *        所以新维度只能往页内塞，不能再加 tab。
 *    5. **MoodSection 从「习惯」Tab 挪进「健康」Tab**（老大 260919 复核 spec 时指出）。
 *      spec 01 §4 的记录模块只有 习惯 / 财务 / 健康，心情与精力是**健康**的指标
 *      （02 §2 注册表第 3 / 4 项，浮层第 3 / 4 页）。
 *      ⚠️ 没删而是搬家：MoodSection 是**唯一能看到按小时心情历史**的入口
 *      （首页只有 chips），删了等于把昨天做的按小时记录能力埋掉。
 *      现在三个入口写同一张 mood_logs：首页 chips（此刻）/ 健康时间线（任意小时）/
 *      健康浮层第 3 页（一天槽位），互为补充而不是重复。
 *
 * ⚠️ 后端在这轮**零改动**：`/accounts` `/transactions` `/budgets` 三组接口保持原样，
 *    财务三合一是纯前端的信息架构调整（07 §3 明确要求不要动后端路由）。
 *
 * 加载策略：习惯区常驻（v-show，保留热力图月份等本地状态）；
 *   其余 Tab 用 v-if 惰性挂载，切 Tab 时不互抢列表状态。
 */
// ⚠️ 显式组件名（spec-20260924-v2 S1）：供 HomeLayout 的 `<KeepAlive :include>` 匹配。
defineOptions({ name: 'Record' })
import { computed, onActivated, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { showConfirmDialog } from 'vant'
import { useHabitStore } from '@/stores/habit'
import { useFinanceStore } from '@/stores/finance'
import { useUiStore, type RecordTab } from '@/stores/ui'
import { RECORD_TABS } from '@/composables/usePageChrome'
import HabitSection from '@/components/HabitSection.vue'
import FinancialSection, { type FinanceSub } from '@/components/FinancialSection.vue'
import HealthSection from '@/components/health/HealthSection.vue'
import HabitEditSheet from '@/components/HabitEditSheet.vue'
import TransactionEditSheet from '@/components/TransactionEditSheet.vue'
import type {
  CreateHabitReq,
  CreateTransactionReq,
  Habit,
  Transaction,
  TransactionType,
  TransferReq,
  UpdateTransactionReq,
} from '@/api/types'

const habitStore = useHabitStore()
const financeStore = useFinanceStore()
const route = useRoute()
const router = useRouter()

/**
 * 覆盖层子路由（`meta.overlay`，目前只有 /record/finance-categories）是否打开。
 *
 * 打开时本页**不卸载**，只在上面叠一层全屏页 —— 记一笔浮层里的草稿、
 * 分类选择器的展开状态、页面滚动位置都原样保留，返回即回到记一笔。
 * 覆盖层的内容由模板末尾的 `<router-view />` 渲染。
 */
const overlayOpen = computed(() => route.meta.overlay === true)

// ==================== 顶层 Tab ====================
// 选中值放在 uiStore（布局层的 SubTabBar 读写它，本页 watch 当前 tab 做副作用）：
// 顶部栏与选项卡栏已提到 HomeLayout 常驻渲染，页面不再自己持有 tab 状态。
// 取值定义与顺序见 composables/usePageChrome.ts 的 RECORD_TABS。
const ui = useUiStore()
/**
 * 当前二级 Tab。
 *
 * 取值合法集合以 usePageChrome.RECORD_TABS 为唯一真源，这里做一次校验兜底：
 * 开发期热更新时 store 里的旧值可能残留（如已删除的 'asset' / 'income'，
 * 以及更名前的 'expense'），那种值不会命中模板里任何一个 v-if → 内容区
 * 一片空白，看起来像改坏了。校验后回落到「习惯」，与删除前的越界行为一致。
 */
const activeTab = computed<RecordTab>(() =>
  RECORD_TABS.some((t) => t.value === ui.recordTab) ? ui.recordTab : 'habit'
)

// ==================== 子组件引用（FAB 需要调它们的「新建」）====================
const habitSectionRef = ref<InstanceType<typeof HabitSection> | null>(null)
/**
 * 财务区的实例引用：FAB 需要调它的「新建」。
 * ⚠️ ref 必须绑在**保留下来的那个实例**上 —— 之前删「资产」Tab 时 ref 还挂在
 *    已删的实例上，结果 FAB 点了没反应（D-03 第十六轮踩过）。
 */
const financialRef = ref<InstanceType<typeof FinancialSection> | null>(null)
/** 健康区的实例引用：FAB 需要调它的「记录今天」 */
const healthRef = ref<InstanceType<typeof HealthSection> | null>(null)
/**
 * 财务区当前子视图（由 FinancialSection 通过 sub-change 回传）。
 * 只用于 FAB 的文案与分发，真正的状态在子组件里 —— 父级不重复持有。
 */
const financeSub = ref<FinanceSub>('transactions')

// ==================== 习惯编辑弹层 ====================
const habitSheetShow = ref(false)
const editingHabit = ref<Habit | null>(null)

function openCreateHabit(): void {
  editingHabit.value = null
  habitSheetShow.value = true
}

function onHabitEditIntent(h: Habit): void {
  editingHabit.value = h
  habitSheetShow.value = true
}

async function onHabitSave(payload: CreateHabitReq): Promise<boolean> {
  if (editingHabit.value) {
    const r = await habitStore.updateHabit(editingHabit.value.id, payload)
    return r !== null
  }
  const r = await habitStore.createHabit(payload)
  return r !== null
}

async function onHabitDelete(h: Habit): Promise<void> {
  try {
    await showConfirmDialog({
      title: '删除习惯',
      message: `确定删除「${h.title}」吗？此操作可在 30 天内恢复。`,
      confirmButtonText: '删除',
      confirmButtonColor: 'var(--color-danger)',
    })
    await habitStore.deleteHabit(h.id)
  } catch {
    /* 取消 */
  }
}

// ==================== 交易编辑弹层 ====================
const txSheetShow = ref(false)
const editingTx = ref<Transaction | null>(null)
const txDefaultType = ref<TransactionType>('expense')
/** 日历「长按补录」预填的日期（空 = 今天） */
const txPresetDate = ref('')

function openCreateTx(type: TransactionType = 'expense', date = ''): void {
  editingTx.value = null
  txDefaultType.value = type
  txPresetDate.value = date
  txSheetShow.value = true
}

function onTxEditIntent(t: Transaction): void {
  editingTx.value = t
  txSheetShow.value = true
}

/** 流水行 / 日历明细行点击 → 账目详情页（v2 批次二） */
function onTxViewIntent(t: Transaction): void {
  void router.push(`/record/tx/${t.id}`)
}

/** 新建 / 编辑 / 转账 三合一提交（与 TransactionEditSheet 的 mode 参数对齐） */
async function onTxSave(
  payload: CreateTransactionReq | TransferReq | UpdateTransactionReq,
  type: TransactionType,
  mode: 'create' | 'update'
): Promise<boolean> {
  if (mode === 'update') {
    const target = editingTx.value
    if (!target) return false
    const r = await financeStore.updateTransaction(target.id, payload as UpdateTransactionReq)
    return r !== null
  }
  if (type === 'transfer') {
    const r = await financeStore.transfer(payload as TransferReq)
    return r !== null
  }
  const r = await financeStore.createTransaction(payload as CreateTransactionReq)
  return r !== null
}

// ==================== FAB ====================
const fabLabel = computed(() => {
  switch (activeTab.value) {
    case 'habit':
      return '新建习惯'
    case 'finance':
      // 财务区的 FAB 跟着子视图走：收支 = 记一笔，预算/账户 = 新建实体
      switch (financeSub.value) {
        case 'budget':
          return '新建总预算'
        case 'account':
          return '新建账户'
        default:
          return '记一笔'
      }
    default:
      // 健康：打开当天的记录浮层（经期事实 + 身体指标 + 心情，一张表单）
      return '记录今天'
  }
})

function onFabClick(): void {
  switch (activeTab.value) {
    case 'habit':
      openCreateHabit()
      break
    case 'finance':
      // 收支 / 日历都走本页统一持有的 TransactionEditSheet（三态：支出/收入/转账）；
      // 预算 / 账户的新建抽屉在各自组件里，由 FinancialSection 分发。
      if (financeSub.value === 'transactions' || financeSub.value === 'calendar') {
        openCreateTx('expense')
      } else {
        financialRef.value?.openCreate()
      }
      break
    default:
      healthRef.value?.openToday()
      break
  }
}

// ==================== 生命周期 ====================
// 2026-09-24（spec-20260924-v2 S1）：本页被 `<KeepAlive>` 缓存。
// ⚠️ 首拉逻辑放 onActivated（不放 onMounted）—— 首次挂载也会触发 onActivated，
//    放两处会重复执行。下面两个拉取都带「空才拉」幂等守卫，回归时天然不会重复请求。
onActivated(async () => {
  // 习惯区在首次进入时会自行拉取（HabitSection onMounted）；
  // 这里只预热账户与预算，让用户在切换到对应 Tab 前就有数据。
  await Promise.all([
    financeStore.accounts.length === 0 ? financeStore.fetchAccounts() : Promise.resolve(),
    financeStore.budgets.length === 0 ? financeStore.fetchBudgets() : Promise.resolve(),
  ])
})

/**
 * 切换 Tab 时的按需加载（避免一次性把所有 Tab 的接口都打出去）
 *
 * 现在是「监听当前 tab」而不是「响应点击事件」——
 * 选项卡栏在 HomeLayout 里，点击后只写 store，本页负责接住变化做副作用。
 * 监听 activeTab（而非 store 原值）：取值被兜底纠正时，副作用也跟着走到正确分支。
 */
watch(
  activeTab,
  async (t) => {
    if (t === 'habit') {
      await habitSectionRef.value?.refresh()
      return
    }
    if (t === 'finance') {
      // 财务区内部自己按需加载：进「财务」就先预热账户与预算，
      // 收支列表由 TransactionList 自己拉（它带筛选与分页状态）。
      await Promise.all([
        financeStore.accounts.length === 0 ? financeStore.fetchAccounts() : Promise.resolve(),
        financeStore.budgets.length === 0 ? financeStore.fetchBudgets() : Promise.resolve(),
      ])
      return
    }
    if (t === 'health') {
      // 健康区自己管加载（HealthSection 内部只在「还没加载过」时打接口）。
      // 这里不代劳：健康的数据源是三张表拼的，预热错了反而多打一轮。
      return
    }
  }
)
</script>

<template>
  <div class="record-page">
    <!-- 顶部栏（记录 + 日期）与三个选项卡都已提到 HomeLayout 常驻渲染，
         见 layouts/HomeLayout.vue + composables/usePageChrome.ts。 -->

    <!-- ==================== 习惯区 ====================
         ⚠️ 心情 / 精力**已挪到「健康」Tab**（spec 01 §4 + 02 §2 注册表第 3 / 4 项）。
         首页保留快捷 chips（01 §4「首页 ├ 心情/精力」），按小时时间线在健康 Tab 顶部。 -->
    <main v-show="activeTab === 'habit'" class="tab-body">
      <HabitSection
        ref="habitSectionRef"
        @create="openCreateHabit"
        @edit="onHabitEditIntent"
        @delete="onHabitDelete"
      />
    </main>

    <!-- ==================== 财务（收支 / 预算 / 账户 三合一分段）==================== -->
    <main v-if="activeTab === 'finance'" class="tab-body">
      <FinancialSection
        ref="financialRef"
        @sub-change="financeSub = $event"
        @edit-transaction="onTxEditIntent"
        @view-transaction="onTxViewIntent"
        @create-transaction-at="(d) => openCreateTx('expense', d)"
      />
    </main>

    <!-- ==================== 健康（md/spec-20260919-v1：经期并入，身体指标的家）====================
         ⚠️ 心情 / 精力归**健康**（spec 01 §4 + 02 §2 注册表第 3 / 4 项），不在「习惯」Tab：
           · MoodSection = 按小时的心情时间线（首页只有 chips，看不到历史小时）
           · HealthSection 的记录浮层第 3 页 = 健康口径的一天一条心情（落在 mood_logs 的
             now_hour / hour=12 槽位），两者写的是同一张表，互为补充。
         ⚠️ 区块顺序由 HealthSection 内部集中编排（02 §3 三次修订）：
           ① 今日健康分类卡 → ② 今日心情（MoodSection 已内嵌）→ ③ 今日时间轴 → ④ 月历。
           此处只挂一个 HealthSection，MoodSection 不再作为并列子组件出现。 -->
    <main v-if="activeTab === 'health'" class="tab-body">
      <HealthSection ref="healthRef" />
    </main>

    <!-- ==================== FAB ==================== -->
    <button class="fab" type="button" :aria-label="fabLabel" @click="onFabClick">
      <span class="fab-plus" aria-hidden="true">+</span>
    </button>

    <!-- ==================== Sheets ==================== -->
    <HabitEditSheet
      v-model:show="habitSheetShow"
      :habit="editingHabit"
      :on-save="onHabitSave"
    />

    <TransactionEditSheet
      v-model:show="txSheetShow"
      :accounts="financeStore.accounts"
      :transaction="editingTx"
      :default-type="txDefaultType"
      :default-date="txPresetDate"
      :on-save="onTxSave"
    />

    <!-- ==================== 覆盖层子路由 ====================
         「记一笔 → 管理 ›」进的是 /record/finance-categories（本页的子路由，
         见 router/index.ts），在这里**叠一层全屏页**，而不是离开本模块。

         为什么不直接用顶层路由 /me/finance-categories（原来的写法）：
         HomeLayout 与记录页会被整体卸载 → 记一笔的草稿、浮层开合状态全丢，
         返回时页面重新挂载（用户看到「回到财务了」＋「选中动画又播一遍」）。
         现在宿主页保持挂载，返回只是把这一层弹掉，记一笔原样还在。

         两个技术点：
         1. 用 `van-popup` 而不是自绘 `position:fixed` 层 —— Vant 的全局
            z-index 计数器会给它分配一个「比已打开的浮层高」的值，
            之后从管理页里打开的编辑浮层 / 图标选择器 / 长按菜单又会比它更高。
            自绘固定 z-index 的话，要么盖不住记一笔，要么把管理页自己的浮层盖住。
         2. `teleport="body"` 必留（漏了会被 .content 的合成层压住，见文件头铁律）；
            也因此这一层不接收 `.content` 上的左右滑手势，不会误切模块内 tab。
         3. `position="top"` + 显式高度 `--app-height`：几何与 #app 完全重合。
            用 `position="center"` 会按视口居中，浏览器模式下地址栏一收一放
            整层就上下错位；高度也不写 100vh/100dvh（standalone 下 WebKit
            少算动态视口高度，见 reset.scss 的高度链注释）。
         4. `:duration="0"`：进出都用瞬时切换，与其它二级页的 push 观感一致，
            也避免关闭时「内容已经被路由换掉、空壳再淡出」的白闪。 -->
    <van-popup
      :show="overlayOpen"
      position="top"
      :style="{ height: 'var(--app-height)' }"
      :overlay="false"
      :lock-scroll="false"
      :duration="0"
      teleport="body"
    >
      <router-view />
    </van-popup>
  </div>
</template>

<style lang="scss" scoped>
.record-page {
  /* ⚠️ 不写 height：高度由 HomeLayout 的 .content 用 flex 直接分配
     （见 HomeLayout .content 注释）。写 height:100% 会与布局层的定位
     方案争抢同一组属性（特异性相同、由 CSS 注入顺序裁决），且依赖
     iOS 上不可靠的百分比解析 → 页面被内容撑高 → .tab-body 空转、
     滚动传到根。 */
  background: var(--color-bg-app);
  display: flex;
  flex-direction: column;
  /* 定位容器：悬浮按钮锚定到这里，本元素不滚动（滚动在 .tab-body 里） */
  position: relative;
}

/* ==================== Header / Tab Bar ====================
   顶部栏与三个选项卡都不在本页渲染：
     header    → HomeLayout 的 components/PageHeader.vue（记录 + 日期）
     选项卡栏  → HomeLayout 的 components/SubTabBar.vue
   本页只保留内容区与锚定在 .record-page 上的悬浮按钮。 */

/* ==================== 内容区 ==================== */
.tab-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  /* 滚到两端不把滚动链传给父级，避免 iOS 上整个视口跟着弹动 */
  overscroll-behavior-y: contain;
  /* 底部留白走令牌，与其它页一致（底距 + 胶囊高 + 呼吸位） */
  padding: var(--space-4) var(--space-5) var(--tabbar-reserve, 83px);
}

/* ==================== FAB ==================== */
.fab {
  /* absolute（不是 fixed）：锚定到 .record-page，系统不做安全区内缩，
     四种环境落点一致。 */
  position: absolute;
  right: 20px;
  /* 抬高一个 --tabbar-reserve，按钮始终悬在胶囊正上方。 */
  bottom: var(--tabbar-reserve, 83px);
  width: 56px;
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-primary);
  color: #FFFFFF;
  border: 0;
  border-radius: 50%;
  box-shadow: var(--shadow-lg);
  cursor: pointer;
  z-index: var(--z-fixed);
  -webkit-tap-highlight-color: transparent;
  &:active { transform: scale(0.92); background: var(--color-primary-dark); }
}
.fab-plus {
  font-size: 32px;
  font-weight: 300;
  line-height: 1;
  margin-top: -2px;
}
</style>
