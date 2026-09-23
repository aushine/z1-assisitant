/**
 * HealthOverviewCard —— 今日健康（分类卡，桌面版）
 *
 * SYNC-FROM-MOBILE: life-assisitant-ui-mobile/src/components/health/HealthOverviewCard.vue
 * 260920 三次修订：合并「今日健康」与「快捷记录」为一张大卡（02 §16.7）。
 *
 * - 卡内 3 个分组：身体数据 / 经期 / 其他；行式布局（02 §16.3），行高 44、值左对齐。
 * - 每行 = 指标名 + 值 + 行尾 ChevronRight，整行可点 → 打开记录浮层并直达该指标那一页
 *   （metricKey，02 §16.4）。
 * - 饮水行额外带「＋ 喝一杯」：走 store.addEvent，静默刷新（不弹 toast，02 §16.5）。
 * - 非 daily 指标不进完成度分母；分母只数 daily 指标（02 §14.5）。
 * - 未记录统一显「—」；去掉了全部 ± 与输入框。
 * - tone 只做中性样式，绝不上红绿（07 §1.1）。
 *
 * ⚠️ 数据直接读 store.todayLog（日汇总缓存）+ store.settings.metrics_enabled 分组渲染，
 *    不再依赖后端 cards 数组的格式化文案，前端掌握行布局与点击入口。
 */
import { Card, Button } from '@douyinfe/semi-ui'
import type { MouseEvent } from 'react'
import { Icon } from '@/components/icon'
import { useHealthStore } from '@/stores/health'
import { DEFAULT_WATER_GOAL_ML, healthMetric, normalizeWaterStep } from '@/constants/health'
import type { HealthEventMetricKey } from '@/api/types'

interface Props {
  /** 点击某行 → 打开记录浮层并直达该指标那一页 */
  onOpenMetric: (metricKey: string) => void
  /** 点击右上角齿轮 → 打开健康设置 */
  onOpenSettings: () => void
}

/** 卡内分组定义（顺序即渲染顺序，02 §16.2）。
 *  ⚠️ 睡眠行用注册表 key `energy_sleep`（浮层面板同名，metricKey 才能直达），
 *     值取 todayLog.sleep_hours。 */
const GROUP_DEFS = [
  { title: '身体数据', keys: ['water', 'bowel', 'bbt', 'weight', 'energy_sleep'], onlyIfPeriod: false },
  { title: '经期', keys: ['period', 'discharge', 'sex'], onlyIfPeriod: true },
  { title: '其他', keys: ['symptoms', 'note'], onlyIfPeriod: false },
]

/** 行名（energy_sleep 行显示「睡眠」而不是注册表的「精力 · 睡眠」） */
const ROW_LABEL: Record<string, string> = {
  water: '饮水',
  bowel: '排便',
  bbt: '基础体温',
  weight: '体重',
  energy_sleep: '睡眠',
  period: '经期',
  discharge: '分泌物',
  sex: '性生活',
  symptoms: '症状',
  note: '备注',
}

/** 卡头「今天记了 N 项」的分母 = 卡内启用的 daily 指标（§14.5；心情归「今日心情」卡） */
const CARD_DAILY_KEYS = ['water', 'bbt', 'weight', 'energy_sleep'] as const

/** 某项今日是否已记录（完成度与行显隐用） */
function isRecorded(d: ReturnType<typeof useHealthStore.getState>['todayLog'], key: string): boolean {
  if (!d) return false
  switch (key) {
    case 'water': return d.water_ml > 0
    case 'bowel': return d.bowel_count > 0
    case 'bbt': return d.bbt != null
    case 'weight': return d.weight_kg != null
    case 'energy_sleep': return d.sleep_hours != null
    case 'period': return !!d.period && d.period.flow > 0
    case 'discharge': return !!d.period && d.period.discharge > 0
    case 'sex': return !!d.period && d.period.intercourse > 0
    case 'symptoms': return !!d.period && d.period.symptoms.length > 0
    case 'note': return !!d.moods && !!d.moods.note.trim()
    default: return false
  }
}

/** 行展示值（未记录统一显 —） */
function rowValue(
  key: string,
  d: ReturnType<typeof useHealthStore.getState>['todayLog'],
  waterGoal: number,
  dayIndex?: number,
): string {
  if (!d) return '—'
  switch (key) {
    case 'water': return `${d.water_ml} / ${waterGoal} ml`
    case 'bowel': return d.bowel_count > 0 ? `${d.bowel_count} 次` : '—'
    case 'bbt': return d.bbt != null ? `${d.bbt} ℃` : '—'
    case 'weight': return d.weight_kg != null ? `${d.weight_kg} kg` : '—'
    case 'energy_sleep': return d.sleep_hours != null ? `${d.sleep_hours} h` : '—'
    case 'period':
      if (dayIndex) return `周期第 ${dayIndex} 天`
      return (d.period?.flow ?? 0) > 0 ? '经期中' : '—'
    case 'discharge': return (d.period?.discharge ?? 0) > 0 ? '已记' : '—'
    case 'sex': return (d.period?.intercourse ?? 0) > 0 ? '已记' : '—'
    case 'symptoms': return (d.period?.symptoms.length ?? 0) > 0 ? `${d.period.symptoms.length} 项` : '—'
    case 'note': return d.moods?.note.trim() ? d.moods.note.trim() : '—'
    default: return '—'
  }
}

export default function HealthOverviewCard({ onOpenMetric, onOpenSettings }: Props) {
  const store = useHealthStore()
  const log = store.todayLog
  const enabled = store.enabledMetrics()
  const waterGoal = store.settings?.water_goal_ml || DEFAULT_WATER_GOAL_ML
  const waterStep = normalizeWaterStep(store.settings?.water_step_ml ?? 0)
  const today = store.today

  // 全部指标关闭 → 「去配置」引导态（不是空白，02 §10）
  if (enabled.length === 0) {
    return (
      <Card bordered={false} className="card health-overview">
        <div className="health-ov-off">
          <p className="health-ov-off-text">健康记录已全部关闭</p>
          <Button theme="solid" type="primary" block onClick={onOpenSettings}>
            去配置
          </Button>
        </div>
      </Card>
    )
  }

  const dayIndex = store.prediction?.current_cycle?.day_index

  const groups = GROUP_DEFS.filter((g) => !g.onlyIfPeriod || enabled.includes('period'))
    .map((g) => ({
      title: g.title,
      metrics: g.keys
        .filter((k) => enabled.includes(k))
        .map((k) => ({
          key: k,
          label: ROW_LABEL[k] ?? healthMetric(k)?.name ?? k,
          value: rowValue(k, log, waterGoal, dayIndex),
          recorded: isRecorded(log, k),
          isWater: k === 'water',
        })),
    }))
    .filter((g) => g.metrics.length > 0)

  // 完成度：只数 daily 指标（非 daily 不进分母也不进进度，02 §14.5）
  const dailyEnabled = CARD_DAILY_KEYS.filter((k) => enabled.includes(k))
  const dailyRecorded = dailyEnabled.filter((k) => isRecorded(log, k)).length
  const pct = dailyEnabled.length
    ? Math.min(100, Math.round((dailyRecorded / dailyEnabled.length) * 100))
    : 0

  function drinkCup(e: MouseEvent) {
    e.stopPropagation()
    // 05：silent 参数随成功 toast 一并退休（高频「＋一杯」本就无提示）
    void store.addEvent({ date: today, metric_key: 'water' as HealthEventMetricKey, value_num: waterStep })
  }

  return (
    <Card bordered={false} className="card health-overview">
      {/* ==================== 卡头：标题 + 记了几项 + 齿轮（P2：齿轮移到卡头右上角） ==================== */}
      <div className="health-ov-head">
        <div className="health-ov-head-left">
          <span className="health-ov-title">今日健康</span>
          <span className="health-ov-sub">今天记了 {dailyRecorded} 项</span>
        </div>
        <button className="health-ov-gear" type="button" aria-label="健康设置" onClick={onOpenSettings}>
          <Icon name="Settings" size={18} />
        </button>
      </div>
      <div className="health-ov-bar">
        <span className="health-ov-bar-fill" style={{ width: `${pct}%` }} />
      </div>

      {/* ==================== 分组 + 行 ==================== */}
      {groups.map(({ title, metrics }) => (
        <div className="health-ov-group" key={title}>
          <div className="health-ov-group-title">{title}</div>
          <ul className="health-ov-rows">
            {metrics.map((m) => (
              <li
                key={m.key}
                className="health-ov-row"
                role="button"
                aria-label={`${m.label}，点开记录`}
                onClick={() => onOpenMetric(m.key)}
              >
                <span className="health-ov-row-label">{m.label}</span>
                <span className={`health-ov-row-value${m.recorded ? '' : ' is-empty'}`}>{m.value}</span>
                {m.isWater && (
                  <Button
                    size="small"
                    theme="light"
                    type="primary"
                    className="health-ov-drink"
                    disabled={store.saving}
                    onClick={drinkCup}
                  >
                    ＋ 喝一杯
                  </Button>
                )}
                <Icon name="ChevronRight" size={16} className="health-ov-row-chevron" />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </Card>
  )
}
