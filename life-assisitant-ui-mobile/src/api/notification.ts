/**
 * 通知 API
 * 路径前缀：/notifications
 *
 * SYNC-FROM-BACKEND: life-assisitant-api/internal/controller/notification.go
 * 最后同步：2026-09-18
 *
 * 后端端点：
 *   GET  /notifications                 notification:view   列表（response.Page）
 *   GET  /notifications/unread-count    notification:view   未读数
 *   POST /notifications/mark-read       notification:handle 全部已读
 *   POST /notifications/:id/read        notification:handle 单条已读
 */
import { http } from './request'
import type {
  ListNotificationsResp,
  MarkReadResp,
  PageQuery,
  UnreadCountResp,
} from './types'

export const notificationApi = {
  /** 通知列表（GET /notifications，走 response.Page 含分页四件套） */
  list(params: PageQuery = {}): Promise<ListNotificationsResp> {
    return http.get<ListNotificationsResp>('/notifications', { params })
  },

  /** 未读数量（GET /notifications/unread-count） */
  unreadCount(): Promise<UnreadCountResp> {
    return http.get<UnreadCountResp>('/notifications/unread-count')
  },

  /** 全部标记已读（POST /notifications/mark-read） */
  markRead(): Promise<MarkReadResp> {
    return http.post<MarkReadResp>('/notifications/mark-read')
  },

  /** 单条标记已读（POST /notifications/:id/read） */
  markReadByID(id: string): Promise<MarkReadResp> {
    return http.post<MarkReadResp>(`/notifications/${id}/read`)
  },
}
