/**
 * 经期模块词库与枚举（前端常量，唯一真源）
 *
 * 依据：md/spec-260919/02-数据模型.md §4 与 04-页面与交互设计.md
 *
 * ⚠️ SYNC 契约（三处必须逐字一致，改一处必须同改三处）：
 *   1. life-assisitant-ui-mobile/src/constants/period.ts   ← 本文件（唯一真源）
 *   2. life-assisitant-ui-desktop/src/constants/period.ts
 *   3. life-assisitant-api/internal/utility/period_vocab.go（后端只用于校验 key 与回填 label）
 *
 * 不建字典表：症状 / 分泌物是纯 UI 词表，随时可能增补；落库只存 key。
 * 与项目既有「图标字典只加字段不改键」的路子一致。
 */

/** 症状分组 key */
export type PeriodSymptomGroupKey = 'PAIN' | 'DIGEST' | 'SKIN' | 'CIRCULATION' | 'OTHER'

/** 单条症状 */
export interface PeriodSymptomItem {
  key: string
  label: string
}

/** 症状分组 */
export interface PeriodSymptomGroup {
  key: PeriodSymptomGroupKey
  label: string
  items: PeriodSymptomItem[]
}

/** 症状词库：31 项 / 5 组（02 §4.1，顺序即渲染顺序） */
export const PERIOD_SYMPTOM_GROUPS: readonly PeriodSymptomGroup[] = [
  {
    key: 'PAIN',
    label: '疼痛',
    items: [
      { key: 'headache', label: '头痛' },
      { key: 'migraine', label: '偏头痛' },
      { key: 'cramps', label: '痛经/腹痛' },
      { key: 'backache', label: '腰酸背痛' },
      { key: 'breast_tender', label: '乳房胀痛' },
      { key: 'joint_pain', label: '关节痛' },
      { key: 'muscle_ache', label: '肌肉酸痛' },
    ],
  },
  {
    key: 'DIGEST',
    label: '消化',
    items: [
      { key: 'bloating', label: '腹胀' },
      { key: 'constipation', label: '便秘' },
      { key: 'diarrhea', label: '腹泻' },
      { key: 'nausea', label: '恶心' },
      { key: 'appetite_up', label: '食欲增加' },
      { key: 'appetite_down', label: '食欲不振' },
      { key: 'cravings', label: '渴望甜食' },
      { key: 'indigestion', label: '消化不良' },
    ],
  },
  {
    key: 'SKIN',
    label: '皮肤毛发',
    items: [
      { key: 'acne', label: '痤疮' },
      { key: 'hair_loss', label: '掉发' },
      { key: 'oily_skin', label: '皮肤油腻' },
      { key: 'dry_skin', label: '皮肤干燥' },
    ],
  },
  {
    key: 'CIRCULATION',
    label: '循环体温',
    items: [
      { key: 'hot_flash', label: '潮热' },
      { key: 'night_sweat', label: '盗汗' },
      { key: 'cold_limbs', label: '手脚冰凉' },
      { key: 'dizziness', label: '头晕' },
      { key: 'palpitations', label: '心悸' },
    ],
  },
  {
    key: 'OTHER',
    label: '其他',
    items: [
      { key: 'incontinence', label: '膀胱失禁' },
      { key: 'frequent_urination', label: '尿频' },
      { key: 'edema', label: '水肿' },
      { key: 'insomnia', label: '失眠' },
      { key: 'fatigue', label: '疲劳' },
      { key: 'drowsiness', label: '嗜睡' },
      { key: 'low_focus', label: '注意力不集中' },
    ],
  },
]

/** key → 中文（由分组派生，避免两份数据漂移） */
export const PERIOD_SYMPTOM_LABELS: Record<string, string> = PERIOD_SYMPTOM_GROUPS.reduce<
  Record<string, string>
>((acc, g) => {
  for (const it of g.items) acc[it.key] = it.label
  return acc
}, {})

/** 症状 key → 中文；未知名原样返回（不返回空，避免界面出现空白标签） */
export function periodSymptomLabel(key: string): string {
  return PERIOD_SYMPTOM_LABELS[key] ?? key
}

/** 02 §4.4：近期症状不足 6 个时的补足顺序 */
export const PERIOD_DEFAULT_RECENT_SYMPTOMS: readonly string[] = [
  'cramps',
  'bloating',
  'breast_tender',
  'fatigue',
  'headache',
  'appetite_down',
]

/* ==================== 经量 flow（5 值一列，0–4）==================== */

/** 0 未记录 / 1 点滴出血 / 2 量少 / 3 中等 / 4 量多 */
export type PeriodFlow = 0 | 1 | 2 | 3 | 4

export const PERIOD_FLOW_NONE = 0
export const PERIOD_FLOW_SPOTTING = 1
export const PERIOD_FLOW_LIGHT = 2
export const PERIOD_FLOW_MEDIUM = 3
export const PERIOD_FLOW_HEAVY = 4

export interface PeriodFlowOption {
  value: PeriodFlow
  label: string
  /** 色阶只区分经量，点滴出血单独一档（02 §5 互斥） */
  hint: string
}

/** 第 1 页「有出血」的 3 档（点滴在第 9 页，两者互斥） */
export const PERIOD_FLOW_LEVELS: readonly PeriodFlowOption[] = [
  { value: PERIOD_FLOW_LIGHT, label: '量少', hint: '护垫即可' },
  { value: PERIOD_FLOW_MEDIUM, label: '中等', hint: '常规卫生巾' },
  { value: PERIOD_FLOW_HEAVY, label: '量多', hint: '需要勤换' },
]

/** flow 数值 → 中文 */
export const PERIOD_FLOW_LABELS: Record<number, string> = {
  0: '未记录',
  1: '点滴出血',
  2: '量少',
  3: '中等',
  4: '量多',
}

/* ==================== 分泌物 discharge（1–5，单选，生育力递增）==================== */

export interface PeriodDischargeOption {
  value: number
  label: string
  desc: string
}

export const PERIOD_DISCHARGE_OPTIONS: readonly PeriodDischargeOption[] = [
  { value: 1, label: '干燥', desc: '无可见分泌物，感觉干爽' },
  { value: 2, label: '粘稠', desc: '微粘、易断' },
  { value: 3, label: '乳白', desc: '像乳液，乳白或微黄' },
  { value: 4, label: '水样', desc: '清亮，量偏多' },
  { value: 5, label: '蛋清拉丝', desc: '透明、可拉出长丝 —— 生育力最高的信号' },
]

/* ==================== 性生活（0–2）==================== */

export const PERIOD_INTERCOURSE_OPTIONS: readonly { value: number; label: string }[] = [
  { value: 1, label: '有（未避孕）' },
  { value: 2, label: '有（避孕）' },
]

/* ==================== 目标模式（只影响文案与默认展示顺序，不阉割功能）==================== */

export type PeriodGoal = 1 | 2 | 3 | 4

export interface PeriodGoalOption {
  value: PeriodGoal
  label: string
  desc: string
}

export const PERIOD_GOAL_OPTIONS: readonly PeriodGoalOption[] = [
  { value: 1, label: '仅记录', desc: '记录即可，不需要额外解读' },
  { value: 2, label: '备孕', desc: '排卵日与基础体温提前显示' },
  { value: 3, label: '避孕参考', desc: '易孕期提到最前，并强化免责提示' },
  { value: 4, label: '围绝经期', desc: '弱化排卵/易孕期，强化周期波动记录' },
]

/* ==================== 阶段（四相）==================== */

export type PeriodPhaseKey = 'menstrual' | 'follicular' | 'ovulation' | 'luteal'

export interface PeriodPhaseMeta {
  key: PeriodPhaseKey
  label: string
  desc: string
  /** 用作阶段胶囊底色 */
  tint: string
}

export const PERIOD_PHASE_META: Record<PeriodPhaseKey, PeriodPhaseMeta> = {
  menstrual: {
    key: 'menstrual',
    label: '月经期',
    desc: '子宫内膜脱落，注意保暖与休息',
    tint: 'danger',
  },
  follicular: {
    key: 'follicular',
    label: '卵泡期',
    desc: '雌激素回升，精力与状态通常最好',
    tint: 'primary',
  },
  ovulation: { key: 'ovulation', label: '排卵期', desc: '受孕概率最高的窗口', tint: 'accent' },
  luteal: {
    key: 'luteal',
    label: '黄体期',
    desc: '孕激素升高，可能出现水肿、情绪波动',
    tint: 'warning',
  },
}

/* ==================== 预测置信度（03 §4）==================== */

export type PeriodConfidence = 'high' | 'medium' | 'low' | 'insufficient'

export const PERIOD_CONFIDENCE_LABELS: Record<PeriodConfidence, string> = {
  high: '高置信',
  medium: '中等',
  low: '较低',
  insufficient: '数据不足',
}

/**
 * 置信度是否允许展示**具体日期**。
 *
 * ⚠️ 这是整份设计最值钱的一条约束：`insufficient` 下一个日期都不许显示。
 * 用默认 28 天算出来的假日期和真预测长得一模一样，最容易毁掉用户信任。
 */
export function periodCanShowDates(confidence: PeriodConfidence | undefined | null): boolean {
  return !!confidence && confidence !== 'insufficient'
}

/** 月历 mark（与后端 05 §2 的 marks 枚举一致） */
export const PERIOD_MARKS = {
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
  logged: 'logged',
} as const

/** 隐私遮罩（设备级 localStorage，不进 store、不进接口） */
export const PERIOD_MASK_STORAGE_KEY = 'ls:period:masked'

/** 掩码占位文案（开启眼睛后替换所有敏感结论） */
export const PERIOD_MASK_TEXT = '••••'

/** 固定免责文案（04 §3.3 / 03 §15） */
export const PERIOD_SAFE_DISCLAIMER = '日历法推算，仅作参考，不能作为避孕依据'
export const PERIOD_ALERT_FOOTNOTE = '以上提示基于你的记录数据自动生成，不构成医学诊断。如有不适请咨询专业医生。'
