/**
 * PeriodSettingsDrawer —— 经期设置
 *
 * 与经期 Tab 共用权限（period:view 读 / period:write 写），不新增按钮级权限点（D12）。
 * 含：周期/经期长度默认值、黄体期长度、目标模式、易孕期开关、异常提醒开关、
 * 免责声明查看、整模块重置（二次确认，period:manage）。
 */
import { useEffect, useState } from 'react'
import {
  SideSheet,
  Button,
  InputNumber,
  Radio,
  Switch,
  Modal,
  Divider,
} from '@douyinfe/semi-ui'
import { Icon } from '@/components/icon'
import { usePeriodStore } from '@/stores/period'
import { PERIOD_GOAL_OPTIONS, PERIOD_ALERT_FOOTNOTE } from '@/constants/period'
import type { PeriodGoal } from '@/constants/period'

export default function PeriodSettingsDrawer({
  visible,
  onClose,
  onOpenSetup,
}: {
  visible: boolean
  onClose: () => void
  onOpenSetup: () => void
}) {
  const store = usePeriodStore()
  const [avgCycle, setAvgCycle] = useState(28)
  const [avgPeriod, setAvgPeriod] = useState(5)
  const [luteal, setLuteal] = useState(14)
  const [goal, setGoal] = useState<PeriodGoal>(1)
  const [showFertile, setShowFertile] = useState(true)
  const [irregularAlert, setIrregularAlert] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!visible) return
    const s = store.settings
    if (s) {
      setAvgCycle(s.avg_cycle_length)
      setAvgPeriod(s.avg_period_length)
      setLuteal(s.luteal_length)
      setGoal((s.goal as PeriodGoal) ?? 1)
      setShowFertile((s.show_fertile_window ?? 1) === 1)
      setIrregularAlert((s.irregular_alert ?? 1) === 1)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, store.settings])

  const save = async () => {
    setSaving(true)
    const ok = await store.patchSettings({
      avg_cycle_length: avgCycle,
      avg_period_length: avgPeriod,
      luteal_length: luteal,
      goal,
      show_fertile_window: showFertile ? 1 : 0,
      irregular_alert: irregularAlert ? 1 : 0,
    })
    setSaving(false)
    if (ok) onClose()
  }

  const doReset = () => {
    Modal.confirm({
      title: '整模块重置',
      content: '将删除你所有的经期日记与周期（period_days / period_cycles），设置保留但清空「上次经期」。此操作不可恢复，确定继续？',
      okText: '确认重置',
      okButtonProps: { type: 'danger', theme: 'solid' },
      cancelText: '取消',
      onOk: async () => {
        await store.reset()
        onClose()
      },
    })
  }

  const disclaimer = store.settings?.disclaimer_accepted_at

  return (
    <SideSheet
      visible={visible}
      onCancel={onClose}
      placement="right"
      width={520}
      title="经期设置"
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
        <div className="period-setting-label">平均周期长度（天）</div>
        <InputNumber
          value={avgCycle}
          min={15}
          max={60}
          onChange={(v: number | string | undefined) => setAvgCycle(Number(v ?? 28))}
          style={{ width: 160 }}
        />
        <div className="period-caption">不确定就用 28，之后会根据你的记录自动校准</div>
      </div>

      <div className="period-setting-block">
        <div className="period-setting-label">平均经期长度（天）</div>
        <InputNumber
          value={avgPeriod}
          min={1}
          max={15}
          onChange={(v: number | string | undefined) => setAvgPeriod(Number(v ?? 5))}
          style={{ width: 160 }}
        />
      </div>

      <div className="period-setting-block">
        <div className="period-setting-label">黄体期长度（天）</div>
        <InputNumber
          value={luteal}
          min={9}
          max={18}
          onChange={(v: number | string | undefined) => setLuteal(Number(v ?? 14))}
          style={{ width: 160 }}
        />
        <div className="period-caption">体温法确认排卵后会自动校准</div>
      </div>

      <div className="period-setting-block">
        <div className="period-setting-label">目标模式（只影响文案与默认展示，不阉割功能）</div>
        <Radio.Group
          value={String(goal)}
          onChange={(v: any) => setGoal(Number(v) as PeriodGoal)}
          options={PERIOD_GOAL_OPTIONS.map((o) => ({ label: `${o.label}（${o.desc}）`, value: String(o.value) }))}
        />
      </div>

      <Divider />

      <div className="period-setting-switch">
        <span>显示易孕期 / 排卵日</span>
        <Switch checked={showFertile} onChange={(on: boolean) => setShowFertile(on)} />
      </div>
      <div className="period-setting-switch">
        <span>异常提醒</span>
        <Switch checked={irregularAlert} onChange={(on: boolean) => setIrregularAlert(on)} />
      </div>

      <Divider />

      <div className="period-setting-block">
        <div className="period-setting-label">免责声明</div>
        <div className="period-disclaimer">
          本功能根据你自己记录的日期推算，属于日历法预测，存在误差：只有约 13% 的人周期正好是 28 天，第 14 天排卵的比例也约 13%；日历法对排卵日的预测准确率约为 21%。因此「相对安全期」不能作为避孕依据。预测有助于了解自己的节律，但不能代替医学检查。如有月经紊乱、异常出血或持续不适，请咨询专业医生。
          <div className="period-alert-footnote" style={{ marginTop: 8 }}>{PERIOD_ALERT_FOOTNOTE}</div>
        </div>
        <div className="period-caption">
          状态：{disclaimer ? `已于 ${disclaimer.slice(0, 10)} 确认` : '尚未确认'}
        </div>
        <Button size="small" theme="light" type="secondary" icon={<Icon name="RefreshCw" size={14} />} onClick={onOpenSetup}>
          重新走引导
        </Button>
      </div>

      <Divider />

      <div className="period-setting-reset">
        <Button type="danger" theme="light" icon={<Icon name="Trash2" size={14} />} onClick={doReset}>
          整模块重置
        </Button>
      </div>
    </SideSheet>
  )
}
