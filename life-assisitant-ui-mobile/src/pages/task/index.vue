<script setup lang="ts">
/**
 * 任务页（移动端 · Phase 2.3 + 2.4）
 *
 * SYNC-FROM-DESKTOP: life-assisitant-ui-desktop/src/pages/task/index.tsx
 * SYNC-FROM-BACKEND: life-assisitant-api/internal/model/dto/task.go（ListTasksReq）
 * 最后同步：2026-09-18
 *
 * Phase 2 改动：
 *   2.3 补「逾期」tab → 5 个筛选；新增优先级筛选 / 关键词搜索（350ms 防抖）/ 排序下拉；
 *       无限滚动接 `van-list @load`（Phase 0 的 B5 修复在此收口）
 *   2.4 长按进入多选模式 + 批量完成 / 批量删除（`POST /tasks/batch`）
 *
 * 交互映射（桌面端 → 移动端）：
 *   点标题进详情   → 点卡片进 `/task/:id`
 *   行内编辑按钮   → 左滑「编辑」
 *   行内删除按钮   → 左滑「删除」
 *   表头全选       → 多选模式顶部「全选」
 *
 * Phase 0 修复记录（保留）：
 *   B1 优先级改走 utils/task-dict（原 P0~P3 与 TaskPriority 不匹配）
 *   B4 删除交互由 `@contextmenu` 长按改为 `van-swipe-cell` 左滑
 *   B5 接上 `van-list` 的 @load，实现真正的上拉加载
 */
import { computed, onMounted, ref, watchEffect } from 'vue'
import { useRouter } from 'vue-router'
import { showConfirmDialog, showToast } from 'vant'
import { storeToRefs } from 'pinia'
import { useTaskStore, type TaskSortOption } from '@/stores/task'
import { useUiStore } from '@/stores/ui'
import type { CreateTaskReq, Task, TaskPriority } from '@/api/types'
import { TASK_PRIORITIES } from '@/utils/task-dict'
import { useHeaderAction } from '@/composables/usePageChrome'
import TaskCard from '@/components/TaskCard.vue'
import TaskEditSheet from '@/components/TaskEditSheet.vue'
import Icon from '@/components/icon/Icon.vue'

const router = useRouter()

// ==================== Store ====================
const taskStore = useTaskStore()
const {
  tasks,
  isEmpty,
  finished,
  priority,
  keyword,
  sort,
  selectedIds,
  selecting,
  allSelected,
  hasFilter,
  stats,
} = storeToRefs(taskStore)

// 筛选 tab 的定义与动作都在 composables/usePageChrome.ts 里
// （布局层渲染 SubTabBar，直接读写 taskStore.filter）

// ==================== 4 KPI ====================
const kpiCells = computed(() => {
  const s = stats.value
  return [
    { key: 'today',    label: '今日',   value: s.today },
    { key: 'upcoming', label: '即将',   value: s.upcoming },
    { key: 'done',     label: '已完成', value: s.done },
    { key: 'overdue',  label: '逾期',   value: s.overdue },
  ]
})

// ==================== 优先级 / 排序下拉 ====================
/** 优先级选项：全部 + 紧急→宽松（与桌面端 `[...TASK_PRIORITIES].reverse()` 顺序一致） */
const priorityOptions = computed(() => [
  { text: '全部优先级', value: '' },
  ...[...TASK_PRIORITIES].reverse().map((p) => ({ text: p.label, value: p.value as string })),
])

const sortOptions: Array<{ text: string; value: string }> = [
  { text: '默认排序', value: '' },
  { text: '按截止时间', value: 'due_time' },
  { text: '按优先级', value: 'priority' },
  { text: '按创建时间', value: 'created_at' },
]

/** 下拉绑定值（van-dropdown-item 的 v-model 需可写） */
const priorityValue = ref<string>(priority.value)
const sortValue = ref<string>(sort.value)

async function onPriorityChange(v: string | number): Promise<void> {
  await taskStore.setPriority(v as TaskPriority | '')
}
async function onSortChange(v: string | number): Promise<void> {
  await taskStore.setSort(v as TaskSortOption)
}

// ==================== 搜索（350ms 防抖，与桌面端一致） ====================
const searchInput = ref(keyword.value)
let searchTimer: ReturnType<typeof setTimeout> | null = null

function onSearchInput(v: string): void {
  searchInput.value = v
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    taskStore.setKeyword(v)
  }, 350)
}

function clearSearch(): void {
  searchInput.value = ''
  if (searchTimer) clearTimeout(searchTimer)
  taskStore.setKeyword('')
}

// ==================== van-list 分页 ====================
/**
 * van-list 自己置 true，我们在数据就绪后置 false；
 * 置 false 会触发 van-list 重新 check，内容不满一屏时会继续加载下一页。
 */
const listLoading = ref(false)

async function onLoad() {
  try {
    if (!taskStore.loadedOnce) {
      await taskStore.fetchTasks()
    } else {
      await taskStore.loadMore()
    }
  } finally {
    listLoading.value = false
  }
}

// ==================== 多选（Phase 2.4） ====================
let selectToastShown = false

const ui = useUiStore()

/**
 * 多选模式接管顶部栏。
 *
 * 改造前这是写在页面模板里的 header（`已选 N 项` + 取消 / 全选），顶部栏提到
 * HomeLayout 之后，页面只能通过 uiStore 的 headerOverride 把「临时头部」推上去。
 * override 带 module: 'Task' —— 离开模块时页面还没卸载，不带模块名的话
 * 下一个模块的头部会先闪一下「已选 3 项」。
 */
watchEffect(() => {
  if (!selecting.value) {
    ui.setHeaderOverride(null)
    return
  }
  ui.setHeaderOverride({
    module: 'Task',
    title: `已选 ${selectedIds.value.length} 项`,
    hideTabs: true,  // 与改造前 `v-if="!selecting"` 的显隐一致
    actions: [
      { key: 'task:cancel', label: '取消' },
      { key: 'task:selectAll', label: allSelected.value ? '取消全选' : '全选', primary: true },
    ],
  })
})

// 顶部栏按钮 → 本页处理函数（布局负责渲染与点击）
useHeaderAction('task:cancel', () => exitSelect())
useHeaderAction('task:selectAll', () => taskStore.toggleSelectAll())

function onLongPress(task: Task) {
  if (!selectToastShown && !taskStore.selecting) {
    showToast('已进入多选模式')
    selectToastShown = true
  }
  taskStore.enterSelect(task.id)
}

/** 点卡片：多选模式 = 勾选；否则进详情 */
function onOpen(task: Task) {
  if (taskStore.selecting) {
    taskStore.toggleSelect(task.id)
    return
  }
  router.push(`/task/${task.id}`)
}

/** 点复选框：多选模式 = 勾选；否则切换完成 */
async function onToggleComplete(task: Task, ev: Event) {
  ev.stopPropagation()
  if (taskStore.selecting) {
    taskStore.toggleSelect(task.id)
    return
  }
  const nextStatus = task.status === 'done' ? 'todo' : 'done'
  await taskStore.toggleComplete(task.id, nextStatus)
}

async function onBatchComplete(): Promise<void> {
  const ids = [...selectedIds.value]
  if (ids.length === 0) return
  await taskStore.batchAction({ action: 'complete', task_ids: ids })
  selectToastShown = false
}

async function onBatchDelete(): Promise<void> {
  const ids = [...selectedIds.value]
  if (ids.length === 0) return
  try {
    await showConfirmDialog({
      title: '批量删除',
      message: `确认删除选中的 ${ids.length} 个任务？删除后 30 天内可恢复。`,
      confirmButtonText: '删除',
      confirmButtonColor: 'var(--color-danger)',
    })
    await taskStore.batchAction({ action: 'delete', task_ids: ids })
    selectToastShown = false
  } catch {
    // 用户取消
  }
}

function exitSelect(): void {
  taskStore.clearSelection()
  selectToastShown = false
}

// ==================== Sheet 状态 ====================
const sheetShow = ref(false)
const editingTask = ref<Task | null>(null)
const isEdit = computed(() => !!editingTask.value)

// ==================== 新建 / 编辑 ====================
function openCreate() {
  editingTask.value = null
  sheetShow.value = true
}

function onEdit(task: Task) {
  editingTask.value = task
  sheetShow.value = true
}

async function onSave(payload: CreateTaskReq): Promise<boolean> {
  if (isEdit.value && editingTask.value) {
    const updated = await taskStore.updateTask(editingTask.value.id, payload)
    return updated !== null
  }
  const created = await taskStore.createTask(payload)
  return created !== null
}

// ==================== 左滑删除（B4）====================
async function onDelete(task: Task) {
  try {
    await showConfirmDialog({
      title: '确认删除',
      message: `确定要删除任务「${task.title}」吗？删除后 30 天内可恢复。`,
      confirmButtonText: '删除',
      confirmButtonColor: 'var(--color-danger)',
    })
    await taskStore.deleteTask(task.id)
  } catch {
    // 用户取消
  }
}

// ==================== 生命周期 ====================
onMounted(async () => {
  await taskStore.fetchTasks()
})
</script>

<template>
  <div class="task-page">
    <!-- 顶部栏（待办 / 已选 N 项）与 5 个状态筛选 tab 都已提到 HomeLayout 常驻渲染，
         见 layouts/HomeLayout.vue + composables/usePageChrome.ts：
         切模块时头部与选项卡不再重建，页面只剩内容区。 -->

    <!-- 搜索框（350ms 防抖）—— 放在选项卡下方，与记录页的顶部结构保持一致
         （header → 选项卡 → 内容），搜索不再插在 header 和选项卡之间把两者割开 -->
    <div v-if="!selecting" class="search-bar">
      <Icon name="Search" :size="16" class="search-icon" aria-hidden="true" />
      <input
        :value="searchInput"
        type="search"
        class="search-input"
        placeholder="搜索任务标题…"
        maxlength="50"
        @input="onSearchInput(($event.target as HTMLInputElement).value)"
      >
      <button
        v-if="searchInput"
        type="button"
        class="search-clear"
        aria-label="清空搜索"
        @click="clearSearch"
      >×</button>
    </div>

    <!-- 优先级 / 排序 -->
    <van-dropdown-menu
      v-if="!selecting"
      class="task-filters"
      active-color="var(--color-primary)"
    >
      <van-dropdown-item
        v-model="priorityValue"
        :options="priorityOptions"
        @change="onPriorityChange"
      />
      <van-dropdown-item
        v-model="sortValue"
        :options="sortOptions"
        @change="onSortChange"
      />
    </van-dropdown-menu>

    <!-- 4 KPI -->
    <div class="kpi-row">
      <div
        v-for="k in kpiCells"
        :key="k.key"
        class="kpi-cell"
        :class="{ 'is-alert': k.key === 'overdue' && k.value > 0 }"
      >
        <span class="kpi-value">{{ k.value }}</span>
        <span class="kpi-label">{{ k.label }}</span>
      </div>
    </div>

    <!-- 列表 -->
    <main class="task-list-wrap">
      <van-list
        v-model:loading="listLoading"
        :finished="finished"
        :finished-text="tasks.length > 0 ? '没有更多了' : ''"
        error-text="加载失败，点击重试"
        class="task-list"
        @load="onLoad"
      >
        <!-- 加载态 -->
        <div v-if="listLoading && tasks.length === 0" class="loading-skeleton">
          <div v-for="i in 3" :key="i" class="skel-card" />
        </div>

        <!-- 空状态（区分「没有数据」与「筛不出来」） -->
        <div v-else-if="isEmpty" class="empty-state">
          <Icon
            :name="hasFilter ? 'Search' : 'ListChecks'"
            :size="32"
            class="empty-icon"
            aria-hidden="true"
          />
          <h2 class="empty-title">{{ hasFilter ? '没有匹配的任务' : '还没有任务' }}</h2>
          <p class="empty-desc">
            {{ hasFilter ? '换个筛选条件或关键词试试' : '点击 + 创建你的第一项任务' }}
          </p>
          <button
            v-if="hasFilter"
            type="button"
            class="empty-reset"
            @click="taskStore.resetQuery()"
          >重置筛选</button>
        </div>

        <!-- 列表 -->
        <ul v-else class="task-items">
          <li v-for="task in tasks" :key="task.id" class="task-swipe">
            <TaskCard
              :task="task"
              :selecting="selecting"
              :selected="selectedIds.includes(task.id)"
              @open="onOpen(task)"
              @toggle-complete="onToggleComplete(task, $event)"
              @longpress="onLongPress(task)"
              @edit="onEdit(task)"
              @remove="onDelete(task)"
            />
          </li>
        </ul>
      </van-list>
    </main>

    <!-- 浮动 + 按钮（多选模式下隐藏） -->
    <button
      v-if="!selecting"
      type="button"
      class="fab"
      aria-label="新建任务"
      @click="openCreate"
    >
      <span class="fab-plus" aria-hidden="true">+</span>
    </button>

    <!-- 批量操作栏（Phase 2.4） -->
    <div v-if="selecting" class="batch-bar">
      <button type="button" class="batch-btn is-complete" @click="onBatchComplete">批量完成</button>
      <button type="button" class="batch-btn is-delete" @click="onBatchDelete">批量删除</button>
    </div>

    <!-- 新建 / 编辑弹层 -->
    <TaskEditSheet
      v-model:show="sheetShow"
      :task="editingTask"
      :on-save="onSave"
    />
  </div>
</template>

<style lang="scss" scoped>
.task-page {
  /* ⚠️ 不写 height：高度由 HomeLayout 的 .content 用 flex 直接分配
     （见 HomeLayout .content 注释）。这里若写 height:100%，会与布局层
     的定位方案在同一组属性上争抢（特异性相同、由 CSS 注入顺序裁决），
     且依赖 iOS Safari 上不可靠的百分比解析 —— 页面一旦被内容撑高，
     .task-list-wrap 的 flex:1 就空转、滚动传到根，header 和胶囊一起弹
     （用户报障：「待办滚动行为和其他模块不一致」）。 */
  background: var(--color-bg-app);
  display: flex;
  flex-direction: column;
  /* 定位容器：悬浮按钮 / 批量操作栏锚定到这里（见 .fab / .batch-bar）。
     本元素不滚动（滚动在 .task-list-wrap 里），所以它们不会跟着滚。 */
  position: relative;
}

/* ========== 顶部栏 / 选项卡 ==========
   两者都不在本页渲染了：
     顶部栏（待办 / 已选 N 项）→ HomeLayout 的 components/PageHeader.vue
     状态筛选 tab             → HomeLayout 的 components/SubTabBar.vue
   本页只保留内容区与锚定在 .task-page 上的悬浮元素。 */

/* ========== 搜索框 ========== */
.search-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 40px;
  /* 上下都留白：原先是 `10px 20px 0` —— 底部没有外边距，搜索胶囊的下边缘
     直接压在「优先级 / 排序」那条白色 dropdown 栏上，两块白色连成一体，
     看起来像"搜索栏和筛选粘在一起"。上下同为 12px 后，中间露出页面底色。 */
  margin: 12px var(--space-5);
  padding: 0 12px;
  background: var(--color-bg-card);
  border-radius: 20px;
  flex-shrink: 0;
}
.search-icon {
  display: block;
  flex-shrink: 0;
  opacity: 0.6;
}
.search-input {
  flex: 1;
  min-width: 0;
  height: 100%;
  border: 0;
  background: transparent;
  outline: none;
  font-size: var(--fs-body-sm);
  color: var(--color-text-primary);
  &::placeholder { color: var(--color-text-disabled); }
  &::-webkit-search-cancel-button { display: none; }
}
.search-clear {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-bg-hover);
  border: 0;
  border-radius: 50%;
  padding: 0;
  font-size: var(--fs-body-sm);
  line-height: 1;
  color: var(--color-text-tertiary);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

/* ========== Tabs ==========
   5 个状态筛选 tab 由 HomeLayout 的 components/SubTabBar.vue 渲染，
   本页不再自定义（历史坑：这里曾是 van-tabs + margin-top: 10px，
   那 10px 会漏出页面底色把 header 和选项卡割成两半）。 */

/* ========== 筛选下拉 ========== */
.task-filters {
  flex-shrink: 0;
  :deep(.van-dropdown-menu__bar) {
    height: 40px;
    background: var(--color-bg-card);
    box-shadow: none;
    border-bottom: 1px solid var(--color-border-light);
  }
  :deep(.van-dropdown-menu__title) {
    font-size: var(--fs-caption);
    color: var(--color-text-secondary);
  }
}

/* ========== 4 KPI ========== */
.kpi-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
  padding: 12px var(--space-5) 0;
  flex-shrink: 0;
}
.kpi-cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 8px 2px;
  background: var(--color-bg-card);
  border-radius: 10px;
  &.is-alert {
    background: var(--color-danger-light);
    .kpi-value, .kpi-label { color: var(--color-danger-dark); }
  }
}
.kpi-value {
  /* 数值阶令牌：与首页 / 统计 / 记录·习惯卡统一（原为 17px） */
  font-size: var(--fs-metric);
  font-weight: 700;
  font-family: var(--font-num);
  color: var(--color-text-primary);
  line-height: 1.1;
}
.kpi-label {
  /* 小标注令牌：与首页 / 统计 / 记录·习惯卡的 KPI 标签统一（原为 10px） */
  font-size: var(--fs-caption-sm);
  color: var(--color-text-tertiary);
}

/* ========== 列表区 ========== */
.task-list-wrap {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  /* 滚到两端不把滚动链传给父级，避免 iOS 上整个视口跟着弹动 */
  overscroll-behavior-y: contain;
}
.task-list {
  /* 底部留白走令牌，与其它页一致（底距 + 胶囊高 + 呼吸位） */
  padding: var(--space-4) var(--space-5) var(--tabbar-reserve, 83px);
}

.task-items {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* 左滑容器：圆角 + 阴影放在外层，否则会被 overflow:hidden 裁掉 */
.task-swipe {
  border-radius: 12px;
  box-shadow: var(--shadow-xs);
  overflow: hidden;
}

/* ========== 空状态 ========== */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 80px 24px;
  text-align: center;
}
/* 空态图标：尺寸由 <Icon :size> 控制（原来是 64px 的 emoji，视觉重量过大） */
.empty-icon {
  display: block;
  margin-bottom: 16px;
  opacity: 0.6;
  color: var(--color-text-tertiary);
}
.empty-title {
  font-size: var(--fs-h4);
  font-weight: 600;
  color: var(--color-text-primary);
  margin: 0 0 6px;
}
.empty-desc {
  font-size: var(--fs-caption);
  color: var(--color-text-tertiary);
  margin: 0;
}
.empty-reset {
  margin-top: 14px;
  height: 32px;
  padding: 0 16px;
  border: 1px solid var(--color-primary);
  border-radius: 16px;
  background: transparent;
  color: var(--color-primary);
  font-size: var(--fs-caption);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

/* ========== 骨架 ========== */
.loading-skeleton {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.skel-card {
  height: 76px;
  background: linear-gradient(90deg, #F3F4F6 25%, #E5E7EB 50%, #F3F4F6 75%);
  background-size: 200% 100%;
  border-radius: 12px;
  animation: shimmer 1.5s infinite;
}
@keyframes shimmer {
  0%   { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

/* ========== 浮动 + 按钮（fixed） ========== */
.fab {
  /* absolute（不是 fixed）：锚定到 .task-page，系统不会对它做任何安全区
     内缩，四种环境（桌面 / Android / iOS 浏览器 / iOS 主屏）落点一致。 */
  position: absolute;
  right: 20px;
  /* 抬高一个 --tabbar-reserve（= 胶囊底距 + 胶囊高 + 呼吸位），
     按钮始终悬在胶囊正上方，不会因平台差异脱节。 */
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
  transition: all var(--duration-fast) var(--ease-default);
  -webkit-tap-highlight-color: transparent;
  &:active {
    transform: scale(0.92);
    background: var(--color-primary-dark);
  }
}
.fab-plus {
  font-size: 32px;
  font-weight: 300;
  line-height: 1;
  margin-top: -2px;
}

/* ========== 批量操作栏 ========== */
.batch-bar {
  /* absolute（不是 fixed）：同 .fab，避开系统对 fixed 底边的内缩，
     实心栏背景才能可靠地铺到内容区底部。 */
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  gap: 10px;
  /* 背景铺满容器，按钮再上抬一个安全区高度避开 Home Indicator
     （用实测的 --env-safe-bottom，不手写 env()）。 */
  padding: 10px var(--space-5) calc(10px + var(--env-safe-bottom, 0px));
  background: var(--color-bg-card);
  box-shadow: 0 -2px 12px rgba(0, 0, 0, 0.06);
  z-index: var(--z-fixed);
}
.batch-btn {
  flex: 1;
  height: 44px;
  border: 0;
  border-radius: 22px;
  font-size: var(--fs-body);
  font-weight: 600;
  color: #FFFFFF;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  &:active { opacity: 0.85; }
  &.is-complete { background: var(--color-primary); }
  &.is-delete { background: var(--color-danger); }
}
</style>
