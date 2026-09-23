import { showFailToast, showConfirmDialog, showToast } from 'vant'

/**
 * 全局操作反馈唯一出口（spec-20260922-v2 · 05 §3.1 / 实施清单 #19）。
 *
 * ⚠️ 刻意【不提供】通用的 success() —— 见 `md/spec-20260922-v2/05-操作反馈规范.md` §2。
 * 想弹"成功"，必须显式选下面两个之一，并在代码注释里写清为什么结果不可见：
 *   · batchDone        —— 数量型结果（N 条），信息有增量
 *   · destructiveDone  —— 删除/冲正等不可逆操作，用户需要"确认发生了"
 * 其余一律不要提示：结果已在屏幕上。
 *
 * 判定规则速记（05 §2）：
 *   R1 结果当前屏可见 → 不提示；R2 不可见/异步/数量型 → 提示；
 *   R3 失败 → 必须提示（任何情况下不许静默失败）；R4 不可逆 → 二次确认。
 *
 * ⚠️ 实现备注：05 §3.1 示例写的 `showToast(msg, { duration })` 是 Vant 3 形状，
 * Vant 4（实装 4.10.2）的 showToast 只接受单个 string | ToastOptions 参数，
 * 故 destructiveDone 以 `showToast({ message, duration: 1500 })` 实现，语义不变。
 */
export const feedback = {
  /** R3 失败：必须 */
  fail: (msg: string) => showFailToast(msg),
  /** R4 二次确认：不可逆操作前 */
  confirm: (opts: { title?: string; message: string; confirmText?: string }) =>
    showConfirmDialog({
      title: opts.title ?? '确认',
      message: opts.message,
      confirmButtonText: opts.confirmText ?? '确定',
    }),
  /** R2 批量完成（N 条） */
  batchDone: (n: number, unit = '项') => showToast(`已处理 ${n} ${unit}`),
  /** R2 破坏性完成（仅删除 / 冲正） */
  destructiveDone: (msg: string) => showToast({ message: msg, duration: 1500 }),
}
