/**
 * Period Store（经期）
 *
 * SYNC-FROM-DESKTOP: life-assisitant-ui-desktop/src/stores/period.ts
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
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { showFailToast } from 'vant'
import { periodApi } from '@/api/period'
import { feedback } from '@/utils/feedback'
import {
  PERIOD_MASK_STORAGE_KEY,
  periodCanShowDates,
} from '@/constants/period'
import type {
  PeriodCalendarResp,
  PeriodCycle,
  PeriodDayDetail,
  PeriodDayDetailResp,
  PeriodDayUpsertReq,
  PeriodOverviewResp,
  PeriodPrediction,
  PeriodSettings,
  PeriodSettingsPatchReq,
  PeriodSetupReq,
} from '@/api/types'

/** 隐私遮罩初值：设备级 localStorage（读失败一律按「不遮罩」处理，不阻断渲染） */
function readMasked(): boolean {
  try {
    return window.localStorage.getItem(PERIOD_MASK_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

export const usePeriodStore = defineStore('period', () => {
  // ==================== state ====================
  const initialized = ref(false)
  const hasEnoughData = ref(false)
  const disclaimerAccepted = ref(false)
  const today = ref('')
  const todayLog = ref<PeriodDayDetail | null>(null)
  const prediction = ref<PeriodPrediction | null>(null)
  const settings = ref<PeriodSettings | null>(null)
  const cycles = ref<PeriodCycle[]>([])

  /** 月历缓存：month(YYYY-MM) → 响应 */
  const calendarCache = ref<Record<string, PeriodCalendarResp>>({})
  /** 当前展示的月份 */
  const calendarMonth = ref('')

  const loading = ref(false)
  const saving = ref(false)
  /** 概览是否已经成功拉过一次（避免引导跳转误判） */
  const loaded = ref(false)

  /**
   * 本次会话里用户点了引导向导的「先看看」。
   *
   * 设计（04 §7.5）要求跳过**不写** disclaimer_accepted_at —— 下次进来再弹。
   * 但如果不额外记一个「本次已跳过」，PeriodTab 会因为 !disclaimerAccepted
   * 立刻把用户又推回向导，形成死循环、永远看不到 Tab。
   * 这个标记**只活在内存**：刷新页面即失效，下次进入照常弹（正是设计要的行为）。
   */
  const setupSkipped = ref(false)

  /** 隐私遮罩（设备级） */
  const masked = ref(readMasked())

  /** 引导向导「先看看」跳过（仅本次会话有效，见上方注释） */
  function skipSetup(): void {
    setupSkipped.value = true
  }

  // ==================== getters ====================
  /** 是否允许展示具体日期（insufficient 一律 false —— 03 §4 最硬的一条约束） */
  const canShowDates = computed(() => periodCanShowDates(prediction.value?.confidence))

  /** 是否处于「从没记录过 / 未确认免责」→ 需要走引导 */
  const needSetup = computed(() => loaded.value && (!initialized.value || !disclaimerAccepted.value))

  /** 当前阶段（后端给，前端只读） */
  const phase = computed(() => prediction.value?.current_cycle?.phase ?? null)

  // ==================== actions ====================

  /** 拉概览（进入模块 / 引导后调用） */
  async function fetchOverview(date?: string): Promise<PeriodOverviewResp | null> {
    loading.value = true
    try {
      const res = await periodApi.overview(date)
      initialized.value = res.initialized
      hasEnoughData.value = res.has_enough_data
      disclaimerAccepted.value = res.disclaimer_accepted
      today.value = res.today
      todayLog.value = res.today_log
      prediction.value = res.prediction ?? null
      settings.value = res.settings
      loaded.value = true
      return res
    } catch (e) {
      // 读取失败不弹 toast（页面自己渲染错误态），但要清掉陈旧数据
      // eslint-disable-next-line no-console
      console.error('[PeriodStore] fetchOverview failed', e)
      loaded.value = true
      return null
    } finally {
      loading.value = false
    }
  }

  /**
   * 拉月历。已缓存的月份直接返回缓存，除非 force。
   * @param month YYYY-MM
   */
  async function fetchCalendar(month: string, force = false): Promise<PeriodCalendarResp | null> {
    calendarMonth.value = month
    if (!force && calendarCache.value[month]) return calendarCache.value[month]
    try {
      const res = await periodApi.calendar(month)
      calendarCache.value = { ...calendarCache.value, [month]: res }
      // 月历响应里也带 prediction（切月后概览一并刷新，05 §2）
      if (res.prediction) prediction.value = res.prediction
      return res
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[PeriodStore] fetchCalendar failed', e)
      return null
    }
  }

  /** 清空月历缓存（周期划分变化后必须调用） */
  function invalidateCalendar(): void {
    calendarCache.value = {}
  }

  /** 取某天日记（打开记录浮层时用） */
  async function fetchDay(date: string): Promise<PeriodDayDetailResp | null> {
    try {
      return await periodApi.getDay(date)
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[PeriodStore] fetchDay failed', e)
      return null
    }
  }

  /**
   * 写某天日记。成功后用响应里的 prediction 直接替换（不重拉 overview）。
   * @returns 是否成功
   */
  async function upsertDay(date: string, data: Omit<PeriodDayUpsertReq, 'date'>): Promise<boolean> {
    saving.value = true
    try {
      const res = await periodApi.upsertDay(date, data)
      if (res.prediction) prediction.value = res.prediction
      if (res.cycles_changed) invalidateCalendar()
      if (date === today.value) todayLog.value = res.day
      return true
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[PeriodStore] upsertDay failed', e)
      showFailToast('保存失败，请重试')
      return false
    } finally {
      saving.value = false
    }
  }

  /** 删除某天记录（后端返回 204，前端必须自己重拉概览） */
  async function deleteDay(date: string): Promise<boolean> {
    saving.value = true
    try {
      await periodApi.deleteDay(date)
      invalidateCalendar()
      // 删除接口无响应体，只能重拉
      const res = await periodApi.overview()
      prediction.value = res.prediction ?? null
      if (date === today.value) todayLog.value = res.today_log
      initialized.value = res.initialized
      hasEnoughData.value = res.has_enough_data
      feedback.destructiveDone('已删除')
      return true
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[PeriodStore] deleteDay failed', e)
      showFailToast('删除失败，请重试')
      return false
    } finally {
      saving.value = false
    }
  }

  /** 周期历史 */
  async function fetchCycles(limit = 12): Promise<void> {
    try {
      const res = await periodApi.listCycles(limit)
      cycles.value = res.items ?? []
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[PeriodStore] fetchCycles failed', e)
    }
  }

  /** 取设置 */
  async function fetchSettings(): Promise<PeriodSettings | null> {
    try {
      settings.value = await periodApi.getSettings()
      return settings.value
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[PeriodStore] fetchSettings failed', e)
      return null
    }
  }

  /** 更新设置（响应替换本地值） */
  async function patchSettings(data: PeriodSettingsPatchReq): Promise<boolean> {
    saving.value = true
    try {
      settings.value = await periodApi.patchSettings(data)
      return true
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[PeriodStore] patchSettings failed', e)
      showFailToast('保存失败，请重试')
      return false
    } finally {
      saving.value = false
    }
  }

  /** 引导向导提交 */
  async function setup(data: PeriodSetupReq): Promise<boolean> {
    saving.value = true
    try {
      const res = await periodApi.setup(data)
      if (res.prediction) prediction.value = res.prediction
      initialized.value = true
      disclaimerAccepted.value = true
      invalidateCalendar()
      await fetchSettings()
      return true
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[PeriodStore] setup failed', e)
      showFailToast('保存失败，请重试')
      return false
    } finally {
      saving.value = false
    }
  }

  /** 整模块重置（破坏性，调用方必须先二次确认） */
  async function reset(): Promise<boolean> {
    saving.value = true
    try {
      await periodApi.reset()
      invalidateCalendar()
      cycles.value = []
      await fetchOverview()
      feedback.destructiveDone('已清空经期数据')
      return true
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[PeriodStore] reset failed', e)
      showFailToast('重置失败，请重试')
      return false
    } finally {
      saving.value = false
    }
  }

  /**
   * 切换隐私遮罩（👁）。
   * 纯设备级状态：只写 localStorage，不发任何请求。
   */
  function toggleMasked(): void {
    masked.value = !masked.value
    try {
      window.localStorage.setItem(PERIOD_MASK_STORAGE_KEY, masked.value ? '1' : '0')
    } catch {
      /* 隐私模式下写不进去也不影响本次会话 */
    }
  }

  /** 退出登录 / 切账号时清理 */
  function resetLocal(): void {
    initialized.value = false
    hasEnoughData.value = false
    disclaimerAccepted.value = false
    today.value = ''
    todayLog.value = null
    prediction.value = null
    settings.value = null
    cycles.value = []
    calendarCache.value = {}
    calendarMonth.value = ''
    loading.value = false
    saving.value = false
    loaded.value = false
  }

  return {
    // state
    initialized,
    hasEnoughData,
    disclaimerAccepted,
    today,
    todayLog,
    prediction,
    settings,
    cycles,
    calendarCache,
    calendarMonth,
    loading,
    saving,
    loaded,
    masked,
    setupSkipped,
    // getters
    canShowDates,
    needSetup,
    phase,
    // actions
    fetchOverview,
    fetchCalendar,
    invalidateCalendar,
    fetchDay,
    upsertDay,
    deleteDay,
    fetchCycles,
    fetchSettings,
    patchSettings,
    setup,
    skipSetup,
    reset,
    toggleMasked,
    resetLocal,
  }
})
