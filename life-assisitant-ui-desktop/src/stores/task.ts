import { create } from 'zustand'
import { feedback } from '@/utils/feedback'
import { taskApi } from '@/api/task'
import type {
  Task,
  TaskFilter,
  TaskPriority,
  CreateTaskReq,
  UpdateTaskReq,
  TaskStatus,
  BatchTaskReq,
} from '@/api/types'

export interface TaskListQuery {
  filter: TaskFilter
  priority: TaskPriority | ''
  keyword: string
  page: number
  page_size: number
}

const defaultQuery = (): TaskListQuery => ({
  filter: 'all',
  priority: '',
  keyword: '',
  page: 1,
  page_size: 10,
})

function computeDerived(state: Pick<TaskStore, 'items' | 'loading' | 'query'>) {
  return {
    isEmpty: !state.loading && state.items.length === 0,
    hasFilter: state.query.filter !== 'all' || !!state.query.priority || !!state.query.keyword,
  }
}

interface TaskStore {
  items: Task[]
  total: number
  loading: boolean
  query: TaskListQuery
  isEmpty: boolean
  hasFilter: boolean
  /** 当前选中的任务 ID 列表（批量操作用） */
  selectedIds: string[]
  fetchList: () => Promise<void>
  resetAndFetch: () => Promise<void>
  setQuery: (patch: Partial<Omit<TaskListQuery, 'page' | 'page_size'>>) => void
  setPage: (page: number) => void
  create: (data: CreateTaskReq) => Promise<Task | null>
  update: (id: string, data: UpdateTaskReq) => Promise<Task | null>
  toggleComplete: (id: string, next: TaskStatus) => Promise<void>
  remove: (id: string) => Promise<boolean>
  /** 批量操作（complete / delete） */
  batchAction: (data: BatchTaskReq) => Promise<number>
  /** 切换子任务完成状态 */
  toggleSubtask: (taskId: string, subtaskId: string) => Promise<Task | null>
  /** 选中/取消选中任务 */
  toggleSelect: (id: string) => void
  /** 全选/全不选 */
  toggleSelectAll: (ids?: string[]) => void
  /** 清空选中 */
  clearSelection: () => void
}

export const useTaskStore = create<TaskStore>((set, get) => ({
  items: [],
  total: 0,
  loading: false,
  query: defaultQuery(),
  isEmpty: true,
  hasFilter: false,
  selectedIds: [],

  async fetchList() {
    set({ loading: true })
    try {
      const { query } = get()
      const res = await taskApi.list({
        filter: query.filter,
        priority: query.priority || undefined,
        keyword: query.keyword || undefined,
        page: query.page,
        page_size: query.page_size,
      })
      const derived = computeDerived({ items: res.items, loading: false, query })
      set({ items: res.items, total: res.total, loading: false, ...derived })
    } catch {
      set({ items: [], total: 0, loading: false, isEmpty: true })
    }
  },

  async resetAndFetch() {
    set({ query: defaultQuery() })
    await get().fetchList()
  },

  setQuery(patch) {
    const { query } = get()
    const newQuery = { ...query, ...patch, page: 1 }
    const derived = computeDerived({ items: get().items, loading: get().loading, query: newQuery })
    set({ query: newQuery, ...derived })
  },

  setPage(page) {
    const { query } = get()
    set({ query: { ...query, page } })
  },

  async create(data) {
    try {
      const task = await taskApi.create(data)
      const { items, total } = get()
      const newItems = [task, ...items]
      const derived = computeDerived({ items: newItems, loading: false, query: get().query })
      set({ items: newItems, total: total + 1, ...derived })
      return task
    } catch {
      return null
    }
  },

  async update(id, data) {
    const { items } = get()
    const idx = items.findIndex((t) => t.id === id)
    if (idx < 0) {
      try {
        return await taskApi.update(id, data)
      } catch {
        return null
      }
    }
    const snapshot = { ...items[idx] }
    const updated = { ...snapshot, ...data, updated_at: new Date().toISOString() } as Task
    const newItems = [...items]
    newItems[idx] = updated
    set({ items: newItems })
    try {
      const fresh = await taskApi.update(id, data)
      const freshItems = [...get().items]
      freshItems[idx] = fresh
      set({ items: freshItems })
      return fresh
    } catch {
      const rollbackItems = [...get().items]
      rollbackItems[idx] = snapshot
      set({ items: rollbackItems })
      return null
    }
  },

  async toggleComplete(id, next) {
    const { items } = get()
    const idx = items.findIndex((t) => t.id === id)
    if (idx < 0) return
    const snapshot = { ...items[idx] }
    const now = new Date().toISOString()
    const newItems = [...items]
    newItems[idx] = { ...snapshot, status: next, completed_at: next === 'done' ? now : undefined, updated_at: now }
    set({ items: newItems })
    try {
      const fresh = await taskApi.toggleComplete(id, next)
      const freshItems = [...get().items]
      freshItems[idx] = fresh
      set({ items: freshItems })
    } catch {
      const rollbackItems = [...get().items]
      rollbackItems[idx] = snapshot
      set({ items: rollbackItems })
    }
  },

  async remove(id) {
    const { items, total } = get()
    const idx = items.findIndex((t) => t.id === id)
    if (idx < 0) return false
    const snapshot = items[idx]
    const newItems = [...items]
    newItems.splice(idx, 1)
    const derived = computeDerived({ items: newItems, loading: false, query: get().query })
    set({ items: newItems, total: Math.max(0, total - 1), ...derived })
    try {
      await taskApi.remove(id)
      feedback.destructiveDone('任务已删除')
      return true
    } catch {
      const rollbackItems = [...get().items]
      rollbackItems.splice(idx, 0, snapshot)
      set({ items: rollbackItems, total: get().total + 1 })
      return false
    }
  },

  async batchAction(data) {
    try {
      const resp = await taskApi.batchAction(data)
      // 批量操作后刷新列表
      await get().fetchList()
      set({ selectedIds: [] })
      feedback.batchDone(resp.affected, '个任务')
      return resp.affected
    } catch {
      return 0
    }
  },

  async toggleSubtask(taskId, subtaskId) {
    try {
      const fresh = await taskApi.toggleSubtask(taskId, subtaskId)
      // 更新列表中对应任务
      const { items } = get()
      const idx = items.findIndex((t) => t.id === taskId)
      if (idx >= 0) {
        const newItems = [...items]
        newItems[idx] = fresh
        set({ items: newItems })
      }
      return fresh
    } catch {
      return null
    }
  },

  toggleSelect(id) {
    const { selectedIds } = get()
    if (selectedIds.includes(id)) {
      set({ selectedIds: selectedIds.filter((i) => i !== id) })
    } else {
      set({ selectedIds: [...selectedIds, id] })
    }
  },

  toggleSelectAll(ids?: string[]) {
    const { selectedIds, items } = get()
    const allIds = ids ?? items.map((t) => t.id)
    const allSelected = allIds.length > 0 && allIds.every((id) => selectedIds.includes(id))
    if (allSelected) {
      set({ selectedIds: selectedIds.filter((id) => !allIds.includes(id)) })
    } else {
      const merged = new Set([...selectedIds, ...allIds])
      set({ selectedIds: Array.from(merged) })
    }
  },

  clearSelection() {
    set({ selectedIds: [] })
  },
}))
