import request from './request'

/**
 * 同步 API
 * 规范：md/plan-260807/02-frontend-tasks.md · M4
 */
export const syncApi = {
  /** 获取同步状态 */
  status() {
    return request.get<unknown, any>('/sync/status')
  },

  /** 触发同步 */
  trigger() {
    return request.post<unknown, any>('/sync')
  },
}
