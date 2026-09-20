/**
 * PeriodSetupWizard —— 首次引导向导（5 步，用户级）
 *
 * 步骤：① 上次经期开始日 ② 平均经期长度 ③ 平均周期长度 ④ 目标模式 ⑤ 免责确认。
 * 提交走 POST /period/setup 一次性（05 §10）。跳过不写 disclaimer_accepted_at（下次再弹）。
 *
 * 红线：免责确认文案逐字照抄 04 §7.1；所有字段来自常量/类型。
 */
import { useState } from 'react'
import { Modal, Button, DatePicker, InputNumber, Radio } from '@douyinfe/semi-ui'
import { usePeriodStore } from '@/stores/period'
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

const DISCLAIMER_TEXT = `本功能根据你自己记录的日期推算，属于日历法预测，存在误差：
· 只有约 13% 的人周期正好是 28 天，第 14 天排卵的比例也约 13%
· 日历法对排卵日的预测准确率约为 21%
· 因此「相对安全期」不能作为避孕依据

预测有助于了解自己的节律，但不能代替医学检查。
如有月经紊乱、异常出血或持续不适，请咨询专业医生。`

const STEP_TITLES = ['上次月经是几号来的？', '一般来几天？', '你的周期大概多少天？', '你用这个功能主要想做什么？', '关于经期预测']

export default function PeriodSetupWizard({
  visible,
  onClose,
  onSkip,
}: {
  visible: boolean
  onClose: () => void
  onSkip?: () => void
}) {
  const store = usePeriodStore()
  const [step, setStep] = useState(0)
  const [lastPeriodStart, setLastPeriodStart] = useState(defaultLastPeriod())
  const [avgPeriod, setAvgPeriod] = useState(5)
  const [avgCycle, setAvgCycle] = useState(28)
  const [goal, setGoal] = useState<PeriodGoal>(1)
  const [showFertile] = useState(1)
  const [acknowledged, setAcknowledged] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const canNext =
    (step === 0 && !!lastPeriodStart) ||
    step === 1 ||
    step === 2 ||
    (step === 3 && !!goal) ||
    (step === 4 && acknowledged)

  const finish = async () => {
    setSubmitting(true)
    const ok = await store.setup({
      last_period_start: lastPeriodStart,
      avg_period_length: avgPeriod,
      avg_cycle_length: avgCycle,
      goal,
      show_fertile_window: showFertile,
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
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ color: 'var(--color-text-tertiary)', fontSize: 12 }}>
            第 {step + 1} / 5 步
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            {step < 4 ? (
              <>
                <Button theme="borderless" type="tertiary" onClick={handleSkip}>
                  先看看
                </Button>
                <Button theme="solid" type="primary" disabled={!canNext} onClick={() => setStep(step + 1)}>
                  下一步
                </Button>
              </>
            ) : (
              <Button theme="solid" type="primary" loading={submitting} disabled={!acknowledged} onClick={finish}>
                我知道了
              </Button>
            )}
          </div>
        </div>
      }
      title="开始记录你的周期"
    >
      <div className="period-wizard">
        <div className="period-wizard-step-title">{STEP_TITLES[step]}</div>

        {step === 0 && (
          <DatePicker
            type="date"
            value={lastPeriodStart}
            max={Date.now()}
            onChange={(v: any) => setLastPeriodStart(fmtDate(v))}
            style={{ width: 240 }}
          />
        )}

        {step === 1 && (
          <div>
            <InputNumber
              value={avgPeriod}
              min={1}
              max={15}
              onChange={(v: number | string | undefined) => setAvgPeriod(Number(v ?? 5))}
              style={{ width: 160 }}
            />
            <span style={{ marginLeft: 8, color: 'var(--color-text-tertiary)' }}>天</span>
          </div>
        )}

        {step === 2 && (
          <div>
            <InputNumber
              value={avgCycle}
              min={15}
              max={60}
              onChange={(v: number | string | undefined) => setAvgCycle(Number(v ?? 28))}
              style={{ width: 160 }}
            />
            <span style={{ marginLeft: 8, color: 'var(--color-text-tertiary)' }}>天</span>
            <div className="period-caption">不确定就用 28，之后会自动校准</div>
          </div>
        )}

        {step === 3 && (
          <Radio.Group
            value={String(goal)}
            onChange={(v: any) => setGoal(Number(v) as PeriodGoal)}
            options={PERIOD_GOAL_OPTIONS.map((o) => ({ label: `${o.label}（${o.desc}）`, value: String(o.value) }))}
          />
        )}

        {step === 4 && (
          <div>
            <div className="period-disclaimer">{DISCLAIMER_TEXT}</div>
            <label className="period-wizard-ack">
              <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} />
              <span style={{ marginLeft: 8 }}>我已阅读并理解上述内容</span>
            </label>
          </div>
        )}
      </div>
    </Modal>
  )
}
