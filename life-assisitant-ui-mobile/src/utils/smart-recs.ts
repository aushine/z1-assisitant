/**
 * 管家建议（Smart Recs）—— 规则计算层
 *
 * SYNC-FROM-DESKTOP: life-assisitant-ui-desktop/src/components/SmartBanner.tsx
 * SYNC-FROM-BACKEND:（纯前端规则，无后端端点）
 * 最后同步：2026-09-18（Phase 2.2）
 *
 * ⚠️ 规则必须与桌面端 **1:1 一致**（含阈值、顺序、文案）。桌面端把
 *    `computeRecs` 直接写在 SmartBanner.tsx 里；移动端为了在
 *    `<script setup>` 之外复用（首页 + 未来的记录页），抽到本文件。
 *
 * 6 条规则（判定顺序即展示优先级）：
 *   1. 断卡预警    连续 ≥7 且今日未打卡 且 ≥18:00     warning  去打卡
 *   2. 里程碑临近  日频习惯距下一里程碑 ≤3 天          success  查看进度
 *   3. 支出异常    本月支出同比 > 20%                  danger   查看统计
 *   4. 今日空待办  今日任务总数为 0                    warning  新建任务
 *   5. 未打卡      习惯完成数 < 习惯总数               warning  去打卡
 *   6. 接近满勤    任务完成率 > 0.8 且总数 > 0         success  查看任务
 *
 * 预算预警（桌面端 §5.3 第 3 条）依赖 BudgetTab 的 alert_threshold，
 * 首页无该数据 → 两端一致地**未接入**。
 */
import type { Habit, HabitFrequency, HomeResp } from '@/api/types'
import type { IconName } from '@/components/icon/names'

/** 建议语气 → 语义色名（与 tint 6 组对齐） */
export type SmartRecType = 'warning' | 'success' | 'danger'

export interface SmartRec {
  /** 唯一标识，用于「不再提示」持久化与去重 */
  id: string
  type: SmartRecType
  /** Lucide 图标名（图标体系改造：原为 emoji） */
  icon: IconName
  title: string
  cta: { label: string; route: string }
}

/** 里程碑档位（04 §2.6：7/21/66/100/365 天）—— 与桌面端完全一致 */
export const MILESTONES = [7, 21, 66, 100, 365] as const

/** streak 单位文案（04 §2.2：单位随频率变化） */
const FREQ_UNIT: Record<HabitFrequency, string> = {
  daily: '天',
  weekly: '周',
  monthly: '个月',
}

/** 「不再提示」的 localStorage 键名 —— 必须与桌面端一致 */
export const SMART_BANNER_STORAGE_KEY = 'life-smart-banner-dismissed'

/** 读取持久化隐藏的建议 id 列表 */
export function loadDismissed(): string[] {
  try {
    const raw = localStorage.getItem(SMART_BANNER_STORAGE_KEY)
    return raw ? (JSON.parse(raw) as string[]) : []
  } catch {
    return []
  }
}

/** 写入持久化隐藏的建议 id 列表 */
export function saveDismissed(ids: string[]): void {
  try {
    localStorage.setItem(SMART_BANNER_STORAGE_KEY, JSON.stringify(ids))
  } catch {
    /* localStorage 不可用时静默降级（隐私模式） */
  }
}

/**
 * 依据首页聚合数据 + 习惯列表（含 streak）计算建议列表，按优先级排序。
 *
 * @param homeData 首页聚合响应（GET /home）；null 时不出任何建议
 * @param habits   习惯列表（需含 current_streak / today_completed）
 * @param now      注入当前时刻，便于测试
 */
export function computeRecs(
  homeData: HomeResp | null,
  habits: Habit[],
  now: Date = new Date()
): SmartRec[] {
  if (!homeData) return []
  const kpi = homeData.kpi
  const monthFinance = homeData.month_finance
  const recs: SmartRec[] = []

  // 1. 断卡预警（G02）：连续 ≥7 且今日未打卡 且 ≥18:00
  if (now.getHours() >= 18) {
    const atRisk = habits.find(
      (h) =>
        h.status === 'active' &&
        (h.current_streak ?? 0) >= 7 &&
        !isHabitDoneToday(h)
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
  if (monthFinance && monthFinance.expense_change > 20) {
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
      cta: { label: '新建任务', route: '/task' },
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
      cta: { label: '查看任务', route: '/task' },
    })
  }

  return recs
}

/** 兼容 today_done（前端镜像）与 today_completed（后端字段），两个任一是 true 即视为已打卡 */
function isHabitDoneToday(h: Habit): boolean {
  return Boolean(h.today_done ?? h.today_completed)
}
