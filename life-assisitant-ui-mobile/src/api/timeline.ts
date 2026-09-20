/**
 * 生活时间线 API
 * 路径前缀：/timeline
 *
 * SYNC-FROM-BACKEND: life-assisitant-api/internal/controller/timeline.go
 *                    life-assisitant-api/internal/model/dto/timeline.go
 * 最后同步：2026-09-18（本模块是移植期**全新增**——移动端此前没有 timeline api）
 *
 * 后端把 task / habit / expense / income / mood 跨模块聚合成统一事件流，
 * 按完整时间戳倒序返回。金额约定：**支出为负、收入为正**。
 */
import { http } from './request'
import type { TimelineQuery, TimelineResp } from './types'

export const timelineApi = {
  /**
   * 取某天时间线（GET /timeline，权限点 timeline:view）
   * date 缺省为服务端当天。
   */
  fetch(params: TimelineQuery = {}): Promise<TimelineResp> {
    return http.get<TimelineResp>('/timeline', { params })
  },
}
