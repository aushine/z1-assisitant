/**
 * Habit Store（习惯模块 · 移动端）
 *
 * SYNC-FROM-DESKTOP: life-assisitant-ui-desktop/src/stores/habit.ts
 * SYNC-FROM-BACKEND: life-assisitant-api/internal/controller/habit.go
 *                    life-assisitant-api/internal/service/impl/habit.go
 *                    life-assisitant-api/internal/model/dto/habit.go
 * 最后同步：2026-09-18（Phase 3.2 / 3.3）
 *
 * Phase 3.2 新增（对齐桌面端）：
 *   - 列表改走 `GET /habits`（支持 status 筛选，含已归档）+ `GET /habits/today` 合并今日进度
 *     （后端 `List` 不填 today_count / today_completed，必须二次合并 —— 见 service impl）
 *   - 4 个 KPI getter：todayDone / todayTotal / todayCheckIns / total，另加 bestStreak（最长连续）
 *   - statusFilter / categoryFilter + filteredHabits（分类为客户端过滤，与桌面端一致）
 *
 * ⚠️ 打卡返回值的坑（本次修复）：
 *   `POST /habits/:id/log` 回写的是 `habitToResp(fresh)` —— 它**只含 4 个 streak
 *   字段，不含 today_count / today_completed**（后者仅 List / GetToday 填充）。
 *   旧实现直接 `habits[idx] = normalizeHabit(real)`，会把刚打完的今日进度
 *   冲成 undefined（表现为「打完卡数字又变回 0」）。现改为：保留乐观的
 *   today_count / today_done，只合并 streak 四件套。
 *
 * ⚠️ 契约要点：
 *   - `GET /habits` 走 `response.Page` → 含 { items, total, page, page_size, has_more }
 *   - `GET /habits/today` 返回裸 struct { date, items, total, done_count }，**不分页**
 *   - `DELETE /habits/:id` 返回 204（无响应体）
 *   - 打卡字段名是 `date` 不是 `log_date`（写错会 400 且静默无提示）
 */
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { showFailToast } from 'vant'
import { habitApi } from '@/api/habit'
import { feedback } from '@/utils/feedback'
import type {
  CreateHabitReq,
  Habit,
  HabitCategory,
  HabitStatus,
  LogHabitReq,
  UpdateHabitReq,
} from '@/api/types'
import { normalizeHabit } from '@/api/types'
import { nowISO } from '@/utils/date'

/**
 * 列表一次取满。
 * 后端 ListHabitsReq.page_size 上限 100；桌面端未传（走默认 20，超 20 条会静默截断），
 * 移动端显式取满，行为等价且更完整。
 */
const HABIT_PAGE_SIZE = 100

export const useHabitStore = defineStore('habit', () => {
  // ==================== state ====================
  const habits = ref<Habit[]>([])
  const loading = ref(false)
  /** 状态筛选：'' = 全部（含已归档）、active、archived */
  const statusFilter = ref<HabitStatus | ''>('')
  /** 分类筛选（客户端过滤，与桌面端一致，不写请求） */
  const categoryFilter = ref<HabitCategory | ''>('')

  // ==================== getters ====================

  /** 活跃习惯（今日打卡/进度的分母） */
  const activeHabits = computed(() => habits.value.filter((h) => h.status === 'active'))

  /** 列表是否为空（加载中不算） */
  const isEmpty = computed(() => !loading.value && habits.value.length === 0)

  /** 分类筛选后的列表（记录页列表渲染用） */
  const filteredHabits = computed(() => {
    if (!categoryFilter.value) return habits.value
    return habits.value.filter((h) => h.category === categoryFilter.value)
  })

  // ===== 4 KPI（S04/S06，口径与桌面端 deriveFromItems 一致）=====
  /** KPI1 今日完成数（仅 active） */
  const todayDone = computed(
    () => activeHabits.value.filter((h) => h.today_done ?? h.today_completed).length
  )
  /** KPI1 今日习惯总数（仅 active） */
  const todayTotal = computed(() => activeHabits.value.length)
  /** KPI3 今日打卡次数（所有 active 习惯 today_count 求和） */
  const todayCheckIns = computed(() => habits.value.reduce((s, h) => s + (h.today_count ?? 0), 0))
  /** KPI4 总习惯数（含已归档） */
  const total = computed(() => habits.value.length)
  /** KPI2 最长连续（取 active 习惯 longest_streak 最大值） */
  const bestStreak = computed(() =>
    activeHabits.value.reduce((m, h) => Math.max(m, h.longest_streak ?? 0), 0)
  )

  // ===== 兼容别名（Phase 0/2 的首页与统计页此前按这套名字写）=====
  const totalCount = total
  const doneCount = computed(() => todayDone.value)
  /** 今日整体完成率 0-100 */
  const todayRate = computed(() => {
    if (todayTotal.value === 0) return 0
    return Math.round((todayDone.value / todayTotal.value) * 100)
  })
  /** 最长连续天数的 KPI 别名 */
  const longestStreak = bestStreak

  // ==================== actions ====================

  /**
   * 拉取习惯列表（Phase 3.2 核心）
   *
   * 与桌面端 `fetchList` 等价的两步：
   *   1) `GET /habits?status=` 取列表（List 不填今日字段）
   *   2) 若在「全部 / 活跃」视图，再 `GET /habits/today` 合并 today_count /
   *      today_completed / today_done（按 id 匹配）
   * 第 2 步失败时静默降级（列表仍然展示，只是没有今日进度）。
   */
  async function fetchHabits(): Promise<void> {
    loading.value = true
    try {
      const status = statusFilter.value
      const res = await habitApi.list({
        status: status || undefined,
        page_size: HABIT_PAGE_SIZE,
      })
      let items = (res.items ?? []).map(normalizeHabit)

      // 「全部」或「活跃」视图才需要今日进度；「已归档」视图拉 today 无意义
      if (!status || status === 'active') {
        try {
          const todayRes = await habitApi.getTodayHabits()
          const todayMap = new Map<string, { count?: number; completed?: boolean }>()
          for (const t of todayRes.items ?? []) {
            todayMap.set(t.id, { count: t.today_count, completed: t.today_completed })
          }
          items = items.map((h) => {
            const td = todayMap.get(h.id)
            if (!td) return h
            const completed = td.completed ?? false
            return {
              ...h,
              today_count: td.count ?? 0,
              today_completed: completed,
              today_done: completed,
            }
          })
        } catch (e) {
          // 优雅降级：今日接口不可用不影响列表
          // eslint-disable-next-line no-console
          console.warn('[HabitStore] merge today habits failed, degraded', e)
        }
      }

      habits.value = items
    } catch (e) {
      habits.value = []
      // eslint-disable-next-line no-console
      console.error('[HabitStore] fetchHabits failed', e)
    } finally {
      loading.value = false
    }
  }

  /** 设置状态筛选（调用方负责随后 fetchHabits） */
  function setStatusFilter(s: HabitStatus | ''): void {
    statusFilter.value = s
  }

  /** 设置分类筛选（纯客户端过滤，无需重新请求） */
  function setCategoryFilter(c: HabitCategory | ''): void {
    categoryFilter.value = c
  }

  /** 创建习惯 */
  async function createHabit(data: CreateHabitReq): Promise<Habit | null> {
    try {
      const habit = normalizeHabit(await habitApi.create(data))
      // created 响应不含 today_*，补上默认进度
      habits.value.unshift({
        ...habit,
        today_count: 0,
        today_completed: false,
        today_done: false,
      })
      return habit
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[HabitStore] createHabit failed', e)
      return null
    }
  }

  /** 更新习惯（乐观 + 回滚） */
  async function updateHabit(id: string, data: UpdateHabitReq): Promise<Habit | null> {
    const idx = habits.value.findIndex((h) => h.id === id)
    if (idx === -1) {
      try {
        return normalizeHabit(await habitApi.update(id, data))
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('[HabitStore] updateHabit failed', e)
        return null
      }
    }
    const original = { ...habits.value[idx] } as Habit
    const optimistic: Habit = { ...original, ...data, updated_at: nowISO() }
    habits.value[idx] = optimistic
    try {
      const real = normalizeHabit(await habitApi.update(id, data))
      const cur = habits.value.findIndex((h) => h.id === id)
      // update 响应同样不含 today_*，用乐观值补齐今日进度
      if (cur >= 0) {
        habits.value[cur] = {
          ...real,
          today_count: optimistic.today_count,
          today_completed: optimistic.today_completed,
          today_done: optimistic.today_done,
        }
      }
      return real
    } catch (e) {
      const cur = habits.value.findIndex((h) => h.id === id)
      if (cur >= 0) habits.value[cur] = original
      showFailToast('更新失败，请重试')
      // eslint-disable-next-line no-console
      console.error('[HabitStore] updateHabit rolled back', e)
      return null
    }
  }

  /** 删除习惯（乐观 + 回滚） */
  async function deleteHabit(id: string): Promise<boolean> {
    const idx = habits.value.findIndex((h) => h.id === id)
    if (idx === -1) return false
    const original = habits.value[idx]
    habits.value.splice(idx, 1)
    try {
      await habitApi.delete(id)
      feedback.destructiveDone('习惯已删除')
      return true
    } catch (e) {
      habits.value.splice(Math.min(idx, habits.value.length), 0, original)
      showFailToast('删除失败，请重试')
      // eslint-disable-next-line no-console
      console.error('[HabitStore] deleteHabit rolled back', e)
      return false
    }
  }

  /**
   * 打卡（核心：乐观 + 正确合并返回值）
   *
   * @param id   习惯 id
   * @param data `date`（YYYY-MM-DD，必填）、`count`（默认 1）、`note`、`duration_minutes`
   *
   * ⚠️ 后端 Log 返回的 habit **不含 today_count / today_completed**，
   *    所以不能整体覆盖，只能合并 streak 四件套 + 保留乐观今日进度。
   */
  async function logHabit(id: string, data: LogHabitReq): Promise<Habit | null> {
    const idx = habits.value.findIndex((h) => h.id === id)
    if (idx === -1) {
      try {
        return normalizeHabit(await habitApi.log(id, data))
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('[HabitStore] logHabit failed', e)
        return null
      }
    }

    const snapshot = { ...habits.value[idx] } as Habit
    const target = snapshot.target_count || 1
    const addCount = data.count ?? 1
    const wasDone = !!(snapshot.today_done ?? snapshot.today_completed)
    const nextCount = (snapshot.today_count ?? 0) + addCount
    const nowDone = nextCount >= target

    // 乐观：累加今日进度
    habits.value[idx] = {
      ...snapshot,
      today_count: nextCount,
      today_completed: nowDone,
      today_done: nowDone,
    }

    try {
      const real = normalizeHabit(await habitApi.log(id, data))
      const cur = habits.value.findIndex((h) => h.id === id)
      if (cur >= 0) {
        const prev = habits.value[cur]
        // 保留乐观的今日进度，只取回 streak 统计（后端已重算落库）
        habits.value[cur] = {
          ...prev,
          current_streak: real.current_streak,
          longest_streak: real.longest_streak,
          last_check_in_date: real.last_check_in_date,
          total_check_ins: real.total_check_ins,
        }
      }
      return real
    } catch (e) {
      const cur = habits.value.findIndex((h) => h.id === id)
      if (cur >= 0) habits.value[cur] = snapshot
      showFailToast('打卡失败，请重试')
      // eslint-disable-next-line no-console
      console.error('[HabitStore] logHabit rolled back', e)
      return null
    }
  }

  /** 根据 id 查找 */
  function findById(id: string): Habit | undefined {
    return habits.value.find((h) => h.id === id)
  }

  /** 重置 */
  function reset(): void {
    habits.value = []
    loading.value = false
    statusFilter.value = ''
    categoryFilter.value = ''
  }

  // ===== 桌面端同名的别名（新代码建议用这四个，语义更贴桌面端）=====
  const create = createHabit
  const update = updateHabit
  const remove = deleteHabit
  const checkIn = logHabit
  const fetchList = fetchHabits

  return {
    // state
    habits,
    loading,
    statusFilter,
    categoryFilter,
    // getters
    isEmpty,
    filteredHabits,
    activeHabits,
    total,
    totalCount,
    todayDone,
    todayTotal,
    todayCheckIns,
    doneCount,
    todayRate,
    bestStreak,
    longestStreak,
    // actions
    fetchHabits,
    fetchList,
    setStatusFilter,
    setCategoryFilter,
    createHabit,
    create,
    updateHabit,
    update,
    deleteHabit,
    remove,
    logHabit,
    checkIn,
    findById,
    reset,
  }
})
