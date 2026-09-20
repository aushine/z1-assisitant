/**
 * 任务字典 —— 优先级 / 状态的唯一来源（A07「页面层」收尾）。
 *
 * 与 `category-dict` 同理（B05 的同一类问题）：此前这两张色表被逐字复制在三处 ——
 *   `pages/task/index.tsx:50-61`、`pages/task/detail.tsx:23-34`（两者逐字相同）、
 *   `components/TaskEditDrawer.tsx:23-28`（优先级色表的第三份）。
 * 且全部是硬编码 hex：其中 `#3B82F6`（Tailwind 蓝）与 `#DC2626` 正是
 * A07 §4.2 点名要清理的杂色；`#F3F4F6`/`#E0F2FF`/`#374151` 等也不会随
 * `[data-theme='dark']` 翻转 —— 暗色下状态标签会保持浅底深字，刺眼且对比度错。
 *
 * 现收敛为唯一真相，颜色一律走 `TINT_VARS` 的 6 组语义色（tint 别名到
 * `--color-*`，暗色下自动联动）。
 *
 * 配色对照（旧 hex → tint）：
 *   relaxed     #9CA3AF          → neutral
 *   normal      #3B82F6          → primary   （Tailwind 蓝 → 品牌蓝 #014DB2）
 *   important   #F97316          → warning
 *   urgent      #EF4444          → danger
 *   todo        #F3F4F6/#374151  → neutral
 *   in_progress #E0F2FF/#014DB2  → primary
 *   done        #D1FAE5/#047857  → success   （与 --color-success-light/-dark 逐字相等）
 *   archived    #E5E7EB/#6B7280  → neutral
 *
 * ⚠️ `normal`（Tailwind 蓝 → 品牌蓝）与 `important`（橙 #F97316 → warning 琥珀）
 * 会有**可见的色相变化**，这正是 A07 的目的（用品牌语义色替换 Tailwind 默认色），
 * 属预期而非回归。
 *
 * 用法：
 *   import { getTaskPriority, getTaskStatus, TASK_PRIORITIES } from '@/utils/task-dict'
 *   import { TINT_VARS } from '@/components/icon'
 *
 *   const p = getTaskPriority(task.priority)          // { value, label, tint }
 *   <Tag style={{ background: TINT_VARS[p.tint].bg, color: TINT_VARS[p.tint].fg }}>
 *     {p.label}
 *   </Tag>
 */
import type { TintName } from '@/components/icon'
import type { TaskPriority, TaskStatus } from '@/api/types'

export interface TaskPriorityDef {
  value: TaskPriority
  label: string
  /** 语义色名，配合 `TINT_VARS[tint].bg / .fg` 使用 */
  tint: TintName
}

export interface TaskStatusDef {
  value: TaskStatus
  label: string
  tint: TintName
}

/** 优先级 4 档（数组顺序即 UI 展示顺序，TaskEditDrawer 的优先级选择器直接遍历它） */
export const TASK_PRIORITIES: readonly TaskPriorityDef[] = [
  { value: 'relaxed',   label: '宽松', tint: 'neutral' },
  { value: 'normal',    label: '正常', tint: 'primary' },
  { value: 'important', label: '重要', tint: 'warning' },
  { value: 'urgent',    label: '紧急', tint: 'danger' },
]

/** 状态 4 档 */
export const TASK_STATUSES: readonly TaskStatusDef[] = [
  { value: 'todo',        label: '待办',   tint: 'neutral' },
  { value: 'in_progress', label: '进行中', tint: 'primary' },
  { value: 'done',        label: '已完成', tint: 'success' },
  { value: 'archived',    label: '已归档', tint: 'neutral' },
]

/**
 * 按 value 查优先级定义。未知 / undefined 值回退到 `normal`（索引 1），
 * 避免后端出现新枚举值时前端渲染崩溃。
 */
export function getTaskPriority(v: TaskPriority | undefined): TaskPriorityDef {
  return TASK_PRIORITIES.find((p) => p.value === v) ?? TASK_PRIORITIES[1]
}

/** 按 value 查状态定义。未知 / undefined 值回退到 `todo`。 */
export function getTaskStatus(v: TaskStatus | undefined): TaskStatusDef {
  return TASK_STATUSES.find((s) => s.value === v) ?? TASK_STATUSES[0]
}
