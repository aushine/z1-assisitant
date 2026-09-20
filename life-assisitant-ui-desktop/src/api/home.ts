import request from './request'
import type { HomeResp } from './types'

/**
 * 首页聚合 API
 * 规范：md/plan-260807/00-plan-overview.md · 4.3
 */
export const homeApi = {
  /** 获取首页聚合数据 */
  fetch() {
    return request.get<unknown, HomeResp>('/home')
  },
}
