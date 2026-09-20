import request from './request'
import type { TimelineQuery, TimelineResp } from './types'

/**
 * 生活时间线 API
 * 规范：md/design-260917/04-功能深化-私人管家.md · §4
 * - 聚合任务完成 / 习惯打卡 / 记账（不含转账）/ 心情，按完整时间戳倒序
 * - GET /timeline?date=YYYY-MM-DD&page=&page_size=
 */
export const timelineApi = {
  /** 获取某天时间线（跨模块聚合，倒序） */
  getTimeline(params?: TimelineQuery) {
    return request.get<unknown, TimelineResp>('/timeline', { params })
  },
}
