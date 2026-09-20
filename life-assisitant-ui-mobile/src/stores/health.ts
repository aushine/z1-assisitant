/**
 * Health Store（健康，记录模块的第 3 个维度）
 *
 * SYNC-FROM-BACKEND: life-assisitant-api/internal/controller/health.go
 * 契约文档：md/spec-20260919-v1/05-API规范.md（health 段）
 *
 * 缓存策略（与经期 store 同构，业务数据每次进模块拉一次，不持久化）：
 *   - prediction   → 写操作后由响应直接替换（少一次请求，不闪旧数据）
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
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { showFailToast, showSuccessToast } from 'vant'
import { healthApi } from '@/api/health'
import { todayDate } from '@/utils/date'
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

export const useHealthStore = defineStore('health', () => {
  // ==================== state ====================
  const initialized = ref(false)
  const today = ref('')
  const settings = ref<HealthSettings | null>(null)
  /** 今日完整记录（用于快捷条/概览） */
  const todayLog = ref<HealthDayDetail | null>(null)
  /** 今日完成度 */
  const todayProgress = ref<{ recorded: number; enabled: number }>({ recorded: 0, enabled: 0 })
  /** 概览卡列表（后端返回顺序即渲染顺序） */
  const cards = ref<HealthOverviewResp['cards']>([])
  /** 月摘要条 */
  const monthSummary = ref<HealthOverviewResp['month_summary'] | null>(null)
  const prediction = ref<PeriodPrediction | null>(null)

  /** 选中日期（默认今天），记录浮层/快捷条以此为准 */
  const selectedDate = ref<string>(todayDate())

  /** 月历缓存：month(YYYY-MM) → 响应 */
  const calendarCache = ref<Record<string, HealthCalendarResp>>({})
  /** 当前展示的月份 */
  const calendarMonth = ref('')

  const loading = ref(false)
  const saving = ref(false)
  /** 概览是否已经成功拉过一次（避免引导跳转误判） */
  const loaded = ref(false)

  /* ==================== 时间轴事件（health_events） ====================
   * 身体指标（water / bbt / weight / sleep / bowel）一天可记 N 次、每次带时间点、
   * **不延续**；经期块 / 心情块 / 备注仍是一天一张，走 saveDay。
   * ⚠️ 两个写入口都改同一天的展示数据，所以任一写成功都要刷新 overview + 当月日历。
   */
  /** 当前 selectedDate 那天的事件（按时间升序，后端保证） */
  const dayEvents = ref<HealthEventItem[]>([])
  /** 当天从 events 聚合出的汇总（水总量 / 排便次数 / 晨起体温 …） */
  const daySummary = ref<HealthEventDaySummary | null>(null)
  const eventsLoading = ref(false)

  /**
   * 本次会话里用户点了引导向导的「跳过」。
   * 设计：跳过**不写**任何后端状态（否则「跳过→立刻被推回引导」死循环），
   * 只在内存标记；刷新页面即失效，下次进入照常弹引导（正是设计要的行为）。
   */
  const setupSkipped = ref(false)

  // ==================== getters ====================
  /** 是否处于「从没初始化过」→ 需要走引导（跳过态下不算需要引导） */
  const needSetup = computed(
    () => loaded.value && !initialized.value && !setupSkipped.value,
  )

  /** 当前启用的指标（按 order 规整后的 key 列表） */
  const enabledMetrics = computed(() => settings.value?.metrics_enabled ?? [])

  // ==================== actions ====================

  /** 拉概览（进入模块 / 引导后调用） */
  async function fetchOverview(date?: string): Promise<HealthOverviewResp | null> {
    loading.value = true
    try {
      const res = await healthApi.overview(date)
      initialized.value = res.initialized
      today.value = res.today
      settings.value = res.settings
      todayLog.value = res.today_log
      todayProgress.value = res.today_progress
      cards.value = res.cards
      monthSummary.value = res.month_summary
      prediction.value = res.prediction ?? null
      loaded.value = true
      return res
    } catch (e) {
      // 读取失败不弹 toast（页面自己渲染错误态），但清掉陈旧数据
      // eslint-disable-next-line no-console
      console.error('[HealthStore] fetchOverview failed', e)
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
  async function fetchCalendar(month: string, force = false): Promise<HealthCalendarResp | null> {
    calendarMonth.value = month
    if (!force && calendarCache.value[month]) return calendarCache.value[month]
    try {
      const res = await healthApi.calendar(month)
      calendarCache.value = { ...calendarCache.value, [month]: res }
      // 月历响应里也带 prediction（切月后概览一并刷新）
      if (res.prediction) prediction.value = res.prediction
      return res
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[HealthStore] fetchCalendar failed', e)
      return null
    }
  }

  /** 清空月历缓存（周期划分变化后必须调用） */
  function invalidateCalendar(): void {
    calendarCache.value = {}
  }

  /** 取某天日记（打开记录浮层时用） */
  async function fetchDay(date: string): Promise<HealthDayDetailResp | null> {
    try {
      return await healthApi.getDay(date)
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[HealthStore] fetchDay failed', e)
      return null
    }
  }

  /**
   * 保存某天记录（整体覆盖语义的核心封装）。
   * 流程：取回当天完整记录 → 合并 patch → 整体提交 → 刷新 overview + 当月日历。
   *
   * ⚠️ patch 只传要改的字段即可；period / moods 子块**缺省不传**时沿用既有行，
   *    传了则整块覆盖（记录浮层走整块覆盖，快捷条只传标量字段不碰子块）。
   *
   * @returns 是否成功
   */
  async function saveDay(date: string, patch: Partial<HealthDayDetail>): Promise<boolean> {
    saving.value = true
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

      if (saveRes.prediction) prediction.value = saveRes.prediction
      if (saveRes.cycles_changed) invalidateCalendar()
      if (date === today.value) todayLog.value = saveRes.day

      // 4) 成功后刷新 overview + 当月日历（保证概览卡/完成度/月历同步）
      await fetchOverview()
      if (calendarMonth.value) await fetchCalendar(calendarMonth.value, true)

      showSuccessToast('已记录')
      return true
    } catch (e) {
      // 失败：清掉陈旧数据，避免展示与后端不一致的本地值
      if (date === today.value) todayLog.value = null
      // eslint-disable-next-line no-console
      console.error('[HealthStore] saveDay failed', e)
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
      await healthApi.deleteDay(date)
      invalidateCalendar()
      // 删除接口无响应体，只能重拉
      const res = await healthApi.overview()
      initialized.value = res.initialized
      today.value = res.today
      settings.value = res.settings
      todayLog.value = res.today_log
      todayProgress.value = res.today_progress
      cards.value = res.cards
      monthSummary.value = res.month_summary
      prediction.value = res.prediction ?? null
      showSuccessToast('已删除')
      return true
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[HealthStore] deleteDay failed', e)
      showFailToast('删除失败，请重试')
      return false
    } finally {
      saving.value = false
    }
  }

  /** 取设置 */
  async function fetchSettings(): Promise<HealthSettings | null> {
    try {
      settings.value = await healthApi.getSettings()
      return settings.value
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[HealthStore] fetchSettings failed', e)
      return null
    }
  }

  /** 更新设置（响应替换本地值） */
  async function patchSettings(data: PatchHealthSettingsReq): Promise<boolean> {
    saving.value = true
    try {
      settings.value = await healthApi.patchSettings(data)
      // 指标/目标变化会影响概览卡与完成度，顺手刷新
      await fetchOverview()
      showSuccessToast('已保存')
      return true
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[HealthStore] patchSettings failed', e)
      showFailToast('保存失败，请重试')
      return false
    } finally {
      saving.value = false
    }
  }

  /** 引导向导提交（一次性） */
  async function setup(data: HealthSetupReq): Promise<boolean> {
    saving.value = true
    try {
      const res = await healthApi.setup(data)
      settings.value = res.settings
      if (res.prediction) prediction.value = res.prediction
      initialized.value = true
      setupSkipped.value = false
      invalidateCalendar()
      await fetchOverview()
      showSuccessToast('健康模块已开启')
      return true
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[HealthStore] setup failed', e)
      showFailToast('保存失败，请重试')
      return false
    } finally {
      saving.value = false
    }
  }

  /* ==================== events 读写 ==================== */

  /** 拉某天的事件时间轴（打开记录浮层 / 切日期时调） */
  async function fetchDayEvents(date: string): Promise<HealthEventItem[]> {
    eventsLoading.value = true
    try {
      const res = await healthApi.listEvents({ date })
      dayEvents.value = res.items ?? []
      daySummary.value = res.summary ?? null
      return dayEvents.value
    } catch (e) {
      dayEvents.value = []
      daySummary.value = null
      // eslint-disable-next-line no-console
      console.error('[HealthStore] fetchDayEvents failed', e)
      return []
    } finally {
      eventsLoading.value = false
    }
  }

  /** 事件写成功后统一刷新（概览卡 + 当月日历 + 当天时间轴） */
  async function refreshAfterEvent(date: string): Promise<void> {
    await fetchOverview()
    if (calendarMonth.value) await fetchCalendar(calendarMonth.value, true)
    await fetchDayEvents(date)
  }

  /**
   * 追加一次记录。
   * ⚠️ time 不传 = 服务端当前时刻，前端**不要**自己算（客户端时钟可能不准 / 跨时区）。
   * @param silent 为 true 时成功不弹 toast（高频就地操作如「喝一杯」用，见 02 §16.5）
   */
  async function addEvent(data: CreateHealthEventReq, silent = false): Promise<boolean> {
    saving.value = true
    try {
      const res = await healthApi.createEvent(data)
      if (res.day !== undefined) todayLog.value = res.day
      await refreshAfterEvent(data.date)
      if (!silent) showSuccessToast('已记录')
      return true
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[HealthStore] addEvent failed', e)
      showFailToast('保存失败，请重试')
      return false
    } finally {
      saving.value = false
    }
  }

  /** 改一次记录（date / metric_key 不可改） */
  async function editEvent(id: string, data: Omit<PatchHealthEventReq, 'id'>): Promise<boolean> {
    saving.value = true
    try {
      const res = await healthApi.patchEvent(id, data)
      if (res.day !== undefined) todayLog.value = res.day
      await refreshAfterEvent(res.item?.date ?? selectedDate.value)
      showSuccessToast('已更新')
      return true
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[HealthStore] editEvent failed', e)
      showFailToast('保存失败，请重试')
      return false
    } finally {
      saving.value = false
    }
  }

  /** 删一次记录（204，无响应体 → 必须自己重拉） */
  async function removeEvent(id: string, date: string): Promise<boolean> {
    saving.value = true
    try {
      await healthApi.deleteEvent(id)
      await refreshAfterEvent(date)
      showSuccessToast('已删除')
      return true
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[HealthStore] removeEvent failed', e)
      showFailToast('删除失败，请重试')
      return false
    } finally {
      saving.value = false
    }
  }

  /** 引导向导「跳过」（仅本次会话有效，不写后端） */
  function skipSetup(): void {
    setupSkipped.value = true
  }

  /** 退出登录 / 切账号时清理 */
  function resetLocal(): void {
    initialized.value = false
    today.value = ''
    settings.value = null
    todayLog.value = null
    todayProgress.value = { recorded: 0, enabled: 0 }
    cards.value = []
    monthSummary.value = null
    prediction.value = null
    selectedDate.value = todayDate()
    calendarCache.value = {}
    calendarMonth.value = ''
    loading.value = false
    saving.value = false
    loaded.value = false
    setupSkipped.value = false
    dayEvents.value = []
    daySummary.value = null
    eventsLoading.value = false
  }

  return {
    // state
    initialized,
    today,
    settings,
    todayLog,
    todayProgress,
    cards,
    monthSummary,
    prediction,
    selectedDate,
    calendarCache,
    calendarMonth,
    loading,
    saving,
    loaded,
    setupSkipped,
    dayEvents,
    daySummary,
    eventsLoading,
    // getters
    needSetup,
    enabledMetrics,
    // actions
    fetchOverview,
    fetchCalendar,
    invalidateCalendar,
    fetchDay,
    saveDay,
    deleteDay,
    fetchSettings,
    patchSettings,
    setup,
    skipSetup,
    resetLocal,
    fetchDayEvents,
    addEvent,
    editEvent,
    removeEvent,
  }
})
