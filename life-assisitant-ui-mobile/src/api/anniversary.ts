/**
 * 纪念日 / 倒数日 API
 * 路径前缀：/anniversaries
 *
 * SYNC-FROM-BACKEND: life-assisitant-api/internal/controller/anniversary.go
 *                    life-assisitant-api/internal/model/dto/anniversary.go
 * 契约文档：md/spec-20260919-v1/07-API规范.md、06-个人中心与纪念日.md
 *
 * 后端端点（router.go）与权限点：
 *   GET    /anniversaries            anniversary:view   列表（scope=upcoming|month|all）
 *   GET    /anniversaries/upcoming   anniversary:view   首页卡片用精简版（limit 缺省 3，上限 10）
 *   POST   /anniversaries            anniversary:write  新建
 *   PATCH  /anniversaries/:id        anniversary:write  部分更新
 *   DELETE /anniversaries/:id        anniversary:write  删除（204，无响应体）
 *
 * 注意：
 *   - `request.ts` 的响应拦截器已就地脱壳，业务方法拿到的就是 data 本身；
 *   - 204 已在拦截器里转成 null，所以删除类方法的返回类型是 void；
 *   - ⚠️ `next_date` / `days_left` 是后端**实时推导**的字段（不落库），
 *     前端**不要自己算**——跨月 / 2 月 29 日 / 31 日边界都由后端处理
 *     （见 utility/anniversary_next.go，17 个单测覆盖）。
 */
import { http } from './request'
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
  list(params?: { scope?: 'upcoming' | 'month' | 'all'; limit?: number }): Promise<ListAnniversariesResp> {
    return http.get<ListAnniversariesResp>('/anniversaries', { params: params ?? {} })
  },

  /** 首页卡片：最近 N 条（后端上限 10） */
  upcoming(limit = 3): Promise<UpcomingAnniversariesResp> {
    return http.get<UpcomingAnniversariesResp>('/anniversaries/upcoming', { params: { limit } })
  },

  /** 新建 */
  create(data: CreateAnniversaryReq): Promise<CreateAnniversaryResp> {
    return http.post<CreateAnniversaryResp>('/anniversaries', data)
  },

  /** 部分更新（只传要改的字段；remind_days 传了就是整体覆盖） */
  patch(id: string, data: Omit<PatchAnniversaryReq, 'id'>): Promise<PatchAnniversaryResp> {
    return http.patch<PatchAnniversaryResp>(`/anniversaries/${id}`, data)
  },

  /** 删除（204） */
  remove(id: string): Promise<void> {
    return http.delete<void>(`/anniversaries/${id}`)
  },
}

export default anniversaryApi

/** 单条类型再导出，便于页面少引一层 */
export type { AnniversaryItem }
