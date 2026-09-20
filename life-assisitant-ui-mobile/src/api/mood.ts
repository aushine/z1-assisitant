/**
 * 心情 / 精力 API
 * 路径前缀：/moods
 *
 * SYNC-FROM-BACKEND: life-assisitant-api/internal/controller/mood.go
 *                    life-assisitant-api/internal/model/dto/mood.go
 * 最后同步：2026-09-19（按小时记录；一天可有多条，心情/精力向前延续）
 *
 * 后端端点（router.go）：
 *   GET /moods/timeline  权限点 mood:view   某天时间线（按小时）
 *   PUT /moods           权限点 mood:write  记录/修改某天某个小时（三态语义）
 *   GET /moods/today     权限点 mood:view   某天最后一条（含向前延续填充）
 *   GET /moods           权限点 mood:view   区间列表（原始小时行）
 *
 * 三态语义（PUT /moods）：
 *   - 字段缺省 = 不动既有值（新建行时取向前延续值）
 *   - mood:0 / energy:0 / note:"" = 显式清空该字段
 *   - 三字段最终全空 → 后端删掉空行，返回 { item: null }
 *
 * ⚠️ 响应拦截器已就地脱壳：业务方法拿到的是裸数据（MoodTimelineResp 本身），不要再 .data。
 */
import { http } from './request'
import type {
  ListMoodsQuery,
  ListMoodsResp,
  MoodHourItem,
  MoodTimelineResp,
  MoodUpsertReq,
  MoodUpsertResp,
} from './types'

export const moodApi = {
  /** 某天心情时间线（GET /moods/timeline；date 缺省 = 今天） */
  getTimeline(date?: string): Promise<MoodTimelineResp> {
    return http.get<MoodTimelineResp>('/moods/timeline', { params: date ? { date } : {} })
  },

  /**
   * 记录 / 修改某天某个小时（PUT /moods）。
   * 三态语义：字段缺省 = 不动；0 / '' = 显式清空；全空 → 后端删行返回 { item: null }。
   */
  upsert(data: MoodUpsertReq): Promise<MoodUpsertResp> {
    return http.put<MoodUpsertResp>('/moods', data)
  },

  /**
   * 取某天最后一条心情（GET /moods/today；含向前延续填充）。
   * 不传 date 取服务端当天；无记录时返回 null。首页紧凑选择器继续用这个。
   */
  getToday(date?: string): Promise<MoodHourItem | null> {
    return http.get<MoodHourItem | null>('/moods/today', { params: date ? { date } : {} })
  },

  /** 区间心情记录（GET /moods；两端日期必填，含 end_date 当天） */
  list(params: ListMoodsQuery): Promise<ListMoodsResp> {
    return http.get<ListMoodsResp>('/moods', { params })
  },
}
