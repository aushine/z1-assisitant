/**
 * Mood Store（心情 / 精力，按小时记录）
 *
 * SYNC-FROM-BACKEND: life-assisitant-api/internal/controller/mood.go
 * 最后同步：2026-09-19（改为按小时记录：一天多条，心情/精力向前延续，备注每小时一刷）
 *
 * 语义约定（与后端 + 桌面端一致）：
 *   - mood 1-5（很差/低落/一般/不错/很好），0 = 该小时不填
 *   - energy 1-3（疲惫/一般/充沛），0 = 不填
 *   - note ≤50 字，不延续，只属于写下它的那个小时
 *   - 心情/精力不更新就向前延续；备注每小时一刷
 *   - PUT /moods 三态语义：字段缺省 = 不动；0 / '' = 显式清空；全空 → 后端删行
 *
 * 设计：
 *   - 记录页 MoodSection 用 fetchTimeline / upsertHour（按小时、随时可改）
 *   - 首页紧凑 MoodPicker 仍用 current / fetchByDate / moodValue / energyValue / note
 *     （GET /moods/today 返回当天最后一条含延续填充），写入经 setMood/setEnergy/setNote
 *     走 upsertHour，且 upsert 后会刷新 current，保证首页选中态不丢。
 */
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { showFailToast } from 'vant'
import { moodApi } from '@/api/mood'
import type {
  EnergyValue,
  MoodHourItem,
  MoodTimelineResp,
  MoodUpsertReq,
  MoodUpsertResp,
  MoodValue,
} from '@/api/types'
import { todayDate } from '@/utils/date'

/**
 * 心情 / 精力档位元数据已收口到 `@/utils/mood-dict`（唯一真源，与桌面端一致）。
 * 这里只做转出，让既有 `import { MOOD_LEVELS } from '@/stores/mood'` 继续可用。
 * ⚠️ 字段已从 `emoji` 换成 `icon`（Lucide 图标名），渲染请用 <Icon :name="..." />。
 */
export { MOOD_LEVELS, ENERGY_LEVELS } from '@/utils/mood-dict'

/** 备注长度上限（后端 v:"length:0,50"） */
export const MOOD_NOTE_MAX = 50

export const useMoodStore = defineStore('mood', () => {
  // ==================== state ====================
  /** 选中日期（默认今天），点位/标签以此为准 */
  const selectedDate = ref<string>(todayDate())
  /** 该日心情（= 当天最后一条记录，含向前延续填充）；null = 当天还没记录。首页 MoodPicker 依赖此值 */
  const current = ref<MoodHourItem | null>(null)
  /** 区间列表（统计页趋势用） */
  const list = ref<MoodHourItem[]>([])
  const loading = ref(false)
  const saving = ref(false)

  // 时间线（按小时）相关
  const timeline = ref<MoodTimelineResp | null>(null)
  /** 服务器当前小时 0-23（落库/高亮以此为准，区别于客户端实时钟） */
  const nowHour = ref<number>(new Date().getHours())
  const timelineLoading = ref(false)
  const timelineSaving = ref(false)

  // ==================== getters ====================
  /** 首页用：当天是否有记录 */
  const hasRecord = computed(() => !!current.value)
  /**
   * 首页用：当前延续后的心情（1-5 / null）。
   * 0 = 确实没有心情值（延续也没延续到），对齐首页「未选择」语义 → 转 null。
   */
  const moodValue = computed<MoodValue | null>(() => {
    const m = current.value?.mood ?? 0
    return m === 0 ? null : m
  })
  /** 首页用：当前延续后的精力（1-3 / 0 表示不填） */
  const energyValue = computed<EnergyValue | 0>(() => current.value?.energy ?? 0)
  /** 首页用：当前备注（= 当天最后一条的备注，向后延续语义下即最新备注） */
  const note = computed(() => current.value?.note ?? '')

  /** 时间线最后一条（后端已向前延续填充）= 「此刻」的延续后当前值 */
  const timelineLatest = computed<MoodHourItem | null>(() => {
    const items = timeline.value?.items ?? []
    return items.length ? items[items.length - 1] : null
  })

  // ==================== actions ====================

  /** 若时间线已拉取且就是今天，用时间线最后一条作为 current（与 GET /moods/today 等价） */
  function syncCurrentFromTimeline(): void {
    if (selectedDate.value !== todayDate()) return
    const items = timeline.value?.items ?? []
    current.value = items.length ? items[items.length - 1] : null
  }

  /** 取某天心情（默认选中日；后端无记录时返回 null）。首页进入时调用。 */
  async function fetchByDate(date?: string): Promise<MoodHourItem | null> {
    const d = date ?? selectedDate.value
    loading.value = true
    try {
      const res = await moodApi.getToday(d)
      current.value = res
      selectedDate.value = d
      return res
    } catch (e) {
      // 读取失败不弹 toast（首页/记录页会渲染错误态），但要清掉陈旧数据
      current.value = null
      // eslint-disable-next-line no-console
      console.error('[MoodStore] fetchByDate failed', e)
      return null
    } finally {
      loading.value = false
    }
  }

  /** 取区间列表（两端日期必填） */
  async function fetchRange(startDate: string, endDate: string): Promise<void> {
    loading.value = true
    try {
      const res = await moodApi.list({ start_date: startDate, end_date: endDate })
      list.value = res.items ?? []
    } catch (e) {
      list.value = []
      // eslint-disable-next-line no-console
      console.error('[MoodStore] fetchRange failed', e)
    } finally {
      loading.value = false
    }
  }

  /**
   * 拉取某天时间线（force 语义：保存后必须重拉，无缓存）。
   * 若拉取的是今天，同步刷新 current（= 当天最后一条），保证首页选中态不丢。
   */
  async function fetchTimeline(date?: string): Promise<MoodTimelineResp | null> {
    const d = date ?? selectedDate.value
    timelineLoading.value = true
    try {
      const res = await moodApi.getTimeline(d)
      timeline.value = res
      nowHour.value = res.now_hour
      selectedDate.value = d
      syncCurrentFromTimeline()
      return res
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[MoodStore] fetchTimeline failed', e)
      return null
    } finally {
      timelineLoading.value = false
    }
  }

  /**
   * 记录/修改某天某个小时（点选即落库）。
   * 只发被改动的字段（三态语义：缺省 = 不动），实现「延续」。
   * 写入后强制重拉时间线并刷新 current；返回后端响应（item === null 表示已被清空删行）。
   */
  async function upsertHour(data: MoodUpsertReq): Promise<MoodUpsertResp | null> {
    const d = data.date
    timelineSaving.value = true
    saving.value = true
    try {
      const resp = await moodApi.upsert(data)
      // 强制重拉时间线（保证向前延续的最新视图）
      await fetchTimeline(d)
      syncCurrentFromTimeline()
      return resp
    } catch (e) {
      showFailToast('保存失败，请重试')
      // eslint-disable-next-line no-console
      console.error('[MoodStore] upsertHour failed', e)
      return null
    } finally {
      timelineSaving.value = false
      saving.value = false
    }
  }

  /** 兼容旧签名：upsert 透传到 upsertHour（首页 MoodPicker 经 setMood/setEnergy/setNote 走这里） */
  async function upsert(data: MoodUpsertReq): Promise<boolean> {
    const resp = await upsertHour(data)
    return resp !== null
  }

  // ---- 首页 MoodPicker 用的快捷方法（只发对应字段，绝不清空其它字段） ----

  /** 快捷设置心情（保留已有 energy/note，只改 mood）—— 首页心情区点选用。 */
  async function setMood(mood: MoodValue, date?: string): Promise<boolean> {
    const d = date ?? selectedDate.value
    return upsert({ date: d, mood })
  }

  /** 快捷设置精力（保留已有 mood/note，只改 energy）—— 首页精力区点选用。 */
  async function setEnergy(energy: EnergyValue | 0, date?: string): Promise<boolean> {
    const d = date ?? selectedDate.value
    return upsert({ date: d, energy })
  }

  /** 保存备注（≤50 字；只发 note，不动心情/精力） */
  async function setNote(noteText: string, date?: string): Promise<boolean> {
    const d = date ?? selectedDate.value
    return upsert({ date: d, note: noteText.slice(0, MOOD_NOTE_MAX) })
  }

  function reset(): void {
    selectedDate.value = todayDate()
    current.value = null
    list.value = []
    loading.value = false
    saving.value = false
    timeline.value = null
    nowHour.value = new Date().getHours()
    timelineLoading.value = false
    timelineSaving.value = false
  }

  return {
    // state
    selectedDate,
    current,
    list,
    loading,
    saving,
    timeline,
    nowHour,
    timelineLoading,
    timelineSaving,
    // getters
    hasRecord,
    moodValue,
    energyValue,
    note,
    timelineLatest,
    // actions
    fetchByDate,
    fetchRange,
    fetchTimeline,
    upsert,
    upsertHour,
    setMood,
    setEnergy,
    setNote,
    reset,
  }
})
