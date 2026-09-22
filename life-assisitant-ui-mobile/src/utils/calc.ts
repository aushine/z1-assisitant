/**
 * 金额表达式求值（记一笔计算键盘 · 移动端）
 *
 * SYNC-FROM-DESKTOP: life-assisitant-ui-desktop/src/utils/calc.ts
 *   ⚠️ 两端是独立工程（无共享包），靠**同一张 13 条用例表**（02 §3）逐字对齐：
 *   函数名与返回字段名（cents / rounded / valid）两端同名。
 *
 * 求值语义（02 §1.5，必须逐字遵守）：
 *   规则 1 · **从左到右，不做优先级**（1+2×3 → 9，不是 7）
 *   规则 2 · **全程在「分」上做整数运算**（防浮点脏值 0.1+0.2）
 *            加/减：整数分直接加减；乘：Math.round(a*b/100)；除：Math.round(a*100/b)
 *   规则 3 · 除不尽/小数被截 → rounded=true（前端显示 `≈`，不弹 toast）
 *
 * 边界（02 §1.6）：
 *   - 连按两个运算符 → 替换前一个（appendKey 内处理）
 *   - 以运算符开头 → 忽略该次按键
 *   - 多个小数点 → 第二个被忽略；以 `.` 开头 → 自动补 0
 *   - 多个前导零 → 归一（007 → 7；0.07 正常）
 *   - 尾随运算符 → 求值时丢弃（199+ → 199）
 *   - 除数为 0 → valid=false
 *   - 单项与结果上限：≤ 99,999,999.99（9,999,999,999 分），超限拒绝
 */

/** 单项/结果上限：99,999,999.99 元（分） */
export const AMOUNT_MAX_CENTS = 9_999_999_999

/** 求值结果：cents = 金额（分）；rounded = 是否发生过舍入；valid = 表达式是否可采纳 */
export interface EvalResult {
  cents: number
  rounded: boolean
  valid: boolean
}

/** 运算符集合（内部形态：+ - * /） */
const OPERATORS = new Set(['+', '-', '*', '/'])

/** 把用户按键（可含 × ÷ −）归一为内部运算符；非运算符返回 null */
function toInternalOp(ch: string): string | null {
  if (ch === '+') return '+'
  if (ch === '-' || ch === '−') return '-' // − 为 U+2212（显示用减号）
  if (ch === '×' || ch === '*' || ch === 'x' || ch === 'X') return '*'
  if (ch === '÷' || ch === '/') return '/'
  return null
}

/**
 * 把一个数字字面量解析成「分」。
 * - `1.2.3` → 第二个小数点忽略（123 分？不：1.23 → 123 分）
 * - `007` → 7；`.5` → 0.5
 * - `199.999` → 四舍五入到 20000 分，且 rounded=true（小数位 > 2）
 * 返回 null 表示单项超上限。
 */
function parseTermCents(raw: string): { cents: number; rounded: boolean } | null {
  let s = raw.trim()
  if (!s) return { cents: 0, rounded: false }
  // 以 . 开头自动补 0
  if (s.startsWith('.')) s = `0${s}`
  // 归一前导零（保留一个小数点）
  const dot = s.indexOf('.')
  const intPart = dot === -1 ? s : s.slice(0, dot)
  const fracPart = dot === -1 ? '' : s.slice(dot + 1).replace(/\./g, '')
  const intNormalized = String(parseInt(intPart || '0', 10) || 0)
  const normalized = dot === -1 ? intNormalized : `${intNormalized}.${fracPart}`
  const value = Number(normalized)
  if (!Number.isFinite(value)) return { cents: 0, rounded: false }
  // 小数位 > 2 → 四舍五入到分，rounded=true
  const cents = Math.round(value * 100)
  if (cents > AMOUNT_MAX_CENTS) return null
  return { cents, rounded: fracPart.length > 2 }
}

/**
 * 求值一个金额表达式。
 * 无副作用、可单测。空表达式 → { cents: 0, rounded: false, valid: true }
 * （02 §1.6 #9：点「完成」时表达式为空视为 0，提交时由后端「请输入金额」拦住）。
 */
export function evalAmountExpr(expr: string): EvalResult {
  const raw = (expr || '').trim()
  if (!raw) return { cents: 0, rounded: false, valid: true }

  // 半角化 + 分词：数字字面量与运算符交替
  const tokens: string[] = []
  let num = ''
  for (const ch of raw) {
    const op = toInternalOp(ch)
    if (op) {
      // 数字字面量结束（含 `1.2.3` 这类多小数点一起交给 parseTermCents 归一）
      if (num) {
        tokens.push(num)
        num = ''
      }
      tokens.push(op)
    } else if (/[0-9.]/.test(ch)) {
      num += ch
    } else if (!/\s/.test(ch)) {
      // 非法字符（与桌面端 tokenize 一致）→ 整个表达式 invalid
      return { cents: 0, rounded: false, valid: false }
    }
  }
  if (num) tokens.push(num)

  // 表达式不能以运算符开头（防御：appendKey 已挡，这里再兜一次）
  while (tokens.length > 0 && OPERATORS.has(tokens[0])) tokens.shift()
  // 尾随运算符丢弃（02 §1.6 #8）
  while (tokens.length > 0 && OPERATORS.has(tokens[tokens.length - 1])) tokens.pop()
  if (tokens.length === 0) return { cents: 0, rounded: false, valid: true }

  let acc = 0
  let rounded = false
  let pendingOp: string | null = null
  for (let i = 0; i < tokens.length; i++) {
    const tk = tokens[i]
    if (OPERATORS.has(tk)) {
      pendingOp = tk
      continue
    }
    const term = parseTermCents(tk)
    if (!term) return { cents: 0, rounded: false, valid: false }
    rounded = rounded || term.rounded
    if (pendingOp === null) {
      acc = term.cents
    } else if (pendingOp === '+') {
      acc = acc + term.cents
    } else if (pendingOp === '-') {
      acc = acc - term.cents
    } else if (pendingOp === '*') {
      acc = Math.round((acc * term.cents) / 100)
    } else {
      // 除：除数为 0 → 无效；除不尽四舍五入到分（rounded=true）
      if (term.cents === 0) return { cents: 0, rounded: false, valid: false }
      const exact = acc * 100
      const q = exact / term.cents
      if (!Number.isInteger(q)) rounded = true
      acc = Math.round(q)
    }
    pendingOp = null
    // 结果超上限（含中间结果）→ 无效（02 §1.6 #11）
    if (Math.abs(acc) > AMOUNT_MAX_CENTS) return { cents: 0, rounded: false, valid: false }
  }
  return { cents: acc, rounded, valid: true }
}

/** 分 → `xx.xx` 展示串 */
export function formatCents(cents: number): string {
  return (cents / 100).toFixed(2)
}

/**
 * 键盘按键 → 新表达式（纯函数，无副作用）。
 * 返回 null 表示该次按键被拒绝（02 §1.6 #2 以运算符开头 / #11 单项超上限）。
 *
 * key 取值：`0-9` `.` `+` `-` `×` `÷`（运算键显示形态）。
 */
export function appendKey(expr: string, key: string): string | null {
  const op = toInternalOp(key)
  if (op) {
    // 以运算符开头 → 忽略
    if (!expr) return null
    const last = expr[expr.length - 1]
    if (OPERATORS.has(toInternalOp(last) ?? '')) {
      // 连按两个运算符 → 替换前一个
      return expr.slice(0, -1) + key
    }
    return expr + key
  }
  // 数字 / 小数点：找当前数字字面量
  const opMatch = /[+\-−×÷*xX/]/.exec(expr)
  const lastOpIdx = opMatch ? opMatch.index : -1
  const curTerm = lastOpIdx === -1 ? expr : expr.slice(lastOpIdx + 1)

  if (key === '.') {
    if (curTerm.includes('.')) return null // 第二个小数点忽略
    if (!curTerm) return `${expr}0.` // 以 . 开头自动补 0
    return expr + '.'
  }

  // 数字：前导零归一（"0" + 数字 → 直接换；"00" 不出现）
  let nextTerm = curTerm + key
  if (curTerm === '0') nextTerm = key
  // 拼回新表达式并做单项上限校验
  const candidate = (lastOpIdx === -1 ? '' : expr.slice(0, lastOpIdx + 1)) + nextTerm
  const opInTerm = /[+\-−×÷*xX/]/.exec(candidate)
  const termPart = opInTerm ? candidate.slice(opInTerm.index + 1) : candidate
  const parsed = parseTermCents(termPart)
  if (!parsed) return null // 超上限 → 拒绝该次按键
  return candidate
}
