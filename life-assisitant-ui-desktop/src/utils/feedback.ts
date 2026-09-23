import { Toast, Modal } from '@douyinfe/semi-ui'

/**
 * 全局操作反馈唯一出口（spec-20260922-v2 · 05 §3.1 / 实施清单 #20）。
 * 与移动端 `life-assisitant-ui-mobile/src/utils/feedback.ts` 同 API 形状，
 * 底层换成 Semi 的 Toast / Modal.confirm（引入方式与仓库现有用法一致，
 * 见 stores/*.ts 的 `import { Toast } from '@douyinfe/semi-ui'`、
 * MainLayout.tsx 的 `Modal.confirm`）。
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
 */
export const feedback = {
  /** R3 失败：必须 */
  fail: (msg: string) => {
    Toast.error(msg)
  },
  /**
   * R4 二次确认：不可逆操作前。
   * Vant 端 showConfirmDialog 返回 Promise（确认 resolve / 取消 reject），
   * Semi 的 Modal.confirm 是回调式，这里包一层 Promise 保持双端调用形状一致。
   */
  confirm: (opts: { title?: string; message: string; confirmText?: string }) =>
    new Promise<void>((resolve, reject) => {
      Modal.confirm({
        title: opts.title ?? '确认',
        content: opts.message,
        okText: opts.confirmText ?? '确定',
        onOk: () => resolve(),
        onCancel: () => reject(new Error('cancel')),
      })
    }),
  /** R2 批量完成（N 条） */
  batchDone: (n: number, unit = '项') => {
    Toast.info(`已处理 ${n} ${unit}`)
  },
  /**
   * R2 破坏性完成（仅删除 / 冲正），1500ms 少挡视线（Semi 默认 3000ms）。
   * ⚠️ 实装 semi-ui 2.101 的 Toast.info 只接受单个 opts 参数（无 (content, options) 重载），
   * 故用 { content, duration } 对象形式。
   */
  destructiveDone: (msg: string) => {
    Toast.info({ content: msg, duration: 1500 })
  },
}
