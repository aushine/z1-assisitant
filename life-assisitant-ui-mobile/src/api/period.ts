/**
 * 经期 API
 * 路径前缀：/period
 *
 * SYNC-FROM-BACKEND: life-assisitant-api/internal/controller/period.go
 *                    life-assisitant-api/internal/model/dto/period.go
 * 契约文档：md/spec-260919/05-API规范.md
 *
 * 后端端点（router.go）与权限点：
 *   GET    /period/overview      period:view    概览卡 + 引导态所需的一切
 *   GET    /period/calendar      period:view    月历标记（只返回有标记的日期）
 *   GET    /period/days          period:view    区间日记
 *   GET    /period/days/:date    period:view    单日详情
 *   GET    /period/cycles        period:view    周期历史
 *   GET    /period/settings      period:view    设置（懒创建，永远有值）
 *   GET    /period/report        period:view    周期报告
 *   PUT    /period/days/:date    period:write   写日记（整体覆盖，事务内联动 mood_logs）
 *   DELETE /period/days/:date    period:write   删日记（返回 204，无响应体）
 *   PATCH  /period/settings      period:write   部分更新设置
 *   POST   /period/setup         period:write   引导向导提交（一次性）
 *   PATCH  /period/cycles/:id    period:manage  人工修正周期起止
 *   POST   /period/reset         period:manage  整模块重置（需 confirm:"RESET"）
 *
 * 注意：
 *   - `request.ts` 的响应拦截器已就地脱壳，业务方法拿到的就是 data 本身；
 *   - 204 已在拦截器里转成 null，所以删除类方法的返回类型是 void；
 *   - 隐私遮罩（👁）是设备级 localStorage 状态，**不经过任何接口**。
 */
import { http } from './request'
import type {
  PeriodCalendarResp,
  PeriodCyclePatchReq,
  PeriodCyclePatchResp,
  PeriodCyclesResp,
  PeriodDayDetailResp,
  PeriodDayUpsertReq,
  PeriodDayUpsertResp,
  PeriodDaysResp,
  PeriodOverviewResp,
  PeriodReportResp,
  PeriodSettings,
  PeriodSettingsPatchReq,
  PeriodSetupReq,
  PeriodSetupResp,
} from './types'

export const periodApi = {
  /** 概览卡 + 引导态（date 可选，用于补记/跨时区场景） */
  overview(date?: string): Promise<PeriodOverviewResp> {
    return http.get<PeriodOverviewResp>('/period/overview', { params: date ? { date } : {} })
  },

  /** 月历标记（month 必填，YYYY-MM） */
  calendar(month: string): Promise<PeriodCalendarResp> {
    return http.get<PeriodCalendarResp>('/period/calendar', { params: { month } })
  },

  /** 区间日记（闭区间，跨度 ≤366 天） */
  listDays(start: string, end: string): Promise<PeriodDaysResp> {
    return http.get<PeriodDaysResp>('/period/days', { params: { start, end } })
  },

  /** 单日详情；后端无记录时 day 为 null（不是 404） */
  getDay(date: string): Promise<PeriodDayDetailResp> {
    return http.get<PeriodDayDetailResp>(`/period/days/${date}`)
  },

  /** 写某天日记（整体覆盖：没给的字段一律置为「未记录」） */
  upsertDay(date: string, data: Omit<PeriodDayUpsertReq, 'date'>): Promise<PeriodDayUpsertResp> {
    return http.put<PeriodDayUpsertResp>(`/period/days/${date}`, { ...data, date })
  },

  /** 删除某天记录（204） */
  deleteDay(date: string): Promise<void> {
    return http.delete<void>(`/period/days/${date}`)
  },

  /** 周期历史（最近 limit 个） */
  listCycles(limit = 12): Promise<PeriodCyclesResp> {
    return http.get<PeriodCyclesResp>('/period/cycles', { params: { limit } })
  },

  /** 人工修正周期（period:manage） */
  patchCycle(id: string, data: PeriodCyclePatchReq): Promise<PeriodCyclePatchResp> {
    return http.patch<PeriodCyclePatchResp>(`/period/cycles/${id}`, data)
  },

  /** 取设置（懒创建，不会 404） */
  getSettings(): Promise<PeriodSettings> {
    return http.get<PeriodSettings>('/period/settings')
  },

  /** 部分更新设置 */
  patchSettings(data: PeriodSettingsPatchReq): Promise<PeriodSettings> {
    return http.patch<PeriodSettings>('/period/settings', data)
  },

  /** 引导向导提交（一次性） */
  setup(data: PeriodSetupReq): Promise<PeriodSetupResp> {
    return http.post<PeriodSetupResp>('/period/setup', data)
  },

  /** 整模块重置（需 confirm:"RESET"，204） */
  reset(): Promise<void> {
    return http.post<void>('/period/reset', { confirm: 'RESET' })
  },

  /** 周期报告 */
  report(range: '6m' | '12m' = '6m'): Promise<PeriodReportResp> {
    return http.get<PeriodReportResp>('/period/report', { params: { range } })
  },
}

export default periodApi
