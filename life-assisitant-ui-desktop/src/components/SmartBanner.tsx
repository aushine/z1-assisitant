/**
 * 管家建议横幅（04 §5 管家主动性）。
 *
 * 相比旧版（只读、不可关闭、只显示一条）：
 * - 可操作：每条建议带一个 CTA 按钮（去打卡 / 查看进度…）
 * - 可关闭：「稍后」（本次会话隐藏）与「不再提示」（localStorage 持久隐藏）
 * - 可切换：多条建议按优先级排序，用圆点轮播切换
 * - 图标：全部走统一 <Icon> 出口（不再直出 emoji）
 */
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@douyinfe/semi-ui'
import { Icon, TINT_VARS } from '@/components/icon'
import type { IconName, TintName } from '@/components/icon'
import type { HomeResp, Habit, HabitFrequency } from '@/api/types'

export interface SmartRec {
  /** 唯一标识，用于「不再提示」持久化与去重 */
  id: string
  type: 'warning' | 'success' | 'danger'
  icon: IconName
  title: string
  cta: { label: string; route: string }
}

const TYPE_TINT: Record<SmartRec['type'], TintName> = {
  warning: 'warning',
  success: 'success',
  danger: 'danger',
}

/** 里程碑档位（04 §2.6：7/21/66/100/365 天） */
const MILESTONES = [7, 21, 66, 100, 365]

/** streak 单位文案（04 §2.2：单位随频率变化） */
const FREQ_UNIT: Record<HabitFrequency, string> = {
  daily: '天',
  weekly: '周',
  monthly: '个月',
}

const STORAGE_KEY = 'life-smart-banner-dismissed'

function loadDismissed(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as string[]) : []
  } catch {
    return []
  }
}

function saveDismissed(ids: string[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids))
  } catch {
    /* localStorage 不可用时静默降级（隐私模式） */
  }
}

/**
 * 依据首页聚合数据 + 习惯列表（含 streak）计算建议列表，按优先级排序（04 §5.3）。
 * 预算预警（§5.3 第 3 条）依赖 BudgetTab 的 alert_threshold，首页无该数据，暂未接入。
 */
export function computeRecs(
  homeData: HomeResp | null,
  habits: Habit[],
  now: Date = new Date(),
): SmartRec[] {
  if (!homeData) return []
  const { kpi, month_finance } = homeData
  const recs: SmartRec[] = []

  // 1. 断卡预警（G02）：连续 ≥7 且今日未打卡 且 ≥18:00
  if (now.getHours() >= 18) {
    const atRisk = habits.find(
      (h) =>
        h.status === 'active' &&
        (h.current_streak ?? 0) >= 7 &&
        !(h.today_done ?? h.today_completed),
    )
    if (atRisk) {
      recs.push({
        id: `streak-${atRisk.id}`,
        type: 'warning',
        icon: 'Flame',
        title: `「${atRisk.title}」已连续 ${atRisk.current_streak} ${FREQ_UNIT[atRisk.frequency]}，今天还没打卡`,
        cta: { label: '去打卡', route: '/record' },
      })
    }
  }

  // 2. 里程碑临近（G03）：距下一里程碑 ≤3 天（仅按天计的习惯）
  const nearMilestone = habits.find((h) => {
    if (h.status !== 'active' || h.frequency !== 'daily') return false
    const streak = h.current_streak ?? 0
    if (streak <= 0) return false
    const next = MILESTONES.find((m) => m > streak)
    return next != null && next - streak <= 3
  })
  if (nearMilestone) {
    const streak = nearMilestone.current_streak ?? 0
    const next = MILESTONES.find((m) => m > streak) as number
    recs.push({
      id: `milestone-${nearMilestone.id}-${next}`,
      type: 'success',
      icon: 'Trophy',
      title: `「${nearMilestone.title}」距 ${next} 天里程碑还差 ${next - streak} 天`,
      cta: { label: '查看进度', route: '/record' },
    })
  }

  // 3. 支出异常（04 §5.3 第 4 条）
  if (month_finance && month_finance.expense_change > 20) {
    recs.push({
      id: 'expense-high',
      type: 'danger',
      icon: 'AlertTriangle',
      title: '本月支出较上月明显偏高，注意控制开支',
      cta: { label: '查看统计', route: '/stat' },
    })
  }

  // 4. 今日空待办（04 §5.3 第 5 条）
  if (kpi.todo_total === 0) {
    recs.push({
      id: 'empty-todo',
      type: 'warning',
      icon: 'Lightbulb',
      title: '今天还没有安排任务，从一件小事开始吧',
      cta: { label: '新建任务', route: '/todo' },
    })
  }

  // 5. 未打卡（一般性提醒，与断卡预警互补：未到 18:00 时也轻提示）
  if (kpi.habit_done < kpi.habit_total) {
    recs.push({
      id: 'habit-incomplete',
      type: 'warning',
      icon: 'Droplet',
      title: '你今天还没打卡哦，去完成吧',
      cta: { label: '去打卡', route: '/record' },
    })
  }

  // 6. 接近满勤（正向鼓励）
  if (kpi.todo_rate > 0.8 && kpi.todo_total > 0) {
    recs.push({
      id: 'task-near-done',
      type: 'success',
      icon: 'Sparkles',
      title: '完成这些就满勤啦，加油！',
      cta: { label: '查看任务', route: '/todo' },
    })
  }

  return recs
}

/**
 * 横幅本体：多条建议轮播 + 关闭（稍后/不再提示）。
 */
export function SmartBanner({ recs }: { recs: SmartRec[] }) {
  const navigate = useNavigate()
  // 本次会话内被「稍后」隐藏的建议 id
  const [sessionHidden, setSessionHidden] = useState<Set<string>>(() => new Set())
  const [index, setIndex] = useState(0)

  const dismissedForever = loadDismissed()
  const visible = recs.filter(
    (r) => !dismissedForever.includes(r.id) && !sessionHidden.has(r.id),
  )

  if (visible.length === 0) return null

  const current = visible[Math.min(index, visible.length - 1)]
  const tv = TINT_VARS[TYPE_TINT[current.type]]

  /** 稍后：仅本次会话隐藏当前建议 */
  function dismissLater() {
    const nextHidden = new Set(sessionHidden).add(current.id)
    setSessionHidden(nextHidden)
    // 若仍有可见项，指针保持在合法范围
    const rest = visible.filter((r) => !nextHidden.has(r.id))
    if (rest.length === 0) return
    setIndex((i) => Math.min(i, rest.length - 1))
  }

  /** 不再提示：持久隐藏当前建议 */
  function dismissForever() {
    const next = Array.from(new Set([...loadDismissed(), current.id]))
    saveDismissed(next)
    dismissLater()
  }

  return (
    <div
      className="smart-banner"
      style={{
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 12,
        padding: '12px 16px',
        borderRadius: 'var(--radius-lg)',
        background: tv.bg,
        color: tv.fg,
      }}
    >
      <Icon name={current.icon} size={20} style={{ color: tv.fg, flexShrink: 0 }} />
      <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 500 }}>
        {current.title}
      </span>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <Button size="small" theme="solid" type="primary" onClick={() => navigate(current.cta.route)}>
          {current.cta.label}
        </Button>
        <Button size="small" theme="light" type="tertiary" onClick={dismissForever}>
          不再提示
        </Button>

        {/* 多条建议时的圆点指示器 */}
        {visible.length > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, margin: '0 4px' }}>
            {visible.map((r, i) => (
              <button
                key={r.id}
                aria-label={`第 ${i + 1} 条建议`}
                onClick={() => setIndex(i)}
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  border: 'none',
                  cursor: 'pointer',
                  padding: 0,
                  background: i === Math.min(index, visible.length - 1) ? tv.fg : 'rgba(0,0,0,0.15)',
                }}
              />
            ))}
          </div>
        )}

        <button
          aria-label="稍后提醒"
          onClick={dismissLater}
          style={{
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
            color: tv.fg,
            display: 'inline-flex',
            padding: 2,
          }}
        >
          <Icon name="X" size={16} />
        </button>
      </div>
    </div>
  )
}
