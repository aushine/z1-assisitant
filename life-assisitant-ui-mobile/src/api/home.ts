/**
 * 首页聚合 API
 * 路径前缀：/home（后端 GET /home，一次返回 KPI + 今日任务/习惯 + 本月财务）
 */
import { http } from './request'
import type { HomeResp } from './types'

export const homeApi = {
  /** 首页聚合数据 */
  fetch(): Promise<HomeResp> {
    return http.get<HomeResp>('/home')
  },
}
