/**
 * 金额展示统一工具（移动端）
 *
 * 收口「带符号金额 + 颜色」的散落实现：此前在 TransactionList / Timeline 等处
 * 各写一份 `amountText` / `formatAmount`（记账惯例：支出红 / 收入绿，与股票
 * 红涨绿跌**相反**；转账中性色）。
 *
 * ⚠️ 符号用 `+` 与 `−`（U+2212 减号），不是连字符 `-`（减号更宽、与数字视觉更配）。
 */
import type { TransactionType } from '@/api/types'
import { formatMoney } from '@/utils/date'

/** 带符号金额文本：收入 `+`、支出 `−`(U+2212)、转账无符号 */
export function formatSignedAmount(amount: number, type: TransactionType): string {
  if (type === 'income') return `+¥${formatMoney(amount)}`
  if (type === 'expense') return `−¥${formatMoney(amount)}` // − 为 U+2212
  return `¥${formatMoney(amount)}`
}

/** 金额颜色 class（与 TransactionList 一致：收入绿 / 支出红 / 转账中性） */
export function amountColorClass(type: TransactionType): string {
  if (type === 'income') return 'is-income'
  if (type === 'expense') return 'is-expense'
  return 'is-transfer'
}

/** 去掉末尾多余的 ".0"（1.0 → 1） */
function trimZero(s: string): string {
  return s.endsWith('.0') ? s.slice(0, -2) : s
}

/**
 * 日历净额缩写（03 §3.2）：
 *   |net| ≥ 10000 → `1.2万`（保留 1 位小数）
 *   |net| <  10000 → 整数（四舍五入，不带小数）
 */
export function formatNetAmount(net: number): string {
  const abs = Math.abs(net)
  if (abs >= 10000) return `${trimZero((net / 10000).toFixed(1))}万`
  return String(Math.round(net))
}

/**
 * 日历格子净额文本（带符号 + 缩写）：
 *   > 0 → 绿 `+`（调用处上色）  < 0 → 红 `−`(U+2212)  = 0 → 中性 `0`
 */
export function formatCalendarNet(net: number): string {
  if (net > 0) return `+${formatNetAmount(net)}`
  if (net < 0) return `−${formatNetAmount(-net)}` // − 为 U+2212
  return '0'
}
