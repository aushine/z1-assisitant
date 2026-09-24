/**
 * Task Store（任务 / 待办模块 · 移动端）
 *
 * SYNC-FROM-DESKTOP: life-assisitant-ui-desktop/src/stores/task.ts
 * SYNC-FROM-BACKEND: life-assisitant-api/internal/model/dto/task.go（ListTasksReq）
 * 最后同步：2026-09-18（Phase 2.3 / 2.4 / 2.5）
 *
 * 与桌面端的差异（刻意）：
 *   - 桌面端是「翻页器」（page + page_size=10 + total）
 *     移动端是「无限滚动」（page 递增 + hasMore + van-list）
 *     两者语义等价，只是 UI 形态不同。
 *   - 桌面端把 query 存在 `query` 对象里；移动端拆成 4 个平铺 ref
 *     （filter / priority / keyword / sort），因为模板里要分别双向绑定。
 *
 * 关键修复（Phase 0）：
 *   B5  `van-list` 此前只绑 `v-model:loading` 没有 `@load`，`finished` 又写成
 *       `!loading && tasks.length > 0` → 永远「已完成」，只有第一页。
 *       现补 `loadMore()` + `hasMore` + `finished` 正确语义。
 *
 * 关键修复（Phase 2）：
 *   - 后端 `ListTasksReq.Filter` 支持 `overdue`，旧前端 TaskFilter 也早已含该值，
 *     但 UI 只暴露 4 个 tab → 补「逾期」。
 *   - 新增 `priority` / `keyword` / `sort` 三个查询维度（后端全部支持，前端此前未接）。
 *   - 新增多选 + 批量完成/删除（`POST /tasks/batch`，1-100 个）。
 *   - 新增 `toggleSubtask`（`PATCH /tasks/:id/subtasks/:subtaskId`）。
 */
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { showFailToast } from 'vant'
import { taskApi, type ListTasksParams } from '@/api/task'
import { feedback } from '@/utils/feedback'
import type {
  BatchTaskReq,
  CreateTaskReq,
  Task,
  TaskFilter,
  TaskPriority,
  TaskSort,
  TaskStatus,
  UpdateTaskReq,
} from '@/api/types'
import { todayDate, nowISO } from '@/utils/date'

/** 每页条数（移动端无限滚动，与桌面端分页语义等价） */
const PAGE_SIZE = 20

/** 排序选项：'' = 后端默认（due_time 优先 + created_at 兜底） */
export type TaskSortOption = TaskSort | ''

export const useTaskStore = defineStore('task', () => {
  // ==================== state ====================
  const tasks = ref<Task[]>([])
  const total = ref(0)
  const loading = ref(false)
  /** 是否已成功加载过首页数据（van-list 用它区分「首次加载」与「加载更多」） */
  const loadedOnce = ref(false)
  /** 服务器是否还有下一页 */
  const hasMore = ref(false)
  /** 当前已加载到第几页 */
  const page = ref(1)

  // —— 查询维度（任一变化都重置到第 1 页）——
  /** 业务语义筛选：全部 / 今日 / 即将 / 已完成 / 逾期 */
  const filter = ref<TaskFilter>('all')
  /** 优先级筛选：'' = 全部优先级 */
  const priority = ref<TaskPriority | ''>('')
  /** 标题模糊搜索（≤50 字，与后端 v:"length:0,50" 对齐） */
  const keyword = ref('')
  /** 排序字段；'' = 后端默认 */
  const sort = ref<TaskSortOption>('')

  /** 当前选中的任务 id（多选模式） */
  const selectedIds = ref<string[]>([])

  // ==================== getters ====================
  /** 当前筛选下是否有数据 */
  const isEmpty = computed(() => !loading.value && tasks.value.length === 0)
  /** van-list 的 finished：已加载完成且没有下一页 */
  const finished = computed(() => loadedOnce.value && !hasMore.value)
  /** 是否处于多选模式（有任意选中即为多选） */
  const selecting = computed(() => selectedIds.value.length > 0)
  /** 是否已勾选当前列表全部项 */
  const allSelected = computed(
    () => tasks.value.length > 0 && tasks.value.every((t) => selectedIds.value.includes(t.id))
  )
  /** 是否存在任一非默认查询条件（空状态文案要区分「没有数据」与「筛不出来」） */
  const hasFilter = computed(
    () => filter.value !== 'all' || !!priority.value || !!keyword.value || !!sort.value
  )
  /** 各筛选的计数（用当前已加载列表前端算；仅作 tab 角标参考） */
  const stats = computed(() => {
    const all = tasks.value
    return {
      all: all.length,
      today: all.filter((t) => isToday(t.due_date) && t.status !== 'done' && t.status !== 'archived').length,
      upcoming: all.filter((t) => isUpcoming(t.due_date) && t.status !== 'done' && t.status !== 'archived').length,
      done: all.filter((t) => t.status === 'done').length,
      overdue: all.filter((t) => isOverdue(t)).length,
    }
  })

  // ==================== 内部工具 ====================

  /** 组装当前查询参数（query 是唯一真相，避免各处手拼漏字段） */
  function buildParams(targetPage: number): ListTasksParams {
    const params: ListTasksParams = {
      filter: filter.value,
      page: targetPage,
      page_size: PAGE_SIZE,
    }
    if (priority.value) params.priority = priority.value
    if (keyword.value.trim()) params.keyword = keyword.value.trim()
    if (sort.value) params.sort = sort.value
    return params
  }

  // ==================== actions ====================

  /**
   * 拉取任务列表首页（按当前 query，page 重置为 1）
   * @param nextFilter 传入则先切换 filter（兼容 `fetchTasks('today')` 旧调用）
   * @param opts.silent 静默刷新（2026-09-24 S1）：不置 loading、失败不清空已有列表，
   *        用于 KeepAlive 切回 Tab 时的后台刷新；首拉 / 下拉刷新不传。
   */
  async function fetchTasks(nextFilter?: TaskFilter, opts: { silent?: boolean } = {}): Promise<void> {
    if (nextFilter) filter.value = nextFilter
    const silent = opts.silent === true
    if (!silent) loading.value = true
    try {
      const res = await taskApi.list(buildParams(1))
      tasks.value = res.items
      total.value = res.total
      hasMore.value = Boolean(res.has_more)
      page.value = 1
      loadedOnce.value = true
    } catch (e) {
      if (!silent) {
        // 错误 toast 已在 request.ts 拦截器里弹过，这里只清空
        tasks.value = []
        total.value = 0
        hasMore.value = false
        loadedOnce.value = true
      }
      // eslint-disable-next-line no-console
      console.error('[TaskStore] fetchTasks failed', e)
    } finally {
      if (!silent) loading.value = false
    }
  }

  /**
   * 加载下一页（无限滚动 / 上拉加载）
   *
   * 修复 B5：此前 `van-list` 只绑了 `v-model:loading` 而没有 `@load`，
   * `finished` 又被写成 `!loading && tasks.length > 0` —— 列表永远是
   * 「已完成」状态，永远不会再请求下一页，等于只有第一页。
   */
  async function loadMore(): Promise<void> {
    if (!hasMore.value || loading.value) return
    loading.value = true
    const next = page.value + 1
    try {
      const res = await taskApi.list(buildParams(next))
      // 空页兜底：后端若始终返回 has_more=true，靠这里终止，避免无限循环
      if (res.items.length === 0) {
        hasMore.value = false
        return
      }
      const seen = new Set(tasks.value.map((t) => t.id))
      tasks.value.push(...res.items.filter((t) => !seen.has(t.id)))
      total.value = res.total
      hasMore.value = Boolean(res.has_more)
      page.value = next
    } catch (e) {
      // 加载更多失败时保持 hasMore，允许用户再次上拉重试；van-list 会自行结束 loading
      // eslint-disable-next-line no-console
      console.error('[TaskStore] loadMore failed', e)
    } finally {
      loading.value = false
    }
  }

  /** 切换筛选 tab（重置到第 1 页） */
  async function setFilter(next: TaskFilter): Promise<void> {
    if (filter.value === next) return
    filter.value = next
    clearSelection()
    await fetchTasks()
  }

  /** 设置优先级筛选 */
  async function setPriority(next: TaskPriority | ''): Promise<void> {
    if (priority.value === next) return
    priority.value = next
    clearSelection()
    await fetchTasks()
  }

  /** 设置排序 */
  async function setSort(next: TaskSortOption): Promise<void> {
    if (sort.value === next) return
    sort.value = next
    clearSelection()
    await fetchTasks()
  }

  /**
   * 设置关键词（调用方负责 350ms 防抖，见 pages/task/index.vue）
   * 与上一次相同则不发请求，避免防抖 + 重复触发打两次接口。
   */
  async function setKeyword(next: string): Promise<void> {
    const trimmed = next.trim()
    if (keyword.value === trimmed) return
    keyword.value = trimmed
    clearSelection()
    await fetchTasks()
  }

  /** 一键重置全部查询条件 */
  async function resetQuery(): Promise<void> {
    filter.value = 'all'
    priority.value = ''
    keyword.value = ''
    sort.value = ''
    clearSelection()
    await fetchTasks()
  }

  /**
   * 创建任务
   */
  async function createTask(data: CreateTaskReq): Promise<Task | null> {
    try {
      const task = await taskApi.create(data)
      // 按当前筛选决定是否插到列表头
      if (shouldInclude(task, filter.value)) {
        tasks.value.unshift(task)
      }
      total.value += 1
      return task
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[TaskStore] createTask failed', e)
      return null
    }
  }

  /**
   * 更新任务（乐观更新 + 失败回滚）
   */
  async function updateTask(id: string, data: UpdateTaskReq): Promise<Task | null> {
    const idx = tasks.value.findIndex((t) => t.id === id)
    if (idx === -1) {
      // 列表里没有（如详情页直达），直接走后端
      try {
        return await taskApi.update(id, data)
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('[TaskStore] updateTask failed', e)
        return null
      }
    }

    // 乐观：先改本地
    const original = { ...tasks.value[idx] } as Task
    // UpdateTaskReq 继承自 Partial<CreateTaskReq>，其中 `subtasks` 是子任务的**写入形态**
    // （SubtaskReq[]，id 可缺省），与 Task.subtasks（Subtask[]，id 必填）并非同一类型。
    // 本路径不改子任务（子任务走 /tasks/:id/subtasks），故从乐观合并中排除：
    // 既消掉 TS2322，也避免把写入形态的对象混进本地列表。
    const optimistic: Task = {
      ...original,
      ...(data as Omit<UpdateTaskReq, 'subtasks'>),
      updated_at: nowISO(),
    }
    tasks.value[idx] = optimistic
    // 状态/字段变化后可能不再属于当前筛选，先乐观移除（但不过早减 total，等回滚后恢复）
    const stillBelongs = shouldInclude(optimistic, filter.value)
    if (!stillBelongs) {
      tasks.value.splice(idx, 1)
    }

    try {
      const real = await taskApi.update(id, data)
      // 用真实数据替换
      const newIdx = tasks.value.findIndex((t) => t.id === id)
      if (newIdx >= 0) {
        tasks.value[newIdx] = real
      } else if (shouldInclude(real, filter.value)) {
        tasks.value.unshift(real)
      }
      return real
    } catch (e) {
      // 回滚
      const cur = tasks.value.findIndex((t) => t.id === id)
      if (cur >= 0) {
        tasks.value[cur] = original
      } else {
        // 之前被 splice 掉，插回原位置
        tasks.value.splice(Math.min(idx, tasks.value.length), 0, original)
      }
      // eslint-disable-next-line no-console
      console.error('[TaskStore] updateTask rolled back', e)
      return null
    }
  }

  /**
   * 切换完成状态（乐观 + 回滚）
   * @param id 任务 id
   * @param nextStatus 目标状态（默认 'done'，再点回 'todo'）
   */
  async function toggleComplete(id: string, nextStatus: TaskStatus = 'done'): Promise<void> {
    const task = tasks.value.find((t) => t.id === id)
    if (!task) return

    const originalStatus = task.status
    const originalCompletedAt = task.completed_at
    // 乐观改状态
    task.status = nextStatus
    if (nextStatus === 'done') {
      task.completed_at = nowISO()
    } else {
      delete task.completed_at
    }

    // 状态变更后可能不再属于当前筛选 → 先乐观移除
    const stillBelongs = shouldInclude(task, filter.value)
    const removedIdx = tasks.value.findIndex((t) => t.id === id)
    if (!stillBelongs && removedIdx >= 0) {
      tasks.value.splice(removedIdx, 1)
    }

    try {
      await taskApi.toggleComplete(id, nextStatus)
    } catch (e) {
      // 回滚
      task.status = originalStatus
      if (originalCompletedAt) {
        task.completed_at = originalCompletedAt
      } else {
        delete task.completed_at
      }
      // 如果之前被移除，重新加回去
      if (!tasks.value.find((t) => t.id === id)) {
        tasks.value.splice(Math.min(removedIdx, tasks.value.length), 0, task)
      }
      showFailToast('操作失败，请重试')
      // eslint-disable-next-line no-console
      console.error('[TaskStore] toggleComplete rolled back', e)
    }
  }

  /**
   * 切换子任务完成状态（Phase 2.5）
   * 后端返回**更新后的整个 Task**（含最新 subtasks），直接整体回写即可。
   */
  async function toggleSubtask(taskId: string, subtaskId: string): Promise<Task | null> {
    try {
      const fresh = await taskApi.toggleSubtask(taskId, subtaskId)
      const idx = tasks.value.findIndex((t) => t.id === taskId)
      if (idx >= 0) tasks.value[idx] = fresh
      return fresh
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[TaskStore] toggleSubtask failed', e)
      return null
    }
  }

  /**
   * 删除任务（乐观 + 回滚）
   * @returns 是否成功
   */
  async function deleteTask(id: string): Promise<boolean> {
    const idx = tasks.value.findIndex((t) => t.id === id)
    if (idx === -1) {
      // 不在列表里（详情页直达）→ 直接调接口
      try {
        await taskApi.delete(id)
        feedback.destructiveDone('任务已删除')
        return true
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('[TaskStore] deleteTask failed', e)
        return false
      }
    }
    const original = tasks.value[idx]

    // 乐观：先从本地移除
    tasks.value.splice(idx, 1)
    total.value = Math.max(0, total.value - 1)

    try {
      await taskApi.delete(id)
      feedback.destructiveDone('任务已删除')
      return true
    } catch (e) {
      // 回滚
      tasks.value.splice(Math.min(idx, tasks.value.length), 0, original)
      total.value += 1
      showFailToast('删除失败，请重试')
      // eslint-disable-next-line no-console
      console.error('[TaskStore] deleteTask rolled back', e)
      return false
    }
  }

  /**
   * 批量操作（完成 / 删除）
   *
   * 不做逐条乐观更新 —— 批量接口返回 `affected` 数量，
   * 之后整体重拉列表即可（与桌面端一致），避免 N 条回滚逻辑。
   */
  async function batchAction(data: BatchTaskReq): Promise<number> {
    if (data.task_ids.length === 0) return 0
    loading.value = true
    try {
      const resp = await taskApi.batchAction(data)
      await fetchTasks()
      clearSelection()
      feedback.batchDone(resp.affected, '个任务')
      return resp.affected
    } catch (e) {
      showFailToast('批量操作失败，请重试')
      // eslint-disable-next-line no-console
      console.error('[TaskStore] batchAction failed', e)
      return 0
    } finally {
      loading.value = false
    }
  }

  // ==================== 多选 ====================

  /** 勾选 / 取消勾选单个 */
  function toggleSelect(id: string): void {
    const idx = selectedIds.value.indexOf(id)
    if (idx >= 0) selectedIds.value.splice(idx, 1)
    else selectedIds.value.push(id)
  }

  /** 全选 / 取消全选（默认作用于当前已加载列表） */
  function toggleSelectAll(): void {
    if (allSelected.value) {
      selectedIds.value = []
      return
    }
    selectedIds.value = tasks.value.map((t) => t.id)
  }

  /** 进入多选模式并选中某项（长按入口） */
  function enterSelect(id: string): void {
    if (!selectedIds.value.includes(id)) selectedIds.value.push(id)
  }

  /** 退出多选 */
  function clearSelection(): void {
    selectedIds.value = []
  }

  /**
   * 根据 id 查找任务
   */
  function findById(id: string): Task | undefined {
    return tasks.value.find((t) => t.id === id)
  }

  /**
   * 重置（路由切换 / 登出时）
   */
  function reset(): void {
    tasks.value = []
    total.value = 0
    loading.value = false
    loadedOnce.value = false
    hasMore.value = false
    page.value = 1
    filter.value = 'all'
    priority.value = ''
    keyword.value = ''
    sort.value = ''
    selectedIds.value = []
  }

  return {
    // state
    tasks,
    total,
    loading,
    loadedOnce,
    hasMore,
    page,
    filter,
    priority,
    keyword,
    sort,
    selectedIds,
    // getters
    isEmpty,
    finished,
    selecting,
    allSelected,
    hasFilter,
    stats,
    // actions
    fetchTasks,
    loadMore,
    setFilter,
    setPriority,
    setSort,
    setKeyword,
    resetQuery,
    createTask,
    updateTask,
    toggleComplete,
    toggleSubtask,
    deleteTask,
    batchAction,
    toggleSelect,
    toggleSelectAll,
    enterSelect,
    clearSelection,
    findById,
    reset,
  }
})

// ==================== 工具函数 ====================

/** 任务是否属于某筛选（乐观增删的判定依据，必须与后端 filter 语义一致） */
function shouldInclude(task: Task, filter: TaskFilter): boolean {
  if (task.status === 'archived') return false
  // 'all' = 非归档的全部。上方已把 archived 排除掉，故此处恒为 true
  // （原写法 `return task.status !== 'archived'` 会被 TS 判为永假比较 TS2367）
  if (filter === 'all') return true
  if (filter === 'done') return task.status === 'done'
  if (filter === 'overdue') return isOverdue(task)
  // today / upcoming 只看非 done
  if (task.status === 'done') return false
  if (filter === 'today') return isToday(task.due_date)
  if (filter === 'upcoming') return isUpcoming(task.due_date)
  return true
}

/** 是否今天（YYYY-MM-DD 与本地日期一致） */
function isToday(dateStr?: string): boolean {
  if (!dateStr) return false
  return dateStr === todayDate()
}

/** 是否未来（晚于今天） */
function isUpcoming(dateStr?: string): boolean {
  if (!dateStr) return false
  return dateStr > todayDate()
}

/** 是否逾期（有截止日、已过期、且未完成/未归档） */
function isOverdue(task: Task): boolean {
  if (!task.due_date) return false
  if (task.status === 'done' || task.status === 'archived') return false
  return task.due_date < todayDate()
}
