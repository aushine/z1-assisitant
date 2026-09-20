/**
 * 表单校验函数
 * 集中在工具层便于复用 + 单元测试
 */

/** 邮箱正则 */
const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/

/** 中国大陆手机号正则（11 位，1 开头） */
const PHONE_RE = /^1[3-9]\d{9}$/

/** 用户名（4-32 位，字母/数字/下划线/中划线） */
const USERNAME_RE = /^[A-Za-z0-9_-]{4,32}$/

/**
 * 是否为合法邮箱
 */
export function isEmail(v: string): boolean {
  return EMAIL_RE.test(v)
}

/**
 * 是否为合法手机号（中国大陆）
 */
export function isPhone(v: string): boolean {
  return PHONE_RE.test(v)
}

/**
 * 是否为合法用户名
 */
export function isUsername(v: string): boolean {
  return USERNAME_RE.test(v)
}

/**
 * 是否为强密码（≥ 8 位，包含字母+数字，可选特殊字符）
 * spec/20-登录认证.md §3.2 要求至少字母+数字，长度 6-32
 */
export function isStrongPassword(v: string): boolean {
  if (v.length < 6 || v.length > 32) return false
  const hasLetter = /[A-Za-z]/.test(v)
  const hasDigit = /\d/.test(v)
  return hasLetter && hasDigit
}

/**
 * 账号验证：邮箱 / 手机号 / 用户名 任一即可
 */
export function validateAccount(v: string): { valid: boolean; msg: string } {
  const trimmed = (v || '').trim()
  if (!trimmed) return { valid: false, msg: '请输入账号' }
  if (isEmail(trimmed)) return { valid: true, msg: '' }
  if (isPhone(trimmed)) return { valid: true, msg: '' }
  if (isUsername(trimmed)) return { valid: true, msg: '' }
  return { valid: false, msg: '请输入正确的账号（邮箱/手机号/4-32位用户名）' }
}

/**
 * 密码验证（仅做基础长度校验，强弱由后端判定）
 */
export function validatePassword(v: string): { valid: boolean; msg: string } {
  if (!v) return { valid: false, msg: '请输入密码' }
  if (v.length < 6) return { valid: false, msg: '密码至少 6 位' }
  if (v.length > 32) return { valid: false, msg: '密码最多 32 位' }
  return { valid: true, msg: '' }
}

/**
 * 验证金额（分）—— 用于记账模块
 * @param amount 金额（单位：分）
 */
export function validateAmount(amount: number): { valid: boolean; msg: string } {
  if (Number.isNaN(amount) || !Number.isFinite(amount)) {
    return { valid: false, msg: '金额无效' }
  }
  if (amount <= 0) return { valid: false, msg: '金额必须大于 0' }
  if (amount > 99999999999) return { valid: false, msg: '金额超过上限' }
  return { valid: true, msg: '' }
}
