/**
 * 财务模块 · 共享常量（桌面端）
 *
 * 依据：md/spec-20260922-v2/01 §2.5 / §2.7（数据块周期与两态持久化）
 *      + 03 §3.2（金额遮罩开关）
 *
 * ⚠️ SYNC 契约（值必须逐字一致，**两端共用同一组 key**）：
 *   1. life-assisitant-ui-mobile/src/constants/finance.ts（唯一真源）
 *   2. life-assisitant-ui-desktop/src/constants/finance.ts（本文件）
 *   ⇒ 同一台机器上移动端 WebView 与桌面浏览器共享 localStorage 时，
 *      「用户在一端选了另一段也跟着变」是 `01` §2.7 写明的**期望行为**。
 *
 * 这些是「这台设备上的显示偏好」—— **入库是错的**（D11，先例：`ls:period:masked`）。
 */

/** 数据块周期（week | month | year） */
export const SUMMARY_PERIOD_KEY = 'ls:finance:summaryPeriod'
/** 左块面（income | expense） */
export const SUMMARY_CARD_LEFT_KEY = 'ls:finance:cardLeft'
/** 右块面（budget | net） */
export const SUMMARY_CARD_RIGHT_KEY = 'ls:finance:cardRight'

/** 财务金额遮罩开关（spec-20260922-v2 · 03 §3.2，设备级、不入库） */
export const FINANCE_MASK_KEY = 'ls:finance:masked'

/* ==================== localStorage 安全读写（与移动端同容错策略） ====================
 * 隐私模式 / 禁存储时 localStorage 会抛 —— 偏好丢失可接受，白屏不可接受。 */

export function lsGet(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export function lsSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* 写入失败 = 本机记住不了，下次进页面回默认，可接受 */
  }
}
