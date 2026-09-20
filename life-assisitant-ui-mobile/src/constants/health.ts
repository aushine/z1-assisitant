/**
 * 健康模块指标注册表与词库（前端常量）
 *
 * 依据：md/spec-20260919-v1/02 §2（指标注册表）与 03 §5（浮层卡片）
 *
 * ⚠️ SYNC 契约（三处必须逐字一致，改一处必须同改三处）：
 *   1. life-assisitant-ui-mobile/src/constants/health.ts   ← 本文件
 *   2. life-assisitant-ui-desktop/src/constants/health.ts
 *   3. life-assisitant-api/internal/utility/health_vocab.go（后端用于规范化 metrics_enabled）
 *
 * 校验手段：两份 ts 的 SHA256 必须相等；与 Go 文件逐字段对照
 * （Key / Name / Group / Order / DefaultOn / DependsOn）。
 *
 * ⚠️ 症状与分泌物的**词库**不在这里 —— 沿用 constants/period.ts（经期模块已建好），
 * 不复制第二份，否则两边迟早漂移。
 */

/** 维度分组：决定卡片左侧 3px 色条的取色（03 §2「维度色」） */
export type MetricGroup = 'cycle' | 'subjective' | 'objective' | 'privacy'

export const METRIC_GROUP_CYCLE: MetricGroup = 'cycle'
export const METRIC_GROUP_SUBJECTIVE: MetricGroup = 'subjective'
export const METRIC_GROUP_OBJECTIVE: MetricGroup = 'objective'
export const METRIC_GROUP_PRIVACY: MetricGroup = 'privacy'

/** 一项健康指标的定义 */
export interface HealthMetric {
  /** 指标唯一标识（落库在 health_settings.metrics_enabled 里） */
  key: string
  /** 中文名 */
  name: string
  group: MetricGroup
  /**
   * 卡片展示顺序（03 §2 固定顺序）。
   * ⚠️ 顺序考虑的是**填写动线**：今天发生的事实 → 身体感受 → 测量值 → 其他。
   *    不要按字母或用户配置顺序排。
   */
  order: number
  /** 是否默认启用（首次进入的默认值） */
  defaultOn: boolean
  /** 依赖的指标 key；为空表示无依赖。依赖未启用时本项自动隐藏，但**数据保留** */
  dependsOn?: string
  /**
   * 是否「预期每天都有」（02 §14.5）。
   * 用于今日完成度分母（只数 daily）与 §14.2 的分型：
   *   true  = 饮水 / 基础体温 / 体重 / 睡眠 / 心情·精力（每天该有）
   *   false = 经期(周期) / 症状 / 排便 / 分泌物 / 性生活 / 备注（不一定每天有）
   */
  daily: boolean
}

/** 指标注册表（11 项，按 Order 升序） */
export const HEALTH_METRICS: readonly HealthMetric[] = [
  { key: 'period', name: '经期', group: METRIC_GROUP_CYCLE, order: 1, defaultOn: true, daily: false },
  { key: 'symptoms', name: '症状', group: METRIC_GROUP_SUBJECTIVE, order: 2, defaultOn: true, daily: false },
  { key: 'mood', name: '心情', group: METRIC_GROUP_SUBJECTIVE, order: 3, defaultOn: true, daily: true },
  { key: 'energy_sleep', name: '精力 · 睡眠', group: METRIC_GROUP_SUBJECTIVE, order: 4, defaultOn: true, daily: true },
  { key: 'bbt', name: '基础体温', group: METRIC_GROUP_OBJECTIVE, order: 5, defaultOn: true, daily: true },
  { key: 'weight', name: '体重', group: METRIC_GROUP_OBJECTIVE, order: 6, defaultOn: true, daily: true },
  { key: 'water', name: '饮水', group: METRIC_GROUP_OBJECTIVE, order: 7, defaultOn: true, daily: true },
  { key: 'bowel', name: '排便', group: METRIC_GROUP_OBJECTIVE, order: 8, defaultOn: true, daily: false },
  {
    key: 'discharge',
    name: '分泌物',
    group: METRIC_GROUP_CYCLE,
    order: 9,
    defaultOn: true,
    dependsOn: 'period',
    daily: false,
  },
  // 性生活**默认关**：它是最私密的一项，不替用户做默认开启的决定
  { key: 'sex', name: '性生活', group: METRIC_GROUP_PRIVACY, order: 10, defaultOn: false, daily: false },
  { key: 'note', name: '备注', group: METRIC_GROUP_SUBJECTIVE, order: 11, defaultOn: true, daily: false },
]

/** 默认启用的指标 key（02 §2「默认」列） */
export const DEFAULT_ENABLED_METRICS: readonly string[] = HEALTH_METRICS.filter(
  (m) => m.defaultOn,
).map((m) => m.key)

const METRIC_INDEX: Record<string, HealthMetric> = HEALTH_METRICS.reduce<
  Record<string, HealthMetric>
>((acc, m) => {
  acc[m.key] = m
  return acc
}, {})

/** key → 指标定义；未知 key 返回 undefined */
export function healthMetric(key: string): HealthMetric | undefined {
  return METRIC_INDEX[key]
}

/** 是否为注册表中的已知指标 */
export function isKnownMetric(key: string): boolean {
  return !!METRIC_INDEX[key]
}

/**
 * 规范化指标列表：丢弃未知 key、丢弃依赖未满足的项、按 Order 排序。
 *
 * ⚠️ 空数组是合法结果（全部关闭）→ UI 走「去配置」引导态，**不是空白**。
 */
export function normalizeMetrics(keys: readonly string[]): string[] {
  const enabled: Record<string, boolean> = {}
  for (const k of keys) {
    if (isKnownMetric(k)) enabled[k] = true
  }
  const out: string[] = []
  for (const m of HEALTH_METRICS) {
    if (!enabled[m.key]) continue
    if (m.dependsOn && !enabled[m.dependsOn]) continue
    out.push(m.key)
  }
  return out
}

/**
 * null（从未配置）→ 默认集合；非 null（含空数组）→ 规范化后返回。
 *
 * ⚠️ 区分「null」与「[]」很重要：null = 从未配置走默认值；[] = 用户主动全关。
 */
export function metricsOrDefault(keys: readonly string[] | null | undefined): string[] {
  if (keys == null) return [...DEFAULT_ENABLED_METRICS]
  return normalizeMetrics(keys)
}

/* ==================== 排便形态（4 档）==================== */

/**
 * ⚠️ 刻意不用 Bristol 7 型量表：那是临床标准，个人向产品的用户不需要 7 个分类的
 * 认知负担，多数人也不会为了记录去查量表含义。4 档 + 每档一句人话描述即可。
 */
export const BOWEL_TYPE_NONE = 0
export const BOWEL_TYPE_OK = 1
export const BOWEL_TYPE_SOFT = 2
export const BOWEL_TYPE_HARD = 3
export const BOWEL_TYPE_LOOSE = 4

export interface BowelTypeOption {
  value: number
  label: string
  desc: string
}

export const BOWEL_TYPE_OPTIONS: readonly BowelTypeOption[] = [
  { value: BOWEL_TYPE_HARD, label: '偏硬', desc: '干硬、费力' },
  { value: BOWEL_TYPE_OK, label: '正常', desc: '成形、顺畅' },
  { value: BOWEL_TYPE_SOFT, label: '偏软', desc: '不成形、偏稀' },
  { value: BOWEL_TYPE_LOOSE, label: '腹泻', desc: '水样' },
]

/* ==================== 数值边界（与后端 model 常量一致）==================== */

export const WATER_ML_MAX = 10000
export const BOWEL_COUNT_MAX = 9

export const WATER_GOAL_ML_MIN = 500
export const WATER_GOAL_ML_MAX = 4000
export const WATER_GOAL_ML_STEP = 100
export const DEFAULT_WATER_GOAL_ML = 1500

/* ==================== 饮水步进（「一杯」多大）==================== */

/**
 * 一杯的容量 ml。
 *
 * ⚠️ 老大 260919 追加：spec 03 §5.1 原定快捷档是写死的 `[+200][+300][+500]`，
 *    但每个人的杯子大小不一样 —— 快捷加水的步进必须能自己定，
 *    否则「喝一杯记一杯」这件事每次都得按自定义，快捷档就失去意义。
 *    快捷档由此值推导（见 waterQuickOptions），不再写死。
 */
export const WATER_STEP_ML_MIN = 50
export const WATER_STEP_ML_MAX = 1000
export const WATER_STEP_ML_STEP = 50
export const DEFAULT_WATER_STEP_ML = 200

/** 快捷加水的一档 */
export interface WaterQuickOption {
  /** 几杯 */
  cups: number
  /** 实际 ml（= cups × step，已夹到 10000 上限内） */
  ml: number
  /** chip 文案，如「+1 杯 200ml」 */
  label: string
}

/** 夹到合法步进值（与后端 model.NormalizeWaterStep 对齐：50 的倍数，50–1000） */
export function normalizeWaterStep(step: number): number {
  if (!Number.isFinite(step) || step <= 0) return DEFAULT_WATER_STEP_ML
  const n = Math.round(step / WATER_STEP_ML_STEP) * WATER_STEP_ML_STEP
  if (n < WATER_STEP_ML_MIN) return WATER_STEP_ML_MIN
  if (n > WATER_STEP_ML_MAX) return WATER_STEP_ML_MAX
  return n
}

/** 快捷加水档位：1 杯 + 2 杯（大杯也有意义，喝一大瓶就按两杯） */
export function waterQuickOptions(step: number): WaterQuickOption[] {
  const s = normalizeWaterStep(step)
  return [1, 2].map((cups) => ({
    cups,
    ml: s * cups,
    label: `+${cups} 杯 · ${s * cups}ml`,
  }))
}

/* ==================== 月历 mark（与后端 07 §1.2 一致）==================== */

export const HEALTH_MARKS = {
  period: 'period',
  periodPredicted: 'period_predicted',
  flowLight: 'flow_light',
  flowMedium: 'flow_medium',
  flowHeavy: 'flow_heavy',
  spotting: 'spotting',
  fertile: 'fertile',
  peak: 'peak',
  ovulation: 'ovulation',
  today: 'today',
  /** 当日有健康记录（格子下沿灰点，本模块新增） */
  logged: 'logged',
} as const

/* ==================== 时间轴事件（2026-09-19 新增）==================== */

/**
 * 身体指标在**时间轴**上的 metric_key（与后端 model/health_event.go 的 MetricKey* 逐字一致）。
 *
 * ⚠️ 这些 key 同时用于：
 *   1. `/health/events` 的读写
 *   2. 月历分类小点的颜色映射
 *   3. 日汇总的重算分支（后端）
 */
export const METRIC_KEYS = {
  water: 'water',
  bbt: 'bbt',
  weight: 'weight',
  sleep: 'sleep',
  bowel: 'bowel',
} as const

export type MetricKey = (typeof METRIC_KEYS)[keyof typeof METRIC_KEYS]

/** 每个指标一次记录的**单位**与展示精度 */
export const METRIC_META: Record<
  MetricKey,
  { label: string; unit: string; decimals: number; usesInt: boolean; icon: string }
> = {
  water: { label: '饮水', unit: 'ml', decimals: 0, usesInt: false, icon: 'Droplet' },
  bbt: { label: '体温', unit: '℃', decimals: 2, usesInt: false, icon: 'Thermometer' },
  weight: { label: '体重', unit: 'kg', decimals: 1, usesInt: false, icon: 'Scale' },
  sleep: { label: '睡眠', unit: 'h', decimals: 1, usesInt: false, icon: 'Moon' },
  bowel: { label: '排便', unit: '', decimals: 0, usesInt: true, icon: 'CircleDot' },
}

export function isKnownMetricKey(k: string): k is MetricKey {
  return Object.prototype.hasOwnProperty.call(METRIC_KEYS, k)
}

/* ==================== 月历分类小点（2026-09-19 新增）==================== */

/**
 * 日期下方那一排**可重叠**的小点，每类一个颜色。
 *
 * ⚠️ 老大 260919：原来的 `logged` 灰点只能表达「这天记了点什么」，看不出记了哪一类。
 *
 * | 颜色 | 含义 | 来源 |
 * |---|---|---|
 * | 黄 | 心情 | mood_logs 当天有 mood 值 |
 * | 紫 | 精力 / 睡眠 | mood_logs 有 energy，或 events 里有 sleep |
 * | 蓝 | 体温 | events metric_key=bbt |
 * | 青 | 饮水 | events metric_key=water |
 * | 棕 | 排便 | events metric_key=bowel |
 * | 灰 | 体重 | events metric_key=weight |
 * | 红 | 经期 | period_days（沿用既有底色，不是小点） |
 */
export const CALENDAR_DOT_MARKS = ['mood', 'energy', 'bbt', 'water', 'bowel', 'weight'] as const

export type CalendarDotMark = (typeof CALENDAR_DOT_MARKS)[number]

/** mark → CSS 变量名（双端各自的 tokens 里都要有这些变量） */
export const CALENDAR_DOT_COLOR: Record<CalendarDotMark, string> = {
  mood: 'var(--health-dot-mood)',
  energy: 'var(--health-dot-energy)',
  bbt: 'var(--health-dot-bbt)',
  water: 'var(--health-dot-water)',
  bowel: 'var(--health-dot-bowel)',
  weight: 'var(--health-dot-weight)',
}

export const CALENDAR_DOT_LABEL: Record<CalendarDotMark, string> = {
  mood: '心情',
  energy: '精力/睡眠',
  bbt: '体温',
  water: '饮水',
  bowel: '排便',
  weight: '体重',
}

/** 一行最多画几个点，超出的折叠成「+N」 */
export const CALENDAR_DOT_MAX = 3

/* ==================== 概览卡色调 ==================== */

/**
 * ⚠️ 只提供 normal / neutral —— 刻意不给 good / bad，
 * 防止前端拿去做价值判断给身体上色（07 §1.1）。
 */
export type HealthCardTone = 'normal' | 'neutral'

export const CARD_TONE_NORMAL: HealthCardTone = 'normal'
export const CARD_TONE_NEUTRAL: HealthCardTone = 'neutral'
