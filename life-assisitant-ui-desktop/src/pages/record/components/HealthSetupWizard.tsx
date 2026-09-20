/**
 * HealthSetupWizard —— 健康首次引导向导（桌面版）
 *
 * SYNC-FROM-MOBILE: life-assisitant-ui-mobile/src/pages/record/health/setup.vue
 *
 * 勾选指标（默认 DEFAULT_ENABLED_METRICS，sex 默认关）+ 饮水目标 Slider + 体重目标（选填）
 * + 勾选 period 时的经期初始化（复用 /period/setup 的参数）。
 *
 * ⚠️ 「跳过」**不调** /health/setup，只在内存里标记（store.skipSetup），
 *    否则会「跳过→立刻被推回引导」死循环（与经期向导一致）。
 */
import { useState, useEffect } from 'react'
import { Modal, Button, Checkbox, InputNumber, Slider, DatePicker, Radio } from '@douyinfe/semi-ui'
import { useHealthStore } from '@/stores/health'
import {
  HEALTH_METRICS,
  DEFAULT_ENABLED_METRICS,
  WATER_GOAL_ML_MIN,
  WATER_GOAL_ML_MAX,
  WATER_GOAL_ML_STEP,
  DEFAULT_WATER_GOAL_ML,
  WATER_STEP_ML_MIN,
  WATER_STEP_ML_MAX,
  WATER_STEP_ML_STEP,
  DEFAULT_WATER_STEP_ML,
  normalizeWaterStep,
} from '@/constants/health'
import { PERIOD_GOAL_OPTIONS } from '@/constants/period'
import type { PeriodGoal } from '@/constants/period'

function defaultLastPeriod(): string {
  const d = new Date()
  d.setDate(d.getDate() - 28)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function fmtDate(v: any): string {
  if (!v) return ''
  if (v instanceof Date) {
    const y = v.getFullYear()
    const m = String(v.getMonth() + 1).padStart(2, '0')
    const d = String(v.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }
  return String(v)
}

export default function HealthSetupWizard({
  visible,
  onClose,
  onSkip,
}: {
  visible: boolean
  onClose: () => void
  onSkip?: () => void
}) {
  const store = useHealthStore()
  const [metrics, setMetrics] = useState<string[]>([])
  const [waterGoal, setWaterGoal] = useState(DEFAULT_WATER_GOAL_ML)
  /** 「一杯」多大：快捷加水的步进，之后可在健康设置里改 */
  const [waterStep, setWaterStep] = useState(DEFAULT_WATER_STEP_ML)
  const [weightGoal, setWeightGoal] = useState<number | null>(null)
  const [lastPeriodStart, setLastPeriodStart] = useState(defaultLastPeriod())
  const [avgPeriod, setAvgPeriod] = useState(5)
  const [avgCycle, setAvgCycle] = useState(28)
  const [goal, setGoal] = useState<PeriodGoal>(1)
  const [submitting, setSubmitting] = useState(false)

  // 每次打开重置为默认勾选（sex 默认关）
  useEffect(() => {
    if (visible) {
      setMetrics([...DEFAULT_ENABLED_METRICS])
      setWaterGoal(DEFAULT_WATER_GOAL_ML)
      setWaterStep(DEFAULT_WATER_STEP_ML)
      setWeightGoal(null)
      setLastPeriodStart(defaultLastPeriod())
      setAvgPeriod(5)
      setAvgCycle(28)
      setGoal(1)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible])

  function toggleMetric(key: string, on: boolean) {
    setMetrics((prev) => {
      let next = on ? [...prev, key] : prev.filter((k) => k !== key)
      const m = HEALTH_METRICS.find((x) => x.key === key)
      if (on && m?.dependsOn && !next.includes(m.dependsOn)) next = [...next, m.dependsOn]
      if (!on) next = next.filter((k) => HEALTH_METRICS.find((x) => x.key === k)?.dependsOn !== key)
      return next
    })
  }

  const periodOn = metrics.includes('period')

  const finish = async () => {
    setSubmitting(true)
    const ok = await store.setup({
      metrics_enabled: metrics,
      water_goal_ml: waterGoal,
      water_step_ml: waterStep,
      weight_goal_kg: weightGoal,
      period: periodOn
        ? {
            last_period_start: lastPeriodStart,
            avg_period_length: avgPeriod,
            avg_cycle_length: avgCycle,
            goal,
            show_fertile_window: 1,
          }
        : undefined,
    })
    setSubmitting(false)
    if (ok) onClose()
  }

  /** 跳过向导（「先看看」按钮 + 右上角关闭都用它）：不写后端，但通知父级本会话已跳过 */
  const handleSkip = () => {
    onSkip?.()
    onClose()
  }

  return (
    <Modal
      visible={visible}
      onCancel={handleSkip}
      title="开始记录你的身体节律"
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ color: 'var(--color-text-tertiary)', fontSize: 12 }}>勾选关心的指标，每天花一分钟打卡</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button theme="borderless" type="tertiary" onClick={handleSkip}>
              先看看
            </Button>
            <Button theme="solid" type="primary" loading={submitting} onClick={finish}>
              开启健康模块
            </Button>
          </div>
        </div>
      }
    >
      <div className="period-setting-block">
        <div className="period-setting-label">记录指标</div>
        <div className="period-caption" style={{ marginTop: 0, marginBottom: 8 }}>
          随时可在「设置」里增删；关闭只隐藏入口，历史数据保留。
        </div>
        <div className="health-metric-toggles">
          {HEALTH_METRICS.map((m) => {
            const checked = metrics.includes(m.key)
            const disabled = m.dependsOn ? !metrics.includes(m.dependsOn) : false
            return (
              <Checkbox
                key={m.key}
                checked={checked}
                disabled={disabled}
                onChange={(e: any) => toggleMetric(m.key, e.target.checked)}
              >
                {m.name}
              </Checkbox>
            )
          })}
        </div>
      </div>

      <div className="period-setting-block">
        <div className="period-setting-label">每日饮水目标（ml）</div>
        <div className="health-goal-row">
          <Slider
            min={WATER_GOAL_ML_MIN}
            max={WATER_GOAL_ML_MAX}
            step={WATER_GOAL_ML_STEP}
            value={waterGoal}
            onChange={(v) => setWaterGoal(Array.isArray(v) ? (v[0] ?? DEFAULT_WATER_GOAL_ML) : (v ?? DEFAULT_WATER_GOAL_ML))}
            style={{ flex: 1, marginRight: 16 }}
          />
          <InputNumber
            value={waterGoal}
            min={WATER_GOAL_ML_MIN}
            max={WATER_GOAL_ML_MAX}
            step={WATER_GOAL_ML_STEP}
            onChange={(v: number | string | undefined) => setWaterGoal(Number(v ?? DEFAULT_WATER_GOAL_ML))}
            style={{ width: 120 }}
          />
        </div>
      </div>

      <div className="period-setting-block">
        <div className="period-setting-label">一杯是多少（ml）</div>
        <div className="period-caption" style={{ marginTop: 0, marginBottom: 8 }}>
          快捷加减按这个量走。设成你常用的杯子容量，喝一杯点一下就行；之后可在健康设置里改。
        </div>
        <div className="health-goal-row">
          <Slider
            min={WATER_STEP_ML_MIN}
            max={WATER_STEP_ML_MAX}
            step={WATER_STEP_ML_STEP}
            value={waterStep}
            onChange={(v) =>
              setWaterStep(
                normalizeWaterStep(Array.isArray(v) ? (v[0] ?? DEFAULT_WATER_STEP_ML) : (v ?? DEFAULT_WATER_STEP_ML)),
              )
            }
            style={{ flex: 1, marginRight: 16 }}
          />
          <InputNumber
            value={waterStep}
            min={WATER_STEP_ML_MIN}
            max={WATER_STEP_ML_MAX}
            step={WATER_STEP_ML_STEP}
            onChange={(v: number | string | undefined) =>
              setWaterStep(normalizeWaterStep(Number(v ?? DEFAULT_WATER_STEP_ML)))
            }
            style={{ width: 120 }}
          />
        </div>
        <div className="period-caption">
          当前快捷档：+1 杯 {waterStep}ml / +2 杯 {waterStep * 2}ml。
        </div>
      </div>

      <div className="period-setting-block">
        <div className="period-setting-label">体重目标（kg，选填）</div>
        <InputNumber
          value={weightGoal ?? undefined}
          min={20}
          max={300}
          step={0.1}
          onChange={(v: number | string | undefined) => setWeightGoal(v == null ? null : Number(v))}
          placeholder="不设置"
          style={{ width: 160 }}
        />
      </div>

      {periodOn && (
        <div className="period-setting-block">
          <div className="period-setting-label">经期初始化（可后续在经期模块补充）</div>
          <div className="period-setting-subblock">
            <span className="period-group-label">上次经期开始日</span>
            <DatePicker type="date" value={lastPeriodStart} max={Date.now()} onChange={(v: any) => setLastPeriodStart(fmtDate(v))} style={{ width: 200 }} />
          </div>
          <div className="health-period-grid">
            <div>
              <span className="period-group-label">平均经期（天）</span>
              <InputNumber value={avgPeriod} min={1} max={15} onChange={(v: number | string | undefined) => setAvgPeriod(Number(v ?? 5))} style={{ width: 120 }} />
            </div>
            <div>
              <span className="period-group-label">平均周期（天）</span>
              <InputNumber value={avgCycle} min={15} max={60} onChange={(v: number | string | undefined) => setAvgCycle(Number(v ?? 28))} style={{ width: 120 }} />
            </div>
          </div>
          <div className="period-group-label" style={{ marginTop: 8 }}>目标模式</div>
          <Radio.Group
            value={String(goal)}
            onChange={(v: any) => setGoal(Number(v) as PeriodGoal)}
            options={PERIOD_GOAL_OPTIONS.map((o) => ({ label: `${o.label}（${o.desc}）`, value: String(o.value) }))}
          />
        </div>
      )}
    </Modal>
  )
}
