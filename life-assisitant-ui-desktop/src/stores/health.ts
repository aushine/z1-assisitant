/**
 * Health Store（健康，记录模块的第 3 个维度）
 *
 * SYNC-FROM-BACKEND: life-assisitant-api/internal/controller/health.go
 *                    life-assisitant-api/internal/model/dto/health.go
 * SYNC-FROM-MOBILE:  life-assisitant-ui-mobile/src/stores/health.ts
 * 最后同步：2026-09-19（整体覆盖语义的「取回→合并→整体提交」封装在 saveDay）
 *
 * 缓存策略（刻意不做持久化，业务数据每次进模块拉一次）：
 *   - prediction   → 写操作后由**响应直接替换**（少一次请求，不闪旧数据）
 *   - calendar     → 按 month 缓存；写后强制刷新当月；cycles_changed 清空全部
 *   - dayDetail    → 不缓存（按需拉）
 *   - settings     → 进入模块一次；PATCH 后由响应替换
 *
 * ⚠️ 整体覆盖语义（PUT /health/days/:date）是本项目最重要的一致性约束：
 *    「没给的字段置未记录」，但 period / moods 整体不传 = 不触碰既有行。
 *    因此 saveDay 内部**必须先取回当天完整记录、合并后再整体提交**，
 *    否则快捷条（只改饮水）会抹掉当天其它指标。页面一律走 saveDay，不各自拼装。
 *
 * ⚠️ 前端不做任何预测计算：阶段、日期、区间一律渲染后端返回的 prediction。
 */
import { create } from 'zustand'
import { Toast } from '@douyinfe/semi-ui'
import { healthApi } from '@/api/health'
import type {
  CreateHealthEventReq,
  HealthCalendarResp,
  HealthDayDetail,
  HealthDayDetailResp,
  HealthEventDaySummary,
  HealthEventItem,
  HealthMoodBlock,
  HealthOverviewResp,
  HealthPeriodBlock,
  HealthSettings,
  HealthSetupReq,
  PatchHealthEventReq,
  PatchHealthSettingsReq,
  PeriodPrediction,
} from '@/api/types'

/** 本地时区当天日期 YYYY-MM-DD */
function todayDate(d: Date = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 一条空的当天记录（取回不到时使用，保证整体提交时其它块是「未记录」而非 undefined） */
function emptyDay(date: string): HealthDayDetail {
  return {
    date,
    water_ml: 0,
    weight_kg: null,
    bbt: null,
    sleep_hours: null,
    bowel_count: 0,
    bowel_type: 0,
    period: { flow: 0, symptoms: [], pain_level: 0, discharge: 0, intercourse: 0 },
    moods: { mood: 0, energy: 0, note: '' },
  }
}

interface HealthStore {
  // ==================== state ====================
  initialized: boolean
  today: string
  settings: HealthSettings | null
  todayLog: HealthDayDetail | null
  todayProgress: { recorded: number; enabled: number }
  cards: import('@/api/types').HealthCard[]
  monthSummary: import('@/api/types').HealthMonthSummary | null
  prediction: PeriodPrediction | null

  /** 选中日期（默认今天），记录浮层/快捷条以此为准 */
  selectedDate: string
  /** 月历缓存：month(YYYY-MM) → 响应 */
  calendarCache: Record<string, HealthCalendarResp>
  /** 当前展示的月份 */
  calendarMonth: string

  loading: boolean
  saving: boolean
  /** 概览是否已经成功拉过一次（避免引导跳转误判） */
  loaded: boolean
  /** 本次会话用户点了引导向导的「跳过」（仅内存，刷新即失效） */
  setupSkipped: boolean

  /* ===== 时间轴事件（health_events） =====
   * 身体指标一天可记 N 次、每次带时间点、**不延续**（与心情的向前延续相反）；
   * 经期块 / 心情块 / 备注仍是一天一张，走 saveDay。
   * ⚠️ 两个写入口都改同一天的展示数据，任一写成功都要刷新 overview + 当月日历。 */
  dayEvents: HealthEventItem[]
  daySummary: HealthEventDaySummary | null
  eventsLoading: boolean

  // ==================== getters ====================
  /** 是否处于「从没初始化过」→ 需要走引导（跳过态下不算需要引导） */
  needSetup: () => boolean
  /** 当前启用的指标（按 order 规整后的 key 列表） */
  enabledMetrics: () => string[]

  // ==================== actions ====================
  fetchOverview: (date?: string) => Promise<HealthOverviewResp | null>
  fetchCalendar: (month: string, force?: boolean) => Promise<HealthCalendarResp | null>
  invalidateCalendar: () => void
  fetchDay: (date: string) => Promise<HealthDayDetailResp | null>
  saveDay: (date: string, patch: Partial<HealthDayDetail>) => Promise<boolean>
  deleteDay: (date: string) => Promise<boolean>
  fetchSettings: () => Promise<HealthSettings | null>
  patchSettings: (data: PatchHealthSettingsReq) => Promise<boolean>
  setup: (data: HealthSetupReq) => Promise<boolean>
  skipSetup: () => void
  resetLocal: () => void
  fetchDayEvents: (date: string) => Promise<HealthEventItem[]>
  /** 事件写成功后统一刷新（概览 + 当月日历 + 当天时间轴） */
  refreshAfterEvent: (date: string) => Promise<void>
  addEvent: (data: CreateHealthEventReq, opts?: { silent?: boolean }) => Promise<boolean>
  editEvent: (id: string, data: Omit<PatchHealthEventReq, 'id'>) => Promise<boolean>
  removeEvent: (id: string, date: string) => Promise<boolean>
}

export const useHealthStore = create<HealthStore>((set, get) => ({
  // ==================== state ====================
  initialized: false,
  today: '',
  settings: null,
  todayLog: null,
  todayProgress: { recorded: 0, enabled: 0 },
  cards: [],
  monthSummary: null,
  prediction: null,
  selectedDate: todayDate(),
  calendarCache: {},
  calendarMonth: '',
  loading: false,
  saving: false,
  loaded: false,
  setupSkipped: false,
  dayEvents: [],
  daySummary: null,
  eventsLoading: false,

  // ==================== getters ====================
  needSetup: () => get().loaded && !get().initialized && !get().setupSkipped,
  enabledMetrics: () => get().settings?.metrics_enabled ?? [],

  // ==================== actions ====================
  async fetchOverview(date?: string) {
    set({ loading: true })
    try {
      const res = await healthApi.getOverview(date ? { date } : undefined)
      set({
        initialized: res.initialized,
        today: res.today,
        settings: res.settings,
        todayLog: res.today_log,
        todayProgress: res.today_progress,
        cards: res.cards,
        monthSummary: res.month_summary,
        prediction: res.prediction ?? null,
        loaded: true,
      })
      return res
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[HealthStore] fetchOverview failed', e)
      set({ loaded: true })
      return null
    } finally {
      set({ loading: false })
    }
  },

  async fetchCalendar(month: string, force = false) {
    set({ calendarMonth: month })
    const cache = get().calendarCache
    if (!force && cache[month]) return cache[month]
    try {
      const res = await healthApi.getCalendar({ month })
      set({ calendarCache: { ...get().calendarCache, [month]: res } })
      // 月历响应里也带 prediction（切月后概览一并刷新）
      if (res.prediction) set({ prediction: res.prediction })
      return res
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[HealthStore] fetchCalendar failed', e)
      return null
    }
  },

  invalidateCalendar() {
    set({ calendarCache: {} })
  },

  async fetchDay(date: string) {
    try {
      return await healthApi.getDay(date)
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[HealthStore] fetchDay failed', e)
      return null
    }
  },

  /**
   * 保存某天记录（整体覆盖语义的核心封装）。
   * 流程：取回当天完整记录 → 合并 patch → 整体提交 → 刷新 overview + 当月日历。
   *
   * ⚠️ patch 只传要改的字段即可；period / moods 子块**缺省不传**时沿用既有行，
   *    传了则整块覆盖（记录浮层走整块覆盖，快捷条只传标量字段不碰子块）。
   *
   * @returns 是否成功
   */
  async saveDay(date: string, patch: Partial<HealthDayDetail>) {
    set({ saving: true })
    try {
      // 1) 取回当天完整记录（这是整体覆盖语义不抹数据的前提）
      const res = await healthApi.getDay(date)
      const base = res?.day ?? emptyDay(date)
      // 2) 合并：标量字段覆盖，period/moods 子块整体覆盖或沿用
      const merged: HealthDayDetail = {
        ...base,
        ...patch,
        period: (patch.period as HealthPeriodBlock | undefined) ?? base.period,
        moods: (patch.moods as HealthMoodBlock | undefined) ?? base.moods,
      }
      // 3) 整体提交
      const saveRes = await healthApi.upsertDay(date, merged)

      if (saveRes.prediction) set({ prediction: saveRes.prediction })
      if (saveRes.cycles_changed) get().invalidateCalendar()
      if (date === get().today) set({ todayLog: saveRes.day })

      // 4) 成功后刷新 overview + 当月日历（保证概览卡/完成度/月历同步）
      await get().fetchOverview()
      if (get().calendarMonth) await get().fetchCalendar(get().calendarMonth, true)

      Toast.success('已记录')
      return true
    } catch (e) {
      // 失败：清掉陈旧数据，避免展示与后端不一致的本地值
      if (date === get().today) set({ todayLog: null })
      // eslint-disable-next-line no-console
      console.error('[HealthStore] saveDay failed', e)
      Toast.error('保存失败，请重试')
      return false
    } finally {
      set({ saving: false })
    }
  },

  async deleteDay(date: string) {
    set({ saving: true })
    try {
      await healthApi.deleteDay(date)
      get().invalidateCalendar()
      // 删除接口无响应体，只能重拉
      const res = await healthApi.getOverview()
      set({
        initialized: res.initialized,
        today: res.today,
        settings: res.settings,
        todayLog: res.today_log,
        todayProgress: res.today_progress,
        cards: res.cards,
        monthSummary: res.month_summary,
        prediction: res.prediction ?? null,
      })
      Toast.success('已删除')
      return true
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[HealthStore] deleteDay failed', e)
      Toast.error('删除失败，请重试')
      return false
    } finally {
      set({ saving: false })
    }
  },

  async fetchSettings() {
    try {
      const s = await healthApi.getSettings()
      set({ settings: s })
      return s
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[HealthStore] fetchSettings failed', e)
      return null
    }
  },

  async patchSettings(data: PatchHealthSettingsReq) {
    set({ saving: true })
    try {
      const s = await healthApi.patchSettings(data)
      set({ settings: s })
      // 指标/目标变化会影响概览卡与完成度，顺手刷新
      await get().fetchOverview()
      Toast.success('已保存')
      return true
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[HealthStore] patchSettings failed', e)
      Toast.error('保存失败，请重试')
      return false
    } finally {
      set({ saving: false })
    }
  },

  async setup(data: HealthSetupReq) {
    set({ saving: true })
    try {
      const res = await healthApi.setup(data)
      set({ settings: res.settings })
      if (res.prediction) set({ prediction: res.prediction })
      set({ initialized: true, setupSkipped: false })
      get().invalidateCalendar()
      await get().fetchOverview()
      Toast.success('健康模块已开启')
      return true
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[HealthStore] setup failed', e)
      Toast.error('保存失败，请重试')
      return false
    } finally {
      set({ saving: false })
    }
  },

  skipSetup() {
    set({ setupSkipped: true })
  },

  /* ==================== events 读写 ==================== */

  async fetchDayEvents(date: string) {
    set({ eventsLoading: true })
    try {
      const res = await healthApi.listEvents({ date })
      set({ dayEvents: res.items ?? [], daySummary: res.summary ?? null })
      return get().dayEvents
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[HealthStore] fetchDayEvents failed', e)
      set({ dayEvents: [], daySummary: null })
      return []
    } finally {
      set({ eventsLoading: false })
    }
  },

  /** 事件写成功后统一刷新（概览卡 + 当月日历 + 当天时间轴） */
  async refreshAfterEvent(date: string) {
    await get().fetchOverview()
    const m = get().calendarMonth
    if (m) await get().fetchCalendar(m, true)
    await get().fetchDayEvents(date)
  },

  /**
   * 追加一次记录。
   * ⚠️ time 不传 = 服务端当前时刻，前端**不要**自己算（客户端时钟可能不准 / 跨时区）。
   */
  async addEvent(data: CreateHealthEventReq, opts?: { silent?: boolean }) {
    set({ saving: true })
    try {
      const res = await healthApi.createEvent(data)
      if (res.day !== undefined && data.date === get().today) set({ todayLog: res.day })
      await get().refreshAfterEvent(data.date)
      // ⚠️ 高频操作（如概览卡「＋ 喝一杯」）不弹成功 toast，就地反馈即可
      if (!opts?.silent) Toast.success('已记录')
      return true
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[HealthStore] addEvent failed', e)
      Toast.error('保存失败，请重试')
      return false
    } finally {
      set({ saving: false })
    }
  },

  async editEvent(id: string, data: Omit<PatchHealthEventReq, 'id'>) {
    set({ saving: true })
    try {
      const res = await healthApi.patchEvent(id, data)
      if (res.day !== undefined && res.item?.date === get().today) set({ todayLog: res.day })
      await get().refreshAfterEvent(res.item?.date ?? get().selectedDate)
      Toast.success('已更新')
      return true
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[HealthStore] editEvent failed', e)
      Toast.error('保存失败，请重试')
      return false
    } finally {
      set({ saving: false })
    }
  },

  async removeEvent(id: string, date: string) {
    set({ saving: true })
    try {
      await healthApi.deleteEvent(id)
      await get().refreshAfterEvent(date)
      Toast.success('已删除')
      return true
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[HealthStore] removeEvent failed', e)
      Toast.error('删除失败，请重试')
      return false
    } finally {
      set({ saving: false })
    }
  },

  resetLocal() {
    set({
      initialized: false,
      today: '',
      settings: null,
      todayLog: null,
      todayProgress: { recorded: 0, enabled: 0 },
      cards: [],
      monthSummary: null,
      prediction: null,
      selectedDate: todayDate(),
      calendarCache: {},
      calendarMonth: '',
      loading: false,
      saving: false,
      loaded: false,
      setupSkipped: false,
      dayEvents: [],
      daySummary: null,
      eventsLoading: false,
    })
  },
}))

export default useHealthStore
