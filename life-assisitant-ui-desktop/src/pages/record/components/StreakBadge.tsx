/**
 * StreakBadge / MilestoneRow — 连续天数徽章与里程碑（S05 / S06 / S07）。
 *
 * S05：同一个 Flame 图标，底色强度按档位递进（04 §2.5），不引入新图标。
 * S06：接入记录页习惯列表逐行 + KPI 区。
 * S07：里程碑 7/21/66/100/365 + 奖牌令牌 --medal-*（定义在 styles/tokens.scss）。
 *      ⚠️ --medal-* 是**纯色**，只能用于 color / border-color；渐变形式是
 *      --medal-*-bg，仅用于 background。此处用前者。
 */
import { Tooltip } from '@douyinfe/semi-ui'
import { Icon } from '@/components/icon'
import type { IconName } from '@/components/icon'

/** 频率 → streak 单位文案（04 §2.2：streak 单位随频率变化） */
export function streakUnit(frequency: string | undefined): string {
  if (frequency === 'weekly') return '周'
  if (frequency === 'monthly') return '月'
  return '天'
}

interface Tier {
  bg: string
  fg: string
  bold: boolean
  glow: boolean
}

/** 五档视觉分档（04 §2.5） */
function tierOf(streak: number): Tier {
  if (streak >= 66) return { bg: 'var(--color-warning-light)', fg: 'var(--color-warning-dark)', bold: true, glow: true }   // 自动化
  if (streak >= 21) return { bg: 'var(--color-warning-light)', fg: 'var(--color-warning-dark)', bold: true, glow: false }  // 习惯（加重）
  if (streak >= 7) return { bg: 'var(--color-warning-light)', fg: 'var(--color-warning-dark)', bold: false, glow: false }  // 稳定（橙 pill）
  if (streak >= 3) return { bg: 'var(--tint-warning-bg)', fg: 'var(--tint-warning-fg)', bold: false, glow: false }         // 点燃
  return { bg: 'var(--tint-neutral-bg)', fg: 'var(--tint-neutral-fg)', bold: false, glow: false }                          // 起步
}

interface StreakBadgeProps {
  streak: number
  unit?: string
}

export function StreakBadge({ streak, unit = '天' }: StreakBadgeProps) {
  const tier = tierOf(Math.max(0, streak))
  return (
    <span
      className="streak-badge"
      style={{
        background: tier.bg,
        color: tier.fg,
        boxShadow: tier.glow ? '0 0 8px rgba(245, 158, 11, 0.45)' : undefined,
      }}
    >
      <Icon name="Flame" size={14} />
      <span style={{ fontWeight: tier.bold ? 700 : 500, fontVariantNumeric: 'tabular-nums' }}>{streak}</span>
      <span style={{ fontSize: 11, opacity: 0.85 }}>{unit}</span>
    </span>
  )
}

/** 里程碑定义（04 §2.6） */
const MILESTONES: { days: number; icon: IconName; label: string }[] = [
  { days: 7, icon: 'Award', label: '一周不断' },
  { days: 21, icon: 'Medal', label: '习惯萌芽' },
  { days: 66, icon: 'Trophy', label: '自动化' },
  { days: 100, icon: 'Gem', label: '百日' },
  { days: 365, icon: 'Crown', label: '一年' },
]

interface MilestoneRowProps {
  /** 以最长连续天数判断哪些里程碑已达成 */
  longestStreak: number
}

export function MilestoneRow({ longestStreak }: MilestoneRowProps) {
  return (
    <div className="milestone-row">
      {MILESTONES.map((m) => {
        const reached = longestStreak >= m.days
        return (
          <Tooltip key={m.days} content={`${m.days} 天 · ${m.label}`}>
            <span
              className="milestone-chip"
              style={{
                color: reached ? 'var(--medal-gold)' : 'var(--color-text-disabled)',
                borderColor: reached ? 'var(--medal-gold)' : 'var(--color-border-light)',
              }}
            >
              <Icon name={m.icon} size={16} />
            </span>
          </Tooltip>
        )
      })}
    </div>
  )
}

export default StreakBadge
