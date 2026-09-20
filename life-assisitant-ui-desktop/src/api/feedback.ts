import request from './request'

/**
 * 反馈 API
 * 规范：md/plan-260807/02-frontend-tasks.md · M4
 */
export interface CreateFeedbackReq {
  type: 'bug' | 'suggestion' | 'other'
  content: string
  contact?: string
}

export const feedbackApi = {
  /** 提交反馈 */
  create(data: CreateFeedbackReq) {
    return request.post<unknown, any>('/feedback', data)
  },
}
