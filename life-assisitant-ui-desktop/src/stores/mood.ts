import { create } from 'zustand'
import { Toast } from '@douyinfe/semi-ui'
import { moodApi } from '@/api/mood'
import type {
  MoodHourItem,
  MoodTimelineResp,
  MoodUpsertReq,
  MoodUpsertResp,
  MoodValue,
  EnergyValue,
} from '@/api/types'

/**
 * 心情 / 精力 Store（按小时记录）
 *
 * SYNC-FROM-BACKEND: life-assisitant-api/internal/controller/mood.go
 *                    life-assisitant-api/internal/model/dto/mood.go
 * SYNC-FROM-MOBILE:  life-assisitant-ui-mobile/src/stores/mood.ts
 * 最后同步：2026-09-19（按小时记录；一天可多条，心情/精力向前延续，备注每小时一刷）
 *
 * 语义约定（与后端 + 移动端一致）：
 *   - mood 1-5（很差/低落/一般/不错/很好），0 = 该小时不填（显示时回落到延续值）
 *   - energy 1-3（疲惫/一般/充沛），0 = 不填
 *   - note ≤50 字，不延续，只属于写下它的那个小时
 *   - PUT /moods 三态语义：字段缺省 = 不动；0 / '' = 显式清空；全空 → 后端删行
 *
 * 使用方：
 *   - 记录页 MoodSection：fetchTimeline / upsertHour（按小时，随时可改）
 *   - 首页心情选择器 + 左下角 UserQuickPanel：current / fetchToday / setMood / setEnergy
 *     （GET /moods/today 返回当天最后一条，含向前延续填充）
 */

/** 本地时区当天日期 YYYY-MM-DD */
function todayDate(d: Date = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

interface MoodStore {
  /** 选中日期（默认今天） */
  selectedDate: string
  /** 当天最后一条（含向前延续填充）；null = 当天还没记录。首页 / 快捷面板依赖 */
  current: MoodHourItem | null
  /** 区间列表（统计页趋势用） */
  list: MoodHourItem[]
  /** 某天时间线（按小时，升序） */
  timeline: MoodTimelineResp | null
  /** 服务器当前小时 0-23（落库以此为准，区别于客户端实时钟） */
  nowHour: number

  loading: boolean
  saving: boolean
  timelineLoading: boolean
  timelineSaving: boolean

  /** 取某天最后一条（含延续填充），无记录为 null */
  fetchToday: (date?: string) => Promise<void>
  /** 取某天时间线；若拉的是今天，顺带同步 current */
  fetchTimeline: (date?: string) => Promise<void>
  /** 取区间列表（两端日期必填） */
  fetchList: (startDate: string, endDate: string) => Promise<void>
  /** 记录/修改某天某个小时，成功后强制重拉时间线；返回 null 表示失败 */
  upsertHour: (data: MoodUpsertReq) => Promise<MoodUpsertResp | null>
  /** 快捷设置心情：只发 mood（0 = 该小时不填，回落到延续值），绝不动 energy / note */
  setMood: (mood: MoodValue | 0, date?: string) => Promise<MoodUpsertResp | null>
  /** 快捷设置精力：只发 energy（0 = 该小时不填） */
  setEnergy: (energy: EnergyValue | 0, date?: string) => Promise<MoodUpsertResp | null>
  /** 保存备注（≤50 字）：只发 note */
  setNote: (note: string, date?: string) => Promise<MoodUpsertResp | null>
}

export const useMoodStore = create<MoodStore>((set, get) => ({
  selectedDate: todayDate(),
  current: null,
  list: [],
  timeline: null,
  nowHour: new Date().getHours(),

  loading: false,
  saving: false,
  timelineLoading: false,
  timelineSaving: false,

  async fetchToday(date) {
    set({ loading: true })
    try {
      const res = await moodApi.getToday(date ? { date } : undefined)
      set({ current: res ?? null, selectedDate: date ?? todayDate() })
    } catch {
      set({ current: null })
    } finally {
      set({ loading: false })
    }
  },

  async fetchTimeline(date) {
    const d = date ?? get().selectedDate
    set({ timelineLoading: true })
    try {
      const res = await moodApi.getTimeline({ date: d })
      set({
        timeline: res,
        nowHour: res.now_hour,
        selectedDate: d,
        // 拉的是今天时，用时间线最后一条同步 current（与 GET /moods/today 等价）
        current: d === todayDate() && res.items.length ? res.items[res.items.length - 1] : get().current,
      })
    } catch {
      set({ timeline: null })
    } finally {
      set({ timelineLoading: false })
    }
  },

  async fetchList(startDate, endDate) {
    set({ loading: true })
    try {
      const res = await moodApi.list({ start_date: startDate, end_date: endDate })
      set({ list: res.items ?? [] })
    } catch {
      set({ list: [] })
    } finally {
      set({ loading: false })
    }
  },

  async upsertHour(data) {
    set({ saving: true, timelineSaving: true })
    try {
      const resp = await moodApi.upsert(data)
      // 强制重拉时间线（保证拿到向前延续后的最新视图）
      await get().fetchTimeline(data.date)
      return resp
    } catch {
      Toast.error('保存失败，请重试')
      return null
    } finally {
      set({ saving: false, timelineSaving: false })
    }
  },

  async setMood(mood, date) {
    const d = date ?? get().selectedDate
    return get().upsertHour({ date: d, hour: get().nowHour, mood })
  },

  async setEnergy(energy, date) {
    const d = date ?? get().selectedDate
    return get().upsertHour({ date: d, hour: get().nowHour, energy })
  },

  async setNote(note, date) {
    const d = date ?? get().selectedDate
    return get().upsertHour({ date: d, hour: get().nowHour, note: note.slice(0, 50) })
  },
}))
