/**
 * 纪念日 / 倒数日 API（桌面端）
 * 路径前缀：/anniversaries
 *
 * SYNC-FROM-MOBILE: life-assisitant-ui-mobile/src/api/anniversary.ts
 * SYNC-FROM-BACKEND: life-assisitant-api/internal/controller/anniversary.go
 *                    life-assisitant-api/internal/model/dto/anniversary.go
 *
 * 后端端点（router.go）与权限点：
 *   GET    /anniversaries            anniversary:view   列表（scope=upcoming|month|all）
 *   GET    /anniversaries/upcoming   anniversary:view   首页卡片用精简版（limit 缺省 3，上限 10）
 *   POST   /anniversaries            anniversary:write  新建
 *   PATCH  /anniversaries/:id        anniversary:write  部分更新
 *   DELETE /anniversaries/:id        anniversary:write  删除（204，无响应体）
 *
 * 注意：
 *   - `request.ts` 的响应拦截器已就地脱壳，业务方法拿到裸 data，不要再 `.data`；
 *   - ⚠️ `next_date` / `days_left` 是后端**实时推导**字段（不落库），前端不要自己算
 *     （跨月 / 2 月 29 日 / 31 日边界都由后端 utility/anniversary_next.go 处理）。
 */
import request from './request'
import type {
  AnniversaryItem,
  CreateAnniversaryReq,
  CreateAnniversaryResp,
  ListAnniversariesResp,
  PatchAnniversaryReq,
  PatchAnniversaryResp,
  UpcomingAnniversariesResp,
} from './types'

export const anniversaryApi = {
  /** 列表；scope 缺省 all，limit 为 0 时不限制 */
  list(params?: { scope?: 'upcoming' | 'month' | 'all'; limit?: number }) {
    return request.get<unknown, ListAnniversariesResp>('/anniversaries', { params: params ?? {} })
  },

  /** 首页卡片：最近 N 条（后端上限 10） */
  upcoming(limit = 3) {
    return request.get<unknown, UpcomingAnniversariesResp>('/anniversaries/upcoming', { params: { limit } })
  },

  /** 新建 */
  create(data: CreateAnniversaryReq) {
    return request.post<unknown, CreateAnniversaryResp>('/anniversaries', data)
  },

  /** 部分更新（只传要改的字段；remind_days 传了就是整体覆盖） */
  patch(id: string, data: Omit<PatchAnniversaryReq, 'id'>) {
    return request.patch<unknown, PatchAnniversaryResp>(`/anniversaries/${id}`, data)
  },

  /** 删除（204） */
  remove(id: string) {
    return request.delete<unknown, void>(`/anniversaries/${id}`)
  },
}

export default anniversaryApi

export type { AnniversaryItem }
