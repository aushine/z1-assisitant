/**
 * Period Store（经期）
 *
 * SYNC-FROM-MOBILE: life-assisitant-ui-mobile/src/stores/period.ts
 * SYNC-FROM-BACKEND: life-assisitant-api/internal/controller/period.go
 * 契约文档：md/spec-260919/05-API规范.md §13（缓存策略）
 *
 * 缓存策略（刻意不做持久化，业务数据每次进模块拉一次）：
 *   - prediction   → 任何写操作后由**响应直接替换**（不重新拉 overview，
 *                    少一次请求，也不会出现「先看到旧数据再跳变」）
 *   - calendar     → 按 month 缓存；写操作后若 cycles_changed = true 则清空全部月份
 *   - days 区间    → 不缓存（按需拉）
 *   - settings     → 启动/进入模块一次；PATCH 后由响应替换
 *   - masked（👁） → **不进后端、不进本 store 的业务状态**，只读写 localStorage
 *
 * ⚠️ 前端不做任何预测计算：阶段、日期、区间一律渲染后端返回的 prediction。
 */
import { create } from 'zustand'
import { Toast } from '@douyinfe/semi-ui'
import { periodApi } from '@/api/period'
import { storage } from '@/utils/storage'
import { PERIOD_MASK_STORAGE_KEY, periodCanShowDates } from '@/constants/period'
import type {
  PeriodCalendarResp,
  PeriodCycle,
  PeriodDayDetail,
  PeriodDayDetailResp,
  PeriodDayUpsertReq,
  PeriodOverviewResp,
  PeriodPhase,
  PeriodPrediction,
  PeriodSettings,
  PeriodSettingsPatchReq,
  PeriodSetupReq,
} from '@/api/types'

/** 隐私遮罩初值：设备级 localStorage（读失败一律按「不遮罩」处理，不阻断渲染） */
function readMasked(): boolean {
  try {
    return storage.getString(PERIOD_MASK_STORAGE_KEY, '0') === '1'
  } catch {
    return false
  }
}

interface PeriodStore {
  // ==================== state ====================
  initialized: boolean
  hasEnoughData: boolean
  disclaimerAccepted: boolean
  today: string
  todayLog: PeriodDayDetail | null
  prediction: PeriodPrediction | null
  settings: PeriodSettings | null
  cycles: PeriodCycle[]

  /** 月历缓存：month(YYYY-MM) → 响应 */
  calendarCache: Record<string, PeriodCalendarResp>
  /** 当前展示的月份 */
  calendarMonth: string

  loading: boolean
  saving: boolean
  /** 概览是否已经成功拉过一次（避免引导跳转误判） */
  loaded: boolean

  /** 隐私遮罩（设备级） */
  masked: boolean

  /** 本次会话已点过引导向导的「先看看」（仅内存，刷新即失效） */
  setupSkipped: boolean

  // ==================== getters ====================
  /** 是否允许展示具体日期（insufficient 一律 false —— 03 §4 最硬的一条约束） */
  canShowDates: () => boolean
  /** 是否处于「从没记录过 / 未确认免责」→ 需要走引导 */
  needSetup: () => boolean
  /** 当前阶段（后端给，前端只读） */
  phase: () => PeriodPhase | null

  // ==================== actions ====================
  fetchOverview: (date?: string) => Promise<PeriodOverviewResp | null>
  fetchCalendar: (month: string, force?: boolean) => Promise<PeriodCalendarResp | null>
  invalidateCalendar: () => void
  fetchDay: (date: string) => Promise<PeriodDayDetailResp | null>
  upsertDay: (date: string, data: Omit<PeriodDayUpsertReq, 'date'>) => Promise<boolean>
  deleteDay: (date: string) => Promise<boolean>
  fetchCycles: (limit?: number) => Promise<void>
  fetchSettings: () => Promise<PeriodSettings | null>
  patchSettings: (data: PeriodSettingsPatchReq) => Promise<boolean>
  setup: (data: PeriodSetupReq) => Promise<boolean>
  reset: () => Promise<boolean>
  toggleMasked: () => void
  skipSetup: () => void
  resetLocal: () => void
}

export const usePeriodStore = create<PeriodStore>((set, get) => ({
  // ==================== state ====================
  initialized: false,
  hasEnoughData: false,
  disclaimerAccepted: false,
  today: '',
  todayLog: null,
  prediction: null,
  settings: null,
  cycles: [],
  calendarCache: {},
  calendarMonth: '',
  loading: false,
  saving: false,
  loaded: false,
  masked: readMasked(),
  setupSkipped: false,

  // ==================== getters ====================
  canShowDates: () => periodCanShowDates(get().prediction?.confidence),
  needSetup: () => get().loaded && (!get().initialized || !get().disclaimerAccepted),
  phase: () => get().prediction?.current_cycle?.phase ?? null,

  // ==================== actions ====================
  async fetchOverview(date?: string) {
    set({ loading: true })
    try {
      const res = await periodApi.overview(date)
      set({
        initialized: res.initialized,
        hasEnoughData: res.has_enough_data,
        disclaimerAccepted: res.disclaimer_accepted,
        today: res.today,
        todayLog: res.today_log,
        prediction: res.prediction ?? null,
        settings: res.settings,
        loaded: true,
      })
      return res
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[PeriodStore] fetchOverview failed', e)
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
      const res = await periodApi.calendar(month)
      set({ calendarCache: { ...get().calendarCache, [month]: res } })
      // 月历响应里也带 prediction（切月后概览一并刷新，05 §2）
      if (res.prediction) set({ prediction: res.prediction })
      return res
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[PeriodStore] fetchCalendar failed', e)
      return null
    }
  },

  invalidateCalendar() {
    set({ calendarCache: {} })
  },

  async fetchDay(date: string) {
    try {
      return await periodApi.getDay(date)
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[PeriodStore] fetchDay failed', e)
      return null
    }
  },

  async upsertDay(date: string, data: Omit<PeriodDayUpsertReq, 'date'>) {
    set({ saving: true })
    try {
      const res = await periodApi.upsertDay(date, data)
      if (res.prediction) set({ prediction: res.prediction })
      if (res.cycles_changed) get().invalidateCalendar()
      if (date === get().today && res.day) set({ todayLog: res.day })
      Toast.success('已记录')
      return true
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[PeriodStore] upsertDay failed', e)
      return false
    } finally {
      set({ saving: false })
    }
  },

  async deleteDay(date: string) {
    set({ saving: true })
    try {
      await periodApi.deleteDay(date)
      get().invalidateCalendar()
      // 删除接口无响应体，只能重拉
      const res = await periodApi.overview()
      set({
        prediction: res.prediction ?? null,
        initialized: res.initialized,
        hasEnoughData: res.has_enough_data,
        todayLog: res.today_log,
      })
      Toast.success('已删除')
      return true
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[PeriodStore] deleteDay failed', e)
      return false
    } finally {
      set({ saving: false })
    }
  },

  async fetchCycles(limit = 12) {
    try {
      const res = await periodApi.listCycles(limit)
      set({ cycles: res.items ?? [] })
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[PeriodStore] fetchCycles failed', e)
    }
  },

  async fetchSettings() {
    try {
      const s = await periodApi.getSettings()
      set({ settings: s })
      return s
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[PeriodStore] fetchSettings failed', e)
      return null
    }
  },

  async patchSettings(data: PeriodSettingsPatchReq) {
    set({ saving: true })
    try {
      const s = await periodApi.patchSettings(data)
      set({ settings: s })
      if (data.accept_disclaimer) set({ disclaimerAccepted: true })
      Toast.success('已保存')
      return true
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[PeriodStore] patchSettings failed', e)
      return false
    } finally {
      set({ saving: false })
    }
  },

  async setup(data: PeriodSetupReq) {
    set({ saving: true })
    try {
      const res = await periodApi.setup(data)
      if (res.prediction) set({ prediction: res.prediction })
      set({ initialized: true, disclaimerAccepted: true })
      get().invalidateCalendar()
      await get().fetchSettings()
      Toast.success('已开启周期预测')
      return true
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[PeriodStore] setup failed', e)
      return false
    } finally {
      set({ saving: false })
    }
  },

  async reset() {
    set({ saving: true })
    try {
      await periodApi.reset()
      get().invalidateCalendar()
      set({ cycles: [] })
      await get().fetchOverview()
      Toast.success('已清空经期数据')
      return true
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[PeriodStore] reset failed', e)
      return false
    } finally {
      set({ saving: false })
    }
  },

  /**
   * 切换隐私遮罩（👁）。
   * 纯设备级状态：只写 localStorage，不发任何请求。
   */
  toggleMasked() {
    const next = !get().masked
    set({ masked: next })
    try {
      storage.setString(PERIOD_MASK_STORAGE_KEY, next ? '1' : '0')
    } catch {
      /* 隐私模式下写不进去也不影响本次会话 */
    }
  },

  /**
   * 引导向导「先看看」跳过（仅本次会话有效，不写后端）。
   * 设置后本会话内不再自动重开向导（04 §7.5）。
   */
  skipSetup() {
    set({ setupSkipped: true })
  },

  resetLocal() {
    set({
      initialized: false,
      hasEnoughData: false,
      disclaimerAccepted: false,
      today: '',
      todayLog: null,
      prediction: null,
      settings: null,
      cycles: [],
      calendarCache: {},
      calendarMonth: '',
      loading: false,
      saving: false,
      loaded: false,
      setupSkipped: false,
    })
  },
}))

export default usePeriodStore
