/**
 * 设备标识（移动端）
 *
 * 后端 `POST /auth/login` 与 `POST /auth/refresh` 的 `device_id` 都是
 * `v:"required"`，且它是「7 天免登录」的绑定维度 —— refresh_token 与
 * 签发时的 device_id 绑定，换了 device_id 刷新会被判为非法。
 *
 * ⚠️ 此前这段实现被复制了两份（api/request.ts 与 stores/user.ts），
 *    两边算法虽然一致，但**存储键与格式一旦分叉就会出现「登录 7 天免登录
 *    失效」这类极难排查的问题**（登录写 A 值、刷新读 B 值）。
 *    现在收口到这一个来源，其余文件只 import。
 */

const DEVICE_ID_KEY = 'device_id'

/** 读取或生成设备 ID（首次调用即持久化，后续恒定不变） */
export function getDeviceId(): string {
  let id = ''
  try {
    id = localStorage.getItem(DEVICE_ID_KEY) || ''
  } catch {
    id = ''
  }
  if (!id) {
    id = `d_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
    try {
      localStorage.setItem(DEVICE_ID_KEY, id)
    } catch {
      /* 隐私模式下写入失败：本次会话内仍返回同一个生成值 */
    }
  }
  return id
}
