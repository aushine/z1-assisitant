import { create } from 'zustand'
import { feedback } from '@/utils/feedback'
import { habitApi } from '@/api/habit'
import type {
  Habit,
  CreateHabitReq,
  UpdateHabitReq,
  LogHabitReq,
  HabitStatus,
  HabitCategory,
} from '@/api/types'

interface HabitStore {
  items: Habit[]
  loading: boolean
  statusFilter: HabitStatus | ''
  categoryFilter: HabitCategory | ''
  isEmpty: boolean
  total: number
  todayDone: number
  todayTotal: number
  todayCheckIns: number
  fetchList: () => Promise<void>
  setStatusFilter: (s: HabitStatus | '') => void
  setCategoryFilter: (c: HabitCategory | '') => void
  create: (data: CreateHabitReq) => Promise<Habit | null>
  update: (id: string, data: UpdateHabitReq) => Promise<Habit | null>
  remove: (id: string) => Promise<boolean>
  checkIn: (id: string, payload?: Partial<LogHabitReq>) => Promise<void>
}

function deriveFromItems(items: Habit[], loading: boolean) {
  return {
    isEmpty: !loading && items.length === 0,
    total: items.length,
    todayDone: items.filter((h) => h.status === 'active' && (h.today_done ?? h.today_completed)).length,
    todayTotal: items.filter((h) => h.status === 'active').length,
    todayCheckIns: items.reduce((s, h) => s + (h.today_count ?? 0), 0),
  }
}

/** Normalize backend field today_completed → today_done for UI convenience */
function normalizeHabit(h: any): Habit {
  if (h && h.today_completed !== undefined && h.today_done === undefined) {
    h.today_done = h.today_completed
  }
  return h as Habit
}

/** 本地时区当天日期 YYYY-MM-DD（避免 toISOString() 带来的 UTC 偏移跨天） */
function todayDate(d: Date = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export const useHabitStore = create<HabitStore>((set, get) => ({
  items: [],
  loading: false,
  statusFilter: '',
  categoryFilter: '',
  ...deriveFromItems([], false),

  async fetchList() {
    set({ loading: true })
    try {
      const { statusFilter } = get()
      // Fetch habit list (no today data)
      const res = await habitApi.list({
        status: statusFilter || undefined,
      })
      let items = (res.items || []).map(normalizeHabit)

      // Fetch today's data and merge
      if (!statusFilter || statusFilter === 'active') {
        try {
          const todayRes = await habitApi.getToday()
          const todayMap = new Map<string, { today_count?: number; today_completed?: boolean }>()
          for (const item of (todayRes.items || [])) {
            todayMap.set(item.id, {
              today_count: item.today_count,
              today_completed: item.today_completed,
            })
          }
          // Merge today data into habit items
          items = items.map((h) => {
            const todayData = todayMap.get(h.id)
            if (todayData) {
              return { ...h, today_count: todayData.today_count, today_completed: todayData.today_completed, today_done: todayData.today_completed } as Habit
            }
            return h
          })
        } catch {
          // today endpoint may not exist; graceful fallback
        }
      }

      set({ items, loading: false, ...deriveFromItems(items, false) })
    } catch {
      set({ items: [], loading: false, ...deriveFromItems([], false) })
    }
  },

  setStatusFilter(s) {
    set({ statusFilter: s })
  },

  setCategoryFilter(c) {
    set({ categoryFilter: c })
  },

  async create(data) {
    try {
      const habit = normalizeHabit(await habitApi.create(data))
      const { items } = get()
      const newItems = [habit, ...items]
      set({ items: newItems, ...deriveFromItems(newItems, get().loading) })
      return habit
    } catch {
      return null
    }
  },

  async update(id, data) {
    const { items } = get()
    const idx = items.findIndex((h) => h.id === id)
    if (idx < 0) {
      try {
        return await habitApi.update(id, data)
      } catch {
        return null
      }
    }
    const snapshot = { ...items[idx] }
    const newItems = [...items]
    newItems[idx] = { ...snapshot, ...data } as Habit
    set({ items: newItems, ...deriveFromItems(newItems, get().loading) })
    try {
      const fresh = normalizeHabit(await habitApi.update(id, data))
      const freshItems = [...get().items]
      freshItems[idx] = fresh
      set({ items: freshItems, ...deriveFromItems(freshItems, get().loading) })
      return fresh
    } catch {
      const rollbackItems = [...get().items]
      rollbackItems[idx] = snapshot
      set({ items: rollbackItems, ...deriveFromItems(rollbackItems, get().loading) })
      return null
    }
  },

  async remove(id) {
    const { items } = get()
    const idx = items.findIndex((h) => h.id === id)
    if (idx < 0) return false
    const snapshot = items[idx]
    const newItems = [...items]
    newItems.splice(idx, 1)
    set({ items: newItems, ...deriveFromItems(newItems, get().loading) })
    try {
      await habitApi.remove(id)
      feedback.destructiveDone('习惯已删除')
      return true
    } catch {
      const rollbackItems = [...get().items]
      rollbackItems.splice(idx, 0, snapshot)
      set({ items: rollbackItems, ...deriveFromItems(rollbackItems, get().loading) })
      return false
    }
  },

  async checkIn(id, payload) {
    const { items } = get()
    const idx = items.findIndex((h) => h.id === id)
    if (idx < 0) return
    const snapshot = { ...items[idx] }
    const target = snapshot.target_count || 1
    const nextCount = (snapshot.today_count ?? 0) + (payload?.count ?? 1)
    const wasDone = !!(snapshot.today_done ?? snapshot.today_completed)
    const nowDone = nextCount >= target
    const newItems = [...items]
    newItems[idx] = { ...snapshot, today_count: nextCount, today_done: nowDone, today_completed: nowDone }
    set({ items: newItems, ...deriveFromItems(newItems, get().loading) })
    try {
      // 后端 POST /habits/:id/log 回写的是 habit（含 4 个 streak 字段），
      // 但不含 today_count / today_completed，因此今日进度保留乐观值，仅合并 streak 字段。
      const fresh = normalizeHabit(await habitApi.log(id, {
        date: payload?.date || todayDate(),
        count: payload?.count ?? 1,
        note: payload?.note,
        duration_minutes: payload?.duration_minutes,
      }))
      const prev = get().items[idx]
      const freshItems = [...get().items]
      freshItems[idx] = {
        ...prev,
        current_streak: fresh.current_streak,
        longest_streak: fresh.longest_streak,
        last_check_in_date: fresh.last_check_in_date,
        total_check_ins: fresh.total_check_ins,
      }
      set({ items: freshItems, ...deriveFromItems(freshItems, get().loading) })
      if (!wasDone && nowDone) {
      } else {
      }
    } catch {
      const rollbackItems = [...get().items]
      rollbackItems[idx] = snapshot
      set({ items: rollbackItems, ...deriveFromItems(rollbackItems, get().loading) })
    }
  },
}))
