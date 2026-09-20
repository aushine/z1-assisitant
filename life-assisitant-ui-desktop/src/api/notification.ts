import request from './request'
import type { Notification, UnreadCountResp, PageResult } from './types'

/**
 * 通知 API
 * 后端已落库（notification 表），全部为真实接口：
 * - 列表：GET /notifications?page=&page_size=（created_at 倒序）
 * - 未读数：GET /notifications/unread-count
 * - 全部已读：POST /notifications/mark-read
 * - 单条已读：POST /notifications/:id/read
 */
export const notificationApi = {
  /** 通知列表（分页，倒序） */
  list(params?: { page?: number; page_size?: number }) {
    return request.get<unknown, PageResult<Notification>>('/notifications', { params })
  },

  /** 获取未读通知数量 */
  unreadCount() {
    return request.get<unknown, UnreadCountResp>('/notifications/unread-count')
  },

  /** 标记所有通知已读 */
  markRead() {
    return request.post<unknown, { affected: number }>('/notifications/mark-read')
  },

  /** 标记单条通知已读 */
  markReadById(id: string) {
    return request.post<unknown, { affected: number }>(`/notifications/${id}/read`)
  },
}
