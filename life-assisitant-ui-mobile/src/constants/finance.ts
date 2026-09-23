/**
 * 记账分类 · 共享常量（移动端）
 *
 * 契约文档：md/spec-20260921-v1/05-交互与页面设计.md §2.6
 *          + md/spec-20260922-v2/01 §2.5（数据块两态/周期持久化 key）
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

/* ============================================================================
 * 流水页数据块 · localStorage keys（spec-20260922-v2 · 01 §2.5 / D10 / D11）
 *
 * ⚠️ 「这台设备上的显示偏好」—— 与经期遮罩 `ls:period:masked` 同一先例，
 *    **入库是错的**（D11：设备级，不上报、不同步）。
 *    两端共用同一组 key（桌面端 constants/finance.ts 同值 ⇒ 同机两端一致）。
 * ========================================================================== */

/** 数据块周期（week | month | year） */
export const SUMMARY_PERIOD_KEY = 'ls:finance:summaryPeriod'
/** 左块面（income | expense） */
export const SUMMARY_CARD_LEFT_KEY = 'ls:finance:cardLeft'
/** 右块面（budget | net） */
export const SUMMARY_CARD_RIGHT_KEY = 'ls:finance:cardRight'

/** 财务金额遮罩开关（spec-20260922-v2 · 03 §3.2，设备级、不入库） */
export const FINANCE_MASK_KEY = 'ls:finance:masked'

