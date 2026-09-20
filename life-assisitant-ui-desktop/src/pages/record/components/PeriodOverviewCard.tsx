/**
 * PeriodOverviewCard —— 周期概览卡
 *
 * 红线守卫：
 *  - confidence=insufficient：一个具体日期都不显示（用 canShowDates 拦截）
 *  - confidence=low：只显示区间（window）并灰显
 *  - 所有预测数字带「预计 / 预测」字样
 *  - 隐私遮罩（👁）开启：阶段名 / 预测文案 / 天数 / 易孕期胶囊 → 掩码，卡片高度不变
 *  - 易孕期关闭（show_fertile_window=0）：不渲染易孕/排卵信息
 */
import { Card, Button, Banner } from '@douyinfe/semi-ui'
import { Icon } from '@/components/icon'
import { usePeriodStore } from '@/stores/period'
import {
  PERIOD_PHASE_META,
  PERIOD_MASK_TEXT,
  PERIOD_ALERT_FOOTNOTE,
  periodCanShowDates,
} from '@/constants/period'
import type { PeriodPrediction } from '@/api/types'

function fmtMD(s?: string): string {
  if (!s) return '—'
  const [, m, d] = s.split('-')
  return `${Number(m)}月${Number(d)}日`
}

function fmtRange(win?: string[]): string {
  if (!win || win.length < 2) return '—'
  return `${fmtMD(win[0])}–${fmtMD(win[1])}`
}

/** 阶段进度条分段着色（月经期红 / 卵泡期蓝 / 排卵期紫 / 黄体期琥珀） */
const PHASE_TINT: Record<string, string> = {
  menstrual: 'var(--color-period)',
  follicular: 'var(--color-primary-500)',
  ovulation: 'var(--color-accent)',
  luteal: 'var(--color-warning)',
}

export default function PeriodOverviewCard({ onOpenSettings }: { onOpenSettings: () => void }) {
  const store = usePeriodStore()
  const { prediction, masked, initialized, settings } = store
  const canShow = periodCanShowDates(prediction?.confidence)
  const showFertile = (settings?.show_fertile_window ?? 1) === 1

  // ---- 引导态：从没记录过 ----
  if (!initialized) {
    return (
      <Card bordered={false} className="card period-overview">
        <div className="period-guide">
          <div className="period-guide-title">开始记录你的周期</div>
          <div className="period-guide-desc">
            记录 1–2 次经期后，就能看到排卵日、易孕期和下次经期预测。
          </div>
          <Button theme="solid" type="primary" icon={<Icon name="Droplet" size={16} />} onClick={onOpenSettings}>
            开始记录
          </Button>
        </div>
      </Card>
    )
  }

  const p = prediction as PeriodPrediction | null
  const phase = p?.current_cycle?.phase
  const phaseMeta = (phase?.key && PERIOD_PHASE_META[phase.key as keyof typeof PERIOD_PHASE_META]) || null
  const dayIndex = p?.current_cycle?.day_index ?? 0
  const estLen = p?.current_cycle?.estimated_length ?? 0
  const progressPct = estLen > 0 ? Math.min(100, Math.round((dayIndex / estLen) * 100)) : 0
  const tintColor = phase?.key ? PHASE_TINT[phase.key] : 'var(--color-border-strong)'

  // 预测下次经期文案（带「预计」）
  let nextText = '预测将在你记录后生成'
  let subText = ''
  if (p?.next_period) {
    if (canShow) {
      if (p.confidence === 'low') {
        nextText = `预计 ${fmtRange(p.next_period.window)} 来月经`
        subText = `你的周期波动较大，日期仅供参考`
      } else {
        nextText = `预计 ${fmtMD(p.next_period.date)} 来月经`
        subText = p.next_period.overdue
          ? '预测窗口已过，记录今天的实际情况即可，预测会随之更新'
          : `还有 ${p.next_period.days_until} 天`
      }
    } else {
      nextText = '再记录 1 个完整周期即可开启预测'
      subText = '用默认 28 天算出的假日期与真实预测无法区分，故暂不显示'
    }
  }

  const fertileText =
    showFertile && canShow && p?.fertile_window
      ? `易孕期 ${fmtRange([p.fertile_window.start, p.fertile_window.end])} · 峰值 ${fmtRange(p.fertile_window.peak)}`
      : ''

  return (
    <Card bordered={false} className="card period-overview">
      {/* 右上角图标组：隐私遮罩 / 预测依据（信息） / 设置 */}
      <div className="period-overview-actions">
        <Icon
          name={masked ? 'EyeOff' : 'Eye'}
          size={18}
          className="period-mask-icon"
          onClick={() => store.toggleMasked()}
        />
        <Icon name="Info" size={18} onClick={onOpenSettings} />
        <Icon name="Settings" size={18} onClick={onOpenSettings} />
      </div>

      {/* 阶段名 + 周期第 N 天 */}
      <div className="period-phase-name">
        {masked ? PERIOD_MASK_TEXT : phaseMeta?.label ?? '周期中'}
      </div>
      <div className="period-day-index">
        {masked ? PERIOD_MASK_TEXT : `周期第 ${dayIndex} 天`}
      </div>

      {/* 进度条 */}
      <div className="period-progress">
        <div className="period-progress-fill" style={{ width: `${progressPct}%`, background: tintColor }} />
      </div>

      {/* 主文案 + 副文案 */}
      <div className="period-next-main" style={{ color: p?.next_period?.overdue ? 'var(--color-text-tertiary)' : undefined }}>
        {masked ? PERIOD_MASK_TEXT : nextText}
      </div>
      {subText && (
        <div className="period-next-sub">
          {masked ? PERIOD_MASK_TEXT : subText}
        </div>
      )}

      {/* 易孕期胶囊 */}
      {fertileText && (
        <div className="period-fertile-pill" style={{ background: 'var(--color-fertile-soft)', color: 'var(--color-fertile-strong)' }}>
          {masked ? PERIOD_MASK_TEXT : fertileText}
        </div>
      )}

      {/* 异常提醒（红线 5：固定尾注） */}
      {p?.alerts && p.alerts.length > 0 && (
        <div className="period-alerts">
          <Banner
            type="warning"
            closeIcon={null}
            style={{ background: 'var(--color-warning-light)', border: 'none' }}
          >
            {p.alerts.map((a, i) => (
              <div key={i} className="period-alert-item">
                {a.text}
              </div>
            ))}
            <div className="period-alert-footnote">{PERIOD_ALERT_FOOTNOTE}</div>
          </Banner>
        </div>
      )}

      {/* 阶段说明（ⓘ 文案，放在卡底，不依赖遮罩） */}
      {phaseMeta && (
        <div className="period-phase-desc" style={{ color: 'var(--color-text-tertiary)' }}>
          {phaseMeta.desc}
        </div>
      )}
    </Card>
  )
}
