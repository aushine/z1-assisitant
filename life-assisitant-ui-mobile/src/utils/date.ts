/**
 * 日期工具 —— 全端唯一收口点（移动端）
 *
 * 引入原因（Phase 0.9）：`dayjs` 早已在 package.json 里但**零引用**，
 * 各页面各写一份 `pad()` / `todayStr()` / `addDays()` 手写实现，
 * 至少 5 处重复（task / home / record 三个页面 + task store 内部）。
 * 重复实现还有一个隐蔽风险：手写 `new Date()` 拼串极易退化成 UTC，
 * 一旦有人改用 `toISOString()`，东八区在 00:00–08:00 之间就会**跨天**，
 * 打卡 / 任务「今日」判定全部错位。此处统一封死。
 *
 * ⚠️ 硬性约定：
 *   1. 一律使用 `todayDate()` 取「今天」，内部按**本地时区**拼 YYYY-MM-DD；
 *      **禁止** `new Date().toISOString().slice(0,10)`（UTC 跨天）。
 *   2. 「日期字符串」的一律形态是 `YYYY-MM-DD`（后端 due_date / 打卡 date 同款）；
 *      「时间戳」的一律形态是 ISO 8601 字符串（后端 created_at 同款）。
 *      两类不要混用，本文件按命名区分：`...Date` 收 YYYY-MM-DD，
 *      `...Time` / `...DateTime` 收 ISO。
 */

import dayjs from 'dayjs'

/** 中文星期（dayjs 的 locale 只为一个字符，不值得为此加载 locale 包） */
const WEEK_LABELS = ['日', '一', '二', '三', '四', '五', '六'] as const

/** 两位补零 */
function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/* ==================== 今天 / 本地日期 ==================== */

/**
 * 今天的本地日期字符串 `YYYY-MM-DD`。
 * 这是全端取「今天」的**唯一**入口。
 */
export function todayDate(): string {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** 当前时刻的 ISO 8601 字符串（写乐观更新 / 本地临时对象用） */
export function nowISO(): string {
  return new Date().toISOString()
}

/** 当前本地时刻 `HH:mm:ss` */
export function nowTimeString(): string {
  const d = new Date()
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** 取某个 Date 的本地时区偏移，如 `+08:00` */
function timezoneOffset(d: Date): string {
  // getTimezoneOffset() 返回的是「UTC - 本地」的分钟数，东八区为 -480
  const minutes = -d.getTimezoneOffset()
  const sign = minutes >= 0 ? '+' : '-'
  const abs = Math.abs(minutes)
  return `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
}

/**
 * 把 Date 渲染成**带本地时区偏移**的 ISO 8601，如 `2026-09-18T17:04:18+08:00`。
 *
 * 为什么不直接用 `Date.prototype.toISOString()`：它输出的是 UTC，
 * 直接把它的时间部分拼到本地日期上会整体偏移时区差 —— 见 `todayWallClockISO`。
 */
export function toLocalISOString(input?: string | Date | null): string {
  const d = input ? new Date(input) : new Date()
  if (Number.isNaN(d.getTime())) return ''
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    timezoneOffset(d)
  )
}

/**
 * 「某天**此刻**」的带偏移 ISO 8601。
 *
 * 场景：记一笔时用户只选了日期，时间取当前时刻。此前实现是
 *   `` `${localDate}T${new Date().toISOString().slice(11, 19)}Z` ``
 * 即把 **UTC 的时分秒**贴到**本地日期**上还标成 Z —— 东八区会整体偏 8 小时，
 * 且本地 00:00–08:00 期间日期还会差一天。这里改为按本地时区拼装。
 */
export function todayWallClockISO(dateStr?: string | null): string {
  const date = toDateString(dateStr) || todayDate()
  const d = new Date(`${date}T${nowTimeString()}`)
  return toLocalISOString(d)
}

/* ==================== 日期字符串运算 ==================== */

/** 把任意可解析输入规整成 `YYYY-MM-DD`（空值返回 ''） */
export function toDateString(input?: string | Date | null): string {
  if (!input) return ''
  const d = dayjs(input)
  return d.isValid() ? d.format('YYYY-MM-DD') : ''
}

/** 日期字符串加减天数，返回 `YYYY-MM-DD` */
export function addDays(dateStr: string, n: number): string {
  const d = dayjs(dateStr)
  return (d.isValid() ? d : dayjs()).add(n, 'day').format('YYYY-MM-DD')
}

/** 两个日期字符串相差的天数（b - a，按自然日） */
export function diffDays(a: string, b: string): number {
  return dayjs(b).startOf('day').diff(dayjs(a).startOf('day'), 'day')
}

/** 相对今天偏移 n 天的日期字符串（todayDate() 的便捷包装） */
export function dateOffset(n: number): string {
  return addDays(todayDate(), n)
}

/** ISO 时间戳 → `YYYY-MM-DD`（交易分组 key 用） */
export function isoToDate(iso?: string | null): string {
  return toDateString(iso)
}

/* ==================== 展示格式化 ==================== */

/**
 * 日期字符串 → 人类可读的「今天 / 明天 / 昨天 / 跨年 / M月D日」。
 * 任务卡、交易分组的日期标签都用这个，保证两处口径一致。
 */
export function formatDayLabel(dateStr?: string | null): string {
  const s = toDateString(dateStr)
  if (!s) return ''
  if (s === todayDate()) return '今天'
  if (s === addDays(todayDate(), 1)) return '明天'
  if (s === addDays(todayDate(), -1)) return '昨天'

  const d = dayjs(s)
  // 跨年时补上年份，避免「1月5日」在两年前后产生歧义
  return d.year() === dayjs().year() ? `${d.month() + 1}月${d.date()}日` : d.format('YYYY年M月D日')
}

/** 日期字符串 → `M月D日`（不带今天/昨天判断） */
export function formatMonthDay(dateStr?: string | null): string {
  const s = toDateString(dateStr)
  if (!s) return ''
  const d = dayjs(s)
  return `${d.month() + 1}月${d.date()}日`
}

/** 日期字符串 → `YYYY年M月D日 星期X`（记录页 Header） */
export function formatDateFullWeekday(dateStr?: string | null): string {
  const s = toDateString(dateStr || todayDate())
  if (!s) return ''
  const d = dayjs(s)
  return `${d.year()}年${d.month() + 1}月${d.date()}日 星期${WEEK_LABELS[d.day()]}`
}

/** 日期字符串 → `M月D日 周X`（首页 Header） */
export function formatMonthDayWeekday(dateStr?: string | null): string {
  const s = toDateString(dateStr || todayDate())
  if (!s) return ''
  const d = dayjs(s)
  return `${d.month() + 1}月${d.date()}日 周${WEEK_LABELS[d.day()]}`
}

/** ISO 时间戳 → `YYYY-MM-DD HH:mm` */
export function formatDateTime(iso?: string | null): string {
  if (!iso) return ''
  const d = dayjs(iso)
  return d.isValid() ? d.format('YYYY-MM-DD HH:mm') : ''
}

/** ISO 时间戳 → `HH:mm` */
export function formatTime(iso?: string | null): string {
  if (!iso) return ''
  const d = dayjs(iso)
  return d.isValid() ? d.format('HH:mm') : ''
}

/**
 * ISO 时间戳 → 相对时间：刚刚 / N 分钟前 / N 小时前 / 昨天 / N 天前 / M月D日。
 * 同步状态、通知列表用。
 */
export function formatRelativeTime(iso?: string | null): string {
  if (!iso) return ''
  const d = dayjs(iso)
  if (!d.isValid()) return ''

  const minutes = dayjs().diff(d, 'minute')
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`

  const hours = dayjs().diff(d, 'hour')
  if (hours < 24) return `${hours} 小时前`

  const days = dayjs().diff(d, 'day')
  if (days === 1) return '昨天'
  if (days < 30) return `${days} 天前`

  return d.year() === dayjs().year() ? `${d.month() + 1}月${d.date()}日` : d.format('YYYY年M月D日')
}

/** 当前小时数（问候语用） */
export function currentHour(): number {
  return new Date().getHours()
}

/** 按小时返回问候语（首页） */
export function greetingByHour(hour = currentHour()): string {
  if (hour < 6) return '凌晨好'
  if (hour < 11) return '早上好'
  if (hour < 14) return '中午好'
  if (hour < 18) return '下午好'
  return '晚上好'
}

/* ==================== 金额格式化（同属展示层，一并收口） ==================== */

/** 金额 → 千分位字符串（`integer=true` 时不留小数） */
export function formatMoney(n: number, integer = false): string {
  const v = Number.isFinite(n) ? n : 0
  return v.toLocaleString('zh-CN', {
    minimumFractionDigits: integer ? 0 : 2,
    maximumFractionDigits: integer ? 0 : 2,
  })
}
