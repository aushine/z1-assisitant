// ============================================================================
// 金额表达式求值（桌面端）
//
// ⚠️ 与移动端 `utils/calc.ts` **同语义**（两端独立工程无共享包，靠同一张用例表对齐，
//    02 §2.2——函数名与返回字段名 `{ cents, rounded, valid }` 两端一致）：
//   规则 1 · 左到右，不做优先级（1+2×3 → 9，不是 7）
//   规则 2 · 全程在「分」上做整数运算（防浮点脏值，0.1+0.2 → 0.30）
//            加：a + b / 减：a − b / 乘：Math.round(a * b / 100)
//            除：Math.round(a * 100 / b) —— 除不尽四舍五入到分
//   规则 3 · 发生舍入 → rounded = true（UI 用「≈」而非「=」，不弹 toast）
//   上限 ·  单项与结果 ≤ 99,999,999.99（分），超限 invalid
//   除数 0 · invalid
//
// 桌面端形态 = D6 表达式输入（不做自绘键盘）：+ - * / × ÷，全角＋－×÷、
// U+2212 − 均接受（求值前半角化）；尾随运算符丢弃；空表达式视为 0。
// ============================================================================

/** 单项 / 结果上限：99,999,999.99 元（分） */
export const MAX_AMOUNT_CENTS = 9999999999

export interface EvalResult {
  /** 求值结果（分，整数） */
  cents: number
  /** 求值过程中是否发生了舍入（除不尽 / 输入小数位 > 2 被舍入） */
  rounded: boolean
  /** 表达式是否有效（除零 / 超上限 / 语法非法 → false） */
  valid: boolean
}

type Op = '+' | '-' | '*' | '/'

/** 半角化 + 归一：全角＋－×÷、U+2212 −、中文顿号分隔的 ×÷ 都转成 ASCII */
function normalize(expr: string): string {
  return expr
    .replace(/＋/g, '+')
    .replace(/[－－−–]/g, '-')
    .replace(/[×✕✖]/g, '*')
    .replace(/[÷／]/g, '/')
    .trim()
}

/**
 * 逐字符切 token：
 *  - 第二个小数点被忽略（但后续数字仍接在同一小数上：1.2.3 → 1.23，与键盘连按同语义）
 *  - 前导零归一（007 → 7，0.07 正常）
 *  - 以 . 开头补前导零（.5 → 0.5）
 *  - 连续运算符取最后一个（与移动端「替换前一个」同语义：199+× → 199×）
 *  - 以运算符开头 → invalid（与移动端「忽略该次按键」等效的最严处理）
 *  - 非法字符 → null（整个表达式 invalid）
 * 返回的项为「元」字符串，交由 parseTerm 转分。
 */
function tokenize(expr: string): { terms: string[]; ops: Op[] } | null {
  const terms: string[] = []
  const ops: Op[] = []
  let cur = ''
  let curHasDot = false
  let curHasDigit = false
  let sawOp = false
  let leadingOp = false

  const flush = () => {
    if (cur === '') return
    terms.push(cur)
    cur = ''
    curHasDot = false
    curHasDigit = false
  }

  for (const ch of expr) {
    if (ch >= '0' && ch <= '9') {
      cur += ch
      curHasDigit = true
      sawOp = false
      continue
    }
    if (ch === '.') {
      // 第二个小数点：忽略（cur 保持，后续数字继续追加）
      if (curHasDot) continue
      // 补前导零：.5 → 0.5
      if (!curHasDigit && cur === '') cur = '0'
      curHasDot = true
      cur += ch
      continue
    }
    if (ch === '+' || ch === '-' || ch === '*' || ch === '/') {
      if (sawOp) {
        // 连续运算符：替换前一个（199+× → 199×）
        ops[ops.length - 1] = ch
      } else {
        flush()
        ops.push(ch)
      }
      sawOp = true
      if (ops.length === 1 && terms.length === 0) leadingOp = true
      continue
    }
    // 空白忽略；其余字符非法
    if (/\s/.test(ch)) continue
    return null
  }
  flush()

  if (terms.length === 0) {
    // 纯运算符（无数字）→ invalid；纯空串由调用方先拦截
    return { terms: [], ops: [] }
  }
  // 以运算符开头（×199）→ invalid
  if (leadingOp) return null
  // 尾随运算符丢弃（199+ → 199）
  if (ops.length === terms.length) ops.pop()
  if (ops.length !== terms.length - 1) return null
  return { terms, ops }
}

/** 「元」字符串 → 分。小数位 > 2 时四舍五入到分并标记 rounded */
function parseTerm(term: string): { cents: number; rounded: boolean } | null {
  // 前导零归一（保留 0. 开头）
  const m = /^(0*)(\d*)(\.\d*)?$/.exec(term)
  if (!m) return null
  const intPart = m[2] || '0'
  const fracPart = (m[3] || '').slice(1) // 去掉点
  let cents: number
  let rounded = false
  if (fracPart.length <= 2) {
    cents = Number(intPart) * 100 + Number((fracPart + '00').slice(0, 2) || '0')
  } else {
    // 小数位 > 2：四舍五入到分（199.999 → 200.00，rounded = true）
    const v = Number(`${intPart}.${fracPart}`) * 100
    if (!Number.isFinite(v)) return null
    cents = Math.round(v)
    rounded = true
  }
  if (cents > MAX_AMOUNT_CENTS) return null
  return { cents, rounded }
}

/**
 * 求值金额表达式（左到右、分上整数运算）。
 * 空表达式 → { cents: 0, rounded: false, valid: true }（提交时由「请输入金额」拦截）。
 */
export function evalAmountExpr(raw: string): EvalResult {
  const expr = normalize(raw ?? '')
  if (expr === '') return { cents: 0, rounded: false, valid: true }

  const t = tokenize(expr)
  if (!t) return { cents: 0, rounded: false, valid: false }
  if (t.terms.length === 0) return { cents: 0, rounded: false, valid: true }

  let rounded = false
  const first = parseTerm(t.terms[0])
  if (!first) return { cents: 0, rounded: false, valid: false }
  rounded = rounded || first.rounded
  let acc = first.cents

  for (let i = 0; i < t.ops.length; i++) {
    const term = parseTerm(t.terms[i + 1])
    if (!term) return { cents: 0, rounded: false, valid: false }
    rounded = rounded || term.rounded
    const b = term.cents
    switch (t.ops[i]) {
      case '+':
        acc = acc + b
        break
      case '-':
        acc = acc - b
        break
      case '*': {
        // 乘法在分上做：Math.round(a * b / 100)（可能有舍入，标记 rounded）
        const prod = acc * b
        const val = prod / 100
        acc = Math.round(val)
        if (acc !== val) rounded = true
        break
      }
      case '/':
        if (b === 0) return { cents: 0, rounded: false, valid: false }
        // 除不尽在分上四舍五入（除尽时值不变，rounded 不误标）
        const numer = acc * 100
        acc = Math.round(numer / b)
        if (acc !== numer / b) rounded = true
        break
    }
    if (!Number.isSafeInteger(acc) || acc > MAX_AMOUNT_CENTS) {
      return { cents: 0, rounded: false, valid: false }
    }
  }

  if (acc < 0) return { cents: 0, rounded: false, valid: false }
  return { cents: acc, rounded, valid: true }
}

/** 分 → 元字符串（两位小数） */
export function centsToAmount(cents: number): string {
  return (cents / 100).toFixed(2)
}

/** 预览文本：无效 → null；舍入 → ≈ 63.33；精确 → = 66.50；无运算符纯数字 → null（不需要预览行） */
export function previewExpr(raw: string): string | null {
  const expr = normalize(raw ?? '')
  if (expr === '' || !/[+\-*/]/.test(expr)) return null
  const r = evalAmountExpr(raw)
  if (!r.valid) return null
  return `${r.rounded ? '≈' : '='} ${centsToAmount(r.cents)}`
}
