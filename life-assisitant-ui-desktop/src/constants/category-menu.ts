/**
 * 「对分类做什么」的统一动作集（05 §2.6）。
 *
 * ⚠️ **唯一来源**：分类管理页（`pages/me/finance-categories.tsx`）与记账选择器内
 * 的右键 / `⋮` 菜单（`components/finance/CategoryPicker.tsx`）**共用这一套定义**。
 * 「编辑 / 删除」两处行为必须一致，不要再另写一套菜单。
 *
 * 各端按自己的容器渲染：桌面端管理页渲染成行尾按钮，选择器渲染成 `Dropdown.Item`。
 */
import type { IconName } from '@/components/icon'

export type CategoryMenuActionKey = 'edit' | 'delete'

export interface CategoryMenuAction {
  /** 动作标识，消费方据此分发行为 */
  key: CategoryMenuActionKey
  /** 展示文案 */
  label: string
  /** 菜单项图标（按钮这类窄容器可不渲染） */
  icon: IconName
  /** 危险动作（删除）—— 红色呈现 + 二次确认 */
  danger: boolean
}

export const CATEGORY_MENU_ACTIONS: readonly CategoryMenuAction[] = [
  { key: 'edit', label: '编辑', icon: 'Pencil', danger: false },
  { key: 'delete', label: '删除', icon: 'Trash2', danger: true },
]
