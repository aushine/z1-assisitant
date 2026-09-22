/**
 * 记账分类 · 共享常量（移动端）
 *
 * 契约文档：md/spec-20260921-v1/05-交互与页面设计.md §2.6
 *
 * ⚠️ `MENU_ACTIONS` 是**「对分类做点什么」的唯一一套菜单**，
 *    选择器（`components/finance/CategoryPicker.vue`）与分类管理页
 *    （`pages/me/finance-categories.vue`）**都 import 这一份**，
 *    两处行为必须一致 —— 不要各自再写一份。
 */

/** 分类长按 / 右键菜单动作（顺序即展示顺序） */
export const MENU_ACTIONS: Array<{ name: string }> = [{ name: '编辑' }, { name: '删除' }]

import { formatMoney } from '@/utils/date'
import type { Transaction, TransactionType } from '@/api/types'

/** 交易类型中文标签（与 TransactionList.typeLabel 一致） */
export function txTypeLabel(type: TransactionType): string {
  if (type === 'expense') return '支出'
  if (type === 'income') return '收入'
  return '转账'
}

/**
 * 「撤销」确认文案：详情页与列表左滑**逐字一致**，抽同一份常量
 * （07 §5 黄色风险：两处文案不一致会让用户怀疑删的不是同一件东西）。
 */
export const TX_REVERSE_CONFIRM = {
  title: '撤销交易',
  message: '将生成一笔反向交易，原账户余额回滚。确认撤销？',
  confirmButtonText: '确认撤销',
} as const

/** 来源标签（v2 批次三：source 非空才显示，见 05 §2 统一模型） */
export const TX_SOURCE_LABEL: Record<string, string> = {
  balance_adjust: '余额调整',
  reimburse: '待报销',
  lend: '借出',
  borrow: '借入',
  refund: '退款',
}

/** 「删除」确认文案（逐字一致，抽同一份常量） */
export function txDeleteConfirm(t: Pick<Transaction, 'category_name' | 'type' | 'amount'>): {
  title: string
  message: string
  confirmButtonText: string
} {
  return {
    title: '删除交易',
    message: `确定删除「${t.category_name || txTypeLabel(t.type)} ¥${formatMoney(t.amount)}」吗？`,
    confirmButtonText: '删除',
  }
}

