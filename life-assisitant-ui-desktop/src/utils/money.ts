// ============================================================================
// 金额工具（桌面端）
//
// ⚠️ 与移动端 `utils/money.ts` **逐字对应**（两端是独立工程、无共享包，靠同一套规则对齐）：
//   - 记账惯例：支出红（--color-danger）/ 收入绿（--color-success），与股票红涨绿跌**相反**
//   - 减号用 U+2212（−），不是连字符 `-`（与月历一致）
//   - 缩写：|净额| ≥ 10000 → 1.2万；< 10000 → 整数无小数（日历格子约束）
// ============================================================================

export type MoneyType = 'expense' | 'income' | 'transfer'

/** 收入绿 / 支出红 / 转账中性 */
export function amountColorVar(type: MoneyType): string {
  if (type === 'income') return 'var(--color-success)'
  if (type === 'expense') return 'var(--color-danger)'
  // 转账：中性色（它不是收支）
  return 'var(--color-text-primary)'
}

/**
 * 带符号金额（两位小数，与详情页线框一致）：
 *   收入：+ ¥ 199.00
 *   支出：− ¥ 63.33
 *   转账：¥ 63.33（不带符号，中性）
 * 负号用 U+2212（−）。
 */
export function formatSignedAmount(amount: number, type: MoneyType): string {
  const abs = Math.abs(amount).toFixed(2)
  if (type === 'income') return `+ ¥ ${abs}`
  if (type === 'expense') return `− ¥ ${abs}`
  return `¥ ${abs}`
}

/**
 * 月历净额数字（整数，无小数）：
 *   > 0  → 绿，带 +（如 +85）
 *   < 0  → 红，带 −（如 −60）
 *   = 0  → 中性（仍显示 0）
 * 缩写：|净额| ≥ 10000 → 1.2万；< 10000 → 整数无小数
 * ⚠️ 无记录（调用方应传 null / 不渲染）不在此函数处理。
 */
export function formatNetAmount(net: number): string {
  if (net === 0) return '0'
  const sign = net > 0 ? '+' : '−'
  const abs = Math.abs(net)
  if (abs >= 10000) {
    const wan = Math.round((abs / 10000) * 10) / 10 // 一位小数
    // 去掉可能的 .0（如 1.0万 → 1万）
    const s = Number.isInteger(wan) ? String(wan) : wan.toString()
    return `${sign}${s}万`
  }
  return `${sign}${Math.round(abs)}`
}

/** 净额颜色：>0 绿 / <0 红 / =0 中性 */
export function netColorVar(net: number): string {
  if (net > 0) return 'var(--color-success)'
  if (net < 0) return 'var(--color-danger)'
  return 'var(--color-text-tertiary)'
}

/** 普通千分位/两位小数展示（如摘要里的 +1,299.00）；不带符号 */
export function formatAmountPlain(amount: number): string {
  return `¥ ${amount.toFixed(2)}`
}

/** 来源 source → 中文标签（v4 还会扩展，先列已知值） */
export function sourceLabel(source?: string | null): string {
  switch (source) {
    case 'balance_adjust': return '余额调整'
    case 'reimburse': return '待报销'
    case 'lend': return '借出'
    case 'borrow': return '借入'
    case 'refund': return '退款'
    default: return ''
  }
}
