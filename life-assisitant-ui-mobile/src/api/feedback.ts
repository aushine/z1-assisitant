/**
 * 反馈 API
 * 路径前缀：/feedback
 *
 * SYNC-FROM-BACKEND: life-assisitant-api/internal/controller/sync_feedback.go
 * 最后同步：2026-09-18
 *
 * 权限点：me:feedback。后端以 201 返回 FeedbackResp（不再是空的 void）。
 */
import { http } from './request'
import type { CreateFeedbackReq, FeedbackResp } from './types'

export const feedbackApi = {
  /** 提交反馈（POST /feedback；type 限 bug/suggestion/other，content 1-2000 字） */
  create(data: CreateFeedbackReq): Promise<FeedbackResp> {
    return http.post<FeedbackResp>('/feedback', data)
  },
}
