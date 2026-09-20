/**
 * 时间格式化工具（会话诊断类展示共用）。
 *
 * 从 pages/me/sync.tsx 的内联实现抽出：同步详情页与左下角快捷面板要显示
 * 同一个「最后同步」时间，各写一份迟早漂移。
 */

/** 把 ISO 时间转成「刚刚 / N 分钟前 / N 小时前 / N 天前」；空值回落「从未」 */
export function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return '从未'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const diff = Date.now() - d.getTime()
  // 时钟偏差容忍：服务端时间略快时 diff 为负，别显示成负数
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  return `${Math.floor(diff / 86_400_000)} 天前`
}
