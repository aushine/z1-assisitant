/**
 * 健康 API
 * 路径前缀：/health
 *
 * SYNC-FROM-BACKEND: life-assisitant-api/internal/controller/health.go
 *                    life-assisitant-api/internal/model/dto/health.go
 * 契约文档：md/spec-20260919-v1/05-API规范.md（health 段）
 *
 * 后端端点（router.go）与权限点：
 *   GET    /health/overview      health:view    概览卡 + 引导态所需的一切
 *   GET    /health/calendar      health:view    月历标记（只返回有标记的日期）
 *   GET    /health/days          health:view    区间日记
 *   GET    /health/days/:date    health:view    单日详情
 *   PUT    /health/days/:date    health:write   写日记（整体覆盖，见下方语义）
 *   DELETE /health/days/:date    health:write   删日记（返回 204，无响应体）
 *   GET    /health/settings      health:view    设置（懒创建，永远有值）
 *   PATCH  /health/settings      health:write   部分更新设置
 *   POST   /health/setup         health:write   引导向导提交（一次性）
 *
 *   GET    /health/events        health:view    时间轴事件（单日或区间）
 *   POST   /health/events        health:write   追加一次记录
 *   PATCH  /health/events/:id    health:write   改一次记录（date / metric_key 不可改）
 *   DELETE /health/events/:id    health:write   删一次记录（返回 204）
 *
 * ⚠️ 分工（2026-09-19 起，不可逆）：
 *   身体指标（water / bbt / weight / sleep / bowel）→ **只走 events**（一天多次、不延续）
 *   经期块 period + 心情块 moods + 备注            → 仍走 PUT /health/days/:date（一天一张）
 *
 * 注意：
 *   - `request.ts` 的响应拦截器已就地脱壳，业务方法拿到的就是 data 本身；
 *   - 204 已在拦截器里转成 null，所以删除类方法的返回类型是 void；
 *   - 整体覆盖语义：PUT 没给的字段置「未记录」，period / moods 子块整体不传 = 不触碰既有行；
 *     合并逻辑封装在 src/stores/health.ts 的 saveDay，本文件只负责收发。
 */
import { http } from './request'
import type {
  CreateHealthEventReq,
  CreateHealthEventResp,
  HealthCalendarResp,
  HealthDayDetailResp,
  HealthOverviewResp,
  HealthSettings,
  HealthSetupReq,
  HealthSetupResp,
  ListHealthDaysResp,
  ListHealthEventsResp,
  PatchHealthEventReq,
  PatchHealthEventResp,
  PatchHealthSettingsReq,
  UpsertHealthDayReq,
  UpsertHealthDayResp,
} from './types'

export const healthApi = {
  /** 概览卡 + 引导态（date 可选，用于补记/跨时区场景） */
  overview(date?: string): Promise<HealthOverviewResp> {
    return http.get<HealthOverviewResp>('/health/overview', { params: date ? { date } : {} })
  },

  /** 月历标记（month 必填，YYYY-MM；只返回有标记的日期） */
  calendar(month: string): Promise<HealthCalendarResp> {
    return http.get<HealthCalendarResp>('/health/calendar', { params: { month } })
  },

  /** 区间日记（闭区间，跨度 ≤366 天） */
  listDays(start: string, end: string): Promise<ListHealthDaysResp> {
    return http.get<ListHealthDaysResp>('/health/days', { params: { start, end } })
  },

  /** 单日详情；后端无记录时 day 为 null（不是 404） */
  getDay(date: string): Promise<HealthDayDetailResp> {
    return http.get<HealthDayDetailResp>(`/health/days/${date}`)
  },

  /**
   * 写某天日记（整体覆盖）。
   * 合并（取回→改→整体提交）在 store 层完成，本方法只负责发完整请求。
   * period / moods 子块缺省不传 = 不触碰既有行。
   */
  upsertDay(date: string, data: Omit<UpsertHealthDayReq, 'date'>): Promise<UpsertHealthDayResp> {
    return http.put<UpsertHealthDayResp>(`/health/days/${date}`, { ...data, date })
  },

  /** 删除某天记录（204） */
  deleteDay(date: string): Promise<void> {
    return http.delete<void>(`/health/days/${date}`)
  },

  /** 取设置（懒创建，不会 404） */
  getSettings(): Promise<HealthSettings> {
    return http.get<HealthSettings>('/health/settings')
  },

  /** 部分更新设置 */
  patchSettings(data: PatchHealthSettingsReq): Promise<HealthSettings> {
    return http.patch<HealthSettings>('/health/settings', data)
  },

  /** 引导向导提交（一次性） */
  setup(data: HealthSetupReq): Promise<HealthSetupResp> {
    return http.post<HealthSetupResp>('/health/setup', data)
  },

  /* ==================== 时间轴事件 ==================== */

  /**
   * 时间轴事件列表。
   * date 与 (start, end) 二选一；两个都不给 → 后端默认查今天。
   * 单日查询时响应里带 summary（当天从 events 聚合的汇总）。
   */
  listEvents(params: {
    date?: string
    start?: string
    end?: string
    metric_key?: string
  }): Promise<ListHealthEventsResp> {
    return http.get<ListHealthEventsResp>('/health/events', { params })
  },

  /**
   * 追加一次记录。
   * ⚠️ time 不传 = 服务端当前时刻 —— 前端不要自己算（客户端时钟可能不准/跨时区）。
   */
  createEvent(data: CreateHealthEventReq): Promise<CreateHealthEventResp> {
    return http.post<CreateHealthEventResp>('/health/events', data)
  },

  /** 改一次记录（date / metric_key 不可改，要挪到别处请删除+新建） */
  patchEvent(id: string, data: Omit<PatchHealthEventReq, 'id'>): Promise<PatchHealthEventResp> {
    return http.patch<PatchHealthEventResp>(`/health/events/${id}`, data)
  },

  /** 删一次记录（204） */
  deleteEvent(id: string): Promise<void> {
    return http.delete<void>(`/health/events/${id}`)
  },
}

export default healthApi
