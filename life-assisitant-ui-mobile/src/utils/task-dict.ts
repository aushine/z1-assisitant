/**
 * 任务字典 —— 优先级 / 状态的唯一来源（移动端）
 *
 * SYNC-FROM-DESKTOP: life-assisitant-ui-desktop/src/utils/task-dict.ts
 * 契约变更时必须同步更新本文件与桌面端。最后同步：2026-09-18
 *
 * ⚠️ 修复 B1：此前移动端把优先级写成了 `P0~P3` 字面量，散落在
 *    `components/TaskEditSheet.vue` 与 `pages/task/index.vue` 两处，
 *    而后端 / `api/types.ts` 的 `TaskPriority` 实际是
 *    `relaxed | normal | important | urgent` —— 类型必报错，
 *    且提交给后端的优先级值后端不认识。
 *
 * 颜色一律走 `@/utils/tint` 的 6 组语义色（已别名到 --color-*，暗色自动联动），
 * 业务代码不要再写 hex。
 *
 * 配色对照（旧 hex → tint，与桌面端一致）：
 *   relaxed     #9CA3AF            → neutral
 *   normal      #3B82F6 / #014DB2  → primary   （Tailwind 蓝 → 品牌蓝）
 *   important   #F97316            → warning
 *   urgent      #EF4444            → danger
 *   todo        #F3F4F6/#374151    → neutral
 *   in_progress #E0F2FF/#014DB2    → primary
 *   done        #D1FAE5/#047857    → success
 *   archived    #E5E7EB/#6B7280    → neutral
 *
 * 用法：
 *   import { TASK_PRIORITIES, getTaskPriority } from '@/utils/task-dict'
 *   const p = getTaskPriority(task.priority)
 *   :style="{ background: p.bg, color: p.fg }"
 */
import { getTint, type TintName } from '@/utils/tint'
import type { TaskPriority, TaskStatus } from '@/api/types'

export interface TaskPriorityDef {
  value: TaskPriority
  /** 中文标签 */
  label: string
  /** 语义色名，配合 getTint() 使用 */
  tint: TintName
  /** 底色（已解析好的 CSS 变量字符串，模板里直接用） */
  bg: string
  /** 前景色 */
  fg: string
}

export interface TaskStatusDef {
  value: TaskStatus
  label: string
  tint: TintName
  bg: string
  fg: string
}

/** 优先级 4 档（数组顺序即 UI 展示顺序；选择器 / 筛选下拉直接遍历它） */
export const TASK_PRIORITIES: readonly TaskPriorityDef[] = (
  [
    { value: 'relaxed', label: '宽松', tint: 'neutral' },
    { value: 'normal', label: '正常', tint: 'primary' },
    { value: 'important', label: '重要', tint: 'warning' },
    { value: 'urgent', label: '紧急', tint: 'danger' },
  ] as const
).map((d) => ({ ...d, ...getTint(d.tint) }))

/** 状态 4 档 */
export const TASK_STATUSES: readonly TaskStatusDef[] = (
  [
    { value: 'todo', label: '待办', tint: 'neutral' },
    { value: 'in_progress', label: '进行中', tint: 'primary' },
    { value: 'done', label: '已完成', tint: 'success' },
    { value: 'archived', label: '已归档', tint: 'neutral' },
  ] as const
).map((d) => ({ ...d, ...getTint(d.tint) }))

/** 新建任务时的默认优先级（桌面端同为 normal） */
export const DEFAULT_TASK_PRIORITY: TaskPriority = 'normal'

/**
 * 按 value 查优先级定义。未知 / undefined 回退到 `normal`，
 * 避免后端出现新枚举值时前端渲染崩溃。
 */
export function getTaskPriority(v: TaskPriority | string | undefined | null): TaskPriorityDef {
  return TASK_PRIORITIES.find((p) => p.value === v) ?? TASK_PRIORITIES[1]
}

/** 按 value 查状态定义。未知 / undefined 回退到 `todo`。 */
export function getTaskStatus(v: TaskStatus | string | undefined | null): TaskStatusDef {
  return TASK_STATUSES.find((s) => s.value === v) ?? TASK_STATUSES[0]
}
