/**
 * HealthSettingsDrawer —— 健康设置（桌面版）
 *
 * SYNC-FROM-MOBILE: life-assisitant-ui-mobile/src/pages/record/health/settings.vue
 * SYNC-FROM:        src/pages/record/components/PeriodSettingsDrawer.tsx（复用结构与写法）
 *
 * 含：指标开关（默认参照 DEFAULT_ENABLED_METRICS，sex 默认关）+ 饮水目标 + 体重目标。
 * ⚠️ 关闭某个指标只隐藏记录入口与对应卡片，**历史数据保留**（不会删除 health_days 里的值）。
 * ⚠️ discharge 依赖 period：period 关闭时 discharge 开关禁用，且 period 关闭会连带关闭 discharge。
 */
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { SideSheet, Button, InputNumber, Slider, Checkbox } from '@douyinfe/semi-ui'
import PeriodSettingsDrawer from './PeriodSettingsDrawer'
import { useHealthStore } from '@/stores/health'
import {
  HEALTH_METRICS,
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

export default function HealthSettingsDrawer({
  visible,
  onClose,
  onOpenSetup,
}: {
  visible: boolean
  onClose: () => void
  /**
   * 打开「经期设置向导」的回调。**可选**：从记录 → 健康进来时能直接开向导；
   * 从个人中心进来时没有向导宿主，回落成「跳到记录 → 健康」。
   */
  onOpenSetup?: () => void
}) {
  const navigate = useNavigate()
  const store = useHealthStore()
  /** 经期与周期的独立浮层（Semi 的 SideSheet 不能嵌套渲染，只能叠开） */
  const [periodOpen, setPeriodOpen] = useState(false)
  const [metrics, setMetrics] = useState<string[]>([])
  const [waterGoal, setWaterGoal] = useState(DEFAULT_WATER_GOAL_ML)
  /** 「一杯」多大：快捷加水的步进 */
  const [waterStep, setWaterStep] = useState(DEFAULT_WATER_STEP_ML)
  const [weightGoal, setWeightGoal] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!visible) return
    const s = store.settings
    if (s) {
      setMetrics([...s.metrics_enabled])
      setWaterGoal(s.water_goal_ml)
      setWaterStep(normalizeWaterStep(s.water_step_ml ?? 0))
      setWeightGoal(s.weight_goal_kg ?? null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, store.settings])

  function toggleMetric(key: string, on: boolean) {
    setMetrics((prev) => {
      let next = on ? [...prev, key] : prev.filter((k) => k !== key)
      const m = HEALTH_METRICS.find((x) => x.key === key)
      if (on && m?.dependsOn && !next.includes(m.dependsOn)) next = [...next, m.dependsOn]
      // 关闭父项时连带关闭依赖它的子项
      if (!on) next = next.filter((k) => HEALTH_METRICS.find((x) => x.key === k)?.dependsOn !== key)
      return next
    })
  }

  const save = async () => {
    setSaving(true)
    const ok = await store.patchSettings({
      metrics_enabled: metrics,
      water_goal_ml: waterGoal,
      water_step_ml: waterStep,
      weight_goal_kg: weightGoal,
    })
    setSaving(false)
    if (ok) onClose()
  }

  return (
    <SideSheet
      visible={visible}
      onCancel={onClose}
      placement="right"
      width={520}
      title="健康设置"
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button onClick={onClose}>取消</Button>
          <Button theme="solid" type="primary" loading={saving} onClick={save}>
            保存
          </Button>
        </div>
      }
    >
      <div className="period-setting-block">
        <div className="period-setting-label">记录指标</div>
        <div className="period-caption" style={{ marginTop: 0, marginBottom: 8 }}>
          关闭指标只隐藏记录入口与对应卡片，<b>历史数据会保留</b>。
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
            onChange={(v: number | number[] | undefined) => setWaterGoal(typeof v === 'number' ? v : DEFAULT_WATER_GOAL_ML)}
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
          快捷加减就按这个量走。每个人的杯子不一样，设成你常用的容量，喝一杯点一下就行。
        </div>
        <div className="health-goal-row">
          <Slider
            min={WATER_STEP_ML_MIN}
            max={WATER_STEP_ML_MAX}
            step={WATER_STEP_ML_STEP}
            value={waterStep}
            onChange={(v: number | number[] | undefined) =>
              setWaterStep(normalizeWaterStep(typeof v === 'number' ? v : DEFAULT_WATER_STEP_ML))
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
        <div className="period-caption">留空表示不追踪体重目标。</div>
      </div>

      {/* ⚠️ 经期设置**已并入健康设置**（老大 260919 复核 spec 指出的偏差）：
          个人中心与记录页都不再有独立的经期设置入口。
          只在「经期」指标开启时显示 —— 关掉指标只隐藏入口，历史数据保留。 */}
      {metrics.includes('period') && (
        <div className="period-setting-block">
          <div className="period-setting-label">经期与周期</div>
          <div className="period-caption" style={{ marginTop: 0, marginBottom: 8 }}>
            周期长度、经期长度、黄体期、易孕期开关、异常提醒与「重新设置向导」都在下面的浮层里。
          </div>
          <Button theme="light" type="secondary" onClick={() => setPeriodOpen(true)}>
            打开经期设置
          </Button>
        </div>
      )}

      <PeriodSettingsDrawer
        visible={periodOpen}
        onClose={() => setPeriodOpen(false)}
        onOpenSetup={() => {
          setPeriodOpen(false)
          if (onOpenSetup) onOpenSetup()
          else navigate('/record')
        }}
      />
    </SideSheet>
  )
}
