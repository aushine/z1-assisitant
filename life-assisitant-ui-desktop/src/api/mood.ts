import request from './request'
import type {
  MoodHourItem,
  MoodTimelineResp,
  MoodUpsertReq,
  MoodUpsertResp,
  ListMoodsQuery,
  ListMoodsResp,
} from './types'

/**
 * 心情 / 精力 API（按小时记录）
 *
 * SYNC-FROM-BACKEND: life-assisitant-api/internal/controller/mood.go
 *                    life-assisitant-api/internal/model/dto/mood.go
 * SYNC-FROM-MOBILE:  life-assisitant-ui-mobile/src/api/mood.ts
 * 最后同步：2026-09-19（按小时记录；一天可有多条，心情/精力向前延续）
 *
 * 后端端点（router.go）：
 *   GET /moods/timeline  权限点 mood:view   某天时间线（按小时）
 *   PUT /moods           权限点 mood:write  记录/修改某天某个小时（三态语义）
 *   GET /moods/today     权限点 mood:view   某天最后一条（含向前延续填充）
 *   GET /moods           权限点 mood:view   区间列表
 *
 * 三态语义（PUT /moods）：
 *   - 字段缺省 = 不动既有值（新建行时留空，读取时按上一条延续填充）
 *   - mood:0 / energy:0 / note:'' = 显式清空该字段
 *   - 三字段最终全空 → 后端删掉空行，返回 { item: null }
 *
 * ⚠️ 响应拦截器已就地脱壳：业务方法拿到的是裸数据，不要再 .data。
 */
export const moodApi = {
  /** 某天心情时间线（date 缺省 = 今天）。items 里的 mood/energy 后端已做向前延续填充。 */
  getTimeline(params?: { date?: string }) {
    return request.get<unknown, MoodTimelineResp>('/moods/timeline', { params })
  },

  /**
   * 记录 / 修改某天某个小时。
   * 三态语义：字段缺省 = 不动；0 / '' = 显式清空；全空 → 后端删行返回 { item: null }。
   */
  upsert(data: MoodUpsertReq) {
    return request.put<unknown, MoodUpsertResp>('/moods', data)
  },

  /**
   * 取某天最后一条心情（含向前延续填充），无记录返回 null。
   * 首页右上角的紧凑选择器与左下角快捷面板继续用这个。
   */
  getToday(params?: { date?: string }) {
    return request.get<unknown, MoodHourItem | null>('/moods/today', { params })
  },

  /** 区间心情记录（两端日期必填，含 end_date 当天） */
  list(params: ListMoodsQuery) {
    return request.get<unknown, ListMoodsResp>('/moods', { params })
  },
}
